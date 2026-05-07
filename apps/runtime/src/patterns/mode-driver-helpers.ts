import type { ModeNodeSpec } from "@cemeworm/shared";
import type { PatternExecutionContext } from "./execution-context.js";
import { asText } from "./driver-utils.js";
export { runGenericModeNode, runModeNode } from "./generic-node-executor.js";

export type ExecutionBag = Record<string, unknown>;

export function containsCompleteProposedPlan(value: unknown): boolean {
  return /<proposed_plan>\s*[\s\S]+?\s*<\/proposed_plan>/.test(asText(value));
}

export function finishPlanModeAfterProposedPlan(
  context: PatternExecutionContext,
  nodes: ModeNodeSpec[],
  currentIndex: number,
  totalActiveNodes: number,
): void {
  for (const remaining of nodes.slice(currentIndex + 1)) {
    context.setPlanStatus(remaining.id, "skipped");
  }
  context.setQueueSummary({
    pending: 0,
    inProgress: 0,
    completed: totalActiveNodes,
  });
}

export const COMPLEXITY_ASSESSMENT_INSTRUCTION = `
<complexity_assessment>
Analyze the task and classify its complexity:
- L0 (trivial): single file, CSS/text/config only, one-line change, no logic change
- L1 (simple): single file, logic change with clear scope
- L2 (normal): multi-file, cross-module, needs careful review
- L3 (complex): architecture change, new feature, large refactor

Output format: Level: L0|L1|L2|L3
Rationale: <one sentence>
</complexity_assessment>`;

export type ComplexityLevel = "L0" | "L1" | "L2" | "L3";

export function parseComplexityLevel(triageOutput: unknown): ComplexityLevel | null {
  const match = /<complexity_assessment>\s*Level:\s*(L[0-3])/i.exec(asText(triageOutput));
  return (match?.[1] as ComplexityLevel) ?? null;
}
