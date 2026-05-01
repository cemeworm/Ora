import { z } from "zod";
import { ActionRecordSchema, OraToolCallEnvelopeSchema, PlanItemSchema, PlanListStepSchema, PolicyDecisionSchema, TodoItemSchema } from "./actions.js";
import { SearchProviderConfigSchema } from "./capabilities.js";
import { MemoryRecordSchema } from "./memory.js";
import { ModeSpecSchema, ModeTranscriptLayoutSchema } from "./modes.js";
import { PermissionModeSchema } from "./config.js";
import { AgentProfileSchema, CoordinationKindSchema, CoordinationPatternSchema, ModeBudgetProfileSchema, ModeCompletionPolicySchema, ModeDelegationSchema, ModeIdSchema, ModePlanningSchema, ModeReasoningEffortSchema, ModeThinkingSchema, ResourceBudgetSchema, RunStatusSchema } from "./primitives.js";
import { ProviderConfigSchema } from "./providers.js";
import { TopologyEdgeSchema, TopologyNodeSchema } from "./topology.js";

export const UserTaskInputSchema = z.object({
  taskId: z.string().min(1).optional(),
  prompt: z.string().min(1),
  projectId: z.string().min(1).optional(),
  context: z.record(z.unknown()).default({}),
  createdAt: z.number().int().nonnegative().optional()
});
export type UserTaskInput = z.infer<typeof UserTaskInputSchema>;

export const ModeSelectionSchema = z.enum(["manual", "auto"]);
export type ModeSelection = z.infer<typeof ModeSelectionSchema>;

export const TaskIntentSchema = z.enum(["chat", "plan", "implement"]);
export type TaskIntent = z.infer<typeof TaskIntentSchema>;

export const ProviderPolicyStatusSchema = z.enum(["applied", "unsupported", "degraded"]);
export type ProviderPolicyStatus = z.infer<typeof ProviderPolicyStatusSchema>;

export const EffectiveRunStrategySchema = z.object({
  sourceModeId: ModeIdSchema,
  sourceModeSelection: ModeSelectionSchema,
  thinking: ModeThinkingSchema,
  reasoningEffort: ModeReasoningEffortSchema.optional(),
  budgetProfile: ModeBudgetProfileSchema,
  budget: ResourceBudgetSchema,
  planning: ModePlanningSchema,
  planningEnabled: z.boolean(),
  delegation: ModeDelegationSchema,
  delegationEnabled: z.boolean(),
  providerThinkingEnabled: z.boolean(),
  providerPolicyStatus: ProviderPolicyStatusSchema,
  notes: z.array(z.string().min(1)).default([]),
});
export type EffectiveRunStrategy = z.infer<typeof EffectiveRunStrategySchema>;


export const ChannelKindSchema = z.enum([
  "http_webhook",
  "slack",
  "feishu",
  "wechat",
  "wecom",
  "telegram",
  "discord",
  "dingtalk"
]);
export type ChannelKind = z.infer<typeof ChannelKindSchema>;

export const ChannelCapabilitiesSchema = z.object({
  supportsStreamingUpdates: z.boolean().default(false),
  supportsThreadReplies: z.boolean().default(false),
  supportsReactions: z.boolean().default(false),
  supportsFileInbound: z.boolean().default(false),
  supportsFileOutbound: z.boolean().default(false),
  supportsMessageUpdate: z.boolean().default(false)
});
export type ChannelCapabilities = z.infer<typeof ChannelCapabilitiesSchema>;

export const ChannelStatusStateSchema = z.enum(["stopped", "starting", "running", "stopping", "failed"]);
export type ChannelStatusState = z.infer<typeof ChannelStatusStateSchema>;

export const ChannelConfigSchema = z.object({
  channelId: z.string().min(1),
  kind: ChannelKindSchema,
  label: z.string().min(1),
  enabled: z.boolean().default(true),
  capabilities: ChannelCapabilitiesSchema.default({}),
  config: z.record(z.unknown()).default({}),
  secretRefs: z.record(z.string().min(1)).default({}),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative()
});
export type ChannelConfig = z.infer<typeof ChannelConfigSchema>;

export const ChannelStatusSchema = z.object({
  channelId: z.string().min(1),
  kind: ChannelKindSchema,
  label: z.string().min(1),
  enabled: z.boolean(),
  state: ChannelStatusStateSchema,
  detail: z.string().min(1).optional(),
  queueSize: z.number().int().nonnegative().default(0),
  runningCount: z.number().int().nonnegative().default(0),
  updatedAt: z.number().int().nonnegative()
});
export type ChannelStatus = z.infer<typeof ChannelStatusSchema>;

export const ChannelAttachmentSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["file", "image", "audio", "video", "link", "unknown"]).default("unknown"),
  name: z.string().min(1).optional(),
  mimeType: z.string().min(1).optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
  url: z.string().min(1).optional(),
  metadata: z.record(z.unknown()).default({})
});
export type ChannelAttachment = z.infer<typeof ChannelAttachmentSchema>;

