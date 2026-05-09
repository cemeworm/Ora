import { describe, expect, it } from "vitest";
import { buildChatMessagesCacheKey } from "./chatMessageCache";
import type {
  OraSessionTranscriptMessage,
  OraStateSnapshot,
} from "./runtimeClient";

describe("chat message cache key", () => {
  it("changes when the same turn receives additional streaming output", () => {
    const transcript = [transcriptMessage("run-stream")];
    const firstSnapshot = snapshotWithEvents("run-stream", [
      messageDelta("run-stream", 0, "你"),
    ]);
    const nextSnapshot = snapshotWithEvents("run-stream", [
      messageDelta("run-stream", 0, "你"),
      messageDelta("run-stream", 1, "你好"),
    ]);

    const firstKey = buildChatMessagesCacheKey({
      transcript,
      turnSnapshots: { "run-stream": firstSnapshot },
    });
    const nextKey = buildChatMessagesCacheKey({
      transcript,
      turnSnapshots: { "run-stream": nextSnapshot },
    });

    expect(nextKey).not.toBe(firstKey);
  });

  it("changes when a final output replaces the latest event without changing run ids", () => {
    const transcript = [transcriptMessage("run-final")];
    const runningSnapshot = snapshotWithEvents("run-final", [
      messageDelta("run-final", 0, "开头"),
    ]);
    const finalSnapshot = {
      ...runningSnapshot,
      status: "succeeded",
      output: { text: "开头和完整结尾" },
      updatedAt: runningSnapshot.updatedAt + 1,
    } as OraStateSnapshot;

    const runningKey = buildChatMessagesCacheKey({
      transcript,
      turnSnapshots: { "run-final": runningSnapshot },
    });
    const finalKey = buildChatMessagesCacheKey({
      transcript,
      turnSnapshots: { "run-final": finalSnapshot },
    });

    expect(finalKey).not.toBe(runningKey);
  });
});

function transcriptMessage(runId: string): OraSessionTranscriptMessage {
  return {
    id: `${runId}:user`,
    sessionId: "session-cache",
    runId,
    turnIndex: 1,
    role: "user",
    content: "你是谁？",
    pattern: "orchestrator_subagent",
    createdAt: 1_714_000_000_000,
  } as OraSessionTranscriptMessage;
}

function snapshotWithEvents(
  runId: string,
  events: OraStateSnapshot["events"],
): OraStateSnapshot {
  return {
    runId,
    sessionId: "session-cache",
    turnIndex: 1,
    status: "running",
    pattern: "orchestrator_subagent",
    input: { prompt: "你是谁？", createdAt: 1_714_000_000_000, context: {} },
    config: {
      modeId: "single_agent",
      pattern: "orchestrator_subagent",
      modeSelection: "manual",
      profileIds: ["solo_agent"],
      providerId: "local-smoke",
      modelRef: "local/smoke-model",
      approvalMode: "high_risk_only",
      patternOptions: {},
      metadata: {},
      deterministicSeed: "chat-message-cache-test",
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
    toolResults: [],
    policyDecisions: [],
    checkpoints: [],
    events,
    agentMessages: [],
    artifacts: [],
    activeAgents: [],
    queueSummary: { mode: "backlog", pending: 0, inProgress: 1, completed: 0, topics: [] },
    sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
    busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
    pendingClarifications: [],
    pendingApprovals: [],
    updatedAt: 1_714_000_000_000 + events.length,
  } as unknown as OraStateSnapshot;
}

function messageDelta(
  runId: string,
  seq: number,
  content: string,
): OraStateSnapshot["events"][number] {
  return {
    id: `${runId}:event:${seq}`,
    runId,
    seq,
    type: "message.delta",
    createdAt: 1_714_000_000_000 + seq,
    payload: { role: "assistant", content, streaming: true },
  } as OraStateSnapshot["events"][number];
}
