import {
  deriveRuntimeTimelineProjection,
  modeSpecToPatternDefinition,
  ORA_ROOT_AGENT_ID,
  ORA_ROOT_AGENT_LABEL,
  runtimeStatusForRunAttention,
  type GateProjection,
} from "@cemeworm/shared";
import type {
  ActionRecord,
  AgentProfile,
  AssistantTurnActiveLoadingTarget,
  AssistantTurnAttachment,
  ArtifactRecord,
  ChatMessage,
  CitationSource,
  ChatMessageAttachment,
  ClarificationOption,
  CheckpointRecord,
  CoordinationPattern,
  MemoryRecord,
  ModeCard,
  PatternCard,
  PlanItem,
  RunBeat,
  RunStatus,
  SessionRun,
  SessionTurnItem,
  TurnClarificationExchange,
  StreamLine,
  TurnArtifactAttachment,
  TurnFileChangeAttachment,
  TurnAgentConversationMessage,
  TurnProcessStep,
  TurnTimelineItem,
  TopologyEdge,
  TopologyNode,
} from "../types";
import type {
  OraActionRecord,
  OraAgentProfile,
  OraArtifactRef,
  OraCheckpointMeta,
  OraEventEnvelope,
  OraMemoryRecord,
  OraModeSpec,
  OraPatternDefinition,
  OraPlanItem,
  OraRunAttention,
  OraSessionDetail,
  OraSessionSummary,
  OraStateSnapshot,
  OraSessionTranscriptMessage,
  OraTopologyEdge,
  OraTopologyNode,
} from "./runtimeClient";
import { USER_CANCELLED_MESSAGE, USER_INTERRUPTED_MESSAGE, USER_RESUMED_MESSAGE } from "./runtimeClient";
import { deriveSnapshotInteractionProjection, attentionGateKind } from "./runInteractionState";
import { parseProposedPlan } from "./proposedPlanParser";
import { mergeAssistantMessageTextProjection } from "./assistantMessageProjection";

const APPROVAL_INTERRUPT_MESSAGE = "需要你确认后，我才能继续。";
const APPROVAL_INTERRUPT_MESSAGE_EN = "Waiting for your approval before continuing.";
const APPROVAL_DENIED_MESSAGE = "审批不通过，已停止继续执行。";
const APPROVAL_DENIED_STEP_LABEL = "审批不通过";
const APPROVAL_DENIED_STEP_DETAIL = "已停止继续执行。";

export interface WorkbenchViewModel {
  patternCards: PatternCard[];
  modeCards: ModeCard[];
  sessions: SessionRun[];
  turns: SessionTurnItem[];
  topologyNodes: TopologyNode[];
  topologyEdges: TopologyEdge[];
  streamLines: StreamLine[];
  agents: AgentProfile[];
  memoryRecords: MemoryRecord[];
  planItems: PlanItem[];
  actions: ActionRecord[];
  checkpoints: CheckpointRecord[];
  artifacts: ArtifactRecord[];
  beats: RunBeat[];
  activePattern: PatternCard;
  activeMode: ModeCard;
  activeSnapshot: OraStateSnapshot;
}

export interface PendingRunPreview {
  sessionId: string;
  runId?: string;
  prompt: string;
  createdAt: number;
  progressText?: string;
}

export interface LiveMessageDeltaPreview {
  runId: string;
  messageId: string;
  sessionId?: string;
  role: "assistant";
  content: string;
  agentId?: string;
  nodeId?: string;
  createdAt: number;
  updatedAt: number;
}

export function buildWorkbenchViewModel(
  patterns: OraPatternDefinition[],
  modes: OraModeSpec[],
  sessions: OraSessionSummary[],
  sessionDetail: OraSessionDetail,
  activeSnapshot: OraStateSnapshot | undefined,
  selectedPattern: CoordinationPattern,
  selectedModeId: string,
): WorkbenchViewModel {
  const stable = buildStableViewModel(
    patterns,
    modes,
    sessions,
    sessionDetail,
    selectedPattern,
    selectedModeId,
  );
  const dynamic = buildDynamicViewModel(
    patterns,
    modes,
    sessionDetail,
    activeSnapshot,
    selectedPattern,
    selectedModeId,
  );
  return { ...stable, ...dynamic };
}

export function buildStableViewModel(
  patterns: OraPatternDefinition[],
  modes: OraModeSpec[],
  sessions: OraSessionSummary[],
  sessionDetail: OraSessionDetail,
  selectedPattern: CoordinationPattern,
  selectedModeId: string,
) {
  const selectedMode =
    modes.find((mode) => mode.id === selectedModeId) ?? modes[0];
  const activeDefinition = selectedMode
    ? modeSpecToPatternDefinition(selectedMode)
    : findPattern(patterns, selectedPattern);
  const effectivePattern = activeDefinition.id;
  const detailSnapshot =
    sessionDetail.latestSnapshot ??
    createEmptySessionPreview(
      activeDefinition,
      sessionDetail.session,
      selectedMode,
    );
  const selectedPatternSnapshot =
    detailSnapshot.pattern === effectivePattern &&
    detailSnapshot.modeId === selectedMode?.id
      ? detailSnapshot
      : createPreviewFromPattern(
          detailSnapshot,
          activeDefinition,
          selectedMode,
        );

  const patternCards = patterns.map(adaptPatternCard);
  const modeCards = modes.map(adaptModeCard);
  const activePattern =
    patternCards.find((pattern) => pattern.id === effectivePattern) ??
    patternCards[0];
  const activeMode = selectedMode ? adaptModeCard(selectedMode) : modeCards[0];

  return {
    patternCards,
    modeCards,
    activePattern,
    activeMode,
    sessions: sessions.map((session) =>
      adaptSession(
        session,
        effectivePattern,
        detailSnapshot.sessionId === session.sessionId
          ? detailSnapshot
          : undefined,
      ),
    ),
    turns: sessionDetail.turns.map(adaptTurn),
    topologyNodes: adaptTopologyNodes(
      selectedPatternSnapshot.topology.nodes,
      effectivePattern,
    ),
    topologyEdges: adaptTopologyEdges(selectedPatternSnapshot.topology.edges),
  };
}

export function buildDynamicViewModel(
  patterns: OraPatternDefinition[],
  modes: OraModeSpec[],
  sessionDetail: OraSessionDetail,
  activeSnapshot: OraStateSnapshot | undefined,
  selectedPattern: CoordinationPattern,
  selectedModeId: string,
) {
  const selectedMode =
    modes.find((mode) => mode.id === selectedModeId) ?? modes[0];
  const activeDefinition = selectedMode
    ? modeSpecToPatternDefinition(selectedMode)
    : findPattern(patterns, selectedPattern);
  const effectivePattern = activeDefinition.id;
  const detailSnapshot =
    activeSnapshot ??
    sessionDetail.latestSnapshot ??
    createEmptySessionPreview(
      activeDefinition,
      sessionDetail.session,
      selectedMode,
    );
  const selectedPatternSnapshot =
    detailSnapshot.pattern === effectivePattern &&
    detailSnapshot.modeId === selectedMode?.id
      ? detailSnapshot
      : createPreviewFromPattern(
          detailSnapshot,
          activeDefinition,
          selectedMode,
        );

  const snapshotEvents = detailSnapshot.events;
  return {
    streamLines: adaptStreamLines(snapshotEvents),
    agents: selectedPatternSnapshot.profiles.map(adaptAgentProfile),
    memoryRecords: adaptMemoryRecords(
      selectedPatternSnapshot.memory,
      selectedPatternSnapshot.profiles,
    ),
    planItems: selectedPatternSnapshot.plan.map(adaptPlanItem),
    actions: selectedPatternSnapshot.actions.map((action) =>
      adaptActionRecord(action, selectedPatternSnapshot.input.prompt),
    ),
    checkpoints: detailSnapshot.checkpoints.map(adaptCheckpoint),
    artifacts: userVisibleArtifacts(detailSnapshot.artifacts).map(adaptArtifact),
    get beats() {
      const value = adaptFilmstripBeats(detailSnapshot);
      Object.defineProperty(this, "beats", { value, enumerable: true });
      return value;
    },
    activeSnapshot: detailSnapshot,
  };
}

function createEmptySessionPreview(
  definition: OraPatternDefinition,
  session: OraSessionSummary,
  selectedMode?: OraModeSpec,
): OraStateSnapshot {
  const now = session.updatedAt;
  const modeId = session.latestModeId ?? selectedMode?.id ?? definition.id;
  return {
    runId: session.latestRunId ?? `${session.sessionId}:preview`,
    sessionId: session.sessionId,
    turnIndex: Math.max(1, session.turnCount || 1),
    status: "succeeded",
    pattern: definition.id,
    coordinationKind: definition.id,
    modeId,
    input: {
      prompt: "",
      projectId: session.projectId,
      context: {},
      createdAt: now,
    },
    config: {
      pattern: definition.id,
      modeId,
      modeSelection: "manual",
      profileIds: definition.profiles.map((profile) => profile.id),
      skillIds: [],
      toolIds: [],
      modelRef: "local/smoke-model",
      budget: definition.defaultBudget,
      approvalMode: "high_risk_only",
      permissionMode: "default",
      patternOptions: {},
      metadata: {},
      deterministicSeed: "ora-preview",
    },
    topology: definition.topology,
    profiles: definition.profiles,
    memory: [],
    plan: [],
    planList: [],
    actions: [],
    toolCalls: [],
    continuation: { frames: [] },
    planDecisions: [],
    conversation: [],
    toolResults: [],
    policyDecisions: [],
    checkpoints: [],
    events: [],
    agentMessages: [],
    artifacts: [],
    todos: [],
    activeAgents: [],
    queueSummary: {
      mode: "dag",
      pending: 0,
      inProgress: 0,
      completed: 0,
      topics: [],
    },
    sharedStateSummary: {
      enabled: false,
      storeKind: "none",
      version: 0,
      entries: [],
    },
    busStats: {
      enabled: false,
      publishedCount: 0,
      routedCount: 0,
      topicCounts: {},
    },
    pendingClarifications: [],
    pendingApprovals: [],
    updatedAt: now,
  };
}

export function findPattern(
  patterns: OraPatternDefinition[],
  pattern: CoordinationPattern,
): OraPatternDefinition {
  return (
    patterns.find((definition) => definition.id === pattern) ?? patterns[0]
  );
}

function createPreviewFromPattern(
  snapshot: OraStateSnapshot,
  definition: OraPatternDefinition,
  selectedMode?: OraModeSpec,
): OraStateSnapshot {
  const previewPlan: OraPlanItem[] = definition.planTemplate.map(
    (item, index) => ({
      id: `${snapshot.runId}:preview:${item.id}`,
      runId: snapshot.runId,
      ownerAgentId: item.ownerAgentId,
      status: (index === 0 ? "ready" : "planned") as OraPlanItem["status"],
      title: item.title,
      dependencies: item.dependencies,
      linkedActionIds: [],
      checkpointIds: snapshot.checkpoints.map((checkpoint) => checkpoint.id),
    }),
  );
  const previewTodos: OraStateSnapshot["todos"] = previewPlan.map((item) => ({
    id: `${item.id}:todo`,
    runId: snapshot.runId,
    sourcePlanItemId: item.id,
    status: item.status,
    label: item.title,
    createdAt: snapshot.updatedAt,
    updatedAt: snapshot.updatedAt,
  }));

  return {
    ...snapshot,
    pattern: definition.id,
    coordinationKind: definition.id,
    modeId: selectedMode?.id ?? snapshot.modeId,
    config: {
      ...snapshot.config,
      pattern: definition.id,
      modeId: selectedMode?.id ?? snapshot.config.modeId,
      modeSelection: snapshot.config.modeSelection ?? "manual",
    },
    topology: definition.topology,
    profiles: definition.profiles,
    plan: previewPlan,
    planList: [],
    todos: previewTodos,
    actions: [
      {
        id: `${snapshot.runId}:preview-action`,
        runId: snapshot.runId,
        agentId: definition.profiles[0]?.id,
        type: `${definition.id}.policy.preview`,
        riskLevel: "medium",
        status: "proposed",
        input: { constraints: definition.defaultConstraints },
        artifactIds: [],
      },
    ],
  };
}

function adaptPatternCard(pattern: OraPatternDefinition): PatternCard {
  return {
    id: pattern.id,
    label: pattern.label,
    summary: pattern.summary,
    recommendedUse: pattern.recommendedUse,
    failureMode: pattern.failureMode,
    constraints: pattern.defaultConstraints.join(" "),
  };
}

function adaptModeCard(mode: OraModeSpec): ModeCard {
  return {
    id: mode.id,
    family: mode.family,
    label: mode.label,
    summary: mode.summary,
    recommendedUse:
      mode.recommendedUse ??
      `Use when ${mode.family.replace(/_/g, " ")} fits the task.`,
    failureMode:
      mode.failureMode ??
      "Misconfigured stages can reduce observability or waste budget.",
    isPreset: mode.systemPreset,
  };
}

function adaptSession(
  session: OraSessionSummary,
  fallbackPattern: CoordinationPattern,
  snapshot?: OraStateSnapshot,
): SessionRun {
  const status = snapshot?.status ?? session.status ?? "succeeded";
  const attention = snapshot?.attention ?? session.attention;
  return {
    id: session.sessionId,
    title: session.title,
    project: session.projectId ?? "Recent chat",
    projectId: session.projectId,
    status: snapshot
      ? adaptSnapshotRunStatus(snapshot)
      : adaptStatusWithAttention(status, attention, session.interactionGate),
    pattern: snapshot?.pattern ?? session.latestPattern ?? fallbackPattern,
    modeId: snapshot?.modeId ?? session.latestModeId,
    updatedAt: formatClock(snapshot?.updatedAt ?? session.updatedAt),
    health: status === "failed" ? 42 : status === "interrupted" ? 68 : 94,
    latestRunId: snapshot?.runId ?? session.latestRunId,
    turnCount: session.turnCount,
  };
}

function adaptTurn(turn: OraSessionDetail["turns"][number]): SessionTurnItem {
  return {
    runId: turn.runId,
    sessionId: turn.sessionId,
    turnIndex: turn.turnIndex,
    status: adaptStatusWithAttention(turn.status, turn.attention),
    pattern: turn.pattern,
    modeId: turn.modeId,
    providerId: turn.providerId,
    modelRef: turn.modelRef,
    prompt: turn.prompt,
    updatedAt: formatClock(turn.updatedAt),
  };
}

function adaptAttentionStatus(attention: OraRunAttention | undefined): RunStatus | undefined {
  return runtimeStatusForRunAttention(attention) as RunStatus | undefined;
}

function adaptSnapshotRunStatus(snapshot: OraStateSnapshot): RunStatus {
  return deriveSnapshotInteractionProjection(snapshot).status as RunStatus;
}

function adaptGateProjectionStatus(gate: GateProjection | undefined): RunStatus | undefined {
  if (!gate) return undefined;
  switch (gate.kind) {
    case "approval":
      return "approval_required";
    case "clarification":
      return "clarification_required";
    case "plan_decision":
      return "decision_needed";
  }
}

function adaptStatusWithAttention(
  status: OraStateSnapshot["status"],
  attention: OraRunAttention | undefined,
  interactionGate?: GateProjection,
): RunStatus {
  const gateStatus = adaptGateProjectionStatus(interactionGate);
  if (gateStatus) return gateStatus;
  const attentionStatus = adaptAttentionStatus(attention);
  if (attentionGateKind(attention)) {
    return attentionStatus ?? adaptRunStatus(status);
  }
  if (status === "queued" || status === "running") {
    return attentionStatus && attentionStatus !== "running"
      ? attentionStatus
      : adaptRunStatus(status);
  }
  return adaptRunStatus(status);
}

