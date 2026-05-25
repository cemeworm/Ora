// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initialWorkbenchState } from "../lib/state";
import type { OraWidget } from "../lib/runtimeClient";
import {
  SpaceDashboardView,
  buildSelectedWidgetContext,
  getCanvasMetrics,
  getWidgetCardSize,
  layoutMapFromPlacements,
  layoutWidgetsForCanvas,
  projectWidgetMoveLayout,
  projectWidgetResizeLayout,
  selectedWidgetForSpaceContext,
  sortWidgetsForCanvas,
  widgetContextLabel,
} from "./SpaceDashboardView";

const mocks = vi.hoisted(() => ({
  workbench: null as any,
  dispatch: vi.fn(),
  latestChatInputProps: null as any,
  runtimeClient: {
    listWidgets: vi.fn(async () => []),
  },
  actions: {
    startRunWithPrompt: vi.fn(),
  },
}));

vi.mock("./ChatInput", () => ({
  ChatInput: (props: unknown) => {
    mocks.latestChatInputProps = props;
    return null;
  },
}));

vi.mock("./ChatView", () => ({
  CHAT_VIEW_STABLE_CONTENT_WIDTH_CLASS: "w-test",
  getActiveChatProvider: () => undefined,
}));

vi.mock("../lib/providerOptions", () => ({
  runnableProviderOptions: () => [],
}));

vi.mock("../lib/runInteractionState", () => ({
  deriveRunInteractionState: () => ({
    status: "idle",
    isProcessing: false,
    canSubmit: true,
    canStop: false,
    canResume: false,
    canRebuild: false,
    authority: "session_summary",
  }),
}));

vi.mock("../lib/useRunActions", () => ({
  useRunActions: () => ({
    runtimeClient: mocks.runtimeClient,
    actions: mocks.actions,
  }),
}));

vi.mock("../lib/widgetPresets", () => ({
  ensureTasklistPreset: vi.fn(async () => false),
}));

vi.mock("../lib/state", async () => {
  const actual = await vi.importActual("../lib/state");
  return {
    ...actual,
    useWorkbench: () => ({
      state: mocks.workbench,
      dispatch: mocks.dispatch,
    }),
  };
});

vi.mock("./WidgetCard", () => ({
  WidgetCard: () => null,
}));

vi.mock("./TodoWidgetDetail", () => ({
  TodoWidgetDetail: () => null,
}));

vi.mock("./FeedWidgetDetail", () => ({
  FeedWidgetDetail: () => null,
}));

vi.mock("./ArtifactWidgetDetail", () => ({
  ArtifactWidgetDetail: () => null,
}));

const cleanupCallbacks: Array<() => void> = [];

Object.assign(globalThis, {
  IS_REACT_ACT_ENVIRONMENT: true,
});

beforeEach(() => {
  mocks.workbench = baseWorkbenchState();
  mocks.dispatch.mockReset();
  mocks.latestChatInputProps = null;
  mocks.runtimeClient.listWidgets.mockReset();
  mocks.runtimeClient.listWidgets.mockResolvedValue([]);
  mocks.actions.startRunWithPrompt.mockReset();
});

afterEach(() => {
  while (cleanupCallbacks.length > 0) {
    cleanupCallbacks.pop()?.();
  }
  document.body.innerHTML = "";
});

function renderElement(element: ReturnType<typeof createElement>) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(element);
  });

  const cleanup = () => {
    act(() => {
      root.unmount();
    });
    container.remove();
  };
  cleanupCallbacks.push(cleanup);

  return {
    rerender(nextElement: ReturnType<typeof createElement>) {
      act(() => {
        root.render(nextElement);
      });
    },
  };
}

