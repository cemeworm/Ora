import { describe, expect, it } from "vitest";
import type { OraWidget } from "../lib/runtimeClient";
import {
  buildSelectedWidgetContext,
  getWidgetCardSize,
  layoutWidgetsForCanvas,
  selectedWidgetForSpaceContext,
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
  it("keeps the task list preset as a compact top-left card", () => {
    const [placement] = layoutWidgetsForCanvas([
      widget({ id: "tasklist", title: "任务清单", kind: "todo" }),
    ]);

    expect(placement).toMatchObject({
      colStart: 1,
      rowStart: 1,
      colSpan: 1,
      rowSpan: 1,
      cardSize: "compact",
    });
  });

  it("uses expanded rendering for larger widget layouts", () => {
    expect(getWidgetCardSize({ x: 0, y: 0, w: 1, h: 1, pinned: false })).toBe("compact");
    expect(getWidgetCardSize({ x: 3, y: 0, w: 2, h: 2, pinned: false })).toBe("expanded");
  });

  it("moves colliding default widgets to the next open canvas slot", () => {
    const placements = layoutWidgetsForCanvas([
      widget({ id: "tasklist", title: "任务清单", kind: "todo" }),
      widget({ id: "notes", title: "随手记", kind: "artifact" }),
    ]);

    expect(placements.map((placement) => [placement.colStart, placement.rowStart])).toEqual([
      [1, 1],
      [2, 1],
    ]);
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
