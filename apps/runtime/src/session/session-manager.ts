import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";
import { Command } from "@langchain/langgraph";
import {
  type ActionRecord,
  type BusStats,
  type CheckpointMeta,
  type OraEventEnvelope,
  OraEventEnvelopeSchema,
  type QueueSummary,
  StateSnapshotSchema,
  type StateSnapshot,
  createModeSpecFromPattern,
  getModePreset,
  modeSpecToPatternDefinition,
  type ModeSpec,
  type PatternDefinition,
  type RunConfig,
  type SharedStateSummary,
  type UserTaskInput
} from "@ora/shared";
import { AgentProfileRegistry, PlanService, TodoService } from "../capabilities.js";
import { adaptGraphEvents } from "../graph/event-adapter.js";
import type { ModelMessage } from "../providers/index.js";
import { createOraSqliteCheckpointer } from "../persistence/sqlite-checkpointer.js";
import { createPatternGraphWithCheckpointer } from "../patterns/registry.js";
import { withLangfuseRunTrace } from "../telemetry/langfuse.js";

/**
 * Manages active LangGraph runs.
 *
 * When LangGraph is enabled (via ORA_LANGGRAPH_ENABLED), real LangGraph
 * graph invocations are used and the manager keeps the latest snapshot for
 * lifecycle operations such as state, interrupt, resume, and cancel.
 */
export class SessionManager {
  private readonly checkpointer?: BaseCheckpointSaver;
  private readonly enabled: boolean;
  private readonly runs = new Map<string, ManagedRun>();

  constructor(enabled = false, options: { checkpointer?: BaseCheckpointSaver } = {}) {
    this.enabled = enabled;
    this.checkpointer = enabled ? options.checkpointer ?? createOraSqliteCheckpointer() : undefined;
  }

  /**
   * Start a new pattern graph run.
   * When LangGraph is disabled, returns undefined (caller should use deterministic path).
   * When enabled, invokes the actual LangGraph graph.
   */
  async startRun(
    runId: string,
    input: UserTaskInput,
    config: RunConfig,
    conversationMessages: ModelMessage[] = [],
    resolved?: {
      modeSpec: ModeSpec;
      definition: PatternDefinition;
      customAgentOverlay?: string;
      sessionId?: string;
      turnIndex?: number;
    }
  ): Promise<StateSnapshot | undefined> {
    if (!this.enabled) {
      return undefined;
    }

    return withLangfuseRunTrace({ runId, input, config }, () =>
      this.startTracedRun(runId, input, config, conversationMessages, resolved)
    );
  }

  private async startTracedRun(
    runId: string,
    input: UserTaskInput,
    config: RunConfig,
    conversationMessages: ModelMessage[],
    resolved?: {
      modeSpec: ModeSpec;
      definition: PatternDefinition;
      customAgentOverlay?: string;
      sessionId?: string;
      turnIndex?: number;
    }
  ): Promise<StateSnapshot> {
    const nextResolved = resolveSessionMode(config, resolved);
    const managedConfig = {
      ...config,
      metadata: {
        ...config.metadata,
        graphNodeMeta: Object.fromEntries(
          nextResolved.modeSpec.nodes.map((node) => [node.id, {
            clarificationQuestion: typeof node.config?.clarificationQuestion === "string"
              ? node.config.clarificationQuestion
              : undefined,
            riskLevel: node.riskLevel ?? "low",
          }]),
        ),
        ...(resolved?.customAgentOverlay ? { customAgentOverlay: resolved.customAgentOverlay } : {}),
      },
    };
    const { graph } = createPatternGraphWithCheckpointer(config.pattern, this.checkpointer ?? false);
    const graphConfig = {
      configurable: {
        thread_id: runId,
        checkpoint_ns: "",
      },
    };
    const baseState = createInitialGraphState(runId, input, managedConfig, nextResolved.definition);
    const graphEvents = await collectGraphEvents(graph, baseState, graphConfig);
    const graphState = await graph.getState(graphConfig);
    const snapshot = buildSnapshotFromGraph({
      runId,
      input,
      config: managedConfig,
      modeSpec: nextResolved.modeSpec,
      definition: nextResolved.definition,
      graphState,
      graphEvents,
      previousSnapshot: undefined,
      localStatus: undefined,
      localError: undefined,
      sessionId: resolved?.sessionId,
      turnIndex: resolved?.turnIndex,
    });
    this.runs.set(runId, {
      runId,
      graph,
      graphConfig,
      input,
      config: managedConfig,
      modeSpec: nextResolved.modeSpec,
      definition: nextResolved.definition,
      conversationMessages,
      customAgentOverlay: resolved?.customAgentOverlay,
      snapshot,
      lastGraphStatus: snapshot.status,
    });
    return snapshot;
  }

