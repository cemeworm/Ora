import { describe, expect, it } from "vitest";
import { inspectProposedPlanContract } from "../src/proposedPlanContract.js";

const PLAN = [
  "<proposed_plan>",
  "## 计划标题",
  "## 背景",
  "补充上下文说明",
  "## 实施步骤",
  "1. 调整 shared helper。",
  "2. 补 runtime/desktop 回归。",
  "## 验证方式",
  "- 运行测试",
  "</proposed_plan>",
].join("\n");

describe("inspectProposedPlanContract", () => {
  it("accepts a single complete plan block", () => {
    const result = inspectProposedPlanContract(`前置说明\n${PLAN}\n结尾说明`);
    expect(result.status).toBe("complete_single");
    expect(result.hasCompletePlan).toBe(true);
    expect(result.completePlanCount).toBe(1);
    expect(result.completePlanContent).toContain("## 实施步骤");
    expect(result.displayText).toContain("前置说明");
    expect(result.displayText).toContain("结尾说明");
  });

  it("rejects multiple complete plan blocks", () => {
    const result = inspectProposedPlanContract(`${PLAN}\n---\n${PLAN}`);
    expect(result.status).toBe("invalid_multiple");
    expect(result.hasCompletePlan).toBe(false);
    expect(result.completePlanCount).toBe(2);
    expect(result.displayText).not.toContain("<proposed_plan>");
  });

  it("treats a too-short complete block as malformed", () => {
    const result = inspectProposedPlanContract("<proposed_plan>\n短\n</proposed_plan>");
    expect(result.status).toBe("invalid_malformed");
    expect(result.hasCompletePlan).toBe(false);
  });

  it("treats a stray closing tag as malformed instead of no-plan text", () => {
    const result = inspectProposedPlanContract("前置说明\n</proposed_plan>\n结尾说明");
    expect(result.status).toBe("invalid_malformed");
    expect(result.hasStartedPlan).toBe(false);
    expect(result.hasCompletePlan).toBe(false);
    expect(result.displayText).toBe("前置说明\n\n结尾说明");
  });
});
