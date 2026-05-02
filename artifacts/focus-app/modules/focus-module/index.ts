import { requireNativeModule } from "expo-modules-core";
import { Platform } from "react-native";

/**
 * One row returned by `getInstalledApps()`.
 *
 * - `name`: the app's user-visible label (what shows under its icon in the
 *           system launcher), e.g. "Instagram".
 * - `packageName`: the Android package id used everywhere else in this
 *           module, e.g. "com.instagram.android". Pass this string back
 *           to `setBlockedApps` to block the app.
 */
export interface InstalledApp {
  name: string;
  packageName: string;
}

export interface FocusModuleType {
  setBlockedApps(packages: string[]): number;
  getBlockedApps(): string[];
  isServiceEnabled(): boolean;
  openAccessibilitySettings(): void;
  getInstalledApps(): InstalledApp[];
}

const noop: FocusModuleType = {
  setBlockedApps: () => 0,
  getBlockedApps: () => [],
  isServiceEnabled: () => false,
  openAccessibilitySettings: () => {
    if (__DEV__) {
      console.warn(
        "[FocusModule] openAccessibilitySettings() unavailable on this platform."
      );
    }
  },
  getInstalledApps: () => [],
};

let nativeModule: FocusModuleType;

try {
  if (Platform.OS === "android") {
    nativeModule = requireNativeModule<FocusModuleType>("FocusModule");
  } else {
    nativeModule = noop;
  }
} catch (err) {
  if (__DEV__) {
    console.warn(
      "[FocusModule] Native module not available — falling back to no-op. " +
        "This is expected in Expo Go and on web; build a custom dev client to use it."
    );
  }
  nativeModule = noop;
}

export const FocusModule = nativeModule;
export default FocusModule;

export const isFocusModuleAvailable: boolean =
  Platform.OS === "android" && nativeModule !== noop;

/**
 * Save the list of blocked Android package names to native SharedPreferences.
 * The FocusAccessibilityService reads this list and forces the user back to
 * the home screen whenever a matching app comes to the foreground.
 *
 * On web and inside Expo Go this is a safe no-op that returns 0.
 *
 * @param apps Array of package names, e.g. ["com.instagram.android"]
 * @returns The number of packages that were saved.
 */
export function setBlockedApps(apps: string[]): number {
  return nativeModule.setBlockedApps(apps);
}

export function getBlockedApps(): string[] {
  return nativeModule.getBlockedApps();
}

export function isServiceEnabled(): boolean {
  return nativeModule.isServiceEnabled();
}

export function openAccessibilitySettings(): void {
  nativeModule.openAccessibilitySettings();
}

/**
 * Return every launchable app installed on the device — the apps the user
 * can normally see in their app drawer. Hidden system services and packages
 * without a launch intent are excluded, as is FocusApp itself.
 *
 * Each entry has a human-readable `name` (e.g. "Instagram") and a
 * `packageName` (e.g. "com.instagram.android"). Pass the `packageName`
 * value back into `setBlockedApps` to block that app.
 *
 * On web and inside Expo Go this is a safe no-op that returns an empty array.
 *
 * Note: requires the `QUERY_ALL_PACKAGES` permission, which is declared by
 * this module's Expo config plugin.
 */
export function getInstalledApps(): InstalledApp[] {
  return nativeModule.getInstalledApps();
}