  /**
   * Interrupt a running graph.
   */
  async interruptRun(runId: string, reason?: string): Promise<StateSnapshot | undefined> {
    if (!this.enabled) {
      return undefined;
    }
    const managed = this.runs.get(runId);
    if (!managed) {
      return undefined;
    }
    const snapshot = appendLifecycleEvent(
      managed.snapshot,
      "interrupted",
      "run.interrupted",
      {
        reason: reason ?? "Interrupted by caller.",
      },
      "blocked",
    );
    managed.snapshot = snapshot;
    return snapshot;
  }

  /**
   * Resume a graph from an interrupt.
   */
  async resumeRun(runId: string, patch?: Record<string, unknown>, reason?: string): Promise<StateSnapshot | undefined> {
    if (!this.enabled) {
      return undefined;
    }
    const managed = this.runs.get(runId);
    if (!managed) {
      return undefined;
    }

    const currentGraphState = await managed.graph.getState(managed.graphConfig).catch(() => undefined);
    if (hasPendingGraphInterrupt(currentGraphState)) {
      const resumedInput = mergeInputWithResumePatch(managed.input, patch);
      const graphEvents = await collectGraphEvents(
        managed.graph,
        new Command({ resume: patch ?? null }),
        managed.graphConfig,
      );
      const graphState = await managed.graph.getState(managed.graphConfig);
      const resumed = buildSnapshotFromGraph({
        runId,
        input: resumedInput,
        config: managed.config,
        modeSpec: managed.modeSpec,
        definition: managed.definition,
        graphState,
        graphEvents,
        previousSnapshot: managed.snapshot,
        localStatus: undefined,
        localError: undefined,
        resumePatch: patch,
      });
      managed.input = resumedInput;
      managed.snapshot = resumed;
      managed.lastGraphStatus = resumed.status;
      return resumed;
    }

    const resumed = resumeLifecycleSnapshot(
      managed.snapshot,
      reason ?? "Resumed by caller.",
      managed.lastGraphStatus === "cancelled" ? "succeeded" : managed.lastGraphStatus,
    );
    managed.snapshot = resumed;
    return resumed;
  }

  /**
   * Cancel a running graph.
   */
  async cancelRun(runId: string, reason?: string): Promise<StateSnapshot | undefined> {
    if (!this.enabled) {
      return undefined;
    }
    const managed = this.runs.get(runId);
    if (!managed) {
      return undefined;
    }
    const snapshot = appendLifecycleEvent(
      managed.snapshot,
      "cancelled",
      "run.cancelled",
      {
        reason: reason ?? "Cancelled by caller.",
      },
      "blocked",
    );
    managed.snapshot = snapshot;
    return snapshot;
  }

  /**
   * Get the current state of a run.
   */
  async getRunState(runId: string): Promise<StateSnapshot | undefined> {
    if (!this.enabled) {
      return undefined;
    }
    const managed = this.runs.get(runId);
    if (!managed) {
      return undefined;
    }
    if (managed.snapshot.status !== "succeeded") {
      return managed.snapshot;
    }
    const graphState = await managed.graph.getState(managed.graphConfig).catch(() => undefined);
    if (!graphState) {
      return managed.snapshot;
    }
    const refreshed = buildSnapshotFromGraph({
      runId,
      input: managed.input,
      config: managed.config,
      modeSpec: managed.modeSpec,
      definition: managed.definition,
      graphState,
      graphEvents: [],
      previousSnapshot: managed.snapshot,
      localStatus: managed.snapshot.status,
      localError: managed.snapshot.error,
    });
    managed.snapshot = refreshed;
    managed.lastGraphStatus = refreshed.status;
    return refreshed;
  }

