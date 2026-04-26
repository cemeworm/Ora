import fs from "node:fs";
import path from "node:path";
import {
  FeedbackLoopActionApplyParamsSchema,
  FeedbackLoopActionPreviewParamsSchema,
  FeedbackLoopActionResult,
  FeedbackLoopActionResultSchema,
  FeedbackLoopCalibrationRule,
  FeedbackLoopCalibrationRuleSchema,
  FeedbackLoopInsightDismissParamsSchema,
  FeedbackLoopInsightGetParamsSchema,
  FeedbackLoopInsightsListParamsSchema,
  FeedbackLoopRuleUpdateParamsSchema,
  FeedbackLoopRulesListParamsSchema,
  FeedbackLoopSignalsListParamsSchema,
  ProjectInsight,
  ProjectInsightSchema,
  ProjectSignal,
  ProjectSignalAction,
  ProjectSignalSchema,
  type EvaluationFeedbackRecord,
  type EvaluationRun,
  type OraEventEnvelope,
  type ProjectSummary,
  type SessionSummary,
  type StateSnapshot,
} from "@ora/shared";
import { z } from "zod";

const DEFAULT_PROJECT_ID = "local-project";

const FeedbackLoopStateSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  dismissedInsights: z.record(z.object({
    reason: z.string().min(1).optional(),
    dismissedAt: z.number().int().nonnegative(),
  })).default({}),
  appliedActions: z.record(z.object({
    appliedAt: z.number().int().nonnegative(),
    actionId: z.string().min(1),
  })).default({}),
  rules: z.record(FeedbackLoopCalibrationRuleSchema).default({}),
});

type FeedbackLoopState = z.infer<typeof FeedbackLoopStateSchema>;

export interface FeedbackLoopDerivationInput {
  projects: ProjectSummary[];
  sessions: SessionSummary[];
  runs: StateSnapshot[];
  evaluationRuns: EvaluationRun[];
  feedbackRecords: EvaluationFeedbackRecord[];
}

export class LocalFeedbackLoopStore {
  private readonly statePath: string;
  private state: FeedbackLoopState;

  constructor(private readonly baseDir: string, private readonly clock: () => number = Date.now) {
    this.statePath = path.join(baseDir, "state.json");
    fs.mkdirSync(baseDir, { recursive: true });
    this.state = this.readState();
  }

  listSignals(params: unknown, input: FeedbackLoopDerivationInput): ProjectSignal[] {
    const parsed = FeedbackLoopSignalsListParamsSchema.parse(params ?? {});
    return this.deriveSignals(input)
      .filter((signal) => parsed.projectId ? signal.projectId === parsed.projectId : true)
      .filter((signal) => parsed.source ? signal.source === parsed.source : true)
      .filter((signal) => parsed.severity ? signal.severity === parsed.severity : true)
      .sort((left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id))
      .slice(0, parsed.limit)
      .map((signal) => ProjectSignalSchema.parse(signal));
  }

  listInsights(params: unknown, input: FeedbackLoopDerivationInput): ProjectInsight[] {
    const parsed = FeedbackLoopInsightsListParamsSchema.parse(params ?? {});
    return this.deriveInsights(input)
      .filter((insight) => parsed.projectId ? insight.projectId === parsed.projectId : true)
      .filter((insight) => parsed.status ? insight.status === parsed.status : true)
      .sort((left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id))
      .slice(0, parsed.limit)
      .map((insight) => ProjectInsightSchema.parse(insight));
  }

  getInsight(params: unknown, input: FeedbackLoopDerivationInput): ProjectInsight {
    const parsed = FeedbackLoopInsightGetParamsSchema.parse(params);
    const insight = this.deriveInsights(input).find((candidate) => candidate.id === parsed.insightId);
    if (!insight) {
      throw new Error(`Feedback-loop insight not found: ${parsed.insightId}`);
    }
    return ProjectInsightSchema.parse(insight);
  }

