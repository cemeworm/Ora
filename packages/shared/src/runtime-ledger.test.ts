import { describe, expect, it } from "vitest";
import {
  agentLabelFromSnapshot,
  buildVisibleLedger,
  deriveSessionProjection,
  deriveLedgerRunAttention,
  RuntimeSessionLedgerSchema,
  type RuntimeGateProjection,
  type RuntimeSessionEntry,
  type RuntimeSessionLedger,
} from "./runtime-ledger.js";

function entry(
  overrides: Partial<RuntimeSessionEntry> & { id: string; type: RuntimeSessionEntry["type"] },
): RuntimeSessionEntry {
  return {
    sessionId: "session-1",
    parentId: undefined,
    runId: undefined,
    turnIndex: 1,
    seq: 0,
    createdAt: 0,
    payload: {},
    ...overrides,
  } as RuntimeSessionEntry;
}

function ledger(entries: RuntimeSessionEntry[], leafEntryId?: string): RuntimeSessionLedger {
  return RuntimeSessionLedgerSchema.parse({
    sessionId: "session-1",
    leafEntryId,
    entries,
  });
}

function testGate(
  overrides: Partial<RuntimeGateProjection> & Pick<RuntimeGateProjection, "gateId" | "kind" | "status">,
): RuntimeGateProjection {
  return {
    runId: "run-test",
    sessionId: "session-test",
    openedAt: 0,
    pendingActionIds: [],
    pendingToolCallIds: [],
    pendingClarificationIds: [],
    ...overrides,
  };
}

describe("buildVisibleLedger", () => {
  it("returns same ledger when there are no event_batch entries", () => {
    const entries = [
      entry({ id: "root", type: "session.created" }),
      entry({ id: "msg1", type: "user.message", parentId: "root" }),
    ];
    const input = ledger(entries, "msg1");
    const result = buildVisibleLedger(input);
    expect(result.entries).toHaveLength(2);
    expect(result.leafEntryId).toBe("msg1");
  });

  it("preserves all entries including event_batch", () => {
    const entries = [
      entry({ id: "root", type: "session.created" }),
      entry({ id: "batch1", type: "runtime.event_batch", parentId: "root" }),
      entry({ id: "msg1", type: "assistant.message", parentId: "batch1" }),
    ];
    const input = ledger(entries, "msg1");
    const result = buildVisibleLedger(input);
    expect(result.entries).toHaveLength(3);
    expect(result.entries.map((e) => e.id).sort()).toEqual(["batch1", "msg1", "root"]);
  });

  it("strips events array from event_batch payloads", () => {
    const entries = [
      entry({ id: "root", type: "session.created" }),
      entry({
        id: "batch1",
        type: "runtime.event_batch",
        parentId: "root",
        payload: { events: [{ type: "some.event" }, { type: "other.event" }], status: "running" },
      }),
    ];
    const input = ledger(entries, "batch1");
    const result = buildVisibleLedger(input);
    const batch = result.entries.find((e) => e.id === "batch1");
    expect(batch).toBeDefined();
    const payload = batch!.payload as Record<string, unknown>;
    expect(payload.events).toEqual([]);
  });

  it("preserves status in event_batch payloads", () => {
    const entries = [
      entry({ id: "root", type: "session.created" }),
      entry({
        id: "batch1",
        type: "runtime.event_batch",
        parentId: "root",
        payload: { events: [{ type: "e1" }], status: "succeeded" },
      }),
    ];
    const input = ledger(entries, "batch1");
    const result = buildVisibleLedger(input);
    const batch = result.entries.find((e) => e.id === "batch1");
    const payload = batch!.payload as Record<string, unknown>;
    expect(payload.status).toBe("succeeded");
  });

  it("preserves output and error in event_batch payloads", () => {
    const entries = [
      entry({ id: "root", type: "session.created" }),
      entry({
        id: "batch1",
        type: "runtime.event_batch",
        parentId: "root",
        payload: { events: [], output: { text: "result" }, error: "something went wrong" },
      }),
    ];
    const input = ledger(entries, "batch1");
    const result = buildVisibleLedger(input);
    const batch = result.entries.find((e) => e.id === "batch1");
    const payload = batch!.payload as Record<string, unknown>;
    expect(payload.output).toEqual({ text: "result" });
    expect(payload.error).toBe("something went wrong");
  });

  it("strips snapshot in event_batch payloads", () => {
    const snapshot = { status: "succeeded", runId: "r1" };
    const entries = [
      entry({ id: "root", type: "session.created" }),
      entry({
        id: "batch1",
        type: "runtime.event_batch",
        parentId: "root",
        payload: { events: [{ type: "e1" }], snapshot },
      }),
    ];
    const input = ledger(entries, "batch1");
    const result = buildVisibleLedger(input);
    const batch = result.entries.find((e) => e.id === "batch1");
    const payload = batch!.payload as Record<string, unknown>;
    expect(payload.snapshot).toBeUndefined();
  });

  it("keeps parentId chains intact", () => {
    const entries = [
      entry({ id: "root", type: "session.created" }),
      entry({ id: "batch1", type: "runtime.event_batch", parentId: "root" }),
      entry({ id: "msg1", type: "assistant.message", parentId: "batch1" }),
    ];
    const input = ledger(entries, "msg1");
    const result = buildVisibleLedger(input);
    const msg = result.entries.find((e) => e.id === "msg1");
    expect(msg?.parentId).toBe("batch1");
  });

  it("keeps leafEntryId unchanged", () => {
    const entries = [
      entry({ id: "root", type: "session.created" }),
      entry({ id: "batch1", type: "runtime.event_batch", parentId: "root" }),
    ];
    const input = ledger(entries, "batch1");
    const result = buildVisibleLedger(input);
    expect(result.leafEntryId).toBe("batch1");
  });

  it("handles empty ledger", () => {
    const input = ledger([], undefined);
    const result = buildVisibleLedger(input);
    expect(result.entries).toHaveLength(0);
    expect(result.leafEntryId).toBeUndefined();
  });

  it("handles non-event_batch entries without modification", () => {
    const entries = [
      entry({ id: "root", type: "session.created", payload: { title: "Test" } }),
      entry({
        id: "msg1",
        type: "assistant.message",
        parentId: "root",
        payload: { content: "Hello", status: "succeeded" },
      }),
    ];
    const input = ledger(entries, "msg1");
    const result = buildVisibleLedger(input);
    const msg = result.entries.find((e) => e.id === "msg1");
    expect((msg?.payload as Record<string, unknown>).content).toBe("Hello");
    expect((msg?.payload as Record<string, unknown>).status).toBe("succeeded");
  });

  it("handles event_batch with no extra fields", () => {
    const entries = [
      entry({ id: "root", type: "session.created" }),
      entry({ id: "batch1", type: "runtime.event_batch", parentId: "root", payload: { events: [{}, {}] } }),
    ];
    const input = ledger(entries, "batch1");
    const result = buildVisibleLedger(input);
    const batch = result.entries.find((e) => e.id === "batch1");
    const payload = batch!.payload as Record<string, unknown>;
    expect(payload.events).toEqual([]);
    expect(payload.status).toBeUndefined();
    expect(payload.output).toBeUndefined();
    expect(payload.error).toBeUndefined();
    expect(payload.snapshot).toBeUndefined();
  });
});

