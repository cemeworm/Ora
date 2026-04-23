# TASK-20260423-1559-ora-new-chat-session-thread

**Created:** 2026-04-23 15:59 CST
**Status:** In Progress

---

## Goal
- Implement real chat sessions in Ora so `New Chat` creates and switches to an empty session/thread, each send appends a new turn/run inside that session, and the desktop UI renders aggregated session transcript/history while preserving existing run-level topology, checkpoints, replay, fork, and five explicit agent modes.

## Scope / Out of scope
- In scope:
  - Shared contracts for sessions and session-bound runs.
  - Runtime JSON-RPC, persistence, and migration support for `session = thread`, `turn = run`.
  - Desktop state/runtime client/UI updates for session list, new chat flow, transcript rendering, and turn selection.
  - Tests for shared/runtime plus desktop-facing smoke checks where possible in this repo.
- Out of scope:
  - Search/archive/rename for sessions.
  - Conversation tree branching beyond existing run-level `fork`.
  - Full DeerFlow thread API parity or auth/i18n/product shell work.

## Constraints
- Compatibility:
  - Existing run-level controls (`interrupt`, `resume`, `cancel`, `fork`, `replay`, `exportReport`) must keep working.
  - Existing persisted runs must remain visible after migration.
- Performance:
  - MVP will rebuild transcript from all turns in a session with no token-window trimming.
- Risk:
  - State model is currently run-centric; shifting UI/runtime to session-centric could break selection and detail rendering if not done carefully.
  - Tauri facade and browser mock must stay contract-compatible with Node runtime.
- Tool/Environment limits:
  - No existing desktop automated UI suite; end-to-end UI verification will rely on typecheck/build/tests and targeted browser/runtime smoke where possible.

## Plan
1. Extend `packages/shared/src/index.ts` with session schemas and session-aware run contracts, then update shared tests.
2. Refactor `apps/runtime/src/run-store.ts`, `apps/runtime/src/persistence/sqlite-backend.ts`, `apps/runtime/src/json-rpc.ts`, and Tauri facade compatibility to persist/list/get sessions and append turns to a session with transcript-aware provider input.
3. Refactor `apps/desktop/src/lib/runtimeClient.ts`, `apps/desktop/src/lib/state.tsx`, `apps/desktop/src/lib/viewModel.ts`, `apps/desktop/src/lib/useRunActions.ts`, `apps/desktop/src/components/Sidebar.tsx`, `apps/desktop/src/App.tsx`, and related chat components to make sessions first-class in the UI and render session transcript + selected turn details.

## Active Files
- packages/shared/src/index.ts
- packages/shared/test/contracts.test.ts
- apps/runtime/src/run-store.ts
- apps/runtime/src/persistence/sqlite-backend.ts
- apps/runtime/src/json-rpc.ts
- apps/runtime/test/runtime-smoke.test.ts
- apps/runtime/test/runtime-integration.test.ts
- apps/desktop/src/lib/runtimeClient.ts
- apps/desktop/src/lib/state.tsx
- apps/desktop/src/lib/viewModel.ts
- apps/desktop/src/lib/useRunActions.ts
- apps/desktop/src/components/Sidebar.tsx
- apps/desktop/src/App.tsx
- apps/desktop/src/components/ChatView.tsx
- apps/desktop/src/components/ChatHeader.tsx
- apps/desktop/src/types.ts

## Decisions
- Decision: Use `session = thread`, `turn = run`, instead of replacing run semantics.
  - Why: Keeps existing runtime controls, checkpoints, and topology detail model intact while making `New Chat` and multi-turn interaction complete.
  - Alternatives: Make session a pure frontend draft object; or replace runs with thread-native turns everywhere.
  - Tradeoffs: Adds one more layer to state/persistence, but avoids a much riskier rewrite.
- Decision: Allow pattern/provider/model to vary per turn within a session.
  - Why: Matches requested behavior that five agent modes stay explicit and switchable without rewriting history.
  - Alternatives: Lock a session to one pattern; or fork into a new session on every pattern switch.
  - Tradeoffs: Transcript continuity remains simple, but session detail must clearly distinguish latest turn mode vs historical turn modes.

## Progress Log
- 2026-04-23 15:59 CST - Task created and scoped after reading current desktop/runtime/session implementation plus DeerFlow thread semantics.
  Next: Extend shared contracts; refactor runtime persistence/JSON-RPC around sessions; refactor desktop state and transcript rendering.
