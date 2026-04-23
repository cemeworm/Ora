import { createContext, useContext, useReducer, useMemo, type Dispatch, type ReactNode } from "react";
import type { AppView, CoordinationPattern, DockTab, RuntimeBridgeStatus } from "../types";
import type {
  OraPatternDefinition,
  OraProviderConfig,
  OraProviderRegistry,
  OraProviderSecretStatus,
  OraStateSnapshot,
  RuntimeHealth,
} from "./runtimeClient";

export interface WorkbenchState {
  selectedPattern: CoordinationPattern;
  selectedSessionId: string | undefined;
  selectedDockTab: DockTab;
  selectedBeatId: string | undefined;
  selectedNodeId: string;
  sessions: OraStateSnapshot[];
  activeSnapshot: OraStateSnapshot | undefined;
  patterns: OraPatternDefinition[];
  providerRegistry: OraProviderRegistry | undefined;
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
      providerSecretStatuses: OraProviderSecretStatus[];
      snapshot: OraStateSnapshot;
      health: RuntimeHealth;
    }
  | { type: "SET_PATTERN"; pattern: CoordinationPattern }
  | { type: "SET_PROVIDER"; providerId: string }
  | { type: "SET_PROVIDER_REGISTRY"; providerRegistry: OraProviderRegistry }
  | { type: "UPSERT_PROVIDER"; provider: OraProviderConfig }
  | { type: "DELETE_PROVIDER"; providerId: string }
  | { type: "SET_PROVIDER_SECRET_STATUS"; status: OraProviderSecretStatus }
  | { type: "SET_PROVIDER_SECRET_STATUSES"; statuses: OraProviderSecretStatus[] }
  | { type: "SELECT_SESSION"; sessionId: string }
  | { type: "SELECT_TAB"; tab: DockTab }
  | { type: "SELECT_BEAT"; beatId: string | undefined }
  | { type: "SELECT_NODE"; nodeId: string }
  | { type: "SET_PROMPT"; text: string }
  | { type: "SET_LOADING"; loading: boolean }
  | { type: "SET_BUSY_COMMAND"; command: string | undefined }
  | { type: "SET_COMMAND_FEEDBACK"; feedback: string }
  | { type: "SET_BRIDGE_STATUS"; status: RuntimeBridgeStatus }
  | { type: "TOGGLE_FILMSTRIP" }
  | { type: "RUN_STARTED"; snapshot: OraStateSnapshot }
  | { type: "RUN_UPDATED"; snapshot: OraStateSnapshot }
  | { type: "RUN_ADDED"; snapshot: OraStateSnapshot }
  | { type: "SET_VIEW"; view: AppView }
  | { type: "TOGGLE_SIDEBAR" }
  | { type: "TOGGLE_DETAIL_DRAWER" }
  | { type: "TOGGLE_ARTIFACT_PANEL" }
  | { type: "SET_INPUT_MODE"; mode: WorkbenchState["inputMode"] };

const initialState: WorkbenchState = {
  selectedPattern: "orchestrator_subagent",
  selectedSessionId: undefined,
  selectedDockTab: "Overview",
  selectedBeatId: undefined,
  selectedNodeId: "run",
  sessions: [],
  activeSnapshot: undefined,
  patterns: [],
  providerRegistry: undefined,
  providerSecretStatuses: [],
  selectedProviderId: "local-smoke",
  bridgeStatus: {
    mode: "initializing",
    ok: false,
    label: "Runtime",
    detail: "Connecting to the Ora runtime bridge.",
  },
  promptText:
    "Implement a smoke run that proves Ora can switch patterns, expose topology, stream events, and checkpoint state.",
  isLoading: false,
  busyCommand: undefined,
  commandFeedback: "Select a checkpoint or event to replay, fork, approve, or export.",
  filmstripExpanded: false,
  activeView: "chat",
  sidebarCollapsed: false,
  detailDrawerOpen: false,
  artifactPanelOpen: false,
  inputMode: "pro",
};

function replaceSession(sessions: OraStateSnapshot[], snapshot: OraStateSnapshot): OraStateSnapshot[] {
  return [snapshot, ...sessions.filter((item) => item.runId !== snapshot.runId)];
}

function workbenchReducer(state: WorkbenchState, action: WorkbenchAction): WorkbenchState {
  switch (action.type) {
    case "BOOTSTRAP": {
      const snapshot = action.snapshot;
      return {
        ...state,
        patterns: action.patterns,
        providerRegistry: action.providerRegistry,
        providerSecretStatuses: action.providerSecretStatuses,
        selectedProviderId: action.providerRegistry.defaultProviderId,
        sessions: [snapshot],
        activeSnapshot: snapshot,
        selectedSessionId: snapshot.runId,
        selectedPattern: snapshot.pattern,
        selectedNodeId: snapshot.topology.nodes[1]?.id ?? snapshot.topology.nodes[0]?.id ?? "run",
        selectedBeatId: snapshot.events[2]?.id ?? snapshot.events[0]?.id,
        bridgeStatus: {
          mode: action.health.mode,
          ok: action.health.ok,
          label: action.health.service,
          detail: action.health.detail,
        },
        isLoading: false,
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
          ? `${provider.label} selected for the next run.`
          : `Provider ${action.providerId} selected for the next run.`,
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
        commandFeedback: `${action.provider.label} saved for future runs.`,
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

    case "SELECT_SESSION": {
      const selected = state.sessions.find((s) => s.runId === action.sessionId);
      return {
        ...state,
        selectedSessionId: action.sessionId,
        activeSnapshot: selected ?? state.activeSnapshot,
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

    case "RUN_STARTED": {
      const sessions = replaceSession(state.sessions, action.snapshot);
      return {
        ...state,
        sessions,
        activeSnapshot: action.snapshot,
        selectedSessionId: action.snapshot.runId,
        selectedNodeId: action.snapshot.topology.nodes[1]?.id ?? action.snapshot.topology.nodes[0]?.id ?? "run",
        selectedBeatId: action.snapshot.events[0]?.id,
        isLoading: false,
        busyCommand: undefined,
        commandFeedback: "Started a contract-backed smoke run and refreshed workbench state.",
      };
    }

    case "RUN_UPDATED": {
      const sessions = replaceSession(state.sessions, action.snapshot);
      return {
        ...state,
        sessions,
        activeSnapshot: action.snapshot,
        selectedBeatId: action.snapshot.events.at(-1)?.id ?? state.selectedBeatId,
        isLoading: false,
        busyCommand: undefined,
      };
    }

    case "RUN_ADDED": {
      const sessions = replaceSession(state.sessions, action.snapshot);
      return {
        ...state,
        sessions,
        activeSnapshot: action.snapshot,
        selectedSessionId: action.snapshot.runId,
        selectedBeatId: action.snapshot.events.at(-1)?.id ?? state.selectedBeatId,
        isLoading: false,
        busyCommand: undefined,
      };
    }

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
