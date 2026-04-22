import { StateGraph, START, END } from "@langchain/langgraph";
import { OraGraphAnnotation } from "../graph/ora-state.js";
import type { OraGraphState } from "../graph/ora-state.js";

// Deterministic generator-verifier pattern graph.
// Nodes: draft -> verify -> decide (conditional to END or retry draft, max 3)

function draftNode(state: OraGraphState): Partial<OraGraphState> {
  const retryCount = (state.output as Record<string, number> | undefined)?.retryCount ?? 0;
  const candidate = `Candidate answer for: ${state.input.prompt} (attempt ${retryCount + 1})`;

  return {
    output: {
      candidate,
      retryCount: retryCount + 1,
      text: `Drafted: ${candidate}`,
    },
  };
}

function verifyNode(state: OraGraphState): Partial<OraGraphState> {
  const output = state.output as Record<string, unknown>;
  const candidate = (output?.candidate as string) ?? "no candidate";
  const retryCount = (output?.retryCount as number) ?? 0;

  // Deterministic verification: pass on attempt 2 or later (simulates a retry)
  const verdict = retryCount >= 2 ? "pass" : "fail";

  return {
    output: {
      ...output,
      verdict,
      rubric: ["addresses prompt", "bounded deterministic output"],
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

export function createGeneratorVerifierGraph() {
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

  return graph.compile();
}
