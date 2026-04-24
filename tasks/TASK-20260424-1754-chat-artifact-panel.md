# TASK-20260424-1754-chat-artifact-panel

**Created:** 2026-04-24 17:54 CST
**Status:** Done

---

## Goal
- Fix two chat-run UX issues in Ora desktop: completed assistant turns must not show a loading spinner, and produced artifacts such as `Smoke run report` must open inside an Ora right-side Artifact panel rather than relying on an external file link.

## Scope / Out of scope
- In scope:
  - Make assistant turn leading icons reflect actual turn status instead of placeholder/transcript availability.
  - Add click handling from chat artifact cards to a right-side Artifact panel.
  - Allow the Artifact panel to stay open alongside Trails as a peer right panel.
  - Preview artifact content by type: structured JSON, text/log, image, and metadata fallback.
  - Verify with desktop typecheck and behavior-level checks.
- Out of scope:
  - Reworking runtime artifact persistence or adding a new artifact RPC unless current payload data proves insufficient.
  - Redesigning Trails tabs beyond keeping both side panels compatible.
  - Broad cleanup of unrelated dirty-worktree changes.

## Constraints
- Compatibility:
  - Preserve existing `ArtifactRef` wire shape; extend desktop view types only where needed to keep `payload`/`sizeBytes`.
  - Keep current Trails behavior and right-panel `WorkspacePane` visual language.
- Product:
  - Artifact and Trails panels should be able to appear side by side.
  - Completed turns without final assistant text may still show placeholder copy, but the status icon must be completed, not loading.
- Risk:
  - The repo already has unrelated modified files; edits must remain surgical and must not revert existing user or prior-agent changes.
- Verification:
  - Use `pnpm --filter @ora/desktop typecheck`.
  - Add focused desktop tests only if an existing test harness makes that low-friction; otherwise record typecheck plus static/behavioral evidence.

## Plan
1. `apps/desktop/src/lib/viewModel.ts` + `AssistantTurnCard.tsx`: separate placeholder copy from loading state and drive the leading icon from `turn.status`.
2. `apps/desktop/src/types.ts` + view-model artifact adapters: retain artifact `payload`, `sizeBytes`, and preview metadata for both turn cards and panel selection.
3. `apps/desktop/src/lib/state.tsx` + `App.tsx`: add selected artifact state and render a peer Artifact panel next to Trails without closing Trails.
4. `apps/desktop/src/components/*`: make artifact cards clickable and add `ArtifactDrawer` with JSON/text/image/fallback previews.
5. Run verification, update this journal with command output and functional evidence, then close the TODO/DONE gates.

## Active Files
- tasks/TASK-20260424-1754-chat-artifact-panel.md
- apps/desktop/src/App.tsx
- apps/desktop/src/types.ts
- apps/desktop/src/lib/state.tsx
- apps/desktop/src/lib/viewModel.ts
- apps/desktop/src/components/AssistantTurnCard.tsx
- apps/desktop/src/components/ChatMessages.tsx
- apps/desktop/src/components/ChatView.tsx
- apps/desktop/src/components/MessageBubble.tsx
- apps/desktop/src/components/ArtifactDrawer.tsx

## Decisions
- Decision: Artifact panel is a peer right-side panel, not a Trails tab.
  - Why: The user explicitly chose side-by-side Trails + Artifact behavior.
  - Alternatives: replace Trails or merge both into one tabbed panel.
  - Tradeoffs: More layout pressure on narrow screens, but better inspection workflow.
- Decision: Use existing artifact `payload` first for inline previews.
  - Why: runtime/exported reports already include payload in `ArtifactRef`, so a new RPC is unnecessary for this bug fix.
  - Alternatives: lazy-load file URI content from disk.
  - Tradeoffs: Payload-backed previews are immediate; artifacts without payload need a metadata fallback.

## Progress Log
- 2026-04-24 17:54 CST - Created task journal from the user request and current repo inspection. The likely fixes are desktop-only: status icon/rendering state and artifact panel state/preview plumbing.
  Next: implement status icon fix, preserve artifact payload metadata, then add peer Artifact panel.
- 2026-04-24 18:00 CST - Implemented desktop-side fixes: assistant turn icon is status-driven, artifact adapters preserve payload/size metadata, chat artifact cards open a peer Artifact panel, and `ArtifactDrawer` renders JSON/text/image/fallback previews.
  Next: record verification evidence, run task TODO gate, and close the journal.
- 2026-04-24 18:06 CST - Final verification completed: desktop typecheck/build passed, browser flow passed, lint-if-present and diff whitespace checks passed, and task-scoped TODO gate passed.
  Next: none.
