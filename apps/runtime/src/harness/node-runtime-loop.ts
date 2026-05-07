import type {
  ArtifactRef,
  CompletionStopReason,
  ModeSpec,
  OraEventEnvelope,
  OraToolCallEnvelope,
  PlanListStep,
  PendingClarificationOption,
  RunConfig,
} from "@cemeworm/shared";
import { invokeRunProvider, invokeRunProviderStream } from "../providers/index.js";
import type { ModelMessage, ModelRequest, ModelResponse } from "../providers/index.js";
import type {
  RecoveryCoordinator,
  RecoveryDecision,
  RecoveryIncident,
} from "./recovery-policy.js";
import { RUNTIME_TOOL_LOOP_SAFETY_LIMIT, type RuntimeCompletionController } from "./runtime-completion.js";
import { evaluateRuntimeCompletionGuards } from "./runtime-completion-guards.js";
import { forcedFinalSystemPrompt } from "./runtime-output.js";
import type { RuntimeActionDeps } from "./runtime-action-runner.js";
import {
  providerSupportsNativeTools,
  cacheKeyForRuntimeTool,
  invalidatesRuntimeToolCache,
  nativeRuntimeToolAttempts,
  selectRuntimeToolAttempt,
} from "./runtime-tool-loop.js";
import { RuntimeToolExecutor, type RuntimeFileChangeMetadata, type RuntimeToolCall } from "./runtime-tool-executor.js";
import type { AppendRuntimeToolCallParams } from "./runtime-tool-ledger.js";
import {
  buildRuntimeMiddlewares,
  invokeRuntimeModelCall,
  invokeRuntimeModelResponse,
  invokeRuntimeToolExecution,
  invokeRuntimeToolFailure,
  type RuntimeModelResponseContext,
  type RuntimeMiddlewareContext,
  type RuntimeToolExecutionContext,
  type RuntimeToolFailureContext,
  type RuntimeToolFailureRequest,
} from "./runtime-middleware.js";
import {
  NodeLoopController,
} from "./node-loop-transitions.js";
import { registerRuntimeToolAttempt } from "./runtime-tool-attempt.js";
import { codeDevelopmentToolBoundaryError } from "./runtime-tool-boundary.js";
import { RuntimeToolCallService } from "./runtime-tool-call-service.js";
import { RuntimeToolRecoveryService } from "./runtime-tool-recovery-service.js";

export type NodeRuntimeLoopState =
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

type RuntimeLoopEmit = (
  type: OraEventEnvelope["type"],
  payload: unknown,
  extra?: Partial<OraEventEnvelope>,
) => OraEventEnvelope;

export interface RunNodeRuntimeLoopParams {
  agentId: string;
  nodeId: string;
  title: string;
  prompt: string;
  system: string;
  toolIds: string[];
}

export interface RunNodeRuntimeLoopDeps {
  config: RunConfig;
  modeSpec: ModeSpec;
  conversationMessages?: ModelMessage[];
  streamProvider?: boolean;
  signal?: AbortSignal;
  inputPrompt: string;
  now: () => number;
  eventsLength: () => number;
  planList: () => readonly PlanListStep[];
  activePlanStepId: () => string | undefined;
  autoAdvancePlanListFromLifecycle: (params: {
    agentId: string;
    nodeId: string;
    title: string;
    evidenceToolCallIds: string[];
    planStepId?: string;
  }) => boolean;
  toolCalls: () => readonly OraToolCallEnvelope[];
  runtimeToolExecutor: RuntimeToolExecutor;
  completion: RuntimeCompletionController;
  runtimeToolResultCache: Map<string, unknown>;
  recoveryCoordinator: RecoveryCoordinator;
  appendToolCall: (params: AppendRuntimeToolCallParams) => OraToolCallEnvelope;
  emit: RuntimeLoopEmit;
  emitNodeRuntimeState: (
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
  ) => void;
  emitProgressNarration: (params: {
    trigger: string;
    agentId?: string;
    nodeId?: string;
    title?: string;
    detail?: string;
  }) => Promise<void>;
  emitRecoveryDecision: (
    incident: RecoveryIncident,
    decision: RecoveryDecision,
  ) => void;
  emitRejectedFinalToolIntent: (
    call: RuntimeToolCall,
    reason: CompletionStopReason,
  ) => void;
  clarificationAnswer: (key: string, id: string) => unknown;
  ensureClarification: (params: {
    id: string;
    key: string;
    nodeId: string;
    nodeLabel: string;
    question: string;
    options?: PendingClarificationOption[];
  }) => Promise<unknown>;
  ensureClarifications: (requests: Array<{
    id: string;
    key: string;
    nodeId: string;
    nodeLabel: string;
    question: string;
    options?: PendingClarificationOption[];
  }>) => Promise<unknown[]>;
  coerceNoToolResponse: (
    response: ModelResponse,
    reason: CompletionStopReason,
    options?: { emitRejectedToolIntent?: boolean },
  ) => ModelResponse;
  runForcedFinalProviderCall: (params: {
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
    emitNodeRuntimeState?: RunNodeRuntimeLoopDeps["emitNodeRuntimeState"];
  }) => Promise<ModelResponse>;
  publishRecoveryArtifact: (
    incident: RecoveryIncident,
    decision: RecoveryDecision,
  ) => { id: string };
  publishFileChangeArtifact: (
    fileChange: RuntimeFileChangeMetadata,
    context: { agentId?: string; nodeId?: string; actionId?: string },
  ) => ArtifactRef;
  sleep: (ms: number) => Promise<void>;
  actionDeps: () => RuntimeActionDeps;
}

