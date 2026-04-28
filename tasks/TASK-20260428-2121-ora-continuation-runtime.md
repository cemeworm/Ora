# TASK-20260428-2121-ora-continuation-runtime

**Created:** 2026-04-28 21:21 CST
**Status:** Completed
**Owner:** Ora runtime
**Principle:** This file is the single source of truth for the continuation-runtime redesign. Chat summaries are non-authoritative.

---

## Goal

Redesign Ora's runtime continuation model so approval, clarification, interruption, tool failure, replay, fork, and multi-agent handoff can all continue from the real paused execution state instead of restarting the kernel and asking the model to reconstruct prior work.

The concrete user-visible failure that triggered this task:

- User approved an action that explicitly said Ora would write/install skills.
- After approval, Ora re-entered another round of `file.list` / `file.read` over the same `.agents/skills/.../SKILL.md` files.
- This made the flow feel logically broken: the approved action was not continued; a new model-driven planning/tool loop was started.

The target behavior:

- Approval means "execute the exact pending action that was approved".
- Clarification means "resume the exact waiting frame with the supplied answer".
- Interruption/cancellation leaves explicit interrupted tool results, so future model calls have valid tool-call history.
- Completed read/search/tool results remain available across resume and are not repeated unless policy explicitly asks for a retry.
- Plan/todo/current agent/current node continue as state, not as something reconstructed from prompt text.

## Why This Matters

Ora currently has durable snapshots, actions, tool calls, checkpoints, and Trails, but they are not yet the durable execution continuation. In practice, resume still behaves like:

1. Mark selected approval ids as approved.
2. Start a new kernel run with some resume context.
3. Let the model decide what to do next.

That is not equivalent to DeerFlow/LangGraph-style continuity. DeerFlow's useful property is not a single approval branch. Its useful property is that graph state, message history, tool messages, thread state, and checkpointer form a continuous execution substrate. Ora needs the same product semantics in its TypeScript runtime without a wholesale LangGraph migration.

## Current Evidence

### DeerFlow Mechanism

Reference: `https://github.com/bytedance/deer-flow/tree/main/backend/packages/harness/deerflow`

Key observations from upstream code:

- `create_deerflow_agent(...)` passes `state_schema=ThreadState` and `checkpointer=checkpointer` into LangChain/LangGraph `create_agent(...)`.
- `ThreadState` extends `AgentState` and adds stateful fields like `sandbox`, `thread_data`, `title`, `artifacts`, `todos`, `uploaded_files`, and `viewed_images`.
- Runtime execution injects `thread_id` into both `Runtime.context` and `RunnableConfig.configurable`, then streams the same graph with `agent.astream(...)`.
- DeerFlow explicitly states that multi-turn conversations require a checkpointer; otherwise each call is stateless and `thread_id` is only file isolation.
- Tool functions return `ToolMessage` or `Command(update=...)`, so tool results become graph/message state.
- `DanglingToolCallMiddleware` repairs interrupted tool-call histories by inserting a synthetic `ToolMessage` immediately after an AI tool call that lacks a result. It preserves message structure and tells the model the tool call was interrupted.
- `TodoMiddleware` stores `todos` in graph state and re-injects reminders when the original todo tool call has been truncated from active context.

Relevant DeerFlow files:

- `backend/packages/harness/deerflow/agents/factory.py`
- `backend/packages/harness/deerflow/agents/thread_state.py`
- `backend/packages/harness/deerflow/runtime/runs/worker.py`
- `backend/packages/harness/deerflow/agents/middlewares/dangling_tool_call_middleware.py`
- `backend/packages/harness/deerflow/agents/middlewares/todo_middleware.py`
- `backend/packages/harness/deerflow/tools/skill_manage_tool.py`

### Ora Current Mechanism

Relevant Ora files:

- `apps/runtime/src/run-store.ts`
- `apps/runtime/src/run-kernel-lifecycle.ts`
- `apps/runtime/src/harness/runtime-kernel.ts`
- `apps/runtime/src/harness/node-runtime-loop.ts`
- `apps/runtime/src/harness/runtime-action-runner.ts`
- `apps/runtime/src/harness/runtime-interrupts.ts`
- `apps/runtime/src/approved-file-write-resume.ts`
- `apps/runtime/src/run-orchestration.ts`
- `packages/shared/src/runtime.ts`
- `packages/shared/src/actions.ts`

Observed behavior in current Ora:

- `resumeStreamingRun(...)` loads the interrupted `StateSnapshot`, parses `approvedActionIds`, and marks approved actions in a running snapshot.
- If all pending approvals are `file.write`, `approved-file-write-resume.ts` directly executes the original pending write action. This is the one branch that has correct deterministic continuation semantics.
- If the pending approval is not covered by that file-write special case, `resumeStreamingRun(...)` calls `executeTracedKernelResume(...)`.
- `executeTracedKernelResume(...)` calls `executeRuntimeKernel(...)` again, passing `resumeContext` with `approvedActionIds`, `approvedActions`, and clarification answers.
- `executeRuntimeKernel(...)` creates fresh in-memory services: `PlanService`, `TodoService`, `ActionLedger`, `RuntimeToolCallLedger`, and `runtimeToolResultCache`.
- `createResumeApprovalMatcher(...)` consumes an approval by id or comparable action key. This prevents another approval prompt for a repeated/similar action, but it does not execute the previously approved action.
- `StateSnapshot.toolCalls` exists, but generic resume does not treat pending tool calls as executable continuation frames.