- 2026-04-24 18:18 CST - Reopened for follow-up: when Trails and Artifact are both open, the boundary between them also needs a draggable vertical resize handle matching the main-content/Trails divider.
  Next: add artifact panel width state and resize handle in `App.tsx`, then re-run verification.
- 2026-04-24 18:25 CST - Added the Trails/Artifact boundary resize handle and made artifact panel width stateful. Browser verification confirmed both resize handles are present and dragging the artifact handle expands the Artifact panel while Trails remains open.
  Next: none.
- 2026-04-24 19:26 CST - Removed the assistant-turn text status badge from the message metadata row, per screenshot feedback. The left status icon remains as the only turn-state indicator.
  Next: none; focused typecheck/lint/diff/TODO gates and browser DOM verification passed.
- 2026-04-24 19:30 CST - Applied three browser diff comments: removed the user bubble timestamp, removed the assistant message metadata row, and removed the artifact card `Produced at` footer.
  Next: none; focused typecheck/browser verification plus lint/diff/TODO gates passed.

## Open Issues
- none

## TODO
- None.

## Retrospective
- No reusable pitfalls worth promoting. The key local caution was the dirty worktree: all edits stayed within the task's active files and did not revert unrelated changes.

## Functional Verification

### Code Verification (Code Correctness)
- [x] Code compiles/runs without errors
- [x] Unit tests pass or are documented as not applicable
- [x] Lint/type checks pass

**Output**:
- `pnpm --filter @ora/desktop typecheck`
  - `@ora/desktop@0.1.0 typecheck ... tsc --noEmit`
  - Exit code 0.
- `pnpm --filter @ora/desktop build`
  - `tsc && vite build`
  - `✓ 1802 modules transformed.`
  - `✓ built in 1.87s`
  - Exit code 0.
- `pnpm --filter @ora/desktop --if-present lint`
  - No output.
  - Exit code 0.
- `git diff --check -- <task active files>`
  - No output.
  - Exit code 0.
- `bash /Users/quintenchen/developer/quantfox/.codex/skills/long-task-protocol/scripts/todo_scan.sh --task /Users/quintenchen/developer/ora/tasks/TASK-20260424-1754-chat-artifact-panel.md`
  - `Blocking TODO matches: none`
  - `Blocking task-journal TODO entries: none`
  - `Result: PASS`
- No dedicated desktop unit test harness exists for this interaction; behavior was verified in the running Vite app via the in-app browser.

### Functional Verification (Feature Works)
- [x] Done turn icon is a check, not spinner.
- [x] Running turn icon remains a spinner.
- [x] Clicking `Smoke run report` opens an Artifact side panel.
- [x] Artifact panel can coexist with Trails.
- [x] JSON/text/image/fallback preview paths are implemented.
- [x] Trails/Artifact divider can resize the Artifact panel.
- [x] Assistant turn metadata row does not render a textual `done` status badge.
- [x] User bubble does not render its timestamp.
- [x] Assistant message does not render timestamp/approval metadata below the reply.
- [x] Chat artifact card does not render the `Produced at` footer.

**Output**:
- Browser flow on `http://127.0.0.1:1420/`:
  - Sent `hi`, approved the local smoke approval gate, clicked `Export`.
  - DOM showed `generic: done` for the assistant turn and a `Smoke run report` artifact button.
  - `.animate-spin` count after done was `0`.
  - Clicked `Trails`, then clicked `Smoke run report`; DOM showed both right-side headings `Trails` and `Artifact`.
  - Artifact panel displayed `Smoke run report`, `report · application/json`, and structured JSON keys: `runId`, `pattern`, `status`, `eventCount`, `checkpointCount`.
- Follow-up browser flow on `http://127.0.0.1:1420/`:
  - Opened Trails and Artifact together.
  - DOM showed `Resize trails panel` count `1` and `Resize artifact panel` count `1`.
  - Dragged the Artifact divider left; screenshot verification showed the Artifact panel expanded while Trails remained open.
- Status-badge follow-up:
  - Removed the textual turn status badge from `AssistantTurnCard`.
  - Browser DOM check on the previously selected badge selector returned `targetBadgeCount: 0`.
  - Browser DOM snapshot check returned `hasTurnDoneBadgePattern: false`.
- Browser diff-comment follow-up:
  - Removed the user bubble timestamp from `MessageBubble`.
  - Removed the assistant message metadata row from `AssistantTurnCard`.
  - Removed the artifact card `Produced at` footer from `AssistantTurnCard`.
  - Browser DOM checks returned `userTimestamp: 0`, `assistantMeta: 0`, and `artifactProducedAt: 0`.
  - Browser DOM snapshot returned `hasProducedAt: false`, `hasApprovalGateMetaText: false`, `hasUserTime1823: false`, and `hasUserTime1824: false`.
