import type {
  CustomAgentDetail,
  ModeSpec,
  OraEventEnvelope,
  PatternDefinition,
  RunConfig,
  SessionContextState,
  StateSnapshot,
  UserTaskInput,
} from "@cemeworm/shared";
import {
  acceptedPlanExecutionContractFromMetadata,
  modeSpecToPatternDefinition,
  StateSnapshotSchema,
} from "@cemeworm/shared";
import type { RuntimeSkillRegistry } from "./harness/capability-registries.js";
import type {
  AutomationRegistryTools,
  ModeRegistryTools,
  SelfIterationRegistryTools,
  WidgetRegistryTools,
} from "./harness/runtime-tool-executor.js";
import type { ModelMessage } from "./providers/index.js";
import { TaskMemoryStore } from "./task-memory.js";
import {
  executeTracedKernelResume,
  executeTracedKernelRun,
} from "./run-kernel-lifecycle.js";
import {
  rebaseRunEvent,
  resumedInputWithClarifications,
  type ApprovedResumeAction,
} from "./run-orchestration.js";
import { runtimeConversationToModelMessages } from "./runtime-conversation.js";
import { OraRuntimeError } from "./runtime-errors.js";
import {
  classifyContinuationDispatch,
  continuationFrameAwaitingModel,
} from "./run-continuation-dispatcher.js";

function clarificationContextMessage(clarificationPatch: Record<string, unknown>): ModelMessage[] {
  const entries = Object.entries(clarificationPatch)
    .filter(([, value]) => value !== undefined && value !== null && String(value).trim().length > 0)
    .slice(0, 8)
    .map(([key, value]) => `- ${key}: ${String(value).trim().slice(0, 1000)}`);
  if (entries.length === 0) {
    return [];
  }
  return [{
    role: "user",
    content: [
      "User-supplied clarification context:",
      ...entries,
      "Treat these clarifications as explicit constraints for the current run. Do not ignore them or replace them with assumptions.",
    ].join("\n"),
  }];
}

interface RunKernelExecutionServiceDeps {
  clock: () => number;
  skillRegistry: RuntimeSkillRegistry;
  modeRegistry: ModeRegistryTools;
  selfIterationRegistry: SelfIterationRegistryTools;
  automationRegistry: AutomationRegistryTools;
  widgetRegistry: WidgetRegistryTools;
  customAgentOverlay: (customAgentId?: string) => string | undefined;
  customAgentOverlaysForMode: (modeSpec: ModeSpec) => Record<string, string>;
  systemAgentOverlaysForMode: (modeSpec: ModeSpec) => Record<string, string>;
  customAgentContextsForMode: (
    modeSpec: ModeSpec,
  ) => Record<string, Pick<CustomAgentDetail, "model" | "skillIds" | "toolIds"> & { overlay: string }>;
  buildConversationMessages: (
    sessionId: string,
    currentPrompt: string,
    excludeRunId?: string,
  ) => ModelMessage[];
  taskMemoryPersistenceDir: string;
}

interface ExecutePreparedRunParams {
  runId: string;
  input: UserTaskInput;
  config: RunConfig;
  modeSpec: ModeSpec;
  definition: PatternDefinition;
  sessionId: string;
  turnIndex: number;
  conversationMessages: ModelMessage[];
  sessionContextState?: SessionContextState;
  forkedFrom?: { runId: string; checkpointId: string; eventSeq: number };
  streamProvider?: boolean;
  signal?: AbortSignal;
  onEvent?: (event: OraEventEnvelope) => void;
  /** auto_review 自动批准时调用。RunStore 应在此写入 gate.resolved entries */
  onApprovalAutoResolved?: (actionIds: string[]) => void;
}

interface ExecutePreparedResumeParams {
  snapshot: StateSnapshot;
  clarificationPatch: Record<string, unknown>;
  approvedActionIds: string[];
  approvedActions: ApprovedResumeAction[];
  planDecisionResolutions?: Array<{ decisionId: string; status: "accepted" | "declined" }>;
  resumeSnapshot?: StateSnapshot;
  configOverride?: RunConfig;
  conversationMessages?: ModelMessage[];
  sessionContextState?: SessionContextState;
  signal?: AbortSignal;
  onEvent?: (event: OraEventEnvelope) => void;
}

export class RunKernelExecutionService {
  constructor(private readonly deps: RunKernelExecutionServiceDeps) {}

