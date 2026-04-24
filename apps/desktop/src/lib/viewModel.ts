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

export function buildWorkbenchViewModel(
  patterns: OraPatternDefinition[],
  modes: OraModeSpec[],
  sessions: OraSessionSummary[],
  sessionDetail: OraSessionDetail,
  activeSnapshot: OraStateSnapshot | undefined,
  selectedPattern: CoordinationPattern,
  selectedModeId: string,
): WorkbenchViewModel {
  const selectedMode = modes.find((mode) => mode.id === selectedModeId) ?? modes[0];
  const activeDefinition = selectedMode ? modeSpecToPatternDefinition(selectedMode) : findPattern(patterns, selectedPattern);
  const effectivePattern = activeDefinition.id;
  const detailSnapshot =
    activeSnapshot ?? sessionDetail.latestSnapshot ?? createEmptySessionPreview(activeDefinition, sessionDetail.session, selectedMode);
  const selectedPatternSnapshot =
    detailSnapshot.pattern === effectivePattern && detailSnapshot.modeId === selectedMode?.id
      ? detailSnapshot
      : createPreviewFromPattern(detailSnapshot, activeDefinition, selectedMode);

  const patternCards = patterns.map(adaptPatternCard);
  const modeCards = modes.map(adaptModeCard);
  const activePattern = patternCards.find((pattern) => pattern.id === effectivePattern) ?? patternCards[0];
  const activeMode = selectedMode ? adaptModeCard(selectedMode) : modeCards[0];

  return {
    patternCards,
    modeCards,
    sessions: sessions.map((session) => adaptSession(session, effectivePattern)),
    turns: sessionDetail.turns.map(adaptTurn),
    topologyNodes: adaptTopologyNodes(selectedPatternSnapshot.topology.nodes, effectivePattern),
    topologyEdges: adaptTopologyEdges(selectedPatternSnapshot.topology.edges),
    streamLines: adaptStreamLines(detailSnapshot.events),
    agents: selectedPatternSnapshot.profiles.map(adaptAgentProfile),
    memoryRecords: adaptMemoryRecords(selectedPatternSnapshot.memory, selectedPatternSnapshot.profiles),
    planItems: selectedPatternSnapshot.plan.map(adaptPlanItem),
    actions: selectedPatternSnapshot.actions.map(adaptActionRecord),
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
    status: "queued",
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
    policyDecisions: [],
    checkpoints: [],
    events: [],
    artifacts: [],
    todos: [],
    activeAgents: [],
    queueSummary: { mode: "dag", pending: 0, inProgress: 0, completed: 0, topics: [] },
    sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
    busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
    pendingClarifications: [],
    pendingApprovals: [],
    updatedAt: now,
  };
}

export function findPattern(
  patterns: OraPatternDefinition[],
  pattern: CoordinationPattern,
): OraPatternDefinition {
  return patterns.find((definition) => definition.id === pattern) ?? patterns[0];
}

function createPreviewFromPattern(
  snapshot: OraStateSnapshot,
  definition: OraPatternDefinition,
  selectedMode?: OraModeSpec,
): OraStateSnapshot {
  const previewPlan: OraPlanItem[] = definition.planTemplate.map((item, index) => ({
    id: `${snapshot.runId}:preview:${item.id}`,
    runId: snapshot.runId,
    ownerAgentId: item.ownerAgentId,
    status: (index === 0 ? "ready" : "planned") as OraPlanItem["status"],
    title: item.title,
    dependencies: item.dependencies,
    linkedActionIds: [],
    checkpointIds: snapshot.checkpoints.map((checkpoint) => checkpoint.id),
  }));
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
    recommendedUse: mode.recommendedUse ?? `Use when ${mode.family.replace(/_/g, " ")} fits the task.`,
    failureMode: mode.failureMode ?? "Misconfigured stages can reduce observability or waste budget.",
    isPreset: mode.systemPreset,
  };
}

