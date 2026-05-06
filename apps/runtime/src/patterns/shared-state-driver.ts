import { orderedEnabledModeNodes } from "@cemeworm/shared";
import type { PatternExecutionResult } from "./execution-context.js";
import type { ModeExecutionInput } from "./mode-driver-registry.js";
import { agentMessageContent, asText, initializeQueueSummary, mention, nodeCustomAgentId, nodeSystemPrompt, ownerForTemplate, promptTemplate, runtimeFallbackPrompt, titleForNode } from "./driver-utils.js";
import { runGenericModeNode } from "./generic-node-executor.js";
import { type ExecutionBag } from "./mode-driver-helpers.js";

export async function executeSharedState(input: ModeExecutionInput): Promise<PatternExecutionResult> {
  const { context, prompt, modeSpec } = input;
  const nodes = orderedEnabledModeNodes(modeSpec);
  const totalActiveNodes = nodes.length;
  initializeQueueSummary(context, modeSpec.family, totalActiveNodes);
  const bag: ExecutionBag = { prompt };
  const orchestratorId = ownerForTemplate(nodes, "seed", "orchestrator");
  const researcherId = ownerForTemplate(nodes, "research", "researcher");
  const reviewerId = ownerForTemplate(nodes, "converge", "reviewer");
  let completedNodes = 0;

  for (const node of nodes) {
      completedNodes = await runGenericModeNode(context, modeSpec, node, totalActiveNodes, completedNodes, async () => {
        if (node.template === "seed") {
        const agentId = node.ownerAgentId ?? orchestratorId;
        bag.seed = await context.callAgent({
          agentId,
          planItemId: node.id,
          title: titleForNode(node, "Seed shared board"),
          prompt: promptTemplate(
            node,
            runtimeFallbackPrompt(modeSpec.family, node.template),
            bag,
          ),
          system: nodeSystemPrompt(context, modeSpec, node, bag),
          customAgentId: nodeCustomAgentId(node),
          riskLevel: node.riskLevel,
        });
        context.writeSharedState({
          agentId,
          key: "seed",
          summary: asText(bag.seed),
          value: { prompt, seed: bag.seed },
        });
        bag.seedMessageId = context.emitAgentMessage({
          fromAgentId: agentId,
          toAgentIds: [researcherId],
          threadId: "shared-state:board",
          nodeId: node.id,
          planItemId: node.id,
          kind: "mention",
          status: "done",
          content: agentMessageContent(`${mention(researcherId)} shared board seeded; add findings from this starting point:\n\n`, bag.seed),
        }).id;
        return bag.seed;
      }

      if (node.template === "research") {
        const agentId = node.ownerAgentId ?? researcherId;
        bag.research = await context.callAgent({
          agentId,
          planItemId: node.id,
          title: titleForNode(node, "Contribute findings"),
          prompt: promptTemplate(
            node,
            runtimeFallbackPrompt(modeSpec.family, node.template),
            {
              ...bag,
              sharedBoard: JSON.stringify(context.currentSharedState().entries),
            },
          ),
          system: nodeSystemPrompt(context, modeSpec, node, {
            ...bag,
            sharedBoard: JSON.stringify(context.currentSharedState().entries),
          }),
          customAgentId: nodeCustomAgentId(node),
          riskLevel: node.riskLevel,
        });
        context.writeSharedState({
          agentId,
          key: "finding-1",
          summary: asText(bag.research),
          value: { research: bag.research },
        });
        bag.researchMessageId = context.emitAgentMessage({
          fromAgentId: agentId,
          toAgentIds: [reviewerId],
          replyToId: typeof bag.seedMessageId === "string" ? bag.seedMessageId : undefined,
          threadId: "shared-state:board",
          nodeId: node.id,
          planItemId: node.id,
          kind: "reply",
          status: "done",
          content: agentMessageContent(`${mention(reviewerId)} findings added to the board:\n\n`, bag.research),
        }).id;
        return bag.research;
      }

      if (node.template === "converge") {
        const agentId = node.ownerAgentId ?? reviewerId;
        bag.convergence = await context.callAgent({
          agentId,
          planItemId: node.id,
          title: titleForNode(node, "Review convergence"),
          prompt: promptTemplate(
            node,
            runtimeFallbackPrompt(modeSpec.family, node.template),
            {
              ...bag,
              sharedBoard: JSON.stringify(context.currentSharedState().entries),
            },
          ),
          system: nodeSystemPrompt(context, modeSpec, node, {
            ...bag,
            sharedBoard: JSON.stringify(context.currentSharedState().entries),
          }),
          customAgentId: nodeCustomAgentId(node),
          riskLevel: node.riskLevel,
        });
        context.writeSharedState({
          agentId,
          key: "convergence",
          summary: asText(bag.convergence),
          value: { convergence: bag.convergence, stopReason: "converged" },
        });
        context.emitAgentMessage({
          fromAgentId: agentId,
          toAgentIds: [orchestratorId, researcherId],
          replyToId: typeof bag.researchMessageId === "string" ? bag.researchMessageId : undefined,
          threadId: "shared-state:board",
          nodeId: node.id,
          planItemId: node.id,
          kind: "reply",
          status: "done",
          content: agentMessageContent(`Board convergence reviewed for ${mention(orchestratorId)} and ${mention(researcherId)}:\n\n`, bag.convergence),
        });
        return bag.convergence;
      }
    });
  }

  return {
    output: {
      text: asText(bag.convergence || bag.research || bag.seed),
      pattern: "shared_state",
      modeId: modeSpec.id,
      board: context.currentSharedState().entries,
      convergence: bag.convergence,
    },
  };
}
