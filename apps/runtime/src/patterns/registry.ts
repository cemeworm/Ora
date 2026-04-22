import type { CoordinationPattern } from "@ora/shared";
import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";
import { createGeneratorVerifierGraph } from "./generator-verifier.js";
import { createOrchestratorSubagentGraph } from "./orchestrator-subagent.js";
import { createAgentTeamsGraph } from "./agent-teams.js";

export { createGeneratorVerifierGraph } from "./generator-verifier.js";
export { createOrchestratorSubagentGraph } from "./orchestrator-subagent.js";
export { createAgentTeamsGraph } from "./agent-teams.js";

export function createPatternGraph(pattern: CoordinationPattern) {
  switch (pattern) {
    case "generator_verifier":
      return createGeneratorVerifierGraph();
    case "orchestrator_subagent":
      return createOrchestratorSubagentGraph();
    case "agent_teams":
      return createAgentTeamsGraph();
  }
}

export function createPatternGraphWithCheckpointer(
  pattern: CoordinationPattern,
  checkpointer: BaseCheckpointSaver | false = false
) {
  switch (pattern) {
    case "generator_verifier":
      return { graph: createGeneratorVerifierGraph(checkpointer), checkpointer };
    case "orchestrator_subagent":
      return { graph: createOrchestratorSubagentGraph(checkpointer), checkpointer };
    case "agent_teams":
      return { graph: createAgentTeamsGraph(checkpointer), checkpointer };
  }
}
