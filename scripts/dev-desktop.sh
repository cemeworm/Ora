#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VITE_PATTERN='vite --host 127.0.0.1 --port 1420'
TAURI_PATTERN='@tauri-apps/cli/tauri.js dev'
DESKTOP_PATTERN='target/debug/ora-desktop'
DESKTOP_BUNDLE_PATTERN='target/release/bundle/macos/Ora.app/Contents/MacOS/ora-desktop'
ORA_BUNDLE_ID='dev.ora.workbench'
PNPM_STATE_FILE="$ROOT_DIR/node_modules/.modules.yaml"
RUNTIME_SIDECAR_DIR="$ROOT_DIR/apps/desktop/src-tauri/resources/runtime-sidecar"
LANGFUSE_RESOURCE_DIR="$ROOT_DIR/apps/desktop/src-tauri/resources/langfuse"

if [ -f "$HOME/.cargo/env" ]; then
  # Tauri CLI depends on Cargo being on PATH in local dev.
  # shellcheck disable=SC1090
  source "$HOME/.cargo/env"
fi

quit_installed_ora_app() {
  osascript <<APPLESCRIPT >/dev/null 2>&1 || true
tell application id "$ORA_BUNDLE_ID"
  if running then quit
end tell
APPLESCRIPT
}

cleanup_stale_dev_processes() {
  quit_installed_ora_app
  pkill -f "$VITE_PATTERN" >/dev/null 2>&1 || true
  pkill -f "$TAURI_PATTERN" >/dev/null 2>&1 || true
  pkill -f "$DESKTOP_PATTERN" >/dev/null 2>&1 || true
  pkill -f "$DESKTOP_BUNDLE_PATTERN" >/dev/null 2>&1 || true
}

needs_pnpm_install() {
  [ ! -f "$PNPM_STATE_FILE" ] && return 0
  [ "$ROOT_DIR/pnpm-lock.yaml" -nt "$PNPM_STATE_FILE" ] && return 0
  [ "$ROOT_DIR/package.json" -nt "$PNPM_STATE_FILE" ] && return 0
  [ "$ROOT_DIR/apps/desktop/package.json" -nt "$PNPM_STATE_FILE" ] && return 0
  [ "$ROOT_DIR/apps/runtime/package.json" -nt "$PNPM_STATE_FILE" ] && return 0
  return 1
}

cleanup_stale_dev_processes

for _ in 1 2 3 4 5; do
  if ! lsof -nP -iTCP:1420 -sTCP:LISTEN >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

if lsof -nP -iTCP:1420 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port 1420 is still in use after cleaning stale dev processes. Stop the existing listener, then retry." >&2
  exit 1
fi

cd "$ROOT_DIR"

if needs_pnpm_install; then
  echo "Installing workspace dependencies to match the current lockfile..."
  pnpm install --frozen-lockfile
fi

echo "Packaging the runtime sidecar for Tauri dev..."
pnpm --filter @ora/runtime package:sidecar

if [ ! -d "$RUNTIME_SIDECAR_DIR" ]; then
  echo "Expected packaged runtime sidecar at $RUNTIME_SIDECAR_DIR, but it was not created." >&2
  exit 1
fi

if [ ! -f "$LANGFUSE_RESOURCE_DIR/docker-compose.yml" ]; then
  echo "Expected managed Langfuse compose resource at $LANGFUSE_RESOURCE_DIR/docker-compose.yml, but it was not created." >&2
  exit 1
fi

exec pnpm --filter @ora/desktop tauri dev