  dismissInsight(params: unknown, input: FeedbackLoopDerivationInput): ProjectInsight {
    const parsed = FeedbackLoopInsightDismissParamsSchema.parse(params);
    const insight = this.getInsight(parsed, input);
    this.state.dismissedInsights[insight.id] = {
      reason: parsed.reason,
      dismissedAt: this.clock(),
    };
    this.saveState();
    return ProjectInsightSchema.parse({
      ...insight,
      status: "dismissed",
      updatedAt: this.clock(),
    });
  }

  previewAction(params: unknown, input: FeedbackLoopDerivationInput): FeedbackLoopActionResult {
    const parsed = FeedbackLoopActionPreviewParamsSchema.parse(params);
    const { insight, action } = this.findInsightAction(parsed.insightId, parsed.actionId, input);
    return FeedbackLoopActionResultSchema.parse({
      insight,
      action,
      status: "preview",
      message: previewMessageForAction(action),
    });
  }

  applyAction(params: unknown, input: FeedbackLoopDerivationInput): FeedbackLoopActionResult {
    const parsed = FeedbackLoopActionApplyParamsSchema.parse(params);
    const { insight, action } = this.findInsightAction(parsed.insightId, parsed.actionId, input);
    this.state.appliedActions[insight.id] = {
      actionId: action.id,
      appliedAt: this.clock(),
    };
    this.saveState();
    return FeedbackLoopActionResultSchema.parse({
      insight: {
        ...insight,
        status: "applied",
        updatedAt: this.clock(),
      },
      action,
      status: "applied",
      message: appliedMessageForAction(action),
    });
  }

  listRules(params: unknown, input: FeedbackLoopDerivationInput): FeedbackLoopCalibrationRule[] {
    const parsed = FeedbackLoopRulesListParamsSchema.parse(params ?? {});
    return this.projectsForRules(input.projects, parsed.projectId)
      .flatMap((projectId) => this.rulesForProject(projectId))
      .map((rule) => FeedbackLoopCalibrationRuleSchema.parse(rule));
  }

  updateRule(params: unknown): FeedbackLoopCalibrationRule {
    const parsed = FeedbackLoopRuleUpdateParamsSchema.parse(params);
    this.state.rules[parsed.rule.id] = parsed.rule;
    this.saveState();
    return FeedbackLoopCalibrationRuleSchema.parse(parsed.rule);
  }

  private findInsightAction(insightId: string, actionId: string, input: FeedbackLoopDerivationInput) {
    const insight = this.getInsight({ insightId }, input);
    const action = insight.recommendedActions.find((candidate) => candidate.id === actionId);
    if (!action) {
      throw new Error(`Feedback-loop action not found: ${actionId}`);
    }
    return { insight, action };
  }

  private deriveSignals(input: FeedbackLoopDerivationInput): ProjectSignal[] {
    const sessionsById = new Map(input.sessions.map((session) => [session.sessionId, session]));
    const signals: ProjectSignal[] = [];

    for (const run of input.runs) {
      const projectId = projectIdForRun(run, sessionsById);
      signals.push(...signalsForRun(projectId, run));
    }

    for (const run of input.evaluationRuns) {
      const projectId = projectIdForEvaluationRun(run);
      signals.push(...signalsForEvaluationRun(projectId, run));
    }

    for (const feedback of input.feedbackRecords) {
      const sourceRun = input.runs.find((run) => run.runId === feedback.sourceRunId);
      const projectId = sourceRun
        ? projectIdForRun(sourceRun, sessionsById)
        : feedback.sourceSessionId
          ? sessionsById.get(feedback.sourceSessionId)?.projectId ?? DEFAULT_PROJECT_ID
          : DEFAULT_PROJECT_ID;
      signals.push(...signalsForFeedback(projectId, feedback));
    }

    return signals.map((signal) => ProjectSignalSchema.parse(signal));
  }

