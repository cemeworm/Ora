import type {
  OraEventEnvelope,
  OraToolCallEnvelope,
  RunConfig,
} from "@cemeworm/shared";
import { invokeRunProvider, invokeRunProviderStream } from "../providers/index.js";
import type { ModelMessage, ModelRequest, ModelResponse } from "../providers/index.js";
import type { RuntimeCompletionController, RuntimeToolScope } from "./runtime-completion.js";
import type { RuntimeActionDeps } from "./runtime-action-runner.js";
import {
  recordRuntimeToolActionSucceeded,
  resolveRuntimeActionApproval,
  transitionRuntimeAction,
} from "./runtime-action-runner.js";
import { ApprovalInterruptError, ClarificationInterruptError } from "./runtime-interrupts.js";
import type { NodeLoopController } from "./node-loop-transitions.js";
import type { NodeRuntimeLoopState } from "./node-runtime-loop.js";
import type {
  RuntimeToolExecutionRequest,
  RuntimeToolExecutionResult,
  RuntimeToolFailureHandler,
  RuntimeToolFailureResult,
} from "./runtime-middleware.js";
import {
  proposeRuntimeToolAction,
} from "./runtime-tool-action-proposal.js";
import { planListUpdatedPayload } from "./runtime-plan-list-state.js";
import type {
  RuntimeToolAttempt,
} from "./runtime-tool-loop.js";
import type {
  RuntimeToolExecutor,
} from "./runtime-tool-executor.js";
import type { AppendRuntimeToolCallParams } from "./runtime-tool-ledger.js";

type RuntimeToolCallTurnResult =
  | { kind: "continue"; response: ModelResponse }
  | { kind: "return"; response: ModelResponse }
  | { kind: "retry" }
  | { kind: "throw"; error: unknown };

interface RuntimeToolCallServiceDeps {
  agentId: string;
  nodeId: string;
  title: string;
  inputPrompt: string;
  system: string;
  config: RunConfig;
  nativeTools: ReturnType<RuntimeToolExecutor["toolDefinitions"]>;
  streamCallbacks?: Parameters<typeof invokeRunProviderStream>[2];
  invokeProvider: typeof invokeRunProvider | typeof invokeRunProviderStream;
  completion: RuntimeCompletionController;
  completionScope: RuntimeToolScope;
  nodeLoopController: NodeLoopController;
  runtimeToolExecutor: RuntimeToolExecutor;
  actionDeps: () => RuntimeActionDeps;
  actionLedger: RuntimeActionDeps["actionLedger"];
  activePlanStepId: () => string | undefined;
  now: () => number;
  eventsLength: () => number;
  appendToolCall: (params: AppendRuntimeToolCallParams) => OraToolCallEnvelope;
  getMessages: () => ModelMessage[];
  replaceMessages: (messages: ModelMessage[]) => void;
  emit: (
    type: OraEventEnvelope["type"],
    payload: unknown,
    extra?: Partial<OraEventEnvelope>,
  ) => OraEventEnvelope;
  emitProgressNarration: (params: {
    trigger: string;
    agentId?: string;
    nodeId?: string;
    title?: string;
    detail?: string;
  }) => Promise<void>;
  runForcedFinalProviderCall: (params: {
    invokeProvider: typeof invokeRunProvider | typeof invokeRunProviderStream;
    config: RunConfig;
    messages: ModelMessage[];
    system: string;
    nativeTools: ReturnType<RuntimeToolExecutor["toolDefinitions"]>;
    streamCallbacks?: Parameters<typeof invokeRunProviderStream>[2];
    reason: Parameters<RuntimeCompletionController["forceFinalAnswer"]>[0];
    agentId?: string;
    nodeId?: string;
    title?: string;
    emitNodeRuntimeState?: (state: NodeRuntimeLoopState, params: {
      agentId: string;
      title?: string;
      actionId?: string;
      reason?: string;
      detail?: string;
      toolId?: string;
      iteration?: number;
    }) => void;
  }) => Promise<ModelResponse>;
  emitForcedFinalProviderState: (state: NodeRuntimeLoopState, params: {
    agentId: string;
    title?: string;
    actionId?: string;
    reason?: string;
    detail?: string;
    toolId?: string;
    iteration?: number;
  }) => void;
  invokeFollowUpModel: (
    request: ModelRequest,
    latestResponse: ModelResponse,
    reason: string,
  ) => Promise<ModelResponse>;
  invokeToolExecution: (
    request: RuntimeToolExecutionRequest,
  ) => Promise<RuntimeToolExecutionResult>;
  invokeToolFailure: RuntimeToolFailureHandler;
}

export class RuntimeToolCallService {
  constructor(private readonly deps: RuntimeToolCallServiceDeps) {}

