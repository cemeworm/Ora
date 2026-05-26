// @vitest-environment jsdom

import { act, createElement, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initialWorkbenchState, type WorkbenchState } from "./state";
import { USER_RESUMED_MESSAGE, type OraSessionDetail, type OraSessionSummary, type OraStateSnapshot } from "./runtimeClient";
import {
  buildClarificationSubmissionPrompt,
  buildDesktopRunContext,
  buildInitialHostFilesystemState,
  getInteractiveRunId,
  getPlanDecisionGateAuthority,
  getPlanDecisionResumeRunId,
  getSelectedInteractiveSnapshot,
  isDisposableEmptySession,
  shouldSelectFallbackAfterProjectArchive,
  shouldEnableClarificationPreflight,
  stableViewModelCacheKey,
  toolIdsForRun,
  useRunActions,
} from "./useRunActions";

const runtimeHarness = vi.hoisted(() => ({
  client: undefined as unknown as ReturnType<typeof createRuntimeClientMock> | undefined,
  state: undefined as WorkbenchState | undefined,
  dispatch: vi.fn(),
  actions: undefined as ReturnType<typeof useRunActions>["actions"] | undefined,
}));

vi.mock("./runtimeClient", async () => {
  const actual = await vi.importActual<typeof import("./runtimeClient")>("./runtimeClient");
  return {
    ...actual,
    getSharedRuntimeClient: () => {
      if (!runtimeHarness.client) {
        throw new Error("Test runtime client not configured.");
      }
      return runtimeHarness.client;
    },
  };
});

vi.mock("./state", async () => {
  const actual = await vi.importActual<typeof import("./state")>("./state");
  return {
    ...actual,
    useWorkbench: () => {
      if (!runtimeHarness.state) {
        throw new Error("Test workbench state not configured.");
      }
      return {
        state: runtimeHarness.state,
        dispatch: runtimeHarness.dispatch,
      };
    },
  };
});

type RuntimeClientMock = ReturnType<typeof createRuntimeClientMock>;

function createRuntimeClientMock() {
  const planRunSnapshot = planDecisionSnapshot();
  const acceptedSessionDetail = sessionDetail(planRunSnapshot);
  let currentSnapshot = planRunSnapshot;
  let currentSessionDetail = acceptedSessionDetail;
  let nextRunId = "run-implementation";
  return {
    resolvePlanDecision: vi.fn(async () => {
      currentSessionDetail = sessionDetail({
        ...currentSnapshot,
        planDecisions: currentSnapshot.planDecisions.map((decision) =>
          decision.id === "decision-1"
            ? { ...decision, status: "accepted" as const, resolvedAt: 1_700_000_000_100 }
            : decision,
        ),
        updatedAt: 1_700_000_000_100,
      });
      return currentSessionDetail;
    }),
    startStreamingRun: vi.fn(async (input: { prompt: string }, config: { metadata?: Record<string, unknown> }, sessionId?: string) => {
      currentSnapshot = implementationSnapshot({
        runId: nextRunId,
        sessionId: sessionId ?? planRunSnapshot.sessionId!,
        prompt: input.prompt,
        acceptedPlanMetadata: config.metadata,
      });
      currentSessionDetail = sessionDetail(currentSnapshot);
      nextRunId = "run-implementation-2";
      return {
        runId: currentSnapshot.runId,
        sessionId: currentSnapshot.sessionId,
        turnIndex: currentSnapshot.turnIndex,
        status: currentSnapshot.status,
        pattern: currentSnapshot.pattern,
        modeId: currentSnapshot.modeId,
        startedAt: currentSnapshot.input.createdAt ?? currentSnapshot.updatedAt,
      };
    }),
    acceptPlanDecisionAndResume: vi.fn(),
    getRunState: vi.fn(async () => currentSnapshot),
    listProjects: vi.fn(async () => []),
    listSessions: vi.fn(async () => [currentSessionDetail.session]),
    getSession: vi.fn(async () => currentSessionDetail),
    getHealth: vi.fn(() => undefined),
  };
}

