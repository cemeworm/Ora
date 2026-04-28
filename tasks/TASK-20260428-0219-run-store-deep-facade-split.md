# TASK-20260428-0219-run-store-deep-facade-split

**Created:** 2026-04-28 02:19 Asia/Shanghai
**Status:** DONE

---

## Goal
- Continue the `apps/runtime/src/run-store.ts` structural split beyond the second-pass facade cleanup, aiming to make `LocalRunStore` a thinner compatibility facade while preserving runtime behavior, JSON-RPC contracts, event ordering, persistence format, and tests.

## Scope / Out of scope
- In scope:
  - Move mode selection and auto-mode routing out of `run-store.ts`.
  - Move run projection, trace metadata merge, trail metrics, and payload summarization out of `run-store.ts`.
  - Move feedback source-context and evaluation-feedback draft curation out of `run-store.ts`.
  - Move remaining cohesive helper domains only when the extraction can be verified with existing tests.
  - Keep a task journal as the source of truth and update it after each checkpoint.
- Out of scope:
  - No schema, JSON-RPC method, event type, persistence-format, provider API, or desktop UI changes.
  - No broad service framework rewrite unless smaller helper extraction proves insufficient.
  - No destructive cleanup or unrelated formatting churn.

## Assumptions
- "彻底完成" means finish the structural split as far as behavior-preserving extraction is reasonable in this codebase, not force arbitrary tiny files.
- The remaining `LocalRunStore` may still own live maps, persistence timing, and start/resume streaming control flow if moving them would risk event timing.
- Existing runtime tests are the primary behavior contract.

## Constraints
- Compatibility: `LocalRunStore`, `InMemoryRunStore`, and existing helper exports must remain available.
- Performance: no extra model calls, file scans, stream flushes, or persistence writes.
- Risk: start/resume/streaming methods own async state transitions; extract surrounding helper logic before moving the state machine itself.
- Tool/Environment limits: use `apply_patch` for source edits; preserve uncommitted previous split changes.

## Plan
1. `apps/runtime/src/mode-selection.ts`, `apps/runtime/src/run-store.ts`
   - Objective: move `resolveModeSelection`, `routeAutoMode`, router schema/constants, and memory-prompt config helpers where practical.
   - Verify: `pnpm --filter @ora/runtime typecheck`, runtime smoke tests.
2. `apps/runtime/src/run-projections.ts`, `apps/runtime/src/run-store.ts`
   - Objective: move `toRunHandle`, `toRunSummary`, `toSessionTurn`, trace merge/attach, trail metrics, and event payload summarization.
   - Verify: typecheck and session/runtime tests.
3. `apps/runtime/src/feedback-curation.ts`, `apps/runtime/src/run-store.ts`
   - Objective: move feedback source context building and curator provider prompt/parse logic.
   - Verify: typecheck and runtime integration/full tests.
4. Reassess remaining store responsibilities.
   - Objective: decide whether project/session persistence helpers, memory scheduling, or run lifecycle methods can be safely extracted in this task.
   - Verify: record decision and either implement one more bounded slice or stop.
5. Close gates.
   - Objective: update verification, line-count evidence, retrospective, and mark DONE only after checks pass.
   - Verify: `pnpm --filter @ora/runtime typecheck`, `pnpm --filter @ora/runtime test`, `pnpm lint`, `git diff --check`, task-scoped TODO scan.

## Active Files
- `tasks/TASK-20260428-0219-run-store-deep-facade-split.md`
- `apps/runtime/src/run-store.ts`
- `apps/runtime/src/mode-selection.ts`
- `apps/runtime/src/run-projections.ts`
- `apps/runtime/src/feedback-curation.ts`

## Decisions
- Decision: Continue with helper modules before a stateful service split.
  - Why: prior passes already moved several domains safely; the next high-value helpers are mode selection, projection/trace shaping, and feedback curation.
  - Alternatives: move all start/resume methods into a `RunLifecycleService` now.
  - Tradeoffs: helper modules leave some facade width, but keep event/persistence timing stable.
- Decision: Keep live maps and persistence timing in `LocalRunStore` until proven safe to move.
  - Why: those methods control when sessions, projects, runs, and stream snapshots are flushed.
  - Alternatives: introduce a `RuntimeStateRepository` class immediately.
  - Tradeoffs: less dramatic final shape, but fewer behavioral risks.

## Progress Log
- 2026-04-28 02:19 - Task created after reviewing the 2326-line post-second-pass `run-store.ts` and identifying remaining cohesive deep-split candidates.
  Next: extract mode selection/auto-router helpers; run typecheck and focused runtime verification.