  async runToolTurn(params: {
    toolCall: RuntimeToolAttempt;
    response: ModelResponse;
    iteration: number;
  }): Promise<RuntimeToolCallTurnResult> {
    const { toolCall, response, iteration } = params;
    const { action, toolCallRecord } = proposeRuntimeToolAction({
      agentId: this.deps.agentId,
      inputPrompt: this.deps.inputPrompt,
      eventCount: this.deps.eventsLength(),
      planStepId: this.deps.activePlanStepId(),
      toolCall,
      runtimeToolExecutor: this.deps.runtimeToolExecutor,
      actionLedger: this.deps.actionLedger,
      appendToolCall: this.deps.appendToolCall,
      emit: this.deps.emit,
    });

    const { approvedForRiskyExecution } = await resolveRuntimeActionApproval({
      action,
      context: {
        agentId: this.deps.agentId,
        nodeId: this.deps.agentId,
        title: this.deps.title,
      },
      deps: this.deps.actionDeps(),
      toolCallRecord,
    }).catch((error) => {
      if (error instanceof ApprovalInterruptError) {
        this.deps.nodeLoopController.emitGateRequired({
          agentId: this.deps.agentId,
          title: this.deps.title,
          actionId: action.id,
          toolId: toolCall.tool,
          detail: error.message,
          iteration,
        });
      }
      throw error;
    });

    transitionRuntimeAction({
      action,
      status: "running",
      context: { agentId: this.deps.agentId, nodeId: this.deps.agentId },
      deps: this.deps.actionDeps(),
      toolCallRecord,
    });
    this.deps.nodeLoopController.emitTransitionResult("tool_request", "tool_running", {
      agentId: this.deps.agentId,
      title: this.deps.title,
      actionId: action.id,
      toolId: toolCall.tool,
      iteration,
    });

    try {
      const execution = await this.deps.invokeToolExecution({
        action,
        toolCall,
        toolCallRecord,
        allowRisky: approvedForRiskyExecution,
        iteration,
      });
      this.deps.completion.markToolResultObserved(toolCall, execution.cacheHit ?? false, this.deps.completionScope);
      const { resultText } = recordRuntimeToolActionSucceeded({
        action,
        context: { agentId: this.deps.agentId, nodeId: this.deps.agentId },
        deps: this.deps.actionDeps(),
        toolCall,
        output: execution.output,
        fileChange: execution.fileChange,
        artifactIds: execution.artifact ? [execution.artifact.id] : undefined,
        cacheHit: execution.cacheHit,
        toolCallRecord,
        now: this.deps.now,
      });
      this.deps.nodeLoopController.emitTransitionResult("tool_result", "tool_result_observed", {
        agentId: this.deps.agentId,
        title: this.deps.title,
        actionId: action.id,
        toolId: toolCall.tool,
        iteration,
      });
      await this.deps.emitProgressNarration({
        trigger: "tool.succeeded",
        agentId: this.deps.agentId,
        nodeId: this.deps.agentId,
        title: this.deps.title,
        detail: `${toolCall.tool} returned a result.`,
      });
      if (toolCall.tool === "plan.update") {
        this.deps.actionDeps().emit("plan_list.updated", planListUpdatedPayload(toolCall.args));
      }

      this.deps.replaceMessages(
        toolCall.source === "provider_native" && toolCall.providerCallId
          ? [
              ...this.deps.getMessages(),
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
              ...this.deps.getMessages(),
              { role: "assistant", content: response.text },
              {
                role: "user",
                content: `Workspace tool result for ${toolCall.tool}:\n${resultText}`,
              },
            ],
      );
      if (this.deps.completion.forcedFinalIsActive(this.deps.completionScope)) {
        const stopReason = this.deps.completion.stopReasonForScope(this.deps.completionScope) ?? "forced_final_answer";
        this.deps.nodeLoopController.emitForcedFinal({
          agentId: this.deps.agentId,
          title: this.deps.title,
          toolId: toolCall.tool,
          reason: stopReason,
          iteration,
        });
        return {
          kind: "return",
          response: await this.runForcedFinal(stopReason),
        };
      }
      this.deps.nodeLoopController.emitTransitionResult("model_request", "running_model", {
        agentId: this.deps.agentId,
        title: this.deps.title,
        iteration: iteration + 1,
      });
      return {
        kind: "continue",
        response: await this.deps.invokeFollowUpModel({
          messages: this.deps.getMessages(),
          system: this.deps.system,
          maxTokens: this.deps.config.budget?.maxTokens,
          tools: this.deps.nativeTools,
          toolChoice: this.deps.nativeTools.length > 0 ? "auto" : undefined,
        }, response, "tool_follow_up"),
      };
    } catch (error) {
      if (error instanceof ClarificationInterruptError) {
        throw error;
      }
      const failureResult: RuntimeToolFailureResult = await this.deps.invokeToolFailure({
        error,
        action,
        toolCall,
        toolCallRecord,
        allowRisky: approvedForRiskyExecution,
        iteration,
        response,
      });
      return failureResult;
    }
  }

  private runForcedFinal(reason: Parameters<RuntimeCompletionController["forceFinalAnswer"]>[0]) {
    return this.deps.runForcedFinalProviderCall({
      invokeProvider: this.deps.invokeProvider,
      config: this.deps.config,
      messages: this.deps.getMessages(),
      system: this.deps.system,
      nativeTools: this.deps.nativeTools,
      streamCallbacks: this.deps.streamCallbacks,
      reason,
      agentId: this.deps.agentId,
      nodeId: this.deps.nodeId,
      title: this.deps.title,
      emitNodeRuntimeState: this.deps.emitForcedFinalProviderState,
    });
  }
}
