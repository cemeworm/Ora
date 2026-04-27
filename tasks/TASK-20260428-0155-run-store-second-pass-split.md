# TASK-20260428-0155-run-store-second-pass-split

**Created:** 2026-04-28 01:55 Asia/Shanghai
**Status:** DONE

---

## Goal
- Reassess the current 3100-line `apps/runtime/src/run-store.ts` after the prior completed split and continue only the behavior-preserving extractions with clear ownership. Keep `LocalRunStore` as the public compatibility facade while moving remaining cohesive helper domains into focused modules.

## Scope / Out of scope
- In scope:
  - Record the architecture findings and implementation plan in this task file.
  - Move runtime data-directory path helpers out of `run-store.ts`.
  - Move system/custom agent catalog and mode overlay helpers out of `run-store.ts`.
  - Move remaining Mode Studio store/provider draft orchestration out of `run-store.ts`.
  - Move approved `file.write` resume replay out of `run-store.ts`.
  - Move session title/text helpers where they are cleanly separable.
  - Run typecheck and focused/full runtime tests after meaningful slices.
- Out of scope:
  - No JSON-RPC method changes, schema changes, event-name changes, persistence format changes, or runtime behavior changes.
  - No rewrite of start/resume/streaming control flow beyond extracting cohesive helper bodies.
  - No broad cleanup of unrelated files or previously completed split modules.

## Assumptions
- File length alone is not the bug; mixed ownership inside `LocalRunStore` is the design smell.
- The safest architecture is a facade plus focused function modules, not introducing a large service framework.
- Existing tests are the behavioral contract.

## Constraints
- Compatibility: imports of `LocalRunStore`, `InMemoryRunStore`, and exported default directory helpers from `@ora/runtime` must continue to work.
- Performance: do not add model calls, file scans, persistence writes, or extra streaming flushes.
- Risk: run/resume and Mode Studio paths are central; each extraction must keep event ordering and snapshot validation unchanged.
- Tool/Environment limits: use `apply_patch` for source edits; avoid destructive git commands; preserve unrelated worktree changes.

## Plan
1. `apps/runtime/src/runtime-store-paths.ts`, `apps/runtime/src/run-store.ts`
   - Objective: move default store-directory helpers and keep re-exports/imports compatible.
   - Verify: `pnpm --filter @ora/runtime typecheck`.
2. `apps/runtime/src/agent-catalog.ts`, `apps/runtime/src/run-store.ts`
   - Objective: move system/custom agent overlay lookup, mode custom-agent context projection, system-agent id collection, and `agentCatalog` aggregation.
   - Verify: typecheck and `custom-agents.test.ts`.
3. `apps/runtime/src/mode-studio-store.ts`, `apps/runtime/src/run-store.ts`
   - Objective: move remaining Mode Studio draft/build/provider orchestration behind dependency-injected helpers; leave persistence/apply methods in `LocalRunStore`.
   - Verify: typecheck and `mode-studio-builder.test.ts`.
4. `apps/runtime/src/approved-file-write-resume.ts`, `apps/runtime/src/run-store.ts`
   - Objective: move approved `file.write` replay and final-answer generation, preserving event order and streaming callbacks.
   - Verify: typecheck and runtime smoke/session tests.
5. `apps/runtime/src/session-title.ts`, `apps/runtime/src/run-store.ts`
   - Objective: move assistant text extraction and session title generation helpers if doing so stays low-risk.
   - Verify: typecheck and session-thread/runtime smoke tests.
6. Close gates.
   - Objective: update verification, line-count evidence, retrospective, and mark DONE only after checks pass.
   - Verify: `git diff --check`, task-scoped TODO scan, runtime typecheck/tests.

## Active Files
- `tasks/TASK-20260428-0155-run-store-second-pass-split.md`
- `apps/runtime/src/run-store.ts`
- `apps/runtime/src/runtime-store-paths.ts`
- `apps/runtime/src/agent-catalog.ts`
- `apps/runtime/src/mode-studio-store.ts`
- `apps/runtime/src/approved-file-write-resume.ts`
- `apps/runtime/src/session-title.ts`

## Decisions
- Decision: Continue splitting.
  - Why: current `run-store.ts` still mixes facade methods with agent catalog building, Mode Studio provider repair, approved write replay, session title generation, memory scheduling, and migrations.
  - Alternatives: stop after the prior split because the file is already much smaller; introduce service classes for every domain.
  - Tradeoffs: targeted functions reduce size and ownership confusion while avoiding a risky framework-style rewrite.
