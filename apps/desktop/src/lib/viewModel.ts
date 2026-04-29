import { modeSpecToPatternDefinition } from "@ora/shared";
import type {
  ActionRecord,
  AgentProfile,
  AssistantTurnAttachment,
  ArtifactRecord,
  ChatMessage,
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
  StreamLine,
  TurnArtifactAttachment,
  TurnFileChangeAttachment,
  TurnAgentConversationMessage,
  TurnProcessStep,
  TurnTodoItem,
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
  OraSessionDetail,
  OraSessionSummary,
  OraStateSnapshot,
  OraSessionTranscriptMessage,
  OraTopologyEdge,
  OraTopologyNode,
} from "./runtimeClient";
import { USER_CANCELLED_MESSAGE, USER_INTERRUPTED_MESSAGE, USER_RESUMED_MESSAGE } from "./runtimeClient";

const APPROVAL_INTERRUPT_MESSAGE = "Waiting for your approval before continuing.";
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
  prompt: string;
  createdAt: number;
  progressText?: string;
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

  const patternCards = patterns.map(adaptPatternCard);
  const modeCards = modes.map(adaptModeCard);
  const activePattern =
    patternCards.find((pattern) => pattern.id === effectivePattern) ??
    patternCards[0];
  const activeMode = selectedMode ? adaptModeCard(selectedMode) : modeCards[0];

  return {
    patternCards,
    modeCards,
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
    streamLines: adaptStreamLines(detailSnapshot.events),
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
    artifacts: detailSnapshot.artifacts.map(adaptArtifact),
    beats: adaptFilmstripBeats(detailSnapshot),
    activePattern,
    activeMode,
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
      patternOptions: {},
      metadata: {},
      deterministicSeed: "ora-preview",
    },
    topology: definition.topology,
    profiles: definition.profiles,
    memory: [],
    plan: [],
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
  return {
    id: session.sessionId,
    title: session.title,
    project: session.projectId ?? "Recent chat",
    projectId: session.projectId,
    status: adaptRunStatus(status),
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
    status: adaptRunStatus(turn.status),
    pattern: turn.pattern,
    modeId: turn.modeId,
    providerId: turn.providerId,
    modelRef: turn.modelRef,
    prompt: turn.prompt,
    updatedAt: formatClock(turn.updatedAt),
  };
}

function adaptRunStatus(status: OraStateSnapshot["status"]): RunStatus {
  switch (status) {
    case "queued":
    case "running":
      return "running";
    case "interrupted":
      return "approval_required";
    case "cancelled":
      return "failed";
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
    if (typeof event.payload.message === "string") {
      return event.payload.message;
    }
    if (typeof event.payload.content === "string") {
      return event.payload.content;
    }
    if (typeof event.payload.summary === "string") {
      return event.payload.summary;
    }
  }

  switch (event.type) {
    case "completion.updated":
      return "";
    case "node.updated":
      return isRecord(event.payload) && typeof event.payload.state === "string"
        ? `Processing state updated: ${event.payload.state}.`
        : "Processing state updated.";
    case "run.failed":
      return "The run did not finish. Open Trails for the latest details.";
    default:
      return event.type;
  }
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
      return "Run started";
    case "run.resumed":
      return "Resumed";
    case "run.forked":
      return "Forked";
    case "run.replayed":
      return "Replayed";
    case "topology.updated":
      return "Topology";
    case "agent.started":
      return "Agent start";
    case "agent.completed":
      return "Agent done";
    case "profile.updated":
      return "Profile";
    case "memory.queued":
      return "Memory queued";
    case "memory.updated":
      return "Memory";
    case "memory.flushed":
      return "Memory flushed";
    case "plan.updated":
      return "Plan";
    case "todo.updated":
      return "To-do";
    case "action.updated":
      return "Action";
    case "task.started":
      return "Task start";
    case "task.progress":
      return "Task";
    case "task.completed":
      return "Task done";
    case "task.failed":
      return "Task failed";
    case "approval.required":
      return "Approval";
    case "clarification.required":
      return "Clarify";
    case "approval.resolved":
      return "Approval done";
    case "clarification.resolved":
      return "Clarified";
    case "tool.called":
      return isRecord(event.payload) ? toolCallLabel(event.payload) : "Tool";
    case "tool.repaired":
      return "Tool repaired";
    case "message.delta":
      return "Stream";
    case "agent.message":
      return "Agent message";
    case "message.published":
      return "Publish";
    case "message.routed":
      return "Route";
    case "token.delta":
      return "Token";
    case "queue.updated":
      return "Queue";
    case "shared_state.updated":
      return "Shared state";
    case "worker.claimed":
      return "Worker claimed";
    case "worker.released":
      return "Worker released";
    case "checkpoint.created":
      return "Checkpoint";
    case "artifact.exported":
    case "artifact.degraded":
      return "Artifact";
    case "completion.updated":
      return "Completion";
    case "node.updated":
      return "Node";
    case "recovery.detected":
      return "Recovery";
    case "recovery.retry_scheduled":
      return "Retry";
    case "recovery.applied":
      return "Recovered";
    case "recovery.exhausted":
      return "Recovery exhausted";
    case "node.skipped":
      return "Node skipped";
    case "run.interrupted":
      return "Interrupted";
    case "run.cancelled":
      return "Cancelled";
    case "run.done":
      return "Done";
    case "run.failed":
      return "Failed";
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
  return Array.isArray(snapshot.pendingApprovals)
    ? snapshot.pendingApprovals
    : [];
}

