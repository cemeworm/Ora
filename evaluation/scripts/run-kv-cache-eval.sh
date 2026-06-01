#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
RUNTIME_APP_DIR="$PROJECT_ROOT/apps/runtime"
CLI_DIST="$RUNTIME_APP_DIR/dist/cli.js"
RUNTIME_STORE="$PROJECT_ROOT/.ora/runtime.db"
RUN_STORE_MODULE="$RUNTIME_APP_DIR/src/run-store.ts"
TSX_BIN="$RUNTIME_APP_DIR/node_modules/.bin/tsx"
USE_DIST="${ORA_RUNTIME_EVAL_USE_DIST:-0}"

run_dist_cli() {
  if [[ "$USE_DIST" == "1" ]]; then
    node "$CLI_DIST" "$@"
  else
    return 1
  fi
}

MODE="${1:-real-world}"
case "$MODE" in
  real-world)
    SPEC_FILE="$PROJECT_ROOT/evaluation/specs/kv-cache-cost-eval.json"
    DATASET_FILE="$PROJECT_ROOT/evaluation/datasets/kv-cache-real-world-dataset.json"
    EXPECTED_PLACEHOLDER="<import-kv-cache-real-world-dataset-first>"
    ;;
  cause-effect)
    SPEC_FILE="$PROJECT_ROOT/evaluation/specs/kv-cache-cause-effect-eval.json"
    DATASET_FILE="$PROJECT_ROOT/evaluation/datasets/kv-cache-cause-effect-dataset.json"
    EXPECTED_PLACEHOLDER="<import-kv-cache-cause-effect-dataset-first>"
    ;;
  *)
    echo "Usage: $0 [real-world|cause-effect]" >&2
    exit 2
    ;;
esac

cd "$PROJECT_ROOT"

TMP_DIR="$(mktemp -d -t kv-cache-eval)"
TMP_SPEC="$TMP_DIR/spec.json"
TMP_RUNNER="$TMP_DIR/runner.ts"
trap 'rm -rf "$TMP_DIR"' EXIT

node - "$SPEC_FILE" "$TMP_SPEC" "$EXPECTED_PLACEHOLDER" <<'NODE'
const fs = require("fs");
const [specFile, outputFile, expectedPlaceholder] = process.argv.slice(2);
const spec = JSON.parse(fs.readFileSync(specFile, "utf8"));
if (spec.datasetId !== expectedPlaceholder) {
  throw new Error(`Unexpected kv-cache spec datasetId: ${spec.datasetId}`);
}
fs.writeFileSync(outputFile, `${JSON.stringify(spec, null, 2)}\n`, "utf8");
NODE

if [[ "$USE_DIST" == "1" ]]; then
  IMPORT_OUTPUT="$(run_dist_cli eval import --file "$DATASET_FILE")"
  DATASET_ID="$(printf '%s' "$IMPORT_OUTPUT" | node -e 'const fs=require("fs"); const input=fs.readFileSync(0,"utf8"); const parsed=JSON.parse(input); process.stdout.write(parsed.dataset.id);')"
  node - "$TMP_SPEC" "$DATASET_ID" <<'NODE'
const fs = require("fs");
const [specFile, datasetId] = process.argv.slice(2);
const spec = JSON.parse(fs.readFileSync(specFile, "utf8"));
spec.datasetId = datasetId;
fs.writeFileSync(specFile, `${JSON.stringify(spec, null, 2)}\n`, "utf8");
NODE
  run_dist_cli eval run --spec "$TMP_SPEC"
  exit 0
fi

cat > "$TMP_RUNNER" <<'TS'
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

async function main() {
  const [runtimeStore, datasetFile, specFile, runStoreModulePath] = process.argv.slice(2);
  const { LocalRunStore } = await import(pathToFileURL(runStoreModulePath).href);
  const store = new LocalRunStore({ dataDir: runtimeStore });
  const imported = store.importEvaluationDataset({
    filePath: datasetFile,
    sourceFileName: path.basename(datasetFile),
  });
  const spec = JSON.parse(fs.readFileSync(specFile, "utf8"));
  spec.datasetId = imported.dataset.id;
  const detail = await store.startEvaluationRun(spec, ({ input, config, signal, onStarted }) =>
    store.executeEvaluationRunWithLifecycle({ input, config, signal, onStarted })
  );
  process.stdout.write(`${JSON.stringify(detail, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
TS

(
  cd "$PROJECT_ROOT"
  ORA_RUNTIME_STORE_DIR="$RUNTIME_STORE" "$TSX_BIN" "$TMP_RUNNER" "$RUNTIME_STORE" "$DATASET_FILE" "$TMP_SPEC" "$RUN_STORE_MODULE"
)
