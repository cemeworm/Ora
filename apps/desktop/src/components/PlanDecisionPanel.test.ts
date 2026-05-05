import { describe, expect, it } from "vitest";
import { nextPlanDecisionOption } from "./PlanDecisionPanel";

describe("plan decision panel keyboard selection", () => {
  it("moves the active option with arrow keys", () => {
    expect(nextPlanDecisionOption("confirm", "ArrowDown")).toBe("decline");
    expect(nextPlanDecisionOption("decline", "ArrowDown")).toBe("confirm");
    expect(nextPlanDecisionOption("confirm", "ArrowUp")).toBe("decline");
    expect(nextPlanDecisionOption("decline", "ArrowUp")).toBe("confirm");
  });
});
