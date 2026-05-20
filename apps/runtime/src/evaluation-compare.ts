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
  pValue?: number;  // paired t-test (two-tailed)
  cohensD?: number; // effect size (meanDelta / std of deltas)
  significant?: boolean; // p < 0.05
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
  const metricMap = new Map<string, {
    deltas: number[];
    sumA: number;
    sumB: number;
    count: number;
    wins: number;
    losses: number;
    ties: number;
  }>();
  for (const c of cases) {
    for (const m of c.metricDeltas) {
      const aggregate = metricMap.get(m.metricId) ?? {
        deltas: [],
        sumA: 0,
        sumB: 0,
        count: 0,
        wins: 0,
        losses: 0,
        ties: 0,
      };
      aggregate.deltas.push(m.delta);
      aggregate.sumA += m.scoreA;
      aggregate.sumB += m.scoreB;
      aggregate.count += 1;
      if (m.delta > 0.01) {
        aggregate.wins += 1;
      } else if (m.delta < -0.01) {
        aggregate.losses += 1;
      } else {
        aggregate.ties += 1;
      }
      metricMap.set(m.metricId, aggregate);
    }
  }

  const aggregates: MetricAggregate[] = [];
  for (const [metricId, aggregate] of metricMap) {
    const { deltas, sumA, sumB, count, wins, losses, ties } = aggregate;
    const sorted = [...deltas].sort((a, b) => a - b);
    const mean = deltas.reduce((s, d) => s + d, 0) / deltas.length;
    const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
    const n = deltas.length || 1;

    // Paired t-test and Cohen's d
    const stats = n >= 2 ? pairedTTest(deltas) : { pValue: undefined, cohensD: undefined, significant: undefined };

    aggregates.push({
      metricId,
      meanA: count > 0 ? sumA / count : 0,
      meanB: count > 0 ? sumB / count : 0,
      meanDelta: mean,
      medianDelta: median,
      winRate: wins / n,
      lossRate: losses / n,
      tieRate: ties / n,
      ...stats,
    });
  }

  return aggregates;
}

function pairedTTest(deltas: number[]): { pValue: number; cohensD: number; significant: boolean } {
  const n = deltas.length;
  const mean = deltas.reduce((s, d) => s + d, 0) / n;
  const variance = deltas.reduce((s, d) => s + (d - mean) ** 2, 0) / (n - 1);
  const std = Math.sqrt(variance);
  if (std === 0 || Math.abs(mean) < 1e-10) {
    return { pValue: 1, cohensD: 0, significant: false };
  }
  const cohensD = mean / std;
  const se = std / Math.sqrt(n);
  const t = mean / se;
  const pValue = tPValue(Math.abs(t), n - 1);
  return {
    pValue: round(pValue),
    cohensD: round(cohensD),
    significant: pValue < 0.05,
  };
}

function tPValue(t: number, df: number): number {
  if (df < 1) return 1;
  // Use normal approximation for large df
  if (df > 100) return 2 * (1 - normalCDF(t));
  // For small df, use the relationship with the beta distribution
  const x = df / (df + t * t);
  const p = regularizedBeta(x, df / 2, 0.5);
  return Math.min(1, 2 * Math.min(p, 1 - p));
}

function normalCDF(x: number): number {
  // Abramowitz and Stegun approximation
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x) / Math.sqrt(2);
  const t = 1 / (1 + p * x);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return 0.5 * (1 + sign * y);
}

function regularizedBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  // Use continued fraction representation for the incomplete beta
  const maxIter = 200;
  const epsilon = 1e-10;
  const front = Math.exp(logBeta(a, b) + a * Math.log(x) + b * Math.log(1 - x));
  let f = 1;
  let c = 1;
  let d = 1 - (a + b) * x / (a + 1);
  if (Math.abs(d) < epsilon) d = epsilon;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= maxIter; m++) {
    const m2 = 2 * m;
    // even step
    const evenN = m * (b - m) * x / ((a + m2 - 1) * (a + m2));
    d = 1 + evenN * d;
    if (Math.abs(d) < epsilon) d = epsilon;
    c = 1 + evenN / c;
    if (Math.abs(c) < epsilon) c = epsilon;
    d = 1 / d;
    h *= d * c;
    // odd step
    const oddN = -(a + m) * (a + b + m) * x / ((a + m2) * (a + m2 + 1));
    d = 1 + oddN * d;
    if (Math.abs(d) < epsilon) d = epsilon;
    c = 1 + oddN / c;
    if (Math.abs(c) < epsilon) c = epsilon;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < epsilon) break;
  }
  return front * (h / a);
}

function logBeta(a: number, b: number): number {
  return lgamma(a) + lgamma(b) - lgamma(a + b);
}

