import {
  Bot,
  ChartNoAxesColumn,
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  MessageSquarePlus,
  Plus,
  Search,
  Settings,
} from "lucide-react";
import { useWorkbench } from "../lib/state";
import { useRunActions } from "../lib/useRunActions";
import { cn } from "../lib/utils";
import type { RunStatus } from "../types";
import { SidebarTrigger, useSidebar } from "./ui/sidebar";
import { StatusPill } from "./StatusPill";

function statusFromSession(status: string | undefined): RunStatus {
  if (status === "interrupted") return "approval_required";
  if (status === "failed" || status === "cancelled") return "failed";
  if (status === "running" || status === "queued") return "running";
  return "done";
}

export function Sidebar() {
  const { state, dispatch } = useWorkbench();
  const { actions } = useRunActions();
  const { open } = useSidebar();
  const projects = state.projects.map((project) => ({
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
  }));
  const recentChats = state.sessions
    .filter((session) => !session.projectId)
    .sort((a, b) => b.updatedAt - a.updatedAt || a.sessionId.localeCompare(b.sessionId))
    .map((session) => ({
      id: session.sessionId,
      title: session.title,
      status: statusFromSession(session.status),
    }));

  return (
    <aside
      data-state={open ? "expanded" : "collapsed"}
      className={cn(
        "hidden h-screen shrink-0 bg-background text-sidebar-foreground transition-[width] duration-200 ease-linear md:flex md:flex-col",
        open ? "w-72" : "w-12",
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
          {open && (
            <button
              type="button"
              className="flex h-9 w-full appearance-none items-center gap-2 rounded-md border-0 bg-transparent px-2 text-sm text-muted-foreground shadow-none transition hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              title="Search"
            >
              <Search size={14} />
              <span>Search</span>
            </button>
          )}
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
                <div className="flex items-center justify-between px-2 pb-2 pt-1">
                  <span className="text-xs font-medium text-muted-foreground">Projects</span>
                  <button
                    type="button"
                    onClick={() => void actions.addProjectFromDialog()}
                    className="rounded-md p-1 text-muted-foreground transition hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                    title="Select folder"
                  >
                    <Plus size={14} />
                  </button>
                </div>
                <div className="flex flex-col gap-1">
                  {projects.map((project) => {
                    const selectedProject = state.selectedProjectId === project.projectId;
                    return (
                      <div key={project.projectId} className="rounded-md">
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              dispatch({ type: "SELECT_PROJECT", projectId: project.projectId });
                              dispatch({ type: "TOGGLE_PROJECT_SECTION", projectId: project.projectId });
                            }}
                            className={cn(
                              "flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-2 text-left text-sm transition",
                              selectedProject ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-muted-foreground hover:bg-sidebar-accent/70",
                            )}
                            title={project.rootPath}
                          >
                            {project.expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                            {project.expanded ? <FolderOpen size={14} /> : <Folder size={14} />}
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-[13px] font-medium">{project.label}</div>
                              <div className="truncate text-[11px] text-muted-foreground">{project.sessions.length} session{project.sessions.length === 1 ? "" : "s"}</div>
                            </div>
                          </button>
                          <button
                            type="button"
                            onClick={() => void actions.createProjectSession(project.projectId)}
                            className="rounded-md p-1.5 text-muted-foreground transition hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                            title="New project session"
                          >
                            <MessageSquarePlus size={14} />
                          </button>
                        </div>
                        {project.expanded && project.sessions.length > 0 && (
                          <div className="mt-1 flex flex-col gap-1 pl-8">
                            {project.sessions.map((session) => {
                              const selected = session.id === state.selectedSessionId;
                              return (
                                <button
                                  key={session.id}
                                  onClick={() => void actions.selectSession(session.id)}
                                  className={cn(
                                    "flex min-h-[40px] w-full items-center rounded-md px-2 py-2 text-left text-sm transition",
                                    selected ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-muted-foreground hover:bg-sidebar-accent/70",
                                  )}
                                >
                                  <div className="min-w-0 flex-1">
                                    <div className="truncate text-[13px] font-medium">{session.title}</div>
                                  </div>
                                  <StatusPill status={session.status} />
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>

              {recentChats.length > 0 && (
                <section className="mt-4">
                  <div className="px-2 pb-2 pt-1 text-xs font-medium text-muted-foreground">Recent Chats</div>
                  <div className="flex flex-col gap-1">
                    {recentChats.map((session) => {
                      const selected = session.id === state.selectedSessionId;
                      return (
                        <button
                          key={session.id}
                          onClick={() => void actions.selectSession(session.id)}
                          className={cn(
                            "group relative flex min-h-[44px] w-full items-center rounded-md px-2 py-2 text-left text-sm transition",
                            selected ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-muted-foreground hover:bg-sidebar-accent/70",
                          )}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[13px] font-medium">{session.title}</div>
                            <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                              <span className="truncate">Recent chat</span>
                              <span>·</span>
                              <StatusPill status={session.status} />
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </section>
              )}
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
