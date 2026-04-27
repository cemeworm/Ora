# TASK-20260428-0041-runtime-kernel-structural-split

**Created:** 2026-04-28 00:41 Asia/Shanghai
**Status:** DONE

---

## Goal
- Continue the structural split of `apps/runtime/src/harness/runtime-kernel.ts` so the kernel remains the public orchestration facade while stateful subdomains move into focused harness modules. Preserve public API, event names, snapshot schema, runtime behavior, and existing tests.

## Scope / Out of scope
- In scope:
  - Extract low-coupling helper domains first: intent clarification preflight, progress narration, runtime output/completion metadata helpers, and context adapters.
  - Extract the node model/tool loop into a focused module once its dependencies are explicit.
  - Extract repeated action/approval/tool execution transitions into one helper path shared by normal and recovery tool execution.
  - Keep `executeRuntimeKernel`, `RuntimeKernelOptions`, and `RuntimeKernelResult` exported from `runtime-kernel.ts`.
  - Keep edits surgical and behavior-equivalent.
- Out of scope:
  - No event schema changes, snapshot shape changes, provider API changes, or desktop UI changes.
  - No refactor of unrelated dirty files in `run-store`, `json-rpc`, or persistence.
  - No redesign of `executeModeSpec` or mode driver semantics.

## Constraints
- Compatibility: `apps/runtime/src/index.ts` and `run-store.ts` must keep importing `executeRuntimeKernel` unchanged.
- Performance: no additional model/tool calls; no changed runtime tool cache semantics.
- Risk: the runtime kernel is central and test-heavy; each extraction should preserve behavior and run typecheck/tests when enough code has moved.
- Tool/Environment limits: current working tree has unrelated dirty files; do not touch or revert them.

## Assumptions
- A staged, behavior-equivalent split is preferable to a single large rewrite.
- It is acceptable for new extracted modules to start with explicit dependency objects, then simplify after tests pass.
- The task is not DONE until runtime typecheck and runtime tests pass, or any inability to run them is recorded.

## Plan
1. `tasks/TASK-20260428-0041-runtime-kernel-structural-split.md` -> record this plan as the single source of truth. Verify by reading it back.
2. `apps/runtime/src/harness/runtime-clarifications.ts` -> move intent preflight constants/parsers/provider call out of `runtime-kernel.ts`. Verify with typecheck and existing clarification smoke tests later.
3. `apps/runtime/src/harness/runtime-progress.ts` -> move progress narration classification/counting/provider narration out of kernel. Verify progress narration smoke tests later.
4. `apps/runtime/src/harness/runtime-output.ts` -> move forced-final response coercion and output metadata helpers where practical. Verify tool budget / forced final smoke tests later.
5. `apps/runtime/src/harness/node-runtime-loop.ts` -> extract `runNodeRuntimeLoop` with an explicit dependency object. Verify native and fallback tool tests, dangling tool repair, tool budget, approval, and recovery tests.
6. `apps/runtime/src/harness/runtime-action-runner.ts` -> unify action proposal, policy evaluation, approval interruption/resume, running/succeeded/failed event transitions for normal and alternate tool execution.
7. `apps/runtime/src/harness/runtime-pattern-context.ts` -> extract construction of the `PatternExecutionContext` facade once lower-level functions have stable homes.
8. Run verification: `pnpm --filter @ora/runtime typecheck`, targeted runtime smoke tests if supported, and `pnpm --filter @ora/runtime test`.

## Active Files
- `apps/runtime/src/harness/runtime-kernel.ts`
- `apps/runtime/src/harness/runtime-clarifications.ts`
- `apps/runtime/src/harness/runtime-progress.ts`
- `apps/runtime/src/harness/runtime-output.ts`
- `apps/runtime/src/harness/node-runtime-loop.ts`
- `apps/runtime/src/harness/runtime-action-runner.ts`
- `apps/runtime/src/harness/runtime-pattern-context.ts`
- `tasks/TASK-20260428-0041-runtime-kernel-structural-split.md`

## Decisions
- Decision: Split in behavior-equivalent layers, starting with leaf modules before extracting `runNodeRuntimeLoop`.
  - Why: the kernel has many shared mutable services; moving leaf code first makes dependencies visible and lowers risk.
  - Alternatives: directly move the entire loop into a class; leave file unchanged and only document the smell.
  - Tradeoffs: slower progress, but each step is smaller and easier to verify.