function lgamma(x: number): number {
  if (x < 0.5) {
    const pi = 3.141592653589793;
    return Math.log(pi / Math.sin(pi * x)) - lgamma(1 - x);
  }
  // Stirling approximation for x >= 0.5
  const sqrt2pi = 2.5066282746310002;
  const g = 607 / 128;
  const cof: number[] = [
    0.999999999999997, 57.15623566586292, -59.59796035547549,
    14.13609797474175, -0.4919138160976202, 0.3399464998481189e-4,
    0.4652362892704858e-4, -0.9837447530487956e-4, 0.1580887032249125e-3,
    -0.2102644417241049e-3, 0.2174396181152126e-3, -0.1643181065367639e-3,
    0.8441822398385274e-4, -0.2619083840158141e-4, 0.3689918265953162e-5,
  ];
  let z = x - 1;
  let ser = cof[0]!;
  for (let i = 1; i < cof.length; i++) {
    ser += cof[i]! / (z + i);
  }
  const tmp = z + g + 0.5;
  return Math.log(sqrt2pi) + (x - 0.5) * Math.log(tmp) - tmp + Math.log(ser);
}

function computeNetLift(
  aggregates: MetricAggregate[],
  runA: EvaluationRun,
  runB: EvaluationRun,
  configAId?: string,
  configBId?: string
): NetLift {
  const aggregateById = new Map(aggregates.map((aggregate) => [aggregate.metricId, aggregate]));
  const byId = (id: string) => aggregateById.get(id)?.meanDelta ?? 0;

  const outcomeLift =
    byId("task_success_rate") * 0.30 +
    byId("llm_judge_score") * 0.25 +
    byId("effective_intervention") * 0.15 +
    byId("intent_resolution") * 0.10 +
    byId("counterfactual_lift") * 0.10;

  const decisionLift = byId("clarification_precision") * 0.10;

  const summaryA = configSummary(runA, configAId);
  const summaryB = configSummary(runB, configBId);
  const costRatio = (summaryA?.averageCostUsd ?? 0) > 0
    ? ((summaryB?.averageCostUsd ?? 0) - (summaryA?.averageCostUsd ?? 0)) / (summaryA!.averageCostUsd)
    : 0;
  const costPenalty =
    Math.abs(Math.min(0, byId("over_action"))) * 0.05 +
    Math.max(0, costRatio) * 0.05;

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
  const aggregateById = new Map(aggregates.map((aggregate) => [aggregate.metricId, aggregate]));
  const byId = (id: string) => aggregateById.get(id);

  const effInt = byId("effective_intervention");
  const intentRes = byId("intent_resolution");
  const overAction = byId("over_action");
  const tokenEff = byId("token_efficiency");
  const taskSuccess = byId("task_success_rate");
  const llmJudge = byId("llm_judge_score");

  const outcomeImproved = cases.filter((c) => c.direction === "improved").length;
  const outcomeDegraded = cases.filter((c) => c.direction === "degraded").length;

  const conditions: ConditionCheck[] = [
    {
      condition: "task_success_rate 不下降（用户任务完成率）",
      passed: (taskSuccess?.meanDelta ?? 0) >= 0,
      detail: `Δ = ${formatDelta(taskSuccess?.meanDelta)}`,
    },
    {
      condition: "llm_judge_score 有可感知提升 (+3% 以上)",
      passed: (llmJudge?.meanDelta ?? 0) >= 0.03,
      detail: `Δ = ${formatDelta(llmJudge?.meanDelta)}`,
    },
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
    passedCount >= 5 ? "mixed" :
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
  lines.push("| Metric | Mean A | Mean B | Δ Mean | Δ Median | Win Rate | Loss Rate | p-value | Cohen's d |");
  lines.push("|---|---:|---:|---:|---:|---:|---:|---:|");
  for (const m of r.metricAggregates) {
    const pStr = m.pValue !== undefined ? (m.pValue < 0.001 ? "<0.001" : m.pValue.toFixed(3)) : "-";
    const dStr = m.cohensD !== undefined ? (m.cohensD > 0 ? "+" : "") + m.cohensD.toFixed(2) : "-";
    const sigMark = m.significant ? " *" : "";
    lines.push(
      `| ${m.metricId}${sigMark} | ${pct(m.meanA)} | ${pct(m.meanB)} | ${formatDelta(m.meanDelta)} | ${formatDelta(m.medianDelta)} | ${pct(m.winRate)} | ${pct(m.lossRate)} | ${pStr} | ${dStr} |`
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

/**
 * Multi-config comparison within a single evaluation run.
 * Compares every pair of configs and ranks them by net lift.
 */

export interface ConfigPairResult {
  configA: string;
  configB: string;
  netLift: NetLift;
  verdict: ComparisonVerdict;
  topImprovedMetrics: string[];
  topDegradedMetrics: string[];
}

export interface MultiConfigComparisonReport {
  meta: {
    runId: string;
    configIds: string[];
    comparedAt: number;
  };
  pairs: ConfigPairResult[];
  ranking: { configId: string; netLiftScore: number }[];
  summary: string;
}

export function compareEvaluationConfigs(
  run: EvaluationRun,
  options?: { referenceConfigId?: string }
): MultiConfigComparisonReport {
  const configIds = run.spec.configs.map((c) => c.id);
  if (configIds.length < 2) {
    return {
      meta: { runId: run.id, configIds, comparedAt: Date.now() },
      pairs: [],
      ranking: configIds.map((id) => ({ configId: id, netLiftScore: 0 })),
      summary: "Need at least 2 configs for comparison.",
    };
  }

  const pairs: ConfigPairResult[] = [];
  const configScores = new Map<string, number>();

  for (const id of configIds) {
    configScores.set(id, 0);
  }

  const comparePairs = options?.referenceConfigId
    ? configIds.filter((id) => id !== options.referenceConfigId).map((id) => [options.referenceConfigId!, id] as const)
    : configIds.flatMap((a, i) => configIds.slice(i + 1).map((b) => [a, b] as const));

  for (const [configA, configB] of comparePairs) {
    const pairReport = compareEvaluationRuns(run, run, { configAId: configA, configBId: configB });
    const topImproved = pairReport.metricAggregates
      .filter((m) => m.meanDelta > 0.03)
      .sort((a, b) => b.meanDelta - a.meanDelta)
      .slice(0, 3)
      .map((m) => m.metricId);
    const topDegraded = pairReport.metricAggregates
      .filter((m) => m.meanDelta < -0.03)
      .sort((a, b) => a.meanDelta - b.meanDelta)
      .slice(0, 3)
      .map((m) => m.metricId);

    pairs.push({
      configA,
      configB,
      netLift: pairReport.netLift,
      verdict: pairReport.verdict.overall,
      topImprovedMetrics: topImproved,
      topDegradedMetrics: topDegraded,
    });

    configScores.set(configB, (configScores.get(configB) ?? 0) + pairReport.netLift.netLift);
  }

  const ranking = [...configScores.entries()]
    .sort(([, a], [, b]) => b - a)
    .map(([configId, netLiftScore]) => ({ configId, netLiftScore: round(netLiftScore) }));

  const bestConfig = ranking[0]?.configId ?? "";
  const bestLabel = run.spec.configs.find((c) => c.id === bestConfig)?.label ?? bestConfig;
  const summary = ranking.length >= 2
    ? `Best: ${bestLabel} (${bestConfig}). Full ranking: ${ranking.map((r, i) => `${i + 1}. ${r.configId} (${r.netLiftScore > 0 ? "+" : ""}${r.netLiftScore})`).join(", ")}.`
    : "Insufficient data for ranking.";

  return {
    meta: { runId: run.id, configIds, comparedAt: Date.now() },
    pairs,
    ranking,
    summary,
  };
}

export function formatMultiConfigReport(
  report: MultiConfigComparisonReport,
  format: "markdown" | "json"
): string {
  if (format === "json") {
    return JSON.stringify(report, null, 2);
  }
  const lines: string[] = [];
  lines.push("# Causal Intervention Level Comparison Report");
  lines.push("");
  lines.push(`**Run**: \`${report.meta.runId}\``);
  lines.push(`**Configs**: ${report.meta.configIds.join(", ")}`);
  lines.push(`**Compared**: ${new Date(report.meta.comparedAt).toISOString()}`);
  lines.push("");

  lines.push("## Ranking");
  lines.push("");
  lines.push("| Rank | Config | Net Lift Score |");
  lines.push("|---|---|---|");
  for (let i = 0; i < report.ranking.length; i++) {
    const r = report.ranking[i]!;
    lines.push(`| ${i + 1} | ${r.configId} | ${r.netLiftScore > 0 ? "+" : ""}${r.netLiftScore} |`);
  }
  lines.push("");

  lines.push("## Pairwise Comparisons");
  lines.push("");
  for (const pair of report.pairs) {
    const verdictEmoji = pair.verdict === "causal_wins" ? "✅" : pair.verdict === "mixed" ? "⚠️" : "❌";
    lines.push(`### ${pair.configA} → ${pair.configB} ${verdictEmoji}`);
    lines.push("");
    lines.push(`- **Net Lift**: ${pair.netLift.netLift > 0 ? "+" : ""}${pair.netLift.netLift}`);
    lines.push(`- **Outcome Lift**: ${pair.netLift.outcomeLift > 0 ? "+" : ""}${pair.netLift.outcomeLift}`);
    lines.push(`- **Decision Lift**: ${pair.netLift.decisionLift > 0 ? "+" : ""}${pair.netLift.decisionLift}`);
    lines.push(`- **Cost Penalty**: ${pair.netLift.costPenalty}`);
    lines.push(`- **Verdict**: ${pair.verdict}`);
    if (pair.topImprovedMetrics.length > 0) {
      lines.push(`- **Top Improved**: ${pair.topImprovedMetrics.join(", ")}`);
    }
    if (pair.topDegradedMetrics.length > 0) {
      lines.push(`- **Top Degraded**: ${pair.topDegradedMetrics.join(", ")}`);
    }
    lines.push("");
  }

  if (report.pairs.length === 0) {
    lines.push("(No pairwise comparisons available)");
    lines.push("");
  }

  lines.push("## Summary");
  lines.push("");
  lines.push(report.summary);

  return lines.join("\n");
}
