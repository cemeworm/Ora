import { StateGraph, START, END } from "@langchain/langgraph";
import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";
import { OraGraphAnnotation } from "../graph/ora-state.js";
import type { OraGraphState } from "../graph/ora-state.js";
import { createDefaultProviderRegistry } from "../providers/index.js";

// Deterministic agent-teams pattern graph.
// Nodes: triage -> build -> check -> handoff -> END
// Worker memory is namespaced by worker ID.

const providerRegistry = createDefaultProviderRegistry();

function configuredProviderId(state: OraGraphState): string | undefined {
  const providerId = state.config.providerId ?? state.config.metadata.providerId;
  return typeof providerId === "string" ? providerId : state.config.modelRef;
}

async function triageNode(state: OraGraphState): Promise<Partial<OraGraphState>> {
  const model = await providerRegistry.invoke(configuredProviderId(state), {
    prompt: `Triage this work into a team backlog: ${state.input.prompt}`,
    system: "You are Ora's team lead. Keep ownership explicit.",
    maxTokens: state.config.budget?.maxTokens
  });

  return {
    output: {
      backlog: ["triage", "build", "check", "handoff"],
      prompt: state.input.prompt,
      triage: model.text,
      text: `Triaged work for: ${state.input.prompt}`,
    },
  };
}

async function buildNode(state: OraGraphState): Promise<Partial<OraGraphState>> {
  const output = state.output as Record<string, unknown>;
  const model = await providerRegistry.invoke(configuredProviderId(state), {
    prompt: `Complete the builder assignment for: ${state.input.prompt}`,
    system: "You are Ora's persistent builder teammate.",
    maxTokens: state.config.budget?.maxTokens
  });

  return {
    output: {
      ...output,
      workers: {
        builder: model.text || "completed assigned work",
      },
      text: `Built output for: ${state.input.prompt}`,
    },
  };
}

async function checkNode(state: OraGraphState): Promise<Partial<OraGraphState>> {
  const output = state.output as Record<string, unknown>;
  const model = await providerRegistry.invoke(configuredProviderId(state), {
    prompt: `Validate the builder output for: ${state.input.prompt}`,
    system: "You are Ora's persistent checker teammate.",
    maxTokens: state.config.budget?.maxTokens
  });

  return {
    output: {
      ...output,
      workers: {
        ...(output.workers as Record<string, unknown>),
        checker: model.text || "validated output",
      },
      text: `Checked output for: ${state.input.prompt}`,
    },
  };
}

function handoffNode(state: OraGraphState): Partial<OraGraphState> {
  const output = state.output as Record<string, unknown>;
  return {
    output: {
      text: `Team result: ${state.input.prompt}`,
      pattern: state.pattern,
      backlog: output.backlog ?? ["triage", "build", "check", "handoff"],
      triage: output.triage,
      workers: output.workers ?? {
        builder: "completed assigned work",
        checker: "validated output",
      },
    },
  };
}

export function createAgentTeamsGraph(checkpointer?: BaseCheckpointSaver | false) {
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

  return graph.compile({ checkpointer });
}
