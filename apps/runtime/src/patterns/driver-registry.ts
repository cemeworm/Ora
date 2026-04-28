import {
  createModeSpecFromPattern,
  DEBATE_MODE_ID,
  type RunConfig,
  modeSpecToPatternDefinition,
  orderedEnabledModeNodes,
  type CoordinationPattern,
  type ModeNodeSpec,
  type ModeSpec,
  type PatternDefinition,
} from "@ora/shared";
import { assessGeneratorVerifierResponse } from "./generator-verifier-utils.js";
import type { PatternDriver, PatternExecutionContext, PatternExecutionResult } from "./execution-context.js";
import {
  agentMessageContent,
  asText,
  correlationId,
  initializeQueueSummary,
  mention,
  modeUsesSingleOwner,
  nodeAtomIds,
  nodeCustomAgentId,
  nodeSystemPrompt,
  ownerForTemplate,
  primaryOwnerAgentId,
  promptTemplate,
  runtimeFallbackPrompt,
  titleForNode,
} from "./driver-utils.js";

interface ModeExecutionInput {
  context: PatternExecutionContext;
  prompt: string;
  config: RunConfig;
  modeSpec: ModeSpec;
  definition: PatternDefinition;
}

type ExecutionBag = Record<string, unknown>;

async function runNode(
  context: PatternExecutionContext,
  modeSpec: ModeSpec,
  node: ModeNodeSpec,
  totalActiveNodes: number,
  completedNodes: number,
  execute: () => Promise<unknown>,
): Promise<number> {
  const clarificationQuestion = typeof node.config?.clarificationQuestion === "string"
    ? node.config.clarificationQuestion
    : undefined;
  if (modeSpec.runtimeAtoms.includes("clarification_interrupt") && clarificationQuestion) {
    try {
      await context.ensureClarification({
        id: `clarification:${node.id}`,
        key: typeof node.config?.clarificationKey === "string" ? node.config.clarificationKey : node.id,
        nodeId: node.id,
        nodeLabel: node.label,
        question: clarificationQuestion,
      });
    } catch (error) {
      context.setPlanStatus(node.id, "blocked");
      context.setQueueSummary({
        pending: Math.max(0, totalActiveNodes - completedNodes),
        inProgress: 0,
        completed: completedNodes,
      });
      throw error;
    }
  }
  context.setPlanStatus(node.id, "running");
  context.setQueueSummary({
    pending: Math.max(0, totalActiveNodes - completedNodes - 1),
    inProgress: 1,
    completed: completedNodes,
  });
  const recovered = await context.runRecoverableNode({
    nodeId: node.id,
    nodeTemplate: node.template,
    nodeLabel: node.label,
    agentId: node.ownerAgentId ?? node.id,
  }, () => (
    nodeAtomIds(node).has("subagent_delegate")
      ? context.runDelegatedTask({
          taskId: `task:${node.id}`,
          nodeId: node.id,
          nodeLabel: node.label,
          agentId: node.ownerAgentId ?? node.id,
          title: titleForNode(node, node.label),
        }, execute)
      : execute()
  ));
  const result = recovered.output;
  const nextCompleted = completedNodes + 1;
  if (recovered.status === "skipped") {
    context.setPlanStatus(node.id, "skipped");
    context.setQueueSummary({
      pending: Math.max(0, totalActiveNodes - nextCompleted),
      inProgress: 0,
      completed: nextCompleted,
    });
    return nextCompleted;
  }
  if (modeSpec.runtimeAtoms.includes("memory_capture") && result !== undefined) {
    context.captureMemory({
      id: `atom-memory-${node.id}-${completedNodes + 1}`,
      namespace: ["session", context.projectId, modeSpec.family, "memory_capture"],
      kind: "session",
      value: {
        nodeId: node.id,
        nodeLabel: node.label,
        output: result,
      },
    });
  }
  if (nodeAtomIds(node).has("artifact_publish") && result !== undefined) {
    context.publishArtifact({
      id: `${node.id}-artifact-${completedNodes + 1}`,
      label: `${node.label} artifact`,
      kind: "log",
      mimeType: "application/json",
      payload: {
        nodeId: node.id,
        nodeLabel: node.label,
        output: result,
      },
    });
  }
  context.setPlanStatus(node.id, "done");
  context.setQueueSummary({
    pending: Math.max(0, totalActiveNodes - nextCompleted),
    inProgress: 0,
    completed: nextCompleted,
  });
  return nextCompleted;
}

