# TASK-20260501-2216-wechat-channel-no-response

**Created:** 2026-05-01 22:16 CST
**Status:** Done

---

## Goal
- Fix the WeChat channel path where the bot is bound/running but WeChat users receive no Ora reply. The leading root cause is that inbound `context_token` is normalized into metadata but never cached for `WechatChannelAdapter.send()`, causing outbound delivery to fail with `No context_token for chat ...`.

## Scope / Out of scope
- In scope: cache inbound WeChat `context_token` during long polling; add focused regression coverage proving replies include that token; run focused runtime verification.
- Out of scope: desktop UI redesign, channel-core refactor, new WeChat media-message support, broad delivery retry redesign.

## Constraints
- Compatibility: keep existing QR binding and JSON-RPC contract behavior intact.
- Performance: no extra network calls; only in-memory token cache update while processing inbound items.
- Risk: avoid changing ChannelManager/ChannelService unless tests show the issue is outside WeChat adapter.
- Tool/Environment limits: use focused tests first; do not run broad checks unless needed.

## Plan
1. `apps/runtime/test/wechat-adapter.test.ts` — add a lifecycle regression test that simulates `getupdates` with `context_token`, waits for `onIngest`, calls `send()`, and asserts `/sendmessage` receives the same token.
2. `apps/runtime/src/channels/wechat.ts` — cache `item.context_token` by `normalized.externalChatId` before invoking `deps.onIngest()`.
3. Run `pnpm --filter @ora/runtime test -- wechat-adapter.test.ts` and `pnpm --filter @ora/runtime typecheck`; add `channel-rpc.test.ts` only if shared channel flow changes.

## Active Files
- `/Users/quintenchen/developer/ora/apps/runtime/src/channels/wechat.ts`
- `/Users/quintenchen/developer/ora/apps/runtime/test/wechat-adapter.test.ts`
- `/Users/quintenchen/.workbuddy/plans/quantum-pulse-darwin.md`

## Decisions
- Decision: fix WeChat adapter token handoff instead of changing desktop state or channel manager.
  - Why: code shows `send()` requires `contextTokenMap`, while `pollLoop()` never populates it despite receiving `item.context_token`.
  - Alternatives: expose delivery errors in Settings UI; persist context token in store; change send API to use inbound metadata.
  - Tradeoffs: in-memory cache is minimal and matches current `send()` design, but does not solve restart-between-ingest-and-send edge cases.

## Progress Log
- 2026-05-01 22:16 CST - Task created
  Next: Fill in Goal, Scope, Plan, and list Active Files
- 2026-05-01 22:18 CST - Filled task journal from approved plan and code inspection.
  Next: add failing regression test, patch `pollLoop()` token cache, run focused verification.
- 2026-05-01 22:18 CST - Added regression test; first run failed as expected with `result.ok` false for missing context token.
  Next: patch `WechatChannelAdapter.pollLoop()` to cache token before ingest.
- 2026-05-01 22:19 CST - Patched WeChat poll loop and reran focused tests/typecheck successfully.
  Next: ask user to send a real WeChat text for manual confirmation.

## Open Issues
- [ ] TODO(FOLLOWUP): Manual WeChat verification still needs the user's real bound bot after code verification.

## TODO
- [x] Add context_token regression test.
- [x] Patch WeChat poll loop token cache.
- [x] Run focused runtime tests/typecheck and record output.

## Retrospective

### Item 1
- Pitfall: WeChat reply correlation token can be lost between inbound normalization and outbound delivery.
- Symptom: Settings shows WeChat bot bound/running, the channel run can complete, but the WeChat user receives no reply.
- Root Cause: `normalizeWechatMessage()` copied `item.context_token` into metadata, but `WechatChannelAdapter.send()` reads only `contextTokenMap`; `pollLoop()` never populated that map.
- Reusable Guardrail: For provider adapters whose send API requires a per-message reply token, add a regression test that exercises inbound long-poll/event handling and outbound send in the same adapter instance.
- Evidence: New `wechat-adapter.test.ts` lifecycle test failed before patch (`result.ok` false), then passed after caching `item.context_token` by `externalChatId`.
- Scope: Ora WeChat adapter; may apply to future provider adapters with event-scoped reply tokens.
- Suggested Writeback Target: `~/.workbuddy/skills/ora-channel-connectors/SKILL.md` Pitfalls section.
- Status: promoted_to_skill

## Functional Verification

### Code Verification (Code Correctness)
- [x] Code compiles/runs without errors
- [x] Unit tests pass
- [ ] Lint checks pass (not run; focused runtime-only fix)

