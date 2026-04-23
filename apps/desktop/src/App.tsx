import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import { AppShell } from "./components/AppShell";
import { ApprovalModal } from "./components/ApprovalModal";
import { AgentsView } from "./components/AgentsView";
import { ChatView } from "./components/ChatView";
import { EvaluationView } from "./components/EvaluationView";
import { SettingsView } from "./components/SettingsView";
import { TrailsDrawer } from "./components/TrailsDrawer";
import { useRunActions } from "./lib/useRunActions";
import { useWorkbench, WorkbenchProvider } from "./lib/state";
import { cn } from "./lib/utils";
import { adaptChatMessages } from "./lib/viewModel";

const DEFAULT_DETAIL_PANEL_WIDTH = 460;
const MIN_DETAIL_PANEL_WIDTH = 360;
const MIN_MAIN_PANEL_WIDTH = 640;

function WorkspacePane({ children, className, style }: { children: ReactNode; className?: string; style?: CSSProperties }) {
  return (
    <section
      className={cn(
        "relative flex h-full min-h-0 overflow-hidden rounded-[24px] border border-black/[0.025] bg-sidebar shadow-[0_1px_1px_rgba(23,23,23,0.04),0_8px_18px_rgba(23,23,23,0.024)]",
        className,
      )}
      style={style}
    >
      {children}
    </section>
  );
}

