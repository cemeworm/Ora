import {
  AgentConversationMessageSchema,
  OraEventEnvelope,
  RunEventStream,
  RunEventStreamSchema,
  StateSnapshot,
  StateSnapshotSchema,
  type AgentConversationMessage
} from "@cemeworm/shared";
import { createFailedRunEvent, statusForRunEvent } from "./run-orchestration.js";

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
  params.onStream?.(RunEventStreamSchema.parse({
    runId: params.runId,
    fromSeq: params.events[0]?.seq ?? params.liveSnapshot.events.length,
    events: params.events,
    nextSeq: params.events.length > 0
      ? params.events.at(-1)!.seq + 1
      : params.liveSnapshot.events.length,
    status: params.snapshot?.status ?? params.liveSnapshot.status,
    snapshot: params.snapshot,
  }));
}

export function applyStreamingRunEvent(
  liveSnapshot: StateSnapshot,
  event: OraEventEnvelope,
): StateSnapshot {
  const projected = projectStreamingEvent(liveSnapshot, event);
  return StateSnapshotSchema.parse({
    ...projected,
    status: statusForRunEvent(event.type, liveSnapshot.status),
    events: [...liveSnapshot.events, event],
    agentMessages: mergeStreamingAgentMessage(liveSnapshot.agentMessages, event),
    updatedAt: event.createdAt,
  });
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
    return {
      ...snapshot,
      actions: upsertById(snapshot.actions, action),
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

  if (event.type === "plan_list.updated" && Array.isArray(event.payload.plan)) {
    return {
      ...snapshot,
      planList: event.payload.plan as StateSnapshot["planList"],
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

function mergeStreamingAgentMessage(
  agentMessages: readonly AgentConversationMessage[],
  event: OraEventEnvelope,
): AgentConversationMessage[] {
  const message = agentMessageFromEvent(event);
  if (!message) {
    return [...agentMessages];
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

export function shouldFlushStreamingEvent(event: OraEventEnvelope): boolean {
  return event.seq % 8 === 0 || event.type.startsWith("run.");
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
    snapshot: StateSnapshotSchema.parse({
      ...params.liveSnapshot,
      status: "failed",
      error: detail,
      events: [...params.liveSnapshot.events, event],
      updatedAt: params.failedAt,
    }),
  };
}