**Output**:
- `pnpm --filter @ora/runtime exec vitest run test/wechat-adapter.test.ts` → 1 file / 22 tests passed.
- `pnpm --filter @ora/runtime exec vitest run test/channel-rpc.test.ts` → 1 file / 9 tests passed.
- `pnpm --filter @ora/runtime typecheck` → passed.

### Functional Verification (Feature Works)
- [x] Core functionality verification: regression test proves `getupdates` `context_token` is reused in `/sendmessage` body.
- [x] Edge cases verification: existing missing-token test still covers unbound/no-context failure path.
- [x] Error handling verification: existing missing `botToken` test still returns send failure.

**Output**:
- First reproduction command `pnpm --filter @ora/runtime test -- wechat-adapter.test.ts` failed on new test with `expected false to be true`, confirming the bug. Same broad command also surfaced an unrelated pre-existing `runtime-smoke.test.ts` mode list mismatch involving `code_development`.
- After patch, focused WeChat adapter test passed and asserted `context_token: "ctx-token-abc"` in the outgoing send body.

## Comparison (If Applicable)

### Reference
- Reference implementation/template/similar task: Existing `WechatChannelAdapter.send()` test and `ChannelService.ensureAdapter()` outbound delivery path.

### Comparison Points
- [x] Existing send test without context still fails safely.
- [x] New lifecycle test covers the missing inbound-token-to-outbound-send handoff.
- [x] Channel RPC tests remain green without manager/service changes.

### Findings
- Consistency: The fix preserves the existing per-chat context token cache design.
- Differences: The token cache is now populated from long-poll inbound events instead of being unused state.
- Conclusion: Minimal adapter-local fix is sufficient for the identified symptom.

## Checkpoints

### Checkpoint 1: Reproduce missing reply token
- Requirement: A test fails before the fix when an inbound WeChat message includes `context_token` but reply send lacks it.
- Verification method: Run new lifecycle test before patch.
- Status: [x] Pass / [ ] Fail
- Evidence: Initial test run failed at `expect(result.ok).toBe(true)`.

### Checkpoint 2: Reply includes WeChat context token
- Requirement: Outbound `/sendmessage` body includes the original inbound `context_token`.
- Verification method: `pnpm --filter @ora/runtime exec vitest run test/wechat-adapter.test.ts`.
- Status: [x] Pass / [ ] Fail
- Evidence: 22/22 tests passed and new test asserts `context_token: "ctx-token-abc"`.

**All checkpoints must pass before marking task DONE!**

## Compressed State (<= 20 lines)
- Objective: Fix WeChat bound/running but no user-visible reply.
- Done: Added regression test, cached inbound `context_token`, verified focused runtime tests/typecheck.
- In-progress: none.
- Active files: `apps/runtime/src/channels/wechat.ts`, `apps/runtime/test/wechat-adapter.test.ts`.
- Next actions (top 3; exact file/function): user should send a real WeChat text; if still no reply, inspect delivery `lastError` and `getupdates` response path.
- Blockers/Risks: manual verification depends on user's actual bound WeChat bot; restart between ingest/send remains out of scope.
- Verification status: focused tests and runtime typecheck passed; full lint not run for this surgical fix.

## Verification

### Evidence Requirements
Must provide the following evidence:
- [x] Code Verification output (compilation/tests)
- [x] Functional Verification output (feature verification)
- [x] Retrospective Evidence (if applicable)
- [x] Comparison Evidence (if applicable)
- [x] Checkpoints Evidence (if applicable)

### Environment
- Environment: macOS darwin, workspace `/Users/quintenchen/developer/ora`, Node 22.17.0, pnpm workspace.

### Commands run + outputs
- `pnpm --filter @ora/runtime test -- wechat-adapter.test.ts` → expected failing reproduction: new WeChat lifecycle test failed with `expected false to be true`; unrelated pre-existing `runtime-smoke.test.ts` mode list mismatch also appeared because this command ran broader runtime tests.
- `pnpm --filter @ora/runtime exec vitest run test/wechat-adapter.test.ts` → passed: 1 file, 22 tests.
- `pnpm --filter @ora/runtime exec vitest run test/channel-rpc.test.ts` → passed: 1 file, 9 tests.
- `pnpm --filter @ora/runtime typecheck` → passed.
- `git diff --check -- apps/runtime/src/channels/wechat.ts apps/runtime/test/wechat-adapter.test.ts tasks/TASK-20260501-2216-wechat-channel-no-response.md` → passed with no output.
- `bash "$HOME/.workbuddy/skills/long-task-protocol/scripts/todo_scan.sh"` → remaining matches are historical/generated files (`.workbuddy/memory`, skill template TODOs, runtime-sidecar bundle, binary DB/node), not this task's actionable TODOs.
