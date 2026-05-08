import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import {
  EvaluationAnnotationListParamsSchema,
  EvaluationAnnotationSubmitParamsSchema,
  EvaluationAnnotationTask,
  EvaluationAnnotationTaskSchema,
  EvaluationAttempt,
  EvaluationAttemptEvidence,
  EvaluationAttemptEvidenceSchema,
  EvaluationAttemptSchema,
  EvaluationAssertion,
  EvaluationBaseline,
  EvaluationBaselineListParamsSchema,
  EvaluationBaselineSchema,
  EvaluationBlueprint,
  EvaluationBlueprintCompileParamsSchema,
  EvaluationBlueprintCompileResult,
  EvaluationBlueprintCompileResultSchema,
  EvaluationBlueprintCreateParamsSchema,
  EvaluationBlueprintGenerateDraftParamsSchema,
  EvaluationBlueprintGetParamsSchema,
  EvaluationBlueprintListParamsSchema,
  EvaluationBlueprintPlanTurnParamsSchema,
  EvaluationBlueprintPlanTurnResult,
  EvaluationBlueprintPlanTurnResultSchema,
  EvaluationBlueprintSchema,
  EvaluationBlueprintUpdateParamsSchema,
  EvaluationCase,
  EvaluationCaseSchema,
  EvaluationCaseResult,
  EvaluationCaseResultSchema,
  EvaluationComparison,
  EvaluationConfig,
  EvaluationConfigSummary,
  EvaluationDataset,
  EvaluationDatasetDetail,
  EvaluationDatasetDetailSchema,
  EvaluationDatasetSourceFormat,
  EvaluationDatasetGetParamsSchema,
  EvaluationDatasetListParamsSchema,
  EvaluationDatasetSchema,
  EvaluationExpected,
  EvaluationEvaluatorResult,
  EvaluationEvaluatorResultSchema,
  EvaluationEvaluatorSpec,
  EvaluationExportParamsSchema,
  EvaluationExportResult,
  EvaluationExportResultSchema,
  LangfuseScoreWriteStatusSchema,
  EvaluationFeedbackAcceptParamsSchema,
  EvaluationFeedbackDraftCase,
  EvaluationFeedbackDraftCaseSchema,
  EvaluationFeedbackGetParamsSchema,
  EvaluationFeedbackListParamsSchema,
  EvaluationFeedbackRecord,
  EvaluationFeedbackRecordSchema,
  EvaluationFeedbackRejectParamsSchema,
  EvaluationFeedbackSubmitParamsSchema,
  EvaluationFeedbackUpdateParamsSchema,
  EvaluationImportParamsSchema,
  EvaluationLangfuseImportParamsSchema,
  EvaluationLangfuseExportParamsSchema,
  EvaluationMetricId,
  EvaluationMetricScore,
  EvaluationMetricScoreSchema,
  EvaluationObjective,
  EvaluationObjectiveSchema,
  EvaluationObservation,
  EvaluationProfileKind,
  EvaluationRecipeId,
  EvaluationPromoteBaselineParamsSchema,
  EvaluationRun,
  EvaluationRunDetail,
  EvaluationRunDetailSchema,
  EvaluationRunGetParamsSchema,
  EvaluationRunListParamsSchema,
  EvaluationRunSchema,
  EvaluationRunStream,
  EvaluationRunStreamParamsSchema,
  EvaluationRunStreamSchema,
  EvaluationReport,
  EvaluationReportGenerateParamsSchema,
  EvaluationReportSchema,
  EvaluationScore,
  EvaluationScoreSchema,
  EvaluationScorecard,
  EvaluationScorecardSchema,
  EvaluationSliceSummary,
  EvaluationSpec,
  EvaluationSpecSchema,
  EvaluationStructuredExpectedSchema,
  EvaluationStreamEvent,
  EvaluationStreamEventSchema,
  RunConfig,
  RunConfigSchema,
  RunHandle,
  StateSnapshot,
  UserTaskInput,
  deriveRunAttention,
} from "@cemeworm/shared";
import { z } from "zod";
import { buildAgenticEfficiencyLedger } from "./agentic-efficiency.js";
import { parseJsonObject } from "./provider-json.js";
import { invokeRunProvider } from "./providers/index.js";
import {
  getLangfuseRunTraceMetadata,
  scoreLangfuseTrace,
  importLangfuseDataset,
  exportDatasetToLangfuse,
  createLangfuseExperiment,
  logLangfuseExperimentResult,
} from "./telemetry/langfuse.js";

const EvaluationManifestSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  nextDatasetNumber: z.number().int().positive().default(1),
  nextEvaluationRunNumber: z.number().int().positive().default(1),
  nextBaselineNumber: z.number().int().positive().default(1),
  nextFeedbackNumber: z.number().int().positive().default(1),
  nextBlueprintNumber: z.number().int().positive().default(1),
  nextAnnotationNumber: z.number().int().positive().default(1),
});

const PersistedEvaluationRunSchema = z.object({
  detail: EvaluationRunDetailSchema,
  events: z.array(EvaluationStreamEventSchema),
});

type EvaluationManifest = z.infer<typeof EvaluationManifestSchema>;
type PersistedEvaluationRun = z.infer<typeof PersistedEvaluationRunSchema>;

type RunExecutor = (params: { input: UserTaskInput; config: Partial<RunConfig> }) => Promise<StateSnapshot>;
type FeedbackCurator = (params: {
  feedbackId: string;
  feedbackText: string;
  sourceContext: Record<string, unknown>;
}) => Promise<EvaluationFeedbackDraftCase>;
type BlueprintDrafter = (params: {
  id: string;
  now: number;
  goal: string;
  recipe: EvaluationRecipeId;
  datasetId?: string;
  providerId?: string;
  modelRef?: string;
}) => Promise<EvaluationBlueprint>;

const FEEDBACK_DATASET_ID = "feedback-chat";

const CREATE_EVALUATION_MANIFEST_TABLE = `
CREATE TABLE IF NOT EXISTS evaluation_manifest (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  data TEXT NOT NULL
);
`;

const CREATE_EVALUATION_DATASETS_TABLE = `
CREATE TABLE IF NOT EXISTS evaluation_datasets (
  id TEXT PRIMARY KEY,
  updatedAt INTEGER NOT NULL,
  data TEXT NOT NULL
);
`;

const CREATE_EVALUATION_RUNS_TABLE = `
CREATE TABLE IF NOT EXISTS evaluation_runs (
  id TEXT PRIMARY KEY,
  datasetId TEXT NOT NULL,
  profileId TEXT NOT NULL,
  updatedAt INTEGER NOT NULL,
  data TEXT NOT NULL
);
`;

const CREATE_EVALUATION_BASELINES_TABLE = `
CREATE TABLE IF NOT EXISTS evaluation_baselines (
  id TEXT PRIMARY KEY,
  datasetId TEXT NOT NULL,
  profileId TEXT NOT NULL,
  createdAt INTEGER NOT NULL,
  data TEXT NOT NULL
);
`;

const CREATE_EVALUATION_FEEDBACK_TABLE = `
CREATE TABLE IF NOT EXISTS evaluation_feedback (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  updatedAt INTEGER NOT NULL,
  data TEXT NOT NULL
);
`;

const CREATE_EVALUATION_BLUEPRINTS_TABLE = `
CREATE TABLE IF NOT EXISTS evaluation_blueprints (
  id TEXT PRIMARY KEY,
  recipe TEXT NOT NULL,
  status TEXT NOT NULL,
  updatedAt INTEGER NOT NULL,
  data TEXT NOT NULL
);
`;

const CREATE_EVALUATION_ANNOTATIONS_TABLE = `
CREATE TABLE IF NOT EXISTS evaluation_annotations (
  id TEXT PRIMARY KEY,
  evaluationRunId TEXT NOT NULL,
  status TEXT NOT NULL,
  updatedAt INTEGER NOT NULL,
  data TEXT NOT NULL
);
`;

class Semaphore {
  private permits: number;
  private readonly queue: Array<() => void> = [];

  constructor(count: number) {
    this.permits = Math.max(1, count);
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits -= 1;
      return;
    }
    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
    } else {
      this.permits += 1;
    }
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}

export class LocalEvaluationStore {
  private readonly storage: "sqlite" | "file";
  private readonly db?: Database.Database;
  private readonly manifestPath: string;
  private readonly datasetsDir: string;
  private readonly runsDir: string;
  private readonly baselinesDir: string;
  private readonly feedbackDir: string;
  private readonly blueprintsDir: string;
  private readonly annotationsDir: string;
  private readonly clock: () => number;
  private manifest: EvaluationManifest;
  private datasets = new Map<string, EvaluationDatasetDetail>();
  private runs = new Map<string, PersistedEvaluationRun>();
  private baselines = new Map<string, EvaluationBaseline>();
  private feedback = new Map<string, EvaluationFeedbackRecord>();
  private blueprints = new Map<string, EvaluationBlueprint>();
  private annotations = new Map<string, EvaluationAnnotationTask>();

  constructor(private readonly baseDir: string, clock: () => number = Date.now) {
    this.clock = clock;
    this.storage = baseDir.endsWith(".db") ? "sqlite" : "file";
    this.manifestPath = path.join(baseDir, "manifest.json");
    this.datasetsDir = path.join(baseDir, "datasets");
    this.runsDir = path.join(baseDir, "runs");
    this.baselinesDir = path.join(baseDir, "baselines");
    this.feedbackDir = path.join(baseDir, "feedback");
    this.blueprintsDir = path.join(baseDir, "blueprints");
    this.annotationsDir = path.join(baseDir, "annotations");
    if (this.storage === "sqlite") {
      fs.mkdirSync(path.dirname(baseDir), { recursive: true });
      this.db = new Database(baseDir);
      this.db.pragma("journal_mode = WAL");
      this.db.pragma("busy_timeout = 5000");
      this.ensureSqliteSchema();
      this.manifest = this.readSqliteManifest();
    } else {
      this.ensureDirs();
      this.manifest = this.readJsonFile(this.manifestPath, EvaluationManifestSchema, EvaluationManifestSchema.parse({}));
    }
    const originalManifest = JSON.stringify(this.manifest);
    this.loadAll();
    if (JSON.stringify(this.manifest) !== originalManifest) {
      this.saveManifest();
    }
  }

  importDataset(params: unknown): EvaluationDatasetDetail {
    const parsed = EvaluationImportParamsSchema.parse(params);
    const content = parsed.content ?? fs.readFileSync(parsed.filePath!, "utf8");
    const sourceFileName = parsed.sourceFileName ?? (parsed.filePath ? path.basename(parsed.filePath) : undefined);
    const sourceFormat = parsed.sourceFormat ?? inferDatasetFormat(sourceFileName);
    const cases = parseCases(content, sourceFormat);
    const now = this.now();
    const dataset = EvaluationDatasetSchema.parse({
      id: this.nextDatasetId(),
      name: parsed.name?.trim() || deriveDatasetName(sourceFileName, sourceFormat),
      description: parsed.description?.trim(),
      sourceFileName,
      sourceFormat,
      schemaVersion: 1,
      caseCount: cases.length,
      tags: parsed.tags,
      createdAt: now,
      updatedAt: now,
    });
    const detail = EvaluationDatasetDetailSchema.parse({
      dataset,
      cases,
      metadataKeys: collectMetadataKeys(cases),
      tagCounts: collectTagCounts(cases),
    });
    this.datasets.set(dataset.id, detail);
    this.saveDataset(detail);
    return detail;
  }

  async importDatasetFromLangfuse(params: unknown): Promise<EvaluationDatasetDetail> {
    const parsed = EvaluationLangfuseImportParamsSchema.parse(params);
    const result = await importLangfuseDataset(parsed.datasetName);
    if (result.error) {
      throw new Error(`Failed to import dataset from Langfuse: ${result.error}`);
    }
    const now = this.now();
    const dataset = EvaluationDatasetSchema.parse({
      id: this.nextDatasetId(),
      name: parsed.name?.trim() || parsed.datasetName,
      description: parsed.description?.trim() || `Imported from Langfuse dataset "${parsed.datasetName}"`,
      sourceFileName: parsed.datasetName,
      sourceFormat: "langfuse",
      schemaVersion: 1,
      caseCount: result.cases.length,
      tags: parsed.tags,
      createdAt: now,
      updatedAt: now,
    });
    const detail = EvaluationDatasetDetailSchema.parse({
      dataset,
      cases: result.cases,
      metadataKeys: collectMetadataKeys(result.cases),
      tagCounts: collectTagCounts(result.cases),
    });
    this.datasets.set(dataset.id, detail);
    this.saveDataset(detail);
    return detail;
  }

  async exportDatasetToLangfuse(params: unknown): Promise<{ status: string; error?: string }> {
    const parsed = EvaluationLangfuseExportParamsSchema.parse(params);
    const detail = this.getDataset({ datasetId: parsed.datasetId });
    const result = await exportDatasetToLangfuse(
      parsed.langfuseDatasetName,
      detail.cases,
      parsed.description
    );
    return result;
  }

