import type {
  AgentConversationTranscript,
  BusStats,
  CoordinationPattern,
  MemoryKind,
  QueueSummary,
  SharedStateSummary,
} from "@cemeworm/shared";

// ── Evidence Board ────────────────────────────────────────────────

export interface EvidenceEntry {
  id: string;
  agentId: string;
  nodeId: string;
  timestamp: number;
  kind: "file_read" | "search_result" | "tool_output" | "finding";
  summary: string;
  /** Key excerpt, not full content — keep under ~2KB per entry. */
  content: string;
  /** File path / URL / tool name. */
  source: string;
  relevance: "critical" | "supporting" | "background";
}

export interface EvidenceBoard {
  entries: EvidenceEntry[];
}

export interface PatternModeResumeState {
  activeFrameId?: string;
  activeNodeId?: string;
  activeAgentId?: string;
  bag: Record<string, unknown>;
  completedNodeIds: string[];
}

export interface PatternExecutionContext {
  projectId: string;
  queueSummary: QueueSummary;
  sharedStateSummary: SharedStateSummary;
  busStats: BusStats;
  modeResume?: PatternModeResumeState;
  /** Evidence accumulated during mode execution (shared across agents). */
  evidenceBoard: EvidenceBoard;
  systemPrompt(extra: string): string;
  setPlanStatus(templateId: string, status: "planned" | "ready" | "running" | "blocked" | "done" | "failed" | "skipped"): void;
  setQueueSummary(patch: Partial<QueueSummary>): void;
  checkpointNode(params: {
    nodeId: string;
    nodeTemplate: string;
    nodeLabel: string;
    agentId?: string;
    status: "started" | "completed" | "failed" | "skipped";
    bag: Record<string, unknown>;
    output?: unknown;
  }): void;
  runRecoverableNode<T>(params: {
    nodeId: string;
    nodeTemplate: string;
    nodeLabel: string;
    agentId?: string;
  }, execute: () => Promise<T>): Promise<{ status: "completed"; output: T } | { status: "skipped"; output?: unknown }>;
  runDelegatedTask<T>(params: {
    taskId: string;
    nodeId: string;
    nodeLabel: string;
    agentId: string;
    title: string;
  }, execute: () => Promise<T>): Promise<T>;
  ensureClarification(params: {
    id: string;
    key: string;
    nodeId: string;
    nodeLabel: string;
    question: string;
    narrate?: boolean;
  }): Promise<unknown>;
  claimWorker(agentId: string): void;
  releaseWorker(agentId: string): void;
  agentLabel(agentId: string): string;
  resumeSuspendedNode?(params: {
    nodeId: string;
    agentId: string;
    title: string;
  }): Promise<unknown | undefined>;
  callAgent(params: {
    agentId: string;
    planItemId?: string;
    title: string;
    prompt: string;
    system: string;
    customAgentId?: string;
    riskLevel?: "low" | "medium" | "high";
  }): Promise<string>;
  remember(params: {
    id: string;
    namespace: string[];
    kind: "profile" | "project" | "session" | "worker" | "artifact";
    value: unknown;
    sourceActionId?: string;
  }): void;
  captureMemory(params: {
    id: string;
    namespace: string[];
    kind: MemoryKind;
    value: unknown;
    sourceActionId?: string;
  }): void;
  publishArtifact(params: {
    id: string;
    label: string;
    kind?: "report" | "file" | "log";
    mimeType?: string;
    payload: unknown;
  }): void;
  /** Append an evidence entry to the shared board. Called after tool-use. */
  writeEvidence(entry: Omit<EvidenceEntry, "id" | "timestamp">): void;
  publishMessage(params: {
    agentId: string;
    topic: string;
    correlationId: string;
    summary: string;
    payload: unknown;
  }): void;
  routeMessage(params: {
    agentId: string;
    fromTopic: string;
    toTopic: string;
    correlationId: string;
    summary: string;
  }): void;
  emitAgentMessage(params: {
    fromAgentId: string;
    toAgentIds?: string[];
    replyToId?: string;
    threadId: string;
    nodeId?: string;
    planItemId?: string;
    kind: "mention" | "reply" | "handoff" | "route" | "publish" | "status";
    status?: "sent" | "running" | "done" | "failed";
    content: string;
    topic?: string;
    correlationId?: string;
    artifactIds?: string[];
    transcript?: AgentConversationTranscript;
  }): { id: string };
  writeSharedState(params: {
    agentId: string;
    key: string;
    summary: string;
    value: unknown;
  }): void;
  currentSharedState(): SharedStateSummary;
}

export interface PatternExecutionResult {
  output: unknown;
}

export interface PatternDriver {
  id: CoordinationPattern;
  execute(context: PatternExecutionContext, prompt: string): Promise<PatternExecutionResult>;
}
