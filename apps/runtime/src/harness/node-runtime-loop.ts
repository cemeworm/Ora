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
import type { ModelStreamEvent } from "../providers/types.js";
import {
  classifyRecoveryError,
  RecoveryExhaustedError,
  type RecoveryCoordinator,
  type RecoveryDecision,
  type RecoveryIncident,
} from "./recovery-policy.js";
import { RUNTIME_TOOL_LOOP_SAFETY_LIMIT, type RuntimeCompletionController } from "./runtime-completion.js";
import { evaluateRuntimeCompletionGuards, finalOutputGuard } from "./runtime-completion-guards.js";
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
import { routeIntervention, classifyToolRisk } from "./causal-policy-router.js";
import { registerRuntimeToolAttempt } from "./runtime-tool-attempt.js";
import { codeDevelopmentToolBoundaryError } from "./runtime-tool-boundary.js";
import { RuntimeToolCallService } from "./runtime-tool-call-service.js";
import { RuntimeToolRecoveryService } from "./runtime-tool-recovery-service.js";
import { logLatency } from "../latency-log.js";

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

export function shouldEmitProviderStreamEvent(
  event: Pick<ModelStreamEvent, "kind">,
  emittedProviderStreamFrameForInvocation: boolean,
): boolean {
  return event.kind !== "sse_frame" || !emittedProviderStreamFrameForInvocation;
}

export interface RunNodeRuntimeLoopParams {
  runId: string;
  agentId: string;
  nodeId: string;
  title: string;
  prompt: string;
  system: string;
  providerCache?: ModelRequest["providerCache"];
  toolIds: string[];
  /** Optional per-node timeout in milliseconds. If set, the node automatically
   *  transitions to `degraded` if execution exceeds this duration. */
  timeoutMs?: number;
  onForcedFinalProviderExhausted?: (error: unknown) => ModelResponse | undefined;
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
    providerCache?: ModelRequest["providerCache"];
    nativeTools: ReturnType<RuntimeToolExecutor["toolDefinitions"]>;
    streamCallbacks?: Parameters<typeof invokeRunProviderStream>[2];
    reason: CompletionStopReason;
    agentId?: string;
    nodeId?: string;
    title?: string;
    emitNodeRuntimeState?: RunNodeRuntimeLoopDeps["emitNodeRuntimeState"];
    onProviderExhausted?: (error: unknown) => ModelResponse | undefined;
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
      ...(isInternalRuntimeStatusTrigger(trigger) ? { audience: "internal" } : {}),
    },
    { agentId: params.agentId, nodeId: params.nodeId },
  );
}

function isInternalRuntimeStatusTrigger(trigger: string): boolean {
  return trigger === "plan_list.incomplete" || trigger === "runtime_work.pending";
}

/**
 * Build a normalized fingerprint from a guard rejection result so the
 * cycle counter detects no-progress loops even when the model rephrases
 * the same logical error or generates new action/plan IDs.
 */
