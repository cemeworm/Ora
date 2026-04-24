# TASK-20260424-1210-ora-turn-centric-chat-composition

**Created:** 2026-04-24 12:10 CST
**Status:** Done

---

## Goal
- Rework Ora chat from a flat transcript plus noisy runtime cards into a turn-centric conversation surface. Each turn should render as `user input -> assistant turn container`, where the assistant container holds the final text result as the primary content and attaches structured process steps, file artifacts, and turn-scoped todos below it.
- Keep the main transcript human-facing. Runtime control data must remain available for inspection, but it should no longer pollute the primary chat stream as standalone plan/action messages.

## Scope / Out of scope
- In scope:
  - Add a runtime/shared todo contract so todos are first-class snapshot data instead of a desktop-only heuristic.
  - Stop desktop transcript adaptation from appending runtime events as standalone chat messages.
  - Build a turn-centric desktop presentation model that combines transcript messages with per-run snapshot state.
  - Render assistant turns with structured process accordions, artifact cards, and todo sections attached to the corresponding turn.
  - Verify the integrated shared/runtime/desktop path with targeted type/tests/build checks.
- Out of scope:
  - Replacing Trails as the full-fidelity debug/workbench surface.
  - Dumping raw chain-of-thought into the main transcript.
  - New provider/model behavior unrelated to turn composition and todo state.
  - Broad refactors of unrelated dirty-worktree changes.

## Constraints
- Compatibility:
  - Keep `SessionTranscriptMessage` restricted to `user | assistant`; do not move display-only composition into the transcript contract.
- Product:
  - The main chat surface should be turn-centric and concise; Trails remains the deeper runtime inspection surface.
- Risk:
  - The worktree already contains unrelated in-flight changes across desktop/runtime/shared files; edits must be surgical and avoid reverting user work.
- Verification:
  - There is no dedicated desktop E2E suite for this flow, so closeout evidence must come from targeted shared/runtime tests plus desktop type/build checks.

## Plan
1. `packages/shared` + `apps/runtime`: add todo items to snapshot state, emit `todo.updated`, and keep todo status aligned with plan status transitions.
2. `apps/desktop/src/{App,types,lib/viewModel}.ts`: compose per-turn assistant attachments from transcript plus cached run snapshots instead of transcript-level runtime event messages.
3. `apps/desktop/src/components/*`: render assistant turn containers with collapsible process steps, artifact attachments, and todo sections.
4. Run focused verification, clean the task journal, and do not mark Done until the task-scoped TODO gate passes.

## Active Files
- tasks/TASK-20260424-1210-ora-turn-centric-chat-composition.md
- packages/shared/src/index.ts
- packages/shared/test/contracts.test.ts
- apps/runtime/src/capabilities.ts
- apps/runtime/src/harness/runtime-kernel.ts
- apps/runtime/src/run-store.ts
- apps/runtime/test/runtime-smoke.test.ts
- apps/desktop/src/App.tsx
- apps/desktop/src/types.ts
- apps/desktop/src/lib/runtimeClient.ts
- apps/desktop/src/lib/viewModel.ts
- apps/desktop/src/components/ChatMessages.tsx
- apps/desktop/src/components/ChatView.tsx
- apps/desktop/src/components/AssistantTurnCard.tsx
- apps/desktop/src/components/ai-elements/artifact.tsx
- apps/desktop/src/components/ai-elements/task.tsx

## Decisions
- Decision: Keep the shared transcript contract limited to `user | assistant` and move process visibility into assistant-turn attachments.
  - Why: The user-facing conversation should follow real dialogue logic instead of exposing runtime internals as top-level messages.
  - Alternatives: continue rendering runtime events as chat rows; push all process detail into Trails only.
  - Tradeoffs: Desktop view-model composition becomes richer, but the chat UX becomes substantially cleaner.
- Decision: Add runtime-native todos instead of only deriving them in desktop.
  - Why: Todos are part of the requested information architecture and should be stable snapshot state that every surface can consume.
  - Alternatives: derive todos from plan items in UI only; omit todos in v1.
  - Tradeoffs: Slightly broader implementation surface, but better long-term contract clarity and less UI guesswork.
- Decision: Keep Trails as the deep drill-down surface and make the chat process block a lightweight per-turn preview.
  - Why: The user wants structured process visibility in chat without turning the chat stream into a debugging console.
  - Alternatives: duplicate the full trail in chat; shrink Trails scope.
  - Tradeoffs: Some low-level trace detail stays in Trails, but chat remains readable.

## Progress Log
- 2026-04-24 12:10 CST - Created the task journal and scoped the redesign around a turn-centric chat surface with assistant-attached process, artifacts, and todos.
  Next: inspect transcript/runtime seams and split the work into runtime/shared and desktop streams.
