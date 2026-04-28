# TASK-20260428-1622-auto-router-evaluation-run

**Created:** 2026-04-28 16:22 CST
**Status:** Done

---

## Goal
- Run a concrete evaluation of Ora Auto Mode Router accuracy using the generalized Evaluation objective/metric/observation backbone. The output should answer whether the current router is good/precise enough in the current environment, and leave a reusable dataset/spec pattern for future provider-backed reruns.
- Extend the router evaluation with multi-turn contextual cases that test whether Auto Mode follows the current user intent instead of overfitting to earlier conversation turns.

## Scope / Out of scope
- In scope:
  - Create a reusable router evaluation dataset covering core intents, boundaries, ambiguity/fallback behavior, and mode-specific negative cases.
  - Run the dataset through `evaluation.runs.start` with `objective.target = runtime.mode_selection`.
  - Use `metadata.evaluationRouterOnly = true` so the run evaluates routing, not downstream task completion.
  - Export and analyze score, failure tags, selected modes, router status, and confidence.
- Out of scope:
  - Do not tune router prompt/mode descriptions in this task.
  - Do not mock router responses for the actual evaluation result.
  - Do not require external provider credentials; if unavailable, record that as part of the current router readiness result.

## Constraints
- Current environment does not expose model provider keys in env.
- Default local-smoke provider cannot produce valid router JSON, so it is expected to test runtime readiness/fallback behavior rather than model intelligence.
- Existing unrelated dirty worktree files must not be reverted.

## Plan
1. Create `evals/router/auto-mode-router-v1.jsonl` with hand-labeled cases.
2. Import dataset into a temporary evaluation store and run an objective spec using current default auto routing.
3. Export JSON/CSV and compute a concise report from observations/metric scores.
4. Record whether the current router is good enough, plus exact rerun command shape for a real provider.
5. Add contextual multi-turn cases and rerun the provider-backed eval against DeepSeek.

## Active Files
- `evals/router/auto-mode-router-v1.jsonl`
- `evals/router/auto-mode-router-v1-current-baseline.md`
- `evals/router/auto-mode-router-v1-deepseek.spec.json`
- `evals/router/auto-mode-router-v1-deepseek-run.md`
- `evals/router/auto-mode-router-contextual-v1.jsonl`
- `evals/router/auto-mode-router-contextual-v1-deepseek.spec.json`
- `evals/router/auto-mode-router-contextual-v1-deepseek-run.md`
- `apps/runtime/src/evaluation-store.ts`
- `apps/runtime/src/mode-selection.ts`
- `apps/runtime/test/runtime-smoke.test.ts`
- `tasks/TASK-20260428-1622-auto-router-evaluation-run.md`

## Decisions
- Decision: Use the real current routing path without mocked provider responses.
  - Why: The user asked whether the router itself is good/precise enough; mocks would only test the evaluator.
  - Alternatives: mock a perfect/known router response.
  - Tradeoffs: Without provider credentials, the result will mainly reveal deployment/config readiness and fallback behavior.
- Decision: Use router-only evaluation.
  - Why: Mode selection quality is the object under test; downstream agent execution would add cost/noise.
  - Alternatives: full end-to-end agent runs after routing.
  - Tradeoffs: Does not measure whether a selected mode later completes the task better.
- Decision: Iterate the runtime router from the DeepSeek eval failure modes before broader prompt tuning.
  - Why: The provider-backed run proved the router is wired, but exposed malformed/truncated JSON and one internal-mode selection.
  - Alternatives: tune every mode description or dataset label first.
  - Tradeoffs: This is a narrow reliability pass; it does not claim the router is semantically final.

## Progress Log
- 2026-04-28 16:22 CST - Task created. Current env/provider inspection found no model provider keys; `.env.example` only documents telemetry/search keys, not LLM provider keys.
  Next: add dataset; run current default-router baseline; compute report.
- 2026-04-28 16:27 CST - Created 25-case router dataset, fixed `minConfidence: 0` confidence-calibration edge case, ran current-environment baseline, and wrote report.
  Next: none.
- 2026-04-28 16:58 CST - Added explicit DeepSeek provider-backed eval spec and ran it against `deepseek-v4-flash`.
  Result: `selected=15`, `fallback=10`, pass rate `0.48`, overall score `0.6255`; remaining fallbacks are malformed/truncated router JSON, not missing-provider fallback.
  Next: decide whether to harden router JSON output/parsing before using Auto Mode as a product default.
- 2026-04-28 17:04 CST - Started Auto Mode iteration from DeepSeek eval results.
  Plan: filter internal modes from router candidates; tighten router JSON prompt and disable tool choice; increase router output budget; add regression coverage; rerun DeepSeek spec.
  Next: patch `apps/runtime/src/mode-selection.ts` and runtime tests.
