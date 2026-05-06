import {
  type ActionRiskLevel,
  type ActionRecord,
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
  getPermissionProfile,
  ORA_ROOT_AGENT_ID,
  ORA_ROOT_AGENT_LABEL,
  SINGLE_AGENT_MODE_ID,
  type TaskIntent,
  type PlanItem,
  type PlanListStep,
  type TodoItem,
} from "@cemeworm/shared";
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
  ensureRuntimeClarifications,
  requestIntentClarificationQuestion,
  resolveClarificationAnswer,
} from "./runtime-clarifications.js";
import { buildAgentPromptContext, userClarificationContextPrompt } from "./prompt-context.js";
import {
  attachedLocalFilesSystemPrompt,
  attachedProjectFilesSystemPrompt,
  checkpointLabelForStatus,
  userFacingLanguagePrompt,
  workspaceSystemPrompt,
} from "./runtime-prompts.js";
import {
  RuntimeToolCallLedger,
  type AppendRuntimeToolCallParams,
} from "./runtime-tool-ledger.js";
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
  isInternalProviderAssistantText,
  type NodeRuntimeLoopState,
  runNodeRuntimeLoop,
  type RunNodeRuntimeLoopDeps,
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
  selfIterationRegistry?: import("./runtime-tool-executor.js").SelfIterationRegistryTools;
  automationRegistry?: import("./runtime-tool-executor.js").AutomationRegistryTools;
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
  resumeState?: Pick<StateSnapshot, "plan" | "planList" | "todos" | "actions" | "toolCalls" | "toolResults" | "continuation" | "conversation">;
  streamProvider?: boolean;
  signal?: AbortSignal;
  onEvent?: (event: OraEventEnvelope) => void;
}

class KernelRuntimeContext {
  private readonly eventsValue: OraEventEnvelope[] = [];
  private readonly artifactsValue: ArtifactRef[] = [];
  private readonly agentMessagesValue: AgentConversationMessage[] = [];
  private readonly activeAgentsValue = new Set<string>();
  private readonly pendingClarificationsValue: PendingClarification[] = [];
  private readonly busTopicCountsValue: Record<string, number> = {};
  private readonly sharedEntriesValue: SharedStateSummary["entries"] = [];
  private readonly toolCallLedger: RuntimeToolCallLedger;
  private readonly topologyValue: StateSnapshot["topology"];
  private planListValue: PlanListStep[];
  private queueSummaryValue: QueueSummary;
  private busStatsValue: BusStats;
  private sharedStateSummaryValue: SharedStateSummary;
  private nodeLoopDepsFactory?: () => RunNodeRuntimeLoopDeps;

  constructor(private readonly params: {
    runId: string;
    config: RunConfig;
    now: () => number;
    initialPlanList: PlanListStep[];
    initialToolCalls: OraToolCallEnvelope[];
    initialTopology: StateSnapshot["topology"];
    initialQueueSummary: QueueSummary;
    initialBusStats: BusStats;
    initialSharedStateSummary: SharedStateSummary;
    onEvent?: (event: OraEventEnvelope) => void;
  }) {
    this.planListValue = params.initialPlanList;
    this.toolCallLedger = new RuntimeToolCallLedger(params.runId, params.now, params.initialToolCalls);
    this.topologyValue = params.initialTopology;
    this.queueSummaryValue = params.initialQueueSummary;
    this.busStatsValue = params.initialBusStats;
    this.sharedStateSummaryValue = params.initialSharedStateSummary;
  }

  get events(): OraEventEnvelope[] {
    return this.eventsValue;
  }

  get planList(): PlanListStep[] {
    return this.planListValue;
  }

  get artifacts(): ArtifactRef[] {
    return this.artifactsValue;
  }

  get agentMessages(): AgentConversationMessage[] {
    return this.agentMessagesValue;
  }

  get toolCalls(): OraToolCallEnvelope[] {
    return this.toolCallLedger.list();
  }

  get topology(): StateSnapshot["topology"] {
    return this.topologyValue;
  }

  get activeAgents(): string[] {
    return [...this.activeAgentsValue];
  }

  get pendingClarifications(): PendingClarification[] {
    return this.pendingClarificationsValue;
  }

  get queueSummary(): QueueSummary {
    return this.queueSummaryValue;
  }

  get busStats(): BusStats {
    return this.busStatsValue;
  }

  get sharedStateSummary(): SharedStateSummary {
    return this.sharedStateSummaryValue;
  }

  eventCount(): number {
    return this.eventsValue.length;
  }

  agentMessageCount(): number {
    return this.agentMessagesValue.length;
  }

  artifactCount(): number {
    return this.artifactsValue.length;
  }

  activeAgentCount(): number {
    return this.activeAgentsValue.size;
  }

  pendingClarificationCount(): number {
    return this.pendingClarificationsValue.length;
  }

  activateAgent(agentId: string): void {
    this.activeAgentsValue.add(agentId);
  }

  deactivateAgent(agentId: string): void {
    this.activeAgentsValue.delete(agentId);
  }

