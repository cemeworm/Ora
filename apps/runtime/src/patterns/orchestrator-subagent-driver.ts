import { ORA_ROOT_AGENT_ID, orderedEnabledModeLayers, orderedEnabledModeNodes, type ModeNodeSpec, type ModeSpec, type ModeStageSpec } from "@cemeworm/shared";
import type { PatternExecutionContext, PatternExecutionResult } from "./execution-context.js";
import type { ModeExecutionInput } from "./mode-driver-registry.js";
import { asText, dispatchNodeTemplate, initializeQueueSummary, interpolate, modeUsesSingleOwner, nodeCustomAgentId, nodeInstructions, nodeSystemPrompt, primaryOwnerAgentId, promptTemplate, runtimeFallbackPrompt, titleForNode } from "./driver-utils.js";
import { runGenericModeNode, runModeLayer } from "./generic-node-executor.js";
import { type ExecutionBag, type OrchestratorSubagentBag, DELEGATION_PLAN_INSTRUCTION, parseDelegationPlan, type DelegationPlan, writeBag } from "./mode-driver-helpers.js";

function stageTranscriptLine(entry: { speakerLabel: string; content: unknown }): string {
  return `${entry.speakerLabel}: ${asText(entry.content).trim()}`;
}

function stageValues(
  bag: ExecutionBag,
  stage: ModeStageSpec,
  speakerLabel: string,
  priorTranscript: string,
): ExecutionBag {
  return {
    ...bag,
    stage,
    stageId: stage.id,
    stageLabel: stage.label,
    stageInstruction: stage.instruction ?? "",
    speakerId: stage.speakerId ?? "",
    speakerLabel,
    stance: stage.stance ?? "neutral",
    priorTranscript,
  };
}

function fallbackStagePrompt(stage: ModeStageSpec): string {
  return [
    "Task:\n{{prompt}}",
    "Stage: {{stageLabel}}",
    "Speaker: {{speakerLabel}}",
    "Assigned stance: {{stance}}",
    "Stage instruction:\n{{stageInstruction}}",
    "Prior transcript:\n{{priorTranscript}}",
    "Write only this stage's contribution. Stay faithful to the assigned role and advance the workflow.",
  ].join("\n\n");
}

function shouldApplyStanceLock(stage: ModeStageSpec): boolean {
  return stage.adversarialStance === true && Boolean(stage.stance);
}

function stageSpeakerLabel(modeSpec: ModeSpec, node: ModeNodeSpec, stage: ModeStageSpec): string {
  const profile = stage.speakerId ? modeSpec.profiles.find((candidate) => candidate.id === stage.speakerId) : undefined;
  return stage.speakerLabel ?? profile?.label ?? node.title ?? node.label;
}

async function executePlainOrchestratorNode(
  context: PatternExecutionContext,
  modeSpec: ModeSpec,
  node: ModeNodeSpec,
  bag: ExecutionBag,
): Promise<unknown> {
  const agentId = node.ownerAgentId ?? primaryOwnerAgentId(modeSpec, [node]);
  return context.callAgent({
    agentId,
    planItemId: node.id,
    title: titleForNode(node, node.label),
    prompt: promptTemplate(
      node,
      runtimeFallbackPrompt(modeSpec.family, node.template),
      bag,
    ),
    system: nodeSystemPrompt(context, modeSpec, node, bag),
    customAgentId: nodeCustomAgentId(node),
    riskLevel: node.riskLevel,
  });
}

