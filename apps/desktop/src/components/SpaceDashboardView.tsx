import { useState, useEffect, useCallback, useMemo, type CSSProperties } from "react";
import type { OraWidget, OraModeSpec } from "../lib/runtimeClient";
import { WidgetCard } from "./WidgetCard";
import { ChatInput, type ChatInputContextChip } from "./ChatInput";
import { getActiveChatProvider } from "./ChatView";
import { runnableProviderOptions } from "../lib/providerOptions";
import { useWorkbench } from "../lib/state";
import { deriveRunInteractionState } from "../lib/runInteractionState";
import type { ModeCard } from "../types";
import type { DesktopRunInteractionState } from "../lib/runInteractionState";
import { useRunActions } from "../lib/useRunActions";
import { ensureTasklistPreset } from "../lib/widgetPresets";
import { TodoWidgetDetail } from "./TodoWidgetDetail";
import { FeedWidgetDetail } from "./FeedWidgetDetail";
import { ArtifactWidgetDetail } from "./ArtifactWidgetDetail";

const CANVAS_COLUMNS = 6;
const MAX_WIDGET_ROW_SPAN = 3;

interface CanvasWidgetPlacement {
  widget: OraWidget;
  colStart: number;
  rowStart: number;
  colSpan: number;
  rowSpan: number;
  cardSize: "compact" | "expanded";
}

function toModeCard(mode: OraModeSpec): ModeCard {
  return {
    id: mode.id,
    family: mode.family,
    label: mode.label,
    summary: mode.summary,
    recommendedUse:
      mode.recommendedUse ??
      `Use when ${mode.family.replace(/_/g, " ")} fits the task.`,
    failureMode:
      mode.failureMode ??
      "Misconfigured stages can reduce observability or waste budget.",
    isPreset: (mode as any).systemPreset ?? false,
  };
}

