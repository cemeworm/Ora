import type {
  CausalDecisionRecord,
  CausalDecisionContext,
  CausalTaskState,
  InterventionAction,
  InterventionPolicyDecision,
} from "@cemeworm/shared";
import { CausalDecisionRecordSchema } from "@cemeworm/shared";

export interface PolicyRouterInput {
  surfaceRequest: string;
  taskState: Partial<CausalTaskState> | undefined;
  proposedToolId?: string;
  proposedToolRisk: "low" | "medium" | "high";
  toolCallCount: number;
  clarificationCount: number;
  hasPendingApprovals: boolean;
  hasPendingPlanDecisions: boolean;
  hasUnresolvedPlanItems: boolean;
  modelResponseText: string;
  decisionContext?: CausalDecisionContext;
}

export interface PolicyRouterOutput {
  action: InterventionAction;
  policyDecision: InterventionPolicyDecision;
  decisionRecord: CausalDecisionRecord;
}

function estimateGoalUncertainty(input: PolicyRouterInput): number {
  const ts = input.taskState;
  if (!ts?.selectedLatentGoal || ts.selectedLatentGoal.length === 0) {
    return 0.7;
  }
  if ((ts.latentGoalHypotheses?.length ?? 0) <= 1) {
    return 0.3;
  }
  if ((ts.confidence ?? 0) < 0.5) return 0.7;
  if ((ts.confidence ?? 0) < 0.8) return 0.4;
  return 0.1;
}

function estimateFactUncertainty(input: PolicyRouterInput): number {
  const text = input.modelResponseText.toLowerCase();
  const guessMarkers = ["probably", "might be", "i think", "likely", "maybe", "i believe", "should be", "typically"];
  const markerCount = guessMarkers.filter((m) => text.includes(m)).length;
  if (markerCount >= 3) return 0.7;
  if (markerCount >= 1) return 0.4;
  return 0.2;
}

function estimateContextUncertainty(input: PolicyRouterInput): number {
  if (input.hasUnresolvedPlanItems && input.toolCallCount === 0) return 0.6;
  if (input.proposedToolId === "file.read" || input.proposedToolId === "file.grep") return 0.2;
  return 0.3;
}

function estimateActionRisk(input: PolicyRouterInput): number {
  if (input.proposedToolRisk === "high") return 0.8;
  if (input.proposedToolRisk === "medium") return 0.4;
  return 0.1;
}

function estimateUserCost(action: InterventionAction, clarificationCount: number): number {
  if (action === "clarify") return Math.min(0.3 + clarificationCount * 0.15, 0.9);
  if (action === "request_approval") return 0.5;
  if (action === "stop") return 0.1;
  return 0.05;
}

function determineReversibility(risk: "low" | "medium" | "high"): "low" | "medium" | "high" {
  if (risk === "high") return "low";
  if (risk === "medium") return "medium";
  return "high";
}

function recommendAction(input: PolicyRouterInput): InterventionAction {
  const goalUncertainty = estimateGoalUncertainty(input);
  const factUncertainty = estimateFactUncertainty(input);
  const contextUncertainty = estimateContextUncertainty(input);
  const actionRisk = estimateActionRisk(input);

  if (actionRisk >= 0.7) return "request_approval";
  if (factUncertainty >= 0.5 && input.proposedToolId !== "web.search") return "search_web";
  if (input.hasUnresolvedPlanItems && !input.proposedToolId) return "plan";
  if (contextUncertainty >= 0.5 && input.proposedToolId) return "read_context";
  if (goalUncertainty >= 0.7) return "clarify";
  if (input.proposedToolId) return "use_tool";
  if (input.toolCallCount >= 3) return "stop";
  return "answer_directly";
}

