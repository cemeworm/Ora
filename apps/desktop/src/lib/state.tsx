import { CoordinationPatternSchema } from "@ora/shared";
import { createContext, useContext, useMemo, useReducer, type Dispatch, type ReactNode } from "react";
import type { AppView, CoordinationPattern, DockTab, RuntimeBridgeStatus } from "../types";
import type {
  OraModeSpec,
  OraPatternDefinition,
  OraProviderConfig,
  OraProviderRegistry,
  OraProviderSecretStatus,
  OraProviderStatus,
  OraRunEventStream,
  OraProjectSummary,
  OraSessionDetail,
  OraSessionSummary,
  OraSkillRegistry,
  OraStateSnapshot,
  OraToolRegistry,
  RuntimeHealth,
} from "./runtimeClient";

export interface WorkbenchState {
  selectedPattern: CoordinationPattern;
  selectedModeId: string;
  selectedSessionId: string | undefined;
  selectedTurnRunId: string | undefined;
  selectedDockTab: DockTab;
  selectedBeatId: string | undefined;
  selectedNodeId: string;
  projects: OraProjectSummary[];
  sessions: OraSessionSummary[];
  selectedProjectId: string | undefined;
  expandedProjectIds: Record<string, boolean>;
  activeSessionDetail: OraSessionDetail | undefined;
  activeSnapshot: OraStateSnapshot | undefined;
  patterns: OraPatternDefinition[];
  modes: OraModeSpec[];
  providerRegistry: OraProviderRegistry | undefined;
  toolRegistry: OraToolRegistry | undefined;
  skillRegistry: OraSkillRegistry | undefined;
  providerSecretStatuses: OraProviderSecretStatus[];
  providerStatuses: OraProviderStatus[];
  selectedProviderId: string;
  selectedCustomAgentId: string | undefined;
  bridgeStatus: RuntimeBridgeStatus | undefined;
  promptText: string;
  isLoading: boolean;
  busyCommand: string | undefined;
  commandFeedback: string;
  filmstripExpanded: boolean;
  activeView: AppView;
  settingsOpen: boolean;
  sidebarCollapsed: boolean;
  detailDrawerOpen: boolean;
  artifactPanelOpen: boolean;
  selectedArtifactId: string | undefined;
  inputMode: "flash" | "thinking" | "pro" | "ultra";
}

