import { z } from "zod";

export const CoordinationPatternSchema = z.enum([
  "generator_verifier",
  "orchestrator_subagent",
  "agent_teams",
  "message_bus",
  "shared_state"
]);
export type CoordinationPattern = z.infer<typeof CoordinationPatternSchema>;
export const CoordinationKindSchema = CoordinationPatternSchema;
export type CoordinationKind = CoordinationPattern;
export const DEERFLOW_HARNESS_MODE_ID = "deerflow_harness" as const;
export const SINGLE_AGENT_MODE_ID = "single_agent" as const;

export const ModeIdSchema = z
  .string()
  .min(1)
  .regex(/^[a-z0-9][a-z0-9_-]*$/, "Mode ids must start with a lowercase letter or digit and use only lowercase letters, digits, hyphens, or underscores.");
export type ModeId = z.infer<typeof ModeIdSchema>;

export const RunStatusSchema = z.enum([
  "queued",
  "running",
  "interrupted",
  "cancelled",
  "succeeded",
  "failed"
]);
export type RunStatus = z.infer<typeof RunStatusSchema>;

export const ResourceBudgetSchema = z.object({
  maxTokens: z.number().int().positive(),
  maxToolCalls: z.number().int().nonnegative(),
  maxRuntimeMs: z.number().int().positive(),
  maxCostUsd: z.number().nonnegative().optional()
});
export type ResourceBudget = z.infer<typeof ResourceBudgetSchema>;

export const AgentProfileSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  role: z.string().min(1),
  modelRef: z.string().min(1),
  toolPolicyId: z.string().min(1),
  memoryNamespaces: z.array(z.string().min(1)),
  budget: ResourceBudgetSchema
});
export type AgentProfile = z.infer<typeof AgentProfileSchema>;

export const MemoryKindSchema = z.enum([
  "profile",
  "project",
  "session",
  "worker",
  "artifact"
]);
export type MemoryKind = z.infer<typeof MemoryKindSchema>;

export const MemoryRecordSchema = z.object({
  id: z.string().min(1),
  namespace: z.array(z.string().min(1)).min(1),
  kind: MemoryKindSchema,
  value: z.unknown(),
  sourceRunId: z.string().min(1).optional(),
  sourceActionId: z.string().min(1).optional(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative()
});
export type MemoryRecord = z.infer<typeof MemoryRecordSchema>;

export const PlanItemStatusSchema = z.enum([
  "planned",
  "ready",
  "running",
  "blocked",
  "done",
  "failed",
  "skipped"
]);
export type PlanItemStatus = z.infer<typeof PlanItemStatusSchema>;

export const PlanItemSchema = z.object({
  id: z.string().min(1),
  runId: z.string().min(1),
  parentId: z.string().min(1).optional(),
  ownerAgentId: z.string().min(1).optional(),
  status: PlanItemStatusSchema,
  title: z.string().min(1),
  dependencies: z.array(z.string().min(1)),
  linkedActionIds: z.array(z.string().min(1)),
  checkpointIds: z.array(z.string().min(1))
});
export type PlanItem = z.infer<typeof PlanItemSchema>;

export const TodoItemStatusSchema = PlanItemStatusSchema;
export type TodoItemStatus = PlanItemStatus;

export const TodoItemSchema = z.object({
  id: z.string().min(1),
  runId: z.string().min(1),
  sourcePlanItemId: z.string().min(1).optional(),
  status: TodoItemStatusSchema,
  label: z.string().min(1),
  detail: z.string().min(1).optional(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative()
});
export type TodoItem = z.infer<typeof TodoItemSchema>;

export const ActionRiskLevelSchema = z.enum(["low", "medium", "high"]);
export type ActionRiskLevel = z.infer<typeof ActionRiskLevelSchema>;

export const ActionStatusSchema = z.enum([
  "proposed",
  "approval_required",
  "approved",
  "denied",
  "running",
  "succeeded",
  "failed",
  "skipped",
  "reverted"
]);
export type ActionStatus = z.infer<typeof ActionStatusSchema>;

export const ActionRecordSchema = z.object({
  id: z.string().min(1),
  runId: z.string().min(1),
  planItemId: z.string().min(1).optional(),
  agentId: z.string().min(1).optional(),
  type: z.string().min(1),
  riskLevel: ActionRiskLevelSchema,
  status: ActionStatusSchema,
  input: z.unknown(),
  output: z.unknown().optional(),
  error: z.string().optional(),
  artifactIds: z.array(z.string().min(1))
});
export type ActionRecord = z.infer<typeof ActionRecordSchema>;

export const PolicyDecisionSchema = z.object({
  id: z.string().min(1),
  runId: z.string().min(1),
  actionId: z.string().min(1),
  policyId: z.string().min(1),
  requiredApproval: z.boolean(),
  reason: z.string().min(1),
  createdAt: z.number().int().nonnegative()
});
export type PolicyDecision = z.infer<typeof PolicyDecisionSchema>;

export const RecoveryErrorTypeSchema = z.enum([
  "provider_transient",
  "provider_busy",
  "provider_auth",
  "provider_quota",
  "tool_error",
  "tool_policy_denied",
  "tool_output_invalid",
  "model_output_invalid",
  "node_exception",
  "node_timeout",
  "loop_detected",
  "subagent_limit",
  "approval_required",
  "clarification_required",
]);
export type RecoveryErrorType = z.infer<typeof RecoveryErrorTypeSchema>;

export const RecoveryActionSchema = z.enum([
  "retry",
  "alternate_tool",
  "skip_node",
  "fallback_artifact",
  "interrupt",
  "fail",
]);
export type RecoveryAction = z.infer<typeof RecoveryActionSchema>;

export const RecoveryPolicyDefaultsSchema = z.object({
  maxAttempts: z.number().int().nonnegative().default(1),
  backoffMs: z.number().int().nonnegative().default(250),
  backoffMultiplier: z.number().min(1).default(2),
  capDelayMs: z.number().int().nonnegative().default(2000),
  fallbackArtifact: z.boolean().default(true),
});
export type RecoveryPolicyDefaults = z.infer<typeof RecoveryPolicyDefaultsSchema>;

export const RecoveryRuleSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1).optional(),
  enabled: z.boolean().default(true),
  errorTypes: z.array(RecoveryErrorTypeSchema).min(1),
  nodeIds: z.array(z.string().min(1)).default([]),
  nodeTemplates: z.array(z.string().min(1)).default([]),
  toolIds: z.array(z.string().min(1)).default([]),
  action: RecoveryActionSchema,
  maxAttempts: z.number().int().nonnegative().optional(),
  alternateToolIds: z.array(z.string().min(1)).default([]),
  skipAllowed: z.boolean().default(false),
  fallbackSummary: z.string().min(1).optional(),
  fallbackUsableOutput: z.unknown().optional(),
});
export type RecoveryRule = z.infer<typeof RecoveryRuleSchema>;

export const ModeRecoveryPolicySchema = z.object({
  version: z.literal(1).default(1),
  defaults: RecoveryPolicyDefaultsSchema.default({
    maxAttempts: 1,
    backoffMs: 250,
    backoffMultiplier: 2,
    capDelayMs: 2000,
    fallbackArtifact: true,
  }),
  rules: z.array(RecoveryRuleSchema).default([]),
});
export type ModeRecoveryPolicy = z.infer<typeof ModeRecoveryPolicySchema>;

export const RecoveryArtifactSchema = z.object({
  id: z.string().min(1),
  runId: z.string().min(1),
  nodeId: z.string().min(1).optional(),
  toolId: z.string().min(1).optional(),
  errorType: RecoveryErrorTypeSchema,
  decision: RecoveryActionSchema,
  summary: z.string().min(1),
  usableOutput: z.unknown().optional(),
  originalError: z.string().min(1),
  createdAt: z.number().int().nonnegative(),
});
export type RecoveryArtifact = z.infer<typeof RecoveryArtifactSchema>;

export const DEFAULT_MODE_RECOVERY_POLICY = ModeRecoveryPolicySchema.parse({
  version: 1,
  defaults: {
    maxAttempts: 1,
    backoffMs: 250,
    backoffMultiplier: 2,
    capDelayMs: 2000,
    fallbackArtifact: true,
  },
  rules: [
    {
      id: "provider-transient-retry",
      label: "Provider transient retry",
      errorTypes: ["provider_transient", "provider_busy"],
      action: "retry",
      maxAttempts: 3,
    },
    {
      id: "provider-hard-fallback",
      label: "Provider hard fallback",
      errorTypes: ["provider_auth", "provider_quota"],
      action: "fallback_artifact",
    },
    {
      id: "tool-error-fallback",
      label: "Tool error fallback",
      errorTypes: ["tool_error", "tool_policy_denied", "tool_output_invalid"],
      action: "fallback_artifact",
    },
    {
      id: "runtime-node-fail",
      label: "Runtime node fail",
      errorTypes: ["model_output_invalid", "node_exception", "node_timeout", "loop_detected", "subagent_limit"],
      action: "fail",
    },
    {
      id: "human-interrupt",
      label: "Human interrupt",
      errorTypes: ["approval_required", "clarification_required"],
      action: "interrupt",
    },
  ],
});

export const UserTaskInputSchema = z.object({
  taskId: z.string().min(1).optional(),
  prompt: z.string().min(1),
  projectId: z.string().min(1).optional(),
  context: z.record(z.unknown()).default({}),
  createdAt: z.number().int().nonnegative().optional()
});
export type UserTaskInput = z.infer<typeof UserTaskInputSchema>;

export const RunConfigSchema = z.object({
  pattern: CoordinationPatternSchema.default("orchestrator_subagent"),
  modeId: ModeIdSchema.optional(),
  profileIds: z.array(z.string().min(1)).default([]),
  providerId: z.string().min(1).optional(),
  providerConfig: z.lazy(() => ProviderConfigSchema).optional(),
  customAgentId: z.string().min(1).optional(),
  modelRef: z.string().min(1).default("local/smoke-model"),
  budget: ResourceBudgetSchema.optional(),
  skillIds: z.array(z.string().min(1)).default([]),
  toolIds: z.array(z.string().min(1)).default([]),
  approvalMode: z.enum(["auto", "manual", "high_risk_only"]).default("high_risk_only"),
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

export const TopologyNodeSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  kind: z.enum(["run", "agent", "capability", "checkpoint", "artifact"]),
  agentId: z.string().min(1).optional(),
  status: z.enum(["idle", "running", "blocked", "done", "failed"]).default("idle"),
  metadata: z.record(z.unknown()).default({})
});
export type TopologyNode = z.infer<typeof TopologyNodeSchema>;

export const TopologyEdgeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  label: z.string().min(1).optional(),
  kind: z.enum(["control", "delegation", "verification", "memory", "artifact"]),
  metadata: z.record(z.unknown()).default({})
});
export type TopologyEdge = z.infer<typeof TopologyEdgeSchema>;

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
  "message.delta",
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
  "recovery.detected",
  "recovery.retry_scheduled",
  "recovery.applied",
  "recovery.exhausted",
  "node.skipped",
  "run.interrupted",
  "run.cancelled",
  "run.done",
  "run.failed"
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
  provider: z.literal("langfuse").default("langfuse"),
  enabled: z.boolean().default(false),
  available: z.boolean().default(false),
  traceId: z.string().min(1).optional(),
  rootObservationId: z.string().min(1).optional(),
  traceUrl: z.string().min(1).optional(),
  source: z.enum(["managed_local", "local_synthesized", "disabled", "degraded"]).default("managed_local"),
  reason: z.string().min(1).optional(),
  generationRefs: z.array(TrailGenerationRefSchema).default([]),
});
export type RunTraceMetadata = z.infer<typeof RunTraceMetadataSchema>;

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

export const PendingClarificationSchema = z.object({
  id: z.string().min(1),
  nodeId: z.string().min(1),
  nodeLabel: z.string().min(1),
  key: z.string().min(1),
  question: z.string().min(1),
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
  todos: z.array(TodoItemSchema).default([]),
  actions: z.array(ActionRecordSchema),
  policyDecisions: z.array(PolicyDecisionSchema).default([]),
  checkpoints: z.array(CheckpointMetaSchema),
  events: z.array(OraEventEnvelopeSchema),
  artifacts: z.array(ArtifactRefSchema).default([]),
  activeAgents: z.array(z.string().min(1)).default([]),
  queueSummary: QueueSummarySchema.default({}),
  sharedStateSummary: SharedStateSummarySchema.default({}),
  busStats: BusStatsSchema.default({}),
  pendingClarifications: z.array(PendingClarificationSchema).default([]),
  pendingApprovals: z.array(z.string().min(1)).default([]),
  trace: RunTraceMetadataSchema.optional(),
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

export const EvaluationProfileKindSchema = z.enum([
  "outcome",
  "orchestration",
  "task_completion"
]);
export type EvaluationProfileKind = z.infer<typeof EvaluationProfileKindSchema>;

export const EvaluationScoreWeightsSchema = z.object({
  outcome: z.number().min(0).max(1),
  process: z.number().min(0).max(1),
  efficiency: z.number().min(0).max(1),
  safety: z.number().min(0).max(1),
});
export type EvaluationScoreWeights = z.infer<typeof EvaluationScoreWeightsSchema>;

export const EvaluationProfileSchema = z.object({
  id: EvaluationProfileKindSchema,
  label: z.string().min(1),
  description: z.string().min(1),
  defaultWeights: EvaluationScoreWeightsSchema,
  emphasizesTrace: z.boolean().default(false),
});
export type EvaluationProfile = z.infer<typeof EvaluationProfileSchema>;

export const EvaluationCaseInputSchema = z.object({
  prompt: z.string().min(1),
  context: z.record(z.unknown()).default({}),
});
export type EvaluationCaseInput = z.infer<typeof EvaluationCaseInputSchema>;

export const EvaluationExpectedSchema = z.object({
  text: z.string().min(1).optional(),
  structured: z.unknown().optional(),
}).refine(
  (value) => value.text !== undefined || value.structured !== undefined,
  { message: "Expected output requires text or structured content." }
);
export type EvaluationExpected = z.infer<typeof EvaluationExpectedSchema>;

export const EvaluationCaseSchema = z.object({
  id: z.string().min(1),
  input: EvaluationCaseInputSchema,
  expected: EvaluationExpectedSchema.optional(),
  metadata: z.record(z.unknown()).default({}),
});
export type EvaluationCase = z.infer<typeof EvaluationCaseSchema>;

export const EvaluationDatasetSourceFormatSchema = z.enum([
  "json",
  "jsonl",
  "csv",
  "inline",
]);
export type EvaluationDatasetSourceFormat = z.infer<typeof EvaluationDatasetSourceFormatSchema>;

export const EvaluationDatasetSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1).optional(),
  sourceFileName: z.string().min(1).optional(),
  sourceFormat: EvaluationDatasetSourceFormatSchema,
  schemaVersion: z.literal(1).default(1),
  caseCount: z.number().int().nonnegative(),
  tags: z.array(z.string().min(1)).default([]),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});
