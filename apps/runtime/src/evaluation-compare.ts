import type {
  EvaluationCaseResult,
  EvaluationMetricScore,
  EvaluationRun,
} from "@cemeworm/shared";

/**
 * Result of comparing two evaluation runs on a single case.
 */
export interface CaseComparison {
  caseId: string;
  scoreA: number;
  scoreB: number;
  delta: number;
  direction: "improved" | "degraded" | "unchanged";
  metricDeltas: MetricDeltaEntry[];
  failureTagsA: string[];
  failureTagsB: string[];
}

interface MetricDeltaEntry {
  metricId: string;
  scoreA: number;
  scoreB: number;
  delta: number;
}

/**
 * Aggregated delta for a single metric across all compared cases.
 */
export interface MetricAggregate {
  metricId: string;
  meanA: number;
  meanB: number;
  meanDelta: number;
  medianDelta: number;
  winRate: number;  // proportion of cases where B > A
  lossRate: number; // proportion of cases where B < A
  tieRate: number;  // proportion where delta = 0
}

export interface NetLift {
  outcomeLift: number;
  decisionLift: number;
  costPenalty: number;
  netLift: number;
}

export interface ConditionCheck {
  condition: string;
  passed: boolean;
  detail: string;
}

export type ComparisonVerdict = "causal_wins" | "legacy_wins" | "mixed" | "inconclusive";

export interface EvaluationComparisonReport {
  meta: {
    runAId: string;
    runBId: string;
    configAId?: string;
    configBId?: string;
    comparedAt: number;
  };
  overview: {
    overallScoreA: number;
    overallScoreB: number;
    scoreDelta: number;
    passRateA: number;
    passRateB: number;
    passRateDelta: number;
    avgRuntimeA: number;
    avgRuntimeB: number;
    avgCostA: number;
    avgCostB: number;
  };
  metricAggregates: MetricAggregate[];
  caseComparisons: CaseComparison[];
  netLift: NetLift;
  verdict: {
    conditions: ConditionCheck[];
    overall: ComparisonVerdict;
  };
}

/**
 * Compare two evaluation runs on a per-case basis, matching by `caseId`.
 *
 * @param runA - Baseline/legacy run
 * @param runB - Target/causal-mainline run
 * @param configAId - Optional config filter for run A (uses first config if omitted)
 * @param configBId - Optional config filter for run B (uses first config if omitted)
 */
export function compareEvaluationRuns(
  runA: EvaluationRun,
  runB: EvaluationRun,
  options?: { configAId?: string; configBId?: string }
): EvaluationComparisonReport {
  const configAId = options?.configAId ?? firstConfigId(runA);
  const configBId = options?.configBId ?? firstConfigId(runB);

  const casesA = caseResultsForConfig(runA, configAId);
  const casesB = caseResultsForConfig(runB, configBId);
  const caseBMap = new Map(casesB.map((c) => [c.caseId, c]));

  const caseComparisons: CaseComparison[] = [];
  for (const caseA of casesA) {
    const caseB = caseBMap.get(caseA.caseId);
    if (!caseB) continue;
    caseComparisons.push(compareCaseResult(caseA, caseB));
  }

  const metricAggregates = buildMetricAggregates(caseComparisons);
  const netLift = computeNetLift(metricAggregates, runA, runB, configAId, configBId);
  const verdict = computeVerdict(netLift, metricAggregates, caseComparisons);

  const summaryA = configSummary(runA, configAId);
  const summaryB = configSummary(runB, configBId);

  return {
    meta: {
      runAId: runA.id,
      runBId: runB.id,
      configAId,
      configBId,
      comparedAt: Date.now(),
    },
    overview: {
      overallScoreA: summaryA?.overallScore ?? 0,
      overallScoreB: summaryB?.overallScore ?? 0,
      scoreDelta: (summaryB?.overallScore ?? 0) - (summaryA?.overallScore ?? 0),
      passRateA: summaryA?.passRate ?? 0,
      passRateB: summaryB?.passRate ?? 0,
      passRateDelta: (summaryB?.passRate ?? 0) - (summaryA?.passRate ?? 0),
      avgRuntimeA: summaryA?.averageRuntimeMs ?? 0,
      avgRuntimeB: summaryB?.averageRuntimeMs ?? 0,
      avgCostA: summaryA?.averageCostUsd ?? 0,
      avgCostB: summaryB?.averageCostUsd ?? 0,
    },
    metricAggregates,
    caseComparisons,
    netLift,
    verdict,
  };
}

