import { z } from "zod";
import { ActionRiskLevelSchema, DEFAULT_MODE_RECOVERY_POLICY, ModeRecoveryPolicySchema } from "./actions.js";
import { DEFAULT_AGENT_MODE_TOOL_IDS, ToolCapabilityGroupSchema, visibleToolIdsForPreset } from "./capabilities.js";
import { AgentProfileSchema, BuiltInCoordinationPatternSchema, CODE_DEVELOPMENT_MODE_ID, COMPLETION_POLICY_PRESETS, CoordinationPatternSchema, DEBATE_MODE_ID, DEEP_RESEARCH_MODE_ID, DEFAULT_MODE_RUNTIME_POLICY, MODE_STUDIO_BUILDER_MODE_ID, ModeCompletionPolicySchema, ModeIdSchema, ModeRuntimePolicySchema, ORA_ROOT_AGENT_ID, ORA_ROOT_AGENT_LABEL, ResourceBudgetSchema, REVIEW_CRITIQUE_MODE_ID, SINGLE_AGENT_MODE_ID, completionPolicyForPreset } from "./primitives.js";
import type { AgentProfile, BuiltInCoordinationPattern, CoordinationPattern, ModeCompletionPolicy, ModeRuntimePolicy, ResourceBudget } from "./primitives.js";
import { TopologyEdgeSchema, TopologyNodeSchema } from "./topology.js";
import type { TopologyEdge, TopologyNode } from "./topology.js";
import { getDriverManifest, driverManifestWarnings, generateRepairSuggestions } from "./driver-manifest.js";

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

export const BuiltInModeNodeTemplateSchema = z.enum([
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
export const ModeNodeTemplateSchema = BuiltInModeNodeTemplateSchema.or(z.string());
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
  instructions: z.string().min(1).optional(),
  prompt: z.string().min(1).optional(),
  riskLevel: ActionRiskLevelSchema.optional(),
  consumes: z.array(z.string()).optional(),
  produces: z.array(z.string()).optional(),
  config: z.object({
    atoms: z.array(z.string()).optional(),
    customAgentId: z.string().optional(),
    toolIds: z.array(z.string().min(1)).optional(),
    requiredCapabilityGroups: z.array(ToolCapabilityGroupSchema).optional(),
    gateOnReviewVerdict: z.boolean().optional(),
    reworkNodeIds: z.array(z.string().min(1)).optional(),
    clarificationQuestion: z.string().optional(),
    clarificationKey: z.string().optional(),
    story: z.unknown().optional(),
    timeoutMs: z.number().int().positive().optional(),
  }).strip().default({}),
});
export type ModeNodeSpec = z.infer<typeof ModeNodeSpecSchema>;

export const ModeEdgeSpecSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  label: z.string().min(1).optional(),
  kind: TopologyEdgeSchema.shape.kind.default("control"),
  enabled: z.boolean().default(true),
  /** Optional condition expression. When set, the edge only routes execution to `target`
   *  if the source node's output satisfies the condition. The condition references fields
   *  of the source node output via JSONPath-like dot notation (e.g. "status == 'pass'"). */
  condition: z.string().min(1).optional(),
});
export type ModeEdgeSpec = z.infer<typeof ModeEdgeSpecSchema>;

export const BuiltInModeRuntimeAtomIdSchema = z.enum([
  "thread_workspace",
  "recovery_policy",
  "tool_error_boundary",
  "loop_guard",
  "clarification_interrupt",
  "memory_capture",
  "long_term_memory",
  "deferred_tool_discovery",
  "subagent_delegate",
  "persistent_worker_memory",
  "event_routing",
  "shared_blackboard",
  "artifact_publish",
  "token_usage_trace",
  "dynamic_stage_skipping",
  "dynamic_delegation",
]);
export const ModeRuntimeAtomIdSchema = BuiltInModeRuntimeAtomIdSchema.or(z.string());
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

export const ComplexityLevelSchema = z.enum(["L0", "L1", "L2", "L3"]);
export type ComplexityLevel = z.infer<typeof ComplexityLevelSchema>;

export const ComplexitySkipRulesSchema = z.object({
  L0: z.array(z.string().min(1)).default([]),
  L1: z.array(z.string().min(1)).default([]),
  L2: z.array(z.string().min(1)).default([]),
  L3: z.array(z.string().min(1)).default([]),
});
export type ComplexitySkipRules = z.infer<typeof ComplexitySkipRulesSchema>;

export const ModeStageSpecSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  nodeId: z.string().min(1),
  speakerId: z.string().min(1).optional(),
  speakerLabel: z.string().min(1).optional(),
  stance: z.string().min(1).optional(),
  adversarialStance: z.boolean().optional(),
  instruction: z.string().min(1).optional(),
  promptTemplate: z.string().min(1).optional(),
  outputKey: z.string().min(1).optional(),
});
export type ModeStageSpec = z.infer<typeof ModeStageSpecSchema>;

export const TranscriptLayoutStyleSchema = z.enum([
  "stage_list",
  "two_sided_duel",
  "role_lanes",
  "kanban_pipeline",
  "rubric_matrix",
  "judge_panel",
  "evidence_board",
  "comparison_table",
  "artifact_gallery",
]);
export type TranscriptLayoutStyle = z.infer<typeof TranscriptLayoutStyleSchema>;

export const TranscriptLayoutToneSchema = z.enum(["green", "blue", "violet", "amber", "red", "gray"]);
export type TranscriptLayoutTone = z.infer<typeof TranscriptLayoutToneSchema>;

export const ModeTranscriptLayoutLaneSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
});
export type ModeTranscriptLayoutLane = z.infer<typeof ModeTranscriptLayoutLaneSchema>;

export const ModeTranscriptLayoutSchema = z.object({
  style: TranscriptLayoutStyleSchema,
  groupId: z.string().min(1).optional(),
  groupLabel: z.string().min(1).optional(),
  stanceLabels: z.record(z.string().min(1)).optional(),
  stanceTones: z.record(TranscriptLayoutToneSchema).optional(),
  sideByStance: z.record(z.enum(["left", "right", "center"])).optional(),
  laneBySpeaker: z.record(z.string().min(1)).optional(),
  summaryStances: z.array(z.string().min(1)).optional(),
  summaryStageIds: z.array(z.string().min(1)).optional(),
  showStatus: z.boolean().optional(),
  showTimestamp: z.boolean().optional(),
  showSpeaker: z.boolean().optional(),
  orientation: z.enum(["vertical", "horizontal"]).optional(),
  showArtifacts: z.boolean().optional(),
  groupBy: z.enum(["speakerId", "stance", "nodeId"]).optional(),
  lanes: z.array(ModeTranscriptLayoutLaneSchema).optional(),
  ownsFinalAnswer: z.boolean().optional(),
  supplementalBody: z.enum(["auto", "never"]).optional(),
});
export type ModeTranscriptLayout = z.infer<typeof ModeTranscriptLayoutSchema>;

export const ModeMemoryPolicySchema = z.object({
  enabled: z.boolean().default(true),
  updater: z.enum(["provider", "heuristic"]).default("provider"),
  debounceMs: z.number().int().min(0).max(60_000).default(0),
  factConfidenceThreshold: z.number().min(0).max(1).default(0.7),
  maxFacts: z.number().int().positive().max(500).default(120),
  injectionMaxFacts: z.number().int().positive().max(100).default(24),
  updaterProviderId: z.string().min(1).optional(),
  // Hybrid retrieval controls
  retrievalMode: z.enum(["lexical", "hybrid", "semantic"]).default("lexical"),
  mmrLambda: z.number().min(0).max(1).default(0.7),
  decayEnabled: z.boolean().default(true),
  diversityEnabled: z.boolean().default(false),
  semanticProviderId: z.string().min(1).optional(),
  semanticModelId: z.string().min(1).optional(),
  // Provider-backed admission controls
  admissionMode: z.enum(["deterministic", "provider", "provider_fallback"]).default("deterministic"),
  queryMode: z.enum(["message", "recent", "full"]).default("message"),
  admissionTimeoutMs: z.number().int().positive().max(30_000).default(5_000),
  admissionMaxSummaryChars: z.number().int().positive().default(2_000),
});
export type ModeMemoryPolicy = z.infer<typeof ModeMemoryPolicySchema>;

export const ModeToolLimitsSchema = z.object({
  fileReadMaxBytes: z.number().int().positive().optional(),
  fileListMaxEntries: z.number().int().positive().optional(),
  fileSearchMaxFiles: z.number().int().positive().optional(),
  fileSearchMaxMatches: z.number().int().positive().optional(),
  fileSearchMaxBytes: z.number().int().positive().optional(),
  fileWriteMaxBytes: z.number().int().positive().optional(),
  webMaxBytes: z.number().int().positive().optional(),
  documentExtractMaxBytes: z.number().int().positive().optional(),
  documentSourceMaxBytes: z.number().int().positive().optional(),
  shellMaxOutputBytes: z.number().int().positive().optional(),
  shellTimeoutMs: z.number().int().positive().optional(),
});
export type ModeToolLimits = z.infer<typeof ModeToolLimitsSchema>;

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
  visibility: z.enum(["user", "internal"]).default("user"),
  modeKind: z.string().optional(),
  nodes: z.array(ModeNodeSpecSchema).min(1),
  edges: z.array(ModeEdgeSpecSchema).default([]),
  stopPolicy: ModeStopPolicySchema,
  capabilityFlags: ModeCapabilityFlagsSchema,
  editorConstraints: ModeEditorConstraintsSchema,
  defaultBudget: ResourceBudgetSchema,
  profiles: z.array(AgentProfileSchema).min(1),
  runtimeAtoms: z.array(ModeRuntimeAtomIdSchema).default([]),
  complexitySkipRules: ComplexitySkipRulesSchema.optional(),
  stages: z.array(ModeStageSpecSchema).optional(),
  transcriptLayout: ModeTranscriptLayoutSchema.optional(),
  completionPolicy: ModeCompletionPolicySchema.default(COMPLETION_POLICY_PRESETS.balanced),
  runtimePolicy: ModeRuntimePolicySchema.default(DEFAULT_MODE_RUNTIME_POLICY),
  recoveryPolicy: ModeRecoveryPolicySchema.default(DEFAULT_MODE_RECOVERY_POLICY),
  memoryPolicy: ModeMemoryPolicySchema.default({}),
  toolLimits: ModeToolLimitsSchema.default({}),
  permissionProfileId: z.string().min(1).optional(),
  langfusePromptRef: z.object({
    name: z.string().min(1),
    version: z.number().int().positive().optional(),
    label: z.string().min(1).optional(),
  }).optional(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});
export type ModeSpec = z.infer<typeof ModeSpecSchema>;

export const ModeValidationResultSchema = z.object({
  valid: z.boolean(),
  errors: z.array(z.string().min(1)).default([]),
  warnings: z.array(z.string().min(1)).default([]),
  repairSuggestions: z.array(z.object({
    issue: z.string().min(1),
    action: z.enum(["switch_family", "remove_condition", "convert_edge", "rebuild_layers", "remove_atom", "remove_layout"]),
    target: z.string().min(1).optional(),
    label: z.string().min(1),
  })).default([]),
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
    maxToolCalls: 256,
    maxRuntimeMs: 180000,
    maxCostUsd: 2
  },
  orchestrator_subagent: {
    maxTokens: 18000,
    maxToolCalls: 256,
    maxRuntimeMs: 300000,
    maxCostUsd: 3
  },
  agent_teams: {
    maxTokens: 24000,
    maxToolCalls: 256,
    maxRuntimeMs: 600000,
    maxCostUsd: 5
  },
  message_bus: {
    maxTokens: 20000,
    maxToolCalls: 256,
    maxRuntimeMs: 360000,
    maxCostUsd: 4
  },
  shared_state: {
    maxTokens: 22000,
    maxToolCalls: 256,
    maxRuntimeMs: 420000,
    maxCostUsd: 4
  }
};

const SINGLE_AGENT_RESOURCE_BUDGET: ResourceBudget = {
  ...DEFAULT_RESOURCE_BUDGETS.orchestrator_subagent,
  maxToolCalls: 256
};

export const MODE_RUNTIME_POLICY_PRESETS = {
  fast: ModeRuntimePolicySchema.parse({
    thinking: "off",
    reasoningEffort: "none",
    budgetProfile: "fast",
    planning: "none",
    delegation: "none",
    providerThinking: "disabled",
  }),
  balanced: ModeRuntimePolicySchema.parse({
    thinking: "standard",
    reasoningEffort: "medium",
    budgetProfile: "balanced",
    planning: "light",
    delegation: "none",
    providerThinking: "auto",
  }),
  verifier: ModeRuntimePolicySchema.parse({
    thinking: "standard",
    reasoningEffort: "high",
    budgetProfile: "balanced",
    planning: "explicit",
    delegation: "none",
    providerThinking: "auto",
  }),
  delegated: ModeRuntimePolicySchema.parse({
    thinking: "deep",
    reasoningEffort: "high",
    budgetProfile: "deep",
    planning: "explicit",
    delegation: "allowed",
    providerThinking: "required",
  }),
  team: ModeRuntimePolicySchema.parse({
    thinking: "deep",
    reasoningEffort: "high",
    budgetProfile: "deep",
    planning: "explicit",
    delegation: "preferred",
    providerThinking: "required",
  }),
} satisfies Record<string, ModeRuntimePolicy>;

export function runtimePolicyForPreset(preset: keyof typeof MODE_RUNTIME_POLICY_PRESETS): ModeRuntimePolicy {
  return { ...MODE_RUNTIME_POLICY_PRESETS[preset] };
}

const MODE_FAMILY_RULES: Record<
  CoordinationPattern,
  {
    allowedTemplates: ModeNodeTemplate[];
    requiredTemplates: ModeNodeTemplate[];
    stopPolicyTypes: ModeStopPolicy["type"][];
  }
