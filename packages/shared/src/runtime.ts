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
  permissionProfileId: z.string().min(1).optional(),
  patternOptions: z.record(z.unknown()).default({}),
  metadata: z.record(z.unknown()).default({}),
  deterministicSeed: z.string().min(1).default("ora-smoke")
});
export type RunConfig = z.infer<typeof RunConfigSchema>;

export const AutomationScheduleSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("once"),
    at: z.number().int().nonnegative(),
    timezone: z.string().min(1).default("UTC"),
  }),
  z.object({
    kind: z.literal("rrule"),
    rrule: z.string().min(1),
    startAt: z.number().int().nonnegative().optional(),
    timezone: z.string().min(1).default("UTC"),
  }),
]);
export type AutomationSchedule = z.infer<typeof AutomationScheduleSchema>;

export const AutomationStatusSchema = z.enum(["active", "paused"]);
export type AutomationStatus = z.infer<typeof AutomationStatusSchema>;

export const AutomationRunStatusSchema = z.enum(["queued", "running", "succeeded", "failed", "skipped"]);
export type AutomationRunStatus = z.infer<typeof AutomationRunStatusSchema>;

export const AutomationRunRecordSchema = z.object({
  id: z.string().min(1),
  automationId: z.string().min(1),
  runId: z.string().min(1).optional(),
  sessionId: z.string().min(1).optional(),
  status: AutomationRunStatusSchema,
  startedAt: z.number().int().nonnegative(),
  completedAt: z.number().int().nonnegative().optional(),
  durationMs: z.number().int().nonnegative().optional(),
  error: z.string().optional(),
});
export type AutomationRunRecord = z.infer<typeof AutomationRunRecordSchema>;

export const AutomationStateSchema = z.object({
  nextRunAt: z.number().int().nonnegative().optional(),
  runningRunId: z.string().min(1).optional(),
  dedicatedSessionId: z.string().min(1).optional(),
  lastRunId: z.string().min(1).optional(),
  lastRunAt: z.number().int().nonnegative().optional(),
  lastRunStatus: AutomationRunStatusSchema.optional(),
  lastError: z.string().optional(),
  lastDurationMs: z.number().int().nonnegative().optional(),
  consecutiveFailures: z.number().int().nonnegative().default(0),
  runHistory: z.array(AutomationRunRecordSchema).default([]),
});
export type AutomationState = z.infer<typeof AutomationStateSchema>;

export const AutomationConfigSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  prompt: z.string().min(1),
  schedule: AutomationScheduleSchema,
  status: AutomationStatusSchema.default("active"),
  projectId: z.string().min(1).optional(),
  customAgentId: z.string().min(1).optional(),
  modeId: ModeIdSchema.optional(),
  modeSelection: ModeSelectionSchema.default("manual"),
  providerId: z.string().min(1).optional(),
  modelRef: z.string().min(1).optional(),
  taskIntent: TaskIntentSchema.default("implement"),
  skillIds: z.array(z.string().min(1)).default([]),
  toolIds: z.array(z.string().min(1)).default([]),
  runConfig: RunConfigSchema.partial().default({}),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});
export type AutomationConfig = z.infer<typeof AutomationConfigSchema>;

export const AutomationSchema = AutomationConfigSchema.extend({
  state: AutomationStateSchema.default({}),
});
export type Automation = z.infer<typeof AutomationSchema>;

export const AutomationCreateParamsSchema = z.object({
  title: z.string().min(1),
  prompt: z.string().min(1),
  schedule: AutomationScheduleSchema,
  status: AutomationStatusSchema.default("active"),
  projectId: z.string().min(1).optional(),
  customAgentId: z.string().min(1).optional(),
  modeId: ModeIdSchema.optional(),
  modeSelection: ModeSelectionSchema.default("manual"),
  providerId: z.string().min(1).optional(),
  modelRef: z.string().min(1).optional(),
  taskIntent: TaskIntentSchema.default("implement"),
  skillIds: z.array(z.string().min(1)).default([]),
  toolIds: z.array(z.string().min(1)).default([]),
  runConfig: RunConfigSchema.partial().default({}),
});
export type AutomationCreateParams = z.infer<typeof AutomationCreateParamsSchema>;

export const AutomationUpdateParamsSchema = AutomationCreateParamsSchema.partial().extend({
  id: z.string().min(1),
});
export type AutomationUpdateParams = z.infer<typeof AutomationUpdateParamsSchema>;

