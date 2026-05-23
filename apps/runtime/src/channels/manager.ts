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
  deriveRunAttention,
  type RunEventStream,
  type RunHandle,
  type RunSummary,
  type SessionSummary,
  type ProjectSummary,
  type StateSnapshot,
} from "@cemeworm/shared";
import { assistantTextForRun } from "../session-title.js";
import { OraRuntimeError } from "../runtime-errors.js";
import { enrichChannelAttachments } from "./attachments.js";
import { handleChannelCommand, parseChannelCommand } from "./commands.js";
import { ChannelMessageBus } from "./message-bus.js";
import {
  discoverProjectCandidates,
  formatCandidatePath,
  type ProjectDiscoveryCandidate,
} from "./project-discovery.js";
import { ChannelStore } from "./store.js";

export interface ChannelRunRuntime {
  createSession(params?: unknown): SessionSummary;
  createProject(params?: unknown): { projectId: string };
  getProject(params?: unknown): { project: { rootPath?: string } };
  getSession(params?: unknown): { session: SessionSummary };
  listProjects(params?: unknown): ProjectSummary[];
  setSessionProject(params?: unknown): SessionSummary;
  startStreamingRun(params: unknown, options?: { onStream?: (stream: RunEventStream) => void }): Promise<RunHandle>;
  resumeStreamingRun(params: unknown, options?: { onStream?: (stream: RunEventStream) => void }): Promise<RunHandle>;
  cancelRun(params: unknown): StateSnapshot;
  getRunState(params: unknown): StateSnapshot;
  listRuns(params?: unknown): RunSummary[];
  confirmProjectDiscoverySelection?(params: ProjectDiscoveryConfirmationRequest): Promise<ProjectDiscoveryConfirmationResult>;
}

export interface ProjectDiscoveryConfirmationRequest {
  query?: string;
  candidates: Array<Pick<ProjectDiscoveryCandidate, "label" | "path" | "reason">>;
  runConfig?: Record<string, unknown>;
}

export type ProjectDiscoveryConfirmationResult =
  | { status: "selected"; path: string; reason: string; confidence: number }
  | { status: "none"; reason: string; confidence?: number };


export interface ChannelManagerOptions {
  clock?: () => number;
  idFactory?: () => string;
  maxBindingQueueSize?: number;
  runTimeoutMs?: number;
  fetchImpl?: typeof fetch;
  maxAttachmentBytes?: number;
  onSessionUpdate?: (event: ChannelSessionUpdateEvent) => void;
  streamingThrottleMs?: number;
  streamingMinChars?: number;
}

const FINAL_STATUSES = new Set(["succeeded", "failed", "cancelled", "interrupted"]);
const PENDING_PROJECT_SELECTION_KEY = "pendingProjectSelection";

