import type {
  ActionRecord,
  ArtifactRef,
  CompletionStopReason,
  OraEventEnvelope,
  OraToolCallEnvelope,
  PendingClarificationOption,
  RunConfig,
} from "@cemeworm/shared";
import {
  buildLocalCompactionRequest,
  compactedContextFromSummary,
  resolveAutoCompactTokenLimit,
  resolvedContextWindow,
  resolveRunProviderConfig,
  usageForModelResponse,
} from "../context-manager.js";
import { invokeRunProvider } from "../providers/index.js";
import type { ModelMessage, ModelRequest, ModelResponse, ModelToolCall, ModelToolDefinition } from "../providers/index.js";
import type { RuntimeCompletionController } from "./runtime-completion.js";
import type { RuntimeActionDeps } from "./runtime-action-runner.js";
import { recordRuntimeToolActionSucceeded } from "./runtime-action-runner.js";
import type { RuntimeToolAttempt } from "./runtime-tool-loop.js";
import type { RuntimeFileChangeMetadata, RuntimeToolCall } from "./runtime-tool-executor.js";
import type { AppendRuntimeToolCallParams } from "./runtime-tool-ledger.js";

export type RuntimeMiddlewareEmit = (
  type: OraEventEnvelope["type"],
  payload: unknown,
  extra?: Partial<OraEventEnvelope>,
) => OraEventEnvelope;

export interface RuntimeMiddlewareContext {
  config: RunConfig;
  agentId: string;
  nodeId: string;
  modelNodeId?: string;
  title: string;
  now: () => number;
  appendToolCall: (params: AppendRuntimeToolCallParams) => OraToolCallEnvelope;
  emit: RuntimeMiddlewareEmit;
  replaceMessages?: (messages: readonly ModelMessage[]) => void;
}

export interface RuntimeModelCallMetadata {
  compaction?: {
    latestResponse: ModelResponse;
    reason: string;
  };
}

export type RuntimeModelCallHandler = (request: ModelRequest) => Promise<ModelResponse>;

export type RuntimeNodeState =
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

export interface RuntimeNodeStateEmitParams {
  agentId: string;
  title?: string;
  actionId?: string;
  reason?: string;
  detail?: string;
  toolId?: string;
  iteration?: number;
}

export interface RuntimeToolExecutionResult {
  output: unknown;
  fileChange?: RuntimeFileChangeMetadata;
  artifact?: ArtifactRef;
  cacheKey?: string;
  cacheHit?: boolean;
}

export interface RuntimeToolExecutionRequest {
  action: ActionRecord;
  toolCall: RuntimeToolCall & {
    providerCallId?: string;
    source?: OraToolCallEnvelope["source"];
  };
  toolCallRecord: OraToolCallEnvelope;
  allowRisky: boolean;
  iteration: number;
}

export interface RuntimeToolExecutionContext extends RuntimeMiddlewareContext {
  actionDeps: () => RuntimeActionDeps;
  emitNodeRuntimeState: (
    state: RuntimeNodeState,
    params: RuntimeNodeStateEmitParams,
  ) => void;
  emitToolRequested: (params: RuntimeNodeStateEmitParams) => void;
  emitToolRunning: (params: RuntimeNodeStateEmitParams) => void;
  emitToolResultObserved: (params: RuntimeNodeStateEmitParams) => void;
  emitModelRequest: (params: RuntimeNodeStateEmitParams) => void;
  emitForcedFinal: (params: RuntimeNodeStateEmitParams) => void;
  emitGateRequired: (params: RuntimeNodeStateEmitParams) => void;
  eventsLength: () => number;
  clarificationAnswer: (key: string, id: string) => unknown;
  ensureClarification: (params: {
    id: string;
    key: string;
    nodeId: string;
    nodeLabel: string;
    question: string;
    options?: PendingClarificationOption[];
  }) => Promise<unknown>;
}

export type RuntimeToolExecutionHandler = (
  request: RuntimeToolExecutionRequest,
) => Promise<RuntimeToolExecutionResult>;

export type RuntimeToolFailureResult =
  | { kind: "retry" }
  | { kind: "continue"; response: ModelResponse }
  | { kind: "return"; response: ModelResponse }
  | { kind: "throw"; error: unknown };

export interface RuntimeToolFailureRequest extends RuntimeToolExecutionRequest {
  error: unknown;
  response: ModelResponse;
}

export interface RuntimeToolFailureContext extends RuntimeToolExecutionContext {
  recoverToolFailure: (
    request: RuntimeToolFailureRequest,
  ) => Promise<RuntimeToolFailureResult>;
}

