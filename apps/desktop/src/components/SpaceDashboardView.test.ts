import { describe, expect, it } from "vitest";
import type { OraWidget } from "../lib/runtimeClient";
import { getWidgetCardSize, layoutWidgetsForCanvas } from "./SpaceDashboardView";

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
