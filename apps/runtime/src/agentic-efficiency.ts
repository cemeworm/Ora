import type { ModelTokenUsage, OraEventEnvelope, StateSnapshot } from "@cemeworm/shared";
import { estimateTextTokens } from "./context-manager.js";

export interface AgenticEfficiencyLedger {
  modelCallCount: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  estimatedTokenCostUsd: number;
  toolCallCount: number;
  uniqueToolCount: number;
  failedToolCallCount: number;
  repairedToolCallCount: number;
  toolRetryCount: number;
  clarificationCount: number;
  approvalCount: number;
  recoveryEventCount: number;
  coordinationEventCount: number;
  contextCompactionCount: number;
  runtimeMs: number;
  eventCount: number;
  estimatedCostUsd: number;
  tokenShare: number;
  toolShare: number;
  coordinationShare: number;
  recoveryShare: number;
  cacheHitTokens: number;
  cacheMissTokens: number;
  cacheHitRatio: number;
  cacheDataAvailable: boolean;
}

const INPUT_TOKEN_COST_PER_1K_USD = 0.00015;
const OUTPUT_TOKEN_COST_PER_1K_USD = 0.0006;
const TOOL_CALL_COST_USD = 0.0001;
const COORDINATION_EVENT_COST_USD = 0.00003;
const RECOVERY_EVENT_COST_USD = 0.0002;
const HUMAN_GATE_COST_USD = 0.0001;

const COORDINATION_EVENT_TYPES = new Set<OraEventEnvelope["type"]>([
  "agent.started",
  "agent.completed",
  "agent.message",
  "message.published",
  "message.routed",
  "queue.updated",
  "shared_state.updated",
  "worker.claimed",
  "worker.released",
  "topology.updated",
]);

const RECOVERY_EVENT_TYPES = new Set<OraEventEnvelope["type"]>([
  "tool.repaired",
  "recovery.detected",
  "recovery.retry_scheduled",
  "recovery.applied",
  "recovery.exhausted",
  "artifact.degraded",
]);

export function buildAgenticEfficiencyLedger(
  snapshot: StateSnapshot,
  runtimeMs = runtimeDurationMs(snapshot),
): AgenticEfficiencyLedger {
  const usage = usageFromSnapshot(snapshot);
  const tokenOutputEstimate = tokenDeltaCount(snapshot.events);
  const outputTextEstimate = estimateTextTokens(String(snapshot.output ?? ""));
  const outputTokens = Math.max(usage.outputTokens, tokenOutputEstimate, outputTextEstimate);
  const inputTokens = Math.max(usage.inputTokens, snapshot.contextState?.activeTokenUsage.inputTokens ?? 0);
  const reasoningTokens = usage.reasoningTokens;
  const totalTokens = Math.max(
    usage.totalTokens,
    inputTokens + outputTokens + reasoningTokens,
    snapshot.contextState?.activeTokenUsage.totalTokens ?? 0,
  );
  const modelCallCount = Math.max(
    countModelCallEvents(snapshot.events),
    countUsageEvents(snapshot.events),
    totalTokens > 0 || outputTokens > 0 ? 1 : 0,
  );
  const toolCallCount = snapshot.toolCalls.length;
  const uniqueToolCount = new Set(snapshot.toolCalls.map((call) => call.toolId)).size;
  const failedToolCallCount = snapshot.toolCalls.filter((call) =>
    call.status === "failed" || call.status === "denied" || call.status === "interrupted" || call.result?.status === "failed"
  ).length;
  const repairedToolCallCount = snapshot.toolCalls.filter((call) =>
    call.status === "repaired" || call.source === "manual_repair" || Boolean(call.repairReason)
  ).length;
  const recoveryEventCount = snapshot.events.filter((event) => RECOVERY_EVENT_TYPES.has(event.type)).length;
  const toolRetryCount = snapshot.events.filter((event) => event.type === "recovery.retry_scheduled").length + repairedToolCallCount;
  const clarificationCount = Math.max(
    snapshot.events.filter((event) => event.type === "clarification.required").length,
    snapshot.pendingClarifications.length,
  );
  const approvalCount = Math.max(
    snapshot.events.filter((event) => event.type === "approval.required").length,
    snapshot.pendingApprovals.length,
  );
  const coordinationEventCount = snapshot.events.filter((event) => COORDINATION_EVENT_TYPES.has(event.type)).length;
  const contextCompactionCount = Math.max(
    snapshot.events.filter((event) => event.type === "context.compaction.completed").length,
    snapshot.contextState?.compactionCount ?? 0,
  );

  const estimatedTokenCostUsd = money(
    (inputTokens / 1000) * INPUT_TOKEN_COST_PER_1K_USD +
    ((outputTokens + reasoningTokens) / 1000) * OUTPUT_TOKEN_COST_PER_1K_USD,
  );
  const toolCostUsd = toolCallCount * TOOL_CALL_COST_USD;
  const coordinationCostUsd = coordinationEventCount * COORDINATION_EVENT_COST_USD;
  const recoveryCostUsd = recoveryEventCount * RECOVERY_EVENT_COST_USD;
  const humanGateCostUsd = (clarificationCount + approvalCount) * HUMAN_GATE_COST_USD;
  const estimatedCostUsd = money(
    estimatedTokenCostUsd + toolCostUsd + coordinationCostUsd + recoveryCostUsd + humanGateCostUsd,
  );

  const cacheHitTokens = usage.promptCacheHitTokens + usage.cacheReadInputTokens;
  const cacheMissTokens = usage.promptCacheMissTokens + usage.cacheCreationInputTokens;
  const cacheHitRatio = cacheHitTokens + cacheMissTokens > 0 ? cacheHitTokens / (cacheHitTokens + cacheMissTokens) : 0;
  const cacheDataAvailable = cacheHitTokens + cacheMissTokens > 0;

  return {
    modelCallCount,
    inputTokens,
    outputTokens,
    reasoningTokens,
    totalTokens,
    estimatedTokenCostUsd,
    toolCallCount,
    uniqueToolCount,
    failedToolCallCount,
    repairedToolCallCount,
    toolRetryCount,
    clarificationCount,
    approvalCount,
    recoveryEventCount,
    coordinationEventCount,
    contextCompactionCount,
    runtimeMs,
    eventCount: snapshot.events.length,
    estimatedCostUsd,
    tokenShare: share(estimatedTokenCostUsd, estimatedCostUsd),
    toolShare: share(toolCostUsd, estimatedCostUsd),
    coordinationShare: share(coordinationCostUsd, estimatedCostUsd),
    recoveryShare: share(recoveryCostUsd, estimatedCostUsd),
    cacheHitTokens,
    cacheMissTokens,
    cacheHitRatio,
    cacheDataAvailable,
  };
}

