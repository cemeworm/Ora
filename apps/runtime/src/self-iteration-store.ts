import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  SelfIterationCandidateApplyParamsSchema,
  SelfIterationCandidateEvaluateParamsSchema,
  SelfIterationCandidateGetParamsSchema,
  SelfIterationCandidateListParamsSchema,
  SelfIterationCandidateRejectParamsSchema,
  SelfIterationCandidateSchema,
  SelfIterationCuratorTriggerSchema,
  SelfIterationPolicyGetParamsSchema,
  SelfIterationPolicySchema,
  SelfIterationPolicyUpdateParamsSchema,
  SelfIterationRunSchema,
  SelfIterationScanParamsSchema,
  SelfIterationScanResultSchema,
  type EvaluationFeedbackRecord,
  type EvaluationRun,
  type ProjectInsight,
  type ProjectSignal,
  type ProjectSignalEvidence,
  type SelfIterationCandidate,
  type SelfIterationCuratorTrigger,
  type SelfIterationPolicy,
  type SelfIterationRun,
  type StateSnapshot,
} from "@cemeworm/shared";

const DEFAULT_PROJECT_ID = "local-project";

const SelfIterationStateSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  candidates: z.record(SelfIterationCandidateSchema).default({}),
  policies: z.record(SelfIterationPolicySchema).default({}),
  runs: z.array(SelfIterationRunSchema).default([]),
  curator: z.record(z.object({
    lastScanAt: z.number().int().nonnegative().optional(),
    lastTrigger: SelfIterationCuratorTriggerSchema.optional(),
  })).default({}),
});

type SelfIterationState = z.infer<typeof SelfIterationStateSchema>;

const SelfIterationCuratorTriggerParamsSchema = z.object({
  projectId: z.string().min(1).optional(),
  trigger: SelfIterationCuratorTriggerSchema.default("run_completed_idle"),
  force: z.boolean().default(false),
}).default({});

export interface SelfIterationDerivationInput {
  signals: ProjectSignal[];
  insights: ProjectInsight[];
  runs: StateSnapshot[];
  evaluationRuns: EvaluationRun[];
  feedbackRecords: EvaluationFeedbackRecord[];
  enrichCandidate?: (candidate: SelfIterationCandidate, input: SelfIterationDerivationInput) => Promise<SelfIterationCandidate>;
}

export interface SelfIterationApplyDeps {
  applyEvaluationCandidate(candidate: SelfIterationCandidate): unknown;
  applyPromptCandidate(candidate: SelfIterationCandidate): unknown;
  applySkillCandidate(candidate: SelfIterationCandidate): unknown;
  applyModeCandidate(candidate: SelfIterationCandidate): unknown;
  captureBeforeSnapshot?(candidate: SelfIterationCandidate): unknown;
  rollbackSnapshot?(candidate: SelfIterationCandidate): unknown;
}

export interface SelfIterationEvaluationOutcome {
  evaluationRunId?: string;
  passed?: boolean;
  message?: string;
  metadata?: Record<string, unknown>;
  proposedChangeAfter?: unknown;
  proposedChangeMetadata?: Record<string, unknown>;
}

export interface SelfIterationEvaluateDeps {
  evaluateCandidate(candidate: SelfIterationCandidate): SelfIterationEvaluationOutcome | Promise<SelfIterationEvaluationOutcome>;
}

export class LocalSelfIterationStore {
  private readonly statePath: string;
  private state: SelfIterationState;
  private readonly inflightEvaluations = new Set<string>();

  constructor(private readonly baseDir: string, private readonly clock: () => number = Date.now) {
    this.statePath = path.join(baseDir, "state.json");
    fs.mkdirSync(baseDir, { recursive: true });
    this.state = this.readState();
  }

