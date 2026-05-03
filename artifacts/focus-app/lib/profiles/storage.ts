import AsyncStorage from "@react-native-async-storage/async-storage";

import type { FocusProfile, FocusSchedule } from "./types";

/**
 * AsyncStorage key. Versioned so future schema changes can migrate from
 * the old key rather than overwriting it in place.
 */
const STORAGE_KEY = "focus_profiles_v1";

/**
 * Load profiles from AsyncStorage.
 *
 * Returns `[]` on:
 *   - first run (key not present)
 *   - corrupted JSON (defensive — never throw to callers)
 *   - any individual profile failing structural validation (we drop bad
 *     entries but keep good ones from the same payload)
 *
 * The strict validator below exists because AsyncStorage gives back
 * whatever was written — including data from old app versions, manual
 * edits, or partial writes from a crash. Trusting it without a runtime
 * check would crash the entire profiles screen on first render.
 */
export async function loadProfiles(): Promise<FocusProfile[]> {
  let raw: string | null;
  try {
    raw = await AsyncStorage.getItem(STORAGE_KEY);
  } catch {
    return [];
  }
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const out: FocusProfile[] = [];
  for (const entry of parsed) {
    const p = sanitizeProfile(entry);
    if (p) out.push(p);
  }
  return out;
}

/**
 * Persist the entire profiles array. We don't do incremental updates —
 * the dataset is small (handful of profiles, each with a handful of
 * package names) and an atomic full-write avoids partial-state bugs.
 *
 * Caller is responsible for awaiting (or fire-and-forgetting); we don't
 * swallow errors here so they're visible if the device is out of storage.
 */
export async function saveProfiles(profiles: FocusProfile[]): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(profiles));
}

/**
 * Generate a profile id. Not cryptographic — just unique enough across
 * the lifetime of one device's profile list. Time-component first so ids
 * sort chronologically by accident, which is convenient when debugging.
 */
export function makeProfileId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/* ── Validation ────────────────────────────────────────────────────────── */

function sanitizeProfile(x: unknown): FocusProfile | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;

  if (typeof o.id !== "string" || !o.id) return null;
  if (typeof o.name !== "string") return null;
  if (!Array.isArray(o.blockedApps)) return null;

  const blockedApps = o.blockedApps.filter(
    (s): s is string => typeof s === "string" && s.length > 0
  );

  const schedule = sanitizeSchedule(o.schedule);

  return {
    id: o.id,
    name: o.name,
    blockedApps,
    schedule,
  };
}

function sanitizeSchedule(x: unknown): FocusSchedule | null {
  if (x === null || x === undefined) return null;
  if (typeof x !== "object") return null;
  const o = x as Record<string, unknown>;

  const enabled = typeof o.enabled === "boolean" ? o.enabled : false;

  // Clamp to valid range — silently fix bad data rather than dropping the
  // profile entirely. Out-of-range values would break `isScheduleActive`.
  const startMinute = clampMinute(o.startMinute);
  const endMinute = clampMinute(o.endMinute);

  const days = Array.isArray(o.days)
    ? o.days
        .filter(
          (d): d is number =>
            typeof d === "number" && d >= 0 && d <= 6 && Number.isInteger(d)
        )
    : [];

  return { enabled, startMinute, endMinute, days };
}

function clampMinute(x: unknown): number {
  if (typeof x !== "number" || !Number.isFinite(x)) return 0;
  const n = Math.floor(x);
  if (n < 0) return 0;
  if (n > 1439) return 1439;
  return n;
}
