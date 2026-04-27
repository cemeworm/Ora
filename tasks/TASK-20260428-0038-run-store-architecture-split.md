# TASK-20260428-0038-run-store-architecture-split

**Created:** 2026-04-28 00:38 Asia/Shanghai
**Status:** Done

---

## Goal
- Reduce `apps/runtime/src/run-store.ts` from a 5251-line mixed-responsibility file into a thinner runtime facade without changing the public JSON-RPC behavior. The first implementation phase should remove low-risk, clearly separable responsibilities first: shared runtime errors, JSON-file persistence backend, and project workspace/file-preview helpers.

## Scope / Out of scope
- In scope:
  - Create task journal as single source of truth.
  - Move `OraRuntimeError` to an independent module to break the `run-store` <-> `persistence/sqlite-backend` dependency cycle.
  - Move `JsonFileRuntimePersistenceBackend` out of `run-store.ts`.
  - Move project workspace scanning / file preview helpers out of `run-store.ts`.
  - Keep exported runtime API compatible from `apps/runtime/src/index.ts`.
  - Run typecheck and focused runtime tests after each meaningful slice.
- Out of scope:
  - Rewriting run execution or resume semantics.
  - Changing JSON-RPC method names, request schemas, response schemas, or persistence format.
  - Removing possible legacy deterministic code unless verified separately.
  - Broad style cleanup or formatting churn unrelated to the split.

## Assumptions
- `LocalRunStore` should remain the compatibility facade for now.
- Splitting should be behavior-preserving. If a change requires design choice beyond file ownership, pause and record it here.
- Tests are the authority for external behavior; line count reduction is secondary.

## Constraints
- Compatibility: imports of `LocalRunStore`, `InMemoryRunStore`, and `OraRuntimeError` from `@ora/runtime` must continue to work.
- Performance: project workspace scanning behavior and limits must remain unchanged.
- Risk: `run-store.ts` touches persistence, sessions, streaming runs, memory, Mode Studio, and evaluation feedback. Avoid broad edits.
- Tool/Environment limits: use `apply_patch` for source edits; avoid destructive git commands; preserve unrelated worktree changes.

## Plan
1. `apps/runtime/src/runtime-errors.ts`, `apps/runtime/src/index.ts`, `apps/runtime/src/json-rpc.ts`, `apps/runtime/src/persistence/sqlite-backend.ts`, `apps/runtime/src/run-store.ts`
   - Objective: move `OraRuntimeError` out of `run-store.ts`; update imports/exports.
   - Verify: `pnpm --filter @ora/runtime typecheck`.
2. `apps/runtime/src/persistence/json-file-backend.ts`, `apps/runtime/src/run-store.ts`
   - Objective: move `JsonFileRuntimePersistenceBackend` and its private path helpers out of `run-store.ts`; keep `RuntimePersistenceBackend` contract unchanged.
   - Verify: `pnpm --filter @ora/runtime typecheck` and persistence/session tests if fast enough.
   - Actual: also added `apps/runtime/src/persistence/types.ts` so SQLite and JSON backends share the same backend contract.
3. `apps/runtime/src/project-workspace.ts`, `apps/runtime/src/run-store.ts`
   - Objective: move project file listing, preview classification, MIME mapping, path sorting, and workspace summary helper logic out of `run-store.ts`.
   - Verify: focused tests covering sessions/projects plus typecheck.
4. Reassess next split candidates.
   - Objective: decide whether to continue into Mode Studio builder / agent draft service in this task or stop after stable low-risk extraction.
   - Verify: record recommendation and residual risks.
5. `apps/runtime/src/provider-json.ts`, `apps/runtime/src/agent-draft.ts`, `apps/runtime/src/run-store.ts`
   - Objective: move provider JSON extraction and custom-agent draft generation out of `run-store.ts`, leaving `LocalRunStore.generateAgentDraft` as a facade method.
   - Verify: `pnpm --filter @ora/runtime typecheck` and `pnpm --filter @ora/runtime test -- custom-agents.test.ts mode-studio-builder.test.ts`.
6. Checkpoint: `apps/runtime/src/run-orchestration.ts`, `apps/runtime/src/run-store.ts`
   - Objective: extract repeated run/resume orchestration helpers only: resume patch parsing, approved-action projection, kernel-resume detection, clarification merge, event status mapping, event rebasing, and failed-event construction.
   - In scope: pure/helper functions that do not own persistence, provider invocation, kernel execution, or session state.
   - Out of scope: moving `executeRuntimeKernel`, `withLangfuseRunTrace`, streaming publish callbacks, or approved file-write replay.
   - Verify: focused run/resume tests if possible; record full typecheck caveat if unrelated harness errors remain.
7. Checkpoint: `apps/runtime/src/run-kernel-lifecycle.ts`, `apps/runtime/src/run-store.ts`
   - Objective: move traced kernel execution and session-bound snapshot assembly out of `run-store.ts`.
   - In scope: `executeRuntimeKernel` calls, `withLangfuseRunTrace` wrapping for start/resume paths, common kernel option construction inputs, and final `sessionId` / `turnIndex` snapshot parsing.
   - Out of scope: persistence timing, stream publication, live snapshot cache policy, run id/session allocation, approved file-write replay, and JSON-RPC method shape.
   - Verify: `pnpm --filter @ora/runtime typecheck`, focused agent/mode tests, and focused runtime smoke/session tests.
8. Checkpoint: `apps/runtime/src/run-streaming.ts`, `apps/runtime/src/run-store.ts`
   - Objective: move streaming run event publication payloads, live event snapshot transitions, stream cache flush predicate, and failed streaming snapshot construction out of `run-store.ts`.
   - In scope: `RunEventStream` construction, `statusForRunEvent` application for live events, failed event/snapshot assembly, and repeated error-detail coercion.
   - Out of scope: deciding when to publish, when to persist, stream callback ownership, approved file-write replay semantics, and async kernel lifecycle.
   - Verify: `pnpm --filter @ora/runtime typecheck`, focused agent/mode tests, and focused runtime smoke/session tests.
9. Checkpoint: `apps/runtime/src/run-resume-mutation.ts`, `apps/runtime/src/run-store.ts`
   - Objective: move non-kernel resume snapshot/event mutation out of `run-store.ts`.
   - In scope: `run.resumed`, clarification resolution, approval resolution, action status updates, memory update, interrupted fallback, checkpoint creation, and deterministic completion snapshot construction.
   - Out of scope: kernel-backed resume, approved file-write replay, persistence/title generation, todo synchronization implementation, and pattern output/topology business rules.
   - Verify: `pnpm --filter @ora/runtime typecheck`, focused agent/mode tests, and focused runtime smoke/session tests.