  /**
   * Check whether LangGraph mode is enabled.
   */
  isEnabled(): boolean {
    return this.enabled;
  }
}

interface ManagedRun {
  runId: string;
  graph: ReturnType<typeof createPatternGraphWithCheckpointer>["graph"];
  graphConfig: {
    configurable: {
      thread_id: string;
      checkpoint_ns: string;
    };
  };
  input: UserTaskInput;
  config: RunConfig;
  modeSpec: ModeSpec;
  definition: PatternDefinition;
  conversationMessages: ModelMessage[];
  customAgentOverlay?: string;
  snapshot: StateSnapshot;
  lastGraphStatus: StateSnapshot["status"];
}

interface PendingApprovalInterrupt {
  actionId: string;
  nodeId: string;
  reason: string;
  record: ActionRecord;
}

function createInitialGraphState(
  runId: string,
  input: UserTaskInput,
  config: RunConfig,
  definition: PatternDefinition,
) {
  const plan = new PlanService(runId, definition).list();
  return {
    runId,
    pattern: config.pattern,
    input,
    config,
    topology: {
      nodes: definition.topology.nodes.map((node) => ({ ...node })),
      edges: definition.topology.edges.map((edge) => ({ ...edge })),
    },
    profiles: new AgentProfileRegistry(definition).list(config.profileIds),
    memory: [],
    plan,
    actions: [],
    policyDecisions: [],
    events: [],
    checkpoints: [],
    artifacts: [],
    output: undefined,
    error: undefined,
  };
}

async function collectGraphEvents(
  graph: ReturnType<typeof createPatternGraphWithCheckpointer>["graph"],
  input: unknown,
  graphConfig: {
    configurable: {
      thread_id: string;
      checkpoint_ns: string;
    };
  },
): Promise<Array<Record<string, unknown>>> {
  const events: Array<Record<string, unknown>> = [];
  for await (const event of (graph as any).streamEvents(input, { ...graphConfig, version: "v2" })) {
    if (event && typeof event === "object") {
      events.push(event as Record<string, unknown>);
    }
  }
  return events;
}

