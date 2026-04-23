#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VITE_PATTERN='vite --host 127.0.0.1 --port 1420'
TAURI_PATTERN='@tauri-apps/cli/tauri.js dev'
DESKTOP_PATTERN='target/debug/ora-desktop'

if [ -f "$HOME/.cargo/env" ]; then
  # Tauri CLI depends on Cargo being on PATH in local dev.
  # shellcheck disable=SC1090
  source "$HOME/.cargo/env"
fi

cleanup_stale_dev_processes() {
  pkill -f "$VITE_PATTERN" >/dev/null 2>&1 || true
  pkill -f "$TAURI_PATTERN" >/dev/null 2>&1 || true
  pkill -f "$DESKTOP_PATTERN" >/dev/null 2>&1 || true
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
exec pnpm --filter @ora/desktop tauri dev
