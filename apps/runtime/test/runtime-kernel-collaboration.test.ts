import { describe, expect, it } from "vitest";
import { deriveParentCoordinationUpdate } from "../src/harness/runtime-kernel.js";

describe("runtime kernel collaboration coordination", () => {
  it("treats independent background children as parallel_independent_work", () => {
    expect(deriveParentCoordinationUpdate({
      children: [
        { id: "run-1:child-1", agentId: "child-1", status: "running" },
      ],
      barrierByAgentId: new Map([["child-1", "independent" as const]]),
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
        { id: "run-1:child-1", agentId: "child-1", status: "running" },
      ],
      barrierByAgentId: new Map([["child-1", "required" as const]]),
      lastChildStatus: "running",
    })).toMatchObject({
      phase: "waiting_on_required_children",
      activeChildIds: ["run-1:child-1"],
      waitingChildIds: ["run-1:child-1"],
    });
  });

  it("returns resuming_with_child_summaries once no child remains active", () => {
    expect(deriveParentCoordinationUpdate({
      children: [
        { id: "run-1:child-1", agentId: "child-1", status: "succeeded" },
      ],
      barrierByAgentId: new Map([["child-1", "independent" as const]]),
      lastChildStatus: "succeeded",
    })).toMatchObject({
      phase: "resuming_with_child_summaries",
      activeChildIds: [],
      waitingChildIds: [],
    });
  });
});
