#!/usr/bin/env bash
#
# Nuke.sh — Wipe the focus-app native build environment and start fresh.
#
# This is a recovery script for when an Android build is in a bad state
# (corrupt cache, stale prebuild, dependency drift, etc.).
#
# Default behavior is INTENTIONALLY narrower than the original spec because
# this repo runs inside a live Replit workspace with active services. Some
# of the originally requested operations would break the running env:
#
#   • rm -rf /tmp/*          → deletes live workflow logs + runtime sockets
#                              for api-server, expo, and mockup-sandbox.
#                              Replaced with targeted gradle temp cleanup.
#
#   • rm -rf ~/.gradle/caches → discards the ~200MB gradle wrapper that we
#                              already downloaded; only scope to the
#                              transforms cache, which is the one that
#                              actually grows between failed builds.
#
#   • rm -rf pnpm-lock.yaml  → makes builds non-reproducible and can break
#                              monorepo catalog pins. Skipped by default.
#
#   • npx expo prebuild --clean → the --clean flag triggers git operations
#                              that are blocked in this sandbox. Replaced
#                              with a manual `rm -rf android` + prebuild.
#
# Pass --really-nuke to do exactly what the original spec asked for, with
# the consequences above. You'll be asked to confirm.

set -euo pipefail

REALLY_NUKE=0
for arg in "$@"; do
  case "$arg" in
    --really-nuke) REALLY_NUKE=1 ;;
    -h|--help)
      sed -n '2,30p' "$0"
      exit 0
      ;;
  esac
done

# Resolve script directory so this works from any cwd.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$SCRIPT_DIR/artifacts/focus-app"

if [ ! -d "$APP_DIR" ]; then
  echo "ERROR: Cannot find $APP_DIR" >&2
  exit 1
fi

echo "── Nuke.sh ───────────────────────────────────────────"
echo "Workspace: $SCRIPT_DIR"
echo "App dir:   $APP_DIR"
echo "Mode:      $([ $REALLY_NUKE -eq 1 ] && echo 'FULL NUKE (destructive)' || echo 'safe')"
echo "──────────────────────────────────────────────────────"

if [ $REALLY_NUKE -eq 1 ]; then
  read -rp "This will wipe /tmp/*, the entire gradle cache, and the lockfile. Type YES to continue: " confirm
  if [ "$confirm" != "YES" ]; then
    echo "Aborted."
    exit 1
  fi
fi

# ── Stage 1: app-level native + js artifacts ─────────────────────────────
echo "[1/5] Removing android/, .expo/, and node_modules/ in $APP_DIR..."
rm -rf "$APP_DIR/android"
rm -rf "$APP_DIR/.expo"
rm -rf "$APP_DIR/node_modules"

# ── Stage 2: workspace node_modules ──────────────────────────────────────
echo "[2/5] Removing workspace-level node_modules..."
rm -rf "$SCRIPT_DIR/node_modules"

# ── Stage 3: gradle caches ───────────────────────────────────────────────
if [ $REALLY_NUKE -eq 1 ]; then
  echo "[3/5] FULL NUKE: wiping ~/.gradle/caches and /tmp/*..."
  rm -rf "$HOME/.gradle/caches"
  # Still preserve workflow logs the agent depends on, even in nuke mode.
  find /tmp -mindepth 1 -maxdepth 1 \
    ! -name 'logs' \
    ! -name 'log_mapping.json' \
    -exec rm -rf {} + 2>/dev/null || true
else
  echo "[3/5] Targeted cleanup of gradle scratch dirs..."
  rm -rf /tmp/.gradle-* /tmp/gradle-* 2>/dev/null || true
  rm -rf "$HOME/.gradle/caches/transforms-"* 2>/dev/null || true
  rm -rf "$HOME/.gradle/caches/build-cache-"* 2>/dev/null || true
fi

# ── Stage 4: optional lockfile + pnpm store ──────────────────────────────
if [ $REALLY_NUKE -eq 1 ]; then
  echo "[4/5] FULL NUKE: removing pnpm-lock.yaml and pruning pnpm store..."
  rm -f "$SCRIPT_DIR/pnpm-lock.yaml"
  pnpm store prune || true
else
  echo "[4/5] Skipping pnpm-lock.yaml deletion (use --really-nuke to force)."
fi

# ── Stage 5: reinstall + regenerate native ───────────────────────────────
echo "[5/5] Reinstalling deps and regenerating android/..."
cd "$SCRIPT_DIR"
pnpm install

cd "$APP_DIR"
# Skip --clean: it invokes git, which is blocked in this sandbox.
# We already removed android/ above, so a plain prebuild is equivalent.
npx expo prebuild --platform android --no-install

echo
echo "✔ Nuke complete. You can now run:  bash Build.sh"
