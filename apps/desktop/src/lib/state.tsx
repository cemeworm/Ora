import {
  BuiltInCoordinationPatternSchema,
  CoordinationPatternSchema,
  ModeTranscriptLayoutSchema,
  SINGLE_AGENT_MODE_ID,
  deriveSessionBranchGroupStatus,
  deriveSnapshotGateProjection,
  PlanListStepSchema,
  type RunAttention,
  type ModeSelection,
  type PermissionMode,
  type TaskIntent,
} from "@cemeworm/shared";
import { timeStart, timeEnd, recordTiming } from "./debugTiming";
import {
  createContext,
  useContext,
  useMemo,
  useReducer,
  type Dispatch,
  type ReactNode,
} from "react";
import type {
  AppView,
  CoordinationPattern,
  DockTab,
  RuntimeBridgeStatus,
} from "../types";
import {
  LANGUAGE_STORAGE_KEY,
  readStoredLanguage,
  type AppLanguage,
} from "./i18n";
import { chooseBootstrapProviderId, chooseEnabledProviderId } from "./providerSelection";
import { mergeAssistantMessageTextProjection } from "./assistantMessageProjection";
import type {
  OraModeSpec,
  OraPackageStoreSnapshot,
  OraActionRecord,
  OraPatternDefinition,
  OraProjectFileEntry,
  OraProviderConfig,
  OraProviderRegistry,
  OraProviderSecretStatus,
  OraProviderStatus,
  OraRunEventStream,
  OraProjectSummary,
  OraSessionBranchGroup,
  OraSessionDetail,
  OraSessionSummary,
  OraSkillRegistry,
  OraStateSnapshot,
  OraToolRegistry,
  RuntimeHealth,
} from "./runtimeClient";

export type ComposerProjectFileAttachment = Pick<
  OraProjectFileEntry,
  "path" | "name" | "mimeType" | "sizeBytes"
> & {
  projectId: string;
};

export interface ComposerLocalFileAttachment {
  path: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  content?: string;
  truncated?: boolean;
}

export interface PendingRunState {
  sessionId: string;
  runId?: string;
  prompt: string;
  createdAt: number;
  progressText?: string;
  latency?: OraStateSnapshot["latency"];
}
export type RunLifecycle =
  | { stage: "idle" }
  | {
      stage: "pending";
      runId?: string;
      sessionId: string;
      prompt: string;
      createdAt: number;
      progressText?: string;
      latency?: OraStateSnapshot["latency"];
    }
  | {
      stage: "streaming";
      runId: string;
      sessionId: string;
      prompt: string;
      createdAt: number;
      progressText?: string;
      latency?: OraStateSnapshot["latency"];
      snapshot: OraStateSnapshot;
    }
  | {
      stage: "settled";
      runId: string;
      sessionId: string;
      prompt: string;
      createdAt: number;
      snapshot: OraStateSnapshot;
    };

export interface LiveMessageDeltaBufferEntry {
  runId: string;
  messageId: string;
  sessionId?: string;
  role: "assistant";
  content: string;
  agentId?: string;
  nodeId?: string;
  createdAt: number;
  updatedAt: number;
  latestSeq: number;
}

export type LiveMessageDeltaBuffer = Record<string, LiveMessageDeltaBufferEntry>;

export function getActiveSnapshot(lc: RunLifecycle): OraStateSnapshot | undefined {
  return lc.stage === "streaming" || lc.stage === "settled" ? lc.snapshot : undefined;
}

export function getPendingRunState(lc: RunLifecycle): PendingRunState | undefined {
  if (lc.stage !== "pending") return undefined;
  const result: PendingRunState = {
    sessionId: lc.sessionId,
    prompt: lc.prompt,
    createdAt: lc.createdAt,
  };
  if (lc.runId) result.runId = lc.runId;
  if (lc.progressText) result.progressText = lc.progressText;
  if (lc.latency) result.latency = lc.latency;
  return result;
}

function runLifecycleFromPendingRun(pendingRun: PendingRunState | undefined): RunLifecycle {
  return pendingRun
    ? {
        stage: "pending",
        sessionId: pendingRun.sessionId,
        runId: pendingRun.runId,
        prompt: pendingRun.prompt,
        createdAt: pendingRun.createdAt,
        progressText: pendingRun.progressText,
        latency: pendingRun.latency,
      }
    : { stage: "idle" };
}

function runLifecycleFromSnapshot(
  snapshot: OraStateSnapshot | undefined,
  params: {
    pendingRun?: PendingRunState;
    previous?: RunLifecycle;
    fallbackSessionId?: string;
  } = {},
): RunLifecycle {
  if (!snapshot) {
    return runLifecycleFromPendingRun(params.pendingRun);
  }
  const previousSnapshot =
    (params.previous?.stage === "streaming" || params.previous?.stage === "settled") &&
    params.previous.runId === snapshot.runId
      ? params.previous.snapshot
      : undefined;
  const mergedSnapshot = mergeStateSnapshot(previousSnapshot, snapshot) ?? snapshot;
  const fallbackSessionId = params.pendingRun?.sessionId ?? params.fallbackSessionId;
  const lifecycleSnapshot =
    !mergedSnapshot.sessionId && fallbackSessionId
      ? { ...mergedSnapshot, sessionId: fallbackSessionId }
      : mergedSnapshot;
  const sessionId = lifecycleSnapshot.sessionId ?? params.pendingRun?.sessionId ?? params.fallbackSessionId;
  if (!sessionId) {
    return params.previous ?? { stage: "idle" };
  }
  const createdAt = lifecycleSnapshot.input.createdAt ?? params.pendingRun?.createdAt ?? lifecycleSnapshot.updatedAt;
  const sameRunPrevious =
    params.previous?.stage === "streaming" && params.previous.runId === lifecycleSnapshot.runId
      ? params.previous
      : undefined;
  const samePendingPrevious =
    params.previous?.stage === "pending" &&
    (params.previous.runId === lifecycleSnapshot.runId ||
      (!params.previous.runId && params.previous.sessionId === sessionId && params.previous.prompt === lifecycleSnapshot.input.prompt))
      ? params.previous
      : undefined;
  if (isSettledRunStatus(lifecycleSnapshot.status)) {
    return {
      stage: "settled",
      runId: lifecycleSnapshot.runId,
      sessionId,
      prompt: lifecycleSnapshot.input.prompt,
      createdAt,
      snapshot: lifecycleSnapshot,
    };
  }
  return {
    stage: "streaming",
    runId: lifecycleSnapshot.runId,
    sessionId,
    prompt: lifecycleSnapshot.input.prompt,
    createdAt,
    progressText: params.pendingRun?.progressText ?? sameRunPrevious?.progressText ?? samePendingPrevious?.progressText,
    latency: lifecycleSnapshot.latency ?? params.pendingRun?.latency ?? sameRunPrevious?.latency ?? samePendingPrevious?.latency,
    snapshot: lifecycleSnapshot,
  };
}

export interface PendingPlanDecisionResolution {
  sessionId: string;
  decisionId: string;
  status: "accepted" | "declined";
  createdAt: number;
  implementationPrompt?: string;
}

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
  patterns: OraPatternDefinition[];
  modes: OraModeSpec[];
  providerRegistry: OraProviderRegistry | undefined;
  toolRegistry: OraToolRegistry | undefined;
  packageStore: OraPackageStoreSnapshot | undefined;
  skillRegistry: OraSkillRegistry | undefined;
  providerSecretStatuses: OraProviderSecretStatus[];
  providerStatuses: OraProviderStatus[];
  selectedProviderId: string;
  selectedCustomAgentId: string | undefined;
  bridgeStatus: RuntimeBridgeStatus | undefined;
  promptText: string;
  sessionPromptTexts: Record<string, string>;
  permissionMode: PermissionMode;
  sessionPermissionModes: Record<string, PermissionMode>;
  taskIntent: TaskIntent;
  sessionTaskIntents: Record<string, TaskIntent>;
  lastRunTaskIntent?: TaskIntent;
  selectedSkillIds: string[];
  sessionSkillIds: Record<string, string[]>;
  sessionProjectFileAttachments: Record<
    string,
    ComposerProjectFileAttachment[]
  >;
  sessionLocalFileAttachments: Record<string, ComposerLocalFileAttachment[]>;
  runLifecycle: RunLifecycle;
  preservedSettledSnapshot: OraStateSnapshot | undefined;
  preservedSettledSessionId: string | undefined;
  liveMessageDeltaBuffer: LiveMessageDeltaBuffer;
  pendingPlanDecisionResolution: PendingPlanDecisionResolution | undefined;
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
      packageStore: OraPackageStoreSnapshot;
      skillRegistry: OraSkillRegistry;
      providerSecretStatuses: OraProviderSecretStatus[];
      providerStatuses: OraProviderStatus[];
      health: RuntimeHealth;
    }
  | { type: "RESET_RUNTIME_VIEW" }
  | { type: "SET_PATTERN"; pattern: CoordinationPattern }
  | { type: "SET_MODE"; modeId: string }
  | { type: "SET_MODE_SELECTION"; selection: ModeSelection }
  | { type: "SET_PERMISSION_MODE"; permissionMode: PermissionMode }
  | { type: "SET_TASK_INTENT"; taskIntent: TaskIntent }
  | {
      type: "HYDRATE_SESSION";
      projects: OraProjectSummary[];
      sessions: OraSessionSummary[];
      detail: OraSessionDetail;
      snapshot?: OraStateSnapshot;
      feedback?: string;
      preserveSelection?: boolean;
    }
  | { type: "CACHE_SESSION_DETAIL"; detail: OraSessionDetail }
  | {
      type: "SET_COLLECTIONS";
      projects: OraProjectSummary[];
      sessions: OraSessionSummary[];
      feedback?: string;
    }
  | { type: "ARCHIVE_SESSION_OPTIMISTIC"; sessionId: string }
  | { type: "SET_PROJECTS"; projects: OraProjectSummary[] }
  | { type: "SET_MODES"; modes: OraModeSpec[] }
  | { type: "SELECT_PROJECT"; projectId: string | undefined }
  | { type: "TOGGLE_PROJECT_SECTION"; projectId: string }
  | { type: "SET_PROVIDER"; providerId: string }
  | { type: "SET_SELECTED_CUSTOM_AGENT"; agentId: string | undefined }
  | { type: "SET_PROVIDER_REGISTRY"; providerRegistry: OraProviderRegistry }
  | { type: "SET_PACKAGE_STORE"; packageStore: OraPackageStoreSnapshot }
  | { type: "SET_SKILL_REGISTRY"; skillRegistry: OraSkillRegistry }
  | { type: "UPSERT_PROVIDER"; provider: OraProviderConfig }
  | { type: "DELETE_PROVIDER"; providerId: string }
  | { type: "SET_PROVIDER_SECRET_STATUS"; status: OraProviderSecretStatus }
  | {
      type: "SET_PROVIDER_SECRET_STATUSES";
      statuses: OraProviderSecretStatus[];
    }
  | { type: "SET_PROVIDER_STATUS"; status: OraProviderStatus }
  | { type: "SET_PROVIDER_STATUSES"; statuses: OraProviderStatus[] }
  | { type: "SELECT_SESSION"; sessionId: string }
  | { type: "SELECT_TURN"; runId: string; snapshot?: OraStateSnapshot }
  | { type: "REQUEST_RUN_CANCEL"; runId: string; reason: string; updatedAt: number }
  | { type: "APPLY_RUN_STREAM"; stream: OraRunEventStream; receivedAt?: number; flushedAt?: number }
  | {
      type: "BEGIN_RUN_RESUME";
      runId: string;
      approvedActionIds: string[];
      updatedAt: number;
    }
  | { type: "SELECT_TAB"; tab: DockTab }
  | { type: "SELECT_BEAT"; beatId: string | undefined }
  | { type: "SELECT_NODE"; nodeId: string }
  | { type: "SET_PROMPT"; text: string }
  | { type: "SET_SELECTED_SKILL_IDS"; skillIds: string[] }
  | {
      type: "ADD_PROJECT_FILE_ATTACHMENT";
      sessionId: string;
      file: ComposerProjectFileAttachment;
    }
  | { type: "REMOVE_PROJECT_FILE_ATTACHMENT"; sessionId: string; path: string }
  | { type: "CLEAR_PROJECT_FILE_ATTACHMENTS"; sessionId: string }
  | {
      type: "ADD_LOCAL_FILE_ATTACHMENT";
      sessionId: string;
      file: ComposerLocalFileAttachment;
    }
  | { type: "REMOVE_LOCAL_FILE_ATTACHMENT"; sessionId: string; path: string }
  | { type: "CLEAR_LOCAL_FILE_ATTACHMENTS"; sessionId: string }
  | { type: "CLEAR_PROMPT_IF_MATCH"; text: string }
  | {
      type: "BEGIN_RUN_REQUEST";
      sessionId: string;
      prompt: string;
      createdAt: number;
    }
  | {
      type: "ATTACH_PENDING_RUN_HANDLE";
      sessionId: string;
      prompt: string;
      runId: string;
    }
  | {
      type: "SET_PENDING_RUN_PROGRESS";
      sessionId: string;
      progressText: string;
    }
  | {
      type: "BEGIN_PLAN_DECISION_RESOLUTION";
      sessionId: string;
      decisionId: string;
      status: "accepted" | "declined";
      createdAt: number;
      implementationPrompt?: string;
    }
  | {
      type: "ROLLBACK_PLAN_DECISION_RESOLUTION";
      sessionId: string;
      decisionId: string;
      feedback: string;
    }
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
  | { type: "SET_LANGUAGE"; language: AppLanguage };

