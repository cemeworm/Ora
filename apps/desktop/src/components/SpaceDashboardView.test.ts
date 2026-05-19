import { describe, expect, it } from "vitest";
import type { OraWidget } from "../lib/runtimeClient";
import {
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
