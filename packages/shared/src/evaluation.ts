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

export const EvaluationMetricIdSchema = z.enum([
  "text_similarity",
  "exact_match",
  "acceptable_match",
  "assertion_pass_rate",
  "fallback_rate",
  "confidence_calibration",
  "latency_score",
  "cost_score",
  "agentic_cost_score",
  "token_efficiency",
  "tool_efficiency",
  "coordination_overhead",
  "recovery_overhead",
  "trace_coverage",
  "intent_resolution",
  "clarification_precision",
  "effective_intervention",
  "over_action",
  "counterfactual_lift",
]);
export type EvaluationMetricId = z.infer<typeof EvaluationMetricIdSchema>;

export const EvaluationObjectiveKindSchema = z.enum([
  "outcome",
  "classification",
  "assertions",
  "regression",
  "latency",
  "cost",
]);
export type EvaluationObjectiveKind = z.infer<typeof EvaluationObjectiveKindSchema>;

export const EvaluationTargetSchema = z.enum([
  "run.output",
  "runtime.mode_selection",
  "trace.events",
  "tool.calls",
  "artifact.files",
  "memory.updates",
]);
export type EvaluationTarget = z.infer<typeof EvaluationTargetSchema>;

export const EvaluationAssertionSchema = z.object({
  type: z.enum([
    "equals",
    "not_equals",
    "one_of",
    "not_one_of",
    "min",
    "max",
    "exists",
    "contains",
  ]),
  path: z.string().min(1),
  value: z.unknown().optional(),
  values: z.array(z.unknown()).optional(),
  weight: z.number().positive().default(1),
  failureTag: z.string().min(1).optional(),
  rationale: z.string().min(1).optional(),
});
export type EvaluationAssertion = z.infer<typeof EvaluationAssertionSchema>;

export const EvaluationStructuredExpectedSchema = z.object({
  assertions: z.array(EvaluationAssertionSchema).default([]),
  preferred: z.object({
    path: z.string().min(1),
    value: z.unknown(),
  }).optional(),
  notes: z.string().min(1).optional(),
}).passthrough();
export type EvaluationStructuredExpected = z.infer<typeof EvaluationStructuredExpectedSchema>;

export const EvaluationObjectiveSchema = z.object({
  kind: EvaluationObjectiveKindSchema,
  target: EvaluationTargetSchema,
  metrics: z.array(EvaluationMetricIdSchema).default([]),
  assertions: z.array(EvaluationAssertionSchema).default([]),
  evaluators: z.array(z.lazy(() => EvaluationEvaluatorSpecSchema)).default([]),
  displayColumns: z.array(z.string().min(1)).default([]),
  metadata: z.record(z.unknown()).default({}),
});
export type EvaluationObjective = z.infer<typeof EvaluationObjectiveSchema>;

export const EvaluationEvaluatorKindSchema = z.enum([
  "heuristic",
  "llm_judge",
  "human_annotation",
]);
export type EvaluationEvaluatorKind = z.infer<typeof EvaluationEvaluatorKindSchema>;

const EvaluationEvaluatorBaseSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  weight: z.number().positive().default(1),
  metadata: z.record(z.unknown()).default({}),
});

export const EvaluationHeuristicEvaluatorSchema = EvaluationEvaluatorBaseSchema.extend({
  kind: z.literal("heuristic"),
  metrics: z.array(EvaluationMetricIdSchema).default([]),
  assertions: z.array(EvaluationAssertionSchema).default([]),
});

export const EvaluationLlmJudgeEvaluatorSchema = EvaluationEvaluatorBaseSchema.extend({
  kind: z.literal("llm_judge"),
  rubric: z.string().min(1),
  providerId: z.string().min(1).optional(),
  modelRef: z.string().min(1).optional(),
  passThreshold: z.number().min(0).max(1).default(0.70),
});

export const EvaluationHumanAnnotationEvaluatorSchema = EvaluationEvaluatorBaseSchema.extend({
  kind: z.literal("human_annotation"),
  instructions: z.string().min(1),
  scoreType: z.enum(["boolean", "numeric", "categorical", "text"]).default("numeric"),
  categories: z.array(z.string().min(1)).default([]),
});

