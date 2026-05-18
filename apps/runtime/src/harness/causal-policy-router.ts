import type {
  CausalDecisionRecord,
  CausalDecisionContext,
  CausalTaskState,
  InterventionAction,
  InterventionPolicyDecision,
} from "@cemeworm/shared";
import { CausalDecisionRecordSchema, classifyToolRisk, isSearchTool, isReadContextTool } from "@cemeworm/shared";

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

export function estimateGoalUncertainty(input: PolicyRouterInput): number {
  const ts = input.taskState;
  if (!ts?.selectedLatentGoal || ts.selectedLatentGoal.length === 0) {
    // Heuristic fallback when no explicit cognitive state from the LLM:
    // use runtime signals to estimate how well we understand the user's goal.
    if (input.clarificationCount > 0) return 0.3; // user clarified intent
    if (input.toolCallCount >= 3) return 0.4; // agent is executing, path is stable
    if (input.hasUnresolvedPlanItems) return 0.5; // structured but not precise
    return 0.7; // session just started, no signals yet
  }
  if ((ts.latentGoalHypotheses?.length ?? 0) <= 1) {
    return 0.3;
  }
  if ((ts.confidence ?? 0) < 0.5) return 0.7;
  if ((ts.confidence ?? 0) < 0.8) return 0.4;
  return 0.1;
}

export function estimateFactUncertainty(input: PolicyRouterInput): number {
  const text = input.modelResponseText.toLowerCase();
  const guessMarkers = ["probably", "might be", "i think", "likely", "maybe", "i believe", "should be", "typically"];
  const markerCount = guessMarkers.filter((m) => text.includes(m)).length;
  if (markerCount >= 3) return 0.7;
  if (markerCount >= 1) return 0.4;
  return 0.2;
}

export function estimateContextUncertainty(input: PolicyRouterInput): number {
  if (input.hasUnresolvedPlanItems && input.toolCallCount === 0) return 0.6;
  if (input.proposedToolId && isReadContextTool(input.proposedToolId)) return 0.2;
  return 0.3;
}