export type WorkbenchAction =
  | {
      type: "BOOTSTRAP";
      patterns: OraPatternDefinition[];
      modes: OraModeSpec[];
      projects: OraProjectSummary[];
      providerRegistry: OraProviderRegistry;
      toolRegistry: OraToolRegistry;
      skillRegistry: OraSkillRegistry;
      providerSecretStatuses: OraProviderSecretStatus[];
      providerStatuses: OraProviderStatus[];
      health: RuntimeHealth;
    }
  | { type: "RESET_RUNTIME_VIEW" }
  | { type: "SET_PATTERN"; pattern: CoordinationPattern }
  | { type: "SET_MODE"; modeId: string }
  | {
      type: "HYDRATE_SESSION";
      projects: OraProjectSummary[];
      sessions: OraSessionSummary[];
      detail: OraSessionDetail;
      snapshot?: OraStateSnapshot;
      feedback?: string;
    }
  | { type: "SET_PROJECTS"; projects: OraProjectSummary[] }
  | { type: "SET_MODES"; modes: OraModeSpec[] }
  | { type: "SELECT_PROJECT"; projectId: string | undefined }
  | { type: "TOGGLE_PROJECT_SECTION"; projectId: string }
  | { type: "SET_PROVIDER"; providerId: string }
  | { type: "SET_SELECTED_CUSTOM_AGENT"; agentId: string | undefined }
  | { type: "SET_PROVIDER_REGISTRY"; providerRegistry: OraProviderRegistry }
  | { type: "SET_SKILL_REGISTRY"; skillRegistry: OraSkillRegistry }
  | { type: "UPSERT_PROVIDER"; provider: OraProviderConfig }
  | { type: "DELETE_PROVIDER"; providerId: string }
  | { type: "SET_PROVIDER_SECRET_STATUS"; status: OraProviderSecretStatus }
  | { type: "SET_PROVIDER_SECRET_STATUSES"; statuses: OraProviderSecretStatus[] }
  | { type: "SET_PROVIDER_STATUS"; status: OraProviderStatus }
  | { type: "SET_PROVIDER_STATUSES"; statuses: OraProviderStatus[] }
  | { type: "SELECT_SESSION"; sessionId: string }
  | { type: "SELECT_TURN"; runId: string; snapshot?: OraStateSnapshot }
  | { type: "APPLY_RUN_STREAM"; stream: OraRunEventStream }
  | { type: "SELECT_TAB"; tab: DockTab }
  | { type: "SELECT_BEAT"; beatId: string | undefined }
  | { type: "SELECT_NODE"; nodeId: string }
  | { type: "SET_PROMPT"; text: string }
  | { type: "CLEAR_PROMPT_IF_MATCH"; text: string }
  | { type: "SET_LOADING"; loading: boolean }
  | { type: "SET_BUSY_COMMAND"; command: string | undefined }
  | { type: "SET_COMMAND_FEEDBACK"; feedback: string }
  | { type: "SET_BRIDGE_STATUS"; status: RuntimeBridgeStatus }
  | { type: "TOGGLE_FILMSTRIP" }
  | { type: "SET_VIEW"; view: AppView }
  | { type: "SET_SETTINGS_OPEN"; open: boolean }
  | { type: "TOGGLE_SIDEBAR" }
  | { type: "TOGGLE_DETAIL_DRAWER" }
  | { type: "TOGGLE_ARTIFACT_PANEL" }
  | { type: "OPEN_ARTIFACT_PANEL"; artifactId: string }
  | { type: "CLOSE_ARTIFACT_PANEL" }
  | { type: "SET_INPUT_MODE"; mode: WorkbenchState["inputMode"] };

const initialSelectedPattern = CoordinationPatternSchema.options[0] as CoordinationPattern;

export const initialWorkbenchState: WorkbenchState = {
  selectedPattern: initialSelectedPattern,
  selectedModeId: "",
  selectedSessionId: undefined,
  selectedTurnRunId: undefined,
  selectedDockTab: "Overview",
  selectedBeatId: undefined,
  selectedNodeId: "run",
  projects: [],
  sessions: [],
  selectedProjectId: undefined,
  expandedProjectIds: {},
  activeSessionDetail: undefined,
  activeSnapshot: undefined,
  patterns: [],
  modes: [],
  providerRegistry: undefined,
  toolRegistry: undefined,
  skillRegistry: undefined,
  providerSecretStatuses: [],
  providerStatuses: [],
  selectedProviderId: "local-smoke",
  selectedCustomAgentId: undefined,
  bridgeStatus: {
    mode: "initializing",
    ok: false,
    label: "Runtime",
    detail: "Connecting to the Ora runtime bridge.",
  },
  promptText: "",
  isLoading: false,
  busyCommand: undefined,
  commandFeedback: "Select a session to inspect its latest turn, checkpoints, and approvals.",
  filmstripExpanded: false,
  activeView: "chat",
  settingsOpen: false,
  sidebarCollapsed: false,
  detailDrawerOpen: false,
  artifactPanelOpen: false,
  selectedArtifactId: undefined,
  inputMode: "pro",
};

function replaceSessionSummary(sessions: OraSessionSummary[], session: OraSessionSummary): OraSessionSummary[] {
  return [session, ...sessions.filter((item) => item.sessionId !== session.sessionId)];
}

function selectedSnapshotFromDetail(detail: OraSessionDetail, snapshot?: OraStateSnapshot, selectedRunId?: string) {
  if (snapshot) {
    return snapshot;
  }
  if (selectedRunId && detail.latestSnapshot?.runId === selectedRunId) {
    return detail.latestSnapshot;
  }
  return detail.latestSnapshot;
}

function resolveSelectedMode(modes: OraModeSpec[], selectedModeId: string): OraModeSpec | undefined {
  return modes.find((mode) => mode.id === selectedModeId) ?? modes[0];
}

