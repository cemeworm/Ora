import { useMemo } from "react";
import { createRuntimeClient } from "./runtimeClient";
import { useWorkbench } from "./state";
import { buildWorkbenchViewModel } from "./viewModel";

export function useRunActions() {
  const { state, dispatch } = useWorkbench();
  const runtimeClient = useMemo(() => createRuntimeClient(), []);

  const viewModel = useMemo(() => {
    if (state.patterns.length === 0 || state.sessions.length === 0) return undefined;
    return buildWorkbenchViewModel(state.patterns, state.sessions, state.selectedPattern, state.selectedSessionId);
  }, [state.patterns, state.sessions, state.selectedPattern, state.selectedSessionId]);

  const selectedSession = viewModel?.sessions.find((s) => s.id === state.selectedSessionId) ?? viewModel?.sessions[0];
  const selectedNode = viewModel?.topologyNodes.find((n) => n.id === state.selectedNodeId) ?? viewModel?.topologyNodes[0];
  const selectedBeat = viewModel?.beats.find((b) => b.id === state.selectedBeatId) ?? viewModel?.beats[0];
  const selectedAgent =
    viewModel?.agents.find((a) => a.id === selectedNode?.agentId) ??
    viewModel?.agents.find((a) => a.id === selectedBeat?.agentId) ??
    viewModel?.agents[0];
  const selectedCheckpoint =
    viewModel?.checkpoints.find((c) => c.id === selectedBeat?.checkpointId) ?? viewModel?.checkpoints[0];

  async function startRun() {
    dispatch({ type: "SET_LOADING", loading: true });
    const provider = state.providerRegistry?.providers.find((entry) => entry.id === state.selectedProviderId);
    try {
      const snapshot = await runtimeClient.startRun(
        { prompt: state.promptText, projectId: "ora-mvp", context: { source: "desktop-workbench" } },
        {
          pattern: state.selectedPattern,
          providerId: state.selectedProviderId,
          modelRef: provider?.modelId ?? "local/smoke-model",
          metadata: { providerId: state.selectedProviderId },
        },
      );
      dispatch({ type: "RUN_STARTED", snapshot });
      const health = runtimeClient.getHealth();
      if (health) {
        dispatch({ type: "SET_BRIDGE_STATUS", status: { mode: health.mode, ok: health.ok, label: health.service, detail: health.detail } });
      }
    } catch (error) {
      dispatch({
        type: "SET_BRIDGE_STATUS",
        status: { mode: "error", ok: false, label: "Run failed", detail: error instanceof Error ? error.message : "Unable to start run." },
      });
      dispatch({ type: "SET_LOADING", loading: false });
    }
  }

  async function interruptRun() {
    if (!selectedSession) return;
    dispatch({ type: "SET_BUSY_COMMAND", command: "Interrupt" });
    try {
      const snapshot = await runtimeClient.interruptRun(selectedSession.id, "Interrupted from Operator Workbench.");
      dispatch({ type: "RUN_UPDATED", snapshot });
      dispatch({ type: "SET_COMMAND_FEEDBACK", feedback: `Interrupt completed against ${snapshot.runId}.` });
    } catch (error) {
      dispatch({ type: "SET_COMMAND_FEEDBACK", feedback: error instanceof Error ? error.message : "Interrupt failed." });
      dispatch({ type: "SET_BUSY_COMMAND", command: undefined });
    }
  }

  async function resumeRun() {
    if (!selectedSession) return;
    dispatch({ type: "SET_BUSY_COMMAND", command: "Approve" });
    try {
      const snapshot = await runtimeClient.resumeRun(
        selectedSession.id,
        "Approved sidecar action from Context Dock.",
        { approvedActionIds: viewModel?.actions.filter((a) => a.state === "approval_required").map((a) => a.id) ?? [] },
      );
      dispatch({ type: "RUN_UPDATED", snapshot });
      dispatch({ type: "SET_COMMAND_FEEDBACK", feedback: `Approve completed against ${snapshot.runId}.` });
    } catch (error) {
      dispatch({ type: "SET_COMMAND_FEEDBACK", feedback: error instanceof Error ? error.message : "Approve failed." });
      dispatch({ type: "SET_BUSY_COMMAND", command: undefined });
    }
  }

  async function cancelRun() {
    if (!selectedSession) return;
    dispatch({ type: "SET_BUSY_COMMAND", command: "Cancel" });
    try {
      const snapshot = await runtimeClient.cancelRun(selectedSession.id);
      dispatch({ type: "RUN_UPDATED", snapshot });
      dispatch({ type: "SET_COMMAND_FEEDBACK", feedback: `Cancel completed against ${snapshot.runId}.` });
    } catch (error) {
      dispatch({ type: "SET_COMMAND_FEEDBACK", feedback: error instanceof Error ? error.message : "Cancel failed." });
      dispatch({ type: "SET_BUSY_COMMAND", command: undefined });
    }
  }

  async function forkRun() {
    if (!selectedSession || !selectedCheckpoint) {
      dispatch({ type: "SET_COMMAND_FEEDBACK", feedback: "Select a checkpoint before forking." });
      return;
    }
    dispatch({ type: "SET_BUSY_COMMAND", command: "Fork" });
    try {
      const snapshot = await runtimeClient.forkRun(
        selectedSession.id,
        selectedCheckpoint.id,
        { pattern: state.selectedPattern, metadata: { source: "desktop-workbench" } },
        { context: { selectedEventId: selectedBeat?.id, selectedEventSeq: selectedBeat?.eventSeq } },
      );
      dispatch({ type: "RUN_ADDED", snapshot });
      dispatch({ type: "SET_COMMAND_FEEDBACK", feedback: `Fork completed against ${snapshot.runId}.` });
    } catch (error) {
      dispatch({ type: "SET_COMMAND_FEEDBACK", feedback: error instanceof Error ? error.message : "Fork failed." });
      dispatch({ type: "SET_BUSY_COMMAND", command: undefined });
    }
  }

  async function replaySelection() {
    if (!selectedSession || !selectedBeat) return;
    dispatch({ type: "SET_BUSY_COMMAND", command: "Replay" });
    try {
      const stream = await runtimeClient.replayRun(selectedSession.id, selectedBeat.checkpointId);
      const firstEvent = stream.events[0];
      if (firstEvent) dispatch({ type: "SELECT_BEAT", beatId: firstEvent.id });
      dispatch({
        type: "SET_COMMAND_FEEDBACK",
        feedback: `Replay restored ${stream.events.length} event${stream.events.length === 1 ? "" : "s"} from ${selectedBeat.label}.`,
      });
      dispatch({ type: "SET_BUSY_COMMAND", command: undefined });
    } catch (error) {
      dispatch({ type: "SET_COMMAND_FEEDBACK", feedback: error instanceof Error ? error.message : "Replay failed." });
      dispatch({ type: "SET_BUSY_COMMAND", command: undefined });
    }
  }

  async function exportReport() {
    if (!selectedSession) return;
    dispatch({ type: "SET_BUSY_COMMAND", command: "Report" });
    try {
      const { artifact, snapshot } = await runtimeClient.exportReport(selectedSession.id);
      dispatch({ type: "RUN_UPDATED", snapshot });
      dispatch({ type: "SET_COMMAND_FEEDBACK", feedback: `Exported ${artifact.label} as ${artifact.mimeType}.` });
    } catch (error) {
      dispatch({ type: "SET_COMMAND_FEEDBACK", feedback: error instanceof Error ? error.message : "Report export failed." });
      dispatch({ type: "SET_BUSY_COMMAND", command: undefined });
    }
  }

  async function storeProviderSecret(providerId: string, secret: string) {
    dispatch({ type: "SET_BUSY_COMMAND", command: "Save provider key" });
    try {
      const status = await runtimeClient.storeProviderSecret(providerId, secret);
      dispatch({ type: "SET_PROVIDER_SECRET_STATUS", status });
      const statuses = await runtimeClient.refreshProviderSecretStatuses(state.providerRegistry?.providers ?? []);
      dispatch({ type: "SET_PROVIDER_SECRET_STATUSES", statuses });
      dispatch({ type: "SET_BUSY_COMMAND", command: undefined });
    } catch (error) {
      dispatch({ type: "SET_COMMAND_FEEDBACK", feedback: error instanceof Error ? error.message : "Provider key save failed." });
      dispatch({ type: "SET_BUSY_COMMAND", command: undefined });
    }
  }

  async function deleteProviderSecret(providerId: string) {
    dispatch({ type: "SET_BUSY_COMMAND", command: "Remove provider key" });
    try {
      const status = await runtimeClient.deleteProviderSecret(providerId);
      dispatch({ type: "SET_PROVIDER_SECRET_STATUS", status });
      dispatch({ type: "SET_BUSY_COMMAND", command: undefined });
    } catch (error) {
      dispatch({ type: "SET_COMMAND_FEEDBACK", feedback: error instanceof Error ? error.message : "Provider key removal failed." });
      dispatch({ type: "SET_BUSY_COMMAND", command: undefined });
    }
  }

  return {
    runtimeClient,
    viewModel,
    selectedSession,
    selectedNode,
    selectedBeat,
    selectedAgent,
    selectedCheckpoint,
    actions: {
      startRun,
      interruptRun,
      resumeRun,
      cancelRun,
      forkRun,
      replaySelection,
      exportReport,
      storeProviderSecret,
      deleteProviderSecret,
    },
  };
}