export type EvaluationDataset = z.infer<typeof EvaluationDatasetSchema>;

export const EvaluationDatasetDetailSchema = z.object({
  dataset: EvaluationDatasetSchema,
  cases: z.array(EvaluationCaseSchema),
  metadataKeys: z.array(z.string().min(1)).default([]),
  tagCounts: z.record(z.number().int().nonnegative()).default({}),
});
export type EvaluationDatasetDetail = z.infer<typeof EvaluationDatasetDetailSchema>;

export const EvaluationImportParamsSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  sourceFileName: z.string().min(1).optional(),
  sourceFormat: EvaluationDatasetSourceFormatSchema.optional(),
  content: z.string().min(1).optional(),
  filePath: z.string().min(1).optional(),
  tags: z.array(z.string().min(1)).default([]),
}).refine(
  (value) => value.content !== undefined || value.filePath !== undefined,
  { message: "Dataset import requires content or filePath." }
);
export type EvaluationImportParams = z.infer<typeof EvaluationImportParamsSchema>;

export const EvaluationConfigRunConfigSchema = RunConfigSchema.partial().extend({
  pattern: CoordinationPatternSchema,
});
export type EvaluationConfigRunConfig = z.infer<typeof EvaluationConfigRunConfigSchema>;

export const EvaluationConfigSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string().min(1).optional(),
  runConfig: EvaluationConfigRunConfigSchema,
});
export type EvaluationConfig = z.infer<typeof EvaluationConfigSchema>;

export const EvaluationSpecSchema = z.object({
  datasetId: z.string().min(1),
  profileId: EvaluationProfileKindSchema.default("outcome"),
  configs: z.array(EvaluationConfigSchema).min(1),
  repetitions: z.number().int().positive().max(10).default(1),
  concurrency: z.number().int().positive().max(32).default(1),
  baselineId: z.string().min(1).optional(),
  metadata: z.record(z.unknown()).default({}),
});
export type EvaluationSpec = z.infer<typeof EvaluationSpecSchema>;

export const EvaluationAttemptStatusSchema = z.enum([
  "queued",
  "running",
  "succeeded",
  "failed",
]);
export type EvaluationAttemptStatus = z.infer<typeof EvaluationAttemptStatusSchema>;

export const EvaluationScoreSchema = z.object({
  outcomeScore: z.number().min(0).max(1),
  processScore: z.number().min(0).max(1),
  efficiencyScore: z.number().min(0).max(1),
  safetyScore: z.number().min(0).max(1),
  overallScore: z.number().min(0).max(1),
  judgeRationale: z.string().min(1),
  failureTags: z.array(z.string().min(1)).default([]),
});
export type EvaluationScore = z.infer<typeof EvaluationScoreSchema>;

export const EvaluationAttemptSchema = z.object({
  id: z.string().min(1),
  evaluationRunId: z.string().min(1),
  caseId: z.string().min(1),
  configId: z.string().min(1),
  repetition: z.number().int().positive(),
  status: EvaluationAttemptStatusSchema,
  underlyingRunId: z.string().min(1).optional(),
  output: z.unknown().optional(),
  error: z.string().optional(),
  score: EvaluationScoreSchema,
  runtimeMs: z.number().int().nonnegative().default(0),
  costUsd: z.number().nonnegative().default(0),
  startedAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});
export type EvaluationAttempt = z.infer<typeof EvaluationAttemptSchema>;

export const EvaluationComparisonSchema = z.object({
  compatible: z.boolean(),
  baselineId: z.string().min(1).optional(),
  baselineConfigId: z.string().min(1).optional(),
  deltaOverallScore: z.number().min(-1).max(1).optional(),
  regressed: z.boolean().default(false),
});
export type EvaluationComparison = z.infer<typeof EvaluationComparisonSchema>;

export const EvaluationCaseResultSchema = z.object({
  caseId: z.string().min(1),
  configId: z.string().min(1),
  attemptIds: z.array(z.string().min(1)).min(1),
  averageScore: EvaluationScoreSchema,
  latestOutput: z.unknown().optional(),
  expected: EvaluationExpectedSchema.optional(),
  metadata: z.record(z.unknown()).default({}),
  traceRunIds: z.array(z.string().min(1)).default([]),
  comparisonToBaseline: EvaluationComparisonSchema.optional(),
});
export type EvaluationCaseResult = z.infer<typeof EvaluationCaseResultSchema>;

export const EvaluationConfigSummarySchema = z.object({
  configId: z.string().min(1),
  label: z.string().min(1),
  overallScore: z.number().min(0).max(1),
  passRate: z.number().min(0).max(1),
  averageRuntimeMs: z.number().int().nonnegative(),
  averageCostUsd: z.number().nonnegative(),
  caseCount: z.number().int().nonnegative(),
  regressionCount: z.number().int().nonnegative(),
  failureTagCounts: z.record(z.number().int().nonnegative()).default({}),
});
export type EvaluationConfigSummary = z.infer<typeof EvaluationConfigSummarySchema>;

export const EvaluationSliceSummarySchema = z.object({
  dimension: z.string().min(1),
  value: z.string().min(1),
  configId: z.string().min(1),
  caseCount: z.number().int().nonnegative(),
  overallScore: z.number().min(0).max(1),
});
export type EvaluationSliceSummary = z.infer<typeof EvaluationSliceSummarySchema>;

export const EvaluationScorecardSchema = z.object({
  overallScore: z.number().min(0).max(1),
  passRate: z.number().min(0).max(1),
  averageRuntimeMs: z.number().int().nonnegative(),
  averageCostUsd: z.number().nonnegative(),
  regressionCount: z.number().int().nonnegative(),
  configSummaries: z.array(EvaluationConfigSummarySchema),
  slices: z.array(EvaluationSliceSummarySchema).default([]),
});
export type EvaluationScorecard = z.infer<typeof EvaluationScorecardSchema>;

export const EvaluationRunStatusSchema = z.enum([
  "queued",
  "running",
  "succeeded",
  "failed",
]);
export type EvaluationRunStatus = z.infer<typeof EvaluationRunStatusSchema>;

export const EvaluationRunSchema = z.object({
  id: z.string().min(1),
  spec: EvaluationSpecSchema,
  status: EvaluationRunStatusSchema,
  totalAttempts: z.number().int().nonnegative(),
  completedAttempts: z.number().int().nonnegative(),
  failedAttempts: z.number().int().nonnegative(),
  attemptIds: z.array(z.string().min(1)),
  caseResults: z.array(EvaluationCaseResultSchema),
  scorecard: EvaluationScorecardSchema,
  startedAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  completedAt: z.number().int().nonnegative().optional(),
});
export type EvaluationRun = z.infer<typeof EvaluationRunSchema>;

export const EvaluationRunDetailSchema = z.object({
  run: EvaluationRunSchema,
  attempts: z.array(EvaluationAttemptSchema),
  dataset: EvaluationDatasetSchema,
  configs: z.array(EvaluationConfigSchema),
});
export type EvaluationRunDetail = z.infer<typeof EvaluationRunDetailSchema>;

export const EvaluationBaselineSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  datasetId: z.string().min(1),
  profileId: EvaluationProfileKindSchema,
  configId: z.string().min(1),
  configSignature: z.string().min(1),
  evaluationRunId: z.string().min(1),
  createdAt: z.number().int().nonnegative(),
});
export type EvaluationBaseline = z.infer<typeof EvaluationBaselineSchema>;

export const EvaluationStreamEventSchema = z.object({
  id: z.string().min(1),
  evaluationRunId: z.string().min(1),
  seq: z.number().int().nonnegative(),
  type: z.enum([
    "evaluation.run.started",
    "evaluation.attempt.completed",
    "evaluation.run.completed",
    "evaluation.baseline.promoted",
  ]),
  createdAt: z.number().int().nonnegative(),
  payload: z.unknown(),
});
export type EvaluationStreamEvent = z.infer<typeof EvaluationStreamEventSchema>;

export const EvaluationRunStreamSchema = z.object({
  evaluationRunId: z.string().min(1),
  fromSeq: z.number().int().nonnegative(),
  events: z.array(EvaluationStreamEventSchema),
  nextSeq: z.number().int().nonnegative(),
});
export type EvaluationRunStream = z.infer<typeof EvaluationRunStreamSchema>;

export const EvaluationDatasetListParamsSchema = z.object({
  limit: z.number().int().positive().max(500).optional(),
});
export type EvaluationDatasetListParams = z.infer<typeof EvaluationDatasetListParamsSchema>;

export const EvaluationDatasetGetParamsSchema = z.object({
  datasetId: z.string().min(1),
});
export type EvaluationDatasetGetParams = z.infer<typeof EvaluationDatasetGetParamsSchema>;

export const EvaluationRunGetParamsSchema = z.object({
  evaluationRunId: z.string().min(1),
});
export type EvaluationRunGetParams = z.infer<typeof EvaluationRunGetParamsSchema>;

export const EvaluationRunListParamsSchema = z.object({
  datasetId: z.string().min(1).optional(),
  profileId: EvaluationProfileKindSchema.optional(),
  limit: z.number().int().positive().max(500).optional(),
});
export type EvaluationRunListParams = z.infer<typeof EvaluationRunListParamsSchema>;

export const EvaluationRunStreamParamsSchema = z.object({
  evaluationRunId: z.string().min(1),
  afterSeq: z.number().int().nonnegative().optional(),
});
export type EvaluationRunStreamParams = z.infer<typeof EvaluationRunStreamParamsSchema>;

export const EvaluationPromoteBaselineParamsSchema = z.object({
  evaluationRunId: z.string().min(1),
  configId: z.string().min(1),
  name: z.string().min(1).optional(),
});
export type EvaluationPromoteBaselineParams = z.infer<typeof EvaluationPromoteBaselineParamsSchema>;

export const EvaluationBaselineListParamsSchema = z.object({
  datasetId: z.string().min(1).optional(),
  profileId: EvaluationProfileKindSchema.optional(),
});
export type EvaluationBaselineListParams = z.infer<typeof EvaluationBaselineListParamsSchema>;

export const EvaluationExportFormatSchema = z.enum(["json", "csv"]);
export type EvaluationExportFormat = z.infer<typeof EvaluationExportFormatSchema>;

export const EvaluationExportParamsSchema = z.object({
  evaluationRunId: z.string().min(1),
  format: EvaluationExportFormatSchema.default("json"),
});
export type EvaluationExportParams = z.infer<typeof EvaluationExportParamsSchema>;

export const EvaluationExportResultSchema = z.object({
  evaluationRunId: z.string().min(1),
  format: EvaluationExportFormatSchema,
  content: z.string(),
});
export type EvaluationExportResult = z.infer<typeof EvaluationExportResultSchema>;

export const JsonRpcIdSchema = z.union([z.string(), z.number().int()]);

export const RuntimeJsonRpcMethodSchema = z.enum([
  "runtime.health",
  "runtime.bootstrap",
  "patterns.list",
  "modes.list",
  "modes.get",
  "modes.create",
  "modes.update",
  "modes.delete",
  "modes.validate",
  "modes.cloneFromPreset",
  "tools.list",
  "skills.list",
  "skills.get",
  "skills.create",
  "skills.update",
  "skills.delete",
  "skills.checkName",
  "skills.setEnabled",
  "providers.list",
  "agents.list",
  "agents.get",
  "agents.create",
  "agents.update",
  "agents.delete",
  "agents.checkName",
  "projects.create",
  "projects.list",
  "projects.get",
  "sessions.create",
  "sessions.list",
  "sessions.get",
  "runs.start",
  "runs.startStreaming",
  "runs.list",
  "runs.stream",
  "runs.interrupt",
  "runs.resume",
  "runs.cancel",
  "runs.state",
  "runs.trail",
  "runs.checkpoints",
  "runs.replay",
  "runs.fork",
  "runs.exportReport",
  "evaluation.datasets.import",
  "evaluation.datasets.list",
  "evaluation.datasets.get",
  "evaluation.runs.start",
  "evaluation.runs.list",
  "evaluation.runs.get",
  "evaluation.runs.stream",
  "evaluation.runs.promoteBaseline",
  "evaluation.runs.export",
  "evaluation.baselines.list"
]);
export type RuntimeJsonRpcMethod = z.infer<typeof RuntimeJsonRpcMethodSchema>;

export const JsonRpcRequestSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: JsonRpcIdSchema.optional(),
  method: RuntimeJsonRpcMethodSchema.or(z.string().min(1)),
  params: z.unknown().optional()
});
export type JsonRpcRequest = z.infer<typeof JsonRpcRequestSchema>;

export const JsonRpcErrorSchema = z.object({
  code: z.number().int(),
  message: z.string(),
  data: z.unknown().optional()
});
export type JsonRpcError = z.infer<typeof JsonRpcErrorSchema>;

export const JsonRpcSuccessResponseSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: JsonRpcIdSchema.nullable(),
  result: z.unknown()
});
export type JsonRpcSuccessResponse = z.infer<typeof JsonRpcSuccessResponseSchema>;

export const JsonRpcErrorResponseSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: JsonRpcIdSchema.nullable(),
  error: JsonRpcErrorSchema
});
export type JsonRpcErrorResponse = z.infer<typeof JsonRpcErrorResponseSchema>;

export const JsonRpcResponseSchema = z.union([
  JsonRpcSuccessResponseSchema,
  JsonRpcErrorResponseSchema
]);
export type JsonRpcResponse = z.infer<typeof JsonRpcResponseSchema>;

