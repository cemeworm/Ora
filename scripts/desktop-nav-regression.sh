#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAW_PROCESS_PATTERN='target/debug/ora-desktop'

if ! pgrep -f "$RAW_PROCESS_PATTERN" >/dev/null 2>&1; then
  bash "$SCRIPT_DIR/dev-desktop.sh" >/tmp/ora-desktop-regression.log 2>&1 &
fi

for _ in $(seq 1 60); do
  if pgrep -f "$RAW_PROCESS_PATTERN" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

if ! pgrep -f "$RAW_PROCESS_PATTERN" >/dev/null 2>&1; then
  echo "Timed out waiting for target/debug/ora-desktop." >&2
  exit 1
fi

swift "$SCRIPT_DIR/desktop-nav-regression.swift"
