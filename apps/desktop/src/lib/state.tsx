import { CoordinationPatternSchema, SINGLE_AGENT_MODE_ID, type ModeSelection } from "@ora/shared";
import { createContext, useContext, useMemo, useReducer, type Dispatch, type ReactNode } from "react";
import type { AppView, CoordinationPattern, DockTab, RuntimeBridgeStatus } from "../types";
import { LANGUAGE_STORAGE_KEY, readStoredLanguage, type AppLanguage } from "./i18n";
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
  selectedModeSelection: ModeSelection;
  selectedSessionId: string | undefined;
  selectedTurnRunId: string | undefined;
  selectedDockTab: DockTab;
  selectedBeatId: string | undefined;
  selectedNodeId: string;
  projects: OraProjectSummary[];
  sessions: OraSessionSummary[];
  sessionDetailsById: Record<string, OraSessionDetail>;
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
  pendingRun: { sessionId: string; prompt: string; createdAt: number } | undefined;
  isLoading: boolean;
  busyCommand: string | undefined;
  commandFeedback: string;
  filmstripExpanded: boolean;
  activeView: AppView;
  settingsOpen: boolean;
  sidebarCollapsed: boolean;
  detailDrawer: "trails" | "documents" | undefined;
  artifactPanelOpen: boolean;
  selectedArtifactId: string | undefined;
  inputMode: "flash" | "thinking" | "pro" | "ultra";
  language: AppLanguage;
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
  | { type: "SET_MODE_SELECTION"; selection: ModeSelection }
  | {
      type: "HYDRATE_SESSION";
      projects: OraProjectSummary[];
      sessions: OraSessionSummary[];
      detail: OraSessionDetail;
      snapshot?: OraStateSnapshot;
      feedback?: string;
    }
  | { type: "CACHE_SESSION_DETAIL"; detail: OraSessionDetail }
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
  | { type: "BEGIN_RUN_REQUEST"; sessionId: string; prompt: string; createdAt: number }
  | { type: "SET_LOADING"; loading: boolean }
  | { type: "SET_BUSY_COMMAND"; command: string | undefined }
  | { type: "SET_COMMAND_FEEDBACK"; feedback: string }
  | { type: "SET_BRIDGE_STATUS"; status: RuntimeBridgeStatus }
  | { type: "TOGGLE_FILMSTRIP" }
  | { type: "SET_VIEW"; view: AppView }
  | { type: "SET_SETTINGS_OPEN"; open: boolean }
  | { type: "TOGGLE_SIDEBAR" }
  | { type: "TOGGLE_DETAIL_DRAWER"; drawer: "trails" | "documents" }
  | { type: "CLOSE_DETAIL_DRAWER" }
  | { type: "TOGGLE_ARTIFACT_PANEL" }
  | { type: "OPEN_ARTIFACT_PANEL"; artifactId: string }
  | { type: "CLOSE_ARTIFACT_PANEL" }
  | { type: "SET_INPUT_MODE"; mode: WorkbenchState["inputMode"] }
  | { type: "SET_LANGUAGE"; language: AppLanguage };

const initialSelectedPattern = CoordinationPatternSchema.options[0] as CoordinationPattern;

