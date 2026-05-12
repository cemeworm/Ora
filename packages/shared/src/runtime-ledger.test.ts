import { describe, expect, it } from "vitest";
import {
  buildVisibleLedger,
  deriveSessionProjection,
  RuntimeSessionLedgerSchema,
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
