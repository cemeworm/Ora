import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { EvaluationRun } from "@cemeworm/shared";
import { LocalFeedbackLoopStore } from "./feedback-loop-store.js";

function mockEvaluationRun(failureTags: string[]): EvaluationRun {
  const now = Date.now();
  return {
    id: "eval-run-1",
    spec: {
      datasetId: "dataset-1",
      profileId: "outcome",
      configs: [{ id: "record", label: "Record", runConfig: { pattern: "solo_agent" } }],
      repetitions: 1,
      concurrency: 1,
      timeoutMs: 30_000,
      objective: { kind: "outcome", target: "run.output", metrics: [], assertions: [], evaluators: [] },
    },
    status: "succeeded",
    totalAttempts: 1,
    completedAttempts: 1,
    failedAttempts: 0,
    attemptIds: ["attempt-1"],
    caseResults: [{
      caseId: "case-1",
      configId: "record",
      attemptIds: ["attempt-1"],
      averageScore: {
        outcomeScore: 0.25,
        processScore: 0.4,
        efficiencyScore: 0.7,
        safetyScore: 0.9,
        overallScore: 0.35,
        judgeRationale: "synthetic",
        failureTags,
      },
      metricScores: [],
      evaluatorResults: [],
      observations: {},
      metadata: {},
      traceRunIds: [],
    }],
    scorecard: {
      overallScore: 0.35,
      passRate: 0,
      averageRuntimeMs: 100,
      averageCostUsd: 0,
      regressionCount: 0,
      pendingAnnotationCount: 0,
      configSummaries: [{ configId: "record", label: "Record", overallScore: 0.35, passRate: 0, averageRuntimeMs: 100, averageCostUsd: 0, caseCount: 1, regressionCount: 0, failureTagCounts: {} }],
      slices: [],
    },
    startedAt: now,
    updatedAt: now,
    completedAt: now,
    resumable: false,
  } as unknown as EvaluationRun;
}

describe("feedback loop causal insights", () => {
  it("splits semantic-state gaps from intervention gaps", () => {
    const dir = mkdtempSync(join(tmpdir(), "ora-feedback-loop-"));
    const store = new LocalFeedbackLoopStore(dir);
    try {
      const insights = store.listInsights({}, {
        projects: [],
        sessions: [],
        runs: [],
        evaluationRuns: [
          mockEvaluationRun(["latent_goal_missing", "under_clarification", "wrong_intervention", "poor_outcome_quality"]),
        ],
        feedbackRecords: [],
      });

      expect(insights.map((insight) => insight.id)).toContain("local-project:insight:causal_semantic_state_gap");
      expect(insights.map((insight) => insight.id)).toContain("local-project:insight:causal_intervention_gap");
      expect(insights.find((insight) => insight.id.endsWith("causal_semantic_state_gap"))?.summary).toContain("task-understanding gaps");
      expect(insights.find((insight) => insight.id.endsWith("causal_intervention_gap"))?.summary).toContain("intervention or outcome gaps");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