10. Checkpoint: `apps/runtime/src/run-deterministic-patterns.ts`, `apps/runtime/src/run-store.ts`, `apps/runtime/src/run-resume-mutation.ts`
   - Objective: move deterministic MVP pattern helpers out of `run-store.ts`.
   - In scope: single-owner detection, primary owner selection, deterministic pattern action type, memory namespace, output payload/message/token generation, and topology status projection.
   - Out of scope: deterministic run event orchestration, action ledger flow, policy decisions, persistence, and resume mutation event order.
   - Verify: `pnpm --filter @ora/runtime typecheck`, focused agent/mode tests, and focused runtime smoke/session tests.
11. Checkpoint: `apps/runtime/src/run-store.ts`
   - Objective: remove verified-dead legacy deterministic completed-run builder.
   - In scope: private `createCompletedRun` and imports used only by that method.
   - Out of scope: changing active deterministic kernel/resume behavior.
   - Verify: `rg -n "createCompletedRun\\(" apps/runtime/src apps/runtime/test -g'*.ts'`, `pnpm --filter @ora/runtime typecheck`, focused agent/mode tests, and focused runtime smoke/session tests.
12. Checkpoint: `apps/runtime/src/run-snapshots.ts`, `apps/runtime/src/run-store.ts`
   - Objective: move pure snapshot factory helpers out of `run-store.ts`.
   - In scope: standalone builder snapshot construction, streaming running snapshot construction, and cancelled snapshot projection.
   - Out of scope: persistence/cache/title generation, event append sequencing, and transition side effects.
   - Verify: `pnpm --filter @ora/runtime typecheck`, focused agent/mode tests, and focused runtime smoke/session tests.
13. Checkpoint: `apps/runtime/src/mode-studio-builder-run.ts`, `apps/runtime/src/run-store.ts`
   - Objective: move store-bound Mode Studio builder run shell orchestration out of `run-store.ts`.
   - In scope: builder input/config construction, builder start event sequencing, final builder output/artifact/event construction, and builder result extraction from snapshots.
   - Out of scope: provider invocation, draft validation, mode/agent persistence, run id allocation, and cache/persistence side effects.
   - Verify: `pnpm --filter @ora/runtime typecheck`, focused Mode Studio tests, and focused runtime smoke/session tests.

## Active Files
- `tasks/TASK-20260428-0038-run-store-architecture-split.md`
- `apps/runtime/src/run-store.ts`
- `apps/runtime/src/index.ts`
- `apps/runtime/src/json-rpc.ts`
- `apps/runtime/src/persistence/sqlite-backend.ts`
- `apps/runtime/src/runtime-errors.ts`
- `apps/runtime/src/persistence/json-file-backend.ts`
- `apps/runtime/src/persistence/types.ts`
- `apps/runtime/src/project-workspace.ts`
- `apps/runtime/src/provider-json.ts`
- `apps/runtime/src/agent-draft.ts`
- `apps/runtime/src/mode-studio-draft.ts`
- `apps/runtime/src/run-orchestration.ts`
- `apps/runtime/src/run-kernel-lifecycle.ts`
- `apps/runtime/src/run-streaming.ts`
- `apps/runtime/src/run-resume-mutation.ts`
- `apps/runtime/src/run-deterministic-patterns.ts`
- `apps/runtime/src/run-snapshots.ts`
- `apps/runtime/src/mode-studio-builder-run.ts`

## Decisions
- Decision: Keep `LocalRunStore` as a facade during this task.
  - Why: JSON-RPC and tests already depend on it as the runtime entry point.
  - Alternatives: Split JSON-RPC into many service objects immediately.
  - Tradeoffs: Facade remains broad short term, but reduces migration risk.
- Decision: Start with extraction-only slices.
  - Why: These responsibilities have crisp boundaries and should not affect runtime behavior.
  - Alternatives: Start with streaming/resume logic.
  - Tradeoffs: Less dramatic line-count reduction initially, but safer and easier to verify.
- Decision: Split agent draft generation before Mode Studio builder.
  - Why: Agent draft is a smaller service boundary and Mode Studio already shares its draft normalization helper.
  - Alternatives: Move all Mode Studio and agent draft code together.
  - Tradeoffs: Requires one small shared `provider-json.ts`, but avoids a large all-at-once extraction.
- Decision: Open a separate run/resume orchestration checkpoint before touching kernel lifecycle code.
  - Why: start/resume/streaming methods mix live state, traces, persistence, and event rebasing; broad movement risks behavior drift.
  - Alternatives: Move all run/resume methods into a service class now.
  - Tradeoffs: Smaller extraction leaves `LocalRunStore` broad, but gives reusable helpers and a safer verification boundary.
- Decision: For the next checkpoint, move traced kernel execution as a function module rather than a stateful service.
  - Why: a function boundary can remove duplicated kernel/trace assembly while leaving `LocalRunStore` in charge of state mutation and persistence.
  - Alternatives: Introduce `RunLifecycleService` owning start/resume methods.
  - Tradeoffs: Less architectural drama, but lower risk and easier to verify.
- Decision: Split streaming publisher/failure handling as helper functions, not a stream service.
  - Why: `LocalRunStore` still owns live mutable state, persistence timing, and callbacks; helper functions can remove duplicated payload and failed-snapshot construction without taking ownership of async control flow.
  - Alternatives: Introduce a `StreamingRunController` class.
  - Tradeoffs: Functions are less sweeping, but keep this checkpoint behavior-preserving.
- Decision: Split non-kernel resume mutation using callback dependencies for store-specific rules.
  - Why: the mutation should leave `appendEvent` sequencing, deterministic pattern output, memory namespace, topology status, and todo sync behavior unchanged.
  - Alternatives: Move pattern output/topology helpers too.
  - Tradeoffs: Callback dependencies are a little verbose, but avoid widening this checkpoint into pattern semantics.
- Decision: Move deterministic pattern rules after the resume mutation split.
  - Why: it removes the remaining pattern-rule callbacks from `run-resume-mutation.ts` while keeping action ledger and event orchestration in `run-store.ts`.
  - Alternatives: Move the whole deterministic run builder.
  - Tradeoffs: Helper extraction is smaller and preserves current event construction.
- Decision: Split Mode Studio builder run shell, not provider/draft semantics.
  - Why: the remaining open issue was specifically store-bound builder run orchestration; provider invocation and validation still depend on store context and should stay put for now.
  - Alternatives: Move all Mode Studio methods into a service.
  - Tradeoffs: The facade stays responsible for domain storage and provider context, while repetitive run shell code leaves `run-store.ts`.

## Progress Log
- 2026-04-28 00:38 - Task created and initial architecture review findings converted into implementation plan.
  Next: move `OraRuntimeError` to `runtime-errors.ts`; update imports/exports; run typecheck.
