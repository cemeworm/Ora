import type {
  CustomAgentDetail,
  ModeSpec,
  OraEventEnvelope,
  PatternDefinition,
  RunConfig,
  StateSnapshot,
  UserTaskInput,
} from "@cemeworm/shared";
import { modeSpecToPatternDefinition, StateSnapshotSchema } from "@cemeworm/shared";
import type { RuntimeSkillRegistry } from "./harness/capability-registries.js";
import type {
  AutomationRegistryTools,
  ModeRegistryTools,
  SelfIterationRegistryTools,
} from "./harness/runtime-tool-executor.js";
import type { ModelMessage } from "./providers/index.js";
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

interface RunKernelExecutionServiceDeps {
  clock: () => number;
  skillRegistry: RuntimeSkillRegistry;
  modeRegistry: ModeRegistryTools;
  selfIterationRegistry: SelfIterationRegistryTools;
  automationRegistry: AutomationRegistryTools;
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
  forkedFrom?: { runId: string; checkpointId: string; eventSeq: number };
  streamProvider?: boolean;
  signal?: AbortSignal;
  onEvent?: (event: OraEventEnvelope) => void;
}

interface ExecutePreparedResumeParams {
  snapshot: StateSnapshot;
  clarificationPatch: Record<string, unknown>;
  approvedActionIds: string[];
  approvedActions: ApprovedResumeAction[];
  resumeSnapshot?: StateSnapshot;
  conversationMessages?: ModelMessage[];
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
    return this.executeRun({
      ...params,
      ...this.kernelDeps(params.config, params.modeSpec),
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
    const resumeSnapshot = params.resumeSnapshot ??
      suspendedFrameResumeSnapshot(params.snapshot) ??
      params.snapshot;
    return this.executeResume({
      runId: params.snapshot.runId,
      input: resumedInput,
      config: params.snapshot.config,
      modeSpec,
      definition: modeSpecToPatternDefinition(modeSpec),
      sessionId,
      turnIndex: params.snapshot.turnIndex,
      conversationMessages:
        params.conversationMessages ??
        this.deps.buildConversationMessages(sessionId, resumedInput.prompt, params.snapshot.runId),
      clarificationPatch: params.clarificationPatch,
      approvedActionIds: params.approvedActionIds,
      approvedActions: params.approvedActions,
      resumeSnapshot,
      signal: params.signal,
      onEvent: params.onEvent,
      ...this.kernelDeps(params.snapshot.config, modeSpec),
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
    signal?: AbortSignal;
    onEvent?: (event: OraEventEnvelope, baseSeq: number) => void;
  }): Promise<StateSnapshot> {
    const baseSeq = params.continuationSnapshot.events.length;
    // Locate the tool-result entries appended during the approved-tool
    // continuation so we can remind the model what was just executed.
    const approvedIdSet = new Set(params.approvedActionIds);
    const recentToolCalls = params.continuationSnapshot.toolCalls
      .filter((call) => call.actionId && approvedIdSet.has(call.actionId));
    const conversationEntries = params.continuationSnapshot.conversation;
    const conversationMessages = [
      ...this.resumeConversationMessages(
        params.continuationSnapshot,
        params.clarificationPatch,
        params.originalSnapshot.runId,
      ),
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
    signal?: AbortSignal;
    onEvent?: (event: OraEventEnvelope) => void;
  }): Promise<StateSnapshot> {
    return this.executePreparedResume({
      snapshot: params.snapshot,
      conversationMessages: [
        ...this.resumeConversationMessages(params.snapshot, params.clarificationPatch),
        ...runtimeConversationToModelMessages(params.snapshot.conversation),
      ],
      clarificationPatch: params.clarificationPatch,
      approvedActionIds: params.approvedActionIds,
      approvedActions: params.approvedActions,
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
      customAgentOverlay: this.deps.customAgentOverlay(config.customAgentId),
      customAgentOverlays: this.deps.customAgentOverlaysForMode(modeSpec),
      systemAgentOverlays: this.deps.systemAgentOverlaysForMode(modeSpec),
      customAgentContexts: this.deps.customAgentContextsForMode(modeSpec),
    };
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

function suspendedFrameResumeSnapshot(snapshot: StateSnapshot): StateSnapshot | undefined {
  const decision = classifyContinuationDispatch(snapshot);
  if (decision.kind === "diagnostic_failure") {
    throw new OraRuntimeError(decision.message, -32004, {
      runId: snapshot.runId,
      frameId: decision.frame.id,
      reason: decision.reason,
    });
  }
  if (decision.kind !== "resume_suspended_node" || decision.frame.status !== "paused") {
    return undefined;
  }
  return StateSnapshotSchema.parse(continuationFrameAwaitingModel(snapshot, decision.frame.id, snapshot.updatedAt));
}
