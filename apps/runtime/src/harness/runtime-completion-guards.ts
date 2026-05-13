import type { ActionRecord, OraToolCallEnvelope, PlanListStep, StateSnapshot } from "@cemeworm/shared";

export interface RuntimeCompletionGuardState {
  actions: readonly ActionRecord[];
  planList: readonly PlanListStep[];
  plan?: StateSnapshot["plan"];
  todos?: StateSnapshot["todos"];
  replayedActionIds?: readonly string[];
  toolCalls: readonly OraToolCallEnvelope[];
}

/**
 * Full terminal-state assertion state that includes gates, pending arrays,
 * and continuation frames — everything needed to prove a run is truly done.
 */
export interface TerminalStateAssertionInput {
  actions: readonly ActionRecord[];
  toolCalls: readonly OraToolCallEnvelope[];
  pendingApprovals: readonly string[];
  pendingClarifications: readonly StateSnapshot["pendingClarifications"];
  continuation: StateSnapshot["continuation"];
  planList: readonly PlanListStep[];
  plan?: StateSnapshot["plan"];
  todos?: StateSnapshot["todos"];
  gates?: readonly {
    gateId: string;
    kind: "clarification" | "approval" | "plan_decision";
    status: "open" | "resolved";
  }[];
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

const TERMINAL_APPROVED_REPLAY_TOOL_IDS = new Set<string>([
  "file.write",
  "file.patch",
  "skills.create",
  "skills.update",
  "skills.setEnabled",
]);

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

/**
 * Structural final-output guard — does not inspect language-specific phrases.
 *
 * Checks that the candidate final answer has non-empty user-visible text after
 * trimming, without relying on any hard-coded "unfinished intro" patterns.
 *
 * This guard should run after work-state guards (plan list, legacy progress,
 * pending runtime work) all pass, to prevent runs from completing with an
 * empty final model response.
 */
export function finalOutputGuard(
  responseText: string,
  metadata?: { isPostTool?: boolean },
): RuntimeCompletionGuardResult {
  const trimmed = responseText.trim();
  if (trimmed.length === 0) {
    return {
      allowComplete: false,
      reason: "final_output_empty",
      progressTrigger: "final_output.empty",
      progressSummary: "Final model response is empty; refusing to complete.",
      detail: "The latest model response has no user-visible text.",
      followUpReason: metadata?.isPostTool
        ? "final_output_empty_post_tool_repair"
        : "final_output_empty_follow_up",
      followUpContent: metadata?.isPostTool
        ? "Your previous response after the tool result was empty. Produce the final user-facing answer now using the available conversation and tool results. Do not call tools."
        : "The latest model response is empty. Produce the final user-facing answer now using the available conversation and tool results.",
    };
  }
  return { allowComplete: true };
}

export const DEFAULT_RUNTIME_COMPLETION_GUARDS: readonly RuntimeCompletionGuard[] = [
  planListCompletionGuard,
  legacyProgressCompletionGuard,
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

export function legacyProgressCompletionGuard(
  state: RuntimeCompletionGuardState,
): RuntimeCompletionGuardResult {
  const succeededActionIds = new Set(
    state.actions.filter((action) => action.status === "succeeded").map((action) => action.id),
  );
  const autoCompletablePlanIds = new Set(
    (state.plan ?? [])
      .filter((item) => isAutoCompletableBlockedPlan(item, succeededActionIds))
      .map((item) => item.id),
  );
  const rawUnfinishedPlans = (state.plan ?? []).filter((item) => item.status !== "done" && item.status !== "skipped");
  const rawUnfinishedTodos = (state.todos ?? []).filter((item) => item.status !== "done" && item.status !== "skipped");
  const unfinishedPlans = rawUnfinishedPlans.filter((item) => !autoCompletablePlanIds.has(item.id));
  const unfinishedTodos = rawUnfinishedTodos.filter((item) =>
    !(item.status === "blocked" && item.sourcePlanItemId && autoCompletablePlanIds.has(item.sourcePlanItemId))
  );
  if (unfinishedPlans.length === 0 && unfinishedTodos.length === 0) {
    return { allowComplete: true };
  }
  const replayedActionIds = state.replayedActionIds ? new Set(state.replayedActionIds) : undefined;
  const hasNonTerminalSucceededReplay = state.actions.some((action) =>
    action.status === "succeeded" &&
    (replayedActionIds ? replayedActionIds.has(action.id) : true) &&
    !action.type.startsWith("agent.") &&
    !TERMINAL_APPROVED_REPLAY_TOOL_IDS.has(action.type)
  );
  if (
    [...unfinishedPlans, ...unfinishedTodos].every((item) => item.status === "blocked") &&
    !hasNonTerminalSucceededReplay
  ) {
    return { allowComplete: true };
  }

  const planLines = unfinishedPlans.map((item, index) =>
    `plan ${index + 1}. [${item.status}] ${item.title} (${item.id})`
  );
  const todoLines = unfinishedTodos.map((item, index) =>
    `todo ${index + 1}. [${item.status}] ${item.label} (${item.id})`
  );
  const detail = [...planLines, ...todoLines].join("\n");

  return {
    allowComplete: false,
    reason: "legacy_progress_incomplete",
    progressTrigger: "legacy_progress.incomplete",
    progressSummary: "Runtime plan or todo progress is still incomplete; continuing the run.",
    detail,
    followUpReason: "legacy_progress_incomplete_follow_up",
    followUpContent: [
      "The runtime plan/todo progress is not complete yet, so do not provide a final answer.",
      "Continue the original task from the interrupted state before concluding.",
      "Unfinished progress:",
      detail,
    ].join("\n"),
  };
}

function isAutoCompletableBlockedPlan(
  item: StateSnapshot["plan"][number],
  succeededActionIds: ReadonlySet<string>,
): boolean {
  if (item.status !== "blocked") {
    return false;
  }
  const actionIds = [...new Set(item.linkedActionIds ?? [])];
  return actionIds.length > 0 && actionIds.every((actionId) => succeededActionIds.has(actionId));
}

/**
 * Shared terminal finalization gate. No code path may emit or persist
 * run.done / status: "succeeded" unless this assertion passes.
 *
 * If the assertion fails, an error is thrown with a diagnostic message
 * listing every reason the run cannot yet be terminal. Callers in the
 * kernel or resume paths must catch this error and either:
 *  - downgrade to "interrupted", or
 *  - mark the run "failed" with an integrity diagnostic.
 */
export function assertRunCanBecomeTerminal(
  input: TerminalStateAssertionInput,
): void {
  const violations: string[] = [];

  // 1. Open gates (approval, clarification, plan-decision)
  if (input.gates) {
    const openGates = input.gates.filter((gate) => gate.status === "open");
    if (openGates.length > 0) {
      violations.push(
        `open gates: ${openGates.map((g) => `${g.kind}:${g.gateId}`).join(", ")}`,
      );
    }
  }

  // 2. Pending approvals
  if (input.pendingApprovals.length > 0) {
    violations.push(
      `pending approvals: ${input.pendingApprovals.join(", ")}`,
    );
  }

  // 3. Pending clarifications
  if (input.pendingClarifications.length > 0) {
    violations.push(
      `pending clarifications: ${input.pendingClarifications.map((c) => c.id).join(", ")}`,
    );
  }

  // 4. Non-agent actions in non-terminal states
  const pendingActions = input.actions.filter((item) =>
    !item.type.startsWith("agent.") &&
    (
      item.status === "proposed" ||
      item.status === "approval_required" ||
      item.status === "approved" ||
      item.status === "running"
    )
  );
  if (pendingActions.length > 0) {
    violations.push(
      `unresolved non-agent actions: ${pendingActions.map((a) => `${a.type}:${a.id}[${a.status}]`).join(", ")}`,
    );
  }

  // 5. Tool calls in non-terminal states
  const pendingToolCalls = input.toolCalls.filter((item) =>
    item.status === "proposed" ||
    item.status === "approval_required" ||
    item.status === "approved" ||
    item.status === "running"
  );
  if (pendingToolCalls.length > 0) {
    violations.push(
      `unresolved tool calls: ${pendingToolCalls.map((tc) => `${tc.toolId}:${tc.id}[${tc.status}]`).join(", ")}`,
    );
  }

  // 6. Active approval/clarification continuation frames
  const activeFrames = input.continuation.frames.filter((frame) =>
    frame.status === "paused" || frame.status === "awaiting_model"
  );
  for (const frame of activeFrames) {
    if (
      frame.reason === "approval_required" &&
      (frame.pendingActionIds.length > 0 || frame.pendingToolCallIds.length > 0)
    ) {
      violations.push(
        `active approval continuation frame: ${frame.id} (pending actions: ${frame.pendingActionIds.join(", ")})`,
      );
    }
    if (
      frame.reason === "clarification_required" &&
      frame.pendingClarificationIds.length > 0
    ) {
      violations.push(
        `active clarification continuation frame: ${frame.id}`,
      );
    }
  }

  if (violations.length === 0) {
    return;
  }

  throw new TerminalStateIntegrityError(
    `Run cannot become terminal. Violations: ${violations.join("; ")}`,
    violations,
  );
}

/**
 * Error thrown when a run cannot reach terminal state due to unresolved
 * runtime work, gates, or continuation frames.
 */
export class TerminalStateIntegrityError extends Error {
  constructor(
    message: string,
    public readonly violations: readonly string[],
  ) {
    super(message);
    this.name = "TerminalStateIntegrityError";
  }
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