export const AutomationIdParamsSchema = z.object({
  id: z.string().min(1),
});
export type AutomationIdParams = z.infer<typeof AutomationIdParamsSchema>;

export const AutomationListParamsSchema = z.object({
  includePaused: z.boolean().default(true),
});
export type AutomationListParams = z.infer<typeof AutomationListParamsSchema>;

export const AutomationPreviewScheduleParamsSchema = z.object({
  schedule: AutomationScheduleSchema,
  from: z.number().int().nonnegative().optional(),
  limit: z.number().int().positive().max(20).default(5),
});
export type AutomationPreviewScheduleParams = z.infer<typeof AutomationPreviewScheduleParamsSchema>;

export const AutomationPreviewScheduleResultSchema = z.object({
  occurrences: z.array(z.number().int().nonnegative()),
});
export type AutomationPreviewScheduleResult = z.infer<typeof AutomationPreviewScheduleResultSchema>;

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
  "context.usage.updated",
  "context.compaction.started",
  "context.compaction.completed",
  "context.compaction.failed",
  "context.compaction.skipped",
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
  nodeCheckpoint: z.object({
    modeId: ModeIdSchema.optional(),
    agentId: z.string().min(1).optional(),
    nodeId: z.string().min(1).optional(),
    planItemId: z.string().min(1).optional(),
    eventSeq: z.number().int().nonnegative().optional(),
    conversationCursor: z.number().int().nonnegative().optional(),
    bag: z.record(z.unknown()).default({}),
  }).optional(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});
export type RunContinuationFrame = z.infer<typeof RunContinuationFrameSchema>;

export const RunContinuationSchema = z.object({
  activeFrameId: z.string().min(1).optional(),
  frames: z.array(RunContinuationFrameSchema).default([]),
});
export type RunContinuation = z.infer<typeof RunContinuationSchema>;

export const PlanDecisionStatusSchema = z.enum(["pending", "accepted", "declined"]);
export type PlanDecisionStatus = z.infer<typeof PlanDecisionStatusSchema>;

export const PlanDecisionGateSchema = z.object({
  id: z.string().min(1),
  runId: z.string().min(1),
  sessionId: z.string().min(1),
  status: PlanDecisionStatusSchema.default("pending"),
  planContent: z.string().min(1).optional(),
  planSourceRunId: z.string().min(1).optional(),
  createdAt: z.number().int().nonnegative(),
  resolvedAt: z.number().int().nonnegative().optional(),
});
export type PlanDecisionGate = z.infer<typeof PlanDecisionGateSchema>;

export const SessionPlanDecisionResolveParamsSchema = z.object({
  sessionId: z.string().min(1),
  decisionId: z.string().min(1),
  status: z.enum(["accepted", "declined"]),
});
export type SessionPlanDecisionResolveParams = z.infer<typeof SessionPlanDecisionResolveParamsSchema>;

export const RunAttentionKindSchema = z.enum([
  "idle",
  "running",
  "paused",
  "needs_clarification",
  "needs_approval",
  "needs_plan_decision",
  "cancelled",
  "failed",
]);
export type RunAttentionKind = z.infer<typeof RunAttentionKindSchema>;

export const RunAttentionSchema = z.object({
  kind: RunAttentionKindSchema,
  blocking: z.boolean().default(false),
  sourceRunId: z.string().min(1).optional(),
  reason: z.string().min(1).optional(),
  pendingActionIds: z.array(z.string().min(1)).default([]),
  pendingToolCallIds: z.array(z.string().min(1)).default([]),
  pendingClarificationIds: z.array(z.string().min(1)).default([]),
  planDecisionId: z.string().min(1).optional(),
});
export type RunAttention = z.infer<typeof RunAttentionSchema>;

export const RunInteractionSchema = z.object({
  attention: RunAttentionSchema,
});
export type RunInteraction = z.infer<typeof RunInteractionSchema>;

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

export const ModelTokenUsageSourceSchema = z.enum(["provider", "estimate"]);
export type ModelTokenUsageSource = z.infer<typeof ModelTokenUsageSourceSchema>;

export const ModelTokenUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative().default(0),
  outputTokens: z.number().int().nonnegative().default(0),
  reasoningTokens: z.number().int().nonnegative().optional(),
  cacheCreationInputTokens: z.number().int().nonnegative().optional(),
  cacheReadInputTokens: z.number().int().nonnegative().optional(),
  totalTokens: z.number().int().nonnegative(),
  source: ModelTokenUsageSourceSchema.default("estimate"),
});
export type ModelTokenUsage = z.infer<typeof ModelTokenUsageSchema>;

