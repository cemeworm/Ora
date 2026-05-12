import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  RuntimeSessionLedgerSchema,
  StateSnapshotSchema,
  deriveRunSnapshot,
  type OraEventEnvelope,
  type StateSnapshot,
} from "@cemeworm/shared";
import { LocalRunStore } from "../src/index.js";
import { shouldFlushStreamingEvent } from "../src/run-streaming.js";
import type { RuntimeGateResolution } from "../src/runtime-gate-service.js";

const BASE_TIME = 1_714_000_000_000;

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ora-runtime-projection-parity-"));
}

function createStore(dataDir = tempDir()): LocalRunStore {
  return new LocalRunStore({ dataDir, clock: () => BASE_TIME + 100 });
}

function runConfig(metadata: Record<string, unknown> = {}) {
  return {
    pattern: "orchestrator_subagent" as const,
    modeId: "single_agent",
    modeSelection: "manual" as const,
    profileIds: [],
    modelRef: "local/smoke-model",
    approvalMode: "high_risk_only" as const,
    permissionMode: "default" as const,
    patternOptions: {},
    metadata,
    deterministicSeed: "runtime-projection-parity-test",
    skillIds: [],
    toolIds: [],
  };
}

function event(
  runId: string,
  seq: number,
  type: OraEventEnvelope["type"],
  payload: unknown = {},
): OraEventEnvelope {
  return {
    id: `${runId}:evt-${seq}`,
    runId,
    seq,
    type,
    createdAt: BASE_TIME + seq,
    pattern: "orchestrator_subagent",
    payload,
  };
}

function snapshot(patch: Partial<StateSnapshot> & Pick<StateSnapshot, "runId" | "sessionId">): StateSnapshot {
  return StateSnapshotSchema.parse({
    runId: patch.runId,
    sessionId: patch.sessionId,
    turnIndex: 1,
    status: "running",
    pattern: "orchestrator_subagent",
    coordinationKind: "orchestrator_subagent",
    modeId: "single_agent",
    input: { prompt: "Check projection parity.", createdAt: BASE_TIME, context: {} },
    config: runConfig(),
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
    updatedAt: BASE_TIME,
    ...patch,
  });
}

function expectParity(projected: StateSnapshot, live: StateSnapshot): void {
  expect(projected.status).toBe(live.status);
  expect(projected.pendingClarifications).toEqual(live.pendingClarifications);
  expect(projected.pendingApprovals).toEqual(live.pendingApprovals);
  expect(projected.attention?.kind).toBe(live.attention?.kind);
  expect(projected.actions.map((action) => [action.id, action.status])).toEqual(
    live.actions.map((action) => [action.id, action.status]),
  );
  expect(projected.events.map((item) => item.type)).toEqual(live.events.map((item) => item.type));
}

function expectFinalSnapshotParity(projected: StateSnapshot, live: StateSnapshot): void {
  expect(projected.status).toBe(live.status);
  expect(projected.output).toEqual(live.output);
  expect(projected.events).toEqual(live.events);
  expect(projected.checkpoints).toEqual(live.checkpoints);
  expect(projected.plan).toEqual(live.plan);
  expect(projected.planList).toEqual(live.planList);
  expect(projected.todos).toEqual(live.todos);
  expect(projected.actions).toEqual(live.actions);
  expect(projected.toolCalls).toEqual(live.toolCalls);
  expect(projected.agentMessages).toEqual(live.agentMessages);
  expect(projected.artifacts).toEqual(live.artifacts);
  expect(projected.activeAgents).toEqual(live.activeAgents);
  expect(projected.queueSummary).toEqual(live.queueSummary);
  expect(projected.sharedStateSummary).toEqual(live.sharedStateSummary);
  expect(projected.busStats).toEqual(live.busStats);
  expect(projected.pendingClarifications).toEqual(live.pendingClarifications);
  expect(projected.pendingApprovals).toEqual(live.pendingApprovals);
  expect(projected.continuation).toEqual(live.continuation);
  expect(projected.topology).toEqual(live.topology);
  expect(projected.conversation).toEqual(live.conversation);
  expect(projected.toolResults).toEqual(live.toolResults);
  expect(projected.policyDecisions).toEqual(live.policyDecisions);
  expect(projected.memory).toEqual(live.memory);
  expect(projected.attention).toEqual(live.attention);
}

