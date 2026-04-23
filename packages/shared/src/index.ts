import { z } from "zod";

export const CoordinationPatternSchema = z.enum([
  "generator_verifier",
  "orchestrator_subagent",
  "agent_teams",
  "message_bus",
  "shared_state"
]);
export type CoordinationPattern = z.infer<typeof CoordinationPatternSchema>;

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
  startedAt: z.number().int().nonnegative()
});
export type RunHandle = z.infer<typeof RunHandleSchema>;

export const RunSummarySchema = z.object({
  runId: z.string().min(1),
  sessionId: z.string().min(1).optional(),
  turnIndex: z.number().int().positive().optional(),
  status: RunStatusSchema,
  pattern: CoordinationPatternSchema,
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
  "memory.updated",
  "plan.updated",
  "action.updated",
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
  nextSeq: z.number().int().nonnegative()
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

export const StateSnapshotSchema = z.object({
  runId: z.string().min(1),
  sessionId: z.string().min(1).optional(),
  turnIndex: z.number().int().positive().default(1),
  status: RunStatusSchema,
  pattern: CoordinationPatternSchema,
  input: UserTaskInputSchema,
  config: RunConfigSchema,
  topology: z.object({
    nodes: z.array(TopologyNodeSchema),
    edges: z.array(TopologyEdgeSchema)
  }),
  profiles: z.array(AgentProfileSchema),
  memory: z.array(MemoryRecordSchema),
  plan: z.array(PlanItemSchema),
  actions: z.array(ActionRecordSchema),
  policyDecisions: z.array(PolicyDecisionSchema).default([]),
  checkpoints: z.array(CheckpointMetaSchema),
  events: z.array(OraEventEnvelopeSchema),
  artifacts: z.array(ArtifactRefSchema).default([]),
  activeAgents: z.array(z.string().min(1)).default([]),
  queueSummary: QueueSummarySchema.default({}),
  sharedStateSummary: SharedStateSummarySchema.default({}),
  busStats: BusStatsSchema.default({}),
  pendingApprovals: z.array(z.string().min(1)).default([]),
  trace: RunTraceMetadataSchema.optional(),
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
  "tools.list",
  "skills.list",
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

// ---------------------------------------------------------------------------
// Provider Config Schemas
// ---------------------------------------------------------------------------

export const ProviderTypeSchema = z.enum(["anthropic", "openai", "openai_compatible", "local_smoke"]);
export type ProviderType = z.infer<typeof ProviderTypeSchema>;

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
  maxTokens: z.number().int().positive().optional(),
  temperature: z.number().min(0).max(2).optional(),
  contextWindow: z.number().int().positive().optional(),
  capabilities: z.array(ProviderCapabilitySchema).default(["chat"]),
  dropParams: z.array(z.string().min(1)).default([]),
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
  allowedPatterns: z.array(CoordinationPatternSchema).default([]),
  tags: z.array(z.string().min(1)).default([]),
});
export type SkillDescriptor = z.infer<typeof SkillDescriptorSchema>;

export const SkillRegistrySchema = z.object({
  skills: z.array(SkillDescriptorSchema),
});
export type SkillRegistry = z.infer<typeof SkillRegistrySchema>;

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
  { id: "file.read", label: "Read File", description: "Read file contents from local filesystem.", category: "file", riskLevel: "safe", parameters: {}, requiresApproval: false, allowedForProfiles: [] },
  { id: "file.write", label: "Write File", description: "Write content to a local file.", category: "file", riskLevel: "requires_approval", parameters: {}, requiresApproval: true, allowedForProfiles: [] },
  { id: "file.delete", label: "Delete File", description: "Delete a local file.", category: "file", riskLevel: "requires_approval", parameters: {}, requiresApproval: true, allowedForProfiles: [] },
  { id: "shell.execute", label: "Execute Command", description: "Run a shell command.", category: "shell", riskLevel: "requires_approval", parameters: {}, requiresApproval: true, allowedForProfiles: [] },
  { id: "web.fetch", label: "Fetch URL", description: "Fetch content from a URL.", category: "network", riskLevel: "low_risk", parameters: {}, requiresApproval: false, allowedForProfiles: [] },
  { id: "mcp.call", label: "MCP Tool Call", description: "Invoke an MCP tool.", category: "mcp", riskLevel: "low_risk", parameters: {}, requiresApproval: false, allowedForProfiles: [] },
  { id: "model.handoff", label: "Model Handoff", description: "Delegate to another model.", category: "model", riskLevel: "safe", parameters: {}, requiresApproval: false, allowedForProfiles: [] },
  { id: "message.publish", label: "Publish Message", description: "Publish an event to the runtime message bus.", category: "internal", riskLevel: "low_risk", parameters: {}, requiresApproval: false, allowedForProfiles: [] },
  { id: "shared_state.write", label: "Write Shared State", description: "Write a versioned update to the shared blackboard.", category: "internal", riskLevel: "requires_approval", parameters: {}, requiresApproval: true, allowedForProfiles: [] },
  { id: "export.report", label: "Export Report", description: "Export a run report.", category: "export", riskLevel: "safe", parameters: {}, requiresApproval: false, allowedForProfiles: [] },
];

export const MVP_SKILLS: SkillDescriptor[] = [
  {
    id: "long-task-protocol",
    name: "Long Task Protocol",
    description: "Keep complex work resumable with a task journal, checkpoints, and strict verification gates.",
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
  tools: ToolRegistrySchema,
  skills: SkillRegistrySchema,
  providers: ProviderRegistrySchema
});
export type RuntimeBootstrap = z.infer<typeof RuntimeBootstrapSchema>;

export const DEFAULT_PROVIDERS: ProviderConfig[] = [
  { id: "anthropic-claude", type: "anthropic", label: "Claude", modelId: "claude-sonnet-4-20250514", enabled: true, maxTokens: 8192, capabilities: ["chat", "tool_use"], dropParams: [] },
  { id: "openai-gpt", type: "openai", label: "GPT", modelId: "gpt-4o", enabled: true, maxTokens: 8192, capabilities: ["chat", "tool_use", "image_input", "json_mode"], dropParams: [] },
  { id: "local-smoke", type: "local_smoke", label: "Smoke Model", modelId: "smoke-model", enabled: true, maxTokens: 1024, capabilities: ["chat"], dropParams: [] },
];
