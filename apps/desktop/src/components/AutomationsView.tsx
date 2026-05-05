import { Bot, CalendarClock, Pause, Play, Plus, RefreshCcw, Save, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
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
import { Input } from "./ui/input";
import { Select } from "./ui/select";
import { Textarea } from "./ui/textarea";
import { PageHeader } from "./PageHeader";

type SchedulePreset = "once" | "hourly" | "daily" | "weekly" | "monthly";

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
  const [draft, setDraft] = useState<AutomationDraft>(EMPTY_DRAFT);
  const [editingId, setEditingId] = useState<string>();
  const [preview, setPreview] = useState<number[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const selected = automations.find((automation) => automation.id === selectedId) ?? automations[0];
  const activeAutomations = automations.filter((automation) => automation.status === "active");
  const pausedAutomations = automations.filter((automation) => automation.status === "paused");
  const agentOptions = useMemo(() => [
    ...catalog.systemAgents.map((agent) => ({ id: agent.id, label: agent.label })),
    ...catalog.customAgents.map((agent) => ({ id: agent.name, label: agent.name })),
  ], [catalog]);

  async function refresh(nextSelectedId?: string) {
    const [nextAutomations, nextCatalog] = await Promise.all([
      runtimeClient.listAutomations({ includePaused: true }),
      runtimeClient.agentCatalog(),
    ]);
    setAutomations(nextAutomations);
    setCatalog(nextCatalog);
    if (nextSelectedId) {
      setSelectedId(nextSelectedId);
    } else if (!selectedId && nextAutomations[0]) {
      setSelectedId(nextAutomations[0].id);
    }
  }

  useEffect(() => {
    void refresh().catch((nextError) => {
      setError(nextError instanceof Error ? nextError.message : "定时任务加载失败。");
    });
  }, [runtimeClient]);

  useEffect(() => {
    let cancelled = false;
    const schedule = scheduleFromDraft(draft);
    void runtimeClient.previewAutomationSchedule({ schedule, limit: 4 })
      .then((result) => {
        if (!cancelled) setPreview(result.occurrences);
      })
      .catch(() => {
        if (!cancelled) setPreview([]);
      });
    return () => {
      cancelled = true;
    };
  }, [runtimeClient, draft.preset, draft.time, draft.interval, draft.weekday, draft.monthDay]);

  function startCreate() {
    setEditingId(undefined);
    setDraft(EMPTY_DRAFT);
    setError("");
  }

  function startEdit(automation: OraAutomation) {
    setEditingId(automation.id);
    setDraft(draftFromAutomation(automation));
    setSelectedId(automation.id);
    setError("");
  }

  async function saveDraft() {
    const payload: OraAutomationCreateParams = {
      title: draft.title.trim(),
      prompt: draft.prompt.trim(),
      schedule: scheduleFromDraft(draft),
      status: "active",
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
      setError("Title and prompt are required.");
      return;
    }
    setBusy("save");
    setError("");
    try {
      const saved = editingId
        ? await runtimeClient.updateAutomation({ ...payload, id: editingId })
        : await runtimeClient.createAutomation(payload);
      dispatch({ type: "SET_COMMAND_FEEDBACK", feedback: `Automation '${saved.title}' saved.` });
      await refresh(saved.id);
      setEditingId(saved.id);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "定时任务保存失败。");
    } finally {
      setBusy("");
    }
  }

  async function runAction(action: string, fn: () => Promise<unknown>) {
    setBusy(action);
    setError("");
    try {
      await fn();
      await refresh(selected?.id);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "定时任务操作失败。");
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-sidebar">
      <PageHeader
        title="定时任务"
        leading={<CalendarClock size={22} className="text-muted-foreground" />}
        actions={
          <Button size="sm" onClick={startCreate}>
            <Plus size={14} />
            New
          </Button>
        }
      />

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(260px,340px)_1fr] overflow-hidden">
        <div className="min-h-0 overflow-y-auto border-r border-border/70 p-4">
          <AutomationGroup title="Active" automations={activeAutomations} selectedId={selected?.id} onSelect={setSelectedId} />
          <AutomationGroup title="Paused" automations={pausedAutomations} selectedId={selected?.id} onSelect={setSelectedId} />
          {automations.length === 0 && (
            <div className="rounded-lg border border-dashed border-border bg-background/55 p-4 text-sm text-muted-foreground">
              No automations yet.
            </div>
          )}
        </div>

        <div className="min-h-0 overflow-y-auto p-6">
          {error && (
            <div className="mb-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {error}
            </div>
          )}

          <div className="grid gap-6 xl:grid-cols-[minmax(420px,560px)_1fr]">
            <section className="space-y-4">
              <div>
                <h2 className="text-base font-semibold text-foreground">{editingId ? "编辑定时任务" : "创建定时任务"}</h2>
                <p className="mt-1 text-sm text-muted-foreground">Configure the task Ora should run on schedule.</p>
              </div>
              <div className="grid gap-3">
                <Input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="定时任务标题" />
                <Textarea value={draft.prompt} onChange={(event) => setDraft({ ...draft, prompt: event.target.value })} placeholder="Prompt for the scheduled agent run" className="min-h-[160px]" />
                <div className="grid gap-3 sm:grid-cols-2">
                  <Select value={draft.projectId} onChange={(event) => setDraft({ ...draft, projectId: event.target.value })}>
                    <option value="">No project</option>
                    {state.projects.map((project) => (
                      <option key={project.projectId} value={project.projectId}>{project.label}</option>
                    ))}
                  </Select>
                  <Select value={draft.customAgentId} onChange={(event) => setDraft({ ...draft, customAgentId: event.target.value })}>
                    <option value="">Default agent</option>
                    {agentOptions.map((agent) => (
                      <option key={agent.id} value={agent.id}>{agent.label}</option>
                    ))}
                  </Select>
                  <Select value={draft.modeId} onChange={(event) => setDraft({ ...draft, modeId: event.target.value })}>
                    <option value="">Default mode</option>
                    {state.modes.filter((mode) => mode.visibility !== "internal").map((mode) => (
                      <option key={mode.id} value={mode.id}>{mode.label}</option>
                    ))}
                  </Select>
                  <Select value={draft.providerId} onChange={(event) => setDraft({ ...draft, providerId: event.target.value })}>
                    <option value="">Default provider</option>
                    {(state.providerRegistry?.providers ?? []).map((provider) => (
                      <option key={provider.id} value={provider.id}>{provider.label}</option>
                    ))}
                  </Select>
                </div>
                <div className="grid gap-3 sm:grid-cols-[1fr_120px]">
                  <Select value={draft.preset} onChange={(event) => setDraft({ ...draft, preset: event.target.value as SchedulePreset })}>
                    <option value="once">Once</option>
                    <option value="hourly">Every N hours</option>
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                  </Select>
                  <Input type="time" value={draft.time} onChange={(event) => setDraft({ ...draft, time: event.target.value })} />
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Input type="number" min={1} max={24} value={draft.interval} onChange={(event) => setDraft({ ...draft, interval: Number(event.target.value) || 1 })} />
                  <Select value={draft.weekday} disabled={draft.preset !== "weekly"} onChange={(event) => setDraft({ ...draft, weekday: event.target.value })}>
                    {WEEKDAY_OPTIONS.map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </Select>
                  <Input type="number" min={1} max={31} disabled={draft.preset !== "monthly"} value={draft.monthDay} onChange={(event) => setDraft({ ...draft, monthDay: Number(event.target.value) || 1 })} />
                </div>
                <Select value={draft.taskIntent} onChange={(event) => setDraft({ ...draft, taskIntent: event.target.value as AutomationDraft["taskIntent"] })}>
                  <option value="implement">Implement</option>
                  <option value="plan">Plan</option>
                  <option value="chat">Chat</option>
                </Select>
              </div>
              <div className="flex flex-wrap justify-between gap-3">
                <div className="text-xs text-muted-foreground">
                  Next: {preview.length > 0 ? preview.map(formatDateTime).join(" · ") : "No future run"}
                </div>
                <Button onClick={() => void saveDraft()} disabled={busy === "save"}>
                  <Save size={14} />
                  Save
                </Button>
              </div>
            </section>

            <section className="space-y-4">
              {selected ? (
                <AutomationDetail
                  automation={selected}
                  busy={busy}
                  onEdit={() => startEdit(selected)}
                  onRunNow={() => void runAction("run", () => runtimeClient.runAutomationNow(selected.id))}
                  onPause={() => void runAction("pause", () => runtimeClient.pauseAutomation(selected.id))}
                  onResume={() => void runAction("resume", () => runtimeClient.resumeAutomation(selected.id))}
                  onDelete={() => void runAction("delete", () => runtimeClient.deleteAutomation(selected.id))}
                />
              ) : (
                <div className="rounded-lg border border-border bg-background/65 p-5 text-sm text-muted-foreground">
                  Select or create an automation to inspect its runs.
                </div>
              )}
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

function AutomationGroup({ title, automations, selectedId, onSelect }: {
  title: string;
  automations: OraAutomation[];
  selectedId?: string;
  onSelect: (id: string) => void;
}) {
  if (automations.length === 0) return null;
  return (
    <section className="mb-5">
      <div className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{title}</div>
      <div className="space-y-2">
        {automations.map((automation) => (
          <button
            key={automation.id}
            type="button"
            onClick={() => onSelect(automation.id)}
            className={cn(
              "w-full rounded-lg border border-border bg-background/65 p-3 text-left transition hover:bg-background",
              selectedId === automation.id && "border-foreground/20 bg-background shadow-sm",
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-sm font-medium text-foreground">{automation.title}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{automation.status}</span>
            </div>
            <div className="mt-1 truncate text-xs text-muted-foreground">
              {automation.state.nextRunAt ? `Next ${formatDateTime(automation.state.nextRunAt)}` : "No scheduled run"}
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}

function AutomationDetail({ automation, busy, onEdit, onRunNow, onPause, onResume, onDelete }: {
  automation: OraAutomation;
  busy: string;
  onEdit: () => void;
  onRunNow: () => void;
  onPause: () => void;
  onResume: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="rounded-lg border border-border bg-background/70 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold text-foreground">{automation.title}</h2>
          <p className="mt-1 line-clamp-3 text-sm text-muted-foreground">{automation.prompt}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={onRunNow} disabled={busy === "run"}><RefreshCcw size={13} />Run now</Button>
          {automation.status === "active"
            ? <Button variant="outline" size="sm" onClick={onPause} disabled={busy === "pause"}><Pause size={13} />Pause</Button>
            : <Button variant="outline" size="sm" onClick={onResume} disabled={busy === "resume"}><Play size={13} />Resume</Button>}
          <Button variant="outline" size="sm" onClick={onEdit}><Bot size={13} />Edit</Button>
          <Button variant="ghost" size="icon-sm" onClick={onDelete} disabled={busy === "delete"} title="删除定时任务"><Trash2 size={14} /></Button>
        </div>
      </div>
      <div className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
        <Info label="Next run" value={automation.state.nextRunAt ? formatDateTime(automation.state.nextRunAt) : "None"} />
        <Info label="Last status" value={automation.state.lastRunStatus ?? "Never run"} />
        <Info label="Session" value={automation.state.dedicatedSessionId ?? "Created on first run"} />
        <Info label="Failures" value={String(automation.state.consecutiveFailures)} />
      </div>
      <div className="mt-5">
        <div className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Recent runs</div>
        <div className="space-y-2">
          {automation.state.runHistory.length === 0 && (
            <div className="rounded-md bg-muted/45 px-3 py-2 text-sm text-muted-foreground">No runs yet.</div>
          )}
          {automation.state.runHistory.map((run) => (
            <div key={run.id} className="flex items-center justify-between gap-3 rounded-md bg-muted/45 px-3 py-2 text-sm">
              <span className="truncate text-foreground">{formatDateTime(run.startedAt)}</span>
              <span className="shrink-0 text-muted-foreground">{run.status}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-muted/45 px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 truncate font-medium text-foreground">{value}</div>
    </div>
  );
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

function formatDateTime(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}