- 2026-04-28 00:43 - Extracted `OraRuntimeError` into `apps/runtime/src/runtime-errors.ts`, updated runtime exports and imports, and removed the SQLite backend dependency on `run-store.ts`. `pnpm --filter @ora/runtime typecheck` passed.
  Next: move `JsonFileRuntimePersistenceBackend` to `apps/runtime/src/persistence/json-file-backend.ts`; run typecheck; update checkpoint evidence.
- 2026-04-28 00:49 - Extracted JSON-file persistence to `apps/runtime/src/persistence/json-file-backend.ts` and shared persistence contracts to `apps/runtime/src/persistence/types.ts`. Fixed one missed `ArtifactRef` type import in SQLite backend. `pnpm --filter @ora/runtime typecheck` passed.
  Next: extract project workspace scanning / preview helpers to `apps/runtime/src/project-workspace.ts`; run typecheck and focused project/session tests.
- 2026-04-28 00:54 - Extracted project workspace scanning and file-preview logic to `apps/runtime/src/project-workspace.ts`; `LocalRunStore` now delegates `projects.files`, `projects.file.read`, project root normalization, and run input workspace context construction. Typecheck and runtime test suite passed.
  Next: decide whether to continue with Mode Studio / agent draft service extraction in this task; preserve current behavior and avoid touching run/resume semantics without a separate checkpoint.
- 2026-04-28 00:59 - Extracted provider JSON object parsing to `apps/runtime/src/provider-json.ts` and custom-agent draft generation to `apps/runtime/src/agent-draft.ts`. `LocalRunStore.generateAgentDraft` now delegates to the service; Mode Studio still uses the shared `normalizeGeneratedAgentDraft`. Typecheck and focused agent/mode tests passed.
  Next: extract Mode Studio pure draft/prompt/helper functions without moving builder run event persistence.
- 2026-04-28 01:05 - Extracted Mode Studio pure draft, prompt, topology, story, and provider-response helpers to `apps/runtime/src/mode-studio-draft.ts`. `LocalRunStore` still owns builder run events, persistence, mode store access, and validation. Direct focused tests for custom agents and mode studio passed.
  Next: stop this phase or create a separate checkpoint before touching run/resume/kernel orchestration; full typecheck is currently blocked by unrelated harness files.
- 2026-04-28 01:10 - Opened run/resume orchestration checkpoint. Scope is helper extraction only, keeping `LocalRunStore` responsible for kernel execution, streaming callbacks, traces, persistence, and approved file-write replay.
  Next: add `apps/runtime/src/run-orchestration.ts`; replace duplicate resume patch/event helpers in `run-store.ts`; run focused verification.
- 2026-04-28 01:13 - Extracted run/resume helper logic to `apps/runtime/src/run-orchestration.ts`: resume patch parsing, kernel-resume detection, approved action projection, clarification merge, running snapshot projection, event status mapping, event rebasing, and failed-event construction. `run-store.ts` is now 3930 lines.
  Next: keep any deeper kernel lifecycle split in a separate checkpoint/task because it would move provider execution, persistence timing, and streaming callback ownership.
- 2026-04-28 01:18 - Opened traced kernel lifecycle checkpoint. Scope is to extract `executeRuntimeKernel` + `withLangfuseRunTrace` assembly and session-bound snapshot parsing while keeping persistence, stream publishing, run allocation, and cache policy in `LocalRunStore`.
  Next: add `apps/runtime/src/run-kernel-lifecycle.ts`; replace start/resume kernel calls; run typecheck and focused runtime tests.
- 2026-04-28 01:22 - Extracted traced kernel lifecycle helpers to `apps/runtime/src/run-kernel-lifecycle.ts`. `run-store.ts` now calls `executeTracedKernelRun` / `executeTracedKernelResume` for start, streaming start, forked kernel start, streaming resume, and synchronous resume, while still owning persistence, stream publication, live snapshot cache policy, and run/session allocation. `run-store.ts` is now 3907 lines.
  Next: if continuing, open a separate checkpoint for either stream publisher/failure handling or non-kernel resume event mutation; avoid mixing both in one slice.
- 2026-04-28 01:27 - Opened stream publisher/failure handling checkpoint. Scope is helper extraction for stream payload construction, live event transitions, failed streaming snapshot construction, and cache flush predicate; `LocalRunStore` remains responsible for when to publish/persist.
  Next: add `apps/runtime/src/run-streaming.ts`; replace duplicate streaming closures/catch blocks in `run-store.ts`; run focused verification.
- 2026-04-28 01:34 - Extracted stream publisher/failure helpers to `apps/runtime/src/run-streaming.ts`. `run-store.ts` now delegates stream payload construction, live streaming event snapshot transitions, cache flush predicate, and failed streaming snapshot/event construction while retaining publish/persist timing and callback ownership. Typecheck and focused tests passed. `run-store.ts` is now 3884 lines.
  Next: if continuing, open a separate checkpoint for non-kernel resume event mutation; keep it separate from streaming/kernel lifecycle.
- 2026-04-28 01:39 - Opened non-kernel resume event mutation checkpoint. Scope is event/snapshot mutation only; store-specific pattern output, memory namespace, topology status, todo sync, and persistence remain in `LocalRunStore` through callbacks or direct ownership.
  Next: add `apps/runtime/src/run-resume-mutation.ts`; replace the non-kernel `resumeRun` mutation block; run focused verification.
- 2026-04-28 01:43 - Extracted non-kernel resume event/snapshot mutation to `apps/runtime/src/run-resume-mutation.ts`. `run-store.ts` now delegates deterministic resume event ordering for `run.resumed`, clarification resolution, approval/action/memory updates, interrupted fallback, checkpoint creation, and completion snapshot construction while retaining persistence/title generation and store-owned pattern/topology/todo rules. Typecheck and focused tests passed. `run-store.ts` is now 3778 lines.
  Next: stop this split phase or open a separate checkpoint for another clearly bounded store responsibility.
- 2026-04-28 01:48 - Opened deterministic pattern helper checkpoint. Scope is pure deterministic pattern rules only; `run-store.ts` remains responsible for deterministic run event/action orchestration and persistence.
  Next: add `apps/runtime/src/run-deterministic-patterns.ts`; replace pattern helper methods and resume mutation callbacks; run focused verification.
- 2026-04-28 01:52 - Extracted deterministic pattern helpers to `apps/runtime/src/run-deterministic-patterns.ts`. `run-store.ts` now imports deterministic action type, memory namespace, and output generation; `run-resume-mutation.ts` imports pattern output, memory namespace, and topology status directly instead of receiving those rules through callbacks. Typecheck and focused tests passed. `run-store.ts` is now 3609 lines.
  Next: stop this phase or open a separate checkpoint only if the next boundary is similarly crisp.
- 2026-04-28 01:56 - Opened dead-code cleanup checkpoint for private `createCompletedRun`. `rg -n "createCompletedRun\\(" apps/runtime/src apps/runtime/test -g'*.ts'` showed only the private definition in `run-store.ts`, so this is verified legacy dead code rather than an active split boundary.
  Next: remove `createCompletedRun` and imports used only by it; run typecheck and focused tests.