- Decision: Keep `LocalRunStore` as facade.
  - Why: JSON-RPC and tests already treat it as the runtime entry point.
  - Alternatives: break JSON-RPC into separate service instances now.
  - Tradeoffs: the facade remains broad, but public compatibility and rollback stay simple.

## Progress Log
- 2026-04-28 01:55 - Task created after reviewing the current 3100-line `run-store.ts`, the prior completed split task, and the remaining method clusters.
  Next: move runtime store path helpers; run typecheck; update this task with evidence.
- 2026-04-28 01:57 - Moved runtime store path helpers to `apps/runtime/src/runtime-store-paths.ts`; `run-store.ts` imports and re-exports them for compatibility. Typecheck passed.
  Next: extract agent catalog and overlay helpers.
- 2026-04-28 01:59 - Moved agent catalog, system/custom overlay projection, custom-agent context lookup, and system-agent id collection to `apps/runtime/src/agent-catalog.ts`. Typecheck and `custom-agents.test.ts` passed.
  Next: extract remaining Mode Studio store/provider orchestration.
- 2026-04-28 02:02 - Moved Mode Studio draft/provider orchestration to `apps/runtime/src/mode-studio-store.ts`; fixed review nits to preserve `recommendedUse.trim()` and use `SINGLE_AGENT_MODE_ID`. Typecheck and `mode-studio-builder.test.ts` passed.
  Next: extract approved file-write resume replay.
- 2026-04-28 02:04 - Moved approved `file.write` resume replay and final-answer generation to `apps/runtime/src/approved-file-write-resume.ts`. Typecheck, runtime smoke, and session-thread tests passed.
  Next: extract session title/text helpers.
- 2026-04-28 02:09 - Moved assistant text extraction, default session title, and generated title logic to `apps/runtime/src/session-title.ts`. Full runtime typecheck and test suite passed; `run-store.ts` is now 2326 lines.
  Next: close verification and DONE gates.

## Open Issues
- None currently.

## TODO
- None.

## Retrospective
- Status: local_only
  - Evidence: During the Mode Studio extraction, manual review caught one subtle behavior drift: `recommendedUse` initially returned the untrimmed string in the new module, while the old code used `.trim()`. Typecheck could not catch this.
  - Guardrail: For extraction-only refactors, compare the moved expression bodies for normalization/coercion details, not just types and tests.
- Status: local_only
  - Evidence: The repo-wide `todo_scan.sh` exits 0 but reports historical task journals, skill templates, generated sidecar bundles, and binary matches across the workspace.
  - Guardrail: Record repo-wide scan noise, then use a task-owned source scan as the actionable DONE gate.

## Functional Verification

### Code Verification (Code Correctness)
- [x] Code compiles/runs without errors.
- [x] Unit tests pass.
- [x] Lint/whitespace checks pass or absence is recorded.

**Output**: `pnpm --filter @ora/runtime typecheck` passed. `pnpm --filter @ora/runtime test` passed 13 files / 211 tests. `pnpm lint` and `git diff --check` passed.

### Functional Verification (Feature Works)
- [x] Runtime facade behavior preserved.
- [x] Agent catalog behavior preserved.
- [x] Mode Studio builder behavior preserved.
- [x] Approved file-write resume behavior preserved.
- [x] Session title/transcript behavior preserved.

**Output**: Focused verification passed for `custom-agents.test.ts`, `mode-studio-builder.test.ts`, `runtime-smoke.test.ts`, and `session-thread.test.ts`; full runtime suite also passed.

## Comparison

### Reference
- Prior completed task: `tasks/TASK-20260428-0038-run-store-architecture-split.md`.
- Current `apps/runtime/src/run-store.ts` at 3100 lines before this task.

### Comparison Points
- [x] Public runtime API unchanged.
- [x] Extracted modules match cohesive responsibilities.
- [x] No schema/persistence/event contract changes.

### Findings
- Consistency: `LocalRunStore` and `InMemoryRunStore` remain exported from `run-store.ts`; default runtime directory helpers are re-exported from `run-store.ts`.
- Differences: `run-store.ts` delegates path policy, agent catalog projection, Mode Studio store/provider draft orchestration, approved file-write resume replay, and session title/text helpers to dedicated modules.
- Conclusion: The design is still a facade, but the remaining file is materially more reasonable: it dropped from 3100 to 2326 lines while preserving tests and public behavior.

## Checkpoints

### Checkpoint 1: Architecture Decision
- Requirement: Decide whether the current design is reasonable and whether more splitting is justified.
- Verification method: Method/import review plus prior task comparison.
- Status: Pass.
- Evidence: Current file still contains multiple independent responsibilities after the previous split; more splitting is justified only for clear helper domains.