export const ChannelInboundTypeSchema = z.enum(["chat", "command", "event"]);
export type ChannelInboundType = z.infer<typeof ChannelInboundTypeSchema>;

export const ChannelInboundMessageSchema = z.object({
  id: z.string().min(1),
  channelId: z.string().min(1),
  channelKind: ChannelKindSchema,
  externalMessageId: z.string().min(1),
  externalChatId: z.string().min(1),
  externalThreadId: z.string().min(1).optional(),
  externalUserId: z.string().min(1).optional(),
  externalUserDisplayName: z.string().min(1).optional(),
  type: ChannelInboundTypeSchema.default("chat"),
  text: z.string().default(""),
  attachments: z.array(ChannelAttachmentSchema).default([]),
  receivedAt: z.number().int().nonnegative(),
  raw: z.unknown().optional(),
  metadata: z.record(z.unknown()).default({})
});
export type ChannelInboundMessage = z.infer<typeof ChannelInboundMessageSchema>;

export const ChannelOutboundKindSchema = z.enum(["status", "delta", "final", "error", "command_response"]);
export type ChannelOutboundKind = z.infer<typeof ChannelOutboundKindSchema>;

export const ChannelOutboundMessageSchema = z.object({
  id: z.string().min(1),
  channelId: z.string().min(1),
  bindingId: z.string().min(1),
  sessionId: z.string().min(1),
  runId: z.string().min(1).optional(),
  externalChatId: z.string().min(1),
  externalThreadId: z.string().min(1).optional(),
  inReplyToExternalMessageId: z.string().min(1).optional(),
  text: z.string().default(""),
  isFinal: z.boolean(),
  kind: ChannelOutboundKindSchema,
  attachments: z.array(ChannelAttachmentSchema).default([]),
  createdAt: z.number().int().nonnegative(),
  metadata: z.record(z.unknown()).default({})
});
export type ChannelOutboundMessage = z.infer<typeof ChannelOutboundMessageSchema>;