  async scan(params: unknown, input: SelfIterationDerivationInput, deps: Pick<SelfIterationApplyDeps, "applyEvaluationCandidate">) {
    const parsed = SelfIterationScanParamsSchema.parse(params ?? {});
    const projectId = parsed.projectId ?? firstProjectId(input) ?? DEFAULT_PROJECT_ID;
    const generated = candidateGenerators(projectId, input, this.clock())
      .filter((candidate) => parsed.projectId ? candidate.projectId === parsed.projectId : true);
    const enriched = input.enrichCandidate
      ? await Promise.all(generated.map((c) => input.enrichCandidate!(c, input).catch(() => c)))
      : generated;
    const upserted = enriched.map((candidate) => this.upsertCandidate(candidate));
    const policy = this.policyForProject(projectId);
    const autoApplied: SelfIterationCandidate[] = [];
    if ((parsed.autoApplyEvaluation ?? policy.evaluationAutoApply) && policy.autonomy === "low_risk_auto") {
      for (const candidate of upserted.filter((item) => item.targetKind === "evaluation" && item.status === "draft")) {
        autoApplied.push(this.applyCandidate({ candidateId: candidate.id, confirmed: true }, deps));
      }
    }
    const run = this.recordRun({
      projectId,
      kind: "scan",
      candidateIds: upserted.map((candidate) => candidate.id),
      message: `Self-Iteration scan created or refreshed ${upserted.length} candidate${upserted.length === 1 ? "" : "s"}.`,
    });
    this.saveState();
    return SelfIterationScanResultSchema.parse({ run, candidates: upserted, autoApplied });
  }

  async triggerCuratorScan(params: unknown, input: SelfIterationDerivationInput, deps: Pick<SelfIterationApplyDeps, "applyEvaluationCandidate">) {
    const parsed = SelfIterationCuratorTriggerParamsSchema.parse(params ?? {});
    const projectId = parsed.projectId ?? firstProjectId(input) ?? DEFAULT_PROJECT_ID;
    const policy = this.policyForProject(projectId);
    const now = this.clock();
    const lastScanAt = this.state.curator[projectId]?.lastScanAt;
    if (!policy.curatorEnabled) {
      return { scanned: false as const, reason: "disabled", projectId, trigger: parsed.trigger };
    }
    if (!parsed.force && typeof lastScanAt === "number" && now - lastScanAt < policy.scanCadenceMs) {
      return { scanned: false as const, reason: "cadence", projectId, trigger: parsed.trigger, lastScanAt };
    }
    const result = await this.scan({ projectId }, input, deps);
    this.state.curator[projectId] = { lastScanAt: now, lastTrigger: parsed.trigger };
    this.saveState();
    return { scanned: true as const, projectId, trigger: parsed.trigger, result };
  }

  listCandidates(params: unknown = {}) {
    const parsed = SelfIterationCandidateListParamsSchema.parse(params ?? {});
    return Object.values(this.state.candidates)
      .filter((candidate) => parsed.projectId ? candidate.projectId === parsed.projectId : true)
      .filter((candidate) => parsed.targetKind ? candidate.targetKind === parsed.targetKind : true)
      .filter((candidate) => parsed.status ? candidate.status === parsed.status : true)
      .sort((left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id))
      .slice(0, parsed.limit)
      .map((candidate) => SelfIterationCandidateSchema.parse(candidate));
  }

  getCandidate(params: unknown) {
    const parsed = SelfIterationCandidateGetParamsSchema.parse(params);
    const candidate = this.state.candidates[parsed.candidateId];
    if (!candidate) {
      throw new Error(`Self-Iteration candidate not found: ${parsed.candidateId}`);
    }
    return SelfIterationCandidateSchema.parse(candidate);
  }