  executeRun(params: Parameters<typeof executeTracedKernelRun>[0]): Promise<StateSnapshot> {
    return executeTracedKernelRun(params);
  }

  executeResume(params: Parameters<typeof executeTracedKernelResume>[0]): Promise<StateSnapshot> {
    return executeTracedKernelResume(params);
  }

  executePreparedRun(params: ExecutePreparedRunParams): Promise<StateSnapshot> {
    const taskMemoryStore = this.createTaskMemoryStore();
    return this.executeRun({
      ...params,
      taskMemoryStore,
      ...this.kernelDeps(params.config, params.modeSpec),
    }).then((snapshot) => {
      this.discardTaskMemoryIfTerminal(taskMemoryStore, snapshot);
      return snapshot;
    });
  }

  executePreparedResume(params: ExecutePreparedResumeParams): Promise<StateSnapshot> {
    const modeSpec = params.snapshot.modeSpec;
    if (!modeSpec) {
      throw new OraRuntimeError("Cannot resume a kernel-backed run without modeSpec.", -32004, {
        runId: params.snapshot.runId,
      });
    }
    const sessionId = params.snapshot.sessionId;
    if (!sessionId) {
      throw new OraRuntimeError("Cannot resume a kernel-backed run without sessionId.", -32004, {
        runId: params.snapshot.runId,
      });
    }
    const resumedInput = resumedInputWithClarifications(params.snapshot.input, params.clarificationPatch);
    const config = params.configOverride ?? params.snapshot.config;
    const resumeSnapshot = params.resumeSnapshot ??
      (shouldResumeAcceptedPlanImplementationFromWholeRun(config, params.planDecisionResolutions)
        ? params.snapshot
        : suspendedFrameResumeSnapshot(params.snapshot) ?? params.snapshot);
    const taskMemoryStore = this.createTaskMemoryStore();
    return this.executeResume({
      runId: params.snapshot.runId,
      input: resumedInput,
      config,
      modeSpec,
      definition: modeSpecToPatternDefinition(modeSpec),
      sessionId,
      turnIndex: params.snapshot.turnIndex,
      conversationMessages:
        params.conversationMessages ??
        this.deps.buildConversationMessages(sessionId, resumedInput.prompt, params.snapshot.runId),
      sessionContextState: params.sessionContextState ?? resumeSnapshot.contextState ?? params.snapshot.contextState,
      clarificationPatch: params.clarificationPatch,
      approvedActionIds: params.approvedActionIds,
      approvedActions: params.approvedActions,
      planDecisionResolutions: params.planDecisionResolutions,
      resumeAlreadyAnnounced: params.snapshot.events.some((event) => event.type === "run.resumed"),
      resumeSnapshot,
      signal: params.signal,
      onEvent: params.onEvent,
      taskMemoryStore,
      ...this.kernelDeps(config, modeSpec),
    }).then((snapshot) => {
      this.discardTaskMemoryIfTerminal(taskMemoryStore, snapshot);
      return snapshot;
    });
  }

  resumeConversationMessages(
    snapshot: StateSnapshot,
    clarificationPatch: Record<string, unknown>,
    excludeRunId?: string,
  ): ModelMessage[] {
    const modeSpec = snapshot.modeSpec;
    if (!modeSpec) {
      throw new OraRuntimeError("Cannot resume a kernel-backed run without modeSpec.", -32004, {
        runId: snapshot.runId,
      });
    }
    const sessionId = snapshot.sessionId;
    if (!sessionId) {
      throw new OraRuntimeError("Cannot resume a kernel-backed run without sessionId.", -32004, {
        runId: snapshot.runId,
      });
    }
    const resumedInput = resumedInputWithClarifications(snapshot.input, clarificationPatch);
    return this.deps.buildConversationMessages(sessionId, resumedInput.prompt, excludeRunId ?? snapshot.runId);
  }

