import type {
  ArtifactRef,
  CompletionStopReason,
  ModeSpec,
  OraEventEnvelope,
  OraToolCallEnvelope,
  PendingClarificationOption,
  RunConfig,
} from "@cemeworm/shared";
import { invokeRunProvider, invokeRunProviderStream } from "../providers/index.js";
import type { ModelMessage, ModelResponse, ModelToolCall } from "../providers/index.js";
import {
  classifyRecoveryError,
  type RecoveryCoordinator,
  type RecoveryDecision,
  type RecoveryIncident,
} from "./recovery-policy.js";
import { RUNTIME_TOOL_LOOP_SAFETY_LIMIT, type RuntimeCompletionController } from "./runtime-completion.js";
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
  type RuntimeToolAttempt,
} from "./runtime-tool-loop.js";
import { RuntimeToolExecutor, type RuntimeFileChangeMetadata, type RuntimeToolCall } from "./runtime-tool-executor.js";
import type { AppendRuntimeToolCallParams } from "./runtime-tool-ledger.js";

const TOOL_REPAIR_CONTENT =
  "Tool call was interrupted before a result was produced. Continue from available context or choose another action.";

interface DynamicClarificationRequest {
  id: string;
  key: string;
  nodeId: string;
  nodeLabel: string;
  question: string;
  options: PendingClarificationOption[];
}

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
  inputPrompt: string;
  now: () => number;
  eventsLength: () => number;
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

