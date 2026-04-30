# TASK-20260430-1452-ora-channel-connectors

**Created:** 2026-04-30 14:52 Asia/Shanghai
**Status:** Done (P0/P1 + Follow-ups)
**Owner:** Ora runtime
**Principle:** This file is the single source of truth for Ora channel/connector conversation capability. Chat summaries and ad-hoc notes are non-authoritative once this task file exists.

---

## Goal

Build a DeerFlow-inspired channel/connector layer for Ora so external communication channels can connect to Ora and converse through the existing session/run/runtime system.

The desired product behavior:

- External platforms can send user messages into Ora through a channel adapter.
- Ora maps each external chat/thread/topic to a stable Ora `sessionId`.
- Each inbound message becomes a new Ora turn/run inside that session.
- Ora streams or finalizes the agent response, then sends an outbound message back to the originating channel.
- Channel-originated conversations preserve Ora's existing strengths: root agent `ora`, mode selection, multi-agent execution, approvals, clarifications, continuation, active memory, artifacts, checkpoints, Trails, and evaluation/feedback loops.

This task is not just about adding Slack/Feishu SDKs. The core is a durable **Channel Core** abstraction that normalizes external messaging into Ora's current `session = thread`, `turn = run` runtime model.

---

## Why This Matters

Ora currently has a strong local desktop/runtime conversation substrate:

- `sessions.*` and `runs.*` APIs.
- True incremental streaming through `runs.startStreaming` and `runs.stream` notifications.
- Persistent snapshots, checkpoints, artifacts, continuation frames, active memory, root-agent orchestration, and agent conversation records.

But it does not yet have a first-class way for external chat surfaces to become entry points into this substrate. Without a channel layer, every new integration would likely duplicate:

- message normalization,
- external chat to Ora session mapping,
- run streaming aggregation,
- outbound delivery and retry,
- credentials/security,
- command handling,
- event observability,
- attachment handling,
- platform-specific threading semantics.

DeerFlow's `backend/app/channels` is useful because it separates these concerns clearly. Ora should borrow the architecture, not copy every platform implementation upfront.

---

## Reference: DeerFlow Channels

Reference source:

- `https://github.com/bytedance/deer-flow/tree/main/backend/app/channels`

Observed directory files:

- `backend/app/channels/__init__.py`
- `backend/app/channels/base.py`
- `backend/app/channels/commands.py`
- `backend/app/channels/dingtalk.py`
- `backend/app/channels/discord.py`
- `backend/app/channels/feishu.py`
- `backend/app/channels/manager.py`
- `backend/app/channels/message_bus.py`
- `backend/app/channels/service.py`
- `backend/app/channels/slack.py`
- `backend/app/channels/store.py`
- `backend/app/channels/telegram.py`
- `backend/app/channels/wechat.py`
- `backend/app/channels/wecom.py`

### DeerFlow Architectural Pattern

```text
Platform adapter
  -> InboundMessage
  -> MessageBus inbound queue
  -> ChannelManager
  -> channel/chat/topic -> LangGraph thread mapping
  -> runs.wait / runs.stream
  -> OutboundMessage
  -> MessageBus outbound subscribers
  -> Platform adapter send / update / upload
```

### DeerFlow File Responsibilities

- `base.py`
  - Defines the base `Channel` abstraction.
  - Core lifecycle: `start()`, `stop()`, `send()`.
  - Optional attachment methods: `send_file()`, `receive_file()`.
  - Normalizes inbound platform messages into `InboundMessage`.
  - Subscribes to outbound messages and sends only messages targeting its channel.

- `message_bus.py`
  - Provides inbound async queue and outbound publish/subscribe.
  - Decouples platform adapters from agent/runtime dispatch.
  - Isolates callback failure so one channel send failure does not break other subscribers.

- `manager.py`
  - Consumes inbound messages from the bus.
  - Routes command messages separately from normal chat.
  - Resolves or creates LangGraph thread IDs.
  - Handles files before invoking the agent.
  - Calls `runs.wait()` for non-streaming channels or `runs.stream()` for streaming-capable channels.
  - Publishes outbound responses and attachments.
  - Includes concurrency control, thread-busy handling, run context/config layering, and security checks for output file paths.

- `service.py`
  - Owns `MessageBus`, `ChannelStore`, `ChannelManager`, and concrete channel instances.
  - Starts/stops/restarts enabled channels from config.
  - Exposes channel status and singleton lifecycle helpers.

- `store.py`
  - Stores mapping from external channel chat/topic to internal thread ID.
  - Key shape: `channel_name:chat_id` or `channel_name:chat_id:topic_id`.
  - Uses JSON persistence with atomic write in DeerFlow; Ora should use SQLite.

- `commands.py`
  - Central source of known channel commands.
  - Commands include `/bootstrap`, `/new`, `/status`, `/models`, `/memory`, `/help`.

- Platform adapters (`feishu.py`, `slack.py`, etc.)
  - Own platform authentication, event parsing, threading semantics, markdown/card conversion, retries, reactions, file upload/download, and streaming update behavior.
  - Example: Feishu uses WebSocket + interactive cards for running/final states.
  - Example: Slack uses Socket Mode, thread replies, reactions, mrkdwn conversion, and file upload.

### DeerFlow Lessons for Ora

1. The important seam is the normalized message bus, not any single platform SDK.
2. Channel mapping must be durable and independent of runtime runs.
3. Channel manager should be the only place that knows how inbound messages become agent runs.
4. Platform adapters should not know Ora's internal run/session details beyond normalized inbound/outbound structures.
5. Commands should be centralized so platform-specific parsers do not drift.
6. Streaming should degrade gracefully: channels that cannot edit/update messages should get final-only replies.
7. Outbound delivery failures need durable retry records, not just logs.

---

## Current Ora State

### Runtime and Contracts

Key files:

- `packages/shared/src/runtime.ts`
- `apps/runtime/src/json-rpc.ts`
- `apps/runtime/src/stdio.ts`
- `apps/runtime/src/run-store.ts`
- `apps/runtime/src/run-state-operations.ts`
- `apps/runtime/src/runtime-conversation.ts`
- `apps/runtime/src/persistence/types.ts`
- `apps/runtime/src/persistence/sqlite-backend.ts`

Current capabilities:

- `SessionSummary`, `SessionTurn`, `SessionDetail`, `SessionTranscriptMessage` exist.
- `session = thread`, `turn = run` is already the established model.
- `StateSnapshot` stores run state, input, config, topology, memory, plan, todos, actions, tool calls, continuation, conversation, agent messages, artifacts, checkpoints, events, and output/error.
- `RunEventStream` provides ordered event retrieval by `afterSeq`.
- JSON-RPC exposes `sessions.create/list/get/archive` and `runs.start/startStreaming/list/stream/interrupt/resume/resumeStreaming/cancel/state/trail/checkpoints/replay/fork/exportReport`.
- `stdio.ts` can emit `runs.stream` notifications over NDJSON after `runs.startStreaming`.
- SQLite persistence exists for `manifest`, `runs`, `sessions`, `projects`, and `artifacts`.

### Existing Product/Architecture Decisions

Relevant task files:

- `tasks/TASK-20260423-1559-ora-new-chat-session-thread.md`
  - Decision: `session = thread`, `turn = run`.
  - Allows pattern/provider/model to vary per turn.

- `tasks/TASK-20260424-2303-ora-true-streaming-output.md`
  - Decision: use `runs.startStreaming` plus stream notifications.
  - `message.delta.content` is cumulative assistant text for UI compatibility.

- `tasks/TASK-20260428-2121-ora-continuation-runtime.md`
  - Decision: approvals/clarifications/interruption should resume exact continuation frames, not restart from prompt-only context.

- `tasks/TASK-20260428-2207-ora-root-agent-orchestration.md`
  - Decision: `ora` is the user-facing root agent above modes.
  - Every user message should first be received by `ora` conceptually.

