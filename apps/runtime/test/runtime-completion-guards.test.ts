import { describe, expect, it } from "vitest";
import {
  evaluateRuntimeCompletionGuards,
  finalOutputGuard,
  legacyProgressCompletionGuard,
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

  it("allows terminal approved replay tools to finalize blocked legacy progress", () => {
    const result = legacyProgressCompletionGuard({
      actions: [{
        id: "run-1:action-write",
        runId: "run-1",
        type: "file.write",
        riskLevel: "high",
        status: "succeeded",
        input: {},
        artifactIds: [],
      }],
      planList: [],
      plan: [{
        id: "run-1:respond",
        runId: "run-1",
        title: "Respond",
        status: "blocked",
        dependencies: [],
        actionIds: [],
        linkedActionIds: [],
        checkpointIds: [],
      }],
      todos: [{
        id: "run-1:respond",
        runId: "run-1",
        sourcePlanItemId: "run-1:respond",
        label: "Respond",
        status: "blocked",
        createdAt: 1,
        updatedAt: 1,
      }],
      toolCalls: [],
    });

    expect(result).toEqual({ allowComplete: true });
  });

  it("blocks finalization after non-terminal approved replay tools while legacy progress is blocked", () => {
    const result = legacyProgressCompletionGuard({
      actions: [{
        id: "run-1:action-shell",
        runId: "run-1",
        type: "shell.execute",
        riskLevel: "high",
        status: "succeeded",
        input: {},
        artifactIds: [],
      }],
      planList: [],
      replayedActionIds: ["run-1:action-shell"],
      plan: [{
        id: "run-1:verify",
        runId: "run-1",
        title: "Verify command result",
        status: "blocked",
        dependencies: [],
        actionIds: [],
        linkedActionIds: [],
        checkpointIds: [],
      }],
      todos: [{
        id: "run-1:verify",
        runId: "run-1",
        sourcePlanItemId: "run-1:verify",
        label: "Verify command result",
        status: "blocked",
        createdAt: 1,
        updatedAt: 1,
      }],
      toolCalls: [],
    });

    expect(result).toMatchObject({
      allowComplete: false,
      reason: "legacy_progress_incomplete",
    });
    expect(result.allowComplete).toBe(false);
    if (!result.allowComplete) {
      expect(result.followUpContent).toContain("do not provide a final answer");
      expect(result.detail).toContain("Verify command result");
    }
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

// ---------------------------------------------------------------------------
// finalOutputGuard — structural final-output completeness check
// ---------------------------------------------------------------------------
describe("finalOutputGuard", () => {
  it("allows complete when response text is non-empty", () => {
    expect(finalOutputGuard("Here is the final answer.")).toEqual({
      allowComplete: true,
    });
  });

  it("allows complete with minimal non-whitespace text", () => {
    expect(finalOutputGuard("OK")).toEqual({ allowComplete: true });
  });

  it("blocks complete when response text is empty", () => {
    const result = finalOutputGuard("");
    expect(result.allowComplete).toBe(false);
    if (!result.allowComplete) {
      expect(result.reason).toBe("final_output_empty");
      expect(result.detail).toBe("The latest model response has no user-visible text.");
      expect(result.followUpContent).toBe(
        "The latest model response is empty. Produce the final user-facing answer now using the available conversation and tool results.",
      );
    }
  });

  it("blocks complete when response text is whitespace only", () => {
    const result = finalOutputGuard("   \n\t  ");
    expect(result.allowComplete).toBe(false);
    if (!result.allowComplete) {
      expect(result.reason).toBe("final_output_empty");
    }
  });

  it("uses post-tool repair prompt when isPostTool is true", () => {
    const result = finalOutputGuard("", { isPostTool: true });
    expect(result.allowComplete).toBe(false);
    if (!result.allowComplete) {
      expect(result.followUpReason).toBe("final_output_empty_post_tool_repair");
      expect(result.followUpContent).toBe(
        "Your previous response after the tool result was empty. Produce the final user-facing answer now using the available conversation and tool results. Do not call tools.",
      );
    }
  });

  it("uses generic follow-up prompt when isPostTool is false", () => {
    const result = finalOutputGuard("", { isPostTool: false });
    expect(result.allowComplete).toBe(false);
    if (!result.allowComplete) {
      expect(result.followUpReason).toBe("final_output_empty_follow_up");
      expect(result.followUpContent).toBe(
        "The latest model response is empty. Produce the final user-facing answer now using the available conversation and tool results.",
      );
    }
  });

  it("does not inspect language-specific unfinished phrases", () => {
    // The guard is purely structural: it only checks text length, not content.
    // Even Chinese "unfinished" phrases like 以下是完整计划 should pass
    // because they are non-empty text.
    expect(finalOutputGuard("以下是完整计划。")).toEqual({
      allowComplete: true,
    });
    expect(finalOutputGuard("Here is the complete plan.")).toEqual({
      allowComplete: true,
    });
  });
});
