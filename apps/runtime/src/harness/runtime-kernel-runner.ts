import {
  type CheckpointMeta,
  type ModeSpec,
  type OraEventEnvelope,
  ORA_ROOT_AGENT_ID,
  ORA_ROOT_AGENT_LABEL,
  type PatternDefinition,
  type RunConfig,
  type SkillRegistry,
  type StateSnapshot,
  type ToolRegistry,
  type UserTaskInput,
} from "@cemeworm/shared";
import type {
  ActionLedger,
  MemoryCaptureQueue,
  MemoryService,
  PlanService,
  TodoService,
} from "../capabilities.js";
import { executeModeSpec } from "../patterns/driver-registry.js";
import type { RuntimeCompletionMetadata } from "./runtime-output.js";
import {
  ApprovalInterruptError,
  ClarificationInterruptError,
  isApprovalInterruptError,
  isClarificationInterruptError,
} from "./runtime-interrupts.js";
import {
  INTENT_CLARIFICATION_ID,
  INTENT_CLARIFICATION_KEY,
  INTENT_CLARIFICATION_NODE_ID,
  INTENT_CLARIFICATION_NODE_LABEL,
  type IntentClarificationResult,
} from "./runtime-clarifications.js";
import { routeIntervention, classifyToolRisk } from "./causal-policy-router.js";
import type { KernelPatternExecutionContextAdapter } from "./runtime-pattern-context.js";
import {
  assertRunCanBecomeTerminal,
  TerminalStateIntegrityError,
  type TerminalStateAssertionInput,
} from "./runtime-completion-guards.js";

type KernelEmit = (
  type: OraEventEnvelope["type"],
  payload: unknown,
  extra?: Partial<OraEventEnvelope>,
) => OraEventEnvelope;

type KernelTopologyStatus = StateSnapshot["topology"]["nodes"][number]["status"];

type FinalSnapshotParams = {
  status: StateSnapshot["status"];
  input: UserTaskInput;
  config: RunConfig;
  modeSpec: ModeSpec;
  profiles: StateSnapshot["profiles"];
  memory: StateSnapshot["memory"];
  plan: StateSnapshot["plan"];
  todos: StateSnapshot["todos"];
  actions: StateSnapshot["actions"];
  conversation: StateSnapshot["conversation"];
  toolResults: StateSnapshot["toolResults"];
  checkpoint: CheckpointMeta;
  previousContinuation?: StateSnapshot["continuation"];
  conversationCursor: number;
  output?: unknown;
  error?: string;
  updatedAt: number;
};

type KernelPlanReader = Pick<PlanService, "list">;
type KernelPlanLifecycleStore = Pick<PlanService, "list" | "setStatus" | "attachCheckpoint">;
type KernelTodoReader = Pick<TodoService, "list">;
type KernelTodoStatusStore = Pick<TodoService, "list" | "setStatus">;
type KernelActionReader = Pick<ActionLedger, "list">;

interface KernelRuntimeContextForRunner {
  readonly topology: StateSnapshot["topology"];
  readonly busStats: StateSnapshot["busStats"];
  latestEventSeq(): number;
  updateQueueSummary(patch: Partial<StateSnapshot["queueSummary"]>): StateSnapshot["queueSummary"];
  eventCount(): number;
  latestNodeCheckpoint(params?: { agentId?: string; nodeId?: string }): StateSnapshot["continuation"]["frames"][number]["nodeCheckpoint"] | undefined;
  assembleFinalSnapshot(params: FinalSnapshotParams): StateSnapshot;
}

