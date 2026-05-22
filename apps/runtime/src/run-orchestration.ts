import {
  deriveRunAttention,
  OraEventEnvelope,
  OraEventEnvelopeSchema,
  RunAttention,
  StateSnapshot,
  StateSnapshotSchema,
  UserTaskInput,
  UserTaskInputSchema
} from "@cemeworm/shared";
import type { ActionRecord } from "@cemeworm/shared";

export interface ParsedResumePatch {
  patchRecord: Record<string, unknown>;
  clarificationPatch: Record<string, unknown>;
  approvedActionIds: string[];
  planDecisionResolutions: Array<{
    decisionId: string;
    status: "accepted" | "declined";
  }>;
}

export interface ApprovedResumeAction {
  type: ActionRecord["type"];
  riskLevel: ActionRecord["riskLevel"];
  input: ActionRecord["input"];
  agentId: ActionRecord["agentId"];
}

export function parseResumePatch(patch: unknown): ParsedResumePatch {
  const patchRecord = patch && typeof patch === "object" && patch !== null
    ? patch as Record<string, unknown>
    : {};
  const clarificationPatch = "clarifications" in patchRecord &&
    typeof patchRecord.clarifications === "object" &&
    patchRecord.clarifications !== null
    ? patchRecord.clarifications as Record<string, unknown>
    : {};
  const approvedActionIds = Array.isArray(patchRecord.approvedActionIds)
    ? patchRecord.approvedActionIds.filter((value): value is string => typeof value === "string" && value.length > 0)
    : [];
  const planDecisionResolutions = Array.isArray(patchRecord.planDecisionResolutions)
    ? patchRecord.planDecisionResolutions.flatMap((value) => {
        if (!value || typeof value !== "object") {
          return [];
        }
        const candidate = value as Record<string, unknown>;
        if (
          typeof candidate.decisionId !== "string" ||
          (candidate.status !== "accepted" && candidate.status !== "declined")
        ) {
          return [];
        }
        return [{
          decisionId: candidate.decisionId,
          status: candidate.status,
        }] as Array<{ decisionId: string; status: "accepted" | "declined" }>;
      })
    : [];
  return { patchRecord, clarificationPatch, approvedActionIds, planDecisionResolutions };
}

export function hasKernelResumeWork(snapshot: StateSnapshot): boolean {
  return snapshot.modeSpec !== undefined
    && (currentPendingClarifications(snapshot).length > 0 || currentPendingApprovalActionIds(snapshot).length > 0);
}

export function approvedActionsForResume(
  snapshot: StateSnapshot,
  approvedActionIds: string[],
): ApprovedResumeAction[] {
  const currentApprovalIds = new Set(currentPendingApprovalActionIds(snapshot));
  return approvedActionIds
    .filter((actionId) => currentApprovalIds.has(actionId))
    .map((actionId) => snapshot.actions.find((action) => action.id === actionId))
    .filter((action): action is NonNullable<typeof action> => action !== undefined)
    .map((action) => ({
      type: action.type,
      riskLevel: action.riskLevel,
      input: action.input,
      agentId: action.agentId,
    }));
}

export function resumedInputWithClarifications(
  input: UserTaskInput,
  clarificationPatch: Record<string, unknown>,
): UserTaskInput {
  const nextClarifications = Object.keys(clarificationPatch).length > 0
    ? {
        ...(
          input.context?.clarifications
          && typeof input.context.clarifications === "object"
          && input.context.clarifications !== null
            ? input.context.clarifications
            : {}
        ),
        ...clarificationPatch,
      }
    : input.context?.clarifications;
  return UserTaskInputSchema.parse({
    ...input,
    context: {
      ...input.context,
      ...(nextClarifications ? { clarifications: nextClarifications } : {}),
    },
  });
}

function hasAcceptedPlanDecisionResolution(
  resolutions: Array<{ decisionId: string; status: "accepted" | "declined" }>,
): boolean {
  return resolutions.some((resolution) => resolution.status === "accepted");
}

