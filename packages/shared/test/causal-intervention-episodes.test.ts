import { describe, expect, it } from "vitest";
import {
  deriveCausalInterventionEpisodes,
  classifySignificance,
  deriveCausalDecisionChains,
} from "../src/index.js";
import type { CausalDecisionRecord, CausalInterventionEpisode, CausalInterventionSignificance } from "../src/index.js";

type TestOutcome = {
  effective: boolean;
  status: string;
  evidenceKind: CausalInterventionEpisode["evidenceKind"];
};

/** Minimal valid CausalDecisionRecord for significance classification. */
function makeRecord(overrides: Partial<CausalDecisionRecord> = {}): CausalDecisionRecord {
  return {
    taskState: {
      surfaceRequest: "测试任务",
      selectedLatentGoal: "完成测试",
      keyUncertainties: [],
    },
    policyDecision: {
      goalUncertainty: 0.3,
      factUncertainty: 0.2,
      contextUncertainty: 0.2,
      actionRisk: 0.1,
      userCost: 0.1,
      reversibility: "high",
      recommendedAction: "use_tool",
      reason: "test reason",
      wouldChangeOutcomeIfWrong: false,
    },
    chosenIntervention: "use_tool",
    alternativeInterventions: [],
    recordedAt: 1000,
    ...overrides,
  };
}

function makeEpisode(overrides: Partial<CausalInterventionEpisode> = {}): CausalInterventionEpisode {
  return {
    episodeId: "ep-test",
    decisionId: "dec-test",
    runId: "run-test",
    turnIndex: 1,
    recordedAt: 1000,
    source: "router_primary",
    effective: true,
    chosenIntervention: "use_tool",
    evidenceKind: "tool_call",
    surfaceRequest: "测试",
    selectedLatentGoal: "测试",
    keyUncertainties: [],
    reason: "test",
    goalUncertainty: 0.3,
    factUncertainty: 0.2,
    contextUncertainty: 0.2,
    actionRisk: 0.1,
    userCost: 0.1,
    reversibility: "high",
    wouldChangeOutcomeIfWrong: false,
    status: "resolved",
    goalImpact: "strong_positive",
    outcomeSummary: "已完成。",
    significance: "trace",
    ...overrides,
  };
}

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