- 2026-04-24 12:18 CST - Confirmed the root problem: shared/runtime transcript contracts were already `user | assistant`, but desktop `adaptChatMessages()` appended runtime events as transcript rows and `ChatMessages` rendered them in the main conversation.
  Next: add first-class todo state in runtime/shared and redesign desktop composition around per-turn snapshots.
- 2026-04-24 12:34 CST - Split implementation across agent teams with disjoint ownership: runtime/shared for todo contract + snapshot persistence, desktop for turn composition and rendering.
  Next: land runtime/shared changes, then integrate the desktop turn container UI on top.
- 2026-04-24 12:58 CST - Landed runtime/shared todo support and desktop turn composition. Assistant messages can now carry structured process steps, artifacts, and todos derived from cached run snapshots instead of transcript-level runtime cards.
  Next: run shared/runtime/desktop verification and close the DONE gate from the task file itself.
- 2026-04-24 13:22 CST - Verification passed across the integrated path: shared/runtime type/tests and desktop type/build all succeeded. Desktop smoke on `http://127.0.0.1:1420` also confirmed `hi` renders as `user + assistant turn` with collapsible `Steps` / `To-dos` and without standalone plan/action cards. The task-scoped `todo_scan.sh --task ...` gate passed after clearing journal TODO entries.
  Next: none.

## Open Issues
- none

## TODO
- None.

## Retrospective
- Record 0-3 highest-value pitfalls from this task.
- Leave reusable operational lessons here even when they later get promoted into a skill.

### Item 1
- Pitfall: A "desktop-only" UI request still touched shared/runtime because the requested information architecture explicitly included todos as first-class turn content.
- Symptom: Early scoping tried to keep todos as a UI heuristic, but that would have produced a weaker and less stable contract than the product request implied.
- Root Cause: The information architecture boundary was initially framed around rendering only, while the actual requirement included a new data primitive.
- Reusable Guardrail: When the user names data-bearing UI objects like files, todos, or checkpoints as distinct turn content, verify whether they deserve runtime-native state before constraining the task to presentation only.
- Evidence: The final integrated solution added `TodoItemSchema`, `todo.updated`, and snapshot-level `todos`, which removed the need for desktop-only guesswork.
- Scope: reusable
- Suggested Writeback Target: none
- Status: local_only

### Item 2
- Pitfall: The long-task DONE gate treats checked checklist items under `## TODO` as blocking entries.
- Symptom: `todo_scan.sh --task ...` failed even though every implementation item had been completed, because the journal still contained `[x]` checkbox lines in the TODO section.
- Root Cause: The journal had been left in checklist form instead of being normalized to a true completed-state record.
- Reusable Guardrail: Before final closeout, replace the `## TODO` section with `- None.` rather than leaving checked boxes behind.
- Evidence: The first task-scoped todo scan failed on the `[x]` lines and passed immediately after the journal cleanup.
- Scope: reusable
- Suggested Writeback Target: none
- Status: local_only

## Functional Verification

### Code Verification (Code Correctness)
- [x] Code compiles/runs without errors
- [x] Unit tests pass
- [ ] Lint checks pass

**Output**:
- `pnpm --filter @ora/shared typecheck`
  - Result: PASS
- `pnpm --filter @ora/runtime typecheck`
  - Result: PASS
- `pnpm --filter @ora/shared test -- packages/shared/test/contracts.test.ts`
  - Result: PASS
  - Key output:
    - `✓ test/contracts.test.ts (65 tests)`
- `pnpm --filter @ora/runtime test -- apps/runtime/test/runtime-smoke.test.ts`
  - Result: PASS
  - Key output:
    - `Test Files 7 passed (7)`
    - `Tests 69 passed (69)`
- `pnpm --filter @ora/desktop exec tsc --noEmit`
  - Result: PASS
- `pnpm --filter @ora/desktop build`
  - Result: PASS
  - Key output:
    - `✓ 1801 modules transformed.`
    - `✓ built in 1.84s`

### Functional Verification (Feature Works)
- [x] Core functionality verification (specify method)
- [x] Edge cases verification
- [ ] Error handling verification

**Output**:
- Contract verification:
  - `packages/shared/test/contracts.test.ts` now exercises the todo schema and updated mode contract.
- Runtime verification:
  - `apps/runtime/test/runtime-smoke.test.ts` now asserts snapshot todos exist, track plan transitions, and emit `todo.updated`.
- Desktop verification:
  - `pnpm --filter @ora/desktop exec tsc --noEmit` and `pnpm --filter @ora/desktop build` verified that the turn-centric chat composition compiles end-to-end with assistant turn attachments.
- Manual smoke:
  - On `http://127.0.0.1:1420`, sending `hi` produced only a user bubble plus a single assistant turn container; `Steps` / `To-dos` expanded correctly and no standalone plan/action transcript cards remained.
- Edge case covered:
  - Runtime smoke checks both completed and blocked/resumed plan flows so todo state does not only work for the happy path.

