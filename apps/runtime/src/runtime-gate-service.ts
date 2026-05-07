import type {
  OraToolCallEnvelope,
  PendingClarification,
  PlanDecisionGate,
  RuntimeSessionEntry,
  RuntimeSessionEntryType,
  StateSnapshot,
} from "@cemeworm/shared";

export type RuntimeGateLedgerEntry = Omit<RuntimeSessionEntry, "sessionId" | "seq"> & {
  type: RuntimeSessionEntryType;
};

export type RuntimeGateResolvedStatus = "resolved" | "accepted" | "declined";

export type RuntimeGateLifecycleResultKind =
  | "snapshot_open"
  | "resume_resolve"
  | "plan_decision_resolve";

export interface RuntimeGateLifecycleResult {
  kind: RuntimeGateLifecycleResultKind;
  entries: RuntimeGateLedgerEntry[];
}

export interface RuntimeGateAppendAdapter {
  appendGateLifecycleResult(result: RuntimeGateLifecycleResult): void | Promise<void>;
}

export function createRuntimeGateAppendAdapter(
  appendEntry: (entry: RuntimeGateLedgerEntry) => void,
): RuntimeGateAppendAdapter {
  return {
    appendGateLifecycleResult(result: RuntimeGateLifecycleResult): void {
      for (const entry of result.entries) {
        appendEntry(entry);
      }
    },
  };
}

export interface ClarificationGateOpenedParams {
  runId: string;
  turnIndex?: number;
  clarification: PendingClarification;
}

export interface ApprovalGateOpenedParams {
  runId: string;
  turnIndex?: number;
  createdAt: number;
  pendingActionIds: string[];
  pendingToolCallIds: string[];
}

export interface PlanDecisionGateOpenedParams {
  runId: string;
  turnIndex?: number;
  decision: PlanDecisionGate;
}

export interface RuntimeGateOpenedEntriesParams {
  runId: string;
  turnIndex?: number;
  updatedAt: number;
  pendingClarifications: PendingClarification[];
  pendingApprovals: string[];
  toolCalls: OraToolCallEnvelope[];
  planDecisions: PlanDecisionGate[];
  existingEntryIds?: Iterable<string>;
}

export interface RuntimeGateSnapshotOpenParams {
  snapshot: StateSnapshot;
  existingEntryIds?: Iterable<string>;
}

export interface RuntimeGateResolvedParams {
  runId: string;
  turnIndex?: number;
  gateId: string;
  status: RuntimeGateResolvedStatus;
  resolvedAt: number;
  entryId?: string;
}

export interface RuntimeGatePlanDecisionResolutionParams {
  runId: string;
  turnIndex?: number;
  decisionId: string;
  status: Extract<RuntimeGateResolvedStatus, "accepted" | "declined">;
  resolvedAt: number;
}

export interface RuntimeGateResumeResolutionParams {
  snapshot: Pick<StateSnapshot, "runId" | "turnIndex">;
  resolutions: RuntimeGateResolution[];
  resolvedAt: number;
}

export type RuntimeGateResolution =
  | {
      kind: "clarification";
      gateId: string;
      value: unknown;
    }
  | {
      kind: "approval";
      actionId: string;
    };

export class RuntimeGateService {
  openSnapshotGateLifecycle(params: RuntimeGateSnapshotOpenParams): RuntimeGateLifecycleResult {
    return {
      kind: "snapshot_open",
      entries: this.openSnapshotGates(params),
    };
  }

  openSnapshotGates(params: RuntimeGateSnapshotOpenParams): RuntimeGateLedgerEntry[] {
    return this.openedEntries({
      runId: params.snapshot.runId,
      turnIndex: params.snapshot.turnIndex,
      updatedAt: params.snapshot.updatedAt,
      pendingClarifications: params.snapshot.pendingClarifications,
      pendingApprovals: params.snapshot.pendingApprovals,
      toolCalls: params.snapshot.toolCalls,
      planDecisions: params.snapshot.planDecisions,
      existingEntryIds: params.existingEntryIds,
    });
  }

  openedEntries(params: RuntimeGateOpenedEntriesParams): RuntimeGateLedgerEntry[] {
    const entries: RuntimeGateLedgerEntry[] = [];
    const existingEntryIds = new Set(params.existingEntryIds ?? []);
    for (const clarification of params.pendingClarifications) {
      const entry = this.clarificationOpenedEntry({
        runId: params.runId,
        turnIndex: params.turnIndex,
        clarification,
      });
      if (!existingEntryIds.has(entry.id)) {
        entries.push(entry);
      }
    }
    if (params.pendingApprovals.length > 0) {
      const pendingToolCallIds = params.toolCalls
        .filter((call) => call.actionId && params.pendingApprovals.includes(call.actionId))
        .map((call) => call.id);
      const entry = this.approvalOpenedEntry({
        runId: params.runId,
        turnIndex: params.turnIndex,
        createdAt: params.updatedAt,
        pendingActionIds: params.pendingApprovals,
        pendingToolCallIds,
      });
      if (!existingEntryIds.has(entry.id)) {
        entries.push(entry);
      }
    }
    for (const decision of params.planDecisions) {
      if (decision.status !== "pending") {
        continue;
      }
      const entry = this.planDecisionOpenedEntry({
        runId: params.runId,
        turnIndex: params.turnIndex,
        decision,
      });
      if (!existingEntryIds.has(entry.id)) {
        entries.push(entry);
      }
    }
    return entries;
  }