- Decision: Keep the public facade file named `runtime-kernel.ts`.
  - Why: callers already depend on that module path.
  - Alternatives: rename the kernel file and add a compatibility re-export.
  - Tradeoffs: the facade still has orchestration code, but import stability is preserved.

## Progress Log
- 2026-04-28 00:41 - Task created and filled with scope, assumptions, staged plan, checkpoints, and verification gates.
  Next: extract intent clarification helpers; update kernel imports; run typecheck or targeted tests if the first extraction compiles.
- 2026-04-28 00:45 - Extracted intent clarification preflight constants, provider call, and parsers into `runtime-clarifications.ts`; runtime typecheck passed.
  Next: extract progress narration helpers; update TODO/checkpoint evidence; run typecheck again.
- 2026-04-28 00:49 - Extracted progress narration into `runtime-progress.ts`; full runtime typecheck is currently blocked by unrelated dirty `run-store.ts` `fs` errors, but runtime tests passed.
  Next: extract low-risk output/completion metadata helpers, then reassess before moving the node tool loop.
- 2026-04-28 00:52 - Extracted forced-final prompt, response coercion, rejected tool-intent event helper, and output metadata helpers into `runtime-output.ts`; runtime smoke test command passed again.
  Next: SAVEPOINT before broader loop/action extraction; then extract a small action/approval helper or prepare node loop dependencies.
- 2026-04-28 00:56 - Extended `runtime-clarifications.ts` to own resume answer resolution and `ensureRuntimeClarification`; runtime smoke test command passed again.
  Next: extract recoverable node/delegated task support helpers, then update checkpoint evidence.
- 2026-04-28 01:00 - Extracted `runRecoverableNode` and `runDelegatedTask` bodies into `runtime-node-support.ts`; exact runtime smoke, runtime integration, and session thread tests passed. Broad test command is noisy because unrelated dirty `run-store.ts` breaks `custom-agents.test.ts`.
  Next: choose the next boundary: action/approval helper first, then full `runNodeRuntimeLoop`.
- 2026-04-28 01:07 - Added `runtime-action-runner.ts` and routed normal tool approval, alternate tool approval, and agent manual approval through shared helpers; exact runtime smoke/integration/session tests passed.
  Next: move full `runNodeRuntimeLoop` to `node-runtime-loop.ts` with explicit dependency injection.
- 2026-04-28 01:15 - Moved full `runNodeRuntimeLoop` into `node-runtime-loop.ts` with explicit dependencies; fixed missing `actionLedger` dependency caught by runtime smoke; full runtime typecheck and test suite now pass.
  Next: decide whether to extract `runtime-pattern-context.ts` and remaining tool success/failure transitions, then close DONE gates.
- 2026-04-28 01:22 - Extracted `runtime-pattern-context.ts` and deduplicated remaining normal/alternate tool success/failure transitions through `runtime-action-runner.ts`; full runtime typecheck and tests pass.
  Next: close protocol verification, retrospective, and evidence gates.

## Open Issues
- None currently.

## TODO
- None.

## Retrospective
- Status: local_only
  - Evidence: Moving the closure-heavy `runNodeRuntimeLoop` initially missed the captured `actionLedger` dependency. Exact runtime smoke failed with many tool-loop cases, and the fix was to bind `const { actionLedger } = actionDeps()` in the extracted module.
  - Guardrail: When moving large closure bodies, scan for every free variable after extraction and prefer dependency-object destructuring close to first use.
- Status: local_only
  - Evidence: The repo-wide long-task `todo_scan.sh` reports historical task-file and source comments across the whole workspace, making it noisy for this scoped refactor.
  - Guardrail: Record the repo-wide noise, then use a source-scoped fallback scan over task-owned files for the actual DONE gate.

## Functional Verification

### Code Verification (Code Correctness)
- [x] Code compiles/runs without errors.
- [x] Unit tests pass.
- [x] Lint checks pass or lint absence is recorded.

**Output**: `pnpm --filter @ora/runtime typecheck` passed. `pnpm --filter @ora/runtime test` passed 13 files / 208 tests. No separate lint script was run for this package; `git diff --check` passed for touched harness/task files.

### Functional Verification (Feature Works)
- [x] Clarification preflight/resume behavior preserved.
- [x] Progress narration behavior preserved.
- [x] Tool call, approval, forced-final, dangling repair, and recovery behavior preserved.
- [x] Pattern execution snapshots/checkpoints preserved.

**Output**: Existing runtime smoke, integration, session-thread, and full runtime test suite passed after the extraction. Snapshot validation remains routed through `StateSnapshotSchema.parse` in the kernel path.

## Comparison