export const PatternDefinitionSchema = z.object({
  id: CoordinationPatternSchema,
  label: z.string().min(1),
  summary: z.string().min(1),
  recommendedUse: z.string().min(1),
  failureMode: z.string().min(1),
  coordinationKind: z.enum(["loop", "hierarchical", "team", "bus", "shared_state"]),
  stateModel: z.enum(["ephemeral", "persistent_workers", "event_routed", "shared_blackboard"]),
  supportsPersistentWorkers: z.boolean().default(false),
  supportsSharedState: z.boolean().default(false),
  supportsEventRouting: z.boolean().default(false),
  defaultStopPolicy: z.object({
    type: z.enum(["max_iterations", "queue_drained", "converged", "manual"]),
    maxIterations: z.number().int().positive().optional(),
    idleCycles: z.number().int().positive().optional(),
    detail: z.string().min(1)
  }),
  defaultConstraints: z.array(z.string().min(1)),
  defaultBudget: ResourceBudgetSchema,
  profiles: z.array(AgentProfileSchema).min(1),
  topology: z.object({
    nodes: z.array(TopologyNodeSchema),
    edges: z.array(TopologyEdgeSchema)
  }),
  planTemplate: z.array(
    z.object({
      id: z.string().min(1),
      title: z.string().min(1),
      ownerAgentId: z.string().min(1).optional(),
      dependencies: z.array(z.string().min(1)).default([])
    })
  )
});
export type PatternDefinition = z.infer<typeof PatternDefinitionSchema>;

export const ModeStopPolicySchema = z.object({
  type: z.enum(["max_iterations", "queue_drained", "converged", "manual"]),
  maxIterations: z.number().int().positive().optional(),
  idleCycles: z.number().int().positive().optional(),
  detail: z.string().min(1),
});
export type ModeStopPolicy = z.infer<typeof ModeStopPolicySchema>;

export const ModeNodeTemplateSchema = z.enum([
  "draft",
  "verify",
  "decide",
  "decompose",
  "research",
  "review",
  "synthesize",
  "triage",
  "build",
  "check",
  "handoff",
  "publish",
  "route",
  "handle",
  "respond",
  "seed",
  "converge",
]);
export type ModeNodeTemplate = z.infer<typeof ModeNodeTemplateSchema>;

export const ModeNodePositionSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
});
export type ModeNodePosition = z.infer<typeof ModeNodePositionSchema>;

export const ModeNodeSpecSchema = z.object({
  id: z.string().min(1),
  template: ModeNodeTemplateSchema,
  label: z.string().min(1),
  title: z.string().min(1).optional(),
  ownerAgentId: z.string().min(1).optional(),
  position: ModeNodePositionSchema.optional(),
  enabled: z.boolean().default(true),
  prompt: z.string().min(1).optional(),
  riskLevel: ActionRiskLevelSchema.optional(),
  config: z.record(z.unknown()).default({}),
});
export type ModeNodeSpec = z.infer<typeof ModeNodeSpecSchema>;

export const ModeEdgeSpecSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  label: z.string().min(1).optional(),
  kind: TopologyEdgeSchema.shape.kind.default("control"),
  enabled: z.boolean().default(true),
});
export type ModeEdgeSpec = z.infer<typeof ModeEdgeSpecSchema>;

export const ModeRuntimeAtomIdSchema = z.enum([
  "thread_workspace",
  "recovery_policy",
  "tool_error_boundary",
  "loop_guard",
  "clarification_interrupt",
  "memory_capture",
  "deferred_tool_discovery",
  "subagent_delegate",
  "persistent_worker_memory",
  "event_routing",
  "shared_blackboard",
  "artifact_publish",
  "token_usage_trace",
]);
export type ModeRuntimeAtomId = z.infer<typeof ModeRuntimeAtomIdSchema>;

export const ModeRuntimeAtomScopeSchema = z.enum(["mode", "node"]);
export type ModeRuntimeAtomScope = z.infer<typeof ModeRuntimeAtomScopeSchema>;

export const ModeRuntimeAtomTopologyPresentationSchema = z.enum([
  "mode_capability",
  "stage_attachment",
  "family_capability",
]);
export type ModeRuntimeAtomTopologyPresentation = z.infer<typeof ModeRuntimeAtomTopologyPresentationSchema>;

export const ModeRuntimeAtomTopologySchema = z.object({
  presentation: ModeRuntimeAtomTopologyPresentationSchema,
  builtinNodeId: z.string().min(1).optional(),
  edgeKind: TopologyEdgeSchema.shape.kind.default("control"),
  edgeLabel: z.string().min(1).optional(),
});
export type ModeRuntimeAtomTopology = z.infer<typeof ModeRuntimeAtomTopologySchema>;

export const ModeRuntimeAtomDefinitionSchema = z.object({
  id: ModeRuntimeAtomIdSchema,
  scope: ModeRuntimeAtomScopeSchema,
  label: z.string().min(1),
  description: z.string().min(1),
  compatibleFamilies: z.array(CoordinationPatternSchema).min(1),
  requiresTools: z.array(z.string().min(1)).default([]),
  requiresFlags: z.array(z.string().min(1)).default([]),
  topology: ModeRuntimeAtomTopologySchema,
  defaultEnabled: z.boolean().default(false),
});
export type ModeRuntimeAtomDefinition = z.infer<typeof ModeRuntimeAtomDefinitionSchema>;

export const ModeCapabilityFlagsSchema = z.object({
  supportsPersistentWorkers: z.boolean().default(false),
  supportsSharedState: z.boolean().default(false),
  supportsEventRouting: z.boolean().default(false),
  approvalMode: z.enum(["auto", "manual", "high_risk_only"]).default("high_risk_only"),
  skillIds: z.array(z.string().min(1)).default([]),
  toolIds: z.array(z.string().min(1)).default([]),
});
export type ModeCapabilityFlags = z.infer<typeof ModeCapabilityFlagsSchema>;

export const ModeEditorConstraintsSchema = z.object({
  allowedNodeTemplates: z.array(ModeNodeTemplateSchema).default([]),
  requiredNodeTemplates: z.array(ModeNodeTemplateSchema).default([]),
  readOnly: z.boolean().default(false),
  allowReorder: z.boolean().default(true),
  allowCreate: z.boolean().default(true),
  allowDelete: z.boolean().default(true),
  allowDisable: z.boolean().default(true),
});
export type ModeEditorConstraints = z.infer<typeof ModeEditorConstraintsSchema>;

export const ModeSpecSchema = z.object({
  id: ModeIdSchema,
  family: CoordinationPatternSchema,
  label: z.string().min(1),
  summary: z.string().min(1),
  description: z.string().min(1).optional(),
  recommendedUse: z.string().min(1).optional(),
  failureMode: z.string().min(1).optional(),
  systemPreset: z.boolean().default(false),
  nodes: z.array(ModeNodeSpecSchema).min(1),
  edges: z.array(ModeEdgeSpecSchema).default([]),
  stopPolicy: ModeStopPolicySchema,
  capabilityFlags: ModeCapabilityFlagsSchema,
  editorConstraints: ModeEditorConstraintsSchema,
  defaultBudget: ResourceBudgetSchema,
  profiles: z.array(AgentProfileSchema).min(1),
  runtimeAtoms: z.array(ModeRuntimeAtomIdSchema).default([]),
  recoveryPolicy: ModeRecoveryPolicySchema.default(DEFAULT_MODE_RECOVERY_POLICY),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});
export type ModeSpec = z.infer<typeof ModeSpecSchema>;

export const ModeValidationResultSchema = z.object({
  valid: z.boolean(),
  errors: z.array(z.string().min(1)).default([]),
  warnings: z.array(z.string().min(1)).default([]),
});
export type ModeValidationResult = z.infer<typeof ModeValidationResultSchema>;

export const ModeGetParamsSchema = z.object({
  modeId: ModeIdSchema,
});
export type ModeGetParams = z.infer<typeof ModeGetParamsSchema>;

export const ModeDeleteParamsSchema = z.object({
  modeId: ModeIdSchema,
});
export type ModeDeleteParams = z.infer<typeof ModeDeleteParamsSchema>;

export const ModeCloneParamsSchema = z.object({
  sourceModeId: ModeIdSchema,
  modeId: ModeIdSchema.optional(),
  label: z.string().min(1).optional(),
});
export type ModeCloneParams = z.infer<typeof ModeCloneParamsSchema>;

export const ModeCreateParamsSchema = ModeSpecSchema.omit({
  systemPreset: true,
  createdAt: true,
  updatedAt: true,
});
export type ModeCreateParams = z.infer<typeof ModeCreateParamsSchema>;

export const ModeUpdateParamsSchema = z.object({
  modeId: ModeIdSchema,
  spec: ModeCreateParamsSchema,
});
export type ModeUpdateParams = z.infer<typeof ModeUpdateParamsSchema>;

export const ModeValidateParamsSchema = z.object({
  spec: ModeSpecSchema.or(ModeCreateParamsSchema),
});
export type ModeValidateParams = z.infer<typeof ModeValidateParamsSchema>;

export const DEFAULT_RESOURCE_BUDGETS: Record<CoordinationPattern, ResourceBudget> = {
  generator_verifier: {
    maxTokens: 12000,
    maxToolCalls: 8,
    maxRuntimeMs: 180000,
    maxCostUsd: 2
  },
  orchestrator_subagent: {
    maxTokens: 18000,
    maxToolCalls: 16,
    maxRuntimeMs: 300000,
    maxCostUsd: 3
  },
  agent_teams: {
    maxTokens: 24000,
    maxToolCalls: 24,
    maxRuntimeMs: 600000,
    maxCostUsd: 5
  },
  message_bus: {
    maxTokens: 20000,
    maxToolCalls: 18,
    maxRuntimeMs: 360000,
    maxCostUsd: 4
  },
  shared_state: {
    maxTokens: 22000,
    maxToolCalls: 20,
    maxRuntimeMs: 420000,
    maxCostUsd: 4
  }
};

const MODE_FAMILY_RULES: Record<
  CoordinationPattern,
  {
    allowedTemplates: ModeNodeTemplate[];
    requiredTemplates: ModeNodeTemplate[];
    stopPolicyTypes: ModeStopPolicy["type"][];
  }
> = {
  generator_verifier: {
    allowedTemplates: ["draft", "verify", "decide"],
    requiredTemplates: ["draft", "verify"],
    stopPolicyTypes: ["max_iterations", "manual"],
  },
  orchestrator_subagent: {
    allowedTemplates: ["decompose", "research", "review", "synthesize"],
    requiredTemplates: ["decompose", "synthesize"],
    stopPolicyTypes: ["queue_drained", "manual"],
  },
  agent_teams: {
    allowedTemplates: ["triage", "build", "check", "handoff"],
    requiredTemplates: ["triage", "handoff"],
    stopPolicyTypes: ["queue_drained", "manual"],
  },
  message_bus: {
    allowedTemplates: ["publish", "route", "handle", "respond"],
    requiredTemplates: ["publish", "route", "respond"],
    stopPolicyTypes: ["queue_drained", "manual"],
  },
  shared_state: {
    allowedTemplates: ["seed", "research", "converge"],
    requiredTemplates: ["seed", "converge"],
    stopPolicyTypes: ["converged", "manual"],
  },
};

export interface ModeNodeRuntimeTemplateDefinition {
  description: string;
  supportsPromptOverride: boolean;
  fallbackPrompt?: string;
  promptVariables: string[];
}

type StoredModeNodeRuntimeTemplateDefinition = Omit<ModeNodeRuntimeTemplateDefinition, "promptVariables">;

const MODE_NODE_RUNTIME_TEMPLATE_LIBRARY: Record<
  CoordinationPattern,
  Partial<Record<ModeNodeTemplate, StoredModeNodeRuntimeTemplateDefinition>>
> = {
  generator_verifier: {
    draft: {
      description: "Draft a candidate answer for verifier review.",
      supportsPromptOverride: true,
      fallbackPrompt: "Prompt: {{prompt}}\nAttempt: {{attempt}}\nPrevious verifier notes:\n{{verifierNotes}}\nWrite a better candidate answer. Return only the candidate response.",
    },
    verify: {
      description: "Evaluate the candidate against the current rubric.",
      supportsPromptOverride: true,
      fallbackPrompt: "Original prompt: {{prompt}}\nRubric:\n- {{rubric}}\nCandidate:\n{{candidate}}\nReturn JSON with keys verdict ('pass'|'fail'), rationale, and missingRequirements (array of strings).",
    },
    decide: {
      description: "Reserved stage for a future explicit accept/retry decision step.",
      supportsPromptOverride: false,
    },
  },
  orchestrator_subagent: {
    decompose: {
      description: "Break the task into inspectable orchestration steps.",
      supportsPromptOverride: true,
      fallbackPrompt: "Task: {{prompt}}\nDecompose it into research, review, and synthesis responsibilities.",
    },
    research: {
      description: "Collect focused supporting context from the decomposition plan.",
      supportsPromptOverride: true,
      fallbackPrompt: "Task: {{prompt}}\nGather focused supporting context for the orchestration plan:\n{{plan}}",
    },
    review: {
      description: "Review findings and surface risks or missing pieces.",
      supportsPromptOverride: true,
      fallbackPrompt: "Task: {{prompt}}\nPlan:\n{{plan}}\nResearch:\n{{research}}\nReview completeness, risks, and missing pieces.",
    },
    synthesize: {
      description: "Combine plan, research, and review into the final answer.",
      supportsPromptOverride: true,
      fallbackPrompt: "Task: {{prompt}}\nPlan:\n{{plan}}\nResearch:\n{{research}}\nReview:\n{{review}}\nProduce the final orchestrated answer.",
    },
  },
  agent_teams: {
    triage: {
      description: "Turn the task into a compact team backlog.",
      supportsPromptOverride: true,
      fallbackPrompt: "Task: {{prompt}}\nBreak the work into a team backlog with explicit ownership.",
    },
    build: {
      description: "Complete the assigned backlog item.",
      supportsPromptOverride: true,
      fallbackPrompt: "Task: {{prompt}}\nBacklog:\n{{triage}}\nComplete the builder's assigned work.",
    },
    check: {
      description: "Validate builder output and report issues or approval.",
      supportsPromptOverride: true,
      fallbackPrompt: "Task: {{prompt}}\nBacklog:\n{{triage}}\nBuilder output:\n{{build}}\nValidate the work and report issues or approval.",
    },
    handoff: {
      description: "Summarize handoff state and the next action.",
      supportsPromptOverride: true,
      fallbackPrompt: "Task: {{prompt}}\nBacklog:\n{{triage}}\nBuilder:\n{{build}}\nChecker:\n{{check}}\nRecord the handoff and next action.",
    },
  },
  message_bus: {
    publish: {
      description: "Publish the initial input event to the bus.",
      supportsPromptOverride: false,
    },
    route: {
      description: "Classify the incoming event and choose the subscriber path.",
      supportsPromptOverride: true,
      fallbackPrompt: "Task: {{prompt}}\nClassify the incoming event and decide which topic/subscriber should receive it.",
    },
    handle: {
      description: "Process the routed work item and emit findings.",
      supportsPromptOverride: true,
      fallbackPrompt: "Task: {{prompt}}\nRouting plan:\n{{routingPlan}}\nProduce the investigation findings for the subscribed work item.",
    },
    respond: {
      description: "Turn bus findings into the final response event.",
      supportsPromptOverride: true,
      fallbackPrompt: "Task: {{prompt}}\nRouting plan:\n{{routingPlan}}\nFindings:\n{{findings}}\nProduce the final routed response.",
    },
  },
  shared_state: {
    seed: {
      description: "Create the initial shared-state board.",
      supportsPromptOverride: true,
      fallbackPrompt: "Task: {{prompt}}\nCreate the initial shared-state board for collaborative work.",
    },
    research: {
      description: "Add the next meaningful finding to the shared board.",
      supportsPromptOverride: true,
      fallbackPrompt: "Task: {{prompt}}\nCurrent shared board:\n{{sharedBoard}}\nAdd the next finding that other agents should build on.",
    },
    converge: {
      description: "Review the board and decide whether it has converged.",
      supportsPromptOverride: true,
      fallbackPrompt: "Task: {{prompt}}\nShared board:\n{{sharedBoard}}\nDecide whether the board has converged and summarize the conclusion.",
    },
  },
};

