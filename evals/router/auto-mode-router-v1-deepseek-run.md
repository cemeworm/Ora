# Auto Mode Router v1 DeepSeek Run

Latest run date: 2026-04-28 17:27 CST

## Setup
- Dataset: `evals/router/auto-mode-router-v1.jsonl`
- Spec: `evals/router/auto-mode-router-v1-deepseek.spec.json`
- Runtime store: temporary `ORA_RUNTIME_STORE_DIR=/tmp/ora-router-deepseek-iter-iEpKNS/store`
- Provider:
  - `providerId`: `deepseek`
  - `type`: `openai_compatible`
  - `modelRef`: `deepseek-v4-flash`
  - `baseUrl`: `https://api.deepseek.com`
  - `apiKeyEnv`: `DEEPSEEK_API_KEY`
- Objective:
  - `kind`: `classification`
  - `target`: `runtime.mode_selection`
  - `metrics`: `exact_match`, `acceptable_match`, `assertion_pass_rate`, `fallback_rate`, `confidence_calibration`
- Run config:
  - `pattern`: `orchestrator_subagent`
  - `modeSelection`: `auto`
  - `metadata.evaluationRouterOnly`: `true`

## Result
- Evaluation run: `eval-run-0001`
- Total cases: 25
- Overall score: 0.961
- Pass rate: 1.0
- Average runtime: 4561 ms

## Router Behavior
- Router status counts:
  - `selected`: 23
  - `fallback`: 2
- Selected mode counts:
  - `single_agent`: 7
  - `generator_verifier`: 3
  - `orchestrator_subagent`: 3
  - `deerflow_harness`: 3
  - `agent_teams`: 3
  - `message_bus`: 3
  - `shared_state`: 3

## Failure Tags
- `fallback_route`: 2

## Notes
- This run proves the evaluation spec can route through a real DeepSeek provider rather than `local-smoke`.
- After the runtime router hardening pass, the only remaining fallbacks are the two intentionally ambiguous cases:
  - `router-ambiguous-001`: `Router confidence 0.3 was below 0.55.`
  - `router-ambiguous-002`: `Router confidence 0.15 was below 0.55.`
- No run selected `mode_studio_builder`; internal modes are no longer exposed as Auto router candidates.
- The previous provider-backed baseline was `overallScore=0.6255`, `passRate=0.48`, `selected=15`, `fallback=10`, and included one `mode_studio_builder` selection.

## Commands
```bash
export ORA_RUNTIME_STORE_DIR=/tmp/ora-router-deepseek-iter-iEpKNS/store
pnpm --filter @ora/runtime exec tsx src/cli.ts eval import \
  --file /Users/quintenchen/developer/ora/evals/router/auto-mode-router-v1.jsonl \
  --format jsonl \
  --name "Auto Mode Router v1 DeepSeek Iteration" \
  --tags router,auto-mode,deepseek

pnpm --filter @ora/runtime exec tsx src/cli.ts eval run \
  --spec /Users/quintenchen/developer/ora/evals/router/auto-mode-router-v1-deepseek.spec.json
```