function adaptRunStatus(status: OraStateSnapshot["status"], opts?: { hasPendingClarifications?: boolean }): RunStatus {
  switch (status) {
    case "queued":
    case "running":
      return "running";
    case "interrupted":
      return opts?.hasPendingClarifications ? "clarification_required" : "paused";
    case "cancelled":
      return "cancelled";
    case "succeeded":
      return "done";
    case "failed":
      return "failed";
  }
}

function adaptTopologyNodes(
  nodes: OraTopologyNode[],
  pattern: CoordinationPattern,
): TopologyNode[] {
  const layout = nodeLayout(pattern, nodes);

  return nodes.map((node, index) => ({
    id: node.id,
    label: node.label,
    kind: node.kind,
    role: roleForNode(node),
    agentId: node.agentId,
    status: adaptNodeStatus(node.status),
    atomId:
      typeof node.metadata.atomId === "string"
        ? node.metadata.atomId
        : undefined,
    atomScope:
      node.metadata.atomScope === "mode" || node.metadata.atomScope === "node"
        ? node.metadata.atomScope
        : undefined,
    atomPresentation:
      node.metadata.atomPresentation === "mode_capability" ||
      node.metadata.atomPresentation === "stage_attachment" ||
      node.metadata.atomPresentation === "family_capability"
        ? node.metadata.atomPresentation
        : undefined,
    sourceNodeId:
      typeof node.metadata.sourceNodeId === "string"
        ? node.metadata.sourceNodeId
        : undefined,
    active:
      typeof node.metadata.atomActive === "boolean"
        ? node.metadata.atomActive
        : undefined,
    x: layout[index]?.x ?? 80 + index * 150,
    y: layout[index]?.y ?? 84,
  }));
}

function adaptTopologyEdges(edges: OraTopologyEdge[]): TopologyEdge[] {
  return edges.map((edge) => ({
    from: edge.source,
    to: edge.target,
    label: edge.label ?? edge.kind,
    kind: edge.kind,
  }));
}

function roleForNode(node: OraTopologyNode): string {
  if (node.kind === "capability" && typeof node.metadata.atomId === "string") {
    const scope =
      node.metadata.atomScope === "mode" || node.metadata.atomScope === "node"
        ? node.metadata.atomScope
        : "runtime";
    const source =
      typeof node.metadata.sourceNodeLabel === "string"
        ? ` · ${node.metadata.sourceNodeLabel}`
        : "";
    return `${scope}:${node.metadata.atomId}${source}`;
  }

  if (typeof node.metadata.role === "string") {
    return node.metadata.role;
  }

  if (node.kind === "agent") {
    return node.agentId ? `agent:${node.agentId}` : "agent";
  }

  return node.kind;
}

function adaptNodeStatus(
  status: OraTopologyNode["status"],
): TopologyNode["status"] {
  switch (status) {
    case "running":
      return "active";
    case "blocked":
      return "blocked";
    case "done":
      return "done";
    case "failed":
      return "blocked";
    case "idle":
      return "idle";
  }
}

function adaptStreamLines(events: OraEventEnvelope[]): StreamLine[] {
  const lines = events
    .filter((event) =>
      [
        "run.started",
        "topology.updated",
        "plan.updated",
        "message.delta",
        "node.updated",
        "completion.updated",
        "checkpoint.created",
        "run.done",
        "run.failed",
      ].includes(event.type),
    )
    .map((event) => ({
      source: event.nodeId ?? event.agentId ?? event.type,
      text: eventText(event),
    }));

  return lines.length > 0
    ? lines
    : [
        {
          source: "runtime",
          text: "Waiting for Ora event envelopes from the runtime bridge.",
        },
      ];
}

function eventText(event: OraEventEnvelope): string {
  if (isRecord(event.payload)) {
    const readable = readablePayloadText(event.payload);
    if (readable) {
      return readable;
    }
  }

  switch (event.type) {
    case "completion.updated":
      return "";
    case "node.updated":
      return isRecord(event.payload) && typeof event.payload.state === "string"
        ? `处理状态已更新：${event.payload.state}。`
        : "处理状态已更新。";
    case "run.failed":
      return "本轮任务未完成。可打开轨迹查看最新细节。";
    default:
      return event.type;
  }
}

function readablePayloadText(payload: Record<string, unknown>): string | undefined {
  const candidates = [
    payload.summary,
    payload.message,
    payload.title,
    payload.detail,
    payload.content,
    payload.error,
    payload.reason,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return undefined;
}

function adaptAgentProfile(profile: OraAgentProfile): AgentProfile {
  return {
    id: profile.id,
    label: profile.label,
    role: profile.role,
    model: profile.modelRef ?? "runtime default",
    tools: [profile.toolPolicyId],
    budget: `${Math.round(profile.budget.maxRuntimeMs / 60000)} min / ${profile.budget.maxTokens.toLocaleString()} tokens`,
    memoryScopes: profile.memoryNamespaces,
  };
}

function adaptMemoryRecords(
  records: OraMemoryRecord[],
  profiles: OraAgentProfile[],
): MemoryRecord[] {
  if (records.length > 0) {
    return records.map((record) => ({
      id: record.id,
      namespace: record.namespace.join("/"),
      kind: record.kind,
      value: memoryValue(record.value),
      updatedAt: formatClock(record.updatedAt),
    }));
  }

  return profiles.flatMap((profile) =>
    profile.memoryNamespaces.map((namespace) => ({
      id: `${profile.id}:${namespace}`,
      namespace: `${namespace}/${profile.id}`,
      kind: namespaceKind(namespace),
      value: `${profile.label} can read/write ${namespace} memory.`,
      updatedAt: "ready",
    })),
  );
}

function memoryValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (isRecord(value) && typeof value.summary === "string") {
    return value.summary;
  }
  return JSON.stringify(value);
}

function namespaceKind(namespace: string): MemoryRecord["kind"] {
  if (
    ["profile", "project", "session", "worker", "artifact"].includes(namespace)
  ) {
    return namespace as MemoryRecord["kind"];
  }
  return "session";
}

function adaptPlanItem(item: OraPlanItem): PlanItem {
  return {
    id: item.id,
    owner: item.ownerAgentId ?? "runtime",
    title: item.title,
    status: adaptPlanStatus(item.status),
    checkpoint: item.checkpointIds[0] ?? "pending",
    linkedActions: item.linkedActionIds,
  };
}

function adaptPlanStatus(status: OraPlanItem["status"]): PlanItem["status"] {
  switch (status) {
    case "planned":
    case "ready":
      return "queued";
    case "running":
      return "running";
    case "blocked":
      return "blocked";
    case "done":
    case "skipped":
      return "done";
    case "failed":
      return "blocked";
  }
}

function adaptActionRecord(action: OraActionRecord, userPrompt?: string): ActionRecord {
  return {
    id: action.id,
    label: action.type.replace(/\./g, " "),
    state: adaptActionStatus(action.status),
    consequence: actionConsequence(action),
    risk: action.riskLevel,
    toolId: action.type,
    input: action.input,
    approvalRequest: action.approvalRequest ?? fallbackApprovalRequest(action, userPrompt),
    agentId: action.agentId,
    planItemId: action.planItemId,
    artifactIds: action.artifactIds,
  };
}

function adaptCheckpoint(checkpoint: OraCheckpointMeta): CheckpointRecord {
  return {
    id: checkpoint.id,
    label: checkpoint.label,
    createdAt: formatClock(checkpoint.createdAt),
    eventSeq: checkpoint.eventSeq,
    stateHash: checkpoint.stateHash,
  };
}

function adaptArtifact(artifact: OraArtifactRef): ArtifactRecord {
  return {
    id: artifact.id,
    label: artifact.label,
    kind: artifact.kind,
    mimeType: artifact.mimeType,
    createdAt: formatClock(artifact.createdAt),
    uri: artifact.uri,
    sizeBytes: artifact.sizeBytes,
    payload: artifact.payload,
  };
}

function adaptActionStatus(
  status: OraActionRecord["status"],
): ActionRecord["state"] {
  switch (status) {
    case "approval_required":
      return "approval_required";
    case "running":
      return "running";
    case "succeeded":
    case "approved":
    case "skipped":
    case "reverted":
      return "succeeded";
    case "failed":
    case "denied":
      return "failed";
    case "proposed":
      return "proposed";
  }
}

function actionConsequence(action: OraActionRecord): string {
  if (action.riskLevel === "high") {
    return "Please confirm this operation before I continue.";
  }
  if (action.status === "approval_required") {
    return "Please confirm this operation before I continue.";
  }
  if (action.status === "succeeded") {
    return "This operation was completed and recorded.";
  }
  return "This operation is ready to review.";
}

function fallbackApprovalRequest(action: OraActionRecord, userPrompt?: string): ActionRecord["approvalRequest"] {
  if (action.status !== "approval_required") {
    return undefined;
  }
  const zh = typeof userPrompt === "string" && /[\u3400-\u9fff]/.test(userPrompt);
  if (zh) {
    return {
      title: "需要你确认后继续",
      summary: "我准备执行一项会影响本地环境的操作。",
      whatWillChange: "操作完成后，本地状态可能发生变化。",
      whyNeeded: "这是继续当前任务所需的步骤。",
      riskNote: "请确认这符合你的预期后再继续。",
      confirmLabel: "批准并继续",
    };
  }
  return {
    title: "Confirm before continuing",
    summary: "I am ready to perform an action that can affect the local environment.",
    whatWillChange: "Local state may change after the action completes.",
    whyNeeded: "This step is needed to continue the current task.",
    riskNote: "Confirm this matches your expectations before continuing.",
    confirmLabel: "Approve and continue",
  };
}

function adaptFilmstripBeats(snapshot: OraStateSnapshot): RunBeat[] {
  const beats = snapshot.events.map((event) => ({
    id: event.id,
    group: beatGroup(event),
    label: beatLabel(event),
    time: formatElapsed(
      snapshot.events[0]?.createdAt ?? event.createdAt,
      event.createdAt,
    ),
    detail: eventText(event),
    eventType: event.type,
    eventSeq: event.seq,
    checkpointId: event.checkpointId ?? checkpointIdFromPayload(event.payload),
    nodeId: event.nodeId,
    agentId: event.agentId,
  }));

  return beats.length > 0
    ? beats
    : [
        {
          id: "empty",
          group: "plan",
          label: "Awaiting run",
          time: "00:00",
          detail: "Start a run to populate replay beats.",
          eventType: "idle",
          eventSeq: 0,
        },
      ];
}

function checkpointIdFromPayload(payload: unknown): string | undefined {
  if (!isRecord(payload) || !isRecord(payload.checkpoint)) {
    return undefined;
  }
  const id = payload.checkpoint.id;
  return typeof id === "string" ? id : undefined;
}

function beatGroup(event: OraEventEnvelope): RunBeat["group"] {
  switch (event.type) {
    case "plan.updated":
    case "plan_list.updated":
      return "plan";
    case "run.forked":
    case "run.replayed":
      return "retry";
    case "topology.updated":
      return "dispatch";
    case "agent.started":
    case "agent.completed":
    case "task.started":
    case "task.progress":
    case "task.completed":
      return "dispatch";
    case "task.failed":
      return "error";
    case "approval.required":
    case "clarification.required":
    case "approval.resolved":
    case "clarification.resolved":
    case "action.updated":
      return "approval";
    case "message.published":
    case "message.routed":
      return "dispatch";
    case "queue.updated":
      return "plan";
    case "shared_state.updated":
      return "tool";
    case "worker.claimed":
    case "worker.released":
      return "dispatch";
    case "checkpoint.created":
      return "checkpoint";
    case "run.failed":
      return "error";
    case "run.done":
      return "done";
    case "run.interrupted":
      return "approval";
    case "run.cancelled":
      return "error";
    case "profile.updated":
    case "memory.queued":
    case "memory.updated":
    case "memory.flushed":
      return "dispatch";
    default:
      return "tool";
  }
}

function beatLabel(event: OraEventEnvelope): string {
  switch (event.type) {
    case "run.started":
      return "开始运行";
    case "run.resumed":
      return "继续运行";
    case "run.forked":
      return "已分叉";
    case "run.replayed":
      return "已重放";
    case "topology.updated":
      return "拓扑更新";
    case "agent.started":
      return "智能体启动";
    case "agent.completed":
      return "智能体完成";
    case "profile.updated":
      return "配置更新";
    case "memory.queued":
      return "记忆待写入";
    case "memory.updated":
      return "记忆更新";
    case "memory.flushed":
      return "记忆已写入";
    case "plan.updated":
      return "计划更新";
    case "todo.updated":
      return "待办更新";
    case "action.updated":
      return "操作更新";
    case "task.started":
      return "任务开始";
    case "task.progress":
      return "任务进展";
    case "task.completed":
      return "任务完成";
    case "task.failed":
      return "任务失败";
    case "approval.required":
      return "需要确认";
    case "clarification.required":
      return "需要补充信息";
    case "approval.resolved":
      return "确认已处理";
    case "clarification.resolved":
      return "补充信息已处理";
    case "tool.called":
      return isRecord(event.payload) ? toolCallLabel(event.payload) : "工具调用";
    case "tool.repaired":
      return "工具结果已恢复";
    case "message.delta":
      return "消息输出";
    case "agent.message":
      return "智能体消息";
    case "message.published":
      return "消息发布";
    case "message.routed":
      return "消息路由";
    case "token.delta":
      return "文本输出";
    case "queue.updated":
      return "队列更新";
    case "shared_state.updated":
      return "共享状态更新";
    case "worker.claimed":
      return "工作单元接手";
    case "worker.released":
      return "工作单元释放";
    case "checkpoint.created":
      return "检查点";
    case "artifact.exported":
      return "产物已发布";
    case "artifact.degraded":
      return "产物已降级";
    case "completion.updated":
      return "生成控制";
    case "node.updated":
      return "节点状态";
    case "recovery.detected":
      return "检测到恢复需求";
    case "recovery.retry_scheduled":
      return "准备重试";
    case "recovery.applied":
      return "已恢复";
    case "recovery.exhausted":
      return "恢复失败";
    case "node.skipped":
      return "节点已跳过";
    case "run.interrupted":
      return "已暂停";
    case "run.cancelled":
      return "已取消";
    case "run.done":
      return "已完成";
    case "run.failed":
      return "失败";
    case "plan_list.updated":
      return "计划清单更新";
    default:
      return event.type;
  }
}

function nodeLayout(
  pattern: CoordinationPattern,
  nodes: OraTopologyNode[],
): Array<{ x: number; y: number }> {
  const count = nodes.length;
  const capabilities = nodes.filter((node) => node.kind === "capability");
  if (capabilities.length > 0) {
    const primaryNodes = nodes.filter((node) => node.kind !== "capability");
    const base = baseNodeLayout(pattern, Math.max(primaryNodes.length, 1));
    const positions = new Map<string, { x: number; y: number }>();

    primaryNodes.forEach((node, index) => {
      positions.set(node.id, base[index] ?? { x: 80 + index * 150, y: 92 });
    });

    const floatingCapabilities = capabilities.filter(
      (node) => node.metadata.atomPresentation !== "stage_attachment",
    );
    floatingCapabilities.forEach((node, index) => {
      positions.set(node.id, {
        x: 56 + index * 164,
        y: 14,
      });
    });

    const attachmentCounts = new Map<string, number>();
    capabilities
      .filter((node) => node.metadata.atomPresentation === "stage_attachment")
      .forEach((node) => {
        const sourceNodeId =
          typeof node.metadata.sourceNodeId === "string"
            ? node.metadata.sourceNodeId
            : undefined;
        const anchor = sourceNodeId ? positions.get(sourceNodeId) : undefined;
        const countForSource =
          attachmentCounts.get(sourceNodeId ?? node.id) ?? 0;
        attachmentCounts.set(sourceNodeId ?? node.id, countForSource + 1);
        positions.set(node.id, {
          x: (anchor?.x ?? 80) + 18,
          y: (anchor?.y ?? 92) + 106 + countForSource * 58,
        });
      });

    return nodes.map(
      (node, index) => positions.get(node.id) ?? { x: 80 + index * 150, y: 92 },
    );
  }

  return baseNodeLayout(pattern, count);
}