  listDatasets(params: unknown = {}): EvaluationDataset[] {
    const parsed = EvaluationDatasetListParamsSchema.parse(params);
    return [...this.datasets.values()]
      .map((detail) => detail.dataset)
      .sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id))
      .slice(0, parsed.limit)
      .map((dataset) => EvaluationDatasetSchema.parse(dataset));
  }

  getDataset(params: unknown): EvaluationDatasetDetail {
    const parsed = EvaluationDatasetGetParamsSchema.parse(params);
    const dataset = this.datasets.get(parsed.datasetId);
    if (!dataset) {
      throw new Error(`Evaluation dataset not found: ${parsed.datasetId}`);
    }
    return EvaluationDatasetDetailSchema.parse(dataset);
  }

  createBlueprint(params: unknown): EvaluationBlueprint {
    const parsed = EvaluationBlueprintCreateParamsSchema.parse(params);
    const now = this.now();
    const blueprint = EvaluationBlueprintSchema.parse({
      ...parsed,
      id: this.nextBlueprintId(),
      schemaVersion: 1,
      createdAt: now,
      updatedAt: now,
    });
    this.blueprints.set(blueprint.id, blueprint);
    this.saveBlueprint(blueprint);
    return blueprint;
  }

  updateBlueprint(params: unknown): EvaluationBlueprint {
    const parsed = EvaluationBlueprintUpdateParamsSchema.parse(params);
    const current = this.getBlueprint({ blueprintId: parsed.blueprintId });
    const next = EvaluationBlueprintSchema.parse({
      ...current,
      ...parsed.updates,
      id: current.id,
      schemaVersion: 1,
      createdAt: current.createdAt,
      updatedAt: this.now(),
    });
    this.blueprints.set(next.id, next);
    this.saveBlueprint(next);
    return next;
  }

  listBlueprints(params: unknown = {}): EvaluationBlueprint[] {
    const parsed = EvaluationBlueprintListParamsSchema.parse(params);
    return [...this.blueprints.values()]
      .filter((blueprint) => parsed.recipe ? blueprint.recipe === parsed.recipe : true)
      .filter((blueprint) => parsed.status ? blueprint.status === parsed.status : true)
      .sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id))
      .slice(0, parsed.limit)
      .map((blueprint) => EvaluationBlueprintSchema.parse(blueprint));
  }

  getBlueprint(params: unknown): EvaluationBlueprint {
    const parsed = EvaluationBlueprintGetParamsSchema.parse(params);
    const blueprint = this.blueprints.get(parsed.blueprintId);
    if (!blueprint) {
      throw new Error(`Evaluation blueprint not found: ${parsed.blueprintId}`);
    }
    return EvaluationBlueprintSchema.parse(blueprint);
  }

  compileBlueprint(params: unknown): EvaluationBlueprintCompileResult {
    const parsed = EvaluationBlueprintCompileParamsSchema.parse(params);
    const blueprint = parsed.blueprint ?? this.getBlueprint({ blueprintId: parsed.blueprintId });
    const result = compileEvaluationBlueprint(blueprint, {
      datasetId: parsed.datasetId,
      providerId: parsed.providerId,
      modelRef: parsed.modelRef,
      modeIds: parsed.modeIds,
    });
    return EvaluationBlueprintCompileResultSchema.parse(result);
  }

  async generateBlueprintDraft(params: unknown, draftWithProvider?: BlueprintDrafter): Promise<EvaluationBlueprint> {
    const parsed = EvaluationBlueprintGenerateDraftParamsSchema.parse(params);
    const draftInput = {
      goal: parsed.goal,
      recipe: parsed.recipe ?? inferRecipeFromGoal(parsed.goal),
      datasetId: parsed.datasetId,
      providerId: parsed.providerId,
      modelRef: parsed.modelRef,
      now: this.now(),
      id: this.nextBlueprintId(),
    };
    let draft = draftEvaluationBlueprint(draftInput);
    if (draftWithProvider) {
      try {
        draft = EvaluationBlueprintSchema.parse(await draftWithProvider(draftInput));
      } catch (error) {
        draft = EvaluationBlueprintSchema.parse({
          ...draft,
          assumptions: [
            ...draft.assumptions,
            `Provider draft unavailable; deterministic fallback used: ${error instanceof Error ? error.message : String(error)}`,
          ],
        });
      }
    }
    this.blueprints.set(draft.id, draft);
    this.saveBlueprint(draft);
    return draft;
  }

  async planBlueprintTurn(params: unknown): Promise<EvaluationBlueprintPlanTurnResult> {
    const parsed = EvaluationBlueprintPlanTurnParamsSchema.parse(params);
    const now = this.now();
    const current = parsed.blueprintId ? this.getBlueprint({ blueprintId: parsed.blueprintId }) : undefined;
    const base = current ?? draftEvaluationBlueprint({
      goal: parsed.message,
      recipe: inferRecipeFromGoal(parsed.message),
      providerId: parsed.providerId,
      modelRef: parsed.modelRef,
      now,
      id: this.nextBlueprintId(),
    });
    const userMessage = {
      id: `${base.id}:planner:user:${now}`,
      role: "user" as const,
      content: parsed.message.trim(),
      createdAt: now,
    };
    const planned = await this.planBlueprintWithProvider(base, parsed.message, parsed.providerId, parsed.modelRef)
      .catch((error) => deterministicPlanBlueprintTurn(base, parsed.message, error instanceof Error ? error.message : String(error)));
    const assistantMessage = {
      id: `${base.id}:planner:assistant:${this.now()}`,
      role: "assistant" as const,
      content: summarizeBlueprintPlan(planned),
      createdAt: this.now(),
    };
    const transcript = [
      ...plannerMessagesFromBlueprint(base),
      userMessage,
      assistantMessage,
    ];
    const blueprint = EvaluationBlueprintSchema.parse({
      ...planned,
      id: base.id,
      updatedAt: this.now(),
      runPlan: {
        ...planned.runPlan,
        providerId: parsed.providerId ?? planned.runPlan.providerId,
        modelRef: parsed.modelRef ?? planned.runPlan.modelRef,
      },
      evaluatorPlan: normalizeEvaluatorPlan(planned.evaluatorPlan),
      metadata: undefined,
      reviewPlan: {
        ...planned.reviewPlan,
        metadata: {
          ...(planned.reviewPlan.metadata ?? {}),
          plannerMessages: transcript,
        },
      },
    });
    this.blueprints.set(blueprint.id, blueprint);
    this.saveBlueprint(blueprint);
    return EvaluationBlueprintPlanTurnResultSchema.parse({
      blueprint,
      messages: transcript,
      assistantMessage,
    });
  }

  listAnnotations(params: unknown = {}): EvaluationAnnotationTask[] {
    const parsed = EvaluationAnnotationListParamsSchema.parse(params);
    return [...this.annotations.values()]
      .filter((task) => parsed.status ? task.status === parsed.status : true)
      .filter((task) => parsed.runId ? task.evaluationRunId === parsed.runId : true)
      .sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id))
      .slice(0, parsed.limit)
      .map((task) => EvaluationAnnotationTaskSchema.parse(task));
  }

  submitAnnotation(params: unknown): EvaluationAnnotationTask {
    const parsed = EvaluationAnnotationSubmitParamsSchema.parse(params);
    const current = this.annotations.get(parsed.taskId);
    if (!current) {
      throw new Error(`Evaluation annotation not found: ${parsed.taskId}`);
    }
    const next = EvaluationAnnotationTaskSchema.parse({
      ...current,
      status: "submitted",
      score: parsed.score,
      comment: parsed.comment?.trim(),
      correctedOutput: parsed.correctedOutput,
      updatedAt: this.now(),
      submittedAt: this.now(),
    });
    this.annotations.set(next.id, next);
    this.saveAnnotation(next);
    this.applyAnnotationToRun(next);
    return next;
  }

  listBaselines(params: unknown = {}): EvaluationBaseline[] {
    const parsed = EvaluationBaselineListParamsSchema.parse(params);
    return [...this.baselines.values()]
      .filter((baseline) => parsed.datasetId ? baseline.datasetId === parsed.datasetId : true)
      .filter((baseline) => parsed.profileId ? baseline.profileId === parsed.profileId : true)
      .sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id))
      .map((baseline) => EvaluationBaselineSchema.parse(baseline));
  }

  listRuns(params: unknown = {}): EvaluationRun[] {
    const parsed = EvaluationRunListParamsSchema.parse(params);
    return [...this.runs.values()]
      .map((entry) => entry.detail.run)
      .filter((run) => parsed.datasetId ? run.spec.datasetId === parsed.datasetId : true)
      .filter((run) => parsed.profileId ? run.spec.profileId === parsed.profileId : true)
      .sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id))
      .slice(0, parsed.limit)
      .map((run) => EvaluationRunSchema.parse(run));
  }

  getRun(params: unknown): EvaluationRunDetail {
    const parsed = EvaluationRunGetParamsSchema.parse(params);
    const run = this.runs.get(parsed.evaluationRunId);
    if (!run) {
      throw new Error(`Evaluation run not found: ${parsed.evaluationRunId}`);
    }
    return EvaluationRunDetailSchema.parse(run.detail);
  }

  streamRun(params: unknown): EvaluationRunStream {
    const parsed = EvaluationRunStreamParamsSchema.parse(params);
    const run = this.runs.get(parsed.evaluationRunId);
    if (!run) {
      throw new Error(`Evaluation run not found: ${parsed.evaluationRunId}`);
    }
    const fromSeq = parsed.afterSeq === undefined ? 0 : parsed.afterSeq + 1;
    const events = run.events.filter((event) => event.seq >= fromSeq);
    return EvaluationRunStreamSchema.parse({
      evaluationRunId: parsed.evaluationRunId,
      fromSeq,
      events,
      nextSeq: run.events.length,
    });
  }

  cancelEvaluationRun(params: unknown): EvaluationRunDetail {
    const parsed = EvaluationRunGetParamsSchema.parse(params);
    const run = this.runs.get(parsed.evaluationRunId);
    if (!run) {
      throw new Error(`Evaluation run not found: ${parsed.evaluationRunId}`);
    }
    const now = this.now();
    const updatedRun = EvaluationRunSchema.parse({
      ...run.detail.run,
      status: "cancelled",
      updatedAt: now,
      cancelledAt: now,
      completedAt: run.detail.run.completedAt ?? now,
      resumable: false,
    });
    run.events.push(EvaluationStreamEventSchema.parse({
      id: `${parsed.evaluationRunId}:evt-${run.events.length}`,
      evaluationRunId: parsed.evaluationRunId,
      seq: run.events.length,
      type: "evaluation.run.cancelled",
      createdAt: now,
      payload: { status: "cancelled", cancelledAt: now },
    }));
    const detail = EvaluationRunDetailSchema.parse({
      ...run.detail,
      run: updatedRun,
    });
    this.runs.set(parsed.evaluationRunId, { detail, events: run.events });
    this.saveRun(parsed.evaluationRunId);
    return detail;
  }

  resumeEvaluationRun(params: unknown): EvaluationRunDetail {
    const parsed = EvaluationRunGetParamsSchema.parse(params);
    const run = this.runs.get(parsed.evaluationRunId);
    if (!run) {
      throw new Error(`Evaluation run not found: ${parsed.evaluationRunId}`);
    }
    if (!run.detail.run.resumable) {
      throw new Error(`Evaluation run is not resumable: ${parsed.evaluationRunId}`);
    }
    if (run.detail.run.status !== "queued" && run.detail.run.status !== "running") {
      throw new Error(`Evaluation run cannot be resumed in status "${run.detail.run.status}": ${parsed.evaluationRunId}`);
    }
    return run.detail;
  }

  async startRun(params: unknown, executeRun: RunExecutor): Promise<EvaluationRunDetail> {
    const spec = EvaluationSpecSchema.parse(params);
    const dataset = this.getDataset({ datasetId: spec.datasetId });
    const evaluationRunId = this.nextEvaluationRunId();
    const startedAt = this.now();
    const totalAttempts = dataset.cases.length * spec.configs.length * spec.repetitions;
    const events: EvaluationStreamEvent[] = [];
    const appendEvent = (type: EvaluationStreamEvent["type"], payload: unknown) => {
      const event = EvaluationStreamEventSchema.parse({
        id: `${evaluationRunId}:evt-${events.length}`,
        evaluationRunId,
        seq: events.length,
        type,
        createdAt: this.now(),
        payload,
      });
      events.push(event);
    };

    appendEvent("evaluation.run.started", {
      datasetId: dataset.dataset.id,
      profileId: spec.profileId,
      configCount: spec.configs.length,
      repetitionCount: spec.repetitions,
    });

    // Phase 1: Persist run as "queued" before starting attempts
    const initialRun = EvaluationRunSchema.parse({
      id: evaluationRunId,
      spec,
      status: "queued",
      totalAttempts,
      completedAttempts: 0,
      failedAttempts: 0,
      attemptIds: [],
      caseResults: [],
      scorecard: emptyScorecard(spec.configs),
      startedAt,
      updatedAt: startedAt,
      resumable: true,
    });
    const initialDetail = EvaluationRunDetailSchema.parse({
      run: initialRun,
      attempts: [],
      dataset: dataset.dataset,
      configs: spec.configs,
    });
    this.runs.set(evaluationRunId, { detail: initialDetail, events });
    this.saveRun(evaluationRunId);

    const isLangfuseDataset = dataset.dataset.sourceFormat === "langfuse";
    const langfuseExperimentName = isLangfuseDataset
      ? `ora-eval-${evaluationRunId}`
      : undefined;

    if (langfuseExperimentName && dataset.dataset.sourceFileName) {
      await createLangfuseExperiment(
        dataset.dataset.sourceFileName,
        langfuseExperimentName,
        `Ora evaluation run ${evaluationRunId}`
      );
    }

    // Phase 1: Transition to "running"
    initialRun.status = "running";
    initialRun.updatedAt = this.now();
    this.runs.set(evaluationRunId, { detail: { ...initialDetail, run: initialRun }, events });
    this.saveRun(evaluationRunId);

    // Phase 2: Build work items and execute with bounded concurrency
    const workItems: Array<{ evaluationCase: EvaluationCase; config: EvaluationConfig; repetition: number }> = [];
    for (const evaluationCase of dataset.cases) {
      for (const config of spec.configs) {
        for (let repetition = 1; repetition <= spec.repetitions; repetition += 1) {
          workItems.push({ evaluationCase, config, repetition });
        }
      }
    }

    const attempts: EvaluationAttempt[] = [];
    const concurrency = Math.max(1, spec.concurrency);
    const semaphore = new Semaphore(concurrency);

    // Phase 2 & 3: Execute work items concurrently with per-attempt isolation
    await Promise.all(workItems.map((item) =>
      semaphore.run(async () => {
        let attempt: EvaluationAttempt;
        let annotationTasks: Array<Partial<EvaluationAnnotationTask>> = [];
        try {
          const result = await this.executeSingleAttempt(
            item.evaluationCase,
            item.config,
            item.repetition,
            evaluationRunId,
            spec,
            executeRun,
            langfuseExperimentName,
            dataset
          );
          attempt = result.attempt;
          annotationTasks = result.annotationTasks;
        } catch (error) {
          // Phase 3: Failure isolation - record failed attempt and continue
          attempt = this.createFailedAttempt(
            item.evaluationCase,
            item.config,
            item.repetition,
            evaluationRunId,
            spec,
            error
          );
        }

        attempts.push(attempt);

        // Create annotation tasks from evaluator results
        for (const task of annotationTasks) {
          const annotation = EvaluationAnnotationTaskSchema.parse({
            ...task,
            id: this.nextAnnotationId(),
            evaluationRunId,
            attemptId: attempt.id,
            caseId: item.evaluationCase.id,
            configId: item.config.id,
            input: item.evaluationCase.input,
            output: attempt.output,
            expected: item.evaluationCase.expected,
            status: "pending",
            createdAt: this.now(),
            updatedAt: this.now(),
          });
          this.annotations.set(annotation.id, annotation);
          this.saveAnnotation(annotation);
          appendEvent("evaluation.annotation.created", { annotationTaskId: annotation.id, attemptId: attempt.id });
        }

        appendEvent("evaluation.attempt.completed", {
          attemptId: attempt.id,
          caseId: attempt.caseId,
          configId: attempt.configId,
          repetition: item.repetition,
          status: attempt.status,
          underlyingRunId: attempt.underlyingRunId,
          overallScore: attempt.score.overallScore,
        });

        // Phase 1: Incremental progress persistence after each attempt
        this.updateRunProgress(evaluationRunId, attempts, dataset, spec, events, startedAt);
      })
    ));

    // Phase 4: Determine final run status
    const failedCount = attempts.filter((a) => a.status === "failed" || a.status === "timeout").length;
    const finalStatus: EvaluationRun["status"] = failedCount === totalAttempts ? "failed" : "succeeded";

    // Build final results
    const baseline = spec.baselineId ? this.baselines.get(spec.baselineId) : undefined;
    const caseResults = buildCaseResults(dataset.cases, spec.configs, attempts, baseline ? this.runs.get(baseline.evaluationRunId)?.detail : undefined, baseline);
    const scorecard = buildScorecard(spec.configs, attempts, caseResults);
    const run = EvaluationRunSchema.parse({
      id: evaluationRunId,
      spec,
      status: finalStatus,
      totalAttempts,
      completedAttempts: attempts.length,
      failedAttempts: failedCount,
      attemptIds: attempts.map((a) => a.id),
      caseResults,
      scorecard,
      startedAt,
      updatedAt: this.now(),
      completedAt: this.now(),
      resumable: false,
    });
    appendEvent("evaluation.run.completed", {
      overallScore: run.scorecard.overallScore,
      passRate: run.scorecard.passRate,
      regressionCount: run.scorecard.regressionCount,
    });

    const detail = EvaluationRunDetailSchema.parse({
      run,
      attempts,
      dataset: dataset.dataset,
      configs: spec.configs,
    });
    this.runs.set(evaluationRunId, { detail, events });
    this.saveRun(evaluationRunId);
    return detail;
  }

  private async planBlueprintWithProvider(
    base: EvaluationBlueprint,
    message: string,
    providerId?: string,
    modelRef?: string,
  ): Promise<EvaluationBlueprint> {
    const config = RunConfigSchema.parse({
      pattern: "orchestrator_subagent",
      providerId: providerId ?? base.runPlan.providerId,
      modelRef: modelRef ?? base.runPlan.modelRef,
      providerConfig: base.runPlan.providerConfig,
    });
    const response = await invokeRunProvider(config, {
      system: [
        "You are Ora's Evaluation Planner agent.",
        "Update the supplied EvaluationBlueprint from the user's latest planning message.",
        "Return only one complete EvaluationBlueprint JSON object.",
        "Do not start a run. Prefer evaluatorPlan.evaluators with heuristic, llm_judge, and human_annotation where useful.",
        "Keep schemaVersion 1 and preserve the blueprint id and createdAt.",
      ].join("\n"),
      messages: [{
        role: "user",
        content: JSON.stringify({ blueprint: base, message }, null, 2),
      }],
      temperature: 0,
      maxTokens: 2200,
      toolChoice: "none",
    });
    const parsed = parseJsonObject(response.text);
    return EvaluationBlueprintSchema.parse({
      ...parsed,
      id: base.id,
      schemaVersion: 1,
      createdAt: base.createdAt,
      updatedAt: this.now(),
    });
  }

  private async scoreEvaluationAttempt(
    spec: EvaluationSpec,
    evaluationCase: EvaluationCase,
    config: EvaluationConfig,
    snapshot: StateSnapshot,
    runtimeMs: number
  ): Promise<{
    score: EvaluationScore;
    metricScores: EvaluationMetricScore[];
    evaluatorResults: EvaluationEvaluatorResult[];
    observations: EvaluationObservation;
    output?: unknown;
    annotationTasks: Array<Partial<EvaluationAnnotationTask>>;
  }> {
    const base = scoreEvaluationAttempt(spec, evaluationCase, snapshot, runtimeMs);
    const evaluators = evaluatorsForSpec(spec);
    if (evaluators.length === 0) {
      return { ...base, evaluatorResults: [], annotationTasks: [] };
    }
    const evaluatorResults: EvaluationEvaluatorResult[] = [];
    const metricScores: EvaluationMetricScore[] = [];
    const annotationTasks: Array<Partial<EvaluationAnnotationTask>> = [];
    for (const evaluator of evaluators) {
      if (evaluator.kind === "heuristic") {
        const objective = EvaluationObjectiveSchema.parse({
          ...(spec.objective ?? objectiveForProfile(spec.profileId, evaluationCase)),
          metrics: evaluator.metrics,
          assertions: evaluator.assertions,
        });
        const scores = scoreObjectiveMetrics(objective, evaluationCase, base.observations);
        metricScores.push(...scores);
        const aggregate = aggregateMetricScores(scores, spec.profileId, snapshot.status === "failed" || Boolean(snapshot.error));
        evaluatorResults.push(EvaluationEvaluatorResultSchema.parse({
          evaluatorId: evaluator.id,
          evaluatorKind: evaluator.kind,
          scorerVersion: "1.0.0",
          score: aggregate.overallScore,
          passed: aggregate.overallScore >= 0.75,
          rationale: aggregate.judgeRationale,
          failureTags: aggregate.failureTags,
          details: { metricScores: scores },
        }));
        continue;
      }
      if (evaluator.kind === "llm_judge") {
        const result = await this.runLlmJudgeEvaluator(evaluator, spec, config, evaluationCase, base.observations, base.output ?? snapshot.output);
        evaluatorResults.push(result);
        continue;
      }
      annotationTasks.push({
        evaluatorId: evaluator.id,
        instructions: evaluator.instructions,
        scoreType: evaluator.scoreType,
        categories: evaluator.categories,
      });
      evaluatorResults.push(EvaluationEvaluatorResultSchema.parse({
        evaluatorId: evaluator.id,
        evaluatorKind: evaluator.kind,
        scorerVersion: "1.0.0",
        status: "pending",
        rationale: "Waiting for human annotation.",
      }));
    }
    const scoredResults = evaluatorResults.filter((result) => result.status === "scored" && typeof result.score === "number");
    const mergedScore = scoredResults.length > 0
      ? scoreFromEvaluatorResults(scoredResults, spec.profileId, snapshot.status === "failed" || Boolean(snapshot.error))
      : base.score;
    return {
      ...base,
      score: mergedScore,
      metricScores: metricScores.length > 0 ? metricScores : base.metricScores,
      evaluatorResults,
      annotationTasks,
    };
  }

  private async runLlmJudgeEvaluator(
    evaluator: EvaluationEvaluatorSpec & { kind: "llm_judge" },
    spec: EvaluationSpec,
    config: EvaluationConfig,
    evaluationCase: EvaluationCase,
    observations: EvaluationObservation,
    output: unknown,
  ): Promise<EvaluationEvaluatorResult> {
    try {
      const judgeConfig = RunConfigSchema.parse({
        ...config.runConfig,
        providerId: evaluator.providerId ?? spec.metadata.judgeProviderId ?? config.runConfig.providerId,
        modelRef: evaluator.modelRef ?? spec.metadata.judgeModelRef ?? config.runConfig.modelRef,
      });
      const response = await invokeRunProvider(judgeConfig, {
        system: [
          "You are an LLM evaluation judge.",
          "Return only JSON with shape: {\"score\":0..1,\"pass\":boolean,\"rationale\":\"...\",\"failureTags\":[\"...\"]}.",
          "Use the rubric and evidence. Do not rewrite the answer.",
        ].join("\n"),
        messages: [{
          role: "user",
          content: JSON.stringify({
            rubric: evaluator.rubric,
            passThreshold: evaluator.passThreshold,
            case: evaluationCase,
            output,
            observations,
          }, null, 2),
        }],
        temperature: 0,
        maxTokens: 800,
        toolChoice: "none",
      });
      const parsed = parseJsonObject(response.text) as Record<string, unknown>;
      const score = typeof parsed.score === "number" ? parsed.score : 0;
      const passed = typeof parsed.pass === "boolean" ? parsed.pass : score >= evaluator.passThreshold;
      return EvaluationEvaluatorResultSchema.parse({
        evaluatorId: evaluator.id,
        evaluatorKind: evaluator.kind,
        scorerVersion: "1.0.0",
        rubricVersion: evaluator.rubric ? "1.0.0" : undefined,
        score: Math.max(0, Math.min(1, score)),
        passed,
        rationale: typeof parsed.rationale === "string" ? parsed.rationale : "LLM judge returned a score.",
        failureTags: Array.isArray(parsed.failureTags) ? parsed.failureTags.filter((tag): tag is string => typeof tag === "string") : [],
        details: { providerId: judgeConfig.providerId, modelRef: judgeConfig.modelRef },
      });
    } catch (error) {
      return EvaluationEvaluatorResultSchema.parse({
        evaluatorId: evaluator.id,
        evaluatorKind: evaluator.kind,
        scorerVersion: "1.0.0",
        status: "failed",
        score: 0,
        passed: false,
        rationale: `LLM judge failed: ${error instanceof Error ? error.message : String(error)}`,
        failureTags: ["judge_failed"],
      });
    }
  }

  private buildAttemptEvidence(
    evaluationCase: EvaluationCase,
    config: EvaluationConfig,
    repetition: number,
    snapshot: StateSnapshot,
    _runtimeMs: number
  ): EvaluationAttemptEvidence {
    const toolCalls = (snapshot.toolCalls ?? []).map((call) => ({
      toolId: call.toolId,
      toolName: call.toolId,
      status: call.status,
      runtimeMs: Math.max(0, call.updatedAt - call.requestedAt),
    }));
    const traceLinks = snapshot.trace?.traceId ? [snapshot.trace.traceId] : [];
    const evidence = EvaluationAttemptEvidenceSchema.parse({
      environment: {
        nodeVersion: typeof process !== "undefined" ? process.version : undefined,
        platform: typeof process !== "undefined" ? process.platform : undefined,
        arch: typeof process !== "undefined" ? process.arch : undefined,
      },
      model: {
        providerId: typeof config.runConfig.providerId === "string" ? config.runConfig.providerId : undefined,
        modelRef: typeof config.runConfig.modelRef === "string" ? config.runConfig.modelRef : undefined,
      },
      scorerVersions: {
        heuristic: "1.0.0",
      },
      toolCalls,
      traceLinks,
      seedInfo: {
        caseId: evaluationCase.id,
        configId: config.id,
        repetition,
      },
    });
    return evidence;
  }

  private async executeSingleAttempt(
    evaluationCase: EvaluationCase,
    config: EvaluationConfig,
    repetition: number,
    evaluationRunId: string,
    spec: EvaluationSpec,
    executeRun: RunExecutor,
    langfuseExperimentName: string | undefined,
    dataset: EvaluationDatasetDetail
  ): Promise<{ attempt: EvaluationAttempt; annotationTasks: Array<Partial<EvaluationAnnotationTask>> }> {
    const attemptStartedAt = this.now();
    const timeoutMs = spec.timeoutMs ?? 120000;

    const runPromise = executeRun({
      input: {
        taskId: evaluationCase.id,
        prompt: evaluationCase.input.prompt,
        context: {
          ...evaluationCase.input.context,
          evaluationCaseId: evaluationCase.id,
          evaluationMetadata: evaluationCase.metadata,
          evaluationRunId,
          evaluationConfigId: config.id,
          evaluationProfileId: spec.profileId,
        },
        createdAt: attemptStartedAt,
      },
      config: {
        ...config.runConfig,
        metadata: {
          ...(config.runConfig.metadata ?? {}),
          evaluationRunId,
          evaluationCaseId: evaluationCase.id,
          evaluationConfigId: config.id,
          evaluationProfileId: spec.profileId,
        },
      },
    });

    let snapshot: StateSnapshot;
    if ((spec.timeoutMs ?? 0) > 0) {
      const timeoutPromise = new Promise<StateSnapshot>((_, reject) =>
        setTimeout(() => reject(new Error(`Attempt timed out after ${timeoutMs}ms`)), timeoutMs)
      );
      snapshot = await Promise.race([runPromise, timeoutPromise]);
    } else {
      snapshot = await runPromise;
    }

    const runtimeMs = Math.max(0, snapshot.updatedAt - (snapshot.events[0]?.createdAt ?? attemptStartedAt));
    const assessment = await this.scoreEvaluationAttempt(spec, evaluationCase, config, snapshot, runtimeMs);
    const evidence = this.buildAttemptEvidence(evaluationCase, config, repetition, snapshot, runtimeMs);
    const attemptStatus: EvaluationAttempt["status"] = snapshot.status === "failed" ? "failed" : "succeeded";

    const attempt = EvaluationAttemptSchema.parse({
      id: `${evaluationRunId}:attempt:${config.id}:${evaluationCase.id}:r${repetition}`,
      evaluationRunId,
      caseId: evaluationCase.id,
      configId: config.id,
      repetition,
      status: attemptStatus,
      underlyingRunId: snapshot.runId,
      output: assessment.output ?? snapshot.output,
      error: snapshot.error,
      score: assessment.score,
      metricScores: assessment.metricScores,
      evaluatorResults: assessment.evaluatorResults,
      observations: { ...assessment.observations, evidence },
      runtimeMs,
      costUsd: estimateCostUsd(snapshot),
      startedAt: attemptStartedAt,
      updatedAt: snapshot.updatedAt,
    });

    // Langfuse integration
    const traceMeta = getLangfuseRunTraceMetadata(snapshot.runId);
    const traceId = traceMeta?.traceId;
    if (traceId) {
      try {
        const scoreComment = attempt.evaluatorResults
          .filter((result) => result.evaluatorKind === "llm_judge" && result.rationale)
          .map((result) => `[${result.evaluatorId}] ${result.rationale}`)
          .join("\n") || undefined;
        const results = await Promise.all([
          scoreLangfuseTrace(traceId, "evaluation.overall", attempt.score.overallScore, { comment: scoreComment }),
          ...attempt.metricScores.map((metric) =>
            scoreLangfuseTrace(traceId, `evaluation.metric.${metric.metricId}`, metric.score)
          ),
          ...attempt.evaluatorResults
            .filter((result) => result.score !== undefined)
            .map((result) =>
              scoreLangfuseTrace(traceId, `evaluation.evaluator.${result.evaluatorId}`, result.score!, { comment: result.rationale })
            ),
        ]);
        attempt.langfuseScoreWriteStatus = results.every((r) => r.status === "succeeded") ? "succeeded" : "failed";
      } catch {
        attempt.langfuseScoreWriteStatus = "failed";
      }
      if (langfuseExperimentName) {
        await logLangfuseExperimentResult(langfuseExperimentName, evaluationCase.id, traceId);
      }
    } else {
      attempt.langfuseScoreWriteStatus = "failed";
    }

    return { attempt, annotationTasks: assessment.annotationTasks ?? [] };
  }

  private createFailedAttempt(
    evaluationCase: EvaluationCase,
    config: EvaluationConfig,
    repetition: number,
    evaluationRunId: string,
    spec: EvaluationSpec,
    error: unknown
  ): EvaluationAttempt {
    const now = this.now();
    const errorMessage = error instanceof Error ? error.message : String(error);
    const isTimeout = errorMessage.includes("timed out");
    const status: EvaluationAttempt["status"] = isTimeout ? "timeout" : "failed";
    const failureTag = isTimeout ? "attempt_timeout" : "execution_error";

    return EvaluationAttemptSchema.parse({
      id: `${evaluationRunId}:attempt:${config.id}:${evaluationCase.id}:r${repetition}`,
      evaluationRunId,
      caseId: evaluationCase.id,
      configId: config.id,
      repetition,
      status,
      error: errorMessage,
      score: {
        outcomeScore: 0,
        processScore: 0,
        efficiencyScore: 0,
        safetyScore: isTimeout ? 0.3 : 0.1,
        overallScore: 0,
        judgeRationale: `Execution failed: ${errorMessage}`,
        failureTags: [failureTag],
      },
      metricScores: [],
      evaluatorResults: [],
      observations: {
        evidence: this.buildAttemptEvidence(evaluationCase, config, repetition, {} as StateSnapshot, 0),
      },
      runtimeMs: 0,
      costUsd: 0,
      startedAt: now,
      updatedAt: now,
    });
  }

  private updateRunProgress(
    evaluationRunId: string,
    attempts: EvaluationAttempt[],
    dataset: EvaluationDatasetDetail,
    spec: EvaluationSpec,
    events: EvaluationStreamEvent[],
    startedAt: number
  ) {
    const run = this.runs.get(evaluationRunId);
    if (!run) return;
    const totalAttempts = dataset.cases.length * spec.configs.length * spec.repetitions;
    const failedAttempts = attempts.filter((a) => a.status === "failed" || a.status === "timeout").length;
    const succeededAttempts = attempts.filter((a) => a.status === "succeeded").length;
    const completedCount = failedAttempts + succeededAttempts;

    run.detail = EvaluationRunDetailSchema.parse({
      ...run.detail,
      run: EvaluationRunSchema.parse({
        ...run.detail.run,
        status: completedCount >= totalAttempts
          ? (failedAttempts === totalAttempts ? "failed" : "succeeded")
          : "running",
        totalAttempts,
        completedAttempts: completedCount,
        failedAttempts,
        attemptIds: attempts.map((a) => a.id),
        updatedAt: this.now(),
      }),
      attempts: [...attempts],
    });
    this.saveRun(evaluationRunId);
  }

  promoteBaseline(params: unknown): EvaluationBaseline {
    const parsed = EvaluationPromoteBaselineParamsSchema.parse(params);
    const run = this.runs.get(parsed.evaluationRunId);
    if (!run) {
      throw new Error(`Evaluation run not found: ${parsed.evaluationRunId}`);
    }
    const config = run.detail.configs.find((candidate) => candidate.id === parsed.configId);
    if (!config) {
      throw new Error(`Evaluation config not found: ${parsed.configId}`);
    }

    const baseline = EvaluationBaselineSchema.parse({
      id: this.nextBaselineId(),
      name: parsed.name?.trim() || `${run.detail.dataset.name} · ${config.label}`,
      datasetId: run.detail.run.spec.datasetId,
      profileId: run.detail.run.spec.profileId,
      configId: config.id,
      configSignature: signatureForConfig(config),
      evaluationRunId: run.detail.run.id,
      createdAt: this.now(),
    });
    this.baselines.set(baseline.id, baseline);
    this.saveBaseline(baseline);

    const event = EvaluationStreamEventSchema.parse({
      id: `${parsed.evaluationRunId}:evt-${run.events.length}`,
      evaluationRunId: parsed.evaluationRunId,
      seq: run.events.length,
      type: "evaluation.baseline.promoted",
      createdAt: this.now(),
      payload: baseline,
    });
    run.events.push(event);
    this.saveRun(parsed.evaluationRunId);
    return baseline;
  }

  exportRun(params: unknown): EvaluationExportResult {
    const parsed = EvaluationExportParamsSchema.parse(params);
    const run = this.getRun({ evaluationRunId: parsed.evaluationRunId });
    if (parsed.format === "json") {
      return EvaluationExportResultSchema.parse({
        evaluationRunId: parsed.evaluationRunId,
        format: "json",
        content: `${JSON.stringify(run, null, 2)}\n`,
      });
    }

    const rows = [
      "case_id,config_id,overall_score,outcome_score,process_score,efficiency_score,safety_score,failure_tags,trace_run_ids,metric_scores_json,evaluator_results_json,annotation_status,observations_json",
      ...run.run.caseResults.map((result) => [
        csvCell(result.caseId),
        csvCell(result.configId),
        result.averageScore.overallScore.toFixed(4),
        result.averageScore.outcomeScore.toFixed(4),
        result.averageScore.processScore.toFixed(4),
        result.averageScore.efficiencyScore.toFixed(4),
        result.averageScore.safetyScore.toFixed(4),
        csvCell(result.averageScore.failureTags.join("|")),
        csvCell(result.traceRunIds.join("|")),
        csvCell(JSON.stringify(result.metricScores)),
        csvCell(JSON.stringify(result.evaluatorResults)),
        csvCell(annotationStatusForResult(result.evaluatorResults)),
        csvCell(JSON.stringify(result.observations)),
      ].join(",")),
    ];
    return EvaluationExportResultSchema.parse({
      evaluationRunId: parsed.evaluationRunId,
      format: "csv",
      content: `${rows.join("\n")}\n`,
    });
  }

  generateReport(params: unknown): EvaluationReport {
    const parsed = EvaluationReportGenerateParamsSchema.parse(params);
    const run = this.getRun({ evaluationRunId: parsed.evaluationRunId });
    const now = this.now();

    const failures = run.run.caseResults
      .filter((result) => result.averageScore.overallScore < 0.75)
      .map((result) => ({
        caseId: result.caseId,
        configId: result.configId,
        failureTags: result.averageScore.failureTags,
        score: result.averageScore.overallScore,
        rationale: result.averageScore.judgeRationale || undefined,
      }));

    const traces = run.run.caseResults.flatMap((result) =>
      result.traceRunIds.map((runId) => ({
        caseId: result.caseId,
        configId: result.configId,
        runId,
      }))
    );

    const baselineDelta = run.run.caseResults.some((r) => r.comparisonToBaseline?.compatible)
      ? {
          baselineId: run.run.caseResults.find((r) => r.comparisonToBaseline?.compatible)?.comparisonToBaseline?.baselineId,
          overallDelta: roundScore(
            run.run.caseResults
              .filter((r) => r.comparisonToBaseline?.compatible)
              .reduce((sum, r) => sum + (r.comparisonToBaseline?.deltaOverallScore ?? 0), 0) /
            Math.max(1, run.run.caseResults.filter((r) => r.comparisonToBaseline?.compatible).length)
          ),
          regressionCount: run.run.scorecard.regressionCount,
        }
      : undefined;

    const recommendedActions: string[] = [];
    if (run.run.scorecard.passRate < 0.8) {
      recommendedActions.push("Pass rate below 80%: review failure clusters and consider prompt or mode adjustments.");
    }
    if (run.run.scorecard.regressionCount > 0) {
      recommendedActions.push(`${run.run.scorecard.regressionCount} regressions detected: compare against baseline results.`);
    }
    if (failures.length > 0) {
      const topTags = [...new Set(failures.flatMap((f) => f.failureTags))].slice(0, 5);
      if (topTags.length > 0) {
        recommendedActions.push(`Top failure tags: ${topTags.join(", ")}. Review relevant scorer rationales.`);
      }
    }

    return EvaluationReportSchema.parse({
      evaluationRunId: parsed.evaluationRunId,
      generatedAt: now,
      generatorVersion: "1.0.0",
      run: run.run,
      configs: run.configs,
      dataset: run.dataset,
      scorecard: run.run.scorecard,
      failures,
      slices: run.run.scorecard.slices,
      baselineDelta,
      traceLinks: traces,
      recommendedActions,
    });
  }

  formatReport(params: unknown): string {
    const parsed = EvaluationReportGenerateParamsSchema.parse(params);
    const report = this.generateReport({ evaluationRunId: parsed.evaluationRunId, format: "json" }) as EvaluationReport;
    if (parsed.format === "markdown") {
      return renderReportToMarkdown(report);
    }
    if (parsed.format === "html") {
      return renderReportToHtml(report);
    }
    return JSON.stringify(report, null, 2);
  }

  async submitFeedback(
    params: unknown,
    sourceContext: Record<string, unknown>,
    curateDraft?: FeedbackCurator
  ): Promise<EvaluationFeedbackRecord> {
    const parsed = EvaluationFeedbackSubmitParamsSchema.parse(params);
    const feedbackId = this.nextFeedbackId();
    const now = this.now();
    const draft = await this.curateFeedbackDraft(feedbackId, parsed.feedbackText, sourceContext, curateDraft);
    const record = EvaluationFeedbackRecordSchema.parse({
      id: feedbackId,
      status: draft.curatorStatus === "failed" ? "failed" : "pending",
      feedbackText: parsed.feedbackText.trim(),
      sourceRunId: parsed.runId,
      sourceSessionId: parsed.sessionId,
      sourceTurnIndex: parsed.turnIndex,
      sourceMessageId: parsed.messageId,
      sourceContext,
      draft,
      createdAt: now,
      updatedAt: now,
    });
    this.feedback.set(record.id, record);
    this.saveFeedback(record);
    return record;
  }

  listFeedback(params: unknown = {}): EvaluationFeedbackRecord[] {
    const parsed = EvaluationFeedbackListParamsSchema.parse(params);
    return [...this.feedback.values()]
      .filter((record) => parsed.status ? record.status === parsed.status : true)
      .sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id))
      .slice(0, parsed.limit)
      .map((record) => EvaluationFeedbackRecordSchema.parse(record));
  }

  getFeedback(params: unknown): EvaluationFeedbackRecord {
    const parsed = EvaluationFeedbackGetParamsSchema.parse(params);
    const record = this.feedback.get(parsed.feedbackId);
    if (!record) {
      throw new Error(`Evaluation feedback not found: ${parsed.feedbackId}`);
    }
    return EvaluationFeedbackRecordSchema.parse(record);
  }

  updateFeedback(params: unknown): EvaluationFeedbackRecord {
    const parsed = EvaluationFeedbackUpdateParamsSchema.parse(params);
    const record = this.getFeedback({ feedbackId: parsed.feedbackId });
    if (record.status === "accepted" || record.status === "rejected") {
      throw new Error(`Evaluation feedback ${record.id} is already ${record.status}.`);
    }
    const next = EvaluationFeedbackRecordSchema.parse({
      ...record,
      feedbackText: parsed.feedbackText?.trim() ?? record.feedbackText,
      draft: parsed.draftCase
        ? {
            ...record.draft,
            case: parsed.draftCase,
            curatorStatus: "generated",
            curatorRationale: parsed.curatorRationale ?? record.draft.curatorRationale,
            error: undefined,
          }
        : record.draft,
      status: "pending",
      updatedAt: this.now(),
    });
    this.feedback.set(next.id, next);
    this.saveFeedback(next);
    return next;
  }

  acceptFeedback(params: unknown): EvaluationFeedbackRecord {
    const parsed = EvaluationFeedbackAcceptParamsSchema.parse(params);
    const record = this.getFeedback({ feedbackId: parsed.feedbackId });
    if (record.status === "accepted") {
      return record;
    }
    if (record.status === "rejected") {
      throw new Error(`Evaluation feedback ${record.id} was rejected and cannot be accepted.`);
    }
    const datasetId = parsed.datasetId ?? FEEDBACK_DATASET_ID;
    const caseRecord = EvaluationCaseSchema.parse({
      ...record.draft.case,
      metadata: {
        ...record.draft.case.metadata,
        feedbackId: record.id,
        source: "chat_feedback",
        sourceRunId: record.sourceRunId,
        sourceSessionId: record.sourceSessionId,
        sourceTurnIndex: record.sourceTurnIndex,
      },
    });
    this.appendCaseToFeedbackDataset(datasetId, caseRecord);
    const next = EvaluationFeedbackRecordSchema.parse({
      ...record,
      status: "accepted",
      datasetId,
      acceptedCaseId: caseRecord.id,
      updatedAt: this.now(),
    });
    this.feedback.set(next.id, next);
    this.saveFeedback(next);
    return next;
  }

  rejectFeedback(params: unknown): EvaluationFeedbackRecord {
    const parsed = EvaluationFeedbackRejectParamsSchema.parse(params);
    const record = this.getFeedback({ feedbackId: parsed.feedbackId });
    if (record.status === "accepted") {
      throw new Error(`Evaluation feedback ${record.id} is already accepted.`);
    }
    const next = EvaluationFeedbackRecordSchema.parse({
      ...record,
      status: "rejected",
      rejectionReason: parsed.reason?.trim(),
      updatedAt: this.now(),
    });
    this.feedback.set(next.id, next);
    this.saveFeedback(next);
    return next;
  }

  private applyAnnotationToRun(annotation: EvaluationAnnotationTask) {
    const persisted = this.runs.get(annotation.evaluationRunId);
    if (!persisted) return;
    const normalizedScore = normalizedAnnotationScore(annotation.score);
    const evaluatorResult = EvaluationEvaluatorResultSchema.parse({
      evaluatorId: annotation.evaluatorId,
      evaluatorKind: "human_annotation",
      score: normalizedScore,
      passed: annotation.score?.passed ?? normalizedScore >= 0.75,
      rationale: annotation.comment ?? "Human annotation submitted.",
      failureTags: annotation.score?.failureTags ?? [],
      status: "scored",
      details: {
        annotationTaskId: annotation.id,
        rawScore: annotation.score?.value,
        correctedOutput: annotation.correctedOutput,
      },
    });
    const updateEvaluatorResults = (results: EvaluationEvaluatorResult[]) => [
      ...results.filter((result) => result.evaluatorId !== annotation.evaluatorId),
      evaluatorResult,
    ];
    const attempts = persisted.detail.attempts.map((attempt) => {
      if (attempt.id !== annotation.attemptId) return attempt;
      const evaluatorResults = updateEvaluatorResults(attempt.evaluatorResults);
      return EvaluationAttemptSchema.parse({
        ...attempt,
        evaluatorResults,
        score: scoreFromEvaluatorResults(evaluatorResults.filter((result) => typeof result.score === "number"), persisted.detail.run.spec.profileId, attempt.status === "failed"),
        updatedAt: this.now(),
      });
    });
    const caseResults = persisted.detail.run.caseResults.map((result) => {
      if (result.caseId !== annotation.caseId || result.configId !== annotation.configId) return result;
      const evaluatorResults = updateEvaluatorResults(result.evaluatorResults);
      return EvaluationCaseResultSchema.parse({
        ...result,
        evaluatorResults,
        averageScore: scoreFromEvaluatorResults(evaluatorResults.filter((candidate) => typeof candidate.score === "number"), persisted.detail.run.spec.profileId, false),
      });
    });
    const scorecard = buildScorecard(persisted.detail.configs, attempts, caseResults);
    persisted.detail = EvaluationRunDetailSchema.parse({
      ...persisted.detail,
      attempts,
      run: {
        ...persisted.detail.run,
        caseResults,
        scorecard,
        updatedAt: this.now(),
      },
    });
    persisted.events.push(EvaluationStreamEventSchema.parse({
      id: `${annotation.evaluationRunId}:evt-${persisted.events.length}`,
      evaluationRunId: annotation.evaluationRunId,
      seq: persisted.events.length,
      type: "evaluation.annotation.submitted",
      createdAt: this.now(),
      payload: { annotationTaskId: annotation.id, attemptId: annotation.attemptId },
    }));
    this.saveRun(annotation.evaluationRunId);
  }

  private loadAll() {
    if (this.storage === "sqlite") {
      this.loadAllFromSqlite();
      return;
    }
    for (const name of fs.readdirSync(this.datasetsDir).filter((entry) => entry.endsWith(".json"))) {
      const detail = this.readJsonFile(path.join(this.datasetsDir, name), EvaluationDatasetDetailSchema);
      this.datasets.set(detail.dataset.id, detail);
    }
    for (const name of fs.readdirSync(this.runsDir).filter((entry) => entry.endsWith(".json"))) {
      const run = this.readJsonFile(path.join(this.runsDir, name), PersistedEvaluationRunSchema);
      this.runs.set(run.detail.run.id, run);
    }
    for (const name of fs.readdirSync(this.baselinesDir).filter((entry) => entry.endsWith(".json"))) {
      const baseline = this.readJsonFile(path.join(this.baselinesDir, name), EvaluationBaselineSchema);
      this.baselines.set(baseline.id, baseline);
    }
    for (const name of fs.readdirSync(this.feedbackDir).filter((entry) => entry.endsWith(".json"))) {
      const record = this.readJsonFile(path.join(this.feedbackDir, name), EvaluationFeedbackRecordSchema);
      this.feedback.set(record.id, record);
    }
    for (const name of fs.readdirSync(this.blueprintsDir).filter((entry) => entry.endsWith(".json"))) {
      const blueprint = this.readJsonFile(path.join(this.blueprintsDir, name), EvaluationBlueprintSchema);
      this.blueprints.set(blueprint.id, blueprint);
    }
    for (const name of fs.readdirSync(this.annotationsDir).filter((entry) => entry.endsWith(".json"))) {
      const annotation = this.readJsonFile(path.join(this.annotationsDir, name), EvaluationAnnotationTaskSchema);
      this.annotations.set(annotation.id, annotation);
    }
    this.manifest = EvaluationManifestSchema.parse({
      ...this.manifest,
      nextDatasetNumber: Math.max(this.manifest.nextDatasetNumber, nextCounter([...this.datasets.keys()], /^dataset-(\d+)$/)),
      nextEvaluationRunNumber: Math.max(this.manifest.nextEvaluationRunNumber, nextCounter([...this.runs.keys()], /^eval-run-(\d+)$/)),
      nextBaselineNumber: Math.max(this.manifest.nextBaselineNumber, nextCounter([...this.baselines.keys()], /^baseline-(\d+)$/)),
      nextFeedbackNumber: Math.max(this.manifest.nextFeedbackNumber, nextCounter([...this.feedback.keys()], /^feedback-(\d+)$/)),
      nextBlueprintNumber: Math.max(this.manifest.nextBlueprintNumber, nextCounter([...this.blueprints.keys()], /^blueprint-(\d+)$/)),
      nextAnnotationNumber: Math.max(this.manifest.nextAnnotationNumber, nextCounter([...this.annotations.keys()], /^annotation-(\d+)$/)),
    });
  }

  private ensureDirs() {
    fs.mkdirSync(this.datasetsDir, { recursive: true });
    fs.mkdirSync(this.runsDir, { recursive: true });
    fs.mkdirSync(this.baselinesDir, { recursive: true });
    fs.mkdirSync(this.feedbackDir, { recursive: true });
    fs.mkdirSync(this.blueprintsDir, { recursive: true });
    fs.mkdirSync(this.annotationsDir, { recursive: true });
  }

  private ensureSqliteSchema() {
    const db = this.requireDb();
    db.exec(CREATE_EVALUATION_MANIFEST_TABLE);
    db.exec(CREATE_EVALUATION_DATASETS_TABLE);
    db.exec(CREATE_EVALUATION_RUNS_TABLE);
    db.exec(CREATE_EVALUATION_BASELINES_TABLE);
    db.exec(CREATE_EVALUATION_FEEDBACK_TABLE);
    db.exec(CREATE_EVALUATION_BLUEPRINTS_TABLE);
    db.exec(CREATE_EVALUATION_ANNOTATIONS_TABLE);
  }

  private loadAllFromSqlite() {
    const db = this.requireDb();
    const datasetRows = db.prepare("SELECT data FROM evaluation_datasets").all() as { data: string }[];
    for (const row of datasetRows) {
      const detail = EvaluationDatasetDetailSchema.parse(JSON.parse(row.data));
      this.datasets.set(detail.dataset.id, detail);
    }
    const runRows = db.prepare("SELECT data FROM evaluation_runs").all() as { data: string }[];
    for (const row of runRows) {
      const run = PersistedEvaluationRunSchema.parse(JSON.parse(row.data));
      this.runs.set(run.detail.run.id, run);
    }
    const baselineRows = db.prepare("SELECT data FROM evaluation_baselines").all() as { data: string }[];
    for (const row of baselineRows) {
      const baseline = EvaluationBaselineSchema.parse(JSON.parse(row.data));
      this.baselines.set(baseline.id, baseline);
    }
    const feedbackRows = db.prepare("SELECT data FROM evaluation_feedback").all() as { data: string }[];
    for (const row of feedbackRows) {
      const record = EvaluationFeedbackRecordSchema.parse(JSON.parse(row.data));
      this.feedback.set(record.id, record);
    }
    const blueprintRows = db.prepare("SELECT data FROM evaluation_blueprints").all() as { data: string }[];
    for (const row of blueprintRows) {
      const blueprint = EvaluationBlueprintSchema.parse(JSON.parse(row.data));
      this.blueprints.set(blueprint.id, blueprint);
    }
    const annotationRows = db.prepare("SELECT data FROM evaluation_annotations").all() as { data: string }[];
    for (const row of annotationRows) {
      const annotation = EvaluationAnnotationTaskSchema.parse(JSON.parse(row.data));
      this.annotations.set(annotation.id, annotation);
    }
    this.manifest = EvaluationManifestSchema.parse({
      ...this.manifest,
      nextDatasetNumber: Math.max(this.manifest.nextDatasetNumber, nextCounter([...this.datasets.keys()], /^dataset-(\d+)$/)),
      nextEvaluationRunNumber: Math.max(this.manifest.nextEvaluationRunNumber, nextCounter([...this.runs.keys()], /^eval-run-(\d+)$/)),
      nextBaselineNumber: Math.max(this.manifest.nextBaselineNumber, nextCounter([...this.baselines.keys()], /^baseline-(\d+)$/)),
      nextFeedbackNumber: Math.max(this.manifest.nextFeedbackNumber, nextCounter([...this.feedback.keys()], /^feedback-(\d+)$/)),
      nextBlueprintNumber: Math.max(this.manifest.nextBlueprintNumber, nextCounter([...this.blueprints.keys()], /^blueprint-(\d+)$/)),
      nextAnnotationNumber: Math.max(this.manifest.nextAnnotationNumber, nextCounter([...this.annotations.keys()], /^annotation-(\d+)$/)),
    });
    this.migrateLegacyFileStoreIntoSqlite();
  }

  private migrateLegacyFileStoreIntoSqlite() {
    const legacyDir = path.join(path.dirname(this.baseDir), "evaluation-store");
    if (!fs.existsSync(legacyDir)) {
      return;
    }

    const loadLegacy = <T>(subdir: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>): T[] => {
      const dir = path.join(legacyDir, subdir);
      if (!fs.existsSync(dir)) {
        return [];
      }
      return fs.readdirSync(dir)
        .filter((entry) => entry.endsWith(".json"))
        .map((entry) => this.readJsonFile(path.join(dir, entry), schema));
    };

    for (const detail of loadLegacy("datasets", EvaluationDatasetDetailSchema)) {
      if (!this.datasets.has(detail.dataset.id)) {
        this.datasets.set(detail.dataset.id, detail);
        this.saveDataset(detail);
      }
    }
    for (const run of loadLegacy("runs", PersistedEvaluationRunSchema)) {
      if (!this.runs.has(run.detail.run.id)) {
        this.runs.set(run.detail.run.id, run);
        this.saveRun(run.detail.run.id);
      }
    }
    for (const baseline of loadLegacy("baselines", EvaluationBaselineSchema)) {
      if (!this.baselines.has(baseline.id)) {
        this.baselines.set(baseline.id, baseline);
        this.saveBaseline(baseline);
      }
    }
    for (const record of loadLegacy("feedback", EvaluationFeedbackRecordSchema)) {
      if (!this.feedback.has(record.id)) {
        this.feedback.set(record.id, record);
        this.saveFeedback(record);
      }
    }
    for (const blueprint of loadLegacy("blueprints", EvaluationBlueprintSchema)) {
      if (!this.blueprints.has(blueprint.id)) {
        this.blueprints.set(blueprint.id, blueprint);
        this.saveBlueprint(blueprint);
      }
    }
    for (const annotation of loadLegacy("annotations", EvaluationAnnotationTaskSchema)) {
      if (!this.annotations.has(annotation.id)) {
        this.annotations.set(annotation.id, annotation);
        this.saveAnnotation(annotation);
      }
    }
    this.manifest = EvaluationManifestSchema.parse({
      ...this.manifest,
      nextDatasetNumber: Math.max(this.manifest.nextDatasetNumber, nextCounter([...this.datasets.keys()], /^dataset-(\d+)$/)),
      nextEvaluationRunNumber: Math.max(this.manifest.nextEvaluationRunNumber, nextCounter([...this.runs.keys()], /^eval-run-(\d+)$/)),
      nextBaselineNumber: Math.max(this.manifest.nextBaselineNumber, nextCounter([...this.baselines.keys()], /^baseline-(\d+)$/)),
      nextFeedbackNumber: Math.max(this.manifest.nextFeedbackNumber, nextCounter([...this.feedback.keys()], /^feedback-(\d+)$/)),
      nextBlueprintNumber: Math.max(this.manifest.nextBlueprintNumber, nextCounter([...this.blueprints.keys()], /^blueprint-(\d+)$/)),
      nextAnnotationNumber: Math.max(this.manifest.nextAnnotationNumber, nextCounter([...this.annotations.keys()], /^annotation-(\d+)$/)),
    });
    this.saveManifest();
  }

  private nextDatasetId() {
    const id = `dataset-${String(this.manifest.nextDatasetNumber).padStart(4, "0")}`;
    this.manifest.nextDatasetNumber += 1;
    this.saveManifest();
    return id;
  }

  private nextEvaluationRunId() {
    const id = `eval-run-${String(this.manifest.nextEvaluationRunNumber).padStart(4, "0")}`;
    this.manifest.nextEvaluationRunNumber += 1;
    this.saveManifest();
    return id;
  }

  private nextBaselineId() {
    const id = `baseline-${String(this.manifest.nextBaselineNumber).padStart(4, "0")}`;
    this.manifest.nextBaselineNumber += 1;
    this.saveManifest();
    return id;
  }

  private nextFeedbackId() {
    const id = `feedback-${String(this.manifest.nextFeedbackNumber).padStart(4, "0")}`;
    this.manifest.nextFeedbackNumber += 1;
    this.saveManifest();
    return id;
  }

  private nextBlueprintId() {
    const id = `blueprint-${String(this.manifest.nextBlueprintNumber).padStart(4, "0")}`;
    this.manifest.nextBlueprintNumber += 1;
    this.saveManifest();
    return id;
  }

  private nextAnnotationId() {
    const id = `annotation-${String(this.manifest.nextAnnotationNumber).padStart(4, "0")}`;
    this.manifest.nextAnnotationNumber += 1;
    this.saveManifest();
    return id;
  }

  private saveManifest() {
    if (this.storage === "sqlite") {
      this.writeSqliteManifest(EvaluationManifestSchema.parse(this.manifest));
      return;
    }
    this.writeJsonFile(this.manifestPath, EvaluationManifestSchema.parse(this.manifest));
  }

  private saveDataset(detail: EvaluationDatasetDetail) {
    if (this.storage === "sqlite") {
      this.requireDb().prepare(
        "INSERT INTO evaluation_datasets (id, updatedAt, data) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET updatedAt = excluded.updatedAt, data = excluded.data"
      ).run(detail.dataset.id, detail.dataset.updatedAt, JSON.stringify(EvaluationDatasetDetailSchema.parse(detail)));
      return;
    }
    this.writeJsonFile(path.join(this.datasetsDir, `${encodeURIComponent(detail.dataset.id)}.json`), detail);
  }

  private saveRun(evaluationRunId: string) {
    const run = this.runs.get(evaluationRunId);
    if (!run) return;
    if (this.storage === "sqlite") {
      this.requireDb().prepare(
        "INSERT INTO evaluation_runs (id, datasetId, profileId, updatedAt, data) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET datasetId = excluded.datasetId, profileId = excluded.profileId, updatedAt = excluded.updatedAt, data = excluded.data"
      ).run(
        evaluationRunId,
        run.detail.run.spec.datasetId,
        run.detail.run.spec.profileId,
        run.detail.run.updatedAt,
        JSON.stringify(PersistedEvaluationRunSchema.parse(run)),
      );
      return;
    }
    this.writeJsonFile(path.join(this.runsDir, `${encodeURIComponent(evaluationRunId)}.json`), PersistedEvaluationRunSchema.parse(run));
  }

  private saveBaseline(baseline: EvaluationBaseline) {
    if (this.storage === "sqlite") {
      this.requireDb().prepare(
        "INSERT INTO evaluation_baselines (id, datasetId, profileId, createdAt, data) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET datasetId = excluded.datasetId, profileId = excluded.profileId, createdAt = excluded.createdAt, data = excluded.data"
      ).run(
        baseline.id,
        baseline.datasetId,
        baseline.profileId,
        baseline.createdAt,
        JSON.stringify(EvaluationBaselineSchema.parse(baseline)),
      );
      return;
    }
    this.writeJsonFile(path.join(this.baselinesDir, `${encodeURIComponent(baseline.id)}.json`), baseline);
  }

  private saveFeedback(record: EvaluationFeedbackRecord) {
    if (this.storage === "sqlite") {
      this.requireDb().prepare(
        "INSERT INTO evaluation_feedback (id, status, updatedAt, data) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET status = excluded.status, updatedAt = excluded.updatedAt, data = excluded.data"
      ).run(record.id, record.status, record.updatedAt, JSON.stringify(EvaluationFeedbackRecordSchema.parse(record)));
      return;
    }
    this.writeJsonFile(path.join(this.feedbackDir, `${encodeURIComponent(record.id)}.json`), record);
  }

  private saveBlueprint(blueprint: EvaluationBlueprint) {
    if (this.storage === "sqlite") {
      this.requireDb().prepare(
        "INSERT INTO evaluation_blueprints (id, recipe, status, updatedAt, data) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET recipe = excluded.recipe, status = excluded.status, updatedAt = excluded.updatedAt, data = excluded.data"
      ).run(
        blueprint.id,
        blueprint.recipe,
        blueprint.status,
        blueprint.updatedAt,
        JSON.stringify(EvaluationBlueprintSchema.parse(blueprint)),
      );
      return;
    }
    this.writeJsonFile(path.join(this.blueprintsDir, `${encodeURIComponent(blueprint.id)}.json`), blueprint);
  }

  private saveAnnotation(annotation: EvaluationAnnotationTask) {
    if (this.storage === "sqlite") {
      this.requireDb().prepare(
        "INSERT INTO evaluation_annotations (id, evaluationRunId, status, updatedAt, data) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET evaluationRunId = excluded.evaluationRunId, status = excluded.status, updatedAt = excluded.updatedAt, data = excluded.data"
      ).run(
        annotation.id,
        annotation.evaluationRunId,
        annotation.status,
        annotation.updatedAt,
        JSON.stringify(EvaluationAnnotationTaskSchema.parse(annotation)),
      );
      return;
    }
    this.writeJsonFile(path.join(this.annotationsDir, `${encodeURIComponent(annotation.id)}.json`), annotation);
  }

  private async curateFeedbackDraft(
    feedbackId: string,
    feedbackText: string,
    sourceContext: Record<string, unknown>,
    curateDraft?: FeedbackCurator
  ): Promise<EvaluationFeedbackDraftCase> {
    if (!curateDraft) {
      return fallbackFeedbackDraft(feedbackId, feedbackText, sourceContext);
    }
    try {
      return EvaluationFeedbackDraftCaseSchema.parse(await curateDraft({ feedbackId, feedbackText, sourceContext }));
    } catch (error) {
      return fallbackFeedbackDraft(feedbackId, feedbackText, sourceContext, error instanceof Error ? error.message : String(error));
    }
  }

  private appendCaseToFeedbackDataset(datasetId: string, evaluationCase: EvaluationCase) {
    const current = this.datasets.get(datasetId) ?? this.createFeedbackDataset(datasetId);
    if (current.cases.some((candidate) => candidate.id === evaluationCase.id)) {
      throw new Error(`Evaluation feedback case already exists: ${evaluationCase.id}`);
    }
    const nextCases = [...current.cases, evaluationCase];
    const nextDetail = EvaluationDatasetDetailSchema.parse({
      dataset: {
        ...current.dataset,
        caseCount: nextCases.length,
        updatedAt: this.now(),
      },
      cases: nextCases,
      metadataKeys: collectMetadataKeys(nextCases),
      tagCounts: collectTagCounts(nextCases),
    });
    this.datasets.set(datasetId, nextDetail);
    this.saveDataset(nextDetail);
  }

  private createFeedbackDataset(datasetId: string): EvaluationDatasetDetail {
    const now = this.now();
    const dataset = EvaluationDatasetSchema.parse({
      id: datasetId,
      name: "Chat Feedback",
      description: "Accepted natural-language chat feedback converted into evaluation cases.",
      sourceFileName: `${datasetId}.json`,
      sourceFormat: "inline",
      schemaVersion: 1,
      caseCount: 0,
      tags: ["chat_feedback"],
      createdAt: now,
      updatedAt: now,
    });
    const detail = EvaluationDatasetDetailSchema.parse({
      dataset,
      cases: [],
      metadataKeys: [],
      tagCounts: {},
    });
    this.datasets.set(datasetId, detail);
    this.saveDataset(detail);
    return detail;
  }

  private readJsonFile<T>(filePath: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>, fallback?: T): T {
    if (!fs.existsSync(filePath)) {
      if (fallback !== undefined) {
        return fallback;
      }
      throw new Error(`Missing evaluation runtime file: ${filePath}`);
    }
    return schema.parse(JSON.parse(fs.readFileSync(filePath, "utf8")));
  }

  private writeJsonFile(filePath: string, value: unknown) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    fs.renameSync(tempPath, filePath);
  }

  private readSqliteManifest(): EvaluationManifest {
    const row = this.requireDb().prepare("SELECT data FROM evaluation_manifest WHERE id = 1").get() as { data: string } | undefined;
    if (!row) {
      const manifest = EvaluationManifestSchema.parse({});
      this.writeSqliteManifest(manifest);
      return manifest;
    }
    return EvaluationManifestSchema.parse(JSON.parse(row.data));
  }

  private writeSqliteManifest(manifest: EvaluationManifest) {
    this.requireDb().prepare(
      "INSERT INTO evaluation_manifest (id, data) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data"
    ).run(JSON.stringify(EvaluationManifestSchema.parse(manifest)));
  }

  private requireDb(): Database.Database {
    if (!this.db) {
      throw new Error("Evaluation SQLite database is not initialized.");
    }
    return this.db;
  }

  private now() {
    return this.clock();
  }
}