function extractMustacheVariables(template: string | undefined): string[] {
  if (!template) {
    return [];
  }
  const variables = new Set<string>();
  for (const match of template.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)) {
    if (match[1]) {
      variables.add(match[1]);
    }
  }
  return [...variables];
}

const profile = (
  id: string,
  label: string,
  role: string,
  pattern: CoordinationPattern,
  namespaces: string[]
): AgentProfile => ({
  id,
  label,
  role,
  modelRef: "local/smoke-model",
  toolPolicyId: `${pattern}.default_policy`,
  memoryNamespaces: namespaces,
  budget: DEFAULT_RESOURCE_BUDGETS[pattern]
});

const ALL_COORDINATION_PATTERNS = [...CoordinationPatternSchema.options] as CoordinationPattern[];

export const MVP_MODE_RUNTIME_ATOMS: ModeRuntimeAtomDefinition[] = [
  {
    id: "thread_workspace",
    scope: "mode",
    label: "Thread Workspace",
    description: "Provision a per-run workspace and thread-scoped paths before execution starts.",
    compatibleFamilies: ["orchestrator_subagent", "agent_teams"],
    requiresTools: [],
    requiresFlags: [],
    topology: {
      presentation: "mode_capability",
      edgeKind: "control",
      edgeLabel: "workspace",
    },
    defaultEnabled: true,
  },
  {
    id: "recovery_policy",
    scope: "mode",
    label: "Recovery Policy",
    description: "Apply configured retry, alternate-tool, skip, and degraded-artifact recovery rules across runtime boundaries.",
    compatibleFamilies: ALL_COORDINATION_PATTERNS,
    requiresTools: [],
    requiresFlags: [],
    topology: {
      presentation: "mode_capability",
      edgeKind: "control",
      edgeLabel: "recover",
    },
    defaultEnabled: true,
  },
  {
    id: "tool_error_boundary",
    scope: "mode",
    label: "Tool Error Boundary",
    description: "Convert tool and provider failures into structured runtime events instead of aborting immediately.",
    compatibleFamilies: ALL_COORDINATION_PATTERNS,
    requiresTools: [],
    requiresFlags: [],
    topology: {
      presentation: "mode_capability",
      edgeKind: "control",
      edgeLabel: "guard",
    },
    defaultEnabled: true,
  },
  {
    id: "loop_guard",
    scope: "mode",
    label: "Loop Guard",
    description: "Detect repetitive tool or action loops and force the run to wrap up safely.",
    compatibleFamilies: ALL_COORDINATION_PATTERNS,
    requiresTools: [],
    requiresFlags: [],
    topology: {
      presentation: "mode_capability",
      edgeKind: "control",
      edgeLabel: "bound",
    },
    defaultEnabled: true,
  },
  {
    id: "clarification_interrupt",
    scope: "mode",
    label: "Clarification Interrupt",
    description: "Pause execution when the mode needs missing user input before continuing.",
    compatibleFamilies: ALL_COORDINATION_PATTERNS,
    requiresTools: [],
    requiresFlags: [],
    topology: {
      presentation: "mode_capability",
      edgeKind: "control",
      edgeLabel: "interrupt",
    },
    defaultEnabled: true,
  },
  {
    id: "memory_capture",
    scope: "mode",
    label: "Memory Capture",
    description: "Queue run summaries into session or project memory after meaningful progress.",
    compatibleFamilies: ALL_COORDINATION_PATTERNS,
    requiresTools: [],
    requiresFlags: [],
    topology: {
      presentation: "mode_capability",
      edgeKind: "memory",
      edgeLabel: "capture",
    },
    defaultEnabled: true,
  },
  {
    id: "deferred_tool_discovery",
    scope: "node",
    label: "Deferred Tool Discovery",
    description: "Expose lightweight tool metadata first and promote full schemas on demand.",
    compatibleFamilies: ["orchestrator_subagent"],
    requiresTools: ["mcp.call"],
    requiresFlags: [],
    topology: {
      presentation: "stage_attachment",
      edgeKind: "control",
      edgeLabel: "discover",
    },
    defaultEnabled: false,
  },
  {
    id: "subagent_delegate",
    scope: "node",
    label: "Subagent Delegate",
    description: "Run a stage as a delegated task with explicit lifecycle events and handoff records.",
    compatibleFamilies: ["orchestrator_subagent", "agent_teams"],
    requiresTools: ["model.handoff"],
    requiresFlags: [],
    topology: {
      presentation: "stage_attachment",
      edgeKind: "delegation",
      edgeLabel: "delegate",
    },
    defaultEnabled: false,
  },
  {
    id: "persistent_worker_memory",
    scope: "mode",
    label: "Persistent Worker Memory",
    description: "Persist worker-specific memory across runs so long-lived team roles can accumulate context.",
    compatibleFamilies: ["agent_teams"],
    requiresTools: [],
    requiresFlags: ["supportsPersistentWorkers"],
    topology: {
      presentation: "mode_capability",
      edgeKind: "memory",
      edgeLabel: "retain",
    },
    defaultEnabled: true,
  },
  {
    id: "event_routing",
    scope: "mode",
    label: "Event Routing",
    description: "Track routed topics, subscribers, and correlation records as first-class runtime state.",
    compatibleFamilies: ["message_bus"],
    requiresTools: ["message.publish"],
    requiresFlags: ["supportsEventRouting"],
    topology: {
      presentation: "family_capability",
      builtinNodeId: "triage_topic",
      edgeKind: "artifact",
      edgeLabel: "route",
    },
    defaultEnabled: true,
  },
  {
    id: "shared_blackboard",
    scope: "mode",
    label: "Shared Blackboard",
    description: "Maintain a versioned shared board with explicit convergence state across collaborators.",
    compatibleFamilies: ["shared_state"],
    requiresTools: ["shared_state.write"],
    requiresFlags: ["supportsSharedState"],
    topology: {
      presentation: "family_capability",
      builtinNodeId: "shared_board",
      edgeKind: "memory",
      edgeLabel: "board",
    },
    defaultEnabled: true,
  },
  {
    id: "artifact_publish",
    scope: "node",
    label: "Artifact Publish",
    description: "Promote stage outputs into explicit runtime artifacts and handoff surfaces.",
    compatibleFamilies: ["agent_teams", "message_bus", "shared_state"],
    requiresTools: ["export.report"],
    requiresFlags: [],
    topology: {
      presentation: "stage_attachment",
      edgeKind: "artifact",
      edgeLabel: "publish",
    },
    defaultEnabled: false,
  },
  {
    id: "token_usage_trace",
    scope: "mode",
    label: "Token Usage Trace",
    description: "Attach token usage and budget accounting to runtime events and reports.",
    compatibleFamilies: ALL_COORDINATION_PATTERNS,
    requiresTools: [],
    requiresFlags: [],
    topology: {
      presentation: "mode_capability",
      edgeKind: "control",
      edgeLabel: "trace",
    },
    defaultEnabled: false,
  },
];

export function getModeRuntimeAtom(id: ModeRuntimeAtomId): ModeRuntimeAtomDefinition {
  const atom = MVP_MODE_RUNTIME_ATOMS.find((candidate) => candidate.id === id);
  if (!atom) {
    throw new Error(`Unknown runtime atom '${id}'.`);
  }
  return atom;
}

export function defaultRuntimeAtomsForFamily(family: CoordinationPattern): ModeRuntimeAtomId[] {
  return MVP_MODE_RUNTIME_ATOMS
    .filter((atom) => atom.defaultEnabled && atom.compatibleFamilies.includes(family))
    .map((atom) => atom.id);
}

export function nodeRuntimeAtomIds(node: Pick<ModeNodeSpec, "config">): ModeRuntimeAtomId[] {
  return Array.isArray(node.config?.atoms)
    ? node.config.atoms.filter((value): value is ModeRuntimeAtomId => ModeRuntimeAtomIdSchema.safeParse(value).success)
    : [];
}

function modeUsesSingleOwnerTopology(mode: ModeSpec, orderedNodes: ModeNodeSpec[]): boolean {
  const fallbackAgentId = mode.profiles[0]?.id;
  const ownerIds = new Set(
    orderedNodes.map((node) => node.ownerAgentId ?? fallbackAgentId).filter((id): id is string => typeof id === "string"),
  );
  return ownerIds.size <= 1 && !orderedNodes.some((node) => nodeRuntimeAtomIds(node).includes("subagent_delegate"));
}

function modePrimaryOwnerAgent(mode: ModeSpec, orderedNodes: ModeNodeSpec[]): AgentProfile | undefined {
  const ownerAgentId = orderedNodes.find((node) => node.ownerAgentId)?.ownerAgentId ?? mode.profiles[0]?.id;
  return mode.profiles.find((profile) => profile.id === ownerAgentId) ?? mode.profiles[0];
}

function applyModeTopologyMetadata(
  mode: ModeSpec,
  orderedNodes: ModeNodeSpec[],
  node: TopologyNode,
): TopologyNode {
  return {
    ...node,
    metadata: {
      ...node.metadata,
      modeId: mode.id,
      enabledNodeIds: orderedNodes.map((item) => item.id),
    },
  };
}

function applyModeEdgeMetadata(mode: ModeSpec, edge: TopologyEdge): TopologyEdge {
  return {
    ...edge,
    metadata: {
      ...edge.metadata,
      modeId: mode.id,
    },
  };
}

function runtimeBaseTopology(
  mode: ModeSpec,
  family: PatternDefinition,
  orderedNodes: ModeNodeSpec[],
): { nodes: TopologyNode[]; edges: TopologyEdge[] } {
  if (modeUsesSingleOwnerTopology(mode, orderedNodes)) {
    const primaryAgent = modePrimaryOwnerAgent(mode, orderedNodes);
    const agentId = primaryAgent?.id ?? orderedNodes[0]?.id ?? "agent";
    const agentLabel = primaryAgent?.label ?? orderedNodes[0]?.label ?? "Agent";
    return {
      nodes: [
        applyModeTopologyMetadata(mode, orderedNodes, {
          id: "run",
          label: "Run",
          kind: "run",
          status: "idle",
          metadata: {},
        }),
        applyModeTopologyMetadata(mode, orderedNodes, {
          id: agentId,
          label: agentLabel,
          kind: "agent",
          agentId,
          status: "idle",
          metadata: {},
        }),
      ],
      edges: [
        applyModeEdgeMetadata(mode, {
          id: `run-${agentId}`,
          source: "run",
          target: agentId,
          kind: "control",
          label: "own task",
          metadata: {},
        }),
      ],
    };
  }

  return {
    nodes: family.topology.nodes.map((node) => applyModeTopologyMetadata(mode, orderedNodes, node)),
    edges: family.topology.edges.map((edge) => applyModeEdgeMetadata(mode, edge)),
  };
}

function runtimeTopologyAnchorId(
  topologyNodes: TopologyNode[],
  node: ModeNodeSpec,
): string {
  const owner = typeof node.ownerAgentId === "string" && node.ownerAgentId.length > 0
    ? topologyNodes.find((candidate) => candidate.id === node.ownerAgentId || candidate.agentId === node.ownerAgentId)
    : undefined;
  if (owner) {
    return owner.id;
  }

  const direct = topologyNodes.find((candidate) => candidate.id === node.id);
  if (direct) {
    return direct.id;
  }

  return topologyNodes.find((candidate) => candidate.kind === "run")?.id ?? topologyNodes[0]?.id ?? node.id;
}

function modeCapabilityNode(atom: ModeRuntimeAtomDefinition, mode: ModeSpec, orderedNodes: ModeNodeSpec[]): TopologyNode {
  return {
    id: `capability:${atom.id}`,
    label: atom.label,
    kind: "capability",
    status: "idle",
    metadata: {
      modeId: mode.id,
      enabledNodeIds: orderedNodes.map((item) => item.id),
      atomId: atom.id,
      atomScope: atom.scope,
      atomPresentation: atom.topology.presentation,
      atomActive: true,
    },
  };
}

function nodeAttachmentCapabilityNode(
  atom: ModeRuntimeAtomDefinition,
  mode: ModeSpec,
  orderedNodes: ModeNodeSpec[],
  node: ModeNodeSpec,
): TopologyNode {
  return {
    id: `capability:${node.id}:${atom.id}`,
    label: atom.label,
    kind: "capability",
    status: "idle",
    metadata: {
      modeId: mode.id,
      enabledNodeIds: orderedNodes.map((item) => item.id),
      atomId: atom.id,
      atomScope: atom.scope,
      atomPresentation: atom.topology.presentation,
      atomActive: true,
      sourceNodeId: node.id,
      sourceNodeLabel: node.label,
      ownerAgentId: node.ownerAgentId,
    },
  };
}