- 2026-04-28 02:00 - Removed verified-dead private `createCompletedRun` and imports used only by it. Follow-up `rg -n "createCompletedRun\\(" apps/runtime/src apps/runtime/test -g'*.ts'` returned no results. Typecheck and focused tests passed. `run-store.ts` is now 3350 lines.
  Next: stop this phase or open another checkpoint only for a cohesive remaining responsibility.
- 2026-04-28 02:04 - Opened snapshot factory checkpoint. Scope is pure snapshot construction for Mode Studio standalone builder snapshots, streaming running snapshots, and cancelled snapshots; store retains persistence/cache/title/event append behavior.
  Next: add `apps/runtime/src/run-snapshots.ts`; replace private factory methods in `run-store.ts`; run focused verification.
- 2026-04-28 02:09 - Extracted snapshot factories to `apps/runtime/src/run-snapshots.ts`: standalone Mode Studio builder snapshot, streaming running snapshot, and cancelled snapshot projection. `LocalRunStore` still owns event append, transition side effects, persistence, cache, and title generation. Typecheck and focused tests passed. `run-store.ts` is now 3164 lines.
  Next: stop this phase or open another checkpoint only for a cohesive remaining responsibility.
- 2026-04-28 02:13 - Opened Mode Studio builder run shell checkpoint. Scope is builder input/config construction, start/final event shell, artifact/output construction, and result extraction; provider invocation and draft validation remain in `LocalRunStore`.
  Next: add `apps/runtime/src/mode-studio-builder-run.ts`; replace `startModeStudioBuilderRun` shell and `modeStudioBuilderResult` extraction; run focused verification.
- 2026-04-28 02:18 - Extracted Mode Studio builder run shell to `apps/runtime/src/mode-studio-builder-run.ts`. `run-store.ts` now delegates builder input/config construction, start events, final output/artifact/events, and result extraction while retaining provider invocation, draft validation, run id allocation, and cache side effects. Typecheck and focused tests passed. `run-store.ts` is now 3100 lines.
  Next: complete the task hygiene gate, record final verification, and close the task.
- 2026-04-28 02:24 - Completed final hygiene gate. Repo-wide `todo_scan.sh` exits 0 but is noisy because historical task journals, skill templates, generated runtime-sidecar bundles, and runtime DB binaries already contain matches; task-scoped source and journal scans found no blocking markers or unchecked task items. `git diff --check` passed. Typecheck and focused runtime tests were already passing after the final code checkpoint.
  Next: none; task complete.

## Open Issues
- None.

## Completed Work Items
- [x] Move `OraRuntimeError` to `apps/runtime/src/runtime-errors.ts`.
- [x] Move JSON-file backend to `apps/runtime/src/persistence/json-file-backend.ts`.
- [x] Move project workspace/file-preview helpers to `apps/runtime/src/project-workspace.ts`.
- [x] Run typecheck and focused tests.
- [x] Update this journal with verification evidence and retrospective.
- [x] Decide next extraction slice: Mode Studio builder service, agent draft service, or stop at first safe phase.
- [x] Move provider JSON extraction to `apps/runtime/src/provider-json.ts`.
- [x] Move custom-agent draft generation to `apps/runtime/src/agent-draft.ts`.
- [x] Run custom-agent / mode-studio focused verification.
- [x] Move Mode Studio pure draft/prompt/helper functions to a dedicated module.
- [x] Decide whether to continue into run/resume orchestration in a separate task/checkpoint.
- [x] Extract run/resume helper functions to `apps/runtime/src/run-orchestration.ts`.
- [x] Run focused run/resume verification and update checkpoint evidence.
- [x] Extract traced kernel lifecycle helpers to `apps/runtime/src/run-kernel-lifecycle.ts`.
- [x] Run verification for traced kernel lifecycle checkpoint.
- [x] Extract stream publisher/failure helpers to `apps/runtime/src/run-streaming.ts`.
- [x] Run verification for stream publisher/failure checkpoint.
- [x] Extract non-kernel resume event mutation to `apps/runtime/src/run-resume-mutation.ts`.
- [x] Run verification for non-kernel resume mutation checkpoint.
- [x] Extract deterministic pattern helpers to `apps/runtime/src/run-deterministic-patterns.ts`.
- [x] Run verification for deterministic pattern helper checkpoint.
- [x] Remove verified-dead private `createCompletedRun`.
- [x] Run verification for dead-code cleanup checkpoint.
- [x] Extract snapshot factory helpers to `apps/runtime/src/run-snapshots.ts`.
- [x] Run verification for snapshot factory checkpoint.
- [x] Extract Mode Studio builder run shell to `apps/runtime/src/mode-studio-builder-run.ts`.
- [x] Run verification for Mode Studio builder run shell checkpoint.

## Retrospective

### Item 1
- Pitfall: Moving shared contracts out of a backend can leave return-type imports behind even when runtime behavior is unchanged.
- Symptom: Typecheck failed on `sqlite-backend.ts` because `ArtifactRef` was still used as a method return type after import cleanup.
- Root Cause: `ArtifactRefSchema` remained as a value import, but the matching type import was removed.
- Reusable Guardrail: After extraction, run typecheck immediately before stacking the next slice; schema/value imports and type imports need separate review in strict ESM TypeScript.
- Evidence: `pnpm --filter @ora/runtime typecheck` failed with `src/persistence/sqlite-backend.ts(219,46): error TS2304: Cannot find name 'ArtifactRef'.`; passed after restoring `import type { ArtifactRef } from "@ora/shared";`.
- Scope: TypeScript extraction/refactor tasks.
- Suggested Writeback Target: None yet.
- Status: local_only

### Item 2
- Pitfall: Package-script test filtering can accidentally run the whole Vitest suite.
- Symptom: `pnpm --filter @ora/runtime test -- custom-agents.test.ts mode-studio-builder.test.ts` ran all 13 runtime test files and surfaced unrelated harness failures.
- Root Cause: The package script receives an extra `--`, so Vitest did not treat the file names as the intended narrow filter.
- Reusable Guardrail: For focused runtime tests, use `pnpm --filter @ora/runtime exec vitest run test/custom-agents.test.ts test/mode-studio-builder.test.ts`.
- Evidence: Package script run failed with 22 failures in `runtime-smoke.test.ts` and `session-thread.test.ts`; direct `pnpm exec vitest` run passed 2 files / 16 tests.
- Scope: Runtime test verification.
- Suggested Writeback Target: None yet.
- Status: local_only

