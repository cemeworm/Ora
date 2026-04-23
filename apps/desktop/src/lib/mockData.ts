import type {
  ActionRecord,
  AgentProfile,
  PatternCard,
  PlanItem,
  RunBeat,
  SessionRun,
  TopologyEdge,
  TopologyNode,
} from "../types";

export const sessions: SessionRun[] = [
  {
    id: "run_0422_1140",
    title: "Ship desktop operator shell",
    project: "Ora MVP",
    status: "running",
    pattern: "orchestrator_subagent",
    updatedAt: "11:40",
    health: 94,
    turnCount: 3,
  },
  {
    id: "run_0422_1016",
    title: "Extract shared Ora contracts",
    project: "Ora MVP",
    status: "done",
    pattern: "agent_teams",
    updatedAt: "10:16",
    health: 88,
    turnCount: 2,
  },
  {
    id: "run_0421_2228",
    title: "Evaluate sidecar transport",
    project: "Runtime Spike",
    status: "approval_required",
    pattern: "generator_verifier",
    updatedAt: "Apr 21",
    health: 71,
    turnCount: 1,
  },
];

export const patternCards: PatternCard[] = [
  {
    id: "orchestrator_subagent",
    label: "Orchestrator + Subagent",
    summary: "An orchestrator decomposes the task and dispatches explicit subagents.",
    recommendedUse: "Default for decomposed implementation runs.",
    failureMode: "Coordinator over-specifies and starves local judgment.",
    constraints: "One plan owner, explicit node handoffs, resumable state.",
  },
  {
    id: "generator_verifier",
    label: "Generator + Verifier",
    summary: "A generator proposes an answer and a verifier checks it against a rubric.",
    recommendedUse: "Quality can be judged against a clear rubric.",
    failureMode: "Verifier rubber-stamps vague or subjective output.",
    constraints: "Rubric required, retry budget capped, evidence attached.",
  },
  {
    id: "agent_teams",
    label: "Agent Teams",
    summary: "Persistent teammate agents coordinate around a shared backlog and memory.",
    recommendedUse: "Long-running workers need persistent context.",
    failureMode: "Team members drift without shared backlog pressure.",
    constraints: "Named profiles, memory scopes, worker checkpoints.",
  },
];

export const topologyNodes: TopologyNode[] = [
  { id: "operator", label: "Operator", role: "human gate", status: "idle", x: 50, y: 50 },
  { id: "orchestrator", label: "Orchestrator", role: "plan owner", status: "active", x: 255, y: 84 },
  { id: "designer", label: "UI Worker", role: "surface design", status: "done", x: 470, y: 38 },
  { id: "runtime", label: "Runtime Worker", role: "sidecar bridge", status: "idle", x: 470, y: 138 },
  { id: "approval", label: "Approval Gate", role: "policy pause", status: "blocked", x: 675, y: 88 },
];

export const topologyEdges: TopologyEdge[] = [
  { from: "operator", to: "orchestrator", label: "task" },
  { from: "orchestrator", to: "designer", label: "dispatch" },
  { from: "orchestrator", to: "runtime", label: "dispatch" },
  { from: "runtime", to: "approval", label: "action" },
];

export const streamLines = [
  { source: "orchestrator", text: "Plan tree accepted. Selecting Orchestrator + Subagent as runtime pattern." },
  { source: "ui-worker", text: "Workbench shell composed with pattern cards, topology, dock, and filmstrip." },
  { source: "runtime-worker", text: "Tauri command layer is placeholder-only until sidecar binary lands." },
  { source: "policy", text: "File authority remains outside React. Future shell actions route through Rust approval gates." },
];

export const agents: AgentProfile[] = [
  {
    id: "agent_orchestrator",
    label: "Ora Orchestrator",
    role: "Task decomposition and graph supervision",
    model: "GPT-5 class",
    tools: ["plan.write", "agent.dispatch", "checkpoint.fork"],
    budget: "45 min / 180k tokens",
    memoryScopes: ["project:ora", "session:run_0422_1140"],
  },
  {
    id: "agent_ui_worker",
    label: "UI Worker",
    role: "Desktop shell and interaction design",
    model: "GPT-5 class",
    tools: ["files.write:apps/desktop", "vite.build"],
    budget: "25 min / 80k tokens",
    memoryScopes: ["project:ora", "worker:ui"],
  },
];

export const planItems: PlanItem[] = [
  {
    id: "plan_01",
    owner: "orchestrator",
    title: "Define workbench composition and mock Ora contracts",
    status: "done",
    checkpoint: "ckpt_001",
    linkedActions: ["act_001"],
  },
  {
    id: "plan_02",
    owner: "ui-worker",
    title: "Build light-first Tauri desktop shell",
    status: "running",
    checkpoint: "ckpt_002",
    linkedActions: ["act_002"],
  },
  {
    id: "plan_03",
    owner: "runtime-worker",
    title: "Attach JSON-RPC sidecar when runtime package exists",
    status: "queued",
    checkpoint: "future",
    linkedActions: ["act_003"],
  },
];

export const actions: ActionRecord[] = [
  {
    id: "act_001",
    label: "Create apps/desktop package",
    state: "succeeded",
    consequence: "Adds package-local Vite, Tailwind, and Tauri files.",
    risk: "low",
    artifactIds: [],
  },
  {
    id: "act_002",
    label: "Start runtime sidecar",
    state: "approval_required",
    consequence: "Would spawn a local Node process with workspace authority.",
    risk: "high",
    artifactIds: [],
  },
  {
    id: "act_003",
    label: "Fork from checkpoint",
    state: "proposed",
    consequence: "Creates a replay branch from the selected filmstrip beat.",
    risk: "medium",
    artifactIds: [],
  },
];

export const beats: RunBeat[] = [
  {
    id: "beat_001",
    group: "plan",
    label: "Plan accepted",
    time: "00:00",
    detail: "Task decomposed into shell, sidecar placeholder, verification.",
    eventType: "plan.updated",
    eventSeq: 0,
  },
  {
    id: "beat_002",
    group: "dispatch",
    label: "Workers assigned",
    time: "00:18",
    detail: "UI and runtime surfaces assigned separate contexts.",
    eventType: "topology.updated",
    eventSeq: 1,
  },
  {
    id: "beat_003",
    group: "tool",
    label: "Files written",
    time: "02:46",
    detail: "Desktop package scaffold created under scoped ownership.",
    eventType: "message.delta",
    eventSeq: 2,
  },
  {
    id: "beat_004",
    group: "approval",
    label: "Sidecar paused",
    time: "03:10",
    detail: "Future spawn command requires policy confirmation.",
    eventType: "run.interrupted",
    eventSeq: 3,
  },
  {
    id: "beat_005",
    group: "checkpoint",
    label: "UI checkpoint",
    time: "04:24",
    detail: "Workbench can be replayed from shell-ready state.",
    eventType: "checkpoint.created",
    eventSeq: 4,
    checkpointId: "ckpt_002",
  },
  {
    id: "beat_006",
    group: "done",
    label: "Build verified",
    time: "05:00",
    detail: "Package-local build output available for Tauri bundling.",
    eventType: "run.done",
    eventSeq: 5,
  },
];
