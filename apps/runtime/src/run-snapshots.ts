import {
  ModeSpec,
  ORA_ROOT_AGENT_ID,
  PatternDefinition,
  RunConfig,
  normalizeRunAttention,
  projectAssistantTextFromSnapshot,
  StateSnapshot,
  StateSnapshotSchema,
  UserTaskInput
} from "@cemeworm/shared";
import { AgentProfileRegistry, PlanService, TodoService } from "./capabilities.js";
import { injectRootAgentTopology, rootAgentProfile } from "./harness/runtime-root-agent.js";

interface BaseSnapshotParams {
  runId: string;
  input: UserTaskInput;
  config: RunConfig;
  modeSpec: ModeSpec;
  definition: PatternDefinition;
  clock: () => number;
}

export function createStandaloneRunSnapshot(params: BaseSnapshotParams): StateSnapshot {
  const startedAt = params.input.createdAt ?? params.clock();
  const planService = new PlanService(params.runId, params.definition);
  const todoService = new TodoService(params.runId, params.clock, planService.list());
  const topology = injectRootAgentTopology({
    nodes: params.definition.topology.nodes.map((node) => ({
      ...node,
      status: node.kind === "run" ? "running" as const : node.status,
    })),
    edges: params.definition.topology.edges,
  }, params.modeSpec);
  const profiles = withRootProfile(new AgentProfileRegistry(params.definition).list(params.config.profileIds));
  return normalizeRunAttention(StateSnapshotSchema.parse({
    runId: params.runId,
    status: "running",
    pattern: params.config.pattern,
    coordinationKind: params.config.pattern,
    modeId: params.modeSpec.id,
    input: params.input,
    config: params.config,
    topology,
    profiles,
    memory: [],
    plan: planService.list(),
    todos: todoService.list(),
    actions: [],
    policyDecisions: [],
    checkpoints: [],
    events: [],
    artifacts: [],
    activeAgents: ["orchestrator"],
    queueSummary: {
      mode: "backlog",
      pending: params.definition.planTemplate.length,
      inProgress: 1,
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
    modeSpec: params.modeSpec,
    updatedAt: startedAt,
    snapshotSource: "live" as const,
  }));
}

export function createRunningRunSnapshot(params: BaseSnapshotParams & {
  sessionId: string;
  turnIndex: number;
}): StateSnapshot {
  const startedAt = params.clock();
  const pattern = params.config.pattern;
  const planService = new PlanService(params.runId, params.definition);
  const todoService = new TodoService(params.runId, params.clock, planService.list());
  const topology = injectRootAgentTopology({
    nodes: params.definition.topology.nodes.map((node) => ({
      ...node,
      status: node.kind === "run" ? "running" as const : node.status,
    })),
    edges: params.definition.topology.edges,
  }, params.modeSpec);
  const profiles = withRootProfile(new AgentProfileRegistry(params.definition).list(params.config.profileIds));
  const queueMode = params.definition.coordinationKind === "bus"
    ? "event_bus"
    : params.definition.coordinationKind === "shared_state"
      ? "shared_state"
      : params.definition.coordinationKind === "team"
        ? "backlog"
        : "dag";

  return normalizeRunAttention(StateSnapshotSchema.parse({
    runId: params.runId,
    sessionId: params.sessionId,
    turnIndex: params.turnIndex,
    status: "running",
    pattern,
    coordinationKind: pattern,
    modeId: params.modeSpec.id,
    input: params.input,
    config: params.config,
    topology,
    profiles,
    memory: [],
    plan: planService.list(),
    todos: todoService.list(),
    actions: [],
    policyDecisions: [],
    checkpoints: [],
    events: [],
    artifacts: [],
    activeAgents: [],
    queueSummary: {
      mode: queueMode,
      pending: params.definition.planTemplate.length,
      inProgress: 0,
      completed: 0,
      topics: [],
    },
    sharedStateSummary: {
      enabled: params.definition.supportsSharedState,
      storeKind: params.definition.supportsSharedState ? "blackboard" : "none",
      version: 0,
      entries: [],
    },
    busStats: {
      enabled: params.definition.supportsEventRouting,
      publishedCount: 0,
      routedCount: 0,
      topicCounts: {},
    },
    pendingClarifications: [],
    pendingApprovals: [],
    modeSpec: params.modeSpec,
    updatedAt: startedAt,
    snapshotSource: "live" as const,
  }));
}

function withRootProfile(profiles: ReturnType<AgentProfileRegistry["list"]>) {
  return profiles.some((profile) => profile.id === ORA_ROOT_AGENT_ID)
    ? profiles
    : [rootAgentProfile(), ...profiles];
}

export function cancelledRunSnapshot(params: {
  snapshot: StateSnapshot;
  payload: unknown;
  updatedAt: number;
  defaultReason: string;
}): StateSnapshot {
  const reason = params.payload &&
    typeof params.payload === "object" &&
    "reason" in params.payload &&
    typeof (params.payload as { reason?: unknown }).reason === "string"
    ? (params.payload as { reason: string }).reason
    : params.defaultReason;
  const plan = params.snapshot.plan.map((item) => ({
    ...item,
    status: item.status === "done" || item.status === "skipped" ? item.status : "blocked" as const,
  }));
  const todos = params.snapshot.todos.map((item) => ({
    ...item,
    status: item.status === "done" || item.status === "skipped" ? item.status : "blocked" as const,
    updatedAt: params.updatedAt,
  }));
  const assistantText = projectAssistantTextFromSnapshot(params.snapshot);
  return normalizeRunAttention(StateSnapshotSchema.parse({
    ...params.snapshot,
    status: "cancelled",
    output: params.snapshot.output ?? (assistantText ? { text: assistantText } : undefined),
    topology: {
      nodes: params.snapshot.topology.nodes.map((node) => ({ ...node, status: "failed" as const })),
      edges: params.snapshot.topology.edges,
    },
    plan,
    todos,
    actions: params.snapshot.actions.map((action) =>
      action.status === "approval_required" || action.status === "running" || action.status === "proposed" || action.status === "approved"
        ? { ...action, status: "denied" as const, error: reason }
        : action,
    ),
    toolCalls: params.snapshot.toolCalls.map((call) =>
      call.status === "running" || call.status === "proposed" || call.status === "approval_required" || call.status === "approved"
        ? {
            ...call,
            status: "denied" as const,
            updatedAt: params.updatedAt,
            error: reason,
            result: {
              status: "denied" as const,
              error: reason,
              content: reason,
              createdAt: params.updatedAt,
              updatedAt: params.updatedAt,
            },
          }
        : call,
    ),
    pendingApprovals: [],
    activeAgents: [],
    queueSummary: {
      ...params.snapshot.queueSummary,
      inProgress: 0,
      pending: plan.filter((item) => item.status !== "done" && item.status !== "skipped").length,
      completed: plan.filter((item) => item.status === "done" || item.status === "skipped").length,
    },
    error: reason,
    updatedAt: params.updatedAt,
  }));
}