export type RuntimeToolFailureHandler = (
  request: RuntimeToolFailureRequest,
) => Promise<RuntimeToolFailureResult>;

export type RuntimeModelResponseResult =
  | { kind: "handled_continue"; response: ModelResponse }
  | { kind: "handled_return"; response: ModelResponse }
  | { kind: "unhandled" };

export interface RuntimeModelResponseRequest {
  response: ModelResponse;
  iteration: number;
  messages: readonly ModelMessage[];
  selectedToolCall: RuntimeToolAttempt;
  allNativeToolCalls: readonly RuntimeToolAttempt[];
  nativeTools: readonly ModelToolDefinition[];
}

export interface RuntimeModelResponseContext extends RuntimeToolExecutionContext {
  system: string;
  ensureClarifications: (requests: Array<{
    id: string;
    key: string;
    nodeId: string;
    nodeLabel: string;
    question: string;
    options?: PendingClarificationOption[];
  }>) => Promise<unknown[]>;
  emitProgressNarration: (params: {
    trigger: string;
    agentId?: string;
    nodeId?: string;
    title?: string;
    detail?: string;
  }) => Promise<void>;
  completion: RuntimeCompletionController;
  runForcedFinalProviderCall: (params: {
    messages: ModelMessage[];
    reason: CompletionStopReason;
    nativeTools: readonly ModelToolDefinition[];
  }) => Promise<ModelResponse>;
  invokeFollowUpModel: (
    request: ModelRequest,
    latestResponse: ModelResponse,
    reason: string,
  ) => Promise<ModelResponse>;
}

export type RuntimeModelResponseHandler = (
  request: RuntimeModelResponseRequest,
) => Promise<RuntimeModelResponseResult>;

export interface RuntimeMiddleware {
  name: string;
  priority?: number;
  wrapModelCall?: (
    request: ModelRequest,
    context: RuntimeMiddlewareContext,
    next: RuntimeModelCallHandler,
    metadata: RuntimeModelCallMetadata,
  ) => Promise<ModelResponse>;
  wrapToolExecution?: (
    request: RuntimeToolExecutionRequest,
    context: RuntimeToolExecutionContext,
    next: RuntimeToolExecutionHandler,
  ) => Promise<RuntimeToolExecutionResult>;
  wrapToolFailure?: (
    request: RuntimeToolFailureRequest,
    context: RuntimeToolFailureContext,
    next: RuntimeToolFailureHandler,
  ) => Promise<RuntimeToolFailureResult>;
  wrapModelResponse?: (
    request: RuntimeModelResponseRequest,
    context: RuntimeModelResponseContext,
    next: RuntimeModelResponseHandler,
  ) => Promise<RuntimeModelResponseResult>;
}

export function orderedRuntimeMiddlewares(
  middlewares: readonly RuntimeMiddleware[],
): RuntimeMiddleware[] {
  return [...middlewares].sort((left, right) => {
    const priorityDelta = (left.priority ?? 0) - (right.priority ?? 0);
    return priorityDelta !== 0 ? priorityDelta : left.name.localeCompare(right.name);
  });
}

export function composeRuntimeModelCall(
  middlewares: readonly RuntimeMiddleware[],
  context: RuntimeMiddlewareContext,
  terminal: RuntimeModelCallHandler,
  metadata: RuntimeModelCallMetadata = {},
): RuntimeModelCallHandler {
  return orderedRuntimeMiddlewares(middlewares).reduceRight<RuntimeModelCallHandler>(
    (next, middleware) => {
      if (!middleware.wrapModelCall) {
        return next;
      }
      return (request) => middleware.wrapModelCall!(request, context, next, metadata);
    },
    terminal,
  );
}

export async function invokeRuntimeModelCall(
  params: {
    request: ModelRequest;
    context: RuntimeMiddlewareContext;
    middlewares: readonly RuntimeMiddleware[];
    terminal: RuntimeModelCallHandler;
    metadata?: RuntimeModelCallMetadata;
  },
): Promise<ModelResponse> {
  return composeRuntimeModelCall(
    params.middlewares,
    params.context,
    params.terminal,
    params.metadata,
  )(params.request);
}

