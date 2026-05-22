import { describe, expect, it, vi } from "vitest";
import { SINGLE_AGENT_MODE_ID, type RunConfig } from "@cemeworm/shared";
import { maybeInterruptBlockedPlanStep } from "../src/harness/node-runtime-loop.js";

function testConfig(): RunConfig {
  return {
    pattern: "orchestrator_subagent",
    modeId: SINGLE_AGENT_MODE_ID,
    modeSelection: "manual",
    profileIds: ["solo_agent"],
    skillIds: [],
    toolIds: ["plan.update"],
    providerId: "mock-provider",
    modelRef: "mock-model",
    providerConfig: {
      id: "mock-provider",
      type: "local_smoke",
      label: "Mock",
      modelId: "mock-model",
      capabilities: ["chat"],
      headers: {},
    },
    approvalMode: "auto",
    budget: {
      maxTokens: 1024,
      maxToolCalls: 8,
      maxRuntimeMs: 60_000,
    },
    metadata: {},
    deterministicSeed: "node-runtime-loop-plan-blocker",
  };
}

describe("node runtime loop plan-step blocker clarification", () => {
  it("interrupts on the current active plan step when classifier requests clarification", async () => {
    const ensureClarification = vi.fn(async (params) => {
      throw new Error(JSON.stringify(params));
    });

    await expect(maybeInterruptBlockedPlanStep({
      guardResultReason: "plan_list_incomplete",
      prompt: "Run the regression evaluation.",
      currentResponseText: "没有 `DEEPSEEK_API_KEY` 我无法继续当前评测。请提供这个 key，我才能继续执行下一步。",
      planList: [
        { id: "step-prepare", step: "Prepare regression environment", status: "in_progress" },
        { id: "step-run", step: "Run targeted regression", status: "pending" },
      ],
      config: testConfig(),
      agentId: "orchestrator",
      nodeId: "orchestrator",
      title: "Respond",
      ensureClarification,
      requestPlanStepBlocker: vi.fn(async () => ({
        question: "请提供 `DEEPSEEK_API_KEY`，我才能继续当前评测步骤。",
        missingVariables: ["DEEPSEEK_API_KEY"],
        counterfactualRiskIfSkipped: "继续推进会把未真正执行的评测步骤误记为完成。",
      })),
    })).rejects.toThrow(/DEEPSEEK_API_KEY/);

    expect(ensureClarification).toHaveBeenCalledWith({
      id: "clarification:orchestrator:plan-step:step_prepare_deepseek_api_key",
      key: "plan_step_blocker_step_prepare_deepseek_api_key",
      nodeId: "orchestrator",
      nodeLabel: "Respond",
      question: "请提供 `DEEPSEEK_API_KEY`，我才能继续当前评测步骤。",
      missingVariables: ["DEEPSEEK_API_KEY"],
      counterfactualRiskIfSkipped: "继续推进会把未真正执行的评测步骤误记为完成。",
    });
  });

  it("uses blocker-specific clarification ids so different blockers on the same step do not reuse stale answers", async () => {
    const ensureClarification = vi.fn(async (params) => params);

    await maybeInterruptBlockedPlanStep({
      guardResultReason: "plan_list_incomplete",
      prompt: "Continue the deployment.",
      currentResponseText: "当前步骤缺少目标环境。",
      planList: [
        { id: "step-deploy", step: "Deploy build", status: "in_progress" },
      ],
      config: testConfig(),
      agentId: "orchestrator",
      nodeId: "orchestrator",
      title: "Respond",
      ensureClarification,
      requestPlanStepBlocker: vi.fn(async () => ({
        question: "请告诉我目标环境。",
        missingVariables: ["target_environment"],
        counterfactualRiskIfSkipped: "可能会部署到错误环境。",
      })),
    });

    await maybeInterruptBlockedPlanStep({
      guardResultReason: "plan_list_incomplete",
      prompt: "Continue the deployment.",
      currentResponseText: "当前步骤缺少 API key。",
      planList: [
        { id: "step-deploy", step: "Deploy build", status: "in_progress" },
      ],
      config: testConfig(),
      agentId: "orchestrator",
      nodeId: "orchestrator",
      title: "Respond",
      ensureClarification,
      requestPlanStepBlocker: vi.fn(async () => ({
        question: "请提供 API key。",
        missingVariables: ["deployment_api_key"],
        counterfactualRiskIfSkipped: "部署会直接失败。",
      })),
    });

    expect(ensureClarification).toHaveBeenNthCalledWith(1, expect.objectContaining({
      id: "clarification:orchestrator:plan-step:step_deploy_target_environment",
      key: "plan_step_blocker_step_deploy_target_environment",
    }));
    expect(ensureClarification).toHaveBeenNthCalledWith(2, expect.objectContaining({
      id: "clarification:orchestrator:plan-step:step_deploy_deployment_api_key",
      key: "plan_step_blocker_step_deploy_deployment_api_key",
    }));
  });

  it("does nothing when the completion guard reason is not plan_list_incomplete", async () => {
    const ensureClarification = vi.fn();
    const requestPlanStepBlocker = vi.fn();

    await maybeInterruptBlockedPlanStep({
      guardResultReason: "pending_background_children",
      prompt: "Implement the requested change.",
      currentResponseText: "I still have work to do.",
      planList: [
        { id: "step-1", step: "Inspect current behavior", status: "in_progress" },
      ],
      config: testConfig(),
      agentId: "orchestrator",
      nodeId: "orchestrator",
      title: "Respond",
      ensureClarification,
      requestPlanStepBlocker,
    });

    expect(requestPlanStepBlocker).not.toHaveBeenCalled();
    expect(ensureClarification).not.toHaveBeenCalled();
  });
});
