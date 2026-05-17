import { useState, useCallback } from "react";
import { getSharedRuntimeClient, type OraWidget } from "../lib/runtimeClient";
import { cn } from "../lib/utils";

interface TodoWidgetDetailProps {
  widget: OraWidget;
  onClose: () => void;
  onUpdated: () => void;
}

export function TodoWidgetDetail({ widget, onClose, onUpdated }: TodoWidgetDetailProps) {
  const client = getSharedRuntimeClient();
  const [newTitle, setNewTitle] = useState("");
  const [editingId, setEditingId] = useState<string | undefined>();
  const [editTitle, setEditTitle] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editDueDate, setEditDueDate] = useState("");

  const state = widget.state.kind === "todo" ? widget.state : null;
  const items = state?.items ?? [];

  const saveItems = useCallback(
    async (nextItems: typeof items) => {
      try {
        await client.updateWidget({
          id: widget.id,
          state: { kind: "todo" as const, items: nextItems, lastRefreshedAt: Date.now(), lastError: undefined, consecutiveFailures: 0 },
        });
        onUpdated();
      } catch (err) {
        console.error("Failed to update todo items", err);
      }
    },
    [client, widget.id, onUpdated],
  );

  const handleAdd = useCallback(async () => {
    const title = newTitle.trim();
    if (!title) return;
    const now = Date.now();
    const nextItems = [
      ...items,
      { id: crypto.randomUUID(), title, notes: "", createdAt: now, updatedAt: now },
    ];
    await saveItems(nextItems);
    setNewTitle("");
  }, [newTitle, items, saveItems]);

  const handleComplete = useCallback(
    async (itemId: string) => {
      const now = Date.now();
      const nextItems = items.map((item) =>
        item.id === itemId ? { ...item, completedAt: item.completedAt ? undefined : now, updatedAt: now } : item,
      );
      await saveItems(nextItems);
    },
    [items, saveItems],
  );

  const handleDelete = useCallback(
    async (itemId: string) => {
      await saveItems(items.filter((item) => item.id !== itemId));
    },
    [items, saveItems],
  );

  const startEdit = (item: (typeof items)[0]) => {
    setEditingId(item.id);
    setEditTitle(item.title);
    setEditNotes(item.notes ?? "");
    setEditDueDate(item.dueDate ? new Date(item.dueDate).toISOString().slice(0, 16) : "");
  };

  const handleSaveEdit = useCallback(async () => {
    if (!editingId) return;
    const now = Date.now();
    const nextItems = items.map((item) =>
      item.id === editingId
        ? {
            ...item,
            title: editTitle.trim() || item.title,
            notes: editNotes,
            dueDate: editDueDate ? new Date(editDueDate).getTime() : undefined,
            updatedAt: now,
          }
        : item,
    );
    await saveItems(nextItems);
    setEditingId(undefined);
  }, [editingId, editTitle, editNotes, editDueDate, items, saveItems]);

  const handleSetReminder = useCallback(
    async (item: (typeof items)[0]) => {
      const dueDate = item.dueDate;
      if (!dueDate) return;

      try {
        await client.createAutomation({
          title: `Reminder: ${item.title}`,
          prompt: `提醒：待办事项「${item.title}」已到期。`,
          schedule: { kind: "once", at: dueDate, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
          status: "active",
          modeSelection: "manual",
          taskIntent: "chat",
          skillIds: [],
          toolIds: [],
          runConfig: {},
        });
      } catch (err) {
        console.error("Failed to create reminder", err);
      }
    },
    [client],
  );

  const activeItems = items.filter((i) => !i.completedAt);
  const completedItems = items.filter((i) => i.completedAt);

  return (
    <div className="flex h-full flex-col bg-background">
      <header className="flex shrink-0 items-center justify-between border-b px-6 py-4">
        <div>
          <h1 className="text-lg font-serif text-primary">{widget.title}</h1>
          <p className="text-xs text-muted-foreground">
            {activeItems.length} 待办 · {completedItems.length} 已完成
          </p>
        </div>
        <button
          onClick={onClose}
          className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition"
        >
          返回
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {/* Add new item */}
        <div className="flex items-center gap-2 mb-6">
          <input
            type="text"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleAdd();
            }}
            placeholder="添加待办事项..."
            className="flex-1 h-9 px-3 rounded-md border bg-background text-sm placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <button
            onClick={() => void handleAdd()}
            disabled={!newTitle.trim()}
            className="h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-medium transition hover:bg-primary/90 disabled:opacity-50"
          >
            添加
          </button>
        </div>

        {/* Active items */}
        {activeItems.length === 0 && completedItems.length === 0 ? (
          <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
            暂无待办事项，在上方输入框添加一个吧。
          </div>
        ) : (
          <div className="space-y-1">
            {activeItems.map((item) => (
              <div
                key={item.id}
                className={cn(
                  "rounded-lg border p-3 transition",
                  editingId === item.id ? "border-primary/50 bg-accent/30" : "border-transparent hover:bg-accent/20",
                )}
              >
                {editingId === item.id ? (
                  <div className="space-y-2">
                    <input
                      type="text"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      className="w-full h-8 px-2 rounded border bg-background text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                    <textarea
                      value={editNotes}
                      onChange={(e) => setEditNotes(e.target.value)}
                      placeholder="备注..."
                      rows={2}
                      className="w-full px-2 py-1 rounded border bg-background text-xs focus:outline-none focus:ring-1 focus:ring-primary resize-none"
                    />
                    <input
                      type="datetime-local"
                      value={editDueDate}
                      onChange={(e) => setEditDueDate(e.target.value)}
                      className="h-8 px-2 rounded border bg-background text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => void handleSaveEdit()}
                        className="h-7 px-3 rounded bg-primary text-primary-foreground text-xs font-medium"
                      >
                        保存
                      </button>
                      <button
                        onClick={() => setEditingId(undefined)}
                        className="h-7 px-3 rounded border text-xs text-muted-foreground hover:text-foreground"
                      >
                        取消
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start gap-3">
                    <button
                      onClick={() => void handleComplete(item.id)}
                      className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-muted-foreground/40 hover:border-primary transition"
                    >
                      <div className="h-2 w-2 rounded-full bg-transparent" />
                    </button>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm">{item.title}</span>
                        {item.dueDate && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                            {new Date(item.dueDate).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                      {item.notes && (
                        <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{item.notes}</p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {item.dueDate && !item.reminderAt && (
                        <button
                          onClick={() => void handleSetReminder(item)}
                          className="text-[10px] px-1.5 py-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition"
                          title="设置提醒"
                        >
                          提醒
                        </button>
                      )}
                      {item.reminderAt && (
                        <span className="text-[10px] text-green-600">已提醒</span>
                      )}
                      <button
                        onClick={() => startEdit(item)}
                        className="text-[10px] px-1.5 py-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition"
                      >
                        编辑
                      </button>
                      <button
                        onClick={() => void handleDelete(item.id)}
                        className="text-[10px] px-1.5 py-0.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition"
                      >
                        删除
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}

            {/* Completed items */}
            {completedItems.length > 0 && (
              <div className="pt-4">
                <h3 className="text-xs font-medium text-muted-foreground mb-2">
                  已完成 ({completedItems.length})
                </h3>
                <div className="space-y-1">
                  {completedItems.map((item) => (
                    <div
                      key={item.id}
                      className="rounded-lg border border-transparent p-3 opacity-60 hover:opacity-80 transition"
                    >
                      <div className="flex items-start gap-3">
                        <button
                          onClick={() => void handleComplete(item.id)}
                          className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-green-500 bg-green-500 transition"
                        >
                          <svg className="h-3 w-3 text-white" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                        </button>
                        <div className="min-w-0 flex-1">
                          <span className="text-sm line-through text-muted-foreground">{item.title}</span>
                          {item.completedAt && (
                            <span className="ml-2 text-[10px] text-muted-foreground/70">
                              {new Date(item.completedAt).toLocaleDateString()}
                            </span>
                          )}
                        </div>
                        <button
                          onClick={() => void handleDelete(item.id)}
                          className="text-[10px] px-1.5 py-0.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition"
                        >
                          删除
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