export function composeRuntimeToolExecution(
  middlewares: readonly RuntimeMiddleware[],
  context: RuntimeToolExecutionContext,
  terminal: RuntimeToolExecutionHandler,
): RuntimeToolExecutionHandler {
  return orderedRuntimeMiddlewares(middlewares).reduceRight<RuntimeToolExecutionHandler>(
    (next, middleware) => {
      if (!middleware.wrapToolExecution) {
        return next;
      }
      return (request) => middleware.wrapToolExecution!(request, context, next);
    },
    terminal,
  );
}

export async function invokeRuntimeToolExecution(
  params: {
    request: RuntimeToolExecutionRequest;
    context: RuntimeToolExecutionContext;
    middlewares: readonly RuntimeMiddleware[];
    terminal: RuntimeToolExecutionHandler;
  },
): Promise<RuntimeToolExecutionResult> {
  return composeRuntimeToolExecution(
    params.middlewares,
    params.context,
    params.terminal,
  )(params.request);
}

export function composeRuntimeToolFailure(
  middlewares: readonly RuntimeMiddleware[],
  context: RuntimeToolFailureContext,
  terminal: RuntimeToolFailureHandler,
): RuntimeToolFailureHandler {
  return orderedRuntimeMiddlewares(middlewares).reduceRight<RuntimeToolFailureHandler>(
    (next, middleware) => {
      if (!middleware.wrapToolFailure) {
        return next;
      }
      return (request) => middleware.wrapToolFailure!(request, context, next);
    },
    terminal,
  );
}

export async function invokeRuntimeToolFailure(
  params: {
    request: RuntimeToolFailureRequest;
    context: RuntimeToolFailureContext;
    middlewares: readonly RuntimeMiddleware[];
    terminal: RuntimeToolFailureHandler;
  },
): Promise<RuntimeToolFailureResult> {
  return composeRuntimeToolFailure(
    params.middlewares,
    params.context,
    params.terminal,
  )(params.request);
}

export function composeRuntimeModelResponse(
  middlewares: readonly RuntimeMiddleware[],
  context: RuntimeModelResponseContext,
  terminal: RuntimeModelResponseHandler,
): RuntimeModelResponseHandler {
  return orderedRuntimeMiddlewares(middlewares).reduceRight<RuntimeModelResponseHandler>(
    (next, middleware) => {
      if (!middleware.wrapModelResponse) {
        return next;
      }
      return (request) => middleware.wrapModelResponse!(request, context, next);
    },
    terminal,
  );
}

export async function invokeRuntimeModelResponse(
  params: {
    request: RuntimeModelResponseRequest;
    context: RuntimeModelResponseContext;
    middlewares: readonly RuntimeMiddleware[];
    terminal: RuntimeModelResponseHandler;
  },
): Promise<RuntimeModelResponseResult> {
  return composeRuntimeModelResponse(
    params.middlewares,
    params.context,
    params.terminal,
  )(params.request);
}

const TOOL_REPAIR_CONTENT =
  "Tool call was interrupted before a result was produced. Continue from available context or choose another action.";

function toolCallsMissingResults(messages: readonly ModelMessage[]): ModelToolCall[] {
  const pending = new Map<string, ModelToolCall>();
  for (const message of messages) {
    if (message.role === "assistant" && message.toolCalls?.length) {
      for (const call of message.toolCalls) {
        pending.set(call.id, call);
      }
      continue;
    }
    if (message.role === "tool" && message.toolCallId) {
      pending.delete(message.toolCallId);
    }
  }
  return [...pending.values()];
}

function stringToolArg(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function sanitizeClarificationKey(key: string): string {
  const sanitized = key.trim().replace(/[^A-Za-z0-9_.:-]+/g, "_").replace(/^_+|_+$/g, "");
  return (sanitized || "clarification").slice(0, 120);
}

function parseClarificationOptions(value: unknown): PendingClarificationOption[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.slice(0, 6).flatMap((item, index): PendingClarificationOption[] => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return [];
    }
    const record = item as Record<string, unknown>;
    const label = typeof record.label === "string" && record.label.trim()
      ? record.label.trim()
      : undefined;
    if (!label) {
      return [];
    }
    const id = typeof record.id === "string" && record.id.trim()
      ? record.id.trim()
      : `option_${index + 1}`;
    const value = typeof record.value === "string" && record.value.trim()
      ? record.value.trim()
      : undefined;
    const description = typeof record.description === "string" && record.description.trim()
      ? record.description.trim()
      : undefined;
    return [{ id, label, ...(value ? { value } : {}), ...(description ? { description } : {}) }];
  });
}

