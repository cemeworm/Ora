import { z } from "zod";
import { CoordinationPatternSchema } from "./primitives.js";
import { RunConfigSchema } from "./runtime.js";

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

export const EvaluationFeedbackStatusSchema = z.enum([
  "pending",
  "accepted",
  "rejected",
  "failed",
]);
export type EvaluationFeedbackStatus = z.infer<typeof EvaluationFeedbackStatusSchema>;

export const EvaluationFeedbackCuratorStatusSchema = z.enum([
  "generated",
  "fallback",
  "failed",
]);
export type EvaluationFeedbackCuratorStatus = z.infer<typeof EvaluationFeedbackCuratorStatusSchema>;

export const EvaluationFeedbackSubmitParamsSchema = z.object({
  runId: z.string().min(1),
  sessionId: z.string().min(1).optional(),
  turnIndex: z.number().int().positive().optional(),
  messageId: z.string().min(1).optional(),
  feedbackText: z.string().min(1),
});
export type EvaluationFeedbackSubmitParams = z.infer<typeof EvaluationFeedbackSubmitParamsSchema>;

export const EvaluationFeedbackDraftCaseSchema = z.object({
  case: EvaluationCaseSchema,
  curatorStatus: EvaluationFeedbackCuratorStatusSchema,
  curatorRationale: z.string().min(1).optional(),
  error: z.string().min(1).optional(),
});
export type EvaluationFeedbackDraftCase = z.infer<typeof EvaluationFeedbackDraftCaseSchema>;

export const EvaluationFeedbackRecordSchema = z.object({
  id: z.string().min(1),
  status: EvaluationFeedbackStatusSchema,
  feedbackText: z.string().min(1),
  sourceRunId: z.string().min(1),
  sourceSessionId: z.string().min(1).optional(),
  sourceTurnIndex: z.number().int().positive().optional(),
  sourceMessageId: z.string().min(1).optional(),
  sourceContext: z.record(z.unknown()).default({}),
  draft: EvaluationFeedbackDraftCaseSchema,
  datasetId: z.string().min(1).optional(),
  acceptedCaseId: z.string().min(1).optional(),
  rejectionReason: z.string().min(1).optional(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});
export type EvaluationFeedbackRecord = z.infer<typeof EvaluationFeedbackRecordSchema>;

export const EvaluationFeedbackListParamsSchema = z.object({
  status: EvaluationFeedbackStatusSchema.optional(),
  limit: z.number().int().positive().max(500).optional(),
});
export type EvaluationFeedbackListParams = z.infer<typeof EvaluationFeedbackListParamsSchema>;

export const EvaluationFeedbackGetParamsSchema = z.object({
  feedbackId: z.string().min(1),
});
export type EvaluationFeedbackGetParams = z.infer<typeof EvaluationFeedbackGetParamsSchema>;

export const EvaluationFeedbackUpdateParamsSchema = z.object({
  feedbackId: z.string().min(1),
  feedbackText: z.string().min(1).optional(),
  draftCase: EvaluationCaseSchema.optional(),
  curatorRationale: z.string().min(1).optional(),
});
export type EvaluationFeedbackUpdateParams = z.infer<typeof EvaluationFeedbackUpdateParamsSchema>;

export const EvaluationFeedbackAcceptParamsSchema = z.object({
  feedbackId: z.string().min(1),
  datasetId: z.string().min(1).optional(),
});
export type EvaluationFeedbackAcceptParams = z.infer<typeof EvaluationFeedbackAcceptParamsSchema>;

export const EvaluationFeedbackRejectParamsSchema = z.object({
  feedbackId: z.string().min(1),
  reason: z.string().min(1).optional(),
});
export type EvaluationFeedbackRejectParams = z.infer<typeof EvaluationFeedbackRejectParamsSchema>;