### Checkpoint 2: Behavior-Preserving Extractions
- Requirement: New modules remove cohesive responsibilities without changing public behavior.
- Verification method: Typecheck and focused tests after slices.
- Status: Pass.
- Evidence: Five cohesive modules extracted; typecheck and focused tests passed after the relevant slices.

### Checkpoint 3: DONE Gate
- Requirement: TODO gate, code verification, functional verification, retrospective, and evidence complete.
- Verification method: Long-task protocol gates.
- Status: Pass.
- Evidence: TODO gate recorded with repo-wide scan noise plus task-scoped fallback; typecheck, full tests, diff check, comparison, and retrospective are complete.

## Compressed State (<= 20 lines)
- Objective: Continue behavior-preserving `run-store.ts` split after prior DONE task.
- Done: Extracted path helpers, agent catalog helpers, Mode Studio store/provider orchestration, approved file-write resume replay, and session title/text helpers.
- In-progress: None.
- Active files: task file, `run-store.ts`, `runtime-store-paths.ts`, `agent-catalog.ts`, `mode-studio-store.ts`, `approved-file-write-resume.ts`, `session-title.ts`.
- Next actions (top 3; exact file/function): none.
- Blockers/Risks: none known; deeper run lifecycle/service extraction should be a separate task if desired.
- Verification status: passed typecheck, focused tests, full runtime tests, and diff check.

## Verification

### Evidence Requirements
- [x] Code Verification output.
- [x] Functional Verification output.
- [x] Retrospective Evidence.
- [x] Comparison Evidence.
- [x] Checkpoints Evidence.

### Environment
- Environment: `/Users/quintenchen/developer/Ora`, 2026-04-28 Asia/Shanghai.

### Commands run + outputs
- `wc -l apps/runtime/src/run-store.ts`
```text
3100 apps/runtime/src/run-store.ts
```
- `pnpm --filter @ora/runtime typecheck`
```text
> @ora/runtime@0.1.0 typecheck /Users/quintenchen/developer/Ora/apps/runtime
> tsc -p tsconfig.json --noEmit

exit code 0
```
- `pnpm --filter @ora/runtime exec vitest run test/custom-agents.test.ts`
```text
Test Files  1 passed (1)
Tests  10 passed (10)
```
- `pnpm --filter @ora/runtime exec vitest run test/mode-studio-builder.test.ts`
```text
Test Files  1 passed (1)
Tests  9 passed (9)
```
- `pnpm --filter @ora/runtime exec vitest run test/session-thread.test.ts test/runtime-smoke.test.ts`
```text
Test Files  2 passed (2)
Tests  75 passed (75)
```
- `pnpm --filter @ora/runtime test`
```text
Test Files  13 passed (13)
Tests  211 passed (211)
```
- `git diff --check`
```text
exit code 0
```
- `pnpm lint`
```text
> ora@0.0.0 lint /Users/quintenchen/developer/Ora
> pnpm -r --if-present lint

Scope: 3 of 4 workspace projects
exit code 0
```
- `wc -l apps/runtime/src/run-store.ts apps/runtime/src/runtime-store-paths.ts apps/runtime/src/agent-catalog.ts apps/runtime/src/mode-studio-store.ts apps/runtime/src/approved-file-write-resume.ts apps/runtime/src/session-title.ts`
```text
2326 apps/runtime/src/run-store.ts
54 apps/runtime/src/runtime-store-paths.ts
213 apps/runtime/src/agent-catalog.ts
316 apps/runtime/src/mode-studio-store.ts
261 apps/runtime/src/approved-file-write-resume.ts
126 apps/runtime/src/session-title.ts
3296 total
```
- `bash /Users/quintenchen/.codex/skills/long-task-protocol/scripts/todo_scan.sh`
```text
Exited 0 but produced known repo-wide noise from historical task journals, skill templates, generated sidecar bundles, runtime DB binaries, and build artifacts. Not used as task-scoped blocking evidence.
```
- Task-owned source scan: `rg --pcre2 -n "TODO(?!\\(FOLLOWUP\\))|FIXME|XXX|\\[ \\]" apps/runtime/src/run-store.ts apps/runtime/src/runtime-store-paths.ts apps/runtime/src/agent-catalog.ts apps/runtime/src/mode-studio-store.ts apps/runtime/src/approved-file-write-resume.ts apps/runtime/src/session-title.ts`
```text
No matches.
```