export function routeIntervention(input: PolicyRouterInput): PolicyRouterOutput {
  const action = recommendAction(input);
  const goalUncertainty = estimateGoalUncertainty(input);
  const factUncertainty = estimateFactUncertainty(input);
  const contextUncertainty = estimateContextUncertainty(input);
  const actionRisk = estimateActionRisk(input);
  const userCost = estimateUserCost(action, input.clarificationCount);
  const reversibility = determineReversibility(input.proposedToolRisk);

  const policyDecision: InterventionPolicyDecision = {
    goalUncertainty,
    factUncertainty,
    contextUncertainty,
    actionRisk,
    userCost,
    reversibility,
    recommendedAction: action,
    reason: buildReason(action, { goalUncertainty, factUncertainty, contextUncertainty, actionRisk }),
    wouldChangeOutcomeIfWrong: actionRisk >= 0.5 || goalUncertainty >= 0.5,
  };

  const taskState: CausalTaskState = {
    surfaceRequest: input.taskState?.surfaceRequest || input.surfaceRequest,
    latentGoalHypotheses: input.taskState?.latentGoalHypotheses ?? [],
    selectedLatentGoal: input.taskState?.selectedLatentGoal ?? "",
    keyUncertainties: input.taskState?.keyUncertainties ?? [],
    constraints: input.taskState?.constraints ?? [],
    candidateInterventions: input.taskState?.candidateInterventions ?? [],
    chosenIntervention: input.taskState?.chosenIntervention,
    alternativeInterventions: input.taskState?.alternativeInterventions ?? [],
    counterfactualRiskIfSkipped: input.taskState?.counterfactualRiskIfSkipped ?? "",
    expectedOutcomeLift: input.taskState?.expectedOutcomeLift ?? "",
    confidence: input.taskState?.confidence ?? 0,
    stopCondition: input.taskState?.stopCondition ?? "",
  };

  const decisionRecord: CausalDecisionRecord = {
    taskState,
    policyDecision,
    chosenIntervention: action,
    alternativeInterventions: [],
    recordedAt: Date.now(),
    decisionContext: input.decisionContext,
  };

  CausalDecisionRecordSchema.parse(decisionRecord);

  return { action, policyDecision, decisionRecord };
}

function buildReason(
  action: InterventionAction,
  uncertainties: { goalUncertainty: number; factUncertainty: number; contextUncertainty: number; actionRisk: number },
): string {
  const parts: string[] = [];
  if (uncertainties.goalUncertainty >= 0.6) parts.push("high goal uncertainty");
  if (uncertainties.factUncertainty >= 0.5) parts.push("elevated fact uncertainty");
  if (uncertainties.contextUncertainty >= 0.5) parts.push("missing context");
  if (uncertainties.actionRisk >= 0.7) parts.push("high action risk");
  if (parts.length === 0) {
    if (action === "stop") parts.push("diminishing returns, sufficient work done");
    else parts.push("low uncertainty, safe to proceed");
  }
  return `${action}: ${parts.join("; ")}`;
}

const HIGH_RISK_TOOL_PREFIXES = ["shell.", "file.write", "file.patch", "file.delete", "file.move", "browser."];
const MEDIUM_RISK_TOOL_PREFIXES = ["file.create", "git.", "npm.", "pnpm.", "yarn."];

export function classifyToolRisk(toolId: string): "low" | "medium" | "high" {
  if (HIGH_RISK_TOOL_PREFIXES.some((prefix) => toolId.startsWith(prefix))) return "high";
  if (MEDIUM_RISK_TOOL_PREFIXES.some((prefix) => toolId.startsWith(prefix))) return "medium";
  return "low";
}

export function interventionActionToLabel(action: InterventionAction): string {
  switch (action) {
    case "answer_directly": return "Answer directly";
    case "clarify": return "Clarify with user";
    case "search_web": return "Search web";
    case "read_context": return "Read context";
    case "use_tool": return "Use tool";
    case "plan": return "Create plan";
    case "request_approval": return "Request approval";
    case "stop": return "Stop";
  }
}
