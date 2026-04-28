# TASK-20260428-1551-evaluation-objectives-router

**Created:** 2026-04-28 15:51 CST
**Status:** Done

---

## Goal
- Upgrade Ora Evaluation into a more general objective/metric/observation evaluation backbone, then implement Auto Mode Router evaluation as the first concrete consumer. The result should let Ora evaluate router selection quality rigorously without hard-coding Evaluation around this one use case, while preserving existing dataset import, runs, baselines, CLI, desktop, and browser-fallback behavior.

## Scope / Out of scope
- In scope:
  - Add shared contracts for evaluation objectives, metric ids, metric scores, normalized observations, and generic structured assertions.
  - Preserve existing `profileId` behavior and map legacy profiles to compatible default objectives.
  - Extract normalized observations from `StateSnapshot` and score attempts through metric-oriented helpers.
  - Support a router-selection objective that evaluates `modeSelection: "auto"` using observations such as selected mode, router status, confidence, and reason.
  - Add a router-only evaluation path to avoid running downstream agents when the objective only needs routing behavior.
  - Update runtime JSON-RPC/browser fallback/CLI/desktop type surfaces only as needed for the new contracts.
  - Add focused test coverage and functional CLI-style evidence.
- Out of scope:
  - No separate benchmark service.
  - No LLM judge in v1; deterministic metrics first.
  - No broad redesign of EvaluationView beyond rendering the new metric/observation data safely.
  - No migration of existing persisted evaluation data beyond additive parsing compatibility.

## Constraints
- Compatibility: existing Evaluation datasets/specs using `profileId` and `expected.text` must continue to parse and run.
- Simplicity: keep v1 objective/metric schema small; do not invent plugin loading or external metric runners.
- Risk: desktop browser fallback must mirror runtime JSON-RPC contracts, or desktop can drift even when runtime passes.
- Tool/Environment limits: existing worktree has unrelated dirty files; do not revert or reformat them.

## Plan
1. Shared contracts:
   - Extend `packages/shared/src/evaluation.ts` with objective, metric, observation, assertion, metric score, and optional `metricScores/observations` result fields.
   - Add backward-compatible contract tests in `packages/shared/test/contracts.test.ts`.
2. Runtime scoring and observations:
   - Refactor scoring in `apps/runtime/src/evaluation-store.ts` into observation extraction plus metric scoring.
   - Preserve legacy `EvaluationScore` aggregate fields.
   - Add router objective scoring through the generic assertion/metric path.
3. Router-only execution:
   - Add evaluation-specific run metadata handling so `metadata.evaluationRouterOnly` returns a minimal snapshot after mode resolution.
   - Ensure observations include selected mode and router metadata for both selected and fallback paths.
4. Runtime/API/desktop parity:
   - Update runtime tests and any shared types consumed by desktop.
   - Keep `apps/desktop/src/lib/runtimeClient.ts` fallback compatible with new detail shapes.
   - Keep CLI spec ingestion compatible with objective-based specs.
5. Dataset artifacts and verification:
   - Add small checked-in router evaluation sample data/spec only if it fits existing repo conventions.
   - Run focused shared/runtime/desktop checks plus a functional import/run/export smoke when feasible.

## Active Files
- `packages/shared/src/evaluation.ts`
- `packages/shared/test/contracts.test.ts`
- `apps/runtime/src/evaluation-store.ts`
- `apps/runtime/src/run-store.ts`
- `apps/runtime/test/runtime-integration.test.ts`
- `apps/desktop/src/lib/runtimeClient.ts`
- `tasks/TASK-20260428-1551-evaluation-objectives-router.md`

## Decisions
- Decision: Build a generic objective/metric/observation layer instead of a router-only scorer.
  - Why: Auto Mode Router evaluation is important, but Evaluation needs to become more robust and reusable for future evaluation tasks.
  - Alternatives: Add `router_selection` as a special profile with bespoke scoring.
  - Tradeoffs: Generic contracts take slightly more design care, but avoid painting Evaluation into a router-specific corner.
- Decision: Keep deterministic metrics for v1.
  - Why: Router evaluation should not depend on another model judging the router.
  - Alternatives: LLM-as-judge rubric scorer.
  - Tradeoffs: Deterministic metrics require clearer datasets/oracles, but are cheaper and CI-friendly.
