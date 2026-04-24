import { StateGraph, START, END } from "@langchain/langgraph";
import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";
import { OraGraphAnnotation } from "../graph/ora-state.js";
import type { OraGraphState } from "../graph/ora-state.js";
import { invokeRunProvider } from "../providers/index.js";
import { assessGeneratorVerifierResponse } from "./generator-verifier-utils.js";

// Deterministic generator-verifier pattern graph.
// Nodes: draft -> verify -> decide (conditional to END or retry draft, max 3)

async function draftNode(state: OraGraphState): Promise<Partial<OraGraphState>> {
  const retryCount = (state.output as Record<string, number> | undefined)?.retryCount ?? 0;
  const model = await invokeRunProvider(state.config, {
    prompt: [
      `Prompt: ${state.input.prompt}`,
      `Attempt: ${retryCount + 1}`,
      `Previous verifier notes: ${String((state.output as Record<string, unknown> | undefined)?.verifierText ?? "")}`,
      "Write a better candidate answer. Return only the candidate response.",
    ].join("\n"),
    system: "You are the generator in Ora's Generator-Verifier pattern. Return only the candidate response.",
    maxTokens: state.config.budget?.maxTokens
  });
  const candidate = model.text;

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
    prompt: [
      `Original prompt: ${state.input.prompt}`,
      "Rubric:",
      "- addresses prompt",
      "- bounded deterministic output",
      "Candidate:",
      candidate,
      "Return JSON with keys verdict ('pass'|'fail'), rationale, and missingRequirements (array of strings).",
    ].join("\n"),
    system: "You are the verifier in Ora's Generator-Verifier pattern. Return only JSON with verdict, rationale, and missingRequirements.",
    maxTokens: state.config.budget?.maxTokens
  });
  const assessment = assessGeneratorVerifierResponse({
    candidate,
    verifierResponse: model.text,
    providerId: output?.provider && typeof output.provider === "object"
      ? (output.provider as Record<string, unknown>).id as string | undefined
      : state.config.providerId ?? state.config.providerConfig?.id,
  });

  return {
    output: {
      ...output,
      verdict: assessment.verdict,
      rubric: ["addresses prompt", "bounded deterministic output"],
      verifierText: model.text,
      rationale: assessment.rationale,
      missingRequirements: assessment.missingRequirements,
      text: assessment.verdict === "pass"
        ? candidate
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