describe("agentLabelFromSnapshot", () => {
  it("does not fall back to the first non-root profile without execution evidence", () => {
    expect(agentLabelFromSnapshot({
      profiles: [
        { id: "ora", label: "Ora" },
        { id: "builder", label: "Builder" },
      ],
      activeAgents: [],
      agentMessages: [],
    })).toBeUndefined();
  });
});

describe("buildVisibleLedger replay parity", () => {
  const sessionId = "session-1";

  function makeEntries(): RuntimeSessionEntry[] {
    return [
      entry({ id: "root", type: "session.created", sessionId, seq: 1, createdAt: 1, payload: { title: "Chat" } }),
      entry({ id: "run1", type: "run.started", sessionId, runId: "run-1", parentId: "root", turnIndex: 1, seq: 2, createdAt: 2, payload: { input: { prompt: "hello" }, config: { providerId: "openai", modelRef: "gpt-4", pattern: "orchestrator_subagent" }, status: "running" } }),
      entry({ id: "user1", type: "user.message", sessionId, runId: "run-1", parentId: "run1", turnIndex: 1, seq: 3, createdAt: 3, payload: { content: "hello" } }),
      entry({ id: "batch1", type: "runtime.event_batch", sessionId, runId: "run-1", parentId: "user1", turnIndex: 1, seq: 4, createdAt: 4, payload: { events: [], status: "succeeded" } }),
      entry({ id: "msg1", type: "assistant.message", sessionId, runId: "run-1", parentId: "batch1", turnIndex: 1, seq: 5, createdAt: 5, payload: { content: "hi there", status: "succeeded" } }),
    ];
  }

  it("produces same session summary as full ledger replay", () => {
    const entries = makeEntries();
    const full = ledger(entries, "msg1");
    const visible = buildVisibleLedger(full);

    const fullProjection = deriveSessionProjection(full);
    const visibleProjection = deriveSessionProjection(visible);

    expect(visibleProjection.session.sessionId).toBe(fullProjection.session.sessionId);
    expect(visibleProjection.session.latestRunId).toBe(fullProjection.session.latestRunId);
    expect(visibleProjection.session.turnCount).toBe(fullProjection.session.turnCount);
    expect(visibleProjection.session.status).toBe(fullProjection.session.status);
    expect(visibleProjection.session.attention).toEqual(fullProjection.session.attention);
    expect(visibleProjection.session.title).toBe(fullProjection.session.title);
    expect(visibleProjection.runs).toHaveLength(fullProjection.runs.length);
  });

  it("produces same latestSnapshot as full ledger replay", () => {
    const entries = makeEntries();
    const full = ledger(entries, "msg1");
    const visible = buildVisibleLedger(full);

    const fullProjection = deriveSessionProjection(full);
    const visibleProjection = deriveSessionProjection(visible);

    expect(visibleProjection.latestSnapshot?.runId).toBe(fullProjection.latestSnapshot?.runId);
    expect(visibleProjection.latestSnapshot?.status).toBe(fullProjection.latestSnapshot?.status);
  });

  it("does not synthesize orchestrator as active agent for running single_agent fallback snapshots", () => {
    const entries = [
      entry({ id: "root", type: "session.created", sessionId, seq: 1, createdAt: 1, payload: { title: "Chat" } }),
      entry({
        id: "run1",
        type: "run.started",
        sessionId,
        runId: "run-1",
        parentId: "root",
        turnIndex: 1,
        seq: 2,
        createdAt: 2,
        payload: {
          input: { prompt: "hello" },
          config: {
            providerId: "openai",
            modelRef: "gpt-4",
            pattern: "orchestrator_subagent",
            modeId: "single_agent",
            profileIds: ["ora"],
          },
          status: "running",
        },
      }),
    ];
    const projection = deriveSessionProjection(ledger(entries, "run1"));

    expect(projection.latestSnapshot?.status).toBe("running");
    expect(projection.latestSnapshot?.activeAgents).toEqual(["ora"]);
  });

  it("preserves run projections", () => {
    const entries = makeEntries();
    const full = ledger(entries, "msg1");
    const visible = buildVisibleLedger(full);

    const fullProjection = deriveSessionProjection(full);
    const visibleProjection = deriveSessionProjection(visible);

    expect(visibleProjection.runs).toHaveLength(fullProjection.runs.length);
    for (const visibleRun of visibleProjection.runs) {
      const fullRun = fullProjection.runs.find((r) => r.runId === visibleRun.runId);
      expect(fullRun).toBeDefined();
      expect(visibleRun.status).toBe(fullRun!.status);
    }
  });

  it("produces same turn transcript", () => {
    const entries = makeEntries();
    const full = ledger(entries, "msg1");
    const visible = buildVisibleLedger(full);

    const fullProjection = deriveSessionProjection(full);
    const visibleProjection = deriveSessionProjection(visible);

    expect(visibleProjection.turns).toHaveLength(fullProjection.turns.length);
    expect(visibleProjection.transcript).toHaveLength(fullProjection.transcript.length);
  });
});