export function isInternalProviderAssistantText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }
  if (/<\/?tool_plan_mode_reminder\b|<\/?file_grep_policy\b/i.test(trimmed)) {
    return true;
  }
  if (/<[^>]*DSML[^>]*tool_calls|<tool_call\b|parameter\s+name=/i.test(trimmed)) {
    return true;
  }
  return /^\{"tool"\s*:\s*"[a-z0-9_.-]+"\s*,\s*"args"\s*:/i.test(trimmed);
}

function emitRuntimeStatusProgress(
  emit: RuntimeLoopEmit,
  params: RunNodeRuntimeLoopParams,
  trigger: string,
  summary: string,
  basedOnSeq: number,
): void {
  emit(
    "task.progress",
    {
      kind: "chat_progress",
      source: "runtime_status",
      trigger,
      title: params.title,
      summary,
      basedOnSeq,
    },
    { agentId: params.agentId, nodeId: params.nodeId },
  );
}

export async function runNodeRuntimeLoop(
  params: RunNodeRuntimeLoopParams,
  deps: RunNodeRuntimeLoopDeps,
): Promise<ModelResponse> {
  const {
    config,
    modeSpec,
    runtimeToolExecutor,
    completion,
    runtimeToolResultCache,
    recoveryCoordinator,
    appendToolCall,
    now,
    emit,
    emitNodeRuntimeState: emitNodeRuntimeStateEvent,
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
  } = deps;
  const options = {
    conversationMessages: deps.conversationMessages,
    streamProvider: deps.streamProvider,
  };
  const input = { prompt: deps.inputPrompt };
  const events = {
    get length(): number {
      return deps.eventsLength();
    },
  };
  const { actionLedger } = actionDeps();
  const nodeLoopController = new NodeLoopController({
    emit: emitNodeRuntimeStateEvent,
    onInvalidTransition: "throw",
    onInvalidTransitionRecorded: (transition, transitionParams) => {
      emit(
        "task.progress",
        {
          kind: "runtime_diagnostic",
          source: "node_loop_transition",
          severity: "warning",
          from: transition.from,
          to: transition.to,
          title: transitionParams.title ?? params.title,
          actionId: transitionParams.actionId,
          toolId: transitionParams.toolId,
          iteration: transitionParams.iteration,
        },
        { agentId: params.agentId, nodeId: params.nodeId },
      );
    },
  });
  const emitNodeRuntimeState = nodeLoopController.emit;
  const completionScope = { agentId: params.agentId, nodeId: params.nodeId };
  const enabledTools = runtimeToolExecutor.enabledToolIds(params.toolIds);
  const nativeTools = providerSupportsNativeTools(config)
    ? runtimeToolExecutor.toolDefinitions(params.toolIds)
    : [];
  let messages: ModelMessage[] = [...(options.conversationMessages ?? [])];
  const invokeProvider = options.streamProvider
    ? invokeRunProviderStream
    : invokeRunProvider;
  let lastProviderRequestMessages: ModelMessage[] = [];
  const streamCallbacks = options.streamProvider
    ? {
        onTextDelta: (chunk: {
          delta: string;
          text: string;
          raw?: unknown;
        }) => {
          const visibility = isInternalProviderAssistantText(chunk.text)
            ? "internal"
            : undefined;
          emit(
            "message.delta",
            {
              role: "assistant",
              content: chunk.delta,
              delta: chunk.delta,
              streaming: true,
              ...(visibility ? { visibility } : {}),
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
        onStreamEvent: (event: {
          kind: string;
          streamMode: string;
          raw?: unknown;
        }) => {
          emit(
            "node.updated",
            {
              state: event.kind,
              title: params.title,
              streamMode: event.streamMode,
              providerStream: true,
              raw: event.raw,
            },
            { agentId: params.agentId, nodeId: params.agentId },
          );
        },
      }
    : undefined;
  const runtimeMiddlewares = buildRuntimeMiddlewares();
  const middlewareContext: RuntimeMiddlewareContext = {
    config,
    agentId: params.agentId,
    nodeId: params.agentId,
    modelNodeId: params.nodeId,
    title: params.title,
    now,
    appendToolCall,
    emit,
    replaceMessages: (nextMessages) => {
      messages = [...nextMessages];
    },
  };
  const withAbortSignal = (request: ModelRequest): ModelRequest => ({
    ...request,
    signal: request.signal ?? deps.signal,
  });

  const invokeModel = (request: ModelRequest) =>
    invokeRuntimeModelCall({
      request: withAbortSignal(withStablePrefixCacheMetadata(request)),
      context: middlewareContext,
      middlewares: runtimeMiddlewares,
      terminal: async (nextRequest) => {
        const response = await invokeProvider(config, nextRequest, streamCallbacks);
        lastProviderRequestMessages = [...(nextRequest.messages ?? [])];
        return response;
      },
    });
  const invokeFollowUpModel = (
    request: ModelRequest,
    latestResponse: ModelResponse,
    reason: string,
  ) =>
    invokeRuntimeModelCall({
      request: withAbortSignal(withFollowUpCacheMetadata(request, latestResponse, lastProviderRequestMessages)),
      context: middlewareContext,
      middlewares: runtimeMiddlewares,
      terminal: async (nextRequest) => {
        const response = await invokeProvider(config, nextRequest, streamCallbacks);
        lastProviderRequestMessages = [...(nextRequest.messages ?? [])];
        return response;
      },
      metadata: {
        compaction: { latestResponse, reason },
      },
    });
  const emitForcedFinalProviderState: RunNodeRuntimeLoopDeps["emitNodeRuntimeState"] = (state, emitParams) => {
    if (state === "completed" || state === "failed") {
      nodeLoopController.emitForcedFinalProviderState(state, emitParams);
      return;
    }
    nodeLoopController.emit(state, emitParams);
  };
  const toolExecutionContext: RuntimeToolExecutionContext = {
    ...middlewareContext,
    actionDeps,
    emitNodeRuntimeState: emitForcedFinalProviderState,
    emitToolRequested: nodeLoopController.emitToolRequested,
    emitToolRunning: nodeLoopController.emitToolRunning,
    emitToolResultObserved: nodeLoopController.emitToolResultObserved,
    emitModelRequest: nodeLoopController.emitModelRequest,
    emitForcedFinal: nodeLoopController.emitForcedFinal,
    emitGateRequired: nodeLoopController.emitGateRequired,
    eventsLength: () => events.length,
    clarificationAnswer,
    ensureClarification,
  };
  const invokeToolExecution = (request: Parameters<typeof invokeRuntimeToolExecution>[0]["request"]) =>
    invokeRuntimeToolExecution({
      request,
      context: toolExecutionContext,
      middlewares: runtimeMiddlewares,
      terminal: async ({ toolCall, allowRisky }) => {
        const invalidatesCache = invalidatesRuntimeToolCache(toolCall);
        const cacheKey = invalidatesCache ? undefined : cacheKeyForRuntimeTool(toolCall);
        const cacheHit =
          cacheKey !== undefined && runtimeToolResultCache.has(cacheKey);
        const execution = cacheHit
          ? { output: runtimeToolResultCache.get(cacheKey) }
          : await runtimeToolExecutor.executeWithMetadata(toolCall, {
              allowRisky,
            });
        if (cacheKey && !cacheHit) {
          runtimeToolResultCache.set(cacheKey, execution.output);
        }
        if (invalidatesCache) {
          runtimeToolResultCache.clear();
        }
        const artifact = execution.fileChange
          ? publishFileChangeArtifact(execution.fileChange, {
              actionId: request.action.id,
              agentId: params.agentId,
              nodeId: params.agentId,
            })
          : undefined;
        return {
          output: execution.output,
          fileChange: execution.fileChange,
          artifact,
          cacheKey,
          cacheHit,
        };
      },
    });
  const toolRecoveryService = new RuntimeToolRecoveryService({
    agentId: params.agentId,
    nodeId: params.nodeId,
    title: params.title,
    inputPrompt: input.prompt,
    system: params.system,
    config,
    modeSpec,
    nativeTools,
    streamCallbacks,
    invokeProvider,
    completion,
    completionScope,
    recoveryCoordinator,
    nodeLoopController,
    runtimeToolExecutor,
    actionDeps,
    actionLedger,
    now,
    eventsLength: () => events.length,
    getMessages: () => messages,
    replaceMessages: (nextMessages) => {
      messages = [...nextMessages];
    },
    emit,
    emitProgressNarration,
    emitRecoveryDecision,
    runForcedFinalProviderCall,
    emitForcedFinalProviderState,
    invokeFollowUpModel,
    publishRecoveryArtifact,
    publishFileChangeArtifact,
    sleep,
  });
  const recoverToolFailure = (failure: RuntimeToolFailureRequest) =>
    toolRecoveryService.recoverToolFailure(failure);
  const toolFailureContext: RuntimeToolFailureContext = {
    ...toolExecutionContext,
    recoverToolFailure,
  };
  const invokeToolFailure = (request: RuntimeToolFailureRequest) =>
    invokeRuntimeToolFailure({
      request,
      context: toolFailureContext,
      middlewares: runtimeMiddlewares,
      terminal: async ({ error }) => ({ kind: "throw", error }),
    });
  const toolCallService = new RuntimeToolCallService({
    agentId: params.agentId,
    nodeId: params.nodeId,
    title: params.title,
    inputPrompt: input.prompt,
    system: params.system,
    config,
    nativeTools,
    streamCallbacks,
    invokeProvider,
    completion,
    completionScope,
    nodeLoopController,
    runtimeToolExecutor,
    actionDeps,
    actionLedger,
    activePlanStepId: deps.activePlanStepId,
    now,
    eventsLength: () => events.length,
    appendToolCall,
    getMessages: () => messages,
    replaceMessages: (nextMessages) => {
      messages = [...nextMessages];
    },
    emit,
    emitProgressNarration,
    runForcedFinalProviderCall,
    emitForcedFinalProviderState,
    invokeFollowUpModel,
    invokeToolExecution,
    invokeToolFailure,
  });
  const modelResponseContext: RuntimeModelResponseContext = {
    ...toolExecutionContext,
    system: params.system,
    ensureClarifications,
    emitProgressNarration,
    completion,
    runForcedFinalProviderCall: ({ messages: nextMessages, reason, nativeTools: nextNativeTools }) =>
      runForcedFinalProviderCall({
        invokeProvider,
        config,
        messages: [...nextMessages],
        system: params.system,
        nativeTools: [...nextNativeTools],
        streamCallbacks,
        reason,
        agentId: params.agentId,
        nodeId: params.nodeId,
        title: params.title,
        emitNodeRuntimeState: emitForcedFinalProviderState,
      }),
    invokeFollowUpModel,
  };
  const invokeModelResponse = (request: Parameters<typeof invokeRuntimeModelResponse>[0]["request"]) =>
    invokeRuntimeModelResponse({
      request,
      context: modelResponseContext,
      middlewares: runtimeMiddlewares,
      terminal: async () => ({ kind: "unhandled" }),
    });
  const guardCycleCounts = new Map<string, number>();
  let lastAutoAdvanceEvidenceKey = "";
  const continueOrCompleteNaturally = async (
    currentResponse: ModelResponse,
    iteration: number,
  ): Promise<{ kind: "continue"; response: ModelResponse } | { kind: "complete"; response: ModelResponse }> => {
    const evidenceToolCallIds = lifecycleEvidenceToolCallIds(deps.toolCalls(), params);
    const evidencePlanStepId = lifecycleEvidencePlanStepId(deps.toolCalls(), evidenceToolCallIds);
    const evidenceKey = evidenceToolCallIds.join("|");
    if (evidenceKey && evidenceKey !== lastAutoAdvanceEvidenceKey) {
      const advanced = deps.autoAdvancePlanListFromLifecycle({
        agentId: params.agentId,
        nodeId: params.nodeId,
        title: params.title,
        evidenceToolCallIds,
        planStepId: evidencePlanStepId,
      });
      if (advanced) {
        lastAutoAdvanceEvidenceKey = evidenceKey;
      }
    }

    const guardResult = evaluateRuntimeCompletionGuards({
      actions: actionLedger.list(),
      planList: deps.planList(),
      toolCalls: deps.toolCalls(),
    });
    if (guardResult.allowComplete) {
      nodeLoopController.emitTransitionResult("complete", "completed", {
        agentId: params.agentId,
        title: params.title,
        iteration,
      });
      return { kind: "complete", response: currentResponse };
    }

    const guardFingerprint = `${guardResult.reason}:${guardResult.detail}`;
    const guardCycleCount = (guardCycleCounts.get(guardFingerprint) ?? 0) + 1;
    guardCycleCounts.set(guardFingerprint, guardCycleCount);
    if (guardCycleCount > 3) {
      throw new Error([
        "Runtime completion guard repeated without progress.",
        `reason: ${guardResult.reason}`,
        guardResult.detail,
      ].join("\n"));
    }

    emitRuntimeStatusProgress(
      emit,
      params,
      guardResult.progressTrigger,
      guardResult.progressSummary,
      Math.max(0, events.length - 1),
    );
    nodeLoopController.emitTransitionResult("model_request", "running_model", {
      agentId: params.agentId,
      title: params.title,
      reason: guardResult.reason,
      detail: guardResult.detail,
      iteration: iteration + 1,
    });
    messages = [
      ...messages,
      { role: "assistant", content: currentResponse.text },
      { role: "user", content: guardResult.followUpContent },
    ];
    return {
      kind: "continue",
      response: await invokeFollowUpModel({
        messages,
        system: params.system,
        maxTokens: config.budget?.maxTokens,
        tools: nativeTools,
        toolChoice: nativeTools.length > 0 ? "auto" : undefined,
      }, currentResponse, guardResult.followUpReason),
    };
  };

  nodeLoopController.emitPending({
    agentId: params.agentId,
    title: params.title,
  });
  const initialToolsAllowed = completion.toolsAllowed(completionScope);
  if (!initialToolsAllowed && completion.toolAttempts >= completion.maxToolCalls) {
    completion.forceFinalAnswer("tool_budget_exhausted");
  }
  if (initialToolsAllowed) {
    nodeLoopController.emitTransitionResult("model_request", "running_model", {
      agentId: params.agentId,
      title: params.title,
    });
  } else {
    nodeLoopController.emitForcedFinal({
      agentId: params.agentId,
      title: params.title,
    });
  }
  const initialRequest: ModelRequest = {
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
  };
  let response: ModelResponse;
  try {
    response = await invokeModel(initialRequest);
  } catch (error) {
    if (!initialToolsAllowed) {
      nodeLoopController.emitTransitionResult("fail", "failed", {
        agentId: params.agentId,
        title: params.title,
        reason: completion.stopReasonForScope(completionScope) ?? "tool_budget_exhausted",
        detail: error instanceof Error ? error.message : String(error),
      });
    }
    throw error;
  }
  if (!initialToolsAllowed) {
    const finalResponse = coerceNoToolResponse(
      response,
      completion.stopReasonForScope(completionScope) ?? "tool_budget_exhausted",
    );
    nodeLoopController.emitTransitionResult("complete", "completed", {
      agentId: params.agentId,
      title: params.title,
    });
    return finalResponse;
  }

  if (enabledTools.length === 0) {
    const completionResult = await continueOrCompleteNaturally(response, 0);
    if (completionResult.kind === "complete") {
      return completionResult.response;
    }
    response = completionResult.response;
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
        emitNodeRuntimeState: emitForcedFinalProviderState,
      });
    }

    const toolCall = selectRuntimeToolAttempt({
      response,
      toolIds: params.toolIds,
      extractFallbackToolCall: (text, toolIds) => runtimeToolExecutor.extractToolCall(text, toolIds),
    });
    if (!toolCall) {
      const completionResult = await continueOrCompleteNaturally(response, iteration);
      if (completionResult.kind === "continue") {
        response = completionResult.response;
        continue;
      }
      return completionResult.response;
    }

    const allNativeToolCalls = nativeRuntimeToolAttempts(response);

    const responseResult = await invokeModelResponse({
      response,
      iteration,
      messages,
      selectedToolCall: toolCall,
      allNativeToolCalls,
      nativeTools,
    });
    if (responseResult.kind === "handled_return") {
      return responseResult.response;
    }
    if (responseResult.kind === "handled_continue") {
      response = responseResult.response;
      continue;
    }

    const toolRequestedParams = {
      agentId: params.agentId,
      title: params.title,
      toolId: toolCall.tool,
      iteration,
    };
    nodeLoopController.emitToolRequested(toolRequestedParams);

    const attemptDecision = registerRuntimeToolAttempt({
      completion,
      toolCall,
      scope: completionScope,
    });
    if (!attemptDecision.allowed) {
      nodeLoopController.emitTransitionResult("boundary_failure", "finalizing", {
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
        emitNodeRuntimeState: emitForcedFinalProviderState,
      });
    }

    const boundaryError = codeDevelopmentToolBoundaryError({
      modeSpec,
      agentId: params.agentId,
      toolCall,
      runtimeToolExecutor,
    });
    if (boundaryError) {
      nodeLoopController.emitTransitionResult("boundary_failure", "failed", {
        agentId: params.agentId,
        title: params.title,
        toolId: toolCall.tool,
        detail: boundaryError,
        iteration,
      });
      throw new Error(boundaryError);
    }

    const toolTurnResult = await toolCallService.runToolTurn({
      toolCall,
      response,
      iteration,
    });
    if (toolTurnResult.kind === "retry") {
      continue;
    }
    if (toolTurnResult.kind === "return") {
      return toolTurnResult.response;
    }
    if (toolTurnResult.kind === "continue") {
      response = toolTurnResult.response;
      continue;
    }
    throw toolTurnResult.error;
  }

  completion.forceFinalAnswer("runtime_tool_loop_limit");
  nodeLoopController.emitForcedFinal({
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
    emitNodeRuntimeState: emitForcedFinalProviderState,
  });
}