function dynamicClarificationRequest(
  call: RuntimeToolAttempt,
  params: RunNodeRuntimeLoopParams,
  eventCount: number,
): DynamicClarificationRequest {
  const question = stringToolArg(call.args, "question");
  if (!question) {
    throw new Error("user.clarify requires a non-empty question.");
  }
  const fallbackKey = `dynamic_${params.agentId}_${eventCount}`;
  const key = sanitizeClarificationKey(stringToolArg(call.args, "key") ?? fallbackKey);
  return {
    id: `clarification:${params.agentId}:${eventCount}`,
    key,
    nodeId: params.nodeId,
    nodeLabel: params.title,
    question,
    options: parseClarificationOptions(call.args.options),
  };
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

    const allNativeToolCalls = (response.toolCalls
      ?.map(providerToolCallToAttempt)
      .filter(Boolean) as RuntimeToolAttempt[]) ?? [];

    if (allNativeToolCalls.length > 1) {
      const clarifyToolCalls = allNativeToolCalls.filter((tc) => tc.tool === "user.clarify");
      if (clarifyToolCalls.length > 1) {
        const clarificationRequests = clarifyToolCalls.map((tc, index) => {
          const question = stringToolArg(tc.args, "question");
          if (!question) {
            throw new Error("user.clarify requires a non-empty question.");
          }
          const fallbackKey = `dynamic_${params.agentId}_${events.length + index}`;
          const key = sanitizeClarificationKey(stringToolArg(tc.args, "key") ?? fallbackKey);
          return {
            id: `clarification:${params.agentId}:${events.length + index}`,
            key,
            nodeId: params.nodeId,
            nodeLabel: params.title,
            question,
            options: parseClarificationOptions(tc.args.options),
            toolCall: tc,
          };
        });

        const unanswered = clarificationRequests.filter(
          (req) => clarificationAnswer(req.key, req.id) === undefined,
        );

        if (unanswered.length > 0) {
          const batchAction = actionLedger.propose({
            id: `${params.agentId}-tool-${events.length}`,
            type: "user.clarify",
            riskLevel: "low",
            input: { batch: unanswered.map((r) => ({ key: r.key, question: r.question })) },
            agentId: params.agentId,
          });
          const batchToolCallRecord = appendToolCall({
            providerCallId: clarifyToolCalls[0]!.providerCallId,
            toolId: "user.clarify",
            args: { batch: unanswered.map((r) => r.question) },
            source: clarifyToolCalls[0]!.source,
            status: "proposed",
            actionId: batchAction.id,
            agentId: params.agentId,
            nodeId: params.agentId,
          });
          emit(
            "action.updated",
            { actionId: batchAction.id, status: "proposed", record: batchAction },
            { agentId: params.agentId, nodeId: params.agentId },
          );
          emitNodeRuntimeState("tool_running", {
            agentId: params.agentId,
            title: params.title,
            actionId: batchAction.id,
            toolId: "user.clarify",
            iteration,
          });

          for (const req of unanswered) {
            recordRuntimeToolActionSucceeded({
              action: batchAction,
              context: { agentId: params.agentId, nodeId: params.agentId },
              deps: actionDeps(),
              toolCall: req.toolCall,
              output: {
                status: "clarification_requested",
                clarification: req,
              },
              toolCallRecord: batchToolCallRecord,
              now,
            });
          }

          emitNodeRuntimeState("interrupted", {
            agentId: params.agentId,
            title: params.title,
            actionId: batchAction.id,
            toolId: "user.clarify",
            detail: `${unanswered.length} clarification questions pending`,
            iteration,
          });

          await ensureClarifications(
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

        // On resume: all are answered. Build tool results for all clarify calls.
        const clarifyAnswers: Array<{
          call: RuntimeToolAttempt;
          req: { id: string; key: string; question: string };
          answer: unknown;
        }> = [];
        for (const req of clarificationRequests) {
          const answer = await ensureClarification({
            id: req.id,
            key: req.key,
            nodeId: req.nodeId,
            nodeLabel: req.nodeLabel,
            question: req.question,
            options: req.options,
          });
          clarifyAnswers.push({ call: req.toolCall, req, answer });
        }

        if (toolCall.source === "provider_native" && toolCall.providerCallId) {
          messages = [
            ...messages,
            {
              role: "assistant",
              content: response.text,
              reasoningContent: response.reasoningContent,
              toolCalls: response.toolCalls?.filter(
                (call) => clarifyToolCalls.some((tc) => tc.providerCallId === call.id),
              ),
            },
          ];
        }

        for (const { call: tc, req, answer } of clarifyAnswers) {
          const resultText = JSON.stringify({
            status: "clarification_answered",
            question: req.question,
            answer,
          });

          if (tc.source === "provider_native" && tc.providerCallId) {
            messages.push({
              role: "tool",
              toolCallId: tc.providerCallId,
              toolName: tc.tool,
              content: resultText,
            });
          } else {
            messages.push({
              role: "user",
              content: `Workspace tool result for ${tc.tool}:\n${resultText}`,
            });
          }

          emitNodeRuntimeState("tool_result_observed", {
            agentId: params.agentId,
            title: params.title,
            toolId: tc.tool,
            iteration,
          });
        }

        await emitProgressNarration({
          trigger: "tool.succeeded",
          agentId: params.agentId,
          nodeId: params.agentId,
          title: params.title,
          detail: `${clarifyAnswers.length} clarification(s) answered.`,
        });

        messages = repairDanglingToolCalls(messages);

        completion.markToolResultObserved(toolCall, false, completionScope);

        if (completion.forcedFinalIsActive(completionScope)) {
          const stopReason = completion.stopReasonForScope(completionScope) ?? "forced_final_answer";
          emitNodeRuntimeState("finalizing", {
            agentId: params.agentId,
            title: params.title,
            reason: stopReason,
            iteration,
          });
          return runForcedFinalProviderCall({
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
      const clarificationRequest = toolCall.tool === "user.clarify"
        ? dynamicClarificationRequest(toolCall, params, events.length)
        : undefined;
      const existingClarificationAnswer = clarificationRequest
        ? clarificationAnswer(clarificationRequest.key, clarificationRequest.id)
        : undefined;
      if (clarificationRequest && existingClarificationAnswer === undefined) {
        recordRuntimeToolActionSucceeded({
          action,
          context: { agentId: params.agentId, nodeId: params.agentId },
          deps: actionDeps(),
          toolCall,
          output: {
            status: "clarification_requested",
            clarification: clarificationRequest,
          },
          toolCallRecord,
          now,
        });
        emitNodeRuntimeState("interrupted", {
          agentId: params.agentId,
          title: params.title,
          actionId: action.id,
          toolId: toolCall.tool,
          detail: clarificationRequest.question,
          iteration,
        });
        await ensureClarification(clarificationRequest);
      }
      const cacheKey = clarificationRequest ? undefined : cacheKeyForRuntimeTool(toolCall);
      const cacheHit =
        cacheKey !== undefined && runtimeToolResultCache.has(cacheKey);
      const execution = clarificationRequest
        ? {
            output: {
              status: "clarification_answered",
              question: clarificationRequest.question,
              answer: await ensureClarification(clarificationRequest),
            },
          }
        : cacheHit
          ? { output: runtimeToolResultCache.get(cacheKey) }
          : await runtimeToolExecutor.executeWithMetadata(toolCall, {
              allowRisky: approvedForRiskyExecution,
            });
      const output = execution.output;
      if (cacheKey && !cacheHit) {
        runtimeToolResultCache.set(cacheKey, output);
      }
      const artifact = execution.fileChange
        ? publishFileChangeArtifact(execution.fileChange, {
            actionId: action.id,
            agentId: params.agentId,
            nodeId: params.agentId,
          })
        : undefined;
      completion.markToolResultObserved(toolCall, cacheHit, completionScope);
      const { resultText } = recordRuntimeToolActionSucceeded({
        action,
        context: { agentId: params.agentId, nodeId: params.agentId },
        deps: actionDeps(),
        toolCall,
        output,
        fileChange: execution.fileChange,
        artifactIds: artifact ? [artifact.id] : undefined,
        cacheHit,
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
      if (error instanceof ClarificationInterruptError) {
        throw error;
      }
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
            { role: "assistant", content: response.text },
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
        const degradedToolContent = `Workspace tool degraded for ${toolCall.tool}:\n${JSON.stringify(fallbackOutput, null, 2)}`;
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
                  content: degradedToolContent,
                },
              ]
            : [
                ...messages,
                { role: "assistant", content: response.text },
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
}
