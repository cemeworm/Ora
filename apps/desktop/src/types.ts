export type CoordinationPattern =
  | "generator_verifier"
  | "orchestrator_subagent"
  | "agent_teams"
  | "message_bus"
  | "shared_state";

export type RunStatus =
  | "running"
  | "approval_required"
  | "checkpointed"
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
  status: RunStatus;
  pattern: CoordinationPattern;
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

export interface TopologyNode {
  id: string;
  label: string;
  role: string;
  agentId?: string;
  status: "active" | "idle" | "blocked" | "done";
  x: number;
  y: number;
}

export interface TopologyEdge {
  from: string;
  to: string;
  label: string;
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

export interface ActionRecord {
  id: string;
  label: string;
  state: "proposed" | "approval_required" | "running" | "succeeded" | "failed";
  consequence: string;
  risk: "low" | "medium" | "high";
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
}

export type RuntimeBridgeMode = "initializing" | "tauri" | "browser_mock" | "unavailable" | "error";

export interface RuntimeBridgeStatus {
  mode: RuntimeBridgeMode;
  ok: boolean;
  label: string;
  detail: string;
}

export type AppView = "chat" | "agents" | "evaluation";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: string;
  metadata?: { eventType?: string; agentId?: string; beatId?: string; runId?: string; turnIndex?: number; pattern?: CoordinationPattern };
}
