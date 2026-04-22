import type {
  ActionRecord,
  AgentProfile,
  ArtifactRecord,
  CheckpointRecord,
  CoordinationPattern,
  MemoryRecord,
  PatternCard,
  PlanItem,
  RunBeat,
  RunStatus,
  SessionRun,
  StreamLine,
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
  OraPatternDefinition,
  OraPlanItem,
  OraStateSnapshot,
  OraTopologyEdge,
  OraTopologyNode,
} from "./runtimeClient";

export interface WorkbenchViewModel {
  patternCards: PatternCard[];
  sessions: SessionRun[];
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
  activeSnapshot: OraStateSnapshot;
}

export function buildWorkbenchViewModel(
  patterns: OraPatternDefinition[],
  snapshots: OraStateSnapshot[],
  selectedPattern: CoordinationPattern,
  selectedSessionId?: string,
): WorkbenchViewModel {
  const activeSnapshot = snapshots.find((snapshot) => snapshot.runId === selectedSessionId) ?? snapshots[0];
  const activeDefinition = findPattern(patterns, selectedPattern);
  const selectedPatternSnapshot =
    activeSnapshot.pattern === selectedPattern ? activeSnapshot : createPreviewFromPattern(activeSnapshot, activeDefinition);

  const patternCards = patterns.map(adaptPatternCard);
  const activePattern = patternCards.find((pattern) => pattern.id === selectedPattern) ?? patternCards[0];

  return {
    patternCards,
    sessions: snapshots.map(adaptSession),
    topologyNodes: adaptTopologyNodes(selectedPatternSnapshot.topology.nodes, selectedPattern),
    topologyEdges: adaptTopologyEdges(selectedPatternSnapshot.topology.edges),
    streamLines: adaptStreamLines(activeSnapshot.events),
    agents: selectedPatternSnapshot.profiles.map(adaptAgentProfile),
    memoryRecords: adaptMemoryRecords(selectedPatternSnapshot.memory, selectedPatternSnapshot.profiles),
    planItems: selectedPatternSnapshot.plan.map(adaptPlanItem),
    actions: selectedPatternSnapshot.actions.map(adaptActionRecord),
    checkpoints: activeSnapshot.checkpoints.map(adaptCheckpoint),
    artifacts: activeSnapshot.artifacts.map(adaptArtifact),
    beats: adaptFilmstripBeats(activeSnapshot),
    activePattern,
    activeSnapshot,
  };
}

export function findPattern(
  patterns: OraPatternDefinition[],
  pattern: CoordinationPattern,
): OraPatternDefinition {
  return patterns.find((definition) => definition.id === pattern) ?? patterns[0];
}

function createPreviewFromPattern(snapshot: OraStateSnapshot, definition: OraPatternDefinition): OraStateSnapshot {
  return {
    ...snapshot,
    pattern: definition.id,
    topology: definition.topology,
    profiles: definition.profiles,
    plan: definition.planTemplate.map((item, index) => ({
      id: `${snapshot.runId}:preview:${item.id}`,
      runId: snapshot.runId,
      ownerAgentId: item.ownerAgentId,
      status: index === 0 ? "ready" : "planned",
      title: item.title,
      dependencies: item.dependencies,
      linkedActionIds: [],
      checkpointIds: snapshot.checkpoints.map((checkpoint) => checkpoint.id),
    })),
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

function adaptSession(snapshot: OraStateSnapshot): SessionRun {
  return {
    id: snapshot.runId,
    title: snapshot.input.prompt,
    project: snapshot.input.projectId ?? "Ora MVP",
    status: adaptRunStatus(snapshot.status),
    pattern: snapshot.pattern,
    updatedAt: formatClock(snapshot.updatedAt),
    health: snapshot.status === "failed" ? 42 : snapshot.status === "interrupted" ? 68 : 94,
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
  const layout = nodeLayout(pattern, nodes.length);

  return nodes.map((node, index) => ({
    id: node.id,
    label: node.label,
    role: roleForNode(node),
    agentId: node.agentId,
    status: adaptNodeStatus(node.status),
    x: layout[index]?.x ?? 80 + index * 150,
    y: layout[index]?.y ?? 84,
  }));
}

function adaptTopologyEdges(edges: OraTopologyEdge[]): TopologyEdge[] {
  return edges.map((edge) => ({
    from: edge.source,
    to: edge.target,
    label: edge.label ?? edge.kind,
  }));
}

function roleForNode(node: OraTopologyNode): string {
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
    case "approval.required":
    case "approval.resolved":
    case "action.updated":
      return "approval";
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
    case "memory.updated":
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
    case "profile.updated":
      return "Profile";
    case "memory.updated":
      return "Memory";
    case "plan.updated":
      return "Plan";
    case "action.updated":
      return "Action";
    case "approval.required":
      return "Approval";
    case "approval.resolved":
      return "Approval done";
    case "message.delta":
      return "Stream";
    case "token.delta":
      return "Token";
    case "checkpoint.created":
      return "Checkpoint";
    case "artifact.exported":
      return "Artifact";
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

function nodeLayout(pattern: CoordinationPattern, count: number): Array<{ x: number; y: number }> {
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
