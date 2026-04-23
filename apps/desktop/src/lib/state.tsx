import { createContext, useContext, useMemo, useReducer, type Dispatch, type ReactNode } from "react";
import type { AppView, CoordinationPattern, DockTab, RuntimeBridgeStatus } from "../types";
import type {
  OraPatternDefinition,
  OraProviderConfig,
  OraProviderRegistry,
  OraProviderSecretStatus,
  OraSessionDetail,
  OraSessionSummary,
  OraSkillRegistry,
  OraStateSnapshot,
  OraToolRegistry,
  RuntimeHealth,
} from "./runtimeClient";

export interface WorkbenchState {
  selectedPattern: CoordinationPattern;
  selectedSessionId: string | undefined;
  selectedTurnRunId: string | undefined;
  selectedDockTab: DockTab;
  selectedBeatId: string | undefined;
  selectedNodeId: string;
  sessions: OraSessionSummary[];
  activeSessionDetail: OraSessionDetail | undefined;
  activeSnapshot: OraStateSnapshot | undefined;
  patterns: OraPatternDefinition[];
  providerRegistry: OraProviderRegistry | undefined;
  toolRegistry: OraToolRegistry | undefined;
  skillRegistry: OraSkillRegistry | undefined;
  providerSecretStatuses: OraProviderSecretStatus[];
  selectedProviderId: string;
  bridgeStatus: RuntimeBridgeStatus | undefined;
  promptText: string;
  isLoading: boolean;
  busyCommand: string | undefined;
  commandFeedback: string;
  filmstripExpanded: boolean;
  activeView: AppView;
  sidebarCollapsed: boolean;
  detailDrawerOpen: boolean;
  artifactPanelOpen: boolean;
  inputMode: "flash" | "thinking" | "pro" | "ultra";
}

export type WorkbenchAction =
  | {
      type: "BOOTSTRAP";
      patterns: OraPatternDefinition[];
      providerRegistry: OraProviderRegistry;
      toolRegistry: OraToolRegistry;
      skillRegistry: OraSkillRegistry;
      providerSecretStatuses: OraProviderSecretStatus[];
      health: RuntimeHealth;
    }
  | { type: "RESET_RUNTIME_VIEW" }
  | { type: "SET_PATTERN"; pattern: CoordinationPattern }
  | {
      type: "HYDRATE_SESSION";
      sessions: OraSessionSummary[];
      detail: OraSessionDetail;
      snapshot?: OraStateSnapshot;
      feedback?: string;
    }
  | { type: "SET_PROVIDER"; providerId: string }
  | { type: "SET_PROVIDER_REGISTRY"; providerRegistry: OraProviderRegistry }
  | { type: "UPSERT_PROVIDER"; provider: OraProviderConfig }
  | { type: "DELETE_PROVIDER"; providerId: string }
  | { type: "SET_PROVIDER_SECRET_STATUS"; status: OraProviderSecretStatus }
  | { type: "SET_PROVIDER_SECRET_STATUSES"; statuses: OraProviderSecretStatus[] }
  | { type: "SELECT_SESSION"; sessionId: string }
  | { type: "SELECT_TURN"; runId: string; snapshot?: OraStateSnapshot }
  | { type: "SELECT_TAB"; tab: DockTab }
  | { type: "SELECT_BEAT"; beatId: string | undefined }
  | { type: "SELECT_NODE"; nodeId: string }
  | { type: "SET_PROMPT"; text: string }
  | { type: "SET_LOADING"; loading: boolean }
  | { type: "SET_BUSY_COMMAND"; command: string | undefined }
  | { type: "SET_COMMAND_FEEDBACK"; feedback: string }
  | { type: "SET_BRIDGE_STATUS"; status: RuntimeBridgeStatus }
  | { type: "TOGGLE_FILMSTRIP" }
  | { type: "SET_VIEW"; view: AppView }
  | { type: "TOGGLE_SIDEBAR" }
  | { type: "TOGGLE_DETAIL_DRAWER" }
  | { type: "TOGGLE_ARTIFACT_PANEL" }
  | { type: "SET_INPUT_MODE"; mode: WorkbenchState["inputMode"] };

