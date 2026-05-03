import { describe, expect, it } from "vitest";
import type { OraEventEnvelope, StateSnapshot } from "@cemeworm/shared";
import { compactStreamingDeltaPayloads } from "./run-maintenance.js";

function snapshot(events: OraEventEnvelope[]): StateSnapshot {
  return {
    runId: "run-maintenance",
    turnIndex: 1,
    status: "succeeded",
    pattern: "orchestrator_subagent",
    coordinationKind: "orchestrator_subagent",
    input: { prompt: "Maintain this.", createdAt: 1_714_000_000_000, context: {} },
    config: {
      pattern: "orchestrator_subagent",
      modeSelection: "manual",
      profileIds: [],
      modelRef: "local/smoke-model",
      approvalMode: "high_risk_only",
      permissionMode: "default",
      patternOptions: {},
      metadata: {},
      deterministicSeed: "run-maintenance-test",
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
    events,
    agentMessages: [],
    artifacts: [],
    activeAgents: [],
    queueSummary: { mode: "dag", pending: 0, inProgress: 0, completed: 0, topics: [] },
    sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
    busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
    pendingClarifications: [],
    pendingApprovals: [],
    updatedAt: 1_714_000_000_001,
  } as unknown as StateSnapshot;
}

function messageDelta(content: string, delta: string, seq: number): OraEventEnvelope {
  return {
    id: `run-maintenance:evt-${seq}`,
    runId: "run-maintenance",
    seq,
    type: "message.delta",
    createdAt: 1_714_000_000_000 + seq,
    payload: {
      role: "assistant",
      content,
      delta,
      streaming: true,
      raw: { large: content.repeat(4) },
    },
  } as OraEventEnvelope;
}

describe("run maintenance", () => {
  it("compacts legacy cumulative streaming deltas and removes raw payloads", () => {
    const result = compactStreamingDeltaPayloads(snapshot([
      messageDelta("Hello", "Hello", 0),
      messageDelta("Hello world", " world", 1),
    ]));

    expect(result.changed).toBe(true);
    expect(result.messageDeltaEventsCompacted).toBe(1);
    expect(result.rawPayloadsRemoved).toBe(2);
    expect(result.bytesAfter).toBeLessThan(result.bytesBefore);
    expect((result.snapshot.events[0]?.payload as { content?: string; raw?: unknown }).content).toBe("Hello");
    expect((result.snapshot.events[0]?.payload as { raw?: unknown }).raw).toBeUndefined();
    expect((result.snapshot.events[1]?.payload as { content?: string }).content).toBe(" world");
  });
});