export const SessionContextStateSchema = z.object({
  activeTokenUsage: ModelTokenUsageSchema.default({
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    source: "estimate",
  }),
  contextWindow: z.number().int().positive().optional(),
  autoCompactTokenLimit: z.number().int().positive().optional(),
  compactedHistory: z.array(RuntimeConversationEntrySchema).default([]),
  compactedThroughTurnIndex: z.number().int().nonnegative().default(0),
  compactionCount: z.number().int().nonnegative().default(0),
  lastCompactedAt: z.number().int().nonnegative().optional(),
  lastCompaction: z.object({
    phase: z.enum(["pre_turn", "mid_turn"]),
    implementation: z.enum(["local"]),
    beforeTokens: z.number().int().nonnegative(),
    afterTokens: z.number().int().nonnegative(),
    limit: z.number().int().positive(),
    reason: z.enum(["context_limit"]),
  }).optional(),
}).default({});
export type SessionContextState = z.infer<typeof SessionContextStateSchema>;

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
  includeLatestSnapshot: z.boolean().optional(),
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
  attention: RunAttentionSchema.optional(),
  latestRunId: z.string().min(1).optional(),
  latestPattern: CoordinationPatternSchema.optional(),
  latestModeId: ModeIdSchema.optional(),
  latestProviderId: z.string().min(1).optional(),
  latestModelRef: z.string().min(1).optional(),
  turnCount: z.number().int().nonnegative(),
  contextState: SessionContextStateSchema.optional(),
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
  attention: RunAttentionSchema.optional(),
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

export const RuntimeMaintenanceParamsSchema = z.object({
  compactStreamingEvents: z.boolean().default(true),
  vacuum: z.boolean().default(true),
  staleRunningMs: z.number().int().nonnegative().default(0),
}).default({});
export type RuntimeMaintenanceParams = z.infer<typeof RuntimeMaintenanceParamsSchema>;

export const RuntimeStorageOptimizationResultSchema = z.object({
  backend: z.enum(["sqlite", "json-file"]),
  vacuumed: z.boolean(),
  beforeBytes: z.number().int().nonnegative().optional(),
  afterBytes: z.number().int().nonnegative().optional(),
});
export type RuntimeStorageOptimizationResult = z.infer<typeof RuntimeStorageOptimizationResultSchema>;

export const RuntimeMaintenanceResultSchema = z.object({
  compactStreamingEvents: z.boolean(),
  vacuum: z.boolean(),
  staleRunningMs: z.number().int().nonnegative(),
  runsScanned: z.number().int().nonnegative(),
  runsCompacted: z.number().int().nonnegative(),
  staleRunsFailed: z.number().int().nonnegative().default(0),
  messageDeltaEventsCompacted: z.number().int().nonnegative(),
  rawPayloadsRemoved: z.number().int().nonnegative(),
  estimatedSnapshotBytesBefore: z.number().int().nonnegative(),
  estimatedSnapshotBytesAfter: z.number().int().nonnegative(),
  storage: RuntimeStorageOptimizationResultSchema.optional(),
});
export type RuntimeMaintenanceResult = z.infer<typeof RuntimeMaintenanceResultSchema>;

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

export const SessionBranchTargetSchema = z.enum(["empty_start", "append_after_latest", "replace_latest"]);
export type SessionBranchTarget = z.infer<typeof SessionBranchTargetSchema>;

export const SessionBranchCandidateConfigSchema = z.object({
  label: z.string().min(1).optional(),
  input: UserTaskInputSchema.partial().optional(),
  config: RunConfigSchema.partial().default({}),
});
export type SessionBranchCandidateConfig = z.infer<typeof SessionBranchCandidateConfigSchema>;

export const SessionBranchGroupCreateParamsSchema = z.object({
  sessionId: z.string().min(1),
  target: SessionBranchTargetSchema,
  prompt: z.string().min(1).optional(),
  baseRunId: z.string().min(1).optional(),
  replaceRunId: z.string().min(1).optional(),
  candidates: z.array(SessionBranchCandidateConfigSchema).min(1).max(6),
});
export type SessionBranchGroupCreateParams = z.infer<typeof SessionBranchGroupCreateParamsSchema>;

