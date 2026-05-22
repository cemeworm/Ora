import {
  SessionDetailSchema,
  StateSnapshotSchema,
  type RuntimeSessionEntry,
  type RuntimeSessionEntryType,
  type SessionDetail,
  type StateSnapshot,
} from "@cemeworm/shared";
import { describe, expect, it, vi } from "vitest";
import { OraRuntimeError } from "../src/runtime-errors.js";
import { PlanDecisionService, type PlanDecisionServiceDeps } from "../src/plan-decision-service.js";

function snapshotWithPlanDecision(overrides: {
  planContent?: string;
  sessionId?: string;
  turnIndex?: number;
  omitTurnIndex?: boolean;
} = {}): StateSnapshot {
  const now = 1_000;
  return StateSnapshotSchema.parse({
    runId: "run-plan-1",
    sessionId: overrides.sessionId ?? "session-plan-1",
    ...(overrides.omitTurnIndex ? {} : { turnIndex: overrides.turnIndex ?? 3 }),
    status: "succeeded",
    pattern: "orchestrator_subagent",
    modeId: "plan",
    input: { prompt: "Create a plan.", context: {}, createdAt: now },
    config: {
      pattern: "orchestrator_subagent",
      profileIds: [],
      skillIds: [],
      toolIds: [],
      modelRef: "local/test-model",
      approvalMode: "high_risk_only",
      patternOptions: {},
      metadata: {},
    },
    topology: { nodes: [], edges: [] },
    profiles: [],
    memory: [],
    plan: [],
    todos: [],
    actions: [],
    policyDecisions: [],
    checkpoints: [],
    events: [],
    artifacts: [],
    activeAgents: [],
    queueSummary: {},
    sharedStateSummary: {},
    busStats: {},
    pendingClarifications: [],
    pendingApprovals: [],
    planDecisions: [{
      id: "decision-1",
      runId: "run-plan-1",
      sessionId: overrides.sessionId ?? "session-plan-1",
      status: "pending",
      planContent: overrides.planContent ?? "  Ship the narrow plan.  ",
      createdAt: now,
    }],
    updatedAt: now,
  });
}

function sessionDetail(snapshot?: StateSnapshot): SessionDetail {
  return SessionDetailSchema.parse({
    session: {
      sessionId: "session-plan-1",
      title: "Plan session",
      status: snapshot?.status ?? "succeeded",
      latestRunId: snapshot?.runId,
      turnCount: snapshot ? 1 : 0,
      createdAt: 1_000,
      updatedAt: 1_500,
    },
    turns: [],
    transcript: [],
    latestSnapshot: snapshot,
  });
}

function createHarness(options: {
  ledgerBacked: boolean;
  snapshot?: StateSnapshot;
  latestRunId?: string;
}) {
  const snapshot = options.snapshot ?? snapshotWithPlanDecision();
  const appendedEntries: RuntimeSessionEntry[] = [];
  const deps: PlanDecisionServiceDeps = {
    now: vi.fn(() => 2_000),
    getSessionOrThrow: vi.fn(() => ({
      sessionId: snapshot.sessionId ?? "session-plan-1",
      latestRunId: options.latestRunId,
    })),
    getRunOrThrow: vi.fn(() => snapshot),
    normalizeSnapshotForPersistence: vi.fn((nextSnapshot) => StateSnapshotSchema.parse(nextSnapshot)),
    isLedgerBackedSession: vi.fn(() => options.ledgerBacked),
    appendSessionLedgerEntry: vi.fn((sessionId, entry) => {
      const appended = {
        ...entry,
        sessionId,
        seq: appendedEntries.length + 1,
      } as RuntimeSessionEntry;
      appendedEntries.push(appended);
      return appended;
    }),
    refreshSessionFromLedger: vi.fn(() => undefined),
    saveManifest: vi.fn(() => undefined),
    cacheRun: vi.fn(() => undefined),
    getSession: vi.fn(() => sessionDetail(snapshot)),
  };
  return {
    deps,
    service: new PlanDecisionService(deps),
    appendedEntries,
  };
}

function entryTypes(entries: readonly RuntimeSessionEntry[]): RuntimeSessionEntryType[] {
  return entries.map((entry) => entry.type);
}