function buildSnapshotFromGraph(params: {
  runId: string;
  input: UserTaskInput;
  config: RunConfig;
  modeSpec: ModeSpec;
  definition: PatternDefinition;
  graphState: unknown;
  graphEvents: Array<Record<string, unknown>>;
  previousSnapshot?: StateSnapshot;
  localStatus?: StateSnapshot["status"];
  localError?: string;
  sessionId?: string;
  turnIndex?: number;
  resumePatch?: Record<string, unknown>;
}): StateSnapshot {
  const now = Date.now;
  const values = readGraphValues(params.graphState);
  const graphStatus = inferGraphStatus(params.graphState, values);
  const status = params.localStatus ?? graphStatus;
  const output = values.output;
  const error = params.localError ?? readGraphError(params.graphState);
  const pendingInterrupts = extractPendingInterrupts(params.graphState);
  const profiles = Array.isArray(values.profiles) && values.profiles.length > 0
    ? values.profiles
    : new AgentProfileRegistry(params.definition).list(params.config.profileIds);
  const planTemplate = new PlanService(params.runId, params.definition);
  const nextPlan = Array.isArray(values.plan) && values.plan.length > 0
    ? values.plan
    : planTemplate.list();
  const plan = nextPlan.map((item) => ({
    ...item,
    status: status === "succeeded"
      ? "done"
      : status === "interrupted"
        ? "blocked"
        : status === "failed" || status === "cancelled"
          ? "blocked"
          : item.status,
  }));
  const todos = new TodoService(params.runId, now, plan).list();
  const topology = {
    nodes: (
      Array.isArray(values.topology?.nodes) && values.topology.nodes.length > 0
        ? values.topology.nodes
        : params.definition.topology.nodes
    ).map((node: Record<string, any>) => ({
      ...node,
      status: status === "succeeded"
        ? "done"
        : status === "interrupted" || status === "cancelled"
          ? "blocked"
          : status === "failed"
            ? "failed"
            : node.status,
    })),
    edges: Array.isArray(values.topology?.edges) && values.topology.edges.length > 0
      ? values.topology.edges
      : params.definition.topology.edges,
  };

  const previousEvents = params.previousSnapshot?.events ?? [];
  const nextEvents = [...previousEvents];
  const emit = (
    type: OraEventEnvelope["type"],
    payload: unknown,
    extra: Partial<OraEventEnvelope> = {},
  ) => {
    const event = OraEventEnvelopeSchema.parse({
      id: `${params.runId}:evt-${nextEvents.length}`,
      runId: params.runId,
      seq: nextEvents.length,
      type,
      createdAt: now(),
      pattern: params.config.pattern,
      payload,
      ...extra,
    });
    nextEvents.push(event);
    return event;
  };

  const isResume = Boolean(params.previousSnapshot && params.resumePatch);

  if (!params.previousSnapshot) {
    emit("run.started", { input: params.input, config: params.config });
    emit("topology.updated", topology);
    emit("profile.updated", { profiles });
    emit("plan.updated", { items: plan });
    emit("todo.updated", { items: todos });
  }
  if (isResume) {
    emit("run.resumed", {
      reason: "Resumed by caller.",
      patch: params.resumePatch ?? {},
    });
  }

  const adaptedGraphEvents = adaptGraphEvents(
    params.graphEvents as Parameters<typeof adaptGraphEvents>[0],
    params.runId,
    params.config.pattern,
    now,
  );
  for (const event of adaptedGraphEvents) {
    emit(event.type, event.payload, {
      agentId: event.agentId,
      nodeId: event.nodeId,
      checkpointId: event.checkpointId,
    });
  }

  if (isResume && params.previousSnapshot) {
    for (const clarification of params.previousSnapshot.pendingClarifications) {
      const answer = readClarificationAnswer(params.resumePatch, clarification.key, clarification.id);
      if (answer === undefined) {
        continue;
      }
      emit("clarification.resolved", {
        clarificationId: clarification.id,
        nodeId: clarification.nodeId,
        answer,
        mode: "resume",
      }, { nodeId: clarification.nodeId });
    }
    for (const actionId of params.previousSnapshot.pendingApprovals) {
      if (!hasApprovedAction(params.resumePatch, actionId)) {
        continue;
      }
      emit("approval.resolved", {
        actionId,
        decision: "approved",
        mode: "resume",
      });
      emit("action.updated", {
        actionId,
        status: "approved",
        record: {
          id: actionId,
          runId: params.runId,
          type: `graph.${actionId.split(":").at(-1) ?? "node"}`,
          riskLevel: readApprovalRiskLevel(params.previousSnapshot, actionId),
          status: "approved",
          input: {},
          artifactIds: [],
        },
      });
    }
  }

  for (const clarification of pendingInterrupts.pendingClarifications) {
    emit("clarification.required", {
      clarification,
      pending: pendingInterrupts.pendingClarifications.length,
    }, { nodeId: clarification.nodeId });
  }
  for (const approval of pendingInterrupts.pendingApprovals) {
    emit("approval.required", {
      actionId: approval.actionId,
      decision: {
        requiredApproval: true,
        reason: approval.reason,
      },
    }, { nodeId: approval.nodeId });
    emit("action.updated", {
      actionId: approval.actionId,
      status: "approval_required",
      record: approval.record,
    }, { nodeId: approval.nodeId });
  }

  if (!params.previousSnapshot || params.graphEvents.length > 0) {
    if (status === "succeeded") {
      emit("run.done", { status: "succeeded", output });
    } else if (status === "interrupted") {
      emit("run.interrupted", { status, error });
    } else if (status === "failed") {
      emit("run.failed", { status, error });
    }
  }

  const checkpoint = buildGraphCheckpoint(params.runId, params.graphState, output, error, status, now);
  const checkpoints = params.previousSnapshot?.checkpoints.length && params.graphEvents.length === 0
    ? params.previousSnapshot.checkpoints
    : [{
        ...checkpoint,
        eventSeq: nextEvents.length,
      }];
  if (!params.previousSnapshot || params.graphEvents.length > 0) {
    emit(
      "checkpoint.created",
      {
        checkpoint: checkpoints[0],
        summary: "LangGraph checkpoint captured from SessionManager.",
      },
      { checkpointId: checkpoints[0]?.id },
    );
  }

  const queueSummary = buildQueueSummary(params.definition, plan);
  const busStats = buildBusStats(params.config.pattern, nextEvents, output);
  const sharedStateSummary = buildSharedStateSummary(params.config.pattern, output);
  return StateSnapshotSchema.parse({
    runId: params.runId,
    sessionId: params.sessionId ?? params.previousSnapshot?.sessionId,
    turnIndex: params.turnIndex ?? params.previousSnapshot?.turnIndex ?? 1,
    status,
    pattern: params.config.pattern,
    coordinationKind: params.config.pattern,
    modeId: params.modeSpec.id,
    input: params.input,
    config: params.config,
    topology,
    profiles,
    memory: Array.isArray(values.memory) ? values.memory : [],
    plan,
    todos,
    actions: buildActionRecords(params.runId, nextEvents),
    policyDecisions: Array.isArray(values.policyDecisions) ? values.policyDecisions : [],
    checkpoints,
    events: nextEvents,
    artifacts: Array.isArray(values.artifacts) ? values.artifacts : [],
    activeAgents: [],
    queueSummary,
    sharedStateSummary,
    busStats,
    pendingClarifications: pendingInterrupts.pendingClarifications,
    pendingApprovals: pendingInterrupts.pendingApprovals.map((approval) => approval.actionId),
    modeSpec: params.modeSpec,
    output,
    error,
    updatedAt: now(),
  });
}

