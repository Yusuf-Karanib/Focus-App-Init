import { useCallback, useEffect, useMemo, useState } from "react";
import { AppState } from "react-native";

import {
  BYPASS_COOLDOWN_MS,
  BYPASS_DURATION_MS,
  loadBypassRecords,
  saveBypassRecords,
  subscribeToBypassChanges,
} from "./storage";
import type { BypassRecord } from "./types";

/* ── Public surface ────────────────────────────────────────────────────── */

/** What `requestBypass` decided to do. */
export type BypassRequestResult =
  /** Granted — the package is now bypassed for `BYPASS_DURATION_MS`. */
  | { kind: "granted"; expiresAt: number }
  /**
   * Refused — the user has already used their free bypass within the
   * last 24h. UI should show the 60-second wait screen and offer the
   * `forceBypass` escape hatch from there.
   */
  | { kind: "needs-wait"; cooldownEndsAt: number };

export interface UseBypassResult {
  /** False until the initial AsyncStorage read resolves. */
  loaded: boolean;
  /**
   * Set of package names currently bypassed (i.e. records whose
   * `expiresAt` is still in the future). Subtract from the profiles'
   * active package set to get the EFFECTIVE blocked set.
   */
  bypassedPackages: Set<string>;
  /**
   * `true` when the user has used a bypass within the last 24h. While
   * this is `true`, `requestBypass` returns `needs-wait`.
   */
  inCooldown: boolean;
  /** Wall-clock ms when the cooldown lifts. `null` if not in cooldown. */
  cooldownEndsAt: number | null;
  /**
   * For the package currently bypassed (if any), wall-clock ms when its
   * 10-minute window ends. `null` if no active bypass.
   */
  activeBypassExpiresAt: number | null;
  /**
   * Try to grant a 10-minute bypass for `pkg`. Honours the 24h cooldown.
   * Returns synchronously so the caller can react immediately; the
   * underlying AsyncStorage write is fire-and-forget.
   */
  requestBypass: (pkg: string) => BypassRequestResult;
  /**
   * Grant a bypass for `pkg` regardless of the cooldown. Used by the
   * 60-second wait screen as the OVERRIDE escape hatch. The new record
   * is appended to the log, so it counts toward future cooldown checks
   * — repeated overrides each require their own 60-second wait.
   */
  forceBypass: (pkg: string) => { expiresAt: number };
}

/* ── Hook ──────────────────────────────────────────────────────────────── */

export function useBypass(): UseBypassResult {
  const [records, setRecords] = useState<BypassRecord[]>([]);
  const [loaded, setLoaded] = useState(false);

  // Same minute-aligned tick pattern as `useFocusProfiles` — bumps once a
  // minute (and on app foregrounding) so derived values like
  // `bypassedPackages` re-eval as bypass windows expire.
  const [tick, setTick] = useState(0);

  // ── Initial load ──────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    loadBypassRecords().then(
      (r) => {
        if (cancelled) return;
        setRecords(r);
        setLoaded(true);
      },
      () => {
        if (!cancelled) setLoaded(true);
      }
    );
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Cross-instance bus ────────────────────────────────────────────────
  // When another mounted `useBypass` calls `requestBypass`/`forceBypass`,
  // our local state would otherwise go stale. The bus pushes a reload
  // signal; we re-read AsyncStorage to absorb the change.
  useEffect(() => {
    return subscribeToBypassChanges(() => {
      loadBypassRecords().then(
        (r) => setRecords(r),
        () => {
          /* swallow */
        }
      );
    });
  }, []);

  // ── Minute-boundary tick ──────────────────────────────────────────────
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

  // ── Derive: bypassed packages ─────────────────────────────────────────
  const bypassedPackages = useMemo(() => {
    const now = Date.now();
    const out = new Set<string>();
    for (const r of records) {
      if (r.expiresAt > now) out.add(r.packageName);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [records, tick]);

  // ── Derive: cooldown state ────────────────────────────────────────────
  const { inCooldown, cooldownEndsAt } = useMemo(() => {
    const now = Date.now();
    let latestGrant = -Infinity;
    for (const r of records) {
      if (r.grantedAt + BYPASS_COOLDOWN_MS > now && r.grantedAt > latestGrant) {
        latestGrant = r.grantedAt;
      }
    }
    if (latestGrant === -Infinity) {
      return { inCooldown: false, cooldownEndsAt: null as number | null };
    }
    return {
      inCooldown: true,
      cooldownEndsAt: latestGrant + BYPASS_COOLDOWN_MS,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [records, tick]);

  // ── Derive: active bypass expiration (latest one, if any) ─────────────
  const activeBypassExpiresAt = useMemo(() => {
    const now = Date.now();
    let latestExpires = -Infinity;
    for (const r of records) {
      if (r.expiresAt > now && r.expiresAt > latestExpires) {
        latestExpires = r.expiresAt;
      }
    }
    return latestExpires === -Infinity ? null : latestExpires;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [records, tick]);

  // ── Mutators ──────────────────────────────────────────────────────────
  const appendRecord = useCallback((pkg: string): BypassRecord => {
    const now = Date.now();
    const record: BypassRecord = {
      packageName: pkg,
      grantedAt: now,
      expiresAt: now + BYPASS_DURATION_MS,
    };
    setRecords((current) => {
      const next = [...current, record];
      // Persist asynchronously; the bus fires from inside saveBypassRecords
      // so other instances pick up the change.
      saveBypassRecords(next).catch(() => {
        /* best-effort */
      });
      return next;
    });
    return record;
  }, []);

  const requestBypass = useCallback(
    (pkg: string): BypassRequestResult => {
      if (inCooldown && cooldownEndsAt != null) {
        return { kind: "needs-wait", cooldownEndsAt };
      }
      const record = appendRecord(pkg);
      return { kind: "granted", expiresAt: record.expiresAt };
    },
    [inCooldown, cooldownEndsAt, appendRecord]
  );

  const forceBypass = useCallback(
    (pkg: string) => {
      const record = appendRecord(pkg);
      return { expiresAt: record.expiresAt };
    },
    [appendRecord]
  );

  return {
    loaded,
    bypassedPackages,
    inCooldown,
    cooldownEndsAt,
    activeBypassExpiresAt,
    requestBypass,
    forceBypass,
  };
}
