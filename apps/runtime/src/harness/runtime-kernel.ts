import {
  type ActionRiskLevel,
  type ArtifactRef,
  ArtifactRefSchema,
  type CheckpointMeta,
  type ModeSpec,
  type OraEventEnvelope,
  type PatternDefinition,
  type QueueSummary,
  type RunConfig,
  type SharedStateSummary,
  type StateSnapshot,
  type ToolRegistry,
  type UserTaskInput,
  type BusStats,
  type MemoryKind,
  type PendingClarification,
  OraEventEnvelopeSchema,
  PendingClarificationSchema,
  StateSnapshotSchema,
} from "@ora/shared";
import { ActionLedger, AgentProfileRegistry, MemoryCaptureQueue, MemoryService, PlanService, PolicyService } from "../capabilities.js";
import { configuredProviderId, invokeRunProvider } from "../providers/index.js";
import { RuntimeSkillRegistry, RuntimeToolRegistry } from "./capability-registries.js";
import { executeModeSpec } from "../patterns/driver-registry.js";
import type { ModelMessage } from "../providers/index.js";

export interface RuntimeKernelResult {
  snapshot: StateSnapshot;
  tools: ToolRegistry;
}

export interface RuntimeKernelOptions {
  clock?: () => number;
  skillRegistry?: RuntimeSkillRegistry;
  toolRegistry?: RuntimeToolRegistry;
  forkedFrom?: { runId: string; checkpointId: string; eventSeq: number };
  conversationMessages?: ModelMessage[];
  customAgentOverlay?: string;
  modeSpec?: ModeSpec;
  definition?: PatternDefinition;
}

class ClarificationInterruptError extends Error {
  constructor(public readonly clarification: PendingClarification) {
    super(clarification.question);
  }
}

