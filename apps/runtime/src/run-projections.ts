import {
  deriveRunAttention,
  deriveSnapshotGateProjection,
  FlowActivitySummary,
  FlowGate,
  FlowRunDetail,
  FlowRunDetailSchema,
  FlowRunHandle,
  FlowRunHandleSchema,
  GateProjection,
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

export function toFlowRunHandle(snapshot: StateSnapshot): FlowRunHandle {
  const handle = toRunHandle(snapshot);
  return FlowRunHandleSchema.parse({
    ...handle,
    flowRunId: handle.runId,
  });
}

function gateProjectionToFlowGates(gp: GateProjection, snapshot: StateSnapshot): FlowGate[] {
  const flowRunId = snapshot.runId;
  const gates: FlowGate[] = [];

  if (gp.kind === "clarification") {
    for (const cid of gp.pendingClarificationIds) {
      const clarification = snapshot.pendingClarifications.find((c) => c.id === cid);
      gates.push({
        gateId: cid,
        kind: "clarification" as const,
        status: "open" as const,
        runId: snapshot.runId,
        flowRunId,
        sessionId: snapshot.sessionId,
        pendingActionIds: [],
        pendingToolCallIds: [],
        pendingClarificationIds: [cid],
        openedAt: clarification?.requestedAt,
      });
    }
  } else if (gp.kind === "approval") {
    gates.push({
      gateId: `${snapshot.runId}:approval`,
      kind: "approval" as const,
      status: "open" as const,
      runId: snapshot.runId,
      flowRunId,
      sessionId: snapshot.sessionId,
      pendingActionIds: gp.pendingActionIds,
      pendingToolCallIds: gp.pendingToolCallIds,
      pendingClarificationIds: [],
      openedAt: snapshot.events.find((event) => event.type === "approval.required")?.createdAt,
    });
  } else if (gp.kind === "plan_decision" && gp.planDecisionId) {
    const decision = snapshot.planDecisions.find((d) => d.id === gp.planDecisionId);
    gates.push({
      gateId: gp.planDecisionId,
      kind: "plan_decision" as const,
      status: "open" as const,
      runId: snapshot.runId,
      flowRunId,
      sessionId: decision?.sessionId ?? snapshot.sessionId,
      pendingActionIds: [],
      pendingToolCallIds: [],
      pendingClarificationIds: [],
      planDecisionId: gp.planDecisionId,
      openedAt: decision?.createdAt,
    });
  }

  return gates;
}

export function toFlowRunDetail(snapshot: StateSnapshot): FlowRunDetail {
  const attention = deriveRunAttention(snapshot);
  const startedAt = snapshot.events[0]?.createdAt ?? snapshot.input.createdAt ?? snapshot.updatedAt;
  const flowRunId = snapshot.runId;
  const activities: FlowActivitySummary[] = [
    ...snapshot.toolCalls.map((call) => ({
      activityId: call.id,
      kind: "tool" as const,
      status: flowToolCallStatus(call.status),
      runId: snapshot.runId,
      flowRunId,
      nodeId: call.nodeId,
      agentId: call.agentId,
      toolId: call.toolId,
      label: call.toolId,
      startedAt: call.updatedAt,
      updatedAt: call.updatedAt,
    })),
    ...snapshot.agentMessages.map((message) => ({
      activityId: message.id,
      kind: "model" as const,
      status: flowAgentMessageStatus(message.status),
      runId: snapshot.runId,
      flowRunId,
      nodeId: message.nodeId,
      agentId: message.fromAgentId,
      label: message.topic ?? message.kind,
      startedAt: message.createdAt,
      updatedAt: message.createdAt,
    })),
  ];

  return FlowRunDetailSchema.parse({
    flowRunId,
    runId: snapshot.runId,
    sessionId: snapshot.sessionId,
    linkedSessionIds: snapshot.sessionId ? [snapshot.sessionId] : [],
    turnIndex: snapshot.turnIndex,
    status: snapshot.status,
    attention,
    definition: {
      flowDefinitionId: snapshot.modeId ?? snapshot.config.pattern,
      source: "mode_spec",
      modeId: snapshot.modeId,
      label: snapshot.modeSpec?.label,
    },
    checkpoints: snapshot.checkpoints,
    gates: (() => {
      const gateProjection = deriveSnapshotGateProjection(snapshot, { includeRawPending: true });
      const gates: FlowGate[] = gateProjection
        ? gateProjectionToFlowGates(gateProjection, snapshot)
        : [];
      // 已解决的 plan decisions 仍作为历史 gate 保留
      for (const decision of snapshot.planDecisions) {
        if (decision.status === "pending") continue; // gateProjection 已覆盖
        gates.push({
          gateId: decision.id,
          kind: "plan_decision" as const,
          status: "resolved" as const,
          runId: snapshot.runId,
          flowRunId,
          sessionId: decision.sessionId,
          pendingActionIds: [],
          pendingToolCallIds: [],
          pendingClarificationIds: [],
          planDecisionId: decision.id,
          openedAt: decision.createdAt,
          resolvedAt: decision.resolvedAt,
        });
      }
      if (snapshot.status === "cancelled") {
        gates.push({
          gateId: `${snapshot.runId}:cancellation`,
          kind: "cancellation" as const,
          status: "cancelled" as const,
          runId: snapshot.runId,
          flowRunId,
          sessionId: snapshot.sessionId,
          pendingActionIds: [],
          pendingToolCallIds: [],
          pendingClarificationIds: [],
          reason: snapshot.error,
          openedAt: snapshot.events.find((event) => event.type === "run.cancelled")?.createdAt ?? snapshot.updatedAt,
        });
      }
      return gates;
    })(),
    activities,
    eventCount: snapshot.events.length,
    latestEventSeq: snapshot.events.at(-1)?.seq,
    latestSnapshot: snapshot,
    createdAt: startedAt,
    updatedAt: snapshot.updatedAt,
    snapshotSource: snapshot.snapshotSource ?? "live",
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

function flowToolCallStatus(status: StateSnapshot["toolCalls"][number]["status"]): FlowActivitySummary["status"] {
  switch (status) {
    case "succeeded":
      return "succeeded";
    case "failed":
      return "failed";
    case "interrupted":
      return "interrupted";
    case "denied":
      return "denied";
    case "running":
      return "running";
    default:
      return "pending";
  }
}

function flowAgentMessageStatus(status: StateSnapshot["agentMessages"][number]["status"]): FlowActivitySummary["status"] {
  switch (status) {
    case "done":
      return "succeeded";
    case "failed":
      return "failed";
    case "running":
      return "running";
    default:
      return "pending";
  }
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
    estimatedCostUsd: Number(tracedCost.toFixed(4)),
    costAvailable: tracedCost > 0,
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
