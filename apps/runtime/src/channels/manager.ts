import crypto from "node:crypto";
import {
  ChannelInboundMessageSchema,
  ChannelIngestParamsSchema,
  ChannelIngestResultSchema,
  ChannelOutboundMessageSchema,
  type ChannelBinding,
  type ChannelConfig,
  type ChannelInboundMessage,
  type ChannelIngestResult,
  type ChannelOutboundMessage,
  type RunEventStream,
  type RunHandle,
  type RunSummary,
  type SessionSummary,
  type StateSnapshot,
} from "@cemeworm/shared";
import { assistantTextForRun } from "../session-title.js";
import { OraRuntimeError } from "../runtime-errors.js";
import { enrichChannelAttachments } from "./attachments.js";
import { handleChannelCommand, parseChannelCommand } from "./commands.js";
import { ChannelMessageBus } from "./message-bus.js";
import { ChannelStore } from "./store.js";

export interface ChannelRunRuntime {
  createSession(params?: unknown): SessionSummary;
  startStreamingRun(params: unknown, options?: { onStream?: (stream: RunEventStream) => void }): Promise<RunHandle>;
  resumeStreamingRun(params: unknown, options?: { onStream?: (stream: RunEventStream) => void }): Promise<RunHandle>;
  cancelRun(params: unknown): StateSnapshot;
  getRunState(params: unknown): StateSnapshot;
  listRuns(params?: unknown): RunSummary[];
}


export interface ChannelManagerOptions {
  clock?: () => number;
  idFactory?: () => string;
  maxBindingQueueSize?: number;
  runTimeoutMs?: number;
  fetchImpl?: typeof fetch;
  maxAttachmentBytes?: number;
  onSessionUpdate?: (event: ChannelSessionUpdateEvent) => void;
}

const FINAL_STATUSES = new Set(["succeeded", "failed", "cancelled", "interrupted"]);

export interface ChannelSessionUpdateEvent {
  channelId: string;
  channelKind: ChannelConfig["kind"];
  bindingId: string;
  sessionId: string;
  runId?: string;
  inboundMessageId: string;
  deliveryId?: string;
}

export class ChannelManager {
  private readonly clock: () => number;
  private readonly idFactory: () => string;
  private readonly maxBindingQueueSize: number;
  private readonly runTimeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly maxAttachmentBytes: number | undefined;
  private readonly onSessionUpdate: ((event: ChannelSessionUpdateEvent) => void) | undefined;
  private readonly bindingQueues = new Map<string, Promise<ChannelIngestResult>>();

  constructor(
    private readonly store: ChannelStore,
    private readonly runtime: ChannelRunRuntime,
    private readonly bus: ChannelMessageBus,
    options: ChannelManagerOptions = {},
  ) {
    this.clock = options.clock ?? Date.now;
    this.idFactory = options.idFactory ?? (() => crypto.randomUUID());
    this.maxBindingQueueSize = options.maxBindingQueueSize ?? 20;
    this.runTimeoutMs = options.runTimeoutMs ?? 60_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.maxAttachmentBytes = options.maxAttachmentBytes;
    this.onSessionUpdate = options.onSessionUpdate;
  }

  async ingest(params: unknown): Promise<ChannelIngestResult> {
    const parsed = ChannelIngestParamsSchema.parse(params);
    const channel = this.store.getConfigOrThrow(parsed.channelId, { redact: false });
    if (!channel.enabled) {
      throw new OraRuntimeError(`Channel '${channel.channelId}' is disabled.`, -32004, { channelId: channel.channelId });
    }
    const inbound = ChannelInboundMessageSchema.parse({
      id: `inbound-${this.idFactory()}`,
      channelId: channel.channelId,
      channelKind: channel.kind,
      externalMessageId: parsed.externalMessageId,
      externalChatId: parsed.externalChatId,
      externalThreadId: parsed.externalThreadId,
      externalUserId: parsed.externalUserId,
      externalUserDisplayName: parsed.externalUserDisplayName,
      type: parsed.type,
      text: parsed.text,
      attachments: parsed.attachments,
      receivedAt: this.clock(),
      raw: parsed.raw,
      metadata: parsed.metadata,
    });

    const recorded = this.store.recordInbound(inbound);
    if (recorded.duplicate) {
      return ChannelIngestResultSchema.parse({
        accepted: true,
        duplicate: true,
        inboundMessageId: recorded.record.messageId,
        bindingId: recorded.record.bindingId,
        sessionId: recorded.record.sessionId,
        runId: recorded.record.runId,
      });
    }

    this.bus.publishInbound(inbound);
    return this.enqueueByExternalKey(inbound, channel);
  }

