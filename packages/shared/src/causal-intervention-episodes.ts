import { z } from "zod";
import type { ActionRecord, OraToolCallEnvelope } from "./actions.js";
import type { StateSnapshot, OraEventEnvelope, PlanDecisionGate, PendingClarification } from "./runtime.js";
import {
  CausalDecisionRecordSchema,
  CausalDecisionSourceSchema,
  CausalInterventionSignificanceSchema,
  type CausalDecisionRecord,
  type CausalDecisionSource,
  type CausalInterventionSignificance,
  type InterventionAction,
} from "./interventions.js";

export const CausalInterventionEpisodeStatusSchema = z.enum([
  "applied",
  "resolved",
  "pending",
  "blocked",
  "superseded",
  "abandoned",
  "unknown",
]);
export type CausalInterventionEpisodeStatus = z.infer<typeof CausalInterventionEpisodeStatusSchema>;

export const CausalInterventionGoalImpactSchema = z.enum([
  "strong_positive",
  "weak_positive",
  "neutral",
  "negative",
  "unknown",
]);
export type CausalInterventionGoalImpact = z.infer<typeof CausalInterventionGoalImpactSchema>;

export const CausalInterventionEvidenceKindSchema = z.enum([
  "tool_call",
  "clarification_gate",
  "approval_gate",
  "plan_gate",
  "reply_message",
  "superseded",
  "missing",
]);
export type CausalInterventionEvidenceKind = z.infer<typeof CausalInterventionEvidenceKindSchema>;

export const CausalInterventionEpisodeSchema = z.object({
  episodeId: z.string().min(1),
  decisionId: z.string().min(1),
  eventId: z.string().min(1).optional(),
  runId: z.string().min(1),
  turnIndex: z.number().int().positive(),
  recordedAt: z.number().int().nonnegative(),
  source: CausalDecisionSourceSchema,
  effective: z.boolean(),
  chosenIntervention: z.string().min(1),
  phase: z.string().min(1).optional(),
  replyMessageId: z.string().min(1).optional(),
  iteration: z.number().int().nonnegative().optional(),
  agentId: z.string().min(1).optional(),
  nodeId: z.string().min(1).optional(),
  toolId: z.string().min(1).optional(),
  actionId: z.string().min(1).optional(),
  toolCallId: z.string().min(1).optional(),
  providerCallId: z.string().min(1).optional(),
  clarificationId: z.string().min(1).optional(),
  planDecisionId: z.string().min(1).optional(),
  evidenceKind: CausalInterventionEvidenceKindSchema,
  evidenceMessageId: z.string().min(1).optional(),
  evidenceStartSeq: z.number().int().nonnegative().optional(),
  evidenceEndSeq: z.number().int().nonnegative().optional(),
  surfaceRequest: z.string(),
  selectedLatentGoal: z.string(),
  keyUncertainties: z.array(z.string()),
  reason: z.string(),
  goalUncertainty: z.number().min(0).max(1),
  factUncertainty: z.number().min(0).max(1),
  contextUncertainty: z.number().min(0).max(1),
  actionRisk: z.number().min(0).max(1),
  userCost: z.number().min(0).max(1),
  reversibility: z.enum(["low", "medium", "high"]),
  wouldChangeOutcomeIfWrong: z.boolean(),
  status: CausalInterventionEpisodeStatusSchema,
  goalImpact: CausalInterventionGoalImpactSchema,
  outcomeSummary: z.string(),
  significance: CausalInterventionSignificanceSchema,
});
export type CausalInterventionEpisode = z.infer<typeof CausalInterventionEpisodeSchema>;

type EpisodeSnapshot = Pick<
  StateSnapshot,
  "runId" | "turnIndex" | "status" | "events" | "toolCalls" | "actions" | "planDecisions" | "pendingClarifications"
>;

interface DecisionCarrier {
  record: CausalDecisionRecord;
  event?: Pick<OraEventEnvelope, "id" | "runId" | "createdAt" | "agentId" | "nodeId">;
}

interface AssistantMessageEvidence {
  messageId?: string;
  startSeq?: number;
  endSeq?: number;
}

export function extractCausalDecisionRecords(snapshot: Pick<StateSnapshot, "events">): CausalDecisionRecord[] {
  return snapshot.events
    .filter((event) => event.type === "causal.decision.recorded")
    .map((event) => CausalDecisionRecordSchema.parse(event.payload));
}

