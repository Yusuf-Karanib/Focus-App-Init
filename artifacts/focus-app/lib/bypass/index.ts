/**
 * Barrel for the Emergency Bypass module. Mirrors the shape of
 * `lib/profiles` so consumers have one import line per concern.
 */
export type { BypassRecord } from "./types";
export {
  BYPASS_DURATION_MS,
  BYPASS_COOLDOWN_MS,
  loadBypassRecords,
  saveBypassRecords,
  subscribeToBypassChanges,
} from "./storage";
export {
  useBypass,
  type BypassRequestResult,
  type UseBypassResult,
} from "./useBypass";
