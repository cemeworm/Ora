# TASK-20260425-1955-ora-session-status-diagnostics

**Created:** 2026-04-25 19:55 CST
**Status:** Done

---

## Goal
- Fix the six issues surfaced by a normal chat run being shown as failed under `Generator-Verifier`: default new work should use `single_agent`, verifier failures should be represented and diagnosed clearly, Trails should show the real failure cause, checkpoints should not be mislabeled as interrupted, and the model-facing tool truth should align with Ora runtime capabilities.

## Scope / Out of scope
- In scope:
  - Make the desktop default selected work mode `single_agent`.
  - Keep Generator-Verifier available, but make its failure semantics and diagnostics understandable.
  - Surface last error, failing event, and failing branch details in Trails.
  - Rename non-success checkpoints by actual run status.
  - Improve verifier structured-output stability with existing provider APIs and parser fallback.
  - Ensure single-agent prompts describe project tools/skills from runtime context rather than claiming no local capability.
- Out of scope:
  - Adding a new coordination family enum.
  - Redesigning Trails visual structure beyond diagnostics copy/data already present.
  - Implementing full tool execution for all advertised tools.
  - Changing provider billing/auth behavior.

## Constraints
- Compatibility: preserve existing `generator_verifier`, `orchestrator_subagent`, and `single_agent` mode contracts.
- Performance: no extra network calls or background work just to render Trails diagnostics.
- Risk: keep changes surgical; avoid broad mode-system refactors.
- Tool/Environment limits: verify with JS/TS tests/builds available in this repo; Rust/Tauri may remain unverified if toolchain is unavailable.

## Plan
1. `apps/desktop/src/lib/state.tsx`: select `single_agent` by default when modes load, without overriding an explicit user/session selection.
2. `apps/runtime/src/harness/runtime-kernel.ts` and runtime tests: label checkpoints by final status, not every non-success as interrupted.
3. `packages/shared/src/index.ts`, runtime store/client, desktop Trails/view-model: carry and display run error details, especially verifier parse failures.
4. `apps/runtime/src/patterns/generator-verifier*`: make verifier prompting/parsing more robust and distinguish verification rejection from infrastructure failure where the contract allows.
5. `apps/runtime/src/patterns/driver-registry.ts` single-agent branch: make tool/skill capability context available to the model-facing response.
6. Run focused tests/typecheck/build, update verification evidence, and close the task only when all checkpoints pass.

## Active Files
- tasks/TASK-20260425-1955-ora-session-status-diagnostics.md
- apps/desktop/src/lib/state.tsx
- apps/desktop/src/components/TrailsTabs.tsx
- apps/runtime/src/harness/runtime-kernel.ts
- apps/runtime/src/patterns/driver-registry.ts
- apps/runtime/src/patterns/generator-verifier-utils.ts
- apps/runtime/test/runtime-smoke.test.ts
- apps/runtime/src/harness/runtime-tool-executor.ts
- apps/runtime/src/session/session-manager.ts
- apps/runtime/test/desktop-composer-state.test.ts
- apps/runtime/test/runtime-tool-executor.test.ts

## Decisions
- Decision: default new desktop runs to `single_agent`.
  - Why: ordinary chat should not start inside a verifier/evaluation loop.
  - Alternatives: keep Generator-Verifier default and improve copy only.
  - Tradeoffs: fewer surprising failures; users still need to opt into verification mode when they want it.
- Decision: keep `failed` as the persisted run status for exhausted Generator-Verifier until a broader shared status enum change is explicitly designed.
  - Why: adding a new status touches shared contracts, session state, UI badges, and persistence; the user asked for a complete fix but also surgical changes.
  - Alternatives: add `verification_failed` status now.
  - Tradeoffs: lower contract risk, while Trails and error metadata can still distinguish verifier rejection from provider/system failure.
- Decision: fix checkpoint labels at source.
  - Why: the label is stored in run snapshots and reused by Trails, export, replay, and fork views.
  - Alternatives: rewrite labels only in desktop rendering.
  - Tradeoffs: source fix improves all consumers.