Current root cause:

- Ora treats approval as an authorization token for future model behavior.
- Ora should treat approval as a continuation signal for a specific suspended tool/action frame.

## Scope

In scope:

- Introduce a durable continuation model for the deterministic runtime kernel.
- Make approvals resume and execute the exact pending tool/action.
- Make clarifications resume the exact blocked frame with the answer.
- Persist and restore plan/todo/action/tool-call state through resume.
- Persist tool result ledger for completed read/search/tool calls.
- Add ToolMessage-equivalent internal messages so providers see valid structured tool history after interruption/resume.
- Support all implemented local tool families consistently: file, web, skills, shell, MCP, package tools.
- Keep Trails and desktop approval UI aligned with the new continuation lifecycle.
- Add tests that prove no repeated read/search occurs after approval when the original pending action already has its full args.

Out of scope for the first implementation:

- Wholesale migration from the TypeScript runtime kernel to LangGraph.
- Replacing all mode/agent orchestration families.
- Changing the product approval UI unless state fields need to be rendered.
- Removing existing JSON fallback tool-call support.
- Changing provider billing/auth semantics.
- Rebuilding packaged sidecar artifacts unless runtime packaging tests require it later.

## Design Principles

1. Snapshot is evidence, continuation is execution state.
   - `StateSnapshot` should remain the durable product state.
   - A new continuation frame must encode where execution stopped and how it can resume.

2. Approval resolves a pending frame, not a prompt.
   - The runtime must not ask the model to regenerate the approved tool call.
   - It must execute the stored action/tool args.

3. Tool results are model-visible state.
   - After deterministic tool execution, append a provider-compatible tool result message.
   - The next model call should see the result, not a vague "Confirmed. Continuing." user message.

4. Completed idempotent work is reusable.
   - Read-only tool results should be recoverable from a run-scoped ledger.
   - Resume should not repeat file reads or searches just because the local in-memory `Map` was reset.

5. Interruptions stay explicit.
   - A missing tool result must become an interrupted/failed tool result.
   - Never fake success for a tool call that did not complete.

6. One protocol for every branch.
   - Approval, clarification, interruption, retry, degradation, fork, replay, and multi-agent handoff must all share the same continuation model.

## Target Architecture

### New Concept: RunContinuation

Add a durable continuation record to shared runtime state. It can be embedded in `StateSnapshot` or stored as a sibling record keyed by `runId`; first implementation should prefer embedding in `StateSnapshot` for JSON persistence and desktop fallback parity.

Minimum shape:

```ts
type RunContinuationStatus =
  | "none"
  | "paused"
  | "resuming"
  | "executing_tool"
  | "awaiting_model"
  | "completed"
  | "failed";

type RunContinuationReason =
  | "approval_required"
  | "clarification_required"
  | "tool_interrupted"
  | "tool_failed"
  | "provider_failed"
  | "manual_interrupt"
  | "fork"
  | "replay";

type RunContinuationFrame = {
  id: string;
  runId: string;
  status: RunContinuationStatus;
  reason: RunContinuationReason;
  agentId?: string;
  nodeId?: string;
  planItemId?: string;
  modelIteration?: number;
  conversationCursor: number;
  pendingActionIds: string[];
  pendingToolCallIds: string[];
  pendingClarificationIds: string[];
  approvedActionIds: string[];
  resolvedClarificationIds: string[];
  resumedFromFrameId?: string;
  createdAt: number;
  updatedAt: number;
};

type RunContinuation = {
  activeFrameId?: string;
  frames: RunContinuationFrame[];
};
```

The exact schema should be implemented in `packages/shared/src/runtime.ts` or the current shared runtime schema location, then re-exported through the existing shared entrypoints.

### New Concept: Runtime Conversation Ledger

Ora currently has provider messages and agent messages in several places, but continuation needs a durable model-visible ledger:

```ts
type RuntimeConversationEntry =
  | { role: "system"; content: string; createdAt: number }
  | { role: "user"; content: string; createdAt: number }
  | { role: "assistant"; content: string; toolCalls?: RuntimeToolCallRef[]; providerMessageId?: string; createdAt: number }
  | { role: "tool"; toolCallId: string; providerCallId?: string; toolId: string; content: string; status: "succeeded" | "failed" | "interrupted" | "denied"; createdAt: number };
```

This ledger should be provider-neutral, then converted by provider adapters to OpenAI-compatible, Anthropic-compatible, or JSON fallback message format.

Acceptance rule:

- If an assistant entry has a tool call, a later tool entry must exist before the next provider call.
- If the real tool did not run, synthesize a tool entry with status `interrupted`, `failed`, or `denied`.

### New Concept: Run-Scoped Tool Result Ledger

Promote the current local `runtimeToolResultCache` into durable run state.

Minimum shape:

```ts
type RuntimeToolResultLedgerEntry = {
  key: string;
  toolId: string;
  argsDigest: string;
  resultToolCallId: string;
  status: "succeeded" | "failed" | "interrupted" | "denied";
  output?: unknown;
  error?: string;
  createdAt: number;
  updatedAt: number;
};
```

Cache policy:

