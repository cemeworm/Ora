# TASK-20260424-2303-ora-true-streaming-output

**Created:** 2026-04-24 23:03 CST
**Status:** Done

---

## Goal
- Convert Ora chat runs from "wait for full agent response, then render" to true incremental streaming. A chat send should return a run handle quickly, emit provider/runtime events while the model is generating, update the assistant bubble as text arrives, and persist the final snapshot so restart still shows the completed answer.

## Scope / Out of scope
- In scope:
  - Runtime JSON-RPC streaming start path and event retrieval.
  - Provider streaming for local smoke, OpenAI Responses, OpenAI-compatible chat completions/responses, and Anthropic Messages.
  - Runtime kernel event callbacks and incremental snapshot persistence.
  - Desktop runtime client/state/view model changes to render partial assistant text.
  - Tests for provider parsing, runtime streaming lifecycle, desktop reducer/view model behavior, and bridge process behavior.
- Out of scope:
  - Full streaming of structured tool-call arguments beyond existing Ora tool lifecycle events.
  - Replacing the whole stdio JSON-RPC transport with a long-lived daemon.
  - New provider credentials or external services.

## Constraints
- Compatibility: Keep existing `runs.start`, `runs.state`, and `runs.stream` behavior working for CLI/evaluation/tests.
- Performance: Flush runtime event persistence on terminal events and otherwise keep updates responsive without excessive SQLite writes.
- Risk: Current worktree already contains prior fixes in ChatInput/state/useRunActions/sidecar and unrelated viewModel/test edits; do not revert them.
- Tool/Environment limits: Use local tests/typechecks; no destructive git commands.

## Plan
1. Define streaming contracts in `packages/shared/src/index.ts` and provider interfaces in `apps/runtime/src/providers/types.ts`.
2. Implement provider streaming parsers and fallbacks in `apps/runtime/src/providers/*`.
3. Add event callback support to `executeRuntimeKernel` and route streamed provider deltas into `message.delta` / `token.delta`.
4. Add async streaming run lifecycle to `LocalRunStore`, JSON-RPC handlers, and stdio notification output.
5. Update Tauri sidecar bridge and permissions to forward streaming notifications to the webview.
6. Update desktop runtime client, reducer, app subscription, and view model to merge live events and render partial assistant content.
7. Add/adjust tests and run verification gates.

## Active Files
- tasks/TASK-20260424-2303-ora-true-streaming-output.md
- packages/shared/src/index.ts
- apps/runtime/src/providers/types.ts
- apps/runtime/src/providers/local-smoke.ts
- apps/runtime/src/providers/openai.ts
- apps/runtime/src/providers/openai-compatible.ts
- apps/runtime/src/providers/anthropic.ts
- apps/runtime/src/providers/anthropic-compatible.ts
- apps/runtime/src/providers/registry.ts
- apps/runtime/src/providers/streaming.ts
- apps/runtime/src/harness/runtime-kernel.ts
- apps/runtime/src/run-store.ts
- apps/runtime/src/json-rpc.ts
- apps/runtime/src/stdio.ts
- apps/desktop/src-tauri/src/commands/sidecar.rs
- apps/desktop/src-tauri/capabilities/default.json
- apps/desktop/src-tauri/gen/schemas/capabilities.json
- apps/desktop/src/lib/runtimeClient.ts
- apps/desktop/src/lib/state.tsx
- apps/desktop/src/lib/useRunActions.ts
- apps/desktop/src/lib/viewModel.ts
- apps/desktop/src/App.tsx
- apps/runtime/test/providers/provider-registry.test.ts
- apps/runtime/test/runtime-smoke.test.ts
- apps/runtime/test/desktop-runtime-client.test.ts
- apps/runtime/test/desktop-composer-state.test.ts

## Decisions
- Decision: Use JSON-RPC `runs.startStreaming` plus NDJSON notifications over the existing one-shot sidecar process.
  - Why: It is the smallest path from current architecture to true push-style UI updates without introducing a daemon.
  - Alternatives: Polling `runs.stream` after sync start; long-lived runtime daemon.
  - Tradeoffs: NDJSON child process is still a bridge-specific solution, but avoids major process management redesign.
- Decision: Keep `message.delta.content` as accumulated assistant text and add `delta` for the incremental chunk.
  - Why: Existing UI already reads `payload.content`; cumulative content avoids reassembly bugs in view code.
  - Alternatives: Store only chunk deltas and fold in desktop state.
  - Tradeoffs: More repeated text over the bridge, but simpler compatibility and persistence.
