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
  customAgentId: z.string().min(1).optional(),
  modelRef: z.string().min(1).optional(),
  toolPolicyId: z.string().min(1),
  toolIds: z.array(z.string().min(1)).default([]),
  skillIds: z.array(z.string().min(1)).default([]),
  memoryNamespaces: z.array(z.string().min(1)),
  budget: ResourceBudgetSchema
});
export type AgentProfile = z.infer<typeof AgentProfileSchema>;