export const EvaluationEvaluatorSpecSchema = z.discriminatedUnion("kind", [
  EvaluationHeuristicEvaluatorSchema,
  EvaluationLlmJudgeEvaluatorSchema,
  EvaluationHumanAnnotationEvaluatorSchema,
]);
export type EvaluationEvaluatorSpec = z.infer<typeof EvaluationEvaluatorSpecSchema>;

export const EvaluationEvaluatorResultSchema = z.object({
  evaluatorId: z.string().min(1),
  evaluatorKind: EvaluationEvaluatorKindSchema,
  scorerVersion: z.string().min(1).default("1.0.0"),
  rubricVersion: z.string().min(1).optional(),
  score: z.number().min(0).max(1).optional(),
  passed: z.boolean().optional(),
  rationale: z.string().min(1).optional(),
  failureTags: z.array(z.string().min(1)).default([]),
  status: z.enum(["scored", "pending", "failed"]).default("scored"),
  details: z.record(z.unknown()).default({}),
});
export type EvaluationEvaluatorResult = z.infer<typeof EvaluationEvaluatorResultSchema>;

export const EvaluationMetricScoreSchema = z.object({
  metricId: EvaluationMetricIdSchema,
  score: z.number().min(0).max(1),
  passed: z.boolean().default(false),
  rationale: z.string().min(1),
  failureTags: z.array(z.string().min(1)).default([]),
  details: z.record(z.unknown()).default({}),
});
export type EvaluationMetricScore = z.infer<typeof EvaluationMetricScoreSchema>;

export const EvaluationObservationSchema = z.record(z.unknown());
export type EvaluationObservation = z.infer<typeof EvaluationObservationSchema>;

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
  "langfuse",
]);
export type EvaluationDatasetSourceFormat = z.infer<typeof EvaluationDatasetSourceFormatSchema>;

export const EvaluationBenchmarkMaturitySchema = z.enum([
  "seed",
  "compatible",
  "official",
]);
export type EvaluationBenchmarkMaturity = z.infer<typeof EvaluationBenchmarkMaturitySchema>;

export const EvaluationDatasetSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1).optional(),
  sourceFileName: z.string().min(1).optional(),
  sourceFormat: EvaluationDatasetSourceFormatSchema,
  schemaVersion: z.literal(1).default(1),
  caseCount: z.number().int().nonnegative(),
  tags: z.array(z.string().min(1)).default([]),
  benchmarkMaturity: EvaluationBenchmarkMaturitySchema.default("seed"),
  benchmarkFamily: z.string().min(1).optional(),
  scorerContract: z.string().min(1).optional(),
  fixtureRequirements: z.array(z.string().min(1)).default([]),
  knownLimitations: z.array(z.string().min(1)).default([]),
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

export const EvaluationLangfuseImportParamsSchema = z.object({
  datasetName: z.string().min(1),
  name: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  tags: z.array(z.string().min(1)).default([]),
});
export type EvaluationLangfuseImportParams = z.infer<typeof EvaluationLangfuseImportParamsSchema>;

export const EvaluationLangfuseExportParamsSchema = z.object({
  datasetId: z.string().min(1),
  langfuseDatasetName: z.string().min(1),
  description: z.string().min(1).optional(),
});
export type EvaluationLangfuseExportParams = z.infer<typeof EvaluationLangfuseExportParamsSchema>;

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
  objective: EvaluationObjectiveSchema.optional(),
  configs: z.array(EvaluationConfigSchema).min(1),
  repetitions: z.number().int().positive().max(10).default(1),
  concurrency: z.number().int().positive().max(32).default(1),
  timeoutMs: z.number().int().positive().max(600000).default(120000),
  baselineId: z.string().min(1).optional(),
  metadata: z.record(z.unknown()).default({}),
});
export type EvaluationSpec = z.infer<typeof EvaluationSpecSchema>;

export const EvaluationRecipeIdSchema = z.enum([
  "mode_comparison",
  "auto_router_quality",
  "tool_trajectory",
  "agent_coordination",
  "rag_quality",
  "safety_policy",
  "custom_spec",
]);
export type EvaluationRecipeId = z.infer<typeof EvaluationRecipeIdSchema>;

