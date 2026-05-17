import { useState, useEffect, useCallback } from "react";
import { getSharedRuntimeClient, type OraWidget } from "../lib/runtimeClient";

export function SpaceLibraryView() {
  const [widgets, setWidgets] = useState<OraWidget[]>([]);
  const [loading, setLoading] = useState(true);
  const client = getSharedRuntimeClient();

  const refresh = useCallback(async () => {
    try {
      const list = await client.listWidgets({ includeArchived: true });
      setWidgets(list);
    } catch (err) {
      console.error("Failed to load widgets for library", err);
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        加载中...
      </div>
    );
  }

  if (widgets.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="max-w-md text-center">
          <h1 className="text-2xl font-serif text-primary mb-2">组件库</h1>
          <p className="text-sm text-muted-foreground mb-6">
            你创建和沉淀的组件都将出现在这里。在工作台用自然语言创建第一个组件吧。
          </p>
        </div>
      </div>
    );
  }

  const now = Date.now();
  const STALE_MS = 14 * 24 * 60 * 60 * 1000;
  const activeWidgets = widgets.filter((w) => w.status === "active");
  const staleWidgets = activeWidgets.filter(
    (w) => now - w.updatedAt > STALE_MS && (!w.schedule || w.schedule.kind === "manual"),
  );
  const archivedWidgets = widgets.filter((w) => w.status === "archived");

  return (
    <div className="flex h-full flex-col overflow-y-auto p-6">
      <h1 className="text-2xl font-serif text-primary mb-6">组件库</h1>

      {staleWidgets.length > 0 && (
        <section className="mb-8">
          <h2 className="text-sm font-medium text-muted-foreground mb-3">
            建议整理 ({staleWidgets.length})
          </h2>
          <p className="text-xs text-muted-foreground/70 mb-3">
            以下组件超过 14 天未更新且无定时任务，建议归档或刷新。
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {staleWidgets.map((widget) => (
              <div
                key={widget.id}
                className="rounded-lg border border-amber-200 bg-amber-50/50 p-4 shadow-sm"
              >
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-medium text-sm">{widget.title}</h3>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">
                    陈旧
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mb-3">
                  上次更新：{new Date(widget.updatedAt).toLocaleDateString()}
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={async () => {
                      await client.archiveWidget(widget.id);
                      void refresh();
                    }}
                    className="text-xs text-muted-foreground hover:text-foreground transition"
                  >
                    归档
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {activeWidgets.length > 0 && (
        <section className="mb-8">
          <h2 className="text-sm font-medium text-muted-foreground mb-3">
            活跃组件 ({activeWidgets.length})
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {activeWidgets.map((widget) => (
              <div
                key={widget.id}
                className="rounded-lg border bg-card p-4 text-card-foreground shadow-sm"
              >
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-medium text-sm">{widget.title}</h3>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                    {widget.kind}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mb-3">
                  {widget.componentSkillId
                    ? "已绑定组件 Skill"
                    : "未绑定组件 Skill"}
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={async () => {
                      await client.archiveWidget(widget.id);
                      void refresh();
                    }}
                    className="text-xs text-muted-foreground hover:text-foreground transition"
                  >
                    归档
                  </button>
                  {widget.status === "archived" && (
                    <button
                      onClick={async () => {
                        await client.restoreWidget(widget.id);
                        void refresh();
                      }}
                      className="text-xs text-muted-foreground hover:text-foreground transition"
                    >
                      恢复
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {archivedWidgets.length > 0 && (
        <section>
          <h2 className="text-sm font-medium text-muted-foreground mb-3">
            已归档 ({archivedWidgets.length})
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {archivedWidgets.map((widget) => (
              <div
                key={widget.id}
                className="rounded-lg border bg-card/50 p-4 text-card-foreground shadow-sm opacity-75"
              >
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-medium text-sm">{widget.title}</h3>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                    {widget.kind}
                  </span>
                </div>
                <button
                  onClick={async () => {
                    await client.restoreWidget(widget.id);
                    void refresh();
                  }}
                  className="text-xs text-muted-foreground hover:text-foreground transition"
                >
                  恢复
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