- 2026-04-28 17:29 CST - Completed Auto Mode reliability iteration.
  Result: DeepSeek rerun improved from `overallScore=0.6255/passRate=0.48/selected=15/fallback=10` to `overallScore=0.961/passRate=1.0/selected=23/fallback=2`; remaining fallbacks are the two intended ambiguous cases.
  Next: none.
- 2026-04-28 17:41 CST - Started contextual multi-turn eval hardening.
  Plan: expose eval-provided prior messages to the router `recentMessages` prompt slot, add targeted contextual cases, add regression coverage, and rerun DeepSeek.
  Next: run focused tests and provider-backed contextual eval.
- 2026-04-28 17:46 CST - Completed contextual multi-turn eval hardening.
  Result: 10 contextual cases passed with DeepSeek; `overallScore=0.977`, `passRate=1.0`, `selected=10`, `fallback=0`.
  Next: none.

## Open Issues
- None.

## TODO
- [x] Add contextual multi-turn router dataset/spec.
- [x] Verify contextual messages enter the Auto router prompt.
- [x] Run focused runtime regression.
- [x] Run DeepSeek contextual eval and write report.
- [x] Filter internal modes from Auto router candidates.
- [x] Harden router provider request against malformed/truncated JSON output.
- [x] Add regression coverage for candidate filtering/request shape.
- [x] Rerun focused tests and DeepSeek router eval.

## Retrospective
- One local pitfall was worth recording.

### Item 1
- Pitfall: Router eval cases for intentionally ambiguous input used `minConfidence: 0`, which exposed a divide-by-zero bug in `confidence_calibration`.
- Symptom: `evaluation.runs.start` failed with Zod `Expected number, received nan` at `confidenceCalibrationMetric`.
- Root Cause: confidence score used `confidence / minConfidence` without guarding `minConfidence <= 0`.
- Reusable Guardrail: metric implementations should clamp or branch all dataset-controlled denominators before schema parsing.
- Evidence: fixed in `apps/runtime/src/evaluation-store.ts`; runtime integration test/build passed; router eval rerun completed.
- Scope: local Evaluation metric robustness.
- Suggested Writeback Target: none.
- Status: local_only

### Item 2
- Pitfall: Auto router candidates included internal modes, so a real provider could select `mode_studio_builder` for ordinary chat.
- Symptom: DeepSeek provider-backed eval selected `mode_studio_builder` once.
- Root Cause: `routeAutoMode` used `modeStore.list()` without filtering `visibility === "internal"`.
- Reusable Guardrail: Runtime routers should filter execution candidates by product visibility before model selection, not rely on prompt wording to hide internal modes.
- Evidence: patched in `apps/runtime/src/mode-selection.ts`; regression verifies candidates exclude `MODE_STUDIO_BUILDER_MODE_ID`; DeepSeek rerun selected no internal modes.
- Scope: Auto Mode router candidate hygiene.
- Suggested Writeback Target: none.
- Status: local_only

## Functional Verification

### Code Verification (Code Correctness)
- [x] Dataset imports successfully.
- [x] Evaluation run completes.

**Output**:
- `wc -l evals/router/auto-mode-router-v1.jsonl` -> 25 cases.
- Dataset import produced `dataset_id=dataset-0001` in a temporary evaluation store.
- Evaluation run produced `run_id=eval-run-0001`.
- `pnpm --filter @ora/runtime test -- runtime-integration.test.ts` passed after the metric edge-case fix.
- `pnpm --filter @ora/runtime build` passed after the metric edge-case fix.

### Functional Verification (Feature Works)
- [x] Result includes selected mode/router status/confidence observations.
- [x] Report identifies whether current router is good enough.

**Output**:
- Current baseline:
  - total cases: 25
  - overall score: 0.4565
  - pass rate: 0.28
  - exact accuracy: 0.28
  - acceptable accuracy: 0.28
  - assertion pass average: 0.36
  - selected mode counts: `single_agent=25`
  - router status counts: `fallback=25`
- DeepSeek provider-backed rerun:
  - total cases: 25
  - pre-iteration overall score: 0.6255
  - pre-iteration pass rate: 0.48
  - pre-iteration selected mode counts: `single_agent=16`, `generator_verifier=1`, `deerflow_harness=1`, `agent_teams=1`, `message_bus=3`, `shared_state=2`, `mode_studio_builder=1`
  - pre-iteration router status counts: `selected=15`, `fallback=10`
  - post-iteration overall score: 0.961
  - post-iteration pass rate: 1.0
  - post-iteration selected mode counts: `single_agent=7`, `generator_verifier=3`, `orchestrator_subagent=3`, `deerflow_harness=3`, `agent_teams=3`, `message_bus=3`, `shared_state=3`
  - post-iteration router status counts: `selected=23`, `fallback=2`
  - post-iteration fallback cases: `router-ambiguous-001`, `router-ambiguous-002`
  - report written to `evals/router/auto-mode-router-v1-deepseek-run.md`
