import type {
  ActionRecord,
  ChildSessionSummary,
  OraToolCallEnvelope,
  PlanListStep,
  StateSnapshot,
} from "@cemeworm/shared";
import {
  hasAcceptedPlanSameRunImplementationContract,
} from "@cemeworm/shared";

export interface RuntimeCompletionGuardState {
  actions: readonly ActionRecord[];
  planList: readonly PlanListStep[];
  plan?: StateSnapshot["plan"];
  todos?: StateSnapshot["todos"];
  replayedActionIds?: readonly string[];
  toolCalls: readonly OraToolCallEnvelope[];
  agentId?: string;
  runId?: string;
  modeId?: string;
  metadata?: Record<string, unknown>;
  activeBackgroundChildCount?: number;
  pendingAsyncResultCount?: number;
  collaborationRequirement?: "none" | "required";
  collaborationObserved?: boolean;
  stalledBackgroundChildren?: readonly Pick<
    ChildSessionSummary,
    "id" | "agentId" | "label" | "lifecyclePhase" | "stallReason" | "resultAvailability"
  >[];
}

/**
 * Full terminal-state assertion state that includes gates, pending arrays,
 * and continuation frames — everything needed to prove a run is truly done.
 */
export interface TerminalStateAssertionInput {
  actions: readonly ActionRecord[];
  toolCalls: readonly OraToolCallEnvelope[];
  pendingApprovals: readonly string[];
  pendingClarifications: StateSnapshot["pendingClarifications"];
  continuation: StateSnapshot["continuation"];
  planList: readonly PlanListStep[];
  plan?: StateSnapshot["plan"];
  todos?: StateSnapshot["todos"];
  runId?: string;
  modeId?: string;
  metadata?: Record<string, unknown>;
  activeBackgroundChildCount?: number;
  pendingAsyncResultCount?: number;
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
  "file.apply_patch",
  "skills.create",
  "skills.update",
  "skills.setEnabled",
  "skills.patch",
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
/** Minimum visible content length to guard obviously truncated post-tool replies. */
const MIN_POST_TOOL_VISIBLE_CONTENT_LENGTH = 20;

export function finalOutputGuard(
  responseText: string,
  metadata?: { isPostTool?: boolean; finishReason?: string },
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
  if (metadata?.isPostTool && trimmed.length < MIN_POST_TOOL_VISIBLE_CONTENT_LENGTH) {
    const finishReason = metadata.finishReason;
    const looksTruncated =
      typeof finishReason !== "string" || finishReason !== "stop";
    return {
      allowComplete: false,
      reason: "final_output_too_short",
      progressTrigger: "final_output.too_short",
      progressSummary: `Final model response is too short (${trimmed.length} chars); refusing to complete.`,
      detail: looksTruncated
        ? `The latest post-tool model response is only ${trimmed.length} characters and finish_reason=${finishReason ?? "unknown"}. This may indicate the model stream was truncated before the full answer was generated.`
        : `The latest post-tool model response is only ${trimmed.length} characters despite finish_reason=${finishReason}. It may be too terse to stand on its own as the final answer.`,
      followUpReason: "final_output_too_short_repair",
      followUpContent: looksTruncated
        ? [
            "Your previous response may have been truncated.",
            "Continue and complete the user-facing answer now using the available conversation and tool results.",
            "Do not call tools.",
          ].join(" ")
        : [
            "Your previous post-tool response is too brief to stand alone as the final answer.",
            "Rewrite it as a self-contained user-facing answer using the available conversation and tool results.",
            "A concise answer is fine, but it should directly answer the user.",
            "Do not call tools.",
          ].join(" "),
    };
  }
  return { allowComplete: true };
}

export const DEFAULT_RUNTIME_COMPLETION_GUARDS: readonly RuntimeCompletionGuard[] = [
  planListCompletionGuard,
  legacyProgressCompletionGuard,
  pendingRuntimeWorkGuard,
  acceptedPlanImplementationEvidenceGuard,
  requiredCollaborationGuard,
  stalledBackgroundWorkGuard,
  pendingBackgroundWorkGuard,
];

function acceptedImplementationEvidenceSummary(
  state: Pick<RuntimeCompletionGuardState, "actions" | "toolCalls" | "plan" | "modeId" | "runId">,
): { observed: boolean; detail: string } {
  const runId = state.runId;
  const resumedActionEvidence = state.actions.filter((action) =>
    action.status === "succeeded" &&
    !action.type.startsWith("agent.") &&
    (!runId || action.runId === runId)
  );
  if (resumedActionEvidence.length > 0) {
    return {
      observed: true,
      detail: `succeeded actions: ${resumedActionEvidence.map((action) => `${action.type}:${action.id}`).join(", ")}`,
    };
  }

  const resumedToolEvidence = state.toolCalls.filter((call) =>
    call.status === "succeeded" &&
    (!runId || call.runId === runId)
  );
  if (resumedToolEvidence.length > 0) {
    return {
      observed: true,
      detail: `succeeded tool calls: ${resumedToolEvidence.map((call) => `${call.toolId}:${call.id}`).join(", ")}`,
    };
  }

  const planItems = state.plan ?? [];
  const resumePrefix = runId ? `${runId}:` : "";
  const nonPlanningNodes = planItems.filter((item) =>
    item.status === "done" &&
    (!runId || item.runId === runId) &&
    (
      !resumePrefix ||
      (
        !item.id.startsWith(`${resumePrefix}decompose`) &&
        !item.id.startsWith(`${resumePrefix}triage`)
      )
    )
  );
  if (nonPlanningNodes.length > 0) {
    return {
      observed: true,
      detail: `completed implementation nodes: ${nonPlanningNodes.map((item) => item.id).join(", ")}`,
    };
  }

  if (state.modeId === "orchestrator_subagent") {
    return { observed: false, detail: "no succeeded runtime work after accepted same-run resume" };
  }
  return { observed: false, detail: "no implementation evidence observed after accepted same-run resume" };
}

export function acceptedPlanImplementationEvidenceGuard(
  state: RuntimeCompletionGuardState,
): RuntimeCompletionGuardResult {
  if (!hasAcceptedPlanSameRunImplementationContract(state.metadata, state.runId)) {
    return { allowComplete: true };
  }
  const evidence = acceptedImplementationEvidenceSummary(state);
  if (evidence.observed) {
    return { allowComplete: true };
  }
  return {
    allowComplete: false,
    reason: "accepted_plan_implementation_missing",
    progressTrigger: "accepted_plan.implementation_missing",
    progressSummary: "Accepted same-run implementation contract has no implementation evidence; refusing to complete.",
    detail: evidence.detail,
    followUpReason: "accepted_plan_implementation_missing_follow_up",
    followUpContent: [
      "The user accepted the implementation plan for this same run.",
      "Do not finish the run as done until you have actually performed implementation work or surfaced a concrete blocking failure.",
      "Continue the implementation flow instead of stopping at a plan-only milestone.",
    ].join(" "),
  };
}

export function requiredCollaborationGuard(
  state: RuntimeCompletionGuardState,
): RuntimeCompletionGuardResult {
  if (state.collaborationRequirement !== "required" || state.collaborationObserved === true) {
    return { allowComplete: true };
  }
  return {
    allowComplete: false,
    reason: "required_collaboration_missing",
    progressTrigger: "collaboration.required",
    progressSummary: "This turn requires delegated collaboration before the run can complete.",
    detail: "The current run is under a required collaboration contract, but no qualifying collaboration event has been observed yet.",
    followUpReason: "required_collaboration_follow_up",
    followUpContent: [
      "The user explicitly required team-style collaboration for this turn, and you have not satisfied that contract yet.",
      "Before giving the final answer, delegate at least one substantial top-level subtask with agent.spawn and use its result in your synthesis.",
      "Do not provide the final answer until that collaboration has happened.",
    ].join(" "),
  };
}

export function stalledBackgroundWorkGuard(
  state: RuntimeCompletionGuardState,
): RuntimeCompletionGuardResult {
  const stalledChildren = state.stalledBackgroundChildren ?? [];
  if (stalledChildren.length === 0) {
    return { allowComplete: true };
  }
  const detail = stalledChildren
    .map((child, index) => {
      const parts = [
        `child ${index + 1}. ${child.label} (${child.id})`,
        `phase=${child.lifecyclePhase ?? "unknown"}`,
      ];
      if (child.resultAvailability) {
        parts.push(`result=${child.resultAvailability}`);
      }
      if (child.stallReason) {
        parts.push(`reason=${child.stallReason}`);
      }
      return parts.join(" ");
    })
    .join("\n");
  return {
    allowComplete: false,
    reason: "stalled_background_children",
    progressTrigger: "background_children.stalled",
    progressSummary: "One or more background children are stalled; explicit recovery or user-visible escalation is required.",
    detail,
    followUpReason: "stalled_background_children_follow_up",
    followUpContent: [
      "A background child is stalled.",
      "Do not silently conclude the run.",
      "Use the available child lifecycle details to decide whether to continue with partial results, explain the blockage, or ask the user for the needed decision.",
      "Stalled children:",
      detail,
    ].join("\n"),
  };
}

export function pendingBackgroundWorkGuard(
  state: RuntimeCompletionGuardState,
): RuntimeCompletionGuardResult {
  if ((state.pendingAsyncResultCount ?? 0) > 0) {
    return {
      allowComplete: false,
      reason: "pending_background_results",
      progressTrigger: "background_results.pending",
      progressSummary: "Background child results are available but not yet incorporated; continuing the run.",
      detail: `There are ${state.pendingAsyncResultCount ?? 0} async child result(s) waiting to be incorporated for agent ${state.agentId ?? "unknown"}.`,
      followUpReason: "pending_background_results_follow_up",
      followUpContent: [
        "Background child results are now available.",
        "Read the async child updates injected into context and continue the task using them before concluding.",
        "Do not ignore newly completed child work.",
      ].join(" "),
    };
  }
  if ((state.activeBackgroundChildCount ?? 0) > 0) {
    return {
      allowComplete: false,
      reason: "pending_background_children",
      progressTrigger: "background_children.pending",
      progressSummary: "Background child work is still running; waiting for progress before concluding.",
      detail: `There are ${state.activeBackgroundChildCount ?? 0} active background child(ren) still running for agent ${state.agentId ?? "unknown"}.`,
      followUpReason: "pending_background_children_follow_up",
      followUpContent: [
        "Background child work has progressed.",
        "Use any newly injected child updates and continue only after accounting for that work.",
        "If child work is still incomplete, wait for it rather than concluding early.",
      ].join(" "),
    };
  }
  return { allowComplete: true };
}

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
      "Continue only from the current unfinished step. Use plan.update with the full plan array as you make progress.",
      "If the current step cannot continue without user input or a user decision, use the clarification path instead of marking later steps completed.",
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

