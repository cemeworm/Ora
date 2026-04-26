import type { ActionRecord, PendingClarification } from "@ora/shared";
import { stableJson } from "./runtime-tool-loop.js";

export class ClarificationInterruptError extends Error {
  constructor(public readonly clarification: PendingClarification) {
    super(clarification.question);
  }
}

export class ApprovalInterruptError extends Error {
  constructor(public readonly actionId: string) {
    super(`Manual approval required for action ${actionId}.`);
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