  private deriveInsights(input: FeedbackLoopDerivationInput): ProjectInsight[] {
    const signals = this.deriveSignals(input);
    const byProject = groupBy(signals, (signal) => signal.projectId);
    const insights: ProjectInsight[] = [];

    for (const [projectId, projectSignals] of byProject.entries()) {
      insights.push(...this.repeatedRecoveryInsights(projectId, projectSignals));
      insights.push(...this.feedbackReviewInsights(projectId, projectSignals));
      insights.push(...this.evaluationRegressionInsights(projectId, projectSignals));
      insights.push(...this.approvalBottleneckInsights(projectId, projectSignals));
      insights.push(...this.runFailureInsights(projectId, projectSignals));
    }

    return insights.map((insight) => this.applyInsightState(ProjectInsightSchema.parse(insight)));
  }

  private repeatedRecoveryInsights(projectId: string, signals: ProjectSignal[]): ProjectInsight[] {
    const rule = this.ruleForProject(projectId, "repeated_recovery_exhausted");
    if (!ruleAllows(rule, "recovery_event", "critical")) return [];
    const recoverySignals = signals.filter((signal) => signal.source === "recovery_event" && signal.metadata.eventType === "recovery.exhausted");
    const byMode = groupBy(recoverySignals, (signal) => String(signal.metadata.modeId ?? "unknown-mode"));
    return [...byMode.entries()]
      .filter(([, items]) => items.length >= 2)
      .map(([modeId, items]) => buildInsight({
        projectId,
        id: `${projectId}:insight:repeated_recovery_exhausted:${modeId}`,
        title: `Recovery is recurring in ${modeId}`,
        summary: `${items.length} recent signals show exhausted recovery in the same mode.`,
        signalIds: items.map((signal) => signal.id),
        confidence: Math.min(0.95, 0.65 + items.length * 0.1),
        updatedAt: latestTimestamp(items),
        actions: filterActionsByRule([
          openTrailsAction(items[0]!),
          createEvaluationCaseAction(projectId, "Create an Evaluation case from repeated recovery"),
        ], rule),
      }));
  }

  private feedbackReviewInsights(projectId: string, signals: ProjectSignal[]): ProjectInsight[] {
    const rule = this.ruleForProject(projectId, "feedback_pending_review");
    if (!ruleAllows(rule, "evaluation_feedback", "warning")) return [];
    const pending = signals.filter((signal) => signal.source === "evaluation_feedback" && signal.metadata.feedbackStatus === "pending");
    if (pending.length === 0) return [];
    return [buildInsight({
      projectId,
      id: `${projectId}:insight:feedback_pending_review`,
      title: "Feedback is waiting for review",
      summary: `${pending.length} feedback record${pending.length === 1 ? "" : "s"} need curator review before becoming benchmark material.`,
      signalIds: pending.map((signal) => signal.id),
      confidence: 0.85,
      updatedAt: latestTimestamp(pending),
      actions: filterActionsByRule([openEvaluationFeedbackAction()], rule),
    })];
  }

  private evaluationRegressionInsights(projectId: string, signals: ProjectSignal[]): ProjectInsight[] {
    const rule = this.ruleForProject(projectId, "eval_regression");
    if (!ruleAllows(rule, "evaluation_result", "warning")) return [];
    const regressions = signals.filter((signal) => signal.source === "evaluation_result" && signal.metadata.regression === true);
    if (regressions.length === 0) return [];
    return [buildInsight({
      projectId,
      id: `${projectId}:insight:evaluation_regression`,
      title: "Evaluation results are drifting",
      summary: `${regressions.length} evaluation signal${regressions.length === 1 ? "" : "s"} show regressions or low pass rates.`,
      signalIds: regressions.map((signal) => signal.id),
      confidence: 0.8,
      updatedAt: latestTimestamp(regressions),
      actions: filterActionsByRule([openEvaluationRunAction(regressions[0]!)], rule),
    })];
  }

