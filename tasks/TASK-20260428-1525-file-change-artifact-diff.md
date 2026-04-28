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
- 2026-04-28 15:36: Implemented runtime file-change metadata, artifact publishing, approved file-write resume artifact capture, desktop view-model derivation, artifact drawer preview, assistant diff panel, and targeted tests. Next: run final typechecks, TODO gate, and record closeout evidence.
- 2026-04-28 15:39: Verification passed. Vite dev server started on `http://127.0.0.1:1421/` because default port 1420 was already in use. Next: final response.

## Verification
- `pnpm --filter @ora/runtime test -- runtime-tool-executor.test.ts`
  - PASS: 14 test files, 214 tests.
- `pnpm --filter @ora/desktop test -- viewModel.test.ts AssistantTurnCard.test.tsx`
  - PASS: 9 test files, 39 tests.
- `pnpm --filter @ora/runtime test -- runtime-smoke.test.ts`
  - PASS: 14 test files, 214 tests.
- `pnpm --filter @ora/desktop typecheck`
  - PASS: `tsc --noEmit`.
- `pnpm --filter @ora/runtime typecheck`
  - PASS: `tsc -p tsconfig.json --noEmit`.
- `git diff --check`
  - PASS: no whitespace errors.
- Long-task TODO script output was not usable for this repo because it resolved a Quantfox task path:
  - `Task file: /Users/quintenchen/developer/quantfox/tasks/TASK-20260417-0051-equity-research-analysis-result-memory.md`
  - `Result: PASS`
- Diff-scoped TODO/FIXME scan over touched Ora files:
  - PASS: no matches.
- Dev server:
  - `pnpm --filter @ora/desktop dev` failed because port 1420 was already in use.
  - `pnpm --filter @ora/desktop exec vite --host 127.0.0.1 --port 1421` started successfully.

## Open Issues
None.

## Retrospective
- Status: local_only
  Evidence: The long-task TODO helper is sourced from the Quantfox skill path and selected a Quantfox task even when run from `/Users/quintenchen/developer/ora`.
  Lesson: For Ora closeout, pair the mandated helper output with a diff-scoped `rg TODO|FIXME` over touched Ora files so the verification evidence remains repo-local.

## Compressed State
Implemented file-change artifacts + diff for Ora assistant turns. Runtime `file.write`/`file.patch` now produce internal `fileChange` metadata with before/after text and add/delete counts while preserving existing `execute()` output. Runtime publishes `file_change` file artifacts and links them to actions, including approved file-write resume. Desktop derives `turn.fileChanges`, shows artifact entries first, and renders an inline collapsible diff panel. Artifact drawer previews `afterContent`. Tests and typechecks passed; dev server is running at `http://127.0.0.1:1421/`.
