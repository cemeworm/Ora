import { ORA_ROOT_AGENT_ID, orderedEnabledModeLayers, type ModeNodeSpec } from "@cemeworm/shared";
import type { PatternExecutionResult } from "./execution-context.js";
import type { ModeExecutionInput } from "./mode-driver-registry.js";
import { asText, dispatchNodeTemplate, initializeQueueSummary, isInternalAgentMessageText, nodeCustomAgentId, nodeSystemPrompt, ownerForTemplate, promptTemplate, publicAgentMessageContent, runtimeFallbackPrompt, titleForNode } from "./driver-utils.js";
import { runModeLayer } from "./generic-node-executor.js";
import { containsCompleteProposedPlan, finishPlanModeAfterProposedPlan, type ExecutionBag, type AgentTeamsBag, COMPLEXITY_ASSESSMENT_INSTRUCTION, parseAgentTeamReviewVerdict, parseComplexityLevel } from "./mode-driver-helpers.js";

function nodeToolIds(node: ModeNodeSpec): string[] | undefined {
  const config = node.config as { toolIds?: unknown };
  return Array.isArray(config.toolIds)
    ? config.toolIds.filter((toolId): toolId is string => typeof toolId === "string")
    : undefined;
}

const MAX_REWORK_ROUNDS = 2;

function isChinese(context: ModeExecutionInput["context"]): boolean {
  return context.responseLanguage() === "zh";
}

