import { describe, expect, it } from "vitest";
import type { OraEventEnvelope, RunConfig } from "@cemeworm/shared";
import {
  extractCausalTaskState,
  hasPrimaryCausalDecisionInPhase,
  latestCausalTaskState,
  mergeCausalTaskState,
} from "./causal-task-state-extractor.js";

function mockConfig(): RunConfig {
  return {
    pattern: "solo_agent",
    modeSelection: "manual",
    profileIds: ["solo_agent"],
    skillIds: [],
    toolIds: [],
    modelRef: "local/test-model",
    approvalMode: "high_risk_only",
    permissionMode: "default",
    patternOptions: {},
    metadata: {},
  } as unknown as RunConfig;
}

function causalEvent(payloadOverrides: Record<string, unknown> = {}): OraEventEnvelope {
  return {
    id: "evt-causal",
    runId: "run-extractor-test",
    seq: 1,
    type: "causal.decision.recorded",
    createdAt: Date.now(),
    payload: {
      source: "router_primary",
      decisionKind: "tool_request",
      taskState: {
        surfaceRequest: "帮我优化性能",
        latentGoalHypotheses: ["优化单个组件性能"],
        selectedLatentGoal: "优化单个组件性能",
        keyUncertainties: ["上下文不足"],
        constraints: [],
        candidateInterventions: ["read_context"],
        chosenIntervention: "read_context",
        alternativeInterventions: ["clarify"],
        counterfactualRiskIfSkipped: "可能改错目标文件",
        expectedOutcomeLift: "",
        confidence: 0.72,
        stopCondition: "",
      },
      policyDecision: {
        goalUncertainty: 0.3,
        factUncertainty: 0.2,
        contextUncertainty: 0.6,
        actionRisk: 0.1,
        userCost: 0.05,
        reversibility: "high",
        recommendedAction: "read_context",
        reason: "read_context: missing context",
        wouldChangeOutcomeIfWrong: true,
      },
      chosenIntervention: "read_context",
      alternativeInterventions: ["clarify"],
      recordedAt: Date.now(),
      decisionContext: { phase: "tool_request" },
      ...payloadOverrides,
    },
  } as OraEventEnvelope;
}

