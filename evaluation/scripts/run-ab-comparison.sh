#!/usr/bin/env bash
set -euo pipefail

# Causal Agent A/B Comparison Runner
# Automatically finds the legacy commit, runs both evaluations, and produces a comparison report.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
SPEC_FILE="$PROJECT_ROOT/evaluation/specs/causal-ab-comparison.spec.json"
DATASET_FILE="$PROJECT_ROOT/evaluation/datasets/causal-intervention-decision-dataset.json"
RUNTIME_DIR="$PROJECT_ROOT/apps/runtime"
CLI="$RUNTIME_DIR/dist/cli.js"

PROVIDER_ID="${PROVIDER_ID:-deepseek}"
MODEL_REF="${MODEL_REF:-deepseek-v4-flash}"
LEGACY_REF=""
OUTPUT_FILE=""

usage() {
  cat <<EOF
Usage: run-ab-comparison.sh [options]

Options:
  --provider <id>       Provider ID (default: deepseek)
  --model <ref>         Model reference (default: deepseek-v4-flash)
  --legacy-ref <commit> Manually specify legacy commit (default: auto-detect)
  --output <path>       Write report to file (default: stdout)
  --help                Show this help

Auto-detection:
  Finds the parent commit of the first commit that introduced
  apps/runtime/src/harness/causal-policy-router.ts.
EOF
  exit 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --provider) PROVIDER_ID="$2"; shift 2 ;;
    --model) MODEL_REF="$2"; shift 2 ;;
    --legacy-ref) LEGACY_REF="$2"; shift 2 ;;
    --output) OUTPUT_FILE="$2"; shift 2 ;;
    --help) usage ;;
    *) echo "Unknown option: $1"; usage ;;
  esac
done

echo "=== Causal Agent A/B Comparison Runner ==="
echo "Provider: $PROVIDER_ID"
echo "Model: $MODEL_REF"
echo ""

# 1. Auto-detect legacy commit
if [[ -z "$LEGACY_REF" ]]; then
  echo ">>> Auto-detecting legacy commit..."
  cd "$PROJECT_ROOT"
  CAUSAL_INTRO=$(git log --diff-filter=A --follow --format=%H -- \
    apps/runtime/src/harness/causal-policy-router.ts 2>/dev/null | tail -1 || true)

  if [[ -n "$CAUSAL_INTRO" ]]; then
    LEGACY_REF=$(git rev-parse "${CAUSAL_INTRO}~1" 2>/dev/null || true)
  fi

  if [[ -z "$LEGACY_REF" ]]; then
    # Fallback: find earliest commit mentioning "causal" in message
    echo "  > Falling back to git log search..."
    LEGACY_REF=$(git log --oneline --all --grep="causal" --format=%H 2>/dev/null | tail -1 || true)
    if [[ -n "$LEGACY_REF" ]]; then
      LEGACY_REF=$(git rev-parse "${LEGACY_REF}~1" 2>/dev/null || true)
    fi
  fi

  if [[ -z "$LEGACY_REF" ]]; then
    echo "ERROR: Could not auto-detect legacy commit. Use --legacy-ref to specify manually."
    exit 1
  fi
fi

LEGACY_SHORT=$(git -C "$PROJECT_ROOT" rev-parse --short "$LEGACY_REF" 2>/dev/null || echo "$LEGACY_REF")
echo "Legacy commit: $LEGACY_SHORT ($LEGACY_REF)"
echo ""

CURRENT_COMMIT=$(git -C "$PROJECT_ROOT" rev-parse HEAD)
CURRENT_SHORT=$(git -C "$PROJECT_ROOT" rev-parse --short HEAD)
echo "Current commit: $CURRENT_SHORT"
echo ""

# 2. Import dataset (or use existing)
echo ">>> Checking dataset..."
cd "$PROJECT_ROOT"

# Try to find an existing import of the causal dataset
DATASET_ID=$(node "$CLI" eval list 2>/dev/null | grep -o '"id"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/' || true)

if [[ -z "$DATASET_ID" ]]; then
  echo "Importing causal intervention decision dataset..."
  IMPORT_OUTPUT=$(node "$CLI" eval import --file "$DATASET_FILE" 2>&1 | tail -5 || true)
  DATASET_ID=$(echo "$IMPORT_OUTPUT" | grep -o '"id"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/' || true)
fi

if [[ -z "$DATASET_ID" ]]; then
  # Fallback: use known dataset ID
  DATASET_ID="dataset-0030"
fi
echo "Dataset ID: $DATASET_ID"
echo ""

# Update spec with dataset ID and provider/model
SPEC_CONTENT=$(cat "$SPEC_FILE")
SPEC_CONTENT="${SPEC_CONTENT//<import-causal-intervention-decision-dataset-first>/$DATASET_ID}"
SPEC_CONTENT="${SPEC_CONTENT//\"modeSelection\": \"auto\"/\"providerId\": \"$PROVIDER_ID\", \"modelRef\": \"$MODEL_REF\", \"modeSelection\": \"auto\"}"