const initialSelectedPattern = BuiltInCoordinationPatternSchema
  .options[0];

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
  patterns: [],
  modes: [],
  providerRegistry: undefined,
  toolRegistry: undefined,
  packageStore: undefined,
  skillRegistry: undefined,
  providerSecretStatuses: [],
  providerStatuses: [],
  selectedProviderId: "",
  selectedCustomAgentId: undefined,
  bridgeStatus: {
    mode: "initializing",
    ok: false,
    label: "Runtime",
    detail: "Connecting to the Ora runtime bridge.",
  },
  promptText: "",
  sessionPromptTexts: {},
  selectedSkillIds: [],
  sessionSkillIds: {},
  permissionMode: "auto_review",
  sessionPermissionModes: {},
  taskIntent: "chat",
  sessionTaskIntents: {},
  sessionProjectFileAttachments: {},
  sessionLocalFileAttachments: {},
  runLifecycle: { stage: "idle" },
  preservedSettledSnapshot: undefined,
  preservedSettledSessionId: undefined,
  liveMessageDeltaBuffer: {},
  pendingPlanDecisionResolution: undefined,
  isLoading: false,
  busyCommand: undefined,
  commandFeedback:
    "Select a session to inspect its latest turn, checkpoints, and approvals.",
  filmstripExpanded: false,
  activeView: "chat",
  settingsOpen: false,
  sidebarCollapsed: false,
  detailDrawer: undefined,
  artifactPanelOpen: false,
  selectedArtifactId: undefined,
  language: readStoredLanguage(),
};

function replaceSessionSummary(
  sessions: OraSessionSummary[],
  session: OraSessionSummary,
): OraSessionSummary[] {
  return [
    session,
    ...sessions.filter((item) => item.sessionId !== session.sessionId),
  ];
}

function snapshotMatchesSessionSummary(
  snapshot: OraStateSnapshot | undefined,
  session: OraSessionSummary,
): snapshot is OraStateSnapshot {
  return Boolean(
    snapshot &&
      snapshot.sessionId === session.sessionId &&
      session.latestRunId === snapshot.runId,
  );
}

function applySnapshotAuthorityToSessionSummary(
  session: OraSessionSummary,
  snapshot: OraStateSnapshot | undefined,
): OraSessionSummary {
  if (!snapshotMatchesSessionSummary(snapshot, session)) {
    return session;
  }
  const normalizedSnapshot = normalizeDesktopSnapshot(snapshot);
  if (
    !isFinalRunStatus(normalizedSnapshot.status) &&
    isFinalRunStatus(session.status)
  ) {
    return session;
  }
  return {
    ...session,
    status: normalizedSnapshot.status,
    attention: normalizedSnapshot.attention,
    interactionGate: deriveSnapshotGateProjection(normalizedSnapshot),
    latestRunId: normalizedSnapshot.runId,
    latestPattern: normalizedSnapshot.pattern,
    latestModeId: normalizedSnapshot.modeId ?? session.latestModeId,
    latestProviderId:
      normalizedSnapshot.config.providerId ?? session.latestProviderId,
    latestModelRef:
      normalizedSnapshot.config.modelRef ?? session.latestModelRef,
    updatedAt: Math.max(session.updatedAt, normalizedSnapshot.updatedAt),
  };
}

function preserveFinalSessionSummary(
  incoming: OraSessionSummary,
  existing: OraSessionSummary | undefined,
): OraSessionSummary {
  if (
    !existing ||
    existing.sessionId !== incoming.sessionId ||
    existing.latestRunId !== incoming.latestRunId ||
    !isFinalRunStatus(existing.status) ||
    isFinalRunStatus(incoming.status)
  ) {
    return incoming;
  }
  return {
    ...incoming,
    status: existing.status,
    attention: existing.attention,
    interactionGate: existing.interactionGate,
    updatedAt: Math.max(incoming.updatedAt, existing.updatedAt),
  };
}

function reconcileSessionSummaryWithLocalAuthority(
  state: WorkbenchState,
  incoming: OraSessionSummary,
): OraSessionSummary {
  const existing = state.sessions.find(
    (session) => session.sessionId === incoming.sessionId,
  );
  let next = preserveFinalSessionSummary(incoming, existing);
  const activeSnapshot = getActiveSnapshot(state.runLifecycle);
  next = applySnapshotAuthorityToSessionSummary(next, activeSnapshot);
  next = applySnapshotAuthorityToSessionSummary(
    next,
    state.activeSessionDetail?.latestSnapshot,
  );
  next = applySnapshotAuthorityToSessionSummary(
    next,
    state.sessionDetailsById[incoming.sessionId]?.latestSnapshot,
  );
  return next;
}

function shouldPreserveMissingLocalSessionSummary(session: OraSessionSummary): boolean {
  if (session.archivedAt !== undefined) {
    return false;
  }
  if (
    session.status === "queued" ||
    session.status === "running" ||
    session.status === "interrupted"
  ) {
    return true;
  }
  switch (session.attention?.kind) {
    case "running":
    case "needs_approval":
    case "needs_clarification":
    case "needs_plan_decision":
    case "paused":
      return true;
    default:
      return false;
  }
}

function reconcileSessionSummariesWithLocalAuthority(
  state: WorkbenchState,
  sessions: OraSessionSummary[],
): OraSessionSummary[] {
  const reconciled = sessions.map((session) =>
    reconcileSessionSummaryWithLocalAuthority(state, session),
  );
  const incomingIds = new Set(reconciled.map((session) => session.sessionId));
  const protectedLocalSessions = state.sessions.filter(
    (session) =>
      !incomingIds.has(session.sessionId) &&
      shouldPreserveMissingLocalSessionSummary(session),
  );
  return protectedLocalSessions.length === 0
    ? reconciled
    : [...reconciled, ...protectedLocalSessions];
}

function selectedSnapshotFromDetail(
  detail: OraSessionDetail,
  snapshot?: OraStateSnapshot,
  selectedRunId?: string,
) {
  if (snapshot) {
    return mergeStateSnapshot(undefined, snapshot);
  }
  if (selectedRunId && detail.latestSnapshot?.runId === selectedRunId) {
    return mergeStateSnapshot(undefined, detail.latestSnapshot);
  }
  return mergeStateSnapshot(undefined, detail.latestSnapshot);
}

export function emptySessionDetail(session: OraSessionSummary): OraSessionDetail {
  return {
    session,
    turns: [],
    transcript: [],
    latestSnapshot: undefined,
  };
}

const MAX_CACHED_SESSION_DETAILS = 12;

function cacheSessionDetail(
  cache: Record<string, OraSessionDetail>,
  detail: OraSessionDetail,
): Record<string, OraSessionDetail> {
  const next = {
    ...cache,
    [detail.session.sessionId]: detail,
  };
  const keys = Object.keys(next);
  if (keys.length <= MAX_CACHED_SESSION_DETAILS) return next;
  const evicted = keys.slice(0, keys.length - MAX_CACHED_SESSION_DETAILS);
  for (const key of evicted) {
    delete next[key];
  }
  return next;
}

function compactSessionDetailForCache(detail: OraSessionDetail): OraSessionDetail {
  if (!detail.latestSnapshot) {
    return detail;
  }
  return {
    ...detail,
    latestSnapshot: {
      ...detail.latestSnapshot,
      events: [],
      actions: [],
      output: undefined,
    },
  };
}

function sessionPromptText(
  state: WorkbenchState,
  sessionId: string | undefined,
): string {
  return sessionId ? (state.sessionPromptTexts[sessionId] ?? "") : "";
}

function sessionSkillIds(
  state: WorkbenchState,
  sessionId: string | undefined,
): string[] {
  return sessionId ? (state.sessionSkillIds[sessionId] ?? []) : [];
}

function setSessionPromptText(
  state: WorkbenchState,
  text: string,
): Record<string, string> {
  if (!state.selectedSessionId) {
    return state.sessionPromptTexts;
  }
  if (!text) {
    const { [state.selectedSessionId]: _cleared, ...rest } =
      state.sessionPromptTexts;
    return rest;
  }
  return {
    ...state.sessionPromptTexts,
    [state.selectedSessionId]: text,
  };
}

function clearSessionPromptText(
  state: WorkbenchState,
  sessionId: string,
): Record<string, string> {
  const { [sessionId]: _cleared, ...rest } = state.sessionPromptTexts;
  return rest;
}

function setSessionSkillIds(
  state: WorkbenchState,
  skillIds: string[],
): Record<string, string[]> {
  if (!state.selectedSessionId) {
    return state.sessionSkillIds;
  }
  if (skillIds.length === 0) {
    const { [state.selectedSessionId]: _cleared, ...rest } =
      state.sessionSkillIds;
    return rest;
  }
  return {
    ...state.sessionSkillIds,
    [state.selectedSessionId]: skillIds,
  };
}

function clearSessionSkillIds(
  state: WorkbenchState,
  sessionId: string,
): Record<string, string[]> {
  const { [sessionId]: _cleared, ...rest } = state.sessionSkillIds;
  return rest;
}

function sessionTaskIntent(
  state: WorkbenchState,
  sessionId: string | undefined,
): TaskIntent {
  return sessionId
    ? (state.sessionTaskIntents[sessionId] ?? "implement")
    : "implement";
}

function setSessionTaskIntent(
  state: WorkbenchState,
  taskIntent: TaskIntent,
): Record<string, TaskIntent> {
  if (!state.selectedSessionId) return state.sessionTaskIntents;
  return { ...state.sessionTaskIntents, [state.selectedSessionId]: taskIntent };
}

function clearSessionTaskIntent(
  state: WorkbenchState,
  sessionId: string,
): Record<string, TaskIntent> {
  const { [sessionId]: _cleared, ...rest } = state.sessionTaskIntents;
  return rest;
}

function sessionPermissionMode(
  state: WorkbenchState,
  sessionId: string | undefined,
): PermissionMode {
  return sessionId
    ? (state.sessionPermissionModes[sessionId] ?? "auto_review")
    : "auto_review";
}

function setSessionPermissionMode(
  state: WorkbenchState,
  permissionMode: PermissionMode,
): Record<string, PermissionMode> {
  if (!state.selectedSessionId) return state.sessionPermissionModes;
  return {
    ...state.sessionPermissionModes,
    [state.selectedSessionId]: permissionMode,
  };
}

function clearSessionPermissionMode(
  state: WorkbenchState,
  sessionId: string,
): Record<string, PermissionMode> {
  const { [sessionId]: _cleared, ...rest } = state.sessionPermissionModes;
  return rest;
}

function addProjectFileAttachment(
  state: WorkbenchState,
  sessionId: string,
  file: ComposerProjectFileAttachment,
): Record<string, ComposerProjectFileAttachment[]> {
  const current = state.sessionProjectFileAttachments[sessionId] ?? [];
  if (
    current.some(
      (item) => item.projectId === file.projectId && item.path === file.path,
    )
  ) {
    return state.sessionProjectFileAttachments;
  }
  return {
    ...state.sessionProjectFileAttachments,
    [sessionId]: [...current, file],
  };
}

function removeProjectFileAttachment(
  state: WorkbenchState,
  sessionId: string,
  path: string,
): Record<string, ComposerProjectFileAttachment[]> {
  const nextFiles = (
    state.sessionProjectFileAttachments[sessionId] ?? []
  ).filter((file) => file.path !== path);
  if (nextFiles.length === 0) {
    const { [sessionId]: _cleared, ...rest } =
      state.sessionProjectFileAttachments;
    return rest;
  }
  return {
    ...state.sessionProjectFileAttachments,
    [sessionId]: nextFiles,
  };
}

function clearProjectFileAttachments(
  state: WorkbenchState,
  sessionId: string,
): Record<string, ComposerProjectFileAttachment[]> {
  const { [sessionId]: _cleared, ...rest } =
    state.sessionProjectFileAttachments;
  return rest;
}

function addLocalFileAttachment(
  state: WorkbenchState,
  sessionId: string,
  file: ComposerLocalFileAttachment,
): Record<string, ComposerLocalFileAttachment[]> {
  const current = state.sessionLocalFileAttachments[sessionId] ?? [];
  if (current.some((item) => item.path === file.path)) {
    return state.sessionLocalFileAttachments;
  }
  return {
    ...state.sessionLocalFileAttachments,
    [sessionId]: [...current, file],
  };
}

function removeLocalFileAttachment(
  state: WorkbenchState,
  sessionId: string,
  path: string,
): Record<string, ComposerLocalFileAttachment[]> {
  const nextFiles = (state.sessionLocalFileAttachments[sessionId] ?? []).filter(
    (file) => file.path !== path,
  );
  if (nextFiles.length === 0) {
    const { [sessionId]: _cleared, ...rest } =
      state.sessionLocalFileAttachments;
    return rest;
  }
  return {
    ...state.sessionLocalFileAttachments,
    [sessionId]: nextFiles,
  };
}

function clearLocalFileAttachments(
  state: WorkbenchState,
  sessionId: string,
): Record<string, ComposerLocalFileAttachment[]> {
  const { [sessionId]: _cleared, ...rest } = state.sessionLocalFileAttachments;
  return rest;
}

function resolveSelectedMode(
  modes: OraModeSpec[],
  selectedModeId: string,
): OraModeSpec | undefined {
  if (selectedModeId) {
    const selectedMode = modes.find((mode) => mode.id === selectedModeId);
    if (selectedMode) {
      return selectedMode;
    }
  }
  return modes.find((mode) => mode.id === SINGLE_AGENT_MODE_ID) ?? modes[0];
}

function mergeByKey<T>(
  existing: readonly T[] | undefined,
  incoming: readonly T[] | undefined,
  keyForItem: (item: T) => string | number | undefined,
): T[] {
  const unkeyed: T[] = [];
  const itemByKey = new Map<string | number, T>();
  for (const item of existing ?? []) {
    const key = keyForItem(item);
    if (key === undefined) {
      unkeyed.push(item);
      continue;
    }
    itemByKey.set(key, item);
  }
  for (const item of incoming ?? []) {
    const key = keyForItem(item);
    if (key === undefined) {
      unkeyed.push(item);
      continue;
    }
    itemByKey.set(key, item);
  }
  return [...unkeyed, ...itemByKey.values()];
}

