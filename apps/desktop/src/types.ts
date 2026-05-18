import type { CoordinationPattern, BuiltInCoordinationPattern } from "@cemeworm/shared";
export type { CoordinationPattern, BuiltInCoordinationPattern };

export type RunStatus =
  | "running"
  | "approval_required"
  | "clarification_required"
  | "decision_needed"
  | "checkpointed"
  | "paused"
  | "cancelled"
  | "done"
  | "failed";

export type DockTab =
  | "Overview"
  | "State"
  | "Profile"
  | "Memory"
  | "Plan"
  | "Actions"
  | "Approvals"
  | "Checkpoints";

export interface AgentProfile {
  id: string;
  label: string;
  role: string;
  model: string;
  tools: string[];
  budget: string;
  memoryScopes: string[];
}

export interface MemoryRecord {
  id: string;
  namespace: string;
  kind: "profile" | "project" | "session" | "worker" | "artifact";
  value: string;
  updatedAt: string;
}

export interface SessionRun {
  id: string;
  title: string;
  project: string;
  projectId?: string;
  status: RunStatus;
  pattern: CoordinationPattern;
  modeId?: string;
  updatedAt: string;
  health: number;
  latestRunId?: string;
  turnCount: number;
}

export interface SessionTurnItem {
  runId: string;
  sessionId: string;
  turnIndex: number;
  status: RunStatus;
  pattern: CoordinationPattern;
  modeId?: string;
  providerId?: string;
  modelRef?: string;
  prompt: string;
  updatedAt: string;
}

export interface PatternCard {
  id: CoordinationPattern;
  label: string;
  summary: string;
  recommendedUse: string;
  failureMode: string;
  constraints: string;
}

export interface ModeCard {
  id: string;
  family: CoordinationPattern;
  label: string;
  summary: string;
  recommendedUse: string;
  failureMode: string;
  isPreset: boolean;
}

export interface TopologyNode {
  id: string;
  label: string;
  kind: string;
  role: string;
  agentId?: string;
  status: "active" | "idle" | "blocked" | "done";
  atomId?: string;
  atomScope?: "mode" | "node";
  atomPresentation?: "mode_capability" | "stage_attachment" | "family_capability";
  sourceNodeId?: string;
  active?: boolean;
  x: number;
  y: number;
}

export interface TopologyEdge {
  from: string;
  to: string;
  label: string;
  kind?: string;
}

export interface RunBeat {
  id: string;
  group: "plan" | "dispatch" | "tool" | "approval" | "checkpoint" | "retry" | "error" | "done";
  label: string;
  time: string;
  detail: string;
  eventType: string;
  eventSeq: number;
  checkpointId?: string;
  nodeId?: string;
  agentId?: string;
}

export interface StreamLine {
  source: string;
  text: string;
}

export interface PlanItem {
  id: string;
  owner: string;
  title: string;
  status: "queued" | "running" | "blocked" | "done";
  checkpoint: string;
  linkedActions: string[];
}

export interface ApprovalRequestCopy {
  title: string;
  summary: string;
  whatWillChange?: string;
  whyNeeded?: string;
  riskNote?: string;
  confirmLabel?: string;
}

export interface ActionRecord {
  id: string;
  label: string;
  state: "proposed" | "approval_required" | "running" | "succeeded" | "failed";
  consequence: string;
  risk: "low" | "medium" | "high";
  toolId?: string;
  input?: unknown;
  approvalRequest?: ApprovalRequestCopy;
  agentId?: string;
  planItemId?: string;
  artifactIds: string[];
}

export interface CheckpointRecord {
  id: string;
  label: string;
  createdAt: string;
  eventSeq: number;
  stateHash?: string;
}

export interface ArtifactRecord {
  id: string;
  label: string;
  kind: "report" | "file" | "log";
  mimeType: string;
  createdAt: string;
  uri?: string;
  sizeBytes?: number;
  payload?: unknown;
}

export interface TurnProcessStep {
  id: string;
  eventType: string;
  label: string;
  detail: string;
  timestamp: string;
  status: "complete" | "active" | "blocked";
  tone: "neutral" | "accent" | "warning";
  agentId?: string;
  contextLabel?: string;
}

export type TurnTimelineItem =
  | {
      id: string;
      kind: "assistant_text" | "final_text";
      content: string;
      timestamp: string;
      agentId?: string;
      agentLabel?: string;
      eventSeq?: number;
    }
  | {
      id: string;
      kind: "agent_message";
      messageKind: TurnAgentConversationMessage["kind"];
      fromAgentLabel: string;
      toAgentLabels: string[];
      content: string;
      timestamp: string;
      agentId?: string;
      agentLabel?: string;
      eventSeq?: number;
    }
  | {
      id: string;
      kind: "status_group";
      summary: string;
      steps: TurnProcessStep[];
      timestamp: string;
      status: "complete" | "active" | "blocked";
      agentId?: string;
      agentLabel?: string;
      eventSeq?: number;
    }
  | {
      id: string;
      kind: "plan_update";
      summary: string;
      timestamp: string;
      agentId?: string;
      agentLabel?: string;
      eventSeq?: number;
    }
  | {
      id: string;
      kind: "artifact";
      summary: string;
      artifactId?: string;
      timestamp: string;
      agentId?: string;
      agentLabel?: string;
      eventSeq?: number;
    };

export interface TurnPlanListStep {
  step: string;
  status: "pending" | "in_progress" | "completed";
}

