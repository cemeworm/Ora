import type { OraWidget } from "../lib/runtimeClient";
import { cn } from "../lib/utils";

interface WidgetCardProps {
  widget: OraWidget;
  selected: boolean;
  onSelect: () => void;
  onOpenDetail: () => void;
  onTogglePin: () => void;
  onArchive: () => void;
  onRefresh: () => void;
}

export function WidgetCard({ widget, selected, onSelect, onOpenDetail, onTogglePin, onArchive, onRefresh }: WidgetCardProps) {
  const isError = widget.status === "error";

  return (
    <div
      onClick={onSelect}
      className={cn(
        "relative rounded-lg border bg-card p-4 text-card-foreground shadow-sm transition cursor-pointer",
        "hover:shadow-md hover:border-primary/30",
        selected && "ring-2 ring-primary border-primary",
        isError && "border-destructive/50 bg-destructive/5",
      )}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1 min-w-0 flex-1">
          {widget.layout.pinned && (
            <span className="text-[10px] text-amber-500 shrink-0" title="已固定">◆</span>
          )}
          <h3 className="font-medium text-sm truncate">{widget.title}</h3>
        </div>
        <span
          className={cn(
            "text-[10px] px-1.5 py-0.5 rounded",
            widget.kind === "todo" && "bg-blue-100 text-blue-700",
            widget.kind === "feed" && "bg-green-100 text-green-700",
            widget.kind === "artifact" && "bg-purple-100 text-purple-700",
          )}
        >
          {widget.kind === "todo" ? "待办" : widget.kind === "feed" ? "资讯" : "文档"}
        </span>
      </div>

      {/* Widget-specific summary */}
      <div className="text-xs text-muted-foreground mb-3">
        {widget.kind === "todo" && widget.state.kind === "todo" && (
          <span>
            {widget.state.items.filter((i: { completedAt?: number }) => i.completedAt).length}/
            {widget.state.items.length} 完成
          </span>
        )}
        {widget.kind === "feed" && widget.state.kind === "feed" && (
          <span>
            {widget.state.entries.length} 条目
            {widget.state.lastSuccessAt
              ? ` · ${new Date(widget.state.lastSuccessAt).toLocaleDateString()}`
              : " · 未刷新"}
          </span>
        )}
        {widget.kind === "artifact" && widget.state.kind === "artifact" && (
          <span>{widget.state.content ? `${widget.state.content.slice(0, 80)}...` : "空文档"}</span>
        )}
      </div>

      {/* Status indicators */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          {widget.schedule && widget.schedule.kind !== "manual" && (
            <span className="text-[10px] text-muted-foreground/70">定时</span>
          )}
          {widget.componentSkillId && (
            <span className="text-[10px] text-muted-foreground/70">已沉淀</span>
          )}
        </div>
        <div className="flex gap-1">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onTogglePin();
            }}
            className="text-[10px] px-1.5 py-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition"
            title={widget.layout.pinned ? "取消固定" : "固定"}
          >
            {widget.layout.pinned ? "取消固定" : "固定"}
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onOpenDetail();
            }}
            className="text-[10px] px-1.5 py-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition"
            title="详情"
          >
            详情
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onRefresh();
            }}
            className="text-[10px] px-1.5 py-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition"
            title="刷新"
          >
            刷新
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onArchive();
            }}
            className="text-[10px] px-1.5 py-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition"
            title="归档"
          >
            归档
          </button>
        </div>
      </div>
    </div>
  );
}