export function projectModeRuntimeTopology(mode: ModeSpec): { nodes: TopologyNode[]; edges: TopologyEdge[] } {
  const family = getPatternDefinition(mode.family);
  const orderedNodes = orderedEnabledModeNodes(mode);
  const topology = runtimeBaseTopology(mode, family, orderedNodes);
  const nodes = [...topology.nodes];
  const edges = [...topology.edges];
  const nodeIds = new Set(nodes.map((node) => node.id));
  const activeModeAtoms = new Set(mode.runtimeAtoms);

  for (const atom of MVP_MODE_RUNTIME_ATOMS.filter((candidate) => candidate.scope === "mode" && candidate.compatibleFamilies.includes(mode.family))) {
    if (atom.topology.presentation === "family_capability" && atom.topology.builtinNodeId) {
      const index = nodes.findIndex((node) => node.id === atom.topology.builtinNodeId);
      if (index >= 0) {
        nodes[index] = {
          ...nodes[index]!,
          metadata: {
            ...nodes[index]!.metadata,
            atomId: atom.id,
            atomScope: atom.scope,
            atomPresentation: atom.topology.presentation,
            atomActive: activeModeAtoms.has(atom.id),
          },
        };
      }
      continue;
    }

    if (!activeModeAtoms.has(atom.id)) {
      continue;
    }

    const capabilityNode = modeCapabilityNode(atom, mode, orderedNodes);
    if (!nodeIds.has(capabilityNode.id)) {
      nodes.push(capabilityNode);
      nodeIds.add(capabilityNode.id);
    }
    const anchorId = nodes.find((node) => node.kind === "run")?.id ?? nodes[0]?.id;
    if (anchorId) {
      edges.push(applyModeEdgeMetadata(mode, {
        id: `${anchorId}-${capabilityNode.id}`,
        source: anchorId,
        target: capabilityNode.id,
        kind: atom.topology.edgeKind,
        label: atom.topology.edgeLabel,
        metadata: {
          atomId: atom.id,
          atomScope: atom.scope,
          atomPresentation: atom.topology.presentation,
        },
      }));
    }
  }

  for (const node of orderedNodes) {
    for (const atomId of nodeRuntimeAtomIds(node)) {
      const atom = getModeRuntimeAtom(atomId);
      if (atom.scope !== "node" || atom.topology.presentation !== "stage_attachment") {
        continue;
      }
      const capabilityNode = nodeAttachmentCapabilityNode(atom, mode, orderedNodes, node);
      if (!nodeIds.has(capabilityNode.id)) {
        nodes.push(capabilityNode);
        nodeIds.add(capabilityNode.id);
      }
      const anchorId = runtimeTopologyAnchorId(nodes, node);
      edges.push(applyModeEdgeMetadata(mode, {
        id: `${anchorId}-${capabilityNode.id}`,
        source: anchorId,
        target: capabilityNode.id,
        kind: atom.topology.edgeKind,
        label: atom.topology.edgeLabel,
        metadata: {
          atomId: atom.id,
          atomScope: atom.scope,
          atomPresentation: atom.topology.presentation,
          sourceNodeId: node.id,
        },
      }));
    }
  }

  return {
    nodes,
    edges,
  };
}

export const MVP_PATTERN_DEFINITIONS: Record<CoordinationPattern, PatternDefinition> = {
  generator_verifier: {
    id: "generator_verifier",
    label: "Generator-Verifier",
    summary: "A generator proposes an answer and a verifier checks it against a rubric.",
    recommendedUse: "Use when quality can be judged by explicit acceptance criteria.",
    failureMode: "Weak rubrics can create false confidence or unproductive retry loops.",
    coordinationKind: "loop",
    stateModel: "ephemeral",
    supportsPersistentWorkers: false,
    supportsSharedState: false,
    supportsEventRouting: false,
    defaultStopPolicy: {
      type: "max_iterations",
      maxIterations: 3,
      detail: "Stop after the verifier accepts the output or the retry budget is exhausted."
    },
    defaultConstraints: [
      "Require a clear rubric before verification.",
      "Keep retries bounded.",
      "Emit verifier findings as structured events."
    ],
    defaultBudget: DEFAULT_RESOURCE_BUDGETS.generator_verifier,
    profiles: [
      profile("generator", "Generator", "Produce the candidate answer.", "generator_verifier", [
        "session",
        "project"
      ]),
      profile("verifier", "Verifier", "Evaluate the answer against the rubric.", "generator_verifier", [
        "session",
        "project",
        "artifact"
      ])
    ],
    topology: {
      nodes: [
        { id: "run", label: "Run", kind: "run", status: "idle", metadata: {} },
        { id: "generator", label: "Generator", kind: "agent", agentId: "generator", status: "idle", metadata: {} },
        { id: "verifier", label: "Verifier", kind: "agent", agentId: "verifier", status: "idle", metadata: {} }
      ],
      edges: [
        { id: "run-generator", source: "run", target: "generator", kind: "control", label: "draft", metadata: {} },
        { id: "generator-verifier", source: "generator", target: "verifier", kind: "verification", label: "check", metadata: {} }
      ]
    },
    planTemplate: [
      { id: "draft", title: "Draft candidate output", ownerAgentId: "generator", dependencies: [] },
      { id: "verify", title: "Verify against rubric", ownerAgentId: "verifier", dependencies: ["draft"] }
    ]
  },
  orchestrator_subagent: {
    id: "orchestrator_subagent",
    label: "Orchestrator-Subagent",
    summary: "An orchestrator decomposes the task and dispatches explicit subagents.",
    recommendedUse: "Use as the default for decomposable tasks needing inspectable delegation.",
    failureMode: "Over-decomposition can spend budget on coordination instead of progress.",
    coordinationKind: "hierarchical",
    stateModel: "ephemeral",
    supportsPersistentWorkers: false,
    supportsSharedState: false,
    supportsEventRouting: false,
    defaultStopPolicy: {
      type: "queue_drained",
      detail: "Stop when the orchestrator has synthesized all delegated subagent results."
    },
    defaultConstraints: [
      "Keep subagents explicit in topology.",
      "Track plan items as Ora-owned records.",
      "Expose subagent state without leaking graph internals."
    ],
    defaultBudget: DEFAULT_RESOURCE_BUDGETS.orchestrator_subagent,
    profiles: [
      profile("orchestrator", "Orchestrator", "Plan, dispatch, and synthesize results.", "orchestrator_subagent", [
        "session",
        "project"
      ]),
      profile("researcher", "Research Subagent", "Gather focused context.", "orchestrator_subagent", [
        "session",
        "project"
      ]),
      profile("reviewer", "Review Subagent", "Check completeness and risks.", "orchestrator_subagent", [
        "session",
        "artifact"
      ])
    ],
    topology: {
      nodes: [
        { id: "run", label: "Run", kind: "run", status: "idle", metadata: {} },
        { id: "orchestrator", label: "Orchestrator", kind: "agent", agentId: "orchestrator", status: "idle", metadata: {} },
        { id: "researcher", label: "Research", kind: "agent", agentId: "researcher", status: "idle", metadata: {} },
        { id: "reviewer", label: "Review", kind: "agent", agentId: "reviewer", status: "idle", metadata: {} }
      ],
      edges: [
        { id: "run-orchestrator", source: "run", target: "orchestrator", kind: "control", metadata: {} },
        { id: "orchestrator-researcher", source: "orchestrator", target: "researcher", kind: "delegation", label: "research", metadata: {} },
        { id: "orchestrator-reviewer", source: "orchestrator", target: "reviewer", kind: "delegation", label: "review", metadata: {} }
      ]
    },
    planTemplate: [
      { id: "decompose", title: "Decompose task into inspectable plan", ownerAgentId: "orchestrator", dependencies: [] },
      { id: "research", title: "Gather focused supporting context", ownerAgentId: "researcher", dependencies: ["decompose"] },
      { id: "review", title: "Review result and surface risks", ownerAgentId: "reviewer", dependencies: ["research"] },
      { id: "synthesize", title: "Synthesize final response", ownerAgentId: "orchestrator", dependencies: ["review"] }
    ]
  },
  agent_teams: {
    id: "agent_teams",
    label: "Agent Teams",
    summary: "Persistent teammate agents coordinate around a shared backlog and memory.",
    recommendedUse: "Use when long-running workers need identity and context across tasks.",
    failureMode: "Unclear ownership can create duplicate work or stale worker memory.",
    coordinationKind: "team",
    stateModel: "persistent_workers",
    supportsPersistentWorkers: true,
    supportsSharedState: false,
    supportsEventRouting: false,
    defaultStopPolicy: {
      type: "queue_drained",
      detail: "Stop when the shared backlog is drained and the coordinator has collected all worker outcomes."
    },
    defaultConstraints: [
      "Assign every plan item to an owner.",
      "Keep worker memory namespaces explicit.",
      "Summarize team handoffs in the event stream."
    ],
    defaultBudget: DEFAULT_RESOURCE_BUDGETS.agent_teams,
    profiles: [
      profile("team_lead", "Team Lead", "Prioritize backlog and coordinate workers.", "agent_teams", [
        "session",
        "project"
      ]),
      profile("builder", "Builder", "Implement assigned work.", "agent_teams", [
        "session",
        "project",
        "worker"
      ]),
      profile("checker", "Checker", "Validate completed work.", "agent_teams", [
        "session",
        "project",
        "worker",
        "artifact"
      ])
    ],
    topology: {
      nodes: [
        { id: "run", label: "Run", kind: "run", status: "idle", metadata: {} },
        { id: "team_lead", label: "Team Lead", kind: "agent", agentId: "team_lead", status: "idle", metadata: {} },
        { id: "builder", label: "Builder", kind: "agent", agentId: "builder", status: "idle", metadata: {} },
        { id: "checker", label: "Checker", kind: "agent", agentId: "checker", status: "idle", metadata: {} }
      ],
      edges: [
        { id: "lead-builder", source: "team_lead", target: "builder", kind: "delegation", label: "assign", metadata: {} },
        { id: "builder-checker", source: "builder", target: "checker", kind: "verification", label: "validate", metadata: {} },
        { id: "checker-lead", source: "checker", target: "team_lead", kind: "control", label: "report", metadata: {} }
      ]
    },
    planTemplate: [
      { id: "triage", title: "Triage work into team backlog", ownerAgentId: "team_lead", dependencies: [] },
      { id: "build", title: "Complete assigned task", ownerAgentId: "builder", dependencies: ["triage"] },
      { id: "check", title: "Validate output", ownerAgentId: "checker", dependencies: ["build"] },
      { id: "handoff", title: "Record handoff and next action", ownerAgentId: "team_lead", dependencies: ["check"] }
    ]
  },
  message_bus: {
    id: "message_bus",
    label: "Message Bus",
    summary: "Agents publish and subscribe to routed events through a shared bus.",
    recommendedUse: "Use for event-driven pipelines where routing should stay extensible as the agent ecosystem grows.",
    failureMode: "Dropped or misrouted events can silently stall the system without obvious control-flow failures.",
    coordinationKind: "bus",
    stateModel: "event_routed",
    supportsPersistentWorkers: false,
    supportsSharedState: false,
    supportsEventRouting: true,
    defaultStopPolicy: {
      type: "queue_drained",
      detail: "Stop when the bus has no pending routed events and the responder has published a final outcome."
    },
    defaultConstraints: [
      "Attach correlation ids to every published message.",
      "Make routing explicit in the event stream.",
      "Keep topic subscriptions inspectable in the runtime snapshot."
    ],
    defaultBudget: DEFAULT_RESOURCE_BUDGETS.message_bus,
    profiles: [
      profile("router", "Router", "Classify messages and route them to interested subscribers.", "message_bus", [
        "session",
        "project"
      ]),
      profile("investigator", "Investigator", "Handle routed work items and publish findings.", "message_bus", [
        "session",
        "project",
        "artifact"
      ]),
      profile("responder", "Responder", "Publish the final response after routed findings arrive.", "message_bus", [
        "session",
        "artifact"
      ])
    ],
    topology: {
      nodes: [
        { id: "run", label: "Run", kind: "run", status: "idle", metadata: {} },
        { id: "router", label: "Router", kind: "agent", agentId: "router", status: "idle", metadata: {} },
        { id: "triage_topic", label: "triage", kind: "capability", status: "idle", metadata: { role: "topic" } },
        { id: "investigator", label: "Investigator", kind: "agent", agentId: "investigator", status: "idle", metadata: {} },
        { id: "responder", label: "Responder", kind: "agent", agentId: "responder", status: "idle", metadata: {} }
      ],
      edges: [
        { id: "run-router", source: "run", target: "router", kind: "control", label: "publish", metadata: {} },
        { id: "router-topic", source: "router", target: "triage_topic", kind: "artifact", label: "route", metadata: {} },
        { id: "topic-investigator", source: "triage_topic", target: "investigator", kind: "delegation", label: "deliver", metadata: {} },
        { id: "investigator-responder", source: "investigator", target: "responder", kind: "verification", label: "finding", metadata: {} }
      ]
    },
    planTemplate: [
      { id: "publish", title: "Publish the initial event", ownerAgentId: "router", dependencies: [] },
      { id: "route", title: "Route events to subscribers", ownerAgentId: "router", dependencies: ["publish"] },
      { id: "handle", title: "Handle subscribed work", ownerAgentId: "investigator", dependencies: ["route"] },
      { id: "respond", title: "Publish the final response", ownerAgentId: "responder", dependencies: ["handle"] }
    ]
  },
  shared_state: {
    id: "shared_state",
    label: "Shared State",
    summary: "Agents collaborate through a versioned shared blackboard instead of a central coordinator.",
    recommendedUse: "Use when agents need to build on each other's findings in near real time.",
    failureMode: "Without explicit termination rules, agents can loop on each other's writes or duplicate work.",
    coordinationKind: "shared_state",
    stateModel: "shared_blackboard",
    supportsPersistentWorkers: false,
    supportsSharedState: true,
    supportsEventRouting: false,
    defaultStopPolicy: {
      type: "converged",
      idleCycles: 2,
      detail: "Stop when the shared board converges with no new meaningful findings for the configured idle cycles."
    },
    defaultConstraints: [
      "Version every shared-state write.",
      "Expose shared findings directly in the runtime snapshot.",
      "Use an explicit convergence or timeout stop rule."
    ],
    defaultBudget: DEFAULT_RESOURCE_BUDGETS.shared_state,
    profiles: [
      profile("seed_agent", "Seed Agent", "Create the initial shared-state hypothesis board.", "shared_state", [
        "session",
        "project"
      ]),
      profile("research_agent", "Research Agent", "Add new findings to the shared board.", "shared_state", [
        "session",
        "project",
        "artifact"
      ]),
      profile("critic_agent", "Critic Agent", "Validate findings and decide whether the board has converged.", "shared_state", [
        "session",
        "project",
        "artifact"
      ])
    ],
    topology: {
      nodes: [
        { id: "run", label: "Run", kind: "run", status: "idle", metadata: {} },
        { id: "seed_agent", label: "Seed Agent", kind: "agent", agentId: "seed_agent", status: "idle", metadata: {} },
        { id: "shared_board", label: "Shared Board", kind: "capability", status: "idle", metadata: { role: "blackboard" } },
        { id: "research_agent", label: "Research Agent", kind: "agent", agentId: "research_agent", status: "idle", metadata: {} },
        { id: "critic_agent", label: "Critic Agent", kind: "agent", agentId: "critic_agent", status: "idle", metadata: {} }
      ],
      edges: [
        { id: "run-seed", source: "run", target: "seed_agent", kind: "control", label: "seed", metadata: {} },
        { id: "seed-board", source: "seed_agent", target: "shared_board", kind: "memory", label: "write", metadata: {} },
        { id: "research-board", source: "research_agent", target: "shared_board", kind: "memory", label: "contribute", metadata: {} },
        { id: "critic-board", source: "critic_agent", target: "shared_board", kind: "verification", label: "review", metadata: {} }
      ]
    },
    planTemplate: [
      { id: "seed", title: "Seed the shared board", ownerAgentId: "seed_agent", dependencies: [] },
      { id: "research", title: "Contribute findings to the shared board", ownerAgentId: "research_agent", dependencies: ["seed"] },
      { id: "converge", title: "Review board convergence and finalize", ownerAgentId: "critic_agent", dependencies: ["research"] }
    ]
  }
};