  async evaluateCandidate(params: unknown, deps?: SelfIterationEvaluateDeps) {
    const parsed = SelfIterationCandidateEvaluateParamsSchema.parse(params);
    const candidate = this.getCandidate(parsed);
    if (this.inflightEvaluations.has(candidate.id)) {
      throw new Error(`Candidate ${candidate.id} is already being evaluated.`);
    }
    this.inflightEvaluations.add(candidate.id);
    const evaluating = SelfIterationCandidateSchema.parse({
      ...candidate,
      status: "evaluating",
      updatedAt: this.clock(),
    });
    this.state.candidates[evaluating.id] = evaluating;
    this.saveState();

    try {
      const outcome = deps
        ? await deps.evaluateCandidate(evaluating)
        : { evaluationRunId: candidate.evaluationRunId ?? `self-iteration-eval:${candidate.id}`, passed: true };
      const next = SelfIterationCandidateSchema.parse({
        ...evaluating,
        status: outcome.passed === false ? "failed" : "ready",
        evaluationRunId: outcome.evaluationRunId ?? evaluating.evaluationRunId ?? `self-iteration-eval:${evaluating.id}`,
        proposedChange: {
          ...evaluating.proposedChange,
          after: outcome.proposedChangeAfter ?? evaluating.proposedChange.after,
          metadata: {
            ...evaluating.proposedChange.metadata,
            ...(outcome.proposedChangeMetadata ?? {}),
            selfIterationEvaluation: {
              passed: outcome.passed !== false,
              message: outcome.message ?? "Candidate evaluation completed.",
              ...(outcome.metadata ?? {}),
            },
          },
        },
        updatedAt: this.clock(),
      });
      this.state.candidates[next.id] = next;
      this.recordRun({
        projectId: next.projectId,
        kind: "evaluate",
        candidateIds: [next.id],
        status: next.status === "failed" ? "failed" : "succeeded",
        message: outcome.message ?? `Candidate ${next.id} is ${next.status === "failed" ? "blocked by evaluation" : "ready for review"}.`,
        metadata: { evaluationRunId: next.evaluationRunId, passed: next.status !== "failed" },
      });
      this.saveState();
      return next;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const next = SelfIterationCandidateSchema.parse({
        ...evaluating,
        status: "failed",
        proposedChange: {
          ...evaluating.proposedChange,
          metadata: {
            ...evaluating.proposedChange.metadata,
            selfIterationEvaluation: { passed: false, message },
          },
        },
        updatedAt: this.clock(),
      });
      this.state.candidates[next.id] = next;
      this.recordRun({
        projectId: next.projectId,
        kind: "evaluate",
        candidateIds: [next.id],
        status: "failed",
        message,
      });
      this.saveState();
      return next;
    } finally {
      this.inflightEvaluations.delete(candidate.id);
    }
  }

  rejectCandidate(params: unknown) {
    const parsed = SelfIterationCandidateRejectParamsSchema.parse(params);
    const candidate = this.getCandidate(parsed);
    const next = SelfIterationCandidateSchema.parse({
      ...candidate,
      status: "rejected",
      rejectionReason: parsed.reason?.trim(),
      updatedAt: this.clock(),
    });
    this.state.candidates[next.id] = next;
    this.saveState();
    return next;
  }

  isEvaluating(candidateId: string): boolean {
    return this.inflightEvaluations.has(candidateId);
  }

  updateCandidateVerification(candidateId: string, verification: Record<string, unknown>): void {
    const candidate = this.state.candidates[candidateId];
    if (!candidate) return;
    this.state.candidates[candidateId] = SelfIterationCandidateSchema.parse({
      ...candidate,
      verification: { ...(candidate.verification ?? {}), ...verification },
      updatedAt: this.clock(),
    });
    this.saveState();
  }