function planDecisionSnapshot(): OraStateSnapshot {
  return {
    runId: "run-plan",
    sessionId: "session-plan",
    turnIndex: 1,
    status: "succeeded",
    pattern: "orchestrator_subagent",
    modeId: "single_agent",
    input: { prompt: "Return a proposed plan.", createdAt: 1_700_000_000_000, context: {} },
    config: {
      modeId: "single_agent",
      pattern: "orchestrator_subagent",
      modeSelection: "manual",
      profileIds: ["solo_agent"],
      skillIds: [],
      toolIds: [],
      providerId: "provider-1",
      modelRef: "provider-model",
      approvalMode: "high_risk_only",
      patternOptions: {},
      metadata: { taskIntent: "plan" },
      deterministicSeed: "plan-test",
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
    planDecisions: [{
      id: "decision-1",
      runId: "run-plan",
      sessionId: "session-plan",
      status: "pending",
      planContent: "## Runtime status plan\n1. Implement the accepted plan.\n2. Preserve session context.",
      createdAt: 1_700_000_000_050,
    }],
    events: [],
    checkpoints: [],
    artifacts: [],
    activeAgents: [],
    queueSummary: {},
    sharedStateSummary: {},
    busStats: {},
    pendingClarifications: [],
    pendingApprovals: [],
    attention: {
      kind: "needs_plan_decision",
      blocking: true,
      sourceRunId: "run-plan",
      reason: "plan_decision_required",
      planDecisionId: "decision-1",
      pendingActionIds: [],
      pendingToolCallIds: [],
      pendingClarificationIds: [],
    },
    updatedAt: 1_700_000_000_050,
  } as unknown as OraStateSnapshot;
}

function implementationSnapshot(params: {
  runId: string;
  sessionId: string;
  prompt: string;
  acceptedPlanMetadata?: Record<string, unknown>;
}): OraStateSnapshot {
  return {
    runId: params.runId,
    sessionId: params.sessionId,
    turnIndex: 2,
    status: "running",
    pattern: "generator_verifier",
    modeId: "single_agent",
    input: { prompt: params.prompt, createdAt: 1_700_000_000_200, context: {} },
    config: {
      modeId: "single_agent",
      pattern: "generator_verifier",
      modeSelection: "manual",
      profileIds: ["solo_agent"],
      skillIds: [],
      toolIds: [],
      providerId: "provider-1",
      modelRef: "provider-model",
      approvalMode: "high_risk_only",
      patternOptions: {},
      metadata: {
        taskIntent: "implement",
        ...(params.acceptedPlanMetadata ?? {}),
      },
      deterministicSeed: "implementation-test",
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
    planDecisions: [],
    events: [],
    checkpoints: [],
    artifacts: [],
    activeAgents: [],
    queueSummary: {},
    sharedStateSummary: {},
    busStats: {},
    pendingClarifications: [],
    pendingApprovals: [],
    attention: {
      kind: "running",
      blocking: false,
      sourceRunId: params.runId,
      pendingActionIds: [],
      pendingToolCallIds: [],
      pendingClarificationIds: [],
    },
    updatedAt: 1_700_000_000_200,
  } as unknown as OraStateSnapshot;
}

function sessionDetail(snapshot: OraStateSnapshot): OraSessionDetail {
  return {
    session: {
      sessionId: snapshot.sessionId!,
      title: "Plan session",
      status: snapshot.status,
      latestRunId: snapshot.runId,
      latestPattern: snapshot.pattern,
      latestModeId: snapshot.modeId,
      latestProviderId: snapshot.config.providerId,
      latestModelRef: snapshot.config.modelRef,
      turnCount: 1,
      createdAt: 1_700_000_000_000,
      updatedAt: snapshot.updatedAt,
      attention: snapshot.attention,
    },
    turns: [{
      runId: snapshot.runId,
      sessionId: snapshot.sessionId!,
      turnIndex: snapshot.turnIndex,
      status: snapshot.status,
      pattern: snapshot.pattern,
      modeId: snapshot.modeId,
      providerId: snapshot.config.providerId,
      modelRef: snapshot.config.modelRef,
      prompt: snapshot.input.prompt,
      startedAt: snapshot.input.createdAt ?? snapshot.updatedAt,
      updatedAt: snapshot.updatedAt,
      eventCount: snapshot.events.length,
      checkpointCount: snapshot.checkpoints.length,
      artifactCount: snapshot.artifacts.length,
      attention: snapshot.attention,
    }],
    transcript: [],
    latestSnapshot: snapshot,
  };
}

function renderElement(element: ReturnType<typeof createElement>) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(element);
  });
  return () => {
    act(() => {
      root.unmount();
    });
    container.remove();
  };
}