- Static code evidence:
  - `TurnStatusIcon` maps `done` to `CheckCircle2` and `running`/loading placeholders to `LoaderCircle`.
  - `ArtifactPreview` has branches for image URI, JSON payload, text/log payload, and metadata fallback.
  - `App.tsx` now stores `artifactPanelWidth` in state and wires `handleArtifactResizeStart` to the new artifact divider.

## Comparison

### Reference
- Reference implementation/template/similar task: `tasks/TASK-20260424-1210-ora-turn-centric-chat-composition.md`, existing `TrailsDrawer` right-panel pattern.

### Comparison Points
- [x] Assistant-turn content remains attached to the turn.
- [x] Artifact detail uses right-panel `WorkspacePane` interaction similar to Trails.
- [x] Verification evidence is recorded in this journal before Done.

### Findings
- Consistency: The change extends the turn-centric chat model from `TASK-20260424-1210` and reuses the same right-panel shell pattern as Trails.
- Differences: Artifact panel is a peer panel, not a replacement for Trails.
- Conclusion: Consistent with existing UI architecture and the user's chosen side-by-side interaction.

## Checkpoints

### Checkpoint 1: Turn Status Icon
- Requirement: Completed turns without final assistant text must not show a loading spinner.
- Verification method: inspect render logic and typecheck; if possible, run/verify locally.
- Status: [x] Pass / [ ] Fail
- Evidence: Browser verification after a completed/exported run reported `.animate-spin count after done 0`; code maps `turn.status === "done"` to `CheckCircle2`.

### Checkpoint 2: Artifact Panel
- Requirement: Clicking a chat artifact opens an inline Artifact panel that can coexist with Trails.
- Verification method: inspect state/data flow and typecheck; if possible, run/verify locally.
- Status: [x] Pass / [ ] Fail
- Evidence: Browser DOM after clicking Trails then `Smoke run report` showed both right-side headings `Trails` and `Artifact`.

### Checkpoint 3: Type-Specific Preview
- Requirement: JSON/text/image artifacts render with suitable previews and unknown artifacts show metadata fallback.
- Verification method: inspect component branches and typecheck.
- Status: [x] Pass / [ ] Fail
- Evidence: Browser DOM showed JSON keys from the report payload; `ArtifactPreview` includes explicit branches for image URI, JSON payload, text/log payload, and no-preview fallback.

### Checkpoint 4: Trails/Artifact Resize Divider
- Requirement: When Trails and Artifact are both open, the boundary between them has a draggable vertical resize handle.
- Verification method: desktop typecheck/build plus browser DOM and drag verification.
- Status: [x] Pass / [ ] Fail
- Evidence: Browser DOM showed `Resize artifact panel` count `1`; dragging the handle left expanded the Artifact panel while Trails stayed open.

### Checkpoint 5: Turn Status Text Badge
- Requirement: The assistant turn metadata row should not display the textual status badge such as `done`.
- Verification method: typecheck plus browser DOM check on the selected turn metadata row.
- Status: [x] Pass / [ ] Fail
- Evidence: `AssistantTurnCard` no longer renders `turn.status.replace(...)`; browser DOM check found no textual `done` badge in the selected turn metadata.

### Checkpoint 6: Message/Artifact Low-Value Metadata
- Requirement: Browser-diff annotated timestamp, assistant metadata, and artifact production timestamp should not be displayed in the chat stream.
- Verification method: typecheck plus browser DOM checks against the three annotated selectors.
- Status: [x] Pass / [ ] Fail
- Evidence: Browser DOM checks returned zero matches for the three annotated selectors and no snapshot text for `Produced at`, `1 approval gate`, `18:23`, or `18:24`.

## Compressed State (<= 20 lines)
- Objective: Fix chat done-turn spinner and add side-by-side Artifact panel for produced artifacts.
- Done: Status icon fix, removed low-value chat metadata, artifact metadata adapters, peer Artifact panel, click wiring, Trails/Artifact resize handle, typecheck/build/browser verification.
- In-progress: none.
- Active files: App/state/types/viewModel/AssistantTurnCard/ChatMessages/ChatView/MessageBubble/new ArtifactDrawer.
- Next actions (top 3; exact file/function): none.
- Blockers/Risks: dirty worktree has unrelated changes; no task blocker.
- Verification status: desktop typecheck/build passed; browser drag/status-badge/metadata verification passed; lint/diff/TODO gates passed.

