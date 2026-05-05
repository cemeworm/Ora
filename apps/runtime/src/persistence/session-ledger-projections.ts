import {
  deriveRunSnapshot,
  deriveSessionProjection,
  type RuntimeSessionLedger,
  type SessionSummary,
  type StateSnapshot,
} from "@cemeworm/shared";

export function deriveStoredRuntimeStateFromLedgers(ledgers: RuntimeSessionLedger[]): {
  runs: StateSnapshot[];
  sessions: SessionSummary[];
} {
  const sessions: SessionSummary[] = [];
  const runs: StateSnapshot[] = [];
  for (const ledger of ledgers) {
    const projection = deriveSessionProjection(ledger);
    sessions.push(projection.session);
    for (const run of projection.runs) {
      const snapshot = deriveRunSnapshot(ledger, run.runId);
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

export function mergeStoredRuns(legacyRuns: StateSnapshot[], ledgerRuns: StateSnapshot[]): StateSnapshot[] {
  const byId = new Map<string, StateSnapshot>();
  for (const run of legacyRuns) {
    byId.set(run.runId, run);
  }
  for (const run of ledgerRuns) {
    byId.set(run.runId, run);
  }
  return [...byId.values()].sort((a, b) => a.runId.localeCompare(b.runId));
}

export function mergeStoredSessions(legacySessions: SessionSummary[], ledgerSessions: SessionSummary[]): SessionSummary[] {
  const byId = new Map<string, SessionSummary>();
  for (const session of legacySessions) {
    byId.set(session.sessionId, session);
  }
  for (const session of ledgerSessions) {
    byId.set(session.sessionId, session);
  }
  return [...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt || a.sessionId.localeCompare(b.sessionId));
}
