# TASK-runtime-kernel-split

**Created:** 2026-04-26
**Status:** DONE

---

## Goal
- Split `apps/runtime/src/harness/runtime-kernel.ts` into smaller runtime harness modules without changing public API, runtime behavior, event schema, snapshot shape, or desktop-facing contracts.

## Scope / Out of scope
- In scope:
  - Move stateless helpers, approval/clarification interrupts, tool-call ledger helpers, prompt helpers, and completion/tool-budget state out of `runtime-kernel.ts`.
  - Keep `executeRuntimeKernel`, `RuntimeKernelOptions`, and `RuntimeKernelResult` exported from `runtime-kernel.ts`.
  - Preserve existing uncommitted behavior in `runtime-kernel.ts`.
- Out of scope:
  - Refactoring `RuntimeToolExecutor`.
  - Changing mode execution behavior, desktop view models, event names, or shared schemas.

## Constraints
- Compatibility: behavior-equivalent refactor only.
- Performance: no extra provider/tool calls, no changed caching semantics.
- Risk: runtime kernel is a central execution path; validate with runtime typecheck and tests.
- Tool/Environment limits: avoid rewriting unrelated dirty working tree changes.

## Plan
1. Create focused harness modules for interrupts, prompts, tool-loop helpers/ledger, and completion control.
2. Update `runtime-kernel.ts` imports and replace inline helper/state blocks with module calls.
3. Run `pnpm --filter @ora/runtime typecheck` and `pnpm --filter @ora/runtime test`.
4. Record verification evidence and close retrospective.

## Active Files
- `apps/runtime/src/harness/runtime-kernel.ts`
- `apps/runtime/src/harness/runtime-interrupts.ts`
- `apps/runtime/src/harness/runtime-prompts.ts`
- `apps/runtime/src/harness/runtime-tool-loop.ts`
- `apps/runtime/src/harness/runtime-tool-ledger.ts`
- `apps/runtime/src/harness/runtime-completion.ts`
- `tasks/TASK-runtime-kernel-split.md`

## Decisions
- Decision: Keep `runNodeRuntimeLoop` and `callAgent` inside `runtime-kernel.ts` for this pass.
  - Why: They share a lot of kernel-local state, so extracting them now would increase risk.
  - Alternatives: Extract the whole node loop into a class immediately.
  - Tradeoffs: Kernel remains substantial, but the first split stays behavior-equivalent and reviewable.

## Progress Log
- 2026-04-26 - Task created; found existing dirty working tree and two existing edits in `runtime-kernel.ts` that must be preserved.
  Next: Add harness helper modules, update kernel imports, then run runtime verification.
- 2026-04-26 - Extracted runtime helper modules and rewired `runtime-kernel.ts` to use `RuntimeCompletionController`, `RuntimeToolCallLedger`, prompt helpers, interrupt helpers, and tool-loop helpers.
  Next: Run typecheck and tests, then record verification.
- 2026-04-26 - Verification passed: runtime typecheck succeeded and all runtime tests passed.
  Next: Close task with verification evidence and retrospective.

## Open Issues
- None.

## TODO
- DONE: Extract helper modules.
- DONE: Update `runtime-kernel.ts` to use extracted modules.
- DONE: Run runtime typecheck.
- DONE: Run runtime tests.
- DONE: Update verification and retrospective.

## Retrospective
### Item 1
- Pitfall: A behavior-equivalent split can still drop uncommitted local fixes if helpers are copied from memory instead of the current file.
- Symptom: `runtime-kernel.ts` already had dirty changes for progress narration language matching and approval-resume input comparison.
- Root Cause: Refactors often target the conceptual base version instead of the actual working tree.
- Reusable Guardrail: Inspect `git diff -- <file>` before moving code out of any dirty file, then verify the moved code preserves those exact deltas.
- Evidence: Existing dirty diff was reviewed before extraction; the moved helper kept `approvalComparableInput`, and progress narration text remained in kernel.
- Scope: local_only
- Suggested Writeback Target: none
- Status: local_only

## Functional Verification

### Code Verification (Code Correctness)
- DONE: Code compiles/runs without errors.
- DONE: Unit tests pass.
- N/A: No runtime lint script is defined in `apps/runtime/package.json`; typecheck is the compile gate.

**Output**:
```text
pnpm --filter @ora/runtime typecheck
> @ora/runtime@0.1.0 typecheck /Users/quintenchen/developer/ora/apps/runtime
> tsc -p tsconfig.json --noEmit

exit code 0
```

### Functional Verification (Feature Works)
- DONE: Existing runtime smoke coverage still passes for tool calls, completion control, approval/resume, clarification, dangling tool repair, and recovery fallback.

