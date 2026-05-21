import { describe, expect, it } from "vitest";
import { CODE_DEVELOPMENT_MODE_ID, SINGLE_AGENT_MODE_ID } from "@cemeworm/shared";
import {
  deriveRenderableTurnSnapshots,
  getActiveSnapshot,
  getPendingRunState,
  initialWorkbenchState,
  mergeRunStreamSnapshot,
  mergeStateSnapshot,
  pruneTurnSnapshotsForActiveSession,
  workbenchReducer,
} from "./state";
import type { WorkbenchAction, WorkbenchState } from "./state";
import type { OraProviderConfig, OraRunEventStream, OraSessionDetail, OraSessionSummary, OraStateSnapshot } from "./runtimeClient";

describe("initial workbench state", () => {
  it("starts new sessions in chat intent", () => {
    expect(initialWorkbenchState.taskIntent).toBe("chat");
  });

  it("resets runtime view back to chat intent", () => {
    const next = workbenchReducer({
      ...initialWorkbenchState,
      taskIntent: "implement",
    }, { type: "RESET_RUNTIME_VIEW" });

    expect(next.taskIntent).toBe("chat");
  });
});

function sessionSummary(sessionId: string): OraSessionSummary {
  return {
    sessionId,
    title: sessionId,
    turnCount: 0,
    createdAt: 1_714_000_000_000,
    updatedAt: 1_714_000_000_000,
  };
}

function testSnapshot(params: {
  runId?: string;
  sessionId?: string;
  status?: OraStateSnapshot["status"];
  updatedAt?: number;
  activeAgents?: OraStateSnapshot["activeAgents"];
  childSessions?: OraStateSnapshot["childSessions"];
  parentCoordination?: OraStateSnapshot["parentCoordination"];
  agentMessages?: OraStateSnapshot["agentMessages"];
  events?: OraStateSnapshot["events"];
  latency?: OraStateSnapshot["latency"];
  attention?: OraStateSnapshot["attention"];
  planList?: OraStateSnapshot["planList"];
  planDecisions?: OraStateSnapshot["planDecisions"];
  pendingApprovals?: OraStateSnapshot["pendingApprovals"];
  pendingClarifications?: OraStateSnapshot["pendingClarifications"];
} = {}): OraStateSnapshot {
  const runId = params.runId ?? "run-debate";
  const sessionId = params.sessionId ?? "session-debate";
  const updatedAt = params.updatedAt ?? 1_714_000_000_000;
  return {
    runId,
    sessionId,
    turnIndex: 1,
    status: params.status ?? "running",
    pattern: "orchestrator_subagent",
    modeId: "debate",
    input: { prompt: "Debate this.", createdAt: updatedAt, context: {} },
    config: {
      modeId: "debate",
      pattern: "orchestrator_subagent",
      modeSelection: "manual",
      profileIds: ["debate_agent"],
      providerId: "local-smoke",
      modelRef: "local/smoke-model",
      approvalMode: "high_risk_only",
      patternOptions: {},
      metadata: {},
      deterministicSeed: "state-debate-session-switch-test",
      skillIds: [],
      toolIds: [],
    },
    topology: { nodes: [], edges: [] },
    profiles: [],
    memory: [],
    plan: [],
    planList: params.planList ?? [],
    todos: [],
    actions: [],
    toolCalls: [],
    continuation: { frames: [] },
    planDecisions: params.planDecisions ?? [],
    conversation: [],
    toolResults: [],
    policyDecisions: [],
    checkpoints: [],
    events: params.events ?? [],
    agentMessages: params.agentMessages ?? [],
    childSessions: params.childSessions ?? [],
    parentCoordination: params.parentCoordination,
    artifacts: [],
    activeAgents: params.activeAgents ?? [],
    queueSummary: { mode: "backlog", pending: 0, inProgress: 1, completed: 0, topics: [] },
    sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
    busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
    pendingClarifications: params.pendingClarifications ?? [],
    pendingApprovals: params.pendingApprovals ?? [],
    attention: params.attention,
    latency: params.latency,
    updatedAt,
  } as unknown as OraStateSnapshot;
}

function lifecycleFromSnapshot(snapshot: OraStateSnapshot): WorkbenchState["runLifecycle"] {
  return {
    stage: snapshot.status === "succeeded" || snapshot.status === "failed" || snapshot.status === "cancelled"
      ? "settled"
      : "streaming",
    runId: snapshot.runId,
    sessionId: snapshot.sessionId ?? "session-debate",
    prompt: snapshot.input.prompt,
    createdAt: snapshot.input.createdAt ?? snapshot.updatedAt,
    snapshot,
  };
}