## Progress Log
- 2026-04-25 19:55 CST - Created task journal and scoped the six issues into concrete runtime/desktop checkpoints.
  Next: patch default mode selection, checkpoint labels, and Trails diagnostics.
- 2026-04-25 20:03 CST - Implemented the first complete pass: desktop fresh bootstrap now prefers `single_agent`, failed/interrupted checkpoints are labeled by real status, Trails anomalies show concrete run errors, verifier prompt/output now tags `verification_failed`, and runtime tool prompts tell agents to answer tool-capability questions from Ora's actual tool list.
  Next: record verification evidence, clear TODO gate, and close the task.
- 2026-04-25 20:05 CST - Verification completed. Runtime focused suite, runtime typecheck/build, desktop typecheck/build, and task-scoped TODO scan all passed.
  Next: none.

## Open Issues
- TODO(FOLLOWUP): A future shared enum/status design such as `verification_failed` may be worth considering, but this pass intentionally kept persisted `RunStatus` unchanged and added diagnostic metadata instead.

## TODO
- None.

## Retrospective
### Item 1
- Pitfall: Treating all non-success checkpoints as "Interrupted" hides the difference between approval pauses, verifier failures, and real runtime failures.
- Symptom: A failed session showed `Failed` status but `Interrupted checkpoint`.
- Root Cause: The checkpoint label was derived from `status === "succeeded"` instead of a full status mapping.
- Reusable Guardrail: When a persisted status enum has more than two values, UI/storage labels should use an exhaustive switch.
- Evidence: `checkpointLabelForStatus` and `graphCheckpointLabelForStatus` now map `failed` and `interrupted` separately; runtime smoke tests assert both labels.
- Scope: Ora runtime checkpoints and Trails diagnostics.
- Suggested Writeback Target: None.
- Status: local_only

## Functional Verification

### Code Verification (Code Correctness)
- [x] Code compiles/runs without errors
- [x] Unit tests pass
- [x] Lint checks pass where applicable

**Output**:
- `pnpm --filter @ora/runtime test -- desktop-composer-state.test.ts runtime-tool-executor.test.ts runtime-smoke.test.ts`
  - Result: 11 test files passed, 113 tests passed.
- `pnpm --filter @ora/runtime typecheck`
  - Result: exited 0.
- `pnpm --filter @ora/desktop typecheck`
  - Result: exited 0.
- `pnpm --filter @ora/runtime build`
  - Result: exited 0.
- `pnpm --filter @ora/desktop build`
  - Result: exited 0; Vite built successfully with the existing >500 kB chunk warning.

### Functional Verification (Feature Works)
- [x] Fresh desktop bootstrap selects `single_agent`.
- [x] A failed Generator-Verifier run exposes the verifier parse error in Trails diagnostics.
- [x] Failed checkpoint label is `Failed checkpoint`.

**Output**:
- `desktop-composer-state.test.ts` asserts fresh `BOOTSTRAP` selects `single_agent`.
- `desktop-composer-state.test.ts` asserts Trails anomaly text becomes `Run failed: Verifier response did not contain a parseable pass/fail verdict.`
- `runtime-smoke.test.ts` asserts failed runs use `Failed checkpoint` and interrupted runs use `Interrupted checkpoint`.
- `runtime-tool-executor.test.ts` asserts tool-capability prompts include Ora runtime tools.

## Comparison

### Reference
- Existing `single_agent` memory and mode implementation in `MVP_MODES`.
- Existing Trails contract: local snapshot/event data first, `runs.trail` as read-only deep-dive.

### Comparison Points
- [x] Default-mode behavior remains mode-driven, not pattern-enum expansion.
- [x] Trails remains a right-panel runtime diagnostic surface.
- [x] Generator-Verifier remains opt-in and available.

### Findings
- Consistency: The fix reuses the existing `single_agent` mode preset and existing Trails local snapshot/event model.
- Differences: No new coordination family or `RunStatus` enum value was added; verification failure is currently metadata/copy, not a persisted status.
- Conclusion: The solution addresses the observed product confusion without broad contract churn.

