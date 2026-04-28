import fs from "node:fs";
import path from "node:path";
import {
  EvaluationAttempt,
  EvaluationAttemptSchema,
  EvaluationAssertion,
  EvaluationBaseline,
  EvaluationBaselineListParamsSchema,
  EvaluationBaselineSchema,
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
  EvaluationExportParamsSchema,
  EvaluationExportResult,
  EvaluationExportResultSchema,
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
  EvaluationMetricId,
  EvaluationMetricScore,
  EvaluationMetricScoreSchema,
  EvaluationObjective,
  EvaluationObjectiveSchema,
  EvaluationObservation,
  EvaluationProfileKind,
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
  RunHandle,
  StateSnapshot,
  UserTaskInput,
} from "@ora/shared";
import { z } from "zod";

const EvaluationManifestSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  nextDatasetNumber: z.number().int().positive().default(1),
  nextEvaluationRunNumber: z.number().int().positive().default(1),
  nextBaselineNumber: z.number().int().positive().default(1),
  nextFeedbackNumber: z.number().int().positive().default(1),
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

const FEEDBACK_DATASET_ID = "feedback-chat";

export class LocalEvaluationStore {
  private readonly manifestPath: string;
  private readonly datasetsDir: string;
  private readonly runsDir: string;
  private readonly baselinesDir: string;
  private readonly feedbackDir: string;
  private readonly clock: () => number;
  private manifest: EvaluationManifest;
  private datasets = new Map<string, EvaluationDatasetDetail>();
  private runs = new Map<string, PersistedEvaluationRun>();
  private baselines = new Map<string, EvaluationBaseline>();
  private feedback = new Map<string, EvaluationFeedbackRecord>();

