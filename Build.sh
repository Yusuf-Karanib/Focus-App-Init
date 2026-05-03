#!/usr/bin/env bash
set -euo pipefail

# ── Cleanup ─────────────────────────────────────────────────────────────────
# Free disk space from previous failed builds. Scoped to build artifacts and
# gradle's own temp output — does NOT touch /tmp/logs, /tmp/log_mapping.json,
# or live workflow sockets, all of which would break the running workspace.
ANDROID_PROJECT_DIR="${ANDROID_PROJECT_DIR:-artifacts/focus-app/android}"

echo "Cleaning previous build output..."
rm -rf "$ANDROID_PROJECT_DIR/app/build"
rm -rf "$ANDROID_PROJECT_DIR/build"
rm -rf "$ANDROID_PROJECT_DIR/.gradle"

echo "Cleaning gradle temp dirs..."
rm -rf /tmp/.gradle-* /tmp/gradle-* 2>/dev/null || true
rm -rf "$HOME/.gradle/caches/transforms-"* 2>/dev/null || true

# ── Java ────────────────────────────────────────────────────────────────────
export JAVA_HOME="${JAVA_HOME:-$(dirname $(dirname $(readlink -f $(which java))))}"
echo "JAVA_HOME: $JAVA_HOME"

# ── Android SDK ─────────────────────────────────────────────────────────────
ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-$HOME/android-sdk}"
ANDROID_CMD_TOOLS_URL="https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip"
CMD_TOOLS_DIR="$ANDROID_SDK_ROOT/cmdline-tools/latest"

if [ ! -d "$CMD_TOOLS_DIR" ]; then
  echo "Installing Android SDK command-line tools..."
  mkdir -p "$ANDROID_SDK_ROOT/cmdline-tools"
  TMP_ZIP=$(mktemp --suffix=.zip)
  curl -fsSL "$ANDROID_CMD_TOOLS_URL" -o "$TMP_ZIP"
  unzip -q "$TMP_ZIP" -d "$ANDROID_SDK_ROOT/cmdline-tools"
  mv "$ANDROID_SDK_ROOT/cmdline-tools/cmdline-tools" "$CMD_TOOLS_DIR"
  rm -f "$TMP_ZIP"
  echo "Command-line tools installed."
fi

export ANDROID_SDK_ROOT
export ANDROID_HOME="$ANDROID_SDK_ROOT"
export PATH="$CMD_TOOLS_DIR/bin:$ANDROID_SDK_ROOT/platform-tools:$PATH"

echo "Accepting Android SDK licenses..."
yes | sdkmanager --licenses > /dev/null 2>&1 || true

echo "Installing required SDK components..."
# android-36 / build-tools 36.0.0 are required because the Expo prebuild
# template now sets compileSdk = targetSdk = 36. Older android-35 alone
# fails the build with: "Failed to install the following SDK components:
# platforms;android-36".
sdkmanager \
  "platform-tools" \
  "platforms;android-35" \
  "build-tools;35.0.0" \
  "platforms;android-36" \
  "build-tools;36.0.0"

echo "Android SDK ready at: $ANDROID_SDK_ROOT"

# ── Gradle build ─────────────────────────────────────────────────────────────
ANDROID_PROJECT_DIR="${ANDROID_PROJECT_DIR:-artifacts/focus-app/android}"
echo "Building from: $ANDROID_PROJECT_DIR"
cd "$ANDROID_PROJECT_DIR"

# JVM tuning — keep memory low and skip the perf-data file (which gradle
# otherwise scribbles into /tmp). These are JVM flags, NOT gradle CLI flags,
# so passing them directly to `./gradlew` (e.g. `./gradlew ... -Xmx768m`)
# would make gradle reject them as unknown tasks. They must reach the JVM
# via env vars / -D properties:
#   GRADLE_OPTS         → applied to the gradle launcher JVM
#   org.gradle.jvmargs  → applied to the gradle worker JVMs that do the
#                         actual compilation work
GRADLE_OPTS="-Xmx768m -XX:-UsePerfData" \
  ./gradlew assembleRelease \
    --no-daemon \
    --max-workers=1 \
    -Dorg.gradle.jvmargs="-Xmx768m -XX:-UsePerfData"

# ── APK extraction ───────────────────────────────────────────────────────────
# After cd into ANDROID_PROJECT_DIR above, the APK lands in:
#   app/build/outputs/apk/release/app-release.apk
#
# NOTE: Without a signing config in app/build.gradle, Gradle emits
# `app-release-unsigned.apk` instead — unsigned APKs cannot be installed on
# any Android device. We copy whichever one is produced and warn if it's
# unsigned, so the build doesn't fail silently in that case.
RELEASE_APK_DIR="app/build/outputs/apk/release"
SIGNED_APK="$RELEASE_APK_DIR/app-release.apk"
UNSIGNED_APK="$RELEASE_APK_DIR/app-release-unsigned.apk"

# Resolve the workspace root (the parent of artifacts/focus-app/android).
# We were `cd`d into the android project earlier, so $OLDPWD points back
# at wherever the script was invoked from — that's the project root.
WORKSPACE_ROOT="$(cd "${OLDPWD:-..}" 2>/dev/null && pwd)" || WORKSPACE_ROOT="$(pwd)/../.."
DEST="$WORKSPACE_ROOT/FocusApp-Final.apk"

if [ -f "$SIGNED_APK" ]; then
  echo "Copying signed release APK -> $DEST"
  cp "$SIGNED_APK" "$DEST"
  echo "✔ Done: $DEST"
elif [ -f "$UNSIGNED_APK" ]; then
  echo "WARNING: Only an UNSIGNED release APK was produced."
  echo "  This will NOT install on any Android device until signed."
  echo "  Add a signingConfig in app/build.gradle to fix this."
  echo "Copying unsigned APK anyway -> $DEST"
  cp "$UNSIGNED_APK" "$DEST"
  echo "✔ Done (unsigned): $DEST"
else
  echo "ERROR: No release APK found in $RELEASE_APK_DIR" >&2
  ls -la "$RELEASE_APK_DIR" 2>&1 || echo "(directory does not exist — gradle did not produce a release artifact)"
  exit 1
fi