describe("runtime projection parity guards", () => {
  it("keeps completed final snapshots in parity across live state, stream snapshot, cold reload, and ledger projection", async () => {
    const dataDir = tempDir();
    const store = createStore(dataDir);
    const handle = await store.startRun({
      input: { prompt: "Produce final snapshot parity evidence." },
      config: runConfig(),
    });
    const live = StateSnapshotSchema.parse(store.getRunState({ runId: handle.runId }));
    const stream = store.streamRun({ runId: handle.runId });
    const ledger = RuntimeSessionLedgerSchema.parse(
      (store as unknown as { backend: { getSessionLedger(sessionId: string): unknown } }).backend.getSessionLedger(live.sessionId),
    );
    const projected = deriveRunSnapshot(ledger, handle.runId);

    expect(projected).toBeDefined();
    expect(stream.snapshot).toEqual(live);
    expectFinalSnapshotParity(projected!, live);
    expect(live.checkpoints.length).toBeGreaterThan(0);
    expect(live.events.some((event) =>
      event.type === "node.updated" &&
      event.payload &&
      typeof event.payload === "object" &&
      typeof (event.payload as { checkpoint?: unknown }).checkpoint === "object"
    )).toBe(true);

    const reloaded = createStore(dataDir);
    const coldLive = StateSnapshotSchema.parse(reloaded.getRunState({ runId: handle.runId }));
    const coldLedger = RuntimeSessionLedgerSchema.parse(
      (reloaded as unknown as { backend: { getSessionLedger(sessionId: string): unknown } }).backend.getSessionLedger(live.sessionId),
    );
    const coldProjected = deriveRunSnapshot(coldLedger, handle.runId);

    expect(coldProjected).toBeDefined();
    expectFinalSnapshotParity(coldProjected!, coldLive);
    expectFinalSnapshotParity(coldLive, live);

    const replay = reloaded.replayRun({ runId: handle.runId });
    const replayedLive = StateSnapshotSchema.parse(reloaded.getRunState({ runId: handle.runId }));
    const replayedLedger = RuntimeSessionLedgerSchema.parse(
      (reloaded as unknown as { backend: { getSessionLedger(sessionId: string): unknown } }).backend.getSessionLedger(live.sessionId),
    );
    const replayedProjected = deriveRunSnapshot(replayedLedger, handle.runId);

    expect(replay.events).toEqual(live.events.slice(0, live.checkpoints.at(-1)!.eventSeq + 1));
    expect(replayedProjected).toBeDefined();
    expect(replayedLive.events.at(-1)?.type).toBe("run.replayed");
    expectFinalSnapshotParity(replayedProjected!, replayedLive);
  });

  it("persists runtime event batches without duplicating cumulative snapshot events", () => {
    const store = createStore();
    const session = store.createSession({}) as { sessionId: string };
    const runId = "run-compact-ledger";
    const first = event(runId, 0, "message.delta", { role: "assistant", delta: "hello" });
    const second = event(runId, 1, "run.done", { status: "succeeded", output: { text: "hello" } });
    const live = snapshot({
      runId,
      sessionId: session.sessionId,
      status: "succeeded",
      events: [first, second],
      output: { text: "hello" },
      updatedAt: second.createdAt,
    });

    (store as unknown as {
      appendRunStartedToLedger(args: {
        sessionId: string;
        runId: string;
        turnIndex: number;
        input: StateSnapshot["input"];
        config: StateSnapshot["config"];
        modeId?: string;
        createdAt?: number;
      }): void;
      appendRuntimeEventBatchToLedger(
        snapshot: StateSnapshot,
        events: OraEventEnvelope[],
        status?: StateSnapshot["status"],
      ): StateSnapshot;
    }).appendRunStartedToLedger({
      sessionId: session.sessionId,
      runId,
      turnIndex: 1,
      input: live.input,
      config: live.config,
      modeId: live.modeId,
      createdAt: live.input.createdAt,
    });
    (store as unknown as {
      appendRuntimeEventBatchToLedger(
        snapshot: StateSnapshot,
        events: OraEventEnvelope[],
        status?: StateSnapshot["status"],
      ): StateSnapshot;
    }).appendRuntimeEventBatchToLedger(live, live.events, live.status);

    const ledger = RuntimeSessionLedgerSchema.parse(
      (store as unknown as { backend: { getSessionLedger(sessionId: string): unknown } }).backend.getSessionLedger(session.sessionId),
    );
    const eventBatch = ledger.entries.find((entry) => entry.type === "runtime.event_batch");
    const payload = eventBatch?.payload as { events?: unknown[]; snapshot?: unknown; output?: unknown };
    const projected = deriveRunSnapshot(ledger, runId);

    expect(payload.events).toHaveLength(2);
    expect(payload.snapshot).toBeUndefined();
    expect(payload.output).toEqual({ text: "hello" });
    expect(projected?.events).toEqual(live.events);
    expect(projected?.status).toBe("succeeded");
    expect(projected?.output).toEqual({ text: "hello" });
  });

  it("keeps streaming resume gate snapshots in parity with the ledger projection", () => {
    const store = createStore();
    const session = store.createSession({}) as { sessionId: string };
    const runId = "run-resume-parity";
    const actionId = `${runId}:action-write`;
    const approvalRequired = event(runId, 0, "approval.required", { actionId });
    const approvalResolved = event(runId, 1, "approval.resolved", {
      actionId,
      decision: "approved",
      mode: "resume",
    });
    const runDone = event(runId, 2, "run.done", { status: "succeeded", output: { text: "Resumed." } });
    const interrupted = snapshot({
      runId,
      sessionId: session.sessionId,
      status: "interrupted",
      actions: [{
        id: actionId,
        runId,
        type: "file.write",
        riskLevel: "high",
        status: "approval_required",
        input: { path: "notes.md" },
        artifactIds: [],
      }],
      pendingApprovals: [actionId],
      events: [approvalRequired],
      updatedAt: approvalRequired.createdAt,
    });

    (store as unknown as {
      appendRunStartedToLedger(args: {
        sessionId: string;
        runId: string;
        turnIndex: number;
        input: StateSnapshot["input"];
        config: StateSnapshot["config"];
        modeId?: string;
        createdAt?: number;
      }): void;
      appendRunSnapshotUpdateToLedger(snapshot: StateSnapshot): StateSnapshot;
      appendGateResolutionsForResume(
        snapshot: StateSnapshot,
        gateResolutions: RuntimeGateResolution[],
      ): void;
    }).appendRunStartedToLedger({
      sessionId: session.sessionId,
      runId,
      turnIndex: 1,
      input: interrupted.input,
      config: interrupted.config,
      modeId: interrupted.modeId,
      createdAt: interrupted.input.createdAt,
    });
    const projectedInterrupted = (store as unknown as {
      appendRunSnapshotUpdateToLedger(snapshot: StateSnapshot): StateSnapshot;
    }).appendRunSnapshotUpdateToLedger(interrupted);
    (store as unknown as {
      appendGateResolutionsForResume(
        snapshot: StateSnapshot,
        gateResolutions: RuntimeGateResolution[],
      ): void;
    }).appendGateResolutionsForResume(projectedInterrupted, [{ kind: "approval", actionId }]);

    const liveFinal = StateSnapshotSchema.parse({
      ...projectedInterrupted,
      status: "succeeded",
      actions: projectedInterrupted.actions.map((action) =>
        action.id === actionId ? { ...action, status: "succeeded" as const } : action
      ),
      pendingApprovals: [],
      events: [approvalRequired, approvalResolved, runDone],
      output: { text: "Resumed." },
      updatedAt: runDone.createdAt,
    });
    const projectedFinal = (store as unknown as {
      appendRunSnapshotUpdateToLedger(snapshot: StateSnapshot): StateSnapshot;
    }).appendRunSnapshotUpdateToLedger(liveFinal);
    const state = StateSnapshotSchema.parse(store.getRunState({ runId }));
    const stream = store.streamRun({ runId });
    const ledger = RuntimeSessionLedgerSchema.parse(
      (store as unknown as { backend: { getSessionLedger(sessionId: string): unknown } }).backend.getSessionLedger(session.sessionId),
    );
    const fromLedger = deriveRunSnapshot(ledger, runId);

    expectParity(state, projectedFinal);
    expectParity(fromLedger!, projectedFinal);
    expect(stream.snapshot).toEqual(state);
  });

  it("rebases active reads over ledger projection with unflushed event tails", () => {
    const store = createStore();
    const session = store.createSession({}) as { sessionId: string };
    const runId = "run-active-tail";
    const ledgered = event(runId, 0, "message.delta", { role: "assistant", content: "working" });
    const tail = event(runId, 1, "message.delta", { role: "assistant", content: "still working" });
    const ledgeredSnapshot = snapshot({
      runId,
      sessionId: session.sessionId,
      status: "running",
      events: [ledgered],
      updatedAt: ledgered.createdAt,
    });
    const activeSnapshot = StateSnapshotSchema.parse({
      ...ledgeredSnapshot,
      events: [ledgered, tail],
      updatedAt: tail.createdAt,
    });

    (store as unknown as {
      appendRunStartedToLedger(args: {
        sessionId: string;
        runId: string;
        turnIndex: number;
        input: StateSnapshot["input"];
        config: StateSnapshot["config"];
        modeId?: string;
        createdAt?: number;
      }): void;
      appendRuntimeEventBatchToLedger(
        snapshot: StateSnapshot,
        events: OraEventEnvelope[],
        status?: StateSnapshot["status"],
      ): StateSnapshot;
      runs: Map<string, StateSnapshot>;
    }).appendRunStartedToLedger({
      sessionId: session.sessionId,
      runId,
      turnIndex: 1,
      input: ledgeredSnapshot.input,
      config: ledgeredSnapshot.config,
      modeId: ledgeredSnapshot.modeId,
      createdAt: ledgeredSnapshot.input.createdAt,
    });
    (store as unknown as {
      appendRuntimeEventBatchToLedger(
        snapshot: StateSnapshot,
        events: OraEventEnvelope[],
        status?: StateSnapshot["status"],
      ): StateSnapshot;
    }).appendRuntimeEventBatchToLedger(ledgeredSnapshot, [ledgered], ledgeredSnapshot.status);
    (store as unknown as { runs: Map<string, StateSnapshot> }).runs.set(runId, activeSnapshot);

    const state = StateSnapshotSchema.parse(store.getRunState({ runId }));
    const stream = store.streamRun({ runId });

    expect(state.events.map((item) => item.id)).toEqual([ledgered.id, tail.id]);
    expect(stream.events.map((item) => item.id)).toEqual([ledgered.id, tail.id]);
  });

  it("flushes durable state boundary events before crash-sensitive streaming gaps", () => {
    expect(shouldFlushStreamingEvent(event("run-flush", 1, "approval.required", { actionId: "a1" }))).toBe(true);
    expect(shouldFlushStreamingEvent(event("run-flush", 1, "checkpoint.created", { checkpointId: "c1" }))).toBe(true);
    expect(shouldFlushStreamingEvent(event("run-flush", 1, "node.updated", { nodeId: "n1" }))).toBe(true);
    expect(shouldFlushStreamingEvent(event("run-flush", 1, "message.delta", { content: "token" }))).toBe(false);
  });

  it("replays a hidden candidate branch from the ledger after reload", () => {
    const dataDir = tempDir();
    const store = createStore(dataDir);
    const session = store.createSession({}) as { sessionId: string };
    const runId = "run-candidate-parity";
    const checkpoint = {
      id: `${runId}:checkpoint-0`,
      runId,
      label: "Candidate checkpoint",
      createdAt: BASE_TIME + 1,
      eventSeq: 0,
    };
    const checkpointEvent = event(runId, 0, "checkpoint.created", {
      checkpointId: checkpoint.id,
      label: checkpoint.label,
    });
    const candidate = snapshot({
      runId,
      sessionId: session.sessionId,
      status: "succeeded",
      config: runConfig({ branchRole: "candidate", branchGroupId: "branch-parity" }),
      checkpoints: [checkpoint],
      events: [checkpointEvent],
      output: { text: "Candidate result." },
      updatedAt: BASE_TIME + 1,
    });
    const group = {
      branchGroupId: "branch-parity",
      sessionId: session.sessionId,
      target: "empty_start" as const,
      baseTurnIndex: 0,
      prompt: "Try a candidate.",
      status: "running" as const,
      candidateRunIds: [runId],
      candidates: [],
      createdAt: BASE_TIME,
      updatedAt: BASE_TIME,
    };
    (store as unknown as {
      appendSessionLedgerEntry(sessionId: string, entry: Record<string, unknown>): void;
      appendRunStartedToLedger(args: {
        sessionId: string;
        runId: string;
        turnIndex: number;
        input: StateSnapshot["input"];
        config: StateSnapshot["config"];
        modeId?: string;
        createdAt?: number;
      }): void;
      appendRunSnapshotUpdateToLedger(snapshot: StateSnapshot): StateSnapshot;
    }).appendSessionLedgerEntry(session.sessionId, {
      id: "branch-parity:created",
      type: "branch.created",
      turnIndex: 0,
      createdAt: BASE_TIME,
      payload: group,
    });
    (store as unknown as {
      appendSessionLedgerEntry(sessionId: string, entry: Record<string, unknown>): void;
    }).appendSessionLedgerEntry(session.sessionId, {
      id: "branch-parity:candidate-started",
      type: "branch.candidate_started",
      runId,
      turnIndex: 0,
      createdAt: BASE_TIME,
      payload: group,
    });
    (store as unknown as {
      appendRunStartedToLedger(args: {
        sessionId: string;
        runId: string;
        turnIndex: number;
        input: StateSnapshot["input"];
        config: StateSnapshot["config"];
        modeId?: string;
        createdAt?: number;
      }): void;
      appendRunSnapshotUpdateToLedger(snapshot: StateSnapshot): StateSnapshot;
    }).appendRunStartedToLedger({
      sessionId: session.sessionId,
      runId,
      turnIndex: 1,
      input: candidate.input,
      config: candidate.config,
      modeId: candidate.modeId,
      createdAt: candidate.input.createdAt,
    });
    (store as unknown as {
      appendRunSnapshotUpdateToLedger(snapshot: StateSnapshot): StateSnapshot;
    }).appendRunSnapshotUpdateToLedger(candidate);

    const reloaded = createStore(dataDir);
    const replay = reloaded.replayRun({ runId });
    const state = StateSnapshotSchema.parse(reloaded.getRunState({ runId }));
    const stream = reloaded.streamRun({ runId });

    expect(replay.events.map((item) => item.type)).toEqual(["checkpoint.created"]);
    expect(state.output).toEqual({ text: "Candidate result." });
    expect(state.events.at(-1)?.type).toBe("run.replayed");
    expect(stream.snapshot?.output).toEqual(state.output);
  });

  it("marks ledger-derived snapshot with snapshotSource ledger", async () => {
    const dataDir = tempDir();
    const store = createStore(dataDir);
    const handle = await store.startRun({
      input: { prompt: "Verify snapshotSource propagation." },
      config: runConfig(),
    });
    const state = StateSnapshotSchema.parse(store.getRunState({ runId: handle.runId }));
    const ledger = RuntimeSessionLedgerSchema.parse(
      (store as unknown as { backend: { getSessionLedger(sessionId: string): unknown } }).backend.getSessionLedger(state.sessionId!),
    );
    const projected = deriveRunSnapshot(ledger, handle.runId);

    // After startRun completes, getRunState returns ledger-rebased snapshot
    expect(state.snapshotSource).toBe("ledger");
    expect(projected).toBeDefined();
    expect(projected!.snapshotSource).toBe("ledger");
  });

  it("preserves snapshotSource ledger through cold reload", async () => {
    const dataDir = tempDir();
    const store = createStore(dataDir);
    const handle = await store.startRun({
      input: { prompt: "Verify cold reload preserves snapshotSource." },
      config: runConfig(),
    });

    const reloaded = createStore(dataDir);
    const coldLive = StateSnapshotSchema.parse(reloaded.getRunState({ runId: handle.runId }));
    const ledger = RuntimeSessionLedgerSchema.parse(
      (reloaded as unknown as { backend: { getSessionLedger(sessionId: string): unknown } }).backend.getSessionLedger(coldLive.sessionId!),
    );
    const projected = deriveRunSnapshot(ledger, handle.runId);

    expect(coldLive.snapshotSource).toBe("ledger");
    expect(projected!.snapshotSource).toBe("ledger");
  });

  it("propagates snapshotSource through toFlowRunDetail", async () => {
    const { toFlowRunDetail } = await import("../src/run-projections.js");
    const liveSnap = snapshot({ runId: "source-test-live", sessionId: "source-test-session" });
    const ledgerSnap = StateSnapshotSchema.parse({ ...liveSnap, snapshotSource: "ledger" as const });

    const liveDetail = toFlowRunDetail(liveSnap);
    const ledgerDetail = toFlowRunDetail(ledgerSnap);

    expect(liveDetail.snapshotSource).toBe("live");
    expect(ledgerDetail.snapshotSource).toBe("ledger");
  });
});