## Checkpoints

### Checkpoint 1: Default Work Mode
- Requirement: fresh desktop bootstrap defaults to `single_agent`.
- Verification method: focused reducer/unit check or direct state test.
- Status: [x] Pass / [ ] Fail
- Evidence: `desktop-composer-state.test.ts` fresh bootstrap test passed.

### Checkpoint 2: Generator-Verifier Semantics
- Requirement: verifier parse/rejection failures are distinguishable in output/error metadata.
- Verification method: runtime smoke/unit test with non-JSON verifier output.
- Status: [x] Pass / [ ] Fail
- Evidence: non-JSON verifier test now expects `verifier.failureKind === "verification_failed"` while preserving non-crashing run behavior.

### Checkpoint 3: Trails Diagnostics
- Requirement: Trails shows last error/failing event details instead of only generic failed-state copy.
- Verification method: desktop typecheck plus inspect code path / focused test if available.
- Status: [x] Pass / [ ] Fail
- Evidence: `collectAnomalies` test asserts the concrete verifier parse error is shown.

### Checkpoint 4: Checkpoint Label Accuracy
- Requirement: failed runs create `Failed checkpoint`; interrupted runs create `Interrupted checkpoint`.
- Verification method: runtime smoke/unit test.
- Status: [x] Pass / [ ] Fail
- Evidence: `runtime-smoke.test.ts` asserts `Failed checkpoint` and `Interrupted checkpoint`.

### Checkpoint 5: Tool Truth For Single Agent
- Requirement: single-agent prompt/output path can describe available Ora tools/skills from runtime context.
- Verification method: runtime smoke/unit test or snapshot assertion.
- Status: [x] Pass / [ ] Fail
- Evidence: `runtime-tool-executor.test.ts` asserts tool-capability prompts include the actual enabled Ora tools.

### Checkpoint 6: No Broad Regression
- Requirement: shared/runtime/desktop checks pass for touched surfaces.
- Verification method: focused tests, typecheck, build as feasible.
- Status: [x] Pass / [ ] Fail
- Evidence: runtime tests, runtime typecheck/build, desktop typecheck/build all passed.

**All checkpoints must pass before marking task DONE!**

## Compressed State (<= 20 lines)
- Objective: fix misleading failed session behavior and make `single_agent` the default work mode.
- Done: default mode, checkpoint labels, Trails diagnostics, verifier failure metadata, tool-truth prompt, and tests.
- In-progress: none.
- Active files: task journal, desktop state/Trails/runtime client, runtime kernel/tool executor/session manager/driver, tests.
- Next actions (top 3; exact file/function): none for this task.
- Blockers/Risks: generated packaged sidecar resource was not rebuilt; source/runtime/desktop builds passed.
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
- Environment: `/Users/quintenchen/developer/ora`, pnpm TypeScript monorepo, 2026-04-25 CST.

### Commands run + outputs
- `pnpm --filter @ora/runtime test -- desktop-composer-state.test.ts runtime-tool-executor.test.ts runtime-smoke.test.ts`
  - Output: `Test Files  11 passed (11)`; `Tests  113 passed (113)`.
- `pnpm --filter @ora/runtime typecheck`
  - Output: exited 0.
- `pnpm --filter @ora/desktop typecheck`
  - Output: exited 0.
- `pnpm --filter @ora/runtime build`
  - Output: exited 0.
- `pnpm --filter @ora/desktop build`
  - Output: Vite transformed 1805 modules and built successfully; existing chunk-size warning remained.
- `bash /Users/quintenchen/developer/quantfox/.codex/skills/long-task-protocol/scripts/todo_scan.sh --task /Users/quintenchen/developer/ora/tasks/TASK-20260425-1955-ora-session-status-diagnostics.md`
  - Output: `Blocking TODO matches: none`; `Blocking task-journal TODO entries: none`; `Result: PASS`.