export function deriveCausalInterventionEpisodes(
  snapshot: EpisodeSnapshot,
  decisions?: readonly unknown[],
): CausalInterventionEpisode[] {
  const toolCalls = snapshot.toolCalls ?? [];
  const actions = snapshot.actions ?? [];
  const planDecisions = snapshot.planDecisions ?? [];
  const pendingClarifications = snapshot.pendingClarifications ?? [];
  const carriers = decisions
    ? decisions.map((decision, index) => ({
        record: normalizeDecisionRecord(decision, {
          fallbackId: `${snapshot.runId}:decision:${index}`,
          fallbackRecordedAt: snapshot.events.at(index)?.createdAt ?? 0,
        }),
      }))
    : snapshot.events
        .filter((event) => event.type === "causal.decision.recorded")
        .map((event, index) => ({
          record: normalizeDecisionRecord(event.payload, {
            fallbackId: event.id,
            fallbackRecordedAt: event.createdAt,
          }),
          event: {
            id: event.id,
            runId: event.runId,
            createdAt: event.createdAt,
            agentId: event.agentId,
            nodeId: event.nodeId,
          },
        }));

  return carriers.map((carrier, index) => buildEpisode({
    ...snapshot,
    toolCalls,
    actions,
    planDecisions,
    pendingClarifications,
  }, carrier, carriers.slice(index + 1)));
}

function normalizeDecisionRecord(
  input: unknown,
  fallback: { fallbackId: string; fallbackRecordedAt: number },
): CausalDecisionRecord {
  const parsed = CausalDecisionRecordSchema.parse(input);
  return {
    ...parsed,
    decisionId: parsed.decisionId ?? fallback.fallbackId,
    source: parsed.source ?? inferDecisionSource(parsed),
    decisionKind: parsed.decisionKind ?? inferDecisionKind(parsed),
    recordedAt: parsed.recordedAt ?? fallback.fallbackRecordedAt,
  };
}

function inferDecisionSource(record: CausalDecisionRecord): CausalDecisionSource {
  if (record.policyDecision.reason.startsWith("[adapter-inferred]")) return "adapter_inferred";
  const phase = record.decisionContext?.phase;
  if (phase === "clarification_triggered" || phase === "approval_triggered" || phase === "plan_updated") {
    return "runtime_followup";
  }
  return "router_primary";
}

function inferDecisionKind(record: CausalDecisionRecord): CausalDecisionRecord["decisionKind"] {
  const phase = record.decisionContext?.phase;
  if (
    phase === "run_start" ||
    phase === "clarification_resume" ||
    phase === "tool_request" ||
    phase === "completion" ||
    phase === "clarification_triggered" ||
    phase === "approval_triggered" ||
    phase === "plan_updated"
  ) {
    return phase;
  }
  return record.source === "adapter_inferred" ? "adapter_inferred" : "decision";
}