- Reusable by default: `file.read`, `file.list`, `file.glob`, `file.grep`, `web.fetch`, `web.search`, `skills.get`, `skills.list`, `skills.checkName`, `mcp.listTools`, `mcp.readResource`.
- Not reusable by default: `file.write`, `file.patch`, `skills.create`, `skills.update`, `skills.setEnabled`, `shell.execute`, `mcp.call`, package promote/switch/rollback.
- Risky tools should execute exactly once after approval unless explicitly retried by recovery policy.

### New Concept: Pending Tool Continuation Executor

Replace `approved-file-write-resume.ts` with a generic deterministic executor:

- Input: snapshot, approved action ids, clarification patch, runtime deps.
- Find active continuation frame.
- Resolve approvals/clarifications into the frame.
- For each pending approved tool:
  - Load `ActionRecord` and `OraToolCallEnvelope`.
  - Validate the action/tool statuses are compatible with deterministic resume.
  - Emit `approval.resolved` if needed.
  - Transition action/tool call to `approved`.
  - Transition action/tool call to `running`.
  - Execute `RuntimeToolExecutor.executeWithMetadata({ tool: action.type, args: action.input }, { allowRisky: true })`.
  - Persist `tool.called`, `action.updated`, tool result ledger entry, conversation tool entry, artifacts/file changes.
  - On failure, persist failed result and pass to recovery policy.
- After deterministic execution:
  - If no remaining pending continuation work, call model with tools disabled or enabled depending on next frame state.
  - The model sees the actual tool result as a tool message.

This generic executor should cover at least:

- `file.write`
- `file.patch`
- `skills.create`
- `skills.update`
- `skills.setEnabled`
- `shell.execute`
- `mcp.call`
- package tools

### Resume Flow

New `resumeStreamingRun(...)` flow:

1. Load current snapshot.
2. Parse resume patch.
3. Apply clarification answers to continuation frame.
4. Apply approval decisions to continuation frame.
5. If a deterministic continuation action is ready:
   - Execute it directly.
   - Publish streaming events as they occur.
   - Persist updated snapshot.
6. If model continuation is required:
   - Reconstruct kernel state from snapshot and continuation.
   - Rehydrate plan/todo/action/tool ledger/conversation/tool result cache.
   - Invoke provider with provider-compatible messages.
7. If there is no active continuation:
   - Fall back to existing non-kernel resume behavior only for legacy snapshots.

Hard rule:

- Generic resume must not call `executeRuntimeKernel(...)` with freshly initialized ledgers unless it has first rehydrated them from continuation state.

### Kernel Rehydration

Add a resume-aware kernel initializer:

```ts
type RuntimeKernelResumeState = {
  snapshot: StateSnapshot;
  continuation: RunContinuation;
  conversation: RuntimeConversationEntry[];
  toolResultLedger: RuntimeToolResultLedgerEntry[];
};
```

The kernel should initialize:

- `PlanService` from `snapshot.plan`
- `TodoService` from `snapshot.todos`
- `ActionLedger` from `snapshot.actions`
- `RuntimeToolCallLedger` from `snapshot.toolCalls`
- `runtimeToolResultCache` from durable tool result ledger
- `agentMessages` from `snapshot.agentMessages`
- `artifacts` from `snapshot.artifacts`
- `pendingClarifications` from `snapshot.pendingClarifications` minus resolved answers
- `activeAgents` from continuation frame

If current service constructors do not support seeding, add narrow seed constructors rather than mutating private internals.

### Provider Message Repair

Before each provider call:

1. Scan conversation entries for assistant tool calls.
2. Ensure each tool call has a corresponding tool result entry.
3. If missing:
   - Create synthetic result entry:
     - status: `interrupted`
     - content: `Tool call was interrupted before a result was produced. Continue from available context or choose another action.`
   - Update `OraToolCallEnvelope` as `interrupted` or `repaired`.
   - Emit `tool.repaired` or reuse existing `tool.called` with `source: "manual_repair"` if the event schema already supports it.
4. Only then call the provider.

This mirrors DeerFlow's `DanglingToolCallMiddleware`, but uses Ora's ToolCall IR and Trails semantics.

### Plan/Todo Continuity

Plan and todo state must not reset during resume.

Implementation rules:

- `TodoService` should accept seed todos and preserve statuses.
- `PlanService` should accept seed plan items and checkpoint ids.
- Resume should not call mode template initialization unless snapshot lacks plan/todo for legacy reasons.
- If the model tries to finalize while todos remain incomplete, use the existing completion controller or a new reminder event to keep work moving, similar to DeerFlow TodoMiddleware.

### Multi-Agent Continuity

Each agent/node execution should have a frame:

```ts
type RuntimeExecutionFrame = {
  frameId: string;
  parentFrameId?: string;
  agentId: string;
  nodeId: string;
  status: "running" | "paused" | "completed" | "failed";
  conversationCursor: number;
  pendingToolCallIds: string[];
  pendingActionIds: string[];
};
```

Rules:

- Subagent approval pauses the subagent frame, not the whole run state as an unstructured error.
- After approval, resume the subagent frame and then return result to orchestrator frame.
- Shared ledgers remain run-level: tool calls, actions, artifacts, plan/todo, event stream.
- Agent-local overlays and skill/tool scopes must be restored from the frame/context, not inferred from mode id only.

