import {
  type ActionRiskLevel,
  type ArtifactRef,
  ArtifactRefSchema,
  type CheckpointMeta,
  type ModeSpec,
  type OraEventEnvelope,
  type OraToolCallEnvelope,
  OraToolCallEnvelopeSchema,
  type OraToolCallSource,
  type OraToolCallStatus,
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
} from "@ora/shared";
import { ActionLedger, AgentProfileRegistry, MemoryCaptureQueue, MemoryService, PlanService, PolicyService, TodoService } from "../capabilities.js";
import { configuredProviderId, invokeRunProvider, invokeRunProviderStream } from "../providers/index.js";
import { RuntimeSkillRegistry, RuntimeToolRegistry } from "./capability-registries.js";
import { isRuntimeToolImplemented, RuntimeToolExecutor, type RuntimeToolCall } from "./runtime-tool-executor.js";
import { classifyRecoveryError, RecoveryCoordinator, type RecoveryDecision, type RecoveryIncident } from "./recovery-policy.js";
import { executeModeSpec } from "../patterns/driver-registry.js";
import type { ModelMessage, ModelResponse, ModelToolCall } from "../providers/index.js";

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
  resumeContext?: {
    clarifications?: Record<string, unknown>;
    approvedActionIds?: string[];
  };
  streamProvider?: boolean;
  onEvent?: (event: OraEventEnvelope) => void;
}

class ClarificationInterruptError extends Error {
  constructor(public readonly clarification: PendingClarification) {
    super(clarification.question);
  }
}

class ApprovalInterruptError extends Error {
  constructor(public readonly actionId: string) {
    super(`Manual approval required for action ${actionId}.`);
  }
}

const RUNTIME_TOOL_LOOP_LIMIT = 4;
const TOOL_REPAIR_CONTENT = "Tool call was interrupted before a result was produced. Continue from available context or choose another action.";

type RuntimeToolAttempt = RuntimeToolCall & {
  providerCallId?: string;
  source: OraToolCallSource;
};

function providerSupportsNativeTools(config: RunConfig): boolean {
  const capabilities = config.providerConfig?.capabilities ?? [];
  if (capabilities.includes("tool_use")) {
    return true;
  }
  return config.providerConfig === undefined
    && (config.providerId === "openai-gpt" || config.providerId === "anthropic-claude");
}

function providerToolCallToAttempt(call: ModelToolCall): RuntimeToolAttempt | undefined {
  if (!isRuntimeToolImplemented(call.toolId)) {
    return undefined;
  }
  return {
    tool: call.toolId,
    args: call.args,
    providerCallId: call.id,
    source: "provider_native",
  };
}

