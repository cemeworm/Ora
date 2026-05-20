#!/usr/bin/env bash
set -euo pipefail

BUNDLE_ROOT="${BUNDLE_ROOT:-apps/desktop/src-tauri/target}"
FIX_SCRIPT="${FIX_SCRIPT:-apps/desktop/resources/fix-quarantine.command}"
RELEASE_ID="${RELEASE_ID:?RELEASE_ID is required}"
TAG="${TAG:?TAG is required}"

if [ ! -f "$FIX_SCRIPT" ]; then
  echo "::error::fix-quarantine.command missing: $FIX_SCRIPT"
  exit 1
fi

DMG_COUNT="$(find "$BUNDLE_ROOT" -type f -name "*.dmg" | wc -l | tr -d " ")"
if [ "$DMG_COUNT" -eq 0 ]; then
  echo "::warning::No DMG found under $BUNDLE_ROOT, skipping post-processing."
  exit 0
fi

WORK_DIR="$(mktemp -d)"
echo "Working dir: $WORK_DIR"

find "$BUNDLE_ROOT" -type f -name "*.dmg" -print0 | while IFS= read -r -d '' DMG; do
  echo "::group::Post-processing $DMG"
  BASENAME="$(basename "$DMG")"
  MOUNT_DIR="$WORK_DIR/mnt-${BASENAME%.dmg}"
  STAGE_DIR="$WORK_DIR/stage-${BASENAME%.dmg}"
  REBUILT="$WORK_DIR/$BASENAME"
  mkdir -p "$MOUNT_DIR" "$STAGE_DIR"

  hdiutil attach "$DMG" -readonly -nobrowse -mountpoint "$MOUNT_DIR"

  cp -R "$MOUNT_DIR"/* "$STAGE_DIR"/ || true
  find "$MOUNT_DIR" -maxdepth 1 -name ".*" ! -name "." ! -name ".." \
    -exec cp -R {} "$STAGE_DIR"/ \; || true

  hdiutil detach "$MOUNT_DIR" -quiet

  APP_INSIDE="$(find "$STAGE_DIR" -maxdepth 2 -name "*.app" -type d | head -n1)"
  if [ -n "$APP_INSIDE" ]; then
    echo "Re-signing $APP_INSIDE with ad-hoc identity"
    codesign --force --deep --sign - "$APP_INSIDE"
    codesign --verify --deep --strict --verbose=2 "$APP_INSIDE" || true
  fi

  cp "$FIX_SCRIPT" "$STAGE_DIR/修复「已损坏」.command"
  chmod +x "$STAGE_DIR/修复「已损坏」.command"

  VOLNAME="$(basename "$DMG" .dmg)"

  hdiutil create \
    -volname "$VOLNAME" \
    -srcfolder "$STAGE_DIR" \
    -ov -format UDZO \
    "$REBUILT"

  mv "$REBUILT" "$DMG"

  ASSET_NAME="$(basename "$DMG")"
  echo "Replacing release asset: $ASSET_NAME"
  OLD_ID="$(gh api "repos/${GITHUB_REPOSITORY}/releases/${RELEASE_ID}/assets" \
    --jq ".[] | select(.name==\"${ASSET_NAME}\") | .id" | head -n1)"
  if [ -n "$OLD_ID" ]; then
    gh api -X DELETE "repos/${GITHUB_REPOSITORY}/releases/assets/${OLD_ID}" || true
  fi
  gh release upload "$TAG" "$DMG" --clobber
  echo "::endgroup::"
done