  async continueAfterApprovedTool(params: {
    originalSnapshot: StateSnapshot;
    continuationSnapshot: StateSnapshot;
    clarificationPatch: Record<string, unknown>;
    approvedActionIds: string[];
    continuationActionIds?: string[];
    signal?: AbortSignal;
    onEvent?: (event: OraEventEnvelope, baseSeq: number) => void;
  }): Promise<StateSnapshot> {
    const baseSeq = params.continuationSnapshot.events.length;
    // Locate the tool-result entries appended during the approved-tool
    // continuation so we can remind the model what was just executed.
    const recentActionIds = params.continuationActionIds?.length
      ? params.continuationActionIds
      : params.approvedActionIds;
    const approvedIdSet = new Set(recentActionIds);
    const recentToolCalls = params.continuationSnapshot.toolCalls
      .filter((call) => call.actionId && approvedIdSet.has(call.actionId));
    const conversationEntries = params.continuationSnapshot.conversation;
    const conversationMessages = [
      ...this.resumeConversationMessages(
        params.continuationSnapshot,
        params.clarificationPatch,
        params.originalSnapshot.runId,
      ),
      ...clarificationContextMessage(params.clarificationPatch),
      ...runtimeConversationToModelMessages(conversationEntries),
    ];
    // Prepend a carry-over context message so the model knows what tool(s)
    // were just executed and their outcomes before the kernel re-runs.
    // This prevents the model from re-proposing the same tool when the
    // guard follow-up message alone would not make the execution history
    // sufficiently explicit.
    if (recentToolCalls.length > 0) {
      conversationMessages.unshift({
        role: "user",
        content: [
          "[runtime] The user approved the pending tool action(s) and they have already been executed.",
          "Results summary:",
          ...recentToolCalls.map((call) =>
            `  - ${call.toolId}: ${call.status}${call.result?.error ? ` (error: ${call.result.error.slice(0, 300)})` : ""}`
          ),
          "Continue the task based on these results. Do not re-request the same tool unless the args need to change."
        ].join("\n"),
      });
    }
    const resumedSnapshot = await this.executePreparedResume({
      snapshot: params.continuationSnapshot,
      conversationMessages,
      clarificationPatch: params.clarificationPatch,
      approvedActionIds: params.approvedActionIds,
      approvedActions: [],
      signal: params.signal,
      onEvent: params.onEvent ? (event) => params.onEvent?.(event, baseSeq) : undefined,
    });
    return this.mergeResumeSnapshotEvents(params.continuationSnapshot, resumedSnapshot);
  }

  executeKernelResumeWork(params: {
    snapshot: StateSnapshot;
    clarificationPatch: Record<string, unknown>;
    approvedActionIds: string[];
    approvedActions: ApprovedResumeAction[];
    planDecisionResolutions?: Array<{ decisionId: string; status: "accepted" | "declined" }>;
    signal?: AbortSignal;
    onEvent?: (event: OraEventEnvelope) => void;
  }): Promise<StateSnapshot> {
    const resumeConfig = configForPlanDecisionResume(
      params.snapshot.config,
      params.snapshot.planDecisions,
      params.planDecisionResolutions ?? [],
    );
    return this.executePreparedResume({
      snapshot: params.snapshot,
      conversationMessages: [
        ...this.resumeConversationMessages(params.snapshot, params.clarificationPatch),
        ...planDecisionResumeMessages(
          params.snapshot.planDecisions,
          params.planDecisionResolutions ?? [],
        ),
        ...runtimeConversationToModelMessages(params.snapshot.conversation),
      ],
      clarificationPatch: params.clarificationPatch,
      approvedActionIds: params.approvedActionIds,
      approvedActions: params.approvedActions,
      planDecisionResolutions: params.planDecisionResolutions,
      configOverride: resumeConfig,
      signal: params.signal,
      onEvent: params.onEvent,
    });
  }

  private kernelDeps(config: RunConfig, modeSpec: ModeSpec) {
    return {
      clock: this.deps.clock,
      skillRegistry: this.deps.skillRegistry,
      modeRegistry: this.deps.modeRegistry,
      selfIterationRegistry: this.deps.selfIterationRegistry,
      automationRegistry: this.deps.automationRegistry,
      widgetRegistry: this.deps.widgetRegistry,
      customAgentOverlay: this.deps.customAgentOverlay(config.customAgentId),
      customAgentOverlays: this.deps.customAgentOverlaysForMode(modeSpec),
      systemAgentOverlays: this.deps.systemAgentOverlaysForMode(modeSpec),
      customAgentContexts: this.deps.customAgentContextsForMode(modeSpec),
    };
  }

  private createTaskMemoryStore(): TaskMemoryStore {
    return new TaskMemoryStore(this.deps.taskMemoryPersistenceDir);
  }

