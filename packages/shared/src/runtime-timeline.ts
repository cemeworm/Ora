import type { OraEventEnvelope, StateSnapshot } from "./runtime.js";
import { ORA_ROOT_AGENT_ID, ORA_ROOT_AGENT_LABEL } from "./primitives.js";

export interface RuntimeTimelineProjection {
  runId: string;
  events: OraEventEnvelope[];
  baseTime: number;
  agentLabels: Map<string, string>;
}

export function deriveRuntimeTimelineProjection(
  snapshot: Pick<StateSnapshot, "runId" | "events" | "profiles" | "updatedAt">,
): RuntimeTimelineProjection {
  const events = eventsForRun(snapshot);
  const agentLabels = new Map(snapshot.profiles.map((profile) => [profile.id, profile.label]));
  if (!agentLabels.has(ORA_ROOT_AGENT_ID)) {
    agentLabels.set(ORA_ROOT_AGENT_ID, ORA_ROOT_AGENT_LABEL);
  }
  return {
    runId: snapshot.runId,
    events: eventsForRun(snapshot),
    baseTime: events[0]?.createdAt ?? snapshot.events[0]?.createdAt ?? snapshot.updatedAt,
    agentLabels,
  };
}

function eventsForRun(
  snapshot: Pick<StateSnapshot, "runId" | "events">,
): OraEventEnvelope[] {
  return snapshot.events
    .filter((event) => event.runId === snapshot.runId)
    .sort((left, right) => left.createdAt - right.createdAt || left.seq - right.seq);
}