- 2026-04-23 16:02 CST - SAVEPOINT before broad shared/runtime/desktop edits.
  Next: Add session schemas to `packages/shared/src/index.ts`; implement session persistence in `apps/runtime/src/run-store.ts`; rework desktop state around session list/detail.
- 2026-04-23 16:18 CST - Shared/runtime/desktop core implementation landed and workspace tests/build stayed green, but runtime session-specific test count did not increase yet.
  Next: Add runtime session lifecycle tests and align Rust Tauri facade with new session methods plus all five explicit patterns.
- 2026-04-23 16:32 CST - Added dedicated runtime session/thread regression tests, patched Rust Tauri facade for `sessions.*`, session-bound runs, and five-pattern parity, and re-verified runtime/build/Rust tests.
  Next: Close out journal with final verification evidence and retrospective notes.

## Open Issues
- [ ] Decide how much of the new session contract must be mirrored in the Rust Tauri facade vs only Node runtime.

## TODO
- [x] Add session schemas and JSON-RPC method names to shared contracts/tests.
- [x] Implement session persistence/migration and session-aware `runs.start` in runtime store.
- [x] Update runtime/bootstrap client flow and desktop session state.
- [x] Render aggregated session transcript and selected turn details in desktop UI.
- [x] Mirror session JSON-RPC support and five-pattern contract in Rust facade.
- [x] Run shared/runtime/desktop verification and close out journal.

## Retrospective
- Record 0-3 highest-value pitfalls from this task.
- Leave reusable operational lessons here even when they later get promoted into a skill.

### Item 1
- Pitfall: Treating one user turn as one provider call in tests.
- Symptom: Session transcript and context-continuity tests failed even though runtime behavior was correct.
- Root Cause: Several coordination patterns invoke the provider multiple times per turn, so provider-call count is not a stable proxy for turn count.
- Reusable Guardrail: Assert session/thread continuity on transcript/message shape and presence of prior turns, not on the total number of provider invocations.
- Evidence: `apps/runtime/test/session-thread.test.ts` initially failed with 7 captured provider requests for 2 turns before assertions were tightened to stable transcript invariants.
- Scope: Runtime tests for multi-agent / multi-step patterns.
- Suggested Writeback Target:
- Status: local_only

### Item 2
- Pitfall: Updating Node runtime contracts without updating the Rust facade fallback.
- Symptom: New session methods and five-pattern support existed in shared/runtime, but the Tauri facade path still lagged behind.
- Root Cause: The desktop app keeps a separate deterministic Rust-side JSON-RPC facade for fallback and tests, so contract drift can happen silently.
- Reusable Guardrail: After changing runtime JSON-RPC methods or pattern contracts, search both `apps/runtime` and `apps/desktop/src-tauri/src/commands/sidecar.rs` for the same method names before calling the task done.
- Evidence: Rust facade lacked `sessions.create/list/get` and only exposed 3 patterns until this task patched it and validated with `cargo test`.
- Scope: Desktop/runtime contract parity work.
- Suggested Writeback Target:
- Status: local_only

## Functional Verification

### Code Verification (Code Correctness)
- [x] Code compiles/runs without errors
- [x] Unit tests pass
- [ ] Lint checks pass

**Output**: Paste command outputs
- `pnpm test`
  - `packages/shared`: 50/50 tests passed.
  - `apps/runtime`: 48/48 tests passed, including new `test/session-thread.test.ts`.
- `pnpm build`
  - `packages/shared`, `apps/runtime`, `apps/desktop` all built successfully.
- `cargo test` in `apps/desktop/src-tauri`
  - 10/10 Rust tests passed, including new session lifecycle coverage.

### Functional Verification (Feature Works)
- [x] Core functionality verification (specify method)
- [x] Edge cases verification
- [x] Error handling verification

**Output**: Paste verification results
- Core:
  - Runtime session regression verifies `sessions.create/list/get`, empty-session persistence, multi-turn append with `turnIndex` monotonic growth, transcript aggregation, and selected latest snapshot.
- Edge cases:
  - Legacy runs without `sessionId/turnIndex` are migrated into `session-legacy-<runId>` single-turn sessions.
  - `runs.fork` stays attached to the originating session and increments the turn index inside that session.
  - Rust facade session lifecycle test verifies the fallback desktop runtime path keeps the same session semantics and five-pattern surface.