export function estimateActionRisk(input: PolicyRouterInput): number {
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

interface RecommendResult {
  action: InterventionAction;
  goalUncertainty: number;
  factUncertainty: number;
  contextUncertainty: number;
  actionRisk: number;
}

function recommendAction(input: PolicyRouterInput): RecommendResult {
  const goalUncertainty = estimateGoalUncertainty(input);
  const factUncertainty = estimateFactUncertainty(input);
  const contextUncertainty = estimateContextUncertainty(input);
  const actionRisk = estimateActionRisk(input);

  let action: InterventionAction;
  if (actionRisk >= 0.7) action = "request_approval";
  else if (factUncertainty >= 0.5 && !isSearchTool(input.proposedToolId ?? "")) action = "search_web";
  else if (input.hasUnresolvedPlanItems && !input.proposedToolId) action = "plan";
  else if (contextUncertainty >= 0.5 && input.proposedToolId) action = "read_context";
  else if (goalUncertainty >= 0.7) action = "clarify";
  else if (input.proposedToolId) action = "use_tool";
  else if (input.toolCallCount >= 3) action = "stop";
  else action = "answer_directly";

  return { action, goalUncertainty, factUncertainty, contextUncertainty, actionRisk };
}

function buildKeyUncertaintiesFromPolicy(
  goalUncertainty: number,
  factUncertainty: number,
  contextUncertainty: number,
  actionRisk: number,
): string[] {
  const items: string[] = [];
  if (goalUncertainty >= 0.5) items.push("用户目标不明确");
  if (factUncertainty >= 0.5) items.push("事实信息缺失");
  if (contextUncertainty >= 0.5) items.push("上下文不足");
  if (actionRisk >= 0.5) items.push("行动风险较高");
  return items;
}

function computeAlternativeInterventions(action: InterventionAction, input: PolicyRouterInput): InterventionAction[] {
  const alternatives: InterventionAction[] = [];
  const allActions: InterventionAction[] = [
    "request_approval", "clarify", "search_web", "read_context", "plan", "use_tool", "answer_directly", "stop",
  ];
  for (const alt of allActions) {
    if (alt === action) continue;
    if (alternatives.length >= 2) break; // Keep top 2 alternatives
    // Only suggest alternatives that are sensible given the context
    if (alt === "request_approval" && input.proposedToolRisk !== "high") continue;
    if (alt === "plan" && !input.hasUnresolvedPlanItems) continue;
    if (alt === "stop" && input.toolCallCount < 3) continue;
    alternatives.push(alt);
  }
  return alternatives;
}

export function routeIntervention(input: PolicyRouterInput): PolicyRouterOutput {
  const { action, goalUncertainty, factUncertainty, contextUncertainty, actionRisk } = recommendAction(input);
  const userCost = estimateUserCost(action, input.clarificationCount);
  const reversibility = determineReversibility(input.proposedToolRisk);
  const recordedAt = Date.now();
  const phase = input.decisionContext?.phase;
  const decisionId = [
    input.decisionContext?.replyMessageId ?? "decision",
    phase ?? "decision",
    input.decisionContext?.toolId ?? input.proposedToolId ?? "none",
    String(recordedAt),
  ].join(":");

  const policyDecision: InterventionPolicyDecision = {
    goalUncertainty,
    factUncertainty,
    contextUncertainty,
    actionRisk,
    userCost,
    reversibility,
    recommendedAction: action,
    reason: buildReason(action, { goalUncertainty, factUncertainty, contextUncertainty, actionRisk }),
    wouldChangeOutcomeIfWrong: actionRisk >= 0.5 || goalUncertainty >= 0.6,
  };

  const keyUncertainties = buildKeyUncertaintiesFromPolicy(goalUncertainty, factUncertainty, contextUncertainty, actionRisk);
  const confidence = input.taskState?.confidence ?? (1 - goalUncertainty);

  const taskState: CausalTaskState = {
    surfaceRequest: input.taskState?.surfaceRequest || input.surfaceRequest,
    latentGoalHypotheses: input.taskState?.latentGoalHypotheses ?? [],
    selectedLatentGoal: input.taskState?.selectedLatentGoal ?? "",
    keyUncertainties: keyUncertainties.length > 0 ? keyUncertainties : (input.taskState?.keyUncertainties ?? []),
    constraints: input.taskState?.constraints ?? [],
    candidateInterventions: input.taskState?.candidateInterventions ?? [],
    chosenIntervention: input.taskState?.chosenIntervention,
    alternativeInterventions: input.taskState?.alternativeInterventions ?? [],
    counterfactualRiskIfSkipped: input.taskState?.counterfactualRiskIfSkipped ?? "",
    expectedOutcomeLift: input.taskState?.expectedOutcomeLift ?? "",
    confidence,
    stopCondition: input.taskState?.stopCondition ?? "",
  };

  const alternativeInterventions = computeAlternativeInterventions(action, input);

  const decisionRecord: CausalDecisionRecord = {
    decisionId,
    source: "router_primary",
    decisionKind:
      phase === "run_start" ||
      phase === "clarification_resume" ||
      phase === "tool_request" ||
      phase === "completion"
        ? phase
        : "decision",
    taskState,
    policyDecision,
    chosenIntervention: action,
    alternativeInterventions,
    recordedAt,
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

export type CausalInterventionLevel = "record_only" | "advisory" | "enforcing";

export interface CausalPolicyBlockResult {
  blocked: boolean;
  reason: string;
}

/**
 * Apply causal policy gate to a routeIntervention result.
 *
 * In "record_only" mode, never blocks.
 * In "advisory" mode, blocks only for the strongest recommendations (request_approval, stop).
 * In "enforcing" mode, blocks whenever the policy disagrees with the proposed tool call.
 */
export function applyCausalPolicyGate(
  result: PolicyRouterOutput,
  level: CausalInterventionLevel,
): CausalPolicyBlockResult {
  if (level === "record_only") {
    return { blocked: false, reason: "" };
  }

  const action = result.action;

  // Actions that always pass through
  if (action === "use_tool" || action === "answer_directly") {
    return { blocked: false, reason: "" };
  }

  // In advisory mode, only block the strongest signals
  if (level === "advisory") {
    if (action === "request_approval") {
      return { blocked: true, reason: `Causal policy recommends approval for this tool (risk: ${result.policyDecision.actionRisk})` };
    }
    if (action === "stop") {
      return { blocked: true, reason: "Causal policy recommends stopping: diminishing returns" };
    }
    return { blocked: false, reason: "" };
  }

  // Enforcing mode: block all non-matching actions
  const reasonMap: Record<string, string> = {
    clarify: `Causal policy recommends clarifying with user (goal uncertainty: ${result.policyDecision.goalUncertainty})`,
    search_web: `Causal policy recommends searching web first (fact uncertainty: ${result.policyDecision.factUncertainty})`,
    read_context: `Causal policy recommends reading context first (context uncertainty: ${result.policyDecision.contextUncertainty})`,
    plan: `Causal policy recommends creating a plan first (goal uncertainty: ${result.policyDecision.goalUncertainty})`,
    request_approval: `Causal policy requires approval for this tool (risk: ${result.policyDecision.actionRisk})`,
    stop: "Causal policy recommends stopping: sufficient work done",
  };

  return {
    blocked: true,
    reason: reasonMap[action] ?? `Causal policy recommends ${action} instead of executing tool`,
  };
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
