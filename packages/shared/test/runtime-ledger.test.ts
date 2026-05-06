import { describe, expect, it } from "vitest";
import {
  RuntimeSessionLedgerSchema,
  StateSnapshotSchema,
  deriveRunSnapshot,
  deriveSessionProjection,
  orderedRuntimeSessionEntries,
  runtimeSessionEntryPath,
  runtimeSessionProjectionToDetail,
  type RuntimeSessionEntry,
  type RuntimeSessionLedger,
  type StateSnapshot,
} from "../src/index.js";

const BASE_TIME = 1_714_000_000_000;

function entry(patch: Partial<RuntimeSessionEntry> & Pick<RuntimeSessionEntry, "id" | "seq" | "type">): RuntimeSessionEntry {
  return {
    sessionId: "session-ledger",
    turnIndex: 0,
    createdAt: BASE_TIME + patch.seq,
    payload: {},
    ...patch,
  };
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
    deterministicSeed: "runtime-ledger-test",
    skillIds: [],
    toolIds: [],
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
    input: { prompt: "Project from ledger facts.", createdAt: BASE_TIME, context: {} },
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

function baseLedger(extraEntries: RuntimeSessionEntry[] = []): RuntimeSessionLedger {
  return RuntimeSessionLedgerSchema.parse({
    sessionId: "session-ledger",
    leafEntryId: extraEntries.at(-1)?.id,
    entries: [
      entry({
        id: "e-session",
        seq: 0,
        type: "session.created",
        payload: { title: "Ledger Session", projectId: "project-1" },
      }),
      ...extraEntries,
    ],
  });
}

describe("runtime session ledger projection", () => {
  it("derives session summary, turns, transcript, and final snapshot from ledger entries", () => {
    const ledger = baseLedger([
      entry({
        id: "e-user",
        parentId: "e-session",
        seq: 1,
        type: "user.message",
        runId: "run-1",
        turnIndex: 1,
        payload: { content: "Build the ledger." },
      }),
      entry({
        id: "e-run",
        parentId: "e-user",
        seq: 2,
        type: "run.started",
        runId: "run-1",
        turnIndex: 1,
        payload: {
          input: { prompt: "Build the ledger.", createdAt: BASE_TIME, context: {} },
          config: runConfig(),
        },
      }),
      entry({
        id: "e-events",
        parentId: "e-run",
        seq: 3,
        type: "runtime.event_batch",
        runId: "run-1",
        turnIndex: 1,
        payload: {
          status: "succeeded",
          events: [
            {
              id: "evt-1",
              runId: "run-1",
              seq: 0,
              type: "message.delta",
              createdAt: BASE_TIME + 3,
              pattern: "orchestrator_subagent",
              payload: { content: "Done." },
            },
          ],
        },
      }),
      entry({
        id: "e-assistant",
        parentId: "e-events",
        seq: 4,
        type: "assistant.message",
        runId: "run-1",
        turnIndex: 1,
        payload: { content: "Done.", status: "succeeded" },
      }),
    ]);

    const projection = deriveSessionProjection(ledger);
    const detail = runtimeSessionProjectionToDetail(projection);
    const snapshot = deriveRunSnapshot(ledger, "run-1");

    expect(projection.session).toMatchObject({
      sessionId: "session-ledger",
      title: "Ledger Session",
      latestRunId: "run-1",
      status: "succeeded",
      turnCount: 1,
    });
    expect(projection.session.attention).toEqual(projection.turns[0]?.attention);
    expect(projection.latestSnapshot?.attention).toEqual(projection.session.attention);
    expect(detail.transcript.map((message) => [message.role, message.content])).toEqual([
      ["user", "Build the ledger."],
      ["assistant", "Done."],
    ]);
    expect(snapshot?.events).toHaveLength(1);
    expect(snapshot?.status).toBe("succeeded");
  });

  it("uses gate entries as the only attention authority and ignores resolved stale raw events", () => {
    const ledger = baseLedger([
      entry({
        id: "e-run",
        parentId: "e-session",
        seq: 1,
        type: "run.started",
        runId: "run-1",
        turnIndex: 1,
        payload: {
          input: { prompt: "Need approval.", createdAt: BASE_TIME, context: {} },
          config: runConfig(),
        },
      }),
      entry({
        id: "e-approval-open",
        parentId: "e-run",
        seq: 2,
        type: "gate.opened",
        runId: "run-1",
        turnIndex: 1,
        payload: {
          gateId: "gate-approval",
          kind: "approval",
          pendingActionIds: ["action-1"],
        },
      }),
      entry({
        id: "e-clarification-open",
        parentId: "e-approval-open",
        seq: 3,
        type: "gate.opened",
        runId: "run-1",
        turnIndex: 1,
        payload: {
          gateId: "gate-clarification",
          kind: "clarification",
          pendingClarificationIds: ["clarification-1"],
        },
      }),
      entry({
        id: "e-clarification-resolved",
        parentId: "e-clarification-open",
        seq: 4,
        type: "gate.resolved",
        runId: "run-1",
        turnIndex: 1,
        payload: { gateId: "gate-clarification" },
      }),
      entry({
        id: "e-raw-stale",
        parentId: "e-clarification-resolved",
        seq: 5,
        type: "runtime.event_batch",
        runId: "run-1",
        turnIndex: 1,
        payload: {
          events: [{
            id: "evt-stale",
            runId: "run-1",
            seq: 0,
            type: "clarification.required",
            createdAt: BASE_TIME + 5,
            payload: { clarificationId: "clarification-1" },
          }],
        },
      }),
    ]);

    const projection = deriveSessionProjection(ledger);

    expect(projection.session.attention).toMatchObject({
      kind: "needs_approval",
      pendingActionIds: ["action-1"],
    });
    expect(projection.latestSnapshot?.pendingClarifications).toEqual([]);
    expect(projection.gates.find((gate) => gate.gateId === "gate-clarification")?.status).toBe("resolved");
  });

  it("projects gate.opened facts into run snapshot pending fields without raw gate events", () => {
    const clarification = {
      id: "clarification-1",
      key: "scope",
      nodeId: "ora",
      nodeLabel: "Ora",
      question: "Which scope?",
      options: [],
      requestedAt: BASE_TIME + 2,
    };
    const planDecision = {
      id: "decision-1",
      runId: "run-1",
      sessionId: "session-ledger",
      status: "pending" as const,
      planContent: "Ship the gate projection.",
      createdAt: BASE_TIME + 4,
    };
    const ledger = baseLedger([
      entry({
        id: "e-run",
        parentId: "e-session",
        seq: 1,
        type: "run.started",
        runId: "run-1",
        turnIndex: 1,
        payload: {
          input: { prompt: "Open gates.", createdAt: BASE_TIME, context: {} },
          config: runConfig(),
        },
      }),
      entry({
        id: "e-clarification-open",
        parentId: "e-run",
        seq: 2,
        type: "gate.opened",
        runId: "run-1",
        turnIndex: 1,
        payload: {
          gateId: "clarification-1",
          kind: "clarification",
          pendingClarificationIds: ["clarification-1"],
          clarification,
        },
      }),
      entry({
        id: "e-approval-open",
        parentId: "e-clarification-open",
        seq: 3,
        type: "gate.opened",
        runId: "run-1",
        turnIndex: 1,
        payload: {
          gateId: "run-1:approval",
          kind: "approval",
          pendingActionIds: ["action-1"],
          pendingToolCallIds: ["tool-call-1"],
        },
      }),
      entry({
        id: "e-plan-open",
        parentId: "e-approval-open",
        seq: 4,
        type: "gate.opened",
        runId: "run-1",
        turnIndex: 1,
        payload: {
          gateId: "decision-1",
          kind: "plan_decision",
          planDecision,
        },
      }),
    ]);

    const projection = deriveSessionProjection(ledger);
    const snapshot = deriveRunSnapshot(ledger, "run-1");

    expect(snapshot?.pendingClarifications).toEqual([clarification]);
    expect(snapshot?.pendingApprovals).toEqual(["action-1"]);
    expect(snapshot?.planDecisions).toEqual([planDecision]);
    expect(projection.gates.map((gate) => [gate.gateId, gate.kind])).toEqual([
      ["clarification-1", "clarification"],
      ["run-1:approval", "approval"],
      ["decision-1", "plan_decision"],
    ]);
  });

  it("projects gate.resolved facts into resume parity events without raw resolution events", () => {
    const interruptedSnapshot = StateSnapshotSchema.parse({
      runId: "run-1",
      sessionId: "session-ledger",
      turnIndex: 1,
      status: "interrupted",
      pattern: "orchestrator_subagent",
      modeId: "single_agent",
      input: { prompt: "Resolve gates.", createdAt: BASE_TIME, context: {} },
      config: runConfig(),
      topology: { nodes: [], edges: [] },
      profiles: [],
      memory: [],
      plan: [],
      planList: [],
      todos: [],
      actions: [{
        id: "action-1",
        runId: "run-1",
        type: "file.write",
        riskLevel: "high",
        status: "approval_required",
        input: { path: "notes.md" },
        artifactIds: [],
      }],
      toolCalls: [],
      continuation: { frames: [] },
      conversation: [],
      toolResults: [],
      policyDecisions: [],
      checkpoints: [],
      events: [{
        id: "evt-0",
        runId: "run-1",
        seq: 0,
        type: "approval.required",
        createdAt: BASE_TIME + 2,
        pattern: "orchestrator_subagent",
        payload: { actionId: "action-1" },
      }],
      agentMessages: [],
      artifacts: [],
      activeAgents: [],
      queueSummary: { mode: "dag", pending: 0, inProgress: 0, completed: 0, topics: [] },
      sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
      busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
      pendingClarifications: [{
        id: "clarification-1",
        key: "scope",
        nodeId: "ora",
        nodeLabel: "Ora",
        question: "Which scope?",
        options: [],
        requestedAt: BASE_TIME + 3,
      }],
      pendingApprovals: ["action-1"],
      updatedAt: BASE_TIME + 3,
    });
    const ledger = baseLedger([
      entry({
        id: "e-run",
        parentId: "e-session",
        seq: 1,
        type: "run.started",
        runId: "run-1",
        turnIndex: 1,
        payload: {
          input: { prompt: "Resolve gates.", createdAt: BASE_TIME, context: {} },
          config: runConfig(),
        },
      }),
      entry({
        id: "e-interrupted",
        parentId: "e-run",
        seq: 2,
        type: "runtime.event_batch",
        runId: "run-1",
        turnIndex: 1,
        payload: {
          status: "interrupted",
          snapshot: interruptedSnapshot,
          events: [{
            id: "evt-0",
            runId: "run-1",
            seq: 0,
            type: "approval.required",
            createdAt: BASE_TIME + 2,
            pattern: "orchestrator_subagent",
            payload: { actionId: "action-1" },
          }],
        },
      }),
      entry({
        id: "e-clarification-open",
        parentId: "e-interrupted",
        seq: 3,
        type: "gate.opened",
        runId: "run-1",
        turnIndex: 1,
        payload: {
          gateId: "clarification-1",
          kind: "clarification",
          pendingClarificationIds: ["clarification-1"],
        },
      }),
      entry({
        id: "e-approval-open",
        parentId: "e-clarification-open",
        seq: 4,
        type: "gate.opened",
        runId: "run-1",
        turnIndex: 1,
        payload: {
          gateId: "run-1:approval",
          kind: "approval",
          pendingActionIds: ["action-1"],
        },
      }),
      entry({
        id: "e-clarification-resolved",
        parentId: "e-approval-open",
        seq: 5,
        type: "gate.resolved",
        runId: "run-1",
        turnIndex: 1,
        payload: { gateId: "clarification-1", status: "resolved", resolvedAt: BASE_TIME + 5 },
      }),
      entry({
        id: "e-approval-resolved",
        parentId: "e-clarification-resolved",
        seq: 6,
        type: "gate.resolved",
        runId: "run-1",
        turnIndex: 1,
        payload: { gateId: "run-1:approval", status: "accepted", resolvedAt: BASE_TIME + 6 },
      }),
    ]);

    const snapshot = deriveRunSnapshot(ledger, "run-1");
    const projectedResolutions = snapshot?.events.filter((event) =>
      event.type === "clarification.resolved" || event.type === "approval.resolved"
    );

    expect(snapshot?.pendingClarifications).toEqual([]);
    expect(snapshot?.pendingApprovals).toEqual([]);
    expect(projectedResolutions).toEqual([
      expect.objectContaining({
        type: "clarification.resolved",
        payload: { clarificationId: "clarification-1", mode: "ledger_projection" },
      }),
      expect.objectContaining({
        type: "approval.resolved",
        payload: { actionId: "action-1", decision: "approved", mode: "ledger_projection" },
      }),
    ]);
  });

  it("applies canonical same-seq replay order before projecting gate facts into snapshots", () => {
    const approvalRequired = {
      id: "evt-approval-required",
      runId: "run-1",
      seq: 0,
      type: "approval.required" as const,
      createdAt: BASE_TIME + 10,
      pattern: "orchestrator_subagent" as const,
      payload: { actionId: "action-1" },
    };
    const interruptedSnapshot = snapshot({
      runId: "run-1",
      sessionId: "session-ledger",
      status: "interrupted",
      input: { prompt: "Resolve from ledger facts.", createdAt: BASE_TIME, context: {} },
      actions: [{
        id: "action-1",
        runId: "run-1",
        type: "file.write",
        riskLevel: "high",
        status: "approval_required",
        input: { path: "notes.md" },
        artifactIds: [],
      }],
      events: [approvalRequired],
      pendingApprovals: ["action-1"],
      updatedAt: BASE_TIME + 20,
    });
    const ledger = RuntimeSessionLedgerSchema.parse({
      sessionId: "session-ledger",
      entries: [
        entry({
          id: "a-gate-resolved",
          seq: 2,
          type: "gate.resolved",
          runId: "run-1",
          turnIndex: 1,
          createdAt: BASE_TIME + 1,
          payload: { gateId: "gate-approval", status: "accepted", resolvedAt: BASE_TIME + 1 },
        }),
        entry({
          id: "z-gate-opened",
          seq: 2,
          type: "gate.opened",
          runId: "run-1",
          turnIndex: 1,
          createdAt: BASE_TIME + 30,
          payload: {
            gateId: "gate-approval",
            kind: "approval",
            pendingActionIds: ["action-1"],
          },
        }),
        entry({
          id: "m-event-batch",
          seq: 2,
          type: "runtime.event_batch",
          runId: "run-1",
          turnIndex: 1,
          createdAt: BASE_TIME + 20,
          payload: {
            status: "interrupted",
            snapshot: interruptedSnapshot,
            events: [approvalRequired],
          },
        }),
        entry({
          id: "e-run",
          seq: 1,
          type: "run.started",
          runId: "run-1",
          turnIndex: 1,
          payload: {
            input: { prompt: "Resolve from ledger facts.", createdAt: BASE_TIME, context: {} },
            config: runConfig(),
          },
        }),
        entry({
          id: "e-session",
          seq: 0,
          type: "session.created",
          payload: { title: "Canonical replay order" },
        }),
      ],
    });

    expect(orderedRuntimeSessionEntries(ledger.entries).map((candidate) => candidate.id)).toEqual([
      "e-session",
      "e-run",
      "m-event-batch",
      "z-gate-opened",
      "a-gate-resolved",
    ]);

    const projectedSnapshot = deriveRunSnapshot(ledger, "run-1");

    expect(projectedSnapshot?.pendingApprovals).toEqual([]);
    expect(projectedSnapshot?.events.map((event) => event.type)).toEqual([
      "approval.required",
      "approval.resolved",
    ]);
    expect(projectedSnapshot?.events.at(-1)).toEqual(expect.objectContaining({
      type: "approval.resolved",
      payload: { actionId: "action-1", decision: "approved", mode: "ledger_projection" },
    }));
  });

  it("does not let duplicate opened gate facts resurrect a resolved gate", () => {
    const ledger = baseLedger([
      entry({
        id: "e-run",
        parentId: "e-session",
        seq: 1,
        type: "run.started",
        runId: "run-1",
        turnIndex: 1,
        payload: {
          input: { prompt: "Need approval.", createdAt: BASE_TIME, context: {} },
          config: runConfig(),
        },
      }),
      entry({
        id: "e-approval-open",
        parentId: "e-run",
        seq: 2,
        type: "gate.opened",
        runId: "run-1",
        turnIndex: 1,
        payload: {
          gateId: "gate-approval",
          kind: "approval",
          pendingActionIds: ["action-1"],
        },
      }),
      entry({
        id: "e-approval-resolved",
        parentId: "e-approval-open",
        seq: 3,
        type: "gate.resolved",
        runId: "run-1",
        turnIndex: 1,
        payload: { gateId: "gate-approval", status: "accepted", resolvedAt: BASE_TIME + 3 },
      }),
      entry({
        id: "e-approval-open-duplicate",
        parentId: "e-approval-resolved",
        seq: 4,
        type: "gate.opened",
        runId: "run-1",
        turnIndex: 1,
        payload: {
          gateId: "gate-approval",
          kind: "approval",
          pendingActionIds: ["action-1"],
        },
      }),
    ]);

    const projection = deriveSessionProjection(ledger);

    expect(projection.gates.find((gate) => gate.gateId === "gate-approval")).toMatchObject({
      status: "resolved",
      resolvedAt: BASE_TIME + 3,
    });
    expect(projection.latestSnapshot?.pendingApprovals).toEqual([]);
  });

  it("does not project a resolved human gate with no completion snapshot as an ordinary pause", () => {
    const ledger = baseLedger([
      entry({
        id: "e-run",
        parentId: "e-session",
        seq: 1,
        type: "run.started",
        runId: "run-1",
        turnIndex: 1,
        payload: {
          input: { prompt: "Need clarification.", createdAt: BASE_TIME, context: {} },
          config: runConfig(),
        },
      }),
      entry({
        id: "e-interrupted",
        parentId: "e-run",
        seq: 2,
        type: "runtime.event_batch",
        runId: "run-1",
        turnIndex: 1,
        payload: {
          status: "interrupted",
          events: [{
            id: "evt-clarification",
            runId: "run-1",
            seq: 0,
            type: "clarification.required",
            createdAt: BASE_TIME + 2,
            pattern: "orchestrator_subagent",
            payload: { clarificationId: "clarification-1" },
          }],
        },
      }),
      entry({
        id: "e-clarification-open",
        parentId: "e-interrupted",
        seq: 3,
        type: "gate.opened",
        runId: "run-1",
        turnIndex: 1,
        payload: {
          gateId: "clarification-1",
          kind: "clarification",
          pendingClarificationIds: ["clarification-1"],
        },
      }),
      entry({
        id: "e-clarification-resolved",
        parentId: "e-clarification-open",
        seq: 4,
        type: "gate.resolved",
        runId: "run-1",
        turnIndex: 1,
        payload: { gateId: "clarification-1", status: "resolved", resolvedAt: BASE_TIME + 4 },
      }),
    ]);

    const projection = deriveSessionProjection(ledger);

    expect(projection.session.status).toBe("interrupted");
    expect(projection.session.attention).toMatchObject({
      kind: "failed",
      reason: "resume_incomplete_after_gate_resolution",
    });
    expect(projection.latestSnapshot?.pendingClarifications).toEqual([]);
  });

  it("projects plan acceptance handoff and compaction context as ledger facts", () => {
    const ledger = baseLedger([
      entry({
        id: "e-plan-run",
        parentId: "e-session",
        seq: 1,
        type: "run.started",
        runId: "run-plan",
        turnIndex: 1,
        payload: {
          input: { prompt: "Plan.", createdAt: BASE_TIME, context: {} },
          config: runConfig({ taskIntent: "plan" }),
        },
      }),
      entry({
        id: "e-plan-gate",
        parentId: "e-plan-run",
        seq: 2,
        type: "gate.opened",
        runId: "run-plan",
        turnIndex: 1,
        payload: {
          gateId: "decision-1",
          kind: "plan_decision",
          planDecision: {
            id: "decision-1",
            runId: "run-plan",
            sessionId: "session-ledger",
            status: "pending",
            planContent: "Ship the ledger.",
            planSourceRunId: "run-plan",
            createdAt: BASE_TIME + 2,
          },
        },
      }),
      entry({
        id: "e-plan-resolved",
        parentId: "e-plan-gate",
        seq: 3,
        type: "gate.resolved",
        runId: "run-plan",
        turnIndex: 1,
        payload: { gateId: "decision-1", status: "accepted" },
      }),
      entry({
        id: "e-handoff",
        parentId: "e-plan-resolved",
        seq: 4,
        type: "handoff.accepted_plan",
        payload: {
          decisionId: "decision-1",
          sourceRunId: "run-plan",
          planContent: "Ship the ledger.",
          acceptedAt: BASE_TIME + 4,
        },
      }),
      entry({
        id: "e-plan-assistant",
        parentId: "e-handoff",
        seq: 5,
        type: "assistant.message",
        runId: "run-plan",
        turnIndex: 1,
        payload: { content: "Plan accepted.", status: "succeeded" },
      }),
      entry({
        id: "e-compaction",
        parentId: "e-plan-assistant",
        seq: 6,
        type: "compaction.summary",
        payload: {
          contextState: {
            compactedHistory: [{ role: "system", content: "Summary", createdAt: BASE_TIME + 6 }],
            compactedThroughTurnIndex: 1,
            activeTokenUsage: { totalTokens: 10 },
            contextWindow: 100,
            autoCompactTokenLimit: 80,
            updatedAt: BASE_TIME + 6,
          },
        },
      }),
    ]);

    const projection = deriveSessionProjection(ledger);

    expect(projection.session.attention?.kind).toBe("idle");
    expect(projection.runs[0]?.planDecisions[0]?.status).toBe("accepted");
    expect(projection.acceptedPlanHandoffs).toEqual([{
      decisionId: "decision-1",
      sourceRunId: "run-plan",
      planContent: "Ship the ledger.",
      acceptedAt: BASE_TIME + 4,
    }]);
    expect(projection.contextState?.compactedHistory[0]?.content).toBe("Summary");
  });

  it("folds accepted plan handoff consumption facts by decision and source run", () => {
    const ledger = RuntimeSessionLedgerSchema.parse({
      sessionId: "session-ledger",
      leafEntryId: "e-handoff-consumed",
      entries: [
        entry({ id: "e-session", seq: 0, type: "session.created", payload: {} }),
        entry({
          id: "e-handoff-open",
          parentId: "e-session",
          seq: 1,
          type: "handoff.accepted_plan",
          payload: {
            decisionId: "decision-1",
            sourceRunId: "run-plan",
            planContent: "Ship the ledger.",
            acceptedAt: BASE_TIME + 1,
          },
        }),
        entry({
          id: "e-handoff-consumed",
          parentId: "e-handoff-open",
          seq: 2,
          type: "handoff.accepted_plan",
          payload: {
            decisionId: "decision-1",
            sourceRunId: "run-plan",
            planContent: "Ship the ledger.",
            acceptedAt: BASE_TIME + 1,
            consumedByRunId: "run-implement",
          },
        }),
      ],
    });

    const projection = deriveSessionProjection(ledger);

    expect(projection.acceptedPlanHandoffs).toEqual([{
      decisionId: "decision-1",
      sourceRunId: "run-plan",
      planContent: "Ship the ledger.",
      acceptedAt: BASE_TIME + 1,
      consumedByRunId: "run-implement",
    }]);
  });

  it("walks the selected branch leaf path without rewriting sibling entries", () => {
    const ledger = RuntimeSessionLedgerSchema.parse({
      sessionId: "session-ledger",
      leafEntryId: "e-main-assistant",
      entries: [
        entry({ id: "e-session", seq: 0, type: "session.created", payload: { title: "Branching" } }),
        entry({
          id: "e-main-run",
          parentId: "e-session",
          seq: 1,
          type: "run.started",
          runId: "run-main",
          turnIndex: 1,
          payload: { input: { prompt: "Main.", createdAt: BASE_TIME, context: {} }, config: runConfig() },
        }),
        entry({
          id: "e-main-assistant",
          parentId: "e-main-run",
          seq: 2,
          type: "assistant.message",
          runId: "run-main",
          turnIndex: 1,
          payload: { content: "Main output.", status: "succeeded" },
        }),
        entry({
          id: "e-candidate-run",
          parentId: "e-session",
          seq: 3,
          type: "run.started",
          runId: "run-candidate",
          turnIndex: 1,
          payload: { input: { prompt: "Candidate.", createdAt: BASE_TIME, context: {} }, config: runConfig() },
        }),
        entry({
          id: "e-candidate-assistant",
          parentId: "e-candidate-run",
          seq: 4,
          type: "assistant.message",
          runId: "run-candidate",
          turnIndex: 1,
          payload: { content: "Candidate output.", status: "succeeded" },
        }),
      ],
    });

    expect(runtimeSessionEntryPath(ledger).map((candidate) => candidate.id)).toEqual([
      "e-session",
      "e-main-run",
      "e-main-assistant",
    ]);
    expect(deriveSessionProjection(ledger).session.latestRunId).toBe("run-main");
    expect(deriveSessionProjection(ledger, "e-candidate-assistant").session.latestRunId).toBe("run-candidate");
  });

  it("keeps candidate gate facts isolated to the candidate leaf path", () => {
    const candidateSnapshot = StateSnapshotSchema.parse({
      runId: "run-candidate",
      sessionId: "session-ledger",
      turnIndex: 1,
      status: "interrupted",
      pattern: "orchestrator_subagent",
      modeId: "single_agent",
      input: { prompt: "Candidate prompt.", createdAt: BASE_TIME, context: {} },
      config: runConfig({ branchRole: "candidate", branchGroupId: "branch-1" }),
      topology: { nodes: [], edges: [] },
      profiles: [],
      memory: [],
      plan: [],
      planList: [],
      todos: [],
      actions: [{
        id: "action-candidate",
        runId: "run-candidate",
        type: "file.write",
        riskLevel: "high",
        status: "approval_required",
        input: { path: "candidate.md" },
        artifactIds: [],
      }],
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
      pendingApprovals: ["action-candidate"],
      updatedAt: BASE_TIME + 5,
    });
    const ledger = RuntimeSessionLedgerSchema.parse({
      sessionId: "session-ledger",
      leafEntryId: "e-branch-candidate-started",
      entries: [
        entry({ id: "e-session", seq: 0, type: "session.created", payload: { title: "Branching" } }),
        entry({
          id: "e-branch-created",
          parentId: "e-session",
          seq: 1,
          type: "branch.created",
          payload: {
            branchGroupId: "branch-1",
            sessionId: "session-ledger",
            target: "empty_start",
            baseTurnIndex: 0,
            prompt: "Try candidate.",
            status: "running",
            candidateRunIds: [],
            candidates: [],
            createdAt: BASE_TIME + 1,
            updatedAt: BASE_TIME + 1,
          },
        }),
        entry({
          id: "e-branch-candidate-started",
          parentId: "e-branch-created",
          seq: 2,
          type: "branch.candidate_started",
          runId: "run-candidate",
          payload: {
            branchGroupId: "branch-1",
            sessionId: "session-ledger",
            target: "empty_start",
            baseTurnIndex: 0,
            prompt: "Try candidate.",
            status: "running",
            candidateRunIds: ["run-candidate"],
            candidates: [],
            createdAt: BASE_TIME + 1,
            updatedAt: BASE_TIME + 2,
          },
        }),
        entry({
          id: "e-candidate-user",
          parentId: "e-branch-created",
          seq: 3,
          type: "user.message",
          runId: "run-candidate",
          turnIndex: 1,
          payload: { content: "Candidate prompt." },
        }),
        entry({
          id: "e-candidate-run",
          parentId: "e-candidate-user",
          seq: 4,
          type: "run.started",
          runId: "run-candidate",
          turnIndex: 1,
          payload: {
            input: { prompt: "Candidate prompt.", createdAt: BASE_TIME, context: {} },
            config: runConfig({ branchRole: "candidate", branchGroupId: "branch-1" }),
          },
        }),
        entry({
          id: "e-candidate-update",
          parentId: "e-candidate-run",
          seq: 5,
          type: "runtime.event_batch",
          runId: "run-candidate",
          turnIndex: 1,
          payload: {
            status: "interrupted",
            snapshot: candidateSnapshot,
            events: [],
          },
        }),
        entry({
          id: "e-candidate-gate",
          parentId: "e-candidate-update",
          seq: 6,
          type: "gate.opened",
          runId: "run-candidate",
          turnIndex: 1,
          payload: {
            gateId: "run-candidate:approval",
            kind: "approval",
            pendingActionIds: ["action-candidate"],
          },
        }),
        entry({
          id: "e-candidate-gate-resolved",
          parentId: "e-candidate-gate",
          seq: 7,
          type: "gate.resolved",
          runId: "run-candidate",
          turnIndex: 1,
          payload: {
            gateId: "run-candidate:approval",
            status: "accepted",
            resolvedAt: BASE_TIME + 6,
          },
        }),
      ],
    });

    const mainlineProjection = deriveSessionProjection(ledger);
    const openedProjection = deriveSessionProjection(ledger, "e-candidate-gate");
    const resolvedSnapshot = deriveRunSnapshot(ledger, "run-candidate", "e-candidate-gate-resolved");

    expect(mainlineProjection.runs.map((run) => run.runId)).toEqual([]);
    expect(mainlineProjection.gates.map((gate) => gate.gateId)).toEqual([]);
    expect(openedProjection.runs.map((run) => run.runId)).toEqual(["run-candidate"]);
    expect(openedProjection.gates).toEqual([
      expect.objectContaining({
        gateId: "run-candidate:approval",
        status: "open",
        pendingActionIds: ["action-candidate"],
      }),
    ]);
    expect(openedProjection.session.attention).toMatchObject({
      kind: "needs_approval",
      sourceRunId: "run-candidate",
      pendingActionIds: ["action-candidate"],
    });
    expect(resolvedSnapshot?.pendingApprovals).toEqual([]);
    expect(resolvedSnapshot?.events).toEqual([
      expect.objectContaining({
        type: "approval.resolved",
        payload: { actionId: "action-candidate", decision: "approved", mode: "ledger_projection" },
      }),
    ]);
  });

  it("applies selected leaf paths in parent-chain order when repaired seq values are stale", () => {
    const ledger = RuntimeSessionLedgerSchema.parse({
      sessionId: "session-ledger",
      leafEntryId: "e-assistant",
      entries: [
        entry({ id: "e-session", seq: 0, type: "session.created", payload: { title: "Repaired" } }),
        entry({
          id: "e-run",
          parentId: "e-session",
          seq: 5,
          type: "run.started",
          runId: "run-1",
          turnIndex: 1,
          payload: { input: { prompt: "Recover ordering.", createdAt: BASE_TIME, context: {} }, config: runConfig() },
        }),
        entry({
          id: "e-assistant",
          parentId: "e-run",
          seq: 4,
          type: "assistant.message",
          runId: "run-1",
          turnIndex: 1,
          payload: { content: "Recovered.", status: "succeeded" },
        }),
        entry({
          id: "e-sibling",
          parentId: "e-session",
          seq: 1,
          type: "assistant.message",
          runId: "run-sibling",
          turnIndex: 1,
          payload: { content: "Wrong path.", status: "succeeded" },
        }),
      ],
    });

    expect(runtimeSessionEntryPath(ledger).map((candidate) => candidate.id)).toEqual([
      "e-session",
      "e-run",
      "e-assistant",
    ]);

    const projection = deriveSessionProjection(ledger);

    expect(projection.session.latestRunId).toBe("run-1");
    expect(projection.session.status).toBe("succeeded");
    expect(projection.transcript.map((message) => message.content)).toEqual(["Recovered."]);
    expect(projection.latestSnapshot?.output).toEqual({ text: "Recovered." });
  });

  it("hides replaced run transcript entries from the adopted mainline projection", () => {
    const ledger = baseLedger([
      entry({
        id: "e-old-user",
        parentId: "e-session",
        seq: 1,
        type: "user.message",
        runId: "run-old",
        turnIndex: 1,
        payload: { content: "Old prompt." },
      }),
      entry({
        id: "e-old-run",
        parentId: "e-old-user",
        seq: 2,
        type: "run.started",
        runId: "run-old",
        turnIndex: 1,
        payload: { input: { prompt: "Old prompt.", createdAt: BASE_TIME, context: {} }, config: runConfig() },
      }),
      entry({
        id: "e-old-assistant",
        parentId: "e-old-run",
        seq: 3,
        type: "assistant.message",
        runId: "run-old",
        turnIndex: 1,
        payload: { content: "Old output.", status: "succeeded" },
      }),
      entry({
        id: "e-adopted-user",
        parentId: "e-old-assistant",
        seq: 4,
        type: "user.message",
        runId: "run-adopted",
        turnIndex: 1,
        payload: { content: "Replacement prompt." },
      }),
      entry({
        id: "e-adopted-run",
        parentId: "e-adopted-user",
        seq: 5,
        type: "run.started",
        runId: "run-adopted",
        turnIndex: 1,
        payload: {
          input: { prompt: "Replacement prompt.", createdAt: BASE_TIME, context: {} },
          config: runConfig({
            branchRole: "adopted",
            branchTarget: "replace_latest",
            branchReplaceRunId: "run-old",
          }),
        },
      }),
      entry({
        id: "e-adopted-assistant",
        parentId: "e-adopted-run",
        seq: 6,
        type: "assistant.message",
        runId: "run-adopted",
        turnIndex: 1,
        payload: { content: "Replacement output.", status: "succeeded" },
      }),
      entry({
        id: "e-branch-adopted",
        parentId: "e-adopted-assistant",
        seq: 7,
        type: "branch.adopted",
        payload: {
          branchGroupId: "branch-1",
          sessionId: "session-ledger",
          target: "replace_latest",
          replaceRunId: "run-old",
          baseTurnIndex: 1,
          prompt: "Replacement prompt.",
          status: "adopted",
          candidateRunIds: ["run-adopted"],
          candidates: [],
          adoptedRunId: "run-adopted",
          createdAt: BASE_TIME + 7,
          updatedAt: BASE_TIME + 7,
        },
      }),
    ]);

    const projection = deriveSessionProjection(ledger);

    expect(projection.turns.map((turn) => turn.runId)).toEqual(["run-adopted"]);
    expect(projection.transcript.map((message) => message.content)).toEqual([
      "Replacement prompt.",
      "Replacement output.",
    ]);
  });
});