- 2026-04-28 02:23 - Extracted mode selection, auto-mode routing, and memory prompt config helpers to `apps/runtime/src/mode-selection.ts`. Runtime typecheck and runtime smoke tests passed.
  Next: extract run projection and trace helpers.
- 2026-04-28 02:26 - Extracted run handle/summary/session-turn projection, trace metadata merge, trail metrics, and event payload summarization to `apps/runtime/src/run-projections.ts`. Typecheck plus session/runtime focused tests passed.
  Next: extract feedback curation helpers.
- 2026-04-28 02:27 - Extracted feedback source-context construction and evaluation feedback draft provider curation to `apps/runtime/src/feedback-curation.ts`. Typecheck and runtime integration tests passed.
  Next: extract remaining internal helper domains that are safe without moving async lifecycle timing.
- 2026-04-28 02:29 - Extracted long-term memory scheduling/update handling to `apps/runtime/src/memory-updates.ts` and legacy persistence migrations to `apps/runtime/src/runtime-migrations.ts`. Typecheck and focused runtime/session tests passed.
  Next: extract run-state operations.
- 2026-04-28 02:32 - Extracted stream state reads, interrupt/cancel, external snapshot persistence, checkpoints, replay, and report export to `apps/runtime/src/run-state-operations.ts`. Typecheck and focused runtime/session/integration tests passed.
  Next: extract project/session/listing operations.
- 2026-04-28 02:34 - Extracted project/session CRUD and run-listing views to `apps/runtime/src/project-session-operations.ts`. Typecheck and focused session/integration tests passed.
  Next: run full verification and close gates.
- 2026-04-28 02:35 - Full verification passed. `run-store.ts` is now 1685 lines and primarily owns compatibility facade methods, live lifecycle orchestration, persistence timing, and private state maps.
  Next: none.

## Open Issues
- None currently.

## TODO
- None.

## Retrospective
- Status: local_only
  - Evidence: The deepest remaining block is async start/resume/streaming lifecycle. Existing tests cover it, but it coordinates live snapshots, background promises, persistence timing, stream callbacks, title generation, and approved-write replay.
  - Guardrail: Do not move the entire async lifecycle in the same pass as helper extraction; after helper modules are stable, a lifecycle service split should be done only with a dedicated comparison test around stream event order.
- Status: local_only
  - Evidence: Extracting run-state operations briefly risked replacing zod validation for interrupt/cancel with a hand parser; this was corrected to use equivalent zod schemas inside the new module.
  - Guardrail: When moving endpoint-facing parameter parsing, preserve schema-parser behavior instead of approximating validation by hand.

## Functional Verification

### Code Verification (Code Correctness)
- [x] Code compiles/runs without errors.
- [x] Unit tests pass.
- [x] Lint/whitespace checks pass.

**Output**: `pnpm --filter @ora/runtime typecheck`, `pnpm --filter @ora/runtime test`, `pnpm lint`, and `git diff --check` passed.

### Functional Verification (Feature Works)
- [x] Mode selection / auto routing behavior preserved.
- [x] Run handles, summaries, session turns, trails, and trace projection behavior preserved.
- [x] Evaluation feedback curation behavior preserved.
- [x] Runtime facade behavior preserved.

**Output**: Focused runtime smoke, session-thread, and runtime-integration tests passed during extraction; the full runtime suite passed after all slices.

## Comparison

### Reference
- Prior completed task: `tasks/TASK-20260428-0155-run-store-second-pass-split.md`.
- Current `apps/runtime/src/run-store.ts` at 2326 lines before this task.

### Comparison Points
- [x] Public runtime API unchanged.
- [x] No schema/persistence/event contract changes.
- [x] Remaining `LocalRunStore` responsibilities are documented.

### Findings
- Consistency: `LocalRunStore` remains the JSON-RPC/runtime facade and still owns live maps, persistence timing, and async lifecycle methods.
- Differences: mode selection, run projections, feedback curation, memory update scheduling, migrations, run-state operations, and project/session views now live in focused modules.
- Conclusion: The original 3000+ line mixed-responsibility design has been reduced across two passes. This pass reduced the post-second-pass `run-store.ts` from 2326 to 1685 lines; the remaining code is the core lifecycle/state coordinator rather than miscellaneous helper domains.

## Checkpoints

