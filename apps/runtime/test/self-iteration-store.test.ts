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
  it("creates and auto-applies evaluation candidates under low-risk policy", async () => {
    const store = new LocalSelfIterationStore(tempDir(), () => 1000);
    const applied: string[] = [];
    const feedback = feedbackRecord("feedback-1", "The answer missed the required citation.");
    const result = await store.scan({}, {
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

  it("requires confirmation before applying prompt candidates", async () => {
    const store = new LocalSelfIterationStore(tempDir(), () => 2000);
    const signal = recoverySignal();
    await store.scan({ autoApplyEvaluation: false }, {
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
    await store.scan({ autoApplyEvaluation: false }, {
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
    const scan = await runtime.scanSelfIteration({ autoApplyEvaluation: false });
    const candidate = scan.candidates.find((item) => item.targetKind === "evaluation")!;

    const evaluated = await runtime.evaluateSelfIterationCandidate({ candidateId: candidate.id });
    const evaluationRunId = evaluated.evaluationRunId!;
    const detail = runtime.getEvaluationRun({ evaluationRunId });

    expect(evaluated.status).toBe("ready");
    expect(evaluationRunId).toMatch(/^eval-run-/);
    expect(detail.run.status).toBe("succeeded");
    expect(detail.run.totalAttempts).toBe(6);
    expect(evaluated.proposedChange.metadata.selfIterationEvaluation).toMatchObject({
      passed: true,
      gateKind: "safety",
      safetyGate: {
        evaluationRunId,
        passed: true,
        scoreEvidence: {
          evaluationRunId,
          before: { configId: "self-iteration-before" },
          after: { configId: "self-iteration-after" },
          delta: { overallScore: 0, passRate: 0, regressionCount: 0 },
        },
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
    await store.scan({ autoApplyEvaluation: false }, {
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

  it("creates skill candidates from successful multi-tool runs", async () => {
    const store = new LocalSelfIterationStore(tempDir(), () => 3000);
    await store.scan({ autoApplyEvaluation: false }, {
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

  it("deduplicates opportunistic curator scans by project cadence", async () => {
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

    const first = await store.triggerCuratorScan({ trigger: "feedback_submitted" }, input, deps);
    expect(first.scanned).toBe(true);
    const second = await store.triggerCuratorScan({ trigger: "run_completed_idle" }, input, deps);
    expect(second).toMatchObject({ scanned: false, reason: "cadence", projectId: "local-project" });

    now = 5001;
    const third = await store.triggerCuratorScan({ trigger: "run_completed_idle" }, input, deps);
    expect(third.scanned).toBe(true);

    const reloaded = new LocalSelfIterationStore(dir, () => now);
    const skipped = await reloaded.triggerCuratorScan({ trigger: "feedback_submitted" }, input, deps);
    expect(skipped).toMatchObject({ scanned: false, reason: "cadence", projectId: "local-project" });
  });

  it("creates opt-in environment observer signals without raw file content", async () => {
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

    const scan = await runtime.scanSelfIteration({ projectId: project.projectId, autoApplyEvaluation: false });
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

  it("honors project curator pause policy", async () => {
    const store = new LocalSelfIterationStore(tempDir(), () => 6000);
    store.updatePolicy({
      policy: {
        projectId: "local-project",
        curatorEnabled: false,
        updatedAt: 6000,
      },
    });

    const result = await store.triggerCuratorScan({ trigger: "feedback_submitted" }, {
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

  it("exposes safety gate and impact evaluation metadata for prompt candidates", async () => {
    const store = new LocalSelfIterationStore(tempDir(), () => 7000);
    const signal = recoverySignal();
    await store.scan({ autoApplyEvaluation: false }, {
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
        evaluationRunId: "eval-impact-1",
        passed: true,
        message: "Safety gate passed. Impact evaluation complete.",
        metadata: {
          gateKind: "safety",
          safetyGate: {
            evaluationRunId: "eval-impact-1",
            passed: true,
            scoreEvidence: {
              evaluationRunId: "eval-impact-1",
              before: { configId: "self-iteration-before", overallScore: 1, passRate: 1, regressionCount: 0, caseCount: 1 },
              after: { configId: "self-iteration-after", overallScore: 1, passRate: 1, regressionCount: 0, caseCount: 1 },
              delta: { overallScore: 0, passRate: 0, regressionCount: 0 },
            },
          },
          impactEvaluation: {
            evaluationRunId: "eval-impact-1",
            targetKind: "prompt",
            before: { configId: "self-iteration-before-impact", overallScore: 0.7, passRate: 0.5, regressionCount: 0, caseCount: 2 },
            after: { configId: "self-iteration-after-impact", overallScore: 0.9, passRate: 1, regressionCount: 0, caseCount: 2 },
            delta: { overallScore: 0.2, passRate: 0.5, regressionCount: 0 },
          },
        },
      }),
    });

    const evalMeta = evaluated.proposedChange.metadata.selfIterationEvaluation as Record<string, unknown>;
    expect(evalMeta).toMatchObject({
      passed: true,
      gateKind: "safety",
      safetyGate: { passed: true, evaluationRunId: "eval-impact-1" },
      impactEvaluation: {
        targetKind: "prompt",
        evaluationRunId: "eval-impact-1",
        before: { configId: "self-iteration-before-impact", overallScore: 0.7 },
        after: { configId: "self-iteration-after-impact", overallScore: 0.9 },
        delta: { overallScore: 0.2, passRate: 0.5, regressionCount: 0 },
      },
    });
    expect(evaluated.status).toBe("ready");
  });

  it("produces distinct before/after impact configs for prompt candidates", async () => {
    const store = new LocalSelfIterationStore(tempDir(), () => 8000);
    const signal = recoverySignal();
    await store.scan({ autoApplyEvaluation: false }, {
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
        evaluationRunId: "eval-regression-1",
        passed: true,
        message: "Impact evaluation complete.",
        metadata: {
          gateKind: "safety",
          safetyGate: {
            evaluationRunId: "eval-regression-1",
            passed: true,
            scoreEvidence: {
              evaluationRunId: "eval-regression-1",
              before: { configId: "self-iteration-before" },
              after: { configId: "self-iteration-after" },
              delta: { overallScore: 0, passRate: 0, regressionCount: 0 },
            },
          },
          impactEvaluation: {
            evaluationRunId: "eval-regression-1",
            targetKind: "prompt",
            before: { configId: "self-iteration-before-impact", overallScore: 0.6, passRate: 0.5, regressionCount: 0, caseCount: 2 },
            after: { configId: "self-iteration-after-impact", overallScore: 0.9, passRate: 1, regressionCount: 0, caseCount: 2 },
            delta: { overallScore: 0.3, passRate: 0.5, regressionCount: 0 },
          },
        },
      }),
    });

    const impact = (evaluated.proposedChange.metadata.selfIterationEvaluation as Record<string, unknown>).impactEvaluation as Record<string, unknown>;
    expect(impact).toBeDefined();
    expect(impact.before).not.toEqual(impact.after);
    expect(impact.delta).not.toMatchObject({ overallScore: 0, passRate: 0, regressionCount: 0 });
  });

  it("does not persist changes during evaluation", async () => {
    const store = new LocalSelfIterationStore(tempDir(), () => 9000);
    const signal = recoverySignal();
    await store.scan({ autoApplyEvaluation: false }, {
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
        evaluationRunId: "eval-no-persist-1",
        passed: true,
        message: "Evaluation complete without applying changes.",
        metadata: {
          gateKind: "safety",
          safetyGate: {
            evaluationRunId: "eval-no-persist-1",
            passed: true,
            scoreEvidence: {
              evaluationRunId: "eval-no-persist-1",
              before: { configId: "self-iteration-before" },
              after: { configId: "self-iteration-after" },
              delta: { overallScore: 0, passRate: 0, regressionCount: 0 },
            },
          },
          impactEvaluation: {
            evaluationRunId: "eval-no-persist-1",
            targetKind: "prompt",
            before: { configId: "self-iteration-before-impact", overallScore: 0.8, passRate: 0.8, regressionCount: 0, caseCount: 1 },
            after: { configId: "self-iteration-after-impact", overallScore: 0.9, passRate: 1, regressionCount: 0, caseCount: 1 },
            delta: { overallScore: 0.1, passRate: 0.2, regressionCount: 0 },
          },
        },
      }),
    });

    expect(evaluated.status).toBe("ready");
    expect(evaluated.applyResult).toBeUndefined();
    expect(() => store.applyCandidate({ candidateId: candidate.id }, {
      applyEvaluationCandidate: () => ({ applied: true }),
      applyPromptCandidate: () => ({ applied: true }),
      applySkillCandidate: () => ({ applied: true }),
      applyModeCandidate: () => ({ applied: true }),
    })).toThrow(/require confirmation/);
  });

  it("rejects duplicate evaluation for a candidate already being evaluated", async () => {
    const store = new LocalSelfIterationStore(tempDir(), () => 10000);
    const signal = recoverySignal();
    await store.scan({ autoApplyEvaluation: false }, {
      signals: [signal],
      insights: [],
      runs: [],
      evaluationRuns: [],
      feedbackRecords: [],
    }, {
      applyEvaluationCandidate: () => ({ applied: true }),
    });
    const candidate = store.listCandidates({ targetKind: "prompt" })[0]!;

    // First evaluation starts (status becomes "evaluating")
    const firstPromise = store.evaluateCandidate({ candidateId: candidate.id }, {
      evaluateCandidate: () => new Promise((resolve) => {
        setTimeout(() => resolve({
          evaluationRunId: "eval-slow-1",
          passed: true,
          message: "Slow evaluation complete.",
        }), 50);
      }),
    });

    // Second evaluation should throw immediately because status is "evaluating"
    // (state machine validation rejects non-draft/non-failed candidates before duplicate check)
    await expect(
      store.evaluateCandidate({ candidateId: candidate.id }, {
        evaluateCandidate: () => ({ evaluationRunId: "eval-dup", passed: true }),
      }),
    ).rejects.toThrow(/cannot be evaluated from "evaluating" status/);

    await firstPromise;
    expect(store.getCandidate({ candidateId: candidate.id }).status).toBe("ready");
  });

  it("rolls back an applied prompt candidate and restores the original prompt", async () => {
    const store = new LocalSelfIterationStore(tempDir(), () => 11000);
    const signal = recoverySignal();
    await store.scan({ autoApplyEvaluation: false }, {
      signals: [signal],
      insights: [],
      runs: [],
      evaluationRuns: [],
      feedbackRecords: [],
    }, { applyEvaluationCandidate: () => ({ applied: true }) });
    const candidate = store.listCandidates({ targetKind: "prompt" })[0]!;

    // Apply with a before snapshot
    const snapshot = { kind: "prompt", modeId: "single_agent", nodeId: "node-1", prompt: "original prompt" };
    const appliedRollback: string[] = [];
    const applied = store.applyCandidate({ candidateId: candidate.id, confirmed: true }, {
      applyEvaluationCandidate: () => ({ applied: true }),
      applyPromptCandidate: () => ({ modeId: "single_agent" }),
      applySkillCandidate: () => ({ applied: true }),
      applyModeCandidate: () => ({ applied: true }),
      captureBeforeSnapshot: () => snapshot,
    });
    expect(applied.status).toBe("applied");
    expect(applied.beforeSnapshot).toEqual(snapshot);

    // Rollback
    const rolled = store.rollbackCandidate({ candidateId: candidate.id }, {
      applyEvaluationCandidate: () => ({ applied: true }),
      applyPromptCandidate: () => ({ modeId: "single_agent" }),
      applySkillCandidate: () => ({ applied: true }),
      applyModeCandidate: () => ({ applied: true }),
      rollbackSnapshot: (c) => { appliedRollback.push(c.id); },
    });
    expect(rolled.status).toBe("rejected");
    expect(rolled.rejectionReason).toBe("Rolled back by user.");
    expect(appliedRollback).toEqual([candidate.id]);
  });

  it("rejects rollback for a candidate not in applied state", async () => {
    const store = new LocalSelfIterationStore(tempDir(), () => 12000);
    const signal = recoverySignal();
    await store.scan({ autoApplyEvaluation: false }, {
      signals: [signal],
      insights: [],
      runs: [],
      evaluationRuns: [],
      feedbackRecords: [],
    }, { applyEvaluationCandidate: () => ({ applied: true }) });
    const candidate = store.listCandidates({ targetKind: "prompt" })[0]!;

    expect(() => store.rollbackCandidate({ candidateId: candidate.id }, {
      applyEvaluationCandidate: () => ({ applied: true }),
      applyPromptCandidate: () => ({ modeId: "single_agent" }),
      applySkillCandidate: () => ({ applied: true }),
      applyModeCandidate: () => ({ applied: true }),
    })).toThrow(/not in applied state/);
  });

  it("captures verification baseline on apply for non-evaluation candidates", async () => {
    const store = new LocalSelfIterationStore(tempDir(), () => 13000);
    const signal = recoverySignal();
    await store.scan({ autoApplyEvaluation: false }, {
      signals: [signal],
      insights: [],
      runs: [],
      evaluationRuns: [],
      feedbackRecords: [],
    }, { applyEvaluationCandidate: () => ({ applied: true }) });
    let candidate = store.listCandidates({ targetKind: "prompt" })[0]!;

    // First evaluate to get score metadata
    const evaluated = await store.evaluateCandidate({ candidateId: candidate.id }, {
      evaluateCandidate: () => ({
        evaluationRunId: "eval-verify-1",
        passed: true,
        message: "ok",
        metadata: { gateKind: "safety", score: 0.85, passRate: 0.9 },
      }),
    });
    expect(evaluated.status).toBe("ready");

    // Then apply
    candidate = store.getCandidate({ candidateId: candidate.id });
    const applied = store.applyCandidate({ candidateId: candidate.id, confirmed: true }, {
      applyEvaluationCandidate: () => ({ applied: true }),
      applyPromptCandidate: () => ({ modeId: "single_agent" }),
      applySkillCandidate: () => ({ applied: true }),
      applyModeCandidate: () => ({ applied: true }),
    });
    expect(applied.verification).toMatchObject({
      status: "pending",
      baselineScore: 0.85,
      baselinePassRate: 0.9,
    });
  });

  it("rolls back governed background_auto skills with package files and state metadata restored", async () => {
    const dayMs = 24 * 60 * 60 * 1000;
    let now = 0;
    const dataDir = tempDir();
    const runtime = new LocalRunStore({ dataDir, clock: () => now++ });
    const projectId = "local-project";

    runtime.createSkill({
      name: "auto-skill-archive-target",
      description: "Original archived target",
      provenance: "background_auto",
      content: [
        "---",
        "name: auto-skill-archive-target",
        "description: Original archived target",
        "---",
        "",
        "Original body",
      ].join("\n"),
      files: [{ path: "scripts/run.sh", content: "echo original\n", executable: true }],
    });
    runtime.setSkillEnabled({ name: "auto-skill-archive-target", enabled: false });
    runtime.upsertSkillFile({
      skillName: "auto-skill-archive-target",
      path: "templates/example.txt",
      content: "template v1\n",
    });
    runtime.updateSkill({
      name: "auto-skill-archive-target",
      content: [
        "---",
        "name: auto-skill-archive-target",
        "description: Original archived target v2",
        "---",
        "",
        "Original body v2",
      ].join("\n"),
    });

    const baseline = runtime.getSkill({ name: "auto-skill-archive-target" });
    expect(baseline.enabled).toBe(false);
    expect(baseline.provenance).toBe("background_auto");
    expect(baseline.files?.map((file) => file.path)).toEqual(expect.arrayContaining(["scripts/run.sh", "templates/example.txt"]));
    expect(baseline.governance?.history?.length).toBeGreaterThan(1);
    expect(baseline.telemetry?.patchCount).toBeGreaterThanOrEqual(1);

    now = 100 * dayMs;

    await runtime.scanSelfIteration({
      projectId,
      autoApplyEvaluation: false,
    });

    const candidate = runtime.listSelfIterationCandidates({ projectId, targetKind: "skill" })
      .find((item) => item.proposedChange.operation === "skills.archive" && item.targetRef.skillName === "auto-skill-archive-target");
    expect(candidate).toBeDefined();

    const evaluated = await runtime.evaluateSelfIterationCandidate({ candidateId: candidate!.id });
    expect(evaluated.status).toBe("ready");

    const applied = runtime.applySelfIterationCandidate({ candidateId: candidate!.id });
    expect(applied.status).toBe("applied");
    expect(runtime.getSkill({ name: "auto-skill-archive-target" }).lifecycle).toBe("archived");

    const rolled = runtime.rollbackSelfIterationCandidate({ candidateId: candidate!.id });
    expect(rolled.status).toBe("rejected");

    const restored = runtime.getSkill({ name: "auto-skill-archive-target" });
    expect(restored.description).toBe(baseline.description);
    expect(restored.enabled).toBe(baseline.enabled);
    expect(restored.lifecycle).toBe(baseline.lifecycle);
    expect(restored.provenance).toBe(baseline.provenance);
    expect(restored.createdAt).toBe(baseline.createdAt);
    expect(restored.updatedAt).toBe(baseline.updatedAt);
    expect(restored.governance).toEqual(baseline.governance);
    expect(restored.telemetry).toEqual(baseline.telemetry);
    expect(restored.files?.map((file) => file.path).sort()).toEqual(baseline.files?.map((file) => file.path).sort());

    const restoredScript = runtime.getSkillFile({ skillName: "auto-skill-archive-target", path: "scripts/run.sh" });
    expect(restoredScript.content).toBe("echo original\n");
    expect(restoredScript.executable).toBe(true);

    const restoredTemplate = runtime.getSkillFile({ skillName: "auto-skill-archive-target", path: "templates/example.txt" });
    expect(restoredTemplate.content).toBe("template v1\n");
  });

  it("updates candidate verification status", async () => {
    const store = new LocalSelfIterationStore(tempDir(), () => 14000);
    const signal = recoverySignal();
    await store.scan({ autoApplyEvaluation: false }, {
      signals: [signal],
      insights: [],
      runs: [],
      evaluationRuns: [],
      feedbackRecords: [],
    }, { applyEvaluationCandidate: () => ({ applied: true }) });
    let candidate = store.listCandidates({ targetKind: "prompt" })[0]!;

    const evaluated = await store.evaluateCandidate({ candidateId: candidate.id }, {
      evaluateCandidate: () => ({
        evaluationRunId: "eval-vfy-2",
        passed: true,
        message: "ok",
        metadata: { gateKind: "safety", score: 0.7 },
      }),
    });
    candidate = store.getCandidate({ candidateId: candidate.id });
    store.applyCandidate({ candidateId: candidate.id, confirmed: true }, {
      applyEvaluationCandidate: () => ({ applied: true }),
      applyPromptCandidate: () => ({ modeId: "single_agent" }),
      applySkillCandidate: () => ({ applied: true }),
      applyModeCandidate: () => ({ applied: true }),
    });

    store.updateCandidateVerification(candidate.id, {
      status: "verified",
      lastVerifiedAt: 14001,
      verifiedRunId: "eval-vfy-3",
    });

    const updated = store.getCandidate({ candidateId: candidate.id });
    expect(updated.verification).toMatchObject({
      status: "verified",
      baselineScore: 0.7,
      lastVerifiedAt: 14001,
      verifiedRunId: "eval-vfy-3",
    });
  });

  it("preserves state file integrity through atomic write", () => {
    const dir = tempDir();
    const statePath = `${dir}/state.json`;

    // Write initial state
    const store1 = new LocalSelfIterationStore(dir, () => 15000);
    store1.updatePolicy({ policy: { projectId: "test", updatedAt: 15000 } });

    // Verify tmp file is cleaned up (only state.json exists)
    const files = fs.readdirSync(dir).filter((f) => f.startsWith("state.json"));
    expect(files).toEqual(["state.json"]);

    // Corrupt the state file and verify readState falls back gracefully
    fs.writeFileSync(statePath, "not valid json", "utf8");
    // Write a valid tmp file that can be recovered
    fs.writeFileSync(`${statePath}.tmp`, JSON.stringify({ schemaVersion: 1, candidates: { "test-id": { id: "test-id", projectId: "test", targetKind: "prompt", targetRef: { kind: "prompt", id: "x" }, title: "T", summary: "S", evidence: [{ id: "e1", label: "E", target: { kind: "project_file", id: "f1" } }], proposedChange: { operation: "op", title: "T", summary: "S" }, riskLevel: "high", status: "draft", createdAt: 1, updatedAt: 1 } }, policies: {}, runs: [], curator: {} }), "utf8");

    const store2 = new LocalSelfIterationStore(dir, () => 16000);
    // Should recover from tmp file
    const recovered = store2.getCandidate({ candidateId: "test-id" });
    expect(recovered.id).toBe("test-id");
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
