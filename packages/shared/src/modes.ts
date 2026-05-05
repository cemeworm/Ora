import { z } from "zod";
import { ActionRiskLevelSchema, DEFAULT_MODE_RECOVERY_POLICY, ModeRecoveryPolicySchema } from "./actions.js";
import { DEFAULT_AGENT_MODE_TOOL_IDS } from "./capabilities.js";
import { AgentProfileSchema, CODE_DEVELOPMENT_MODE_ID, COMPLETION_POLICY_PRESETS, CoordinationPatternSchema, DEBATE_MODE_ID, DEERFLOW_HARNESS_MODE_ID, DEFAULT_MODE_RUNTIME_POLICY, MODE_STUDIO_BUILDER_MODE_ID, ModeCompletionPolicySchema, ModeIdSchema, ModeRuntimePolicySchema, ORA_ROOT_AGENT_ID, ORA_ROOT_AGENT_LABEL, ORA_SELF_BUILDER_MODE_ID, ResourceBudgetSchema, SINGLE_AGENT_MODE_ID, completionPolicyForPreset } from "./primitives.js";
import type { AgentProfile, CoordinationPattern, ModeCompletionPolicy, ModeRuntimePolicy, ResourceBudget } from "./primitives.js";
import { TopologyEdgeSchema, TopologyNodeSchema } from "./topology.js";
import type { TopologyEdge, TopologyNode } from "./topology.js";

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
  instructions: z.string().min(1).optional(),
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
  "long_term_memory",
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

export const ModeStageSpecSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  nodeId: z.string().min(1),
  speakerId: z.string().min(1).optional(),
  speakerLabel: z.string().min(1).optional(),
  stance: z.string().min(1).optional(),
  instruction: z.string().min(1).optional(),
  promptTemplate: z.string().min(1).optional(),
  outputKey: z.string().min(1).optional(),
});
export type ModeStageSpec = z.infer<typeof ModeStageSpecSchema>;