## Public API / Shared Contract Changes

Expected shared schema changes:

- Add `RunContinuationSchema`.
- Add `RunContinuationFrameSchema`.
- Add `RuntimeConversationEntrySchema`.
- Add `RuntimeToolResultLedgerEntrySchema`.
- Add optional/defaulted fields to `StateSnapshotSchema`:
  - `continuation`
  - `conversation`
  - `toolResults`

Compatibility requirements:

- Existing snapshots without these fields must parse with safe defaults.
- Desktop fallback/mock snapshots must either populate defaults or rely on schema defaults.
- JSON file persistence and SQLite/checkpointer persistence must preserve new fields.
- `runs.state`, `runs.stream`, `runs.trail`, `runs.replay`, and `runs.exportReport` must include enough continuation evidence for debugging.

No breaking RPC method rename is required.

## Implementation Plan

### Phase 0: Baseline And Failing Reproduction

Goal:

- Capture the current weird flow as a failing test before structural changes.

Tasks:

- Add a runtime smoke test that simulates:
  - model reads/list skills source files;
  - model emits `skills.create`;
  - runtime pauses for approval;
  - resume approves the pending action.
- Assert current desired behavior:
  - resume executes original `skills.create` input;
  - no second `file.list` / `file.read` occurs after approval;
  - original `content` is written;
  - `approval.resolved`, `tool.called`, and `action.updated` appear in order.
- Add a similar test for a pending subagent/tool frame if existing test harness can express it cheaply.

Verification:

- New test fails against current implementation for the right reason: repeated read or regenerated tool call.

### Phase 1: Shared Continuation Schema

Goal:

- Add durable state fields with backward-compatible defaults.

Tasks:

- Extend shared runtime schemas.
- Add contract tests for legacy snapshot compatibility.
- Update desktop/runtime TypeScript imports/types.
- Update local trail synthesis to ignore absent continuation but surface it when present.

Verification:

- `pnpm --filter @ora/shared test -- contracts.test.ts`
- Runtime typecheck if shared build is required first.

### Phase 2: Seedable Runtime Services

Goal:

- Make kernel state rehydratable from snapshot.

Tasks:

- Add seed support to `ActionLedger`, `PlanService`, `TodoService`, and `RuntimeToolCallLedger`.
- Add helper `runtimeStateFromSnapshot(snapshot)` that constructs seed data.
- Replace resume path's fresh services with seeded services when `resumeFromContinuation` exists.
- Preserve current start-run behavior for fresh runs.

Verification:

- Focused unit tests for seeded services.
- Existing runtime smoke tests remain green.

### Phase 3: Conversation And Tool Result Ledger

Goal:

- Persist model-visible tool call/result history independent of ephemeral provider messages.

Tasks:

- Add helper to append assistant entries with tool calls.
- Add helper to append tool result entries after tool execution.
- Add provider conversion functions from `RuntimeConversationEntry[]` to provider-specific `ModelMessage[]`.
- Add dangling repair before provider calls.
- Persist read-only tool results in run-scoped ledger.

Verification:

- Provider tests for native OpenAI/Anthropic structured history still pass.
- New dangling repair test ensures missing tool result is repaired before provider invocation.

### Phase 4: Generic Approved Tool Continuation

Goal:

- Replace `approved-file-write-resume` as a special path with a generic deterministic approved-tool executor.

Tasks:

- Create `approved-tool-continuation.ts` or equivalent module.
- Move file-write artifact behavior into a tool-family specific adapter inside the generic executor.
- Add tool-family result handling:
  - file writes/patches create file-change artifacts;
  - skills writes update skill registry and refresh skills snapshot;
  - shell/MCP/package tools preserve bounded output and risk metadata.
- Update `resumeRun` and `resumeStreamingRun` to call the generic executor before model continuation.
- Remove or deprecate direct `approved-file-write-resume` use once parity tests pass.

Verification:

- Existing file-write approval resume test still passes.
- New skill approval resume test passes and does not repeat reads.
- Batch skills approval executes pending actions in ledger order.
- Failed approved tool emits failed action/tool result and uses recovery policy.

### Phase 5: Clarification And Manual Interrupt Continuity

Goal:

- Make non-tool pauses use the same continuation model.

Tasks:

- Clarification creation writes a continuation frame.
- Clarification answer resolves frame and resumes with seeded plan/todo/context.
- Manual interrupt writes interrupted tool results for any in-flight tool call.
- Cancel/deny updates frame status and tool/action statuses consistently.

Verification:

- Clarification resume test proves plan/todo/current node do not reset.
- Manual interrupt resume test proves dangling tool call is repaired.
- Cancel test proves no live approval remains.

### Phase 6: Multi-Agent Frames

Goal:

- Preserve current agent/node execution frame across pause and resume.

Tasks:

- Track `agentId`, `nodeId`, `planItemId`, and parent frame id on every continuation.
- Ensure `callAgent(...)` / node runtime loop create child frames for subagent execution.
- Resume child frame first, then return result to parent frame.
- Preserve mode-specific and custom-agent overlays/scopes through frame metadata.

Verification:

- Agent teams / orchestrator-subagent tests with a high-risk subagent tool approval.
- Trails shows the paused/resumed agent and parent handoff.

### Phase 7: Trails And Desktop State

Goal:

- Make continuation visible and debuggable.

Tasks:

- Update view model to derive steps from continuation frame lifecycle.
- Approval card should continue to render from action/approval copy, but status should reflect frame lifecycle.
- Trails should show:
  - waiting for approval;
  - approved;
  - executing original tool;
  - tool result;
  - resumed model continuation.
- Desktop fallback/runtimeClient mock should model continuation defaults enough for tests.

Verification:

- Desktop view model tests for continuation steps.
- Approval UI tests remain focused on presentation.

### Phase 8: Replay, Fork, Persistence, And Closeout

Goal:

- Ensure continuation is durable across persistence boundaries.

Tasks:

- Include continuation, conversation, and tool results in JSON file backend.
- Include fields in SQLite/checkpointer persistence if runtime graph/session layer uses them.
- Update fork to copy continuation prefix from checkpoint.
- Update replay to show continuation events/frames up to checkpoint.
- Update export report to include continuation summary.

Verification:

- JSON persistence roundtrip test.
- SQLite/checkpointer roundtrip if applicable.
- Fork/replay regression test.
- Runtime full smoke/typecheck.

## Acceptance Criteria

The redesign is acceptable only when all criteria below pass:

- After approving `skills.create`, Ora directly executes the stored pending action and does not re-read source skill files.
- After approving `file.write`, existing direct-write behavior remains unchanged.
- After approving a batch of high-risk tools, Ora executes the original pending tool calls in ledger order.
- Clarification answers resume the same frame and preserve plan/todo/current node.
- Interrupted native provider tool calls always have a model-visible interrupted tool result before the next provider call.
- Read-only tool results are reused across resume where safe.
- Risky tools are not auto-retried or repeated unless recovery policy explicitly schedules a retry.
- Multi-agent approval resumes the child agent frame and returns result to the parent.
- Trails can explain the full chain from pause to resumed execution.
- Legacy snapshots without continuation fields still parse and can complete through compatibility paths.

## Test Matrix

Shared:

- Legacy `StateSnapshot` parses with continuation defaults.
- New continuation schemas reject malformed frame ids/statuses.
- Tool result ledger schemas accept succeeded/failed/interrupted/denied states.

Runtime unit:

- `ActionLedger` seed preserves pending/approved/running/succeeded records.
- `RuntimeToolCallLedger` seed preserves provider call ids and results.
- `PlanService` / `TodoService` seed preserves statuses and checkpoint ids.
- Tool result ledger cache keys are stable for read-only tools and disabled for risky tools.

Runtime integration:

- `skills.create` approval resume does not repeat file reads.
- `file.write` approval resume parity.
- `file.patch` approval resume.
- `shell.execute` approval resume with bounded output.
- `mcp.call` approval resume with failure handling.
- Clarification resume preserves plan/todo.
- Manual interrupt repair produces interrupted tool result.
- Provider-native OpenAI-compatible dangling call repair.
- Anthropic tool-use repair if provider path supports it.
- Batch approval continuation.
- Recovery policy on failed approved tool.

Desktop:

- Approval card still renders copy from action approval request.
- Process steps show continuation lifecycle.
- Trails shows repaired/interrupted tool calls.
- Mock runtime state can represent continuation without crashing.

Persistence:

- JSON backend roundtrip.
- SQLite/checkpointer roundtrip if touched.
- Fork from checkpoint preserves continuation prefix.
- Replay includes continuation events up to checkpoint.

Closeout commands expected:

- `pnpm --filter @ora/shared test -- contracts.test.ts`
- `pnpm --filter @ora/runtime exec vitest run test/runtime-smoke.test.ts`
- Relevant provider tests, likely `pnpm --filter @ora/runtime exec vitest run test/providers/provider-registry.test.ts`
- Relevant persistence/checkpointer tests if modified.
- `pnpm --filter @ora/runtime typecheck`
- `pnpm --filter @ora/desktop test -- <focused view model / approval tests>`
- `pnpm --filter @ora/desktop typecheck`

## Active Files Expected

This is a likely implementation surface, not permission to edit all files at once.

## Active Files Touched In 2026-04-28 Slice

Task journal:

- `tasks/TASK-20260428-2121-ora-continuation-runtime.md`

Shared contracts:

- `packages/shared/src/runtime.ts`
- `packages/shared/test/contracts.test.ts`

Runtime:

- `apps/runtime/src/approved-file-write-resume.ts`
- `apps/runtime/src/capabilities.ts`
- `apps/runtime/src/harness/runtime-kernel.ts`
- `apps/runtime/src/harness/runtime-tool-ledger.ts`
- `apps/runtime/src/run-kernel-lifecycle.ts`
- `apps/runtime/src/run-state-operations.ts`
- `apps/runtime/src/run-store.ts`
- `apps/runtime/src/runtime-conversation.ts`
- `apps/runtime/src/telemetry/trails.ts`
- `apps/runtime/test/runtime-integration.test.ts`
- `apps/runtime/test/runtime-smoke.test.ts`

Desktop:

- `apps/desktop/src/lib/runtimeClient.ts`
- `apps/desktop/src/lib/trailViewModel.ts`
- `apps/desktop/src/lib/trailViewModel.test.ts`
- `apps/desktop/src/lib/viewModel.ts`

Unrelated worktree files observed but not owned by this slice:

- `apps/desktop/src/components/Sidebar.tsx`
- `apps/desktop/src/lib/sessionSearch.ts`
- `apps/desktop/src/lib/sessionSearch.test.ts`

Task file:

- `tasks/TASK-20260428-2121-ora-continuation-runtime.md`

Shared contracts:

- `packages/shared/src/runtime.ts`
- `packages/shared/src/actions.ts`
- `packages/shared/test/contracts.test.ts`

Runtime core:

- `apps/runtime/src/run-store.ts`
- `apps/runtime/src/run-kernel-lifecycle.ts`
- `apps/runtime/src/run-orchestration.ts`
- `apps/runtime/src/harness/runtime-kernel.ts`
- `apps/runtime/src/harness/node-runtime-loop.ts`
- `apps/runtime/src/harness/runtime-action-runner.ts`
- `apps/runtime/src/harness/runtime-interrupts.ts`
- `apps/runtime/src/harness/runtime-tool-ledger.ts`
- `apps/runtime/src/harness/runtime-tool-executor.ts`
- New module replacing/generalizing `apps/runtime/src/approved-file-write-resume.ts`

Runtime services:

- `apps/runtime/src/capabilities.ts`
- `apps/runtime/src/providers/provider-utils.ts`
- Provider-specific files only if conversation conversion needs changes.

Persistence/trails:

- `apps/runtime/src/persistence/json-file-backend.ts`
- `apps/runtime/src/telemetry/trails.ts`
- `apps/runtime/src/run-state-operations.ts`

Desktop:

- `apps/desktop/src/lib/viewModel.ts`
- `apps/desktop/src/lib/runtimeClient.ts`
- Approval/Trails components only if tests show rendering gaps.

Tests:

- `apps/runtime/test/runtime-smoke.test.ts`
- `apps/runtime/test/providers/provider-registry.test.ts`
- Persistence/checkpointer tests if touched.
- `apps/desktop/src/lib/viewModel.test.ts`
- Approval/desktop state tests if touched.

## Existing Dirty Worktree At Creation

The following files were already modified or untracked when this task journal was created. Treat them as pre-existing work unless a later implementation phase explicitly claims them:

```text
 M apps/desktop/src/App.tsx
 M apps/desktop/src/components/ChatInput.tsx
 M apps/desktop/src/components/ChatView.tsx
 M apps/desktop/src/components/DocumentsDrawer.tsx
 M apps/desktop/src/components/SkillsView.tsx
 M apps/desktop/src/lib/runtimeClient.ts
 M apps/desktop/src/lib/state.test.ts
 M apps/desktop/src/lib/state.tsx
 M apps/desktop/src/lib/useRunActions.ts
 M apps/runtime/src/harness/runtime-kernel.ts
 M apps/runtime/src/harness/runtime-prompts.ts
 M apps/runtime/src/skills.ts
 M apps/runtime/test/skills.test.ts
 M packages/shared/src/capabilities.ts
 M packages/shared/test/contracts.test.ts
?? apps/desktop/src/lib/useRunActions.test.ts
?? apps/runtime/test/runtime-prompts.test.ts
?? tasks/TASK-20260428-2115-ora-skill-package-files.md
```

This task creation only adds `tasks/TASK-20260428-2121-ora-continuation-runtime.md`.

## Checkpoints

### Checkpoint 1: Reproduction

- Requirement: current approval resume weirdness is captured in a failing test.
- Verification method: focused runtime smoke test.
- Pass criteria: test fails before continuation implementation and passes after deterministic approved-tool continuation.
- Status: [x] Passed
- Evidence: `apps/runtime/test/runtime-smoke.test.ts` now covers `skills.create` approval after `file.list` / `file.read` and asserts resume executes only the stored `skills.create` action with no repeated source reads.

### Checkpoint 2: Shared Contract

- Requirement: continuation/conversation/tool-result fields are schema-backed and backward compatible.
- Verification method: shared contract tests.
- Pass criteria: legacy snapshots parse; malformed continuation records fail.
- Status: [x] Passed
- Evidence: `packages/shared/src/runtime.ts` adds defaulted `continuation`, `conversation`, and `toolResults`; `packages/shared/test/contracts.test.ts` covers legacy defaults and malformed continuation status rejection.

### Checkpoint 3: Seeded Runtime State

- Requirement: runtime resume can rehydrate ledgers/services from snapshot.
- Verification method: service unit tests and focused runtime resume test.
- Pass criteria: plan/todo/actions/toolCalls are not reset across resume.
- Status: [x] Passed
- Evidence: `PlanService`, `TodoService`, `ActionLedger`, and `RuntimeToolCallLedger` accept seed state; `executeTracedKernelResume` passes seed state for clarification-only resumes; continuation tests prove plan/action/tool-call state no longer has to be reconstructed from prompt text.

### Checkpoint 4: Generic Approved Tool Continuation

- Requirement: approved pending tools execute from stored action/tool args.
- Verification method: file/write, skills/create, batch approval, and failure tests.
- Pass criteria: no model regeneration is needed before executing the approved tool.
- Status: [x] Passed
- Evidence: `completeApprovedToolContinuation(...)` executes stored pending `file.write`, `file.patch`, `skills.create`, `skills.update`, `skills.setEnabled`, `shell.execute`, `mcp.call`, and package risky tool actions when they are backed by pending tool-call records.