const initialState: WorkbenchState = {
  selectedPattern: "orchestrator_subagent",
  selectedSessionId: undefined,
  selectedTurnRunId: undefined,
  selectedDockTab: "Overview",
  selectedBeatId: undefined,
  selectedNodeId: "run",
  sessions: [],
  activeSessionDetail: undefined,
  activeSnapshot: undefined,
  patterns: [],
  providerRegistry: undefined,
  toolRegistry: undefined,
  skillRegistry: undefined,
  providerSecretStatuses: [],
  selectedProviderId: "local-smoke",
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
  sidebarCollapsed: false,
  detailDrawerOpen: false,
  artifactPanelOpen: false,
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

function workbenchReducer(state: WorkbenchState, action: WorkbenchAction): WorkbenchState {
  switch (action.type) {
    case "RESET_RUNTIME_VIEW":
      return {
        ...state,
        selectedSessionId: undefined,
        selectedTurnRunId: undefined,
        selectedBeatId: undefined,
        selectedNodeId: "run",
        sessions: [],
        activeSessionDetail: undefined,
        activeSnapshot: undefined,
        promptText: "",
        isLoading: true,
        busyCommand: undefined,
        commandFeedback: "Reconnecting to the Ora runtime bridge.",
      };

    case "BOOTSTRAP":
      return {
        ...state,
        patterns: action.patterns,
        providerRegistry: action.providerRegistry,
        toolRegistry: action.toolRegistry,
        skillRegistry: action.skillRegistry,
        providerSecretStatuses: action.providerSecretStatuses,
        selectedProviderId: action.providerRegistry.defaultProviderId,
        bridgeStatus: {
          mode: action.health.mode,
          ok: action.health.ok,
          label: action.health.service,
          detail: action.health.detail,
        },
        isLoading: false,
      };

    case "HYDRATE_SESSION": {
      const snapshot = selectedSnapshotFromDetail(action.detail, action.snapshot, state.selectedTurnRunId);
      const latestTurn = action.detail.turns.at(-1);
      return {
        ...state,
        sessions: replaceSessionSummary(
          action.sessions.filter((session) => session.sessionId !== action.detail.session.sessionId),
          action.detail.session,
        ),
        activeSessionDetail: action.detail,
        activeSnapshot: snapshot,
        selectedSessionId: action.detail.session.sessionId,
        selectedTurnRunId: snapshot?.runId ?? latestTurn?.runId,
        selectedPattern: snapshot?.pattern ?? state.selectedPattern,
        selectedProviderId: snapshot?.config.providerId ?? state.selectedProviderId,
        selectedNodeId: snapshot?.topology.nodes[1]?.id ?? snapshot?.topology.nodes[0]?.id ?? "run",
        selectedBeatId: snapshot?.events.at(-1)?.id,
        commandFeedback: action.feedback ?? state.commandFeedback,
        isLoading: false,
        busyCommand: undefined,
      };
    }

    case "SET_PATTERN":
      return { ...state, selectedPattern: action.pattern };

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

    case "SELECT_SESSION":
      return { ...state, selectedSessionId: action.sessionId };

    case "SELECT_TURN":
      return {
        ...state,
        selectedTurnRunId: action.runId,
        activeSnapshot: action.snapshot ?? state.activeSnapshot,
        selectedPattern: action.snapshot?.pattern ?? state.selectedPattern,
        selectedNodeId: action.snapshot?.topology.nodes[1]?.id ?? action.snapshot?.topology.nodes[0]?.id ?? state.selectedNodeId,
        selectedBeatId: action.snapshot?.events.at(-1)?.id ?? state.selectedBeatId,
      };

    case "SELECT_TAB":
      return { ...state, selectedDockTab: action.tab };

    case "SELECT_BEAT":
      return { ...state, selectedBeatId: action.beatId };

    case "SELECT_NODE":
      return { ...state, selectedNodeId: action.nodeId };

    case "SET_PROMPT":
      return { ...state, promptText: action.text };

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

    case "TOGGLE_SIDEBAR":
      return { ...state, sidebarCollapsed: !state.sidebarCollapsed };

    case "TOGGLE_DETAIL_DRAWER":
      return { ...state, detailDrawerOpen: !state.detailDrawerOpen };

    case "TOGGLE_ARTIFACT_PANEL":
      return { ...state, artifactPanelOpen: !state.artifactPanelOpen, detailDrawerOpen: !state.artifactPanelOpen };

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
  const [state, dispatch] = useReducer(workbenchReducer, initialState);
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
