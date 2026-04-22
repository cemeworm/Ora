import { StateGraph, START, END } from "@langchain/langgraph";
import { OraGraphAnnotation } from "../graph/ora-state.js";
import type { OraGraphState } from "../graph/ora-state.js";

// Deterministic agent-teams pattern graph.
// Nodes: triage -> build -> check -> handoff -> END
// Worker memory is namespaced by worker ID.

function triageNode(state: OraGraphState): Partial<OraGraphState> {
  return {
    output: {
      backlog: ["triage", "build", "check", "handoff"],
      prompt: state.input.prompt,
      text: `Triaged work for: ${state.input.prompt}`,
    },
  };
}

function buildNode(state: OraGraphState): Partial<OraGraphState> {
  const output = state.output as Record<string, unknown>;
  return {
    output: {
      ...output,
      workers: {
        builder: "completed assigned work",
      },
      text: `Built output for: ${state.input.prompt}`,
    },
  };
}

function checkNode(state: OraGraphState): Partial<OraGraphState> {
  const output = state.output as Record<string, unknown>;
  return {
    output: {
      ...output,
      workers: {
        ...(output.workers as Record<string, unknown>),
        checker: "validated output",
      },
      text: `Checked output for: ${state.input.prompt}`,
    },
  };
}

function handoffNode(state: OraGraphState): Partial<OraGraphState> {
  return {
    output: {
      text: `Team result: ${state.input.prompt}`,
      pattern: state.pattern,
      backlog: ["triage", "build", "check", "handoff"],
      workers: {
        builder: "completed assigned work",
        checker: "validated output",
      },
    },
  };
}

export function createAgentTeamsGraph() {
  const graph = new StateGraph(OraGraphAnnotation)
    .addNode("triage", triageNode)
    .addNode("build", buildNode)
    .addNode("check", checkNode)
    .addNode("handoff", handoffNode)
    .addEdge(START, "triage")
    .addEdge("triage", "build")
    .addEdge("build", "check")
    .addEdge("check", "handoff")
    .addEdge("handoff", END);

  return graph.compile();
}