function lifecycleFromPendingRun(run: {
  sessionId: string;
  runId?: string;
  prompt: string;
  createdAt: number;
  progressText?: string;
  latency?: OraStateSnapshot["latency"];
}): WorkbenchState["runLifecycle"] {
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

function debateTranscriptMessage(params: {
  id: string;
  sequence: number;
  stance: "affirmative" | "negative" | "moderator" | "neutral";
  speakerLabel: string;
  content: string;
  createdAt?: number;
  runId?: string;
}): OraStateSnapshot["agentMessages"][number] {
  return {
    id: params.id,
    runId: params.runId ?? "run-debate",
    createdAt: params.createdAt ?? 1_714_000_000_000 + params.sequence,
    fromAgentId: "debate_agent",
    toAgentIds: [],
    threadId: "debate",
    kind: "reply",
    status: "done",
    content: params.content,
    artifactIds: [],
    transcript: {
      kind: "stage_transcript",
      groupId: "debate",
      groupLabel: "结构化辩论",
      stageId: params.id,
      stageLabel: `阶段 ${params.sequence + 1}`,
      sequence: params.sequence,
      speakerLabel: params.speakerLabel,
      stance: params.stance,
      status: "done",
    },
  };
}

function agentMessageEvent(message: OraStateSnapshot["agentMessages"][number], seq: number): OraStateSnapshot["events"][number] {
  return {
    id: `${message.runId}:evt-${seq}`,
    runId: message.runId,
    seq,
    type: "agent.message",
    createdAt: message.createdAt,
    pattern: "orchestrator_subagent",
    agentId: message.fromAgentId,
    nodeId: message.nodeId ?? message.fromAgentId,
    payload: { message },
  } as unknown as OraStateSnapshot["events"][number];
}

describe("desktop workbench state", () => {
  it("does not leave a disabled provider selected after registry updates", () => {
    const enabled: OraProviderConfig = {
      id: "enabled-openai",
      type: "openai",
      label: "Enabled OpenAI",
      modelId: "gpt-4o",
      enabled: true,
      capabilities: ["chat"],
      dropParams: [],
      headers: {},
    };
    const disabled: OraProviderConfig = {
      id: "disabled-openai",
      type: "openai",
      label: "Disabled OpenAI",
      modelId: "gpt-4o-mini",
      enabled: false,
      capabilities: ["chat"],
      dropParams: [],
      headers: {},
    };

    let state: WorkbenchState = {
      ...initialWorkbenchState,
      selectedProviderId: disabled.id,
      providerRegistry: {
        providers: [disabled, enabled],
        defaultProviderId: disabled.id,
      },
    };

    state = workbenchReducer(state, {
      type: "SET_PROVIDER_REGISTRY",
      providerRegistry: {
        providers: [disabled, enabled],
        defaultProviderId: disabled.id,
      },
    });

    expect(state.selectedProviderId).toBe(enabled.id);

    state = workbenchReducer(state, { type: "SET_PROVIDER", providerId: disabled.id });
    expect(state.selectedProviderId).toBe(enabled.id);
  });

  it("caches background session hydration without changing the selected session", () => {
    const currentSnapshot = testSnapshot({
      runId: "run-current",
      sessionId: "session-current",
    });
    const backgroundSnapshot = testSnapshot({
      runId: "run-background",
      sessionId: "session-background",
      status: "running",
      updatedAt: 1_714_000_000_100,
    });
    const currentSession = {
      ...sessionSummary("session-current"),
      latestRunId: currentSnapshot.runId,
    };
    const backgroundSession = {
      ...sessionSummary("session-background"),
      latestRunId: backgroundSnapshot.runId,
      status: "running" as const,
      updatedAt: backgroundSnapshot.updatedAt,
    };
    const state: WorkbenchState = {
      ...initialWorkbenchState,
      sessions: [currentSession, sessionSummary("session-background")],
      selectedSessionId: currentSession.sessionId,
      selectedTurnRunId: currentSnapshot.runId,
      runLifecycle: lifecycleFromSnapshot(currentSnapshot),
      activeSessionDetail: {
        session: currentSession,
        turns: [{ runId: currentSnapshot.runId } as unknown as NonNullable<WorkbenchState["activeSessionDetail"]>["turns"][number]],
        transcript: [],
        latestSnapshot: currentSnapshot,
      },
      promptText: "draft for current",
      sessionPromptTexts: { [currentSession.sessionId]: "draft for current" },
    };

    const next = workbenchReducer(state, {
      type: "HYDRATE_SESSION",
      projects: [],
      sessions: [backgroundSession, currentSession],
      detail: {
        session: backgroundSession,
        turns: [{ runId: backgroundSnapshot.runId } as unknown as NonNullable<WorkbenchState["activeSessionDetail"]>["turns"][number]],
        transcript: [],
        latestSnapshot: backgroundSnapshot,
      },
      preserveSelection: true,
    });

    expect(next.selectedSessionId).toBe("session-current");
    expect(next.selectedTurnRunId).toBe("run-current");
    expect(getActiveSnapshot(next.runLifecycle)?.runId).toBe("run-current");
    expect(getActiveSnapshot(next.runLifecycle)?.runId).toBe("run-current");
    expect(next.activeSessionDetail?.session.sessionId).toBe("session-current");
    expect(next.promptText).toBe("draft for current");
    expect(next.sessionDetailsById["session-background"]?.latestSnapshot?.runId).toBe("run-background");
    expect(next.sessionDetailsById["session-background"]?.latestSnapshot?.events).toEqual([]);
    expect(next.sessions.find((session) => session.sessionId === "session-background")?.status).toBe("running");
  });

  it("refreshes the selected session when preserved hydration targets the current session", () => {
    const oldSnapshot = testSnapshot({
      runId: "run-current-old",
      sessionId: "session-current",
      updatedAt: 1_714_000_000_000,
    });
    const refreshedSnapshot = testSnapshot({
      runId: "run-current-new",
      sessionId: "session-current",
      status: "succeeded",
      updatedAt: 1_714_000_000_100,
    });
    const refreshedSession = {
      ...sessionSummary("session-current"),
      latestRunId: refreshedSnapshot.runId,
      status: "succeeded" as const,
      updatedAt: refreshedSnapshot.updatedAt,
    };
    const state: WorkbenchState = {
      ...initialWorkbenchState,
      sessions: [sessionSummary("session-current")],
      selectedSessionId: "session-current",
      selectedTurnRunId: oldSnapshot.runId,
      runLifecycle: lifecycleFromSnapshot(oldSnapshot),
      activeSessionDetail: {
        session: sessionSummary("session-current"),
        turns: [{ runId: oldSnapshot.runId } as unknown as NonNullable<WorkbenchState["activeSessionDetail"]>["turns"][number]],
        transcript: [],
        latestSnapshot: oldSnapshot,
      },
    };

    const next = workbenchReducer(state, {
      type: "HYDRATE_SESSION",
      projects: [],
      sessions: [refreshedSession],
      detail: {
        session: refreshedSession,
        turns: [{ runId: refreshedSnapshot.runId } as unknown as NonNullable<WorkbenchState["activeSessionDetail"]>["turns"][number]],
        transcript: [],
        latestSnapshot: refreshedSnapshot,
      },
      preserveSelection: true,
    });

    expect(next.selectedSessionId).toBe("session-current");
    expect(next.selectedTurnRunId).toBe("run-current-new");
    expect(getActiveSnapshot(next.runLifecycle)?.runId).toBe("run-current-new");
    expect(next.runLifecycle.stage).toBe("settled");
    expect(getActiveSnapshot(next.runLifecycle)?.runId).toBe("run-current-new");
    expect(next.activeSessionDetail?.session.status).toBe("succeeded");
  });

  it("keeps a final local snapshot authoritative over stale collection refreshes", () => {
    const sessionId = "session-collection-authority";
    const runId = "run-collection-authority";
    const snapshot = testSnapshot({
      runId,
      sessionId,
      status: "succeeded",
      updatedAt: 200,
      attention: {
        kind: "idle",
        blocking: false,
        sourceRunId: runId,
        pendingActionIds: [],
        pendingToolCallIds: [],
        pendingClarificationIds: [],
      },
    });
    const finalSession: OraSessionSummary = {
      ...sessionSummary(sessionId),
      latestRunId: runId,
      status: "succeeded",
      attention: snapshot.attention,
      updatedAt: 200,
      turnCount: 1,
    };
    const staleSession: OraSessionSummary = {
      ...finalSession,
      status: "running",
      attention: {
        kind: "running",
        blocking: false,
        sourceRunId: runId,
        pendingActionIds: [],
        pendingToolCallIds: [],
        pendingClarificationIds: [],
      },
      updatedAt: 220,
    };
    const state: WorkbenchState = {
      ...initialWorkbenchState,
      sessions: [finalSession],
      selectedSessionId: sessionId,
      selectedTurnRunId: runId,
      runLifecycle: lifecycleFromSnapshot(snapshot),
      activeSessionDetail: {
        session: finalSession,
        turns: [{
          runId,
          sessionId,
          turnIndex: 1,
          status: "succeeded",
          pattern: snapshot.pattern,
          prompt: snapshot.input.prompt,
          startedAt: 100,
          updatedAt: 200,
          eventCount: 0,
          checkpointCount: 0,
          artifactCount: 0,
          attention: snapshot.attention,
        }],
        transcript: [],
        latestSnapshot: snapshot,
      },
    };

    const next = workbenchReducer(state, {
      type: "SET_COLLECTIONS",
      projects: [],
      sessions: [staleSession],
    });

    expect(next.sessions[0]?.status).toBe("succeeded");
    expect(next.sessions[0]?.attention?.kind).toBe("idle");
    expect(next.sessions[0]?.updatedAt).toBe(220);
    expect(getActiveSnapshot(next.runLifecycle)?.status).toBe("succeeded");
  });

  it("preserves locally running sessions that are missing from a collection refresh", () => {
    const runningSession: OraSessionSummary = {
      ...sessionSummary("session-running-local"),
      latestRunId: "run-running-local",
      status: "running",
      updatedAt: 300,
    };
    const olderSession = sessionSummary("session-older");
    const state: WorkbenchState = {
      ...initialWorkbenchState,
      sessions: [runningSession, olderSession],
    };

    const next = workbenchReducer(state, {
      type: "SET_COLLECTIONS",
      projects: [],
      sessions: [olderSession],
    });

    expect(next.sessions.map((session) => session.sessionId)).toContain("session-running-local");
    expect(next.sessions.find((session) => session.sessionId === "session-running-local")?.status).toBe("running");
  });

  it("updates inactive running session summaries without taking over the active run", () => {
    const activeSnapshot = testSnapshot({
      runId: "run-active",
      sessionId: "session-active",
      status: "running",
      updatedAt: 100,
    });
    const inactiveSession: OraSessionSummary = {
      ...sessionSummary("session-inactive"),
      latestRunId: "run-inactive",
      status: "running",
      updatedAt: 100,
    };
    const state: WorkbenchState = {
      ...initialWorkbenchState,
      selectedSessionId: "session-active",
      selectedTurnRunId: "run-active",
      sessions: [sessionSummary("session-active"), inactiveSession],
      runLifecycle: lifecycleFromSnapshot(activeSnapshot),
      activeSessionDetail: {
        session: sessionSummary("session-active"),
        turns: [{
          runId: "run-active",
          sessionId: "session-active",
          turnIndex: 1,
          status: "running",
          pattern: activeSnapshot.pattern,
          prompt: activeSnapshot.input.prompt,
          startedAt: 100,
          updatedAt: 100,
          eventCount: 0,
          checkpointCount: 0,
          artifactCount: 0,
        }],
        transcript: [],
        latestSnapshot: activeSnapshot,
      },
    };
    const stream: OraRunEventStream = {
      runId: "run-inactive",
      sessionId: "session-inactive",
      status: "running",
      events: [{
        id: "run-inactive:event:1",
        runId: "run-inactive",
        seq: 1,
        type: "message.delta",
        createdAt: 250,
        payload: {
          role: "assistant",
          messageId: "message-inactive",
          content: "Background text",
          delta: "Background text",
          streaming: true,
        },
      } as unknown as OraRunEventStream["events"][number]],
    } as OraRunEventStream;

    const next = workbenchReducer(state, { type: "APPLY_RUN_STREAM", stream, receivedAt: 260 });

    expect(getActiveSnapshot(next.runLifecycle)?.runId).toBe("run-active");
    expect(next.selectedSessionId).toBe("session-active");
    expect(next.sessions.find((session) => session.sessionId === "session-inactive")?.updatedAt).toBe(250);
    expect(next.sessions.find((session) => session.sessionId === "session-inactive")?.status).toBe("running");
    expect(next.liveMessageDeltaBuffer["run-inactive:message-inactive"]?.content).toBe("Background text");
  });

  it("restores a background running session from session live authority when switching back", () => {
    const activeSnapshot = testSnapshot({
      runId: "run-active",
      sessionId: "session-active",
      status: "running",
      updatedAt: 100,
    });
    const backgroundSnapshot = testSnapshot({
      runId: "run-inactive",
      sessionId: "session-inactive",
      status: "running",
      updatedAt: 120,
    });
    const inactiveSession: OraSessionSummary = {
      ...sessionSummary("session-inactive"),
      latestRunId: "run-inactive",
      status: "running",
      updatedAt: 120,
    };
    const state: WorkbenchState = {
      ...initialWorkbenchState,
      selectedSessionId: "session-active",
      selectedTurnRunId: "run-active",
      sessions: [sessionSummary("session-active"), inactiveSession],
      sessionDetailsById: {
        "session-inactive": {
          session: inactiveSession,
          turns: [{
            runId: "run-inactive",
            sessionId: "session-inactive",
            turnIndex: 1,
            status: "running",
            pattern: backgroundSnapshot.pattern,
            prompt: backgroundSnapshot.input.prompt,
            startedAt: backgroundSnapshot.updatedAt,
            updatedAt: backgroundSnapshot.updatedAt,
            eventCount: 0,
            checkpointCount: 0,
            artifactCount: 0,
          }],
          transcript: [],
          latestSnapshot: {
            ...backgroundSnapshot,
            events: [],
            actions: [],
            output: undefined,
          },
        },
      },
      sessionLiveSnapshotsById: {
        "session-inactive": backgroundSnapshot,
      },
      runLifecycle: lifecycleFromSnapshot(activeSnapshot),
      activeSessionDetail: {
        session: sessionSummary("session-active"),
        turns: [{
          runId: "run-active",
          sessionId: "session-active",
          turnIndex: 1,
          status: "running",
          pattern: activeSnapshot.pattern,
          prompt: activeSnapshot.input.prompt,
          startedAt: activeSnapshot.updatedAt,
          updatedAt: activeSnapshot.updatedAt,
          eventCount: 0,
          checkpointCount: 0,
          artifactCount: 0,
        }],
        transcript: [],
        latestSnapshot: activeSnapshot,
      },
    };
    const stream: OraRunEventStream = {
      runId: "run-inactive",
      sessionId: "session-inactive",
      status: "running",
      events: [{
        id: "run-inactive:event:1",
        runId: "run-inactive",
        seq: 1,
        type: "message.delta",
        createdAt: 250,
        payload: {
          role: "assistant",
          messageId: "message-inactive",
          content: "Background text",
          delta: "Background text",
          streaming: true,
        },
      } as unknown as OraRunEventStream["events"][number]],
    } as OraRunEventStream;

    const afterStream = workbenchReducer(state, {
      type: "APPLY_RUN_STREAM",
      stream,
      receivedAt: 260,
    });
    const next = workbenchReducer(afterStream, {
      type: "SELECT_SESSION",
      sessionId: "session-inactive",
    });

    expect(afterStream.sessionLiveSnapshotsById["session-inactive"]?.events).toHaveLength(1);
    expect(getActiveSnapshot(next.runLifecycle)?.runId).toBe("run-inactive");
    expect(getActiveSnapshot(next.runLifecycle)?.events).toHaveLength(1);
    expect(next.activeSessionDetail?.latestSnapshot?.events).toHaveLength(1);
  });

  it("hydrates a selected session from turn summaries without loading the latest snapshot", () => {
    const session = {
      ...sessionSummary("session-summary"),
      latestRunId: "run-summary",
      latestModeId: SINGLE_AGENT_MODE_ID,
      latestProviderId: "local-smoke",
      latestModelRef: "local/smoke-model",
      status: "succeeded" as const,
      turnCount: 1,
      updatedAt: 1_714_000_000_100,
    };

    const next = workbenchReducer(initialWorkbenchState, {
      type: "HYDRATE_SESSION",
      projects: [],
      sessions: [session],
      detail: {
        session,
        turns: [{
          runId: "run-summary",
          sessionId: session.sessionId,
          turnIndex: 1,
          status: "succeeded",
          pattern: "orchestrator_subagent",
          modeId: SINGLE_AGENT_MODE_ID,
          providerId: "local-smoke",
          modelRef: "local/smoke-model",
          prompt: "Show summary first.",
          startedAt: 1_714_000_000_000,
          updatedAt: 1_714_000_000_100,
          eventCount: 12,
          checkpointCount: 1,
          artifactCount: 0,
        }],
        transcript: [],
      },
    });

    expect(next.isLoading).toBe(false);
    expect(next.selectedSessionId).toBe("session-summary");
    expect(next.selectedTurnRunId).toBe("run-summary");
    expect(getActiveSnapshot(next.runLifecycle)).toBeUndefined();
    expect(next.runLifecycle.stage).toBe("idle");
    expect(next.activeSessionDetail?.latestSnapshot).toBeUndefined();
    expect(next.selectedModeId).toBe(SINGLE_AGENT_MODE_ID);
    expect(next.selectedProviderId).toBe("local-smoke");
  });

  it("does not let session hydration overwrite the composer mode once selected", () => {
    const session = {
      ...sessionSummary("session-summary"),
      latestRunId: "run-summary",
      latestModeId: SINGLE_AGENT_MODE_ID,
      status: "succeeded" as const,
      turnCount: 1,
      updatedAt: 1_714_000_000_100,
    };
    const state: WorkbenchState = {
      ...initialWorkbenchState,
      selectedModeId: CODE_DEVELOPMENT_MODE_ID,
    };

    const next = workbenchReducer(state, {
      type: "HYDRATE_SESSION",
      projects: [],
      sessions: [session],
      detail: {
        session,
        turns: [{
          runId: "run-summary",
          sessionId: session.sessionId,
          turnIndex: 1,
          status: "succeeded",
          pattern: "orchestrator_subagent",
          modeId: SINGLE_AGENT_MODE_ID,
          providerId: "local-smoke",
          modelRef: "local/smoke-model",
          prompt: "Show summary first.",
          startedAt: 1_714_000_000_000,
          updatedAt: 1_714_000_000_100,
          eventCount: 12,
          checkpointCount: 1,
          artifactCount: 0,
        }],
        transcript: [],
      },
    });

    expect(next.selectedModeId).toBe(CODE_DEVELOPMENT_MODE_ID);
  });

  it("does not let selecting a historical turn overwrite the composer mode", () => {
    const snapshot = testSnapshot({ runId: "run-history", sessionId: "session-history" });
    const state: WorkbenchState = {
      ...initialWorkbenchState,
      selectedModeId: CODE_DEVELOPMENT_MODE_ID,
    };

    const next = workbenchReducer(state, {
      type: "SELECT_TURN",
      runId: "run-history",
      snapshot,
    });

    expect(next.selectedModeId).toBe(CODE_DEVELOPMENT_MODE_ID);
    expect(getActiveSnapshot(next.runLifecycle)?.runId).toBe("run-history");
  });

  it("keeps unsent composer text scoped to the selected session", () => {
    let state: WorkbenchState = {
      ...initialWorkbenchState,
      sessions: [sessionSummary("session-a"), sessionSummary("session-b")],
      selectedSessionId: "session-a",
    };

    state = workbenchReducer(state, { type: "SET_PROMPT", text: "draft for a" });
    state = workbenchReducer(state, { type: "SELECT_SESSION", sessionId: "session-b" });

    expect(state.promptText).toBe("");

    state = workbenchReducer(state, { type: "SET_PROMPT", text: "draft for b" });
    state = workbenchReducer(state, { type: "SELECT_SESSION", sessionId: "session-a" });

    expect(state.promptText).toBe("draft for a");

    state = workbenchReducer(state, { type: "CLEAR_PROMPT_IF_MATCH", text: "draft for a" });
    state = workbenchReducer(state, { type: "SELECT_SESSION", sessionId: "session-b" });

    expect(state.promptText).toBe("draft for b");
  });

  it("keeps pending project file attachments scoped to the selected session", () => {
    let state: WorkbenchState = {
      ...initialWorkbenchState,
      sessions: [sessionSummary("session-a"), sessionSummary("session-b")],
      selectedSessionId: "session-a",
    };

    state = workbenchReducer(state, {
      type: "ADD_PROJECT_FILE_ATTACHMENT",
      sessionId: "session-a",
      file: {
        projectId: "project-a",
        path: "src/App.tsx",
        name: "App.tsx",
        mimeType: "text/typescript",
        sizeBytes: 128,
      },
    });
    state = workbenchReducer(state, {
      type: "ADD_PROJECT_FILE_ATTACHMENT",
      sessionId: "session-a",
      file: {
        projectId: "project-a",
        path: "src/App.tsx",
        name: "App.tsx",
        mimeType: "text/typescript",
        sizeBytes: 128,
      },
    });
    state = workbenchReducer(state, {
      type: "ADD_PROJECT_FILE_ATTACHMENT",
      sessionId: "session-b",
      file: {
        projectId: "project-b",
        path: "README.md",
        name: "README.md",
        mimeType: "text/markdown",
        sizeBytes: 96,
      },
    });

    expect(state.sessionProjectFileAttachments["session-a"]).toHaveLength(1);
    expect(state.sessionProjectFileAttachments["session-b"]?.[0]?.path).toBe("README.md");

    state = workbenchReducer(state, {
      type: "REMOVE_PROJECT_FILE_ATTACHMENT",
      sessionId: "session-a",
      path: "src/App.tsx",
    });

    expect(state.sessionProjectFileAttachments["session-a"]).toBeUndefined();
    expect(state.sessionProjectFileAttachments["session-b"]).toHaveLength(1);

    state = workbenchReducer(state, {
      type: "CLEAR_PROJECT_FILE_ATTACHMENTS",
      sessionId: "session-b",
    });

    expect(state.sessionProjectFileAttachments["session-b"]).toBeUndefined();
  });

  it("keeps pending local file attachments scoped to the selected session", () => {
    let state: WorkbenchState = {
      ...initialWorkbenchState,
      sessions: [sessionSummary("session-a"), sessionSummary("session-b")],
      selectedSessionId: "session-a",
    };

    state = workbenchReducer(state, {
      type: "ADD_LOCAL_FILE_ATTACHMENT",
      sessionId: "session-a",
      file: {
        path: "/tmp/notes.md",
        name: "notes.md",
        mimeType: "text/markdown",
        sizeBytes: 128,
        content: "# Notes",
      },
    });
    state = workbenchReducer(state, {
      type: "ADD_LOCAL_FILE_ATTACHMENT",
      sessionId: "session-a",
      file: {
        path: "/tmp/notes.md",
        name: "notes.md",
        mimeType: "text/markdown",
        sizeBytes: 128,
        content: "# Notes",
      },
    });
    state = workbenchReducer(state, {
      type: "ADD_LOCAL_FILE_ATTACHMENT",
      sessionId: "session-b",
      file: {
        path: "/tmp/spec.txt",
        name: "spec.txt",
        mimeType: "text/plain",
        sizeBytes: 64,
        content: "Spec",
      },
    });

    expect(state.sessionLocalFileAttachments["session-a"]).toHaveLength(1);
    expect(state.sessionLocalFileAttachments["session-b"]?.[0]?.path).toBe("/tmp/spec.txt");

    state = workbenchReducer(state, {
      type: "REMOVE_LOCAL_FILE_ATTACHMENT",
      sessionId: "session-a",
      path: "/tmp/notes.md",
    });

    expect(state.sessionLocalFileAttachments["session-a"]).toBeUndefined();
    expect(state.sessionLocalFileAttachments["session-b"]).toHaveLength(1);

    state = workbenchReducer(state, {
      type: "CLEAR_LOCAL_FILE_ATTACHMENTS",
      sessionId: "session-b",
    });

    expect(state.sessionLocalFileAttachments["session-b"]).toBeUndefined();
  });

  it("keeps selected composer skills scoped to the selected session", () => {
    let state: WorkbenchState = {
      ...initialWorkbenchState,
      sessions: [sessionSummary("session-a"), sessionSummary("session-b")],
      selectedSessionId: "session-a",
    };

    state = workbenchReducer(state, { type: "SET_SELECTED_SKILL_IDS", skillIds: ["check"] });
    state = workbenchReducer(state, { type: "SELECT_SESSION", sessionId: "session-b" });

    expect(state.selectedSkillIds).toEqual([]);

    state = workbenchReducer(state, { type: "SET_SELECTED_SKILL_IDS", skillIds: ["frontend-design"] });
    state = workbenchReducer(state, { type: "SELECT_SESSION", sessionId: "session-a" });

    expect(state.selectedSkillIds).toEqual(["check"]);

    state = workbenchReducer(state, {
      type: "BEGIN_RUN_REQUEST",
      sessionId: "session-a",
      prompt: "use this skill",
      createdAt: Date.now(),
    });

    expect(state.selectedSkillIds).toEqual([]);
    expect(state.sessionSkillIds["session-a"]).toBeUndefined();
  });

  it("merges streamed approval action updates back into the active snapshot", () => {
    const createdAt = 1_714_000_000_000;
    const approvedActionId = "run-approval:action:solo_agent-tool-1";
    const nextActionId = "run-approval:action:solo_agent-tool-2";
    const snapshot = {
      runId: "run-approval",
      sessionId: "session-approval",
      turnIndex: 1,
      status: "running",
      pattern: "orchestrator_subagent",
      modeId: SINGLE_AGENT_MODE_ID,
      input: { prompt: "Install Waza skills.", createdAt, context: {} },
      config: {
        modeId: SINGLE_AGENT_MODE_ID,
        pattern: "orchestrator_subagent",
        modeSelection: "manual",
        profileIds: ["solo_agent"],
        providerId: "local-smoke",
        modelRef: "local/smoke-model",
        approvalMode: "high_risk_only",
        patternOptions: {},
        metadata: {},
        deterministicSeed: "state-approval-test",
        skillIds: [],
        toolIds: ["skills.create"],
      },
      topology: { nodes: [], edges: [] },
      profiles: [],
      memory: [],
      plan: [],
      todos: [],
      actions: [{
        id: approvedActionId,
        runId: "run-approval",
        type: "skills.create",
        riskLevel: "high",
        status: "approved",
        input: { name: "waza-think" },
        artifactIds: [],
      }],
      toolCalls: [],
      policyDecisions: [],
      checkpoints: [],
      events: [],
      artifacts: [],
      activeAgents: [],
      queueSummary: { mode: "dag", pending: 0, inProgress: 0, completed: 0, topics: [] },
      sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
      busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
      pendingClarifications: [],
      pendingApprovals: [],
      updatedAt: createdAt,
    } as unknown as OraStateSnapshot;
    const approvalAction = {
      id: nextActionId,
      runId: "run-approval",
      type: "skills.create",
      riskLevel: "high",
      status: "approval_required",
      input: { name: "waza-design" },
      artifactIds: [],
    };
    const stream = {
      runId: "run-approval",
      status: "interrupted",
      fromSeq: 1,
      nextSeq: 3,
      events: [{
        id: "run-approval:event:2",
        runId: "run-approval",
        seq: 2,
        type: "action.updated",
        createdAt: createdAt + 1,
        payload: {
          actionId: nextActionId,
          status: "approval_required",
          record: approvalAction,
        },
      }],
    } as unknown as OraRunEventStream;

    const merged = mergeRunStreamSnapshot(snapshot, stream);

    expect(merged?.status).toBe("interrupted");
    expect(merged?.pendingApprovals).toEqual([nextActionId]);
    expect(merged?.actions.find((action) => action.id === nextActionId)).toMatchObject({
      type: "skills.create",
      status: "approval_required",
      input: { name: "waza-design" },
    });
  });

  it("preserves accumulated debate transcript messages when a narrower snapshot arrives", () => {
    const opening = debateTranscriptMessage({
      id: "run-debate:agent-message:0",
      sequence: 0,
      stance: "affirmative",
      speakerLabel: "正方主辩",
      content: "Opening argument.",
    });
    const response = debateTranscriptMessage({
      id: "run-debate:agent-message:1",
      sequence: 1,
      stance: "negative",
      speakerLabel: "反方主辩",
      content: "Opening response.",
    });
    const existing = testSnapshot({
      agentMessages: [opening],
      updatedAt: 1_714_000_000_001,
    });
    const incoming = testSnapshot({
      agentMessages: [response],
      updatedAt: 1_714_000_000_002,
    });

    const merged = mergeStateSnapshot(existing, incoming);

    expect(merged?.agentMessages.map((message) => message.transcript?.speakerLabel)).toEqual(["正方主辩", "反方主辩"]);
    expect(merged?.agentMessages.map((message) => message.content)).toEqual(["Opening argument.", "Opening response."]);
  });

  it("prunes cached turn snapshots outside the active session", () => {
    const activeSnapshot = testSnapshot({
      runId: "run-active",
      sessionId: "session-active",
      events: [{
        id: "run-active:event:0",
        runId: "run-active",
        seq: 0,
        type: "message.delta",
        createdAt: 1_714_000_000_000,
        payload: { role: "assistant", content: "Current", delta: "Current", streaming: true },
      } as unknown as OraStateSnapshot["events"][number]],
    });
    const staleSnapshot = testSnapshot({
      runId: "run-stale",
      sessionId: "session-stale",
      status: "succeeded",
      events: Array.from({ length: 100 }, (_, index) => ({
        id: `run-stale:event:${index}`,
        runId: "run-stale",
        seq: index,
        type: "message.delta",
        createdAt: 1_714_000_000_000 + index,
        payload: { role: "assistant", content: "Stale", delta: "Stale", streaming: true },
      })) as unknown as OraStateSnapshot["events"],
    });

    const pruned = pruneTurnSnapshotsForActiveSession(
      {
        [activeSnapshot.runId]: activeSnapshot,
        [staleSnapshot.runId]: staleSnapshot,
      },
      {
        session: sessionSummary("session-active"),
        turns: [{
          runId: activeSnapshot.runId,
          sessionId: "session-active",
          turnIndex: 1,
          status: "running",
          pattern: activeSnapshot.pattern,
          prompt: activeSnapshot.input.prompt,
          startedAt: activeSnapshot.updatedAt,
          updatedAt: activeSnapshot.updatedAt,
          eventCount: activeSnapshot.events.length,
          checkpointCount: 0,
          artifactCount: 0,
        }],
        transcript: [],
        latestSnapshot: activeSnapshot,
      },
    );

    expect(Object.keys(pruned)).toEqual(["run-active"]);
    expect(pruned["run-active"].events).toHaveLength(1);
  });

  it("preserves running turn snapshots from inactive sessions during active-session pruning", () => {
    const activeSnapshot = testSnapshot({
      runId: "run-active",
      sessionId: "session-active",
      status: "succeeded",
    });
    const inactiveRunningSnapshot = testSnapshot({
      runId: "run-inactive-running",
      sessionId: "session-inactive-running",
      status: "running",
      events: [{
        id: "run-inactive-running:event:0",
        runId: "run-inactive-running",
        seq: 0,
        type: "message.delta",
        createdAt: 1_714_000_000_050,
        payload: {
          role: "assistant",
          messageId: "message-inactive",
          content: "Still streaming",
          delta: "Still streaming",
          streaming: true,
        },
      } as unknown as OraStateSnapshot["events"][number]],
    });

    const pruned = pruneTurnSnapshotsForActiveSession(
      {
        [activeSnapshot.runId]: activeSnapshot,
        [inactiveRunningSnapshot.runId]: inactiveRunningSnapshot,
      },
      {
        session: sessionSummary("session-active"),
        turns: [{
          runId: activeSnapshot.runId,
          sessionId: "session-active",
          turnIndex: 1,
          status: "succeeded",
          pattern: activeSnapshot.pattern,
          prompt: activeSnapshot.input.prompt,
          startedAt: activeSnapshot.updatedAt,
          updatedAt: activeSnapshot.updatedAt,
          eventCount: activeSnapshot.events.length,
          checkpointCount: 0,
          artifactCount: 0,
        }],
        transcript: [],
        latestSnapshot: activeSnapshot,
      },
    );

    expect(Object.keys(pruned)).toEqual([
      "run-active",
      "run-inactive-running",
    ]);
    expect(pruned["run-inactive-running"]?.events[0]?.payload).toMatchObject({
      content: "Still streaming",
    });
  });

  it("compacts cached session details so prefetch does not retain heavyweight snapshots", () => {
    const snapshot = testSnapshot({
      runId: "run-heavy",
      sessionId: "session-heavy",
      events: Array.from({ length: 50 }, (_, index) => ({
        id: `run-heavy:event:${index}`,
        runId: "run-heavy",
        seq: index,
        type: "message.delta",
        createdAt: 1_714_000_000_000 + index,
        payload: { role: "assistant", content: "Heavy", delta: "Heavy", streaming: true },
      })) as unknown as OraStateSnapshot["events"],
    });

    const next = workbenchReducer(initialWorkbenchState, {
      type: "CACHE_SESSION_DETAIL",
      detail: {
        session: sessionSummary("session-heavy"),
        turns: [{
          runId: snapshot.runId,
          sessionId: "session-heavy",
          turnIndex: 1,
          status: "succeeded",
          pattern: snapshot.pattern,
          prompt: snapshot.input.prompt,
          startedAt: snapshot.updatedAt,
          updatedAt: snapshot.updatedAt,
          eventCount: snapshot.events.length,
          checkpointCount: 0,
          artifactCount: 0,
        }],
        transcript: [],
        latestSnapshot: {
          ...snapshot,
          actions: [{
            id: "run-heavy:action:0",
            runId: snapshot.runId,
            type: "agent.builder.invoke",
            riskLevel: "low",
            status: "succeeded",
            input: {},
            output: { events: Array.from({ length: 50 }, (_, index) => ({ index })) },
            artifactIds: [],
          }],
          output: { text: "large final output" },
        },
      },
    });

    const cachedSnapshot = next.sessionDetailsById["session-heavy"]?.latestSnapshot;
    expect(cachedSnapshot?.runId).toBe("run-heavy");
    expect(cachedSnapshot?.events).toEqual([]);
    expect(cachedSnapshot?.actions).toEqual([]);
    expect(cachedSnapshot?.output).toBeUndefined();
    expect(next.sessionLiveSnapshotsById["session-heavy"]?.events).toHaveLength(50);
    expect(next.sessionLiveSnapshotsById["session-heavy"]?.actions).toHaveLength(1);
    expect(next.sessionLiveSnapshotsById["session-heavy"]?.output).toEqual({ text: "large final output" });
  });

  it("preserves desktop and runtime latency marks when snapshots merge", () => {
    const existing = testSnapshot({
      latency: {
        marks: [{ name: "submitAt", at: 100, source: "desktop", detail: {} }],
      },
    });
    const incoming = testSnapshot({
      latency: {
        marks: [{ name: "firstApplyLiveEvent", at: 120, source: "runtime", detail: { eventType: "run.started" } }],
      },
      updatedAt: 1_714_000_000_002,
    });

    const merged = mergeStateSnapshot(existing, incoming);

    expect(merged?.latency?.marks.map((mark) => `${mark.source}:${mark.name}`)).toEqual([
      "desktop:submitAt",
      "runtime:firstApplyLiveEvent",
    ]);
  });

  it("records stream latency marks from bridge receive through desktop batch flush", () => {
    const snapshot = testSnapshot({ runId: "run-latency" });
    const state: WorkbenchState = {
      ...initialWorkbenchState,
      selectedSessionId: snapshot.sessionId,
      selectedTurnRunId: snapshot.runId,
      runLifecycle: lifecycleFromSnapshot(snapshot),
      activeSessionDetail: {
        session: sessionSummary(snapshot.sessionId!),
        turns: [{
          runId: snapshot.runId,
          sessionId: snapshot.sessionId!,
          turnIndex: 1,
          status: "running",
          pattern: snapshot.pattern,
          prompt: snapshot.input.prompt,
          startedAt: snapshot.updatedAt,
          updatedAt: snapshot.updatedAt,
          eventCount: 0,
          checkpointCount: 0,
          artifactCount: 0,
        }],
        transcript: [],
        latestSnapshot: snapshot,
      },
    };
    const stream = {
      runId: snapshot.runId,
      fromSeq: 0,
      nextSeq: 1,
      status: "running",
      latency: {
        marks: [
          { source: "runtime", name: "streamStdoutWriteAt", at: 170, detail: { transport: "stdio" } },
          { source: "bridge", name: "tauriRunEventReceivedAt", at: 180, detail: { transport: "stdio_bridge" } },
          { source: "bridge", name: "tauriRunEventEmittedAt", at: 190, detail: { transport: "tauri_event" } },
        ],
      },
      events: [{
        id: "run-latency:event:0",
        runId: snapshot.runId,
        seq: 0,
        type: "message.delta",
        createdAt: snapshot.updatedAt + 1,
        payload: { role: "assistant", content: "Hello", delta: "Hello", streaming: true },
      }],
    } as unknown as OraRunEventStream;

    const next = workbenchReducer(state, { type: "APPLY_RUN_STREAM", stream, receivedAt: 200, flushedAt: 220 });

    expect(getActiveSnapshot(next.runLifecycle)?.latency?.marks.map((mark) => `${mark.source}:${mark.name}`)).toEqual(expect.arrayContaining([
      "runtime:streamStdoutWriteAt",
      "bridge:tauriRunEventReceivedAt",
      "bridge:tauriRunEventEmittedAt",
      "desktop:firstRunStreamReceivedAt",
      "desktop:firstRunStreamBatchFlushedAt",
      "desktop:firstMessageDeltaAt",
      "desktop:firstNonProgressAssistantTextAt",
    ]));
  });

  it("keeps richer live snapshot events when hydrating with a stale same-run snapshot", () => {
    const sessionId = "session-hydrate-monotonic";
    const runId = "run-hydrate-monotonic";
    const liveSnapshot = testSnapshot({
      runId,
      sessionId,
      status: "running",
      events: [{
        id: `${runId}:event:0`,
        runId,
        seq: 0,
        type: "message.delta",
        createdAt: 1_714_000_000_010,
        payload: { role: "assistant", content: "Hi", delta: "Hi", streaming: true },
      }] as unknown as OraStateSnapshot["events"],
      updatedAt: 1_714_000_000_010,
    });
    const staleHydrateSnapshot = testSnapshot({
      runId,
      sessionId,
      status: "running",
      events: [],
      updatedAt: 1_714_000_000_005,
    });
    const session = {
      ...sessionSummary(sessionId),
      latestRunId: runId,
      status: "running" as const,
    };

    const next = workbenchReducer({
      ...initialWorkbenchState,
      selectedSessionId: sessionId,
      selectedTurnRunId: runId,
      runLifecycle: lifecycleFromSnapshot(liveSnapshot),
    }, {
      type: "HYDRATE_SESSION",
      projects: [],
      sessions: [session],
      detail: {
        session,
        turns: [{
          runId,
          sessionId,
          turnIndex: 1,
          status: "running",
          pattern: liveSnapshot.pattern,
          prompt: liveSnapshot.input.prompt,
          startedAt: liveSnapshot.input.createdAt ?? liveSnapshot.updatedAt,
          updatedAt: staleHydrateSnapshot.updatedAt,
          eventCount: 0,
          checkpointCount: 0,
          artifactCount: 0,
        }],
        transcript: [],
        latestSnapshot: staleHydrateSnapshot,
      },
    });

    expect(getActiveSnapshot(next.runLifecycle)?.events.map((event) => event.id)).toEqual([`${runId}:event:0`]);
    expect(getActiveSnapshot(next.runLifecycle)?.updatedAt).toBe(liveSnapshot.updatedAt);
  });

  it("preserves early stream latency while the run state snapshot is still loading", () => {
    const sessionId = "session-early-stream";
    const runId = "run-early-stream";
    const prompt = "Debate this.";
    const state: WorkbenchState = {
      ...initialWorkbenchState,
      selectedSessionId: sessionId,
      runLifecycle: lifecycleFromPendingRun({ sessionId, prompt, createdAt: 100 }),
      isLoading: true,
    };
    const withHandle = workbenchReducer(state, {
      type: "ATTACH_PENDING_RUN_HANDLE",
      sessionId,
      prompt,
      runId,
    });
    const stream = {
      runId,
      fromSeq: 0,
      nextSeq: 1,
      status: "running",
      events: [{
        id: `${runId}:event:0`,
        runId,
        seq: 0,
        type: "run.started",
        createdAt: 101,
        payload: { status: "running" },
      }],
    } as unknown as OraRunEventStream;

    const afterStream = workbenchReducer(withHandle, {
      type: "APPLY_RUN_STREAM",
      stream,
      receivedAt: 150,
    });
    const selected = workbenchReducer(afterStream, {
      type: "SELECT_TURN",
      runId,
      snapshot: testSnapshot({ runId, sessionId }),
    });

    expect(afterStream.selectedTurnRunId).toBe(runId);
    expect(getPendingRunState(afterStream.runLifecycle)?.latency?.marks).toEqual([{
      name: "firstRunStreamReceivedAt",
      at: 150,
      source: "desktop",
      detail: { eventType: "run.started", eventCount: 1 },
    }]);
    expect(getActiveSnapshot(afterStream.runLifecycle)).toBeUndefined();
    expect(getPendingRunState(selected.runLifecycle)).toBeUndefined();
    expect(getActiveSnapshot(selected.runLifecycle)?.latency?.marks).toEqual([{
      name: "firstRunStreamReceivedAt",
      at: 150,
      source: "desktop",
      detail: { eventType: "run.started", eventCount: 1 },
    }]);
  });

  it("shows pending run stream text before the run handle is attached", () => {
    const sessionId = "session-pre-handle";
    const prompt = "你能做什么？";
    const runId = "run-pre-handle";
    const state: WorkbenchState = {
      ...initialWorkbenchState,
      selectedSessionId: sessionId,
      selectedTurnRunId: "run-previous",
      runLifecycle: lifecycleFromPendingRun({ sessionId, prompt, createdAt: 100 }),
      isLoading: true,
    };
    const stream = {
      runId,
      sessionId,
      prompt,
      fromSeq: 0,
      nextSeq: 1,
      status: "running",
      events: [{
        id: `${runId}:event:0`,
        runId,
        seq: 0,
        type: "message.delta",
        createdAt: 120,
        payload: { role: "assistant", content: "我可以", delta: "我可以", streaming: true },
      }],
    } as unknown as OraRunEventStream;

    const afterStream = workbenchReducer(state, {
      type: "APPLY_RUN_STREAM",
      stream,
      receivedAt: 130,
    });
    const withHandle = workbenchReducer(afterStream, {
      type: "ATTACH_PENDING_RUN_HANDLE",
      sessionId,
      prompt,
      runId,
    });

    expect(afterStream.selectedTurnRunId).toBe(runId);
    expect(getActiveSnapshot(afterStream.runLifecycle)?.runId).toBe(runId);
    expect(getActiveSnapshot(afterStream.runLifecycle)?.sessionId).toBe(sessionId);
    expect(getActiveSnapshot(afterStream.runLifecycle)?.input.prompt).toBe(prompt);
    expect(getActiveSnapshot(afterStream.runLifecycle)?.events.map((event) => event.type)).toEqual(["message.delta"]);
    expect(afterStream.runLifecycle.stage).toBe("streaming");
    expect(getActiveSnapshot(afterStream.runLifecycle)?.events.map((event) => event.type)).toEqual(["message.delta"]);
    expect(getActiveSnapshot(afterStream.runLifecycle)?.latency?.marks.map((mark) => mark.name)).toEqual([
      "firstRunStreamReceivedAt",
      "firstMessageDeltaAt",
      "firstNonProgressAssistantTextAt",
    ]);
    expect(getPendingRunState(withHandle.runLifecycle)).toBeUndefined();
    expect(getActiveSnapshot(withHandle.runLifecycle)?.events).toHaveLength(1);
  });

  it("keeps second-turn pre-handle streams materialized as the next turn", () => {
    const sessionId = "session-second-turn-pre-handle";
    const firstRunId = "run-first-turn";
    const secondRunId = "run-second-turn";
    const prompt = "继续分析";
    const createdAt = 1_714_000_000_000;
    const session: OraSessionSummary = {
      ...sessionSummary(sessionId),
      turnCount: 1,
      latestRunId: firstRunId,
      status: "succeeded",
    };
    const state: WorkbenchState = {
      ...initialWorkbenchState,
      selectedSessionId: sessionId,
      selectedTurnRunId: firstRunId,
      activeSessionDetail: {
        session,
        turns: [{
          runId: firstRunId,
          sessionId,
          turnIndex: 1,
          status: "succeeded",
          pattern: "orchestrator_subagent",
          prompt: "第一轮",
          startedAt: createdAt,
          updatedAt: createdAt,
          eventCount: 2,
          checkpointCount: 0,
          artifactCount: 0,
        }],
        transcript: [{
          id: `${firstRunId}:user`,
          sessionId,
          runId: firstRunId,
          turnIndex: 1,
          role: "user",
          content: "第一轮",
          pattern: "orchestrator_subagent",
          createdAt,
        }],
        latestSnapshot: testSnapshot({
          runId: firstRunId,
          sessionId,
          status: "succeeded",
          updatedAt: createdAt,
        }),
      },
      runLifecycle: lifecycleFromPendingRun({
        sessionId,
        prompt,
        createdAt: createdAt + 1_000,
      }),
      isLoading: true,
    };
    const stream = {
      runId: secondRunId,
      sessionId,
      prompt,
      fromSeq: 0,
      nextSeq: 1,
      status: "running",
      events: [{
        id: `${secondRunId}:event:0`,
        runId: secondRunId,
        seq: 0,
        type: "message.delta",
        createdAt: createdAt + 1_100,
        payload: { role: "assistant", content: "好的", delta: "好的", streaming: true },
      }],
    } as unknown as OraRunEventStream;

    const next = workbenchReducer(state, {
      type: "APPLY_RUN_STREAM",
      stream,
      receivedAt: createdAt + 1_200,
    });
    const activeSnapshot = getActiveSnapshot(next.runLifecycle);

    expect(activeSnapshot?.runId).toBe(secondRunId);
    expect(activeSnapshot?.turnIndex).toBe(2);
    expect(activeSnapshot?.input.prompt).toBe(prompt);
    expect(next.selectedTurnRunId).toBe(secondRunId);
    expect(getPendingRunState(next.runLifecycle)).toBeUndefined();
  });

  it("accumulates explicit assistant message deltas by run and message id", () => {
    const sessionId = "session-live-buffer";
    const prompt = "介绍 Ora";
    const runId = "run-live-buffer";
    const messageId = `${runId}:assistant:solo:solo:0`;
    const state: WorkbenchState = {
      ...initialWorkbenchState,
      selectedSessionId: sessionId,
      runLifecycle: lifecycleFromPendingRun({ sessionId, prompt, createdAt: 100 }),
      isLoading: true,
    };
    const firstStream = {
      runId,
      sessionId,
      prompt,
      fromSeq: 0,
      nextSeq: 1,
      status: "running",
      events: [{
        id: `${runId}:evt-0`,
        runId,
        seq: 0,
        type: "message.delta",
        createdAt: 120,
        agentId: "solo",
        nodeId: "solo",
        payload: { role: "assistant", messageId, content: "Hi", delta: "Hi", streaming: true },
      }],
    } as unknown as OraRunEventStream;
    const secondStream = {
      ...firstStream,
      fromSeq: 1,
      nextSeq: 2,
      events: [{
        id: `${runId}:evt-1`,
        runId,
        seq: 1,
        type: "message.delta",
        createdAt: 130,
        agentId: "solo",
        nodeId: "solo",
        payload: { role: "assistant", messageId, content: " there", delta: " there", streaming: true },
      }],
    } as unknown as OraRunEventStream;

    const afterFirst = workbenchReducer(state, {
      type: "APPLY_RUN_STREAM",
      stream: firstStream,
      receivedAt: 125,
    });
    const afterSecond = workbenchReducer(afterFirst, {
      type: "APPLY_RUN_STREAM",
      stream: secondStream,
      receivedAt: 135,
    });

    const entry = Object.values(afterSecond.liveMessageDeltaBuffer)[0];
    expect(entry).toMatchObject({
      runId,
      messageId,
      sessionId,
      role: "assistant",
      content: "Hi there",
      agentId: "solo",
      nodeId: "solo",
      createdAt: 120,
      updatedAt: 130,
    });

    const settled = workbenchReducer(afterSecond, {
      type: "APPLY_RUN_STREAM",
      stream: {
        ...secondStream,
        fromSeq: 2,
        nextSeq: 3,
        status: "succeeded",
        events: [{
          id: `${runId}:evt-2`,
          runId,
          seq: 2,
          type: "run.done",
          createdAt: 140,
          payload: { status: "succeeded", output: { text: "Hi there" } },
        }],
        snapshot: testSnapshot({ runId, sessionId, status: "succeeded", updatedAt: 140 }),
      } as unknown as OraRunEventStream,
      receivedAt: 145,
    });
    expect(settled.liveMessageDeltaBuffer).toEqual({});
  });

  it("does not append duplicate live message delta events by seq", () => {
    const sessionId = "session-live-buffer-duplicate";
    const prompt = "介绍 Ora";
    const runId = "run-live-buffer-duplicate";
    const messageId = `${runId}:assistant:solo:solo:0`;
    const state: WorkbenchState = {
      ...initialWorkbenchState,
      selectedSessionId: sessionId,
      runLifecycle: lifecycleFromPendingRun({ sessionId, prompt, createdAt: 100 }),
      isLoading: true,
    };
    const stream = {
      runId,
      sessionId,
      prompt,
      fromSeq: 0,
      nextSeq: 1,
      status: "running",
      events: [{
        id: `${runId}:evt-0`,
        runId,
        seq: 0,
        type: "message.delta",
        createdAt: 120,
        agentId: "solo",
        nodeId: "solo",
        payload: { role: "assistant", messageId, content: "Hi", delta: "Hi", streaming: true },
      }],
    } as unknown as OraRunEventStream;

    const afterFirst = workbenchReducer(state, {
      type: "APPLY_RUN_STREAM",
      stream,
      receivedAt: 125,
    });
    const afterDuplicate = workbenchReducer(afterFirst, {
      type: "APPLY_RUN_STREAM",
      stream,
      receivedAt: 126,
    });

    const entry = Object.values(afterDuplicate.liveMessageDeltaBuffer)[0];
    expect(entry?.content).toBe("Hi");
    expect(getActiveSnapshot(afterDuplicate.runLifecycle)?.events).toHaveLength(1);
  });

  it("treats explicit content-only assistant message events as cumulative replacements", () => {
    const sessionId = "session-live-buffer-cumulative";
    const prompt = "介绍 Ora";
    const runId = "run-live-buffer-cumulative";
    const messageId = `${runId}:assistant:solo:solo:0`;
    const state: WorkbenchState = {
      ...initialWorkbenchState,
      selectedSessionId: sessionId,
      runLifecycle: lifecycleFromPendingRun({ sessionId, prompt, createdAt: 100 }),
      isLoading: true,
    };
    const firstStream = {
      runId,
      sessionId,
      prompt,
      fromSeq: 0,
      nextSeq: 1,
      status: "running",
      events: [{
        id: `${runId}:evt-0`,
        runId,
        seq: 0,
        type: "message.delta",
        createdAt: 120,
        agentId: "solo",
        nodeId: "solo",
        payload: { role: "assistant", messageId, content: "Hi", delta: "Hi", streaming: true },
      }],
    } as unknown as OraRunEventStream;
    const secondStream = {
      ...firstStream,
      fromSeq: 1,
      nextSeq: 2,
      events: [{
        id: `${runId}:evt-1`,
        runId,
        seq: 1,
        type: "message.delta",
        createdAt: 130,
        agentId: "solo",
        nodeId: "solo",
        payload: { role: "assistant", messageId, content: "Hi there", streaming: false },
      }],
    } as unknown as OraRunEventStream;

    const afterFirst = workbenchReducer(state, {
      type: "APPLY_RUN_STREAM",
      stream: firstStream,
      receivedAt: 125,
    });
    const afterSecond = workbenchReducer(afterFirst, {
      type: "APPLY_RUN_STREAM",
      stream: secondStream,
      receivedAt: 135,
    });

    const entry = Object.values(afterSecond.liveMessageDeltaBuffer)[0];
    expect(entry?.content).toBe("Hi there");
  });

  it("keeps materialized active snapshots stable for live delta-only streams", () => {
    const sessionId = "session-live-overlay-stable";
    const runId = "run-live-overlay-stable";
    const messageId = `${runId}:assistant:solo:solo:0`;
    const runningSnapshot = testSnapshot({ runId, sessionId, status: "running", updatedAt: 100 });
    const state: WorkbenchState = {
      ...initialWorkbenchState,
      selectedSessionId: sessionId,
      selectedTurnRunId: runId,
      runLifecycle: lifecycleFromSnapshot(runningSnapshot),
      isLoading: true,
    };
    const firstStream = {
      runId,
      sessionId,
      fromSeq: 0,
      nextSeq: 1,
      status: "running",
      events: [{
        id: `${runId}:evt-0`,
        runId,
        seq: 0,
        type: "message.delta",
        createdAt: 120,
        agentId: "solo",
        nodeId: "solo",
        payload: { role: "assistant", messageId, content: "Hi", delta: "Hi", streaming: true },
      }],
    } as unknown as OraRunEventStream;
    const secondStream = {
      ...firstStream,
      fromSeq: 1,
      nextSeq: 2,
      events: [{
        id: `${runId}:evt-1`,
        runId,
        seq: 1,
        type: "message.delta",
        createdAt: 130,
        agentId: "solo",
        nodeId: "solo",
        payload: { role: "assistant", messageId, content: " there", delta: " there", streaming: true },
      }],
    } as unknown as OraRunEventStream;

    const afterFirst = workbenchReducer(state, {
      type: "APPLY_RUN_STREAM",
      stream: firstStream,
      receivedAt: 125,
    });
    const afterSecond = workbenchReducer(afterFirst, {
      type: "APPLY_RUN_STREAM",
      stream: secondStream,
      receivedAt: 135,
    });

    expect(afterFirst.runLifecycle).not.toBe(state.runLifecycle);
    expect(afterSecond.runLifecycle).toBe(afterFirst.runLifecycle);
    expect(getActiveSnapshot(afterSecond.runLifecycle)).toBe(getActiveSnapshot(afterFirst.runLifecycle));
    expect(getActiveSnapshot(afterSecond.runLifecycle)?.events).toHaveLength(1);
    expect(Object.values(afterSecond.liveMessageDeltaBuffer)[0]?.content).toBe("Hi there");
  });

  it("settles an active run from a terminal event-only stream", () => {
    const sessionId = "session-event-only-terminal";
    const runId = "run-event-only-terminal";
    const runningSnapshot = testSnapshot({ runId, sessionId, status: "running", updatedAt: 100 });
    const state: WorkbenchState = {
      ...initialWorkbenchState,
      selectedSessionId: sessionId,
      selectedTurnRunId: runId,
      runLifecycle: lifecycleFromSnapshot(runningSnapshot),
      isLoading: true,
    };
    const stream = {
      runId,
      sessionId,
      fromSeq: 0,
      nextSeq: 1,
      events: [{
        id: `${runId}:evt-done`,
        runId,
        seq: 0,
        type: "run.done",
        createdAt: 150,
        payload: { status: "succeeded" },
      }],
    } as unknown as OraRunEventStream;

    const next = workbenchReducer(state, {
      type: "APPLY_RUN_STREAM",
      stream,
      receivedAt: 160,
    });

    expect(next.runLifecycle.stage).toBe("settled");
    expect(getActiveSnapshot(next.runLifecycle)?.status).toBe("succeeded");
    expect(next.isLoading).toBe(false);
    expect(next.commandFeedback).toBe("Run completed.");
  });

  it("ignores legacy message deltas without explicit message ids", () => {
    const sessionId = "session-legacy-buffer";
    const prompt = "介绍 Ora";
    const runId = "run-legacy-buffer";
    const state: WorkbenchState = {
      ...initialWorkbenchState,
      selectedSessionId: sessionId,
      selectedTurnRunId: runId,
      runLifecycle: lifecycleFromPendingRun({ sessionId, runId, prompt, createdAt: 100 }),
      isLoading: true,
    };
    const stream = {
      runId,
      sessionId,
      prompt,
      fromSeq: 0,
      nextSeq: 1,
      status: "running",
      events: [{
        id: `${runId}:evt-0`,
        runId,
        seq: 0,
        type: "message.delta",
        createdAt: 120,
        payload: { role: "assistant", content: "legacy", delta: "legacy", streaming: true },
      }],
    } as unknown as OraRunEventStream;

    const next = workbenchReducer(state, {
      type: "APPLY_RUN_STREAM",
      stream,
      receivedAt: 125,
    });

    expect(next.liveMessageDeltaBuffer).toEqual({});
    expect(getActiveSnapshot(next.runLifecycle)?.events).toHaveLength(1);
  });

  it("preserves a normal pending run across stale session hydration until the run materializes", () => {
    const sessionId = "session-pending-hydrate";
    const prompt = "解释一下这个项目。";
    const createdAt = 1_714_000_000_100;
    const session = sessionSummary(sessionId);
    const state = workbenchReducer({
      ...initialWorkbenchState,
      selectedSessionId: sessionId,
      activeSessionDetail: {
        session,
        turns: [],
        transcript: [],
        latestSnapshot: undefined,
      },
    }, {
      type: "BEGIN_RUN_REQUEST",
      sessionId,
      prompt,
      createdAt,
    });

    const hydrated = workbenchReducer(state, {
      type: "HYDRATE_SESSION",
      projects: [],
      sessions: [session],
      detail: {
        session,
        turns: [],
        transcript: [],
        latestSnapshot: undefined,
      },
    });

    expect(getPendingRunState(hydrated.runLifecycle)).toMatchObject({
      sessionId,
      prompt,
      createdAt,
    });
    expect(hydrated.isLoading).toBe(true);
  });

  it("clears a normal pending run once hydrated transcript can render the user message", () => {
    const sessionId = "session-pending-materialized";
    const runId = "run-materialized";
    const prompt = "解释一下这个项目。";
    const createdAt = 1_714_000_000_100;
    const session = sessionSummary(sessionId);
    const state = workbenchReducer({
      ...initialWorkbenchState,
      selectedSessionId: sessionId,
      runLifecycle: { stage: "pending", sessionId, runId, prompt, createdAt },
      isLoading: true,
    }, {
      type: "HYDRATE_SESSION",
      projects: [],
      sessions: [session],
      detail: {
        session,
        turns: [{
          runId,
          sessionId,
          turnIndex: 1,
          status: "running",
          pattern: "orchestrator_subagent",
          prompt,
          startedAt: createdAt,
          updatedAt: createdAt,
          eventCount: 0,
          checkpointCount: 0,
          artifactCount: 0,
        }],
        transcript: [{
          id: `${runId}:user`,
          sessionId,
          runId,
          turnIndex: 1,
          role: "user",
          content: prompt,
          pattern: "orchestrator_subagent",
          createdAt,
        }],
        latestSnapshot: undefined,
      },
    });

    expect(getPendingRunState(state.runLifecycle)).toBeUndefined();
    expect(state.isLoading).toBe(false);
  });

  it("keeps a first-turn snapshot renderable before the new session transcript hydrates", () => {
    const sessionId = "session-first-turn-snapshot-window";
    const runId = "run-first-turn-snapshot-window";
    const prompt = "写一段手稿。";
    const createdAt = 1_714_000_000_100;
    const session = sessionSummary(sessionId);
    const started = workbenchReducer({
      ...initialWorkbenchState,
      selectedSessionId: sessionId,
      activeSessionDetail: {
        session,
        turns: [],
        transcript: [],
        latestSnapshot: undefined,
      },
    }, {
      type: "BEGIN_RUN_REQUEST",
      sessionId,
      prompt,
      createdAt,
    });
    const withHandle = workbenchReducer(started, {
      type: "ATTACH_PENDING_RUN_HANDLE",
      sessionId,
      prompt,
      runId,
    });
    const snapshotWithoutSessionId = {
      ...testSnapshot({ runId, updatedAt: createdAt + 100 }),
      sessionId: undefined,
      input: { prompt, createdAt, context: {} },
    } as unknown as OraStateSnapshot;

    const selected = workbenchReducer(withHandle, {
      type: "SELECT_TURN",
      runId,
      snapshot: snapshotWithoutSessionId,
    });

    expect(getPendingRunState(selected.runLifecycle)).toBeUndefined();
    expect(getActiveSnapshot(selected.runLifecycle)?.sessionId).toBe(sessionId);
    expect(deriveRenderableTurnSnapshots({
      detail: selected.activeSessionDetail,
      activeSnapshot: getActiveSnapshot(selected.runLifecycle),
      turnSnapshots: {},
      selectedSessionId: sessionId,
      preservedSettledSnapshots: {},
    })[runId]?.input.prompt).toBe(prompt);
  });

  it("does not match pre-handle streams from another session with the same prompt", () => {
    const prompt = "same prompt";
    const state: WorkbenchState = {
      ...initialWorkbenchState,
      selectedSessionId: "session-active",
      runLifecycle: lifecycleFromPendingRun({ sessionId: "session-active", prompt, createdAt: 100 }),
      isLoading: true,
    };
    const stream = {
      runId: "run-other-session",
      sessionId: "session-other",
      prompt,
      fromSeq: 0,
      nextSeq: 1,
      status: "running",
      events: [{
        id: "run-other-session:event:0",
        runId: "run-other-session",
        seq: 0,
        type: "message.delta",
        createdAt: 120,
        payload: { role: "assistant", content: "Nope", delta: "Nope", streaming: true },
      }],
    } as unknown as OraRunEventStream;

    const next = workbenchReducer(state, {
      type: "APPLY_RUN_STREAM",
      stream,
      receivedAt: 130,
    });

    expect(getActiveSnapshot(next.runLifecycle)).toBeUndefined();
    expect(next.selectedTurnRunId).toBeUndefined();
    expect(getPendingRunState(next.runLifecycle)).toEqual(getPendingRunState(state.runLifecycle));
  });

  it("records only first stream latency for an initial running snapshot stream", () => {
    const sessionId = "session-initial-stream";
    const runId = "run-initial-stream";
    const prompt = "Hello.";
    const runningSnapshot = testSnapshot({ runId, sessionId, updatedAt: 100 });
    const state: WorkbenchState = {
      ...initialWorkbenchState,
      selectedSessionId: sessionId,
      runLifecycle: lifecycleFromPendingRun({ sessionId, prompt, createdAt: 90 }),
      isLoading: true,
    };
    const withHandle = workbenchReducer(state, {
      type: "ATTACH_PENDING_RUN_HANDLE",
      sessionId,
      prompt,
      runId,
    });
    const stream = {
      runId,
      fromSeq: 0,
      nextSeq: 0,
      status: "running",
      events: [],
      snapshot: runningSnapshot,
    } as unknown as OraRunEventStream;

    const afterStream = workbenchReducer(withHandle, {
      type: "APPLY_RUN_STREAM",
      stream,
      receivedAt: 120,
    });

    expect(getActiveSnapshot(afterStream.runLifecycle)?.runId).toBe(runId);
    expect(getPendingRunState(afterStream.runLifecycle)).toBeUndefined();
    expect(getActiveSnapshot(afterStream.runLifecycle)?.runId).toBe(runId);
    expect(getActiveSnapshot(afterStream.runLifecycle)?.latency?.marks).toEqual([{
      name: "firstRunStreamReceivedAt",
      at: 120,
      source: "desktop",
      detail: { eventType: undefined, eventCount: 0 },
    }]);
  });

  it("merges sequential delta streams by appending delta-sized content", () => {
    const snapshot = testSnapshot({
      runId: "run-stream-text",
      events: [{
        id: "run-stream-text:event:0",
        runId: "run-stream-text",
        seq: 0,
        type: "message.delta",
        createdAt: 1_714_000_000_000,
        payload: { role: "assistant", content: "Hel", delta: "Hel", streaming: true },
      } as unknown as OraStateSnapshot["events"][number]],
    });
    const stream = {
      runId: "run-stream-text",
      fromSeq: 1,
      nextSeq: 3,
      status: "running",
      events: [
        {
          id: "run-stream-text:event:1",
          runId: "run-stream-text",
          seq: 1,
          type: "message.delta",
          createdAt: 1_714_000_000_001,
          payload: { role: "assistant", content: "lo", delta: "lo", streaming: true },
        },
        {
          id: "run-stream-text:event:2",
          runId: "run-stream-text",
          seq: 2,
          type: "token.delta",
          createdAt: 1_714_000_000_002,
          payload: { text: "!", tokenCount: 1, streaming: true },
        },
      ],
    } as unknown as OraRunEventStream;

    const merged = mergeRunStreamSnapshot(snapshot, stream);
    const assistantText = merged?.events
      .filter((event) => event.type === "message.delta")
      .map((event) => {
        const payload = event.payload;
        return payload && typeof payload === "object" && !Array.isArray(payload) && typeof (payload as { content?: unknown }).content === "string"
          ? (payload as { content: string }).content
          : "";
      })
      .join("");

    expect(merged?.events.map((event) => event.seq)).toEqual([0, 1, 2]);
    expect(assistantText).toBe("Hello");
  });

  it("appends no-snapshot stream deltas to an existing snapshot for the same run", () => {
    const snapshot = testSnapshot({
      runId: "run-early-delta",
      events: [{
        id: "run-early-delta:event:0",
        runId: "run-early-delta",
        seq: 0,
        type: "run.started",
        createdAt: 1_714_000_000_000,
      } as unknown as OraStateSnapshot["events"][number]],
    });
    const stream: OraRunEventStream = {
      runId: "run-early-delta",
      fromSeq: 1,
      nextSeq: 2,
      status: "running",
      events: [{
        id: "run-early-delta:event:1",
        runId: "run-early-delta",
        seq: 1,
        type: "message.delta",
        createdAt: 1_714_000_000_001,
        payload: { role: "assistant", content: "Hi!", delta: "Hi!", streaming: true },
      } as unknown as OraRunEventStream["events"][number]],
    };

    const merged = mergeRunStreamSnapshot(snapshot, stream);

    expect(merged).toBeDefined();
    expect(merged?.events.map((event) => event.seq)).toEqual([0, 1]);
    expect(merged?.status).toBe("running");
  });

  it("projects child session and parent coordination updates from no-snapshot streams", () => {
    const snapshot = testSnapshot({
      runId: "run-overlay-live",
      events: [{
        id: "run-overlay-live:event:0",
        runId: "run-overlay-live",
        seq: 0,
        type: "run.started",
        createdAt: 1_714_000_000_000,
      } as unknown as OraStateSnapshot["events"][number]],
    });
    const stream: OraRunEventStream = {
      runId: "run-overlay-live",
      fromSeq: 1,
      nextSeq: 3,
      status: "running",
      events: [
        {
          id: "run-overlay-live:event:1",
          runId: "run-overlay-live",
          seq: 1,
          type: "child_session.updated",
          createdAt: 1_714_000_000_001,
          payload: {
            childSession: {
              id: "run-overlay-live:ora-sub-1",
              agentId: "ora-sub-1",
              label: "Researcher",
              sessionClass: "temporary_spawn",
              status: "running",
              startedAt: 1_714_000_000_001,
              updatedAt: 1_714_000_000_001,
            },
          },
        },
        {
          id: "run-overlay-live:event:2",
          runId: "run-overlay-live",
          seq: 2,
          type: "parent_coordination.updated",
          createdAt: 1_714_000_000_002,
          payload: {
            coordination: {
              phase: "waiting_on_required_children",
              activeChildIds: ["run-overlay-live:ora-sub-1"],
              waitingChildIds: ["run-overlay-live:ora-sub-1"],
              updatedAt: 1_714_000_000_002,
            },
          },
        },
      ] as unknown as OraRunEventStream["events"],
    };

    const merged = mergeRunStreamSnapshot(snapshot, stream);

    expect(merged?.childSessions).toMatchObject([
      { agentId: "ora-sub-1", status: "running", label: "Researcher" },
    ]);
    expect(merged?.parentCoordination).toMatchObject({
      phase: "waiting_on_required_children",
      activeChildIds: ["run-overlay-live:ora-sub-1"],
      waitingChildIds: ["run-overlay-live:ora-sub-1"],
    });
  });

  it("keeps child session projection when an attached stream snapshot omits collaboration fields", () => {
    const existing = testSnapshot({
      runId: "run-overlay-snapshot",
      childSessions: [{
        id: "run-overlay-snapshot:ora-sub-1",
        agentId: "ora-sub-1",
        label: "Researcher",
        sessionClass: "temporary_spawn",
        status: "queued",
        startedAt: 1_714_000_000_000,
        updatedAt: 1_714_000_000_000,
        artifactIds: [],
        recoveryAttemptCount: 0,
      }],
      parentCoordination: {
        phase: "dispatching",
        activeChildIds: ["run-overlay-snapshot:ora-sub-1"],
        waitingChildIds: [],
        blockedByChildIds: [],
        stalledChildIds: [],
        recoverableChildIds: [],
        partialResultChildIds: [],
        updatedAt: 1_714_000_000_000,
      },
      events: [{
        id: "run-overlay-snapshot:event:0",
        runId: "run-overlay-snapshot",
        seq: 0,
        type: "child_session.updated",
        createdAt: 1_714_000_000_000,
        payload: {
          childSession: {
            id: "run-overlay-snapshot:ora-sub-1",
            agentId: "ora-sub-1",
            label: "Researcher",
            sessionClass: "temporary_spawn",
            status: "queued",
            startedAt: 1_714_000_000_000,
            updatedAt: 1_714_000_000_000,
          },
        },
      } as unknown as OraStateSnapshot["events"][number]],
    });
    const stream: OraRunEventStream = {
      runId: "run-overlay-snapshot",
      fromSeq: 1,
      nextSeq: 3,
      status: "running",
      snapshot: testSnapshot({
        runId: "run-overlay-snapshot",
        updatedAt: 1_714_000_000_002,
      }),
      events: [
        {
          id: "run-overlay-snapshot:event:1",
          runId: "run-overlay-snapshot",
          seq: 1,
          type: "child_session.updated",
          createdAt: 1_714_000_000_001,
          payload: {
            childSession: {
              id: "run-overlay-snapshot:ora-sub-1",
              agentId: "ora-sub-1",
              label: "Researcher",
              sessionClass: "temporary_spawn",
              status: "running",
              startedAt: 1_714_000_000_000,
              updatedAt: 1_714_000_000_001,
            },
          },
        },
        {
          id: "run-overlay-snapshot:event:2",
          runId: "run-overlay-snapshot",
          seq: 2,
          type: "parent_coordination.updated",
          createdAt: 1_714_000_000_002,
          payload: {
            coordination: {
              phase: "waiting_on_required_children",
              activeChildIds: ["run-overlay-snapshot:ora-sub-1"],
              waitingChildIds: ["run-overlay-snapshot:ora-sub-1"],
              updatedAt: 1_714_000_000_002,
            },
          },
        },
      ] as unknown as OraRunEventStream["events"],
    };

    const merged = mergeRunStreamSnapshot(existing, stream);

    expect(merged?.childSessions).toMatchObject([
      { agentId: "ora-sub-1", status: "running" },
    ]);
    expect(merged?.parentCoordination).toMatchObject({
      phase: "waiting_on_required_children",
      waitingChildIds: ["run-overlay-snapshot:ora-sub-1"],
    });
  });

  it("merges stream latency diagnostics into snapshots without attached snapshots", () => {
    const snapshot = testSnapshot({
      runId: "run-stream-latency-merge",
      latency: {
        marks: [{ source: "runtime", name: "firstTextDelta", at: 120, detail: {} }],
      },
    });
    const stream: OraRunEventStream = {
      runId: "run-stream-latency-merge",
      fromSeq: 1,
      nextSeq: 2,
      status: "running",
      latency: {
        marks: [{ source: "bridge", name: "tauriRunEventReceivedAt", at: 140, detail: {} }],
      },
      events: [{
        id: "run-stream-latency-merge:event:1",
        runId: "run-stream-latency-merge",
        seq: 1,
        type: "token.delta",
        createdAt: 141,
        payload: { text: "x", tokenCount: 1, streaming: true },
      } as unknown as OraRunEventStream["events"][number]],
    };

    const merged = mergeRunStreamSnapshot(snapshot, stream);

    expect(merged?.latency?.marks.map((mark) => `${mark.source}:${mark.name}`)).toEqual([
      "runtime:firstTextDelta",
      "bridge:tauriRunEventReceivedAt",
    ]);
  });

  it("does not regress a final snapshot to running when a stale same-run snapshot arrives", () => {
    const existing = testSnapshot({
      runId: "run-final-no-regress",
      sessionId: "session-final-no-regress",
      status: "succeeded",
      updatedAt: 200,
      attention: {
        kind: "idle",
        blocking: false,
        sourceRunId: "run-final-no-regress",
        pendingActionIds: [],
        pendingToolCallIds: [],
        pendingClarificationIds: [],
      },
    });
    const incoming = testSnapshot({
      runId: "run-final-no-regress",
      sessionId: "session-final-no-regress",
      status: "running",
      updatedAt: 220,
      attention: {
        kind: "running",
        blocking: false,
        sourceRunId: "run-final-no-regress",
        pendingActionIds: [],
        pendingToolCallIds: [],
        pendingClarificationIds: [],
      },
    });

    const merged = mergeStateSnapshot(existing, incoming);

    expect(merged?.status).toBe("succeeded");
    expect(merged?.attention?.kind).toBe("idle");
    expect(merged?.updatedAt).toBe(220);
  });

  it("does not revive a settled active run from a late running stream", () => {
    const sessionId = "session-late-running-stream";
    const runId = "run-late-running-stream";
    const settledSnapshot = testSnapshot({
      runId,
      sessionId,
      status: "succeeded",
      updatedAt: 200,
      attention: {
        kind: "idle",
        blocking: false,
        sourceRunId: runId,
        pendingActionIds: [],
        pendingToolCallIds: [],
        pendingClarificationIds: [],
      },
    });
    const session: OraSessionSummary = {
      ...sessionSummary(sessionId),
      latestRunId: runId,
      status: "succeeded",
      attention: settledSnapshot.attention,
      turnCount: 1,
      updatedAt: 200,
    };
    const state: WorkbenchState = {
      ...initialWorkbenchState,
      selectedSessionId: sessionId,
      selectedTurnRunId: runId,
      sessions: [session],
      runLifecycle: lifecycleFromSnapshot(settledSnapshot),
      activeSessionDetail: {
        session,
        turns: [{
          runId,
          sessionId,
          turnIndex: 1,
          status: "succeeded",
          pattern: settledSnapshot.pattern,
          prompt: settledSnapshot.input.prompt,
          startedAt: 100,
          updatedAt: 200,
          eventCount: 0,
          checkpointCount: 0,
          artifactCount: 0,
          attention: settledSnapshot.attention,
        }],
        transcript: [],
        latestSnapshot: settledSnapshot,
      },
      isLoading: false,
    };
    const stream = {
      runId,
      sessionId,
      fromSeq: 1,
      nextSeq: 2,
      status: "running",
      events: [{
        id: `${runId}:event:1`,
        runId,
        seq: 1,
        type: "message.delta",
        createdAt: 230,
        payload: { role: "assistant", content: "late", delta: "late", streaming: true },
      }],
    } as unknown as OraRunEventStream;

    const next = workbenchReducer(state, { type: "APPLY_RUN_STREAM", stream, receivedAt: 240 });

    expect(next.runLifecycle.stage).toBe("settled");
    expect(getActiveSnapshot(next.runLifecycle)?.status).toBe("succeeded");
    expect(next.sessions[0]?.status).toBe("succeeded");
    expect(next.activeSessionDetail?.session.status).toBe("succeeded");
    expect(next.isLoading).toBe(false);
  });

  it("projects no-snapshot plan list updates into the active snapshot immediately", () => {
    const snapshot = testSnapshot({
      runId: "run-plan-list-delta",
      events: [{
        id: "run-plan-list-delta:event:0",
        runId: "run-plan-list-delta",
        seq: 0,
        type: "run.started",
        createdAt: 1_714_000_000_000,
      } as unknown as OraStateSnapshot["events"][number]],
    });
    const plan = [
      { id: "step-1", step: "搜索 DeepSeek-v4 API 定价概览", status: "in_progress" },
      { id: "step-2", step: "核对官方价格页面", status: "pending" },
    ];
    const stream: OraRunEventStream = {
      runId: "run-plan-list-delta",
      fromSeq: 1,
      nextSeq: 2,
      status: "running",
      events: [{
        id: "run-plan-list-delta:event:1",
        runId: "run-plan-list-delta",
        seq: 1,
        type: "plan_list.updated",
        createdAt: 1_714_000_000_001,
        payload: { plan },
      } as unknown as OraRunEventStream["events"][number]],
    };

    const merged = mergeRunStreamSnapshot(snapshot, stream);

    expect(merged?.events.map((event) => event.seq)).toEqual([0, 1]);
    expect(merged?.planList).toEqual(plan);
    expect(merged?.status).toBe("running");
  });

  it("ignores malformed no-snapshot plan list payloads", () => {
    const snapshot = testSnapshot({
      runId: "run-bad-plan-list-delta",
    });
    const stream: OraRunEventStream = {
      runId: "run-bad-plan-list-delta",
      fromSeq: 1,
      nextSeq: 2,
      status: "running",
      events: [{
        id: "run-bad-plan-list-delta:event:1",
        runId: "run-bad-plan-list-delta",
        seq: 1,
        type: "plan_list.updated",
        createdAt: 1_714_000_000_001,
        payload: { plan: [{ step: "缺少合法状态", status: "working" }] },
      } as unknown as OraRunEventStream["events"][number]],
    };

    const merged = mergeRunStreamSnapshot(snapshot, stream);

    expect(merged?.planList).toEqual([]);
    expect(merged?.events.map((event) => event.seq)).toEqual([1]);
  });

  it("does not append no-snapshot deltas when no matching snapshot exists", () => {
    const stream: OraRunEventStream = {
      runId: "run-no-snapshot",
      fromSeq: 1,
      nextSeq: 2,
      status: "running",
      events: [{
        id: "run-no-snapshot:event:1",
        runId: "run-no-snapshot",
        seq: 1,
        type: "message.delta",
        createdAt: 1_714_000_000_001,
        payload: { role: "assistant", content: "Hi!", delta: "Hi!", streaming: true },
      } as unknown as OraRunEventStream["events"][number]],
    };

    const merged = mergeRunStreamSnapshot(undefined, stream);

    expect(merged).toBeUndefined();
  });

  it("recovers debate transcript messages from snapshot agent.message events", () => {
    const messages = [
      debateTranscriptMessage({
        id: "run-debate:agent-message:0",
        sequence: 0,
        stance: "affirmative",
        speakerLabel: "正方主辩",
        content: "Opening argument.",
      }),
      debateTranscriptMessage({
        id: "run-debate:agent-message:1",
        sequence: 1,
        stance: "negative",
        speakerLabel: "反方主辩",
        content: "Opening response.",
      }),
    ];
    const incoming = testSnapshot({
      agentMessages: [],
      events: messages.map(agentMessageEvent),
    });

    const merged = mergeStateSnapshot(undefined, incoming);

    expect(merged?.agentMessages.map((message) => message.transcript?.speakerLabel)).toEqual(["正方主辩", "反方主辩"]);
  });

  it("merges existing debate messages with later messages recovered from events", () => {
    const existingMessages = [0, 1].map((sequence) => debateTranscriptMessage({
      id: `run-debate:agent-message:${sequence}`,
      sequence,
      stance: sequence === 0 ? "affirmative" : "negative",
      speakerLabel: sequence === 0 ? "正方主辩" : "反方主辩",
      content: `Existing stage ${sequence}`,
    }));
    const incomingMessages = [2, 3, 4].map((sequence) => debateTranscriptMessage({
      id: `run-debate:agent-message:${sequence}`,
      sequence,
      stance: sequence % 2 === 0 ? "affirmative" : "negative",
      speakerLabel: sequence % 2 === 0 ? "正方副辩" : "反方副辩",
      content: `Incoming stage ${sequence}`,
    }));
    const existing = testSnapshot({ agentMessages: existingMessages, updatedAt: 1_714_000_000_001 });
    const incoming = testSnapshot({ agentMessages: [], events: incomingMessages.map(agentMessageEvent), updatedAt: 1_714_000_000_002 });

    const merged = mergeStateSnapshot(existing, incoming);

    expect(merged?.agentMessages.map((message) => message.transcript?.sequence)).toEqual([0, 1, 2, 3, 4]);
  });

  it("hydrates active snapshots with agent messages recovered from events", () => {
    const message = debateTranscriptMessage({
      id: "run-debate:agent-message:0",
      sequence: 0,
      stance: "affirmative",
      speakerLabel: "正方主辩",
      content: "Opening argument.",
    });
    const snapshot = testSnapshot({ agentMessages: [], events: [agentMessageEvent(message, 0)] });

    const state = workbenchReducer(initialWorkbenchState, {
      type: "HYDRATE_SESSION",
      projects: [],
      sessions: [sessionSummary("session-debate")],
      detail: {
        session: sessionSummary("session-debate"),
        turns: [{ runId: "run-debate" } as unknown as NonNullable<WorkbenchState["activeSessionDetail"]>["turns"][number]],
        transcript: [],
        latestSnapshot: snapshot,
      },
    });

    expect(getActiveSnapshot(state.runLifecycle)?.agentMessages).toHaveLength(1);
    expect(getActiveSnapshot(state.runLifecycle)?.agentMessages[0]?.transcript?.speakerLabel).toBe("正方主辩");
    expect(getActiveSnapshot(state.runLifecycle)?.agentMessages[0]?.transcript?.speakerLabel).toBe("正方主辩");
  });

  it("hydrates resume results over stale interrupted session summaries", () => {
    const sessionId = "session-resume-closure";
    const snapshot = testSnapshot({
      runId: "run-resume-closure",
      sessionId,
      status: "succeeded",
      attention: {
        kind: "idle",
        blocking: false,
        sourceRunId: "run-resume-closure",
        pendingActionIds: [],
        pendingToolCallIds: [],
        pendingClarificationIds: [],
      },
    });
    const staleSession: OraSessionSummary = {
      ...sessionSummary(sessionId),
      status: "interrupted",
      latestRunId: snapshot.runId,
      attention: {
        kind: "paused",
        blocking: false,
        sourceRunId: snapshot.runId,
        reason: "manual_interrupt",
        pendingActionIds: [],
        pendingToolCallIds: [],
        pendingClarificationIds: [],
      },
      turnCount: 1,
    };

    const next = workbenchReducer({
      ...initialWorkbenchState,
      selectedSessionId: sessionId,
      selectedTurnRunId: snapshot.runId,
      sessions: [staleSession],
      runLifecycle: lifecycleFromPendingRun({ sessionId, prompt: "staging", createdAt: 1_714_000_000_001 }),
    }, {
      type: "HYDRATE_SESSION",
      projects: [],
      sessions: [staleSession],
      detail: {
        session: staleSession,
        turns: [{ runId: snapshot.runId } as NonNullable<WorkbenchState["activeSessionDetail"]>["turns"][number]],
        transcript: [],
        latestSnapshot: snapshot,
      },
      snapshot,
    });

    expect(getPendingRunState(next.runLifecycle)).toBeUndefined();
    expect(next.activeSessionDetail?.session.status).toBe("succeeded");
    expect(next.sessions[0]?.status).toBe("succeeded");
    expect(next.activeSessionDetail?.session.attention).toEqual(snapshot.attention);
    expect(next.sessions[0]?.attention).toEqual(snapshot.attention);
    expect(getActiveSnapshot(next.runLifecycle)?.pendingClarifications).toEqual([]);
    expect(next.runLifecycle.stage).toBe("settled");
    expect(getActiveSnapshot(next.runLifecycle)?.pendingClarifications).toEqual([]);
  });

  it("normalizes stale running attention away from a terminal hydrated snapshot", () => {
    const sessionId = "session-terminal-hydrate";
    const snapshot = testSnapshot({
      runId: "run-terminal-hydrate",
      sessionId,
      status: "succeeded",
      attention: {
        kind: "running",
        blocking: false,
        sourceRunId: "run-terminal-hydrate",
        pendingActionIds: [],
        pendingToolCallIds: [],
        pendingClarificationIds: [],
      },
    });
    const session: OraSessionSummary = {
      ...sessionSummary(sessionId),
      latestRunId: snapshot.runId,
      status: "running",
      attention: {
        kind: "running",
        blocking: false,
        sourceRunId: snapshot.runId,
        pendingActionIds: [],
        pendingToolCallIds: [],
        pendingClarificationIds: [],
      },
      turnCount: 1,
    };

    const next = workbenchReducer(initialWorkbenchState, {
      type: "HYDRATE_SESSION",
      projects: [],
      sessions: [session],
      detail: {
        session,
        turns: [{ runId: snapshot.runId } as NonNullable<WorkbenchState["activeSessionDetail"]>["turns"][number]],
        transcript: [],
        latestSnapshot: snapshot,
      },
      snapshot,
    });

    expect(next.activeSessionDetail?.session.status).toBe("succeeded");
    expect(next.activeSessionDetail?.session.attention?.kind).toBe("idle");
    expect(next.sessions[0]?.status).toBe("succeeded");
    expect(next.sessions[0]?.attention?.kind).toBe("idle");
    expect(getActiveSnapshot(next.runLifecycle)?.attention?.kind).toBe("idle");
    expect(next.runLifecycle.stage).toBe("settled");
    expect(getActiveSnapshot(next.runLifecycle)?.attention?.kind).toBe("idle");
  });

  describe("running session plan list preservation on hydrate", () => {
    function planStep(step: string, status: "pending" | "in_progress" | "completed", id?: string) {
      return { step, status, ...(id ? { id } : {}) };
    }

    it("preserves running planList when hydrate has no snapshot for the same session", () => {
      const sessionId = "session-plan-hydrate";
      const runId = "run-plan-hydrate";
      const planList = [
        planStep("Research approach", "completed", "step-1"),
        planStep("Implement solution", "in_progress", "step-2"),
        planStep("Write tests", "pending", "step-3"),
      ];
      const runningSnapshot: OraStateSnapshot = {
        ...testSnapshot({ runId, sessionId, status: "running", updatedAt: 1_714_000_000_100 }),
        planList,
      };
      const session: OraSessionSummary = {
        ...sessionSummary(sessionId),
        latestRunId: runId,
        status: "running" as const,
        turnCount: 1,
        updatedAt: runningSnapshot.updatedAt,
      };

      const state: WorkbenchState = {
        ...initialWorkbenchState,
        selectedSessionId: sessionId,
        selectedTurnRunId: runId,
        sessions: [session],
        runLifecycle: lifecycleFromSnapshot(runningSnapshot),
        activeSessionDetail: {
          session,
          turns: [{ runId, sessionId, turnIndex: 1, status: "running", pattern: "orchestrator_subagent", modeId: "debate", providerId: "local-smoke", modelRef: "local/smoke-model", prompt: "Plan this.", startedAt: 1_714_000_000_000, updatedAt: runningSnapshot.updatedAt, eventCount: 0, checkpointCount: 0, artifactCount: 0 }],
          transcript: [],
          latestSnapshot: runningSnapshot,
        },
      };

      // Hydrate without snapshot — simulate includeLatestSnapshot: false
      const next = workbenchReducer(state, {
        type: "HYDRATE_SESSION",
        projects: [],
        sessions: [session],
        detail: {
          session,
          turns: [{ runId, sessionId, turnIndex: 1, status: "running", pattern: "orchestrator_subagent", modeId: "debate", providerId: "local-smoke", modelRef: "local/smoke-model", prompt: "Plan this.", startedAt: 1_714_000_000_000, updatedAt: runningSnapshot.updatedAt, eventCount: 0, checkpointCount: 0, artifactCount: 0 }],
          transcript: [],
        },
      });

      expect(next.selectedSessionId).toBe(sessionId);
      expect(getActiveSnapshot(next.runLifecycle)?.planList).toEqual(planList);
      expect(getActiveSnapshot(next.runLifecycle)?.runId).toBe(runId);
      expect(next.runLifecycle.stage).toBe("streaming");
    });

    it("preserves planList after switching away and back to a running session", () => {
      const planList = [
        planStep("Research approach", "completed", "step-1"),
        planStep("Implement solution", "in_progress", "step-2"),
      ];
      const runningSnapshot: OraStateSnapshot = {
        ...testSnapshot({ runId: "run-a", sessionId: "session-a", status: "running", updatedAt: 1_714_000_000_100 }),
        planList,
      };
      const sessionA: OraSessionSummary = {
        ...sessionSummary("session-a"),
        latestRunId: "run-a",
        status: "running" as const,
        turnCount: 1,
        updatedAt: runningSnapshot.updatedAt,
      };
      const sessionB = sessionSummary("session-b");

      // Start with session A running, cached in sessionDetailsById
      let state: WorkbenchState = {
        ...initialWorkbenchState,
        sessions: [sessionA, sessionB],
        sessionDetailsById: {
          "session-a": {
            session: sessionA,
            turns: [{ runId: "run-a", sessionId: "session-a", turnIndex: 1, status: "running", pattern: "orchestrator_subagent", modeId: "debate", providerId: "local-smoke", modelRef: "local/smoke-model", prompt: "Plan this.", startedAt: 1_714_000_000_000, updatedAt: runningSnapshot.updatedAt, eventCount: 0, checkpointCount: 0, artifactCount: 0 }],
            transcript: [],
            latestSnapshot: runningSnapshot,
          },
        },
        selectedSessionId: "session-a",
        selectedTurnRunId: "run-a",
        activeSessionDetail: {
          session: sessionA,
          turns: [{ runId: "run-a", sessionId: "session-a", turnIndex: 1, status: "running", pattern: "orchestrator_subagent", modeId: "debate", providerId: "local-smoke", modelRef: "local/smoke-model", prompt: "Plan this.", startedAt: 1_714_000_000_000, updatedAt: runningSnapshot.updatedAt, eventCount: 0, checkpointCount: 0, artifactCount: 0 }],
          transcript: [],
          latestSnapshot: runningSnapshot,
        },
        runLifecycle: lifecycleFromSnapshot(runningSnapshot),
      };

      // Switch to session B
      state = workbenchReducer(state, { type: "SELECT_SESSION", sessionId: "session-b" });

      // Switch back to session A — SELECT_SESSION restores from cache
      state = workbenchReducer(state, { type: "SELECT_SESSION", sessionId: "session-a" });
      expect(getActiveSnapshot(state.runLifecycle)?.planList).toEqual(planList);

      // Now HYDRATE_SESSION without snapshot (simulating includeLatestSnapshot: false response)
      state = workbenchReducer(state, {
        type: "HYDRATE_SESSION",
        projects: [],
        sessions: [sessionA, sessionB],
        detail: {
          session: sessionA,
          turns: [{ runId: "run-a", sessionId: "session-a", turnIndex: 1, status: "running", pattern: "orchestrator_subagent", modeId: "debate", providerId: "local-smoke", modelRef: "local/smoke-model", prompt: "Plan this.", startedAt: 1_714_000_000_000, updatedAt: runningSnapshot.updatedAt, eventCount: 0, checkpointCount: 0, artifactCount: 0 }],
          transcript: [],
        },
      });

      expect(getActiveSnapshot(state.runLifecycle)?.planList).toEqual(planList);
      expect(state.runLifecycle.stage).toBe("streaming");
      expect(state.selectedSessionId).toBe("session-a");
    });

    it("replaces running planList with terminal snapshot on hydrate", () => {
      const sessionId = "session-terminal-plan";
      const runId = "run-terminal-plan";
      const oldPlanList = [
        planStep("Old step", "in_progress", "old-step"),
      ];
      const runningSnapshot: OraStateSnapshot = {
        ...testSnapshot({ runId, sessionId, status: "running", updatedAt: 1_714_000_000_000 }),
        planList: oldPlanList,
      };
      const terminalSnapshot: OraStateSnapshot = {
        ...testSnapshot({ runId, sessionId, status: "succeeded", updatedAt: 1_714_000_000_100 }),
        planList: [
          planStep("Old step", "completed", "old-step"),
        ],
      };
      const session: OraSessionSummary = {
        ...sessionSummary(sessionId),
        latestRunId: runId,
        status: "succeeded" as const,
        turnCount: 1,
        updatedAt: terminalSnapshot.updatedAt,
      };

      const state: WorkbenchState = {
        ...initialWorkbenchState,
        selectedSessionId: sessionId,
        selectedTurnRunId: runId,
        sessions: [session],
        runLifecycle: lifecycleFromSnapshot(runningSnapshot),
        activeSessionDetail: {
          session,
          turns: [{ runId, sessionId, turnIndex: 1, status: "running", pattern: "orchestrator_subagent", modeId: "debate", providerId: "local-smoke", modelRef: "local/smoke-model", prompt: "Plan this.", startedAt: 1_714_000_000_000, updatedAt: terminalSnapshot.updatedAt, eventCount: 0, checkpointCount: 0, artifactCount: 0 }],
          transcript: [],
          latestSnapshot: runningSnapshot,
        },
      };

      // Hydrate with terminal snapshot
      const next = workbenchReducer(state, {
        type: "HYDRATE_SESSION",
        projects: [],
        sessions: [session],
        detail: {
          session,
          turns: [{ runId, sessionId, turnIndex: 1, status: "succeeded", pattern: "orchestrator_subagent", modeId: "debate", providerId: "local-smoke", modelRef: "local/smoke-model", prompt: "Plan this.", startedAt: 1_714_000_000_000, updatedAt: terminalSnapshot.updatedAt, eventCount: 0, checkpointCount: 0, artifactCount: 0 }],
          transcript: [],
          latestSnapshot: terminalSnapshot,
        },
        snapshot: terminalSnapshot,
      });

      expect(getActiveSnapshot(next.runLifecycle)?.planList).toEqual(terminalSnapshot.planList);
      expect(next.runLifecycle.stage).toBe("settled");
    });

    it("does not carry planList from one session to another on hydrate", () => {
      const sessionIdA = "session-a-plan";
      const sessionIdB = "session-b-plan";
      const planListA = [
        planStep("Session A step", "in_progress", "step-a"),
      ];
      const runningSnapshotA: OraStateSnapshot = {
        ...testSnapshot({ runId: "run-a", sessionId: sessionIdA, status: "running", updatedAt: 1_714_000_000_000 }),
        planList: planListA,
      };
      const sessionA: OraSessionSummary = {
        ...sessionSummary(sessionIdA),
        latestRunId: "run-a",
        status: "running" as const,
        turnCount: 1,
      };
      const sessionB: OraSessionSummary = {
        ...sessionSummary(sessionIdB),
        turnCount: 0,
      };

      const sessionADetail = {
        session: sessionA,
        turns: [{ runId: "run-a", sessionId: sessionIdA, turnIndex: 1, status: "running" as const, pattern: "orchestrator_subagent", modeId: "debate", providerId: "local-smoke", modelRef: "local/smoke-model", prompt: "Plan this.", startedAt: 1_714_000_000_000, updatedAt: runningSnapshotA.updatedAt, eventCount: 0, checkpointCount: 0, artifactCount: 0 }],
        transcript: [],
        latestSnapshot: runningSnapshotA,
      };
      const state: WorkbenchState = {
        ...initialWorkbenchState,
        selectedSessionId: sessionIdA,
        selectedTurnRunId: "run-a",
        sessions: [sessionA, sessionB],
        runLifecycle: lifecycleFromSnapshot(runningSnapshotA),
        activeSessionDetail: sessionADetail,
        sessionDetailsById: { [sessionIdA]: sessionADetail },
      };

      // Hydrate session B without snapshot
      const next = workbenchReducer(state, {
        type: "HYDRATE_SESSION",
        projects: [],
        sessions: [sessionA, sessionB],
        detail: {
          session: sessionB,
          turns: [],
          transcript: [],
        },
      });

      expect(next.selectedSessionId).toBe(sessionIdB);
      // Session B has no running snapshot, so runLifecycle should be idle
      expect(next.runLifecycle.stage).toBe("idle");
      expect(getActiveSnapshot(next.runLifecycle)).toBeUndefined();
      // Session A's running snapshot should still be in the runLifecycle of its own session state
      // (not carried over to session B)
      const cachedA = next.sessionDetailsById[sessionIdA];
      expect(cachedA).toBeDefined();
      expect(cachedA?.latestSnapshot?.planList).toEqual(planListA);
    });

    it("preserves existing planList when incoming snapshot has empty planList", () => {
      const existing = testSnapshot({
        planList: [
          { step: "Research", status: "completed", id: "step-1" },
          { step: "Implement", status: "in_progress", id: "step-2" },
        ],
        updatedAt: 1_714_000_000_001,
      });
      const incoming = testSnapshot({
        planList: [],
        updatedAt: 1_714_000_000_002,
      });

      const merged = mergeStateSnapshot(existing, incoming);

      expect(merged?.planList).toEqual([
        { step: "Research", status: "completed", id: "step-1" },
        { step: "Implement", status: "in_progress", id: "step-2" },
      ]);
    });

    it("uses incoming planList when both snapshots have plan data", () => {
      const existing = testSnapshot({
        planList: [
          { step: "Old step", status: "completed", id: "old-1" },
        ],
        updatedAt: 1_714_000_000_001,
      });
      const incoming = testSnapshot({
        planList: [
          { step: "New step", status: "in_progress", id: "new-1" },
        ],
        updatedAt: 1_714_000_000_002,
      });

      const merged = mergeStateSnapshot(existing, incoming);

      expect(merged?.planList).toEqual([
        { step: "New step", status: "in_progress", id: "new-1" },
      ]);
    });
  });

  it("optimistically marks a running turn cancelled before the runtime responds", () => {
    const snapshot = testSnapshot({
      runId: "run-cancel",
      sessionId: "session-cancel",
      status: "running",
      updatedAt: 1_714_000_000_000,
    });
    const session = {
      ...sessionSummary("session-cancel"),
      latestRunId: snapshot.runId,
      status: "running" as const,
      updatedAt: snapshot.updatedAt,
    };

    const next = workbenchReducer({
      ...initialWorkbenchState,
      selectedSessionId: session.sessionId,
      selectedTurnRunId: snapshot.runId,
      sessions: [session],
      runLifecycle: lifecycleFromSnapshot(snapshot),
      activeSessionDetail: {
        session,
        turns: [{
          runId: snapshot.runId,
          status: "running",
          updatedAt: snapshot.updatedAt,
        } as NonNullable<WorkbenchState["activeSessionDetail"]>["turns"][number]],
        transcript: [],
        latestSnapshot: snapshot,
      },
      isLoading: true,
      busyCommand: "Cancel",
    }, {
      type: "REQUEST_RUN_CANCEL",
      runId: snapshot.runId,
      reason: "Stopped processing as instructed.",
      updatedAt: 1_714_000_000_123,
    });

    expect(getActiveSnapshot(next.runLifecycle)?.status).toBe("cancelled");
    expect(getActiveSnapshot(next.runLifecycle)?.attention?.kind).toBe("cancelled");
    expect(next.activeSessionDetail?.session.status).toBe("cancelled");
    expect(next.activeSessionDetail?.turns[0]?.status).toBe("cancelled");
    expect(next.sessions[0]?.status).toBe("cancelled");
    expect(getPendingRunState(next.runLifecycle)).toBeUndefined();
    expect(next.runLifecycle.stage).toBe("settled");
    expect(getActiveSnapshot(next.runLifecycle)?.status).toBe("cancelled");
    expect(next.isLoading).toBe(false);
    expect(next.busyCommand).toBeUndefined();
    expect(next.commandFeedback).toBe("Stop requested.");
  });

  it("keeps runLifecycle in sync when resuming a paused active run", () => {
    const snapshot = testSnapshot({
      runId: "run-resume",
      sessionId: "session-resume",
      status: "interrupted",
      pendingApprovals: ["approval-1"],
      attention: {
        kind: "needs_approval",
        blocking: true,
        sourceRunId: "run-resume",
        pendingActionIds: ["approval-1"],
        pendingToolCallIds: [],
        pendingClarificationIds: [],
      },
    });

    const next = workbenchReducer({
      ...initialWorkbenchState,
      selectedSessionId: "session-resume",
      selectedTurnRunId: snapshot.runId,
      runLifecycle: lifecycleFromSnapshot(snapshot),
    }, {
      type: "BEGIN_RUN_RESUME",
      runId: snapshot.runId,
      approvedActionIds: ["approval-1"],
      updatedAt: snapshot.updatedAt + 10,
    });

    expect(getActiveSnapshot(next.runLifecycle)?.status).toBe("running");
    expect(next.runLifecycle.stage).toBe("streaming");
    expect(getActiveSnapshot(next.runLifecycle)?.status).toBe("running");
    expect(getActiveSnapshot(next.runLifecycle)?.pendingApprovals).toEqual([]);
  });

  it("does not merge same-run snapshots from different sessions", () => {
    const existing = testSnapshot({
      runId: "run-shared-id",
      sessionId: "session-a",
      agentMessages: [debateTranscriptMessage({
        id: "run-debate:agent-message:0",
        sequence: 0,
        stance: "affirmative",
        speakerLabel: "正方主辩",
        content: "Session A argument.",
      })],
    });
    const incoming = testSnapshot({
      runId: "run-shared-id",
      sessionId: "session-b",
      agentMessages: [],
      updatedAt: 1_714_000_000_002,
    });

    const merged = mergeStateSnapshot(existing, incoming);

    expect(merged?.sessionId).toBe("session-b");
    expect(merged?.agentMessages).toHaveLength(0);
  });

  it("merges stream snapshots without dropping previous debate transcript stages", () => {
    const opening = debateTranscriptMessage({
      id: "run-debate:agent-message:0",
      sequence: 0,
      stance: "affirmative",
      speakerLabel: "正方主辩",
      content: "Opening argument.",
    });
    const response = debateTranscriptMessage({
      id: "run-debate:agent-message:1",
      sequence: 1,
      stance: "negative",
      speakerLabel: "反方主辩",
      content: "Opening response.",
    });
    const snapshot = testSnapshot({ agentMessages: [opening] });
    const stream = {
      runId: "run-debate",
      status: "running",
      fromSeq: 1,
      nextSeq: 2,
      events: [],
      snapshot: testSnapshot({ agentMessages: [response], updatedAt: 1_714_000_000_002 }),
    } as unknown as OraRunEventStream;

    const merged = mergeRunStreamSnapshot(snapshot, stream);

    expect(merged?.agentMessages.map((message) => message.transcript?.sequence)).toEqual([0, 1]);
  });

  it("does not replace the active snapshot when a same-run stream reports another session", () => {
    const activeSnapshot = testSnapshot({ runId: "run-active", sessionId: "session-active" });
    const state: WorkbenchState = {
      ...initialWorkbenchState,
      selectedSessionId: "session-active",
      selectedTurnRunId: "run-active",
      runLifecycle: lifecycleFromSnapshot(activeSnapshot),
      activeSessionDetail: {
        session: sessionSummary("session-active"),
        turns: [{ runId: "run-active" } as unknown as NonNullable<WorkbenchState["activeSessionDetail"]>["turns"][number]],
        transcript: [],
        latestSnapshot: activeSnapshot,
      },
    };
    const stream = {
      runId: "run-active",
      status: "running",
      fromSeq: 0,
      nextSeq: 0,
      events: [],
      snapshot: testSnapshot({ runId: "run-active", sessionId: "session-other", updatedAt: 1_714_000_000_002 }),
    } as unknown as OraRunEventStream;

    const nextState = workbenchReducer(state, { type: "APPLY_RUN_STREAM", stream });

    expect(getActiveSnapshot(nextState.runLifecycle)?.sessionId).toBe("session-active");
    expect(nextState.selectedTurnRunId).toBe("run-active");
  });

  it("does not replace the active snapshot with an unrelated stream snapshot", () => {
    const activeSnapshot = testSnapshot({
      runId: "run-active",
      sessionId: "session-active",
      agentMessages: [debateTranscriptMessage({
        id: "run-debate:agent-message:0",
        sequence: 0,
        stance: "affirmative",
        speakerLabel: "正方主辩",
        content: "Opening argument.",
      })],
    });
    const state: WorkbenchState = {
      ...initialWorkbenchState,
      selectedSessionId: "session-active",
      selectedTurnRunId: "run-active",
      runLifecycle: lifecycleFromSnapshot(activeSnapshot),
      activeSessionDetail: {
        session: sessionSummary("session-active"),
        turns: [{ runId: "run-active" } as unknown as NonNullable<WorkbenchState["activeSessionDetail"]>["turns"][number]],
        transcript: [],
        latestSnapshot: activeSnapshot,
      },
    };
    const stream = {
      runId: "run-background",
      status: "running",
      fromSeq: 0,
      nextSeq: 0,
      events: [],
      snapshot: testSnapshot({ runId: "run-background", sessionId: "session-background" }),
    } as unknown as OraRunEventStream;

    const nextState = workbenchReducer(state, { type: "APPLY_RUN_STREAM", stream });

    expect(getActiveSnapshot(nextState.runLifecycle)?.runId).toBe("run-active");
    expect(nextState.selectedTurnRunId).toBe("run-active");
  });

  it("tracks activeAgents for event-only agent lifecycle streams", () => {
    const createdAt = 1_714_000_000_000;
    const snapshot = testSnapshot({
      runId: "run-agent-lifecycle",
      sessionId: "session-agent-lifecycle",
      status: "running",
      updatedAt: createdAt,
      activeAgents: [],
    });

    const startedStream = {
      runId: "run-agent-lifecycle",
      sessionId: "session-agent-lifecycle",
      status: "running",
      fromSeq: 0,
      nextSeq: 1,
      events: [{
        id: "run-agent-lifecycle:evt-started",
        runId: "run-agent-lifecycle",
        seq: 0,
        type: "agent.started",
        createdAt: createdAt + 1,
        pattern: "orchestrator_subagent",
        agentId: "builder",
        nodeId: "builder",
        payload: { title: "Build assigned work" },
      }],
    } as unknown as OraRunEventStream;

    const afterStarted = mergeRunStreamSnapshot(snapshot, startedStream);
    expect(afterStarted?.activeAgents).toEqual(["builder"]);

    const completedStream = {
      runId: "run-agent-lifecycle",
      sessionId: "session-agent-lifecycle",
      status: "running",
      fromSeq: 1,
      nextSeq: 2,
      events: [{
        id: "run-agent-lifecycle:evt-completed",
        runId: "run-agent-lifecycle",
        seq: 1,
        type: "agent.completed",
        createdAt: createdAt + 2,
        pattern: "orchestrator_subagent",
        agentId: "builder",
        nodeId: "builder",
        payload: { title: "Build assigned work" },
      }],
    } as unknown as OraRunEventStream;

    const afterCompleted = mergeRunStreamSnapshot(afterStarted, completedStream);
    expect(afterCompleted?.activeAgents).toEqual([]);
  });

  it("merges streamed agent messages into the active snapshot", () => {
    const createdAt = 1_714_000_000_000;
    const snapshot = {
      runId: "run-team",
      sessionId: "session-team",
      turnIndex: 1,
      status: "running",
      pattern: "agent_teams",
      modeId: "agent_teams",
      input: { prompt: "Coordinate work.", createdAt, context: {} },
      config: {
        modeId: "agent_teams",
        pattern: "agent_teams",
        modeSelection: "manual",
        profileIds: ["team_lead", "builder"],
        providerId: "local-smoke",
        modelRef: "local/smoke-model",
        approvalMode: "high_risk_only",
        patternOptions: {},
        metadata: {},
        deterministicSeed: "state-agent-message-test",
        skillIds: [],
        toolIds: [],
      },
      topology: { nodes: [], edges: [] },
      profiles: [],
      memory: [],
      plan: [],
      todos: [],
      actions: [],
      toolCalls: [],
      policyDecisions: [],
      checkpoints: [],
      events: [],
      agentMessages: [],
      artifacts: [],
      activeAgents: [],
      queueSummary: { mode: "backlog", pending: 0, inProgress: 1, completed: 0, topics: [] },
      sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
      busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
      pendingClarifications: [],
      pendingApprovals: [],
      updatedAt: createdAt,
    } as unknown as OraStateSnapshot;
    const stream = {
      runId: "run-team",
      status: "running",
      fromSeq: 1,
      nextSeq: 2,
      events: [{
        id: "run-team:event:1",
        runId: "run-team",
        seq: 1,
        type: "agent.message",
        createdAt: createdAt + 1,
        payload: {
          message: {
            id: "run-team:agent-message:0",
            runId: "run-team",
            createdAt: createdAt + 1,
            fromAgentId: "team_lead",
            toAgentIds: ["builder"],
            threadId: "agent-teams:build",
            kind: "mention",
            status: "done",
            content: "@builder build this.",
            artifactIds: [],
            transcript: {
              kind: "stage_transcript",
              groupId: "debate",
              groupLabel: "结构化辩论",
              stageId: "affirmative-lead-opening",
              stageLabel: "开篇立论",
              sequence: 0,
              speakerLabel: "正方主辩",
              stance: "affirmative",
              status: "done",
            },
          },
        },
      }],
    } as unknown as OraRunEventStream;

    const merged = mergeRunStreamSnapshot(snapshot, stream);

    expect(merged?.agentMessages).toHaveLength(1);
    expect(merged?.agentMessages[0]?.fromAgentId).toBe("team_lead");
    expect(merged?.agentMessages[0]?.toAgentIds).toEqual(["builder"]);
    expect(merged?.agentMessages[0]?.transcript?.speakerLabel).toBe("正方主辩");
    expect(merged?.agentMessages[0]?.transcript?.sequence).toBe(0);
  });

  describe("plan mode decision detection", () => {
    const PROPOSED_PLAN = [
      "<proposed_plan>",
      "计划标题",
      "## 背景",
      "这是一个测试计划。",
      "## 实施步骤",
      "1. 步骤一 - 涉及文件: src/a.ts",
      "2. 步骤二 - 涉及文件: src/b.ts",
      "## 验证方式",
      "- 运行测试",
      "</proposed_plan>",
    ].join("\n");

    function planModeEvent(seq: number, content: string, agentId?: string) {
      return {
        id: `run-plan:event:${seq}`,
        runId: "run-plan",
        seq,
        type: "message.delta",
        createdAt: 1_714_000_000_000 + seq,
        agentId,
        payload: { role: "assistant", content, delta: content, streaming: true },
      } as unknown as OraStateSnapshot["events"][number];
    }

    it("does not create local shadow plan decision state when a settled stream carries a plan decision", () => {
      const sessionId = "session-plan";
      const snapshot = testSnapshot({
        runId: "run-plan",
        sessionId,
        events: [planModeEvent(0, PROPOSED_PLAN)],
        planDecisions: [{
          id: "run-plan:plan-decision",
          runId: "run-plan",
          sessionId,
          status: "pending",
          createdAt: 1_714_000_000_000,
        }],
        attention: {
          kind: "needs_plan_decision",
          blocking: true,
          sourceRunId: "run-plan",
          reason: "plan_decision_required",
          planDecisionId: "run-plan:plan-decision",
          pendingActionIds: [],
          pendingToolCallIds: [],
          pendingClarificationIds: [],
        },
      });
      const state: WorkbenchState = {
        ...initialWorkbenchState,
        taskIntent: "plan",
        sessionTaskIntents: { [sessionId]: "plan" },
        selectedSessionId: sessionId,
        selectedTurnRunId: snapshot.runId,
        runLifecycle: lifecycleFromSnapshot(snapshot),
        activeSessionDetail: {
          session: { ...sessionSummary(sessionId), latestRunId: snapshot.runId },
          turns: [{
            runId: snapshot.runId,
            sessionId,
            turnIndex: 1,
            status: "running",
            pattern: snapshot.pattern,
            prompt: snapshot.input.prompt,
            startedAt: snapshot.updatedAt,
            updatedAt: snapshot.updatedAt,
            eventCount: 1,
            checkpointCount: 0,
            artifactCount: 0,
          }],
          transcript: [],
          latestSnapshot: snapshot,
        },
      };

      const settledStream = {
        runId: "run-plan",
        fromSeq: 1,
        nextSeq: 1,
        status: "succeeded",
        events: [],
        snapshot,
      } as unknown as OraRunEventStream;

      const next = workbenchReducer(state, { type: "APPLY_RUN_STREAM", stream: settledStream, receivedAt: 200 });
      expect("sessionPendingPlanDecision" in next).toBe(false);
    });

    it("does not create durable plan decision attention for an unfinished streaming proposed plan", () => {
      const sessionId = "session-streaming-plan";
      const streamingPlan = [
        "<proposed_plan>",
        "计划标题",
        "## 实施步骤",
        "1. 先显示任务计划卡片",
      ].join("\n");
      const snapshot = testSnapshot({
        runId: "run-streaming-plan",
        sessionId,
        events: [planModeEvent(0, streamingPlan)],
      });
      const state: WorkbenchState = {
        ...initialWorkbenchState,
        taskIntent: "plan",
        sessionTaskIntents: { [sessionId]: "plan" },
        selectedSessionId: sessionId,
        selectedTurnRunId: snapshot.runId,
        runLifecycle: lifecycleFromSnapshot(snapshot),
        activeSessionDetail: {
          session: sessionSummary(sessionId),
          turns: [{
            runId: snapshot.runId,
            sessionId,
            turnIndex: 1,
            status: "running",
            pattern: snapshot.pattern,
            prompt: snapshot.input.prompt,
            startedAt: snapshot.updatedAt,
            updatedAt: snapshot.updatedAt,
            eventCount: 1,
            checkpointCount: 0,
            artifactCount: 0,
          }],
          transcript: [],
          latestSnapshot: snapshot,
        },
      };

      const settledStream = {
        runId: "run-streaming-plan",
        fromSeq: 1,
        nextSeq: 1,
        status: "succeeded",
        events: [],
        snapshot,
      } as unknown as OraRunEventStream;

      const next = workbenchReducer(state, { type: "APPLY_RUN_STREAM", stream: settledStream, receivedAt: 200 });
      expect(next.activeSessionDetail?.session.attention?.kind).not.toBe("needs_plan_decision");
    });

    it("restores pending plan decision from durable attention during hydrate", () => {
      const sessionId = "session-attention-plan";
      const snapshot = testSnapshot({
        runId: "run-attention-plan",
        sessionId,
        planDecisions: [{
          id: "run-attention-plan:plan-decision",
          runId: "run-attention-plan",
          sessionId,
          status: "pending",
          createdAt: 1_714_000_000_000,
        }],
        attention: {
          kind: "needs_plan_decision",
          blocking: true,
          sourceRunId: "run-attention-plan",
          reason: "plan_decision_required",
          planDecisionId: "run-attention-plan:plan-decision",
          pendingActionIds: [],
          pendingToolCallIds: [],
          pendingClarificationIds: [],
        },
      });
      const session: OraSessionSummary = {
        ...sessionSummary(sessionId),
        attention: snapshot.attention,
        latestRunId: snapshot.runId,
        status: "succeeded",
        turnCount: 1,
      };

      const next = workbenchReducer(initialWorkbenchState, {
        type: "HYDRATE_SESSION",
        projects: [],
        sessions: [session],
        detail: {
          session,
          turns: [],
          transcript: [],
          latestSnapshot: snapshot,
        },
      });

      expect(next.activeSessionDetail?.session.attention?.kind).toBe("needs_plan_decision");
    });

    it("tracks accepted plan decisions as same-run busy state without creating a pending run", () => {
      const next = workbenchReducer(initialWorkbenchState, {
        type: "BEGIN_PLAN_DECISION_RESOLUTION",
        sessionId: "session-plan",
        decisionId: "run-plan:plan-decision",
        status: "accepted",
        createdAt: 1_714_000_000_100,
      });

      expect(getPendingRunState(next.runLifecycle)).toBeUndefined();
      expect(next.pendingPlanDecisionResolution).toMatchObject({
        decisionId: "run-plan:plan-decision",
        status: "accepted",
      });
      expect(next.acceptedPlanDecisionTurnProjections).toEqual({});
      expect(next.isLoading).toBe(true);
      expect(next.busyCommand).toBe("Accept plan");
      expect(next.commandFeedback).toBe("Plan accepted. Continuing run.");
    });

    it("tracks declined plan decisions as same-run busy state until resume begins", () => {
      const next = workbenchReducer(initialWorkbenchState, {
        type: "BEGIN_PLAN_DECISION_RESOLUTION",
        sessionId: "session-plan",
        decisionId: "run-plan:plan-decision",
        status: "declined",
        createdAt: 1_714_000_000_100,
      });

      expect(getPendingRunState(next.runLifecycle)).toBeUndefined();
      expect(next.pendingPlanDecisionResolution).toMatchObject({
        decisionId: "run-plan:plan-decision",
        status: "declined",
      });
      expect(next.acceptedPlanDecisionTurnProjections).toEqual({});
      expect(next.isLoading).toBe(true);
      expect(next.busyCommand).toBe("Decline plan");
      expect(next.commandFeedback).toBe("Plan decision submitted. Adjust the plan.");
    });

    it("projects an accepted plan decision into a synthetic user turn during same-run resume", () => {
      const sessionId = "session-plan";
      const runId = "run-plan";
      const state = {
        ...initialWorkbenchState,
        selectedSessionId: sessionId,
        runLifecycle: {
          stage: "settled",
          runId,
          sessionId,
          prompt: "Plan the runtime work",
          createdAt: 1_714_000_000_000,
          snapshot: testSnapshot({
            runId,
            sessionId,
            planDecisions: [{
              id: "run-plan:plan-decision",
              runId,
              sessionId,
              status: "pending",
              createdAt: 1_714_000_000_000,
            }],
          }),
        },
      } satisfies WorkbenchState;

      const next = workbenchReducer(state, {
        type: "BEGIN_RUN_RESUME",
        runId,
        approvedActionIds: [],
        resolvedClarificationIds: [],
        planDecisionId: "run-plan:plan-decision",
        planDecisionStatus: "accepted",
        updatedAt: 1_714_000_000_100,
      });

      expect(getPendingRunState(next.runLifecycle)).toBeUndefined();
      expect(Object.values(next.acceptedPlanDecisionTurnProjections)).toEqual([{
        sessionId,
        runId,
        decisionId: "run-plan:plan-decision",
        createdAt: 1_714_000_000_100,
      }]);
      expect(next.commandFeedback).toBe("Plan accepted. Continuing run.");
    });

    it("clears accepted plan decision busy state when hydration returns the resolved snapshot", () => {
      const sessionId = "session-plan";
      const snapshot = testSnapshot({
        runId: "run-plan",
        sessionId,
        planDecisions: [{
          id: "run-plan:plan-decision",
          runId: "run-plan",
          sessionId,
          status: "accepted",
          createdAt: 1_714_000_000_000,
          resolvedAt: 1_714_000_000_100,
        }],
      });
      const state = workbenchReducer(initialWorkbenchState, {
        type: "BEGIN_PLAN_DECISION_RESOLUTION",
        sessionId,
        decisionId: "run-plan:plan-decision",
        status: "accepted",
        createdAt: 1_714_000_000_100,
      });
      const session = { ...sessionSummary(sessionId), latestRunId: snapshot.runId };

      const next = workbenchReducer(state, {
        type: "HYDRATE_SESSION",
        projects: [],
        sessions: [session],
        detail: {
          session,
          turns: [],
          transcript: [],
          latestSnapshot: snapshot,
        },
        feedback: "Plan accepted.",
      });

      expect(getPendingRunState(next.runLifecycle)).toBeUndefined();
      expect(next.pendingPlanDecisionResolution).toBeUndefined();
      expect(next.isLoading).toBe(false);
      expect(next.busyCommand).toBeUndefined();
      expect(next.commandFeedback).toBe("Plan accepted.");
    });

    it("rolls back failed accepted plan decisions and removes the synthetic user turn projection", () => {
      const state = {
        ...initialWorkbenchState,
        acceptedPlanDecisionTurnProjections: {
          "session-plan:run-plan:run-plan:plan-decision": {
            sessionId: "session-plan",
            runId: "run-plan",
            decisionId: "run-plan:plan-decision",
            createdAt: 1_714_000_000_100,
          },
        },
      } satisfies WorkbenchState;

      const next = workbenchReducer(state, {
        type: "ROLLBACK_PLAN_DECISION_RESOLUTION",
        sessionId: "session-plan",
        decisionId: "run-plan:plan-decision",
        feedback: "Plan decision update failed.",
      });

      expect(getPendingRunState(next.runLifecycle)).toBeUndefined();
      expect(next.pendingPlanDecisionResolution).toBeUndefined();
      expect(next.acceptedPlanDecisionTurnProjections).toEqual({});
      expect(next.isLoading).toBe(false);
      expect(next.commandFeedback).toBe("Plan decision update failed.");
    });

    it("does not synthesize clickable gate attention from raw pending fields", () => {
      const sessionId = "session-raw-pending";
      const snapshot = testSnapshot({
        runId: "run-raw-pending",
        sessionId,
        pendingApprovals: ["run-raw-pending:action-1"],
      });

      const next = mergeRunStreamSnapshot(undefined, {
        runId: snapshot.runId,
        fromSeq: 0,
        nextSeq: 0,
        status: "interrupted",
        events: [],
        snapshot,
      } as unknown as OraRunEventStream);

      expect(next?.pendingApprovals).toEqual(["run-raw-pending:action-1"]);
      expect(next?.attention?.kind).not.toBe("needs_approval");
    });

    it("does not create durable plan decision attention when taskIntent is implement", () => {
      const sessionId = "session-implement";
      const snapshot = testSnapshot({
        runId: "run-impl",
        sessionId,
        events: [planModeEvent(0, PROPOSED_PLAN)],
      });
      const state: WorkbenchState = {
        ...initialWorkbenchState,
        taskIntent: "implement",
        selectedSessionId: sessionId,
        selectedTurnRunId: snapshot.runId,
        runLifecycle: lifecycleFromSnapshot(snapshot),
        activeSessionDetail: {
          session: sessionSummary(sessionId),
          turns: [{
            runId: snapshot.runId,
            sessionId,
            turnIndex: 1,
            status: "running",
            pattern: snapshot.pattern,
            prompt: snapshot.input.prompt,
            startedAt: snapshot.updatedAt,
            updatedAt: snapshot.updatedAt,
            eventCount: 1,
            checkpointCount: 0,
            artifactCount: 0,
          }],
          transcript: [],
          latestSnapshot: snapshot,
        },
      };

      const settledStream = {
        runId: "run-impl",
        fromSeq: 1,
        nextSeq: 1,
        status: "succeeded",
        events: [],
        snapshot,
      } as unknown as OraRunEventStream;

      const next = workbenchReducer(state, { type: "APPLY_RUN_STREAM", stream: settledStream, receivedAt: 200 });
      expect(next.activeSessionDetail?.session.attention?.kind).not.toBe("needs_plan_decision");
    });

    it("does not create a plan decision from proposed plan text alone", () => {
      const sessionId = "session-plan-extra-text";
      // Single event that includes both the plan and extra text after it.
      // This simulates the case where content from all agents is concatenated.
      const combinedContent = PROPOSED_PLAN + "\n验证完成，方案可行。";
      const snapshot = testSnapshot({
        runId: "run-plan-extra-text",
        sessionId,
        events: [
          planModeEvent(0, combinedContent),
        ],
      });
      const state: WorkbenchState = {
        ...initialWorkbenchState,
        taskIntent: "plan",
        sessionTaskIntents: { [sessionId]: "plan" },
        selectedSessionId: sessionId,
        selectedTurnRunId: snapshot.runId,
        runLifecycle: lifecycleFromSnapshot(snapshot),
        activeSessionDetail: {
          session: sessionSummary(sessionId),
          turns: [{
            runId: snapshot.runId,
            sessionId,
            turnIndex: 1,
            status: "running",
            pattern: snapshot.pattern,
            prompt: snapshot.input.prompt,
            startedAt: snapshot.updatedAt,
            updatedAt: snapshot.updatedAt,
            eventCount: 1,
            checkpointCount: 0,
            artifactCount: 0,
          }],
          transcript: [],
          latestSnapshot: snapshot,
        },
      };

      const settledStream = {
        runId: "run-plan-extra-text",
        fromSeq: 1,
        nextSeq: 1,
        status: "succeeded",
        events: [],
        snapshot,
      } as unknown as OraRunEventStream;

      const next = workbenchReducer(state, { type: "APPLY_RUN_STREAM", stream: settledStream, receivedAt: 200 });
      expect(next.activeSessionDetail?.session.attention?.kind).not.toBe("needs_plan_decision");
    });
  });

  describe("BOOTSTRAP provider selection", () => {
    function mockBootstrap(params: {
      providers: OraProviderConfig[];
      defaultProviderId: string;
    }): WorkbenchAction {
      return {
        type: "BOOTSTRAP",
        patterns: [],
        modes: [],
        projects: [],
        providerRegistry: {
          providers: params.providers,
          defaultProviderId: params.defaultProviderId,
        },
        toolRegistry: { tools: [], categories: [] },
        packageStore: { packages: [] },
        skillRegistry: { skills: [] },
        providerSecretStatuses: [],
        providerStatuses: [],
        health: { mode: "desktop", ok: true, service: "OraBridge", detail: "healthy" },
      } as unknown as WorkbenchAction;
    }

    it("prefers an enabled non-local provider over the local-smoke default on bootstrap", () => {
      const externalProvider: OraProviderConfig = {
        id: "external-api",
        type: "openai_compatible",
        label: "External API",
        modelId: "external-model",
        enabled: true,
        capabilities: ["chat"],
        dropParams: [],
        headers: {},
      };
      const localSmoke: OraProviderConfig = {
        id: "local-smoke",
        type: "local_smoke",
        label: "本地模拟",
        modelId: "local/smoke-model",
        enabled: true,
        capabilities: ["chat"],
        dropParams: [],
        headers: {},
      };

      const next = workbenchReducer(
        initialWorkbenchState,
        mockBootstrap({
          providers: [externalProvider, localSmoke],
          defaultProviderId: "local-smoke",
        }),
      );

      expect(next.selectedProviderId).toBe("external-api");
    });

    it("falls back to local-smoke when no non-local provider is enabled", () => {
      const localSmoke: OraProviderConfig = {
        id: "local-smoke",
        type: "local_smoke",
        label: "本地模拟",
        modelId: "local/smoke-model",
        enabled: true,
        capabilities: ["chat"],
        dropParams: [],
        headers: {},
      };

      const next = workbenchReducer(
        initialWorkbenchState,
        mockBootstrap({
          providers: [localSmoke],
          defaultProviderId: "local-smoke",
        }),
      );

      expect(next.selectedProviderId).toBe("local-smoke");
    });

    it("falls back to local-smoke when non-local providers exist but are disabled", () => {
      const disabledExternal: OraProviderConfig = {
        id: "external-api",
        type: "openai_compatible",
        label: "External API",
        modelId: "external-model",
        enabled: false,
        capabilities: ["chat"],
        dropParams: [],
        headers: {},
      };
      const localSmoke: OraProviderConfig = {
        id: "local-smoke",
        type: "local_smoke",
        label: "本地模拟",
        modelId: "local/smoke-model",
        enabled: true,
        capabilities: ["chat"],
        dropParams: [],
        headers: {},
      };

      const next = workbenchReducer(
        initialWorkbenchState,
        mockBootstrap({
          providers: [disabledExternal, localSmoke],
          defaultProviderId: "local-smoke",
        }),
      );

      expect(next.selectedProviderId).toBe("local-smoke");
    });
  });
});

describe("deriveRenderableTurnSnapshots", () => {
  const sessionId = "session-new";
  const runId = "run-first";

  function emptyDetail(sessionIdOverride?: string): OraSessionDetail {
    return {
      session: {
        sessionId: sessionIdOverride ?? sessionId,
        title: "New Chat",
        turnCount: 0,
        createdAt: 1000,
        updatedAt: 1000,
      },
      turns: [],
      transcript: [],
      latestSnapshot: undefined,
    };
  }

  it("includes activeSnapshot even when activeSessionDetail is undefined (new session, no detail yet)", () => {
    const snapshot = testSnapshot({ runId, sessionId, status: "running" });

    const result = deriveRenderableTurnSnapshots({
      detail: undefined,
      activeSnapshot: snapshot,
      turnSnapshots: {},
      selectedSessionId: sessionId,
      preservedSettledSnapshots: {},
    });

    expect(result[runId]).toBeDefined();
    expect(result[runId]?.runId).toBe(runId);
  });

  it("returns empty when activeSnapshot sessionId does not match selectedSessionId", () => {
    const snapshot = testSnapshot({ runId, sessionId: "other-session", status: "running" });

    const result = deriveRenderableTurnSnapshots({
      detail: undefined,
      activeSnapshot: snapshot,
      turnSnapshots: {},
      selectedSessionId: sessionId,
      preservedSettledSnapshots: {},
    });

    expect(result[runId]).toBeUndefined();
  });

  it("includes activeSnapshot even when detail.turns is empty (new run, stale turns)", () => {
    const snapshot = testSnapshot({ runId, sessionId, status: "running" });

    const result = deriveRenderableTurnSnapshots({
      detail: emptyDetail(),
      activeSnapshot: snapshot,
      turnSnapshots: {},
      selectedSessionId: sessionId,
      preservedSettledSnapshots: {},
    });

    expect(result[runId]).toBeDefined();
    expect(result[runId]?.runId).toBe(runId);
  });

  it("does not include activeSnapshot when its sessionId differs from detail.session.sessionId", () => {
    const snapshot = testSnapshot({ runId, sessionId: "other-session", status: "running" });

    const result = deriveRenderableTurnSnapshots({
      detail: emptyDetail(),
      activeSnapshot: snapshot,
      turnSnapshots: {},
      selectedSessionId: sessionId,
      preservedSettledSnapshots: {},
    });

    expect(result[runId]).toBeUndefined();
  });

  it("reuses a single runId grouping when latestSnapshot contains interleaved events for multiple turns", () => {
    const latestSnapshot = testSnapshot({
      runId: "run-current",
      sessionId,
      status: "running",
      events: [
        { id: "event-1", runId: "run-older", seq: 1, createdAt: 1_000, type: "message.delta", payload: { content: "older-1" } },
        { id: "event-2", runId: "run-current", seq: 2, createdAt: 1_001, type: "message.delta", payload: { content: "current" } },
        { id: "event-3", runId: "run-older", seq: 3, createdAt: 1_002, type: "node.updated", payload: {} },
      ] as OraStateSnapshot["events"],
    });
    const detail: OraSessionDetail = {
      session: sessionSummary(sessionId),
      turns: [
        { runId: "run-older", turnIndex: 1, status: "succeeded", createdAt: 1_000, updatedAt: 1_002 },
        { runId: "run-current", turnIndex: 2, status: "running", createdAt: 1_001, updatedAt: 1_002 },
      ],
      transcript: [],
      latestSnapshot,
    };

    const result = deriveRenderableTurnSnapshots({
      detail,
      activeSnapshot: latestSnapshot,
      turnSnapshots: {},
      selectedSessionId: sessionId,
      preservedSettledSnapshots: {},
    });

    expect(result["run-current"]).toBe(latestSnapshot);
    expect(result["run-older"]).toBeDefined();
    expect(result["run-older"]?.runId).toBe("run-older");
    expect(result["run-older"]?.turnIndex).toBe(1);
    expect(result["run-older"]?.events.map((event) => event.id)).toEqual(["event-1", "event-3"]);
  });
});