function clarificationRequestFromToolCall(
  call: Pick<RuntimeToolAttempt, "args">,
  params: {
    agentId: string;
    nodeId: string;
    nodeLabel: string;
    eventIndex: number;
  },
) {
  const question = stringToolArg(call.args, "question");
  if (!question) {
    throw new Error("user.clarify requires a non-empty question.");
  }
  const fallbackKey = `dynamic_${params.agentId}_${params.eventIndex}`;
  const key = sanitizeClarificationKey(stringToolArg(call.args, "key") ?? fallbackKey);
  return {
    id: `clarification:${params.agentId}:${params.eventIndex}`,
    key,
    nodeId: params.nodeId,
    nodeLabel: params.nodeLabel,
    question,
    options: parseClarificationOptions(call.args.options),
  };
}

function dynamicClarificationRequest(
  request: RuntimeToolExecutionRequest,
  context: RuntimeToolExecutionContext,
) {
  return clarificationRequestFromToolCall(request.toolCall, {
    agentId: context.agentId,
    nodeId: context.modelNodeId ?? context.nodeId,
    nodeLabel: context.title,
    eventIndex: context.eventsLength(),
  });
}

export function repairDanglingProviderToolCalls(
  messages: readonly ModelMessage[] | undefined,
  context: RuntimeMiddlewareContext,
): readonly ModelMessage[] | undefined {
  if (!messages?.length) {
    return messages;
  }
  const pending = toolCallsMissingResults(messages);
  if (pending.length === 0) {
    return messages;
  }
  const repairedMessages: ModelMessage[] = [...messages];
  for (const call of pending) {
    context.appendToolCall({
      providerCallId: call.id,
      toolId: call.toolId,
      args: call.args,
      source: "manual_repair",
      status: "repaired",
      agentId: context.agentId,
      nodeId: context.nodeId,
      result: {
        status: "interrupted",
        error: TOOL_REPAIR_CONTENT,
        content: TOOL_REPAIR_CONTENT,
        createdAt: context.now(),
        updatedAt: context.now(),
      },
      error: TOOL_REPAIR_CONTENT,
      repairReason: "missing_provider_tool_result",
    });
    context.emit(
      "tool.repaired",
      {
        providerCallId: call.id,
        toolId: call.toolId,
        status: "repaired",
        resultStatus: "interrupted",
        repairReason: "missing_provider_tool_result",
        content: TOOL_REPAIR_CONTENT,
      },
      { agentId: context.agentId, nodeId: context.nodeId },
    );
    repairedMessages.push({
      role: "tool",
      toolCallId: call.id,
      toolName: call.toolId,
      content: TOOL_REPAIR_CONTENT,
    });
  }
  context.replaceMessages?.(repairedMessages);
  return repairedMessages;
}

export function createDanglingToolCallRepairMiddleware(): RuntimeMiddleware {
  return {
    name: "dangling_tool_call_repair",
    priority: -100,
    async wrapModelCall(request, context, next) {
      const repairedMessages = repairDanglingProviderToolCalls(
        request.messages,
        context,
      );
      const nextRequest = repairedMessages === request.messages
        ? request
        : { ...request, messages: repairedMessages };
      return next(nextRequest);
    },
  };
}

export function createContextCompactionMiddleware(): RuntimeMiddleware {
  return {
    name: "context_compaction",
    priority: -50,
    async wrapModelCall(request, context, next, metadata) {
      const compaction = metadata.compaction;
      const messages = request.messages;
      if (!compaction || !messages?.length) {
        return next(request);
      }

      const provider = resolveRunProviderConfig(context.config);
      const limit = resolveAutoCompactTokenLimit(provider);
      const contextWindow = resolvedContextWindow(provider);
      const usage = usageForModelResponse(compaction.latestResponse, {
        messages,
        system: request.system,
      });
      const eventContext = {
        agentId: context.agentId,
        nodeId: context.modelNodeId ?? context.nodeId,
      };
      context.emit(
        "context.usage.updated",
        {
          phase: "mid_turn",
          reason: compaction.reason,
          providerId: compaction.latestResponse.providerId,
          modelId: compaction.latestResponse.modelId,
          usage,
          limit,
          contextWindow,
        },
        eventContext,
      );
      if (!limit || usage.totalTokens < limit) {
        return next(request);
      }

      context.emit(
        "context.compaction.started",
        {
          phase: "mid_turn",
          implementation: "local",
          reason: "context_limit",
          beforeTokens: usage.totalTokens,
          limit,
          contextWindow,
        },
        eventContext,
      );
      const compactResponse = await invokeRunProvider(
        context.config,
        buildLocalCompactionRequest([...messages], limit),
      );
      const compacted = compactedContextFromSummary({
        summary: compactResponse.text,
        phase: "mid_turn",
        beforeTokens: usage.totalTokens,
        limit,
        contextWindow,
        compactedThroughTurnIndex: 0,
        now: context.now(),
      });
      context.replaceMessages?.(compacted.messages);
      context.emit(
        "context.compaction.completed",
        {
          phase: "mid_turn",
          implementation: "local",
          reason: "context_limit",
          beforeTokens: usage.totalTokens,
          afterTokens: compacted.contextState.activeTokenUsage.totalTokens,
          limit,
          contextWindow,
        },
        eventContext,
      );
      return next({ ...request, messages: compacted.messages });
    },
  };
}

