import { deriveRunDiagnostics } from "./diagnostics.js";
import type { RunStatus } from "./primitives.js";
import type { StateSnapshot } from "./runtime.js";

export type ComparisonDirection = "improved" | "degraded" | "unchanged" | "not_applicable";
export type ComparisonWeight = "high" | "medium" | "low";
export type RunComparisonVerdict = "better" | "worse" | "mixed" | "inconclusive";

export interface DimensionDiff<T> {
  label: string;
  base: T;
  target: T;
  delta: string;
  direction: ComparisonDirection;
  weight: ComparisonWeight;
  detail?: string;
}

export interface RunComparison {
  baseRunId: string;
  targetRunId: string;
  dimensions: {
    outcome: DimensionDiff<RunStatus>;
    costOrEvents: DimensionDiff<number>;
    toolUsage: DimensionDiff<number>;
    gateEfficiency: DimensionDiff<number>;
    recovery: DimensionDiff<number>;
  };
  verdict: RunComparisonVerdict;
  verdictReason: string;
}

export function compareRuns(base: StateSnapshot, target: StateSnapshot): RunComparison {
  const baseDiagnostics = deriveRunDiagnostics(base);
  const targetDiagnostics = deriveRunDiagnostics(target);
  const dimensions = {
    outcome: compareOutcome(base.status, target.status),
    costOrEvents: compareLowerIsBetter({
      label: "Events",
      base: base.events.length,
      target: target.events.length,
      weight: "medium",
      detail: "Lower event volume usually makes failure points easier to inspect.",
    }),
    toolUsage: compareLowerIsBetter({
      label: "Tool calls",
      base: base.toolCalls.length,
      target: target.toolCalls.length,
      weight: "low",
      detail: repeatedToolDetail(base, target),
    }),
    gateEfficiency: compareLowerIsBetter({
      label: "Open gates",
      base: countOpenGates(base),
      target: countOpenGates(target),
      weight: "low",
      detail: "Open approvals, clarifications, and plan decisions.",
    }),
    recovery: compareLowerIsBetter({
      label: "Recovery signals",
      base: countRecoverySignals(base, baseDiagnostics.signals.length),
      target: countRecoverySignals(target, targetDiagnostics.signals.length),
      weight: "medium",
      detail: "Recovery events, failed tool calls, interrupted tool calls, and paused continuation frames.",
    }),
  };
  const { verdict, verdictReason } = deriveVerdict(Object.values(dimensions));
  return {
    baseRunId: base.runId,
    targetRunId: target.runId,
    dimensions,
    verdict,
    verdictReason,
  };
}

function compareOutcome(base: RunStatus, target: RunStatus): DimensionDiff<RunStatus> {
  const baseRank = outcomeRank(base);
  const targetRank = outcomeRank(target);
  const direction = targetRank > baseRank
    ? "improved"
    : targetRank < baseRank
      ? "degraded"
      : "unchanged";
  return {
    label: "Outcome",
    base,
    target,
    delta: direction === "unchanged" ? "no change" : `${base} -> ${target}`,
    direction,
    weight: "high",
  };
}

function compareLowerIsBetter(params: {
  label: string;
  base: number;
  target: number;
  weight: ComparisonWeight;
  detail?: string;
}): DimensionDiff<number> {
  const delta = params.target - params.base;
  const direction = delta < 0
    ? "improved"
    : delta > 0
      ? "degraded"
      : "unchanged";
  return {
    label: params.label,
    base: params.base,
    target: params.target,
    delta: formatNumericDelta(delta, params.base),
    direction,
    weight: params.weight,
    detail: params.detail,
  };
}

function deriveVerdict(dimensions: Array<DimensionDiff<unknown>>): {
  verdict: RunComparisonVerdict;
  verdictReason: string;
} {
  const highDegraded = dimensions.filter((dimension) =>
    dimension.weight === "high" && dimension.direction === "degraded"
  );
  if (highDegraded.length > 0) {
    return {
      verdict: "worse",
      verdictReason: `${highDegraded[0]?.label ?? "A high-weight dimension"} degraded.`,
    };
  }

  const improved = dimensions.filter((dimension) => dimension.direction === "improved");
  const degraded = dimensions.filter((dimension) => dimension.direction === "degraded");
  const highImproved = improved.filter((dimension) => dimension.weight === "high");
  const mediumImproved = improved.filter((dimension) => dimension.weight === "medium");
  const mediumDegraded = degraded.filter((dimension) => dimension.weight === "medium");

  if (improved.length === 0 && degraded.length === 0) {
    return {
      verdict: "inconclusive",
      verdictReason: "No compared dimension changed.",
    };
  }
  if (degraded.length === 0 && (highImproved.length > 0 || mediumImproved.length > 0)) {
    return {
      verdict: "better",
      verdictReason: `${improved.map((dimension) => dimension.label).join(", ")} improved without measured regressions.`,
    };
  }
  if (mediumDegraded.length > 0 && improved.length === 0) {
    return {
      verdict: "worse",
      verdictReason: `${mediumDegraded[0]?.label ?? "A medium-weight dimension"} degraded without offsetting improvements.`,
    };
  }
  return {
    verdict: "mixed",
    verdictReason: `Improved: ${improved.map((dimension) => dimension.label).join(", ") || "none"}; degraded: ${degraded.map((dimension) => dimension.label).join(", ") || "none"}.`,
  };
}

function outcomeRank(status: RunStatus): number {
  switch (status) {
    case "succeeded":
      return 4;
    case "running":
      return 3;
    case "queued":
      return 2;
    case "interrupted":
      return 1;
    case "cancelled":
    case "failed":
      return 0;
  }
  return 0;
}

function countOpenGates(snapshot: StateSnapshot): number {
  return snapshot.pendingApprovals.length +
    snapshot.pendingClarifications.length +
    snapshot.planDecisions.filter((gate) => gate.status === "pending").length;
}

function countRecoverySignals(snapshot: StateSnapshot, diagnosticSignalCount: number): number {
  const recoveryEvents = snapshot.events.filter((event) => event.type.startsWith("recovery.")).length;
  const failedOrInterruptedTools = snapshot.toolCalls.filter((call) =>
    call.status === "failed" || call.status === "interrupted" || call.status === "repaired"
  ).length;
  const pausedFrames = snapshot.continuation.frames.filter((frame) => frame.status === "paused").length;
  return recoveryEvents + failedOrInterruptedTools + pausedFrames + diagnosticSignalCount;
}

function repeatedToolDetail(base: StateSnapshot, target: StateSnapshot): string {
  const baseRepeated = repeatedToolGroupCount(base);
  const targetRepeated = repeatedToolGroupCount(target);
  return `Repeated tool groups: ${baseRepeated} -> ${targetRepeated}.`;
}

function repeatedToolGroupCount(snapshot: StateSnapshot): number {
  const counts = new Map<string, number>();
  for (const call of snapshot.toolCalls) {
    const key = `${call.toolId}:${JSON.stringify(call.args)}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.values()].filter((count) => count >= 3).length;
}

function formatNumericDelta(delta: number, base: number): string {
  if (delta === 0) return "no change";
  const sign = delta > 0 ? "+" : "";
  if (base === 0) return `${sign}${delta}`;
  const percent = Math.round((delta / base) * 100);
  return `${sign}${delta} (${sign}${percent}%)`;
}
