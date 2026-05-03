import { describe, expect, it } from "vitest";
import { parseProposedPlan } from "./proposedPlanParser";

const PLAN = [
  "<proposed_plan>",
  "计划标题",
  "## 背景",
  "简要上下文",
  "## 实施步骤",
  "1. 步骤一 - 涉及文件: src/a.ts - 预期变更: 添加验证",
  "2. 步骤二 - 涉及文件: src/b.ts - 预期变更: 添加测试",
  "## 假设与默认选择",
  "- 假设一",
  "## 验证方式",
  "- 运行 pnpm test",
  "</proposed_plan>",
].join("\n");

describe("parseProposedPlan", () => {
  it("detects a complete proposed plan from planner output", () => {
    const result = parseProposedPlan(PLAN);
    expect(result.hasCompletePlan).toBe(true);
    expect(result.planContent).toContain("计划标题");
    expect(result.planContent).toContain("## 实施步骤");
  });

  it("returns the display text outside the XML tags", () => {
    const result = parseProposedPlan(`一些前置说明\n${PLAN}`);
    expect(result.hasCompletePlan).toBe(true);
    expect(result.displayText).toBe("一些前置说明");
  });

  it("detects plan when another agent writes text after the XML block", () => {
    // Simulates: planner outputs plan, then verifier writes "Looks good"
    const result = parseProposedPlan(`${PLAN}\n验证完成，方案可行。`);
    expect(result.hasCompletePlan).toBe(true);
    expect(result.planContent).toContain("计划标题");
    expect(result.planContent).not.toContain("验证完成");
  });

  it("detects plan when another agent writes text before the XML block", () => {
    const result = parseProposedPlan(`前置分析完成。\n${PLAN}`);
    expect(result.hasCompletePlan).toBe(true);
    expect(result.displayText).toContain("前置分析完成");
  });

  it("returns false for text without proposed_plan tags", () => {
    const result = parseProposedPlan("只是一段普通文本，没有计划标签。");
    expect(result.hasCompletePlan).toBe(false);
  });

  it("returns false when the plan content is too short", () => {
    const result = parseProposedPlan(`<proposed_plan>\n  \n</proposed_plan>`);
    expect(result.hasCompletePlan).toBe(false);
  });

  it("returns false when the closing tag is missing (streaming in progress)", () => {
    const result = parseProposedPlan("<proposed_plan>\n## 未完成的计划\n内容...");
    expect(result.hasCompletePlan).toBe(false);
  });
});