function buildEpisode(
  snapshot: EpisodeSnapshot,
  carrier: DecisionCarrier,
  laterCarriers: readonly DecisionCarrier[],
): CausalInterventionEpisode {
  const record = carrier.record;
  const context = record.decisionContext ?? {};
  const turnIndex = context.turnIndex ?? snapshot.turnIndex ?? 1;
  const source = record.source ?? inferDecisionSource(record);
  const laterRelatedDecision = laterCarriers.find((candidate) =>
    isPotentialSuccessor(record, candidate.record, snapshot.turnIndex ?? 1)
  );
  const laterRelatedDecisionAt = laterRelatedDecision?.record.recordedAt;
  const toolCall = findRelatedToolCall(snapshot.toolCalls, record, laterRelatedDecisionAt);
  const action = findRelatedAction(snapshot.actions, record, toolCall);
  const clarifications = findClarificationOutcome(snapshot.events, snapshot.pendingClarifications, record);
  const planDecision = findPlanDecision(snapshot.planDecisions, record);
  const rejected = findRejectedOutcome(snapshot.events, record);
  const replyEvidence = findReplyEvidence(snapshot.events, record, laterRelatedDecisionAt);
  const outcome = resolveOutcome({
    snapshotStatus: snapshot.status,
    record,
    toolCall,
    action,
    clarifications,
    planDecision,
    rejected,
    laterRelatedDecision,
    replyEvidence,
  });

  return CausalInterventionEpisodeSchema.parse({
    episodeId: carrier.event?.id ?? record.decisionId ?? `${snapshot.runId}:episode:${record.recordedAt}`,
    decisionId: record.decisionId ?? `${snapshot.runId}:decision:${record.recordedAt}`,
    eventId: carrier.event?.id,
    runId: carrier.event?.runId ?? snapshot.runId,
    turnIndex,
    recordedAt: record.recordedAt,
    source,
    chosenIntervention: record.chosenIntervention,
    phase: context.phase,
    iteration: context.iteration,
    agentId: carrier.event?.agentId ?? context.agentId,
    nodeId: carrier.event?.nodeId ?? context.nodeId,
    toolId: context.toolId ?? toolCall?.toolId,
    actionId: context.actionId ?? action?.id ?? toolCall?.actionId,
    toolCallId: context.toolCallId ?? toolCall?.id,
    providerCallId: context.providerCallId ?? toolCall?.providerCallId,
    clarificationId: context.clarificationId ?? clarifications.id,
    planDecisionId: context.planDecisionId ?? planDecision?.id,
    evidenceKind: outcome.evidenceKind,
    evidenceMessageId: outcome.evidenceMessageId,
    evidenceStartSeq: outcome.evidenceStartSeq,
    evidenceEndSeq: outcome.evidenceEndSeq,
    surfaceRequest: record.taskState.surfaceRequest,
    selectedLatentGoal: record.taskState.selectedLatentGoal,
    keyUncertainties: record.taskState.keyUncertainties,
    reason: record.policyDecision.reason,
    goalUncertainty: record.policyDecision.goalUncertainty,
    factUncertainty: record.policyDecision.factUncertainty,
    contextUncertainty: record.policyDecision.contextUncertainty,
    actionRisk: record.policyDecision.actionRisk,
    userCost: record.policyDecision.userCost,
    reversibility: record.policyDecision.reversibility,
    wouldChangeOutcomeIfWrong: record.policyDecision.wouldChangeOutcomeIfWrong,
    effective: outcome.effective,
    replyMessageId: replyEvidence?.messageId ?? context.replyMessageId,
    status: outcome.status,
    goalImpact: outcome.goalImpact,
    outcomeSummary: outcome.summary,
    significance: classifySignificance(record, outcome, snapshot.turnIndex ?? 1, laterCarriers),
  });
}

function findRelatedToolCall(
  toolCalls: readonly OraToolCallEnvelope[] | undefined,
  record: CausalDecisionRecord,
  nextDecisionAt?: number,
): OraToolCallEnvelope | undefined {
  if (!toolCalls) return undefined;
  const context = record.decisionContext ?? {};
  if (context.toolCallId) return toolCalls.find((call) => call.id === context.toolCallId);
  if (context.providerCallId) return toolCalls.find((call) => call.providerCallId === context.providerCallId);
  if (context.actionId) {
    const exactActionMatch = toolCalls.find((call) => call.actionId === context.actionId);
    if (exactActionMatch) return exactActionMatch;
  }
  const windowStart = record.recordedAt - 5_000;
  const windowEnd = nextDecisionAt !== undefined ? nextDecisionAt + 15_000 : record.recordedAt + 60_000;
  const candidates = toolCalls.filter((call) =>
    (!context.toolId || call.toolId === context.toolId) &&
    (!context.agentId || call.agentId === context.agentId) &&
    (!context.nodeId || call.nodeId === context.nodeId) &&
    (!context.actionId || call.actionId === context.actionId) &&
    call.requestedAt >= windowStart &&
    call.requestedAt <= windowEnd
  );
  return candidates.sort((left, right) => toolCallDistance(left, record.recordedAt) - toolCallDistance(right, record.recordedAt))[0];
}

function findRelatedAction(
  actions: readonly ActionRecord[] | undefined,
  record: CausalDecisionRecord,
  toolCall?: OraToolCallEnvelope,
): ActionRecord | undefined {
  if (!actions) return undefined;
  const context = record.decisionContext ?? {};
  if (context.actionId) return actions.find((action) => action.id === context.actionId);
  if (toolCall?.actionId) return actions.find((action) => action.id === toolCall.actionId);
  const candidates = actions.filter((action) =>
    (!context.toolId || action.type === context.toolId) &&
    (!context.agentId || action.agentId === context.agentId)
  );
  return candidates[0];
}