export const initialWorkbenchState: WorkbenchState = {
  selectedPattern: initialSelectedPattern,
  selectedModeId: "",
  selectedModeSelection: "manual",
  selectedSessionId: undefined,
  selectedTurnRunId: undefined,
  selectedDockTab: "Overview",
  selectedBeatId: undefined,
  selectedNodeId: "run",
  projects: [],
  sessions: [],
  sessionDetailsById: {},
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
  pendingRun: undefined,
  isLoading: false,
  busyCommand: undefined,
  commandFeedback: "Select a session to inspect its latest turn, checkpoints, and approvals.",
  filmstripExpanded: false,
  activeView: "chat",
  settingsOpen: false,
  sidebarCollapsed: false,
  detailDrawer: undefined,
  artifactPanelOpen: false,
  selectedArtifactId: undefined,
  inputMode: "pro",
  language: readStoredLanguage(),
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

function emptySessionDetail(session: OraSessionSummary): OraSessionDetail {
  return {
    session,
    turns: [],
    transcript: [],
    latestSnapshot: undefined,
  };
}

function cacheSessionDetail(cache: Record<string, OraSessionDetail>, detail: OraSessionDetail): Record<string, OraSessionDetail> {
  return {
    ...cache,
    [detail.session.sessionId]: detail,
  };
}

function resolveSelectedMode(modes: OraModeSpec[], selectedModeId: string): OraModeSpec | undefined {
  if (selectedModeId) {
    const selectedMode = modes.find((mode) => mode.id === selectedModeId);
    if (selectedMode) {
      return selectedMode;
    }
  }
  return modes.find((mode) => mode.id === SINGLE_AGENT_MODE_ID) ?? modes[0];
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

function streamRunStatus(stream: OraRunEventStream, snapshot: OraStateSnapshot | undefined): OraStateSnapshot["status"] | undefined {
  if (snapshot?.runId === stream.runId) {
    return snapshot.status;
  }
  return stream.status;
}

function isSettledRunStatus(status: OraStateSnapshot["status"] | undefined): status is OraStateSnapshot["status"] {
  return status !== undefined && status !== "queued" && status !== "running";
}

function streamUpdatedAt(stream: OraRunEventStream, snapshot: OraStateSnapshot | undefined): number | undefined {
  if (snapshot?.runId === stream.runId) {
    return snapshot.updatedAt;
  }
  return stream.events.at(-1)?.createdAt;
}

function syncSessionStateForSettledStream(
  state: WorkbenchState,
  stream: OraRunEventStream,
  snapshot: OraStateSnapshot | undefined,
) {
  const status = streamRunStatus(stream, snapshot);
  if (!isSettledRunStatus(status)) {
    return {
      sessions: state.sessions,
      activeSessionDetail: state.activeSessionDetail,
    };
  }

  const updatedAt = streamUpdatedAt(stream, snapshot);
  const activeDetailHasRun = state.activeSessionDetail?.turns.some((turn) => turn.runId === stream.runId) ?? false;
  const updateSession = (session: OraSessionSummary): OraSessionSummary => {
    if (session.latestRunId !== stream.runId) {
      return session;
    }
    return {
      ...session,
      status,
      latestRunId: snapshot?.runId ?? session.latestRunId,
      latestPattern: snapshot?.pattern ?? session.latestPattern,
      latestModeId: snapshot?.modeId ?? session.latestModeId,
      latestProviderId: snapshot?.config.providerId ?? session.latestProviderId,
      latestModelRef: snapshot?.config.modelRef ?? session.latestModelRef,
      updatedAt: updatedAt ?? session.updatedAt,
    };
  };

  const sessions = state.sessions.map(updateSession);
  if (!state.activeSessionDetail || !activeDetailHasRun) {
    return { sessions, activeSessionDetail: state.activeSessionDetail };
  }

  const turns = state.activeSessionDetail.turns.map((turn) => {
    if (turn.runId !== stream.runId) {
      return turn;
    }
    return {
      ...turn,
      status,
      eventCount: snapshot?.events.length ?? turn.eventCount,
      checkpointCount: snapshot?.checkpoints.length ?? turn.checkpointCount,
      artifactCount: snapshot?.artifacts.length ?? turn.artifactCount,
      updatedAt: updatedAt ?? turn.updatedAt,
      trace: snapshot?.trace ?? turn.trace,
    };
  });

  return {
    sessions,
    activeSessionDetail: {
      ...state.activeSessionDetail,
      session: updateSession(state.activeSessionDetail.session),
      turns,
      latestSnapshot: snapshot ?? state.activeSessionDetail.latestSnapshot,
    },
  };
}

function streamMatchesPendingRun(
  pendingRun: WorkbenchState["pendingRun"],
  stream: OraRunEventStream,
  activeSnapshot: OraStateSnapshot | undefined,
): boolean {
  if (!pendingRun) {
    return false;
  }

  const snapshot = stream.snapshot ?? (activeSnapshot?.runId === stream.runId ? activeSnapshot : undefined);
  return snapshot?.sessionId === pendingRun.sessionId && snapshot.input.prompt === pendingRun.prompt;
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
        sessionDetailsById: {},
        modes: [],
        promptText: "",
        pendingRun: undefined,
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
        selectedModeSelection: state.selectedModeSelection,
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
        sessionDetailsById: cacheSessionDetail(state.sessionDetailsById, action.detail),
        selectedSessionId: action.detail.session.sessionId,
        selectedTurnRunId: snapshot?.runId ?? latestTurn?.runId,
        selectedPattern: snapshot?.pattern ?? state.selectedPattern,
        selectedModeId: snapshot?.modeId ?? state.selectedModeId,
        selectedModeSelection: snapshot?.config.modeSelection ?? state.selectedModeSelection,
        selectedProviderId: snapshot?.config.providerId ?? state.selectedProviderId,
        selectedNodeId: snapshot?.topology.nodes[1]?.id ?? snapshot?.topology.nodes[0]?.id ?? "run",
        selectedBeatId: snapshot?.events.at(-1)?.id,
        commandFeedback: action.feedback ?? state.commandFeedback,
        pendingRun: undefined,
        isLoading: false,
        busyCommand: undefined,
      };
    }

    case "CACHE_SESSION_DETAIL":
      return {
        ...state,
        sessionDetailsById: cacheSessionDetail(state.sessionDetailsById, action.detail),
      };

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
        selectedModeSelection: "manual",
        selectedPattern: mode?.family ?? state.selectedPattern,
        commandFeedback: mode
          ? `${mode.label} selected for the next turn.`
          : `Mode ${action.modeId} selected for the next turn.`,
      };
    }

    case "SET_MODE_SELECTION":
      return {
        ...state,
        selectedModeSelection: action.selection,
        commandFeedback: action.selection === "auto"
          ? "Auto mode selected for the next turn."
          : "Manual mode selection restored for the next turn.",
      };

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
    {
      const cachedDetail = state.sessionDetailsById[action.sessionId];
      const session = cachedDetail?.session ?? state.sessions.find((item) => item.sessionId === action.sessionId);
      const detail = cachedDetail ?? (session ? emptySessionDetail(session) : undefined);
      const snapshot = detail ? selectedSnapshotFromDetail(detail, undefined, undefined) : undefined;
      const latestTurn = detail?.turns.at(-1);
      return {
        ...state,
        activeView: "chat",
        selectedSessionId: action.sessionId,
        selectedTurnRunId: snapshot?.runId ?? latestTurn?.runId,
        selectedBeatId: undefined,
        selectedNodeId: snapshot?.topology.nodes[1]?.id ?? snapshot?.topology.nodes[0]?.id ?? "run",
        selectedProjectId: detail?.session.projectId,
        activeSessionDetail: detail,
        activeSnapshot: snapshot,
        selectedPattern: snapshot?.pattern ?? session?.latestPattern ?? state.selectedPattern,
        selectedModeId: snapshot?.modeId ?? session?.latestModeId ?? state.selectedModeId,
        selectedModeSelection: snapshot?.config.modeSelection ?? state.selectedModeSelection,
        selectedProviderId: snapshot?.config.providerId ?? session?.latestProviderId ?? state.selectedProviderId,
        selectedArtifactId: undefined,
        detailDrawer: undefined,
        artifactPanelOpen: false,
        pendingRun: undefined,
      };
    }

    case "SELECT_TURN":
      return {
        ...state,
        selectedTurnRunId: action.runId,
        activeSnapshot: action.snapshot ?? state.activeSnapshot,
        selectedPattern: action.snapshot?.pattern ?? state.selectedPattern,
        selectedModeId: action.snapshot?.modeId ?? state.selectedModeId,
        selectedModeSelection: action.snapshot?.config.modeSelection ?? state.selectedModeSelection,
        selectedNodeId: action.snapshot?.topology.nodes[1]?.id ?? action.snapshot?.topology.nodes[0]?.id ?? state.selectedNodeId,
        selectedBeatId: action.snapshot?.events.at(-1)?.id ?? state.selectedBeatId,
        pendingRun: action.snapshot ? undefined : state.pendingRun,
      };

    case "APPLY_RUN_STREAM": {
      const activeSnapshot = mergeRunStreamSnapshot(state.activeSnapshot, action.stream);
      const { sessions, activeSessionDetail } = syncSessionStateForSettledStream(state, action.stream, activeSnapshot);
      return {
        ...state,
        sessions,
        activeSessionDetail,
        sessionDetailsById: activeSessionDetail
          ? cacheSessionDetail(state.sessionDetailsById, activeSessionDetail)
          : state.sessionDetailsById,
        activeSnapshot,
        selectedTurnRunId: state.selectedTurnRunId ?? action.stream.runId,
        selectedBeatId: action.stream.events.at(-1)?.id ?? state.selectedBeatId,
        pendingRun: streamMatchesPendingRun(state.pendingRun, action.stream, activeSnapshot) ? undefined : state.pendingRun,
        selectedModeSelection: activeSnapshot?.config.modeSelection ?? state.selectedModeSelection,
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

    case "BEGIN_RUN_REQUEST":
      return {
        ...state,
        pendingRun: {
          sessionId: action.sessionId,
          prompt: action.prompt,
          createdAt: action.createdAt,
        },
        isLoading: true,
      };

    case "SET_LOADING":
      return { ...state, isLoading: action.loading, pendingRun: action.loading ? state.pendingRun : undefined };

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
      return { ...state, detailDrawer: state.detailDrawer === action.drawer ? undefined : action.drawer };

    case "CLOSE_DETAIL_DRAWER":
      return { ...state, detailDrawer: undefined };

    case "TOGGLE_ARTIFACT_PANEL":
      return { ...state, artifactPanelOpen: !state.artifactPanelOpen };

    case "OPEN_ARTIFACT_PANEL":
      return { ...state, selectedArtifactId: action.artifactId, artifactPanelOpen: true };

    case "CLOSE_ARTIFACT_PANEL":
      return { ...state, artifactPanelOpen: false };

    case "SET_INPUT_MODE":
      return { ...state, inputMode: action.mode };

    case "SET_LANGUAGE":
      if (typeof window !== "undefined") {
        window.localStorage.setItem(LANGUAGE_STORAGE_KEY, action.language);
      }
      return { ...state, language: action.language };

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