- Decision: Preserve synchronous `runs.start` for non-chat callers.
  - Why: Evaluation and CLI tests already depend on current semantics.
  - Alternatives: Replace `runs.start` globally.
  - Tradeoffs: Two run-start paths to maintain during v1.

## Progress Log
- 2026-04-24 23:03 CST - Task created
  Next: Fill in Goal, Scope, Plan, and list Active Files
- 2026-04-24 23:18 CST - Resumed from journal and found prior partial provider/shared edits already in the worktree. Completed provider stream interfaces, SSE parsers, runtime event callback wiring, async `LocalRunStore.startStreamingRun`, JSON-RPC/stdout notifications, Tauri event forwarding, desktop subscription/state merge, and partial assistant rendering.
  Next: Run focused verification, regenerate bundled sidecar, update task DONE gates.
- 2026-04-24 23:33 CST - Verification passed for shared/runtime/desktop typechecks/tests, Rust bridge tests, lint, stdio functional smoke, and bundled sidecar regeneration.
  Next: none; close task as Done.

## Open Issues
- None.

## TODO
- None.

## Retrospective
### Item 1
- Pitfall: Streaming stdio callbacks can emit notifications before the JSON-RPC response if they write directly from the run event callback.
- Symptom: A direct `runs.startStreaming` stdio smoke initially printed `runs.stream` before the `{ id: 1, result: ... }` handle response.
- Root Cause: The background run began emitting events before `handleJsonRpcLine` returned and before `runStdioServer` wrote the response line.
- Reusable Guardrail: Buffer stream notifications until the response has been written, then flush queued notifications in order.
- Evidence: `apps/runtime/src/stdio.ts` now buffers `queuedStreams`; functional smoke shows line 1 is the handle response and line 2 is the first `runs.stream` notification.
- Scope: Runtime stdio streaming bridges.
- Suggested Writeback Target: None; local implementation guardrail is enough for now.
- Status: local_only

## Functional Verification

### Code Verification (Code Correctness)
- [x] Code compiles/runs without errors
- [x] Unit tests pass
- [x] Lint checks pass