  queueSizeForBinding(bindingId?: string): number {
    if (!bindingId) {
      return this.bindingQueues.size;
    }
    return this.bindingQueues.has(bindingId) ? 1 : 0;
  }

  private enqueueByExternalKey(inbound: ChannelInboundMessage, channel: ChannelConfig): Promise<ChannelIngestResult> {
    const existingBinding = this.store.findBinding(channel.channelId, inbound.externalChatId, inbound.externalThreadId);
    const queueKey = existingBinding?.bindingId ?? `${channel.channelId}:${inbound.externalChatId}:${inbound.externalThreadId ?? ""}`;
    if (this.bindingQueues.size >= this.maxBindingQueueSize && !this.bindingQueues.has(queueKey)) {
      return this.createBusyResponse(inbound, channel, existingBinding);
    }

    const previous = this.bindingQueues.get(queueKey) ?? Promise.resolve(ChannelIngestResultSchema.parse({
      accepted: true,
      inboundMessageId: inbound.id,
    }));
    const next = previous.catch(() => undefined).then(() => this.processInbound(inbound, channel));
    this.bindingQueues.set(queueKey, next);
    next.finally(() => {
      if (this.bindingQueues.get(queueKey) === next) {
        this.bindingQueues.delete(queueKey);
      }
    });
    return next;
  }

  private async processInbound(inbound: ChannelInboundMessage, channel: ChannelConfig): Promise<ChannelIngestResult> {
    const enrichedInbound = ChannelInboundMessageSchema.parse({
      ...inbound,
      attachments: await enrichChannelAttachments(inbound.attachments, {
        fetchImpl: this.fetchImpl,
        clock: this.clock,
        maxBytes: this.maxAttachmentBytes,
      }),
    });
    const command = enrichedInbound.type === "command" ? parseChannelCommand(enrichedInbound.text) : parseChannelCommand(enrichedInbound.text);
    if (command) {
      return this.processCommand(command, enrichedInbound, channel);
    }

    const binding = this.resolveOrCreateBinding(enrichedInbound, channel);
    const continuation = await this.tryContinueInterruptedRun(enrichedInbound, channel, binding);
    if (continuation) {
      return continuation;
    }
    const input = {
      prompt: enrichedInbound.text,
      context: {
        source: "channel",
        channel: {
          channelId: enrichedInbound.channelId,
          channelKind: enrichedInbound.channelKind,
          bindingId: binding.bindingId,
          externalChatId: enrichedInbound.externalChatId,
          externalThreadId: enrichedInbound.externalThreadId,
          externalUserId: enrichedInbound.externalUserId,
          externalUserDisplayName: enrichedInbound.externalUserDisplayName,
          externalMessageId: enrichedInbound.externalMessageId,
        },
        attachments: enrichedInbound.attachments,
      },
      createdAt: enrichedInbound.receivedAt,
    };

    const runConfig = channelRunConfig(channel);
    const { handle, snapshot } = await this.startAndWaitForRun({ input, config: runConfig, sessionId: binding.sessionId });
    this.store.updateInboundRoute({
      inboundMessageId: enrichedInbound.id,
      channelId: channel.channelId,
      bindingId: binding.bindingId,
      sessionId: binding.sessionId,
      runId: handle.runId,
      payload: enrichedInbound,
    });

    const outbound = this.createOutboundFromSnapshot(enrichedInbound, channel, binding, handle.runId, snapshot);
    const delivery = this.store.createDelivery(outbound, "queued");
    await this.bus.publishOutbound(outbound);
    this.publishSessionUpdate({
      channel,
      binding,
      inboundMessageId: enrichedInbound.id,
      runId: handle.runId,
      deliveryId: delivery.deliveryId,
    });
    return ChannelIngestResultSchema.parse({
      accepted: true,
      duplicate: false,
      inboundMessageId: enrichedInbound.id,
      bindingId: binding.bindingId,
      sessionId: binding.sessionId,
      runId: handle.runId,
      deliveryId: delivery.deliveryId,
      outboundMessage: outbound,
    });
  }