- `tasks/TASK-20260426-2302-ora-agent-conversation-orchestration.md`
  - Decision: agent-to-agent collaboration is stored as structured `agentMessages`, not inferred UI.

### Current Gaps

Ora does not yet have:

- A `Channel` or `Connector` abstraction.
- Normalized external inbound/outbound message contracts.
- Durable external chat/thread/topic to `sessionId` binding.
- Runtime service capable of receiving webhooks or long-lived platform events.
- Channel-level configuration, status, credentials, lifecycle, and restart APIs.
- Channel-specific command handling.
- Channel message idempotency/deduplication.
- Outbound delivery outbox and retry.
- Per-binding concurrency control.
- Attachment ingress/egress pipeline.
- Channel observability linking external message IDs to `sessionId`, `runId`, and event seqs.
- Desktop/admin UI for configuring channels.

---

## Scope / Out of Scope

### In Scope

- Define Channel Core contracts in shared runtime types.
- Add runtime channel modules for normalized message handling.
- Add durable persistence for channel configs, bindings, inbound messages, and outbound deliveries.
- Implement Generic HTTP/Webhook Channel as MVP adapter.
- Map inbound channel messages to Ora `sessions` and `runs.startStreaming`.
- Convert Ora stream events to channel outbound messages.
- Add minimal commands: `/new`, `/status`, `/help`.
- Add idempotency, per-binding queueing, basic delivery retry, and status APIs.
- Add tests proving external messages become session turns and outbound replies.

### Out of Scope for First Implementation

- Implementing Slack, Feishu, WeChat, WeCom, Telegram, DingTalk, and Discord all at once.
- Replacing the existing stdio sidecar transport.
- Rebuilding desktop configuration UI before runtime channel core is proven.
- Full binary attachment download/upload in P0.
- Multi-tenant organization/account model beyond minimal channel/user metadata.
- Perfect production credential storage in P0; use explicit placeholders and avoid logging secrets.
- Real public webhook hosting/tunneling workflow.
- Changing the fundamental `session = thread`, `turn = run` model.

---

## Constraints

- Compatibility:
  - Existing `sessions.*`, `runs.*`, streaming, checkpoint, replay, fork, continuation, evaluation, and desktop runtime flows must keep working.
  - Existing SQLite data must remain loadable.
  - Existing snapshots should not need destructive migrations.

- Simplicity:
  - Build core channel abstraction first.
  - Start with one generic HTTP/Webhook adapter.
  - Avoid platform SDK complexity until the internal seam is stable.

- Runtime truth:
  - Channel origin must be persisted as evidence, not only UI state.
  - Binding from external thread to Ora session must be durable.
  - Outbound delivery attempts must be auditable.

- Security:
  - Never put channel secrets/tokens in run snapshots or logs.
  - Webhook ingestion must support token or HMAC validation before production use.
  - Callback delivery should restrict target hosts or only use configured endpoints.

- Performance:
  - Same external binding should process messages in order.
  - Global concurrency should be bounded.
  - Streaming fanout should avoid excessive SQLite writes beyond existing run streaming behavior.

- Project style:
  - Follow `claude.md`: Think Before Coding, Simplicity First, Surgical Changes, Goal-Driven Execution.
  - Prefer testable, incremental changes over a broad integration rewrite.

---

## Target Architecture

### New Concept: Channel

A `Channel` is an external communication surface through which users can talk to Ora.

Examples:

- `http_webhook`
- `slack`
- `feishu`
- `wechat`
- `wecom`
- `telegram`
- `discord`
- `dingtalk`

A channel has:

- stable `channelId`,
- `kind`,
- enabled/running status,
- non-secret config,
- secret reference or redacted credential fields,
- inbound parser,
- outbound sender,
- optional streaming capability,
- optional file capability,
- optional command parsing behavior.

### New Concept: ChannelBinding

A `ChannelBinding` maps an external conversation context to an Ora session.

Minimum logical key:

```text
channelId + externalChatId + externalThreadId/topicId -> sessionId
```

Rationale:

- Slack has channel/thread timestamps.
- Feishu has chat IDs and root message IDs.
- WeChat/WeCom may have chat IDs and group/user IDs.
- Generic HTTP webhook can define `externalChatId` and optional `externalThreadId`.

Ora should not assume all platforms have the same thread model. The normalized binding key should support optional `externalThreadId`.

### New Concept: ChannelInboundMessage

Normalized inbound message from any platform.

Expected fields:

```ts
type ChannelInboundMessage = {
  id: string;
  channelId: string;
  channelKind: ChannelKind;
  externalMessageId: string;
  externalChatId: string;
  externalThreadId?: string;
  externalUserId?: string;
  externalUserDisplayName?: string;
  type: "chat" | "command" | "event";
  text: string;
  attachments: ChannelAttachment[];
  receivedAt: number;
  raw?: unknown;
  metadata: Record<string, unknown>;
};
```

### New Concept: ChannelOutboundMessage

Normalized outbound message to a platform.

Expected fields:

```ts
type ChannelOutboundMessage = {
  id: string;
  channelId: string;
  bindingId: string;
  sessionId: string;
  runId?: string;
  externalChatId: string;
  externalThreadId?: string;
  inReplyToExternalMessageId?: string;
  text: string;
  isFinal: boolean;
  kind: "status" | "delta" | "final" | "error" | "command_response";
  attachments: ChannelAttachment[];
  createdAt: number;
  metadata: Record<string, unknown>;
};
```

### New Concept: ChannelDelivery

Durable record of outbound delivery attempts.

Expected lifecycle:

```text
queued -> sending -> sent
queued -> sending -> retry_scheduled -> sending -> sent
queued -> sending -> failed
```

Delivery records should include:

- `deliveryId`,
- `channelId`,
- `outboundMessageId`,
- `sessionId`,
- `runId`,
- `status`,
- `attemptCount`,
- `nextAttemptAt`,
- redacted error summary,
- timestamps.

### Runtime Flow

```text
External platform/webhook
  |
  v
Channel adapter parses raw event
  |
  v
ChannelInboundMessage
  |
  v
ChannelStore records inbound and dedupes externalMessageId
  |
  v
ChannelManager resolves ChannelBinding
  |-- if no binding -> sessions.create
  |
  v
ChannelManager builds UserTaskInput
  |
  v
runs.startStreaming({ sessionId, input, config })
  |
  v
RunEventStream events
  |
  v
ChannelManager aggregates/transforms events
  |
  v
ChannelOutboundMessage
  |
  v
ChannelDelivery outbox
  |
  v
Channel adapter callback/send
```

### Mapping into Ora Input

For channel-originated runs, `UserTaskInput.context` should include:

```ts
{
  source: "channel",
  channel: {
    channelId,
    channelKind,
    bindingId,
    externalChatId,
    externalThreadId,
    externalUserId,
    externalUserDisplayName,
    externalMessageId
  },
  attachments: [
    // normalized attachment metadata
  ]
}
```

The user-visible `prompt` should remain the message text. Channel metadata should support routing, observability, memory, and audit, but it should not pollute the user's text unless deliberately rendered by prompt builders.

### Mapping from Ora Events to Channel Messages

Initial MVP mapping:

- `run.started` -> optional status message, usually not sent for final-only channels.
- `message.delta` -> accumulated assistant text.
- `agent.message` -> optional internal progress/status; P0 can ignore or summarize.
- `artifact.exported` -> attach or mention artifact in final response; P0 can include text reference only.
- `clarification.required` -> send clarification question as outbound message and pause.
- `approval.required` -> send approval request summary; response handling can be P2.
- `run.done` -> final outbound message using final assistant text.
- `run.failed` -> error outbound message.

MVP should be **final-first**:

- Collect streaming deltas internally.
- Send one final response when run completes.
- Later, for Feishu/Slack, support status message creation and incremental update/edit.

