import type { RunContinuationFrame, StateSnapshot } from "@cemeworm/shared";

export type ContinuationDispatchDecision =
  | {
      kind: "resume_suspended_node";
      frame: RunContinuationFrame;
      agentId: string;
      nodeId: string;
      reason: RunContinuationFrame["reason"];
    }
  | {
      kind: "resume_whole_mode";
      reason: "no_active_frame" | "unsupported_frame_reason" | "frame_not_paused";
      frame?: RunContinuationFrame;
      /** Human-readable summary of what frame context was discarded. */
      fallbackReason: string;
    }
  | {
      kind: "diagnostic_failure";
      reason: "missing_owner_metadata";
      frame: RunContinuationFrame;
      message: string;
    };

/**
 * Reasons for which a continuation frame is considered "owner-backed"
 * (i.e. the frame's agentId/nodeId identify where to resume).
 * Frames with reasons outside this set fall back to whole-mode resume.
 * Exported for mode authors who define custom frame reasons.
 */
export const OWNER_BACKED_REASONS = new Set<RunContinuationFrame["reason"]>([
  "approval_required",
  "clarification_required",
  "manual_interrupt",
  "tool_interrupted",
]);

export function classifyContinuationDispatch(
  snapshot: Pick<StateSnapshot, "continuation">,
): ContinuationDispatchDecision {
  const activeFrameId = snapshot.continuation.activeFrameId;
  const frame = snapshot.continuation.frames.find((item) => item.id === activeFrameId);
  if (!frame) {
    return { kind: "resume_whole_mode", reason: "no_active_frame", fallbackReason: "No active continuation frame found in snapshot" };
  }
  if (frame.status !== "paused" && frame.status !== "awaiting_model") {
    return { kind: "resume_whole_mode", reason: "frame_not_paused", frame, fallbackReason: `Frame ${frame.id} has status "${frame.status}" (expected paused or awaiting_model)` };
  }
  if (!OWNER_BACKED_REASONS.has(frame.reason)) {
    return { kind: "resume_whole_mode", reason: "unsupported_frame_reason", frame, fallbackReason: `Frame ${frame.id} has unsupported reason "${frame.reason}". Discarded owner: agentId=${frame.agentId ?? "none"}, nodeId=${frame.nodeId ?? "none"}, bag keys: ${Object.keys(frame.nodeCheckpoint?.bag ?? {}).join(",") || "none"}` };
  }
  const agentId = frame.agentId ?? frame.nodeCheckpoint?.agentId;
  const nodeId = frame.nodeId ?? frame.nodeCheckpoint?.nodeId ?? frame.planItemId ?? frame.nodeCheckpoint?.planItemId;
  if (!agentId) {
    if (frame.reason === "approval_required" || frame.reason === "clarification_required") {
      return { kind: "resume_whole_mode", reason: "unsupported_frame_reason", frame, fallbackReason: `Legacy frame ${frame.id} (reason: ${frame.reason}) missing agentId — cannot resume suspended node, falling back to whole-mode` };
    }
    return {
      kind: "diagnostic_failure",
      reason: "missing_owner_metadata",
      frame,
      message: `Continuation frame ${frame.id} cannot resume a suspended node without agentId.`,
    };
  }
  return {
    kind: "resume_suspended_node",
    frame,
    agentId,
    nodeId: nodeId ?? agentId,
    reason: frame.reason,
  };
}

export function continuationFrameAwaitingModel(
  snapshot: StateSnapshot,
  frameId: string,
  updatedAt: number,
): StateSnapshot {
  return {
    ...snapshot,
    continuation: {
      activeFrameId: frameId,
      frames: snapshot.continuation.frames.map((frame) =>
        frame.id === frameId
          ? {
              ...frame,
              status: "awaiting_model" as const,
              updatedAt,
            }
          : frame
      ),
    },
  };
}
