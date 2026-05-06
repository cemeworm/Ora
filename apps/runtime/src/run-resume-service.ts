import {
  RunResumeParamsSchema,
  type StateSnapshot,
} from "@cemeworm/shared";
import {
  approvedToolContinuationActions,
} from "./approved-file-write-resume.js";
import {
  approvedActionsForResume,
  hasKernelResumeWork,
  parseResumePatch,
  type ApprovedResumeAction,
  type ParsedResumePatch,
} from "./run-orchestration.js";
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