  private approvalBottleneckInsights(projectId: string, signals: ProjectSignal[]): ProjectInsight[] {
    const rule = this.ruleForProject(projectId, "approval_bottleneck");
    if (!ruleAllows(rule, "approval_event", "info")) return [];
    const approvals = signals.filter((signal) => signal.source === "approval_event");
    if (approvals.length < 2) return [];
    return [buildInsight({
      projectId,
      id: `${projectId}:insight:approval_bottleneck`,
      title: "Approvals are becoming a bottleneck",
      summary: `${approvals.length} recent approval signals remain unresolved or required manual review.`,
      signalIds: approvals.map((signal) => signal.id),
      confidence: 0.76,
      updatedAt: latestTimestamp(approvals),
      actions: filterActionsByRule([reviewModeRulesAction(projectId)], rule),
    })];
  }

  private runFailureInsights(projectId: string, signals: ProjectSignal[]): ProjectInsight[] {
    const rule = this.ruleForProject(projectId, "repeated_run_failures");
    if (!ruleAllows(rule, "run_event", "critical")) return [];
    const failures = signals.filter((signal) => signal.source === "run_event" && signal.metadata.runStatus === "failed");
    if (failures.length < 2) return [];
    return [buildInsight({
      projectId,
      id: `${projectId}:insight:repeated_run_failures`,
      title: "Runs are failing repeatedly",
      summary: `${failures.length} recent run failure signals are tied to this project.`,
      signalIds: failures.map((signal) => signal.id),
      confidence: 0.78,
      updatedAt: latestTimestamp(failures),
      actions: filterActionsByRule([openTrailsAction(failures[0]!)], rule),
    })];
  }

  private applyInsightState(insight: ProjectInsight): ProjectInsight {
    if (this.state.appliedActions[insight.id]) {
      return ProjectInsightSchema.parse({ ...insight, status: "applied" });
    }
    if (this.state.dismissedInsights[insight.id]) {
      return ProjectInsightSchema.parse({ ...insight, status: "dismissed" });
    }
    return insight;
  }

  private projectsForRules(projects: ProjectSummary[], projectId?: string): string[] {
    if (projectId) return [projectId];
    const ids = projects.map((project) => project.projectId);
    return ids.length > 0 ? ids : [DEFAULT_PROJECT_ID];
  }

  private rulesForProject(projectId: string): FeedbackLoopCalibrationRule[] {
    const defaults = defaultRulesForProject(projectId);
    return defaults.map((rule) => this.state.rules[rule.id] ?? rule);
  }

  private ruleForProject(projectId: string, key: string): FeedbackLoopCalibrationRule {
    const ruleId = `${projectId}:rule:${key}`;
    return this.state.rules[ruleId] ?? defaultRulesForProject(projectId).find((rule) => rule.id === ruleId)!;
  }

  private readState(): FeedbackLoopState {
    if (!fs.existsSync(this.statePath)) {
      return FeedbackLoopStateSchema.parse({});
    }
    try {
      return FeedbackLoopStateSchema.parse(JSON.parse(fs.readFileSync(this.statePath, "utf8")));
    } catch {
      return FeedbackLoopStateSchema.parse({});
    }
  }

  private saveState(): void {
    fs.writeFileSync(this.statePath, `${JSON.stringify(FeedbackLoopStateSchema.parse(this.state), null, 2)}\n`);
  }
}