---

## Proposed Files and Responsibilities

### Shared Contracts

Modify:

- `packages/shared/src/runtime.ts`

Add schemas/types for:

- `ChannelKindSchema`
- `ChannelConfigSchema`
- `ChannelStatusSchema`
- `ChannelAttachmentSchema`
- `ChannelInboundMessageSchema`
- `ChannelOutboundMessageSchema`
- `ChannelBindingSchema`
- `ChannelDeliverySchema`
- `ChannelCreateParamsSchema`
- `ChannelUpdateParamsSchema`
- `ChannelGetParamsSchema`
- `ChannelListParamsSchema`
- `ChannelLifecycleParamsSchema`
- `ChannelIngestParamsSchema`
- `ChannelStatusResultSchema`
- `ChannelBindingsListParamsSchema`
- `ChannelDeliveriesListParamsSchema`
- `ChannelDeliveryRetryParamsSchema`

Potentially modify:

- `packages/shared/src/index.ts`
- `packages/shared/test/contracts.test.ts`

### Runtime Channel Core

Add directory:

- `apps/runtime/src/channels/`

Files:

- `apps/runtime/src/channels/base.ts`
  - TypeScript interface for channel adapters.
  - Methods: `start`, `stop`, `send`, optional `sendFile`, optional `receiveFile`, `status`.

- `apps/runtime/src/channels/message-bus.ts`
  - Inbound async queue.
  - Outbound subscription/publish.
  - Error isolation for outbound subscribers.
  - Metrics: queue size, published count, failed callback count.

- `apps/runtime/src/channels/store.ts`
  - Runtime-facing persistence wrapper.
  - CRUD for config, binding, messages, deliveries.
  - Deduplication helpers.
  - Delivery retry scheduling helpers.

- `apps/runtime/src/channels/manager.ts`
  - Main dispatcher.
  - Consumes inbound messages.
  - Resolves binding/session.
  - Executes commands.
  - Calls `LocalRunStore.startStreamingRun` or JSON-RPC equivalent internal method.
  - Converts stream events to outbound messages.
  - Handles run failures and delivery creation.
  - Enforces per-binding serial execution and global concurrency.

- `apps/runtime/src/channels/service.ts`
  - Owns manager, bus, store, adapters.
  - Starts/stops/restarts channels.
  - Returns status.

- `apps/runtime/src/channels/commands.ts`
  - Central command registry.
  - MVP: `/new`, `/status`, `/help`.
  - Later: `/models`, `/memory`.

- `apps/runtime/src/channels/http-webhook.ts`
  - Generic HTTP/Webhook adapter.
  - Parses JSON payloads into `ChannelInboundMessage`.
  - Sends outbound messages to configured callback URL.
  - Supports token/HMAC validation.

### Runtime API / Entrypoints

Modify:

- `apps/runtime/src/json-rpc.ts`

Add methods:

- `channels.create`
- `channels.list`
- `channels.get`
- `channels.update`
- `channels.delete`
- `channels.start`
- `channels.stop`
- `channels.restart`
- `channels.status`
- `channels.ingest`
- `channels.bindings.list`
- `channels.deliveries.list`
- `channels.deliveries.retry`

Add optional service entrypoint:

- `apps/runtime/src/http-server.ts`

HTTP endpoints:

- `POST /channels/:channelId/webhook`
- `GET /channels/:channelId/health`
- `GET /channels/status`

Modify if needed:

- `apps/runtime/src/sidecar-entry.ts`
- `apps/runtime/src/cli.ts`
- `apps/runtime/package.json`

But P0 can expose `channels.ingest` via JSON-RPC first and add HTTP server immediately after.

### Persistence

Modify:

- `apps/runtime/src/persistence/types.ts`
- `apps/runtime/src/persistence/sqlite-backend.ts`
- potentially `apps/runtime/src/persistence/json-file-backend.ts` if test/fallback requires parity.

Add tables:

```sql
CREATE TABLE IF NOT EXISTS channel_configs (
  channelId TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  enabled INTEGER NOT NULL,
  data TEXT NOT NULL,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);
```

```sql
CREATE TABLE IF NOT EXISTS channel_bindings (
  bindingId TEXT PRIMARY KEY,
  channelId TEXT NOT NULL,
  externalChatId TEXT NOT NULL,
  externalThreadId TEXT,
  sessionId TEXT NOT NULL,
  externalUserId TEXT,
  data TEXT NOT NULL,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  UNIQUE(channelId, externalChatId, externalThreadId)
);
```

```sql
CREATE TABLE IF NOT EXISTS channel_messages (
  messageId TEXT PRIMARY KEY,
  channelId TEXT NOT NULL,
  externalMessageId TEXT NOT NULL,
  bindingId TEXT,
  sessionId TEXT,
  runId TEXT,
  direction TEXT NOT NULL,
  type TEXT NOT NULL,
  data TEXT NOT NULL,
  createdAt INTEGER NOT NULL,
  UNIQUE(channelId, externalMessageId)
);
```

```sql
CREATE TABLE IF NOT EXISTS channel_deliveries (
  deliveryId TEXT PRIMARY KEY,
  channelId TEXT NOT NULL,
  outboundMessageId TEXT NOT NULL,
  sessionId TEXT,
  runId TEXT,
  status TEXT NOT NULL,
  attemptCount INTEGER NOT NULL,
  nextAttemptAt INTEGER,
  lastError TEXT,
  data TEXT NOT NULL,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);
```

### Desktop / UI Later

Not required for P0, but likely future files:

- `apps/desktop/src/lib/runtimeClient.ts`
- `apps/desktop/src/lib/state.tsx`
- `apps/desktop/src/components/SettingsView.tsx` or a new `ChannelsView.tsx`
- `apps/desktop/src-tauri/src/commands/sidecar.rs` if Tauri fallback needs method parity.

UI should come after runtime core and tests.

---

## Implementation Plan

### Phase 0: Contract and Design Lock

Objectives:

1. Add shared channel schemas.
2. Add JSON-RPC method names and param/result schemas.
3. Add shared contract tests.

Files:

- `packages/shared/src/runtime.ts`
- `packages/shared/src/index.ts`
- `packages/shared/test/contracts.test.ts`

Verification:

- `pnpm --filter @ora/shared typecheck`
- `pnpm --filter @ora/shared test`

Exit criteria:

- Shared contracts parse valid channel configs/messages/bindings/deliveries.
- Invalid missing IDs, invalid statuses, and invalid delivery states fail schema validation.

### Phase 1: Channel Persistence Store

Objectives:

1. Extend persistence backend interfaces.
2. Add SQLite tables and prepared statements.
3. Implement channel config CRUD.
4. Implement binding get-or-create.
5. Implement inbound dedupe by `(channelId, externalMessageId)`.
6. Implement delivery queue/update/retry state.

Files:

- `apps/runtime/src/persistence/types.ts`
- `apps/runtime/src/persistence/sqlite-backend.ts`
- `apps/runtime/src/persistence/json-file-backend.ts` if needed
- `apps/runtime/src/channels/store.ts`
- `apps/runtime/test/channel-store.test.ts`

Verification:

- Channel store unit tests.
- Existing runtime persistence tests remain green.

Exit criteria:

- Same external message cannot create duplicate runs.
- Same external thread resolves to same `sessionId`.
- Delivery retry metadata persists.

### Phase 2: Channel Core Manager and Bus

Objectives:

1. Add channel adapter interface.
2. Add message bus.
3. Add manager that ingests a normalized message.
4. Resolve/create binding and session.
5. Start an Ora streaming run.
6. Aggregate stream events into final outbound message.
7. Create delivery record.

Files:

- `apps/runtime/src/channels/base.ts`
- `apps/runtime/src/channels/message-bus.ts`
- `apps/runtime/src/channels/manager.ts`
- `apps/runtime/src/channels/service.ts`
- `apps/runtime/src/run-store.ts` if an internal dependency seam is needed
- `apps/runtime/test/channel-manager.test.ts`

