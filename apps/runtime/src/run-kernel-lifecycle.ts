import type {
  CustomAgentDetail,
  ModeSpec,
  OraEventEnvelope,
  PatternDefinition,
  RunConfig,
  StateSnapshot,
  UserTaskInput
} from "@ora/shared";
import { StateSnapshotSchema } from "@ora/shared";
import type { RuntimeSkillRegistry } from "./harness/capability-registries.js";
import { executeRuntimeKernel, type RuntimeKernelOptions } from "./harness/runtime-kernel.js";
import type { ModelMessage } from "./providers/index.js";
import { withLangfuseRunTrace } from "./telemetry/langfuse.js";
import type { ApprovedResumeAction } from "./run-orchestration.js";

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
  customAgentOverlay?: string;
  customAgentOverlays?: Record<string, string>;
  systemAgentOverlays?: Record<string, string>;
  customAgentContexts?: Record<string, Pick<CustomAgentDetail, "model" | "skillIds" | "toolIds"> & { overlay: string }>;
  conversationMessages: ModelMessage[];
  forkedFrom?: { runId: string; checkpointId: string; eventSeq: number };
  streamProvider?: boolean;
  onEvent?: (event: OraEventEnvelope) => void;
}

interface KernelResumeParams extends KernelLifecycleBaseParams {
  clarificationPatch: Record<string, unknown>;
  approvedActionIds: string[];
  approvedActions: ApprovedResumeAction[];
  resumeSnapshot?: StateSnapshot;
}

export async function executeTracedKernelRun(params: KernelLifecycleBaseParams): Promise<StateSnapshot> {
  return withLangfuseRunTrace(
    { runId: params.runId, input: params.input, config: params.config },
    async () => {
      const { snapshot } = await executeRuntimeKernel(params.runId, params.input, params.config, kernelOptions(params));
      return sessionBoundSnapshot(snapshot, params.sessionId, params.turnIndex);
    },
  );
}

export async function executeTracedKernelResume(params: KernelResumeParams): Promise<StateSnapshot> {
  return withLangfuseRunTrace(
    { runId: params.runId, input: params.input, config: params.config },
    async () => {
      const { snapshot } = await executeRuntimeKernel(params.runId, params.input, params.config, {
        ...kernelOptions(params),
        resumeContext: {
          clarifications: params.clarificationPatch,
          approvedActionIds: params.approvedActionIds,
          approvedActions: params.approvedActions,
        },
        resumeState: params.resumeSnapshot,
      });
      return sessionBoundSnapshot(snapshot, params.sessionId, params.turnIndex);
    },
  );
}

function kernelOptions(params: KernelLifecycleBaseParams): RuntimeKernelOptions {
  return {
    clock: params.clock,
    modeSpec: params.modeSpec,
    definition: params.definition,
    skillRegistry: params.skillRegistry,
    customAgentOverlay: params.customAgentOverlay,
    customAgentOverlays: params.customAgentOverlays,
    systemAgentOverlays: params.systemAgentOverlays,
    customAgentContexts: params.customAgentContexts,
    forkedFrom: params.forkedFrom,
    conversationMessages: params.conversationMessages,
    streamProvider: params.streamProvider,
    onEvent: params.onEvent,
  };
}

function sessionBoundSnapshot(snapshot: StateSnapshot, sessionId: string, turnIndex: number | undefined): StateSnapshot {
  return StateSnapshotSchema.parse({
    ...snapshot,
    sessionId,
    turnIndex,
  });
}
