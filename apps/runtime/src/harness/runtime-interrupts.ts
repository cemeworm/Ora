import type { ActionRecord, PendingClarification } from "@cemeworm/shared";
import { stableJson } from "./runtime-tool-loop.js";

const APPROVAL_INTERRUPT_SYMBOL = Symbol.for("ora.ApprovalInterrupt");
const CLARIFICATION_INTERRUPT_SYMBOL = Symbol.for("ora.ClarificationInterrupt");
const AGENT_DEGRADED_SYMBOL = Symbol.for("ora.AgentDegraded");
const SPAWN_CONTRACT_VIOLATION_SYMBOL = Symbol.for("ora.SpawnContractViolation");

export class ClarificationInterruptError extends Error {
  public readonly [CLARIFICATION_INTERRUPT_SYMBOL] = true;
  public readonly clarifications: PendingClarification[];
  constructor(clarifications: PendingClarification[] | PendingClarification) {
    const list = Array.isArray(clarifications) ? clarifications : [clarifications];
    super(list.map((c) => c.question).join(" | "));
    this.name = "ClarificationInterruptError";
    this.clarifications = list;
  }

  get clarification(): PendingClarification {
    return this.clarifications[0]!;
  }
}

export class ApprovalInterruptError extends Error {
  public readonly [APPROVAL_INTERRUPT_SYMBOL] = true;
  constructor(public readonly actionId: string) {
    super("Waiting for your approval before continuing.");
    this.name = "ApprovalInterruptError";
  }
}

export class AgentDegradedError extends Error {
  public readonly [AGENT_DEGRADED_SYMBOL] = true;
  public readonly recoveryArtifactId: string;
  public readonly errorType: string;
  constructor(
    public readonly degradedOutput: string,
    params: { recoveryArtifactId: string; errorType: string; detail: string },
  ) {
    super(`Agent degraded after ${params.errorType}: ${params.detail}`);
    this.name = "AgentDegradedError";
    this.recoveryArtifactId = params.recoveryArtifactId;
    this.errorType = params.errorType;
  }
}

export function isApprovalInterruptError(error: unknown): error is ApprovalInterruptError {
  return error instanceof ApprovalInterruptError ||
    (typeof error === "object" && error !== null &&
      (error as Record<symbol, unknown>)[APPROVAL_INTERRUPT_SYMBOL] === true);
}

export function isClarificationInterruptError(error: unknown): error is ClarificationInterruptError {
  return error instanceof ClarificationInterruptError ||
    (typeof error === "object" && error !== null &&
      (error as Record<symbol, unknown>)[CLARIFICATION_INTERRUPT_SYMBOL] === true);
}

export function isAnyInterruptError(error: unknown): error is ApprovalInterruptError | ClarificationInterruptError {
  return isApprovalInterruptError(error) || isClarificationInterruptError(error);
}

export function isAgentDegradedError(error: unknown): error is AgentDegradedError {
  return error instanceof AgentDegradedError ||
    (typeof error === "object" && error !== null &&
      (error as Record<symbol, unknown>)[AGENT_DEGRADED_SYMBOL] === true);
}

export class SpawnContractViolationError extends Error {
  public readonly [SPAWN_CONTRACT_VIOLATION_SYMBOL] = true;
  constructor(message: string) {
    super(message);
    this.name = "SpawnContractViolationError";
  }
}

export function isSpawnContractViolationError(error: unknown): error is SpawnContractViolationError {
  return error instanceof SpawnContractViolationError ||
    (typeof error === "object" && error !== null &&
      (error as Record<symbol, unknown>)[SPAWN_CONTRACT_VIOLATION_SYMBOL] === true);
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
  if (action.type !== "skills.create" && action.type !== "skills.patch") {
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
