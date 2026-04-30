import { describe, expect, it } from "vitest";
import type { AgentConversationMessage, OraEventEnvelope, StateSnapshot } from "@ora/shared";
import { applyStreamingRunEvent } from "../src/run-streaming.js";

function snapshot(agentMessages: AgentConversationMessage[] = []): StateSnapshot {
  return {
    runId: "run-debate",
    sessionId: "session-debate",
    turnIndex: 1,
    status: "running",
    pattern: "orchestrator_subagent",
    modeId: "debate",
    input: { prompt: "Debate this.", createdAt: 1_714_000_000_000, context: {} },
    config: {
      pattern: "orchestrator_subagent",
      modeId: "debate",
      modeSelection: "manual",
      profileIds: ["debate_agent"],
      skillIds: [],
      toolIds: [],
      providerId: "local-smoke",
      modelRef: "local/smoke-model",
      approvalMode: "high_risk_only",
      patternOptions: {},
      metadata: {},
      deterministicSeed: "run-streaming-test",
    },
    topology: { nodes: [], edges: [] },
    profiles: [],
    memory: [],
    plan: [],
    todos: [],
    actions: [],
    toolCalls: [],
    continuation: { frames: [] },
    conversation: [],
    toolResults: [],
    policyDecisions: [],
    checkpoints: [],
    events: [],
    agentMessages,
    artifacts: [],
    activeAgents: [],
    queueSummary: { mode: "backlog", pending: 0, inProgress: 1, completed: 0, topics: [] },
    sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
    busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
    pendingClarifications: [],
    pendingApprovals: [],
    updatedAt: 1_714_000_000_000,
  } as unknown as StateSnapshot;
}

function agentMessage(id: string, createdAt = 1_714_000_000_001, content = "Opening argument."): AgentConversationMessage {
  return {
    id,
    runId: "run-debate",
    createdAt,
    fromAgentId: "debate_agent",
    toAgentIds: [],
    threadId: "debate",
    kind: "reply",
    status: "done",
    content,
    artifactIds: [],
    transcript: {
      kind: "stage_transcript",
      groupId: "debate",
      groupLabel: "结构化辩论",
      stageId: id,
      stageLabel: "第一阶段",
      sequence: 0,
      speakerLabel: "正方主辩",
      stance: "affirmative",
      status: "done",
      layout: {
        style: "two_sided_duel",
        groupId: "debate",
        sideByStance: {
          affirmative: "left",
          negative: "right",
        },
      },
    },
  };
}

function agentMessageEvent(message: AgentConversationMessage, seq = 0): OraEventEnvelope {
  return {
    id: `run-debate:evt-${seq}`,
    runId: "run-debate",
    seq,
    type: "agent.message",
    createdAt: message.createdAt,
    pattern: "orchestrator_subagent",
    agentId: message.fromAgentId,
    nodeId: message.fromAgentId,
    payload: { message },
  };
}

describe("streaming run snapshot projection", () => {
  it("projects agent.message events into live snapshot agentMessages", () => {
    const message = agentMessage("run-debate:agent-message:0");

    const next = applyStreamingRunEvent(snapshot(), agentMessageEvent(message));

    expect(next.events).toHaveLength(1);
    expect(next.agentMessages).toHaveLength(1);
    expect(next.agentMessages[0]?.transcript?.speakerLabel).toBe("正方主辩");
    expect(next.agentMessages[0]?.transcript?.layout?.style).toBe("two_sided_duel");
  });

  it("replaces duplicate streamed agent messages by id", () => {
    const first = agentMessage("run-debate:agent-message:0", 1_714_000_000_001, "Draft argument.");
    const replacement = agentMessage("run-debate:agent-message:0", 1_714_000_000_002, "Final argument.");

    const next = applyStreamingRunEvent(snapshot([first]), agentMessageEvent(replacement));

    expect(next.agentMessages).toHaveLength(1);
    expect(next.agentMessages[0]?.content).toBe("Final argument.");
  });

  it("leaves agentMessages unchanged for non-agent message events", () => {
    const existing = agentMessage("run-debate:agent-message:0");
    const event: OraEventEnvelope = {
      id: "run-debate:evt-1",
      runId: "run-debate",
      seq: 1,
      type: "task.progress",
      createdAt: 1_714_000_000_002,
      pattern: "orchestrator_subagent",
      payload: { kind: "chat_progress", summary: "Running." },
    };

    const next = applyStreamingRunEvent(snapshot([existing]), event);

    expect(next.agentMessages).toEqual([existing]);
  });
});
