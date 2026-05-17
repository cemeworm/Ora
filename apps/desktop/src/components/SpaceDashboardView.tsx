import { useState, useEffect, useCallback } from "react";
import { getSharedRuntimeClient, type OraWidget } from "../lib/runtimeClient";
import { WidgetCard } from "./WidgetCard";
import { SpaceComposer } from "./SpaceComposer";
import { TodoWidgetDetail } from "./TodoWidgetDetail";
import { FeedWidgetDetail } from "./FeedWidgetDetail";
import { ArtifactWidgetDetail } from "./ArtifactWidgetDetail";

export function SpaceDashboardView() {
  const [widgets, setWidgets] = useState<OraWidget[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedWidgetId, setSelectedWidgetId] = useState<string | undefined>();
  const [detailWidgetId, setDetailWidgetId] = useState<string | undefined>();
  const client = getSharedRuntimeClient();

  const refresh = useCallback(async () => {
    try {
      const list = await client.listWidgets();
      setWidgets(list);
    } catch (err) {
      console.error("Failed to load widgets", err);
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const detailWidget = detailWidgetId ? widgets.find((w) => w.id === detailWidgetId) : undefined;

  // Widget detail view
  if (detailWidget) {
    if (detailWidget.kind === "todo") {
      return (
        <TodoWidgetDetail
          widget={detailWidget}
          onClose={() => {
            setDetailWidgetId(undefined);
            void refresh();
          }}
          onUpdated={() => void refresh()}
        />
      );
    }
    if (detailWidget.kind === "feed") {
      return (
        <FeedWidgetDetail
          widget={detailWidget}
          onClose={() => {
            setDetailWidgetId(undefined);
            void refresh();
          }}
          onUpdated={() => void refresh()}
        />
      );
    }
    if (detailWidget.kind === "artifact") {
      return (
        <ArtifactWidgetDetail
          widget={detailWidget}
          onClose={() => {
            setDetailWidgetId(undefined);
            void refresh();
          }}
          onUpdated={() => void refresh()}
        />
      );
    }
    // Fallback for unknown widget kind
    return (
      <div className="flex h-full flex-col bg-background">
        <header className="flex shrink-0 items-center justify-between border-b px-6 py-4">
          <h1 className="text-lg font-serif text-primary">{detailWidget.title}</h1>
          <button
            onClick={() => setDetailWidgetId(undefined)}
            className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition"
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

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        加载中...
      </div>
    );
  }

  if (widgets.length === 0) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex flex-1 items-center justify-center">
          <div className="max-w-md text-center">
            <h1 className="text-2xl font-serif text-primary mb-2">工作台</h1>
            <p className="text-sm text-muted-foreground mb-6">
              你的个人工作台。通过下方输入框用自然语言创建组件，或从组件库添加。
            </p>
            <p className="text-xs text-muted-foreground/70">
              试试说："帮我创建一个待办事项组件"
            </p>
          </div>
        </div>
        <SpaceComposer
          scope="space"
          selectedWidgetId={selectedWidgetId}
          onWidgetCreated={refresh}
        />
      </div>
    );
  }

  const sortedWidgets = [...widgets].sort((a, b) => {
    // Pinned widgets first, then by updatedAt descending
    if (a.layout.pinned !== b.layout.pinned) return a.layout.pinned ? -1 : 1;
    return b.updatedAt - a.updatedAt;
  });

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {sortedWidgets.map((widget) => (
            <WidgetCard
              key={widget.id}
              widget={widget}
              selected={widget.id === selectedWidgetId}
              onSelect={() =>
                setSelectedWidgetId((prev) =>
                  prev === widget.id ? undefined : widget.id,
                )
              }
              onOpenDetail={() => setDetailWidgetId(widget.id)}
              onTogglePin={async () => {
                await client.toggleWidgetPin(widget.id);
                void refresh();
              }}
              onArchive={async () => {
                await client.archiveWidget(widget.id);
                void refresh();
              }}
              onRefresh={refresh}
            />
          ))}
        </div>
      </div>
      <SpaceComposer
        scope={selectedWidgetId ? "widget" : "space"}
        selectedWidgetId={selectedWidgetId}
        onWidgetCreated={refresh}
      />
    </div>
  );
}
