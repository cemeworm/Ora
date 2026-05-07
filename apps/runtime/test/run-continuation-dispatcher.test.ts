import { describe, expect, it } from "vitest";
import type { StateSnapshot } from "@cemeworm/shared";
import { StateSnapshotSchema } from "@cemeworm/shared";
import { classifyContinuationDispatch } from "../src/run-continuation-dispatcher.js";

describe("runtime continuation dispatcher", () => {
  it("routes owner-backed paused frames to suspended node resume", () => {
    const snapshot = continuationSnapshot({
      status: "paused",
      reason: "manual_interrupt",
      agentId: "builder",
      nodeId: "builder-node",
    });

    expect(classifyContinuationDispatch(snapshot)).toMatchObject({
      kind: "resume_suspended_node",
      agentId: "builder",
      nodeId: "builder-node",
      reason: "manual_interrupt",
    });
  });

  it("uses node checkpoint owner metadata when frame fields are missing", () => {
    const snapshot = continuationSnapshot({
      status: "paused",
      reason: "tool_interrupted",
      nodeCheckpoint: {
        agentId: "reviewer",
        nodeId: "review-node",
        eventSeq: 3,
        conversationCursor: 2,
        bag: { reviewer: "partial output" },
      },
    });

    expect(classifyContinuationDispatch(snapshot)).toMatchObject({
      kind: "resume_suspended_node",
      agentId: "reviewer",
      nodeId: "review-node",
    });
  });

  it("fails diagnostically when a resumable frame lacks owner metadata", () => {
    const snapshot = continuationSnapshot({
      status: "paused",
      reason: "manual_interrupt",
    });

    expect(classifyContinuationDispatch(snapshot)).toMatchObject({
      kind: "diagnostic_failure",
      reason: "missing_owner_metadata",
    });
  });

  it("leaves unsupported active frames to whole-mode resume", () => {
    const snapshot = continuationSnapshot({
      status: "paused",
      reason: "provider_failed",
      agentId: "builder",
    });

    expect(classifyContinuationDispatch(snapshot)).toMatchObject({
      kind: "resume_whole_mode",
      reason: "unsupported_frame_reason",
    });
  });
});

function continuationSnapshot(
  frame: Partial<StateSnapshot["continuation"]["frames"][number]> &
    Pick<StateSnapshot["continuation"]["frames"][number], "status" | "reason">,
): StateSnapshot {
  return StateSnapshotSchema.parse({
    runId: "run-dispatch",
    sessionId: "session-dispatch",
    status: "interrupted",
    pattern: "orchestrator_subagent",
    modeId: "single_agent",
    input: { prompt: "Resume.", createdAt: 1, context: {} },
    config: { pattern: "orchestrator_subagent", modeId: "single_agent" },
    topology: { nodes: [], edges: [] },
    profiles: [],
    memory: [],
    plan: [],
    actions: [],
    checkpoints: [],
    events: [],
    continuation: {
      activeFrameId: "run-dispatch:continuation:0",
      frames: [{
        id: "run-dispatch:continuation:0",
        runId: "run-dispatch",
        conversationCursor: 0,
        pendingActionIds: [],
        pendingToolCallIds: [],
        pendingClarificationIds: [],
        approvedActionIds: [],
        resolvedClarificationIds: [],
        createdAt: 1,
        updatedAt: 1,
        ...frame,
      }],
    },
    updatedAt: 1,
  });
}