async function executeGeneratorVerifier(input: ModeExecutionInput): Promise<PatternExecutionResult> {
  const { context, prompt, config, modeSpec } = input;
  const nodes = orderedEnabledModeNodes(modeSpec);
  const totalActiveNodes = nodes.length;
  initializeQueueSummary(context, modeSpec.family, totalActiveNodes);
  const maxIterations = modeSpec.stopPolicy.maxIterations ?? 3;
  const bag: ExecutionBag = {
    prompt,
    rubric: [
      "addresses the user request",
      "uses explicit verification criteria",
      "stays bounded and inspectable",
    ],
    retryCount: 0,
    verdict: "fail",
  };
  const metadataProviderId = typeof config.metadata.providerId === "string" ? config.metadata.providerId : undefined;
  const selectedProviderId = config.providerConfig?.id ?? config.providerId ?? metadataProviderId ?? "local-smoke";
  const generatorId = ownerForTemplate(nodes, "draft", "generator");
  const verifierId = ownerForTemplate(nodes, "verify", "verifier");

  for (let attempt = 1; attempt <= maxIterations; attempt += 1) {
    bag.retryCount = attempt;
    let completedNodes = 0;
    for (const node of nodes) {
      completedNodes = await runNode(context, modeSpec, node, totalActiveNodes, completedNodes, async () => {
        if (node.template === "draft") {
          const currentGeneratorId = node.ownerAgentId ?? generatorId;
          const candidate = await context.callAgent({
            agentId: currentGeneratorId,
            planItemId: node.id,
            title: titleForNode(node, `Draft attempt ${attempt}`),
            prompt: promptTemplate(
              node,
              runtimeFallbackPrompt(modeSpec.family, node.template),
              { ...bag, attempt },
            ),
            system: nodeSystemPrompt(context, modeSpec, node, { ...bag, attempt }),
            customAgentId: nodeCustomAgentId(node),
            riskLevel: node.riskLevel,
          });
          bag.candidate = candidate;
          bag.candidateMessageId = context.emitAgentMessage({
            fromAgentId: currentGeneratorId,
            toAgentIds: [verifierId],
            threadId: `generator-verifier:${attempt}`,
            nodeId: node.id,
            planItemId: node.id,
            kind: "mention",
            status: "done",
            content: agentMessageContent(`${mention(verifierId)} please verify draft attempt ${attempt}:\n\n`, candidate),
          }).id;
          return candidate;
        }

        if (node.template === "verify") {
          const currentVerifierId = node.ownerAgentId ?? verifierId;
          const verifierNotes = await context.callAgent({
            agentId: currentVerifierId,
            planItemId: node.id,
            title: titleForNode(node, `Verify attempt ${attempt}`),
            prompt: promptTemplate(
              node,
              runtimeFallbackPrompt(modeSpec.family, node.template),
              {
                ...bag,
                rubric: (bag.rubric as string[]).join("\n- "),
                attempt,
              },
            ),
            system: nodeSystemPrompt(context, modeSpec, node, {
              ...bag,
              rubric: (bag.rubric as string[]).join("\n- "),
              attempt,
            }),
            customAgentId: nodeCustomAgentId(node),
            riskLevel: node.riskLevel,
          });
          bag.verifierNotes = verifierNotes;
          const assessment = assessGeneratorVerifierResponse({
            candidate: asText(bag.candidate),
            verifierResponse: verifierNotes,
            providerId: selectedProviderId,
          });
          bag.verifierAssessment = assessment;
          bag.verdict = assessment.verdict;
          context.emitAgentMessage({
            fromAgentId: currentVerifierId,
            toAgentIds: [generatorId],
            replyToId: typeof bag.candidateMessageId === "string" ? bag.candidateMessageId : undefined,
            threadId: `generator-verifier:${attempt}`,
            nodeId: node.id,
            planItemId: node.id,
            kind: "reply",
            status: assessment.verdict === "pass" ? "done" : "failed",
            content: agentMessageContent(`${mention(generatorId)} verification ${assessment.verdict}:\n\n`, assessment.rationale || verifierNotes),
          });
          context.remember({
            id: `generator-verifier-${attempt}`,
            namespace: ["session", context.projectId, "generator_verifier"],
            kind: "session",
            value: {
              attempt,
              candidate: bag.candidate,
              verifierNotes,
              verdict: assessment.verdict,
              rationale: assessment.rationale,
              missingRequirements: assessment.missingRequirements,
              rubric: bag.rubric,
            },
          });
          return verifierNotes;
        }
      });
    }

    if (bag.verdict === "pass") {
      break;
    }
  }

  return {
    output: {
      text: asText(bag.candidate),
      pattern: "generator_verifier",
      modeId: modeSpec.id,
      generator: {
        candidate: bag.candidate,
        attempts: bag.retryCount,
      },
      verifier: {
        verdict: bag.verdict,
        notes: bag.verifierNotes,
        rationale: (bag.verifierAssessment as Record<string, unknown> | undefined)?.rationale,
        missingRequirements: (bag.verifierAssessment as Record<string, unknown> | undefined)?.missingRequirements,
        rubric: bag.rubric,
        exhausted: bag.verdict !== "pass",
        failureKind: bag.verdict !== "pass" ? "verification_failed" : undefined,
      },
    },
  };
}