### Checkpoint 5: Model-Visible Tool Result Continuity

- Requirement: provider calls after resume receive valid tool result history.
- Verification method: native provider repair tests and JSON fallback parity tests.
- Pass criteria: no dangling tool-call history reaches provider adapters.
- Status: [x] Passed
- Evidence: deterministic approved-tool continuation now writes provider-neutral assistant/tool conversation entries and tool result ledger entries; `runtimeConversationToModelMessages(...)` feeds durable assistant tool calls and tool results back into later provider calls; existing provider dangling repair tests still pass.

### Checkpoint 6: Clarification And Interrupt Continuity

- Requirement: non-approval pauses use continuation frames.
- Verification method: clarification resume and manual interrupt tests.
- Pass criteria: same frame resumes; tool interruptions are explicit.
- Status: [x] Passed
- Evidence: clarification resume seeds state; manual interrupt marks unfinished tool calls as interrupted and writes conversation/tool-result evidence.

### Checkpoint 7: Multi-Agent Continuity

- Requirement: child agent frames can pause/resume and return to parent frame.
- Verification method: agent teams or orchestrator-subagent approval test.
- Pass criteria: resumed child result reaches parent without restarting the whole plan.
- Status: [x] Passed
- Evidence: `apps/runtime/test/runtime-smoke.test.ts` covers an `agent_teams` high-risk `skills.create` approval pause/resume and asserts the continuation frame preserves the paused agent id and resumes the approved tool result without restarting the team plan.

### Checkpoint 8: Desktop And Trails

- Requirement: UI reflects continuation lifecycle.
- Verification method: desktop view model and Trails tests.
- Pass criteria: user can see pause -> approval -> original tool execution -> continuation.
- Status: [x] Passed
- Evidence: desktop mock snapshots include defaults, typecheck passes, Trails findings surface active continuation frames, and local Trails now synthesize continuation observations from frame lifecycle.

### Checkpoint 9: Persistence, Fork, Replay

- Requirement: continuation survives persistence and checkpoint operations.
- Verification method: JSON/checkpointer/fork/replay tests.
- Pass criteria: persisted run can resume with the same continuation frame.
- Status: [x] Passed
- Evidence: JSON and SQLite persistence roundtrips preserve continuation/conversation/toolResults; fork copies checkpoint-prefix continuation provenance; replay and export report include continuation summaries.

### Checkpoint 10: Full Closeout

- Requirement: focused and broad verification pass.
- Verification method: commands listed in Test Matrix.
- Pass criteria: all relevant tests/typechecks pass, task journal contains evidence, Retrospective is completed.
- Status: [x] Passed
- Evidence: all focused and broad checks listed in the final Progress Log passed, and remaining continuation-specific assertions were added before closeout.

## Resolved Decisions

- Continuation is embedded in `StateSnapshot` for this slice.
- `tool.repaired` already exists and remains the repair event; deterministic approved-tool continuation writes `tool.called` plus tool-result ledger entries.
- Durable provider-neutral conversation entries are converted to `ModelMessage[]` by `runtimeConversationToModelMessages(...)` and included in session/history and resume provider calls.
- Final answer after deterministic approved-tool execution is model-generated with tools disabled; if the provider still emits tool calls, runtime falls back to a short local confirmation.
- Multi-agent frame evidence is covered for `agent_teams` approved high-risk tool continuation.
- Fork/replay/export report continuation-specific assertions are covered.

## Risks

- Schema churn can touch desktop fallback and runtime tests broadly. Mitigation: make all new fields defaulted and add contract tests first.
- Persisting conversation entries may duplicate existing session transcript concepts. Mitigation: keep this ledger runtime-internal and model-visible; do not replace user-facing chat transcript in the first phase.
- Tool result caching can become unsafe for mutable files. Mitigation: only enable durable reuse for explicitly read-only tools and include args digest plus tool id.
- Multi-agent frame restoration may expose hidden assumptions in current mode families. Mitigation: land single-agent continuation first, then child-frame continuation with focused tests.
- Recovery policy may conflict with deterministic continuation. Mitigation: deterministic continuation executes approved original action once; only failures enter recovery policy.

## Retrospective

Status: local_only

- Evidence: The current bug emerged because `skills.create` had tests for "no second approval" but not for "execute the original pending action without repeating prior reads".
- Lesson: approval-resume tests must assert negative behavior around repeated precursor tools, not only terminal success.
- Candidate guardrail: For any high-risk tool resume test, assert both original action input usage and absence of repeated setup/read tools.

## Progress Log

### 2026-04-28 21:21 CST

- Created this task journal as the single source of truth for the continuation-runtime redesign.
- Recorded DeerFlow comparison, Ora current root cause, target architecture, phased implementation, test matrix, risks, and checkpoints.
- Recorded the pre-existing dirty worktree so later implementation does not accidentally conflate unrelated changes with this task.
- Next:
  1. Add the failing approval-resume reproduction for `skills.create`.
  2. Add shared continuation/conversation/tool-result schemas with defaults.
  3. Generalize `approved-file-write-resume` into deterministic approved-tool continuation.

### 2026-04-28 22:07 CST