  applyCandidate(params: unknown, deps: SelfIterationApplyDeps | Pick<SelfIterationApplyDeps, "applyEvaluationCandidate">) {
    const parsed = SelfIterationCandidateApplyParamsSchema.parse(params);
    const candidate = this.getCandidate(parsed);
    const policy = this.policyForProject(candidate.projectId);
    const evaluation = selfIterationEvaluationMetadata(candidate);
    if (candidate.targetKind !== "evaluation" && evaluation?.passed === false && !parsed.confirmed) {
      throw new Error(`${candidate.targetKind} self-iteration candidates failed evaluation and require explicit override confirmation before apply.`);
    }
    if (candidate.targetKind !== "evaluation" && !parsed.confirmed && requiresConfirmation(candidate, policy)) {
      throw new Error(`${candidate.targetKind} self-iteration candidates require confirmation before apply.`);
    }
    const beforeSnapshot = "captureBeforeSnapshot" in deps ? deps.captureBeforeSnapshot?.(candidate) : undefined;
    const applyResult = applyCandidateChange(candidate, deps);
    const evaluationMeta = selfIterationEvaluationMetadata(candidate);
    const verification = candidate.targetKind !== "evaluation" && evaluationMeta?.score != null ? {
      status: "pending" as const,
      baselineScore: evaluationMeta.score as number,
      baselinePassRate: evaluationMeta.passRate as number | undefined,
    } : candidate.verification;
    const next = SelfIterationCandidateSchema.parse({
      ...candidate,
      status: "applied",
      applyResult,
      beforeSnapshot: beforeSnapshot ?? candidate.beforeSnapshot,
      verification,
      updatedAt: this.clock(),
    });
    this.state.candidates[next.id] = next;
    this.recordRun({
      projectId: next.projectId,
      kind: "apply",
      candidateIds: [next.id],
      message: `Applied Self-Iteration candidate ${next.id}.`,
      metadata: { targetKind: next.targetKind },
    });
    this.saveState();
    return next;
  }

  rollbackCandidate(params: unknown, deps: SelfIterationApplyDeps) {
    const parsed = SelfIterationCandidateGetParamsSchema.parse(params);
    const candidate = this.getCandidate(parsed);
    if (candidate.status !== "applied") {
      throw new Error(`Candidate ${candidate.id} is not in applied state.`);
    }
    if (!candidate.beforeSnapshot && !deps.rollbackSnapshot) {
      throw new Error(`No rollback snapshot available for candidate ${candidate.id}.`);
    }
    if (deps.rollbackSnapshot) {
      deps.rollbackSnapshot(candidate);
    }
    const next = SelfIterationCandidateSchema.parse({
      ...candidate,
      status: "rejected",
      rejectionReason: "Rolled back by user.",
      updatedAt: this.clock(),
    });
    this.state.candidates[next.id] = next;
    this.recordRun({
      projectId: next.projectId,
      kind: "apply",
      candidateIds: [next.id],
      message: `Rolled back Self-Iteration candidate ${next.id}.`,
    });
    this.saveState();
    return next;
  }

  getPolicy(params: unknown = {}) {
    const parsed = SelfIterationPolicyGetParamsSchema.parse(params ?? {});
    return this.policyForProject(parsed.projectId ?? DEFAULT_PROJECT_ID);
  }

  updatePolicy(params: unknown) {
    const parsed = SelfIterationPolicyUpdateParamsSchema.parse(params);
    const policy = SelfIterationPolicySchema.parse({ ...parsed.policy, updatedAt: this.clock() });
    this.state.policies[policy.projectId] = policy;
    this.saveState();
    return policy;
  }

  private upsertCandidate(candidate: SelfIterationCandidate) {
    const existing = this.state.candidates[candidate.id];
    if (existing && existing.status !== "draft" && existing.status !== "evaluating") {
      return SelfIterationCandidateSchema.parse(existing);
    }
    const next = SelfIterationCandidateSchema.parse({
      ...candidate,
      createdAt: existing?.createdAt ?? candidate.createdAt,
      updatedAt: this.clock(),
    });
    this.state.candidates[next.id] = next;
    return next;
  }

  private policyForProject(projectId: string): SelfIterationPolicy {
    const existing = this.state.policies[projectId];
    if (existing) return SelfIterationPolicySchema.parse(existing);
    const policy = SelfIterationPolicySchema.parse({ projectId, updatedAt: this.clock() });
    this.state.policies[projectId] = policy;
    return policy;
  }

  private recordRun(params: {
    projectId: string;
    kind: SelfIterationRun["kind"];
    candidateIds: string[];
    message: string;
    status?: SelfIterationRun["status"];
    metadata?: Record<string, unknown>;
  }) {
    const run = SelfIterationRunSchema.parse({
      id: `self-iteration-run-${String(this.state.runs.length + 1).padStart(4, "0")}`,
      projectId: params.projectId,
      kind: params.kind,
      candidateIds: params.candidateIds,
      status: params.status ?? "succeeded",
      message: params.message,
      createdAt: this.clock(),
      metadata: params.metadata ?? {},
    });
    this.state.runs.push(run);
    return run;
  }

