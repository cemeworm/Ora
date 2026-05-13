import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Archive,
  Bot,
  ChartNoAxesColumn,
  ChevronDown,
  Clock,
  Folder,
  FolderOpen,
  GitBranchPlus,
  MessageSquare,
  MessageSquarePlus,
  Plus,
  Search,
  Settings,
  Sparkles,
} from "lucide-react";
import { useWorkbenchDispatch, type WorkbenchState } from "../lib/state";
import {
  getSharedRuntimeClient,
  type OraRunAttention,
  type OraSessionSummary,
} from "../lib/runtimeClient";
import {
  deriveRunInteractionState,
  type DesktopRunInteractionState,
} from "../lib/runInteractionState";
import { checkOraReleaseUpdate, type ReleaseUpdateStatus } from "../lib/releaseUpdate";
import { buildSessionSearchResults, type SessionSearchResult } from "../lib/sessionSearch";
import { useRunActions } from "../lib/useRunActions";
import { translateCopy } from "../lib/i18n";
import { cn } from "../lib/utils";
import type { RunStatus } from "../types";
import { Dialog, DialogContent } from "./ui/dialog";
import { SidebarTrigger, useSidebar } from "./ui/sidebar";

const MAX_VISIBLE_PROJECT_SESSIONS = 4;
const MAX_VISIBLE_PREFETCH_SESSIONS = 12;
const MAX_SESSION_SEARCH_RESULTS = 9;
const SESSION_COLUMN_INDENT = "pl-[1.375rem]";
const SIDEBAR_ACTION_SLOT_CLASS = "flex h-7 w-7 shrink-0 items-center justify-center";
const SIDEBAR_ACTION_BUTTON_CLASS = cn(
  SIDEBAR_ACTION_SLOT_CLASS,
  "rounded-md text-muted-foreground transition hover:bg-sidebar-accent/65 hover:text-sidebar-accent-foreground active:scale-95",
);

export function statusFromSession(
  status: string | undefined,
  attention?: OraRunAttention,
): RunStatus {
  if (attention) {
    switch (attention.kind) {
      case "needs_clarification":
        return "clarification_required";
      case "needs_approval":
        return "approval_required";
      case "needs_plan_decision":
        return "decision_needed";
      case "running":
        return "running";
      case "paused":
        return "paused";
      case "cancelled":
        return "cancelled";
      case "failed":
        return "failed";
      case "idle":
        return "done";
    }
  }
  if (status === "interrupted") return "paused";
  if (status === "cancelled") return "cancelled";
  if (status === "failed") return "failed";
  if (status === "running" || status === "queued") return "running";
  return "done";
}

function statusFromRunInteractionState(
  state: DesktopRunInteractionState,
): RunStatus {
  switch (state.status) {
    case "queued":
    case "running":
      return "running";
    case "approval_required":
      return "approval_required";
    case "clarification_required":
      return "clarification_required";
    case "decision_needed":
      return "decision_needed";
    case "paused":
      return "paused";
    case "cancelled":
      return "cancelled";
    case "failed":
      return "failed";
    case "idle":
    case "done":
      return "done";
  }
}

export function sidebarStatusForSession(
  session: OraSessionSummary,
  state: Pick<
    SidebarState,
    | "selectedSessionId"
    | "selectedTurnRunId"
    | "activeSessionDetail"
    | "runLifecycle"
  >,
): RunStatus {
  if (session.sessionId !== state.selectedSessionId) {
    return statusFromSession(session.status, session.attention);
  }

  return statusFromRunInteractionState(
    deriveRunInteractionState({
      selectedSessionId: state.selectedSessionId,
      sessionSummary: session,
      activeSessionDetail: state.activeSessionDetail,
      selectedTurnRunId: state.selectedTurnRunId,
      runLifecycle: state.runLifecycle,
    }),
  );
}

