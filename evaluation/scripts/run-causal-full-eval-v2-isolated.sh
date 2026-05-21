#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CLI="$PROJECT_ROOT/apps/runtime/dist/cli.js"
DATASET_FILE="${DATASET_FILE:-$PROJECT_ROOT/evaluation/datasets/causal-intervention-decision-dataset.json}"
SPEC_TEMPLATE="${SPEC_TEMPLATE:-$PROJECT_ROOT/evaluation/specs/causal-full-two-way.json}"
NODE_BIN="${NODE_BIN:-node}"

STORE_ROOT="${1:-/private/tmp/ora-causal-full-eval-v2-$(date +%Y%m%d-%H%M%S)}"
STORE_DB="$STORE_ROOT/runtime.db"
LOCAL_SPEC="$STORE_ROOT/causal-full-eval-v2.local.json"
RUN_OUTPUT="$STORE_ROOT/eval-run-output.json"
REPORT_MD="$STORE_ROOT/eval-report.md"
REPORT_JSON="$STORE_ROOT/eval-report.json"

if [[ -z "${DEEPSEEK_API_KEY:-}" ]]; then
  echo "DEEPSEEK_API_KEY is required." >&2
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
      name: "causal-intervention-decision-dataset",
    });
    process.stdout.write(String(detail.dataset.id));
  ' "$STORE_DB" "$DATASET_FILE"
)"

"$NODE_BIN" -e '
  const fs = require("node:fs");
  const [specPath, outputPath, datasetId] = process.argv.slice(1);
  const spec = JSON.parse(fs.readFileSync(specPath, "utf8"));
  spec.datasetId = datasetId;
  spec.metadata = {
    ...(spec.metadata ?? {}),
    evalV2Reporting: true,
    description: `${spec.metadata?.description ?? ""} [eval_v2_reporting enabled]`.trim(),
  };
  fs.writeFileSync(outputPath, JSON.stringify(spec, null, 2));
' "$SPEC_TEMPLATE" "$LOCAL_SPEC" "$DATASET_ID"

ORA_RUNTIME_STORE_DIR="$STORE_DB" \
  "$NODE_BIN" "$CLI" eval run --spec "$LOCAL_SPEC" > "$RUN_OUTPUT"

RUN_ID="$(
  "$NODE_BIN" -e '
    const fs = require("node:fs");
    const data = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    process.stdout.write(String(data?.run?.id ?? data?.evaluationRunId ?? data?.id ?? ""));
  ' "$RUN_OUTPUT"
)"

if [[ -z "$RUN_ID" ]]; then
  echo "Failed to resolve evaluation run id." >&2
  exit 1
fi

ORA_RUNTIME_STORE_DIR="$STORE_DB" \
  "$NODE_BIN" "$CLI" eval report --run "$RUN_ID" --format markdown --output "$REPORT_MD" >/dev/null

ORA_RUNTIME_STORE_DIR="$STORE_DB" \
  "$NODE_BIN" "$CLI" eval report --run "$RUN_ID" --format json --output "$REPORT_JSON" >/dev/null

echo "RUN_ID=$RUN_ID"
echo "STORE_DB=$STORE_DB"
echo "LOCAL_SPEC=$LOCAL_SPEC"
echo "RUN_OUTPUT=$RUN_OUTPUT"
echo "REPORT_MD=$REPORT_MD"
echo "REPORT_JSON=$REPORT_JSON"