  private readState(): SelfIterationState {
    if (!fs.existsSync(this.statePath)) {
      return SelfIterationStateSchema.parse({});
    }
    try {
      return SelfIterationStateSchema.parse(JSON.parse(fs.readFileSync(this.statePath, "utf8")));
    } catch {
      const tmpPath = `${this.statePath}.tmp`;
      if (fs.existsSync(tmpPath)) {
        try {
          return SelfIterationStateSchema.parse(JSON.parse(fs.readFileSync(tmpPath, "utf8")));
        } catch {
          // tmp backup also corrupted
        }
      }
      return SelfIterationStateSchema.parse({});
    }
  }

  private saveState(): void {
    const tmpPath = `${this.statePath}.tmp`;
    const serialized = `${JSON.stringify(SelfIterationStateSchema.parse(this.state), null, 2)}\n`;
    fs.writeFileSync(tmpPath, serialized, "utf8");
    fs.renameSync(tmpPath, this.statePath);
  }
}

function candidateGenerators(projectId: string, input: SelfIterationDerivationInput, now: number): SelfIterationCandidate[] {
  return [
    ...feedbackEvaluationCandidates(projectId, input, now),
    ...runtimePromptCandidates(projectId, input, now),
    ...environmentObserverCandidates(projectId, input, now),
    ...modeCandidates(projectId, input, now),
    ...skillCandidates(projectId, input, now),
  ];
}

function feedbackEvaluationCandidates(projectId: string, input: SelfIterationDerivationInput, now: number): SelfIterationCandidate[] {
  return input.feedbackRecords
    .filter((feedback) => feedback.status === "pending")
    .map((feedback) => buildCandidate({
      id: `${projectId}:self:evaluation:${feedback.id}`,
      projectId,
      targetKind: "evaluation",
      targetRef: { kind: "evaluation", id: feedback.id, feedbackId: feedback.id },
      title: "Turn feedback into an Evaluation case",
      summary: feedback.feedbackText,
      evidence: feedbackEvidence(feedback),
      proposedChange: {
        operation: "evaluation.feedback.accept",
        title: "Accept feedback into Evaluation Studio",
        summary: "Add this reviewed feedback as regression material.",
        metadata: { feedbackId: feedback.id },
      },
      riskLevel: "low",
      now,
    }));
}

function runtimePromptCandidates(projectId: string, input: SelfIterationDerivationInput, now: number): SelfIterationCandidate[] {
  const signals = input.signals.filter((signal) =>
    signal.projectId === projectId
    && ((signal.source === "recovery_event" && signal.severity === "critical") || signal.metadata.runStatus === "failed")
  );
  return uniqueBy(signals, (signal) => String(signal.metadata.modeId ?? "unknown-mode")).map((signal) => {
    const modeId = String(signal.metadata.modeId ?? signal.metadata.pattern ?? "single_agent");
    return buildCandidate({
      id: `${projectId}:self:prompt:${modeId}`,
      projectId,
      targetKind: "prompt",
      targetRef: { kind: "prompt", id: modeId, modeId },
      title: `Tighten prompt guidance for ${modeId}`,
      summary: "Repeated runtime failure evidence suggests the mode needs more explicit recovery and success criteria guidance.",
      evidence: signal.evidence,
      proposedChange: {
        operation: "mode.node.prompt.update",
        title: "Add failure-aware prompt guidance",
        summary: "Append a short evidence-backed instruction to the first editable mode node.",
        after: "Before finalizing, state assumptions, verify tool outcomes, and surface blockers with concrete next steps.",
        metadata: { modeId, sourceSignalId: signal.id },
      },
      riskLevel: "high",
      now,
    });
  });
}

