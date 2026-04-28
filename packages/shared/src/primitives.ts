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
export const MODE_STUDIO_BUILDER_MODE_ID = "mode_studio_builder" as const;
export const ORA_SELF_BUILDER_MODE_ID = "ora_self_builder" as const;
export const ORA_ROOT_AGENT_ID = "ora" as const;
export const ORA_ROOT_AGENT_LABEL = "Ora" as const;

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

export const CompletionPolicyPresetSchema = z.enum(["decisive", "balanced", "persistent"]);
export type CompletionPolicyPreset = z.infer<typeof CompletionPolicyPresetSchema>;

export const CompletionStopReasonSchema = z.enum([
  "completed",
  "tool_budget_exhausted",
  "repeated_tool_blocked",
  "tool_frequency_exhausted",
  "verification_passed",
  "verification_exhausted",
  "forced_final_answer",
  "runtime_tool_loop_limit",
]);
export type CompletionStopReason = z.infer<typeof CompletionStopReasonSchema>;

export const ModeCompletionPolicySchema = z.object({
  preset: CompletionPolicyPresetSchema.default("balanced"),
  maxRepeatedToolCalls: z.number().int().positive().max(10).default(2),
  forceFinalOnBudgetExhausted: z.boolean().default(true),
  forceFinalOnRepeatedTool: z.boolean().default(true),
  allowToolCallsAfterUsefulResult: z.boolean().default(true),
});
export type ModeCompletionPolicy = z.infer<typeof ModeCompletionPolicySchema>;

export const ModeThinkingSchema = z.enum(["off", "standard", "deep"]);
export type ModeThinking = z.infer<typeof ModeThinkingSchema>;

export const ModeReasoningEffortSchema = z.enum(["none", "low", "medium", "high"]);
export type ModeReasoningEffort = z.infer<typeof ModeReasoningEffortSchema>;

export const ModeBudgetProfileSchema = z.enum(["fast", "balanced", "deep"]);
export type ModeBudgetProfile = z.infer<typeof ModeBudgetProfileSchema>;

export const ModePlanningSchema = z.enum(["none", "light", "explicit"]);
export type ModePlanning = z.infer<typeof ModePlanningSchema>;

export const ModeDelegationSchema = z.enum(["none", "allowed", "preferred"]);
export type ModeDelegation = z.infer<typeof ModeDelegationSchema>;

export const ModeProviderThinkingSchema = z.enum(["disabled", "auto", "required"]);
export type ModeProviderThinking = z.infer<typeof ModeProviderThinkingSchema>;

export const ModeRuntimePolicySchema = z.object({
  thinking: ModeThinkingSchema.default("standard"),
  reasoningEffort: ModeReasoningEffortSchema.default("medium"),
  budgetProfile: ModeBudgetProfileSchema.default("balanced"),
  planning: ModePlanningSchema.default("light"),
  delegation: ModeDelegationSchema.default("none"),
  providerThinking: ModeProviderThinkingSchema.default("auto"),
});
export type ModeRuntimePolicy = z.infer<typeof ModeRuntimePolicySchema>;

export const DEFAULT_MODE_RUNTIME_POLICY: ModeRuntimePolicy = ModeRuntimePolicySchema.parse({});

export const COMPLETION_POLICY_PRESETS: Record<CompletionPolicyPreset, ModeCompletionPolicy> = {
  decisive: ModeCompletionPolicySchema.parse({
    preset: "decisive",
    maxRepeatedToolCalls: 1,
    forceFinalOnBudgetExhausted: true,
    forceFinalOnRepeatedTool: true,
    allowToolCallsAfterUsefulResult: false,
  }),
  balanced: ModeCompletionPolicySchema.parse({
    preset: "balanced",
    maxRepeatedToolCalls: 2,
    forceFinalOnBudgetExhausted: true,
    forceFinalOnRepeatedTool: true,
    allowToolCallsAfterUsefulResult: true,
  }),
  persistent: ModeCompletionPolicySchema.parse({
    preset: "persistent",
    maxRepeatedToolCalls: 4,
    forceFinalOnBudgetExhausted: true,
    forceFinalOnRepeatedTool: true,
    allowToolCallsAfterUsefulResult: true,
  }),
};

export function completionPolicyForPreset(preset: CompletionPolicyPreset): ModeCompletionPolicy {
  return { ...COMPLETION_POLICY_PRESETS[preset] };
}

export const AgentProfileSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  role: z.string().min(1),
  systemPrompt: z.string().min(1).optional(),
  customAgentId: z.string().min(1).optional(),
  modelRef: z.string().min(1).optional(),
  toolPolicyId: z.string().min(1),
  toolIds: z.array(z.string().min(1)).default([]),
  skillIds: z.array(z.string().min(1)).default([]),
  memoryNamespaces: z.array(z.string().min(1)),
  budget: ResourceBudgetSchema
});
export type AgentProfile = z.infer<typeof AgentProfileSchema>;
