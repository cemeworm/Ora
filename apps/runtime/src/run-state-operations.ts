import { z } from "zod";
import {
  ArtifactRef,
  ArtifactRefSchema,
  CheckpointMeta,
  RunEventStream,
  RunEventStreamSchema,
  RunReplayParamsSchema,
  RunStreamParamsSchema,
  StateSnapshot,
  StateSnapshotSchema
} from "@ora/shared";
import { OraRuntimeError } from "./runtime-errors.js";
import { cancelledRunSnapshot } from "./run-snapshots.js";
import { attachTraceMetadata } from "./run-projections.js";
import type { RuntimePersistenceBackend } from "./persistence/types.js";

const RunIdParamsSchema = z.object({
  runId: z.string().min(1)
});

const RunTransitionParamsSchema = RunIdParamsSchema.extend({
  reason: z.string().optional()
});

export interface RunStateOperationDeps {
  backend: RuntimePersistenceBackend;
  now: () => number;
  requireRunId: (params: unknown) => string;
  getRunOrThrow: (runId: string) => StateSnapshot;
  appendEvent: (
    snapshot: StateSnapshot,
    type: "run.interrupted" | "run.cancelled" | "run.replayed" | "artifact.exported",
    payload: unknown,
  ) => StateSnapshot;
  persistRun: (snapshot: StateSnapshot) => void;
}

export function streamRun(params: unknown, deps: RunStateOperationDeps): RunEventStream {
  const parsed = RunStreamParamsSchema.parse(params);
  const snapshot = deps.getRunOrThrow(parsed.runId);
  const fromSeq = parsed.afterSeq === undefined ? 0 : parsed.afterSeq + 1;
  return RunEventStreamSchema.parse({
    runId: snapshot.runId,
    fromSeq,
    events: snapshot.events.filter((event) => event.seq >= fromSeq).sort((a, b) => a.seq - b.seq),
    nextSeq: snapshot.events.length
  });
}

export function interruptRun(
  params: unknown,
  deps: RunStateOperationDeps,
  defaultReason: string,
): StateSnapshot {
  const parsed = parseRunTransitionParams(params);
  const snapshot = deps.getRunOrThrow(parsed.runId);
  return transitionRun(snapshot, "interrupted", "run.interrupted", {
    reason: parsed.reason ?? defaultReason
  }, deps);
}

export function cancelRun(
  params: unknown,
  deps: RunStateOperationDeps,
  defaultReason: string,
): StateSnapshot {
  const parsed = parseRunTransitionParams(params);
  const snapshot = deps.getRunOrThrow(parsed.runId);
  return transitionRun(snapshot, "cancelled", "run.cancelled", {
    reason: parsed.reason ?? defaultReason
  }, deps, defaultReason);
}

export function getRunState(params: unknown, deps: RunStateOperationDeps): StateSnapshot {
  return attachTraceMetadata(deps.getRunOrThrow(deps.requireRunId(params)));
}

export function persistExternalSnapshot(snapshot: StateSnapshot, deps: RunStateOperationDeps): StateSnapshot {
  const tracedSnapshot = attachTraceMetadata(StateSnapshotSchema.parse(snapshot));
  deps.persistRun(tracedSnapshot);
  return tracedSnapshot;
}

export function listCheckpoints(params: unknown, deps: RunStateOperationDeps): CheckpointMeta[] {
  return deps.getRunOrThrow(deps.requireRunId(params)).checkpoints;
}

export function replayRun(params: unknown, deps: RunStateOperationDeps): RunEventStream {
  const parsed = RunReplayParamsSchema.parse(params);
  const snapshot = deps.getRunOrThrow(parsed.runId);
  const checkpoint = parsed.checkpointId
    ? snapshot.checkpoints.find((candidate) => candidate.id === parsed.checkpointId)
    : snapshot.checkpoints.at(-1);

  if (!checkpoint) {
    throw new OraRuntimeError("Checkpoint not found for replay.", -32004, {
      runId: parsed.runId,
      checkpointId: parsed.checkpointId
    });
  }

  const replayableEvents = snapshot.events
    .filter((event) => event.seq <= checkpoint.eventSeq)
    .sort((a, b) => a.seq - b.seq);
  const replayed = deps.appendEvent(snapshot, "run.replayed", {
    checkpointId: checkpoint.id,
    replayedEventCount: replayableEvents.length,
    events: replayableEvents
  });
  deps.persistRun(replayed);

  return RunEventStreamSchema.parse({
    runId: snapshot.runId,
    fromSeq: 0,
    events: replayableEvents,
    nextSeq: replayed.events.length
  });
}

export function exportReport(params: unknown, deps: RunStateOperationDeps): ArtifactRef {
  const snapshot = deps.getRunOrThrow(deps.requireRunId(params));
  const reportIndex = snapshot.artifacts.filter((artifact) => artifact.kind === "report").length;
  const payload = {
    runId: snapshot.runId,
    status: snapshot.status,
    pattern: snapshot.pattern,
    eventCount: snapshot.events.length,
    checkpointCount: snapshot.checkpoints.length,
    output: snapshot.output
  };
  const persistedRef = deps.backend.saveArtifact({
    ref: ArtifactRefSchema.parse({
      id: `${snapshot.runId}:report-${reportIndex}`,
      runId: snapshot.runId,
      kind: "report",
      label: reportIndex === 0 ? "Smoke run report" : `Smoke run report ${reportIndex + 1}`,
      mimeType: "application/json",
      createdAt: deps.now(),
      payload
    }),
    payload
  });
  const updated = deps.appendEvent(
    {
      ...snapshot,
      artifacts: [...snapshot.artifacts, persistedRef]
    },
    "artifact.exported",
    {
      artifact: persistedRef
    }
  );
  deps.persistRun(updated);
  return persistedRef;
}

function transitionRun(
  snapshot: StateSnapshot,
  status: StateSnapshot["status"],
  type: "run.interrupted" | "run.cancelled",
  payload: unknown,
  deps: RunStateOperationDeps,
  defaultReason?: string,
): StateSnapshot {
  const withEvent = deps.appendEvent(snapshot, type, payload);
  const updated = StateSnapshotSchema.parse(status === "cancelled"
    ? cancelledRunSnapshot({
        snapshot: withEvent,
        payload,
        updatedAt: deps.now(),
        defaultReason: defaultReason ?? "",
      })
    : {
        ...withEvent,
        status
      });
  deps.persistRun(updated);
  return updated;
}

function parseRunTransitionParams(params: unknown): { runId: string; reason?: string } {
  return RunTransitionParamsSchema.parse(params);
}