describe("causal task-state extractor", () => {
  it("falls back to heuristics when no provider output is available", async () => {
    const state = await extractCausalTaskState({
      prompt: "请先搜索最新资料",
      config: mockConfig(),
      phase: "tool_request",
      proposedToolId: "web.search",
      allowLlmExtraction: false,
    });

    expect(state.surfaceRequest).toBe("请先搜索最新资料");
    expect(state.keyUncertainties).toContain("事实信息缺失");
    expect(state.selectedLatentGoal?.length ?? 0).toBeGreaterThan(0);
  });

  it("merges structured LLM output into the task state", async () => {
    const state = await extractCausalTaskState({
      prompt: "帮我看一下这个项目为什么启动失败",
      config: mockConfig(),
      phase: "run_start",
      allowLlmExtraction: true,
    }, {
      invokeProvider: async () => ({
        providerId: "test",
        modelRef: "test",
        text: JSON.stringify({
          latentGoalHypotheses: ["定位启动失败根因", "判断是依赖还是配置问题"],
          selectedLatentGoal: "定位项目启动失败的根因",
          constraints: ["需要基于当前仓库上下文判断"],
          candidateInterventions: ["read_context", "use_tool"],
          counterfactualRiskIfSkipped: "可能直接给出猜测性修复建议",
          expectedOutcomeLift: "更快定位真实故障点",
          stopCondition: "确认根因并给出下一步修复建议后停止",
          confidence: 0.81,
        }),
      } as never),
    });

    expect(state.selectedLatentGoal).toBe("定位项目启动失败的根因");
    expect(state.constraints).toContain("需要基于当前仓库上下文判断");
    expect(state.candidateInterventions).toEqual(["read_context", "use_tool"]);
    expect(state.confidence).toBe(0.81);
  });

  it("falls back to heuristic state when provider JSON is invalid", async () => {
    const state = await extractCausalTaskState({
      prompt: "这个问题需要先确认范围",
      config: mockConfig(),
      phase: "clarification_triggered",
      counterfactualRiskIfSkipped: "可能答错对象",
      allowLlmExtraction: true,
    }, {
      invokeProvider: async () => ({
        providerId: "test",
        modelRef: "test",
        text: "not-json",
      } as never),
    });

    expect(state.selectedLatentGoal?.length ?? 0).toBeGreaterThan(0);
    expect(state.counterfactualRiskIfSkipped).toBe("可能答错对象");
    expect(state.keyUncertainties).toContain("用户目标不明确");
  });

  it("produces a non-empty heuristic latent goal for context-heavy prompts", async () => {
    const state = await extractCausalTaskState({
      prompt: "帮我review这个PR",
      config: mockConfig(),
      phase: "run_start",
      allowLlmExtraction: false,
    });

    expect(state.selectedLatentGoal).toBe("基于现有上下文完成审查并给出结论");
    expect(state.latentGoalHypotheses).toContain("基于现有上下文完成审查并给出结论");
  });

  it("passes needsFreshnessEvidence=true from LLM extraction through merge", async () => {
      const state = await extractCausalTaskState({
        prompt: "python最新版本有哪些新特性",
        config: mockConfig(),
        phase: "run_start",
        allowLlmExtraction: true,
      }, {
        invokeProvider: async () => ({
          providerId: "test",
          modelRef: "test",
          text: JSON.stringify({
            latentGoalHypotheses: ["获取Python最新版本信息"],
            selectedLatentGoal: "获取Python最新版本的新特性信息",
            constraints: [],
            candidateInterventions: ["search_web"],
            counterfactualRiskIfSkipped: "可能给出过时的版本信息",
            expectedOutcomeLift: "提供最新准确的版本信息",
            stopCondition: "确认版本信息后停止",
            confidence: 0.85,
            needsFreshnessEvidence: true,
          }),
        } as never),
      });

      expect(state.needsFreshnessEvidence).toBe(true);
    });

    it("passes needsFreshnessEvidence=false from LLM extraction through merge", async () => {
      const state = await extractCausalTaskState({
        prompt: "解释什么是闭包",
        config: mockConfig(),
        phase: "run_start",
        allowLlmExtraction: true,
      }, {
        invokeProvider: async () => ({
          providerId: "test",
          modelRef: "test",
          text: JSON.stringify({
            latentGoalHypotheses: ["学习JavaScript闭包概念"],
            selectedLatentGoal: "理解闭包的工作原理",
            constraints: [],
            candidateInterventions: ["answer_directly"],
            counterfactualRiskIfSkipped: "",
            expectedOutcomeLift: "",
            stopCondition: "",
            confidence: 0.9,
            needsFreshnessEvidence: false,
          }),
        } as never),
      });

      expect(state.needsFreshnessEvidence).toBe(false);
    });

    it("keeps left needsFreshnessEvidence when LLM does not extract the field", () => {
      const merged = mergeCausalTaskState(
        { needsFreshnessEvidence: true, selectedLatentGoal: "获取最新信息" },
        { selectedLatentGoal: "获取最新信息" },
      );

      expect(merged.needsFreshnessEvidence).toBe(true);
    });

    it("right needsFreshnessEvidence=false overrides left true", () => {
      const merged = mergeCausalTaskState(
        { needsFreshnessEvidence: true },
        { needsFreshnessEvidence: false },
      );

      expect(merged.needsFreshnessEvidence).toBe(false);
    });

  it("tracks the latest native task state and first primary tool request", () => {
    const events = [
      causalEvent(),
      causalEvent({
        source: "runtime_followup",
        taskState: mergeCausalTaskState(latestCausalTaskState([causalEvent()]), {
          keyUncertainties: ["用户目标不明确"],
          chosenIntervention: "clarify",
        }),
        decisionContext: { phase: "clarification_triggered" },
      }),
    ];

    expect(latestCausalTaskState(events)?.chosenIntervention).toBe("clarify");
    expect(hasPrimaryCausalDecisionInPhase(events, "tool_request")).toBe(true);
    expect(hasPrimaryCausalDecisionInPhase(events, "completion")).toBe(false);
  });
});