function checkpointLabelForStatus(status: StateSnapshot["status"]): string {
  switch (status) {
    case "succeeded":
      return "Pattern checkpoint";
    case "interrupted":
      return "Interrupted checkpoint";
    case "failed":
      return "Failed checkpoint";
    case "cancelled":
      return "Cancelled checkpoint";
    case "queued":
    case "running":
      return "Runtime checkpoint";
  }
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cacheKeyForRuntimeTool(call: RuntimeToolCall): string | undefined {
  if (call.tool !== "web.fetch") {
    return undefined;
  }
  const url = typeof call.args.url === "string" ? call.args.url.trim() : "";
  return url ? `${call.tool}:${url}` : undefined;
}

function workspaceSystemPrompt(workspace: unknown): string | undefined {
  if (!workspace || typeof workspace !== "object" || workspace === null) {
    return undefined;
  }

  const record = workspace as Record<string, unknown>;
  const rootPath = typeof record.rootPath === "string" ? record.rootPath : undefined;
  if (!rootPath) {
    return undefined;
  }

  const label = typeof record.label === "string" ? record.label : "Project";
  const totalFiles = typeof record.totalFiles === "number" ? record.totalFiles : undefined;
  const markdownFiles = typeof record.markdownFiles === "number" ? record.markdownFiles : undefined;
  const truncated = record.truncated === true;
  const extensionCounts = record.extensionCounts && typeof record.extensionCounts === "object" && record.extensionCounts !== null
    ? Object.entries(record.extensionCounts as Record<string, unknown>)
      .filter((entry): entry is [string, number] => typeof entry[1] === "number")
      .sort((left, right) => right[1] - left[1])
      .slice(0, 12)
      .map(([extension, count]) => `${extension}: ${count}`)
      .join(", ")
    : "";
  const samplePaths = Array.isArray(record.samplePaths)
    ? record.samplePaths
      .filter((item): item is string => typeof item === "string" && item.length > 0)
      .slice(0, 40)
    : [];

  return [
    "Ora project workspace context:",
    `- Project: ${label}`,
    `- Root path: ${rootPath}`,
    totalFiles === undefined ? undefined : `- Indexed files: ${totalFiles}${truncated ? " (truncated)" : ""}`,
    markdownFiles === undefined ? undefined : `- Markdown files: ${markdownFiles}${truncated ? " (count may be partial)" : ""}`,
    extensionCounts ? `- Extension counts: ${extensionCounts}` : undefined,
    samplePaths.length > 0 ? `- Sample paths:\n${samplePaths.map((item) => `  - ${item}`).join("\n")}` : undefined,
    "Use this workspace context when answering questions about the local project folder. If the question asks for information not present in the context, say the project index is available but file contents or commands still need a runtime tool.",
  ].filter(Boolean).join("\n");
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
  const runtimeToolExecutor = new RuntimeToolExecutor({
    workspace: input.context?.projectWorkspace,
    toolDescriptors: tools.tools,
    skillRegistry,
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
  const events: OraEventEnvelope[] = [];
  const artifacts: ArtifactRef[] = [];
  const toolCallLedger: OraToolCallEnvelope[] = [];
  const runtimeToolResultCache = new Map<string, unknown>();
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
    options.onEvent?.(envelope);
    return envelope;
  };

  const recoveryCoordinator = new RecoveryCoordinator(modeSpec, runtimeToolExecutor.enabledToolIds(config.toolIds));

  const publishRecoveryArtifact = (incident: RecoveryIncident, decision: RecoveryDecision) => {
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
    emit("artifact.degraded", { artifact, recovery: recoveryArtifact }, {
      nodeId: incident.nodeId,
      agentId: incident.agentId,
    });
    return recoveryArtifact;
  };

  const emitRecoveryDecision = (incident: RecoveryIncident, decision: RecoveryDecision) => {
    emit("recovery.detected", { incident }, { nodeId: incident.nodeId, agentId: incident.agentId });
    if (decision.action === "retry") {
      emit("recovery.retry_scheduled", { incident, decision }, { nodeId: incident.nodeId, agentId: incident.agentId });
    } else if (decision.action === "fail") {
      emit("recovery.exhausted", { incident, decision }, { nodeId: incident.nodeId, agentId: incident.agentId });
    } else {
      emit("recovery.applied", { incident, decision }, { nodeId: incident.nodeId, agentId: incident.agentId });
    }
  };

  const emitPlanUpdated = () => {
    emit("plan.updated", { items: planService.list() });
  };

  const emitTodoUpdated = () => {
    emit("todo.updated", { items: todoService.list() });
  };

  const appendToolCall = (params: {
    id?: string;
    providerCallId?: string;
    toolId: string;
    args: Record<string, unknown>;
    source: OraToolCallSource;
    status: OraToolCallStatus;
    actionId?: string;
    agentId?: string;
    nodeId?: string;
    result?: OraToolCallEnvelope["result"];
    error?: string;
    repairReason?: string;
  }) => {
    const updatedAt = now();
    const existingIndex = params.id
      ? toolCallLedger.findIndex((call) => call.id === params.id)
      : params.providerCallId
        ? toolCallLedger.findIndex((call) => call.providerCallId === params.providerCallId && call.source === params.source)
        : -1;
    const existing = existingIndex >= 0 ? toolCallLedger[existingIndex] : undefined;
    const envelope = OraToolCallEnvelopeSchema.parse({
      id: params.id ?? existing?.id ?? `${runId}:tool-call-${toolCallLedger.length}`,
      providerCallId: params.providerCallId ?? existing?.providerCallId,
      runId,
      nodeId: params.nodeId ?? existing?.nodeId,
      agentId: params.agentId ?? existing?.agentId,
      actionId: params.actionId ?? existing?.actionId,
      toolId: params.toolId,
      args: params.args,
      source: params.source,
      status: params.status,
      requestedAt: existing?.requestedAt ?? updatedAt,
      updatedAt,
      result: params.result ?? existing?.result,
      error: params.error ?? existing?.error,
      repairReason: params.repairReason ?? existing?.repairReason,
    });
    if (existingIndex >= 0) {
      toolCallLedger[existingIndex] = envelope;
    } else {
      toolCallLedger.push(envelope);
    }
    return envelope;
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
    todoService.setStatus(item.id, status);
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
    const memoryOverlay = typeof config.metadata.memoryPromptOverlay === "string"
      ? config.metadata.memoryPromptOverlay
      : undefined;
    return [
      extra,
      workspaceSystemPrompt(input.context?.projectWorkspace),
      memoryOverlay,
      runtimeToolExecutor.systemPrompt(config.toolIds),
      options.customAgentOverlay,
      ...snippets,
    ]
      .filter(Boolean)
      .join("\n\n");
  };

  const invokeProviderWithWorkspaceTools = async (params: {
    agentId: string;
    title: string;
    prompt: string;
    system: string;
  }): Promise<ModelResponse> => {
    const enabledTools = runtimeToolExecutor.enabledToolIds(config.toolIds);
    const nativeTools = providerSupportsNativeTools(config)
      ? runtimeToolExecutor.toolDefinitions(config.toolIds)
      : [];
    let messages: ModelMessage[] = [...(options.conversationMessages ?? [])];
    const invokeProvider = options.streamProvider ? invokeRunProviderStream : invokeRunProvider;
    const streamCallbacks = options.streamProvider
      ? {
          onTextDelta: (chunk: { delta: string; text: string; raw?: unknown }) => {
            emit("message.delta", {
              role: "assistant",
              content: chunk.text,
              delta: chunk.delta,
              streaming: true,
              raw: chunk.raw,
            }, { agentId: params.agentId, nodeId: params.agentId });
            emit("token.delta", {
              text: chunk.delta,
              tokenCount: Math.max(1, chunk.delta.split(/\s+/).filter(Boolean).length),
              budget: config.budget,
              streaming: true,
            }, { agentId: params.agentId, nodeId: params.agentId });
          },
        }
      : undefined;
    const repairDanglingToolCalls = (candidateMessages: ModelMessage[]) => {
      const pending = new Map<string, { call: ModelToolCall; messageIndex: number }>();
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
        emit("tool.repaired", {
          providerCallId: call.id,
          toolId: call.toolId,
          status: "repaired",
          resultStatus: "interrupted",
          repairReason: "missing_provider_tool_result",
          content: TOOL_REPAIR_CONTENT,
        }, { agentId: params.agentId, nodeId: params.agentId });
        repairedMessages.push({
          role: "tool",
          toolCallId: call.id,
          toolName: call.toolId,
          content: TOOL_REPAIR_CONTENT,
        });
      }
      return repairedMessages;
    };
    messages = repairDanglingToolCalls(messages);
    let response = await invokeProvider(config, {
      prompt: params.prompt,
      messages,
      system: params.system,
      maxTokens: config.budget?.maxTokens,
      tools: nativeTools,
      toolChoice: nativeTools.length > 0 ? "auto" : undefined,
    }, streamCallbacks);

    if (enabledTools.length === 0) {
      return response;
    }

    for (let iteration = 0; iteration < RUNTIME_TOOL_LOOP_LIMIT; iteration += 1) {
      const nativeToolCall = response.toolCalls?.map(providerToolCallToAttempt).find(Boolean);
      const fallbackToolCall = nativeToolCall
        ? undefined
        : runtimeToolExecutor.extractToolCall(response.text, config.toolIds);
      const toolCall: RuntimeToolAttempt | undefined = nativeToolCall
        ?? (fallbackToolCall ? { ...fallbackToolCall, source: "json_fallback" } : undefined);
      if (!toolCall) {
        return response;
      }

      const action = actionLedger.propose({
        id: `${params.agentId}-tool-${events.length}`,
        type: toolCall.tool,
        riskLevel: runtimeToolExecutor.riskLevel(toolCall),
        input: toolCall.args,
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
      emit("action.updated", { actionId: action.id, status: "proposed", record: action }, { agentId: params.agentId, nodeId: params.agentId });

      const decision = policyService.evaluate(action);
      const approvedActionIds = new Set(options.resumeContext?.approvedActionIds ?? []);
      if (decision.requiredApproval && config.approvalMode !== "auto") {
        if (!approvedActionIds.has(action.id)) {
          const blocked = actionLedger.transition(action.id, "approval_required");
          appendToolCall({ ...toolCallRecord, status: "approval_required" });
          emit("approval.required", { actionId: action.id, decision }, { agentId: params.agentId, nodeId: params.agentId });
          emit("action.updated", { actionId: action.id, status: "approval_required", record: blocked }, { agentId: params.agentId, nodeId: params.agentId });
          throw new ApprovalInterruptError(action.id);
        }
        emit("approval.resolved", {
          actionId: action.id,
          decision: "approved",
          mode: "resume",
        }, { agentId: params.agentId, nodeId: params.agentId });
        const approved = actionLedger.transition(action.id, "approved");
        appendToolCall({ ...toolCallRecord, status: "approved" });
        emit("action.updated", { actionId: action.id, status: "approved", record: approved }, { agentId: params.agentId, nodeId: params.agentId });
      }

      const running = actionLedger.transition(action.id, "running");
      appendToolCall({ ...toolCallRecord, status: "running" });
      emit("action.updated", { actionId: action.id, status: "running", record: running }, { agentId: params.agentId, nodeId: params.agentId });

      try {
        const cacheKey = cacheKeyForRuntimeTool(toolCall);
        const cacheHit = cacheKey !== undefined && runtimeToolResultCache.has(cacheKey);
        const output = cacheHit
          ? runtimeToolResultCache.get(cacheKey)
          : await runtimeToolExecutor.execute(toolCall, {
              allowRisky: !decision.requiredApproval || config.approvalMode === "auto" || approvedActionIds.has(action.id),
            });
        if (cacheKey && !cacheHit) {
          runtimeToolResultCache.set(cacheKey, output);
        }
        const succeeded = actionLedger.transition(action.id, "succeeded", { output });
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
        emit("tool.called", {
          toolCallId: toolCallRecord.id,
          providerCallId: toolCall.providerCallId,
          actionId: action.id,
          toolId: toolCall.tool,
          source: toolCall.source,
          status: "succeeded",
          input: toolCall.args,
          output,
          cacheHit,
        }, { agentId: params.agentId, nodeId: params.agentId });
        emit("action.updated", { actionId: action.id, status: "succeeded", record: succeeded }, { agentId: params.agentId, nodeId: params.agentId });

        messages = toolCall.source === "provider_native" && toolCall.providerCallId
          ? [
              ...messages,
              { role: "assistant", content: response.text, reasoningContent: response.reasoningContent, toolCalls: response.toolCalls },
              { role: "tool", toolCallId: toolCall.providerCallId, toolName: toolCall.tool, content: resultText },
            ]
          : [
              ...messages,
              { role: "assistant", content: response.text },
              { role: "user", content: `Workspace tool result for ${toolCall.tool}:\n${resultText}` },
            ];
        messages = repairDanglingToolCalls(messages);
        response = await invokeProvider(config, {
          messages,
          system: params.system,
          maxTokens: config.budget?.maxTokens,
          tools: nativeTools,
          toolChoice: nativeTools.length > 0 ? "auto" : undefined,
        }, streamCallbacks);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        const failed = actionLedger.transition(action.id, "failed", { error: detail });
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
        emit("tool.called", {
          toolCallId: toolCallRecord.id,
          providerCallId: toolCall.providerCallId,
          actionId: action.id,
          toolId: toolCall.tool,
          source: toolCall.source,
          status: "failed",
          input: toolCall.args,
          error: detail,
        }, { agentId: params.agentId, nodeId: params.agentId });
        emit("action.updated", { actionId: action.id, status: "failed", record: failed }, { agentId: params.agentId, nodeId: params.agentId });

        const incident = classifyRecoveryError(error, {
          surface: "tool",
          nodeId: params.agentId,
          agentId: params.agentId,
          toolId: toolCall.tool,
          actionId: action.id,
        });
        const recoveryDecision = recoveryCoordinator.resolve(incident);
        emitRecoveryDecision(incident, recoveryDecision);

        if (recoveryDecision.action === "retry") {
          await sleep(recoveryDecision.retryDelayMs ?? 0);
          continue;
        }

        if (recoveryDecision.action === "alternate_tool" && recoveryDecision.alternateToolId) {
          const alternateCall: RuntimeToolCall = {
            tool: recoveryDecision.alternateToolId as RuntimeToolCall["tool"],
            args: toolCall.args,
          };
          const alternateAction = actionLedger.propose({
            id: `${params.agentId}-tool-recovery-${events.length}`,
            type: alternateCall.tool,
            riskLevel: runtimeToolExecutor.riskLevel(alternateCall),
            input: alternateCall.args,
            agentId: params.agentId,
          });
          emit("action.updated", { actionId: alternateAction.id, status: "proposed", record: alternateAction }, { agentId: params.agentId, nodeId: params.agentId });
          const alternateDecision = policyService.evaluate(alternateAction);
          const approvedActionIds = new Set(options.resumeContext?.approvedActionIds ?? []);
          if (alternateDecision.requiredApproval && config.approvalMode !== "auto" && !approvedActionIds.has(alternateAction.id)) {
            const blocked = actionLedger.transition(alternateAction.id, "approval_required");
            emit("approval.required", { actionId: alternateAction.id, decision: alternateDecision }, { agentId: params.agentId, nodeId: params.agentId });
            emit("action.updated", { actionId: alternateAction.id, status: "approval_required", record: blocked }, { agentId: params.agentId, nodeId: params.agentId });
            throw new ApprovalInterruptError(alternateAction.id);
          }
          const alternateRunning = actionLedger.transition(alternateAction.id, "running");
          emit("action.updated", { actionId: alternateAction.id, status: "running", record: alternateRunning }, { agentId: params.agentId, nodeId: params.agentId });
          const alternateOutput = await runtimeToolExecutor.execute(alternateCall, {
            allowRisky: !alternateDecision.requiredApproval || config.approvalMode === "auto" || approvedActionIds.has(alternateAction.id),
          });
          const alternateSucceeded = actionLedger.transition(alternateAction.id, "succeeded", { output: alternateOutput });
          emit("tool.called", {
            actionId: alternateAction.id,
            toolId: alternateCall.tool,
            status: "succeeded",
            input: alternateCall.args,
            output: alternateOutput,
            recoveredFrom: toolCall.tool,
          }, { agentId: params.agentId, nodeId: params.agentId });
          emit("action.updated", { actionId: alternateAction.id, status: "succeeded", record: alternateSucceeded }, { agentId: params.agentId, nodeId: params.agentId });
          messages = [
            ...messages,
            { role: "assistant", content: response.text },
            { role: "user", content: `Workspace tool result for ${alternateCall.tool}:\n${JSON.stringify(alternateOutput, null, 2)}` },
          ];
          response = await invokeProvider(config, {
            messages,
            system: params.system,
            maxTokens: config.budget?.maxTokens,
            tools: nativeTools,
            toolChoice: nativeTools.length > 0 ? "auto" : undefined,
          }, streamCallbacks);
          continue;
        }

        if (recoveryDecision.action === "fallback_artifact") {
          const recoveryArtifact = publishRecoveryArtifact(incident, recoveryDecision);
          const fallbackPrefix = modeSpec.runtimeAtoms.includes("tool_error_boundary") ? "[tool-error-boundary]" : "[recovery:fallback]";
          emit("message.delta", {
            role: "assistant",
            content: `${fallbackPrefix} ${toolCall.tool} degraded after ${incident.errorType}: ${incident.detail}`,
            boundary: modeSpec.runtimeAtoms.includes("recovery_policy") ? "recovery_policy" : "tool_error_boundary",
          }, { agentId: params.agentId, nodeId: params.agentId });
          const fallbackOutput = recoveryDecision.usableOutput ?? {
            degraded: true,
            recoveryArtifactId: recoveryArtifact.id,
            errorType: incident.errorType,
            error: incident.detail,
          };
          messages = [
            ...messages,
            { role: "assistant", content: response.text },
            { role: "user", content: `Workspace tool degraded for ${toolCall.tool}:\n${JSON.stringify(fallbackOutput, null, 2)}` },
          ];
          response = await invokeProvider(config, {
            messages,
            system: params.system,
            maxTokens: config.budget?.maxTokens,
            tools: nativeTools,
            toolChoice: nativeTools.length > 0 ? "auto" : undefined,
          }, streamCallbacks);
          continue;
        }

        throw error;
      }
    }

    return {
      ...response,
      text: `${response.text}\n\n[Ora stopped after ${RUNTIME_TOOL_LOOP_LIMIT} runtime tool calls.]`,
    };
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
    const requiresManualGate = config.approvalMode === "manual"
      && actionLedger.list().every((record) => record.id === action.id || record.status === "proposed");
    const effectiveDecision = requiresManualGate && !decision.requiredApproval
      ? {
          ...decision,
          requiredApproval: true,
          reason: "Manual approval mode pauses the run before the first action executes.",
        }
      : decision;
    if (effectiveDecision.requiredApproval && config.approvalMode === "manual") {
      const approvedActionIds = new Set(options.resumeContext?.approvedActionIds ?? []);
      if (approvedActionIds.has(action.id)) {
        emit("approval.resolved", {
          actionId: action.id,
          decision: "approved",
          mode: "resume",
        }, { agentId: params.agentId, nodeId: params.agentId });
        const approved = actionLedger.transition(action.id, "approved");
        emit("action.updated", { actionId: action.id, status: "approved", record: approved }, { agentId: params.agentId, nodeId: params.agentId });
      } else {
        const blocked = actionLedger.transition(action.id, "approval_required");
        emit("approval.required", { actionId: action.id, decision: effectiveDecision }, { agentId: params.agentId, nodeId: params.agentId });
        emit("action.updated", { actionId: action.id, status: "approval_required", record: blocked }, { agentId: params.agentId, nodeId: params.agentId });
        throw new ApprovalInterruptError(action.id);
      }
    }

    const running = actionLedger.transition(action.id, "running");
    emit("action.updated", { actionId: action.id, status: "running", record: running }, { agentId: params.agentId, nodeId: params.agentId });
    while (true) {
      try {
        const response = await invokeProviderWithWorkspaceTools({
          agentId: params.agentId,
          title: params.title,
          prompt: params.prompt,
          system: params.system,
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
        if (error instanceof ApprovalInterruptError || error instanceof ClarificationInterruptError) {
          activeAgents.delete(params.agentId);
          setTopologyStatus(params.agentId, "blocked");
          throw error;
        }

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

        const incident = classifyRecoveryError(error, {
          surface: "provider",
          nodeId: params.agentId,
          agentId: params.agentId,
          actionId: action.id,
        });
        const recoveryDecision = recoveryCoordinator.resolve(incident);
        emitRecoveryDecision(incident, recoveryDecision);

        if (recoveryDecision.action === "retry") {
          await sleep(recoveryDecision.retryDelayMs ?? 0);
          const retrying = actionLedger.transition(action.id, "running");
          emit("action.updated", { actionId: action.id, status: "running", record: retrying }, { agentId: params.agentId, nodeId: params.agentId });
          continue;
        }

        if (recoveryDecision.action !== "fallback_artifact") {
          activeAgents.delete(params.agentId);
          setTopologyStatus(params.agentId, "failed");
          throw error;
        }

        const recoveryArtifact = publishRecoveryArtifact(incident, recoveryDecision);
        const fallbackPrefix = modeSpec.runtimeAtoms.includes("tool_error_boundary") ? "[tool-error-boundary]" : "[recovery:fallback]";
        const fallback = `${fallbackPrefix} ${params.title} degraded after ${incident.errorType}: ${detail}`;
        const degraded = actionLedger.transition(action.id, "failed", {
          output: { recoveryArtifactId: recoveryArtifact.id, text: fallback },
          artifactIds: [recoveryArtifact.id],
        });
        emit("action.updated", { actionId: action.id, status: "failed", record: degraded }, { agentId: params.agentId, nodeId: params.agentId });
        emit("message.delta", {
          role: "assistant",
          content: fallback,
          boundary: modeSpec.runtimeAtoms.includes("recovery_policy") ? "recovery_policy" : "tool_error_boundary",
        }, { agentId: params.agentId, nodeId: params.agentId });
        emit("agent.completed", { title: params.title, degraded: true }, { agentId: params.agentId, nodeId: params.agentId });
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

  const ensureClarification = (params: {
    id: string;
    key: string;
    nodeId: string;
    nodeLabel: string;
    question: string;
  }) => {
    const answered = clarificationAnswer(params.key, params.id);
    if (answered !== undefined) {
      const resumeClarifications = options.resumeContext?.clarifications;
      if (resumeClarifications && (params.id in resumeClarifications || params.key in resumeClarifications)) {
        emit("clarification.resolved", {
          clarificationId: params.id,
          nodeId: params.nodeId,
          answer: answered,
          mode: "resume",
        }, { nodeId: params.nodeId });
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
    emit("clarification.required", {
      clarification,
      pending: pendingClarifications.length,
    }, { nodeId: params.nodeId });
    throw new ClarificationInterruptError(clarification);
  };

  const runRecoverableNode = async <T>(params: {
    nodeId: string;
    nodeTemplate: string;
    nodeLabel: string;
    agentId?: string;
  }, execute: () => Promise<T>): Promise<{ status: "completed"; output: T } | { status: "skipped"; output?: unknown }> => {
    while (true) {
      try {
        const output = await execute();
        return { status: "completed", output };
      } catch (error) {
        if (error instanceof ApprovalInterruptError || error instanceof ClarificationInterruptError) {
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
          emit("node.skipped", {
            nodeId: params.nodeId,
            nodeLabel: params.nodeLabel,
            decision: recoveryDecision,
            error: incident.detail,
          }, { nodeId: params.nodeId, agentId: params.agentId });
          return { status: "skipped", output: recoveryDecision.usableOutput };
        }

        if (recoveryDecision.action === "fallback_artifact") {
          const recoveryArtifact = publishRecoveryArtifact(incident, recoveryDecision);
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
  emitTodoUpdated();

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
        writeSharedState,
        currentSharedState: () => sharedStateSummary,
      },
      prompt: input.prompt,
      config,
      modeSpec,
      definition,
    });
    output = result.output;
    emit("run.done", { status: "succeeded", output });
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
    status = caught instanceof ClarificationInterruptError || caught instanceof ApprovalInterruptError
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
        completed: planService.list().filter((item) => item.status === "done" || item.status === "skipped").length,
      };
      emitPlanUpdated();
      emitTodoUpdated();
      emit("queue.updated", { summary: queueSummary, busStats });
    }
    emit(status === "interrupted" ? "run.interrupted" : "run.failed", {
      error,
      status,
      reason: caught instanceof ClarificationInterruptError
        ? "clarification_required"
        : caught instanceof ApprovalInterruptError
          ? "approval_required"
          : undefined,
      clarificationId: caught instanceof ClarificationInterruptError ? caught.clarification.id : undefined,
      actionId: caught instanceof ApprovalInterruptError ? caught.actionId : undefined,
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
    todos: todoService.list(),
    actions: actionLedger.list(),
    toolCalls: toolCallLedger,
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