function SidebarSectionHeader({
  title,
  action,
}: {
  title: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between pb-2 pl-2 pt-1">
      <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground/80">{title}</span>
      <div className={SIDEBAR_ACTION_SLOT_CLASS}>{action}</div>
    </div>
  );
}

function SidebarIconSlot({ children }: { children: ReactNode }) {
  return (
    <span className="flex h-5 w-5 shrink-0 items-center justify-center [&_svg]:block">
      {children}
    </span>
  );
}

function ReleaseUpdatePill() {
  const [status, setStatus] = useState<ReleaseUpdateStatus>({ available: false });
  const [installState, setInstallState] = useState<"idle" | "checking" | "downloading" | "installing" | "relaunching" | "failed">("idle");
  const [installError, setInstallError] = useState<string | undefined>();

  useEffect(() => {
    let cancelled = false;
    void checkOraReleaseUpdate().then((nextStatus) => {
      if (!cancelled) {
        setStatus(nextStatus);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!status.available || !status.releaseUrl) return null;

  const installUpdate = async () => {
    if (installState !== "idle" && installState !== "failed") return;

    setInstallError(undefined);
    setInstallState("checking");
    try {
      const [{ check }, { relaunch }] = await Promise.all([
        import("@tauri-apps/plugin-updater"),
        import("@tauri-apps/plugin-process"),
      ]);
      const update = await check();
      if (!update) {
        setStatus({ available: false, latestVersion: status.latestVersion, releaseUrl: status.releaseUrl });
        setInstallState("idle");
        return;
      }

      setInstallState("downloading");
      await update.downloadAndInstall((event) => {
        if (event.event === "Finished") {
          setInstallState("installing");
        }
      });
      setInstallState("relaunching");
      await relaunch();
    } catch (error) {
      setInstallState("failed");
      setInstallError(error instanceof Error ? error.message : "Ora update failed.");
      await getSharedRuntimeClient().openExternalUrl(status.releaseUrl!);
    }
  };

  const busy = installState !== "idle" && installState !== "failed";
  const label = updatePillLabel(installState);
  const title = installError
    ? `Ora ${status.latestVersion ?? ""} update failed. Opened GitHub release page. ${installError}`
    : `Install Ora ${status.latestVersion ?? ""}`;

  return (
    <button
      type="button"
      onClick={() => void installUpdate()}
      disabled={busy}
      className="inline-flex h-5 shrink-0 items-center rounded-full bg-amber-100/75 px-1.5 text-[10px] font-medium text-amber-800 transition hover:bg-amber-100 hover:text-amber-900 active:scale-95"
      title={title}
      aria-label={`Install Ora ${status.latestVersion ?? ""}`}
    >
      {label}
    </button>
  );
}

function updatePillLabel(state: "idle" | "checking" | "downloading" | "installing" | "relaunching" | "failed") {
  switch (state) {
    case "checking":
      return "检查中";
    case "downloading":
      return "下载中";
    case "installing":
      return "安装中";
    case "relaunching":
      return "重启中";
    case "failed":
      return "手动更新";
    case "idle":
      return "更新";
  }
}

export function SessionStatusBadge({ status }: { status: RunStatus }) {
  if (status === "running") {
    return (
      <span className="inline-flex items-center rounded-full bg-emerald-100/85 px-2 py-0.5 text-[10px] font-medium text-emerald-800">
        Running
      </span>
    );
  }

  if (status === "approval_required") {
    return (
      <span className="inline-flex items-center rounded-full bg-amber-100/75 px-2 py-0.5 text-[10px] font-medium text-amber-800">
        Needs approval
      </span>
    );
  }

  if (status === "clarification_required") {
    return (
      <span className="inline-flex items-center rounded-full bg-blue-100/75 px-2 py-0.5 text-[10px] font-medium text-blue-800">
        Needs clarification
      </span>
    );
  }

  if (status === "decision_needed") {
    return (
      <span className="inline-flex items-center rounded-full bg-purple-100/75 px-2 py-0.5 text-[10px] font-medium text-purple-800">
        Needs decision
      </span>
    );
  }

  if (status === "failed") {
    return (
      <span className="inline-flex items-center rounded-full bg-rose-100/75 px-2 py-0.5 text-[10px] font-medium text-rose-700">
        Failed
      </span>
    );
  }

  return null;
}

function SessionLeadingIndicator({ status }: { status: RunStatus }) {
  if (status === "running") {
    return <span className="h-3 w-3 shrink-0 rounded-full border border-bench-200 border-t-bench-700 animate-spin" />;
  }

  if (status === "approval_required") {
    return <span className="h-2 w-2 shrink-0 rounded-full bg-amber-500/80" />;
  }

  if (status === "clarification_required") {
    return <span className="h-2 w-2 shrink-0 rounded-full bg-blue-500/80" />;
  }

  if (status === "decision_needed") {
    return <span className="h-2 w-2 shrink-0 rounded-full bg-purple-500/80" />;
  }

  if (status === "failed") {
    return <span className="h-2 w-2 shrink-0 rounded-full bg-rose-500/75" />;
  }

  return null;
}

const SessionRow = memo(function SessionRow({
  title,
  status,
  selected,
  confirmOpen,
  onClick,
  onPrefetch,
  onArchiveRequest,
  onArchiveCancel,
  onArchiveConfirm,
}: {
  title: string;
  status: RunStatus;
  selected: boolean;
  confirmOpen: boolean;
  onClick: () => void;
  onPrefetch: () => void;
  onArchiveRequest: () => void;
  onArchiveCancel: () => void;
  onArchiveConfirm: () => void;
}) {
  return (
    <div
      onMouseEnter={onPrefetch}
      className={cn(
        "group/session relative my-0.5 flex min-h-[36px] w-full items-center rounded-lg text-[13px] text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        selected
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "text-muted-foreground",
      )}
    >
      <button
        type="button"
        onClick={onClick}
        onFocus={onPrefetch}
        className="flex min-h-[36px] min-w-0 flex-1 items-center gap-2 rounded-lg px-2.5 py-1.5 text-left"
      >
        {status !== "done" && <SessionLeadingIndicator status={status} />}
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{title}</div>
        </div>
        <SessionStatusBadge status={status} />
      </button>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onArchiveRequest();
        }}
        className={cn(
          SIDEBAR_ACTION_BUTTON_CLASS,
          "opacity-0 hover:bg-background/85 hover:text-foreground focus-visible:opacity-100 group-hover/session:opacity-100",
          confirmOpen && "opacity-100",
        )}
        title="Archive chat"
        aria-label={`Archive ${title}`}
      >
        <Archive size={13} />
      </button>
      {confirmOpen && (
        <div
          className="absolute right-0 top-[calc(100%+4px)] z-30 w-48 rounded-lg border border-border bg-popover p-2 text-popover-foreground shadow-lift"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="px-2 pb-2 pt-1 text-[12px] font-medium text-foreground">Archive this chat?</div>
          <div className="flex justify-end gap-1">
            <button
              type="button"
              onClick={onArchiveCancel}
              className="h-7 rounded-md px-2 text-[12px] text-muted-foreground transition hover:bg-sidebar-accent hover:text-sidebar-accent-foreground active:scale-95"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onArchiveConfirm}
              className="h-7 rounded-md bg-foreground px-2 text-[12px] font-medium text-background transition hover:bg-foreground/85 active:scale-95"
            >
              Archive
            </button>
          </div>
        </div>
      )}
    </div>
  );
});

function SessionSearchDialog({
  open,
  query,
  results,
  onQueryChange,
  onOpenChange,
  onSelect,
  onPrefetch,
}: {
  open: boolean;
  query: string;
  results: SessionSearchResult[];
  onQueryChange: (query: string) => void;
  onOpenChange: (open: boolean) => void;
  onSelect: (sessionId: string) => void;
  onPrefetch: (sessionId: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const hasQuery = query.trim().length > 0;

  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(76vh,430px)] w-[min(520px,calc(100vw-2rem))] flex-col overflow-hidden rounded-[22px] border border-black/[0.04] bg-background p-0 shadow-lift">
        <div className="border-b border-border/55 px-4 py-3">
          <div className="relative">
            <Search size={15} className="pointer-events-none absolute left-0 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && /^[1-9]$/.test(event.key)) {
                  const shortcutSession = results[Number(event.key) - 1];
                  if (shortcutSession) {
                    event.preventDefault();
                    onSelect(shortcutSession.id);
                  }
                  return;
                }
                if (event.key === "Enter" && results[0]) {
                  onSelect(results[0].id);
                }
              }}
              placeholder="搜索对话"
              aria-label="搜索对话"
              className="h-8 w-full bg-transparent pl-6 pr-2 text-[15px] text-foreground outline-none placeholder:text-muted-foreground"
            />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          <div className="px-1.5 pb-2 text-[12px] text-muted-foreground">
            {hasQuery ? "匹配结果" : "近期对话"}
          </div>
          <div className="flex flex-col gap-0.5">
            {results.map((session, index) => (
              <button
                key={session.id}
                type="button"
                onClick={() => onSelect(session.id)}
                onMouseEnter={() => onPrefetch(session.id)}
                onFocus={() => onPrefetch(session.id)}
                className="group flex min-h-[32px] w-full items-center gap-2 rounded-md px-2 text-left text-[13px] text-foreground transition hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:bg-sidebar-accent focus-visible:text-sidebar-accent-foreground focus-visible:outline-none active:scale-[0.99]"
              >
                <MessageSquare size={14} className="shrink-0 text-muted-foreground group-hover:text-sidebar-accent-foreground/75" />
                <span className="min-w-0 flex-1 truncate font-medium">{session.title}</span>
                {session.projectLabel && (
                  <span className="shrink-0 text-[12px] text-muted-foreground group-hover:text-sidebar-accent-foreground/70">
                    {session.projectLabel}
                  </span>
                )}
                <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground group-hover:bg-background/80">
                  ⌘{index + 1}
                </span>
              </button>
            ))}
            {results.length === 0 && (
              <div className="px-2 py-8 text-center text-sm text-muted-foreground">
                没有找到匹配的对话
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export interface SidebarState {
  projects: WorkbenchState["projects"];
  sessions: WorkbenchState["sessions"];
  expandedProjectIds: WorkbenchState["expandedProjectIds"];
  activeView: WorkbenchState["activeView"];
  selectedSessionId: WorkbenchState["selectedSessionId"];
  selectedTurnRunId: WorkbenchState["selectedTurnRunId"];
  activeSessionDetail: WorkbenchState["activeSessionDetail"];
  runLifecycle: WorkbenchState["runLifecycle"];
  language: WorkbenchState["language"];
  settingsOpen: WorkbenchState["settingsOpen"];
}

function shouldPinVisibleSession(status: RunStatus): boolean {
  return (
    status === "running" ||
    status === "approval_required" ||
    status === "clarification_required" ||
    status === "decision_needed" ||
    status === "paused"
  );
}

export function visibleSidebarSessions<T extends { id: string; status: RunStatus }>(
  sessions: readonly T[],
  limit: number,
  selectedSessionId?: string,
): T[] {
  if (sessions.length <= limit) {
    return [...sessions];
  }
  const visible = sessions.slice(0, limit);
  for (const session of sessions.slice(limit)) {
    if (
      session.id === selectedSessionId ||
      shouldPinVisibleSession(session.status)
    ) {
      visible.push(session);
    }
  }
  return visible;
}

export const Sidebar = memo(function Sidebar({ sidebarState }: { sidebarState: SidebarState }) {
  const dispatch = useWorkbenchDispatch();
  const { actions } = useRunActions();
  const { open } = useSidebar();
  const [expandedSessionLists, setExpandedSessionLists] = useState<Record<string, boolean>>({});
  const [navigationExpanded, setNavigationExpanded] = useState(false);
  const [confirmArchiveSessionId, setConfirmArchiveSessionId] = useState<string | undefined>();
  const [sessionSearchOpen, setSessionSearchOpen] = useState(false);
  const [sessionSearchQuery, setSessionSearchQuery] = useState("");
  const projects = useMemo(() => sidebarState.projects.map((project) => ({
    ...project,
    expanded: sidebarState.expandedProjectIds[project.projectId] ?? true,
    sessions: sidebarState.sessions
      .filter((session) => session.projectId === project.projectId)
      .sort((a, b) => b.updatedAt - a.updatedAt || a.sessionId.localeCompare(b.sessionId))
      .map((session) => ({
        id: session.sessionId,
        title: session.title,
        status: sidebarStatusForSession(session, sidebarState),
      })),
  })), [
    sidebarState.expandedProjectIds,
    sidebarState.projects,
    sidebarState.sessions,
    sidebarState.selectedSessionId,
    sidebarState.selectedTurnRunId,
    sidebarState.activeSessionDetail,
    sidebarState.runLifecycle,
  ]);
  const sessionSearchResults = useMemo(
    () => buildSessionSearchResults(sidebarState.sessions, sidebarState.projects, sessionSearchQuery, MAX_SESSION_SEARCH_RESULTS),
    [sessionSearchQuery, sidebarState.projects, sidebarState.sessions],
  );
  const recentChats = useMemo(() => sidebarState.sessions
    .filter((session) => !session.projectId)
    .sort((a, b) => b.updatedAt - a.updatedAt || a.sessionId.localeCompare(b.sessionId))
    .map((session) => ({
      id: session.sessionId,
      title: session.title,
      status: sidebarStatusForSession(session, sidebarState),
    })), [
      sidebarState.sessions,
      sidebarState.selectedSessionId,
      sidebarState.selectedTurnRunId,
      sidebarState.activeSessionDetail,
      sidebarState.runLifecycle,
    ]);
  const showSectionDivider = projects.length > 0;
  const chatSessionSelected = sidebarState.activeView === "chat";
  const visiblePrefetchSessionIds = useMemo(() => {
    const ids = new Set<string>();
    for (const project of projects) {
      if (!project.expanded) continue;
      const showAllSessions = expandedSessionLists[project.projectId] ?? false;
      const visibleSessions = showAllSessions
        ? project.sessions
        : visibleSidebarSessions(
            project.sessions,
            MAX_VISIBLE_PROJECT_SESSIONS,
            sidebarState.selectedSessionId,
          );
      for (const session of visibleSessions) {
        ids.add(session.id);
        if (ids.size >= MAX_VISIBLE_PREFETCH_SESSIONS) return [...ids];
      }
    }
    for (const session of recentChats) {
      ids.add(session.id);
      if (ids.size >= MAX_VISIBLE_PREFETCH_SESSIONS) return [...ids];
    }
    return [...ids];
  }, [expandedSessionLists, projects, recentChats]);
  const visiblePrefetchSessionKey = visiblePrefetchSessionIds.join("\u0000");

  useEffect(() => {
    if (!open || visiblePrefetchSessionIds.length === 0) return;
    void actions.prefetchSessions(visiblePrefetchSessionIds);
  }, [open, visiblePrefetchSessionKey]);

  function openSessionSearch() {
    setSessionSearchQuery("");
    setSessionSearchOpen(true);
  }

  function selectSearchSession(sessionId: string) {
    setSessionSearchOpen(false);
    setSessionSearchQuery("");
    void actions.selectSession(sessionId);
  }

  const navigationItems = [
    {
      key: "search",
      label: "Search",
      title: "Search",
      icon: <Search size={14} />,
      active: false,
      onClick: openSessionSearch,
    },
    {
      key: "agents",
      label: "Agents",
      title: "Agents",
      icon: <Bot size={16} />,
      active: sidebarState.activeView === "agents",
      onClick: () => dispatch({ type: "SET_VIEW", view: "agents" }),
      gapClass: "mt-2",
    },
    {
      key: "modes",
      label: "Modes",
      title: "Modes",
      icon: <GitBranchPlus size={16} />,
      active: sidebarState.activeView === "modes",
      onClick: () => dispatch({ type: "SET_VIEW", view: "modes" }),
      gapClass: "mt-1",
    },
    {
      key: "skills",
      label: "Skills",
      title: "Skills",
      icon: <Sparkles size={16} />,
      active: sidebarState.activeView === "skills",
      onClick: () => dispatch({ type: "SET_VIEW", view: "skills" }),
      gapClass: "mt-1",
    },
    {
      key: "evaluation",
      label: "Evaluation",
      title: "Evaluation",
      icon: <ChartNoAxesColumn size={16} />,
      active: sidebarState.activeView === "evaluation",
      onClick: () => dispatch({ type: "SET_VIEW", view: "evaluation" }),
      gapClass: "mt-1",
    },
    {
      key: "automations",
      label: "定时任务",
      title: "定时任务",
      icon: <Clock size={16} />,
      active: sidebarState.activeView === "automations",
      onClick: () => dispatch({ type: "SET_VIEW", view: "automations" }),
      gapClass: "mt-1",
    },
  ];
  const navigationToggleLabel = sidebarState.language === "zh"
    ? navigationExpanded ? "折叠" : "展开"
    : navigationExpanded ? "Less" : "More";
  const collapsedNavigationMask = "linear-gradient(to bottom, #000 0%, #000 58%, rgba(0,0,0,0.72) 72%, rgba(0,0,0,0.28) 88%, transparent 100%)";

  return (
    <aside
      data-state={open ? "expanded" : "collapsed"}
      className={cn(
        "hidden h-screen shrink-0 bg-background text-sidebar-foreground transition-[width] duration-200 ease-linear md:flex md:flex-col",
        open ? "w-60" : "w-12",
      )}
    >
      <div className="flex h-12 shrink-0 flex-col justify-center px-2">
        {open ? (
          <div className="flex items-center justify-between gap-2 pr-1">
            <div className="ml-1 flex min-w-0 items-center gap-2">
              <div className="cursor-default font-serif text-[15px] text-primary">Ora</div>
              <ReleaseUpdatePill />
            </div>
            <div className={SIDEBAR_ACTION_SLOT_CLASS}>
              <SidebarTrigger />
            </div>
          </div>
        ) : (
          <div className="group/workspace-header flex w-full items-center justify-center">
            <div className="block pt-1 font-serif text-primary group-hover/workspace-header:hidden">O</div>
            <SidebarTrigger className="hidden group-hover/workspace-header:inline-flex" />
          </div>
        )}
      </div>

      <div className="px-2 pb-2">
        <button
          onClick={() => {
            dispatch({ type: "SET_VIEW", view: "chat" });
            void actions.createSession();
          }}
          className={cn(
            "flex h-9 w-full appearance-none items-center gap-2 rounded-md border-0 bg-transparent px-2 text-sm text-muted-foreground shadow-none transition hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
            !open && "justify-center px-0",
          )}
          title="New chat"
        >
          <SidebarIconSlot>
            <MessageSquarePlus size={16} />
          </SidebarIconSlot>
          {open && <span>New Chat</span>}
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="shrink-0 px-2 pb-2">
          <div className="relative">
            <div
              className={cn(
                "overflow-hidden transition-[max-height] duration-200 ease-out",
                navigationExpanded ? "max-h-80" : "max-h-[150px]",
              )}
              style={navigationExpanded
                ? undefined
                : { maskImage: collapsedNavigationMask, WebkitMaskImage: collapsedNavigationMask }}
            >
              {navigationItems.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={item.onClick}
                  className={cn(
                    "flex h-9 w-full appearance-none items-center gap-2 rounded-md border-0 bg-transparent px-2 text-sm text-muted-foreground shadow-none transition hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                    item.active && "bg-sidebar-accent text-sidebar-accent-foreground",
                    item.gapClass,
                    !open && "justify-center px-0",
                  )}
                  title={translateCopy(sidebarState.language, item.title)}
                >
                  <SidebarIconSlot>{item.icon}</SidebarIconSlot>
                  {open && <span>{translateCopy(sidebarState.language, item.label)}</span>}
                </button>
              ))}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setNavigationExpanded((current) => !current)}
            className={cn(
              "mt-1 flex h-7 w-full items-center justify-center gap-1 rounded-md text-[12px] font-medium text-muted-foreground transition hover:bg-sidebar-accent hover:text-sidebar-accent-foreground active:scale-95",
              !open && "px-0",
            )}
            title={sidebarState.language === "zh" ? navigationToggleLabel : navigationExpanded ? "Collapse navigation" : "Expand navigation"}
            aria-expanded={navigationExpanded}
          >
            <ChevronDown
              size={14}
              className={cn("transition-transform duration-200", navigationExpanded && "rotate-180")}
            />
            {open && <span>{navigationToggleLabel}</span>}
          </button>
        </div>

        {open && (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-2 pb-2">
            <div className="min-h-0 flex-1 overflow-y-auto pr-1">
              <section>
                <SidebarSectionHeader
                  title="Projects"
                  action={(
                    <button
                      type="button"
                      onClick={() => void actions.addProjectFromDialog()}
                      className={SIDEBAR_ACTION_BUTTON_CLASS}
                      title="Select folder"
                    >
                      <Plus size={14} />
                    </button>
                  )}
                />
                <div className="flex flex-col gap-0.5">
                  {projects.map((project) => {
                    const showAllSessions = expandedSessionLists[project.projectId] ?? false;
                    const visibleSessions = showAllSessions
                      ? project.sessions
                      : visibleSidebarSessions(
                          project.sessions,
                          MAX_VISIBLE_PROJECT_SESSIONS,
                          sidebarState.selectedSessionId,
                        );
                    const hiddenSessionCount = Math.max(0, project.sessions.length - visibleSessions.length);
                    return (
                      <div key={project.projectId} className="group/project rounded-lg">
                        <div className="flex items-center">
                          <button
                            type="button"
                            onClick={() => {
                              dispatch({ type: "SELECT_PROJECT", projectId: project.projectId });
                              dispatch({ type: "TOGGLE_PROJECT_SECTION", projectId: project.projectId });
                            }}
                            className="group/project-button flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                            title={project.rootPath}
                          >
                            <span className="text-muted-foreground/85 group-hover/project-button:text-sidebar-accent-foreground/80">
                              {project.expanded ? <FolderOpen size={14} /> : <Folder size={14} />}
                            </span>
                            <div className="min-w-0 flex-1 truncate font-medium">{project.label}</div>
                          </button>
                          <button
                            type="button"
                            onClick={() => void actions.createProjectSession(project.projectId)}
                            className={cn(
                              SIDEBAR_ACTION_BUTTON_CLASS,
                              "opacity-0 group-hover/project:opacity-100 focus-visible:opacity-100",
                            )}
                            title="New project session"
                          >
                            <Plus size={14} />
                          </button>
                        </div>
                        {project.expanded && (
                          <div className={cn(SESSION_COLUMN_INDENT, "pt-0")}>
                            {project.sessions.length === 0 ? (
                              <div className="px-2.5 py-1.5 text-[12px] text-muted-foreground/75">No chats yet</div>
                            ) : (
                              <div className="flex flex-col gap-0">
                                {visibleSessions.map((session) => {
                                  const selected = chatSessionSelected && session.id === sidebarState.selectedSessionId;
                                  return (
                                    <SessionRow
                                      key={session.id}
                                      title={session.title}
                                      status={session.status}
                                      selected={selected}
                                      confirmOpen={confirmArchiveSessionId === session.id}
                                      onClick={() => void actions.selectSession(session.id)}
                                      onPrefetch={() => void actions.prefetchSession(session.id)}
                                      onArchiveRequest={() => setConfirmArchiveSessionId(session.id)}
                                      onArchiveCancel={() => setConfirmArchiveSessionId(undefined)}
                                      onArchiveConfirm={() => {
                                        setConfirmArchiveSessionId(undefined);
                                        void actions.archiveSession(session.id);
                                      }}
                                    />
                                  );
                                })}
                                {hiddenSessionCount > 0 && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setExpandedSessionLists((current) => ({
                                        ...current,
                                        [project.projectId]: true,
                                      }));
                                    }}
                                    className="flex min-h-[32px] items-center px-2.5 text-left text-[12px] text-muted-foreground transition hover:text-foreground"
                                  >
                                    Show {hiddenSessionCount} more
                                  </button>
                                )}
                                {showAllSessions && project.sessions.length > MAX_VISIBLE_PROJECT_SESSIONS && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setExpandedSessionLists((current) => ({
                                        ...current,
                                        [project.projectId]: false,
                                      }));
                                    }}
                                    className="flex min-h-[32px] items-center px-2.5 text-left text-[12px] text-muted-foreground transition hover:text-foreground"
                                  >
                                    Show less
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>

              <section className={cn("mt-4", showSectionDivider && "border-t border-sidebar-border/70 pt-4")}>
                <SidebarSectionHeader
                  title="Chats"
                  action={(
                    <button
                      type="button"
                      onClick={() => {
                        dispatch({ type: "SET_VIEW", view: "chat" });
                        void actions.createSession();
                      }}
                      className={SIDEBAR_ACTION_BUTTON_CLASS}
                      title="New chat"
                    >
                      <Plus size={14} />
                    </button>
                  )}
                />
                <div className={cn("flex flex-col gap-0", SESSION_COLUMN_INDENT)}>
                  {recentChats.length === 0 ? (
                    <div className="px-2.5 py-1.5 text-[12px] text-muted-foreground/75">No chats yet</div>
                  ) : (
                    recentChats.map((session) => {
                      const selected = chatSessionSelected && session.id === sidebarState.selectedSessionId;
                      return (
                        <SessionRow
                          key={session.id}
                          title={session.title}
                          status={session.status}
                          selected={selected}
                          confirmOpen={confirmArchiveSessionId === session.id}
                          onClick={() => void actions.selectSession(session.id)}
                          onPrefetch={() => void actions.prefetchSession(session.id)}
                          onArchiveRequest={() => setConfirmArchiveSessionId(session.id)}
                          onArchiveCancel={() => setConfirmArchiveSessionId(undefined)}
                          onArchiveConfirm={() => {
                            setConfirmArchiveSessionId(undefined);
                            void actions.archiveSession(session.id);
                          }}
                        />
                      );
                    })
                  )}
                </div>
              </section>
            </div>
          </div>
        )}
      </div>

      <footer className="border-t border-sidebar-border p-2">
        <div className="flex flex-col gap-1">
          <button
            onClick={() => dispatch({ type: "SET_SETTINGS_OPEN", open: true })}
            className={cn(
              "flex h-9 items-center gap-2 rounded-md px-2 text-sm text-muted-foreground transition hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              !open && "justify-center px-0",
              sidebarState.settingsOpen && "bg-sidebar-accent text-sidebar-accent-foreground",
            )}
            title="Settings"
          >
            <SidebarIconSlot>
              <Settings size={16} />
            </SidebarIconSlot>
            {open && <span>Settings</span>}
          </button>
        </div>
      </footer>
      <SessionSearchDialog
        open={sessionSearchOpen}
        query={sessionSearchQuery}
        results={sessionSearchResults}
        onQueryChange={setSessionSearchQuery}
        onOpenChange={setSessionSearchOpen}
        onSelect={selectSearchSession}
        onPrefetch={(sessionId) => void actions.prefetchSession(sessionId)}
      />
    </aside>
  );
});