function WorkbenchInner() {
  const { state, dispatch } = useWorkbench();
  const { runtimeClient, viewModel, selectedSession, selectedNode, selectedBeat, selectedAgent, selectedCheckpoint, actions } = useRunActions();
  const splitContainerRef = useRef<HTMLDivElement>(null);
  const [detailPanelWidth, setDetailPanelWidth] = useState(DEFAULT_DETAIL_PANEL_WIDTH);

  function clampDetailPanelWidth(nextWidth: number) {
    const containerWidth = splitContainerRef.current?.getBoundingClientRect().width ?? 0;
    if (containerWidth <= 0) return nextWidth;

    const maxAllowedWidth = Math.max(
      MIN_DETAIL_PANEL_WIDTH,
      Math.min(720, containerWidth - MIN_MAIN_PANEL_WIDTH - 24),
    );

    return Math.min(Math.max(nextWidth, MIN_DETAIL_PANEL_WIDTH), maxAllowedWidth);
  }

  function handleDetailResizeStart(event: PointerEvent<HTMLButtonElement>) {
    if (!state.detailDrawerOpen) return;

    event.preventDefault();
    const startX = event.clientX;
    const startWidth = detailPanelWidth;

    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const handlePointerMove = (moveEvent: globalThis.PointerEvent) => {
      const deltaX = moveEvent.clientX - startX;
      setDetailPanelWidth(clampDetailPanelWidth(startWidth - deltaX));
    };

    const handlePointerUp = () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        dispatch({ type: "RESET_RUNTIME_VIEW" });
        const bootstrap = await runtimeClient.bootstrap();
        const projects = await runtimeClient.listProjects();
        if (cancelled) return;
        dispatch({
          type: "BOOTSTRAP",
          patterns: bootstrap.patterns,
          projects,
          providerRegistry: bootstrap.providerRegistry,
          toolRegistry: bootstrap.toolRegistry,
          skillRegistry: bootstrap.skillRegistry,
          providerSecretStatuses: bootstrap.providerSecretStatuses,
          health: bootstrap.health,
        });
        const sessions = await runtimeClient.listSessions();
        const firstSession = sessions[0] ?? await runtimeClient.createSession();
        const detail = await runtimeClient.getSession(firstSession.sessionId);
        if (cancelled) return;
        dispatch({
          type: "HYDRATE_SESSION",
          projects,
          sessions: firstSession === sessions[0] ? sessions : [firstSession, ...sessions],
          detail,
        });
      } catch (error) {
        if (cancelled) return;
        dispatch({
          type: "SET_BRIDGE_STATUS",
          status: {
            mode: "error",
            ok: false,
            label: "Runtime error",
            detail: error instanceof Error ? error.message : "Runtime bridge failed to initialize.",
          },
        });
      }
    })();
    return () => { cancelled = true; };
  }, [runtimeClient, dispatch]);

  useEffect(() => {
    if (!state.detailDrawerOpen) return;

    const syncPanelWidth = () => {
      setDetailPanelWidth((currentWidth) => clampDetailPanelWidth(currentWidth));
    };

    syncPanelWidth();
    window.addEventListener("resize", syncPanelWidth);
    return () => window.removeEventListener("resize", syncPanelWidth);
  }, [state.detailDrawerOpen]);

  // Chat messages derived from events
  const chatMessages = useMemo(() => {
    return adaptChatMessages(state.activeSessionDetail?.transcript ?? [], state.activeSnapshot);
  }, [state.activeSessionDetail, state.activeSnapshot]);
  const settingsDialog = (
    <SettingsView
      open={state.settingsOpen}
      onOpenChange={(open) => dispatch({ type: "SET_SETTINGS_OPEN", open })}
    />
  );

  // Loading / error state
  if (!viewModel || !selectedSession || !state.bridgeStatus) {
    return (
      <AppShell>
        {settingsDialog}
        <WorkspacePane className="w-full">
          <div className="flex h-full items-center justify-center">
            <div className="rounded-lg bg-white p-5 shadow-pane ring-1 ring-inset ring-bench-200">
              <p className="text-sm font-semibold">{state.bridgeStatus?.label ?? "Loading"}</p>
              <p className="mt-2 max-w-sm text-xs leading-5 text-bench-700">{state.bridgeStatus?.detail ?? "Connecting..."}</p>
            </div>
          </div>
        </WorkspacePane>
      </AppShell>
    );
  }

  if (state.activeView === "evaluation") {
    return (
      <AppShell>
        {settingsDialog}
        <WorkspacePane className="w-full">
          <EvaluationView runtimeClient={runtimeClient} bridgeStatus={state.bridgeStatus} />
        </WorkspacePane>
      </AppShell>
    );
  }

  if (state.activeView === "agents") {
    return (
      <AppShell>
        {settingsDialog}
        <WorkspacePane className="w-full">
          <AgentsView
            runtimeClient={runtimeClient}
            selectedCustomAgentId={state.selectedCustomAgentId}
            onStartChat={actions.openAgentChat}
            onClearSelectedCustomAgent={actions.clearSelectedCustomAgent}
          />
        </WorkspacePane>
      </AppShell>
    );
  }

  // Chat view (default)
  const { actions: actionRecords, agents, artifacts, checkpoints, patternCards, planItems, streamLines, topologyEdges, topologyNodes, activePattern } = viewModel;
  const isRunning = selectedSession.status === "running";
  const isApprovalRequired = selectedSession.status === "approval_required";
  const pendingApprovals = actionRecords.filter((a) => a.state === "approval_required");
  const nextApproval = pendingApprovals[0];

  return (
    <AppShell>
      {settingsDialog}
      {isApprovalRequired && nextApproval && (
        <ApprovalModal action={nextApproval} onResume={actions.resumeRun} onCancel={actions.cancelRun} disabled={state.busyCommand !== undefined} />
      )}
      <div ref={splitContainerRef} className="flex h-full min-h-0 items-stretch gap-0.5">
        <WorkspacePane className="min-w-0 flex-1">
          <ChatView
            activePattern={activePattern}
            sessionTurns={viewModel.turns}
            selectedTurnRunId={state.selectedTurnRunId}
            selectedCustomAgentId={state.selectedCustomAgentId}
            activeSnapshot={state.activeSnapshot}
            agents={agents}
            busyCommand={state.busyCommand}
            chatMessages={chatMessages}
            checkpoints={checkpoints}
            patternCards={patternCards}
            composerPrompt={state.promptText}
            isLoading={state.isLoading}
            isRunning={isRunning}
            isApprovalRequired={isApprovalRequired}
            planItems={planItems}
            actionRecords={actionRecords}
            selectedSession={selectedSession}
            streamLines={streamLines}
            topologyEdges={topologyEdges}
            topologyNodes={topologyNodes}
            onCancelRun={actions.cancelRun}
            onComposerPromptChange={(text) => dispatch({ type: "SET_PROMPT", text })}
            onClearSelectedCustomAgent={actions.clearSelectedCustomAgent}
            onExportReport={actions.exportReport}
            onForkRun={actions.forkRun}
            onInterruptRun={actions.interruptRun}
            onReplaySelection={actions.replaySelection}
            onResumeRun={actions.resumeRun}
            onSelectNode={(id) => dispatch({ type: "SELECT_NODE", nodeId: id })}
            onSelectTurn={actions.selectTurn}
            onStartRun={actions.startRun}
            onToggleDetailDrawer={() => dispatch({ type: "TOGGLE_DETAIL_DRAWER" })}
            detailDrawerOpen={state.detailDrawerOpen}
          />
        </WorkspacePane>

        {state.detailDrawerOpen && (
          <>
            <button
              type="button"
              aria-label="Resize trails panel"
              onPointerDown={handleDetailResizeStart}
              className="group flex h-full w-1.5 shrink-0 cursor-col-resize items-center justify-center bg-transparent"
            >
              <span className="h-10 w-0.5 rounded-full bg-black/90 transition-colors group-hover:bg-black" />
            </button>

            <WorkspacePane
              className="min-w-0 shrink-0 flex-none"
              style={{ width: detailPanelWidth }}
            >
              <TrailsDrawer
                open={state.detailDrawerOpen}
                onClose={() => dispatch({ type: "TOGGLE_DETAIL_DRAWER" })}
                actions={actionRecords}
                agents={agents}
                artifacts={artifacts}
                activeSnapshot={state.activeSnapshot}
                busyCommand={state.busyCommand}
                checkpoints={checkpoints}
                commandFeedback={state.commandFeedback}
                planItems={planItems}
                selectedAgent={selectedAgent}
                selectedBeat={selectedBeat}
                selectedCheckpoint={selectedCheckpoint}
                selectedNode={selectedNode}
                selectedSession={selectedSession}
                onExportReport={actions.exportReport}
                onForkRun={actions.forkRun}
                onResumeRun={actions.resumeRun}
                onCancelRun={actions.cancelRun}
              />
            </WorkspacePane>
          </>
        )}
      </div>
    </AppShell>
  );
}

export function App() {
  return (
    <WorkbenchProvider>
      <WorkbenchInner />
    </WorkbenchProvider>
  );
}
