# TASK-20260501-2147-streaming-approval-resume-projection

## Goal
Fix the Ora runtime bug where a streaming run interrupted for approval can be resumed into a fake successful non-kernel completion without executing the approved action.

The immediate reproduced case is `session-0053` / `run-0062`: a PDF URL -> Obsidian task entered approval for a `shell.execute` download, then after approval became `succeeded` with `output = null` and no actual continuation.

## Scope
- Persist this task journal as the single source of truth.
- Fix streaming live snapshot projection for approval/action events.
- Add minimal defensive behavior only if required by the projection fix.
- Improve `document.extract` error text when a URL is mistakenly passed as `path`.
- Add focused regression tests and record actual verification output.

## Out of scope
- Desktop UI redesign or transcript rendering changes.
- Broad resume architecture rewrite.
- Reprocessing the original paper into Obsidian.
- Full PDF/OCR capability changes.

## Root Cause
`apps/runtime/src/run-streaming.ts` only projected streamed events into `status`, `events`, `agentMessages`, and `updatedAt`. It did not update top-level `actions` or `pendingApprovals` for `action.updated` and `approval.required` events.

`apps/runtime/src/run-orchestration.ts::hasKernelResumeWork` determines whether to use kernel resume from top-level snapshot fields. Because streaming live snapshots had empty `actions`, approval resume was misclassified as non-kernel work and fell through to `apps/runtime/src/run-resume-mutation.ts::completeNonKernelResumeMutation`, which writes `run.done` / `succeeded` directly.

## Evidence
Read-only database inspection of `/Users/quintenchen/developer/ora/.ora/runtime.db` found:
- `run-0062` final `status = succeeded`.
- Final `output = null`.
- Final top-level `actions = []`, `toolCalls = []`, `pendingApprovals = []`.
- Events included:
  - `document.extract` called as `{ "path": "https://www.k-a.in/Thinking_with_Visual_Primitives.pdf", "format": "text" }`, failed with `ENOENT` under the Obsidian root.
  - `web.fetch` succeeded and returned: `This URL points to a PDF document. Use document.extract with the URL to extract readable text instead of web.fetch.`
  - `shell.execute` proposed command `curl -L -o /tmp/Thinking_with_Visual_Primitives.pdf ...`.
  - `approval.required` for the shell action.
  - `run.interrupted` with reason `approval_required`.
  - `run.resumed` after approval.
  - `run.done` with summary `Deterministic MVP run resumed and completed.`

## Plan
1. Update streaming projection in `apps/runtime/src/run-streaming.ts`.
2. Add focused projection tests in `apps/runtime/test/run-streaming.test.ts`.
3. Improve PDF URL-as-path error in `apps/runtime/src/harness/runtime-tool-executor.ts`.
4. Add focused test in `apps/runtime/test/runtime-tool-executor.test.ts`.
5. Run targeted tests and record output.
6. Run TODO scan and update verification.

## Active Files
- `tasks/TASK-20260501-2147-streaming-approval-resume-projection.md`
- `apps/runtime/src/run-streaming.ts`
- `apps/runtime/test/run-streaming.test.ts`
- `apps/runtime/src/harness/runtime-tool-executor.ts`
- `apps/runtime/test/runtime-tool-executor.test.ts`
- Potential reference only: `apps/runtime/src/run-orchestration.ts`
- Potential reference only: `apps/runtime/src/run-store.ts`
- Potential reference only: `apps/runtime/src/run-resume-mutation.ts`

## Decisions
- Keep the runtime fix surgical: patch streaming projection rather than redesign resume.
- Do not fabricate incomplete `toolCalls` unless available event payloads contain enough schema-compatible data.
- Make PDF URL misuse fail with an actionable `url` parameter hint instead of silently resolving it as a project file path.

## TODO
- [x] Create this task journal before code edits.
- [x] Patch `applyStreamingRunEvent` action/approval projection.
- [x] Add streaming projection regression tests.
- [x] Patch `document.extract` URL-as-path hint.
- [x] Add document.extract regression test.
- [x] Run targeted tests.
- [x] Run TODO scan.
- [x] Update Verification, Retrospective, and Compressed State before closing.

## Open Issues
- TODO(FOLLOWUP): Evaluate whether `tool.called` payloads should also project to top-level `toolCalls`; current fix intentionally avoids fabricating incomplete tool call envelopes.
- Package filter confirmed: `@ora/runtime`.

## Checkpoints
| Requirement | Verification method | Pass criteria |
| --- | --- | --- |
| Streaming approval state is projected | Focused unit test in `run-streaming.test.ts` | `actions` contains approval-required action and `pendingApprovals` contains action id |
| Approval resolution is projected | Focused unit test in `run-streaming.test.ts` | `pendingApprovals` removes resolved id without removing unrelated ids |
| Existing streaming status/message behavior remains | Existing tests in `run-streaming.test.ts` | Existing tests still pass |
| PDF URL passed as path is actionable | Focused runtime tool executor test | Error message says to use `url` parameter |
| No fake succeeded regression | Code path review plus focused tests | Resume can see kernel work from top-level projection |

