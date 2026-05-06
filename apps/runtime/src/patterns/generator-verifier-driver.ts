import { orderedEnabledModeNodes } from "@cemeworm/shared";
import { assessGeneratorVerifierResponse } from "./generator-verifier-utils.js";
import type { PatternExecutionResult } from "./execution-context.js";
import type { ModeExecutionInput } from "./mode-driver-registry.js";
import { agentMessageContent, asText, initializeQueueSummary, mention, nodeCustomAgentId, nodeSystemPrompt, ownerForTemplate, promptTemplate, runtimeFallbackPrompt, titleForNode } from "./driver-utils.js";
import { runGenericModeNode } from "./generic-node-executor.js";
import { type ExecutionBag } from "./mode-driver-helpers.js";

export async function executeGeneratorVerifier(input: ModeExecutionInput): Promise<PatternExecutionResult> {
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
      completedNodes = await runGenericModeNode(context, modeSpec, node, totalActiveNodes, completedNodes, async () => {
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
