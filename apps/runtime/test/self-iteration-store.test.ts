import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LocalSelfIterationStore } from "../src/self-iteration-store.js";
import { LocalRunStore } from "../src/run-store.js";
import type { EvaluationFeedbackRecord, ProjectInsight, ProjectSignal, StateSnapshot } from "@cemeworm/shared";

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ora-self-iteration-"));
}

describe("LocalSelfIterationStore", () => {
  it("creates and auto-applies evaluation candidates under low-risk policy", () => {
    const store = new LocalSelfIterationStore(tempDir(), () => 1000);
    const applied: string[] = [];
    const feedback = feedbackRecord("feedback-1", "The answer missed the required citation.");
    const result = store.scan({}, {
      signals: [],
      insights: [],
      runs: [],
      evaluationRuns: [],
      feedbackRecords: [feedback],
    }, {
      applyEvaluationCandidate: (candidate) => {
        applied.push(candidate.targetRef.feedbackId ?? "");
        return { acceptedFeedbackId: candidate.targetRef.feedbackId };
      },
    });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.targetKind).toBe("evaluation");
    expect(result.autoApplied[0]?.status).toBe("applied");
    expect(applied).toEqual(["feedback-1"]);
  });

  it("requires confirmation before applying prompt candidates", () => {
    const store = new LocalSelfIterationStore(tempDir(), () => 2000);
    const signal = recoverySignal();
    store.scan({ autoApplyEvaluation: false }, {
      signals: [signal],
      insights: [],
      runs: [],
      evaluationRuns: [],
      feedbackRecords: [],
    }, {
      applyEvaluationCandidate: () => ({ applied: true }),
    });
    const candidate = store.listCandidates({ targetKind: "prompt" })[0]!;

    expect(() => store.applyCandidate({ candidateId: candidate.id }, {
      applyEvaluationCandidate: () => ({ applied: true }),
      applyPromptCandidate: () => ({ applied: true }),
      applySkillCandidate: () => ({ applied: true }),
      applyModeCandidate: () => ({ applied: true }),
    })).toThrow(/require confirmation/);

    const applied = store.applyCandidate({ candidateId: candidate.id, confirmed: true }, {
      applyEvaluationCandidate: () => ({ applied: true }),
      applyPromptCandidate: () => ({ modeId: "single_agent" }),
      applySkillCandidate: () => ({ applied: true }),
      applyModeCandidate: () => ({ applied: true }),
    });
    expect(applied.status).toBe("applied");
    expect(applied.applyResult).toEqual({ modeId: "single_agent" });
  });

  it("attaches real evaluation outcome metadata before review", async () => {
    const store = new LocalSelfIterationStore(tempDir(), () => 2500);
    const signal = recoverySignal();
    store.scan({ autoApplyEvaluation: false }, {
      signals: [signal],
      insights: [],
      runs: [],
      evaluationRuns: [],
      feedbackRecords: [],
    }, {
      applyEvaluationCandidate: () => ({ applied: true }),
    });
    const candidate = store.listCandidates({ targetKind: "prompt" })[0]!;

    const evaluated = await store.evaluateCandidate({ candidateId: candidate.id }, {
      evaluateCandidate: () => ({
        evaluationRunId: "eval-real-1",
        passed: false,
        message: "Regression gate failed.",
        metadata: { passRate: 0 },
      }),
    });

    expect(evaluated.status).toBe("failed");
    expect(evaluated.evaluationRunId).toBe("eval-real-1");
    expect(evaluated.proposedChange.metadata.selfIterationEvaluation).toMatchObject({
      passed: false,
      message: "Regression gate failed.",
      passRate: 0,
    });
    expect(() => store.applyCandidate({ candidateId: candidate.id }, {
      applyEvaluationCandidate: () => ({ applied: true }),
      applyPromptCandidate: () => ({ applied: true }),
      applySkillCandidate: () => ({ applied: true }),
      applyModeCandidate: () => ({ applied: true }),
    })).toThrow(/failed evaluation/);
  });

  it("runs candidate evaluation through Evaluation Studio", async () => {
    let now = 7000;
    const runtime = new LocalRunStore({ dataDir: tempDir(), clock: () => now++ });
    const handle = await runtime.startRun({
      input: { prompt: "Original answer should be improved.", context: {}, createdAt: now++ },
      config: {
        pattern: "orchestrator_subagent",
        modeId: "single_agent",
        modeSelection: "manual",
        providerId: "local-smoke",
        modelRef: "local/smoke-model",
        metadata: { evaluationRouterOnly: true },
      },
    });
    const feedback = await runtime.submitEvaluationFeedback({ runId: handle.runId, feedbackText: "Capture this as a regression case." });
    if (feedback.status !== "pending") {
      runtime.updateEvaluationFeedback({ feedbackId: feedback.id, draftCase: feedback.draft.case });
    }
    const scan = runtime.scanSelfIteration({ autoApplyEvaluation: false });
    const candidate = scan.candidates.find((item) => item.targetKind === "evaluation")!;

    const evaluated = await runtime.evaluateSelfIterationCandidate({ candidateId: candidate.id });
    const evaluationRunId = evaluated.evaluationRunId!;
    const detail = runtime.getEvaluationRun({ evaluationRunId });

    expect(evaluated.status).toBe("ready");
    expect(evaluationRunId).toMatch(/^eval-run-/);
    expect(detail.run.status).toBe("succeeded");
    expect(detail.run.totalAttempts).toBe(2);
    expect(evaluated.proposedChange.metadata.selfIterationEvaluation).toMatchObject({
      passed: true,
      totalAttempts: 2,
      scoreEvidence: {
        evaluationRunId,
        before: { configId: "self-iteration-before" },
        after: { configId: "self-iteration-after" },
        delta: { overallScore: 0, passRate: 0, regressionCount: 0 },
      },
    });

    const applied = runtime.applySelfIterationCandidate({ candidateId: candidate.id });
    expect(applied.applyResult).toMatchObject({
      scoreEvidence: {
        evaluationRunId,
        before: { configId: "self-iteration-before" },
        after: { configId: "self-iteration-after" },
      },
    });
  });

  it("keeps invalid generated mode drafts from being applied", async () => {
    const store = new LocalSelfIterationStore(tempDir(), () => 2800);
    store.scan({ autoApplyEvaluation: false }, {
      signals: [],
      insights: [modeInsight()],
      runs: [],
      evaluationRuns: [],
      feedbackRecords: [],
    }, {
      applyEvaluationCandidate: () => ({ applied: true }),
    });
    const candidate = store.listCandidates({ targetKind: "mode" })[0]!;
    await store.evaluateCandidate({ candidateId: candidate.id }, {
      evaluateCandidate: () => ({
        evaluationRunId: "eval-mode-invalid",
        passed: true,
        message: "Generated draft failed Mode Studio validation.",
        metadata: {
          scoreEvidence: {
            evaluationRunId: "eval-mode-invalid",
            before: { configId: "self-iteration-before", overallScore: 1, passRate: 1, regressionCount: 0, caseCount: 1 },
            after: { configId: "self-iteration-after", overallScore: 1, passRate: 1, regressionCount: 0, caseCount: 1 },
            delta: { overallScore: 0, passRate: 0, regressionCount: 0 },
          },
        },
        proposedChangeAfter: {
          modeDraft: { id: "broken-mode" },
          validation: { valid: false, errors: ["Mode draft is missing nodes."], warnings: [] },
          needsInput: false,
        },
      }),
    });

    expect(() => store.applyCandidate({ candidateId: candidate.id, confirmed: true }, {
      applyEvaluationCandidate: () => ({ applied: true }),
      applyPromptCandidate: () => ({ applied: true }),
      applySkillCandidate: () => ({ applied: true }),
      applyModeCandidate: () => {
        throw new Error("Mode Studio draft is invalid: Mode draft is missing nodes.");
      },
    })).toThrow(/Mode Studio draft is invalid/);
    expect(store.getCandidate({ candidateId: candidate.id }).status).toBe("ready");
  });

  it("creates skill candidates from successful multi-tool runs", () => {
    const store = new LocalSelfIterationStore(tempDir(), () => 3000);
    store.scan({ autoApplyEvaluation: false }, {
      signals: [],
      insights: [],
      runs: [successfulRun()],
      evaluationRuns: [],
      feedbackRecords: [],
    }, {
      applyEvaluationCandidate: () => ({ applied: true }),
    });
    const candidate = store.listCandidates({ targetKind: "skill" })[0]!;
    expect(candidate.proposedChange.operation).toBe("skills.create");
    expect(candidate.proposedChange.after).toMatchObject({ name: "learned-single-agent" });
  });

  it("deduplicates opportunistic curator scans by project cadence", () => {
    let now = 4000;
    const dir = tempDir();
    const store = new LocalSelfIterationStore(dir, () => now);
    store.updatePolicy({
      policy: {
        projectId: "local-project",
        scanCadenceMs: 1000,
        updatedAt: now,
      },
    });
    const input = {
      signals: [],
      insights: [],
      runs: [],
      evaluationRuns: [],
      feedbackRecords: [feedbackRecord("feedback-cadence", "Add a regression case.")],
    };
    const deps = { applyEvaluationCandidate: () => ({ applied: true }) };

    const first = store.triggerCuratorScan({ trigger: "feedback_submitted" }, input, deps);
    expect(first.scanned).toBe(true);
    const second = store.triggerCuratorScan({ trigger: "run_completed_idle" }, input, deps);
    expect(second).toMatchObject({ scanned: false, reason: "cadence", projectId: "local-project" });

    now = 5001;
    const third = store.triggerCuratorScan({ trigger: "run_completed_idle" }, input, deps);
    expect(third.scanned).toBe(true);

    const reloaded = new LocalSelfIterationStore(dir, () => now);
    const skipped = reloaded.triggerCuratorScan({ trigger: "feedback_submitted" }, input, deps);
    expect(skipped).toMatchObject({ scanned: false, reason: "cadence", projectId: "local-project" });
  });

  it("creates opt-in environment observer signals without raw file content", () => {
    const workspaceDir = tempDir();
    fs.mkdirSync(path.join(workspaceDir, "src"), { recursive: true });
    fs.mkdirSync(path.join(workspaceDir, "node_modules", "pkg"), { recursive: true });
    fs.writeFileSync(path.join(workspaceDir, "src", "alpha.ts"), "export const secret = 'do-not-read';\n", "utf8");
    fs.writeFileSync(path.join(workspaceDir, "README.md"), "Project notes\n", "utf8");
    fs.writeFileSync(path.join(workspaceDir, "node_modules", "pkg", "ignored.js"), "ignored\n", "utf8");

    const runtime = new LocalRunStore({ dataDir: tempDir(), clock: () => 6500 });
    const project = runtime.createProject({ rootPath: workspaceDir, label: "Observed" });
    const basePolicy = runtime.getSelfIterationPolicy({ projectId: project.projectId });
    runtime.updateSelfIterationPolicy({
      policy: {
        ...basePolicy,
        environmentObserver: {
          ...basePolicy.environmentObserver,
          enabled: true,
          watchedPaths: ["."],
          excludedGlobs: ["node_modules/**"],
          scanBudgetFiles: 10,
        },
      },
    });

    const signals = runtime.listProjectSignals({ projectId: project.projectId, source: "project_file" });
    expect(signals).toHaveLength(1);
    const signal = signals[0]!;
    expect(signal.summary).toContain("without reading raw content");
    expect(JSON.stringify(signal.metadata)).not.toContain("do-not-read");
    expect(signal.metadata).toMatchObject({
      observerKind: "environment_snapshot",
      privacy: "metadata_only_no_raw_content",
      observedFiles: 2,
      excludedGlobs: ["node_modules/**"],
    });

    const scan = runtime.scanSelfIteration({ projectId: project.projectId, autoApplyEvaluation: false });
    expect(scan.candidates.some((candidate) => candidate.id === `${project.projectId}:self:mode:environment-observer`)).toBe(true);

    const paused = runtime.updateSelfIterationPolicy({
      policy: {
        ...runtime.getSelfIterationPolicy({ projectId: project.projectId }),
        environmentObserver: {
          ...basePolicy.environmentObserver,
          enabled: true,
          paused: true,
        },
      },
    });
    expect(paused.environmentObserver.paused).toBe(true);
    expect(runtime.listProjectSignals({ projectId: project.projectId, source: "project_file" })).toEqual([]);
  });

  it("honors project curator pause policy", () => {
    const store = new LocalSelfIterationStore(tempDir(), () => 6000);
    store.updatePolicy({
      policy: {
        projectId: "local-project",
        curatorEnabled: false,
        updatedAt: 6000,
      },
    });

    const result = store.triggerCuratorScan({ trigger: "feedback_submitted" }, {
      signals: [],
      insights: [],
      runs: [],
      evaluationRuns: [],
      feedbackRecords: [feedbackRecord("feedback-paused", "Do not scan while paused.")],
    }, {
      applyEvaluationCandidate: () => ({ applied: true }),
    });

    expect(result).toMatchObject({ scanned: false, reason: "disabled", projectId: "local-project" });
    expect(store.listCandidates()).toEqual([]);
  });
});