export const TranscriptLayoutStyleSchema = z.enum([
  "stage_list",
  "timeline",
  "two_sided_duel",
  "role_lanes",
  "kanban_pipeline",
  "rubric_matrix",
  "judge_panel",
  "evidence_board",
  "comparison_table",
  "artifact_gallery",
  "branch_compare",
  "state_board",
  "event_stream",
  "graph_topology",
  "report_builder",
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
  showStatus: z.boolean().optional(),
  showTimestamp: z.boolean().optional(),
  showSpeaker: z.boolean().optional(),
  orientation: z.enum(["vertical", "horizontal"]).optional(),
  showArtifacts: z.boolean().optional(),
  groupBy: z.enum(["speakerId", "stance", "nodeId"]).optional(),
  lanes: z.array(ModeTranscriptLayoutLaneSchema).optional(),
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
  shellExtraReadOnlyCommands: z.array(z.string().min(1)).default([]),
  shellExtraApprovedCommands: z.array(z.string().min(1)).default([]),
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
  nodes: z.array(ModeNodeSpecSchema).min(1),
  edges: z.array(ModeEdgeSpecSchema).default([]),
  stopPolicy: ModeStopPolicySchema,
  capabilityFlags: ModeCapabilityFlagsSchema,
  editorConstraints: ModeEditorConstraintsSchema,
  defaultBudget: ResourceBudgetSchema,
  profiles: z.array(AgentProfileSchema).min(1),
  runtimeAtoms: z.array(ModeRuntimeAtomIdSchema).default([]),
  stages: z.array(ModeStageSpecSchema).optional(),
  transcriptLayout: ModeTranscriptLayoutSchema.optional(),
  completionPolicy: ModeCompletionPolicySchema.default(COMPLETION_POLICY_PRESETS.balanced),
  runtimePolicy: ModeRuntimePolicySchema.default(DEFAULT_MODE_RUNTIME_POLICY),
  recoveryPolicy: ModeRecoveryPolicySchema.default(DEFAULT_MODE_RECOVERY_POLICY),
  memoryPolicy: ModeMemoryPolicySchema.default({}),
  toolLimits: ModeToolLimitsSchema.default({}),
  permissionProfileId: z.string().min(1).optional(),
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
    draft: {
      description: "Draft a candidate answer for verifier review.",
      display: { story: "{{owner}} drafts a candidate answer that the verifier can inspect and improve." },
      supportsPromptOverride: true,
      fallbackInstructions: "Produce a concrete candidate answer for this generator stage.",
      fallbackPrompt: "Prompt: {{prompt}}\nAttempt: {{attempt}}\nPrevious verifier notes:\n{{verifierNotes}}\nWrite a better candidate answer. Return only the candidate response.",
    },
    verify: {
      description: "Evaluate the candidate against the current rubric.",
      display: { story: "{{owner}} checks the candidate against the rubric and decides whether it is ready." },
      supportsPromptOverride: true,
      fallbackInstructions: "Return only one compact JSON object with keys verdict, rationale, and missingRequirements. Use verdict=\"pass\" only when the candidate fully satisfies the rubric. If the candidate fails or you cannot verify it, return {\"verdict\":\"fail\",\"rationale\":\"...\",\"missingRequirements\":[\"...\"]}. Do not include markdown, prose, greetings, or role explanations outside the JSON object.",
      fallbackPrompt: "Original prompt: {{prompt}}\nRubric:\n- {{rubric}}\nCandidate:\n{{candidate}}\nReturn JSON with keys verdict ('pass'|'fail'), rationale, and missingRequirements (array of strings).",
    },
    decide: {
      description: "Reserved stage for a future explicit accept/retry decision step.",
      display: { story: "{{owner}} makes the accept, retry, or stop decision for this verification loop." },
      supportsPromptOverride: false,
    },
  },
  orchestrator_subagent: {
    decompose: {
      description: "Break the task into inspectable orchestration steps.",
      display: { story: "{{owner}} breaks the request into clear responsibilities before other stages start." },
      supportsPromptOverride: true,
      fallbackInstructions: "Keep the orchestration plan short, explicit, and inspectable.",
      fallbackPrompt: "Task: {{prompt}}\nDecompose it into research, review, and synthesis responsibilities.",
    },
    research: {
      description: "Collect focused supporting context from the decomposition plan.",
      display: { story: "{{owner}} gathers focused context for the plan instead of answering from first impressions." },
      supportsPromptOverride: true,
      fallbackInstructions: "Gather focused supporting context and return concise findings.",
      fallbackPrompt: "Task: {{prompt}}\nGather focused supporting context for the orchestration plan:\n{{plan}}",
    },
    review: {
      description: "Review findings and surface risks or missing pieces.",
      display: { story: "{{owner}} reviews the work for gaps, contradictions, risks, and missing evidence." },
      supportsPromptOverride: true,
      fallbackInstructions: "Surface concrete risks, gaps, contradictions, and missing evidence.",
      fallbackPrompt: "Task: {{prompt}}\nPlan:\n{{plan}}\nResearch:\n{{research}}\nReview completeness, risks, and missing pieces.",
    },
    synthesize: {
      description: "Combine plan, research, and review into the final answer.",
      display: { story: "{{owner}} combines the completed work into a final response with the mode's context intact." },
      supportsPromptOverride: true,
      fallbackInstructions: "Synthesize completed stage outputs into one final answer.",
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
      fallbackInstructions: "Validate the assigned work and report approval or concrete issues.",
      fallbackPrompt: "Task: {{prompt}}\nBacklog:\n{{triage}}\nBuilder output:\n{{build}}\nValidate the work and report issues or approval.",
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
    "Boundary: you cannot execute file operations (file.write, file.patch, file.delete) or high-risk shell commands. Hand off to Builder for all code changes. You plan and synthesize; Builder implements.",
    "Output: provide the plan, owner mapping, handoff state, final synthesis, and any blocked assumptions that require user input.",
  ].join("\n"),
  researcher: [
    "You are Researcher, Ora's evidence and context specialist.",
    "Responsibility: gather focused context that downstream agents can verify, cite, and use for the current task.",
    "Boundary: do not answer from first impressions, over-collect broad background, or blur observed facts with inference.",
    "Output: separate facts, sources or paths, inferences, uncertainty, constraints, and open questions; prefer small high-signal findings.",
  ].join("\n"),
  reviewer: [
    "You are Reviewer, Ora's risk and completeness critic.",
    "Responsibility: inspect work for gaps, contradictions, regressions, missing tests, weak evidence, and unclear acceptance criteria.",
    "Boundary: do not summarize first when actionable defects exist, and do not approve work that lacks the evidence required by the mode.",
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
      profile("orchestrator", "Orchestrator", "Frame scope, coordinate stages, and synthesize results.", "orchestrator_subagent", [
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
      profile("team_lead", "Team Lead", "Prioritize backlog and coordinate persistent workers.", "agent_teams", [
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
        { id: "team_lead", label: "Team Lead", kind: "agent", agentId: "team_lead", status: "idle", metadata: {} },
        { id: "builder", label: "Builder", kind: "agent", agentId: "builder", status: "idle", metadata: {} },
        { id: "reviewer", label: "Reviewer", kind: "agent", agentId: "reviewer", status: "idle", metadata: {} }
      ],
      edges: [
        { id: "lead-builder", source: "team_lead", target: "builder", kind: "delegation", label: "assign", metadata: {} },
        { id: "builder-reviewer", source: "builder", target: "reviewer", kind: "verification", label: "validate", metadata: {} },
        { id: "reviewer-lead", source: "reviewer", target: "team_lead", kind: "control", label: "report", metadata: {} }
      ]
    },
    planTemplate: [
      { id: "triage", title: "Triage work into team backlog", ownerAgentId: "team_lead", dependencies: [] },
      { id: "build", title: "Complete assigned task", ownerAgentId: "builder", dependencies: ["triage"] },
      { id: "check", title: "Validate output", ownerAgentId: "reviewer", dependencies: ["build"] },
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
        { id: "router", label: "Router", kind: "agent", agentId: "router", status: "idle", metadata: {} },
        { id: "triage_topic", label: "triage", kind: "capability", status: "idle", metadata: { role: "topic" } },
        { id: "researcher", label: "Researcher", kind: "agent", agentId: "researcher", status: "idle", metadata: {} },
        { id: "responder", label: "Responder", kind: "agent", agentId: "responder", status: "idle", metadata: {} }
      ],
      edges: [
        { id: "run-router", source: "run", target: "router", kind: "control", label: "publish", metadata: {} },
        { id: "router-topic", source: "router", target: "triage_topic", kind: "artifact", label: "route", metadata: {} },
        { id: "topic-researcher", source: "triage_topic", target: "researcher", kind: "delegation", label: "deliver", metadata: {} },
        { id: "researcher-responder", source: "researcher", target: "responder", kind: "verification", label: "finding", metadata: {} }
      ]
    },
    planTemplate: [
      { id: "publish", title: "Publish the initial event", ownerAgentId: "router", dependencies: [] },
      { id: "route", title: "Route events to subscribers", ownerAgentId: "router", dependencies: ["publish"] },
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
      profile("orchestrator", "Orchestrator", "Seed the shared board with scope, initial hypotheses, and decision criteria.", "shared_state", [
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
        { id: "orchestrator", label: "Orchestrator", kind: "agent", agentId: "orchestrator", status: "idle", metadata: {} },
        { id: "shared_board", label: "Shared Board", kind: "capability", status: "idle", metadata: { role: "blackboard" } },
        { id: "researcher", label: "Researcher", kind: "agent", agentId: "researcher", status: "idle", metadata: {} },
        { id: "reviewer", label: "Reviewer", kind: "agent", agentId: "reviewer", status: "idle", metadata: {} }
      ],
      edges: [
        { id: "run-orchestrator", source: "run", target: "orchestrator", kind: "control", label: "seed", metadata: {} },
        { id: "orchestrator-board", source: "orchestrator", target: "shared_board", kind: "memory", label: "write", metadata: {} },
        { id: "researcher-board", source: "researcher", target: "shared_board", kind: "memory", label: "contribute", metadata: {} },
        { id: "reviewer-board", source: "reviewer", target: "shared_board", kind: "verification", label: "review", metadata: {} }
      ]
    },
    planTemplate: [
      { id: "seed", title: "Seed the shared board", ownerAgentId: "orchestrator", dependencies: [] },
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
  const definition = MODE_NODE_RUNTIME_TEMPLATE_LIBRARY[family][template];
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
        ownerAgentId: "orchestrator",
        enabled: true,
        instructions: defaultNodeInstructions("orchestrator_subagent", "decompose"),
        config: {},
      },
      {
        id: "research",
        template: "research",
        label: "Research subagent",
        title: "Research subagent",
        ownerAgentId: "researcher",
        enabled: true,
        instructions: defaultNodeInstructions("orchestrator_subagent", "research"),
        config: { atoms: ["subagent_delegate"] },
      },
      {
        id: "review",
        template: "review",
        label: "Review subagent",
        title: "Review subagent",
        ownerAgentId: "reviewer",
        enabled: true,
        instructions: defaultNodeInstructions("orchestrator_subagent", "review"),
        config: { atoms: ["subagent_delegate"] },
      },
      {
        id: "synthesize",
        template: "synthesize",
        label: "Lead synthesis",
        title: "Lead synthesis",
        ownerAgentId: "orchestrator",
        enabled: true,
        instructions: defaultNodeInstructions("orchestrator_subagent", "synthesize"),
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
      toolIds: [...DEFAULT_AGENT_MODE_TOOL_IDS],
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
    defaultBudget: SINGLE_AGENT_RESOURCE_BUDGET,
    completionPolicy: completionPolicyForPreset("persistent"),
    runtimePolicy: runtimePolicyForPreset("delegated"),
    profiles: [
      profile(
        "orchestrator",
        "Orchestrator",
        "Frame the task, coordinate delegated subagents, and synthesize the final answer.",
        "orchestrator_subagent",
        ["session", "project"],
      ),
      profile(
        "researcher",
        "Researcher",
        "Gather focused context for the lead agent's plan.",
        "orchestrator_subagent",
        ["session", "project"],
      ),
      profile(
        "reviewer",
        "Reviewer",
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
        id: "respond",
        template: "synthesize",
        label: "Respond",
        title: "Respond",
        ownerAgentId: ORA_ROOT_AGENT_ID,
        enabled: true,
        instructions: "Complete the user request directly and make the final answer the only assistant body.",
        config: {},
      },
    ],
    edges: [],
    stopPolicy: {
      type: "queue_drained",
      detail: "Stop after the solo agent produces the final response.",
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
    defaultBudget: SINGLE_AGENT_RESOURCE_BUDGET,
    completionPolicy: completionPolicyForPreset("balanced"),
    runtimePolicy: runtimePolicyForPreset("balanced"),
    profiles: [
      profile(
        ORA_ROOT_AGENT_ID,
        ORA_ROOT_AGENT_LABEL,
        "Own the user conversation end-to-end, including direct single-agent work, without delegating to additional workers.",
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
  }));

  return autoLayoutModeSpec(ModeSpecSchema.parse({
    id: DEBATE_MODE_ID,
    family: "orchestrator_subagent",
    label: "Debate",
    summary: "A moderator frames a proposition, one reusable Debate Agent argues both sides through virtual speaker seats, then the moderator synthesizes.",
    description: "Use a structured debate surface for watching staged adversarial argumentation in the assistant content area without creating separate real agents for each debate seat.",
    recommendedUse: "Use when a proposition benefits from explicit pro/con pressure, rebuttal, and a final moderated synthesis.",
    failureMode: "Debate can over-amplify adversarial framing when the user needs direct execution, research, or a neutral answer.",
    systemPreset: true,
    nodes: [
      {
        id: "frame",
        template: "decompose",
        label: "Moderator framing",
        title: "Moderator framing",
        ownerAgentId: "moderator",
        enabled: true,
        instructions: "Frame the user's proposition, restate debate rules, and identify the burden of proof before dispatching the debate turns.",
        prompt: "Proposition or user request:\n{{prompt}}\n\nFrame the structured debate. Keep it concise and make the speaking order explicit.",
        config: {},
      },
      {
        id: "debate",
        template: "research",
        label: "Debate speeches",
        title: "Debate speeches",
        ownerAgentId: "debate_agent",
        enabled: true,
        instructions: debateAgentSoul,
        config: {},
      },
      {
        id: "synthesis",
        template: "synthesize",
        label: "Moderator synthesis",
        title: "Moderator synthesis",
        ownerAgentId: "moderator",
        enabled: true,
        instructions: "Synthesize the completed debate. Identify the strongest arguments on each side, unresolved factual dependencies, and the most defensible conclusion without pretending the debate resolved what it did not. Evaluate argument quality rigorously: if one side presented stronger evidence, cleaner logic, or fewer burden-of-proof gaps, say so explicitly. Do not default to 'both sides are equally valid' unless the evidence genuinely supports that rare conclusion.",
        prompt: "Proposition or user request:\n{{prompt}}\n\nModerator framing:\n{{frame}}\n\nDebate transcript:\n{{debateTranscript}}\n\nWrite the final moderated synthesis. Make an explicit judgment about which side presented the stronger case based on evidence quality, logic, and burden-of-proof gaps. Do not default to saying both sides are equally valid unless the debate evidence genuinely supports that rare conclusion.",
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
        speakerId: "moderator",
        speakerLabel: "主持人总结",
        stance: "moderator",
        outputKey: "synthesis",
      },
    ],
    transcriptLayout: {
      style: "two_sided_duel",
      groupId: "debate",
      groupLabel: "结构化辩论",
      sideByStance: {
        affirmative: "left",
        negative: "right",
      },
      summaryStances: ["moderator", "neutral"],
      stanceLabels: {
        affirmative: "正方",
        negative: "反方",
        moderator: "主持",
        neutral: "中立",
      },
      stanceTones: {
        affirmative: "green",
        negative: "blue",
        moderator: "violet",
        neutral: "gray",
      },
      showStatus: true,
      showSpeaker: true,
    },
    stopPolicy: {
      type: "queue_drained",
      detail: "Stop after the moderator has synthesized the ordered debate transcript.",
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
        "moderator",
        "Moderator",
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
        ownerAgentId: "orchestrator",
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
        ownerAgentId: "orchestrator",
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
        "orchestrator",
        "Orchestrator",
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
    family: "agent_teams",
    label: "Code Development",
    summary: "A project-development team mode that plans, edits, reviews, debugs, and verifies code changes with explicit gates.",
    description: "Use this mode for real project coding tasks where Ora should keep scope tight, use long-task-protocol as the task source of truth, write code, review the diff, diagnose failures, and hand off verifiable evidence instead of only chatting about implementation.",
    recommendedUse: "Use for non-trivial code changes that need long-task-protocol task journals, planning, source edits, tests, review, and failure diagnosis before final delivery.",
    failureMode: "If acceptance criteria or verification commands are vague, the team can spend effort coordinating without proving the code works.",
    systemPreset: true,
    nodes: [
      {
        id: "triage",
        template: "triage",
        label: "Plan development task",
        title: "Plan development task",
        ownerAgentId: "orchestrator",
        enabled: true,
        instructions: "Clarify the requested code change, invoke long-task-protocol for non-trivial development work, create or update the task journal, define acceptance criteria, identify risky files, and choose focused verification gates before implementation.",
        prompt: "User request:\n{{prompt}}\n\nCreate a compact development plan. For non-trivial code work, use long-task-protocol and make the task journal the source of truth. Include scope, out-of-scope items, changed surfaces, required approvals, verification commands, SAVEPOINT needs, and blocked assumptions. Do not implement in this stage.",
        config: {},
      },
      {
        id: "build",
        template: "build",
        label: "Implement change",
        title: "Implement change",
        ownerAgentId: "builder",
        enabled: true,
        instructions: "Implement only the approved scope, match existing code style, avoid speculative abstractions, and add or update focused tests when the change affects behavior.",
        prompt: "User request:\n{{prompt}}\n\nDevelopment plan:\n{{triage}}\n\nMake the smallest viable code change. Report changed files, assumptions, and focused verification evidence.",
        riskLevel: "high",
        config: {},
      },
      {
        id: "review",
        template: "check",
        label: "Review diff",
        title: "Review diff",
        ownerAgentId: "reviewer",
        enabled: true,
        instructions: "Review the implementation against the request and acceptance criteria. Prioritize regressions, missing tests, schema drift, unsafe broad edits, and unclear verification evidence.",
        prompt: "User request:\n{{prompt}}\n\nDevelopment plan:\n{{triage}}\n\nBuilder output:\n{{build}}\n\nReview the change. Return blocking findings, non-blocking findings, verification gaps, and a pass/fail verdict.",
        riskLevel: "high",
        config: {},
      },
      {
        id: "debug",
        template: "check",
        label: "Diagnose failures",
        title: "Diagnose failures",
        ownerAgentId: "debugger",
        enabled: true,
        instructions: "Diagnose failing tests, type errors, runtime errors, or reviewer-blocked behavior from evidence before suggesting the smallest correction. If no failures exist, explicitly confirm no debug action is needed.",
        prompt: "User request:\n{{prompt}}\n\nDevelopment plan:\n{{triage}}\n\nBuilder output:\n{{build}}\n\nReviewer findings:\n{{review}}\n\nDiagnose any failure or blocked verification. Name the root cause, evidence, minimal fix path, and re-run command. If everything passed, say no debug action is needed.",
        riskLevel: "high",
        config: {},
      },
      {
        id: "handoff",
        template: "handoff",
        label: "Finalize handoff",
        title: "Finalize handoff",
        ownerAgentId: "orchestrator",
        enabled: true,
        instructions: "Package the final development state with changed files, verification evidence, long-task-protocol TODO scan and DONE gates, unresolved risks, and the next useful action for the user.",
        prompt: "User request:\n{{prompt}}\n\nPlan:\n{{triage}}\n\nBuilder:\n{{build}}\n\nReviewer:\n{{review}}\n\nDebugger:\n{{debug}}\n\nWrite the final handoff. Include changed files, task journal path, TODO scan result, verification evidence, residual risks, and whether the long-task-protocol DONE gates passed or the task is blocked.",
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
        speakerId: "orchestrator",
        speakerLabel: "Orchestrator",
        stance: "orchestrator",
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
        speakerId: "orchestrator",
        speakerLabel: "Orchestrator",
        stance: "orchestrator",
        outputKey: "handoff",
      },
    ],
    transcriptLayout: {
      style: "role_lanes",
      groupId: "code-development",
      groupLabel: "Code Development",
      groupBy: "speakerId",
      laneBySpeaker: {
        orchestrator: "orchestrator",
        builder: "builder",
        reviewer: "reviewer",
        debugger: "debugger",
      },
      lanes: [
        { id: "orchestrator", label: "Orchestrator" },
        { id: "builder", label: "Builder" },
        { id: "reviewer", label: "Reviewer" },
        { id: "debugger", label: "Debugger" },
      ],
      stanceLabels: {
        orchestrator: "Orchestrator",
        builder: "Builder",
        reviewer: "Reviewer",
        debugger: "Debugger",
      },
      stanceTones: {
        orchestrator: "violet",
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
      skillIds: ["long-task-protocol", "hunt", "check"],
      toolIds: [...DEFAULT_AGENT_MODE_TOOL_IDS],
    },
    runtimeAtoms: defaultRuntimeAtomsForFamily("agent_teams"),
    editorConstraints: {
      allowedNodeTemplates: MODE_FAMILY_RULES.agent_teams.allowedTemplates,
      requiredNodeTemplates: MODE_FAMILY_RULES.agent_teams.requiredTemplates,
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
        "orchestrator",
        "Orchestrator",
        "Clarify scope, coordinate implementation gates, and package final delivery evidence.",
        "agent_teams",
        ["session", "project"],
        orchestratorSoul,
      ),
      profile(
        "builder",
        "Builder",
        "Make minimal source changes and produce focused verification evidence.",
        "agent_teams",
        ["session", "project", "worker"],
        builderSoul,
      ),
      profile(
        "reviewer",
        "Reviewer",
        "Review code changes for regressions, missing tests, and acceptance gaps.",
        "agent_teams",
        ["session", "project", "worker", "artifact"],
        reviewerSoul,
      ),
      profile(
        "debugger",
        "Debugger",
        "Diagnose failing checks and runtime errors before the final handoff.",
        "agent_teams",
        ["session", "project", "worker", "artifact"],
        debuggerSoul,
      ),
    ],
    createdAt: now,
    updatedAt: now,
  }));
}

function createOraSelfBuilderModeSpec(): ModeSpec {
  const now = 0;
  return autoLayoutModeSpec(ModeSpecSchema.parse({
    id: ORA_SELF_BUILDER_MODE_ID,
    family: "agent_teams",
    label: "Ora Self Builder",
    summary: "Ora plans, edits, verifies, builds, and promotes a local package slot for itself.",
    description: "Use the local self-upgrade workflow when Ora should iterate its own source, produce a verified candidate package slot, and activate it through an explicit package gate.",
    recommendedUse: "Use for bounded Ora product/runtime improvements that can be verified locally before switching the active package slot.",
    failureMode: "Self-upgrade work can create a candidate package that passes code checks but still needs host ABI compatibility and rollback protection before activation.",
    systemPreset: true,
    nodes: [
      {
        id: "triage",
        template: "triage",
        label: "Plan task journal",
        title: "Plan task journal",
        ownerAgentId: "orchestrator",
        enabled: true,
        instructions: defaultNodeInstructions("agent_teams", "triage"),
        prompt: "Create or update the task journal, clarify the requested Ora change, and define verification gates before edits.",
        config: {},
      },
      {
        id: "build",
        template: "build",
        label: "Edit and build",
        title: "Edit and build",
        ownerAgentId: "builder",
        enabled: true,
        instructions: defaultNodeInstructions("agent_teams", "build"),
        prompt: "Make the smallest source changes, run focused checks, and build a candidate package slot with package.buildCandidate.",
        riskLevel: "high",
        config: {},
      },
      {
        id: "check",
        template: "check",
        label: "Verify package",
        title: "Verify package",
        ownerAgentId: "release_reviewer",
        enabled: true,
        instructions: defaultNodeInstructions("agent_teams", "check"),
        prompt: "Review the diff, package manifest, build logs, compatibility status, and rollback target before promotion.",
        riskLevel: "high",
        config: {},
      },
      {
        id: "handoff",
        template: "handoff",
        label: "Promote or report",
        title: "Promote or report",
        ownerAgentId: "orchestrator",
        enabled: true,
        instructions: defaultNodeInstructions("agent_teams", "handoff"),
        prompt: "Promote the verified slot only after final approval, otherwise report the candidate status and next fix.",
        riskLevel: "high",
        config: {},
      },
    ],
    edges: [
      { id: "triage-build", source: "triage", target: "build", kind: "control", label: "edit", enabled: true },
      { id: "build-check", source: "build", target: "check", kind: "verification", label: "verify", enabled: true },
      { id: "check-handoff", source: "check", target: "handoff", kind: "control", label: "promote", enabled: true },
    ],
    stopPolicy: {
      type: "queue_drained",
      detail: "Stop after the candidate package is either promoted or reported with concrete verification failures.",
    },
    capabilityFlags: {
      supportsPersistentWorkers: true,
      supportsSharedState: false,
      supportsEventRouting: false,
      approvalMode: "high_risk_only",
      skillIds: ["long-task-protocol"],
      toolIds: [...DEFAULT_AGENT_MODE_TOOL_IDS],
    },
    runtimeAtoms: defaultRuntimeAtomsForFamily("agent_teams"),
    editorConstraints: {
      allowedNodeTemplates: MODE_FAMILY_RULES.agent_teams.allowedTemplates,
      requiredNodeTemplates: MODE_FAMILY_RULES.agent_teams.requiredTemplates,
      readOnly: true,
      allowReorder: true,
      allowCreate: true,
      allowDelete: false,
      allowDisable: false,
    },
    defaultBudget: {
      ...DEFAULT_RESOURCE_BUDGETS.agent_teams,
      maxToolCalls: 256,
      maxRuntimeMs: 900000,
    },
    completionPolicy: completionPolicyForPreset("persistent"),
    runtimePolicy: runtimePolicyForPreset("team"),
    profiles: [
      profile(
        "orchestrator",
        "Orchestrator",
        "Own task scope, approval gates, package promotion, and rollback readiness.",
        "agent_teams",
        ["session", "project"],
      ),
      profile(
        "builder",
        "Builder",
        "Make scoped Ora source changes and build candidate package slots.",
        "agent_teams",
        ["session", "project"],
      ),
      profile(
        "release_reviewer",
        "Release Reviewer",
        "Review verification logs, package manifests, compatibility, and rollback safety.",
        "agent_teams",
        ["session", "artifact"],
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
  createDebateModeSpec(),
  createCodeDevelopmentModeSpec(),
  createOraSelfBuilderModeSpec(),
  createModeStudioBuilderModeSpec(),
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
