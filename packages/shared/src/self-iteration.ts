import { z } from "zod";
import { ActionRiskLevelSchema } from "./actions.js";
import { ProjectSignalEvidenceSchema } from "./feedback-loop.js";

export const SelfIterationTargetKindSchema = z.enum(["prompt", "mode", "skill", "evaluation"]);
export type SelfIterationTargetKind = z.infer<typeof SelfIterationTargetKindSchema>;

export const SelfIterationCandidateStatusSchema = z.enum([
  "draft",
  "evaluating",
  "ready",
  "rejected",
  "applied",
  "failed",
]);
export type SelfIterationCandidateStatus = z.infer<typeof SelfIterationCandidateStatusSchema>;

export const SelfIterationTargetRefSchema = z.object({
  kind: SelfIterationTargetKindSchema,
  id: z.string().min(1),
  modeId: z.string().min(1).optional(),
  nodeId: z.string().min(1).optional(),
  skillName: z.string().min(1).optional(),
  feedbackId: z.string().min(1).optional(),
  evaluationRunId: z.string().min(1).optional(),
}).passthrough();
export type SelfIterationTargetRef = z.infer<typeof SelfIterationTargetRefSchema>;

export const SelfIterationProposedChangeSchema = z.object({
  operation: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().min(1),
  before: z.unknown().optional(),
  after: z.unknown().optional(),
  patch: z.unknown().optional(),
  metadata: z.record(z.unknown()).default({}),
});
export type SelfIterationProposedChange = z.infer<typeof SelfIterationProposedChangeSchema>;

export const SelfIterationCandidateSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  targetKind: SelfIterationTargetKindSchema,
  targetRef: SelfIterationTargetRefSchema,
  title: z.string().min(1),
  summary: z.string().min(1),
  evidence: z.array(ProjectSignalEvidenceSchema).min(1),
  proposedChange: SelfIterationProposedChangeSchema,
  riskLevel: ActionRiskLevelSchema,
  status: SelfIterationCandidateStatusSchema,
  evaluationRunId: z.string().min(1).optional(),
  rejectionReason: z.string().min(1).optional(),
  applyResult: z.unknown().optional(),
  beforeSnapshot: z.unknown().optional(),
  verification: z.object({
    status: z.enum(["pending", "verified", "regressed"]).default("pending"),
    baselineScore: z.number().optional(),
    baselinePassRate: z.number().optional(),
    lastVerifiedAt: z.number().int().nonnegative().optional(),
    verifiedRunId: z.string().optional(),
  }).optional(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});
export type SelfIterationCandidate = z.infer<typeof SelfIterationCandidateSchema>;

export const SelfIterationAutonomySchema = z.enum(["low_risk_auto", "human_review", "experimental_auto"]);
export type SelfIterationAutonomy = z.infer<typeof SelfIterationAutonomySchema>;

export const SelfIterationCuratorTriggerSchema = z.enum([
  "evaluation_run_completed",
  "feedback_accepted",
  "feedback_submitted",
  "recovery_insight_created",
  "run_completed_idle",
]);
export type SelfIterationCuratorTrigger = z.infer<typeof SelfIterationCuratorTriggerSchema>;

export const SelfIterationEnvironmentObserverPolicySchema = z.object({
  enabled: z.boolean().default(false),
  paused: z.boolean().default(false),
  watchedPaths: z.array(z.string().min(1)).default(["."]),
  excludedGlobs: z.array(z.string().min(1)).default([".git/**", "node_modules/**", "dist/**", "build/**", "target/**", ".turbo/**"]),
  scanBudgetFiles: z.number().int().positive().max(5_000).default(200),
  maxFileBytes: z.number().int().positive().max(25_000_000).default(512_000),
});
export type SelfIterationEnvironmentObserverPolicy = z.infer<typeof SelfIterationEnvironmentObserverPolicySchema>;

