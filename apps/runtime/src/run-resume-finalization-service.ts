import type { OraEventEnvelope, StateSnapshot } from "@cemeworm/shared";
import { assertRunCanBecomeTerminal, deriveTerminalStateAssertionFromSnapshot, TerminalStateIntegrityError } from "./harness/runtime-completion-guards.js";

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

/**
 * Downgrade a snapshot to failed when the terminal state assertion fails.
 * Keeps the original snapshot's content but marks it as failed with diagnostic
 * information, consistent with the kernel's behavior in runtime-kernel-runner.ts.
 */
function downgradeToFailed(
  snapshot: StateSnapshot,
  error: TerminalStateIntegrityError,
): StateSnapshot {
  return {
    ...snapshot,
    status: "failed" as const,
    error: error.message,
    output: {
      text: error.message,
      violations: error.violations,
    },
  };
}

export class RunResumeFinalizationService {
  constructor(private readonly deps: RunResumeFinalizationServiceDeps) {}

  async persistTerminal(params: {
    snapshot: StateSnapshot;
    original: StateSnapshot;
    clarificationPatch: Record<string, unknown>;
    approvedActionIds: string[];
  }): Promise<StateSnapshot> {
    let finalSnapshot = params.snapshot;
    try {
      assertRunCanBecomeTerminal(
        deriveTerminalStateAssertionFromSnapshot(finalSnapshot),
      );
    } catch (caught) {
      if (caught instanceof TerminalStateIntegrityError) {
        finalSnapshot = downgradeToFailed(finalSnapshot, caught);
      } else {
        throw caught;
      }
    }
    const projected = this.projectResumeSnapshot({
      ...params,
      snapshot: finalSnapshot,
    });
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
    let finalSnapshot = params.snapshot;
    try {
      assertRunCanBecomeTerminal(
        deriveTerminalStateAssertionFromSnapshot(finalSnapshot),
      );
    } catch (caught) {
      if (caught instanceof TerminalStateIntegrityError) {
        finalSnapshot = downgradeToFailed(finalSnapshot, caught);
      } else {
        throw caught;
      }
    }
    const projected = this.projectResumeSnapshot({
      ...params,
      snapshot: finalSnapshot,
    });
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
