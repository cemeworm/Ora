import type {
  CustomAgentDetail,
  ModeSpec,
  OraEventEnvelope,
  PatternDefinition,
  RunConfig,
  SessionContextState,
  StateSnapshot,
  UserTaskInput
} from "@cemeworm/shared";
import { StateSnapshotSchema } from "@cemeworm/shared";
import type { RuntimeSkillRegistry } from "./harness/capability-registries.js";
import { type AutomationRegistryTools, type ModeRegistryTools, type SelfIterationRegistryTools, type WidgetRegistryTools } from "./harness/runtime-tool-executor.js";
import { executeRuntimeKernel, type RuntimeKernelOptions } from "./harness/runtime-kernel.js";
import type { ModelMessage } from "./providers/index.js";
import { withLangfuseRunTrace } from "./telemetry/langfuse.js";
import type { ApprovedResumeAction } from "./run-orchestration.js";
import type { TaskMemoryStore } from "./task-memory.js";

interface KernelLifecycleBaseParams {
  runId: string;
  input: UserTaskInput;
  config: RunConfig;
  modeSpec: ModeSpec;
  definition: PatternDefinition;
  sessionId: string;
  turnIndex?: number;
  clock?: () => number;
  skillRegistry?: RuntimeSkillRegistry;
  modeRegistry?: ModeRegistryTools;
  selfIterationRegistry?: SelfIterationRegistryTools;
  automationRegistry?: AutomationRegistryTools;
  widgetRegistry?: WidgetRegistryTools;
  customAgentOverlay?: string;
  customAgentOverlays?: Record<string, string>;
  systemAgentOverlays?: Record<string, string>;
  customAgentContexts?: Record<string, Pick<CustomAgentDetail, "model" | "skillIds" | "toolIds"> & { overlay: string }>;
  conversationMessages: ModelMessage[];
  sessionContextState?: SessionContextState;
  forkedFrom?: { runId: string; checkpointId: string; eventSeq: number };
  streamProvider?: boolean;
  onEvent?: (event: OraEventEnvelope) => void;
  /** auto_review 模式自动批准时调用，实现方应写入 gate.resolved ledger entries */
  onApprovalAutoResolved?: (actionIds: string[]) => void;
  taskMemoryStore?: TaskMemoryStore;
}

interface KernelResumeParams extends KernelLifecycleBaseParams {
  clarificationPatch: Record<string, unknown>;
  approvedActionIds: string[];
  approvedActions: ApprovedResumeAction[];
  planDecisionResolutions?: Array<{ decisionId: string; status: "accepted" | "declined" }>;
  resumeAlreadyAnnounced?: boolean;
  resumeSnapshot?: StateSnapshot;
}

interface CancellableKernelLifecycleParams {
  signal?: AbortSignal;
}

export async function executeTracedKernelRun(params: KernelLifecycleBaseParams & CancellableKernelLifecycleParams): Promise<StateSnapshot> {
  return withLangfuseRunTrace(
    { runId: params.runId, input: params.input, config: params.config },
    async () => {
      const { snapshot } = await executeRuntimeKernel(params.runId, params.input, params.config, kernelOptions(params));
      return sessionBoundSnapshot(snapshot, params.sessionId, params.turnIndex);
    },
  );
}

export async function executeTracedKernelResume(params: KernelResumeParams & CancellableKernelLifecycleParams): Promise<StateSnapshot> {
  return withLangfuseRunTrace(
    { runId: params.runId, input: params.input, config: params.config },
    async () => {
      const { snapshot } = await executeRuntimeKernel(params.runId, params.input, params.config, {
        ...kernelOptions(params),
        resumeContext: {
          clarifications: params.clarificationPatch,
          approvedActionIds: params.approvedActionIds,
          approvedActions: params.approvedActions,
          planDecisionResolutions: params.planDecisionResolutions,
          alreadyAnnounced: params.resumeAlreadyAnnounced,
        },
        resumeState: params.resumeSnapshot,
      });
      return sessionBoundSnapshot(snapshot, params.sessionId, params.turnIndex);
    },
  );
}

function kernelOptions(params: KernelLifecycleBaseParams & CancellableKernelLifecycleParams): RuntimeKernelOptions {
  return {
    clock: params.clock,
    modeSpec: params.modeSpec,
    definition: params.definition,
    skillRegistry: params.skillRegistry,
    modeRegistry: params.modeRegistry,
    selfIterationRegistry: params.selfIterationRegistry,
    automationRegistry: params.automationRegistry,
    widgetRegistry: params.widgetRegistry,
    customAgentOverlay: params.customAgentOverlay,
    customAgentOverlays: params.customAgentOverlays,
    systemAgentOverlays: params.systemAgentOverlays,
    customAgentContexts: params.customAgentContexts,
    forkedFrom: params.forkedFrom,
    conversationMessages: params.conversationMessages,
    sessionContextState: params.sessionContextState,
    turnIndex: params.turnIndex,
    streamProvider: params.streamProvider,
    signal: params.signal,
    onEvent: params.onEvent,
    onApprovalAutoResolved: params.onApprovalAutoResolved,
    taskMemoryStore: params.taskMemoryStore,
  };
}

function sessionBoundSnapshot(snapshot: StateSnapshot, sessionId: string, turnIndex: number | undefined): StateSnapshot {
  return StateSnapshotSchema.parse({
    ...snapshot,
    sessionId,
    turnIndex,
  });
}
