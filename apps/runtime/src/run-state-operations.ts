import { z } from "zod";
import {
  ArtifactRef,
  ArtifactRefSchema,
  CheckpointMeta,
  RunEventStream,
  RunEventStreamSchema,
  RunReplayParamsSchema,
  RunStreamParamsSchema,
  normalizeRunAttention,
  StateSnapshot,
  StateSnapshotSchema
} from "@cemeworm/shared";
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
  const normalized = normalizeRunAttention(snapshot);
  const settled = normalized.status !== "queued" && normalized.status !== "running";
  return RunEventStreamSchema.parse({
    runId: normalized.runId,
    fromSeq,
    events: normalized.events.filter((event) => event.seq >= fromSeq).sort((a, b) => a.seq - b.seq),
    nextSeq: normalized.events.length,
    status: normalized.status,
    snapshot: settled ? normalized : undefined,
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
  return normalizeRunAttention(attachTraceMetadata(deps.getRunOrThrow(deps.requireRunId(params))));
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
    events: replayableEvents,
    continuation: continuationSummary(snapshot),
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
    continuation: continuationSummary(snapshot),
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

function continuationSummary(snapshot: StateSnapshot) {
  return {
    activeFrameId: snapshot.continuation.activeFrameId,
    frameCount: snapshot.continuation.frames.length,
    frames: snapshot.continuation.frames.map((frame) => ({
      id: frame.id,
      status: frame.status,
      reason: frame.reason,
      agentId: frame.agentId,
      nodeId: frame.nodeId,
      planItemId: frame.planItemId,
      pendingActionIds: frame.pendingActionIds,
      pendingToolCallIds: frame.pendingToolCallIds,
      pendingClarificationIds: frame.pendingClarificationIds,
      approvedActionIds: frame.approvedActionIds,
      resolvedClarificationIds: frame.resolvedClarificationIds,
      resumedFromFrameId: frame.resumedFromFrameId,
      nodeCheckpoint: frame.nodeCheckpoint,
      createdAt: frame.createdAt,
      updatedAt: frame.updatedAt,
    })),
    conversationEntryCount: snapshot.conversation.length,
    toolResultCount: snapshot.toolResults.length,
  };
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
  const repaired = status === "interrupted"
    ? interruptedToolSnapshot(withEvent, deps.now())
    : withEvent;
  const updated = StateSnapshotSchema.parse(status === "cancelled"
    ? cancelledRunSnapshot({
        snapshot: repaired,
        payload,
        updatedAt: deps.now(),
        defaultReason: defaultReason ?? "",
      })
    : {
        ...repaired,
        status
      });
  deps.persistRun(updated);
  return updated;
}

function interruptedToolSnapshot(snapshot: StateSnapshot, updatedAt: number): StateSnapshot {
  const interruptedCalls = snapshot.toolCalls.filter((call) =>
    call.status === "proposed" ||
    call.status === "approval_required" ||
    call.status === "approved" ||
    call.status === "running"
  );
  if (interruptedCalls.length === 0) {
    return snapshot;
  }
  const content = "Tool call was interrupted before a result was produced. Continue from available context or choose another action.";
  const nextToolCalls = snapshot.toolCalls.map((call) =>
    interruptedCalls.some((interrupted) => interrupted.id === call.id)
      ? {
          ...call,
          status: "interrupted" as const,
          updatedAt,
          result: {
            status: "interrupted" as const,
            error: content,
            content,
            createdAt: updatedAt,
            updatedAt,
          },
          error: content,
          repairReason: "manual_interrupt",
        }
      : call
  );
  const frameId = snapshot.continuation.activeFrameId ?? `${snapshot.runId}:continuation:${snapshot.continuation.frames.length}`;
  const existingFrame = snapshot.continuation.frames.find((frame) => frame.id === frameId);
  const frame = {
    id: frameId,
    runId: snapshot.runId,
    status: "paused" as const,
    reason: "manual_interrupt" as const,
    agentId: existingFrame?.agentId ?? interruptedCalls.find((call) => call.agentId)?.agentId,
    nodeId: existingFrame?.nodeId ?? interruptedCalls.find((call) => call.nodeId)?.nodeId,
    planItemId: existingFrame?.planItemId,
    conversationCursor: snapshot.conversation.length,
    pendingActionIds: interruptedCalls.map((call) => call.actionId).filter((id): id is string => typeof id === "string"),
    pendingToolCallIds: interruptedCalls.map((call) => call.id),
    pendingClarificationIds: [],
    approvedActionIds: existingFrame?.approvedActionIds ?? [],
    resolvedClarificationIds: existingFrame?.resolvedClarificationIds ?? [],
    nodeCheckpoint: existingFrame?.nodeCheckpoint ?? {
      modeId: snapshot.modeId,
      agentId: existingFrame?.agentId ?? interruptedCalls.find((call) => call.agentId)?.agentId,
      nodeId: existingFrame?.nodeId ?? interruptedCalls.find((call) => call.nodeId)?.nodeId,
      planItemId: existingFrame?.planItemId,
      eventSeq: snapshot.events.at(-1)?.seq,
      conversationCursor: snapshot.conversation.length,
      bag: {},
    },
    createdAt: existingFrame?.createdAt ?? updatedAt,
    updatedAt,
  };
  return StateSnapshotSchema.parse({
    ...snapshot,
    toolCalls: nextToolCalls,
    continuation: {
      activeFrameId: frameId,
      frames: existingFrame
        ? snapshot.continuation.frames.map((item) => (item.id === frameId ? frame : item))
        : [...snapshot.continuation.frames, frame],
    },
    conversation: [
      ...snapshot.conversation,
      ...interruptedCalls.map((call) => ({
        role: "tool" as const,
        toolCallId: call.id,
        providerCallId: call.providerCallId,
        toolId: call.toolId,
        content,
        status: "interrupted" as const,
        createdAt: updatedAt,
      })),
    ],
    toolResults: [
      ...snapshot.toolResults,
      ...interruptedCalls.map((call) => ({
        key: `${call.toolId}:${JSON.stringify(call.args)}`,
        toolId: call.toolId,
        argsDigest: JSON.stringify(call.args),
        resultToolCallId: call.id,
        status: "interrupted" as const,
        error: content,
        createdAt: updatedAt,
        updatedAt,
      })),
    ],
    updatedAt,
  });
}

function parseRunTransitionParams(params: unknown): { runId: string; reason?: string } {
  return RunTransitionParamsSchema.parse(params);
}
