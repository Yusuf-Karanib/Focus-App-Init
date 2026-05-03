const { withAndroidManifest } = require("@expo/config-plugins");

/* ── Constants ────────────────────────────────────────────────────────────── */

const SERVICE_CLASS = "expo.modules.focusapp.FocusAccessibilityService";
const ACCESSIBILITY_SERVICE_ACTION =
  "android.accessibilityservice.AccessibilityService";
const ACCESSIBILITY_SERVICE_META = "android.accessibilityservice";
const CONFIG_RESOURCE = "@xml/accessibility_service_config";

const ANDROID_NAME = "android:name";

const MAIN_ACTION = "android.intent.action.MAIN";
const HOME_CATEGORY = "android.intent.category.HOME";
const DEFAULT_CATEGORY = "android.intent.category.DEFAULT";

const QUERY_ALL_PACKAGES = "android.permission.QUERY_ALL_PACKAGES";
const PACKAGE_USAGE_STATS = "android.permission.PACKAGE_USAGE_STATS";

/* ── Helpers ──────────────────────────────────────────────────────────────── */

/** Find the application element (always present) in the parsed manifest. */
function getApplication(manifest) {
  return manifest.manifest.application[0];
}

/**
 * Locate the launcher MainActivity Expo prebuild generates. We don't hardcode
 * the class name — instead we find the activity that already has a MAIN intent
 * filter, since that's the canonical "this is the entry point" marker.
 */
function findMainActivity(application) {
  if (!Array.isArray(application.activity)) return null;

  for (const activity of application.activity) {
    const filters = Array.isArray(activity["intent-filter"])
      ? activity["intent-filter"]
      : [];
    for (const filter of filters) {
      const actions = Array.isArray(filter.action) ? filter.action : [];
      if (actions.some((a) => a?.$?.[ANDROID_NAME] === MAIN_ACTION)) {
        return { activity, filter };
      }
    }
  }
  return null;
}

/**
 * Add a category (idempotently) to an existing intent-filter element.
 * Returns true if it was newly added, false if already present.
 */
function ensureCategory(filter, categoryName) {
  if (!Array.isArray(filter.category)) {
    filter.category = [];
  }
  const exists = filter.category.some(
    (c) => c?.$?.[ANDROID_NAME] === categoryName
  );
  if (exists) return false;
  filter.category.push({ $: { [ANDROID_NAME]: categoryName } });
  return true;
}

/**
 * Add a top-level <uses-permission> entry idempotently.
 */
function ensurePermission(manifest, permissionName) {
  if (!Array.isArray(manifest.manifest["uses-permission"])) {
    manifest.manifest["uses-permission"] = [];
  }
  const exists = manifest.manifest["uses-permission"].some(
    (p) => p?.$?.[ANDROID_NAME] === permissionName
  );
  if (exists) return false;
  manifest.manifest["uses-permission"].push({
    $: { [ANDROID_NAME]: permissionName },
  });
  return true;
}

/* ── Plugin passes ────────────────────────────────────────────────────────── */

/**
 * Pass 1: Inject the FocusAccessibilityService into the merged AndroidManifest.
 *         (NudgeActivity is already declared in the module's own manifest, so
 *         the manifest-merger picks it up automatically — we don't re-add it.)
 */
function withFocusAccessibilityService(config) {
  return withAndroidManifest(config, (mod) => {
    const manifest = mod.modResults;
    const application = getApplication(manifest);

    if (!Array.isArray(application.service)) {
      application.service = [];
    }

    const alreadyAdded = application.service.some(
      (s) => s.$?.[ANDROID_NAME] === SERVICE_CLASS
    );

    if (!alreadyAdded) {
      application.service.push({
        $: {
          [ANDROID_NAME]: SERVICE_CLASS,
          "android:enabled": "true",
          "android:exported": "true",
          "android:permission": "android.permission.BIND_ACCESSIBILITY_SERVICE",
        },
        "intent-filter": [
          {
            action: [
              { $: { [ANDROID_NAME]: ACCESSIBILITY_SERVICE_ACTION } },
            ],
          },
        ],
        "meta-data": [
          {
            $: {
              [ANDROID_NAME]: ACCESSIBILITY_SERVICE_META,
              "android:resource": CONFIG_RESOURCE,
            },
          },
        ],
      });
    }

    return mod;
  });
}

/**
 * Pass 2: Promote the app to a Home Launcher.
 *
 * Adds `android.intent.category.HOME` and `android.intent.category.DEFAULT`
 * to the existing MAIN intent-filter on the launcher activity. Adding both
 * to the SAME filter (alongside the existing LAUNCHER category) is the
 * canonical pattern for an app that should appear in the app drawer AND be
 * selectable as the system home screen.
 *
 * Without this pass the app behaves like a normal app; with it, pressing the
 * Home button will prompt the user to pick a default home app.
 */
function withHomeLauncher(config) {
  return withAndroidManifest(config, (mod) => {
    const manifest = mod.modResults;
    const application = getApplication(manifest);

    const main = findMainActivity(application);
    if (!main) {
      // Be loud — silently failing here would leave the user wondering why
      // their app isn't a launcher.
      console.warn(
        "[focus-module] Could not locate MainActivity with a MAIN intent " +
          "filter. HOME / DEFAULT categories were not injected. Did you " +
          "prebuild the project before running this plugin?"
      );
      return mod;
    }

    ensureCategory(main.filter, HOME_CATEGORY);
    ensureCategory(main.filter, DEFAULT_CATEGORY);

    return mod;
  });
}

/**
 * Pass 3: Add QUERY_ALL_PACKAGES so we can list every installed app on the
 * device — required for a launcher UI that shows the user's app drawer.
 *
 * NOTE: This is a sensitive Google Play permission. Apps published to Play
 * must justify it via the Play Console "Permissions Declaration" form
 * (launcher / accessibility / device-search apps qualify). Sideloaded /
 * personal-use builds are unaffected.
 */
function withQueryAllPackages(config) {
  return withAndroidManifest(config, (mod) => {
    ensurePermission(mod.modResults, QUERY_ALL_PACKAGES);
    return mod;
  });
}

/**
 * Pass 4: Add PACKAGE_USAGE_STATS so we can read per-app foreground time
 * for the daily-usage display on the home screen.
 *
 * NOTE: This is a `signature|privileged` permission. Declaring it does
 * NOT actually grant access — the user must additionally toggle FocusApp
 * on inside Settings → Apps → Special access → Usage access. AndroidStudio
 * (and `aapt`) will emit a "ProtectedPermissions" lint warning here,
 * which is expected and correct for non-system apps. The build still
 * succeeds and the permission lands in the merged manifest, which is
 * what the OS reads to populate the Usage-access settings list.
 *
 * Google Play Store: usage-tracking apps (digital wellbeing, parental
 * controls, screen-time analytics, focus / productivity apps) are an
 * accepted use case for this permission.
 */
function withPackageUsageStats(config) {
  return withAndroidManifest(config, (mod) => {
    ensurePermission(mod.modResults, PACKAGE_USAGE_STATS);
    return mod;
  });
}

/* ── Compose ──────────────────────────────────────────────────────────────── */

function withFocusModule(config) {
  config = withFocusAccessibilityService(config);
  config = withHomeLauncher(config);
  config = withQueryAllPackages(config);
  config = withPackageUsageStats(config);
  return config;
}

module.exports = withFocusModule;
