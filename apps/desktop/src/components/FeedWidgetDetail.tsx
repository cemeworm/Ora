import { useState, useCallback } from "react";
import { getSharedRuntimeClient, type OraWidget } from "../lib/runtimeClient";
import { cn } from "../lib/utils";

interface FeedWidgetDetailProps {
  widget: OraWidget;
  onClose: () => void;
  onUpdated: () => void;
}

export function FeedWidgetDetail({ widget, onClose, onUpdated }: FeedWidgetDetailProps) {
  const client = getSharedRuntimeClient();
  const [newFilter, setNewFilter] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const state = widget.state.kind === "feed" ? widget.state : null;
  const entries = state?.entries ?? [];
  const filters = state?.filters ?? [];
  const isPaused = widget.status === "paused";

  const saveState = useCallback(
    async (nextState: typeof state) => {
      if (!nextState) return;
      try {
        await client.updateWidget({
          id: widget.id,
          state: nextState,
        });
        onUpdated();
      } catch (err) {
        console.error("Failed to update feed state", err);
      }
    },
    [client, widget.id, onUpdated],
  );

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      // Simulate a feed refresh by updating the timestamp
      // In production, this would call external data sources via tools
      const now = Date.now();
      await saveState({
        ...state!,
        lastRefreshAt: now,
        lastSuccessAt: now,
        consecutiveFailures: 0,
        lastError: undefined,
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "刷新失败";
      await saveState({
        ...state!,
        lastRefreshAt: Date.now(),
        lastError: errorMessage,
        consecutiveFailures: (state?.consecutiveFailures ?? 0) + 1,
      });
    } finally {
      setRefreshing(false);
    }
  }, [state, saveState]);

  const handleAddFilter = useCallback(async () => {
    const trimmed = newFilter.trim();
    if (!trimmed || filters.includes(trimmed)) return;
    await saveState({ ...state!, filters: [...filters, trimmed] });
    setNewFilter("");
  }, [newFilter, filters, state, saveState]);

  const handleRemoveFilter = useCallback(
    async (filter: string) => {
      await saveState({ ...state!, filters: filters.filter((f) => f !== filter) });
    },
    [filters, state, saveState],
  );

  const handleTogglePause = useCallback(async () => {
    try {
      await client.updateWidget({
        id: widget.id,
        status: isPaused ? "active" : "paused",
      });
      onUpdated();
    } catch (err) {
      console.error("Failed to toggle feed status", err);
    }
  }, [client, widget.id, isPaused, onUpdated]);

  return (
    <div className="flex h-full flex-col bg-background">
      <header className="flex shrink-0 items-center justify-between border-b px-6 py-4">
        <div>
          <h1 className="text-lg font-serif text-primary">{widget.title}</h1>
          <div className="flex items-center gap-2 mt-1">
            <p className="text-xs text-muted-foreground">
              {entries.length} 条目
              {state?.lastSuccessAt
                ? ` · 上次成功：${new Date(state.lastSuccessAt).toLocaleString()}`
                : " · 暂无数据"}
            </p>
            {isPaused && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-100 text-yellow-700">
                已暂停
              </span>
            )}
            {widget.status === "error" && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-destructive/10 text-destructive">
                错误
              </span>
            )}
          </div>
        </div>
        <button
          onClick={onClose}
          className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition"
        >
          返回
        </button>
      </header>

      {/* Controls bar */}
      <div className="flex shrink-0 items-center gap-2 border-b px-6 py-3">
        <button
          onClick={() => void handleRefresh()}
          disabled={refreshing}
          className={cn(
            "h-8 px-3 rounded-md text-xs font-medium transition",
            "bg-primary text-primary-foreground hover:bg-primary/90",
            "disabled:opacity-50",
          )}
        >
          {refreshing ? "刷新中..." : "手动刷新"}
        </button>
        <button
          onClick={() => void handleTogglePause()}
          className="h-8 px-3 rounded-md border text-xs text-muted-foreground hover:text-foreground transition"
        >
          {isPaused ? "恢复" : "暂停"}
        </button>
        {widget.schedule && widget.schedule.kind !== "manual" && (
          <span className="text-[11px] text-muted-foreground/70">
            {widget.schedule.kind === "rrule" ? "定时刷新" : "单次刷新"}
          </span>
        )}
      </div>

      {/* Filters */}
      <div className="flex shrink-0 items-center gap-2 border-b px-6 py-2">
        <span className="text-[11px] text-muted-foreground shrink-0">过滤：</span>
        <div className="flex flex-wrap items-center gap-1.5 flex-1 min-w-0">
          {filters.map((f) => (
            <span
              key={f}
              className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground"
            >
              {f}
              <button
                onClick={() => void handleRemoveFilter(f)}
                className="hover:text-destructive transition"
              >
                ×
              </button>
            </span>
          ))}
          <input
            type="text"
            value={newFilter}
            onChange={(e) => setNewFilter(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleAddFilter();
            }}
            placeholder="添加关键词过滤..."
            className="h-6 w-32 px-2 rounded border bg-background text-xs placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary"
          />
          {newFilter.trim() && (
            <button
              onClick={() => void handleAddFilter()}
              className="text-[11px] px-1.5 py-0.5 rounded bg-primary/10 text-primary hover:bg-primary/20 transition"
            >
              添加
            </button>
          )}
        </div>
      </div>

      {/* Error banner */}
      {state?.lastError && (
        <div className="flex shrink-0 items-center gap-2 mx-6 mt-3 px-3 py-2 rounded-md bg-destructive/10 border border-destructive/20">
          <span className="text-xs text-destructive font-medium">刷新失败</span>
          <span className="text-xs text-muted-foreground">{state.lastError}</span>
          {state.consecutiveFailures > 1 && (
            <span className="text-[10px] text-muted-foreground/70">
              (连续 {state.consecutiveFailures} 次)
            </span>
          )}
        </div>
      )}

      {/* Entries list */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {entries.length === 0 ? (
          <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
            暂无条目，点击"手动刷新"获取最新数据。
          </div>
        ) : (
          <div className="space-y-2">
            {entries.map((entry) => {
              const matchesFilter =
                filters.length === 0 ||
                filters.some((f) =>
                  `${entry.title} ${entry.summary}`.toLowerCase().includes(f.toLowerCase()),
                );

              if (!matchesFilter) return null;

              return (
                <div
                  key={entry.id}
                  className="rounded-lg border bg-card p-4 text-card-foreground shadow-sm transition hover:shadow-md"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <h3 className="text-sm font-medium mb-1">
                        {entry.url ? (
                          <a
                            href={entry.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hover:text-primary transition"
                          >
                            {entry.title}
                          </a>
                        ) : (
                          entry.title
                        )}
                      </h3>
                      {entry.summary && (
                        <p className="text-xs text-muted-foreground line-clamp-3">{entry.summary}</p>
                      )}
                      <div className="flex items-center gap-2 mt-2">
                        {entry.publishedAt && (
                          <span className="text-[10px] text-muted-foreground/70">
                            {new Date(entry.publishedAt).toLocaleString()}
                          </span>
                        )}
                        {entry.metadata && Object.keys(entry.metadata).length > 0 && (
                          <span className="text-[10px] text-muted-foreground/50">
                            {Object.keys(entry.metadata).join(", ")}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
