import { describe, expect, it } from "vitest";
import { deriveRunInteractionState } from "./runInteractionState";
import type { OraSessionDetail, OraSessionSummary, OraStateSnapshot } from "./runtimeClient";
import type { PendingRunState, RunLifecycle } from "./state";
import type { DeriveRunInteractionStateParams } from "./runInteractionState";

function sessionSummary(
  overrides: Partial<OraSessionSummary> = {},
): OraSessionSummary {
  return {
    sessionId: "session-1",
    title: "Test Session",
    turnCount: 3,
    createdAt: 500,
    updatedAt: 1000,
    ...overrides,
  } as OraSessionSummary;
}

function activeDetail(
  overrides: Partial<OraSessionDetail> = {},
): OraSessionDetail {
  return {
    session: sessionSummary(),
    turns: [],
    transcript: [],
    ...overrides,
  };
}

function turn(
  overrides: Partial<OraSessionDetail["turns"][number]> = {},
): OraSessionDetail["turns"][number] {
  return {
    runId: "run-1",
    sessionId: "session-1",
    turnIndex: 1,
    status: "running",
    pattern: "agent_teams",
    prompt: "test prompt",
    startedAt: 1000,
    updatedAt: 2000,
    eventCount: 5,
    checkpointCount: 1,
    artifactCount: 0,
    ...overrides,
  };
}

function activeSnapshot(
  overrides: Partial<OraStateSnapshot> = {},
): OraStateSnapshot {
  return {
    runId: "run-1",
    sessionId: "session-1",
    turnIndex: 1,
    status: "running",
    pattern: "agent_teams" as OraStateSnapshot["pattern"],
    input: {
      prompt: "test prompt",
      createdAt: 1000,
      context: {},
    },
    config: {
      providerId: "test-provider",
      modelRef: "test-model",
      toolIds: [],
      skillIds: [],
      metadata: {},
      pattern: "agent_teams",
      approvalMode: "auto",
      permissionMode: "default",
      modeSelection: "manual",
      profileIds: [],
      patternOptions: {},
      deterministicSeed: "test",
    } as OraStateSnapshot["config"],
    topology: { nodes: [], edges: [] },
    profiles: [],
    events: [],
    memory: [],
    plan: [],
    todos: [],
    continuation: { frames: [] },
    conversation: [],
    toolResults: [],
    policyDecisions: [],
    checkpoints: [],
    agentMessages: [],
    artifacts: [],
    activeAgents: [],
    queueSummary: { mode: "dag", pending: 0, inProgress: 0, completed: 0, topics: [] },
    sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
    busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
    pendingClarifications: [],
    pendingApprovals: [],
    toolCalls: [],
    actions: [],
    updatedAt: 2000,
    ...overrides,
  } as OraStateSnapshot;
}

function pendingRun(
  overrides: Partial<PendingRunState> = {},
): PendingRunState {
  return {
    sessionId: "session-1",
    prompt: "test prompt",
    createdAt: 3000,
    ...overrides,
  };
}

function lifecycleFromSnapshot(snapshot: OraStateSnapshot): RunLifecycle {
  return {
    stage: snapshot.status === "succeeded" || snapshot.status === "failed" || snapshot.status === "cancelled"
      ? "settled"
      : "streaming",
    runId: snapshot.runId,
    sessionId: snapshot.sessionId ?? "session-1",
    prompt: snapshot.input.prompt,
    createdAt: snapshot.input.createdAt ?? snapshot.updatedAt,
    snapshot,
  };
}

function lifecycleFromPendingRun(run: PendingRunState): RunLifecycle {
  return {
    stage: "pending",
    sessionId: run.sessionId,
    runId: run.runId,
    prompt: run.prompt,
    createdAt: run.createdAt,
    progressText: run.progressText,
    latency: run.latency,
  };
}

