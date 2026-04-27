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
  type PendingClarification,
  RecoveryArtifactSchema,
  OraEventEnvelopeSchema,
  PendingClarificationSchema,
  StateSnapshotSchema,
  type CompletionStopReason,
  type CustomAgentDetail,
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
  type RuntimeToolCall,
} from "./runtime-tool-executor.js";
import {
  classifyRecoveryError,
  RecoveryCoordinator,
  type RecoveryDecision,
  type RecoveryIncident,
} from "./recovery-policy.js";
import { executeModeSpec } from "../patterns/driver-registry.js";
import type {
  ModelMessage,
  ModelResponse,
  ModelToolCall,
} from "../providers/index.js";
import {
  FORCED_FINAL_FALLBACK_TEXT,
  RUNTIME_TOOL_LOOP_SAFETY_LIMIT,
  RuntimeCompletionController,
} from "./runtime-completion.js";
import {
  ApprovalInterruptError,
  ClarificationInterruptError,
  createResumeApprovalMatcher,
  type ApprovedResumeAction,
} from "./runtime-interrupts.js";
import {
  checkpointLabelForStatus,
  normalizeProgressNarration,
  summarizeNarratorProgressPayload,
  workspaceSystemPrompt,
} from "./runtime-prompts.js";
import { RuntimeToolCallLedger } from "./runtime-tool-ledger.js";
import { PackageManager } from "../package-manager.js";
import {
  cacheKeyForRuntimeTool,
  providerSupportsNativeTools,
  providerToolCallToAttempt,
  type RuntimeToolAttempt,
} from "./runtime-tool-loop.js";

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
  streamProvider?: boolean;
  onEvent?: (event: OraEventEnvelope) => void;
}

function countStatuses(statuses: Array<string | undefined>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const status of statuses) {
    if (!status) {
      continue;
    }
    counts[status] = (counts[status] ?? 0) + 1;
  }
  return counts;
}

function narratorEventKind(eventType: string): string {
  if (eventType.startsWith("tool.")) {
    return "tool_activity";
  }
  if (eventType.startsWith("approval.")) {
    return "approval";
  }
  if (eventType.startsWith("clarification.")) {
    return "clarification";
  }
  if (eventType.startsWith("task.")) {
    return "work_progress";
  }
  if (eventType.startsWith("recovery.")) {
    return "recovery";
  }
  if (eventType.startsWith("run.")) {
    return "run_status";
  }
  return "activity";
}

const TOOL_REPAIR_CONTENT =
  "Tool call was interrupted before a result was produced. Continue from available context or choose another action.";
const PROGRESS_NARRATION_MAX_TOKENS = 96;
const INTENT_CLARIFICATION_ID = "clarification:intent_guard";
const INTENT_CLARIFICATION_KEY = "intent_guard";
const INTENT_CLARIFICATION_NODE_ID = "intent_guard";
const INTENT_CLARIFICATION_NODE_LABEL = "Clarify request";
const INTENT_CLARIFICATION_MAX_TOKENS = 220;

type NodeRuntimeLoopState =
  | "pending"
  | "running_model"
  | "tool_requested"
  | "tool_running"
  | "tool_result_observed"
  | "repairing"
  | "finalizing"
  | "completed"
  | "degraded"
  | "interrupted"
  | "failed";

function sleep(ms: number): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function userClarificationContextPrompt(context: UserTaskInput["context"]): string | undefined {
  const clarifications = context?.clarifications;
  if (!clarifications || typeof clarifications !== "object" || clarifications === null) {
    return undefined;
  }
  const entries = Object.entries(clarifications as Record<string, unknown>)
    .filter(([, value]) => value !== undefined && value !== null && String(value).trim().length > 0)
    .slice(0, 8)
    .map(([key, value]) => `- ${key}: ${String(value).trim().slice(0, 1000)}`);
  if (entries.length === 0) {
    return undefined;
  }
  return [
    "User-supplied clarification context:",
    ...entries,
    "Treat these clarifications as explicit constraints for the current run. Do not ignore them or replace them with assumptions.",
  ].join("\n");
}

async function requestIntentClarificationQuestion(
  prompt: string,
  config: RunConfig,
): Promise<string | undefined> {
  try {
    const response = await invokeRunProvider(config, {
      system: [
        "You are Ora's clarification preflight for a native AI agent.",
        "Decide whether the user's request is materially ambiguous before the agent uses tools or answers.",
        "Ask for clarification only when the referent, requested action, or critical constraints are unclear enough that proceeding would likely answer the wrong target, take the wrong action, or create a costly mistake.",
        "Do not ask for clarification for ordinary ambiguity about style, wording, optimization preference, or low-cost defaults. In those cases the agent can proceed with a brief assumption.",
        "Material ambiguity is about variables that would change the outcome or action. Common examples are the user's role, target entity, requested action, jurisdiction, scale, eligibility, timing, or other critical constraints.",
        "When the user says things like we, our, this kind, or this scale without defining the operative context, ask only if that context would materially change the answer.",
        "If clarification is required, write one compact question in the user's language that names the missing variables. Do not invent missing facts.",
        "Return only JSON with this shape: {\"needsClarification\": boolean, \"missingVariables\": string[], \"question\": string}.",
      ].join("\n"),
      messages: [{
        role: "user",
        content: JSON.stringify({
          prompt,
          outputContract: {
            needsClarification: "boolean",
            missingVariables: "string[]; facts that would materially change the answer or action",
            question: "string; empty when needsClarification is false",
          },
        }),
      }],
      maxTokens: INTENT_CLARIFICATION_MAX_TOKENS,
      toolChoice: "none",
      temperature: 0,
    });
    return parseIntentClarificationQuestion(response.text);
  } catch {
    return undefined;
  }
}

