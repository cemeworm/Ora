import { StateGraph, START, END } from "@langchain/langgraph";
import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";
import { OraGraphAnnotation } from "../graph/ora-state.js";
import type { OraGraphState } from "../graph/ora-state.js";
import { invokeRunProvider } from "../providers/index.js";

async function seedNode(state: OraGraphState): Promise<Partial<OraGraphState>> {
  const model = await invokeRunProvider(state.config, {
    prompt: `Seed the shared-state board for: ${state.input.prompt}`,
    system: "You are the seed agent. Create the initial shared-state hypothesis.",
    maxTokens: state.config.budget?.maxTokens,
  });
  return {
    output: {
      seed: model.text,
      entries: [{ key: "seed", summary: model.text }],
    },
  };
}

async function contributeNode(state: OraGraphState): Promise<Partial<OraGraphState>> {
  const output = state.output as Record<string, unknown>;
  const model = await invokeRunProvider(state.config, {
    prompt: `Contribute a new shared-state finding for: ${state.input.prompt}\nCurrent board: ${JSON.stringify(output.entries)}`,
    system: "You are the research agent. Add a new finding.",
    maxTokens: state.config.budget?.maxTokens,
  });
  return {
    output: {
      ...output,
      finding: model.text,
      entries: [...((output.entries as unknown[]) ?? []), { key: "finding-1", summary: model.text }],
    },
  };
}

async function convergeNode(state: OraGraphState): Promise<Partial<OraGraphState>> {
  const output = state.output as Record<string, unknown>;
  const model = await invokeRunProvider(state.config, {
    prompt: `Review whether this shared-state board has converged for: ${state.input.prompt}\nBoard: ${JSON.stringify(output.entries)}`,
    system: "You are the critic agent. Decide whether the board has converged.",
    maxTokens: state.config.budget?.maxTokens,
  });
  return {
    output: {
      text: model.text,
      entries: [...((output.entries as unknown[]) ?? []), { key: "convergence", summary: model.text }],
      convergence: model.text,
    },
  };
}

export function createSharedStateGraph(checkpointer?: BaseCheckpointSaver | false) {
  return new StateGraph(OraGraphAnnotation)
    .addNode("seed", seedNode)
    .addNode("contribute", contributeNode)
    .addNode("converge", convergeNode)
    .addEdge(START, "seed")
    .addEdge("seed", "contribute")
    .addEdge("contribute", "converge")
    .addEdge("converge", END)
    .compile({ checkpointer });
}
