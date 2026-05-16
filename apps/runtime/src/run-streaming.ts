import {
  AgentConversationMessageSchema,
  DELTA_EVENT_TYPES,
  normalizeRunAttention,
  OraEventEnvelope,
  PASSIVE_EVENT_TYPES,
  PendingClarificationSchema,
  RunEventStream,
  RunEventStreamSchema,
  StateSnapshot,
  StateSnapshotSchema,
  type AgentConversationMessage
} from "@cemeworm/shared";
import { createFailedRunEvent, createInterruptedRunEvent, statusForRunEvent } from "./run-orchestration.js";

export function publishRunStream(params: {
  onStream?: (stream: RunEventStream) => void;
  runId: string;
  events: OraEventEnvelope[];
  liveSnapshot: StateSnapshot;
  snapshot?: StateSnapshot;
}): void {
  if (params.events.length === 0 && !params.snapshot) {
    return;
  }
  if (!params.snapshot && isPureDeltaStream(params.events)) {
    params.onStream?.(RunEventStreamSchema.parse({
      runId: params.runId,
      sessionId: params.liveSnapshot.sessionId,
      prompt: params.liveSnapshot.input.prompt,
      fromSeq: params.events[0]?.seq ?? params.liveSnapshot.events.length,
      events: params.events,
      nextSeq: params.events.length > 0
        ? params.events.at(-1)!.seq + 1
        : params.liveSnapshot.events.length,
      status: params.liveSnapshot.status,
      latency: params.liveSnapshot.latency,
    }));
    return;
  }
  const snapshot = params.snapshot
    ? normalizeRunAttention(params.snapshot)
    : undefined;
  const liveSnapshot = normalizeRunAttention(params.liveSnapshot);
  const streamSnapshot = snapshot ?? (
    liveSnapshot.status === "queued" || liveSnapshot.status === "running"
      ? shouldAttachRunningLiveSnapshot(params.events, liveSnapshot) ? liveSnapshot : undefined
      : shouldAttachLiveSnapshot(params.events) ? liveSnapshot : undefined
  );
  params.onStream?.(RunEventStreamSchema.parse({
    runId: params.runId,
    sessionId: liveSnapshot.sessionId,
    prompt: liveSnapshot.input.prompt,
    fromSeq: params.events[0]?.seq ?? liveSnapshot.events.length,
    events: params.events,
    nextSeq: params.events.length > 0
      ? params.events.at(-1)!.seq + 1
      : liveSnapshot.events.length,
    status: streamSnapshot?.status ?? liveSnapshot.status,
    snapshot: streamSnapshot,
    latency: streamSnapshot?.latency ?? liveSnapshot.latency,
  }));
}

export function applyStreamingRunEvent(
  liveSnapshot: StateSnapshot,
  event: OraEventEnvelope,
): StateSnapshot {
  if (isPureDeltaEvent(event)) {
    liveSnapshot.events.push(event);
    liveSnapshot.status = statusForRunEvent(event.type, liveSnapshot.status);
    liveSnapshot.updatedAt = event.createdAt;
    return liveSnapshot;
  }

  if (isPassiveAccumulationEvent(event)) {
    liveSnapshot.events.push(event);
    liveSnapshot.status = statusForRunEvent(event.type, liveSnapshot.status);
    liveSnapshot.updatedAt = event.createdAt;
    if (event.type === "agent.message") {
      liveSnapshot.agentMessages = mergeStreamingAgentMessage(liveSnapshot.agentMessages, event);
    }
    return liveSnapshot;
  }

  if (noProjectionEventTypes.has(event.type)) {
    liveSnapshot.events.push(event);
    liveSnapshot.status = statusForRunEvent(event.type, liveSnapshot.status);
    liveSnapshot.updatedAt = event.createdAt;
    return liveSnapshot;
  }

  const projected = projectStreamingEvent(liveSnapshot, event);
  const status = statusForRunEvent(event.type, liveSnapshot.status);
  const next = {
    ...finalizeTerminalRuntimeProjection(projected, status),
    status,
    events: [...liveSnapshot.events, event],
    agentMessages: mergeStreamingAgentMessage(liveSnapshot.agentMessages, event),
    updatedAt: event.createdAt,
  };
  return normalizeRunAttention(StateSnapshotSchema.parse(next));
}

