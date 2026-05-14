import { ORA_ROOT_AGENT_ID, orderedEnabledModeLayers, type ModeNodeSpec } from "@cemeworm/shared";
import type { PatternExecutionResult } from "./execution-context.js";
import type { ModeExecutionInput } from "./mode-driver-registry.js";
import { asText, dispatchNodeTemplate, initializeQueueSummary, isInternalAgentMessageText, nodeCustomAgentId, nodeSystemPrompt, ownerForTemplate, promptTemplate, publicAgentMessageContent, runtimeFallbackPrompt, titleForNode } from "./driver-utils.js";
import { runModeLayer } from "./generic-node-executor.js";
import { containsCompleteProposedPlan, finishPlanModeAfterProposedPlan, type ExecutionBag, type AgentTeamsBag, COMPLEXITY_ASSESSMENT_INSTRUCTION, parseComplexityLevel } from "./mode-driver-helpers.js";

export async function executeAgentTeams(input: ModeExecutionInput): Promise<PatternExecutionResult> {
  const { context, prompt, config, modeSpec } = input;
  const layers = orderedEnabledModeLayers(modeSpec);
  const allNodes = layers.flat();
  const totalActiveNodes = allNodes.length;
  initializeQueueSummary(context, modeSpec.family, totalActiveNodes);
  const bag: AgentTeamsBag = { prompt };
  const leadId = ownerForTemplate(allNodes, "triage", ORA_ROOT_AGENT_ID);
  const builderId = ownerForTemplate(allNodes, "build", "builder");
  const reviewerId = ownerForTemplate(allNodes, "check", "reviewer");
  const planIntent = config.metadata.taskIntent === "plan";
  const enableDynamicSkip = modeSpec.runtimeAtoms.includes("dynamic_stage_skipping");
  const skipNodeIds = new Set<string>();
  let completedNodes = 0;
  let nodeIndex = 0;

  const executeNode = async (node: ModeNodeSpec): Promise<unknown> => {
    const currentIndex = nodeIndex++;
    const nextOwnerId = allNodes[currentIndex + 1]?.ownerAgentId;

    if (node.template === "triage") {
      const agentId = node.ownerAgentId ?? leadId;
      const targetAgentId = nextOwnerId ?? builderId;
      let triagePrompt = promptTemplate(
        node,
        runtimeFallbackPrompt(modeSpec.family, node.template),
        bag,
      );
      if (enableDynamicSkip) {
        triagePrompt += COMPLEXITY_ASSESSMENT_INSTRUCTION;
      }
      bag.triage = await context.callAgent({
        agentId,
        planItemId: node.id,
        title: titleForNode(node, "Triage backlog"),
        prompt: triagePrompt,
        system: nodeSystemPrompt(context, modeSpec, node, bag),
        customAgentId: nodeCustomAgentId(node),
        riskLevel: node.riskLevel,
      });
      if (enableDynamicSkip) {
        const level = parseComplexityLevel(bag.triage);
        if (level && modeSpec.complexitySkipRules?.[level]) {
          for (const nodeId of modeSpec.complexitySkipRules[level]) {
            skipNodeIds.add(nodeId);
          }
        }
      }
      if (!planIntent) {
        bag.triageMessageId = context.emitAgentMessage({
          fromAgentId: agentId,
          toAgentIds: [targetAgentId],
          threadId: "agent-teams:build",
          nodeId: node.id,
          planItemId: node.id,
          kind: "mention",
          status: "done",
          content: publicAgentMessageContent(
            `接下来交给 ${context.agentLabel(targetAgentId)}。\n\n`,
            bag.triage,
            "前一阶段没有产出可公开展示的正文，已继续交接。",
          ),
        }).id;
      }
      return bag.triage;
    }

    if (node.template === "build") {
      const agentId = node.ownerAgentId ?? "builder";
      const targetAgentId = nextOwnerId ?? reviewerId;
      context.claimWorker(agentId);
      try {
        bag.build = await context.callAgent({
          agentId,
          planItemId: node.id,
          title: titleForNode(node, "Build assigned work"),
          prompt: promptTemplate(
            node,
            runtimeFallbackPrompt(modeSpec.family, node.template),
            bag,
          ),
          system: nodeSystemPrompt(context, modeSpec, node, bag),
          customAgentId: nodeCustomAgentId(node),
          riskLevel: node.riskLevel,
        });
        bag.buildMessageId = context.emitAgentMessage({
          fromAgentId: agentId,
          toAgentIds: [targetAgentId],
          replyToId: typeof bag.triageMessageId === "string" ? bag.triageMessageId : undefined,
          threadId: "agent-teams:build",
          nodeId: node.id,
          planItemId: node.id,
          kind: "reply",
          status: "done",
          content: publicAgentMessageContent(
            `接下来交给 ${context.agentLabel(targetAgentId)}。\n\n`,
            bag.build,
            "实现阶段没有产出可公开展示的正文，已继续交接。",
          ),
        }).id;
        context.remember({
          id: `${agentId}-memory`,
          namespace: ["worker", context.projectId, agentId],
          kind: "worker",
          value: { summary: bag.build },
        });
      } finally {
        context.releaseWorker(agentId);
      }
      return bag.build;
    }

    if (node.template === "check") {
      const agentId = node.ownerAgentId ?? reviewerId;
      const targetAgentId = nextOwnerId ?? leadId;
      context.claimWorker(agentId);
      try {
        bag.check = await context.callAgent({
          agentId,
          planItemId: node.id,
          title: titleForNode(node, "Validate assigned work"),
          prompt: promptTemplate(
            node,
            runtimeFallbackPrompt(modeSpec.family, node.template),
            bag,
          ),
          system: nodeSystemPrompt(context, modeSpec, node, bag),
          customAgentId: nodeCustomAgentId(node),
          riskLevel: node.riskLevel,
        });
        bag.checkMessageId = context.emitAgentMessage({
          fromAgentId: agentId,
          toAgentIds: [targetAgentId],
          replyToId: typeof bag.checkMessageId === "string"
            ? bag.checkMessageId
            : typeof bag.buildMessageId === "string"
              ? bag.buildMessageId
              : undefined,
          threadId: "agent-teams:build",
          nodeId: node.id,
          planItemId: node.id,
          kind: "reply",
          status: "done",
          content: publicAgentMessageContent(
            `接下来交给 ${context.agentLabel(targetAgentId)}。\n\n`,
            bag.check,
            "复核阶段没有产出可公开展示的正文，已继续交接。",
          ),
        }).id;
        context.remember({
          id: `${agentId}-memory`,
          namespace: ["worker", context.projectId, agentId],
          kind: "worker",
          value: { summary: bag.check },
        });
      } finally {
        context.releaseWorker(agentId);
      }
      return bag.check;
    }

    if (node.template === "handoff") {
      const agentId = node.ownerAgentId ?? leadId;
      bag.handoff = await context.callAgent({
        agentId,
        planItemId: node.id,
        title: titleForNode(node, "Record handoff"),
        prompt: promptTemplate(
          node,
          runtimeFallbackPrompt(modeSpec.family, node.template),
          bag,
        ),
        system: nodeSystemPrompt(context, modeSpec, node, bag),
        customAgentId: nodeCustomAgentId(node),
        riskLevel: node.riskLevel,
      });
      context.emitAgentMessage({
        fromAgentId: agentId,
        toAgentIds: [],
        replyToId: typeof bag.checkMessageId === "string" ? bag.checkMessageId : undefined,
        threadId: "agent-teams:build",
        nodeId: node.id,
        planItemId: node.id,
        kind: "handoff",
        status: "done",
        content: publicAgentMessageContent(
          "最终交付已整理。\n\n",
          bag.handoff,
          "最终阶段没有产出可公开展示的正文。",
        ),
      });
      return bag.handoff;
    }
    return dispatchNodeTemplate(context, modeSpec, node, bag, {
      bagKey: node.template,
      agentId: node.ownerAgentId ?? leadId,
      title: titleForNode(node, node.label),
      fallbackPrompt: runtimeFallbackPrompt(modeSpec.family, node.template),
    });
  };

  for (const layer of layers) {
    completedNodes = await runModeLayer(
      context, modeSpec, layer, totalActiveNodes, completedNodes,
      executeNode, bag,
      { skipNodeIds },
    );

    // Plan-intent early-exit checks after each layer completes
    const firstNode = layer[0];
    if (firstNode && planIntent && firstNode.template === "triage") {
      if (containsCompleteProposedPlan(bag.triage) && !isInternalAgentMessageText(bag.triage)) {
        finishPlanModeAfterProposedPlan(context, allNodes, nodeIndex - 1, totalActiveNodes);
        return {
          output: {
            text: asText(bag.triage),
            pattern: "agent_teams",
            modeId: modeSpec.id,
            stoppedAfterProposedPlan: true,
            backlog: allNodes.map((entry) => entry.template),
            triage: bag.triage,
            workers: {},
          },
        };
      }
      context.setPlanStatus(firstNode.id, "failed");
      finishPlanModeAfterProposedPlan(context, allNodes, nodeIndex - 1, totalActiveNodes);
      return {
        output: {
          text: "Plan mode stopped before implementation because triage did not produce a complete proposed plan.",
          pattern: "agent_teams",
          modeId: modeSpec.id,
          stoppedAfterInvalidPlan: true,
          invalidPlanReason: isInternalAgentMessageText(bag.triage)
            ? "invalid_or_internal_triage_output"
            : "missing_proposed_plan",
          triage: bag.triage,
          workers: {},
        },
      };
    }
    if (planIntent && containsCompleteProposedPlan(bag.handoff || bag.check || bag.build || bag.triage)) {
      finishPlanModeAfterProposedPlan(context, allNodes, nodeIndex - 1, totalActiveNodes);
      return {
        output: {
          text: asText(bag.handoff || bag.check || bag.build || bag.triage),
          pattern: "agent_teams",
          modeId: modeSpec.id,
          stoppedAfterProposedPlan: true,
          backlog: allNodes.map((entry) => entry.template),
          triage: bag.triage,
          workers: {
            builder: bag.build,
            reviewer: bag.check,
          },
        },
      };
    }
  }

  return {
    output: {
      text: asText(bag.handoff || bag.check || bag.build || bag.triage),
      pattern: "agent_teams",
      modeId: modeSpec.id,
      backlog: allNodes.map((node) => node.template),
      triage: bag.triage,
      workers: {
        builder: bag.build,
        reviewer: bag.check,
      },
    },
  };
}