export function createClarificationToolMiddleware(): RuntimeMiddleware {
  return {
    name: "clarification_tool",
    priority: -25,
    async wrapToolExecution(request, context, next) {
      if (request.toolCall.tool !== "user.clarify") {
        return next(request);
      }
      const clarification = dynamicClarificationRequest(request, context);
      const existingAnswer = context.clarificationAnswer(clarification.key, clarification.id);
      if (existingAnswer === undefined) {
        recordRuntimeToolActionSucceeded({
          action: request.action,
          context: { agentId: context.agentId, nodeId: context.nodeId },
          deps: context.actionDeps(),
          toolCall: request.toolCall,
          output: {
            status: "clarification_requested",
            clarification,
          },
          toolCallRecord: request.toolCallRecord,
          now: context.now,
        });
        context.emitGateRequired({
          agentId: context.agentId,
          title: context.title,
          actionId: request.action.id,
          toolId: request.toolCall.tool,
          detail: clarification.question,
          iteration: request.iteration,
        });
        await context.ensureClarification(clarification);
      }
      return {
        output: {
          status: "clarification_answered",
          question: clarification.question,
          answer: await context.ensureClarification(clarification),
        },
      };
    },
  };
}

export function createToolRecoveryMiddleware(): RuntimeMiddleware {
  return {
    name: "tool_recovery",
    priority: 25,
    async wrapToolFailure(request, context, _next) {
      return context.recoverToolFailure(request);
    },
  };
}