export async function executeAgentTeams(input: ModeExecutionInput): Promise<PatternExecutionResult> {
  const { context, prompt, config, modeSpec } = input;
  const zh = isChinese(context);
  const layers = orderedEnabledModeLayers(modeSpec);
  const allNodes = layers.flat();
  const totalActiveNodes = allNodes.length;
  initializeQueueSummary(context, modeSpec.family, totalActiveNodes);
  const bag: AgentTeamsBag = { prompt };
  const leadId = ownerForTemplate(allNodes, "triage", ORA_ROOT_AGENT_ID);
  const builderId = ownerForTemplate(allNodes, "build", "builder");
  const reviewerId = ownerForTemplate(allNodes, "check", "reviewer");
  const handoffNodeId = allNodes.find((node) => node.template === "handoff")?.id;
  const buildNode = allNodes.find((node) => node.template === "build");
  const checkNode = allNodes.find((node) => node.template === "check");
  const planIntent = config.metadata.taskIntent === "plan";
  const enableDynamicSkip = modeSpec.runtimeAtoms.includes("dynamic_stage_skipping");
  const skipNodeIds = new Set<string>();
  let completedNodes = 0;
  let nodeIndex = 0;

  const runBuildPass = async (
    node: ModeNodeSpec,
    targetAgentId: string,
    options?: { reworkRound?: number; reviewerOutput?: string },
  ): Promise<string> => {
    const agentId = node.ownerAgentId ?? builderId;
    context.claimWorker(agentId);
    try {
      const basePrompt = promptTemplate(
        node,
        runtimeFallbackPrompt(modeSpec.family, node.template),
        bag,
      );
      const promptSuffix = options?.reworkRound
        ? `\n\nReviewer verdict to address:\n${options.reviewerOutput ?? asText(bag.check)}\n\nThis is rework round ${options.reworkRound}. Resolve every blocking issue before handing back the work.`
        : "";
      bag.build = await context.callAgent({
        agentId,
        planItemId: node.id,
        title: options?.reworkRound
          ? `${titleForNode(node, "Rework assigned work")} (Round ${options.reworkRound})`
          : titleForNode(node, "Build assigned work"),
        prompt: `${basePrompt}${promptSuffix}`,
        system: nodeSystemPrompt(context, modeSpec, node, bag),
        customAgentId: nodeCustomAgentId(node),
        riskLevel: node.riskLevel,
        toolIds: nodeToolIds(node),
      });
      bag.buildMessageId = context.emitAgentMessage({
        fromAgentId: agentId,
        toAgentIds: [targetAgentId],
        replyToId: typeof bag.checkMessageId === "string"
          ? bag.checkMessageId
          : typeof bag.triageMessageId === "string"
            ? bag.triageMessageId
            : undefined,
        threadId: "agent-teams:build",
        nodeId: node.id,
        planItemId: node.id,
        kind: "reply",
        status: "done",
        content: publicAgentMessageContent(
          options?.reworkRound
            ? zh
              ? `已完成第 ${options.reworkRound} 轮返工，交回 ${context.agentLabel(targetAgentId)} 复审。\n\n`
              : `Rework round ${options.reworkRound} is complete. Handing back to ${context.agentLabel(targetAgentId)} for review.\n\n`
            : zh
              ? `接下来交给 ${context.agentLabel(targetAgentId)}。\n\n`
              : `Handing off to ${context.agentLabel(targetAgentId)} next.\n\n`,
          bag.build,
          zh
            ? "实现阶段没有产出可公开展示的正文，已继续交接。"
            : "The implementation stage did not produce public-facing text, so the handoff continues.",
          zh ? "zh" : "en",
        ),
      }).id;
      context.remember({
        id: `${agentId}-memory`,
        namespace: ["worker", context.projectId, agentId],
        kind: "worker",
        value: {
          summary: bag.build,
          reworkRound: options?.reworkRound ?? 0,
        },
      });
      return bag.build;
    } finally {
      context.releaseWorker(agentId);
    }
  };

  const runCheckPass = async (
    node: ModeNodeSpec,
    targetAgentId: string,
    options?: { reworkRound?: number },
  ) => {
    const agentId = node.ownerAgentId ?? reviewerId;
    context.claimWorker(agentId);
    try {
      const basePrompt = promptTemplate(
        node,
        runtimeFallbackPrompt(modeSpec.family, node.template),
        bag,
      );
      const promptSuffix = options?.reworkRound
        ? `\n\nThis is re-review round ${options.reworkRound}. Decide whether the builder fully resolved the previous blocking issues.`
        : "";
      bag.check = await context.callAgent({
        agentId,
        planItemId: node.id,
        title: options?.reworkRound
          ? `${titleForNode(node, "Re-review assigned work")} (Round ${options.reworkRound})`
          : titleForNode(node, "Validate assigned work"),
        prompt: `${basePrompt}${promptSuffix}`,
        system: nodeSystemPrompt(context, modeSpec, node, bag),
        customAgentId: nodeCustomAgentId(node),
        riskLevel: node.riskLevel,
        toolIds: nodeToolIds(node),
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
          options?.reworkRound
            ? zh
              ? `第 ${options.reworkRound} 轮复审已完成，结果如下。\n\n`
              : `Re-review round ${options.reworkRound} is complete. Results below.\n\n`
            : zh
              ? `接下来交给 ${context.agentLabel(targetAgentId)}。\n\n`
              : `Handing off to ${context.agentLabel(targetAgentId)} next.\n\n`,
          bag.check,
          zh
            ? "复核阶段没有产出可公开展示的正文，已继续交接。"
            : "The review stage did not produce public-facing text, so the handoff continues.",
          zh ? "zh" : "en",
        ),
      }).id;
      const verdict = parseAgentTeamReviewVerdict(bag.check);
      bag.checkVerdict = verdict.verdict;
      bag.reviewIssues = verdict.issues;
      context.remember({
        id: `${agentId}-memory`,
        namespace: ["worker", context.projectId, agentId],
        kind: "worker",
        value: {
          summary: bag.check,
          verdict: verdict.verdict,
          issues: verdict.issues,
          reworkRound: options?.reworkRound ?? 0,
        },
      });
      return verdict;
    } finally {
      context.releaseWorker(agentId);
    }
  };

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
        toolIds: nodeToolIds(node),
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
            zh
              ? `接下来交给 ${context.agentLabel(targetAgentId)}。\n\n`
              : `Handing off to ${context.agentLabel(targetAgentId)} next.\n\n`,
            bag.triage,
            zh
              ? "前一阶段没有产出可公开展示的正文，已继续交接。"
              : "The previous stage did not produce public-facing text, so the handoff continues.",
            zh ? "zh" : "en",
          ),
        }).id;
      }
      return bag.triage;
    }

    if (node.template === "build") {
      const targetAgentId = nextOwnerId ?? reviewerId;
      await runBuildPass(node, targetAgentId);
      return bag.build;
    }

    if (node.template === "check") {
      const targetAgentId = nextOwnerId ?? leadId;
      let verdict = await runCheckPass(node, targetAgentId);
      if (verdict.verdict === "needs_fix" && buildNode && checkNode) {
        for (let reworkRound = 1; reworkRound <= MAX_REWORK_ROUNDS && verdict.verdict === "needs_fix"; reworkRound += 1) {
          bag.reworkCount = reworkRound;
          context.emitAgentMessage({
            fromAgentId: node.ownerAgentId ?? reviewerId,
            toAgentIds: [buildNode.ownerAgentId ?? builderId],
            replyToId: typeof bag.checkMessageId === "string" ? bag.checkMessageId : undefined,
            threadId: "agent-teams:build",
            nodeId: node.id,
            planItemId: node.id,
            kind: "status",
            status: "running",
            content: zh
              ? `验收要求返工，正在启动第 ${reworkRound} 轮修复。`
              : `Review requested changes. Starting rework round ${reworkRound}.`,
          });
          await runBuildPass(buildNode, checkNode.ownerAgentId ?? reviewerId, {
            reworkRound,
            reviewerOutput: bag.check,
          });
          verdict = await runCheckPass(checkNode, targetAgentId, { reworkRound });
        }
      }
      if (verdict.verdict !== "pass") {
        if (handoffNodeId) {
          skipNodeIds.add(handoffNodeId);
        }
        context.emitAgentMessage({
          fromAgentId: node.ownerAgentId ?? reviewerId,
          toAgentIds: handoffNodeId ? [leadId] : [],
          replyToId: typeof bag.checkMessageId === "string" ? bag.checkMessageId : undefined,
          threadId: "agent-teams:build",
          nodeId: node.id,
          planItemId: node.id,
          kind: "status",
          status: verdict.verdict === "blocked" ? "failed" : "done",
          content: publicAgentMessageContent(
            verdict.verdict === "needs_fix"
              ? zh
                ? `返工 ${bag.reworkCount ?? 0} 轮后仍未通过，已阻止最终交付。\n\n`
                : `The work still did not pass after ${bag.reworkCount ?? 0} rework rounds, so final delivery is blocked.\n\n`
              : zh
                ? "验收被阻塞，已阻止最终交付。\n\n"
                : "Review is blocked, so final delivery is blocked.\n\n",
            bag.check,
            zh
              ? "审查阶段未给出可公开展示的 verdict。"
              : "The review stage did not produce a public-facing verdict.",
            zh ? "zh" : "en",
          ),
        });
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
        toolIds: nodeToolIds(node),
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
          zh ? "最终交付已整理。\n\n" : "Final delivery has been prepared.\n\n",
          bag.handoff,
          zh
            ? "最终阶段没有产出可公开展示的正文。"
            : "The final stage did not produce public-facing text.",
          zh ? "zh" : "en",
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
      reviewVerdict: bag.checkVerdict,
      handoffBlocked: bag.checkVerdict !== undefined && bag.checkVerdict !== "pass",
      reworkCount: bag.reworkCount ?? 0,
      backlog: allNodes.map((node) => node.template),
      triage: bag.triage,
      workers: {
        builder: bag.build,
        reviewer: bag.check,
      },
    },
  };
}
