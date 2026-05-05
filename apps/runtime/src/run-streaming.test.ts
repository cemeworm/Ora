import { describe, expect, it } from "vitest";
import type { OraEventEnvelope, StateSnapshot } from "@cemeworm/shared";
import { applyStreamingRunEvent, publishRunStream, shouldFlushStreamingEvent } from "./run-streaming.js";

function event(params: {
  seq: number;
  type: OraEventEnvelope["type"];
  payload?: unknown;
}): OraEventEnvelope {
  return {
    id: `run-test:evt-${params.seq}`,
    runId: "run-test",
    seq: params.seq,
    type: params.type,
    createdAt: 1_714_000_000_000 + params.seq,
    pattern: "orchestrator_subagent",
    payload: params.payload ?? {},
  } as OraEventEnvelope;
}

function snapshot(): StateSnapshot {
  return {
    runId: "run-test",
    turnIndex: 1,
    status: "running",
    pattern: "orchestrator_subagent",
    coordinationKind: "orchestrator_subagent",
    input: { prompt: "Stream this.", createdAt: 1_714_000_000_000, context: {} },
    config: {
      pattern: "orchestrator_subagent",
      modeSelection: "manual",
      profileIds: [],
      modelRef: "local/smoke-model",
      approvalMode: "high_risk_only",
      permissionMode: "default",
      patternOptions: {},
      metadata: {},
      deterministicSeed: "run-streaming-test",
      skillIds: [],
      toolIds: [],
    },
    topology: { nodes: [], edges: [] },
    profiles: [],
    memory: [],
    plan: [],
    planList: [],
    todos: [],
    actions: [],
    toolCalls: [],
    continuation: { frames: [] },
    conversation: [],
    toolResults: [],
    policyDecisions: [],
    checkpoints: [],
    events: [],
    agentMessages: [],
    artifacts: [],
    activeAgents: [],
    queueSummary: { mode: "dag", pending: 0, inProgress: 0, completed: 0, topics: [] },
    sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
    busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
    pendingClarifications: [],
    pendingApprovals: [],
    updatedAt: 1_714_000_000_000,
  } as unknown as StateSnapshot;
}