  constructor(private readonly baseDir: string, clock: () => number = Date.now) {
    this.clock = clock;
    this.manifestPath = path.join(baseDir, "manifest.json");
    this.datasetsDir = path.join(baseDir, "datasets");
    this.runsDir = path.join(baseDir, "runs");
    this.baselinesDir = path.join(baseDir, "baselines");
    this.feedbackDir = path.join(baseDir, "feedback");
    this.ensureDirs();
    this.manifest = this.readJsonFile(this.manifestPath, EvaluationManifestSchema, EvaluationManifestSchema.parse({}));
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

  async startRun(params: unknown, executeRun: RunExecutor): Promise<EvaluationRunDetail> {
    const spec = EvaluationSpecSchema.parse(params);
    const dataset = this.getDataset({ datasetId: spec.datasetId });
    const evaluationRunId = this.nextEvaluationRunId();
    const startedAt = this.now();
    const attempts: EvaluationAttempt[] = [];
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

    for (const evaluationCase of dataset.cases) {
      for (const config of spec.configs) {
        for (let repetition = 1; repetition <= spec.repetitions; repetition += 1) {
          const attemptStartedAt = this.now();
          const snapshot = await executeRun({
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
          const runtimeMs = Math.max(0, snapshot.updatedAt - (snapshot.events[0]?.createdAt ?? attemptStartedAt));
          const assessment = scoreEvaluationAttempt(spec, evaluationCase, snapshot, runtimeMs);
          const attempt = EvaluationAttemptSchema.parse({
            id: `${evaluationRunId}:attempt:${config.id}:${evaluationCase.id}:r${repetition}`,
            evaluationRunId,
            caseId: evaluationCase.id,
            configId: config.id,
            repetition,
            status: snapshot.status === "failed" ? "failed" : "succeeded",
            underlyingRunId: snapshot.runId,
            output: assessment.output ?? snapshot.output,
            error: snapshot.error,
            score: assessment.score,
            metricScores: assessment.metricScores,
            observations: assessment.observations,
            runtimeMs,
            costUsd: estimateCostUsd(snapshot),
            startedAt: attemptStartedAt,
            updatedAt: snapshot.updatedAt,
          });
          attempts.push(attempt);
          appendEvent("evaluation.attempt.completed", {
            attemptId: attempt.id,
            caseId: attempt.caseId,
            configId: attempt.configId,
            repetition,
            status: attempt.status,
            underlyingRunId: attempt.underlyingRunId,
            overallScore: attempt.score.overallScore,
          });
        }
      }
    }

    const baseline = spec.baselineId ? this.baselines.get(spec.baselineId) : undefined;
    const caseResults = buildCaseResults(dataset.cases, spec.configs, attempts, baseline ? this.runs.get(baseline.evaluationRunId)?.detail : undefined, baseline);
    const scorecard = buildScorecard(spec.configs, attempts, caseResults);
    const run = EvaluationRunSchema.parse({
      id: evaluationRunId,
      spec,
      status: "succeeded",
      totalAttempts: attempts.length,
      completedAttempts: attempts.length,
      failedAttempts: attempts.filter((attempt) => attempt.status === "failed").length,
      attemptIds: attempts.map((attempt) => attempt.id),
      caseResults,
      scorecard,
      startedAt,
      updatedAt: this.now(),
      completedAt: this.now(),
    });
    appendEvent("evaluation.run.completed", {
      overallScore: run.scorecard.overallScore,
      passRate: run.scorecard.passRate,
      regressionCount: run.scorecard.regressionCount,
    });

    const detail = EvaluationRunDetailSchema.parse({
      run: { ...run, updatedAt: this.now(), completedAt: this.now() },
      attempts,
      dataset: dataset.dataset,
      configs: spec.configs,
    });
    this.runs.set(evaluationRunId, { detail, events });
    this.saveRun(evaluationRunId);
    return detail;
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
      "case_id,config_id,overall_score,outcome_score,process_score,efficiency_score,safety_score,failure_tags,trace_run_ids,metric_scores_json,observations_json",
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
        csvCell(JSON.stringify(result.observations)),
      ].join(",")),
    ];
    return EvaluationExportResultSchema.parse({
      evaluationRunId: parsed.evaluationRunId,
      format: "csv",
      content: `${rows.join("\n")}\n`,
    });
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

  private loadAll() {
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
    this.manifest = EvaluationManifestSchema.parse({
      ...this.manifest,
      nextDatasetNumber: Math.max(this.manifest.nextDatasetNumber, nextCounter([...this.datasets.keys()], /^dataset-(\d+)$/)),
      nextEvaluationRunNumber: Math.max(this.manifest.nextEvaluationRunNumber, nextCounter([...this.runs.keys()], /^eval-run-(\d+)$/)),
      nextBaselineNumber: Math.max(this.manifest.nextBaselineNumber, nextCounter([...this.baselines.keys()], /^baseline-(\d+)$/)),
      nextFeedbackNumber: Math.max(this.manifest.nextFeedbackNumber, nextCounter([...this.feedback.keys()], /^feedback-(\d+)$/)),
    });
  }

  private ensureDirs() {
    fs.mkdirSync(this.datasetsDir, { recursive: true });
    fs.mkdirSync(this.runsDir, { recursive: true });
    fs.mkdirSync(this.baselinesDir, { recursive: true });
    fs.mkdirSync(this.feedbackDir, { recursive: true });
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

  private saveManifest() {
    this.writeJsonFile(this.manifestPath, EvaluationManifestSchema.parse(this.manifest));
  }

  private saveDataset(detail: EvaluationDatasetDetail) {
    this.writeJsonFile(path.join(this.datasetsDir, `${encodeURIComponent(detail.dataset.id)}.json`), detail);
  }

  private saveRun(evaluationRunId: string) {
    const run = this.runs.get(evaluationRunId);
    if (!run) return;
    this.writeJsonFile(path.join(this.runsDir, `${encodeURIComponent(evaluationRunId)}.json`), PersistedEvaluationRunSchema.parse(run));
  }

  private saveBaseline(baseline: EvaluationBaseline) {
    this.writeJsonFile(path.join(this.baselinesDir, `${encodeURIComponent(baseline.id)}.json`), baseline);
  }

  private saveFeedback(record: EvaluationFeedbackRecord) {
    this.writeJsonFile(path.join(this.feedbackDir, `${encodeURIComponent(record.id)}.json`), record);
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
  return {
    run: {
      status: snapshot.status,
      outputText: extractOutputText(snapshot),
      runtimeMs,
      costUsd: estimateCostUsd(snapshot),
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
    },
    trace: {
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
      return ["cost_score"];
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
    ? Math.min(1, confidence / minConfidence)
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
  const efficiencyScore = roundScore(scoreFor(["latency_score", "cost_score"], runtimeFailed ? 0.25 : 0.9));
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
    : snapshot.pendingClarifications.length > 0 ||
      snapshot.pendingApprovals.length > 0 ||
      snapshot.actions.some((action) => action.status === "approval_required")
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

function getObservationPath(source: unknown, pathExpression: string): unknown {
  return pathExpression.split(".").reduce<unknown>((current, segment) => {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return undefined;
    }
    return (current as Record<string, unknown>)[segment];
  }, source);
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
  const base = snapshot.events.length * 0.0002;
  return Number(base.toFixed(4));
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
