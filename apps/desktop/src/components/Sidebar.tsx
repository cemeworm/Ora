import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Archive,
  Bot,
  ChartNoAxesColumn,
  CheckCircle2,
  ChevronDown,
  Folder,
  FolderOpen,
  GitBranchPlus,
  MessageSquare,
  MessageSquarePlus,
  Plus,
  RotateCcw,
  Search,
  Settings,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useWorkbench } from "../lib/state";
import {
  getSharedRuntimeClient,
  type OraPackageManifest,
} from "../lib/runtimeClient";
import { buildSessionSearchResults, type SessionSearchResult } from "../lib/sessionSearch";
import { useRunActions } from "../lib/useRunActions";
import { cn } from "../lib/utils";
import type { RunStatus } from "../types";
import { Dialog, DialogContent } from "./ui/dialog";
import { SidebarTrigger, useSidebar } from "./ui/sidebar";

const MAX_VISIBLE_PROJECT_SESSIONS = 4;
const MAX_VISIBLE_PREFETCH_SESSIONS = 12;
const MAX_SESSION_SEARCH_RESULTS = 9;
const SESSION_COLUMN_INDENT = "pl-[1.375rem]";

function statusFromSession(status: string | undefined, hasPendingClarifications?: boolean): RunStatus {
  if (status === "interrupted") return hasPendingClarifications ? "clarification_required" : "approval_required";
  if (status === "failed" || status === "cancelled") return "failed";
  if (status === "running" || status === "queued") return "running";
  return "done";
}

function SidebarSectionHeader({
  title,
  action,
}: {
  title: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between px-2 pb-2 pt-1">
      <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground/80">{title}</span>
      {action}
    </div>
  );
}