function baseNodeLayout(
  pattern: CoordinationPattern,
  count: number,
): Array<{ x: number; y: number }> {
  if (pattern === "generator_verifier") {
    return [
      { x: 70, y: 94 },
      { x: 295, y: 94 },
      { x: 520, y: 94 },
    ];
  }

  if (pattern === "agent_teams") {
    return [
      { x: 80, y: 40 },
      { x: 305, y: 34 },
      { x: 530, y: 40 },
      { x: 305, y: 146 },
    ];
  }

  if (pattern === "message_bus") {
    return [
      { x: 40, y: 92 },
      { x: 220, y: 36 },
      { x: 390, y: 92 },
      { x: 560, y: 36 },
      { x: 720, y: 92 },
    ];
  }

  if (pattern === "shared_state") {
    return [
      { x: 40, y: 92 },
      { x: 220, y: 30 },
      { x: 390, y: 92 },
      { x: 560, y: 30 },
      { x: 720, y: 92 },
    ];
  }

  if (count <= 4) {
    return [
      { x: 70, y: 92 },
      { x: 270, y: 52 },
      { x: 480, y: 32 },
      { x: 480, y: 148 },
    ];
  }

  return [
    { x: 48, y: 92 },
    { x: 235, y: 68 },
    { x: 420, y: 30 },
    { x: 420, y: 144 },
    { x: 615, y: 92 },
  ];
}

