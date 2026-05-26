import { describe, expect, it } from "vitest";
import { deriveParentCoordinationUpdate } from "../src/harness/runtime-kernel.js";

describe("runtime kernel collaboration coordination", () => {
  it("treats independent background children as parallel_independent_work", () => {
    expect(deriveParentCoordinationUpdate({
      children: [
        { id: "run-1:child-1", agentId: "child-1", status: "running", lifecyclePhase: "running", coordinationBarrier: "independent" },
      ],
      lastChildStatus: "running",
    })).toMatchObject({
      phase: "parallel_independent_work",
      activeChildIds: ["run-1:child-1"],
      waitingChildIds: [],
    });
  });

  it("keeps required children on waiting_on_required_children", () => {
    expect(deriveParentCoordinationUpdate({
      children: [
        { id: "run-1:child-1", agentId: "child-1", status: "running", lifecyclePhase: "running", coordinationBarrier: "required" },
      ],
      lastChildStatus: "running",
    })).toMatchObject({
      phase: "waiting_on_required_children",
      activeChildIds: ["run-1:child-1"],
      waitingChildIds: ["run-1:child-1"],
      blockedByChildIds: ["run-1:child-1"],
    });
  });

  it("returns resuming_with_child_summaries once no child remains active", () => {
    expect(deriveParentCoordinationUpdate({
      children: [
        { id: "run-1:child-1", agentId: "child-1", status: "succeeded", lifecyclePhase: "awaiting_pickup", resultAvailability: "queued_for_parent", coordinationBarrier: "independent" },
      ],
      lastChildStatus: "succeeded",
    })).toMatchObject({
      phase: "resuming_with_child_summaries",
      activeChildIds: [],
      waitingChildIds: [],
      partialResultChildIds: ["run-1:child-1"],
    });
  });

  it("surfaces stalled required children as blocked and recoverable", () => {
    expect(deriveParentCoordinationUpdate({
      children: [
        {
          id: "run-1:child-1",
          agentId: "child-1",
          status: "running",
          lifecyclePhase: "stalled",
          resultAvailability: "partial",
          stallReason: "no_progress_timeout",
          coordinationBarrier: "required",
        },
      ],
      lastChildStatus: "running",
    })).toMatchObject({
      phase: "waiting_on_required_children",
      activeChildIds: [],
      blockedByChildIds: ["run-1:child-1"],
      stalledChildIds: ["run-1:child-1"],
      recoverableChildIds: ["run-1:child-1"],
      partialResultChildIds: ["run-1:child-1"],
    });
  });

  it("does not keep decisioned stalled partial children in the recoverable blocking set", () => {
    expect(deriveParentCoordinationUpdate({
      children: [
        {
          id: "run-1:child-1",
          agentId: "child-1",
          status: "running",
          lifecyclePhase: "stalled",
          resultAvailability: "partial",
          resolutionStatus: "accepted_partial",
          stallReason: "recovery_detected",
          coordinationBarrier: "required",
        },
      ],
      lastChildStatus: "running",
    })).toMatchObject({
      activeChildIds: [],
      blockedByChildIds: [],
      stalledChildIds: [],
      recoverableChildIds: [],
      partialResultChildIds: ["run-1:child-1"],
    });
  });
});