describe("PlanDecisionService", () => {
  it("appends gate resolution and accepted-plan handoff for ledger-backed accepted decisions", () => {
    const snapshot = snapshotWithPlanDecision();
    const { service, deps, appendedEntries } = createHarness({
      ledgerBacked: true,
      snapshot,
      latestRunId: snapshot.runId,
    });

    const result = service.resolve({
      sessionId: "session-plan-1",
      decisionId: "decision-1",
      status: "accepted",
    });

    expect(result.session.sessionId).toBe("session-plan-1");
    expect(entryTypes(appendedEntries)).toEqual(["gate.resolved", "handoff.accepted_plan"]);
    expect(appendedEntries[0]).toMatchObject({
      id: "run-plan-1:gate:decision-1:resolved",
      runId: "run-plan-1",
      turnIndex: 3,
      payload: {
        gateId: "decision-1",
        status: "accepted",
        resolvedAt: 2_000,
      },
    });
    expect(appendedEntries[1]).toMatchObject({
      id: "run-plan-1:handoff:decision-1",
      runId: "run-plan-1",
      turnIndex: 3,
      payload: {
        decisionId: "decision-1",
        sourceRunId: "run-plan-1",
        planContent: "Ship the narrow plan.",
        acceptedAt: 2_000,
      },
    });
    expect(deps.normalizeSnapshotForPersistence).toHaveBeenCalledWith(expect.objectContaining({
      updatedAt: 2_000,
      planDecisions: [expect.objectContaining({
        id: "decision-1",
        status: "accepted",
        resolvedAt: 2_000,
      })],
    }));
    expect(deps.refreshSessionFromLedger).toHaveBeenCalledWith("session-plan-1");
    expect(deps.saveManifest).toHaveBeenCalledTimes(1);
    expect(deps.cacheRun).not.toHaveBeenCalled();
  });

  it("does not append an accepted-plan handoff for ledger-backed declined decisions", () => {
    const snapshot = snapshotWithPlanDecision();
    const { service, deps, appendedEntries } = createHarness({
      ledgerBacked: true,
      snapshot,
      latestRunId: snapshot.runId,
    });

    service.resolve({
      sessionId: "session-plan-1",
      decisionId: "decision-1",
      status: "declined",
    });

    expect(entryTypes(appendedEntries)).toEqual(["gate.resolved"]);
    expect(appendedEntries[0]).toMatchObject({
      payload: {
        gateId: "decision-1",
        status: "declined",
        resolvedAt: 2_000,
      },
    });
    expect(deps.refreshSessionFromLedger).toHaveBeenCalledWith("session-plan-1");
    expect(deps.saveManifest).toHaveBeenCalledTimes(1);
    expect(deps.cacheRun).not.toHaveBeenCalled();
  });

  it("does not append an accepted-plan handoff for blank accepted plan content", () => {
    const snapshot = snapshotWithPlanDecision({ planContent: "   " });
    const { service, appendedEntries } = createHarness({
      ledgerBacked: true,
      snapshot,
      latestRunId: snapshot.runId,
    });

    service.resolve({
      sessionId: "session-plan-1",
      decisionId: "decision-1",
      status: "accepted",
    });

    expect(entryTypes(appendedEntries)).toEqual(["gate.resolved"]);
  });

  it("uses turn index 1 for ledger entries when snapshots omit turnIndex", () => {
    const snapshot = snapshotWithPlanDecision({ omitTurnIndex: true });
    const { service, appendedEntries } = createHarness({
      ledgerBacked: true,
      snapshot,
      latestRunId: snapshot.runId,
    });

    service.resolve({
      sessionId: "session-plan-1",
      decisionId: "decision-1",
      status: "accepted",
    });

    expect(appendedEntries).toEqual([
      expect.objectContaining({ type: "gate.resolved", turnIndex: 1 }),
      expect.objectContaining({ type: "handoff.accepted_plan", turnIndex: 1 }),
    ]);
  });

  it("updates and caches the snapshot directly for non-ledger accepted decisions", () => {
    const snapshot = snapshotWithPlanDecision();
    const { service, deps, appendedEntries } = createHarness({
      ledgerBacked: false,
      snapshot,
      latestRunId: snapshot.runId,
    });

    service.resolve({
      sessionId: "session-plan-1",
      decisionId: "decision-1",
      status: "accepted",
    });

    expect(appendedEntries).toEqual([]);
    expect(deps.refreshSessionFromLedger).not.toHaveBeenCalled();
    expect(deps.saveManifest).not.toHaveBeenCalled();
    expect(deps.cacheRun).toHaveBeenCalledWith(expect.objectContaining({
      runId: "run-plan-1",
      updatedAt: 2_000,
      planDecisions: [expect.objectContaining({
        id: "decision-1",
        status: "accepted",
        resolvedAt: 2_000,
      })],
    }), true);
  });

  it("uses the explicit runId when resolving a plan decision instead of session.latestRunId", () => {
    const snapshot = snapshotWithPlanDecision();
    const { service, deps } = createHarness({
      ledgerBacked: false,
      snapshot,
      latestRunId: "run-latest-other",
    });

    service.resolve({
      sessionId: "session-plan-1",
      runId: snapshot.runId,
      decisionId: "decision-1",
      status: "accepted",
    });

    expect(deps.getRunOrThrow).toHaveBeenCalledWith(snapshot.runId);
    expect(deps.cacheRun).toHaveBeenCalledWith(expect.objectContaining({
      runId: snapshot.runId,
      planDecisions: [expect.objectContaining({ id: "decision-1", status: "accepted" })],
    }), true);
  });

  it("throws when the session has no latest run", () => {
    const { service } = createHarness({
      ledgerBacked: true,
      latestRunId: undefined,
    });

    expect(() => service.resolve({
      sessionId: "session-plan-1",
      decisionId: "decision-1",
      status: "accepted",
    })).toThrow(OraRuntimeError);
  });

  it("throws when the decision id is not present on the latest run", () => {
    const snapshot = snapshotWithPlanDecision();
    const { service } = createHarness({
      ledgerBacked: true,
      snapshot,
      latestRunId: snapshot.runId,
    });

    expect(() => service.resolve({
      sessionId: "session-plan-1",
      decisionId: "missing-decision",
      status: "accepted",
    })).toThrow(OraRuntimeError);
  });
});
