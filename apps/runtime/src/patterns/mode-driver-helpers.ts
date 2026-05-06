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
