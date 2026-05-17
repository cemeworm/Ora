import { describe, expect, it } from "vitest";
import { compareEvaluationRuns, formatComparisonReport } from "./evaluation-compare.js";

function makeRun(id: string, configId: string, caseResults: any[], scorecardConfig: any) {
  return {
    id,
    spec: {
      datasetId: "dataset-mock",
      profileId: "orchestration",
      configs: [{ id: configId, label: configId, runConfig: { pattern: "solo_agent", metadata: {} } }],
      repetitions: 1,
      concurrency: 1,
      timeoutMs: 300000,
    },
    status: "succeeded" as const,
    caseResults,
    scorecard: {
      overallScore: scorecardConfig.overallScore,
      passRate: scorecardConfig.passRate,
      averageRuntimeMs: scorecardConfig.averageRuntimeMs,
      averageCostUsd: scorecardConfig.averageCostUsd,
      regressionCount: 0,
      configSummaries: [{
        configId,
        label: configId,
        overallScore: scorecardConfig.overallScore,
        passRate: scorecardConfig.passRate,
        averageRuntimeMs: scorecardConfig.averageRuntimeMs,
        averageCostUsd: scorecardConfig.averageCostUsd,
        caseCount: caseResults.length,
        regressionCount: 0,
        failureTagCounts: {},
      }],
      slices: [],
    },
    attempts: [],
    events: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  } as any;
}

function makeCase(caseId: string, configId: string, overallScore: number, metrics: Array<{ metricId: string; score: number }>, failureTags: string[] = []) {
  return {
    caseId,
    configId,
    attemptIds: [`attempt-${caseId}-${configId}`],
    averageScore: {
      outcomeScore: overallScore,
      processScore: overallScore,
      efficiencyScore: overallScore,
      safetyScore: overallScore,
      overallScore,
      failureTags,
    },
    metricScores: metrics.map((m) => ({
      metricId: m.metricId,
      score: m.score,
      passed: m.score >= 0.6,
      rationale: "",
      failureTags: [] as string[],
    })),
    evaluatorResults: [],
    observations: { run: {}, runtime: {}, trace: {} } as any,
  };
}

