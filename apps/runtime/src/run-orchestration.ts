import {
  OraEventEnvelope,
  OraEventEnvelopeSchema,
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
  return { patchRecord, clarificationPatch, approvedActionIds };
}

export function hasKernelResumeWork(snapshot: StateSnapshot): boolean {
  return snapshot.modeSpec !== undefined
    && (snapshot.pendingClarifications.length > 0 || snapshot.actions.some((action) => action.status === "approval_required"));
}

export function approvedActionsForResume(
  snapshot: StateSnapshot,
  approvedActionIds: string[],
): ApprovedResumeAction[] {
  return approvedActionIds
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