function inferDatasetFormat(fileName?: string) {
  const lowered = fileName?.toLowerCase() ?? "";
  if (lowered.endsWith(".jsonl")) return "jsonl";
  if (lowered.endsWith(".csv")) return "csv";
  if (lowered.endsWith(".json")) return "json";
  return "inline";
}

function normalizeEvaluatorPlan(plan: EvaluationBlueprint["evaluatorPlan"]): EvaluationBlueprint["evaluatorPlan"] {
  const evaluators = plan.evaluators.length > 0
    ? plan.evaluators
    : [{
        id: "heuristic",
        kind: "heuristic" as const,
        label: "Heuristic Rules",
        metrics: plan.metrics,
        assertions: plan.assertions,
        weight: 1,
        metadata: {},
      }];
  return {
    ...plan,
    evaluators,
  };
}

function plannerMessagesFromBlueprint(blueprint: EvaluationBlueprint) {
  const raw = blueprint.reviewPlan.metadata.plannerMessages;
  if (!Array.isArray(raw)) return [];
  return raw.filter((message): message is { id: string; role: "user" | "assistant"; content: string; createdAt: number } => (
    message &&
    typeof message === "object" &&
    typeof (message as Record<string, unknown>).id === "string" &&
    ((message as Record<string, unknown>).role === "user" || (message as Record<string, unknown>).role === "assistant") &&
    typeof (message as Record<string, unknown>).content === "string" &&
    typeof (message as Record<string, unknown>).createdAt === "number"
  ));
}