function buildGuardFingerprint(guardResult: { reason: string; detail: string }): string {
  let normalized = guardResult.detail
    // Strip parenthesized IDs: (action-abc), (plan-xyz), (todo-123)
    .replace(/\s*\([^)]+\)/g, "")
    // Normalize numbered list prefixes: "plan 1." → "plan", "todo 2." → "todo"
    .replace(/\b(plan|todo|action|tool call)\s+\d+\./gi, "$1")
    // Collapse whitespace
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  return `${guardResult.reason}:${normalized}`;
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
  let nodeTimeoutSignal: AbortSignal | undefined;
  if (params.timeoutMs && params.timeoutMs > 0) {
    const abortController = new AbortController();
    const timeoutHandle = setTimeout(() => {
      abortController.abort();
      nodeLoopController.emit("degraded", {
        agentId: params.agentId,
        title: params.title,
        reason: `Node timeout after ${params.timeoutMs}ms`,
      });
    }, params.timeoutMs);
    nodeTimeoutSignal = abortController.signal;
    const externalSignal = deps.signal;
    if (externalSignal) {
      externalSignal.addEventListener("abort", () => {
        abortController.abort();
        clearTimeout(timeoutHandle);
      }, { once: true });
    }
  }

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
  let modelInvocationIndex = 0;
  let activeAssistantMessageId = `${params.runId}:assistant:${params.agentId}:${params.nodeId}:0`;
  let emittedProviderStreamFrameForInvocation = false;
  const nextAssistantMessageId = () => {
    activeAssistantMessageId = `${params.runId}:assistant:${params.agentId}:${params.nodeId}:${modelInvocationIndex}`;
    modelInvocationIndex += 1;
    emittedProviderStreamFrameForInvocation = false;
    return activeAssistantMessageId;
  };
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
              messageId: activeAssistantMessageId,
              content: chunk.delta,
              delta: chunk.delta,
              streaming: true,
              phase: "stream",
              ...(visibility ? { visibility } : {}),
            },
            { agentId: params.agentId, nodeId: params.agentId },
          );
        },
        onStreamEvent: (event: ModelStreamEvent) => {
          if (!shouldEmitProviderStreamEvent(event, emittedProviderStreamFrameForInvocation)) {
            return;
          }
          if (event.kind === "sse_frame") {
            emittedProviderStreamFrameForInvocation = true;
          }
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
  const withAbortSignal = (request: ModelRequest): ModelRequest => {
    const effectiveSignal = nodeTimeoutSignal ?? deps.signal;
    return {
      ...request,
      signal: request.signal ?? effectiveSignal,
    };
  };

  const invokeProviderWithRecovery = async (
    request: ModelRequest,
    options: { emitRetryModelState: boolean },
  ): Promise<ModelResponse> => {
    const attemptScope = nextAssistantMessageId();
    while (true) {
      try {
        const response = await invokeProvider(config, request, streamCallbacks);
        lastProviderRequestMessages = [...(request.messages ?? [])];
        return response;
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        const incident = classifyRecoveryError(error, {
          surface: "provider",
          attemptScope,
          nodeId: params.agentId,
          agentId: params.agentId,
        });
        const recoveryDecision = recoveryCoordinator.resolve(incident);
        if (recoveryDecision.action !== "retry") {
          if (recoveryDecision.action !== "fail") {
            throw error;
          }
          emitRecoveryDecision(incident, recoveryDecision);
          throw new RecoveryExhaustedError(incident, recoveryDecision);
        }
        emitRecoveryDecision(incident, recoveryDecision);
        await sleep(recoveryDecision.retryDelayMs ?? 0);
        if (options.emitRetryModelState) {
          nodeLoopController.emitTransitionResult("model_request", "running_model", {
            agentId: params.agentId,
            title: params.title,
            reason: "provider_retry",
            detail,
          });
        }
      }
    }
  };

  const invokeModel = (
    request: ModelRequest,
    options: { emitRetryModelState?: boolean } = {},
  ) =>
    invokeRuntimeModelCall({
      request: withAbortSignal(withStablePrefixCacheMetadata(request)),
      context: middlewareContext,
      middlewares: runtimeMiddlewares,
      terminal: (nextRequest) => invokeProviderWithRecovery(nextRequest, {
        emitRetryModelState: options.emitRetryModelState ?? true,
      }),
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
      terminal: (nextRequest) => invokeProviderWithRecovery(nextRequest, {
        emitRetryModelState: true,
      }),
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
    completion,
    runForcedFinalProviderCall: ({ messages: nextMessages, reason, nativeTools: nextNativeTools }) =>
      runForcedFinalProviderCall({
        invokeProvider,
        config,
        messages: [...nextMessages],
        system: params.system,
        providerCache: params.providerCache,
        nativeTools: [...nextNativeTools],
        streamCallbacks,
        reason,
        agentId: params.agentId,
        nodeId: params.nodeId,
        title: params.title,
        emitNodeRuntimeState: emitForcedFinalProviderState,
        onProviderExhausted: params.onForcedFinalProviderExhausted,
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
  let emptyFinalOutputRepairUsed = false;
  const continueOrCompleteNaturally = async (
    currentResponse: ModelResponse,
    iteration: number,
    isPostTool = false,
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
      agentId: params.agentId,
    });
    if (guardResult.allowComplete) {
      // Final-output guard: refuse to complete when the candidate answer is empty.
      const outputGuardResult = finalOutputGuard(currentResponse.text, { isPostTool });
      if (!outputGuardResult.allowComplete) {
        // Only allow one repair turn for empty post-tool responses.
        if (!emptyFinalOutputRepairUsed) {
          emptyFinalOutputRepairUsed = true;
          nodeLoopController.emitTransitionResult("model_request", "running_model", {
            agentId: params.agentId,
            title: params.title,
            reason: outputGuardResult.reason,
            detail: outputGuardResult.detail,
            iteration,
          });
          messages = [
            ...messages,
            { role: "assistant", content: currentResponse.text },
            { role: "user", content: outputGuardResult.followUpContent },
          ];
          const repairResponse = await invokeFollowUpModel({
            messages,
            system: params.system,
            maxTokens: config.budget?.maxTokens,
            tools: nativeTools,
            toolChoice: "none",
          }, currentResponse, outputGuardResult.followUpReason);
          // Re-check the repair response via natural completion.
          return continueOrCompleteNaturally(repairResponse, iteration, false);
        }
        // Repair already used; fail the run.
        throw new Error([
          "Run cannot complete: final output is empty after repair attempt.",
          `reason: ${outputGuardResult.reason}`,
          outputGuardResult.detail,
        ].join("\n"));
      }

      nodeLoopController.emitTransitionResult("complete", "completed", {
        agentId: params.agentId,
        title: params.title,
        iteration,
      });
      const completionDecision = routeIntervention({
        surfaceRequest: input.prompt,
        taskState: undefined,
        proposedToolId: undefined,
        proposedToolRisk: "low",
        toolCallCount: completion.toolAttempts,
        clarificationCount: 0,
        hasPendingApprovals: false,
        hasPendingPlanDecisions: false,
        hasUnresolvedPlanItems: false,
        modelResponseText: currentResponse.text,
      });
      emit("causal.decision.recorded", completionDecision.decisionRecord);
      return { kind: "complete", response: currentResponse };
    }

    // Build a normalized guard fingerprint to detect no-progress loops.
    // Strip parenthesized IDs (e.g. "(action-xxx)"), normalize whitespace,
    // and remove leading numbered prefixes (e.g. "plan 1." → "plan") so
    // minor rephrasings don't reset the cycle counter.
    const guardFingerprint = buildGuardFingerprint(guardResult);
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
    providerCache: params.providerCache,
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
    const tNow = Date.now();
    const kernelElapsed = tNow - (((globalThis as any).__latencyKernelStart as number) ?? tNow);
    (globalThis as any).__latencyInvokeModelStart = tNow;
    logLatency("kernel→invokeModel", kernelElapsed);
    response = await invokeModel(initialRequest, {
      emitRetryModelState: initialToolsAllowed,
    });
  } catch (error) {
    if (!initialToolsAllowed) {
      nodeLoopController.emitTransitionResult("fail", "failed", {
        agentId: params.agentId,
        title: params.title,
        reason: completion.stopReasonForScope(completionScope) ?? "tool_budget_exhausted",
        detail: error instanceof Error ? error.message : String(error),
      });
      const exhaustedFallback = params.onForcedFinalProviderExhausted?.(error);
      if (exhaustedFallback) {
        return exhaustedFallback;
      }
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
  let ignoredUnavailableToolCallFollowUps = 0;
  let hasExecutedTool = false;
  for (let iteration = 0; iteration < toolLoopLimit; iteration += 1) {
    if (!completion.toolsAllowed(completionScope)) {
      return runForcedFinalProviderCall({
        invokeProvider,
        config,
        messages,
        system: params.system,
        providerCache: params.providerCache,
        nativeTools,
        streamCallbacks,
        reason: completion.stopReasonForScope(completionScope) ?? "tool_budget_exhausted",
        agentId: params.agentId,
        nodeId: params.nodeId,
        title: params.title,
        emitNodeRuntimeState: emitForcedFinalProviderState,
        onProviderExhausted: params.onForcedFinalProviderExhausted,
      });
    }

    const toolCall = selectRuntimeToolAttempt({
      response,
      toolIds: enabledTools,
      extractFallbackToolCall: (text, toolIds) => runtimeToolExecutor.extractToolCall(text, toolIds),
    });
    if (!toolCall) {
      const ignoredNativeToolCalls = (response.toolCalls?.length ?? 0) > 0 &&
        nativeRuntimeToolAttempts(response, enabledTools).length === 0;
      if (ignoredNativeToolCalls && ignoredUnavailableToolCallFollowUps < 3) {
        ignoredUnavailableToolCallFollowUps += 1;
        emit("completion.updated", {
          state: "tool_calls_ignored",
          reason: "unavailable_tool_in_mode",
          ignoredToolCalls: response.toolCalls,
        });
        nodeLoopController.emitTransitionResult("model_request", "running_model", {
          agentId: params.agentId,
          title: params.title,
          reason: "unavailable_tool_in_mode",
          detail: "The model requested a tool that is not available in the current mode.",
          iteration: iteration + 1,
        });
        messages = [
          ...messages,
          { role: "assistant", content: response.text },
          {
            role: "user",
            content: "The previous response requested a tool that is not available in the current mode. Continue without that tool and produce the required user-facing response.",
          },
        ];
        response = await invokeFollowUpModel({
          messages,
          system: params.system,
          maxTokens: config.budget?.maxTokens,
          tools: nativeTools,
          toolChoice: nativeTools.length > 0 ? "auto" : undefined,
        }, response, "unavailable_tool_follow_up");
        continue;
      }
      const completionResult = await continueOrCompleteNaturally(response, iteration, hasExecutedTool);
      if (completionResult.kind === "continue") {
        response = completionResult.response;
        continue;
      }
      return completionResult.response;
    }

    const allNativeToolCalls = nativeRuntimeToolAttempts(response, enabledTools);

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

    const toolRisk = classifyToolRisk(toolCall.tool);
    const policyResult = routeIntervention({
      surfaceRequest: input.prompt,
      taskState: undefined,
      proposedToolId: toolCall.tool,
      proposedToolRisk: toolRisk,
      toolCallCount: completion.toolAttempts + 1,
      clarificationCount: 0,
      hasPendingApprovals: false,
      hasPendingPlanDecisions: false,
      hasUnresolvedPlanItems: false,
      modelResponseText: response.text,
    });
    emit("causal.decision.recorded", policyResult.decisionRecord);

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
        providerCache: params.providerCache,
        nativeTools,
        streamCallbacks,
        reason: attemptDecision.reason,
        agentId: params.agentId,
        nodeId: params.nodeId,
        title: params.title,
        emitNodeRuntimeState: emitForcedFinalProviderState,
        onProviderExhausted: params.onForcedFinalProviderExhausted,
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
    switch (toolTurnResult.kind) {
      case "retry":
        continue;
      case "return":
        return toolTurnResult.response;
      case "continue":
        hasExecutedTool = true;
        response = toolTurnResult.response;
        continue;
      case "throw":
        throw toolTurnResult.error;
    }
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
    providerCache: params.providerCache,
    nativeTools,
    streamCallbacks,
    reason: "runtime_tool_loop_limit",
    agentId: params.agentId,
    title: params.title,
    emitNodeRuntimeState: emitForcedFinalProviderState,
    onProviderExhausted: params.onForcedFinalProviderExhausted,
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