  setTopologyStatus(
    agentId: string,
    status: "idle" | "running" | "done" | "blocked" | "failed",
  ): void {
    for (const node of this.topologyValue.nodes) {
      if (node.agentId === agentId || node.id === agentId) {
        node.status = status;
      }
    }
    this.emit("topology.updated", this.topologyValue, { agentId, nodeId: agentId });
  }

  appendAgentMessage(message: AgentConversationMessage): AgentConversationMessage {
    this.agentMessagesValue.push(message);
    return message;
  }

  appendArtifact(artifact: ArtifactRef): ArtifactRef {
    this.artifactsValue.push(artifact);
    return artifact;
  }

  appendToolCall = (params: AppendRuntimeToolCallParams): OraToolCallEnvelope => {
    return this.toolCallLedger.append(params);
  };

  updateQueueSummary(patch: Partial<QueueSummary>): QueueSummary {
    this.queueSummaryValue = { ...this.queueSummaryValue, ...patch };
    return this.queueSummaryValue;
  }

  recordBusPublished(topic: string): { queueSummary: QueueSummary; busStats: BusStats } {
    this.busTopicCountsValue[topic] = (this.busTopicCountsValue[topic] ?? 0) + 1;
    this.busStatsValue = {
      enabled: true,
      publishedCount: this.busStatsValue.publishedCount + 1,
      routedCount: this.busStatsValue.routedCount,
      topicCounts: { ...this.busTopicCountsValue },
    };
    this.addQueueTopic(topic);
    return { queueSummary: this.queueSummaryValue, busStats: this.busStatsValue };
  }

  recordBusRouted(topic: string): { queueSummary: QueueSummary; busStats: BusStats } {
    this.busTopicCountsValue[topic] = (this.busTopicCountsValue[topic] ?? 0) + 1;
    this.busStatsValue = {
      enabled: true,
      publishedCount: this.busStatsValue.publishedCount,
      routedCount: this.busStatsValue.routedCount + 1,
      topicCounts: { ...this.busTopicCountsValue },
    };
    this.addQueueTopic(topic);
    return { queueSummary: this.queueSummaryValue, busStats: this.busStatsValue };
  }

  writeSharedStateEntry(params: {
    key: string;
    summary: string;
    agentId: string;
  }): { entry: SharedStateSummary["entries"][number]; sharedStateSummary: SharedStateSummary } {
    const version = this.sharedStateSummaryValue.version + 1;
    const entry = {
      key: params.key,
      version,
      summary: params.summary,
      updatedBy: params.agentId,
    };
    this.sharedEntriesValue.push(entry);
    this.sharedStateSummaryValue = {
      enabled: true,
      storeKind: "blackboard",
      version,
      entries: [...this.sharedEntriesValue],
      stopReason: params.key === "convergence" ? "converged" : undefined,
    };
    return { entry, sharedStateSummary: this.sharedStateSummaryValue };
  }

  latestEventSeq(): number {
    return this.eventsValue.at(-1)?.seq ?? -1;
  }

  emit = (
    type: OraEventEnvelope["type"],
    payload: unknown,
    extra: Partial<OraEventEnvelope> = {},
  ) => {
    const payloadSnapshot = this.cloneEventPayload(payload);
    const envelope = OraEventEnvelopeSchema.parse({
      id: `${this.params.runId}:evt-${this.eventsValue.length}`,
      runId: this.params.runId,
      seq: this.eventsValue.length,
      type,
      createdAt: this.params.now(),
      pattern: this.params.config.pattern,
      payload: payloadSnapshot,
      ...extra,
    });
    this.eventsValue.push(envelope);
    if (type === "plan_list.updated") {
      const planData = payloadSnapshot as { plan?: PlanListStep[] };
      if (planData.plan) {
        this.planListValue = planData.plan;
      }
    }
    this.params.onEvent?.(envelope);
    return envelope;
  };

  setNodeLoopDepsFactory(factory: () => RunNodeRuntimeLoopDeps): void {
    this.nodeLoopDepsFactory = factory;
  }

  get nodeLoopDeps(): RunNodeRuntimeLoopDeps {
    if (!this.nodeLoopDepsFactory) {
      throw new Error("KernelRuntimeContext node loop dependencies are not initialized.");
    }
    return this.nodeLoopDepsFactory();
  }

  assembleContinuation(params: {
    previous?: StateSnapshot["continuation"];
    status: StateSnapshot["status"];
    actions: ActionRecord[];
    conversationCursor: number;
    now: number;
  }): {
    continuation: StateSnapshot["continuation"];
    pendingApprovals: string[];
  } {
    const pendingApprovalActions = params.actions.filter((action) => action.status === "approval_required");
    const pendingApprovals = pendingApprovalActions.map((action) => action.id);
    const pendingApprovalToolCalls = this.toolCalls.filter((call) =>
      call.actionId && pendingApprovals.includes(call.actionId)
    );
    const pendingApprovalToolCallIds = pendingApprovalToolCalls.map((call) => call.id);
    const continuation = continuationForKernelSnapshot({
      previous: params.previous,
      runId: this.params.runId,
      status: params.status,
      reason: pendingApprovals.length > 0
        ? "approval_required"
        : this.pendingClarificationCount() > 0
          ? "clarification_required"
          : undefined,
      pendingApprovals,
      pendingApprovalToolCallIds,
      pendingClarificationIds: this.pendingClarifications.map((clarification) => clarification.id),
      agentId: pendingApprovalToolCalls[0]?.agentId ?? pendingApprovalActions[0]?.agentId,
      nodeId: pendingApprovalToolCalls[0]?.nodeId,
      planItemId: pendingApprovalActions[0]?.planItemId,
      conversationCursor: params.conversationCursor,
      now: params.now,
    });

    return { continuation, pendingApprovals };
  }

