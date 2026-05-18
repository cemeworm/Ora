import { describe, expect, it } from "vitest";
import { deriveCausalInterventionEpisodes } from "../src/index.js";

describe("causal intervention episodes", () => {
  it("marks runtime follow-up records as non-effective and keeps outcome linkage for primary tool decisions", () => {
    const snapshot = {
      runId: "run-episodes",
      turnIndex: 1,
      status: "succeeded",
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
            decisionContext: { phase: "approval_triggered", toolId: "file.read", agentId: "agent-1", nodeId: "agent-1" },
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
        status: "succeeded",
        requestedAt: 1001,
        updatedAt: 1002,
      }],
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
      outcomeSummary: "已执行 file.read，并产出成功结果。",
    });
    expect(episodes[1]).toMatchObject({
      source: "runtime_followup",
      effective: false,
    });
  });
});
