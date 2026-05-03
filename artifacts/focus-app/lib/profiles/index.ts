/**
 * Barrel export for the Focus Profiles module.
 *
 * Consumers should import from `lib/profiles` rather than reaching into
 * individual files, so the internal layout (storage / schedule / hook /
 * types) can be reorganised without touching call sites.
 */
export type { FocusProfile, FocusSchedule } from "./types";
export {
  loadProfiles,
  saveProfiles,
  makeProfileId,
} from "./storage";
export {
  isScheduleActive,
  isProfileActive,
  computeActivePackages,
  formatTime,
  parseTime,
  DAY_LABELS,
} from "./schedule";
export {
  useFocusProfiles,
  type UseFocusProfilesResult,
} from "./useFocusProfiles";
