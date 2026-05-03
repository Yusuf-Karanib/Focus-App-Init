import AsyncStorage from "@react-native-async-storage/async-storage";

import type { BypassRecord } from "./types";

/**
 * AsyncStorage key for the bypass log. Versioned so future schema changes
 * (e.g. recording grant reason or device timezone) can migrate from the
 * old key rather than overwriting it.
 */
const STORAGE_KEY = "focus_bypass_v1";

/**
 * How long a single bypass keeps the app unblocked. 10 minutes per the
 * product requirement — long enough to do the thing the user said they
 * needed to do, short enough that it can't be confused with "I disabled
 * blocking for the afternoon".
 */
export const BYPASS_DURATION_MS = 10 * 60 * 1000;

/**
 * Cooldown between free bypasses. Records within this window count
 * toward the cooldown check; older records are pruned.
 */
export const BYPASS_COOLDOWN_MS = 24 * 60 * 60 * 1000;

/* ── Load / save ───────────────────────────────────────────────────────── */

export async function loadBypassRecords(): Promise<BypassRecord[]> {
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

  const now = Date.now();
  const out: BypassRecord[] = [];
  for (const entry of parsed) {
    const r = sanitizeRecord(entry, now);
    if (r) out.push(r);
  }
  return out;
}

export async function saveBypassRecords(records: BypassRecord[]): Promise<void> {
  // Opportunistic pruning at write time: anything more than 24h old can
  // never affect the cooldown OR the active set again, so it's pure
  // garbage. Keeps the stored payload bounded even after many bypasses.
  const now = Date.now();
  const pruned = records.filter((r) => r.grantedAt + BYPASS_COOLDOWN_MS > now);
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(pruned));
  notifyBypassChanged();
}

/* ── Cross-instance event bus ──────────────────────────────────────────── */

/**
 * Two screens (home + profiles) call `useBypass` independently. Without
 * a notification mechanism, mutating bypass state in one instance would
 * leave the other instance reading stale data from its own React state
 * even though AsyncStorage is up-to-date. The bus is fired by `saveBypassRecords`
 * and consumed by every live `useBypass` to trigger a reload.
 *
 * Self-notifications (the instance that called save) are accepted; the
 * resulting reload is idempotent and cheap.
 */
const listeners = new Set<() => void>();

export function subscribeToBypassChanges(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function notifyBypassChanged(): void {
  for (const cb of listeners) {
    cb();
  }
}

/* ── Validation ────────────────────────────────────────────────────────── */

function sanitizeRecord(x: unknown, now: number): BypassRecord | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;

  if (typeof o.packageName !== "string" || !o.packageName) return null;
  if (typeof o.grantedAt !== "number" || !Number.isFinite(o.grantedAt)) return null;
  if (typeof o.expiresAt !== "number" || !Number.isFinite(o.expiresAt)) return null;

  // Defensive against clock skew / corrupted data: a grant from the future
  // would lock the user out of bypassing forever, so we drop it.
  if (o.grantedAt > now + 60_000) return null;

  // Drop ancient records — they can't matter to either cooldown or active set.
  if (o.grantedAt + BYPASS_COOLDOWN_MS < now) return null;

  return {
    packageName: o.packageName,
    grantedAt: o.grantedAt,
    expiresAt: o.expiresAt,
  };
}
