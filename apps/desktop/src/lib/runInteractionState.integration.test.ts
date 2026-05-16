/**
 * Cross-surface integration tests for runInteractionState.
 *
 * Each test uses a single fixture and checks that composer button state,
 * sidebar badge, chat loading, and trails header status are consistent.
 */
import { describe, expect, it } from "vitest";
import { deriveRunInteractionState } from "./runInteractionState";
import type { OraSessionDetail, OraSessionSummary, OraStateSnapshot } from "./runtimeClient";
import type { PendingRunState, RunLifecycle } from "./state";
import type { DeriveRunInteractionStateParams } from "./runInteractionState";

type RunStatus =
  | "running"
  | "approval_required"
  | "clarification_required"
  | "decision_needed"
  | "paused"
  | "cancelled"
  | "failed"
  | "done";

function toSidebarBadgeStatus(
  state: ReturnType<typeof deriveRunInteractionState>,
): RunStatus {
  switch (state.status) {
    case "queued":
    case "running":
      return "running";
    case "approval_required":
      return "approval_required";
    case "clarification_required":
      return "clarification_required";
    case "decision_needed":
      return "decision_needed";
    case "paused":
      return "paused";
    case "cancelled":
      return "cancelled";
    case "failed":
      return "failed";
    case "idle":
    case "done":
      return "done";
  }
}

function toChatLoading(state: ReturnType<typeof deriveRunInteractionState>): boolean {
  return state.isProcessing;
}

function toComposerSendEnabled(state: ReturnType<typeof deriveRunInteractionState>): boolean {
  return state.canSubmit;
}

function toComposerStopEnabled(state: ReturnType<typeof deriveRunInteractionState>): boolean {
  return state.canStop;
}

function toTrailsStatusLabel(state: ReturnType<typeof deriveRunInteractionState>): string {
  return state.status.replace(/_/g, " ");
}

// Fixture builders mirror the ones in runInteractionState.test.ts

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
    input: { prompt: "test prompt", createdAt: 1000, context: {} },
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

const SURFACE_LABELS = ["sidebar_badge", "chat_loading", "composer_send", "composer_stop", "trails_status"] as const;