const DEBATE_GROUP_ID = "debate";
const DEBATE_GROUP_LABEL = "结构化辩论";
const DEBATE_TURNS = [
  { stageId: "affirmative-lead-opening", stageLabel: "开篇立论", speakerLabel: "正方主辩", stance: "affirmative" as const, instruction: "Open for the affirmative. Define the proposition favorably, make the strongest affirmative case, and set the burden of proof for the negative side." },
  { stageId: "negative-lead-opening", stageLabel: "开篇立论", speakerLabel: "反方主辩", stance: "negative" as const, instruction: "Open for the negative. Attack the affirmative framing, present the strongest opposing case, and identify what the affirmative has not proven." },
  { stageId: "affirmative-deputy-one", stageLabel: "第一副辩", speakerLabel: "正方第一副辩", stance: "affirmative" as const, instruction: "Rebut the negative opening. Strengthen the affirmative evidence and expose contradictions or overreach in the negative case." },
  { stageId: "negative-deputy-one", stageLabel: "第一副辩", speakerLabel: "反方第一副辩", stance: "negative" as const, instruction: "Rebut the affirmative deputy. Press weak assumptions, missing evidence, and unresolved burden-of-proof gaps." },
  { stageId: "affirmative-deputy-two", stageLabel: "第二副辩", speakerLabel: "正方第二副辩", stance: "affirmative" as const, instruction: "Advance the affirmative response. Address the strongest negative attacks and sharpen the affirmative comparative advantage." },
  { stageId: "negative-deputy-two", stageLabel: "第二副辩", speakerLabel: "反方第二副辩", stance: "negative" as const, instruction: "Advance the negative response. Answer the latest affirmative claims and show why the negative position remains more defensible." },
  { stageId: "affirmative-lead-final", stageLabel: "总结陈词", speakerLabel: "正方主辩", stance: "affirmative" as const, instruction: "Give the affirmative final statement. Weigh the debate, answer the decisive negative objections, and close without introducing unsupported new facts." },
  { stageId: "negative-lead-final", stageLabel: "总结陈词", speakerLabel: "反方主辩", stance: "negative" as const, instruction: "Give the negative final statement. Weigh the debate, answer the affirmative closing line, and close without introducing unsupported new facts." },
];

function debateTranscriptLine(entry: { speakerLabel: string; content: unknown }): string {
  return `${entry.speakerLabel}: ${asText(entry.content).trim()}`;
}

