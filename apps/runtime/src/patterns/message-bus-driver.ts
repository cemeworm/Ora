import { orderedEnabledModeNodes } from "@cemeworm/shared";
import type { PatternExecutionResult } from "./execution-context.js";
import type { ModeExecutionInput } from "./mode-driver-registry.js";
import { agentMessageContent, asText, correlationId, initializeQueueSummary, mention, nodeCustomAgentId, nodeSystemPrompt, ownerForTemplate, promptTemplate, runtimeFallbackPrompt, titleForNode } from "./driver-utils.js";
import { runGenericModeNode } from "./generic-node-executor.js";
import { type ExecutionBag } from "./mode-driver-helpers.js";

export async function executeMessageBus(input: ModeExecutionInput): Promise<PatternExecutionResult> {
  const { context, prompt, modeSpec } = input;
  const nodes = orderedEnabledModeNodes(modeSpec);
  const totalActiveNodes = nodes.length;
  initializeQueueSummary(context, modeSpec.family, totalActiveNodes);
  const bag: ExecutionBag = {
    prompt,
    correlationId: correlationId("bus"),
  };
  const routerId = ownerForTemplate(nodes, "route", ownerForTemplate(nodes, "publish", "router"));
  const researcherId = ownerForTemplate(nodes, "handle", "researcher");
  const responderId = ownerForTemplate(nodes, "respond", "responder");
  let completedNodes = 0;

  for (const node of nodes) {
      completedNodes = await runGenericModeNode(context, modeSpec, node, totalActiveNodes, completedNodes, async () => {
        if (node.template === "publish") {
        const agentId = node.ownerAgentId ?? routerId;
        context.publishMessage({
          agentId,
          topic: "task.input",
          correlationId: asText(bag.correlationId),
          summary: `Published input event for: ${prompt}`,
          payload: { prompt },
        });
        bag.publish = `Published input event for: ${prompt}`;
        bag.publishMessageId = context.emitAgentMessage({
          fromAgentId: agentId,
          toAgentIds: [routerId],
          threadId: asText(bag.correlationId),
          nodeId: node.id,
          planItemId: node.id,
          kind: "publish",
          status: "done",
          topic: "task.input",
          correlationId: asText(bag.correlationId),
          content: agentMessageContent(`${mention(routerId)} input event published on task.input:\n\n`, prompt),
        }).id;
        return bag.publish;
      }

      if (node.template === "route") {
        const agentId = node.ownerAgentId ?? routerId;
        bag.routingPlan = await context.callAgent({
          agentId,
          planItemId: node.id,
          title: titleForNode(node, "Route event"),
          prompt: promptTemplate(
            node,
            runtimeFallbackPrompt(modeSpec.family, node.template),
            bag,
          ),
          system: nodeSystemPrompt(context, modeSpec, node, bag),
          customAgentId: nodeCustomAgentId(node),
          riskLevel: node.riskLevel,
        });
        context.routeMessage({
          agentId,
          fromTopic: "task.input",
          toTopic: "task.findings",
          correlationId: asText(bag.correlationId),
          summary: asText(bag.routingPlan),
        });
        bag.routeMessageId = context.emitAgentMessage({
          fromAgentId: agentId,
          toAgentIds: [researcherId],
          replyToId: typeof bag.publishMessageId === "string" ? bag.publishMessageId : undefined,
          threadId: asText(bag.correlationId),
          nodeId: node.id,
          planItemId: node.id,
          kind: "route",
          status: "done",
          topic: "task.findings",
          correlationId: asText(bag.correlationId),
          content: agentMessageContent(`${mention(researcherId)} routed task.findings to you:\n\n`, bag.routingPlan),
        }).id;
        return bag.routingPlan;
      }

      if (node.template === "handle") {
        const agentId = node.ownerAgentId ?? researcherId;
        bag.findings = await context.callAgent({
          agentId,
          planItemId: node.id,
          title: titleForNode(node, "Handle routed work"),
          prompt: promptTemplate(
            node,
            runtimeFallbackPrompt(modeSpec.family, node.template),
            bag,
          ),
          system: nodeSystemPrompt(context, modeSpec, node, bag),
          customAgentId: nodeCustomAgentId(node),
          riskLevel: node.riskLevel,
        });
        context.publishMessage({
          agentId,
          topic: "task.findings",
          correlationId: asText(bag.correlationId),
          summary: asText(bag.findings),
          payload: { findings: bag.findings },
        });
        bag.findingsMessageId = context.emitAgentMessage({
          fromAgentId: agentId,
          toAgentIds: [responderId],
          replyToId: typeof bag.routeMessageId === "string" ? bag.routeMessageId : undefined,
          threadId: asText(bag.correlationId),
          nodeId: node.id,
          planItemId: node.id,
          kind: "reply",
          status: "done",
          topic: "task.findings",
          correlationId: asText(bag.correlationId),
          content: agentMessageContent(`${mention(responderId)} findings are ready on task.findings:\n\n`, bag.findings),
        }).id;
        return bag.findings;
      }

      if (node.template === "respond") {
        const agentId = node.ownerAgentId ?? responderId;
        bag.response = await context.callAgent({
          agentId,
          planItemId: node.id,
          title: titleForNode(node, "Publish response"),
          prompt: promptTemplate(
            node,
            runtimeFallbackPrompt(modeSpec.family, node.template),
            bag,
          ),
          system: nodeSystemPrompt(context, modeSpec, node, bag),
          customAgentId: nodeCustomAgentId(node),
          riskLevel: node.riskLevel,
        });
        context.publishMessage({
          agentId,
          topic: "task.response",
          correlationId: asText(bag.correlationId),
          summary: asText(bag.response),
          payload: { response: bag.response },
        });
        context.emitAgentMessage({
          fromAgentId: agentId,
          toAgentIds: [routerId, researcherId],
          replyToId: typeof bag.findingsMessageId === "string" ? bag.findingsMessageId : undefined,
          threadId: asText(bag.correlationId),
          nodeId: node.id,
          planItemId: node.id,
          kind: "publish",
          status: "done",
          topic: "task.response",
          correlationId: asText(bag.correlationId),
          content: agentMessageContent(`Final response published on task.response for ${mention(routerId)} and ${mention(researcherId)}:\n\n`, bag.response),
        });
        return bag.response;
      }
    }, bag);
  }

  return {
    output: {
      text: asText(bag.response || bag.findings || bag.routingPlan || bag.publish),
      pattern: "message_bus",
      modeId: modeSpec.id,
      routingPlan: bag.routingPlan,
      findings: bag.findings,
      response: bag.response,
      correlationId: bag.correlationId,
    },
  };
}
