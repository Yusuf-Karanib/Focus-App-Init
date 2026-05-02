#!/usr/bin/env bash
set -euo pipefail

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
sdkmanager \
  "platform-tools" \
  "platforms;android-35" \
  "build-tools;35.0.0"

echo "Android SDK ready at: $ANDROID_SDK_ROOT"

# ── Gradle build ─────────────────────────────────────────────────────────────
ANDROID_PROJECT_DIR="${ANDROID_PROJECT_DIR:-artifacts/focus-app/android}"
echo "Building from: $ANDROID_PROJECT_DIR"
cd "$ANDROID_PROJECT_DIR"

GRADLE_OPTS="-Xmx1024m -XX:-UsePerfData" \
  ./gradlew assembleDebug \
    --max-workers=1 \
    --no-daemon