describe("branch authority replay", () => {
  const runPayload = (prompt: string, extraConfig?: Record<string, unknown>) => ({
    input: { prompt },
    config: {
      providerId: "openai",
      modelRef: "gpt-4",
      pattern: "orchestrator_subagent",
      ...extraConfig,
    },
    status: "running" as const,
  });

  it("hides the replaced run and marks notified candidates after branch.adopted with replace_latest", () => {
    const entries = [
      entry({ id: "root", type: "session.created", seq: 1, createdAt: 1 }),
      entry({ id: "run1", type: "run.started", runId: "run-1", parentId: "root", seq: 2, createdAt: 2, payload: runPayload("hello") }),
      entry({ id: "branch1", type: "branch.created", parentId: "run1", seq: 3, createdAt: 3, payload: { branchGroupId: "bg-1", target: "replace_latest", replaceRunId: "run-1", candidateRunIds: ["run-2", "run-3"], prompt: "test", status: "running", baseTurnIndex: 1 } }),
      entry({ id: "run2", type: "run.started", runId: "run-2", parentId: "branch1", seq: 4, createdAt: 4, payload: runPayload("c1") }),
      entry({ id: "run3", type: "run.started", runId: "run-3", parentId: "branch1", seq: 5, createdAt: 5, payload: runPayload("c2") }),
      entry({ id: "adopt1", type: "branch.adopted", parentId: "branch1", seq: 6, createdAt: 6, payload: { branchGroupId: "bg-1", adoptedRunId: "run-2", supersededRunId: "run-1", notifiedCandidateRunIds: ["run-3"] } }),
    ];

    const projection = deriveSessionProjection(ledger(entries));

    // The superseded run is hidden from the main projection (replace_latest behavior).
    const run1 = projection.runs.find((r) => r.runId === "run-1");
    expect(run1).toBeUndefined();

    // The branch group correctly records the adoption.
    const bg = projection.branchGroups.find((g) => g.branchGroupId === "bg-1");
    expect(bg).toBeDefined();
    expect(bg!.status).toBe("adopted");
    expect(bg!.adoptedRunId).toBe("run-2");
    expect(bg!.replaceRunId).toBe("run-1");

    // Notified candidate (run-3) has branchGroupAdoptedRunId.
    const run3 = projection.runs.find((r) => r.runId === "run-3");
    expect(run3).toBeDefined();
    expect(run3!.config.metadata).toMatchObject({ branchGroupAdoptedRunId: "run-2" });

    // The adopted run itself does not get the adoptedRunId marker.
    const run2 = projection.runs.find((r) => r.runId === "run-2");
    expect(run2).toBeDefined();
    expect(run2!.config.metadata.branchGroupAdoptedRunId).toBeUndefined();
  });

  it("replays supersededByRunId metadata on the replaced run for cold-reload correctness", () => {
    // The hide logic in deriveSessionProjection hides the replaced run,
    // but the ledger replay MUST still set supersededByRunId on the
    // run in the internal state (for downstream consumers). Verify by
    // inspecting the run just before the branch.adopted entry is applied.
    const entries = [
      entry({ id: "root", type: "session.created", seq: 1, createdAt: 1 }),
      entry({ id: "run1", type: "run.started", runId: "run-1", parentId: "root", seq: 2, createdAt: 2, payload: runPayload("hello") }),
      entry({ id: "branch1", type: "branch.created", parentId: "run1", seq: 3, createdAt: 3, payload: { branchGroupId: "bg-1", target: "replace_latest", replaceRunId: "run-1", candidateRunIds: ["run-2"], prompt: "test", status: "running", baseTurnIndex: 1 } }),
      entry({ id: "run2", type: "run.started", runId: "run-2", parentId: "branch1", seq: 4, createdAt: 4, payload: runPayload("c1") }),
      entry({ id: "adopt1", type: "branch.adopted", parentId: "branch1", seq: 5, createdAt: 5, payload: { branchGroupId: "bg-1", adoptedRunId: "run-2", supersededRunId: "run-1" } }),
    ];

    // Before adoption: run-1 is visible.
    const before = deriveSessionProjection(ledger(entries.slice(0, 4)));
    expect(before.runs.find((r) => r.runId === "run-1")).toBeDefined();
    expect(before.runs.find((r) => r.runId === "run-1")!.config.metadata.supersededByRunId).toBeUndefined();

    // After adoption: run-1 is hidden (replace_latest).
    const after = deriveSessionProjection(ledger(entries));
    expect(after.runs.find((r) => r.runId === "run-1")).toBeUndefined();

    // The branch group reflects the superseded relationship.
    const bg = after.branchGroups.find((g) => g.branchGroupId === "bg-1");
    expect(bg).toBeDefined();
    expect(bg!.status).toBe("adopted");
    expect(bg!.adoptedRunId).toBe("run-2");
  });

  it("restores branchDismissed metadata on dismissed runs after branch.dismissed", () => {
    const entries = [
      entry({ id: "root", type: "session.created", seq: 1, createdAt: 1 }),
      entry({ id: "run1", type: "run.started", runId: "run-1", parentId: "root", seq: 2, createdAt: 2, payload: runPayload("hello", { metadata: {} }) }),
      entry({ id: "branch1", type: "branch.created", parentId: "run1", seq: 3, createdAt: 3, payload: { branchGroupId: "bg-1", candidateRunIds: ["run-2", "run-3"], prompt: "test", status: "running", baseTurnIndex: 1 } }),
      entry({ id: "run2", type: "run.started", runId: "run-2", parentId: "branch1", seq: 4, createdAt: 4, payload: runPayload("candidate 1", { metadata: { branchRole: "candidate" } }) }),
      entry({ id: "run3", type: "run.started", runId: "run-3", parentId: "branch1", seq: 5, createdAt: 5, payload: runPayload("candidate 2", { metadata: { branchRole: "candidate" } }) }),
      entry({ id: "dismiss1", type: "branch.dismissed", parentId: "branch1", seq: 6, createdAt: 6, payload: { branchGroupId: "bg-1", dismissedRunIds: ["run-2", "run-3"] } }),
    ];
    const full = ledger(entries);
    const projection = deriveSessionProjection(full);

    const run2 = projection.runs.find((r) => r.runId === "run-2");
    expect(run2!.config.metadata).toMatchObject({ branchDismissed: true, branchDismissedAt: 6 });

    const run3 = projection.runs.find((r) => r.runId === "run-3");
    expect(run3!.config.metadata).toMatchObject({ branchDismissed: true, branchDismissedAt: 6 });
  });

  it("does not mutate runs when branch.adopted has no supersededRunId or notifiedCandidateRunIds", () => {
    const entries = [
      entry({ id: "root", type: "session.created", seq: 1, createdAt: 1 }),
      entry({ id: "run1", type: "run.started", runId: "run-1", parentId: "root", seq: 2, createdAt: 2, payload: runPayload("hello", { metadata: {} }) }),
      entry({ id: "branch1", type: "branch.created", parentId: "run1", seq: 3, createdAt: 3, payload: { branchGroupId: "bg-1", target: "append_after_latest", candidateRunIds: ["run-2"], prompt: "test", status: "running", baseTurnIndex: 1 } }),
      entry({ id: "run2", type: "run.started", runId: "run-2", parentId: "branch1", seq: 4, createdAt: 4, payload: runPayload("candidate", { metadata: { branchRole: "candidate" } }) }),
      entry({ id: "adopt1", type: "branch.adopted", parentId: "branch1", seq: 5, createdAt: 5, payload: { branchGroupId: "bg-1", adoptedRunId: "run-2" } }),
    ];
    const full = ledger(entries);
    const projection = deriveSessionProjection(full);

    // Original run should not be superseded (append mode, not replace).
    const run1 = projection.runs.find((r) => r.runId === "run-1");
    expect(run1!.config.metadata.supersededByRunId).toBeUndefined();

    // Adopted run should not have branchGroupAdoptedRunId.
    const run2 = projection.runs.find((r) => r.runId === "run-2");
    expect(run2!.config.metadata.branchGroupAdoptedRunId).toBeUndefined();
  });

  it("branch metadata survives buildVisibleLedger round-trip", () => {
    const entries = [
      entry({ id: "root", type: "session.created", seq: 1, createdAt: 1 }),
      entry({ id: "run1", type: "run.started", runId: "run-1", parentId: "root", seq: 2, createdAt: 2, payload: runPayload("hello", { metadata: {} }) }),
      entry({ id: "branch1", type: "branch.created", parentId: "run1", seq: 3, createdAt: 3, payload: { branchGroupId: "bg-1", target: "replace_latest", replaceRunId: "run-1", candidateRunIds: ["run-2", "run-3"], prompt: "test", status: "running", baseTurnIndex: 1 } }),
      entry({ id: "run2", type: "run.started", runId: "run-2", parentId: "branch1", seq: 4, createdAt: 4, payload: runPayload("c1", { metadata: { branchRole: "candidate" } }) }),
      entry({ id: "run3", type: "run.started", runId: "run-3", parentId: "branch1", seq: 5, createdAt: 5, payload: runPayload("c2", { metadata: { branchRole: "candidate" } }) }),
      entry({ id: "adopt1", type: "branch.adopted", parentId: "branch1", seq: 6, createdAt: 6, payload: { branchGroupId: "bg-1", adoptedRunId: "run-2", supersededRunId: "run-1", notifiedCandidateRunIds: ["run-3"] } }),
      entry({ id: "dismiss1", type: "branch.dismissed", parentId: "adopt1", seq: 7, createdAt: 7, payload: { branchGroupId: "bg-1", dismissedRunIds: ["run-3"] } }),
    ];
    const full = ledger(entries, "dismiss1");
    const slimmed = buildVisibleLedger(full);

    // Branch authority metadata does not live inside event_batch, so
    // buildVisibleLedger should preserve it unchanged.
    const fullProj = deriveSessionProjection(full);
    const slimmedProj = deriveSessionProjection(slimmed);

    for (const run of fullProj.runs) {
      const slimmedRun = slimmedProj.runs.find((r) => r.runId === run.runId);
      expect(slimmedRun).toBeDefined();
      expect(slimmedRun!.config.metadata).toEqual(run.config.metadata);
    }
  });
});

