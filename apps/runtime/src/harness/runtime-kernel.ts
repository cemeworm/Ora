import {
  type ActionRiskLevel,
  type AgentConversationMessage,
  AgentConversationMessageSchema,
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
  type OraToolCallEnvelope,
  type PendingClarification,
  type PendingClarificationOption,
  RecoveryArtifactSchema,
  OraEventEnvelopeSchema,
  StateSnapshotSchema,
  type CompletionStopReason,
  type CustomAgentDetail,
  ORA_ROOT_AGENT_ID,
  ORA_ROOT_AGENT_LABEL,
  SINGLE_AGENT_MODE_ID,
} from "@ora/shared";
import {
  ActionLedger,
  AgentProfileRegistry,
  MemoryCaptureQueue,
  MemoryService,
  PlanService,
  PolicyService,
  TodoService,
} from "../capabilities.js";
import {
  configuredProviderId,
  invokeRunProvider,
  invokeRunProviderStream,
} from "../providers/index.js";
import {
  RuntimeSkillRegistry,
  RuntimeToolRegistry,
} from "./capability-registries.js";
import {
  extractRuntimeToolCallFromText,
  RuntimeToolExecutor,
  type RuntimeFileChangeMetadata,
  type RuntimeToolCall,
} from "./runtime-tool-executor.js";
import {
  classifyRecoveryError,
  RecoveryCoordinator,
  type RecoveryDecision,
  type RecoveryIncident,
} from "./recovery-policy.js";
import { executeModeSpec } from "../patterns/driver-registry.js";
import type { ModelMessage, ModelResponse } from "../providers/index.js";
import { RuntimeCompletionController } from "./runtime-completion.js";
import {
  coerceNoToolResponse as coerceNoToolResponseWithDeps,
  emitRejectedFinalToolIntent as emitRejectedFinalToolIntentWithDeps,
  forcedFinalSystemPrompt,
  incompleteForcedFinalError,
  outputWithCompletionMetadata,
} from "./runtime-output.js";
import {
  ApprovalInterruptError,
  ClarificationInterruptError,
  createResumeApprovalMatcher,
  type ApprovedResumeAction,
} from "./runtime-interrupts.js";
import {
  INTENT_CLARIFICATION_ID,
  INTENT_CLARIFICATION_KEY,
  INTENT_CLARIFICATION_NODE_ID,
  INTENT_CLARIFICATION_NODE_LABEL,
  ensureRuntimeClarification,
  requestIntentClarificationQuestion,
  resolveClarificationAnswer,
} from "./runtime-clarifications.js";
import { buildAgentPromptContext, userClarificationContextPrompt } from "./prompt-context.js";
import {
  attachedLocalFilesSystemPrompt,
  attachedProjectFilesSystemPrompt,
  checkpointLabelForStatus,
  workspaceSystemPrompt,
} from "./runtime-prompts.js";
import { RuntimeToolCallLedger } from "./runtime-tool-ledger.js";
import { fileChangeArtifact } from "./file-change-artifact.js";
import { emitRuntimeProgressNarration } from "./runtime-progress.js";
import {
  runRecoverableRuntimeNode,
  runRuntimeDelegatedTask,
} from "./runtime-node-support.js";
import {
  resolveRuntimeActionApproval,
  transitionRuntimeAction,
} from "./runtime-action-runner.js";
import { PackageManager } from "../package-manager.js";
import {
  type NodeRuntimeLoopState,
  runNodeRuntimeLoop,
  type RunNodeRuntimeLoopParams,
} from "./node-runtime-loop.js";
import { createRuntimePatternExecutionContext } from "./runtime-pattern-context.js";
import {
  injectRootAgentTopology,
  rootAgentProfile,
} from "./runtime-root-agent.js";

export interface RuntimeKernelResult {
  snapshot: StateSnapshot;
  tools: ToolRegistry;
}