function firstConfigId(run: EvaluationRun): string {
  return run.spec.configs[0]?.id ?? "config-0";
}

function caseResultsForConfig(
  run: EvaluationRun,
  configId: string
): EvaluationCaseResult[] {
  return (run.caseResults ?? []).filter((c) => c.configId === configId);
}

function compareCaseResult(
  caseA: EvaluationCaseResult,
  caseB: EvaluationCaseResult
): CaseComparison {
  const scoreA = caseA.averageScore?.overallScore ?? 0;
  const scoreB = caseB.averageScore?.overallScore ?? 0;
  const delta = scoreB - scoreA;
  const direction = delta > 0.01 ? "improved" : delta < -0.01 ? "degraded" : "unchanged";

  const metricIds = new Set([
    ...(caseA.metricScores ?? []).map((m) => m.metricId),
    ...(caseB.metricScores ?? []).map((m) => m.metricId),
  ]);
  const metricBMap = new Map((caseB.metricScores ?? []).map((m) => [m.metricId, m]));
  const metricDeltas: MetricDeltaEntry[] = [];
  for (const m of caseA.metricScores ?? []) {
    const scoreB = metricBMap.get(m.metricId)?.score ?? 0;
    metricDeltas.push({
      metricId: m.metricId,
      scoreA: m.score,
      scoreB,
      delta: scoreB - m.score,
    });
  }
  // Include metrics only in B
  const metricAMap = new Map((caseA.metricScores ?? []).map((m) => [m.metricId, m]));
  for (const m of caseB.metricScores ?? []) {
    if (!metricAMap.has(m.metricId)) {
      metricDeltas.push({
        metricId: m.metricId,
        scoreA: 0,
        scoreB: m.score,
        delta: m.score,
      });
    }
  }

  return {
    caseId: caseA.caseId,
    scoreA,
    scoreB,
    delta,
    direction,
    metricDeltas,
    failureTagsA: caseA.averageScore?.failureTags ?? [],
    failureTagsB: caseB.averageScore?.failureTags ?? [],
  };
}

function buildMetricAggregates(cases: CaseComparison[]): MetricAggregate[] {
  const metricMap = new Map<string, number[]>();
  for (const c of cases) {
    for (const m of c.metricDeltas) {
      const deltas = metricMap.get(m.metricId) ?? [];
      deltas.push(m.delta);
      metricMap.set(m.metricId, deltas);
    }
  }

  const aggregates: MetricAggregate[] = [];
  for (const [metricId, deltas] of metricMap) {
    const sorted = [...deltas].sort((a, b) => a - b);
    const mean = deltas.reduce((s, d) => s + d, 0) / deltas.length;
    const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
    const wins = deltas.filter((d) => d > 0.01).length;
    const losses = deltas.filter((d) => d < -0.01).length;
    const ties = deltas.filter((d) => Math.abs(d) <= 0.01).length;
    const n = deltas.length || 1;

    // Compute means of A and B from the cases
    let sumA = 0;
    let sumB = 0;
    let count = 0;
    for (const c of cases) {
      const entry = c.metricDeltas.find((m) => m.metricId === metricId);
      if (entry) {
        sumA += entry.scoreA;
        sumB += entry.scoreB;
        count++;
      }
    }

    aggregates.push({
      metricId,
      meanA: count > 0 ? sumA / count : 0,
      meanB: count > 0 ? sumB / count : 0,
      meanDelta: mean,
      medianDelta: median,
      winRate: wins / n,
      lossRate: losses / n,
      tieRate: ties / n,
    });
  }

  return aggregates;
}

function computeNetLift(
  aggregates: MetricAggregate[],
  runA: EvaluationRun,
  runB: EvaluationRun,
  configAId?: string,
  configBId?: string
): NetLift {
  const byId = (id: string) => aggregates.find((a) => a.metricId === id)?.meanDelta ?? 0;

  const outcomeLift =
    byId("effective_intervention") * 0.4 +
    byId("intent_resolution") * 0.2 +
    byId("counterfactual_lift") * 0.2;

  const decisionLift = byId("clarification_precision") * 0.2;

  // Cost penalty: increase in over_action + token/tool cost ratio
  const summaryA = configSummary(runA, configAId);
  const summaryB = configSummary(runB, configBId);
  const costRatio = (summaryA?.averageCostUsd ?? 0) > 0
    ? ((summaryB?.averageCostUsd ?? 0) - (summaryA?.averageCostUsd ?? 0)) / (summaryA!.averageCostUsd)
    : 0;
  const costPenalty =
    Math.abs(Math.min(0, byId("over_action"))) * 0.1 +
    Math.max(0, costRatio) * 0.1;

  const netLift = outcomeLift + decisionLift - costPenalty;

  return {
    outcomeLift: round(outcomeLift),
    decisionLift: round(decisionLift),
    costPenalty: round(costPenalty),
    netLift: round(netLift),
  };
}

