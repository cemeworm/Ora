import { StateGraph, START, END } from "@langchain/langgraph";
import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";
import { OraGraphAnnotation } from "../graph/ora-state.js";
import type { OraGraphState } from "../graph/ora-state.js";
import { invokeRunProvider } from "../providers/index.js";

// Deterministic generator-verifier pattern graph.
// Nodes: draft -> verify -> decide (conditional to END or retry draft, max 3)

async function draftNode(state: OraGraphState): Promise<Partial<OraGraphState>> {
  const retryCount = (state.output as Record<string, number> | undefined)?.retryCount ?? 0;
  const model = await invokeRunProvider(state.config, {
    prompt: `Draft a candidate answer for: ${state.input.prompt}`,
    system: "You are the generator in Ora's Generator-Verifier pattern.",
    maxTokens: state.config.budget?.maxTokens
  });
  const candidate = `${model.text} (attempt ${retryCount + 1})`;

  return {
    output: {
      candidate,
      retryCount: retryCount + 1,
      provider: {
        id: model.providerId,
        modelId: model.modelId,
      },
      text: `Drafted: ${candidate}`,
    },
  };
}

async function verifyNode(state: OraGraphState): Promise<Partial<OraGraphState>> {
  const output = state.output as Record<string, unknown>;
  const candidate = (output?.candidate as string) ?? "no candidate";
  const retryCount = (output?.retryCount as number) ?? 0;
  const model = await invokeRunProvider(state.config, {
    prompt: `Verify this candidate against the prompt "${state.input.prompt}":\n\n${candidate}`,
    system: "You are the verifier in Ora's Generator-Verifier pattern. Return concise rubric findings.",
    maxTokens: state.config.budget?.maxTokens
  });

  // Deterministic verification: pass on attempt 2 or later (simulates a retry)
  const verdict = retryCount >= 2 ? "pass" : "fail";

  return {
    output: {
      ...output,
      verdict,
      rubric: ["addresses prompt", "bounded deterministic output"],
      verifierText: model.text,
      text: verdict === "pass"
        ? `Verified: ${candidate}`
        : `Verification failed for: ${candidate}, retry ${retryCount}/3`,
    },
  };
}

// The "decide" node is a no-op that just passes state through.
// The actual routing decision is made by the conditional edge function.
function decideNode(state: OraGraphState): Partial<OraGraphState> {
  return {};
}

function routeAfterDecide(state: OraGraphState): typeof END | "draft" {
  const output = state.output as Record<string, unknown> | undefined;
  const verdict = output?.verdict as string | undefined;
  const retryCount = (output?.retryCount as number) ?? 0;

  if (verdict === "pass" || retryCount >= 3) {
    return END;
  }
  return "draft";
}

export function createGeneratorVerifierGraph(checkpointer?: BaseCheckpointSaver | false) {
  const graph = new StateGraph(OraGraphAnnotation)
    .addNode("draft", draftNode)
    .addNode("verify", verifyNode)
    .addNode("decide", decideNode)
    .addEdge(START, "draft")
    .addEdge("draft", "verify")
    .addEdge("verify", "decide")
    .addConditionalEdges("decide", routeAfterDecide, {
      [END]: END,
      draft: "draft",
    });

  return graph.compile({ checkpointer });
}
