import { Bot, ChartNoAxesColumn, MessageSquarePlus, Search, Settings } from "lucide-react";
import { useWorkbench } from "../lib/state";
import { useRunActions } from "../lib/useRunActions";
import { cn } from "../lib/utils";
import type { AppView, RunStatus } from "../types";
import { SidebarTrigger, useSidebar } from "./ui/sidebar";
import { StatusPill } from "./StatusPill";

const navItems: { view: AppView; label: string; icon: typeof Settings }[] = [
  { view: "settings", label: "Settings", icon: Settings },
];

export function Sidebar() {
  const { state, dispatch } = useWorkbench();
  const { actions } = useRunActions();
  const { open } = useSidebar();
  const sessions = state.sessions.map((session) => ({
    id: session.sessionId,
    title: session.title,
    project: session.projectId ?? "Ora MVP",
    status: (session.status === "interrupted"
      ? "approval_required"
      : session.status === "failed" || session.status === "cancelled"
        ? "failed"
        : session.status === "running" || session.status === "queued"
          ? "running"
          : "done") as RunStatus,
  }));

  return (
    <aside
      data-state={open ? "expanded" : "collapsed"}
      className={cn(
        "hidden h-screen shrink-0 bg-background text-sidebar-foreground transition-[width] duration-200 ease-linear md:flex md:flex-col",
        open ? "w-64" : "w-12",
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
            onClick={() => dispatch({ type: "SET_VIEW", view: "chat" })}
            className={cn(
              "mt-2 flex h-9 w-full appearance-none items-center gap-2 rounded-md border-0 bg-transparent px-2 text-sm text-muted-foreground shadow-none transition hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              state.activeView === "chat" && "bg-sidebar-accent text-sidebar-accent-foreground",
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

        {open && sessions.length > 0 && (
          <section className="min-h-0 px-2">
            <div className="px-2 pb-2 pt-1 text-xs font-medium text-muted-foreground">Recent Chats</div>
            <div className="flex max-h-[calc(100vh-210px)] flex-col gap-1 overflow-y-auto pr-1">
              {sessions.map((session) => {
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
                        <span className="truncate">{session.project}</span>
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

      <footer className="border-t border-sidebar-border p-2">
        <div className="flex flex-col gap-1">
          {navItems.map(({ view, label, icon: Icon }) => {
            const active = label === "Settings" && state.activeView === "settings";
            return (
              <button
                key={label}
                onClick={() => dispatch({ type: "SET_VIEW", view })}
                className={cn(
                  "flex h-9 items-center gap-2 rounded-md px-2 text-sm text-muted-foreground transition hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                  !open && "justify-center px-0",
                  active && "bg-sidebar-accent text-sidebar-accent-foreground",
                )}
                title={label}
              >
                <Icon size={16} />
                {open && <span>{label}</span>}
              </button>
            );
          })}
        </div>
      </footer>
    </aside>
  );
}
