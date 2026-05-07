import type { OraEventEnvelope, StateSnapshot } from "@cemeworm/shared";

interface RunResumeFinalizationServiceDeps {
  withResumeResolutionEvents: (
    snapshot: StateSnapshot,
    original: StateSnapshot,
    clarificationPatch: Record<string, unknown>,
    approvedActionIds: string[],
  ) => StateSnapshot;
  normalizeSnapshotForPersistence: (snapshot: StateSnapshot) => StateSnapshot;
  appendRunSnapshotUpdateToLedger: (snapshot: StateSnapshot) => StateSnapshot;
  persistRun: (snapshot: StateSnapshot) => void;
  persistRunWithGeneratedTitle: (snapshot: StateSnapshot) => Promise<void>;
}

export class RunResumeFinalizationService {
  constructor(private readonly deps: RunResumeFinalizationServiceDeps) {}

  async persistTerminal(params: {
    snapshot: StateSnapshot;
    original: StateSnapshot;
    clarificationPatch: Record<string, unknown>;
    approvedActionIds: string[];
  }): Promise<StateSnapshot> {
    const projected = this.projectResumeSnapshot(params);
    await this.deps.persistRunWithGeneratedTitle(projected);
    return projected;
  }

  persistInterrupted(params: {
    snapshot: StateSnapshot;
    original: StateSnapshot;
    clarificationPatch: Record<string, unknown>;
    approvedActionIds: string[];
  }): StateSnapshot {
    const projected = this.projectResumeSnapshot(params);
    this.deps.persistRun(projected);
    return projected;
  }

  async persistStreamingTerminal(params: {
    snapshot: StateSnapshot;
    original: StateSnapshot;
    clarificationPatch: Record<string, unknown>;
    approvedActionIds: string[];
    stream: RunResumeFinalizationStreamCallbacks;
    markLedgerSynced?: boolean;
  }): Promise<StateSnapshot> {
    const projected = this.projectResumeSnapshot(params);
    await this.deps.persistRunWithGeneratedTitle(projected);
    const liveSnapshot = params.stream.replaceSnapshot(projected);
    if (params.markLedgerSynced) {
      params.stream.markLedgerSynced();
    }
    params.stream.publish([], liveSnapshot);
    return liveSnapshot;
  }

  async persistStreamingFailure(params: {
    snapshot: StateSnapshot;
    events: OraEventEnvelope[];
    stream: RunResumeFinalizationStreamCallbacks;
  }): Promise<StateSnapshot> {
    const projected = this.deps.appendRunSnapshotUpdateToLedger(
      this.deps.normalizeSnapshotForPersistence(params.snapshot),
    );
    await this.deps.persistRunWithGeneratedTitle(projected);
    const liveSnapshot = params.stream.replaceSnapshot(projected);
    params.stream.publish(params.events, liveSnapshot);
    return liveSnapshot;
  }

  private projectResumeSnapshot(params: {
    snapshot: StateSnapshot;
    original: StateSnapshot;
    clarificationPatch: Record<string, unknown>;
    approvedActionIds: string[];
  }): StateSnapshot {
    return this.deps.appendRunSnapshotUpdateToLedger(this.deps.normalizeSnapshotForPersistence(
      this.deps.withResumeResolutionEvents(
        params.snapshot,
        params.original,
        params.clarificationPatch,
        params.approvedActionIds,
      ),
    ));
  }
}

export interface RunResumeFinalizationStreamCallbacks {
  replaceSnapshot: (snapshot: StateSnapshot) => StateSnapshot;
  markLedgerSynced: () => void;
  publish: (events: OraEventEnvelope[], snapshot: StateSnapshot) => void;
}