- Decision: Add router-only evaluation through run metadata rather than a separate RPC.
  - Why: It keeps the real `resolveModeSelection` path under test while avoiding unnecessary downstream agent work.
  - Alternatives: Add a dedicated `evaluation.router.run` method.
  - Tradeoffs: Requires careful snapshot construction, but avoids duplicate routing code.

## Progress Log
- 2026-04-28 15:51 CST - Task created with full方案 as the single source of truth.
- 2026-04-28 15:53 CST - Extended shared Evaluation contracts with objective, assertions, metric scores, and observations. `pnpm --filter @ora/shared test -- contracts.test.ts` passed.
  Next: refactor runtime observation/scoring path; add router objective metrics; then add router-only execution.
- 2026-04-28 16:02 CST - Implemented runtime observation extraction, generic metric scoring, objective-based router evaluation, router-only evaluation runs, desktop fallback parity, runtime integration coverage, and CLI smoke verification.
  Next: none.

## Open Issues
- None.

## TODO
- None.

## Retrospective
- One local pitfall was worth recording.

### Item 1
- Pitfall: JSON dataset import treated `expected: { structured: ... }` as a nested opaque object instead of preserving `structured` as the actual oracle payload.
- Symptom: the router objective test initially failed with `missing_oracle` and `miscalibrated_confidence` even though the dataset contained assertions and preferred mode.
- Root Cause: `normalizeExpected()` only recognized `text`; object expected values without text were wrapped as `{ structured: raw }`.
- Reusable Guardrail: when adding a new structured expected contract, test both direct schema parsing and JSON-import normalization.
- Evidence: fixed by recognizing `record.structured !== undefined` in `apps/runtime/src/evaluation-store.ts`; runtime integration test then passed.
- Scope: Evaluation dataset importer and future structured oracle formats.
- Suggested Writeback Target: local task note only.
- Status: local_only

## Functional Verification

### Code Verification (Code Correctness)
- [x] Code compiles/runs without errors
- [x] Unit tests pass
- [x] Lint/type checks pass

**Output**:
- `pnpm --filter @ora/shared test -- contracts.test.ts`: 1 test file passed, 81 tests passed.
- `pnpm --filter @ora/runtime test -- runtime-integration.test.ts`: 14 test files passed, 215 tests passed.
- `pnpm --filter @ora/shared build`: passed.
- `pnpm --filter @ora/runtime build`: passed.
- `pnpm --filter @ora/desktop typecheck`: passed.

### Functional Verification (Feature Works)
- [x] Existing evaluation flow still runs.
- [x] Router objective scores selected/fallback/incorrect routes.
- [x] Router-only mode avoids downstream agent execution.
- [x] Export includes metric/observation evidence.

**Output**:
- Runtime integration test `scores auto mode routing with objective metrics and router-only execution` passed:
  - mocked auto router selected `deerflow_harness`;
  - `providerCalls === 1`, proving router-only did not call a downstream agent provider;
  - underlying run had `events.length === 0`;
  - result contained `metricScores`, observations, and CSV `metric_scores_json` / `observations_json`.
- CLI smoke using temporary `ORA_RUNTIME_STORE_DIR` passed:
  - `dataset=dataset-0001`
  - `run=eval-run-0001`
  - summary: `{ "passRate": 1, "overall": 0.977, "metricIds": ["exact_match", "assertion_pass_rate"], "modeId": "single_agent" }`
  - CSV header includes `metric_scores_json,observations_json`.

## Comparison

### Reference
- Existing Ora Evaluation v1 backbone in `packages/shared/src/evaluation.ts`, `apps/runtime/src/evaluation-store.ts`, `apps/runtime/src/cli.ts`, `apps/desktop/src/lib/runtimeClient.ts`.
- Existing auto mode router in `apps/runtime/src/mode-selection.ts`.

### Comparison Points
- [x] Preserve runtime-owned Evaluation API.
- [x] Preserve file-imported datasets and CLI/CI usability.
- [x] Preserve result-table-first UI model while adding metric-level details.

