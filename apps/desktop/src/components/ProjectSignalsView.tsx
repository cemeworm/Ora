import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Activity, CheckCircle2, ExternalLink, Gauge, GitBranchPlus, Inbox, RefreshCcw, ShieldAlert } from "lucide-react";
import { useWorkbench } from "../lib/state";
import type {
  OraFeedbackLoopActionResult,
  OraFeedbackLoopCalibrationRule,
  OraProjectInsight,
  OraProjectSignal,
  RuntimeClient,
} from "../lib/runtimeClient";
import { cn } from "../lib/utils";
import type { RuntimeBridgeStatus } from "../types";

interface ProjectSignalsViewProps {
  runtimeClient: RuntimeClient;
  bridgeStatus: RuntimeBridgeStatus;
  onOpenEvidence?: () => void;
}

type LoadState = "idle" | "loading" | "error";

export function ProjectSignalsView({ runtimeClient, bridgeStatus, onOpenEvidence }: ProjectSignalsViewProps) {
  const { state, dispatch } = useWorkbench();
  const [selectedProjectId, setSelectedProjectId] = useState<string | "all">("all");
  const [signals, setSignals] = useState<OraProjectSignal[]>([]);
  const [insights, setInsights] = useState<OraProjectInsight[]>([]);
  const [rules, setRules] = useState<OraFeedbackLoopCalibrationRule[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [error, setError] = useState<string>();
  const [actionResult, setActionResult] = useState<OraFeedbackLoopActionResult>();
  const [pendingAction, setPendingAction] = useState<OraFeedbackLoopActionResult>();

  const projectIdParam = selectedProjectId === "all" ? undefined : selectedProjectId;

  async function refresh() {
    setLoadState("loading");
    setError(undefined);
    try {
      const [nextSignals, nextInsights, nextRules] = await Promise.all([
        runtimeClient.listProjectSignals({ projectId: projectIdParam, limit: 200 }),
        runtimeClient.listProjectInsights({ projectId: projectIdParam, limit: 100 }),
        runtimeClient.listFeedbackLoopRules(projectIdParam ? { projectId: projectIdParam } : {}),
      ]);
      setSignals(nextSignals);
      setInsights(nextInsights);
      setRules(nextRules);
      setLoadState("idle");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to load project signals.");
      setLoadState("error");
    }
  }

  useEffect(() => {
    void refresh();
  }, [projectIdParam, runtimeClient]);

  const openSignals = insights.filter((insight) => insight.status === "open");
  const criticalCount = signals.filter((signal) => signal.severity === "critical").length;
  const warningCount = signals.filter((signal) => signal.severity === "warning").length;
  const pendingFeedbackCount = signals.filter((signal) => signal.source === "evaluation_feedback" && signal.metadata.feedbackStatus === "pending").length;
  const recoveryCount = signals.filter((signal) => signal.source === "recovery_event").length;
  const selectedProjectLabel = useMemo(() => {
    if (selectedProjectId === "all") return "All projects";
    return state.projects.find((project) => project.projectId === selectedProjectId)?.label ?? selectedProjectId;
  }, [selectedProjectId, state.projects]);

  async function openEvidence(signal: OraProjectSignal) {
    const target = signal.evidence[0]?.target;
    if (!target) return;

    if (target.kind === "trail" || target.kind === "run") {
      const runId = target.runId ?? target.id;
      try {
        const snapshot = await runtimeClient.getRunState(runId);
        if (snapshot.sessionId) {
          dispatch({ type: "SELECT_SESSION", sessionId: snapshot.sessionId });
        }
        dispatch({ type: "SELECT_TURN", runId, snapshot });
        dispatch({ type: "SET_VIEW", view: "chat" });
        dispatch({ type: "TOGGLE_DETAIL_DRAWER", drawer: "trails" });
        onOpenEvidence?.();
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : "Unable to open run evidence.");
      }
      return;
    }

    if (target.kind === "evaluation" || target.kind === "feedback") {
      dispatch({ type: "SET_VIEW", view: "evaluation" });
      onOpenEvidence?.();
    }
  }

  async function previewAction(insight: OraProjectInsight, actionId: string) {
    try {
      const preview = await runtimeClient.previewProjectSignalAction(insight.id, actionId);
      setPendingAction(preview);
      setActionResult(undefined);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to preview signal action.");
    }
  }

  async function confirmPendingAction() {
    if (!pendingAction) return;
    try {
      const applied = await runtimeClient.applyProjectSignalAction(pendingAction.insight.id, pendingAction.action.id);
      setActionResult(applied);
      setPendingAction(undefined);
      await refresh();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to apply signal action.");
    }
  }

  async function dismissInsight(insight: OraProjectInsight) {
    try {
      await runtimeClient.dismissProjectInsight(insight.id, "Dismissed from Project Signals.");
      await refresh();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to dismiss insight.");
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-sidebar">
      <header className="flex shrink-0 items-center justify-between border-b border-border/70 px-6 py-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground">
            <Activity size={14} />
            Project feedback loop
          </div>
          <h1 className="mt-1 text-2xl font-semibold text-foreground">Signals</h1>
          <p className="mt-1 text-sm text-muted-foreground">{selectedProjectLabel} · {bridgeStatus.mode}</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={selectedProjectId}
            onChange={(event) => setSelectedProjectId(event.target.value)}
            className="h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground shadow-sm"
          >
            <option value="all">All projects</option>
            {state.projects.map((project) => (
              <option key={project.projectId} value={project.projectId}>{project.label}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => void refresh()}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-background px-3 text-sm font-medium text-foreground shadow-sm transition hover:bg-muted"
          >
            <RefreshCcw size={15} />
            Refresh
          </button>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        {error && (
          <div className="mb-4 rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</div>
        )}
        {actionResult && (
          <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{actionResult.message}</div>
        )}
        {pendingAction && (
          <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-sm font-semibold text-amber-900">Confirm action</p>
                <p className="mt-1 text-sm text-amber-800">{pendingAction.message}</p>
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  onClick={() => setPendingAction(undefined)}
                  className="h-8 rounded-md border border-amber-300 bg-transparent px-3 text-xs font-medium text-amber-900 transition hover:bg-amber-100"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void confirmPendingAction()}
                  className="h-8 rounded-md bg-amber-900 px-3 text-xs font-medium text-white transition hover:bg-amber-950"
                >
                  Apply
                </button>
              </div>
            </div>
          </div>
        )}

        <section className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <Metric icon={<Gauge size={16} />} label="Open insights" value={openSignals.length} tone={openSignals.length > 0 ? "warning" : "neutral"} />
          <Metric icon={<ShieldAlert size={16} />} label="Critical signals" value={criticalCount} tone={criticalCount > 0 ? "critical" : "neutral"} />
          <Metric icon={<Inbox size={16} />} label="Pending feedback" value={pendingFeedbackCount} tone={pendingFeedbackCount > 0 ? "warning" : "neutral"} />
          <Metric icon={<GitBranchPlus size={16} />} label="Recovery signals" value={recoveryCount} tone={recoveryCount > 0 ? "warning" : "neutral"} />
        </section>

        <section className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-w-0">
            <SectionTitle title="Insights" subtitle={`${insights.length} clustered interpretations`} />
            <div className="mt-3 flex flex-col gap-3">
              {insights.length === 0 && <EmptyState title="No insights yet" detail={loadState === "loading" ? "Loading project signal clusters..." : "Ora has not found enough related evidence to cluster."} />}
              {insights.map((insight) => (
                <article key={insight.id} className="rounded-lg border border-border bg-background p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <StatusPill status={insight.status} />
                        <span className="text-xs text-muted-foreground">{Math.round(insight.confidence * 100)}% confidence</span>
                      </div>
                      <h2 className="mt-2 text-base font-semibold text-foreground">{insight.title}</h2>
                      <p className="mt-1 text-sm leading-6 text-muted-foreground">{insight.summary}</p>
                    </div>
                    {insight.status === "open" && (
                      <button
                        type="button"
                        onClick={() => void dismissInsight(insight)}
                        className="h-8 shrink-0 rounded-md border border-border px-2.5 text-xs font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground"
                      >
                        Dismiss
                      </button>
                    )}
                  </div>
                  {insight.recommendedActions.length > 0 && (
                    <div className="mt-4 flex flex-wrap gap-2">
                      {insight.recommendedActions.map((action) => (
                        <button
                          key={action.id}
                          type="button"
                          onClick={() => void previewAction(insight, action.id)}
                          className="inline-flex h-8 items-center gap-2 rounded-md bg-foreground px-3 text-xs font-medium text-background transition hover:bg-foreground/90"
                        >
                          <CheckCircle2 size={14} />
                          {action.label}
                        </button>
                      ))}
                    </div>
                  )}
                </article>
              ))}
            </div>
          </div>

          <aside className="min-w-0">
            <SectionTitle title="Calibration Rules" subtitle={`${rules.length} deterministic rules`} />
            <div className="mt-3 flex flex-col gap-2">
              {rules.map((rule) => (
                <div key={rule.id} className="rounded-lg border border-border bg-background p-3 shadow-sm">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-semibold text-foreground">{rule.name}</p>
                    <span className="text-xs text-muted-foreground">{rule.enabled ? "On" : "Off"}</span>
                  </div>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    {rule.sourceFilters.join(", ") || "all sources"} · {rule.severityThreshold}+ · review {rule.humanReviewRequired ? "required" : "optional"}
                  </p>
                </div>
              ))}
            </div>
          </aside>
        </section>

        <section className="mt-5">
          <SectionTitle title="Signals" subtitle={`${signals.length} normalized evidence records`} />
          <div className="mt-3 overflow-hidden rounded-lg border border-border bg-background shadow-sm">
            {signals.length === 0 ? (
              <EmptyState title="No project signals yet" detail={loadState === "loading" ? "Loading signals..." : "Run failures, recovery events, Evaluation feedback, and approvals will appear here."} />
            ) : (
              <div className="divide-y divide-border">
                {signals.map((signal) => (
                  <button
                    key={signal.id}
                    type="button"
                    onClick={() => void openEvidence(signal)}
                    className="flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-muted/45"
                  >
                    <SeverityDot severity={signal.severity} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-semibold text-foreground">{signal.title}</p>
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">{signal.source}</span>
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{signal.summary}</p>
                    </div>
                    <ExternalLink size={14} className="mt-1 shrink-0 text-muted-foreground" />
                  </button>
                ))}
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

function SectionTitle({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div>
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
    </div>
  );
}

function Metric({ icon, label, value, tone }: { icon: ReactNode; label: string; value: number; tone: "neutral" | "warning" | "critical" }) {
  return (
    <div className={cn(
      "rounded-lg border bg-background p-4 shadow-sm",
      tone === "warning" && "border-amber-200 bg-amber-50/70",
      tone === "critical" && "border-rose-200 bg-rose-50/70",
      tone === "neutral" && "border-border",
    )}>
      <div className="flex items-center justify-between gap-2 text-muted-foreground">
        {icon}
        <span className="text-xs font-medium">{label}</span>
      </div>
      <div className="mt-3 text-2xl font-semibold text-foreground">{value}</div>
    </div>
  );
}

function StatusPill({ status }: { status: OraProjectInsight["status"] }) {
  return (
    <span className={cn(
      "rounded-full px-2 py-0.5 text-[11px] font-medium",
      status === "open" && "bg-amber-100 text-amber-800",
      status === "dismissed" && "bg-muted text-muted-foreground",
      status === "applied" && "bg-emerald-100 text-emerald-800",
    )}>
      {status}
    </span>
  );
}

function SeverityDot({ severity }: { severity: OraProjectSignal["severity"] }) {
  return (
    <span className={cn(
      "mt-1 h-2.5 w-2.5 shrink-0 rounded-full",
      severity === "critical" && "bg-rose-500",
      severity === "warning" && "bg-amber-500",
      severity === "info" && "bg-sky-500",
    )} />
  );
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="px-4 py-8 text-center">
      <p className="text-sm font-semibold text-foreground">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-xs leading-5 text-muted-foreground">{detail}</p>
    </div>
  );
}
