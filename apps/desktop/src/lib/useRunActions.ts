import { useMemo } from "react";
import { getSharedRuntimeClient, type OraProjectSummary, type OraProviderConfig, type OraSessionDetail, type OraSessionSummary, type OraStateSnapshot } from "./runtimeClient";
import { useWorkbench } from "./state";
import { buildWorkbenchViewModel } from "./viewModel";

const PROJECT_CHAT_SAFE_TOOL_IDS = ["file.read", "file.list", "file.glob", "file.grep"];

function toolIdsForRun(modeToolIds: readonly string[] | undefined, projectId: string | undefined): string[] {
  if (!projectId) {
    return [...(modeToolIds ?? [])];
  }
  return [...new Set([...(modeToolIds ?? []), ...PROJECT_CHAT_SAFE_TOOL_IDS])];
}

async function pickProjectDirectory(): Promise<string | null> {
  if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({
      directory: true,
      multiple: false,
      recursive: true,
      title: "Select Project Folder",
    });
    return typeof selected === "string" && selected.trim() ? selected : null;
  }

  const entered = window.prompt("Project folder path");
  return typeof entered === "string" && entered.trim() ? entered.trim() : null;
}

export function useRunActions() {
  const { state, dispatch } = useWorkbench();
  const runtimeClient = getSharedRuntimeClient();

  const viewModel = useMemo(() => {
    if (state.patterns.length === 0 || !state.activeSessionDetail) return undefined;
    return buildWorkbenchViewModel(
      state.patterns,
      state.modes,
      state.sessions,
      state.activeSessionDetail,
      state.activeSnapshot,
      state.selectedPattern,
      state.selectedModeId,
    );
  }, [state.patterns, state.modes, state.sessions, state.activeSessionDetail, state.activeSnapshot, state.selectedPattern, state.selectedModeId]);

  const selectedSession = viewModel?.sessions.find((session) => session.id === state.selectedSessionId) ?? viewModel?.sessions[0];
  const selectedMode = state.modes.find((mode) => mode.id === state.selectedModeId);
  const selectedRunPattern = selectedMode?.family ?? state.selectedPattern;
  const selectedRunModeId = selectedMode?.id ?? state.selectedModeId;
  const selectedNode = viewModel?.topologyNodes.find((node) => node.id === state.selectedNodeId) ?? viewModel?.topologyNodes[0];
  const selectedBeat = viewModel?.beats.find((beat) => beat.id === state.selectedBeatId) ?? viewModel?.beats[0];
  const selectedAgent =
    viewModel?.agents.find((agent) => agent.id === selectedNode?.agentId) ??
    viewModel?.agents.find((agent) => agent.id === selectedBeat?.agentId) ??
    viewModel?.agents[0];
  const selectedCheckpoint =
    viewModel?.checkpoints.find((checkpoint) => checkpoint.id === selectedBeat?.checkpointId) ?? viewModel?.checkpoints[0];

  async function loadProjects(): Promise<OraProjectSummary[]> {
    const projects = await runtimeClient.listProjects();
    dispatch({ type: "SET_PROJECTS", projects });
    return projects;
  }

  async function hydrateSession(sessionId: string, snapshot?: OraStateSnapshot, feedback?: string) {
    const [projects, sessions, detail] = await Promise.all([
      runtimeClient.listProjects(),
      runtimeClient.listSessions(),
      runtimeClient.getSession(sessionId),
    ]);
    dispatch({ type: "HYDRATE_SESSION", projects, sessions, detail, snapshot, feedback });
    return { projects, sessions, detail };
  }

  async function selectSession(sessionId: string) {
    dispatch({ type: "SET_LOADING", loading: true });
    dispatch({ type: "SELECT_SESSION", sessionId });
    try {
      await hydrateSession(sessionId);
    } catch (error) {
      dispatch({ type: "SET_COMMAND_FEEDBACK", feedback: error instanceof Error ? error.message : "Session load failed." });
      dispatch({ type: "SET_LOADING", loading: false });
    }
  }

  async function selectTurn(runId: string) {
    dispatch({ type: "SET_BUSY_COMMAND", command: "Load turn" });
    try {
      const snapshot = await runtimeClient.getRunState(runId);
      dispatch({ type: "SELECT_TURN", runId, snapshot });
      dispatch({ type: "SET_BUSY_COMMAND", command: undefined });
    } catch (error) {
      dispatch({ type: "SET_COMMAND_FEEDBACK", feedback: error instanceof Error ? error.message : "Turn load failed." });
      dispatch({ type: "SET_BUSY_COMMAND", command: undefined });
    }
  }

  async function createSession() {
    dispatch({ type: "SET_LOADING", loading: true });
    try {
      dispatch({ type: "SELECT_PROJECT", projectId: undefined });
      const created = await runtimeClient.createSession();
      dispatch({ type: "SELECT_SESSION", sessionId: created.sessionId });
      await hydrateSession(created.sessionId, undefined, "Created a new empty chat session.");
    } catch (error) {
      dispatch({ type: "SET_COMMAND_FEEDBACK", feedback: error instanceof Error ? error.message : "Session creation failed." });
      dispatch({ type: "SET_LOADING", loading: false });
    }
  }

  async function createProjectSession(projectId: string) {
    dispatch({ type: "SET_LOADING", loading: true });
    try {
      const created = await runtimeClient.createSession({ projectId });
      dispatch({ type: "SELECT_PROJECT", projectId });
      dispatch({ type: "SELECT_SESSION", sessionId: created.sessionId });
      await hydrateSession(created.sessionId, undefined, "Created a new project session.");
    } catch (error) {
      dispatch({ type: "SET_COMMAND_FEEDBACK", feedback: error instanceof Error ? error.message : "Project session creation failed." });
      dispatch({ type: "SET_LOADING", loading: false });
    }
  }

  async function addProjectFromDialog() {
    dispatch({ type: "SET_BUSY_COMMAND", command: "Add project" });
    try {
      const rootPath = await pickProjectDirectory();
      if (!rootPath) {
        dispatch({ type: "SET_BUSY_COMMAND", command: undefined });
        return;
      }
      const project = await runtimeClient.createProject({ rootPath });
      await loadProjects();
      dispatch({ type: "SELECT_PROJECT", projectId: project.projectId });
      dispatch({ type: "SET_COMMAND_FEEDBACK", feedback: `Added project ${project.label}.` });
      dispatch({ type: "SET_BUSY_COMMAND", command: undefined });
    } catch (error) {
      dispatch({ type: "SET_COMMAND_FEEDBACK", feedback: error instanceof Error ? error.message : "Project import failed." });
      dispatch({ type: "SET_BUSY_COMMAND", command: undefined });
    }
  }

  async function ensureInitialSession() {
    const [projects, sessions] = await Promise.all([
      runtimeClient.listProjects(),
      runtimeClient.listSessions(),
    ]);
    const firstSession = sessions[0] ?? await runtimeClient.createSession();
    const detail = await runtimeClient.getSession(firstSession.sessionId);
    dispatch({
      type: "HYDRATE_SESSION",
      projects,
      sessions: firstSession === sessions[0] ? sessions : [firstSession, ...sessions],
      detail,
    });
    return { projects, sessions, detail };
  }

  async function refreshCurrentSession(snapshot?: OraStateSnapshot, feedback?: string) {
    const sessionId = snapshot?.sessionId ?? state.selectedSessionId;
    if (!sessionId) return;
    await hydrateSession(sessionId, snapshot, feedback);
  }

  async function startRun() {
    if (!state.selectedSessionId || !state.promptText.trim()) return;
    const submittedPrompt = state.promptText;
    dispatch({ type: "SET_LOADING", loading: true });
    const provider = state.providerRegistry?.providers.find((entry) => entry.id === state.selectedProviderId);
    const projectId = state.activeSessionDetail?.session.projectId;
    try {
      const handle = await runtimeClient.startStreamingRun(
        {
          prompt: submittedPrompt,
          projectId,
          context: { source: "desktop-workbench" },
        },
        {
          pattern: selectedRunPattern,
          modeId: selectedRunModeId,
          providerId: state.selectedProviderId,
          providerConfig: provider,
          customAgentId: state.selectedCustomAgentId,
          modelRef: provider?.modelId ?? "local/smoke-model",
          toolIds: toolIdsForRun(selectedMode?.capabilityFlags.toolIds, projectId),
          metadata: {
            providerId: state.selectedProviderId,
            ...(state.selectedCustomAgentId ? { customAgentId: state.selectedCustomAgentId } : {}),
          },
        },
        state.selectedSessionId,
      );
      const snapshot = await runtimeClient.getRunState(handle.runId);
      dispatch({ type: "SELECT_TURN", runId: handle.runId, snapshot });
      await refreshCurrentSession(snapshot, `Started turn ${snapshot.turnIndex ?? "?"}.`);
      dispatch({ type: "CLEAR_PROMPT_IF_MATCH", text: submittedPrompt });
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
    if (!state.selectedTurnRunId) return;
    dispatch({ type: "SET_BUSY_COMMAND", command: "Interrupt" });
    try {
      const snapshot = await runtimeClient.interruptRun(state.selectedTurnRunId, "Interrupted from Operator Workbench.");
      await refreshCurrentSession(snapshot, `Interrupt completed against ${snapshot.runId}.`);
    } catch (error) {
      dispatch({ type: "SET_COMMAND_FEEDBACK", feedback: error instanceof Error ? error.message : "Interrupt failed." });
      dispatch({ type: "SET_BUSY_COMMAND", command: undefined });
    }
  }

  async function resumeRun() {
    if (!state.selectedTurnRunId) return;
    dispatch({ type: "SET_BUSY_COMMAND", command: "Approve" });
    try {
      const snapshot = await runtimeClient.resumeRun(
        state.selectedTurnRunId,
        "Approved sidecar action from Context Dock.",
        { approvedActionIds: viewModel?.actions.filter((a) => a.state === "approval_required").map((a) => a.id) ?? [] },
      );
      await refreshCurrentSession(snapshot, `Approve completed against ${snapshot.runId}.`);
    } catch (error) {
      dispatch({ type: "SET_COMMAND_FEEDBACK", feedback: error instanceof Error ? error.message : "Approve failed." });
      dispatch({ type: "SET_BUSY_COMMAND", command: undefined });
    }
  }

  async function cancelRun() {
    if (!state.selectedTurnRunId) return;
    dispatch({ type: "SET_BUSY_COMMAND", command: "Cancel" });
    try {
      const snapshot = await runtimeClient.cancelRun(state.selectedTurnRunId);
      await refreshCurrentSession(snapshot, `Cancel completed against ${snapshot.runId}.`);
    } catch (error) {
      dispatch({ type: "SET_COMMAND_FEEDBACK", feedback: error instanceof Error ? error.message : "Cancel failed." });
      dispatch({ type: "SET_BUSY_COMMAND", command: undefined });
    }
  }

  async function forkRun() {
    if (!state.selectedTurnRunId || !selectedCheckpoint) {
      dispatch({ type: "SET_COMMAND_FEEDBACK", feedback: "Select a checkpoint before forking." });
      return;
    }
    dispatch({ type: "SET_BUSY_COMMAND", command: "Fork" });
    try {
      const snapshot = await runtimeClient.forkRun(
        state.selectedTurnRunId,
        selectedCheckpoint.id,
        { pattern: selectedRunPattern, modeId: selectedRunModeId, metadata: { source: "desktop-workbench" } },
        { context: { selectedEventId: selectedBeat?.id, selectedEventSeq: selectedBeat?.eventSeq } },
      );
      await refreshCurrentSession(snapshot, `Fork completed against ${snapshot.runId}.`);
    } catch (error) {
      dispatch({ type: "SET_COMMAND_FEEDBACK", feedback: error instanceof Error ? error.message : "Fork failed." });
      dispatch({ type: "SET_BUSY_COMMAND", command: undefined });
    }
  }

  async function replaySelection() {
    if (!state.selectedTurnRunId || !selectedBeat) return;
    dispatch({ type: "SET_BUSY_COMMAND", command: "Replay" });
    try {
      const stream = await runtimeClient.replayRun(state.selectedTurnRunId, selectedBeat.checkpointId);
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
    if (!state.selectedTurnRunId) return;
    dispatch({ type: "SET_BUSY_COMMAND", command: "Report" });
    try {
      const { artifact, snapshot } = await runtimeClient.exportReport(state.selectedTurnRunId);
      await refreshCurrentSession(snapshot, `Exported ${artifact.label} as ${artifact.mimeType}.`);
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
      const refreshed = await runtimeClient.refreshProviderSecretStatuses(state.providerRegistry?.providers ?? []);
      const statuses = refreshed.some((entry) => entry.providerId === providerId)
        ? refreshed
        : [status, ...refreshed.filter((entry) => entry.providerId !== providerId)];
      dispatch({ type: "SET_PROVIDER_SECRET_STATUSES", statuses });
      dispatch({
        type: "SET_PROVIDER_STATUSES",
        statuses: runtimeClient.refreshProviderStatuses(
          state.providerRegistry?.providers ?? [],
          statuses,
          state.providerStatuses,
        ),
      });
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
      const refreshed = await runtimeClient.refreshProviderSecretStatuses(state.providerRegistry?.providers ?? []);
      const statuses = refreshed.some((entry) => entry.providerId === providerId)
        ? refreshed
        : [status, ...refreshed.filter((entry) => entry.providerId !== providerId)];
      dispatch({ type: "SET_PROVIDER_SECRET_STATUSES", statuses });
      dispatch({
        type: "SET_PROVIDER_STATUSES",
        statuses: runtimeClient.refreshProviderStatuses(
          state.providerRegistry?.providers ?? [],
          statuses,
          state.providerStatuses,
        ),
      });
      dispatch({ type: "SET_BUSY_COMMAND", command: undefined });
    } catch (error) {
      dispatch({ type: "SET_COMMAND_FEEDBACK", feedback: error instanceof Error ? error.message : "Provider key removal failed." });
      dispatch({ type: "SET_BUSY_COMMAND", command: undefined });
    }
  }

  async function verifyProvider(provider: OraProviderConfig) {
    dispatch({ type: "SET_BUSY_COMMAND", command: "Verify provider" });
    try {
      const status = await runtimeClient.verifyProvider(provider);
      dispatch({ type: "SET_PROVIDER_STATUS", status });
      dispatch({ type: "SET_BUSY_COMMAND", command: undefined });
      return status;
    } catch (error) {
      dispatch({ type: "SET_COMMAND_FEEDBACK", feedback: error instanceof Error ? error.message : "Provider verification failed." });
      dispatch({ type: "SET_BUSY_COMMAND", command: undefined });
      return undefined;
    }
  }

  async function upsertCustomProvider(provider: OraProviderConfig) {
    dispatch({ type: "SET_BUSY_COMMAND", command: "Save provider" });
    try {
      const registry = await runtimeClient.upsertCustomProvider(provider);
      dispatch({ type: "SET_PROVIDER_REGISTRY", providerRegistry: registry });
      dispatch({ type: "SET_PROVIDER", providerId: provider.id });
      const statuses = await runtimeClient.refreshProviderSecretStatuses(registry.providers);
      dispatch({ type: "SET_PROVIDER_SECRET_STATUSES", statuses });
      dispatch({
        type: "SET_PROVIDER_STATUSES",
        statuses: runtimeClient.refreshProviderStatuses(registry.providers, statuses, state.providerStatuses),
      });
      dispatch({ type: "SET_COMMAND_FEEDBACK", feedback: `${provider.label} is ready to configure.` });
      dispatch({ type: "SET_BUSY_COMMAND", command: undefined });
    } catch (error) {
      dispatch({ type: "SET_COMMAND_FEEDBACK", feedback: error instanceof Error ? error.message : "Provider save failed." });
      dispatch({ type: "SET_BUSY_COMMAND", command: undefined });
    }
  }

  async function deleteCustomProvider(providerId: string) {
    dispatch({ type: "SET_BUSY_COMMAND", command: "Remove provider" });
    try {
      await runtimeClient.deleteProviderSecret(providerId);
      const registry = await runtimeClient.deleteCustomProvider(providerId);
      dispatch({ type: "DELETE_PROVIDER", providerId });
      dispatch({ type: "SET_PROVIDER_REGISTRY", providerRegistry: registry });
      const statuses = await runtimeClient.refreshProviderSecretStatuses(registry.providers);
      dispatch({ type: "SET_PROVIDER_SECRET_STATUSES", statuses });
      dispatch({
        type: "SET_PROVIDER_STATUSES",
        statuses: runtimeClient.refreshProviderStatuses(registry.providers, statuses, state.providerStatuses),
      });
      dispatch({ type: "SET_BUSY_COMMAND", command: undefined });
    } catch (error) {
      dispatch({ type: "SET_COMMAND_FEEDBACK", feedback: error instanceof Error ? error.message : "Provider removal failed." });
      dispatch({ type: "SET_BUSY_COMMAND", command: undefined });
    }
  }

  async function openAgentChat(agentId: string) {
    dispatch({ type: "SET_SELECTED_CUSTOM_AGENT", agentId });
    dispatch({ type: "SET_VIEW", view: "chat" });
    await createSession();
  }

  function clearSelectedCustomAgent() {
    dispatch({ type: "SET_SELECTED_CUSTOM_AGENT", agentId: undefined });
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
      addProjectFromDialog,
      createSession,
      createProjectSession,
      ensureInitialSession,
      selectSession,
      selectTurn,
      startRun,
      interruptRun,
      resumeRun,
      cancelRun,
      forkRun,
      replaySelection,
      exportReport,
      storeProviderSecret,
      deleteProviderSecret,
      verifyProvider,
      upsertCustomProvider,
      deleteCustomProvider,
      openAgentChat,
      clearSelectedCustomAgent,
    },
  };
}
