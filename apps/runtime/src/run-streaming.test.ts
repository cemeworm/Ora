import { describe, expect, it } from "vitest";
import type { OraEventEnvelope, StateSnapshot } from "@cemeworm/shared";
import { applyStreamingRunEvent, shouldFlushStreamingEvent } from "./run-streaming.js";

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
});
