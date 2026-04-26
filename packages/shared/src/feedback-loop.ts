import { z } from "zod";

export const ProjectSignalSourceSchema = z.enum([
  "run_event",
  "trail_observation",
  "evaluation_result",
  "evaluation_feedback",
  "recovery_event",
  "approval_event",
  "project_file",
]);
export type ProjectSignalSource = z.infer<typeof ProjectSignalSourceSchema>;

export const ProjectSignalSeveritySchema = z.enum(["info", "warning", "critical"]);
export type ProjectSignalSeverity = z.infer<typeof ProjectSignalSeveritySchema>;

export const ProjectSignalEvidenceTargetSchema = z.object({
  kind: z.enum(["run", "trail", "evaluation", "feedback", "project_file"]),
  id: z.string().min(1),
  runId: z.string().min(1).optional(),
  eventSeq: z.number().int().nonnegative().optional(),
  evaluationRunId: z.string().min(1).optional(),
  datasetId: z.string().min(1).optional(),
  caseId: z.string().min(1).optional(),
  feedbackId: z.string().min(1).optional(),
  projectFilePath: z.string().min(1).optional(),
  tabHint: z.string().min(1).optional(),
});
export type ProjectSignalEvidenceTarget = z.infer<typeof ProjectSignalEvidenceTargetSchema>;

export const ProjectSignalEvidenceSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  summary: z.string().min(1).optional(),
  target: ProjectSignalEvidenceTargetSchema,
});
export type ProjectSignalEvidence = z.infer<typeof ProjectSignalEvidenceSchema>;

export const ProjectSignalSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  source: ProjectSignalSourceSchema,
  sourceRef: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().min(1),
  severity: ProjectSignalSeveritySchema,
  confidence: z.number().min(0).max(1),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  evidence: z.array(ProjectSignalEvidenceSchema).default([]),
  metadata: z.record(z.unknown()).default({}),
});
export type ProjectSignal = z.infer<typeof ProjectSignalSchema>;

export const ProjectSignalActionKindSchema = z.enum([
  "open_trails",
  "open_evaluation_feedback",
  "open_evaluation_run",
  "create_evaluation_case",
  "review_mode_rules",
  "retry_run",
]);
export type ProjectSignalActionKind = z.infer<typeof ProjectSignalActionKindSchema>;

export const ProjectSignalActionSchema = z.object({
  id: z.string().min(1),
  kind: ProjectSignalActionKindSchema,
  label: z.string().min(1),
  payload: z.record(z.unknown()).default({}),
  requiresConfirmation: z.boolean(),
});
export type ProjectSignalAction = z.infer<typeof ProjectSignalActionSchema>;

export const ProjectInsightStatusSchema = z.enum(["open", "dismissed", "applied"]);
export type ProjectInsightStatus = z.infer<typeof ProjectInsightStatusSchema>;

export const ProjectInsightSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().min(1),
  status: ProjectInsightStatusSchema,
  signalIds: z.array(z.string().min(1)).default([]),
  recommendedActions: z.array(ProjectSignalActionSchema).default([]),
  confidence: z.number().min(0).max(1),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});
export type ProjectInsight = z.infer<typeof ProjectInsightSchema>;

export const FeedbackLoopActionPolicySchema = z.object({
  allowedActionKinds: z.array(ProjectSignalActionKindSchema).default([]),
});
export type FeedbackLoopActionPolicy = z.infer<typeof FeedbackLoopActionPolicySchema>;

export const FeedbackLoopCalibrationRuleSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  name: z.string().min(1),
  enabled: z.boolean(),
  sourceFilters: z.array(ProjectSignalSourceSchema).default([]),
  severityThreshold: ProjectSignalSeveritySchema,
  humanReviewRequired: z.boolean(),
  actionPolicy: FeedbackLoopActionPolicySchema,
});
export type FeedbackLoopCalibrationRule = z.infer<typeof FeedbackLoopCalibrationRuleSchema>;

export const FeedbackLoopSignalsListParamsSchema = z.object({
  projectId: z.string().min(1).optional(),
  source: ProjectSignalSourceSchema.optional(),
  severity: ProjectSignalSeveritySchema.optional(),
  limit: z.number().int().positive().max(500).optional(),
});
export type FeedbackLoopSignalsListParams = z.infer<typeof FeedbackLoopSignalsListParamsSchema>;

export const FeedbackLoopInsightsListParamsSchema = z.object({
  projectId: z.string().min(1).optional(),
  status: ProjectInsightStatusSchema.optional(),
  limit: z.number().int().positive().max(500).optional(),
});
export type FeedbackLoopInsightsListParams = z.infer<typeof FeedbackLoopInsightsListParamsSchema>;

export const FeedbackLoopInsightGetParamsSchema = z.object({
  insightId: z.string().min(1),
});
export type FeedbackLoopInsightGetParams = z.infer<typeof FeedbackLoopInsightGetParamsSchema>;

export const FeedbackLoopInsightDismissParamsSchema = z.object({
  insightId: z.string().min(1),
  reason: z.string().min(1).optional(),
});
export type FeedbackLoopInsightDismissParams = z.infer<typeof FeedbackLoopInsightDismissParamsSchema>;

export const FeedbackLoopActionPreviewParamsSchema = z.object({
  insightId: z.string().min(1),
  actionId: z.string().min(1),
});
export type FeedbackLoopActionPreviewParams = z.infer<typeof FeedbackLoopActionPreviewParamsSchema>;

export const FeedbackLoopActionApplyParamsSchema = z.object({
  insightId: z.string().min(1),
  actionId: z.string().min(1),
  confirmed: z.literal(true),
});
export type FeedbackLoopActionApplyParams = z.infer<typeof FeedbackLoopActionApplyParamsSchema>;

export const FeedbackLoopActionResultSchema = z.object({
  insight: ProjectInsightSchema,
  action: ProjectSignalActionSchema,
  status: z.enum(["preview", "applied"]),
  message: z.string().min(1),
});
export type FeedbackLoopActionResult = z.infer<typeof FeedbackLoopActionResultSchema>;

export const FeedbackLoopRulesListParamsSchema = z.object({
  projectId: z.string().min(1).optional(),
});
export type FeedbackLoopRulesListParams = z.infer<typeof FeedbackLoopRulesListParamsSchema>;

export const FeedbackLoopRuleUpdateParamsSchema = z.object({
  rule: FeedbackLoopCalibrationRuleSchema,
});
export type FeedbackLoopRuleUpdateParams = z.infer<typeof FeedbackLoopRuleUpdateParamsSchema>;
