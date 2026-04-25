# TASK-20260425-2106-ora-structured-tool-calling-reliability

**Created:** 2026-04-25 21:06 CST
**Status:** Done

---

## Goal
- Upgrade Ora from prompt-parsed JSON tool calls toward a structured, durable tool-call runtime that supports long-running reliability: provider-native OpenAI/Anthropic tool calling, a unified Ora ToolCall IR, persisted lifecycle state, LangGraph checkpoint compatibility, dangling tool-call repair, and observable recovery in Trails.

## Why This Matters
- Current Ora tool execution can run local tools, but the model-to-runtime contract is still mostly text based: the model emits JSON in assistant text and the runtime extracts it.
- That MVP path is useful for broad provider compatibility, but it is not the most reliable foundation for long-running agents because interrupted/failed tool calls do not have a stable provider `tool_call_id -> tool_result` pairing.
- Long-running reliability needs both layers:
  - Provider-native tool calling for reliable model intent generation.
  - Runtime-persisted ToolCall IR for checkpoint, resume, repair, replay, approval, and observability.

## Scope / Out of scope
- In scope:
  - Define a shared Ora ToolCall IR and lifecycle statuses.
  - Convert current JSON text tool extraction into the same IR as a fallback path.
  - Add provider-native tool schema support for OpenAI-compatible and Anthropic-compatible providers where supported.
  - Persist tool-call lifecycle state in run snapshots and LangGraph checkpoints.
  - Add dangling repair before any provider/model invocation that includes structured tool-call message history.
  - Surface structured tool calls, repaired tool results, and interrupted/failed tool calls in Trails.
  - Add tests that reproduce cancellation/interruption/resume cases without invalid message history.
- Out of scope:
  - Removing the existing JSON text fallback in the first iteration.
  - Replacing all provider implementations at once.
  - Designing a visual tool debugger beyond Trails-level lifecycle visibility.
  - Changing approval policy semantics unless needed to map them onto the new IR.
  - Rebuilding packaged sidecar artifacts.

## Architecture Decision
- Decision: use provider-native tool calling as the primary model protocol, but make Ora ToolCall IR the product/runtime source of truth.
  - Why: native tool calling makes model output reliable; IR makes recovery, replay, approvals, and cross-provider behavior reliable.
  - Alternatives:
    - Only adopt provider-native tool calling: improves parsing but leaves resume/repair scattered across provider message histories.
    - Only persist LangGraph messages: improves checkpointing but keeps text JSON parsing as the weak source of tool intent.
  - Tradeoffs: this adds a compatibility layer, but it lets current JSON tools keep working while native tool providers come online incrementally.

## Target Runtime Model

### Shared ToolCall IR
- Add shared schemas/types for:
  - `OraToolCallEnvelope`: stable runtime record of one requested tool call.
  - `OraToolCallResult`: successful, failed, denied, interrupted, or repaired tool result.
  - `OraToolCallSource`: `provider_native`, `json_fallback`, `manual_repair`, `replay`.
  - `OraToolCallStatus`: `proposed`, `approval_required`, `approved`, `running`, `succeeded`, `failed`, `denied`, `interrupted`, `repaired`.
- Minimum fields:
  - `id`: Ora runtime id, stable across replay/resume.
  - `providerCallId`: optional provider-native call id.
  - `runId`, `nodeId`, `agentId`, `actionId`.
  - `toolId`, `args`, `source`, `status`.
  - `requestedAt`, `updatedAt`, `result`, `error`, `repairReason`.

### Provider-Native Tool Calling
- Extend provider request/response types to optionally carry:
  - `tools`: runtime tool schemas derived from `RuntimeToolRegistry`.
  - `toolChoice`: default `auto`.
  - `toolCalls`: structured calls returned by the provider.
  - `finishReason`: provider finish reason if available.
- OpenAI/OpenAI-compatible mapping:
  - Chat Completions: map Ora tool schemas to `tools: [{ type: "function", function: ... }]` and parse `message.tool_calls`.
  - Responses API: map to supported tool/function shape when enabled by provider protocol.
- Anthropic/Anthropic-compatible mapping:
  - Map tools to Anthropic `tools` array and parse `tool_use` blocks.
- Providers without native support keep the JSON fallback path.