function mergeById<T extends { id: string }>(
  existing: readonly T[] | undefined,
  incoming: readonly T[] | undefined,
): T[] {
  return mergeByKey(existing, incoming, (item) => item.id);
}

function mergeEvents(
  existing: OraStateSnapshot["events"],
  incoming: OraStateSnapshot["events"],
): OraStateSnapshot["events"] {
  return mergeByKey(existing, incoming, (event) => event.seq).sort(
    (left, right) => left.seq - right.seq,
  );
}

function mergeLatencyDiagnostics(
  ...sources: Array<OraStateSnapshot["latency"] | undefined>
): OraStateSnapshot["latency"] | undefined {
  const marks = sources
    .flatMap((source) => source?.marks ?? [])
    .sort(
      (left, right) =>
        left.at - right.at ||
        left.source.localeCompare(right.source) ||
        left.name.localeCompare(right.name),
    );
  if (marks.length === 0) {
    return undefined;
  }
  const seen = new Set<string>();
  return {
    marks: marks.filter((mark) => {
      const key = `${mark.source}:${mark.name}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    }),
  };
}

function mergeAgentMessages(
  ...sources: Array<OraStateSnapshot["agentMessages"] | undefined>
): OraStateSnapshot["agentMessages"] {
  const messageById = new Map<
    string,
    OraStateSnapshot["agentMessages"][number]
  >();
  for (const source of sources) {
    for (const message of source ?? []) {
      messageById.set(message.id, message);
    }
  }
  return [...messageById.values()].sort(
    (left, right) =>
      left.createdAt - right.createdAt || left.id.localeCompare(right.id),
  );
}

function agentMessagesFromEvents(
  events: OraStateSnapshot["events"],
): OraStateSnapshot["agentMessages"] {
  const messages: OraStateSnapshot["agentMessages"] = [];
  for (const event of events) {
    if (
      event.type !== "agent.message" ||
      !isRecord(event.payload) ||
      !isRecord(event.payload.message)
    ) {
      continue;
    }
    const message = readAgentConversationMessage(event.payload.message);
    if (message) {
      messages.push(message);
    }
  }
  return messages;
}

function normalizeStateSnapshot(snapshot: OraStateSnapshot): OraStateSnapshot {
  return {
    ...snapshot,
    agentMessages: mergeAgentMessages(
      snapshot.agentMessages,
      agentMessagesFromEvents(snapshot.events),
    ),
  };
}

function isFinalRunStatus(
  status: OraStateSnapshot["status"] | undefined,
): status is OraStateSnapshot["status"] {
  return status === "succeeded" || status === "failed" || status === "cancelled" || status === "interrupted";
}

export function mergeStateSnapshot(
  existing: OraStateSnapshot | undefined,
  incoming: OraStateSnapshot | undefined,
): OraStateSnapshot | undefined {
  if (!incoming) {
    return existing ? normalizeStateSnapshot(existing) : existing;
  }
  const normalizedIncoming = normalizeStateSnapshot(incoming);
  if (!existing || existing.runId !== normalizedIncoming.runId) {
    return normalizedIncoming;
  }
  const normalizedExisting = normalizeStateSnapshot(existing);
  if (
    normalizedExisting.sessionId &&
    normalizedIncoming.sessionId &&
    normalizedExisting.sessionId !== normalizedIncoming.sessionId
  ) {
    return normalizedIncoming;
  }

  const events = mergeEvents(
    normalizedExisting.events,
    normalizedIncoming.events,
  );
  const preserveFinalStatus =
    isFinalRunStatus(normalizedExisting.status) &&
    !isFinalRunStatus(normalizedIncoming.status);
  return {
    ...normalizedExisting,
    ...normalizedIncoming,
    turnIndex: normalizedIncoming.turnIndex ?? normalizedExisting.turnIndex,
    sessionId: normalizedIncoming.sessionId ?? normalizedExisting.sessionId,
    status: preserveFinalStatus
      ? normalizedExisting.status
      : normalizedIncoming.status,
    attention: preserveFinalStatus
      ? normalizedExisting.attention
      : normalizedIncoming.attention,
    coordinationKind:
      normalizedIncoming.coordinationKind ??
      normalizedExisting.coordinationKind,
    modeId: normalizedIncoming.modeId ?? normalizedExisting.modeId,
    profiles: mergeById(
      normalizedExisting.profiles,
      normalizedIncoming.profiles,
    ),
    memory: mergeById(normalizedExisting.memory, normalizedIncoming.memory),
    plan: mergeById(normalizedExisting.plan, normalizedIncoming.plan),
    todos: mergeById(normalizedExisting.todos, normalizedIncoming.todos),
    actions: mergeById(normalizedExisting.actions, normalizedIncoming.actions),
    toolCalls: mergeById(
      normalizedExisting.toolCalls,
      normalizedIncoming.toolCalls,
    ),
    toolResults: mergeByKey(
      normalizedExisting.toolResults,
      normalizedIncoming.toolResults,
      (result) => result.key,
    ),
    policyDecisions: mergeById(
      normalizedExisting.policyDecisions,
      normalizedIncoming.policyDecisions,
    ),
    checkpoints: mergeById(
      normalizedExisting.checkpoints,
      normalizedIncoming.checkpoints,
    ),
    events,
    agentMessages: mergeAgentMessages(
      normalizedExisting.agentMessages,
      normalizedIncoming.agentMessages,
      agentMessagesFromEvents(events),
    ),
    artifacts: mergeById(
      normalizedExisting.artifacts,
      normalizedIncoming.artifacts,
    ),
    trace: normalizedIncoming.trace ?? normalizedExisting.trace,
    latency: mergeLatencyDiagnostics(
      normalizedExisting.latency,
      normalizedIncoming.latency,
    ),
    modeSpec: normalizedIncoming.modeSpec ?? normalizedExisting.modeSpec,
    output: normalizedIncoming.output ?? normalizedExisting.output,
    error: normalizedIncoming.error ?? normalizedExisting.error,
    updatedAt: Math.max(
      normalizedExisting.updatedAt,
      normalizedIncoming.updatedAt,
    ),
  };
}

function mergeStreamClarificationUpdates(
  snapshot: OraStateSnapshot,
  stream: OraRunEventStream,
): OraStateSnapshot["pendingClarifications"] {
  const updated = [...(snapshot.pendingClarifications ?? [])];
  for (const event of stream.events) {
    if (
      event.type === "clarification.required" &&
      isRecord(event.payload) &&
      isRecord(event.payload.clarification)
    ) {
      const payload = event.payload.clarification as Record<string, unknown>;
      const id = typeof payload.id === "string" ? payload.id : undefined;
      if (!id) continue;
      const existingIndex = updated.findIndex((c) => c.id === id);
      const clarification =
        payload as unknown as OraStateSnapshot["pendingClarifications"][number];
      if (existingIndex >= 0) {
        updated[existingIndex] = clarification;
      } else {
        updated.push(clarification);
      }
    }
    if (event.type === "clarification.resolved" && isRecord(event.payload)) {
      const clarificationId =
        typeof event.payload.clarificationId === "string"
          ? event.payload.clarificationId
          : undefined;
      if (!clarificationId) continue;
      const index = updated.findIndex((c) => c.id === clarificationId);
      if (index >= 0) {
        updated.splice(index, 1);
      }
    }
  }
  return updated;
}

function mergeStreamPlanListUpdates(
  snapshot: OraStateSnapshot,
  stream: OraRunEventStream,
): OraStateSnapshot["planList"] {
  let planList = snapshot.planList ?? [];

  for (const event of stream.events) {
    if (event.type !== "plan_list.updated" || !isRecord(event.payload)) {
      continue;
    }
    const payloadPlan = event.payload.plan;
    if (!Array.isArray(payloadPlan)) {
      continue;
    }
    const nextPlan: OraStateSnapshot["planList"] = [];
    let valid = true;
    for (const item of payloadPlan) {
      const parsed = PlanListStepSchema.safeParse(item);
      if (!parsed.success) {
        valid = false;
        break;
      }
      nextPlan.push(parsed.data);
    }
    if (valid) {
      planList = nextPlan;
    }
  }

  return planList;
}

export function mergeRunStreamSnapshot(
  snapshot: OraStateSnapshot | undefined,
  stream: OraRunEventStream,
): OraStateSnapshot | undefined {
  if (stream.snapshot) {
    const merged = mergeStateSnapshot(snapshot, stream.snapshot);
    return merged ? normalizeDesktopSnapshot(mergeStreamLatency(merged, stream)) : undefined;
  }
  if (!snapshot || snapshot.runId !== stream.runId) {
    return snapshot;
  }
  const events = canAppendStreamEvents(snapshot.events, stream.events)
    ? [...snapshot.events, ...stream.events]
    : mergeEventsBySeq(snapshot.events, stream.events);
  const merged = mergeStreamActionUpdates(snapshot, stream);
  const pendingClarifications = mergeStreamClarificationUpdates(
    snapshot,
    stream,
  );
  const planList = mergeStreamPlanListUpdates(snapshot, stream);
  const agentMessages = mergeStreamAgentMessages(snapshot, stream);
  return normalizeDesktopSnapshot(mergeStreamLatency({
    ...snapshot,
    status: streamRunStatus(stream, snapshot) ?? snapshot.status,
    planList,
    actions: merged.actions,
    pendingApprovals: merged.pendingApprovals,
    pendingClarifications,
    agentMessages,
    events,
    updatedAt: stream.events.at(-1)?.createdAt ?? snapshot.updatedAt,
  }, stream));
}

export function pruneTurnSnapshotsForActiveSession(
  snapshots: Record<string, OraStateSnapshot>,
  detail: OraSessionDetail | undefined,
): Record<string, OraStateSnapshot> {
  if (!detail) {
    const runningSnapshots = Object.fromEntries(
      Object.entries(snapshots).filter(
        ([, snapshot]) => !isSettledRunStatus(snapshot.status),
      ),
    );
    return Object.keys(runningSnapshots).length === Object.keys(snapshots).length
      ? snapshots
      : runningSnapshots;
  }

  const activeSessionId = detail.session.sessionId;
  const activeRunIds = new Set(detail.turns.map((turn) => turn.runId));
  let changed = false;
  const next: Record<string, OraStateSnapshot> = {};

  for (const [runId, snapshot] of Object.entries(snapshots)) {
    const matchesActiveSession =
      !snapshot.sessionId || snapshot.sessionId === activeSessionId;
    const belongsToActiveSession =
      activeRunIds.has(runId) || snapshot.sessionId === activeSessionId;
    const shouldKeepRunningSnapshot = !isSettledRunStatus(snapshot.status);

    if ((matchesActiveSession && belongsToActiveSession) || shouldKeepRunningSnapshot) {
      next[runId] = snapshot;
    } else {
      changed = true;
    }
  }

  return changed ? next : snapshots;
}

export function deriveRenderableTurnSnapshots(params: {
  detail: OraSessionDetail | undefined;
  activeSnapshot: OraStateSnapshot | undefined;
  turnSnapshots: Record<string, OraStateSnapshot>;
  selectedSessionId: string | undefined;
  preservedSettledSnapshot: OraStateSnapshot | undefined;
}): Record<string, OraStateSnapshot> {
  const { detail, activeSnapshot: latestSnapshot, turnSnapshots, selectedSessionId, preservedSettledSnapshot } = params;
  if (!detail) {
    if (latestSnapshot && latestSnapshot.sessionId === selectedSessionId) {
      return { [latestSnapshot.runId]: latestSnapshot };
    }
    return {};
  }

  const activeSessionId = detail.session.sessionId;
  const activeRunIds = new Set(detail.turns.map((turn) => turn.runId));
  const scopedSnapshots: Record<string, OraStateSnapshot> = {};
  for (const [runId, snapshot] of Object.entries(turnSnapshots)) {
    const snapshotMatchesSession = !snapshot.sessionId || snapshot.sessionId === activeSessionId;
    if ((activeRunIds.has(runId) && snapshotMatchesSession) || snapshot.sessionId === activeSessionId) {
      scopedSnapshots[runId] = snapshot;
    }
  }

  if (latestSnapshot && latestSnapshot.sessionId === activeSessionId) {
    scopedSnapshots[latestSnapshot.runId] = latestSnapshot;
    for (const turn of detail.turns) {
      if (scopedSnapshots[turn.runId]) continue;
      if (latestSnapshot.runId === turn.runId) {
        scopedSnapshots[turn.runId] = latestSnapshot;
      } else {
        const turnEvents = latestSnapshot.events.filter((e) => e.runId === turn.runId);
        if (turnEvents.length > 0) {
          scopedSnapshots[turn.runId] = { ...latestSnapshot, runId: turn.runId, turnIndex: turn.turnIndex, events: turnEvents };
        }
      }
    }
  }

  if (preservedSettledSnapshot) {
    const { sessionId, runId } = preservedSettledSnapshot;
    if ((!sessionId || sessionId === activeSessionId) && !scopedSnapshots[runId]) {
      scopedSnapshots[runId] = preservedSettledSnapshot;
    }
  }

  return scopedSnapshots;
}

function canAppendStreamEvents(
  existingEvents: readonly OraStateSnapshot["events"][number][],
  incomingEvents: readonly OraRunEventStream["events"][number][],
): boolean {
  if (incomingEvents.length === 0) {
    return true;
  }
  const lastExistingSeq = existingEvents.at(-1)?.seq ?? -1;
  let previousSeq = lastExistingSeq;
  for (const event of incomingEvents) {
    if (event.seq <= previousSeq) {
      return false;
    }
    previousSeq = event.seq;
  }
  return true;
}

function mergeEventsBySeq(
  existingEvents: readonly OraStateSnapshot["events"][number][],
  incomingEvents: readonly OraRunEventStream["events"][number][],
): OraStateSnapshot["events"] {
  const eventBySeq = new Map(existingEvents.map((event) => [event.seq, event]));
  for (const event of incomingEvents) {
    eventBySeq.set(event.seq, event);
  }
  return [...eventBySeq.values()].sort((left, right) => left.seq - right.seq);
}

function markDesktopLatencyForStream(
  snapshot: OraStateSnapshot | undefined,
  stream: OraRunEventStream,
  receivedAt: number | undefined,
  flushedAt: number | undefined,
): OraStateSnapshot | undefined {
  if (!snapshot) {
    return snapshot;
  }
  let next = mergeStreamLatency(snapshot, stream);
  if (receivedAt !== undefined) {
    next = appendFirstDesktopLatencyMark(next, "firstRunStreamReceivedAt", receivedAt, streamLatencyDetail(stream));
    if (
      stream.events.some(
        (event) => event.type === "message.delta" || event.type === "token.delta",
      )
    ) {
      next = appendFirstDesktopLatencyMark(
        next,
        "firstMessageDeltaAt",
        receivedAt,
      );
    }
    if (
      stream.events.some(
        (event) =>
          event.type === "message.delta" &&
          isRecord(event.payload) &&
          typeof event.payload.content === "string" &&
          event.payload.content.trim(),
      )
    ) {
      next = appendFirstDesktopLatencyMark(
        next,
        "firstNonProgressAssistantTextAt",
        receivedAt,
      );
    }
  }
  if (flushedAt !== undefined) {
    next = appendFirstDesktopLatencyMark(
      next,
      "firstRunStreamBatchFlushedAt",
      flushedAt,
      streamLatencyDetail(stream),
    );
  }
  return next;
}

function markPendingRunLatencyForStream(
  pendingRun: PendingRunState | undefined,
  stream: OraRunEventStream,
  receivedAt: number | undefined,
  flushedAt: number | undefined,
): PendingRunState | undefined {
  if (!pendingRun) {
    return pendingRun;
  }
  let latency = mergeLatencyDiagnostics(pendingRun.latency, stream.latency);
  if (receivedAt !== undefined) {
    latency = appendFirstDesktopLatencyToDiagnostics(
      latency,
      "firstRunStreamReceivedAt",
      receivedAt,
      streamLatencyDetail(stream),
    );
    if (
      stream.events.some(
        (event) => event.type === "message.delta" || event.type === "token.delta",
      )
    ) {
      latency = appendFirstDesktopLatencyToDiagnostics(latency, "firstMessageDeltaAt", receivedAt);
    }
    if (
      stream.events.some(
        (event) =>
          event.type === "message.delta" &&
          isRecord(event.payload) &&
          typeof event.payload.content === "string" &&
          event.payload.content.trim(),
      )
    ) {
      latency = appendFirstDesktopLatencyToDiagnostics(latency, "firstNonProgressAssistantTextAt", receivedAt);
    }
  }
  if (flushedAt !== undefined) {
    latency = appendFirstDesktopLatencyToDiagnostics(
      latency,
      "firstRunStreamBatchFlushedAt",
      flushedAt,
      streamLatencyDetail(stream),
    );
  }
  return latency === pendingRun.latency ? pendingRun : { ...pendingRun, latency };
}

function liveMessageDeltaBufferKey(runId: string, messageId: string): string {
  return `${runId}:${messageId}`;
}

function applyStreamToLiveMessageDeltaBuffer(
  buffer: LiveMessageDeltaBuffer,
  stream: OraRunEventStream,
): LiveMessageDeltaBuffer {
  let next = buffer;
  for (const event of stream.events) {
    if (event.type !== "message.delta" || !isRecord(event.payload)) {
      continue;
    }
    if (
      event.payload.visibility === "internal" ||
      event.payload.audience === "internal" ||
      event.payload.public === false
    ) {
      continue;
    }
    const role = event.payload.role;
    const messageId = event.payload.messageId;
    if (role !== "assistant" || typeof messageId !== "string" || !messageId.trim()) {
      continue;
    }
    const key = liveMessageDeltaBufferKey(stream.runId, messageId);
    const existing = next[key];
    if (existing && event.seq <= existing.latestSeq) {
      continue;
    }
    const projection = mergeAssistantMessageTextProjection(
      existing ? { text: existing.content } : undefined,
      event.payload,
    );
    if (!projection?.text) {
      continue;
    }
    if (next === buffer) {
      next = { ...buffer };
    }
    next[key] = {
      runId: stream.runId,
      messageId,
      sessionId: stream.sessionId ?? existing?.sessionId,
      role: "assistant",
      content: projection.text,
      agentId: event.agentId ?? existing?.agentId,
      nodeId: event.nodeId ?? existing?.nodeId,
      createdAt: existing?.createdAt ?? event.createdAt,
      updatedAt: event.createdAt,
      latestSeq: event.seq,
    };
  }
  return pruneLiveMessageDeltaBuffer(next, stream);
}

function pruneLiveMessageDeltaBuffer(
  buffer: LiveMessageDeltaBuffer,
  stream: OraRunEventStream,
): LiveMessageDeltaBuffer {
  const status = streamRunStatus(stream, stream.snapshot);
  if (!isSettledRunStatus(status)) {
    return buffer;
  }
  let changed = false;
  const next: LiveMessageDeltaBuffer = {};
  for (const [key, entry] of Object.entries(buffer)) {
    if (entry.runId === stream.runId) {
      changed = true;
      continue;
    }
    next[key] = entry;
  }
  return changed ? next : buffer;
}

function streamLatencyDetail(stream: OraRunEventStream): Record<string, unknown> {
  return {
    eventType: stream.events[0]?.type,
    eventCount: stream.events.length,
  };
}

function mergeStreamLatency(
  snapshot: OraStateSnapshot,
  stream: OraRunEventStream,
): OraStateSnapshot {
  const latency = mergeLatencyDiagnostics(snapshot.latency, stream.latency);
  if (latency === snapshot.latency) {
    return snapshot;
  }
  return {
    ...snapshot,
    latency,
  };
}

function appendFirstDesktopLatencyToDiagnostics(
  latency: OraStateSnapshot["latency"] | undefined,
  name: string,
  at: number,
  detail: Record<string, unknown> = {},
): OraStateSnapshot["latency"] {
  if (latency?.marks.some((mark) => mark.source === "desktop" && mark.name === name)) {
    return latency;
  }
  return {
    marks: [
      ...(latency?.marks ?? []),
      {
        name,
        at,
        source: "desktop",
        detail,
      },
    ],
  };
}

function appendFirstDesktopLatencyMark(
  snapshot: OraStateSnapshot,
  name: string,
  at: number,
  detail: Record<string, unknown> = {},
): OraStateSnapshot {
  const latency = appendFirstDesktopLatencyToDiagnostics(snapshot.latency, name, at, detail);
  if (latency === snapshot.latency) return snapshot;
  return {
    ...snapshot,
    latency,
  };
}

function mergeStreamAgentMessages(
  snapshot: OraStateSnapshot,
  stream: OraRunEventStream,
): OraStateSnapshot["agentMessages"] {
  const messageById = new Map(
    (snapshot.agentMessages ?? []).map((message) => [message.id, message]),
  );
  for (const event of stream.events) {
    if (
      event.type !== "agent.message" ||
      !isRecord(event.payload) ||
      !isRecord(event.payload.message)
    ) {
      continue;
    }
    const message = readAgentConversationMessage(event.payload.message);
    if (message) {
      messageById.set(message.id, message);
    }
  }
  return [...messageById.values()].sort(
    (left, right) =>
      left.createdAt - right.createdAt || left.id.localeCompare(right.id),
  );
}

function readAgentConversationMessage(
  value: Record<string, unknown>,
): OraStateSnapshot["agentMessages"][number] | undefined {
  if (
    typeof value.id !== "string" ||
    typeof value.runId !== "string" ||
    typeof value.createdAt !== "number" ||
    typeof value.fromAgentId !== "string" ||
    typeof value.threadId !== "string" ||
    typeof value.kind !== "string" ||
    typeof value.status !== "string" ||
    typeof value.content !== "string"
  ) {
    return undefined;
  }
  return {
    id: value.id,
    runId: value.runId,
    createdAt: value.createdAt,
    fromAgentId: value.fromAgentId,
    toAgentIds: Array.isArray(value.toAgentIds)
      ? value.toAgentIds.filter(
          (item): item is string => typeof item === "string",
        )
      : [],
    replyToId:
      typeof value.replyToId === "string" ? value.replyToId : undefined,
    threadId: value.threadId,
    nodeId: typeof value.nodeId === "string" ? value.nodeId : undefined,
    planItemId:
      typeof value.planItemId === "string" ? value.planItemId : undefined,
    kind: value.kind as OraStateSnapshot["agentMessages"][number]["kind"],
    status: value.status as OraStateSnapshot["agentMessages"][number]["status"],
    content: value.content,
    topic: typeof value.topic === "string" ? value.topic : undefined,
    correlationId:
      typeof value.correlationId === "string" ? value.correlationId : undefined,
    artifactIds: Array.isArray(value.artifactIds)
      ? value.artifactIds.filter(
          (item): item is string => typeof item === "string",
        )
      : [],
    transcript: readAgentConversationTranscript(value.transcript),
  };
}

function readAgentConversationTranscript(
  value: unknown,
): OraStateSnapshot["agentMessages"][number]["transcript"] | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  if (
    value.kind !== "stage_transcript" ||
    typeof value.groupId !== "string" ||
    typeof value.stageId !== "string" ||
    typeof value.stageLabel !== "string" ||
    typeof value.sequence !== "number" ||
    typeof value.speakerLabel !== "string"
  ) {
    return undefined;
  }
  const stance =
    typeof value.stance === "string" && value.stance.trim()
      ? value.stance
      : "neutral";
  const status =
    value.status === "sent" ||
    value.status === "running" ||
    value.status === "done" ||
    value.status === "failed"
      ? value.status
      : "done";
  return {
    kind: "stage_transcript",
    groupId: value.groupId,
    groupLabel:
      typeof value.groupLabel === "string" ? value.groupLabel : undefined,
    stageId: value.stageId,
    stageLabel: value.stageLabel,
    sequence: value.sequence,
    speakerLabel: value.speakerLabel,
    speakerId:
      typeof value.speakerId === "string" ? value.speakerId : undefined,
    stance,
    status,
    layout: readTranscriptLayout(value.layout),
  };
}

function readTranscriptLayout(
  value: unknown,
):
  | NonNullable<
      OraStateSnapshot["agentMessages"][number]["transcript"]
    >["layout"]
  | undefined {
  const parsed = ModeTranscriptLayoutSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function mergeStreamActionUpdates(
  snapshot: OraStateSnapshot,
  stream: OraRunEventStream,
): Pick<OraStateSnapshot, "actions" | "pendingApprovals"> {
  const actionById = new Map(
    snapshot.actions.map((action) => [action.id, action]),
  );
  const pendingApprovals = new Set(snapshot.pendingApprovals);

  for (const event of stream.events) {
    if (event.type !== "action.updated" || !isRecord(event.payload)) {
      continue;
    }

    const actionId =
      typeof event.payload.actionId === "string"
        ? event.payload.actionId
        : undefined;
    const status = readActionStatus(event.payload.status);
    const record = readActionRecord(event.payload.record);
    const id = record?.id ?? actionId;
    if (!id) {
      continue;
    }

    const existing = actionById.get(id);
    if (record) {
      actionById.set(id, record);
    } else if (existing && status) {
      actionById.set(id, { ...existing, status });
    }

    const nextStatus = record?.status ?? status;
    if (nextStatus === "approval_required") {
      pendingApprovals.add(id);
    } else if (nextStatus) {
      pendingApprovals.delete(id);
    }
  }

  return {
    actions: [...actionById.values()],
    pendingApprovals: [...pendingApprovals],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readActionRecord(value: unknown): OraActionRecord | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  if (
    typeof value.id !== "string" ||
    typeof value.runId !== "string" ||
    typeof value.type !== "string"
  ) {
    return undefined;
  }
  const status = readActionStatus(value.status);
  const riskLevel =
    value.riskLevel === "low" ||
    value.riskLevel === "medium" ||
    value.riskLevel === "high"
      ? value.riskLevel
      : undefined;
  if (!status || !riskLevel || !Array.isArray(value.artifactIds)) {
    return undefined;
  }
  return value as OraActionRecord;
}

function readActionStatus(
  value: unknown,
): OraActionRecord["status"] | undefined {
  switch (value) {
    case "proposed":
    case "approval_required":
    case "approved":
    case "running":
    case "succeeded":
    case "failed":
    case "denied":
      return value;
    default:
      return undefined;
  }
}

function normalizeDesktopSnapshot(snapshot: OraStateSnapshot): OraStateSnapshot {
  if (
    snapshot.status === "queued" ||
    snapshot.status === "running" ||
    (snapshot.attention != null && snapshot.attention.kind !== "running")
  ) {
    return snapshot;
  }

  return {
    ...snapshot,
    attention: terminalRunAttentionForStatus(snapshot),
  };
}

function terminalRunAttentionForStatus(snapshot: OraStateSnapshot): RunAttention {
  switch (snapshot.status) {
    case "failed":
      return {
        kind: "failed",
        blocking: false,
        sourceRunId: snapshot.runId,
        reason: snapshot.error,
        pendingActionIds: [],
        pendingToolCallIds: [],
        pendingClarificationIds: [],
      };
    case "cancelled":
      return {
        kind: "cancelled",
        blocking: false,
        sourceRunId: snapshot.runId,
        reason: snapshot.error,
        pendingActionIds: [],
        pendingToolCallIds: [],
        pendingClarificationIds: [],
      };
    case "interrupted":
      return {
        kind: "paused",
        blocking: false,
        sourceRunId: snapshot.runId,
        reason: "manual_interrupt",
        pendingActionIds: [],
        pendingToolCallIds: [],
        pendingClarificationIds: [],
      };
    default:
      return {
        kind: "idle",
        blocking: false,
        sourceRunId: snapshot.runId,
        pendingActionIds: [],
        pendingToolCallIds: [],
        pendingClarificationIds: [],
      };
  }
}

function streamRunStatus(
  stream: OraRunEventStream,
  snapshot: OraStateSnapshot | undefined,
): OraStateSnapshot["status"] | undefined {
  const terminalStatus = terminalStatusFromStreamEvents(stream.events);
  if (terminalStatus) {
    return terminalStatus;
  }
  if (isFinalRunStatus(snapshot?.status) && !isFinalRunStatus(stream.status)) {
    return snapshot.status;
  }
  return stream.status ?? (snapshot?.runId === stream.runId ? snapshot.status : undefined);
}

function terminalStatusFromStreamEvents(
  events: readonly OraRunEventStream["events"][number][],
): OraStateSnapshot["status"] | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    switch (events[index]?.type) {
      case "run.done":
        return "succeeded";
      case "run.failed":
        return "failed";
      case "run.cancelled":
        return "cancelled";
      case "run.interrupted":
        return "interrupted";
      default:
        break;
    }
  }
  return undefined;
}

function isSettledRunStatus(
  status: OraStateSnapshot["status"] | undefined,
): status is OraStateSnapshot["status"] {
  return status !== undefined && status !== "queued" && status !== "running";
}

function isLiveDeltaOnlyStream(stream: OraRunEventStream): boolean {
  return (
    !stream.snapshot &&
    stream.events.length > 0 &&
    stream.events.every(
      (event) => event.type === "message.delta" || event.type === "token.delta",
    )
  );
}

function streamCanUseLiveDeltaOverlay(
  stream: OraRunEventStream,
  currentActiveSnapshot: OraStateSnapshot | undefined,
  streamSnapshot: OraStateSnapshot | undefined,
): boolean {
  if (!currentActiveSnapshot || currentActiveSnapshot.runId !== stream.runId) {
    return false;
  }
  if (isSettledRunStatus(currentActiveSnapshot.status)) {
    return false;
  }
  if (!isLiveDeltaOnlyStream(stream)) {
    return false;
  }
  if (!snapshotHasDesktopFirstDeltaMark(currentActiveSnapshot)) {
    return false;
  }
  return !isSettledRunStatus(streamRunStatus(stream, streamSnapshot));
}

function snapshotHasDesktopFirstDeltaMark(snapshot: OraStateSnapshot): boolean {
  return Boolean(
    snapshot.latency?.marks.some(
      (mark) => mark.source === "desktop" && mark.name === "firstMessageDeltaAt",
    ),
  );
}

function streamUpdatedAt(
  stream: OraRunEventStream,
  snapshot: OraStateSnapshot | undefined,
): number | undefined {
  if (snapshot?.runId === stream.runId) {
    return snapshot.updatedAt;
  }
  return stream.events.at(-1)?.createdAt;
}

function inferredStreamSessionStatus(
  stream: OraRunEventStream,
  snapshot: OraStateSnapshot | undefined,
): OraStateSnapshot["status"] | undefined {
  const explicitStatus = streamRunStatus(stream, snapshot);
  if (explicitStatus) {
    return explicitStatus;
  }
  return stream.events.length > 0 ? "running" : undefined;
}

function sessionSummaryMatchesStream(
  session: OraSessionSummary,
  stream: OraRunEventStream,
  snapshot: OraStateSnapshot | undefined,
): boolean {
  const streamSessionId = snapshot?.sessionId ?? stream.sessionId;
  if (session.latestRunId === stream.runId) {
    return true;
  }
  return Boolean(
    streamSessionId &&
      session.sessionId === streamSessionId &&
      session.latestRunId === undefined,
  );
}

function syncSessionStateForStream(
  state: WorkbenchState,
  stream: OraRunEventStream,
  snapshot: OraStateSnapshot | undefined,
) {
  const status = inferredStreamSessionStatus(stream, snapshot);
  const updatedAt = streamUpdatedAt(stream, snapshot);
  const activeDetailHasRun =
    state.activeSessionDetail?.turns.some(
      (turn) => turn.runId === stream.runId,
    ) ?? false;
  let sessionsChanged = false;
  const updateSession = (session: OraSessionSummary): OraSessionSummary => {
    if (!sessionSummaryMatchesStream(session, stream, snapshot)) {
      return session;
    }
    const nextSession = {
      ...session,
      status: status ?? session.status,
      attention: snapshot?.attention ?? session.attention,
      latestRunId: snapshot?.runId ?? session.latestRunId ?? stream.runId,
      latestPattern: snapshot?.pattern ?? session.latestPattern,
      latestModeId: snapshot?.modeId ?? session.latestModeId,
      latestProviderId: snapshot?.config.providerId ?? session.latestProviderId,
      latestModelRef: snapshot?.config.modelRef ?? session.latestModelRef,
      updatedAt: updatedAt ?? session.updatedAt,
    };
    if (nextSession !== session) {
      sessionsChanged = true;
    }
    return nextSession;
  };

  const mappedSessions = state.sessions.map(updateSession);
  const sessions = sessionsChanged ? mappedSessions : state.sessions;
  if (!state.activeSessionDetail || !activeDetailHasRun) {
    return { sessions, activeSessionDetail: state.activeSessionDetail };
  }

  let turnsChanged = false;
  const turns = state.activeSessionDetail.turns.map((turn) => {
    if (turn.runId !== stream.runId) {
      return turn;
    }
    turnsChanged = true;
    return {
      ...turn,
      status: status ?? turn.status,
      eventCount: snapshot?.events.length ?? turn.eventCount,
      checkpointCount: snapshot?.checkpoints.length ?? turn.checkpointCount,
      artifactCount: snapshot?.artifacts.length ?? turn.artifactCount,
      updatedAt: updatedAt ?? turn.updatedAt,
      trace: snapshot?.trace ?? turn.trace,
    };
  });
  const nextActiveSession = updateSession(state.activeSessionDetail.session);
  const latestSnapshot = snapshot ?? state.activeSessionDetail.latestSnapshot;
  const activeSessionDetail =
    turnsChanged ||
    nextActiveSession !== state.activeSessionDetail.session ||
    latestSnapshot !== state.activeSessionDetail.latestSnapshot
      ? {
          ...state.activeSessionDetail,
          session: nextActiveSession,
          turns,
          latestSnapshot,
        }
      : state.activeSessionDetail;

  return {
    sessions,
    activeSessionDetail,
  };
}

function applyStreamToSessionDetail(
  detail: OraSessionDetail,
  stream: OraRunEventStream,
  snapshot: OraStateSnapshot | undefined,
): OraSessionDetail {
  const status = streamRunStatus(stream, snapshot);
  const updatedAt = streamUpdatedAt(stream, snapshot);

  const turns = detail.turns.map((turn) => {
    if (turn.runId !== stream.runId) return turn;
    return {
      ...turn,
      status: status ?? turn.status,
      eventCount: snapshot?.events.length ?? turn.eventCount,
      checkpointCount: snapshot?.checkpoints.length ?? turn.checkpointCount,
      artifactCount: snapshot?.artifacts.length ?? turn.artifactCount,
      updatedAt: updatedAt ?? turn.updatedAt,
      trace: snapshot?.trace ?? turn.trace,
    };
  });

  const existing = turns.some((t) => t.runId === stream.runId);
  if (!existing && snapshot) {
    turns.push({
      runId: stream.runId,
      sessionId: snapshot.sessionId ?? detail.session.sessionId,
      turnIndex: snapshot.turnIndex ?? turns.length + 1,
      status: status ?? snapshot.status,
      attention: snapshot.attention,
      pattern: snapshot.pattern,
      modeId: snapshot.modeId,
      providerId: snapshot.config.providerId,
      modelRef: snapshot.config.modelRef,
      prompt: snapshot.input.prompt,
      startedAt: snapshot.input.createdAt ?? snapshot.updatedAt,
      updatedAt: updatedAt ?? snapshot.updatedAt,
      eventCount: snapshot.events.length,
      checkpointCount: snapshot.checkpoints.length,
      artifactCount: snapshot.artifacts.length,
      trace: snapshot.trace,
    });
  }

  return {
    ...detail,
    session: {
      ...detail.session,
      status: status ?? detail.session.status,
      attention: snapshot?.attention ?? detail.session.attention,
      latestRunId: stream.runId,
      updatedAt: updatedAt ?? detail.session.updatedAt,
    },
    turns,
    latestSnapshot: snapshot ?? detail.latestSnapshot,
  };
}

function applyBranchStreamToSessionDetail(
  detail: OraSessionDetail | undefined,
  stream: OraRunEventStream,
  snapshot: OraStateSnapshot | undefined,
): OraSessionDetail | undefined {
  const branchGroupId =
    typeof snapshot?.config.metadata.branchGroupId === "string"
      ? snapshot.config.metadata.branchGroupId
      : undefined;
  if (
    !detail ||
    !branchGroupId ||
    !detail.branchGroups?.some((group) => group.branchGroupId === branchGroupId)
  ) {
    return detail;
  }
  const status = streamRunStatus(stream, snapshot) ?? snapshot?.status;
  const updatedAt = streamUpdatedAt(stream, snapshot) ?? snapshot?.updatedAt;
  const branchGroups = detail.branchGroups.map((group) => {
    if (group.branchGroupId !== branchGroupId) return group;
    const candidates = group.candidates.map((candidate) => {
      if (candidate.runId !== stream.runId) return candidate;
      return {
        ...candidate,
        status: status ?? candidate.status,
        modeId: snapshot?.modeId ?? candidate.modeId,
        providerId: snapshot?.config.providerId ?? candidate.providerId,
        modelRef: snapshot?.config.modelRef ?? candidate.modelRef,
        outputPreview: branchOutputPreview(snapshot) ?? candidate.outputPreview,
        updatedAt: updatedAt ?? candidate.updatedAt,
      };
    });
    return {
      ...group,
      candidates,
      status: branchGroupStatus(group, candidates),
      updatedAt: Math.max(group.updatedAt, updatedAt ?? group.updatedAt),
    };
  });
  return {
    ...detail,
    branchGroups,
  };
}

function branchGroupStatus(
  group: OraSessionBranchGroup,
  candidates: OraSessionBranchGroup["candidates"],
): OraSessionBranchGroup["status"] {
  return deriveSessionBranchGroupStatus({ ...group, candidates });
}

function branchOutputPreview(
  snapshot: OraStateSnapshot | undefined,
): string | undefined {
  if (!snapshot) return undefined;
  if (typeof snapshot.output === "string") return snapshot.output.slice(0, 500);
  if (
    snapshot.output &&
    typeof snapshot.output === "object" &&
    typeof (snapshot.output as { text?: unknown }).text === "string"
  ) {
    return (snapshot.output as { text: string }).text.slice(0, 500);
  }
  return undefined;
}

function streamMatchesPendingRun(
  pendingRun: PendingRunState | undefined,
  stream: OraRunEventStream,
  activeSnapshot: OraStateSnapshot | undefined,
): boolean {
  if (!pendingRun) {
    return false;
  }
  if (pendingRun.runId && pendingRun.runId === stream.runId) {
    return true;
  }

  const snapshot =
    stream.snapshot ??
    (activeSnapshot?.runId === stream.runId ? activeSnapshot : undefined);
  if (!snapshot && !pendingRun.runId) {
    return stream.sessionId === pendingRun.sessionId && stream.prompt === pendingRun.prompt;
  }
  return (
    snapshot?.sessionId === pendingRun.sessionId &&
    snapshot.input.prompt === pendingRun.prompt
  );
}

function createPendingRunSnapshot(
  pendingRun: PendingRunState | undefined,
  stream: OraRunEventStream,
  turnIndex = 1,
): OraStateSnapshot | undefined {
  if (
    !pendingRun ||
    (pendingRun.runId && pendingRun.runId !== stream.runId) ||
    !stream.sessionId ||
    stream.sessionId !== pendingRun.sessionId ||
    stream.prompt !== pendingRun.prompt
  ) {
    return undefined;
  }
  const pattern = stream.snapshot?.pattern ?? "orchestrator_subagent";
  const createdAt = stream.events[0]?.createdAt ?? pendingRun.createdAt;
  return {
    runId: stream.runId,
    sessionId: pendingRun.sessionId,
    turnIndex,
    status: stream.status ?? "running",
    pattern,
    input: { prompt: pendingRun.prompt, createdAt, context: {} },
    config: {
      pattern,
      modeId: "",
      modeSelection: "manual",
      profileIds: [],
      providerId: "",
      modelRef: "",
      approvalMode: "high_risk_only",
      permissionMode: "default",
      patternOptions: {},
      metadata: {},
      deterministicSeed: `${stream.runId}:pending-stream`,
      skillIds: [],
      toolIds: [],
    },
    topology: { nodes: [], edges: [] },
    profiles: [],
    memory: [],
    plan: [],
    planList: [],
    todos: [],
    actions: [],
    toolCalls: [],
    continuation: { frames: [] },
    conversation: [],
    toolResults: [],
    policyDecisions: [],
    checkpoints: [],
    events: [],
    agentMessages: [],
    artifacts: [],
    activeAgents: [],
    queueSummary: { mode: "backlog", pending: 0, inProgress: 1, completed: 0, topics: [] },
    sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
    busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
    pendingClarifications: [],
    pendingApprovals: [],
    planDecisions: [],
    updatedAt: createdAt,
  } as OraStateSnapshot;
}

function pendingRunTurnIndex(
  detail: OraSessionDetail | undefined,
  pendingRun: PendingRunState | undefined,
): number {
  if (!detail || !pendingRun || detail.session.sessionId !== pendingRun.sessionId) {
    return 1;
  }
  const latestTurnIndex = detail.turns.reduce(
    (max, turn) => Math.max(max, turn.turnIndex),
    0,
  );
  return latestTurnIndex + 1;
}

function shouldClearPendingRunForStream(
  matchesPendingRun: boolean,
  pendingRun: PendingRunState | undefined,
  streamSnapshot: OraStateSnapshot | undefined,
  streamBelongsToActiveTurn: boolean,
): boolean {
  return matchesPendingRun && Boolean(pendingRun?.runId) && Boolean(streamSnapshot) && streamBelongsToActiveTurn;
}

function markSnapshotResuming(
  snapshot: OraStateSnapshot | undefined,
  runId: string,
  approvedActionIds: string[],
  updatedAt: number,
): OraStateSnapshot | undefined {
  if (!snapshot || snapshot.runId !== runId) {
    return snapshot;
  }

  const approved = new Set(approvedActionIds);
  return normalizeDesktopSnapshot({
    ...snapshot,
    status: "running",
    actions: snapshot.actions.map((action) => {
      if (action.status !== "approval_required") {
        return action;
      }
      if (approved.size > 0 && !approved.has(action.id)) {
        return action;
      }
      return { ...action, status: "approved" };
    }),
    pendingApprovals: snapshot.pendingApprovals.filter(
      (actionId) => !approved.has(actionId),
    ),
    updatedAt,
  });
}

function markSnapshotCancelRequested(
  snapshot: OraStateSnapshot | undefined,
  runId: string,
  reason: string,
  updatedAt: number,
): OraStateSnapshot | undefined {
  if (!snapshot || snapshot.runId !== runId || isSettledRunStatus(snapshot.status)) {
    return snapshot;
  }

  const seq = snapshot.events.length;
  return normalizeDesktopSnapshot({
    ...snapshot,
    status: "cancelled",
    attention: {
      kind: "cancelled",
      blocking: false,
      sourceRunId: runId,
      reason,
      pendingActionIds: [],
      pendingToolCallIds: [],
      pendingClarificationIds: [],
    },
    queueSummary: {
      ...snapshot.queueSummary,
      inProgress: 0,
    },
    events: [
      ...snapshot.events,
      {
        id: `${runId}:desktop-cancel-requested:${seq}`,
        runId,
        seq,
        type: "run.cancelled",
        createdAt: updatedAt,
        pattern: snapshot.pattern,
        payload: { reason },
      } as OraStateSnapshot["events"][number],
    ],
    updatedAt,
  });
}

function applyCancelRequestedToSessionDetail(
  detail: OraSessionDetail | undefined,
  snapshot: OraStateSnapshot | undefined,
  runId: string,
  updatedAt: number,
): OraSessionDetail | undefined {
  if (!detail || !detail.turns.some((turn) => turn.runId === runId)) {
    return detail;
  }
  return {
    ...detail,
    session: {
      ...detail.session,
      status: "cancelled",
      attention: snapshot?.attention ?? detail.session.attention,
      updatedAt: Math.max(detail.session.updatedAt, updatedAt),
    },
    turns: detail.turns.map((turn) =>
      turn.runId === runId
        ? { ...turn, status: "cancelled", updatedAt: Math.max(turn.updatedAt, updatedAt) }
        : turn
    ),
    latestSnapshot:
      snapshot && (detail.latestSnapshot?.runId === runId || detail.session.latestRunId === runId)
        ? snapshot
        : detail.latestSnapshot,
  };
}

function shouldPreserveAcceptedPlanPendingRun(
  pendingResolution: WorkbenchState["pendingPlanDecisionResolution"],
  pendingRun: PendingRunState | undefined,
  sessionId: string,
): boolean {
  return Boolean(
    pendingResolution?.status === "accepted" &&
      pendingResolution.sessionId === sessionId &&
      pendingResolution.implementationPrompt &&
      pendingRun?.sessionId === sessionId &&
      pendingRun.prompt === pendingResolution.implementationPrompt,
  );
}

function pendingRunMatchesSnapshot(
  pendingRun: PendingRunState | undefined,
  snapshot: OraStateSnapshot | undefined,
): boolean {
  if (!pendingRun || !snapshot) {
    return false;
  }
  if (snapshot.sessionId !== pendingRun.sessionId) {
    return false;
  }
  if (pendingRun.runId && snapshot.runId !== pendingRun.runId) {
    return false;
  }
  return snapshot.input.prompt === pendingRun.prompt;
}

function pendingRunHasTranscriptUser(
  pendingRun: PendingRunState | undefined,
  detail: OraSessionDetail,
): boolean {
  if (!pendingRun || detail.session.sessionId !== pendingRun.sessionId) {
    return false;
  }
  return detail.transcript.some((message) =>
    message.role === "user" &&
    message.sessionId === pendingRun.sessionId &&
    (!pendingRun.runId || message.runId === pendingRun.runId) &&
    message.content === pendingRun.prompt
  );
}

function shouldPreserveHydratingPendingRun(params: {
  pendingRun: PendingRunState | undefined;
  detail: OraSessionDetail;
  snapshot: OraStateSnapshot | undefined;
}): boolean {
  const { pendingRun, detail, snapshot } = params;
  if (!pendingRun || pendingRun.sessionId !== detail.session.sessionId) {
    return false;
  }
  if (snapshot && isSettledRunStatus(snapshot.status)) {
    return false;
  }
  if (pendingRunMatchesSnapshot(pendingRun, snapshot)) {
    return false;
  }
  if (pendingRunHasTranscriptUser(pendingRun, detail)) {
    return false;
  }
  return true;
}

function preserveComposerMode(
  state: WorkbenchState,
  candidateModeId?: string,
): string {
  return state.selectedModeId || candidateModeId || "";
}

export function workbenchReducer(
  state: WorkbenchState,
  action: WorkbenchAction,
): WorkbenchState {
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
        sessionDetailsById: {},
        modes: [],
        promptText: "",
        sessionPromptTexts: {},
        selectedSkillIds: [],
        sessionSkillIds: {},
        taskIntent: "chat",
        sessionTaskIntents: {},
        sessionProjectFileAttachments: {},
        sessionLocalFileAttachments: {},
        runLifecycle: { stage: "idle" },
        liveMessageDeltaBuffer: {},
        pendingPlanDecisionResolution: undefined,
        isLoading: true,
        busyCommand: undefined,
        commandFeedback: "Reconnecting to the Ora runtime bridge.",
      };

    case "BOOTSTRAP": {
      const selectedMode = resolveSelectedMode(
        action.modes,
        state.selectedModeId,
      );
      return {
        ...state,
        patterns: action.patterns,
        modes: action.modes,
        projects: action.projects,
        providerRegistry: action.providerRegistry,
        toolRegistry: action.toolRegistry,
        packageStore: action.packageStore,
        skillRegistry: action.skillRegistry,
        providerSecretStatuses: action.providerSecretStatuses,
        providerStatuses: action.providerStatuses,
        selectedProviderId: chooseBootstrapProviderId(action.providerRegistry),
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
      timeStart("HYDRATE_SESSION reducer");
      const snapshot = selectedSnapshotFromDetail(
        action.detail,
        action.snapshot,
        state.selectedTurnRunId,
      );
      const normalizedSnapshot = snapshot ? normalizeDesktopSnapshot(snapshot) : undefined;
      const currentActiveSnapshot = getActiveSnapshot(state.runLifecycle);
      const effectiveSnapshot = normalizedSnapshot ?? (
        currentActiveSnapshot &&
        currentActiveSnapshot.sessionId === action.detail.session.sessionId &&
        !isSettledRunStatus(currentActiveSnapshot.status)
          ? currentActiveSnapshot
          : undefined
      );
      const latestTurn = action.detail.turns.at(-1);
      const attention = effectiveSnapshot?.attention ?? action.detail.session.attention;
      const status = effectiveSnapshot?.status ?? action.detail.session.status;
      const normalizedDetail = {
        ...action.detail,
        session: {
          ...action.detail.session,
          status,
          attention,
        },
        latestSnapshot: effectiveSnapshot ?? action.detail.latestSnapshot,
      };
      const sessions = reconcileSessionSummariesWithLocalAuthority(
        state,
        replaceSessionSummary(
          action.sessions.filter(
            (session) => session.sessionId !== action.detail.session.sessionId,
          ),
          normalizedDetail.session,
        ),
      );
      if (
        action.preserveSelection &&
        state.selectedSessionId &&
        action.detail.session.sessionId !== state.selectedSessionId
      ) {
        return {
          ...state,
          projects: action.projects,
          sessions,
          sessionDetailsById: cacheSessionDetail(
            state.sessionDetailsById,
            normalizedDetail,
          ),
        };
      }
      const currentPendingRun = getPendingRunState(state.runLifecycle);
      const preservePendingRun = shouldPreserveAcceptedPlanPendingRun(
        state.pendingPlanDecisionResolution,
        currentPendingRun,
        action.detail.session.sessionId,
      ) || shouldPreserveHydratingPendingRun({
        pendingRun: currentPendingRun,
        detail: normalizedDetail,
        snapshot: effectiveSnapshot,
      });
      const pendingRun = preservePendingRun ? currentPendingRun : undefined;
      const nextState = {
        ...state,
        projects: action.projects,
        sessions,
        selectedProjectId: action.detail.session.projectId,
        expandedProjectIds: action.detail.session.projectId
          ? {
              ...state.expandedProjectIds,
              [action.detail.session.projectId]: true,
            }
          : state.expandedProjectIds,
        activeSessionDetail: normalizedDetail,
        sessionDetailsById: cacheSessionDetail(
          state.sessionDetailsById,
          normalizedDetail,
        ),
        selectedSessionId: action.detail.session.sessionId,
        selectedTurnRunId: effectiveSnapshot?.runId ?? latestTurn?.runId,
        selectedPattern:
          effectiveSnapshot?.pattern ??
          latestTurn?.pattern ??
          state.selectedPattern,
        selectedModeId: preserveComposerMode(
          state,
          effectiveSnapshot?.modeId ?? latestTurn?.modeId,
        ),
        selectedModeSelection:
          effectiveSnapshot?.config.modeSelection ?? state.selectedModeSelection,
        selectedProviderId:
          effectiveSnapshot?.config.providerId ??
          latestTurn?.providerId ??
          state.selectedProviderId,
        selectedNodeId:
          effectiveSnapshot?.topology.nodes[1]?.id ??
          effectiveSnapshot?.topology.nodes[0]?.id ??
          "run",
        selectedBeatId: effectiveSnapshot?.events.at(-1)?.id,
        promptText: sessionPromptText(state, action.detail.session.sessionId),
        selectedSkillIds: sessionSkillIds(
          state,
          action.detail.session.sessionId,
        ),
        permissionMode: sessionPermissionMode(
          state,
          action.detail.session.sessionId,
        ),
        taskIntent: sessionTaskIntent(state, action.detail.session.sessionId),
        commandFeedback: action.feedback ?? state.commandFeedback,
        runLifecycle: preservePendingRun
          ? runLifecycleFromPendingRun(pendingRun)
          : runLifecycleFromSnapshot(effectiveSnapshot, {
              previous: state.runLifecycle,
              fallbackSessionId: action.detail.session.sessionId,
            }),
        pendingPlanDecisionResolution: undefined,
        isLoading: preservePendingRun ? true : false,
        busyCommand: undefined,
      };
      timeEnd("HYDRATE_SESSION reducer");
      return nextState;
    }

    case "SET_COLLECTIONS":
      return {
        ...state,
        projects: action.projects,
        sessions: reconcileSessionSummariesWithLocalAuthority(
          state,
          action.sessions,
        ),
        commandFeedback: action.feedback ?? state.commandFeedback,
        busyCommand: undefined,
      };

    case "ARCHIVE_SESSION_OPTIMISTIC": {
      const archivedSession = state.sessions.find(
        (session) => session.sessionId === action.sessionId,
      );
      return {
        ...state,
        sessions: state.sessions.filter(
          (session) => session.sessionId !== action.sessionId,
        ),
        sessionPromptTexts: clearSessionPromptText(state, action.sessionId),
        sessionSkillIds: clearSessionSkillIds(state, action.sessionId),
        sessionProjectFileAttachments: clearProjectFileAttachments(
          state,
          action.sessionId,
        ),
        sessionLocalFileAttachments: clearLocalFileAttachments(
          state,
          action.sessionId,
        ),
        sessionPermissionModes: clearSessionPermissionMode(
          state,
          action.sessionId,
        ),
        sessionTaskIntents: clearSessionTaskIntent(state, action.sessionId),
        promptText:
          state.selectedSessionId === action.sessionId ? "" : state.promptText,
        selectedSkillIds:
          state.selectedSessionId === action.sessionId
            ? []
            : state.selectedSkillIds,
        permissionMode:
          state.selectedSessionId === action.sessionId
            ? ("default" as PermissionMode)
            : state.permissionMode,
        taskIntent:
          state.selectedSessionId === action.sessionId
            ? ("implement" as TaskIntent)
            : state.taskIntent,
        projects: archivedSession?.projectId
          ? state.projects.map((project) =>
              project.projectId === archivedSession.projectId
                ? {
                    ...project,
                    sessionCount: Math.max(0, project.sessionCount - 1),
                  }
                : project,
            )
          : state.projects,
        busyCommand: "Archive chat",
      };
    }

    case "CACHE_SESSION_DETAIL":
      return {
        ...state,
        sessionDetailsById: cacheSessionDetail(
          state.sessionDetailsById,
          compactSessionDetailForCache(action.detail),
        ),
      };

    case "SET_PROJECTS":
      return { ...state, projects: action.projects };

    case "SET_MODES": {
      const selectedMode = resolveSelectedMode(
        action.modes,
        state.selectedModeId,
      );
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
          [action.projectId]: !(
            state.expandedProjectIds[action.projectId] ?? true
          ),
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
        commandFeedback:
          action.selection === "auto"
            ? "Auto mode selected for the next turn."
            : "Manual mode selection restored for the next turn.",
      };

    case "SET_PERMISSION_MODE":
      return {
        ...state,
        permissionMode: action.permissionMode,
        sessionPermissionModes: setSessionPermissionMode(
          state,
          action.permissionMode,
        ),
      };

    case "SET_TASK_INTENT":
      return {
        ...state,
        taskIntent: action.taskIntent,
        sessionTaskIntents: setSessionTaskIntent(state, action.taskIntent),
      };

    case "SET_PROVIDER": {
      const provider = state.providerRegistry?.providers.find(
        (entry) => entry.id === action.providerId,
      );
      const selectedProviderId = chooseEnabledProviderId(
        state.providerRegistry,
        {
          preferredProviderId: action.providerId,
          currentProviderId: state.selectedProviderId,
        },
      );
      return {
        ...state,
        selectedProviderId,
        commandFeedback:
          provider && provider.enabled !== false
            ? `${provider.label} selected for the next turn.`
            : `Provider ${action.providerId} is not enabled for chat.`,
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
      const selectedProviderId = chooseEnabledProviderId(
        action.providerRegistry,
        {
          currentProviderId: state.selectedProviderId,
        },
      );
      return {
        ...state,
        providerRegistry: action.providerRegistry,
        selectedProviderId,
      };
    }

    case "SET_PACKAGE_STORE":
      return {
        ...state,
        packageStore: action.packageStore,
      };

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
      const providerRegistry = {
        providers: nextProviders,
        defaultProviderId:
          state.providerRegistry?.defaultProviderId ?? action.provider.id,
      };
      return {
        ...state,
        providerRegistry,
        selectedProviderId: chooseEnabledProviderId(providerRegistry, {
          preferredProviderId:
            action.provider.enabled !== false ? action.provider.id : undefined,
          currentProviderId: state.selectedProviderId,
        }),
        commandFeedback: `${action.provider.label} saved for future turns.`,
      };
    }

    case "DELETE_PROVIDER": {
      const providers =
        state.providerRegistry?.providers.filter(
          (provider) => provider.id !== action.providerId,
        ) ?? [];
      const defaultProviderId =
        state.providerRegistry?.defaultProviderId ?? "";
      const providerRegistry = state.providerRegistry
        ? { providers, defaultProviderId }
        : state.providerRegistry;
      return {
        ...state,
        providerRegistry,
        selectedProviderId: chooseEnabledProviderId(providerRegistry, {
          currentProviderId: state.selectedProviderId,
          previousProviderId: action.providerId,
        }),
        providerSecretStatuses: state.providerSecretStatuses.filter(
          (status) => status.providerId !== action.providerId,
        ),
        providerStatuses: state.providerStatuses.filter(
          (status) => status.providerId !== action.providerId,
        ),
        commandFeedback: `Removed provider ${action.providerId}.`,
      };
    }

    case "SET_PROVIDER_SECRET_STATUS":
      return {
        ...state,
        providerSecretStatuses: [
          action.status,
          ...state.providerSecretStatuses.filter(
            (status) => status.providerId !== action.status.providerId,
          ),
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
          ...state.providerStatuses.filter(
            (status) => status.providerId !== action.status.providerId,
          ),
        ],
        commandFeedback: action.status.detail,
      };

    case "SET_PROVIDER_STATUSES":
      return { ...state, providerStatuses: action.statuses };

    case "SELECT_SESSION": {
      const cachedDetail = state.sessionDetailsById[action.sessionId];
      const sessionSummary = state.sessions.find(
        (item) => item.sessionId === action.sessionId,
      );
      const session = cachedDetail?.session ?? sessionSummary;
      const detail =
        cachedDetail &&
        sessionSummary &&
        sessionSummary.updatedAt > cachedDetail.session.updatedAt
          ? {
              ...cachedDetail,
              session: { ...cachedDetail.session, ...sessionSummary },
            }
          : (cachedDetail ??
            (session ? emptySessionDetail(session) : undefined));
      const snapshot = detail
        ? selectedSnapshotFromDetail(detail, undefined, undefined)
        : undefined;
      const latestTurn = detail?.turns.at(-1);
      const currentPendingRun = getPendingRunState(state.runLifecycle);
      const pendingRun =
        currentPendingRun?.sessionId === action.sessionId
          ? currentPendingRun
          : undefined;
      return {
        ...state,
        activeView: "chat",
        selectedSessionId: action.sessionId,
        selectedTurnRunId: snapshot?.runId ?? latestTurn?.runId,
        selectedBeatId: undefined,
        selectedNodeId:
          snapshot?.topology.nodes[1]?.id ??
          snapshot?.topology.nodes[0]?.id ??
          "run",
        selectedProjectId: detail?.session.projectId,
        activeSessionDetail: detail,
        selectedPattern:
          snapshot?.pattern ?? session?.latestPattern ?? state.selectedPattern,
        selectedModeId: preserveComposerMode(
          state,
          snapshot?.modeId ?? session?.latestModeId,
        ),
        selectedModeSelection:
          snapshot?.config.modeSelection ?? state.selectedModeSelection,
        selectedProviderId:
          snapshot?.config.providerId ??
          session?.latestProviderId ??
          state.selectedProviderId,
        promptText: sessionPromptText(state, action.sessionId),
        selectedSkillIds: sessionSkillIds(state, action.sessionId),
        permissionMode: sessionPermissionMode(state, action.sessionId),
        taskIntent: sessionTaskIntent(state, action.sessionId),
        selectedArtifactId: undefined,
        detailDrawer: undefined,
        artifactPanelOpen: false,
        runLifecycle: snapshot
          ? runLifecycleFromSnapshot(snapshot, {
              previous: state.runLifecycle,
              pendingRun,
              fallbackSessionId: action.sessionId,
            })
          : runLifecycleFromPendingRun(pendingRun),
        pendingPlanDecisionResolution: undefined,
      };
    }

    case "SELECT_TURN": {
      const currentPendingRun = getPendingRunState(state.runLifecycle);
      const currentActiveSnapshot = getActiveSnapshot(state.runLifecycle);
      const pendingRunLatency = currentPendingRun?.runId === action.runId
        ? currentPendingRun.latency
        : undefined;
      const snapshot = mergeStateSnapshot(
        undefined,
        action.snapshot && pendingRunLatency
          ? {
              ...action.snapshot,
              latency: mergeLatencyDiagnostics(pendingRunLatency, action.snapshot.latency),
            }
          : action.snapshot,
      );
      return {
        ...state,
        selectedTurnRunId: action.runId,
        runLifecycle: snapshot
          ? runLifecycleFromSnapshot(snapshot, {
              previous: state.runLifecycle,
              pendingRun: undefined,
              fallbackSessionId: state.selectedSessionId,
            })
          : state.runLifecycle,
        selectedPattern: snapshot?.pattern ?? state.selectedPattern,
        selectedModeId: preserveComposerMode(state, snapshot?.modeId),
        selectedModeSelection:
          snapshot?.config.modeSelection ?? state.selectedModeSelection,
        selectedNodeId:
          snapshot?.topology.nodes[1]?.id ??
          snapshot?.topology.nodes[0]?.id ??
          state.selectedNodeId,
        selectedBeatId: snapshot?.events.at(-1)?.id ?? state.selectedBeatId,
        pendingPlanDecisionResolution: snapshot
          ? undefined
          : state.pendingPlanDecisionResolution,
      };
    }

    case "REQUEST_RUN_CANCEL": {
      const currentActiveSnapshot = getActiveSnapshot(state.runLifecycle);
      const currentPendingRun = getPendingRunState(state.runLifecycle);
      const activeSnapshot = markSnapshotCancelRequested(
        currentActiveSnapshot,
        action.runId,
        action.reason,
        action.updatedAt,
      );
      const activeSessionDetail = applyCancelRequestedToSessionDetail(
        state.activeSessionDetail,
        activeSnapshot,
        action.runId,
        action.updatedAt,
      );
      return {
        ...state,
        sessions: state.sessions.map((session) =>
          session.latestRunId === action.runId
            ? {
                ...session,
                status: "cancelled",
                attention: activeSnapshot?.attention ?? session.attention,
                updatedAt: Math.max(session.updatedAt, action.updatedAt),
              }
            : session
        ),
        activeSessionDetail,
        sessionDetailsById: activeSessionDetail
          ? cacheSessionDetail(state.sessionDetailsById, activeSessionDetail)
          : state.sessionDetailsById,
        runLifecycle: runLifecycleFromSnapshot(activeSnapshot, {
          previous: state.runLifecycle,
          pendingRun:
            currentPendingRun &&
            ((activeSnapshot?.sessionId && currentPendingRun.sessionId === activeSnapshot.sessionId) ||
              (!activeSnapshot?.sessionId && currentPendingRun.sessionId === state.selectedSessionId))
              ? undefined
              : currentPendingRun,
          fallbackSessionId: state.selectedSessionId,
        }),
        isLoading: false,
        busyCommand: undefined,
        commandFeedback: "Stop requested.",
      };
    }

    case "APPLY_RUN_STREAM": {
      const currentActiveSnapshot = getActiveSnapshot(state.runLifecycle);
      const currentPendingRun = getPendingRunState(state.runLifecycle);
      const streamSessionId = action.stream.snapshot?.sessionId ?? action.stream.sessionId;
      const activeSessionId =
        state.activeSessionDetail?.session.sessionId ??
        state.selectedSessionId ??
        currentActiveSnapshot?.sessionId;
      const streamMatchesActiveSession =
        !streamSessionId ||
        !activeSessionId ||
        streamSessionId === activeSessionId;
      const streamReferencesActiveRun =
        currentActiveSnapshot?.runId === action.stream.runId ||
        state.selectedTurnRunId === action.stream.runId ||
        (state.activeSessionDetail?.turns.some(
          (turn) => turn.runId === action.stream.runId,
        ) ??
          false);
      const matchesPendingRunBeforeSnapshot = streamMatchesPendingRun(
        currentPendingRun,
        action.stream,
        action.stream.snapshot,
      );
      const streamBelongsToActiveTurn =
        streamMatchesActiveSession &&
        (streamReferencesActiveRun || matchesPendingRunBeforeSnapshot);
      const canUseOverlay =
        streamBelongsToActiveTurn &&
        streamCanUseLiveDeltaOverlay(
          action.stream,
          currentActiveSnapshot,
          action.stream.snapshot,
        );
      if (isLiveDeltaOnlyStream(action.stream) && !canUseOverlay) {
        recordTiming("stream-full-merge-fallback", 0);
      }
      if (canUseOverlay) {
        const liveMessageDeltaBuffer = applyStreamToLiveMessageDeltaBuffer(
          state.liveMessageDeltaBuffer,
          action.stream,
        );
        const selectedTurnRunId = state.selectedTurnRunId ?? action.stream.runId;
        const isLoading = true;
        if (
          liveMessageDeltaBuffer === state.liveMessageDeltaBuffer &&
          selectedTurnRunId === state.selectedTurnRunId &&
          state.isLoading === isLoading
        ) {
          return state;
        }
        return {
          ...state,
          selectedTurnRunId,
          liveMessageDeltaBuffer,
          isLoading,
        };
      }
      // Passive-only stream early exit: skip full merge for node.updated/context.usage.updated
      // events that don't change any visible projection.
      const isPassiveOnlyStream =
        streamBelongsToActiveTurn &&
        !action.stream.snapshot &&
        action.stream.events.length > 0 &&
        action.stream.events.every(e =>
          e.type === "node.updated" || e.type === "context.usage.updated");
      if (isPassiveOnlyStream) {
        if (currentActiveSnapshot && isSettledRunStatus(currentActiveSnapshot.status)) {
          return state;
        }
        const selectedBeatId = action.stream.events.at(-1)?.id ?? state.selectedBeatId;
        if (selectedBeatId === state.selectedBeatId && state.isLoading) {
          return state;
        }
        return { ...state, selectedBeatId, isLoading: true };
      }
      if (!streamMatchesActiveSession) {
        const streamStatus = streamRunStatus(action.stream, action.stream.snapshot);
        if (!isSettledRunStatus(streamStatus) && !action.stream.snapshot) {
          const liveMessageDeltaBuffer = applyStreamToLiveMessageDeltaBuffer(
            state.liveMessageDeltaBuffer,
            action.stream,
          );
          const synced = syncSessionStateForStream(state, action.stream, undefined);
          if (
            liveMessageDeltaBuffer === state.liveMessageDeltaBuffer &&
            synced.sessions === state.sessions &&
            synced.activeSessionDetail === state.activeSessionDetail
          ) {
            return state;
          }
          return {
            ...state,
            sessions: synced.sessions,
            activeSessionDetail: synced.activeSessionDetail,
            liveMessageDeltaBuffer,
          };
        }
      }
      const activeSnapshot = streamBelongsToActiveTurn
        ? markDesktopLatencyForStream(
            mergeRunStreamSnapshot(
              currentActiveSnapshot ??
                createPendingRunSnapshot(
                  currentPendingRun,
                  action.stream,
                  pendingRunTurnIndex(state.activeSessionDetail, currentPendingRun),
                ),
              action.stream,
            ),
            action.stream,
            action.receivedAt,
            action.flushedAt,
          )
        : currentActiveSnapshot;
      const streamSnapshot = streamBelongsToActiveTurn
        ? activeSnapshot
        : action.stream.snapshot
          ? normalizeDesktopSnapshot(action.stream.snapshot)
          : undefined;
      const synced = syncSessionStateForStream(
        state,
        action.stream,
        streamSnapshot,
      );
      const sessions = synced.sessions;
      const activeSessionDetail = streamMatchesActiveSession
        ? applyBranchStreamToSessionDetail(
            synced.activeSessionDetail ?? state.activeSessionDetail,
            action.stream,
            streamSnapshot,
          )
        : synced.activeSessionDetail;
      const derivedStreamStatus = streamRunStatus(action.stream, streamSnapshot);
      const isSettled = isSettledRunStatus(derivedStreamStatus);
      const matchesPendingRun = streamMatchesPendingRun(
        currentPendingRun,
        action.stream,
        streamSnapshot,
      );
      const pendingRun = matchesPendingRun
        ? markPendingRunLatencyForStream(currentPendingRun, action.stream, action.receivedAt, action.flushedAt)
        : currentPendingRun;
      const shouldClearPendingRun = shouldClearPendingRunForStream(
        matchesPendingRun,
        pendingRun,
        streamSnapshot,
        streamBelongsToActiveTurn,
      );
      const nextPendingRun = shouldClearPendingRun ? undefined : pendingRun;
      const runLifecycle = streamBelongsToActiveTurn
        ? runLifecycleFromSnapshot(activeSnapshot, {
            previous: state.runLifecycle,
            pendingRun: nextPendingRun,
            fallbackSessionId: activeSessionId,
          })
        : state.runLifecycle;
      return {
        ...state,
        sessions,
        activeSessionDetail,
        preservedSettledSnapshot:
          streamBelongsToActiveTurn &&
          streamSnapshot &&
          // 仅当 stream 属于同一 session 且不同于被保留的 run 时才清除
          (!state.preservedSettledSessionId || streamSessionId === state.preservedSettledSessionId) &&
          streamSnapshot.runId !== state.preservedSettledSnapshot?.runId
            ? undefined
            : state.preservedSettledSnapshot,
        preservedSettledSessionId:
          streamBelongsToActiveTurn &&
          streamSnapshot &&
          (!state.preservedSettledSessionId || streamSessionId === state.preservedSettledSessionId) &&
          streamSnapshot.runId !== state.preservedSettledSnapshot?.runId
            ? undefined
            : state.preservedSettledSessionId,
        sessionDetailsById: (() => {
          let next = activeSessionDetail
            ? cacheSessionDetail(state.sessionDetailsById, activeSessionDetail)
            : state.sessionDetailsById;
          if (streamSessionId && streamSessionId !== activeSessionId) {
            const cachedDetail = state.sessionDetailsById[streamSessionId];
            if (cachedDetail) {
              const updatedDetail = applyBranchStreamToSessionDetail(
                applyStreamToSessionDetail(
                  cachedDetail,
                  action.stream,
                  streamSnapshot,
                ),
                action.stream,
                streamSnapshot,
              );
              if (updatedDetail) {
                next = cacheSessionDetail(next, updatedDetail);
              }
            }
          }
          return next;
        })(),
        selectedTurnRunId:
          matchesPendingRun
            ? action.stream.runId
            : state.selectedTurnRunId ??
          (streamBelongsToActiveTurn ? action.stream.runId : undefined),
        selectedBeatId: streamBelongsToActiveTurn
          ? (action.stream.events.at(-1)?.id ?? state.selectedBeatId)
          : state.selectedBeatId,
        runLifecycle,
        pendingPlanDecisionResolution: shouldClearPendingRun
          ? undefined
          : state.pendingPlanDecisionResolution,
        selectedModeSelection: streamBelongsToActiveTurn
          ? (activeSnapshot?.config.modeSelection ??
            state.selectedModeSelection)
          : state.selectedModeSelection,
        liveMessageDeltaBuffer: applyStreamToLiveMessageDeltaBuffer(
          state.liveMessageDeltaBuffer,
          action.stream,
        ),
        lastRunTaskIntent:
          isSettled &&
          matchesPendingRun
            ? state.taskIntent
            : state.lastRunTaskIntent,
        isLoading: streamBelongsToActiveTurn
          ? derivedStreamStatus === "running" ||
            derivedStreamStatus === "queued"
          : state.isLoading,
        commandFeedback:
          streamBelongsToActiveTurn && derivedStreamStatus === "succeeded"
            ? "Run completed."
            : streamBelongsToActiveTurn && derivedStreamStatus === "failed"
              ? "Run failed."
              : state.commandFeedback,
      };
    }

    case "BEGIN_RUN_RESUME": {
      const activeSnapshot = markSnapshotResuming(
        getActiveSnapshot(state.runLifecycle),
        action.runId,
        action.approvedActionIds,
        action.updatedAt,
      );
      return {
        ...state,
        runLifecycle: runLifecycleFromSnapshot(activeSnapshot, {
          previous: state.runLifecycle,
          fallbackSessionId: state.selectedSessionId,
        }),
        selectedTurnRunId: action.runId,
        isLoading: true,
        commandFeedback: "Approval submitted. Continuing run.",
      };
    }

    case "SELECT_TAB":
      return { ...state, selectedDockTab: action.tab };

    case "SELECT_BEAT":
      return { ...state, selectedBeatId: action.beatId };

    case "SELECT_NODE":
      return { ...state, selectedNodeId: action.nodeId };

    case "SET_PROMPT":
      return {
        ...state,
        promptText: action.text,
        sessionPromptTexts: setSessionPromptText(state, action.text),
      };

    case "SET_SELECTED_SKILL_IDS":
      return {
        ...state,
        selectedSkillIds: action.skillIds,
        sessionSkillIds: setSessionSkillIds(state, action.skillIds),
      };

    case "ADD_PROJECT_FILE_ATTACHMENT":
      return {
        ...state,
        sessionProjectFileAttachments: addProjectFileAttachment(
          state,
          action.sessionId,
          action.file,
        ),
        commandFeedback: `Added ${action.file.path} to chat.`,
      };

    case "REMOVE_PROJECT_FILE_ATTACHMENT":
      return {
        ...state,
        sessionProjectFileAttachments: removeProjectFileAttachment(
          state,
          action.sessionId,
          action.path,
        ),
      };

    case "CLEAR_PROJECT_FILE_ATTACHMENTS":
      return {
        ...state,
        sessionProjectFileAttachments: clearProjectFileAttachments(
          state,
          action.sessionId,
        ),
      };

    case "ADD_LOCAL_FILE_ATTACHMENT":
      return {
        ...state,
        sessionLocalFileAttachments: addLocalFileAttachment(
          state,
          action.sessionId,
          action.file,
        ),
        commandFeedback: `Added ${action.file.name} to chat.`,
      };

    case "REMOVE_LOCAL_FILE_ATTACHMENT":
      return {
        ...state,
        sessionLocalFileAttachments: removeLocalFileAttachment(
          state,
          action.sessionId,
          action.path,
        ),
      };

    case "CLEAR_LOCAL_FILE_ATTACHMENTS":
      return {
        ...state,
        sessionLocalFileAttachments: clearLocalFileAttachments(
          state,
          action.sessionId,
        ),
      };

    case "CLEAR_PROMPT_IF_MATCH":
      return state.promptText === action.text
        ? {
            ...state,
            promptText: "",
            sessionPromptTexts: state.selectedSessionId
              ? clearSessionPromptText(state, state.selectedSessionId)
              : state.sessionPromptTexts,
          }
        : state;

    case "BEGIN_RUN_REQUEST": {
      const currentSnapshot = getActiveSnapshot(state.runLifecycle);
      return {
        ...state,
        runLifecycle: {
          stage: "pending",
          sessionId: action.sessionId,
          prompt: action.prompt,
          createdAt: action.createdAt,
        },
        liveMessageDeltaBuffer: {},
        preservedSettledSnapshot: currentSnapshot && isSettledRunStatus(currentSnapshot.status)
          ? currentSnapshot
          : state.preservedSettledSnapshot,
        preservedSettledSessionId: currentSnapshot && isSettledRunStatus(currentSnapshot.status)
          ? currentSnapshot.sessionId ?? state.selectedSessionId
          : state.preservedSettledSessionId,
        pendingPlanDecisionResolution: undefined,
        selectedSkillIds: [],
        sessionSkillIds: clearSessionSkillIds(state, action.sessionId),
        lastRunTaskIntent: undefined,
        isLoading: true,
      };
    }

    case "ATTACH_PENDING_RUN_HANDLE": {
      const pendingRun = getPendingRunState(state.runLifecycle);
      if (
        !pendingRun ||
        pendingRun.sessionId !== action.sessionId ||
        pendingRun.prompt !== action.prompt
      ) {
        return state;
      }
      return {
        ...state,
        selectedTurnRunId: action.runId,
        preservedSettledSnapshot: undefined,
        preservedSettledSessionId: undefined,
        runLifecycle:
          state.runLifecycle.stage === "pending"
            ? { ...state.runLifecycle, runId: action.runId }
            : state.runLifecycle,
      };
    }

    case "BEGIN_PLAN_DECISION_RESOLUTION": {
      const pendingRun = action.status === "accepted" && action.implementationPrompt
        ? {
            sessionId: action.sessionId,
            prompt: action.implementationPrompt,
            createdAt: action.createdAt,
          }
        : getPendingRunState(state.runLifecycle);
      const runLifecycle = action.status === "accepted" && action.implementationPrompt
        ? {
            stage: "pending" as const,
            sessionId: action.sessionId,
            prompt: action.implementationPrompt,
            createdAt: action.createdAt,
          }
        : state.runLifecycle;
      return {
        ...state,
        runLifecycle,
        pendingPlanDecisionResolution: {
          sessionId: action.sessionId,
          decisionId: action.decisionId,
          status: action.status,
          createdAt: action.createdAt,
          implementationPrompt: action.implementationPrompt,
        },
        isLoading: action.status === "accepted" ? true : state.isLoading,
        busyCommand: action.status === "accepted" ? "Accept plan" : "Decline plan",
        commandFeedback: action.status === "accepted"
          ? "Plan accepted. Starting implementation."
          : "Plan decision submitted. Adjust the plan.",
      };
    }

    case "ROLLBACK_PLAN_DECISION_RESOLUTION": {
      const pendingResolution = state.pendingPlanDecisionResolution;
      const matches = pendingResolution?.sessionId === action.sessionId &&
        pendingResolution.decisionId === action.decisionId;
      if (!pendingResolution || !matches) {
        return {
          ...state,
          commandFeedback: action.feedback,
          busyCommand: undefined,
        };
      }
      const wasAccepted = pendingResolution.status === "accepted";
      return {
        ...state,
        runLifecycle: wasAccepted ? { stage: "idle" } : state.runLifecycle,
        liveMessageDeltaBuffer: wasAccepted ? {} : state.liveMessageDeltaBuffer,
        pendingPlanDecisionResolution: undefined,
        isLoading: wasAccepted ? false : state.isLoading,
        busyCommand: undefined,
        commandFeedback: action.feedback,
      };
    }

    case "SET_PENDING_RUN_PROGRESS":
      const pendingRun = getPendingRunState(state.runLifecycle);
      if (
        !pendingRun ||
        pendingRun.sessionId !== action.sessionId
      ) {
        return state;
      }
      return {
        ...state,
        runLifecycle:
          state.runLifecycle.stage === "pending"
            ? { ...state.runLifecycle, progressText: action.progressText }
            : state.runLifecycle,
      };

    case "SET_LOADING":
      return {
        ...state,
        isLoading: action.loading,
        runLifecycle: action.loading ? state.runLifecycle : { stage: "idle" },
        liveMessageDeltaBuffer: action.loading ? state.liveMessageDeltaBuffer : {},
        pendingPlanDecisionResolution: action.loading
          ? state.pendingPlanDecisionResolution
          : undefined,
      };

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
      return {
        ...state,
        detailDrawer:
          state.detailDrawer === action.drawer ? undefined : action.drawer,
      };

    case "CLOSE_DETAIL_DRAWER":
      return { ...state, detailDrawer: undefined };

    case "TOGGLE_ARTIFACT_PANEL":
      return { ...state, artifactPanelOpen: !state.artifactPanelOpen };

    case "OPEN_ARTIFACT_PANEL":
      return {
        ...state,
        selectedArtifactId: action.artifactId,
        artifactPanelOpen: true,
      };

    case "CLOSE_ARTIFACT_PANEL":
      return { ...state, artifactPanelOpen: false };

    case "SET_LANGUAGE":
      if (typeof window !== "undefined") {
        window.localStorage.setItem(LANGUAGE_STORAGE_KEY, action.language);
      }
      return { ...state, language: action.language };

    default:
      return state;
  }
}

const WorkbenchStateContext = createContext<WorkbenchState | null>(null);
const WorkbenchDispatchContext = createContext<Dispatch<WorkbenchAction> | null>(null);

export function WorkbenchProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(workbenchReducer, initialWorkbenchState);

  return (
    <WorkbenchStateContext.Provider value={state}>
      <WorkbenchDispatchContext.Provider value={dispatch}>
        {children}
      </WorkbenchDispatchContext.Provider>
    </WorkbenchStateContext.Provider>
  );
}

export function useWorkbench() {
  const state = useContext(WorkbenchStateContext);
  const dispatch = useContext(WorkbenchDispatchContext);
  if (!state || !dispatch) {
    throw new Error("useWorkbench must be used within a WorkbenchProvider");
  }
  return { state, dispatch };
}

export function useWorkbenchState() {
  const state = useContext(WorkbenchStateContext);
  if (!state) {
    throw new Error("useWorkbenchState must be used within a WorkbenchProvider");
  }
  return state;
}

export function useWorkbenchDispatch() {
  const dispatch = useContext(WorkbenchDispatchContext);
  if (!dispatch) {
    throw new Error("useWorkbenchDispatch must be used within a WorkbenchProvider");
  }
  return dispatch;
}