  private async processCommand(command: NonNullable<ReturnType<typeof parseChannelCommand>>, inbound: ChannelInboundMessage, channel: ChannelConfig): Promise<ChannelIngestResult> {
    const existingBinding = this.store.findBinding(channel.channelId, inbound.externalChatId, inbound.externalThreadId);
    const latestRun = existingBinding ? this.runtime.listRuns({ sessionId: existingBinding.sessionId, limit: 1 })[0] : undefined;
    const result = handleChannelCommand(command, {
      channel,
      binding: existingBinding,
      queueSize: this.queueSizeForBinding(existingBinding?.bindingId),
      latestRunId: latestRun?.runId,
      latestRunStatus: latestRun?.status,
    });
    const binding = result.shouldCreateNewSession || !existingBinding
      ? this.createNewBinding(inbound, channel)
      : existingBinding;
    this.store.updateInboundRoute({
      inboundMessageId: inbound.id,
      channelId: channel.channelId,
      bindingId: binding.bindingId,
      sessionId: binding.sessionId,
      payload: inbound,
    });
    const outbound = this.createOutbound(inbound, channel, binding, result.text, "command_response", true);
    const delivery = this.store.createDelivery(outbound, "queued");
    await this.bus.publishOutbound(outbound);
    this.publishSessionUpdate({
      channel,
      binding,
      inboundMessageId: inbound.id,
      deliveryId: delivery.deliveryId,
    });
    return ChannelIngestResultSchema.parse({
      accepted: true,
      duplicate: false,
      inboundMessageId: inbound.id,
      bindingId: binding.bindingId,
      sessionId: binding.sessionId,
      deliveryId: delivery.deliveryId,
      outboundMessage: outbound,
    });
  }

  private resolveOrCreateBinding(inbound: ChannelInboundMessage, channel: ChannelConfig): ChannelBinding {
    return this.store.findBinding(channel.channelId, inbound.externalChatId, inbound.externalThreadId)
      ?? this.createNewBinding(inbound, channel);
  }

  private createNewBinding(inbound: ChannelInboundMessage, channel: ChannelConfig): ChannelBinding {
    const session = this.runtime.createSession({ label: `${channel.label}: ${inbound.externalChatId}` });
    return this.store.createBinding({
      channelId: channel.channelId,
      externalChatId: inbound.externalChatId,
      externalThreadId: inbound.externalThreadId,
      externalUserId: inbound.externalUserId,
      sessionId: session.sessionId,
    });
  }

