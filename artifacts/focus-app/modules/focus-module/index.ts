import { requireNativeModule } from "expo-modules-core";
import { Platform } from "react-native";

export interface FocusModuleType {
  setBlockedApps(packages: string[]): number;
  getBlockedApps(): string[];
  isServiceEnabled(): boolean;
  openAccessibilitySettings(): void;
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