export const MVP_PATTERNS = Object.values(MVP_PATTERN_DEFINITIONS);

export function getPatternDefinition(pattern: CoordinationPattern): PatternDefinition {
  return MVP_PATTERN_DEFINITIONS[pattern];
}

function planEdgesFromTemplate(
  pattern: CoordinationPattern,
  planTemplate: PatternDefinition["planTemplate"],
): ModeEdgeSpec[] {
  const dependencyEdges = planTemplate.flatMap((item) =>
    item.dependencies.map((dependency) => ({
      id: `${dependency}-${item.id}`,
      source: dependency,
      target: item.id,
      kind: "control" as const,
    })),
  );
  if (dependencyEdges.length > 0) {
    return dependencyEdges.map((edge) => ModeEdgeSpecSchema.parse(edge));
  }

  return planTemplate.slice(1).map((item, index) =>
    ModeEdgeSpecSchema.parse({
      id: `${planTemplate[index]!.id}-${item.id}`,
      source: planTemplate[index]!.id,
      target: item.id,
      kind: pattern === "generator_verifier"
        ? "verification"
        : pattern === "agent_teams"
          ? "delegation"
          : pattern === "shared_state"
            ? "memory"
            : "control",
    }),
  );
}

export function getModeFamilyRule(family: CoordinationPattern) {
  return MODE_FAMILY_RULES[family];
}

export function getModeNodeRuntimeTemplateDefinition(
  family: CoordinationPattern,
  template: ModeNodeTemplate,
): ModeNodeRuntimeTemplateDefinition {
  const definition = MODE_NODE_RUNTIME_TEMPLATE_LIBRARY[family][template];
  if (!definition) {
    return {
      description: `No runtime template metadata is registered for '${template}' in family '${family}'.`,
      supportsPromptOverride: false,
      promptVariables: [],
    };
  }

  return {
    ...definition,
    promptVariables: extractMustacheVariables(definition.fallbackPrompt),
  };
}

const MODE_LAYOUT_ORIGIN_X = 56;
const MODE_LAYOUT_ORIGIN_Y = 64;
const MODE_LAYOUT_COLUMN_GAP = 320;
const MODE_LAYOUT_ROW_GAP = 176;
const MODE_LAYOUT_DISABLED_COLUMN_OFFSET = 104;

function activeEnabledModeEdges(mode: Pick<ModeSpec, "nodes" | "edges">): ModeEdgeSpec[] {
  const enabledNodeIds = new Set(mode.nodes.filter((node) => node.enabled).map((node) => node.id));
  return mode.edges.filter((edge) => edge.enabled && enabledNodeIds.has(edge.source) && enabledNodeIds.has(edge.target));
}

export function orderedEnabledModeNodes(mode: Pick<ModeSpec, "nodes" | "edges">): ModeNodeSpec[] {
  const enabledNodes = mode.nodes.filter((node) => node.enabled);
  const nodeIds = new Set(enabledNodes.map((node) => node.id));
  const indegree = new Map(enabledNodes.map((node) => [node.id, 0]));
  const adjacency = new Map(enabledNodes.map((node) => [node.id, [] as string[]]));

  for (const edge of activeEnabledModeEdges(mode).filter((candidate) => nodeIds.has(candidate.source) && nodeIds.has(candidate.target))) {
    adjacency.get(edge.source)?.push(edge.target);
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
  }

  const orderIndex = new Map(mode.nodes.map((node, index) => [node.id, index]));
  const queue = enabledNodes
    .filter((node) => (indegree.get(node.id) ?? 0) === 0)
    .sort((left, right) => (orderIndex.get(left.id) ?? 0) - (orderIndex.get(right.id) ?? 0));
  const ordered: ModeNodeSpec[] = [];

  while (queue.length > 0) {
    const node = queue.shift()!;
    ordered.push(node);
    for (const target of adjacency.get(node.id) ?? []) {
      const next = (indegree.get(target) ?? 0) - 1;
      indegree.set(target, next);
      if (next === 0) {
        const candidate = enabledNodes.find((item) => item.id === target);
        if (candidate) {
          queue.push(candidate);
          queue.sort((left, right) => (orderIndex.get(left.id) ?? 0) - (orderIndex.get(right.id) ?? 0));
        }
      }
    }
  }

  return ordered.length === enabledNodes.length ? ordered : enabledNodes;
}

export function computeModeNodePositions(mode: Pick<ModeSpec, "nodes" | "edges">): Record<string, ModeNodePosition> {
  const enabledNodes = orderedEnabledModeNodes(mode);
  const disabledNodes = mode.nodes.filter((node) => !node.enabled);
  const depthByNodeId = new Map<string, number>();
  const incoming = new Map(enabledNodes.map((node) => [node.id, [] as string[]]));

  for (const edge of activeEnabledModeEdges(mode)) {
    incoming.get(edge.target)?.push(edge.source);
  }

  for (const node of enabledNodes) {
    const maxSourceDepth = Math.max(-1, ...(incoming.get(node.id) ?? []).map((sourceId) => depthByNodeId.get(sourceId) ?? 0));
    depthByNodeId.set(node.id, maxSourceDepth + 1);
  }

  const positions: Record<string, ModeNodePosition> = {};
  const layers = new Map<number, string[]>();
  for (const node of enabledNodes) {
    const depth = depthByNodeId.get(node.id) ?? 0;
    const layer = layers.get(depth) ?? [];
    layer.push(node.id);
    layers.set(depth, layer);
  }

  const layerDepths = [...layers.keys()].sort((left, right) => left - right);
  for (const depth of layerDepths) {
    for (const [index, nodeId] of (layers.get(depth) ?? []).entries()) {
      positions[nodeId] = {
        x: MODE_LAYOUT_ORIGIN_X + depth * MODE_LAYOUT_COLUMN_GAP,
        y: MODE_LAYOUT_ORIGIN_Y + index * MODE_LAYOUT_ROW_GAP,
      };
    }
  }

  const disabledColumn = (layerDepths.at(-1) ?? 0) + 1;
  for (const [index, node] of disabledNodes.entries()) {
    positions[node.id] = {
      x: MODE_LAYOUT_ORIGIN_X + disabledColumn * MODE_LAYOUT_COLUMN_GAP + MODE_LAYOUT_DISABLED_COLUMN_OFFSET,
      y: MODE_LAYOUT_ORIGIN_Y + index * MODE_LAYOUT_ROW_GAP,
    };
  }

  return positions;
}

export function ensureModeNodePositions(mode: ModeSpec): ModeSpec {
  if (mode.nodes.every((node) => node.position)) {
    return mode;
  }

  const computed = computeModeNodePositions(mode);
  return {
    ...mode,
    nodes: mode.nodes.map((node) => ({
      ...node,
      position: node.position ?? computed[node.id] ?? { x: MODE_LAYOUT_ORIGIN_X, y: MODE_LAYOUT_ORIGIN_Y },
    })),
  };
}

export function autoLayoutModeSpec(mode: ModeSpec): ModeSpec {
  const computed = computeModeNodePositions(mode);
  return {
    ...mode,
    nodes: mode.nodes.map((node) => ({
      ...node,
      position: computed[node.id] ?? { x: MODE_LAYOUT_ORIGIN_X, y: MODE_LAYOUT_ORIGIN_Y },
    })),
  };
}

export function createModeSpecFromPattern(pattern: CoordinationPattern): ModeSpec {
  const definition = getPatternDefinition(pattern);
  const now = 0;
  return autoLayoutModeSpec(ModeSpecSchema.parse({
    id: definition.id,
    family: definition.id,
    label: definition.label,
    summary: definition.summary,
    description: definition.summary,
    recommendedUse: definition.recommendedUse,
    failureMode: definition.failureMode,
    systemPreset: true,
    nodes: definition.planTemplate.map((item) => ({
      id: item.id,
      template: item.id as ModeNodeTemplate,
      label: item.title,
      title: item.title,
      ownerAgentId: item.ownerAgentId,
      enabled: true,
      config: {},
    })),
    edges: planEdgesFromTemplate(pattern, definition.planTemplate),
    stopPolicy: definition.defaultStopPolicy,
    capabilityFlags: {
      supportsPersistentWorkers: definition.supportsPersistentWorkers,
      supportsSharedState: definition.supportsSharedState,
      supportsEventRouting: definition.supportsEventRouting,
      approvalMode: "high_risk_only",
      skillIds: [],
      toolIds: [],
    },
    runtimeAtoms: defaultRuntimeAtomsForFamily(pattern),
    editorConstraints: {
      allowedNodeTemplates: MODE_FAMILY_RULES[pattern].allowedTemplates,
      requiredNodeTemplates: MODE_FAMILY_RULES[pattern].requiredTemplates,
      readOnly: true,
      allowReorder: true,
      allowCreate: true,
      allowDelete: false,
      allowDisable: false,
    },
    defaultBudget: definition.defaultBudget,
    profiles: definition.profiles,
    createdAt: now,
    updatedAt: now,
  }));
}

function createDeerflowHarnessModeSpec(): ModeSpec {
  const now = 0;
  return autoLayoutModeSpec(ModeSpecSchema.parse({
    id: DEERFLOW_HARNESS_MODE_ID,
    family: "orchestrator_subagent",
    label: "DeerFlow-like Harness",
    summary: "A lead agent frames the work, delegates research and review, then synthesizes the final answer.",
    description: "Use a DeerFlow-inspired lead-agent harness with workspace, memory capture, loop guards, tool boundaries, and explicit delegated subagent stages.",
    recommendedUse: "Use for decomposable work where a lead agent should coordinate focused research and review before answering.",
    failureMode: "Delegation can add coordination overhead when the task is simple or the delegated stages are underspecified.",
    systemPreset: true,
    nodes: [
      {
        id: "decompose",
        template: "decompose",
        label: "Lead plan",
        title: "Lead plan",
        ownerAgentId: "lead_agent",
        enabled: true,
        config: {},
      },
      {
        id: "research",
        template: "research",
        label: "Research subagent",
        title: "Research subagent",
        ownerAgentId: "research_subagent",
        enabled: true,
        config: { atoms: ["subagent_delegate"] },
      },
      {
        id: "review",
        template: "review",
        label: "Review subagent",
        title: "Review subagent",
        ownerAgentId: "review_subagent",
        enabled: true,
        config: { atoms: ["subagent_delegate"] },
      },
      {
        id: "synthesize",
        template: "synthesize",
        label: "Lead synthesis",
        title: "Lead synthesis",
        ownerAgentId: "lead_agent",
        enabled: true,
        config: {},
      },
    ],
    edges: [
      {
        id: "decompose-research",
        source: "decompose",
        target: "research",
        kind: "delegation",
        label: "delegate",
        enabled: true,
      },
      {
        id: "research-review",
        source: "research",
        target: "review",
        kind: "verification",
        label: "check",
        enabled: true,
      },
      {
        id: "review-synthesize",
        source: "review",
        target: "synthesize",
        kind: "control",
        label: "synthesize",
        enabled: true,
      },
    ],
    stopPolicy: {
      type: "queue_drained",
      detail: "Stop when the lead agent has synthesized the delegated research and review outputs.",
    },
    capabilityFlags: {
      supportsPersistentWorkers: false,
      supportsSharedState: false,
      supportsEventRouting: false,
      approvalMode: "high_risk_only",
      skillIds: [],
      toolIds: ["model.handoff"],
    },
    runtimeAtoms: defaultRuntimeAtomsForFamily("orchestrator_subagent"),
    editorConstraints: {
      allowedNodeTemplates: MODE_FAMILY_RULES.orchestrator_subagent.allowedTemplates,
      requiredNodeTemplates: ["decompose", "synthesize"],
      readOnly: true,
      allowReorder: true,
      allowCreate: true,
      allowDelete: false,
      allowDisable: false,
    },
    defaultBudget: DEFAULT_RESOURCE_BUDGETS.orchestrator_subagent,
    profiles: [
      profile(
        "lead_agent",
        "Lead Agent",
        "Frame the task, coordinate delegated subagents, and synthesize the final answer.",
        "orchestrator_subagent",
        ["session", "project"],
      ),
      profile(
        "research_subagent",
        "Research Subagent",
        "Gather focused context for the lead agent's plan.",
        "orchestrator_subagent",
        ["session", "project"],
      ),
      profile(
        "review_subagent",
        "Review Subagent",
        "Check delegated findings for gaps and risks before synthesis.",
        "orchestrator_subagent",
        ["session", "artifact"],
      ),
    ],
    createdAt: now,
    updatedAt: now,
  }));
}