export async function executeRuntimeKernel(
  runId: string,
  input: UserTaskInput,
  config: RunConfig,
  options: RuntimeKernelOptions = {},
): Promise<RuntimeKernelResult> {
  const now = options.clock ?? Date.now;
  const definition = options.definition;
  if (!definition) {
    throw new Error("Runtime kernel requires a resolved mode definition.");
  }
  const modeSpec = options.modeSpec;
  if (!modeSpec) {
    throw new Error("Runtime kernel requires a resolved mode spec.");
  }
  const startedAt = now();
  const projectId = input.projectId ?? "local-project";
  const skillRegistry = options.skillRegistry ?? new RuntimeSkillRegistry();
  const toolRegistry = options.toolRegistry ?? new RuntimeToolRegistry();
  const tools = toolRegistry.snapshot();
  const skills = skillRegistry.snapshot(modeSpec.family);
  const profiles = new AgentProfileRegistry(definition).list(config.profileIds);
  const memoryService = new MemoryService(runId, now);
  const memoryCaptureQueue = new MemoryCaptureQueue();
  const planService = new PlanService(runId, definition);
  const actionLedger = new ActionLedger(runId);
  const policyService = new PolicyService(runId, now);
  const events: OraEventEnvelope[] = [];
  const artifacts: ArtifactRef[] = [];
  const pendingClarifications: PendingClarification[] = [];
  const activeAgents = new Set<string>();
  const busTopicCounts: Record<string, number> = {};
  const sharedEntries: SharedStateSummary["entries"] = [];
  let queueSummary: QueueSummary = {
    mode: definition.coordinationKind === "bus"
      ? "event_bus"
      : definition.coordinationKind === "shared_state"
        ? "shared_state"
        : definition.coordinationKind === "team"
          ? "backlog"
          : "dag",
    pending: definition.planTemplate.length,
    inProgress: 0,
    completed: 0,
    topics: [],
  };
  let busStats: BusStats = {
    enabled: definition.supportsEventRouting,
    publishedCount: 0,
    routedCount: 0,
    topicCounts: {},
  };
  let sharedStateSummary: SharedStateSummary = {
    enabled: definition.supportsSharedState,
    storeKind: definition.supportsSharedState ? "blackboard" : "none",
    version: 0,
    entries: [],
  };

  const topology = {
    nodes: definition.topology.nodes.map((node) => ({ ...node })),
    edges: definition.topology.edges,
  };

  const emit = (
    type: OraEventEnvelope["type"],
    payload: unknown,
    extra: Partial<OraEventEnvelope> = {}
  ) => {
    const envelope = OraEventEnvelopeSchema.parse({
      id: `${runId}:evt-${events.length}`,
      runId,
      seq: events.length,
      type,
      createdAt: now(),
      pattern: config.pattern,
      payload,
      ...extra,
    });
    events.push(envelope);
    return envelope;
  };

  const emitPlanUpdated = () => {
    emit("plan.updated", { items: planService.list() });
  };

  const clarificationAnswer = (key: string, id: string): unknown => {
    const clarifications = input.context?.clarifications;
    if (!clarifications || typeof clarifications !== "object" || clarifications === null) {
      return undefined;
    }
    if (id in clarifications) {
      return (clarifications as Record<string, unknown>)[id];
    }
    if (key in clarifications) {
      return (clarifications as Record<string, unknown>)[key];
    }
    return undefined;
  };

  const setTopologyStatus = (agentId: string, status: "idle" | "running" | "done" | "blocked" | "failed") => {
    for (const node of topology.nodes) {
      if (node.agentId === agentId || node.id === agentId) {
        node.status = status;
      }
    }
    emit("topology.updated", topology, { agentId, nodeId: agentId });
  };

  const setPlanStatus = (templateId: string, status: "planned" | "ready" | "running" | "blocked" | "done" | "failed" | "skipped") => {
    const item = planService.findByTemplateId(templateId);
    if (!item) {
      return;
    }
    planService.setStatus(item.id, status);
    queueSummary = {
      ...queueSummary,
      pending: planService.list().filter((plan) => plan.status === "planned" || plan.status === "ready").length,
      inProgress: planService.list().filter((plan) => plan.status === "running").length,
      completed: planService.list().filter((plan) => plan.status === "done" || plan.status === "skipped").length,
    };
    emitPlanUpdated();
    emit("queue.updated", { summary: queueSummary });
  };

  const systemPrompt = (extra: string) => {
    const snippets = skillRegistry.promptSnippets(config.skillIds);
    return [extra, options.customAgentOverlay, ...snippets].filter(Boolean).join("\n\n");
  };

  const callAgent = async (params: {
    agentId: string;
    planItemId?: string;
    title: string;
    prompt: string;
    system: string;
    riskLevel?: ActionRiskLevel;
  }) => {
    activeAgents.add(params.agentId);
    setTopologyStatus(params.agentId, "running");
    emit("agent.started", { title: params.title, planItemId: params.planItemId }, { agentId: params.agentId, nodeId: params.agentId });

    const action = actionLedger.propose({
      id: `${params.agentId}-${events.length}`,
      type: `agent.${params.agentId}.invoke`,
      riskLevel: params.riskLevel ?? "low",
      input: { prompt: params.prompt, title: params.title },
      planItemId: params.planItemId ? `${runId}:${params.planItemId}` : undefined,
      agentId: params.agentId,
    });
    if (params.planItemId) {
      planService.linkAction(`${runId}:${params.planItemId}`, action.id);
    }
    emit("action.updated", { actionId: action.id, status: "proposed", record: action }, { agentId: params.agentId, nodeId: params.agentId });

    const decision = policyService.evaluate(action);
    if (decision.requiredApproval && config.approvalMode === "manual") {
      const blocked = actionLedger.transition(action.id, "approval_required");
      emit("approval.required", { actionId: action.id, decision }, { agentId: params.agentId, nodeId: params.agentId });
      emit("action.updated", { actionId: action.id, status: "approval_required", record: blocked }, { agentId: params.agentId, nodeId: params.agentId });
      throw new Error(`Manual approval required before executing ${params.title}.`);
    }

    const running = actionLedger.transition(action.id, "running");
    emit("action.updated", { actionId: action.id, status: "running", record: running }, { agentId: params.agentId, nodeId: params.agentId });
    try {
      const response = await invokeRunProvider(config, {
        prompt: params.prompt,
        messages: options.conversationMessages,
        system: params.system,
        maxTokens: config.budget?.maxTokens,
      });

      emit("tool.called", {
        actionId: action.id,
        providerId: response.providerId,
        modelId: response.modelId,
        title: params.title,
        status: "succeeded",
      }, { agentId: params.agentId, nodeId: params.agentId });
      emit("message.delta", { role: "assistant", content: response.text }, { agentId: params.agentId, nodeId: params.agentId });
      emit("token.delta", {
        text: response.text.slice(0, 32),
        tokenCount: Math.max(1, response.text.split(/\s+/).filter(Boolean).length),
        budget: config.budget,
      }, { agentId: params.agentId, nodeId: params.agentId });

      const succeeded = actionLedger.transition(action.id, "succeeded", {
        output: response.raw,
      });
      emit("action.updated", { actionId: action.id, status: "succeeded", record: succeeded }, { agentId: params.agentId, nodeId: params.agentId });
      emit("agent.completed", { title: params.title }, { agentId: params.agentId, nodeId: params.agentId });
      activeAgents.delete(params.agentId);
      setTopologyStatus(params.agentId, "done");
      return response.text;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      const failed = actionLedger.transition(action.id, "failed", { error: detail });
      emit("tool.called", {
        actionId: action.id,
        providerId: configuredProviderId(config) ?? "unknown",
        title: params.title,
        status: "failed",
        error: detail,
      }, { agentId: params.agentId, nodeId: params.agentId });
      emit("action.updated", { actionId: action.id, status: "failed", record: failed }, { agentId: params.agentId, nodeId: params.agentId });

      if (!modeSpec.runtimeAtoms.includes("tool_error_boundary")) {
        activeAgents.delete(params.agentId);
        setTopologyStatus(params.agentId, "failed");
        throw error;
      }

      const fallback = `[tool-error-boundary] ${params.title} degraded after provider failure: ${detail}`;
      emit("message.delta", {
        role: "assistant",
        content: fallback,
        boundary: "tool_error_boundary",
      }, { agentId: params.agentId, nodeId: params.agentId });
      emit("agent.completed", { title: params.title, degraded: true }, { agentId: params.agentId, nodeId: params.agentId });
      activeAgents.delete(params.agentId);
      setTopologyStatus(params.agentId, "done");
      return fallback;
    }
  };

  const remember = (params: {
    id: string;
    namespace: string[];
    kind: "profile" | "project" | "session" | "worker" | "artifact";
    value: unknown;
    sourceActionId?: string;
  }) => {
    const record = memoryService.remember(params);
    emit("memory.updated", { record });
  };

  const captureMemory = (params: {
    id: string;
    namespace: string[];
    kind: MemoryKind;
    value: unknown;
    sourceActionId?: string;
  }) => {
    const queued = memoryCaptureQueue.enqueue(params);
    emit("memory.queued", {
      entry: {
        id: queued.id,
        namespace: queued.namespace,
        kind: queued.kind,
      },
      pending: memoryCaptureQueue.size(),
    });
  };

  const publishArtifact = (params: {
    id: string;
    label: string;
    kind?: "report" | "file" | "log";
    mimeType?: string;
    payload: unknown;
  }) => {
    const artifact = ArtifactRefSchema.parse({
      id: `${runId}:artifact:${params.id}`,
      runId,
      kind: params.kind ?? "log",
      label: params.label,
      mimeType: params.mimeType ?? "application/json",
      createdAt: now(),
      payload: params.payload,
    });
    artifacts.push(artifact);
    emit("artifact.exported", { artifact });
  };

  const ensureClarification = (params: {
    id: string;
    key: string;
    nodeId: string;
    nodeLabel: string;
    question: string;
  }) => {
    const answered = clarificationAnswer(params.key, params.id);
    if (answered !== undefined) {
      return answered;
    }
    const clarification = PendingClarificationSchema.parse({
      id: params.id,
      nodeId: params.nodeId,
      nodeLabel: params.nodeLabel,
      key: params.key,
      question: params.question,
      requestedAt: now(),
    });
    pendingClarifications.push(clarification);
    emit("clarification.required", {
      clarification,
      pending: pendingClarifications.length,
    }, { nodeId: params.nodeId });
    throw new ClarificationInterruptError(clarification);
  };

  const runDelegatedTask = async <T>(params: {
    taskId: string;
    nodeId: string;
    nodeLabel: string;
    agentId: string;
    title: string;
  }, execute: () => Promise<T>): Promise<T> => {
    emit("task.started", {
      taskId: params.taskId,
      nodeId: params.nodeId,
      nodeLabel: params.nodeLabel,
      title: params.title,
      summary: `Delegated ${params.title} to ${params.agentId}.`,
    }, { agentId: params.agentId, nodeId: params.nodeId });
    emit("task.progress", {
      taskId: params.taskId,
      nodeId: params.nodeId,
      nodeLabel: params.nodeLabel,
      title: params.title,
      phase: "running",
      summary: `Delegated task ${params.title} is running.`,
    }, { agentId: params.agentId, nodeId: params.nodeId });
    try {
      const result = await execute();
      emit("task.completed", {
        taskId: params.taskId,
        nodeId: params.nodeId,
        nodeLabel: params.nodeLabel,
        title: params.title,
        summary: `Delegated task ${params.title} completed.`,
      }, { agentId: params.agentId, nodeId: params.nodeId });
      return result;
    } catch (error) {
      emit("task.failed", {
        taskId: params.taskId,
        nodeId: params.nodeId,
        nodeLabel: params.nodeLabel,
        title: params.title,
        error: error instanceof Error ? error.message : String(error),
        summary: `Delegated task ${params.title} failed.`,
      }, { agentId: params.agentId, nodeId: params.nodeId });
      throw error;
    }
  };

  const publishMessage = (params: {
    agentId: string;
    topic: string;
    correlationId: string;
    summary: string;
    payload: unknown;
  }) => {
    busTopicCounts[params.topic] = (busTopicCounts[params.topic] ?? 0) + 1;
    busStats = {
      enabled: true,
      publishedCount: busStats.publishedCount + 1,
      routedCount: busStats.routedCount,
      topicCounts: { ...busTopicCounts },
    };
    if (!queueSummary.topics.includes(params.topic)) {
      queueSummary = { ...queueSummary, topics: [...queueSummary.topics, params.topic] };
    }
    emit("message.published", params, { agentId: params.agentId, nodeId: params.agentId });
    emit("queue.updated", { summary: queueSummary, busStats });
  };

  const routeMessage = (params: {
    agentId: string;
    fromTopic: string;
    toTopic: string;
    correlationId: string;
    summary: string;
  }) => {
    busTopicCounts[params.toTopic] = (busTopicCounts[params.toTopic] ?? 0) + 1;
    busStats = {
      enabled: true,
      publishedCount: busStats.publishedCount,
      routedCount: busStats.routedCount + 1,
      topicCounts: { ...busTopicCounts },
    };
    if (!queueSummary.topics.includes(params.toTopic)) {
      queueSummary = { ...queueSummary, topics: [...queueSummary.topics, params.toTopic] };
    }
    emit("message.routed", params, { agentId: params.agentId, nodeId: params.agentId });
    emit("queue.updated", { summary: queueSummary, busStats });
  };

  const writeSharedState = (params: {
    agentId: string;
    key: string;
    summary: string;
    value: unknown;
  }) => {
    const version = sharedStateSummary.version + 1;
    const entry = {
      key: params.key,
      version,
      summary: params.summary,
      updatedBy: params.agentId,
    };
    sharedEntries.push(entry);
    sharedStateSummary = {
      enabled: true,
      storeKind: "blackboard",
      version,
      entries: [...sharedEntries],
      stopReason: params.key === "convergence" ? "converged" : undefined,
    };
    emit("shared_state.updated", { entry, value: params.value }, { agentId: params.agentId, nodeId: "shared_board" });
  };

  const claimWorker = (agentId: string) => {
    emit("worker.claimed", { agentId }, { agentId, nodeId: agentId });
  };

  const releaseWorker = (agentId: string) => {
    emit("worker.released", { agentId }, { agentId, nodeId: agentId });
  };

  emit("run.started", { input, config, skills: skills.skills, tools: tools.tools });
  if (options.forkedFrom) {
    emit("run.forked", {
      sourceRunId: options.forkedFrom.runId,
      checkpointId: options.forkedFrom.checkpointId,
      eventSeq: options.forkedFrom.eventSeq,
    });
  }
  emit("topology.updated", topology);
  emit("profile.updated", { profiles });
  emitPlanUpdated();

  let status: StateSnapshot["status"] = "succeeded";
  let output: unknown;
  let error: string | undefined;

  try {
    const result = await executeModeSpec({
      context: {
        projectId,
        queueSummary,
        sharedStateSummary,
        busStats,
        systemPrompt,
        setPlanStatus,
        setQueueSummary: (patch) => {
          queueSummary = { ...queueSummary, ...patch };
          emit("queue.updated", { summary: queueSummary, busStats });
        },
        runDelegatedTask,
        ensureClarification,
        claimWorker,
        releaseWorker,
        callAgent,
        remember,
        captureMemory,
        publishArtifact,
        publishMessage,
        routeMessage,
        writeSharedState,
        currentSharedState: () => sharedStateSummary,
      },
      prompt: input.prompt,
      modeSpec,
      definition,
    });
    output = result.output;
    emit("run.done", { status: "succeeded", output });
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
    status = caught instanceof ClarificationInterruptError || config.approvalMode === "manual"
      ? "interrupted"
      : "failed";
    emit(status === "interrupted" ? "run.interrupted" : "run.failed", {
      error,
      status,
      reason: caught instanceof ClarificationInterruptError ? "clarification_required" : undefined,
      clarificationId: caught instanceof ClarificationInterruptError ? caught.clarification.id : undefined,
    });
  }

  if (memoryCaptureQueue.size() > 0) {
    const flushed = memoryCaptureQueue.flush(memoryService);
    for (const record of flushed) {
      emit("memory.updated", { record });
    }
    emit("memory.flushed", {
      count: flushed.length,
      recordIds: flushed.map((record) => record.id),
    });
  }

  const checkpoint: CheckpointMeta = {
    id: `${runId}:checkpoint-0`,
    runId,
    label: status === "succeeded" ? "Pattern checkpoint" : "Interrupted checkpoint",
    createdAt: now(),
    // Match the historic Ora replay contract: the checkpoint references the
    // `checkpoint.created` event itself, not the event immediately before it.
    eventSeq: events.length,
    stateHash: JSON.stringify(output ?? { error, status }),
  };
  emit("checkpoint.created", {
    checkpoint,
    summary: "Runtime checkpoint captured from the unified Ora kernel.",
  }, { checkpointId: checkpoint.id });
  planService.attachCheckpoint(checkpoint.id);

  const snapshot = StateSnapshotSchema.parse({
    runId,
    status,
    pattern: config.pattern,
    coordinationKind: config.pattern,
    modeId: modeSpec.id,
    input,
    config,
    topology,
    profiles,
    memory: memoryService.list(),
    plan: planService.list(),
    actions: actionLedger.list(),
    policyDecisions: [],
    checkpoints: [checkpoint],
    events,
    artifacts,
    activeAgents: [...activeAgents],
    queueSummary,
    sharedStateSummary,
    busStats,
    pendingClarifications,
    pendingApprovals: actionLedger.list().filter((action) => action.status === "approval_required").map((action) => action.id),
    modeSpec,
    output,
    error,
    updatedAt: now(),
  });

  return {
    snapshot,
    tools,
  };
}
