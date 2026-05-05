import {
  DEFAULT_AGENT_MODE_TOOL_IDS,
  type AgentProfile,
  type ModeSpec,
  ORA_ROOT_AGENT_ID,
  ORA_ROOT_AGENT_LABEL,
  SINGLE_AGENT_MODE_ID,
  type TopologyEdge,
  type TopologyNode,
  orderedEnabledModeNodes,
} from "@cemeworm/shared";

export const ORA_ROOT_AGENT_ROLE =
  "Root conversation agent, Auto Mode Router initiator, clarification owner, handoff parent, observer, and final responder.";

export function rootAgentProfile(): AgentProfile {
  return {
    id: ORA_ROOT_AGENT_ID,
    label: ORA_ROOT_AGENT_LABEL,
    role: ORA_ROOT_AGENT_ROLE,
    systemPrompt: [
      "You are Ora, the root conversation agent for Ora.",
      "Receive the user's message first, keep the user's goal central, delegate only when the selected mode needs it, and author the final user-facing response.",
      "Do not expose hidden chain-of-thought or internal-only metadata.",
    ].join("\n"),
    toolPolicyId: "root.default_policy",
    toolIds: [...DEFAULT_AGENT_MODE_TOOL_IDS],
    skillIds: [],
    memoryNamespaces: ["session", "project"],
    budget: modeDefaultBudget(),
  };
}

export function injectRootAgentTopology(
  topology: { nodes: TopologyNode[]; edges: TopologyEdge[] },
  modeSpec: ModeSpec,
): { nodes: TopologyNode[]; edges: TopologyEdge[]; handoffTargetId?: string } {
  const handoffTargetId = rootAgentHandoffTarget(modeSpec);
  const nodesById = new Map(topology.nodes.map((node) => [node.id, { ...node }]));
  nodesById.set(ORA_ROOT_AGENT_ID, {
    id: ORA_ROOT_AGENT_ID,
    label: ORA_ROOT_AGENT_LABEL,
    kind: "agent",
    agentId: ORA_ROOT_AGENT_ID,
    status: "idle",
    metadata: {
      ...(nodesById.get(ORA_ROOT_AGENT_ID)?.metadata ?? {}),
      rootAgent: true,
      modeId: modeSpec.id,
    },
  });
  nodesById.set("run", {
    ...(nodesById.get("run") ?? {
      id: "run",
      label: "Run",
      kind: "run" as const,
      status: "idle" as const,
      metadata: {},
    }),
  });

  const edges = topology.edges
    .filter((edge) => !(edge.source === "run" && edge.target !== ORA_ROOT_AGENT_ID))
    .filter((edge) => edge.id !== "run-ora" && edge.id !== "ora-handoff");
  edges.unshift({
    id: "run-ora",
    source: "run",
    target: ORA_ROOT_AGENT_ID,
    kind: "control",
    label: "entry",
    metadata: { rootAgent: true, modeId: modeSpec.id },
  });
  if (handoffTargetId) {
    edges.push({
      id: "ora-handoff",
      source: ORA_ROOT_AGENT_ID,
      target: handoffTargetId,
      kind: "delegation",
      label: "handoff",
      metadata: { rootAgent: true, modeId: modeSpec.id },
    });
  }

  const nodes = [...nodesById.values()].sort((left, right) => {
    const rank = (node: TopologyNode) => node.id === "run" ? 0 : node.id === ORA_ROOT_AGENT_ID ? 1 : 2;
    return rank(left) - rank(right);
  });
  return { nodes, edges, handoffTargetId };
}

export function rootAgentHandoffTarget(modeSpec: ModeSpec): string | undefined {
  if (modeSpec.id === SINGLE_AGENT_MODE_ID) {
    return undefined;
  }
  if (modeSpec.family === "agent_teams" && hasProfile(modeSpec, "team_lead")) {
    return "team_lead";
  }
  if (modeSpec.family === "message_bus" && hasProfile(modeSpec, "router")) {
    return "router";
  }
  if ((modeSpec.family === "orchestrator_subagent" || modeSpec.family === "shared_state") && hasProfile(modeSpec, "orchestrator")) {
    return "orchestrator";
  }
  const firstOwner = orderedEnabledModeNodes(modeSpec)
    .map((node) => node.ownerAgentId)
    .find((agentId): agentId is string => typeof agentId === "string" && agentId !== ORA_ROOT_AGENT_ID);
  return firstOwner ?? modeSpec.profiles.find((profile) => profile.id !== ORA_ROOT_AGENT_ID)?.id;
}

function hasProfile(modeSpec: ModeSpec, agentId: string): boolean {
  return modeSpec.profiles.some((profile) => profile.id === agentId);
}

function modeDefaultBudget(): AgentProfile["budget"] {
  return {
    maxTokens: 18000,
    maxToolCalls: 256,
    maxRuntimeMs: 300000,
    maxCostUsd: 3,
  };
}
