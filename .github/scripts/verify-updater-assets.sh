#!/usr/bin/env bash
set -euo pipefail

TAG="${TAG:?TAG is required}"
MANIFEST_URL="${MANIFEST_URL:-https://github.com/${GITHUB_REPOSITORY}/releases/download/${TAG}/latest.json}"
RELEASE_API_URL="${RELEASE_API_URL:-https://api.github.com/repos/${GITHUB_REPOSITORY}/releases/tags/${TAG}}"
API_JSON="release.json"

curl_json() {
  if [ -n "${GH_TOKEN:-}" ]; then
    curl -s \
      -H "Authorization: Bearer ${GH_TOKEN}" \
      -H "Accept: application/vnd.github+json" \
      "$1"
  else
    curl -s \
      -H "Accept: application/vnd.github+json" \
      "$1"
  fi
}

echo "Checking updater manifest: $MANIFEST_URL"
HTTP_CODE="$(curl -s -L -o latest.json -w '%{http_code}' "$MANIFEST_URL")"
if [ "$HTTP_CODE" != "200" ]; then
  echo "::error::latest.json is missing or inaccessible (HTTP $HTTP_CODE)"
  exit 1
fi

python3 - <<'PY'
import json
import os
import sys
from pathlib import Path

tag = os.environ["TAG"].lstrip("v")
data = json.loads(Path("latest.json").read_text())
version = data.get("version")
if version != tag:
    sys.exit(f"latest.json version mismatch: expected {tag}, got {version!r}")

platforms = data.get("platforms")
if not isinstance(platforms, dict) or not platforms:
    sys.exit("latest.json platforms map is missing or empty")

matching_keys = [key for key in platforms if "darwin" in key]
if not matching_keys:
    sys.exit(f"latest.json does not contain a darwin platform entry: {list(platforms)}")

for key in matching_keys:
    entry = platforms.get(key) or {}
    url = entry.get("url")
    signature = entry.get("signature")
    if not isinstance(url, str) or not url.strip():
        sys.exit(f"platform {key} is missing url")
    if not isinstance(signature, str) or not signature.strip():
        sys.exit(f"platform {key} is missing signature")
PY

echo "Checking release asset inventory"
curl_json "$RELEASE_API_URL" > "$API_JSON"

jq -e '
  if (.assets | type) != "array" then
    error(.message // "release API response is missing assets")
  else
    .
  end
  | .assets as $assets
  | ($assets | map(.name)) as $names
  | ($names | index("latest.json")) != null
  and (($names | map(select(test("\\.app\\.tar\\.gz$"))) | length) > 0)
  and (($names | map(select(test("\\.app\\.tar\\.gz\\.sig$"))) | length) > 0)
  and (($names | map(select(test("\\.dmg$"))) | length) > 0)
 ' "$API_JSON" > /dev/null

APP_TARBALL_URL="$(python3 - <<'PY'
import json
from pathlib import Path

data = json.loads(Path("latest.json").read_text())
platforms = data["platforms"]
for key in sorted(platforms):
    if "darwin" in key:
        url = (platforms[key] or {}).get("url")
        if isinstance(url, str) and url.strip():
            print(url.strip())
            break
else:
    raise SystemExit("No darwin updater tarball URL found in latest.json")
PY
)"

echo "Checking bundled build metadata from $APP_TARBALL_URL"
curl -s -L -o Ora.app.tar.gz "$APP_TARBALL_URL"
tar -xOf Ora.app.tar.gz Ora.app/Contents/Resources/build-meta.json > build-meta.json

python3 - <<'PY'
import json
import os
import subprocess
import sys
from pathlib import Path

tag = os.environ["TAG"]
expected_tag = tag
expected_version = tag.lstrip("v")
expected_commit = subprocess.check_output(
    ["git", "rev-list", "-n", "1", tag],
    text=True,
).strip()

data = json.loads(Path("build-meta.json").read_text())

if data.get("version") != expected_version:
    sys.exit(
        f"build-meta.json version mismatch: expected {expected_version}, got {data.get('version')!r}"
    )
if data.get("tag") != expected_tag:
    sys.exit(f"build-meta.json tag mismatch: expected {expected_tag}, got {data.get('tag')!r}")
if data.get("commit") != expected_commit:
    sys.exit(
        f"build-meta.json commit mismatch: expected {expected_commit}, got {data.get('commit')!r}"
    )
if not isinstance(data.get("builtAt"), str) or not data["builtAt"].strip():
    sys.exit("build-meta.json builtAt is missing")
if not isinstance(data.get("workflow"), str) or not data["workflow"].strip():
    sys.exit("build-meta.json workflow is missing")
PY