function computeVerdict(
  netLift: NetLift,
  aggregates: MetricAggregate[],
  cases: CaseComparison[]
): { conditions: ConditionCheck[]; overall: ComparisonVerdict } {
  const byId = (id: string) => aggregates.find((a) => a.metricId === id);

  const effInt = byId("effective_intervention");
  const intentRes = byId("intent_resolution");
  const overAction = byId("over_action");
  const tokenEff = byId("token_efficiency");

  const outcomeImproved = cases.filter((c) => c.direction === "improved").length;
  const outcomeDegraded = cases.filter((c) => c.direction === "degraded").length;

  const conditions: ConditionCheck[] = [
    {
      condition: "effective_intervention 明显提升 (+10% 以上)",
      passed: (effInt?.meanDelta ?? 0) >= 0.1,
      detail: `Δ = ${formatDelta(effInt?.meanDelta)}`,
    },
    {
      condition: "intent_resolution 不下降",
      passed: (intentRes?.meanDelta ?? 0) >= -0.05,
      detail: `Δ = ${formatDelta(intentRes?.meanDelta)}`,
    },
    {
      condition: "over_action 不明显恶化",
      passed: (overAction?.meanDelta ?? 0) >= -0.1,
      detail: `Δ = ${formatDelta(overAction?.meanDelta)}`,
    },
    {
      condition: "最终答案质量不下降 (overallScore)",
      passed: outcomeImproved >= outcomeDegraded,
      detail: `improved: ${outcomeImproved}, degraded: ${outcomeDegraded}`,
    },
    {
      condition: "成本增长可接受 (token/tool 效率不降超 30%)",
      passed: (tokenEff?.meanDelta ?? 0) >= -0.3,
      detail: `Δ token_efficiency = ${formatDelta(tokenEff?.meanDelta)}`,
    },
    {
      condition: "无 missing_causal_data 类 failure（公平对比）",
      passed: !cases.some((c) =>
        c.failureTagsA.includes("missing_causal_data") ||
        c.failureTagsB.includes("missing_causal_data")
      ),
      detail: cases.some((c) =>
        c.failureTagsA.includes("missing_causal_data") ||
        c.failureTagsB.includes("missing_causal_data")
      ) ? "有 case 缺少 causal data" : "全部 case 有 causal data",
    },
  ];

  const passedCount = conditions.filter((c) => c.passed).length;
  const overall: ComparisonVerdict =
    passedCount === conditions.length ? "causal_wins" :
    passedCount >= 4 ? "mixed" :
    netLift.netLift > 0 ? "mixed" :
    "legacy_wins";

  return { conditions, overall };
}

function configSummary(
  run: EvaluationRun,
  configId?: string
): { overallScore: number; passRate: number; averageRuntimeMs: number; averageCostUsd: number } | undefined {
  const summaries = run.scorecard?.configSummaries ?? [];
  if (configId) {
    return summaries.find((s) => s.configId === configId);
  }
  return summaries[0];
}

/**
 * Format a comparison report as human-readable Markdown.
 */
export function formatComparisonReport(
  report: EvaluationComparisonReport,
  format: "markdown" | "json"
): string {
  if (format === "json") {
    return JSON.stringify(report, null, 2);
  }
  return formatMarkdown(report);
}

