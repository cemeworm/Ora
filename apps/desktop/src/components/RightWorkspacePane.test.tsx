// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RightWorkspacePane } from "./RightWorkspacePane";
import type {
  RightWorkspacePage,
  RightWorkspaceSessionState,
} from "../lib/state";
import type {
  OraSessionDetail,
  OraSessionSummary,
  OraStateSnapshot,
  RuntimeClient,
} from "../lib/runtimeClient";
import type { ChatMessage, SessionRun } from "../types";

Object.assign(globalThis, {
  IS_REACT_ACT_ENVIRONMENT: true,
});

function session(): SessionRun {
  return {
    id: "session-parent",
    title: "Parent Session",
    project: "Ora",
    projectId: "project-1",
    status: "running",
    pattern: "orchestrator_subagent",
    modeId: "debate",
    updatedAt: "2026-05-25 23:30",
    health: 100,
    latestRunId: "run-parent",
    turnCount: 2,
  };
}

function page(overrides: Partial<RightWorkspacePage> = {}): RightWorkspacePage {
  return {
    id: overrides.id ?? "child-session:1",
    kind: overrides.kind ?? "child_session",
    title: overrides.title ?? "Child session",
    sessionId: overrides.sessionId ?? "session-parent",
    targetRunId: overrides.targetRunId ?? "run-child",
    childSessionId: overrides.childSessionId ?? "session-child",
    artifactId: overrides.artifactId,
    projectId: overrides.projectId,
  };
}

function workspace(overrides: Partial<RightWorkspaceSessionState> = {}): RightWorkspaceSessionState {
  return {
    open: overrides.open ?? true,
    pages: overrides.pages ?? [page()],
    selectedPageId: overrides.selectedPageId ?? overrides.pages?.[0]?.id ?? "child-session:1",
    width: overrides.width ?? 460,
  };
}