### Reference
- Existing `runtime-kernel.ts` at task start.
- Prior completed task: `tasks/TASK-runtime-kernel-split.md`.

### Comparison Points
- [x] Public runtime API unchanged.
- [x] Event order and event payload contracts remain covered by existing tests.
- [x] Snapshot shape remains validated by `StateSnapshotSchema.parse`.
- [x] New modules map to real responsibilities rather than arbitrary file-size cuts.

### Findings
- Consistency: `executeRuntimeKernel`, `RuntimeKernelOptions`, and `RuntimeKernelResult` remain exported from `runtime-kernel.ts`; callers do not need import changes.
- Differences: Responsibility-focused harness modules now own clarification, progress narration, output metadata, node support, action running, the node runtime loop, and pattern context construction.
- Conclusion: The split preserves behavior while reducing `runtime-kernel.ts` from 2640 lines at task start to 1390 lines.

## Checkpoints

### Checkpoint 1: Task Source Of Truth
- Requirement: This task file contains scope, assumptions, plan, active files, TODO, checkpoints, and verification gates.
- Verification method: Read back the task file after creation.
- Status: Pass.
- Evidence: Created `tasks/TASK-20260428-0041-runtime-kernel-structural-split.md` and reviewed content.

### Checkpoint 2: Leaf Extraction
- Requirement: Intent clarification and progress narration helpers move out without behavior changes.
- Verification method: Typecheck plus relevant runtime smoke tests.
- Status: Pass.
- Evidence: Intent clarification, progress narration, output helpers, clarification state, and node support helpers extracted. Initial `pnpm --filter @ora/runtime typecheck` exited 0; later full typecheck is blocked by unrelated dirty `run-store.ts`. Exact runtime smoke, runtime integration, and session thread tests pass.

### Checkpoint 3: Node Loop Extraction
- Requirement: `runNodeRuntimeLoop` lives outside `runtime-kernel.ts` and keeps tool/provider behavior unchanged.
- Verification method: Typecheck plus runtime tests covering tools, approvals, forced final, repair, and recovery.
- Status: Pass.
- Evidence: `node-runtime-loop.ts` owns the full loop. `pnpm --filter @ora/runtime typecheck` exited 0 and `pnpm --filter @ora/runtime test` passed 13 files / 208 tests.

### Checkpoint 4: DONE Gate
- Requirement: TODO gate, code verification, functional verification, retrospective, and evidence are complete.
- Verification method: Long-task protocol gates.
- Status: Pass.
- Evidence: Task open items are empty; scoped source scan found no unchecked checkboxes/TODO markers in touched harness files; typecheck, full runtime tests, diff whitespace check, comparison, and retrospective evidence are recorded below.

## Compressed State (<= 20 lines)
- Objective: Continue behavior-equivalent structural split of `runtime-kernel.ts`.
- Done: Analysis completed; task file created; leaf helpers extracted; action/approval helper extracted; full `runNodeRuntimeLoop` moved to `node-runtime-loop.ts`; pattern context and remaining tool success/failure helpers extracted; runtime typecheck and tests pass.
- In-progress: None.
- Active files: `runtime-kernel.ts`, planned new harness modules, this task file.
- Next actions (top 3; exact file/function): none for this task.
- Blockers/Risks: unrelated dirty files exist and were not touched.
- Verification status: Full `pnpm --filter @ora/runtime typecheck` and `pnpm --filter @ora/runtime test` pass after all planned extractions.

## Verification

### Evidence Requirements
- [x] Code Verification output (compilation/tests/lint)
- [x] Functional Verification output (feature verification)
- [x] Retrospective Evidence (if applicable)
- [x] Comparison Evidence (if applicable)
- [x] Checkpoints Evidence (if applicable)

### Environment
- Environment: `/Users/quintenchen/developer/Ora`, 2026-04-28, existing dirty worktree with unrelated files.

