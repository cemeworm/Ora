import type {
  RuntimeSessionEntry,
  StateSnapshot,
} from "@cemeworm/shared";
import {
  createRuntimeGateAppendAdapter,
  type RuntimeGateAppendAdapter,
  type RuntimeGateLedgerEntry,
} from "./runtime-gate-service.js";

export interface RuntimeGateRunAppendAdapterParams {
  snapshot: Pick<StateSnapshot, "runId" | "sessionId" | "config">;
  appendRunLedgerEntry: (
    snapshot: Pick<StateSnapshot, "runId" | "sessionId" | "config">,
    entry: RuntimeGateLedgerEntry,
    options?: { candidateParentId?: string },
  ) => RuntimeSessionEntry;
  candidateParentId?: () => string | undefined;
}

export function createRuntimeGateRunAppendAdapter(
  params: RuntimeGateRunAppendAdapterParams,
): RuntimeGateAppendAdapter {
  return createRuntimeGateAppendAdapter((entry) => {
    const candidateAppendOptions =
      params.snapshot.config.metadata.branchRole === "candidate"
        ? { candidateParentId: params.candidateParentId?.() }
        : undefined;
    params.appendRunLedgerEntry(params.snapshot, entry, candidateAppendOptions);
  });
}