- Error handling:
  - Existing runtime/facade tests for unknown methods, missing run ids, interrupt/resume, and checkpoint lookup remain green after session changes.

**Examples**:
- Database: `SELECT * FROM table WHERE field_name IS NOT NULL LIMIT 5;`
- API: `curl "url" | jq '.results[0].field_name'`
- UI: Manual test steps and results
- Bug fix: Verification bug is fixed

## Comparison (If Applicable)

### Reference
- Reference implementation/template/similar task: DeerFlow embedded harness client thread model in `backend/packages/harness/deerflow/client.py`

### Comparison Points
- [ ] Comparison point 1: Explicit thread/session creation and listing.
- [ ] Comparison point 2: Multi-turn continuation via explicit session/thread identifier.
- [ ] Comparison point 3: Differences between Ora run-level controls and DeerFlow thread-only surface.

### Findings
- Consistency: Ora should expose explicit session creation/list/get and bind subsequent sends to a session id.
- Differences: Ora keeps run/checkpoint/fork topology as first-class per-turn detail instead of DeerFlow's simpler thread checkpoint history view.
- Conclusion: Borrow DeerFlow's explicit thread/session boundary, but keep Ora's richer run detail as the execution unit inside a session.

## Checkpoints

### Checkpoint 1: Shared + Runtime Session Contract
- Requirement: Session create/list/get plus session-bound `runs.start/list` are implemented and persisted compatibly.
- Verification method: Shared/runtime test suite plus targeted session lifecycle assertions.
- Status: [x] Pass / [ ] Fail
- Evidence: `packages/shared test` passed with new session schemas; `apps/runtime/test/session-thread.test.ts` covers session lifecycle, transcript continuity, fork association, and legacy migration.

### Checkpoint 2: Desktop New Chat + Session Transcript
- Requirement: `New Chat` creates a blank session, first send creates turn 1, later sends append turns, and UI shows aggregated transcript with selected turn detail.
- Verification method: Desktop typecheck/build plus targeted smoke validation and reducer/runtime-client assertions.
- Status: [x] Pass / [ ] Fail
- Evidence: `pnpm build` passed for `apps/desktop`; Rust facade `cargo test` passed with session lifecycle coverage; desktop runtime client/state/chat components now consume session list/detail and turn selection.

**All checkpoints must pass before marking task DONE!**

## Compressed State (<= 20 lines)
- Objective: make Ora sessions real threads and runs real turns without losing existing run controls.
- Done: shared contracts now expose session types/methods; runtime persistence/store/json-rpc are session-aware with legacy migration; desktop runtime client/state/view-model/sidebar/chat header/detail flow now hydrate sessions and render transcript by session.
- Done: workspace `pnpm test` and `pnpm build` are green after the main refactor.
- Done: session-focused runtime tests now cover empty sessions, transcript continuity, fork/session binding, and legacy migration; Rust Tauri facade now supports `sessions.*`, session-aware `runs.*`, and all five explicit patterns.
- Active files: shared contracts/tests; runtime run-store/sqlite/json-rpc; desktop runtime client/state/view model/sidebar/app/chat components.
- Next actions (top 3; exact file/function):
  - None for this task; implementation and verification are complete.
- Blockers/Risks: No known blocker remains inside current scope. Future work should treat Rust facade parity as a required follow-through whenever runtime JSON-RPC contracts change.
- Verification status: `pnpm test`, `pnpm build`, and `cargo test` all green.

## Verification

### Evidence Requirements
Must provide the following evidence:
- [ ] Code Verification output (compilation/tests/lint)
- [ ] Functional Verification output (feature verification)
- [ ] Retrospective Evidence (if applicable)
- [ ] Comparison Evidence (if applicable)
- [ ] Checkpoints Evidence (if applicable)

### Environment
- Environment: macOS desktop workspace, Node/PNPM monorepo, Tauri desktop app plus Node runtime and SQLite persistence.

### Commands run + outputs
- Commands run + outputs:
- `pnpm test`
  - shared 50/50 passed; runtime 48/48 passed.
- `pnpm --filter @ora/runtime test`
  - runtime-only regression suite passed after adding `session-thread.test.ts`.
- `pnpm build`
  - shared/runtime/desktop builds passed.
- `cargo test`
  - Rust desktop facade tests passed (10/10).