async function executeStagedTranscriptMode(input: ModeExecutionInput): Promise<PatternExecutionResult> {
  const { context, prompt, modeSpec } = input;
  const nodes = orderedEnabledModeNodes(modeSpec);
  const totalActiveNodes = nodes.length;
  initializeQueueSummary(context, modeSpec.family, totalActiveNodes);
  const stages = modeSpec.stages ?? [];
  const stagesByNode = new Map<string, ModeStageSpec[]>();
  for (const stage of stages) {
    const nodeStages = stagesByNode.get(stage.nodeId) ?? [];
    nodeStages.push(stage);
    stagesByNode.set(stage.nodeId, nodeStages);
  }
  const layout = modeSpec.transcriptLayout;
  const groupId = layout?.groupId ?? modeSpec.id;
  const groupLabel = layout?.groupLabel ?? modeSpec.label;
  const bag: ExecutionBag = { prompt };
  const stageOutputs: Array<{ speakerLabel: string; content: string }> = [];
  let completedNodes = 0;
  let previousStageMessageId: string | undefined;

  for (const node of nodes) {
    completedNodes = await runGenericModeNode(context, modeSpec, node, totalActiveNodes, completedNodes, async () => {
      const nodeStages = stagesByNode.get(node.id) ?? [];
      if (nodeStages.length === 0) {
        const result = await executePlainOrchestratorNode(context, modeSpec, node, bag);
        bag[node.id] = result;
        bag[node.template] = result;
        return result;
      }

      let lastStageOutput: unknown;
      for (const stage of nodeStages) {
        const priorTranscript = stageOutputs.map(stageTranscriptLine).join("\n\n") || "No prior staged transcript yet.";
        bag.priorTranscript = priorTranscript;
        bag.debateTranscript = stageOutputs.map(stageTranscriptLine).join("\n\n");
        const agentId = stage.speakerId ?? node.ownerAgentId ?? primaryOwnerAgentId(modeSpec, [node]);
        const speakerLabel = stageSpeakerLabel(modeSpec, node, stage);
        const values = stageValues(bag, stage, speakerLabel, priorTranscript);
        const systemParts = [nodeInstructions(modeSpec, node, values)];
        if (shouldApplyStanceLock(stage)) {
          systemParts.push(`STANCE LOCK: You are now ${speakerLabel}. Your mandatory stance is "${stage.stance}". Every claim you make must support the ${stage.stance} position or attack the opposing position. Neutral evaluation, both-sides framing, and undermining your own side are protocol violations.`);
        }
        const output = await context.callAgent({
          agentId,
          planItemId: node.id,
          title: node.template === "synthesize" ? titleForNode(node, stage.label) : `${speakerLabel} ${stage.label}`,
          prompt: interpolate(stage.promptTemplate ?? node.prompt ?? fallbackStagePrompt(stage), values),
          system: context.systemPrompt(systemParts.join("\n\n")),
          customAgentId: nodeCustomAgentId(node),
          riskLevel: node.riskLevel,
        });
        const message = context.emitAgentMessage({
          fromAgentId: agentId,
          toAgentIds: modeSpec.profiles.map((profile) => profile.id).filter((profileId) => profileId !== agentId),
          replyToId: previousStageMessageId,
          threadId: `${groupId}:${context.projectId}`,
          nodeId: node.id,
          planItemId: node.id,
          kind: "reply",
          status: "done",
          content: asText(output),
          transcript: {
            kind: "stage_transcript",
            groupId,
            groupLabel,
            stageId: stage.id,
            stageLabel: stage.label,
            sequence: stageOutputs.length,
            speakerLabel,
            speakerId: stage.speakerId,
            stance: stage.stance ?? "neutral",
            status: "done",
            layout,
          },
        });
        previousStageMessageId = message.id;
        lastStageOutput = output;
        stageOutputs.push({ speakerLabel, content: asText(output) });
        bag[stage.id] = output;
        bag[node.id] = output;
        bag[node.template] = output;
        bag.priorTranscript = stageOutputs.map(stageTranscriptLine).join("\n\n");
        bag.debateTranscript = bag.priorTranscript;
        if (stage.outputKey) {
          bag[stage.outputKey] = output;
        }
      }
      return lastStageOutput;
    }, bag);
  }

  context.remember({
    id: `mode-${modeSpec.id}-result`,
    namespace: ["session", context.projectId, modeSpec.id],
    kind: "session",
    value: { stages: stageOutputs, output: stageOutputs.at(-1)?.content, completedNodes },
  });

  const finalOutput = stageOutputs.at(-1)?.content ?? asText(bag.synthesis || bag.handoff || bag.review || bag.research || bag.plan);
  return {
    output: {
      text: finalOutput,
      pattern: modeSpec.family,
      modeId: modeSpec.id,
      stages: stageOutputs,
    },
  };
}