function findClarificationOutcome(
  events: readonly OraEventEnvelope[] | undefined,
  pendingClarifications: readonly PendingClarification[] | undefined,
  record: CausalDecisionRecord,
): { id?: string; required: boolean; resolved: boolean } {
  const runtimeEvents = events ?? [];
  const clarificationList = pendingClarifications ?? [];
  const context = record.decisionContext ?? {};
  const requiredEvent = runtimeEvents.find((event) =>
    event.type === "clarification.required" &&
    event.createdAt >= record.recordedAt &&
    (!context.nodeId || event.nodeId === context.nodeId)
  );
  const requiredPayload = requiredEvent?.payload as Record<string, unknown> | undefined;
  const requiredClarification = isRecord(requiredPayload?.clarification) ? requiredPayload?.clarification : undefined;
  const requiredId = readString(requiredClarification?.id)
    ?? context.clarificationId
    ?? clarificationList.find((item) => !context.nodeId || item.nodeId === context.nodeId)?.id;
  const resolvedEvent = requiredId
    ? runtimeEvents.find((event) =>
        event.type === "clarification.resolved" &&
        readString((event.payload as Record<string, unknown> | undefined)?.clarificationId) === requiredId
      )
    : undefined;
  return { id: requiredId, required: Boolean(requiredEvent ?? requiredId), resolved: Boolean(resolvedEvent) };
}

function findPlanDecision(
  planDecisions: readonly PlanDecisionGate[] | undefined,
  record: CausalDecisionRecord,
): PlanDecisionGate | undefined {
  if (!planDecisions) return undefined;
  const context = record.decisionContext ?? {};
  if (context.planDecisionId) return planDecisions.find((decision) => decision.id === context.planDecisionId);
  return planDecisions.find((decision) => decision.createdAt >= record.recordedAt);
}

function findRejectedOutcome(
  events: readonly OraEventEnvelope[] | undefined,
  record: CausalDecisionRecord,
): { rejected: boolean; reason?: string } {
  const runtimeEvents = events ?? [];
  const context = record.decisionContext ?? {};
  const rejectedEvent = runtimeEvents.find((event) => {
    if (event.type !== "causal.decision.rejected" || event.createdAt < record.recordedAt) return false;
    const payload = event.payload as Record<string, unknown> | undefined;
    const toolId = readString(payload?.toolId);
    return !context.toolId || toolId === context.toolId;
  });
  const payload = rejectedEvent?.payload as Record<string, unknown> | undefined;
  return { rejected: Boolean(rejectedEvent), reason: readString(payload?.reason) };
}