export interface TurnClarificationExchange {
  id: string;
  question: string;
  answer?: string;
  requestedAt: string;
  answeredAt?: string;
  status: "pending" | "resolved";
}

export interface TurnTodoItem {
  id: string;
  label: string;
  status: "queued" | "running" | "blocked" | "done" | "failed";
  owner?: string;
  detail?: string;
}

export interface TurnArtifactAttachment {
  id: string;
  label: string;
  kind: ArtifactRecord["kind"];
  mimeType: string;
  createdAt: string;
  uri?: string;
  sizeBytes?: number;
  payload?: unknown;
  previewable: boolean;
}

export interface TurnFileChangeAttachment {
  artifactId: string;
  path: string;
  operation: "write" | "patch";
  beforeContent: string;
  afterContent: string;
  additions: number;
  deletions: number;
  sizeBytes?: number;
  replacements?: number;
  created: boolean;
}

export interface TurnAgentConversationMessage {
  id: string;
  fromAgentId: string;
  fromAgentLabel: string;
  toAgentIds: string[];
  toAgentLabels: string[];
  replyToId?: string;
  threadId: string;
  nodeId?: string;
  planItemId?: string;
  kind: "mention" | "reply" | "handoff" | "route" | "publish" | "status" | "info";
  status: "sent" | "running" | "done" | "failed";
  content: string;
  topic?: string;
  correlationId?: string;
  artifactIds: string[];
  transcript?: {
    kind: "stage_transcript";
    groupId: string;
    groupLabel?: string;
    stageId: string;
    stageLabel: string;
    sequence: number;
    speakerLabel: string;
    speakerId?: string;
    stance: string;
    status: "sent" | "running" | "done" | "failed";
    layout?: {
      style: string;
      groupId?: string;
      groupLabel?: string;
      stanceLabels?: Record<string, string>;
      stanceTones?: Record<string, string>;
      sideByStance?: Record<string, "left" | "right" | "center">;
      laneBySpeaker?: Record<string, string>;
      summaryStances?: string[];
      summaryStageIds?: string[];
      showStatus?: boolean;
      showTimestamp?: boolean;
      showSpeaker?: boolean;
      orientation?: "vertical" | "horizontal";
      showArtifacts?: boolean;
      groupBy?: "speakerId" | "stance" | "nodeId";
      lanes?: Array<{ id: string; label: string }>;
      ownsFinalAnswer?: boolean;
      supplementalBody?: "auto" | "never";
    };
  };
  timestamp: string;
}

export interface CitationSource {
  url: string;
  title?: string;
}

export type AssistantTurnActiveLoadingTarget =
  | { kind: "timeline"; itemId: string }
  | { kind: "proposed_plan" }
  | { kind: "thinking" };

export interface ReviewGateFinding {
  artifactId?: string;
  severity: "blocking" | "concern" | "suggestion";
  issue: string;
}

export interface ReviewGateInfo {
  reviewVerdict: "pass" | "needs_fix" | "blocked";
  verificationBlocked: boolean;
  reviewReworkCount: number;
  reviewIssues: string[];
  blockedNodeId?: string;
  reviewFindings?: ReviewGateFinding[];
  degradedDelivery?: boolean;
}

export type AssistantTurnPrimarySurface =
  | "stage_transcript"
  | "plan"
  | "timeline"
  | "body";

export interface AssistantTurnPresentation {
  primarySurface: AssistantTurnPrimarySurface;
  bodyContent: string;
  showStandaloneBody: boolean;
  transcriptTakeaway?: string;
  visibleTimelineItems: TurnTimelineItem[];
}

export interface AssistantTurnAttachment {
  runId: string;
  turnIndex: number;
  status: RunStatus;
  pattern?: CoordinationPattern;
  currentAgentLabel?: string;
  liveProgressText?: string;
  processSteps: TurnProcessStep[];
  timelineItems?: TurnTimelineItem[];
  clarificationExchanges?: TurnClarificationExchange[];
  planList: TurnPlanListStep[];
  agentMessages: TurnAgentConversationMessage[];
  artifacts: TurnArtifactAttachment[];
  fileChanges?: TurnFileChangeAttachment[];
  sources: CitationSource[];
  todos: TurnTodoItem[];
  approvalCount: number;
  clarificationCount: number;
  hasProposedPlan: boolean;
  proposedPlanStatus?: "streaming" | "complete";
  planContent?: string;
  presentation?: AssistantTurnPresentation;
  activeLoadingTarget?: AssistantTurnActiveLoadingTarget;
  reviewGate?: ReviewGateInfo;
}

export type RuntimeBridgeMode = "initializing" | "tauri" | "browser_mock" | "unavailable" | "error";

export interface RuntimeBridgeStatus {
  mode: RuntimeBridgeMode;
  ok: boolean;
  label: string;
  detail: string;
}

export type AppView = "chat" | "agents" | "skills" | "modes" | "evaluation" | "automations" | "space-dashboard" | "space-library";

export interface ClarificationOption {
  id: string;
  label: string;
  value?: string;
  description?: string;
}

export interface ChatMessageAttachment {
  name: string;
  path: string;
  mimeType: string;
  sizeBytes: number;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: string;
  metadata?: { eventType?: string; agentId?: string; beatId?: string; runId?: string; turnIndex?: number; pattern?: CoordinationPattern };
  turn?: AssistantTurnAttachment;
  clarificationOptions?: ClarificationOption[];
  isPlaceholder?: boolean;
  attachments?: ChatMessageAttachment[];
}