  private discardTaskMemoryIfTerminal(taskMemoryStore: TaskMemoryStore, snapshot: StateSnapshot): void {
    if (snapshot.status === "interrupted" || snapshot.status === "queued" || snapshot.status === "running") {
      return;
    }
    taskMemoryStore.discardRun(snapshot.runId);
  }

  private mergeResumeSnapshotEvents(baseSnapshot: StateSnapshot, resumedSnapshot: StateSnapshot): StateSnapshot {
    const rebasedEvents = resumedSnapshot.events.map((event) =>
      rebaseRunEvent(event, baseSnapshot.runId, baseSnapshot.events.length)
    );
    return StateSnapshotSchema.parse({
      ...resumedSnapshot,
      events: [...baseSnapshot.events, ...rebasedEvents],
    });
  }
}

function shouldResumeAcceptedPlanImplementationFromWholeRun(
  config: RunConfig,
  planDecisionResolutions: Array<{ decisionId: string; status: "accepted" | "declined" }> | undefined,
): boolean {
  return acceptedPlanExecutionContractFromMetadata(config.metadata) === "same_run_implementation"
    && (planDecisionResolutions ?? []).some((resolution) => resolution.status === "accepted");
}

/** Symbolic marker for diagnostic_failure errors, so upstream
 *  callers can identify them without matching on error messages. */
export const DIAGNOSTIC_FAILURE_SYMBOL: unique symbol = Symbol.for("ora.DiagnosticFailure");

function suspendedFrameResumeSnapshot(snapshot: StateSnapshot): StateSnapshot | undefined {
  const decision = classifyContinuationDispatch(snapshot);
  if (decision.kind === "diagnostic_failure") {
    throw Object.assign(
      new OraRuntimeError(decision.message, -32004, {
        runId: snapshot.runId,
        frameId: decision.frame.id,
        reason: decision.reason,
      }),
      { [DIAGNOSTIC_FAILURE_SYMBOL]: true as const },
    );
  }
  if (decision.kind !== "resume_suspended_node" || decision.frame.status !== "paused") {
    return undefined;
  }
  return StateSnapshotSchema.parse(continuationFrameAwaitingModel(snapshot, decision.frame.id, snapshot.updatedAt));
}

function planDecisionResumeMessages(
  decisions: StateSnapshot["planDecisions"],
  resolutions: Array<{ decisionId: string; status: "accepted" | "declined" }>,
): ModelMessage[] {
  return resolutions.flatMap<ModelMessage>((resolution) => {
    const decision = decisions.find((candidate) => candidate.id === resolution.decisionId);
    if (!decision?.planContent?.trim()) {
      return [];
    }
    if (resolution.status === "accepted") {
      return [{
        role: "system",
        content: [
          "The user accepted the implementation plan from this same run.",
          "Continue in the current run and implement the plan below.",
          "Use it as a handoff contract unless direct repository evidence requires a small adjustment.",
          "",
          `Accepted plan decision: ${decision.id}`,
          `Accepted plan source run: ${decision.runId}`,
          "",
          "<accepted_plan>",
          decision.planContent.trim(),
          "</accepted_plan>",
        ].join("\n"),
      }];
    }
    return [{
      role: "user",
      content: [
        "The user declined the previous plan from this same run.",
        "Revise the plan instead of implementing it.",
        "",
        "Previous proposed plan:",
        "<previous_plan>",
        decision.planContent.trim(),
        "</previous_plan>",
      ].join("\n"),
    }];
  });
}

function configForPlanDecisionResume(
  config: RunConfig,
  decisions: StateSnapshot["planDecisions"],
  resolutions: Array<{ decisionId: string; status: "accepted" | "declined" }>,
): RunConfig {
  const accepted = resolutions.some((resolution) =>
    resolution.status === "accepted" &&
    decisions.some((decision) => decision.id === resolution.decisionId),
  );
  if (!accepted) {
    return config;
  }
  return {
    ...config,
    metadata: {
      ...config.metadata,
      taskIntent: "implement",
      acceptedPlanExecutionContract: "same_run_implementation",
      acceptedPlanDecisionId: resolutions.find((resolution) => resolution.status === "accepted")?.decisionId,
      acceptedPlanRunId: decisions.find((decision) =>
        resolutions.some((resolution) => resolution.status === "accepted" && resolution.decisionId === decision.id),
      )?.runId,
    },
  };
}