## Comparison
- Reference source: existing `apps/runtime/test/run-streaming.test.ts` projection tests.
- Compared points: current tests only cover `agent.message`; new tests should follow the same minimal snapshot/event helper style.
- Expected difference: new tests exercise action/approval projection, not UI transcript behavior.
- Consistency conclusion: keep tests in the same file because the defect lives in `applyStreamingRunEvent` projection.

## Progress Log
- 2026-05-01 21:47: Created task journal from approved plan. Next: patch `run-streaming.ts`, add focused tests, then patch PDF URL hint.
- 2026-05-01 21:59: Patched streaming projection, added regression tests, patched PDF URL-as-path hint, and ran focused tests/typecheck. Next: keep `toolCalls` projection as follow-up if needed, review diff before commit, avoid touching unrelated existing workspace changes.
- 2026-05-01 22:05: Ran broad check script; runtime/shared passed but desktop test failed in unrelated `AssistantTurnCard` expectation from existing workspace diff. Saved reusable workflow as user-level skill `ora-streaming-approval-resume-projection`. Next: decide whether to fix unrelated desktop test separately or commit only this runtime fix with caveat.

## Verification
### Command: `pnpm --filter @ora/runtime test -- run-streaming.test.ts runtime-tool-executor.test.ts`
Result: PASS.

Key output:
```text
Test Files  22 passed (22)
Tests  316 passed (316)
```

### Command: `pnpm --filter @ora/runtime typecheck`
First run failed with:
```text
src/run-streaming.ts(74,85): error TS18046: 'event.payload' is of type 'unknown'.
```
Fixed by storing the narrowed `actionId` in a local const before filtering.

Second run result: PASS.
```text
> @ora/runtime@0.1.0 typecheck /Users/quintenchen/developer/ora/apps/runtime
> tsc -p tsconfig.json --noEmit
```

### Command: `bash "$HOME/.workbuddy/skills/long-task-protocol/scripts/todo_scan.sh"`
Result: PASS with known historical/generated matches only; no actionable TODO introduced in this task. Re-run after journal update produced the same categories.

Key output categories:
```text
./.workbuddy/memory/... historical notes
./skills/skill-creator/scripts/init_skill.py template TODOs
./apps/desktop/src-tauri/resources/runtime-sidecar/... generated TODOs
Binary file ./.ora/runtime.db matches
```

### Command: `git diff --check -- <task files>`
Result: PASS.
```text
(no output)
```

### Command: `bash "$HOME/.workbuddy/skills/check/scripts/run-tests.sh"`
Result: FAIL due unrelated/pre-existing desktop diff outside this task's touched files.

Relevant output:
```text
apps/desktop test: FAIL src/components/AssistantTurnCard.test.tsx > assistant turn display helpers > shows only the latest process step before the user expands progress
apps/desktop test: AssertionError: expected ... to contain '对象：analysis/report.md'
apps/desktop test: Test Files 1 failed | 11 passed (12)
```

Assessment: this task changed runtime streaming/tool-executor files and their runtime tests. The failing desktop assertion is in `apps/desktop/src/components/AssistantTurnCard.test.tsx`, which is part of existing workspace changes and unrelated to this runtime approval-resume fix. Full-workspace verification is therefore blocked, while focused runtime verification passed.

## Retrospective
- Status: candidate_for_skill
  - Evidence: streaming run final snapshots were missing top-level `actions` even though `events` contained approval/action updates, and resume branching trusted top-level fields.
  - Guardrail: when adding streamed event types that affect resumability, add projection tests proving both event history and top-level snapshot fields are updated.
  - Writeback target: Ora runtime streaming/resume skill if this pattern recurs.
- Status: local_only
  - Evidence: `document.extract(path=https://...)` produced a misleading project-path `ENOENT` under the selected Obsidian root.
  - Guardrail: tool inputs with mutually exclusive local path vs URL parameters should reject obvious URL/path mixups before filesystem resolution.

## Compressed State
- DONE: Created task journal as the source of truth.
- DONE: `apps/runtime/src/run-streaming.ts` now projects `action.updated`, `approval.required`, and `approval.resolved` into top-level snapshot state.
- DONE: `apps/runtime/test/run-streaming.test.ts` covers action upsert, pending approval add/dedupe/remove, and terminal status projection.
- DONE: `apps/runtime/src/harness/runtime-tool-executor.ts` rejects `document.extract` URL values passed via `path` with a `url` parameter hint.
- DONE: `apps/runtime/test/runtime-tool-executor.test.ts` covers the URL-as-path hint.
- VERIFIED: runtime tests and runtime typecheck pass.
- FOLLOWUP: consider safe `tool.called` -> `toolCalls` projection only if schema-complete payloads are available.
