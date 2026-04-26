import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Bot,
  ChartNoAxesColumn,
  Folder,
  FolderOpen,
  GitBranchPlus,
  MessageSquarePlus,
  Plus,
  Search,
  Settings,
  Sparkles,
} from "lucide-react";
import { useWorkbench } from "../lib/state";
import { useRunActions } from "../lib/useRunActions";
import { cn } from "../lib/utils";
import type { RunStatus } from "../types";
import { SidebarTrigger, useSidebar } from "./ui/sidebar";

const MAX_VISIBLE_PROJECT_SESSIONS = 4;
const MAX_VISIBLE_PREFETCH_SESSIONS = 12;
const SESSION_COLUMN_INDENT = "pl-[1.375rem]";

function statusFromSession(status: string | undefined): RunStatus {
  if (status === "interrupted") return "approval_required";
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

  if (status === "failed") {
    return <span className="h-2 w-2 shrink-0 rounded-full bg-rose-500/75" />;
  }

  return null;
}

function SessionRow({
  title,
  status,
  selected,
  onClick,
  onPrefetch,
}: {
  title: string;
  status: RunStatus;
  selected: boolean;
  onClick: () => void;
  onPrefetch: () => void;
}) {
  return (
    <button
      onClick={onClick}
      onMouseEnter={onPrefetch}
      onFocus={onPrefetch}
      className={cn(
        "group flex min-h-[36px] w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        selected
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "text-muted-foreground",
      )}
    >
      {status !== "done" && <SessionLeadingIndicator status={status} />}
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{title}</div>
      </div>
      <SessionStatusBadge status={status} />
    </button>
  );
}

export function Sidebar() {
  const { state, dispatch } = useWorkbench();
  const { actions } = useRunActions();
  const { open } = useSidebar();
  const [expandedSessionLists, setExpandedSessionLists] = useState<Record<string, boolean>>({});
  const projects = useMemo(() => state.projects.map((project) => ({
    ...project,
    expanded: state.expandedProjectIds[project.projectId] ?? true,
    sessions: state.sessions
      .filter((session) => session.projectId === project.projectId)
      .sort((a, b) => b.updatedAt - a.updatedAt || a.sessionId.localeCompare(b.sessionId))
      .map((session) => ({
        id: session.sessionId,
        title: session.title,
        status: statusFromSession(session.status),
      })),
  })), [state.expandedProjectIds, state.projects, state.sessions]);
  const recentChats = useMemo(() => state.sessions
    .filter((session) => !session.projectId)
    .sort((a, b) => b.updatedAt - a.updatedAt || a.sessionId.localeCompare(b.sessionId))
    .map((session) => ({
      id: session.sessionId,
      title: session.title,
      status: statusFromSession(session.status),
    })), [state.sessions]);
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
            <div className="ml-1 cursor-default font-serif text-[15px] text-primary">Ora</div>
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
                                      onClick={() => void actions.selectSession(session.id)}
                                      onPrefetch={() => void actions.prefetchSession(session.id)}
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
                            onClick={() => void actions.selectSession(session.id)}
                            onPrefetch={() => void actions.prefetchSession(session.id)}
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
    </aside>
  );
}