### Runtime Tool Loop
- Replace `extractToolCall(response.text)` as the primary path with:
  1. Read provider-native tool calls from `ModelResponse.toolCalls`.
  2. If none, use existing JSON extraction as fallback and wrap it into ToolCall IR.
  3. Propose/approve/execute via existing `ActionLedger` and `RuntimeToolExecutor`.
  4. Persist lifecycle updates to snapshot events and `toolCalls`.
  5. Convert tool result back into provider-specific message content for the next model call.
- Keep the existing `RUNTIME_TOOL_LOOP_LIMIT`, but count IR tool-call attempts rather than only text-extracted calls.

### Persistence And Checkpointing
- Add `toolCalls` to `StateSnapshotSchema` as an append-only lifecycle ledger.
- Deterministic kernel:
  - Store tool-call envelopes in runtime snapshot events and top-level `toolCalls`.
- LangGraph SessionManager:
  - Include tool-call ledger in graph state and SQLite checkpoint values.
  - Ensure resume reconstructs pending/interrupted tool calls before the next model invocation.

### Dangling Repair
- Before invoking a provider with structured message history:
  - Scan assistant messages for provider-native tool calls.
  - Scan following tool/result messages for matching provider call ids.
  - For any missing result, synthesize a repaired tool result with status `interrupted` or `failed`.
  - Persist the repair as `OraToolCallResult` with `source: "manual_repair"` and emit an event such as `tool.repaired`.
- Repair content should be concise and model-visible:
  - `Tool call was interrupted before a result was produced. Continue from available context or choose another action.`
- Repair must never fake success.

### Trails / Observability
- Surface tool-call lifecycle in Trails:
  - Proposed / approval required / running / succeeded / failed / repaired.
  - Link tool calls to action ids, nodes, agents, checkpoints, and recovery artifacts.
  - Show repaired dangling calls as recoverability events, not normal successful tool calls.
- Langfuse tracing:
  - Map tool execution to tool observations where possible.
  - Include provider-native `tool_call_id` in metadata.

## Phased Plan

### Phase 1: ToolCall IR Without Provider-Native Tools
- Add shared ToolCall schemas and snapshot field.
- Wrap current JSON fallback extraction into ToolCall IR.
- Persist tool-call ledger in deterministic runtime snapshots.
- Keep existing tool behavior unchanged from the model's perspective.
- Verification:
  - Existing JSON tool tests still pass.
  - New tests assert tool calls appear in snapshot `toolCalls` with lifecycle transitions.

### Phase 2: Provider-Native Tool Calling
- Extend `ModelRequest` / `ModelResponse` with structured tools/toolCalls.
- Implement native tool schema mapping for OpenAI-compatible chat completions first.
- Add Anthropic-compatible mapping after OpenAI path is stable.
- Keep JSON fallback for local-smoke and unsupported providers.
- Verification:
  - Mock OpenAI-compatible provider returns `tool_calls`; Ora executes the tool and sends a matching tool result on the next call.
  - Unsupported providers still use JSON fallback.

### Phase 3: Checkpointed Resume And Dangling Repair
- Persist tool-call ledger through LangGraph graph state/checkpoints.
- Add pre-invocation repair for missing structured tool results.
- Add cancellation/interruption tests:
  - assistant tool call exists without tool result;
  - resume injects repaired result;
  - next provider call does not fail due to invalid message history.
- Verification:
  - Deterministic kernel and LangGraph SessionManager both handle dangling tool calls.

### Phase 4: Trails And Policy Polish
- Add Trails rendering and anomaly copy for repaired/interrupted tool calls.
- Add evaluation/report export fields for tool-call lifecycle evidence.
- Check approval-mode behavior still maps cleanly to ToolCall IR.
- Verification:
  - Desktop/view-model tests show repaired tool call events and link to checkpoint/action context.

## Active Files Expected
- tasks/TASK-20260425-2106-ora-structured-tool-calling-reliability.md
- packages/shared/src/index.ts
- apps/runtime/src/providers/types.ts
- apps/runtime/src/providers/openai.ts
- apps/runtime/src/providers/openai-compatible.ts
- apps/runtime/src/providers/anthropic.ts
- apps/runtime/src/providers/provider-utils.ts
- apps/runtime/src/harness/runtime-kernel.ts
- apps/runtime/src/harness/runtime-tool-executor.ts
- apps/runtime/src/session/session-manager.ts
- apps/runtime/src/graph/ora-state.ts
- apps/runtime/src/run-store.ts
- apps/desktop/src/components/ModesView.tsx
- apps/desktop/src/lib/viewModel.ts
- apps/desktop/src/lib/runtimeClient.ts
- apps/desktop/src/components/TrailsTabs.tsx
- packages/shared/test/contracts.test.ts
- apps/runtime/test/providers/provider-registry.test.ts
- apps/runtime/test/runtime-smoke.test.ts
- apps/runtime/test/runtime-integration.test.ts
- apps/runtime/test/sqlite-checkpointer.test.ts
- apps/runtime/test/desktop-composer-state.test.ts