**Output**:
- `pnpm --filter @ora/shared typecheck` -> passed.
- `pnpm --filter @ora/runtime typecheck` -> passed.
- `pnpm --filter @ora/desktop typecheck` -> passed.
- `pnpm --filter @ora/desktop build` -> passed; Vite emitted the existing large chunk warning.
- `pnpm --filter @ora/shared test` -> `Test Files 1 passed (1); Tests 70 passed (70)`.
- `pnpm --filter @ora/runtime test` -> `Test Files 11 passed (11); Tests 100 passed (100)`.
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` -> `15 passed; 0 failed`.
- `pnpm lint` -> `pnpm -r --if-present lint` completed successfully.

### Functional Verification (Feature Works)
- [x] Core functionality verification: stdio `runs.startStreaming` emits handle first, then NDJSON stream notifications.
- [x] Edge cases verification: final snapshot notification is emitted and persisted; `runs.stream` still includes status/snapshot for polling compatibility.
- [x] Error handling verification: provider and bridge tests cover streaming parse and delayed notification forwarding.

**Output**:
- `printf ... runs.startStreaming ... | pnpm --silent --filter @ora/runtime start | sed -n '1,3p'`
  - Line 1: `{"jsonrpc":"2.0","id":1,"result":{"runId":"run-0005",...,"status":"running",...}}`
  - Line 2: `{"jsonrpc":"2.0","method":"runs.stream","params":{"runId":"run-0005","fromSeq":0,"events":[{"type":"run.started",...}],"status":"running"}}`
  - Line 3: next `runs.stream` notification with runtime event data.
- `pnpm --filter @ora/runtime package:sidecar` -> bundled runtime sidecar regenerated successfully.

## Comparison (If Applicable)

### Reference
- Reference implementation/template/similar task: Existing synchronous `runs.start` + `runs.stream` lifecycle in `LocalRunStore` and desktop `adaptChatMessages`.

### Comparison Points
- [x] Existing `runs.start` remains synchronous for CLI/evaluation callers.
- [x] Existing `runs.stream` still returns ordered events after `afterSeq`, with additive `status`/`snapshot` metadata.
- [x] Existing transcript fallback still derives final assistant text from the last `message.delta`.

### Findings
- Consistency: Streaming reuses the same event envelope shape and cumulative `message.delta.content`.
- Differences: New `runs.startStreaming` returns while the run is still `running`; live events arrive via stdio/Tauri notifications.
- Conclusion: The new path extends the current contracts without replacing the synchronous path.

## Checkpoints

### Checkpoint 1: Runtime emits incremental events
- Requirement: `runs.startStreaming` returns quickly and `runs.stream` exposes partial events before terminal status.
- Verification method: Vitest runtime lifecycle test with local smoke streaming provider.
- Status: [x] Pass / [ ] Fail
- Evidence: `apps/runtime/test/runtime-smoke.test.ts` verifies `runs.startStreaming` returns `running`, publishes multiple `message.delta` stream events, and final `runs.state` is `succeeded`.

### Checkpoint 2: Desktop renders partial assistant text
- Requirement: Chat view model/state can show assistant content from live `message.delta` events before transcript finalization.
- Verification method: Vitest reducer/view model test.
- Status: [x] Pass / [ ] Fail
- Evidence: `apps/runtime/test/desktop-runtime-client.test.ts` verifies partial `message.delta` content renders as assistant text; `apps/runtime/test/desktop-composer-state.test.ts` verifies reducer stream merge.

### Checkpoint 3: Bridge does not block while streaming
- Requirement: Tauri process bridge returns handle and forwards later run events without waiting for child exit.
- Verification method: Rust unit test with mock shell process emitting a handle then delayed event lines.
- Status: [x] Pass / [ ] Fail
- Evidence: `process_bridge_forwards_stream_notifications_after_start_response` passed in `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`.

**All checkpoints must pass before marking task DONE!**

## Compressed State (<= 20 lines)
- Objective: Implement true incremental streaming output for Ora chat runs.
- Done: Added `runs.startStreaming`, provider stream interfaces/parsers, kernel event callbacks, live snapshot persistence, stdio/Tauri notifications, desktop event subscription, reducer merge, and partial assistant rendering.
- Done: Regenerated bundled runtime sidecar and Tauri capability schema.
- Active files: shared schemas, runtime providers/kernel/store/json-rpc/stdio/tests, desktop sidecar/client/state/viewModel/App/tests/capabilities.
- Next actions (top 3; exact file/function): none.
- Blockers/Risks: None known. TODO scanner still reports pre-existing task journal/generated/binary noise outside feature source.
- Verification status: Passed shared/runtime/desktop typecheck; shared/runtime tests; Rust tests; lint; stdio smoke; package sidecar.

## Verification

### Evidence Requirements
Must provide the following evidence:
- [x] Code Verification output (compilation/tests/lint)
- [x] Functional Verification output (feature verification)
- [x] Retrospective Evidence (if applicable)
- [x] Comparison Evidence (if applicable)
- [x] Checkpoints Evidence (if applicable)

### Environment
- Environment: macOS desktop workspace, Node/pnpm workspace, Rust cargo via Tauri package.

### Commands run + outputs
- `python3 skills/long-task-protocol/scripts/create_journal.py "ora-true-streaming-output"` -> `tasks/TASK-20260424-2303-ora-true-streaming-output.md`
- `pnpm --filter @ora/shared typecheck` -> passed.
- `pnpm --filter @ora/shared test` -> `Test Files 1 passed (1); Tests 70 passed (70)`.
- `pnpm --filter @ora/runtime typecheck` -> passed.
- `pnpm --filter @ora/runtime test` -> `Test Files 11 passed (11); Tests 100 passed (100)`.
- `pnpm --filter @ora/desktop typecheck` -> passed.
- `pnpm --filter @ora/desktop build` -> passed; Vite emitted the existing large chunk warning.
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` -> `15 passed; 0 failed`.
- `pnpm lint` -> completed successfully.
- `pnpm --filter @ora/runtime package:sidecar` -> `runtime-sidecar.cjs 5.2mb`; completed successfully.
- Functional stdio smoke: first JSON line is `runs.startStreaming` handle response, following lines are `runs.stream` notifications.
- `bash /Users/quintenchen/.codex/skills/long-task-protocol/scripts/todo_scan.sh` -> reports pre-existing task journal TODO headings plus generated/binary noise under `.ora/runtime.db`, `apps/runtime/.ora/runtime.db`, `apps/desktop/src-tauri/target/**`, and `apps/desktop/src-tauri/resources/runtime-sidecar/**`; no blocking TODO/FIXME/XXX introduced in first-party source edits for this task.
- `rg --pcre2 -n "TODO(?!\\(FOLLOWUP\\))|FIXME|XXX" packages/shared/src/index.ts apps/runtime/src apps/desktop/src apps/desktop/src-tauri/src apps/runtime/test apps/desktop/src-tauri/capabilities/default.json apps/desktop/src-tauri/gen/schemas/capabilities.json` -> no matches.
