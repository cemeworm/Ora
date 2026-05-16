import type {
  ArtifactRef,
  ModeSpec,
  OraEventEnvelope,
  RunConfig,
} from "@cemeworm/shared";
import { invokeRunProvider, invokeRunProviderStream } from "../providers/index.js";
import type { ModelMessage, ModelRequest, ModelResponse } from "../providers/index.js";
import {
  classifyRecoveryError,
  type RecoveryCoordinator,
  type RecoveryDecision,
  type RecoveryFailureSurface,
  type RecoveryIncident,
} from "./recovery-policy.js";
import type { RuntimeCompletionController, RuntimeToolScope } from "./runtime-completion.js";
import type { RuntimeActionDeps } from "./runtime-action-runner.js";
import {
  recordRuntimeToolActionFailed,
  recordRuntimeToolActionSucceeded,
  resolveRuntimeActionApproval,
  transitionRuntimeAction,
} from "./runtime-action-runner.js";
import { ApprovalInterruptError, isApprovalInterruptError } from "./runtime-interrupts.js";
import type { NodeLoopController } from "./node-loop-transitions.js";
import type {
  RuntimeToolFailureRequest,
  RuntimeToolFailureResult,
} from "./runtime-middleware.js";
import type { NodeRuntimeLoopState } from "./node-runtime-loop.js";
import {
  proposeRuntimeRecoveryToolAction,
} from "./runtime-tool-action-proposal.js";
import { registerRuntimeToolAttempt } from "./runtime-tool-attempt.js";
import type {
  RuntimeFileChangeMetadata,
  RuntimeToolCall,
  RuntimeToolExecutor,
} from "./runtime-tool-executor.js";

interface RuntimeToolRecoveryServiceDeps {
  agentId: string;
  nodeId: string;
  title: string;
  inputPrompt: string;
  system: string;
  config: RunConfig;
  modeSpec: ModeSpec;
  nativeTools: ReturnType<RuntimeToolExecutor["toolDefinitions"]>;
  streamCallbacks?: Parameters<typeof invokeRunProviderStream>[2];
  invokeProvider: typeof invokeRunProvider | typeof invokeRunProviderStream;
  completion: RuntimeCompletionController;
  completionScope: RuntimeToolScope;
  recoveryCoordinator: RecoveryCoordinator;
  nodeLoopController: NodeLoopController;
  runtimeToolExecutor: RuntimeToolExecutor;
  actionDeps: () => RuntimeActionDeps;
  actionLedger: RuntimeActionDeps["actionLedger"];
  now: () => number;
  eventsLength: () => number;
  getMessages: () => ModelMessage[];
  replaceMessages: (messages: ModelMessage[]) => void;
  emit: (
    type: OraEventEnvelope["type"],
    payload: unknown,
    extra?: Partial<OraEventEnvelope>,
  ) => OraEventEnvelope;
  emitRecoveryDecision: (
    incident: RecoveryIncident,
    decision: RecoveryDecision,
  ) => void;
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
  publishRecoveryArtifact: (
    incident: RecoveryIncident,
    decision: RecoveryDecision,
  ) => { id: string };
  publishFileChangeArtifact: (
    fileChange: RuntimeFileChangeMetadata,
    context: { agentId?: string; nodeId?: string; actionId?: string },
  ) => ArtifactRef;
  sleep: (ms: number) => Promise<void>;
}

export class RuntimeToolRecoveryService {
  constructor(private readonly deps: RuntimeToolRecoveryServiceDeps) {}

  async recoverToolFailure(
    failure: RuntimeToolFailureRequest,
  ): Promise<RuntimeToolFailureResult> {
    const { action, toolCall, toolCallRecord, error, iteration } = failure;
    if (isApprovalInterruptError(error)) {
      return {
        kind: "throw",
        error: error.actionId === action.id ? error : new ApprovalInterruptError(action.id),
      };
    }
    const detail = error instanceof Error ? error.message : String(error);
    const surface: RecoveryFailureSurface = failure.surface ?? "tool";
    const currentState = this.deps.nodeLoopController.state;
    if (currentState !== "tool_running") {
      const incident = classifyRecoveryError(error, {
        surface: surface === "tool" ? "unknown" : surface,
        nodeId: this.deps.agentId,
        agentId: this.deps.agentId,
        toolId: toolCall.tool,
        actionId: action.id,
        currentState,
        ownerActionId: action.id,
        ownerToolId: toolCall.tool,
      });
      this.emitMisroutedToolRecoveryDiagnostic(incident, iteration);
      return { kind: "throw", error };
    }
    recordRuntimeToolActionFailed({
      action,
      context: { agentId: this.deps.agentId, nodeId: this.deps.agentId },
      deps: this.deps.actionDeps(),
      toolCall,
      detail,
      toolCallRecord,
      now: this.deps.now,
    });
    this.deps.nodeLoopController.emitRecoveryState("degraded", {
      agentId: this.deps.agentId,
      title: this.deps.title,
      actionId: action.id,
      toolId: toolCall.tool,
      detail,
    });
    const incident = classifyRecoveryError(error, {
      surface,
      nodeId: this.deps.agentId,
      agentId: this.deps.agentId,
      toolId: toolCall.tool,
      actionId: action.id,
      currentState,
      ownerActionId: action.id,
      ownerToolId: toolCall.tool,
    });
    const recoveryDecision = this.deps.recoveryCoordinator.resolve(incident);
    this.deps.emitRecoveryDecision(incident, recoveryDecision);

    switch (recoveryDecision.action) {
      case "retry":
        await this.deps.sleep(recoveryDecision.retryDelayMs ?? 0);
        return { kind: "retry" };
      case "alternate_tool":
        if (recoveryDecision.alternateToolId) {
          return this.recoverWithAlternateTool(failure, recoveryDecision);
        }
        break;
      case "fallback_artifact":
        return this.recoverWithFallbackArtifact(failure, incident, recoveryDecision, detail);
    }
    return { kind: "throw", error };
  }

