import { describe, expect, it } from "vitest";
import { nextPlanDecisionOption, planDecisionOptionLabel } from "./PlanDecisionPanel";

describe("plan decision panel keyboard selection", () => {
  it("moves the active option with arrow keys", () => {
    expect(nextPlanDecisionOption("confirm", "ArrowDown")).toBe("decline");
    expect(nextPlanDecisionOption("decline", "ArrowDown")).toBe("confirm");
    expect(nextPlanDecisionOption("confirm", "ArrowUp")).toBe("decline");
    expect(nextPlanDecisionOption("decline", "ArrowUp")).toBe("confirm");
  });
});

describe("plan decision panel pending labels", () => {
  it("shows the clicked action as processing", () => {
    expect(planDecisionOptionLabel("confirm", "confirm")).toBe("正在开始实施...");
    expect(planDecisionOptionLabel("decline", "decline")).toBe("正在提交调整...");
    expect(planDecisionOptionLabel("confirm", "decline")).toBe("是，按该计划实施");
  });
});