  resumeResolutions(params: {
    snapshot: StateSnapshot;
    clarificationPatch: Record<string, unknown>;
    approvedActionIds: string[];
  }): RuntimeGateResolution[] {
    const resolutions: RuntimeGateResolution[] = [];
    const resolvedClarificationIds = new Set<string>();
    for (const clarification of params.snapshot.pendingClarifications) {
      const value = params.clarificationPatch[clarification.id] ?? params.clarificationPatch[clarification.key];
      if (value === undefined || resolvedClarificationIds.has(clarification.id)) {
        continue;
      }
      resolvedClarificationIds.add(clarification.id);
      resolutions.push({
        kind: "clarification",
        gateId: clarification.id,
        value,
      });
    }
    const pendingApprovalIds = new Set(params.snapshot.pendingApprovals);
    const resolvedApprovalIds = new Set<string>();
    for (const actionId of params.approvedActionIds) {
      if (!pendingApprovalIds.has(actionId) || resolvedApprovalIds.has(actionId)) {
        continue;
      }
      resolvedApprovalIds.add(actionId);
      resolutions.push({
        kind: "approval",
        actionId,
      });
    }
    return resolutions;
  }

  resolveResumeGateLifecycle(params: RuntimeGateResumeResolutionParams): RuntimeGateLifecycleResult {
    return {
      kind: "resume_resolve",
      entries: this.resolveResumeGates(params),
    };
  }

  resolveResumeGates(params: RuntimeGateResumeResolutionParams): RuntimeGateLedgerEntry[] {
    const entries: RuntimeGateLedgerEntry[] = [];
    const resolvedClarificationIds = new Set(
      params.resolutions
        .filter((resolution): resolution is Extract<RuntimeGateResolution, { kind: "clarification" }> =>
          resolution.kind === "clarification")
        .map((resolution) => resolution.gateId),
    );
    for (const clarificationId of resolvedClarificationIds) {
      entries.push(this.resolvedEntry({
        runId: params.snapshot.runId,
        turnIndex: params.snapshot.turnIndex,
        gateId: clarificationId,
        status: "resolved",
        resolvedAt: params.resolvedAt,
        entryId: `${params.snapshot.runId}:gate:${clarificationId}:resolved-${params.resolvedAt}`,
      }));
    }
    if (params.resolutions.some((resolution) => resolution.kind === "approval")) {
      entries.push(this.resolvedEntry({
        runId: params.snapshot.runId,
        turnIndex: params.snapshot.turnIndex,
        gateId: approvalGateId(params.snapshot.runId),
        status: "accepted",
        resolvedAt: params.resolvedAt,
        entryId: `${params.snapshot.runId}:gate:approval:resolved-${params.resolvedAt}`,
      }));
    }
    return entries;
  }

  resolvePlanDecisionGateLifecycle(
    params: RuntimeGatePlanDecisionResolutionParams,
  ): RuntimeGateLifecycleResult {
    return {
      kind: "plan_decision_resolve",
      entries: [this.resolvePlanDecisionGate(params)],
    };
  }

  resolvePlanDecisionGate(params: RuntimeGatePlanDecisionResolutionParams): RuntimeGateLedgerEntry {
    return this.resolvedEntry({
      runId: params.runId,
      turnIndex: params.turnIndex,
      gateId: params.decisionId,
      status: params.status,
      resolvedAt: params.resolvedAt,
    });
  }

  clarificationOpenedEntry(params: ClarificationGateOpenedParams): RuntimeGateLedgerEntry {
    return {
      id: `${params.runId}:gate:${params.clarification.id}`,
      type: "gate.opened",
      runId: params.runId,
      turnIndex: params.turnIndex ?? 1,
      createdAt: params.clarification.requestedAt,
      payload: {
        gateId: params.clarification.id,
        kind: "clarification",
        pendingClarificationIds: [params.clarification.id],
        clarification: params.clarification,
      },
    };
  }

  approvalOpenedEntry(params: ApprovalGateOpenedParams): RuntimeGateLedgerEntry {
    return {
      id: `${params.runId}:gate:approval`,
      type: "gate.opened",
      runId: params.runId,
      turnIndex: params.turnIndex ?? 1,
      createdAt: params.createdAt,
      payload: {
        gateId: approvalGateId(params.runId),
        kind: "approval",
        pendingActionIds: params.pendingActionIds,
        pendingToolCallIds: params.pendingToolCallIds,
      },
    };
  }

  planDecisionOpenedEntry(params: PlanDecisionGateOpenedParams): RuntimeGateLedgerEntry {
    return {
      id: `${params.runId}:gate:${params.decision.id}`,
      type: "gate.opened",
      runId: params.runId,
      turnIndex: params.turnIndex ?? 1,
      createdAt: params.decision.createdAt,
      payload: {
        gateId: params.decision.id,
        kind: "plan_decision",
        planDecision: params.decision,
      },
    };
  }

  resolvedEntry(params: RuntimeGateResolvedParams): RuntimeGateLedgerEntry {
    return {
      id: params.entryId ?? `${params.runId}:gate:${params.gateId}:resolved`,
      type: "gate.resolved",
      runId: params.runId,
      turnIndex: params.turnIndex ?? 1,
      createdAt: params.resolvedAt,
      payload: {
        gateId: params.gateId,
        status: params.status,
        resolvedAt: params.resolvedAt,
      },
    };
  }
}

export function approvalGateId(runId: string): string {
  return `${runId}:approval`;
}