### Item 3
- Pitfall: A narrow refactor can expose latent type mismatches in nearby generic params.
- Symptom: Typecheck failed at `buildModeStudioDraft` because a `draftBundle` property was read from a base generate params type.
- Root Cause: The method is used by both generate and builder/refine paths, but its signature only described `ModeStudioGenerateDraftParams`.
- Reusable Guardrail: When a helper is called from extended schema paths, encode the optional extended fields in the helper signature instead of relying on `"key" in params` narrowing.
- Evidence: `pnpm --filter @ora/runtime typecheck` failed with `src/run-store.ts(604,7): error TS2322`; passed after changing the signature to `ModeStudioGenerateDraftParams & { draftBundle?: ModeStudioDraftBundle }`.
- Scope: TypeScript/Zod schema extension refactors.
- Suggested Writeback Target: None yet.
- Status: local_only

## Functional Verification

### Code Verification (Code Correctness)
- [x] Full typecheck passes
- [x] Focused unit tests pass
- [x] Lint/typecheck equivalent is clean for whole package

**Output**: `pnpm --filter @ora/runtime typecheck` passes after Mode Studio builder run shell extraction. Direct focused tests passed: `pnpm --filter @ora/runtime exec vitest run test/custom-agents.test.ts test/mode-studio-builder.test.ts test/runtime-smoke.test.ts test/session-thread.test.ts` passed 4 files / 94 tests.

### Functional Verification (Feature Works)
- [x] Runtime public exports remain compatible.
- [x] Project workspace file listing/preview behavior remains covered.
- [x] Runtime session/run tests still pass after extraction.

**Output**: `runtime-smoke.test.ts` includes deterministic pattern smoke, clarification resume, approval resume, streaming run publication, cancel behavior, and approved file-write resume coverage; `mode-studio-builder.test.ts` covers standalone builder snapshot and runtime-backed builder run behavior; `session-thread.test.ts` covers project workspace context injection and session/run behavior. The latest focused run after Mode Studio builder shell extraction passed 94 tests across agent/mode and runtime/session coverage.

## Comparison (If Applicable)

### Reference
- Existing specialized runtime modules: `apps/runtime/src/evaluation-store.ts`, `apps/runtime/src/feedback-loop-store.ts`, `apps/runtime/src/custom-agents.ts`, `apps/runtime/src/modes.ts`, `apps/runtime/src/persistence/sqlite-backend.ts`.

### Comparison Points
- [x] New modules own cohesive behavior rather than becoming generic utility dumps.
- [x] `run-store.ts` remains the facade matching current JSON-RPC expectations.
- [x] Dependency direction points from facade to services/backends, not from persistence back into facade.

### Findings
- Consistency: New files follow the existing pattern used by `custom-agents.ts`, `modes.ts`, `evaluation-store.ts`, and `feedback-loop-store.ts`: specialized modules own storage or domain helpers while `LocalRunStore` remains the RPC-facing facade.
- Differences: `persistence/types.ts` is a new shared contract module because both SQLite and JSON-file backends need the same backend interface.
- Conclusion: First extraction phase is consistent with the existing architecture and removes one concrete dependency-direction smell.

## Checkpoints

### Checkpoint 1: Error Dependency Cycle Removed
- Requirement: `OraRuntimeError` is defined outside `run-store.ts`; SQLite backend no longer imports from `run-store.ts`.
- Verification method: `rg -n "from \"../run-store|from \"./run-store" apps/runtime/src/persistence apps/runtime/src`.
- Status: [x] Pass / [ ] Fail
- Evidence: `apps/runtime/src/persistence/sqlite-backend.ts` now imports `OraRuntimeError` from `../runtime-errors.js`; `apps/runtime/src/index.ts` re-exports it from `./runtime-errors.js`; typecheck passed.

### Checkpoint 2: JSON Backend Extracted
- Requirement: `JsonFileRuntimePersistenceBackend` lives under `apps/runtime/src/persistence`.
- Verification method: `rg -n "class JsonFileRuntimePersistenceBackend|new JsonFileRuntimePersistenceBackend" apps/runtime/src`.
- Status: [x] Pass / [ ] Fail
- Evidence: `class JsonFileRuntimePersistenceBackend` is in `apps/runtime/src/persistence/json-file-backend.ts`; `run-store.ts` only imports and constructs it. Typecheck passed.

### Checkpoint 3: Project Workspace Helpers Extracted
- Requirement: project file scanning/preview behavior lives outside `run-store.ts`, with `LocalRunStore` delegating to it.
- Verification method: `rg -n "mimeTypeForPath|projectWorkspaceContext|PROJECT_WORKSPACE" apps/runtime/src`.
- Status: [x] Pass / [ ] Fail
- Evidence: `PROJECT_WORKSPACE_*`, `mimeTypeForPath`, and file preview logic now live in `apps/runtime/src/project-workspace.ts`; `run-store.ts` imports `listProjectFilesForProject`, `readProjectFileForProject`, `projectWorkspaceContext`, and `normalizeProjectRootPath`.

### Checkpoint 4: Agent Draft and Mode Studio Helpers Extracted
- Requirement: provider JSON parsing, custom-agent draft generation, and Mode Studio pure draft/prompt helpers live outside `run-store.ts`.
- Verification method: `rg -n "AgentDraftProviderResponseSchema|ModeStudioBuilderProviderResponseSchema|function modeStudio|function parseJsonObject" apps/runtime/src/run-store.ts apps/runtime/src/agent-draft.ts apps/runtime/src/mode-studio-draft.ts apps/runtime/src/provider-json.ts`.
- Status: [x] Pass / [ ] Fail
- Evidence: `AgentDraftProviderResponseSchema` lives in `agent-draft.ts`; `ModeStudioBuilderProviderResponseSchema` and `modeStudio*` pure helpers live in `mode-studio-draft.ts`; `parseJsonObject` lives in `provider-json.ts`; `run-store.ts` imports these helpers and keeps store-bound orchestration.

### Checkpoint 5: Run/Resume Orchestration Helpers
- Requirement: duplicated resume patch parsing, approved action projection, clarification merge, event status mapping, failed event creation, and event rebasing live outside `run-store.ts`.
- Verification method: `rg -n "parseResumePatch|statusForRunEvent|createFailedRunEvent|resumedInputWithClarifications|rebaseRunEvent|approvedActionsForResume|hasKernelResumeWork" apps/runtime/src`.
- Status: [x] Pass / [ ] Fail
- Evidence: `apps/runtime/src/run-orchestration.ts` now defines `parseResumePatch`, `hasKernelResumeWork`, `approvedActionsForResume`, `resumedInputWithClarifications`, `runningSnapshotForApprovedActions`, `statusForRunEvent`, `rebaseRunEvent`, and `createFailedRunEvent`; `run-store.ts` imports and uses them in `startStreamingRun`, `resumeStreamingRun`, and `resumeRun`. `pnpm --filter @ora/runtime typecheck` passed. `pnpm --filter @ora/runtime exec vitest run test/runtime-smoke.test.ts test/session-thread.test.ts` passed 2 files / 75 tests.