  private async tryContinueInterruptedRun(
    inbound: ChannelInboundMessage,
    channel: ChannelConfig,
    binding: ChannelBinding,
  ): Promise<ChannelIngestResult | undefined> {
    const latestRun = this.runtime.listRuns({ sessionId: binding.sessionId, limit: 1 })[0];
    if (!latestRun) {
      return undefined;
    }
    const latestSnapshot = this.runtime.getRunState({ runId: latestRun.runId });
    const pendingClarification = latestSnapshot.pendingClarifications[0];
    const pendingApprovalIds = latestSnapshot.pendingApprovals.length > 0
      ? latestSnapshot.pendingApprovals
      : latestSnapshot.actions
        .filter((action) => action.status === "approval_required")
        .map((action) => action.id);
    const trimmed = inbound.text.trim();

    if (pendingApprovalIds.length > 0) {
      if (trimmed === "/deny" || trimmed === "/cancel") {
        const cancelled = this.runtime.cancelRun({ runId: latestRun.runId, reason: "Denied from channel reply." });
        this.store.updateInboundRoute({
          inboundMessageId: inbound.id,
          channelId: channel.channelId,
          bindingId: binding.bindingId,
          sessionId: binding.sessionId,
          runId: latestRun.runId,
          payload: inbound,
        });
        return this.deliverSnapshotReply(inbound, channel, binding, latestRun.runId, cancelled);
      }
      if (trimmed !== "/approve") {
        return undefined;
      }
      const { handle, snapshot } = await this.resumeAndWaitForRun({
        runId: latestRun.runId,
        reason: "Approved from channel reply.",
        patch: { approvedActionIds: pendingApprovalIds },
      });
      this.store.updateInboundRoute({
        inboundMessageId: inbound.id,
        channelId: channel.channelId,
        bindingId: binding.bindingId,
        sessionId: binding.sessionId,
        runId: handle.runId,
        payload: inbound,
      });
      return this.deliverSnapshotReply(inbound, channel, binding, handle.runId, snapshot);
    }

    if (!pendingClarification || trimmed.startsWith("/")) {
      return undefined;
    }
    const { handle, snapshot } = await this.resumeAndWaitForRun({
      runId: latestRun.runId,
      reason: "Clarification answered from channel reply.",
      patch: { clarifications: { [pendingClarification.key]: trimmed } },
    });
    this.store.updateInboundRoute({
      inboundMessageId: inbound.id,
      channelId: channel.channelId,
      bindingId: binding.bindingId,
      sessionId: binding.sessionId,
      runId: handle.runId,
      payload: inbound,
    });
    return this.deliverSnapshotReply(inbound, channel, binding, handle.runId, snapshot);
  }

  private async deliverSnapshotReply(
    inbound: ChannelInboundMessage,
    channel: ChannelConfig,
    binding: ChannelBinding,
    runId: string,
    snapshot: StateSnapshot,
  ): Promise<ChannelIngestResult> {
    const outbound = this.createOutboundFromSnapshot(inbound, channel, binding, runId, snapshot);
    const delivery = this.store.createDelivery(outbound, "queued");
    await this.bus.publishOutbound(outbound);
    this.publishSessionUpdate({
      channel,
      binding,
      inboundMessageId: inbound.id,
      runId,
      deliveryId: delivery.deliveryId,
    });
    return ChannelIngestResultSchema.parse({
      accepted: true,
      duplicate: false,
      inboundMessageId: inbound.id,
      bindingId: binding.bindingId,
      sessionId: binding.sessionId,
      runId,
      deliveryId: delivery.deliveryId,
      outboundMessage: outbound,
    });
  }