function resolveOutcome(params: {
  snapshotStatus: StateSnapshot["status"];
  record: CausalDecisionRecord;
  toolCall?: OraToolCallEnvelope;
  action?: ActionRecord;
  clarifications: { id?: string; required: boolean; resolved: boolean };
  planDecision?: PlanDecisionGate;
  rejected: { rejected: boolean; reason?: string };
  laterRelatedDecision?: DecisionCarrier;
  replyEvidence?: AssistantMessageEvidence;
}): {
  effective: boolean;
  status: CausalInterventionEpisodeStatus;
  goalImpact: CausalInterventionGoalImpact;
  summary: string;
  evidenceKind: CausalInterventionEvidenceKind;
  evidenceMessageId?: string;
  evidenceStartSeq?: number;
  evidenceEndSeq?: number;
} {
  const intervention = params.record.chosenIntervention;

  if (params.rejected.rejected) {
    return {
      effective: true,
      status: "blocked",
      goalImpact: "weak_positive",
      summary: params.rejected.reason ?? "该干预对应的工具尝试被因果策略阻断。",
      evidenceKind: evidenceKindForIntervention(intervention),
    };
  }

  if ((intervention === "clarify" || params.record.decisionContext?.phase === "clarification_triggered")) {
    if (params.clarifications.resolved) {
      return {
        effective: true,
        status: "resolved",
        goalImpact: "strong_positive",
        summary: "已触发澄清并收到用户补充信息，运行继续推进。",
        evidenceKind: "clarification_gate",
      };
    }
    if (params.clarifications.required) {
      return {
        effective: true,
        status: "pending",
        goalImpact: "neutral",
        summary: "已触发澄清，当前仍在等待用户补充信息。",
        evidenceKind: "clarification_gate",
      };
    }
  }

  if (intervention === "request_approval" || params.record.decisionContext?.phase === "approval_triggered") {
    if (params.toolCall?.status === "succeeded" || params.action?.status === "succeeded") {
      return {
        effective: true,
        status: "resolved",
        goalImpact: "strong_positive",
        summary: "高风险动作已完成审批并成功执行。",
        evidenceKind: "approval_gate",
      };
    }
    if (params.action?.status === "denied" || params.toolCall?.status === "denied") {
      return {
        effective: true,
        status: "resolved",
        goalImpact: "neutral",
        summary: "该高风险动作被拒绝执行，风险已被拦下。",
        evidenceKind: "approval_gate",
      };
    }
    if (params.action?.status === "approval_required" || params.toolCall?.status === "approval_required") {
      return {
        effective: true,
        status: "pending",
        goalImpact: "neutral",
        summary: "已进入审批关卡，等待用户确认后继续。",
        evidenceKind: "approval_gate",
      };
    }
  }

  if (intervention === "plan" || params.record.decisionContext?.phase === "plan_updated") {
    if (params.planDecision?.status === "accepted") {
      return {
        effective: true,
        status: "resolved",
        goalImpact: "weak_positive",
        summary: "计划决策已被接受，并作为后续执行依据保留。",
        evidenceKind: "plan_gate",
      };
    }
    if (params.planDecision?.status === "declined") {
      return {
        effective: true,
        status: "resolved",
        goalImpact: "neutral",
        summary: "计划决策已被拒绝，未继续推进后续执行。",
        evidenceKind: "plan_gate",
      };
    }
    if (params.planDecision?.status === "pending") {
      return {
        effective: true,
        status: "pending",
        goalImpact: "neutral",
        summary: "已形成计划决策，当前等待用户确认。",
        evidenceKind: "plan_gate",
      };
    }
  }

  if (params.toolCall) {
    if (params.toolCall.status === "succeeded") {
      return {
        effective: true,
        status: "resolved",
        goalImpact: "strong_positive",
        summary: `已执行 ${params.toolCall.toolId}，并产出成功结果。`,
        evidenceKind: "tool_call",
      };
    }
    if (params.toolCall.status === "failed" || params.action?.status === "failed") {
      return {
        effective: true,
        status: "resolved",
        goalImpact: "negative",
        summary: `已尝试执行 ${params.toolCall.toolId}，但结果失败。`,
        evidenceKind: "tool_call",
      };
    }
    if (params.toolCall.status === "approval_required" || params.toolCall.status === "running" || params.toolCall.status === "proposed") {
      return {
        effective: true,
        status: "pending",
        goalImpact: "unknown",
        summary: `已进入 ${params.toolCall.toolId} 执行链路，当前尚未得到最终结果。`,
        evidenceKind: "tool_call",
      };
    }
  }

  if (params.replyEvidence?.messageId || params.replyEvidence?.startSeq !== undefined) {
    return {
      effective: true,
      status: "resolved",
      goalImpact: intervention === "answer_directly" || intervention === "stop" ? "weak_positive" : "unknown",
      summary:
        intervention === "answer_directly"
          ? "本轮以直接回答形成了独立回复证据。"
          : intervention === "stop"
            ? "停止策略形成了独立回复证据。"
            : "该决策已形成独立的回复证据。",
      evidenceKind: "reply_message",
      evidenceMessageId: params.replyEvidence.messageId,
      evidenceStartSeq: params.replyEvidence.startSeq,
      evidenceEndSeq: params.replyEvidence.endSeq,
    };
  }

  if (intervention === "answer_directly") {
    if (params.snapshotStatus === "succeeded") {
      return {
        effective: false,
        status: "unknown",
        goalImpact: "unknown",
        summary: "本轮成功结束，但未找到可归因到该决策的独立回复证据。",
        evidenceKind: "missing",
      };
    }
  }

  if (intervention === "stop") {
    if (params.snapshotStatus === "succeeded") {
      return {
        effective: false,
        status: "unknown",
        goalImpact: "unknown",
        summary: "运行已收束，但未找到可归因到该停止策略的独立证据。",
        evidenceKind: "missing",
      };
    }
  }

  if (params.laterRelatedDecision) {
    return {
      effective: false,
      status: "superseded",
      goalImpact: "neutral",
      summary: "该决策在形成独立执行证据前，被后续主决策接管。",
      evidenceKind: "superseded",
    };
  }

  return {
    effective: false,
    status: "unknown",
    goalImpact: "unknown",
    summary: "暂未观察到该决策形成独立干预的足够证据。",
    evidenceKind: "missing",
  };
}