function snapshot(overrides: Partial<OraStateSnapshot> = {}): OraStateSnapshot {
  return {
    runId: overrides.runId ?? "run-child",
    sessionId: overrides.sessionId ?? "session-child",
    turnIndex: overrides.turnIndex ?? 1,
    status: overrides.status ?? "succeeded",
    pattern: overrides.pattern ?? "orchestrator_subagent",
    modeId: overrides.modeId ?? "debate",
    input: overrides.input ?? { prompt: "Child task", createdAt: 1_717_000_000_000, context: {} },
    config: overrides.config ?? {
      modeId: "debate",
      pattern: "orchestrator_subagent",
      modeSelection: "manual",
      profileIds: ["debate_agent"],
      providerId: "local-smoke",
      modelRef: "local/smoke-model",
      approvalMode: "high_risk_only",
      patternOptions: {},
      metadata: {},
      deterministicSeed: "right-workspace-pane-test",
      skillIds: [],
      toolIds: [],
    },
    topology: overrides.topology ?? { nodes: [], edges: [] },
    profiles: overrides.profiles ?? [],
    memory: overrides.memory ?? [],
    plan: overrides.plan ?? [],
    planList: overrides.planList ?? [],
    todos: overrides.todos ?? [],
    actions: overrides.actions ?? [],
    toolCalls: overrides.toolCalls ?? [],
    continuation: overrides.continuation ?? { frames: [] },
    planDecisions: overrides.planDecisions ?? [],
    conversation: overrides.conversation ?? [],
    contextState: overrides.contextState,
    toolResults: overrides.toolResults ?? [],
    policyDecisions: overrides.policyDecisions ?? [],
    checkpoints: overrides.checkpoints ?? [],
    events: overrides.events ?? [],
    agentMessages: overrides.agentMessages ?? [],
    childSessions: overrides.childSessions ?? [],
    parentCoordination: overrides.parentCoordination,
    artifacts: overrides.artifacts ?? [{
      id: "artifact-child-1",
      label: "child-report.md",
      kind: "report",
      mimeType: "text/markdown",
      createdAt: 1_717_000_000_100,
      payload: "# Child report",
    }],
    activeAgents: overrides.activeAgents ?? [],
    queueSummary: overrides.queueSummary ?? { mode: "backlog", pending: 0, inProgress: 0, completed: 1, topics: [] },
    sharedStateSummary: overrides.sharedStateSummary ?? { enabled: false, storeKind: "none", version: 0, entries: [] },
    busStats: overrides.busStats ?? { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
    pendingClarifications: overrides.pendingClarifications ?? [],
    pendingApprovals: overrides.pendingApprovals ?? [],
    updatedAt: overrides.updatedAt ?? 1_717_000_000_100,
  } as OraStateSnapshot;
}

function sessionSummary(): OraSessionSummary {
  return {
    sessionId: "session-child",
    title: "Builder Child Session",
    turnCount: 1,
    createdAt: 1_717_000_000_000,
    updatedAt: 1_717_000_000_100,
    status: "succeeded",
    latestRunId: "run-child",
    latestPattern: "orchestrator_subagent",
    latestModeId: "debate",
    latestProviderId: "local-smoke",
    latestModelRef: "local/smoke-model",
  };
}

function detail(): OraSessionDetail {
  return {
    session: sessionSummary(),
    turns: [{
      runId: "run-child",
      sessionId: "session-child",
      turnIndex: 1,
      status: "succeeded",
      pattern: "orchestrator_subagent",
      modeId: "debate",
      providerId: "local-smoke",
      modelRef: "local/smoke-model",
      prompt: "Build the page",
      startedAt: 1_717_000_000_000,
      updatedAt: 1_717_000_000_100,
      eventCount: 0,
      checkpointCount: 0,
      artifactCount: 0,
    }],
    transcript: [
      {
        id: "run-child:user",
        sessionId: "session-child",
        runId: "run-child",
        turnIndex: 1,
        role: "user",
        content: "Build the page",
        pattern: "orchestrator_subagent",
        modeId: "debate",
        createdAt: 1_717_000_000_000,
      },
      {
        id: "run-child:assistant",
        sessionId: "session-child",
        runId: "run-child",
        turnIndex: 1,
        role: "assistant",
        content: "Built the page body.",
        pattern: "orchestrator_subagent",
        modeId: "debate",
        createdAt: 1_717_000_000_100,
        agentLabel: "Builder",
      },
    ],
    latestSnapshot: snapshot(),
    branchGroups: [],
  };
}

function renderPane(params: {
  workspace?: RightWorkspaceSessionState;
  sessionDetailsById?: Record<string, OraSessionDetail>;
  runtimeClient?: RuntimeClient;
  turnSnapshots?: Record<string, OraStateSnapshot | undefined>;
}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const runtimeClient =
    params.runtimeClient ??
    ({
      getSession: vi.fn().mockResolvedValue(detail()),
      getRunState: vi.fn().mockResolvedValue(snapshot()),
    } as unknown as RuntimeClient);
  const cacheDetail = vi.fn();
  const openWorkspacePage = vi.fn();

  act(() => {
    root.render(
      createElement(RightWorkspacePane, {
        workspace: params.workspace ?? workspace(),
        runtimeClient,
        selectedSession: session(),
        selectedProject: {
          projectId: "project-1",
          label: "Ora",
          rootPath: "/tmp/ora",
          createdAt: 1_717_000_000_000,
          updatedAt: 1_717_000_000_100,
          sourceKind: "local_folder",
          sessionCount: 1,
        },
        activeSnapshot: snapshot({ sessionId: "session-parent", runId: "run-parent" }),
        busyCommand: "Syncing",
        commandFeedback: "Ready",
        checkpoints: [],
        planItems: [],
        runInteractionState: {
          sourceRunId: "run-parent",
          sourceSessionId: "session-parent",
          authority: "active_snapshot",
          snapshotSource: "live",
          isProcessing: true,
          canSubmit: false,
          canStop: true,
          canResume: false,
          canRebuild: false,
          gateKind: undefined,
          status: "running",
        },
        chatMessages: [] as ChatMessage[],
        turnSnapshots: params.turnSnapshots ?? { "run-child": snapshot() },
        sessionDetailsById: params.sessionDetailsById ?? { "session-child": detail() },
        onForkRun: vi.fn(),
        onForkAndResumeRun: vi.fn(),
        onReplaySelection: vi.fn(),
        onResumeRun: vi.fn(),
        onCancelRun: vi.fn(),
        onCopyPath: vi.fn(),
        onAddFileToChat: vi.fn(),
        onOpenChildSessionPage: vi.fn(),
        onOpenWorkspacePage: openWorkspacePage,
        onCloseWorkspace: vi.fn(),
        onSelectPage: vi.fn(),
        onClosePage: vi.fn(),
        onCacheSessionDetail: cacheDetail,
      }),
    );
  });

  return {
    container,
    root,
    runtimeClient,
    cacheDetail,
    openWorkspacePage,
    cleanup() {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

describe("RightWorkspacePane", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("renders child-session transcript content instead of a summary-only card", () => {
    const view = renderPane({});

    expect(view.container.textContent).toContain("Builder Child Session");
    expect(view.container.textContent).toContain("Build the page");
    expect(view.container.textContent).toContain("Built the page body.");
    expect(view.container.textContent).toContain("Builder");

    view.cleanup();
  });

  it("shows page-entry choices in the empty workspace and opens the selected page kind", () => {
    const view = renderPane({
      workspace: workspace({
        pages: [],
        selectedPageId: undefined,
      }),
    });

    expect(view.container.textContent).not.toContain("选择一个侧边栏页面");
    expect(view.container.textContent).not.toContain("先从这里打开轨迹");
    expect(view.container.textContent).toContain("轨迹");
    expect(view.container.textContent).toContain("文件");

    const trailsButton = Array.from(view.container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("轨迹"),
    );
    expect(trailsButton).toBeTruthy();

    act(() => {
      trailsButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(view.openWorkspacePage).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "trails",
        title: "轨迹",
        sessionId: "session-parent",
        targetRunId: "run-parent",
      }),
    );

    view.cleanup();
  });

  it("uses the top bar for tabs only and exposes an icon-only close action", () => {
    const onCloseWorkspace = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        createElement(RightWorkspacePane, {
          workspace: workspace({
            pages: [page({ id: "trails:1", kind: "trails", title: "轨迹", targetRunId: "run-parent" })],
            selectedPageId: "trails:1",
          }),
          runtimeClient: {
            getSession: vi.fn().mockResolvedValue(detail()),
            getRunState: vi.fn().mockResolvedValue(snapshot()),
          } as unknown as RuntimeClient,
          selectedSession: session(),
          selectedProject: {
            projectId: "project-1",
            label: "Ora",
            rootPath: "/tmp/ora",
            createdAt: 1_717_000_000_000,
            updatedAt: 1_717_000_000_100,
            sourceKind: "local_folder",
            sessionCount: 1,
          },
          activeSnapshot: snapshot({ sessionId: "session-parent", runId: "run-parent" }),
          busyCommand: undefined,
          commandFeedback: "Ready",
          checkpoints: [],
          planItems: [],
          runInteractionState: {
            sourceRunId: "run-parent",
            sourceSessionId: "session-parent",
            authority: "active_snapshot",
            snapshotSource: "live",
            isProcessing: false,
            canSubmit: true,
            canStop: false,
            canResume: false,
            canRebuild: false,
            gateKind: undefined,
            status: "idle",
          },
          chatMessages: [] as ChatMessage[],
          turnSnapshots: { "run-child": snapshot() },
          sessionDetailsById: { "session-child": detail() },
          onForkRun: vi.fn(),
          onForkAndResumeRun: vi.fn(),
          onReplaySelection: vi.fn(),
          onResumeRun: vi.fn(),
          onCancelRun: vi.fn(),
          onCopyPath: vi.fn(),
          onAddFileToChat: vi.fn(),
          onOpenChildSessionPage: vi.fn(),
          onOpenWorkspacePage: vi.fn(),
          onCloseWorkspace,
          onSelectPage: vi.fn(),
          onClosePage: vi.fn(),
          onCacheSessionDetail: vi.fn(),
        }),
      );
    });

    expect(container.textContent).not.toContain("侧边栏");
    expect(container.textContent).not.toContain("选择一个会话以检查最新轮次");

    const closeButton = container.querySelector('button[aria-label="关闭侧边栏"]');
    expect(closeButton).toBeTruthy();
    expect(closeButton?.textContent).toBe("");

    act(() => {
      closeButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onCloseWorkspace).toHaveBeenCalled();

    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("shows child-session turn details and artifacts after switching sections", async () => {
    const nextDetail = detail();
    const runtimeClient = {
      getSession: vi.fn().mockResolvedValue(nextDetail),
      getRunState: vi.fn().mockResolvedValue(snapshot()),
    } as unknown as RuntimeClient;
    const view = renderPane({
      runtimeClient,
      sessionDetailsById: { "session-child": nextDetail },
    });

    const turnsButton = Array.from(view.container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Turns"),
    );
    expect(turnsButton).toBeTruthy();

    act(() => {
      turnsButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(view.container.textContent).toContain("Turn 1");
    expect(view.container.textContent).toContain("Built the page body.");

    const artifactsButton = Array.from(view.container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Artifacts"),
    );
    expect(artifactsButton).toBeTruthy();

    act(() => {
      artifactsButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(view.container.textContent).toContain("child-report.md");
    expect(view.container.textContent).toContain("text/markdown");
    expect(runtimeClient.getRunState).not.toHaveBeenCalled();

    view.cleanup();
  });

  it("loads child-session turn snapshot on demand when no snapshot is cached", async () => {
    const nextDetail = detail();
    const runtimeClient = {
      getSession: vi.fn().mockResolvedValue(nextDetail),
      getRunState: vi.fn().mockResolvedValue(snapshot()),
    } as unknown as RuntimeClient;
    const view = renderPane({
      runtimeClient,
      sessionDetailsById: {
        "session-child": {
          ...nextDetail,
          latestSnapshot: undefined,
        },
      },
      turnSnapshots: {},
    });

    const turnsButton = Array.from(view.container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Turns"),
    );
    expect(turnsButton).toBeTruthy();

    act(() => {
      turnsButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(runtimeClient.getRunState).toHaveBeenCalledWith("run-child", {
      priority: "background",
      tag: "child-session-turn",
    });

    view.cleanup();
  });

  it("embeds artifact preview inside child-session artifacts view", () => {
    const view = renderPane({
      turnSnapshots: {
        "run-child": snapshot({
          artifacts: [
            {
              id: "artifact-markdown",
              runId: "run-child",
              label: "child-report.md",
              kind: "report",
              mimeType: "text/markdown",
              createdAt: 1_717_000_000_100,
              payload: "# Child report\n\nBuilt in child session.",
            },
            {
              id: "artifact-html",
              runId: "run-child",
              label: "preview.html",
              kind: "file",
              mimeType: "text/html",
              createdAt: 1_717_000_000_200,
              payload: "<html><body><main>Child HTML preview</main></body></html>",
            },
          ],
        }),
      },
    });

    const artifactsButton = Array.from(view.container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Artifacts"),
    );
    expect(artifactsButton).toBeTruthy();

    act(() => {
      artifactsButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const previewPane = view.container.querySelector('[data-testid="child-session-artifact-preview"]');
    expect(previewPane?.textContent).toContain("Child report");
    expect(previewPane?.innerHTML).toContain("Built in child session.");

    const htmlArtifactButton = Array.from(view.container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("preview.html"),
    );
    expect(htmlArtifactButton).toBeTruthy();

    act(() => {
      htmlArtifactButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const iframe = previewPane?.querySelector("iframe");
    expect(iframe).toBeTruthy();
    expect(iframe?.getAttribute("sandbox")).toBe("allow-scripts");
    expect(iframe?.getAttribute("srcdoc")).toContain("Child HTML preview");

    view.cleanup();
  });

  it("deepens child-session turn drilldown and routes turn artifact actions into the artifacts section", () => {
    const nextDetail = detail();
    const view = renderPane({
      sessionDetailsById: { "session-child": nextDetail },
      turnSnapshots: {
        "run-child": snapshot({
          agentMessages: [
            {
              id: "agent-message-1",
              runId: "run-child",
              fromAgentId: "builder",
              toAgentIds: ["orchestrator"],
              threadId: "thread-1",
              kind: "reply",
              status: "done",
              content: "Builder completed the artifact handoff.",
              artifactIds: ["artifact-html"],
              createdAt: 1_717_000_000_150,
            },
          ],
          artifacts: [
            {
              id: "artifact-report",
              runId: "run-child",
              label: "child-report.md",
              kind: "report",
              mimeType: "text/markdown",
              createdAt: 1_717_000_000_100,
              payload: "# Child report\n\nBuilt in child session.",
            },
            {
              id: "artifact-html",
              runId: "run-child",
              label: "preview.html",
              kind: "file",
              mimeType: "text/html",
              createdAt: 1_717_000_000_200,
              payload: "<html><body><main>Child HTML preview</main></body></html>",
            },
          ],
          output: { text: "Built the page body." },
        }),
      },
    });

    const turnsButton = Array.from(view.container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Turns"),
    );
    expect(turnsButton).toBeTruthy();

    act(() => {
      turnsButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(view.container.textContent).toContain("Timeline drilldown");
    expect(view.container.textContent).toContain("Agent messages");
    expect(view.container.textContent).toContain("Builder completed the artifact handoff.");
    expect(view.container.textContent).toContain("2 artifacts");

    const openArtifactsButton = Array.from(view.container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("打开 Artifacts"),
    );
    expect(openArtifactsButton).toBeTruthy();

    act(() => {
      openArtifactsButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(view.container.textContent).toContain("Artifact turns");
    expect(view.container.textContent).toContain("preview.html");
    const previewPane = view.container.querySelector('[data-testid="child-session-artifact-preview"]');
    expect(previewPane?.textContent).toContain("Child report");

    act(() => {
      turnsButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const openHtmlArtifactButton = Array.from(view.container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("打开 artifact-html"),
    );
    expect(openHtmlArtifactButton).toBeTruthy();

    act(() => {
      openHtmlArtifactButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(view.container.textContent).toContain("Artifact turns");
    const htmlPreviewPane = view.container.querySelector('[data-testid="child-session-artifact-preview"]');
    const iframe = htmlPreviewPane?.querySelector("iframe");
    expect(iframe).toBeTruthy();
    expect(iframe?.getAttribute("srcdoc")).toContain("Child HTML preview");

    view.cleanup();
  });

  it("shows step-level drilldown for child-session status groups", () => {
    const nextDetail = detail();
    const view = renderPane({
      sessionDetailsById: {
        "session-child": nextDetail,
      },
      turnSnapshots: {
        "run-child": snapshot({
          output: { text: "Built the page body." },
          artifacts: [],
          events: [
            {
              id: "run-child:evt-1",
              type: "tool.called",
              runId: "run-child",
              seq: 1,
              createdAt: 1_717_000_000_050,
              payload: {
                toolId: "file.read",
                status: "succeeded",
                input: { path: "src/app.tsx" },
                output: { path: "src/app.tsx", sizeBytes: 120 },
              },
            },
            {
              id: "run-child:evt-2",
              type: "tool.called",
              runId: "run-child",
              seq: 2,
              createdAt: 1_717_000_000_060,
              payload: {
                toolId: "file.grep",
                status: "succeeded",
                input: { path: "src/app.tsx", pattern: "render" },
                output: { path: "src/app.tsx", matches: [{ line: 12, text: "render();" }] },
              },
            },
            {
              id: "run-child:evt-3",
              type: "tool.called",
              runId: "run-child",
              seq: 3,
              createdAt: 1_717_000_000_070,
              payload: {
                toolId: "shell.execute",
                status: "running",
                input: { command: "pnpm test" },
              },
            },
          ],
        }),
      },
    });

    const turnsButton = Array.from(view.container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Turns"),
    );
    expect(turnsButton).toBeTruthy();

    act(() => {
      turnsButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(view.container.textContent).toContain("Status groups");
    expect(view.container.textContent).toContain("Step drilldown");
    expect(view.container.textContent).toContain("3 steps");
    expect(view.container.textContent).toContain("shell.execute");

    const showStepsButtons = Array.from(view.container.querySelectorAll("button")).filter((button) =>
      button.textContent?.includes("查看 steps"),
    );
    expect(showStepsButtons.length).toBeGreaterThan(0);

    act(() => {
      showStepsButtons.at(-1)?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(view.container.textContent).toContain("运行命令");
    expect(view.container.textContent).toContain("shell.execute");

    view.cleanup();
  });

  it("loads missing child-session detail and caches it", async () => {
    const nextDetail = detail();
    const runtimeClient = {
      getSession: vi.fn().mockResolvedValue(nextDetail),
      getRunState: vi.fn().mockResolvedValue(snapshot()),
    } as unknown as RuntimeClient;
    const view = renderPane({
      runtimeClient,
      sessionDetailsById: {},
    });

    expect(runtimeClient.getSession).toHaveBeenCalledWith("session-child");

    await act(async () => {
      await Promise.resolve();
    });

    expect(view.cacheDetail).toHaveBeenCalledWith(nextDetail);
    view.cleanup();
  });
});