export const SelfIterationPolicySchema = z.object({
  projectId: z.string().min(1),
  autonomy: SelfIterationAutonomySchema.default("low_risk_auto"),
  evaluationAutoApply: z.boolean().default(true),
  promptApplyRequiresConfirmation: z.boolean().default(true),
  modeApplyRequiresConfirmation: z.boolean().default(true),
  skillApplyRequiresConfirmation: z.boolean().default(true),
  curatorEnabled: z.boolean().default(true),
  scanCadenceMs: z.number().int().nonnegative().default(5 * 60 * 1000),
  idleScanDelayMs: z.number().int().nonnegative().default(30 * 1000),
  candidateGenerationLLM: z.boolean().default(false),
  enrichmentModelRef: z.string().min(1).optional(),
  environmentObserver: SelfIterationEnvironmentObserverPolicySchema.default({}),
  updatedAt: z.number().int().nonnegative(),
});
export type SelfIterationPolicy = z.infer<typeof SelfIterationPolicySchema>;

export const SelfIterationRunSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  kind: z.enum(["scan", "evaluate", "apply"]),
  candidateIds: z.array(z.string().min(1)).default([]),
  status: z.enum(["succeeded", "failed"]).default("succeeded"),
  message: z.string().min(1),
  createdAt: z.number().int().nonnegative(),
  metadata: z.record(z.unknown()).default({}),
});
export type SelfIterationRun = z.infer<typeof SelfIterationRunSchema>;

export const SelfIterationScanParamsSchema = z.object({
  projectId: z.string().min(1).optional(),
  autoApplyEvaluation: z.boolean().optional(),
}).default({});
export type SelfIterationScanParams = z.infer<typeof SelfIterationScanParamsSchema>;

export const SelfIterationCandidateListParamsSchema = z.object({
  projectId: z.string().min(1).optional(),
  targetKind: SelfIterationTargetKindSchema.optional(),
  status: SelfIterationCandidateStatusSchema.optional(),
  limit: z.number().int().positive().max(500).optional(),
}).default({});
export type SelfIterationCandidateListParams = z.infer<typeof SelfIterationCandidateListParamsSchema>;

export const SelfIterationCandidateGetParamsSchema = z.object({
  candidateId: z.string().min(1),
});
export type SelfIterationCandidateGetParams = z.infer<typeof SelfIterationCandidateGetParamsSchema>;

export const SelfIterationCandidateEvaluateParamsSchema = z.object({
  candidateId: z.string().min(1),
});
export type SelfIterationCandidateEvaluateParams = z.infer<typeof SelfIterationCandidateEvaluateParamsSchema>;

export const SelfIterationCandidateRejectParamsSchema = z.object({
  candidateId: z.string().min(1),
  reason: z.string().min(1).optional(),
});
export type SelfIterationCandidateRejectParams = z.infer<typeof SelfIterationCandidateRejectParamsSchema>;

export const SelfIterationCandidateApplyParamsSchema = z.object({
  candidateId: z.string().min(1),
  confirmed: z.boolean().default(false),
});
export type SelfIterationCandidateApplyParams = z.infer<typeof SelfIterationCandidateApplyParamsSchema>;

export const SelfIterationCandidateRollbackParamsSchema = z.object({
  candidateId: z.string().min(1),
});
export type SelfIterationCandidateRollbackParams = z.infer<typeof SelfIterationCandidateRollbackParamsSchema>;

export const SelfIterationPolicyGetParamsSchema = z.object({
  projectId: z.string().min(1).optional(),
}).default({});
export type SelfIterationPolicyGetParams = z.infer<typeof SelfIterationPolicyGetParamsSchema>;

export const SelfIterationPolicyUpdateParamsSchema = z.object({
  policy: SelfIterationPolicySchema,
});
export type SelfIterationPolicyUpdateParams = z.infer<typeof SelfIterationPolicyUpdateParamsSchema>;

export const SelfIterationScanResultSchema = z.object({
  run: SelfIterationRunSchema,
  candidates: z.array(SelfIterationCandidateSchema),
  autoApplied: z.array(SelfIterationCandidateSchema).default([]),
});
export type SelfIterationScanResult = z.infer<typeof SelfIterationScanResultSchema>;
