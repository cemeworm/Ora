import { describe, expect, it } from "vitest";
import { deriveCausalInterventionEpisodes } from "../src/index.js";

describe("causal intervention episodes", () => {
  it("keeps outcome linkage for primary tool decisions and treats approval follow-up with real gate evidence as effective", () => {
    const snapshot = {
      runId: "run-episodes",
      turnIndex: 1,
      status: "interrupted",
      events: [
        {
          id: "evt-primary",
          runId: "run-episodes",
          seq: 1,
          type: "causal.decision.recorded",
          createdAt: 1000,
          agentId: "agent-1",
          nodeId: "agent-1",
          payload: {
            source: "router_primary",
            taskState: { surfaceRequest: "读取文件" },
            policyDecision: {
              goalUncertainty: 0.2,
              factUncertainty: 0.2,
              contextUncertainty: 0.2,
              actionRisk: 0.1,
              userCost: 0.05,
              reversibility: "high",
              recommendedAction: "use_tool",
              reason: "use_tool: low uncertainty, safe to proceed",
              wouldChangeOutcomeIfWrong: false,
            },
            chosenIntervention: "use_tool",
            alternativeInterventions: [],
            recordedAt: 1000,
            decisionContext: { phase: "tool_request", toolId: "file.read", agentId: "agent-1", nodeId: "agent-1" },
          },
        },
        {
          id: "evt-followup",
          runId: "run-episodes",
          seq: 2,
          type: "causal.decision.recorded",
          createdAt: 1010,
          agentId: "agent-1",
          nodeId: "agent-1",
          payload: {
            source: "runtime_followup",
            decisionKind: "approval_triggered",
            taskState: { surfaceRequest: "读取文件" },
            policyDecision: {
              goalUncertainty: 0.2,
              factUncertainty: 0.2,
              contextUncertainty: 0.2,
              actionRisk: 0.8,
              userCost: 0.5,
              reversibility: "low",
              recommendedAction: "request_approval",
              reason: "request_approval: approval gate triggered at runtime",
              wouldChangeOutcomeIfWrong: true,
            },
            chosenIntervention: "request_approval",
            alternativeInterventions: [],
            recordedAt: 1010,
            decisionContext: {
              phase: "approval_triggered",
              toolId: "file.read",
              toolCallId: "tool-call-2",
              agentId: "agent-1",
              nodeId: "agent-1",
            },
          },
        },
      ],
      toolCalls: [
        {
          id: "tool-call-1",
          runId: "run-episodes",
          agentId: "agent-1",
          nodeId: "agent-1",
          toolId: "file.read",
          args: {},
          source: "provider_native",
          status: "succeeded",
          requestedAt: 1001,
          updatedAt: 1002,
        },
        {
          id: "tool-call-2",
          runId: "run-episodes",
          agentId: "agent-1",
          nodeId: "agent-1",
          toolId: "file.read",
          args: {},
          source: "provider_native",
          status: "approval_required",
          requestedAt: 1010,
          updatedAt: 1011,
        },
      ],
      actions: [],
      planDecisions: [],
      pendingClarifications: [],
    } as const;

    const episodes = deriveCausalInterventionEpisodes(snapshot as never);

    expect(episodes).toHaveLength(2);
    expect(episodes[0]).toMatchObject({
      source: "router_primary",
      effective: true,
      status: "resolved",
      goalImpact: "strong_positive",
      evidenceKind: "tool_call",
      outcomeSummary: "已执行 file.read，并产出成功结果。",
    });
    expect(episodes[1]).toMatchObject({
      source: "runtime_followup",
      effective: true,
      status: "pending",
      evidenceKind: "approval_gate",
      outcomeSummary: "已进入审批关卡，等待用户确认后继续。",
    });
  });

  it("does not mark a tool decision as superseded when the matching proposed tool call was recorded slightly earlier", () => {
    const snapshot = {
      runId: "run-episodes",
      turnIndex: 1,
      status: "running",
      events: [
        {
          id: "evt-tool",
          runId: "run-episodes",
          seq: 10,
          type: "causal.decision.recorded",
          createdAt: 2000,
          agentId: "agent-1",
          nodeId: "agent-1",
          payload: {
            source: "router_primary",
            taskState: { surfaceRequest: "读取 README" },
            policyDecision: {
              goalUncertainty: 0.2,
              factUncertainty: 0.2,
              contextUncertainty: 0.2,
              actionRisk: 0.1,
              userCost: 0.05,
              reversibility: "high",
              recommendedAction: "use_tool",
              reason: "use_tool: low uncertainty, safe to proceed",
              wouldChangeOutcomeIfWrong: false,
            },
            chosenIntervention: "use_tool",
            alternativeInterventions: [],
            recordedAt: 2000,
            decisionContext: {
              phase: "tool_request",
              toolId: "file.read",
              agentId: "agent-1",
              nodeId: "agent-1",
            },
          },
        },
        {
          id: "evt-completion",
          runId: "run-episodes",
          seq: 12,
          type: "causal.decision.recorded",
          createdAt: 2400,
          agentId: "agent-1",
          nodeId: "agent-1",
          payload: {
            source: "router_primary",
            taskState: { surfaceRequest: "读取 README" },
            policyDecision: {
              goalUncertainty: 0.1,
              factUncertainty: 0.1,
              contextUncertainty: 0.1,
              actionRisk: 0.1,
              userCost: 0.05,
              reversibility: "high",
              recommendedAction: "answer_directly",
              reason: "answer_directly: low uncertainty, safe to proceed",
              wouldChangeOutcomeIfWrong: false,
            },
            chosenIntervention: "answer_directly",
            alternativeInterventions: [],
            recordedAt: 2400,
            decisionContext: {
              phase: "completion",
              agentId: "agent-1",
              nodeId: "agent-1",
            },
          },
        },
      ],
      toolCalls: [{
        id: "tool-call-1",
        runId: "run-episodes",
        agentId: "agent-1",
        nodeId: "agent-1",
        toolId: "file.read",
        args: {},
        source: "provider_native",
        status: "proposed",
        requestedAt: 1995,
        updatedAt: 1996,
      }],
      actions: [],
      planDecisions: [],
      pendingClarifications: [],
    } as const;

    const episodes = deriveCausalInterventionEpisodes(snapshot as never);

    expect(episodes[0]).toMatchObject({
      effective: true,
      status: "pending",
      evidenceKind: "tool_call",
      outcomeSummary: "已进入 file.read 执行链路，当前尚未得到最终结果。",
    });
  });
});