function feedbackRecord(id: string, feedbackText: string): EvaluationFeedbackRecord {
  return {
    id,
    status: "pending",
    feedbackText,
    sourceRunId: "run-1",
    draft: {
      case: {
        id: `case-${id}`,
        input: { prompt: "Original prompt", context: {} },
        expected: { text: "Better answer" },
        metadata: { failureMode: "missed_requirement", tags: [] },
      },
      rationale: "Test draft",
      confidence: 0.8,
    },
    createdAt: 1,
    updatedAt: 1,
  };
}

function recoverySignal(): ProjectSignal {
  return {
    id: "signal-1",
    projectId: "local-project",
    source: "recovery_event",
    sourceRef: "run-1:evt-1",
    title: "Recovery exhausted",
    summary: "Recovery was exhausted.",
    severity: "critical",
    confidence: 0.9,
    createdAt: 1,
    updatedAt: 1,
    evidence: [{ id: "run-1:evt-1", label: "Trail", target: { kind: "trail", id: "run-1", runId: "run-1" } }],
    metadata: { eventType: "recovery.exhausted", modeId: "single_agent" },
  };
}

function modeInsight(): ProjectInsight {
  return {
    id: "insight-recovery-mode",
    projectId: "local-project",
    title: "Recovery approval drift",
    summary: "Recovery and approval signals suggest this mode needs orchestration review.",
    status: "open",
    confidence: 0.8,
    signalIds: ["signal-1"],
    createdAt: 1,
    updatedAt: 1,
  };
}

function successfulRun(): StateSnapshot {
  return {
    runId: "run-success",
    sessionId: "session-1",
    turnIndex: 1,
    projectId: "local-project",
    pattern: "single_agent",
    modeId: "single_agent",
    status: "succeeded",
    input: { prompt: "Do the workflow", context: {}, createdAt: 1 },
    events: [],
    actions: [],
    toolCalls: [
      { id: "tool-1", toolId: "file.read", status: "succeeded", requestedAt: 1, updatedAt: 1, input: {}, output: {} },
      { id: "tool-2", toolId: "file.grep", status: "succeeded", requestedAt: 2, updatedAt: 2, input: {}, output: {} },
    ],
    todos: [],
    artifacts: [],
    agentMessages: [],
    conversation: [],
    pendingClarifications: [],
    pendingApprovals: [],
    createdAt: 1,
    updatedAt: 2,
  };
}
