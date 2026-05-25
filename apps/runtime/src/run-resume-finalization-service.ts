import {
  acceptedPlanExecutionContractFromMetadata,
  type OraEventEnvelope,
  type StateSnapshot,
} from "@cemeworm/shared";
import { assertRunCanBecomeTerminal, deriveTerminalStateAssertionFromSnapshot, TerminalStateIntegrityError } from "./harness/runtime-completion-guards.js";
import { finalOutputContractViolation } from "./harness/runtime-output.js";

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
  error: Pick<TerminalStateIntegrityError, "message"> & { violations?: unknown; visibleText?: string },
): StateSnapshot {
  const seq = snapshot.events.length;
  const failedEvent = {
    id: `${snapshot.runId}:evt-${seq}`,
    runId: snapshot.runId,
    seq,
    type: "run.failed" as const,
    createdAt: snapshot.updatedAt,
    pattern: snapshot.pattern,
    payload: {
      status: "failed" as const,
      error: error.message,
      output: {
        text: error.message,
        ...(error.violations !== undefined ? { violations: error.violations } : {}),
        ...(typeof error.visibleText === "string" ? { visibleText: error.visibleText } : {}),
      },
    },
  };
  return {
    ...snapshot,
    status: "failed" as const,
    error: error.message,
    activeAgents: [],
    events: [...snapshot.events, failedEvent],
    output: {
      text: error.message,
      ...(error.violations !== undefined ? { violations: error.violations } : {}),
      ...(typeof error.visibleText === "string" ? { visibleText: error.visibleText } : {}),
    },
  };
}

function inheritAcceptedPlanDecisionFacts(
  snapshot: StateSnapshot,
  original: StateSnapshot,
): StateSnapshot {
  const isAcceptedSameRunResume =
    acceptedPlanExecutionContractFromMetadata(snapshot.config.metadata) === "same_run_implementation" ||
    original.planDecisions.some((decision) => decision.status === "accepted");
  if (!isAcceptedSameRunResume || original.planDecisions.length === 0) {
    return snapshot;
  }

  const mergedById = new Map(original.planDecisions.map((decision) => [decision.id, decision]));
  for (const decision of snapshot.planDecisions) {
    mergedById.set(decision.id, decision);
  }

  const acceptedDecisionId = typeof snapshot.config.metadata.acceptedPlanDecisionId === "string"
    ? snapshot.config.metadata.acceptedPlanDecisionId
    : undefined;
  if (acceptedDecisionId) {
    const acceptedDecision = mergedById.get(acceptedDecisionId);
    if (acceptedDecision && acceptedDecision.status !== "accepted") {
      mergedById.set(acceptedDecisionId, {
        ...acceptedDecision,
        status: "accepted",
        resolvedAt: acceptedDecision.resolvedAt ?? snapshot.updatedAt,
      });
    }
  }

  return {
    ...snapshot,
    planDecisions: [...mergedById.values()],
  };
}

export class RunResumeFinalizationService {
  constructor(private readonly deps: RunResumeFinalizationServiceDeps) {}

  private prepareResumeSnapshot(params: {
    snapshot: StateSnapshot;
    original: StateSnapshot;
    clarificationPatch: Record<string, unknown>;
    approvedActionIds: string[];
  }): StateSnapshot {
    return this.deps.normalizeSnapshotForPersistence(
      inheritAcceptedPlanDecisionFacts(
        this.deps.withResumeResolutionEvents(
          params.snapshot,
          params.original,
          params.clarificationPatch,
          params.approvedActionIds,
        ),
        params.original,
      ),
    );
  }

  async persistTerminal(params: {
    snapshot: StateSnapshot;
    original: StateSnapshot;
    clarificationPatch: Record<string, unknown>;
    approvedActionIds: string[];
  }): Promise<StateSnapshot> {
    let finalSnapshot = this.prepareResumeSnapshot(params);
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
    const outputViolation = finalOutputContractViolation(finalSnapshot.output);
    if (outputViolation) {
      finalSnapshot = downgradeToFailed(finalSnapshot, {
        message: outputViolation.reason === "internal_protocol"
          ? "Terminal resume output contained internal protocol text."
          : outputViolation.reason === "recovery_fallback"
            ? "Terminal resume output resolved to recovery fallback text."
            : outputViolation.reason === "invalid_multiple_proposed_plans"
              ? "Terminal resume output contained multiple complete proposed_plan blocks."
              : outputViolation.reason === "invalid_malformed_proposed_plan"
                ? "Terminal resume output contained a malformed proposed_plan block."
                : "Terminal resume output was empty after public-output filtering.",
        visibleText: outputViolation.visibleText,
      });
    }
    const projected = this.projectPreparedSnapshot(finalSnapshot);
    await this.deps.persistRunWithGeneratedTitle(projected);
    return projected;
  }

  persistInterrupted(params: {
    snapshot: StateSnapshot;
    original: StateSnapshot;
    clarificationPatch: Record<string, unknown>;
    approvedActionIds: string[];
  }): StateSnapshot {
    const projected = this.projectPreparedSnapshot(
      this.prepareResumeSnapshot(params),
    );
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
    let finalSnapshot = this.prepareResumeSnapshot(params);
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
    const outputViolation = finalOutputContractViolation(finalSnapshot.output);
    if (outputViolation) {
      finalSnapshot = downgradeToFailed(finalSnapshot, {
        message: outputViolation.reason === "internal_protocol"
          ? "Terminal streaming resume output contained internal protocol text."
          : outputViolation.reason === "recovery_fallback"
            ? "Terminal streaming resume output resolved to recovery fallback text."
            : outputViolation.reason === "invalid_multiple_proposed_plans"
              ? "Terminal streaming resume output contained multiple complete proposed_plan blocks."
              : outputViolation.reason === "invalid_malformed_proposed_plan"
                ? "Terminal streaming resume output contained a malformed proposed_plan block."
                : "Terminal streaming resume output was empty after public-output filtering.",
        visibleText: outputViolation.visibleText,
      });
    }
    const projected = this.projectPreparedSnapshot(finalSnapshot);
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

  private projectPreparedSnapshot(snapshot: StateSnapshot): StateSnapshot {
    return this.deps.appendRunSnapshotUpdateToLedger(snapshot);
  }
}

export interface RunResumeFinalizationStreamCallbacks {
  replaceSnapshot: (snapshot: StateSnapshot) => StateSnapshot;
  markLedgerSynced: () => void;
  publish: (events: OraEventEnvelope[], snapshot: StateSnapshot) => void;
}
