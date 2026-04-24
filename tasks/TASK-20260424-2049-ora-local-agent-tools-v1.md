# TASK-20260424-2049-ora-local-agent-tools-v1

**Created:** 2026-04-24 20:49 CST
**Status:** Done

---

## Goal
- Move Ora local agent tools from registry-only declarations to a model-callable runtime tool layer for core local-agent workflows: workspace read/search/edit, safer shell execution, web fetch/search, and minimal MCP calls, with approval/event/trace behavior flowing through one executor path.

## Scope / Out of scope
- In scope: runtime tool executor, shared tool descriptors, workspace file/search/write/patch tools, upgraded shell output contract, web fetch/search, minimal MCP stdio/http client, Mode Studio tool listing, focused tests.
- Out of scope: browser automation, computer-use, screenshots, Jupyter, image/doc/spreadsheet special tools, MCP marketplace, broad UI redesign.

## Constraints
- Compatibility: Preserve existing JSON-RPC/bootstrap contracts and existing `file.read` / `shell.execute` behavior where possible.
- Performance: Keep local filesystem reads/searches bounded and rooted inside the selected project folder.
- Risk: Write/patch/shell/MCP operations must remain approval-aware and produce `tool.called` / `action.updated` events.
- Tool/Environment limits: Worktree already has broad unrelated edits; do not revert unrelated changes.

## Plan
1. Add a runtime tool executor under `apps/runtime/src/harness` and route `runtime-kernel` tool-loop through it.
2. Extend shared tool descriptors/contracts for implemented tools and first-batch file/search/web/MCP descriptors.
3. Update Mode Studio workspace tool panel to reflect implemented registry tools grouped by risk.
4. Add runtime/shared tests for descriptor coverage, sandboxing, approval/write/patch, shell output, web, and fake MCP.
5. Run focused shared/runtime/desktop verification and record evidence.

## Active Files
- packages/shared/src/index.ts
- packages/shared/test/contracts.test.ts
- apps/runtime/src/harness/runtime-kernel.ts
- apps/runtime/src/harness/runtime-tool-executor.ts
- apps/runtime/test/runtime-smoke.test.ts
- apps/runtime/test/runtime-tool-executor.test.ts
- apps/runtime/src/patterns/driver-registry.ts
- apps/runtime/src/patterns/generator-verifier-utils.ts
- apps/desktop/src/components/ModesView.tsx

## Decisions
- Decision:
  - Use one executor module instead of scattering tool execution across the kernel.
  - Why: It keeps policy, sandboxing, result shape, and future tool additions auditable.
  - Alternatives: Extend the existing inline helpers in `runtime-kernel.ts`.
  - Tradeoffs: Adds one file, but removes growth pressure from the kernel.

## Progress Log
- 2026-04-24 20:49 CST - Task created
  Next: Fill in Goal, Scope, Plan, and list Active Files
- 2026-04-24 20:51 CST - Filled task scope and implementation plan; confirmed existing dirty worktree spans shared/runtime/desktop.
  Next: Inspect tests and kernel seams, implement executor, update contracts.
- 2026-04-24 20:57 CST - Added `RuntimeToolExecutor`, expanded shared tool descriptors, rewired runtime-kernel tool loop, and updated Mode Studio to group implemented tools by risk.
  Next: Run focused shared/runtime/desktop verification and fix compatibility failures.
- 2026-04-24 20:59 CST - Fixed compatibility issues: preserved `Workspace tool protocol` prompt marker for existing session tests, tightened verifier keyword parsing, and defaulted generator-verifier local provider assessment to `local-smoke` when no provider is configured.
  Next: Record verification evidence and close journal.

## Open Issues
- [x] Need to keep MCP v1 minimal enough to fit current dependency set without adding a full SDK unless tests prove it is needed.
- [ ] TODO scan reports pre-existing generated sidecar bundle TODOs and binary matches under `apps/desktop/src-tauri/resources/runtime-sidecar/`; not touched by this task.

## TODO
- TODO(FOLLOWUP): Decide whether generated `apps/desktop/src-tauri/resources/runtime-sidecar/` should be removed from the working tree before future DONE-gate scans; current scan noise is from generated payloads, not source TODOs.

## Retrospective
- Record 0-3 highest-value pitfalls from this task.
- Leave reusable operational lessons here even when they later get promoted into a skill.

### Item 1
- Pitfall: Broadening tool prompt text can break tests or providers that key off existing protocol markers.
- Symptom: Session-thread tests stopped triggering shell tool calls after `Workspace tool protocol:` changed to `Runtime tool protocol:`.
- Root Cause: Existing mocked provider used the old marker to decide whether to emit tool-call JSON.
- Reusable Guardrail: Preserve compatibility markers when replacing ad-hoc protocol prompts with a generalized executor.
- Evidence: `session-thread.test.ts` failed before restoring the marker; passed after.
- Scope: Ora runtime tool-loop prompt compatibility.
- Suggested Writeback Target: none
- Status: local_only

