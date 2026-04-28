import {
  CoordinationPattern,
  ModeSpec,
  StateSnapshot,
  orderedEnabledModeNodes
} from "@ora/shared";
import { OraRuntimeError } from "./runtime-errors.js";

export interface DeterministicPatternOutput {
  token: string;
  tokenCount: number;
  message: string;
  state: unknown;
}

export function modeUsesSingleOwner(modeSpec: ModeSpec): boolean {
  const nodes = orderedEnabledModeNodes(modeSpec);
  const fallbackAgentId = modeSpec.profiles[0]?.id;
  const ownerIds = new Set(
    nodes.map((node) => node.ownerAgentId ?? fallbackAgentId).filter((id): id is string => typeof id === "string"),
  );
  return ownerIds.size <= 1 && !nodes.some((node) => {
    const atoms = Array.isArray(node.config?.atoms) ? node.config.atoms : [];
    return atoms.includes("subagent_delegate");
  });
}

export function primaryOwnerAgentId(modeSpec: ModeSpec): string {
  return orderedEnabledModeNodes(modeSpec).find((node) => node.ownerAgentId)?.ownerAgentId ?? modeSpec.profiles[0]?.id ?? "agent";
}

export function patternActionType(pattern: CoordinationPattern, modeSpec: ModeSpec): string {
  if (modeUsesSingleOwner(modeSpec)) {
    return `mode.${modeSpec.id}.respond`;
  }
  switch (pattern) {
    case "generator_verifier":
      return "pattern.generator_verifier.verify_candidate";
    case "orchestrator_subagent":
      return "pattern.orchestrator_subagent.dispatch_subagent";
    case "agent_teams":
      return "pattern.agent_teams.assign_worker";
    case "message_bus":
      return "pattern.message_bus.publish_event";
    case "shared_state":
      return "pattern.shared_state.write_board";
  }
  throw new OraRuntimeError(`Unsupported pattern action type: ${pattern}`, -32002, { pattern });
}

export function patternMemoryNamespace(
  pattern: CoordinationPattern,
  projectId: string | undefined,
  modeSpec: ModeSpec,
): string[] {
  const projectNamespace = projectId ?? "local-project";
  switch (pattern) {
    case "generator_verifier":
      return ["session", projectNamespace, modeSpec.id];
    case "orchestrator_subagent":
      return ["session", projectNamespace, modeSpec.id];
    case "agent_teams":
      return ["worker", projectNamespace, modeSpec.id];
    case "message_bus":
      return ["session", projectNamespace, modeSpec.id];
    case "shared_state":
      return ["project", projectNamespace, modeSpec.id];
  }
  throw new OraRuntimeError(`Unsupported pattern memory namespace: ${pattern}`, -32002, { pattern });
}

export function patternOutput(
  pattern: CoordinationPattern,
  prompt: string,
  modeSpec: ModeSpec,
): DeterministicPatternOutput {
  if (modeUsesSingleOwner(modeSpec)) {
    const agentId = primaryOwnerAgentId(modeSpec);
    return {
      token: "answered",
      tokenCount: 1,
      message: `${modeSpec.label} framed "${prompt}" and completed the response without delegation.`,
      state: {
        text: `Single-agent result: ${prompt}`,
        pattern,
        modeId: modeSpec.id,
        agent: {
          id: agentId,
          plan: `Compact plan for: ${prompt}`,
          response: `Direct answer for: ${prompt}`,
        },
      },
    };
  }
  switch (pattern) {
    case "generator_verifier":
      return {
        token: "verified",
        tokenCount: 1,
        message: `Generator produced a candidate for "${prompt}" and verifier accepted it against the MVP rubric.`,
        state: {
          text: `Verified candidate: ${prompt}`,
          pattern,
          modeId: modeSpec.id,
          generator: {
            candidate: `Candidate answer for: ${prompt}`,
          },
          verifier: {
            verdict: "pass",
            rubric: ["addresses prompt", "bounded deterministic output"],
          },
        },
      };
    case "orchestrator_subagent":
      return {
        token: "delegated",
        tokenCount: 1,
        message: `Orchestrator decomposed "${prompt}", dispatched subagents, and synthesized their deterministic findings.`,
        state: {
          text: `Orchestrated result: ${prompt}`,
          pattern,
          modeId: modeSpec.id,
          orchestrator: {
            decomposition: ["research", "review", "synthesize"],
          },
          subagents: {
            researcher: "focused context gathered",
            reviewer: "risks checked",
          },
        },
      };
    case "agent_teams":
      return {
        token: "assigned",
        tokenCount: 1,
        message: `Team lead assigned "${prompt}" to persistent workers and recorded the handoff.`,
        state: {
          text: `Team result: ${prompt}`,
          pattern,
          modeId: modeSpec.id,
          backlog: ["triage", "build", "check", "handoff"],
          workers: {
            builder: "completed assigned work",
            reviewer: "validated output",
          },
        },
      };
    case "message_bus":
      return {
        token: "published",
        tokenCount: 1,
        message: `Router published "${prompt}" onto the bus, routed it, and the responder emitted the final message.`,
        state: {
          text: `Bus response: ${prompt}`,
          pattern,
          modeId: modeSpec.id,
          correlationId: `${prompt.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-corr`,
          routingPlan: "task.input -> task.findings -> task.response",
        },
      };
    case "shared_state":
      return {
        token: "converged",
        tokenCount: 1,
        message: `Agents updated the shared board for "${prompt}" until the critic declared convergence.`,
        state: {
          text: `Shared-state result: ${prompt}`,
          pattern,
          modeId: modeSpec.id,
          board: [
            { key: "seed", summary: `Seeded board for ${prompt}` },
            { key: "finding-1", summary: "Added supporting evidence" },
            { key: "convergence", summary: "Board converged" },
          ],
        },
      };
  }
  throw new OraRuntimeError(`Unsupported pattern output: ${pattern}`, -32002, { pattern });
}

export function withTopologyStatus(snapshot: StateSnapshot, status: "running" | "done"): StateSnapshot["topology"] {
  return {
    nodes: snapshot.topology.nodes.map((node) => ({
      ...node,
      status,
    })),
    edges: snapshot.topology.edges,
  };
}
