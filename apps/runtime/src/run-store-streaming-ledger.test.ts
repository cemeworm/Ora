import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { StateSnapshotSchema, type OraEventEnvelope, type StateSnapshot } from "@cemeworm/shared";
import { LocalRunStore } from "./run-store.js";

function snapshot(runId: string, sessionId: string): StateSnapshot {
  return {
    runId,
    sessionId,
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
      deterministicSeed: "run-store-streaming-ledger-test",
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
    queueSummary: { mode: "dag", pending: 0, inProgress: 1, completed: 0, topics: [] },
    sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
    busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
    pendingClarifications: [],
    pendingApprovals: [],
    updatedAt: 1_714_000_000_001,
  } as unknown as StateSnapshot;
}

function event(runId: string, seq: number, type: OraEventEnvelope["type"]): OraEventEnvelope {
  return {
    id: `${runId}:evt-${seq}`,
    runId,
    seq,
    type,
    createdAt: 1_714_000_000_100 + seq,
    pattern: "orchestrator_subagent",
    payload: type === "message.delta"
      ? { role: "assistant", content: "x", delta: "x", streaming: true }
      : { status: "succeeded", output: { text: "done" } },
  } as OraEventEnvelope;
}

function storeWithLedgerSession() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ora-run-store-streaming-ledger-"));
  const store = new LocalRunStore({ dataDir, autoStartChannels: false });
  const session = store.createSession({});
  const runId = "run-streaming-ledger-hot-path";
  const base = store.persistExternalSnapshot(snapshot(runId, session.sessionId));
  return { store, sessionId: session.sessionId, runId, base };
}

describe("run store streaming ledger hot path", () => {
  it("does not full-parse the growing snapshot when appendEvent handles pure deltas", () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ora-run-store-append-delta-"));
    const store = new LocalRunStore({ dataDir, autoStartChannels: false });
    const base = snapshot("run-append-delta", "session-append-delta");
    const parseSpy = vi.spyOn(StateSnapshotSchema, "parse");

    const next = (store as unknown as {
      appendEvent: (
        snapshot: StateSnapshot,
        type: OraEventEnvelope["type"],
        payload: unknown,
        extra?: Partial<OraEventEnvelope>,
      ) => StateSnapshot;
    }).appendEvent(base, "message.delta", {
      role: "assistant",
      content: "x",
      delta: "x",
      streaming: true,
    });

    expect(next.events).toHaveLength(1);
    expect(next.events[0]?.type).toBe("message.delta");
    expect(parseSpy).not.toHaveBeenCalled();
    parseSpy.mockRestore();
  });

  it("bypasses full session projection replay for running pure-delta event batches", () => {
    const { store, sessionId, runId, base } = storeWithLedgerSession();
    const refreshSpy = vi.spyOn(store as unknown as { refreshSessionFromLedger: (...args: unknown[]) => unknown }, "refreshSessionFromLedger");
    const delta = event(runId, base.events.length, "message.delta");
    const liveSnapshot = {
      ...base,
      status: "running" as const,
      events: [...base.events, delta],
      updatedAt: delta.createdAt,
    };

    const projected = (store as unknown as {
      appendRuntimeEventBatchToLedger: (
        snapshot: StateSnapshot,
        events: OraEventEnvelope[],
        status?: StateSnapshot["status"],
      ) => StateSnapshot;
    }).appendRuntimeEventBatchToLedger(liveSnapshot, [delta], "running");

    expect(projected).toBe(liveSnapshot);
    expect(refreshSpy).not.toHaveBeenCalled();
    expect((store as unknown as { runs: Map<string, StateSnapshot> }).runs.get(runId)).toBe(liveSnapshot);
    expect(store.getSession({ sessionId }).session.latestRunId).toBe(runId);
    const ledger = (store as unknown as { backend: { getSessionLedger: (id: string) => { entries: Array<{ type: string }> } | undefined } }).backend.getSessionLedger(sessionId);
    expect(ledger?.entries.at(-1)?.type).toBe("runtime.event_batch");
  });

  it("keeps terminal event batches on the full projection path", () => {
    const { store, runId, base } = storeWithLedgerSession();
    const refreshSpy = vi.spyOn(store as unknown as { refreshSessionFromLedger: (...args: unknown[]) => unknown }, "refreshSessionFromLedger");
    const done = event(runId, base.events.length, "run.done");
    const liveSnapshot = {
      ...base,
      status: "succeeded" as const,
      output: { text: "done" },
      events: [...base.events, done],
      updatedAt: done.createdAt,
    };

    const projected = (store as unknown as {
      appendRuntimeEventBatchToLedger: (
        snapshot: StateSnapshot,
        events: OraEventEnvelope[],
        status?: StateSnapshot["status"],
      ) => StateSnapshot;
    }).appendRuntimeEventBatchToLedger(liveSnapshot, [done], "succeeded");

    expect(projected.status).toBe("succeeded");
    expect(refreshSpy).toHaveBeenCalled();
  });
});
