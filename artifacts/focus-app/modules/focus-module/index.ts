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

/**
 * Native-module surface. Mirrors the `Function(...)` declarations in
 * `FocusModule.kt` (Kotlin side, registered as `Name("FocusApp")`).
 *
 * If you add or change a function here, you must change it in the Kotlin
 * file too — there is no compile-time link between the two sides.
 */
export interface FocusModuleType {
  setBlockedApps(packages: string[]): number;
  getBlockedApps(): string[];
  isServiceEnabled(): boolean;
  openAccessibilitySettings(): void;
  getInstalledApps(): InstalledApp[];
  launchApp(packageName: string): boolean;
  promptDefaultLauncher(): boolean;
}

/**
 * Safe stub used on platforms where the native module isn't available
 * (web, iOS, and inside Expo Go on any platform). Every method is a no-op
 * with a sensible default return value, so screens that import this
 * module never crash on import — they simply see "no installed apps,
 * service not enabled, nothing blocked".
 *
 * Keeping the stub structurally identical to the native module is what
 * lets us guarantee `FocusModuleType` is honored on every platform.
 */
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
  launchApp: () => false,
  promptDefaultLauncher: () => {
    if (__DEV__) {
      console.warn(
        "[FocusModule] promptDefaultLauncher() unavailable on this platform."
      );
    }
    return false;
  },
};

/**
 * Resolve the native module exactly once at import time.
 *
 * The string `"FocusApp"` MUST match the `Name(...)` declared in
 * `FocusModule.kt`. They are looked up by string at runtime; the compiler
 * cannot catch a drift. Mismatch silently falls back to the no-op stub,
 * meaning every native call appears to "work" but does nothing.
 *
 * Resolution rules:
 *   1. Non-Android (iOS / web)             → use the no-op stub.
 *   2. Android, but `requireNativeModule` throws (running in Expo Go,
 *      or in a dev client built before the module existed) → no-op stub
 *      with a one-time dev warning.
 *   3. Android with the native module present → real bridge.
 *
 * The result is bound to `FocusApp` here. We re-export it under both
 * names — `FocusApp` (the new preferred name, matching the Kotlin
 * `Name(...)`) and `FocusModule` (kept for backward compatibility with
 * the existing import in `app/(tabs)/index.tsx`).
 */
let resolved: FocusModuleType;
try {
  if (Platform.OS === "android") {
    resolved = requireNativeModule<FocusModuleType>("FocusApp");
  } else {
    resolved = noop;
  }
} catch (err) {
  if (__DEV__) {
    console.warn(
      "[FocusModule] Native module not available — falling back to no-op. " +
        "This is expected in Expo Go and on web; build a custom dev client to use it."
    );
  }
  resolved = noop;
}

/**
 * Direct handle to the native bridge. Exported so callers that prefer
 * `FocusApp.getInstalledApps()` (matching the Kotlin `Name(...)`) can use
 * that style instead of the individual function exports below.
 */
export const FocusApp: FocusModuleType = resolved;

/**
 * Backward-compatible alias for `FocusApp`. Existing screens import this
 * name; keeping it avoids a churning rename across the rest of the app.
 */
export const FocusModule: FocusModuleType = resolved;

export default FocusApp;

/**
 * `true` only when we're on Android AND the native module successfully
 * resolved (i.e. not the no-op stub). Use this to gate UI that only makes
 * sense when real device data is available, e.g. an empty-state message
 * vs. a "build a dev client" hint.
 */
export const isFocusModuleAvailable: boolean =
  Platform.OS === "android" && resolved !== noop;

/* ─────────────────────────────────────────────────────────────────────── */
/*  Convenience function exports — thin wrappers around `FocusApp.*`     */
/*                                                                        */
/*  Each wrapper exists so callers can do                                 */
/*      import { getInstalledApps } from "@/modules/focus-module"        */
/*  rather than                                                           */
/*      import { FocusApp } from "@/modules/focus-module"                */
/*      FocusApp.getInstalledApps()                                       */
/*                                                                        */
/*  Both styles work; the wrappers are also where the user-facing         */
/*  JSDoc lives.                                                          */
/* ─────────────────────────────────────────────────────────────────────── */

/**
 * Save the list of blocked Android package names to native SharedPreferences.
 * The FocusAccessibilityService reads this list and forces the user back to
 * the home screen whenever a matching app comes to the foreground; the
 * FocusNotificationListener reads the same list and silently cancels any
 * notifications posted from those packages.
 *
 * On web and inside Expo Go this is a safe no-op that returns 0.
 *
 * @param apps Array of package names, e.g. `["com.instagram.android"]`.
 * @returns The number of packages that were saved.
 */
export function setBlockedApps(apps: string[]): number {
  return FocusApp.setBlockedApps(apps);
}

export function getBlockedApps(): string[] {
  return FocusApp.getBlockedApps();
}

export function isServiceEnabled(): boolean {
  return FocusApp.isServiceEnabled();
}

export function openAccessibilitySettings(): void {
  FocusApp.openAccessibilitySettings();
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
 * The returned array IS the array the native side produced — Expo's
 * Kotlin bridge converts the underlying `List<Map<String, String>>`
 * directly into a JS array of objects with no extra serialization step.
 * Sorted alphabetically (case-insensitive) by `name`.
 *
 * On web and inside Expo Go this is a safe no-op that returns `[]`.
 *
 * Note: requires the `QUERY_ALL_PACKAGES` permission, which is declared by
 * this module's Expo config plugin.
 */
export function getInstalledApps(): InstalledApp[] {
  return FocusApp.getInstalledApps();
}

/**
 * Launch the given app by package name from our launcher.
 *
 * Resolves the package's main launcher activity via
 * `PackageManager.getLaunchIntentForPackage` and starts it. Returns `true`
 * if the app was launched, `false` for any handled failure (package not
 * installed, no launcher activity, restricted by work-profile policy, etc).
 *
 * Never throws — UIs can safely call this on user tap without a try/catch.
 *
 * On web and inside Expo Go this is a safe no-op that returns `false`.
 *
 * @param packageName e.g. `"com.android.chrome"`.
 */
export function launchApp(packageName: string): boolean {
  return FocusApp.launchApp(packageName);
}

/**
 * Open the system "Default Home app" picker so the user can select FocusApp
 * (or any other launcher) as their default home screen.
 *
 * Android does not allow apps to make themselves the default launcher
 * programmatically — by design, this choice always belongs to the user.
 * This function is the closest legal equivalent: it deep-links straight
 * into the picker so the user only has to tap "FocusApp" → "Always" to
 * complete the flow.
 *
 * Returns `true` if the picker opened, `false` if the device's Settings
 * app doesn't expose this screen (rare; mostly Android-TV, Wear, or kiosk
 * ROMs). Never throws — UIs can call this on a tap without try/catch and
 * fall back on the boolean result, e.g. by showing a manual instruction.
 *
 * On web and inside Expo Go this is a safe no-op that returns `false`
 * (and logs a warning in dev).
 */
export function promptDefaultLauncher(): boolean {
  return FocusApp.promptDefaultLauncher();
}
