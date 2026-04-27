# TASK-20260427-1815: Ora approval deadlock root cause

## Goal

Fix the recurring approval deadlock where the user approves repeatedly but the chat remains stuck around `Manual approval required`.

## Scope

- Inspect runtime truth for the currently reported run (`run-0036`) before changing code.
- Determine whether the failure is frontend resume dispatch, runtime resume matching, streaming/session hydration, or stale UI rendering.
- Implement the smallest fix that covers the actual repeated approval class.
- Add regression coverage that fails on the unfixed behavior.

## Assumptions

- The screenshot is from the Ora repo in `/Users/quintenchen/developer/ora`.
- The authoritative runtime store is `.ora/runtime.db` unless evidence points to another app data directory.
- Existing unrelated dirty files are user or prior-work changes and must not be reverted.

## Checkpoints

1. Runtime evidence: extract `run-0036` status, pending approvals, `run.resumed`, `approval.required`, `approval.resolved`, and latest action events.
2. Hypothesis: state one root-cause sentence with file/function evidence before edits.
3. Regression: add a test that reproduces the repeated approval deadlock class.
4. Verification: run focused test, runtime typecheck, and broader runtime test suite if feasible.

## Active Files

- `tasks/TASK-20260427-1815-ora-approval-deadlock-root-cause.md`
- `apps/runtime/src/harness/runtime-interrupts.ts`
- `apps/runtime/src/run-store.ts`
- `apps/runtime/src/json-rpc.ts`
- `apps/runtime/test/runtime-smoke.test.ts`
- `apps/desktop/src/lib/useRunActions.ts`
- `apps/desktop/src/lib/runtimeClient.ts`
- `apps/desktop/src-tauri/src/commands/sidecar.rs`
- `packages/shared/src/rpc.ts`

## Progress Log

- 2026-04-27 18:15: Created task journal after the approval bug recurred despite prior `file.write` path-scope fix. Need to inspect `run-0036` runtime evidence before touching more code. Next: query `.ora/runtime.db`, classify whether resume happened, then write a specific hypothesis.
- 2026-04-27 18:18: Queried `.ora/runtime.db` for `run-0036`. Evidence: run status is `interrupted`, but it already contains `approval.resolved` for `run-0036:action:router-tool-87`, followed by successful `file.write`, then a second `approval.required` for `run-0036:action:investigator-tool-180` writing the same `/Users/quintenchen/developer/obsidian/10-Wiki/项目/西芒杜项目.md`. Next: change file-write resume scope from single-use to same-path scope across the resumed kernel pass and add a regression with two same-path writes after resume.
- 2026-04-27 18:22: Implemented same-path file-write approval scope across agents and repeated same-path writes during one resumed kernel pass. Repackaged bundled runtime sidecar because desktop showed `bundled` and the previous sidecar timestamp was 17:37, before this fix. Next: close with verification and note that the app must restart to pick up the new bundled sidecar.
- 2026-04-27 20:35: User reported that after clicking approve and waiting, no next action appeared. Rechecked `.ora/runtime.db`: `run-0036` remained `interrupted` with `pendingApprovals=["run-0036:action:investigator-tool-180"]`, no completion, and no persisted progress after the click. Process list showed a live `sidecar-entry.ts` process spawned from the desktop bridge, matching a blocked `runs.resume` call rather than a completed resume.
- 2026-04-27 20:42: Root cause refined: the approval button called synchronous `runs.resume`, so the one-shot sidecar process did not return a response until the resumed run fully completed. While that process was doing provider/tool work, the UI only showed an optimistic running state and could not receive post-approval stream events. Implemented `runs.resumeStreaming`, changed desktop approval to use it, and added Tauri notification forwarding for resume streams. Repackaged sidecar at `Apr 27 20:42:32 2026`.
- 2026-04-27 20:45: Rechecked existing `run-0036`: it is no longer approval-pending; it ended `failed` with `tool_budget_exhausted` after 18 tool calls, and the target Obsidian note contains the updated 西芒杜 project content. This is a separate budget/completion failure, not the approval deadlock.
- 2026-04-27 21:10: User reported a sharper `run-0037` symptom: after approving `file.write`, the run continued with `web.search` instead of writing the document. Runtime DB evidence showed `run-0037:action:router-tool-343` reached `approval_required`, then after approval the kernel emitted a fresh `run.started` and restarted from `file.read`/`web.search`; the approved action stayed `approved` and never reached `running`/`succeeded`. Implemented direct execution for approved `file.write` resume actions before any model re-entry.
- 2026-04-27 21:17: User reported the direct execution fix was too short: after approval, a write-file node appeared briefly, the run ended, and no final正文 appeared. `run-0038` confirmed this: the file action reached `tool.called succeeded`, but runtime immediately emitted `run.done` with `output.summary="Approved file write completed."`. Refined the direct path so approved `file.write` still runs first, then the provider is called with tools disabled to produce final prose, persisted as `output.text` and `message.delta`.