describe("classifySignificance", () => {
  const defaultOutcome: TestOutcome = { effective: true, status: "resolved", evidenceKind: "tool_call" };

  // strategic gates

  it("classifies clarification_gate as strategic", () => {
    const sig = classifySignificance(
      makeRecord({ chosenIntervention: "clarify" }),
      { ...defaultOutcome, evidenceKind: "clarification_gate" },
      1,
      [],
    );
    expect(sig).toBe("strategic");
  });

  it("classifies approval_gate as strategic", () => {
    const sig = classifySignificance(
      makeRecord({ chosenIntervention: "request_approval" }),
      { ...defaultOutcome, evidenceKind: "approval_gate" },
      1,
      [],
    );
    expect(sig).toBe("strategic");
  });

  it("classifies plan_gate as strategic", () => {
    const sig = classifySignificance(
      makeRecord({ chosenIntervention: "plan" }),
      { ...defaultOutcome, evidenceKind: "plan_gate" },
      1,
      [],
    );
    expect(sig).toBe("strategic");
  });

  it("classifies superseded as strategic", () => {
    const sig = classifySignificance(
      makeRecord(),
      { ...defaultOutcome, evidenceKind: "superseded" },
      1,
      [],
    );
    expect(sig).toBe("strategic");
  });

  it("classifies stop intervention as strategic", () => {
    const sig = classifySignificance(
      makeRecord({ chosenIntervention: "stop" }),
      { ...defaultOutcome, evidenceKind: "tool_call" },
      1,
      [],
    );
    expect(sig).toBe("strategic");
  });

  it("classifies blocked tool with recovery in same turn as strategic", () => {
    const recoveryRecord = makeRecord({
      chosenIntervention: "use_tool",
      decisionContext: { phase: "tool_request", toolId: "file.read", turnIndex: 1 },
    });
    const sig = classifySignificance(
      makeRecord({
        chosenIntervention: "use_tool",
        decisionContext: { phase: "tool_request", turnIndex: 1 },
        recordedAt: 1000,
      }),
      { effective: true, status: "blocked", evidenceKind: "tool_call" },
      1,
      [{ record: recoveryRecord }],
    );
    expect(sig).toBe("strategic");
  });

  // tactical

  it("classifies search_web as tactical when effective", () => {
    const sig = classifySignificance(
      makeRecord({ chosenIntervention: "search_web" }),
      { ...defaultOutcome, effective: true, evidenceKind: "tool_call" },
      1,
      [],
    );
    expect(sig).toBe("tactical");
  });

  it("classifies read_context as tactical when effective", () => {
    const sig = classifySignificance(
      makeRecord({ chosenIntervention: "read_context" }),
      { ...defaultOutcome, effective: true, evidenceKind: "tool_call" },
      1,
      [],
    );
    expect(sig).toBe("tactical");
  });

  it("classifies web.search tool request as tactical when effective", () => {
    const sig = classifySignificance(
      makeRecord({
        chosenIntervention: "use_tool",
        decisionContext: { phase: "tool_request", toolId: "web.search" },
      }),
      { ...defaultOutcome, effective: true, evidenceKind: "tool_call" },
      1,
      [],
    );
    expect(sig).toBe("tactical");
  });

  it("classifies file.read tool request as tactical when effective", () => {
    const sig = classifySignificance(
      makeRecord({
        chosenIntervention: "use_tool",
        decisionContext: { phase: "tool_request", toolId: "file.read" },
      }),
      { ...defaultOutcome, effective: true, evidenceKind: "tool_call" },
      1,
      [],
    );
    expect(sig).toBe("tactical");
  });

  // trace

  it("classifies plain tool use as trace", () => {
    const sig = classifySignificance(
      makeRecord({ chosenIntervention: "use_tool" }),
      { ...defaultOutcome, evidenceKind: "tool_call" },
      1,
      [],
    );
    expect(sig).toBe("trace");
  });

  it("classifies answer_directly as trace", () => {
    const sig = classifySignificance(
      makeRecord({ chosenIntervention: "answer_directly" }),
      { ...defaultOutcome, evidenceKind: "reply_message" },
      1,
      [],
    );
    expect(sig).toBe("trace");
  });

  it("classifies search_web as trace when not effective", () => {
    const sig = classifySignificance(
      makeRecord({ chosenIntervention: "search_web" }),
      { ...defaultOutcome, effective: false, evidenceKind: "tool_call" },
      1,
      [],
    );
    expect(sig).toBe("trace");
  });

  it("classifies tool_call without recovery as trace (not strategic)", () => {
    const sig = classifySignificance(
      makeRecord({
        chosenIntervention: "use_tool",
        decisionContext: { phase: "tool_request" },
      }),
      { effective: true, status: "resolved", evidenceKind: "tool_call" },
      1,
      [],
    );
    expect(sig).toBe("trace");
  });

  it("does not promote to strategic when recovery is in a different turn", () => {
    const otherTurnRecovery = makeRecord({
      chosenIntervention: "use_tool",
      decisionContext: { phase: "tool_request", toolId: "file.read", turnIndex: 2 },
    });
    const sig = classifySignificance(
      makeRecord({
        chosenIntervention: "use_tool",
        decisionContext: { phase: "tool_request", turnIndex: 1 },
      }),
      { effective: true, status: "resolved", evidenceKind: "tool_call" },
      1,
      [{ record: otherTurnRecovery }],
    );
    expect(sig).toBe("trace");
  });
});

