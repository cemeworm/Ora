import { describe, expect, it } from "vitest";
import type { AgentConversationMessage, OraEventEnvelope, StateSnapshot } from "@cemeworm/shared";
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

function actionRecord(status: StateSnapshot["actions"][number]["status"] = "approval_required"): StateSnapshot["actions"][number] {
  return {
    id: "run-debate:action:tool-1",
    runId: "run-debate",
    agentId: "ora",
    type: "shell.execute",
    riskLevel: "high",
    status,
    input: { command: "touch approved.txt" },
    artifactIds: [],
  };
}

function actionUpdatedEvent(record = actionRecord(), seq = 2): OraEventEnvelope {
  return {
    id: `run-debate:evt-${seq}`,
    runId: "run-debate",
    seq,
    type: "action.updated",
    createdAt: 1_714_000_000_003,
    pattern: "orchestrator_subagent",
    agentId: "ora",
    payload: { actionId: record.id, status: record.status, record },
  };
}

function approvalRequiredEvent(actionId = "run-debate:action:tool-1", seq = 3): OraEventEnvelope {
  return {
    id: `run-debate:evt-${seq}`,
    runId: "run-debate",
    seq,
    type: "approval.required",
    createdAt: 1_714_000_000_004,
    pattern: "orchestrator_subagent",
    agentId: "ora",
    payload: {
      actionId,
      decision: {
        id: `${actionId}:policy`,
        runId: "run-debate",
        actionId,
        policyId: "ora.tool_policy",
        requiredApproval: true,
        reason: "High-risk external effect must pass the Ora approval gate.",
        createdAt: 1_714_000_000_004,
      },
    },
  };
}

function approvalResolvedEvent(actionId = "run-debate:action:tool-1", seq = 4): OraEventEnvelope {
  return {
    id: `run-debate:evt-${seq}`,
    runId: "run-debate",
    seq,
    type: "approval.resolved",
    createdAt: 1_714_000_000_005,
    pattern: "orchestrator_subagent",
    agentId: "ora",
    payload: { actionId, decision: "approved", mode: "resume" },
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

  it("projects streamed action updates into the live snapshot", () => {
    const proposed = actionRecord("proposed");
    const approvalRequired = actionRecord("approval_required");

    const afterProposed = applyStreamingRunEvent(snapshot(), actionUpdatedEvent(proposed));
    const next = applyStreamingRunEvent(afterProposed, actionUpdatedEvent(approvalRequired, 3));

    expect(next.actions).toHaveLength(1);
    expect(next.actions[0]).toMatchObject({
      id: approvalRequired.id,
      status: "approval_required",
      type: "shell.execute",
    });
  });

  it("projects approval required and resolved events into pending approvals", () => {
    const actionId = "run-debate:action:tool-1";
    const afterRequired = applyStreamingRunEvent(snapshot(), approvalRequiredEvent(actionId));
    const afterDuplicate = applyStreamingRunEvent(afterRequired, approvalRequiredEvent(actionId, 4));
    const afterResolved = applyStreamingRunEvent(afterDuplicate, approvalResolvedEvent(actionId, 5));

    expect(afterRequired.pendingApprovals).toEqual([actionId]);
    expect(afterDuplicate.pendingApprovals).toEqual([actionId]);
    expect(afterResolved.pendingApprovals).toEqual([]);
  });

  it("still projects terminal run events into status", () => {
    const event: OraEventEnvelope = {
      id: "run-debate:evt-6",
      runId: "run-debate",
      seq: 6,
      type: "run.done",
      createdAt: 1_714_000_000_006,
      pattern: "orchestrator_subagent",
      payload: { status: "succeeded" },
    };

    const next = applyStreamingRunEvent(snapshot(), event);

    expect(next.status).toBe("succeeded");
  });
});
