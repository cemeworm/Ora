import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { OraEventEnvelope, RuntimeSessionEntry, StateSnapshot } from "@cemeworm/shared";
import { deriveSessionProjection } from "@cemeworm/shared";
import { JsonFileRuntimePersistenceBackend } from "./persistence/json-file-backend.js";
import { SqliteRuntimePersistence } from "./persistence/sqlite-backend.js";
import { compactStreamingDeltaPayloads, runRuntimeMaintenance } from "./run-maintenance.js";

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

  it("marks stale ledger-projected running runs as failed", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ora-run-maintenance-"));
    const backend = new JsonFileRuntimePersistenceBackend(tempDir);
    const entries: RuntimeSessionEntry[] = [
      {
        id: "session",
        sessionId: "session-stale",
        turnIndex: 0,
        seq: 0,
        type: "session.created",
        createdAt: 1_714_000_000_000,
        payload: { title: "Stale" },
      },
      {
        id: "user",
        sessionId: "session-stale",
        parentId: "session",
        runId: "run-stale",
        turnIndex: 1,
        seq: 1,
        type: "user.message",
        createdAt: 1_714_000_000_001,
        payload: { content: "Hang." },
      },
      {
        id: "started",
        sessionId: "session-stale",
        parentId: "user",
        runId: "run-stale",
        turnIndex: 1,
        seq: 2,
        type: "run.started",
        createdAt: 1_714_000_000_002,
        payload: {
          input: { prompt: "Hang.", createdAt: 1_714_000_000_001, context: {} },
          config: snapshot([]).config,
        },
      },
    ];
    backend.appendSessionEntries("session-stale", entries, "started");

    const result = runRuntimeMaintenance(
      { compactStreamingEvents: false, vacuum: false, staleRunningMs: 1000 },
      {
        runs: new Map(),
        backend,
        now: () => 1_714_000_005_000,
      },
    );
    const projection = deriveSessionProjection(backend.getSessionLedger("session-stale")!);

    expect(result.staleRunsFailed).toBe(1);
    expect(projection.runs[0]).toMatchObject({
      runId: "run-stale",
      status: "failed",
      error: "Run marked failed by runtime maintenance after 1000ms without progress.",
    });
    expect(projection.runs[0]?.events.at(-1)).toMatchObject({ type: "run.failed" });

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("compacts duplicated runtime event batch snapshots in SQLite maintenance", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ora-run-maintenance-sqlite-"));
    const backend = new SqliteRuntimePersistence(path.join(tempDir, "runtime.db"));
    const runSnapshot = {
      ...snapshot([]),
      runId: "run-sqlite-compact",
      sessionId: "session-sqlite-compact",
      output: { text: "done" },
    };
    const entries: RuntimeSessionEntry[] = [
      {
        id: "session",
        sessionId: "session-sqlite-compact",
        turnIndex: 0,
        seq: 0,
        type: "session.created",
        createdAt: 1_714_000_000_000,
        payload: { title: "SQLite Compact" },
      },
      {
        id: "started",
        sessionId: "session-sqlite-compact",
        parentId: "session",
        runId: "run-sqlite-compact",
        turnIndex: 1,
        seq: 1,
        type: "run.started",
        createdAt: 1_714_000_000_001,
        payload: {
          input: runSnapshot.input,
          config: runSnapshot.config,
          status: "running",
        },
      },
      {
        id: "run-sqlite-compact:events-0-0",
        sessionId: "session-sqlite-compact",
        parentId: "started",
        runId: "run-sqlite-compact",
        turnIndex: 1,
        seq: 2,
        type: "runtime.event_batch",
        createdAt: 1_714_000_000_002,
        payload: {
          events: [{
            id: "run-sqlite-compact:evt-0",
            runId: "run-sqlite-compact",
            seq: 0,
            type: "run.done",
            createdAt: 1_714_000_000_002,
            payload: { status: "succeeded", output: { text: "done" } },
          }],
          eventCount: 1,
          status: "succeeded",
          output: { text: "duplicated" },
          snapshot: runSnapshot,
        },
      },
    ];
    backend.appendSessionEntries("session-sqlite-compact", entries, "run-sqlite-compact:events-0-0");

    const result = runRuntimeMaintenance(
      { compactStreamingEvents: false, compactRuntimeEventBatchSnapshots: true, vacuum: false },
      { runs: new Map(), backend, now: () => 1_714_000_000_003 },
    );
    const ledger = backend.getSessionLedger("session-sqlite-compact")!;
    const eventBatchPayload = ledger.entries.find((entry) => entry.id === "run-sqlite-compact:events-0-0")?.payload as {
      snapshot?: unknown;
      output?: unknown;
    };
    const projection = deriveSessionProjection(ledger);

    expect(result.eventBatchSnapshotsCompacted).toBe(1);
    expect(result.eventBatchSnapshotBytesBefore).toBeGreaterThan(0);
    expect(result.eventBatchSnapshotBytesAfter).toBe(0);
    expect(result.eventBatchOutputBytesAfter).toBe(result.eventBatchOutputBytesBefore);
    expect(eventBatchPayload.snapshot).toBeUndefined();
    expect(eventBatchPayload.output).toEqual({ text: "duplicated" });
    expect(projection.runs[0]?.status).toBe("succeeded");
    expect(projection.runs[0]?.output).toEqual({ text: "done" });

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("does not compact runtime event batch snapshots unless explicitly requested", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ora-run-maintenance-sqlite-default-"));
    const backend = new SqliteRuntimePersistence(path.join(tempDir, "runtime.db"));
    const runSnapshot = {
      ...snapshot([]),
      runId: "run-sqlite-default",
      sessionId: "session-sqlite-default",
    };
    backend.appendSessionEntries("session-sqlite-default", [
      {
        id: "session",
        sessionId: "session-sqlite-default",
        turnIndex: 0,
        seq: 0,
        type: "session.created",
        createdAt: 1_714_000_000_000,
        payload: { title: "SQLite Default" },
      },
      {
        id: "started",
        sessionId: "session-sqlite-default",
        parentId: "session",
        runId: "run-sqlite-default",
        turnIndex: 1,
        seq: 1,
        type: "run.started",
        createdAt: 1_714_000_000_001,
        payload: {
          input: runSnapshot.input,
          config: runSnapshot.config,
          status: "running",
        },
      },
      {
        id: "run-sqlite-default:events-0-0",
        sessionId: "session-sqlite-default",
        parentId: "started",
        runId: "run-sqlite-default",
        turnIndex: 1,
        seq: 2,
        type: "runtime.event_batch",
        createdAt: 1_714_000_000_002,
        payload: {
          events: [],
          eventCount: 0,
          status: "running",
          snapshot: runSnapshot,
        },
      },
    ], "run-sqlite-default:events-0-0");

    const result = runRuntimeMaintenance(
      { compactStreamingEvents: false, vacuum: false },
      { runs: new Map(), backend, now: () => 1_714_000_000_003 },
    );
    const eventBatchPayload = backend.getSessionLedger("session-sqlite-default")!
      .entries.find((entry) => entry.id === "run-sqlite-default:events-0-0")?.payload as { snapshot?: unknown };

    expect(result.compactRuntimeEventBatchSnapshots).toBe(false);
    expect(result.eventBatchSnapshotsCompacted).toBe(0);
    expect(eventBatchPayload.snapshot).toBeDefined();

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("leaves low-frequency snapshot update batches intact during compaction", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ora-run-maintenance-sqlite-update-"));
    const backend = new SqliteRuntimePersistence(path.join(tempDir, "runtime.db"));
    const runSnapshot = {
      ...snapshot([]),
      runId: "run-sqlite-update",
      sessionId: "session-sqlite-update",
    };
    backend.appendSessionEntries("session-sqlite-update", [
      {
        id: "session",
        sessionId: "session-sqlite-update",
        turnIndex: 0,
        seq: 0,
        type: "session.created",
        createdAt: 1_714_000_000_000,
        payload: { title: "SQLite Update" },
      },
      {
        id: "started",
        sessionId: "session-sqlite-update",
        parentId: "session",
        runId: "run-sqlite-update",
        turnIndex: 1,
        seq: 1,
        type: "run.started",
        createdAt: 1_714_000_000_001,
        payload: {
          input: runSnapshot.input,
          config: runSnapshot.config,
          status: "running",
        },
      },
      {
        id: "run-sqlite-update:update-1714000000002-0",
        sessionId: "session-sqlite-update",
        parentId: "started",
        runId: "run-sqlite-update",
        turnIndex: 1,
        seq: 2,
        type: "runtime.event_batch",
        createdAt: 1_714_000_000_002,
        payload: {
          events: [],
          eventCount: 0,
          status: "running",
          snapshot: runSnapshot,
        },
      },
    ], "run-sqlite-update:update-1714000000002-0");

    const result = runRuntimeMaintenance(
      { compactStreamingEvents: false, compactRuntimeEventBatchSnapshots: true, vacuum: false },
      { runs: new Map(), backend, now: () => 1_714_000_000_003 },
    );
    const eventBatchPayload = backend.getSessionLedger("session-sqlite-update")!
      .entries.find((entry) => entry.id === "run-sqlite-update:update-1714000000002-0")?.payload as { snapshot?: unknown };

    expect(result.eventBatchSnapshotsCompacted).toBe(0);
    expect(eventBatchPayload.snapshot).toBeDefined();

    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});