function lifecycleEvidenceToolCallIds(
  toolCalls: readonly OraToolCallEnvelope[],
  params: Pick<RunNodeRuntimeLoopParams, "agentId" | "nodeId">,
): string[] {
  return toolCalls
    .filter((call) =>
      call.status === "succeeded" &&
      call.toolId !== "plan.update" &&
      (!call.agentId || call.agentId === params.agentId) &&
      (!call.nodeId || call.nodeId === params.nodeId || call.nodeId === params.agentId)
    )
    .map((call) => call.id)
    .sort();
}

function lifecycleEvidencePlanStepId(
  toolCalls: readonly OraToolCallEnvelope[],
  evidenceToolCallIds: readonly string[],
): string | undefined {
  const ids = new Set(evidenceToolCallIds);
  const planStepIds = [...new Set(toolCalls
    .filter((call) => ids.has(call.id) && call.planStepId)
    .map((call) => call.planStepId!)
  )];
  return planStepIds.length === 1 ? planStepIds[0] : undefined;
}

function withStablePrefixCacheMetadata(request: ModelRequest): ModelRequest {
  if (!request.messages?.length) {
    return request;
  }
  return {
    ...request,
    providerCache: {
      ...request.providerCache,
      stablePrefixMessageCount: request.providerCache?.stablePrefixMessageCount ?? request.messages.length,
    },
  };
}

