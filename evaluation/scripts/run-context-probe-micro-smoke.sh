#!/usr/bin/env bash
set -euo pipefail

# context_probe policy micro smoke: 极简 fixture，60s timeout，三种 config 对比
# 用法: DEEPSEEK_API_KEY=... ./evaluation/scripts/run-context-probe-micro-smoke.sh [/tmp/output-dir]

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CLI="$PROJECT_ROOT/apps/runtime/dist/cli.js"
DATASET_FILE="$PROJECT_ROOT/evaluation/datasets/causal-context-probe-micro-smoke-dataset.json"
SPEC_TEMPLATE="$PROJECT_ROOT/evaluation/specs/causal-context-probe-micro-smoke-three-way.json"
NODE_BIN="${NODE_BIN:-node}"

STORE_ROOT="${1:-/private/tmp/ora-context-probe-micro-smoke-$(date +%Y%m%d-%H%M%S)}"
STORE_DB="$STORE_ROOT/runtime.db"
LOCAL_SPEC="$STORE_ROOT/context-probe-micro-smoke.local.json"
RUN_OUTPUT="$STORE_ROOT/eval-run-output.json"

if [[ -z "${DEEPSEEK_API_KEY:-}" ]]; then
  echo "DEEPSEEK_API_KEY is required." >&2
  echo "Example: DEEPSEEK_API_KEY=... $0" >&2
  exit 1
fi

mkdir -p "$STORE_ROOT"

DATASET_ID="$(
  "$NODE_BIN" -e '
    const fs = require("node:fs");
    const path = require("node:path");
    const { LocalEvaluationStore } = require("./apps/runtime/dist/evaluation-store.js");
    const [storeDb, datasetFile] = process.argv.slice(1);
    const store = new LocalEvaluationStore(storeDb);
    const content = fs.readFileSync(datasetFile, "utf8");
    const detail = store.importDataset({
      content,
      sourceFileName: path.basename(datasetFile),
      sourceFormat: "json",
      name: "causal-context-probe-micro-smoke-dataset",
    });
    process.stdout.write(String(detail.dataset.id));
  ' "$STORE_DB" "$DATASET_FILE"
)"

if [[ -z "$DATASET_ID" ]]; then
  echo "Failed to resolve imported dataset id." >&2
  exit 1
fi

"$NODE_BIN" -e '
  const fs = require("node:fs");
  const [specPath, outputPath, datasetId] = process.argv.slice(1);
  const spec = JSON.parse(fs.readFileSync(specPath, "utf8"));
  spec.datasetId = datasetId;
  fs.writeFileSync(outputPath, JSON.stringify(spec, null, 2));
' "$SPEC_TEMPLATE" "$LOCAL_SPEC" "$DATASET_ID"

ORA_RUNTIME_STORE_DIR="$STORE_DB" \
  "$NODE_BIN" "$CLI" eval run --spec "$LOCAL_SPEC" | tee "$RUN_OUTPUT"

echo
echo "Store: $STORE_DB"
echo "Spec: $LOCAL_SPEC"
echo "Output: $RUN_OUTPUT"