function formatClock(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function formatElapsed(start: number, timestamp: number): string {
  const totalSeconds = Math.max(0, Math.round((timestamp - start) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function snapshotPendingApprovals(snapshot: OraStateSnapshot): string[] {
  if (snapshot.attention?.kind !== "needs_approval") {
    return [];
  }
  const durableIds = new Set(snapshot.attention.pendingActionIds);
  return Array.isArray(snapshot.pendingApprovals)
    ? snapshot.pendingApprovals.filter((actionId) => durableIds.has(actionId))
    : [...durableIds];
}

function snapshotPendingClarifications(
  snapshot: OraStateSnapshot,
): OraStateSnapshot["pendingClarifications"] {
  if (snapshot.attention?.kind !== "needs_clarification") {
    return [];
  }
  const durableIds = new Set(snapshot.attention.pendingClarificationIds);
  return Array.isArray(snapshot.pendingClarifications)
    ? snapshot.pendingClarifications.filter((clarification) => durableIds.has(clarification.id))
    : [];
}

function extractAttachmentsFromSnapshot(
  context: Record<string, unknown> | undefined,
): ChatMessageAttachment[] | undefined {
  if (!context) return undefined;
  const attachments: ChatMessageAttachment[] = [];

  const projectFiles = context.attachedProjectFiles;
  if (Array.isArray(projectFiles)) {
    for (const file of projectFiles) {
      if (file && typeof file === "object" && typeof (file as Record<string, unknown>).name === "string") {
        attachments.push({
          name: (file as Record<string, string>).name,
          path: (file as Record<string, string>).path ?? (file as Record<string, string>).name,
          mimeType: (file as Record<string, string>).mimeType ?? "application/octet-stream",
          sizeBytes: typeof (file as Record<string, number>).sizeBytes === "number" ? (file as Record<string, number>).sizeBytes : 0,
        });
      }
    }
  }

  const localFiles = context.attachedLocalFiles;
  if (Array.isArray(localFiles)) {
    for (const file of localFiles) {
      if (file && typeof file === "object" && typeof (file as Record<string, unknown>).name === "string") {
        attachments.push({
          name: (file as Record<string, string>).name,
          path: (file as Record<string, string>).path ?? (file as Record<string, string>).name,
          mimeType: (file as Record<string, string>).mimeType ?? "application/octet-stream",
          sizeBytes: typeof (file as Record<string, number>).sizeBytes === "number" ? (file as Record<string, number>).sizeBytes : 0,
        });
      }
    }
  }

  return attachments.length > 0 ? attachments : undefined;
}

export function adaptChatMessages(
  transcript: OraSessionTranscriptMessage[],
  turnSnapshots: Record<string, OraStateSnapshot | undefined> = {},
  liveMessageDeltas: Record<string, LiveMessageDeltaPreview> = {},
): ChatMessage[] {
  const grouped = new Map<
    string,
    {
      runId: string;
      turnIndex: number;
      pattern?: CoordinationPattern;
      user?: OraSessionTranscriptMessage;
      assistant?: OraSessionTranscriptMessage;
      snapshot?: OraStateSnapshot;
    }
  >();

  for (const message of transcript) {
    const current = grouped.get(message.runId) ?? {
      runId: message.runId,
      turnIndex: message.turnIndex,
      pattern: message.pattern,
      snapshot: turnSnapshots[message.runId],
    };

    if (message.role === "user") {
      current.user = message;
    } else if (message.role === "assistant") {
      current.assistant = message;
    }

    grouped.set(message.runId, current);
  }

  for (const [runId, snapshot] of Object.entries(turnSnapshots)) {
    if (!snapshot) continue;
    const current = grouped.get(runId) ?? {
      runId,
      turnIndex: snapshot.turnIndex ?? 1,
      pattern: snapshot.pattern,
    };
    current.snapshot = snapshot;
    current.turnIndex = current.turnIndex ?? snapshot.turnIndex ?? 1;
    current.pattern = current.pattern ?? snapshot.pattern;
    grouped.set(runId, current);
  }

  return [...grouped.values()]
    .sort((left, right) => left.turnIndex - right.turnIndex)
    .flatMap((turn) => {
      const messages: ChatMessage[] = [];

      const attachments = turn.snapshot
        ? extractAttachmentsFromSnapshot(turn.snapshot.input.context as Record<string, unknown> | undefined)
        : undefined;

      if (turn.user) {
        messages.push({
          id: turn.user.id,
          role: "user",
          content: turn.user.content,
          timestamp: formatClock(turn.user.createdAt),
          metadata: {
            runId: turn.user.runId,
            turnIndex: turn.user.turnIndex,
            pattern: turn.user.pattern,
          },
          attachments,
        });
      } else if (turn.snapshot?.input.prompt.trim()) {
        messages.push({
          id: `${turn.runId}:user-pending`,
          role: "user",
          content: turn.snapshot.input.prompt,
          timestamp: formatClock(turn.snapshot.input.createdAt ?? turn.snapshot.updatedAt),
          metadata: {
            runId: turn.runId,
            turnIndex: turn.turnIndex,
            pattern: turn.pattern,
          },
          attachments,
        });
      }

      const liveAssistantText = turn.snapshot
        ? liveAssistantTextForSnapshot(turn.snapshot, liveMessageDeltas)
        : undefined;
      const liveAssistantPlan = liveAssistantText
        ? parseProposedPlan(liveAssistantText)
        : undefined;
      const canDisplayLivePlanBody = liveAssistantPlan
        ? liveAssistantPlan.status === "streaming" || liveAssistantPlan.hasCompletePlan
        : false;
      const assistantTurn = turn.snapshot
        ? buildAssistantTurnAttachment(turn.snapshot, canDisplayLivePlanBody ? liveAssistantPlan : undefined)
        : undefined;
      const rawAssistantText = turn.snapshot
        ? liveAssistantText ?? assistantTextFromSnapshot(turn.snapshot)
        : undefined;
      const snapshotProposedPlan = !canDisplayLivePlanBody && turn.snapshot
        ? proposedPlanFromSnapshot(turn.snapshot)
        : undefined;
      const parsedAssistantPlan = !snapshotProposedPlan && !canDisplayLivePlanBody && rawAssistantText
        ? parseProposedPlan(rawAssistantText)
        : undefined;
      const canDisplayPlanBody = parsedAssistantPlan
        ? parsedAssistantPlan.status === "streaming" || parsedAssistantPlan.hasCompletePlan
        : false;
      const snapshotAssistant = canDisplayLivePlanBody
        ? liveAssistantPlan?.planContent
        : snapshotProposedPlan
        ? snapshotProposedPlan.planContent
        : parsedAssistantPlan && canDisplayPlanBody
          ? parsedAssistantPlan.planContent
          : parsedAssistantPlan?.displayText;
      const suppressStoredAssistant = turn.snapshot
        ? shouldSuppressStoredAssistantFallback(turn.snapshot)
        : false;
      if (turn.assistant || assistantTurn) {
        messages.push({
          id: turn.assistant?.id ?? `${turn.runId}:assistant-pending`,
          role: "assistant",
          content:
            snapshotAssistant ??
            (suppressStoredAssistant ? undefined : turn.assistant?.content) ??
            placeholderAssistantCopy(turn.snapshot),
          timestamp: formatClock(
            turn.assistant?.createdAt ?? turn.snapshot?.updatedAt ?? Date.now(),
          ),
          metadata: {
            runId: turn.runId,
            turnIndex: turn.turnIndex,
            pattern: turn.pattern,
          },
          turn: assistantTurn,
          clarificationOptions: turn.snapshot
            ? clarificationOptionsFromSnapshot(turn.snapshot)
            : undefined,
          isPlaceholder:
            !turn.assistant &&
            (!assistantTurn || assistantTurn.status === "running"),
        });
      }

      return messages;
    });
}

export function adaptPendingRunMessages(
  pendingRun: PendingRunPreview | undefined,
): ChatMessage[] {
  if (!pendingRun || !pendingRun.prompt.trim()) {
    return [];
  }

  return [
    {
      id: `${pendingRun.sessionId}:pending:user`,
      role: "user",
      content: pendingRun.prompt,
      timestamp: formatClock(pendingRun.createdAt),
    },
    {
      id: `${pendingRun.sessionId}:pending:assistant`,
      role: "assistant",
      content: pendingRun.progressText?.trim() || "",
      timestamp: formatClock(pendingRun.createdAt),
      isPlaceholder: true,
    },
  ];
}

export function adaptRenderableChatMessages(params: {
  transcript: OraSessionTranscriptMessage[];
  turnSnapshots?: Record<string, OraStateSnapshot | undefined>;
  pendingRun?: PendingRunPreview | undefined;
  liveMessageDeltas?: Record<string, LiveMessageDeltaPreview>;
  selectedSessionId?: string;
  baseMessages?: ChatMessage[];
}): ChatMessage[] {
  const turnSnapshots = params.turnSnapshots ?? {};
  const baseMessages = params.baseMessages ?? adaptChatMessages(
    params.transcript,
    turnSnapshots,
  );
  const messages = overlayLiveMessageDeltas(
    baseMessages,
    turnSnapshots,
    params.liveMessageDeltas ?? {},
  );
  const pendingRun = params.pendingRun;
  if (!pendingRun || pendingRun.sessionId !== params.selectedSessionId) {
    return messages;
  }
  const runAlreadyMaterialized = pendingRunAlreadyMaterialized(
    pendingRun,
    turnSnapshots,
  );
  if (runAlreadyMaterialized) {
    return messages;
  }
  return [...messages, ...adaptPendingRunMessages(pendingRun)];
}

function pendingRunAlreadyMaterialized(
  pendingRun: PendingRunPreview,
  turnSnapshots: Record<string, OraStateSnapshot | undefined>,
): boolean {
  if (!pendingRun.runId) {
    return false;
  }
  const snapshot = turnSnapshots[pendingRun.runId];
  return Boolean(
    snapshot?.sessionId === pendingRun.sessionId &&
      (snapshot.status === "queued" || snapshot.status === "running"),
  );
}

function overlayLiveMessageDeltas(
  messages: ChatMessage[],
  turnSnapshots: Record<string, OraStateSnapshot | undefined>,
  liveMessageDeltas: Record<string, LiveMessageDeltaPreview>,
): ChatMessage[] {
  if (Object.keys(liveMessageDeltas).length === 0) {
    return messages;
  }
  let changed = false;
  const next = messages.map((message) => {
    if (message.role !== "assistant") {
      return message;
    }
    const runId = message.metadata?.runId ?? message.turn?.runId;
    const snapshot = runId ? turnSnapshots[runId] : undefined;
    if (!snapshot) {
      return message;
    }
    const liveEntries = liveAssistantEntriesForSnapshot(snapshot, liveMessageDeltas);
    const liveText = liveEntries.at(-1)?.content;
    const nextTurn = message.turn && liveEntries.length > 0
      ? overlayLiveTimelineItems(message.turn, snapshot, liveEntries)
      : message.turn;
    const contentChanged = Boolean(liveText && message.content !== liveText);
    const turnChanged = nextTurn !== message.turn;
    if (!contentChanged && !turnChanged) {
      return message;
    }
    changed = true;
    return {
      ...message,
      content: contentChanged ? liveText! : message.content,
      turn: nextTurn,
    };
  });
  return changed ? next : messages;
}

export function isSessionProcessing(
  session: Pick<SessionRun, "id" | "status"> | undefined,
  pendingRun: PendingRunPreview | undefined,
): boolean {
  return Boolean(
    session &&
    (session.status === "running" || pendingRun?.sessionId === session.id),
  );
}

export function assistantTextFromSnapshot(
  snapshot: OraStateSnapshot,
): string | undefined {
  if (snapshot.status === "cancelled") {
    return cancelledTextFromSnapshot(snapshot);
  }
  const outputText = outputTextFromSnapshot(snapshot);
  if (outputText) {
    return outputText;
  }
  if (hasRejectedFinalToolCall(snapshot)) {
    return undefined;
  }
  const approvalText = approvalPendingTextFromSnapshot(snapshot);
  if (approvalText) {
    return approvalText;
  }
  const streamingText = streamingAssistantTextFromSnapshot(snapshot);
  if (streamingText) {
    return streamingText;
  }
  if (
    snapshot.status === "queued" ||
    snapshot.status === "running"
  ) {
    if (
      snapshotPendingClarifications(snapshot).length > 0 ||
      snapshotPendingApprovals(snapshot).length > 0
    ) {
      return undefined;
    }
    return undefined;
  }
  if (snapshot.status === "interrupted") {
    return undefined;
  }

  for (let index = snapshot.events.length - 1; index >= 0; index -= 1) {
    const event = snapshot.events[index];
    if (!isPublicAssistantDelta(snapshot, event)) {
      continue;
    }
    const content = event.payload.content;
    if (typeof content === "string" && content.trim()) {
      return content;
    }
  }
  return undefined;
}

function streamingAssistantTextFromSnapshot(snapshot: OraStateSnapshot): string | undefined {
  if (snapshot.pattern === "generator_verifier") {
    return undefined;
  }
  if (snapshot.status !== "queued" && snapshot.status !== "running") {
    return undefined;
  }
  const parts: string[] = [];
  let activeMessageKey: string | undefined;
  for (const event of snapshot.events) {
    if (!isPublicAssistantDelta(snapshot, event)) {
      continue;
    }
    const messageKey = assistantDeltaMessageKey(event);
    if (activeMessageKey !== undefined && messageKey !== activeMessageKey) {
      parts.length = 0;
    }
    activeMessageKey = messageKey;
    mergeAssistantTextParts(parts, event);
  }
  const text = parts.join("");
  if (text.trim() && !isInternalAssistantText(text)) {
    return text;
  }
  return undefined;
}

function liveAssistantTextForSnapshot(
  snapshot: OraStateSnapshot,
  liveMessageDeltas: Record<string, LiveMessageDeltaPreview>,
): string | undefined {
  return liveAssistantEntriesForSnapshot(snapshot, liveMessageDeltas).at(-1)?.content;
}

function liveAssistantEntriesForSnapshot(
  snapshot: OraStateSnapshot,
  liveMessageDeltas: Record<string, LiveMessageDeltaPreview>,
): LiveMessageDeltaPreview[] {
  if (snapshot.status !== "queued" && snapshot.status !== "running") {
    return [];
  }
  return Object.values(liveMessageDeltas)
    .filter((entry) =>
      entry.runId === snapshot.runId &&
      entry.role === "assistant" &&
      entry.content.trim() &&
      (!entry.sessionId || !snapshot.sessionId || entry.sessionId === snapshot.sessionId)
    )
    .sort((left, right) =>
      left.updatedAt - right.updatedAt ||
      left.createdAt - right.createdAt ||
      left.messageId.localeCompare(right.messageId)
    );
}

/**
 * Phase 3.1: memoize timeline projection per snapshot reference.
 *
 * During streaming, `overlayLiveMessageDeltas` is called for every delta (1-3 chars).
 * Without caching, each call rebuilds the entire `deriveRuntimeTimelineProjection(snapshot)`
 * which is O(events) — and at 1.25s/3char on long runs, this is the dominant cost in
 * frame budget.
 *
 * Because snapshots are immutable when streaming (turnSnapshots is replaced wholesale,
 * not mutated), keying by identity is safe.
 */
const projectionCache = new WeakMap<
  OraStateSnapshot,
  ReturnType<typeof deriveRuntimeTimelineProjection>
>();

type SnapshotAssistantOverlayIndex = {
  eventTimeBySeq: ReadonlyMap<number, number>;
  firstAssistantEventSeqByMessageKey: ReadonlyMap<string, number>;
};

const snapshotAssistantOverlayIndexCache = new WeakMap<
  OraStateSnapshot,
  SnapshotAssistantOverlayIndex
>();

function cachedTimelineProjection(snapshot: OraStateSnapshot) {
  const cached = projectionCache.get(snapshot);
  if (cached) return cached;
  const fresh = deriveRuntimeTimelineProjection(snapshot);
  projectionCache.set(snapshot, fresh);
  return fresh;
}

function cachedSnapshotAssistantOverlayIndex(
  snapshot: OraStateSnapshot,
  projection = cachedTimelineProjection(snapshot),
): SnapshotAssistantOverlayIndex {
  const cached = snapshotAssistantOverlayIndexCache.get(snapshot);
  if (cached) {
    return cached;
  }
  const eventTimeBySeq = new Map<number, number>();
  const firstAssistantEventSeqByMessageKey = new Map<string, number>();
  for (const event of projection.events) {
    eventTimeBySeq.set(event.seq, event.createdAt);
    if (!isPublicAssistantDelta(snapshot, event)) {
      continue;
    }
    const messageKey = assistantDeltaMessageKey(event);
    if (!firstAssistantEventSeqByMessageKey.has(messageKey)) {
      firstAssistantEventSeqByMessageKey.set(messageKey, event.seq);
    }
  }
  const index = {
    eventTimeBySeq,
    firstAssistantEventSeqByMessageKey,
  } satisfies SnapshotAssistantOverlayIndex;
  snapshotAssistantOverlayIndexCache.set(snapshot, index);
  return index;
}

function overlayLiveTimelineItems(
  turn: AssistantTurnAttachment,
  snapshot: OraStateSnapshot,
  liveEntries: LiveMessageDeltaPreview[],
): AssistantTurnAttachment {
  const existingItems = turn.timelineItems ?? [];
  let nextItems = existingItems;
  const projection = cachedTimelineProjection(snapshot);
  const overlayIndex = cachedSnapshotAssistantOverlayIndex(snapshot, projection);

  for (const entry of liveEntries) {
    const content = timelineTextExcludingProposedPlan(entry.content);
    if (!content || isInternalAssistantText(content)) {
      continue;
    }
    const snapshotItemIndex = findSnapshotAssistantTimelineItemIndexForLiveEntry(
      snapshot,
      nextItems,
      entry,
      overlayIndex.firstAssistantEventSeqByMessageKey,
    );
    if (snapshotItemIndex >= 0) {
      const existing = nextItems[snapshotItemIndex];
      if (existing?.kind !== "assistant_text" || existing.content === content) {
        continue;
      }
      if (!shouldReplaceSnapshotAssistantTextWithLiveContent(existing.content, content)) {
        continue;
      }
      if (nextItems === existingItems) {
        nextItems = [...existingItems];
      }
      nextItems[snapshotItemIndex] = {
        ...existing,
        content,
        agentId: existing.agentId ?? entry.agentId,
        agentLabel: existing.agentLabel ?? agentLabelForTimeline(projection.agentLabels, entry.agentId),
      };
      continue;
    }
    if (isTimelineTextAlreadyRepresented(content, nextItems)) {
      continue;
    }
    if (nextItems === existingItems) {
      nextItems = [...existingItems];
    }
    nextItems = insertLiveTimelineItemByCreatedAt(nextItems, overlayIndex.eventTimeBySeq, entry.createdAt, {
      id: `${snapshot.runId}:timeline:live:${entry.messageId}`,
      kind: "assistant_text",
      content,
      timestamp: formatElapsed(projection.baseTime, entry.createdAt),
      agentId: entry.agentId,
      agentLabel: agentLabelForTimeline(projection.agentLabels, entry.agentId),
    });
  }

  return nextItems === existingItems ? turn : { ...turn, timelineItems: nextItems };
}

function insertLiveTimelineItemByCreatedAt(
  items: TurnTimelineItem[],
  eventTimeBySeq: ReadonlyMap<number, number>,
  createdAt: number,
  item: TurnTimelineItem,
): TurnTimelineItem[] {
  const index = items.findIndex((existing) => {
    const eventSeq = existing.eventSeq;
    if (eventSeq === undefined) {
      return existing.kind === "final_text";
    }
    const existingCreatedAt = eventTimeBySeq.get(eventSeq);
    return existingCreatedAt !== undefined && existingCreatedAt > createdAt;
  });
  if (index < 0) {
    items.push(item);
  } else {
    items.splice(index, 0, item);
  }
  return items;
}

function shouldReplaceSnapshotAssistantTextWithLiveContent(
  existingContent: string,
  liveContent: string,
): boolean {
  const existing = timelineTextExcludingProposedPlan(existingContent);
  const live = timelineTextExcludingProposedPlan(liveContent);
  if (!existing || !live || existing === live) {
    return false;
  }
  return live.length > existing.length && live.startsWith(existing);
}

function findSnapshotAssistantTimelineItemIndexForLiveEntry(
  snapshot: OraStateSnapshot,
  items: readonly TurnTimelineItem[],
  entry: LiveMessageDeltaPreview,
  firstAssistantEventSeqByMessageKey: ReadonlyMap<string, number>,
): number {
  const firstSnapshotEventSeq = firstAssistantEventSeqByMessageKey.get(entry.messageId);
  if (firstSnapshotEventSeq === undefined) {
    return -1;
  }
  const expectedItemId = assistantTimelineItemId(snapshot.runId, firstSnapshotEventSeq);
  return items.findIndex((item) =>
    item.kind === "assistant_text" &&
    (item.eventSeq === firstSnapshotEventSeq || item.id === expectedItemId)
  );
}

function assistantTimelineItemId(runId: string, eventSeq: number): string {
  return `${runId}:timeline:assistant:${eventSeq}`;
}

function mergeAssistantTextParts(parts: string[], event: OraEventEnvelope & { payload: Record<string, unknown> }): void {
  const projection = mergeAssistantMessageTextProjection(
    parts.length > 0 ? { text: parts.join("") } : undefined,
    event.payload,
  );
  parts.length = 0;
  if (projection?.text) {
    parts.push(projection.text);
  }
}

function assistantDeltaMessageKey(event: OraEventEnvelope & { payload: Record<string, unknown> }): string {
  const messageId = typeof event.payload.messageId === "string" && event.payload.messageId.trim()
    ? event.payload.messageId.trim()
    : undefined;
  return messageId ?? `${event.agentId ?? "__default__"}:${event.nodeId ?? "__default__"}`;
}

function isFinalAssistantDelta(event: OraEventEnvelope & { payload: Record<string, unknown> }): boolean {
  return event.payload.phase === "final" || event.payload.streaming === false;
}

function isExplicitStreamingAssistantDelta(event: OraEventEnvelope & { payload: Record<string, unknown> }): boolean {
  return event.payload.phase === "stream" || event.payload.streaming === true;
}

function extractClarificationQuestions(
  snapshot: OraStateSnapshot,
): Array<{ id: string; question: string; requestedAt: number }> {
  const results: Array<{ id: string; question: string; requestedAt: number }> = [];
  for (const clarification of snapshot.pendingClarifications ?? []) {
    if (!results.some((r) => r.id === clarification.id)) {
      results.push({
        id: clarification.id,
        question: clarification.question,
        requestedAt: clarification.requestedAt,
      });
    }
  }
  for (const event of snapshot.events) {
    if (event.type !== "clarification.required" || !isRecord(event.payload) || !isRecord(event.payload.clarification)) continue;
    const id = typeof event.payload.clarification.id === "string" ? event.payload.clarification.id : undefined;
    const question = typeof event.payload.clarification.question === "string" ? event.payload.clarification.question.trim() : undefined;
    if (!id || !question) continue;
    if (!results.some((r) => r.id === id)) {
      results.push({ id, question, requestedAt: event.createdAt });
    }
  }
  return results;
}

function extractClarificationAnswers(
  snapshot: OraStateSnapshot,
): Array<{ id: string; answer: string; answeredAt: number }> {
  const results: Array<{ id: string; answer: string; answeredAt: number }> = [];
  for (const event of snapshot.events) {
    if (event.type !== "clarification.resolved" || !isRecord(event.payload)) continue;
    const answer = typeof event.payload.answer === "string" ? event.payload.answer.trim() : undefined;
    const clarificationId = typeof event.payload.clarificationId === "string" ? event.payload.clarificationId : undefined;
    if (!answer || !clarificationId) continue;
    const existingIndex = results.findIndex((r) => r.id === clarificationId);
    if (existingIndex >= 0) {
      results[existingIndex] = { id: clarificationId, answer, answeredAt: event.createdAt };
    } else {
      results.push({ id: clarificationId, answer, answeredAt: event.createdAt });
    }
  }
  return results;
}

function clarificationTextFromSnapshot(snapshot: OraStateSnapshot): string | undefined {
  const clarifications = snapshotPendingClarifications(snapshot);
  if (clarifications.length > 0) {
    const questions = clarifications
      .map((c) => c.question.trim())
      .filter(Boolean);
    if (questions.length > 0) {
      return questions.join("\n");
    }
  }
  for (let index = snapshot.events.length - 1; index >= 0; index -= 1) {
    const event = snapshot.events[index];
    if (event?.type !== "clarification.required" || !isRecord(event.payload) || !isRecord(event.payload.clarification)) {
      continue;
    }
    const question = event.payload.clarification.question;
    if (typeof question === "string" && question.trim()) {
      return question.trim();
    }
  }
  return undefined;
}

function clarificationOptionsFromSnapshot(snapshot: OraStateSnapshot): ClarificationOption[] | undefined {
  const clarifications = snapshotPendingClarifications(snapshot);
  for (const c of clarifications) {
    const normalized = normalizeClarificationOptions(c.options);
    if (normalized.length > 0) return normalized;
  }
  for (let index = snapshot.events.length - 1; index >= 0; index -= 1) {
    const event = snapshot.events[index];
    if (event?.type !== "clarification.required" || !isRecord(event.payload) || !isRecord(event.payload.clarification)) {
      continue;
    }
    const normalized = normalizeClarificationOptions(event.payload.clarification.options);
    if (normalized.length > 0) {
      return normalized;
    }
  }
  return undefined;
}

function normalizeClarificationOptions(value: unknown): ClarificationOption[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item): ClarificationOption[] => {
    if (!isRecord(item)) {
      return [];
    }
    const id = typeof item.id === "string" && item.id.trim() ? item.id.trim() : undefined;
    const label = typeof item.label === "string" && item.label.trim() ? item.label.trim() : undefined;
    if (!id || !label) {
      return [];
    }
    const option: ClarificationOption = { id, label };
    if (typeof item.value === "string" && item.value.trim()) {
      option.value = item.value.trim();
    }
    if (typeof item.description === "string" && item.description.trim()) {
      option.description = item.description.trim();
    }
    return [option];
  });
}

function approvalPendingTextFromSnapshot(snapshot: OraStateSnapshot): string | undefined {
  if (snapshotPendingApprovals(snapshot).length === 0) {
    return undefined;
  }

  return approvalRequestTextFromSnapshot(snapshot);
}

function approvalRequestTextFromSnapshot(snapshot: OraStateSnapshot): string | undefined {
  const pendingIds = new Set(snapshotPendingApprovals(snapshot));
  const pendingAction = snapshot.actions.find((action) => pendingIds.has(action.id));
  const summary = pendingAction?.approvalRequest?.summary;
  return typeof summary === "string" && summary.trim()
    ? summary.trim()
    : undefined;
}

function outputTextFromSnapshot(
  snapshot: OraStateSnapshot,
): string | undefined {
  if (typeof snapshot.output === "string" && snapshot.output.trim()) {
    const output = snapshot.output.trim();
    return isInternalRecoveryFallbackText(output) ? undefined : output;
  }
  if (
    isRecord(snapshot.output) &&
    typeof snapshot.output.text === "string" &&
    snapshot.output.text.trim()
  ) {
    const output = snapshot.output.text.trim();
    return isInternalRecoveryFallbackText(output) ? undefined : output;
  }
  return undefined;
}

function isInternalVerifierDelta(
  snapshot: OraStateSnapshot,
  event: OraEventEnvelope,
): boolean {
  if (snapshot.pattern !== "generator_verifier") {
    return false;
  }
  const agentId = typeof event.agentId === "string" ? event.agentId : undefined;
  const nodeId = typeof event.nodeId === "string" ? event.nodeId : undefined;
  return agentId === "verifier" || nodeId === "verifier";
}

function isPublicAssistantDelta(
  snapshot: OraStateSnapshot,
  event: OraEventEnvelope | undefined,
): event is OraEventEnvelope & { payload: Record<string, unknown> } {
  return Boolean(
    event?.type === "message.delta" &&
    isRecord(event.payload) &&
    !isInternalAssistantDelta(snapshot, event),
  );
}

function isInternalAssistantDelta(
  snapshot: OraStateSnapshot,
  event: OraEventEnvelope,
): boolean {
  if (isInternalVerifierDelta(snapshot, event)) {
    return true;
  }
  if (!isRecord(event.payload)) {
    return false;
  }
  if (
    event.payload.visibility === "internal" ||
    event.payload.audience === "internal" ||
    event.payload.public === false
  ) {
    return true;
  }
  const text = assistantDeltaText(event);
  return isInternalRecoveryFallbackText(text) || isInternalAssistantText(text);
}

function assistantDeltaText(event: OraEventEnvelope): string {
  if (!isRecord(event.payload)) {
    return "";
  }
  const delta = typeof event.payload.delta === "string" ? event.payload.delta : "";
  const content = typeof event.payload.content === "string" ? event.payload.content : "";
  return delta || content;
}

function isInternalAssistantText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }
  if (/<\/?tool_plan_mode_reminder\b|<\/?file_grep_policy\b/i.test(trimmed)) {
    return true;
  }
  if (/<[^>]*DSML[^>]*tool_calls|<tool_call\b|parameter\s+name=|<\/?previous_tool_call\b|<\/?result\b/i.test(trimmed)) {
    return true;
  }
  if (/<file\.(?:read|list|grep|glob)\b[^>]*\/?>/i.test(trimmed)) {
    return true;
  }
  return /^\{"tool"\s*:\s*"[a-z0-9_.-]+"\s*,\s*"args"\s*:/i.test(trimmed);
}

function isInternalRecoveryFallbackText(text: string): boolean {
  const trimmed = text.trim();
  return (
    trimmed.startsWith("[tool-error-boundary]") ||
    trimmed.startsWith("[recovery:fallback]")
  );
}

function hasRejectedFinalToolCall(snapshot: OraStateSnapshot): boolean {
  return snapshot.events.some(
    (event) =>
      event.type === "completion.updated" &&
      isRecord(event.payload) &&
      event.payload.state === "tool_call_text_rejected",
  );
}

function shouldSuppressStoredAssistantFallback(snapshot: OraStateSnapshot): boolean {
  return (
    hasRejectedFinalToolCall(snapshot) ||
    snapshot.status === "interrupted" ||
    snapshotPendingApprovals(snapshot).length > 0
  );
}

const turnAttachmentCache = new WeakMap<OraStateSnapshot, AssistantTurnAttachment>();

function extractWebSources(snapshot: OraStateSnapshot): CitationSource[] {
  const seen = new Set<string>();
  const sources: CitationSource[] = [];

  for (const call of snapshot.toolCalls ?? []) {
    if (call.status !== "succeeded") continue;
    const output = call.result?.output;
    if (!isRecord(output)) continue;

    if (call.toolId === "web.search") {
      const results = Array.isArray(output.results) ? output.results : [];
      for (const item of results) {
        if (!isRecord(item)) continue;
        const url = typeof item.url === "string" ? item.url.trim() : "";
        if (!url) continue;
        const normalized = normalizeUrl(url);
        if (normalized && !seen.has(normalized)) {
          seen.add(normalized);
          sources.push({
            url: normalized,
            title: typeof item.title === "string" ? item.title : undefined,
          });
        }
      }
    } else if (call.toolId === "web.fetch") {
      const url = typeof output.url === "string" ? output.url.trim() : "";
      if (!url) continue;
      const normalized = normalizeUrl(url);
      if (normalized && !seen.has(normalized)) {
        seen.add(normalized);
        sources.push({
          url: normalized,
          title: typeof output.title === "string" ? output.title : undefined,
        });
      }
    }
  }

  return sources;
}

function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = "";
    return u.toString();
  } catch {
    return raw;
  }
}

