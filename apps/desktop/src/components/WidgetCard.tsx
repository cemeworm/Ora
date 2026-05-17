import { Archive, CheckSquare, Clock3, ExternalLink, FileText, Newspaper, Pin, PinOff, Plus, RefreshCcw } from "lucide-react";
import { type ReactNode, useState } from "react";
import type { OraWidget } from "../lib/runtimeClient";
import { cn } from "../lib/utils";

export type WidgetCardSize = "compact" | "expanded";

interface WidgetCardProps {
  widget: OraWidget;
  size?: WidgetCardSize;
  selected: boolean;
  onSelect: () => void;
  onOpenDetail: () => void;
  onTogglePin: () => void;
  onArchive: () => void;
  onRefresh: () => void;
  onUpdate: (widget: OraWidget) => void;
}

const KIND_META = {
  todo: {
    label: "待办",
    tone: "bg-sky-50 text-sky-700 ring-sky-200/70",
  },
  feed: {
    label: "资讯",
    tone: "bg-emerald-50 text-emerald-700 ring-emerald-200/70",
  },
  artifact: {
    label: "文档",
    tone: "bg-violet-50 text-violet-700 ring-violet-200/70",
  },
} satisfies Record<OraWidget["kind"], { label: string; tone: string }>;

export function WidgetCard({
  widget,
  size = widget.layout.w > 1 || widget.layout.h > 1 ? "expanded" : "compact",
  selected,
  onSelect,
  onOpenDetail,
  onTogglePin,
  onArchive,
  onRefresh,
  onUpdate,
}: WidgetCardProps) {
  const isError = widget.status === "error";
  const meta = KIND_META[widget.kind];
  const summary = widgetSummary(widget);
  const isTodo = widget.kind === "todo" && widget.state.kind === "todo";
  const isCompact = size === "compact";

  const [newTitle, setNewTitle] = useState("");

  const todoItems = widget.state.kind === "todo" ? widget.state.items : [];
  const activeItems = todoItems.filter((i) => !i.completedAt);
  const completedItems = todoItems.filter((i) => i.completedAt);
  const visibleActiveItems = activeItems.slice(0, isCompact ? 2 : 3);

  const saveTodoItems = (nextItems: typeof todoItems) => {
    onUpdate({
      ...widget,
      state: {
        kind: "todo" as const,
        items: nextItems,
        lastRefreshedAt: Date.now(),
        lastError: undefined,
        consecutiveFailures: 0,
      },
    });
  };

  const handleToggle = (itemId: string) => {
    const now = Date.now();
    const nextItems = todoItems.map((item) =>
      item.id === itemId
        ? { ...item, completedAt: item.completedAt ? undefined : now, updatedAt: now }
        : item,
    );
    saveTodoItems(nextItems);
  };

  const handleAddTodo = () => {
    const title = newTitle.trim();
    if (!title) return;
    const now = Date.now();
    saveTodoItems([...todoItems, { id: crypto.randomUUID(), title, notes: "", createdAt: now, updatedAt: now }]);
    setNewTitle("");
  };

  return (
    <article
      onClick={onSelect}
      className={cn(
        "group relative flex h-full cursor-pointer flex-col overflow-hidden rounded-md border border-white/70 bg-card/88 text-card-foreground shadow-[0_12px_34px_rgba(23,23,23,0.055)] backdrop-blur-sm transition duration-200",
        "hover:-translate-y-0.5 hover:border-bench-300/80 hover:bg-card hover:shadow-[0_18px_46px_rgba(23,23,23,0.09)]",
        "focus-within:border-foreground/20",
        isCompact ? "min-h-[180px] p-3.5" : "min-h-[180px] p-4",
        selected && "border-foreground/45 ring-2 ring-foreground/10",
        isError && "border-rose-200 bg-rose-50/50",
      )}
      data-widget-card-size={size}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex items-center gap-2">
            <span className={cn(
              "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md ring-1",
              meta.tone,
            )}>
              <KindIcon kind={widget.kind} />
            </span>
            {!isCompact && (
              <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1", meta.tone)}>
                {meta.label}
              </span>
            )}
            {widget.layout.pinned && (
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-700">
                <Pin size={11} />
                固定
              </span>
            )}
          </div>
          <h3 className="line-clamp-2 text-[15px] font-semibold leading-5 text-foreground">
            {widget.title}
          </h3>
        </div>
        {isCompact ? (
          <WidgetIconButton
            label={isTodo ? "添加任务" : "打开组件"}
            onClick={onOpenDetail}
            visible
          >
            {isTodo ? <Plus size={14} /> : <ExternalLink size={14} />}
          </WidgetIconButton>
        ) : (
          <WidgetActions
            pinned={widget.layout.pinned}
            onTogglePin={onTogglePin}
            onRefresh={onRefresh}
            onOpenDetail={onOpenDetail}
            onArchive={onArchive}
          />
        )}
      </div>

      {isTodo && !isError ? (
        <div className="mt-3 flex min-h-0 flex-1 flex-col">
          <div className={cn("space-y-0.5", isCompact && "min-h-[54px]")}>
            {visibleActiveItems.map((item) => (
              <div key={item.id} className="flex items-start gap-2 py-0.5">
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); handleToggle(item.id); }}
                  className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 border-muted-foreground/40 hover:border-primary transition active:scale-95"
                  aria-label={`完成: ${item.title}`}
                >
                  <div className="h-1.5 w-1.5 rounded-full bg-transparent" />
                </button>
                <span className="flex-1 min-w-0 text-[13px] leading-5 text-foreground truncate">
                  {item.title}
                </span>
              </div>
            ))}
            {activeItems.length > visibleActiveItems.length && (
              <p className="text-[12px] text-muted-foreground pl-6">
                还有 {activeItems.length - visibleActiveItems.length + completedItems.length} 项...
              </p>
            )}
            {activeItems.length === 0 && completedItems.length === 0 && (
              <p className="text-[13px] leading-5 text-muted-foreground py-1">
                还没有待办事项
              </p>
            )}
          </div>

          {!isCompact && (
            <div className="mt-1.5 flex items-center gap-1.5">
              <input
                type="text"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAddTodo();
                }}
                placeholder="添加..."
                onClick={(e) => e.stopPropagation()}
                className="flex-1 h-6 px-1.5 rounded border-transparent bg-transparent text-[12px] placeholder:text-muted-foreground/40 focus:outline-none focus:border-border/60 focus:bg-background focus:px-1.5 transition"
              />
            </div>
          )}

          <div className={cn(
            "mt-auto flex items-center gap-3 text-[11px] text-muted-foreground",
            isCompact ? "pt-2" : "pt-1.5",
          )}>
            <span>
              {completedItems.length}/{todoItems.length} 已完成
            </span>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onOpenDetail(); }}
              className="hover:text-foreground transition"
            >
              详情 &rarr;
            </button>
          </div>
        </div>
      ) : (
        <p className={cn(
          "mt-4 text-[13px] leading-5 text-muted-foreground",
          isCompact ? "line-clamp-2" : "line-clamp-5",
        )}>
          {summary}
        </p>
      )}

      {!isCompact && (
        <div className="mt-auto flex items-center justify-between gap-3 pt-4">
          <div className="flex min-w-0 items-center gap-1.5 text-[12px] text-muted-foreground">
            <Clock3 size={13} className="shrink-0" />
            <span className="truncate">{formatWidgetDate(widget.updatedAt)}</span>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {widget.schedule && widget.schedule.kind !== "manual" && (
              <span className="rounded-full bg-bench-100 px-2 py-0.5 text-[11px] font-medium text-bench-700">
                定时
              </span>
            )}
            {widget.componentSkillId && (
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 ring-1 ring-emerald-200/70">
                已沉淀
              </span>
            )}
          </div>
        </div>
      )}

      {isCompact && !isTodo && (
        <div className="mt-auto flex items-center justify-between gap-2 pt-3">
          <span className="truncate text-[11px] text-muted-foreground">
            {formatWidgetDate(widget.updatedAt)}
          </span>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onOpenDetail(); }}
            className="text-[11px] font-medium text-foreground/70 transition hover:text-foreground"
          >
            打开
          </button>
        </div>
      )}

      {isCompact && (
        <div className="absolute bottom-2 right-2 flex items-center gap-1 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
          <WidgetActions
            pinned={widget.layout.pinned}
            onTogglePin={onTogglePin}
            onRefresh={onRefresh}
            onOpenDetail={onOpenDetail}
            onArchive={onArchive}
          />
        </div>
      )}
    </article>
  );
}