### Checkpoint 6: Traced Kernel Lifecycle Helpers
- Requirement: traced kernel execution and session-bound snapshot assembly live outside `run-store.ts`; `run-store.ts` still owns persistence and stream publication.
- Verification method: `rg -n "executeTracedKernelRun|executeTracedKernelResume|executeRuntimeKernel|withLangfuseRunTrace" apps/runtime/src/run-store.ts apps/runtime/src/run-kernel-lifecycle.ts`.
- Status: [x] Pass / [ ] Fail
- Evidence: `apps/runtime/src/run-kernel-lifecycle.ts` now owns `executeRuntimeKernel` and `withLangfuseRunTrace` imports and exports `executeTracedKernelRun` / `executeTracedKernelResume`; `run-store.ts` only imports those facade helpers. `pnpm --filter @ora/runtime typecheck` passed. `pnpm --filter @ora/runtime exec vitest run test/custom-agents.test.ts test/mode-studio-builder.test.ts test/runtime-smoke.test.ts test/session-thread.test.ts` passed 4 files / 91 tests.

### Checkpoint 7: Stream Publisher and Failure Helpers
- Requirement: streaming event payload construction, live event snapshot transitions, cache flush predicate, and failed streaming snapshot construction live outside `run-store.ts`.
- Verification method: `rg -n "publishRunStream|applyStreamingRunEvent|createStreamingFailure|shouldFlushStreamingEvent|RunEventStreamSchema.parse" apps/runtime/src/run-store.ts apps/runtime/src/run-streaming.ts`.
- Status: [x] Pass / [ ] Fail
- Evidence: `apps/runtime/src/run-streaming.ts` now defines `publishRunStream`, `applyStreamingRunEvent`, `shouldFlushStreamingEvent`, and `createStreamingFailure`. `run-store.ts` uses those helpers in streaming start, streaming resume, and approved file-write streaming resume; remaining `RunEventStreamSchema.parse` calls in `run-store.ts` are explicit `streamRun` / `replayRun` read APIs. `pnpm --filter @ora/runtime typecheck` passed. `pnpm --filter @ora/runtime exec vitest run test/custom-agents.test.ts test/mode-studio-builder.test.ts test/runtime-smoke.test.ts test/session-thread.test.ts` passed 4 files / 94 tests.

### Checkpoint 8: Non-Kernel Resume Event Mutation
- Requirement: non-kernel resume event/snapshot mutation lives outside `run-store.ts`, while persistence and store-owned pattern rules stay in `LocalRunStore`.
- Verification method: `rg -n "applyNonKernelResume|resolveResumeClarifications|completeNonKernelResume|run.resumed|approval.resolved|clarification.resolved" apps/runtime/src/run-store.ts apps/runtime/src/run-resume-mutation.ts`.
- Status: [x] Pass / [ ] Fail
- Evidence: `apps/runtime/src/run-resume-mutation.ts` now defines `beginNonKernelResume`, `resolveNonKernelResumeClarifications`, `applyNonKernelResumeApprovals`, `nonKernelResumeNeedsInput`, `interruptedNonKernelResumeSnapshot`, and `completeNonKernelResumeMutation`. `run-store.ts` uses those helpers in the non-kernel `resumeRun` branch while keeping persistence and title generation local. `pnpm --filter @ora/runtime typecheck` passed. `pnpm --filter @ora/runtime exec vitest run test/custom-agents.test.ts test/mode-studio-builder.test.ts test/runtime-smoke.test.ts test/session-thread.test.ts` passed 4 files / 94 tests.

### Checkpoint 9: Deterministic Pattern Helpers
- Requirement: deterministic pattern helper rules live outside `run-store.ts`; deterministic run orchestration stays in `run-store.ts`.
- Verification method: `rg -n "patternActionType|patternMemoryNamespace|patternOutput|withTopologyStatus|modeUsesSingleOwner|primaryOwnerAgentId" apps/runtime/src/run-store.ts apps/runtime/src/run-deterministic-patterns.ts apps/runtime/src/run-resume-mutation.ts`.
- Status: [x] Pass / [ ] Fail
- Evidence: `apps/runtime/src/run-deterministic-patterns.ts` now defines `modeUsesSingleOwner`, `primaryOwnerAgentId`, `patternActionType`, `patternMemoryNamespace`, `patternOutput`, and `withTopologyStatus`. `run-store.ts` imports only `patternActionType`, `patternMemoryNamespace`, and `patternOutput`; `run-resume-mutation.ts` imports `patternMemoryNamespace`, `patternOutput`, and `withTopologyStatus`. `pnpm --filter @ora/runtime typecheck` passed. `pnpm --filter @ora/runtime exec vitest run test/custom-agents.test.ts test/mode-studio-builder.test.ts test/runtime-smoke.test.ts test/session-thread.test.ts` passed 4 files / 94 tests.

### Checkpoint 10: Dead Legacy Completed Run Builder Removed
- Requirement: private unreferenced `createCompletedRun` is removed after proving it has no callers.
- Verification method: `rg -n "createCompletedRun\\(" apps/runtime/src apps/runtime/test -g'*.ts'`.
- Status: [x] Pass / [ ] Fail
- Evidence: Before removal, `rg -n "createCompletedRun\\(" apps/runtime/src apps/runtime/test -g'*.ts'` returned only `apps/runtime/src/run-store.ts:2432`. After removal, the same command returned no results. Imports used only by that method (`ActionLedger`, `MemoryService`, `PolicyService`, `PolicyDecision`, and deterministic pattern helpers in `run-store.ts`) were removed. `pnpm --filter @ora/runtime typecheck` passed. `pnpm --filter @ora/runtime exec vitest run test/custom-agents.test.ts test/mode-studio-builder.test.ts test/runtime-smoke.test.ts test/session-thread.test.ts` passed 4 files / 94 tests.

### Checkpoint 11: Snapshot Factories Extracted
- Requirement: pure standalone/running/cancelled snapshot construction lives outside `run-store.ts`.
- Verification method: `rg -n "createStandaloneSnapshot|createRunningSnapshot|cancelledSnapshot|createStandaloneRunSnapshot|createRunningRunSnapshot|cancelledRunSnapshot" apps/runtime/src/run-store.ts apps/runtime/src/run-snapshots.ts`.
- Status: [x] Pass / [ ] Fail
- Evidence: `apps/runtime/src/run-snapshots.ts` now defines `createStandaloneRunSnapshot`, `createRunningRunSnapshot`, and `cancelledRunSnapshot`. `run-store.ts` imports these helpers and no longer defines private `createStandaloneSnapshot`, `createRunningSnapshot`, or `cancelledSnapshot`. `pnpm --filter @ora/runtime typecheck` passed. `pnpm --filter @ora/runtime exec vitest run test/custom-agents.test.ts test/mode-studio-builder.test.ts test/runtime-smoke.test.ts test/session-thread.test.ts` passed 4 files / 94 tests.