function deterministicPlanBlueprintTurn(base: EvaluationBlueprint, message: string, providerError?: string): EvaluationBlueprint {
  const lowered = message.toLowerCase();
  const wantsHuman = lowered.includes("人工") || lowered.includes("human") || lowered.includes("annotat") || lowered.includes("标注");
  const wantsJudge = lowered.includes("llm") || lowered.includes("judge") || lowered.includes("rubric") || lowered.includes("裁判");
  const wantsRouter = lowered.includes("router") || lowered.includes("路由") || lowered.includes("auto mode");
  const recipe = wantsRouter ? "auto_router_quality" : base.recipe;
  const target = wantsRouter ? "runtime.mode_selection" : base.target;
  const evaluators: EvaluationEvaluatorSpec[] = [
    {
      id: "heuristic",
      kind: "heuristic",
      label: "Heuristic Rules",
      metrics: recipe === "auto_router_quality"
        ? ["exact_match", "acceptable_match", "assertion_pass_rate", "fallback_rate", "confidence_calibration"]
        : base.evaluatorPlan.metrics.length > 0 ? base.evaluatorPlan.metrics : ["text_similarity", "assertion_pass_rate", "latency_score", "cost_score"],
      assertions: base.evaluatorPlan.assertions,
      weight: 1,
      metadata: {},
    },
    ...(wantsJudge ? [{
      id: "llm-judge",
      kind: "llm_judge" as const,
      label: "LLM Judge",
      rubric: base.evaluatorPlan.judgeRubric ?? "Score whether the output satisfies the evaluation goal, expected result, and case-specific constraints.",
      providerId: base.runPlan.providerId,
      modelRef: base.runPlan.modelRef,
      passThreshold: 0.75,
      weight: 1,
      metadata: {},
    }] : []),
    ...(wantsHuman ? [{
      id: "human-review",
      kind: "human_annotation" as const,
      label: "Human Annotation",
      instructions: "Review the case output against the goal and expected result. Mark whether it should pass and add a short comment.",
      scoreType: "numeric" as const,
      weight: 1,
      categories: [],
      metadata: {},
    }] : []),
  ];
  return EvaluationBlueprintSchema.parse({
    ...base,
    goal: message.trim(),
    recipe,
    target,
    evaluatorPlan: {
      ...base.evaluatorPlan,
      evaluators,
      judgeRubric: wantsJudge ? "Score 0-1. Pass requires satisfying the goal and avoiding the listed failure modes." : base.evaluatorPlan.judgeRubric,
      notes: "Planner updated this blueprint from the latest conversation turn.",
    },
    subject: wantsRouter ? { kind: "auto_router" } : base.subject,
    datasetPlan: {
      ...base.datasetPlan,
      sources: base.datasetPlan.datasetId ? ["existing_dataset"] : [...new Set([...base.datasetPlan.sources, "feedback_inbox", "manual"])],
    },
    assumptions: [
      ...base.assumptions,
      ...(providerError ? [`Planner provider unavailable; deterministic fallback used: ${providerError}`] : []),
    ],
  });
}