function createSingleAgentModeSpec(): ModeSpec {
  const now = 0;
  return autoLayoutModeSpec(ModeSpecSchema.parse({
    id: SINGLE_AGENT_MODE_ID,
    family: "orchestrator_subagent",
    label: "Single Agent",
    summary: "One agent makes a compact plan and completes the task without spawning teammates.",
    description: "Use the simplest execution path when you want one accountable agent to think briefly and answer directly.",
    recommendedUse: "Use for straightforward tasks where delegation would add overhead instead of clarity.",
    failureMode: "A single agent can miss blind spots that multi-agent review would have caught.",
    systemPreset: true,
    nodes: [
      {
        id: "decompose",
        template: "decompose",
        label: "Frame task",
        title: "Frame task",
        ownerAgentId: "solo_agent",
        enabled: true,
        config: {},
      },
      {
        id: "synthesize",
        template: "synthesize",
        label: "Respond",
        title: "Respond",
        ownerAgentId: "solo_agent",
        enabled: true,
        config: {},
      },
    ],
    edges: [
      {
        id: "single-agent-flow",
        source: "decompose",
        target: "synthesize",
        enabled: true,
      },
    ],
    stopPolicy: {
      type: "queue_drained",
      detail: "Stop after the solo agent frames the task and produces the final response.",
    },
    capabilityFlags: {
      supportsPersistentWorkers: false,
      supportsSharedState: false,
      supportsEventRouting: false,
      approvalMode: "high_risk_only",
      skillIds: [],
      toolIds: [],
    },
    runtimeAtoms: defaultRuntimeAtomsForFamily("orchestrator_subagent"),
    editorConstraints: {
      allowedNodeTemplates: MODE_FAMILY_RULES.orchestrator_subagent.allowedTemplates,
      requiredNodeTemplates: ["decompose", "synthesize"],
      readOnly: true,
      allowReorder: true,
      allowCreate: false,
      allowDelete: false,
      allowDisable: false,
    },
    defaultBudget: DEFAULT_RESOURCE_BUDGETS.orchestrator_subagent,
    profiles: [
      profile(
        "solo_agent",
        "Solo Agent",
        "Own the task end-to-end without delegating to additional workers.",
        "orchestrator_subagent",
        ["session", "project"],
      ),
    ],
    createdAt: now,
    updatedAt: now,
  }));
}

const BUILTIN_PATTERN_MODES = CoordinationPatternSchema.options.map((pattern) => createModeSpecFromPattern(pattern));
const ORCHESTRATOR_MODE_INDEX = BUILTIN_PATTERN_MODES.findIndex((mode) => mode.id === "orchestrator_subagent");

export const MVP_MODES = [
  ...BUILTIN_PATTERN_MODES.slice(0, ORCHESTRATOR_MODE_INDEX + 1),
  createDeerflowHarnessModeSpec(),
  createSingleAgentModeSpec(),
  ...BUILTIN_PATTERN_MODES.slice(ORCHESTRATOR_MODE_INDEX + 1),
];

export function getModePreset(modeId: string): ModeSpec | undefined {
  return MVP_MODES.find((mode) => mode.id === modeId);
}

export function modeSpecToPatternDefinition(mode: ModeSpec): PatternDefinition {
  const family = getPatternDefinition(mode.family);
  const orderedNodes = orderedEnabledModeNodes(mode);
  const edgeDependencies = new Map<string, string[]>();
  for (const node of orderedNodes) {
    edgeDependencies.set(node.id, []);
  }
  for (const edge of mode.edges.filter((candidate) => candidate.enabled && edgeDependencies.has(candidate.target) && edgeDependencies.has(candidate.source))) {
    edgeDependencies.get(edge.target)!.push(edge.source);
  }

  const topology = projectModeRuntimeTopology(mode);

  return PatternDefinitionSchema.parse({
    ...family,
    id: mode.family,
    label: mode.label,
    summary: mode.summary,
    recommendedUse: mode.recommendedUse ?? family.recommendedUse,
    failureMode: mode.failureMode ?? family.failureMode,
    defaultStopPolicy: mode.stopPolicy,
    defaultBudget: mode.defaultBudget,
    profiles: mode.profiles,
    defaultConstraints: [
      ...family.defaultConstraints,
      ...(mode.systemPreset ? [] : [`Mode preset: ${mode.id}`]),
    ],
    planTemplate: orderedNodes.map((node) => ({
      id: node.id,
      title: node.title ?? node.label,
      ownerAgentId: node.ownerAgentId,
      dependencies: edgeDependencies.get(node.id) ?? [],
    })),
    topology,
  });
}

export function validateModeSpec(spec: ModeSpec): ModeValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const rule = getModeFamilyRule(spec.family);
  const nodeIds = new Set<string>();
  const activeRuntimeAtoms = new Set(spec.runtimeAtoms);

  for (const atomId of spec.runtimeAtoms) {
    const atom = getModeRuntimeAtom(atomId);
    if (!atom.compatibleFamilies.includes(spec.family)) {
      errors.push(`Runtime atom '${atomId}' is not compatible with family '${spec.family}'.`);
    }
    if (atom.scope !== "mode") {
      errors.push(`Runtime atom '${atomId}' cannot be attached at mode scope.`);
    }
    for (const requiredFlag of atom.requiresFlags) {
      if (!spec.capabilityFlags[requiredFlag as keyof ModeCapabilityFlags]) {
        errors.push(`Runtime atom '${atomId}' requires capability flag '${requiredFlag}'.`);
      }
    }
  }

  for (const node of spec.nodes) {
    if (nodeIds.has(node.id)) {
      errors.push(`Duplicate node id '${node.id}'.`);
    }
    nodeIds.add(node.id);
    if (!rule.allowedTemplates.includes(node.template)) {
      errors.push(`Node template '${node.template}' is not allowed for family '${spec.family}'.`);
    }

    const configuredAtoms = Array.isArray(node.config?.atoms)
      ? node.config.atoms.filter((value): value is string => typeof value === "string")
      : [];
    for (const atomId of configuredAtoms) {
      const parsed = ModeRuntimeAtomIdSchema.safeParse(atomId);
      if (!parsed.success) {
        errors.push(`Node '${node.id}' references unknown runtime atom '${atomId}'.`);
        continue;
      }
      const atom = getModeRuntimeAtom(parsed.data);
      if (!atom.compatibleFamilies.includes(spec.family)) {
        errors.push(`Node '${node.id}' cannot use runtime atom '${atom.id}' in family '${spec.family}'.`);
      }
      if (atom.scope !== "node") {
        errors.push(`Node '${node.id}' cannot attach mode-scoped atom '${atom.id}'.`);
      }
      for (const requiredFlag of atom.requiresFlags) {
        if (!spec.capabilityFlags[requiredFlag as keyof ModeCapabilityFlags]) {
          errors.push(`Node atom '${atom.id}' requires capability flag '${requiredFlag}'.`);
        }
      }
      if (activeRuntimeAtoms.has(atom.id)) {
        warnings.push(`Node '${node.id}' redundantly enables runtime atom '${atom.id}' that is already active for the mode.`);
      }
    }
  }

  const nodeById = new Map(spec.nodes.map((node) => [node.id, node]));
  const requiredTemplates = new Set(rule.requiredTemplates);
  for (const recoveryRule of spec.recoveryPolicy.rules.filter((item) => item.enabled)) {
    for (const nodeId of recoveryRule.nodeIds) {
      if (!nodeIds.has(nodeId)) {
        errors.push(`Recovery rule '${recoveryRule.id}' references unknown node '${nodeId}'.`);
      }
    }
    for (const template of recoveryRule.nodeTemplates) {
      const parsed = ModeNodeTemplateSchema.safeParse(template);
      if (!parsed.success) {
        errors.push(`Recovery rule '${recoveryRule.id}' references unknown node template '${template}'.`);
      }
    }
    for (const toolId of recoveryRule.toolIds) {
      if (!spec.capabilityFlags.toolIds.includes(toolId)) {
        errors.push(`Recovery rule '${recoveryRule.id}' references disabled tool '${toolId}'.`);
      }
    }
    if (recoveryRule.action === "alternate_tool") {
      if (recoveryRule.alternateToolIds.length === 0) {
        errors.push(`Recovery rule '${recoveryRule.id}' must configure at least one alternate tool.`);
      }
      for (const alternateToolId of recoveryRule.alternateToolIds) {
        if (!spec.capabilityFlags.toolIds.includes(alternateToolId)) {
          errors.push(`Recovery rule '${recoveryRule.id}' alternate tool '${alternateToolId}' is not enabled for the mode.`);
        }
      }
    }
    if (recoveryRule.action === "skip_node") {
      if (!recoveryRule.skipAllowed) {
        errors.push(`Recovery rule '${recoveryRule.id}' must set skipAllowed before it can skip nodes.`);
      }
      for (const template of recoveryRule.nodeTemplates) {
        if (requiredTemplates.has(template as ModeNodeTemplate)) {
          errors.push(`Recovery rule '${recoveryRule.id}' cannot skip required node template '${template}'.`);
        }
      }
      for (const nodeId of recoveryRule.nodeIds) {
        const node = nodeById.get(nodeId);
        if (node && requiredTemplates.has(node.template)) {
          errors.push(`Recovery rule '${recoveryRule.id}' cannot skip required node '${nodeId}'.`);
        }
      }
    }
    if (
      recoveryRule.errorTypes.some((errorType) => errorType === "approval_required" || errorType === "clarification_required") &&
      recoveryRule.action !== "interrupt" &&
      recoveryRule.action !== "fail"
    ) {
      errors.push(`Recovery rule '${recoveryRule.id}' cannot automatically recover approval or clarification interrupts.`);
    }
  }

  const enabledTemplates = new Set(spec.nodes.filter((node) => node.enabled).map((node) => node.template));
  for (const required of rule.requiredTemplates) {
    if (!enabledTemplates.has(required)) {
      errors.push(`Family '${spec.family}' requires an enabled '${required}' node.`);
    }
  }

  if (!rule.stopPolicyTypes.includes(spec.stopPolicy.type)) {
    errors.push(`Stop policy '${spec.stopPolicy.type}' is not supported for family '${spec.family}'.`);
  }

  const adjacency = new Map(spec.nodes.map((node) => [node.id, [] as string[]]));
  const enabledNodeIds = new Set(spec.nodes.filter((node) => node.enabled).map((node) => node.id));
  const seenEdgePairs = new Set<string>();
  for (const edge of spec.edges.filter((edge) => edge.enabled)) {
    if (!nodeIds.has(edge.source)) {
      errors.push(`Edge '${edge.id}' references unknown source '${edge.source}'.`);
      continue;
    }
    if (!nodeIds.has(edge.target)) {
      errors.push(`Edge '${edge.id}' references unknown target '${edge.target}'.`);
      continue;
    }
    if (edge.source === edge.target) {
      errors.push(`Edge '${edge.id}' cannot create a self-loop on '${edge.source}'.`);
      continue;
    }
    const pairKey = `${edge.source}->${edge.target}`;
    if (seenEdgePairs.has(pairKey)) {
      errors.push(`Duplicate edge detected between '${edge.source}' and '${edge.target}'.`);
      continue;
    }
    seenEdgePairs.add(pairKey);
    if (enabledNodeIds.has(edge.source) && enabledNodeIds.has(edge.target)) {
      adjacency.get(edge.source)?.push(edge.target);
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (nodeId: string) => {
    if (visiting.has(nodeId)) {
      errors.push(`Cycle detected involving node '${nodeId}'.`);
      return;
    }
    if (visited.has(nodeId)) {
      return;
    }
    visiting.add(nodeId);
    for (const next of adjacency.get(nodeId) ?? []) {
      visit(next);
    }
    visiting.delete(nodeId);
    visited.add(nodeId);
  };
  for (const node of spec.nodes.filter((candidate) => candidate.enabled)) {
    visit(node.id);
  }

  const orderedNodes = orderedEnabledModeNodes(spec);
  if (orderedNodes.length === 0) {
    errors.push("A mode requires at least one enabled node.");
  } else if (orderedNodes.length === 1) {
    warnings.push("Single-node modes are supported, but may not provide much orchestration value.");
  }

  return ModeValidationResultSchema.parse({
    valid: errors.length === 0,
    errors,
    warnings,
  });
}

// ---------------------------------------------------------------------------
// Provider Config Schemas
// ---------------------------------------------------------------------------

export const ProviderTypeSchema = z.enum(["anthropic", "anthropic_compatible", "openai", "openai_compatible", "local_smoke"]);
export type ProviderType = z.infer<typeof ProviderTypeSchema>;

export const OpenAICompatibleProtocolSchema = z.enum(["chat_completions", "responses"]);
export type OpenAICompatibleProtocol = z.infer<typeof OpenAICompatibleProtocolSchema>;

export const ProviderCapabilitySchema = z.enum([
  "chat",
  "tool_use",
  "image_input",
  "json_mode",
  "reasoning"
]);
export type ProviderCapability = z.infer<typeof ProviderCapabilitySchema>;

export const ProviderConfigSchema = z.object({
  id: z.string().min(1),
  type: ProviderTypeSchema,
  label: z.string().min(1),
  modelId: z.string().min(1),
  enabled: z.boolean().default(true),
  baseUrl: z.string().url().optional(),
  apiKeyEnv: z.string().regex(/^[A-Z_][A-Z0-9_]*$/).optional(),
  protocol: OpenAICompatibleProtocolSchema.optional(),
  anthropicVersion: z.string().min(1).optional(),
  maxTokens: z.number().int().positive().optional(),
  temperature: z.number().min(0).max(2).optional(),
  contextWindow: z.number().int().positive().optional(),
  capabilities: z.array(ProviderCapabilitySchema).default(["chat"]),
  dropParams: z.array(z.string().min(1)).default([]),
  headers: z.record(z.string().min(1)).default({}),
  timeoutMs: z.number().int().positive().optional(),
});
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;

export const ProviderRegistrySchema = z.object({
  providers: z.array(ProviderConfigSchema),
  defaultProviderId: z.string().min(1),
});
export type ProviderRegistry = z.infer<typeof ProviderRegistrySchema>;

export const ProviderSecretStorageSchema = z.enum(["keychain", "unavailable"]);
export type ProviderSecretStorage = z.infer<typeof ProviderSecretStorageSchema>;

export const ProviderSecretStatusSchema = z.object({
  providerId: z.string().min(1),
  hasSecret: z.boolean(),
  storage: ProviderSecretStorageSchema,
  keychainService: z.string().min(1).optional(),
  detail: z.string().min(1),
});
export type ProviderSecretStatus = z.infer<typeof ProviderSecretStatusSchema>;

export const ProviderSecretWriteSchema = z.object({
  providerId: z.string().min(1),
  secret: z.string().min(1),
});
export type ProviderSecretWrite = z.infer<typeof ProviderSecretWriteSchema>;

export const ProviderStatusStateSchema = z.enum([
  "not_configured",
  "key_stored",
  "needs_key",
  "verified",
  "failed",
]);
export type ProviderStatusState = z.infer<typeof ProviderStatusStateSchema>;

export const ProviderStatusSchema = z.object({
  providerId: z.string().min(1),
  state: ProviderStatusStateSchema,
  detail: z.string().min(1),
  checkedAt: z.number().int().nonnegative().optional(),
});
export type ProviderStatus = z.infer<typeof ProviderStatusSchema>;

export const ProviderVerifyParamsSchema = z.object({
  provider: ProviderConfigSchema,
});
export type ProviderVerifyParams = z.infer<typeof ProviderVerifyParamsSchema>;

// ---------------------------------------------------------------------------
// Tool Descriptor Schemas
// ---------------------------------------------------------------------------

export const ToolDescriptorSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string().min(1),
  category: z.enum(["file", "shell", "network", "mcp", "model", "export", "internal"]),
  riskLevel: z.enum(["safe", "low_risk", "requires_approval"]),
  parameters: z.record(z.unknown()).default({}),
  requiresApproval: z.boolean().default(false),
  implemented: z.boolean().default(true),
  allowedForProfiles: z.array(z.string().min(1)).default([]),
});
export type ToolDescriptor = z.infer<typeof ToolDescriptorSchema>;

