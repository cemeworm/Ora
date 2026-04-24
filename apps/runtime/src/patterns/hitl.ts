import { interrupt } from "@langchain/langgraph";
import type { OraGraphState } from "../graph/ora-state.js";

export function ensureGraphClarification(
  state: OraGraphState,
  nodeId: string,
  nodeLabel: string,
): string | undefined {
  const question = readNodeClarificationQuestion(state, nodeId);
  if (!question) {
    return undefined;
  }
  const response = interrupt({
    kind: "clarification",
    id: `${nodeId}:clarification`,
    key: nodeId,
    nodeId,
    nodeLabel,
    question,
  });
  return resolveClarificationValue(response, nodeId);
}

export function ensureGraphManualApproval(
  state: OraGraphState,
  nodeId: string,
  nodeLabel: string,
): void {
  const nodeRiskLevel = readNodeRiskLevel(state, nodeId);
  if (!requiresNodeApproval(state, nodeRiskLevel)) {
    return;
  }
  const actionId = `${state.runId}:action:graph-${nodeId}`;
  const response = interrupt({
    kind: "approval",
    actionId,
    nodeId,
    nodeLabel,
    riskLevel: nodeRiskLevel,
    reason: approvalReason(state, nodeLabel, nodeRiskLevel),
  });
  if (isApproved(response, actionId)) {
    return;
  }
  ensureGraphManualApproval(state, nodeId, nodeLabel);
}

function requiresNodeApproval(
  state: OraGraphState,
  nodeRiskLevel: "low" | "medium" | "high",
): boolean {
  if (state.config.approvalMode === "manual") {
    return true;
  }
  if (state.config.approvalMode === "high_risk_only") {
    return nodeRiskLevel === "high";
  }
  return false;
}

function approvalReason(
  state: OraGraphState,
  nodeLabel: string,
  nodeRiskLevel: "low" | "medium" | "high",
): string {
  if (state.config.approvalMode === "manual") {
    return `Manual approval required before node ${nodeLabel} executes.`;
  }
  return `High-risk node ${nodeLabel} requires approval before execution.`;
}

function readNodeClarificationQuestion(state: OraGraphState, nodeId: string): string | undefined {
  const meta = readGraphNodeMeta(state)[nodeId];
  return typeof meta?.clarificationQuestion === "string" && meta.clarificationQuestion.length > 0
    ? meta.clarificationQuestion
    : undefined;
}

function readNodeRiskLevel(state: OraGraphState, nodeId: string): "low" | "medium" | "high" {
  const meta = readGraphNodeMeta(state)[nodeId];
  return meta?.riskLevel === "high" || meta?.riskLevel === "medium" ? meta.riskLevel : "low";
}

function readGraphNodeMeta(state: OraGraphState): Record<string, {
  clarificationQuestion?: string;
  riskLevel?: "low" | "medium" | "high";
}> {
  const metadata = state.config.metadata;
  if (!metadata || typeof metadata !== "object") {
    return {};
  }
  const candidate = metadata.graphNodeMeta;
  if (!candidate || typeof candidate !== "object") {
    return {};
  }
  return candidate as Record<string, {
    clarificationQuestion?: string;
    riskLevel?: "low" | "medium" | "high";
  }>;
}

function resolveClarificationValue(response: unknown, key: string): string | undefined {
  if (!response || typeof response !== "object") {
    return undefined;
  }
  const record = response as Record<string, unknown>;
  const clarifications = record.clarifications;
  if (clarifications && typeof clarifications === "object" && clarifications !== null) {
    const value = (clarifications as Record<string, unknown>)[key];
    return typeof value === "string" ? value : undefined;
  }
  const direct = record[key];
  return typeof direct === "string" ? direct : undefined;
}

function isApproved(response: unknown, actionId: string): boolean {
  if (!response || typeof response !== "object") {
    return false;
  }
  const record = response as Record<string, unknown>;
  if (record.approved === true || record.decision === "approved") {
    return true;
  }
  const approvedActionIds = record.approvedActionIds;
  return Array.isArray(approvedActionIds) && approvedActionIds.includes(actionId);
}