async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
  });
}

function acceptedPlanWorkbenchState(): WorkbenchState {
  const snapshot = planDecisionSnapshot();
  return {
    ...initialWorkbenchState,
    selectedSessionId: snapshot.sessionId,
    selectedTurnRunId: undefined,
    selectedPattern: "orchestrator_subagent",
    selectedModeId: "single_agent",
    selectedModeSelection: "manual",
    selectedProviderId: "provider-1",
    promptText: "",
    taskIntent: "plan",
    sessions: [{
      sessionId: snapshot.sessionId,
      title: "Plan session",
      status: snapshot.status,
      latestRunId: snapshot.runId,
      latestPattern: snapshot.pattern,
      latestModeId: snapshot.modeId,
      latestProviderId: snapshot.config.providerId,
      latestModelRef: snapshot.config.modelRef,
      turnCount: 1,
      createdAt: 1_700_000_000_000,
      updatedAt: snapshot.updatedAt,
      attention: snapshot.attention,
    }],
    activeSessionDetail: sessionDetail(snapshot),
    runLifecycle: {
      stage: "settled",
      runId: snapshot.runId,
      sessionId: snapshot.sessionId,
      prompt: snapshot.input.prompt,
      createdAt: snapshot.input.createdAt ?? snapshot.updatedAt,
      snapshot,
    },
    modes: [{
      id: "single_agent",
      family: "single_agent",
      label: "Single Agent",
      summary: "Plan implementation mode",
      capabilityFlags: {
        toolIds: [],
        skillIds: [],
      },
    }] as never,
    providerRegistry: {
      providers: [{
        id: "provider-1",
        label: "Provider 1",
        type: "local_smoke",
        modelId: "provider-model",
        capabilities: ["chat"],
        headers: {},
      }],
    } as never,
    patterns: [],
  } as WorkbenchState;
}

function ActionsProbe({ onReady }: { onReady: (actions: ReturnType<typeof useRunActions>["actions"]) => void }) {
  const { actions } = useRunActions();
  useEffect(() => {
    onReady(actions);
  }, [actions, onReady]);
  return null;
}

