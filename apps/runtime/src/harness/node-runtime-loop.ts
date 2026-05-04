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
import {
  classifyRecoveryError,
  type RecoveryCoordinator,
  type RecoveryDecision,
  type RecoveryIncident,
} from "./recovery-policy.js";
import { RUNTIME_TOOL_LOOP_SAFETY_LIMIT, type RuntimeCompletionController } from "./runtime-completion.js";
import { evaluateRuntimeCompletionGuards } from "./runtime-completion-guards.js";
import { ApprovalInterruptError, ClarificationInterruptError } from "./runtime-interrupts.js";
import { forcedFinalSystemPrompt } from "./runtime-output.js";
import type { RuntimeActionDeps } from "./runtime-action-runner.js";
import {
  recordRuntimeToolActionFailed,
  recordRuntimeToolActionSucceeded,
  resolveRuntimeActionApproval,
  transitionRuntimeAction,
} from "./runtime-action-runner.js";
import {
  providerSupportsNativeTools,
  providerToolCallToAttempt,
  cacheKeyForRuntimeTool,
  invalidatesRuntimeToolCache,
  type RuntimeToolAttempt,
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
      request: withAbortSignal(request),
      context: middlewareContext,
      middlewares: runtimeMiddlewares,
      terminal: (nextRequest) => invokeProvider(config, nextRequest, streamCallbacks),
    });
  const invokeFollowUpModel = (
    request: ModelRequest,
    latestResponse: ModelResponse,
    reason: string,
  ) =>
    invokeRuntimeModelCall({
      request: withAbortSignal(request),
      context: middlewareContext,
      middlewares: runtimeMiddlewares,
      terminal: (nextRequest) => invokeProvider(config, nextRequest, streamCallbacks),
      metadata: {
        compaction: { latestResponse, reason },
      },
    });
  const toolExecutionContext: RuntimeToolExecutionContext = {
    ...middlewareContext,
    actionDeps,
    emitNodeRuntimeState,
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
  const recoverToolFailure = async (
    failure: RuntimeToolFailureRequest,
  ): Promise<Awaited<ReturnType<RuntimeToolFailureContext["recoverToolFailure"]>>> => {
    const { action, toolCall, toolCallRecord, error, iteration } = failure;
    const detail = error instanceof Error ? error.message : String(error);
    recordRuntimeToolActionFailed({
      action,
      context: { agentId: params.agentId, nodeId: params.agentId },
      deps: actionDeps(),
      toolCall,
      detail,
      toolCallRecord,
      now,
    });
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
      return { kind: "retry" };
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
        return {
          kind: "return",
          response: await runForcedFinalProviderCall({
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
          }),
        };
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
      const alternateApproval = await resolveRuntimeActionApproval({
        action: alternateAction,
        context: {
          agentId: params.agentId,
          nodeId: params.agentId,
          title: params.title,
        },
        deps: actionDeps(),
      });
      transitionRuntimeAction({
        action: alternateAction,
        status: "running",
        context: { agentId: params.agentId, nodeId: params.agentId },
        deps: actionDeps(),
      });
      emitNodeRuntimeState("tool_running", {
        agentId: params.agentId,
        title: params.title,
        actionId: alternateAction.id,
        toolId: alternateCall.tool,
        iteration,
      });
      const alternateExecution = await runtimeToolExecutor.executeWithMetadata(
        alternateCall,
        {
          allowRisky:
            alternateApproval.approvedForRiskyExecution,
        },
      );
      const alternateOutput = alternateExecution.output;
      const alternateArtifact = alternateExecution.fileChange
        ? publishFileChangeArtifact(alternateExecution.fileChange, {
            actionId: alternateAction.id,
            agentId: params.agentId,
            nodeId: params.agentId,
          })
        : undefined;
      completion.markToolResultObserved(alternateCall, false, completionScope);
      const { resultText: alternateResultText } =
        recordRuntimeToolActionSucceeded({
          action: alternateAction,
          context: { agentId: params.agentId, nodeId: params.agentId },
          deps: actionDeps(),
          toolCall: alternateCall,
          output: alternateOutput,
          fileChange: alternateExecution.fileChange,
          artifactIds: alternateArtifact ? [alternateArtifact.id] : undefined,
          recoveredFrom: toolCall.tool,
          now,
        });
      emitNodeRuntimeState("tool_result_observed", {
        agentId: params.agentId,
        title: params.title,
        actionId: alternateAction.id,
        toolId: alternateCall.tool,
        iteration,
      });
      messages = [
        ...messages,
        { role: "assistant", content: failure.response.text },
        {
          role: "user",
          content: `Workspace tool result for ${alternateCall.tool}:\n${alternateResultText}`,
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
        return {
          kind: "return",
          response: await runForcedFinalProviderCall({
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
          }),
        };
      }
      emitNodeRuntimeState("running_model", {
        agentId: params.agentId,
        title: params.title,
        iteration: iteration + 1,
      });
      return {
        kind: "continue",
        response: await invokeFollowUpModel({
          messages,
          system: params.system,
          maxTokens: config.budget?.maxTokens,
          tools: nativeTools,
          toolChoice: nativeTools.length > 0 ? "auto" : undefined,
        }, failure.response, "tool_follow_up"),
      };
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
      const degradedToolContent = `Workspace tool degraded for ${toolCall.tool}:\n${JSON.stringify(fallbackOutput, null, 2)}`;
      messages =
        toolCall.source === "provider_native" && toolCall.providerCallId
          ? [
              ...messages,
              {
                role: "assistant",
                content: failure.response.text,
                reasoningContent: failure.response.reasoningContent,
                toolCalls: failure.response.toolCalls?.filter(
                  (call) => call.id === toolCall.providerCallId,
                ),
              },
              {
                role: "tool",
                toolCallId: toolCall.providerCallId,
                toolName: toolCall.tool,
                content: degradedToolContent,
              },
            ]
          : [
              ...messages,
              { role: "assistant", content: failure.response.text },
              {
                role: "user",
                content: degradedToolContent,
              },
            ];
      emitNodeRuntimeState("repairing", {
        agentId: params.agentId,
        title: params.title,
        toolId: toolCall.tool,
        detail: incident.detail,
      });
      return {
        kind: "continue",
        response: await invokeFollowUpModel({
          messages,
          system: params.system,
          maxTokens: config.budget?.maxTokens,
          tools: nativeTools,
          toolChoice: nativeTools.length > 0 ? "auto" : undefined,
        }, failure.response, "tool_recovery_follow_up"),
      };
    }

    return { kind: "throw", error };
  };
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
  const continueOrCompleteNaturally = async (
    currentResponse: ModelResponse,
    iteration: number,
  ): Promise<{ kind: "continue"; response: ModelResponse } | { kind: "complete"; response: ModelResponse }> => {
    const guardResult = evaluateRuntimeCompletionGuards({
      actions: actionLedger.list(),
      planList: deps.planList(),
      toolCalls: deps.toolCalls(),
    });
    if (guardResult.allowComplete) {
      emitNodeRuntimeState("completed", {
        agentId: params.agentId,
        title: params.title,
        iteration,
      });
      return { kind: "complete", response: currentResponse };
    }

    emitRuntimeStatusProgress(
      emit,
      params,
      guardResult.progressTrigger,
      guardResult.progressSummary,
      Math.max(0, events.length - 1),
    );
    emitNodeRuntimeState("running_model", {
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

  emitNodeRuntimeState("pending", {
    agentId: params.agentId,
    title: params.title,
  });
  const initialToolsAllowed = completion.toolsAllowed(completionScope);
  if (!initialToolsAllowed && completion.toolAttempts >= completion.maxToolCalls) {
    completion.forceFinalAnswer("tool_budget_exhausted");
  }
  emitNodeRuntimeState(initialToolsAllowed ? "running_model" : "finalizing", {
    agentId: params.agentId,
    title: params.title,
  });
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
  let response = await invokeModel(initialRequest);
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
      const completionResult = await continueOrCompleteNaturally(response, iteration);
      if (completionResult.kind === "continue") {
        response = completionResult.response;
        continue;
      }
      return completionResult.response;
    }

    const allNativeToolCalls = (response.toolCalls
      ?.map(providerToolCallToAttempt)
      .filter(Boolean) as RuntimeToolAttempt[]) ?? [];

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

    const { approvedForRiskyExecution } = await resolveRuntimeActionApproval({
      action,
      context: {
        agentId: params.agentId,
        nodeId: params.agentId,
        title: params.title,
      },
      deps: actionDeps(),
      toolCallRecord,
    });

    transitionRuntimeAction({
      action,
      status: "running",
      context: { agentId: params.agentId, nodeId: params.agentId },
      deps: actionDeps(),
      toolCallRecord,
    });
    emitNodeRuntimeState("tool_running", {
      agentId: params.agentId,
      title: params.title,
      actionId: action.id,
      toolId: toolCall.tool,
      iteration,
    });

    try {
      const execution = await invokeToolExecution({
        action,
        toolCall,
        toolCallRecord,
        allowRisky: approvedForRiskyExecution,
        iteration,
      });
      const output = execution.output;
      completion.markToolResultObserved(toolCall, execution.cacheHit ?? false, completionScope);
      const { resultText } = recordRuntimeToolActionSucceeded({
        action,
        context: { agentId: params.agentId, nodeId: params.agentId },
        deps: actionDeps(),
        toolCall,
        output,
        fileChange: execution.fileChange,
        artifactIds: execution.artifact ? [execution.artifact.id] : undefined,
        cacheHit: execution.cacheHit,
        toolCallRecord,
        now,
      });
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
      if (toolCall.tool === "plan.update") {
        const deps = actionDeps();
        deps.emit("plan_list.updated", toolCall.args);
      }

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
      response = await invokeFollowUpModel({
        messages,
        system: params.system,
        maxTokens: config.budget?.maxTokens,
        tools: nativeTools,
        toolChoice: nativeTools.length > 0 ? "auto" : undefined,
      }, response, "tool_follow_up");
    } catch (error) {
      if (error instanceof ClarificationInterruptError) {
        throw error;
      }
      const failureResult = await invokeToolFailure({
        error,
        action,
        toolCall,
        toolCallRecord,
        allowRisky: approvedForRiskyExecution,
        iteration,
        response,
      });
      if (failureResult.kind === "retry") {
        continue;
      }
      if (failureResult.kind === "return") {
        return failureResult.response;
      }
      if (failureResult.kind === "continue") {
        response = failureResult.response;
        continue;
      }
      throw failureResult.error;
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
}
