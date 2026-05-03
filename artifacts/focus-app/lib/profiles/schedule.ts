import type { FocusProfile, FocusSchedule } from "./types";

/**
 * True iff `now` falls inside the schedule's recurring weekly window.
 *
 * Three cases worth calling out:
 *
 *   1. Disabled schedule  → never active.
 *   2. Empty `days` array → never active. (The user opted into scheduling
 *      but unchecked every day; we honour that as "off" instead of
 *      defaulting to "every day", because the latter would silently
 *      reactivate blocking after the user thought they'd disabled it.)
 *   3. Same-minute start/end → never active. (Treating it as "all day"
 *      would let a typo block everything indefinitely.)
 *
 * Overnight windows (`startMinute > endMinute`, e.g. 22:00 → 06:00) are
 * supported. The window is "active on day D" when:
 *   - today is D and we're past startMinute, OR
 *   - YESTERDAY was D and we're before endMinute (the tail of yesterday's
 *     window leaking into today's morning).
 */
export function isScheduleActive(
  schedule: FocusSchedule,
  now: Date
): boolean {
  if (!schedule.enabled) return false;
  if (schedule.days.length === 0) return false;
  if (schedule.startMinute === schedule.endMinute) return false;

  const day = now.getDay();
  const minute = now.getHours() * 60 + now.getMinutes();

  if (schedule.startMinute < schedule.endMinute) {
    // Same-day window: active during [start, end) on each scheduled day.
    return (
      schedule.days.includes(day) &&
      minute >= schedule.startMinute &&
      minute < schedule.endMinute
    );
  }

  // Overnight window. (day + 6) % 7 == "yesterday" in 0-Sunday indexing.
  const yesterday = (day + 6) % 7;
  return (
    (schedule.days.includes(day) && minute >= schedule.startMinute) ||
    (schedule.days.includes(yesterday) && minute < schedule.endMinute)
  );
}

/**
 * True iff this profile contributes to the live blocked set right now.
 * Profiles with `schedule === null` are always-on and always contribute.
 */
export function isProfileActive(profile: FocusProfile, now: Date): boolean {
  if (profile.schedule === null) return true;
  return isScheduleActive(profile.schedule, now);
}

/**
 * Compute the deduplicated, sorted union of blocked package names from
 * every currently-active profile. Sorting is stable and deterministic so
 * we can cheaply detect "did the active set actually change?" by joining
 * and string-comparing — see `useFocusProfiles` for that optimization.
 */
export function computeActivePackages(
  profiles: FocusProfile[],
  now: Date
): string[] {
  const set = new Set<string>();
  for (const p of profiles) {
    if (isProfileActive(p, now)) {
      for (const pkg of p.blockedApps) set.add(pkg);
    }
  }
  return [...set].sort();
}

/* ── Time formatting & parsing ─────────────────────────────────────────── */

/** Format minutes-from-midnight as zero-padded 24-hour `HH:MM`. */
export function formatTime(minute: number): string {
  const safe = Math.max(0, Math.min(1439, Math.floor(minute)));
  const h = Math.floor(safe / 60).toString().padStart(2, "0");
  const m = (safe % 60).toString().padStart(2, "0");
  return `${h}:${m}`;
}

/**
 * Parse a user-typed time string into minutes-from-midnight.
 *
 * Accepts: `9:00`, `09:00`, `0900`, `900`, `23:59`. Whitespace tolerated.
 * Rejects anything outside 24-hour bounds and any non-numeric noise.
 * Returns `null` on failure so callers can show inline validation.
 */
export function parseTime(input: string): number | null {
  const trimmed = input.trim().replace(/\s+/g, "");
  // Forms: H, HH, H:MM, HH:MM, HMM, HHMM
  const m = /^(\d{1,2}):?(\d{2})$/.exec(trimmed);
  if (!m) return null;
  const hh = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}

/** Three-letter weekday abbreviations indexed by 0-Sunday. */
export const DAY_LABELS: readonly string[] = [
  "SUN",
  "MON",
  "TUE",
  "WED",
  "THU",
  "FRI",
  "SAT",
] as const;