function summarizeBlueprintPlan(blueprint: EvaluationBlueprint) {
  const evaluators = normalizeEvaluatorPlan(blueprint.evaluatorPlan).evaluators.map((evaluator) => evaluator.kind).join(", ");
  const missing = blueprint.missingInformation.length > 0 ? ` Missing: ${blueprint.missingInformation.join("; ")}` : "";
  return `I drafted ${blueprint.title}: ${blueprint.recipe} targeting ${blueprint.target}. Evaluators: ${evaluators}.${missing}`;
}

function evaluatorsForSpec(spec: EvaluationSpec): EvaluationEvaluatorSpec[] {
  const explicit = spec.objective?.evaluators ?? [];
  if (explicit.length > 0) return explicit;
  if (!spec.objective) return [];
  return [{
    id: "heuristic",
    kind: "heuristic",
    label: "Heuristic Rules",
    metrics: spec.objective.metrics,
    assertions: spec.objective.assertions,
    weight: 1,
    metadata: {},
  }];
}

function scoreFromEvaluatorResults(results: EvaluationEvaluatorResult[], profileId: EvaluationProfileKind, runtimeFailed: boolean): EvaluationScore {
  const scored = results.filter((result) => typeof result.score === "number");
  if (scored.length === 0) {
    return aggregateMetricScores([], profileId, runtimeFailed);
  }
  const outcomeScore = roundScore(average(scored.map((result) => result.score ?? 0)));
  const failureTags = [...new Set(scored.flatMap((result) => result.failureTags))];
  const safetyScore = runtimeFailed ? 0.2 : failureTags.some((tag) => tag.includes("safety")) ? 0.55 : 0.92;
  const weights = profileWeights(profileId);
  return EvaluationScoreSchema.parse({
    outcomeScore,
    processScore: outcomeScore,
    efficiencyScore: runtimeFailed ? 0.25 : 0.9,
    safetyScore,
    overallScore: roundScore(
      outcomeScore * weights.outcome +
      outcomeScore * weights.process +
      (runtimeFailed ? 0.25 : 0.9) * weights.efficiency +
      safetyScore * weights.safety
    ),
    judgeRationale: scored.map((result) => `${result.evaluatorId}: ${result.rationale ?? "scored"}`).join(" "),
    failureTags,
  });
}

function normalizedAnnotationScore(score: EvaluationAnnotationTask["score"]): number {
  if (!score) return 0;
  if (typeof score.normalizedScore === "number") return score.normalizedScore;
  if (typeof score.value === "boolean") return score.value ? 1 : 0;
  if (typeof score.value === "number") return score.value;
  return score.passed ? 1 : 0;
}

function annotationStatusForResult(results: EvaluationEvaluatorResult[]) {
  if (results.some((result) => result.evaluatorKind === "human_annotation" && result.status === "pending")) {
    return "pending";
  }
  if (results.some((result) => result.evaluatorKind === "human_annotation" && result.status === "scored")) {
    return "submitted";
  }
  return "";
}

function compileEvaluationBlueprint(
  blueprint: EvaluationBlueprint,
  overrides: {
    datasetId?: string;
    providerId?: string;
    modelRef?: string;
    modeIds?: string[];
  } = {}
): EvaluationBlueprintCompileResult {
  const datasetId = overrides.datasetId ?? blueprint.datasetPlan.datasetId ?? blueprint.datasetPlan.linkedDatasetIds[0];
  if (!datasetId) {
    throw new Error(`Evaluation blueprint ${blueprint.id} is missing a dataset.`);
  }

  const providerId = overrides.providerId ?? blueprint.runPlan.providerId ?? "local-smoke";
  const modelRef = overrides.modelRef ?? blueprint.runPlan.modelRef ?? "local/smoke-model";
  const evaluatorPlan = normalizeEvaluatorPlan(blueprint.evaluatorPlan);
  const baseMetadata = {
    blueprintId: blueprint.id,
    blueprintRecipe: blueprint.recipe,
    blueprintTitle: blueprint.title,
  };

  if (blueprint.recipe === "auto_router_quality") {
    const spec = EvaluationSpecSchema.parse({
      datasetId,
      profileId: blueprint.runPlan.profileId,
      objective: {
        kind: "classification",
        target: "runtime.mode_selection",
        metrics: evaluatorPlan.metrics.length > 0
          ? evaluatorPlan.metrics
          : ["exact_match", "acceptable_match", "assertion_pass_rate", "fallback_rate", "confidence_calibration"],
        assertions: evaluatorPlan.assertions,
        evaluators: evaluatorPlan.evaluators,
        displayColumns: [
          "runtime.modeId",
          "runtime.autoModeRouter.status",
          "runtime.autoModeRouter.confidence",
          "runtime.autoModeRouter.reason",
        ],
        metadata: { blueprintId: blueprint.id },
      },
      configs: [{
        id: `auto-router-${providerId}`,
        label: `Auto Router · ${providerId}`,
        runConfig: {
          pattern: "orchestrator_subagent",
          modeSelection: "auto",
          providerId,
          modelRef,
          providerConfig: blueprint.runPlan.providerConfig,
          metadata: {
            ...baseMetadata,
            providerId,
            evaluationRouterOnly: true,
          },
        },
      }],
      repetitions: blueprint.runPlan.repetitions,
      concurrency: blueprint.runPlan.concurrency,
      timeoutMs: blueprint.runPlan.timeoutMs,
      baselineId: blueprint.runPlan.baselineId,
      metadata: {
        ...baseMetadata,
        gateThreshold: blueprint.runPlan.gateThreshold,
      },
    });
    return EvaluationBlueprintCompileResultSchema.parse({
      blueprint,
      spec,
      warnings: [],
      assumptions: blueprint.assumptions,
    });
  }

  if (blueprint.recipe === "mode_comparison") {
    const subjectModeIds = blueprint.subject.kind === "mode_matrix" ? blueprint.subject.modeIds : [];
    const modeIds = overrides.modeIds ?? subjectModeIds;
    if (modeIds.length === 0) {
      throw new Error(`Evaluation blueprint ${blueprint.id} needs at least one Agent mode.`);
    }
    const spec = EvaluationSpecSchema.parse({
      datasetId,
      profileId: blueprint.runPlan.profileId,
      configs: modeIds.map((modeId) => ({
        id: `${modeId}-${providerId}`,
        label: `${modeId.replace(/_/g, " ")} · ${providerId}`,
        runConfig: {
          pattern: modeId,
          providerId,
          modelRef,
          providerConfig: blueprint.runPlan.providerConfig,
          metadata: baseMetadata,
        },
      })),
      repetitions: blueprint.runPlan.repetitions,
      concurrency: blueprint.runPlan.concurrency,
      timeoutMs: blueprint.runPlan.timeoutMs,
      baselineId: blueprint.runPlan.baselineId,
      objective: blueprint.target === "run.output"
        ? {
            kind: "outcome",
            target: "run.output",
            metrics: evaluatorPlan.metrics,
            assertions: evaluatorPlan.assertions,
            evaluators: evaluatorPlan.evaluators,
            displayColumns: [],
            metadata: { blueprintId: blueprint.id },
          }
        : undefined,
      metadata: baseMetadata,
    });
    return EvaluationBlueprintCompileResultSchema.parse({
      blueprint,
      spec,
      warnings: [],
      assumptions: blueprint.assumptions,
    });
  }

  throw new Error(`Evaluation recipe is not executable in v1: ${blueprint.recipe}`);
}

function inferRecipeFromGoal(goal: string): EvaluationRecipeId {
  const lowered = goal.toLowerCase();
  if (lowered.includes("router") || lowered.includes("路由") || lowered.includes("mode selection") || lowered.includes("auto mode")) {
    return "auto_router_quality";
  }
  return "mode_comparison";
}

function draftEvaluationBlueprint(params: {
  goal: string;
  recipe: EvaluationRecipeId;
  datasetId?: string;
  providerId?: string;
  modelRef?: string;
  now: number;
  id: string;
}): EvaluationBlueprint {
  if (params.recipe === "auto_router_quality") {
    return EvaluationBlueprintSchema.parse({
      id: params.id,
      title: "Auto Router Quality",
      goal: params.goal.trim(),
      recipe: "auto_router_quality",
      target: "runtime.mode_selection",
      subject: { kind: "auto_router" },
      datasetPlan: {
        datasetId: params.datasetId,
        sources: params.datasetId ? ["existing_dataset"] : ["file_import", "synthetic"],
        caseRequirements: [
          "single-turn easy route cases",
          "mode-specific core intent cases",
          "ambiguous fallback cases",
          "multi-turn context shift cases",
          "explicit negative instruction cases",
          "acceptable alternative mode cases",
        ],
        linkedDatasetIds: params.datasetId ? [params.datasetId] : [],
      },
      evaluatorPlan: {
        metrics: ["exact_match", "acceptable_match", "assertion_pass_rate", "fallback_rate", "confidence_calibration"],
        assertions: [],
        notes: "Score selected mode, acceptable alternatives, fallback behavior, and confidence calibration.",
      },
      runPlan: {
        profileId: "outcome",
        providerId: params.providerId ?? "local-smoke",
        modelRef: params.modelRef ?? "local/smoke-model",
        repetitions: 1,
        concurrency: 1,
        routerOnly: true,
        exportFormats: ["json", "csv"],
      },
      reviewPlan: {
        emphasis: ["selected mode distribution", "fallback count", "confidence distribution", "case-level router reasons"],
        failureTags: ["wrong_mode", "unexpected_fallback", "low_confidence"],
        includeTraceLinks: true,
        recommendedActions: ["add failed cases to dataset", "promote stable run as baseline"],
      },
      status: "draft",
      assumptions: [
        "Router-only execution should stop after mode selection.",
        "Cases should include expected mode or acceptable alternatives in structured expected data.",
      ],
      missingInformation: params.datasetId ? [] : ["Select or import an Auto Router dataset before running."],
      linkedRunIds: [],
      schemaVersion: 1,
      createdAt: params.now,
      updatedAt: params.now,
    });
  }

  return EvaluationBlueprintSchema.parse({
    id: params.id,
    title: "Agent Mode Comparison",
    goal: params.goal.trim(),
    recipe: "mode_comparison",
    target: "run.output",
    subject: { kind: "mode_matrix", modeIds: ["orchestrator_subagent", "agent_teams"] },
    datasetPlan: {
      datasetId: params.datasetId,
      sources: params.datasetId ? ["existing_dataset"] : ["file_import", "feedback_inbox"],
      caseRequirements: ["representative task completion cases", "known regressions", "edge cases with expected output"],
      linkedDatasetIds: params.datasetId ? [params.datasetId] : [],
    },
    evaluatorPlan: {
      metrics: ["text_similarity", "assertion_pass_rate", "latency_score", "cost_score"],
      assertions: [],
    },
    runPlan: {
      profileId: "outcome",
      providerId: params.providerId ?? "local-smoke",
      modelRef: params.modelRef ?? "local/smoke-model",
      repetitions: 1,
      concurrency: 1,
      routerOnly: false,
      exportFormats: ["json", "csv"],
    },
    reviewPlan: {
      emphasis: ["scorecard", "config comparison", "failure tags", "trace links"],
      failureTags: ["output_mismatch", "process_issue", "regression"],
      includeTraceLinks: true,
      recommendedActions: ["inspect low-score cases", "promote best stable config as baseline"],
    },
    status: "draft",
    assumptions: ["Agent modes are represented by the existing coordination pattern ids in v1."],
    missingInformation: params.datasetId ? [] : ["Select or import a dataset before running."],
    linkedRunIds: [],
    schemaVersion: 1,
    createdAt: params.now,
    updatedAt: params.now,
  });
}

function deriveDatasetName(fileName: string | undefined, sourceFormat: EvaluationDatasetSourceFormat) {
  if (!fileName) {
    return `Imported ${sourceFormat.toUpperCase()} dataset`;
  }
  const stem = fileName.replace(/\.[^.]+$/, "");
  return stem || `Imported ${sourceFormat.toUpperCase()} dataset`;
}

function parseCases(content: string, sourceFormat: EvaluationDatasetSourceFormat): EvaluationCase[] {
  switch (sourceFormat) {
    case "json":
      return normalizeRecords(parseJsonContent(content));
    case "jsonl":
      return normalizeRecords(content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => JSON.parse(line)));
    case "csv":
      return normalizeRecords(parseCsvContent(content));
    case "inline":
      return normalizeRecords(parseJsonContent(content));
    case "langfuse":
      throw new Error("Langfuse datasets are imported via the API, not from file content.");
  }
}

function parseJsonContent(content: string): unknown[] {
  const parsed = JSON.parse(content);
  if (Array.isArray(parsed)) {
    return parsed;
  }
  if (parsed && typeof parsed === "object" && Array.isArray((parsed as { cases?: unknown[] }).cases)) {
    return (parsed as { cases: unknown[] }).cases;
  }
  throw new Error("JSON dataset must be an array or an object with a cases array.");
}

