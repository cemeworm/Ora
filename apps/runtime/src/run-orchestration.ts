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

export function runningSnapshotForApprovedActions(
  snapshot: StateSnapshot,
  approvedActionIds: string[],
  updatedAt: number,
): StateSnapshot {
  const approvedIdSet = new Set(approvedActionIds);
  return StateSnapshotSchema.parse({
    ...snapshot,
    status: "running",
    actions: snapshot.actions.map((action) =>
      action.status === "approval_required" && approvedIdSet.has(action.id)
        ? { ...action, status: "approved" }
        : action
    ),
    pendingApprovals: snapshot.pendingApprovals.filter((actionId) => !approvedIdSet.has(actionId)),
    updatedAt,
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