async function executeDebateMode(input: ModeExecutionInput): Promise<PatternExecutionResult> {
  const { context, prompt, modeSpec } = input;
  const nodes = orderedEnabledModeNodes(modeSpec);
  const totalActiveNodes = nodes.length;
  initializeQueueSummary(context, modeSpec.family, totalActiveNodes);
  const frameNode = nodes.find((node) => node.id === "frame") ?? nodes.find((node) => node.template === "decompose") ?? nodes[0];
  const debateNode = nodes.find((node) => node.id === "debate") ?? nodes.find((node) => node.template === "research") ?? frameNode;
  const synthesisNode = nodes.find((node) => node.id === "synthesis") ?? nodes.find((node) => node.template === "synthesize") ?? nodes.at(-1) ?? debateNode;
  const moderatorId = frameNode.ownerAgentId ?? "moderator";
  const debateAgentId = debateNode.ownerAgentId ?? "debate_agent";
  const bag: ExecutionBag = { prompt };
  const speeches: Array<{ speakerLabel: string; content: string }> = [];
  let completedNodes = 0;
  let previousSpeechMessageId: string | undefined;

  completedNodes = await runNode(context, modeSpec, frameNode, totalActiveNodes, completedNodes, async () => {
    bag.framing = await context.callAgent({
      agentId: moderatorId,
      planItemId: frameNode.id,
      title: titleForNode(frameNode, "Debate framing"),
      prompt: promptTemplate(
        frameNode,
        "Proposition or user request:\n{{prompt}}\n\nFrame the structured debate and dispatch the speaking order.",
        bag,
      ),
      system: nodeSystemPrompt(context, modeSpec, frameNode, bag),
      customAgentId: nodeCustomAgentId(frameNode),
      riskLevel: frameNode.riskLevel,
    });
    return bag.framing;
  });

  completedNodes = await runNode(context, modeSpec, debateNode, totalActiveNodes, completedNodes, async () => {
    for (const [index, turn] of DEBATE_TURNS.entries()) {
      const priorTranscript = speeches.map(debateTranscriptLine).join("\n\n") || "No prior debate speeches yet.";
      const speech = await context.callAgent({
        agentId: debateAgentId,
        planItemId: debateNode.id,
        title: `${turn.speakerLabel} ${turn.stageLabel}`,
        prompt: [
          `Proposition or user request:\n${prompt}`,
          `Moderator framing:\n${asText(bag.framing)}`,
          `Current virtual speaker: ${turn.speakerLabel}`,
          `Assigned stance: ${turn.stance}`,
          `Turn instruction: ${turn.instruction}`,
          `Prior debate transcript:\n${priorTranscript}`,
          "Write only this speaker's speech. Keep the stance firm, responsive, and intellectually honest.",
        ].join("\n\n"),
        system: nodeSystemPrompt(context, modeSpec, debateNode, { ...bag, priorTranscript, speakerLabel: turn.speakerLabel }),
        customAgentId: nodeCustomAgentId(debateNode),
        riskLevel: debateNode.riskLevel,
      });
      const message = context.emitAgentMessage({
        fromAgentId: debateAgentId,
        toAgentIds: [moderatorId],
        replyToId: previousSpeechMessageId,
        threadId: `${DEBATE_GROUP_ID}:${context.projectId}`,
        nodeId: debateNode.id,
        planItemId: debateNode.id,
        kind: "reply",
        status: "done",
        content: speech,
        transcript: {
          kind: "stage_transcript",
          groupId: DEBATE_GROUP_ID,
          groupLabel: DEBATE_GROUP_LABEL,
          stageId: turn.stageId,
          stageLabel: turn.stageLabel,
          sequence: index,
          speakerLabel: turn.speakerLabel,
          speakerId: turn.stageId,
          stance: turn.stance,
          status: "done",
        },
      });
      previousSpeechMessageId = message.id;
      speeches.push({ speakerLabel: turn.speakerLabel, content: speech });
    }
    bag.debateTranscript = speeches.map(debateTranscriptLine).join("\n\n");
    return bag.debateTranscript;
  });

  completedNodes = await runNode(context, modeSpec, synthesisNode, totalActiveNodes, completedNodes, async () => {
    bag.synthesis = await context.callAgent({
      agentId: moderatorId,
      planItemId: synthesisNode.id,
      title: titleForNode(synthesisNode, "Moderator synthesis"),
      prompt: promptTemplate(
        synthesisNode,
        "Proposition or user request:\n{{prompt}}\n\nModerator framing:\n{{framing}}\n\nDebate transcript:\n{{debateTranscript}}\n\nWrite the final moderated synthesis.",
        bag,
      ),
      system: nodeSystemPrompt(context, modeSpec, synthesisNode, bag),
      customAgentId: nodeCustomAgentId(synthesisNode),
      riskLevel: synthesisNode.riskLevel,
    });
    context.emitAgentMessage({
      fromAgentId: moderatorId,
      toAgentIds: [debateAgentId],
      replyToId: previousSpeechMessageId,
      threadId: `${DEBATE_GROUP_ID}:${context.projectId}`,
      nodeId: synthesisNode.id,
      planItemId: synthesisNode.id,
      kind: "reply",
      status: "done",
      content: asText(bag.synthesis),
      transcript: {
        kind: "stage_transcript",
        groupId: DEBATE_GROUP_ID,
        groupLabel: DEBATE_GROUP_LABEL,
        stageId: "moderator-synthesis",
        stageLabel: "主持总结",
        sequence: DEBATE_TURNS.length,
        speakerLabel: "主持人总结",
        speakerId: "moderator",
        stance: "moderator",
        status: "done",
      },
    });
    return bag.synthesis;
  });

  context.remember({
    id: `mode-${modeSpec.id}-result`,
    namespace: ["session", context.projectId, modeSpec.id],
    kind: "session",
    value: { framing: bag.framing, speeches, synthesis: bag.synthesis, completedNodes },
  });

  return {
    output: {
      text: asText(bag.synthesis),
      pattern: modeSpec.family,
      modeId: modeSpec.id,
      moderator: {
        framing: bag.framing,
        synthesis: bag.synthesis,
      },
      debateAgent: {
        id: debateAgentId,
        speeches,
      },
    },
  };
}