function parseCsvContent(content: string): Record<string, string>[] {
  const rows = splitCsvRows(content).filter((row) => row.some((cell) => cell.trim() !== ""));
  if (rows.length === 0) {
    return [];
  }
  const [header, ...records] = rows;
  return records.map((row) => {
    const entry: Record<string, string> = {};
    for (let index = 0; index < header.length; index += 1) {
      entry[header[index]!.trim()] = row[index] ?? "";
    }
    return entry;
  });
}

function splitCsvRows(content: string): string[][] {
  const rows: string[][] = [];
  let current = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index]!;
    const next = content[index + 1];
    if (char === "\"") {
      if (inQuotes && next === "\"") {
        current += "\"";
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === "," && !inQuotes) {
      row.push(current);
      current = "";
      continue;
    }
    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }
      row.push(current);
      rows.push(row);
      row = [];
      current = "";
      continue;
    }
    current += char;
  }
  if (current.length > 0 || row.length > 0) {
    row.push(current);
    rows.push(row);
  }
  return rows;
}

function normalizeRecords(records: unknown[]): EvaluationCase[] {
  const seenIds = new Set<string>();
  return records.map((record, index) => {
    if (!record || typeof record !== "object") {
      throw new Error(`Invalid dataset record at index ${index}.`);
    }
    const source = record as Record<string, unknown>;
    const id = String(source.id ?? `case-${index + 1}`);
    if (seenIds.has(id)) {
      throw new Error(`Duplicate evaluation case id: ${id}`);
    }
    seenIds.add(id);

    const rawInput = source.input;
    const prompt = typeof source.prompt === "string"
      ? source.prompt
      : typeof rawInput === "string"
        ? rawInput
        : rawInput && typeof rawInput === "object" && typeof (rawInput as Record<string, unknown>).prompt === "string"
          ? String((rawInput as Record<string, unknown>).prompt)
          : typeof source.question === "string"
            ? source.question
            : "";
    if (!prompt.trim()) {
      throw new Error(`Evaluation case ${id} is missing a prompt/input.`);
    }

    const context = rawInput && typeof rawInput === "object" && !Array.isArray(rawInput)
      ? ((rawInput as Record<string, unknown>).context && typeof (rawInput as Record<string, unknown>).context === "object"
          ? (rawInput as Record<string, unknown>).context as Record<string, unknown>
          : {})
      : {};

    const expected = normalizeExpected(source.expected ?? source.reference ?? source.expected_output);
    const metadata = normalizeMetadata(source);

    return {
      id,
      input: {
        prompt: prompt.trim(),
        context,
      },
      expected,
      metadata,
    };
  }).map((value) => EvaluationCaseSchema.parse(value));
}

function normalizeExpected(raw: unknown): EvaluationExpected | undefined {
  if (raw === undefined || raw === null || raw === "") {
    return undefined;
  }
  if (typeof raw === "string") {
    return { text: raw };
  }
  if (typeof raw === "object") {
    const record = raw as Record<string, unknown>;
    if (typeof record.text === "string") {
      return { text: record.text, structured: record.structured };
    }
    if (record.structured !== undefined) {
      return { structured: record.structured };
    }
    return { structured: raw };
  }
  return { text: String(raw) };
}

function normalizeMetadata(source: Record<string, unknown>) {
  if (typeof source.metadata_json === "string" && source.metadata_json.trim()) {
    try {
      return JSON.parse(source.metadata_json) as Record<string, unknown>;
    } catch {
      throw new Error("metadata_json must be valid JSON.");
    }
  }
  if (source.metadata && typeof source.metadata === "object" && !Array.isArray(source.metadata)) {
    return source.metadata as Record<string, unknown>;
  }

  const ignored = new Set(["id", "input", "prompt", "question", "expected", "expected_output", "reference"]);
  const metadata: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (!ignored.has(key) && value !== undefined) {
      metadata[key] = value;
    }
  }
  return metadata;
}

function collectMetadataKeys(cases: EvaluationCase[]) {
  return [...new Set(cases.flatMap((evaluationCase) => Object.keys(evaluationCase.metadata ?? {})))].sort((a, b) => a.localeCompare(b));
}

function collectTagCounts(cases: EvaluationCase[]) {
  const counts: Record<string, number> = {};
  for (const evaluationCase of cases) {
    const tags = metadataTags(evaluationCase.metadata);
    for (const tag of tags) {
      counts[tag] = (counts[tag] ?? 0) + 1;
    }
  }
  return counts;
}

function buildCaseResults(
  cases: EvaluationCase[],
  configs: EvaluationConfig[],
  attempts: EvaluationAttempt[],
  baselineRun: EvaluationRunDetail | undefined,
  baseline: EvaluationBaseline | undefined
): EvaluationCaseResult[] {
  const results: EvaluationCaseResult[] = [];
  for (const evaluationCase of cases) {
    for (const config of configs) {
      const matchingAttempts = attempts.filter((attempt) => attempt.caseId === evaluationCase.id && attempt.configId === config.id);
      if (matchingAttempts.length === 0) {
        continue;
      }
      const averageScore = averageScoreFromAttempts(matchingAttempts);
      const comparisonToBaseline = baseline && baselineRun
        ? compareToBaseline(evaluationCase.id, baseline, baselineRun, averageScore)
        : undefined;
      results.push(EvaluationCaseResultSchema.parse({
        caseId: evaluationCase.id,
        configId: config.id,
        attemptIds: matchingAttempts.map((attempt) => attempt.id),
        averageScore,
        metricScores: averageMetricScoresFromAttempts(matchingAttempts),
        evaluatorResults: aggregateEvaluatorResultsFromAttempts(matchingAttempts),
        latestOutput: matchingAttempts.at(-1)?.output,
        observations: matchingAttempts.at(-1)?.observations ?? {},
        expected: evaluationCase.expected,
        metadata: evaluationCase.metadata,
        traceRunIds: matchingAttempts.flatMap((attempt) => attempt.underlyingRunId ? [attempt.underlyingRunId] : []),
        comparisonToBaseline,
      }));
    }
  }
  return results;
}

function compareToBaseline(
  caseId: string,
  baseline: EvaluationBaseline,
  baselineRun: EvaluationRunDetail,
  currentScore: EvaluationScore
): EvaluationComparison {
  if (baseline.profileId !== baselineRun.run.spec.profileId || baseline.datasetId !== baselineRun.run.spec.datasetId) {
    return { compatible: false, regressed: false };
  }
  const baselineResult = baselineRun.run.caseResults.find((result) => result.caseId === caseId && result.configId === baseline.configId);
  if (!baselineResult) {
    return { compatible: false, regressed: false };
  }
  const deltaOverallScore = roundScore(currentScore.overallScore - baselineResult.averageScore.overallScore);
  return {
    compatible: true,
    baselineId: baseline.id,
    baselineConfigId: baseline.configId,
    deltaOverallScore,
    regressed: deltaOverallScore < -0.05,
  };
}

function emptyScorecard(configs: EvaluationConfig[]): EvaluationScorecard {
  return EvaluationScorecardSchema.parse({
    overallScore: 0,
    passRate: 0,
    averageRuntimeMs: 0,
    averageCostUsd: 0,
    regressionCount: 0,
    pendingAnnotationCount: 0,
    configSummaries: configs.map((config) => ({
      configId: config.id,
      label: config.label,
      overallScore: 0,
      passRate: 0,
      averageRuntimeMs: 0,
      averageCostUsd: 0,
      caseCount: 0,
      regressionCount: 0,
      failureTagCounts: {},
    })),
    slices: [],
  });
}

function buildScorecard(configs: EvaluationConfig[], attempts: EvaluationAttempt[], caseResults: EvaluationCaseResult[]): EvaluationScorecard {
  const overallScore = roundScore(average(attempts.map((attempt) => attempt.score.overallScore)));
  const passRate = roundScore(average(attempts.map((attempt) => attempt.score.overallScore >= 0.75 ? 1 : 0)));
  const averageRuntimeMs = Math.round(average(attempts.map((attempt) => attempt.runtimeMs)));
  const averageCostUsd = Number(average(attempts.map((attempt) => attempt.costUsd)).toFixed(4));
  const configSummaries: EvaluationConfigSummary[] = configs.map((config) => {
    const configAttempts = attempts.filter((attempt) => attempt.configId === config.id);
    const configCaseResults = caseResults.filter((result) => result.configId === config.id);
    const failureTagCounts: Record<string, number> = {};
    for (const attempt of configAttempts) {
      for (const tag of attempt.score.failureTags) {
        failureTagCounts[tag] = (failureTagCounts[tag] ?? 0) + 1;
      }
    }
    return {
      configId: config.id,
      label: config.label,
      overallScore: roundScore(average(configAttempts.map((attempt) => attempt.score.overallScore))),
      passRate: roundScore(average(configAttempts.map((attempt) => attempt.score.overallScore >= 0.75 ? 1 : 0))),
      averageRuntimeMs: Math.round(average(configAttempts.map((attempt) => attempt.runtimeMs))),
      averageCostUsd: Number(average(configAttempts.map((attempt) => attempt.costUsd)).toFixed(4)),
      caseCount: configCaseResults.length,
      regressionCount: configCaseResults.filter((result) => result.comparisonToBaseline?.regressed).length,
      failureTagCounts,
    };
  });
  const slices = buildSlices(caseResults);
  return EvaluationScorecardSchema.parse({
    overallScore,
    passRate,
    averageRuntimeMs,
    averageCostUsd,
    regressionCount: caseResults.filter((result) => result.comparisonToBaseline?.regressed).length,
    pendingAnnotationCount: attempts.reduce((count, attempt) => count + attempt.evaluatorResults.filter((result) => result.evaluatorKind === "human_annotation" && result.status === "pending").length, 0),
    configSummaries,
    slices,
  });
}

function buildSlices(caseResults: EvaluationCaseResult[]): EvaluationSliceSummary[] {
  const accumulators = new Map<string, { dimension: string; value: string; configId: string; scores: number[] }>();
  for (const result of caseResults) {
    const addSlice = (dimension: string, value: string) => {
      const key = `${dimension}:${value}:${result.configId}`;
      const existing = accumulators.get(key) ?? { dimension, value, configId: result.configId, scores: [] };
      existing.scores.push(result.averageScore.overallScore);
      accumulators.set(key, existing);
    };
    for (const tag of metadataTags(result.metadata)) {
      addSlice("tag", tag);
    }
    const taskType = typeof result.metadata.taskType === "string" ? result.metadata.taskType : undefined;
    if (taskType) addSlice("taskType", taskType);
    const difficulty = typeof result.metadata.difficulty === "string" ? result.metadata.difficulty : undefined;
    if (difficulty) addSlice("difficulty", difficulty);
  }
  return [...accumulators.values()]
    .map((entry) => ({
      dimension: entry.dimension,
      value: entry.value,
      configId: entry.configId,
      caseCount: entry.scores.length,
      overallScore: roundScore(average(entry.scores)),
    }))
    .sort((a, b) => a.dimension.localeCompare(b.dimension) || a.value.localeCompare(b.value) || a.configId.localeCompare(b.configId));
}

function averageScoreFromAttempts(attempts: EvaluationAttempt[]): EvaluationScore {
  return EvaluationScoreSchema.parse({
    outcomeScore: roundScore(average(attempts.map((attempt) => attempt.score.outcomeScore))),
    processScore: roundScore(average(attempts.map((attempt) => attempt.score.processScore))),
    efficiencyScore: roundScore(average(attempts.map((attempt) => attempt.score.efficiencyScore))),
    safetyScore: roundScore(average(attempts.map((attempt) => attempt.score.safetyScore))),
    overallScore: roundScore(average(attempts.map((attempt) => attempt.score.overallScore))),
    judgeRationale: attempts.at(-1)?.score.judgeRationale ?? "No attempts recorded.",
    failureTags: [...new Set(attempts.flatMap((attempt) => attempt.score.failureTags))],
  });
}

function averageMetricScoresFromAttempts(attempts: EvaluationAttempt[]): EvaluationMetricScore[] {
  const byMetric = new Map<EvaluationMetricId, EvaluationMetricScore[]>();
  for (const attempt of attempts) {
    for (const metric of attempt.metricScores) {
      const existing = byMetric.get(metric.metricId) ?? [];
      existing.push(metric);
      byMetric.set(metric.metricId, existing);
    }
  }
  return [...byMetric.entries()].map(([metricId, metrics]) => EvaluationMetricScoreSchema.parse({
    metricId,
    score: roundScore(average(metrics.map((metric) => metric.score))),
    passed: average(metrics.map((metric) => metric.passed ? 1 : 0)) >= 0.75,
    rationale: metrics.at(-1)?.rationale ?? "No metric attempts recorded.",
    failureTags: [...new Set(metrics.flatMap((metric) => metric.failureTags))],
    details: {
      attemptCount: metrics.length,
      passRate: roundScore(average(metrics.map((metric) => metric.passed ? 1 : 0))),
    },
  }));
}

function aggregateEvaluatorResultsFromAttempts(attempts: EvaluationAttempt[]): EvaluationEvaluatorResult[] {
  const byEvaluator = new Map<string, EvaluationEvaluatorResult[]>();
  for (const attempt of attempts) {
    for (const result of attempt.evaluatorResults) {
      const current = byEvaluator.get(result.evaluatorId) ?? [];
      current.push(result);
      byEvaluator.set(result.evaluatorId, current);
    }
  }
  return [...byEvaluator.entries()].map(([evaluatorId, results]) => {
    const latest = results.at(-1)!;
    const scored = results.filter((result) => typeof result.score === "number");
    if (scored.length === 0) {
      return EvaluationEvaluatorResultSchema.parse({
        ...latest,
        status: latest.status,
        evaluatorId,
      });
    }
    return EvaluationEvaluatorResultSchema.parse({
      evaluatorId,
      evaluatorKind: latest.evaluatorKind,
      scorerVersion: latest.scorerVersion ?? "1.0.0",
      rubricVersion: latest.rubricVersion,
      score: roundScore(average(scored.map((result) => result.score ?? 0))),
      passed: average(scored.map((result) => result.passed ? 1 : 0)) >= 0.75,
      rationale: latest.rationale ?? "Aggregated evaluator results.",
      failureTags: [...new Set(results.flatMap((result) => result.failureTags))],
      status: results.some((result) => result.status === "pending") ? "pending" : "scored",
      details: { attemptCount: results.length },
    });
  });
}

function scoreEvaluationAttempt(
  spec: EvaluationSpec,
  evaluationCase: EvaluationCase,
  snapshot: StateSnapshot,
  runtimeMs: number
): {
  score: EvaluationScore;
  metricScores: EvaluationMetricScore[];
  observations: EvaluationObservation;
  output?: unknown;
} {
  const observations = extractEvaluationObservations(snapshot, runtimeMs);
  const objective = spec.objective ?? objectiveForProfile(spec.profileId, evaluationCase);
  if (!spec.objective) {
    return {
      score: scoreSnapshot(spec.profileId, evaluationCase, snapshot),
      metricScores: [],
      observations,
    };
  }

  const metricScores = scoreObjectiveMetrics(objective, evaluationCase, observations);
  const score = aggregateMetricScores(metricScores, spec.profileId, snapshot.status === "failed" || Boolean(snapshot.error));
  return {
    score,
    metricScores,
    observations,
    output: outputForObjective(objective, observations, evaluationCase),
  };
}

function objectiveForProfile(profileId: EvaluationProfileKind, evaluationCase: EvaluationCase): EvaluationObjective {
  const hasExpectedText = Boolean(evaluationCase.expected?.text);
  return EvaluationObjectiveSchema.parse({
    kind: "outcome",
    target: "run.output",
    metrics: hasExpectedText ? ["text_similarity"] : ["trace_coverage", "latency_score"],
    metadata: { profileId },
  });
}

function extractEvaluationObservations(snapshot: StateSnapshot, runtimeMs: number): EvaluationObservation {
  const autoModeRouter = snapshot.config.metadata.autoModeRouter && typeof snapshot.config.metadata.autoModeRouter === "object"
    ? snapshot.config.metadata.autoModeRouter as Record<string, unknown>
    : {};
  const effectiveStrategy = snapshot.config.effectiveStrategy;
  const efficiencyLedger = buildAgenticEfficiencyLedger(snapshot, runtimeMs);
  return {
    run: {
      status: snapshot.status,
      outputText: extractOutputText(snapshot),
      output: {
        text: extractOutputText(snapshot),
      },
      runtimeMs,
      costUsd: efficiencyLedger.estimatedCostUsd,
      agenticCost: efficiencyLedger,
    },
    runtime: {
      modeId: snapshot.modeId,
      pattern: snapshot.pattern,
      autoModeRouter: {
        selectedModeId: stringValue(autoModeRouter.selectedModeId),
        status: stringValue(autoModeRouter.status),
        confidence: numberValue(autoModeRouter.confidence),
        reason: stringValue(autoModeRouter.reason),
      },
      ...(effectiveStrategy ? { effectiveStrategy } : {}),
      efficiencyLedger,
    },
    trace: {
      events: evaluationTraceEvents(snapshot),
      eventTypes: snapshot.events.map((event) => event.type),
      eventCount: snapshot.events.length,
      toolCallIds: snapshot.toolCalls.map((call) => call.toolId),
      toolCallCount: snapshot.toolCalls.length,
    },
  };
}

function scoreObjectiveMetrics(
  objective: EvaluationObjective,
  evaluationCase: EvaluationCase,
  observations: EvaluationObservation
): EvaluationMetricScore[] {
  const metrics = objective.metrics.length > 0
    ? objective.metrics
    : defaultMetricsForObjective(objective);
  return metrics.map((metricId) => scoreMetric(metricId, objective, evaluationCase, observations));
}

function defaultMetricsForObjective(objective: EvaluationObjective): EvaluationMetricId[] {
  if (objective.target === "runtime.mode_selection") {
    return ["acceptable_match", "assertion_pass_rate", "fallback_rate", "confidence_calibration"];
  }
  switch (objective.kind) {
    case "classification":
      return ["exact_match", "assertion_pass_rate"];
    case "assertions":
      return ["assertion_pass_rate"];
    case "latency":
      return ["latency_score"];
    case "cost":
      return ["agentic_cost_score", "token_efficiency", "tool_efficiency", "coordination_overhead", "recovery_overhead"];
    case "regression":
      return ["assertion_pass_rate"];
    case "outcome":
    default:
      return ["text_similarity"];
  }
}

function scoreMetric(
  metricId: EvaluationMetricId,
  objective: EvaluationObjective,
  evaluationCase: EvaluationCase,
  observations: EvaluationObservation
): EvaluationMetricScore {
  switch (metricId) {
    case "text_similarity":
      return textSimilarityMetric(evaluationCase, observations);
    case "exact_match":
      return exactMatchMetric(evaluationCase, observations);
    case "acceptable_match":
      return acceptableMatchMetric(evaluationCase, observations);
    case "assertion_pass_rate":
      return assertionPassRateMetric(objective, evaluationCase, observations);
    case "fallback_rate":
      return fallbackRateMetric(observations);
    case "confidence_calibration":
      return confidenceCalibrationMetric(evaluationCase, observations);
    case "latency_score":
      return latencyMetric(observations);
    case "cost_score":
      return costMetric(observations);
    case "agentic_cost_score":
      return agenticCostMetric(observations);
    case "token_efficiency":
      return tokenEfficiencyMetric(observations);
    case "tool_efficiency":
      return toolEfficiencyMetric(observations);
    case "coordination_overhead":
      return coordinationOverheadMetric(observations);
    case "recovery_overhead":
      return recoveryOverheadMetric(observations);
    case "trace_coverage":
      return traceCoverageMetric(observations);
  }
}