export const SessionBranchGroupGetParamsSchema = z.object({
  sessionId: z.string().min(1),
  branchGroupId: z.string().min(1),
});
export type SessionBranchGroupGetParams = z.infer<typeof SessionBranchGroupGetParamsSchema>;

export const SessionBranchGroupListParamsSchema = z.object({
  sessionId: z.string().min(1),
  limit: z.number().int().positive().max(100).optional(),
});
export type SessionBranchGroupListParams = z.infer<typeof SessionBranchGroupListParamsSchema>;

export const SessionBranchGroupAdoptParamsSchema = z.object({
  sessionId: z.string().min(1),
  branchGroupId: z.string().min(1),
  runId: z.string().min(1),
});
export type SessionBranchGroupAdoptParams = z.infer<typeof SessionBranchGroupAdoptParamsSchema>;

export const SessionBranchGroupDismissParamsSchema = z.object({
  sessionId: z.string().min(1),
  branchGroupId: z.string().min(1),
});
export type SessionBranchGroupDismissParams = z.infer<typeof SessionBranchGroupDismissParamsSchema>;

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

export const FlowDefinitionRefSchema = z.object({
  flowDefinitionId: z.string().min(1),
  source: z.enum(["mode_spec"]).default("mode_spec"),
  modeId: ModeIdSchema.optional(),
  label: z.string().min(1).optional(),
});
export type FlowDefinitionRef = z.infer<typeof FlowDefinitionRefSchema>;

export const FlowGateKindSchema = z.enum(["clarification", "approval", "plan_decision", "cancellation"]);
export type FlowGateKind = z.infer<typeof FlowGateKindSchema>;

export const FlowGateStatusSchema = z.enum(["open", "resolved", "cancelled"]);
export type FlowGateStatus = z.infer<typeof FlowGateStatusSchema>;

export const FlowGateSchema = z.object({
  gateId: z.string().min(1),
  kind: FlowGateKindSchema,
  status: FlowGateStatusSchema,
  runId: z.string().min(1),
  flowRunId: z.string().min(1),
  sessionId: z.string().min(1).optional(),
  pendingActionIds: z.array(z.string().min(1)).default([]),
  pendingToolCallIds: z.array(z.string().min(1)).default([]),
  pendingClarificationIds: z.array(z.string().min(1)).default([]),
  planDecisionId: z.string().min(1).optional(),
  reason: z.string().min(1).optional(),
  openedAt: z.number().int().nonnegative().optional(),
  resolvedAt: z.number().int().nonnegative().optional(),
});
export type FlowGate = z.infer<typeof FlowGateSchema>;

export const FlowActivityKindSchema = z.enum(["node", "model", "tool", "channel", "worker"]);
export type FlowActivityKind = z.infer<typeof FlowActivityKindSchema>;

export const FlowActivityStatusSchema = z.enum(["pending", "running", "succeeded", "failed", "interrupted", "cancelled", "denied"]);
export type FlowActivityStatus = z.infer<typeof FlowActivityStatusSchema>;

export const FlowActivitySummarySchema = z.object({
  activityId: z.string().min(1),
  kind: FlowActivityKindSchema,
  status: FlowActivityStatusSchema,
  runId: z.string().min(1),
  flowRunId: z.string().min(1),
  nodeId: z.string().min(1).optional(),
  agentId: z.string().min(1).optional(),
  toolId: z.string().min(1).optional(),
  label: z.string().min(1).optional(),
  startedAt: z.number().int().nonnegative().optional(),
  updatedAt: z.number().int().nonnegative().optional(),
});
export type FlowActivitySummary = z.infer<typeof FlowActivitySummarySchema>;

export const FlowRunHandleSchema = RunHandleSchema.extend({
  flowRunId: z.string().min(1),
});
export type FlowRunHandle = z.infer<typeof FlowRunHandleSchema>;

