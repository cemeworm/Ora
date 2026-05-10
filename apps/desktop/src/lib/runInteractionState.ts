import type {
  OraSessionDetail,
  OraSessionSummary,
  OraStateSnapshot,
} from "./runtimeClient";
import type { PendingRunState, RunLifecycle } from "./state";
import { getActiveSnapshot, getPendingRunState } from "./state";

export interface DesktopRunInteractionState {
  sourceRunId?: string;
  sourceSessionId?: string;
  status:
    | "idle"
    | "queued"
    | "running"
    | "approval_required"
    | "clarification_required"
    | "decision_needed"
    | "paused"
    | "cancelled"
    | "done"
    | "failed";
  isProcessing: boolean;
  canSubmit: boolean;
  canStop: boolean;
  canResume: boolean;
  gateKind?: "approval" | "clarification" | "plan_decision";
  authority:
    | "pending_run"
    | "active_snapshot"
    | "active_turn"
    | "session_detail"
    | "session_summary";
}

export interface DeriveRunInteractionStateParams {
  selectedSessionId?: string;
  sessionSummary?: OraSessionSummary;
  activeSessionDetail?: OraSessionDetail;
  /** @deprecated Use runLifecycle instead */
  activeSnapshot?: OraStateSnapshot;
  /** Snapshots keyed by runId — used for selected turn snapshot authority. */
  turnSnapshots?: Record<string, OraStateSnapshot>;
  selectedTurnRunId?: string;
  /** @deprecated Use runLifecycle instead */
  pendingRun?: PendingRunState;
  runLifecycle?: RunLifecycle;
}

const PROCESSING_STATUSES: ReadonlySet<string> = new Set([
  "queued",
  "running",
  "approval_required",
  "clarification_required",
  "decision_needed",
  "paused",
]);

const STOPPABLE_STATUSES: ReadonlySet<string> = new Set(["queued", "running"]);

const RESUMABLE_STATUSES: ReadonlySet<string> = new Set([
  "paused",
  "approval_required",
  "clarification_required",
  "decision_needed",
]);

function snapshotStatusToInteractionStatus(
  snapshotStatus: OraStateSnapshot["status"],
): DesktopRunInteractionState["status"] {
  switch (snapshotStatus) {
    case "queued":
      return "queued";
    case "running":
      return "running";
    case "interrupted":
      return "paused";
    case "cancelled":
      return "cancelled";
    case "succeeded":
      return "done";
    case "failed":
      return "failed";
  }
}

function attentionGateKind(
  attention: OraStateSnapshot["attention"],
): DesktopRunInteractionState["gateKind"] | undefined {
  if (!attention) return undefined;
  switch (attention.kind) {
    case "needs_approval":
      return "approval";
    case "needs_clarification":
      return "clarification";
    case "needs_plan_decision":
      return "plan_decision";
    default:
      return undefined;
  }
}

function attentionStatus(
  attention: OraStateSnapshot["attention"],
): DesktopRunInteractionState["status"] | undefined {
  if (!attention) return undefined;
  switch (attention.kind) {
    case "needs_approval":
      return "approval_required";
    case "needs_clarification":
      return "clarification_required";
    case "needs_plan_decision":
      return "decision_needed";
    case "paused":
      return "paused";
    case "running":
      return "running";
    case "cancelled":
      return "cancelled";
    case "failed":
      return "failed";
    case "idle":
      return "idle";
  }
}

function deriveFromPendingRun(
  pendingRun: PendingRunState,
): DesktopRunInteractionState {
  return {
    sourceRunId: pendingRun.runId,
    sourceSessionId: pendingRun.sessionId,
    status: "running",
    isProcessing: true,
    canSubmit: false,
    canStop: true,
    canResume: false,
    authority: "pending_run",
  };
}

function deriveFromSnapshot(
  snapshot: OraStateSnapshot,
): DesktopRunInteractionState {
  const attention = snapshot.attention;
  const gateKind = attentionGateKind(attention);
  const baseStatus = snapshotStatusToInteractionStatus(snapshot.status);
  const status = gateKind
    ? attentionStatus(attention) ?? baseStatus
    : baseStatus;

  return {
    sourceRunId: snapshot.runId,
    sourceSessionId: snapshot.sessionId,
    status,
    gateKind,
    isProcessing: PROCESSING_STATUSES.has(status),
    canSubmit: !PROCESSING_STATUSES.has(status),
    canStop: STOPPABLE_STATUSES.has(status),
    canResume: RESUMABLE_STATUSES.has(status),
    authority: "active_snapshot",
  };
}

