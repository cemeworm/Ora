import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PLAN_STEP_TEXT_CLASS } from "./PlanStepsTray";
import { PlanCard } from "./PlanCard";

describe("plan card", () => {
  it("reuses the shared plan step wrapping classes for long tokens", () => {
    const html = renderToStaticMarkup(
      createElement(PlanCard, {
        planSteps: [
          {
            step: "Step 1: 从 STABLE_PROMPT_PREFIX_SECTION_IDS 移除 available_skills",
            status: "in_progress",
          },
          {
            step: "Step 2: 扩展 task_intent_context 并同步 RUNTIME_CONTEXT_BLOCK_SECTION_IDS",
            status: "pending",
          },
        ],
      }),
    );

    expect(html).toContain(PLAN_STEP_TEXT_CLASS);
    expect(html).toContain("[overflow-wrap:anywhere]");
    expect(html).toContain("break-words");
  });
});
