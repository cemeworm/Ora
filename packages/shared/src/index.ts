import { z } from "zod";

export const CoordinationPatternSchema = z.enum([
  "generator_verifier",
  "orchestrator_subagent",
  "agent_teams"
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
  modelRef: z.string().min(1).default("local/smoke-model"),
  budget: ResourceBudgetSchema.optional(),
  metadata: z.record(z.unknown()).default({}),
  deterministicSeed: z.string().min(1).default("ora-smoke")
});
export type RunConfig = z.infer<typeof RunConfigSchema>;

export const RunHandleSchema = z.object({
  runId: z.string().min(1),
  status: RunStatusSchema,
  pattern: CoordinationPatternSchema,
  startedAt: z.number().int().nonnegative()
});
export type RunHandle = z.infer<typeof RunHandleSchema>;

export const RunSummarySchema = z.object({
  runId: z.string().min(1),
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
  "topology.updated",
  "profile.updated",
  "memory.updated",
  "plan.updated",
  "action.updated",
  "approval.required",
  "approval.resolved",
  "message.delta",
  "token.delta",
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
  limit: z.number().int().positive().max(500).optional()
});
export type RunsListParams = z.infer<typeof RunsListParamsSchema>;

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

export const StateSnapshotSchema = z.object({
  runId: z.string().min(1),
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
  output: z.unknown().optional(),
  error: z.string().optional(),
  updatedAt: z.number().int().nonnegative()
});
export type StateSnapshot = z.infer<typeof StateSnapshotSchema>;

export const JsonRpcIdSchema = z.union([z.string(), z.number().int()]);

export const RuntimeJsonRpcMethodSchema = z.enum([
  "runtime.health",
  "patterns.list",
  "providers.list",
  "runs.start",
  "runs.list",
  "runs.stream",
  "runs.interrupt",
  "runs.resume",
  "runs.cancel",
  "runs.state",
  "runs.checkpoints",
  "runs.replay",
  "runs.fork",
  "runs.exportReport"
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
  { id: "export.report", label: "Export Report", description: "Export a run report.", category: "export", riskLevel: "safe", parameters: {}, requiresApproval: false, allowedForProfiles: [] },
];

export const DEFAULT_PROVIDERS: ProviderConfig[] = [
  { id: "anthropic-claude", type: "anthropic", label: "Claude", modelId: "claude-sonnet-4-20250514", enabled: true, maxTokens: 8192, capabilities: ["chat", "tool_use"], dropParams: [] },
  { id: "openai-gpt", type: "openai", label: "GPT", modelId: "gpt-4o", enabled: true, maxTokens: 8192, capabilities: ["chat", "tool_use", "image_input", "json_mode"], dropParams: [] },
  { id: "local-smoke", type: "local_smoke", label: "Smoke Model", modelId: "smoke-model", enabled: true, maxTokens: 1024, capabilities: ["chat"], dropParams: [] },
];