function deriveFromTurn(
  turn: NonNullable<OraSessionDetail["turns"]>[number],
): DesktopRunInteractionState {
  const attention = turn.attention;
  const gateKind = attentionGateKind(attention);
  const baseStatus = snapshotStatusToInteractionStatus(turn.status);
  const status = gateKind
    ? attentionStatus(attention) ?? baseStatus
    : baseStatus;

  return {
    sourceRunId: turn.runId,
    sourceSessionId: turn.sessionId,
    status,
    gateKind,
    isProcessing: PROCESSING_STATUSES.has(status),
    canSubmit: !PROCESSING_STATUSES.has(status),
    canStop: STOPPABLE_STATUSES.has(status),
    canResume: RESUMABLE_STATUSES.has(status),
    authority: "active_turn",
  };
}

function deriveFromSession(
  session: { status?: string; attention?: { kind?: string } },
  sessionId: string,
  authority: DesktopRunInteractionState["authority"],
): DesktopRunInteractionState {
  let status: DesktopRunInteractionState["status"] = "idle";
  let gateKind: DesktopRunInteractionState["gateKind"] | undefined;

  if (session.status) {
    status = snapshotStatusToInteractionStatus(
      session.status as OraStateSnapshot["status"],
    );
  }

  if (session.attention?.kind) {
    const attnStatus = attentionStatus(
      session.attention as OraStateSnapshot["attention"],
    );
    if (attnStatus) {
      status = attnStatus;
    }
    gateKind = attentionGateKind(
      session.attention as OraStateSnapshot["attention"],
    );
  }

  return {
    sourceSessionId: sessionId,
    status,
    gateKind,
    isProcessing: PROCESSING_STATUSES.has(status),
    canSubmit: !PROCESSING_STATUSES.has(status),
    canStop: STOPPABLE_STATUSES.has(status),
    canResume: RESUMABLE_STATUSES.has(status),
    authority,
  };
}

function idleState(sessionId?: string): DesktopRunInteractionState {
  return {
    sourceSessionId: sessionId,
    status: "idle",
    isProcessing: false,
    canSubmit: true,
    canStop: false,
    canResume: false,
    authority: "session_summary",
  };
}

function snapshotBelongsToSession(
  snapshot: OraStateSnapshot,
  sessionId: string,
): boolean {
  if (snapshot.sessionId && snapshot.sessionId !== sessionId) return false;
  return true;
}

export function deriveRunInteractionState(
  params: DeriveRunInteractionStateParams,
): DesktopRunInteractionState {
  const {
    selectedSessionId,
    sessionSummary,
    activeSessionDetail,
    turnSnapshots,
    selectedTurnRunId,
    runLifecycle,
    pendingRun: legacyPendingRun,
    activeSnapshot: legacyActiveSnapshot,
  } = params;

  const sessionId = sessionSummary?.sessionId ?? selectedSessionId;

  // Priority 1: pending stage — runLifecycle first, fallback to legacy pendingRun
  const pendingRun = getPendingRunState(runLifecycle ?? { stage: "idle" }) ?? legacyPendingRun;
  if (pendingRun && sessionId && pendingRun.sessionId === sessionId) {
    return deriveFromPendingRun(pendingRun);
  }

  // Priority 2: active snapshot — runLifecycle first, fallback to legacy activeSnapshot
  const activeSnapshot = getActiveSnapshot(runLifecycle ?? { stage: "idle" }) ?? legacyActiveSnapshot;
  if (
    activeSnapshot &&
    sessionId &&
    snapshotBelongsToSession(activeSnapshot, sessionId)
  ) {
    return deriveFromSnapshot(activeSnapshot);
  }

  if (
    selectedTurnRunId &&
    turnSnapshots &&
    sessionId
  ) {
    const selectedTurnSnapshot = turnSnapshots[selectedTurnRunId];
    if (
      selectedTurnSnapshot &&
      snapshotBelongsToSession(selectedTurnSnapshot, sessionId)
    ) {
      return deriveFromSnapshot(selectedTurnSnapshot);
    }
  }

  // Priority 3: active session detail — selected turn first, then session.
  if (activeSessionDetail && sessionId) {
    const detailSessionId = activeSessionDetail.session.sessionId;
    const isActiveSession = detailSessionId === sessionId;

    if (isActiveSession) {
      // Try selected turn or latest turn.
      const turn = selectedTurnRunId
        ? activeSessionDetail.turns.find(
            (t) => t.runId === selectedTurnRunId,
          )
        : activeSessionDetail.turns.at(-1);

      if (turn) {
        return deriveFromTurn(turn);
      }

      // Fall through to session-level.
      return deriveFromSession(activeSessionDetail.session, detailSessionId, "session_detail");
    }
  }

  // Priority 4: session summary as last resort.
  if (sessionSummary) {
    return deriveFromSession(sessionSummary, sessionSummary.sessionId, "session_summary");
  }

  return idleState(sessionId);
}