### Findings
- Consistency: The implementation keeps Evaluation under the existing runtime JSON-RPC/CLI/desktop fallback path.
- Differences: Evaluation results now carry optional `objective`, `metricScores`, and `observations`; CSV export includes JSON evidence columns.
- Conclusion: The router evaluation capability landed as a generic Evaluation extension, not a separate product or router-only subsystem.

## Checkpoints

### Checkpoint 1: Shared Contract Compatibility
- Requirement: old Evaluation specs/datasets parse; new objective/assertion structures parse.
- Verification method: shared contract tests.
- Status: [x] Pass / [ ] Fail
- Evidence: `pnpm --filter @ora/shared test -- contracts.test.ts` passed, 81 tests.

### Checkpoint 2: Runtime Scoring Generality
- Requirement: scoring uses observations/metrics and supports router objective without breaking legacy scoring.
- Verification method: runtime tests and targeted smoke.
- Status: [x] Pass / [ ] Fail
- Evidence: `pnpm --filter @ora/runtime test -- runtime-integration.test.ts` passed, 215 tests across runtime suite.

### Checkpoint 3: Router Evaluation Behavior
- Requirement: correct mode selection scores high, fallback/invalid/wrong selections produce meaningful failure tags, router-only avoids downstream execution.
- Verification method: runtime tests with mocked provider responses.
- Status: [x] Pass / [ ] Fail
- Evidence: router objective integration test passed; provider called once; underlying router-only run had zero downstream events.

### Checkpoint 4: Surface Parity
- Requirement: CLI/desktop/browser fallback remain type-compatible with new Evaluation result detail.
- Verification method: runtime tests and desktop typecheck.
- Status: [x] Pass / [ ] Fail
- Evidence: `pnpm --filter @ora/desktop typecheck` passed; CLI smoke import/run/export passed.

## Compressed State (<= 20 lines)
- Objective: Generalize Evaluation around objectives/metrics/observations and implement Auto Mode Router evaluation on top.
- Done: Shared contracts, runtime scoring, router objective, router-only path, browser fallback parity, runtime tests, CLI smoke, and verification completed.
- In-progress: None.
- Active files: `packages/shared/src/evaluation.ts`, `packages/shared/test/contracts.test.ts`, `apps/runtime/src/evaluation-store.ts`, `apps/runtime/src/run-store.ts`, `apps/runtime/test/runtime-integration.test.ts`, `apps/desktop/src/lib/runtimeClient.ts`, this task file.
- Next actions (top 3; exact file/function): none.
- Blockers/Risks: unrelated dirty worktree remains outside this task; no known blocker in this implementation.
- Verification status: passed.

## Verification

### Evidence Requirements
Must provide the following evidence:
- [x] Code Verification output (compilation/tests/lint)
- [x] Functional Verification output (feature verification)
- [x] Retrospective Evidence (if applicable)
- [x] Comparison Evidence (if applicable)
- [x] Checkpoints Evidence (if applicable)

### Environment
- Environment: `/Users/quintenchen/developer/ora`, zsh, 2026-04-28 CST.

### Commands run + outputs
- `pnpm --filter @ora/shared test -- contracts.test.ts`
  - Result: PASS; 1 test file passed; 81 tests passed.
- `pnpm --filter @ora/runtime test -- runtime-integration.test.ts`
  - Result: PASS; 14 test files passed; 215 tests passed.
- `pnpm --filter @ora/shared build`
  - Result: PASS.
- `pnpm --filter @ora/runtime build`
  - Result: PASS.
- `pnpm --filter @ora/desktop typecheck`
  - Result: PASS.
- CLI smoke:
  - Command shape: temporary `ORA_RUNTIME_STORE_DIR`; `tsx src/cli.ts eval import`; `tsx src/cli.ts eval run`; `tsx src/cli.ts eval export`.
  - Result: PASS; `passRate=1`, `overall=0.977`, metric ids `exact_match/assertion_pass_rate`, observed `modeId=single_agent`, CSV contained `metric_scores_json` and `observations_json`.
- TODO gate:
  - `bash /Users/quintenchen/developer/quantfox/.codex/skills/long-task-protocol/scripts/todo_scan.sh --task /Users/quintenchen/developer/ora/tasks/TASK-20260428-1551-evaluation-objectives-router.md`
  - Result: PASS; blocking TODO matches none; blocking task-journal TODO entries none.
