import { useState, useCallback } from "react";
import { getSharedRuntimeClient } from "../lib/runtimeClient";
import { cn } from "../lib/utils";

interface SpaceComposerProps {
  scope: "space" | "widget";
  selectedWidgetId?: string;
  onWidgetCreated: () => void;
}

export function SpaceComposer({ scope, selectedWidgetId, onWidgetCreated }: SpaceComposerProps) {
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const client = getSharedRuntimeClient();

  const handleSubmit = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || running) return;

    setRunning(true);
    setInput("");

    try {
      // Simplified: parse intent from natural language
      // Full implementation in Phase 3 with component-builder Skill
      if (scope === "space") {
        // Space-level: try to create a widget if it sounds like a creation intent
        if (
          trimmed.includes("创建") ||
          trimmed.includes("添加") ||
          trimmed.includes("新建") ||
          trimmed.includes("做一个") ||
          trimmed.includes("加一个")
        ) {
          let kind: "todo" | "feed" | "artifact" = "todo";
          if (trimmed.includes("资讯") || trimmed.includes("热点") || trimmed.includes("新闻") || trimmed.includes("监控")) {
            kind = "feed";
          } else if (trimmed.includes("文档") || trimmed.includes("文章") || trimmed.includes("沉淀") || trimmed.includes("总结")) {
            kind = "artifact";
          }

          await client.createWidget({
            title: trimmed.slice(0, 60),
            kind,
          });
          onWidgetCreated();
        }
      } else if (scope === "widget" && selectedWidgetId) {
        // Widget-level: update the selected widget
        try {
          await client.updateWidget({
            id: selectedWidgetId,
            title: trimmed.slice(0, 60),
          });
          onWidgetCreated();
        } catch {
          // Widget might not exist, ignore
        }
      }
    } catch (err) {
      console.error("SpaceComposer submit error", err);
    } finally {
      setRunning(false);
    }
  }, [input, running, scope, selectedWidgetId, client, onWidgetCreated]);

  const scopeLabel =
    scope === "widget" && selectedWidgetId
      ? "正在编辑组件"
      : "空间";

  return (
    <div className="shrink-0 border-t bg-background px-4 py-3">
      <div className="flex flex-col gap-1.5 max-w-3xl mx-auto">
        {/* Scope chip */}
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "text-[11px] px-2 py-0.5 rounded-full font-medium",
              scope === "widget"
                ? "bg-primary/10 text-primary"
                : "bg-muted text-muted-foreground",
            )}
          >
            {scopeLabel}
          </span>
          {running && (
            <span className="text-[11px] text-muted-foreground animate-pulse">
              处理中...
            </span>
          )}
        </div>

        {/* Input area */}
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void handleSubmit();
              }
            }}
            placeholder={
              scope === "widget"
                ? "修改这个组件..."
                : '对空间说点什么，比如“创建一个待办事项”...'
            }
            disabled={running}
            className="flex-1 h-9 px-3 rounded-md border bg-background text-sm placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
          />
          <button
            onClick={() => void handleSubmit()}
            disabled={!input.trim() || running}
            className="h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-medium transition hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            发送
          </button>
        </div>
      </div>
    </div>
  );
}
