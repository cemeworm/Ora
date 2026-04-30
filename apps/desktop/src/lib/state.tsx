import { CoordinationPatternSchema, ModeTranscriptLayoutSchema, SINGLE_AGENT_MODE_ID, type ModeSelection } from "@ora/shared";
import { createContext, useContext, useMemo, useReducer, type Dispatch, type ReactNode } from "react";
import type { AppView, CoordinationPattern, DockTab, RuntimeBridgeStatus } from "../types";
import { LANGUAGE_STORAGE_KEY, readStoredLanguage, type AppLanguage } from "./i18n";
import { chooseEnabledProviderId } from "./providerSelection";
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
  prompt: string;
  createdAt: number;
  progressText?: string;
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
  activeSnapshot: OraStateSnapshot | undefined;
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
  selectedSkillIds: string[];
  sessionSkillIds: Record<string, string[]>;
  sessionProjectFileAttachments: Record<string, ComposerProjectFileAttachment[]>;
  sessionLocalFileAttachments: Record<string, ComposerLocalFileAttachment[]>;
  pendingRun: PendingRunState | undefined;
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
  | {
      type: "HYDRATE_SESSION";
      projects: OraProjectSummary[];
      sessions: OraSessionSummary[];
      detail: OraSessionDetail;
      snapshot?: OraStateSnapshot;
      feedback?: string;
    }
  | { type: "CACHE_SESSION_DETAIL"; detail: OraSessionDetail }
  | { type: "SET_COLLECTIONS"; projects: OraProjectSummary[]; sessions: OraSessionSummary[]; feedback?: string }
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
  | { type: "SET_PROVIDER_SECRET_STATUSES"; statuses: OraProviderSecretStatus[] }
  | { type: "SET_PROVIDER_STATUS"; status: OraProviderStatus }
  | { type: "SET_PROVIDER_STATUSES"; statuses: OraProviderStatus[] }
  | { type: "SELECT_SESSION"; sessionId: string }
  | { type: "SELECT_TURN"; runId: string; snapshot?: OraStateSnapshot }
  | { type: "APPLY_RUN_STREAM"; stream: OraRunEventStream }
  | { type: "BEGIN_RUN_RESUME"; runId: string; approvedActionIds: string[]; updatedAt: number }
  | { type: "SELECT_TAB"; tab: DockTab }
  | { type: "SELECT_BEAT"; beatId: string | undefined }
  | { type: "SELECT_NODE"; nodeId: string }
  | { type: "SET_PROMPT"; text: string }
  | { type: "SET_SELECTED_SKILL_IDS"; skillIds: string[] }
  | { type: "ADD_PROJECT_FILE_ATTACHMENT"; sessionId: string; file: ComposerProjectFileAttachment }
  | { type: "REMOVE_PROJECT_FILE_ATTACHMENT"; sessionId: string; path: string }
  | { type: "CLEAR_PROJECT_FILE_ATTACHMENTS"; sessionId: string }
  | { type: "ADD_LOCAL_FILE_ATTACHMENT"; sessionId: string; file: ComposerLocalFileAttachment }
  | { type: "REMOVE_LOCAL_FILE_ATTACHMENT"; sessionId: string; path: string }
  | { type: "CLEAR_LOCAL_FILE_ATTACHMENTS"; sessionId: string }
  | { type: "CLEAR_PROMPT_IF_MATCH"; text: string }
  | { type: "BEGIN_RUN_REQUEST"; sessionId: string; prompt: string; createdAt: number }
  | { type: "SET_PENDING_RUN_PROGRESS"; sessionId: string; progressText: string }
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
  packageStore: undefined,
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
  sessionPromptTexts: {},
  selectedSkillIds: [],
  sessionSkillIds: {},
  sessionProjectFileAttachments: {},
  sessionLocalFileAttachments: {},
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
  language: readStoredLanguage(),
};

function replaceSessionSummary(sessions: OraSessionSummary[], session: OraSessionSummary): OraSessionSummary[] {
  return [session, ...sessions.filter((item) => item.sessionId !== session.sessionId)];
}