describe("evaluation-compare", () => {
  it("compares two runs and computes metric deltas", () => {
    const legacy = makeRun("eval-legacy", "legacy", [
      makeCase("case-1", "legacy", 0.6, [
        { metricId: "effective_intervention", score: 0.3 },
        { metricId: "intent_resolution", score: 0.4 },
        { metricId: "over_action", score: 0.7 },
      ]),
      makeCase("case-2", "legacy", 0.5, [
        { metricId: "effective_intervention", score: 0.4 },
        { metricId: "intent_resolution", score: 0.3 },
      ]),
      makeCase("case-3", "legacy", 0.7, [
        { metricId: "effective_intervention", score: 0.5 },
        { metricId: "intent_resolution", score: 0.5 },
      ]),
    ], { overallScore: 0.6, passRate: 0.5, averageRuntimeMs: 5000, averageCostUsd: 0.01 });

    const causal = makeRun("eval-causal", "causal-mainline", [
      makeCase("case-1", "causal-mainline", 0.8, [
        { metricId: "effective_intervention", score: 0.7 },
        { metricId: "intent_resolution", score: 0.6 },
        { metricId: "over_action", score: 0.8 },
      ]),
      makeCase("case-2", "causal-mainline", 0.7, [
        { metricId: "effective_intervention", score: 0.6 },
        { metricId: "intent_resolution", score: 0.5 },
      ]),
      makeCase("case-3", "causal-mainline", 0.75, [
        { metricId: "effective_intervention", score: 0.7 },
        { metricId: "intent_resolution", score: 0.6 },
      ]),
    ], { overallScore: 0.75, passRate: 0.7, averageRuntimeMs: 5500, averageCostUsd: 0.012 });

    const report = compareEvaluationRuns(legacy, causal);

    // Overview
    expect(report.overview.overallScoreA).toBe(0.6);
    expect(report.overview.overallScoreB).toBe(0.75);
    expect(report.overview.scoreDelta).toBeCloseTo(0.15, 5);

    // Case comparisons
    expect(report.caseComparisons).toHaveLength(3);
    expect(report.caseComparisons[0]!.direction).toBe("improved");
    expect(report.caseComparisons[0]!.delta).toBeCloseTo(0.2);

    // Metric aggregates
    const effInt = report.metricAggregates.find((m) => m.metricId === "effective_intervention");
    expect(effInt).toBeDefined();
    expect(effInt!.meanDelta).toBeGreaterThan(0);

    // Net lift
    expect(report.netLift.netLift).toBeGreaterThan(0);

    // Verdict
    expect(report.verdict.overall).toBe("causal_wins");
  });

  it("detects regression when new logic scores lower", () => {
    const legacy = makeRun("eval-legacy", "legacy", [
      makeCase("case-1", "legacy", 0.9, [
        { metricId: "effective_intervention", score: 0.8 },
      ]),
    ], { overallScore: 0.9, passRate: 0.9, averageRuntimeMs: 1000, averageCostUsd: 0.005 });

    const causal = makeRun("eval-causal", "causal-mainline", [
      makeCase("case-1", "causal-mainline", 0.5, [
        { metricId: "effective_intervention", score: 0.3 },
      ]),
    ], { overallScore: 0.5, passRate: 0.3, averageRuntimeMs: 8000, averageCostUsd: 0.05 });

    const report = compareEvaluationRuns(legacy, causal);
    expect(report.caseComparisons[0]!.direction).toBe("degraded");
    expect(report.netLift.netLift).toBeLessThan(0);
  });

  it("formats Markdown report", () => {
    const legacy = makeRun("eval-legacy", "legacy", [
      makeCase("case-1", "legacy", 0.6, [
        { metricId: "effective_intervention", score: 0.3 },
      ]),
    ], { overallScore: 0.6, passRate: 0.5, averageRuntimeMs: 5000, averageCostUsd: 0.01 });

    const causal = makeRun("eval-causal", "causal-mainline", [
      makeCase("case-1", "causal-mainline", 0.8, [
        { metricId: "effective_intervention", score: 0.7 },
      ]),
    ], { overallScore: 0.8, passRate: 0.7, averageRuntimeMs: 5500, averageCostUsd: 0.012 });

    const report = compareEvaluationRuns(legacy, causal);
    const md = formatComparisonReport(report, "markdown");

    expect(md).toContain("# Causal Agent A/B Comparison Report");
    expect(md).toContain("## Overview");
    expect(md).toContain("## Metric Deltas");
    expect(md).toContain("## Net Lift");
    expect(md).toContain("## Verdict");
    expect(md).toContain("## Case-Level Summary");
    expect(md).toContain("effective_intervention");
  });

  it("formats JSON report", () => {
    const legacy = makeRun("eval-legacy", "legacy", [
      makeCase("case-1", "legacy", 0.6, []),
    ], { overallScore: 0.6, passRate: 0.5, averageRuntimeMs: 5000, averageCostUsd: 0.01 });

    const causal = makeRun("eval-causal", "causal-mainline", [
      makeCase("case-1", "causal-mainline", 0.8, []),
    ], { overallScore: 0.8, passRate: 0.7, averageRuntimeMs: 5500, averageCostUsd: 0.012 });

    const report = compareEvaluationRuns(legacy, causal);
    const json = formatComparisonReport(report, "json");
    const parsed = JSON.parse(json);

    expect(parsed.meta.runAId).toBe("eval-legacy");
    expect(parsed.meta.runBId).toBe("eval-causal");
    expect(parsed.netLift).toBeDefined();
  });

  it("handles mismatched cases gracefully", () => {
    const legacy = makeRun("eval-legacy", "legacy", [
      makeCase("case-1", "legacy", 0.6, []),
      makeCase("case-2", "legacy", 0.7, []),
    ], { overallScore: 0.65, passRate: 0.5, averageRuntimeMs: 5000, averageCostUsd: 0.01 });

    const causal = makeRun("eval-causal", "causal-mainline", [
      makeCase("case-1", "causal-mainline", 0.8, []),
    ], { overallScore: 0.8, passRate: 1.0, averageRuntimeMs: 5500, averageCostUsd: 0.012 });

    const report = compareEvaluationRuns(legacy, causal);
    expect(report.caseComparisons).toHaveLength(1);
    expect(report.caseComparisons[0]!.caseId).toBe("case-1");
  });

  it("checks all 6 verdict conditions", () => {
    const legacy = makeRun("eval-legacy", "legacy", [
      makeCase("case-1", "legacy", 0.7, [
        { metricId: "effective_intervention", score: 0.5 },
        { metricId: "intent_resolution", score: 0.5 },
        { metricId: "over_action", score: 0.8 },
        { metricId: "token_efficiency", score: 0.7 },
      ]),
    ], { overallScore: 0.7, passRate: 0.6, averageRuntimeMs: 5000, averageCostUsd: 0.01 });

    const causal = makeRun("eval-causal", "causal-mainline", [
      makeCase("case-1", "causal-mainline", 0.75, [
        { metricId: "effective_intervention", score: 0.7 },
        { metricId: "intent_resolution", score: 0.6 },
        { metricId: "over_action", score: 0.8 },
        { metricId: "token_efficiency", score: 0.6 },
      ]),
    ], { overallScore: 0.75, passRate: 0.7, averageRuntimeMs: 5500, averageCostUsd: 0.012 });

    const report = compareEvaluationRuns(legacy, causal);
    expect(report.verdict.conditions).toHaveLength(6);

    // Condition 1: effective_intervention +20pp → passes
    expect(report.verdict.conditions[0]!.passed).toBe(true);
    // Condition 6: no missing_causal_data → passes
    expect(report.verdict.conditions[5]!.passed).toBe(true);
  });

  it("flags missing_causal_data in failure tags", () => {
    const legacy = makeRun("eval-legacy", "legacy", [
      makeCase("case-1", "legacy", 0.6, [], ["missing_causal_data"]),
    ], { overallScore: 0.6, passRate: 0.5, averageRuntimeMs: 5000, averageCostUsd: 0.01 });

    const causal = makeRun("eval-causal", "causal-mainline", [
      makeCase("case-1", "causal-mainline", 0.8, []),
    ], { overallScore: 0.8, passRate: 0.7, averageRuntimeMs: 5500, averageCostUsd: 0.012 });

    const report = compareEvaluationRuns(legacy, causal);
    const cond6 = report.verdict.conditions[5]!;
    expect(cond6.passed).toBe(false);
  });
});