  private emitMisroutedToolRecoveryDiagnostic(
    incident: RecoveryIncident,
    iteration: number,
  ): void {
    this.deps.emit(
      "task.progress",
      {
        kind: "runtime_diagnostic",
        source: "tool_recovery_boundary",
        severity: "warning",
        title: this.deps.title,
        detail: "Tool recovery was invoked while the node loop was not running a tool.",
        surface: incident.surface ?? "unknown",
        currentState: incident.currentState,
        errorType: incident.errorType,
        error: incident.detail,
        actionId: incident.ownerActionId ?? incident.actionId,
        toolId: incident.ownerToolId ?? incident.toolId,
        ownerActionId: incident.ownerActionId ?? incident.actionId,
        ownerToolId: incident.ownerToolId ?? incident.toolId,
        iteration,
      },
      { agentId: this.deps.agentId, nodeId: this.deps.nodeId },
    );
  }

  private async recoverWithAlternateTool(
    failure: RuntimeToolFailureRequest,
    recoveryDecision: RecoveryDecision,
  ): Promise<RuntimeToolFailureResult> {
    const { toolCall, iteration } = failure;
    const alternateCall: RuntimeToolCall = {
      tool: recoveryDecision.alternateToolId as RuntimeToolCall["tool"],
      args: toolCall.args,
    };
    const alternateAttemptDecision = registerRuntimeToolAttempt({
      completion: this.deps.completion,
      toolCall: alternateCall,
      scope: this.deps.completionScope,
    });
    if (!alternateAttemptDecision.allowed) {
      if (this.deps.nodeLoopController.state === "degraded") {
        this.deps.nodeLoopController.emitRecoveryState("tool_requested", {
          agentId: this.deps.agentId,
          title: this.deps.title,
          toolId: alternateCall.tool,
          reason: alternateAttemptDecision.reason,
          iteration,
        });
      }
      this.deps.nodeLoopController.emitForcedFinal({
        agentId: this.deps.agentId,
        title: this.deps.title,
        toolId: alternateCall.tool,
        reason: alternateAttemptDecision.reason,
        iteration,
      });
      return {
        kind: "return",
        response: await this.runForcedFinal(alternateAttemptDecision.reason),
      };
    }
    const alternateAction = proposeRuntimeRecoveryToolAction({
      agentId: this.deps.agentId,
      inputPrompt: this.deps.inputPrompt,
      eventCount: this.deps.eventsLength(),
      toolCall: alternateCall,
      runtimeToolExecutor: this.deps.runtimeToolExecutor,
      actionLedger: this.deps.actionLedger,
      emit: this.deps.emit,
    });
    const alternateApproval = await resolveRuntimeActionApproval({
      action: alternateAction,
      context: {
        agentId: this.deps.agentId,
        nodeId: this.deps.agentId,
        title: this.deps.title,
      },
      deps: this.deps.actionDeps(),
    });
    transitionRuntimeAction({
      action: alternateAction,
      status: "running",
      context: { agentId: this.deps.agentId, nodeId: this.deps.agentId },
      deps: this.deps.actionDeps(),
    });
    if (this.deps.nodeLoopController.state === "degraded") {
      this.deps.nodeLoopController.emitRecoveryState("tool_requested", {
        agentId: this.deps.agentId,
        title: this.deps.title,
        actionId: alternateAction.id,
        toolId: alternateCall.tool,
        iteration,
      });
    }
    this.deps.nodeLoopController.emitTransitionResult("tool_request", "tool_running", {
      agentId: this.deps.agentId,
      title: this.deps.title,
      actionId: alternateAction.id,
      toolId: alternateCall.tool,
      iteration,
    });
    const alternateExecution = await this.deps.runtimeToolExecutor.executeWithMetadata(
      alternateCall,
      { allowRisky: alternateApproval.approvedForRiskyExecution },
    );
    const alternateArtifact = alternateExecution.fileChange
      ? this.deps.publishFileChangeArtifact(alternateExecution.fileChange, {
          actionId: alternateAction.id,
          agentId: this.deps.agentId,
          nodeId: this.deps.agentId,
        })
      : undefined;
    this.deps.completion.markToolResultObserved(alternateCall, false, this.deps.completionScope);
    const { resultText: alternateResultText } =
      recordRuntimeToolActionSucceeded({
        action: alternateAction,
        context: { agentId: this.deps.agentId, nodeId: this.deps.agentId },
        deps: this.deps.actionDeps(),
        toolCall: alternateCall,
        output: alternateExecution.output,
        fileChange: alternateExecution.fileChange,
        resultPreview: alternateExecution.resultPreview,
        artifactIds: alternateArtifact ? [alternateArtifact.id] : undefined,
        recoveredFrom: toolCall.tool,
        now: this.deps.now,
      });
    this.deps.nodeLoopController.emitTransitionResult("tool_result", "tool_result_observed", {
      agentId: this.deps.agentId,
      title: this.deps.title,
      actionId: alternateAction.id,
      toolId: alternateCall.tool,
      iteration,
    });
    this.deps.replaceMessages([
      ...this.deps.getMessages(),
      { role: "assistant", content: failure.response.text },
      {
        role: "user",
        content: `Workspace tool result for ${alternateCall.tool}:\n${alternateResultText}`,
      },
    ]);
    if (this.deps.completion.forcedFinalIsActive(this.deps.completionScope)) {
      const stopReason = this.deps.completion.stopReasonForScope(this.deps.completionScope) ?? "forced_final_answer";
      this.deps.nodeLoopController.emitForcedFinal({
        agentId: this.deps.agentId,
        title: this.deps.title,
        toolId: alternateCall.tool,
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
      }, failure.response, "tool_follow_up"),
    };
  }

