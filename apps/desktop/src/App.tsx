import { useEffect, useMemo } from "react";
import { AppShell } from "./components/AppShell";
import { ApprovalModal } from "./components/ApprovalModal";
import { ChatView } from "./components/ChatView";
import { DetailDrawer } from "./components/DetailDrawer";
import { SettingsView } from "./components/SettingsView";
import { useRunActions } from "./lib/useRunActions";
import { useWorkbench, WorkbenchProvider } from "./lib/state";
import { adaptChatMessages } from "./lib/viewModel";

function WorkbenchInner() {
  const { state, dispatch } = useWorkbench();
  const { runtimeClient, viewModel, selectedSession, selectedNode, selectedBeat, selectedAgent, selectedCheckpoint, actions } = useRunActions();

  useEffect(() => {
    let cancelled = false;
    runtimeClient
      .bootstrap()
      .then((bootstrap) => {
        if (cancelled) return;
        dispatch({
          type: "BOOTSTRAP",
          patterns: bootstrap.patterns,
          providerRegistry: bootstrap.providerRegistry,
          providerSecretStatuses: bootstrap.providerSecretStatuses,
          snapshot: bootstrap.snapshot,
          health: bootstrap.health,
        });
      })
      .catch((error) => {
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
      });
    return () => { cancelled = true; };
  }, [runtimeClient, dispatch]);

  // Chat messages derived from events
  const chatMessages = useMemo(() => {
    if (!state.activeSnapshot) return [];
    return adaptChatMessages(state.activeSnapshot.events, state.promptText, state.activeSnapshot);
  }, [state.activeSnapshot, state.promptText]);

  // Loading / error state
  if (!viewModel || !selectedSession || !selectedNode || !selectedBeat || !selectedAgent || !state.bridgeStatus) {
    return (
      <AppShell>
        <div className="flex h-full items-center justify-center">
          <div className="rounded-lg bg-white p-5 shadow-pane ring-1 ring-inset ring-bench-200">
            <p className="text-sm font-semibold">{state.bridgeStatus?.label ?? "Loading"}</p>
            <p className="mt-2 max-w-sm text-xs leading-5 text-bench-700">{state.bridgeStatus?.detail ?? "Connecting..."}</p>
          </div>
        </div>
      </AppShell>
    );
  }

  // Settings view
  if (state.activeView === "settings") {
    return (
      <AppShell>
        <SettingsView />
      </AppShell>
    );
  }

  // Chat view (default)
  const { actions: actionRecords, agents, artifacts, beats, checkpoints, memoryRecords, patternCards, planItems, sessions, streamLines, topologyEdges, topologyNodes, activePattern } = viewModel;
  const isRunning = selectedSession.status === "running";
  const isApprovalRequired = selectedSession.status === "approval_required";
  const pendingApprovals = actionRecords.filter((a) => a.state === "approval_required");
  const nextApproval = pendingApprovals[0];

  return (
    <div className="relative flex h-screen min-h-[760px]">
      <AppShell>
        {isApprovalRequired && nextApproval && (
          <ApprovalModal action={nextApproval} onResume={actions.resumeRun} onCancel={actions.cancelRun} disabled={state.busyCommand !== undefined} />
        )}
        <ChatView
          activePattern={activePattern}
          activeSnapshot={state.activeSnapshot}
          agents={agents}
          bridgeStatus={state.bridgeStatus}
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
          onExportReport={actions.exportReport}
          onForkRun={actions.forkRun}
          onInterruptRun={actions.interruptRun}
          onReplaySelection={actions.replaySelection}
          onResumeRun={actions.resumeRun}
          onSelectNode={(id) => dispatch({ type: "SELECT_NODE", nodeId: id })}
          onStartRun={actions.startRun}
          onToggleDetailDrawer={() => dispatch({ type: "TOGGLE_DETAIL_DRAWER" })}
          detailDrawerOpen={state.detailDrawerOpen}
        />
      </AppShell>
      <DetailDrawer
        open={state.detailDrawerOpen}
        onClose={() => dispatch({ type: "TOGGLE_DETAIL_DRAWER" })}
        actions={actionRecords}
        agents={agents}
        artifacts={artifacts}
        activeSnapshot={state.activeSnapshot}
        busyCommand={state.busyCommand}
        checkpoints={checkpoints}
        commandFeedback={state.commandFeedback}
        memoryRecords={memoryRecords}
        planItems={planItems}
        selectedAgent={selectedAgent}
        selectedBeat={selectedBeat}
        selectedCheckpoint={selectedCheckpoint}
        selectedNode={selectedNode}
        selectedSession={selectedSession}
        onExportReport={actions.exportReport}
        onForkRun={actions.forkRun}
        onReplaySelection={actions.replaySelection}
        onResumeRun={actions.resumeRun}
        onCancelRun={actions.cancelRun}
      />
    </div>
  );
}

export function App() {
  return (
    <WorkbenchProvider>
      <WorkbenchInner />
    </WorkbenchProvider>
  );
}
