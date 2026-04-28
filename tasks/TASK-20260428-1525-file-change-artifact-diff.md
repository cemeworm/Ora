# TASK-20260428-1525-file-change-artifact-diff

## Goal
When Ora actually changes project files through runtime-owned file tools, assistant turns must show:
- artifact entries that open the changed file after the edit
- an inline diff panel showing before/after changes

## Scope
- Cover `file.write` and `file.patch`.
- Cover approved `file.write` resume path.
- Do not infer file changes from `shell.execute` in v1.
- Preserve existing `ArtifactRefSchema`; use a new `payload.kind = "file_change"` convention.

## Plan
1. Runtime: capture before/after file-change metadata without changing model-visible tool output.
2. Runtime: publish file-change artifacts and link them to actions.
3. Desktop view model: derive file-change attachments and diff rows from artifacts.
4. Desktop UI: render artifact entries and diff panel at the assistant turn bottom.
5. Verification: runtime tests, desktop tests, typecheck.

## Active Files
- `apps/runtime/src/harness/runtime-tool-executor.ts`
- `apps/runtime/src/harness/runtime-action-runner.ts`
- `apps/runtime/src/harness/node-runtime-loop.ts`
- `apps/runtime/src/approved-file-write-resume.ts`
- `apps/runtime/test/runtime-smoke.test.ts`
- `apps/desktop/src/types.ts`
- `apps/desktop/src/lib/viewModel.ts`
- `apps/desktop/src/lib/viewModel.test.ts`
- `apps/desktop/src/components/AssistantTurnCard.tsx`
- `apps/desktop/src/components/AssistantTurnCard.test.tsx`
- `apps/desktop/src/components/ArtifactDrawer.tsx`

## Checkpoints
- Runtime artifact checkpoint: file writes/patches emit file-change artifacts with before/after payloads.
- Desktop data checkpoint: assistant turn has artifact entries and diff metadata from snapshots.
- UI checkpoint: bottom area shows artifact entry first, diff panel second.
- Verification checkpoint: targeted tests and typecheck pass.

## Decisions
- V1 excludes `shell.execute` file-change detection.
- Artifact preview shows post-change content; inline diff shows review evidence.
- No new frontend dependency; implement a small line diff renderer.

## Progress Log
- 2026-04-28 15:25: Created task journal. Existing worktree already has unrelated runtime recovery changes and dirty desktop view model files; implementation must avoid reverting them. Next: inspect runtime executor/action seams, patch metadata capture, then wire desktop UI.

## Verification
Pending.

## Open Issues
None yet.

## Retrospective
Pending closeout.

## Compressed State
Need implement file-change artifacts + diff for Ora assistant turns. Runtime currently records toolCalls and generic artifacts separately; file.write/file.patch return only path/size/replacements, and assistant cards render only `turn.artifacts`. Plan is to add internal fileChange metadata around file writes/patches, publish file artifacts, derive turn file changes, and render artifact + diff bottom components. Existing dirty files are unrelated recovery work and must not be reverted.