function buildAssistantTurnAttachment(
  snapshot: OraStateSnapshot,
  liveProposedPlan?: ReturnType<typeof parseProposedPlan>,
): AssistantTurnAttachment {
  if (!liveProposedPlan) {
    const cached = turnAttachmentCache.get(snapshot);
    if (cached) return cached;
  }

  const timelineProjection = cachedTimelineProjection(snapshot);
  const processSteps = deriveProcessSteps(snapshot, timelineProjection);
  const proposedPlan = liveProposedPlan ?? proposedPlanFromSnapshot(snapshot);
  const status = adaptSnapshotRunStatus(snapshot);
  const timelineItems = deriveTimelineItems(snapshot, processSteps, timelineProjection, proposedPlan);
  const result: AssistantTurnAttachment = {
    runId: snapshot.runId,
    turnIndex: snapshot.turnIndex ?? 1,
    status,
    pattern: snapshot.pattern,
    currentAgentLabel: currentAgentLabelFromSnapshot(snapshot),
    liveProgressText: undefined,
    processSteps,
    timelineItems,
    clarificationExchanges: deriveClarificationExchanges(snapshot),
    planList: (snapshot.planList ?? []).map((item) => ({
      step: item.step,
      status: item.status,
    })),
    agentMessages: deriveAgentMessages(snapshot),
    artifacts: userVisibleArtifacts(snapshot.artifacts).map(adaptTurnArtifact),
    fileChanges: userVisibleArtifacts(snapshot.artifacts).flatMap(adaptTurnFileChange),
    sources: extractWebSources(snapshot),
    todos: [],
    approvalCount: snapshotPendingApprovals(snapshot).length,
    clarificationCount: snapshotPendingClarifications(snapshot).length,
    hasProposedPlan: Boolean(proposedPlan),
    proposedPlanStatus: proposedPlan?.status === "streaming" ? "streaming" : proposedPlan ? "complete" : undefined,
    planContent: proposedPlan?.planContent,
    activeLoadingTarget: activeLoadingTargetFromSnapshot(snapshot, status, timelineItems),
  };
  if (!liveProposedPlan) {
    turnAttachmentCache.set(snapshot, result);
  }
  return result;
}

function activeLoadingTargetFromSnapshot(
  snapshot: OraStateSnapshot,
  status: RunStatus,
  timelineItems: TurnTimelineItem[],
): AssistantTurnActiveLoadingTarget | undefined {
  if (status !== "running") {
    return undefined;
  }
  if (
    snapshotPendingClarifications(snapshot).length > 0 ||
    snapshotPendingApprovals(snapshot).length > 0
  ) {
    return undefined;
  }
  const timelineLoadingItemId = latestTimelineLoadingItemId(timelineItems);
  if (timelineLoadingItemId) {
    return { kind: "timeline", itemId: timelineLoadingItemId };
  }
  return { kind: "thinking" };
}

function latestTimelineLoadingItemId(items: TurnTimelineItem[]): string | undefined {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item?.kind === "status_group" && item.status !== "blocked") {
      return item.id;
    }
  }
  return undefined;
}

function deriveClarificationExchanges(snapshot: OraStateSnapshot): TurnClarificationExchange[] | undefined {
  const questions = extractClarificationQuestions(snapshot);
  if (questions.length === 0) {
    return undefined;
  }

  const answers = new Map(extractClarificationAnswers(snapshot).map((answer) => [answer.id, answer]));
  return questions.map((question) => {
    const answer = answers.get(question.id);
    return {
      id: question.id,
      question: question.question,
      answer: answer?.answer,
      requestedAt: formatClock(question.requestedAt),
      answeredAt: answer ? formatClock(answer.answeredAt) : undefined,
      status: answer ? "resolved" : "pending",
    };
  });
}

function currentAgentLabelFromSnapshot(snapshot: OraStateSnapshot): string {
  const profiles = new Map(snapshot.profiles.map((profile) => [profile.id, profile.label]));
  const latestAgentMessage = [...(snapshot.agentMessages ?? [])].reverse().find((message) =>
    message.fromAgentId !== ORA_ROOT_AGENT_ID &&
    !isRootHandoffScaffoldingMessage(snapshot, message) &&
    !message.transcript &&
    message.kind !== "status" &&
    !isInternalAgentMessage(message)
  );
  if (latestAgentMessage) {
    return profiles.get(latestAgentMessage.fromAgentId) ?? latestAgentMessage.fromAgentId;
  }

  const latestAssistantDeltaAgentId = latestPublicAssistantDeltaAgentId(snapshot);
  if (latestAssistantDeltaAgentId && latestAssistantDeltaAgentId !== ORA_ROOT_AGENT_ID) {
    return profiles.get(latestAssistantDeltaAgentId) ?? latestAssistantDeltaAgentId;
  }

  const handoffTargetAgentId = rootHandoffTargetAgentId(snapshot);
  if (handoffTargetAgentId && hasPublicAssistantDeltaFromAgent(snapshot, handoffTargetAgentId)) {
    return profiles.get(handoffTargetAgentId) ?? handoffTargetAgentId;
  }

  const primaryAgentId = snapshot.profiles.find((profile) => profile.id !== ORA_ROOT_AGENT_ID)?.id;
  if (primaryAgentId) {
    return profiles.get(primaryAgentId) ?? primaryAgentId;
  }

  return profiles.get(ORA_ROOT_AGENT_ID) ?? ORA_ROOT_AGENT_LABEL;
}

function isRootHandoffScaffoldingMessage(
  snapshot: OraStateSnapshot,
  message: OraStateSnapshot["agentMessages"][number],
): boolean {
  return message.threadId === `${snapshot.runId}:ora-handoff`;
}

function rootHandoffTargetAgentId(snapshot: OraStateSnapshot): string | undefined {
  const handoffMessage = (snapshot.agentMessages ?? []).find((message) =>
    message.fromAgentId === ORA_ROOT_AGENT_ID &&
    message.threadId === `${snapshot.runId}:ora-handoff` &&
    message.kind === "handoff"
  );
  return handoffMessage?.toAgentIds.find((agentId) => agentId !== ORA_ROOT_AGENT_ID);
}

function hasPublicAssistantDeltaFromAgent(snapshot: OraStateSnapshot, agentId: string): boolean {
  return snapshot.events.some((event) =>
    event.agentId === agentId &&
    isPublicAssistantDelta(snapshot, event) &&
    assistantDeltaText(event).trim().length > 0
  );
}

function latestPublicAssistantDeltaAgentId(snapshot: OraStateSnapshot): string | undefined {
  for (let index = snapshot.events.length - 1; index >= 0; index -= 1) {
    const event = snapshot.events[index];
    if (
      event?.agentId &&
      isPublicAssistantDelta(snapshot, event) &&
      assistantDeltaText(event).trim().length > 0
    ) {
      return event.agentId;
    }
  }
  return undefined;
}

const proposedPlanCache = new WeakMap<OraStateSnapshot, ReturnType<typeof parseProposedPlan> | null>();

function proposedPlanFromSnapshot(snapshot: OraStateSnapshot): ReturnType<typeof parseProposedPlan> | undefined {
  const cached = proposedPlanCache.get(snapshot);
  if (cached !== undefined) {
    return cached ?? undefined;
  }
  const outputText = outputTextFromSnapshot(snapshot);
  const outputPlan = outputText ? parseProposedPlan(outputText) : undefined;
  if (outputPlan && (outputPlan.status === "streaming" || outputPlan.hasCompletePlan)) {
    proposedPlanCache.set(snapshot, outputPlan);
    return outputPlan;
  }
  const deltaPlan = proposedPlanFromAssistantDeltas(snapshot);
  proposedPlanCache.set(snapshot, deltaPlan ?? null);
  return deltaPlan;
}

function proposedPlanFromAssistantDeltas(snapshot: OraStateSnapshot): ReturnType<typeof parseProposedPlan> | undefined {
  const textByMessage = new Map<string, { text: string; latestSeq: number }>();
  let latestStartedPlan: ReturnType<typeof parseProposedPlan> | undefined;
  for (const event of snapshot.events) {
    if (!isPublicAssistantDelta(snapshot, event)) {
      continue;
    }
    const messageId = typeof event.payload.messageId === "string" && event.payload.messageId.trim()
      ? event.payload.messageId
      : event.agentId ?? "__default__";
    const current = textByMessage.get(messageId);
    const projection = mergeAssistantMessageTextProjection(
      current ? { text: current.text } : undefined,
      event.payload,
    );
    if (projection?.text) {
      textByMessage.set(messageId, { text: projection.text, latestSeq: event.seq });
    }
  }

  for (const { text } of [...textByMessage.values()].sort((left, right) => right.latestSeq - left.latestSeq)) {
    if (!text.includes("<proposed_plan")) {
      continue;
    }
    const parsed = parseProposedPlan(text);
    if (parsed.hasCompletePlan) {
      return parsed;
    } else if (!latestStartedPlan && parsed.status === "streaming") {
      latestStartedPlan = parsed;
    }
  }
  return latestStartedPlan;
}

function deriveAgentMessages(snapshot: OraStateSnapshot): TurnAgentConversationMessage[] {
  const profiles = new Map(snapshot.profiles.map((profile) => [profile.id, profile.label]));
  const deltaCursorByAgent = new Map<string, number>();
  const deltasByAgent = agentMessageDeltasByAgent(snapshot);
  return (snapshot.agentMessages ?? []).filter((message) => !isInternalAgentMessage(message)).map((message) => {
    let deltaContent: string | undefined;
    if (message.content.endsWith("...")) {
      const deltaCursor = deltaCursorByAgent.get(message.fromAgentId) ?? 0;
      deltaContent = deltasByAgent.get(message.fromAgentId)?.[deltaCursor];
      if (deltaContent !== undefined) {
        deltaCursorByAgent.set(message.fromAgentId, deltaCursor + 1);
      }
    }
    return {
      id: message.id,
      fromAgentId: message.fromAgentId,
      fromAgentLabel: profiles.get(message.fromAgentId) ?? message.fromAgentId,
      toAgentIds: message.toAgentIds,
      toAgentLabels: message.toAgentIds.map((agentId) => profiles.get(agentId) ?? agentId),
      replyToId: message.replyToId,
      threadId: message.threadId,
      nodeId: message.nodeId,
      planItemId: message.planItemId,
      kind: message.kind,
      status: message.status,
      content: restoreTruncatedAgentMessageContent(message.content, deltaContent),
      topic: message.topic,
      correlationId: message.correlationId,
      artifactIds: message.artifactIds,
      transcript: message.transcript,
      timestamp: formatClock(message.createdAt),
    };
  });
}

function isInternalAgentMessage(message: OraStateSnapshot["agentMessages"][number]): boolean {
  return (
    message.kind === "publish" ||
    message.kind === "route" ||
    !message.content.trim() ||
    isInternalAssistantText(message.content)
  );
}

function agentMessageDeltasByAgent(snapshot: OraStateSnapshot): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const event of snapshot.events) {
    if (event.type !== "message.delta" || typeof event.agentId !== "string" || !isRecord(event.payload)) {
      continue;
    }
    const content = event.payload.content;
    if (typeof content !== "string" || !content.trim()) {
      continue;
    }
    const existing = result.get(event.agentId) ?? [];
    existing.push(content);
    result.set(event.agentId, existing);
  }
  return result;
}

function restoreTruncatedAgentMessageContent(content: string, fullContent?: string): string {
  if (!content.endsWith("...") || !fullContent?.trim()) {
    return content;
  }
  const normalizedFullContent = fullContent.trim();
  const blockSeparatorIndex = content.lastIndexOf(":\n\n");
  if (blockSeparatorIndex >= 0) {
    return `${content.slice(0, blockSeparatorIndex + 1)}\n\n${normalizedFullContent}`;
  }
  const inlineSeparatorIndex = content.lastIndexOf(": ");
  if (inlineSeparatorIndex >= 0) {
    return `${content.slice(0, inlineSeparatorIndex + 1)}\n\n${normalizedFullContent}`;
  }
  return normalizedFullContent;
}

