import type { StateSnapshot } from "@cemeworm/shared";
import { isUnadoptedBranchCandidate } from "./project-session-operations.js";
import { generateSessionTitle } from "./session-title.js";

export class RunPersistenceService {
  constructor(private readonly deps: {
    normalizeSnapshotForPersistence: (snapshot: StateSnapshot) => StateSnapshot;
    cacheRun: (
      snapshot: StateSnapshot,
      flush: boolean,
      options?: { titleOverride?: string; deferInitialTitle?: boolean },
    ) => void;
    currentSessionTitle: (sessionId: string) => string | undefined;
    isLedgerBackedSession: (sessionId: string) => boolean;
    updateSessionTitle: (sessionId: string, title: string) => void;
    scheduleLongTermMemoryUpdate: (snapshot: StateSnapshot) => void;
    queueSelfIterationAfterTerminalRun: (snapshot: StateSnapshot) => void;
  }) {}

  persistRun(snapshot: StateSnapshot): void {
    const normalized = this.deps.normalizeSnapshotForPersistence(snapshot);
    this.deps.cacheRun(normalized, true);
    this.afterPersist(normalized);
  }

  async persistRunWithGeneratedTitle(snapshot: StateSnapshot): Promise<void> {
    const normalized = this.deps.normalizeSnapshotForPersistence(snapshot);
    const titleOverride = await generateSessionTitle(
      normalized,
      normalized.sessionId ? this.deps.currentSessionTitle(normalized.sessionId) : undefined,
    );
    if (normalized.sessionId && titleOverride && this.deps.isLedgerBackedSession(normalized.sessionId)) {
      this.deps.updateSessionTitle(normalized.sessionId, titleOverride);
    }
    this.deps.cacheRun(normalized, true, { titleOverride });
    this.afterPersist(normalized);
  }

  private afterPersist(snapshot: StateSnapshot): void {
    if (isUnadoptedBranchCandidate(snapshot)) {
      return;
    }
    this.deps.scheduleLongTermMemoryUpdate(snapshot);
    this.deps.queueSelfIterationAfterTerminalRun(snapshot);
  }
}