function VersionSelector() {
  const { state, dispatch } = useWorkbench();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | undefined>();
  const store = state.packageStore;
  const active = store?.packages.find((item) => item.versionId === store.active.activeVersionId)
    ?? store?.packages.find((item) => item.status === "active");
  const packages = store?.packages ?? [];

  async function refresh(nextFeedback?: string) {
    const packageStore = await getSharedRuntimeClient().activePackage();
    dispatch({ type: "SET_PACKAGE_STORE", packageStore });
    if (nextFeedback) {
      dispatch({ type: "SET_COMMAND_FEEDBACK", feedback: nextFeedback });
    }
  }

  async function runVersionAction(key: string, action: () => Promise<void>) {
    setBusy(key);
    try {
      await action();
    } finally {
      setBusy(undefined);
    }
  }

  if (!store) {
    return (
      <span className="inline-flex h-6 items-center rounded-md bg-sidebar-accent/70 px-2 text-[11px] font-medium text-muted-foreground">
        v...
      </span>
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="inline-flex h-6 max-w-[116px] items-center gap-1 rounded-md bg-sidebar-accent/75 px-1.5 text-[11px] font-medium text-sidebar-accent-foreground transition hover:bg-sidebar-accent active:scale-95"
        title="Ora package version"
        aria-label="Ora package version"
      >
        <span className="truncate">{active ? `v${active.semver}` : "bundled"}</span>
        <ChevronDown size={12} className={cn("transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="absolute left-0 top-[calc(100%+6px)] z-40 w-72 rounded-lg bg-popover p-2 text-popover-foreground shadow-lift">
          <div className="flex items-center justify-between px-2 pb-2 pt-1">
            <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Versions</span>
            <button
              type="button"
              onClick={() => void runVersionAction("rollback", async () => refreshAfterRollback(dispatch, setOpen))}
              disabled={!store.active.previousVersionId || busy !== undefined}
              className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[12px] text-muted-foreground transition hover:bg-sidebar-accent hover:text-sidebar-accent-foreground disabled:cursor-not-allowed disabled:opacity-40 active:scale-95"
              title="Rollback"
            >
              <RotateCcw size={12} />
              Rollback
            </button>
          </div>
          <div className="max-h-64 overflow-y-auto pr-1">
            {packages.map((item) => (
              <VersionRow
                key={item.versionId}
                item={item}
                active={item.versionId === store.active.activeVersionId}
                busy={busy !== undefined}
                onSwitch={() => void runVersionAction(item.versionId, async () => {
                  await getSharedRuntimeClient().switchPackage(item.versionId);
                  setOpen(false);
                  await refresh(`Ora package ${item.semver} is active.`);
                })}
              />
            ))}
            {packages.length === 0 && (
              <div className="px-2 py-3 text-sm text-muted-foreground">No package slots yet.</div>
            )}
          </div>
          <div className="mt-2 flex justify-end border-t border-border/70 pt-2">
            <button
              type="button"
              onClick={() => void runVersionAction("prune", async () => {
                const packageStore = await getSharedRuntimeClient().prunePackages(true);
                dispatch({ type: "SET_PACKAGE_STORE", packageStore });
                dispatch({ type: "SET_COMMAND_FEEDBACK", feedback: "Failed package slots pruned." });
              })}
              disabled={busy !== undefined}
              className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[12px] text-muted-foreground transition hover:bg-sidebar-accent hover:text-sidebar-accent-foreground disabled:opacity-40 active:scale-95"
              title="Prune failed slots"
            >
              <Trash2 size={12} />
              Prune failed
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function VersionRow({
  item,
  active,
  busy,
  onSwitch,
}: {
  item: OraPackageManifest;
  active: boolean;
  busy: boolean;
  onSwitch: () => void;
}) {
  const statusTone = item.status === "failed"
    ? "text-rose-700 bg-rose-100/75"
    : item.status === "previous"
      ? "text-amber-800 bg-amber-100/75"
      : active
        ? "text-emerald-800 bg-emerald-100/80"
        : "text-muted-foreground bg-sidebar-accent/70";
  return (
    <div className="flex min-h-[44px] items-center gap-2 rounded-md px-2 py-1.5 text-sm transition hover:bg-sidebar-accent/80">
      <CheckCircle2 size={14} className={active ? "text-emerald-700" : "text-muted-foreground/55"} />
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-foreground">v{item.semver}</div>
        <div className="truncate text-[11px] text-muted-foreground">{item.versionId}</div>
      </div>
      <span className={cn("shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium", statusTone)}>
        {active ? "active" : item.status}
      </span>
      {!active && item.verification.status === "passed" && (
        <button
          type="button"
          onClick={onSwitch}
          disabled={busy}
          className="h-7 rounded-md px-2 text-[12px] text-muted-foreground transition hover:bg-background/85 hover:text-foreground disabled:opacity-40 active:scale-95"
        >
          Switch
        </button>
      )}
    </div>
  );
}

async function refreshAfterRollback(
  dispatch: ReturnType<typeof useWorkbench>["dispatch"],
  setOpen: (open: boolean) => void,
) {
  const packageStore = await getSharedRuntimeClient().rollbackPackage();
  dispatch({ type: "SET_PACKAGE_STORE", packageStore });
  dispatch({ type: "SET_COMMAND_FEEDBACK", feedback: "Rolled back to the previous Ora package slot." });
  setOpen(false);
}

function SessionStatusBadge({ status }: { status: RunStatus }) {
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
    return <span className="h-3 w-3 shrink-0 rounded-full border border-muted-foreground/15 border-t-muted-foreground/55 animate-spin" />;
  }

  if (status === "approval_required") {
    return <span className="h-2 w-2 shrink-0 rounded-full bg-amber-500/80" />;
  }

  if (status === "clarification_required") {
    return <span className="h-2 w-2 shrink-0 rounded-full bg-blue-500/80" />;
  }

  if (status === "failed") {
    return <span className="h-2 w-2 shrink-0 rounded-full bg-rose-500/75" />;
  }

  return null;
}

function SessionRow({
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
          "mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition hover:bg-background/85 hover:text-foreground focus-visible:opacity-100 active:scale-95 group-hover/session:opacity-100",
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
}

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

export function Sidebar() {
  const { state, dispatch } = useWorkbench();
  const { actions } = useRunActions();
  const { open } = useSidebar();
  const [expandedSessionLists, setExpandedSessionLists] = useState<Record<string, boolean>>({});
  const [confirmArchiveSessionId, setConfirmArchiveSessionId] = useState<string | undefined>();
  const [sessionSearchOpen, setSessionSearchOpen] = useState(false);
  const [sessionSearchQuery, setSessionSearchQuery] = useState("");
  const projects = useMemo(() => state.projects.map((project) => ({
    ...project,
    expanded: state.expandedProjectIds[project.projectId] ?? true,
    sessions: state.sessions
      .filter((session) => session.projectId === project.projectId)
      .sort((a, b) => b.updatedAt - a.updatedAt || a.sessionId.localeCompare(b.sessionId))
      .map((session) => ({
        id: session.sessionId,
        title: session.title,
        status: statusFromSession(session.status, state.sessionPendingClarifications[session.sessionId]),
      })),
  })), [state.expandedProjectIds, state.projects, state.sessions, state.sessionPendingClarifications]);
  const sessionSearchResults = useMemo(
    () => buildSessionSearchResults(state.sessions, state.projects, sessionSearchQuery, MAX_SESSION_SEARCH_RESULTS),
    [sessionSearchQuery, state.projects, state.sessions],
  );
  const recentChats = useMemo(() => state.sessions
    .filter((session) => !session.projectId)
    .sort((a, b) => b.updatedAt - a.updatedAt || a.sessionId.localeCompare(b.sessionId))
    .map((session) => ({
      id: session.sessionId,
      title: session.title,
      status: statusFromSession(session.status, state.sessionPendingClarifications[session.sessionId]),
    })), [state.sessions, state.sessionPendingClarifications]);
  const showSectionDivider = projects.length > 0;
  const chatSessionSelected = state.activeView === "chat";
  const visiblePrefetchSessionIds = useMemo(() => {
    const ids = new Set<string>();
    for (const project of projects) {
      if (!project.expanded) continue;
      const showAllSessions = expandedSessionLists[project.projectId] ?? false;
      const visibleSessions = showAllSessions ? project.sessions : project.sessions.slice(0, MAX_VISIBLE_PROJECT_SESSIONS);
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
          <div className="flex items-center justify-between gap-2">
            <div className="ml-1 flex min-w-0 items-center gap-2">
              <div className="cursor-default font-serif text-[15px] text-primary">Ora</div>
              <VersionSelector />
            </div>
            <SidebarTrigger />
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
          <MessageSquarePlus size={16} />
          {open && <span>New Chat</span>}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        <div className="px-2 pb-2">
          <button
            type="button"
            onClick={openSessionSearch}
            className={cn(
              "flex h-9 w-full appearance-none items-center gap-2 rounded-md border-0 bg-transparent px-2 text-sm text-muted-foreground shadow-none transition hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              !open && "justify-center px-0",
            )}
            title="Search"
          >
            <Search size={14} />
            {open && <span>Search</span>}
          </button>
          <button
            onClick={() => dispatch({ type: "SET_VIEW", view: "agents" })}
            className={cn(
              "mt-2 flex h-9 w-full appearance-none items-center gap-2 rounded-md border-0 bg-transparent px-2 text-sm text-muted-foreground shadow-none transition hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              state.activeView === "agents" && "bg-sidebar-accent text-sidebar-accent-foreground",
              !open && "justify-center px-0",
            )}
            title="Agents"
          >
            <Bot size={16} />
            {open && <span>Agents</span>}
          </button>
          <button
            onClick={() => dispatch({ type: "SET_VIEW", view: "skills" })}
            className={cn(
              "mt-1 flex h-9 w-full appearance-none items-center gap-2 rounded-md border-0 bg-transparent px-2 text-sm text-muted-foreground shadow-none transition hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              state.activeView === "skills" && "bg-sidebar-accent text-sidebar-accent-foreground",
              !open && "justify-center px-0",
            )}
            title="Skills"
          >
            <Sparkles size={16} />
            {open && <span>Skills</span>}
          </button>
          <button
            onClick={() => dispatch({ type: "SET_VIEW", view: "modes" })}
            className={cn(
              "mt-1 flex h-9 w-full appearance-none items-center gap-2 rounded-md border-0 bg-transparent px-2 text-sm text-muted-foreground shadow-none transition hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              state.activeView === "modes" && "bg-sidebar-accent text-sidebar-accent-foreground",
              !open && "justify-center px-0",
            )}
            title="Modes"
          >
            <GitBranchPlus size={16} />
            {open && <span>Modes</span>}
          </button>
          <button
            onClick={() => dispatch({ type: "SET_VIEW", view: "evaluation" })}
            className={cn(
              "mt-1 flex h-9 w-full appearance-none items-center gap-2 rounded-md border-0 bg-transparent px-2 text-sm text-muted-foreground shadow-none transition hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              state.activeView === "evaluation" && "bg-sidebar-accent text-sidebar-accent-foreground",
              !open && "justify-center px-0",
            )}
            title="Evaluation"
          >
            <ChartNoAxesColumn size={16} />
            {open && <span>Evaluation</span>}
          </button>
        </div>

        {open && (
          <div className="flex h-full min-h-0 flex-col overflow-hidden px-2 pb-2">
            <div className="min-h-0 flex-1 overflow-y-auto pr-1">
              <section>
                <SidebarSectionHeader
                  title="Projects"
                  action={(
                    <button
                      type="button"
                      onClick={() => void actions.addProjectFromDialog()}
                      className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition hover:bg-sidebar-accent/65 hover:text-sidebar-accent-foreground"
                      title="Select folder"
                    >
                      <Plus size={14} />
                    </button>
                  )}
                />
                <div className="flex flex-col gap-0.5">
                  {projects.map((project) => {
                    const showAllSessions = expandedSessionLists[project.projectId] ?? false;
                    const visibleSessions = showAllSessions ? project.sessions : project.sessions.slice(0, MAX_VISIBLE_PROJECT_SESSIONS);
                    const hiddenSessionCount = Math.max(0, project.sessions.length - visibleSessions.length);
                    return (
                      <div key={project.projectId} className="group/project rounded-lg px-2">
                        <div className="flex items-center gap-1.5">
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
                            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition hover:bg-sidebar-accent/65 hover:text-sidebar-accent-foreground group-hover/project:opacity-100 focus-visible:opacity-100"
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
                                  const selected = chatSessionSelected && session.id === state.selectedSessionId;
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
                      className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition hover:bg-sidebar-accent/65 hover:text-sidebar-accent-foreground"
                      title="New chat"
                    >
                      <Plus size={14} />
                    </button>
                  )}
                />
                <div className="px-2">
                  <div className={cn("flex flex-col gap-0", SESSION_COLUMN_INDENT)}>
                    {recentChats.length === 0 ? (
                      <div className="px-2.5 py-1.5 text-[12px] text-muted-foreground/75">No chats yet</div>
                    ) : (
                      recentChats.map((session) => {
                        const selected = chatSessionSelected && session.id === state.selectedSessionId;
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
              state.settingsOpen && "bg-sidebar-accent text-sidebar-accent-foreground",
            )}
            title="Settings"
          >
            <Settings size={16} />
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
}