### Checkpoint 12: Mode Studio Builder Run Shell Extracted
- Requirement: Mode Studio builder run shell construction lives outside `run-store.ts`, while provider invocation and validation remain local.
- Verification method: `rg -n "createModeStudioBuilderInput|createModeStudioBuilderConfig|startModeStudioBuilderSnapshot|completeModeStudioBuilderSnapshot|modeStudioBuilderResultFromSnapshot|startModeStudioBuilderRun" apps/runtime/src/run-store.ts apps/runtime/src/mode-studio-builder-run.ts`.
- Status: [x] Pass / [ ] Fail
- Evidence: `apps/runtime/src/mode-studio-builder-run.ts` now defines `createModeStudioBuilderInput`, `createModeStudioBuilderConfig`, `startModeStudioBuilderSnapshot`, `completeModeStudioBuilderSnapshot`, and `modeStudioBuilderResultFromSnapshot`. `run-store.ts` calls these helpers from `startModeStudioBuilderRun` and `modeStudioBuilderResult`; provider invocation and draft validation remain local. `pnpm --filter @ora/runtime typecheck` passed. `pnpm --filter @ora/runtime exec vitest run test/custom-agents.test.ts test/mode-studio-builder.test.ts test/runtime-smoke.test.ts test/session-thread.test.ts` passed 4 files / 94 tests.

## Compressed State (<= 20 lines)
- Objective: Make `run-store.ts` thinner through behavior-preserving extraction.
- Done: Created task journal and plan; moved `OraRuntimeError`; moved JSON backend/shared persistence types; moved project workspace helpers; moved provider JSON, agent draft, Mode Studio draft helpers, and run/resume orchestration helpers; typecheck and focused tests passed.
- Done this checkpoint: moved traced kernel lifecycle helpers to `run-kernel-lifecycle.ts`; typecheck and focused tests passed.
- Done this checkpoint: moved deterministic pattern helpers to `run-deterministic-patterns.ts`; typecheck and focused tests passed.
- Done this checkpoint: moved Mode Studio builder run shell to `mode-studio-builder-run.ts`; typecheck and focused tests passed.
- Active status: Complete; no active code edit checkpoint remains.
- Active files: task journal, `run-store.ts`, `index.ts`, `json-rpc.ts`, `sqlite-backend.ts`, `runtime-errors.ts`, `persistence/json-file-backend.ts`, `persistence/types.ts`, `project-workspace.ts`, `provider-json.ts`, `agent-draft.ts`, `mode-studio-draft.ts`, `run-orchestration.ts`, `run-kernel-lifecycle.ts`, `run-streaming.ts`, `run-resume-mutation.ts`, `run-deterministic-patterns.ts`, `run-snapshots.ts`, `mode-studio-builder-run.ts`.
- Next actions (top 3; exact file/function):
-  1. None.
- Blockers/Risks: None for this phase.
- Verification status: `@ora/runtime` typecheck passed; focused agent/mode and runtime smoke/session tests passed after Mode Studio builder run shell extraction; final task-scoped hygiene scan and `git diff --check` passed.

## Verification

### Evidence Requirements
Must provide the following evidence:
- [x] Code Verification output (compilation/tests/lint)
- [x] Functional Verification output (feature verification)
- [x] Retrospective Evidence (if applicable)
- [x] Comparison Evidence (if applicable)
- [x] Checkpoints Evidence (if applicable)

### Environment
- Environment: `/Users/quintenchen/developer/Ora`, zsh, 2026-04-28 Asia/Shanghai.

