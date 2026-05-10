import { describe, expect, it } from "vitest";
import { nextPlanTrayOpenState } from "./PlanStepsTray";
import type { TurnPlanListStep } from "../types";

describe("plan steps tray open state", () => {
  it("opens when a new plan appears", () => {
    expect(nextPlanTrayOpenState({
      currentOpen: false,
      planSteps: plan("in_progress", "pending"),
      previousPlanIdentity: "",
      nextPlanIdentity: "搜索\n整理",
      previousAllCompleted: false,
    })).toBe(true);
  });

  it("preserves the user's collapsed state while the same active plan updates", () => {
    expect(nextPlanTrayOpenState({
      currentOpen: false,
      planSteps: plan("completed", "in_progress"),
      previousPlanIdentity: "搜索\n整理",
      nextPlanIdentity: "搜索\n整理",
      previousAllCompleted: false,
    })).toBe(false);
  });

  it("collapses once when the active plan first completes", () => {
    expect(nextPlanTrayOpenState({
      currentOpen: true,
      planSteps: plan("completed", "completed"),
      previousPlanIdentity: "搜索\n整理",
      nextPlanIdentity: "搜索\n整理",
      previousAllCompleted: false,
    })).toBe(false);
  });

  it("preserves the user's expanded state after completion has already been observed", () => {
    expect(nextPlanTrayOpenState({
      currentOpen: true,
      planSteps: plan("completed", "completed"),
      previousPlanIdentity: "搜索\n整理",
      nextPlanIdentity: "搜索\n整理",
      previousAllCompleted: true,
    })).toBe(true);
  });
});

function plan(
  firstStatus: TurnPlanListStep["status"],
  secondStatus: TurnPlanListStep["status"],
): TurnPlanListStep[] {
  return [
    { step: "搜索", status: firstStatus },
    { step: "整理", status: secondStatus },
  ];
}