export const noProjectionEventTypes = new Set([
  "completion.updated",
  "task.started", "task.progress", "task.completed", "task.failed",
  "recovery.detected", "recovery.retry_scheduled", "recovery.applied", "recovery.exhausted",
  "tool.repaired",
  "node.skipped",
  "memory.updated", "memory.queued", "memory.flushed",
  "message.published", "message.routed",
  "worker.claimed", "worker.released",
  "agent.started", "agent.completed",
  "profile.updated",
  "context.compaction.completed", "context.compaction.skipped",
]);

function finalizeTerminalRuntimeProjection(
  snapshot: StateSnapshot,
  status: StateSnapshot["status"],
): StateSnapshot {
  if (status !== "succeeded" && status !== "failed" && status !== "cancelled") {
    return snapshot;
  }
  return {
    ...snapshot,
    activeAgents: [],
    queueSummary: {
      ...snapshot.queueSummary,
      pending: 0,
      inProgress: 0,
      completed: status === "succeeded"
        ? Math.max(
            snapshot.queueSummary.completed,
            snapshot.queueSummary.completed + snapshot.queueSummary.inProgress + snapshot.queueSummary.pending,
          )
        : snapshot.queueSummary.completed,
    },
  };
}

function projectStreamingEvent(
  snapshot: StateSnapshot,
  event: OraEventEnvelope,
): StateSnapshot {
  if (!isRecord(event.payload)) {
    return snapshot;
  }

  if (event.type === "action.updated" && isRecord(event.payload.record)) {
    const action = event.payload.record as StateSnapshot["actions"][number];
    const pendingApprovals = action.status === "approval_required"
      ? addUnique(snapshot.pendingApprovals, action.id)
      : snapshot.pendingApprovals.filter((pendingActionId) => pendingActionId !== action.id);
    return {
      ...snapshot,
      actions: upsertById(snapshot.actions, action),
      pendingApprovals,
    };
  }

  if (event.type === "approval.required" && typeof event.payload.actionId === "string") {
    const actionId = event.payload.actionId;
    return {
      ...snapshot,
      pendingApprovals: addUnique(snapshot.pendingApprovals, actionId),
    };
  }

  if (event.type === "approval.resolved" && typeof event.payload.actionId === "string") {
    const actionId = event.payload.actionId;
    return {
      ...snapshot,
      pendingApprovals: snapshot.pendingApprovals.filter((pendingActionId) => pendingActionId !== actionId),
    };
  }

  if (event.type === "clarification.required" && isRecord(event.payload.clarification)) {
    const parsed = PendingClarificationSchema.safeParse(event.payload.clarification);
    if (!parsed.success) {
      return snapshot;
    }
    return {
      ...snapshot,
      pendingClarifications: upsertById(snapshot.pendingClarifications, parsed.data),
    };
  }

  if (event.type === "clarification.resolved" && typeof event.payload.clarificationId === "string") {
    const clarificationId = event.payload.clarificationId;
    return {
      ...snapshot,
      pendingClarifications: snapshot.pendingClarifications.filter((clarification) => clarification.id !== clarificationId),
    };
  }

  if (event.type === "plan.updated" && Array.isArray(event.payload.items)) {
    return {
      ...snapshot,
      plan: event.payload.items as StateSnapshot["plan"],
    };
  }

  if (event.type === "todo.updated" && Array.isArray(event.payload.items)) {
    return {
      ...snapshot,
      todos: event.payload.items as StateSnapshot["todos"],
    };
  }

  if (event.type === "plan_list.updated" && Array.isArray(event.payload.plan)) {
    return {
      ...snapshot,
      planList: event.payload.plan as StateSnapshot["planList"],
    };
  }

  if (event.type === "topology.updated" && Array.isArray(event.payload.nodes) && Array.isArray(event.payload.edges)) {
    return {
      ...snapshot,
      topology: event.payload as StateSnapshot["topology"],
    };
  }

  if (event.type === "queue.updated") {
    return {
      ...snapshot,
      queueSummary: isRecord(event.payload.summary)
        ? event.payload.summary as StateSnapshot["queueSummary"]
        : snapshot.queueSummary,
      busStats: isRecord(event.payload.busStats)
        ? event.payload.busStats as StateSnapshot["busStats"]
        : snapshot.busStats,
    };
  }

  if (event.type === "shared_state.updated" && isRecord(event.payload.entry)) {
    const entry = event.payload.entry as StateSnapshot["sharedStateSummary"]["entries"][number];
    const entries = upsertSharedStateEntry(snapshot.sharedStateSummary.entries, entry);
    return {
      ...snapshot,
      sharedStateSummary: {
        ...snapshot.sharedStateSummary,
        enabled: true,
        storeKind: snapshot.sharedStateSummary.storeKind === "none" ? "blackboard" : snapshot.sharedStateSummary.storeKind,
        version: Math.max(snapshot.sharedStateSummary.version, typeof entry.version === "number" ? entry.version : 0),
        entries,
        stopReason: entry.key === "convergence" ? "converged" : snapshot.sharedStateSummary.stopReason,
      },
    };
  }

  if ((event.type === "artifact.exported" || event.type === "artifact.degraded") && isRecord(event.payload.artifact)) {
    return {
      ...snapshot,
      artifacts: upsertById(snapshot.artifacts, event.payload.artifact as StateSnapshot["artifacts"][number]),
    };
  }

  return snapshot;
}