export const FlowRunDetailSchema = z.object({
  flowRunId: z.string().min(1),
  runId: z.string().min(1),
  sessionId: z.string().min(1).optional(),
  linkedSessionIds: z.array(z.string().min(1)).default([]),
  turnIndex: z.number().int().positive().optional(),
  status: RunStatusSchema,
  attention: RunAttentionSchema,
  definition: FlowDefinitionRefSchema,
  checkpoints: z.array(CheckpointMetaSchema).default([]),
  gates: z.array(FlowGateSchema).default([]),
  activities: z.array(FlowActivitySummarySchema).default([]),
  eventCount: z.number().int().nonnegative(),
  latestEventSeq: z.number().int().nonnegative().optional(),
  latestSnapshot: z.lazy(() => StateSnapshotSchema).optional(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});
export type FlowRunDetail = z.infer<typeof FlowRunDetailSchema>;

export const FlowRunIdParamsSchema = z.object({
  flowRunId: z.string().min(1).optional(),
  runId: z.string().min(1).optional(),
}).refine((params) => params.flowRunId !== undefined || params.runId !== undefined, {
  message: "Expected flowRunId or runId.",
});
export type FlowRunIdParams = z.infer<typeof FlowRunIdParamsSchema>;

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
  attention: RunAttentionSchema.optional(),
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
  planDecisions: z.array(PlanDecisionGateSchema).default([]),
  conversation: z.array(RuntimeConversationEntrySchema).default([]),
  contextState: SessionContextStateSchema.optional(),
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

export const SessionBranchCandidateSchema = z.object({
  runId: z.string().min(1),
  status: RunStatusSchema,
  label: z.string().min(1).optional(),
  modeId: ModeIdSchema.optional(),
  providerId: z.string().min(1).optional(),
  modelRef: z.string().min(1).optional(),
  adopted: z.boolean().default(false),
  prompt: z.string().min(1),
  outputPreview: z.string().optional(),
  updatedAt: z.number().int().nonnegative(),
});
export type SessionBranchCandidate = z.infer<typeof SessionBranchCandidateSchema>;

export const SessionBranchGroupStatusSchema = z.enum(["running", "ready", "adopted", "dismissed"]);
export type SessionBranchGroupStatus = z.infer<typeof SessionBranchGroupStatusSchema>;

export const SessionBranchGroupSchema = z.object({
  branchGroupId: z.string().min(1),
  sessionId: z.string().min(1),
  target: SessionBranchTargetSchema,
  baseRunId: z.string().min(1).optional(),
  replaceRunId: z.string().min(1).optional(),
  baseTurnIndex: z.number().int().nonnegative(),
  prompt: z.string().min(1),
  status: SessionBranchGroupStatusSchema,
  candidateRunIds: z.array(z.string().min(1)).default([]),
  candidates: z.array(SessionBranchCandidateSchema).default([]),
  adoptedRunId: z.string().min(1).optional(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});
export type SessionBranchGroup = z.infer<typeof SessionBranchGroupSchema>;

export function deriveSessionBranchGroupStatus(
  group: Pick<SessionBranchGroup, "status" | "adoptedRunId" | "candidates">,
): SessionBranchGroupStatus {
  if (group.adoptedRunId || group.candidates.some((candidate) => candidate.adopted)) {
    return "adopted";
  }
  if (group.status === "dismissed") {
    return "dismissed";
  }
  return group.candidates.every((candidate) => candidate.status !== "queued" && candidate.status !== "running")
    ? "ready"
    : "running";
}

export function deriveSessionBranchGroupsForSession(
  sessionId: string,
  runs: readonly StateSnapshot[],
): SessionBranchGroup[] {
  const grouped = new Map<string, StateSnapshot[]>();
  for (const run of runs) {
    if (run.sessionId !== sessionId || typeof run.config.metadata.branchGroupId !== "string") {
      continue;
    }
    const branchGroupId = String(run.config.metadata.branchGroupId);
    grouped.set(branchGroupId, [...(grouped.get(branchGroupId) ?? []), run]);
  }

  return [...grouped.entries()]
    .map(([branchGroupId, groupRuns]) => {
      const sortedRuns = [...groupRuns].sort((a, b) => a.updatedAt - b.updatedAt || a.runId.localeCompare(b.runId));
      const first = sortedRuns[0]!;
      const metadata = first.config.metadata;
      const adopted = sortedRuns.find((run) => run.config.metadata.branchRole === "adopted");
      const dismissed = sortedRuns.every((run) => run.config.metadata.branchDismissed === true);
      const allSettled = sortedRuns.every((run) => run.status !== "queued" && run.status !== "running");
      const createdAt = numberBranchMetadata(metadata.branchGroupCreatedAt) ?? first.input.createdAt ?? first.updatedAt;
      const updatedAt = sortedRuns.reduce((max, run) => Math.max(max, run.updatedAt), createdAt);
      return SessionBranchGroupSchema.parse({
        branchGroupId,
        sessionId,
        target: branchTargetMetadata(metadata.branchTarget),
        baseRunId: stringBranchMetadata(metadata.branchBaseRunId),
        replaceRunId: stringBranchMetadata(metadata.branchReplaceRunId),
        baseTurnIndex: numberBranchMetadata(metadata.branchBaseTurnIndex) ?? 0,
        prompt: stringBranchMetadata(metadata.branchPrompt) ?? first.input.prompt,
        status: adopted ? "adopted" : dismissed ? "dismissed" : allSettled ? "ready" : "running",
        candidateRunIds: sortedRuns.map((run) => run.runId),
        candidates: sortedRuns.map((run) => ({
          runId: run.runId,
          status: run.status,
          label: stringBranchMetadata(run.config.metadata.branchCandidateLabel),
          modeId: run.modeId,
          providerId: typeof run.config.providerId === "string" ? run.config.providerId : undefined,
          modelRef: run.config.modelRef,
          adopted: run.config.metadata.branchRole === "adopted",
          prompt: run.input.prompt,
          outputPreview: branchOutputPreviewForRun(run),
          updatedAt: run.updatedAt,
        })),
        adoptedRunId: adopted?.runId,
        createdAt,
        updatedAt,
      });
    })
    .sort((a, b) => b.updatedAt - a.updatedAt || a.branchGroupId.localeCompare(b.branchGroupId));
}

function branchTargetMetadata(value: unknown): SessionBranchTarget {
  return value === "empty_start" || value === "append_after_latest" || value === "replace_latest"
    ? value
    : "append_after_latest";
}

function stringBranchMetadata(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function numberBranchMetadata(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function branchOutputPreviewForRun(run: StateSnapshot): string | undefined {
  if (typeof run.output === "object" && run.output !== null && typeof (run.output as { text?: unknown }).text === "string") {
    return (run.output as { text: string }).text.slice(0, 500);
  }
  if (typeof run.output === "string") {
    return run.output.slice(0, 500);
  }
  const content = run.events
    .filter((event) => event.type === "message.delta")
    .map((event) =>
      event.payload && typeof event.payload === "object" && typeof (event.payload as { content?: unknown }).content === "string"
        ? (event.payload as { content: string }).content
        : ""
    )
    .join("")
    .trim();
  return content ? content.slice(0, 500) : undefined;
}

export function snapshotContainsCompleteProposedPlan(snapshot: Pick<StateSnapshot, "events">): boolean {
  return extractCompleteProposedPlanContent(snapshot) !== undefined;
}

export function extractCompleteProposedPlanContent(snapshot: Pick<StateSnapshot, "events"> & { output?: unknown }): string | undefined {
  const candidates: string[] = [];
  if (typeof snapshot.output === "string") {
    candidates.push(snapshot.output);
  } else if (
    snapshot.output &&
    typeof snapshot.output === "object" &&
    typeof (snapshot.output as { text?: unknown }).text === "string"
  ) {
    candidates.push((snapshot.output as { text: string }).text);
  }
  candidates.push(snapshot.events
    .filter((event) =>
      event.type === "message.delta" &&
      Boolean(event.payload) &&
      typeof event.payload === "object" &&
      (
        typeof (event.payload as { content?: unknown }).content === "string" ||
        typeof (event.payload as { delta?: unknown }).delta === "string"
      )
    )
    .map((event) => {
      const payload = event.payload as { content?: unknown; delta?: unknown };
      return typeof payload.content === "string"
        ? payload.content
        : typeof payload.delta === "string"
          ? payload.delta
          : "";
    })
    .join(""));

  for (const candidate of candidates) {
    const match = candidate.match(/<proposed_plan>\s*([\s\S]+?)\s*<\/proposed_plan>/);
    const content = match?.[1]?.trim();
    if (content) {
      return content;
    }
  }
  return undefined;
}

export function deriveRunInteraction(snapshot: StateSnapshot): RunInteraction {
  const activeFrame = snapshot.status === "interrupted"
    ? snapshot.continuation.frames.find((frame) =>
        frame.id === snapshot.continuation.activeFrameId &&
        frame.status === "paused"
      )
    : undefined;
  const pendingClarificationIds = [
    ...new Set([
      ...snapshot.pendingClarifications.map((clarification) => clarification.id),
      ...(activeFrame?.reason === "clarification_required" ? activeFrame.pendingClarificationIds : []),
    ]),
  ];
  if (pendingClarificationIds.length > 0) {
    return RunInteractionSchema.parse({
      attention: {
        kind: "needs_clarification",
        blocking: true,
        sourceRunId: snapshot.runId,
        reason: "clarification_required",
        pendingClarificationIds,
      },
    });
  }

  const pendingActionIds = [
    ...new Set([
      ...snapshot.pendingApprovals,
      ...snapshot.actions.filter((action) => action.status === "approval_required").map((action) => action.id),
      ...(activeFrame?.reason === "approval_required" ? activeFrame.pendingActionIds : []),
    ]),
  ];
  const pendingToolCallIds = [
    ...new Set([
      ...snapshot.toolCalls.filter((call) => call.status === "approval_required").map((call) => call.id),
      ...(activeFrame?.reason === "approval_required" ? activeFrame.pendingToolCallIds : []),
    ]),
  ];
  if (pendingActionIds.length > 0 || pendingToolCallIds.length > 0) {
    return RunInteractionSchema.parse({
      attention: {
        kind: "needs_approval",
        blocking: true,
        sourceRunId: snapshot.runId,
        reason: "approval_required",
        pendingActionIds,
        pendingToolCallIds,
      },
    });
  }

  const planDecision = snapshot.planDecisions.find((decision) => decision.status === "pending");
  if (planDecision) {
    return RunInteractionSchema.parse({
      attention: {
        kind: "needs_plan_decision",
        blocking: true,
        sourceRunId: snapshot.runId,
        reason: "plan_decision_required",
        planDecisionId: planDecision.id,
      },
    });
  }

  if (snapshot.status === "queued" || snapshot.status === "running") {
    return RunInteractionSchema.parse({
      attention: {
        kind: "running",
        blocking: false,
        sourceRunId: snapshot.runId,
      },
    });
  }
  if (snapshot.status === "interrupted") {
    return RunInteractionSchema.parse({
      attention: {
        kind: "paused",
        blocking: false,
        sourceRunId: snapshot.runId,
        reason: activeFrame?.reason ?? "manual_interrupt",
      },
    });
  }
  if (snapshot.status === "failed") {
    return RunInteractionSchema.parse({
      attention: {
        kind: "failed",
        blocking: false,
        sourceRunId: snapshot.runId,
        reason: snapshot.error,
      },
    });
  }
  if (snapshot.status === "cancelled") {
    return RunInteractionSchema.parse({
      attention: {
        kind: "cancelled",
        blocking: false,
        sourceRunId: snapshot.runId,
        reason: snapshot.error,
      },
    });
  }
  return RunInteractionSchema.parse({
    attention: {
      kind: "idle",
      blocking: false,
      sourceRunId: snapshot.runId,
    },
  });
}

export function deriveRunAttention(snapshot: StateSnapshot): RunAttention {
  return deriveRunInteraction(snapshot).attention;
}

export type RuntimeAttentionStatus =
  | "clarification_required"
  | "approval_required"
  | "decision_needed"
  | "running"
  | "paused"
  | "cancelled"
  | "failed"
  | "done";

export function runtimeStatusForRunAttention(attention: RunAttention | undefined): RuntimeAttentionStatus | undefined {
  if (!attention) {
    return undefined;
  }
  switch (attention.kind) {
    case "needs_clarification":
      return "clarification_required";
    case "needs_approval":
      return "approval_required";
    case "needs_plan_decision":
      return "decision_needed";
    case "running":
      return "running";
    case "paused":
      return "paused";
    case "cancelled":
      return "cancelled";
    case "failed":
      return "failed";
    case "idle":
      return "done";
  }
}

export function normalizeRunAttention(snapshot: StateSnapshot): StateSnapshot {
  const normalized = StateSnapshotSchema.parse(snapshot);
  return StateSnapshotSchema.parse({
    ...normalized,
    attention: deriveRunAttention(normalized),
  });
}

export const SessionDetailSchema = z.object({
  session: SessionSummarySchema,
  turns: z.array(SessionTurnSchema),
  transcript: z.array(SessionTranscriptMessageSchema).default([]),
  branchGroups: z.array(SessionBranchGroupSchema).default([]).optional(),
  latestSnapshot: StateSnapshotSchema.optional(),
});
export type SessionDetail = z.infer<typeof SessionDetailSchema>;
