# Auto Mode Router v1 Current Baseline

Run date: 2026-04-28 16:27 CST

## Setup
- Dataset: `evals/router/auto-mode-router-v1.jsonl`
- Case count: 25
- Runtime store: temporary `ORA_RUNTIME_STORE_DIR`
- Objective:
  - `kind`: `classification`
  - `target`: `runtime.mode_selection`
  - `metrics`: `exact_match`, `acceptable_match`, `assertion_pass_rate`, `confidence_calibration`
- Run config:
  - `pattern`: `orchestrator_subagent`
  - `modeSelection`: `auto`
  - `metadata.evaluationRouterOnly`: `true`
- Provider config: none injected. Current environment did not expose LLM provider API keys, so Ora used the current default provider path.

## Result
- Total cases: 25
- Overall score: 0.4565
- Pass rate: 0.28
- Exact accuracy: 0.28
- Acceptable accuracy: 0.28
- Assertion pass average: 0.36
- Confidence calibration average: 0.8

## Router Behavior
- Selected mode counts:
  - `single_agent`: 25
- Router status counts:
  - `fallback`: 25
- Expected preferred counts:
  - `single_agent`: 7
  - `generator_verifier`: 3
  - `orchestrator_subagent`: 3
  - `deerflow_harness`: 3
  - `agent_teams`: 3
  - `message_bus`: 3
  - `shared_state`: 3

## Slice Results
- Acceptable accuracy by difficulty:
  - easy: 1.0
  - medium: 0.0769
  - hard: 0.0
- Acceptable accuracy by ambiguity:
  - low: 0.2
  - medium: 0.3333
  - high: 1.0

## Failure Tags
- `wrong_value`: 18
- `wrong_mode`: 17
- `under_delegated`: 5
- `miscalibrated_confidence`: 5
- `wrong_coordination`: 3
- `under_teamed`: 2
- `under_verified`: 1
- `under_routed`: 1
- `under_persistent`: 1

## Conclusion
The current Auto Mode Router is not precise enough in this environment.

The important failure is not subtle classification confusion between adjacent modes. The router never produced a selected route at all: every case fell back and every case resolved to `single_agent`. That made ambiguous/simple cases pass, but all medium/hard and specialized mode cases failed.

This should be treated as a readiness failure for auto mode under the current runtime configuration. Before evaluating model-level routing quality, Ora needs a configured router-capable provider for auto mode runs, or a product-level rule that prevents Auto Mode from presenting itself as intelligent routing when only `local-smoke`/fallback behavior is available.

## Rerun Command Shape
Use the same dataset after configuring a real provider:

```bash
export ORA_RUNTIME_STORE_DIR="$(mktemp -d)/store"
pnpm --filter @ora/runtime exec tsx src/cli.ts eval import \
  --file evals/router/auto-mode-router-v1.jsonl \
  --format jsonl \
  --name "Auto Mode Router v1" \
  --tags router,auto-mode
```

Then run an `evaluation.runs.start` spec with:

```json
{
  "objective": {
    "kind": "classification",
    "target": "runtime.mode_selection",
    "metrics": ["exact_match", "acceptable_match", "assertion_pass_rate", "confidence_calibration"]
  },
  "configs": [{
    "id": "auto-router-current",
    "label": "Current Auto Router",
    "runConfig": {
      "pattern": "orchestrator_subagent",
      "modeSelection": "auto",
      "providerId": "<real-provider-id>",
      "modelRef": "<real-model>",
      "providerConfig": "<real provider config>",
      "metadata": {
        "evaluationRouterOnly": true,
        "providerId": "<real-provider-id>"
      }
    }
  }]
}
```