function environmentObserverCandidates(projectId: string, input: SelfIterationDerivationInput, now: number): SelfIterationCandidate[] {
  const signals = input.signals
    .filter((signal) => signal.projectId === projectId && signal.source === "project_file" && signal.metadata.observerKind === "environment_snapshot")
    .slice(0, 1);
  return signals.map((signal) => buildCandidate({
    id: `${projectId}:self:mode:environment-observer`,
    projectId,
    targetKind: "mode",
    targetRef: { kind: "mode", id: "environment-observer" },
    title: "Review mode orchestration from environment observer context",
    summary: "Opt-in workspace observation found scoped file metadata and run-context signals that may improve mode orchestration.",
    evidence: signal.evidence.length > 0 ? signal.evidence : [{
      id: signal.id,
      label: "Environment observer snapshot",
      summary: signal.summary,
      target: { kind: "project_file", id: signal.sourceRef },
    }],
    proposedChange: {
      operation: "mode.studio.generateDraft",
      title: "Open a Mode Studio draft from environment context",
      summary: "Use metadata-only project observation to draft conservative, reviewable mode improvements.",
      metadata: { sourceSignalId: signal.id, observerKind: "environment_snapshot" },
    },
    riskLevel: "high",
    now,
  }));
}

function modeCandidates(projectId: string, input: SelfIterationDerivationInput, now: number): SelfIterationCandidate[] {
  return input.insights
    .filter((insight) => insight.projectId === projectId && insight.status === "open")
    .filter((insight) => /recovery|approval|evaluation|drift/i.test(`${insight.id} ${insight.title}`))
    .slice(0, 3)
    .map((insight) => buildCandidate({
      id: `${projectId}:self:mode:${slugPart(insight.id)}`,
      projectId,
      targetKind: "mode",
      targetRef: { kind: "mode", id: insight.id },
      title: "Review mode orchestration from clustered signals",
      summary: insight.summary,
      evidence: insight.signalIds.map((id) => insightEvidence(insight, id)),
      proposedChange: {
        operation: "mode.studio.generateDraft",
        title: "Open a Mode Studio improvement draft",
        summary: "Use Mode Studio to refine stages, prompts, tools, or approval policy from this evidence cluster.",
        metadata: { insightId: insight.id },
      },
      riskLevel: "high",
      now,
    }));
}

function skillCandidates(projectId: string, input: SelfIterationDerivationInput, now: number): SelfIterationCandidate[] {
  const successful = input.runs.filter((run) => run.status === "succeeded" && run.toolCalls.length >= 2).slice(0, 1);
  return successful.map((run) => {
    const skillName = `learned-${run.modeId ?? run.pattern}`.replace(/[^a-z0-9-]/gi, "-").toLowerCase().replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "learned-workflow";
    const content = `---\nname: ${skillName}\ndescription: Evidence-backed workflow distilled from a successful Ora run.\n---\nUse this skill when a request resembles run ${run.runId}. Start by restating success criteria, inspect relevant context, execute the minimum necessary tools, and verify the outcome before final response.\n`;
    return buildCandidate({
      id: `${projectId}:self:skill:${run.runId}`,
      projectId,
      targetKind: "skill",
      targetRef: { kind: "skill", id: skillName, skillName },
      title: `Create skill draft from ${run.runId}`,
      summary: "A successful multi-tool workflow can be captured as procedural memory.",
      evidence: [runEvidence(run)],
      proposedChange: {
        operation: "skills.create",
        title: `Create ${skillName}`,
        summary: "Create a private editable skill draft from the observed workflow.",
        after: { name: skillName, description: "Evidence-backed workflow distilled from a successful Ora run.", content },
        metadata: { runId: run.runId, skillName },
      },
      riskLevel: "high",
      now,
    });
  });
}

function buildCandidate(params: Omit<SelfIterationCandidate, "status" | "createdAt" | "updatedAt"> & { now: number }) {
  return SelfIterationCandidateSchema.parse({
    ...params,
    evidence: params.evidence.length > 0 ? params.evidence : [fallbackEvidence(params.targetKind, params.targetRef.id)],
    status: "draft",
    createdAt: params.now,
    updatedAt: params.now,
  });
}

