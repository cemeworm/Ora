import type { StateSnapshot } from "@cemeworm/shared";
import {
  RuntimeGateService,
  type RuntimeGateAppendAdapter,
  type RuntimeGateResolution,
} from "./runtime-gate-service.js";
import { OraRuntimeError } from "./runtime-errors.js";

export class RuntimeGateLedgerService {
  private readonly gateService = new RuntimeGateService();

  appendSnapshotOpenLifecycle(params: {
    snapshot: StateSnapshot;
    existingEntryIds?: Iterable<string>;
    appendAdapter: RuntimeGateAppendAdapter;
  }): void {
    const gateLifecycle = this.gateService.openSnapshotGateLifecycle({
      snapshot: params.snapshot,
      existingEntryIds: params.existingEntryIds,
    });
    if (gateLifecycle.kind !== "snapshot_open") {
      throw new OraRuntimeError("Cannot append non-snapshot gate lifecycle facts from a snapshot.", -32004, {
        runId: params.snapshot.runId,
        kind: gateLifecycle.kind,
      });
    }
    params.appendAdapter.appendGateLifecycleResult(gateLifecycle);
  }

  appendResumeResolveLifecycle(params: {
    snapshot: StateSnapshot;
    resolutions: RuntimeGateResolution[];
    resolvedAt: number;
    appendAdapter: RuntimeGateAppendAdapter;
  }): void {
    const gateLifecycle = this.gateService.resolveResumeGateLifecycle({
      snapshot: params.snapshot,
      resolutions: params.resolutions,
      resolvedAt: params.resolvedAt,
    });
    if (gateLifecycle.kind !== "resume_resolve") {
      throw new OraRuntimeError("Cannot append non-resume gate lifecycle facts from resume.", -32004, {
        runId: params.snapshot.runId,
        kind: gateLifecycle.kind,
      });
    }
    params.appendAdapter.appendGateLifecycleResult(gateLifecycle);
  }
}