export function SpaceDashboardView() {
  const [widgets, setWidgets] = useState<OraWidget[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedWidgetId, setSelectedWidgetId] = useState<string | undefined>();
  const [detailWidgetId, setDetailWidgetId] = useState<string | undefined>();
  const [composerPrompt, setComposerPrompt] = useState("");
  const [composerOverlayHeight, setComposerOverlayHeight] = useState(0);
  const { runtimeClient: client, actions } = useRunActions();
  const { state: workbench, dispatch } = useWorkbench();

  const refresh = useCallback(async () => {
    try {
      let list = await client.listWidgets();
      const createdPreset = await ensureTasklistPreset(client, list);
      if (createdPreset) {
        list = await client.listWidgets();
      }
      setWidgets(list);
      return list;
    } catch (err) {
      console.error("Failed to load widgets", err);
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const modeCards = useMemo<ModeCard[]>(
    () => workbench.modes.map(toModeCard),
    [workbench.modes],
  );
  const activeMode =
    modeCards.find((m) => m.id === workbench.selectedModeId) ?? modeCards[0];

  const allProviders = workbench.providerRegistry?.providers ?? [];
  const providerOptions = useMemo(
    () => runnableProviderOptions(allProviders, workbench.providerSecretStatuses),
    [allProviders, workbench.providerSecretStatuses],
  );
  const activeProvider = getActiveChatProvider(
    providerOptions,
    workbench.selectedProviderId,
  );

  const runInteractionState: DesktopRunInteractionState = useMemo(() => {
    const sessionSummary = workbench.sessions.find(
      (s) => s.sessionId === workbench.selectedSessionId,
    );
    return deriveRunInteractionState({
      selectedSessionId: workbench.selectedSessionId,
      sessionSummary,
      activeSessionDetail: workbench.activeSessionDetail,
      turnSnapshots: {},
      selectedTurnRunId: workbench.selectedTurnRunId,
      runLifecycle: workbench.runLifecycle,
    });
  }, [
    workbench.selectedSessionId,
    workbench.sessions,
    workbench.activeSessionDetail,
    workbench.runLifecycle,
    workbench.selectedTurnRunId,
  ]);

  const detailWidget = detailWidgetId
    ? widgets.find((w) => w.id === detailWidgetId)
    : undefined;
  const selectedWidget = selectedWidgetForSpaceContext(widgets, selectedWidgetId, detailWidgetId);
  const selectedWidgetContext = selectedWidget
    ? buildSelectedWidgetContext(selectedWidget)
    : undefined;
  const contextChips = useMemo<ChatInputContextChip[]>(() => {
    if (!selectedWidget) return [];
    return [{
      id: selectedWidget.id,
      label: widgetContextLabel(selectedWidget),
      tone: "widget",
      onRemove: () => {
        setSelectedWidgetId(undefined);
        setDetailWidgetId(undefined);
      },
    }];
  }, [selectedWidget]);
  const bottomPad = composerOverlayHeight > 0 ? composerOverlayHeight + 32 : 160;

  useEffect(() => {
    if (selectedWidgetId && !widgets.some((widget) => widget.id === selectedWidgetId && widget.status !== "archived")) {
      setSelectedWidgetId(undefined);
    }
    if (detailWidgetId && !widgets.some((widget) => widget.id === detailWidgetId && widget.status !== "archived")) {
      setDetailWidgetId(undefined);
    }
  }, [detailWidgetId, selectedWidgetId, widgets]);

  function renderChatInput() {
    return (
      <ChatInput
        sessionId={workbench.selectedSessionId ?? ""}
        composerPrompt={composerPrompt}
        isLoading={workbench.isLoading}
        runInteractionState={runInteractionState}
        activeMode={activeMode}
        modeOptions={modeCards}
        selectedModeSelection={workbench.selectedModeSelection}
        activeProvider={activeProvider}
        providerOptions={providerOptions}
        skillOptions={workbench.skillRegistry?.skills ?? []}
        selectedSkillIds={workbench.selectedSkillIds}
        contextChips={contextChips}
        projectFileAttachments={[]}
        localFileAttachments={[]}
        imageAttachments={[]}
        onRemoveImageAttachment={() => {}}
        onAddImageAttachment={() => {}}
        onModeChange={(modeId) => dispatch({ type: "SET_MODE", modeId })}
        onModeSelectionChange={(selection) =>
          dispatch({ type: "SET_MODE_SELECTION", selection })
        }
        onProviderChange={(providerId) =>
          dispatch({ type: "SET_PROVIDER", providerId })
        }
        onPromptChange={setComposerPrompt}
        onSelectedSkillIdsChange={(skillIds) =>
          dispatch({ type: "SET_SELECTED_SKILL_IDS", skillIds })
        }
        onRemoveProjectFileAttachment={() => {}}
        onRemoveLocalFileAttachment={() => {}}
        onOpenLocalFiles={() => {}}
        permissionMode={workbench.permissionMode}
        onPermissionModeChange={(mode) =>
          dispatch({ type: "SET_PERMISSION_MODE", permissionMode: mode })
        }
        taskIntent={workbench.taskIntent}
        onTaskIntentChange={(ti) =>
          dispatch({ type: "SET_TASK_INTENT", taskIntent: ti })
        }
        onOverlayHeightChange={setComposerOverlayHeight}
        onStartRun={() => {
          if (!workbench.selectedSessionId || !composerPrompt.trim()) return;
          const prompt = composerPrompt;
          void actions.startRunWithPrompt({
            prompt,
            taskIntent: workbench.taskIntent,
            extraContext: selectedWidgetContext
              ? { selectedWidgetContext }
              : undefined,
            extraMetadata: selectedWidget
              ? {
                  selectedWidgetId: selectedWidget.id,
                  selectedWidgetSourceView: detailWidget ? "detail" : "dashboard",
                }
              : undefined,
          });
          setComposerPrompt("");
        }}
        onStopRun={() => {
          const runId =
            workbench.runLifecycle.stage === "streaming" ||
            workbench.runLifecycle.stage === "pending"
              ? workbench.runLifecycle.runId
              : undefined;
          if (runId) {
            dispatch({
              type: "REQUEST_RUN_CANCEL",
              runId,
              reason: "user cancelled",
              updatedAt: Date.now(),
            });
          }
        }}
      />
    );
  }

  if (detailWidget) {
    return (
      <div className="relative h-full min-h-0 overflow-hidden">
        <div
          className="h-full overflow-y-auto px-4 pt-4 sm:px-6 lg:px-7"
          style={{ paddingBottom: bottomPad }}
        >
          <div className="mx-auto min-h-[min(720px,calc(100vh-14rem))] max-w-6xl overflow-hidden rounded-md border border-white/70 bg-card/95 text-card-foreground shadow-[0_18px_56px_rgba(23,23,23,0.08)] backdrop-blur-sm">
            {renderWidgetDetail({
              widget: detailWidget,
              onClose: () => {
                setDetailWidgetId(undefined);
                void refresh();
              },
              onUpdated: () => void refresh(),
            })}
          </div>
        </div>
        {renderChatInput()}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-[13px] text-muted-foreground">
        正在整理空间...
      </div>
    );
  }

  const sortedWidgets = [...widgets].sort((a, b) => {
    if (a.layout.y !== b.layout.y) return a.layout.y - b.layout.y;
    if (a.layout.x !== b.layout.x) return a.layout.x - b.layout.x;
    if (isTasklistWidget(a) !== isTasklistWidget(b)) {
      return isTasklistWidget(a) ? -1 : 1;
    }
    if (a.layout.pinned !== b.layout.pinned) return a.layout.pinned ? -1 : 1;
    return b.updatedAt - a.updatedAt;
  });
  const canvasPlacements = layoutWidgetsForCanvas(sortedWidgets);

  if (widgets.length === 0) {
    return (
      <div className="relative h-full min-h-0 overflow-hidden">
        <div
          className="flex h-full items-center justify-center px-4 pt-2 sm:px-6 lg:px-7"
          style={{ paddingBottom: bottomPad }}
        >
          <div className="text-center">
            <h2 className="text-[22px] font-semibold tracking-[-0.01em] text-foreground">
              还没有组件，先做一个吧
            </h2>
          </div>
        </div>
        {renderChatInput()}
      </div>
    );
  }

  return (
    <div className="relative h-full min-h-0 overflow-hidden">
      <div
        className="h-full overflow-y-auto px-4 pt-4 sm:px-6 lg:px-7"
        style={{ paddingBottom: bottomPad }}
      >
        <div className="flex flex-col gap-4 md:grid md:auto-rows-[180px] md:grid-cols-6 md:gap-4">
          {canvasPlacements.map((placement) => {
            const widget = placement.widget;
            const placementStyle = {
              gridColumn: `${placement.colStart} / span ${placement.colSpan}`,
              gridRow: `${placement.rowStart} / span ${placement.rowSpan}`,
            } satisfies CSSProperties;

            return (
              <div
                key={widget.id}
                className="min-h-[180px] md:min-h-0"
                style={placementStyle}
              >
                <WidgetCard
                  widget={widget}
                  size={placement.cardSize}
                  selected={widget.id === selectedWidgetId}
                  onSelect={() =>
                    setSelectedWidgetId((prev) =>
                      prev === widget.id ? undefined : widget.id,
                    )
                  }
                  onOpenDetail={() => {
                    setSelectedWidgetId(widget.id);
                    setDetailWidgetId(widget.id);
                  }}
                  onTogglePin={async () => {
                    await client.toggleWidgetPin(widget.id);
                    void refresh();
                  }}
                  onArchive={async () => {
                    await client.archiveWidget(widget.id);
                    void refresh();
                  }}
                  onRefresh={refresh}
                  onUpdate={async (updated) => {
                    await client.updateWidget({ id: updated.id, state: updated.state });
                    void refresh();
                  }}
                />
              </div>
            );
          })}
        </div>
      </div>
      {renderChatInput()}
    </div>
  );
}

export function getWidgetCardSize(layout: OraWidget["layout"]): "compact" | "expanded" {
  return layout.w > 1 || layout.h > 1 ? "expanded" : "compact";
}

export function layoutWidgetsForCanvas(widgets: OraWidget[]): CanvasWidgetPlacement[] {
  const occupied = new Set<string>();

  return widgets.map((widget) => {
    const colSpan = clampInt(widget.layout.w, 1, CANVAS_COLUMNS);
    const rowSpan = clampInt(widget.layout.h, 1, MAX_WIDGET_ROW_SPAN);
    const desiredCol = clampInt(widget.layout.x + 1, 1, CANVAS_COLUMNS - colSpan + 1);
    const desiredRow = Math.max(1, widget.layout.y + 1);
    const position = findOpenCanvasPosition(
      occupied,
      desiredCol,
      desiredRow,
      colSpan,
      rowSpan,
    );

    markCanvasPosition(occupied, position.colStart, position.rowStart, colSpan, rowSpan);

    return {
      widget,
      colStart: position.colStart,
      rowStart: position.rowStart,
      colSpan,
      rowSpan,
      cardSize: getWidgetCardSize(widget.layout),
    };
  });
}

export function selectedWidgetForSpaceContext(
  widgets: readonly OraWidget[],
  selectedWidgetId: string | undefined,
  detailWidgetId: string | undefined,
): OraWidget | undefined {
  const detailWidget = detailWidgetId
    ? widgets.find((widget) => widget.id === detailWidgetId)
    : undefined;
  if (detailWidget) return detailWidget;
  return selectedWidgetId
    ? widgets.find((widget) => widget.id === selectedWidgetId)
    : undefined;
}

function findOpenCanvasPosition(
  occupied: Set<string>,
  preferredCol: number,
  preferredRow: number,
  colSpan: number,
  rowSpan: number,
): { colStart: number; rowStart: number } {
  let rowStart = preferredRow;
  for (;;) {
    const startCol = rowStart === preferredRow ? preferredCol : 1;
    for (let colStart = startCol; colStart <= CANVAS_COLUMNS - colSpan + 1; colStart += 1) {
      if (isCanvasPositionOpen(occupied, colStart, rowStart, colSpan, rowSpan)) {
        return { colStart, rowStart };
      }
    }
    rowStart += 1;
  }
}

function isCanvasPositionOpen(
  occupied: Set<string>,
  colStart: number,
  rowStart: number,
  colSpan: number,
  rowSpan: number,
): boolean {
  for (let row = rowStart; row < rowStart + rowSpan; row += 1) {
    for (let col = colStart; col < colStart + colSpan; col += 1) {
      if (occupied.has(`${col}:${row}`)) return false;
    }
  }
  return true;
}

function markCanvasPosition(
  occupied: Set<string>,
  colStart: number,
  rowStart: number,
  colSpan: number,
  rowSpan: number,
): void {
  for (let row = rowStart; row < rowStart + rowSpan; row += 1) {
    for (let col = colStart; col < colStart + colSpan; col += 1) {
      occupied.add(`${col}:${row}`);
    }
  }
}

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function isTasklistWidget(widget: OraWidget): boolean {
  return widget.kind === "todo" && widget.title === "任务清单";
}

function renderWidgetDetail({
  widget,
  onClose,
  onUpdated,
}: {
  widget: OraWidget;
  onClose: () => void;
  onUpdated: () => void;
}) {
  if (widget.kind === "todo") {
    return <TodoWidgetDetail widget={widget} onClose={onClose} onUpdated={onUpdated} />;
  }
  if (widget.kind === "feed") {
    return <FeedWidgetDetail widget={widget} onClose={onClose} onUpdated={onUpdated} />;
  }
  if (widget.kind === "artifact") {
    return <ArtifactWidgetDetail widget={widget} onClose={onClose} onUpdated={onUpdated} />;
  }
  return (
    <div className="flex h-full flex-col bg-background">
      <header className="flex shrink-0 items-center justify-between border-b px-6 py-4">
        <h1 className="text-lg font-serif text-primary">{widget.title}</h1>
        <button
          onClick={onClose}
          className="rounded-md px-3 py-1.5 text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground"
        >
          返回
        </button>
      </header>
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        不支持的组件类型
      </div>
    </div>
  );
}

export function widgetContextLabel(widget: OraWidget): string {
  if (widget.kind === "todo" && widget.state.kind === "todo") {
    const openCount = widget.state.items.filter((item) => !item.completedAt).length;
    return `${widget.title} · ${openCount} 待办`;
  }
  if (widget.kind === "feed" && widget.state.kind === "feed") {
    return `${widget.title} · ${widget.state.entries.length} 条目`;
  }
  if (widget.kind === "artifact" && widget.state.kind === "artifact") {
    return `${widget.title} · ${widget.state.format}`;
  }
  return widget.title;
}

export function buildSelectedWidgetContext(widget: OraWidget): Record<string, unknown> {
  const common = {
    id: widget.id,
    title: widget.title,
    kind: widget.kind,
    status: widget.status,
    updatedAt: widget.updatedAt,
    summary: widgetContextSummary(widget),
  };

  if (widget.kind === "todo" && widget.state.kind === "todo") {
    return {
      ...common,
      todo: {
        openItems: widget.state.items
          .filter((item) => !item.completedAt)
          .slice(0, 12)
          .map(widgetTodoItemContext),
        completedItems: widget.state.items
          .filter((item) => item.completedAt)
          .slice(0, 8)
          .map(widgetTodoItemContext),
      },
    };
  }

  if (widget.kind === "feed" && widget.state.kind === "feed") {
    return {
      ...common,
      feed: {
        source: widget.state.source,
        filters: widget.state.filters,
        entries: widget.state.entries.slice(0, 10).map((entry) => ({
          title: entry.title,
          summary: entry.summary,
          url: entry.url,
          publishedAt: entry.publishedAt,
        })),
      },
    };
  }

  if (widget.kind === "artifact" && widget.state.kind === "artifact") {
    const content = widget.state.content;
    return {
      ...common,
      artifact: {
        title: widget.state.title,
        format: widget.state.format,
        content: content.slice(0, 4000),
        ...(content.length > 4000 ? { truncated: true } : {}),
      },
    };
  }

  return common;
}

function widgetTodoItemContext(item: Extract<OraWidget["state"], { kind: "todo" }>["items"][number]) {
  return {
    title: item.title,
    notes: item.notes,
    dueDate: item.dueDate,
    completedAt: item.completedAt,
  };
}

function widgetContextSummary(widget: OraWidget): string {
  if (widget.kind === "todo" && widget.state.kind === "todo") {
    const completed = widget.state.items.filter((item) => item.completedAt).length;
    const open = widget.state.items.length - completed;
    return `${open} 项待办未完成，${completed} 项已完成。`;
  }
  if (widget.kind === "feed" && widget.state.kind === "feed") {
    return `${widget.state.entries.length} 条资讯条目，过滤条件 ${widget.state.filters.join(", ") || "无"}。`;
  }
  if (widget.kind === "artifact" && widget.state.kind === "artifact") {
    return widget.state.content
      ? `文档包含 ${widget.state.content.length} 字符。`
      : "文档当前为空。";
  }
  return "这个组件暂时没有可展示的摘要。";
}