function textSimilarityMetric(evaluationCase: EvaluationCase, observations: EvaluationObservation): EvaluationMetricScore {
  const expectedText = evaluationCase.expected?.text?.toLowerCase();
  const outputText = String(getObservationPath(observations, "run.outputText") ?? "").toLowerCase();
  const score = expectedText ? textSimilarity(expectedText, outputText) : outputText.length > 0 ? 0.72 : 0.25;
  return EvaluationMetricScoreSchema.parse({
    metricId: "text_similarity",
    score,
    passed: score >= 0.75,
    rationale: expectedText ? "Compared output text against expected text." : "No expected text was provided; scored by output presence.",
    failureTags: score >= 0.75 ? [] : ["incorrect_output"],
  });
}

function exactMatchMetric(evaluationCase: EvaluationCase, observations: EvaluationObservation): EvaluationMetricScore {
  const preferred = structuredExpected(evaluationCase)?.preferred;
  if (!preferred) {
    return EvaluationMetricScoreSchema.parse({
      metricId: "exact_match",
      score: 0.5,
      passed: false,
      rationale: "No preferred value was provided for exact match.",
      failureTags: ["missing_oracle"],
    });
  }
  const actual = getObservationPath(observations, preferred.path);
  const passed = valuesEqual(actual, preferred.value);
  return EvaluationMetricScoreSchema.parse({
    metricId: "exact_match",
    score: passed ? 1 : 0,
    passed,
    rationale: passed ? "Observed value matched preferred oracle." : "Observed value did not match preferred oracle.",
    failureTags: passed ? [] : ["wrong_value"],
    details: { path: preferred.path, expected: preferred.value, actual },
  });
}

function acceptableMatchMetric(evaluationCase: EvaluationCase, observations: EvaluationObservation): EvaluationMetricScore {
  const structured = structuredExpected(evaluationCase);
  const preferred = structured?.preferred;
  const oneOf = structured?.assertions.find((assertion) => assertion.type === "one_of" && Array.isArray(assertion.values));
  const path = oneOf?.path ?? preferred?.path;
  const acceptableValues = oneOf?.values ?? (preferred ? [preferred.value] : []);
  if (!path || acceptableValues.length === 0) {
    return EvaluationMetricScoreSchema.parse({
      metricId: "acceptable_match",
      score: 0.5,
      passed: false,
      rationale: "No acceptable oracle values were provided.",
      failureTags: ["missing_oracle"],
    });
  }
  const actual = getObservationPath(observations, path);
  const passed = acceptableValues.some((value) => valuesEqual(actual, value));
  return EvaluationMetricScoreSchema.parse({
    metricId: "acceptable_match",
    score: passed ? 1 : 0,
    passed,
    rationale: passed ? "Observed value was in the acceptable set." : "Observed value was outside the acceptable set.",
    failureTags: passed ? [] : [oneOf?.failureTag ?? "wrong_value"],
    details: { path, acceptableValues, actual },
  });
}

function assertionPassRateMetric(
  objective: EvaluationObjective,
  evaluationCase: EvaluationCase,
  observations: EvaluationObservation
): EvaluationMetricScore {
  const assertions = [
    ...objective.assertions,
    ...(structuredExpected(evaluationCase)?.assertions ?? []),
  ];
  if (assertions.length === 0) {
    return EvaluationMetricScoreSchema.parse({
      metricId: "assertion_pass_rate",
      score: 1,
      passed: true,
      rationale: "No structured assertions were provided.",
    });
  }
  const results = assertions.map((assertion) => {
    const actual = getObservationPath(observations, assertion.path);
    return {
      assertion,
      actual,
      passed: evaluateAssertion(assertion, actual),
    };
  });
  const totalWeight = results.reduce((sum, result) => sum + result.assertion.weight, 0);
  const passedWeight = results.reduce((sum, result) => sum + (result.passed ? result.assertion.weight : 0), 0);
  const score = totalWeight > 0 ? roundScore(passedWeight / totalWeight) : 1;
  const failureTags = results
    .filter((result) => !result.passed)
    .map((result) => result.assertion.failureTag ?? failureTagForAssertion(result.assertion));
  return EvaluationMetricScoreSchema.parse({
    metricId: "assertion_pass_rate",
    score,
    passed: score >= 0.75,
    rationale: `${results.filter((result) => result.passed).length}/${results.length} assertions passed.`,
    failureTags: [...new Set(failureTags)],
    details: {
      assertionCount: results.length,
      failed: results.filter((result) => !result.passed).map((result) => ({
        path: result.assertion.path,
        type: result.assertion.type,
        actual: result.actual,
      })),
    },
  });
}

function fallbackRateMetric(observations: EvaluationObservation): EvaluationMetricScore {
  const status = getObservationPath(observations, "runtime.autoModeRouter.status");
  const passed = status !== "fallback";
  return EvaluationMetricScoreSchema.parse({
    metricId: "fallback_rate",
    score: passed ? 1 : 0,
    passed,
    rationale: passed ? "Router selected a mode without fallback." : "Router fell back instead of selecting a mode.",
    failureTags: passed ? [] : ["fallback_route"],
    details: { status },
  });
}

function confidenceCalibrationMetric(evaluationCase: EvaluationCase, observations: EvaluationObservation): EvaluationMetricScore {
  const confidence = numberValue(getObservationPath(observations, "runtime.autoModeRouter.confidence")) ?? 0;
  const minConfidence = minConfidenceOracle(evaluationCase) ?? 0.55;
  const acceptable = acceptableMatchMetric(evaluationCase, observations).passed;
  const score = acceptable
    ? minConfidence <= 0 ? 1 : Math.min(1, confidence / minConfidence)
    : Math.max(0, 1 - confidence);
  return EvaluationMetricScoreSchema.parse({
    metricId: "confidence_calibration",
    score: roundScore(score),
    passed: score >= 0.75,
    rationale: acceptable
      ? "Confidence is scored against the minimum expected confidence for a correct route."
      : "Incorrect routes are penalized more when confidence is high.",
    failureTags: score >= 0.75 ? [] : ["miscalibrated_confidence"],
    details: { confidence, minConfidence, acceptable },
  });
}

function latencyMetric(observations: EvaluationObservation): EvaluationMetricScore {
  const runtimeMs = numberValue(getObservationPath(observations, "run.runtimeMs")) ?? 0;
  const score = Math.max(0.35, 1 - runtimeMs / 8_000);
  return EvaluationMetricScoreSchema.parse({
    metricId: "latency_score",
    score: roundScore(score),
    passed: score >= 0.75,
    rationale: "Scored runtime latency against the default evaluation threshold.",
    failureTags: score >= 0.75 ? [] : ["slow_runtime"],
    details: { runtimeMs },
  });
}

function costMetric(observations: EvaluationObservation): EvaluationMetricScore {
  const costUsd = numberValue(getObservationPath(observations, "run.costUsd")) ?? 0;
  const score = Math.max(0, 1 - costUsd / 0.05);
  return EvaluationMetricScoreSchema.parse({
    metricId: "cost_score",
    score: roundScore(score),
    passed: score >= 0.75,
    rationale: "Scored estimated cost against the default evaluation budget.",
    failureTags: score >= 0.75 ? [] : ["high_cost"],
    details: { costUsd },
  });
}

function agenticCostMetric(observations: EvaluationObservation): EvaluationMetricScore {
  const costUsd = numberValue(getObservationPath(observations, "runtime.efficiencyLedger.estimatedCostUsd")) ?? 0;
  const score = Math.max(0, 1 - costUsd / 0.025);
  return EvaluationMetricScoreSchema.parse({
    metricId: "agentic_cost_score",
    score: roundScore(score),
    passed: score >= 0.75,
    rationale: "Scored completion cost using Ora's agentic efficiency ledger.",
    failureTags: score >= 0.75 ? [] : ["high_agentic_cost"],
    details: { costUsd },
  });
}

function tokenEfficiencyMetric(observations: EvaluationObservation): EvaluationMetricScore {
  const totalTokens = numberValue(getObservationPath(observations, "runtime.efficiencyLedger.totalTokens")) ?? 0;
  const modelCallCount = Math.max(1, numberValue(getObservationPath(observations, "runtime.efficiencyLedger.modelCallCount")) ?? 1);
  const tokensPerModelCall = totalTokens / modelCallCount;
  const score = Math.max(0, 1 - tokensPerModelCall / 12_000);
  return EvaluationMetricScoreSchema.parse({
    metricId: "token_efficiency",
    score: roundScore(score),
    passed: score >= 0.75,
    rationale: "Scored token use per model call.",
    failureTags: score >= 0.75 ? [] : ["high_token_load"],
    details: { totalTokens, modelCallCount, tokensPerModelCall: Math.round(tokensPerModelCall) },
  });
}

function toolEfficiencyMetric(observations: EvaluationObservation): EvaluationMetricScore {
  const toolCallCount = numberValue(getObservationPath(observations, "runtime.efficiencyLedger.toolCallCount")) ?? 0;
  const failedToolCallCount = numberValue(getObservationPath(observations, "runtime.efficiencyLedger.failedToolCallCount")) ?? 0;
  const repairedToolCallCount = numberValue(getObservationPath(observations, "runtime.efficiencyLedger.repairedToolCallCount")) ?? 0;
  const score = Math.max(0, 1 - (toolCallCount + failedToolCallCount + repairedToolCallCount) / 16);
  return EvaluationMetricScoreSchema.parse({
    metricId: "tool_efficiency",
    score: roundScore(score),
    passed: score >= 0.75,
    rationale: "Scored tool volume and wasted tool attempts.",
    failureTags: score >= 0.75 ? [] : ["high_tool_overhead"],
    details: { toolCallCount, failedToolCallCount, repairedToolCallCount },
  });
}

function coordinationOverheadMetric(observations: EvaluationObservation): EvaluationMetricScore {
  const coordinationEventCount = numberValue(getObservationPath(observations, "runtime.efficiencyLedger.coordinationEventCount")) ?? 0;
  const modelCallCount = Math.max(1, numberValue(getObservationPath(observations, "runtime.efficiencyLedger.modelCallCount")) ?? 1);
  const coordinationPerModelCall = coordinationEventCount / modelCallCount;
  const score = Math.max(0, 1 - coordinationPerModelCall / 8);
  return EvaluationMetricScoreSchema.parse({
    metricId: "coordination_overhead",
    score: roundScore(score),
    passed: score >= 0.75,
    rationale: "Scored coordination event overhead relative to model work.",
    failureTags: score >= 0.75 ? [] : ["high_coordination_overhead"],
    details: { coordinationEventCount, modelCallCount, coordinationPerModelCall },
  });
}

function recoveryOverheadMetric(observations: EvaluationObservation): EvaluationMetricScore {
  const recoveryEventCount = numberValue(getObservationPath(observations, "runtime.efficiencyLedger.recoveryEventCount")) ?? 0;
  const toolRetryCount = numberValue(getObservationPath(observations, "runtime.efficiencyLedger.toolRetryCount")) ?? 0;
  const score = Math.max(0, 1 - (recoveryEventCount + toolRetryCount) / 6);
  return EvaluationMetricScoreSchema.parse({
    metricId: "recovery_overhead",
    score: roundScore(score),
    passed: score >= 0.75,
    rationale: "Scored repair and retry overhead.",
    failureTags: score >= 0.75 ? [] : ["high_recovery_overhead"],
    details: { recoveryEventCount, toolRetryCount },
  });
}

function traceCoverageMetric(observations: EvaluationObservation): EvaluationMetricScore {
  const eventCount = numberValue(getObservationPath(observations, "trace.eventCount")) ?? 0;
  const score = Math.min(1, 0.45 + Math.min(eventCount, 4) * 0.12);
  return EvaluationMetricScoreSchema.parse({
    metricId: "trace_coverage",
    score: roundScore(score),
    passed: score >= 0.75,
    rationale: "Scored whether the run produced enough trace activity for diagnosis.",
    failureTags: score >= 0.75 ? [] : ["process_issue"],
    details: { eventCount },
  });
}

function aggregateMetricScores(metricScores: EvaluationMetricScore[], profileId: EvaluationProfileKind, runtimeFailed: boolean): EvaluationScore {
  if (metricScores.length === 0) {
    return EvaluationScoreSchema.parse({
      outcomeScore: runtimeFailed ? 0 : 0.72,
      processScore: runtimeFailed ? 0.2 : 0.72,
      efficiencyScore: runtimeFailed ? 0.25 : 0.72,
      safetyScore: runtimeFailed ? 0.2 : 0.92,
      overallScore: runtimeFailed ? 0 : 0.72,
      judgeRationale: "No metric scores were produced.",
      failureTags: runtimeFailed ? ["runtime_failed"] : [],
    });
  }
  const scoreFor = (ids: EvaluationMetricId[], fallback: number) => {
    const matches = metricScores.filter((metric) => ids.includes(metric.metricId));
    return matches.length > 0 ? average(matches.map((metric) => metric.score)) : fallback;
  };
  const overallScore = roundScore(average(metricScores.map((metric) => metric.score)));
  const outcomeScore = roundScore(scoreFor(["text_similarity", "exact_match", "acceptable_match", "assertion_pass_rate"], overallScore));
  const processScore = roundScore(scoreFor(["fallback_rate", "trace_coverage"], overallScore));
  const efficiencyScore = roundScore(scoreFor([
    "latency_score",
    "cost_score",
    "agentic_cost_score",
    "token_efficiency",
    "tool_efficiency",
    "coordination_overhead",
    "recovery_overhead",
  ], runtimeFailed ? 0.25 : 0.9));
  const safetyScore = runtimeFailed ? 0.2 : metricScores.some((metric) => metric.failureTags.includes("reject_value") || metric.failureTags.includes("wrong_mode")) ? 0.55 : 0.92;
  const failureTags = [
    ...(runtimeFailed ? ["runtime_failed"] : []),
    ...metricScores.flatMap((metric) => metric.failureTags),
  ];
  return EvaluationScoreSchema.parse({
    outcomeScore,
    processScore,
    efficiencyScore,
    safetyScore: roundScore(safetyScore),
    overallScore: roundScore(
      outcomeScore * profileWeights(profileId).outcome +
      processScore * profileWeights(profileId).process +
      efficiencyScore * profileWeights(profileId).efficiency +
      safetyScore * profileWeights(profileId).safety
    ),
    judgeRationale: metricScores.map((metric) => `${metric.metricId}: ${metric.rationale}`).join(" "),
    failureTags: [...new Set(failureTags)],
  });
}

function scoreSnapshot(profileId: EvaluationProfileKind, evaluationCase: EvaluationCase, snapshot: StateSnapshot): EvaluationScore {
  const outputText = extractOutputText(snapshot).toLowerCase();
  const expectedText = evaluationCase.expected?.text?.toLowerCase();
  const runtimeFailed = snapshot.status === "failed" || Boolean(snapshot.error);
  const outcomeScore = runtimeFailed
    ? 0
    : expectedText
      ? textSimilarity(expectedText, outputText)
      : outputText.length > 0 ? 0.72 : 0.25;
  const processEvents = snapshot.events.filter((event) => ["agent.started", "agent.completed", "tool.called", "checkpoint.created"].includes(event.type)).length;
  const processScore = runtimeFailed
    ? 0.2
    : Math.min(1, 0.45 + Math.min(processEvents, 4) * 0.12);
  const runtimeMs = Math.max(1, snapshot.updatedAt - (snapshot.events[0]?.createdAt ?? snapshot.updatedAt));
  const efficiencyScore = runtimeFailed ? 0.25 : Math.max(0.35, 1 - runtimeMs / 8_000);
  const safetyScore = runtimeFailed
    ? 0.2
    : hasCurrentSafetyGate(snapshot)
      ? 0.55
      : 0.92;
  const weights = profileWeights(profileId);
  const overallScore = roundScore(
    outcomeScore * weights.outcome +
    processScore * weights.process +
    efficiencyScore * weights.efficiency +
    safetyScore * weights.safety
  );
  const failureTags = [
    ...(runtimeFailed ? ["runtime_failed"] : []),
    ...(outcomeScore < 0.6 ? ["incorrect_output"] : []),
    ...(processScore < 0.6 ? ["process_issue"] : []),
    ...(safetyScore < 0.8 ? ["safety_issue"] : []),
  ];
  return EvaluationScoreSchema.parse({
    outcomeScore: roundScore(outcomeScore),
    processScore: roundScore(processScore),
    efficiencyScore: roundScore(efficiencyScore),
    safetyScore: roundScore(safetyScore),
    overallScore,
    judgeRationale: buildJudgeRationale(profileId, outputText, expectedText, failureTags, runtimeFailed),
    failureTags,
  });
}

export function hasCurrentSafetyGate(snapshot: StateSnapshot): boolean {
  const attention = snapshot.attention ?? deriveRunAttention(snapshot);
  return attention.kind === "needs_approval" || attention.kind === "needs_clarification";
}

function profileWeights(profileId: EvaluationProfileKind) {
  switch (profileId) {
    case "orchestration":
      return { outcome: 0.25, process: 0.45, efficiency: 0.15, safety: 0.15 };
    case "task_completion":
      return { outcome: 0.45, process: 0.25, efficiency: 0.15, safety: 0.15 };
    case "outcome":
    default:
      return { outcome: 0.55, process: 0.2, efficiency: 0.15, safety: 0.1 };
  }
}

function buildJudgeRationale(
  profileId: EvaluationProfileKind,
  outputText: string,
  expectedText: string | undefined,
  failureTags: string[],
  runtimeFailed: boolean
) {
  if (runtimeFailed) {
    return `The underlying run failed, so the ${profileId} profile scored this attempt low despite any partial trace activity.`;
  }
  if (expectedText) {
    return failureTags.length === 0
      ? `The output aligns with the expected answer and the ${profileId} profile found no major process or safety concerns.`
      : `The output was compared against the expected answer and the ${profileId} profile flagged: ${failureTags.join(", ")}.`;
  }
  return outputText.length > 0
    ? `No reference answer was provided, so the ${profileId} profile used reference-free heuristics over the output and trace.`
    : `No reference answer was provided and the run produced little usable output, so the ${profileId} profile scored this conservatively.`;
}

function structuredExpected(evaluationCase: EvaluationCase) {
  const structured = evaluationCase.expected?.structured;
  if (!structured || typeof structured !== "object") {
    return undefined;
  }
  const parsed = EvaluationStructuredExpectedSchema.safeParse(structured);
  return parsed.success ? parsed.data : undefined;
}

function minConfidenceOracle(evaluationCase: EvaluationCase): number | undefined {
  const structured = evaluationCase.expected?.structured;
  if (!structured || typeof structured !== "object") {
    return undefined;
  }
  const value = (structured as Record<string, unknown>).minConfidence;
  return typeof value === "number" ? value : undefined;
}