## Checkpoints

### Checkpoint 1: Shared IR Contract
- Requirement: shared schemas accept current JSON fallback calls and provider-native calls with stable ids/statuses.
- Verification method: shared contract tests.
- Status: [x] Pass / [ ] Fail
- Evidence: `pnpm --filter @ora/shared test -- contracts.test.ts` passed 72 tests. Added `OraToolCallEnvelopeSchema`, result/source/status enums, and `StateSnapshot.toolCalls` default compatibility coverage.

### Checkpoint 2: JSON Fallback Parity
- Requirement: existing text JSON tool calls continue to execute, now recorded as `source: "json_fallback"` ToolCall IR.
- Verification method: runtime tool-loop tests.
- Status: [x] Pass / [ ] Fail
- Evidence: `pnpm --filter @ora/runtime exec vitest run test/runtime-smoke.test.ts` passed; `web.search` JSON fallback still executes and records `state.toolCalls[0].source === "json_fallback"`.

### Checkpoint 3: OpenAI-Compatible Native Tool Calls
- Requirement: OpenAI-compatible provider can send native tool schemas, parse returned tool calls, execute tools, and send matching tool result messages.
- Verification method: mocked provider registry/runtime smoke test.
- Status: [x] Pass / [ ] Fail
- Evidence: `test/providers/provider-registry.test.ts` covers Chat Completions `tool_calls` and Responses `function_call`; `test/runtime-smoke.test.ts` covers native `file.read` execution and matching `tool` result message.

### Checkpoint 4: Anthropic-Compatible Native Tool Calls
- Requirement: Anthropic-compatible provider can map `tool_use` / `tool_result` blocks into the same Ora ToolCall IR.
- Verification method: provider unit tests with mocked Anthropic responses.
- Status: [x] Pass / [ ] Fail
- Evidence: `test/providers/provider-registry.test.ts` covers Anthropic `tools` request mapping and `tool_use` parsing into `ModelResponse.toolCalls`.

### Checkpoint 5: Dangling Repair
- Requirement: interrupted structured tool calls are repaired before the next model invocation and never masquerade as success.
- Verification method: deterministic and LangGraph resume tests with missing tool result.
- Status: [x] Pass / [ ] Fail
- Evidence: `test/runtime-smoke.test.ts` covers a dangling provider-native call repaired as `source: "manual_repair"` / `status: "repaired"` with result `status: "interrupted"` before the next invocation. `test/sqlite-checkpointer.test.ts` passed with `OraGraphAnnotation.toolCalls` and `SessionManager` ledger derivation.

### Checkpoint 6: Trails Visibility
- Requirement: Trails exposes lifecycle and repair status for structured tool calls.
- Verification method: desktop/view-model tests.
- Status: [x] Pass / [ ] Fail
- Evidence: `test/desktop-composer-state.test.ts` passed; Trails now renders a Tool Calls block and anomaly copy for repaired/interrupted calls.

### Checkpoint 7: No Regression
- Requirement: existing runtime/provider/session tests still pass.
- Verification method: focused runtime/shared/desktop tests and typecheck.
- Status: [x] Pass / [ ] Fail
- Evidence: Passed `pnpm --filter @ora/runtime exec vitest run` (129 tests), `pnpm --filter @ora/runtime typecheck`, and `pnpm --filter @ora/desktop typecheck`.

## Test Plan
- Shared:
  - `packages/shared/test/contracts.test.ts` for ToolCall schemas and legacy snapshot compatibility.
- Runtime provider:
  - Provider unit tests for OpenAI-compatible native `tool_calls`.
  - Provider unit tests for Anthropic `tool_use` / `tool_result` mapping.
- Runtime kernel:
  - Existing JSON fallback tool execution still works.
  - Native tool call execution uses same approval, action, recovery, and tool executor path.
  - Tool-loop limit counts both native and fallback calls.
- Recovery:
  - Tool failure creates failed ToolCallResult and recovery artifact where configured.
  - Interrupted tool call creates repaired result before next model invocation.
- LangGraph:
  - Checkpoint stores tool-call ledger.
  - Resume reconstructs pending/interrupted tool calls and performs dangling repair.