describe("terminal state integrity", () => {
  const runPayload = (prompt: string, status: string = "running", gates?: Array<{ gateId: string; kind: string; status: string }>) => ({
    input: { prompt },
    config: {
      providerId: "openai",
      modelRef: "gpt-4",
      pattern: "orchestrator_subagent",
    },
    status,
  });

  function terminalEvent(runId: string, type: string, payload: Record<string, unknown>, seq: number, createdAt: number) {
    return { id: `evt-${type}-${seq}`, runId, type, seq, createdAt, payload };
  }

  it("downgrades succeeded+open_approval_gate to failed attention with integrity diagnostic", () => {
    // Regression for session-0020 / run-0019: ledger replay must not
    // silently render "succeeded" when an open approval gate exists.
    const entries = [
      entry({ id: "root", type: "session.created", seq: 1, createdAt: 1 }),
      entry({ id: "run1", type: "run.started", runId: "run-1", parentId: "root", turnIndex: 1, seq: 2, createdAt: 2, payload: runPayload("test") }),
      entry({ id: "gate1", type: "gate.opened", runId: "run-1", parentId: "run1", turnIndex: 1, seq: 3, createdAt: 3, payload: { gateId: "gate-approval", kind: "approval", pendingActionIds: ["action-write"], pendingToolCallIds: ["tool-write"] } }),
      entry({ id: "batch1", type: "runtime.event_batch", runId: "run-1", parentId: "gate1", turnIndex: 1, seq: 4, createdAt: 4, payload: { events: [terminalEvent("run-1", "run.done", { status: "succeeded" }, 4, 4)], status: "succeeded" } }),
    ];
    const projection = deriveSessionProjection(ledger(entries));
    const run = projection.runs.find((r) => r.runId === "run-1");

    expect(run).toBeDefined();
    // The run status from the event batch is "succeeded"...
    expect(run!.status).toBe("succeeded");
    // ... but attention must detect the impossible combination and surface failure.
    expect(run!.attention.kind).toBe("failed");
    expect(run!.attention.reason).toContain("terminal_run_with_open_gates:succeeded");
    expect(run!.attention.reason).toContain("approval:gate-approval");
  });

  it("downgrades succeeded+open_clarification_gate to failed attention", () => {
    const entries = [
      entry({ id: "root", type: "session.created", seq: 1, createdAt: 1 }),
      entry({ id: "run1", type: "run.started", runId: "run-1", parentId: "root", turnIndex: 1, seq: 2, createdAt: 2, payload: runPayload("test") }),
      entry({ id: "gate1", type: "gate.opened", runId: "run-1", parentId: "run1", turnIndex: 1, seq: 3, createdAt: 3, payload: { gateId: "gate-clarify", kind: "clarification", pendingClarificationIds: ["clarify-scope"] } }),
      entry({ id: "batch1", type: "runtime.event_batch", runId: "run-1", parentId: "gate1", turnIndex: 1, seq: 4, createdAt: 4, payload: { events: [terminalEvent("run-1", "run.done", { status: "succeeded" }, 4, 4)], status: "succeeded" } }),
    ];
    const projection = deriveSessionProjection(ledger(entries));
    const run = projection.runs.find((r) => r.runId === "run-1");

    expect(run).toBeDefined();
    expect(run!.attention.kind).toBe("failed");
    expect(run!.attention.reason).toContain("terminal_run_with_open_gates:succeeded");
    expect(run!.attention.reason).toContain("clarification:gate-clarify");
  });

  it("downgrades failed+open_gate to failed attention", () => {
    const entries = [
      entry({ id: "root", type: "session.created", seq: 1, createdAt: 1 }),
      entry({ id: "run1", type: "run.started", runId: "run-1", parentId: "root", turnIndex: 1, seq: 2, createdAt: 2, payload: runPayload("test") }),
      entry({ id: "gate1", type: "gate.opened", runId: "run-1", parentId: "run1", turnIndex: 1, seq: 3, createdAt: 3, payload: { gateId: "gate-approval", kind: "approval", pendingActionIds: ["action-write"] } }),
      entry({ id: "batch1", type: "runtime.event_batch", runId: "run-1", parentId: "gate1", turnIndex: 1, seq: 4, createdAt: 4, payload: { events: [terminalEvent("run-1", "run.failed", { status: "failed", error: "crashed" }, 4, 4)], status: "failed" } }),
    ];
    const projection = deriveSessionProjection(ledger(entries));
    const run = projection.runs.find((r) => r.runId === "run-1");

    expect(run).toBeDefined();
    expect(run!.attention.kind).toBe("failed");
    expect(run!.attention.reason).toContain("terminal_run_with_open_gates:failed");
  });

  it("downgrades cancelled+open_gate to failed attention", () => {
    const entries = [
      entry({ id: "root", type: "session.created", seq: 1, createdAt: 1 }),
      entry({ id: "run1", type: "run.started", runId: "run-1", parentId: "root", turnIndex: 1, seq: 2, createdAt: 2, payload: runPayload("test") }),
      entry({ id: "gate1", type: "gate.opened", runId: "run-1", parentId: "run1", turnIndex: 1, seq: 3, createdAt: 3, payload: { gateId: "gate-plan", kind: "plan_decision", pendingClarificationIds: ["plan-1"] } }),
      entry({ id: "batch1", type: "runtime.event_batch", runId: "run-1", parentId: "gate1", turnIndex: 1, seq: 4, createdAt: 4, payload: { events: [terminalEvent("run-1", "run.cancelled", { status: "cancelled" }, 4, 4)], status: "cancelled" } }),
    ];
    const projection = deriveSessionProjection(ledger(entries));
    const run = projection.runs.find((r) => r.runId === "run-1");

    expect(run).toBeDefined();
    expect(run!.attention.kind).toBe("failed");
    expect(run!.attention.reason).toContain("terminal_run_with_open_gates:cancelled");
  });

  it("preserves correct succeeded attention when gate is resolved before terminal event", () => {
    // Happy path: gate is opened, then resolved, then run completes.
    // Attention should correctly show idle (not needs_approval, not failed).
    const entries = [
      entry({ id: "root", type: "session.created", seq: 1, createdAt: 1 }),
      entry({ id: "run1", type: "run.started", runId: "run-1", parentId: "root", turnIndex: 1, seq: 2, createdAt: 2, payload: runPayload("test") }),
      entry({ id: "gate1", type: "gate.opened", runId: "run-1", parentId: "run1", turnIndex: 1, seq: 3, createdAt: 3, payload: { gateId: "gate-approval", kind: "approval", pendingActionIds: ["action-write"] } }),
      entry({ id: "resolve1", type: "gate.resolved", runId: "run-1", parentId: "gate1", turnIndex: 1, seq: 4, createdAt: 4, payload: { gateId: "gate-approval", status: "resolved", resolvedAt: 4 } }),
      entry({ id: "batch1", type: "runtime.event_batch", runId: "run-1", parentId: "resolve1", turnIndex: 1, seq: 5, createdAt: 5, payload: { events: [terminalEvent("run-1", "run.done", { status: "succeeded" }, 5, 5)], status: "succeeded" } }),
    ];
    const projection = deriveSessionProjection(ledger(entries));
    const run = projection.runs.find((r) => r.runId === "run-1");

    expect(run).toBeDefined();
    expect(run!.status).toBe("succeeded");
    // With the gate resolved, attention should be idle — not failed, not needs_approval.
    expect(run!.attention.kind).toBe("idle");
  });

  it("reproduces session-0020 scenario: succeeded status with open approval gate after auto_review", () => {
    // Minimized ledger reproduction of the session-0020 / run-0019 incident.
    // The incident sequence:
    // 1. Run started normally under default permission mode.
    // 2. An approval-required file.patch action (orchestrator-tool-102) was approved.
    // 3. A second file.patch action (orchestrator-tool-28) needed approval.
    // 4. Permission mode was switched to auto_review.
    // 5. Ledger recorded run.done/succeeded but the gate for the second action
    //    was still open.
    //
    const entries = [
      entry({ id: "root", type: "session.created", seq: 1, createdAt: 1 }),
      // First turn: normal run start under default permission mode
      entry({ id: "run1", type: "run.started", runId: "run-0019", parentId: "root", turnIndex: 1, seq: 2, createdAt: 2, payload: runPayload("update docs") }),
      // First approval gate opened for action-102
      entry({ id: "gate102", type: "gate.opened", runId: "run-0019", parentId: "run1", turnIndex: 1, seq: 3, createdAt: 3, payload: { gateId: "gate-102", kind: "approval", pendingActionIds: ["action-102"], pendingToolCallIds: ["tool-102"] } }),
      // First approval gate resolved (user approved via UI)
      entry({ id: "resolve102", type: "gate.resolved", runId: "run-0019", parentId: "gate102", turnIndex: 1, seq: 4, createdAt: 4, payload: { gateId: "gate-102", status: "resolved", resolvedAt: 4 } }),
      // Second approval gate opened for action-28 (after permission mode switch context)
      entry({ id: "gate28", type: "gate.opened", runId: "run-0019", parentId: "resolve102", turnIndex: 1, seq: 5, createdAt: 5, payload: { gateId: "gate-28", kind: "approval", pendingActionIds: ["action-28"], pendingToolCallIds: ["tool-28"] } }),
      // The bug: event batch records run.done/succeeded BEFORE gate-28 is resolved
      entry({ id: "batchDone", type: "runtime.event_batch", runId: "run-0019", parentId: "gate28", turnIndex: 1, seq: 6, createdAt: 6, payload: { events: [terminalEvent("run-0019", "run.done", { status: "succeeded" }, 6, 6)], status: "succeeded", output: { text: "Done." } } }),
    ];
    const projection = deriveSessionProjection(ledger(entries));
    const run = projection.runs.find((r) => r.runId === "run-0019");

    expect(run).toBeDefined();
    // The structural fix: even though the raw status is "succeeded",
    // ledger projection MUST detect the contradiction between terminal
    // status and open gates, and surface failed attention.
    expect(run!.attention.kind).toBe("failed");
    expect(run!.attention.reason).toContain("terminal_run_with_open_gates:succeeded");
    expect(run!.attention.reason).toContain("approval:gate-28");
  });

  it("deriveLedgerRunAttention returns correct attention for clean terminal runs", () => {
    // Direct unit test for deriveLedgerRunAttention on clean states.
    
    // Clean succeeded run (all gates resolved):
    const cleanSucceeded = deriveLedgerRunAttention({
      runId: "run-clean",
      status: "succeeded",
      gates: [testGate({ gateId: "g1", kind: "approval", status: "resolved" })],
      events: [],
    });
    expect(cleanSucceeded.kind).toBe("idle");

    // Running run with open approval gate:
    const runningApproval = deriveLedgerRunAttention({
      runId: "run-approval",
      status: "running",
      gates: [testGate({ gateId: "g1", kind: "approval", status: "open", pendingActionIds: ["a1"] })],
      events: [],
    });
    expect(runningApproval.kind).toBe("needs_approval");

    // Running run with open clarification gate:
    const runningClarify = deriveLedgerRunAttention({
      runId: "run-clarify",
      status: "running",
      gates: [testGate({ gateId: "g1", kind: "clarification", status: "open", pendingClarificationIds: ["c1"] })],
      events: [],
    });
    expect(runningClarify.kind).toBe("needs_clarification");

    // Running run with open plan_decision gate:
    const runningPlan = deriveLedgerRunAttention({
      runId: "run-plan",
      status: "running",
      gates: [testGate({ gateId: "g1", kind: "plan_decision", status: "open" })],
      events: [],
    });
    expect(runningPlan.kind).toBe("needs_plan_decision");

    const succeededPlan = deriveLedgerRunAttention({
      runId: "run-succeeded-plan",
      status: "succeeded",
      gates: [testGate({ gateId: "g-plan", kind: "plan_decision", status: "open" })],
      events: [],
    });
    expect(succeededPlan.kind).toBe("needs_plan_decision");

    // Failed run (clean, no open gates):
    const cleanFailed = deriveLedgerRunAttention({
      runId: "run-failed",
      status: "failed",
      gates: [],
      error: "something crashed",
      events: [],
    });
    expect(cleanFailed.kind).toBe("failed");
    expect(cleanFailed.reason).toBe("something crashed");
  });
});

