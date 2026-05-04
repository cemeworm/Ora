import type { ActionRecord, OraToolCallEnvelope, PlanListStep } from "@cemeworm/shared";

export interface RuntimeCompletionGuardState {
  actions: readonly ActionRecord[];
  planList: readonly PlanListStep[];
  toolCalls: readonly OraToolCallEnvelope[];
}

export type RuntimeCompletionGuardResult =
  | { allowComplete: true }
  | {
      allowComplete: false;
      reason: string;
      progressTrigger: string;
      progressSummary: string;
      detail: string;
      followUpReason: string;
      followUpContent: string;
    };

export type RuntimeCompletionGuard = (
  state: RuntimeCompletionGuardState,
) => RuntimeCompletionGuardResult;

export function evaluateRuntimeCompletionGuards(
  state: RuntimeCompletionGuardState,
  guards: readonly RuntimeCompletionGuard[] = DEFAULT_RUNTIME_COMPLETION_GUARDS,
): RuntimeCompletionGuardResult {
  for (const guard of guards) {
    const result = guard(state);
    if (!result.allowComplete) {
      return result;
    }
  }
  return { allowComplete: true };
}

export const DEFAULT_RUNTIME_COMPLETION_GUARDS: readonly RuntimeCompletionGuard[] = [
  planListCompletionGuard,
  pendingRuntimeWorkGuard,
];

export function planListCompletionGuard(
  state: RuntimeCompletionGuardState,
): RuntimeCompletionGuardResult {
  const unfinishedPlanSteps = state.planList.filter((item) => item.status !== "completed");
  if (unfinishedPlanSteps.length === 0) {
    return { allowComplete: true };
  }

  const detail = unfinishedPlanSteps
    .map((item, index) => `${index + 1}. [${item.status}] ${item.step}`)
    .join("\n");

  return {
    allowComplete: false,
    reason: "plan_list_incomplete",
    progressTrigger: "plan_list.incomplete",
    progressSummary: "Plan list still has unfinished steps; continuing the run.",
    detail,
    followUpReason: "plan_list_incomplete_follow_up",
    followUpContent: [
      "The current plan list is not complete yet, so do not provide a final answer.",
      "Continue executing the remaining plan steps. Use plan.update with the full plan array as you make progress.",
      "Unfinished steps:",
      detail,
    ].join("\n"),
  };
}

export function pendingRuntimeWorkGuard(
  state: RuntimeCompletionGuardState,
): RuntimeCompletionGuardResult {
  const pendingActions = state.actions.filter((item) =>
    !item.type.startsWith("agent.") &&
    (
      item.status === "proposed" ||
      item.status === "approval_required" ||
      item.status === "approved" ||
      item.status === "running"
    )
  );
  const pendingToolCalls = state.toolCalls.filter((item) =>
    item.status === "proposed" ||
    item.status === "approval_required" ||
    item.status === "approved" ||
    item.status === "running"
  );
  if (pendingActions.length === 0 && pendingToolCalls.length === 0) {
    return { allowComplete: true };
  }

  const actionLines = pendingActions.map((item, index) =>
    `action ${index + 1}. [${item.status}] ${item.type} (${item.id})`
  );
  const toolCallLines = pendingToolCalls.map((item, index) =>
    `tool call ${index + 1}. [${item.status}] ${item.toolId} (${item.id})`
  );
  const detail = [...actionLines, ...toolCallLines].join("\n");

  return {
    allowComplete: false,
    reason: "pending_runtime_work",
    progressTrigger: "runtime_work.pending",
    progressSummary: "Runtime work is still pending; continuing the run.",
    detail,
    followUpReason: "pending_runtime_work_follow_up",
    followUpContent: [
      "The runtime still has unresolved work, so do not provide a final answer.",
      "Continue from the pending action or tool state before concluding.",
      "Pending work:",
      detail,
    ].join("\n"),
  };
}