function snapshotPendingClarifications(
  snapshot: OraStateSnapshot,
): OraStateSnapshot["pendingClarifications"] {
  return Array.isArray(snapshot.pendingClarifications)
    ? snapshot.pendingClarifications
    : [];
}

export function adaptChatMessages(
  transcript: OraSessionTranscriptMessage[],
  turnSnapshots: Record<string, OraStateSnapshot | undefined> = {},
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
        });
      }

      const assistantTurn = turn.snapshot
        ? buildAssistantTurnAttachment(turn.snapshot)
        : undefined;
      const snapshotAssistant = turn.snapshot
        ? assistantTextFromSnapshot(turn.snapshot)
        : undefined;
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
      content: pendingRun.progressText?.trim() || "正在准备",
      timestamp: formatClock(pendingRun.createdAt),
      isPlaceholder: true,
    },
  ];
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

function assistantTextFromSnapshot(
  snapshot: OraStateSnapshot,
): string | undefined {
  if (snapshot.status === "cancelled") {
    return cancelledTextFromSnapshot(snapshot);
  }
  const outputText = outputTextFromSnapshot(snapshot);
  if (outputText) {
    return outputText;
  }
  const clarificationText = clarificationTextFromSnapshot(snapshot);
  if (clarificationText) {
    return clarificationText;
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
      snapshotPendingApprovals(snapshot).length > 0 ||
      snapshot.actions.some((action) => action.status === "approval_required")
    ) {
      return undefined;
    }
    return progressTextFromSnapshot(snapshot);
  }
  if (snapshot.status === "interrupted") {
    return undefined;
  }

  for (let index = snapshot.events.length - 1; index >= 0; index -= 1) {
    const event = snapshot.events[index];
    if (event?.type !== "message.delta" || !isRecord(event.payload)) {
      continue;
    }
    if (isInternalVerifierDelta(snapshot, event)) {
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
  for (let index = snapshot.events.length - 1; index >= 0; index -= 1) {
    const event = snapshot.events[index];
    if (event?.type !== "message.delta" || !isRecord(event.payload)) {
      continue;
    }
    if (isInternalVerifierDelta(snapshot, event)) {
      continue;
    }
    const content = event.payload.content;
    if (typeof content === "string" && content.trim()) {
      return content;
    }
  }
  return undefined;
}

function clarificationTextFromSnapshot(snapshot: OraStateSnapshot): string | undefined {
  const clarification = snapshotPendingClarifications(snapshot)[0];
  if (clarification?.question.trim()) {
    return clarification.question.trim();
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

function progressTextFromSnapshot(
  snapshot: OraStateSnapshot,
): string | undefined {
  if (
    snapshot.status === "cancelled" ||
    snapshot.status === "failed" ||
    snapshot.status === "succeeded"
  ) {
    return undefined;
  }

  for (let index = snapshot.events.length - 1; index >= 0; index -= 1) {
    const event = snapshot.events[index];
    if (event?.type !== "task.progress" || !isRecord(event.payload)) {
      continue;
    }
    if (
      event.payload.kind !== "chat_progress" ||
      !isVisibleChatProgressSource(event.payload.source)
    ) {
      continue;
    }
    const summary = event.payload.summary;
    if (typeof summary === "string" && summary.trim()) {
      const text = summary.trim();
      if (!isPlaceholderProgressText(text)) {
        return text;
      }
    }
  }
  return undefined;
}

function approvalPendingTextFromSnapshot(snapshot: OraStateSnapshot): string | undefined {
  if (
    snapshot.status !== "interrupted" &&
    snapshotPendingApprovals(snapshot).length === 0 &&
    !snapshot.actions.some((action) => action.status === "approval_required")
  ) {
    return undefined;
  }

  return approvalRequestTextFromSnapshot(snapshot) ?? approvalProgressTextFromSnapshot(snapshot);
}

function approvalRequestTextFromSnapshot(snapshot: OraStateSnapshot): string | undefined {
  const pendingIds = new Set(snapshotPendingApprovals(snapshot));
  const pendingAction =
    snapshot.actions.find((action) => pendingIds.has(action.id)) ??
    snapshot.actions.find((action) => action.status === "approval_required");
  const summary = pendingAction?.approvalRequest?.summary;
  return typeof summary === "string" && summary.trim()
    ? summary.trim()
    : undefined;
}

function approvalProgressTextFromSnapshot(snapshot: OraStateSnapshot): string | undefined {
  for (let index = snapshot.events.length - 1; index >= 0; index -= 1) {
    const event = snapshot.events[index];
    if (event?.type !== "task.progress" || !isRecord(event.payload)) {
      continue;
    }
    if (
      event.payload.kind !== "chat_progress" ||
      !isVisibleChatProgressSource(event.payload.source) ||
      event.payload.trigger !== "approval.required"
    ) {
      continue;
    }
    const summary = event.payload.summary;
    if (typeof summary === "string" && summary.trim()) {
      return summary.trim();
    }
  }
  return undefined;
}

function outputTextFromSnapshot(
  snapshot: OraStateSnapshot,
): string | undefined {
  if (typeof snapshot.output === "string" && snapshot.output.trim()) {
    return snapshot.output.trim();
  }
  if (
    isRecord(snapshot.output) &&
    typeof snapshot.output.text === "string" &&
    snapshot.output.text.trim()
  ) {
    return snapshot.output.text.trim();
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
    snapshotPendingApprovals(snapshot).length > 0 ||
    snapshot.actions.some((action) => action.status === "approval_required")
  );
}

function buildAssistantTurnAttachment(
  snapshot: OraStateSnapshot,
): AssistantTurnAttachment {
  return {
    runId: snapshot.runId,
    turnIndex: snapshot.turnIndex ?? 1,
    status: adaptRunStatus(snapshot.status),
    pattern: snapshot.pattern,
    liveProgressText: progressTextFromSnapshot(snapshot),
    processSteps: deriveProcessSteps(snapshot),
    agentMessages: deriveAgentMessages(snapshot),
    artifacts: snapshot.artifacts.map(adaptTurnArtifact),
    fileChanges: snapshot.artifacts.flatMap(adaptTurnFileChange),
    todos: deriveTurnTodos(snapshot),
    approvalCount: snapshotPendingApprovals(snapshot).length,
    clarificationCount: snapshotPendingClarifications(snapshot).length,
  };
}

function deriveAgentMessages(snapshot: OraStateSnapshot): TurnAgentConversationMessage[] {
  const profiles = new Map(snapshot.profiles.map((profile) => [profile.id, profile.label]));
  const deltaCursorByAgent = new Map<string, number>();
  const deltasByAgent = agentMessageDeltasByAgent(snapshot);
  return (snapshot.agentMessages ?? []).map((message) => {
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

function deriveProcessSteps(snapshot: OraStateSnapshot): TurnProcessStep[] {
  const events = snapshot.events.filter(shouldShowProcessEvent);
  const hasWorkEvent = events.some(isWorkProcessEvent);
  const visibleEvents = events.filter(
    (event) => hasWorkEvent || !isLifecycleProcessEvent(event),
  );

  const steps: TurnProcessStep[] = visibleEvents
    .map((event, index) => ({
      id: event.id,
      eventType: event.type,
      label: processStepLabel(event),
      detail: processStepDetail(event),
      timestamp: formatElapsed(
        snapshot.events[0]?.createdAt ?? event.createdAt,
        event.createdAt,
      ),
      status: processStepStatus(
        event,
        snapshot.status,
        index === visibleEvents.length - 1,
      ),
      tone: processStepTone(event),
      agentId: event.agentId,
      contextLabel: processContextLabel(event),
    }));

  if (hasDeniedApproval(snapshot)) {
    const deniedAt = latestEventTime(snapshot, "run.cancelled") ?? snapshot.updatedAt;
    steps.push({
      id: `${snapshot.runId}:approval-denied`,
      eventType: "approval.denied",
      label: APPROVAL_DENIED_STEP_LABEL,
      detail: APPROVAL_DENIED_STEP_DETAIL,
      timestamp: formatElapsed(snapshot.events[0]?.createdAt ?? deniedAt, deniedAt),
      status: "blocked",
      tone: "warning",
    });
  }

  return steps;
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
    case "artifact.degraded":
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
    isVisibleChatProgressSource(event.payload.source) &&
    typeof event.payload.summary === "string" &&
    event.payload.summary.trim().length > 0
  );
}

function isVisibleChatProgressSource(source: unknown): boolean {
  return source === "progress_narrator" || source === "runtime_status";
}

function isPlaceholderProgressText(text: string): boolean {
  return text === "正在努力";
}

function processStepLabel(event: OraEventEnvelope): string {
  if (event.type === "node.updated" && isRecord(event.payload)) {
    switch (event.payload.state) {
      case "interrupted":
        return isApprovalInterruptDetail(stringValue(event.payload.detail) ?? "")
          ? "Waiting for approval"
          : "Interrupted";
      case "repairing":
        return "Recovered";
      case "degraded":
        return "Continued with limited context";
      case "failed":
        return "Failed";
      default:
        return "Processing state changed";
    }
  }
  if (
    (event.type === "tool.called" || event.type === "tool.repaired") &&
    isRecord(event.payload)
  ) {
    if (event.type === "tool.repaired") {
      return "Recovered";
    }
    return toolCallLabel(event.payload);
  }
  if (event.type === "completion.updated") {
    return "Stopped tool use";
  }
  if (event.type === "approval.required") {
    return "Waiting for approval";
  }
  if (event.type === "clarification.required") {
    return "Waiting for clarification";
  }
  if (event.type === "action.updated") {
    return "Action failed";
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
        ? `Recovered missing tool result for ${actionDetail}.`
        : "Recovered a missing tool result so the run could continue.";
    }
    if (status === "failed" && typeof event.payload.error === "string") {
      return `${actionDetail ?? title} failed: ${event.payload.error}`;
    }
    if (actionDetail) {
      return status === "failed"
        ? `${actionDetail} failed.`
        : `${actionDetail}.`;
    }
    return status ? `${title} ${status}.` : `${title} completed.`;
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
      ? `Degraded ${label}.`
      : `Published ${label}.`;
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
    return `Skipped ${event.payload.nodeLabel}.`;
  }
  if (
    event.type === "node.updated" &&
    isRecord(event.payload) &&
    typeof event.payload.state === "string"
  ) {
    const detail =
      typeof event.payload.detail === "string" && event.payload.detail.trim()
        ? ` ${event.payload.detail.trim()}`
        : "";
    switch (event.payload.state) {
      case "repairing":
        return `Recovered missing tool context${detail}.`;
      case "degraded":
        return `Continued with limited context${detail}.`;
      case "interrupted":
        if (isApprovalInterruptDetail(detail.trim())) {
          return APPROVAL_INTERRUPT_MESSAGE;
        }
        return `Paused after processing was interrupted${detail}.`;
      case "failed":
        return `Processing step failed${detail}.`;
      default:
        return `Processing state changed${detail}.`;
    }
  }
  return detail;
}

function isApprovalInterruptDetail(detail: string): boolean {
  return (
    detail === APPROVAL_INTERRUPT_MESSAGE ||
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
    case "skills.create":
      return "安装技能";
    case "skills.checkName":
      return "检查技能名称";
    case "skills.list":
      return "列出技能";
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
  const input = isRecord(payload.input) ? payload.input : {};
  const output = isRecord(payload.output) ? payload.output : {};
  const targetPath = stringValue(output.path) ?? stringValue(input.path);

  switch (toolId) {
    case "file.read":
      return targetPath
        ? `已读取 ${targetPath}${sizeSuffix(output.sizeBytes)}`
        : undefined;
    case "file.list":
      return targetPath
        ? `已列出 ${targetPath}${countSuffix(output.entries, "项")}`
        : undefined;
    case "file.glob": {
      const pattern = stringValue(output.pattern) ?? stringValue(input.pattern);
      const basePath = stringValue(input.path);
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
      const scope = stringValue(input.include) ?? stringValue(input.path);
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
    case "skills.list":
      return "已检查已安装技能";
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

function humanizeActionError(error: string): string {
  if (/tool call instead of a final answer after completion control disabled tools/i.test(error)) {
    return "The model tried to call another tool after Ora had stopped tool use, so the turn ended with the available answer.";
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
  return `Could not complete this operation: ${error}`;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
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

  const input = isRecord(payload.input) ? payload.input : {};
  const output = isRecord(payload.output) ? payload.output : {};
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
    previewable: artifact.mimeType.startsWith("image/"),
  };
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

function deriveTurnTodos(snapshot: OraStateSnapshot): TurnTodoItem[] {
  const runtimeTodos = readRuntimeTodos(snapshot.todos);
  if (runtimeTodos.length > 0 && !todosMirrorPlan(snapshot)) {
    return runtimeTodos;
  }

  if (planLooksLikeTemplate(snapshot)) {
    return [];
  }

  return snapshot.plan.map((item) => ({
    id: item.id,
    label: item.title,
    status: todoStatusFromPlan(item.status),
    owner: item.ownerAgentId ?? "runtime",
    detail:
      item.linkedActionIds.length > 0
        ? `${item.linkedActionIds.length} linked action${item.linkedActionIds.length === 1 ? "" : "s"}`
        : undefined,
  }));
}

function todosMirrorPlan(snapshot: OraStateSnapshot): boolean {
  if (
    !snapshot.todos ||
    snapshot.todos.length === 0 ||
    snapshot.todos.length !== snapshot.plan.length
  ) {
    return false;
  }

  const planById = new Map(snapshot.plan.map((item) => [item.id, item]));
  return snapshot.todos.every((todo) => {
    const planItem = todo.sourcePlanItemId
      ? planById.get(todo.sourcePlanItemId)
      : undefined;
    return (
      planItem &&
      todo.label === planItem.title &&
      todo.status === planItem.status &&
      !todo.detail
    );
  });
}

function planLooksLikeTemplate(snapshot: OraStateSnapshot): boolean {
  if (!snapshot.modeSpec || snapshot.plan.length === 0) {
    return false;
  }

  const template = modeSpecToPatternDefinition(snapshot.modeSpec).planTemplate;
  if (template.length !== snapshot.plan.length) {
    return false;
  }

  return snapshot.plan.every((item, index) => {
    const templateItem = template[index];
    return (
      templateItem &&
      item.id === `${snapshot.runId}:${templateItem.id}` &&
      item.title === templateItem.title &&
      item.ownerAgentId === templateItem.ownerAgentId
    );
  });
}

function readRuntimeTodos(
  todos: OraStateSnapshot["todos"] | undefined,
): TurnTodoItem[] {
  return (todos ?? []).map((item, index) => ({
    id: item.id || `todo-${index}`,
    label: item.label,
    status: todoStatusFromPlan(item.status),
    detail: item.detail,
  }));
}

function todoStatusFromPlan(
  status: OraPlanItem["status"],
): TurnTodoItem["status"] {
  switch (status) {
    case "running":
      return "running";
    case "blocked":
    case "failed":
      return "blocked";
    case "done":
    case "skipped":
      return "done";
    case "planned":
    case "ready":
    default:
      return "queued";
  }
}

function placeholderAssistantCopy(snapshot?: OraStateSnapshot): string {
  if (!snapshot) {
    return "";
  }

  if (snapshotPendingClarifications(snapshot).length > 0) {
    return clarificationTextFromSnapshot(snapshot) ?? "";
  }

  if (
    snapshotPendingApprovals(snapshot).length > 0 ||
    snapshot.actions.some((action) => action.status === "approval_required")
  ) {
    return approvalPendingTextFromSnapshot(snapshot) ?? "";
  }

  switch (snapshot.status) {
    case "running":
    case "queued":
      return progressTextFromSnapshot(snapshot) ?? "";
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
