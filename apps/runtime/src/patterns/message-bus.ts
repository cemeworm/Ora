import { StateGraph, START, END } from "@langchain/langgraph";
import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";
import { OraGraphAnnotation } from "../graph/ora-state.js";
import type { OraGraphState } from "../graph/ora-state.js";
import { invokeRunProvider } from "../providers/index.js";

async function routeNode(state: OraGraphState): Promise<Partial<OraGraphState>> {
  const model = await invokeRunProvider(state.config, {
    prompt: `Route this task onto the correct message-bus topic: ${state.input.prompt}`,
    system: "You are the bus router. Return a compact routing decision.",
    maxTokens: state.config.budget?.maxTokens,
  });
  return {
    output: {
      route: model.text,
      correlationId: `${state.runId}-bus`,
    },
  };
}

async function handleNode(state: OraGraphState): Promise<Partial<OraGraphState>> {
  const output = state.output as Record<string, unknown>;
  const model = await invokeRunProvider(state.config, {
    prompt: `Handle this routed message for: ${state.input.prompt}\nRoute: ${output.route}`,
    system: "You are the bus subscriber. Return the handled result.",
    maxTokens: state.config.budget?.maxTokens,
  });
  return {
    output: {
      ...output,
      handled: model.text,
    },
  };
}

function respondNode(state: OraGraphState): Partial<OraGraphState> {
  const output = state.output as Record<string, unknown>;
  return {
    output: {
      text: output.handled,
      route: output.route,
      correlationId: output.correlationId,
    },
  };
}

export function createMessageBusGraph(checkpointer?: BaseCheckpointSaver | false) {
  return new StateGraph(OraGraphAnnotation)
    .addNode("route", routeNode)
    .addNode("handle", handleNode)
    .addNode("respond", respondNode)
    .addEdge(START, "route")
    .addEdge("route", "handle")
    .addEdge("handle", "respond")
    .addEdge("respond", END)
    .compile({ checkpointer });
}
