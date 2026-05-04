import { describe, expect, it } from "vitest";
import { statusFromSession } from "./Sidebar";

describe("sidebar session status", () => {
  it("prioritizes clarification and approval over plan decisions", () => {
    expect(statusFromSession("running", true, true)).toBe("clarification_required");
    expect(statusFromSession("interrupted", false, true)).toBe("approval_required");
    expect(statusFromSession("done", false, true)).toBe("decision_needed");
  });

  it("uses durable runtime attention before legacy status fallbacks", () => {
    expect(statusFromSession("succeeded", false, false, {
      kind: "needs_plan_decision",
      blocking: true,
      sourceRunId: "run-plan",
      reason: "plan_decision_required",
      planDecisionId: "run-plan:plan-decision",
      pendingActionIds: [],
      pendingToolCallIds: [],
      pendingClarificationIds: [],
    })).toBe("decision_needed");
    expect(statusFromSession("interrupted", false, false, {
      kind: "paused",
      blocking: false,
      sourceRunId: "run-paused",
      pendingActionIds: [],
      pendingToolCallIds: [],
      pendingClarificationIds: [],
    })).toBe("paused");
  });
});
