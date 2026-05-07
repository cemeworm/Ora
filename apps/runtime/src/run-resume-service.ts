import {
  RunResumeParamsSchema,
  type OraEventEnvelope,
  type StateSnapshot,
} from "@cemeworm/shared";
import {
  approvedToolContinuationActions,
  completeApprovedToolContinuation,
  type ApprovedFileWriteResumeDeps,
  type ApprovedToolContinuationResult,
} from "./approved-file-write-resume.js";
import {
  approvedActionsForResume,
  hasKernelResumeWork,
  parseResumePatch,
  type ApprovedResumeAction,
  type ParsedResumePatch,
} from "./run-orchestration.js";
import {
  applyNonKernelResumeApprovals,
  beginNonKernelResume,
  completeNonKernelResumeMutation,
  interruptedNonKernelResumeSnapshot,
  nonKernelResumeNeedsInput,
  resolveNonKernelResumeClarifications,
  type NonKernelResumeMutationDeps,
} from "./run-resume-mutation.js";
import {
  RuntimeGateService,
  type RuntimeGateResolution,
} from "./runtime-gate-service.js";

interface RunResumeServiceDeps {
  getRunOrThrow: (runId: string) => StateSnapshot;
}

export type RunResumeStrategy =
  | {
      kind: "approved_tool_continuation";
      approvedActionIds: string[];
      continuationActionIds: string[];
      continueKernelAfterTool: boolean;
    }
  | {
      kind: "kernel";
      approvedActionIds: string[];
    }
  | {
      kind: "non_kernel";
      approvedActionIds: string[];
    };

export interface RunResumePreparation {
  parsed: ReturnType<typeof RunResumeParamsSchema.parse>;
  snapshot: StateSnapshot;
  patch: ParsedResumePatch;
  clarificationPatch: Record<string, unknown>;
  approvedActionIds: string[];
  approvedActions: ApprovedResumeAction[];
  gateResolutions: RuntimeGateResolution[];
  hasKernelWork: boolean;
  strategy: RunResumeStrategy;
}

export type NonKernelResumeStrategyResult =
  | {
      kind: "needs_input";
      snapshot: StateSnapshot;
    }
  | {
      kind: "completed";
      snapshot: StateSnapshot;
    };

export class RunResumeService {
  private readonly gateService = new RuntimeGateService();

  constructor(private readonly deps: RunResumeServiceDeps) {}

  prepare(params: unknown): RunResumePreparation {
    const parsed = RunResumeParamsSchema.parse(params);
    const snapshot = this.deps.getRunOrThrow(parsed.runId);
    const patch = parseResumePatch(parsed.patch);
    const hasKernelWork = hasKernelResumeWork(snapshot);
    return {
      parsed,
      snapshot,
      patch,
      clarificationPatch: patch.clarificationPatch,
      approvedActionIds: patch.approvedActionIds,
      approvedActions: approvedActionsForResume(snapshot, patch.approvedActionIds),
      gateResolutions: this.gateService.resumeResolutions({
        snapshot,
        clarificationPatch: patch.clarificationPatch,
        approvedActionIds: patch.approvedActionIds,
      }),
      hasKernelWork,
      strategy: classifyRunResumeStrategy({
        snapshot,
        approvedActionIds: patch.approvedActionIds,
        hasKernelWork,
      }),
    };
  }
}

export function classifyRunResumeStrategy(params: {
  snapshot: StateSnapshot;
  approvedActionIds: string[];
  hasKernelWork?: boolean;
}): RunResumeStrategy {
  const hasKernelWork = params.hasKernelWork ?? hasKernelResumeWork(params.snapshot);
  const continuationActions = approvedToolContinuationActions(params.snapshot, params.approvedActionIds);
  if (continuationActions.length > 0) {
    return {
      kind: "approved_tool_continuation",
      approvedActionIds: params.approvedActionIds,
      continuationActionIds: continuationActions.map((action) => action.id),
      continueKernelAfterTool: hasKernelWork,
    };
  }
  if (hasKernelWork) {
    return {
      kind: "kernel",
      approvedActionIds: params.approvedActionIds,
    };
  }
  return {
    kind: "non_kernel",
    approvedActionIds: params.approvedActionIds,
  };
}

export function executeNonKernelResumeStrategy(params: {
  snapshot: StateSnapshot;
  reason: string;
  patch: unknown;
  clarificationPatch: Record<string, unknown>;
  deps: NonKernelResumeMutationDeps;
}): NonKernelResumeStrategyResult {
  let working = beginNonKernelResume({
    snapshot: params.snapshot,
    reason: params.reason,
    patch: params.patch,
    deps: params.deps,
  });
  working = resolveNonKernelResumeClarifications({
    snapshot: working,
    clarificationPatch: params.clarificationPatch,
    appendEvent: params.deps.appendEvent,
  });
  working = applyNonKernelResumeApprovals(working, params.deps);

  if (nonKernelResumeNeedsInput(working)) {
    return {
      kind: "needs_input",
      snapshot: interruptedNonKernelResumeSnapshot(working, params.deps.now()),
    };
  }

  const completed = completeNonKernelResumeMutation(working, params.deps);
  return {
    kind: "completed",
    snapshot: params.deps.syncTodos(completed, "resume.completed"),
  };
}

export function executeApprovedToolContinuationStrategy(params: {
  snapshot: StateSnapshot;
  approvedActionIds: string[];
  reason?: string;
  patch?: unknown;
  deps: ApprovedFileWriteResumeDeps;
  onEvent?: (event: OraEventEnvelope, snapshot: StateSnapshot) => void;
}): Promise<ApprovedToolContinuationResult | undefined> {
  return completeApprovedToolContinuation(
    params.snapshot,
    params.approvedActionIds,
    { reason: params.reason, patch: params.patch },
    params.deps,
    params.onEvent,
  );
}
