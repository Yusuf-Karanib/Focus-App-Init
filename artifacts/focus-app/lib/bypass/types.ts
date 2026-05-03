/**
 * Emergency Bypass — data model.
 *
 * A "bypass" is a one-time, time-boxed permission to use a normally-blocked
 * app. It exists to handle real emergencies (need to look up an address on
 * Maps while focused, need to send one urgent Slack message, etc) without
 * forcing the user to disable Focus Mode entirely.
 *
 * The model is deliberately simple: a flat list of records, each capturing
 * one bypass grant. Multiple records may coexist (e.g. one auto-granted
 * bypass + one OVERRIDE bypass after the 60-second wait). The active
 * bypassed-packages set is computed by walking the records and keeping
 * those whose `expiresAt` is in the future. The cooldown (one free bypass
 * per 24h) is computed by walking the records and asking: was ANY bypass
 * granted within the last 24 hours?
 *
 * Records older than 24h are housekeeping — they no longer affect either
 * the active set OR the cooldown — and `saveBypass` opportunistically
 * prunes them.
 */

export interface BypassRecord {
  /** Android package name of the app whose block was lifted. */
  packageName: string;
  /**
   * Wall-clock ms when the bypass was granted. Used for the 24-hour
   * cooldown check ("can the user request another free bypass?").
   */
  grantedAt: number;
  /**
   * Wall-clock ms when the bypass window closes and the app re-enters
   * the active blocked set. Conventionally `grantedAt + BYPASS_DURATION_MS`,
   * but stored explicitly so the duration constant can change in future
   * versions without invalidating already-stored records.
   */
  expiresAt: number;
}
