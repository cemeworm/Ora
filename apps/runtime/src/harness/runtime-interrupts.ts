import type { ActionRecord, PendingClarification } from "@cemeworm/shared";
import { stableJson } from "./runtime-tool-loop.js";

export class ClarificationInterruptError extends Error {
  public readonly clarifications: PendingClarification[];
  constructor(clarifications: PendingClarification[] | PendingClarification) {
    const list = Array.isArray(clarifications) ? clarifications : [clarifications];
    super(list.map((c) => c.question).join(" | "));
    this.clarifications = list;
  }

  get clarification(): PendingClarification {
    return this.clarifications[0]!;
  }
}

export class ApprovalInterruptError extends Error {
  constructor(public readonly actionId: string) {
    super("Waiting for your approval before continuing.");
  }
}

export type ApprovedResumeAction = Pick<ActionRecord, "type" | "riskLevel" | "input" | "agentId">;

export function createResumeApprovalMatcher(resumeContext: {
  approvedActionIds?: string[];
  approvedActions?: ApprovedResumeAction[];
} | undefined): {
  consume: (action: ActionRecord) => boolean;
} {
  const approvedActionIds = new Set(resumeContext?.approvedActionIds ?? []);
  const approvedActions = resumeContext?.approvedActions ?? [];
  const approvedActionKeys = new Set(
    approvedActions.map((action) => stableApprovalActionKey(action)),
  );
  const approvedSingleActionScopes = new Set(
    approvedActions
      .map((action) => stableSingleApprovalScopeKey(action))
      .filter((key): key is string => key !== undefined),
  );
  const approvedBatchActionScopes = new Set(
    approvedActions
      .map((action) => stableBatchApprovalScopeKey(action))
      .filter((key): key is string => key !== undefined),
  );

  return {
    consume(action) {
      if (approvedActionIds.delete(action.id)) {
        return true;
      }
      const key = stableApprovalActionKey(action);
      if (approvedActionKeys.has(key)) {
        approvedActionKeys.delete(key);
        return true;
      }
      const singleScopeKey = stableSingleApprovalScopeKey(action);
      if (singleScopeKey && approvedSingleActionScopes.has(singleScopeKey)) {
        return true;
      }
      const batchScopeKey = stableBatchApprovalScopeKey(action);
      if (batchScopeKey && approvedBatchActionScopes.has(batchScopeKey)) {
        return true;
      }
      return false;
    },
  };
}

function stableApprovalActionKey(action: ApprovedResumeAction): string {
  return stableJson({
    type: action.type,
    riskLevel: action.riskLevel,
    agentId: action.agentId ?? null,
    input: approvalComparableInput(action.input),
  });
}

function approvalComparableInput(input: unknown): unknown {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return input;
  }
  const { approvalRequest: _approvalRequest, ...rest } = input as Record<string, unknown>;
  return rest;
}

function stableSingleApprovalScopeKey(action: ApprovedResumeAction): string | undefined {
  if (action.type !== "file.write" && action.type !== "file.apply_patch") {
    return undefined;
  }
  const targetPath = approvalInputPath(action.input);
  if (!targetPath) {
    return undefined;
  }
  return stableJson({
    type: action.type,
    riskLevel: action.riskLevel,
    path: targetPath,
  });
}

function stableBatchApprovalScopeKey(action: ApprovedResumeAction): string | undefined {
  if (action.type !== "skills.create") {
    return undefined;
  }
  return stableJson({
    type: action.type,
    riskLevel: action.riskLevel,
    agentId: action.agentId ?? null,
  });
}

function approvalInputPath(input: unknown): string | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return undefined;
  }
  const path = (input as Record<string, unknown>).path;
  return typeof path === "string" && path.trim() ? path.trim() : undefined;
}