## Functional Verification

### Code Verification (Code Correctness)
- [x] Code compiles/runs without errors
- [x] Unit tests pass
- [ ] Lint checks pass

**Output**: Paste command outputs
- `pnpm --filter @ora/runtime typecheck` passed.
- `pnpm --filter @ora/desktop typecheck` passed.
- `pnpm --filter @ora/shared test -- contracts.test.ts` passed: 68 tests.
- `pnpm --filter @ora/runtime test -- runtime-tool-executor.test.ts session-thread.test.ts runtime-smoke.test.ts` passed: 10 files, 90 tests.
- Lint was not run; repo-level lint scope is broader than this surgical change and no targeted lint script exists for the touched packages.

### Functional Verification (Feature Works)
- [x] Core functionality verification (runtime tool executor test)
- [x] Edge cases verification
- [x] Error handling verification

**Output**: Paste verification results
- Runtime executor tests covered implemented descriptor coverage, file read/list/glob/grep, root escape rejection, write/patch, shell risk gating, local HTTP fetch, and fake stdio MCP list/call/resource read.
- Session-thread tests covered model tool-loop execution and blocked absolute shell paths.

**Examples**:
- Database: `SELECT * FROM table WHERE field_name IS NOT NULL LIMIT 5;`
- API: `curl "url" | jq '.results[0].field_name'`
- UI: Manual test steps and results
- Bug fix: Verification bug is fixed

## Comparison (If Applicable)

### Reference
- Reference implementation/template/similar task: _______

### Comparison Points
- [ ] Comparison point 1: _______
- [ ] Comparison point 2: _______
- [ ] Comparison point 3: _______

### Findings
- Consistency: Ora now matches the core local-agent baseline for file read/search/edit, shell, web fetch/search, and MCP entrypoints.
- Differences: Browser automation/computer-use and rich MCP marketplace remain intentionally out of scope.
- Conclusion: v1 tool surface is now executable, bounded, and approval-aware.

## Checkpoints

### Checkpoint 1: Tool descriptors are executable or deferred
- Requirement: Implemented tools must have executor coverage or explicit `implemented: false`.
- Verification method: shared contract and runtime executor tests.
- Status: [x] Pass / [ ] Fail
- Evidence: `MVP_TOOLS` descriptor test and `RuntimeToolExecutor` implemented descriptor test passed.

### Checkpoint 2: Runtime tool-loop remains compatible
- Requirement: Existing run/session flows keep ordered events and tool-result loops.
- Verification method: runtime smoke and session-thread tests.
- Status: [x] Pass / [ ] Fail
- Evidence: `pnpm --filter @ora/runtime test -- runtime-tool-executor.test.ts session-thread.test.ts runtime-smoke.test.ts` passed.

**All checkpoints must pass before marking task DONE!**

## Compressed State (<= 20 lines)
- Objective: Implement Ora local agent tools v1 from the approved plan.
- Done: Added unified executor, implemented file/search/write/patch, shell risk gating, web fetch/search, stdio/http MCP calls, shared descriptors, Mode Studio grouping, and tests.
- In-progress: None.
- Active files: shared schema/contracts, runtime kernel/executor/tests, generator-verifier compatibility fix, desktop ModesView.
- Next actions (top 3; exact file/function): optional follow-up to clean generated sidecar scan noise; no code blocker.
- Blockers/Risks: Generated sidecar TODO/binary scan noise remains outside source edits.
- Verification status: shared contract, runtime typecheck, desktop typecheck, runtime focused tests passed.

## Verification

### Evidence Requirements
Must provide the following evidence:
- [x] Code Verification output (compilation/tests/lint)
- [x] Functional Verification output (feature verification)
- [x] Retrospective Evidence (if applicable)
- [x] Comparison Evidence (if applicable)
- [x] Checkpoints Evidence (if applicable)

### Environment
- Environment: cwd `/Users/quintenchen/developer/ora`, pnpm monorepo, current worktree had pre-existing generated sidecar artifacts.

### Commands run + outputs
- `pnpm --filter @ora/shared test -- contracts.test.ts` -> passed, 68 tests.
- `pnpm --filter @ora/runtime typecheck` -> passed.
- `pnpm --filter @ora/desktop typecheck` -> passed.
- `pnpm --filter @ora/runtime test -- runtime-tool-executor.test.ts session-thread.test.ts runtime-smoke.test.ts` -> passed, 10 files, 90 tests.
- `bash skills/long-task-protocol/scripts/todo_scan.sh` -> reported generated sidecar TODOs and binary matches under `.ora/runtime.db` and `apps/desktop/src-tauri/resources/runtime-sidecar/`; no source TODO introduced by this task.
