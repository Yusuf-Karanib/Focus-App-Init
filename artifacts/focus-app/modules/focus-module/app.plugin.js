const { withAndroidManifest } = require("@expo/config-plugins");

const SERVICE_CLASS = "expo.modules.focusapp.FocusAccessibilityService";
const ACCESSIBILITY_SERVICE_ACTION = "android.accessibilityservice.AccessibilityService";
const ACCESSIBILITY_SERVICE_META = "android.accessibilityservice";
const CONFIG_RESOURCE = "@xml/accessibility_service_config";

function withFocusAccessibilityService(config) {
  return withAndroidManifest(config, (mod) => {
    const manifest = mod.modResults;
    const application = manifest.manifest.application[0];

    if (!application.service) {
      application.service = [];
    }

    const alreadyAdded = application.service.some(
      (s) => s.$?.["android:name"] === SERVICE_CLASS
    );

    if (!alreadyAdded) {
      application.service.push({
        $: {
          "android:name": SERVICE_CLASS,
          "android:enabled": "true",
          "android:exported": "true",
          "android:permission": "android.permission.BIND_ACCESSIBILITY_SERVICE",
        },
        "intent-filter": [
          {
            action: [
              {
                $: { "android:name": ACCESSIBILITY_SERVICE_ACTION },
              },
            ],
          },
        ],
        "meta-data": [
          {
            $: {
              "android:name": ACCESSIBILITY_SERVICE_META,
              "android:resource": CONFIG_RESOURCE,
            },
          },
        ],
      });
    }

    return mod;
  });
}

module.exports = withFocusAccessibilityService;
