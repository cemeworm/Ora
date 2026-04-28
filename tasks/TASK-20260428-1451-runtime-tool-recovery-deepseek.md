# TASK-20260428-1451-runtime-tool-recovery-deepseek

**Created:** 2026-04-28 14:51 CST
**Status:** Done

---

## Goal
- Fix the Ora runtime failure mode observed in `session-0031 / run-0042`: after a tool fetch failure, DeepSeek thinking-mode recovery lost native tool-call reasoning context, received a provider 400, retried as if transient, then hit `repeated_tool_blocked` and produced a misleading final answer claiming tools were unavailable.

## Scope / Out of scope
- In scope:
  - Preserve OpenAI-compatible provider-native tool-call history through tool fallback recovery paths.
  - Classify DeepSeek/OpenAI-compatible request-shape errors as non-transient recovery incidents.
  - Add regression tests that reproduce the `reasoning_content` fallback path and provider 400 classification.
  - Verify runtime tests/typecheck for the touched surfaces.
- Out of scope:
  - Re-running the original Simandou research task or editing the Obsidian note.
  - Redesigning the full completion policy or UI status model beyond the narrow runtime bug.
  - Broad provider abstraction refactors.

## Constraints
- Compatibility: keep JSON fallback tool calling intact and keep provider-native support for OpenAI-compatible chat completions.
- Performance: no new provider round trips except the existing recovery/finalization calls.
- Risk: recovery paths are shared; tests must cover both protocol-message preservation and classification behavior.
- Tool/Environment limits: verification will use local pnpm/vitest commands in this repo.

## Plan
1. `apps/runtime/src/harness/node-runtime-loop.ts` -> preserve provider-native assistant `reasoningContent` and `toolCalls` when a tool degrades into `fallback_artifact`; append a matching synthetic tool result instead of converting the event to plain assistant/user text.
2. `apps/runtime/src/harness/recovery-policy.ts` -> classify provider request/protocol errors (`400`, `invalid_request_error`, `reasoning_content`) as `model_output_invalid` or another non-retry category instead of defaulting to `provider_transient`.
3. `apps/runtime/test/runtime-smoke.test.ts` and/or focused provider/recovery tests -> add regressions for fallback artifact after native tool-call failure and provider 400 classification.
4. Run focused tests and typecheck; update this task with outputs and close only when checkpoints pass.

## Active Files
- tasks/TASK-20260428-1451-runtime-tool-recovery-deepseek.md
- apps/runtime/src/harness/node-runtime-loop.ts
- apps/runtime/src/harness/recovery-policy.ts
- apps/runtime/test/runtime-smoke.test.ts
- apps/runtime/test/recovery-policy.test.ts

## Decisions
- Decision: Fix the native-tool recovery message construction first.
  - Why: `run-0042` proved tools were enabled and succeeded before the recovery path lost context.
  - Alternatives: loosen repeated-tool guard or increase tool budget.
  - Tradeoffs: message preservation is narrower and prevents the provider 400; guard loosening would hide the symptom without fixing the protocol break.
- Decision: Treat provider 400 request-shape errors as non-transient.
  - Why: retrying the same malformed request cannot succeed and led directly to the forced-final loop.
  - Alternatives: add a DeepSeek-only string check in provider code.
  - Tradeoffs: classifier-level handling is provider-agnostic but must stay conservative.

## Progress Log
- 2026-04-28 14:51 CST - Task created from investigation evidence. `run-0042` had enabled tools and successful `file.read`/`web.search`, but failed after `web.fetch` fallback recovery lost DeepSeek reasoning context and then retried a provider 400.
  Next: add regression tests; patch `node-runtime-loop.ts`; patch `recovery-policy.ts`.
- 2026-04-28 14:53 CST - Added native-tool fallback recovery regression and provider 400 classification regression. Patched fallback recovery to send provider-native assistant/tool history instead of plain assistant/user degradation text. First verification exposed a compatibility issue: generic `failed with 400` was too broad and an existing test mock expected only user-role degraded results.
  Next: narrow classifier pattern; update existing test to accept protocol-correct tool-role degraded output; rerun verification.
- 2026-04-28 14:55 CST - Verification passed. Runtime vitest suite passed 214/214 tests and runtime typecheck passed.
  Next: record DONE evidence and leave status semantics as follow-up.

## Open Issues
- TODO(FOLLOWUP): Confirm whether final run status should change from `succeeded` to `failed/degraded` for forced-final self-misreporting. This is product/status semantics, separate from the fixed DeepSeek recovery protocol bug.

## TODO
- None.

## Retrospective
- Two local lessons were captured; neither needs skill writeback yet.

### Item 1
- Pitfall: Treating all provider 400 errors as non-transient was too broad.
- Symptom: Existing `turns tool execution errors into observed results before continuing` regression failed because generic 400 handling could affect paths beyond the observed DeepSeek request-shape failure.
- Root Cause: The first classifier patch matched `failed with 400`, which was broader than the evidence required.
- Reusable Guardrail: Match protocol/request-shape evidence (`invalid_request_error`, `reasoning_content`, `bad request`) instead of status code alone.
- Evidence: First focused test run failed, then passed after narrowing the pattern.
- Scope: Local runtime recovery classifier.
- Suggested Writeback Target: None.
- Status: local_only