export const ChannelBindingSchema = z.object({
  bindingId: z.string().min(1),
  channelId: z.string().min(1),
  externalChatId: z.string().min(1),
  externalThreadId: z.string().min(1).optional(),
  sessionId: z.string().min(1),
  externalUserId: z.string().min(1).optional(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  metadata: z.record(z.unknown()).default({})
});
export type ChannelBinding = z.infer<typeof ChannelBindingSchema>;

export const ChannelMessageDirectionSchema = z.enum(["inbound", "outbound"]);
export type ChannelMessageDirection = z.infer<typeof ChannelMessageDirectionSchema>;

export const ChannelMessageRecordTypeSchema = z.enum([
  "chat",
  "command",
  "event",
  "status",
  "delta",
  "final",
  "error",
  "command_response"
]);
export type ChannelMessageRecordType = z.infer<typeof ChannelMessageRecordTypeSchema>;

export const ChannelMessageRecordSchema = z.object({
  messageId: z.string().min(1),
  channelId: z.string().min(1),
  bindingId: z.string().min(1).optional(),
  sessionId: z.string().min(1).optional(),
  runId: z.string().min(1).optional(),
  direction: ChannelMessageDirectionSchema,
  externalMessageId: z.string().min(1).optional(),
  type: ChannelMessageRecordTypeSchema,
  payload: z.unknown(),
  createdAt: z.number().int().nonnegative()
});
export type ChannelMessageRecord = z.infer<typeof ChannelMessageRecordSchema>;

export const ChannelDeliveryStatusSchema = z.enum(["queued", "sending", "sent", "retry_scheduled", "failed"]);
export type ChannelDeliveryStatus = z.infer<typeof ChannelDeliveryStatusSchema>;

export const ChannelDeliverySchema = z.object({
  deliveryId: z.string().min(1),
  channelId: z.string().min(1),
  outboundMessageId: z.string().min(1),
  sessionId: z.string().min(1).optional(),
  runId: z.string().min(1).optional(),
  status: ChannelDeliveryStatusSchema,
  attemptCount: z.number().int().nonnegative(),
  nextAttemptAt: z.number().int().nonnegative().optional(),
  lastError: z.string().optional(),
  message: ChannelOutboundMessageSchema,
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative()
});
export type ChannelDelivery = z.infer<typeof ChannelDeliverySchema>;

export const ChannelCreateParamsSchema = z.object({
  channelId: z.string().min(1).optional(),
  kind: ChannelKindSchema.default("http_webhook"),
  label: z.string().min(1),
  enabled: z.boolean().default(true),
  capabilities: ChannelCapabilitiesSchema.partial().optional(),
  config: z.record(z.unknown()).default({}),
  secretRefs: z.record(z.string().min(1)).default({})
});
export type ChannelCreateParams = z.infer<typeof ChannelCreateParamsSchema>;

export const ChannelUpdateParamsSchema = z.object({
  channelId: z.string().min(1),
  label: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
  capabilities: ChannelCapabilitiesSchema.partial().optional(),
  config: z.record(z.unknown()).optional(),
  secretRefs: z.record(z.string().min(1)).optional()
});
export type ChannelUpdateParams = z.infer<typeof ChannelUpdateParamsSchema>;

export const ChannelGetParamsSchema = z.object({ channelId: z.string().min(1) });
export type ChannelGetParams = z.infer<typeof ChannelGetParamsSchema>;

export const ChannelListParamsSchema = z.object({
  kind: ChannelKindSchema.optional(),
  enabled: z.boolean().optional(),
  limit: z.number().int().positive().max(500).optional()
});
export type ChannelListParams = z.infer<typeof ChannelListParamsSchema>;

export const ChannelLifecycleParamsSchema = z.object({ channelId: z.string().min(1) });
export type ChannelLifecycleParams = z.infer<typeof ChannelLifecycleParamsSchema>;

export const ChannelIngestParamsSchema = z.object({
  channelId: z.string().min(1),
  externalMessageId: z.string().min(1),
  externalChatId: z.string().min(1),
  externalThreadId: z.string().min(1).optional(),
  externalUserId: z.string().min(1).optional(),
  externalUserDisplayName: z.string().min(1).optional(),
  type: ChannelInboundTypeSchema.default("chat"),
  text: z.string().default(""),
  attachments: z.array(ChannelAttachmentSchema).default([]),
  metadata: z.record(z.unknown()).default({}),
  raw: z.unknown().optional()
});
export type ChannelIngestParams = z.infer<typeof ChannelIngestParamsSchema>;

export const ChannelIngestResultSchema = z.object({
  accepted: z.boolean(),
  duplicate: z.boolean().default(false),
  inboundMessageId: z.string().min(1),
  bindingId: z.string().min(1).optional(),
  sessionId: z.string().min(1).optional(),
  runId: z.string().min(1).optional(),
  deliveryId: z.string().min(1).optional(),
  outboundMessage: ChannelOutboundMessageSchema.optional()
});
export type ChannelIngestResult = z.infer<typeof ChannelIngestResultSchema>;

export const ChannelStatusResultSchema = z.object({
  channels: z.array(ChannelStatusSchema),
  bus: z.object({
    inboundQueueSize: z.number().int().nonnegative().default(0),
    inboundPublishedCount: z.number().int().nonnegative().default(0),
    outboundPublishedCount: z.number().int().nonnegative().default(0),
    outboundSubscriberFailures: z.number().int().nonnegative().default(0)
  }).default({})
});
export type ChannelStatusResult = z.infer<typeof ChannelStatusResultSchema>;

export const ChannelBindingsListParamsSchema = z.object({
  channelId: z.string().min(1).optional(),
  externalChatId: z.string().min(1).optional(),
  sessionId: z.string().min(1).optional(),
  limit: z.number().int().positive().max(500).optional()
});
export type ChannelBindingsListParams = z.infer<typeof ChannelBindingsListParamsSchema>;

export const ChannelDeliveriesListParamsSchema = z.object({
  channelId: z.string().min(1).optional(),
  status: ChannelDeliveryStatusSchema.optional(),
  sessionId: z.string().min(1).optional(),
  runId: z.string().min(1).optional(),
  limit: z.number().int().positive().max(500).optional()
});
export type ChannelDeliveriesListParams = z.infer<typeof ChannelDeliveriesListParamsSchema>;

export const ChannelDeliveryRetryParamsSchema = z.object({
  deliveryId: z.string().min(1)
});
export type ChannelDeliveryRetryParams = z.infer<typeof ChannelDeliveryRetryParamsSchema>;

export const RunConfigSchema = z.object({
  pattern: CoordinationPatternSchema.default("orchestrator_subagent"),
  modeId: ModeIdSchema.optional(),
  modeSelection: ModeSelectionSchema.default("manual"),
  profileIds: z.array(z.string().min(1)).default([]),
  providerId: z.string().min(1).optional(),
  providerConfig: z.lazy(() => ProviderConfigSchema).optional(),
  customAgentId: z.string().min(1).optional(),
  modelRef: z.string().min(1).default("local/smoke-model"),
  budget: ResourceBudgetSchema.optional(),
  completionPolicy: ModeCompletionPolicySchema.optional(),
  effectiveStrategy: EffectiveRunStrategySchema.optional(),
  skillIds: z.array(z.string().min(1)).default([]),
  toolIds: z.array(z.string().min(1)).default([]),
  searchProvider: SearchProviderConfigSchema.optional(),
  approvalMode: z.enum(["auto", "manual", "high_risk_only"]).default("high_risk_only"),
  permissionMode: PermissionModeSchema.default("default"),
  patternOptions: z.record(z.unknown()).default({}),
  metadata: z.record(z.unknown()).default({}),
  deterministicSeed: z.string().min(1).default("ora-smoke")
});
export type RunConfig = z.infer<typeof RunConfigSchema>;

export const RunHandleSchema = z.object({
  runId: z.string().min(1),
  sessionId: z.string().min(1).optional(),
  turnIndex: z.number().int().positive().optional(),
  status: RunStatusSchema,
  pattern: CoordinationPatternSchema,
  modeId: ModeIdSchema.optional(),
  startedAt: z.number().int().nonnegative()
});
export type RunHandle = z.infer<typeof RunHandleSchema>;

export const RunSummarySchema = z.object({
  runId: z.string().min(1),
  sessionId: z.string().min(1).optional(),
  turnIndex: z.number().int().positive().optional(),
  status: RunStatusSchema,
  pattern: CoordinationPatternSchema,
  modeId: ModeIdSchema.optional(),
  prompt: z.string().min(1),
  startedAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  eventCount: z.number().int().nonnegative(),
  checkpointCount: z.number().int().nonnegative(),
  artifactCount: z.number().int().nonnegative()
});
export type RunSummary = z.infer<typeof RunSummarySchema>;

export const CheckpointMetaSchema = z.object({
  id: z.string().min(1),
  runId: z.string().min(1),
  label: z.string().min(1),
  createdAt: z.number().int().nonnegative(),
  eventSeq: z.number().int().nonnegative(),
  stateHash: z.string().min(1).optional()
});
export type CheckpointMeta = z.infer<typeof CheckpointMetaSchema>;

export const OraEventTypeSchema = z.enum([
  "run.started",
  "run.resumed",
  "run.forked",
  "run.replayed",
  "agent.started",
  "agent.completed",
  "topology.updated",
  "profile.updated",
  "memory.queued",
  "memory.updated",
  "memory.flushed",
  "plan.updated",
  "todo.updated",
  "action.updated",
  "task.started",
  "task.progress",
  "task.completed",
  "task.failed",
  "clarification.required",
  "clarification.resolved",
  "approval.required",
  "approval.resolved",
  "tool.called",
  "tool.repaired",
  "message.delta",
  "agent.message",
  "message.published",
  "message.routed",
  "token.delta",
  "queue.updated",
  "shared_state.updated",
  "worker.claimed",
  "worker.released",
  "checkpoint.created",
  "artifact.exported",
  "artifact.degraded",
  "completion.updated",
  "node.updated",
  "recovery.detected",
  "recovery.retry_scheduled",
  "recovery.applied",
  "recovery.exhausted",
  "node.skipped",
  "run.interrupted",
  "run.cancelled",
  "run.done",
  "run.failed",
  "plan_list.updated"
]);
export type OraEventType = z.infer<typeof OraEventTypeSchema>;

export const OraEventEnvelopeSchema = z.object({
  id: z.string().min(1),
  runId: z.string().min(1),
  seq: z.number().int().nonnegative(),
  type: OraEventTypeSchema,
  createdAt: z.number().int().nonnegative(),
  pattern: CoordinationPatternSchema.optional(),
  nodeId: z.string().min(1).optional(),
  agentId: z.string().min(1).optional(),
  checkpointId: z.string().min(1).optional(),
  payload: z.unknown()
});
export type OraEventEnvelope = z.infer<typeof OraEventEnvelopeSchema>;

export const AgentConversationMessageKindSchema = z.enum([
  "mention",
  "reply",
  "handoff",
  "route",
  "publish",
  "status",
]);
export type AgentConversationMessageKind = z.infer<typeof AgentConversationMessageKindSchema>;

export const AgentConversationMessageStatusSchema = z.enum([
  "sent",
  "running",
  "done",
  "failed",
]);
export type AgentConversationMessageStatus = z.infer<typeof AgentConversationMessageStatusSchema>;

export const AgentConversationTranscriptStanceSchema = z.string().min(1);
export type AgentConversationTranscriptStance = z.infer<typeof AgentConversationTranscriptStanceSchema>;

export const AgentConversationTranscriptSchema = z.object({
  kind: z.literal("stage_transcript").default("stage_transcript"),
  groupId: z.string().min(1),
  groupLabel: z.string().min(1).optional(),
  stageId: z.string().min(1),
  stageLabel: z.string().min(1),
  sequence: z.number().int().nonnegative(),
  speakerLabel: z.string().min(1),
  speakerId: z.string().min(1).optional(),
  stance: AgentConversationTranscriptStanceSchema.default("neutral"),
  status: AgentConversationMessageStatusSchema.default("done"),
  layout: ModeTranscriptLayoutSchema.optional(),
});
export type AgentConversationTranscript = z.infer<typeof AgentConversationTranscriptSchema>;

export const AgentConversationMessageSchema = z.object({
  id: z.string().min(1),
  runId: z.string().min(1),
  createdAt: z.number().int().nonnegative(),
  fromAgentId: z.string().min(1),
  toAgentIds: z.array(z.string().min(1)).default([]),
  replyToId: z.string().min(1).optional(),
  threadId: z.string().min(1),
  nodeId: z.string().min(1).optional(),
  planItemId: z.string().min(1).optional(),
  kind: AgentConversationMessageKindSchema,
  status: AgentConversationMessageStatusSchema.default("sent"),
  content: z.string().min(1),
  topic: z.string().min(1).optional(),
  correlationId: z.string().min(1).optional(),
  artifactIds: z.array(z.string().min(1)).default([]),
  transcript: AgentConversationTranscriptSchema.optional(),
});
export type AgentConversationMessage = z.infer<typeof AgentConversationMessageSchema>;

export const ArtifactRefSchema = z.object({
  id: z.string().min(1),
  runId: z.string().min(1),
  kind: z.enum(["report", "file", "log"]),
  label: z.string().min(1),
  mimeType: z.string().min(1),
  createdAt: z.number().int().nonnegative(),
  uri: z.string().min(1).optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
  payload: z.unknown().optional()
});
export type ArtifactRef = z.infer<typeof ArtifactRefSchema>;

export const RunContinuationStatusSchema = z.enum([
  "none",
  "paused",
  "resuming",
  "executing_tool",
  "awaiting_model",
  "completed",
  "failed",
]);
export type RunContinuationStatus = z.infer<typeof RunContinuationStatusSchema>;

export const RunContinuationReasonSchema = z.enum([
  "approval_required",
  "clarification_required",
  "tool_interrupted",
  "tool_failed",
  "provider_failed",
  "manual_interrupt",
  "fork",
  "replay",
]);
export type RunContinuationReason = z.infer<typeof RunContinuationReasonSchema>;

export const RunContinuationFrameSchema = z.object({
  id: z.string().min(1),
  runId: z.string().min(1),
  status: RunContinuationStatusSchema,
  reason: RunContinuationReasonSchema,
  agentId: z.string().min(1).optional(),
  nodeId: z.string().min(1).optional(),
  planItemId: z.string().min(1).optional(),
  modelIteration: z.number().int().nonnegative().optional(),
  conversationCursor: z.number().int().nonnegative().default(0),
  pendingActionIds: z.array(z.string().min(1)).default([]),
  pendingToolCallIds: z.array(z.string().min(1)).default([]),
  pendingClarificationIds: z.array(z.string().min(1)).default([]),
  approvedActionIds: z.array(z.string().min(1)).default([]),
  resolvedClarificationIds: z.array(z.string().min(1)).default([]),
  resumedFromFrameId: z.string().min(1).optional(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});
export type RunContinuationFrame = z.infer<typeof RunContinuationFrameSchema>;

export const RunContinuationSchema = z.object({
  activeFrameId: z.string().min(1).optional(),
  frames: z.array(RunContinuationFrameSchema).default([]),
});
export type RunContinuation = z.infer<typeof RunContinuationSchema>;

export const RuntimeConversationToolCallRefSchema = z.object({
  id: z.string().min(1),
  providerCallId: z.string().min(1).optional(),
  toolId: z.string().min(1),
  args: z.record(z.unknown()).default({}),
});
export type RuntimeConversationToolCallRef = z.infer<typeof RuntimeConversationToolCallRefSchema>;

export const RuntimeConversationEntrySchema = z.discriminatedUnion("role", [
  z.object({
    role: z.literal("system"),
    content: z.string().default(""),
    createdAt: z.number().int().nonnegative(),
  }),
  z.object({
    role: z.literal("user"),
    content: z.string(),
    createdAt: z.number().int().nonnegative(),
  }),
  z.object({
    role: z.literal("assistant"),
    content: z.string(),
    toolCalls: z.array(RuntimeConversationToolCallRefSchema).default([]),
    providerMessageId: z.string().min(1).optional(),
    createdAt: z.number().int().nonnegative(),
  }),
  z.object({
    role: z.literal("tool"),
    toolCallId: z.string().min(1),
    providerCallId: z.string().min(1).optional(),
    toolId: z.string().min(1),
    content: z.string(),
    status: z.enum(["succeeded", "failed", "interrupted", "denied"]),
    createdAt: z.number().int().nonnegative(),
  }),
]);
export type RuntimeConversationEntry = z.infer<typeof RuntimeConversationEntrySchema>;

export const RuntimeToolResultLedgerEntrySchema = z.object({
  key: z.string().min(1),
  toolId: z.string().min(1),
  argsDigest: z.string().min(1),
  resultToolCallId: z.string().min(1),
  status: z.enum(["succeeded", "failed", "interrupted", "denied"]),
  output: z.unknown().optional(),
  error: z.string().optional(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});
export type RuntimeToolResultLedgerEntry = z.infer<typeof RuntimeToolResultLedgerEntrySchema>;

export const RunEventStreamSchema = z.object({
  runId: z.string().min(1),
  fromSeq: z.number().int().nonnegative(),
  events: z.array(OraEventEnvelopeSchema),
  nextSeq: z.number().int().nonnegative(),
  status: RunStatusSchema.optional(),
  snapshot: z.lazy(() => StateSnapshotSchema).optional()
});
export type RunEventStream = z.infer<typeof RunEventStreamSchema>;

export const RunsListParamsSchema = z.object({
  status: RunStatusSchema.optional(),
  sessionId: z.string().min(1).optional(),
  limit: z.number().int().positive().max(500).optional()
});
export type RunsListParams = z.infer<typeof RunsListParamsSchema>;

export const SessionCreateParamsSchema = z.object({
  label: z.string().min(1).optional(),
  projectId: z.string().min(1).optional(),
});
export type SessionCreateParams = z.infer<typeof SessionCreateParamsSchema>;

export const ProjectCreateParamsSchema = z.object({
  label: z.string().min(1).optional(),
  rootPath: z.string().min(1),
});
export type ProjectCreateParams = z.infer<typeof ProjectCreateParamsSchema>;

export const ProjectListParamsSchema = z.object({
  limit: z.number().int().positive().max(500).optional(),
});
export type ProjectListParams = z.infer<typeof ProjectListParamsSchema>;

export const ProjectGetParamsSchema = z.object({
  projectId: z.string().min(1),
});
export type ProjectGetParams = z.infer<typeof ProjectGetParamsSchema>;

export const ProjectFilesParamsSchema = z.object({
  projectId: z.string().min(1),
});
export type ProjectFilesParams = z.infer<typeof ProjectFilesParamsSchema>;

export const ProjectFileReadParamsSchema = z.object({
  projectId: z.string().min(1),
  path: z.string().min(1),
});
export type ProjectFileReadParams = z.infer<typeof ProjectFileReadParamsSchema>;

export const ProjectFileEntrySchema = z.object({
  path: z.string().min(1),
  name: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
  modifiedAt: z.number().int().nonnegative(),
  mimeType: z.string().min(1),
});
export type ProjectFileEntry = z.infer<typeof ProjectFileEntrySchema>;

export const ProjectFilesResultSchema = z.object({
  projectId: z.string().min(1),
  rootPath: z.string().min(1),
  totalFiles: z.number().int().nonnegative(),
  files: z.array(ProjectFileEntrySchema),
  truncated: z.boolean(),
  skippedDirs: z.array(z.string().min(1)),
});
export type ProjectFilesResult = z.infer<typeof ProjectFilesResultSchema>;

export const ProjectFilePreviewKindSchema = z.enum(["text", "json", "image", "binary"]);
export type ProjectFilePreviewKind = z.infer<typeof ProjectFilePreviewKindSchema>;

export const ProjectFileReadResultSchema = z.object({
  projectId: z.string().min(1),
  rootPath: z.string().min(1),
  path: z.string().min(1),
  label: z.string().min(1),
  mimeType: z.string().min(1),
  previewKind: ProjectFilePreviewKindSchema,
  sizeBytes: z.number().int().nonnegative(),
  modifiedAt: z.number().int().nonnegative(),
  uri: z.string().min(1).optional(),
  payload: z.unknown().optional(),
});
export type ProjectFileReadResult = z.infer<typeof ProjectFileReadResultSchema>;

export const ProjectSummarySchema = z.object({
  projectId: z.string().min(1),
  label: z.string().min(1),
  rootPath: z.string().min(1),
  sessionCount: z.number().int().nonnegative(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});
export type ProjectSummary = z.infer<typeof ProjectSummarySchema>;

export const ProjectDetailSchema = z.object({
  project: ProjectSummarySchema,
  sessions: z.array(z.lazy(() => SessionSummarySchema)).default([]),
});
export type ProjectDetail = z.infer<typeof ProjectDetailSchema>;

export const SessionListParamsSchema = z.object({
  projectId: z.string().min(1).optional(),
  limit: z.number().int().positive().max(500).optional(),
});
export type SessionListParams = z.infer<typeof SessionListParamsSchema>;

export const SessionGetParamsSchema = z.object({
  sessionId: z.string().min(1),
});
export type SessionGetParams = z.infer<typeof SessionGetParamsSchema>;

export const SessionArchiveParamsSchema = z.object({
  sessionId: z.string().min(1),
});
export type SessionArchiveParams = z.infer<typeof SessionArchiveParamsSchema>;

export const SessionSummarySchema = z.object({
  sessionId: z.string().min(1),
  title: z.string().min(1),
  projectId: z.string().min(1).optional(),
  status: RunStatusSchema.optional(),
  latestRunId: z.string().min(1).optional(),
  latestPattern: CoordinationPatternSchema.optional(),
  latestModeId: ModeIdSchema.optional(),
  latestProviderId: z.string().min(1).optional(),
  latestModelRef: z.string().min(1).optional(),
  turnCount: z.number().int().nonnegative(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  archivedAt: z.number().int().nonnegative().optional(),
});
export type SessionSummary = z.infer<typeof SessionSummarySchema>;

export const SessionTurnSchema = z.object({
  runId: z.string().min(1),
  sessionId: z.string().min(1),
  turnIndex: z.number().int().positive(),
  status: RunStatusSchema,
  pattern: CoordinationPatternSchema,
  modeId: ModeIdSchema.optional(),
  providerId: z.string().min(1).optional(),
  modelRef: z.string().min(1).optional(),
  prompt: z.string().min(1),
  startedAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  eventCount: z.number().int().nonnegative(),
  checkpointCount: z.number().int().nonnegative(),
  artifactCount: z.number().int().nonnegative(),
  trace: z.lazy(() => RunTraceMetadataSchema).optional(),
});
export type SessionTurn = z.infer<typeof SessionTurnSchema>;

export const SessionTranscriptMessageSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  runId: z.string().min(1),
  turnIndex: z.number().int().positive(),
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1),
  pattern: CoordinationPatternSchema,
  modeId: ModeIdSchema.optional(),
  createdAt: z.number().int().nonnegative(),
});
export type SessionTranscriptMessage = z.infer<typeof SessionTranscriptMessageSchema>;

export const RunStreamParamsSchema = z.object({
  runId: z.string().min(1),
  afterSeq: z.number().int().nonnegative().optional()
});
export type RunStreamParams = z.infer<typeof RunStreamParamsSchema>;

export const RunResumeParamsSchema = z.object({
  runId: z.string().min(1),
  patch: z.record(z.unknown()).optional(),
  reason: z.string().min(1).optional()
});
export type RunResumeParams = z.infer<typeof RunResumeParamsSchema>;

export const RunForkParamsSchema = z.object({
  runId: z.string().min(1),
  checkpointId: z.string().min(1),
  input: UserTaskInputSchema.partial().optional(),
  config: RunConfigSchema.partial().optional()
});
export type RunForkParams = z.infer<typeof RunForkParamsSchema>;

export const RunReplayParamsSchema = z.object({
  runId: z.string().min(1),
  checkpointId: z.string().min(1).optional()
});
export type RunReplayParams = z.infer<typeof RunReplayParamsSchema>;

export const RunTrailParamsSchema = z.object({
  runId: z.string().min(1),
});
export type RunTrailParams = z.infer<typeof RunTrailParamsSchema>;

export const TrailObservationSchema = z.object({
  id: z.string().min(1),
  traceId: z.string().min(1),
  parentObservationId: z.string().min(1).nullable().optional(),
  type: z.string().min(1),
  name: z.string().min(1),
  level: z.enum(["DEBUG", "DEFAULT", "WARNING", "ERROR"]).optional(),
  statusMessage: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  startTime: z.string().min(1).optional(),
  endTime: z.string().nullable().optional(),
  input: z.unknown().optional(),
  output: z.unknown().optional(),
  metadata: z.record(z.unknown()).default({}),
  latencySeconds: z.number().nonnegative().optional(),
  totalCostUsd: z.number().nonnegative().optional(),
});
export type TrailObservation = z.infer<typeof TrailObservationSchema>;

export const TrailGenerationRefSchema = z.object({
  observationId: z.string().min(1),
  traceId: z.string().min(1),
  parentObservationId: z.string().min(1).optional(),
  name: z.string().min(1),
  providerId: z.string().min(1).optional(),
  providerType: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  statusMessage: z.string().min(1).optional(),
  totalCostUsd: z.number().nonnegative().optional(),
  latencySeconds: z.number().nonnegative().optional(),
});
export type TrailGenerationRef = z.infer<typeof TrailGenerationRefSchema>;

export const RunTraceMetadataSchema = z.object({
  provider: z.enum(["ora", "langfuse"]).default("langfuse"),
  enabled: z.boolean().default(false),
  available: z.boolean().default(false),
  traceId: z.string().min(1).optional(),
  rootObservationId: z.string().min(1).optional(),
  traceUrl: z.string().min(1).optional(),
  source: z.enum(["local", "managed_local", "local_synthesized", "disabled", "degraded"]).default("managed_local"),
  reason: z.string().min(1).optional(),
  generationRefs: z.array(TrailGenerationRefSchema).default([]),
});
export type RunTraceMetadata = z.infer<typeof RunTraceMetadataSchema>;

export const RunLatencyMarkSchema = z.object({
  name: z.string().min(1),
  at: z.number().int().nonnegative(),
  source: z.enum(["desktop", "runtime", "provider"]),
  detail: z.record(z.unknown()).default({}),
});
export type RunLatencyMark = z.infer<typeof RunLatencyMarkSchema>;

export const RunLatencyDiagnosticsSchema = z.object({
  marks: z.array(RunLatencyMarkSchema).default([]),
});
export type RunLatencyDiagnostics = z.infer<typeof RunLatencyDiagnosticsSchema>;

export const RunTrailMetricsSchema = z.object({
  runtimeMs: z.number().int().nonnegative(),
  eventCount: z.number().int().nonnegative(),
  checkpointCount: z.number().int().nonnegative(),
  topologyChangeCount: z.number().int().nonnegative(),
  messageCount: z.number().int().nonnegative(),
  activeAgentCount: z.number().int().nonnegative(),
  warningCount: z.number().int().nonnegative(),
  errorCount: z.number().int().nonnegative(),
  estimatedCostUsd: z.number().nonnegative(),
});
export type RunTrailMetrics = z.infer<typeof RunTrailMetricsSchema>;

export const RunTrailSchema = z.object({
  run: RunSummarySchema,
  trace: RunTraceMetadataSchema,
  observations: z.array(TrailObservationSchema).default([]),
  liveMetrics: RunTrailMetricsSchema,
});
export type RunTrail = z.infer<typeof RunTrailSchema>;

export const QueueSummarySchema = z.object({
  mode: z.enum(["dag", "backlog", "event_bus", "shared_state"]).default("dag"),
  pending: z.number().int().nonnegative().default(0),
  inProgress: z.number().int().nonnegative().default(0),
  completed: z.number().int().nonnegative().default(0),
  topics: z.array(z.string().min(1)).default([])
});
export type QueueSummary = z.infer<typeof QueueSummarySchema>;

export const SharedStateEntrySchema = z.object({
  key: z.string().min(1),
  version: z.number().int().nonnegative(),
  summary: z.string().min(1),
  updatedBy: z.string().min(1).optional()
});
export type SharedStateEntry = z.infer<typeof SharedStateEntrySchema>;

export const SharedStateSummarySchema = z.object({
  enabled: z.boolean().default(false),
  storeKind: z.enum(["none", "blackboard", "document", "kv"]).default("none"),
  version: z.number().int().nonnegative().default(0),
  entries: z.array(SharedStateEntrySchema).default([]),
  stopReason: z.string().min(1).optional()
});
export type SharedStateSummary = z.infer<typeof SharedStateSummarySchema>;

export const BusStatsSchema = z.object({
  enabled: z.boolean().default(false),
  publishedCount: z.number().int().nonnegative().default(0),
  routedCount: z.number().int().nonnegative().default(0),
  topicCounts: z.record(z.number().int().nonnegative()).default({})
});
export type BusStats = z.infer<typeof BusStatsSchema>;

export const PendingClarificationOptionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  value: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
});
export type PendingClarificationOption = z.infer<typeof PendingClarificationOptionSchema>;

