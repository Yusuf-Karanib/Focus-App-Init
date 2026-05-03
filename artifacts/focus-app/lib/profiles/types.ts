/**
 * Focus Profiles — data model.
 *
 * A "profile" is a named bundle of blocked apps + an optional time-of-day
 * schedule. Multiple profiles can coexist; the live blocked set at any
 * moment is the UNION of `blockedApps` across all profiles whose schedule
 * is currently active.
 *
 * A profile with `schedule === null` is "always on" — its apps are blocked
 * 24/7. Use this for the user's hard-block list ("apps I never want to
 * open"). A profile with a schedule object is gated by that window.
 *
 * Persistence: serialized to AsyncStorage as JSON under
 * `focus_profiles_v1`. The `_v1` suffix lets us migrate the schema later
 * without a destructive read of the old key.
 */

/**
 * A weekly recurring time window.
 *
 * Times are stored as MINUTES FROM LOCAL MIDNIGHT (0–1439), not as Date
 * objects, so they survive serialization cleanly and don't carry a date or
 * timezone the user never set. Days are 0–6 with 0 = Sunday, matching
 * `Date.prototype.getDay()`.
 *
 * `startMinute > endMinute` means an OVERNIGHT window (e.g. 22:00 → 06:00).
 * `startMinute === endMinute` is treated as an empty window (never active)
 * — we deliberately do NOT interpret it as "all day" because that's an
 * easy way to silently brick the user's whole device.
 */
export interface FocusSchedule {
  enabled: boolean;
  startMinute: number;
  endMinute: number;
  /** 0 = Sunday … 6 = Saturday. An empty array means "never active". */
  days: number[];
}

/**
 * A named bundle of blocked apps with an optional schedule.
 *
 * `id` is opaque — generated client-side, never shown to the user, used
 * only as a stable key for React lists and storage updates.
 *
 * `schedule === null` means "always block these apps". This is the
 * default for newly-created profiles; the user opts INTO scheduling.
 */
export interface FocusProfile {
  id: string;
  name: string;
  /** Android package names, e.g. `com.instagram.android`. */
  blockedApps: string[];
  schedule: FocusSchedule | null;
}
