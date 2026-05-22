import type {
  AgentConversationTranscript,
  BusStats,
  CoordinationPattern,
  MemoryKind,
  QueueSummary,
  SharedStateSummary,
} from "@cemeworm/shared";
import type { ZodTypeAny } from "zod";

export interface PatternModeResumeState {
  activeFrameId?: string;
  activeNodeId?: string;
  activeAgentId?: string;
  bag: Record<string, unknown>;
  completedNodeIds: string[];
}

export interface StructuredAgentCallDiagnostics {
  modeId: string;
  outputKey: string;
  usedProviderJsonMode: boolean;
  repairAttempted: boolean;
  repairSucceeded: boolean;
  initialText: string;
  finalText?: string;
  repairText?: string;
  parseError?: string;
  schemaIssues?: string[];
  degraded?: boolean;
  degradedReason?: string;
  repairSkippedReason?: "agent_degraded";
  repairActionId?: string;
}

export type StructuredAgentCallResult<T> =
  | {
      ok: true;
      rawText: string;
      value: T;
      diagnostics: StructuredAgentCallDiagnostics;
    }
  | {
      ok: false;
      rawText: string;
      diagnostics: StructuredAgentCallDiagnostics;
    };

export interface CallAgentParams {
  agentId: string;
  planItemId?: string;
  title: string;
  prompt: string;
  system: string;
  customAgentId?: string;
  riskLevel?: "low" | "medium" | "high";
  toolIds?: string[];
}

export interface PatternExecutionContext {
  projectId: string;
  queueSummary: QueueSummary;
  sharedStateSummary: SharedStateSummary;
  busStats: BusStats;
  responseLanguage(): "zh" | "en";
  modeResume?: PatternModeResumeState;
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
  callAgent(params: CallAgentParams): Promise<string>;
  callAgentStructured<T>(params: CallAgentParams & {
    modeId: string;
    outputKey: string;
    schema: ZodTypeAny;
  }): Promise<StructuredAgentCallResult<T>>;
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