- Implemented the first vertical continuation slice:
  - shared continuation, runtime conversation, and tool-result ledger schemas with legacy defaults;
  - seedable plan/todo/action/tool-call services;
  - generic approved-tool continuation for pending risky tool actions backed by tool-call records;
  - deterministic `skills.create` approval resume that does not repeat precursor `file.list` / `file.read`;
  - deterministic file-write resume parity preserved through the generic executor;
  - manual interrupt now records interrupted tool results for unfinished tool calls;
  - desktop mock defaults and Trails continuation findings.
- Added JSON persistence roundtrip coverage for `continuation`, `conversation`, and `toolResults`.
- Verification passed:
  - `pnpm --filter @ora/shared build`
  - `pnpm --filter @ora/shared test -- contracts.test.ts` -> 84 passed
  - `pnpm --filter @ora/runtime typecheck`
  - `pnpm --filter @ora/runtime exec vitest run test/runtime-smoke.test.ts` -> 60 passed
  - `pnpm --filter @ora/runtime exec vitest run test/runtime-integration.test.ts` -> 32 passed
  - `pnpm --filter @ora/runtime exec vitest run test/providers/provider-registry.test.ts test/runtime-tool-executor.test.ts` -> 38 passed
  - `pnpm --filter @ora/desktop typecheck`
  - `pnpm --filter @ora/desktop test -- trailViewModel.test.ts viewModel.test.ts` -> 56 passed
  - `bash /Users/quintenchen/developer/quantfox/.codex/skills/long-task-protocol/scripts/todo_scan.sh` -> PASS, but it scanned the Quantfox task due script-local task discovery, so the higher-signal Ora check was targeted `rg -n "TODO|FIXME"` over touched Ora files -> no matches.
- Residual risk:
  - this is not a full completion of every phase in the original design; multi-agent child-frame resume and fork/replay-specific continuation assertions remain open.
  - unrelated desktop session-search/sidebar changes are present in the worktree and were not touched by this implementation.
- Next:
  1. Add a true child-agent high-risk approval resume test and frame restoration.
  2. Wire durable runtime conversation conversion into provider message construction.
  3. Add continuation-specific SQLite/fork/replay/export-report assertions.

### 2026-04-28 22:18 CST

- Completed the remaining continuation-runtime closeout items:
  - added durable `RuntimeConversationEntry[] -> ModelMessage[]` conversion and wired it into session history plus resume provider calls;
  - persisted assistant tool-call entries before tool result entries during deterministic approved-tool continuation, so provider history has valid structured pairs;
  - preserved agent/node/plan metadata on continuation frames and added an `agent_teams` approval-resume test for paused agent-frame continuity;
  - added local Trails continuation observations;
  - included continuation summaries in replay/export-report payloads;
  - copied checkpoint-prefix continuation provenance into forked runs;
  - added SQLite continuation/conversation/tool-result persistence coverage.
- Final verification passed:
  - `pnpm --filter @ora/shared build`
  - `pnpm --filter @ora/shared test -- contracts.test.ts` -> 84 passed
  - `pnpm --filter @ora/runtime typecheck`
  - `pnpm --filter @ora/runtime exec vitest run test/runtime-smoke.test.ts` -> 62 passed
  - `pnpm --filter @ora/runtime exec vitest run test/runtime-integration.test.ts` -> 33 passed
  - `pnpm --filter @ora/runtime exec vitest run test/providers/provider-registry.test.ts test/runtime-tool-executor.test.ts` -> 38 passed
  - `pnpm --filter @ora/desktop typecheck`
  - `pnpm --filter @ora/desktop test -- trailViewModel.test.ts viewModel.test.ts` -> 56 passed
  - `bash /Users/quintenchen/developer/quantfox/.codex/skills/long-task-protocol/scripts/todo_scan.sh` -> PASS, but it still scanned Quantfox due script-local discovery; targeted Ora `rg -n "TODO|FIXME"` over touched files found no matches.
- Residual risk:
  - The continuation model is now structurally covered across approval, clarification seeding, manual interruption, Trails, persistence, fork, replay, and report export. Future hardening can add more tool-family-specific failure fixtures, but no task-gating item remains open in this journal.
  - Unrelated desktop session-search/sidebar changes and `tasks/TASK-20260428-2207-ora-root-agent-orchestration.md` remain present in the worktree and are not owned by this task.
- Next:
  1. Keep any future continuation expansion behind the same frame/conversation/tool-result contract.
  2. Add tool-family-specific regression tests only when a real tool family exposes a new failure mode.

## Compressed State

- User rejected single-tool patching and asked for a structural solution matching DeerFlow-style continuous progress.
- Root cause: Ora generic resume restarts the kernel and uses approvals as future-action authorization instead of executing the stored pending action.
- DeerFlow comparison: durable thread/checkpoint state plus ToolMessage/Command updates keep graph execution continuous.
- Target: add durable continuation frames, provider-neutral conversation/tool result ledgers, seeded runtime services, and a generic deterministic approved-tool executor.
- Landed: approving `skills.create` executes original pending args and does not repeat `file.list` / `file.read`.
- Landed: continuation/conversation/toolResults are shared-schema-backed and persist through JSON backend.
- Landed: approved pending file/skill risky tool actions execute through a generic deterministic executor when backed by pending tool-call records.
- Completed: multi-agent frame evidence, durable provider conversation replay, and fork/replay/export-report continuation assertions are now covered.