function outputForObjective(
  objective: EvaluationObjective,
  observations: EvaluationObservation,
  evaluationCase: EvaluationCase
): unknown | undefined {
  if (objective.target !== "runtime.mode_selection") {
    return undefined;
  }
  const structured = structuredExpected(evaluationCase);
  return {
    selectedModeId: getObservationPath(observations, "runtime.modeId"),
    routerStatus: getObservationPath(observations, "runtime.autoModeRouter.status"),
    confidence: getObservationPath(observations, "runtime.autoModeRouter.confidence"),
    reason: getObservationPath(observations, "runtime.autoModeRouter.reason"),
    preferred: structured?.preferred,
    assertions: structured?.assertions ?? [],
  };
}

function evaluationTraceEvents(snapshot: StateSnapshot): Array<Record<string, unknown>> {
  const events: Array<Record<string, unknown>> = snapshot.events.map((event) => {
    const payload = event.payload && typeof event.payload === "object" && !Array.isArray(event.payload)
      ? event.payload as Record<string, unknown>
      : {};
    const agentRole = stringValue(payload.agentRole)
      ?? stringValue(payload.role)
      ?? stringValue(payload.agentId)
      ?? event.agentId
      ?? event.nodeId;
    const toolName = stringValue(payload.toolName) ?? stringValue(payload.toolId);
    const toolNames = toolName ? toolNameAliases(toolName) : [];
    return {
      ...event,
      ...(agentRole ? { agentRole } : {}),
      ...(toolName ? { toolName, toolNames } : {}),
    };
  });

  for (const result of snapshot.toolResults) {
    events.push({
      type: "tool.result_observed",
      toolName: result.toolId,
      toolNames: toolNameAliases(result.toolId),
      status: result.status,
      toolCallId: result.resultToolCallId,
    });
  }

  return events;
}

function toolNameAliases(toolName: string): string[] {
  const aliases = new Set([toolName]);
  const legacy: Record<string, string[]> = {
    "file.read": ["read_file"],
    "file.write": ["write_file"],
    "file.patch": ["patch_file"],
    "file.delete": ["delete_file"],
    "file.list": ["list_files", "list_directory"],
    "file.search": ["search_files"],
    "shell.execute": ["run_shell_command"],
    "web.search": ["web_search"],
    "web.fetch": ["web_fetch"],
  };
  for (const alias of legacy[toolName] ?? []) {
    aliases.add(alias);
  }
  return [...aliases];
}

function getObservationPath(source: unknown, pathExpression: string): unknown {
  return splitPathExpression(pathExpression).reduce<unknown>((current, segment) => {
    if (segment === "length") {
      return Array.isArray(current) || typeof current === "string" ? current.length : undefined;
    }

    const filtered = applyArrayFilterSegment(current, segment);
    if (filtered.matched) {
      return filtered.value;
    }

    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return undefined;
    }
    return (current as Record<string, unknown>)[segment];
  }, source);
}

function splitPathExpression(pathExpression: string): string[] {
  const segments: string[] = [];
  let current = "";
  let bracketDepth = 0;
  let quote: "'" | "\"" | undefined;
  for (const char of pathExpression) {
    if ((char === "'" || char === "\"") && bracketDepth > 0) {
      quote = quote === char ? undefined : quote ?? char;
    }
    if (!quote) {
      if (char === "[") bracketDepth += 1;
      if (char === "]") bracketDepth = Math.max(0, bracketDepth - 1);
    }
    if (char === "." && bracketDepth === 0 && !quote) {
      segments.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  if (current) segments.push(current);
  return segments;
}

function applyArrayFilterSegment(current: unknown, segment: string): { matched: boolean; value?: unknown } {
  const match = /^([^\[]+)\[\?\((.*)\)\]$/.exec(segment);
  if (!match) {
    return { matched: false };
  }
  if (!current || typeof current !== "object" || Array.isArray(current)) {
    return { matched: true, value: undefined };
  }
  const sourceArray = (current as Record<string, unknown>)[match[1] ?? ""];
  if (!Array.isArray(sourceArray)) {
    return { matched: true, value: undefined };
  }
  const expression = match[2] ?? "";
  return {
    matched: true,
    value: sourceArray.filter((item) => filterExpressionMatches(item, expression)),
  };
}

function filterExpressionMatches(item: unknown, expression: string): boolean {
  return splitBooleanExpression(expression, "||").some((orPart) => (
    splitBooleanExpression(orPart, "&&").every((andPart) => filterConditionMatches(item, andPart.trim()))
  ));
}

function splitBooleanExpression(expression: string, operator: "&&" | "||"): string[] {
  const parts: string[] = [];
  let current = "";
  let quote: "'" | "\"" | undefined;
  for (let index = 0; index < expression.length; index += 1) {
    const char = expression[index];
    if (char === "'" || char === "\"") {
      quote = quote === char ? undefined : quote ?? char;
    }
    if (!quote && expression.slice(index, index + operator.length) === operator) {
      parts.push(current);
      current = "";
      index += operator.length - 1;
      continue;
    }
    current += char;
  }
  if (current) parts.push(current);
  return parts;
}

function filterConditionMatches(item: unknown, condition: string): boolean {
  const match = /^@\.([A-Za-z0-9_.-]+)\s*==\s*(['"])(.*?)\2$/.exec(condition);
  if (!match) {
    return false;
  }
  const actual = getObservationPath(item, match[1] ?? "");
  const expected = match[3] ?? "";
  if ((match[1] ?? "") === "toolName") {
    const aliases = getObservationPath(item, "toolNames");
    if (Array.isArray(aliases) && aliases.some((value) => valuesEqual(value, expected))) {
      return true;
    }
  }
  return Array.isArray(actual)
    ? actual.some((value) => valuesEqual(value, expected))
    : valuesEqual(actual, expected);
}

function evaluateAssertion(assertion: EvaluationAssertion, actual: unknown): boolean {
  switch (assertion.type) {
    case "equals":
      return valuesEqual(actual, assertion.value);
    case "not_equals":
      return !valuesEqual(actual, assertion.value);
    case "one_of":
      return (assertion.values ?? []).some((value) => valuesEqual(actual, value));
    case "not_one_of":
      return !(assertion.values ?? []).some((value) => valuesEqual(actual, value));
    case "min":
      return typeof actual === "number" && typeof assertion.value === "number" && actual >= assertion.value;
    case "max":
      return typeof actual === "number" && typeof assertion.value === "number" && actual <= assertion.value;
    case "exists":
      if (Array.isArray(actual)) {
        return actual.length > 0;
      }
      return actual !== undefined && actual !== null && actual !== "";
    case "contains":
      return typeof actual === "string" && typeof assertion.value === "string" && actual.includes(assertion.value);
  }
}

function failureTagForAssertion(assertion: EvaluationAssertion) {
  if (assertion.path === "runtime.modeId") {
    return assertion.type === "not_one_of" || assertion.type === "not_equals" ? "reject_value" : "wrong_mode";
  }
  if (assertion.path.includes("confidence")) {
    return "miscalibrated_confidence";
  }
  return "assertion_failed";
}

function valuesEqual(left: unknown, right: unknown): boolean {
  if (left === right) {
    return true;
  }
  if (typeof left === "string" || typeof right === "string" || typeof left === "number" || typeof right === "number" || typeof left === "boolean" || typeof right === "boolean") {
    return String(left) === String(right);
  }
  return JSON.stringify(left) === JSON.stringify(right);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function extractOutputText(snapshot: StateSnapshot) {
  if (typeof snapshot.output === "string") {
    return snapshot.output;
  }
  if (snapshot.output && typeof snapshot.output === "object" && typeof (snapshot.output as Record<string, unknown>).text === "string") {
    return String((snapshot.output as Record<string, unknown>).text);
  }
  const event = [...snapshot.events].reverse().find((candidate) => candidate.type === "message.delta" && candidate.payload && typeof candidate.payload === "object" && typeof (candidate.payload as Record<string, unknown>).content === "string");
  if (event) {
    return String((event.payload as Record<string, unknown>).content);
  }
  return "";
}

function fallbackFeedbackDraft(
  feedbackId: string,
  feedbackText: string,
  sourceContext: Record<string, unknown>,
  error?: string
): EvaluationFeedbackDraftCase {
  const feedbackLower = feedbackText.toLowerCase();
  const failureMode = inferFailureMode(feedbackLower);
  const severity = inferSeverity(feedbackLower);
  const sourceRunId = typeof sourceContext.runId === "string" ? sourceContext.runId : undefined;
  const sourceSessionId = typeof sourceContext.sessionId === "string" ? sourceContext.sessionId : undefined;
  const sourceTurnIndex = typeof sourceContext.turnIndex === "number" ? sourceContext.turnIndex : undefined;
  const prompt = typeof sourceContext.userPrompt === "string" && sourceContext.userPrompt.trim()
    ? sourceContext.userPrompt
    : "Review the original Ora chat turn using the attached feedback.";
  const sourceAssistantOutput = typeof sourceContext.assistantOutput === "string"
    ? sourceContext.assistantOutput
    : undefined;
  const tags = ["chat_feedback", failureMode, severity];
  return EvaluationFeedbackDraftCaseSchema.parse({
    curatorStatus: error ? "failed" : "fallback",
    curatorRationale: error
      ? `Curator generation failed, so Ora created a conservative fallback draft: ${error}`
      : "Ora created a deterministic fallback draft from the user's natural-language feedback.",
    error,
    case: {
      id: `feedback-case-${feedbackId.replace(/^feedback-/, "")}`,
      input: {
        prompt,
        context: {
          sourceAssistantOutput,
          userFeedback: feedbackText,
          sourceContext,
        },
      },
      expected: {
        structured: {
          failureMode,
          severity,
          idealBehavior: "Address the user's feedback while preserving the original task intent.",
          mustAddress: [feedbackText],
          shouldAvoid: ["Repeating the same issue identified by the user."],
          rubric: [
            {
              criterion: "feedback_resolution",
              weight: 1,
              description: "The response resolves the concrete issue described in the user feedback.",
            },
          ],
        },
      },
      metadata: {
        source: "chat_feedback",
        feedbackId,
        sourceRunId,
        sourceSessionId,
        sourceTurnIndex,
        failureMode,
        severity,
        tags,
      },
    },
  });
}

function inferFailureMode(feedbackLower: string) {
  if (/(format|格式|结构|排版|json|表格|citation|引用)/i.test(feedbackLower)) return "bad_format";
  if (/(tool|工具|搜索|文件|轨迹|trace|process|流程)/i.test(feedbackLower)) return "tool_process_issue";
  if (/(unsafe|危险|删除|权限|approval|安全)/i.test(feedbackLower)) return "safety_issue";
  if (/(miss|漏|没有|忽略|requirement|需求|要求)/i.test(feedbackLower)) return "missed_requirement";
  if (/(wrong|错误|不对|事实|hallucinat|幻觉)/i.test(feedbackLower)) return "factual_error";
  if (/(reason|逻辑|推理|分析)/i.test(feedbackLower)) return "poor_reasoning";
  return "user_reported_issue";
}

function inferSeverity(feedbackLower: string) {
  if (/(critical|严重|危险|不能用|block|阻塞|错得离谱)/i.test(feedbackLower)) return "high";
  if (/(minor|小问题|轻微|typo|错别字)/i.test(feedbackLower)) return "low";
  return "medium";
}

function textSimilarity(expectedText: string, outputText: string) {
  if (!outputText.trim()) return 0.1;
  if (outputText.includes(expectedText) || expectedText.includes(outputText)) {
    return 1;
  }
  const expectedTokens = new Set(tokenize(expectedText));
  const outputTokens = new Set(tokenize(outputText));
  if (expectedTokens.size === 0 || outputTokens.size === 0) return 0.2;
  let intersection = 0;
  for (const token of expectedTokens) {
    if (outputTokens.has(token)) intersection += 1;
  }
  const union = new Set([...expectedTokens, ...outputTokens]).size;
  return Math.max(0.15, Math.min(1, intersection / union));
}

function tokenize(value: string) {
  return value.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

function estimateCostUsd(snapshot: StateSnapshot) {
  return buildAgenticEfficiencyLedger(snapshot).estimatedCostUsd;
}

function metadataTags(metadata: Record<string, unknown>) {
  const tags = metadata.tags;
  if (Array.isArray(tags)) {
    return tags.flatMap((tag) => typeof tag === "string" ? [tag] : []);
  }
  if (typeof tags === "string" && tags.trim()) {
    return tags.split("|").map((tag) => tag.trim()).filter(Boolean);
  }
  return [];
}

function signatureForConfig(config: EvaluationConfig) {
  return JSON.stringify(sortObject(config.runConfig));
}

function sortObject(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortObject);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, sortObject(nested)])
    );
  }
  return value;
}

function roundScore(value: number) {
  return Number(value.toFixed(4));
}

function average(values: number[]) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function nextCounter(ids: string[], pattern: RegExp) {
  return ids.reduce((max, id) => {
    const match = pattern.exec(id);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0) + 1;
}

function csvCell(value: string) {
  return `"${value.replaceAll("\"", "\"\"")}"`;
}

function renderReportToMarkdown(report: EvaluationReport): string {
  const lines: string[] = [];
  lines.push(`# Evaluation Report: ${report.evaluationRunId}`);
  lines.push("");
  lines.push(`**Generated:** ${new Date(report.generatedAt).toISOString()}`);
  lines.push(`**Generator:** Ora Evaluation v${report.generatorVersion}`);
  lines.push(`**Status:** ${report.run.status}`);
  lines.push(`**Dataset:** ${report.dataset.name} (${report.dataset.caseCount} cases)`);
  lines.push(`**Profile:** ${report.run.spec.profileId}`);
  lines.push("");

  lines.push("## Scorecard");
  lines.push("");
  const sc = report.scorecard;
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Overall Score | ${sc.overallScore.toFixed(4)} |`);
  lines.push(`| Pass Rate | ${(sc.passRate * 100).toFixed(1)}% |`);
  lines.push(`| Average Runtime | ${sc.averageRuntimeMs}ms |`);
  lines.push(`| Average Cost | $${sc.averageCostUsd.toFixed(4)} |`);
  lines.push(`| Regressions | ${sc.regressionCount} |`);
  lines.push(`| Pending Annotations | ${sc.pendingAnnotationCount} |`);
  lines.push("");

  lines.push("### Config Summaries");
  lines.push("");
  lines.push(`| Config | Score | Pass Rate | Runtime | Cost | Cases | Regressions |`);
  lines.push(`|--------|-------|-----------|---------|------|-------|-------------|`);
  for (const cs of sc.configSummaries) {
    lines.push(`| ${cs.label} | ${cs.overallScore.toFixed(4)} | ${(cs.passRate * 100).toFixed(1)}% | ${cs.averageRuntimeMs}ms | $${cs.averageCostUsd.toFixed(4)} | ${cs.caseCount} | ${cs.regressionCount} |`);
  }
  lines.push("");

  if (report.slices.length > 0) {
    lines.push("### Slices");
    lines.push("");
    const dimensions = [...new Set(report.slices.map((s) => s.dimension))];
    for (const dim of dimensions) {
      lines.push(`**${dim}:**`);
      for (const slice of report.slices.filter((s) => s.dimension === dim)) {
        lines.push(`- ${slice.value}: ${slice.overallScore.toFixed(4)} (${slice.caseCount} cases, config ${slice.configId})`);
      }
      lines.push("");
    }
  }

  if (report.failures.length > 0) {
    lines.push("## Failures");
    lines.push("");
    lines.push(`${report.failures.length} cases scored below threshold:`);
    lines.push("");
    for (const f of report.failures.slice(0, 20)) {
      lines.push(`- **${f.caseId}** (${f.configId}): score=${f.score.toFixed(4)}, tags=${f.failureTags.join(", ") || "none"}`);
      if (f.rationale) lines.push(`  - Rationale: ${f.rationale.slice(0, 200)}`);
    }
    if (report.failures.length > 20) {
      lines.push(`- ... and ${report.failures.length - 20} more failures`);
    }
    lines.push("");
  }

  if (report.baselineDelta) {
    lines.push("## Baseline Comparison");
    lines.push("");
    lines.push(`- Baseline: ${report.baselineDelta.baselineId ?? "N/A"}`);
    lines.push(`- Overall Delta: ${(report.baselineDelta.overallDelta ?? 0).toFixed(4)}`);
    lines.push(`- Regressions: ${report.baselineDelta.regressionCount}`);
    lines.push("");
  }

  if (report.traceLinks.length > 0) {
    lines.push("## Trace Links");
    lines.push("");
    for (const link of report.traceLinks.slice(0, 10)) {
      lines.push(`- ${link.caseId}/${link.configId}: run \`${link.runId}\``);
    }
    if (report.traceLinks.length > 10) {
      lines.push(`- ... and ${report.traceLinks.length - 10} more traces`);
    }
    lines.push("");
  }

  if (report.recommendedActions.length > 0) {
    lines.push("## Recommended Actions");
    lines.push("");
    for (const action of report.recommendedActions) {
      lines.push(`- [ ] ${action}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function renderReportToHtml(report: EvaluationReport): string {
  const md = renderReportToMarkdown(report);
  return [
    "<!DOCTYPE html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    `<title>Evaluation Report: ${report.evaluationRunId}</title>`,
    "<style>",
    "body{font-family:system-ui,sans-serif;max-width:960px;margin:0 auto;padding:2rem;color:#1a1a1a;background:#fff}",
    "h1{font-size:1.75rem;border-bottom:2px solid #1a56db;padding-bottom:.5rem}",
    "h2{font-size:1.25rem;margin-top:2rem;color:#1a56db}",
    "table{border-collapse:collapse;width:100%;margin:1rem 0}",
    "th,td{border:1px solid #e5e7eb;padding:.5rem .75rem;text-align:left}",
    "th{background:#f3f4f6;font-weight:600}",
    ".score-good{color:#059669}.score-warn{color:#d97706}.score-bad{color:#dc2626}",
    "code{background:#f3f4f6;padding:.125rem .25rem;border-radius:4px;font-size:.875em}",
    "ul{margin:.5rem 0}",
    "</style>",
    "</head>",
    "<body>",
    ...md.split("\n").map((line) => {
      if (line.startsWith("# ")) return `<h1>${line.slice(2)}</h1>`;
      if (line.startsWith("## ")) return `<h2>${line.slice(3)}</h2>`;
      if (line.startsWith("### ")) return `<h3>${line.slice(4)}</h3>`;
      if (line.startsWith("**") && line.includes(":**")) {
        const colonIdx = line.indexOf(":**");
        return `<p><strong>${line.slice(2, colonIdx)}</strong>:${line.slice(colonIdx + 3)}</p>`;
      }
      if (line.startsWith("| ")) return `<tr>${line.split("|").filter(Boolean).map((c) => {
        const isHeader = line.includes("|---");
        const tag = isHeader ? "th" : "td";
        return `<${tag}>${c.trim()}</${tag}>`;
      }).join("")}</tr>`;
      if (line.startsWith("- [")) return `<li><input type="checkbox"> ${line.slice(5)}</li>`;
      if (line.startsWith("- ")) return `<li>${line.slice(2)}</li>`;
      if (line.startsWith("`")) return `<pre><code>${line}</code></pre>`;
      if (line.trim() === "") return "<br>";
      return `<p>${line}</p>`;
    }),
    "</body>",
    "</html>",
  ].join("\n");
}