export const PendingClarificationSchema = z.object({
  id: z.string().min(1),
  nodeId: z.string().min(1),
  nodeLabel: z.string().min(1),
  key: z.string().min(1),
  question: z.string().min(1),
  options: z.array(PendingClarificationOptionSchema).max(6).default([]),
  requestedAt: z.number().int().nonnegative(),
});
export type PendingClarification = z.infer<typeof PendingClarificationSchema>;

export const StateSnapshotSchema = z.object({
  runId: z.string().min(1),
  sessionId: z.string().min(1).optional(),
  turnIndex: z.number().int().positive().default(1),
  status: RunStatusSchema,
  pattern: CoordinationPatternSchema,
  coordinationKind: CoordinationKindSchema.optional(),
  modeId: ModeIdSchema.optional(),
  input: UserTaskInputSchema,
  config: RunConfigSchema,
  topology: z.object({
    nodes: z.array(TopologyNodeSchema),
    edges: z.array(TopologyEdgeSchema)
  }),
  profiles: z.array(AgentProfileSchema),
  memory: z.array(MemoryRecordSchema),
  plan: z.array(PlanItemSchema),
  planList: z.array(PlanListStepSchema).default([]),
  todos: z.array(TodoItemSchema).default([]),
  actions: z.array(ActionRecordSchema),
  toolCalls: z.array(OraToolCallEnvelopeSchema).default([]),
  continuation: RunContinuationSchema.default({ frames: [] }),
  conversation: z.array(RuntimeConversationEntrySchema).default([]),
  toolResults: z.array(RuntimeToolResultLedgerEntrySchema).default([]),
  policyDecisions: z.array(PolicyDecisionSchema).default([]),
  checkpoints: z.array(CheckpointMetaSchema),
  events: z.array(OraEventEnvelopeSchema),
  agentMessages: z.array(AgentConversationMessageSchema).default([]),
  artifacts: z.array(ArtifactRefSchema).default([]),
  activeAgents: z.array(z.string().min(1)).default([]),
  queueSummary: QueueSummarySchema.default({}),
  sharedStateSummary: SharedStateSummarySchema.default({}),
  busStats: BusStatsSchema.default({}),
  pendingClarifications: z.array(PendingClarificationSchema).default([]),
  pendingApprovals: z.array(z.string().min(1)).default([]),
  trace: RunTraceMetadataSchema.optional(),
  latency: RunLatencyDiagnosticsSchema.optional(),
  modeSpec: z.lazy(() => ModeSpecSchema).optional(),
  output: z.unknown().optional(),
  error: z.string().optional(),
  updatedAt: z.number().int().nonnegative()
});
export type StateSnapshot = z.infer<typeof StateSnapshotSchema>;

export const SessionDetailSchema = z.object({
  session: SessionSummarySchema,
  turns: z.array(SessionTurnSchema),
  transcript: z.array(SessionTranscriptMessageSchema).default([]),
  latestSnapshot: StateSnapshotSchema.optional(),
});
export type SessionDetail = z.infer<typeof SessionDetailSchema>;
