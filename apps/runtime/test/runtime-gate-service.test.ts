import { describe, expect, it } from "vitest";
import { StateSnapshotSchema, type PendingClarification, type PlanDecisionGate } from "@cemeworm/shared";
import {
  approvalGateId,
  createRuntimeGateAppendAdapter,
  type RuntimeGateAppendAdapter,
  type RuntimeGateLifecycleResult,
  RuntimeGateService,
} from "../src/runtime-gate-service.js";
import { createRuntimeGateRunAppendAdapter } from "../src/runtime-gate-run-append-adapter.js";

const gateService = new RuntimeGateService();

class RecordingGateAppendAdapter implements RuntimeGateAppendAdapter {
  readonly appended: RuntimeGateLifecycleResult[] = [];

  appendGateLifecycleResult(result: RuntimeGateLifecycleResult): void {
    this.appended.push(result);
  }
}

function snapshot(overrides: { omitTurnIndex?: boolean; metadata?: Record<string, unknown> } = {}) {
  return StateSnapshotSchema.parse({
    runId: "run-gates-1",
    sessionId: "session-gates-1",
    ...(overrides.omitTurnIndex ? {} : { turnIndex: 4 }),
    status: "interrupted",
    pattern: "orchestrator_subagent",
    modeId: "single_agent",
    input: { prompt: "Gate check.", context: {}, createdAt: 1_000 },
    config: {
      pattern: "orchestrator_subagent",
      profileIds: [],
      skillIds: [],
      toolIds: [],
      modelRef: "local/test-model",
      approvalMode: "high_risk_only",
      patternOptions: {},
      metadata: overrides.metadata ?? {},
    },
    topology: { nodes: [], edges: [] },
    profiles: [],
    memory: [],
    plan: [],
    todos: [],
    actions: [{
      id: "action-write",
      runId: "run-gates-1",
      type: "file.write",
      riskLevel: "high",
      status: "approval_required",
      input: { path: "notes.md" },
      artifactIds: [],
    }],
    toolCalls: [
      {
        id: "tool-write",
        runId: "run-gates-1",
        actionId: "action-write",
        toolId: "file.write",
        args: { path: "notes.md" },
        source: "json_fallback",
        status: "approval_required",
        requestedAt: 1_200,
        updatedAt: 1_200,
      },
      {
        id: "tool-other",
        runId: "run-gates-1",
        actionId: "action-other",
        toolId: "file.read",
        args: {},
        source: "json_fallback",
        status: "succeeded",
        requestedAt: 1_250,
        updatedAt: 1_250,
      },
    ],
    continuation: { frames: [] },
    conversation: [],
    toolResults: [],
    policyDecisions: [],
    checkpoints: [],
    events: [],
    agentMessages: [],
    artifacts: [],
    activeAgents: [],
    queueSummary: {},
    sharedStateSummary: {},
    busStats: {},
    pendingApprovals: ["action-write"],
    pendingClarifications: [],
    updatedAt: 1_500,
  });
}