async function executeOrchestratorSubagent(input: ModeExecutionInput): Promise<PatternExecutionResult> {
  const { context, prompt, modeSpec } = input;
  if (modeSpec.id === DEBATE_MODE_ID) {
    return executeDebateMode(input);
  }
  const nodes = orderedEnabledModeNodes(modeSpec);
  const singleOwnerMode = modeUsesSingleOwner(modeSpec, nodes);
  const primaryAgentId = primaryOwnerAgentId(modeSpec, nodes);
  const totalActiveNodes = nodes.length;
  initializeQueueSummary(context, modeSpec.family, totalActiveNodes);
  const bag: ExecutionBag = { prompt };
  let completedNodes = 0;

  for (const node of nodes) {
      completedNodes = await runNode(context, modeSpec, node, totalActiveNodes, completedNodes, async () => {
        if (node.template === "decompose") {
          bag.plan = await context.callAgent({
          agentId: node.ownerAgentId ?? "orchestrator",
          planItemId: node.id,
          title: titleForNode(node, "Decompose work"),
          prompt: promptTemplate(
            node,
            runtimeFallbackPrompt(modeSpec.family, node.template),
            bag,
          ),
          system: nodeSystemPrompt(context, modeSpec, node, bag),
          customAgentId: nodeCustomAgentId(node),
          riskLevel: node.riskLevel,
          });
          return bag.plan;
        }

      if (node.template === "research") {
        bag.research = await context.callAgent({
          agentId: node.ownerAgentId ?? "researcher",
          planItemId: node.id,
          title: titleForNode(node, "Research context"),
          prompt: promptTemplate(
            node,
            runtimeFallbackPrompt(modeSpec.family, node.template),
            bag,
          ),
          system: nodeSystemPrompt(context, modeSpec, node, bag),
          customAgentId: nodeCustomAgentId(node),
          riskLevel: node.riskLevel,
          });
          return bag.research;
        }

      if (node.template === "review") {
        bag.review = await context.callAgent({
          agentId: node.ownerAgentId ?? "reviewer",
          planItemId: node.id,
          title: titleForNode(node, "Review risks"),
          prompt: promptTemplate(
            node,
            runtimeFallbackPrompt(modeSpec.family, node.template),
            bag,
          ),
          system: nodeSystemPrompt(context, modeSpec, node, bag),
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
        bag.synthesis = await context.callAgent({
          agentId: node.ownerAgentId ?? "orchestrator",
          planItemId: node.id,
          title: titleForNode(node, "Synthesize result"),
          prompt: promptTemplate(
            node,
            directSoloResponse
              ? "Task: {{prompt}}\nProduce the final answer directly. Do not create a separate planning draft unless the task genuinely requires it."
              : runtimeFallbackPrompt(modeSpec.family, node.template),
            bag,
          ),
          system: nodeSystemPrompt(context, modeSpec, node, bag),
          customAgentId: nodeCustomAgentId(node),
          riskLevel: node.riskLevel,
          });
          return bag.synthesis;
        }
      });
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
        decomposition: nodes.map((node) => node.template),
        plan: bag.plan,
      },
      subagents: {
        researcher: bag.research,
        reviewer: bag.review,
      },
    },
  };
}

