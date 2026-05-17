import type { CausalDecisionRecord, CausalTaskState, InterventionAction, InterventionPolicyDecision } from "@cemeworm/shared";
import type { StateSnapshot } from "@cemeworm/shared";

const ADAPTER_PREFIX = "[adapter-inferred]";

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
    const uncertainties = inferUncertainties(point, action);
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
      const planItems = (payload?.items ?? payload?.plan ?? []) as Array<{ status?: string }>;
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
    const risk = classifySnapshotToolRisk(call.toolId);
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
): {
  goalUncertainty: number;
  factUncertainty: number;
  contextUncertainty: number;
  actionRisk: number;
  userCost: number;
  wouldChangeOutcomeIfWrong: boolean;
  reversibility: "low" | "medium" | "high";
} {
  let goalUncertainty = 0.2;
  let factUncertainty = 0.2;
  let contextUncertainty = 0.2;
  let actionRisk = 0.1;
  let userCost = 0.1;
  let reversibility: "low" | "medium" | "high" = "high";

  switch (action) {
    case "clarify":
      goalUncertainty = 0.7;
      userCost = 0.6;
      reversibility = "high";
      break;
    case "search_web":
      factUncertainty = 0.7;
      contextUncertainty = 0.3;
      userCost = 0.2;
      reversibility = "high";
      break;
    case "read_context":
      contextUncertainty = 0.6;
      factUncertainty = 0.3;
      userCost = 0.1;
      reversibility = "high";
      break;
    case "request_approval":
      actionRisk = 0.8;
      goalUncertainty = 0.4;
      userCost = 0.5;
      reversibility = "low";
      break;
    case "plan":
      goalUncertainty = 0.5;
      contextUncertainty = 0.4;
      userCost = 0.3;
      reversibility = "medium";
      break;
    case "use_tool":
      actionRisk = point.toolRisk === "high" ? 0.5 : point.toolRisk === "medium" ? 0.3 : 0.1;
      contextUncertainty = 0.2;
      userCost = 0.1;
      reversibility = point.toolRisk === "high" ? "low" : "medium";
      break;
    case "stop":
      reversibility = "high";
      break;
    case "answer_directly":
    default:
      // Low everything — the agent is confident enough to answer
      break;
  }

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

function isSearchTool(toolId: string): boolean {
  const searchTools = ["web.search", "web.fetch", "web_search", "web_fetch", "search", "browser.navigate"];
  return searchTools.some((t) => toolId === t || toolId.startsWith(`${t}.`));
}

function isReadContextTool(toolId: string): boolean {
  const readTools = [
    "file.read", "file.grep", "file.glob", "file.list",
    "file_read", "file_grep", "file_glob", "file_list",
    "read", "grep", "glob",
  ];
  return readTools.some((t) => toolId === t || toolId.startsWith(`${t}.`));
}

function classifySnapshotToolRisk(toolId: string): "low" | "medium" | "high" {
  const highRisk = ["shell", "file.write", "file.patch", "file.delete", "file.move", "browser"];
  const mediumRisk = ["file.create", "git", "npm", "pnpm", "yarn"];

  for (const prefix of highRisk) {
    if (toolId === prefix || toolId.startsWith(`${prefix}.`)) return "high";
  }
  for (const prefix of mediumRisk) {
    if (toolId === prefix || toolId.startsWith(`${prefix}.`)) return "medium";
  }
  return "low";
}