function requiresConfirmation(candidate: SelfIterationCandidate, policy: SelfIterationPolicy) {
  if (candidate.targetKind === "prompt") return policy.promptApplyRequiresConfirmation;
  if (candidate.targetKind === "mode") return policy.modeApplyRequiresConfirmation;
  if (candidate.targetKind === "skill") return policy.skillApplyRequiresConfirmation;
  return false;
}

function applyCandidateChange(candidate: SelfIterationCandidate, deps: Partial<SelfIterationApplyDeps>) {
  const result = candidate.targetKind === "evaluation" ? deps.applyEvaluationCandidate?.(candidate) ?? { applied: true }
    : candidate.targetKind === "prompt" ? deps.applyPromptCandidate?.(candidate) ?? { applied: true }
      : candidate.targetKind === "skill" ? deps.applySkillCandidate?.(candidate) ?? { applied: true }
        : candidate.targetKind === "mode" ? deps.applyModeCandidate?.(candidate) ?? { applied: true }
          : { applied: true };
  const evaluation = selfIterationEvaluationMetadata(candidate);
  if (!evaluation) return result;
  return evaluation.scoreEvidence
    ? { result, evaluation, scoreEvidence: evaluation.scoreEvidence }
    : { result, evaluation };
}

function selfIterationEvaluationMetadata(candidate: SelfIterationCandidate): Record<string, unknown> | undefined {
  const value = candidate.proposedChange.metadata.selfIterationEvaluation;
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const safetyGate = record.safetyGate && typeof record.safetyGate === "object" ? record.safetyGate as Record<string, unknown> : undefined;
  const impactEvaluation = record.impactEvaluation && typeof record.impactEvaluation === "object" ? record.impactEvaluation as Record<string, unknown> : undefined;
  const scoreEvidence = safetyGate?.scoreEvidence ?? impactEvaluation?.scoreEvidence ?? record.scoreEvidence;
  return {
    passed: typeof record.passed === "boolean" ? record.passed : undefined,
    message: typeof record.message === "string" ? record.message : undefined,
    evaluationRunId: candidate.evaluationRunId,
    gateKind: typeof record.gateKind === "string" ? record.gateKind : undefined,
    safetyGate: record.safetyGate,
    impactEvaluation: record.impactEvaluation,
    score: typeof record.score === "number" ? record.score : undefined,
    passRate: typeof record.passRate === "number" ? record.passRate : undefined,
    regressionCount: typeof record.regressionCount === "number" ? record.regressionCount : undefined,
    totalAttempts: typeof record.totalAttempts === "number" ? record.totalAttempts : undefined,
    scoreEvidence,
  };
}

function firstProjectId(input: SelfIterationDerivationInput): string | undefined {
  return input.signals[0]?.projectId ?? input.insights[0]?.projectId;
}

function uniqueBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const id = key(item);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function slugPart(value: string): string {
  return value.replace(/[^a-z0-9_-]/gi, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(-64) || "insight";
}

function feedbackEvidence(feedback: EvaluationFeedbackRecord): ProjectSignalEvidence[] {
  return [{
    id: feedback.id,
    label: "Evaluation feedback",
    summary: feedback.feedbackText,
    target: {
      kind: "feedback",
      id: feedback.id,
      feedbackId: feedback.id,
      runId: feedback.sourceRunId,
      datasetId: feedback.datasetId,
    },
  }];
}

function insightEvidence(insight: ProjectInsight, signalId: string): ProjectSignalEvidence {
  return {
    id: `${insight.id}:${signalId}`,
    label: "Project insight signal",
    summary: insight.summary,
    target: { kind: "trail", id: signalId },
  };
}

function runEvidence(run: StateSnapshot): ProjectSignalEvidence {
  return {
    id: run.runId,
    label: "Successful run",
    summary: run.input.prompt,
    target: { kind: "run", id: run.runId, runId: run.runId },
  };
}

function fallbackEvidence(kind: string, id: string): ProjectSignalEvidence {
  return {
    id: `${kind}:${id}`,
    label: "Self-Iteration evidence",
    target: { kind: "project_file", id },
  };
}
