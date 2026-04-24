import { StateGraph, START, END } from "@langchain/langgraph";
import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";
import { OraGraphAnnotation } from "../graph/ora-state.js";
import type { OraGraphState } from "../graph/ora-state.js";
import { invokeRunProvider } from "../providers/index.js";
import { ensureGraphClarification, ensureGraphManualApproval } from "./hitl.js";
import { withGraphPersona } from "./system-prompt.js";

// Deterministic orchestrator-subagent pattern graph.
// Nodes: decompose -> research -> review -> synthesize -> END

async function decomposeNode(state: OraGraphState): Promise<Partial<OraGraphState>> {
  ensureGraphClarification(state, "decompose", "Decompose");
  ensureGraphManualApproval(state, "decompose", "Decompose");
  const model = await invokeRunProvider(state.config, {
    prompt: `Decompose this task into research, review, and synthesize work: ${state.input.prompt}`,
    system: withGraphPersona(state, "You are Ora's orchestrator. Keep the plan short and inspectable."),
    maxTokens: state.config.budget?.maxTokens
  });

  return {
    output: {
      decomposition: ["research", "review", "synthesize"],
      prompt: state.input.prompt,
      providerText: model.text,
      text: `Decomposed task: ${state.input.prompt}`,
    },
  };
}

async function researchNode(state: OraGraphState): Promise<Partial<OraGraphState>> {
  ensureGraphClarification(state, "research", "Research");
  ensureGraphManualApproval(state, "research", "Research");
  const output = state.output as Record<string, unknown>;
  const model = await invokeRunProvider(state.config, {
    prompt: `Gather focused context for: ${state.input.prompt}`,
    system: withGraphPersona(state, "You are Ora's research subagent. Return concise findings."),
    maxTokens: state.config.budget?.maxTokens
  });

  return {
    output: {
      ...output,
      research: model.text || "focused context gathered",
      text: `Researched context for: ${state.input.prompt}`,
    },
  };
}

async function reviewNode(state: OraGraphState): Promise<Partial<OraGraphState>> {
  ensureGraphClarification(state, "review", "Review");
  ensureGraphManualApproval(state, "review", "Review");
  const output = state.output as Record<string, unknown>;
  const model = await invokeRunProvider(state.config, {
    prompt: `Review completeness and risks for: ${state.input.prompt}`,
    system: withGraphPersona(state, "You are Ora's review subagent. Return risks and gaps."),
    maxTokens: state.config.budget?.maxTokens
  });

  return {
    output: {
      ...output,
      review: model.text || "risks checked",
      text: `Reviewed findings for: ${state.input.prompt}`,
    },
  };
}

function synthesizeNode(state: OraGraphState): Partial<OraGraphState> {
  const output = state.output as Record<string, unknown>;
  return {
    output: {
      text: `Orchestrated result: ${state.input.prompt}`,
      pattern: state.pattern,
      orchestrator: {
        decomposition: output.decomposition ?? ["research", "review", "synthesize"],
        plan: output.providerText,
      },
      subagents: {
        researcher: output.research ?? "focused context gathered",
        reviewer: output.review ?? "risks checked",
      },
    },
  };
}

export function createOrchestratorSubagentGraph(checkpointer?: BaseCheckpointSaver | false) {
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

  return graph.compile({ checkpointer });
}
