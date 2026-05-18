import { z } from "zod";
import type { ActionRecord, OraToolCallEnvelope } from "./actions.js";
import type { StateSnapshot, OraEventEnvelope, PlanDecisionGate, PendingClarification } from "./runtime.js";
import {
  CausalDecisionRecordSchema,
  CausalDecisionSourceSchema,
  type CausalDecisionRecord,
  type CausalDecisionSource,
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
  clarificationId: z.string().min(1).optional(),
  planDecisionId: z.string().min(1).optional(),
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
  const effective = source !== "runtime_followup";
  const laterEffectiveDecision = laterCarriers.find((candidate) => {
    const sourceValue = candidate.record.source ?? inferDecisionSource(candidate.record);
    return sourceValue !== "runtime_followup" && candidate.record.recordedAt > record.recordedAt;
  });
  const toolCall = findRelatedToolCall(snapshot.toolCalls, record);
  const action = findRelatedAction(snapshot.actions, record, toolCall);
  const clarifications = findClarificationOutcome(snapshot.events, snapshot.pendingClarifications, record);
  const planDecision = findPlanDecision(snapshot.planDecisions, record);
  const rejected = findRejectedOutcome(snapshot.events, record);
  const outcome = resolveOutcome({
    snapshotStatus: snapshot.status,
    record,
    toolCall,
    action,
    clarifications,
    planDecision,
    rejected,
    laterEffectiveDecision,
  });

  return CausalInterventionEpisodeSchema.parse({
    episodeId: carrier.event?.id ?? record.decisionId ?? `${snapshot.runId}:episode:${record.recordedAt}`,
    decisionId: record.decisionId ?? `${snapshot.runId}:decision:${record.recordedAt}`,
    eventId: carrier.event?.id,
    runId: carrier.event?.runId ?? snapshot.runId,
    turnIndex,
    recordedAt: record.recordedAt,
    source,
    effective,
    chosenIntervention: record.chosenIntervention,
    phase: context.phase,
    replyMessageId: context.replyMessageId,
    iteration: context.iteration,
    agentId: carrier.event?.agentId ?? context.agentId,
    nodeId: carrier.event?.nodeId ?? context.nodeId,
    toolId: context.toolId ?? toolCall?.toolId,
    actionId: context.actionId ?? action?.id ?? toolCall?.actionId,
    toolCallId: context.toolCallId ?? toolCall?.id,
    clarificationId: context.clarificationId ?? clarifications.id,
    planDecisionId: context.planDecisionId ?? planDecision?.id,
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
    status: outcome.status,
    goalImpact: outcome.goalImpact,
    outcomeSummary: outcome.summary,
  });
}

function findRelatedToolCall(
  toolCalls: readonly OraToolCallEnvelope[] | undefined,
  record: CausalDecisionRecord,
): OraToolCallEnvelope | undefined {
  if (!toolCalls) return undefined;
  const context = record.decisionContext ?? {};
  if (context.toolCallId) return toolCalls.find((call) => call.id === context.toolCallId);
  const requestedAfter = record.recordedAt;
  return toolCalls.find((call) =>
    call.requestedAt >= requestedAfter &&
    (!context.toolId || call.toolId === context.toolId) &&
    (!context.agentId || call.agentId === context.agentId) &&
    (!context.nodeId || call.nodeId === context.nodeId)
  );
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
  return actions.find((action) =>
    (!context.toolId || action.type === context.toolId) &&
    (!context.agentId || action.agentId === context.agentId)
  );
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
  laterEffectiveDecision?: DecisionCarrier;
}): { status: CausalInterventionEpisodeStatus; goalImpact: CausalInterventionGoalImpact; summary: string } {
  const intervention = params.record.chosenIntervention;

  if (params.rejected.rejected) {
    return {
      status: "blocked",
      goalImpact: "weak_positive",
      summary: params.rejected.reason ?? "该干预对应的工具尝试被因果策略阻断。",
    };
  }

  if ((intervention === "clarify" || params.record.decisionContext?.phase === "clarification_triggered")) {
    if (params.clarifications.resolved) {
      return { status: "resolved", goalImpact: "strong_positive", summary: "已触发澄清并收到用户补充信息，运行继续推进。" };
    }
    if (params.clarifications.required) {
      return { status: "pending", goalImpact: "neutral", summary: "已触发澄清，当前仍在等待用户补充信息。" };
    }
  }

  if (intervention === "request_approval" || params.record.decisionContext?.phase === "approval_triggered") {
    if (params.toolCall?.status === "succeeded" || params.action?.status === "succeeded") {
      return { status: "resolved", goalImpact: "strong_positive", summary: "高风险动作已完成审批并成功执行。" };
    }
    if (params.action?.status === "denied" || params.toolCall?.status === "denied") {
      return { status: "resolved", goalImpact: "neutral", summary: "该高风险动作被拒绝执行，风险已被拦下。" };
    }
    if (params.action?.status === "approval_required" || params.toolCall?.status === "approval_required") {
      return { status: "pending", goalImpact: "neutral", summary: "已进入审批关卡，等待用户确认后继续。" };
    }
  }

  if (intervention === "plan" || params.record.decisionContext?.phase === "plan_updated") {
    if (params.planDecision?.status === "accepted") {
      return { status: "resolved", goalImpact: "weak_positive", summary: "计划决策已被接受，并作为后续执行依据保留。" };
    }
    if (params.planDecision?.status === "declined") {
      return { status: "resolved", goalImpact: "neutral", summary: "计划决策已被拒绝，未继续推进后续执行。" };
    }
    if (params.planDecision?.status === "pending") {
      return { status: "pending", goalImpact: "neutral", summary: "已形成计划决策，当前等待用户确认。" };
    }
  }

  if (params.toolCall) {
    if (params.toolCall.status === "succeeded") {
      return {
        status: "resolved",
        goalImpact: "strong_positive",
        summary: `已执行 ${params.toolCall.toolId}，并产出成功结果。`,
      };
    }
    if (params.toolCall.status === "failed" || params.action?.status === "failed") {
      return {
        status: "resolved",
        goalImpact: "negative",
        summary: `已尝试执行 ${params.toolCall.toolId}，但结果失败。`,
      };
    }
    if (params.toolCall.status === "approval_required" || params.toolCall.status === "running" || params.toolCall.status === "proposed") {
      return {
        status: "pending",
        goalImpact: "unknown",
        summary: `已进入 ${params.toolCall.toolId} 执行链路，当前尚未得到最终结果。`,
      };
    }
  }

  if (intervention === "answer_directly") {
    if (params.snapshotStatus === "succeeded") {
      return { status: "resolved", goalImpact: "weak_positive", summary: "本轮最终以直接回答收束，没有继续进入额外工具或关卡。" };
    }
  }

  if (intervention === "stop") {
    if (params.snapshotStatus === "succeeded") {
      return { status: "resolved", goalImpact: "weak_positive", summary: "运行以停止策略收束，未继续追加额外动作。" };
    }
  }

  if (params.laterEffectiveDecision) {
    return {
      status: "superseded",
      goalImpact: "neutral",
      summary: "该决策很快被后续主决策覆盖，没有独立形成有效执行结果。",
    };
  }

  return {
    status: "unknown",
    goalImpact: "unknown",
    summary: "未找到足够的后续执行证据来判断该决策是否真正改变了结果。",
  };
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