Verification:

- Manager unit test with local smoke provider.
- Inbound chat -> new session -> run -> outbound delivery.
- Second inbound same external thread -> same session -> next turnIndex.

Exit criteria:

- Core flow works without HTTP or platform SDK.
- Existing `runs.startStreaming` behavior remains unchanged.

### Phase 3: JSON-RPC Channel APIs

Objectives:

1. Register `channels.*` methods in runtime JSON-RPC handler.
2. Expose create/list/get/update/delete/lifecycle/status APIs.
3. Expose `channels.ingest` for test/manual inbound messages.
4. Expose binding and delivery list/retry APIs.

Files:

- `apps/runtime/src/json-rpc.ts`
- `apps/runtime/src/run-store.ts` or a new runtime facade for channels
- `apps/runtime/test/runtime-channel-rpc.test.ts`

Verification:

- JSON-RPC tests.
- Stdio smoke using `channels.ingest`.

Exit criteria:

- A test can create a channel, ingest a message, and observe a delivery using JSON-RPC only.

### Phase 4: Generic HTTP/Webhook Adapter

Objectives:

1. Add HTTP server entrypoint.
2. Implement `POST /channels/:channelId/webhook`.
3. Normalize JSON payload into `ChannelInboundMessage`.
4. Validate token/HMAC in configured manner.
5. Send final outbound response to configured callback URL or store delivery for manual retrieval.

Files:

- `apps/runtime/src/http-server.ts`
- `apps/runtime/src/channels/http-webhook.ts`
- `apps/runtime/package.json`
- `apps/runtime/test/channel-http-webhook.test.ts`

Recommended generic webhook payload:

```json
{
  "externalMessageId": "msg-123",
  "externalChatId": "chat-abc",
  "externalThreadId": "thread-optional",
  "externalUserId": "user-789",
  "text": "hello ora",
  "attachments": [],
  "metadata": {}
}
```

Verification:

- Local HTTP test server receives callback.
- Duplicate webhook does not duplicate run.
- Invalid token/HMAC rejected.

Exit criteria:

- The full external HTTP path works end-to-end locally.

### Phase 5: Commands

Objectives:

1. Implement `/new`, `/status`, `/help`.
2. Route command messages without invoking normal run execution.
3. Persist command inbound/outbound messages.

Files:

- `apps/runtime/src/channels/commands.ts`
- `apps/runtime/src/channels/manager.ts`
- `apps/runtime/test/channel-commands.test.ts`

Command behavior:

- `/new`
  - creates a new Ora session and rebinds current external chat/thread.
- `/status`
  - returns current binding, session, latest run status, and queue state.
- `/help`
  - returns available commands and brief usage.

Exit criteria:

- Commands generate `command_response` outbound messages.
- Normal chat path unaffected.

### Phase 6: Concurrency, Queueing, and Retry Hardening

Objectives:

1. Per-binding serial queue.
2. Global concurrency limit.
3. Delivery retry with exponential backoff.
4. Run busy behavior.
5. Failure message generation.

Files:

- `apps/runtime/src/channels/manager.ts`
- `apps/runtime/src/channels/store.ts`
- `apps/runtime/test/channel-concurrency.test.ts`
- `apps/runtime/test/channel-delivery-retry.test.ts`

Policy:

- P0/P1 default: queue messages for the same binding.
- If queue length exceeds configured limit, respond with a busy/error message.
- Delivery retries should never duplicate the Ora run.

Exit criteria:

- Concurrent inbound messages for one external thread produce monotonic session turn order.
- Failed callback schedules retry without losing outbound content.

### Phase 7: Attachments

Objectives:

1. P0: attachment metadata pass-through.
2. P2: controlled download to sandbox/uploads.
3. P2: attach artifact references or virtual paths to run context.
4. P2: outbound artifact delivery or graceful degradation.

Files:

- `packages/shared/src/runtime.ts`
- `apps/runtime/src/channels/manager.ts`
- `apps/runtime/src/channels/http-webhook.ts`
- `apps/runtime/src/persistence/sqlite-backend.ts`

Security rules:

- Never download arbitrary URLs without allowlist/size limits.
- Sanitize filenames.
- Avoid path traversal.
- Store only references in snapshots.

Exit criteria:

- Attachments can be represented safely before platform-specific upload/download is added.

### Phase 8: First Real Platform Adapter

Do only after HTTP/Webhook channel proves stable.

Choose one:

- Feishu first if target users are primarily Chinese workplace teams.
- Slack first if target users are primarily overseas/developer teams.

Suggested Feishu reasons:

- Rich card updates map well to Ora streaming/progress.
- Chinese office context likely matches user base.

Suggested Slack reasons:

- Socket Mode avoids public webhook hosting for local/dev use.
- Thread replies and reactions map cleanly to run status.

Files if Feishu:

- `apps/runtime/src/channels/feishu.ts`
- tests around event parsing and outbound card conversion.

Files if Slack:

- `apps/runtime/src/channels/slack.ts`
- tests around Socket Mode event parsing and mrkdwn conversion.

Exit criteria:

- One real platform can receive a message, map it to an Ora session, and receive a final response.

### Phase 9: Desktop/Admin UI

Objectives:

1. List channels and statuses.
2. Create/update HTTP webhook channel config.
3. Show binding and delivery history.
4. Retry failed deliveries.
5. Redact secrets.

Files:

- `apps/desktop/src/lib/runtimeClient.ts`
- `apps/desktop/src/lib/state.tsx`
- `apps/desktop/src/components/ChannelsView.tsx`
- `apps/desktop/src-tauri/src/commands/sidecar.rs` if fallback parity required.

Exit criteria:

- User can configure and inspect channels without raw JSON-RPC calls.

---

## Data Model Details

### ChannelKind

Recommended enum:

```ts
"http_webhook" | "slack" | "feishu" | "wechat" | "wecom" | "telegram" | "discord" | "dingtalk"
```

Only `http_webhook` should be implemented first.

### Channel Capability Flags

Each channel should declare capability metadata:

```ts
type ChannelCapabilities = {
  supportsStreamingUpdates: boolean;
  supportsThreadReplies: boolean;
  supportsReactions: boolean;
  supportsFileInbound: boolean;
  supportsFileOutbound: boolean;
  supportsMessageUpdate: boolean;
};
```

MVP `http_webhook`:

- `supportsStreamingUpdates`: false by default, unless callback protocol supports updates.
- `supportsThreadReplies`: true only by externalThreadId convention.
- `supportsReactions`: false.
- `supportsFileInbound`: metadata only.
- `supportsFileOutbound`: false.
- `supportsMessageUpdate`: false.

### ChannelConfig

Separate non-secret config from secret material when possible:

```ts
type ChannelConfig = {
  channelId: string;
  kind: ChannelKind;
  label: string;
  enabled: boolean;
  capabilities: ChannelCapabilities;
  config: Record<string, unknown>;
  secretRefs?: Record<string, string>;
  createdAt: number;
  updatedAt: number;
};
```

For P0, if secrets are stored in `config`, they must be redacted in all public/list/get/status results.

### ChannelBinding

```ts
type ChannelBinding = {
  bindingId: string;
  channelId: string;
  externalChatId: string;
  externalThreadId?: string;
  sessionId: string;
  externalUserId?: string;
  createdAt: number;
  updatedAt: number;
  metadata: Record<string, unknown>;
};
```

### ChannelMessage Persistence

Store both inbound and outbound normalized payloads so debugging does not rely on run snapshots alone.

```ts
type ChannelMessageRecord = {
  messageId: string;
  channelId: string;
  bindingId?: string;
  sessionId?: string;
  runId?: string;
  direction: "inbound" | "outbound";
  externalMessageId?: string;
  type: "chat" | "command" | "event" | "status" | "delta" | "final" | "error" | "command_response";
  payload: unknown;
  createdAt: number;
};
```

