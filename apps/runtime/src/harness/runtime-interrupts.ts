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
  const approvedActionKeys = new Set(
    (resumeContext?.approvedActions ?? []).map((action) => stableApprovalActionKey(action)),
  );

  return {
    consume(action) {
      if (approvedActionIds.delete(action.id)) {
        return true;
      }
      const key = stableApprovalActionKey(action);
      if (!approvedActionKeys.has(key)) {
        return false;
      }
      approvedActionKeys.delete(key);
      return true;
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
