import {
  isCollaborationDeltaPayload,
  isInternalDeltaPayload,
  ORA_ROOT_AGENT_ID,
  ORA_ROOT_AGENT_LABEL,
} from "@cemeworm/shared";
import type { OraStateSnapshot } from "./runtimeClient";

export interface CurrentExecutorProjection {
  agentId?: string;
  agentLabel?: string;
  source:
    | "mode_stage_child"
    | "running_topology_node"
    | "active_agent"
    | "recent_agent_message"
    | "public_delta"
    | "root_fallback";
}

export function deriveCurrentExecutorProjection(
  snapshot: Pick<
    OraStateSnapshot,
    "profiles" | "childSessions" | "activeAgents" | "topology" | "agentMessages" | "events"
  >,
): CurrentExecutorProjection {
  const labels = new Map(snapshot.profiles.map((profile) => [profile.id, profile.label]));
  if (!labels.has(ORA_ROOT_AGENT_ID)) {
    labels.set(ORA_ROOT_AGENT_ID, ORA_ROOT_AGENT_LABEL);
  }

  const runningModeStageChild = [...(snapshot.childSessions ?? [])]
    .filter((child) =>
      (child.authoritySource === "mode_stage" || child.delegationKind === "mode_stage") &&
      child.status === "running" &&
      child.agentId !== ORA_ROOT_AGENT_ID,
    )
    .sort((left, right) =>
      right.updatedAt - left.updatedAt ||
      (right.startedAt ?? right.updatedAt) - (left.startedAt ?? left.updatedAt),
    )[0];
  if (runningModeStageChild) {
    return {
      agentId: runningModeStageChild.agentId,
      agentLabel: runningModeStageChild.label || labels.get(runningModeStageChild.agentId) || runningModeStageChild.agentId,
      source: "mode_stage_child",
    };
  }

  const runningTopologyNode = snapshot.topology.nodes.find((node) =>
    node.kind === "agent" &&
    node.status === "running" &&
    typeof node.agentId === "string" &&
    node.agentId !== ORA_ROOT_AGENT_ID,
  );
  if (runningTopologyNode?.agentId) {
    return {
      agentId: runningTopologyNode.agentId,
      agentLabel: labels.get(runningTopologyNode.agentId) ?? runningTopologyNode.label ?? runningTopologyNode.agentId,
      source: "running_topology_node",
    };
  }

  const activeNonRoot = snapshot.activeAgents.find((agentId) => agentId !== ORA_ROOT_AGENT_ID);
  if (activeNonRoot) {
    return {
      agentId: activeNonRoot,
      agentLabel: labels.get(activeNonRoot) ?? activeNonRoot,
      source: "active_agent",
    };
  }

  const recentAgentMessage = [...(snapshot.agentMessages ?? [])]
    .reverse()
    .find((message) => message.fromAgentId !== ORA_ROOT_AGENT_ID);
  if (recentAgentMessage) {
    return {
      agentId: recentAgentMessage.fromAgentId,
      agentLabel: labels.get(recentAgentMessage.fromAgentId) ?? recentAgentMessage.fromAgentId,
      source: "recent_agent_message",
    };
  }

  for (let index = snapshot.events.length - 1; index >= 0; index -= 1) {
    const event = snapshot.events[index];
    if (
      event.type !== "message.delta" ||
      typeof event.agentId !== "string" ||
      event.agentId === ORA_ROOT_AGENT_ID ||
      !isRecord(event.payload)
    ) {
      continue;
    }
    if (isInternalDeltaPayload(event.payload) || isCollaborationDeltaPayload(event.payload)) {
      continue;
    }
    const content = typeof event.payload.content === "string"
      ? event.payload.content
      : typeof event.payload.delta === "string"
        ? event.payload.delta
        : "";
    if (!content.trim()) {
      continue;
    }
    return {
      agentId: event.agentId,
      agentLabel: labels.get(event.agentId) ?? event.agentId,
      source: "public_delta",
    };
  }

  return {
    agentId: ORA_ROOT_AGENT_ID,
    agentLabel: labels.get(ORA_ROOT_AGENT_ID) ?? ORA_ROOT_AGENT_LABEL,
    source: "root_fallback",
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
