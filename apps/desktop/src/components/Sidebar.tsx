import { Bot, MessageSquare, Search, Settings, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { StatusPill } from "./StatusPill";
import { useWorkbench } from "../lib/state";
import { buildWorkbenchViewModel } from "../lib/viewModel";
import { useMemo } from "react";
import type { AppView } from "../types";

const navItems: { view: AppView; label: string; icon: typeof MessageSquare }[] = [
  { view: "chat", label: "Chat", icon: MessageSquare },
  { view: "chat", label: "Agents", icon: Bot },
  { view: "settings", label: "Settings", icon: Settings },
];

export function Sidebar() {
  const { state, dispatch } = useWorkbench();

  const viewModel = useMemo(() => {
    if (state.patterns.length === 0 || state.sessions.length === 0) return undefined;
    return buildWorkbenchViewModel(state.patterns, state.sessions, state.selectedPattern, state.selectedSessionId);
  }, [state.patterns, state.sessions, state.selectedPattern, state.selectedSessionId]);

  const sessions = viewModel?.sessions ?? [];
  const selectedSessionId = state.selectedSessionId;
  const collapsed = state.sidebarCollapsed;

  return (
    <aside
      className={`flex shrink-0 flex-col border-r border-bench-200 bg-bench-50 transition-all duration-200 ${
        collapsed ? "w-[68px]" : "w-[260px]"
      }`}
    >
      {/* Logo / brand */}
      <div className="flex items-center gap-2 border-b border-bench-200 px-4 py-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-bench-900 text-bench-50 shadow-pane">
          <MessageSquare size={18} />
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-bench-700">Ora</p>
            <h1 className="text-sm font-semibold leading-tight">Agent Chat</h1>
          </div>
        )}
      </div>

      {/* Navigation icons */}
      <div className={`flex ${collapsed ? "flex-col items-center" : "flex-row"} gap-1 border-b border-bench-200 px-2 py-2`}>
        {navItems.map(({ view, label, icon: Icon }) => {
          const isActive =
            (label === "Chat" && state.activeView === "chat") ||
            (label === "Agents" && state.activeView === "chat") ||
            (label === "Settings" && state.activeView === "settings");
          return (
            <button
              key={label}
              onClick={() => dispatch({ type: "SET_VIEW", view })}
              className={`flex items-center gap-2 rounded-md px-3 py-2 text-xs font-semibold transition active:scale-95 ${
                isActive
                  ? "bg-bench-900 text-white"
                  : "text-bench-700 hover:bg-white hover:shadow-sm"
              } ${collapsed ? "h-10 w-10 justify-center p-0" : "flex-1"}`}
              title={label}
            >
              <Icon size={18} strokeWidth={1.8} />
              {!collapsed && label}
            </button>
          );
        })}
      </div>

      {/* Session list */}
      {!collapsed && (
        <>
          <div className="px-3 pt-3 pb-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-bench-700">Conversations</p>
              <button
                className="rounded-md border border-bench-200 bg-white p-1 text-bench-700 shadow-sm transition hover:text-bench-900 active:scale-95"
                title="New conversation"
              >
                <Plus size={14} />
              </button>
            </div>
            <div className="mt-2 flex items-center gap-2 rounded-md border border-bench-200 bg-white px-3 py-1.5 text-sm text-bench-700">
              <Search size={14} />
              <span className="text-xs">Search conversations</span>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
            <div className="space-y-1">
              {sessions.map((session) => (
                <button
                  key={session.id}
                  onClick={() => dispatch({ type: "SELECT_SESSION", sessionId: session.id })}
                  className={`w-full rounded-lg p-2.5 text-left transition duration-150 active:scale-[0.99] ${
                    selectedSessionId === session.id
                      ? "bg-white shadow-pane ring-1 ring-inset ring-bench-200"
                      : "hover:bg-white/70"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="truncate text-sm font-semibold leading-5">{session.title}</p>
                    <StatusPill status={session.status} />
                  </div>
                  <p className="mt-1 truncate text-xs text-bench-700">{session.project}</p>
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Collapse toggle */}
      <div className="border-t border-bench-200 p-3">
        <button
          onClick={() => dispatch({ type: "TOGGLE_SIDEBAR" })}
          className="flex w-full items-center justify-center rounded-md border border-bench-200 bg-white p-2 text-bench-700 shadow-sm transition hover:text-bench-900 active:scale-95"
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </div>
    </aside>
  );
}