export interface KernelRunnerDeps {
  request: {
    input: UserTaskInput;
    config: RunConfig;
    options: {
      forkedFrom?: { runId: string; checkpointId: string; eventSeq: number };
      resumeContext?: { clarifications?: Record<string, unknown> };
      resumeState?: Pick<StateSnapshot, "conversation" | "toolResults" | "continuation">;
    };
  };
  runtime: {
    kernelRuntimeContext: KernelRuntimeContextForRunner;
    emit: KernelEmit;
  };
  start: {
    skills: SkillRegistry;
    tools: ToolRegistry;
    profiles: StateSnapshot["profiles"];
  };
  progress: {
    emitPlanUpdated: () => void;
    emitTodoUpdated: () => void;
  };
  topology: {
    setTopologyStatus: (agentId: string, status: KernelTopologyStatus) => void;
  };
  stores: {
    planService: KernelPlanLifecycleStore;
    todoService: KernelTodoStatusStore;
  };
  execution: {
    executeModeSpec: typeof executeModeSpec;
    kernelPatternExecutionContextAdapter: KernelPatternExecutionContextAdapter;
    resolvedModeSpec: ModeSpec;
    resolvedDefinition: PatternDefinition;
  };
  preflight: {
    clarificationAnswer: (key: string, fallbackId: string) => unknown;
    requestIntentClarificationQuestion: (prompt: string, config: RunConfig) => Promise<IntentClarificationResult | undefined>;
    ensureClarification: (params: {
      id: string;
      key: string;
      nodeId: string;
      nodeLabel: string;
      question: string;
      missingVariables?: string[];
      counterfactualRiskIfSkipped?: string;
      narrate?: boolean;
    }) => Promise<unknown>;
    rootTopology: { handoffTargetId?: string };
    emitOraObservation: (params: {
      phase: string;
      observedAgentId: string;
      observedNodeId: string;
      content: string;
    }) => void;
    agentLabel: (agentId: string) => string;
  };
  finalization: {
    inferCompletionStopReason: (value: unknown) => void;
    modeProgressFinalizationError: (
      planItems: ReturnType<KernelPlanReader["list"]>,
      todoItems: ReturnType<KernelTodoReader["list"]>,
    ) => string | undefined;
    outputWithCompletionMetadata: (value: unknown, metadata: RuntimeCompletionMetadata) => unknown;
    completionMetadata: () => RuntimeCompletionMetadata;
    finalizeAsOra: (modeOutput: unknown) => Promise<unknown>;
    incompleteForcedFinalError: (value: unknown, metadata: RuntimeCompletionMetadata) => string | undefined;
    /**
     * Assembles the terminal-state assertion input from the current kernel state.
     * Called before emitting run.done to ensure no unresolved runtime work exists.
     */
    assertTerminalState: () => TerminalStateAssertionInput;
  };
  memory: {
    memoryCaptureQueue: MemoryCaptureQueue;
    memoryService: MemoryService;
  };
  checkpoint: {
    runId: string;
    checkpointLabelForStatus: (status: StateSnapshot["status"]) => string;
    now: () => number;
    actionLedger: KernelActionReader;
  };
}

export function createKernelRunnerDeps(deps: KernelRunnerDeps): KernelRunnerDeps {
  return deps;
}

export class KernelRunner {
  private status: StateSnapshot["status"] = "succeeded";
  private output: unknown;
  private error: string | undefined;
  private terminalEmitted = false;

  constructor(private readonly deps: KernelRunnerDeps) {}

  async run(): Promise<StateSnapshot> {
    try {
      this.emitStartEvents();
      await this.executeMode();
      this.flushMemory();
      return this.checkpoint();
    } finally {
      if (!this.terminalEmitted) {
        this.status = "failed";
        this.error = "Run terminated without a terminal event (structural guarantee).";
        this.deps.runtime.emit("run.failed", {
          status: this.status,
          error: this.error,
        });
      }
    }
  }

  private emitStartEvents(): void {
    const {
      input,
      config,
      options,
    } = this.deps.request;
    const {
      kernelRuntimeContext,
      emit,
    } = this.deps.runtime;
    const {
      skills,
      tools,
      profiles,
    } = this.deps.start;
    const {
      emitPlanUpdated,
      emitTodoUpdated,
    } = this.deps.progress;

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

    // Record initial causal decision at run start
    const initialDecision = routeIntervention({
      surfaceRequest: input.prompt,
      taskState: undefined,
      proposedToolId: undefined,
      proposedToolRisk: "low",
      toolCallCount: 0,
      clarificationCount: 0,
      hasPendingApprovals: false,
      hasPendingPlanDecisions: false,
      hasUnresolvedPlanItems: false,
      modelResponseText: "",
    });
    emit("causal.decision.recorded", initialDecision.decisionRecord);
  }

