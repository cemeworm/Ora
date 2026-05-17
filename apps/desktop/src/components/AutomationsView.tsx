import { Bot, CalendarClock, Clock, Folder, Pause, Play, Plus, RefreshCcw, Save, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode, SelectHTMLAttributes } from "react";
import { useWorkbench } from "../lib/state";
import type {
  OraAgentCatalogResult,
  OraAutomation,
  OraAutomationCreateParams,
  OraAutomationSchedule,
  RuntimeClient,
} from "../lib/runtimeClient";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";
import { Dialog, DialogContent } from "./ui/dialog";
import { Input } from "./ui/input";
import { PageHeader } from "./PageHeader";
import { Select } from "./ui/select";
import { Textarea } from "./ui/textarea";

type SchedulePreset = "once" | "hourly" | "daily" | "weekly" | "monthly";
type AutomationDialogMode = "create" | "edit";

interface AutomationDraft {
  title: string;
  prompt: string;
  preset: SchedulePreset;
  time: string;
  interval: number;
  weekday: string;
  monthDay: number;
  projectId: string;
  customAgentId: string;
  modeId: string;
  providerId: string;
  taskIntent: "chat" | "plan" | "implement";
}

const WEEKDAY_OPTIONS = [
  ["MO", "Monday"],
  ["TU", "Tuesday"],
  ["WE", "Wednesday"],
  ["TH", "Thursday"],
  ["FR", "Friday"],
  ["SA", "Saturday"],
  ["SU", "Sunday"],
] as const;

const EMPTY_DRAFT: AutomationDraft = {
  title: "",
  prompt: "",
  preset: "daily",
  time: "09:00",
  interval: 1,
  weekday: "MO",
  monthDay: 1,
  projectId: "",
  customAgentId: "",
  modeId: "",
  providerId: "",
  taskIntent: "implement",
};

