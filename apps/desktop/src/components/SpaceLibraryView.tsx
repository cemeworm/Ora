import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { ArchiveRestore, Box, Clock3, PackageCheck } from "lucide-react";
import { getSharedRuntimeClient, type OraWidget } from "../lib/runtimeClient";
import { cn } from "../lib/utils";

const STALE_MS = 14 * 24 * 60 * 60 * 1000;

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
      <div className="flex h-full items-center justify-center text-[13px] text-muted-foreground">
        正在读取组件库...
      </div>
    );
  }

  const now = Date.now();
  const activeWidgets = widgets.filter((widget) => widget.status === "active");
  const staleWidgets = activeWidgets.filter(
    (widget) =>
      now - widget.updatedAt > STALE_MS &&
      (!widget.schedule || widget.schedule.kind === "manual"),
  );
  const archivedWidgets = widgets.filter(
    (widget) => widget.status === "archived",
  );

  if (widgets.length === 0) {
    return (
      <div className="relative h-full min-h-0 overflow-hidden">
        <div className="flex h-full items-center justify-center px-4 pb-32 pt-2 sm:px-6 lg:px-7">
          <div className="text-center">
            <h2 className="text-[22px] font-semibold tracking-[-0.01em] text-foreground">
              还没有组件，先做一个吧
            </h2>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto px-4 pb-10 pt-2 sm:px-6 lg:px-7">
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <LibraryStat
          icon={<PackageCheck size={16} />}
          label="活跃组件"
          value={activeWidgets.length}
        />
        <LibraryStat
          icon={<Clock3 size={16} />}
          label="建议整理"
          value={staleWidgets.length}
        />
        <LibraryStat
          icon={<ArchiveRestore size={16} />}
          label="已归档"
          value={archivedWidgets.length}
        />
      </div>

      <div className="space-y-5">
        {staleWidgets.length > 0 && (
          <LibrarySection
            title="建议整理"
            hint="超过 14 天未更新且没有自动计划的组件。"
            widgets={staleWidgets}
            tone="attention"
            actionLabel="归档"
            onAction={async (widget) => {
              await client.archiveWidget(widget.id);
              void refresh();
            }}
          />
        )}

        <LibrarySection
          title="活跃组件"
          hint=""
          widgets={activeWidgets}
          tone="active"
          actionLabel="归档"
          onAction={async (widget) => {
            await client.archiveWidget(widget.id);
            void refresh();
          }}
        />

        {archivedWidgets.length > 0 && (
          <LibrarySection
            title="已归档"
            hint="从工作台移除但仍可恢复的组件资产。"
            widgets={archivedWidgets}
            tone="archived"
            actionLabel="恢复"
            onAction={async (widget) => {
              await client.restoreWidget(widget.id);
              void refresh();
            }}
          />
        )}
      </div>
    </div>
  );
}

function LibraryStat({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-md border border-border/70 bg-card/84 px-4 py-3 shadow-[0_8px_24px_rgba(23,23,23,0.035)]">
      <div className="flex items-center justify-between gap-3">
        <span className="flex h-8 w-8 items-center justify-center rounded-md bg-bench-100 text-bench-700">
          {icon}
        </span>
        <span className="text-[24px] font-semibold leading-none text-foreground">
          {value}
        </span>
      </div>
      <p className="mt-3 text-[12px] font-semibold text-muted-foreground">
        {label}
      </p>
    </div>
  );
}

function LibrarySection({
  title,
  hint,
  widgets,
  tone,
  actionLabel,
  onAction,
}: {
  title: string;
  hint: string;
  widgets: OraWidget[];
  tone: "active" | "attention" | "archived";
  actionLabel: string;
  onAction: (widget: OraWidget) => Promise<void>;
}) {
  return (
    <section>
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold text-foreground">{title}</h2>
          {hint && (
            <p className="mt-0.5 text-[12px] text-muted-foreground">{hint}</p>
          )}
        </div>
        <span className="shrink-0 text-[12px] font-medium text-muted-foreground">
          {widgets.length}
        </span>
      </div>
      {widgets.length === 0 ? (
        <div className="rounded-md border border-dashed border-bench-300 bg-card/58 px-4 py-6 text-[13px] text-muted-foreground">
          暂无{title}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
          {widgets.map((widget) => (
            <LibraryCard
              key={widget.id}
              widget={widget}
              tone={tone}
              actionLabel={actionLabel}
              onAction={() => onAction(widget)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function LibraryCard({
  widget,
  tone,
  actionLabel,
  onAction,
}: {
  widget: OraWidget;
  tone: "active" | "attention" | "archived";
  actionLabel: string;
  onAction: () => Promise<void>;
}) {
  return (
    <article
      className={cn(
        "rounded-md border bg-card/88 p-4 shadow-[0_10px_30px_rgba(23,23,23,0.045)]",
        tone === "attention" && "border-amber-200 bg-amber-50/45",
        tone === "archived" && "bg-card/55 opacity-80",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-2 flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-bench-100 text-bench-700">
              <Box size={14} />
            </span>
            <span className="rounded-full bg-bench-100 px-2 py-0.5 text-[11px] font-semibold text-bench-700">
              {kindLabel(widget.kind)}
            </span>
          </div>
          <h3 className="truncate text-[14px] font-semibold text-foreground">
            {widget.title}
          </h3>
          <p className="mt-2 text-[12px] text-muted-foreground">
            {widget.componentSkillId ? "已绑定组件 Skill" : "未绑定组件 Skill"}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void onAction()}
          className="shrink-0 rounded-md bg-bench-100 px-2.5 py-1.5 text-[12px] font-medium text-bench-700 transition hover:bg-foreground hover:text-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/15 active:scale-95"
        >
          {actionLabel}
        </button>
      </div>
      <div className="mt-4 flex items-center justify-between gap-3 border-t border-border/65 pt-3 text-[12px] text-muted-foreground">
        <span>{new Date(widget.updatedAt).toLocaleDateString()}</span>
        <span>
          {widget.schedule && widget.schedule.kind !== "manual"
            ? "自动计划"
            : "手动"}
        </span>
      </div>
    </article>
  );
}

function kindLabel(kind: OraWidget["kind"]): string {
  if (kind === "todo") return "待办";
  if (kind === "feed") return "资讯";
  return "文档";
}