function evidenceKindForIntervention(intervention: InterventionAction): CausalInterventionEvidenceKind {
  switch (intervention) {
    case "clarify":
      return "clarification_gate";
    case "request_approval":
      return "approval_gate";
    case "plan":
      return "plan_gate";
    case "answer_directly":
    case "stop":
      return "reply_message";
    default:
      return "tool_call";
  }
}

export function classifySignificance(
  record: CausalDecisionRecord,
  outcome: {
    effective: boolean;
    status: string;
    evidenceKind: CausalInterventionEvidenceKind;
  },
  fallbackTurnIndex: number,
  laterCarriers: readonly DecisionCarrier[],
): CausalInterventionSignificance {
  const intervention = record.chosenIntervention;
  const phase = record.decisionContext?.phase;
  const context = record.decisionContext ?? {};
  const currentTurn = context.turnIndex ?? fallbackTurnIndex;

  // strategic: gates and critical interventions
  if (outcome.evidenceKind === "clarification_gate") return "strategic";
  if (outcome.evidenceKind === "approval_gate") return "strategic";
  if (outcome.evidenceKind === "plan_gate") return "strategic";
  if (outcome.evidenceKind === "superseded") return "strategic";
  if (intervention === "stop") return "strategic";

  // strategic: tool blocked/abandoned but agent recovered with another tool in same turn
  if (
    outcome.evidenceKind === "tool_call" &&
    (outcome.status === "blocked" || outcome.status === "abandoned")
  ) {
    if (outcome.effective) {
      const hasRecovery = laterCarriers.some((carrier) => {
        const nextContext = carrier.record.decisionContext ?? {};
        const nextTurn = nextContext.turnIndex ?? fallbackTurnIndex;
        return nextTurn === currentTurn
          && (nextContext.phase === "tool_request" || carrier.record.chosenIntervention === "use_tool");
      });
      if (hasRecovery) return "strategic";
    }
  }

  // tactical: explicit information-gathering choices (search_web / read_context)
  if (
    intervention === "search_web" || intervention === "read_context" ||
    phase === "tool_request" && (context.toolId === "web.search" || context.toolId === "web.fetch" || context.toolId === "file.read" || context.toolId === "file.grep" || context.toolId === "file.glob")
  ) {
    if (outcome.effective) return "tactical";
  }

  // trace: everything else
  return "trace";
}

const CausalDecisionChainSchema = z.object({
  chainId: z.string().min(1),
  label: z.string().min(1),
  turnIndex: z.number().int().positive(),
  episodeCount: z.number().int().nonnegative(),
  entryGoalUncertainty: z.number().min(0).max(1),
  exitGoalUncertainty: z.number().min(0).max(1),
  dominantIntervention: z.string().min(1),
});
export type CausalDecisionChain = z.infer<typeof CausalDecisionChainSchema>;

export function deriveCausalDecisionChains(
  episodes: readonly CausalInterventionEpisode[],
): CausalDecisionChain[] {
  const chainMap = new Map<string, CausalInterventionEpisode[]>();

  for (const episode of episodes) {
    if (!episode.effective) continue;
    const groupKey = `${episode.turnIndex}:${episode.agentId ?? "default"}`;
    const group = chainMap.get(groupKey);
    if (group) {
      group.push(episode);
    } else {
      chainMap.set(groupKey, [episode]);
    }
  }

  const chains: CausalDecisionChain[] = [];
  for (const [groupKey, group] of chainMap) {
    const sorted = group.sort((a, b) => a.recordedAt - b.recordedAt);
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    if (!first || !last) continue;

    const significancePriority: Record<CausalInterventionSignificance, number> = {
      strategic: 3,
      tactical: 2,
      trace: 1,
    };
    let dominant = first;
    for (const episode of sorted) {
      if (significancePriority[episode.significance] > significancePriority[dominant.significance]) {
        dominant = episode;
      }
    }

    chains.push(CausalDecisionChainSchema.parse({
      chainId: groupKey,
      label: `第 ${first.turnIndex} 轮`,
      turnIndex: first.turnIndex,
      episodeCount: group.length,
      entryGoalUncertainty: first.goalUncertainty,
      exitGoalUncertainty: last.goalUncertainty,
      dominantIntervention: dominant.chosenIntervention,
    }));
  }

  return chains.sort((a, b) => a.turnIndex - b.turnIndex);
}