---

## Security Model

### Webhook Authentication

P0 must support at least one of:

- static bearer token,
- HMAC signature over raw body,
- shared secret query/header token for local-only development.

Production recommendation:

- HMAC with timestamp header.
- Reject stale timestamps.
- Compare signatures using constant-time comparison.

### Secret Handling

Rules:

- Do not log tokens, app secrets, signing secrets, callback auth headers.
- Redact secrets in `channels.list/get/status`.
- Do not store secrets in `StateSnapshot.input.context`.
- Do not include raw inbound event payload in run input unless sanitized.
- Store raw payload in channel table only if necessary and redacted.

### Callback Safety

Rules:

- Callback URL must come from channel config, not inbound message.
- Optional allowed host list.
- Reasonable timeout.
- Response body size limit for logged errors.
- Retry only idempotent outbound deliveries.

### Attachment Safety

Rules:

- Default: metadata only.
- Download only if enabled.
- Enforce max file size.
- Sanitize filename.
- Prevent path traversal.
- Store in controlled workspace/sandbox path.

---

## Concurrency and Ordering

### Problem

External platforms may retry webhooks, send messages concurrently, or deliver thread messages out of order. Ora sessions expect turn order to be meaningful because `buildConversationMessages(...)` reconstructs prior turns.

### Policy

- Deduplicate by `(channelId, externalMessageId)` before creating any run.
- For each `bindingId`, process inbound chat messages serially.
- Maintain a global concurrency limit for all bindings.
- If a run is already active for a binding, queue later messages.
- If queue exceeds limit, respond with a graceful busy message.

### MVP Implementation Strategy

In-memory queue is acceptable for P0 tests, but must be backed by persisted message records so duplicate webhooks after restart do not create duplicate runs.

Later version can add persisted pending queue state.

---

## Observability

Every channel-originated run should be traceable across:

- external `channelId`,
- external message ID,
- external chat/thread ID,
- Ora `bindingId`,
- Ora `sessionId`,
- Ora `runId`,
- delivery IDs,
- final status.

Recommended locations:

- `UserTaskInput.context.channel` for run-level correlation.
- `channel_messages` for inbound/outbound audit.
- `channel_deliveries` for send attempts.
- runtime events may include channel metadata in payload for key lifecycle points, but avoid noisy duplication.

Potential future event types in `OraEventTypeSchema`:

- `channel.message_received`
- `channel.message_routed`
- `channel.delivery_queued`
- `channel.delivery_sent`
- `channel.delivery_failed`

P0 can avoid new event types and rely on channel tables plus run events. Add event types only if UI/Trails need them.

---

## Command System

MVP commands:

### `/help`

Returns:

- available commands,
- brief syntax,
- current channel label.

### `/status`

Returns:

- channel status,
- current binding ID,
- current session ID,
- latest run ID/status if any,
- queue status if available.

### `/new`

Behavior:

- Create a new Ora session.
- Rebind current `(channelId, externalChatId, externalThreadId)` to the new session.
- Reply with confirmation.

Later commands:

- `/models`
- `/memory`
- `/mode`
- `/cancel`
- `/retry`

Command design rule:

- Commands must be centralized in `channels/commands.ts`.
- Platform adapters may detect command text, but should not own command semantics.

---

## Attachment Plan

### P0

- Accept attachment metadata in inbound message.
- Store metadata in `ChannelInboundMessage.attachments`.
- Add metadata to `UserTaskInput.context.attachments`.
- Do not download or pass file content to model.

### P1/P2

- Add controlled downloader.
- Store downloaded files in a controlled runtime uploads area.
- Create artifact or virtual path references.
- Inject summarized attachment context into prompt or runtime context.

### P3

- Platform-specific upload/download:
  - Slack files API.
  - Feishu image/file APIs.
  - WeCom media APIs.
- Outbound artifact delivery according to channel capabilities.

---

## Relationship to Existing Ora Features

### Root Agent `ora`

Channel-originated messages should conceptually enter through the same root `ora` path as desktop messages. The channel layer should not bypass mode selection, clarification, or finalization.

### Active Memory

Channel metadata should allow future memory selection to know the conversation came from a channel, but P0 should not add channel-specific memory semantics.

Potential future:

- channel-specific memory scopes,
- external user identity memory,
- workspace/team memory.

### Continuation / Approval / Clarification

P0 behavior:

- If run emits `clarification.required`, send the question back to the channel as a final-ish outbound message.
- If run emits `approval.required`, send a summary and require later channel command/reply support to resolve.

P2 behavior:

- Channel replies can resolve pending clarification or approval.
- External approval buttons/cards for Feishu/Slack can map to `runs.resumeStreaming`.

### Artifacts

P0 behavior:

- Include artifact labels or text references in final response.

P2/P3 behavior:

- Send artifact files if channel supports file outbound.
- Otherwise send links or clear fallback text.

### Evaluation and Feedback Loop

Channel conversations should be eligible as future feedback/evaluation evidence, but do not add automatic feedback ingestion in P0.

Future:

- channel reactions or explicit commands can become feedback signals.
- failed channel deliveries can become feedback-loop project signals.

---

## Decisions

### Decision 1: Build Channel Core before platform adapters

- Chosen: Implement generic HTTP/Webhook channel first.
- Why: It proves the hard internal seam without platform SDK noise.
- Alternatives: Start with Slack or Feishu directly.
- Tradeoffs: HTTP webhook is less polished as a user-facing integration, but dramatically lowers initial complexity and gives a reusable test harness.

### Decision 2: Use Ora `session = thread`, `turn = run`

- Chosen: Map external chat/thread/topic to existing Ora session, and each inbound message to a new run.
- Why: This preserves all existing runtime semantics and avoids a parallel conversation model.
- Alternatives: Create channel-native conversation tables independent of sessions.
- Tradeoffs: Requires careful per-binding ordering, because session transcript order matters.

### Decision 3: Store channel data outside run snapshots

- Chosen: Add channel tables for config, bindings, messages, deliveries.
- Why: Channel delivery/retry/config lifecycle is not the same as run execution state.
- Alternatives: Put all channel metadata in `StateSnapshot.input.context`.
- Tradeoffs: More persistence code, but cleaner lifecycle and better audit/retry.

### Decision 4: Final-first outbound for MVP

- Chosen: Aggregate streaming events and send one final outbound response.
- Why: Generic webhooks may not support message edits or streaming updates.
- Alternatives: Send every delta as a callback event.
- Tradeoffs: Less realtime, but simpler and avoids noisy callback behavior. Platform adapters can later opt into updates.

### Decision 5: Centralize command semantics

- Chosen: Put command definitions and handlers in `channels/commands.ts`.
- Why: Prevent platform adapters from drifting.
- Alternatives: Each adapter owns command handling.
- Tradeoffs: Some platform-specific parsing remains necessary, but semantic behavior stays shared.

### Decision 6: Queue same-binding messages

- Chosen: Serialize messages per `bindingId`.
- Why: Ora multi-turn context depends on prior run order.
- Alternatives: Let all inbound messages start runs concurrently.
- Tradeoffs: Slower under rapid-fire messages, but avoids transcript/context corruption.

---

## Active Files

Expected implementation files:

- `packages/shared/src/runtime.ts`
- `packages/shared/src/index.ts`
- `packages/shared/test/contracts.test.ts`
- `apps/runtime/src/json-rpc.ts`
- `apps/runtime/src/run-store.ts`
- `apps/runtime/src/stdio.ts`
- `apps/runtime/src/sidecar-entry.ts`
- `apps/runtime/src/cli.ts`
- `apps/runtime/src/http-server.ts`
- `apps/runtime/src/channels/base.ts`
- `apps/runtime/src/channels/message-bus.ts`
- `apps/runtime/src/channels/store.ts`
- `apps/runtime/src/channels/manager.ts`
- `apps/runtime/src/channels/service.ts`
- `apps/runtime/src/channels/commands.ts`
- `apps/runtime/src/channels/http-webhook.ts`
- `apps/runtime/src/persistence/types.ts`
- `apps/runtime/src/persistence/sqlite-backend.ts`
- `apps/runtime/src/persistence/json-file-backend.ts`
- `apps/runtime/test/channel-store.test.ts`
- `apps/runtime/test/channel-manager.test.ts`
- `apps/runtime/test/channel-rpc.test.ts`
- `apps/runtime/test/channel-http-webhook.test.ts`
- `apps/runtime/test/channel-commands.test.ts`
- `apps/runtime/test/channel-concurrency.test.ts`
- `apps/runtime/test/channel-delivery-retry.test.ts`

Likely later files:

- `apps/desktop/src/lib/runtimeClient.ts`
- `apps/desktop/src/lib/state.tsx`
- `apps/desktop/src/components/ChannelsView.tsx`
- `apps/desktop/src-tauri/src/commands/sidecar.rs`
- `apps/runtime/src/channels/slack.ts`
- `apps/runtime/src/channels/feishu.ts`

---

## Open Issues

- [x] Confirm first real platform adapter after HTTP/Webhook MVP: Feishu. Decision: Feishu first, Slack later if needed.
- [x] Decide whether P0 stores channel secrets directly in SQLite with redaction or only stores secret references. Decision: P0 supports direct config storage with public redaction and `secretRefs`; production secret manager remains future hardening.
- [x] Decide whether channel HTTP server should be a separate runtime command or integrated into existing runtime entrypoint. Decision: add optional `http-server.ts` factory/entrypoint surface first; CLI/Tauri integration can follow later.
- [x] Decide whether JSON-file persistence fallback must support channel tables immediately or can be SQLite-only for P0. Decision: implemented JSON-file parity for channel configs/bindings/messages/deliveries.
- [x] Decide exact behavior for channel replies that should resolve approval/clarification in P2. Decision: plain reply answers the first pending clarification; `/approve` resumes pending approvals; `/deny` or `/cancel` cancels the run.
- [x] Decide whether channel-originated runs need a default mode/config override per channel. Decision: optional `channel.config.runConfig` is passed as partial run config for channel-originated runs.

---

## TODO

### Planning / Contracts

- [x] Add shared channel schemas and exported types.
- [x] Add JSON-RPC channel method schemas.
- [x] Add shared contract tests for valid/invalid channel structures.

### Persistence

- [x] Extend runtime persistence interface with channel config/binding/message/delivery operations.
- [x] Add SQLite channel tables and migrations/column guards.
- [x] Implement channel store wrapper and unit tests.
- [x] Verify duplicate inbound messages do not create duplicate runs.

### Runtime Core

- [x] Add Channel adapter interface.
- [x] Add Channel message bus.
- [x] Add Channel manager inbound dispatch.
- [x] Resolve/create binding to Ora session.
- [x] Start streaming runs from channel inbound messages.
- [x] Convert run stream events to outbound messages.
- [x] Add delivery queue creation.

### API / Entrypoint

- [x] Register `channels.*` JSON-RPC methods.
- [x] Add `channels.ingest` test/manual API.
- [x] Add optional HTTP server entrypoint.
- [x] Implement Generic HTTP/Webhook adapter.

### Commands

- [x] Implement `/help`.
- [x] Implement `/status`.
- [x] Implement `/new`.
- [x] Add command tests.

### Hardening

- [x] Add per-binding serial queue.
- [x] Add global channel concurrency limit.
- [x] Add outbound delivery retry with backoff.
- [x] Add token/HMAC webhook validation.
- [x] Add secret redaction in status/list/get.

### Later

- [x] Add attachment download pipeline.
- [x] Add channel-originated approval/clarification resume flow.
- [x] Add desktop Channels UI.
- [x] Add first real platform adapter: Feishu.

---

## Functional Verification

### Code Verification (Code Correctness)

Required before DONE:

- [x] Shared typecheck passes.
- [x] Runtime typecheck passes.
- [x] Relevant unit tests pass.
- [x] Existing session/run/streaming regression tests pass.
- [x] Lint passes if project lint is expected for this scope.

Commands to run:

```bash
pnpm --filter @ora/shared typecheck
pnpm --filter @ora/shared test
pnpm --filter @ora/runtime typecheck
pnpm --filter @ora/runtime test
pnpm lint
```

### Functional Verification (Feature Works)

Required behavior checks:

- [x] `channels.create` creates an HTTP webhook channel.
- [x] `channels.ingest` with a new external chat creates a new Ora session.
- [x] A second message with the same external chat/thread uses the same session and creates the next turn.
- [x] Duplicate `externalMessageId` does not create a second run.
- [x] `runs.startStreaming` events produce a final `ChannelOutboundMessage`.
- [x] Delivery record is created and marked sent/retry_scheduled according to callback outcome.
- [x] `/help`, `/status`, `/new` return command responses without normal run execution.
- [x] Same-binding concurrent messages are serialized.
- [x] Invalid webhook token/signature is rejected.

### Evidence to Record

When implementation is done, paste actual outputs under `## Verification`:

- command outputs,
- test summaries,
- sample JSON-RPC request/response,
- sample webhook request/response,
- SQLite or API evidence for binding/message/delivery records,
- residual risks.

---

## Comparison

### Reference

- DeerFlow channel system: `backend/app/channels` in `bytedance/deer-flow`.
- Ora session/thread model: `tasks/TASK-20260423-1559-ora-new-chat-session-thread.md`.
- Ora true streaming model: `tasks/TASK-20260424-2303-ora-true-streaming-output.md`.
- Ora continuation model: `tasks/TASK-20260428-2121-ora-continuation-runtime.md`.
- Ora root agent model: `tasks/TASK-20260428-2207-ora-root-agent-orchestration.md`.

### Comparison Points

- [x] Channel abstraction and lifecycle.
- [x] Message bus decoupling.
- [x] External chat/thread to internal session/thread mapping.
- [x] Streaming/final response handling.
- [x] Command handling.
- [x] File attachment handling. Follow-up adds small HTTP(S) attachment download enrichment with text preview/base64 metadata and size/hash tracking.
- [x] Security and credential treatment.
- [x] Persistence and recovery.

### Findings

- Consistency:
  - Ora should mirror DeerFlow's normalized adapter -> bus -> manager -> runtime -> outbound structure.
  - Ora should mirror DeerFlow's durable external thread mapping, but map to Ora `sessionId`, not LangGraph thread ID.
  - Ora should mirror centralized command semantics.

- Differences:
  - DeerFlow uses LangGraph threads and checkpointers; Ora uses TypeScript runtime snapshots, `sessions`, `runs`, and continuation frames.
  - DeerFlow uses JSON store for channel mappings; Ora should use SQLite channel tables.
  - DeerFlow already has platform adapters; Ora should first implement generic HTTP/Webhook to validate internal architecture.
  - Ora has richer run-level topology, artifacts, approvals, agent messages, and root-agent finalization that should be preserved.

- Conclusion:
  - Borrow DeerFlow's channel layering and mapping concept.
  - Do not copy its exact persistence or LangGraph-specific thread invocation.
  - Build a minimal, durable Ora-native Channel Core first.

---

## Checkpoints

### Checkpoint 1: Shared Contracts

- Requirement: Channel configs, inbound/outbound messages, bindings, deliveries, and RPC params/results are defined and validated.
- Verification method: shared schema tests and typecheck.
- Status: [x] Pass / [ ] Fail
- Evidence: See `packages/shared/test/contracts.test.ts`; shared typecheck/test passed.

### Checkpoint 2: Persistence and Idempotency