function unresolvedNonAgentAction(action: ActionRecord): boolean {
  return !action.type.startsWith("agent.")
    && (action.status === "proposed"
      || action.status === "approval_required"
      || action.status === "approved"
      || action.status === "running");
}

function unresolvedToolCall(call: StateSnapshot["toolCalls"][number]): boolean {
  return call.status === "proposed"
    || call.status === "approval_required"
    || call.status === "approved"
    || call.status === "running";
}

function acceptedPlanResumeSupersedeReason(decisionIds: readonly string[]): string {
  const suffix = decisionIds.length > 0
    ? ` (${decisionIds.join(", ")})`
    : "";
  return `Superseded by accepted plan resume${suffix}; continue implementing the accepted plan instead.`;
}

export function materializeResumeStartSnapshot(
  snapshot: StateSnapshot,
  params: {
    approvedActionIds: string[];
    planDecisionResolutions?: Array<{
      decisionId: string;
      status: "accepted" | "declined";
    }>;
    updatedAt: number;
  },
): StateSnapshot {
  const approvedActionIds = params.approvedActionIds;
  const approvedIdSet = new Set(approvedActionIds);
  const resolvedPlanDecisions = new Map(
    (params.planDecisionResolutions ?? []).map((resolution) => [resolution.decisionId, resolution]),
  );
  const clearsPlanDecisionGate = resolvedPlanDecisions.size > 0;
  const acceptedPlanDecisionIds = (params.planDecisionResolutions ?? [])
    .filter((resolution) => resolution.status === "accepted")
    .map((resolution) => resolution.decisionId);
  const shouldSupersedeOrphanedPlanProposalWork = hasAcceptedPlanDecisionResolution(
    params.planDecisionResolutions ?? [],
  );
  const activeFrame = snapshot.continuation.frames.find((frame) => frame.id === snapshot.continuation.activeFrameId);
  const protectedActionIds = new Set([
    ...snapshot.pendingApprovals,
    ...(activeFrame?.pendingActionIds ?? []),
  ]);
  const protectedToolCallIds = new Set(activeFrame?.pendingToolCallIds ?? []);
  const supersedeReason = acceptedPlanResumeSupersedeReason(acceptedPlanDecisionIds);
  const supersededActionIds = new Set<string>();
  const nextActions = snapshot.actions.map((action) => {
    if (
      shouldSupersedeOrphanedPlanProposalWork &&
      unresolvedNonAgentAction(action) &&
      !protectedActionIds.has(action.id)
    ) {
      supersededActionIds.add(action.id);
      return {
        ...action,
        status: "skipped" as const,
        error: supersedeReason,
      };
    }
    return action.status === "approval_required" && approvedIdSet.has(action.id)
      ? { ...action, status: "approved" as const }
      : action;
  });
  const nextToolCalls = snapshot.toolCalls.map((call) => {
    if (
      shouldSupersedeOrphanedPlanProposalWork &&
      unresolvedToolCall(call) &&
      !protectedToolCallIds.has(call.id) &&
      (!call.actionId || supersededActionIds.has(call.actionId) || !protectedActionIds.has(call.actionId))
    ) {
      return {
        ...call,
        status: "interrupted" as const,
        updatedAt: params.updatedAt,
        result: {
          status: "interrupted" as const,
          error: supersedeReason,
          content: supersedeReason,
          createdAt: params.updatedAt,
          updatedAt: params.updatedAt,
        },
        error: supersedeReason,
        repairReason: "accepted_plan_resume_superseded",
      };
    }
    return call;
  });
  const interruptedSupersededToolCalls = nextToolCalls.filter((call) =>
    call.status === "interrupted"
    && call.repairReason === "accepted_plan_resume_superseded",
  );
  const nextContinuation = {
    ...snapshot.continuation,
    frames: snapshot.continuation.frames.map((frame) => ({
      ...frame,
      pendingActionIds: frame.pendingActionIds.filter((actionId) => !supersededActionIds.has(actionId)),
      pendingToolCallIds: frame.pendingToolCallIds.filter((toolCallId) =>
        !interruptedSupersededToolCalls.some((call) => call.id === toolCallId),
      ),
      updatedAt: frame.id === activeFrame?.id ? params.updatedAt : frame.updatedAt,
    })),
  };
  const interruptedToolConversation = interruptedSupersededToolCalls
    .filter((call) =>
      !snapshot.conversation.some((message) =>
        message.role === "tool"
        && message.toolCallId === call.id
        && message.status === "interrupted",
      ),
    )
    .map((call) => ({
      role: "tool" as const,
      toolCallId: call.id,
      providerCallId: call.providerCallId,
      toolId: call.toolId,
      content: supersedeReason,
      status: "interrupted" as const,
      createdAt: params.updatedAt,
    }));
  const interruptedToolResults = interruptedSupersededToolCalls
    .filter((call) =>
      !snapshot.toolResults.some((result) => result.resultToolCallId === call.id && result.status === "interrupted")
    )
    .map((call) => ({
      key: `${call.toolId}:${JSON.stringify(call.args)}`,
      toolId: call.toolId,
      argsDigest: JSON.stringify(call.args),
      resultToolCallId: call.id,
      status: "interrupted" as const,
      error: supersedeReason,
      createdAt: params.updatedAt,
      updatedAt: params.updatedAt,
    }));
  return StateSnapshotSchema.parse({
    ...snapshot,
    status: "running",
    attention: clearsPlanDecisionGate ? undefined : snapshot.attention,
    actions: nextActions,
    toolCalls: nextToolCalls,
    continuation: nextContinuation,
    pendingApprovals: snapshot.pendingApprovals.filter((actionId) =>
      !approvedIdSet.has(actionId) && !supersededActionIds.has(actionId)
    ),
    planDecisions: snapshot.planDecisions.map((decision) => {
      const resolution = resolvedPlanDecisions.get(decision.id);
      if (!resolution) {
        return decision;
      }
      return {
        ...decision,
        status: resolution.status,
        resolvedAt: params.updatedAt,
      };
    }),
    conversation: [...snapshot.conversation, ...interruptedToolConversation],
    toolResults: [...snapshot.toolResults, ...interruptedToolResults],
    updatedAt: params.updatedAt,
  });
}

