import { describe, expect, it } from "vitest";
import {
  evaluateRuntimeCompletionGuards,
  pendingRuntimeWorkGuard,
  planListCompletionGuard,
} from "../src/harness/runtime-completion-guards.js";

describe("runtime completion guards", () => {
  it("allows natural completion when no plan list exists", () => {
    expect(planListCompletionGuard({ actions: [], planList: [], toolCalls: [] })).toEqual({
      allowComplete: true,
    });
  });

  it("allows natural completion when all plan list steps are completed", () => {
    expect(planListCompletionGuard({
      actions: [],
      planList: [
        { step: "Inspect current behavior", status: "completed" },
        { step: "Verify regression", status: "completed" },
      ],
      toolCalls: [],
    })).toEqual({ allowComplete: true });
  });

  it("blocks natural completion when plan list has unfinished steps", () => {
    const result = planListCompletionGuard({
      actions: [],
      planList: [
        { step: "Inspect current behavior", status: "completed" },
        { step: "Implement guard", status: "in_progress" },
        { step: "Verify regression", status: "pending" },
      ],
      toolCalls: [],
    });

    expect(result).toMatchObject({
      allowComplete: false,
      reason: "plan_list_incomplete",
      progressTrigger: "plan_list.incomplete",
      followUpReason: "plan_list_incomplete_follow_up",
    });
    expect(result.allowComplete).toBe(false);
    if (!result.allowComplete) {
      expect(result.detail).toContain("[in_progress] Implement guard");
      expect(result.detail).toContain("[pending] Verify regression");
      expect(result.detail).not.toContain("Inspect current behavior");
      expect(result.followUpContent).toContain("do not provide a final answer");
    }
  });

  it("returns the first blocking guard result from the evaluator", () => {
    const result = evaluateRuntimeCompletionGuards({
      actions: [],
      planList: [{ step: "Implement guard", status: "pending" }],
      toolCalls: [],
    });

    expect(result).toMatchObject({
      allowComplete: false,
      reason: "plan_list_incomplete",
    });
  });

  it("blocks natural completion when actions are still pending", () => {
    const result = pendingRuntimeWorkGuard({
      actions: [{
        id: "run-1:action:tool-1",
        runId: "run-1",
        type: "shell.execute",
        riskLevel: "medium",
        status: "running",
        input: {},
        artifactIds: [],
      }],
      planList: [],
      toolCalls: [],
    });

    expect(result).toMatchObject({
      allowComplete: false,
      reason: "pending_runtime_work",
      progressTrigger: "runtime_work.pending",
    });
    expect(result.allowComplete).toBe(false);
    if (!result.allowComplete) {
      expect(result.detail).toContain("[running] shell.execute");
      expect(result.followUpContent).toContain("unresolved work");
    }
  });

  it("allows the current agent invocation action to complete naturally", () => {
    const result = pendingRuntimeWorkGuard({
      actions: [{
        id: "run-1:action:solo-agent",
        runId: "run-1",
        type: "agent.solo_agent.invoke",
        riskLevel: "low",
        status: "running",
        input: {},
        artifactIds: [],
      }],
      planList: [],
      toolCalls: [],
    });

    expect(result).toEqual({ allowComplete: true });
  });

  it("blocks natural completion when tool calls are still pending", () => {
    const result = pendingRuntimeWorkGuard({
      actions: [],
      planList: [],
      toolCalls: [{
        id: "run-1:tool-call-1",
        runId: "run-1",
        toolId: "file.read",
        args: {},
        source: "json_fallback",
        status: "proposed",
        requestedAt: 1,
        updatedAt: 1,
      }],
    });

    expect(result).toMatchObject({
      allowComplete: false,
      reason: "pending_runtime_work",
    });
    expect(result.allowComplete).toBe(false);
    if (!result.allowComplete) {
      expect(result.detail).toContain("[proposed] file.read");
    }
  });
});