function signalsForRun(projectId: string, run: StateSnapshot): ProjectSignal[] {
  const signals: ProjectSignal[] = [];
  if (run.status === "failed" || run.status === "cancelled" || run.status === "interrupted") {
    signals.push(runStatusSignal(projectId, run));
  }

  for (const event of run.events) {
    const signal = signalForEvent(projectId, run, event);
    if (signal) signals.push(signal);
  }

  if (run.pendingApprovals.length > 0) {
    signals.push(ProjectSignalSchema.parse({
      id: `${projectId}:signal:approval:${run.runId}:pending`,
      projectId,
      source: "approval_event",
      sourceRef: `${run.runId}:pending-approvals`,
      title: "Approval is pending",
      summary: `${run.pendingApprovals.length} approval request${run.pendingApprovals.length === 1 ? "" : "s"} remain pending in ${run.runId}.`,
      severity: "warning",
      confidence: 0.75,
      createdAt: run.updatedAt,
      updatedAt: run.updatedAt,
      evidence: [runEvidence(run, "Pending approvals", "Approvals")],
      metadata: {
        runId: run.runId,
        modeId: run.modeId ?? run.pattern,
        approvalCount: run.pendingApprovals.length,
      },
    }));
  }

  for (const action of run.actions.filter((item) => item.status === "approval_required" || item.status === "failed")) {
    signals.push(ProjectSignalSchema.parse({
      id: `${projectId}:signal:action:${run.runId}:${action.id}`,
      projectId,
      source: action.status === "approval_required" ? "approval_event" : "run_event",
      sourceRef: `${run.runId}:${action.id}`,
      title: action.status === "approval_required" ? "Action needs approval" : "Action failed",
      summary: `${action.type} is ${action.status.replace("_", " ")} in ${run.runId}.`,
      severity: action.status === "failed" ? "warning" : "info",
      confidence: 0.72,
      createdAt: run.updatedAt,
      updatedAt: run.updatedAt,
      evidence: [runEvidence(run, action.type, "Actions")],
      metadata: {
        runId: run.runId,
        actionId: action.id,
        actionType: action.type,
        actionStatus: action.status,
        modeId: run.modeId ?? run.pattern,
      },
    }));
  }

  for (const toolCall of run.toolCalls.filter((item) => item.status === "failed" || item.status === "interrupted")) {
    signals.push(ProjectSignalSchema.parse({
      id: `${projectId}:signal:tool:${run.runId}:${toolCall.id}`,
      projectId,
      source: "run_event",
      sourceRef: `${run.runId}:${toolCall.id}`,
      title: "Tool call did not complete",
      summary: `${toolCall.toolId} ended as ${toolCall.status} in ${run.runId}.`,
      severity: toolCall.status === "failed" ? "warning" : "info",
      confidence: 0.72,
      createdAt: toolCall.requestedAt,
      updatedAt: toolCall.updatedAt,
      evidence: [runEvidence(run, toolCall.toolId, "Tools")],
      metadata: {
        runId: run.runId,
        toolCallId: toolCall.id,
        toolId: toolCall.toolId,
        toolStatus: toolCall.status,
        modeId: run.modeId ?? run.pattern,
      },
    }));
  }

  return signals;
}

function runStatusSignal(projectId: string, run: StateSnapshot): ProjectSignal {
  return ProjectSignalSchema.parse({
    id: `${projectId}:signal:run:${run.runId}:${run.status}`,
    projectId,
    source: "run_event",
    sourceRef: run.runId,
    title: run.status === "failed" ? "Run failed" : `Run ${run.status}`,
    summary: run.error ?? `${run.runId} ended with status ${run.status}.`,
    severity: run.status === "failed" ? "critical" : "warning",
    confidence: 0.86,
    createdAt: run.updatedAt,
    updatedAt: run.updatedAt,
    evidence: [runEvidence(run, "Run state", "Overview")],
    metadata: {
      runId: run.runId,
      runStatus: run.status,
      modeId: run.modeId ?? run.pattern,
      pattern: run.pattern,
    },
  });
}