## Verification

### Evidence Requirements
Must provide the following evidence:
- [x] Code Verification output
- [x] Functional Verification output
- [x] Retrospective Evidence
- [x] Comparison Evidence
- [x] Checkpoints Evidence

### Environment
- Environment: `/Users/quintenchen/developer/ora`, 2026-04-24 CST.

### Commands run + outputs
- `pnpm --filter @ora/desktop typecheck`
  - `tsc --noEmit`
  - Exit code 0.
- `pnpm --filter @ora/desktop build`
  - `tsc && vite build`
  - `✓ 1802 modules transformed.`
  - `✓ built in 1.87s`
  - Exit code 0.
- `pnpm --filter @ora/desktop --if-present lint`
  - No output.
  - Exit code 0.
- `git diff --check -- apps/desktop/src/App.tsx apps/desktop/src/types.ts apps/desktop/src/lib/state.tsx apps/desktop/src/lib/viewModel.ts apps/desktop/src/components/AssistantTurnCard.tsx apps/desktop/src/components/ChatMessages.tsx apps/desktop/src/components/ChatView.tsx apps/desktop/src/components/ArtifactDrawer.tsx tasks/TASK-20260424-1754-chat-artifact-panel.md`
  - No output.
  - Exit code 0.
- `bash /Users/quintenchen/developer/quantfox/.codex/skills/long-task-protocol/scripts/todo_scan.sh --task /Users/quintenchen/developer/ora/tasks/TASK-20260424-1754-chat-artifact-panel.md`
  - `TODO scan mode: task`
  - `Blocking TODO matches: none`
  - `Blocking task-journal TODO entries: none`
  - `Result: PASS`
- Status-badge follow-up:
  - `pnpm --filter @ora/desktop typecheck`
    - `tsc --noEmit`
    - Exit code 0.
  - `pnpm --filter @ora/desktop --if-present lint`
    - No output.
    - Exit code 0.
  - `git diff --check -- apps/desktop/src/components/AssistantTurnCard.tsx tasks/TASK-20260424-1754-chat-artifact-panel.md`
    - No output.
    - Exit code 0.
  - `bash /Users/quintenchen/developer/quantfox/.codex/skills/long-task-protocol/scripts/todo_scan.sh --task /Users/quintenchen/developer/ora/tasks/TASK-20260424-1754-chat-artifact-panel.md`
    - `Blocking TODO matches: none`
    - `Blocking task-journal TODO entries: none`
    - `Result: PASS`
  - Browser DOM check on `http://127.0.0.1:1420/`
    - `targetBadgeCount: 0`
    - `hasTurnDoneBadgePattern: false`
- Browser diff-comment follow-up:
  - `pnpm --filter @ora/desktop typecheck`
    - `tsc --noEmit`
    - Exit code 0.
  - Browser DOM check on `http://127.0.0.1:1420/`
    - `userTimestamp: 0`
    - `assistantMeta: 0`
    - `artifactProducedAt: 0`
    - `hasProducedAt: false`
    - `hasApprovalGateMetaText: false`
    - `hasUserTime1823: false`
    - `hasUserTime1824: false`
  - `pnpm --filter @ora/desktop --if-present lint`
    - No output.
    - Exit code 0.
  - `git diff --check -- apps/desktop/src/components/MessageBubble.tsx apps/desktop/src/components/ChatMessages.tsx apps/desktop/src/components/AssistantTurnCard.tsx tasks/TASK-20260424-1754-chat-artifact-panel.md`
    - No output.
    - Exit code 0.
  - `bash /Users/quintenchen/developer/quantfox/.codex/skills/long-task-protocol/scripts/todo_scan.sh --task /Users/quintenchen/developer/ora/tasks/TASK-20260424-1754-chat-artifact-panel.md`
    - `Blocking TODO matches: none`
    - `Blocking task-journal TODO entries: none`
    - `Result: PASS`
- `pnpm --filter @ora/desktop dev`
  - Existing server already occupied port 1420: `Error: Port 1420 is already in use`.
  - Reused the running dev server at `http://127.0.0.1:1420/`.
- Browser automation evidence:
  - Page title: `Ora Operator Workbench · Chat`.
  - `animate-spin count after done 0`.
  - DOM showed both `Trails` and `Artifact` headings after opening both panels.
  - Artifact JSON preview showed keys `runId`, `pattern`, `status`, `eventCount`, `checkpointCount`.
- Follow-up resize evidence:
  - `resize trails 1`
  - `resize artifact 1`
  - Dragged from the Trails/Artifact divider toward the left; screenshot showed Artifact panel width increased and Trails stayed visible.
