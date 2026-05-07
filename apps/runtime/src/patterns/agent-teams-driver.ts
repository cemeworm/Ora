import { orderedEnabledModeNodes } from "@cemeworm/shared";
import type { PatternExecutionResult } from "./execution-context.js";
import type { ModeExecutionInput } from "./mode-driver-registry.js";
import { asText, initializeQueueSummary, isInternalAgentMessageText, nodeCustomAgentId, nodeSystemPrompt, ownerForTemplate, promptTemplate, publicAgentMessageContent, runtimeFallbackPrompt, titleForNode } from "./driver-utils.js";
import { runGenericModeNode } from "./generic-node-executor.js";
import { containsCompleteProposedPlan, finishPlanModeAfterProposedPlan, type ExecutionBag, COMPLEXITY_ASSESSMENT_INSTRUCTION, parseComplexityLevel } from "./mode-driver-helpers.js";

export async function executeAgentTeams(input: ModeExecutionInput): Promise<PatternExecutionResult> {
  const { context, prompt, config, modeSpec } = input;
  const nodes = orderedEnabledModeNodes(modeSpec);
  const totalActiveNodes = nodes.length;
  initializeQueueSummary(context, modeSpec.family, totalActiveNodes);
  const bag: ExecutionBag = { prompt };
  const leadId = ownerForTemplate(nodes, "triage", "team_lead");
  const builderId = ownerForTemplate(nodes, "build", "builder");
  const reviewerId = ownerForTemplate(nodes, "check", "reviewer");
  const planIntent = config.metadata.taskIntent === "plan";
  const enableDynamicSkip = modeSpec.runtimeAtoms.includes("dynamic_stage_skipping");
  const skipNodeIds = new Set<string>();
  let completedNodes = 0;

  for (const [nodeIndex, node] of nodes.entries()) {
    const nextOwnerId = nodes[nodeIndex + 1]?.ownerAgentId;

    if (skipNodeIds.has(node.id)) {
      context.setPlanStatus(node.id, "skipped");
      context.checkpointNode({
        nodeId: node.id,
        nodeTemplate: node.template,
        nodeLabel: node.label,
        agentId: node.ownerAgentId ?? node.id,
        status: "skipped",
        bag,
      });
      completedNodes++;
      context.setQueueSummary({
        pending: Math.max(0, totalActiveNodes - completedNodes),
        inProgress: 0,
        completed: completedNodes,
      });
      continue;
    }

    completedNodes = await runGenericModeNode(context, modeSpec, node, totalActiveNodes, completedNodes, async () => {
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
    }, bag);
    if (planIntent && node.template === "triage") {
      if (containsCompleteProposedPlan(bag.triage) && !isInternalAgentMessageText(bag.triage)) {
        finishPlanModeAfterProposedPlan(context, nodes, nodeIndex, totalActiveNodes);
        return {
          output: {
            text: asText(bag.triage),
            pattern: "agent_teams",
            modeId: modeSpec.id,
            stoppedAfterProposedPlan: true,
            backlog: nodes.map((entry) => entry.template),
            triage: bag.triage,
            workers: {},
          },
        };
      }
      context.setPlanStatus(node.id, "blocked");
      finishPlanModeAfterProposedPlan(context, nodes, nodeIndex, totalActiveNodes);
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
      finishPlanModeAfterProposedPlan(context, nodes, nodeIndex, totalActiveNodes);
      return {
        output: {
          text: asText(bag.handoff || bag.check || bag.build || bag.triage),
          pattern: "agent_teams",
          modeId: modeSpec.id,
          stoppedAfterProposedPlan: true,
          backlog: nodes.map((entry) => entry.template),
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
      backlog: nodes.map((node) => node.template),
      triage: bag.triage,
      workers: {
        builder: bag.build,
        reviewer: bag.check,
      },
    },
  };
}