export async function executeOrchestratorSubagent(input: ModeExecutionInput): Promise<PatternExecutionResult> {
  const { context, prompt, modeSpec } = input;
  if (modeSpec.stages?.length) {
    return executeStagedTranscriptMode(input);
  }
  const layers = orderedEnabledModeLayers(modeSpec);
  const allNodes = layers.flat();
  const enableDynamicDelegation = modeSpec.runtimeAtoms.includes("dynamic_delegation");
  let delegationPlan: DelegationPlan | null = null;
  const skipNodeIds = new Set<string>();
  const singleOwnerMode = modeUsesSingleOwner(modeSpec, allNodes);
  const primaryAgentId = primaryOwnerAgentId(modeSpec, allNodes);
  const totalActiveNodes = allNodes.length;
  initializeQueueSummary(context, modeSpec.family, totalActiveNodes);
  const bag: ExecutionBag = { prompt, ...(context.modeResume?.bag ?? {}) };
  const resumedCompletedNodeIds = new Set(context.modeResume?.completedNodeIds ?? []);
  const resumedActiveNodeId = context.modeResume?.activeNodeId;
  if (enableDynamicDelegation && typeof bag.plan === "string") {
    delegationPlan = parseDelegationPlan(bag.plan);
    if (delegationPlan) {
      if (!delegationPlan.researchEnabled) skipNodeIds.add("research");
      if (!delegationPlan.reviewEnabled) skipNodeIds.add("review");
      bag.researchFocus = delegationPlan.researchFocus;
      bag.reviewFocus = delegationPlan.reviewFocus;
    }
  }
  let completedNodes = 0;

  const resumeOrCallAgent = async (
    node: ModeNodeSpec,
    params: Parameters<typeof context.callAgent>[0],
  ): Promise<string> => {
    const resumed = await context.resumeSuspendedNode?.({
      nodeId: node.id,
      agentId: params.agentId,
      title: params.title,
    });
    if (resumed !== undefined) {
      return asText(resumed);
    }
    return context.callAgent(params);
  };

  const executeNode = async (node: ModeNodeSpec): Promise<unknown> => {
    if (node.template === "decompose") {
          let decomposePrompt = promptTemplate(
            node,
            runtimeFallbackPrompt(modeSpec.family, node.template),
            bag,
          );
          if (enableDynamicDelegation) {
            decomposePrompt += DELEGATION_PLAN_INSTRUCTION;
          }
          const planOutput = await resumeOrCallAgent(node, {
          agentId: node.ownerAgentId ?? ORA_ROOT_AGENT_ID,
          planItemId: node.id,
          title: titleForNode(node, "Decompose work"),
          prompt: decomposePrompt,
          system: nodeSystemPrompt(context, modeSpec, node, bag),
          customAgentId: nodeCustomAgentId(node),
          riskLevel: node.riskLevel,
          });
          writeBag(bag, "plan", planOutput, node.template);
          if (enableDynamicDelegation) {
            delegationPlan = parseDelegationPlan(planOutput);
            if (delegationPlan) {
              if (!delegationPlan.researchEnabled) skipNodeIds.add("research");
              if (!delegationPlan.reviewEnabled) skipNodeIds.add("review");
              bag.researchFocus = delegationPlan.researchFocus;
              bag.reviewFocus = delegationPlan.reviewFocus;
            }
          }
          return planOutput;
        }

      if (node.template === "research") {
        let system = nodeSystemPrompt(context, modeSpec, node, bag);
        if (bag.researchFocus) {
          system += `\n\n<orchestrator_focus>The orchestrator asks you to focus on: ${bag.researchFocus}</orchestrator_focus>`;
        }
        bag.research = await resumeOrCallAgent(node, {
          agentId: node.ownerAgentId ?? "researcher",
          planItemId: node.id,
          title: titleForNode(node, "Research context"),
          prompt: promptTemplate(
            node,
            runtimeFallbackPrompt(modeSpec.family, node.template),
            bag,
          ),
          system,
          customAgentId: nodeCustomAgentId(node),
          riskLevel: node.riskLevel,
          });
          return bag.research;
        }

      if (node.template === "review") {
        let system = nodeSystemPrompt(context, modeSpec, node, bag);
        if (bag.reviewFocus) {
          system += `\n\n<orchestrator_focus>The orchestrator asks you to focus on: ${bag.reviewFocus}</orchestrator_focus>`;
        }
        bag.review = await resumeOrCallAgent(node, {
          agentId: node.ownerAgentId ?? "reviewer",
          planItemId: node.id,
          title: titleForNode(node, "Review risks"),
          prompt: promptTemplate(
            node,
            runtimeFallbackPrompt(modeSpec.family, node.template),
            bag,
          ),
          system,
          customAgentId: nodeCustomAgentId(node),
          riskLevel: node.riskLevel,
          });
          return bag.review;
        }

      if (node.template === "synthesize") {
        const directSoloResponse = singleOwnerMode
          && bag.plan === undefined
          && bag.research === undefined
          && bag.review === undefined;
        const allSubagentsSkipped = delegationPlan
          && !delegationPlan.researchEnabled
          && !delegationPlan.reviewEnabled;
        const synthesizePrompt = promptTemplate(
          node,
          directSoloResponse
            ? "Task: {{prompt}}\nProduce the final answer directly. Do not create a separate planning draft unless the task genuinely requires it."
            : allSubagentsSkipped
              ? "Task: {{prompt}}\n{{plan}}\nThe orchestrator determined no subagents were needed for this task. Produce the final answer directly."
              : runtimeFallbackPrompt(modeSpec.family, node.template),
          bag,
        );
        bag.synthesis = await resumeOrCallAgent(node, {
          agentId: node.ownerAgentId ?? ORA_ROOT_AGENT_ID,
          planItemId: node.id,
          title: titleForNode(node, "Synthesize result"),
          prompt: synthesizePrompt,
          system: nodeSystemPrompt(context, modeSpec, node, bag),
          customAgentId: nodeCustomAgentId(node),
          riskLevel: node.riskLevel,
          });
          return bag.synthesis;
        }
        // Custom template fallback
        const fallbackAgentId = node.ownerAgentId ?? primaryAgentId;
        const fallbackTitle = titleForNode(node, node.label);
        const resumed = await context.resumeSuspendedNode?.({
          nodeId: node.id,
          agentId: fallbackAgentId,
          title: fallbackTitle,
        });
        if (resumed !== undefined) {
          bag[node.template] = resumed;
          return resumed;
        }
        return dispatchNodeTemplate(context, modeSpec, node, bag, {
          bagKey: node.template,
          agentId: fallbackAgentId,
          title: fallbackTitle,
          fallbackPrompt: runtimeFallbackPrompt(modeSpec.family, node.template),
        });
    };

    for (const layer of layers) {
      completedNodes = await runModeLayer(
        context, modeSpec, layer, totalActiveNodes, completedNodes,
        executeNode, bag,
        { skipNodeIds, alreadyCompletedNodeIds: resumedCompletedNodeIds, activeResumeNodeId: resumedActiveNodeId },
      );
    }

  context.remember({
    id: `mode-${modeSpec.id}-result`,
    namespace: ["session", context.projectId, modeSpec.id],
    kind: "session",
    value: { plan: bag.plan, research: bag.research, review: bag.review, synthesis: bag.synthesis },
  });

  if (singleOwnerMode) {
    return {
      output: {
        text: asText(bag.synthesis || bag.plan),
        pattern: modeSpec.family,
        modeId: modeSpec.id,
        agent: {
          id: primaryAgentId,
          plan: bag.plan,
          response: bag.synthesis,
        },
      },
    };
  }

  return {
    output: {
      text: asText(bag.synthesis || bag.review || bag.research || bag.plan),
      pattern: modeSpec.family,
      modeId: modeSpec.id,
      orchestrator: {
        decomposition: allNodes.map((node) => node.template),
        plan: bag.plan,
      },
      subagents: {
        researcher: bag.research,
        reviewer: bag.review,
      },
    },
  };
}