### Item 2
- Pitfall: Existing tests assumed degraded tool output was sent as a user message.
- Symptom: After preserving provider-native history, the old mock did not recognize the fallback result and repeated tool calls.
- Root Cause: Provider-native tool-call history must use assistant `tool_calls` followed by a `tool` result, not plain assistant/user text.
- Reusable Guardrail: Tests around native tool calling should assert provider protocol shape, not only logical degradation text.
- Evidence: Updated existing smoke test to accept `role: "tool"` degraded output and added a regression inspecting `reasoning_content`.
- Scope: Local runtime native-tool recovery tests.
- Suggested Writeback Target: None.
- Status: local_only

## Functional Verification

### Code Verification (Code Correctness)
- [x] Code compiles/runs without errors
- [x] Unit tests pass
- [x] Lint checks pass

**Output**:
- `pnpm --filter @ora/runtime test -- test/runtime-smoke.test.ts test/recovery-policy.test.ts` -> 14 test files passed, 214 tests passed.
- `pnpm --filter @ora/runtime typecheck` -> `tsc -p tsconfig.json --noEmit` passed.

### Functional Verification (Feature Works)
- [x] Fallback artifact after a failed native tool preserves `reasoning_content` in the next provider request.
- [x] DeepSeek-style `reasoning_content` provider 400 does not retry as transient.
- [x] Existing forced-final tool rejection behavior still works.

**Output**:
- New smoke regression verifies the recovery request contains assistant `reasoning_content`, the original `tool_calls`, and a matching `role: "tool"` degraded result.
- New recovery-policy regression verifies DeepSeek-style `invalid_request_error` with `reasoning_content` classifies as `model_output_invalid`.
- Full runtime vitest run passed, including existing forced-final tool rejection tests.

## Comparison

### Reference
- `session-0031 / run-0042` persisted in `.ora/runtime.db`.

### Comparison Points
- [x] Runtime config included tools and the first tool calls succeeded.
- [x] Failure occurred after `web.fetch` fallback recovery.
- [x] Repeated `file.read` was a downstream effect, not the initial permission failure.

### Findings
- Consistency: the regression should model `web.fetch` failure after a native tool call and require reasoning context preservation.
- Differences: tests will use synthetic provider responses instead of the live DeepSeek API.
- Conclusion: passing tests should prevent the exact protocol/context-loss failure without relying on external network state.

## Checkpoints

### Checkpoint 1: Native Tool Recovery Context
- Requirement: fallback recovery after a provider-native tool failure must send an assistant message with the original `tool_calls` and `reasoning_content`, followed by a tool result.
- Verification method: vitest regression inspects the second provider request body.
- Status: [x] Pass / [ ] Fail
- Evidence: `preserves native tool-call reasoning history when tool fallback recovery continues` passed.

### Checkpoint 2: Provider 400 Classification
- Requirement: provider request-shape errors should not be classified as `provider_transient`.
- Verification method: focused unit test for `classifyRecoveryError`.
- Status: [x] Pass / [ ] Fail
- Evidence: `recovery-policy.test.ts` passed and expects `model_output_invalid`.

### Checkpoint 3: Runtime Compatibility
- Requirement: existing runtime forced-final and native-tool tests still pass.
- Verification method: focused runtime smoke tests plus typecheck.
- Status: [x] Pass / [ ] Fail
- Evidence: Runtime vitest passed 214/214 tests; runtime typecheck passed.

## Compressed State (<= 20 lines)
- Objective: Fix DeepSeek native-tool recovery context loss and provider 400 retry misclassification.
- Done: `fallback_artifact` now preserves provider-native assistant/tool history; recovery classifier treats request-shape errors as `model_output_invalid`; regressions added.
- In-progress: None.
- Active files: task journal, `node-runtime-loop.ts`, `recovery-policy.ts`, `runtime-smoke.test.ts`, `recovery-policy.test.ts`.
- Next actions (top 3; exact file/function): TODO(FOLLOWUP) decide final run status semantics for forced-final self-misreporting.
- Blockers/Risks: No blocker for this fix; status semantics follow-up remains.
- Verification status: passed.

## Verification

### Evidence Requirements
Must provide the following evidence:
- [x] Code Verification output (compilation/tests/lint)
- [x] Functional Verification output (feature verification)
- [x] Retrospective Evidence (if applicable)
- [x] Comparison Evidence (if applicable)
- [x] Checkpoints Evidence (if applicable)

### Environment
- Environment: `/Users/quintenchen/developer/ora`, local pnpm workspace.

### Commands run + outputs
- `pnpm --filter @ora/runtime test -- test/runtime-smoke.test.ts test/recovery-policy.test.ts`
  - First run: failed 2 runtime-smoke assertions, exposing overbroad `failed with 400` classification and a mock that only recognized user-role degraded output.
  - Final run: 14 test files passed, 214 tests passed.
- `pnpm --filter @ora/runtime typecheck`
  - Passed: `tsc -p tsconfig.json --noEmit`.
- `bash /Users/quintenchen/developer/quantfox/.codex/skills/long-task-protocol/scripts/todo_scan.sh`
  - Output: `Result: PASS`, but the bundled script resolved the latest Quantfox task instead of this Ora task because the skill lives under `/Users/quintenchen/developer/quantfox`.
- `rg -n '^- \[ \]' tasks/TASK-20260428-1451-runtime-tool-recovery-deepseek.md || true`
  - Output: no matches.
- `rg -n 'TODO\(|^- \[ \]|Status: \[ \] Pass' tasks/TASK-20260428-1451-runtime-tool-recovery-deepseek.md || true`
  - Output: only two `TODO(FOLLOWUP)` entries for the non-blocking final-status semantics follow-up.