## Decisions

- Do not broaden approval matching again until `run-0036` proves which approval path is failing.
- Treat old UI interruption text as potentially stale until the event stream proves current run status.
- Root-cause hypothesis: `apps/runtime/src/harness/runtime-interrupts.ts` consumes same-path `file.write` approval scope once, but message_bus/agent_teams can issue multiple same-path writes after one user approval, so the second writer prompts again even though it is the same approved file target.
- Second root-cause hypothesis: after the scope fix, the visible "no next action" state is caused by desktop approval using blocking `runs.resume` instead of a streaming resume handle. The fix must return a handle immediately, persist a running snapshot, and forward subsequent `runs.stream` notifications for resume just like start streaming.
- Third root-cause hypothesis: kernel resume used approved actions only as matcher context for a future regenerated tool call. It did not execute the exact pending `file.write` action that the user approved, so a resumed model pass could choose more research before the write. The fix must treat approval as permission to run the pending side effect itself.
- Fourth root-cause hypothesis: direct execution must not be a terminal shortcut. For `file.write`, approval completion has two obligations: perform the side effect and then complete the conversation with a normal final answer.

## Verification

- Runtime evidence:
  - `sqlite3 .ora/runtime.db ... run-0036` returned `status=interrupted`, `pattern=message_bus`, `pendingApprovals=["run-0036:action:investigator-tool-180"]`.
  - Event stream includes `approval.resolved` for `router-tool-87`, `tool.called succeeded file.write`, then `approval.required` for `investigator-tool-180` with the same target file path.
- Regression red/green:
  - Before fix, `pnpm --filter @ora/runtime test -- runtime-smoke.test.ts -t "keeps approved file write resume scope"` failed with `expected false to be true` on the second same-path consume.
  - After fix, the same command passed: `14 passed`, `212 passed`.
- Code verification:
  - `pnpm --filter @ora/runtime typecheck` passed.
  - `pnpm --filter @ora/runtime test` passed: `14 passed`, `212 passed`.
  - `git diff --check -- apps/runtime/src/harness/runtime-interrupts.ts apps/runtime/test/runtime-smoke.test.ts tasks/TASK-20260427-1815-ora-approval-deadlock-root-cause.md` passed.
- Bundled sidecar verification:
  - `pnpm --filter @ora/runtime package:sidecar` passed.
  - `apps/desktop/src-tauri/resources/runtime-sidecar/app/runtime-sidecar.cjs` timestamp updated first to `Apr 27 18:21:34 2026`, then to `Apr 27 20:42:32 2026` after the streaming resume bridge fix.
  - `rg "stableSingleApprovalScopeKey|approvedSingleActionScopes|approvalInputPath" apps/desktop/src-tauri/resources/runtime-sidecar/app/runtime-sidecar.cjs` found the packaged fix.
- Streaming resume verification:
  - `pnpm --filter @ora/runtime exec vitest run test/runtime-smoke.test.ts` passed: `56 passed`.
  - `pnpm --filter @ora/runtime typecheck` passed.
  - `pnpm --filter @ora/desktop typecheck` passed.
  - `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml process_bridge_forwards_stream_notifications_after_resume_response` passed.
  - `pnpm --filter @ora/runtime test` passed: `14 passed`, `212 passed`.
  - `git diff --check -- apps/runtime/src/run-store.ts apps/runtime/src/json-rpc.ts apps/runtime/src/harness/runtime-interrupts.ts apps/runtime/test/runtime-smoke.test.ts apps/desktop/src/lib/useRunActions.ts apps/desktop/src/lib/runtimeClient.ts apps/desktop/src-tauri/src/commands/sidecar.rs packages/shared/src/rpc.ts tasks/TASK-20260427-1815-ora-approval-deadlock-root-cause.md` passed.