describe("desktop run actions", () => {
  beforeEach(() => {
    runtimeHarness.state = acceptedPlanWorkbenchState();
    runtimeHarness.client = createRuntimeClientMock();
    runtimeHarness.dispatch.mockReset();
  });

  afterEach(() => {
    runtimeHarness.state = undefined;
    runtimeHarness.client = undefined;
  });

  it("keeps clarification preflight off by default for all task intents", () => {
    expect(shouldEnableClarificationPreflight("implement")).toBe(false);
    expect(shouldEnableClarificationPreflight("plan")).toBe(false);
    expect(shouldEnableClarificationPreflight("chat")).toBe(false);
  });

  it("keeps host-capable file tools but removes workspace-only tools when no project is selected", () => {
    expect(toolIdsForRun([
      "repo.explore",
      "file.read",
      "file.list",
      "file.glob",
      "file.grep",
      "file.write",
      "file.patch",
      "file.apply_patch",
      "file.delete",
      "shell.execute",
      "package.list",
      "web.fetch",
      "web.search",
      "document.extract",
      "skills.list",
      "user.clarify",
    ], undefined)).toEqual([
      "file.read",
      "file.list",
      "file.glob",
      "file.grep",
      "file.write",
      "file.patch",
      "web.fetch",
      "web.search",
      "document.extract",
      "skills.list",
      "user.clarify",
    ]);
  });

  it("keeps project workspace tools and adds safe chat file tools when a project is selected", () => {
    expect(toolIdsForRun(["web.fetch", "file.write"], "project-1")).toEqual([
      "web.fetch",
      "file.write",
      "file.read",
      "file.list",
      "file.glob",
      "file.grep",
    ]);
  });

  it("invalidates stable view model cache when the composer mode changes", () => {
    const base = {
      activeSessionId: "session-1",
      selectedPattern: "agent_teams",
      modeIds: ["message_bus", "code_development"],
    };

    expect(stableViewModelCacheKey({
      ...base,
      selectedModeId: "message_bus",
    })).not.toBe(stableViewModelCacheKey({
      ...base,
      selectedModeId: "code_development",
    }));
  });

  it("invalidates stable view model cache when session run state changes", () => {
    const base = {
      activeSessionId: "session-1",
      selectedPattern: "agent_teams",
      selectedModeId: "message_bus",
      modeIds: ["message_bus", "code_development"],
    };

    expect(stableViewModelCacheKey({
      ...base,
      sessionRunStateKey: "session-1:succeeded::run-1",
    })).not.toBe(stableViewModelCacheKey({
      ...base,
      sessionRunStateKey: "session-1:running:running:run-1",
    }));
  });

  it("includes attached project files in run context", () => {
    expect(buildDesktopRunContext([
      {
        projectId: "project-a",
        path: "src/App.tsx",
        name: "App.tsx",
        mimeType: "text/typescript",
        sizeBytes: 128,
      },
    ])).toEqual({
      source: "desktop-workbench",
      attachedProjectFiles: [
        {
          projectId: "project-a",
          path: "src/App.tsx",
          name: "App.tsx",
          mimeType: "text/typescript",
          sizeBytes: 128,
        },
      ],
    });
  });

  it("omits attached project files when none are pending", () => {
    expect(buildDesktopRunContext()).toEqual({ source: "desktop-workbench" });
  });

  it("merges extra run context with existing desktop attachments", () => {
    expect(buildDesktopRunContext(
      [],
      [{
        path: "/tmp/note.txt",
        name: "note.txt",
        mimeType: "text/plain",
        sizeBytes: 12,
        content: "hello",
      }],
      [],
      {
        selectedWidgetContext: {
          id: "widget-1",
          title: "任务清单",
        },
      },
    )).toEqual({
      source: "desktop-workbench",
      selectedWidgetContext: {
        id: "widget-1",
        title: "任务清单",
      },
      attachedLocalFiles: [{
        path: "/tmp/note.txt",
        name: "note.txt",
        mimeType: "text/plain",
        sizeBytes: 12,
        content: "hello",
      }],
    });
  });

  it("summarizes multiple clarification answers for the pending user message", () => {
    expect(buildClarificationSubmissionPrompt(
      {
        target_environment: "staging",
        time_window: "最近 30 天",
      },
      [
        {
          id: "clarification:env",
          nodeId: "root",
          nodeLabel: "Ora",
          key: "target_environment",
          question: "目标环境",
          options: [],
          requestedAt: 1,
        },
        {
          id: "clarification:time",
          nodeId: "root",
          nodeLabel: "Ora",
          key: "time_window",
          question: "时间范围",
          options: [],
          requestedAt: 2,
        },
      ],
    )).toBe([
      "已补充：",
      "- 目标环境: staging",
      "- 时间范围: 最近 30 天",
    ].join("\n"));
  });

  it("keeps single clarification answer as the pending user message", () => {
    expect(buildClarificationSubmissionPrompt({ intent_guard: "我们是收单机构。" })).toBe("我们是收单机构。");
  });

  it("uses the selected turn latestSnapshot for clarification resumes when no live snapshot is active", () => {
    const latestSnapshot = {
      runId: "run-clarify",
      sessionId: "session-empty",
      status: "interrupted",
      pendingClarifications: [{
        id: "clarification:intent_guard",
        key: "intent_guard",
        question: "请补充角色",
        nodeId: "root",
        nodeLabel: "Ora",
        options: [],
        requestedAt: 1,
      }],
      input: { prompt: "test" },
      updatedAt: 2,
    } as unknown as OraStateSnapshot;

    const state = stateWithSession({
      selectedTurnRunId: "run-clarify",
      activeSessionDetail: {
        session: sessionSummary("session-empty"),
        turns: [],
        transcript: [],
        latestSnapshot,
      },
    });

    expect(getSelectedInteractiveSnapshot(state)?.runId).toBe("run-clarify");
  });

  it("derives the accepted plan resume runId from the interactive snapshot even when no turn is selected", () => {
    const state = stateWithSession({
      runLifecycle: {
        stage: "settled",
        runId: "run-plan",
        sessionId: "session-empty",
        prompt: "Plan the work",
        createdAt: 1_714_000_000_001,
        snapshot: {
          runId: "run-plan",
          sessionId: "session-empty",
          status: "succeeded",
          input: { prompt: "Plan the work" },
          planDecisions: [{
            id: "decision-1",
            runId: "run-plan",
            sessionId: "session-empty",
            status: "pending",
            createdAt: 1_714_000_000_002,
          }],
          updatedAt: 1_714_000_000_002,
        } as OraStateSnapshot,
      },
      selectedTurnRunId: undefined,
    });

    expect(getPlanDecisionResumeRunId(state)).toBe("run-plan");
    expect(getInteractiveRunId(state)).toBe("run-plan");
  });

  it("prefers the explicitly selected turn runId over the active snapshot when routing interactive commands", () => {
    const state = stateWithSession({
      selectedTurnRunId: "run-selected",
      runLifecycle: {
        stage: "settled",
        runId: "run-active",
        sessionId: "session-empty",
        prompt: "Active run",
        createdAt: 1,
        snapshot: {
          runId: "run-active",
          sessionId: "session-empty",
          status: "running",
          input: { prompt: "Active run" },
          updatedAt: 2,
        } as OraStateSnapshot,
      },
    });

    expect(getPlanDecisionResumeRunId(state)).toBe("run-selected");
    expect(getInteractiveRunId(state)).toBe("run-selected");
  });

  it("falls back to the session attention sourceRunId when accepted plan resume lacks snapshots", () => {
    const state = stateWithSession({
      selectedTurnRunId: undefined,
      activeSessionDetail: {
        session: {
          ...sessionSummary("session-empty"),
          attention: {
            kind: "needs_plan_decision",
            blocking: true,
            sourceRunId: "run-plan",
            reason: "plan_decision_required",
            planDecisionId: "decision-1",
            pendingActionIds: [],
            pendingToolCallIds: [],
            pendingClarificationIds: [],
          },
        } as OraSessionSummary & { attention: NonNullable<OraSessionSummary["attention"]> },
        turns: [],
        transcript: [],
        latestSnapshot: undefined,
      },
    });

    expect(getPlanDecisionResumeRunId(state)).toBe("run-plan");
    expect(getInteractiveRunId(state)).toBe("run-plan");
  });

  it("uses the latest interactive snapshot runId for clarification and approval style resumes", () => {
    const latestSnapshot = {
      runId: "run-gate",
      sessionId: "session-empty",
      status: "interrupted",
      input: { prompt: "Need gate resolution" },
      updatedAt: 3,
    } as unknown as OraStateSnapshot;

    const state = stateWithSession({
      selectedTurnRunId: undefined,
      activeSessionDetail: {
        session: sessionSummary("session-empty"),
        turns: [],
        transcript: [],
        latestSnapshot,
      },
    });

    expect(getInteractiveRunId(state)).toBe("run-gate");
  });

  it("starts a new implementation turn after accepting a plan decision", async () => {
    const cleanup = renderElement(createElement(ActionsProbe, {
      onReady: (actions) => {
        runtimeHarness.actions = actions;
      },
    }));

    await flushMicrotasks();
    const actions = runtimeHarness.actions;
    expect(actions).toBeTruthy();

    vi.useFakeTimers();
    await act(async () => {
      const resultPromise = actions!.acceptPlanDecisionAndStartImplementation();
      await vi.runAllTimersAsync();
      await resultPromise;
    });
    vi.useRealTimers();

    expect(runtimeHarness.client!.acceptPlanDecisionAndResume).not.toHaveBeenCalled();
    expect(runtimeHarness.client!.resolvePlanDecision).toHaveBeenCalledWith({
      sessionId: "session-plan",
      runId: "run-plan",
      decisionId: "decision-1",
      status: "accepted",
    });
    expect(runtimeHarness.client!.startStreamingRun).toHaveBeenCalledTimes(1);
    expect(runtimeHarness.client!.startStreamingRun).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: USER_RESUMED_MESSAGE,
        context: expect.objectContaining({ source: "desktop-workbench" }),
      }),
      expect.objectContaining({
        metadata: expect.objectContaining({
          taskIntent: "implement",
          acceptedPlanDecisionId: "decision-1",
          acceptedPlanSourceRunId: "run-plan",
        }),
      }),
      "session-plan",
    );
    cleanup();
  });

  describe("getPlanDecisionGateAuthority", () => {
    it("derives decisionId and sourceRunId from the same active snapshot gate", () => {
      const state = stateWithSession({
        runLifecycle: {
          stage: "settled",
          runId: "run-plan",
          sessionId: "session-empty",
          prompt: "Plan the work",
          createdAt: 1,
          snapshot: {
            runId: "run-plan",
            sessionId: "session-empty",
            status: "succeeded",
            input: { prompt: "Plan the work" },
            planDecisions: [{
              id: "decision-1",
              runId: "run-plan",
              sessionId: "session-empty",
              status: "pending",
              createdAt: 2,
            }],
            updatedAt: 2,
          } as OraStateSnapshot,
        },
      });

      const authority = getPlanDecisionGateAuthority(state);
      expect(authority).toBeDefined();
      expect(authority!.decisionId).toBe("decision-1");
      expect(authority!.sourceRunId).toBe("run-plan");
      expect(authority!.sessionId).toBe("session-empty");
    });

    it("ignores selectedTurnRunId when deriving gate authority", () => {
      const state = stateWithSession({
        selectedTurnRunId: "run-historical",
        runLifecycle: {
          stage: "settled",
          runId: "run-plan",
          sessionId: "session-empty",
          prompt: "Plan the work",
          createdAt: 1,
          snapshot: {
            runId: "run-plan",
            sessionId: "session-empty",
            status: "succeeded",
            input: { prompt: "Plan the work" },
            planDecisions: [{
              id: "decision-1",
              runId: "run-plan",
              sessionId: "session-empty",
              status: "pending",
              createdAt: 2,
            }],
            updatedAt: 2,
          } as OraStateSnapshot,
        },
      });

      const authority = getPlanDecisionGateAuthority(state);
      expect(authority!.sourceRunId).toBe("run-plan");
      // getInteractiveRunId would return the selected turn
      expect(getInteractiveRunId(state)).toBe("run-historical");
    });

    it("returns undefined when no plan decision gate exists in any snapshot", () => {
      const state = stateWithSession({
        runLifecycle: {
          stage: "settled",
          runId: "run-done",
          sessionId: "session-empty",
          prompt: "Do the work",
          createdAt: 1,
          snapshot: {
            runId: "run-done",
            sessionId: "session-empty",
            status: "succeeded",
            input: { prompt: "Do the work" },
            planDecisions: [],
            updatedAt: 2,
          } as unknown as OraStateSnapshot,
        },
      });

      expect(getPlanDecisionGateAuthority(state)).toBeUndefined();
    });

    it("falls back to latestSnapshot when no active snapshot exists", () => {
      const latestSnapshot = {
        runId: "run-plan",
        sessionId: "session-empty",
        status: "succeeded",
        input: { prompt: "Plan the work" },
        planDecisions: [{
          id: "decision-2",
          runId: "run-plan",
          sessionId: "session-empty",
          status: "pending",
          createdAt: 2,
        }],
        updatedAt: 2,
      } as OraStateSnapshot;

      const state = stateWithSession({
        runLifecycle: { stage: "idle" },
        activeSessionDetail: {
          session: sessionSummary("session-empty"),
          turns: [],
          transcript: [],
          latestSnapshot,
        },
      });

      const authority = getPlanDecisionGateAuthority(state);
      expect(authority).toBeDefined();
      expect(authority!.decisionId).toBe("decision-2");
      expect(authority!.sourceRunId).toBe("run-plan");
    });

  it("uses the attention-based plan_decision gate from active snapshot", () => {
      const state = stateWithSession({
        runLifecycle: {
          stage: "settled",
          runId: "run-plan",
          sessionId: "session-empty",
          prompt: "Plan the work",
          createdAt: 1,
          snapshot: {
            runId: "run-plan",
            sessionId: "session-empty",
            status: "succeeded",
            attention: {
              kind: "needs_plan_decision",
              blocking: true,
              sourceRunId: "run-plan",
              reason: "plan_decision_required",
              planDecisionId: "decision-attn",
              pendingActionIds: [],
              pendingToolCallIds: [],
              pendingClarificationIds: [],
            },
            input: { prompt: "Plan the work" },
            planDecisions: [{
              id: "decision-attn",
              runId: "run-plan",
              sessionId: "session-empty",
              status: "pending",
              createdAt: 2,
            }],
            updatedAt: 2,
          } as unknown as OraStateSnapshot,
        },
      });

      const authority = getPlanDecisionGateAuthority(state);
      expect(authority).toBeDefined();
      expect(authority!.decisionId).toBe("decision-attn");
      expect(authority!.sourceRunId).toBe("run-plan");
    });
  });

  it("treats accepted same-run resume authority as the plan source run even before a fresh snapshot arrives", () => {
    const state = stateWithSession({
      pendingPlanDecisionResolution: {
        sessionId: "session-empty",
        decisionId: "decision-1",
        status: "accepted",
        createdAt: 10,
      },
      runLifecycle: {
        stage: "streaming",
        runId: "run-plan",
        sessionId: "session-empty",
        prompt: "Plan the work",
        createdAt: 1,
        snapshot: {
          runId: "run-plan",
          sessionId: "session-empty",
          status: "running",
          input: { prompt: "Plan the work" },
          planDecisions: [{
            id: "decision-1",
            runId: "run-plan",
            sessionId: "session-empty",
            status: "accepted",
            createdAt: 2,
            resolvedAt: 3,
          }],
          updatedAt: 3,
        } as OraStateSnapshot,
      },
    });

    expect(getPlanDecisionResumeRunId(state)).toBe("run-plan");
    expect(getInteractiveRunId(state)).toBe("run-plan");
  });

  it("includes attached local files in run context", () => {
    expect(buildDesktopRunContext([], [
      {
        path: "/tmp/notes.md",
        name: "notes.md",
        mimeType: "text/markdown",
        sizeBytes: 128,
        content: "# Notes",
        truncated: true,
      },
    ])).toEqual({
      source: "desktop-workbench",
      attachedLocalFiles: [
        {
          path: "/tmp/notes.md",
          name: "notes.md",
          mimeType: "text/markdown",
          sizeBytes: 128,
          content: "# Notes",
          truncated: true,
        },
      ],
    });
  });

  it("builds tmp grants even when no local files are attached", () => {
    expect(buildInitialHostFilesystemState()).toEqual({
      grants: [
        {
          id: "system-tmp:/tmp",
          rootPath: "/tmp",
          label: "Temporary directory (/tmp)",
          source: "system_tmp",
          capabilities: ["read", "list", "search", "write", "patch"],
          expiresWithRun: true,
        },
        {
          id: "system-tmp:/private/tmp",
          rootPath: "/private/tmp",
          label: "Temporary directory (/private/tmp)",
          source: "system_tmp",
          capabilities: ["read", "list", "search", "write", "patch"],
          expiresWithRun: true,
        },
      ],
      allowDynamicGrant: false,
    });
  });

  it("derives read-only grants from attached local file parent directories", () => {
    const result = buildInitialHostFilesystemState([
      {
        path: "/Users/quintenchen/Desktop/notes/todo.md",
        name: "todo.md",
        mimeType: "text/markdown",
        sizeBytes: 18,
      },
      {
        path: "/Users/quintenchen/Desktop/notes/plan.md",
        name: "plan.md",
        mimeType: "text/markdown",
        sizeBytes: 12,
      },
    ]);

    expect(result.allowDynamicGrant).toBe(false);
    expect(result.grants).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "attached-local-file:/Users/quintenchen/Desktop/notes",
        rootPath: "/Users/quintenchen/Desktop/notes",
        source: "attached_local_file",
        capabilities: ["read", "list", "search"],
        expiresWithRun: true,
      }),
    ]));
  });

  function sessionSummary(sessionId: string, overrides: Partial<OraSessionSummary> = {}): OraSessionSummary {
    return {
      sessionId,
      title: "New Chat",
      turnCount: 0,
      createdAt: 1_714_000_000_000,
      updatedAt: 1_714_000_000_000,
      ...overrides,
    };
  }

  function stateWithSession(overrides: Partial<WorkbenchState> = {}, session: Partial<OraSessionSummary> = {}): WorkbenchState {
    const baseSession = sessionSummary("session-empty", session);
    return {
      ...initialWorkbenchState,
      selectedSessionId: baseSession.sessionId,
      sessions: [baseSession],
      ...overrides,
    };
  }

  it("allows cleanup for a truly empty session", () => {
    const state = stateWithSession();

    expect(isDisposableEmptySession(state, "session-empty")).toBe(true);
  });

  it("preserves sessions that already have turns", () => {
    const state = stateWithSession({}, { turnCount: 1 });

    expect(isDisposableEmptySession(state, "session-empty")).toBe(false);
  });

  it("preserves a running session even when active detail still looks empty", () => {
    const staleEmptyDetail = {
      session: sessionSummary("session-empty"),
      turns: [],
      transcript: [],
    };
    const state = stateWithSession({
      activeSessionDetail: staleEmptyDetail,
      sessions: [sessionSummary("session-empty", {
        latestRunId: "run-empty",
        status: "running",
      })],
    });

    expect(isDisposableEmptySession(state, "session-empty")).toBe(false);
  });

  it("preserves a selected non-terminal active snapshot even before session detail catches up", () => {
    const state = stateWithSession({
      runLifecycle: {
        stage: "streaming",
        runId: "run-empty",
        sessionId: "session-empty",
        prompt: "Run this",
        createdAt: 1_714_000_000_001,
        snapshot: {
          runId: "run-empty",
          sessionId: "session-empty",
          status: "running",
          input: { prompt: "Run this" },
          updatedAt: 1_714_000_000_002,
        } as OraStateSnapshot,
      },
    });

    expect(isDisposableEmptySession(state, "session-empty")).toBe(false);
  });

  it("preserves empty sessions with local draft state", () => {
    const state = stateWithSession({
      sessionPromptTexts: { "session-empty": "draft prompt" },
    });

    expect(isDisposableEmptySession(state, "session-empty")).toBe(false);
  });

  it("preserves empty sessions with attachments, selected skills, pending runs, or runtime status", () => {
    expect(isDisposableEmptySession(stateWithSession({
      sessionProjectFileAttachments: {
        "session-empty": [{ projectId: "project-1", path: "README.md", name: "README.md", mimeType: "text/markdown", sizeBytes: 42 }],
      },
    }), "session-empty")).toBe(false);

    expect(isDisposableEmptySession(stateWithSession({
      sessionLocalFileAttachments: {
        "session-empty": [{ path: "/tmp/note.txt", name: "note.txt", mimeType: "text/plain", sizeBytes: 12 }],
      },
    }), "session-empty")).toBe(false);

    expect(isDisposableEmptySession(stateWithSession({
      sessionSkillIds: { "session-empty": ["skill-1"] },
    }), "session-empty")).toBe(false);

    expect(isDisposableEmptySession(stateWithSession({
      runLifecycle: {
        stage: "pending",
        sessionId: "session-empty",
        prompt: "Run this",
        createdAt: 1_714_000_000_001,
      },
    }), "session-empty")).toBe(false);

    expect(isDisposableEmptySession(stateWithSession({}, { status: "running" }), "session-empty")).toBe(false);
  });

  it("selects a fallback chat only when the archived project owns the selected session", () => {
    expect(shouldSelectFallbackAfterProjectArchive(stateWithSession({
      selectedSessionId: "session-project",
      sessions: [
        sessionSummary("session-project", { projectId: "project-1" }),
        sessionSummary("session-other"),
      ],
    }), "project-1")).toBe(true);

    expect(shouldSelectFallbackAfterProjectArchive(stateWithSession({
      selectedSessionId: "session-other",
      sessions: [
        sessionSummary("session-project", { projectId: "project-1" }),
        sessionSummary("session-other"),
      ],
    }), "project-1")).toBe(false);
  });
});