function signalForEvent(projectId: string, run: StateSnapshot, event: OraEventEnvelope): ProjectSignal | undefined {
  const recoveryTypes = new Set(["recovery.detected", "recovery.retry_scheduled", "recovery.applied", "recovery.exhausted"]);
  const notableTypes = new Set(["node.skipped", "run.interrupted", "run.cancelled", "run.failed"]);
  if (!recoveryTypes.has(event.type) && !notableTypes.has(event.type)) {
    return undefined;
  }

  const source = recoveryTypes.has(event.type) ? "recovery_event" : "run_event";
  const severity = event.type === "recovery.exhausted" || event.type === "run.failed"
    ? "critical"
    : event.type === "node.skipped" || event.type === "run.interrupted" || event.type === "run.cancelled"
      ? "warning"
      : "info";
  return ProjectSignalSchema.parse({
    id: `${projectId}:signal:event:${run.runId}:${event.seq}`,
    projectId,
    source,
    sourceRef: `${run.runId}:${event.seq}`,
    title: titleForEventType(event.type),
    summary: `${event.type} occurred in ${run.runId}${event.nodeId ? ` at ${event.nodeId}` : ""}.`,
    severity,
    confidence: event.type === "recovery.exhausted" ? 0.9 : 0.74,
    createdAt: event.createdAt,
    updatedAt: event.createdAt,
    evidence: [{
      id: `${run.runId}:evt-${event.seq}`,
      label: "Open Trails event",
      summary: event.type,
      target: {
        kind: "trail",
        id: `${run.runId}:evt-${event.seq}`,
        runId: run.runId,
        eventSeq: event.seq,
        tabHint: "Events",
      },
    }],
    metadata: {
      runId: run.runId,
      eventType: event.type,
      eventSeq: event.seq,
      nodeId: event.nodeId,
      agentId: event.agentId,
      modeId: run.modeId ?? run.pattern,
      pattern: run.pattern,
    },
  });
}

function signalsForEvaluationRun(projectId: string, run: EvaluationRun): ProjectSignal[] {
  const signals: ProjectSignal[] = [];
  const score = run.scorecard.overallScore;
  if (run.scorecard.regressionCount > 0 || run.scorecard.passRate < 0.8 || score < 0.7) {
    signals.push(ProjectSignalSchema.parse({
      id: `${projectId}:signal:evaluation:${run.id}:scorecard`,
      projectId,
      source: "evaluation_result",
      sourceRef: run.id,
      title: run.scorecard.regressionCount > 0 ? "Evaluation regression detected" : "Evaluation score is low",
      summary: `Evaluation ${run.id} scored ${Math.round(score * 100)}% with ${run.scorecard.regressionCount} regressions.`,
      severity: run.scorecard.regressionCount > 0 || score < 0.5 ? "critical" : "warning",
      confidence: 0.82,
      createdAt: run.startedAt,
      updatedAt: run.updatedAt,
      evidence: [{
        id: `${run.id}:scorecard`,
        label: "Open Evaluation run",
        target: {
          kind: "evaluation",
          id: run.id,
          evaluationRunId: run.id,
          datasetId: run.spec.datasetId,
        },
      }],
      metadata: {
        evaluationRunId: run.id,
        datasetId: run.spec.datasetId,
        profileId: run.spec.profileId,
        regression: run.scorecard.regressionCount > 0,
        regressionCount: run.scorecard.regressionCount,
        passRate: run.scorecard.passRate,
        overallScore: score,
      },
    }));
  }
  return signals;
}

function signalsForFeedback(projectId: string, feedback: EvaluationFeedbackRecord): ProjectSignal[] {
  if (feedback.status !== "pending" && feedback.status !== "failed" && feedback.status !== "accepted") {
    return [];
  }
  const severity = feedback.status === "failed"
    ? "critical"
    : feedback.status === "pending"
      ? "warning"
      : "info";
  return [ProjectSignalSchema.parse({
    id: `${projectId}:signal:feedback:${feedback.id}:${feedback.status}`,
    projectId,
    source: "evaluation_feedback",
    sourceRef: feedback.id,
    title: feedback.status === "pending"
      ? "Feedback pending review"
      : feedback.status === "failed"
        ? "Feedback curation failed"
        : "Feedback accepted into Evaluation",
    summary: feedback.feedbackText,
    severity,
    confidence: feedback.status === "accepted" ? 0.7 : 0.84,
    createdAt: feedback.createdAt,
    updatedAt: feedback.updatedAt,
    evidence: [{
      id: feedback.id,
      label: "Open feedback record",
      target: {
        kind: "feedback",
        id: feedback.id,
        feedbackId: feedback.id,
        runId: feedback.sourceRunId,
        datasetId: feedback.datasetId,
      },
    }],
    metadata: {
      feedbackId: feedback.id,
      feedbackStatus: feedback.status,
      sourceRunId: feedback.sourceRunId,
      failureMode: feedback.draft.case.metadata.failureMode,
      tags: feedback.draft.case.metadata.tags,
      datasetId: feedback.datasetId,
      acceptedCaseId: feedback.acceptedCaseId,
    },
  })];
}

