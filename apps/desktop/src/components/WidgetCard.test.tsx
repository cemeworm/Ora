import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { OraWidget } from "../lib/runtimeClient";
import { WidgetCard } from "./WidgetCard";

function todoWidget(layout: OraWidget["layout"]): OraWidget {
  const now = 1_700_000_000_000;
  return {
    id: "todo-widget",
    workspaceId: "default",
    title: "任务清单",
    kind: "todo",
    status: "active",
    layout,
    manifestVersion: 1,
    actions: [],
    permissions: [],
    artifactIds: [],
    automationIds: [],
    createdAt: now,
    updatedAt: now,
    state: {
      kind: "todo",
      items: [
        { id: "todo-1", title: "检查发布说明", notes: "", createdAt: now, updatedAt: now },
        { id: "todo-2", title: "同步验证结果", notes: "", createdAt: now, updatedAt: now },
        { id: "todo-3", title: "归档结论", notes: "", createdAt: now, updatedAt: now },
      ],
      consecutiveFailures: 0,
    },
  } as OraWidget;
}

function renderWidget(widget: OraWidget, size: "compact" | "expanded") {
  return renderToStaticMarkup(
    <WidgetCard
      widget={widget}
      size={size}
      selected={false}
      onSelect={vi.fn()}
      onOpenDetail={vi.fn()}
      onTogglePin={vi.fn()}
      onArchive={vi.fn()}
      onRefresh={vi.fn()}
      onUpdate={vi.fn()}
    />,
  );
}

function renderInteractiveWidget(
  widget: OraWidget,
  size: "compact" | "expanded",
  interactionKind: "drag" | "resize" | null = null,
) {
  return renderToStaticMarkup(
    <WidgetCard
      widget={widget}
      size={size}
      selected={false}
      interactiveLayoutEnabled
      layoutInteractionKind={interactionKind}
      onDragHandlePointerDown={vi.fn()}
      onResizeHandlePointerDown={vi.fn()}
      onSelect={vi.fn()}
      onOpenDetail={vi.fn()}
      onTogglePin={vi.fn()}
      onArchive={vi.fn()}
      onRefresh={vi.fn()}
      onUpdate={vi.fn()}
    />,
  );
}

describe("WidgetCard density", () => {
  it("renders compact todo cards without the inline add input", () => {
    const html = renderWidget(todoWidget({ x: 0, y: 0, w: 1, h: 1, pinned: false }), "compact");

    expect(html).toContain('data-widget-card-size="compact"');
    expect(html).toContain("任务清单");
    expect(html).toContain("添加任务");
    expect(html).not.toContain("placeholder=\"添加...\"");
  });

  it("keeps the inline add input for expanded todo cards", () => {
    const html = renderWidget(todoWidget({ x: 3, y: 0, w: 2, h: 2, pinned: false }), "expanded");

    expect(html).toContain('data-widget-card-size="expanded"');
    expect(html).toContain("placeholder=\"添加...\"");
  });

  it("renders drag and resize affordances when interactive layout is enabled", () => {
    const idleHtml = renderInteractiveWidget(
      todoWidget({ x: 1, y: 0, w: 2, h: 2, pinned: false }),
      "expanded",
      null,
    );
    const activeHtml = renderInteractiveWidget(
      todoWidget({ x: 1, y: 0, w: 2, h: 2, pinned: false }),
      "expanded",
      "resize",
    );

    expect(idleHtml).toContain("调整组件大小");
    expect(idleHtml).toContain("md:opacity-0");
    expect(idleHtml).toContain("md:group-hover:opacity-100");
    expect(activeHtml).toContain("调整中");
    expect(activeHtml).toContain("2 × 2");
    expect(activeHtml).not.toContain(">待办<");
  });
});