export const EvaluationSubjectSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("mode_matrix"),
    modeIds: z.array(z.string().min(1)).default([]),
  }),
  z.object({
    kind: z.literal("auto_router"),
    fallbackModeId: z.string().min(1).optional(),
  }),
  z.object({
    kind: z.literal("provider_matrix"),
    providerIds: z.array(z.string().min(1)).default([]),
    modeId: z.string().min(1).optional(),
  }),
  z.object({
    kind: z.literal("workflow"),
    modeId: z.string().min(1),
    workflowVersion: z.string().min(1).optional(),
  }),
  z.object({
    kind: z.literal("tool_planner"),
    modeId: z.string().min(1).optional(),
    toolIds: z.array(z.string().min(1)).default([]),
  }),
  z.object({
    kind: z.literal("prompt_or_policy"),
    modeId: z.string().min(1),
    policyRef: z.string().min(1).optional(),
  }),
]);
export type EvaluationSubject = z.infer<typeof EvaluationSubjectSchema>;

export const EvaluationDatasetSourceKindSchema = z.enum([
  "file_import",
  "feedback_inbox",
  "trails",
  "manual",
  "synthetic",
  "existing_dataset",
]);
export type EvaluationDatasetSourceKind = z.infer<typeof EvaluationDatasetSourceKindSchema>;

export const EvaluationDatasetPlanSchema = z.object({
  datasetId: z.string().min(1).optional(),
  sources: z.array(EvaluationDatasetSourceKindSchema).default(["existing_dataset"]),
  caseRequirements: z.array(z.string().min(1)).default([]),
  linkedDatasetIds: z.array(z.string().min(1)).default([]),
  notes: z.string().min(1).optional(),
  metadata: z.record(z.unknown()).default({}),
});
export type EvaluationDatasetPlan = z.infer<typeof EvaluationDatasetPlanSchema>;

export const EvaluationEvaluatorPlanSchema = z.object({
  metrics: z.array(EvaluationMetricIdSchema).default([]),
  assertions: z.array(EvaluationAssertionSchema).default([]),
  evaluators: z.array(EvaluationEvaluatorSpecSchema).default([]),
  judgeRubric: z.string().min(1).optional(),
  notes: z.string().min(1).optional(),
  metadata: z.record(z.unknown()).default({}),
});
export type EvaluationEvaluatorPlan = z.infer<typeof EvaluationEvaluatorPlanSchema>;

export const EvaluationRunPlanSchema = z.object({
  profileId: EvaluationProfileKindSchema.default("outcome"),
  providerId: z.string().min(1).optional(),
  modelRef: z.string().min(1).optional(),
  providerConfig: z.unknown().optional(),
  repetitions: z.number().int().positive().max(10).default(1),
  concurrency: z.number().int().positive().max(32).default(1),
  timeoutMs: z.number().int().positive().max(600000).default(120000),
  baselineId: z.string().min(1).optional(),
  routerOnly: z.boolean().default(false),
  gateThreshold: z.number().min(0).max(1).optional(),
  exportFormats: z.array(z.enum(["json", "csv"])).default(["json"]),
  metadata: z.record(z.unknown()).default({}),
});
export type EvaluationRunPlan = z.infer<typeof EvaluationRunPlanSchema>;

export const EvaluationReviewPlanSchema = z.object({
  emphasis: z.array(z.string().min(1)).default([]),
  failureTags: z.array(z.string().min(1)).default([]),
  includeTraceLinks: z.boolean().default(true),
  recommendedActions: z.array(z.string().min(1)).default([]),
  metadata: z.record(z.unknown()).default({}),
});
export type EvaluationReviewPlan = z.infer<typeof EvaluationReviewPlanSchema>;

export const EvaluationBlueprintStatusSchema = z.enum(["draft", "ready", "archived"]);
export type EvaluationBlueprintStatus = z.infer<typeof EvaluationBlueprintStatusSchema>;