function parseIntentClarificationQuestion(text: string): string | undefined {
  const trimmed = text.trim();
  const jsonText = trimmed.startsWith("{")
    ? trimmed
    : trimmed.match(/\{[\s\S]*\}/)?.[0];
  if (!jsonText) {
    return parseTaggedIntentClarificationQuestion(trimmed);
  }
  try {
    const parsed = JSON.parse(jsonText) as Record<string, unknown>;
    const missingVariables = Array.isArray(parsed.missingVariables)
      ? parsed.missingVariables.filter((item) => typeof item === "string" && item.trim().length > 0)
      : [];
    const needsClarification = parsed.needsClarification === true || missingVariables.length > 0;
    if (!needsClarification || typeof parsed.question !== "string") {
      return undefined;
    }
    const question = parsed.question.trim();
    return question.length > 0 ? question.slice(0, 800) : undefined;
  } catch {
    return parseTaggedIntentClarificationQuestion(trimmed);
  }
}

function parseTaggedIntentClarificationQuestion(text: string): string | undefined {
  const block = text.match(/<clarification_decision>([\s\S]*?)<\/clarification_decision>/i)?.[1] ?? text;
  const needsClarification = /needs[_\s-]*clarification\s*:\s*(true|yes)/i.test(block);
  if (!needsClarification) {
    return undefined;
  }
  const question = block.match(/question\s*:\s*(.+?)(?:\n\w[\w\s-]*\s*:|$)/is)?.[1]?.trim();
  return question ? question.slice(0, 800) : undefined;
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
    packageManager,
    searchProviderConfig: config.searchProvider,
  });
  const skills = skillRegistry.snapshot(modeSpec.family);
  const profiles = new AgentProfileRegistry(definition).list(config.profileIds);
  const memoryService = new MemoryService(runId, now);
  const memoryCaptureQueue = new MemoryCaptureQueue();
  const planService = new PlanService(runId, definition);
  const todoService = new TodoService(runId, now, planService.list());
  const actionLedger = new ActionLedger(runId);
  const policyService = new PolicyService(runId, now);
  const resumeApprovals = createResumeApprovalMatcher(options.resumeContext);
  const events: OraEventEnvelope[] = [];
  const artifacts: ArtifactRef[] = [];
  const agentMessages: AgentConversationMessage[] = [];
  const toolCallLedger = new RuntimeToolCallLedger(runId, now);
  const runtimeToolResultCache = new Map<string, unknown>();
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

  const topology = {
    nodes: definition.topology.nodes.map((node) => ({ ...node })),
    edges: definition.topology.edges,
  };
  const profilesById = new Map(modeSpec.profiles.map((profile) => [profile.id, profile]));

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
    if (config.metadata.progressNarration !== true) {
      return;
    }
    const basedOnSeq = events.at(-1)?.seq ?? -1;
    try {
      const recentEvents = events.slice(-8).map((event) => ({
        kind: narratorEventKind(event.type),
        payload: summarizeNarratorProgressPayload(event.type, event.payload),
      })).filter((event) => event.payload !== undefined);
      const response = await invokeRunProvider(config, {
        system: [
          "You write concise live progress updates for an assistant run.",
          "Match the user's language. If the user wrote in Chinese, write the progress update in Chinese.",
          "Describe only what has happened, what is being worked on, and the likely next step.",
          "Do not claim the final answer is known. Do not output tool JSON. Do not mention internal event names, mode names, stage names, routing, subscribers, or sequence numbers.",
          "Prefer user-facing work verbs such as reading, searching, comparing, drafting, checking, and waiting for approval.",
          "Return one natural sentence under 64 words.",
        ].join("\n"),
        messages: [
          {
            role: "user",
            content: JSON.stringify({
              userPrompt: input.prompt,
              languageInstruction:
                "Use the same language as userPrompt for the progress update.",
              activeAgentCount: activeAgents.size,
              planStatusCounts: countStatuses(planService.list().map((item) => item.status)),
              todoStatusCounts: countStatuses(todoService.list().map((item) => item.status)),
              recentEvents,
            }),
          },
        ],
        temperature: 0.2,
        maxTokens: PROGRESS_NARRATION_MAX_TOKENS,
        toolChoice: "none",
      });
      const summary = normalizeProgressNarration(response.text);
      if (!summary) {
        return;
      }
      emit(
        "task.progress",
        {
          kind: "chat_progress",
          source: "progress_narrator",
          trigger: params.trigger,
          title: params.title,
          detail: params.detail,
          summary,
          basedOnSeq,
        },
        { agentId: params.agentId, nodeId: params.nodeId },
      );
    } catch {
      // Progress narration is cosmetic; provider failures must never affect the run.
    }
  };

  const appendToolCall = toolCallLedger.append.bind(toolCallLedger);

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

  const forcedFinalSystemPrompt = (
    system: string,
    reason: CompletionStopReason,
  ) =>
    [
      system,
      "Completion control:",
      `- Stop reason: ${reason}.`,
      "- Do not call tools.",
      "- Use the available conversation and tool results.",
      "- State any uncertainty or missing evidence briefly.",
    ]
      .filter(Boolean)
      .join("\n\n");

  const emitRejectedFinalToolIntent = (
    call: RuntimeToolCall,
    reason: CompletionStopReason,
  ) => {
    emit("completion.updated", {
      state: "tool_call_text_rejected",
      reason,
      toolId: call.tool,
      args: call.args,
    });
  };

  const coerceNoToolResponse = (
    response: ModelResponse,
    reason: CompletionStopReason,
    options: { emitRejectedToolIntent?: boolean } = {},
  ): ModelResponse => {
    const fallbackToolIntent = extractRuntimeToolCallFromText(
      response.text,
      config.toolIds,
    );
    if (fallbackToolIntent && options.emitRejectedToolIntent !== false) {
      emitRejectedFinalToolIntent(fallbackToolIntent, reason);
    }
    const fallbackText = fallbackToolIntent
      ? FORCED_FINAL_FALLBACK_TEXT
      : response.text.trim() || FORCED_FINAL_FALLBACK_TEXT;
    if ((response.toolCalls?.length ?? 0) > 0) {
      completion.setCompletionStopReason("forced_final_answer");
      emit("completion.updated", {
        state: "tool_calls_ignored",
        reason,
        ignoredToolCalls: response.toolCalls,
      });
    }
    return {
      ...response,
      text: fallbackText,
      toolCalls: [],
      finishReason:
        response.finishReason === "tool_calls" ? "stop" : response.finishReason,
    };
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

  const outputWithCompletionMetadata = (value: unknown): unknown => {
    const metadata = completionMetadata();
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const record = value as Record<string, unknown>;
      const existingMetadata =
        record.metadata &&
        typeof record.metadata === "object" &&
        !Array.isArray(record.metadata)
          ? (record.metadata as Record<string, unknown>)
          : {};
      return {
        ...record,
        metadata: {
          ...existingMetadata,
          completion: metadata,
          stopReason: metadata.stopReason,
        },
      };
    }
    return {
      text: typeof value === "string" ? value : String(value ?? ""),
      metadata: {
        completion: metadata,
        stopReason: metadata.stopReason,
      },
    };
  };

  const isForcedFinalFallbackOutput = (value: unknown): boolean => {
    if (typeof value === "string") {
      return value.trim() === FORCED_FINAL_FALLBACK_TEXT;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return false;
    }
    const record = value as Record<string, unknown>;
    return (
      typeof record.text === "string" &&
      record.text.trim() === FORCED_FINAL_FALLBACK_TEXT
    );
  };

  const incompleteForcedFinalError = (value: unknown): string | undefined => {
    const metadata = completionMetadata();
    if (metadata.forcedFinal && isForcedFinalFallbackOutput(value)) {
      return `Run stopped before completing the task: ${metadata.stopReason}. The model returned only Ora's forced-final fallback.`;
    }
    return undefined;
  };

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
    const resumeClarifications = options.resumeContext?.clarifications;
    if (resumeClarifications && typeof resumeClarifications === "object") {
      if (id in resumeClarifications) {
        return resumeClarifications[id];
      }
      if (key in resumeClarifications) {
        return resumeClarifications[key];
      }
    }
    const clarifications = input.context?.clarifications;
    if (
      !clarifications ||
      typeof clarifications !== "object" ||
      clarifications === null
    ) {
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

  const systemPrompt = (extra: string) => {
    const memoryOverlay =
      typeof config.metadata.memoryPromptOverlay === "string"
        ? config.metadata.memoryPromptOverlay
        : undefined;
    return [
      extra,
      workspaceSystemPrompt(input.context?.projectWorkspace),
      userClarificationContextPrompt(input.context),
      memoryOverlay,
    ]
      .filter(Boolean)
      .join("\n\n");
  };

  const withAgentRuntimeContext = (
    system: string,
    params: { agentId: string; customAgentId?: string },
  ) => {
    const customOverlay = customAgentOverlayFor(params.customAgentId);
    const systemOverlay = params.customAgentId ? undefined : options.systemAgentOverlays?.[params.agentId];
    const toolPrompt = runtimeToolExecutor.systemPrompt(effectiveAgentToolIds(params.agentId, params.customAgentId));
    const snippets = skillRegistry.promptSnippets(effectiveAgentSkillIds(params.agentId, params.customAgentId));
    return [customOverlay, systemOverlay, system, toolPrompt, ...snippets].filter(Boolean).join("\n\n");
  };

  const runNodeRuntimeLoop = async (params: {
    agentId: string;
    nodeId: string;
    title: string;
    prompt: string;
    system: string;
    toolIds: string[];
  }): Promise<ModelResponse> => {
    const completionScope = { agentId: params.agentId, nodeId: params.nodeId };
    const enabledTools = runtimeToolExecutor.enabledToolIds(params.toolIds);
    const nativeTools = providerSupportsNativeTools(config)
      ? runtimeToolExecutor.toolDefinitions(params.toolIds)
      : [];
    let messages: ModelMessage[] = [...(options.conversationMessages ?? [])];
    const invokeProvider = options.streamProvider
      ? invokeRunProviderStream
      : invokeRunProvider;
    const streamCallbacks = options.streamProvider
      ? {
          onTextDelta: (chunk: {
            delta: string;
            text: string;
            raw?: unknown;
          }) => {
            emit(
              "message.delta",
              {
                role: "assistant",
                content: chunk.text,
                delta: chunk.delta,
                streaming: true,
                raw: chunk.raw,
              },
              { agentId: params.agentId, nodeId: params.agentId },
            );
            emit(
              "token.delta",
              {
                text: chunk.delta,
                tokenCount: Math.max(
                  1,
                  chunk.delta.split(/\s+/).filter(Boolean).length,
                ),
                budget: config.budget,
                streaming: true,
              },
              { agentId: params.agentId, nodeId: params.agentId },
            );
          },
        }
      : undefined;
    const repairDanglingToolCalls = (candidateMessages: ModelMessage[]) => {
      const pending = new Map<
        string,
        { call: ModelToolCall; messageIndex: number }
      >();
      for (let index = 0; index < candidateMessages.length; index += 1) {
        const message = candidateMessages[index];
        if (message.role === "assistant" && message.toolCalls?.length) {
          for (const call of message.toolCalls) {
            pending.set(call.id, { call, messageIndex: index });
          }
          continue;
        }
        if (message.role === "tool" && message.toolCallId) {
          pending.delete(message.toolCallId);
        }
      }
      if (pending.size === 0) {
        return candidateMessages;
      }
      const repairedMessages = [...candidateMessages];
      for (const { call } of pending.values()) {
        appendToolCall({
          providerCallId: call.id,
          toolId: call.toolId,
          args: call.args,
          source: "manual_repair",
          status: "repaired",
          agentId: params.agentId,
          nodeId: params.agentId,
          result: {
            status: "interrupted",
            error: TOOL_REPAIR_CONTENT,
            content: TOOL_REPAIR_CONTENT,
            createdAt: now(),
            updatedAt: now(),
          },
          error: TOOL_REPAIR_CONTENT,
          repairReason: "missing_provider_tool_result",
        });
        emit(
          "tool.repaired",
          {
            providerCallId: call.id,
            toolId: call.toolId,
            status: "repaired",
            resultStatus: "interrupted",
            repairReason: "missing_provider_tool_result",
            content: TOOL_REPAIR_CONTENT,
          },
          { agentId: params.agentId, nodeId: params.agentId },
        );
        repairedMessages.push({
          role: "tool",
          toolCallId: call.id,
          toolName: call.toolId,
          content: TOOL_REPAIR_CONTENT,
        });
      }
      return repairedMessages;
    };
    emitNodeRuntimeState("pending", {
      agentId: params.agentId,
      title: params.title,
    });
    messages = repairDanglingToolCalls(messages);
    const initialToolsAllowed = completion.toolsAllowed(completionScope);
    if (!initialToolsAllowed && completion.toolAttempts >= completion.maxToolCalls) {
      completion.forceFinalAnswer("tool_budget_exhausted");
    }
    emitNodeRuntimeState(initialToolsAllowed ? "running_model" : "finalizing", {
      agentId: params.agentId,
      title: params.title,
    });
    let response = await invokeProvider(
      config,
      {
        prompt: params.prompt,
        messages,
        system: initialToolsAllowed
          ? params.system
          : forcedFinalSystemPrompt(
              params.system,
              completion.stopReasonForScope(completionScope) ?? "tool_budget_exhausted",
            ),
        maxTokens: config.budget?.maxTokens,
        tools: nativeTools,
        toolChoice:
          nativeTools.length > 0
            ? initialToolsAllowed
              ? "auto"
              : "none"
            : undefined,
      },
      streamCallbacks,
    );
    if (!initialToolsAllowed) {
      const finalResponse = coerceNoToolResponse(
        response,
        completion.stopReasonForScope(completionScope) ?? "tool_budget_exhausted",
      );
      emitNodeRuntimeState("completed", {
        agentId: params.agentId,
        title: params.title,
      });
      return finalResponse;
    }

    if (enabledTools.length === 0) {
      emitNodeRuntimeState("completed", {
        agentId: params.agentId,
        title: params.title,
      });
      return response;
    }

    const remainingToolBudget = Number.isFinite(completion.maxToolCalls)
      ? Math.max(0, completion.maxToolCalls - completion.toolAttempts)
      : RUNTIME_TOOL_LOOP_SAFETY_LIMIT;
    const toolLoopLimit = Math.max(
      1,
      Math.min(RUNTIME_TOOL_LOOP_SAFETY_LIMIT, remainingToolBudget),
    );
    for (let iteration = 0; iteration < toolLoopLimit; iteration += 1) {
      if (!completion.toolsAllowed(completionScope)) {
        return runForcedFinalProviderCall({
          invokeProvider,
          config,
          messages,
          system: params.system,
          nativeTools,
          streamCallbacks,
          reason: completion.stopReasonForScope(completionScope) ?? "tool_budget_exhausted",
          agentId: params.agentId,
          nodeId: params.nodeId,
          title: params.title,
        });
      }

      const nativeToolCall = response.toolCalls
        ?.map(providerToolCallToAttempt)
        .find(Boolean);
      const fallbackToolCall = nativeToolCall
        ? undefined
        : runtimeToolExecutor.extractToolCall(response.text, params.toolIds);
      const toolCall: RuntimeToolAttempt | undefined =
        nativeToolCall ??
        (fallbackToolCall
          ? { ...fallbackToolCall, source: "json_fallback" }
          : undefined);
      if (!toolCall) {
        emitNodeRuntimeState("completed", {
          agentId: params.agentId,
          title: params.title,
          iteration,
        });
        return response;
      }
      emitNodeRuntimeState("tool_requested", {
        agentId: params.agentId,
        title: params.title,
        toolId: toolCall.tool,
        iteration,
      });

      const attemptDecision = completion.registerToolAttempt(toolCall, completionScope);
      if (!attemptDecision.allowed) {
        emitNodeRuntimeState("finalizing", {
          agentId: params.agentId,
          title: params.title,
          toolId: toolCall.tool,
          reason: attemptDecision.reason,
          iteration,
        });
        return runForcedFinalProviderCall({
          invokeProvider,
          config,
          messages,
          system: params.system,
          nativeTools,
          streamCallbacks,
          reason: attemptDecision.reason,
          agentId: params.agentId,
          nodeId: params.nodeId,
          title: params.title,
        });
      }

      const riskLevel = runtimeToolExecutor.riskLevel(toolCall);
      const action = actionLedger.propose({
        id: `${params.agentId}-tool-${events.length}`,
        type: toolCall.tool,
        riskLevel,
        input: toolCall.args,
        approvalRequest:
          riskLevel === "high"
            ? runtimeToolExecutor.approvalRequest(toolCall, input.prompt)
            : undefined,
        agentId: params.agentId,
      });
      const toolCallRecord = appendToolCall({
        providerCallId: toolCall.providerCallId,
        toolId: toolCall.tool,
        args: toolCall.args,
        source: toolCall.source,
        status: "proposed",
        actionId: action.id,
        agentId: params.agentId,
        nodeId: params.agentId,
      });
      emit(
        "action.updated",
        { actionId: action.id, status: "proposed", record: action },
        { agentId: params.agentId, nodeId: params.agentId },
      );

      const decision = policyService.evaluate(action);
      let approvedForRiskyExecution =
        !decision.requiredApproval || config.approvalMode === "auto";
      if (decision.requiredApproval && config.approvalMode !== "auto") {
        if (!resumeApprovals.consume(action)) {
          const blocked = actionLedger.transition(
            action.id,
            "approval_required",
          );
          appendToolCall({ ...toolCallRecord, status: "approval_required" });
          emit(
            "approval.required",
            { actionId: action.id, decision },
            { agentId: params.agentId, nodeId: params.agentId },
          );
          emit(
            "action.updated",
            {
              actionId: action.id,
              status: "approval_required",
              record: blocked,
            },
            { agentId: params.agentId, nodeId: params.agentId },
          );
          await emitProgressNarration({
            trigger: "approval.required",
            agentId: params.agentId,
            nodeId: params.agentId,
            title: params.title,
            detail: decision.reason,
          });
          throw new ApprovalInterruptError(action.id);
        }
        approvedForRiskyExecution = true;
        emit(
          "approval.resolved",
          {
            actionId: action.id,
            decision: "approved",
            mode: "resume",
          },
          { agentId: params.agentId, nodeId: params.agentId },
        );
        const approved = actionLedger.transition(action.id, "approved");
        appendToolCall({ ...toolCallRecord, status: "approved" });
        emit(
          "action.updated",
          { actionId: action.id, status: "approved", record: approved },
          { agentId: params.agentId, nodeId: params.agentId },
        );
      }

      const running = actionLedger.transition(action.id, "running");
      appendToolCall({ ...toolCallRecord, status: "running" });
      emit(
        "action.updated",
        { actionId: action.id, status: "running", record: running },
        { agentId: params.agentId, nodeId: params.agentId },
      );
      emitNodeRuntimeState("tool_running", {
        agentId: params.agentId,
        title: params.title,
        actionId: action.id,
        toolId: toolCall.tool,
        iteration,
      });

      try {
        const cacheKey = cacheKeyForRuntimeTool(toolCall);
        const cacheHit =
          cacheKey !== undefined && runtimeToolResultCache.has(cacheKey);
        const output = cacheHit
          ? runtimeToolResultCache.get(cacheKey)
          : await runtimeToolExecutor.execute(toolCall, {
              allowRisky: approvedForRiskyExecution,
            });
        if (cacheKey && !cacheHit) {
          runtimeToolResultCache.set(cacheKey, output);
        }
        completion.markToolResultObserved(toolCall, cacheHit, completionScope);
        const succeeded = actionLedger.transition(action.id, "succeeded", {
          output,
        });
        const resultText = JSON.stringify(output, null, 2);
        appendToolCall({
          ...toolCallRecord,
          status: "succeeded",
          result: {
            status: "succeeded",
            output,
            content: resultText,
            createdAt: now(),
            updatedAt: now(),
          },
        });
        emit(
          "tool.called",
          {
            toolCallId: toolCallRecord.id,
            providerCallId: toolCall.providerCallId,
            actionId: action.id,
            toolId: toolCall.tool,
            source: toolCall.source,
            status: "succeeded",
            input: toolCall.args,
            output,
            cacheHit,
          },
          { agentId: params.agentId, nodeId: params.agentId },
        );
        emit(
          "action.updated",
          { actionId: action.id, status: "succeeded", record: succeeded },
          { agentId: params.agentId, nodeId: params.agentId },
        );
        emitNodeRuntimeState("tool_result_observed", {
          agentId: params.agentId,
          title: params.title,
          actionId: action.id,
          toolId: toolCall.tool,
          iteration,
        });
        await emitProgressNarration({
          trigger: "tool.succeeded",
          agentId: params.agentId,
          nodeId: params.agentId,
          title: params.title,
          detail: `${toolCall.tool} returned a result.`,
        });

        messages =
          toolCall.source === "provider_native" && toolCall.providerCallId
            ? [
                ...messages,
                {
                  role: "assistant",
                  content: response.text,
                  reasoningContent: response.reasoningContent,
                  toolCalls: response.toolCalls?.filter(
                    (call) => call.id === toolCall.providerCallId,
                  ),
                },
                {
                  role: "tool",
                  toolCallId: toolCall.providerCallId,
                  toolName: toolCall.tool,
                  content: resultText,
                },
              ]
            : [
                ...messages,
                { role: "assistant", content: response.text },
                {
                  role: "user",
                  content: `Workspace tool result for ${toolCall.tool}:\n${resultText}`,
                },
              ];
        messages = repairDanglingToolCalls(messages);
        if (completion.forcedFinalIsActive(completionScope)) {
          const stopReason = completion.stopReasonForScope(completionScope) ?? "forced_final_answer";
          emitNodeRuntimeState("finalizing", {
            agentId: params.agentId,
            title: params.title,
            toolId: toolCall.tool,
            reason: stopReason,
            iteration,
          });
          response = await runForcedFinalProviderCall({
            invokeProvider,
            config,
            messages,
            system: params.system,
            nativeTools,
            streamCallbacks,
            reason: stopReason,
            agentId: params.agentId,
            nodeId: params.nodeId,
            title: params.title,
          });
          return response;
        }
        emitNodeRuntimeState("running_model", {
          agentId: params.agentId,
          title: params.title,
          iteration: iteration + 1,
        });
        response = await invokeProvider(
          config,
          {
            messages,
            system: params.system,
            maxTokens: config.budget?.maxTokens,
            tools: nativeTools,
            toolChoice: nativeTools.length > 0 ? "auto" : undefined,
          },
          streamCallbacks,
        );
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        const failed = actionLedger.transition(action.id, "failed", {
          error: detail,
        });
        appendToolCall({
          ...toolCallRecord,
          status: "failed",
          result: {
            status: "failed",
            error: detail,
            content: detail,
            createdAt: now(),
            updatedAt: now(),
          },
          error: detail,
        });
        emit(
          "tool.called",
          {
            toolCallId: toolCallRecord.id,
            providerCallId: toolCall.providerCallId,
            actionId: action.id,
            toolId: toolCall.tool,
            source: toolCall.source,
            status: "failed",
            input: toolCall.args,
            error: detail,
          },
          { agentId: params.agentId, nodeId: params.agentId },
        );
        emit(
          "action.updated",
          { actionId: action.id, status: "failed", record: failed },
          { agentId: params.agentId, nodeId: params.agentId },
        );
        emitNodeRuntimeState("degraded", {
          agentId: params.agentId,
          title: params.title,
          actionId: action.id,
          toolId: toolCall.tool,
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
          surface: "tool",
          nodeId: params.agentId,
          agentId: params.agentId,
          toolId: toolCall.tool,
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
          continue;
        }

        if (
          recoveryDecision.action === "alternate_tool" &&
          recoveryDecision.alternateToolId
        ) {
          const alternateCall: RuntimeToolCall = {
            tool: recoveryDecision.alternateToolId as RuntimeToolCall["tool"],
            args: toolCall.args,
          };
          const alternateAttemptDecision =
            completion.registerToolAttempt(alternateCall, completionScope);
          if (!alternateAttemptDecision.allowed) {
            emitNodeRuntimeState("finalizing", {
              agentId: params.agentId,
              title: params.title,
              toolId: alternateCall.tool,
              reason: alternateAttemptDecision.reason,
              iteration,
            });
            return runForcedFinalProviderCall({
              invokeProvider,
              config,
              messages,
              system: params.system,
              nativeTools,
              streamCallbacks,
              reason: alternateAttemptDecision.reason,
              agentId: params.agentId,
              nodeId: params.nodeId,
              title: params.title,
            });
          }
          const alternateRiskLevel =
            runtimeToolExecutor.riskLevel(alternateCall);
          const alternateAction = actionLedger.propose({
            id: `${params.agentId}-tool-recovery-${events.length}`,
            type: alternateCall.tool,
            riskLevel: alternateRiskLevel,
            input: alternateCall.args,
            approvalRequest:
              alternateRiskLevel === "high"
                ? runtimeToolExecutor.approvalRequest(
                    alternateCall,
                    input.prompt,
                  )
                : undefined,
            agentId: params.agentId,
          });
          emit(
            "action.updated",
            {
              actionId: alternateAction.id,
              status: "proposed",
              record: alternateAction,
            },
            { agentId: params.agentId, nodeId: params.agentId },
          );
          const alternateDecision = policyService.evaluate(alternateAction);
          const alternateApproved =
            !alternateDecision.requiredApproval ||
            config.approvalMode === "auto"
              ? false
              : resumeApprovals.consume(alternateAction);
          if (
            alternateDecision.requiredApproval &&
            config.approvalMode !== "auto"
          ) {
            if (!alternateApproved) {
              const blocked = actionLedger.transition(
                alternateAction.id,
                "approval_required",
              );
              emit(
                "approval.required",
                { actionId: alternateAction.id, decision: alternateDecision },
                { agentId: params.agentId, nodeId: params.agentId },
              );
              emit(
                "action.updated",
                {
                  actionId: alternateAction.id,
                  status: "approval_required",
                  record: blocked,
                },
                { agentId: params.agentId, nodeId: params.agentId },
              );
              await emitProgressNarration({
                trigger: "approval.required",
                agentId: params.agentId,
                nodeId: params.agentId,
                title: params.title,
                detail: alternateDecision.reason,
              });
              throw new ApprovalInterruptError(alternateAction.id);
            }
            emit(
              "approval.resolved",
              {
                actionId: alternateAction.id,
                decision: "approved",
                mode: "resume",
              },
              { agentId: params.agentId, nodeId: params.agentId },
            );
            const approved = actionLedger.transition(
              alternateAction.id,
              "approved",
            );
            emit(
              "action.updated",
              {
                actionId: alternateAction.id,
                status: "approved",
                record: approved,
              },
              { agentId: params.agentId, nodeId: params.agentId },
            );
          }
          const alternateRunning = actionLedger.transition(
            alternateAction.id,
            "running",
          );
          emit(
            "action.updated",
            {
              actionId: alternateAction.id,
              status: "running",
              record: alternateRunning,
            },
            { agentId: params.agentId, nodeId: params.agentId },
          );
          emitNodeRuntimeState("tool_running", {
            agentId: params.agentId,
            title: params.title,
            actionId: alternateAction.id,
            toolId: alternateCall.tool,
            iteration,
          });
          const alternateOutput = await runtimeToolExecutor.execute(
            alternateCall,
            {
              allowRisky:
                !alternateDecision.requiredApproval ||
                config.approvalMode === "auto" ||
                alternateApproved,
            },
          );
          completion.markToolResultObserved(alternateCall, false, completionScope);
          const alternateSucceeded = actionLedger.transition(
            alternateAction.id,
            "succeeded",
            { output: alternateOutput },
          );
          emit(
            "tool.called",
            {
              actionId: alternateAction.id,
              toolId: alternateCall.tool,
              status: "succeeded",
              input: alternateCall.args,
              output: alternateOutput,
              recoveredFrom: toolCall.tool,
            },
            { agentId: params.agentId, nodeId: params.agentId },
          );
          emit(
            "action.updated",
            {
              actionId: alternateAction.id,
              status: "succeeded",
              record: alternateSucceeded,
            },
            { agentId: params.agentId, nodeId: params.agentId },
          );
          emitNodeRuntimeState("tool_result_observed", {
            agentId: params.agentId,
            title: params.title,
            actionId: alternateAction.id,
            toolId: alternateCall.tool,
            iteration,
          });
          messages = [
            ...messages,
            { role: "assistant", content: response.text },
            {
              role: "user",
              content: `Workspace tool result for ${alternateCall.tool}:\n${JSON.stringify(alternateOutput, null, 2)}`,
            },
          ];
          if (completion.forcedFinalIsActive(completionScope)) {
            const stopReason = completion.stopReasonForScope(completionScope) ?? "forced_final_answer";
            emitNodeRuntimeState("finalizing", {
              agentId: params.agentId,
              title: params.title,
              toolId: alternateCall.tool,
              reason: stopReason,
              iteration,
            });
            response = await runForcedFinalProviderCall({
              invokeProvider,
              config,
              messages,
              system: params.system,
              nativeTools,
              streamCallbacks,
              reason: stopReason,
              agentId: params.agentId,
              nodeId: params.nodeId,
              title: params.title,
            });
            return response;
          }
          emitNodeRuntimeState("running_model", {
            agentId: params.agentId,
            title: params.title,
            iteration: iteration + 1,
          });
          response = await invokeProvider(
            config,
            {
              messages,
              system: params.system,
              maxTokens: config.budget?.maxTokens,
              tools: nativeTools,
              toolChoice: nativeTools.length > 0 ? "auto" : undefined,
            },
            streamCallbacks,
          );
          continue;
        }

        if (recoveryDecision.action === "fallback_artifact") {
          const recoveryArtifact = publishRecoveryArtifact(
            incident,
            recoveryDecision,
          );
          const fallbackPrefix = modeSpec.runtimeAtoms.includes(
            "tool_error_boundary",
          )
            ? "[tool-error-boundary]"
            : "[recovery:fallback]";
          emit(
            "message.delta",
            {
              role: "assistant",
              content: `${fallbackPrefix} ${toolCall.tool} degraded after ${incident.errorType}: ${incident.detail}`,
              boundary: modeSpec.runtimeAtoms.includes("recovery_policy")
                ? "recovery_policy"
                : "tool_error_boundary",
            },
            { agentId: params.agentId, nodeId: params.agentId },
          );
          const fallbackOutput = recoveryDecision.usableOutput ?? {
            degraded: true,
            recoveryArtifactId: recoveryArtifact.id,
            errorType: incident.errorType,
            error: incident.detail,
          };
          messages = [
            ...messages,
            { role: "assistant", content: response.text },
            {
              role: "user",
              content: `Workspace tool degraded for ${toolCall.tool}:\n${JSON.stringify(fallbackOutput, null, 2)}`,
            },
          ];
          emitNodeRuntimeState("repairing", {
            agentId: params.agentId,
            title: params.title,
            toolId: toolCall.tool,
            detail: incident.detail,
          });
          response = await invokeProvider(
            config,
            {
              messages,
              system: params.system,
              maxTokens: config.budget?.maxTokens,
              tools: nativeTools,
              toolChoice: nativeTools.length > 0 ? "auto" : undefined,
            },
            streamCallbacks,
          );
          continue;
        }

        throw error;
      }
    }

    completion.forceFinalAnswer("runtime_tool_loop_limit");
    emitNodeRuntimeState("finalizing", {
      agentId: params.agentId,
      title: params.title,
      reason: "runtime_tool_loop_limit",
    });
    return runForcedFinalProviderCall({
      invokeProvider,
      config,
      messages,
      system: params.system,
      nativeTools,
      streamCallbacks,
      reason: "runtime_tool_loop_limit",
      agentId: params.agentId,
      title: params.title,
    });
  };

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
      if (resumeApprovals.consume(action)) {
        emit(
          "approval.resolved",
          {
            actionId: action.id,
            decision: "approved",
            mode: "resume",
          },
          { agentId: params.agentId, nodeId: params.agentId },
        );
        const approved = actionLedger.transition(action.id, "approved");
        emit(
          "action.updated",
          { actionId: action.id, status: "approved", record: approved },
          { agentId: params.agentId, nodeId: params.agentId },
        );
      } else {
        const blocked = actionLedger.transition(action.id, "approval_required");
        emit(
          "approval.required",
          { actionId: action.id, decision: effectiveDecision },
          { agentId: params.agentId, nodeId: params.agentId },
        );
        emit(
          "action.updated",
          { actionId: action.id, status: "approval_required", record: blocked },
          { agentId: params.agentId, nodeId: params.agentId },
        );
        await emitProgressNarration({
          trigger: "approval.required",
          agentId: params.agentId,
          nodeId: params.agentId,
          title: params.title,
          detail: effectiveDecision.reason,
        });
        throw new ApprovalInterruptError(action.id);
      }
    }

    const running = actionLedger.transition(action.id, "running");
    emit(
      "action.updated",
      { actionId: action.id, status: "running", record: running },
      { agentId: params.agentId, nodeId: params.agentId },
    );
    while (true) {
      try {
        const effectiveCustomAgentId = customAgentIdForAgent(params.agentId, params.customAgentId);
        const effectiveToolIds = effectiveAgentToolIds(params.agentId, effectiveCustomAgentId);
        const response = await runNodeRuntimeLoop({
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

  const ensureClarification = async (params: {
    id: string;
    key: string;
    nodeId: string;
    nodeLabel: string;
    question: string;
    narrate?: boolean;
  }) => {
    const answered = clarificationAnswer(params.key, params.id);
    if (answered !== undefined) {
      const resumeClarifications = options.resumeContext?.clarifications;
      if (
        resumeClarifications &&
        (params.id in resumeClarifications ||
          params.key in resumeClarifications)
      ) {
        emit(
          "clarification.resolved",
          {
            clarificationId: params.id,
            nodeId: params.nodeId,
            answer: answered,
            mode: "resume",
          },
          { nodeId: params.nodeId },
        );
      }
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
    emit(
      "clarification.required",
      {
        clarification,
        pending: pendingClarifications.length,
      },
      { nodeId: params.nodeId },
    );
    if (params.narrate !== false) {
      await emitProgressNarration({
        trigger: "clarification.required",
        nodeId: params.nodeId,
        title: params.nodeLabel,
        detail: params.question,
      });
    }
    throw new ClarificationInterruptError(clarification);
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
    while (true) {
      try {
        const output = await execute();
        return { status: "completed", output };
      } catch (error) {
        if (
          error instanceof ApprovalInterruptError ||
          error instanceof ClarificationInterruptError
        ) {
          throw error;
        }
        const incident = classifyRecoveryError(error, {
          surface: "node",
          nodeId: params.nodeId,
          nodeTemplate: params.nodeTemplate,
          agentId: params.agentId,
        });
        const recoveryDecision = recoveryCoordinator.resolve(incident);
        emitRecoveryDecision(incident, recoveryDecision);

        if (recoveryDecision.action === "retry") {
          await sleep(recoveryDecision.retryDelayMs ?? 0);
          continue;
        }

        if (recoveryDecision.action === "skip_node") {
          emit(
            "node.skipped",
            {
              nodeId: params.nodeId,
              nodeLabel: params.nodeLabel,
              decision: recoveryDecision,
              error: incident.detail,
            },
            { nodeId: params.nodeId, agentId: params.agentId },
          );
          return { status: "skipped", output: recoveryDecision.usableOutput };
        }

        if (recoveryDecision.action === "fallback_artifact") {
          const recoveryArtifact = publishRecoveryArtifact(
            incident,
            recoveryDecision,
          );
          return {
            status: "completed",
            output: (recoveryDecision.usableOutput ?? {
              degraded: true,
              recoveryArtifactId: recoveryArtifact.id,
              nodeId: params.nodeId,
              errorType: incident.errorType,
              error: incident.detail,
            }) as T,
          };
        }

        throw error;
      }
    }
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
    emit(
      "task.started",
      {
        taskId: params.taskId,
        nodeId: params.nodeId,
        nodeLabel: params.nodeLabel,
        title: params.title,
      },
      { agentId: params.agentId, nodeId: params.nodeId },
    );
    emit(
      "task.progress",
      {
        taskId: params.taskId,
        nodeId: params.nodeId,
        nodeLabel: params.nodeLabel,
        title: params.title,
        phase: "running",
      },
      { agentId: params.agentId, nodeId: params.nodeId },
    );
    await emitProgressNarration({
      trigger: "task.progress",
      agentId: params.agentId,
      nodeId: params.nodeId,
      title: params.title,
    });
    try {
      const result = await execute();
      emit(
        "task.completed",
        {
          taskId: params.taskId,
          nodeId: params.nodeId,
          nodeLabel: params.nodeLabel,
          title: params.title,
        },
        { agentId: params.agentId, nodeId: params.nodeId },
      );
      await emitProgressNarration({
        trigger: "task.completed",
        agentId: params.agentId,
        nodeId: params.nodeId,
        title: params.title,
      });
      return result;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      emit(
        "task.failed",
        {
          taskId: params.taskId,
          nodeId: params.nodeId,
          nodeLabel: params.nodeLabel,
          title: params.title,
          error: detail,
        },
        { agentId: params.agentId, nodeId: params.nodeId },
      );
      await emitProgressNarration({
        trigger: "task.failed",
        agentId: params.agentId,
        nodeId: params.nodeId,
        title: params.title,
        detail,
      });
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

  emit("run.started", {
    input,
    config,
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
    const intentClarificationAnswer = clarificationAnswer(INTENT_CLARIFICATION_KEY, INTENT_CLARIFICATION_ID);
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
    const intentClarificationQuestion = modeSpec.runtimeAtoms.includes("clarification_interrupt") &&
        config.metadata.clarificationPreflight === true &&
        intentClarificationAnswer === undefined
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
      },
      prompt: input.prompt,
      config,
      modeSpec,
      definition,
    });
    inferCompletionStopReason(result.output);
    output = outputWithCompletionMetadata(result.output);
    const incompleteError = incompleteForcedFinalError(output);
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
    pendingApprovals: actionLedger
      .list()
      .filter((action) => action.status === "approval_required")
      .map((action) => action.id),
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