### Commands run + outputs
- `wc -l apps/runtime/src/run-store.ts`: 5251 lines before split.
- `rg` method/import scan showed `LocalRunStore` begins at line 421, `JsonFileRuntimePersistenceBackend` at line 259, and Mode Studio/helper functions occupy large sections outside store persistence.
- `pnpm --filter @ora/runtime typecheck`: passed after extracting `OraRuntimeError`.
- `rg -n "OraRuntimeError|from \"../run-store|from \"./run-store" apps/runtime/src/persistence apps/runtime/src`: confirmed SQLite backend imports `../runtime-errors.js`, not `../run-store.js`.
- `pnpm --filter @ora/runtime typecheck`: initially failed after JSON backend extraction because `sqlite-backend.ts` still referenced `ArtifactRef` as a return type; passed after restoring a type-only import.
- `wc -l apps/runtime/src/run-store.ts apps/runtime/src/persistence/json-file-backend.ts apps/runtime/src/persistence/types.ts apps/runtime/src/runtime-errors.ts`: `run-store.ts` now 5069 lines; new backend/types/error files total 225 lines.
- `pnpm --filter @ora/runtime typecheck`: passed after project workspace extraction.
- `wc -l apps/runtime/src/run-store.ts apps/runtime/src/project-workspace.ts`: `run-store.ts` now 4782 lines; `project-workspace.ts` is 309 lines.
- `pnpm --filter @ora/runtime test -- runtime-integration.test.ts session-thread.test.ts`: passed 13 test files / 208 tests. Vitest ran the full runtime suite despite the requested filenames.
- `git status --short`: showed unrelated pre-existing changes in `apps/runtime/src/harness/runtime-kernel.ts`, untracked `runtime-clarifications.ts`, `runtime-output.ts`, `runtime-progress.ts`, and `tasks/TASK-20260428-0041-runtime-kernel-structural-split.md`; this task did not modify those files.
- `pnpm --filter @ora/runtime typecheck`: passed after extracting `provider-json.ts` and `agent-draft.ts`.
- `wc -l apps/runtime/src/run-store.ts apps/runtime/src/agent-draft.ts apps/runtime/src/provider-json.ts`: `run-store.ts` now 4563 lines; `agent-draft.ts` is 215 lines; `provider-json.ts` is 31 lines.
- `pnpm --filter @ora/runtime test -- custom-agents.test.ts mode-studio-builder.test.ts`: passed 13 test files / 208 tests. Vitest ran the full runtime suite despite requested filenames.
- `pnpm --filter @ora/runtime typecheck`: after Mode Studio helper extraction, local `slugifyModeStudio` import gap was fixed; remaining failures are unrelated harness errors in `src/harness/node-runtime-loop.ts` and `src/harness/runtime-action-runner.ts`.
- `pnpm --filter @ora/runtime exec vitest run test/custom-agents.test.ts test/mode-studio-builder.test.ts`: passed 2 files / 16 tests.
- `wc -l apps/runtime/src/run-store.ts apps/runtime/src/mode-studio-draft.ts apps/runtime/src/agent-draft.ts apps/runtime/src/provider-json.ts`: `run-store.ts` now 4034 lines; `mode-studio-draft.ts` is 580 lines.
- `pnpm --filter @ora/runtime exec vitest run test/custom-agents.test.ts test/mode-studio-builder.test.ts`: after run/resume helper extraction, passed 2 files / 16 tests.
- `pnpm --filter @ora/runtime typecheck`: passed after run/resume helper extraction.
- `pnpm --filter @ora/runtime exec vitest run test/runtime-smoke.test.ts test/session-thread.test.ts`: passed 2 files / 75 tests.
- `wc -l apps/runtime/src/run-store.ts apps/runtime/src/run-orchestration.ts apps/runtime/src/mode-studio-draft.ts apps/runtime/src/agent-draft.ts apps/runtime/src/provider-json.ts`: `run-store.ts` now 3930 lines; `run-orchestration.ts` is 146 lines.
- `pnpm --filter @ora/runtime typecheck`: passed after traced kernel lifecycle extraction.
- `pnpm --filter @ora/runtime exec vitest run test/custom-agents.test.ts test/mode-studio-builder.test.ts test/runtime-smoke.test.ts test/session-thread.test.ts`: passed 4 files / 91 tests.
- `wc -l apps/runtime/src/run-store.ts apps/runtime/src/run-kernel-lifecycle.ts apps/runtime/src/run-orchestration.ts`: `run-store.ts` now 3907 lines; `run-kernel-lifecycle.ts` is 93 lines.
- `pnpm --filter @ora/runtime typecheck`: initially failed during the stream checkpoint on `buildModeStudioDraft` optional `draftBundle` typing; passed after narrowing the helper signature.
- `pnpm --filter @ora/runtime exec vitest run test/custom-agents.test.ts test/mode-studio-builder.test.ts test/runtime-smoke.test.ts test/session-thread.test.ts`: initially failed because local Mode Studio refine appended guidance to a manual prompt; passed after preserving existing node prompts exactly.
- `pnpm --filter @ora/runtime typecheck`: passed after stream publisher/failure extraction.
- `pnpm --filter @ora/runtime exec vitest run test/custom-agents.test.ts test/mode-studio-builder.test.ts test/runtime-smoke.test.ts test/session-thread.test.ts`: passed 4 files / 94 tests.
- `wc -l apps/runtime/src/run-store.ts apps/runtime/src/run-streaming.ts apps/runtime/src/run-kernel-lifecycle.ts apps/runtime/src/run-orchestration.ts`: `run-store.ts` now 3884 lines; `run-streaming.ts` is 74 lines.
- `pnpm --filter @ora/runtime typecheck`: passed after non-kernel resume mutation extraction.
- `pnpm --filter @ora/runtime exec vitest run test/custom-agents.test.ts test/mode-studio-builder.test.ts test/runtime-smoke.test.ts test/session-thread.test.ts`: passed 4 files / 94 tests.
- `wc -l apps/runtime/src/run-store.ts apps/runtime/src/run-resume-mutation.ts`: `run-store.ts` now 3778 lines; `run-resume-mutation.ts` is 215 lines.
- `pnpm --filter @ora/runtime typecheck`: passed after deterministic pattern helper extraction.
- `pnpm --filter @ora/runtime exec vitest run test/custom-agents.test.ts test/mode-studio-builder.test.ts test/runtime-smoke.test.ts test/session-thread.test.ts`: passed 4 files / 94 tests.
- `wc -l apps/runtime/src/run-store.ts apps/runtime/src/run-deterministic-patterns.ts apps/runtime/src/run-resume-mutation.ts`: `run-store.ts` now 3609 lines; `run-deterministic-patterns.ts` is 189 lines.
- `rg -n "createCompletedRun\\(" apps/runtime/src apps/runtime/test -g'*.ts'`: before removal, returned only the private definition in `apps/runtime/src/run-store.ts`; after removal, returned no results.
- `pnpm --filter @ora/runtime typecheck`: passed after removing verified-dead `createCompletedRun`.
- `pnpm --filter @ora/runtime exec vitest run test/custom-agents.test.ts test/mode-studio-builder.test.ts test/runtime-smoke.test.ts test/session-thread.test.ts`: passed 4 files / 94 tests.
- `wc -l apps/runtime/src/run-store.ts`: `run-store.ts` now 3350 lines.
- `pnpm --filter @ora/runtime typecheck`: passed after snapshot factory extraction.
- `pnpm --filter @ora/runtime exec vitest run test/custom-agents.test.ts test/mode-studio-builder.test.ts test/runtime-smoke.test.ts test/session-thread.test.ts`: passed 4 files / 94 tests.
- `wc -l apps/runtime/src/run-store.ts apps/runtime/src/run-snapshots.ts`: `run-store.ts` now 3164 lines; `run-snapshots.ts` is 207 lines.
- `pnpm --filter @ora/runtime typecheck`: passed after Mode Studio builder run shell extraction.
- `pnpm --filter @ora/runtime exec vitest run test/custom-agents.test.ts test/mode-studio-builder.test.ts test/runtime-smoke.test.ts test/session-thread.test.ts`: passed 4 files / 94 tests.
- `wc -l apps/runtime/src/run-store.ts apps/runtime/src/mode-studio-builder-run.ts`: `run-store.ts` now 3100 lines; `mode-studio-builder-run.ts` is 157 lines.
- `bash /Users/quintenchen/.codex/skills/long-task-protocol/scripts/todo_scan.sh`: exited 0; repo-wide output is noisy from historical task journals, skill templates, generated runtime-sidecar bundles, and runtime DB binaries. No new blocker was identified in this task's touched source set.
- Task-scoped blocking marker scan across this journal and touched runtime source files: no blocking marker output after excluding the journal's completed-work heading and status evidence.
- Task-scoped unchecked checklist scan for `tasks/TASK-20260428-0038-run-store-architecture-split.md`: no unchecked task item output.
- `git diff --check -- apps/runtime/src/run-store.ts apps/runtime/src/runtime-errors.ts apps/runtime/src/persistence/types.ts apps/runtime/src/persistence/json-file-backend.ts apps/runtime/src/project-workspace.ts apps/runtime/src/provider-json.ts apps/runtime/src/agent-draft.ts apps/runtime/src/mode-studio-draft.ts apps/runtime/src/run-orchestration.ts apps/runtime/src/run-kernel-lifecycle.ts apps/runtime/src/run-streaming.ts apps/runtime/src/run-resume-mutation.ts apps/runtime/src/run-deterministic-patterns.ts apps/runtime/src/run-snapshots.ts apps/runtime/src/mode-studio-builder-run.ts apps/runtime/src/index.ts apps/runtime/src/json-rpc.ts apps/runtime/src/persistence/sqlite-backend.ts tasks/TASK-20260428-0038-run-store-architecture-split.md`: no output; passed.