function buildQueueSummary(definition: PatternDefinition, plan: StateSnapshot["plan"]): QueueSummary {
  return {
    mode: definition.coordinationKind === "bus"
      ? "event_bus"
      : definition.coordinationKind === "shared_state"
        ? "shared_state"
        : definition.coordinationKind === "team"
          ? "backlog"
          : "dag",
    pending: plan.filter((item) => item.status === "planned" || item.status === "ready").length,
    inProgress: plan.filter((item) => item.status === "running").length,
    completed: plan.filter((item) => item.status === "done" || item.status === "skipped").length,
    topics: [],
  };
}

function buildBusStats(
  pattern: RunConfig["pattern"],
  events: OraEventEnvelope[],
  output: unknown,
): BusStats {
  const route = typeof output === "object" && output !== null && typeof (output as Record<string, unknown>).route === "string"
    ? (output as Record<string, unknown>).route as string
    : undefined;
  return {
    enabled: pattern === "message_bus",
    publishedCount: events.filter((event) => event.type === "message.published").length,
    routedCount: events.filter((event) => event.type === "message.routed").length,
    topicCounts: route ? { [route]: 1 } : {},
  };
}

function buildSharedStateSummary(pattern: RunConfig["pattern"], output: unknown): SharedStateSummary {
  const outputRecord = typeof output === "object" && output !== null
    ? output as Record<string, unknown>
    : undefined;
  const rawEntries = Array.isArray(outputRecord?.entries) ? outputRecord.entries : undefined;
  const entries = rawEntries
    ? rawEntries
        .filter((entry: unknown): entry is Record<string, unknown> => typeof entry === "object" && entry !== null)
        .map((entry: Record<string, unknown>, index: number) => ({
          key: typeof entry.key === "string" ? entry.key : `entry-${index + 1}`,
          version: index + 1,
          summary: typeof entry.summary === "string" ? entry.summary : JSON.stringify(entry),
        }))
    : [];
  return {
    enabled: pattern === "shared_state",
    storeKind: pattern === "shared_state" ? "blackboard" : "none",
    version: entries.length,
    entries,
    stopReason: entries.length > 0 ? "converged" : undefined,
  };
}