function formatMarkdown(r: EvaluationComparisonReport): string {
  const lines: string[] = [];

  lines.push("# Causal Agent A/B Comparison Report");
  lines.push("");
  lines.push(`**Run A (Legacy/Baseline)**: \`${r.meta.runAId}\` (config: \`${r.meta.configAId ?? "-"}\`)`);
  lines.push(`**Run B (Causal Mainline)**: \`${r.meta.runBId}\` (config: \`${r.meta.configBId ?? "-"}\`)`);
  lines.push(`**Compared**: ${new Date(r.meta.comparedAt).toISOString()}`);
  lines.push("");

  // Overview
  lines.push("## Overview");
  lines.push("");
  lines.push("| Dimension | Run A (Legacy) | Run B (Causal) | Delta |");
  lines.push("|---|---:|---:|---:|");
  lines.push(`| Overall Score | ${pct(r.overview.overallScoreA)} | ${pct(r.overview.overallScoreB)} | ${formatDelta(r.overview.scoreDelta)} |`);
  lines.push(`| Pass Rate | ${pct(r.overview.passRateA)} | ${pct(r.overview.passRateB)} | ${formatDelta(r.overview.passRateDelta)} |`);
  lines.push(`| Avg Runtime | ${r.overview.avgRuntimeA}ms | ${r.overview.avgRuntimeB}ms | ${r.overview.avgRuntimeB - r.overview.avgRuntimeA > 0 ? "+" : ""}${r.overview.avgRuntimeB - r.overview.avgRuntimeA}ms |`);
  lines.push(`| Avg Cost | $${r.overview.avgCostA.toFixed(4)} | $${r.overview.avgCostB.toFixed(4)} | ${r.overview.avgCostA > 0 ? formatDelta((r.overview.avgCostB - r.overview.avgCostA) / r.overview.avgCostA) : "-"} |`);
  lines.push("");

  // Metric Deltas
  lines.push("## Metric Deltas");
  lines.push("");
  lines.push("| Metric | Mean A | Mean B | Δ Mean | Δ Median | Win Rate | Loss Rate |");
  lines.push("|---|---:|---:|---:|---:|---:|");
  for (const m of r.metricAggregates) {
    lines.push(
      `| ${m.metricId} | ${pct(m.meanA)} | ${pct(m.meanB)} | ${formatDelta(m.meanDelta)} | ${formatDelta(m.medianDelta)} | ${pct(m.winRate)} | ${pct(m.lossRate)} |`
    );
  }
  lines.push("");

  // Net Lift
  lines.push("## Net Lift");
  lines.push("");
  lines.push("| Component | Value |");
  lines.push("|---|---|");
  lines.push(`| Outcome Lift | ${formatDelta(r.netLift.outcomeLift)} |`);
  lines.push(`| Decision Lift | ${formatDelta(r.netLift.decisionLift)} |`);
  lines.push(`| Cost Penalty | ${formatDelta(r.netLift.costPenalty)} |`);
  lines.push(`| **Net Lift** | **${formatDelta(r.netLift.netLift)}** |`);
  lines.push("");

  // Verdict
  lines.push("## Verdict");
  lines.push("");
  for (const c of r.verdict.conditions) {
    lines.push(`- [${c.passed ? "x" : " "}] ${c.condition} — ${c.detail}`);
  }
  lines.push("");
  lines.push(`**Overall**: ${verdictLabel(r.verdict.overall)}`);
  lines.push("");

  // Case-level summary
  const improved = r.caseComparisons.filter((c) => c.direction === "improved").length;
  const degraded = r.caseComparisons.filter((c) => c.direction === "degraded").length;
  const unchanged = r.caseComparisons.filter((c) => c.direction === "unchanged").length;
  lines.push("## Case-Level Summary");
  lines.push("");
  lines.push(`- **Improved**: ${improved} / ${r.caseComparisons.length}`);
  lines.push(`- **Degraded**: ${degraded} / ${r.caseComparisons.length}`);
  lines.push(`- **Unchanged**: ${unchanged} / ${r.caseComparisons.length}`);
  lines.push("");

  // Top degraded cases
  const degradedCases = r.caseComparisons
    .filter((c) => c.direction === "degraded")
    .sort((a, b) => a.delta - b.delta);
  if (degradedCases.length > 0) {
    lines.push("### Top Degraded Cases");
    lines.push("");
    lines.push("| Case ID | Score A | Score B | Delta |");
    lines.push("|---|---:|---:|---:|");
    for (const c of degradedCases.slice(0, 10)) {
      lines.push(`| ${c.caseId} | ${pct(c.scoreA)} | ${pct(c.scoreB)} | ${formatDelta(c.delta)} |`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatDelta(delta: number | undefined): string {
  if (delta === undefined) return "-";
  const sign = delta >= 0 ? "+" : "";
  return `${sign}${(delta * 100).toFixed(1)}pp`;
}

function round(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function verdictLabel(v: ComparisonVerdict): string {
  switch (v) {
    case "causal_wins": return "✅ Causal Mainline 胜出";
    case "legacy_wins": return "❌ Legacy 更优";
    case "mixed": return "⚠️ 互有胜负";
    case "inconclusive": return "❓ 数据不足以判定";
  }
}