function adaptSession(session: OraSessionSummary, fallbackPattern: CoordinationPattern): SessionRun {
  return {
    id: session.sessionId,
    title: session.title,
    project: session.projectId ?? "Recent chat",
    status: adaptRunStatus(session.status ?? "succeeded"),
    pattern: session.latestPattern ?? fallbackPattern,
    modeId: session.latestModeId,
    updatedAt: formatClock(session.updatedAt),
    health: session.status === "failed" ? 42 : session.status === "interrupted" ? 68 : 94,
    latestRunId: session.latestRunId,
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

function adaptTopologyNodes(nodes: OraTopologyNode[], pattern: CoordinationPattern): TopologyNode[] {
  const layout = nodeLayout(pattern, nodes);

  return nodes.map((node, index) => ({
    id: node.id,
    label: node.label,
    kind: node.kind,
    role: roleForNode(node),
    agentId: node.agentId,
    status: adaptNodeStatus(node.status),
    atomId: typeof node.metadata.atomId === "string" ? node.metadata.atomId : undefined,
    atomScope: node.metadata.atomScope === "mode" || node.metadata.atomScope === "node" ? node.metadata.atomScope : undefined,
    atomPresentation:
      node.metadata.atomPresentation === "mode_capability"
      || node.metadata.atomPresentation === "stage_attachment"
      || node.metadata.atomPresentation === "family_capability"
        ? node.metadata.atomPresentation
        : undefined,
    sourceNodeId: typeof node.metadata.sourceNodeId === "string" ? node.metadata.sourceNodeId : undefined,
    active: typeof node.metadata.atomActive === "boolean" ? node.metadata.atomActive : undefined,
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
    const scope = node.metadata.atomScope === "mode" || node.metadata.atomScope === "node"
      ? node.metadata.atomScope
      : "runtime";
    const source = typeof node.metadata.sourceNodeLabel === "string" ? ` · ${node.metadata.sourceNodeLabel}` : "";
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

function adaptNodeStatus(status: OraTopologyNode["status"]): TopologyNode["status"] {
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
      ["run.started", "topology.updated", "plan.updated", "message.delta", "checkpoint.created", "run.done", "run.failed"].includes(
        event.type,
      ),
    )
    .map((event) => ({
      source: event.nodeId ?? event.agentId ?? event.type,
      text: eventText(event),
    }));

  return lines.length > 0
    ? lines
    : [{ source: "runtime", text: "Waiting for Ora event envelopes from the runtime bridge." }];
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
    case "topology.updated":
      return "Topology updated from Ora runtime state.";
    case "plan.updated":
      return "Plan records refreshed from runtime state.";
    case "task.started":
      return "Delegated task accepted and entered the runtime timeline.";
    case "task.progress":
      return "Delegated task is still in flight.";
    case "task.completed":
      return "Delegated task finished and its output can be consumed downstream.";
    case "task.failed":
      return "Delegated task failed before the downstream stage could continue.";
    case "clarification.required":
      return "Runtime paused until the missing user clarification is provided.";
    case "clarification.resolved":
      return "Clarification answer recorded and the run can continue.";
    case "run.done":
      return "Run completed and checkpoint metadata is available.";
    case "run.failed":
      return "Run failed. Context dock contains the latest state.";
    default:
      return "Runtime event received.";
  }
}

function adaptAgentProfile(profile: OraAgentProfile): AgentProfile {
  return {
    id: profile.id,
    label: profile.label,
    role: profile.role,
    model: profile.modelRef,
    tools: [profile.toolPolicyId],
    budget: `${Math.round(profile.budget.maxRuntimeMs / 60000)} min / ${profile.budget.maxTokens.toLocaleString()} tokens`,
    memoryScopes: profile.memoryNamespaces,
  };
}

function adaptMemoryRecords(records: OraMemoryRecord[], profiles: OraAgentProfile[]): MemoryRecord[] {
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
  if (["profile", "project", "session", "worker", "artifact"].includes(namespace)) {
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

function adaptActionRecord(action: OraActionRecord): ActionRecord {
  return {
    id: action.id,
    label: action.type.replace(/\./g, " "),
    state: adaptActionStatus(action.status),
    consequence: actionConsequence(action),
    risk: action.riskLevel,
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

function adaptActionStatus(status: OraActionRecord["status"]): ActionRecord["state"] {
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
    return "High-risk action requires explicit operator approval before execution.";
  }
  if (action.status === "approval_required") {
    return "Runtime paused this external effect behind an approval gate.";
  }
  if (action.status === "succeeded") {
    return "Runtime recorded this effect in the action ledger.";
  }
  return "Runtime proposed this action with linked plan and checkpoint context.";
}

function adaptFilmstripBeats(snapshot: OraStateSnapshot): RunBeat[] {
  const beats = snapshot.events.map((event) => ({
    id: event.id,
    group: beatGroup(event),
    label: beatLabel(event),
    time: formatElapsed(snapshot.events[0]?.createdAt ?? event.createdAt, event.createdAt),
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
    case "message.delta":
      return "Stream";
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

function nodeLayout(pattern: CoordinationPattern, nodes: OraTopologyNode[]): Array<{ x: number; y: number }> {
  const count = nodes.length;
  const capabilities = nodes.filter((node) => node.kind === "capability");
  if (capabilities.length > 0) {
    const primaryNodes = nodes.filter((node) => node.kind !== "capability");
    const base = baseNodeLayout(pattern, Math.max(primaryNodes.length, 1));
    const positions = new Map<string, { x: number; y: number }>();

    primaryNodes.forEach((node, index) => {
      positions.set(node.id, base[index] ?? { x: 80 + index * 150, y: 92 });
    });

    const floatingCapabilities = capabilities.filter((node) => node.metadata.atomPresentation !== "stage_attachment");
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
        const sourceNodeId = typeof node.metadata.sourceNodeId === "string" ? node.metadata.sourceNodeId : undefined;
        const anchor = sourceNodeId ? positions.get(sourceNodeId) : undefined;
        const countForSource = attachmentCounts.get(sourceNodeId ?? node.id) ?? 0;
        attachmentCounts.set(sourceNodeId ?? node.id, countForSource + 1);
        positions.set(node.id, {
          x: (anchor?.x ?? 80) + 18,
          y: (anchor?.y ?? 92) + 106 + countForSource * 58,
        });
      });

    return nodes.map((node, index) => positions.get(node.id) ?? { x: 80 + index * 150, y: 92 });
  }

  return baseNodeLayout(pattern, count);
}

function baseNodeLayout(pattern: CoordinationPattern, count: number): Array<{ x: number; y: number }> {
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
      }

      const assistantTurn = turn.snapshot ? buildAssistantTurnAttachment(turn.snapshot) : undefined;
      const snapshotAssistant = turn.snapshot ? assistantTextFromSnapshot(turn.snapshot) : undefined;
      if (turn.assistant || assistantTurn) {
        messages.push({
          id: turn.assistant?.id ?? `${turn.runId}:assistant-pending`,
          role: "assistant",
          content: snapshotAssistant ?? turn.assistant?.content ?? placeholderAssistantCopy(turn.snapshot),
          timestamp: formatClock(turn.assistant?.createdAt ?? turn.snapshot?.updatedAt ?? Date.now()),
          metadata: {
            runId: turn.runId,
            turnIndex: turn.turnIndex,
            pattern: turn.pattern,
          },
          turn: assistantTurn,
          isPlaceholder: !turn.assistant && (!assistantTurn || assistantTurn.status === "running"),
        });
      }

      return messages;
  });
}

function assistantTextFromSnapshot(snapshot: OraStateSnapshot): string | undefined {
  const outputText = outputTextFromSnapshot(snapshot);
  if (outputText) {
    return outputText;
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

function outputTextFromSnapshot(snapshot: OraStateSnapshot): string | undefined {
  if (typeof snapshot.output === "string" && snapshot.output.trim()) {
    return snapshot.output.trim();
  }
  if (isRecord(snapshot.output) && typeof snapshot.output.text === "string" && snapshot.output.text.trim()) {
    return snapshot.output.text.trim();
  }
  return undefined;
}

function isInternalVerifierDelta(snapshot: OraStateSnapshot, event: OraEventEnvelope): boolean {
  if (snapshot.pattern !== "generator_verifier") {
    return false;
  }
  const agentId = typeof event.agentId === "string" ? event.agentId : undefined;
  const nodeId = typeof event.nodeId === "string" ? event.nodeId : undefined;
  return agentId === "verifier" || nodeId === "verifier";
}

function buildAssistantTurnAttachment(snapshot: OraStateSnapshot): AssistantTurnAttachment {
  return {
    runId: snapshot.runId,
    turnIndex: snapshot.turnIndex ?? 1,
    status: adaptRunStatus(snapshot.status),
    pattern: snapshot.pattern,
    processSteps: deriveProcessSteps(snapshot),
    artifacts: snapshot.artifacts.map(adaptTurnArtifact),
    todos: deriveTurnTodos(snapshot),
    approvalCount: snapshot.pendingApprovals.length,
    clarificationCount: snapshot.pendingClarifications.length,
  };
}

function deriveProcessSteps(snapshot: OraStateSnapshot): TurnProcessStep[] {
  const events = snapshot.events.filter(shouldShowProcessEvent);
  const hasWorkEvent = events.some(isWorkProcessEvent);

  return events
    .filter((event) => hasWorkEvent || !isLifecycleProcessEvent(event))
    .map((event) => ({
      id: event.id,
      eventType: event.type,
      label: beatLabel(event),
      detail: processStepDetail(event),
      timestamp: formatElapsed(snapshot.events[0]?.createdAt ?? event.createdAt, event.createdAt),
      status: processStepStatus(event),
      tone: processStepTone(event),
      agentId: event.agentId,
      contextLabel: processContextLabel(event),
    }));
}

function shouldShowProcessEvent(event: OraEventEnvelope): boolean {
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
      return hasToolId(event);
    case "checkpoint.created":
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
    case "action.updated":
      return actionStatusFromEvent(event) === "failed";
    default:
      return false;
  }
}

function processStepDetail(event: OraEventEnvelope): string {
  const detail = eventText(event);
  if (event.type === "tool.called" && isRecord(event.payload)) {
    const title = toolCallLabel(event.payload);
    const status = typeof event.payload.status === "string" ? event.payload.status : undefined;
    const actionDetail = toolCallDetail(event.payload);
    if (status === "failed" && typeof event.payload.error === "string") {
      return `${actionDetail ?? title} failed: ${event.payload.error}`;
    }
    if (actionDetail) {
      return status === "failed" ? `${actionDetail} failed.` : `${actionDetail}.`;
    }
    return status ? `${title} ${status}.` : `${title} completed.`;
  }
  if ((event.type === "artifact.exported" || event.type === "artifact.degraded") && isRecord(event.payload)) {
    const label = isRecord(event.payload.artifact) && typeof event.payload.artifact.label === "string"
      ? event.payload.artifact.label
      : typeof event.payload.label === "string"
        ? event.payload.label
        : "artifact";
    return event.type === "artifact.degraded" ? `Degraded ${label}.` : `Published ${label}.`;
  }
  if (event.type.startsWith("recovery.") && isRecord(event.payload) && isRecord(event.payload.decision) && typeof event.payload.decision.summary === "string") {
    return event.payload.decision.summary;
  }
  if (event.type === "node.skipped" && isRecord(event.payload) && typeof event.payload.nodeLabel === "string") {
    return `Skipped ${event.payload.nodeLabel}.`;
  }
  if (event.type === "checkpoint.created" && isRecord(event.payload) && isRecord(event.payload.checkpoint) && typeof event.payload.checkpoint.label === "string") {
    return `Checkpoint created: ${event.payload.checkpoint.label}.`;
  }
  return detail;
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
    case "recovery.detected":
    case "recovery.retry_scheduled":
    case "recovery.applied":
    case "recovery.exhausted":
    case "node.skipped":
      return true;
    default:
      return false;
  }
}

function isLifecycleProcessEvent(event: OraEventEnvelope): boolean {
  return event.type === "checkpoint.created" || event.type === "run.done" || event.type === "run.failed";
}

function hasToolId(event: OraEventEnvelope): boolean {
  return isRecord(event.payload) && typeof event.payload.toolId === "string" && event.payload.toolId.length > 0;
}

function toolCallLabel(payload: Record<string, unknown>): string {
  return typeof payload.toolId === "string" && payload.toolId.length > 0
    ? payload.toolId
    : typeof payload.title === "string" && payload.title.length > 0
      ? payload.title
      : "Runtime call";
}

function toolCallDetail(payload: Record<string, unknown>): string | undefined {
  const toolId = typeof payload.toolId === "string" ? payload.toolId : undefined;
  const input = isRecord(payload.input) ? payload.input : {};
  const output = isRecord(payload.output) ? payload.output : {};
  const targetPath = stringValue(output.path) ?? stringValue(input.path);

  switch (toolId) {
    case "file.read":
      return targetPath ? `Read ${targetPath}${sizeSuffix(output.sizeBytes)}` : undefined;
    case "file.list":
      return targetPath ? `Listed ${targetPath}${countSuffix(output.entries, "entry", "entries")}` : undefined;
    case "file.glob": {
      const pattern = stringValue(output.pattern) ?? stringValue(input.pattern);
      const basePath = stringValue(input.path);
      if (!pattern) {
        return undefined;
      }
      return `Matched ${pattern}${basePath ? ` under ${basePath}` : ""}${countSuffix(output.matches, "match", "matches")}`;
    }
    case "file.grep": {
      const pattern = stringValue(output.pattern) ?? stringValue(input.pattern);
      if (!pattern) {
        return undefined;
      }
      const scope = stringValue(input.include) ?? stringValue(input.path);
      const truncated = output.truncated === true ? ", truncated" : "";
      return `Searched for "${pattern}"${scope ? ` in ${scope}` : ""}${countSuffix(output.matches, "match", "matches")}${truncated}`;
    }
    case "file.write":
      return targetPath ? `Wrote ${targetPath}${sizeSuffix(output.sizeBytes)}` : undefined;
    case "file.patch": {
      const replacements = typeof output.replacements === "number" ? ` (${output.replacements} replacement${output.replacements === 1 ? "" : "s"})` : "";
      return targetPath ? `Patched ${targetPath}${replacements}` : undefined;
    }
    case "shell.execute": {
      const command = stringValue(output.command) ?? stringValue(input.command);
      const exitCode = typeof output.exitCode === "number" ? ` (exit ${output.exitCode})` : "";
      return command ? `Ran ${command}${exitCode}` : undefined;
    }
    case "web.fetch": {
      const url = stringValue(output.url) ?? stringValue(input.url);
      const status = typeof output.status === "number" ? ` (${output.status})` : "";
      return url ? `Fetched ${url}${status}` : undefined;
    }
    case "web.search": {
      const query = stringValue(output.query) ?? stringValue(input.query);
      return query ? `Searched the web for "${query}"${countSuffix(output.results, "result", "results")}` : undefined;
    }
    case "mcp.listTools": {
      const server = stringValue(input.server);
      return server ? `Listed MCP tools from ${server}` : "Listed MCP tools";
    }
    case "mcp.readResource": {
      const uri = stringValue(input.uri);
      const server = stringValue(input.server);
      return uri ? `Read MCP resource ${uri}${server ? ` from ${server}` : ""}` : undefined;
    }
    case "mcp.call": {
      const name = stringValue(input.name);
      const server = stringValue(input.server);
      return name ? `Called MCP tool ${name}${server ? ` on ${server}` : ""}` : undefined;
    }
    default:
      return undefined;
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function sizeSuffix(value: unknown): string {
  return typeof value === "number" ? ` (${formatBytes(value)})` : "";
}

function countSuffix(value: unknown, singular: string, plural: string): string {
  if (!Array.isArray(value)) {
    return "";
  }
  return ` (${value.length} ${value.length === 1 ? singular : plural})`;
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

function processStepStatus(event: OraEventEnvelope): TurnProcessStep["status"] {
  switch (event.type) {
    case "task.progress":
      return "active";
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

  return typeof event.payload.status === "string" ? event.payload.status : undefined;
}

function processStepTone(event: OraEventEnvelope): TurnProcessStep["tone"] {
  switch (event.type) {
    case "approval.required":
    case "clarification.required":
      return "warning";
    case "artifact.exported":
    case "artifact.degraded":
    case "recovery.applied":
    case "node.skipped":
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

  if (isRecord(event.payload.checkpoint) && typeof event.payload.checkpoint.id === "string") {
    return event.payload.checkpoint.id;
  }

  return undefined;
}

function processToolTargetLabel(payload: Record<string, unknown>): string | undefined {
  if (typeof payload.toolId !== "string") {
    return undefined;
  }

  const input = isRecord(payload.input) ? payload.input : {};
  const output = isRecord(payload.output) ? payload.output : {};
  return stringValue(output.path)
    ?? stringValue(input.path)
    ?? stringValue(output.url)
    ?? stringValue(input.url)
    ?? stringValue(output.query)
    ?? stringValue(input.query)
    ?? stringValue(input.uri)
    ?? stringValue(input.name)
    ?? stringValue(input.command)
    ?? payload.toolId;
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
    detail: item.linkedActionIds.length > 0 ? `${item.linkedActionIds.length} linked action${item.linkedActionIds.length === 1 ? "" : "s"}` : undefined,
  }));
}

function todosMirrorPlan(snapshot: OraStateSnapshot): boolean {
  if (!snapshot.todos || snapshot.todos.length === 0 || snapshot.todos.length !== snapshot.plan.length) {
    return false;
  }

  const planById = new Map(snapshot.plan.map((item) => [item.id, item]));
  return snapshot.todos.every((todo) => {
    const planItem = todo.sourcePlanItemId ? planById.get(todo.sourcePlanItemId) : undefined;
    return planItem
      && todo.label === planItem.title
      && todo.status === planItem.status
      && !todo.detail;
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
    return templateItem
      && item.id === `${snapshot.runId}:${templateItem.id}`
      && item.title === templateItem.title
      && item.ownerAgentId === templateItem.ownerAgentId;
  });
}

function readRuntimeTodos(todos: OraStateSnapshot["todos"] | undefined): TurnTodoItem[] {
  return (todos ?? []).map((item, index) => ({
    id: item.id || `todo-${index}`,
    label: item.label,
    status: todoStatusFromPlan(item.status),
    detail: item.detail,
  }));
}

function todoStatusFromPlan(status: OraPlanItem["status"]): TurnTodoItem["status"] {
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
    return "Working on it...";
  }

  if (snapshot.pendingClarifications.length > 0) {
    return "I need a bit more information before I can continue this turn.";
  }

  if (snapshot.pendingApprovals.length > 0 || snapshot.actions.some((action) => action.status === "approval_required")) {
    return "I'm waiting for approval before continuing this turn.";
  }

  switch (snapshot.status) {
    case "running":
    case "queued":
      return "Working on it...";
    case "failed":
    case "cancelled":
    case "interrupted":
      return snapshot.error ?? "This turn did not produce a final assistant reply.";
    case "succeeded":
      return snapshot.artifacts.length > 0 ? "This turn completed and produced attachments below." : "This turn completed without a final assistant reply.";
  }
}