describe("run streaming", () => {
  it("throttles high-volume text delta flushes while preserving run status flushes", () => {
    expect(shouldFlushStreamingEvent(event({ seq: 8, type: "message.delta" }))).toBe(false);
    expect(shouldFlushStreamingEvent(event({ seq: 128, type: "message.delta" }))).toBe(true);
    expect(shouldFlushStreamingEvent(event({ seq: 16, type: "token.delta" }))).toBe(false);
    expect(shouldFlushStreamingEvent(event({ seq: 256, type: "token.delta" }))).toBe(true);
    expect(shouldFlushStreamingEvent(event({ seq: 9, type: "run.done" }))).toBe(true);
    expect(shouldFlushStreamingEvent(event({ seq: 16, type: "action.updated" }))).toBe(true);
  });

  it("keeps delta payloads as independent events without requiring cumulative content", () => {
    const first = applyStreamingRunEvent(snapshot(), event({
      seq: 0,
      type: "message.delta",
      payload: { role: "assistant", content: "Hel", delta: "Hel", streaming: true },
    }));
    const second = applyStreamingRunEvent(first, event({
      seq: 1,
      type: "message.delta",
      payload: { role: "assistant", content: "lo", delta: "lo", streaming: true },
    }));

    const text = second.events
      .filter((item: OraEventEnvelope) => item.type === "message.delta")
      .map((item: OraEventEnvelope) => (item.payload as { content?: string }).content ?? "")
      .join("");

    expect(text).toBe("Hello");
    expect(JSON.stringify(second.events).length).toBeLessThan(500);
  });

  it("projects structured runtime events into the live snapshot", () => {
    const planItem = {
      id: "run-test:plan-1",
      runId: "run-test",
      status: "running",
      title: "Investigate",
      dependencies: [],
      linkedActionIds: [],
      checkpointIds: [],
    } as const;
    const todoItem = {
      id: "run-test:plan-1:todo",
      runId: "run-test",
      sourcePlanItemId: planItem.id,
      status: "running",
      label: "Investigate",
      detail: "runtime-owned todo detail",
      createdAt: 1,
      updatedAt: 2,
    } as const;
    const topology = {
      nodes: [{ id: "agent", label: "Agent", kind: "agent", status: "running", metadata: {} }],
      edges: [],
    } as const;
    const artifact = {
      id: "run-test:artifact-1",
      runId: "run-test",
      kind: "report",
      label: "Report",
      mimeType: "text/plain",
      createdAt: 3,
    } as const;
    const clarification = {
      id: "clarification-1",
      nodeId: "agent",
      nodeLabel: "Agent",
      key: "scope",
      question: "Which scope?",
      options: [],
      requestedAt: 4,
    } as const;

    const withPlan = applyStreamingRunEvent(snapshot(), event({
      seq: 0,
      type: "plan.updated",
      payload: { items: [planItem] },
    }));
    const withTodo = applyStreamingRunEvent(withPlan, event({
      seq: 1,
      type: "todo.updated",
      payload: { items: [todoItem] },
    }));
    const withTopology = applyStreamingRunEvent(withTodo, event({
      seq: 2,
      type: "topology.updated",
      payload: topology,
    }));
    const withQueue = applyStreamingRunEvent(withTopology, event({
      seq: 3,
      type: "queue.updated",
      payload: { summary: { mode: "dag", pending: 1, inProgress: 1, completed: 0, topics: [] } },
    }));
    const withArtifact = applyStreamingRunEvent(withQueue, event({
      seq: 4,
      type: "artifact.exported",
      payload: { artifact },
    }));
    const withSharedState = applyStreamingRunEvent(withArtifact, event({
      seq: 5,
      type: "shared_state.updated",
      payload: { entry: { key: "finding", version: 1, summary: "Found drift.", updatedBy: "agent" } },
    }));
    const withClarification = applyStreamingRunEvent(withSharedState, event({
      seq: 6,
      type: "clarification.required",
      payload: { clarification, pending: 1 },
    }));
    const resolved = applyStreamingRunEvent(withClarification, event({
      seq: 7,
      type: "clarification.resolved",
      payload: { clarificationId: clarification.id, answer: "stream projector" },
    }));

    expect(withClarification.plan).toEqual([planItem]);
    expect(withClarification.todos).toEqual([todoItem]);
    expect(withClarification.topology).toEqual(topology);
    expect(withClarification.queueSummary.inProgress).toBe(1);
    expect(withClarification.artifacts).toEqual([artifact]);
    expect(withClarification.sharedStateSummary.entries).toHaveLength(1);
    expect(withClarification.pendingClarifications).toEqual([clarification]);
    expect(withClarification.attention?.kind).toBe("needs_clarification");
    expect(resolved.pendingClarifications).toEqual([]);
    expect(resolved.attention?.kind).toBe("running");
  });

  it("attaches normalized live snapshots to structured stream events but not text deltas", () => {
    const clarification = {
      id: "clarification-1",
      nodeId: "agent",
      nodeLabel: "Agent",
      key: "scope",
      question: "Which scope?",
      options: [],
      requestedAt: 4,
    } as const;
    const clarificationEvent = event({
      seq: 0,
      type: "clarification.required",
      payload: { clarification, pending: 1 },
    });
    const liveSnapshot = applyStreamingRunEvent(snapshot(), clarificationEvent);
    const streams: Parameters<NonNullable<Parameters<typeof publishRunStream>[0]["onStream"]>>[0][] = [];

    publishRunStream({
      onStream: (stream) => streams.push(stream),
      runId: "run-test",
      events: [clarificationEvent],
      liveSnapshot,
    });
    publishRunStream({
      onStream: (stream) => streams.push(stream),
      runId: "run-test",
      events: [event({
        seq: 1,
        type: "message.delta",
        payload: { role: "assistant", content: "hello", delta: "hello", streaming: true },
      })],
      liveSnapshot,
    });

    expect(streams[0]?.snapshot?.attention?.kind).toBe("needs_clarification");
    expect(streams[0]?.snapshot?.pendingClarifications).toEqual([clarification]);
    expect(streams[1]?.snapshot).toBeUndefined();
  });
});