  const acceptedImplementationGuardResult = acceptedPlanImplementationEvidenceGuard({
    actions: input.actions,
    planList: input.planList,
    plan: input.plan,
    todos: input.todos,
    toolCalls: input.toolCalls,
    runId: input.runId,
    modeId: input.modeId,
    metadata: input.metadata,
    activeBackgroundChildCount: input.activeBackgroundChildCount,
    pendingAsyncResultCount: input.pendingAsyncResultCount,
  });
  if (!acceptedImplementationGuardResult.allowComplete) {
    violations.push(acceptedImplementationGuardResult.detail);
  }

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

/**
 * Derive a TerminalStateAssertionInput from a StateSnapshot.
 * Used by persistence-layer callers (RunResumeFinalizationService,
 * approved tool continuation, non-kernel resume) that don't have
 * direct access to kernel context.
 */
export function deriveTerminalStateAssertionFromSnapshot(
  snapshot: {
    actions: readonly ActionRecord[];
    toolCalls: readonly OraToolCallEnvelope[];
    pendingApprovals: readonly string[];
    pendingClarifications: readonly { id: string }[];
    continuation: { frames: readonly { id: string; status: string; reason: string; pendingActionIds: readonly string[]; pendingToolCallIds: readonly string[]; pendingClarificationIds: readonly string[] }[] };
    planList: readonly PlanListStep[];
    plan?: readonly { id: string; status: string; runId?: string; title?: string; linkedActionIds?: readonly string[] }[];
    todos?: readonly { id: string; status: string }[];
    runId?: string;
    modeId?: string;
    config?: { metadata?: Record<string, unknown> };
  },
  ): TerminalStateAssertionInput {
  const gates: { gateId: string; kind: "clarification" | "approval" | "plan_decision"; status: "open" | "resolved" }[] = [];
  for (const pc of snapshot.pendingClarifications) {
    gates.push({ gateId: pc.id, kind: "clarification" as const, status: "open" as const });
  }
  if (snapshot.pendingApprovals.length > 0) {
    gates.push({ gateId: "approval", kind: "approval" as const, status: "open" as const });
  }
  return {
    actions: snapshot.actions,
    toolCalls: snapshot.toolCalls,
    pendingApprovals: snapshot.pendingApprovals,
    pendingClarifications: snapshot.pendingClarifications as TerminalStateAssertionInput["pendingClarifications"],
    continuation: snapshot.continuation as TerminalStateAssertionInput["continuation"],
    planList: snapshot.planList,
    plan: snapshot.plan as TerminalStateAssertionInput["plan"],
    todos: snapshot.todos as TerminalStateAssertionInput["todos"],
    runId: snapshot.runId,
    modeId: snapshot.modeId,
    metadata: snapshot.config?.metadata,
    gates,
  };
}

export function pendingRuntimeWorkGuard(
  state: RuntimeCompletionGuardState,
): RuntimeCompletionGuardResult {
  const pendingActions = state.actions.filter((item) =>
    (!state.agentId || !item.agentId || item.agentId === state.agentId) &&
    !item.type.startsWith("agent.") &&
    (
      item.status === "proposed" ||
      item.status === "approval_required" ||
      item.status === "approved" ||
      item.status === "running"
    )
  );
  const pendingToolCalls = state.toolCalls.filter((item) => {
    if (
      item.status !== "proposed" &&
      item.status !== "approval_required" &&
      item.status !== "approved" &&
      item.status !== "running"
    ) {
      return false;
    }
    // When an agent spawns a sub-agent, the spawning tool call (agent.spawn)
    // remains "running" while the sub-agent executes. Exclude tool calls
    // owned by a different agent so the sub-agent's guard doesn't block on
    // the parent's in-progress spawn.
    if (state.agentId && item.agentId && item.agentId !== state.agentId) {
      return false;
    }
    return true;
  });
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