function buildActionRecords(runId: string, events: OraEventEnvelope[]): ActionRecord[] {
  const actions = new Map<string, ActionRecord>();
  for (const event of events) {
    if (event.type !== "action.updated" || typeof event.payload !== "object" || event.payload === null) {
      continue;
    }
    const payload = event.payload as Record<string, unknown>;
    const actionId = typeof payload.actionId === "string" ? payload.actionId : undefined;
    const status = typeof payload.status === "string" ? payload.status : undefined;
    if (!actionId || !status) {
      continue;
    }
    const node = typeof payload.node === "string" ? payload.node : event.nodeId;
    if (!node || node === "LangGraph" || node.startsWith("__")) {
      continue;
    }
    const record = typeof payload.record === "object" && payload.record !== null
      ? payload.record as Record<string, unknown>
      : undefined;
    actions.set(actionId, {
      id: actionId,
      runId,
      agentId: node,
      type: `graph.${node ?? "node"}`,
      riskLevel: record?.riskLevel === "high" || record?.riskLevel === "medium" ? record.riskLevel : "low",
      status: status as ActionRecord["status"],
      input: { node },
      output: payload.output ?? record?.output,
      artifactIds: [],
    });
  }
  return [...actions.values()];
}

function extractPendingInterrupts(graphState: unknown): {
  pendingClarifications: StateSnapshot["pendingClarifications"];
  pendingApprovals: PendingApprovalInterrupt[];
} {
  if (!graphState || typeof graphState !== "object") {
    return {
      pendingClarifications: [],
      pendingApprovals: [],
    };
  }
  const state = graphState as { tasks?: unknown[] };
  const pendingClarifications: StateSnapshot["pendingClarifications"] = [];
  const pendingApprovals: PendingApprovalInterrupt[] = [];

  for (const task of Array.isArray(state.tasks) ? state.tasks : []) {
    if (!task || typeof task !== "object") {
      continue;
    }
    const taskRecord = task as { name?: unknown; interrupts?: unknown[] };
    const nodeId = typeof taskRecord.name === "string" ? taskRecord.name : "unknown";
    for (const interrupt of Array.isArray(taskRecord.interrupts) ? taskRecord.interrupts : []) {
      if (!interrupt || typeof interrupt !== "object") {
        continue;
      }
      const interruptRecord = interrupt as { value?: unknown };
      const value = interruptRecord.value;
      if (!value || typeof value !== "object") {
        continue;
      }
      const payload = value as Record<string, unknown>;
      if (payload.kind === "clarification") {
        pendingClarifications.push({
          id: typeof payload.id === "string" ? payload.id : `${nodeId}:clarification`,
          nodeId,
          nodeLabel: typeof payload.nodeLabel === "string" ? payload.nodeLabel : nodeId,
          key: typeof payload.key === "string" ? payload.key : nodeId,
          question: typeof payload.question === "string" ? payload.question : "Clarification required.",
          requestedAt: Date.now(),
        });
      }
      if (payload.kind === "approval" && typeof payload.actionId === "string") {
        pendingApprovals.push({
          actionId: payload.actionId,
          nodeId,
          reason: typeof payload.reason === "string" ? payload.reason : "Manual approval required.",
          record: {
            id: payload.actionId,
            runId: payload.actionId.split(":action:")[0] ?? payload.actionId,
            agentId: nodeId,
            type: `graph.${nodeId}`,
            riskLevel: payload.riskLevel === "high" || payload.riskLevel === "medium" ? payload.riskLevel : "low",
            status: "approval_required",
            input: { nodeId },
            artifactIds: [],
          },
        });
      }
    }
  }

  return {
    pendingClarifications,
    pendingApprovals,
  };
}

