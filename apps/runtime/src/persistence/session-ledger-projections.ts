import {
  deriveRunSnapshot,
  deriveSessionProjection,
  type RuntimeSessionLedger,
} from "@cemeworm/shared";
import type { RuntimeRunReadModel, RuntimeSessionReadModel } from "./types.js";

export function deriveRuntimeReadModelsFromLedgers(ledgers: RuntimeSessionLedger[]): {
  runs: RuntimeRunReadModel[];
  sessions: RuntimeSessionReadModel[];
} {
  const sessions: RuntimeSessionReadModel[] = [];
  const runs: RuntimeRunReadModel[] = [];
  for (const ledger of ledgers) {
    const projection = deriveSessionProjection(ledger);
    sessions.push(projection.session);
    for (const run of projection.runs) {
      const snapshot = deriveRunSnapshot(ledger, run.runId, undefined, projection);
      if (snapshot) {
        runs.push(snapshot);
      }
    }
  }
  return {
    runs: runs.sort((a, b) => a.runId.localeCompare(b.runId)),
    sessions: sessions.sort((a, b) => b.updatedAt - a.updatedAt || a.sessionId.localeCompare(b.sessionId)),
  };
}