  assembleFinalSnapshot(params: {
    status: StateSnapshot["status"];
    input: UserTaskInput;
    config: RunConfig;
    modeSpec: ModeSpec;
    profiles: StateSnapshot["profiles"];
    memory: StateSnapshot["memory"];
    plan: StateSnapshot["plan"];
    todos: StateSnapshot["todos"];
    actions: ActionRecord[];
    conversation: StateSnapshot["conversation"];
    toolResults: StateSnapshot["toolResults"];
    checkpoint: CheckpointMeta;
    previousContinuation?: StateSnapshot["continuation"];
    conversationCursor: number;
    output: unknown;
    error?: string;
    updatedAt: number;
  }): StateSnapshot {
    const { continuation, pendingApprovals } = this.assembleContinuation({
      previous: params.previousContinuation,
      status: params.status,
      actions: params.actions,
      conversationCursor: params.conversationCursor,
      now: params.updatedAt,
    });

    return StateSnapshotSchema.parse({
      runId: this.params.runId,
      status: params.status,
      pattern: params.config.pattern,
      coordinationKind: params.config.pattern,
      modeId: params.modeSpec.id,
      input: params.input,
      config: params.config,
      topology: this.topology,
      profiles: params.profiles,
      memory: params.memory,
      plan: params.plan,
      planList: this.planList,
      todos: params.todos,
      actions: params.actions,
      toolCalls: this.toolCalls,
      continuation,
      conversation: params.conversation,
      toolResults: params.toolResults,
      policyDecisions: [],
      checkpoints: [params.checkpoint],
      events: this.events,
      agentMessages: this.agentMessages,
      artifacts: this.artifacts,
      activeAgents: this.activeAgents,
      queueSummary: this.queueSummary,
      sharedStateSummary: this.sharedStateSummary,
      busStats: this.busStats,
      pendingClarifications: this.pendingClarifications,
      pendingApprovals,
      modeSpec: params.modeSpec,
      output: params.output,
      error: params.error,
      updatedAt: params.updatedAt,
    });
  }

  private cloneEventPayload<T>(value: T): T {
    if (value === undefined || value === null) {
      return value;
    }
    return JSON.parse(JSON.stringify(value)) as T;
  }