function derive(params: Omit<DeriveRunInteractionStateParams, "runLifecycle"> & {
  runLifecycle?: RunLifecycle;
  activeSnapshot?: OraStateSnapshot;
  pendingRun?: PendingRunState;
} = {}) {
  const { activeSnapshot, pendingRun, runLifecycle, ...rest } = params;
  return deriveRunInteractionState({
    ...rest,
    runLifecycle:
      runLifecycle ??
      (pendingRun ? lifecycleFromPendingRun(pendingRun) : undefined) ??
      (activeSnapshot ? lifecycleFromSnapshot(activeSnapshot) : undefined) ??
      { stage: "idle" },
  });
}

describe("deriveRunInteractionState", () => {
  // ---- Priority level tests ----

  it("pendingRun wins over all other sources", () => {
    const result = derive({
      selectedSessionId: "session-1",
      sessionSummary: sessionSummary({ status: "succeeded" }),
      activeSessionDetail: activeDetail({
        turns: [turn({ status: "succeeded" })],
      }),
      activeSnapshot: activeSnapshot({ status: "succeeded" }),
      pendingRun: pendingRun(),
    });

    expect(result).toMatchObject({
      status: "running",
      isProcessing: true,
      canSubmit: false,
      canStop: true,
      canResume: false,
      authority: "pending_run",
    });
  });

  it("pendingRun only matches its own session", () => {
    const result = derive({
      selectedSessionId: "session-1",
      sessionSummary: sessionSummary({ sessionId: "session-2", status: "running" }),
      pendingRun: pendingRun({ sessionId: "session-1" }),
    });

    expect(result.authority).toBe("session_summary");
  });

  it("activeSnapshot wins over activeSessionDetail", () => {
    const result = derive({
      selectedSessionId: "session-1",
      sessionSummary: sessionSummary({ status: "succeeded" }),
      activeSessionDetail: activeDetail({
        session: sessionSummary({ status: "succeeded" }),
        turns: [turn({ status: "succeeded" })],
      }),
      activeSnapshot: activeSnapshot({ status: "running" }),
    });

    expect(result).toMatchObject({
      status: "running",
      authority: "active_snapshot",
    });
  });

  it("activeSnapshot with different sessionId does not override session summary", () => {
    const result = derive({
      selectedSessionId: "session-1",
      sessionSummary: sessionSummary({ sessionId: "session-2", status: "succeeded" }),
      activeSnapshot: activeSnapshot({
        sessionId: "session-1",
        status: "running",
      }),
    });

    expect(result.status).toBe("done");
    expect(result.authority).toBe("session_summary");
  });

  it("activeSessionDetail turn wins over session summary", () => {
    const result = derive({
      selectedSessionId: "session-1",
      sessionSummary: sessionSummary({ status: "succeeded" }),
      activeSessionDetail: activeDetail({
        turns: [turn({ status: "running" })],
      }),
    });

    expect(result).toMatchObject({
      status: "running",
      authority: "active_turn",
    });
  });

  it("selected turn is preferred over latest turn", () => {
    const result = derive({
      selectedSessionId: "session-1",
      sessionSummary: sessionSummary(),
      activeSessionDetail: activeDetail({
        turns: [
          turn({ runId: "run-1", status: "succeeded" }),
          turn({ runId: "run-2", status: "running" }),
        ],
      }),
      selectedTurnRunId: "run-1",
    });

    expect(result).toMatchObject({
      sourceRunId: "run-1",
      status: "done",
    });
  });

  it("latest turn used when no selectedTurnRunId", () => {
    const result = derive({
      selectedSessionId: "session-1",
      sessionSummary: sessionSummary(),
      activeSessionDetail: activeDetail({
        turns: [
          turn({ runId: "run-1", status: "succeeded" }),
          turn({ runId: "run-2", status: "running" }),
        ],
      }),
    });

    expect(result).toMatchObject({
      sourceRunId: "run-2",
      status: "running",
    });
  });

  it("falls back to session summary when nothing else available", () => {
    const result = derive({
      selectedSessionId: "session-1",
      sessionSummary: sessionSummary({ status: "succeeded" }),
    });

    expect(result).toMatchObject({
      status: "done",
      isProcessing: false,
      canSubmit: true,
      authority: "session_summary",
    });
  });

  it("returns idle when no data at all", () => {
    const result = derive({});

    expect(result).toMatchObject({
      status: "idle",
      isProcessing: false,
      canSubmit: true,
      canStop: false,
      canResume: false,
      authority: "session_summary",
    });
  });

  // ---- Status mapping tests ----

  it("maps snapshot queued to interaction queued", () => {
    const result = derive({
      selectedSessionId: "session-1",
      activeSnapshot: activeSnapshot({ status: "queued" }),
    });
    expect(result).toMatchObject({ status: "queued", isProcessing: true, canStop: true });
  });

  it("maps snapshot running to interaction running", () => {
    const result = derive({
      selectedSessionId: "session-1",
      activeSnapshot: activeSnapshot({ status: "running" }),
    });
    expect(result).toMatchObject({ status: "running", isProcessing: true, canStop: true });
  });

  it("maps snapshot interrupted to interaction paused", () => {
    const result = derive({
      selectedSessionId: "session-1",
      activeSnapshot: activeSnapshot({ status: "interrupted" }),
    });
    expect(result).toMatchObject({ status: "paused", isProcessing: true, canResume: true });
  });

  it("maps snapshot cancelled to interaction cancelled", () => {
    const result = derive({
      selectedSessionId: "session-1",
      activeSnapshot: activeSnapshot({ status: "cancelled" }),
    });
    expect(result).toMatchObject({ status: "cancelled", isProcessing: false, canSubmit: true });
  });

  it("maps snapshot succeeded to interaction done", () => {
    const result = derive({
      selectedSessionId: "session-1",
      activeSnapshot: activeSnapshot({ status: "succeeded" }),
    });
    expect(result).toMatchObject({ status: "done", isProcessing: false, canSubmit: true });
  });

  it("maps snapshot failed to interaction failed", () => {
    const result = derive({
      selectedSessionId: "session-1",
      activeSnapshot: activeSnapshot({ status: "failed" }),
    });
    expect(result).toMatchObject({ status: "failed", isProcessing: false, canSubmit: true });
  });

  // ---- Attention / gate tests ----

  it("attention needs_approval produces approval gate", () => {
    const result = derive({
      selectedSessionId: "session-1",
      activeSnapshot: activeSnapshot({
        status: "running",
        attention: {
          kind: "needs_approval",
          blocking: true,
          pendingActionIds: ["action-1"],
          pendingToolCallIds: [],
          pendingClarificationIds: [],
        },
      }),
    });

    expect(result).toMatchObject({
      status: "approval_required",
      isProcessing: true,
      canSubmit: false,
      canStop: false,
      canResume: true,
      gateKind: "approval",
    });
  });

  it("attention needs_clarification produces clarification gate", () => {
    const result = derive({
      selectedSessionId: "session-1",
      activeSnapshot: activeSnapshot({
        status: "running",
        attention: {
          kind: "needs_clarification",
          blocking: true,
          pendingActionIds: [],
          pendingToolCallIds: [],
          pendingClarificationIds: ["clar-1"],
        },
      }),
    });

    expect(result).toMatchObject({
      status: "clarification_required",
      gateKind: "clarification",
    });
  });

  it("attention needs_plan_decision produces decision_needed", () => {
    const result = derive({
      selectedSessionId: "session-1",
      activeSnapshot: activeSnapshot({
        status: "running",
        attention: {
          kind: "needs_plan_decision",
          blocking: true,
          planDecisionId: "decision-1",
          pendingActionIds: [],
          pendingToolCallIds: [],
          pendingClarificationIds: [],
        },
      }),
    });

    expect(result).toMatchObject({
      status: "decision_needed",
      gateKind: "plan_decision",
    });
  });

  it("pending plan decision wins over succeeded raw run status", () => {
    const result = derive({
      selectedSessionId: "session-1",
      activeSnapshot: activeSnapshot({
        status: "succeeded",
        planDecisions: [{
          id: "decision-1",
          runId: "run-1",
          sessionId: "session-1",
          status: "pending",
          createdAt: 2000,
        }],
        attention: {
          kind: "needs_plan_decision",
          blocking: true,
          sourceRunId: "run-1",
          reason: "plan_decision_required",
          planDecisionId: "decision-1",
          pendingActionIds: [],
          pendingToolCallIds: [],
          pendingClarificationIds: [],
        },
      }),
    });

    expect(result).toMatchObject({
      status: "decision_needed",
      gateKind: "plan_decision",
      isProcessing: true,
      canSubmit: false,
      canResume: true,
    });
  });

  it("raw pending approval without projection attention is not actionable", () => {
    const result = derive({
      selectedSessionId: "session-1",
      activeSnapshot: activeSnapshot({
        status: "running",
        attention: {
          kind: "running",
          blocking: false,
          sourceRunId: "run-1",
          pendingActionIds: [],
          pendingToolCallIds: [],
          pendingClarificationIds: [],
        },
        pendingApprovals: ["action-stale"],
        actions: [
          {
            id: "action-stale",
            runId: "run-1",
            type: "file.write",
            status: "approval_required",
            riskLevel: "low",
            artifactIds: [],
            input: {},
          },
        ],
      }),
    });

    expect(result.status).toBe("running");
    expect(result.gateKind).toBeUndefined();
  });

  it("raw pending clarification without projection attention is not actionable", () => {
    const result = derive({
      selectedSessionId: "session-1",
      activeSnapshot: activeSnapshot({
        status: "running",
        attention: {
          kind: "running",
          blocking: false,
          sourceRunId: "run-1",
          pendingActionIds: [],
          pendingToolCallIds: [],
          pendingClarificationIds: [],
        },
        pendingClarifications: [
          {
            id: "clar-stale",
            key: "scope",
            nodeId: "node-1",
            nodeLabel: "Node 1",
            question: "What scope?",
            options: [],
            requestedAt: 2000,
          },
        ],
      }),
    });

    expect(result.status).toBe("running");
    expect(result.gateKind).toBeUndefined();
  });

  // ---- Session detail authority tests ----

  it("active detail turn running overrides stale session summary", () => {
    const result = derive({
      selectedSessionId: "session-1",
      sessionSummary: sessionSummary({ status: "succeeded" }),
      activeSessionDetail: activeDetail({
        turns: [turn({ status: "running" })],
      }),
    });

    expect(result).toMatchObject({
      status: "running",
      isProcessing: true,
      authority: "active_turn",
    });
  });

  it("active detail session status used when no turns exist", () => {
    const result = derive({
      selectedSessionId: "session-1",
      sessionSummary: sessionSummary({ status: "succeeded" }),
      activeSessionDetail: activeDetail({
        session: sessionSummary({ status: "running" }),
        turns: [],
      }),
    });

    expect(result).toMatchObject({
      status: "running",
      authority: "session_detail",
    });
  });

  it("selected session differs from active detail, falls back to session summary", () => {
    const result = derive({
      selectedSessionId: "session-2",
      sessionSummary: sessionSummary({
        sessionId: "session-2",
        status: "succeeded",
      }),
      activeSessionDetail: activeDetail({
        session: sessionSummary({ sessionId: "session-1" }),
        turns: [turn({ sessionId: "session-1", status: "running" })],
      }),
    });

    expect(result).toMatchObject({
      status: "done",
      authority: "session_summary",
    });
  });

  // ---- Edge cases & adversarial tests ----

  it("snapshot running with stale session summary succeeded → processing true", () => {
    const result = derive({
      selectedSessionId: "session-1",
      sessionSummary: sessionSummary({ status: "succeeded" }),
      activeSnapshot: activeSnapshot({ status: "running" }),
    });

    expect(result.isProcessing).toBe(true);
    expect(result.status).toBe("running");
  });

  it("session summary running with no higher authority → processing true", () => {
    const result = derive({
      selectedSessionId: "session-1",
      sessionSummary: sessionSummary({ status: "running" }),
    });

    expect(result).toMatchObject({
      status: "running",
      isProcessing: true,
      canStop: true,
      authority: "session_summary",
    });
  });

  it("attention paused on turn produces paused status", () => {
    const result = derive({
      selectedSessionId: "session-1",
      activeSessionDetail: activeDetail({
        turns: [
          turn({
            status: "interrupted",
            attention: {
              kind: "paused",
              blocking: false,
              sourceRunId: "run-1",
              pendingActionIds: [],
              pendingToolCallIds: [],
              pendingClarificationIds: [],
            },
          }),
        ],
      }),
    });

    expect(result).toMatchObject({
      status: "paused",
      isProcessing: true,
      canResume: true,
    });
  });

  it("canSubmit is false for all processing statuses", () => {
    const processingStatuses = [
      "queued",
      "running",
      "approval_required",
      "clarification_required",
      "decision_needed",
      "paused",
    ] as const;

    for (const processingStatus of processingStatuses) {
      const snapshotStatus: OraStateSnapshot["status"] =
        processingStatus === "queued" ? "queued"
        : processingStatus === "paused" ? "interrupted"
        : "running";
      const attn: OraStateSnapshot["attention"] =
        processingStatus === "approval_required"
          ? {
              kind: "needs_approval",
              blocking: true,
              pendingActionIds: ["a"],
              pendingToolCallIds: [],
              pendingClarificationIds: [],
            }
          : processingStatus === "clarification_required"
            ? {
                kind: "needs_clarification",
                blocking: true,
                pendingActionIds: [],
                pendingToolCallIds: [],
                pendingClarificationIds: ["c"],
              }
            : processingStatus === "decision_needed"
              ? {
                  kind: "needs_plan_decision",
                  blocking: true,
                  planDecisionId: "d",
                  pendingActionIds: [],
                  pendingToolCallIds: [],
                  pendingClarificationIds: [],
                }
              : undefined;

      const result = derive({
        selectedSessionId: "session-1",
        activeSnapshot: activeSnapshot({
          status: snapshotStatus,
          attention: attn,
        }),
      });

      expect(result.canSubmit, `canSubmit should be false for ${processingStatus}`).toBe(
        false,
      );
    }
  });

  // ---- turnSnapshots authority tests ----

  it("selected turn snapshot wins over activeSessionDetail when activeSnapshot absent", () => {
    const result = derive({
      selectedSessionId: "session-1",
      sessionSummary: sessionSummary({ status: "succeeded" }),
      activeSessionDetail: activeDetail({
        turns: [turn({ runId: "run-1", status: "succeeded" })],
      }),
      turnSnapshots: {
        "run-1": activeSnapshot({ runId: "run-1", status: "running" }),
      },
      selectedTurnRunId: "run-1",
    });

    expect(result).toMatchObject({
      sourceRunId: "run-1",
      status: "running",
      isProcessing: true,
      authority: "active_snapshot",
    });
  });

  it("activeSnapshot wins over selected turn snapshot", () => {
    const result = derive({
      selectedSessionId: "session-1",
      activeSnapshot: activeSnapshot({ runId: "run-2", status: "succeeded" }),
      turnSnapshots: {
        "run-1": activeSnapshot({ runId: "run-1", status: "running" }),
      },
      selectedTurnRunId: "run-1",
    });

    expect(result).toMatchObject({
      sourceRunId: "run-2",
      status: "done",
      authority: "active_snapshot",
    });
  });

  it("turn snapshot from different session ignored", () => {
    const result = derive({
      selectedSessionId: "session-1",
      sessionSummary: sessionSummary({ sessionId: "session-1", status: "succeeded" }),
      turnSnapshots: {
        "run-1": activeSnapshot({ runId: "run-1", sessionId: "session-2", status: "running" }),
      },
      selectedTurnRunId: "run-1",
    });

    expect(result).toMatchObject({
      status: "done",
      authority: "session_summary",
    });
  });

  it("turn snapshot without selectedTurnRunId ignored", () => {
    const result = derive({
      selectedSessionId: "session-1",
      sessionSummary: sessionSummary({ status: "succeeded" }),
      activeSessionDetail: activeDetail({
        turns: [turn({ runId: "run-1", status: "running" })],
      }),
      turnSnapshots: {
        "run-1": activeSnapshot({ runId: "run-1", status: "succeeded" }),
      },
    });

    // Falls through to activeSessionDetail turn (priority 3)
    expect(result).toMatchObject({
      status: "running",
      authority: "active_turn",
    });
  });
});