  private async recoverWithFallbackArtifact(
    failure: RuntimeToolFailureRequest,
    incident: RecoveryIncident,
    recoveryDecision: RecoveryDecision,
    detail: string,
  ): Promise<RuntimeToolFailureResult> {
    const { toolCall, error } = failure;
    const recoveryArtifact = this.deps.publishRecoveryArtifact(
      incident,
      recoveryDecision,
    );
    const fallbackPrefix = this.deps.modeSpec.runtimeAtoms.includes(
      "tool_error_boundary",
    )
      ? "[tool-error-boundary]"
      : "[recovery:fallback]";
    this.deps.emit(
      "message.delta",
      {
        role: "assistant",
        content: `${fallbackPrefix} ${toolCall.tool} degraded after ${incident.errorType}: ${incident.detail}`,
        visibility: "internal",
        boundary: this.deps.modeSpec.runtimeAtoms.includes("recovery_policy")
          ? "recovery_policy"
          : "tool_error_boundary",
      },
      { agentId: this.deps.agentId, nodeId: this.deps.agentId },
    );
    const fallbackOutput = recoveryDecision.usableOutput ?? {
      degraded: true,
      recoveryArtifactId: recoveryArtifact.id,
      errorType: incident.errorType,
      error: incident.detail,
    };
    const degradedToolContent = `Workspace tool degraded for ${toolCall.tool}:\n${JSON.stringify(fallbackOutput, null, 2)}`;
    this.deps.replaceMessages(
      toolCall.source === "provider_native" && toolCall.providerCallId
        ? [
            ...this.deps.getMessages(),
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
            ...this.deps.getMessages(),
            { role: "assistant", content: failure.response.text },
            {
              role: "user",
              content: degradedToolContent,
            },
          ],
    );
    this.deps.nodeLoopController.emitRecoveryState("repairing", {
      agentId: this.deps.agentId,
      title: this.deps.title,
      toolId: toolCall.tool,
      detail: incident.detail,
    });
    if (/boundary violation/i.test(detail)) {
      return { kind: "throw", error };
    }
    this.deps.nodeLoopController.emitModelRequest({
      agentId: this.deps.agentId,
      title: this.deps.title,
      toolId: toolCall.tool,
      detail: incident.detail,
    });
    return {
      kind: "continue",
      response: await this.deps.invokeFollowUpModel({
        messages: this.deps.getMessages(),
        system: this.deps.system,
        maxTokens: this.deps.config.budget?.maxTokens,
        tools: this.deps.nativeTools,
        toolChoice: this.deps.nativeTools.length > 0 ? "auto" : undefined,
      }, failure.response, "tool_recovery_follow_up"),
    };
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