function deriveProcessSteps(
  snapshot: OraStateSnapshot,
  timelineProjection?: ReturnType<typeof deriveRuntimeTimelineProjection>,
): TurnProcessStep[] {
  const { events, visibleEvents } = visibleProcessEvents(snapshot, timelineProjection);

  const baseTime = events[0]?.createdAt ?? snapshot.updatedAt;

  type TimedStep = { rawTime: number; step: TurnProcessStep };

  const timed: TimedStep[] = visibleEvents.map((event, index) => ({
    rawTime: event.createdAt,
    step: processStepFromEvent(
      event,
      baseTime,
      snapshot.status,
      index === visibleEvents.length - 1,
    ),
  }));

  if (hasDeniedApproval(snapshot)) {
    const deniedAt = latestEventTime(snapshot, "run.cancelled") ?? snapshot.updatedAt;
    timed.push({
      rawTime: deniedAt,
      step: {
        id: `${snapshot.runId}:approval-denied`,
        eventType: "approval.denied",
        label: APPROVAL_DENIED_STEP_LABEL,
        detail: APPROVAL_DENIED_STEP_DETAIL,
        timestamp: formatElapsed(baseTime, deniedAt),
        status: "blocked",
        tone: "warning",
      },
    });
  }

  const profiles = new Map(snapshot.profiles.map((p) => [p.id, p.label]));
  for (const message of snapshot.agentMessages ?? []) {
    if (message.kind !== "handoff" || message.transcript) {
      continue;
    }
    const fromLabel = profiles.get(message.fromAgentId) ?? message.fromAgentId;
    const toLabel = message.toAgentIds
      .map((id) => profiles.get(id) ?? id)
      .join(", ");
    timed.push({
      rawTime: message.createdAt,
      step: {
        id: message.id,
        eventType: "agent.handoff",
        label: `${fromLabel} → ${toLabel}`,
        detail: message.content,
        timestamp: formatElapsed(baseTime, message.createdAt),
        status: handoffStepStatus(message.status),
        tone: "accent",
      },
    });
  }

  return timed.sort((a, b) => a.rawTime - b.rawTime).map((t) => t.step);
}

function visibleProcessEvents(
  snapshot: OraStateSnapshot,
  timelineProjection?: ReturnType<typeof deriveRuntimeTimelineProjection>,
): {
  events: OraEventEnvelope[];
  visibleEvents: OraEventEnvelope[];
} {
  const projection = timelineProjection ?? deriveRuntimeTimelineProjection(snapshot);
  const events = projection.events.filter(shouldShowProcessEvent);
  const hasWorkEvent = events.some(isWorkProcessEvent);
  return {
    events,
    visibleEvents: events.filter(
      (event) => hasWorkEvent || !isLifecycleProcessEvent(event),
    ),
  };
}

function processStepFromEvent(
  event: OraEventEnvelope,
  baseTime: number,
  runStatus: OraStateSnapshot["status"],
  isLatestProcessEvent: boolean,
): TurnProcessStep {
  return {
    id: event.id,
    eventType: event.type,
    label: processStepLabel(event),
    detail: processStepDetail(event),
    timestamp: formatElapsed(baseTime, event.createdAt),
    status: processStepStatus(event, runStatus, isLatestProcessEvent),
    tone: processStepTone(event),
    agentId: event.agentId,
    contextLabel: processContextLabel(event),
  };
}

function deriveTimelineItems(
  snapshot: OraStateSnapshot,
  processSteps: TurnProcessStep[],
  timelineProjection?: ReturnType<typeof deriveRuntimeTimelineProjection>,
  proposedPlanOverride?: ReturnType<typeof parseProposedPlan>,
): TurnTimelineItem[] {
  const projection = timelineProjection ?? deriveRuntimeTimelineProjection(snapshot);
  const { events, visibleEvents } = visibleProcessEvents(snapshot, projection);
  const baseTime = projection.baseTime;
  const finalText = outputTextFromSnapshot(snapshot);
  const hasVisibleProcessSeparators = visibleEvents.some((event) => isWorkProcessEvent(event));
  const proposedPlan = proposedPlanOverride ?? proposedPlanFromSnapshot(snapshot);
  const hasStartedProposedPlan = Boolean(proposedPlan);
  const hasCompleteFinalProposedPlan = proposedPlan?.hasCompletePlan === true;
  const agentLabels = projection.agentLabels;
  const processStepByEventId = new Map(processSteps.map((step) => [step.id, step]));
  const items: Array<{ rawTime: number; eventSeq: number; item: TurnTimelineItem }> = [];
  let pendingSteps: TurnProcessStep[] = [];
  let pendingStartedAt = baseTime;
  let pendingSeq = 0;
  let pendingTextParts: string[] = [];
  let pendingTextStartedAt = baseTime;
  let pendingTextSeq = 0;
  let pendingTextAgentId: string | undefined;
  let pendingTextKey: string | undefined;

  function flushPendingText() {
    const content = timelineTextExcludingProposedPlan(pendingTextParts.join(""));
    const agentId = pendingTextAgentId && pendingTextAgentId !== "__default__"
      ? pendingTextAgentId
      : undefined;
    if (
      !content ||
      isInternalAssistantText(content) ||
      (finalText && isTimelineTextPrefixOfFinalOutput(content, finalText))
    ) {
      pendingTextParts = [];
      pendingTextAgentId = undefined;
      pendingTextKey = undefined;
      return;
    }
    items.push({
      rawTime: pendingTextStartedAt,
      eventSeq: pendingTextSeq,
      item: {
        id: assistantTimelineItemId(snapshot.runId, pendingTextSeq),
        kind: "assistant_text",
        content,
        timestamp: formatElapsed(baseTime, pendingTextStartedAt),
        agentId,
        agentLabel: agentLabelForTimeline(agentLabels, agentId),
        eventSeq: pendingTextSeq,
      },
    });
    pendingTextParts = [];
    pendingTextAgentId = undefined;
    pendingTextKey = undefined;
  }

  function flushPendingSteps() {
    if (pendingSteps.length === 0) {
      return;
    }
    const steps = pendingSteps;
    const agentId = dominantStepAgentId(steps);
    const itemStatus = aggregateStepStatus(steps);
    items.push({
      rawTime: pendingStartedAt,
      eventSeq: pendingSeq,
      item: {
        id: `${snapshot.runId}:timeline:status:${pendingSeq}`,
        kind: "status_group",
        summary: summarizeProcessSteps(steps, snapshot.status),
        steps,
        timestamp: formatElapsed(baseTime, pendingStartedAt),
        status: itemStatus,
        agentId,
        agentLabel: agentLabelForTimeline(agentLabels, agentId),
        eventSeq: pendingSeq,
      },
    });
    pendingSteps = [];
  }

  for (const event of projection.events) {
    if (isPublicAssistantDelta(snapshot, event)) {
      const text = assistantDeltaText(event);
      const shouldCollectText = shouldCollectAssistantDeltaForTimeline(
        event,
        finalText,
        hasVisibleProcessSeparators,
        hasLaterVisibleProcessEvent(event, visibleEvents),
      );
      if (shouldCollectText) {
        const agentId = event.agentId ?? "__default__";
        const textKey = assistantDeltaMessageKey(event);
        const pendingText = pendingTextParts.join("");
        const contentItems = items.map(({ item }) => item);
        const finalDuplicate = isFinalAssistantDelta(event) && (
          (pendingText && isTimelineTextDuplicate(text, pendingText)) ||
          isTimelineTextAlreadyRepresented(text, contentItems)
        );
        if (!finalDuplicate && text) {
          if (
            pendingTextParts.length > 0 &&
            pendingTextKey !== undefined &&
            textKey !== pendingTextKey
          ) {
            flushPendingText();
          }
          pendingTextAgentId = agentId;
          pendingTextKey = textKey;
          if (pendingTextParts.length === 0) {
            pendingTextStartedAt = event.createdAt;
            pendingTextSeq = event.seq;
          }
          mergeAssistantTextParts(pendingTextParts, event);
        }
      }
      if (shouldCollectText) {
        flushPendingSteps();
      }
      continue;
    }

    if (isChatProgressEvent(event)) {
      continue;
    }

    if (event.type === "plan_list.updated") {
      const eventAgentId = inferTimelineEventAgentId(snapshot, event);
      flushPendingText();
      flushPendingSteps();
      items.push({
        rawTime: event.createdAt,
        eventSeq: event.seq,
        item: {
          id: `${event.id}:plan-update`,
          kind: "plan_update",
          summary: planUpdateSummary(event.payload),
          timestamp: formatElapsed(baseTime, event.createdAt),
          agentId: eventAgentId,
          agentLabel: agentLabelForTimeline(agentLabels, eventAgentId),
          eventSeq: event.seq,
        },
      });
      continue;
    }

    if (event.type === "artifact.exported") {
      const eventAgentId = inferTimelineEventAgentId(snapshot, event);
      flushPendingText();
      flushPendingSteps();
      items.push({
        rawTime: event.createdAt,
        eventSeq: event.seq,
        item: {
          id: `${event.id}:artifact`,
          kind: "artifact",
          summary: processStepDetail(event) || processStepLabel(event),
          artifactId: artifactIdFromEvent(event),
          timestamp: formatElapsed(baseTime, event.createdAt),
          agentId: eventAgentId,
          agentLabel: agentLabelForTimeline(agentLabels, eventAgentId),
          eventSeq: event.seq,
        },
      });
      continue;
    }

    if (!visibleEvents.some((visibleEvent) => visibleEvent.id === event.id)) {
      continue;
    }
    const step = processStepByEventId.get(event.id);
    if (!step) {
      continue;
    }
    const eventAgentId = inferTimelineEventAgentId(snapshot, event);
    const effectiveStep = eventAgentId && !step.agentId
      ? { ...step, agentId: eventAgentId }
      : step;
    flushPendingText();
    if (event.type === "completion.updated") {
      flushPendingSteps();
    }
    const stepAgentId = effectiveStep.agentId ?? eventAgentId;
    if (
      pendingSteps.length > 0 &&
      stepAgentId &&
      dominantStepAgentId(pendingSteps) &&
      stepAgentId !== dominantStepAgentId(pendingSteps)
    ) {
      flushPendingSteps();
    }
    if (pendingSteps.length === 0) {
      pendingStartedAt = event.createdAt;
      pendingSeq = event.seq;
    }
    pendingSteps.push(effectiveStep);
  }

  flushPendingText();
  flushPendingSteps();

  for (const [index, message] of (snapshot.agentMessages ?? []).entries()) {
    if (
      message.transcript ||
      message.kind === "status" ||
      (message.kind === "handoff" && message.toAgentIds.length === 0) ||
      isInternalAgentMessage(message)
    ) {
      continue;
    }
    items.push({
      rawTime: message.createdAt,
      eventSeq: Number.MAX_SAFE_INTEGER - 1 + index / 1000,
      item: {
        id: `${message.id}:timeline`,
        kind: "agent_message",
        messageKind: message.kind,
        fromAgentLabel: agentLabels.get(message.fromAgentId) ?? message.fromAgentId,
        toAgentLabels: message.toAgentIds.map((agentId) => agentLabels.get(agentId) ?? agentId),
        content: message.content.trim(),
        timestamp: formatElapsed(baseTime, message.createdAt),
        agentId: message.fromAgentId,
        agentLabel: agentLabels.get(message.fromAgentId) ?? message.fromAgentId,
      },
    });
  }

  const finalIntroText = proposedPlan
    ? timelineTextExcludingProposedPlan(proposedPlan.displayText)
    : undefined;
  if (
    finalIntroText &&
    !isTimelineTextAlreadyRepresented(finalIntroText, items.map(({ item }) => item))
  ) {
    items.push({
      rawTime: snapshot.updatedAt,
      eventSeq: Number.MAX_SAFE_INTEGER - 1,
      item: {
        id: `${snapshot.runId}:timeline:final-intro`,
        kind: "assistant_text",
        content: finalIntroText,
        timestamp: formatElapsed(baseTime, snapshot.updatedAt),
        agentId: finalOutputAgentId(snapshot),
        agentLabel: agentLabelForTimeline(agentLabels, finalOutputAgentId(snapshot)),
      },
    });
  }

  const finalTimelineText = !hasStartedProposedPlan
    ? timelineTextExcludingProposedPlan(finalText ?? "")
    : "";
  if (
    finalTimelineText &&
    !isTimelineTextAlreadyRepresented(finalTimelineText, items.map(({ item }) => item))
  ) {
    items.push({
      rawTime: snapshot.updatedAt,
      eventSeq: Number.MAX_SAFE_INTEGER,
      item: {
        id: `${snapshot.runId}:timeline:final`,
        kind: "final_text",
        content: finalTimelineText,
        timestamp: formatElapsed(baseTime, snapshot.updatedAt),
        agentId: finalOutputAgentId(snapshot),
        agentLabel: agentLabelForTimeline(agentLabels, finalOutputAgentId(snapshot)),
      },
    });
  }

  // Compensation: when timeline has visible items (status_groups etc.) but no
  // assistant_text/final_text, promote the body text into the timeline surface
  // so it renders inside TurnTimeline instead of as a bottom body fallback.
  if (items.length > 0) {
    const hasAssistantOrFinal = items.some(({ item }) =>
      item.kind === "assistant_text" || item.kind === "final_text",
    );
    if (!hasAssistantOrFinal) {
      const bodyText = !hasStartedProposedPlan
        ? timelineTextExcludingProposedPlan(finalText ?? "")
        : "";
      if (bodyText) {
        items.push({
          rawTime: snapshot.updatedAt,
          eventSeq: Number.MAX_SAFE_INTEGER,
          item: {
            id: `${snapshot.runId}:timeline:body`,
            kind: "final_text",
            content: bodyText,
            timestamp: formatElapsed(baseTime, snapshot.updatedAt),
            agentId: finalOutputAgentId(snapshot),
            agentLabel: agentLabelForTimeline(agentLabels, finalOutputAgentId(snapshot)),
          },
        });
      }
    }
  }

  const sortedItems = items
    .sort((left, right) => left.rawTime - right.rawTime || left.eventSeq - right.eventSeq)
    .map(({ item }) => item);
  return sortedItems;
}

function shouldCollectAssistantDeltaForTimeline(
  event: OraEventEnvelope & { payload: Record<string, unknown> },
  finalText: string | undefined,
  hasVisibleProcessSeparators: boolean,
  hasLaterVisibleProcessSeparator: boolean,
): boolean {
  const text = assistantDeltaText(event);
  if (!text.trim()) {
    return false;
  }
  if (!finalText) {
    return true;
  }
  if (!hasVisibleProcessSeparators) {
    return false;
  }
  if (isExplicitStreamingAssistantDelta(event)) {
    return hasLaterVisibleProcessSeparator;
  }
  const hasDelta = typeof event.payload.delta === "string" && event.payload.delta.length > 0;
  if (hasDelta) {
    return true;
  }
  return !isTimelineTextDuplicate(text, finalText);
}

function hasLaterVisibleProcessEvent(
  event: OraEventEnvelope,
  visibleEvents: OraEventEnvelope[],
): boolean {
  return visibleEvents.some((visibleEvent) =>
    visibleEvent.runId === event.runId &&
    (visibleEvent.createdAt > event.createdAt ||
      (visibleEvent.createdAt === event.createdAt && visibleEvent.seq > event.seq))
  );
}

function timelineTextExcludingProposedPlan(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return "";
  }
  const parsed = parseProposedPlan(trimmed);
  const displayText = parsed.hasStartedPlan ? parsed.displayText : trimmed;
  return displayText.trim();
}

function isTimelineTextDuplicate(text: string, candidate: string): boolean {
  const normalizedText = normalizeTimelineText(timelineTextExcludingProposedPlan(text));
  const normalizedCandidate = normalizeTimelineText(timelineTextExcludingProposedPlan(candidate));
  if (!normalizedText || !normalizedCandidate) {
    return false;
  }
  if (normalizedText === normalizedCandidate) {
    return true;
  }
  if (normalizedText.includes(normalizedCandidate) && normalizedCandidate.length >= 40) {
    return true;
  }
  return normalizedCandidate.includes(normalizedText) && normalizedText.length >= normalizedCandidate.length * 0.8;
}