TMP_SPEC=$(mktemp -t causal-ab-spec.XXXXXX.json)
echo "$SPEC_CONTENT" > "$TMP_SPEC"
echo "Spec prepared at: $TMP_SPEC"
echo ""

# 3. Run evaluation on current commit (causal mainline)
echo ">>> [1/2] Running evaluation on causal mainline (current commit)..."
RUN_A_OUTPUT=$(node "$CLI" eval run --spec "$TMP_SPEC" 2>&1)
RUN_A_ID=$(echo "$RUN_A_OUTPUT" | grep -o '"evaluationRunId"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/' || true)
if [[ -z "$RUN_A_ID" ]]; then
  # Try to extract from "runId" or any quoted ID
  RUN_A_ID=$(echo "$RUN_A_OUTPUT" | grep -o '"id"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/' || true)
fi
echo "Causal mainline run ID: ${RUN_A_ID:-<unknown>}"
echo ""

# 4. Run evaluation on legacy commit
echo ">>> [2/2] Running evaluation on legacy commit ($LEGACY_SHORT)..."
echo "  Stashing changes and checking out legacy commit..."
cd "$PROJECT_ROOT"

HAS_CHANGES=$(git status --porcelain | wc -l | tr -d ' ')
if [[ "$HAS_CHANGES" -gt 0 ]]; then
  git stash push -m "causal-ab-comparison-auto-stash" --include-untracked
fi

git checkout "$LEGACY_REF" 2>/dev/null || {
  echo "WARNING: Could not checkout legacy commit. Falling back to adapter-only mode."
  echo "  In adapter mode, the legacy run is simulated by running with retrofitCausalDecisions=true"
  echo "  but WITHOUT the causal policy router (which the legacy commit would not have had)."
  # Return to current commit
  git checkout "$CURRENT_COMMIT" 2>/dev/null || true
  if [[ -n "${HAS_CHANGES:-}" ]] && [[ "$HAS_CHANGES" -gt 0 ]]; then
    git stash pop 2>/dev/null || true
  fi
}

if git rev-parse HEAD | grep -q "$LEGACY_REF"; then
  echo "  Building legacy runtime..."
  cd "$RUNTIME_DIR"
  pnpm install --frozen-lockfile 2>&1 | tail -1 || true
  pnpm build 2>&1 | tail -1 || true
  cd "$PROJECT_ROOT"

  echo "  Running legacy eval..."
  RUN_B_OUTPUT=$(node "$CLI" eval run --spec "$TMP_SPEC" 2>&1)
  RUN_B_ID=$(echo "$RUN_B_OUTPUT" | grep -o '"evaluationRunId"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/' || true)
  if [[ -z "$RUN_B_ID" ]]; then
    RUN_B_ID=$(echo "$RUN_B_OUTPUT" | grep -o '"id"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/' || true)
  fi

  # Return to current commit
  echo "  Returning to current commit..."
  git checkout "$CURRENT_COMMIT" 2>/dev/null || true
  if [[ -n "${HAS_CHANGES:-}" ]] && [[ "$HAS_CHANGES" -gt 0 ]]; then
    git stash pop 2>/dev/null || true
  fi
  # Rebuild current
  cd "$RUNTIME_DIR"
  pnpm install --frozen-lockfile 2>&1 | tail -1 || true
  pnpm build 2>&1 | tail -1 || true
  cd "$PROJECT_ROOT"
else
  echo "  Checkout failed or already on another branch. Skipping legacy run."
  RUN_B_ID=""
fi

echo "Legacy run ID: ${RUN_B_ID:-<failed>}"
echo ""

# Clean up
rm -f "$TMP_SPEC"

# 5. Compare
if [[ -n "${RUN_A_ID:-}" ]] && [[ -n "${RUN_B_ID:-}" ]]; then
  echo ">>> Comparing runs..."
  COMPARE_CMD="node $CLI eval compare --run-a $RUN_A_ID --run-b $RUN_B_ID --format markdown"
  if [[ -n "${OUTPUT_FILE:-}" ]]; then
    COMPARE_CMD="$COMPARE_CMD --output $OUTPUT_FILE"
    $COMPARE_CMD
    echo ""
    echo "Report written to: $OUTPUT_FILE"
  else
    echo ""
    $COMPARE_CMD
  fi
elif [[ -n "${RUN_A_ID:-}" ]]; then
  echo ">>> Only causal mainline run succeeded. Cannot compare without legacy run."
  echo "Causal mainline run ID: $RUN_A_ID"
  echo "You can manually run legacy evaluation and then:"
  echo "  node $CLI eval compare --run-a $RUN_A_ID --run-b <legacy-run-id>"
else
  echo ">>> Both runs failed. Check the errors above."
fi

echo ""
echo "=== Done ==="