- Desktop:
  - Trails shows tool call lifecycle and repaired dangling call anomaly.

## Risks / Tradeoffs
- Provider shape differences:
  - OpenAI Chat Completions, OpenAI Responses, Anthropic Messages, and custom compatible providers differ; implement one native path at a time.
- Snapshot migration:
  - `toolCalls` should default to `[]` so existing run snapshots remain parseable.
- Tool schema drift:
  - Runtime tool descriptors must be transformed into provider schemas without inventing unsupported features.
- Repair semantics:
  - Repaired tool results must be explicit failures/interruption notices; never fabricate data.
- Overreach risk:
  - Avoid redesigning tools, approvals, LangGraph, and Trails all at once. Phase 1 must preserve behavior while adding the IR spine.

## Open Issues
- [x] `toolCalls` is top-level snapshot ledger; lifecycle events also carry `toolCallId`/`providerCallId` where useful for timeline reconstruction.
- [x] Provider-native tool calling is gated by provider tool-use capability / known native defaults; unsupported providers continue JSON fallback.
- [x] Runtime tool schemas currently use descriptor `parameters` when present, otherwise a permissive object schema. Richer per-tool JSON schemas remain a future registry refinement.
- [x] `local-smoke` remains JSON/text fallback only; native tool-call behavior is tested through mocked OpenAI-compatible/Anthropic providers.

## TODO
- [x] Phase 1: add shared ToolCall IR schemas.
- [x] Phase 1: wrap JSON fallback tool extraction into ToolCall IR.
- [x] Phase 1: persist deterministic runtime tool-call ledger.
- [x] Phase 2: add OpenAI-compatible native tool call support.
- [x] Phase 2: add Anthropic-compatible native tool call support.
- [x] Phase 3: persist and repair structured tool calls across LangGraph checkpoints.
- [x] Phase 4: expose structured tool-call lifecycle in Trails.
- [x] Run verification and update all checkpoint evidence.

## Verification
- `pnpm --filter @ora/shared build` passed.
- `pnpm --filter @ora/shared test -- contracts.test.ts` passed: 72 tests.
- `pnpm --filter @ora/runtime exec vitest run test/providers/provider-registry.test.ts test/runtime-smoke.test.ts test/desktop-composer-state.test.ts test/runtime-integration.test.ts test/sqlite-checkpointer.test.ts` passed: 90 tests.
- `pnpm --filter @ora/runtime exec vitest run` passed: 129 tests.
- `pnpm --filter @ora/runtime typecheck` passed.
- `pnpm --filter @ora/desktop typecheck` passed.
- `bash /Users/quintenchen/developer/quantfox/.codex/skills/long-task-protocol/scripts/todo_scan.sh` passed, but the helper resolves the Quantfox latest task in this environment; this task's TODO section is manually checked above.

## Retrospective
- Status: local_only. Evidence: provider-native tool calls are unsafe to turn on purely by provider type because existing mocked/custom compatible providers may not support `tools`; the runtime now gates native tools by explicit `tool_use` capability or known defaults and keeps JSON fallback.
- Status: local_only. Evidence: adding `tool` as a provider message role widened `ModelMessage`; memory ingestion had to filter out tool-result messages because long-term memory only accepts system/developer/user/assistant transcript roles.
- Status: local_only. Evidence: `pnpm --filter @ora/runtime test -- file.test.ts` still collected broader runtime tests, so verification used `pnpm --filter @ora/runtime exec vitest run ...` with explicit test paths.

## Progress Log
- 2026-04-25 21:37 CST: Implemented shared ToolCall IR, provider-native mappings, runtime ledger, dangling repair, LangGraph state compatibility, Trails visibility, and focused tests. Verification passed. Next: none for this task.

## Compressed State (<= 20 lines)
- Objective: make Ora tool calling reliable for long-running agents through native provider tools plus a persistent Ora ToolCall IR.
- Done: shared IR, JSON fallback ledger, OpenAI-compatible/Responses/Anthropic native mappings, runtime execution loop, LangGraph snapshot compatibility, dangling repair, Trails visibility, and verification.
- In-progress: none.
- Active files: shared contracts, provider adapters, runtime kernel/executor/session graph state, Trails/view-model, focused tests, this task journal.
- Next actions (top 3): none; future refinement can add richer per-tool JSON schemas and Langfuse tool observations.
- Blockers/Risks: no blocker; provider-native tools remain gated so unsupported compatible providers keep JSON fallback.
- Verification status: passed.
