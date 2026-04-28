# Auto Mode Router Contextual v1 DeepSeek Run

Latest run date: 2026-04-28 17:42 CST

## Setup
- Dataset: `evals/router/auto-mode-router-contextual-v1.jsonl`
- Spec: `evals/router/auto-mode-router-contextual-v1-deepseek.spec.json`
- Runtime store: temporary `ORA_RUNTIME_STORE_DIR=/tmp/ora-router-contextual-Jp5E7E/store`
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
- Total cases: 10
- Overall score: 0.977
- Pass rate: 1.0
- Average runtime: 5694 ms

## Router Behavior
- Router status counts:
  - `selected`: 10
- Selected mode counts:
  - `single_agent`: 2
  - `orchestrator_subagent`: 2
  - `generator_verifier`: 2
  - `agent_teams`: 1
  - `message_bus`: 1
  - `shared_state`: 1
  - `deerflow_harness`: 1

## Case Results
| Case | Selected mode | Confidence | Notes |
| --- | --- | --- | --- |
| `router-context-single-001` | `single_agent` | 0.90 | Followed current rewrite intent instead of prior DeerFlow research context. |
| `router-context-orchestrator-001` | `orchestrator_subagent` | 0.90 | Followed current root-cause debugging intent instead of prior small-edit context. |
| `router-context-generator-verifier-001` | `generator_verifier` | 0.95 | Followed current checklist-plus-rubric intent instead of prior packaging-debug context. |
| `router-context-agent-teams-001` | `agent_teams` | 0.92 | Followed current multi-day role/backlog intent instead of prior single-test-fix context. |
| `router-context-message-bus-001` | `message_bus` | 0.95 | Followed current typed event/subscriber intent instead of prior Agent Teams context. |
| `router-context-shared-state-001` | `shared_state` | 0.95 | Followed current shared blackboard intent instead of prior Message Bus context. |
| `router-context-deerflow-001` | `deerflow_harness` | 0.95 | Followed current DeerFlow comparison intent instead of prior short-explanation context. |
| `router-context-generator-verifier-002` | `generator_verifier` | 0.95 | Followed current rubric verification clarification instead of prior implementation context. |
| `router-context-single-002` | `single_agent` | 0.95 | Honored explicit "do not open multi-agent" current instruction despite prior Agent Teams context. |
| `router-context-orchestrator-002` | `orchestrator_subagent` | 0.92 | Followed current implementation-and-verification intent instead of prior brainstorm context. |

## Failure Tags
- None.

## Notes
- This contextual run specifically tests current-intent selection after prior conversation turns point at a different mode.
- The router prompt now accepts `input.context.recentMessages`, `input.context.priorMessages`, or `input.context.conversationMessages` and merges them with session conversation messages before trimming to the most recent six messages.
- The focused regression verifies these contextual messages are present in the router request body.
- The result suggests the current DeepSeek-backed Auto Mode router can follow the latest user intent in these adversarial multi-turn context shifts.

## Commands
```bash
export ORA_RUNTIME_STORE_DIR=/tmp/ora-router-contextual-Jp5E7E/store
pnpm --filter @ora/runtime exec tsx src/cli.ts eval import \
  --file /Users/quintenchen/developer/ora/evals/router/auto-mode-router-contextual-v1.jsonl \
  --format jsonl \
  --name "Auto Mode Router Contextual v1" \
  --description "Hand-labeled Auto Mode Router multi-turn contextual dataset" \
  --tags router,auto-mode,contextual,deepseek

pnpm --filter @ora/runtime exec tsx src/cli.ts eval run \
  --spec /Users/quintenchen/developer/ora/evals/router/auto-mode-router-contextual-v1-deepseek.spec.json

pnpm --filter @ora/runtime exec tsx src/cli.ts eval export \
  --run eval-run-0001 \
  --format json \
  --output /tmp/ora-router-contextual-Jp5E7E/run.json
```