export function AutomationsView({ runtimeClient }: { runtimeClient: RuntimeClient }) {
  const { state, dispatch } = useWorkbench();
  const [automations, setAutomations] = useState<OraAutomation[]>([]);
  const [catalog, setCatalog] = useState<OraAgentCatalogResult>({ systemAgents: [], customAgents: [] });
  const [selectedId, setSelectedId] = useState<string>();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<AutomationDialogMode>("create");
  const [draft, setDraft] = useState<AutomationDraft>(EMPTY_DRAFT);
  const [editingId, setEditingId] = useState<string>();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const activeAutomations = automations.filter((automation) => automation.status === "active");
  const pausedAutomations = automations.filter((automation) => automation.status === "paused");
  const editingAutomation = editingId ? automations.find((automation) => automation.id === editingId) : undefined;
  const agentOptions = useMemo(() => [
    ...catalog.systemAgents.map((agent) => ({ id: agent.id, label: agent.label })),
    ...catalog.customAgents.map((agent) => ({ id: agent.name, label: agent.name })),
  ], [catalog]);

  async function refresh(nextSelectedId?: string | null) {
    const [nextAutomations, nextCatalog] = await Promise.all([
      runtimeClient.listAutomations({ includePaused: true }),
      runtimeClient.agentCatalog(),
    ]);
    setAutomations(nextAutomations);
    setCatalog(nextCatalog);
    if (nextSelectedId) {
      setSelectedId(nextSelectedId);
    } else if (nextSelectedId === null) {
      setSelectedId(undefined);
    } else if (!selectedId && nextAutomations[0]) {
      setSelectedId(nextAutomations[0].id);
    }
  }

  useEffect(() => {
    void refresh().catch((nextError) => {
      setError(nextError instanceof Error ? nextError.message : "自动化加载失败。");
    });
  }, [runtimeClient]);

  function startCreate() {
    setDialogMode("create");
    setEditingId(undefined);
    setDraft(EMPTY_DRAFT);
    setError("");
    setDialogOpen(true);
  }

  function startEdit(automation: OraAutomation) {
    setDialogMode("edit");
    setEditingId(automation.id);
    setDraft(draftFromAutomation(automation));
    setSelectedId(automation.id);
    setError("");
    setDialogOpen(true);
  }

  function closeDialog() {
    if (busy) return;
    setDialogOpen(false);
    setError("");
  }

  async function saveDraft() {
    const existing = editingId ? automations.find((automation) => automation.id === editingId) : undefined;
    const payload: OraAutomationCreateParams = {
      title: draft.title.trim(),
      prompt: draft.prompt.trim(),
      schedule: scheduleFromDraft(draft),
      status: existing?.status ?? "active",
      projectId: draft.projectId || undefined,
      customAgentId: draft.customAgentId || undefined,
      modeId: draft.modeId || undefined,
      modeSelection: "manual",
      providerId: draft.providerId || undefined,
      taskIntent: draft.taskIntent,
      skillIds: [],
      toolIds: [],
      runConfig: {},
    };
    if (!payload.title || !payload.prompt) {
      setError("请填写标题和提示词。");
      return;
    }
    setBusy("save");
    setError("");
    try {
      const saved = editingId
        ? await runtimeClient.updateAutomation({ ...payload, id: editingId })
        : await runtimeClient.createAutomation(payload);
      dispatch({ type: "SET_COMMAND_FEEDBACK", feedback: `自动化“${saved.title}”已保存。` });
      await refresh(saved.id);
      setEditingId(saved.id);
      setDialogOpen(false);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "自动化保存失败。");
    } finally {
      setBusy("");
    }
  }

  async function runAction(action: string, automationId: string, fn: () => Promise<unknown>) {
    setBusy(action);
    setError("");
    try {
      await fn();
      await refresh(action === "delete" ? null : automationId);
      if (action === "delete") {
        setDialogOpen(false);
        setEditingId(undefined);
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "自动化操作失败。");
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col bg-transparent">
      <PageHeader
        title="自动化"
        actions={(
          <button
            onClick={startCreate}
            disabled={busy.length > 0}
            className="inline-flex h-10 items-center gap-2 rounded-md bg-bench-900 px-4 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus size={16} />
            新建自动化功能
          </button>
        )}
      />

      <main className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto w-full max-w-[760px]">
          {error && !dialogOpen && (
            <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {error}
            </div>
          )}

          <div className="space-y-8">
            <AutomationGroup
              title="运行中"
              automations={activeAutomations}
              selectedId={selectedId}
              agentOptions={agentOptions}
              projectLabelFor={(projectId) => projectLabelFor(state.projects, projectId)}
              onSelect={(automation) => startEdit(automation)}
            />
            <AutomationGroup
              title="已暂停"
              automations={pausedAutomations}
              selectedId={selectedId}
              agentOptions={agentOptions}
              projectLabelFor={(projectId) => projectLabelFor(state.projects, projectId)}
              onSelect={(automation) => startEdit(automation)}
            />
            {automations.length === 0 && (
              <div className="border-t border-border/75 py-6 text-sm text-muted-foreground">
                暂无自动化。
              </div>
            )}
          </div>
        </div>
      </main>

      <Dialog open={dialogOpen} onOpenChange={(open) => {
        if (!open) closeDialog();
      }}>
        <DialogContent className="flex h-[min(76vh,430px)] w-[min(760px,calc(100vw-2rem))] flex-col overflow-hidden rounded-[18px] border border-black/[0.04] bg-card p-0 shadow-lift">
          <div className="flex items-center gap-3 px-5 pt-5">
            <Input
              value={draft.title}
              onChange={(event) => setDraft({ ...draft, title: event.target.value })}
              placeholder="自动化功能标题"
              className="h-8 border-0 bg-transparent px-0 py-0 text-[15px] font-medium shadow-none focus-visible:ring-0"
            />
            <button
              type="button"
              className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground"
              title="模板暂未接入"
              disabled
            >
              <CalendarClock size={14} />
            </button>
            <Button variant="outline" size="sm" disabled className="h-7 rounded-lg px-2 text-xs">
              使用模板
            </Button>
            <button
              type="button"
              onClick={closeDialog}
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground active:scale-95"
              aria-label="关闭"
            >
              <X size={15} />
            </button>
          </div>

          <div className="min-h-0 flex-1 px-5">
            <Textarea
              value={draft.prompt}
              onChange={(event) => setDraft({ ...draft, prompt: event.target.value })}
              placeholder="添加提示词，例如：每天整理项目进展"
              className="h-full min-h-[190px] resize-none border-0 bg-transparent px-0 py-4 text-sm shadow-none focus-visible:ring-0"
            />
          </div>

          <div className="border-t border-border/60 px-5 py-4">
            {error && (
              <div className="mb-3 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {error}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <CompactSelect
                icon={<Bot size={13} />}
                value={draft.taskIntent}
                onChange={(event) => setDraft({ ...draft, taskIntent: event.target.value as AutomationDraft["taskIntent"] })}
              >
                <option value="implement">工作树</option>
                <option value="plan">计划</option>
                <option value="chat">对话</option>
              </CompactSelect>
              <CompactSelect
                icon={<Folder size={13} />}
                value={draft.projectId}
                onChange={(event) => setDraft({ ...draft, projectId: event.target.value })}
              >
                <option value="">选择项目</option>
                {state.projects.map((project) => (
                  <option key={project.projectId} value={project.projectId}>{project.label}</option>
                ))}
              </CompactSelect>
              <CompactSelect
                icon={<Clock size={13} />}
                value={draft.preset}
                onChange={(event) => setDraft({ ...draft, preset: event.target.value as SchedulePreset })}
              >
                <option value="once">一次</option>
                <option value="hourly">每 N 小时</option>
                <option value="daily">每天 {draft.time}</option>
                <option value="weekly">每周</option>
                <option value="monthly">每月</option>
              </CompactSelect>
              <Input
                type="time"
                value={draft.time}
                onChange={(event) => setDraft({ ...draft, time: event.target.value })}
                className="h-8 w-[92px] rounded-lg border-0 bg-transparent px-2 text-xs shadow-none hover:bg-muted/60 focus-visible:ring-1"
              />
              <CompactSelect
                value={draft.customAgentId}
                onChange={(event) => setDraft({ ...draft, customAgentId: event.target.value })}
              >
                <option value="">默认智能体</option>
                {agentOptions.map((agent) => (
                  <option key={agent.id} value={agent.id}>{agent.label}</option>
                ))}
              </CompactSelect>
              <CompactSelect
                value={draft.modeId}
                onChange={(event) => setDraft({ ...draft, modeId: event.target.value })}
              >
                <option value="">默认模式</option>
                {state.modes.filter((mode) => mode.visibility !== "internal").map((mode) => (
                  <option key={mode.id} value={mode.id}>{mode.label}</option>
                ))}
              </CompactSelect>
              <CompactSelect
                value={draft.providerId}
                onChange={(event) => setDraft({ ...draft, providerId: event.target.value })}
              >
                <option value="">默认提供商</option>
                {(state.providerRegistry?.providers ?? []).map((provider) => (
                  <option key={provider.id} value={provider.id}>{provider.label}</option>
                ))}
              </CompactSelect>
              <Input
                type="number"
                min={1}
                max={24}
                value={draft.interval}
                onChange={(event) => setDraft({ ...draft, interval: Number(event.target.value) || 1 })}
                className="h-8 w-[64px] rounded-lg border-0 bg-transparent px-2 text-xs shadow-none hover:bg-muted/60 focus-visible:ring-1"
                aria-label="间隔"
              />
              <CompactSelect
                value={draft.weekday}
                disabled={draft.preset !== "weekly"}
                onChange={(event) => setDraft({ ...draft, weekday: event.target.value })}
              >
                {WEEKDAY_OPTIONS.map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </CompactSelect>
              <Input
                type="number"
                min={1}
                max={31}
                disabled={draft.preset !== "monthly"}
                value={draft.monthDay}
                onChange={(event) => setDraft({ ...draft, monthDay: Number(event.target.value) || 1 })}
                className="h-8 w-[64px] rounded-lg border-0 bg-transparent px-2 text-xs shadow-none hover:bg-muted/60 focus-visible:ring-1"
                aria-label="每月日期"
              />
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                {editingAutomation && (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void runAction("run", editingAutomation.id, () => runtimeClient.runAutomationNow(editingAutomation.id))}
                      disabled={busy === "run"}
                      className="h-8 px-2 text-xs"
                    >
                      <RefreshCcw size={13} />
                      立即运行
                    </Button>
                    {editingAutomation.status === "active" ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void runAction("pause", editingAutomation.id, () => runtimeClient.pauseAutomation(editingAutomation.id))}
                        disabled={busy === "pause"}
                        className="h-8 px-2 text-xs"
                      >
                        <Pause size={13} />
                        暂停
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void runAction("resume", editingAutomation.id, () => runtimeClient.resumeAutomation(editingAutomation.id))}
                        disabled={busy === "resume"}
                        className="h-8 px-2 text-xs"
                      >
                        <Play size={13} />
                        恢复
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => void runAction("delete", editingAutomation.id, () => runtimeClient.deleteAutomation(editingAutomation.id))}
                      disabled={busy === "delete"}
                      title="删除自动化"
                    >
                      <Trash2 size={14} />
                    </Button>
                  </>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={closeDialog} disabled={Boolean(busy)}>
                  取消
                </Button>
                <Button onClick={() => void saveDraft()} disabled={busy === "save"} className="h-8 rounded-lg px-3 text-xs">
                  <Save size={13} />
                  {dialogMode === "create" ? "创建" : "保存"}
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AutomationGroup({ title, automations, selectedId, agentOptions, projectLabelFor, onSelect }: {
  title: string;
  automations: OraAutomation[];
  selectedId?: string;
  agentOptions: Array<{ id: string; label: string }>;
  projectLabelFor: (projectId: string | undefined) => string | undefined;
  onSelect: (automation: OraAutomation) => void;
}) {
  if (automations.length === 0) return null;
  return (
    <section>
      <div className="border-b border-border/75 pb-3 text-[15px] font-semibold text-foreground">{title}</div>
      <div className="pt-3">
        {automations.map((automation) => (
          <button
            key={automation.id}
            type="button"
            onClick={() => onSelect(automation)}
            className={cn(
              "group flex min-h-[38px] w-full items-center gap-3 rounded-md px-0 py-2 text-left transition hover:bg-muted/45 focus-visible:bg-muted/45 focus-visible:outline-none",
              selectedId === automation.id && "bg-muted/35",
            )}
          >
            <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-muted-foreground">
              <CalendarClock size={14} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="truncate text-sm font-medium text-foreground">{automation.title}</span>
              <span className="ml-2 truncate text-sm text-muted-foreground">
                {automationMeta(automation, agentOptions, projectLabelFor)}
              </span>
            </span>
            <span className="shrink-0 text-sm text-muted-foreground">{statusLabel(automation)}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function CompactSelect({ icon, className, wrapperClassName, children, ...props }: SelectHTMLAttributes<HTMLSelectElement> & {
  icon?: ReactNode;
  wrapperClassName?: string;
}) {
  return (
    <span className={cn("relative inline-flex items-center", wrapperClassName)}>
      {icon && <span className="pointer-events-none absolute left-2 z-10 text-muted-foreground">{icon}</span>}
      <Select
        {...props}
        wrapperClassName="min-w-[112px]"
        className={cn(
          "h-8 rounded-lg border-0 bg-transparent py-1 text-xs shadow-none hover:bg-muted/60 focus-visible:ring-1",
          icon ? "pl-7" : "pl-2",
          className,
        )}
      >
        {children}
      </Select>
    </span>
  );
}

function projectLabelFor(projects: Array<{ projectId: string; label: string }>, projectId: string | undefined) {
  if (!projectId) return undefined;
  return projects.find((project) => project.projectId === projectId)?.label;
}

function automationMeta(
  automation: OraAutomation,
  agentOptions: Array<{ id: string; label: string }>,
  projectLabelForId: (projectId: string | undefined) => string | undefined,
) {
  return projectLabelForId(automation.projectId)
    ?? agentOptions.find((agent) => agent.id === automation.customAgentId)?.label
    ?? "默认";
}

function statusLabel(automation: OraAutomation) {
  if (automation.state.runningRunId) return "运行中";
  return automation.status === "paused" ? "已暂停" : "运行中";
}

function scheduleFromDraft(draft: AutomationDraft): OraAutomationSchedule {
  const [hour, minute] = draft.time.split(":").map((part) => Number.parseInt(part, 10));
  const safeHour = Number.isFinite(hour) ? hour : 9;
  const safeMinute = Number.isFinite(minute) ? minute : 0;
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  if (draft.preset === "once") {
    const date = new Date();
    date.setHours(safeHour, safeMinute, 0, 0);
    if (date.getTime() <= Date.now()) date.setDate(date.getDate() + 1);
    return { kind: "once", at: date.getTime(), timezone };
  }
  if (draft.preset === "hourly") {
    return { kind: "rrule", rrule: `FREQ=HOURLY;INTERVAL=${Math.max(1, draft.interval)};BYMINUTE=${safeMinute}`, timezone };
  }
  if (draft.preset === "weekly") {
    return { kind: "rrule", rrule: `FREQ=WEEKLY;INTERVAL=${Math.max(1, draft.interval)};BYDAY=${draft.weekday};BYHOUR=${safeHour};BYMINUTE=${safeMinute}`, timezone };
  }
  if (draft.preset === "monthly") {
    return { kind: "rrule", rrule: `FREQ=MONTHLY;INTERVAL=${Math.max(1, draft.interval)};BYMONTHDAY=${Math.min(31, Math.max(1, draft.monthDay))};BYHOUR=${safeHour};BYMINUTE=${safeMinute}`, timezone };
  }
  return { kind: "rrule", rrule: `FREQ=DAILY;INTERVAL=${Math.max(1, draft.interval)};BYHOUR=${safeHour};BYMINUTE=${safeMinute}`, timezone };
}

function draftFromAutomation(automation: OraAutomation): AutomationDraft {
  const schedule = automation.schedule;
  const parsed = schedule.kind === "rrule" ? parseRRule(schedule.rrule) : {};
  const hour = schedule.kind === "once" ? new Date(schedule.at).getHours() : Number(parsed.BYHOUR ?? 9);
  const minute = schedule.kind === "once" ? new Date(schedule.at).getMinutes() : Number(parsed.BYMINUTE ?? 0);
  return {
    title: automation.title,
    prompt: automation.prompt,
    preset: schedule.kind === "once" ? "once" : presetFromFreq(parsed.FREQ),
    time: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
    interval: Number(parsed.INTERVAL ?? 1),
    weekday: String(parsed.BYDAY ?? "MO").split(",")[0] ?? "MO",
    monthDay: Number(parsed.BYMONTHDAY ?? 1),
    projectId: automation.projectId ?? "",
    customAgentId: automation.customAgentId ?? "",
    modeId: automation.modeId ?? "",
    providerId: automation.providerId ?? "",
    taskIntent: automation.taskIntent,
  };
}

function parseRRule(rrule: string): Record<string, string> {
  return Object.fromEntries(rrule.split(";").map((segment) => {
    const [key, value] = segment.split("=");
    return [key, value];
  }));
}

function presetFromFreq(freq: string | undefined): SchedulePreset {
  if (freq === "HOURLY") return "hourly";
  if (freq === "WEEKLY") return "weekly";
  if (freq === "MONTHLY") return "monthly";
  return "daily";
}
