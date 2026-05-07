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
      resumeSnapshot: params.resumeSnapshot ?? params.snapshot,
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
    const resumedSnapshot = await this.executePreparedResume({
      snapshot: params.continuationSnapshot,
      conversationMessages: [
        ...this.resumeConversationMessages(
          params.continuationSnapshot,
          params.clarificationPatch,
          params.originalSnapshot.runId,
        ),
        ...runtimeConversationToModelMessages(params.continuationSnapshot.conversation),
      ],
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
