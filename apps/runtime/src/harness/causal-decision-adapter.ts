import type { CausalDecisionRecord, CausalTaskState, InterventionAction, InterventionPolicyDecision } from "@cemeworm/shared";
import type { StateSnapshot } from "@cemeworm/shared";
import { classifyToolRisk, isSearchTool, isReadContextTool } from "@cemeworm/shared";
import {
  estimateGoalUncertainty,
  estimateFactUncertainty,
  estimateContextUncertainty,
  estimateActionRisk,
  type PolicyRouterInput,
} from "./causal-policy-router.js";

const ADAPTER_PREFIX = "[adapter-inferred]";

function buildRouterInputFromTrace(point: DecisionPoint, snapshot: StateSnapshot): PolicyRouterInput {
  return {
    surfaceRequest: snapshot.input?.prompt ?? "",
    taskState: undefined,
    proposedToolId: point.toolId,
    proposedToolRisk: point.toolRisk ?? "low",
    toolCallCount: snapshot.toolCalls.length,
    clarificationCount: point.hasClarification ? 1 : 0,
    hasPendingApprovals: point.hasApproval,
    hasPendingPlanDecisions: point.hasPlanDecision,
    hasUnresolvedPlanItems: point.hasPlanDecision,
    modelResponseText: "",
  };
}

/**
 * Infer pseudo CausalDecisionRecords from a StateSnapshot's trace events.
 * Used to make legacy runs (without causal.decision.recorded events) comparable
 * on causal evaluation metrics.
 */
export function adaptCausalDecisionsFromTrace(snapshot: StateSnapshot): CausalDecisionRecord[] {
  const decisions: CausalDecisionRecord[] = [];
  const decisionPoints = findDecisionPoints(snapshot);

  for (const point of decisionPoints) {
    const action = inferAction(point);
    const uncertainties = inferUncertainties(point, action, snapshot);
    const decision = buildDecisionRecord(action, uncertainties, point, snapshot);
    decisions.push(decision);
  }

  // If no decision points at all, produce a single answer_directly as fallback
  if (decisions.length === 0) {
    decisions.push(buildFallbackDecision(snapshot));
  }

  return decisions;
}

interface DecisionPoint {
  eventType?: string;
  toolId?: string;
  toolRisk?: "low" | "medium" | "high";
  hasClarification: boolean;
  hasApproval: boolean;
  hasPlanDecision: boolean;
  timestamp: number;
}

function findDecisionPoints(snapshot: StateSnapshot): DecisionPoint[] {
  const points: DecisionPoint[] = [];
  const seen = new Set<string>();

  // Scan events for clarification, approval, plan decisions
  for (const event of snapshot.events) {
    if (event.type === "clarification.required" && !seen.has("clarify")) {
      seen.add("clarify");
      points.push({
        eventType: "clarification.required",
        hasClarification: true,
        hasApproval: false,
        hasPlanDecision: false,
        timestamp: event.createdAt,
      });
    }
    if (event.type === "approval.required" && !seen.has("approval")) {
      seen.add("approval");
      points.push({
        eventType: "approval.required",
        hasClarification: false,
        hasApproval: true,
        hasPlanDecision: false,
        timestamp: event.createdAt,
      });
    }
    if (event.type === "plan.updated") {
      const payload = event.payload as Record<string, unknown> | undefined;
      const planItems = (payload?.items ?? []) as Array<{ status?: string }>;
      const hasPending = planItems.some((item) => item.status === "pending");
      if (hasPending && !seen.has("plan")) {
        seen.add("plan");
        points.push({
          eventType: "plan.updated",
          hasClarification: false,
          hasApproval: false,
          hasPlanDecision: true,
          timestamp: event.createdAt,
        });
      }
    }
  }

  // Scan toolCalls for tool-based decision points
  for (const call of snapshot.toolCalls) {
    const risk = classifyToolRisk(call.toolId);
    const key = `tool:${call.toolId}`;

    // Group same tool type into one decision point
    if (!seen.has(key)) {
      seen.add(key);
      points.push({
        toolId: call.toolId,
        toolRisk: risk,
        hasClarification: false,
        hasApproval: false,
        hasPlanDecision: false,
        timestamp: call.requestedAt ?? Date.now(),
      });
    }
  }

  // Sort by timestamp
  points.sort((a, b) => a.timestamp - b.timestamp);
  return points;
}

function inferAction(point: DecisionPoint): InterventionAction {
  if (point.hasApproval) return "request_approval";
  if (point.hasClarification) return "clarify";
  if (point.hasPlanDecision) return "plan";

  if (point.toolId) {
    if (isSearchTool(point.toolId)) return "search_web";
    if (isReadContextTool(point.toolId)) return "read_context";
    return "use_tool";
  }

  return "answer_directly";
}

