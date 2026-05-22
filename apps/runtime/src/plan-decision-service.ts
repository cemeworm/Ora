import {
  SessionDetail,
  SessionPlanDecisionResolveParamsSchema,
  StateSnapshot,
  StateSnapshotSchema,
  type RuntimeSessionEntry,
  type RuntimeSessionEntryType,
} from "@cemeworm/shared";
import { OraRuntimeError } from "./runtime-errors.js";
import { createRuntimeGateAppendAdapter, RuntimeGateService } from "./runtime-gate-service.js";

type AppendSessionLedgerEntry = (
  sessionId: string,
  entry: Omit<RuntimeSessionEntry, "sessionId" | "seq"> & { type: RuntimeSessionEntryType },
) => RuntimeSessionEntry;

export interface PlanDecisionServiceDeps {
  now: () => number;
  getSessionOrThrow: (sessionId: string) => { sessionId: string; latestRunId?: string };
  getRunOrThrow: (runId: string) => StateSnapshot;
  normalizeSnapshotForPersistence: (snapshot: StateSnapshot) => StateSnapshot;
  isLedgerBackedSession: (sessionId: string | undefined) => boolean;
  appendSessionLedgerEntry: AppendSessionLedgerEntry;
  refreshSessionFromLedger: (sessionId: string) => unknown;
  saveManifest: () => void;
  cacheRun: (snapshot: StateSnapshot, flush: boolean) => void;
  getSession: (params: { sessionId: string }) => SessionDetail;
}

export class PlanDecisionService {
  private readonly gateService = new RuntimeGateService();

  constructor(private readonly deps: PlanDecisionServiceDeps) {}

  resolve(params: unknown): SessionDetail {
    const parsed = SessionPlanDecisionResolveParamsSchema.parse(params);
    const session = this.deps.getSessionOrThrow(parsed.sessionId);
    const targetRunId = parsed.runId ?? session.latestRunId;
    if (!targetRunId) {
      throw new OraRuntimeError(`Session '${parsed.sessionId}' has no run to resolve.`, -32004, {
        sessionId: parsed.sessionId,
      });
    }
    const snapshot = this.deps.getRunOrThrow(targetRunId);
    if (snapshot.sessionId !== parsed.sessionId) {
      throw new OraRuntimeError(`Run '${targetRunId}' does not belong to session '${parsed.sessionId}'.`, -32004, {
        sessionId: parsed.sessionId,
        runId: targetRunId,
      });
    }
    const existing = snapshot.planDecisions.find((decision) => decision.id === parsed.decisionId);
    if (!existing) {
      throw new OraRuntimeError(`Plan decision '${parsed.decisionId}' does not exist.`, -32004, {
        sessionId: parsed.sessionId,
        runId: targetRunId,
        decisionId: parsed.decisionId,
      });
    }
    const now = this.deps.now();
    const updatedSnapshot = this.deps.normalizeSnapshotForPersistence(StateSnapshotSchema.parse({
      ...snapshot,
      planDecisions: snapshot.planDecisions.map((decision) =>
        decision.id === parsed.decisionId
          ? {
              ...decision,
              status: parsed.status,
              resolvedAt: now,
            }
          : decision
      ),
      updatedAt: Math.max(snapshot.updatedAt, now),
    }));
    if (this.deps.isLedgerBackedSession(parsed.sessionId)) {
      createRuntimeGateAppendAdapter((entry) => {
        this.deps.appendSessionLedgerEntry(parsed.sessionId, entry);
      }).appendGateLifecycleResult(this.gateService.resolvePlanDecisionGateLifecycle({
        runId: targetRunId,
        turnIndex: snapshot.turnIndex,
        decisionId: parsed.decisionId,
        status: parsed.status,
        resolvedAt: now,
      }));
      if (parsed.status === "accepted" && existing.planContent?.trim()) {
        this.deps.appendSessionLedgerEntry(parsed.sessionId, {
          id: `${targetRunId}:handoff:${parsed.decisionId}`,
          type: "handoff.accepted_plan",
          runId: targetRunId,
          turnIndex: snapshot.turnIndex ?? 1,
          createdAt: now,
          payload: {
            decisionId: parsed.decisionId,
            sourceRunId: targetRunId,
            planContent: existing.planContent.trim(),
            acceptedAt: now,
          },
        });
      }
      this.deps.refreshSessionFromLedger(parsed.sessionId);
      this.deps.saveManifest();
      return this.deps.getSession({ sessionId: parsed.sessionId });
    }
    this.deps.cacheRun(updatedSnapshot, true);
    return this.deps.getSession({ sessionId: parsed.sessionId });
  }
}
