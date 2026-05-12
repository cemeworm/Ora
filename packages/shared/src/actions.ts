import { z } from "zod";

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

export const PlanListStepStatusSchema = z.enum(["pending", "in_progress", "completed"]);
export type PlanListStepStatus = z.infer<typeof PlanListStepStatusSchema>;

export const PlanListStepSchema = z.object({
  id: z.string().min(1).optional(),
  step: z.string().min(1),
  status: PlanListStepStatusSchema,
});
export type PlanListStep = z.infer<typeof PlanListStepSchema>;

export const UpdatePlanArgsSchema = z.object({
  explanation: z.string().min(1).optional(),
  plan: z.array(PlanListStepSchema).min(1),
}).strict();
export type UpdatePlanArgs = z.infer<typeof UpdatePlanArgsSchema>;

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

export const ActionApprovalRequestCopySchema = z.object({
  title: z.string().min(1),
  summary: z.string().min(1),
  whatWillChange: z.string().min(1).optional(),
  whyNeeded: z.string().min(1).optional(),
  riskNote: z.string().min(1).optional(),
  confirmLabel: z.string().min(1).optional(),
});
export type ActionApprovalRequestCopy = z.infer<typeof ActionApprovalRequestCopySchema>;

export const ActionRecordSchema = z.object({
  id: z.string().min(1),
  runId: z.string().min(1),
  planItemId: z.string().min(1).optional(),
  planStepId: z.string().min(1).optional(),
  agentId: z.string().min(1).optional(),
  type: z.string().min(1),
  riskLevel: ActionRiskLevelSchema,
  status: ActionStatusSchema,
  input: z.unknown(),
  output: z.unknown().optional(),
  error: z.string().optional(),
  approvalRequest: ActionApprovalRequestCopySchema.optional(),
  artifactIds: z.array(z.string().min(1))
});
export type ActionRecord = z.infer<typeof ActionRecordSchema>;

export const OraToolCallSourceSchema = z.enum([
  "provider_native",
  "json_fallback",
  "manual_repair",
  "replay"
]);
export type OraToolCallSource = z.infer<typeof OraToolCallSourceSchema>;

export const OraToolCallStatusSchema = z.enum([
  "proposed",
  "approval_required",
  "approved",
  "running",
  "succeeded",
  "failed",
  "denied",
  "interrupted",
  "repaired"
]);
export type OraToolCallStatus = z.infer<typeof OraToolCallStatusSchema>;

export const RuntimeToolResultPreviewSchema = z.object({
  kind: z.string().min(1),
  summary: z.string(),
  detail: z.record(z.unknown()).optional(),
  preview: z.unknown().optional(),
});
export type RuntimeToolResultPreview = z.infer<typeof RuntimeToolResultPreviewSchema>;

export const OraToolCallResultSchema = z.object({
  status: OraToolCallStatusSchema,
  output: z.unknown().optional(),
  error: z.string().optional(),
  content: z.string().optional(),
  resultPreview: RuntimeToolResultPreviewSchema.optional(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});
export type OraToolCallResult = z.infer<typeof OraToolCallResultSchema>;

export const OraToolCallEnvelopeSchema = z.object({
  id: z.string().min(1),
  providerCallId: z.string().min(1).optional(),
  runId: z.string().min(1),
  nodeId: z.string().min(1).optional(),
  agentId: z.string().min(1).optional(),
  actionId: z.string().min(1).optional(),
  planStepId: z.string().min(1).optional(),
  toolId: z.string().min(1),
  args: z.record(z.unknown()).default({}),
  source: OraToolCallSourceSchema,
  status: OraToolCallStatusSchema,
  requestedAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  result: OraToolCallResultSchema.optional(),
  error: z.string().optional(),
  repairReason: z.string().optional(),
});
export type OraToolCallEnvelope = z.infer<typeof OraToolCallEnvelopeSchema>;

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
  "provider_finalization_unavailable",
  "provider_config_error",
  "provider_finalization_unavailable",
  "boundary_violation",
  "env_unavailable",
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
      id: "provider-finalization-fallback",
      label: "Provider finalization fallback",
      errorTypes: ["provider_finalization_unavailable"],
      action: "fallback_artifact",
    },
    {
      id: "provider-config-fail",
      label: "Provider config fail",
      errorTypes: ["provider_config_error"],
      action: "fail",
    },
    {
      id: "env-unavailable-fail",
      label: "Environment unavailable fail",
      errorTypes: ["env_unavailable"],
      action: "fail",
    },
    {
      id: "boundary-violation-degrade",
      label: "Boundary violation degrade",
      errorTypes: ["boundary_violation"],
      action: "fallback_artifact",
    },
    {
      id: "tool-error-fallback",
      label: "Tool error fallback",
      errorTypes: ["tool_error", "tool_output_invalid"],
      action: "fallback_artifact",
    },
    {
      id: "tool-policy-fail",
      label: "Tool policy fail",
      errorTypes: ["tool_policy_denied"],
      action: "fail",
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