export function snapshotCurrentAttention(snapshot: StateSnapshot): RunAttention {
  return snapshot.attention ?? deriveRunAttention(snapshot);
}

export function currentPendingClarifications(snapshot: StateSnapshot): StateSnapshot["pendingClarifications"] {
  const attention = snapshotCurrentAttention(snapshot);
  if (attention.kind === "needs_clarification") {
    const currentIds = new Set(attention.pendingClarificationIds);
    const filtered = snapshot.pendingClarifications.filter((clarification) => currentIds.has(clarification.id));
    if (filtered.length > 0) {
      return filtered;
    }
  }
  // 兜底 1：从 continuation frame 获取 pendingClarificationIds
  // 当 attention 推导不一致（如 "paused" 而非 "needs_clarification"）时，continuation
  // frame 是更可靠的真相来源，因为它由内核在中断时显式写入。
  const frame = snapshot.status === "interrupted"
    ? (snapshot.continuation?.frames ?? []).find((f) =>
        f.id === snapshot.continuation?.activeFrameId &&
        f.status === "paused" &&
        f.pendingClarificationIds.length > 0
      )
    : undefined;
  if (frame) {
    const frameIds = new Set(frame.pendingClarificationIds);
    return snapshot.pendingClarifications.filter((clarification) => frameIds.has(clarification.id));
  }
  // 兜底 2：返回 snapshot 中的所有待处理澄清
  // 最后的安全网 — 当 attention 和 continuation frame 都无法提供可靠 ID 列表时，
  // 以实际数据为准，防止 non-kernel 路径静默消费澄清但不重启内核。
  return snapshot.pendingClarifications;
}