function upsertById<T extends { id: string }>(items: readonly T[], next: T): T[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  byId.set(next.id, next);
  return [...byId.values()];
}

function addUnique(items: readonly string[], next: string): string[] {
  return items.includes(next) ? [...items] : [...items, next];
}

function upsertSharedStateEntry(
  entries: readonly StateSnapshot["sharedStateSummary"]["entries"][number][],
  next: StateSnapshot["sharedStateSummary"]["entries"][number],
): StateSnapshot["sharedStateSummary"]["entries"] {
  const byKey = new Map(entries.map((entry) => [entry.key, entry]));
  byKey.set(next.key, next);
  return [...byKey.values()].sort((left, right) => left.key.localeCompare(right.key));
}

function mergeStreamingAgentMessage(
  agentMessages: readonly AgentConversationMessage[],
  event: OraEventEnvelope,
): AgentConversationMessage[] {
  const message = agentMessageFromEvent(event);
  if (!message) {
    return agentMessages as AgentConversationMessage[];
  }
  const messageById = new Map(agentMessages.map((entry) => [entry.id, entry]));
  messageById.set(message.id, message);
  return [...messageById.values()].sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id));
}

function agentMessageFromEvent(event: OraEventEnvelope): AgentConversationMessage | undefined {
  if (event.type !== "agent.message" || !isRecord(event.payload) || !isRecord(event.payload.message)) {
    return undefined;
  }
  const parsed = AgentConversationMessageSchema.safeParse(event.payload.message);
  return parsed.success ? parsed.data : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isPureDeltaEvent(event: OraEventEnvelope): boolean {
  return DELTA_EVENT_TYPES.has(event.type);
}

export function isPassiveAccumulationEvent(event: OraEventEnvelope): boolean {
  return PASSIVE_EVENT_TYPES.has(event.type);
}

function isPureDeltaStream(events: readonly OraEventEnvelope[]): boolean {
  return events.length > 0 && events.every(isPureDeltaEvent);
}

export function shouldFlushStreamingEvent(event: OraEventEnvelope): boolean {
  if (event.type === "message.delta" || event.type === "token.delta") {
    return event.seq % 128 === 0;
  }
  if (event.type === "action.updated" && isRecord(event.payload) && isRecord(event.payload.record)) {
    const status = (event.payload.record as { status?: string }).status;
    return status === "approval_required" || status === "completed" || status === "failed";
  }
  if (isDurableStateBoundaryEvent(event)) {
    return true;
  }
  return event.seq % 8 === 0 || event.type.startsWith("run.");
}

function isDurableStateBoundaryEvent(event: OraEventEnvelope): boolean {
  return event.type.startsWith("run.") ||
    event.type === "tool.called" ||
    event.type === "approval.required" ||
    event.type === "approval.resolved" ||
    event.type === "clarification.required" ||
    event.type === "clarification.resolved" ||
    event.type === "plan.updated" ||
    event.type === "todo.updated" ||
    event.type === "plan_list.updated" ||
    event.type === "checkpoint.created" ||
    event.type === "shared_state.updated" ||
    event.type === "artifact.exported" ||
    event.type === "artifact.degraded";
}

function shouldAttachLiveSnapshot(events: readonly OraEventEnvelope[]): boolean {
  return events.some((event) => {
    if (event.type === "message.delta" || event.type === "token.delta") {
      return false;
    }
    return (event.type.startsWith("run.") && event.type !== "run.started") ||
      event.type === "action.updated" ||
      event.type === "approval.required" ||
      event.type === "approval.resolved" ||
      event.type === "clarification.required" ||
      event.type === "clarification.resolved" ||
      event.type === "plan.updated" ||
      event.type === "todo.updated" ||
      event.type === "plan_list.updated" ||
      event.type === "topology.updated" ||
      event.type === "queue.updated" ||
      event.type === "shared_state.updated" ||
      event.type === "artifact.exported" ||
      event.type === "artifact.degraded" ||
      event.type === "agent.message";
  });
}

function shouldAttachRunningLiveSnapshot(events: readonly OraEventEnvelope[], liveSnapshot: StateSnapshot): boolean {
  if (events.some((event) =>
    event.type === "approval.required" ||
    event.type === "clarification.required"
  )) {
    return true;
  }
  if (!events.some((event) => event.type === "message.delta" || event.type === "token.delta")) {
    return false;
  }
  return liveSnapshot.events.filter((event) =>
    event.type === "message.delta" &&
    (!event.payload || typeof event.payload !== "object" || (event.payload as Record<string, unknown>).visibility !== "internal")
  ).length > 1;
}

export function createStreamingFailure(params: {
  liveSnapshot: StateSnapshot;
  runId: string;
  pattern: StateSnapshot["pattern"];
  error: unknown;
  failedAt: number;
}): { detail: string; event: OraEventEnvelope; snapshot: StateSnapshot } {
  const detail = params.error instanceof Error ? params.error.message : String(params.error);
  const event = createFailedRunEvent({
    runId: params.runId,
    seq: params.liveSnapshot.events.length,
    createdAt: params.failedAt,
    pattern: params.pattern,
    error: detail,
  });
  return {
    detail,
    event,
    snapshot: normalizeRunAttention(StateSnapshotSchema.parse({
      ...params.liveSnapshot,
      status: "failed",
      error: detail,
      events: [...params.liveSnapshot.events, event],
      updatedAt: params.failedAt,
    })),
  };
}

export function createStreamingInterrupt(params: {
  liveSnapshot: StateSnapshot;
  runId: string;
  pattern: StateSnapshot["pattern"];
  reason: string;
  error?: string;
  interruptedAt: number;
}): { detail: string; event: OraEventEnvelope; snapshot: StateSnapshot } {
  const detail = params.error ?? params.reason;
  const event = createInterruptedRunEvent({
    runId: params.runId,
    seq: params.liveSnapshot.events.length,
    createdAt: params.interruptedAt,
    pattern: params.pattern,
    reason: params.reason,
    error: params.error,
  });
  return {
    detail,
    event,
    snapshot: normalizeRunAttention(StateSnapshotSchema.parse({
      ...params.liveSnapshot,
      status: "interrupted",
      error: detail,
      events: [...params.liveSnapshot.events, event],
      updatedAt: params.interruptedAt,
    })),
  };
}