- Requirement: Channel configs, bindings, messages, and deliveries persist in SQLite; duplicate external message IDs are idempotent.
- Verification method: channel store unit tests and SQLite-backed runtime tests.
- Status: [x] Pass / [ ] Fail
- Evidence: See `apps/runtime/test/channel-store.test.ts`; SQLite-backed store tests passed and JSON-file parity typechecked.

### Checkpoint 3: Inbound to Ora Session/Run

- Requirement: A channel inbound chat message creates or reuses a binding and starts a run in the mapped session.
- Verification method: manager test using local smoke provider.
- Status: [x] Pass / [ ] Fail
- Evidence: See `apps/runtime/test/channel-rpc.test.ts`; inbound chat creates/reuses sessions and runs.

### Checkpoint 4: Run Stream to Outbound Delivery

- Requirement: Runtime stream events are transformed into final outbound messages and delivery records.
- Verification method: channel manager/HTTP adapter tests.
- Status: [x] Pass / [ ] Fail
- Evidence: See `apps/runtime/test/channel-rpc.test.ts`; final outbound message and delivery records are asserted.

### Checkpoint 5: HTTP/Webhook MVP

- Requirement: A local HTTP webhook request can enter Ora and produce an outbound callback/delivery.
- Verification method: integration test with local HTTP server.
- Status: [x] Pass / [ ] Fail
- Evidence: See HTTP webhook tests in `apps/runtime/test/channel-rpc.test.ts`; auth reject/accept path passed.

### Checkpoint 6: Commands

- Requirement: `/help`, `/status`, and `/new` work without invoking normal agent runs.
- Verification method: command unit tests and channel ingest tests.
- Status: [x] Pass / [ ] Fail
- Evidence: `/help`, `/status`, and `/new` command response behavior covered in `apps/runtime/test/channel-rpc.test.ts`.

### Checkpoint 7: Regression Safety

- Requirement: Existing sessions, runs, streaming, continuation, and persistence tests remain green.
- Verification method: existing shared/runtime test suite.
- Status: [x] Pass / [ ] Fail
- Evidence: shared/runtime tests, workspace lint, and workspace typecheck passed; smoke clarification regressions fixed.

**All checkpoints must pass before marking task DONE.**

---

## Progress Log

### 2026-04-30 15:00 Asia/Shanghai

- Started implementation from the approved task plan.
- Loaded long-task protocol and marked the task status `In Progress`.
- Next: inspect shared/runtime contracts; implement channel schemas; then implement persistence and core manager.

### 2026-04-30 15:03 Asia/Shanghai

- Completed Phase 0 shared contracts: channel kinds/config/status/attachments/inbound/outbound/binding/message/delivery plus RPC params/results.
- Added `channels.*` method names to shared JSON-RPC method schema.
- Added shared contract coverage for valid/invalid channel structures and channel RPC method names.
- Verification passed: `pnpm --filter @ora/shared typecheck` and `pnpm --filter @ora/shared test`.
- Next: implement persistence backend channel operations and channel store wrapper.

### 2026-04-30 15:33 Asia/Shanghai

- Completed P0/P1 implementation across shared contracts, persistence, runtime channel core, JSON-RPC APIs, HTTP webhook adapter/server, commands, hardening, and tests.
- Fixed two existing verification blockers discovered while running the full gate: nested `type` import in `node-runtime-loop.ts`, and optional `clarificationOptions` access in desktop `ChatMessages.tsx`.
- Fixed kernel clarification resume evidence by ensuring `clarification.resolved` is emitted for resumed kernel runs; adjusted smoke mocks to tolerate progress narration provider calls.
- Verification passed: shared typecheck/test, runtime typecheck/test, workspace lint, workspace typecheck.
- Next: only TODO(FOLLOWUP) items remain outside the P0/P1 scope: real platform adapter, desktop Channels UI, binary attachment pipeline, channel approval/clarification reply resume semantics.

### 2026-04-30 16:36 Asia/Shanghai

- Resumed follow-up implementation on remaining `TODO(FOLLOWUP)` items.
- Working assumption: implement Feishu as the first real platform adapter because this workspace/user context is China-first and Feishu-style bot webhooks are the more likely near-term enterprise channel; keep Slack as future adapter if needed.
- Follow-up scope: attachment pipeline, channel-originated continuation replies, Feishu adapter, desktop Channels UI, verification/journal update.
- Next: inspect current channel/runtime/client UI seams, then implement follow-ups incrementally with tests.

### 2026-04-30 18:04 Asia/Shanghai

- Completed follow-up implementation: attachment download enrichment, channel-originated clarification/approval continuation replies, Feishu webhook adapter, optional per-channel `runConfig`, and desktop Channels UI.
- Runtime evidence added in `apps/runtime/test/channel-rpc.test.ts`: attachment download into run context, channel reply answers pending clarification, Feishu challenge/message webhook handling.
- Desktop evidence: `SettingsView` now has a Channels section and `runtimeClient` exposes channels APIs with local fallback support.
- Verification passed: `pnpm --filter @ora/runtime test`, `pnpm --filter @ora/shared typecheck`, `pnpm --filter @ora/shared test`, `pnpm --filter @ora/desktop typecheck`, `pnpm lint`, `pnpm typecheck`.
- Next: no blocking channel TODO(FOLLOWUP) remains; only future polish would be production secret manager, full binary file persistence beyond metadata, and additional platform adapters such as Slack.

### 2026-04-30 19:58 Asia/Shanghai

- Refined Settings Channels UI against DeerFlow channel configuration shape: added selectable tabs/config fields for Telegram, Discord, Slack, Feishu, WeChat, WeCom, DingTalk, and HTTP; non-implemented runtime adapters can save disabled config drafts, while Feishu/HTTP remain enableable.
- Removed blue styling from the Channels Settings surface: active tab ring, enable switch, and save button now use the existing bench/ink palette.
- Changed the bottom action panel from sticky/fixed behavior to a normal card inside the channel page scroll flow, so it scrolls together with the channel configuration.
- Updated desktop browser mock `createChannel` to preserve every shared `ChannelKind` instead of collapsing non-Feishu channels into `http_webhook`.
- Verification passed: `pnpm --filter @ora/desktop typecheck`, `pnpm typecheck`.

---

## Retrospective

Retrospective captured during implementation:

### Item 1

- Pitfall: Starting with a specific platform adapter before Channel Core is stable.
- Symptom: Slack/Feishu SDK concerns obscure core mapping, persistence, idempotency, and streaming semantics.
- Root Cause: Platform integration feels concrete, but the reusable architecture lives one layer below it.
- Reusable Guardrail: First prove normalized inbound -> binding -> Ora run -> outbound delivery with a generic HTTP/Webhook adapter.
- Evidence: Current planning comparison against DeerFlow shows platform files are many, but core behavior is concentrated in `base.py`, `message_bus.py`, `manager.py`, `service.py`, and `store.py`.
- Scope: channel architecture work.
- Suggested Writeback Target: keep local until implementation validates it.
- Status: local_only

### Item 2

- Pitfall: Treating channel metadata as only run input context.
- Symptom: Cannot retry outbound delivery, inspect failures, or dedupe webhook retries without replaying runs or scanning snapshots.
- Root Cause: Channel lifecycle is adjacent to but not identical to run lifecycle.
- Reusable Guardrail: Store channel configs, bindings, messages, and deliveries in dedicated persistence tables; keep only correlation metadata in run input context.
- Evidence: DeerFlow has a separate `ChannelStore`; Ora already separates artifacts and runs in SQLite.
- Scope: persistence architecture work.
- Suggested Writeback Target: keep local until implementation validates table design.
- Status: local_only

### Item 3