  private addQueueTopic(topic: string): void {
    if (!this.queueSummaryValue.topics.includes(topic)) {
      this.queueSummaryValue = {
        ...this.queueSummaryValue,
        topics: [...this.queueSummaryValue.topics, topic],
      };
    }
  }
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const CODE_DEVELOPMENT_ORCHESTRATOR_BLOCKED_TOOLS = new Set([
  "file.write",
  "file.patch",
  "file.delete",
  "modes.applyDraft",
  "selfIteration.apply",
  "skills.create",
  "skills.update",
  "skills.setEnabled",
]);

function modeProgressFinalizationError(
  planItems: readonly PlanItem[],
  todoItems: readonly TodoItem[],
): string | undefined {
  const unfinishedPlans = planItems.filter((item) => item.status !== "done" && item.status !== "skipped");
  const unfinishedTodos = todoItems.filter((item) => item.status !== "done" && item.status !== "skipped");
  if (unfinishedPlans.length === 0 && unfinishedTodos.length === 0) {
    return undefined;
  }
  const planDetail = unfinishedPlans.map((item) => `plan:${item.id} [${item.status}] ${item.title}`);
  const todoDetail = unfinishedTodos.map((item) => `todo:${item.id} [${item.status}] ${item.label}`);
  return [
    "Mode progress is incomplete; refusing to emit run.done.",
    ...planDetail,
    ...todoDetail,
  ].join("\n");
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
  const resolvedDefinition: PatternDefinition = definition;
  const resolvedModeSpec: ModeSpec = modeSpec;
  const startedAt = now();
  const projectId = input.projectId ?? "local-project";
  const skillRegistry = options.skillRegistry ?? new RuntimeSkillRegistry();
  const toolRegistry = options.toolRegistry ?? new RuntimeToolRegistry();
  const packageManager = new PackageManager();
  const tools = toolRegistry.snapshot();
  const taskIntent = config.metadata.taskIntent as TaskIntent | undefined;
  const permissionProfileId = config.permissionProfileId ?? modeSpec.permissionProfileId;
  const permissionProfile = permissionProfileId ? getPermissionProfile(permissionProfileId) : undefined;
  const runtimeToolExecutor = new RuntimeToolExecutor({
    workspace: input.context?.projectWorkspace,
    toolDescriptors: tools.tools,
    skillRegistry,
    modeRegistry: options.modeRegistry,
    selfIterationRegistry: options.selfIterationRegistry,
    automationRegistry: options.automationRegistry,
    packageManager,
    searchProviderConfig: config.searchProvider,
    toolLimits: modeSpec.toolLimits,
    taskIntent,
    permissionProfile,
    toolDefinitions: toolRegistry.listDefinitions(),
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
  const rootTopology = injectRootAgentTopology({
    nodes: definition.topology.nodes.map((node) => ({ ...node })),
    edges: definition.topology.edges,
  }, modeSpec);
  const initialQueueSummary: QueueSummary = {
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
  const initialBusStats: BusStats = {
    enabled: definition.supportsEventRouting,
    publishedCount: 0,
    routedCount: 0,
    topicCounts: {},
  };
  const initialSharedStateSummary: SharedStateSummary = {
    enabled: definition.supportsSharedState,
    storeKind: definition.supportsSharedState ? "blackboard" : "none",
    version: 0,
    entries: [],
  };
  const kernelRuntimeContext = new KernelRuntimeContext({
    runId,
    config,
    now,
    initialPlanList: options.resumeState?.planList ?? [],
    initialToolCalls: options.resumeState?.toolCalls ?? [],
    initialTopology: {
      nodes: rootTopology.nodes,
      edges: rootTopology.edges,
    },
    initialQueueSummary,
    initialBusStats,
    initialSharedStateSummary,
    onEvent: options.onEvent,
  });
  const emit = kernelRuntimeContext.emit;
  const runtimeToolResultCache = new Map<string, unknown>(
    (options.resumeState?.toolResults ?? [])
      .filter((entry) => entry.status === "succeeded")
      .map((entry) => [entry.key, entry.output] as const),
  );

  const profilesById = new Map(modeSpec.profiles.map((profile) => [profile.id, profile]));
  if (!profilesById.has(ORA_ROOT_AGENT_ID)) {
    profilesById.set(ORA_ROOT_AGENT_ID, rootProfile);
  }
  const agentLabel = (agentId: string): string => profilesById.get(agentId)?.label ?? agentId;

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
      id: `${runId}:agent-message:${kernelRuntimeContext.agentMessageCount()}`,
      runId,
      createdAt: now(),
      toAgentIds: [],
      status: "sent",
      artifactIds: [],
      ...params,
    });
    kernelRuntimeContext.appendAgentMessage(message);
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
    if (config.metadata.showOraObservations !== true) {
      return undefined;
    }
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
      id: `${runId}:recovery:${kernelRuntimeContext.artifactCount()}`,
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
    kernelRuntimeContext.appendArtifact(artifact);
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
      events: kernelRuntimeContext.events,
      activeAgentCount: () => kernelRuntimeContext.activeAgentCount(),
      planStatuses: () => planService.list().map((item) => item.status),
      todoStatuses: () => todoService.list().map((item) => item.status),
      emit,
    });
  };

  const appendToolCall = kernelRuntimeContext.appendToolCall;
  const actionDeps = () => ({
    actionLedger,
    policyService,
    approvalMode: config.approvalMode,
    permissionMode: config.permissionMode,
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
    emitNodeRuntimeState?: typeof emitNodeRuntimeState;
  }): Promise<ModelResponse> => {
    completion.markForcedFinalConsumed({ agentId: params.agentId, nodeId: params.nodeId });
    const forcedFinalStateEmitter = params.emitNodeRuntimeState ?? emitNodeRuntimeState;
    const invokeForcedFinalProvider = async (messages: ModelMessage[]): Promise<ModelResponse> => {
      try {
        return await params.invokeProvider(
          params.config,
          {
            messages,
            system: forcedFinalSystemPrompt(params.system, params.reason),
            maxTokens: params.config.budget?.maxTokens,
            tools: params.nativeTools,
            toolChoice: params.nativeTools.length > 0 ? "none" : undefined,
            signal: options.signal,
          },
          params.streamCallbacks,
        );
      } catch (caught) {
        if (params.agentId) {
          forcedFinalStateEmitter("failed", {
            agentId: params.agentId,
            title: params.title,
            reason: params.reason,
            detail: caught instanceof Error ? caught.message : String(caught),
          });
        }
        throw caught;
      }
    };
    const response = await invokeForcedFinalProvider(params.messages);
    const fallbackToolIntent = extractRuntimeToolCallFromText(
      response.text,
      config.toolIds,
    );
    if (fallbackToolIntent) {
      emitRejectedFinalToolIntent(fallbackToolIntent, params.reason);
      const retryResponse = await invokeForcedFinalProvider([
        ...params.messages,
        {
          role: "user",
          content: [
            `Completion control rejected a ${fallbackToolIntent.tool} tool call because tools are disabled for this final answer.`,
            "Do not call tools or emit tool JSON.",
            "Use the available conversation and prior tool results to answer the user's original request now.",
          ].join("\n"),
        },
      ]);
      const finalResponse = coerceNoToolResponse(retryResponse, params.reason);
      if (params.agentId) {
        forcedFinalStateEmitter("completed", {
          agentId: params.agentId,
          title: params.title,
        });
      }
      return finalResponse;
    }
    const finalResponse = coerceNoToolResponse(response, params.reason);
    if (params.agentId) {
      forcedFinalStateEmitter("completed", {
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
    kernelRuntimeContext.setTopologyStatus(agentId, status);
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
    const queueSummary = kernelRuntimeContext.updateQueueSummary({
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
    });
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
      return restrictToolsForAgentBoundary(agentId, config.toolIds);
    }
    const requested = new Set(requestedToolIds);
    return restrictToolsForAgentBoundary(agentId, config.toolIds.filter((toolId) => requested.has(toolId)));
  };

  const restrictToolsForAgentBoundary = (agentId: string, toolIds: string[]): string[] => {
    if (modeSpec.id !== "code_development" || agentId !== "orchestrator") {
      return toolIds;
    }
    return toolIds.filter((toolId) => !CODE_DEVELOPMENT_ORCHESTRATOR_BLOCKED_TOOLS.has(toolId));
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
  const userLanguageContext = userFacingLanguagePrompt(input.prompt);
  const memoryContext =
    typeof config.metadata.memoryPromptOverlay === "string"
      ? config.metadata.memoryPromptOverlay
      : undefined;
  const taskIntentContext = (() => {
    const taskIntent = config.metadata.taskIntent as TaskIntent | undefined;
    switch (taskIntent) {
      case "chat":
        return "你处于对话模式，不能修改任何文件。请以问答方式帮助用户，解释代码、回答问题，但不要尝试编辑或创建文件。";
      case "plan":
        return [
          "你处于计划模式。你的目标：产出一份可直接交接给执行者实施的完整计划。不要执行任何文件修改操作。",
          "",
          "## 停止标准",
          "计划必须「决策完备」：另一个 agent 或工程师拿到这份计划后，不需要做任何实现决策即可开始执行。",
          "当以下条件满足时，停止探索并输出计划：",
          "- 剩余未知项不影响实现决策，或",
          "- 未知项已被记录为明确假设/默认选择",
          "",
          "## 未知分类",
          "A. 可发现事实（repo 中的代码、配置、schema）→ 自行探索，不问用户",
          "B. 偏好/取舍（产品意图、技术选型）→ 问用户；若无回答，采用推荐默认值并记录为假设",
          "",
          "## 三阶段推进",
          "Phase 1 - 环境理解：读代码、搜配置、看 schema、找入口",
          "Phase 2 - 意图确认：确认目标、成功标准、约束、范围",
          "Phase 3 - 方案设计：确认实现路径、接口、数据流、边界、测试",
          "",
          "只有 Phase 3 达到「决策完备」，才输出计划。",
          "",
          "## 输出协议",
          "决策完备后，输出：",
          "<proposed_plan>",
          "计划标题",
          "## 背景",
          "简要上下文",
          "## 实施步骤",
          "1. [步骤] - 涉及文件: path/to/file - 预期变更: ...",
          "2. ...",
          "## 假设与默认选择",
          "- [列出所有假设和未确认的偏好项]",
          "## 验证方式",
          "- [如何验证实施结果]",
          "</proposed_plan>",
          "",
          "输出上述 XML 块后，立即停止——不要继续调用任何工具，不要追加解释文字。",
        ].join("\n");
      default:
        return undefined;
    }
  })();
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
      stageSystem: [userLanguageContext, system].join("\n\n"),
      workspaceContext,
      clarificationContext,
      memoryContext,
      taskIntentContext,
      availableSkills,
      toolProtocol: toolPrompt,
      skillSnippets: snippets,
      toolIds,
    }).system;
  };

  kernelRuntimeContext.setNodeLoopDepsFactory(() => ({
    config,
    modeSpec,
    conversationMessages: options.conversationMessages,
    streamProvider: options.streamProvider,
    signal: options.signal,
    inputPrompt: input.prompt,
    now,
    eventsLength: () => kernelRuntimeContext.eventCount(),
    planList: () => kernelRuntimeContext.planList,
    toolCalls: () => kernelRuntimeContext.toolCalls,
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
    ensureClarifications,
    coerceNoToolResponse,
    runForcedFinalProviderCall,
    publishRecoveryArtifact,
    publishFileChangeArtifact,
    sleep,
    actionDeps,
  }));

  const runNodeRuntimeLoopForAgent = async (params: RunNodeRuntimeLoopParams): Promise<ModelResponse> =>
    runNodeRuntimeLoop(params, kernelRuntimeContext.nodeLoopDeps);

  const callAgent = async (params: {
    agentId: string;
    planItemId?: string;
    title: string;
    prompt: string;
    system: string;
    customAgentId?: string;
    riskLevel?: ActionRiskLevel;
  }) => {
    kernelRuntimeContext.activateAgent(params.agentId);
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

    const actionType = `agent.${params.agentId}.invoke`;
    const expectedPlanItemId = params.planItemId
      ? `${runId}:${params.planItemId}`
      : undefined;
    const resumeAction = actionLedger.list().find((record) =>
      record.type === actionType &&
      record.agentId === params.agentId &&
      record.status === "approval_required" &&
      (expectedPlanItemId === undefined || record.planItemId === expectedPlanItemId)
    );
    const action = resumeAction ?? actionLedger.propose({
      id: `${params.agentId}-${kernelRuntimeContext.eventCount()}`,
      type: actionType,
      riskLevel: params.riskLevel ?? "low",
      input: { prompt: params.prompt, title: params.title },
      planItemId: expectedPlanItemId,
      agentId: params.agentId,
    });
    if (params.planItemId) {
      planService.linkAction(`${runId}:${params.planItemId}`, action.id);
    }
    if (!resumeAction) {
      emit(
        "action.updated",
        { actionId: action.id, status: "proposed", record: action },
        { agentId: params.agentId, nodeId: params.agentId },
      );
    }

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
          {
            role: "assistant",
            content: response.text,
            ...(isInternalProviderAssistantText(response.text)
              ? { visibility: "internal" }
              : {}),
          },
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
        kernelRuntimeContext.deactivateAgent(params.agentId);
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
          kernelRuntimeContext.deactivateAgent(params.agentId);
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
          kernelRuntimeContext.deactivateAgent(params.agentId);
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
        const visibleFallback = `${params.title} continued with limited context after a recoverable runtime issue.`;
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
            visibility: "internal",
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
        kernelRuntimeContext.deactivateAgent(params.agentId);
        setTopologyStatus(params.agentId, "done");
        return visibleFallback;
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
    kernelRuntimeContext.appendArtifact(artifact);
    emit("artifact.exported", { artifact });
  };

  const publishFileChangeArtifact = (
    fileChange: RuntimeFileChangeMetadata,
    context: { agentId?: string; nodeId?: string; actionId?: string },
  ) => {
    const artifact = fileChangeArtifact({
      runId,
      artifactIndex: kernelRuntimeContext.artifactCount(),
      fileChange,
      createdAt: now(),
    });
    kernelRuntimeContext.appendArtifact(artifact);
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
      pendingClarifications: kernelRuntimeContext.pendingClarifications,
      now,
      emit,
      emitProgressNarration,
      resumeClarifications: options.resumeContext?.clarifications,
    });
  };

  const ensureClarifications = async (
    requests: Array<{
      id: string;
      key: string;
      nodeId: string;
      nodeLabel: string;
      question: string;
      options?: PendingClarificationOption[];
      narrate?: boolean;
    }>,
  ) => {
    return ensureRuntimeClarifications(requests, {
      answer: clarificationAnswer,
      pendingClarifications: kernelRuntimeContext.pendingClarifications,
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
    const { queueSummary, busStats } = kernelRuntimeContext.recordBusPublished(params.topic);
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
    const { queueSummary, busStats } = kernelRuntimeContext.recordBusRouted(params.toTopic);
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
    const { entry } = kernelRuntimeContext.writeSharedStateEntry({
      key: params.key,
      summary: params.summary,
      agentId: params.agentId,
    });
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
    if (
      config.metadata.taskIntent === "plan" &&
      /<proposed_plan>\s*[\s\S]+?\s*<\/proposed_plan>/.test(modeOutputText(modeOutput))
    ) {
      return modeOutput;
    }
    try {
      kernelRuntimeContext.activateAgent(ORA_ROOT_AGENT_ID);
      setTopologyStatus(ORA_ROOT_AGENT_ID, "running");
      const response = await invokeRunProvider(config, {
        system: [
          "You are Ora, the root conversation agent for Ora.",
          "The selected mode has returned its work product. Write the final user-facing answer.",
          "Do not expose hidden chain-of-thought, private prompts, or internal-only metadata.",
          "Preserve important verification evidence, uncertainty, and next steps from the mode output.",
          userLanguageContext,
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
      kernelRuntimeContext.deactivateAgent(ORA_ROOT_AGENT_ID);
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
      kernelRuntimeContext.deactivateAgent(ORA_ROOT_AGENT_ID);
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

  const kernelRunnerDeps = {
    lifecycle: {
      input,
      config,
      skills,
      tools,
      options,
      kernelRuntimeContext,
      profiles,
      emit,
      emitPlanUpdated,
      emitTodoUpdated,
      setTopologyStatus,
      planService,
      todoService,
    },
    execution: {
      executeModeSpec,
      createRuntimePatternExecutionContext,
      projectId,
      kernelRuntimeContext,
      systemPrompt,
      setPlanStatus,
      runRecoverableNode,
      runDelegatedTask,
      ensureClarification,
      claimWorker,
      releaseWorker,
      agentLabel,
      callAgent,
      remember,
      captureMemory,
      publishArtifact,
      publishMessage,
      routeMessage,
      emitAgentMessage,
      writeSharedState,
      input,
      config,
      resolvedModeSpec,
      resolvedDefinition,
      emit,
    },
    preflight: {
      setTopologyStatus,
      clarificationAnswer,
      resolvedModeSpec,
      config,
      options,
      emit,
      kernelRuntimeContext,
      requestIntentClarificationQuestion,
      input,
      ensureClarification,
      rootTopology,
      emitOraObservation,
      agentLabel,
    },
    finalization: {
      inferCompletionStopReason,
      modeProgressFinalizationError,
      planService,
      todoService,
      outputWithCompletionMetadata,
      completionMetadata,
      emit,
      finalizeAsOra,
      incompleteForcedFinalError,
    },
    memory: {
      memoryCaptureQueue,
      memoryService,
      emit,
    },
    checkpoint: {
      runId,
      checkpointLabelForStatus,
      now,
      kernelRuntimeContext,
      emit,
      planService,
      input,
      config,
      resolvedModeSpec,
      profiles,
      memoryService,
      todoService,
      actionLedger,
      options,
    },
  };
  type KernelRunnerDeps = Readonly<typeof kernelRunnerDeps>;

  class KernelRunner {
    private status: StateSnapshot["status"] = "succeeded";
    private output: unknown;
    private error: string | undefined;

    constructor(private readonly deps: KernelRunnerDeps) {}

    async run(): Promise<StateSnapshot> {
      this.emitStartEvents();
      await this.executeMode();
      this.flushMemory();
      return this.checkpoint();
    }

    private emitStartEvents(): void {
      const {
        input,
        config,
        skills,
        tools,
        options,
        kernelRuntimeContext,
        profiles,
        emit,
        emitPlanUpdated,
        emitTodoUpdated,
      } = this.deps.lifecycle;

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
      emit("topology.updated", kernelRuntimeContext.topology);
      emit("profile.updated", { profiles });
      emitPlanUpdated();
      emitTodoUpdated();
    }

    private async executeMode(): Promise<void> {
      const {
        executeModeSpec,
        createRuntimePatternExecutionContext,
        projectId,
        kernelRuntimeContext,
        systemPrompt,
        setPlanStatus,
        runRecoverableNode,
        runDelegatedTask,
        ensureClarification,
        claimWorker,
        releaseWorker,
        agentLabel,
        callAgent,
        remember,
        captureMemory,
        publishArtifact,
        publishMessage,
        routeMessage,
        emitAgentMessage,
        writeSharedState,
        input,
        config,
        resolvedModeSpec,
        resolvedDefinition,
      } = this.deps.execution;

      try {
        await this.preflight();
        const result = await executeModeSpec({
          context: createRuntimePatternExecutionContext({
            projectId,
            queueSummary: () => kernelRuntimeContext.queueSummary,
            sharedStateSummary: () => kernelRuntimeContext.sharedStateSummary,
            busStats: () => kernelRuntimeContext.busStats,
            systemPrompt,
            setPlanStatus,
            setQueueSummary: (patch) => {
              const queueSummary = kernelRuntimeContext.updateQueueSummary(patch);
              emit("queue.updated", { summary: queueSummary, busStats: kernelRuntimeContext.busStats });
            },
            runRecoverableNode,
            runDelegatedTask,
            ensureClarification,
            claimWorker,
            releaseWorker,
            agentLabel,
            callAgent,
            remember,
            captureMemory,
            publishArtifact,
            publishMessage,
            routeMessage,
            emitAgentMessage,
            writeSharedState,
            currentSharedState: () => kernelRuntimeContext.sharedStateSummary,
          }),
          prompt: input.prompt,
          config,
          modeSpec: resolvedModeSpec,
          definition: resolvedDefinition,
        });
        await this.finalizeModeResult(result.output);
      } catch (caught) {
        this.handleModeError(caught);
      }
    }

    private async preflight(): Promise<void> {
      const {
        setTopologyStatus,
        clarificationAnswer,
        resolvedModeSpec,
        config,
        options,
        emit,
        kernelRuntimeContext,
        requestIntentClarificationQuestion,
        input,
        ensureClarification,
        rootTopology,
        emitOraObservation,
        agentLabel,
      } = this.deps.preflight;

      setTopologyStatus(ORA_ROOT_AGENT_ID, "running");
      const intentClarificationAnswer = clarificationAnswer(INTENT_CLARIFICATION_KEY, INTENT_CLARIFICATION_ID);
      const shouldRunClarificationPreflight =
        resolvedModeSpec.runtimeAtoms.includes("clarification_interrupt") &&
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
            summary: selectedModeProgressText(resolvedModeSpec, shouldRunClarificationPreflight),
            basedOnSeq: kernelRuntimeContext.latestEventSeq(),
          },
          { nodeId: "run" },
        );
      }
      if (
        resolvedModeSpec.runtimeAtoms.includes("clarification_interrupt") &&
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
      if (handoffTargetId) {
        emitOraObservation({
          phase: "handoff-accepted",
          observedAgentId: handoffTargetId,
          observedNodeId: handoffTargetId,
          content: `${ORA_ROOT_AGENT_LABEL} 已交给 ${agentLabel(handoffTargetId)}，并会继续观察阶段进展。`,
        });
      }
    }

    private async finalizeModeResult(modeOutput: unknown): Promise<void> {
      const {
        inferCompletionStopReason,
        modeProgressFinalizationError,
        planService,
        todoService,
        outputWithCompletionMetadata,
        completionMetadata,
        emit,
        finalizeAsOra,
        incompleteForcedFinalError,
      } = this.deps.finalization;

      inferCompletionStopReason(modeOutput);
      const modeProgressError = modeProgressFinalizationError(planService.list(), todoService.list());
      if (modeProgressError) {
        this.status = "failed";
        this.error = modeProgressError;
        this.output = outputWithCompletionMetadata({
          text: modeProgressError,
          modeOutput,
        }, completionMetadata());
        emit("run.failed", {
          status: this.status,
          error: this.error,
          output: this.output,
          stopReason: completionMetadata().stopReason,
          completion: completionMetadata(),
        });
        return;
      }

      this.output = outputWithCompletionMetadata(await finalizeAsOra(modeOutput), completionMetadata());
      const incompleteError = incompleteForcedFinalError(this.output, completionMetadata());
      if (incompleteError) {
        this.status = "failed";
        this.error = incompleteError;
        emit("run.failed", {
          status: this.status,
          error: this.error,
          output: this.output,
          stopReason: completionMetadata().stopReason,
          completion: completionMetadata(),
        });
        return;
      }

      emit("run.done", {
        status: "succeeded",
        output: this.output,
        stopReason: completionMetadata().stopReason,
        completion: completionMetadata(),
      });
    }

    private handleModeError(caught: unknown): void {
      const {
        setTopologyStatus,
        planService,
        todoService,
        kernelRuntimeContext,
        emitPlanUpdated,
        emitTodoUpdated,
        emit,
      } = this.deps.lifecycle;

      this.error = caught instanceof Error ? caught.message : String(caught);
      this.status =
        caught instanceof ClarificationInterruptError ||
        caught instanceof ApprovalInterruptError
          ? "interrupted"
          : "failed";
      setTopologyStatus(ORA_ROOT_AGENT_ID, this.status === "interrupted" ? "blocked" : "failed");
      if (this.status === "interrupted") {
        for (const item of planService.list()) {
          if (item.status === "done" || item.status === "skipped") {
            continue;
          }
          planService.setStatus(item.id, "blocked");
          todoService.setStatus(item.id, "blocked");
        }
        const queueSummary = kernelRuntimeContext.updateQueueSummary({
          pending: 0,
          inProgress: 0,
          completed: planService
            .list()
            .filter((item) => item.status === "done" || item.status === "skipped")
            .length,
        });
        emitPlanUpdated();
        emitTodoUpdated();
        emit("queue.updated", { summary: queueSummary, busStats: kernelRuntimeContext.busStats });
      }
      emit(this.status === "interrupted" ? "run.interrupted" : "run.failed", {
        error: this.error,
        status: this.status,
        reason:
          caught instanceof ClarificationInterruptError
            ? "clarification_required"
            : caught instanceof ApprovalInterruptError
              ? "approval_required"
              : undefined,
        clarificationId:
          caught instanceof ClarificationInterruptError && caught.clarifications.length === 1
            ? caught.clarification.id
            : undefined,
        clarificationIds:
          caught instanceof ClarificationInterruptError
            ? caught.clarifications.map((c) => c.id)
            : undefined,
        actionId:
          caught instanceof ApprovalInterruptError ? caught.actionId : undefined,
      });
    }

    private flushMemory(): void {
      const { memoryCaptureQueue, memoryService, emit } = this.deps.memory;

      if (memoryCaptureQueue.size() === 0) {
        return;
      }
      const flushed = memoryCaptureQueue.flush(memoryService);
      for (const record of flushed) {
        emit("memory.updated", { record });
      }
      emit("memory.flushed", {
        count: flushed.length,
        recordIds: flushed.map((record) => record.id),
      });
    }

    private checkpoint(): StateSnapshot {
      const {
        runId,
        checkpointLabelForStatus,
        now,
        kernelRuntimeContext,
        emit,
        planService,
        input,
        config,
        resolvedModeSpec,
        profiles,
        memoryService,
        todoService,
        actionLedger,
        options,
      } = this.deps.checkpoint;

      const checkpoint: CheckpointMeta = {
        id: `${runId}:checkpoint-0`,
        runId,
        label: checkpointLabelForStatus(this.status),
        createdAt: now(),
        // Match the historic Ora replay contract: the checkpoint references the
        // `checkpoint.created` event itself, not the event immediately before it.
        eventSeq: kernelRuntimeContext.eventCount(),
        stateHash: JSON.stringify(this.output ?? { error: this.error, status: this.status }),
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
      return kernelRuntimeContext.assembleFinalSnapshot({
        status: this.status,
        input,
        config,
        modeSpec: resolvedModeSpec,
        profiles,
        memory: memoryService.list(),
        plan: planService.list(),
        todos: todoService.list(),
        actions: actionLedger.list(),
        conversation: options.resumeState?.conversation ?? [],
        toolResults: options.resumeState?.toolResults ?? [],
        checkpoint,
        previousContinuation: options.resumeState?.continuation,
        conversationCursor: options.resumeState?.conversation.length ?? 0,
        output: this.output,
        error: this.error,
        updatedAt: now(),
      });
    }
  }

  const snapshot = await new KernelRunner(kernelRunnerDeps).run();

  return {
    snapshot,
    tools,
  };
}