describe("runInteractionState cross-surface consistency", () => {
  // Each fixture produces a single canonical state; all surfaces agree.

  function surfaceStates(state: ReturnType<typeof deriveRunInteractionState>) {
    return {
      sidebar_badge: toSidebarBadgeStatus(state),
      chat_loading: toChatLoading(state),
      composer_send: toComposerSendEnabled(state),
      composer_stop: toComposerStopEnabled(state),
      trails_status: toTrailsStatusLabel(state),
    };
  }

  it("running: all surfaces agree on processing", () => {
    const state = derive({
      selectedSessionId: "session-1",
      sessionSummary: sessionSummary({ status: "running" }),
      activeSnapshot: activeSnapshot({ status: "running" }),
    });
    const surfaces = surfaceStates(state);

    expect(surfaces.sidebar_badge).toBe("running");
    expect(surfaces.chat_loading).toBe(true);
    expect(surfaces.composer_send).toBe(false);
    expect(surfaces.composer_stop).toBe(true);
    expect(surfaces.trails_status).toBe("running");
  });

  it("done: all surfaces agree on idle", () => {
    const state = derive({
      selectedSessionId: "session-1",
      sessionSummary: sessionSummary({ status: "succeeded" }),
    });
    const surfaces = surfaceStates(state);

    expect(surfaces.sidebar_badge).toBe("done");
    expect(surfaces.chat_loading).toBe(false);
    expect(surfaces.composer_send).toBe(true);
    expect(surfaces.composer_stop).toBe(false);
    expect(surfaces.trails_status).toBe("done");
  });

  it("approval_required: all surfaces agree on gate", () => {
    const state = derive({
      selectedSessionId: "session-1",
      activeSnapshot: activeSnapshot({
        status: "running",
        pendingApprovals: ["a1"],
        attention: {
          kind: "needs_approval",
          blocking: true,
          pendingActionIds: ["a1"],
          pendingToolCallIds: [],
          pendingClarificationIds: [],
        },
      }),
    });
    const surfaces = surfaceStates(state);

    expect(surfaces.sidebar_badge).toBe("approval_required");
    expect(surfaces.chat_loading).toBe(true);
    expect(surfaces.composer_send).toBe(false);
    expect(surfaces.composer_stop).toBe(false);
    expect(surfaces.trails_status).toBe("approval required");
  });

  it("clarification_required: all surfaces agree on gate", () => {
    const state = derive({
      selectedSessionId: "session-1",
      activeSnapshot: activeSnapshot({
        status: "running",
        pendingClarifications: [{ id: "c1", key: "scope", question: "What scope?", nodeId: "n1", nodeLabel: "Review", requestedAt: 1000, options: [] }],
        attention: {
          kind: "needs_clarification",
          blocking: true,
          pendingActionIds: [],
          pendingToolCallIds: [],
          pendingClarificationIds: ["c1"],
        },
      }),
    });
    const surfaces = surfaceStates(state);

    expect(surfaces.sidebar_badge).toBe("clarification_required");
    expect(surfaces.chat_loading).toBe(true);
    expect(surfaces.composer_send).toBe(false);
    expect(surfaces.composer_stop).toBe(false);
    expect(surfaces.trails_status).toBe("clarification required");
  });

  it("paused: all surfaces agree on interrupted", () => {
    const state = derive({
      selectedSessionId: "session-1",
      activeSnapshot: activeSnapshot({ status: "interrupted" }),
    });
    const surfaces = surfaceStates(state);

    expect(surfaces.sidebar_badge).toBe("paused");
    expect(surfaces.chat_loading).toBe(true);
    expect(surfaces.composer_send).toBe(false);
    expect(surfaces.composer_stop).toBe(false);
    expect(surfaces.trails_status).toBe("paused");
  });

  it("failed: all surfaces agree on terminal", () => {
    const state = derive({
      selectedSessionId: "session-1",
      activeSnapshot: activeSnapshot({ status: "failed" }),
    });
    const surfaces = surfaceStates(state);

    expect(surfaces.sidebar_badge).toBe("failed");
    expect(surfaces.chat_loading).toBe(false);
    expect(surfaces.composer_send).toBe(true);
    expect(surfaces.composer_stop).toBe(false);
    expect(surfaces.trails_status).toBe("failed");
  });

  // ---- Adversarial: stale session summary should not poison surfaces ----

  it("stale session summary succeeded, snapshot running → all surfaces show running", () => {
    const state = derive({
      selectedSessionId: "session-1",
      sessionSummary: sessionSummary({ status: "succeeded" }),
      activeSnapshot: activeSnapshot({ status: "running" }),
    });
    const surfaces = surfaceStates(state);

    expect(surfaces.sidebar_badge).toBe("running");
    expect(surfaces.chat_loading).toBe(true);
    expect(surfaces.composer_send).toBe(false);
    expect(surfaces.composer_stop).toBe(true);
    expect(surfaces.trails_status).toBe("running");
  });

  it("stale session summary running, snapshot succeeded → all surfaces show done", () => {
    const state = derive({
      selectedSessionId: "session-1",
      sessionSummary: sessionSummary({ status: "running" }),
      activeSnapshot: activeSnapshot({ status: "succeeded" }),
    });
    const surfaces = surfaceStates(state);

    expect(surfaces.sidebar_badge).toBe("done");
    expect(surfaces.chat_loading).toBe(false);
    expect(surfaces.composer_send).toBe(true);
    expect(surfaces.composer_stop).toBe(false);
    expect(surfaces.trails_status).toBe("done");
  });

  // ---- Poisoned raw-state test ----

  it("raw pending approval without attention projection → no gate surfaces", () => {
    const state = derive({
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
    const surfaces = surfaceStates(state);

    // No gate surfaces — the raw approval action without projection attention
    // must not produce actionable gate UI.
    expect(surfaces.sidebar_badge).toBe("running");
    expect(surfaces.chat_loading).toBe(true);
    expect(surfaces.composer_send).toBe(false);
    expect(surfaces.composer_stop).toBe(true);
    expect(surfaces.trails_status).toBe("running");
    expect(state.gateKind).toBeUndefined();
  });
});