export const ToolRegistrySchema = z.object({
  tools: z.array(ToolDescriptorSchema),
  defaultPolicyId: z.string().min(1),
});
export type ToolRegistry = z.infer<typeof ToolRegistrySchema>;

export const SkillDescriptorSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  promptSnippet: z.string().min(1).optional(),
  path: z.string().min(1).optional(),
  category: z.enum(["public", "custom"]).default("public"),
  enabled: z.boolean().default(true),
  editable: z.boolean().default(false),
  license: z.string().min(1).optional(),
  createdAt: z.number().int().nonnegative().optional(),
  updatedAt: z.number().int().nonnegative().optional(),
  allowedPatterns: z.array(CoordinationPatternSchema).default([]),
  tags: z.array(z.string().min(1)).default([]),
});
export type SkillDescriptor = z.infer<typeof SkillDescriptorSchema>;

export const SkillRegistrySchema = z.object({
  skills: z.array(SkillDescriptorSchema),
});
export type SkillRegistry = z.infer<typeof SkillRegistrySchema>;

export const SkillNameSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Skill names must be lowercase hyphen-case.");
export type SkillName = z.infer<typeof SkillNameSchema>;

export const SkillCategorySchema = z.enum(["public", "custom"]);
export type SkillCategory = z.infer<typeof SkillCategorySchema>;

export const SkillDetailSchema = SkillDescriptorSchema.extend({
  content: z.string().min(1),
});
export type SkillDetail = z.infer<typeof SkillDetailSchema>;

export const SkillListParamsSchema = z.object({
  category: SkillCategorySchema.optional(),
  enabledOnly: z.boolean().optional(),
  query: z.string().optional(),
  pattern: CoordinationPatternSchema.optional(),
}).default({});
export type SkillListParams = z.infer<typeof SkillListParamsSchema>;

export const SkillGetParamsSchema = z.object({
  name: SkillNameSchema,
});
export type SkillGetParams = z.infer<typeof SkillGetParamsSchema>;

export const SkillCreateParamsSchema = z.object({
  name: SkillNameSchema,
  description: z.string().default(""),
  content: z.string().optional(),
  enabled: z.boolean().default(true),
});
export type SkillCreateParams = z.infer<typeof SkillCreateParamsSchema>;

export const SkillUpdateParamsSchema = z.object({
  name: SkillNameSchema,
  content: z.string().min(1),
});
export type SkillUpdateParams = z.infer<typeof SkillUpdateParamsSchema>;

export const SkillDeleteParamsSchema = z.object({
  name: SkillNameSchema,
});
export type SkillDeleteParams = z.infer<typeof SkillDeleteParamsSchema>;

export const SkillCheckNameParamsSchema = z.object({
  name: z.string().min(1),
});
export type SkillCheckNameParams = z.infer<typeof SkillCheckNameParamsSchema>;

export const SkillCheckNameResultSchema = z.object({
  available: z.boolean(),
  name: SkillNameSchema,
});
export type SkillCheckNameResult = z.infer<typeof SkillCheckNameResultSchema>;

export const SkillSetEnabledParamsSchema = z.object({
  name: SkillNameSchema,
  enabled: z.boolean(),
});
export type SkillSetEnabledParams = z.infer<typeof SkillSetEnabledParamsSchema>;

// ---------------------------------------------------------------------------
// Custom Agent Schemas
// ---------------------------------------------------------------------------

export const CustomAgentNameSchema = z
  .string()
  .min(1)
  .regex(/^[A-Za-z0-9-]+$/, "Custom agent names must contain only letters, digits, and hyphens.");
export type CustomAgentName = z.infer<typeof CustomAgentNameSchema>;

export const CustomAgentSummarySchema = z.object({
  name: CustomAgentNameSchema,
  description: z.string().default(""),
  model: z.string().min(1).optional(),
  toolGroups: z.array(z.string().min(1)).optional(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});
export type CustomAgentSummary = z.infer<typeof CustomAgentSummarySchema>;

export const CustomAgentDetailSchema = CustomAgentSummarySchema.extend({
  soul: z.string().default(""),
});
export type CustomAgentDetail = z.infer<typeof CustomAgentDetailSchema>;

export const CustomAgentCreateParamsSchema = z.object({
  name: CustomAgentNameSchema,
  description: z.string().default(""),
  model: z.string().min(1).optional(),
  toolGroups: z.array(z.string().min(1)).optional(),
  soul: z.string().default(""),
});
export type CustomAgentCreateParams = z.infer<typeof CustomAgentCreateParamsSchema>;

export const CustomAgentUpdateParamsSchema = z.object({
  name: CustomAgentNameSchema,
  description: z.string().optional(),
  model: z.string().min(1).nullable().optional(),
  toolGroups: z.array(z.string().min(1)).nullable().optional(),
  soul: z.string().optional(),
});
export type CustomAgentUpdateParams = z.infer<typeof CustomAgentUpdateParamsSchema>;

export const CustomAgentGetParamsSchema = z.object({
  name: CustomAgentNameSchema,
});
export type CustomAgentGetParams = z.infer<typeof CustomAgentGetParamsSchema>;

export const CustomAgentDeleteParamsSchema = z.object({
  name: CustomAgentNameSchema,
});
export type CustomAgentDeleteParams = z.infer<typeof CustomAgentDeleteParamsSchema>;

export const CustomAgentCheckNameParamsSchema = z.object({
  name: z.string().min(1),
});
export type CustomAgentCheckNameParams = z.infer<typeof CustomAgentCheckNameParamsSchema>;

export const CustomAgentCheckNameResultSchema = z.object({
  available: z.boolean(),
  name: CustomAgentNameSchema,
});
export type CustomAgentCheckNameResult = z.infer<typeof CustomAgentCheckNameResultSchema>;

// ---------------------------------------------------------------------------
// Session Config Schemas
// ---------------------------------------------------------------------------

export const SessionConfigSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  projectId: z.string().min(1).optional(),
  defaultPattern: CoordinationPatternSchema.default("orchestrator_subagent"),
  defaultProviderId: z.string().min(1).optional(),
  defaultBudget: ResourceBudgetSchema.optional(),
  approvalMode: z.enum(["auto", "manual", "high_risk_only"]).default("high_risk_only"),
  tools: z.array(z.string().min(1)).default([]),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});
export type SessionConfig = z.infer<typeof SessionConfigSchema>;

export const ProjectConfigSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  rootPath: z.string().min(1).optional(),
  sessions: z.array(SessionConfigSchema).default([]),
  memoryNamespaces: z.array(z.string().min(1)).default([]),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});
export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;

// ---------------------------------------------------------------------------
// Approval Gate Schemas
// ---------------------------------------------------------------------------

export const ApprovalRequestSchema = z.object({
  id: z.string().min(1),
  runId: z.string().min(1),
  actionId: z.string().min(1),
  agentId: z.string().min(1).optional(),
  toolId: z.string().min(1).optional(),
  riskLevel: ActionRiskLevelSchema,
  reason: z.string().min(1),
  input: z.unknown(),
  createdAt: z.number().int().nonnegative(),
  deadlineMs: z.number().int().positive().optional(),
});
export type ApprovalRequest = z.infer<typeof ApprovalRequestSchema>;

export const ApprovalDecisionSchema = z.object({
  requestId: z.string().min(1),
  decision: z.enum(["approved", "denied", "deferred"]),
  reason: z.string().min(1).optional(),
  decidedAt: z.number().int().nonnegative(),
  decidedBy: z.enum(["operator", "auto_policy", "timeout"]).default("operator"),
});
export type ApprovalDecision = z.infer<typeof ApprovalDecisionSchema>;

// ---------------------------------------------------------------------------
// Default Definitions
// ---------------------------------------------------------------------------

export const MVP_TOOLS: ToolDescriptor[] = [
  { id: "file.read", label: "Read File", description: "Read file contents inside the selected project folder.", category: "file", riskLevel: "safe", parameters: {}, requiresApproval: false, implemented: true, allowedForProfiles: [] },
  { id: "file.list", label: "List Files", description: "List files and directories inside the selected project folder.", category: "file", riskLevel: "safe", parameters: {}, requiresApproval: false, implemented: true, allowedForProfiles: [] },
  { id: "file.glob", label: "Glob Files", description: "Find project files by glob pattern.", category: "file", riskLevel: "safe", parameters: {}, requiresApproval: false, implemented: true, allowedForProfiles: [] },
  { id: "file.grep", label: "Search Files", description: "Search project file contents for a literal pattern.", category: "file", riskLevel: "safe", parameters: {}, requiresApproval: false, implemented: true, allowedForProfiles: [] },
  { id: "file.write", label: "Write File", description: "Write content to a local project file.", category: "file", riskLevel: "requires_approval", parameters: {}, requiresApproval: true, implemented: true, allowedForProfiles: [] },
  { id: "file.patch", label: "Patch File", description: "Replace one exact string in a local project file.", category: "file", riskLevel: "requires_approval", parameters: {}, requiresApproval: true, implemented: true, allowedForProfiles: [] },
  { id: "file.delete", label: "Delete File", description: "Delete a local file.", category: "file", riskLevel: "requires_approval", parameters: {}, requiresApproval: true, implemented: false, allowedForProfiles: [] },
  { id: "shell.execute", label: "Execute Command", description: "Run an approved command in the selected project folder.", category: "shell", riskLevel: "requires_approval", parameters: {}, requiresApproval: true, implemented: true, allowedForProfiles: [] },
  { id: "web.fetch", label: "Fetch URL", description: "Fetch content from an HTTP or HTTPS URL.", category: "network", riskLevel: "low_risk", parameters: {}, requiresApproval: false, implemented: true, allowedForProfiles: [] },
  { id: "web.search", label: "Search Web", description: "Search the web for lightweight research results.", category: "network", riskLevel: "low_risk", parameters: {}, requiresApproval: false, implemented: true, allowedForProfiles: [] },
  { id: "mcp.listTools", label: "List MCP Tools", description: "List tools exposed by configured MCP servers.", category: "mcp", riskLevel: "low_risk", parameters: {}, requiresApproval: false, implemented: true, allowedForProfiles: [] },
  { id: "mcp.readResource", label: "Read MCP Resource", description: "Read a resource from a configured MCP server.", category: "mcp", riskLevel: "low_risk", parameters: {}, requiresApproval: false, implemented: true, allowedForProfiles: [] },
  { id: "mcp.call", label: "MCP Tool Call", description: "Invoke a tool on a configured MCP server.", category: "mcp", riskLevel: "requires_approval", parameters: {}, requiresApproval: true, implemented: true, allowedForProfiles: [] },
  { id: "model.handoff", label: "Model Handoff", description: "Delegate to another model.", category: "model", riskLevel: "safe", parameters: {}, requiresApproval: false, implemented: false, allowedForProfiles: [] },
  { id: "message.publish", label: "Publish Message", description: "Publish an event to the runtime message bus.", category: "internal", riskLevel: "low_risk", parameters: {}, requiresApproval: false, implemented: false, allowedForProfiles: [] },
  { id: "shared_state.write", label: "Write Shared State", description: "Write a versioned update to the shared blackboard.", category: "internal", riskLevel: "requires_approval", parameters: {}, requiresApproval: true, implemented: false, allowedForProfiles: [] },
  { id: "export.report", label: "Export Report", description: "Export a run report.", category: "export", riskLevel: "safe", parameters: {}, requiresApproval: false, implemented: false, allowedForProfiles: [] },
];

export const MVP_SKILLS: SkillDescriptor[] = [
  {
    id: "long-task-protocol",
    enabled: true,
    name: "Long Task Protocol",
    description: "Keep complex work resumable with a task journal, checkpoints, and strict verification gates.",
    category: "public",
    editable: false,
    promptSnippet: "Use a task journal for complex multi-step work and keep verification evidence explicit.",
    path: "skills/long-task-protocol/SKILL.md",
    allowedPatterns: [
      "orchestrator_subagent",
      "agent_teams",
      "message_bus",
      "shared_state"
    ],
    tags: ["planning", "verification", "resumable"]
  }
];

export const RuntimeBootstrapSchema = z.object({
  health: z.object({
    ok: z.boolean(),
    service: z.string().min(1),
    version: z.string().min(1),
    mode: z.enum(["runtime", "deterministic_fixture"]).default("runtime"),
    detail: z.string().min(1)
  }),
  patterns: z.array(PatternDefinitionSchema),
  modes: z.array(ModeSpecSchema),
  atoms: z.array(ModeRuntimeAtomDefinitionSchema),
  tools: ToolRegistrySchema,
  skills: SkillRegistrySchema,
  providers: ProviderRegistrySchema
});
export type RuntimeBootstrap = z.infer<typeof RuntimeBootstrapSchema>;

export const DEFAULT_PROVIDERS: ProviderConfig[] = [
  { id: "anthropic-claude", type: "anthropic", label: "Claude", modelId: "claude-sonnet-4-20250514", enabled: true, maxTokens: 8192, capabilities: ["chat", "tool_use"], dropParams: [], headers: {} },
  { id: "openai-gpt", type: "openai", label: "GPT", modelId: "gpt-4o", enabled: true, maxTokens: 8192, capabilities: ["chat", "tool_use", "image_input", "json_mode"], dropParams: [], headers: {} },
  { id: "local-smoke", type: "local_smoke", label: "Smoke Model", modelId: "smoke-model", enabled: true, maxTokens: 1024, capabilities: ["chat"], dropParams: [], headers: {} },
];