function buildInsight(params: {
  projectId: string;
  id: string;
  title: string;
  summary: string;
  signalIds: string[];
  confidence: number;
  updatedAt: number;
  actions: ProjectSignalAction[];
}): ProjectInsight {
  return ProjectInsightSchema.parse({
    id: params.id,
    projectId: params.projectId,
    title: params.title,
    summary: params.summary,
    status: "open",
    signalIds: params.signalIds,
    recommendedActions: params.actions,
    confidence: params.confidence,
    createdAt: params.updatedAt,
    updatedAt: params.updatedAt,
  });
}

function openTrailsAction(signal: ProjectSignal): ProjectSignalAction {
  const runId = String(signal.metadata.runId ?? signal.evidence[0]?.target.runId ?? "");
  return {
    id: `open-trails:${runId}`,
    kind: "open_trails",
    label: "Open Trails evidence",
    payload: { runId },
    requiresConfirmation: true,
  };
}

function openEvaluationFeedbackAction(): ProjectSignalAction {
  return {
    id: "open-evaluation-feedback",
    kind: "open_evaluation_feedback",
    label: "Open Feedback Inbox",
    payload: { view: "evaluation.feedback" },
    requiresConfirmation: true,
  };
}

function openEvaluationRunAction(signal: ProjectSignal): ProjectSignalAction {
  return {
    id: `open-evaluation:${String(signal.metadata.evaluationRunId ?? "latest")}`,
    kind: "open_evaluation_run",
    label: "Open Evaluation run",
    payload: { evaluationRunId: signal.metadata.evaluationRunId },
    requiresConfirmation: true,
  };
}

function createEvaluationCaseAction(projectId: string, label: string): ProjectSignalAction {
  return {
    id: `create-evaluation-case:${projectId}`,
    kind: "create_evaluation_case",
    label,
    payload: { projectId },
    requiresConfirmation: true,
  };
}

function reviewModeRulesAction(projectId: string): ProjectSignalAction {
  return {
    id: `review-mode-rules:${projectId}`,
    kind: "review_mode_rules",
    label: "Review Mode Studio rules",
    payload: { projectId },
    requiresConfirmation: true,
  };
}

function defaultRulesForProject(projectId: string): FeedbackLoopCalibrationRule[] {
  return [
    {
      id: `${projectId}:rule:repeated_recovery_exhausted`,
      projectId,
      name: "Repeated recovery exhausted",
      enabled: true,
      sourceFilters: ["recovery_event"],
      severityThreshold: "warning",
      humanReviewRequired: true,
      actionPolicy: { allowedActionKinds: ["open_trails", "create_evaluation_case"] },
    },
    {
      id: `${projectId}:rule:feedback_pending_review`,
      projectId,
      name: "Feedback pending review",
      enabled: true,
      sourceFilters: ["evaluation_feedback"],
      severityThreshold: "info",
      humanReviewRequired: true,
      actionPolicy: { allowedActionKinds: ["open_evaluation_feedback"] },
    },
    {
      id: `${projectId}:rule:eval_regression`,
      projectId,
      name: "Evaluation regression",
      enabled: true,
      sourceFilters: ["evaluation_result"],
      severityThreshold: "warning",
      humanReviewRequired: true,
      actionPolicy: { allowedActionKinds: ["open_evaluation_run"] },
    },
    {
      id: `${projectId}:rule:approval_bottleneck`,
      projectId,
      name: "Approval bottleneck",
      enabled: true,
      sourceFilters: ["approval_event"],
      severityThreshold: "info",
      humanReviewRequired: true,
      actionPolicy: { allowedActionKinds: ["review_mode_rules"] },
    },
    {
      id: `${projectId}:rule:repeated_run_failures`,
      projectId,
      name: "Repeated run failures",
      enabled: true,
      sourceFilters: ["run_event"],
      severityThreshold: "warning",
      humanReviewRequired: true,
      actionPolicy: { allowedActionKinds: ["open_trails"] },
    },
  ].map((rule) => FeedbackLoopCalibrationRuleSchema.parse(rule));
}

