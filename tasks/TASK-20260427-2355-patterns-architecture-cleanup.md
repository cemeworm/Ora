# TASK-20260427-2355-patterns-architecture-cleanup

**Created:** 2026-04-27 23:55 CST
**Status:** Done

---

## Goal
- Reduce architecture drift in `apps/runtime/src/patterns` by recording the cleanup plan, then implementing the highest-impact fixes: make ModeSpec/runtime-kernel the single pattern semantic source for new runs, split reusable pattern-driver concerns out of the god module without changing behavior, align remaining LangGraph node ids with ModeSpec metadata, and bound manual-approval denial handling.

## Scope / Out of scope
- In scope:
  - `runs.start` pattern execution routing.
  - Small, behavior-preserving extraction from `patterns/driver-registry.ts`.
  - LangGraph compatibility fixes where that path still exists for interrupt/resume/checkpoint support.
  - Focused tests or type/build checks proving the cleanup.
- Out of scope:
  - Full removal of LangGraph session/checkpoint infrastructure.
  - Broad prompt rewrites or product behavior changes.
  - Reformatting unrelated code.

## Constraints
- Compatibility: Preserve existing public RPC methods and run snapshot shape.
- Performance: No additional provider calls or graph work.
- Risk: Session resume/checkpoint behavior may depend on SessionManager; inspect before changing.
- Tool/Environment limits: Use surgical edits and existing test scripts where available.

## Plan
1. `apps/runtime/src/json-rpc.ts` -> route `runs.start` through `executeRuntimeKernel` as the ModeSpec semantic source; preserve managed snapshot fallback only where needed for run control.
2. `apps/runtime/src/patterns/driver-registry.ts` -> extract reusable context/types/utilities into focused modules while keeping the driver registry behavior stable.
3. `apps/runtime/src/patterns/shared-state.ts` and `apps/runtime/src/patterns/hitl.ts` -> align node ids and make approval denial terminal/bounded instead of recursive.
4. Verify with targeted unit/type tests and record actual command output.

## Active Files
- tasks/TASK-20260427-2355-patterns-architecture-cleanup.md
- apps/runtime/src/json-rpc.ts
- apps/runtime/src/patterns/driver-registry.ts
- apps/runtime/src/patterns/driver-utils.ts
- apps/runtime/src/patterns/execution-context.ts
- apps/runtime/src/patterns/shared-state.ts
- apps/runtime/src/patterns/hitl.ts
- apps/runtime/test/session-thread.test.ts
- apps/runtime/test/sqlite-checkpointer.test.ts

## Decisions
- Decision: Treat ModeSpec + runtime-kernel as the semantic source for new pattern runs.
  - Why: Avoid two independent pattern implementations drifting as Mode Studio adds config fields.
  - Alternatives: Port every LangGraph pattern to consume ModeSpec fully; defer cleanup.
  - Tradeoffs: Smaller immediate drift surface, while LangGraph checkpoint/resume infrastructure remains for existing managed controls.

## Progress Log
- 2026-04-27 23:55 CST - Task created
  Next: Fill in Goal, Scope, Plan, and list Active Files
- 2026-04-27 23:56 CST - Filled task goal/scope/plan after confirming the main smells in `json-rpc.ts`, `driver-registry.ts`, `shared-state.ts`, and `hitl.ts`.
  Next: Inspect SessionManager routing, existing tests/scripts, and full driver-registry structure.
- 2026-04-28 00:01 CST - Implemented cleanup: JSON-RPC new runs now always execute through runtime-kernel/ModeSpec, driver context/utilities split into focused files, shared-state graph node id aligned to `research`, and graph approval denial made terminal. Updated tests from explicit LangGraph semantics to single-source runtime-kernel semantics.
  Next: Record verification evidence and close task gates.
- 2026-04-28 00:02 CST - Verification passed: runtime typecheck succeeded, runtime lint-if-present exited 0, and runtime Vitest suite reported 15 files / 220 tests passed. Repo-wide TODO helper was too noisy/long-running in this workspace, so task-owned source/test files were scanned directly with no blocking TODO/FIXME/XXX matches.
  Next: None.

## Open Issues
- None.

## TODO
- None.

## Retrospective
### Item 1
- Pitfall: JSON-RPC integration tests can encode legacy routing semantics even when lower-level runtime code is already ModeSpec-driven.
- Symptom: After removing the `metadata.langGraphOrchestration` branch, tests still expected graph-specific action ids (`graph-decompose`) and graph resume events.
- Root Cause: Tests treated an opt-in metadata flag as an architectural contract instead of checking the desired single semantic source.
- Reusable Guardrail: When collapsing dual execution paths, update tests to assert the new boundary explicitly: metadata flags must not switch the semantic executor, while transcript/resume behavior is still verified through the surviving path.
- Evidence: `session-thread.test.ts` and `sqlite-checkpointer.test.ts` now assert `runtimeRoute: "runtime-kernel"` and runtime-kernel approval/clarification behavior.
- Scope: Runtime orchestration tests.
- Suggested Writeback Target: None.
- Status: local_only

## Functional Verification

### Code Verification (Code Correctness)
- [x] Code compiles/runs without errors
- [x] Unit tests pass
- [x] Lint checks pass

**Output**:
- `pnpm --filter @ora/runtime typecheck` -> `tsc -p tsconfig.json --noEmit` completed with exit code 0.
- `pnpm --filter @ora/runtime test -- session-thread.test.ts sqlite-checkpointer.test.ts custom-agents.test.ts` -> Vitest reported `Test Files 15 passed (15)`, `Tests 220 passed (220)`.
- `pnpm --filter @ora/runtime --if-present lint` -> exit code 0; no package-level lint output.

