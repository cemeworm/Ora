import { describe, expect, it } from "vitest";
import {
  evaluateRuntimeCompletionGuards,
  finalOutputGuard,
  legacyProgressCompletionGuard,
  pendingBackgroundWorkGuard,
  pendingRuntimeWorkGuard,
  planListCompletionGuard,
  requiredCollaborationGuard,
  stalledBackgroundWorkGuard,
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

  it("ignores pending non-agent actions owned by a different child agent", () => {
    const result = pendingRuntimeWorkGuard({
      actions: [{
        id: "run-1:action:other-child-tool",
        runId: "run-1",
        type: "shell.execute",
        riskLevel: "medium",
        status: "running",
        input: {},
        artifactIds: [],
        agentId: "ora-sub-2",
      }],
      agentId: "ora-sub-1",
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

  it("blocks completion while background children are still active", () => {
    const result = pendingBackgroundWorkGuard({
      actions: [],
      planList: [],
      toolCalls: [],
      agentId: "ora",
      activeBackgroundChildCount: 1,
      pendingAsyncResultCount: 0,
    });

    expect(result).toMatchObject({
      allowComplete: false,
      reason: "pending_background_children",
      progressTrigger: "background_children.pending",
    });
  });

  it("blocks completion while async child results are still pending incorporation", () => {
    const result = pendingBackgroundWorkGuard({
      actions: [],
      planList: [],
      toolCalls: [],
      agentId: "ora",
      activeBackgroundChildCount: 0,
      pendingAsyncResultCount: 2,
    });

    expect(result).toMatchObject({
      allowComplete: false,
      reason: "pending_background_results",
      progressTrigger: "background_results.pending",
    });
  });

  it("blocks natural completion when a required collaboration contract has not been satisfied", () => {
    const result = requiredCollaborationGuard({
      actions: [],
      planList: [],
      toolCalls: [],
      collaborationRequirement: "required",
      collaborationObserved: false,
    });

    expect(result).toMatchObject({
      allowComplete: false,
      reason: "required_collaboration_missing",
      progressTrigger: "collaboration.required",
    });
    if (!result.allowComplete) {
      expect(result.followUpContent).toContain("agent.spawn");
    }
  });

  it("allows completion after the required collaboration contract is satisfied", () => {
    expect(requiredCollaborationGuard({
      actions: [],
      planList: [],
      toolCalls: [],
      collaborationRequirement: "required",
      collaborationObserved: true,
    })).toEqual({ allowComplete: true });
  });

  it("blocks completion explicitly when background children are stalled", () => {
    const result = stalledBackgroundWorkGuard({
      actions: [],
      planList: [],
      toolCalls: [],
      stalledBackgroundChildren: [{
        id: "run-1:child-1",
        agentId: "ora-sub-1",
        label: "Research alpha",
        lifecyclePhase: "stalled",
        stallReason: "no_progress_timeout",
        resultAvailability: "partial",
      }],
    });

    expect(result).toMatchObject({
      allowComplete: false,
      reason: "stalled_background_children",
      progressTrigger: "background_children.stalled",
    });
    expect(result.allowComplete).toBe(false);
    if (!result.allowComplete) {
      expect(result.detail).toContain("Research alpha");
      expect(result.detail).toContain("no_progress_timeout");
    }
  });
});

// ---------------------------------------------------------------------------
// finalOutputGuard — structural final-output completeness check
// ---------------------------------------------------------------------------
describe("finalOutputGuard", () => {
  it("allows complete when response text is non-empty", () => {
    expect(finalOutputGuard("Here is the final answer with all the details and complete implementation steps.")).toEqual({
      allowComplete: true,
    });
  });

  it("allows short non-post-tool replies", () => {
    expect(finalOutputGuard("OK")).toEqual({ allowComplete: true });
    expect(finalOutputGuard("可以")).toEqual({ allowComplete: true });
  });

  it("blocks very short post-tool replies", () => {
    const result = finalOutputGuard("OK", { isPostTool: true, finishReason: "stop" });
    expect(result.allowComplete).toBe(false);
    if (!result.allowComplete) {
      expect(result.reason).toBe("final_output_too_short");
      expect(result.detail).toContain("finish_reason=stop");
    }
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

  it("uses concise self-contained repair prompt for short post-tool stop responses", () => {
    const result = finalOutputGuard("太短了", { isPostTool: true, finishReason: "stop" });
    expect(result.allowComplete).toBe(false);
    if (!result.allowComplete) {
      expect(result.followUpReason).toBe("final_output_too_short_repair");
      expect(result.followUpContent).toBe(
        "Your previous post-tool response is too brief to stand alone as the final answer. Rewrite it as a self-contained user-facing answer using the available conversation and tool results. A concise answer is fine, but it should directly answer the user. Do not call tools.",
      );
    }
  });

  it("uses truncation-oriented repair prompt when finish reason is missing", () => {
    const result = finalOutputGuard("短回复", { isPostTool: true });
    expect(result.allowComplete).toBe(false);
    if (!result.allowComplete) {
      expect(result.followUpReason).toBe("final_output_too_short_repair");
      expect(result.followUpContent).toBe(
        "Your previous response may have been truncated. Continue and complete the user-facing answer now using the available conversation and tool results. Do not call tools.",
      );
    }
  });

  it("treats length finish reason as truncated output", () => {
    const result = finalOutputGuard("短回复", { isPostTool: true, finishReason: "length" });
    expect(result.allowComplete).toBe(false);
    if (!result.allowComplete) {
      expect(result.detail).toContain("finish_reason=length");
      expect(result.followUpContent).toBe(
        "Your previous response may have been truncated. Continue and complete the user-facing answer now using the available conversation and tool results. Do not call tools.",
      );
    }
  });

  it("does not inspect language-specific unfinished phrases", () => {
    // The guard is purely structural: it only checks empty output plus
    // a short post-tool threshold, not language-specific phrases.
    expect(finalOutputGuard("以下是完整的实施计划，包含所有实现细节和测试用例的具体安排。请仔细阅读并按照步骤逐一执行，确保每一步都经过充分验证和确认。")).toEqual({
      allowComplete: true,
    });
    expect(finalOutputGuard("Here is the complete plan with all implementation details and test cases. Please review and execute.")).toEqual({
      allowComplete: true,
    });
  });
});