- DeepSeek contextual provider-backed run:
  - total cases: 10
  - overall score: 0.977
  - pass rate: 1.0
  - selected mode counts: `single_agent=2`, `orchestrator_subagent=2`, `generator_verifier=2`, `agent_teams=1`, `message_bus=1`, `shared_state=1`, `deerflow_harness=1`
  - router status counts: `selected=10`
  - failure tags: none
  - report written to `evals/router/auto-mode-router-contextual-v1-deepseek-run.md`
- Report written to `evals/router/auto-mode-router-v1-current-baseline.md`.

## Comparison

### Reference
- Previous task `TASK-20260428-1551-evaluation-objectives-router.md` implemented the generic objective/metric/observation backbone.

### Comparison Points
- [x] Reuse objective/metric/observation contracts rather than bespoke analysis.
- [x] Use current real runtime routing path.
- [x] Leave reusable eval assets for future reruns.

### Findings
- Reused the new generic Evaluation objective path with `runtime.mode_selection`.
- Used current real auto routing path without mocked provider responses.
- Saved reusable dataset and current baseline report under `evals/router/`.

## Checkpoints

### Checkpoint 1: Dataset Coverage
- Requirement: Dataset covers multiple expected modes and boundary/ambiguous cases.
- Verification method: inspect case count and metadata slices.
- Status: [x] Pass / [ ] Fail
- Evidence: 25 cases; preferred mode distribution: `single_agent=7`, and 3 each for `generator_verifier`, `orchestrator_subagent`, `deerflow_harness`, `agent_teams`, `message_bus`, `shared_state`.

### Checkpoint 2: Real Router Baseline
- Requirement: Run uses real current auto mode path, not mocked router responses.
- Verification method: inspect run spec and observations.
- Status: [x] Pass / [ ] Fail
- Evidence: run config used `modeSelection=auto`, no injected providerConfig, `evaluationRouterOnly=true`; all observations had `routerStatus=fallback`.

### Checkpoint 3: Decision Quality Conclusion
- Requirement: Provide a clear go/no-go conclusion for whether router is precise enough.
- Verification method: compute accuracy/passRate/failure tags and explain constraints.
- Status: [x] Pass / [ ] Fail
- Evidence: current environment result is not good enough: `acceptableAccuracy=0.28`, `routerStatus=fallback` for 25/25 cases, medium/hard specialized modes mostly failed.

### Checkpoint 4: Auto Mode Iteration
- Requirement: Provider-backed Auto routing should avoid internal modes and materially reduce malformed/truncated JSON fallbacks.
- Verification method: focused runtime regression, runtime build, and DeepSeek provider-backed eval rerun.
- Status: [x] Pass / [ ] Fail
- Evidence: regression verifies `MODE_STUDIO_BUILDER_MODE_ID` is not in router candidates and router request uses `max_tokens=800`; DeepSeek rerun produced `passRate=1.0`, `selected=23`, `fallback=2`, no `mode_studio_builder` selections.

### Checkpoint 5: Contextual Multi-turn Routing
- Requirement: Auto Mode eval includes prior conversation turns that point at a different mode, and the router still selects the mode matching the current user intent.
- Verification method: focused runtime regression, JSONL/spec validation, and DeepSeek contextual eval run.
- Status: [x] Pass / [ ] Fail
- Evidence: regression verifies context-provided prior messages are merged into router `recentMessages`; contextual DeepSeek run produced `passRate=1.0`, `selected=10`, `fallback=0`, no failure tags.

## Compressed State (<= 20 lines)
- Objective: Run a real current-environment Auto Mode Router quality evaluation.
- Done: dataset, evaluation run, report, metric edge-case fix, runtime test/build verification.
- In-progress: none.
- Active files: `apps/runtime/src/mode-selection.ts`, `apps/runtime/test/runtime-smoke.test.ts`, `evals/router/auto-mode-router-v1-deepseek.spec.json`, `evals/router/auto-mode-router-v1-deepseek-run.md`, `evals/router/auto-mode-router-contextual-v1.jsonl`, `evals/router/auto-mode-router-contextual-v1-deepseek.spec.json`, `evals/router/auto-mode-router-contextual-v1-deepseek-run.md`, this task file.
- Next actions (top 3; exact file/function): none; optional future work is UI gating when only `local-smoke` is available.
- Blockers/Risks: DeepSeek can still return semantically wrong but valid JSON; current dataset now passes but broader prompts may need more eval cases.
- Verification status: passed, including contextual multi-turn eval.