interface UsageAggregate {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  promptCacheHitTokens: number;
  promptCacheMissTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
}

function usageFromSnapshot(snapshot: StateSnapshot): UsageAggregate {
  return snapshot.events
    .filter((event) => event.type === "context.usage.updated")
    .map((event) => usageFromPayload(event.payload))
    .reduce(
      (total, usage) => ({
        inputTokens: total.inputTokens + usage.inputTokens,
        outputTokens: total.outputTokens + usage.outputTokens,
        reasoningTokens: total.reasoningTokens + usage.reasoningTokens,
        totalTokens: total.totalTokens + usage.totalTokens,
        promptCacheHitTokens: total.promptCacheHitTokens + usage.promptCacheHitTokens,
        promptCacheMissTokens: total.promptCacheMissTokens + usage.promptCacheMissTokens,
        cacheReadInputTokens: total.cacheReadInputTokens + usage.cacheReadInputTokens,
        cacheCreationInputTokens: total.cacheCreationInputTokens + usage.cacheCreationInputTokens,
      }),
      {
        inputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        totalTokens: 0,
        promptCacheHitTokens: 0,
        promptCacheMissTokens: 0,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
      },
    );
}

interface ExtractedUsage {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  promptCacheHitTokens: number;
  promptCacheMissTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
}

function usageFromPayload(payload: unknown): ExtractedUsage {
  const zero: ExtractedUsage = {
    inputTokens: 0, outputTokens: 0, reasoningTokens: 0, totalTokens: 0,
    promptCacheHitTokens: 0, promptCacheMissTokens: 0,
    cacheReadInputTokens: 0, cacheCreationInputTokens: 0,
  };
  if (!payload || typeof payload !== "object") return zero;
  const usage = (payload as { usage?: unknown }).usage;
  if (!usage || typeof usage !== "object") return zero;
  const record = usage as Record<string, unknown>;
  return {
    inputTokens: numeric(record.inputTokens) ?? 0,
    outputTokens: numeric(record.outputTokens) ?? 0,
    reasoningTokens: numeric(record.reasoningTokens) ?? 0,
    totalTokens: numeric(record.totalTokens) ?? 0,
    promptCacheHitTokens: numeric(record.promptCacheHitTokens) ?? 0,
    promptCacheMissTokens: numeric(record.promptCacheMissTokens) ?? 0,
    cacheReadInputTokens: numeric(record.cacheReadInputTokens) ?? 0,
    cacheCreationInputTokens: numeric(record.cacheCreationInputTokens) ?? 0,
  };
}

function tokenDeltaCount(events: readonly OraEventEnvelope[]): number {
  return events
    .filter((event) => event.type === "token.delta")
    .reduce((total, event) => {
      if (!event.payload || typeof event.payload !== "object") return total;
      return total + (numeric((event.payload as { tokenCount?: unknown }).tokenCount) ?? 0);
    }, 0);
}

function countModelCallEvents(events: readonly OraEventEnvelope[]): number {
  return events.filter((event) => {
    if (event.type !== "node.updated" || !event.payload || typeof event.payload !== "object") return false;
    return (event.payload as { state?: unknown }).state === "running_model";
  }).length;
}

function countUsageEvents(events: readonly OraEventEnvelope[]): number {
  return events.filter((event) => event.type === "context.usage.updated").length;
}

function runtimeDurationMs(snapshot: StateSnapshot): number {
  const startedAt = snapshot.events[0]?.createdAt ?? snapshot.input.createdAt ?? snapshot.updatedAt;
  return Math.max(0, snapshot.updatedAt - startedAt);
}

function numeric(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function money(value: number): number {
  return Number(value.toFixed(6));
}

function share(part: number, total: number): number {
  return total > 0 ? Number(Math.min(1, part / total).toFixed(4)) : 0;
}