- Direct approved-write resume verification:
  - `run-0037` DB evidence: `file.write` action `run-0037:action:router-tool-343` entered `approval_required`; after approval, the next persisted event was a fresh kernel `run.started`, followed by `file.read`/`web.search`; no `tool.called` for the approved `file.write` appeared.
  - Added regression `executes the approved file write before asking the model for more work`; it returns `web.search` if the runtime asks the provider again after approval, and asserts the approved `file.write` is executed first with no post-approval `web.search` tool event.
  - `pnpm --filter @ora/runtime exec vitest run test/runtime-smoke.test.ts -t "approved file write"` passed: `2 passed`.
  - `pnpm --filter @ora/runtime exec vitest run test/runtime-smoke.test.ts` passed: `57 passed`.
  - `pnpm --filter @ora/runtime typecheck` passed.
  - `pnpm --filter @ora/desktop typecheck` passed.
  - `pnpm --filter @ora/runtime package:sidecar` passed; packaged sidecar contains `completeApprovedFileWriteResume` and `Approved file write completed.`
  - `git diff --check -- apps/runtime/src/run-store.ts apps/runtime/test/runtime-smoke.test.ts tasks/TASK-20260427-1815-ora-approval-deadlock-root-cause.md apps/desktop/src-tauri/resources/runtime-sidecar/app/runtime-sidecar.cjs` passed.
- Direct approved-write final-answer verification:
  - `run-0038` evidence: `file.write` action reached `tool.called succeeded`, but final output was only `Approved file write completed.`, matching the too-short terminal branch.
  - Regression now asserts the approved write produces `output.text`, emits a final `message.delta`, and still does not execute the provider's post-approval `web.search` tool call.
  - `pnpm --filter @ora/runtime exec vitest run test/runtime-smoke.test.ts` passed: `57 passed`.
  - `pnpm --filter @ora/runtime typecheck` passed.
  - `pnpm --filter @ora/desktop typecheck` passed.
  - `pnpm --filter @ora/runtime package:sidecar` passed after the final-answer refinement.
- TODO gate:
  - Long-task helper `todo_scan.sh` is anchored to the Quantfox memory task in this workspace setup, so it is not authoritative for this Ora task.
  - Direct scan `rg -n "TODO|FIXME|XXX|\\[ \\]" tasks/TASK-20260427-1815-ora-approval-deadlock-root-cause.md apps/runtime/src/harness/runtime-interrupts.ts apps/runtime/test/runtime-smoke.test.ts` returned no matches.

## Open Issues

- Existing `run-0036` is no longer approval-pending; it resumed far enough to update the Obsidian file but ultimately failed with `tool_budget_exhausted`.
- The currently running Tauri dev process was started before the Rust bridge change. Restart it so `runs.resumeStreaming` notifications are forwarded by the live desktop binary.
- There are many unrelated dirty files in the worktree, including desktop UI files and pre-existing `apps/desktop/src-tauri/src/commands/sidecar.rs` project-file ordering changes; they were not reverted.

## Retrospective

- Status: candidate_for_skill
  - Evidence: The first fix covered regenerated same-path `file.write` content but still consumed the approval scope once and included `agentId`; `run-0036` proved message_bus can write the same file first as `router`, then as `investigator`.
  - Guardrail: Approval resume tests must cover multi-agent same-target follow-up actions, not only same-action replay.
- Status: local_only
  - Evidence: Desktop showed `bundled`; source/test fixes did not update the packaged sidecar until `pnpm --filter @ora/runtime package:sidecar` ran.
  - Guardrail: For bugs reproduced in bundled desktop mode, rebuild or verify the packaged sidecar asset before claiming the fix is usable in the app.

## Compressed State

The approval deadlock recurred in Ora after a prior fix that allowed resumed `file.write` approvals to match by path. Runtime DB evidence showed this was not a pure UI bug: `run-0036` had successfully resolved and executed one `router` same-path `file.write`, then got interrupted again on an `investigator` same-path `file.write`. The fix makes `file.write` approval scope reusable by path across agents during the resumed kernel pass and repackages the bundled sidecar so desktop `bundled` mode can use it after restart. Runtime typecheck and full runtime tests pass.

Follow-up evidence showed a second approval failure mode: after clicking approve, the UI optimistically entered running state but the desktop bridge was still blocked inside synchronous `runs.resume`, so no subsequent actions could stream into the conversation until the entire resumed run returned. The follow-up fix adds `runs.resumeStreaming`, forwards resume stream notifications through Tauri, and changes the approval button to start streaming resume and hydrate from the running snapshot immediately. Runtime smoke, runtime full test, runtime/desktop typecheck, Rust bridge test, sidecar packaging, and diff check pass.
