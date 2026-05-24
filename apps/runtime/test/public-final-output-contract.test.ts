import { describe, expect, it } from "vitest";
import { SINGLE_AGENT_MODE_ID, getModePreset } from "@cemeworm/shared";
import {
  finalOutputContractViolation,
  incompleteForcedFinalError,
} from "../src/harness/runtime-output.js";

function completionMetadata() {
  return {
    stopReason: "completed" as const,
    forcedFinal: false,
    toolAttempts: 1,
    maxToolCalls: 4,
    completionPolicy: getModePreset(SINGLE_AGENT_MODE_ID)!.completionPolicy,
  };
}

describe("public final output contract", () => {
  it("rejects final output that mixes user-facing prose with DSML tool protocol text", () => {
    const output = {
      text: [
        "已经定位到问题根因，接下来给你整理修复方案。",
        "",
        "<｜｜DSML｜｜tool_calls>",
        '<｜｜DSML｜｜invoke name="file__read">',
        '<｜｜DSML｜｜parameter name="path" string="true">apps/desktop/src/lib/viewModel.ts</｜｜DSML｜｜parameter>',
        "</｜｜DSML｜｜invoke>",
        "</｜｜DSML｜｜tool_calls>",
      ].join("\n"),
    };

    expect(finalOutputContractViolation(output)).toEqual({
      reason: "internal_protocol",
      visibleText: "已经定位到问题根因，接下来给你整理修复方案。",
    });
  });

  it("fails forced completion checks for mixed public and internal terminal text", () => {
    const output = {
      text: [
        "这是可见答复前缀。",
        "",
        "<｜｜DSML｜｜tool_calls>",
        '<｜｜DSML｜｜invoke name="file__read">',
        "</｜｜DSML｜｜invoke>",
        "</｜｜DSML｜｜tool_calls>",
      ].join("\n"),
    };

    expect(incompleteForcedFinalError(output, completionMetadata())).toBe(
      "Run cannot complete: final output contains internal protocol text.",
    );
  });

  it("accepts ordinary user-facing final text", () => {
    expect(finalOutputContractViolation({
      text: "已经完成修复，并补充了针对终态输出污染的回归测试。",
    })).toBeUndefined();
  });

  it("rejects final output with multiple complete proposed_plan blocks", () => {
    const plan = [
      "<proposed_plan>",
      "## 计划",
      "## 背景",
      "说明上下文",
      "## 实施步骤",
      "1. 第一步。",
      "2. 第二步。",
      "## 验证方式",
      "- 运行测试",
      "</proposed_plan>",
    ].join("\n");

    expect(finalOutputContractViolation({
      text: `前置说明\n${plan}\n---\n${plan}\n结尾说明`,
    })).toEqual({
      reason: "invalid_multiple_proposed_plans",
      visibleText: "前置说明\n\n---\n\n结尾说明",
    });
  });

  it("rejects final output with a stray proposed_plan closing tag", () => {
    expect(finalOutputContractViolation({
      text: "前置说明\n</proposed_plan>\n结尾说明",
    })).toEqual({
      reason: "invalid_malformed_proposed_plan",
      visibleText: "前置说明\n\n结尾说明",
    });
  });

  it("accepts a short recoverable single proposed_plan block", () => {
    expect(finalOutputContractViolation({
      text: "<proposed_plan>\n短\n</proposed_plan>",
    })).toBeUndefined();
  });
});
