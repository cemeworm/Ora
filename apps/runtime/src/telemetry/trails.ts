import type {
  RunTraceMetadata,
  StateSnapshot,
  TrailGenerationRef,
  TrailObservation
} from "@ora/shared";

export function synthesizeLocalTrail(snapshot: StateSnapshot, base?: RunTraceMetadata): {
  trace: RunTraceMetadata;
  observations: TrailObservation[];
} {
  const traceId = base?.traceId ?? `ora-local-${snapshot.runId}`;
  const rootObservationId = base?.rootObservationId ?? `${snapshot.runId}:trail-root`;
  const generationRefs = base?.generationRefs.length ? base.generationRefs : localGenerationRefs(snapshot, traceId, rootObservationId);
  const observations: TrailObservation[] = [
    {
      id: rootObservationId,
      traceId,
      parentObservationId: null,
      type: "agent",
      name: `ora.run.${snapshot.modeId ?? snapshot.pattern}`,
      input: {
        prompt: snapshot.input.prompt,
        config: snapshot.config,
      },
      output: snapshot.output,
      metadata: {
        source: "ora-runtime",
        runId: snapshot.runId,
        pattern: snapshot.pattern,
        modeId: snapshot.modeId,
        projectId: snapshot.input.projectId,
      },
      startTime: new Date(snapshot.input.createdAt ?? snapshot.updatedAt).toISOString(),
      endTime: terminalStatus(snapshot.status) ? new Date(snapshot.updatedAt).toISOString() : undefined,
      level: snapshot.status === "failed" ? "ERROR" : undefined,
      statusMessage: snapshot.error,
    },
    ...snapshot.events.map((event) => ({
      id: `${event.id}:trail`,
      traceId,
      parentObservationId: rootObservationId,
      type: observationTypeForEvent(event.type),
      name: event.type,
      level: event.type.includes("error") || event.type.includes("failed") ? "ERROR" as const : undefined,
      input: event.payload,
      metadata: {
        source: "ora-runtime-event",
        runId: snapshot.runId,
        seq: event.seq,
        eventType: event.type,
        nodeId: event.nodeId,
        agentId: event.agentId,
        checkpointId: event.checkpointId,
      },
      startTime: new Date(event.createdAt).toISOString(),
      endTime: new Date(event.createdAt).toISOString(),
      model: event.type === "message.delta" ? snapshot.config.modelRef : undefined,
    })),
    ...snapshot.toolCalls.map((call) => ({
      id: `${call.id}:trail`,
      traceId,
      parentObservationId: rootObservationId,
      type: "tool",
      name: call.toolId,
      level: call.status === "failed" || call.status === "interrupted" ? "ERROR" as const : undefined,
      statusMessage: call.error ?? call.repairReason ?? call.result?.error,
      input: call.args,
      output: call.result?.output ?? call.result?.content,
      metadata: {
        source: "ora-tool-call",
        runId: snapshot.runId,
        toolCallId: call.id,
        providerCallId: call.providerCallId,
        nodeId: call.nodeId,
        agentId: call.agentId,
        actionId: call.actionId,
        status: call.status,
        callSource: call.source,
      },
      startTime: new Date(call.requestedAt).toISOString(),
      endTime: new Date(call.result?.updatedAt ?? call.updatedAt).toISOString(),
    })),
    ...snapshot.actions.map((action) => ({
      id: `${action.id}:trail`,
      traceId,
      parentObservationId: rootObservationId,
      type: action.status === "approval_required" ? "tool" : "span",
      name: action.type,
      level: action.status === "failed" ? "ERROR" as const : undefined,
      statusMessage: action.error,
      input: action.input,
      output: action.output,
      metadata: {
        source: "ora-action",
        runId: snapshot.runId,
        actionId: action.id,
        planItemId: action.planItemId,
        agentId: action.agentId,
        riskLevel: action.riskLevel,
        status: action.status,
      },
    })),
  ];

  return {
    trace: {
      provider: "ora",
      enabled: true,
      available: true,
      traceId,
      rootObservationId,
      source: "local",
      reason: "Ora-native Trails is using local runtime events; Langfuse is optional.",
      generationRefs,
    },
    observations,
  };
}

export function mergeTrailObservations(...groups: TrailObservation[][]): TrailObservation[] {
  const merged = new Map<string, TrailObservation>();
  for (const group of groups) {
    for (const observation of group) {
      merged.set(observation.id, {
        ...merged.get(observation.id),
        ...observation,
        metadata: {
          ...(merged.get(observation.id)?.metadata ?? {}),
          ...(observation.metadata ?? {}),
        },
      });
    }
  }
  return [...merged.values()];
}

function localGenerationRefs(snapshot: StateSnapshot, traceId: string, rootObservationId: string): TrailGenerationRef[] {
  return snapshot.events
    .filter((event) => event.type === "message.delta" || event.type === "token.delta")
    .map((event, index) => ({
      observationId: `${event.id}:trail`,
      traceId,
      parentObservationId: rootObservationId,
      name: `model.${snapshot.config.providerId ?? snapshot.config.modelRef ?? "local"}`,
      providerId: snapshot.config.providerId,
      model: snapshot.config.modelRef,
      latencySeconds: index === 0 ? Math.max(0, snapshot.updatedAt - event.createdAt) / 1000 : undefined,
      totalCostUsd: 0,
    }));
}

function observationTypeForEvent(type: string): string {
  if (type === "message.delta" || type === "token.delta") {
    return "generation";
  }
  if (type === "action.updated" || type.startsWith("approval.")) {
    return "tool";
  }
  if (type === "checkpoint.created") {
    return "event";
  }
  return "span";
}

function terminalStatus(status: StateSnapshot["status"]): boolean {
  return status === "succeeded" || status === "failed" || status === "cancelled";
}