async function flushMicrotasks() {
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

function baseWorkbenchState(overrides: Record<string, unknown> = {}) {
  return {
    ...initialWorkbenchState,
    activeView: "space-dashboard",
    sessions: [
      { sessionId: "session-a", updatedAt: 1 },
      { sessionId: "session-b", updatedAt: 2 },
    ],
    selectedSessionId: "session-a",
    promptText: "",
    selectedTurnRunId: undefined,
    activeSessionDetail: undefined,
    modes: [
      {
        id: "single_agent",
        family: "single_agent",
        label: "单智能体",
        summary: "默认模式",
      },
    ],
    selectedModeId: "single_agent",
    selectedModeSelection: "manual",
    providerRegistry: { providers: [] },
    providerSecretStatuses: [],
    selectedProviderId: undefined,
    runLifecycle: { stage: "idle" },
    taskIntent: "implement",
    permissionMode: "default",
    isLoading: false,
    skillRegistry: { skills: [] },
    ...overrides,
  } as any;
}

function widget(overrides: Partial<OraWidget>): OraWidget {
  const now = 1_700_000_000_000;
  return {
    id: overrides.id ?? "widget-1",
    workspaceId: "default",
    title: overrides.title ?? "Widget",
    kind: overrides.kind ?? "todo",
    status: "active",
    layout: overrides.layout ?? { x: 0, y: 0, w: 1, h: 1, pinned: false },
    manifestVersion: 1,
    actions: [],
    permissions: [],
    artifactIds: [],
    automationIds: [],
    createdAt: now,
    updatedAt: overrides.updatedAt ?? now,
    state: overrides.state ?? { kind: "todo", items: [] },
  } as OraWidget;
}

describe("SpaceDashboardView canvas layout", () => {
  it("keeps the task list preset as a wide top-left card", () => {
    const [placement] = layoutWidgetsForCanvas([
      widget({
        id: "tasklist",
        title: "任务清单",
        kind: "todo",
        layout: { x: 0, y: 0, w: 2, h: 1, pinned: false },
      }),
    ]);

    expect(placement).toMatchObject({
      colStart: 1,
      rowStart: 1,
      colSpan: 2,
      rowSpan: 1,
      cardSize: "expanded",
    });
  });

  it("uses expanded rendering for larger widget layouts", () => {
    expect(getWidgetCardSize({ x: 0, y: 0, w: 1, h: 1, pinned: false })).toBe("compact");
    expect(getWidgetCardSize({ x: 3, y: 0, w: 2, h: 2, pinned: false })).toBe("expanded");
  });

  it("moves colliding default widgets to the next open canvas slot", () => {
    const placements = layoutWidgetsForCanvas([
      widget({
        id: "tasklist",
        title: "任务清单",
        kind: "todo",
        layout: { x: 0, y: 0, w: 2, h: 1, pinned: false },
      }),
      widget({ id: "notes", title: "随手记", kind: "artifact" }),
    ]);

    expect(placements.map((placement) => [placement.colStart, placement.rowStart])).toEqual([
      [1, 1],
      [3, 1],
    ]);
  });

  it("prioritizes the active widget when previewing collision reflow", () => {
    const widgets = sortWidgetsForCanvas([
      widget({ id: "a", title: "A", updatedAt: 10 }),
      widget({ id: "b", title: "B", kind: "artifact", updatedAt: 20 }),
    ]);
    const placements = layoutWidgetsForCanvas(
      widgets.map((item) => ({
        ...item,
        layout: { ...item.layout, x: 0, y: 0, w: 1, h: 1, pinned: false },
      })),
      { prioritizedWidgetId: "b" },
    );

    expect(placements.map((placement) => [placement.widget.id, placement.colStart, placement.rowStart])).toEqual([
      ["b", 1, 1],
      ["a", 2, 1],
    ]);
    expect(layoutMapFromPlacements(placements)).toMatchObject({
      a: { x: 1, y: 0, w: 1, h: 1, pinned: false },
      b: { x: 0, y: 0, w: 1, h: 1, pinned: false },
    });
  });

  it("clamps projected drag layouts to the visible canvas bounds", () => {
    const moved = projectWidgetMoveLayout({
      clientX: 4_000,
      clientY: -400,
      containerLeft: 0,
      containerTop: 0,
      metrics: getCanvasMetrics(900),
      originLayout: { x: 0, y: 0, w: 2, h: 2, pinned: false },
      originPlacement: { colStart: 1, rowStart: 1, colSpan: 2, rowSpan: 2 },
      pointerOffsetX: 40,
      pointerOffsetY: 50,
    });

    expect(moved).toMatchObject({ x: 4, y: 0, w: 2, h: 2, pinned: false });
  });

  it("clamps projected resize layouts to canvas span limits", () => {
    const grown = projectWidgetResizeLayout({
      clientX: 9_999,
      clientY: 9_999,
      metrics: getCanvasMetrics(900),
      startClientX: 0,
      startClientY: 0,
      originLayout: { x: 4, y: 1, w: 1, h: 2, pinned: false },
      originPlacement: { colStart: 5, rowStart: 2, colSpan: 1, rowSpan: 2 },
    });
    const shrunk = projectWidgetResizeLayout({
      clientX: -9_999,
      clientY: -9_999,
      metrics: getCanvasMetrics(900),
      startClientX: 0,
      startClientY: 0,
      originLayout: { x: 1, y: 1, w: 3, h: 3, pinned: false },
      originPlacement: { colStart: 2, rowStart: 2, colSpan: 3, rowSpan: 3 },
    });

    expect(grown).toMatchObject({ x: 4, y: 1, w: 2, h: 3, pinned: false });
    expect(shrunk).toMatchObject({ x: 1, y: 1, w: 1, h: 1, pinned: false });
  });
});

describe("SpaceDashboardView widget context", () => {
  it("prefers the detail widget over the selected canvas widget", () => {
    const selected = widget({ id: "selected", title: "Selected" });
    const detail = widget({ id: "detail", title: "Detail" });

    expect(selectedWidgetForSpaceContext([selected, detail], "selected", "detail")?.id).toBe("detail");
  });

  it("builds bounded todo context for prompt injection", () => {
    const now = 1_700_000_000_000;
    const todo = widget({
      id: "tasks",
      title: "任务清单",
      kind: "todo",
      state: {
        kind: "todo",
        consecutiveFailures: 0,
        items: Array.from({ length: 16 }, (_, index) => ({
          id: `todo-${index}`,
          title: `任务 ${index}`,
          notes: index === 0 ? "优先" : "",
          createdAt: now,
          updatedAt: now,
          completedAt: index > 12 ? now : undefined,
        })),
      },
    });

    expect(widgetContextLabel(todo)).toBe("任务清单 · 13 待办");
    expect(buildSelectedWidgetContext(todo)).toMatchObject({
      id: "tasks",
      title: "任务清单",
      kind: "todo",
      todo: {
        openItems: expect.arrayContaining([
          expect.objectContaining({ title: "任务 0", notes: "优先" }),
        ]),
      },
    });
    expect(((buildSelectedWidgetContext(todo).todo as any).openItems)).toHaveLength(12);
    expect(((buildSelectedWidgetContext(todo).todo as any).completedItems)).toHaveLength(3);
  });

  it("truncates artifact content in selected widget context", () => {
    const artifact = widget({
      id: "artifact",
      title: "长文档",
      kind: "artifact",
      state: {
        kind: "artifact",
        title: "长文档",
        format: "markdown",
        content: "a".repeat(4100),
        versions: [],
        consecutiveFailures: 0,
      },
    });

    const context = buildSelectedWidgetContext(artifact).artifact as { content: string; truncated?: boolean };
    expect(context.content).toHaveLength(4000);
    expect(context.truncated).toBe(true);
  });
});

describe("SpaceDashboardView composer wiring", () => {
  it("reads the current session draft from workbench state", async () => {
    mocks.workbench = baseWorkbenchState({
      selectedSessionId: "session-a",
      promptText: "draft for a",
    });
    const { rerender } = renderElement(createElement(SpaceDashboardView));
    await flushMicrotasks();

    expect(mocks.latestChatInputProps?.composerPrompt).toBe("draft for a");

    mocks.workbench = baseWorkbenchState({
      selectedSessionId: "session-b",
      promptText: "",
    });
    rerender(createElement(SpaceDashboardView));
    await flushMicrotasks();
    expect(mocks.latestChatInputProps?.composerPrompt).toBe("");

    mocks.workbench = baseWorkbenchState({
      selectedSessionId: "session-a",
      promptText: "draft for a",
    });
    rerender(createElement(SpaceDashboardView));
    await flushMicrotasks();
    expect(mocks.latestChatInputProps?.composerPrompt).toBe("draft for a");
  });

  it("dispatches prompt updates and clears only the submitted session draft", async () => {
    mocks.workbench = baseWorkbenchState({
      selectedSessionId: "session-a",
      promptText: "draft for a",
      taskIntent: "plan",
    });
    renderElement(createElement(SpaceDashboardView));
    await flushMicrotasks();

    act(() => {
      mocks.latestChatInputProps.onPromptChange("updated draft");
    });
    expect(mocks.dispatch).toHaveBeenCalledWith({
      type: "SET_PROMPT",
      text: "updated draft",
    });

    act(() => {
      mocks.latestChatInputProps.onStartRun();
    });

    expect(mocks.actions.startRunWithPrompt).toHaveBeenCalledWith({
      prompt: "draft for a",
      taskIntent: "plan",
      extraContext: undefined,
      extraMetadata: undefined,
    });
    expect(mocks.dispatch).toHaveBeenCalledWith({
      type: "CLEAR_PROMPT_IF_MATCH",
      text: "draft for a",
    });
  });
});
