import { StateGraph, START, END } from "@langchain/langgraph";
import { OraGraphAnnotation } from "../graph/ora-state.js";
import type { OraGraphState } from "../graph/ora-state.js";

// Deterministic orchestrator-subagent pattern graph.
// Nodes: decompose -> research -> review -> synthesize -> END

function decomposeNode(state: OraGraphState): Partial<OraGraphState> {
  return {
    output: {
      decomposition: ["research", "review", "synthesize"],
      prompt: state.input.prompt,
      text: `Decomposed task: ${state.input.prompt}`,
    },
  };
}

function researchNode(state: OraGraphState): Partial<OraGraphState> {
  const output = state.output as Record<string, unknown>;
  return {
    output: {
      ...output,
      research: "focused context gathered",
      text: `Researched context for: ${state.input.prompt}`,
    },
  };
}

function reviewNode(state: OraGraphState): Partial<OraGraphState> {
  const output = state.output as Record<string, unknown>;
  return {
    output: {
      ...output,
      review: "risks checked",
      text: `Reviewed findings for: ${state.input.prompt}`,
    },
  };
}

function synthesizeNode(state: OraGraphState): Partial<OraGraphState> {
  return {
    output: {
      text: `Orchestrated result: ${state.input.prompt}`,
      pattern: state.pattern,
      orchestrator: {
        decomposition: ["research", "review", "synthesize"],
      },
      subagents: {
        researcher: "focused context gathered",
        reviewer: "risks checked",
      },
    },
  };
}

export function createOrchestratorSubagentGraph() {
  const graph = new StateGraph(OraGraphAnnotation)
    .addNode("decompose", decomposeNode)
    .addNode("research", researchNode)
    .addNode("review", reviewNode)
    .addNode("synthesize", synthesizeNode)
    .addEdge(START, "decompose")
    .addEdge("decompose", "research")
    .addEdge("research", "review")
    .addEdge("review", "synthesize")
    .addEdge("synthesize", END);

  return graph.compile();
}