interface PendingProjectSelection {
  originalPrompt: string;
  query?: string;
  createdAt: number;
  candidates: Array<Pick<ProjectDiscoveryCandidate, "label" | "path" | "reason">>;
}

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
  private readonly streamingThrottleMs: number;
  private readonly streamingMinChars: number;
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
    this.streamingThrottleMs = options.streamingThrottleMs ?? 300;
    this.streamingMinChars = options.streamingMinChars ?? 10;
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
    const projectSelection = await this.tryHandleProjectSelectionReply(enrichedInbound, channel, binding);
    if (projectSelection) {
      return projectSelection;
    }
    const continuation = await this.tryContinueInterruptedRun(enrichedInbound, channel, binding);
    if (continuation) {
      return continuation;
    }
    const resolution = this.resolveProjectForRun(enrichedInbound.text, binding.sessionId);

    const effectivePrompt = resolution.kind === "resolved" && resolution.switched
      ? `[已自动切换工作目录至项目：${this.sessionProjectPath(binding.sessionId)}]\n\n${enrichedInbound.text}`
      : enrichedInbound.text;

    const input = this.channelRunInput(
      enrichedInbound,
      binding,
      effectivePrompt,
      resolution.kind === "resolved" ? resolution.projectId : undefined,
    );

    const runConfig = channelRunConfig(channel);
    const supportsStreaming = channel.capabilities?.supportsStreamingUpdates === true;
    const { handle, snapshot } = await this.startAndWaitForRun(
      { input, config: runConfig, sessionId: binding.sessionId },
      supportsStreaming
        ? {
            onDelta: (text: string) => {
              const delta = this.createOutbound(enrichedInbound, channel, binding, text, "delta", false, handle?.runId);
              void this.bus.publishOutbound(delta);
            },
          }
        : undefined,
    );
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
    const currentProjectPath = existingBinding ? this.sessionProjectPath(existingBinding.sessionId) : undefined;
    const pendingProjectCandidateCount = existingBinding ? pendingProjectSelection(existingBinding)?.candidates.length : undefined;
    const result = handleChannelCommand(command, {
      channel,
      binding: existingBinding,
      queueSize: this.queueSizeForBinding(existingBinding?.bindingId),
      latestRunId: latestRun?.runId,
      latestRunStatus: latestRun?.status,
      currentProjectPath,
      pendingProjectCandidateCount,
    }, inbound.text);
    const binding = result.shouldCreateNewSession || !existingBinding
      ? this.createNewBinding(inbound, channel)
      : existingBinding;
    if (result.shouldDiscoverProject) {
      return this.deliverProjectDiscoveryReply(inbound, channel, binding, {
        originalPrompt: "",
        query: result.projectQuery,
      });
    }
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

  private createNewBinding(inbound: ChannelInboundMessage, channel: ChannelConfig, projectPath?: string): ChannelBinding {
    let projectId: string | undefined;
    if (projectPath) {
      const project = this.runtime.createProject({ rootPath: projectPath });
      projectId = project.projectId;
    } else if (channel.config.defaultProjectPath && typeof channel.config.defaultProjectPath === "string") {
      const project = this.runtime.createProject({ rootPath: channel.config.defaultProjectPath });
      projectId = project.projectId;
    }
    const session = this.runtime.createSession({ label: `${channel.label}: ${inbound.externalChatId}`, projectId });
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
    const attention = latestSnapshot.attention ?? deriveRunAttention(latestSnapshot);
    const pendingClarification = attention.kind === "needs_clarification"
      ? latestSnapshot.pendingClarifications.find((clarification) =>
          attention.pendingClarificationIds.includes(clarification.id)
        )
      : undefined;
    const pendingApprovalIds = attention.kind === "needs_approval"
      ? pendingApprovalActionIds(latestSnapshot, attention.pendingActionIds, attention.pendingToolCallIds)
      : [];
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

  private async startAndWaitForRun(
    params: unknown,
    streaming?: { onDelta: (text: string) => void },
  ): Promise<{ handle: RunHandle; snapshot: StateSnapshot }> {
    let handle: RunHandle | undefined;
    let accumulated = "";
    let lastPublish = 0;
    let finalCheckDone = false;
    const finalSnapshot = await new Promise<StateSnapshot>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Channel run timed out after ${this.runTimeoutMs}ms.`)), this.runTimeoutMs);
      this.runtime.startStreamingRun(params, {
        onStream: (stream) => {
          if (stream.events && streaming?.onDelta) {
            for (const event of stream.events) {
              const delta = extractDeltaText(event);
              if (delta) accumulated += delta;
            }
            const now = this.clock();
            if (accumulated.length >= this.streamingMinChars && (now - lastPublish) >= this.streamingThrottleMs) {
              streaming.onDelta(accumulated);
              lastPublish = now;
            }
          }
          if (stream.snapshot && FINAL_STATUSES.has(stream.snapshot.status)) {
            if (!finalCheckDone) {
              finalCheckDone = true;
              if (streaming?.onDelta && accumulated.length > 0) {
                streaming.onDelta(accumulated);
              }
              clearTimeout(timer);
              resolve(stream.snapshot);
            }
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

  private async tryHandleProjectSelectionReply(
    inbound: ChannelInboundMessage,
    channel: ChannelConfig,
    binding: ChannelBinding,
  ): Promise<ChannelIngestResult | undefined> {
    const pending = pendingProjectSelection(binding);
    if (!pending) {
      return undefined;
    }
    const trimmed = inbound.text.trim();
    if (isNegativeProjectSelection(trimmed)) {
      return this.deliverProjectDiscoveryReply(inbound, channel, binding, {
        originalPrompt: pending.originalPrompt,
        query: `${pending.query ?? pending.originalPrompt} ${trimmed}`,
        excludePaths: pending.candidates.map((candidate) => candidate.path),
      });
    }
    const index = numericSelection(trimmed);
    if (index === undefined) {
      return undefined;
    }
    const selected = pending.candidates[index];
    if (!selected) {
      return this.deliverSimpleReply(
        inbound,
        channel,
        binding,
        `请选择 1-${pending.candidates.length} 之间的数字，或回复“不对”让我重新查找。`,
        "command_response",
      );
    }

    const project = this.runtime.createProject({ rootPath: selected.path, label: selected.label });
    this.runtime.setSessionProject({ sessionId: binding.sessionId, projectId: project.projectId });
    const nextBinding = this.clearPendingProjectSelection(binding);
    if (!pending.originalPrompt.trim()) {
      return this.deliverSimpleReply(
        inbound,
        channel,
        nextBinding,
        `已将当前渠道会话的项目文件夹切换为：${formatCandidatePath(selected.path)}`,
        "command_response",
      );
    }
    const input = this.channelRunInput(inbound, nextBinding, pending.originalPrompt, project.projectId);
    const runConfig = channelRunConfig(channel);
    const { handle, snapshot } = await this.startAndWaitForRun({ input, config: runConfig, sessionId: nextBinding.sessionId });
    this.store.updateInboundRoute({
      inboundMessageId: inbound.id,
      channelId: channel.channelId,
      bindingId: nextBinding.bindingId,
      sessionId: nextBinding.sessionId,
      runId: handle.runId,
      payload: inbound,
    });
    const outbound = this.createOutboundFromSnapshot(inbound, channel, nextBinding, handle.runId, snapshot);
    const delivery = this.store.createDelivery(outbound, "queued");
    await this.bus.publishOutbound(outbound);
    this.publishSessionUpdate({
      channel,
      binding: nextBinding,
      inboundMessageId: inbound.id,
      runId: handle.runId,
      deliveryId: delivery.deliveryId,
    });
    return ChannelIngestResultSchema.parse({
      accepted: true,
      duplicate: false,
      inboundMessageId: inbound.id,
      bindingId: nextBinding.bindingId,
      sessionId: nextBinding.sessionId,
      runId: handle.runId,
      deliveryId: delivery.deliveryId,
      outboundMessage: outbound,
    });
  }

  private async deliverProjectDiscoveryReply(
    inbound: ChannelInboundMessage,
    channel: ChannelConfig,
    binding: ChannelBinding,
    options: { originalPrompt: string; query?: string; excludePaths?: string[] },
  ): Promise<ChannelIngestResult> {
    const excluded = new Set(options.excludePaths ?? []);
    const existingProject = this.matchExistingProject(options.query ?? options.originalPrompt, excluded);
    if (existingProject) {
      return this.bindProjectAndMaybeContinue(inbound, channel, binding, {
        projectId: existingProject.projectId,
        label: existingProject.label,
        rootPath: existingProject.rootPath,
      }, options.originalPrompt);
    }
    const limit = projectDiscoveryLimit(channel);
    const candidates = discoverProjectCandidates({
      query: options.query ?? options.originalPrompt,
      roots: projectDiscoveryRoots(channel),
      limit: limit ? limit + excluded.size : undefined,
    }).filter((candidate) => !excluded.has(candidate.path)).slice(0, limit);
    if (candidates.length === 0) {
      const nextBinding = this.clearPendingProjectSelection(binding);
      return this.deliverSimpleReply(
        inbound,
        channel,
        nextBinding,
        "我没有在本机 Home 目录下找到合适的项目文件夹。你可以换个关键词让我重新找，比如“/project DeepSeek”。",
        "command_response",
      );
    }
    const confirmation = candidates.length > 1
      ? await this.runtime.confirmProjectDiscoverySelection?.({
          query: options.query ?? options.originalPrompt,
          candidates: candidates.map((candidate) => ({
            label: candidate.label,
            path: candidate.path,
            reason: candidate.reason,
          })),
          runConfig: channelRunConfig(channel),
        })
      : undefined;
    if (confirmation?.status === "selected") {
      const selectedCandidate = candidates.find((candidate) => candidate.path === confirmation.path);
      if (selectedCandidate) {
        const existingProject = this.projectByRootPath(selectedCandidate.path);
        if (existingProject) {
          return this.bindProjectAndMaybeContinue(inbound, channel, binding, {
            projectId: existingProject.projectId,
            label: existingProject.label,
            rootPath: existingProject.rootPath,
          }, options.originalPrompt);
        }
        const createdProject = this.runtime.createProject({
          rootPath: selectedCandidate.path,
          label: selectedCandidate.label,
        });
        return this.bindProjectAndMaybeContinue(inbound, channel, binding, {
          projectId: createdProject.projectId,
          label: selectedCandidate.label,
          rootPath: selectedCandidate.path,
        }, options.originalPrompt);
      }
    }

    const pending: PendingProjectSelection = {
      originalPrompt: options.originalPrompt,
      query: options.query,
      createdAt: this.clock(),
      candidates: candidates.map((candidate) => ({
        label: candidate.label,
        path: candidate.path,
        reason: candidate.reason,
      })),
    };
    const nextBinding = this.store.updateBindingMetadata(binding, {
      ...binding.metadata,
      [PENDING_PROJECT_SELECTION_KEY]: pending,
    });
    const text = [
      "我找到了这些可能的项目文件夹，请回复数字确认：",
      ...pending.candidates.map((candidate, index) =>
        `${index + 1}. ${candidate.label} - ${formatCandidatePath(candidate.path)} (${candidate.reason})`
      ),
      "如果都不对，回复“不对”或用 /project 加关键词让我重新找。",
    ].join("\n");
    return this.deliverSimpleReply(inbound, channel, nextBinding, text, "command_response");
  }

  private async bindProjectAndMaybeContinue(
    inbound: ChannelInboundMessage,
    channel: ChannelConfig,
    binding: ChannelBinding,
    project: { projectId: string; label: string; rootPath?: string },
    originalPrompt: string,
  ): Promise<ChannelIngestResult> {
    this.runtime.setSessionProject({ sessionId: binding.sessionId, projectId: project.projectId });
    const nextBinding = this.clearPendingProjectSelection(binding);
    if (!originalPrompt.trim()) {
      return this.deliverSimpleReply(
        inbound,
        channel,
        nextBinding,
        `已将当前渠道会话的项目文件夹切换为：${formatCandidatePath(project.rootPath ?? project.label)}`,
        "command_response",
      );
    }
    const input = this.channelRunInput(inbound, nextBinding, originalPrompt, project.projectId);
    const runConfig = channelRunConfig(channel);
    const { handle, snapshot } = await this.startAndWaitForRun({ input, config: runConfig, sessionId: nextBinding.sessionId });
    this.store.updateInboundRoute({
      inboundMessageId: inbound.id,
      channelId: channel.channelId,
      bindingId: nextBinding.bindingId,
      sessionId: nextBinding.sessionId,
      runId: handle.runId,
      payload: inbound,
    });
    const outbound = this.createOutboundFromSnapshot(inbound, channel, nextBinding, handle.runId, snapshot);
    const delivery = this.store.createDelivery(outbound, "queued");
    await this.bus.publishOutbound(outbound);
    this.publishSessionUpdate({
      channel,
      binding: nextBinding,
      inboundMessageId: inbound.id,
      runId: handle.runId,
      deliveryId: delivery.deliveryId,
    });
    return ChannelIngestResultSchema.parse({
      accepted: true,
      duplicate: false,
      inboundMessageId: inbound.id,
      bindingId: nextBinding.bindingId,
      sessionId: nextBinding.sessionId,
      runId: handle.runId,
      deliveryId: delivery.deliveryId,
      outboundMessage: outbound,
    });
  }

  private async deliverSimpleReply(
    inbound: ChannelInboundMessage,
    channel: ChannelConfig,
    binding: ChannelBinding,
    text: string,
    kind: ChannelOutboundMessage["kind"],
  ): Promise<ChannelIngestResult> {
    this.store.updateInboundRoute({
      inboundMessageId: inbound.id,
      channelId: channel.channelId,
      bindingId: binding.bindingId,
      sessionId: binding.sessionId,
      payload: inbound,
    });
    const outbound = this.createOutbound(inbound, channel, binding, text, kind, true);
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

  private clearPendingProjectSelection(binding: ChannelBinding): ChannelBinding {
    if (!(PENDING_PROJECT_SELECTION_KEY in binding.metadata)) {
      return binding;
    }
    const metadata = { ...binding.metadata };
    delete metadata[PENDING_PROJECT_SELECTION_KEY];
    return this.store.updateBindingMetadata(binding, metadata);
  }

  private channelRunInput(
    inbound: ChannelInboundMessage,
    binding: ChannelBinding,
    prompt: string,
    projectId?: string,
  ) {
    return {
      prompt,
      ...(projectId ? { projectId } : {}),
      context: {
        source: "channel",
        channel: {
          channelId: inbound.channelId,
          channelKind: inbound.channelKind,
          bindingId: binding.bindingId,
          externalChatId: inbound.externalChatId,
          externalThreadId: inbound.externalThreadId,
          externalUserId: inbound.externalUserId,
          externalUserDisplayName: inbound.externalUserDisplayName,
          externalMessageId: inbound.externalMessageId,
        },
        attachments: inbound.attachments,
      },
      createdAt: inbound.receivedAt,
    };
  }

  private sessionProjectId(sessionId: string): string | undefined {
    return this.runtime.getSession({ sessionId, includeLatestSnapshot: false }).session.projectId;
  }

  private sessionProjectPath(sessionId: string): string | undefined {
    const projectId = this.sessionProjectId(sessionId);
    if (!projectId) {
      return undefined;
    }
    try {
      return this.runtime.getProject({ projectId }).project.rootPath;
    } catch {
      return projectId;
    }
  }

  private resolveProjectForRun(
    _text: string,
    sessionId: string,
  ):
    | { kind: "resolved"; projectId: string; switched: boolean }
    | { kind: "none" }
  {
    const currentProjectId = this.sessionProjectId(sessionId);
    if (currentProjectId) {
      return { kind: "resolved", projectId: currentProjectId, switched: false };
    }

    return { kind: "none" };
  }

  private matchExistingProject(query: string | undefined, excludedPaths: Set<string>): ProjectSummary | undefined {
    const projects = this.runtime.listProjects({ limit: 500 })
      .filter((project) => project.rootPath && !excludedPaths.has(project.rootPath));
    if (projects.length === 1) {
      return projects[0];
    }
    const terms = projectQueryTerms(query);
    if (terms.length === 0) {
      return undefined;
    }
    const matches = projects
      .map((project) => ({ project, score: existingProjectScore(project, terms) }))
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score || (left.project.rootPath ?? "").length - (right.project.rootPath ?? "").length);
    if (matches.length === 0) {
      return undefined;
    }
    return matches.length === 1 || matches[0]!.score > matches[1]!.score
      ? matches[0]!.project
      : undefined;
  }

  private projectByRootPath(rootPath: string): ProjectSummary | undefined {
    const resolved = rootPath.trim();
    if (!resolved) {
      return undefined;
    }
    return this.runtime.listProjects({ limit: 500 })
      .find((project) => project.rootPath === resolved);
  }
}

function pendingProjectSelection(binding: ChannelBinding): PendingProjectSelection | undefined {
  const candidate = binding.metadata[PENDING_PROJECT_SELECTION_KEY];
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return undefined;
  }
  const record = candidate as Record<string, unknown>;
  if (typeof record.originalPrompt !== "string" || !Array.isArray(record.candidates)) {
    return undefined;
  }
  const candidates = record.candidates
    .map((item) => item && typeof item === "object" && !Array.isArray(item) ? item as Record<string, unknown> : undefined)
    .filter((item): item is Record<string, unknown> => item !== undefined)
    .map((item) => ({
      label: typeof item.label === "string" ? item.label : "",
      path: typeof item.path === "string" ? item.path : "",
      reason: typeof item.reason === "string" ? item.reason : "matches the request",
    }))
    .filter((item) => item.label && item.path);
  if (candidates.length === 0) {
    return undefined;
  }
  return {
    originalPrompt: record.originalPrompt,
    query: typeof record.query === "string" ? record.query : undefined,
    createdAt: typeof record.createdAt === "number" ? record.createdAt : 0,
    candidates,
  };
}

function numericSelection(text: string): number | undefined {
  const match = /^#?\s*(\d{1,2})\s*$/.exec(text);
  if (!match) {
    return undefined;
  }
  return Number(match[1]) - 1;
}

function isNegativeProjectSelection(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  return ["不对", "都不是", "不是", "错误", "wrong", "no", "none"].includes(normalized);
}

function projectDiscoveryRoots(channel: ChannelConfig): string[] | undefined {
  const roots = channel.config.projectDiscoveryRoots;
  if (!Array.isArray(roots)) {
    return undefined;
  }
  const strings = roots.filter((root): root is string => typeof root === "string" && root.trim().length > 0);
  return strings.length > 0 ? strings : undefined;
}

function projectDiscoveryLimit(channel: ChannelConfig): number | undefined {
  const limit = channel.config.projectDiscoveryLimit;
  return typeof limit === "number" && Number.isInteger(limit) && limit > 0 ? limit : undefined;
}

function projectQueryTerms(query: string | undefined): string[] {
  return (query ?? "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}_-]+/u)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2 && !["project", "vault", "obsidian", "file", "files", "search", "local", "本地", "文件", "搜索"].includes(term));
}

function existingProjectScore(project: ProjectSummary, terms: string[]): number {
  const haystack = `${project.label} ${project.rootPath ?? ""}`.toLowerCase();
  return terms.reduce((score, term) => score + (haystack.includes(term) ? 1 : 0), 0);
}

function pendingApprovalActionIds(
  snapshot: StateSnapshot,
  pendingActionIds: readonly string[],
  pendingToolCallIds: readonly string[],
): string[] {
  const approvedIds = new Set(pendingActionIds);
  for (const toolCallId of pendingToolCallIds) {
    const toolCall = snapshot.toolCalls.find((call) => call.id === toolCallId);
    if (toolCall?.actionId) {
      approvedIds.add(toolCall.actionId);
    }
  }
  return snapshot.actions
    .filter((action) => action.status === "approval_required" && approvedIds.has(action.id))
    .map((action) => action.id);
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

function extractDeltaText(event: { type?: string; payload?: unknown }): string {
  if (typeof event.type !== "string") return "";
  if (event.type !== "message.delta" && event.type !== "token.delta") return "";
  const payload = event.payload;
  if (!payload || typeof payload !== "object") return "";
  const record = payload as Record<string, unknown>;
  if (typeof record.delta === "string" && record.delta.length > 0) return record.delta;
  if (typeof record.content === "string" && record.content.length > 0) return record.content;
  return "";
}