function buildGraphCheckpoint(
  runId: string,
  graphState: unknown,
  output: unknown,
  error: string | undefined,
  status: StateSnapshot["status"],
  now: () => number,
): CheckpointMeta {
  const configurable = readGraphConfigurable(graphState);
  return {
    id: typeof configurable?.checkpoint_id === "string"
      ? `${runId}:${configurable.checkpoint_id}`
      : `${runId}:checkpoint-0`,
    runId,
    label: graphCheckpointLabelForStatus(status),
    createdAt: now(),
    eventSeq: 0,
    stateHash: JSON.stringify(output ?? { error, status }),
  };
}

function graphCheckpointLabelForStatus(status: StateSnapshot["status"]): string {
  switch (status) {
    case "succeeded":
      return "LangGraph checkpoint";
    case "interrupted":
      return "LangGraph interrupted checkpoint";
    case "failed":
      return "LangGraph failed checkpoint";
    case "cancelled":
      return "LangGraph cancelled checkpoint";
    case "queued":
    case "running":
      return "LangGraph lifecycle checkpoint";
  }
}

function appendLifecycleEvent(
  snapshot: StateSnapshot,
  status: StateSnapshot["status"],
  type: "run.interrupted" | "run.cancelled",
  payload: unknown,
  topologyStatus: "blocked" | "failed",
): StateSnapshot {
  const updatedAt = Date.now();
  const event = OraEventEnvelopeSchema.parse({
    id: `${snapshot.runId}:evt-${snapshot.events.length}`,
    runId: snapshot.runId,
    seq: snapshot.events.length,
    type,
    createdAt: updatedAt,
    pattern: snapshot.pattern,
    payload,
  });
  return StateSnapshotSchema.parse({
    ...snapshot,
    status,
    topology: {
      nodes: snapshot.topology.nodes.map((node) => ({ ...node, status: topologyStatus })),
      edges: snapshot.topology.edges,
    },
    plan: snapshot.plan.map((item) => ({
      ...item,
      status: item.status === "done" || item.status === "skipped" ? item.status : "blocked",
    })),
    todos: snapshot.todos.map((item) => ({
      ...item,
      status: item.status === "done" || item.status === "skipped" ? item.status : "blocked",
      updatedAt,
    })),
    events: [...snapshot.events, event],
    updatedAt,
  });
}

function resumeLifecycleSnapshot(
  snapshot: StateSnapshot,
  reason: string,
  targetStatus: StateSnapshot["status"],
): StateSnapshot {
  const updatedAt = Date.now();
  const resumedEvent = OraEventEnvelopeSchema.parse({
    id: `${snapshot.runId}:evt-${snapshot.events.length}`,
    runId: snapshot.runId,
    seq: snapshot.events.length,
    type: "run.resumed",
    createdAt: updatedAt,
    pattern: snapshot.pattern,
    payload: {
      reason,
      patch: {},
    },
  });
  const completionEvent = OraEventEnvelopeSchema.parse({
    id: `${snapshot.runId}:evt-${snapshot.events.length + 1}`,
    runId: snapshot.runId,
    seq: snapshot.events.length + 1,
    type: "run.done",
    createdAt: updatedAt,
    pattern: snapshot.pattern,
    payload: {
      status: targetStatus,
      output: snapshot.output,
    },
  });
  return StateSnapshotSchema.parse({
    ...snapshot,
    status: targetStatus,
    topology: {
      nodes: snapshot.topology.nodes.map((node) => ({ ...node, status: targetStatus === "succeeded" ? "done" : node.status })),
      edges: snapshot.topology.edges,
    },
    plan: snapshot.plan.map((item) => ({
      ...item,
      status: targetStatus === "succeeded" ? "done" : item.status,
    })),
    todos: snapshot.todos.map((item) => ({
      ...item,
      status: targetStatus === "succeeded" ? "done" : item.status,
      updatedAt,
    })),
    events: [...snapshot.events, resumedEvent, completionEvent],
    updatedAt,
  });
}

