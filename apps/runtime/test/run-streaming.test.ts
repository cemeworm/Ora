import { describe, expect, it } from "vitest";
import {
  RuntimeSessionLedgerSchema,
  deriveRunSnapshot,
  type AgentConversationMessage,
  type OraEventEnvelope,
  type StateSnapshot,
} from "@cemeworm/shared";
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

function toolCalledEvent(actionId = "run-debate:action:tool-1", seq = 5): OraEventEnvelope {
  return {
    id: `run-debate:evt-${seq}`,
    runId: "run-debate",
    seq,
    type: "tool.called",
    createdAt: 1_714_000_000_006,
    pattern: "orchestrator_subagent",
    agentId: "ora",
    payload: {
      actionId,
      toolId: "shell.execute",
      status: "succeeded",
      input: { command: "touch approved.txt" },
      output: "ok",
      cacheHit: false,
    },
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
    expect(next.pendingApprovals).toEqual([approvalRequired.id]);

    const afterRunning = applyStreamingRunEvent(next, actionUpdatedEvent(actionRecord("running"), 4));

    expect(afterRunning.pendingApprovals).toEqual([]);
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

  it("matches ledger projection for approval resume parity without duplicating raw resolution events", () => {
    const actionId = "run-debate:action:tool-1";
    const approvalRequired = actionUpdatedEvent(actionRecord("approval_required"), 0);
    const resolved = approvalResolvedEvent(actionId, 1);
    const succeeded = actionUpdatedEvent(actionRecord("succeeded"), 2);
    const toolCalled = toolCalledEvent(actionId, 3);
    const afterApprovalRequired = applyStreamingRunEvent(snapshot(), approvalRequired);
    const afterApprovalResolved = applyStreamingRunEvent(afterApprovalRequired, resolved);
    const afterSucceeded = applyStreamingRunEvent(afterApprovalResolved, succeeded);
    const live = applyStreamingRunEvent(afterSucceeded, toolCalled);
    const ledger = RuntimeSessionLedgerSchema.parse({
      sessionId: "session-debate",
      leafEntryId: "run-debate:events-2-3",
      entries: [
        {
          id: "session-debate:session-created",
          sessionId: "session-debate",
          seq: 0,
          type: "session.created",
          turnIndex: 0,
          createdAt: 1_714_000_000_000,
          payload: { title: "Projection parity" },
        },
        {
          id: "run-debate:user",
          sessionId: "session-debate",
          parentId: "session-debate:session-created",
          seq: 1,
          type: "user.message",
          runId: "run-debate",
          turnIndex: 1,
          createdAt: 1_714_000_000_000,
          payload: { content: "Debate this." },
        },
        {
          id: "run-debate:started",
          sessionId: "session-debate",
          parentId: "run-debate:user",
          seq: 2,
          type: "run.started",
          runId: "run-debate",
          turnIndex: 1,
          createdAt: 1_714_000_000_000,
          payload: { input: live.input, config: live.config, modeId: live.modeId, status: "running" },
        },
        {
          id: "run-debate:events-0-0",
          sessionId: "session-debate",
          parentId: "run-debate:started",
          seq: 3,
          type: "runtime.event_batch",
          runId: "run-debate",
          turnIndex: 1,
          createdAt: approvalRequired.createdAt,
          payload: {
            events: [approvalRequired],
            status: "interrupted",
            snapshot: { ...afterApprovalRequired, status: "interrupted" },
          },
        },
        {
          id: "run-debate:gate:approval",
          sessionId: "session-debate",
          parentId: "run-debate:events-0-0",
          seq: 4,
          type: "gate.opened",
          runId: "run-debate",
          turnIndex: 1,
          createdAt: approvalRequired.createdAt,
          payload: {
            gateId: "run-debate:approval",
            kind: "approval",
            pendingActionIds: [actionId],
          },
        },
        {
          id: "run-debate:gate:approval:resolved",
          sessionId: "session-debate",
          parentId: "run-debate:gate:approval",
          seq: 5,
          type: "gate.resolved",
          runId: "run-debate",
          turnIndex: 1,
          createdAt: resolved.createdAt,
          payload: {
            gateId: "run-debate:approval",
            status: "accepted",
            resolvedAt: resolved.createdAt,
          },
        },
        {
          id: "run-debate:events-1-1",
          sessionId: "session-debate",
          parentId: "run-debate:gate:approval:resolved",
          seq: 6,
          type: "runtime.event_batch",
          runId: "run-debate",
          turnIndex: 1,
          createdAt: resolved.createdAt,
          payload: {
            events: [resolved],
            status: afterApprovalResolved.status,
            snapshot: afterApprovalResolved,
          },
        },
        {
          id: "run-debate:events-2-3",
          sessionId: "session-debate",
          parentId: "run-debate:events-1-1",
          seq: 7,
          type: "runtime.event_batch",
          runId: "run-debate",
          turnIndex: 1,
          createdAt: toolCalled.createdAt,
          payload: {
            events: [succeeded, toolCalled],
            status: live.status,
            snapshot: live,
          },
        },
      ],
    });

    const projected = deriveRunSnapshot(ledger, "run-debate");
    const liveActionStates = live.actions.map((action) => ({ id: action.id, status: action.status }));
    const projectedActionStates = projected?.actions.map((action) => ({ id: action.id, status: action.status }));
    const projectedApprovalResolvedEvents = projected?.events.filter((event) => event.type === "approval.resolved") ?? [];
    const projectedToolCalledEvents = projected?.events.filter((event) => event.type === "tool.called") ?? [];

    expect(projectedActionStates).toEqual(liveActionStates);
    expect(projected?.pendingApprovals).toEqual(live.pendingApprovals);
    expect(projected?.attention?.kind).toBe(live.attention?.kind);
    expect(projected?.events.map((event) => event.type)).toEqual(live.events.map((event) => event.type));
    expect(projected?.events).toHaveLength(live.events.length);
    expect(projectedApprovalResolvedEvents).toHaveLength(1);
    expect(projectedApprovalResolvedEvents[0]?.payload).toMatchObject({ actionId, mode: "resume" });
    expect(projectedApprovalResolvedEvents.some((event) =>
      event.payload &&
      typeof event.payload === "object" &&
      (event.payload as Record<string, unknown>).mode === "ledger_projection"
    )).toBe(false);
    expect(projectedToolCalledEvents).toHaveLength(1);
    expect(projectedToolCalledEvents.some((event) =>
      event.payload &&
      typeof event.payload === "object" &&
      (event.payload as Record<string, unknown>).source === "ledger_projection"
    )).toBe(false);
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