### Functional Verification (Feature Works)
- [x] Core functionality verification: JSON-RPC new runs ignore `metadata.langGraphOrchestration` and persist `runtimeRoute: "runtime-kernel"`.
- [x] Edge cases verification: Session transcript still flows into runtime-kernel provider calls across two turns.
- [x] Error handling verification: approval denial recursion removed; manual approval resume path verified through runtime-kernel tests.

**Output**:
- `session-thread.test.ts` verifies explicit LangGraph metadata does not call `SessionManager.startRun` and the latest snapshot route is `runtime-kernel`.
- `sqlite-checkpointer.test.ts` verifies clarification resume, manual approval resume, and high-risk metadata behavior on the runtime-kernel path.

## Comparison (If Applicable)

### Reference
- Reference implementation/template/similar task: Existing `LocalRunStore.startRun` already executes `executeRuntimeKernel` with resolved ModeSpec.

### Comparison Points
- [x] New JSON-RPC `runs.start` with enabled `SessionManager` uses the same runtime-kernel semantic executor.
- [x] Evaluation run creation uses the same runtime-kernel semantic executor.
- [x] Remaining LangGraph graph files no longer affect JSON-RPC new-run semantics.

### Findings
- Consistency: New JSON-RPC and store-only starts now share the runtime-kernel semantic source.
- Differences: LangGraph `SessionManager.startRun` still exists as a lower-level/legacy graph capability, but it is no longer selected by `metadata.langGraphOrchestration` at the JSON-RPC run boundary.
- Conclusion: ModeSpec/runtime-kernel is now the effective new-run source of truth.

## Checkpoints

### Checkpoint 1: Single Semantic Source
- Requirement: `runs.start` and evaluation runs should not branch into LangGraph pattern graphs based on metadata.
- Verification method: Code inspection plus session-thread tests.
- Status: [x] Pass
- Evidence: `shouldUseLangGraphOrchestration` removed; tests assert no `SessionManager.startRun` call and `runtimeRoute: "runtime-kernel"`.

### Checkpoint 2: Driver Split
- Requirement: Extract broad context/types and reusable helpers from `driver-registry.ts` without changing pattern behavior.
- Verification method: Runtime typecheck and full runtime test run.
- Status: [x] Pass
- Evidence: `execution-context.ts` and `driver-utils.ts` added; `pnpm --filter @ora/runtime typecheck` passed.

### Checkpoint 3: LangGraph Compatibility Fixes
- Requirement: Align shared-state graph node id with ModeSpec and remove unbounded approval recursion.
- Verification method: Code inspection and runtime tests.
- Status: [x] Pass
- Evidence: `shared-state.ts` uses `research`; `hitl.ts` throws terminal denial error instead of recursive retry; runtime tests passed.

**All checkpoints must pass before marking task DONE!**

## Compressed State (<= 20 lines)
- Objective: Reduce patterns architecture drift with a task journal and surgical implementation.
- Done: JSON-RPC new runs/evaluation runs use runtime-kernel only; driver context/utilities split; shared-state graph id aligned; approval denial recursion removed; tests updated.
- In-progress: None.
- Active files: task journal, json-rpc.ts, driver-registry.ts, driver-utils.ts, execution-context.ts, shared-state.ts, hitl.ts, session-thread.test.ts, sqlite-checkpointer.test.ts.
- Next actions (top 3; exact file/function): none.
- Blockers/Risks: LangGraph graph implementations remain as legacy/direct lower-level capability; JSON-RPC new-run semantics no longer select them.
- Verification status: Passed runtime typecheck and runtime test suite.

## Verification

### Evidence Requirements
Must provide the following evidence:
- [x] Code Verification output (compilation/tests/lint)
- [x] Functional Verification output (feature verification)
- [x] Retrospective Evidence (if applicable)
- [x] Comparison Evidence (if applicable)
- [x] Checkpoints Evidence (if applicable)

### Environment
- Environment: `/Users/quintenchen/developer/Ora`, zsh, 2026-04-28 CST

### Commands run + outputs
- `pnpm --filter @ora/runtime typecheck`
  - Output: `tsc -p tsconfig.json --noEmit`; exit code 0.
- `pnpm --filter @ora/runtime --if-present lint`
  - Output: no output; exit code 0.
- `pnpm --filter @ora/runtime test -- session-thread.test.ts sqlite-checkpointer.test.ts custom-agents.test.ts`
  - Output: `Test Files 15 passed (15)`, `Tests 220 passed (220)`.
- `bash /Users/quintenchen/.codex/skills/long-task-protocol/scripts/todo_scan.sh`
  - Output: repo-wide scan produced extensive pre-existing task/generated TODO noise and was stopped after continuing too long; not reliable as task-scoped evidence in this workspace.
- `rg --pcre2 -n "TODO(?!\\(FOLLOWUP\\))|FIXME|XXX|\\[ \\]" apps/runtime/src/json-rpc.ts apps/runtime/src/patterns/driver-registry.ts apps/runtime/src/patterns/driver-utils.ts apps/runtime/src/patterns/execution-context.ts apps/runtime/src/patterns/hitl.ts apps/runtime/src/patterns/shared-state.ts apps/runtime/test/session-thread.test.ts apps/runtime/test/sqlite-checkpointer.test.ts`
  - Output: no matches; exit code 1 from `rg` means no blocking matches.