export const EvaluationBlueprintSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  goal: z.string().min(1),
  recipe: EvaluationRecipeIdSchema,
  target: EvaluationTargetSchema,
  subject: EvaluationSubjectSchema,
  datasetPlan: EvaluationDatasetPlanSchema,
  evaluatorPlan: EvaluationEvaluatorPlanSchema,
  runPlan: EvaluationRunPlanSchema,
  reviewPlan: EvaluationReviewPlanSchema,
  status: EvaluationBlueprintStatusSchema.default("draft"),
  assumptions: z.array(z.string().min(1)).default([]),
  missingInformation: z.array(z.string().min(1)).default([]),
  linkedRunIds: z.array(z.string().min(1)).default([]),
  schemaVersion: z.literal(1).default(1),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});
export type EvaluationBlueprint = z.infer<typeof EvaluationBlueprintSchema>;

export const EvaluationBlueprintCreateParamsSchema = EvaluationBlueprintSchema.omit({
  id: true,
  schemaVersion: true,
  createdAt: true,
  updatedAt: true,
}).partial({
  status: true,
  assumptions: true,
  missingInformation: true,
  linkedRunIds: true,
});
export type EvaluationBlueprintCreateParams = z.infer<typeof EvaluationBlueprintCreateParamsSchema>;

export const EvaluationBlueprintUpdateParamsSchema = z.object({
  blueprintId: z.string().min(1),
  updates: EvaluationBlueprintCreateParamsSchema.partial(),
});
export type EvaluationBlueprintUpdateParams = z.infer<typeof EvaluationBlueprintUpdateParamsSchema>;

export const EvaluationBlueprintListParamsSchema = z.object({
  recipe: EvaluationRecipeIdSchema.optional(),
  status: EvaluationBlueprintStatusSchema.optional(),
  limit: z.number().int().positive().max(500).optional(),
});
export type EvaluationBlueprintListParams = z.infer<typeof EvaluationBlueprintListParamsSchema>;

export const EvaluationBlueprintGetParamsSchema = z.object({
  blueprintId: z.string().min(1),
});
export type EvaluationBlueprintGetParams = z.infer<typeof EvaluationBlueprintGetParamsSchema>;

export const EvaluationBlueprintCompileParamsSchema = z.object({
  blueprintId: z.string().min(1).optional(),
  blueprint: EvaluationBlueprintSchema.optional(),
  datasetId: z.string().min(1).optional(),
  providerId: z.string().min(1).optional(),
  modelRef: z.string().min(1).optional(),
  modeIds: z.array(z.string().min(1)).optional(),
}).refine(
  (value) => value.blueprintId !== undefined || value.blueprint !== undefined,
  { message: "Blueprint compile requires blueprintId or blueprint." }
);
export type EvaluationBlueprintCompileParams = z.infer<typeof EvaluationBlueprintCompileParamsSchema>;

export const EvaluationBlueprintCompileResultSchema = z.object({
  blueprint: EvaluationBlueprintSchema,
  spec: EvaluationSpecSchema,
  warnings: z.array(z.string().min(1)).default([]),
  assumptions: z.array(z.string().min(1)).default([]),
});
export type EvaluationBlueprintCompileResult = z.infer<typeof EvaluationBlueprintCompileResultSchema>;

export const EvaluationBlueprintGenerateDraftParamsSchema = z.object({
  goal: z.string().min(1),
  recipe: EvaluationRecipeIdSchema.optional(),
  datasetId: z.string().min(1).optional(),
  providerId: z.string().min(1).optional(),
  modelRef: z.string().min(1).optional(),
});
export type EvaluationBlueprintGenerateDraftParams = z.infer<typeof EvaluationBlueprintGenerateDraftParamsSchema>;

export const EvaluationAttemptStatusSchema = z.enum([
  "queued",
  "running",
  "succeeded",
  "failed",
  "timeout",
  "cancelled",
]);
export type EvaluationAttemptStatus = z.infer<typeof EvaluationAttemptStatusSchema>;

export const LangfuseScoreWriteStatusSchema = z.enum([
  "pending",
  "succeeded",
  "failed",
]);
export type LangfuseScoreWriteStatus = z.infer<typeof LangfuseScoreWriteStatusSchema>;

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
  metricScores: z.array(EvaluationMetricScoreSchema).default([]),
  evaluatorResults: z.array(EvaluationEvaluatorResultSchema).default([]),
  observations: EvaluationObservationSchema.default({}),
  runtimeMs: z.number().int().nonnegative().default(0),
  costUsd: z.number().nonnegative().default(0),
  startedAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  langfuseScoreWriteStatus: LangfuseScoreWriteStatusSchema.optional(),
});
export type EvaluationAttempt = z.infer<typeof EvaluationAttemptSchema>;