**Examples**:
- Shared contract: todo schema present in `OraStateSnapshot` and `OraEventType`.
- Runtime state: blocked/completed plan transitions keep todo status in sync.
- Desktop UI: assistant turn attachment composition compiles with missing/optional sections omitted.

## Comparison (If Applicable)

### Reference
- Reference implementation/template/similar task: DeerFlow `frontend/src/components/ai-elements` composition model plus Ora's existing Trails runtime contract.

### Comparison Points
- [x] Comparison point 1: assistant turns as composable containers instead of flat message/event rows.
- [x] Comparison point 2: process/artifact/todo content attached to a turn instead of split between transcript and side panel.
- [x] Comparison point 3: Trails preserved as deep runtime inspection rather than primary conversation output.

### Findings
- Consistency: Main conversation is now turn-centric, and process/todo details live under the assistant turn instead of polluting the transcript.
- Differences: Ora keeps the final answer visually lighter and retains Trails as the dedicated deep drill-down surface; the process accordion is intentionally smaller than DeerFlow's full component set.
- Conclusion: The redesign matches the target interaction model without over-importing DeerFlow-specific UI surface area.

## Checkpoints

### Checkpoint 1: Runtime Todo Contract
- Requirement: Todos exist as runtime/shared snapshot state and stay aligned with plan status transitions.
- Verification method: shared contract tests plus runtime smoke tests.
- Status: [x] Pass / [ ] Fail
- Evidence: `OraStateSnapshot` now includes `todos`, `OraEventType` includes `todo.updated`, and runtime smoke tests assert todo creation and status transitions.

### Checkpoint 2: Desktop Turn Model
- Requirement: Desktop chat composition keeps the visible transcript limited to user/assistant messages while attaching process/artifact/todo data to the assistant turn.
- Verification method: desktop typecheck/build and view-model inspection.
- Status: [x] Pass / [ ] Fail
- Evidence: `adaptChatMessages()` now groups transcript by turn/run snapshot data and builds `AssistantTurnAttachment` instead of appending transcript-level runtime event rows.

### Checkpoint 3: Turn-Centric Assistant UI
- Requirement: Chat renders assistant turns with structured process, artifacts, and todos rather than standalone plan/action cards.
- Verification method: desktop type/build checks and component integration review.
- Status: [x] Pass / [ ] Fail
- Evidence: `ChatMessages` routes assistant entries through `AssistantTurnCard`, which renders the final response plus collapsible process/task sections and artifact cards.

**All checkpoints must pass before marking task DONE!**

## Compressed State (<= 20 lines)
- Objective: ship a turn-centric Ora chat surface with assistant-attached process, artifacts, and todos.
- Done: runtime/shared todo contract, snapshot persistence, desktop per-turn snapshot caching, turn-centric transcript grouping, assistant turn containers, and targeted verification.
- In-progress: none.
- Active files: shared todo schema/tests; runtime todo service/store integration/tests; desktop App/types/viewModel/chat components; task journal.
- Next actions (top 3; exact file/function):
  - none
- Blockers/Risks: There is still no automated desktop E2E coverage for this turn-centric flow, so future visual regressions could slip through despite the successful manual smoke and build/test evidence.
- Verification status: complete.

## Verification

### Evidence Requirements
Must provide the following evidence:
- [x] Code Verification output (compilation/tests/lint)
- [x] Functional Verification output (feature verification)
- [x] Retrospective Evidence (if applicable)
- [x] Comparison Evidence (if applicable)
- [x] Checkpoints Evidence (if applicable)

### Environment
- Environment: `/Users/quintenchen/developer/ora`, macOS, zsh, pnpm workspace, Tauri desktop shell.

### Commands run + outputs
- Commands run + outputs:
  - `pnpm --filter @ora/shared typecheck`
    - PASS
  - `pnpm --filter @ora/runtime typecheck`
    - PASS
  - `pnpm --filter @ora/shared test -- packages/shared/test/contracts.test.ts`
    - PASS
    - `✓ test/contracts.test.ts (65 tests)`
  - `pnpm --filter @ora/runtime test -- apps/runtime/test/runtime-smoke.test.ts`
    - PASS
    - `Test Files 7 passed (7)`
    - `Tests 69 passed (69)`
  - `pnpm --filter @ora/desktop exec tsc --noEmit`
    - PASS
  - `pnpm --filter @ora/desktop build`
    - PASS
    - `✓ built in 1.84s`
  - Browser smoke at `http://127.0.0.1:1420`
    - PASS
    - Verified `hi` renders as `user + assistant turn`, `Steps` / `To-dos` accordions expand, and standalone plan/action transcript cards are absent.
  - `bash /Users/quintenchen/developer/quantfox/.codex/skills/long-task-protocol/scripts/todo_scan.sh --task /Users/quintenchen/developer/ora/tasks/TASK-20260424-1210-ora-turn-centric-chat-composition.md`
    - PASS
