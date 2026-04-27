import {
  OraEventEnvelope,
  RunEventStream,
  RunEventStreamSchema,
  StateSnapshot,
  StateSnapshotSchema
} from "@ora/shared";
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
  return StateSnapshotSchema.parse({
    ...liveSnapshot,
    status: statusForRunEvent(event.type, liveSnapshot.status),
    events: [...liveSnapshot.events, event],
    updatedAt: event.createdAt,
  });
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