function toolCallDistance(call: OraToolCallEnvelope, recordedAt: number): number {
  const drift = Math.abs(call.requestedAt - recordedAt);
  return call.requestedAt >= recordedAt ? drift : drift + 250;
}

function isPotentialSuccessor(
  record: CausalDecisionRecord,
  candidate: CausalDecisionRecord,
  fallbackTurnIndex: number,
): boolean {
  const current = record.decisionContext ?? {};
  const next = candidate.decisionContext ?? {};
  const currentTurn = current.turnIndex ?? fallbackTurnIndex;
  const nextTurn = next.turnIndex ?? fallbackTurnIndex;
  if (currentTurn !== nextTurn) return false;
  if (current.agentId && next.agentId && current.agentId !== next.agentId) return false;
  if (current.nodeId && next.nodeId && current.nodeId !== next.nodeId) return false;
  if (
    current.phase === "tool_request" &&
    next.phase === "tool_request" &&
    current.toolId &&
    next.toolId &&
    current.toolId !== next.toolId
  ) {
    return false;
  }
  return candidate.recordedAt > record.recordedAt;
}

function findReplyEvidence(
  events: readonly OraEventEnvelope[] | undefined,
  record: CausalDecisionRecord,
  nextDecisionAt?: number,
): AssistantMessageEvidence | undefined {
  if (!events?.length) return undefined;
  const context = record.decisionContext ?? {};
  const groups = groupAssistantMessageEvents(events, context.agentId, context.nodeId);
  if (groups.length === 0) return undefined;
  if (context.replyMessageId) {
    const exact = groups.find((group) => group.messageId === context.replyMessageId);
    if (exact) {
      return { messageId: exact.messageId, startSeq: exact.startSeq, endSeq: exact.endSeq };
    }
  }
  const windowStart = record.recordedAt - 2_000;
  const windowEnd = nextDecisionAt !== undefined ? nextDecisionAt + 15_000 : record.recordedAt + 90_000;
  const candidates = groups.filter((group) =>
    group.endAt >= windowStart &&
    group.startAt <= windowEnd
  );
  const best = candidates.sort((left, right) =>
    assistantGroupDistance(left, record.recordedAt) - assistantGroupDistance(right, record.recordedAt)
  )[0];
  return best
    ? { messageId: best.messageId, startSeq: best.startSeq, endSeq: best.endSeq }
    : undefined;
}

function groupAssistantMessageEvents(
  events: readonly OraEventEnvelope[],
  agentId?: string,
  nodeId?: string,
): Array<{ messageId?: string; startSeq: number; endSeq: number; startAt: number; endAt: number }> {
  const groups = new Map<string, { messageId?: string; startSeq: number; endSeq: number; startAt: number; endAt: number }>();
  for (const event of events) {
    if (event.type !== "message.delta" || !isRecord(event.payload)) continue;
    const payload = event.payload;
    const role = readString(payload.role);
    if (role && role !== "assistant") continue;
    if (payload.visibility === "internal" || payload.visibility === "collaboration") continue;
    if (payload.audience === "internal" || payload.audience === "collaboration") continue;
    if (payload.surface === "collaboration" || payload.public === false) continue;
    if (agentId && event.agentId && event.agentId !== agentId) continue;
    if (nodeId && event.nodeId && event.nodeId !== nodeId) continue;
    const messageId = readString(payload.messageId);
    const groupKey = messageId ?? `${event.agentId ?? "__default__"}:${event.nodeId ?? "__default__"}:${event.seq}`;
    const existing = groups.get(groupKey);
    if (!existing) {
      groups.set(groupKey, {
        messageId,
        startSeq: event.seq,
        endSeq: event.seq,
        startAt: event.createdAt,
        endAt: event.createdAt,
      });
      continue;
    }
    existing.startSeq = Math.min(existing.startSeq, event.seq);
    existing.endSeq = Math.max(existing.endSeq, event.seq);
    existing.startAt = Math.min(existing.startAt, event.createdAt);
    existing.endAt = Math.max(existing.endAt, event.createdAt);
  }
  return [...groups.values()];
}

function assistantGroupDistance(
  group: { startAt: number; endAt: number },
  recordedAt: number,
): number {
  if (group.startAt >= recordedAt) return group.startAt - recordedAt;
  if (group.endAt >= recordedAt) return 0;
  return recordedAt - group.endAt + 50;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