describe("deriveCausalDecisionChains", () => {
  it("groups episodes by turnIndex and agentId", () => {
    const episodes = [
      makeEpisode({ runId: "r1", turnIndex: 1, agentId: "ora", chosenIntervention: "clarify", significance: "strategic", recordedAt: 1000, goalUncertainty: 0.7 }),
      makeEpisode({ runId: "r1", turnIndex: 1, agentId: "ora", chosenIntervention: "use_tool", significance: "trace", recordedAt: 2000, goalUncertainty: 0.5 }),
      makeEpisode({ runId: "r2", turnIndex: 2, agentId: "ora", chosenIntervention: "answer_directly", significance: "trace", recordedAt: 3000, goalUncertainty: 0.1 }),
    ];

    const chains = deriveCausalDecisionChains(episodes);

    expect(chains).toHaveLength(2);
    expect(chains[0]).toMatchObject({
      chainId: "1:ora",
      turnIndex: 1,
      episodeCount: 2,
      entryGoalUncertainty: 0.7,
      exitGoalUncertainty: 0.5,
      dominantIntervention: "clarify",
    });
    expect(chains[1]).toMatchObject({
      chainId: "2:ora",
      turnIndex: 2,
      episodeCount: 1,
      entryGoalUncertainty: 0.1,
      exitGoalUncertainty: 0.1,
      dominantIntervention: "answer_directly",
    });
  });

  it("skips non-effective episodes", () => {
    const episodes = [
      makeEpisode({ turnIndex: 1, effective: false }),
      makeEpisode({ turnIndex: 1, effective: true, goalUncertainty: 0.5, significance: "tactical" }),
    ];

    const chains = deriveCausalDecisionChains(episodes);

    expect(chains).toHaveLength(1);
    expect(chains[0]?.episodeCount).toBe(1);
  });

  it("produces no chain when no effective episodes exist", () => {
    const episodes = [
      makeEpisode({ turnIndex: 1, effective: false }),
    ];

    const chains = deriveCausalDecisionChains(episodes);

    expect(chains).toHaveLength(0);
  });

  it("returns chains sorted by turnIndex", () => {
    const episodes = [
      makeEpisode({ turnIndex: 3, effective: true, goalUncertainty: 0.2, significance: "trace" }),
      makeEpisode({ turnIndex: 1, effective: true, goalUncertainty: 0.7, significance: "strategic" }),
    ];

    const chains = deriveCausalDecisionChains(episodes);

    expect(chains[0]?.turnIndex).toBe(1);
    expect(chains[1]?.turnIndex).toBe(3);
  });

  it("selects dominant intervention by highest significance", () => {
    const episodes = [
      makeEpisode({ turnIndex: 1, agentId: "ora", chosenIntervention: "use_tool", significance: "trace", recordedAt: 1000, goalUncertainty: 0.5 }),
      makeEpisode({ turnIndex: 1, agentId: "ora", chosenIntervention: "clarify", significance: "strategic", recordedAt: 2000, goalUncertainty: 0.4 }),
      makeEpisode({ turnIndex: 1, agentId: "ora", chosenIntervention: "search_web", significance: "tactical", recordedAt: 1500, goalUncertainty: 0.45 }),
    ];

    const chains = deriveCausalDecisionChains(episodes);

    expect(chains[0]?.dominantIntervention).toBe("clarify");
  });

  it("uses default agentId key when agentId is undefined", () => {
    const episodes = [
      makeEpisode({ turnIndex: 1, agentId: undefined, goalUncertainty: 0.5, significance: "tactical" }),
    ];

    const chains = deriveCausalDecisionChains(episodes);

    expect(chains).toHaveLength(1);
    expect(chains[0]?.chainId).toBe("1:default");
  });

  it("entry equals exit goalUncertainty for single-episode chain", () => {
    const episodes = [
      makeEpisode({ turnIndex: 1, goalUncertainty: 0.42, significance: "strategic" }),
    ];

    const chains = deriveCausalDecisionChains(episodes);

    expect(chains[0]).toMatchObject({
      entryGoalUncertainty: 0.42,
      exitGoalUncertainty: 0.42,
    });
  });
});
