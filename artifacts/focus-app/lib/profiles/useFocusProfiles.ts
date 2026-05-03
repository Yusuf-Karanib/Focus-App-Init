import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";

import { FocusModule } from "../../modules/focus-module";

import { computeActivePackages } from "./schedule";
import {
  loadProfiles,
  saveProfiles,
  subscribeToProfilesChanges,
} from "./storage";
import type { FocusProfile } from "./types";

/* ── Public surface ────────────────────────────────────────────────────── */

export interface UseFocusProfilesResult {
  /** All profiles, in the order the user arranged them. */
  profiles: FocusProfile[];
  /**
   * `false` until the initial AsyncStorage load resolves. UI should NOT
   * render an "empty state" before this flips, otherwise it'll flash on
   * every cold start.
   */
  loaded: boolean;
  /** Sorted union of package names blocked by all active profiles RIGHT NOW. */
  activePackages: string[];
  /** Same data as `activePackages` but as a Set for O(1) membership tests. */
  activeBlockedSet: Set<string>;
  /**
   * Replace the profiles list. Persists to AsyncStorage and (via the
   * effect below) syncs the new active set to the native AccessibilityService.
   * The state update is synchronous; the storage write is fire-and-forget
   * from the caller's POV (we await it internally so any reject is logged
   * but doesn't propagate).
   */
  setProfiles: (next: FocusProfile[]) => Promise<void>;
}

/* ── Hook ──────────────────────────────────────────────────────────────── */

/**
 * Source of truth for Focus Profiles in the React tree.
 *
 * Responsibilities:
 *   1. Load profiles from AsyncStorage on mount (one-shot).
 *   2. Re-evaluate the active set on every minute boundary so schedules
 *      transition automatically without a UI poke.
 *   3. Re-evaluate when the app returns to foreground (the JS engine may
 *      have been frozen for hours; the local clock has moved on).
 *   4. Reload from AsyncStorage when ANY mounted instance saves changes,
 *      via the storage-level event bus. This is what keeps the launcher
 *      and the profiles screen in lockstep without a context provider.
 *
 * Explicit non-responsibility:
 *   - Pushing the active set to the native AccessibilityService is NOT
 *     done here. With Emergency Bypass in the picture, the EFFECTIVE
 *     blocked set is `profilesActive - bypassedPackages` and only the
 *     screen that knows about both can compute it correctly. Use
 *     `useBlocklistSync(packages, loaded)` from a single owning screen
 *     (the launcher) to push.
 */
export function useFocusProfiles(): UseFocusProfilesResult {
  const [profiles, setProfilesState] = useState<FocusProfile[]>([]);
  const [loaded, setLoaded] = useState(false);

  // `tick` is a "force re-derive `activePackages`" counter. We bump it
  // every minute and on foreground. The actual time read happens inside
  // the `useMemo` below — the tick is just a dependency to invalidate it.
  const [tick, setTick] = useState(0);

  // ── Initial load ──────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    loadProfiles().then(
      (p) => {
        if (cancelled) return;
        setProfilesState(p);
        setLoaded(true);
      },
      () => {
        // loadProfiles already returns [] on read failure, so reaching
        // this branch implies a programmer error in the storage layer.
        // Fail open with no profiles rather than blocking the UI forever.
        if (!cancelled) setLoaded(true);
      }
    );
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Minute-boundary tick ──────────────────────────────────────────────
  // `setInterval(_, 60_000)` would drift relative to the wall clock; if
  // the user opened the app at HH:MM:59, we'd then tick at HH:MM+1:59,
  // missing the schedule transition by 59 seconds. Aligning to the next
  // real minute boundary keeps schedule edges crisp.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;

    function scheduleNextTick() {
      const now = new Date();
      const msToNextMinute =
        60_000 - (now.getSeconds() * 1000 + now.getMilliseconds());
      timer = setTimeout(() => {
        setTick((t) => t + 1);
        scheduleNextTick();
      }, msToNextMinute);
    }

    scheduleNextTick();
    return () => clearTimeout(timer);
  }, []);

  // ── Foreground re-eval ────────────────────────────────────────────────
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") setTick((t) => t + 1);
    });
    return () => sub.remove();
  }, []);

  // ── Cross-instance bus ────────────────────────────────────────────────
  // When the profiles screen saves an edit, our state would otherwise
  // stay stale until the next foreground transition. Reload directly.
  useEffect(() => {
    return subscribeToProfilesChanges(() => {
      loadProfiles().then(
        (p) => setProfilesState(p),
        () => {
          /* swallow */
        }
      );
    });
  }, []);

  // ── Derive active set ─────────────────────────────────────────────────
  const activePackages = useMemo(() => {
    return computeActivePackages(profiles, new Date());
    // `tick` invalidates this on every minute boundary; suppressing the
    // exhaustive-deps complaint is intentional because `new Date()` is
    // not a value React can track.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profiles, tick]);

  const activeBlockedSet = useMemo(
    () => new Set(activePackages),
    [activePackages]
  );

  // ── Mutator ───────────────────────────────────────────────────────────
  const setProfiles = useCallback(async (next: FocusProfile[]) => {
    setProfilesState(next);
    try {
      await saveProfiles(next);
    } catch {
      // Best-effort. In-memory state is already updated, so the UI stays
      // consistent for this session even if the disk write failed.
    }
  }, []);

  return {
    profiles,
    loaded,
    activePackages,
    activeBlockedSet,
    setProfiles,
  };
}

/* ── Native blocklist sync ─────────────────────────────────────────────── */

/**
 * Push a sorted package-name array to the native AccessibilityService
 * whenever it actually changes.
 *
 * This used to live inside `useFocusProfiles`. It was extracted because
 * the EFFECTIVE blocked set isn't just "what profiles say is blocked" —
 * it's "what profiles say MINUS what bypass currently grants". Only the
 * screen that knows about both can compute that, so the sync moved to
 * the call site. Mount this hook from EXACTLY ONE screen (the launcher)
 * — multiple callers would race to push different snapshots.
 *
 * The dedup uses a NUL-joined key because package names cannot contain
 * NUL bytes; this lets us treat the comparison as a simple string equality
 * check rather than walking arrays element-by-element.
 *
 * `loaded` gates the first push: we don't want to wipe the native
 * blocklist with `[]` between mount and the first AsyncStorage resolve,
 * because that would briefly unblock everything on every cold start.
 */
export function useBlocklistSync(packages: string[], loaded: boolean): void {
  const lastPushedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!loaded) return;
    const key = packages.join("\x00");
    if (key === lastPushedRef.current) return;
    lastPushedRef.current = key;
    try {
      FocusModule.setBlockedApps(packages);
    } catch {
      // No-op stub on web / iOS / Expo Go. Native errors here are
      // unrecoverable anyway — the user just sees stale blocking, which
      // fails safe (apps stay blocked rather than silently unblocking).
    }
  }, [packages, loaded]);
}
