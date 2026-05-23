// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createModeSpecFromPattern, MVP_PATTERNS } from "@cemeworm/shared";
import { App } from "./App";
import {
  createRuntimeClient,
  type OraSessionDetail,
  type OraSessionSummary,
  type OraStateSnapshot,
  type RuntimeClient,
} from "./lib/runtimeClient";
import { ONBOARDING_STORAGE_KEY } from "./lib/onboarding";

const runtimeHarness = vi.hoisted(() => ({
  client: undefined as RuntimeClient | undefined,
}));

vi.mock("./lib/runtimeClient", async () => {
  const actual = await vi.importActual<typeof import("./lib/runtimeClient")>("./lib/runtimeClient");
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

vi.mock("./lib/releaseUpdate", () => ({
  checkOraReleaseUpdate: async () => ({ available: false }),
}));

Object.assign(globalThis, {
  IS_REACT_ACT_ENVIRONMENT: true,
});

function sessionSummary(sessionId: string, title: string, latestRunId: string, updatedAt: number): OraSessionSummary {
  return {
    sessionId,
    title,
    status: "succeeded",
    latestRunId,
    latestPattern: "orchestrator_subagent",
    latestModeId: "debate",
    latestProviderId: "local-smoke",
    latestModelRef: "local/smoke-model",
    turnCount: latestRunId === "run-b-1" ? 1 : 2,
    createdAt: updatedAt - 200,
    updatedAt,
  };
}

function sessionTurn(
  runId: string,
  sessionId: string,
  turnIndex: number,
  updatedAt: number,
) {
  return {
    runId,
    sessionId,
    turnIndex,
    status: "succeeded" as const,
    pattern: "orchestrator_subagent" as const,
    modeId: "debate",
    providerId: "local-smoke",
    modelRef: "local/smoke-model",
    prompt: `Prompt ${runId}`,
    startedAt: updatedAt - 100,
    updatedAt,
    eventCount: 0,
    checkpointCount: 0,
    artifactCount: 0,
  };
}

function snapshot(params: {
  runId: string;
  sessionId: string;
  turnIndex: number;
  updatedAt: number;
  status?: OraStateSnapshot["status"];
}): OraStateSnapshot {
  return {
    runId: params.runId,
    sessionId: params.sessionId,
    turnIndex: params.turnIndex,
    status: params.status ?? "succeeded",
    pattern: "orchestrator_subagent",
    modeId: "debate",
    input: { prompt: `Prompt ${params.runId}`, createdAt: params.updatedAt - 100, context: {} },
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
      deterministicSeed: `app-session-history-${params.runId}`,
      skillIds: [],
      toolIds: [],
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
    conversation: [],
    contextState: undefined,
    toolResults: [],
    policyDecisions: [],
    checkpoints: [],
    events: [],
    agentMessages: [],
    childSessions: [],
    parentCoordination: undefined,
    artifacts: [],
    activeAgents: [],
    queueSummary: { mode: "backlog", pending: 0, inProgress: 0, completed: 1, topics: [] },
    sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
    busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
    pendingClarifications: [],
    pendingApprovals: [],
    updatedAt: params.updatedAt,
  } as unknown as OraStateSnapshot;
}

function detail(
  session: OraSessionSummary,
  turns: ReturnType<typeof sessionTurn>[],
  latestSnapshot?: OraStateSnapshot,
): OraSessionDetail {
  return {
    session,
    turns,
    transcript: [],
    latestSnapshot,
    branchGroups: [],
  };
}

function renderApp() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<App />);
  });
  return {
    container,
    unmount: () => {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

async function waitFor(assertion: () => void | Promise<void>, timeoutMs = 3000) {
  const start = Date.now();
  while (true) {
    try {
      await assertion();
      return;
    } catch (error) {
      if (Date.now() - start > timeoutMs) {
        throw error;
      }
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
    }
  }
}

function sessionButton(container: HTMLElement, title: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll("button")).find((candidate) =>
    candidate.textContent?.replace(/\s+/g, " ").includes(title),
  );
  if (!button) {
    const labels = Array.from(container.querySelectorAll("button"))
      .map((candidate) => candidate.textContent?.replace(/\s+/g, " ").trim())
      .filter(Boolean);
    throw new Error(`Session button not found: ${title}; buttons=${JSON.stringify(labels)}`);
  }
  return button as HTMLButtonElement;
}

afterEach(() => {
  vi.restoreAllMocks();
  runtimeHarness.client = undefined;
  window.localStorage.clear();
  document.body.innerHTML = "";
});

describe("App session history loading", () => {
  it("does not re-batch historical getRunState loads when revisiting a warm session", async () => {
    const baseBootstrap = await createRuntimeClient().bootstrap();
    const sessionA = sessionSummary("session-a", "Session A", "run-a-2", 1_714_000_000_200);
    const sessionB = sessionSummary("session-b", "Session B", "run-b-1", 1_714_000_000_300);
    const snapshotA1 = snapshot({
      runId: "run-a-1",
      sessionId: "session-a",
      turnIndex: 1,
      updatedAt: 1_714_000_000_100,
    });
    const snapshotA2 = snapshot({
      runId: "run-a-2",
      sessionId: "session-a",
      turnIndex: 2,
      updatedAt: 1_714_000_000_200,
    });
    const snapshotB1 = snapshot({
      runId: "run-b-1",
      sessionId: "session-b",
      turnIndex: 1,
      updatedAt: 1_714_000_000_300,
    });

    const detailA = detail(
      sessionA,
      [
        sessionTurn("run-a-1", "session-a", 1, 1_714_000_000_100),
        sessionTurn("run-a-2", "session-a", 2, 1_714_000_000_200),
      ],
      snapshotA2,
    );
    const detailB = detail(
      sessionB,
      [sessionTurn("run-b-1", "session-b", 1, 1_714_000_000_300)],
      snapshotB1,
    );

    const getSession = vi.fn(async (sessionId: string, _options?: { includeLatestSnapshot?: boolean }) => {
      if (sessionId === "session-a") return detailA;
      if (sessionId === "session-b") return detailB;
      throw new Error(`unknown session: ${sessionId}`);
    });
    const getRunState = vi.fn(async (runId: string) => {
      if (runId === "run-a-1") return snapshotA1;
      if (runId === "run-a-2") return snapshotA2;
      if (runId === "run-b-1") return snapshotB1;
      throw new Error(`unknown run: ${runId}`);
    });

    runtimeHarness.client = {
      ...createRuntimeClient(),
      workbenchBootstrap: vi.fn(async () => ({
        bootstrap: baseBootstrap,
        projects: [],
        sessions: [sessionA, sessionB],
        activeSessionDetail: detailA,
      })),
      listProjects: vi.fn(async () => []),
      listSessions: vi.fn(async () => [sessionA, sessionB]),
      getSession,
      getRunState,
      subscribeRunEvents: vi.fn(async () => () => {}),
      subscribeChannelSessionUpdates: vi.fn(async () => () => {}),
    } as RuntimeClient;

    window.localStorage.setItem(ONBOARDING_STORAGE_KEY, "completed");
    const view = renderApp();

    await waitFor(() => {
      expect(sessionButton(view.container, "Session A")).toBeTruthy();
      expect(sessionButton(view.container, "Session B")).toBeTruthy();
      expect(getRunState.mock.calls.map(([runId]) => runId)).toEqual(["run-a-1", "run-a-2"]);
    });

    await act(async () => {
      sessionButton(view.container, "Session B").click();
    });

    await waitFor(() => {
      expect(
        getSession.mock.calls.filter(
          ([sessionId, options]) =>
            sessionId === "session-b" &&
            Boolean((options as { includeLatestSnapshot?: boolean } | undefined)?.includeLatestSnapshot),
        ),
      ).toHaveLength(1);
      expect(getRunState.mock.calls.map(([runId]) => runId)).toEqual([
        "run-a-1",
        "run-a-2",
        "run-b-1",
      ]);
    });

    await act(async () => {
      sessionButton(view.container, "Session A").click();
    });

    await waitFor(() => {
      expect(
        getSession.mock.calls.filter(
          ([sessionId, options]) =>
            sessionId === "session-a" &&
            Boolean((options as { includeLatestSnapshot?: boolean } | undefined)?.includeLatestSnapshot),
        ),
      ).toHaveLength(1);
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });

    expect(getRunState.mock.calls.map(([runId]) => runId)).toEqual([
      "run-a-1",
      "run-a-2",
      "run-b-1",
    ]);

    view.unmount();
  });
});