- Pitfall: Runtime smoke tests that mock provider responses by absolute call count become brittle once progress narration or title/memory side calls are enabled.
- Symptom: Clarification tests expected the first provider call to be the agent call, but progress narration consumed the first mocked response and made the run succeed instead of interrupt.
- Root Cause: Tests were coupled to incidental provider call order rather than the request shape under test.
- Reusable Guardrail: For provider mocks, branch on request body intent/tool availability (for example `needsClarification` or `user__clarify`) instead of `providerCalls === 1`.
- Evidence: Full runtime test initially failed in `runtime-smoke.test.ts`; after request-shape matching and `clarification.resolved` resume event repair, all 265 runtime tests passed.
- Scope: runtime provider/mock tests and progress narration side effects.
- Suggested Writeback Target: local retrospective for now; promote if another provider mock breaks due to side-call ordering.
- Status: local_only

---

## Compressed State (<= 20 lines)

- Objective completed for P0/P1: Ora now has Channel Core for external messages -> session binding -> streaming run -> outbound delivery.
- Source of truth: this file, not chat summaries.
- Implemented shared channel schemas and `channels.*` JSON-RPC method names.
- Implemented SQLite and JSON-file persistence for channel configs, bindings, messages, and deliveries.
- Implemented `apps/runtime/src/channels/*`: adapter interface, message bus, store, manager, service, commands, HTTP webhook adapter.
- Implemented optional `apps/runtime/src/http-server.ts` with webhook/status/health endpoints.
- Implemented JSON-RPC APIs: create/list/get/update/delete/start/stop/restart/status/ingest/bindings/deliveries/retry.
- Behavior verified: inbound chat creates/reuses Ora session, starts streaming run, creates final outbound delivery, dedupes duplicate external message IDs.
- Commands verified: `/help`, `/status`, `/new` return `command_response` without normal run execution.
- Hardening verified: per-binding serialization, global queue cap, callback retry scheduling, token/HMAC validation, redaction.
- Regression fix included: clarification resume now emits `clarification.resolved`; related smoke tests made robust to progress narration calls.
- Follow-ups completed: Feishu adapter, desktop Channels UI, attachment enrichment, channel clarification/approval reply resume, and optional channel runConfig override.
- Verification status: shared/runtime typecheck/tests pass, workspace lint passes, workspace typecheck passes.

---

## Verification

### Evidence Requirements

Must provide before DONE:

- [x] Code verification output.
- [x] Functional verification output.
- [x] Retrospective evidence.
- [x] Comparison evidence.
- [x] Checkpoints evidence.

### Environment

- Workspace: `/Users/quintenchen/developer/ora`
- Runtime: Node 22.17.0, pnpm workspace, TypeScript.
- Created from planning/research on 2026-04-30.

### Commands run + outputs

Implementation verification:

```bash
pnpm --filter @ora/shared typecheck && pnpm --filter @ora/shared test && pnpm --filter @ora/runtime typecheck && pnpm --filter @ora/runtime test
```

Output summary:

```text
@ora/shared typecheck: passed
@ora/shared test: 1 file passed, 86 tests passed
@ora/runtime typecheck: passed
@ora/runtime test: 20 files passed, 265 tests passed
```

```bash
pnpm lint
```

Output summary:

```text
ora@0.0.0 lint -> pnpm -r --if-present lint
Scope: 3 of 4 workspace projects
Exit Code: 0
```

```bash
pnpm typecheck
```

Output summary:

```text
packages/shared typecheck: Done
apps/runtime typecheck: Done
apps/desktop typecheck: Done
Exit Code: 0
```

```bash
bash "$HOME/.workbuddy/skills/long-task-protocol/scripts/todo_scan.sh"
```

Output summary:

```text
Remaining TODO scan hits are pre-existing/generated/template files only:
- ./.ora/skills/private/think/SKILL.md
- ./.workbuddy/memory/2026-04-29.md
- ./skills/skill-creator/scripts/init_skill.py
- generated runtime sidecar files under apps/desktop/src-tauri/resources/runtime-sidecar
- binary runtime.db / node matches
No task-file blocking TODOs remain except explicit TODO(FOLLOWUP) out-of-scope items.
```

Functional evidence from `apps/runtime/test/channel-rpc.test.ts` and `apps/runtime/test/channel-store.test.ts`:

- `channels.create` creates and redacts an HTTP webhook channel.
- `channels.ingest` creates a binding and Ora session for a new external chat/thread.
- A second inbound message for the same external chat/thread reuses the same session and creates turn 2.
- Duplicate `(channelId, externalMessageId)` returns `duplicate: true` and does not create a second run.
- Final run output becomes `ChannelOutboundMessage(kind=final)` and a delivery record.
- `/help`, `/status`, `/new` produce `command_response` messages and do not execute a normal run.
- Concurrent same-binding ingests serialize to monotonic turn order `[1, 2]`.
- Failed callback marks delivery `retry_scheduled`; token and HMAC auth validation are covered.

Changed implementation files for this task:

- `packages/shared/src/runtime.ts`
- `packages/shared/src/rpc.ts`
- `packages/shared/test/contracts.test.ts`
- `apps/runtime/src/persistence/types.ts`
- `apps/runtime/src/persistence/sqlite-backend.ts`
- `apps/runtime/src/persistence/json-file-backend.ts`
- `apps/runtime/src/channels/base.ts`
- `apps/runtime/src/channels/message-bus.ts`
- `apps/runtime/src/channels/store.ts`
- `apps/runtime/src/channels/manager.ts`
- `apps/runtime/src/channels/service.ts`
- `apps/runtime/src/channels/commands.ts`
- `apps/runtime/src/channels/http-webhook.ts`
- `apps/runtime/src/http-server.ts`
- `apps/runtime/src/run-store.ts`
- `apps/runtime/src/json-rpc.ts`
- `apps/runtime/src/index.ts`
- `apps/runtime/test/channel-store.test.ts`
- `apps/runtime/test/channel-rpc.test.ts`

Regression/support fixes discovered during verification:

- `apps/runtime/src/harness/node-runtime-loop.ts`
- `apps/runtime/test/runtime-smoke.test.ts`
- `apps/desktop/src/components/ChatMessages.tsx`

Residual risks / follow-up:

- Real Feishu/Slack adapter not implemented in this P0/P1 scope.
- Desktop Channels configuration UI not implemented.
- Binary attachment download/upload remains metadata-only.
- Channel replies do not yet resume Ora approval/clarification continuations.


### Follow-up Verification 2026-04-30 18:04 Asia/Shanghai

```bash
pnpm --filter @ora/runtime test && pnpm --filter @ora/shared typecheck && pnpm --filter @ora/shared test && pnpm --filter @ora/desktop typecheck && pnpm lint
```

Output summary:

```text
@ora/runtime test: 20 files passed, 268 tests passed
@ora/shared typecheck: passed
@ora/shared test: 1 file passed, 86 tests passed
@ora/desktop typecheck: passed
pnpm lint: passed
```

```bash
pnpm typecheck
```

Output summary:

```text
packages/shared typecheck: Done
apps/runtime typecheck: Done
apps/desktop typecheck: Done
Exit Code: 0
```

```bash
bash "$HOME/.workbuddy/skills/long-task-protocol/scripts/todo_scan.sh"
```

Output summary:

```text
Remaining TODO scan hits are pre-existing/generated/template/memory strings only; channel task TODO(FOLLOWUP) items are completed.
```

Follow-up functional evidence:

- `apps/runtime/src/channels/attachments.ts` enriches HTTP(S) attachments with download metadata.
- `apps/runtime/test/channel-rpc.test.ts` verifies downloaded text attachment appears in run input context.
- Channel reply continuation verified: pending clarification is resumed by a normal channel reply and emits `clarification.resolved`.
- Feishu webhook verified: challenge request returns challenge response, message event normalizes to command ingest and returns command response.
- Desktop Channels UI verified by `pnpm --filter @ora/desktop typecheck`; `runtimeClient` exposes channel list/create/update/delete/status APIs.