function isTimelineTextAlreadyRepresented(text: string, items: TurnTimelineItem[]): boolean {
  const normalizedText = normalizeTimelineText(text);
  if (!normalizedText) {
    return true;
  }
  const contentItems = items
    .flatMap((item) => "content" in item ? [item.content] : [])
    .map(normalizeTimelineText)
    .filter(Boolean);
  if (contentItems.some((content) => content === normalizedText)) {
    return true;
  }
  const joinedContent = contentItems.join("");
  if (!joinedContent) {
    return false;
  }
  if (joinedContent.includes(normalizedText)) {
    return true;
  }
  return normalizedText.includes(joinedContent) && joinedContent.length >= normalizedText.length * 0.8;
}

function isTimelineTextPrefixOfFinalOutput(text: string, finalText: string): boolean {
  const normalizedText = normalizeTimelineText(timelineTextExcludingProposedPlan(text));
  const normalizedFinalText = normalizeTimelineText(timelineTextExcludingProposedPlan(finalText));
  return Boolean(normalizedText && normalizedFinalText && normalizedFinalText.startsWith(normalizedText));
}

function normalizeTimelineText(text: string): string {
  return text.replace(/\s+/g, "");
}

function agentLabelForTimeline(
  labels: Map<string, string>,
  agentId: string | undefined,
): string | undefined {
  if (!agentId) {
    return undefined;
  }
  return labels.get(agentId) ?? agentId;
}

function dominantStepAgentId(steps: TurnProcessStep[]): string | undefined {
  const counts = new Map<string, number>();
  for (const step of steps) {
    if (!step.agentId) {
      continue;
    }
    counts.set(step.agentId, (counts.get(step.agentId) ?? 0) + 1);
  }
  return [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0];
}

function inferTimelineEventAgentId(
  snapshot: OraStateSnapshot,
  event: OraEventEnvelope,
): string | undefined {
  if (event.agentId) {
    return event.agentId;
  }
  if (event.type !== "completion.updated") {
    return undefined;
  }
  for (let index = snapshot.events.findIndex((candidate) => candidate.id === event.id) - 1; index >= 0; index -= 1) {
    const previous = snapshot.events[index];
    if (previous?.runId === snapshot.runId && previous.agentId && previous.agentId !== ORA_ROOT_AGENT_ID) {
      return previous.agentId;
    }
  }
  return undefined;
}

function finalOutputAgentId(snapshot: OraStateSnapshot): string | undefined {
  if (isRecord(snapshot.output) && isRecord(snapshot.output.ora)) {
    return typeof snapshot.output.ora.agentId === "string"
      ? snapshot.output.ora.agentId
      : undefined;
  }
  return undefined;
}

function aggregateStepStatus(steps: TurnProcessStep[]): TurnProcessStep["status"] {
  if (steps.some((step) => step.status === "blocked")) {
    return "blocked";
  }
  if (steps.some((step) => step.status === "active")) {
    return "active";
  }
  return "complete";
}

function summarizeProcessSteps(steps: TurnProcessStep[], runStatus?: OraStateSnapshot["status"]): string {
  const active = steps.find((step) => step.status === "active");
  if (active && (runStatus === "running" || runStatus === "queued")) {
    return runningStepSummary(active);
  }
  if (runStatus === "running" || runStatus === "queued") {
    const latest = steps.at(-1);
    if (latest) {
      return runningStepSummary(latest);
    }
  }
  const fileCount = steps.filter((step) => ["读取文件", "搜索文件", "匹配文件"].includes(step.label)).length;
  const listCount = steps.filter((step) => step.label === "列出文件").length;
  const commandCount = steps.filter((step) => step.label === "运行命令").length;
  const webCount = steps.filter((step) => step.label === "浏览网页" || step.label === "搜索网页").length;
  const approvalCount = steps.filter((step) => step.label === "等待确认").length;
  const blockedCount = steps.filter((step) => step.status === "blocked").length;
  const parts: string[] = [];
  if (fileCount > 0) {
    parts.push(`已探索 ${fileCount} 个文件`);
  }
  if (listCount > 0) {
    parts.push(`${listCount} 个列表`);
  }
  if (commandCount > 0) {
    parts.push(`已运行 ${commandCount} 条命令`);
  }
  if (webCount > 0) {
    parts.push(`已访问 ${webCount} 个网页/搜索`);
  }
  if (approvalCount > 0) {
    parts.push(`等待 ${approvalCount} 个确认`);
  }
  if (blockedCount > 0 && approvalCount === 0) {
    parts.push(`${blockedCount} 个步骤需要处理`);
  }
  if (parts.length > 0) {
    return active ? `${parts.join("，")}，正在${active.label}` : parts.join("，");
  }
  if (steps.length === 1) {
    return steps[0]?.detail || steps[0]?.label || "已更新执行状态";
  }
  return `已更新 ${steps.length} 条执行状态`;
}

function runningStepSummary(step: TurnProcessStep): string {
  const context = step.contextLabel ? `：${step.contextLabel}` : "";
  if (step.status === "active") {
    return `正在${step.label}${context}`;
  }
  return step.detail.trim() || `${step.label}${context}`;
}

function planUpdateSummary(payload: unknown): string {
  if (!isRecord(payload) || !Array.isArray(payload.plan)) {
    return "已更新任务计划";
  }
  const plan = payload.plan.filter(isRecord);
  const completed = plan.filter((item) => item.status === "completed").length;
  const active = plan.find((item) => item.status === "in_progress");
  const activeStep = isRecord(active) && typeof active.step === "string" ? active.step : undefined;
  return activeStep
    ? `已更新任务计划：${completed}/${plan.length} 完成，正在 ${activeStep}`
    : `已更新任务计划：${completed}/${plan.length} 完成`;
}

function artifactIdFromEvent(event: OraEventEnvelope): string | undefined {
  if (!isRecord(event.payload)) {
    return undefined;
  }
  if (isRecord(event.payload.artifact) && typeof event.payload.artifact.id === "string") {
    return event.payload.artifact.id;
  }
  return typeof event.payload.artifactId === "string" ? event.payload.artifactId : undefined;
}

function handoffStepStatus(
  status: string,
): TurnProcessStep["status"] {
  switch (status) {
    case "running":
      return "active";
    case "failed":
      return "blocked";
    default:
      return "complete";
  }
}

function shouldShowProcessEvent(event: OraEventEnvelope): boolean {
  switch (event.type) {
    case "task.started":
    case "task.completed":
    case "task.failed":
    case "approval.required":
    case "approval.resolved":
    case "clarification.required":
    case "clarification.resolved":
    case "tool.called":
      if (isCachedWebFetchEvent(event)) {
        return false;
      }
      return hasToolId(event);
    case "task.progress":
      if (isCachedWebFetchEvent(event)) {
        return false;
      }
      return hasToolId(event) && !isChatProgressEvent(event);
    case "tool.repaired":
      return hasToolId(event);
    case "artifact.exported":
    case "recovery.detected":
    case "recovery.retry_scheduled":
    case "recovery.applied":
    case "recovery.exhausted":
    case "node.skipped":
    case "run.done":
    case "run.failed":
      return true;
    case "completion.updated":
      return isUserVisibleCompletionEvent(event);
    case "checkpoint.created":
      return false;
    case "node.updated":
      return isSignificantNodeUpdate(event);
    case "action.updated":
      return actionStatusFromEvent(event) === "failed";
    default:
      return false;
  }
}

function isCachedWebFetchEvent(event: OraEventEnvelope): boolean {
  return (
    isRecord(event.payload) &&
    event.payload.toolId === "web.fetch" &&
    event.payload.cacheHit === true
  );
}

function isUserVisibleCompletionEvent(event: OraEventEnvelope): boolean {
  if (!isRecord(event.payload) || typeof event.payload.state !== "string") {
    return false;
  }
  return ["force_final", "tool_call_text_rejected", "tool_calls_ignored"].includes(
    event.payload.state,
  );
}

function isChatProgressEvent(event: OraEventEnvelope): boolean {
  return (
    isRecord(event.payload) &&
    event.payload.kind === "chat_progress" &&
    typeof event.payload.summary === "string" &&
    event.payload.summary.trim().length > 0
  );
}

function processStepLabel(event: OraEventEnvelope): string {
  if (event.type === "node.updated" && isRecord(event.payload)) {
    switch (event.payload.state) {
      case "interrupted":
        return isApprovalInterruptDetail(stringValue(event.payload.detail) ?? "")
          ? "等待确认"
          : "已暂停";
      case "repairing":
        return "已恢复";
      case "degraded":
        return "已在有限上下文下继续";
      case "failed":
        return "处理失败";
      default:
        return "处理状态已更新";
    }
  }
  if (
    (event.type === "tool.called" || event.type === "tool.repaired") &&
    isRecord(event.payload)
  ) {
    if (event.type === "tool.repaired") {
      return "已恢复";
    }
    return toolCallLabel(event.payload);
  }
  if (event.type === "completion.updated") {
    if (isRecord(event.payload) && event.payload.state === "force_final") {
      return "进入最终回答";
    }
    return "已停止工具调用";
  }
  if (event.type === "approval.required") {
    return "等待确认";
  }
  if (event.type === "clarification.required") {
    return "等待补充信息";
  }
  if (event.type === "action.updated") {
    return "操作失败";
  }
  return beatLabel(event);
}

function processStepDetail(event: OraEventEnvelope): string {
  if (event.type === "run.done") {
    return "";
  }
  if (
    (event.type === "task.started" ||
      event.type === "task.progress" ||
      event.type === "task.completed" ||
      event.type === "task.failed") &&
    !isChatProgressEvent(event)
  ) {
    return isRecord(event.payload) ? readablePayloadText(event.payload) ?? "" : "";
  }
  if (event.type === "completion.updated") {
    if (isRecord(event.payload) && event.payload.state === "force_final") {
      return event.payload.reason === "tool_budget_exhausted"
        ? "工具预算已用完，正在整理最终回答。"
        : "正在整理最终回答。";
    }
    return "";
  }
  const detail = eventText(event);
  if (
    (event.type === "tool.called" || event.type === "tool.repaired") &&
    isRecord(event.payload)
  ) {
    const title = rawToolId(event.payload) ?? toolCallLabel(event.payload);
    const status =
      typeof event.payload.status === "string"
        ? event.payload.status
        : undefined;
    const actionDetail = toolCallDetail(event.payload);
    if (event.type === "tool.repaired") {
      return actionDetail
        ? `已恢复缺失的工具结果：${actionDetail}。`
        : "已恢复缺失的工具结果，本轮任务可以继续。";
    }
    if (status === "failed" && typeof event.payload.error === "string") {
      return `工具执行失败：${actionDetail ?? title}。${event.payload.error}`;
    }
    if (actionDetail) {
      return status === "failed"
        ? `工具执行失败：${actionDetail}。`
        : `${actionDetail}。`;
    }
    return status ? `工具调用更新：${title}（${toolStatusLabel(status)}）。` : `工具调用完成：${title}。`;
  }
  if (
    (event.type === "artifact.exported" ||
      event.type === "artifact.degraded") &&
    isRecord(event.payload)
  ) {
    const label =
      isRecord(event.payload.artifact) &&
      typeof event.payload.artifact.label === "string"
        ? event.payload.artifact.label
        : typeof event.payload.label === "string"
          ? event.payload.label
          : "artifact";
    return event.type === "artifact.degraded"
      ? `产物已降级：${label}。`
      : `已发布产物：${label}。`;
  }
  if (
    event.type.startsWith("recovery.") &&
    isRecord(event.payload) &&
    isRecord(event.payload.decision) &&
    typeof event.payload.decision.summary === "string"
  ) {
    return event.payload.decision.summary;
  }
  if (
    event.type === "action.updated" &&
    isRecord(event.payload) &&
    isRecord(event.payload.record)
  ) {
    const record = event.payload.record;
    if (typeof record.error === "string" && record.error.trim()) {
      return humanizeActionError(record.error.trim());
    }
  }
  if (
    event.type === "node.skipped" &&
    isRecord(event.payload) &&
    typeof event.payload.nodeLabel === "string"
  ) {
    return `已跳过 ${event.payload.nodeLabel}。`;
  }
  if (
    event.type === "node.updated" &&
    isRecord(event.payload) &&
    typeof event.payload.state === "string"
  ) {
    const detail = visibleRuntimeDetail(event.payload.detail);
    switch (event.payload.state) {
      case "repairing":
        return `已恢复缺失的工具上下文${detail}。`;
      case "degraded":
        return `已在有限上下文下继续${detail}。`;
      case "interrupted":
        if (isApprovalInterruptDetail(detail.trim())) {
          return APPROVAL_INTERRUPT_MESSAGE;
        }
        return `处理已暂停${detail}。`;
      case "failed":
        return `处理步骤失败${detail}。`;
      default:
        return `处理状态已更新${detail}。`;
    }
  }
  return detail;
}

function isApprovalInterruptDetail(detail: string): boolean {
  return (
    detail === APPROVAL_INTERRUPT_MESSAGE ||
    detail === APPROVAL_INTERRUPT_MESSAGE_EN ||
    /^Manual approval required for action .+\.$/.test(detail)
  );
}

function isWorkProcessEvent(event: OraEventEnvelope): boolean {
  switch (event.type) {
    case "task.started":
    case "task.progress":
    case "task.completed":
    case "task.failed":
    case "approval.required":
    case "approval.resolved":
    case "clarification.required":
    case "clarification.resolved":
    case "tool.called":
    case "artifact.exported":
    case "artifact.degraded":
    case "completion.updated":
    case "recovery.detected":
    case "recovery.retry_scheduled":
    case "recovery.applied":
    case "recovery.exhausted":
    case "node.skipped":
      return true;
    case "node.updated":
      return isSignificantNodeUpdate(event);
    default:
      return false;
  }
}

function isLifecycleProcessEvent(event: OraEventEnvelope): boolean {
  return (
    event.type === "checkpoint.created" ||
    event.type === "run.done" ||
    event.type === "run.failed"
  );
}

function isSignificantNodeUpdate(event: OraEventEnvelope): boolean {
  if (!isRecord(event.payload) || typeof event.payload.state !== "string") {
    return false;
  }
  return ["repairing", "degraded", "interrupted", "failed"].includes(
    event.payload.state,
  );
}

function hasToolId(event: OraEventEnvelope): boolean {
  return (
    isRecord(event.payload) &&
    typeof event.payload.toolId === "string" &&
    event.payload.toolId.length > 0
  );
}

function toolCallLabel(payload: Record<string, unknown>): string {
  const toolId = rawToolId(payload);
  switch (toolId) {
    case "web.fetch":
      return "浏览网页";
    case "web.search":
      return "搜索网页";
    case "file.read":
      return "读取文件";
    case "file.list":
      return "列出文件";
    case "file.glob":
      return "匹配文件";
    case "file.grep":
      return "搜索文件";
    case "file.write":
      return "写入文件";
    case "file.patch":
      return "修改文件";
    case "shell.execute":
      return "运行命令";
    case "skills.get":
      return "加载技能";
    case "skills.list":
      return "查找技能";
    case "skills.create":
      return "安装技能";
    case "skills.update":
      return "更新技能";
    case "skills.setEnabled":
      return "切换技能状态";
    case "skills.checkName":
      return "检查技能名称";
    case "mcp.listTools":
      return "列出 MCP 工具";
    case "mcp.readResource":
      return "读取 MCP 资源";
    case "mcp.call":
      return "调用 MCP 工具";
    default:
      return typeof payload.title === "string" && payload.title.length > 0
        ? payload.title
        : toolId ?? "工具调用";
  }
}