function KindIcon({ kind }: { kind: OraWidget["kind"] }) {
  if (kind === "todo") return <CheckSquare size={14} />;
  if (kind === "feed") return <Newspaper size={14} />;
  return <FileText size={14} />;
}

function WidgetActions({
  pinned,
  onTogglePin,
  onRefresh,
  onOpenDetail,
  onArchive,
}: {
  pinned: boolean;
  onTogglePin: () => void;
  onRefresh: () => void;
  onOpenDetail: () => void;
  onArchive: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
      <WidgetIconButton
        label={pinned ? "取消固定" : "固定"}
        onClick={onTogglePin}
      >
        {pinned ? <PinOff size={14} /> : <Pin size={14} />}
      </WidgetIconButton>
      <WidgetIconButton label="刷新" onClick={onRefresh}>
        <RefreshCcw size={14} />
      </WidgetIconButton>
      <WidgetIconButton label="详情" onClick={onOpenDetail}>
        <ExternalLink size={14} />
      </WidgetIconButton>
      <WidgetIconButton label="归档" onClick={onArchive}>
        <Archive size={14} />
      </WidgetIconButton>
    </div>
  );
}

function WidgetIconButton({
  label,
  children,
  onClick,
  visible = false,
}: {
  label: string;
  children: ReactNode;
  onClick: () => void;
  visible?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className={cn(
        "flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition hover:bg-bench-100 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/15 active:scale-95",
        visible && "bg-background/72 text-foreground shadow-xs",
      )}
      title={label}
      aria-label={label}
    >
      {children}
    </button>
  );
}

function widgetSummary(widget: OraWidget): string {
  if (widget.kind === "todo" && widget.state.kind === "todo") {
    const completed = widget.state.items.filter((item) => item.completedAt).length;
    const remaining = Math.max(0, widget.state.items.length - completed);
    return widget.state.items.length === 0
      ? "还没有待办事项，可以直接对空间描述下一步要追踪的事情。"
      : `${completed}/${widget.state.items.length} 已完成，${remaining} 项仍在推进。`;
  }

  if (widget.kind === "feed" && widget.state.kind === "feed") {
    const refreshLabel = widget.state.lastSuccessAt
      ? formatWidgetDate(widget.state.lastSuccessAt)
      : "尚未刷新";
    return `${widget.state.entries.length} 条资讯条目，最近更新 ${refreshLabel}。`;
  }

  if (widget.kind === "artifact" && widget.state.kind === "artifact") {
    return widget.state.content
      ? widget.state.content.slice(0, 120)
      : "空文档，适合沉淀当前会话里的结论、规范或工作草稿。";
  }

  return "这个组件暂时没有可展示的摘要。";
}

function formatWidgetDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