### Checkpoint 1: Mode Selection Extraction
- Requirement: Mode resolution, tool/skill policy merging, auto-mode routing, and memory-prompt config helpers move out without behavior changes.
- Verification method: typecheck and runtime smoke tests.
- Status: Pass.
- Evidence: `apps/runtime/src/mode-selection.ts` owns mode resolution, auto-routing, tool/skill policy merging, and memory prompt config helpers. Runtime typecheck and smoke tests passed.

### Checkpoint 2: Projection And Feedback Extraction
- Requirement: Run projection/trace helpers and feedback curator helpers move out without behavior changes.
- Verification method: typecheck, focused tests, and full runtime tests.
- Status: Pass.
- Evidence: `run-projections.ts` and `feedback-curation.ts` own projection/trace and feedback context/provider curation helpers. Typecheck and focused/full runtime tests passed.

### Checkpoint 3: DONE Gate
- Requirement: TODO gate, code verification, functional verification, retrospective, comparison, and evidence complete.
- Verification method: Long-task protocol gates.
- Status: Pass.
- Evidence: TODO gate, typecheck, full runtime tests, lint, diff check, comparison, and retrospective are complete.

## Compressed State (<= 20 lines)
- Objective: Deepen `run-store.ts` split after second-pass completion.
- Done: Extracted mode selection, projections/trace, feedback curation, memory updates, migrations, run-state operations, and project/session views.
- In-progress: None.
- Active files: task file, `run-store.ts`, and new focused runtime helper modules.
- Next actions (top 3; exact file/function): none for this task.
- Blockers/Risks: full lifecycle-service extraction remains possible but should be a separate task with stream event-order comparison tests.
- Verification status: passed typecheck, full runtime tests, lint, diff check, and task-scoped TODO scan.

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
2326 apps/runtime/src/run-store.ts
```
- `pnpm --filter @ora/runtime typecheck`
```text
> @ora/runtime@0.1.0 typecheck /Users/quintenchen/developer/Ora/apps/runtime
> tsc -p tsconfig.json --noEmit

exit code 0
```
- `pnpm --filter @ora/runtime exec vitest run test/runtime-smoke.test.ts`
```text
Test Files  1 passed (1)
Tests  57 passed (57)
```
- `pnpm --filter @ora/runtime exec vitest run test/session-thread.test.ts test/runtime-smoke.test.ts`
```text
Test Files  2 passed (2)
Tests  75 passed (75)
```
- `pnpm --filter @ora/runtime exec vitest run test/runtime-integration.test.ts`
```text
Test Files  1 passed (1)
Tests  28 passed (28)
```
- `pnpm --filter @ora/runtime exec vitest run test/runtime-smoke.test.ts test/session-thread.test.ts test/runtime-integration.test.ts`
```text
Test Files  3 passed (3)
Tests  103 passed (103)
```
- `pnpm --filter @ora/runtime test`
```text
Test Files  13 passed (13)
Tests  211 passed (211)
```
- `pnpm lint`
```text
> ora@0.0.0 lint /Users/quintenchen/developer/Ora
> pnpm -r --if-present lint

Scope: 3 of 4 workspace projects
exit code 0
```
- `git diff --check`
```text
exit code 0
```
- Task-owned source TODO scan: `rg --pcre2 -n "TODO(?!\\(FOLLOWUP\\))|FIXME|XXX|\\[ \\]" apps/runtime/src/run-store.ts apps/runtime/src/mode-selection.ts apps/runtime/src/run-projections.ts apps/runtime/src/feedback-curation.ts apps/runtime/src/memory-updates.ts apps/runtime/src/runtime-migrations.ts apps/runtime/src/run-state-operations.ts apps/runtime/src/project-session-operations.ts`
```text
No matches. rg exited 1 because no matches were found.
```
- `wc -l apps/runtime/src/run-store.ts apps/runtime/src/mode-selection.ts apps/runtime/src/run-projections.ts apps/runtime/src/feedback-curation.ts apps/runtime/src/memory-updates.ts apps/runtime/src/runtime-migrations.ts apps/runtime/src/run-state-operations.ts apps/runtime/src/project-session-operations.ts`
```text
1685 apps/runtime/src/run-store.ts
217 apps/runtime/src/mode-selection.ts
131 apps/runtime/src/run-projections.ts
130 apps/runtime/src/feedback-curation.ts
73 apps/runtime/src/memory-updates.ts
91 apps/runtime/src/runtime-migrations.ts
184 apps/runtime/src/run-state-operations.ts
166 apps/runtime/src/project-session-operations.ts
2677 total
```