function selectedSnapshotFromDetail(detail: OraSessionDetail, snapshot?: OraStateSnapshot, selectedRunId?: string) {
  if (snapshot) {
    return mergeStateSnapshot(undefined, snapshot);
  }
  if (selectedRunId && detail.latestSnapshot?.runId === selectedRunId) {
    return mergeStateSnapshot(undefined, detail.latestSnapshot);
  }
  return mergeStateSnapshot(undefined, detail.latestSnapshot);
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

function sessionPromptText(state: WorkbenchState, sessionId: string | undefined): string {
  return sessionId ? (state.sessionPromptTexts[sessionId] ?? "") : "";
}

function sessionSkillIds(state: WorkbenchState, sessionId: string | undefined): string[] {
  return sessionId ? (state.sessionSkillIds[sessionId] ?? []) : [];
}

function setSessionPromptText(state: WorkbenchState, text: string): Record<string, string> {
  if (!state.selectedSessionId) {
    return state.sessionPromptTexts;
  }
  if (!text) {
    const { [state.selectedSessionId]: _cleared, ...rest } = state.sessionPromptTexts;
    return rest;
  }
  return {
    ...state.sessionPromptTexts,
    [state.selectedSessionId]: text,
  };
}

function clearSessionPromptText(state: WorkbenchState, sessionId: string): Record<string, string> {
  const { [sessionId]: _cleared, ...rest } = state.sessionPromptTexts;
  return rest;
}

function setSessionSkillIds(state: WorkbenchState, skillIds: string[]): Record<string, string[]> {
  if (!state.selectedSessionId) {
    return state.sessionSkillIds;
  }
  if (skillIds.length === 0) {
    const { [state.selectedSessionId]: _cleared, ...rest } = state.sessionSkillIds;
    return rest;
  }
  return {
    ...state.sessionSkillIds,
    [state.selectedSessionId]: skillIds,
  };
}

function clearSessionSkillIds(state: WorkbenchState, sessionId: string): Record<string, string[]> {
  const { [sessionId]: _cleared, ...rest } = state.sessionSkillIds;
  return rest;
}

function addProjectFileAttachment(
  state: WorkbenchState,
  sessionId: string,
  file: ComposerProjectFileAttachment,
): Record<string, ComposerProjectFileAttachment[]> {
  const current = state.sessionProjectFileAttachments[sessionId] ?? [];
  if (current.some((item) => item.projectId === file.projectId && item.path === file.path)) {
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
  const nextFiles = (state.sessionProjectFileAttachments[sessionId] ?? []).filter((file) => file.path !== path);
  if (nextFiles.length === 0) {
    const { [sessionId]: _cleared, ...rest } = state.sessionProjectFileAttachments;
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
  const { [sessionId]: _cleared, ...rest } = state.sessionProjectFileAttachments;
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
  const nextFiles = (state.sessionLocalFileAttachments[sessionId] ?? []).filter((file) => file.path !== path);
  if (nextFiles.length === 0) {
    const { [sessionId]: _cleared, ...rest } = state.sessionLocalFileAttachments;
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

function resolveSelectedMode(modes: OraModeSpec[], selectedModeId: string): OraModeSpec | undefined {
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

function mergeById<T extends { id: string }>(existing: readonly T[] | undefined, incoming: readonly T[] | undefined): T[] {
  return mergeByKey(existing, incoming, (item) => item.id);
}

function mergeEvents(
  existing: OraStateSnapshot["events"],
  incoming: OraStateSnapshot["events"],
): OraStateSnapshot["events"] {
  return mergeByKey(existing, incoming, (event) => event.seq)
    .sort((left, right) => left.seq - right.seq);
}

function mergeAgentMessages(
  ...sources: Array<OraStateSnapshot["agentMessages"] | undefined>
): OraStateSnapshot["agentMessages"] {
  const messageById = new Map<string, OraStateSnapshot["agentMessages"][number]>();
  for (const source of sources) {
    for (const message of source ?? []) {
      messageById.set(message.id, message);
    }
  }
  return [...messageById.values()]
    .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id));
}

function agentMessagesFromEvents(events: OraStateSnapshot["events"]): OraStateSnapshot["agentMessages"] {
  const messages: OraStateSnapshot["agentMessages"] = [];
  for (const event of events) {
    if (event.type !== "agent.message" || !isRecord(event.payload) || !isRecord(event.payload.message)) {
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
    agentMessages: mergeAgentMessages(snapshot.agentMessages, agentMessagesFromEvents(snapshot.events)),
  };
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
  if (normalizedExisting.sessionId && normalizedIncoming.sessionId && normalizedExisting.sessionId !== normalizedIncoming.sessionId) {
    return normalizedIncoming;
  }

  const events = mergeEvents(normalizedExisting.events, normalizedIncoming.events);
  return {
    ...normalizedExisting,
    ...normalizedIncoming,
    sessionId: normalizedIncoming.sessionId ?? normalizedExisting.sessionId,
    coordinationKind: normalizedIncoming.coordinationKind ?? normalizedExisting.coordinationKind,
    modeId: normalizedIncoming.modeId ?? normalizedExisting.modeId,
    profiles: mergeById(normalizedExisting.profiles, normalizedIncoming.profiles),
    memory: mergeById(normalizedExisting.memory, normalizedIncoming.memory),
    plan: mergeById(normalizedExisting.plan, normalizedIncoming.plan),
    todos: mergeById(normalizedExisting.todos, normalizedIncoming.todos),
    actions: mergeById(normalizedExisting.actions, normalizedIncoming.actions),
    toolCalls: mergeById(normalizedExisting.toolCalls, normalizedIncoming.toolCalls),
    toolResults: mergeByKey(normalizedExisting.toolResults, normalizedIncoming.toolResults, (result) => result.key),
    policyDecisions: mergeById(normalizedExisting.policyDecisions, normalizedIncoming.policyDecisions),
    checkpoints: mergeById(normalizedExisting.checkpoints, normalizedIncoming.checkpoints),
    events,
    agentMessages: mergeAgentMessages(normalizedExisting.agentMessages, normalizedIncoming.agentMessages, agentMessagesFromEvents(events)),
    artifacts: mergeById(normalizedExisting.artifacts, normalizedIncoming.artifacts),
    trace: normalizedIncoming.trace ?? normalizedExisting.trace,
    modeSpec: normalizedIncoming.modeSpec ?? normalizedExisting.modeSpec,
    output: normalizedIncoming.output ?? normalizedExisting.output,
    error: normalizedIncoming.error ?? normalizedExisting.error,
    updatedAt: Math.max(normalizedExisting.updatedAt, normalizedIncoming.updatedAt),
  };
}

export function mergeRunStreamSnapshot(snapshot: OraStateSnapshot | undefined, stream: OraRunEventStream): OraStateSnapshot | undefined {
  if (stream.snapshot) {
    return mergeStateSnapshot(snapshot, stream.snapshot);
  }
  if (!snapshot || snapshot.runId !== stream.runId) {
    return snapshot;
  }
  const eventBySeq = new Map(snapshot.events.map((event) => [event.seq, event]));
  for (const event of stream.events) {
    eventBySeq.set(event.seq, event);
  }
  const merged = mergeStreamActionUpdates(snapshot, stream);
  const agentMessages = mergeStreamAgentMessages(snapshot, stream);
  return {
    ...snapshot,
    status: stream.status ?? snapshot.status,
    actions: merged.actions,
    pendingApprovals: merged.pendingApprovals,
    agentMessages,
    events: [...eventBySeq.values()].sort((left, right) => left.seq - right.seq),
    updatedAt: stream.events.at(-1)?.createdAt ?? snapshot.updatedAt,
  };
}

function mergeStreamAgentMessages(
  snapshot: OraStateSnapshot,
  stream: OraRunEventStream,
): OraStateSnapshot["agentMessages"] {
  const messageById = new Map((snapshot.agentMessages ?? []).map((message) => [message.id, message]));
  for (const event of stream.events) {
    if (event.type !== "agent.message" || !isRecord(event.payload) || !isRecord(event.payload.message)) {
      continue;
    }
    const message = readAgentConversationMessage(event.payload.message);
    if (message) {
      messageById.set(message.id, message);
    }
  }
  return [...messageById.values()].sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id));
}

function readAgentConversationMessage(value: Record<string, unknown>): OraStateSnapshot["agentMessages"][number] | undefined {
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
    toAgentIds: Array.isArray(value.toAgentIds) ? value.toAgentIds.filter((item): item is string => typeof item === "string") : [],
    replyToId: typeof value.replyToId === "string" ? value.replyToId : undefined,
    threadId: value.threadId,
    nodeId: typeof value.nodeId === "string" ? value.nodeId : undefined,
    planItemId: typeof value.planItemId === "string" ? value.planItemId : undefined,
    kind: value.kind as OraStateSnapshot["agentMessages"][number]["kind"],
    status: value.status as OraStateSnapshot["agentMessages"][number]["status"],
    content: value.content,
    topic: typeof value.topic === "string" ? value.topic : undefined,
    correlationId: typeof value.correlationId === "string" ? value.correlationId : undefined,
    artifactIds: Array.isArray(value.artifactIds) ? value.artifactIds.filter((item): item is string => typeof item === "string") : [],
    transcript: readAgentConversationTranscript(value.transcript),
  };
}

function readAgentConversationTranscript(value: unknown): OraStateSnapshot["agentMessages"][number]["transcript"] | undefined {
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
  const stance = typeof value.stance === "string" && value.stance.trim() ? value.stance : "neutral";
  const status = value.status === "sent" ||
    value.status === "running" ||
    value.status === "done" ||
    value.status === "failed"
    ? value.status
    : "done";
  return {
    kind: "stage_transcript",
    groupId: value.groupId,
    groupLabel: typeof value.groupLabel === "string" ? value.groupLabel : undefined,
    stageId: value.stageId,
    stageLabel: value.stageLabel,
    sequence: value.sequence,
    speakerLabel: value.speakerLabel,
    speakerId: typeof value.speakerId === "string" ? value.speakerId : undefined,
    stance,
    status,
    layout: readTranscriptLayout(value.layout),
  };
}

function readTranscriptLayout(value: unknown): NonNullable<OraStateSnapshot["agentMessages"][number]["transcript"]>["layout"] | undefined {
  const parsed = ModeTranscriptLayoutSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function mergeStreamActionUpdates(
  snapshot: OraStateSnapshot,
  stream: OraRunEventStream,
): Pick<OraStateSnapshot, "actions" | "pendingApprovals"> {
  const actionById = new Map(snapshot.actions.map((action) => [action.id, action]));
  const pendingApprovals = new Set(snapshot.pendingApprovals);

  for (const event of stream.events) {
    if (event.type !== "action.updated" || !isRecord(event.payload)) {
      continue;
    }

    const actionId = typeof event.payload.actionId === "string" ? event.payload.actionId : undefined;
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
  if (typeof value.id !== "string" || typeof value.runId !== "string" || typeof value.type !== "string") {
    return undefined;
  }
  const status = readActionStatus(value.status);
  const riskLevel = value.riskLevel === "low" || value.riskLevel === "medium" || value.riskLevel === "high"
    ? value.riskLevel
    : undefined;
  if (!status || !riskLevel || !Array.isArray(value.artifactIds)) {
    return undefined;
  }
  return value as OraActionRecord;
}

function readActionStatus(value: unknown): OraActionRecord["status"] | undefined {
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
  return {
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
    pendingApprovals: snapshot.pendingApprovals.filter((actionId) => !approved.has(actionId)),
    updatedAt,
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
        sessionDetailsById: {},
        modes: [],
        promptText: "",
        sessionPromptTexts: {},
        selectedSkillIds: [],
        sessionSkillIds: {},
        sessionProjectFileAttachments: {},
        sessionLocalFileAttachments: {},
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
        packageStore: action.packageStore,
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
        promptText: sessionPromptText(state, action.detail.session.sessionId),
        selectedSkillIds: sessionSkillIds(state, action.detail.session.sessionId),
        commandFeedback: action.feedback ?? state.commandFeedback,
        pendingRun: undefined,
        isLoading: false,
        busyCommand: undefined,
      };
    }

    case "SET_COLLECTIONS":
      return {
        ...state,
        projects: action.projects,
        sessions: action.sessions,
        commandFeedback: action.feedback ?? state.commandFeedback,
        busyCommand: undefined,
      };

    case "ARCHIVE_SESSION_OPTIMISTIC": {
      const archivedSession = state.sessions.find((session) => session.sessionId === action.sessionId);
      return {
        ...state,
        sessions: state.sessions.filter((session) => session.sessionId !== action.sessionId),
        sessionPromptTexts: clearSessionPromptText(state, action.sessionId),
        sessionSkillIds: clearSessionSkillIds(state, action.sessionId),
        sessionProjectFileAttachments: clearProjectFileAttachments(state, action.sessionId),
        sessionLocalFileAttachments: clearLocalFileAttachments(state, action.sessionId),
        promptText: state.selectedSessionId === action.sessionId ? "" : state.promptText,
        selectedSkillIds: state.selectedSessionId === action.sessionId ? [] : state.selectedSkillIds,
        projects: archivedSession?.projectId
          ? state.projects.map((project) =>
            project.projectId === archivedSession.projectId
              ? { ...project, sessionCount: Math.max(0, project.sessionCount - 1) }
              : project
          )
          : state.projects,
        busyCommand: "Archive chat",
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
      const selectedProviderId = chooseEnabledProviderId(state.providerRegistry, {
        preferredProviderId: action.providerId,
        currentProviderId: state.selectedProviderId,
      });
      return {
        ...state,
        selectedProviderId,
        commandFeedback: provider && provider.enabled !== false
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
      const selectedProviderId = chooseEnabledProviderId(action.providerRegistry, {
        currentProviderId: state.selectedProviderId,
      });
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
        defaultProviderId: state.providerRegistry?.defaultProviderId ?? action.provider.id,
      };
      return {
        ...state,
        providerRegistry,
        selectedProviderId: chooseEnabledProviderId(providerRegistry, {
          preferredProviderId: action.provider.enabled !== false ? action.provider.id : undefined,
          currentProviderId: state.selectedProviderId,
        }),
        commandFeedback: `${action.provider.label} saved for future turns.`,
      };
    }

    case "DELETE_PROVIDER": {
      const providers = state.providerRegistry?.providers.filter((provider) => provider.id !== action.providerId) ?? [];
      const defaultProviderId = state.providerRegistry?.defaultProviderId ?? "local-smoke";
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
        promptText: sessionPromptText(state, action.sessionId),
        selectedSkillIds: sessionSkillIds(state, action.sessionId),
        selectedArtifactId: undefined,
        detailDrawer: undefined,
        artifactPanelOpen: false,
        pendingRun: undefined,
      };
    }

    case "SELECT_TURN": {
      const snapshot = mergeStateSnapshot(undefined, action.snapshot);
      return {
        ...state,
        selectedTurnRunId: action.runId,
        activeSnapshot: snapshot ?? state.activeSnapshot,
        selectedPattern: snapshot?.pattern ?? state.selectedPattern,
        selectedModeId: snapshot?.modeId ?? state.selectedModeId,
        selectedModeSelection: snapshot?.config.modeSelection ?? state.selectedModeSelection,
        selectedNodeId: snapshot?.topology.nodes[1]?.id ?? snapshot?.topology.nodes[0]?.id ?? state.selectedNodeId,
        selectedBeatId: snapshot?.events.at(-1)?.id ?? state.selectedBeatId,
        pendingRun: snapshot ? undefined : state.pendingRun,
      };
    }

    case "APPLY_RUN_STREAM": {
      const streamSessionId = action.stream.snapshot?.sessionId;
      const activeSessionId = state.activeSessionDetail?.session.sessionId ?? state.selectedSessionId ?? state.activeSnapshot?.sessionId;
      const streamMatchesActiveSession = !streamSessionId || !activeSessionId || streamSessionId === activeSessionId;
      const streamReferencesActiveRun = state.activeSnapshot?.runId === action.stream.runId ||
        state.selectedTurnRunId === action.stream.runId ||
        (state.activeSessionDetail?.turns.some((turn) => turn.runId === action.stream.runId) ?? false);
      const streamBelongsToActiveTurn = streamMatchesActiveSession && streamReferencesActiveRun;
      const activeSnapshot = streamBelongsToActiveTurn
        ? mergeRunStreamSnapshot(state.activeSnapshot, action.stream)
        : state.activeSnapshot;
      const streamSnapshot = streamBelongsToActiveTurn ? activeSnapshot : action.stream.snapshot;
      const { sessions, activeSessionDetail } = syncSessionStateForSettledStream(state, action.stream, streamSnapshot);
      return {
        ...state,
        sessions,
        activeSessionDetail,
        sessionDetailsById: activeSessionDetail
          ? cacheSessionDetail(state.sessionDetailsById, activeSessionDetail)
          : state.sessionDetailsById,
        activeSnapshot,
        selectedTurnRunId: state.selectedTurnRunId ?? (streamBelongsToActiveTurn ? action.stream.runId : undefined),
        selectedBeatId: streamBelongsToActiveTurn ? action.stream.events.at(-1)?.id ?? state.selectedBeatId : state.selectedBeatId,
        pendingRun: streamMatchesPendingRun(state.pendingRun, action.stream, streamSnapshot) ? undefined : state.pendingRun,
        selectedModeSelection: streamBelongsToActiveTurn ? activeSnapshot?.config.modeSelection ?? state.selectedModeSelection : state.selectedModeSelection,
        isLoading: streamBelongsToActiveTurn ? action.stream.status === "running" || action.stream.status === "queued" : state.isLoading,
        commandFeedback: streamBelongsToActiveTurn && action.stream.status === "succeeded"
          ? "Run completed."
          : streamBelongsToActiveTurn && action.stream.status === "failed"
            ? "Run failed."
            : state.commandFeedback,
      };
    }

    case "BEGIN_RUN_RESUME": {
      const activeSnapshot = markSnapshotResuming(state.activeSnapshot, action.runId, action.approvedActionIds, action.updatedAt);
      return {
        ...state,
        activeSnapshot,
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
        sessionProjectFileAttachments: addProjectFileAttachment(state, action.sessionId, action.file),
        commandFeedback: `Added ${action.file.path} to chat.`,
      };

    case "REMOVE_PROJECT_FILE_ATTACHMENT":
      return {
        ...state,
        sessionProjectFileAttachments: removeProjectFileAttachment(state, action.sessionId, action.path),
      };

    case "CLEAR_PROJECT_FILE_ATTACHMENTS":
      return {
        ...state,
        sessionProjectFileAttachments: clearProjectFileAttachments(state, action.sessionId),
      };

    case "ADD_LOCAL_FILE_ATTACHMENT":
      return {
        ...state,
        sessionLocalFileAttachments: addLocalFileAttachment(state, action.sessionId, action.file),
        commandFeedback: `Added ${action.file.name} to chat.`,
      };

    case "REMOVE_LOCAL_FILE_ATTACHMENT":
      return {
        ...state,
        sessionLocalFileAttachments: removeLocalFileAttachment(state, action.sessionId, action.path),
      };

    case "CLEAR_LOCAL_FILE_ATTACHMENTS":
      return {
        ...state,
        sessionLocalFileAttachments: clearLocalFileAttachments(state, action.sessionId),
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

    case "BEGIN_RUN_REQUEST":
      return {
        ...state,
        pendingRun: {
          sessionId: action.sessionId,
          prompt: action.prompt,
          createdAt: action.createdAt,
          progressText: "正在准备",
        },
        selectedSkillIds: [],
        sessionSkillIds: clearSessionSkillIds(state, action.sessionId),
        isLoading: true,
      };

    case "SET_PENDING_RUN_PROGRESS":
      if (!state.pendingRun || state.pendingRun.sessionId !== action.sessionId) {
        return state;
      }
      return {
        ...state,
        pendingRun: {
          ...state.pendingRun,
          progressText: action.progressText,
        },
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