function withFollowUpCacheMetadata(
  request: ModelRequest,
  latestResponse: ModelResponse,
  previousMessages: readonly ModelMessage[],
): ModelRequest {
  const stableRequest = withStablePrefixCacheMetadata(request);
  const previousResponseId = (latestResponse.providerResponseId ?? rawProviderResponseId(latestResponse.raw))?.trim();
  if (!previousResponseId || !request.messages?.length || previousMessages.length === 0) {
    return stableRequest;
  }
  if (!messagesHaveStablePrefix(previousMessages, request.messages)) {
    return stableRequest;
  }
  const deltaMessages = request.messages.slice(previousMessages.length);
  if (deltaMessages.length === 0) {
    return stableRequest;
  }
  return {
    ...stableRequest,
    providerCache: {
      ...stableRequest.providerCache,
      openaiPreviousResponseId: previousResponseId,
      openaiDeltaMessages: deltaMessages,
    },
  };
}

function rawProviderResponseId(raw: unknown): string | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const id = (raw as Record<string, unknown>).id;
  return typeof id === "string" ? id : undefined;
}

function messagesHaveStablePrefix(
  previousMessages: readonly ModelMessage[],
  nextMessages: readonly ModelMessage[],
): boolean {
  if (nextMessages.length < previousMessages.length) {
    return false;
  }
  for (let index = 0; index < previousMessages.length; index += 1) {
    if (JSON.stringify(previousMessages[index]) !== JSON.stringify(nextMessages[index])) {
      return false;
    }
  }
  return true;
}
