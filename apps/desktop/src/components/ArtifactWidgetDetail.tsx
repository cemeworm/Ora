import { useState, useCallback, useMemo } from "react";
import { getSharedRuntimeClient, type OraWidget } from "../lib/runtimeClient";
import { cn } from "../lib/utils";

interface ArtifactWidgetDetailProps {
  widget: OraWidget;
  onClose: () => void;
  onUpdated: () => void;
}

export function ArtifactWidgetDetail({ widget, onClose, onUpdated }: ArtifactWidgetDetailProps) {
  const client = getSharedRuntimeClient();
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [editTitle, setEditTitle] = useState("");
  const [showVersions, setShowVersions] = useState(false);

  const state = widget.state.kind === "artifact" ? widget.state : null;
  const versions = state?.versions ?? [];

  const startEdit = useCallback(() => {
    setEditTitle(state?.title ?? widget.title);
    setEditContent(state?.content ?? "");
    setEditing(true);
  }, [state]);

  const handleSave = useCallback(async () => {
    if (!state) return;
    const now = Date.now();
    const newVersion = {
      content: editContent,
      createdAt: now,
      note: "手动编辑",
    };
    try {
      await client.updateWidget({
        id: widget.id,
        title: editTitle || widget.title,
        state: {
          kind: "artifact" as const,
          title: editTitle || state.title,
          content: editContent,
          format: state.format,
          versions: [...versions, newVersion],
          sourceSessionId: state.sourceSessionId,
          sourceRunId: state.sourceRunId,
          lastRefreshedAt: now,
          lastError: undefined,
          consecutiveFailures: 0,
        },
      });
      setEditing(false);
      onUpdated();
    } catch (err) {
      console.error("Failed to save artifact", err);
    }
  }, [editContent, editTitle, state, versions, client, widget.id, onUpdated]);

  const handleFormatSwitch = useCallback(
    async (format: "markdown" | "text" | "json") => {
      if (!state || format === state.format) return;
      try {
        await client.updateWidget({
          id: widget.id,
          state: { ...state, format },
        });
        onUpdated();
      } catch (err) {
        console.error("Failed to switch format", err);
      }
    },
    [state, client, widget.id, onUpdated],
  );

  const handleRestoreVersion = useCallback(
    async (version: (typeof versions)[0]) => {
      if (!state) return;
      try {
        await client.updateWidget({
          id: widget.id,
          state: { ...state, content: version.content },
        });
        onUpdated();
      } catch (err) {
        console.error("Failed to restore version", err);
      }
    },
    [state, client, widget.id, onUpdated],
  );

  const formatLabel = (f: string) => {
    switch (f) {
      case "markdown": return "Markdown";
      case "text": return "纯文本";
      case "json": return "JSON";
      default: return f;
    }
  };

  if (showVersions) {
    return (
      <div className="flex h-full flex-col bg-background">
        <header className="flex shrink-0 items-center justify-between border-b px-6 py-4">
          <div>
            <h1 className="text-lg font-serif text-primary">版本历史</h1>
            <p className="text-xs text-muted-foreground">{widget.title}</p>
          </div>
          <button
            onClick={() => setShowVersions(false)}
            className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition"
          >
            返回文档
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {versions.length === 0 ? (
            <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
              暂无版本记录。编辑并保存内容后将自动记录版本。
            </div>
          ) : (
            <div className="space-y-3">
              {[...versions].reverse().map((v, idx) => (
                <div
                  key={idx}
                  className="rounded-lg border bg-card p-4 text-card-foreground shadow-sm"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium text-muted-foreground">
                      版本 {versions.length - idx}
                    </span>
                    <span className="text-[10px] text-muted-foreground/70">
                      {new Date(v.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mb-2">{v.note || "无备注"}</p>
                  <pre className="text-xs bg-muted/50 rounded p-3 max-h-48 overflow-auto whitespace-pre-wrap">
                    {v.content.slice(0, 500)}{v.content.length > 500 ? "..." : ""}
                  </pre>
                  <button
                    onClick={() => void handleRestoreVersion(v)}
                    className="mt-2 text-[10px] px-2 py-1 rounded border text-muted-foreground hover:text-foreground hover:bg-muted transition"
                  >
                    恢复此版本
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-background">
      <header className="flex shrink-0 items-center justify-between border-b px-6 py-4">
        <div>
          <h1 className="text-lg font-serif text-primary">{state?.title ?? widget.title}</h1>
          <div className="flex items-center gap-2 mt-1">
            <p className="text-xs text-muted-foreground">
              {state?.content ? `${state.content.length} 字符` : "空文档"}
              {state?.sourceSessionId ? " · 来自对话" : ""}
            </p>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
              {formatLabel(state?.format ?? "text")}
            </span>
          </div>
        </div>
        <button
          onClick={onClose}
          className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition"
        >
          返回
        </button>
      </header>

      {/* Toolbar */}
      <div className="flex shrink-0 items-center gap-2 border-b px-6 py-2">
        {!editing ? (
          <>
            <button
              onClick={startEdit}
              className="h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition"
            >
              编辑
            </button>
            <button
              onClick={() => setShowVersions(true)}
              className="h-8 px-3 rounded-md border text-xs text-muted-foreground hover:text-foreground transition"
            >
              版本 ({versions.length})
            </button>
            <div className="flex items-center gap-1 ml-2">
              {(["markdown", "text", "json"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => handleFormatSwitch(f)}
                  className={cn(
                    "text-[10px] px-2 py-1 rounded transition",
                    state?.format === f
                      ? "bg-primary/10 text-primary font-medium"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted",
                  )}
                >
                  {formatLabel(f)}
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <button
              onClick={() => void handleSave()}
              className="h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition"
            >
              保存
            </button>
            <button
              onClick={() => setEditing(false)}
              className="h-8 px-3 rounded-md border text-xs text-muted-foreground hover:text-foreground transition"
            >
              取消
            </button>
          </>
        )}
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-y-auto">
        {editing ? (
          <div className="flex flex-col h-full">
            <div className="px-6 py-3 border-b">
              <input
                type="text"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                placeholder="文档标题..."
                className="w-full h-8 px-2 rounded border bg-background text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <textarea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              placeholder="开始编写内容..."
              className="flex-1 w-full resize-none px-6 py-4 text-sm bg-background focus:outline-none font-mono"
            />
          </div>
        ) : (
          <div className="p-6">
            {state?.content ? (
              <article className="prose prose-sm max-w-none">
                {state.format === "markdown" ? (
                  <pre className="text-sm whitespace-pre-wrap font-sans bg-transparent p-0">
                    {state.content}
                  </pre>
                ) : state.format === "json" ? (
                  <pre className="text-xs bg-muted/30 rounded-lg p-4 overflow-auto max-h-[70vh]">
                    {(() => {
                      try {
                        return JSON.stringify(JSON.parse(state.content), null, 2);
                      } catch {
                        return state.content;
                      }
                    })()}
                  </pre>
                ) : (
                  <pre className="text-sm whitespace-pre-wrap font-sans bg-transparent p-0">
                    {state.content}
                  </pre>
                )}
              </article>
            ) : (
              <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
                空白文档，点击"编辑"开始编写内容。
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