describe("RuntimeGateService", () => {
  it("builds opened gate entries in the existing persisted order", () => {
    const currentSnapshot = snapshot();
    const clarification: PendingClarification = {
      id: "clarify-scope",
      key: "scope",
      nodeId: "router",
      nodeLabel: "Router",
      question: "What scope?",
      options: [],
      requestedAt: 1_300,
    };
    const decision: PlanDecisionGate = {
      id: "decision-1",
      runId: "run-gates-1",
      sessionId: "session-gates-1",
      status: "pending",
      planContent: "Plan content.",
      createdAt: 1_400,
    };

    const entries = gateService.openedEntries({
      runId: currentSnapshot.runId,
      turnIndex: currentSnapshot.turnIndex,
      updatedAt: currentSnapshot.updatedAt,
      pendingClarifications: [clarification],
      pendingApprovals: currentSnapshot.pendingApprovals,
      toolCalls: currentSnapshot.toolCalls,
      planDecisions: [
        decision,
        { ...decision, id: "decision-resolved", status: "accepted" },
      ],
    });

    expect(entries.map((entry) => entry.payload)).toEqual([
      expect.objectContaining({ kind: "clarification", gateId: "clarify-scope" }),
      expect.objectContaining({
        kind: "approval",
        gateId: "run-gates-1:approval",
        pendingActionIds: ["action-write"],
        pendingToolCallIds: ["tool-write"],
      }),
      expect.objectContaining({ kind: "plan_decision", gateId: "decision-1" }),
    ]);
  });

  it("opens snapshot gates through the lifecycle owner without changing entry order", () => {
    const currentSnapshot = StateSnapshotSchema.parse({
      ...snapshot(),
      pendingClarifications: [{
        id: "clarify-scope",
        key: "scope",
        nodeId: "router",
        nodeLabel: "Router",
        question: "What scope?",
        options: [],
        requestedAt: 1_300,
      }],
      planDecisions: [{
        id: "decision-1",
        runId: "run-gates-1",
        sessionId: "session-gates-1",
        status: "pending",
        planContent: "Plan content.",
        createdAt: 1_400,
      }],
    });

    const entries = gateService.openSnapshotGates({
      snapshot: currentSnapshot,
      existingEntryIds: ["run-gates-1:gate:approval"],
    });

    expect(entries.map((entry) => entry.id)).toEqual([
      "run-gates-1:gate:clarify-scope",
      "run-gates-1:gate:decision-1",
    ]);
  });

  it("models snapshot-open append lifecycle results without changing persisted entry shapes", () => {
    const currentSnapshot = StateSnapshotSchema.parse({
      ...snapshot(),
      pendingClarifications: [{
        id: "clarify-scope",
        key: "scope",
        nodeId: "router",
        nodeLabel: "Router",
        question: "What scope?",
        options: [],
        requestedAt: 1_300,
      }],
    });
    const adapter = new RecordingGateAppendAdapter();

    const result = gateService.openSnapshotGateLifecycle({
      snapshot: currentSnapshot,
    });
    adapter.appendGateLifecycleResult(result);

    expect(adapter.appended).toEqual([{
      kind: "snapshot_open",
      entries: [
        {
          id: "run-gates-1:gate:clarify-scope",
          type: "gate.opened",
          runId: "run-gates-1",
          turnIndex: 4,
          createdAt: 1_300,
          payload: {
            gateId: "clarify-scope",
            kind: "clarification",
            pendingClarificationIds: ["clarify-scope"],
            clarification: currentSnapshot.pendingClarifications[0],
          },
        },
        {
          id: "run-gates-1:gate:approval",
          type: "gate.opened",
          runId: "run-gates-1",
          turnIndex: 4,
          createdAt: 1_500,
          payload: {
            gateId: "run-gates-1:approval",
            kind: "approval",
            pendingActionIds: ["action-write"],
            pendingToolCallIds: ["tool-write"],
          },
        },
      ],
    }]);
  });

  it("skips opened gate entries that already exist in the ledger", () => {
    const currentSnapshot = snapshot();
    const clarification: PendingClarification = {
      id: "clarify-scope",
      key: "scope",
      nodeId: "router",
      nodeLabel: "Router",
      question: "What scope?",
      options: [],
      requestedAt: 1_300,
    };
    const decision: PlanDecisionGate = {
      id: "decision-1",
      runId: "run-gates-1",
      sessionId: "session-gates-1",
      status: "pending",
      planContent: "Plan content.",
      createdAt: 1_400,
    };

    const entries = gateService.openedEntries({
      runId: currentSnapshot.runId,
      turnIndex: currentSnapshot.turnIndex,
      updatedAt: currentSnapshot.updatedAt,
      pendingClarifications: [clarification],
      pendingApprovals: currentSnapshot.pendingApprovals,
      toolCalls: currentSnapshot.toolCalls,
      planDecisions: [decision],
      existingEntryIds: [
        "run-gates-1:gate:clarify-scope",
        "run-gates-1:gate:approval",
      ],
    });

    expect(entries.map((entry) => entry.id)).toEqual(["run-gates-1:gate:decision-1"]);
  });

  it("builds clarification opened ledger entries with the existing shape", () => {
    const clarification: PendingClarification = {
      id: "clarify-scope",
      key: "scope",
      nodeId: "router",
      nodeLabel: "Router",
      question: "What scope?",
      options: [],
      requestedAt: 1_300,
    };

    const currentSnapshot = snapshot();
    expect(gateService.clarificationOpenedEntry({
      runId: currentSnapshot.runId,
      turnIndex: currentSnapshot.turnIndex,
      clarification,
    })).toEqual({
      id: "run-gates-1:gate:clarify-scope",
      type: "gate.opened",
      runId: "run-gates-1",
      turnIndex: 4,
      createdAt: 1_300,
      payload: {
        gateId: "clarify-scope",
        kind: "clarification",
        pendingClarificationIds: ["clarify-scope"],
        clarification,
      },
    });
  });

  it("builds approval opened ledger entries with the grouped approval gate id", () => {
    const currentSnapshot = snapshot();
    expect(gateService.approvalOpenedEntry({
      runId: currentSnapshot.runId,
      turnIndex: currentSnapshot.turnIndex,
      createdAt: currentSnapshot.updatedAt,
      pendingActionIds: currentSnapshot.pendingApprovals,
      pendingToolCallIds: ["tool-write"],
    })).toEqual({
      id: "run-gates-1:gate:approval",
      type: "gate.opened",
      runId: "run-gates-1",
      turnIndex: 4,
      createdAt: 1_500,
      payload: {
        gateId: "run-gates-1:approval",
        kind: "approval",
        pendingActionIds: ["action-write"],
        pendingToolCallIds: ["tool-write"],
      },
    });
  });

  it("builds plan decision opened ledger entries without changing the decision payload", () => {
    const decision: PlanDecisionGate = {
      id: "decision-1",
      runId: "run-gates-1",
      sessionId: "session-gates-1",
      status: "pending",
      planContent: "Plan content.",
      createdAt: 1_400,
    };

    const currentSnapshot = snapshot();
    expect(gateService.planDecisionOpenedEntry({
      runId: currentSnapshot.runId,
      turnIndex: currentSnapshot.turnIndex,
      decision,
    })).toEqual({
      id: "run-gates-1:gate:decision-1",
      type: "gate.opened",
      runId: "run-gates-1",
      turnIndex: 4,
      createdAt: 1_400,
      payload: {
        gateId: "decision-1",
        kind: "plan_decision",
        planDecision: decision,
      },
    });
  });

  it("builds resolved ledger entries with explicit ids when resume paths need timestamped entries", () => {
    expect(gateService.resolvedEntry({
      runId: "run-gates-1",
      turnIndex: 4,
      gateId: "clarify-scope",
      status: "resolved",
      resolvedAt: 2_000,
      entryId: "run-gates-1:gate:clarify-scope:resolved-2000",
    })).toEqual({
      id: "run-gates-1:gate:clarify-scope:resolved-2000",
      type: "gate.resolved",
      runId: "run-gates-1",
      turnIndex: 4,
      createdAt: 2_000,
      payload: {
        gateId: "clarify-scope",
        status: "resolved",
        resolvedAt: 2_000,
      },
    });
  });

  it("resolves resume gates through the lifecycle owner", () => {
    const currentSnapshot = StateSnapshotSchema.parse({
      ...snapshot(),
      pendingClarifications: [
        {
          id: "clarify-scope",
          key: "scope",
          nodeId: "router",
          nodeLabel: "Router",
          question: "What scope?",
          options: [],
          requestedAt: 1_300,
        },
        {
          id: "clarify-unused",
          key: "unused",
          nodeId: "router",
          nodeLabel: "Router",
          question: "Unused?",
          options: [],
          requestedAt: 1_350,
        },
      ],
    });

    const resolutions = gateService.resumeResolutions({
      snapshot: currentSnapshot,
      clarificationPatch: { scope: "pilot", unknown: "ignored" },
      approvedActionIds: ["action-write", "action-missing", "action-write"],
    });

    expect(resolutions).toEqual([
      {
        kind: "clarification",
        gateId: "clarify-scope",
        value: "pilot",
      },
      {
        kind: "approval",
        actionId: "action-write",
      },
    ]);

    const entries = gateService.resolveResumeGates({
      snapshot: currentSnapshot,
      resolutions,
      resolvedAt: 2_000,
    });

    expect(entries).toEqual([
      expect.objectContaining({
        id: "run-gates-1:gate:clarify-scope:resolved-2000",
        payload: {
          gateId: "clarify-scope",
          status: "resolved",
          resolvedAt: 2_000,
        },
      }),
      expect.objectContaining({
        id: "run-gates-1:gate:approval:resolved-2000",
        payload: {
          gateId: "run-gates-1:approval",
          status: "accepted",
          resolvedAt: 2_000,
        },
      }),
    ]);
  });

  it("models resume-resolution append lifecycle results without moving append ownership", () => {
    const currentSnapshot = StateSnapshotSchema.parse({
      ...snapshot(),
      pendingClarifications: [{
        id: "clarify-scope",
        key: "scope",
        nodeId: "router",
        nodeLabel: "Router",
        question: "What scope?",
        options: [],
        requestedAt: 1_300,
      }],
    });
    const adapter = new RecordingGateAppendAdapter();
    const resolutions = gateService.resumeResolutions({
      snapshot: currentSnapshot,
      clarificationPatch: { scope: "pilot" },
      approvedActionIds: ["action-write"],
    });

    const result = gateService.resolveResumeGateLifecycle({
      snapshot: currentSnapshot,
      resolutions,
      resolvedAt: 2_000,
    });
    adapter.appendGateLifecycleResult(result);

    expect(adapter.appended).toEqual([{
      kind: "resume_resolve",
      entries: [
        {
          id: "run-gates-1:gate:clarify-scope:resolved-2000",
          type: "gate.resolved",
          runId: "run-gates-1",
          turnIndex: 4,
          createdAt: 2_000,
          payload: {
            gateId: "clarify-scope",
            status: "resolved",
            resolvedAt: 2_000,
          },
        },
        {
          id: "run-gates-1:gate:approval:resolved-2000",
          type: "gate.resolved",
          runId: "run-gates-1",
          turnIndex: 4,
          createdAt: 2_000,
          payload: {
            gateId: "run-gates-1:approval",
            status: "accepted",
            resolvedAt: 2_000,
          },
        },
      ],
    }]);
  });

  it("builds plan-decision resolved ledger entries with the non-timestamped legacy id", () => {
    expect(gateService.resolvePlanDecisionGate({
      runId: "run-gates-1",
      turnIndex: 4,
      decisionId: "decision-1",
      status: "accepted",
      resolvedAt: 2_000,
    })).toEqual({
      id: "run-gates-1:gate:decision-1:resolved",
      type: "gate.resolved",
      runId: "run-gates-1",
      turnIndex: 4,
      createdAt: 2_000,
      payload: {
        gateId: "decision-1",
        status: "accepted",
        resolvedAt: 2_000,
      },
    });
  });

  it("models plan-decision append lifecycle results with the legacy resolved id shape", () => {
    const adapter = new RecordingGateAppendAdapter();

    const result = gateService.resolvePlanDecisionGateLifecycle({
      runId: "run-gates-1",
      turnIndex: 4,
      decisionId: "decision-1",
      status: "declined",
      resolvedAt: 2_000,
    });
    adapter.appendGateLifecycleResult(result);

    expect(adapter.appended).toEqual([{
      kind: "plan_decision_resolve",
      entries: [{
        id: "run-gates-1:gate:decision-1:resolved",
        type: "gate.resolved",
        runId: "run-gates-1",
        turnIndex: 4,
        createdAt: 2_000,
        payload: {
          gateId: "decision-1",
          status: "declined",
          resolvedAt: 2_000,
        },
      }],
    }]);
  });

  it("creates append adapters that replay lifecycle result entries", () => {
    const appended: RuntimeGateLifecycleResult["entries"] = [];
    const adapter = createRuntimeGateAppendAdapter((entry) => {
      appended.push(entry);
    });

    adapter.appendGateLifecycleResult(gateService.resolvePlanDecisionGateLifecycle({
      runId: "run-gates-1",
      turnIndex: 4,
      decisionId: "decision-1",
      status: "accepted",
      resolvedAt: 2_000,
    }));

    expect(appended).toEqual([{
      id: "run-gates-1:gate:decision-1:resolved",
      type: "gate.resolved",
      runId: "run-gates-1",
      turnIndex: 4,
      createdAt: 2_000,
      payload: {
        gateId: "decision-1",
        status: "accepted",
        resolvedAt: 2_000,
      },
    }]);
  });

  it("creates run-scoped append adapters for gate lifecycle entries", () => {
    const currentSnapshot = snapshot();
    const appended: Array<{ runId: string; entryId: string; candidateParentId?: string }> = [];
    const adapter = createRuntimeGateRunAppendAdapter({
      snapshot: currentSnapshot,
      appendRunLedgerEntry: (runSnapshot, entry, options) => {
        appended.push({ runId: runSnapshot.runId, entryId: entry.id, candidateParentId: options?.candidateParentId });
        return {
          ...entry,
          sessionId: runSnapshot.sessionId ?? "session-gates-1",
          seq: appended.length - 1,
        };
      },
    });

    adapter.appendGateLifecycleResult(gateService.resolvePlanDecisionGateLifecycle({
      runId: currentSnapshot.runId,
      turnIndex: currentSnapshot.turnIndex,
      decisionId: "decision-1",
      status: "accepted",
      resolvedAt: 2_000,
    }));

    expect(appended).toEqual([{
      runId: "run-gates-1",
      entryId: "run-gates-1:gate:decision-1:resolved",
      candidateParentId: undefined,
    }]);
  });

  it("lets run-scoped append adapters own candidate append options", () => {
    const currentSnapshot = snapshot({ metadata: { branchRole: "candidate" } });
    const appended: Array<{ entryId: string; candidateParentId?: string }> = [];
    const adapter = createRuntimeGateRunAppendAdapter({
      snapshot: currentSnapshot,
      candidateParentId: () => "candidate-leaf-1",
      appendRunLedgerEntry: (_runSnapshot, entry, options) => {
        appended.push({ entryId: entry.id, candidateParentId: options?.candidateParentId });
        return {
          ...entry,
          sessionId: currentSnapshot.sessionId ?? "session-gates-1",
          seq: appended.length - 1,
        };
      },
    });

    adapter.appendGateLifecycleResult(gateService.resolvePlanDecisionGateLifecycle({
      runId: currentSnapshot.runId,
      turnIndex: currentSnapshot.turnIndex,
      decisionId: "decision-1",
      status: "accepted",
      resolvedAt: 2_000,
    }));

    expect(appended).toEqual([{
      entryId: "run-gates-1:gate:decision-1:resolved",
      candidateParentId: "candidate-leaf-1",
    }]);
  });

  it("falls back to turn index 1 for compatibility with defaulted snapshots", () => {
    const clarification: PendingClarification = {
      id: "clarify-scope",
      key: "scope",
      nodeId: "router",
      nodeLabel: "Router",
      question: "What scope?",
      options: [],
      requestedAt: 1_300,
    };

    const currentSnapshot = snapshot({ omitTurnIndex: true });
    expect(gateService.clarificationOpenedEntry({
      runId: currentSnapshot.runId,
      turnIndex: currentSnapshot.turnIndex,
      clarification,
    }).turnIndex).toBe(1);
    expect(gateService.resolvedEntry({
      runId: "run-gates-1",
      gateId: approvalGateId("run-gates-1"),
      status: "accepted",
      resolvedAt: 2_000,
      entryId: "run-gates-1:gate:approval:resolved-2000",
    })).toMatchObject({
      id: "run-gates-1:gate:approval:resolved-2000",
      turnIndex: 1,
      payload: {
        gateId: "run-gates-1:approval",
        status: "accepted",
      },
    });
  });
});