  private async startAndWaitForRun(params: unknown): Promise<{ handle: RunHandle; snapshot: StateSnapshot }> {
    let handle: RunHandle | undefined;
    const finalSnapshot = await new Promise<StateSnapshot>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Channel run timed out after ${this.runTimeoutMs}ms.`)), this.runTimeoutMs);
      this.runtime.startStreamingRun(params, {
        onStream: (stream) => {
          if (stream.snapshot && FINAL_STATUSES.has(stream.snapshot.status)) {
            clearTimeout(timer);
            resolve(stream.snapshot);
          }
        },
      }).then((created) => {
        handle = created;
      }).catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
    if (!handle) {
      handle = {
        runId: finalSnapshot.runId,
        sessionId: finalSnapshot.sessionId,
        turnIndex: finalSnapshot.turnIndex,
        status: finalSnapshot.status,
        pattern: finalSnapshot.pattern,
        modeId: finalSnapshot.modeId,
        startedAt: finalSnapshot.updatedAt,
      };
    }
    return { handle, snapshot: finalSnapshot };
  }

  private async resumeAndWaitForRun(params: unknown): Promise<{ handle: RunHandle; snapshot: StateSnapshot }> {
    let handle: RunHandle | undefined;
    const finalSnapshot = await new Promise<StateSnapshot>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Channel resume timed out after ${this.runTimeoutMs}ms.`)), this.runTimeoutMs);
      this.runtime.resumeStreamingRun(params, {
        onStream: (stream) => {
          if (stream.snapshot && FINAL_STATUSES.has(stream.snapshot.status)) {
            clearTimeout(timer);
            resolve(stream.snapshot);
          }
        },
      }).then((created) => {
        handle = created;
      }).catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
    if (!handle) {
      handle = {
        runId: finalSnapshot.runId,
        sessionId: finalSnapshot.sessionId,
        turnIndex: finalSnapshot.turnIndex,
        status: finalSnapshot.status,
        pattern: finalSnapshot.pattern,
        modeId: finalSnapshot.modeId,
        startedAt: finalSnapshot.updatedAt,
      };
    }
    return { handle, snapshot: finalSnapshot };
  }

  private createOutboundFromSnapshot(
    inbound: ChannelInboundMessage,
    channel: ChannelConfig,
    binding: ChannelBinding,
    runId: string,
    snapshot: StateSnapshot,
  ): ChannelOutboundMessage {
    const isError = snapshot.status === "failed" || snapshot.status === "cancelled";
    const text = isError
      ? (snapshot.error || "Ora could not complete this channel request.")
      : (assistantTextForRun(snapshot) || "Ora completed the run without a text response.");
    return this.createOutbound(inbound, channel, binding, text, isError ? "error" : "final", true, runId);
  }

  private createOutbound(
    inbound: ChannelInboundMessage,
    channel: ChannelConfig,
    binding: ChannelBinding,
    text: string,
    kind: ChannelOutboundMessage["kind"],
    isFinal: boolean,
    runId?: string,
  ): ChannelOutboundMessage {
    return ChannelOutboundMessageSchema.parse({
      id: `outbound-${this.idFactory()}`,
      channelId: channel.channelId,
      bindingId: binding.bindingId,
      sessionId: binding.sessionId,
      runId,
      externalChatId: inbound.externalChatId,
      externalThreadId: inbound.externalThreadId,
      inReplyToExternalMessageId: inbound.externalMessageId,
      text,
      isFinal,
      kind,
      attachments: [],
      createdAt: this.clock(),
      metadata: {},
    });
  }

  private async createBusyResponse(inbound: ChannelInboundMessage, channel: ChannelConfig, binding?: ChannelBinding): Promise<ChannelIngestResult> {
    const resolvedBinding = binding ?? this.createNewBinding(inbound, channel);
    const outbound = this.createOutbound(inbound, channel, resolvedBinding, "Ora is busy processing this channel. Please try again shortly.", "error", true);
    const delivery = this.store.createDelivery(outbound, "queued");
    await this.bus.publishOutbound(outbound);
    this.publishSessionUpdate({
      channel,
      binding: resolvedBinding,
      inboundMessageId: inbound.id,
      deliveryId: delivery.deliveryId,
    });
    return ChannelIngestResultSchema.parse({
      accepted: false,
      duplicate: false,
      inboundMessageId: inbound.id,
      bindingId: resolvedBinding.bindingId,
      sessionId: resolvedBinding.sessionId,
      deliveryId: delivery.deliveryId,
      outboundMessage: outbound,
    });
  }

  private publishSessionUpdate(args: {
    channel: ChannelConfig;
    binding: ChannelBinding;
    inboundMessageId: string;
    runId?: string;
    deliveryId?: string;
  }): void {
    this.onSessionUpdate?.({
      channelId: args.channel.channelId,
      channelKind: args.channel.kind,
      bindingId: args.binding.bindingId,
      sessionId: args.binding.sessionId,
      runId: args.runId,
      inboundMessageId: args.inboundMessageId,
      deliveryId: args.deliveryId,
    });
  }
}

function channelRunConfig(channel: ChannelConfig): Record<string, unknown> | undefined {
  const candidate = channel.config.runConfig;
  const existing = candidate && typeof candidate === "object" && !Array.isArray(candidate)
    ? candidate as Record<string, unknown>
    : {};
  const metadata = existing.metadata && typeof existing.metadata === "object" && !Array.isArray(existing.metadata)
    ? existing.metadata as Record<string, unknown>
    : {};
  return {
    modeSelection: "auto",
    permissionMode: "default",
    ...existing,
    metadata: {
      taskIntentMode: "auto",
      ...metadata,
    },
  };
}
