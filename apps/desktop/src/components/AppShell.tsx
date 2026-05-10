import { useMemo } from "react";
import { Sidebar, type SidebarState } from "./Sidebar";
import { getActiveSnapshot, getPendingRunState, useWorkbench } from "../lib/state";
import { SidebarInset, SidebarProvider } from "./ui/sidebar";

export function AppShell({ children }: { children: React.ReactNode }) {
  const { state, dispatch } = useWorkbench();

  const sidebarState: SidebarState = useMemo(() => ({
    projects: state.projects,
    sessions: state.sessions,
    expandedProjectIds: state.expandedProjectIds,
    activeView: state.activeView,
    selectedSessionId: state.selectedSessionId,
    selectedTurnRunId: state.selectedTurnRunId,
    activeSessionDetail: state.activeSessionDetail,
    activeSnapshot: getActiveSnapshot(state.runLifecycle),
    pendingRun: getPendingRunState(state.runLifecycle),
    language: state.language,
    settingsOpen: state.settingsOpen,
  }), [
    state.projects,
    state.sessions,
    state.expandedProjectIds,
    state.activeView,
    state.selectedSessionId,
    state.selectedTurnRunId,
    state.activeSessionDetail,
    getActiveSnapshot(state.runLifecycle),
    getPendingRunState(state.runLifecycle),
    state.language,
    state.settingsOpen,
  ]);

  return (
    <SidebarProvider
      open={!state.sidebarCollapsed}
      onOpenChange={() => dispatch({ type: "TOGGLE_SIDEBAR" })}
    >
      <Sidebar sidebarState={sidebarState} />
      <SidebarInset className="h-screen min-h-[720px] overflow-hidden antialiased">
        <div className="h-full w-full pb-1.5 pl-0.5 pr-1.5 pt-1.5 md:pb-2 md:pl-1 md:pr-2 md:pt-2">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
