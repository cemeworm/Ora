import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { nextPlanTrayOpenState, PlanStepsTray, planStepsTrayRootClassName } from "./PlanStepsTray";
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

  it("uses a distinct floating shell class for the right overlay variant", () => {
    expect(planStepsTrayRootClassName("floating")).toContain("rounded-3xl");
    expect(planStepsTrayRootClassName("floating")).toContain("shadow-lift");
    expect(planStepsTrayRootClassName("inline")).toContain("mb-2");
  });

  it("renders the floating variant without the inline bottom margin shell", () => {
    const html = renderToStaticMarkup(
      createElement(PlanStepsTray, {
        variant: "floating",
        planSteps: plan("in_progress", "pending"),
      }),
    );

    expect(html).toContain("rounded-3xl");
    expect(html).not.toContain("mb-2");
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