function ruleAllows(rule: FeedbackLoopCalibrationRule, source: ProjectSignal["source"], severity: ProjectSignal["severity"]): boolean {
  return rule.enabled
    && (rule.sourceFilters.length === 0 || rule.sourceFilters.includes(source))
    && severityRank(severity) >= severityRank(rule.severityThreshold);
}

function filterActionsByRule(actions: ProjectSignalAction[], rule: FeedbackLoopCalibrationRule): ProjectSignalAction[] {
  const allowed = new Set(rule.actionPolicy.allowedActionKinds);
  return actions.filter((action) => allowed.size === 0 || allowed.has(action.kind));
}

function severityRank(severity: ProjectSignal["severity"]): number {
  if (severity === "critical") return 3;
  if (severity === "warning") return 2;
  return 1;
}

function projectIdForRun(run: StateSnapshot, sessionsById: Map<string, SessionSummary>): string {
  if (run.sessionId) {
    const projectId = sessionsById.get(run.sessionId)?.projectId;
    if (projectId) return projectId;
  }
  const contextProjectId = run.input.context.projectId;
  return typeof contextProjectId === "string" && contextProjectId.trim() ? contextProjectId : DEFAULT_PROJECT_ID;
}

function projectIdForEvaluationRun(run: EvaluationRun): string {
  for (const config of run.spec.configs) {
    const projectId = config.runConfig.metadata?.projectId;
    if (typeof projectId === "string" && projectId.trim()) {
      return projectId;
    }
  }
  return DEFAULT_PROJECT_ID;
}

function runEvidence(run: StateSnapshot, label: string, tabHint: string) {
  return {
    id: `${run.runId}:${tabHint.toLowerCase()}`,
    label,
    target: {
      kind: "trail" as const,
      id: run.runId,
      runId: run.runId,
      tabHint,
    },
  };
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const value = key(item);
    groups.set(value, [...(groups.get(value) ?? []), item]);
  }
  return groups;
}

function latestTimestamp(signals: ProjectSignal[]): number {
  return signals.reduce((latest, signal) => Math.max(latest, signal.updatedAt), 0);
}

function titleForEventType(type: string): string {
  return type
    .split(".")
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1).replace("_", " "))
    .join(" ");
}

function previewMessageForAction(action: ProjectSignalAction): string {
  switch (action.kind) {
    case "open_trails":
      return "This will route you to the run-level Trails evidence.";
    case "open_evaluation_feedback":
      return "This will open the Evaluation Feedback Inbox for curator review.";
    case "open_evaluation_run":
      return "This will open the Evaluation run that produced the regression signal.";
    case "create_evaluation_case":
      return "This will prepare an Evaluation case draft from the linked signal evidence.";
    case "review_mode_rules":
      return "This will take you to Mode Studio calibration settings for review.";
    case "retry_run":
      return "This will retry the linked run from the available checkpoint.";
  }
}

function appliedMessageForAction(action: ProjectSignalAction): string {
  return `${previewMessageForAction(action)} Marked as applied in Project Signals.`;
}