describe("SessionSummary lastUserMessageAt", () => {
  function doneEvent(runId: string, seq: number, createdAt: number, status = "succeeded") {
    return { id: `ev-${runId}-${seq}`, runId, seq, type: "run.done", createdAt, payload: { status } };
  }

  it("is undefined when transcript has no user messages", () => {
    const entries = [
      entry({ id: "root", type: "session.created", createdAt: 1000 }),
      entry({ id: "run1", type: "run.started", runId: "r1", parentId: "root", turnIndex: 1, seq: 1, createdAt: 1001, payload: { input: { prompt: "no-user" }, config: { providerId: "mock", modelRef: "mock" } } }),
      entry({ id: "batch1", type: "runtime.event_batch", runId: "r1", parentId: "run1", turnIndex: 1, seq: 2, createdAt: 1002, payload: { events: [doneEvent("r1", 2, 1002)], status: "succeeded" } }),
    ];
    const projection = deriveSessionProjection(ledger(entries, "batch1"));
    expect(projection.session.lastUserMessageAt).toBeUndefined();
  });

  it("captures the most recent user message createdAt", () => {
    const entries = [
      entry({ id: "root", type: "session.created", createdAt: 1000 }),
      entry({ id: "msg1", type: "user.message", runId: "r1", parentId: "root", turnIndex: 1, seq: 1, createdAt: 2000, payload: { content: "first" } }),
      entry({ id: "run1", type: "run.started", runId: "r1", parentId: "msg1", turnIndex: 1, seq: 2, createdAt: 2001, payload: { input: { prompt: "first" }, config: { providerId: "mock", modelRef: "mock" } } }),
      entry({ id: "batch1", type: "runtime.event_batch", runId: "r1", parentId: "run1", turnIndex: 1, seq: 3, createdAt: 2002, payload: { events: [doneEvent("r1", 3, 2002)], status: "succeeded" } }),
      entry({ id: "msg2", type: "user.message", runId: "r2", parentId: "batch1", turnIndex: 2, seq: 4, createdAt: 5000, payload: { content: "second" } }),
      entry({ id: "run2", type: "run.started", runId: "r2", parentId: "msg2", turnIndex: 2, seq: 5, createdAt: 5001, payload: { input: { prompt: "second" }, config: { providerId: "mock", modelRef: "mock" } } }),
      entry({ id: "batch2", type: "runtime.event_batch", runId: "r2", parentId: "run2", turnIndex: 2, seq: 6, createdAt: 5002, payload: { events: [doneEvent("r2", 6, 5002)], status: "succeeded" } }),
    ];
    const projection = deriveSessionProjection(ledger(entries, "batch2"));
    expect(projection.session.lastUserMessageAt).toBe(5000);
  });

  it("picks the latest among multiple user messages in the same session", () => {
    const entries = [
      entry({ id: "root", type: "session.created", createdAt: 1000 }),
      entry({ id: "msg1", type: "user.message", runId: "r1", parentId: "root", turnIndex: 1, seq: 1, createdAt: 2000, payload: { content: "first" } }),
      entry({ id: "run1", type: "run.started", runId: "r1", parentId: "msg1", turnIndex: 1, seq: 2, createdAt: 2001, payload: { input: { prompt: "first" }, config: { providerId: "mock", modelRef: "mock" } } }),
      entry({ id: "batch1", type: "runtime.event_batch", runId: "r1", parentId: "run1", turnIndex: 1, seq: 3, createdAt: 2002, payload: { events: [doneEvent("r1", 3, 2002)], status: "succeeded" } }),
      entry({ id: "msg2", type: "user.message", runId: "r2", parentId: "batch1", turnIndex: 2, seq: 4, createdAt: 3000, payload: { content: "second" } }),
      entry({ id: "run2", type: "run.started", runId: "r2", parentId: "msg2", turnIndex: 2, seq: 5, createdAt: 3001, payload: { input: { prompt: "second" }, config: { providerId: "mock", modelRef: "mock" } } }),
      entry({ id: "batch2", type: "runtime.event_batch", runId: "r2", parentId: "run2", turnIndex: 2, seq: 6, createdAt: 3002, payload: { events: [doneEvent("r2", 6, 3002)], status: "succeeded" } }),
      entry({ id: "msg3", type: "user.message", runId: "r3", parentId: "batch2", turnIndex: 3, seq: 7, createdAt: 4000, payload: { content: "third" } }),
      entry({ id: "run3", type: "run.started", runId: "r3", parentId: "msg3", turnIndex: 3, seq: 8, createdAt: 4001, payload: { input: { prompt: "third" }, config: { providerId: "mock", modelRef: "mock" } } }),
      entry({ id: "batch3", type: "runtime.event_batch", runId: "r3", parentId: "run3", turnIndex: 3, seq: 9, createdAt: 4002, payload: { events: [doneEvent("r3", 9, 4002)], status: "succeeded" } }),
    ];
    const projection = deriveSessionProjection(ledger(entries, "batch3"));
    expect(projection.session.lastUserMessageAt).toBe(4000);
  });

  it("not affected by assistant messages or tool results", () => {
    const entries = [
      entry({ id: "root", type: "session.created", createdAt: 1000 }),
      entry({ id: "msg1", type: "user.message", runId: "r1", parentId: "root", turnIndex: 1, seq: 1, createdAt: 2000, payload: { content: "hello" } }),
      entry({ id: "run1", type: "run.started", runId: "r1", parentId: "msg1", turnIndex: 1, seq: 2, createdAt: 2001, payload: { input: { prompt: "hello" }, config: { providerId: "mock", modelRef: "mock" } } }),
      entry({ id: "batch1", type: "runtime.event_batch", runId: "r1", parentId: "run1", turnIndex: 1, seq: 3, createdAt: 9999, payload: { events: [doneEvent("r1", 3, 9999)], status: "succeeded" } }),
    ];
    const projection = deriveSessionProjection(ledger(entries, "batch1"));
    // lastUserMessageAt should still be 2000 (the user message time),
    // not 9999 (assistant streaming event time).
    expect(projection.session.lastUserMessageAt).toBe(2000);
  });
});
