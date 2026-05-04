import {
  deriveRunAttention,
  RunHandle,
  RunHandleSchema,
  RunSummary,
  RunSummarySchema,
  RunTraceMetadata,
  RunTrailMetrics,
  SessionTurn,
  SessionTurnSchema,
  StateSnapshot,
  StateSnapshotSchema
} from "@cemeworm/shared";
import { getLangfuseRunTraceMetadata } from "./telemetry/langfuse.js";

export function toRunHandle(snapshot: StateSnapshot): RunHandle {
  return RunHandleSchema.parse({
    runId: snapshot.runId,
    sessionId: snapshot.sessionId,
    turnIndex: snapshot.turnIndex,
    status: snapshot.status,
    pattern: snapshot.pattern,
    modeId: snapshot.modeId,
    startedAt: snapshot.events[0]?.createdAt ?? snapshot.input.createdAt ?? snapshot.updatedAt
  });
}

export function toRunSummary(snapshot: StateSnapshot): RunSummary {
  return RunSummarySchema.parse({
    runId: snapshot.runId,
    sessionId: snapshot.sessionId,
    turnIndex: snapshot.turnIndex,
    status: snapshot.status,
    pattern: snapshot.pattern,
    modeId: snapshot.modeId,
    prompt: snapshot.input.prompt,
    startedAt: snapshot.events[0]?.createdAt ?? snapshot.input.createdAt ?? snapshot.updatedAt,
    updatedAt: snapshot.updatedAt,
    eventCount: snapshot.events.length,
    checkpointCount: snapshot.checkpoints.length,
    artifactCount: snapshot.artifacts.length
  });
}

export function toSessionTurn(snapshot: StateSnapshot): SessionTurn {
  const attention = deriveRunAttention(snapshot);
  return SessionTurnSchema.parse({
    runId: snapshot.runId,
    sessionId: snapshot.sessionId,
    turnIndex: snapshot.turnIndex,
    status: snapshot.status,
    attention,
    pattern: snapshot.pattern,
    modeId: snapshot.modeId,
    providerId: typeof snapshot.config.providerId === "string" ? snapshot.config.providerId : undefined,
    modelRef: snapshot.config.modelRef,
    prompt: snapshot.input.prompt,
    startedAt: snapshot.events[0]?.createdAt ?? snapshot.input.createdAt ?? snapshot.updatedAt,
    updatedAt: snapshot.updatedAt,
    eventCount: snapshot.events.length,
    checkpointCount: snapshot.checkpoints.length,
    artifactCount: snapshot.artifacts.length,
    trace: snapshot.trace,
  });
}

export function attachTraceMetadata(snapshot: StateSnapshot): StateSnapshot {
  const trace = mergeTraceMetadata(snapshot.runId, snapshot.trace);
  if (!trace) {
    return snapshot;
  }
  return StateSnapshotSchema.parse({
    ...snapshot,
    trace,
  });
}

export function mergeTraceMetadata(runId: string, current?: RunTraceMetadata): RunTraceMetadata | undefined {
  const registered = getLangfuseRunTraceMetadata(runId);
  if (!registered) {
    return current;
  }
  if (!current) {
    return registered;
  }
  return {
    ...current,
    ...registered,
    generationRefs: registered.generationRefs.length > 0 ? registered.generationRefs : current.generationRefs,
  };
}

export function buildRunTrailMetrics(
  snapshot: StateSnapshot,
  trace: RunTraceMetadata,
  observations: readonly { level?: string }[],
): RunTrailMetrics {
  const runtimeMs = Math.max(0, snapshot.updatedAt - (snapshot.events[0]?.createdAt ?? snapshot.updatedAt));
  const topologyChangeCount = snapshot.events.filter((event) => event.type === "topology.updated").length;
  const messageCount = snapshot.events.filter((event) => event.type === "message.delta").length;
  const warningCount = observations.filter((observation) => observation.level === "WARNING").length;
  const errorCount = observations.filter((observation) => observation.level === "ERROR").length;
  const tracedCost = trace.generationRefs.reduce((sum, ref) => sum + (ref.totalCostUsd ?? 0), 0);
  return {
    runtimeMs,
    eventCount: snapshot.events.length,
    checkpointCount: snapshot.checkpoints.length,
    topologyChangeCount,
    messageCount,
    activeAgentCount: snapshot.activeAgents.length,
    warningCount,
    errorCount,
    estimatedCostUsd: Number((tracedCost > 0 ? tracedCost : snapshot.events.length * 0.0002).toFixed(4)),
  };
}

export function summarizeEventPayload(payload: unknown): unknown {
  if (!payload || typeof payload !== "object") {
    return payload;
  }
  const record = payload as Record<string, unknown>;
  const summary: Record<string, unknown> = {};
  for (const key of ["summary", "message", "content", "status", "label", "detail", "error"]) {
    if (typeof record[key] === "string") {
      summary[key] = String(record[key]).slice(0, 500);
    }
  }
  for (const key of ["actionId", "toolId", "checkpointId", "artifactId"]) {
    if (typeof record[key] === "string") {
      summary[key] = record[key];
    }
  }
  return Object.keys(summary).length > 0 ? summary : undefined;
}
