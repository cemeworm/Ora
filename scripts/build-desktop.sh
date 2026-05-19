#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUNDLE_DIR="$ROOT_DIR/apps/desktop/src-tauri/target/release/bundle"
PNPM_STATE_FILE="$ROOT_DIR/node_modules/.modules.yaml"
DEFAULT_TAURI_SIGNING_PRIVATE_KEY_PATH="$HOME/.tauri/ora-release.key"

if [ -f "$HOME/.cargo/env" ]; then
  # shellcheck disable=SC1090
  source "$HOME/.cargo/env"
fi

needs_pnpm_install() {
  [ ! -f "$PNPM_STATE_FILE" ] && return 0
  [ "$ROOT_DIR/pnpm-lock.yaml" -nt "$PNPM_STATE_FILE" ] && return 0
  [ "$ROOT_DIR/package.json" -nt "$PNPM_STATE_FILE" ] && return 0
  [ "$ROOT_DIR/apps/desktop/package.json" -nt "$PNPM_STATE_FILE" ] && return 0
  [ "$ROOT_DIR/apps/runtime/package.json" -nt "$PNPM_STATE_FILE" ] && return 0
  return 1
}

cd "$ROOT_DIR"

if needs_pnpm_install; then
  echo "Installing workspace dependencies to match the current lockfile..."
  pnpm install --frozen-lockfile
fi

CREATE_UPDATER=$(node -e "const c=require('$ROOT_DIR/apps/desktop/src-tauri/tauri.conf.json');process.stdout.write(String(c.bundle.createUpdaterArtifacts))" 2>/dev/null || echo "true")

if [ "$CREATE_UPDATER" = "true" ] && [ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" ] && [ -z "${TAURI_SIGNING_PRIVATE_KEY_PATH:-}" ] && [ -f "$DEFAULT_TAURI_SIGNING_PRIVATE_KEY_PATH" ]; then
  export TAURI_SIGNING_PRIVATE_KEY_PATH="$DEFAULT_TAURI_SIGNING_PRIVATE_KEY_PATH"
  echo "Using default Tauri updater signing key: $TAURI_SIGNING_PRIVATE_KEY_PATH"
fi

if [ "$CREATE_UPDATER" = "true" ] && [ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" ] && [ -z "${TAURI_SIGNING_PRIVATE_KEY_PATH:-}" ]; then
  echo "❌ Neither TAURI_SIGNING_PRIVATE_KEY nor TAURI_SIGNING_PRIVATE_KEY_PATH is set." >&2
  echo "   The tauri.conf.json enables createUpdaterArtifacts which requires a signing key." >&2
  echo "   Either set TAURI_SIGNING_PRIVATE_KEY or TAURI_SIGNING_PRIVATE_KEY_PATH in your environment, or" >&2
  echo "   set bundle.createUpdaterArtifacts to false in tauri.conf.json for unsigned builds." >&2
  exit 1
fi

echo "Building Ora desktop app..."
pnpm --filter @ora/desktop tauri build

echo ""
echo "Build complete. Artifacts:"

found=0

if [ -d "$BUNDLE_DIR/macos/Ora.app" ]; then
  echo "  ✅ Ora.app: $BUNDLE_DIR/macos/Ora.app"
  found=1
fi

dmg_path="$(find "$BUNDLE_DIR/dmg" -name 'Ora_*.dmg' 2>/dev/null | head -1)"
if [ -n "$dmg_path" ]; then
  echo "  ✅ $(basename "$dmg_path"): $dmg_path"
  found=1
fi

if [ "$found" -eq 0 ]; then
  echo "  ⚠️  No expected artifacts found in $BUNDLE_DIR" >&2
  exit 1
fi

if [ "${1:-}" = "--open" ]; then
  open "$BUNDLE_DIR"
fi
