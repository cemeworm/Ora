import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  FLOATING_OVERLAY_PANEL_CLASS,
  nextPlanTrayOpenState,
  PLAN_STEP_TEXT_CLASS,
  PLAN_STEPS_TRAY_HEADER_CHEVRON_CLASS,
  PLAN_STEPS_TRAY_HEADER_SUMMARY_CLASS,
  PLAN_STEPS_TRAY_HEADER_TITLE_ROW_CLASS,
  PlanStepsList,
  PlanStepsTray,
  planStepsTrayRootClassName,
} from "./PlanStepsTray";
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
    expect(planStepsTrayRootClassName("floating")).toBe(FLOATING_OVERLAY_PANEL_CLASS);
    expect(planStepsTrayRootClassName("floating")).toContain("rounded-3xl");
    expect(planStepsTrayRootClassName("floating")).toContain("border-border/65");
    expect(planStepsTrayRootClassName("floating")).toContain("bg-background/94");
    expect(planStepsTrayRootClassName("floating")).toContain("shadow-[0_1px_2px_rgba(23,23,23,0.03),0_8px_20px_rgba(23,23,23,0.04)]");
    expect(planStepsTrayRootClassName("inline")).toContain("mb-2");
    expect(FLOATING_OVERLAY_PANEL_CLASS).toContain("p-2.5");
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

  it("keeps the header summary constrained to a single truncated line", () => {
    const html = renderToStaticMarkup(
      createElement(PlanStepsTray, {
        variant: "floating",
        planSteps: [
          {
            step: "更新 AI Agent 主题页：添加 source 引用和最新进展，确保超长摘要不会把头部撑成两行",
            status: "in_progress",
          },
          {
            step: "补充 ingest log 记录",
            status: "pending",
          },
        ],
      }),
    );

    expect(html).toContain(PLAN_STEPS_TRAY_HEADER_TITLE_ROW_CLASS);
    expect(html).toContain(PLAN_STEPS_TRAY_HEADER_SUMMARY_CLASS);
    expect(html).toContain(PLAN_STEPS_TRAY_HEADER_CHEVRON_CLASS);
    expect(html).toContain("whitespace-nowrap");
    expect(html).toContain("truncate");
    expect(html).toContain("gap-2");
  });

  it("wraps long step tokens safely in both inline and floating variants", () => {
    const planSteps = [
      {
        step: "Step 1: 从 STABLE_PROMPT_PREFIX_SECTION_IDS 移除 available_skills",
        status: "in_progress" as const,
      },
      {
        step: "Step 2: 扩展 task_intent_context 并同步 RUNTIME_CONTEXT_BLOCK_SECTION_IDS",
        status: "pending" as const,
      },
    ];

    const floatingHtml = renderToStaticMarkup(
      createElement(PlanStepsTray, {
        variant: "floating",
        planSteps,
      }),
    );
    const inlineHtml = renderToStaticMarkup(
      createElement(PlanStepsTray, {
        variant: "inline",
        planSteps,
      }),
    );

    expect(floatingHtml).toContain(PLAN_STEP_TEXT_CLASS);
    expect(inlineHtml).toContain(PLAN_STEP_TEXT_CLASS);
    expect(floatingHtml).toContain("[overflow-wrap:anywhere]");
    expect(inlineHtml).toContain("break-words");
  });

  it("renders the extracted list primitive without any floating shell wrapper", () => {
    const html = renderToStaticMarkup(
      createElement(PlanStepsList, {
        planSteps: plan("in_progress", "pending"),
      }),
    );

    expect(html).toContain(PLAN_STEP_TEXT_CLASS);
    expect(html).not.toContain("rounded-3xl");
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