async function executeAgentTeams(input: ModeExecutionInput): Promise<PatternExecutionResult> {
  const { context, prompt, modeSpec } = input;
  const nodes = orderedEnabledModeNodes(modeSpec);
  const totalActiveNodes = nodes.length;
  initializeQueueSummary(context, modeSpec.family, totalActiveNodes);
  const bag: ExecutionBag = { prompt };
  const leadId = ownerForTemplate(nodes, "triage", "team_lead");
  const builderId = ownerForTemplate(nodes, "build", "builder");
  const reviewerId = ownerForTemplate(nodes, "check", "reviewer");
  let completedNodes = 0;

  for (const node of nodes) {
      completedNodes = await runNode(context, modeSpec, node, totalActiveNodes, completedNodes, async () => {
        if (node.template === "triage") {
          const agentId = node.ownerAgentId ?? leadId;
          bag.triage = await context.callAgent({
          agentId,
          planItemId: node.id,
          title: titleForNode(node, "Triage backlog"),
          prompt: promptTemplate(
            node,
            runtimeFallbackPrompt(modeSpec.family, node.template),
            bag,
          ),
          system: nodeSystemPrompt(context, modeSpec, node, bag),
          customAgentId: nodeCustomAgentId(node),
          riskLevel: node.riskLevel,
          });
          bag.triageMessageId = context.emitAgentMessage({
            fromAgentId: agentId,
            toAgentIds: [builderId],
            threadId: "agent-teams:build",
            nodeId: node.id,
            planItemId: node.id,
            kind: "mention",
            status: "done",
            content: agentMessageContent(`${mention(builderId)} backlog is ready. Please build from this assignment:\n\n`, bag.triage),
          }).id;
          return bag.triage;
        }

      if (node.template === "build") {
        const agentId = node.ownerAgentId ?? "builder";
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
            toAgentIds: [reviewerId],
            replyToId: typeof bag.triageMessageId === "string" ? bag.triageMessageId : undefined,
            threadId: "agent-teams:build",
            nodeId: node.id,
            planItemId: node.id,
            kind: "reply",
            status: "done",
            content: agentMessageContent(`${mention(reviewerId)} build is ready for validation:\n\n`, bag.build),
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
          toAgentIds: [leadId],
            replyToId: typeof bag.buildMessageId === "string" ? bag.buildMessageId : undefined,
            threadId: "agent-teams:build",
            nodeId: node.id,
            planItemId: node.id,
            kind: "reply",
            status: "done",
            content: agentMessageContent(`${mention(leadId)} validation complete:\n\n`, bag.check),
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
          toAgentIds: [builderId, reviewerId],
          replyToId: typeof bag.checkMessageId === "string" ? bag.checkMessageId : undefined,
          threadId: "agent-teams:build",
          nodeId: node.id,
          planItemId: node.id,
          kind: "handoff",
          status: "done",
          content: agentMessageContent(`Team handoff recorded for ${mention(builderId)} and ${mention(reviewerId)}:\n\n`, bag.handoff),
        });
        return bag.handoff;
      }
    });
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

async function executeMessageBus(input: ModeExecutionInput): Promise<PatternExecutionResult> {
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
      completedNodes = await runNode(context, modeSpec, node, totalActiveNodes, completedNodes, async () => {
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
    });
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

async function executeSharedState(input: ModeExecutionInput): Promise<PatternExecutionResult> {
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
      completedNodes = await runNode(context, modeSpec, node, totalActiveNodes, completedNodes, async () => {
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

export async function executeModeSpec(input: ModeExecutionInput): Promise<PatternExecutionResult> {
  switch (input.modeSpec.family) {
    case "generator_verifier":
      return executeGeneratorVerifier(input);
    case "orchestrator_subagent":
      return executeOrchestratorSubagent(input);
    case "agent_teams":
      return executeAgentTeams(input);
    case "message_bus":
      return executeMessageBus(input);
    case "shared_state":
      return executeSharedState(input);
  }
}

export function getPatternDriver(pattern: CoordinationPattern): PatternDriver {
  return {
    id: pattern,
    async execute(context, prompt) {
      const modeSpec = createModeSpecFromPattern(pattern);
      const definition = modeSpecToPatternDefinition(modeSpec);
      return executeModeSpec({
        context,
        prompt,
        config: {
          pattern,
          modeId: modeSpec.id,
          modeSelection: "manual",
          profileIds: [],
          modelRef: "local/smoke-model",
          skillIds: [],
          toolIds: [],
          approvalMode: "high_risk_only",
          patternOptions: {},
          metadata: {},
          deterministicSeed: "ora-smoke",
        },
        modeSpec,
        definition,
      });
    },
  };
}
