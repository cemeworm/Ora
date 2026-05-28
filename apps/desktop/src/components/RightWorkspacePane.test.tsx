// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RightWorkspacePane, normalizeBrowserUrl } from "./RightWorkspacePane";
import type {
  RightWorkspaceChildSessionPage,
  RightWorkspacePage,
  RightWorkspaceReplayChildRef,
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

type ReplayChildPageOverrides = Partial<
  Extract<RightWorkspaceChildSessionPage, { childBacking: "replay" }>
>;
type SessionChildPageOverrides = Partial<
  Extract<RightWorkspaceChildSessionPage, { childBacking: "session" }>
>;

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

function replayChildRef(
  overrides: Partial<RightWorkspaceReplayChildRef> = {},
): RightWorkspaceReplayChildRef {
  return {
    id: overrides.id ?? "run-parent:ora-sub-1",
    agentId: overrides.agentId ?? "ora-sub-1",
    label: overrides.label ?? "Builder Child Session",
    status: overrides.status ?? "succeeded",
    lifecyclePhase: overrides.lifecyclePhase,
    deliveryStatus: overrides.deliveryStatus,
    summary: overrides.summary,
    lastMessage: overrides.lastMessage ?? "Built the page body.",
    replayRef: overrides.replayRef ?? {
      kind: "event_range",
      runId: "run-parent",
      fromSeq: 0,
      toSeq: 2,
    },
    sourceSessionId: overrides.sourceSessionId ?? "session-parent",
    sourceRunId: overrides.sourceRunId ?? "run-parent",
    updatedAt: overrides.updatedAt ?? 1_717_000_000_100,
    artifactIds: overrides.artifactIds ?? ["artifact-child-1"],
  };
}

function replayChildPage(
  overrides: ReplayChildPageOverrides = {},
): RightWorkspaceChildSessionPage {
  return {
    id: overrides.id ?? "child-session:replay:run-parent:ora-sub-1:1",
    kind: "child_session",
    title: overrides.title ?? "Child session",
    sessionId: overrides.sessionId ?? "session-parent",
    childBacking: "replay",
    childId: overrides.childId ?? "run-parent:ora-sub-1",
    targetRunId: overrides.targetRunId ?? "run-parent:ora-sub-1",
    replayParentRunId: overrides.replayParentRunId ?? "run-parent",
    replayChildRef: overrides.replayChildRef ?? replayChildRef(),
  };
}

function sessionChildPage(
  overrides: SessionChildPageOverrides = {},
): RightWorkspaceChildSessionPage {
  return {
    id: overrides.id ?? "child-session:session:session-child:1",
    kind: "child_session",
    title: overrides.title ?? "Child session",
    sessionId: overrides.sessionId ?? "session-parent",
    childBacking: "session",
    childId: overrides.childId ?? "session-child",
    targetRunId: overrides.targetRunId ?? "run-child",
    backingSessionId: overrides.backingSessionId ?? "session-child",
    fallbackReplayParentRunId: overrides.fallbackReplayParentRunId,
    fallbackReplayChildRef: overrides.fallbackReplayChildRef,
  };
}

function page(overrides: Partial<RightWorkspacePage> = {}): RightWorkspacePage {
  if (overrides.kind === "artifact") {
    return {
      id: overrides.id ?? "artifact:1",
      kind: "artifact",
      title: overrides.title ?? "Artifact",
      sessionId: overrides.sessionId ?? "session-parent",
      targetRunId: overrides.targetRunId,
      artifactId: overrides.artifactId ?? "artifact-child-1",
    };
  }
  if (overrides.kind === "documents") {
    return {
      id: overrides.id ?? "documents:1",
      kind: "documents",
      title: overrides.title ?? "Documents",
      sessionId: overrides.sessionId ?? "session-parent",
      projectId: overrides.projectId ?? "project-1",
    };
  }
  if (overrides.kind === "browser") {
    return {
      id: overrides.id ?? "browser:1",
      kind: "browser",
      title: overrides.title ?? "浏览器",
      sessionId: overrides.sessionId ?? "session-parent",
      url: (overrides as Extract<RightWorkspacePage, { kind: "browser" }>).url,
      history: (overrides as Extract<RightWorkspacePage, { kind: "browser" }>).history,
      historyIndex: (overrides as Extract<RightWorkspacePage, { kind: "browser" }>).historyIndex,
      isLoading: (overrides as Extract<RightWorkspacePage, { kind: "browser" }>).isLoading,
    };
  }
  if (overrides.kind === "file_preview") {
    return {
      id: overrides.id ?? "file-preview:1",
      kind: "file_preview",
      title: overrides.title ?? "test.ts",
      sessionId: overrides.sessionId ?? "session-parent",
      projectId: overrides.projectId ?? "project-1",
      filePath: overrides.filePath ?? "src/test.ts",
    };
  }
  if (overrides.kind === "home") {
    return {
      id: overrides.id ?? "home:1",
      kind: "home",
      title: overrides.title ?? "新页面",
      sessionId: overrides.sessionId ?? "session-parent",
    };
  }
  if (overrides.kind === "trails") {
    return {
      id: overrides.id ?? "trails:1",
      kind: "trails",
      title: overrides.title ?? "轨迹",
      sessionId: overrides.sessionId ?? "session-parent",
      targetRunId: overrides.targetRunId ?? "run-parent",
    };
  }
  if ((overrides as Partial<RightWorkspaceChildSessionPage>).childBacking === "session") {
    return sessionChildPage(overrides as SessionChildPageOverrides);
  }
  if (overrides.kind === "child_session" || Object.keys(overrides).length === 0) {
    return sessionChildPage(overrides as SessionChildPageOverrides);
  }
  return replayChildPage(overrides as ReplayChildPageOverrides);
}

function workspace(overrides: Partial<RightWorkspaceSessionState> = {}): RightWorkspaceSessionState {
  return {
    open: overrides.open ?? true,
    pages: overrides.pages ?? [page()],
    selectedPageId: overrides.selectedPageId ?? overrides.pages?.[0]?.id ?? "child-session:replay:run-parent:ora-sub-1:1",
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
  defaultChildPageBacking?: "replay" | "session";
}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const runtimeClient =
    params.runtimeClient ??
    ({
      listProjectFiles: vi.fn().mockResolvedValue({
        projectId: "project-1",
        rootPath: "/tmp/ora",
        totalFiles: 0,
        files: [],
        truncated: false,
        skippedDirs: [],
      }),
      getSession: vi.fn().mockResolvedValue(detail()),
      getRunState: vi.fn().mockResolvedValue(snapshot()),
    } as unknown as RuntimeClient);
  const cacheDetail = vi.fn();
  const openWorkspacePage = vi.fn();

  act(() => {
    root.render(
      createElement(RightWorkspacePane, {
        workspace: params.workspace ?? workspace({
          pages: [
            params.defaultChildPageBacking === "replay"
              ? replayChildPage()
              : sessionChildPage(),
          ],
          selectedPageId: params.defaultChildPageBacking === "replay"
            ? "child-session:replay:run-parent:ora-sub-1:1"
            : "child-session:session:session-child:1",
        }),
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
        turnSnapshots: params.turnSnapshots ?? {
          "run-child": snapshot(),
          "run-parent": snapshot({
            runId: "run-parent",
            sessionId: "session-parent",
            status: "running",
            events: [],
            agentMessages: [],
            artifacts: [{
              id: "artifact-child-1",
              runId: "run-parent",
              label: "child-report.md",
              kind: "report",
              mimeType: "text/markdown",
              createdAt: 1_717_000_000_100,
              payload: "# Child report\n\nBuilt in child session.",
            }],
          }),
          "run-parent:ora-sub-1": snapshot({
            runId: "run-parent:ora-sub-1",
            sessionId: "session-parent",
            status: "succeeded",
            input: { prompt: "Build the page", createdAt: 1_717_000_000_000, context: {} },
            output: { text: "Built the page body." },
            artifacts: [{
              id: "artifact-child-1",
              runId: "run-parent:ora-sub-1",
              label: "child-report.md",
              kind: "report",
              mimeType: "text/markdown",
              createdAt: 1_717_000_000_100,
              payload: "# Child report\n\nBuilt in child session.",
            }],
          }),
        },
        sessionDetailsById: params.sessionDetailsById ?? {},
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
    const view = renderPane({ defaultChildPageBacking: "session", sessionDetailsById: { "session-child": detail() } });

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
    expect(view.container.textContent).toContain("浏览器");

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

  it("opens a browser page from the empty workspace picker", () => {
    const view = renderPane({
      workspace: workspace({
        pages: [],
        selectedPageId: undefined,
      }),
    });

    const browserButton = Array.from(view.container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("浏览器"),
    );
    expect(browserButton).toBeTruthy();

    act(() => {
      browserButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(view.openWorkspacePage).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "browser",
        title: "浏览器",
        sessionId: "session-parent",
      }),
    );

    view.cleanup();
  });

  it("normalizes browser URLs for domain and localhost inputs", () => {
    expect(normalizeBrowserUrl("example.com")).toBe("https://example.com/");
    expect(normalizeBrowserUrl("localhost:3000")).toBe("http://localhost:3000/");
    expect(normalizeBrowserUrl("https://example.com/docs")).toBe("https://example.com/docs");
    expect(normalizeBrowserUrl("file:///tmp/test.html")).toBeUndefined();
  });

  it("shows the non-tauri browser fallback shell for browser pages", () => {
    const view = renderPane({
      workspace: workspace({
        pages: [page({ kind: "browser", id: "browser:1", title: "example.com", url: "https://example.com/" })],
        selectedPageId: "browser:1",
      }),
    });

    const fallback = view.container.querySelector('[data-testid="browser-workspace-fallback"]');
    expect(fallback).toBeTruthy();
    expect(fallback?.textContent).toContain("当前环境不支持原生内置浏览器");
    expect(fallback?.textContent).toContain("https://example.com/");

    view.cleanup();
  });

  it("shows browser history controls and disables them when there is no history to traverse", () => {
    const view = renderPane({
      workspace: workspace({
        pages: [page({ kind: "browser", id: "browser:1", title: "example.com", url: "https://example.com/" })],
        selectedPageId: "browser:1",
      }),
    });

    const backButton = view.container.querySelector('button[aria-label="后退"]') as HTMLButtonElement | null;
    const forwardButton = view.container.querySelector('button[aria-label="前进"]') as HTMLButtonElement | null;
    expect(backButton).toBeTruthy();
    expect(forwardButton).toBeTruthy();
    expect(backButton?.disabled).toBe(true);
    expect(forwardButton?.disabled).toBe(true);

    view.cleanup();
  });

  it("shows a loading icon for browser pages while the native webview is being created", () => {
    const view = renderPane({
      workspace: workspace({
        pages: [page({
          kind: "browser",
          id: "browser:1",
          title: "baidu.com",
          url: "https://baidu.com/",
          isLoading: true,
        })],
        selectedPageId: "browser:1",
      }),
    });

    const icon = view.container.querySelector('svg.animate-spin circle[stroke-dasharray="18 20"]');
    expect(icon).toBeTruthy();

    view.cleanup();
  });

  it("navigates browser history with the back and forward buttons", () => {
    const view = renderPane({
      workspace: workspace({
        pages: [page({
          kind: "browser",
          id: "browser:1",
          title: "beta.test",
          url: "https://beta.test/",
          history: ["https://alpha.test/", "https://beta.test/"],
          historyIndex: 1,
        })],
        selectedPageId: "browser:1",
      }),
    });

    const backButton = view.container.querySelector('button[aria-label="后退"]');
    expect(backButton).toBeTruthy();

    act(() => {
      backButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(view.openWorkspacePage).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "browser",
        url: "https://alpha.test/",
        history: ["https://alpha.test/", "https://beta.test/"],
        historyIndex: 0,
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
            pages: [page({ id: "artifact:1", kind: "artifact", title: "Artifact", artifactId: "artifact-child-1" })],
            selectedPageId: "artifact:1",
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
      defaultChildPageBacking: "session",
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
      defaultChildPageBacking: "session",
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
      defaultChildPageBacking: "session",
      sessionDetailsById: { "session-child": detail() },
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
      defaultChildPageBacking: "session",
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
      defaultChildPageBacking: "session",
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
      defaultChildPageBacking: "session",
      runtimeClient,
      sessionDetailsById: {},
      workspace: workspace({
        pages: [sessionChildPage()],
        selectedPageId: "child-session:session:session-child:1",
      }),
    });

    expect(runtimeClient.getSession).toHaveBeenCalledWith("session-child");

    await Promise.resolve();
    await Promise.resolve();

    expect(view.cacheDetail).toHaveBeenCalledWith(nextDetail);
    view.cleanup();
  });

  it("passes the child-session title when opening the latest turn in a new workspace tab", () => {
    const onOpenChildSessionPage = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        createElement(RightWorkspacePane, {
          workspace: workspace({
            pages: [sessionChildPage()],
            selectedPageId: "child-session:session:session-child:1",
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
          onOpenChildSessionPage,
          onOpenWorkspacePage: vi.fn(),
          onCloseWorkspace: vi.fn(),
          onSelectPage: vi.fn(),
          onClosePage: vi.fn(),
          onCacheSessionDetail: vi.fn(),
        }),
      );
    });

    const button = Array.from(container.querySelectorAll("button")).find((entry) =>
      entry.textContent?.includes("在新页签打开最新回合"),
    );
    expect(button).toBeTruthy();

    act(() => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onOpenChildSessionPage).toHaveBeenCalledWith(
      expect.objectContaining({
        childId: "session-child",
        targetRunId: "run-child",
        title: "Builder Child Session",
        backing: "session",
        backingSessionId: "session-child",
      }),
    );

    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("renders replay-backed child content without loading a session detail", () => {
    const runtimeClient = {
      getSession: vi.fn(),
      getRunState: vi.fn().mockResolvedValue(snapshot()),
    } as unknown as RuntimeClient;
    const view = renderPane({
      defaultChildPageBacking: "replay",
      runtimeClient,
      workspace: workspace({
        pages: [replayChildPage({
          title: "Research subagent",
          replayChildRef: replayChildRef({
            label: "Research subagent",
            lastMessage: "Built the page body.",
            summary: "Built the page body.",
          }),
        })],
        selectedPageId: "child-session:replay:run-parent:ora-sub-1:1",
      }),
    });

    expect(runtimeClient.getSession).not.toHaveBeenCalled();
    expect(view.container.textContent).toContain("Research subagent");
    expect(view.container.textContent).toContain("Built the page body.");

    view.cleanup();
  });

  it("shows a non-loading waiting state when replay-backed child has no material yet", () => {
    const view = renderPane({
      defaultChildPageBacking: "replay",
      turnSnapshots: {
        "run-parent": snapshot({
          runId: "run-parent",
          sessionId: "session-parent",
          events: [],
          agentMessages: [],
          artifacts: [],
        }),
      },
      workspace: workspace({
        pages: [replayChildPage({
          replayChildRef: replayChildRef({
            status: "running",
            summary: "",
            lastMessage: "",
            artifactIds: [],
          }),
        })],
        selectedPageId: "child-session:replay:run-parent:ora-sub-1:1",
      }),
    });

    expect(view.container.textContent).toContain("子代理尚未产出可展示内容");
    expect(view.container.textContent).not.toContain("正在加载子代理会话内容");

    view.cleanup();
  });

  it("renders file_preview page and calls readProjectFile", async () => {
    const readProjectFile = vi.fn().mockResolvedValue({
      projectId: "project-1",
      path: "src/test.ts",
      label: "test.ts",
      mimeType: "text/typescript",
      previewKind: "text",
      sizeBytes: 100,
      modifiedAt: 1_717_000_000_000,
      payload: "const x = 1;",
    });
    const runtimeClient = {
      readProjectFile,
      getSession: vi.fn().mockResolvedValue(detail()),
      getRunState: vi.fn().mockResolvedValue(snapshot()),
    } as unknown as RuntimeClient;

    const view = renderPane({
      runtimeClient,
      workspace: workspace({
        pages: [page({
          id: "file-preview:1",
          kind: "file_preview",
          filePath: "src/test.ts",
          projectId: "project-1",
          title: "test.ts",
          sessionId: "session-parent",
        })],
        selectedPageId: "file-preview:1",
      }),
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(readProjectFile).toHaveBeenCalledWith("project-1", "src/test.ts");
    view.cleanup();
  });

  it("shows loading while reading file", async () => {
    const readProjectFile = vi.fn().mockReturnValue(new Promise(() => {}));
    const runtimeClient = {
      readProjectFile,
      getSession: vi.fn().mockResolvedValue(detail()),
      getRunState: vi.fn().mockResolvedValue(snapshot()),
    } as unknown as RuntimeClient;

    const view = renderPane({
      runtimeClient,
      workspace: workspace({
        pages: [page({
          id: "file-preview:loading",
          kind: "file_preview",
          filePath: "src/test.ts",
          projectId: "project-1",
          title: "test.ts",
          sessionId: "session-parent",
        })],
        selectedPageId: "file-preview:loading",
      }),
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(view.container.textContent).toContain("正在加载");
    view.cleanup();
  });

  it("shows error when readProjectFile fails", async () => {
    const readProjectFile = vi.fn().mockRejectedValue(new Error("File not found"));
    const runtimeClient = {
      readProjectFile,
      getSession: vi.fn().mockResolvedValue(detail()),
      getRunState: vi.fn().mockResolvedValue(snapshot()),
    } as unknown as RuntimeClient;

    const view = renderPane({
      runtimeClient,
      workspace: workspace({
        pages: [page({
          id: "file-preview:error",
          kind: "file_preview",
          filePath: "src/missing.ts",
          projectId: "project-1",
          title: "missing.ts",
          sessionId: "session-parent",
        })],
        selectedPageId: "file-preview:error",
      }),
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(view.container.textContent).toContain("File not found");
    view.cleanup();
  });

  it("renders file tree when documents page is selected alongside a file_preview page", async () => {
    const onSelectPage = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const runtimeClient = {
      listProjectFiles: vi.fn().mockResolvedValue({
        projectId: "project-1",
        rootPath: "/tmp/ora",
        totalFiles: 0,
        files: [],
        truncated: false,
        skippedDirs: [],
      }),
      readProjectFile: vi.fn().mockRejectedValue(new Error("read error")),
      getSession: vi.fn().mockResolvedValue(detail()),
      getRunState: vi.fn().mockResolvedValue(snapshot()),
    } as unknown as RuntimeClient;

    act(() => {
      root.render(
        createElement(RightWorkspacePane, {
          workspace: workspace({
            pages: [
              page({ id: "docs:1", kind: "documents", title: "文件", sessionId: "session-parent", projectId: "project-1" }),
              page({ id: "fp:1", kind: "file_preview", title: "test.ts", filePath: "src/test.ts", projectId: "project-1", sessionId: "session-parent" }),
            ],
            selectedPageId: "docs:1",
          }),
          runtimeClient,
          selectedSession: session(),
          selectedProject: { projectId: "project-1", label: "Ora", rootPath: "/tmp/ora", createdAt: 1_717_000_000_000, updatedAt: 1_717_000_000_100, sourceKind: "local_folder", sessionCount: 1 },
          activeSnapshot: snapshot({ sessionId: "session-parent", runId: "run-parent" }),
          busyCommand: undefined, commandFeedback: "Ready", checkpoints: [], planItems: [],
          runInteractionState: { sourceRunId: "run-parent", sourceSessionId: "session-parent", authority: "active_snapshot", snapshotSource: "live", isProcessing: false, canSubmit: true, canStop: false, canResume: false, canRebuild: false, gateKind: undefined, status: "idle" },
          chatMessages: [] as ChatMessage[],
          turnSnapshots: {},
          sessionDetailsById: {},
          onForkRun: vi.fn(), onForkAndResumeRun: vi.fn(), onReplaySelection: vi.fn(), onResumeRun: vi.fn(), onCancelRun: vi.fn(),
          onCopyPath: vi.fn(), onAddFileToChat: vi.fn(), onOpenChildSessionPage: vi.fn(),
          onOpenWorkspacePage: vi.fn(), onCloseWorkspace: vi.fn(), onSelectPage, onClosePage: vi.fn(), onCacheSessionDetail: vi.fn(),
        }),
      );
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(container.textContent).toContain("/tmp/ora");
    expect(container.textContent).toContain("No files found");
    expect(container.textContent).toContain("文件");

    act(() => { root.unmount(); });
    container.remove();
  });

  it("opens file_preview page when clicking a file in the documents drawer", async () => {
    const listProjectFiles = vi.fn().mockResolvedValue({
      projectId: "project-1",
      rootPath: "/tmp/ora",
      totalFiles: 1,
      files: [
        {
          path: "src/test.ts",
          name: "test.ts",
          sizeBytes: 100,
          modifiedAt: 1_717_000_000_000,
          mimeType: "text/typescript",
        },
      ],
      truncated: false,
      skippedDirs: [],
    });
    const runtimeClient = {
      listProjectFiles,
      getSession: vi.fn().mockResolvedValue(detail()),
      getRunState: vi.fn().mockResolvedValue(snapshot()),
    } as unknown as RuntimeClient;

    const view = renderPane({
      runtimeClient,
      workspace: workspace({
        pages: [
          {
            id: "docs:1",
            kind: "documents" as const,
            title: "文件",
            sessionId: "session-parent",
          },
        ],
        selectedPageId: "docs:1",
      }),
    });

    // Wait for async listProjectFiles to resolve and trigger re-render
    await act(async () => {
      await Promise.resolve();
    });

    const srcDirectoryButton = Array.from(view.container.querySelectorAll("button")).find(
      (btn) => btn.textContent?.includes("src"),
    );
    expect(srcDirectoryButton).toBeTruthy();

    act(() => {
      srcDirectoryButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    // Find the file button rendered by DocumentsDrawer tree
    const fileButton = Array.from(view.container.querySelectorAll("button")).find(
      (btn) => btn.textContent?.includes("test.ts"),
    );
    expect(fileButton).toBeTruthy();

    act(() => {
      fileButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(view.openWorkspacePage).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "file_preview",
        filePath: "src/test.ts",
        projectId: "project-1",
      }),
    );

    view.cleanup();
  });

  it("opens a home page when clicking the plus button in the tab bar", () => {
    const view = renderPane({
      workspace: workspace({
        pages: [page({ id: "artifact:1", kind: "artifact", title: "Artifact", sessionId: "session-parent", artifactId: "artifact-child-1" })],
        selectedPageId: "artifact:1",
      }),
    });

    const plusButton = Array.from(view.container.querySelectorAll("button")).find(
      (btn) => btn.getAttribute("aria-label") === "新增页面",
    );
    expect(plusButton).toBeTruthy();

    act(() => {
      plusButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(view.openWorkspacePage).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "home",
        title: "新页面",
        sessionId: "session-parent",
      }),
    );

    view.cleanup();
  });

  it("renders panel choices inside a home page and replaces it on selection", () => {
    const homePage = page({ id: "home:1", kind: "home", title: "新页面", sessionId: "session-parent" });
    const onClosePage = vi.fn();
    const onOpenWorkspacePage = vi.fn();

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        createElement(RightWorkspacePane, {
          workspace: workspace({
            pages: [homePage],
            selectedPageId: "home:1",
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
          turnSnapshots: {},
          sessionDetailsById: {},
          onForkRun: vi.fn(),
          onForkAndResumeRun: vi.fn(),
          onReplaySelection: vi.fn(),
          onResumeRun: vi.fn(),
          onCancelRun: vi.fn(),
          onCopyPath: vi.fn(),
          onAddFileToChat: vi.fn(),
          onOpenChildSessionPage: vi.fn(),
          onOpenWorkspacePage: onOpenWorkspacePage,
          onCloseWorkspace: vi.fn(),
          onSelectPage: vi.fn(),
          onClosePage: onClosePage,
          onCacheSessionDetail: vi.fn(),
        }),
      );
    });

    expect(container.textContent).toContain("轨迹");
    expect(container.textContent).toContain("文件");

    const trailsButton = Array.from(container.querySelectorAll("button")).find(
      (btn) => btn.textContent?.includes("轨迹") && btn.textContent?.includes("timeline"),
    );

    // The home page buttons show 轨迹 with description; find the right one.
    // Since both the tab bar and the home page have buttons containing "轨迹",
    // we look for buttons inside the content area.
    const contentButtons = Array.from(
      container.querySelectorAll(".min-h-0.flex-1.overflow-hidden button"),
    );
    const homeTrailsButton = contentButtons.find(
      (btn) => btn.textContent?.includes("轨迹")
    );
    expect(homeTrailsButton).toBeTruthy();

    act(() => {
      homeTrailsButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onClosePage).toHaveBeenCalledWith(homePage);
    expect(onOpenWorkspacePage).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "trails",
        title: "轨迹",
        sessionId: "session-parent",
      }),
    );

    act(() => { root.unmount(); });
    container.remove();
  });

  it("does not show the plus button when no pages exist", () => {
    const view = renderPane({
      workspace: workspace({
        pages: [],
        selectedPageId: undefined,
      }),
    });

    const plusButton = Array.from(view.container.querySelectorAll("button")).find(
      (btn) => btn.getAttribute("aria-label") === "新增页面",
    );
    expect(plusButton).toBeFalsy();

    view.cleanup();
  });
});
