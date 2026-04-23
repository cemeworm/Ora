import type { CoordinationPattern } from "@ora/shared";
import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";
import { createGeneratorVerifierGraph } from "./generator-verifier.js";
import { createOrchestratorSubagentGraph } from "./orchestrator-subagent.js";
import { createAgentTeamsGraph } from "./agent-teams.js";
import { createMessageBusGraph } from "./message-bus.js";
import { createSharedStateGraph } from "./shared-state.js";

export { createGeneratorVerifierGraph } from "./generator-verifier.js";
export { createOrchestratorSubagentGraph } from "./orchestrator-subagent.js";
export { createAgentTeamsGraph } from "./agent-teams.js";
export { createMessageBusGraph } from "./message-bus.js";
export { createSharedStateGraph } from "./shared-state.js";

export function createPatternGraph(pattern: CoordinationPattern) {
  switch (pattern) {
    case "generator_verifier":
      return createGeneratorVerifierGraph();
    case "orchestrator_subagent":
      return createOrchestratorSubagentGraph();
    case "agent_teams":
      return createAgentTeamsGraph();
    case "message_bus":
      return createMessageBusGraph();
    case "shared_state":
      return createSharedStateGraph();
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
    case "message_bus":
      return { graph: createMessageBusGraph(checkpointer), checkpointer };
    case "shared_state":
      return { graph: createSharedStateGraph(checkpointer), checkpointer };
  }
}