  private async executeMode(): Promise<void> {
    const {
      input,
      config,
    } = this.deps.request;
    const {
      executeModeSpec: execute,
      kernelPatternExecutionContextAdapter,
      resolvedModeSpec,
      resolvedDefinition,
    } = this.deps.execution;

    try {
      await this.preflight();
      const result = await execute({
        context: kernelPatternExecutionContextAdapter.create(),
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
      input,
      config,
      options,
    } = this.deps.request;
    const {
      kernelRuntimeContext,
      emit,
    } = this.deps.runtime;
    const {
      clarificationAnswer,
      requestIntentClarificationQuestion,
      ensureClarification,
      rootTopology,
      emitOraObservation,
      agentLabel,
    } = this.deps.preflight;
    const { resolvedModeSpec } = this.deps.execution;
    const { setTopologyStatus } = this.deps.topology;

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
      // Record causal decision after clarification resume
      const resumeDecision = routeIntervention({
        surfaceRequest: input.prompt,
        taskState: {
          surfaceRequest: input.prompt,
          selectedLatentGoal: "",
          keyUncertainties: [],
          confidence: 0.6,
        },
        proposedToolId: undefined,
        proposedToolRisk: "low",
        toolCallCount: 0,
        clarificationCount: 1,
        hasPendingApprovals: false,
        hasPendingPlanDecisions: false,
        hasUnresolvedPlanItems: false,
        modelResponseText: "",
      });
      emit("causal.decision.recorded", resumeDecision.decisionRecord);
    }
    const intentClarificationResult = shouldRunClarificationPreflight
      ? await requestIntentClarificationQuestion(input.prompt, config)
      : undefined;
    if (intentClarificationResult) {
      await ensureClarification({
        id: INTENT_CLARIFICATION_ID,
        key: INTENT_CLARIFICATION_KEY,
        nodeId: INTENT_CLARIFICATION_NODE_ID,
        nodeLabel: INTENT_CLARIFICATION_NODE_LABEL,
        question: intentClarificationResult.question,
        missingVariables: intentClarificationResult.missingVariables,
        counterfactualRiskIfSkipped: intentClarificationResult.counterfactualRiskIfSkipped,
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
      outputWithCompletionMetadata,
      completionMetadata,
      finalizeAsOra,
      incompleteForcedFinalError,
    } = this.deps.finalization;
    const { emit } = this.deps.runtime;
    const { planService, todoService } = this.deps.stores;

    inferCompletionStopReason(modeOutput);
    const modeProgressError = modeProgressFinalizationError(planService.list(), todoService.list());
    if (modeProgressError) {
      this.status = "failed";
      this.error = modeProgressError;
      this.output = outputWithCompletionMetadata({
        text: modeProgressError,
        modeOutput,
      }, completionMetadata());
      this.terminalEmitted = true;
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
      this.terminalEmitted = true;
      emit("run.failed", {
        status: this.status,
        error: this.error,
        output: this.output,
        stopReason: completionMetadata().stopReason,
        completion: completionMetadata(),
      });
      return;
    }

    // Shared terminal-state integrity gate: refuse to emit run.done if any
    // unresolved approvals, clarifications, tool calls, actions, or
    // continuation frames remain.
    const { assertTerminalState } = this.deps.finalization;
    if (assertTerminalState) {
      try {
        assertRunCanBecomeTerminal(assertTerminalState());
      } catch (caught) {
        if (caught instanceof TerminalStateIntegrityError) {
          const meta = completionMetadata();
          this.status = "failed";
          this.error = caught.message;
          this.output = outputWithCompletionMetadata({
            text: caught.message,
            modeOutput: this.output,
            violations: caught.violations,
          }, meta);
          this.terminalEmitted = true;
          emit("run.failed", {
            status: this.status,
            error: this.error,
            output: this.output,
            stopReason: meta.stopReason,
            completion: meta,
          });
          return;
        }
        throw caught;
      }
    }

    this.terminalEmitted = true;
    emit("run.done", {
      status: "succeeded",
      output: this.output,
      stopReason: completionMetadata().stopReason,
      completion: completionMetadata(),
    });
  }

  private handleModeError(caught: unknown): void {
    const { kernelRuntimeContext, emit } = this.deps.runtime;
    const { setTopologyStatus } = this.deps.topology;
    const {
      emitPlanUpdated,
      emitTodoUpdated,
    } = this.deps.progress;
    const {
      planService,
      todoService,
    } = this.deps.stores;

    this.error = caught instanceof Error ? caught.message : String(caught);
    this.status =
      isClarificationInterruptError(caught) ||
      isApprovalInterruptError(caught)
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
    this.terminalEmitted = true;
    emit(this.status === "interrupted" ? "run.interrupted" : "run.failed", {
      error: this.error,
      status: this.status,
      reason:
        isClarificationInterruptError(caught)
          ? "clarification_required"
          : isApprovalInterruptError(caught)
            ? "approval_required"
            : undefined,
      clarificationId:
        isClarificationInterruptError(caught) && caught.clarifications.length === 1
          ? caught.clarification.id
          : undefined,
      clarificationIds:
        isClarificationInterruptError(caught)
          ? caught.clarifications.map((c) => c.id)
          : undefined,
      actionId:
        isApprovalInterruptError(caught) ? caught.actionId : undefined,
    });
  }

  private flushMemory(): void {
    const { memoryCaptureQueue, memoryService } = this.deps.memory;
    const { emit } = this.deps.runtime;

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
      input,
      config,
      options,
    } = this.deps.request;
    const {
      kernelRuntimeContext,
      emit,
    } = this.deps.runtime;
    const {
      runId,
      checkpointLabelForStatus,
      now,
      actionLedger,
    } = this.deps.checkpoint;
    const { profiles } = this.deps.start;
    const { planService, todoService } = this.deps.stores;
    const { memoryService } = this.deps.memory;
    const { resolvedModeSpec } = this.deps.execution;

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

function selectedModeProgressText(modeSpec: ModeSpec, checkingRequest: boolean): string {
  const label = modeSpec.id === "single_agent" ? "单智能体模式" : `${modeSpec.label} 模式`;
  return checkingRequest
    ? `已选择${label}，我准备好了`
    : `已选择${label}，正在准备执行`;
}