### Commands run + outputs
- `wc -l apps/runtime/src/harness/runtime-kernel.ts`
```text
2640 apps/runtime/src/harness/runtime-kernel.ts
```
- `git status --short`
```text
 M apps/runtime/src/index.ts
 M apps/runtime/src/json-rpc.ts
 M apps/runtime/src/persistence/sqlite-backend.ts
 M apps/runtime/src/run-store.ts
?? apps/runtime/src/persistence/json-file-backend.ts
?? apps/runtime/src/persistence/types.ts
?? apps/runtime/src/runtime-errors.ts
?? tasks/TASK-20260428-0038-run-store-architecture-split.md
```
- `pnpm --filter @ora/runtime typecheck`
```text
> @ora/runtime@0.1.0 typecheck /Users/quintenchen/developer/Ora/apps/runtime
> tsc -p tsconfig.json --noEmit

exit code 0
```
- `wc -l apps/runtime/src/harness/runtime-kernel.ts apps/runtime/src/harness/runtime-clarifications.ts`
```text
2571 apps/runtime/src/harness/runtime-kernel.ts
80 apps/runtime/src/harness/runtime-clarifications.ts
2651 total
```
- `pnpm --filter @ora/runtime typecheck` after progress extraction
```text
> @ora/runtime@0.1.0 typecheck /Users/quintenchen/developer/Ora/apps/runtime
> tsc -p tsconfig.json --noEmit

src/run-store.ts(4123,16): error TS2304: Cannot find name 'fs'.
src/run-store.ts(4811,47): error TS2503: Cannot find namespace 'fs'.
src/run-store.ts(4811,65): error TS2503: Cannot find namespace 'fs'.
exit code 2
```
- `pnpm --filter @ora/runtime test -- runtime-smoke.test.ts`
```text
Test Files  13 passed (13)
Tests  208 passed (208)
exit code 0
```
- `git diff --check -- apps/runtime/src/harness/runtime-kernel.ts apps/runtime/src/harness/runtime-clarifications.ts apps/runtime/src/harness/runtime-progress.ts tasks/TASK-20260428-0041-runtime-kernel-structural-split.md`
```text
exit code 0
```
- `pnpm --filter @ora/runtime test -- runtime-smoke.test.ts` after output extraction
```text
Test Files  13 passed (13)
Tests  208 passed (208)
exit code 0
```
- `git diff --check -- apps/runtime/src/harness/runtime-kernel.ts apps/runtime/src/harness/runtime-output.ts tasks/TASK-20260428-0041-runtime-kernel-structural-split.md`
```text
exit code 0
```
- `wc -l apps/runtime/src/harness/runtime-kernel.ts apps/runtime/src/harness/runtime-output.ts`
```text
2406 apps/runtime/src/harness/runtime-kernel.ts
142 apps/runtime/src/harness/runtime-output.ts
2548 total
```
- `pnpm --filter @ora/runtime test -- runtime-smoke.test.ts` after clarification state extraction
```text
Test Files  13 passed (13)
Tests  208 passed (208)
exit code 0
```
- `wc -l apps/runtime/src/harness/runtime-kernel.ts apps/runtime/src/harness/runtime-clarifications.ts apps/runtime/src/harness/runtime-progress.ts apps/runtime/src/harness/runtime-output.ts`
```text
2350 apps/runtime/src/harness/runtime-kernel.ts
195 apps/runtime/src/harness/runtime-clarifications.ts
127 apps/runtime/src/harness/runtime-progress.ts
142 apps/runtime/src/harness/runtime-output.ts
2814 total
```
- Broad runtime test command after node-support extraction
```text
pnpm --filter @ora/runtime test -- runtime-smoke.test.ts

custom-agents.test.ts failed due unrelated dirty run-store error:
ReferenceError: CustomAgentGenerateDraftParamsSchema is not defined
runtime-smoke.test.ts itself passed in that run.
exit code 1
```
- Exact runtime smoke after node-support extraction
```text
pnpm --filter @ora/runtime exec vitest run test/runtime-smoke.test.ts

Test Files  1 passed (1)
Tests  57 passed (57)
exit code 0
```
- Exact runtime integration/session tests after node-support extraction
```text
pnpm --filter @ora/runtime exec vitest run test/runtime-integration.test.ts test/session-thread.test.ts

Test Files  2 passed (2)
Tests  46 passed (46)
exit code 0
```
- `wc -l apps/runtime/src/harness/runtime-kernel.ts apps/runtime/src/harness/runtime-node-support.ts`
```text
2238 apps/runtime/src/harness/runtime-kernel.ts
192 apps/runtime/src/harness/runtime-node-support.ts
2430 total
```
- Exact runtime tests after action/approval helper extraction
```text
pnpm --filter @ora/runtime exec vitest run test/runtime-smoke.test.ts
Test Files  1 passed (1)
Tests  57 passed (57)

pnpm --filter @ora/runtime exec vitest run test/runtime-integration.test.ts test/session-thread.test.ts
Test Files  2 passed (2)
Tests  46 passed (46)
exit code 0
```
- During node-loop extraction, exact runtime smoke initially failed due a missing `actionLedger` dependency in `node-runtime-loop.ts`; fixed by binding `const { actionLedger } = actionDeps()`.
```text
runtime-smoke initial node-loop move result:
Test Files  1 failed (1)
Tests  20 failed | 37 passed (57)
Root cause: actionLedger was referenced inside moved loop but not provided in module scope.
```
- `pnpm --filter @ora/runtime exec tsc -p tsconfig.json --noEmit --pretty false` after fix
```text
exit code 0
```
- `pnpm --filter @ora/runtime exec vitest run test/runtime-smoke.test.ts` after node-loop fix
```text
Test Files  1 passed (1)
Tests  57 passed (57)
exit code 0
```
- `pnpm --filter @ora/runtime exec vitest run test/runtime-integration.test.ts test/session-thread.test.ts` after node-loop fix
```text
Test Files  2 passed (2)
Tests  46 passed (46)
exit code 0
```
- `pnpm --filter @ora/runtime typecheck`
```text
> @ora/runtime@0.1.0 typecheck /Users/quintenchen/developer/Ora/apps/runtime
> tsc -p tsconfig.json --noEmit

exit code 0
```
- `pnpm --filter @ora/runtime test`
```text
Test Files  13 passed (13)
Tests  208 passed (208)
exit code 0
```
- `wc -l apps/runtime/src/harness/runtime-kernel.ts apps/runtime/src/harness/node-runtime-loop.ts apps/runtime/src/harness/runtime-action-runner.ts apps/runtime/src/harness/runtime-clarifications.ts apps/runtime/src/harness/runtime-progress.ts apps/runtime/src/harness/runtime-output.ts apps/runtime/src/harness/runtime-node-support.ts`
```text
1388 apps/runtime/src/harness/runtime-kernel.ts
896 apps/runtime/src/harness/node-runtime-loop.ts
164 apps/runtime/src/harness/runtime-action-runner.ts
195 apps/runtime/src/harness/runtime-clarifications.ts
127 apps/runtime/src/harness/runtime-progress.ts
142 apps/runtime/src/harness/runtime-output.ts
192 apps/runtime/src/harness/runtime-node-support.ts
3104 total
```
- `pnpm --filter @ora/runtime typecheck` after final helper extraction
```text
> @ora/runtime@0.1.0 typecheck /Users/quintenchen/developer/Ora/apps/runtime
> tsc -p tsconfig.json --noEmit

exit code 0
```
- `pnpm --filter @ora/runtime test` after final helper extraction
```text
Test Files  13 passed (13)
Tests  208 passed (208)
exit code 0
```
- `git diff --check -- apps/runtime/src/harness/runtime-kernel.ts apps/runtime/src/harness/node-runtime-loop.ts apps/runtime/src/harness/runtime-action-runner.ts apps/runtime/src/harness/runtime-clarifications.ts apps/runtime/src/harness/runtime-progress.ts apps/runtime/src/harness/runtime-output.ts apps/runtime/src/harness/runtime-node-support.ts apps/runtime/src/harness/runtime-pattern-context.ts tasks/TASK-20260428-0041-runtime-kernel-structural-split.md`
```text
exit code 0
```
- Long-task repo-wide `todo_scan.sh`
```text
The script scans every `TODO` string in the repository and produced unrelated historical task/source noise. No process remained running after checking `ps`.
```
- Scoped DONE fallback scan over task-owned harness files
```text
rg --pcre2 -n "TODO(?!\\(FOLLOWUP\\))|FIXME|XXX|\\[ \\]" apps/runtime/src/harness/runtime-kernel.ts apps/runtime/src/harness/node-runtime-loop.ts apps/runtime/src/harness/runtime-action-runner.ts apps/runtime/src/harness/runtime-clarifications.ts apps/runtime/src/harness/runtime-progress.ts apps/runtime/src/harness/runtime-output.ts apps/runtime/src/harness/runtime-node-support.ts apps/runtime/src/harness/runtime-pattern-context.ts

exit code 1; no matches
```
- `wc -l apps/runtime/src/harness/runtime-kernel.ts apps/runtime/src/harness/node-runtime-loop.ts apps/runtime/src/harness/runtime-action-runner.ts apps/runtime/src/harness/runtime-pattern-context.ts`
```text
1390 apps/runtime/src/harness/runtime-kernel.ts
835 apps/runtime/src/harness/node-runtime-loop.ts
277 apps/runtime/src/harness/runtime-action-runner.ts
7 apps/runtime/src/harness/runtime-pattern-context.ts
2509 total
```