function rawToolId(payload: Record<string, unknown>): string | undefined {
  return typeof payload.toolId === "string" && payload.toolId.length > 0
    ? payload.toolId
    : undefined;
}

function toolCallDetail(payload: Record<string, unknown>): string | undefined {
  const toolId =
    typeof payload.toolId === "string" ? payload.toolId : undefined;
  const input = isRecord(payload.input)
    ? payload.input
    : isRecord(payload.args)
      ? payload.args
      : {};
  const output = isRecord(payload.output)
    ? payload.output
    : isRecord(payload.result)
      ? payload.result
      : {};
  const targetPath = stringValue(output.path) ?? stringValue(input.path);

  switch (toolId) {
    case "file.read":
      return targetPath
        ? `已读取 ${targetPath}${sizeSuffix(output.sizeBytes ?? output.bytes)}`
        : undefined;
    case "file.list":
      if (output.missing === true) {
        return targetPath ? `未找到 ${targetPath}，未列出文件` : "目标目录不存在，未列出文件";
      }
      return targetPath
        ? `已列出 ${targetPath}${countSuffix(output.entries, "项")}`
        : undefined;
    case "file.glob": {
      const pattern = stringValue(output.pattern) ?? stringValue(input.pattern);
      const basePath = stringValue(output.path) ?? stringValue(input.path);
      if (!pattern) {
        return undefined;
      }
      return `已匹配 ${pattern}${basePath ? `（${basePath} 下）` : ""}${countSuffix(output.matches, "项")}`;
    }
    case "file.grep": {
      const pattern = stringValue(output.pattern) ?? stringValue(input.pattern);
      if (!pattern) {
        return undefined;
      }
      const scope = fileSearchScopeLabel(output, input);
      const truncated = output.truncated === true ? "，结果已截断" : "";
      return `已搜索 "${pattern}"${scope ? `（${scope}）` : ""}${countSuffix(output.matches, "项")}${truncated}`;
    }
    case "file.write":
      return targetPath
        ? `已写入 ${targetPath}${sizeSuffix(output.sizeBytes)}`
        : undefined;
    case "file.patch": {
      const replacements =
        typeof output.replacements === "number"
          ? `（${output.replacements} 处替换）`
          : "";
      return targetPath ? `已修改 ${targetPath}${replacements}` : undefined;
    }
    case "shell.execute": {
      const command = stringValue(output.command) ?? stringValue(input.command);
      const exitCode =
        typeof output.exitCode === "number" && output.exitCode !== 0
          ? ` (exit ${output.exitCode})`
          : "";
      return command ? `已运行命令：${command}${exitCode}` : undefined;
    }
    case "web.fetch": {
      const url = stringValue(output.url) ?? stringValue(input.url);
      if (!url) {
        return undefined;
      }
      const status =
        typeof output.status === "number" && output.status >= 400
          ? ` (HTTP ${output.status})`
          : "";
      return `已查看 ${url}${status}`;
    }
    case "web.search": {
      const query = stringValue(output.query) ?? stringValue(input.query);
      return query
        ? `已搜索网页："${query}"${countSuffix(output.results, "条结果")}`
        : undefined;
    }
    case "mcp.listTools": {
      const server = stringValue(input.server);
      return server ? `已列出 ${server} 的 MCP 工具` : "已列出 MCP 工具";
    }
    case "mcp.readResource": {
      const uri = stringValue(input.uri);
      const server = stringValue(input.server);
      return uri
        ? `已读取 MCP 资源 ${uri}${server ? `（${server}）` : ""}`
        : undefined;
    }
    case "mcp.call": {
      const name = stringValue(input.name);
      const server = stringValue(input.server);
      return name
        ? `已调用 MCP 工具 ${name}${server ? `（${server}）` : ""}`
        : undefined;
    }
    case "skills.get": {
      const skillName = stringValue(output.name) ?? stringValue(input.name);
      return skillName
        ? `已加载技能 "${skillName}"`
        : "已加载技能";
    }
    case "skills.list": {
      const query = stringValue(input.query);
      const count = typeof output.count === "number" ? output.count : undefined;
      if (query && count !== undefined) {
        return `搜索技能 "${query}"，找到 ${count} 个`;
      }
      if (query) {
        return `搜索技能 "${query}"`;
      }
      return count !== undefined
        ? `已列出 ${count} 个可用技能`
        : "已检查可用技能";
    }
    case "skills.update": {
      const skillName = stringValue(output.name) ?? stringValue(input.name);
      return skillName
        ? `已更新技能 "${skillName}"`
        : "已更新技能";
    }
    case "skills.setEnabled": {
      const skillName = stringValue(output.name) ?? stringValue(input.name);
      const enabled = input.enabled === false ? "停用" : "启用";
      return skillName
        ? `已${enabled}技能 "${skillName}"`
        : "已切换技能状态";
    }
    case "skills.checkName": {
      const name = stringValue(output.name) ?? stringValue(input.name);
      return name
        ? `已检查 ${name} 是否可以安装`
        : "已检查技能名称是否可以安装";
    }
    case "skills.create": {
      const name = stringValue(output.name) ?? stringValue(input.name);
      const target = stringValue(output.path) ?? stringValue(input.path);
      if (name && target) {
        return `已安装 ${name} 到 ${target}`;
      }
      return name
        ? `已安装 ${name}`
        : target
          ? `已安装技能到 ${target}`
          : "已安装技能";
    }
    default:
      return undefined;
  }
}

function toolStatusLabel(status: string): string {
  switch (status) {
    case "succeeded":
      return "已完成";
    case "failed":
      return "失败";
    case "running":
      return "运行中";
    case "proposed":
      return "待确认";
    case "approval_required":
      return "需要确认";
    case "interrupted":
      return "已中断";
    case "denied":
      return "已拒绝";
    case "repaired":
      return "已恢复";
    default:
      return status.replace(/_/g, " ");
  }
}

function humanizeActionError(error: string): string {
  if (isInternalRuntimeDiagnosticText(error)) {
    return "操作已转入恢复流程，正在使用有限上下文继续。";
  }
  if (/tool call instead of a final answer after completion control disabled tools/i.test(error)) {
    return "Ora 已停止工具调用，但模型仍尝试继续调用工具；本轮已使用现有答案结束。";
  }
  if (/interrupted by caller|paused as instructed/i.test(error)) {
    return USER_INTERRUPTED_MESSAGE;
  }
  if (/resumed by caller|confirmed\. continuing/i.test(error)) {
    return USER_RESUMED_MESSAGE;
  }
  if (/cancelled by caller|canceled by caller|run was cancelled|stopped processing as instructed/i.test(error)) {
    return USER_CANCELLED_MESSAGE;
  }
  return `无法完成这个操作：${error}`;
}

function visibleRuntimeDetail(detail: unknown): string {
  if (typeof detail !== "string" || !detail.trim()) {
    return "";
  }
  const trimmed = detail.trim();
  return isInternalRuntimeDiagnosticText(trimmed) ? "" : ` ${trimmed}`;
}

function isInternalRuntimeDiagnosticText(text: string): boolean {
  return isInternalRecoveryFallbackText(text) || /boundary violation/i.test(text);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function fileSearchScopeLabel(
  output: Record<string, unknown>,
  input: Record<string, unknown>,
): string | undefined {
  const scopePath = stringValue(output.path) ?? stringValue(input.path);
  const include = stringValue(input.include);
  if (scopePath && include) {
    return `${scopePath}，${include}`;
  }
  return scopePath ?? include;
}

function sizeSuffix(value: unknown): string {
  return typeof value === "number" ? ` (${formatBytes(value)})` : "";
}

function countSuffix(value: unknown, unit: string): string {
  if (!Array.isArray(value)) {
    return "";
  }
  return `（${value.length} ${unit}）`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function processStepStatus(
  event: OraEventEnvelope,
  runStatus: OraStateSnapshot["status"],
  isLatestProcessEvent = true,
): TurnProcessStep["status"] {
  switch (event.type) {
    case "task.progress":
      return runStatus === "running" && isLatestProcessEvent
        ? "active"
        : "complete";
    case "tool.called": {
      const status = actionStatusFromEvent(event);
      if (status === "failed") {
        return "blocked";
      }
      if (status === "running" || status === "proposed") {
        return "active";
      }
      return "complete";
    }
    case "tool.repaired":
      return "blocked";
    case "approval.required":
    case "clarification.required":
    case "action.updated":
    case "task.failed":
    case "recovery.exhausted":
    case "run.failed":
      return "blocked";
    case "recovery.retry_scheduled":
      return "active";
    default:
      return "complete";
  }
}

function actionStatusFromEvent(event: OraEventEnvelope): string | undefined {
  if (!isRecord(event.payload)) {
    return undefined;
  }

  return typeof event.payload.status === "string"
    ? event.payload.status
    : undefined;
}

function processStepTone(event: OraEventEnvelope): TurnProcessStep["tone"] {
  switch (event.type) {
    case "approval.required":
    case "clarification.required":
    case "tool.repaired":
      return "warning";
    case "artifact.exported":
    case "artifact.degraded":
    case "recovery.applied":
    case "completion.updated":
    case "node.skipped":
    case "node.updated":
    case "checkpoint.created":
      return "accent";
    case "recovery.retry_scheduled":
    case "recovery.exhausted":
      return "warning";
    default:
      return "neutral";
  }
}

function processContextLabel(event: OraEventEnvelope): string | undefined {
  if (!isRecord(event.payload)) {
    return undefined;
  }

  const toolTarget = processToolTargetLabel(event.payload);
  if (toolTarget) {
    return toolTarget;
  }

  if (typeof event.payload.path === "string") {
    return event.payload.path;
  }

  if (typeof event.payload.uri === "string") {
    return event.payload.uri;
  }

  if (typeof event.payload.label === "string") {
    return event.payload.label;
  }

  if (
    isRecord(event.payload.checkpoint) &&
    typeof event.payload.checkpoint.id === "string"
  ) {
    return event.payload.checkpoint.id;
  }

  return undefined;
}

function processToolTargetLabel(
  payload: Record<string, unknown>,
): string | undefined {
  if (typeof payload.toolId !== "string") {
    return undefined;
  }

  const input = isRecord(payload.input)
    ? payload.input
    : isRecord(payload.args)
      ? payload.args
      : {};
  const output = isRecord(payload.output)
    ? payload.output
    : isRecord(payload.result)
      ? payload.result
      : {};
  if (payload.toolId === "file.grep") {
    return stringValue(output.path) ?? stringValue(input.path) ?? stringValue(input.include) ?? payload.toolId;
  }
  if (payload.toolId === "file.glob") {
    return stringValue(output.path) ?? stringValue(input.path) ?? payload.toolId;
  }
  return (
    stringValue(output.path) ??
    stringValue(input.path) ??
    stringValue(output.url) ??
    stringValue(input.url) ??
    stringValue(output.query) ??
    stringValue(input.query) ??
    stringValue(input.uri) ??
    stringValue(input.name) ??
    stringValue(input.command) ??
    payload.toolId
  );
}

function adaptTurnArtifact(artifact: OraArtifactRef): TurnArtifactAttachment {
  return {
    id: artifact.id,
    label: artifact.label,
    kind: artifact.kind,
    mimeType: artifact.mimeType,
    createdAt: formatClock(artifact.createdAt),
    uri: artifact.uri,
    sizeBytes: artifact.sizeBytes,
    payload: artifact.payload,
    previewable: isPreviewableTurnArtifact(artifact),
  };
}

function userVisibleArtifacts(artifacts: OraArtifactRef[]): OraArtifactRef[] {
  return artifacts.filter((artifact) => !isRecoveryArtifact(artifact));
}

function isRecoveryArtifact(artifact: OraArtifactRef): boolean {
  return (
    artifact.kind === "log" &&
    artifact.label === "Recovery artifact" &&
    isRecord(artifact.payload) &&
    typeof artifact.payload.errorType === "string" &&
    typeof artifact.payload.decision === "string"
  );
}

function isPreviewableTurnArtifact(artifact: OraArtifactRef): boolean {
  const label = artifact.label.toLowerCase();
  return artifact.mimeType.startsWith("image/") || artifact.mimeType.includes("html") || label.endsWith(".html") || label.endsWith(".htm");
}

function adaptTurnFileChange(artifact: OraArtifactRef): TurnFileChangeAttachment[] {
  if (!isFileChangePayload(artifact.payload)) {
    return [];
  }
  return [{
    artifactId: artifact.id,
    path: artifact.payload.path,
    operation: artifact.payload.operation,
    beforeContent: artifact.payload.beforeContent,
    afterContent: artifact.payload.afterContent,
    additions: artifact.payload.additions,
    deletions: artifact.payload.deletions,
    sizeBytes: artifact.payload.metadata.sizeBytes,
    replacements: artifact.payload.metadata.replacements,
    created: artifact.payload.metadata.created,
  }];
}

function isFileChangePayload(value: unknown): value is {
  kind: "file_change";
  path: string;
  operation: "write" | "patch";
  beforeContent: string;
  afterContent: string;
  additions: number;
  deletions: number;
  metadata: {
    sizeBytes?: number;
    replacements?: number;
    created: boolean;
  };
} {
  return (
    isRecord(value) &&
    value.kind === "file_change" &&
    typeof value.path === "string" &&
    (value.operation === "write" || value.operation === "patch") &&
    typeof value.beforeContent === "string" &&
    typeof value.afterContent === "string" &&
    typeof value.additions === "number" &&
    typeof value.deletions === "number" &&
    isRecord(value.metadata) &&
    typeof value.metadata.created === "boolean"
  );
}

function placeholderAssistantCopy(snapshot?: OraStateSnapshot): string {
  if (!snapshot) {
    return "";
  }

  if (snapshotPendingClarifications(snapshot).length > 0) {
    return clarificationTextFromSnapshot(snapshot) ?? "";
  }

  if (snapshotPendingApprovals(snapshot).length > 0) {
    return approvalPendingTextFromSnapshot(snapshot) ?? "";
  }

  switch (snapshot.status) {
    case "running":
    case "queued":
      return "";
    case "cancelled":
      return cancelledTextFromSnapshot(snapshot);
    case "failed":
    case "interrupted":
      return snapshot.error ?? "";
    case "succeeded":
      return "";
  }
}

function cancelledTextFromSnapshot(snapshot: OraStateSnapshot): string {
  if (hasDeniedApproval(snapshot)) {
    return APPROVAL_DENIED_MESSAGE;
  }
  return safeCancelledCopy(snapshot.error);
}

function hasDeniedApproval(snapshot: OraStateSnapshot): boolean {
  return snapshot.actions.some(
    (action) => action.status === "denied" && action.approvalRequest,
  );
}

function latestEventTime(
  snapshot: OraStateSnapshot,
  eventType: OraEventEnvelope["type"],
): number | undefined {
  for (let index = snapshot.events.length - 1; index >= 0; index -= 1) {
    const event = snapshot.events[index];
    if (event?.type === eventType) {
      return event.createdAt;
    }
  }
  return undefined;
}

function safeCancelledCopy(error: string | undefined): string {
  if (!error?.trim()) {
    return USER_CANCELLED_MESSAGE;
  }
  if (/cancelled by caller|canceled by caller|run was cancelled/i.test(error)) {
    return USER_CANCELLED_MESSAGE;
  }
  return error;
}