export interface RuntimeKernelOptions {
  clock?: () => number;
  skillRegistry?: RuntimeSkillRegistry;
  toolRegistry?: RuntimeToolRegistry;
  modeRegistry?: import("./runtime-tool-executor.js").ModeRegistryTools;
  forkedFrom?: { runId: string; checkpointId: string; eventSeq: number };
  conversationMessages?: ModelMessage[];
  customAgentOverlay?: string;
  customAgentOverlays?: Record<string, string>;
  systemAgentOverlays?: Record<string, string>;
  customAgentContexts?: Record<string, Pick<CustomAgentDetail, "model" | "skillIds" | "toolIds"> & { overlay: string }>;
  modeSpec?: ModeSpec;
  definition?: PatternDefinition;
  resumeContext?: {
    clarifications?: Record<string, unknown>;
    approvedActionIds?: string[];
    approvedActions?: ApprovedResumeAction[];
  };
  resumeState?: Pick<StateSnapshot, "plan" | "todos" | "actions" | "toolCalls" | "toolResults" | "continuation" | "conversation">;
  streamProvider?: boolean;
  onEvent?: (event: OraEventEnvelope) => void;
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function selectedModeProgressText(modeSpec: ModeSpec, checkingRequest: boolean): string {
  const label = modeSpec.id === "single_agent" ? "单智能体模式" : `${modeSpec.label} 模式`;
  return checkingRequest
    ? `已选择${label}，我准备好了`
    : `已选择${label}，正在准备执行`;
}

function continuationForKernelSnapshot(params: {
  previous?: StateSnapshot["continuation"];
  runId: string;
  status: StateSnapshot["status"];
  reason?: "approval_required" | "clarification_required";
  pendingApprovals: string[];
  pendingApprovalToolCallIds: string[];
  pendingClarificationIds: string[];
  agentId?: string;
  nodeId?: string;
  planItemId?: string;
  conversationCursor: number;
  now: number;
}): StateSnapshot["continuation"] {
  const previousFrames = params.previous?.frames ?? [];
  if (params.status !== "interrupted" || !params.reason) {
    return params.previous ?? { frames: [] };
  }
  const activeFrameId = params.previous?.activeFrameId ?? `${params.runId}:continuation:${previousFrames.length}`;
  const existing = previousFrames.find((frame) => frame.id === activeFrameId);
  const frame = {
    id: activeFrameId,
    runId: params.runId,
    status: "paused" as const,
    reason: params.reason,
    conversationCursor: params.conversationCursor,
    pendingActionIds: params.pendingApprovals,
    pendingToolCallIds: params.pendingApprovalToolCallIds,
    pendingClarificationIds: params.pendingClarificationIds,
    approvedActionIds: existing?.approvedActionIds ?? [],
    resolvedClarificationIds: existing?.resolvedClarificationIds ?? [],
    agentId: params.agentId ?? existing?.agentId,
    nodeId: params.nodeId ?? existing?.nodeId,
    planItemId: params.planItemId ?? existing?.planItemId,
    createdAt: existing?.createdAt ?? params.now,
    updatedAt: params.now,
  };
  return {
    activeFrameId,
    frames: existing
      ? previousFrames.map((item) => (item.id === activeFrameId ? frame : item))
      : [...previousFrames, frame],
  };
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
  const packageManager = new PackageManager();
  const tools = toolRegistry.snapshot();
  const runtimeToolExecutor = new RuntimeToolExecutor({
    workspace: input.context?.projectWorkspace,
    toolDescriptors: tools.tools,
    skillRegistry,
    modeRegistry: options.modeRegistry,
    packageManager,
    searchProviderConfig: config.searchProvider,
  });
  const skills = skillRegistry.snapshot(modeSpec.family);
  const modeProfiles = new AgentProfileRegistry(definition).list(config.profileIds);
  const rootProfile = rootAgentProfile();
  const profiles = modeProfiles.some((profile) => profile.id === ORA_ROOT_AGENT_ID)
    ? modeProfiles
    : [rootProfile, ...modeProfiles];
  const memoryService = new MemoryService(runId, now);
  const memoryCaptureQueue = new MemoryCaptureQueue();
  const planService = new PlanService(runId, definition, options.resumeState?.plan);
  const todoService = new TodoService(runId, now, planService.list(), options.resumeState?.todos);
  const actionLedger = new ActionLedger(runId, options.resumeState?.actions);
  const policyService = new PolicyService(runId, now);
  const resumeApprovals = createResumeApprovalMatcher(options.resumeContext);
  const events: OraEventEnvelope[] = [];
  const artifacts: ArtifactRef[] = [];
  const agentMessages: AgentConversationMessage[] = [];
  const toolCallLedger = new RuntimeToolCallLedger(runId, now, options.resumeState?.toolCalls);
  const runtimeToolResultCache = new Map<string, unknown>(
    (options.resumeState?.toolResults ?? [])
      .filter((entry) => entry.status === "succeeded")
      .map((entry) => [entry.key, entry.output] as const),
  );
  const pendingClarifications: PendingClarification[] = [];
  const activeAgents = new Set<string>();
  const busTopicCounts: Record<string, number> = {};
  const sharedEntries: SharedStateSummary["entries"] = [];
  let queueSummary: QueueSummary = {
    mode:
      definition.coordinationKind === "bus"
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

  const rootTopology = injectRootAgentTopology({
    nodes: definition.topology.nodes.map((node) => ({ ...node })),
    edges: definition.topology.edges,
  }, modeSpec);
  const topology = {
    nodes: rootTopology.nodes,
    edges: rootTopology.edges,
  };
  const profilesById = new Map(modeSpec.profiles.map((profile) => [profile.id, profile]));
  if (!profilesById.has(ORA_ROOT_AGENT_ID)) {
    profilesById.set(ORA_ROOT_AGENT_ID, rootProfile);
  }

  const emit = (
    type: OraEventEnvelope["type"],
    payload: unknown,
    extra: Partial<OraEventEnvelope> = {},
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
    options.onEvent?.(envelope);
    return envelope;
  };

  const emitAgentMessage = (params: {
    fromAgentId: string;
    toAgentIds?: string[];
    replyToId?: string;
    threadId: string;
    nodeId?: string;
    planItemId?: string;
    kind: AgentConversationMessage["kind"];
    status?: AgentConversationMessage["status"];
    content: string;
    topic?: string;
    correlationId?: string;
    artifactIds?: string[];
    transcript?: AgentConversationMessage["transcript"];
  }) => {
    const message = AgentConversationMessageSchema.parse({
      id: `${runId}:agent-message:${agentMessages.length}`,
      runId,
      createdAt: now(),
      toAgentIds: [],
      status: "sent",
      artifactIds: [],
      ...params,
    });
    agentMessages.push(message);
    emit(
      "agent.message",
      { message },
      {
        agentId: message.fromAgentId,
        nodeId: message.nodeId ?? message.fromAgentId,
      },
    );
    return message;
  };

  const oraObservationKeys = new Set<string>();
  const emitOraObservation = (params: {
    phase: string;
    observedAgentId?: string;
    observedNodeId?: string;
    content: string;
  }) => {
    if (modeSpec.id === SINGLE_AGENT_MODE_ID || oraObservationKeys.size >= 4) {
      return undefined;
    }
    const key = `${params.phase}:${params.observedNodeId ?? params.observedAgentId ?? "mode"}`;
    if (oraObservationKeys.has(key)) {
      return undefined;
    }
    oraObservationKeys.add(key);
    return emitAgentMessage({
      fromAgentId: ORA_ROOT_AGENT_ID,
      toAgentIds: [],
      threadId: `${runId}:ora-observer`,
      nodeId: ORA_ROOT_AGENT_ID,
      kind: "status",
      status: "done",
      content: params.content,
    });
  };

  const completion = new RuntimeCompletionController(config, modeSpec, emit);
  const recoveryCoordinator = new RecoveryCoordinator(
    modeSpec,
    runtimeToolExecutor.enabledToolIds(config.toolIds),
  );

  const publishRecoveryArtifact = (
    incident: RecoveryIncident,
    decision: RecoveryDecision,
  ) => {
    const recoveryArtifact = RecoveryArtifactSchema.parse({
      id: `${runId}:recovery:${artifacts.length}`,
      runId,
      nodeId: incident.nodeId,
      toolId: incident.toolId,
      errorType: incident.errorType,
      decision: decision.action,
      summary: decision.summary,
      usableOutput: decision.usableOutput,
      originalError: incident.detail,
      createdAt: now(),
    });
    const artifact = ArtifactRefSchema.parse({
      id: recoveryArtifact.id,
      runId,
      kind: "log",
      label: "Recovery artifact",
      mimeType: "application/json",
      createdAt: recoveryArtifact.createdAt,
      payload: recoveryArtifact,
    });
    artifacts.push(artifact);
    emit(
      "artifact.degraded",
      { artifact, recovery: recoveryArtifact },
      {
        nodeId: incident.nodeId,
        agentId: incident.agentId,
      },
    );
    return recoveryArtifact;
  };

  const emitRecoveryDecision = (
    incident: RecoveryIncident,
    decision: RecoveryDecision,
  ) => {
    emit(
      "recovery.detected",
      { incident },
      { nodeId: incident.nodeId, agentId: incident.agentId },
    );
    if (decision.action === "retry") {
      emit(
        "recovery.retry_scheduled",
        { incident, decision },
        { nodeId: incident.nodeId, agentId: incident.agentId },
      );
    } else if (decision.action === "fail") {
      emit(
        "recovery.exhausted",
        { incident, decision },
        { nodeId: incident.nodeId, agentId: incident.agentId },
      );
    } else {
      emit(
        "recovery.applied",
        { incident, decision },
        { nodeId: incident.nodeId, agentId: incident.agentId },
      );
    }
  };

  const emitPlanUpdated = () => {
    emit("plan.updated", { items: planService.list() });
  };

  const emitTodoUpdated = () => {
    emit("todo.updated", { items: todoService.list() });
  };

  const emitProgressNarration = async (params: {
    trigger: string;
    agentId?: string;
    nodeId?: string;
    title?: string;
    detail?: string;
  }) => {
    await emitRuntimeProgressNarration(params, {
      config,
      userPrompt: input.prompt,
      events,
      activeAgentCount: () => activeAgents.size,
      planStatuses: () => planService.list().map((item) => item.status),
      todoStatuses: () => todoService.list().map((item) => item.status),
      emit,
    });
  };

  const appendToolCall = toolCallLedger.append.bind(toolCallLedger);
  const actionDeps = () => ({
    actionLedger,
    policyService,
    approvalMode: config.approvalMode,
    resumeApprovals,
    emit,
    emitProgressNarration,
    appendToolCallStatus: (
      record: OraToolCallEnvelope,
      status: OraToolCallEnvelope["status"],
    ) => {
      appendToolCall({ ...record, status });
    },
    appendToolCall,
  });

  const emitNodeRuntimeState = (
    state: NodeRuntimeLoopState,
    params: {
      agentId: string;
      title?: string;
      actionId?: string;
      reason?: string;
      detail?: string;
      toolId?: string;
      iteration?: number;
    },
  ) => {
    emit(
      "node.updated",
      {
        state,
        title: params.title,
        actionId: params.actionId,
        reason: params.reason,
        detail: params.detail,
        toolId: params.toolId,
        iteration: params.iteration,
        toolAttempts: completion.toolAttempts,
        maxToolCalls: completion.maxToolCalls,
      },
      { agentId: params.agentId, nodeId: params.agentId },
    );
  };

  const emitRejectedFinalToolIntent = (
    call: RuntimeToolCall,
    reason: CompletionStopReason,
  ) => {
    emitRejectedFinalToolIntentWithDeps(call, reason, emit);
  };

  const coerceNoToolResponse = (
    response: ModelResponse,
    reason: CompletionStopReason,
    options: { emitRejectedToolIntent?: boolean } = {},
  ): ModelResponse => {
    return coerceNoToolResponseWithDeps(response, reason, {
      toolIds: config.toolIds,
      emit,
      setCompletionStopReason: (stopReason) =>
        completion.setCompletionStopReason(stopReason),
    }, options);
  };

  const runForcedFinalProviderCall = async (params: {
    invokeProvider: typeof invokeRunProvider | typeof invokeRunProviderStream;
    config: RunConfig;
    messages: ModelMessage[];
    system: string;
    nativeTools: ReturnType<RuntimeToolExecutor["toolDefinitions"]>;
    streamCallbacks?: Parameters<typeof invokeRunProviderStream>[2];
    reason: CompletionStopReason;
    agentId?: string;
    nodeId?: string;
    title?: string;
  }): Promise<ModelResponse> => {
    completion.markForcedFinalConsumed({ agentId: params.agentId, nodeId: params.nodeId });
    const response = await params.invokeProvider(
      params.config,
      {
        messages: params.messages,
        system: forcedFinalSystemPrompt(params.system, params.reason),
        maxTokens: params.config.budget?.maxTokens,
        tools: params.nativeTools,
        toolChoice: params.nativeTools.length > 0 ? "none" : undefined,
      },
      params.streamCallbacks,
    );
    const fallbackToolIntent = extractRuntimeToolCallFromText(
      response.text,
      config.toolIds,
    );
    if (fallbackToolIntent) {
      emitRejectedFinalToolIntent(fallbackToolIntent, params.reason);
      const retryResponse = await params.invokeProvider(
        params.config,
        {
          messages: [
            ...params.messages,
            {
              role: "user",
              content: [
                `Completion control rejected a ${fallbackToolIntent.tool} tool call because tools are disabled for this final answer.`,
                "Do not call tools or emit tool JSON.",
                "Use the available conversation and prior tool results to answer the user's original request now.",
              ].join("\n"),
            },
          ],
          system: forcedFinalSystemPrompt(params.system, params.reason),
          maxTokens: params.config.budget?.maxTokens,
          tools: params.nativeTools,
          toolChoice: params.nativeTools.length > 0 ? "none" : undefined,
        },
        params.streamCallbacks,
      );
      const finalResponse = coerceNoToolResponse(retryResponse, params.reason);
      if (params.agentId) {
        emitNodeRuntimeState("completed", {
          agentId: params.agentId,
          title: params.title,
        });
      }
      return finalResponse;
    }
    const finalResponse = coerceNoToolResponse(response, params.reason);
    if (params.agentId) {
      emitNodeRuntimeState("completed", {
        agentId: params.agentId,
        title: params.title,
      });
    }
    return finalResponse;
  };

  const completionMetadata = () => completion.metadata();

  const inferCompletionStopReason = (value: unknown) => {
    if (completion.completionStopReason) {
      return;
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const record = value as Record<string, unknown>;
      const verifier = record.verifier;
      if (
        verifier &&
        typeof verifier === "object" &&
        !Array.isArray(verifier)
      ) {
        const verifierRecord = verifier as Record<string, unknown>;
        if (verifierRecord.verdict === "pass") {
          completion.setCompletionStopReason("verification_passed");
          return;
        }
        if (verifierRecord.exhausted === true) {
          completion.setCompletionStopReason("verification_exhausted");
          return;
        }
      }
    }
    completion.setCompletionStopReason("completed");
  };

  const clarificationAnswer = (key: string, id: string): unknown => {
    return resolveClarificationAnswer({
      key,
      id,
      resumeClarifications: options.resumeContext?.clarifications,
      inputClarifications: input.context?.clarifications,
    });
  };

  const setTopologyStatus = (
    agentId: string,
    status: "idle" | "running" | "done" | "blocked" | "failed",
  ) => {
    for (const node of topology.nodes) {
      if (node.agentId === agentId || node.id === agentId) {
        node.status = status;
      }
    }
    emit("topology.updated", topology, { agentId, nodeId: agentId });
  };

  const setPlanStatus = (
    templateId: string,
    status:
      | "planned"
      | "ready"
      | "running"
      | "blocked"
      | "done"
      | "failed"
      | "skipped",
  ) => {
    const item = planService.findByTemplateId(templateId);
    if (!item) {
      return;
    }
    planService.setStatus(item.id, status);
    todoService.setStatus(item.id, status);
    queueSummary = {
      ...queueSummary,
      pending: planService
        .list()
        .filter((plan) => plan.status === "planned" || plan.status === "ready")
        .length,
      inProgress: planService.list().filter((plan) => plan.status === "running")
        .length,
      completed: planService
        .list()
        .filter((plan) => plan.status === "done" || plan.status === "skipped")
        .length,
    };
    emitPlanUpdated();
    emit("queue.updated", { summary: queueSummary });
    if (status === "done" || status === "skipped" || status === "blocked" || status === "failed") {
      const node = modeSpec.nodes.find((candidate) => candidate.id === templateId);
      const observedAgentId = node?.ownerAgentId ?? node?.id;
      const label = node?.title ?? node?.label ?? templateId;
      const phase = status === "done" || status === "skipped" ? "stage-completed" : "stage-blocked";
      emitOraObservation({
        phase,
        observedAgentId,
        observedNodeId: templateId,
        content: status === "done" || status === "skipped"
          ? `${ORA_ROOT_AGENT_LABEL} observed ${label} complete and is keeping the run moving.`
          : `${ORA_ROOT_AGENT_LABEL} observed ${label} needs attention before the run can finish cleanly.`,
      });
    }
  };

  const effectiveAgentToolIds = (agentId: string, customAgentId?: string): string[] => {
    const profile = profilesById.get(agentId);
    const profileToolIds = profile?.toolIds ?? [];
    const customAgentToolIds = customAgentId ? options.customAgentContexts?.[customAgentId]?.toolIds ?? [] : [];
    const requestedToolIds = profileToolIds.length > 0 ? profileToolIds : customAgentToolIds;
    if (requestedToolIds.length === 0) {
      return config.toolIds;
    }
    const requested = new Set(requestedToolIds);
    return config.toolIds.filter((toolId) => requested.has(toolId));
  };

  const effectiveAgentSkillIds = (agentId: string, customAgentId?: string): string[] => {
    const profile = profilesById.get(agentId);
    const profileSkillIds = profile?.skillIds ?? [];
    const customAgentSkillIds = customAgentId ? options.customAgentContexts?.[customAgentId]?.skillIds ?? [] : [];
    const requestedSkillIds = profileSkillIds.length > 0 ? profileSkillIds : customAgentSkillIds;
    if (requestedSkillIds.length === 0) {
      return config.skillIds;
    }
    const requested = new Set(requestedSkillIds);
    return config.skillIds.filter((skillId) => requested.has(skillId));
  };

  const customAgentIdForAgent = (agentId: string, nodeCustomAgentId?: string): string | undefined =>
    profilesById.get(agentId)?.customAgentId ?? nodeCustomAgentId;

  const customAgentOverlayFor = (customAgentId: string | undefined): string | undefined => {
    if (!customAgentId) {
      return options.customAgentOverlay;
    }
    return options.customAgentContexts?.[customAgentId]?.overlay
      ?? options.customAgentOverlays?.[customAgentId]
      ?? options.customAgentOverlay;
  };

  const workspaceContext = [
    workspaceSystemPrompt(input.context?.projectWorkspace),
    attachedProjectFilesSystemPrompt(input.context?.attachedProjectFiles),
    attachedLocalFilesSystemPrompt(input.context?.attachedLocalFiles),
  ].filter(Boolean).join("\n\n") || undefined;
  const clarificationContext = userClarificationContextPrompt(input.context);
  const memoryContext =
    typeof config.metadata.memoryPromptOverlay === "string"
      ? config.metadata.memoryPromptOverlay
      : undefined;
  const systemPrompt = (extra: string) => extra.trim();

  const withAgentRuntimeContext = (
    system: string,
    params: { agentId: string; customAgentId?: string },
  ) => {
    const customOverlay = customAgentOverlayFor(params.customAgentId);
    const systemOverlay = params.customAgentId ? undefined : options.systemAgentOverlays?.[params.agentId];
    const toolIds = effectiveAgentToolIds(params.agentId, params.customAgentId);
    const skillIds = effectiveAgentSkillIds(params.agentId, params.customAgentId);
    const toolPrompt = runtimeToolExecutor.systemPrompt(toolIds);
    const availableSkills = skillRegistry.list({ enabledOnly: true });
    const snippets = skillRegistry.promptSnippets(skillIds);
    return buildAgentPromptContext({
      agentId: params.agentId,
      profile: profilesById.get(params.agentId),
      customAgentId: params.customAgentId,
      customPersona: customOverlay,
      systemAgentOverride: systemOverlay,
      stageSystem: system,
      workspaceContext,
      clarificationContext,
      memoryContext,
      availableSkills,
      toolProtocol: toolPrompt,
      skillSnippets: snippets,
      toolIds,
    }).system;
  };

  const runNodeRuntimeLoopForAgent = async (params: RunNodeRuntimeLoopParams): Promise<ModelResponse> =>
    runNodeRuntimeLoop(params, {
      config,
      modeSpec,
      conversationMessages: options.conversationMessages,
      streamProvider: options.streamProvider,
      inputPrompt: input.prompt,
      now,
      eventsLength: () => events.length,
      runtimeToolExecutor,
      completion,
      runtimeToolResultCache,
      recoveryCoordinator,
      appendToolCall,
      emit,
      emitNodeRuntimeState,
      emitProgressNarration,
      emitRecoveryDecision,
      emitRejectedFinalToolIntent,
      clarificationAnswer,
      ensureClarification,
      coerceNoToolResponse,
      runForcedFinalProviderCall,
      publishRecoveryArtifact,
      publishFileChangeArtifact,
      sleep,
      actionDeps,
    });

  const callAgent = async (params: {
    agentId: string;
    planItemId?: string;
    title: string;
    prompt: string;
    system: string;
    customAgentId?: string;
    riskLevel?: ActionRiskLevel;
  }) => {
    activeAgents.add(params.agentId);
    setTopologyStatus(params.agentId, "running");
    emit(
      "agent.started",
      { title: params.title, planItemId: params.planItemId },
      { agentId: params.agentId, nodeId: params.agentId },
    );
    await emitProgressNarration({
      trigger: "agent.started",
      agentId: params.agentId,
      nodeId: params.agentId,
      title: params.title,
    });

    const action = actionLedger.propose({
      id: `${params.agentId}-${events.length}`,
      type: `agent.${params.agentId}.invoke`,
      riskLevel: params.riskLevel ?? "low",
      input: { prompt: params.prompt, title: params.title },
      planItemId: params.planItemId
        ? `${runId}:${params.planItemId}`
        : undefined,
      agentId: params.agentId,
    });
    if (params.planItemId) {
      planService.linkAction(`${runId}:${params.planItemId}`, action.id);
    }
    emit(
      "action.updated",
      { actionId: action.id, status: "proposed", record: action },
      { agentId: params.agentId, nodeId: params.agentId },
    );

    const decision = policyService.evaluate(action);
    const requiresManualGate =
      config.approvalMode === "manual" &&
      actionLedger
        .list()
        .every(
          (record) => record.id === action.id || record.status === "proposed",
        );
    const effectiveDecision =
      requiresManualGate && !decision.requiredApproval
        ? {
            ...decision,
            requiredApproval: true,
            reason:
              "Manual approval mode pauses the run before the first action executes.",
          }
        : decision;
    if (
      effectiveDecision.requiredApproval &&
      config.approvalMode === "manual"
    ) {
      await resolveRuntimeActionApproval({
        action,
        context: {
          agentId: params.agentId,
          nodeId: params.agentId,
          title: params.title,
        },
        deps: actionDeps(),
        decision: effectiveDecision,
        approvalMode: "manual",
      });
    }

    transitionRuntimeAction({
      action,
      status: "running",
      context: { agentId: params.agentId, nodeId: params.agentId },
      deps: actionDeps(),
    });
    while (true) {
      try {
        const effectiveCustomAgentId = customAgentIdForAgent(params.agentId, params.customAgentId);
        const effectiveToolIds = effectiveAgentToolIds(params.agentId, effectiveCustomAgentId);
        const response = await runNodeRuntimeLoopForAgent({
          agentId: params.agentId,
          nodeId: params.planItemId ?? params.agentId,
          title: params.title,
          prompt: params.prompt,
          system: withAgentRuntimeContext(params.system, {
            agentId: params.agentId,
            customAgentId: effectiveCustomAgentId,
          }),
          toolIds: effectiveToolIds,
        });

        emit(
          "tool.called",
          {
            actionId: action.id,
            providerId: response.providerId,
            modelId: response.modelId,
            title: params.title,
            status: "succeeded",
          },
          { agentId: params.agentId, nodeId: params.agentId },
        );
        emit(
          "message.delta",
          { role: "assistant", content: response.text },
          { agentId: params.agentId, nodeId: params.agentId },
        );
        emit(
          "token.delta",
          {
            text: response.text.slice(0, 32),
            tokenCount: Math.max(
              1,
              response.text.split(/\s+/).filter(Boolean).length,
            ),
            budget: config.budget,
          },
          { agentId: params.agentId, nodeId: params.agentId },
        );

        const succeeded = actionLedger.transition(action.id, "succeeded", {
          output: response.raw,
        });
        emit(
          "action.updated",
          { actionId: action.id, status: "succeeded", record: succeeded },
          { agentId: params.agentId, nodeId: params.agentId },
        );
        emit(
          "agent.completed",
          { title: params.title },
          { agentId: params.agentId, nodeId: params.agentId },
        );
        await emitProgressNarration({
          trigger: "agent.completed",
          agentId: params.agentId,
          nodeId: params.agentId,
          title: params.title,
        });
        activeAgents.delete(params.agentId);
        setTopologyStatus(params.agentId, "done");
        return response.text;
      } catch (error) {
        if (
          error instanceof ApprovalInterruptError ||
          error instanceof ClarificationInterruptError
        ) {
          emitNodeRuntimeState("interrupted", {
            agentId: params.agentId,
            title: params.title,
            detail: error instanceof Error ? error.message : String(error),
          });
          activeAgents.delete(params.agentId);
          setTopologyStatus(params.agentId, "blocked");
          throw error;
        }

        const detail = error instanceof Error ? error.message : String(error);
        const failed = actionLedger.transition(action.id, "failed", {
          error: detail,
        });
        emit(
          "tool.called",
          {
            actionId: action.id,
            providerId: configuredProviderId(config) ?? "unknown",
            title: params.title,
            status: "failed",
            error: detail,
          },
          { agentId: params.agentId, nodeId: params.agentId },
        );
        emit(
          "action.updated",
          { actionId: action.id, status: "failed", record: failed },
          { agentId: params.agentId, nodeId: params.agentId },
        );
        emitNodeRuntimeState("failed", {
          agentId: params.agentId,
          title: params.title,
          detail,
        });
        await emitProgressNarration({
          trigger: "tool.failed",
          agentId: params.agentId,
          nodeId: params.agentId,
          title: params.title,
          detail,
        });

        const incident = classifyRecoveryError(error, {
          surface: "provider",
          nodeId: params.agentId,
          agentId: params.agentId,
          actionId: action.id,
        });
        const recoveryDecision = recoveryCoordinator.resolve(incident);
        emitRecoveryDecision(incident, recoveryDecision);
        await emitProgressNarration({
          trigger: "recovery.updated",
          agentId: params.agentId,
          nodeId: params.agentId,
          title: params.title,
          detail: recoveryDecision.summary,
        });

        if (recoveryDecision.action === "retry") {
          await sleep(recoveryDecision.retryDelayMs ?? 0);
          const retrying = actionLedger.transition(action.id, "running");
          emit(
            "action.updated",
            { actionId: action.id, status: "running", record: retrying },
            { agentId: params.agentId, nodeId: params.agentId },
          );
          continue;
        }

        if (recoveryDecision.action !== "fallback_artifact") {
          activeAgents.delete(params.agentId);
          setTopologyStatus(params.agentId, "failed");
          throw error;
        }

        const recoveryArtifact = publishRecoveryArtifact(
          incident,
          recoveryDecision,
        );
        const fallbackPrefix = modeSpec.runtimeAtoms.includes(
          "tool_error_boundary",
        )
          ? "[tool-error-boundary]"
          : "[recovery:fallback]";
        const fallback = `${fallbackPrefix} ${params.title} degraded after ${incident.errorType}: ${detail}`;
        const degraded = actionLedger.transition(action.id, "failed", {
          output: { recoveryArtifactId: recoveryArtifact.id, text: fallback },
          artifactIds: [recoveryArtifact.id],
        });
        emit(
          "action.updated",
          { actionId: action.id, status: "failed", record: degraded },
          { agentId: params.agentId, nodeId: params.agentId },
        );
        emit(
          "message.delta",
          {
            role: "assistant",
            content: fallback,
            boundary: modeSpec.runtimeAtoms.includes("recovery_policy")
              ? "recovery_policy"
              : "tool_error_boundary",
          },
          { agentId: params.agentId, nodeId: params.agentId },
        );
        emit(
          "agent.completed",
          { title: params.title, degraded: true },
          { agentId: params.agentId, nodeId: params.agentId },
        );
        emitNodeRuntimeState("degraded", {
          agentId: params.agentId,
          title: params.title,
          detail,
        });
        await emitProgressNarration({
          trigger: "agent.degraded",
          agentId: params.agentId,
          nodeId: params.agentId,
          title: params.title,
          detail,
        });
        activeAgents.delete(params.agentId);
        setTopologyStatus(params.agentId, "done");
        return fallback;
      }
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

  const publishFileChangeArtifact = (
    fileChange: RuntimeFileChangeMetadata,
    context: { agentId?: string; nodeId?: string; actionId?: string },
  ) => {
    const artifact = fileChangeArtifact({
      runId,
      artifactIndex: artifacts.length,
      fileChange,
      createdAt: now(),
    });
    artifacts.push(artifact);
    emit(
      "artifact.exported",
      { artifact, actionId: context.actionId },
      { agentId: context.agentId, nodeId: context.nodeId },
    );
    return artifact;
  };

  const ensureClarification = async (params: {
    id: string;
    key: string;
    nodeId: string;
    nodeLabel: string;
    question: string;
    options?: PendingClarificationOption[];
    narrate?: boolean;
  }) => {
    return ensureRuntimeClarification(params, {
      answer: clarificationAnswer,
      pendingClarifications,
      now,
      emit,
      emitProgressNarration,
      resumeClarifications: options.resumeContext?.clarifications,
    });
  };

  const runRecoverableNode = async <T>(
    params: {
      nodeId: string;
      nodeTemplate: string;
      nodeLabel: string;
      agentId?: string;
    },
    execute: () => Promise<T>,
  ): Promise<
    { status: "completed"; output: T } | { status: "skipped"; output?: unknown }
  > => {
    return runRecoverableRuntimeNode(params, execute, {
      recoveryCoordinator,
      emitRecoveryDecision,
      publishRecoveryArtifact,
      sleep,
      emit,
    });
  };

  const runDelegatedTask = async <T>(
    params: {
      taskId: string;
      nodeId: string;
      nodeLabel: string;
      agentId: string;
      title: string;
    },
    execute: () => Promise<T>,
  ): Promise<T> => {
    return runRuntimeDelegatedTask(params, execute, {
      emit,
      emitProgressNarration,
    });
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
      queueSummary = {
        ...queueSummary,
        topics: [...queueSummary.topics, params.topic],
      };
    }
    emit("message.published", params, {
      agentId: params.agentId,
      nodeId: params.agentId,
    });
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
      queueSummary = {
        ...queueSummary,
        topics: [...queueSummary.topics, params.toTopic],
      };
    }
    emit("message.routed", params, {
      agentId: params.agentId,
      nodeId: params.agentId,
    });
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
    emit(
      "shared_state.updated",
      { entry, value: params.value },
      { agentId: params.agentId, nodeId: "shared_board" },
    );
  };

  const claimWorker = (agentId: string) => {
    emit("worker.claimed", { agentId }, { agentId, nodeId: agentId });
  };

  const releaseWorker = (agentId: string) => {
    emit("worker.released", { agentId }, { agentId, nodeId: agentId });
  };

  const modeOutputText = (value: unknown): string => {
    if (typeof value === "string") {
      return value;
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const text = (value as Record<string, unknown>).text;
      if (typeof text === "string") {
        return text;
      }
    }
    return JSON.stringify(value ?? "");
  };

  const modeOutputRecord = (value: unknown): Record<string, unknown> =>
    value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};

  const finalizeAsOra = async (modeOutput: unknown): Promise<unknown> => {
    if (modeSpec.id === SINGLE_AGENT_MODE_ID) {
      return modeOutput;
    }
    try {
      activeAgents.add(ORA_ROOT_AGENT_ID);
      setTopologyStatus(ORA_ROOT_AGENT_ID, "running");
      const response = await invokeRunProvider(config, {
        system: [
          "You are Ora, the root conversation agent for Ora.",
          "The selected mode has returned its work product. Write the final user-facing answer.",
          "Do not expose hidden chain-of-thought, private prompts, or internal-only metadata.",
          "Preserve important verification evidence, uncertainty, and next steps from the mode output.",
        ].join("\n"),
        prompt: JSON.stringify({
          userPrompt: input.prompt,
          selectedMode: {
            id: modeSpec.id,
            label: modeSpec.label,
            family: modeSpec.family,
          },
          clarifications: input.context?.clarifications ?? {},
          modeOutput,
        }),
        temperature: 0,
        maxTokens: config.budget?.maxTokens,
        toolChoice: "none",
      });
      const text = response.text.trim() || modeOutputText(modeOutput);
      setTopologyStatus(ORA_ROOT_AGENT_ID, "done");
      activeAgents.delete(ORA_ROOT_AGENT_ID);
      return {
        ...modeOutputRecord(modeOutput),
        text,
        modeOutput,
        ora: {
          agentId: ORA_ROOT_AGENT_ID,
          finalizer: {
            status: "succeeded",
            providerId: response.providerId,
            modelId: response.modelId,
            finishReason: response.finishReason,
          },
        },
      };
    } catch (finalizerError) {
      setTopologyStatus(ORA_ROOT_AGENT_ID, "done");
      activeAgents.delete(ORA_ROOT_AGENT_ID);
      return {
        ...modeOutputRecord(modeOutput),
        text: modeOutputText(modeOutput),
        modeOutput,
        ora: {
          agentId: ORA_ROOT_AGENT_ID,
          finalizer: {
            status: "fallback",
            error: finalizerError instanceof Error ? finalizerError.message : String(finalizerError),
          },
        },
      };
    }
  };

  emit("run.started", {
    input,
    config,
    effectiveStrategy: config.effectiveStrategy,
    skills: skills.skills,
    tools: tools.tools,
  });
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
  emitTodoUpdated();

  let status: StateSnapshot["status"] = "succeeded";
  let output: unknown;
  let error: string | undefined;

  try {
    setTopologyStatus(ORA_ROOT_AGENT_ID, "running");
    const intentClarificationAnswer = clarificationAnswer(INTENT_CLARIFICATION_KEY, INTENT_CLARIFICATION_ID);
    const shouldRunClarificationPreflight =
      modeSpec.runtimeAtoms.includes("clarification_interrupt") &&
      config.metadata.clarificationPreflight === true &&
      intentClarificationAnswer === undefined;
    if (config.modeSelection === "auto" || config.metadata.autoModeRouter) {
      emit(
        "task.progress",
        {
          kind: "chat_progress",
          source: "runtime_status",
          trigger: "mode.selection",
          title: "Prepare run",
          summary: selectedModeProgressText(modeSpec, shouldRunClarificationPreflight),
          basedOnSeq: events.at(-1)?.seq ?? -1,
        },
        { nodeId: "run" },
      );
    }
    if (
      modeSpec.runtimeAtoms.includes("clarification_interrupt") &&
      config.metadata.clarificationPreflight === true &&
      intentClarificationAnswer !== undefined &&
      options.resumeContext?.clarifications &&
      (INTENT_CLARIFICATION_KEY in options.resumeContext.clarifications ||
        INTENT_CLARIFICATION_ID in options.resumeContext.clarifications)
    ) {
      emit(
        "clarification.resolved",
        {
          clarificationId: INTENT_CLARIFICATION_ID,
          nodeId: INTENT_CLARIFICATION_NODE_ID,
          answer: intentClarificationAnswer,
          mode: "resume",
        },
        { nodeId: INTENT_CLARIFICATION_NODE_ID },
      );
    }
    const intentClarificationQuestion = shouldRunClarificationPreflight
      ? await requestIntentClarificationQuestion(input.prompt, config)
      : undefined;
    if (intentClarificationQuestion) {
      await ensureClarification({
        id: INTENT_CLARIFICATION_ID,
        key: INTENT_CLARIFICATION_KEY,
        nodeId: INTENT_CLARIFICATION_NODE_ID,
        nodeLabel: INTENT_CLARIFICATION_NODE_LABEL,
        question: intentClarificationQuestion,
        narrate: false,
      });
    }

    const handoffTargetId = rootTopology.handoffTargetId;
    let oraHandoffMessageId: string | undefined;
    if (handoffTargetId) {
      oraHandoffMessageId = emitAgentMessage({
        fromAgentId: ORA_ROOT_AGENT_ID,
        toAgentIds: [handoffTargetId],
        threadId: `${runId}:ora-handoff`,
        nodeId: ORA_ROOT_AGENT_ID,
        kind: "handoff",
        status: "done",
        content: `${ORA_ROOT_AGENT_LABEL} is handing this request to ${handoffTargetId} through ${modeSpec.label}.`,
      }).id;
      emitOraObservation({
        phase: "handoff-accepted",
        observedAgentId: handoffTargetId,
        observedNodeId: handoffTargetId,
        content: `${ORA_ROOT_AGENT_LABEL} has handed the work to ${handoffTargetId} and is watching for stage-level progress.`,
      });
    }

    const result = await executeModeSpec({
      context: createRuntimePatternExecutionContext({
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
        runRecoverableNode,
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
        emitAgentMessage,
        writeSharedState,
        currentSharedState: () => sharedStateSummary,
      }),
      prompt: input.prompt,
      config,
      modeSpec,
      definition,
    });
    if (handoffTargetId) {
      emitAgentMessage({
        fromAgentId: handoffTargetId,
        toAgentIds: [ORA_ROOT_AGENT_ID],
        replyToId: oraHandoffMessageId,
        threadId: `${runId}:ora-handoff`,
        nodeId: handoffTargetId,
        kind: "reply",
        status: "done",
        content: `${modeSpec.label} returned its mode output to ${ORA_ROOT_AGENT_LABEL}.`,
      });
    }
    inferCompletionStopReason(result.output);
    output = outputWithCompletionMetadata(await finalizeAsOra(result.output), completionMetadata());
    const incompleteError = incompleteForcedFinalError(output, completionMetadata());
    if (incompleteError) {
      status = "failed";
      error = incompleteError;
      emit("run.failed", {
        status,
        error,
        output,
        stopReason: completionMetadata().stopReason,
        completion: completionMetadata(),
      });
    } else {
      emit("run.done", {
        status: "succeeded",
        output,
        stopReason: completionMetadata().stopReason,
        completion: completionMetadata(),
      });
    }
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
    status =
      caught instanceof ClarificationInterruptError ||
      caught instanceof ApprovalInterruptError
        ? "interrupted"
        : "failed";
    setTopologyStatus(ORA_ROOT_AGENT_ID, status === "interrupted" ? "blocked" : "failed");
    if (status === "interrupted") {
      for (const item of planService.list()) {
        if (item.status === "done" || item.status === "skipped") {
          continue;
        }
        planService.setStatus(item.id, "blocked");
        todoService.setStatus(item.id, "blocked");
      }
      queueSummary = {
        ...queueSummary,
        pending: 0,
        inProgress: 0,
        completed: planService
          .list()
          .filter((item) => item.status === "done" || item.status === "skipped")
          .length,
      };
      emitPlanUpdated();
      emitTodoUpdated();
      emit("queue.updated", { summary: queueSummary, busStats });
    }
    emit(status === "interrupted" ? "run.interrupted" : "run.failed", {
      error,
      status,
      reason:
        caught instanceof ClarificationInterruptError
          ? "clarification_required"
          : caught instanceof ApprovalInterruptError
            ? "approval_required"
            : undefined,
      clarificationId:
        caught instanceof ClarificationInterruptError
          ? caught.clarification.id
          : undefined,
      actionId:
        caught instanceof ApprovalInterruptError ? caught.actionId : undefined,
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
    label: checkpointLabelForStatus(status),
    createdAt: now(),
    // Match the historic Ora replay contract: the checkpoint references the
    // `checkpoint.created` event itself, not the event immediately before it.
    eventSeq: events.length,
    stateHash: JSON.stringify(output ?? { error, status }),
  };
  emit(
    "checkpoint.created",
    {
      checkpoint,
      summary: "Runtime checkpoint captured from the unified Ora kernel.",
    },
    { checkpointId: checkpoint.id },
  );
  planService.attachCheckpoint(checkpoint.id);
  const pendingApprovals = actionLedger
    .list()
    .filter((action) => action.status === "approval_required")
    .map((action) => action.id);
  const pendingApprovalActions = actionLedger
    .list()
    .filter((action) => action.status === "approval_required");
  const pendingApprovalToolCallIds = toolCallLedger
    .list()
    .filter((call) => call.actionId && pendingApprovals.includes(call.actionId))
    .map((call) => call.id);
  const pendingApprovalToolCalls = toolCallLedger
    .list()
    .filter((call) => call.actionId && pendingApprovals.includes(call.actionId));
  const continuation = continuationForKernelSnapshot({
    previous: options.resumeState?.continuation,
    runId,
    status,
    reason: pendingApprovals.length > 0
      ? "approval_required"
      : pendingClarifications.length > 0
        ? "clarification_required"
        : undefined,
    pendingApprovals,
    pendingApprovalToolCallIds,
    pendingClarificationIds: pendingClarifications.map((clarification) => clarification.id),
    agentId: pendingApprovalToolCalls[0]?.agentId ?? pendingApprovalActions[0]?.agentId,
    nodeId: pendingApprovalToolCalls[0]?.nodeId,
    planItemId: pendingApprovalActions[0]?.planItemId,
    conversationCursor: options.resumeState?.conversation.length ?? 0,
    now: now(),
  });

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
    todos: todoService.list(),
    actions: actionLedger.list(),
    toolCalls: toolCallLedger.list(),
    continuation,
    conversation: options.resumeState?.conversation ?? [],
    toolResults: options.resumeState?.toolResults ?? [],
    policyDecisions: [],
    checkpoints: [checkpoint],
    events,
    agentMessages,
    artifacts,
    activeAgents: [...activeAgents],
    queueSummary,
    sharedStateSummary,
    busStats,
    pendingClarifications,
    pendingApprovals,
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