export const EvaluationAttemptEvidenceSchema = z.object({
  environment: z.object({
    nodeVersion: z.string().min(1).optional(),
    platform: z.string().min(1).optional(),
    arch: z.string().min(1).optional(),
    oraVersion: z.string().min(1).optional(),
    gitCommit: z.string().min(1).optional(),
    gitBranch: z.string().min(1).optional(),
  }).passthrough().default({}),
  model: z.object({
    providerId: z.string().min(1).optional(),
    modelRef: z.string().min(1).optional(),
    modelVersion: z.string().min(1).optional(),
  }).passthrough().default({}),
  scorerVersions: z.record(z.string().min(1)).default({}),
  toolCalls: z.array(z.object({
    toolId: z.string().min(1),
    toolName: z.string().min(1),
    status: z.string().min(1).optional(),
    runtimeMs: z.number().int().nonnegative().optional(),
  }).passthrough()).default([]),
  artifactLinks: z.array(z.string().min(1)).default([]),
  traceLinks: z.array(z.string().min(1)).default([]),
  sandboxState: z.record(z.unknown()).default({}),
  seedInfo: z.object({
    caseId: z.string().min(1),
    configId: z.string().min(1),
    repetition: z.number().int().positive(),
  }).passthrough().optional(),
}).passthrough();
export type EvaluationAttemptEvidence = z.infer<typeof EvaluationAttemptEvidenceSchema>;

export const EvaluationScorerInfoSchema = z.object({
  kind: EvaluationEvaluatorKindSchema,
  version: z.string().min(1).default("1.0.0"),
  rubricVersion: z.string().min(1).optional(),
  modelRef: z.string().min(1).optional(),
  providerId: z.string().min(1).optional(),
}).passthrough();
export type EvaluationScorerInfo = z.infer<typeof EvaluationScorerInfoSchema>;

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
  metricScores: z.array(EvaluationMetricScoreSchema).default([]),
  evaluatorResults: z.array(EvaluationEvaluatorResultSchema).default([]),
  latestOutput: z.unknown().optional(),
  observations: EvaluationObservationSchema.default({}),
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
  pendingAnnotationCount: z.number().int().nonnegative().default(0),
  configSummaries: z.array(EvaluationConfigSummarySchema),
  slices: z.array(EvaluationSliceSummarySchema).default([]),
});
export type EvaluationScorecard = z.infer<typeof EvaluationScorecardSchema>;