function inferUncertainties(
  point: DecisionPoint,
  action: InterventionAction,
  snapshot: StateSnapshot,
): {
  goalUncertainty: number;
  factUncertainty: number;
  contextUncertainty: number;
  actionRisk: number;
  userCost: number;
  wouldChangeOutcomeIfWrong: boolean;
  reversibility: "low" | "medium" | "high";
} {
  const input = buildRouterInputFromTrace(point, snapshot);

  // Use router's estimation functions as the base, then apply action-semantic
  // overrides. The adapter has post-hoc knowledge of what action was taken,
  // which carries semantic information about the uncertainty that existed.
  let goalUncertainty = estimateGoalUncertainty(input);
  let factUncertainty = estimateFactUncertainty(input);
  let contextUncertainty = estimateContextUncertainty(input);
  let actionRisk = estimateActionRisk(input);

  // Action-semantic overrides: the fact that a certain action was taken signals
  // uncertainty dimensions that trace events alone may not capture.
  if (action === "clarify") goalUncertainty = Math.max(goalUncertainty, 0.7);
  if (action === "request_approval") actionRisk = Math.max(actionRisk, 0.8);
  if (action === "plan") goalUncertainty = Math.max(goalUncertainty, 0.5);
  if (action === "search_web") factUncertainty = Math.max(factUncertainty, 0.7);
  if (action === "read_context") contextUncertainty = Math.max(contextUncertainty, 0.6);

  // userCost and reversibility are action-dependent
  const clarificationCount = point.hasClarification ? 1 : 0;
  let userCost = 0.1;
  if (action === "clarify") userCost = Math.min(0.3 + clarificationCount * 0.15, 0.9);
  else if (action === "request_approval") userCost = 0.5;
  else if (action === "stop") userCost = 0.1;
  else if (action === "plan") userCost = 0.3;
  else if (action === "search_web") userCost = 0.2;
  else userCost = 0.05;

  let reversibility: "low" | "medium" | "high" = "high";
  if (point.toolRisk === "high") reversibility = "low";
  else if (point.toolRisk === "medium") reversibility = "medium";
  if (action === "request_approval") reversibility = "low";
  if (action === "plan") reversibility = "medium";

  const wouldChangeOutcomeIfWrong = actionRisk >= 0.5 || goalUncertainty >= 0.6;

  return {
    goalUncertainty,
    factUncertainty,
    contextUncertainty,
    actionRisk,
    userCost,
    wouldChangeOutcomeIfWrong,
    reversibility,
  };
}

function buildDecisionRecord(
  action: InterventionAction,
  uncertainties: ReturnType<typeof inferUncertainties>,
  point: DecisionPoint,
  snapshot: StateSnapshot,
): CausalDecisionRecord {
  const taskState: CausalTaskState = {
    surfaceRequest: snapshot.input?.prompt ?? "",
    latentGoalHypotheses: [],
    selectedLatentGoal: "",
    keyUncertainties: buildKeyUncertainties(uncertainties, action),
    constraints: [],
    candidateInterventions: [],
    chosenIntervention: action,
    alternativeInterventions: [],
    counterfactualRiskIfSkipped: "",
    expectedOutcomeLift: "",
    confidence: action === "answer_directly" ? 0.7 : 0.4,
    stopCondition: "",
  };

  const policyDecision: InterventionPolicyDecision = {
    goalUncertainty: uncertainties.goalUncertainty,
    factUncertainty: uncertainties.factUncertainty,
    contextUncertainty: uncertainties.contextUncertainty,
    actionRisk: uncertainties.actionRisk,
    userCost: uncertainties.userCost,
    reversibility: uncertainties.reversibility,
    recommendedAction: action,
    reason: `${ADAPTER_PREFIX} ${buildReason(action, point)}`,
    wouldChangeOutcomeIfWrong: uncertainties.wouldChangeOutcomeIfWrong,
  };

  return {
    taskState,
    policyDecision,
    chosenIntervention: action,
    alternativeInterventions: [],
    recordedAt: point.timestamp,
  };
}

function buildFallbackDecision(snapshot: StateSnapshot): CausalDecisionRecord {
  const taskState: CausalTaskState = {
    surfaceRequest: snapshot.input?.prompt ?? "",
    latentGoalHypotheses: [],
    selectedLatentGoal: "",
    keyUncertainties: [],
    constraints: [],
    candidateInterventions: [],
    chosenIntervention: "answer_directly",
    alternativeInterventions: [],
    counterfactualRiskIfSkipped: "",
    expectedOutcomeLift: "",
    confidence: 0.5,
    stopCondition: "",
  };

  const policyDecision: InterventionPolicyDecision = {
    goalUncertainty: 0.2,
    factUncertainty: 0.2,
    contextUncertainty: 0.2,
    actionRisk: 0.1,
    userCost: 0.1,
    reversibility: "high",
    recommendedAction: "answer_directly",
    reason: `${ADAPTER_PREFIX} no trace signals found, defaulting to answer_directly`,
    wouldChangeOutcomeIfWrong: false,
  };

  return {
    taskState,
    policyDecision,
    chosenIntervention: "answer_directly",
    alternativeInterventions: [],
    recordedAt: snapshot.updatedAt ?? Date.now(),
  };
}

function buildReason(action: InterventionAction, point: DecisionPoint): string {
  switch (action) {
    case "clarify":
      return "clarification.required event detected in trace";
    case "request_approval":
      return "approval.required event detected in trace";
    case "plan":
      return "plan.updated event with pending items detected in trace";
    case "search_web":
      return `search tool call detected: ${point.toolId}`;
    case "read_context":
      return `read-context tool call detected: ${point.toolId}`;
    case "use_tool":
      return `tool call detected: ${point.toolId}`;
    case "answer_directly":
      return "no tool, clarification, or approval signals in trace";
    case "stop":
      return "multiple tool calls suggest diminishing returns";
  }
}

function buildKeyUncertainties(
  u: ReturnType<typeof inferUncertainties>,
  _action: InterventionAction,
): string[] {
  const items: string[] = [];
  if (u.goalUncertainty >= 0.5) items.push("用户目标不明确");
  if (u.factUncertainty >= 0.5) items.push("事实信息缺失");
  if (u.contextUncertainty >= 0.5) items.push("上下文不足");
  if (u.actionRisk >= 0.5) items.push("行动风险较高");
  return items;
}