## Verification

### Evidence Requirements
Must provide the following evidence:
- [x] Dataset import output
- [x] Evaluation run output
- [x] Export/report output
- [x] Conclusion

### Environment
- Environment: `/Users/quintenchen/developer/ora`, zsh, 2026-04-28 CST.

### Commands run + outputs
- `wc -l evals/router/auto-mode-router-v1.jsonl`
  - Output: `25 evals/router/auto-mode-router-v1.jsonl`
- `pnpm --filter @ora/runtime exec tsx src/cli.ts eval import --file evals/router/auto-mode-router-v1.jsonl --format jsonl --name "Auto Mode Router v1" --description "Hand-labeled Auto Mode Router quality dataset" --tags router,auto-mode`
  - Output: `dataset_id=dataset-0001` in temporary store.
- `pnpm --filter @ora/runtime exec tsx src/cli.ts eval run --spec <temp-router-spec.json>`
  - Output: `run_id=eval-run-0001`; `overallScore=0.4565`; `passRate=0.28`.
- `pnpm --filter @ora/runtime exec tsx src/cli.ts eval export --run eval-run-0001 --format csv --output <temp-router-run.csv>`
  - Output: CSV export succeeded.
- `pnpm --filter @ora/runtime test -- runtime-integration.test.ts`
  - Output: PASS; 14 files / 215 tests.
- `pnpm --filter @ora/runtime build`
  - Output: PASS.
- `pnpm --filter @ora/runtime test -- runtime-smoke.test.ts -t "routes auto mode to a selected custom mode"`
  - Output: PASS; 14 files / 215 tests.
- `pnpm --filter @ora/runtime test -- runtime-integration.test.ts -t "scores auto mode routing with objective metrics and router-only execution"`
  - Output: PASS; 14 files / 215 tests.
- `pnpm --filter @ora/runtime build`
  - Output: PASS.
- `pnpm --filter @ora/runtime exec tsx src/cli.ts eval run --spec /Users/quintenchen/developer/ora/evals/router/auto-mode-router-v1-deepseek.spec.json`
  - Output: `run_id=eval-run-0001`; `overallScore=0.961`; `passRate=1.0`; `selected=23`; `fallback=2`; selected modes exactly match expected distribution across user-facing modes.
- `node -e "<parse contextual jsonl/spec>"`
  - Output: `ok evals/router/auto-mode-router-contextual-v1.jsonl`; `ok evals/router/auto-mode-router-contextual-v1-deepseek.spec.json`.
- `pnpm --filter @ora/runtime test -- runtime-smoke.test.ts -t "routes auto mode to a selected custom mode"`
  - First output: FAIL because session-created current prompt displaced context messages; fixed by merging context messages with session messages.
  - Final output: PASS; 14 files / 215 tests.
- `pnpm --filter @ora/runtime exec tsx src/cli.ts eval import --file /Users/quintenchen/developer/ora/evals/router/auto-mode-router-contextual-v1.jsonl --format jsonl --name "Auto Mode Router Contextual v1" --description "Hand-labeled Auto Mode Router multi-turn contextual dataset" --tags router,auto-mode,contextual,deepseek`
  - Output: `dataset_id=dataset-0001`; 10 cases.
- `pnpm --filter @ora/runtime exec tsx src/cli.ts eval run --spec /Users/quintenchen/developer/ora/evals/router/auto-mode-router-contextual-v1-deepseek.spec.json`
  - Output: `run_id=eval-run-0001`; `overallScore=0.977`; `passRate=1.0`; `selected=10`; `fallback=0`.
- `pnpm --filter @ora/runtime exec tsx src/cli.ts eval export --run eval-run-0001 --format json --output /tmp/ora-router-contextual-Jp5E7E/run.json`
  - Output: JSON export succeeded.
- `pnpm --filter @ora/runtime build`
  - Output: PASS.
- `git diff --check`
  - Output: no whitespace errors.
- `rg -n '^- \[ \]|TODO\(|Status: \[ \] Fail|In Progress' tasks/TASK-20260428-1622-auto-router-evaluation-run.md apps/runtime/src/mode-selection.ts apps/runtime/test/runtime-smoke.test.ts evals/router/auto-mode-router-v1-deepseek-run.md | rg -v '^tasks/TASK-20260428-1622-auto-router-evaluation-run.md:226:' || true`
  - Output: no matches.