export const EvaluationRunStatusSchema = z.enum([
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
  "timeout",
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
  cancelledAt: z.number().int().nonnegative().optional(),
  resumable: z.boolean().default(false),
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
    "evaluation.attempt.failed",
    "evaluation.attempt.timeout",
    "evaluation.run.completed",
    "evaluation.run.cancelled",
    "evaluation.run.resumed",
    "evaluation.baseline.promoted",
    "evaluation.annotation.created",
    "evaluation.annotation.submitted",
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

export const EvaluationPlannerRoleSchema = z.enum(["user", "assistant"]);
export type EvaluationPlannerRole = z.infer<typeof EvaluationPlannerRoleSchema>;

export const EvaluationPlannerMessageSchema = z.object({
  id: z.string().min(1),
  role: EvaluationPlannerRoleSchema,
  content: z.string().min(1),
  createdAt: z.number().int().nonnegative(),
});
export type EvaluationPlannerMessage = z.infer<typeof EvaluationPlannerMessageSchema>;

export const EvaluationBlueprintPlanTurnParamsSchema = z.object({
  blueprintId: z.string().min(1).optional(),
  message: z.string().min(1),
  providerId: z.string().min(1).optional(),
  modelRef: z.string().min(1).optional(),
});
export type EvaluationBlueprintPlanTurnParams = z.infer<typeof EvaluationBlueprintPlanTurnParamsSchema>;

export const EvaluationBlueprintPlanTurnResultSchema = z.object({
  blueprint: EvaluationBlueprintSchema,
  messages: z.array(EvaluationPlannerMessageSchema),
  assistantMessage: EvaluationPlannerMessageSchema,
});
export type EvaluationBlueprintPlanTurnResult = z.infer<typeof EvaluationBlueprintPlanTurnResultSchema>;

export const EvaluationAnnotationStatusSchema = z.enum(["pending", "submitted"]);
export type EvaluationAnnotationStatus = z.infer<typeof EvaluationAnnotationStatusSchema>;

export const EvaluationAnnotationScoreSchema = z.object({
  value: z.union([z.boolean(), z.number().min(0).max(1), z.string().min(1)]),
  normalizedScore: z.number().min(0).max(1).optional(),
  passed: z.boolean().optional(),
  failureTags: z.array(z.string().min(1)).default([]),
});
export type EvaluationAnnotationScore = z.infer<typeof EvaluationAnnotationScoreSchema>;

export const EvaluationAnnotationTaskSchema = z.object({
  id: z.string().min(1),
  evaluationRunId: z.string().min(1),
  attemptId: z.string().min(1),
  caseId: z.string().min(1),
  configId: z.string().min(1),
  evaluatorId: z.string().min(1),
  instructions: z.string().min(1),
  scoreType: z.enum(["boolean", "numeric", "categorical", "text"]),
  categories: z.array(z.string().min(1)).default([]),
  status: EvaluationAnnotationStatusSchema.default("pending"),
  input: EvaluationCaseInputSchema,
  output: z.unknown().optional(),
  expected: EvaluationExpectedSchema.optional(),
  score: EvaluationAnnotationScoreSchema.optional(),
  comment: z.string().min(1).optional(),
  correctedOutput: z.unknown().optional(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  submittedAt: z.number().int().nonnegative().optional(),
});
export type EvaluationAnnotationTask = z.infer<typeof EvaluationAnnotationTaskSchema>;

export const EvaluationAnnotationListParamsSchema = z.object({
  status: EvaluationAnnotationStatusSchema.optional(),
  runId: z.string().min(1).optional(),
  limit: z.number().int().positive().max(500).optional(),
});
export type EvaluationAnnotationListParams = z.infer<typeof EvaluationAnnotationListParamsSchema>;

export const EvaluationAnnotationSubmitParamsSchema = z.object({
  taskId: z.string().min(1),
  score: EvaluationAnnotationScoreSchema,
  comment: z.string().min(1).optional(),
  correctedOutput: z.unknown().optional(),
});
export type EvaluationAnnotationSubmitParams = z.infer<typeof EvaluationAnnotationSubmitParamsSchema>;

export const EvaluationReportSchema = z.object({
  evaluationRunId: z.string().min(1),
  generatedAt: z.number().int().nonnegative(),
  generatorVersion: z.string().min(1).default("1.0.0"),
  run: z.lazy(() => EvaluationRunSchema),
  configs: z.array(z.lazy(() => EvaluationConfigSchema)),
  dataset: z.lazy(() => EvaluationDatasetSchema),
  scorecard: z.lazy(() => EvaluationScorecardSchema),
  failures: z.array(z.object({
    caseId: z.string().min(1),
    configId: z.string().min(1),
    failureTags: z.array(z.string().min(1)),
    score: z.number().min(0).max(1),
    rationale: z.string().min(1).optional(),
  })).default([]),
  slices: z.array(z.lazy(() => EvaluationSliceSummarySchema)).default([]),
  baselineDelta: z.object({
    baselineId: z.string().min(1).optional(),
    overallDelta: z.number().min(-1).max(1).optional(),
    regressionCount: z.number().int().nonnegative().default(0),
  }).passthrough().optional(),
  traceLinks: z.array(z.object({
    caseId: z.string().min(1),
    configId: z.string().min(1),
    runId: z.string().min(1),
  })).default([]),
  recommendedActions: z.array(z.string().min(1)).default([]),
}).passthrough();
export type EvaluationReport = z.infer<typeof EvaluationReportSchema>;

export const EvaluationReportGenerateParamsSchema = z.object({
  evaluationRunId: z.string().min(1),
  format: z.enum(["json", "markdown", "html"]).default("markdown"),
});
export type EvaluationReportGenerateParams = z.infer<typeof EvaluationReportGenerateParamsSchema>;