export function currentPendingApprovalActionIds(snapshot: StateSnapshot): string[] {
  const attention = snapshotCurrentAttention(snapshot);
  if (attention.kind === "needs_approval") {
    const currentIds = new Set(attention.pendingActionIds);
    for (const toolCallId of attention.pendingToolCallIds) {
      const toolCall = snapshot.toolCalls.find((call) => call.id === toolCallId);
      if (toolCall?.actionId) {
        currentIds.add(toolCall.actionId);
      }
    }
    const filtered = snapshot.actions
      .filter((action) => action.status === "approval_required" && currentIds.has(action.id))
      .map((action) => action.id);
    if (filtered.length > 0) {
      return filtered;
    }
  }
  // 兜底 1：从 continuation frame 获取 pendingActionIds / pendingToolCallIds
  const frame = snapshot.status === "interrupted"
    ? (snapshot.continuation?.frames ?? []).find((f) =>
        f.id === snapshot.continuation?.activeFrameId &&
        f.status === "paused" &&
        (f.pendingActionIds.length > 0 || f.pendingToolCallIds.length > 0)
      )
    : undefined;
  if (frame) {
    const currentIds = new Set(frame.pendingActionIds);
    for (const toolCallId of frame.pendingToolCallIds) {
      const toolCall = snapshot.toolCalls.find((call) => call.id === toolCallId);
      if (toolCall?.actionId) {
        currentIds.add(toolCall.actionId);
      }
    }
    return snapshot.actions
      .filter((action) => action.status === "approval_required" && currentIds.has(action.id))
      .map((action) => action.id);
  }
  // 兜底 2：返回所有 approval_required 的 actions
  return snapshot.actions
    .filter((action) => action.status === "approval_required")
    .map((action) => action.id);
}

export function currentPendingApprovalActions(snapshot: StateSnapshot): ActionRecord[] {
  const currentIds = new Set(currentPendingApprovalActionIds(snapshot));
  return snapshot.actions.filter((action) => currentIds.has(action.id));
}

export function currentPendingApprovalToolActionIds(snapshot: StateSnapshot): string[] {
  const attention = snapshotCurrentAttention(snapshot);
  if (attention.kind !== "needs_approval") {
    return [];
  }
  const currentToolCallIds = new Set(attention.pendingToolCallIds);
  const actionIds = new Set<string>();
  for (const call of snapshot.toolCalls) {
    if (call.actionId && call.status === "approval_required" && currentToolCallIds.has(call.id)) {
      actionIds.add(call.actionId);
    }
  }
  return [...actionIds];
}

export function statusForRunEvent(
  type: OraEventEnvelope["type"],
  currentStatus: StateSnapshot["status"],
): StateSnapshot["status"] {
  return type === "run.done"
    ? "succeeded"
    : type === "run.failed"
      ? "failed"
      : type === "run.cancelled"
        ? "cancelled"
        : type === "run.interrupted"
          ? "interrupted"
          : currentStatus;
}

export function rebaseRunEvent(
  event: OraEventEnvelope,
  runId: string,
  baseSeq: number,
): OraEventEnvelope {
  return OraEventEnvelopeSchema.parse({
    ...event,
    id: `${runId}:evt-${baseSeq + event.seq}`,
    seq: baseSeq + event.seq,
  });
}

export function createFailedRunEvent(params: {
  runId: string;
  seq: number;
  createdAt: number;
  pattern: StateSnapshot["pattern"];
  error: string;
}): OraEventEnvelope {
  return OraEventEnvelopeSchema.parse({
    id: `${params.runId}:evt-${params.seq}`,
    runId: params.runId,
    seq: params.seq,
    type: "run.failed",
    createdAt: params.createdAt,
    pattern: params.pattern,
    payload: { status: "failed", error: params.error },
  });
}

export function createInterruptedRunEvent(params: {
  runId: string;
  seq: number;
  createdAt: number;
  pattern: StateSnapshot["pattern"];
  reason: string;
  error?: string;
}): OraEventEnvelope {
  return OraEventEnvelopeSchema.parse({
    id: `${params.runId}:evt-${params.seq}`,
    runId: params.runId,
    seq: params.seq,
    type: "run.interrupted",
    createdAt: params.createdAt,
    pattern: params.pattern,
    payload: { status: "interrupted", reason: params.reason, error: params.error },
  });
}