**Output**:
```text
pnpm --filter @ora/runtime test
Test Files  12 passed (12)
Tests  182 passed (182)
exit code 0
```

## Comparison

### Reference
- Existing `runtime-kernel.ts` behavior before split.

### Comparison Points
- DONE: Public exports unchanged.
- DONE: Event/snapshot contracts unchanged.
- DONE: Runtime smoke tests unchanged.

### Findings
- Consistency: `executeRuntimeKernel`, `RuntimeKernelOptions`, and `RuntimeKernelResult` remain exported from `runtime-kernel.ts`.
- Differences: Helper implementations now live in focused harness modules; no schema or event changes.
- Conclusion: Behavior-equivalent split passed runtime verification.

## Checkpoints

### Checkpoint 1: Public Runtime API
- Requirement: Keep `executeRuntimeKernel`, `RuntimeKernelOptions`, and `RuntimeKernelResult` available from `harness/runtime-kernel.ts`.
- Verification method: Typecheck and existing imports.
- Status: Pass.
- Evidence: `pnpm --filter @ora/runtime typecheck` exited 0.

### Checkpoint 2: Runtime Behavior
- Requirement: Existing runtime tests pass without event/schema changes.
- Verification method: `pnpm --filter @ora/runtime test`.
- Status: Pass.
- Evidence: 12 test files and 182 tests passed.

## Compressed State (<= 20 lines)
- Objective: Behavior-equivalent split of `runtime-kernel.ts`.
- Done: Task journal created; helper modules extracted; kernel rewired; typecheck and tests passed.
- In-progress: None.
- Active files: runtime kernel plus new harness split modules and this task file.
- Next actions (top 3; exact file/function): none for this task.
- Blockers/Risks: None known.
- Verification status: Passed `pnpm --filter @ora/runtime typecheck` and `pnpm --filter @ora/runtime test`.

## Verification

### Evidence Requirements
- DONE: Code Verification output (compilation/tests/lint)
- DONE: Functional Verification output (feature verification)
- DONE: Retrospective Evidence (if applicable)
- DONE: Comparison Evidence (if applicable)
- DONE: Checkpoints Evidence (if applicable)

### Environment
- Environment: `/Users/quintenchen/developer/ora`, local workspace, 2026-04-26.

### Commands run + outputs
- `bash /Users/quintenchen/developer/quantfox/.codex/skills/long-task-protocol/scripts/todo_scan.sh`
```text
TODO scan mode: task
Task file: /Users/quintenchen/developer/quantfox/tasks/TASK-20260417-0051-equity-research-analysis-result-memory.md
Blocking TODO matches:
- none
Blocking task-journal TODO entries:
- none
Result: PASS
```
- Note: the bundled long-task scan script resolved a Quantfox task instead of this Ora journal, so the local Ora journal was scanned directly below.
- Local Ora journal scan for unchecked boxes and pending markers.
```text
exit code 1
no matches
```
- `wc -l apps/runtime/src/harness/runtime-kernel.ts apps/runtime/src/harness/runtime-completion.ts apps/runtime/src/harness/runtime-interrupts.ts apps/runtime/src/harness/runtime-prompts.ts apps/runtime/src/harness/runtime-tool-ledger.ts apps/runtime/src/harness/runtime-tool-loop.ts`
```text
1709 apps/runtime/src/harness/runtime-kernel.ts
185 apps/runtime/src/harness/runtime-completion.ts
59 apps/runtime/src/harness/runtime-interrupts.ts
93 apps/runtime/src/harness/runtime-prompts.ts
67 apps/runtime/src/harness/runtime-tool-ledger.ts
72 apps/runtime/src/harness/runtime-tool-loop.ts
2185 total
```
- `pnpm --filter @ora/runtime typecheck`
```text
> @ora/runtime@0.1.0 typecheck /Users/quintenchen/developer/ora/apps/runtime
> tsc -p tsconfig.json --noEmit

exit code 0
```
- `pnpm --filter @ora/runtime test`
```text
✓ test/providers/provider-registry.test.ts (22 tests)
✓ test/runtime-tool-executor.test.ts (13 tests)
✓ test/desktop-composer-state.test.ts (28 tests)
✓ test/desktop-runtime-client.test.ts (5 tests)
✓ test/provider-health.test.ts (5 tests)
✓ test/sqlite-checkpointer.test.ts (10 tests)
✓ test/runtime-integration.test.ts (24 tests)
✓ test/session-thread.test.ts (15 tests)
✓ test/skills.test.ts (5 tests)
✓ test/custom-agents.test.ts (3 tests)
✓ test/graph-adapter.test.ts (2 tests)
✓ test/runtime-smoke.test.ts (50 tests)

Test Files  12 passed (12)
Tests  182 passed (182)
```