export function createBatchClarificationResponseMiddleware(): RuntimeMiddleware {
  return {
    name: "batch_clarification_response",
    priority: -10,
    async wrapModelResponse(request, context, next) {
      const clarifyToolCalls = request.allNativeToolCalls.filter((tc) => tc.tool === "user.clarify");
      if (
        clarifyToolCalls.length <= 1 ||
        clarifyToolCalls.length !== request.allNativeToolCalls.length
      ) {
        return next(request);
      }

      const clarificationRequests = clarifyToolCalls.map((tc, index) => ({
        ...clarificationRequestFromToolCall(tc, {
          agentId: context.agentId,
          nodeId: context.modelNodeId ?? context.nodeId,
          nodeLabel: context.title,
          eventIndex: context.eventsLength() + index,
        }),
        toolCall: tc,
      }));
      const unanswered = clarificationRequests.filter(
        (req) => context.clarificationAnswer(req.key, req.id) === undefined,
      );

      if (unanswered.length > 0) {
        const { actionLedger } = context.actionDeps();
        const batchAction = actionLedger.propose({
          id: `${context.agentId}-tool-${context.eventsLength()}`,
          type: "user.clarify",
          riskLevel: "low",
          input: { batch: unanswered.map((r) => ({ key: r.key, question: r.question })) },
          agentId: context.agentId,
        });
        const batchToolCallRecord = context.appendToolCall({
          providerCallId: clarifyToolCalls[0]!.providerCallId,
          toolId: "user.clarify",
          args: { batch: unanswered.map((r) => r.question) },
          source: clarifyToolCalls[0]!.source,
          status: "proposed",
          actionId: batchAction.id,
          agentId: context.agentId,
          nodeId: context.nodeId,
        });
        context.emit(
          "action.updated",
          { actionId: batchAction.id, status: "proposed", record: batchAction },
          { agentId: context.agentId, nodeId: context.nodeId },
        );
        context.emitToolRequested({
          agentId: context.agentId,
          title: context.title,
          actionId: batchAction.id,
          toolId: "user.clarify",
          iteration: request.iteration,
        });
        context.emitToolRunning({
          agentId: context.agentId,
          title: context.title,
          actionId: batchAction.id,
          toolId: "user.clarify",
          iteration: request.iteration,
        });

        for (const req of unanswered) {
          recordRuntimeToolActionSucceeded({
            action: batchAction,
            context: { agentId: context.agentId, nodeId: context.nodeId },
            deps: context.actionDeps(),
            toolCall: req.toolCall,
            output: {
              status: "clarification_requested",
              clarification: req,
            },
            toolCallRecord: batchToolCallRecord,
            now: context.now,
          });
        }

        context.emitGateRequired({
          agentId: context.agentId,
          title: context.title,
          actionId: batchAction.id,
          toolId: "user.clarify",
          detail: `${unanswered.length} clarification questions pending`,
          iteration: request.iteration,
        });

        await context.ensureClarifications(
          unanswered.map((req) => ({
            id: req.id,
            key: req.key,
            nodeId: req.nodeId,
            nodeLabel: req.nodeLabel,
            question: req.question,
            options: req.options,
          })),
        );
      }

      const clarifyAnswers: Array<{
        call: RuntimeToolAttempt;
        req: { id: string; key: string; question: string };
        answer: unknown;
      }> = [];
      for (const req of clarificationRequests) {
        const answer = await context.ensureClarification({
          id: req.id,
          key: req.key,
          nodeId: req.nodeId,
          nodeLabel: req.nodeLabel,
          question: req.question,
          options: req.options,
        });
        clarifyAnswers.push({ call: req.toolCall, req, answer });
      }

      const nextMessages = [...request.messages];
      if (request.selectedToolCall.source === "provider_native" && request.selectedToolCall.providerCallId) {
        nextMessages.push({
          role: "assistant",
          content: request.response.text,
          reasoningContent: request.response.reasoningContent,
          toolCalls: request.response.toolCalls?.filter(
            (call) => clarifyToolCalls.some((tc) => tc.providerCallId === call.id),
          ),
        });
      }

      for (const { call: tc, req, answer } of clarifyAnswers) {
        const resultText = JSON.stringify({
          status: "clarification_answered",
          question: req.question,
          answer,
        });

        if (tc.source === "provider_native" && tc.providerCallId) {
          nextMessages.push({
            role: "tool",
            toolCallId: tc.providerCallId,
            toolName: tc.tool,
            content: resultText,
          });
        } else {
          nextMessages.push({
            role: "user",
            content: `Workspace tool result for ${tc.tool}:\n${resultText}`,
          });
        }

        context.emitToolResultObserved({
          agentId: context.agentId,
          title: context.title,
          toolId: tc.tool,
          iteration: request.iteration,
        });
      }

      await context.emitProgressNarration({
        trigger: "tool.succeeded",
        agentId: context.agentId,
        nodeId: context.nodeId,
        title: context.title,
        detail: `${clarifyAnswers.length} clarification(s) answered.`,
      });

      context.replaceMessages?.(nextMessages);
      context.completion.markToolResultObserved(request.selectedToolCall, false, {
        agentId: context.agentId,
        nodeId: context.modelNodeId ?? context.nodeId,
      });

      if (context.completion.forcedFinalIsActive({
        agentId: context.agentId,
        nodeId: context.modelNodeId ?? context.nodeId,
      })) {
        const stopReason = context.completion.stopReasonForScope({
          agentId: context.agentId,
          nodeId: context.modelNodeId ?? context.nodeId,
        }) ?? "forced_final_answer";
        context.emitForcedFinal({
          agentId: context.agentId,
          title: context.title,
          reason: stopReason,
          iteration: request.iteration,
        });
        return {
          kind: "handled_return",
          response: await context.runForcedFinalProviderCall({
            messages: nextMessages,
            reason: stopReason,
            nativeTools: request.nativeTools,
          }),
        };
      }

      context.emitModelRequest({
        agentId: context.agentId,
        title: context.title,
        iteration: request.iteration + 1,
      });
      return {
        kind: "handled_continue",
        response: await context.invokeFollowUpModel({
          messages: nextMessages,
          system: context.system,
          maxTokens: context.config.budget?.maxTokens,
          tools: request.nativeTools,
          toolChoice: request.nativeTools.length > 0 ? "auto" : undefined,
        }, request.response, "tool_follow_up"),
      };
    },
  };
}

export function buildRuntimeMiddlewares(): RuntimeMiddleware[] {
  return [
    createDanglingToolCallRepairMiddleware(),
    createContextCompactionMiddleware(),
    createBatchClarificationResponseMiddleware(),
    createClarificationToolMiddleware(),
    createToolRecoveryMiddleware(),
  ];
}