function hasPendingGraphInterrupt(graphState: unknown): boolean {
  if (!graphState || typeof graphState !== "object") {
    return false;
  }
  const candidate = graphState as {
    tasks?: unknown[];
    next?: unknown[];
  };
  return Array.isArray(candidate.tasks) && candidate.tasks.length > 0
    || Array.isArray(candidate.next) && candidate.next.length > 0;
}

function inferGraphStatus(graphState: unknown, values: ReturnType<typeof readGraphValues>): StateSnapshot["status"] {
  if (hasPendingGraphInterrupt(graphState)) {
    return "interrupted";
  }
  return typeof values.error === "string" && values.error.length > 0 ? "failed" : "succeeded";
}

function readGraphValues(graphState: unknown): Record<string, any> {
  if (!graphState || typeof graphState !== "object") {
    return {};
  }
  const values = (graphState as { values?: unknown }).values;
  return values && typeof values === "object" ? values as Record<string, any> : {};
}

function readGraphConfigurable(graphState: unknown): Record<string, unknown> | undefined {
  if (!graphState || typeof graphState !== "object") {
    return undefined;
  }
  const config = (graphState as { config?: { configurable?: Record<string, unknown> } }).config;
  return config?.configurable;
}

function readGraphError(graphState: unknown): string | undefined {
  const values = readGraphValues(graphState);
  return typeof values.error === "string" ? values.error : undefined;
}

function mergeInputWithResumePatch(
  input: UserTaskInput,
  patch?: Record<string, unknown>,
): UserTaskInput {
  const clarificationPatch = patch?.clarifications;
  if (!clarificationPatch || typeof clarificationPatch !== "object" || clarificationPatch === null) {
    return input;
  }
  return {
    ...input,
    context: {
      ...input.context,
      clarifications: {
        ...(typeof input.context?.clarifications === "object" && input.context.clarifications !== null
          ? input.context.clarifications
          : {}),
        ...(clarificationPatch as Record<string, unknown>),
      },
    },
  };
}

function readClarificationAnswer(
  patch: Record<string, unknown> | undefined,
  key: string,
  id: string,
): unknown {
  const clarifications = patch?.clarifications;
  if (!clarifications || typeof clarifications !== "object" || clarifications === null) {
    return undefined;
  }
  const record = clarifications as Record<string, unknown>;
  return record[id] ?? record[key];
}

function hasApprovedAction(
  patch: Record<string, unknown> | undefined,
  actionId: string,
): boolean {
  const approvedActionIds = patch?.approvedActionIds;
  return Array.isArray(approvedActionIds) && approvedActionIds.includes(actionId);
}

function readApprovalRiskLevel(
  snapshot: StateSnapshot,
  actionId: string,
): "low" | "medium" | "high" {
  const existing = snapshot.actions.find((action) => action.id === actionId);
  return existing?.riskLevel === "high" || existing?.riskLevel === "medium"
    ? existing.riskLevel
    : "low";
}

function resolveSessionMode(
  config: RunConfig,
  resolved?: { modeSpec: ModeSpec; definition: PatternDefinition }
): { modeSpec: ModeSpec; definition: PatternDefinition } {
  if (resolved) {
    return resolved;
  }

  const requestedModeId = config.modeId ?? config.pattern;
  const preset = getModePreset(requestedModeId);
  if (preset) {
    return {
      modeSpec: preset,
      definition: modeSpecToPatternDefinition(preset),
    };
  }

  if (!config.modeId || config.modeId === config.pattern) {
    const modeSpec = createModeSpecFromPattern(config.pattern);
    return {
      modeSpec,
      definition: modeSpecToPatternDefinition(modeSpec),
    };
  }

  throw new Error(`SessionManager requires resolved mode data for custom mode '${config.modeId}'.`);
}
