import { z } from "zod";

export const InterventionActionSchema = z.enum([
  "answer_directly",
  "clarify",
  "search_web",
  "read_context",
  "use_tool",
  "plan",
  "request_approval",
  "stop",
]);
export type InterventionAction = z.infer<typeof InterventionActionSchema>;

export const CausalInterventionSignificanceSchema = z.enum([
  "strategic",
  "tactical",
  "trace",
]);
export type CausalInterventionSignificance = z.infer<typeof CausalInterventionSignificanceSchema>;

export const CausalDecisionSourceSchema = z.enum([
  "router_primary",
  "runtime_followup",
  "adapter_inferred",
]);
export type CausalDecisionSource = z.infer<typeof CausalDecisionSourceSchema>;

export const CausalDecisionKindSchema = z.enum([
  "run_start",
  "clarification_resume",
  "tool_request",
  "completion",
  "clarification_triggered",
  "approval_triggered",
  "plan_updated",
  "adapter_inferred",
  "decision",
]);
export type CausalDecisionKind = z.infer<typeof CausalDecisionKindSchema>;

export const CausalTaskStateSchema = z.object({
  surfaceRequest: z.string().default(""),
  latentGoalHypotheses: z.array(z.string()).default([]),
  selectedLatentGoal: z.string().default(""),
  keyUncertainties: z.array(z.string()).default([]),
  constraints: z.array(z.string()).default([]),
  candidateInterventions: z.array(InterventionActionSchema).default([]),
  chosenIntervention: InterventionActionSchema.optional(),
  alternativeInterventions: z.array(InterventionActionSchema).default([]),
  counterfactualRiskIfSkipped: z.string().default(""),
  expectedOutcomeLift: z.string().default(""),
  confidence: z.number().min(0).max(1).default(0),
  stopCondition: z.string().default(""),
  needsFreshnessEvidence: z.boolean().optional(),
});
export type CausalTaskState = z.infer<typeof CausalTaskStateSchema>;

export const InterventionPolicyDecisionSchema = z.object({
  goalUncertainty: z.number().min(0).max(1).default(0),
  factUncertainty: z.number().min(0).max(1).default(0),
  contextUncertainty: z.number().min(0).max(1).default(0),
  actionRisk: z.number().min(0).max(1).default(0),
  userCost: z.number().min(0).max(1).default(0),
  reversibility: z.enum(["low", "medium", "high"]).default("medium"),
  recommendedAction: InterventionActionSchema,
  reason: z.string().default(""),
  wouldChangeOutcomeIfWrong: z.boolean().default(false),
});
export type InterventionPolicyDecision = z.infer<typeof InterventionPolicyDecisionSchema>;

export const CausalDecisionContextSchema = z.object({
  phase: z.string().min(1).optional(),
  turnIndex: z.number().int().positive().optional(),
  replyMessageId: z.string().min(1).optional(),
  toolId: z.string().min(1).optional(),
  toolCallId: z.string().min(1).optional(),
  providerCallId: z.string().min(1).optional(),
  actionId: z.string().min(1).optional(),
  clarificationId: z.string().min(1).optional(),
  planDecisionId: z.string().min(1).optional(),
  planStepId: z.string().min(1).optional(),
  iteration: z.number().int().nonnegative().optional(),
  agentId: z.string().min(1).optional(),
  nodeId: z.string().min(1).optional(),
});
export type CausalDecisionContext = z.infer<typeof CausalDecisionContextSchema>;

export const CausalDecisionRecordSchema = z.object({
  decisionId: z.string().min(1).optional(),
  source: CausalDecisionSourceSchema.default("router_primary"),
  decisionKind: CausalDecisionKindSchema.optional(),
  taskState: CausalTaskStateSchema,
  policyDecision: InterventionPolicyDecisionSchema,
  chosenIntervention: InterventionActionSchema,
  alternativeInterventions: z.array(InterventionActionSchema).default([]),
  recordedAt: z.number().int().nonnegative(),
  decisionContext: CausalDecisionContextSchema.optional(),
});
export type CausalDecisionRecord = z.infer<typeof CausalDecisionRecordSchema>;