> = {
  generator_verifier: {
    allowedTemplates: ["research", "draft", "verify", "decide"],
    requiredTemplates: ["draft", "verify"],
    stopPolicyTypes: ["max_iterations", "manual"],
  },
  orchestrator_subagent: {
    allowedTemplates: ["decompose", "research", "review", "synthesize", "triage", "build", "check", "handoff"],
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
  display: {
    story: string;
  };
  supportsPromptOverride: boolean;
  fallbackInstructions?: string;
  fallbackPrompt?: string;
  promptVariables: string[];
}

type StoredModeNodeRuntimeTemplateDefinition = Omit<ModeNodeRuntimeTemplateDefinition, "promptVariables">;

const MODE_NODE_RUNTIME_TEMPLATE_LIBRARY: Record<
  CoordinationPattern,
  Partial<Record<ModeNodeTemplate, StoredModeNodeRuntimeTemplateDefinition>>
> = {
  generator_verifier: {
    research: {
      description: "Gather focused supporting context to inform the draft.",
      display: { story: "{{owner}} gathers relevant files, patterns, and evidence before drafting." },
      supportsPromptOverride: true,
      fallbackInstructions: "Gather only high-signal supporting context for the prompt. Read relevant files, search for patterns, and collect evidence. Label sources and separate facts from inference. Do NOT produce the candidate yet — only research.",
      fallbackPrompt: "Prompt: {{prompt}}\n\nGather focused supporting context to inform the draft candidate. Read relevant files, search for patterns, and collect evidence. Label sources or file paths, separate facts from inference, and list evidence gaps or uncertainty. Keep the research concise and actionable — the draft stage will produce the actual candidate.",
    },
    draft: {
      description: "Draft a candidate answer for verifier review.",
      display: { story: "{{owner}} drafts a candidate answer that the verifier can inspect and improve." },
      supportsPromptOverride: true,
      fallbackInstructions: "Produce a concrete candidate answer for this generator stage. Use the research context — do not redo investigation.",
      fallbackPrompt: "Prompt: {{prompt}}\nAttempt: {{attempt}}\n\nRESEARCH CONTEXT:\n{{research}}\n\nIMPORTANT CONTEXT:\n- Previous candidate (YOUR last output):\n{{candidate}}\n\n- Verifier feedback on your candidate:\n{{verifierNotes}}\n\nYOUR TASK: Revise the previous candidate to address every item in the verifier feedback. Do NOT start from scratch — improve what you already wrote. If this is attempt 1 with no previous candidate, produce the initial candidate based on the research context above. Produce exactly ONE candidate — do not iterate or produce multiple versions inline.",
    },
    verify: {
      description: "Evaluate the candidate against the current rubric.",
      display: { story: "{{owner}} checks the candidate against the rubric and decides whether it is ready." },
      supportsPromptOverride: true,
      fallbackInstructions: "Return only one compact JSON object with keys verdict, rationale, and missingRequirements. Use verdict=\"pass\" when the candidate adequately addresses the core requirements — minor issues should not block passing. If the candidate fundamentally misses the mark, return {\"verdict\":\"fail\",\"rationale\":\"...\",\"missingRequirements\":[\"...\"]}. Do not include markdown, prose, greetings, or role explanations outside the JSON object.",
      fallbackPrompt: "Original prompt: {{prompt}}\nRubric:\n- {{rubric}}\nCandidate:\n{{candidate}}\nReturn JSON with keys verdict ('pass'|'fail'), rationale, and missingRequirements (array of strings).",
    },
    decide: {
      description: "Reserved stage for a future explicit accept/retry decision step.",
      display: { story: "{{owner}} makes the accept, retry, or stop decision for this verification loop." },
      supportsPromptOverride: false,
      fallbackInstructions: "Review the candidate and verdict. Decide: accept and stop, retry with specific feedback, or abort with a clear reason.",
      fallbackPrompt: "Prompt: {{prompt}}\nCandidate:\n{{candidate}}\nVerification verdict: {{verdict}}\nVerifier rationale: {{rationale}}\nMissing requirements: {{missingRequirements}}\nDecide: accept, retry, or abort. If retry, list exactly what must change.",
    },
  },
  orchestrator_subagent: {
    decompose: {
      description: "Break the task into inspectable orchestration steps.",
      display: { story: "{{owner}} breaks the request into clear responsibilities before other stages start." },
      supportsPromptOverride: true,
      fallbackInstructions: "Keep the orchestration plan short, explicit, and inspectable. Count the meaningful sub-tasks, name which ones need research or review, and call out any simple work that should not be delegated.",
      fallbackPrompt: "Task: {{prompt}}\nDecompose it into research, review, and synthesis responsibilities.",
    },
    research: {
      description: "Collect focused supporting context from the decomposition plan.",
      display: { story: "{{owner}} gathers focused context for the plan instead of answering from first impressions." },
      supportsPromptOverride: true,
      fallbackInstructions: "Gather only high-signal supporting context for the current plan. Label sources or file paths, separate facts from inference, and list evidence gaps or uncertainty.",
      fallbackPrompt: "Task: {{prompt}}\nGather focused supporting context for the orchestration plan:\n{{plan}}",
    },
    review: {
      description: "Review findings and surface risks or missing pieces.",
      display: { story: "{{owner}} reviews the work for gaps, contradictions, risks, and missing evidence." },
      supportsPromptOverride: true,
      fallbackInstructions: "Lead with concrete risks, contradictions, missing evidence, and acceptance gaps. Do not summarize first when actionable defects or verification gaps exist.",
      fallbackPrompt: "Task: {{prompt}}\nPlan:\n{{plan}}\nResearch:\n{{research}}\nReview completeness, risks, and missing pieces.",
    },
    synthesize: {
      description: "Combine plan, research, and review into the final answer.",
      display: { story: "{{owner}} combines the completed work into a final response with the mode's context intact." },
      supportsPromptOverride: true,
      fallbackInstructions: "Synthesize the plan, research, and review into one user-facing answer. State the evidence basis, residual risks, and next useful action without replaying internal process.",
      fallbackPrompt: "Task: {{prompt}}\nPlan:\n{{plan}}\nResearch:\n{{research}}\nReview:\n{{review}}\nProduce the final orchestrated answer.",
    },
  },
  agent_teams: {
    triage: {
      description: "Turn the task into a compact team backlog.",
      display: { story: "{{owner}} turns the request into a small backlog with explicit ownership." },
      supportsPromptOverride: true,
      fallbackInstructions: "Create a compact backlog with explicit ownership.",
      fallbackPrompt: "Task: {{prompt}}\nBreak the work into a team backlog with explicit ownership.",
    },
    build: {
      description: "Complete the assigned backlog item.",
      display: { story: "{{owner}} completes the assigned work item using the mode's available capabilities." },
      supportsPromptOverride: true,
      fallbackInstructions: "Complete the assigned work item.",
      fallbackPrompt: "Task: {{prompt}}\nBacklog:\n{{triage}}\nComplete the builder's assigned work.",
    },
    check: {
      description: "Validate builder output and report issues or approval.",
      display: { story: "{{owner}} checks the completed work and reports approval or concrete issues." },
      supportsPromptOverride: true,
      fallbackInstructions: "Validate the assigned work and return a structured verdict. Start with `Verdict: PASS | NEEDS_FIX | BLOCKED`, then list blocking issues, evidence, and any required rework.",
      fallbackPrompt: "Task: {{prompt}}\nBacklog:\n{{triage}}\nBuilder output:\n{{build}}\nValidate the work. Start with `Verdict: PASS | NEEDS_FIX | BLOCKED`, then report blocking issues, evidence, and any required rework.",
    },
    handoff: {
      description: "Summarize handoff state and the next action.",
      display: { story: "{{owner}} packages the current state so the next stage knows what changed and what remains." },
      supportsPromptOverride: true,
      fallbackInstructions: "Summarize the handoff state and next action.",
      fallbackPrompt: "Task: {{prompt}}\nBacklog:\n{{triage}}\nBuilder:\n{{build}}\nReviewer:\n{{check}}\nRecord the handoff and next action.",
    },
  },
  message_bus: {
    publish: {
      description: "Publish the initial input event to the bus.",
      display: { story: "{{owner}} publishes the initial event so downstream subscribers can react to it." },
      supportsPromptOverride: false,
      fallbackInstructions: "Publish the task as a structured event with a correlation id and topic.",
      fallbackPrompt: "Task: {{prompt}}\nPublish this as a structured event for downstream subscribers.",
    },
    route: {
      description: "Classify the incoming event and choose the subscriber path.",
      display: { story: "{{owner}} classifies the event and routes it to the subscriber that should handle it." },
      supportsPromptOverride: true,
      fallbackInstructions: "Route work explicitly to the correct subscriber.",
      fallbackPrompt: "Task: {{prompt}}\nClassify the incoming event and decide which topic/subscriber should receive it.",
    },
    handle: {
      description: "Process the routed work item and emit findings.",
      display: { story: "{{owner}} handles the routed work item and emits findings back into the bus." },
      supportsPromptOverride: true,
      fallbackInstructions: "Produce findings for the routed event.",
      fallbackPrompt: "Task: {{prompt}}\nRouting plan:\n{{routingPlan}}\nProduce the investigation findings for the subscribed work item.",
    },
    respond: {
      description: "Turn bus findings into the final response event.",
      display: { story: "{{owner}} turns routed findings into the final response event for the user." },
      supportsPromptOverride: true,
      fallbackInstructions: "Publish the final bus response.",
      fallbackPrompt: "Task: {{prompt}}\nRouting plan:\n{{routingPlan}}\nFindings:\n{{findings}}\nProduce the final routed response.",
    },
  },
  shared_state: {
    seed: {
      description: "Create the initial shared-state board.",
      display: { story: "{{owner}} initializes the shared board so every collaborator starts from the same state." },
      supportsPromptOverride: true,
      fallbackInstructions: "Seed the shared board with the initial hypothesis.",
      fallbackPrompt: "Task: {{prompt}}\nCreate the initial shared-state board for collaborative work.",
    },
    research: {
      description: "Add the next meaningful finding to the shared board.",
      display: { story: "{{owner}} contributes the next useful finding to the shared board." },
      supportsPromptOverride: true,
      fallbackInstructions: "Add a meaningful finding to the shared board.",
      fallbackPrompt: "Task: {{prompt}}\nCurrent shared board:\n{{sharedBoard}}\nAdd the next finding that other agents should build on.",
    },
    converge: {
      description: "Review the board and decide whether it has converged.",
      display: { story: "{{owner}} reviews the shared board and decides whether the collaborators have converged." },
      supportsPromptOverride: true,
      fallbackInstructions: "Decide whether the shared board has converged.",
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

const CANONICAL_AGENT_SOULS: Record<string, string> = {
  generator: [
    "You are Generator, Ora's candidate-output maker.",
    "Responsibility: turn the user's goal and current stage context into a concrete candidate artifact another agent can inspect, test, or revise.",
    "Boundary: do not approve your own work, hide assumptions, or spend output on process narration when a direct draft is needed.",
    "Output: provide the draft plus only the assumptions, acceptance criteria, unresolved choices, and evidence gaps needed for verification.",
  ].join("\n"),
  verifier: [
    "You are Verifier, Ora's explicit acceptance gate.",
    "Responsibility: judge candidate work against the explicit task, rubric, and stage requirements instead of general plausibility.",
    "Boundary: never rubber-stamp vague, untestable, or partially missing work; do not rewrite the candidate unless the stage asks for a retry.",
    "Output: return a clear pass/fail decision, compact rationale, missing requirements, and the evidence that supports the verdict.",
  ].join("\n"),
  orchestrator: [
    "You are Orchestrator, Ora's scope owner and synthesis lead.",
    "Responsibility: frame scope, choose the smallest useful decomposition, assign ownership, and keep stage handoffs inspectable.",
    "Boundary: in multi-agent modes, prefer delegating file operations to specialized builder agents when available. You plan and synthesize; when a builder is available, hand off code changes.",
    "Never: bypass the builder to write files directly when the mode assigns code changes to a builder. Never skip the review gate when the mode requires it. Never present delegated work as your own private reasoning.",
    "Output: provide the plan, owner mapping, handoff state, final synthesis, and any blocked assumptions that require user input.",
    "Style: answer directly without greeting openings like 好的/好嘞/哈哈. No emoji. Lead with the answer, not a preamble. Be concise — prefer 2-6 sentences for simple answers, more only when the task requires depth.",
  ].join("\n"),
  researcher: [
    "You are Researcher, Ora's evidence and context specialist.",
    "Responsibility: gather focused context that downstream agents can verify, cite, and use for the current task.",
    "Boundary: do not answer from first impressions, over-collect broad background, or blur observed facts with inference.",
    "Never: present inference or assumption as observed fact. Never cite a source you have not actually read. Never suppress findings that contradict the expected answer.",
    "Output: separate facts, sources or paths, inferences, uncertainty, constraints, and open questions; prefer small high-signal findings.",
  ].join("\n"),
  reviewer: [
    "You are Reviewer, Ora's risk and completeness critic.",
    "Responsibility: inspect work for gaps, contradictions, regressions, missing tests, weak evidence, and unclear acceptance criteria.",
    "Boundary: do not summarize first when actionable defects exist, and do not approve work that lacks the evidence required by the mode.",
    "Never: rubber-stamp work with vague approval like \"looks good.\" Never ignore uncertainty in the evidence — flag it explicitly. Never approve because the builder seems competent; judge the work, not the agent.",
    "Output: lead with concrete findings, severity or acceptance impact, required fixes, and the evidence that justifies approval or rejection.",
  ].join("\n"),
  team_lead: [
    "You are Team Lead, Ora's persistent-worker coordinator.",
    "Responsibility: turn work into a compact backlog with clear owners, dependencies, memory needs, and handoff state.",
    "Boundary: do not duplicate assignments, leave workers without acceptance criteria, or personally absorb work that belongs to a specialist.",
    "Output: report backlog state, owner decisions, collected results, next action, remaining risks, and what should persist in worker memory.",
  ].join("\n"),
  builder: [
    "You are Builder, Ora's implementation agent.",
    "Responsibility: make the assigned source changes or produce the requested artifact with minimal churn and local conventions.",
    "Boundary: do not broaden scope, refactor unrelated code, or hide tradeoffs that affect correctness or maintainability.",
    "Never: fabricate error messages, stack traces, or tool output to justify a change. Never claim confidence when the fix is speculative. Never skip verification steps assigned by the mode.",
    "Output: report changed surfaces, concrete outputs, verification commands or evidence, and any residual risk for Reviewer or Team Lead.",
  ].join("\n"),
  router: [
    "You are Router, Ora's event-routing agent.",
    "Responsibility: classify incoming work, choose the right topic or handler, and preserve correlation context for downstream subscribers.",
    "Boundary: do not perform the handler's work or drop ambiguous events silently; ask for clarification or route to a safe fallback when needed.",
    "Output: publish the route, rationale, correlation id, required context, and confidence or uncertainty so the next agent can act.",
  ].join("\n"),
  responder: [
    "You are Responder, Ora's final-response publisher.",
    "Responsibility: turn routed findings and verified stage outputs into the final answer the user can rely on.",
    "Boundary: do not invent missing results, hide failed stages, or present unverified bus messages as settled conclusions.",
    "Output: answer in the user's requested style, cite the evidence or missing signal, state residual risk, and make the next useful action clear.",
  ].join("\n"),
  [ORA_ROOT_AGENT_ID]: [
    "You are Ora, the root conversation agent for Ora.",
    "Responsibility: receive the user's message first, decide whether clarification or routing is needed, hand work to mode agents when useful, observe delegated progress, and author the final user-facing answer.",
    "Boundary: do not pretend mode-internal work is your private reasoning, do not hide material uncertainty, and do not delegate simple single-agent work to a fake teammate.",
    "Output: keep the user's goal central, make handoffs and final answers concrete, include essential verification or evidence, and surface residual risk when it matters.",
    "Style: answer directly without greeting openings like 好的/好嘞/哈哈. No emoji. Lead with the answer, not a preamble. Be concise — prefer 2-6 sentences for simple answers, more only when the task requires depth.",
  ].join("\n"),
  release_reviewer: [
    "You are Release Reviewer, Ora's package and promotion safety gate.",
    "Responsibility: review build logs, package manifests, compatibility, activation risk, rollback readiness, and verification evidence before promotion.",
    "Boundary: do not promote a candidate because code checks passed alone; block when the package is not inspectable, reversible, or aligned with scope.",
    "Output: give a promote/block verdict, required fixes, rollback target, compatibility notes, and the evidence supporting the release decision.",
  ].join("\n"),
};

function canonicalAgentSoul(id: string, fallback: string): string {
  return CANONICAL_AGENT_SOULS[id] ?? fallback;
}

const profile = (
  id: string,
  label: string,
  role: string,
  pattern: CoordinationPattern,
  namespaces: string[],
  systemPrompt: string = canonicalAgentSoul(id, role),
): AgentProfile => ({
  id,
  label,
  role,
  systemPrompt,
  toolPolicyId: `${pattern}.default_policy`,
  toolIds: [],
  skillIds: [],
  memoryNamespaces: namespaces,
  budget: DEFAULT_RESOURCE_BUDGETS[pattern]
});

function defaultNodeInstructions(family: CoordinationPattern, template: ModeNodeTemplate): string | undefined {
  return MODE_NODE_RUNTIME_TEMPLATE_LIBRARY[family]?.[template]?.fallbackInstructions;
}

const ALL_COORDINATION_PATTERNS = [...BuiltInCoordinationPatternSchema.options] as BuiltInCoordinationPattern[];

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
    id: "long_term_memory",
    scope: "mode",
    label: "Long-term Memory",
    description: "Update a durable user memory profile from conversation context and inject relevant facts into future runs.",
    compatibleFamilies: ALL_COORDINATION_PATTERNS,
    requiresTools: [],
    requiresFlags: [],
    topology: {
      presentation: "mode_capability",
      edgeKind: "memory",
      edgeLabel: "profile",
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
  {
    id: "dynamic_stage_skipping",
    scope: "mode",
    label: "Dynamic Stage Skipping",
    description: "Let triage assess task complexity and skip downstream stages for trivial/simple tasks to reduce latency.",
    compatibleFamilies: ["agent_teams"],
    requiresTools: [],
    requiresFlags: [],
    topology: {
      presentation: "mode_capability",
      edgeKind: "control",
      edgeLabel: "skip",
    },
    defaultEnabled: false,
  },
  {
    id: "dynamic_delegation",
    scope: "mode",
    label: "Dynamic Delegation",
    description: "Let the orchestrator decide at runtime which subagents to activate and with what focus, based on task content.",
    compatibleFamilies: ["orchestrator_subagent"],
    requiresTools: [],
    requiresFlags: [],
    topology: {
      presentation: "mode_capability",
      edgeKind: "control",
      edgeLabel: "delegate",
    },
    defaultEnabled: false,
  },
];

export function getModeRuntimeAtom(id: ModeRuntimeAtomId): ModeRuntimeAtomDefinition | undefined {
  return MVP_MODE_RUNTIME_ATOMS.find((candidate) => candidate.id === id);
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

export function modeUsesSingleOwner(mode: ModeSpec, orderedNodes: ModeNodeSpec[]): boolean {
  const fallbackAgentId = mode.profiles[0]?.id;
  const ownerIds = new Set(
    orderedNodes.map((node) => node.ownerAgentId ?? fallbackAgentId).filter((id): id is string => typeof id === "string"),
  );
  return ownerIds.size <= 1 && !orderedNodes.some((node) => nodeRuntimeAtomIds(node).includes("subagent_delegate"));
}

// Legacy alias — prefer modeUsesSingleOwner
function modeUsesSingleOwnerTopology(mode: ModeSpec, orderedNodes: ModeNodeSpec[]): boolean {
  return modeUsesSingleOwner(mode, orderedNodes);
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
      if (!atom || atom.scope !== "node" || atom.topology.presentation !== "stage_attachment") {
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
    recommendedUse: "Use for tasks that benefit from explicit verification — such as code review, debate-style quality checks, adversarial testing, or when the answer must be confirmed against a rubric before delivery.",
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
      profile("generator", "Generator", "Produce concrete candidate work for verifier review.", "generator_verifier", [
        "session",
        "project"
      ]),
      profile("verifier", "Verifier", "Evaluate candidate work against explicit acceptance criteria.", "generator_verifier", [
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
      { id: "research", title: "Research context", ownerAgentId: "generator", dependencies: [] },
      { id: "draft", title: "Draft candidate output", ownerAgentId: "generator", dependencies: ["research"] },
      { id: "verify", title: "Verify against rubric", ownerAgentId: "verifier", dependencies: ["draft"] }
    ]
  },
  orchestrator_subagent: {
    id: "orchestrator_subagent",
    label: "Orchestrator-Subagent",
    summary: "An orchestrator decomposes the task and dispatches explicit subagents.",
    recommendedUse: "Use for complex tasks that benefit from structured decomposition into research and review stages before delivering the final answer.",
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
      profile(ORA_ROOT_AGENT_ID, ORA_ROOT_AGENT_LABEL, "Frame scope, coordinate stages, and synthesize results.", "orchestrator_subagent", [
        "session",
        "project"
      ]),
      profile("researcher", "Researcher", "Gather focused evidence and context for downstream inspection.", "orchestrator_subagent", [
        "session",
        "project"
      ]),
      profile("reviewer", "Reviewer", "Check completeness, risks, evidence, and acceptance criteria.", "orchestrator_subagent", [
        "session",
        "artifact"
      ])
    ],
    topology: {
      nodes: [
        { id: "run", label: "Run", kind: "run", status: "idle", metadata: {} },
        { id: ORA_ROOT_AGENT_ID, label: ORA_ROOT_AGENT_LABEL, kind: "agent", agentId: ORA_ROOT_AGENT_ID, status: "idle", metadata: {} },
        { id: "researcher", label: "Research", kind: "agent", agentId: "researcher", status: "idle", metadata: {} },
        { id: "reviewer", label: "Review", kind: "agent", agentId: "reviewer", status: "idle", metadata: {} }
      ],
      edges: [
        { id: "run-ora", source: "run", target: ORA_ROOT_AGENT_ID, kind: "control", metadata: {} },
        { id: "ora-researcher", source: ORA_ROOT_AGENT_ID, target: "researcher", kind: "delegation", label: "research", metadata: {} },
        { id: "ora-reviewer", source: ORA_ROOT_AGENT_ID, target: "reviewer", kind: "delegation", label: "review", metadata: {} }
      ]
    },
    planTemplate: [
      { id: "decompose", title: "Decompose task into inspectable plan", ownerAgentId: ORA_ROOT_AGENT_ID, dependencies: [] },
      { id: "research", title: "Gather focused supporting context", ownerAgentId: "researcher", dependencies: ["decompose"] },
      { id: "review", title: "Review result and surface risks", ownerAgentId: "reviewer", dependencies: ["research"] },
      { id: "synthesize", title: "Synthesize final response", ownerAgentId: ORA_ROOT_AGENT_ID, dependencies: ["review"] }
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
      profile(ORA_ROOT_AGENT_ID, ORA_ROOT_AGENT_LABEL, "Prioritize backlog and coordinate persistent workers.", "agent_teams", [
        "session",
        "project"
      ]),
      profile("builder", "Builder", "Complete assigned implementation or production work.", "agent_teams", [
        "session",
        "project",
        "worker"
      ]),
      profile("reviewer", "Reviewer", "Validate completed work for quality, risks, and missing evidence.", "agent_teams", [
        "session",
        "project",
        "worker",
        "artifact"
      ])
    ],
    topology: {
      nodes: [
        { id: "run", label: "Run", kind: "run", status: "idle", metadata: {} },
        { id: ORA_ROOT_AGENT_ID, label: ORA_ROOT_AGENT_LABEL, kind: "agent", agentId: ORA_ROOT_AGENT_ID, status: "idle", metadata: {} },
        { id: "builder", label: "Builder", kind: "agent", agentId: "builder", status: "idle", metadata: {} },
        { id: "reviewer", label: "Reviewer", kind: "agent", agentId: "reviewer", status: "idle", metadata: {} }
      ],
      edges: [
        { id: "ora-builder", source: ORA_ROOT_AGENT_ID, target: "builder", kind: "delegation", label: "assign", metadata: {} },
        { id: "builder-reviewer", source: "builder", target: "reviewer", kind: "verification", label: "validate", metadata: {} },
        { id: "reviewer-ora", source: "reviewer", target: ORA_ROOT_AGENT_ID, kind: "control", label: "report", metadata: {} }
      ]
    },
    planTemplate: [
      { id: "triage", title: "Triage work into team backlog", ownerAgentId: ORA_ROOT_AGENT_ID, dependencies: [] },
      { id: "build", title: "Complete assigned task", ownerAgentId: "builder", dependencies: ["triage"] },
      { id: "check", title: "Validate output", ownerAgentId: "reviewer", dependencies: ["build"] },
      { id: "handoff", title: "Record handoff and next action", ownerAgentId: ORA_ROOT_AGENT_ID, dependencies: ["check"] }
    ]
  },
  message_bus: {
    id: "message_bus",
    label: "Message Bus",
    summary: "Agents publish and subscribe to routed events through a shared bus.",
    recommendedUse: "Use when a task is best handled by multiple specialized agents subscribing to different topics, with explicit routing and correlation tracking between stages.",
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
      profile(ORA_ROOT_AGENT_ID, ORA_ROOT_AGENT_LABEL, "Classify messages and route them to interested subscribers.", "message_bus", [
        "session",
        "project"
      ]),
      profile("researcher", "Researcher", "Handle routed work items and publish evidence-backed findings.", "message_bus", [
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
        { id: ORA_ROOT_AGENT_ID, label: ORA_ROOT_AGENT_LABEL, kind: "agent", agentId: ORA_ROOT_AGENT_ID, status: "idle", metadata: {} },
        { id: "triage_topic", label: "triage", kind: "capability", status: "idle", metadata: { role: "topic" } },
        { id: "researcher", label: "Researcher", kind: "agent", agentId: "researcher", status: "idle", metadata: {} },
        { id: "responder", label: "Responder", kind: "agent", agentId: "responder", status: "idle", metadata: {} }
      ],
      edges: [
        { id: "run-ora", source: "run", target: ORA_ROOT_AGENT_ID, kind: "control", label: "publish", metadata: {} },
        { id: "ora-topic", source: ORA_ROOT_AGENT_ID, target: "triage_topic", kind: "artifact", label: "route", metadata: {} },
        { id: "topic-researcher", source: "triage_topic", target: "researcher", kind: "delegation", label: "deliver", metadata: {} },
        { id: "researcher-responder", source: "researcher", target: "responder", kind: "verification", label: "finding", metadata: {} }
      ]
    },
    planTemplate: [
      { id: "publish", title: "Publish the initial event", ownerAgentId: ORA_ROOT_AGENT_ID, dependencies: [] },
      { id: "route", title: "Route events to subscribers", ownerAgentId: ORA_ROOT_AGENT_ID, dependencies: ["publish"] },
      { id: "handle", title: "Handle subscribed work", ownerAgentId: "researcher", dependencies: ["route"] },
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
      profile(ORA_ROOT_AGENT_ID, ORA_ROOT_AGENT_LABEL, "Seed the shared board with scope, initial hypotheses, and decision criteria.", "shared_state", [
        "session",
        "project"
      ]),
      profile("researcher", "Researcher", "Add evidence-backed findings to the shared board.", "shared_state", [
        "session",
        "project",
        "artifact"
      ]),
      profile("reviewer", "Reviewer", "Validate shared findings and decide whether the board has converged.", "shared_state", [
        "session",
        "project",
        "artifact"
      ])
    ],
    topology: {
      nodes: [
        { id: "run", label: "Run", kind: "run", status: "idle", metadata: {} },
        { id: ORA_ROOT_AGENT_ID, label: ORA_ROOT_AGENT_LABEL, kind: "agent", agentId: ORA_ROOT_AGENT_ID, status: "idle", metadata: {} },
        { id: "shared_board", label: "Shared Board", kind: "capability", status: "idle", metadata: { role: "blackboard" } },
        { id: "researcher", label: "Researcher", kind: "agent", agentId: "researcher", status: "idle", metadata: {} },
        { id: "reviewer", label: "Reviewer", kind: "agent", agentId: "reviewer", status: "idle", metadata: {} }
      ],
      edges: [
        { id: "run-ora", source: "run", target: ORA_ROOT_AGENT_ID, kind: "control", label: "seed", metadata: {} },
        { id: "ora-board", source: ORA_ROOT_AGENT_ID, target: "shared_board", kind: "memory", label: "write", metadata: {} },
        { id: "researcher-board", source: "researcher", target: "shared_board", kind: "memory", label: "contribute", metadata: {} },
        { id: "reviewer-board", source: "reviewer", target: "shared_board", kind: "verification", label: "review", metadata: {} }
      ]
    },
    planTemplate: [
      { id: "seed", title: "Seed the shared board", ownerAgentId: ORA_ROOT_AGENT_ID, dependencies: [] },
      { id: "research", title: "Contribute findings to the shared board", ownerAgentId: "researcher", dependencies: ["seed"] },
      { id: "converge", title: "Review board convergence and finalize", ownerAgentId: "reviewer", dependencies: ["research"] }
    ]
  }
};

export const MVP_PATTERNS = Object.values(MVP_PATTERN_DEFINITIONS);

export function getPatternDefinition(pattern: CoordinationPattern): PatternDefinition {
  return MVP_PATTERN_DEFINITIONS[pattern];
}

function defaultRuntimePolicyForFamily(family: CoordinationPattern): ModeRuntimePolicy {
  switch (family) {
    case "generator_verifier":
      return runtimePolicyForPreset("verifier");
    case "agent_teams":
      return runtimePolicyForPreset("team");
    case "message_bus":
    case "shared_state":
      return {
        ...runtimePolicyForPreset("balanced"),
        planning: "explicit",
      };
    case "orchestrator_subagent":
    default:
      return {
        ...runtimePolicyForPreset("balanced"),
        delegation: "allowed",
      };
  }
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
  const definition = MODE_NODE_RUNTIME_TEMPLATE_LIBRARY[family]?.[template];
  if (!definition) {
    return {
      description: `No runtime template metadata is registered for '${template}' in family '${family}'.`,
      display: {
        story: `No runtime template metadata is registered for '${template}' in family '${family}'.`,
      },
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
  const nodeById = new Map(enabledNodes.map((node) => [node.id, node]));
  const indegree = new Map(enabledNodes.map((node) => [node.id, 0]));
  const adjacency = new Map(enabledNodes.map((node) => [node.id, [] as string[]]));

  for (const edge of activeEnabledModeEdges(mode)) {
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
        const candidate = nodeById.get(target);
        if (candidate) {
          const candOrder = orderIndex.get(candidate.id) ?? 0;
          let lo = 0;
          let hi = queue.length;
          while (lo < hi) {
            const mid = (lo + hi) >>> 1;
            if ((orderIndex.get(queue[mid].id) ?? 0) < candOrder) lo = mid + 1;
            else hi = mid;
          }
          queue.splice(lo, 0, candidate);
        }
      }
    }
  }

  return ordered.length === enabledNodes.length ? ordered : enabledNodes;
}

/**
 * Groups enabled ModeNodes into topological layers. Nodes within the same layer have no
 * dependencies on each other and can be executed in parallel (e.g. via Promise.all).
 */
export function orderedEnabledModeLayers(mode: Pick<ModeSpec, "nodes" | "edges">): ModeNodeSpec[][] {
  const enabledNodes = mode.nodes.filter((node) => node.enabled);
  const indegree = new Map(enabledNodes.map((node) => [node.id, 0]));
  const adjacency = new Map(enabledNodes.map((node) => [node.id, [] as string[]]));

  for (const edge of activeEnabledModeEdges(mode)) {
    adjacency.get(edge.source)?.push(edge.target);
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
  }

  const layers: ModeNodeSpec[][] = [];
  const visited = new Set<string>();
  let currentLayer = enabledNodes.filter((node) => (indegree.get(node.id) ?? 0) === 0);

  while (currentLayer.length > 0) {
    for (const node of currentLayer) visited.add(node.id);
    layers.push(currentLayer);
    for (const node of currentLayer) {
      for (const target of adjacency.get(node.id) ?? []) {
        indegree.set(target, (indegree.get(target) ?? 0) - 1);
      }
    }
    currentLayer = enabledNodes.filter((node) => (indegree.get(node.id) ?? 0) === 0 && !visited.has(node.id));
  }

  // Degrade to ordered list if not all nodes reachable (cycle detected)
  if (visited.size !== enabledNodes.length) {
    const unreachableIds = enabledNodes
      .filter((n) => !visited.has(n.id))
      .map((n) => n.id);
    const modeLabel = "label" in mode && typeof mode.label === "string" ? mode.label : "unknown";
    console.warn(
      `[topology] Cycle detected in mode "${modeLabel}" — layer grouping degraded. ` +
      `Unreachable nodes: ${unreachableIds.join(", ")}.`,
    );
    return [enabledNodes];
  }

  return layers;
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

export function createModeSpecFromPattern(pattern: BuiltInCoordinationPattern): ModeSpec {
  const definition = getPatternDefinition(pattern)!;
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
      instructions: defaultNodeInstructions(definition.id, item.id as ModeNodeTemplate),
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
      toolIds: [...DEFAULT_AGENT_MODE_TOOL_IDS],
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
    completionPolicy: completionPolicyForPreset("balanced"),
    runtimePolicy: defaultRuntimePolicyForFamily(pattern),
    createdAt: now,
    updatedAt: now,
  }));
}

function createSingleAgentModeSpec(): ModeSpec {
  const now = 0;
  const singleAgentToolIds = visibleToolIdsForPreset("single_agent_implement", DEFAULT_AGENT_MODE_TOOL_IDS);
  return autoLayoutModeSpec(ModeSpecSchema.parse({
    id: SINGLE_AGENT_MODE_ID,
    family: "orchestrator_subagent",
    label: "单智能体",
    summary: "单个智能体默认独立制定计划并完成任务；若用户当前回合明确要求团队协作，可临时委托子代理。",
    description: "当你需要一个可问责的智能体直接思考并回答时，使用最简单的执行路径；默认直接处理，但可在当前回合按用户要求委派。",
    recommendedUse: "适用于简单直接的任务；默认无需委托额外子代理，但可在用户明确要求时临时协作。",
    failureMode: "单个智能体可能遗漏多智能体审查本可发现的盲点。",
    systemPreset: true,
    nodes: [
      {
        id: "respond",
        template: "synthesize",
        label: "响应",
        title: "响应",
        ownerAgentId: ORA_ROOT_AGENT_ID,
        enabled: true,
        instructions: "直接完成用户请求，将最终答案作为唯一输出。",
        config: {},
      },
    ],
    edges: [],
    stopPolicy: {
      type: "queue_drained",
      detail: "单独智能体产出最终响应后停止。",
    },
    capabilityFlags: {
      supportsPersistentWorkers: false,
      supportsSharedState: false,
      supportsEventRouting: false,
      approvalMode: "high_risk_only",
      skillIds: [],
      toolIds: singleAgentToolIds,
    },
    runtimeAtoms: defaultRuntimeAtomsForFamily("orchestrator_subagent"),
    editorConstraints: {
      allowedNodeTemplates: MODE_FAMILY_RULES.orchestrator_subagent.allowedTemplates,
      requiredNodeTemplates: ["synthesize"],
      readOnly: true,
      allowReorder: true,
      allowCreate: false,
      allowDelete: false,
      allowDisable: false,
    },
    defaultBudget: SINGLE_AGENT_RESOURCE_BUDGET,
    completionPolicy: completionPolicyForPreset("balanced"),
    runtimePolicy: runtimePolicyForPreset("balanced"),
    profiles: [
      profile(
        ORA_ROOT_AGENT_ID,
        ORA_ROOT_AGENT_LABEL,
        "端到端负责用户对话，默认直接完成单智能体工作；如果用户当前回合明确要求团队协作或子智能体分工，可以临时委托额外子代理。",
        "orchestrator_subagent",
        ["session", "project"],
      ),
    ],
    createdAt: now,
    updatedAt: now,
  }));
}

function createDebateModeSpec(): ModeSpec {
  const now = 0;
  const debateAgentSoul = [
    "You are Debate Agent, Ora's reusable adversarial argument specialist.",
    "Responsibility: for each assigned virtual speaker turn, firmly defend the assigned stance and attack weak assumptions, missing evidence, contradictions, and burden-of-proof failures in the opposing side.",
    "Stance lock: your identity for each turn is defined by the assigned stance below; speak only as that side and do not evaluate the proposition neutrally.",
    "Anti-equivocation: never default to 'both sides have merit', 'both are valid', 'there is no clear answer', or 'the other side raises a fair point'; if you acknowledge an opponent's detail, immediately turn it into a rebuttal that strengthens your side.",
    "Boundary: do not fabricate facts, knowingly use invalid arguments, make personal attacks, or concede casually; any concession must be narrow, explicit, and strategically integrated.",
    "Output: separate claims, evidence, rebuttal, and burden-of-proof pressure while responding to prior arguments instead of giving isolated generic speeches.",
  ].join("\n");
  const moderatorSoul = [
    "You are Moderator, Ora's structured debate lead.",
    "Responsibility: frame the proposition, enforce the speaking order, and synthesize the strongest evidence and unresolved burden-of-proof questions.",
    "Boundary: do not let either side's rhetoric hide missing evidence, and do not present unresolved factual dependencies as settled.",
    "Output: give concise framing and final synthesis that identifies the strongest arguments, remaining uncertainty, and the most defensible conclusion.",
  ].join("\n");
  const debateSpeechPromptTemplate = [
    "Proposition or user request:\n{{prompt}}",
    "Moderator framing:\n{{frame}}",
    "Current virtual speaker: {{speakerLabel}}",
    "Assigned stance: {{stance}}",
    "STANCE LOCK: You are {{speakerLabel}}. Your mandatory stance is \"{{stance}}\"; every claim must support this side or attack the opposing side.",
    "Turn instruction: {{stageInstruction}}",
    "Prior debate transcript:\n{{priorTranscript}}",
    "Use the prior transcript only as material to rebut or pressure the opposing side; do not synthesize it into a neutral middle position.",
    "HARD CONSTRAINT: do not hedge, equivocate, or grant the opposing side's core premises. If you acknowledge an opponent's point, immediately counter it and make your own side stronger.",
    "OUTPUT FORMAT: Lead with the strongest claim for the {{stance}} position. Structure the speech as: (1) core thesis restatement, (2) new evidence or rebuttal, (3) burden-of-proof pressure on the opponent.",
    "Write only this speaker's speech. Keep the stance firm, responsive, and intellectually honest.",
  ].join("\n\n");
  const debateSpeechStages = [
    { id: "affirmative-lead-opening", label: "开篇立论", speakerLabel: "正方主辩", stance: "affirmative", instruction: "Open for the affirmative. Define the proposition favorably, make the strongest affirmative case, and set the burden of proof for the negative side." },
    { id: "negative-lead-opening", label: "开篇立论", speakerLabel: "反方主辩", stance: "negative", instruction: "Open for the negative. Attack the affirmative framing, present the strongest opposing case, and identify what the affirmative has not proven." },
    { id: "affirmative-deputy-one", label: "第一副辩", speakerLabel: "正方第一副辩", stance: "affirmative", instruction: "Rebut the negative opening. Strengthen the affirmative evidence and expose contradictions or overreach in the negative case." },
    { id: "negative-deputy-one", label: "第一副辩", speakerLabel: "反方第一副辩", stance: "negative", instruction: "Rebut the affirmative deputy. Press weak assumptions, missing evidence, and unresolved burden-of-proof gaps." },
    { id: "affirmative-deputy-two", label: "第二副辩", speakerLabel: "正方第二副辩", stance: "affirmative", instruction: "Advance the affirmative response. Address the strongest negative attacks and sharpen the affirmative comparative advantage." },
    { id: "negative-deputy-two", label: "第二副辩", speakerLabel: "反方第二副辩", stance: "negative", instruction: "Advance the negative response. Answer the latest affirmative claims and show why the negative position remains more defensible." },
    { id: "affirmative-lead-final", label: "总结陈词", speakerLabel: "正方主辩", stance: "affirmative", instruction: "Give the affirmative final statement. Weigh the debate, answer the decisive negative objections, and close without introducing unsupported new facts." },
    { id: "negative-lead-final", label: "总结陈词", speakerLabel: "反方主辩", stance: "negative", instruction: "Give the negative final statement. Weigh the debate, answer the affirmative closing line, and close without introducing unsupported new facts." },
  ].map((stage) => ({
    ...stage,
    nodeId: "debate",
    speakerId: "debate_agent",
    promptTemplate: debateSpeechPromptTemplate,
    adversarialStance: true,
  }));

  return autoLayoutModeSpec(ModeSpecSchema.parse({
    id: DEBATE_MODE_ID,
    family: "orchestrator_subagent",
    label: "辩论",
    summary: "主持人对命题进行框架设计，一个可复用的辩论智能体通过虚拟席位分别陈述正反方观点，最终由主持人进行综合裁决。",
    description: "在对话区域中观看结构化的对抗性辩论过程，无需为每个辩论席位创建独立的真实智能体。",
    recommendedUse: "适用于需要正反方明确交锋、反驳和最终主持综合的命题。",
    failureMode: "当用户只需要直接执行、研究或中立答案时，辩论可能过度放大对抗性框架。",
    systemPreset: true,
    nodes: [
      {
        id: "frame",
        template: "decompose",
        label: "Ora 框架设计",
        title: "Ora 框架设计",
        ownerAgentId: ORA_ROOT_AGENT_ID,
        enabled: true,
        instructions: "对用户的命题进行框架设计，重申辩论规则，明确举证责任，然后分发辩论回合。",
        prompt: "命题或用户请求：\n{{prompt}}\n\n为结构化辩论建立框架。保持简洁，明确发言顺序。",
        config: {},
      },
      {
        id: "debate",
        template: "research",
        label: "辩论发言",
        title: "辩论发言",
        ownerAgentId: "debate_agent",
        enabled: true,
        instructions: debateAgentSoul,
        config: {},
      },
      {
        id: "synthesis",
        template: "synthesize",
        label: "Ora 综合裁决",
        title: "Ora 综合裁决",
        ownerAgentId: ORA_ROOT_AGENT_ID,
        enabled: true,
        instructions: "综合辩论结果。识别双方最强的论点、未解决的事实依赖，得出最有说服力的结论，不假装辩论已解决不存在的问题。严格评估论据质量：如果一方提供了更强证据、更清晰逻辑或更少举证漏洞，要明确指出。不要默认说'双方都有道理'，除非证据确实支持这种罕见结论。",
        prompt: "命题或用户请求：\n{{prompt}}\n\n主持人框架：\n{{frame}}\n\n辩论记录：\n{{debateTranscript}}\n\n撰写最终主持综合裁决。基于证据质量、逻辑严密性和举证责任缺口，明确判断哪一方论点更强。不要默认说双方都有道理，除非辩论证据确实支持这一罕见结论。",
        config: {},
      },
    ],
    edges: [
      { id: "frame-debate", source: "frame", target: "debate", kind: "delegation", label: "dispatch", enabled: true },
      { id: "debate-synthesis", source: "debate", target: "synthesis", kind: "control", label: "synthesize", enabled: true },
    ],
    stages: [
      ...debateSpeechStages,
      {
        id: "moderator-synthesis",
        label: "主持总结",
        nodeId: "synthesis",
        speakerId: ORA_ROOT_AGENT_ID,
        speakerLabel: ORA_ROOT_AGENT_LABEL,
        stance: ORA_ROOT_AGENT_ID,
        outputKey: "synthesis",
      },
    ],
    transcriptLayout: {
      style: "two_sided_duel",
      groupId: "debate",
      groupLabel: "结构化辩论",
      ownsFinalAnswer: true,
      supplementalBody: "never",
      summaryStageIds: ["moderator-synthesis"],
      sideByStance: {
        affirmative: "left",
        negative: "right",
      },
      summaryStances: [ORA_ROOT_AGENT_ID, "neutral"],
      stanceLabels: {
        affirmative: "正方",
        negative: "反方",
        ora: "Ora",
        neutral: "中立",
      },
      stanceTones: {
        affirmative: "green",
        negative: "blue",
        ora: "violet",
        neutral: "gray",
      },
      showStatus: true,
      showSpeaker: true,
    },
    stopPolicy: {
      type: "queue_drained",
      detail: "主持人完成辩论记录的总结综合后停止。",
    },
    capabilityFlags: {
      supportsPersistentWorkers: false,
      supportsSharedState: false,
      supportsEventRouting: false,
      approvalMode: "high_risk_only",
      skillIds: [],
      toolIds: [...DEFAULT_AGENT_MODE_TOOL_IDS],
    },
    runtimeAtoms: defaultRuntimeAtomsForFamily("orchestrator_subagent"),
    editorConstraints: {
      allowedNodeTemplates: MODE_FAMILY_RULES.orchestrator_subagent.allowedTemplates,
      requiredNodeTemplates: ["decompose", "synthesize"],
      readOnly: true,
      allowReorder: false,
      allowCreate: false,
      allowDelete: false,
      allowDisable: false,
    },
    defaultBudget: DEFAULT_RESOURCE_BUDGETS.orchestrator_subagent,
    completionPolicy: completionPolicyForPreset("persistent"),
    runtimePolicy: runtimePolicyForPreset("delegated"),
    profiles: [
      profile(
        ORA_ROOT_AGENT_ID,
        ORA_ROOT_AGENT_LABEL,
        "Frame the proposition, enforce debate order, and synthesize the final answer.",
        "orchestrator_subagent",
        ["session", "project"],
        moderatorSoul,
      ),
      profile(
        "debate_agent",
        "Debate Agent",
        "Reuse one adversarial but honest argumentation agent for every virtual debate seat.",
        "orchestrator_subagent",
        ["session", "project"],
        debateAgentSoul,
      ),
    ],
    createdAt: now,
    updatedAt: now,
  }));
}

function createModeStudioBuilderModeSpec(): ModeSpec {
  const now = 0;
  return autoLayoutModeSpec(ModeSpecSchema.parse({
    id: MODE_STUDIO_BUILDER_MODE_ID,
    family: "agent_teams",
    label: "Mode Studio Builder",
    summary: "Internal builder run that turns Mode Studio conversations into validated mode and agent drafts.",
    description: "Hidden runtime mode used by Mode Studio to generate and refine complete ModeSpec drafts with stage prompts, agent roles, capabilities, and validation feedback.",
    recommendedUse: "Internal only: use when Mode Studio needs to generate or refine a mode from natural language.",
    failureMode: "Generated JSON may need repair or user clarification before it can be applied.",
    systemPreset: true,
    visibility: "internal",
    nodes: [
      {
        id: "triage",
        template: "triage",
        label: "Understand builder context",
        title: "Understand builder context",
        ownerAgentId: ORA_ROOT_AGENT_ID,
        enabled: true,
        instructions: defaultNodeInstructions("agent_teams", "triage"),
        config: {},
      },
      {
        id: "build",
        template: "build",
        label: "Draft mode bundle",
        title: "Draft mode bundle",
        ownerAgentId: "builder",
        enabled: true,
        instructions: defaultNodeInstructions("agent_teams", "build"),
        config: {},
      },
      {
        id: "check",
        template: "check",
        label: "Validate draft quality",
        title: "Validate draft quality",
        ownerAgentId: "reviewer",
        enabled: true,
        instructions: defaultNodeInstructions("agent_teams", "check"),
        config: {},
      },
      {
        id: "handoff",
        template: "handoff",
        label: "Return structured bundle",
        title: "Return structured bundle",
        ownerAgentId: ORA_ROOT_AGENT_ID,
        enabled: true,
        instructions: defaultNodeInstructions("agent_teams", "handoff"),
        config: {},
      },
    ],
    edges: [
      { id: "triage-build", source: "triage", target: "build", kind: "control", label: "draft", enabled: true },
      { id: "build-check", source: "build", target: "check", kind: "verification", label: "review", enabled: true },
      { id: "check-handoff", source: "check", target: "handoff", kind: "control", label: "handoff", enabled: true },
    ],
    stopPolicy: {
      type: "queue_drained",
      detail: "Stop after Mode Studio receives a structured draft bundle or clarification request.",
    },
    capabilityFlags: {
      supportsPersistentWorkers: true,
      supportsSharedState: false,
      supportsEventRouting: false,
      approvalMode: "auto",
      skillIds: [],
      toolIds: [],
    },
    runtimeAtoms: defaultRuntimeAtomsForFamily("agent_teams"),
    editorConstraints: {
      allowedNodeTemplates: MODE_FAMILY_RULES.agent_teams.allowedTemplates,
      requiredNodeTemplates: MODE_FAMILY_RULES.agent_teams.requiredTemplates,
      readOnly: true,
      allowReorder: false,
      allowCreate: false,
      allowDelete: false,
      allowDisable: false,
    },
    defaultBudget: DEFAULT_RESOURCE_BUDGETS.agent_teams,
    completionPolicy: completionPolicyForPreset("decisive"),
    runtimePolicy: runtimePolicyForPreset("team"),
    profiles: [
      profile(
        ORA_ROOT_AGENT_ID,
        ORA_ROOT_AGENT_LABEL,
        "Track the Mode Studio conversation, current draft, validation state, and requested refinement.",
        "agent_teams",
        ["session", "project"],
      ),
      profile(
        "builder",
        "Builder",
        "Write the complete ModeSpec and generated agent roster with concrete stage prompts and capabilities.",
        "agent_teams",
        ["session", "artifact"],
      ),
      profile(
        "reviewer",
        "Reviewer",
        "Check naming, schema validity, stage prompts, agent instructions, tools, and Apply readiness.",
        "agent_teams",
        ["session", "artifact"],
      ),
    ],
    createdAt: now,
    updatedAt: now,
  }));
}

function createCodeDevelopmentModeSpec(): ModeSpec {
  const now = 0;
  const orchestratorSoul = [
    "You are Orchestrator, Ora's project-development scope owner.",
    "Responsibility: clarify ambiguous requirements, create the smallest safe implementation plan, define acceptance criteria, enforce long-task-protocol task journals for non-trivial code work, and decide when the work is ready to hand off.",
    "Boundary: do not let implementation begin before scope, risk, and verification gates are explicit; do not expand scope or hide blocked assumptions.",
    "Output: provide the task breakdown, owner map, approval points, verification gates, SAVEPOINT state, DONE evidence, and residual risks.",
  ].join("\n");
  const builderSoul = [
    "You are Builder, Ora's project code implementation agent.",
    "Responsibility: make the smallest source changes that satisfy the approved scope, follow the repository's existing style, add or update focused tests, and keep verification evidence concrete.",
    "Boundary: do not refactor unrelated code, invent unrequested architecture, skip failing checks, or conceal assumptions that affect correctness.",
    "Output: report changed files, implementation notes, tests or checks run, failures encountered, and anything Reviewer or Debugger must inspect.",
  ].join("\n");
  const reviewerSoul = [
    "You are Reviewer, Ora's code quality and regression gate.",
    "Responsibility: inspect the builder output for correctness, regressions, missing tests, architecture drift, security issues, and unclear acceptance evidence.",
    "Boundary: do not rubber-stamp work because it looks plausible; do not rewrite unless the stage asks for a fix plan.",
    "Output: lead with blocking findings, then non-blocking concerns, evidence, and a pass/fail verdict tied to the acceptance criteria.",
  ].join("\n");
  const debuggerSoul = [
    "You are Debugger, Ora's failing-check and runtime-error diagnostician.",
    "Responsibility: diagnose failing tests, type errors, runtime crashes, and tool failures from evidence before proposing the smallest correction.",
    "Boundary: do not guess without logs or traces, do not patch symptoms before naming the root cause, and do not broaden the fix beyond the failing path.",
    "Output: state the root cause, evidence, minimal fix path, re-run commands, and whether the failure is resolved or still blocked.",
  ].join("\n");

  return autoLayoutModeSpec(ModeSpecSchema.parse({
    id: CODE_DEVELOPMENT_MODE_ID,
    family: "orchestrator_subagent",
    label: "代码开发",
    summary: "项目开发团队模式，通过明确的关卡来规划、编辑、审查、调试和验证代码变更。",
    description: "使用此模式进行实际的项目编码任务，Ora 将控制范围、使用 long-task-protocol 作为任务真相源、编写代码、审查差异、诊断故障，并交付可验证的证据。",
    recommendedUse: "适用于需要 long-task-protocol 任务日志、计划、源码编辑、测试、审查和故障诊断的非平凡代码变更。",
    failureMode: "如果验收标准或验证命令不明确，团队可能花费精力协调却无法证明代码真的能运行。",
    systemPreset: true,
    nodes: [
      {
        id: "triage",
        template: "triage",
        label: "规划开发任务",
        title: "规划开发任务",
        ownerAgentId: ORA_ROOT_AGENT_ID,
        enabled: true,
        instructions: "明确请求的代码变更，为非平凡开发工作调用 long-task-protocol，创建或更新任务日志，定义验收标准，识别风险文件，并在实施前选择聚焦的验证关卡。",
        prompt: "用户请求：\n{{prompt}}\n\n创建一个紧凑的开发计划。输出必须是严格的 JSON 格式（不要包含 Markdown 或额外说明）：\n\n{\n  \"text\": \"计划摘要\",\n  \"goal\": \"开发目标\",\n  \"successCriteria\": [\"可验证的验收标准\"],\n  \"backlog\": [{\"id\": \"1\", \"owner\": \"builder\", \"description\": \"任务描述\"}],\n  \"scopeBoundaries\": [\"不做的重构\", \"不改的模块\"],\n  \"taskJournalPath\": \"tasks/TASK-xxxx.md\",\n  \"targetFiles\": [\"可能涉及的文件路径\"],\n  \"verificationPlan\": [{\"id\": \"verify-1\", \"commandOrMethod\": \"pnpm test --filter ...\", \"expectation\": \"相关测试通过\"}],\n  \"riskFiles\": [\"高风险文件路径\"],\n  \"doneCriteria\": [\"long-task-protocol DONE gate 条件\"]\n}\n\n要求：successCriteria / verificationPlan / doneCriteria 必须可验证；scopeBoundaries 明确 NOT in scope；taskJournalPath 必须给出本次任务日志路径；此阶段不要实施。",
        config: {},
      },
      {
        id: "build",
        template: "build",
        label: "实施变更",
        title: "实施变更",
        ownerAgentId: "builder",
        enabled: true,
        instructions: "仅实施已批准的范围，匹配现有代码风格，避免推测性抽象，当变更影响行为时添加或更新聚焦测试。",
        prompt: "用户请求：\n{{prompt}}\n\n开发计划：\n{{triage_raw}}\n\n做出最小的可行代码变更。输出必须是严格的 JSON 格式（不要包含 Markdown 或其他文字）：\n\n{\n  \"text\": \"实施总结\",\n  \"artifacts\": [\"变更的文件路径1\", \"变更的文件路径2\"],\n  \"changedFiles\": [\"变更的文件路径1\", \"变更的文件路径2\"],\n  \"commandsRun\": [{\"command\": \"pnpm test --filter ...\", \"exitCode\": 0, \"summary\": \"为什么运行它\"}],\n  \"verificationEvidence\": [{\"verificationId\": \"verify-1\", \"result\": \"pass\", \"summary\": \"结果摘要\"}],\n  \"assumptions\": [\"影响正确性的前提假设\"],\n  \"followups\": [\"非阻塞后续事项\"]\n}\n\nchangedFiles / verificationEvidence 必须与实际实施一致，不要虚构未运行的命令。",
        riskLevel: "high",
        config: {},
      },
      {
        id: "review",
        template: "check",
        label: "审查差异",
        title: "审查差异",
        ownerAgentId: "reviewer",
        enabled: true,
        instructions: "对照请求和验收标准审查实施结果。优先关注回归、缺失测试、模式偏移、不安全的宽范围修改和不清楚的验证证据。",
        prompt: "用户请求：\n{{prompt}}\n\n开发计划：\n{{triage_raw}}\n\n构建者输出：\n{{build_raw}}\n\n逐条对照开发计划中的 successCriteria、verificationPlan 和 scopeBoundaries 审查变更。输出必须是严格的 JSON 格式（不要包含 Markdown 或额外说明）：\n\n{\n  \"text\": \"审查结论摘要\",\n  \"verdict\": \"pass | needs_fix | blocked\",\n  \"acceptedArtifactIds\": [\"build\"],\n  \"findings\": [{\"artifactId\": \"build\", \"severity\": \"blocking\", \"issue\": \"问题描述\"}],\n  \"blockingIssues\": [{\"artifactId\": \"build\", \"file\": \"src/example.ts\", \"issue\": \"阻塞问题\", \"requiredFix\": \"最小修复要求\"}],\n  \"acceptedFiles\": [\"已验收文件路径\"],\n  \"verificationGaps\": [\"未覆盖的验证缺口\"],\n  \"rejectedFiles\": [\"未通过的文件路径\"]\n}\n\n规则：PASS 表示允许进入 debug；NEEDS_FIX 表示必须返工 build；BLOCKED 表示只能降级交付。若 verdict=needs_fix，至少给出一个 blockingIssues。",
        riskLevel: "high",
        config: {
          gateOnReviewVerdict: true,
          reworkNodeIds: ["build"],
        },
      },
      {
        id: "debug",
        template: "check",
        label: "诊断故障",
        title: "诊断故障",
        ownerAgentId: "debugger",
        enabled: true,
        instructions: "根据证据诊断失败的测试、类型错误、运行时错误或审查者阻塞的行为，然后建议最小的修正方案。如果没有故障，明确确认无需调试操作。",
        prompt: "用户请求：\n{{prompt}}\n\n开发计划：\n{{triage_raw}}\n\n构建者输出：\n{{build_raw}}\n\n审查者裁定：\n{{review_raw}}\n\n审查已通过。执行最终诊断。输出必须是严格的 JSON 格式（不要包含 Markdown 或额外说明）：\n\n{\n  \"text\": \"调试/诊断摘要\",\n  \"status\": \"clear | needs_fix | blocked\",\n  \"rootCauses\": [\"根因描述\"],\n  \"requiredRework\": [{\"nodeId\": \"build\", \"reason\": \"为什么必须返工\"}],\n  \"diagnosticEvidence\": [{\"commandOrMethod\": \"pnpm test --filter ...\", \"summary\": \"观察到的现象\"}],\n  \"remainingRisks\": [\"仍残留的风险\"]\n}\n\n规则：clear 才允许正常移交；needs_fix 必须明确返工 build 或 review；blocked 表示只能降级交付。",
        riskLevel: "high",
        config: {},
      },
      {
        id: "handoff",
        template: "handoff",
        label: "完成移交",
        title: "完成移交",
        ownerAgentId: ORA_ROOT_AGENT_ID,
        enabled: true,
        instructions: "打包最终开发状态：变更文件、验证证据、long-task-protocol TODO 扫描和 DONE 关卡、未解决的风险以及用户下一步有用的操作。",
        prompt: "用户请求：\n{{prompt}}\n\n计划：\n{{triage_raw}}\n\n构建者：\n{{build_raw}}\n\n审查者裁定：\n{{review_raw}}\n\n调试者：\n{{debug_raw}}\n\n已验收产物：{{acceptedArtifactIds}}\n\n{{degradedDelivery}}\n\n重要约束：仅引用已验收产物的内容撰写移交报告。不要引入已验收产物中不存在的变更、文件或验证结果。输出必须是严格的 JSON 格式（不要包含 Markdown 或额外说明）：\n\n{\n  \"text\": \"最终移交摘要\",\n  \"deliveredFiles\": [\"最终交付的文件路径\"],\n  \"acceptedFiles\": [\"已验收文件路径\"],\n  \"taskJournalPath\": \"tasks/TASK-xxxx.md\",\n  \"todoScanResult\": {\"status\": \"clean | followup_only | blocked\", \"summary\": \"TODO 扫描摘要\"},\n  \"doneGate\": {\"status\": \"pass | blocked\", \"blockers\": [\"阻塞原因\"]},\n  \"verificationSummary\": [{\"verificationId\": \"verify-1\", \"result\": \"pass\", \"summary\": \"验证摘要\"}],\n  \"residualRisks\": [\"残余风险\"]\n}\n\n要求：只有在 review 已通过、debug 已 clear、TODO 扫描未阻塞且 long-task-protocol DONE 关卡通过时才输出正常移交；若收到 degradedDelivery 提示，必须明确标注降级原因。",
        config: {},
      },
    ],
    edges: [
      { id: "triage-build", source: "triage", target: "build", kind: "control", label: "implement", enabled: true },
      { id: "build-review", source: "build", target: "review", kind: "verification", label: "review", enabled: true },
      { id: "review-debug", source: "review", target: "debug", kind: "verification", label: "diagnose", enabled: true },
      { id: "debug-handoff", source: "debug", target: "handoff", kind: "control", label: "handoff", enabled: true },
    ],
    stages: [
      {
        id: "plan",
        label: "Plan",
        nodeId: "triage",
        speakerId: ORA_ROOT_AGENT_ID,
        speakerLabel: ORA_ROOT_AGENT_LABEL,
        stance: ORA_ROOT_AGENT_ID,
        outputKey: "triage",
      },
      {
        id: "implement",
        label: "Implement",
        nodeId: "build",
        speakerId: "builder",
        speakerLabel: "Builder",
        stance: "builder",
        outputKey: "build",
      },
      {
        id: "review",
        label: "Review",
        nodeId: "review",
        speakerId: "reviewer",
        speakerLabel: "Reviewer",
        stance: "reviewer",
        outputKey: "review",
      },
      {
        id: "debug",
        label: "Debug",
        nodeId: "debug",
        speakerId: "debugger",
        speakerLabel: "Debugger",
        stance: "debugger",
        outputKey: "debug",
      },
      {
        id: "finalize",
        label: "Finalize",
        nodeId: "handoff",
        speakerId: ORA_ROOT_AGENT_ID,
        speakerLabel: ORA_ROOT_AGENT_LABEL,
        stance: ORA_ROOT_AGENT_ID,
        outputKey: "handoff",
      },
    ],
    transcriptLayout: {
      style: "role_lanes",
      groupId: "code-development",
      groupLabel: "Code Development",
      groupBy: "speakerId",
      laneBySpeaker: {
        ora: "ora",
        builder: "builder",
        reviewer: "reviewer",
        debugger: "debugger",
      },
      lanes: [
        { id: ORA_ROOT_AGENT_ID, label: ORA_ROOT_AGENT_LABEL },
        { id: "builder", label: "Builder" },
        { id: "reviewer", label: "Reviewer" },
        { id: "debugger", label: "Debugger" },
      ],
      stanceLabels: {
        ora: ORA_ROOT_AGENT_LABEL,
        builder: "Builder",
        reviewer: "Reviewer",
        debugger: "Debugger",
      },
      stanceTones: {
        ora: "violet",
        builder: "blue",
        reviewer: "amber",
        debugger: "red",
      },
      showStatus: true,
      showSpeaker: true,
      showArtifacts: true,
    },
    stopPolicy: {
      type: "queue_drained",
      detail: "Stop after the orchestrator has collected implementation, review, debug, and verification handoff evidence.",
    },
    capabilityFlags: {
      supportsPersistentWorkers: true,
      supportsSharedState: false,
      supportsEventRouting: false,
      approvalMode: "high_risk_only",
      skillIds: ["long-task-protocol"],
      toolIds: [...DEFAULT_AGENT_MODE_TOOL_IDS],
    },
    runtimeAtoms: defaultRuntimeAtomsForFamily("orchestrator_subagent"),
    editorConstraints: {
      allowedNodeTemplates: ["triage", "build", "check", "handoff"],
      requiredNodeTemplates: ["triage", "handoff"],
      readOnly: true,
      allowReorder: true,
      allowCreate: true,
      allowDelete: false,
      allowDisable: false,
    },
    defaultBudget: {
      ...DEFAULT_RESOURCE_BUDGETS.agent_teams,
      maxRuntimeMs: 900000,
    },
    completionPolicy: completionPolicyForPreset("persistent"),
    runtimePolicy: runtimePolicyForPreset("team"),
    profiles: [
      profile(
        ORA_ROOT_AGENT_ID,
        ORA_ROOT_AGENT_LABEL,
        "Clarify scope, coordinate implementation gates, and package final delivery evidence.",
        "orchestrator_subagent",
        ["session", "project"],
        orchestratorSoul,
      ),
      profile(
        "builder",
        "Builder",
        "Make minimal source changes and produce focused verification evidence.",
        "orchestrator_subagent",
        ["session", "project", "worker"],
        builderSoul,
      ),
      profile(
        "reviewer",
        "Reviewer",
        "Review code changes for regressions, missing tests, and acceptance gaps.",
        "orchestrator_subagent",
        ["session", "project", "worker", "artifact"],
        reviewerSoul,
      ),
      profile(
        "debugger",
        "Debugger",
        "Diagnose failing checks and runtime errors before the final handoff.",
        "orchestrator_subagent",
        ["session", "project", "worker", "artifact"],
        debuggerSoul,
      ),
    ],
    createdAt: now,
    updatedAt: now,
  }));
}

function createDeepResearchModeSpec(): ModeSpec {
  const now = 0;
  const researcherSoul = [
    "You are Researcher, Ora's deep-investigation specialist.",
    "Responsibility: search widely across sources, verify claims against multiple references, surface conflicting evidence, and produce structured findings with explicit sourcing.",
    "Boundary: do not fabricate sources, cite claims without evidence, or present one-sided summaries when the literature is divided. Mark uncertainty clearly.",
    "Output: structured research briefing with key findings, source citations, conflicting evidence, confidence levels, and open questions for further investigation.",
  ].join("\n");
  const factCheckerSoul = [
    "You are Fact Checker, Ora's deep-research verification gate.",
    "Responsibility: inspect the research dossier for missing sources, unsupported claims, stale evidence, and unresolved contradictions before any final report is written.",
    "Boundary: do not write the final report, do not ignore missing evidence, and do not convert uncertainty into confident prose.",
    "Output: start with `Verdict: PASS | NEEDS_FIX | BLOCKED`, then list blocking issues, source gaps, unsupported claims, and the minimum rework needed before synthesis.",
  ].join("\n");
  const gapAnalystSoul = [
    "You are Gap Analyst, Ora's research-coverage auditor.",
    "Responsibility: review the collected evidence and analysis to identify uncovered dimensions, weak claims, conflicting findings, and methodological blind spots.",
    "Boundary: do not collect new sources yourself, do not rewrite the analysis, and do not produce the final report.",
    "Output: structured gap report listing each gap by dimension, severity, and the evidence that would close it.",
  ].join("\n");
  const knowledgeCompilerSoul = [
    "You are Knowledge Compiler, Ora's evidence organizer.",
    "Responsibility: organize raw findings and analysis into a structured evidence matrix — each claim paired with its sources, confidence, and any contradictions.",
    "Boundary: do not introduce new claims, do not fabricate or infer sources, and do not produce the final report.",
    "Output: evidence matrix with rows for each key finding, columns for claim / sources / confidence / contradictions, and a coverage summary.",
  ].join("\n");

  return autoLayoutModeSpec(ModeSpecSchema.parse({
    id: DEEP_RESEARCH_MODE_ID,
    family: "orchestrator_subagent",
    label: "深度研究",
    summary: "多阶段研究模式，规划调查、收集资料、分析证据，最终综合成一份完整的研究报告。",
    description: "使用此模式进行研究密集型任务，Ora 将规划调查、跨多个来源搜索、交叉分析发现，并产出来源可靠、附有明确置信度的报告。",
    recommendedUse: "适用于文献综述、市场研究、技术调查、竞品分析以及任何需要系统性证据收集与综合的任务。",
    failureMode: "如果研究边界不清晰或资料来源稀缺，研究者可能产出单薄的结果，或对薄弱证据过于自信。",
    systemPreset: true,
    nodes: [
      {
        id: "scope",
        template: "decompose",
        label: "规划研究",
        title: "规划研究",
        ownerAgentId: ORA_ROOT_AGENT_ID,
        enabled: true,
        instructions: "定义研究范围、关键问题、优先搜集的资料来源类型，并在开始收集前制定结构化的调查计划。",
        prompt: "用户请求：\n{{prompt}}\n\n创建研究计划。输出必须是严格的 JSON 格式（不要包含 Markdown 或其他文字）：\n\n{\n  \"text\": \"计划摘要\",\n  \"goal\": \"研究目标的一句话定义\",\n  \"successCriteria\": [\"验收标准1\", \"验收标准2\", ...],\n  \"steps\": [{\"id\": \"1\", \"description\": \"步骤描述\"}],\n  \"scopeBoundaries\": [\"明确排除的范围1\", \"不在研究范围内的内容2\"]\n}\n\nsuccessCriteria 必须具体可验证。scopeBoundaries 明确列出 NOT in scope 的内容。此阶段不要开始研究。",
        config: { toolIds: [] },
      },
      {
        id: "gather",
        template: "research",
        label: "收集资料",
        title: "收集资料",
        ownerAgentId: "researcher",
        enabled: true,
        instructions: "跨多个来源搜索，收集相关证据，记录引用，标记冲突性观点（暂不解决）。",
        prompt: "用户请求：\n{{prompt}}\n\n研究计划：\n{{scope}}\n\n从多个来源收集证据。输出必须是严格的 JSON 格式（不要包含 Markdown 或其他文字）：\n\n{\n  \"text\": \"简要总结收集到的资料\",\n  \"findings\": [\n    {\n      \"claim\": \"具体论断\",\n      \"source\": \"来源名称或URL（兼容字段，仍需填写）\",\n      \"sourceTitle\": \"来源标题\",\n      \"sourceUrl\": \"来源URL\",\n      \"excerpt\": \"支持该论断的短摘录\",\n      \"retrievedAt\": \"YYYY-MM-DD\",\n      \"sourceType\": \"report|news|filing|paper|website|other\",\n      \"confidence\": \"high|medium|low\"\n    }\n  ],\n  \"confidence\": \"high\" | \"medium\" | \"low\"\n}\n\n每个发现必须包含具体论断和可追溯来源。标注矛盾证据，但不要综合或得出最终结论。",
        riskLevel: "high",
        config: {},
      },
      {
        id: "analyze",
        template: "check",
        label: "分析证据",
        title: "分析证据",
        ownerAgentId: "researcher",
        enabled: true,
        instructions: "交叉引用发现，评估证据质量，协调或突出矛盾，为每项关键论断标注置信度。",
        prompt: "用户请求：\n{{prompt}}\n\n研究计划：\n{{scope}}\n\n收集的资料：\n{{gather}}\n\n分析收集到的证据。输出必须是严格的 JSON 格式（不要包含 Markdown 或其他文字）：\n\n{\n  \"text\": \"分析总结\",\n  \"analysis\": [\n    {\n      \"claim\": \"关键结论\",\n      \"confidence\": \"high|medium|low\",\n      \"rationale\": \"结论为何成立\",\n      \"supportingEvidence\": [\"支撑该结论的来源或证据ID\"],\n      \"conflictingEvidence\": [\"冲突来源或冲突点\"]\n    }\n  ],\n  \"issues\": [\"仍需进一步核实的问题\"]\n}\n\n必须明确哪些结论证据充分，哪些仍然脆弱。不要补充新资料。",
        riskLevel: "high",
        config: {},
      },
      {
        id: "gap_analysis",
        template: "check",
        label: "缺口分析",
        title: "缺口分析",
        ownerAgentId: "gap_analyst",
        enabled: true,
        instructions: "审查收集到的证据和分析，识别缺失的维度、薄弱论断、矛盾发现和方法盲区。标记严重程度和闭合缺口所需的证据。",
        prompt: "用户请求：\n{{prompt}}\n\n研究计划：\n{{scope}}\n\n收集的资料：\n{{gather}}\n\n分析：\n{{analyze}}\n\n审查研究的覆盖完整性。输出必须是严格的 JSON 格式：\n\n{\n  \"text\": \"缺口分析总结\",\n  \"gaps\": [\n    {\"dimension\": \"缺失维度\", \"severity\": \"critical|major|minor\", \"description\": \"缺口描述\", \"suggestedAction\": \"闭合建议\"}\n  ],\n  \"coverageScore\": 0.7,\n  \"suggestedReworkNodeIds\": [\"gather\", \"analyze\", \"compile\"]\n}\n\n只分析缺口，不要补充收集或重写分析。",
        riskLevel: "high",
        config: { toolIds: [] },
      },
      {
        id: "compile",
        template: "build",
        label: "证据整理",
        title: "证据整理",
        ownerAgentId: "knowledge_compiler",
        enabled: true,
        instructions: "将原始发现和分析整理为结构化的证据矩阵，每项发现标注论断、来源、置信度和矛盾。",
        prompt: "用户请求：\n{{prompt}}\n\n收集的资料：\n{{gather}}\n\n分析：\n{{analyze}}\n\n缺口报告：\n{{gap_analysis}}\n\n将证据整理为结构化矩阵。输出必须是严格的 JSON 格式：\n\n{\n  \"text\": \"证据矩阵总结\",\n  \"findings\": [\n    {\"claim\": \"关键论断\", \"sources\": [\"来源1 或来源URL\"], \"confidence\": \"high|medium|low\", \"contradictions\": [\"冲突点\"]}\n  ]\n}\n\n不要引入新论断或伪造来源。",
        riskLevel: "high",
        config: { toolIds: [] },
      },
      {
        id: "verify",
        template: "review",
        label: "核查研究",
        title: "核查研究",
        ownerAgentId: "fact_checker",
        enabled: true,
        instructions: "核查研究资料和分析结果是否已经达到可综合成最终报告的标准。此阶段是纯审查，不得自行补搜或引入新资料。必须点名缺失来源、未经支持的论断、过期信息和仍未解决的冲突。",
        prompt: "用户请求：\n{{prompt}}\n\n研究计划：\n{{scope}}\n\n资料：\n{{gather}}\n\n分析：\n{{analyze}}\n\n缺口报告：\n{{gap_analysis}}\n\n证据矩阵：\n{{compile}}\n\n逐条对照研究计划中的 successCriteria 和 scopeBoundaries 执行研究验收。输出必须是严格的 JSON 格式（不要包含 Markdown 或其他文字）：\n\n{\n  \"text\": \"核查总结\",\n  \"verdict\": \"pass|needs_fix|blocked\",\n  \"reworkNodeIds\": [\"gather\", \"analyze\", \"gap_analysis\", \"compile\"],\n  \"acceptedArtifactIds\": [\"gather\", \"analyze\", \"gap_analysis\", \"compile\"],\n  \"findings\": [\n    {\"artifactId\": \"gather\", \"severity\": \"blocking|concern|suggestion\", \"issue\": \"具体问题\"}\n  ],\n  \"issues\": [\"在综合前必须解决的问题\"]\n}\n\n仅当资料已满足最终综合条件时才给出 verdict=pass。若 verdict=needs_fix，reworkNodeIds 必须只列真正需要返工的节点。未列在 acceptedArtifactIds 中的研究产物视为尚未验收。",
        riskLevel: "high",
        config: { gateOnReviewVerdict: true, reworkNodeIds: ["gather", "analyze", "gap_analysis", "compile"], toolIds: [] },
      },
      {
        id: "synthesize",
        template: "synthesize",
        label: "综合报告",
        title: "综合报告",
        ownerAgentId: ORA_ROOT_AGENT_ID,
        enabled: true,
        instructions: "撰写最终研究报告，包含执行摘要、带置信度的关键发现、未解决的问题和来源参考书目。",
        prompt: "用户请求：\n{{prompt}}\n\n研究计划：\n{{scope}}\n\n证据：\n{{gather}}\n\n分析：\n{{analyze}}\n\n缺口报告：\n{{gap_analysis}}\n\n证据矩阵：\n{{compile}}\n\n核查结论：\n{{verify}}\n\n已验收产物：{{acceptedArtifactIds}}\n\n{{degradedDelivery}}\n\n重要约束：仅使用上述已验收产物的内容撰写报告。不要引入已验收产物中不存在的来源、数据或推断。不要临时补搜或补充新信息。\n\n综合最终研究报告。包含执行摘要、带置信度的关键发现、缺口说明、未解决的问题和来源参考书目。",
        config: { toolIds: [] },
      },
    ],
    edges: [
      { id: "scope-gather", source: "scope", target: "gather", kind: "control", label: "gather", enabled: true },
      { id: "gather-analyze", source: "gather", target: "analyze", kind: "verification", label: "analyze", enabled: true },
      { id: "analyze-gap", source: "analyze", target: "gap_analysis", kind: "verification", label: "gap", enabled: true },
      { id: "gap-compile", source: "gap_analysis", target: "compile", kind: "control", label: "compile", enabled: true },
      { id: "compile-verify", source: "compile", target: "verify", kind: "verification", label: "verify", enabled: true },
      { id: "verify-synthesize", source: "verify", target: "synthesize", kind: "control", label: "synthesize", enabled: true },
    ],
    stages: [
      {
        id: "plan",
        label: "规划",
        nodeId: "scope",
        speakerId: ORA_ROOT_AGENT_ID,
        speakerLabel: ORA_ROOT_AGENT_LABEL,
        stance: ORA_ROOT_AGENT_ID,
        outputKey: "scope",
      },
      {
        id: "gather",
        label: "收集",
        nodeId: "gather",
        speakerId: "researcher",
        speakerLabel: "研究员",
        stance: "researcher",
        outputKey: "gather",
      },
      {
        id: "analyze",
        label: "分析",
        nodeId: "analyze",
        speakerId: "researcher",
        speakerLabel: "研究员",
        stance: "researcher",
        outputKey: "analyze",
      },
      {
        id: "gap_analysis",
        label: "缺口",
        nodeId: "gap_analysis",
        speakerId: "gap_analyst",
        speakerLabel: "缺口分析员",
        stance: "gap_analyst",
        outputKey: "gap_analysis",
      },
      {
        id: "compile",
        label: "整理",
        nodeId: "compile",
        speakerId: "knowledge_compiler",
        speakerLabel: "证据整理员",
        stance: "knowledge_compiler",
        outputKey: "compile",
      },
      {
        id: "verify",
        label: "核查",
        nodeId: "verify",
        speakerId: "fact_checker",
        speakerLabel: "核查员",
        stance: "fact_checker",
        outputKey: "verify",
      },
      {
        id: "report",
        label: "报告",
        nodeId: "synthesize",
        speakerId: ORA_ROOT_AGENT_ID,
        speakerLabel: ORA_ROOT_AGENT_LABEL,
        stance: ORA_ROOT_AGENT_ID,
        outputKey: "synthesize",
      },
    ],
    transcriptLayout: {
      style: "role_lanes",
      groupId: "deep-research",
      groupLabel: "深度研究",
      groupBy: "speakerId",
      laneBySpeaker: {
        ora: "ora",
        researcher: "researcher",
        gap_analyst: "gap_analyst",
        knowledge_compiler: "knowledge_compiler",
        fact_checker: "fact_checker",
      },
      lanes: [
        { id: ORA_ROOT_AGENT_ID, label: ORA_ROOT_AGENT_LABEL },
        { id: "researcher", label: "研究员" },
        { id: "gap_analyst", label: "缺口分析员" },
        { id: "knowledge_compiler", label: "证据整理员" },
        { id: "fact_checker", label: "核查员" },
      ],
      stanceLabels: {
        ora: ORA_ROOT_AGENT_LABEL,
        researcher: "研究员",
        gap_analyst: "缺口分析员",
        knowledge_compiler: "证据整理员",
        fact_checker: "核查员",
      },
      stanceTones: {
        ora: "violet",
        researcher: "blue",
        gap_analyst: "gray",
        knowledge_compiler: "green",
        fact_checker: "amber",
      },
      showStatus: true,
      showSpeaker: true,
      showArtifacts: true,
    },
    stopPolicy: {
      type: "queue_drained",
      detail: "最终研究报告完成综合后停止，包含发现、置信度和参考书目。",
    },
    capabilityFlags: {
      supportsPersistentWorkers: false,
      supportsSharedState: false,
      supportsEventRouting: false,
      approvalMode: "high_risk_only",
      skillIds: [],
      toolIds: [...DEFAULT_AGENT_MODE_TOOL_IDS],
    },
    runtimeAtoms: defaultRuntimeAtomsForFamily("orchestrator_subagent"),
    editorConstraints: {
      allowedNodeTemplates: MODE_FAMILY_RULES.orchestrator_subagent.allowedTemplates,
      requiredNodeTemplates: ["synthesize"],
      readOnly: true,
      allowReorder: true,
      allowCreate: false,
      allowDelete: false,
      allowDisable: false,
    },
    defaultBudget: DEFAULT_RESOURCE_BUDGETS.orchestrator_subagent,
    completionPolicy: completionPolicyForPreset("persistent"),
    runtimePolicy: runtimePolicyForPreset("delegated"),
    profiles: [
      profile(
        ORA_ROOT_AGENT_ID,
        ORA_ROOT_AGENT_LABEL,
        "规划调查、解读发现，综合最终研究报告并标注明确的置信度。",
        "orchestrator_subagent",
        ["session", "project"],
      ),
      profile(
        "researcher",
        "研究员",
        "从多元来源收集信息，交叉引用论断，披露矛盾证据并明确标注来源。",
        "orchestrator_subagent",
        ["session", "project", "worker"],
        researcherSoul,
      ),
      profile(
        "fact_checker",
        "核查员",
        "对研究资料做来源核查、缺口识别和事实验收，在通过前阻止最终报告生成。",
        "orchestrator_subagent",
        ["session", "project", "worker", "artifact"],
        factCheckerSoul,
      ),
      profile(
        "gap_analyst",
        "缺口分析员",
        "审查证据覆盖完整性，识别缺失维度、薄弱论断和方法盲区。",
        "orchestrator_subagent",
        ["session", "project", "worker", "artifact"],
        gapAnalystSoul,
      ),
      profile(
        "knowledge_compiler",
        "证据整理员",
        "将分散发现整理为结构化的证据矩阵，每项论断对应来源和置信度。",
        "orchestrator_subagent",
        ["session", "project", "worker", "artifact"],
        knowledgeCompilerSoul,
      ),
    ],
    createdAt: now,
    updatedAt: now,
  }));
}

function createReviewCritiqueModeSpec(): ModeSpec {
  const now = 0;
  const reviewerSoul = [
    "You are Reviewer, Ora's quality-assessment specialist.",
    "Responsibility: inspect a target artifact or plan against stated criteria, surface blocking issues and non-blocking concerns, and produce a structured verdict with actionable recommendations.",
    "Boundary: do not rubber-stamp work, invent criteria not stated in the brief, or rewrite the artifact. Your role is assessment, not implementation.",
    "Output: lead with a clear pass/fail/needs-rework verdict, then list blocking issues, non-blocking concerns, evidence for each finding, and prioritized recommendations.",
  ].join("\n");

  return autoLayoutModeSpec(ModeSpecSchema.parse({
    id: REVIEW_CRITIQUE_MODE_ID,
    family: "orchestrator_subagent",
    label: "评审",
    summary: "结构化评审模式，界定评估标准、检查目标产物、深入分析发现，最终给出裁定和改进建议。",
    description: "使用此模式让 Ora 系统性地评估文档、计划、代码变更或提案，对照既定标准产出可执行的评审报告，给出明确的通过/不通过/需返工裁定。",
    recommendedUse: "适用于代码审查、设计评审、提案评估、合规检查以及需要依据明确标准进行结构化评审的任何任务。",
    failureMode: "如果评估标准模糊或产物不完整，评审可能流于表面，无法识别更深层的结构性问题。",
    systemPreset: true,
    nodes: [
      {
        id: "scope",
        template: "decompose",
        label: "定义标准",
        title: "定义标准",
        ownerAgentId: ORA_ROOT_AGENT_ID,
        enabled: true,
        instructions: "定义评估标准、评审范围和通过/不通过/需返工的裁定条件，然后再检查目标产物。",
        prompt: "用户请求：\n{{prompt}}\n\n定义评审标准和范围。目标产物应满足哪些标准？什么构成通过、不通过或需返工？此阶段不要评审目标。",
        config: {},
      },
      {
        id: "review",
        template: "check",
        label: "检查目标",
        title: "检查目标",
        ownerAgentId: "reviewer",
        enabled: true,
        instructions: "对照每项标准检查目标产物。记录合规和违规的证据。标记需要深入分析的问题。",
        prompt: "用户请求：\n{{prompt}}\n\n评审标准：\n{{scope}}\n\n对照每项标准检查目标。为发现记录具体证据。区分事实与解读。标记需要深入评审的问题。",
        riskLevel: "high",
        config: {},
      },
      {
        id: "critique",
        template: "check",
        label: "深入评审",
        title: "深入评审",
        ownerAgentId: "reviewer",
        enabled: true,
        instructions: "深化对标记问题的分析，评估严重程度，识别根本原因，起草优先级排序的改进建议。",
        prompt: "用户请求：\n{{prompt}}\n\n评审标准：\n{{scope}}\n\n检查发现：\n{{review}}\n\n深化分析。对每个标记的发现，评估严重程度，识别根本原因，起草优先级排序的建议。区分阻塞性问题和非阻塞性问题。",
        riskLevel: "high",
        config: {},
      },
      {
        id: "handoff",
        template: "synthesize",
        label: "给出裁定",
        title: "给出裁定",
        ownerAgentId: ORA_ROOT_AGENT_ID,
        enabled: true,
        instructions: "交付最终评审，包含明确的裁定、阻塞性问题、非阻塞性问题、证据总结和优先级排序的改进建议。",
        prompt: "用户请求：\n{{prompt}}\n\n评审标准：\n{{scope}}\n\n检查：\n{{review}}\n\n评审分析：\n{{critique}}\n\n交付最终评审。先给出裁定（通过/不通过/需返工），然后列出阻塞性问题、非阻塞性问题、证据总结和优先级排序的改进建议。",
        config: {},
      },
    ],
    edges: [
      { id: "scope-review", source: "scope", target: "review", kind: "control", label: "review", enabled: true },
      { id: "review-critique", source: "review", target: "critique", kind: "verification", label: "critique", enabled: true },
      { id: "critique-handoff", source: "critique", target: "handoff", kind: "control", label: "handoff", enabled: true },
    ],
    stages: [
      {
        id: "define",
        label: "定义",
        nodeId: "scope",
        speakerId: ORA_ROOT_AGENT_ID,
        speakerLabel: ORA_ROOT_AGENT_LABEL,
        stance: ORA_ROOT_AGENT_ID,
        outputKey: "scope",
      },
      {
        id: "inspect",
        label: "检查",
        nodeId: "review",
        speakerId: "reviewer",
        speakerLabel: "审查员",
        stance: "reviewer",
        outputKey: "review",
      },
      {
        id: "critique",
        label: "评审",
        nodeId: "critique",
        speakerId: "reviewer",
        speakerLabel: "审查员",
        stance: "reviewer",
        outputKey: "critique",
      },
      {
        id: "verdict",
        label: "裁定",
        nodeId: "handoff",
        speakerId: ORA_ROOT_AGENT_ID,
        speakerLabel: ORA_ROOT_AGENT_LABEL,
        stance: ORA_ROOT_AGENT_ID,
        outputKey: "handoff",
      },
    ],
    transcriptLayout: {
      style: "role_lanes",
      groupId: "review-critique",
      groupLabel: "评审",
      groupBy: "speakerId",
      laneBySpeaker: {
        ora: "ora",
        reviewer: "reviewer",
      },
      lanes: [
        { id: ORA_ROOT_AGENT_ID, label: ORA_ROOT_AGENT_LABEL },
        { id: "reviewer", label: "审查员" },
      ],
      stanceLabels: {
        ora: ORA_ROOT_AGENT_LABEL,
        reviewer: "审查员",
      },
      stanceTones: {
        ora: "violet",
        reviewer: "amber",
      },
      showStatus: true,
      showSpeaker: true,
      showArtifacts: true,
    },
    stopPolicy: {
      type: "queue_drained",
      detail: "最终评审裁定交付后停止，包含阻塞性问题、非阻塞性问题和优先级排序的建议。",
    },
    capabilityFlags: {
      supportsPersistentWorkers: false,
      supportsSharedState: false,
      supportsEventRouting: false,
      approvalMode: "high_risk_only",
      skillIds: [],
      toolIds: [...DEFAULT_AGENT_MODE_TOOL_IDS],
    },
    runtimeAtoms: defaultRuntimeAtomsForFamily("orchestrator_subagent"),
    editorConstraints: {
      allowedNodeTemplates: MODE_FAMILY_RULES.orchestrator_subagent.allowedTemplates,
      requiredNodeTemplates: ["synthesize"],
      readOnly: true,
      allowReorder: true,
      allowCreate: false,
      allowDelete: false,
      allowDisable: false,
    },
    defaultBudget: DEFAULT_RESOURCE_BUDGETS.orchestrator_subagent,
    completionPolicy: completionPolicyForPreset("persistent"),
    runtimePolicy: runtimePolicyForPreset("balanced"),
    profiles: [
      profile(
        ORA_ROOT_AGENT_ID,
        ORA_ROOT_AGENT_LABEL,
        "定义评估标准，解读评审发现，交付最终裁定和可执行的改进建议。",
        "orchestrator_subagent",
        ["session", "project"],
      ),
      profile(
        "reviewer",
        "审查员",
        "对照既定标准检查目标产物，披露阻塞性和非阻塞性问题，提供有据可依的评审意见。",
        "orchestrator_subagent",
        ["session", "project", "worker"],
        reviewerSoul,
      ),
    ],
    createdAt: now,
    updatedAt: now,
  }));
}

export const MVP_MODES = [
  createSingleAgentModeSpec(),
  createCodeDevelopmentModeSpec(),
  createDeepResearchModeSpec(),
  createReviewCritiqueModeSpec(),
  createDebateModeSpec(),
  createModeStudioBuilderModeSpec(),
];

export const SYSTEM_MODE_PRESETS = [
  ...MVP_MODES,
];

export function getModePreset(modeId: string): ModeSpec | undefined {
  return SYSTEM_MODE_PRESETS.find((mode) => mode.id === modeId);
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
    if (!atom) {
      warnings.push(`Runtime atom '${atomId}' is a custom atom — compatibility checks are skipped.`);
      continue;
    }
    if (!atom.compatibleFamilies.includes(spec.family)) {
      errors.push(`Runtime atom '${atomId}' is not compatible with family '${spec.family}'.`);
    }
    if (atom.scope !== "mode") {
      errors.push(`Runtime atom '${atomId}' cannot be attached at mode scope.`);
    }
    for (const requiredFlag of atom.requiresFlags) {
      if (!(requiredFlag in ModeCapabilityFlagsSchema.shape)) {
        warnings.push(`Runtime atom '${atomId}' requires unknown capability flag '${requiredFlag}'.`);
      } else if (!spec.capabilityFlags[requiredFlag as keyof ModeCapabilityFlags]) {
        errors.push(`Runtime atom '${atomId}' requires capability flag '${requiredFlag}'.`);
      }
    }
  }

  for (const node of spec.nodes) {
    if (nodeIds.has(node.id)) {
      errors.push(`Duplicate node id '${node.id}'.`);
    }
    nodeIds.add(node.id);
    const isBuiltInTemplate = BuiltInModeNodeTemplateSchema.safeParse(node.template).success;
    if (isBuiltInTemplate && !rule.allowedTemplates.includes(node.template)) {
      errors.push(`Node template '${node.template}' is not allowed for family '${spec.family}'.`);
    }
    if (!isBuiltInTemplate) {
      warnings.push(`Node '${node.id}' uses custom template '${node.template}' — family rule checks are skipped.`);
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
      if (!atom) {
        warnings.push(`Node '${node.id}' uses custom runtime atom '${atomId}' — compatibility checks are skipped.`);
        continue;
      }
      if (!atom.compatibleFamilies.includes(spec.family)) {
        errors.push(`Node '${node.id}' cannot use runtime atom '${atom.id}' in family '${spec.family}'.`);
      }
      if (atom.scope !== "node") {
        errors.push(`Node '${node.id}' cannot attach mode-scoped atom '${atom.id}'.`);
      }
      for (const requiredFlag of atom.requiresFlags) {
        if (!(requiredFlag in ModeCapabilityFlagsSchema.shape)) {
          warnings.push(`Node atom '${atom.id}' requires unknown capability flag '${requiredFlag}'.`);
        } else if (!spec.capabilityFlags[requiredFlag as keyof ModeCapabilityFlags]) {
          errors.push(`Node atom '${atom.id}' requires capability flag '${requiredFlag}'.`);
        }
      }
      if (activeRuntimeAtoms.has(atom.id)) {
        warnings.push(`Node '${node.id}' redundantly enables runtime atom '${atom.id}' that is already active for the mode.`);
      }
    }
  }

  const profileIds = new Set(spec.profiles.map((profile) => profile.id));
  const stageIds = new Set<string>();
  for (const stage of spec.stages ?? []) {
    if (stageIds.has(stage.id)) {
      errors.push(`Duplicate stage id '${stage.id}'.`);
    }
    stageIds.add(stage.id);
    if (!nodeIds.has(stage.nodeId)) {
      errors.push(`Stage '${stage.id}' references unknown node '${stage.nodeId}'.`);
    }
    if (stage.speakerId && !profileIds.has(stage.speakerId)) {
      errors.push(`Stage '${stage.id}' references unknown speaker profile '${stage.speakerId}'.`);
    }
  }
  if (spec.transcriptLayout) {
    const stagedStances = new Set((spec.stages ?? []).map((stage) => stage.stance).filter((stance): stance is string => typeof stance === "string"));
    for (const stance of Object.keys(spec.transcriptLayout.sideByStance ?? {})) {
      if (stagedStances.size > 0 && !stagedStances.has(stance)) {
        warnings.push(`Transcript layout side '${stance}' does not match any staged transcript stance.`);
      }
    }
    if (spec.transcriptLayout.style === "two_sided_duel" && (spec.stages?.length ?? 0) > 0) {
      const configuredSides = new Set(Object.values(spec.transcriptLayout.sideByStance ?? {}));
      if (!configuredSides.has("left") || !configuredSides.has("right")) {
        warnings.push("Transcript layout 'two_sided_duel' should configure both left and right sides.");
      }
    }
  }

  for (const node of spec.nodes) {
    if (node.ownerAgentId && !profileIds.has(node.ownerAgentId)) {
      errors.push(`Node '${node.id}' references unknown owner agent '${node.ownerAgentId}'.`);
    }
  }

  const nodeById = new Map(spec.nodes.map((node) => [node.id, node]));
  const requiredTemplates = new Set(
    spec.editorConstraints.requiredNodeTemplates.length > 0
      ? spec.editorConstraints.requiredNodeTemplates
      : rule.requiredTemplates,
  );
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
  for (const required of requiredTemplates) {
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
    if (edge.condition) {
      const conditionPattern = /^[a-zA-Z_.]+ (==|!=) '[^']*'$/;
      if (!conditionPattern.test(edge.condition)) {
        warnings.push(`Edge '${edge.id}' condition '${edge.condition}' may have invalid syntax. Expected format: "field == 'value'" or "field != 'value'".`);
      }
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

  // 孤立节点 / 死胡同检测
  if (enabledNodeIds.size > 1) {
    const hasIncoming = new Set<string>();
    for (const edge of spec.edges.filter((e) => e.enabled)) {
      if (enabledNodeIds.has(edge.target)) {
        hasIncoming.add(edge.target);
      }
    }
    for (const nodeId of enabledNodeIds) {
      const targets = adjacency.get(nodeId) ?? [];
      if (!hasIncoming.has(nodeId) && targets.length === 0) {
        warnings.push(`Node '${nodeId}' is isolated — it has no connecting edges.`);
      } else if (!hasIncoming.has(nodeId)) {
        warnings.push(`Node '${nodeId}' has no incoming edges and may be unreachable.`);
      } else if (targets.length === 0) {
        warnings.push(`Node '${nodeId}' has no outgoing edges and may be a dead end.`);
      }
    }
  }

  const orderedNodes = orderedEnabledModeNodes(spec);
  if (orderedNodes.length === 0) {
    errors.push("A mode requires at least one enabled node.");
  } else if (orderedNodes.length === 1) {
    warnings.push("Single-node modes are supported, but may not provide much orchestration value.");
  }

  // ── driver capability manifest checks ──────────────────────────
  const manifest = getDriverManifest(spec.family);
  if (manifest) {
    const hasConditions = spec.edges.some(
      (e) => e.enabled && typeof e.condition === "string" && e.condition.length > 0,
    );
    const manifestWarnings = driverManifestWarnings(manifest, {
      hasConditions,
      nodeCount: orderedNodes.length,
      activeAtomIds: spec.runtimeAtoms,
    });
    warnings.push(...manifestWarnings);

    if (spec.transcriptLayout && !manifest.supportsStaging) {
      warnings.push(
        `Transcript layout is configured, but the "${manifest.label}" driver does not support staged transcripts. The layout will be ignored at runtime.`,
      );
    }
  } else {
    warnings.push(`No driver capability manifest registered for family "${spec.family}". Execution semantics are unknown.`);
  }

  return ModeValidationResultSchema.parse({
    valid: errors.length === 0,
    errors,
    warnings,
    repairSuggestions: generateRepairSuggestions(spec),
  });
}
