import { describe, expect, it } from "vitest";
import type { StateSnapshot } from "../src/index.js";
import { projectForkSettledSnapshot, projectForkVisibleAssistantText } from "../src/index.js";

function baseSnapshot(overrides: Partial<StateSnapshot> = {}): StateSnapshot {
  return {
    runId: "run-source",
    sessionId: "session-source",
    turnIndex: 1,
    status: "running",
    pattern: "single_agent",
    modeId: "single_agent",
    input: { prompt: "第一轮", context: {}, createdAt: 100 },
    config: {
      modeId: "single_agent",
      pattern: "single_agent",
      modeSelection: "manual",
      profileIds: [],
      providerId: "local-smoke",
      modelRef: "local/smoke-model",
      approvalMode: "high_risk_only",
      patternOptions: {},
      metadata: {},
      deterministicSeed: "session-fork-projection-test",
      skillIds: [],
      toolIds: [],
    },
    topology: {
      nodes: [
        { id: "run", label: "Run", kind: "run", status: "running", metadata: {} },
        { id: "agent", label: "Agent", kind: "agent", status: "blocked", agentId: "agent-1", metadata: {} },
      ],
      edges: [],
    },
    profiles: [],
    memory: [],
    plan: [],
    planList: [],
    todos: [],
    actions: [{
      id: "run-source:action-0",
      runId: "run-source",
      type: "shell.execute",
      riskLevel: "low",
      status: "approval_required",
      input: {},
      artifactIds: [],
      approvalRequest: { title: "需要确认", summary: "确认后执行" },
    }],
    toolCalls: [{
      id: "run-source:tool-0",
      runId: "run-source",
      toolId: "shell.execute",
      args: {},
      source: "json_fallback",
      status: "running",
      requestedAt: 101,
      updatedAt: 102,
      result: {
        status: "running",
        createdAt: 101,
        updatedAt: 102,
      },
    }],
    continuation: { frames: [{ checkpointId: "cp-1", runId: "run-source" }] },
    planDecisions: [{
      id: "decision-1",
      sessionId: "session-source",
      status: "pending",
      options: [],
      createdAt: 100,
    }],
    conversation: [],
    toolResults: [],
    policyDecisions: [],
    checkpoints: [],
    events: [],
    agentMessages: [{
      id: "run-source:agent-message-0",
      runId: "run-source",
      createdAt: 101,
      fromAgentId: "debate_agent",
      toAgentIds: [],
      threadId: "debate-thread",
      kind: "reply",
      status: "running",
      content: "最终完整正文",
      artifactIds: [],
      transcript: {
        kind: "stage_transcript",
        groupId: "debate",
        stageId: "stage-1",
        stageLabel: "辩论",
        sequence: 0,
        speakerLabel: "正方主辩",
        status: "running",
        layout: {
          style: "two_sided_duel",
          ownsFinalAnswer: true,
          supplementalBody: "never",
        },
      },
    }],
    artifacts: [],
    childSessions: [],
    activeAgents: ["agent-1"],
    queueSummary: { mode: "dag", pending: 1, inProgress: 1, completed: 0, topics: ["task.input"] },
    sharedStateSummary: { enabled: true, storeKind: "blackboard", version: 2, entries: [{ key: "seed", version: 1, summary: "seed" }] },
    busStats: { enabled: true, publishedCount: 2, routedCount: 1, topicCounts: { "task.input": 1 } },
    pendingClarifications: [{ id: "clar-1", requestedAt: 101, question: "请确认" }],
    pendingApprovals: ["run-source:action-0"],
    updatedAt: 200,
    output: { text: "摘要文本" },
    ...overrides,
  } as unknown as StateSnapshot;
}

describe("session fork projection", () => {
  it("prefers transcript-owned final answer text when deriving fork-visible assistant content", () => {
    const snapshot = baseSnapshot();
    expect(projectForkVisibleAssistantText(snapshot)).toBe("最终完整正文");
  });

  it("settles running execution state for forked snapshots", () => {
    const settled = projectForkSettledSnapshot(baseSnapshot(), "最终完整正文");
    expect(settled.status).toBe("succeeded");
    expect(settled.topology.nodes.map((node) => node.status)).toEqual(["done", "done"]);
    expect(settled.actions[0]?.status).toBe("succeeded");
    expect(settled.actions[0]?.approvalRequest).toBeUndefined();
    expect(settled.toolCalls[0]?.status).toBe("succeeded");
    expect(settled.toolCalls[0]?.result?.status).toBe("succeeded");
    expect(settled.agentMessages[0]?.status).toBe("done");
    expect(settled.agentMessages[0]?.transcript?.status).toBe("done");
    expect(settled.pendingClarifications).toEqual([]);
    expect(settled.pendingApprovals).toEqual([]);
    expect(settled.planDecisions).toEqual([]);
    expect(settled.continuation.frames).toEqual([]);
    expect(settled.activeAgents).toEqual([]);
    expect(settled.queueSummary.inProgress).toBe(0);
    expect(settled.queueSummary.pending).toBe(0);
    expect(settled.sharedStateSummary.enabled).toBe(false);
    expect(settled.busStats.enabled).toBe(false);
    expect(settled.output).toEqual({ text: "最终完整正文" });
  });
});