function mergeRunStreamSnapshot(snapshot: OraStateSnapshot | undefined, stream: OraRunEventStream): OraStateSnapshot | undefined {
  if (stream.snapshot) {
    return stream.snapshot;
  }
  if (!snapshot || snapshot.runId !== stream.runId) {
    return snapshot;
  }
  const eventBySeq = new Map(snapshot.events.map((event) => [event.seq, event]));
  for (const event of stream.events) {
    eventBySeq.set(event.seq, event);
  }
  return {
    ...snapshot,
    status: stream.status ?? snapshot.status,
    events: [...eventBySeq.values()].sort((left, right) => left.seq - right.seq),
    updatedAt: stream.events.at(-1)?.createdAt ?? snapshot.updatedAt,
  };
}

export function workbenchReducer(state: WorkbenchState, action: WorkbenchAction): WorkbenchState {
  switch (action.type) {
    case "RESET_RUNTIME_VIEW":
      return {
        ...state,
        selectedSessionId: undefined,
        selectedTurnRunId: undefined,
        selectedBeatId: undefined,
        selectedNodeId: "run",
        selectedArtifactId: undefined,
        artifactPanelOpen: false,
        projects: [],
        sessions: [],
        selectedProjectId: undefined,
        activeSessionDetail: undefined,
        activeSnapshot: undefined,
        modes: [],
        promptText: "",
        isLoading: true,
        busyCommand: undefined,
        commandFeedback: "Reconnecting to the Ora runtime bridge.",
      };

    case "BOOTSTRAP": {
      const selectedMode = resolveSelectedMode(action.modes, state.selectedModeId);
      return {
        ...state,
        patterns: action.patterns,
        modes: action.modes,
        projects: action.projects,
        providerRegistry: action.providerRegistry,
        toolRegistry: action.toolRegistry,
        skillRegistry: action.skillRegistry,
        providerSecretStatuses: action.providerSecretStatuses,
        providerStatuses: action.providerStatuses,
        selectedProviderId: action.providerRegistry.defaultProviderId,
        selectedModeId: selectedMode?.id ?? state.selectedModeId,
        selectedPattern: selectedMode?.family ?? state.selectedPattern,
        bridgeStatus: {
          mode: action.health.mode,
          ok: action.health.ok,
          label: action.health.service,
          detail: action.health.detail,
        },
        isLoading: false,
      };
    }

    case "HYDRATE_SESSION": {
      const snapshot = selectedSnapshotFromDetail(action.detail, action.snapshot, state.selectedTurnRunId);
      const latestTurn = action.detail.turns.at(-1);
      return {
        ...state,
        projects: action.projects,
        sessions: replaceSessionSummary(
          action.sessions.filter((session) => session.sessionId !== action.detail.session.sessionId),
          action.detail.session,
        ),
        selectedProjectId: action.detail.session.projectId,
        expandedProjectIds: action.detail.session.projectId
          ? { ...state.expandedProjectIds, [action.detail.session.projectId]: true }
          : state.expandedProjectIds,
        activeSessionDetail: action.detail,
        activeSnapshot: snapshot,
        selectedSessionId: action.detail.session.sessionId,
        selectedTurnRunId: snapshot?.runId ?? latestTurn?.runId,
        selectedPattern: snapshot?.pattern ?? state.selectedPattern,
        selectedModeId: snapshot?.modeId ?? state.selectedModeId,
        selectedProviderId: snapshot?.config.providerId ?? state.selectedProviderId,
        selectedNodeId: snapshot?.topology.nodes[1]?.id ?? snapshot?.topology.nodes[0]?.id ?? "run",
        selectedBeatId: snapshot?.events.at(-1)?.id,
        commandFeedback: action.feedback ?? state.commandFeedback,
        isLoading: false,
        busyCommand: undefined,
      };
    }

    case "SET_PROJECTS":
      return { ...state, projects: action.projects };

    case "SET_MODES": {
      const selectedMode = resolveSelectedMode(action.modes, state.selectedModeId);
      return {
        ...state,
        modes: action.modes,
        selectedModeId: selectedMode?.id ?? state.selectedModeId,
        selectedPattern: selectedMode?.family ?? state.selectedPattern,
      };
    }

    case "SELECT_PROJECT":
      return { ...state, selectedProjectId: action.projectId };

    case "TOGGLE_PROJECT_SECTION":
      return {
        ...state,
        expandedProjectIds: {
          ...state.expandedProjectIds,
          [action.projectId]: !(state.expandedProjectIds[action.projectId] ?? true),
        },
      };

    case "SET_PATTERN":
      return { ...state, selectedPattern: action.pattern };

    case "SET_MODE": {
      const mode = state.modes.find((entry) => entry.id === action.modeId);
      return {
        ...state,
        selectedModeId: action.modeId,
        selectedPattern: mode?.family ?? state.selectedPattern,
        commandFeedback: mode
          ? `${mode.label} selected for the next turn.`
          : `Mode ${action.modeId} selected for the next turn.`,
      };
    }

    case "SET_PROVIDER": {
      const provider = state.providerRegistry?.providers.find((entry) => entry.id === action.providerId);
      return {
        ...state,
        selectedProviderId: action.providerId,
        commandFeedback: provider
          ? `${provider.label} selected for the next turn.`
          : `Provider ${action.providerId} selected for the next turn.`,
      };
    }

    case "SET_SELECTED_CUSTOM_AGENT":
      return {
        ...state,
        selectedCustomAgentId: action.agentId,
        commandFeedback: action.agentId
          ? `Custom agent ${action.agentId} selected for the next run.`
          : "Custom agent persona cleared for the next run.",
      };

    case "SET_PROVIDER_REGISTRY": {
      const selectedProvider = action.providerRegistry.providers.some((provider) => provider.id === state.selectedProviderId)
        ? state.selectedProviderId
        : action.providerRegistry.defaultProviderId;
      return {
        ...state,
        providerRegistry: action.providerRegistry,
        selectedProviderId: selectedProvider,
      };
    }

    case "SET_SKILL_REGISTRY":
      return {
        ...state,
        skillRegistry: action.skillRegistry,
      };

    case "UPSERT_PROVIDER": {
      const providers = state.providerRegistry?.providers ?? [];
      const nextProviders = [
        action.provider,
        ...providers.filter((provider) => provider.id !== action.provider.id),
      ];
      return {
        ...state,
        providerRegistry: {
          providers: nextProviders,
          defaultProviderId: state.providerRegistry?.defaultProviderId ?? action.provider.id,
        },
        selectedProviderId: action.provider.id,
        commandFeedback: `${action.provider.label} saved for future turns.`,
      };
    }

    case "DELETE_PROVIDER": {
      const providers = state.providerRegistry?.providers.filter((provider) => provider.id !== action.providerId) ?? [];
      const defaultProviderId = state.providerRegistry?.defaultProviderId ?? "local-smoke";
      const selectedProviderId = state.selectedProviderId === action.providerId
        ? defaultProviderId
        : state.selectedProviderId;
      return {
        ...state,
        providerRegistry: state.providerRegistry
          ? { providers, defaultProviderId }
          : state.providerRegistry,
        selectedProviderId,
        providerSecretStatuses: state.providerSecretStatuses.filter((status) => status.providerId !== action.providerId),
        providerStatuses: state.providerStatuses.filter((status) => status.providerId !== action.providerId),
        commandFeedback: `Removed provider ${action.providerId}.`,
      };
    }

    case "SET_PROVIDER_SECRET_STATUS":
      return {
        ...state,
        providerSecretStatuses: [
          action.status,
          ...state.providerSecretStatuses.filter((status) => status.providerId !== action.status.providerId),
        ],
        commandFeedback: action.status.detail,
      };

    case "SET_PROVIDER_SECRET_STATUSES":
      return { ...state, providerSecretStatuses: action.statuses };

    case "SET_PROVIDER_STATUS":
      return {
        ...state,
        providerStatuses: [
          action.status,
          ...state.providerStatuses.filter((status) => status.providerId !== action.status.providerId),
        ],
        commandFeedback: action.status.detail,
      };

    case "SET_PROVIDER_STATUSES":
      return { ...state, providerStatuses: action.statuses };

    case "SELECT_SESSION":
      return {
        ...state,
        selectedSessionId: action.sessionId,
        selectedTurnRunId: undefined,
        selectedBeatId: undefined,
        selectedNodeId: "run",
        activeSessionDetail: undefined,
        activeSnapshot: undefined,
        selectedArtifactId: undefined,
        artifactPanelOpen: false,
      };

    case "SELECT_TURN":
      return {
        ...state,
        selectedTurnRunId: action.runId,
        activeSnapshot: action.snapshot ?? state.activeSnapshot,
        selectedPattern: action.snapshot?.pattern ?? state.selectedPattern,
        selectedModeId: action.snapshot?.modeId ?? state.selectedModeId,
        selectedNodeId: action.snapshot?.topology.nodes[1]?.id ?? action.snapshot?.topology.nodes[0]?.id ?? state.selectedNodeId,
        selectedBeatId: action.snapshot?.events.at(-1)?.id ?? state.selectedBeatId,
      };

    case "APPLY_RUN_STREAM": {
      const activeSnapshot = mergeRunStreamSnapshot(state.activeSnapshot, action.stream);
      return {
        ...state,
        activeSnapshot,
        selectedTurnRunId: state.selectedTurnRunId ?? action.stream.runId,
        selectedBeatId: action.stream.events.at(-1)?.id ?? state.selectedBeatId,
        isLoading: action.stream.status === "running" || action.stream.status === "queued",
        commandFeedback: action.stream.status === "succeeded"
          ? "Run completed."
          : action.stream.status === "failed"
            ? "Run failed."
            : state.commandFeedback,
      };
    }

    case "SELECT_TAB":
      return { ...state, selectedDockTab: action.tab };

    case "SELECT_BEAT":
      return { ...state, selectedBeatId: action.beatId };

    case "SELECT_NODE":
      return { ...state, selectedNodeId: action.nodeId };

    case "SET_PROMPT":
      return { ...state, promptText: action.text };

    case "CLEAR_PROMPT_IF_MATCH":
      return state.promptText === action.text ? { ...state, promptText: "" } : state;

    case "SET_LOADING":
      return { ...state, isLoading: action.loading };

    case "SET_BUSY_COMMAND":
      return { ...state, busyCommand: action.command };

    case "SET_COMMAND_FEEDBACK":
      return { ...state, commandFeedback: action.feedback };

    case "SET_BRIDGE_STATUS":
      return { ...state, bridgeStatus: action.status };

    case "TOGGLE_FILMSTRIP":
      return { ...state, filmstripExpanded: !state.filmstripExpanded };

    case "SET_VIEW":
      return { ...state, activeView: action.view };

    case "SET_SETTINGS_OPEN":
      return { ...state, settingsOpen: action.open };

    case "TOGGLE_SIDEBAR":
      return { ...state, sidebarCollapsed: !state.sidebarCollapsed };

    case "TOGGLE_DETAIL_DRAWER":
      return { ...state, detailDrawerOpen: !state.detailDrawerOpen };

    case "TOGGLE_ARTIFACT_PANEL":
      return { ...state, artifactPanelOpen: !state.artifactPanelOpen };

    case "OPEN_ARTIFACT_PANEL":
      return { ...state, selectedArtifactId: action.artifactId, artifactPanelOpen: true };

    case "CLOSE_ARTIFACT_PANEL":
      return { ...state, artifactPanelOpen: false };

    case "SET_INPUT_MODE":
      return { ...state, inputMode: action.mode };

    default:
      return state;
  }
}

interface WorkbenchContextValue {
  state: WorkbenchState;
  dispatch: Dispatch<WorkbenchAction>;
}

const WorkbenchContext = createContext<WorkbenchContextValue | null>(null);

export function WorkbenchProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(workbenchReducer, initialWorkbenchState);
  const value = useMemo(() => ({ state, dispatch }), [state, dispatch]);
  return <WorkbenchContext.Provider value={value}>{children}</WorkbenchContext.Provider>;
}

export function useWorkbench() {
  const context = useContext(WorkbenchContext);
  if (!context) {
    throw new Error("useWorkbench must be used within a WorkbenchProvider");
  }
  return context;
}
