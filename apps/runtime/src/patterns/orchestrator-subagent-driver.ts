import {
  CODE_DEVELOPMENT_MODE_ID,
  DEEP_RESEARCH_MODE_ID,
  ORA_ROOT_AGENT_ID,
  orderedEnabledModeLayers,
  orderedEnabledModeNodes,
  strictModeStageOutputSchema,
  type ModeNodeSpec,
  type ModeSpec,
  type ModeStageSpec,
} from "@cemeworm/shared";
import type { PatternExecutionContext, PatternExecutionResult } from "./execution-context.js";
import type { ModeExecutionInput } from "./mode-driver-registry.js";
import { asText, completeQueueSummary, dispatchNodeTemplate, initializeQueueSummary, interpolate, modeUsesSingleOwner, nodeCustomAgentId, nodeInstructions, nodeSystemPrompt, primaryOwnerAgentId, promptTemplate, publicAgentMessageContent, runtimeFallbackPrompt, titleForNode } from "./driver-utils.js";
import { runGenericModeNode, runModeLayer } from "./generic-node-executor.js";
import { containsCompleteProposedPlan, degradedBagEntry, finishPlanModeAfterProposedPlan, markBagKeyDegraded, type CodeDevelopmentDebugResolution, type ExecutionBag, type OrchestratorSubagentBag, DELEGATION_PLAN_INSTRUCTION, parseCodeDevelopmentDebugResolution, parseDelegationPlan, parseReviewGateVerdict, type DelegationPlan, writeBag, writeStructuredBagValue } from "./mode-driver-helpers.js";

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

function nodeToolIds(node: ModeNodeSpec): string[] | undefined {
  const config = node.config as { toolIds?: unknown };
  return Array.isArray(config.toolIds)
    ? config.toolIds.filter((toolId): toolId is string => typeof toolId === "string")
    : undefined;
}

function stageSpeakerLabel(modeSpec: ModeSpec, node: ModeNodeSpec, stage: ModeStageSpec): string {
  const profile = stage.speakerId ? modeSpec.profiles.find((candidate) => candidate.id === stage.speakerId) : undefined;
  return stage.speakerLabel ?? profile?.label ?? node.title ?? node.label;
}

function nodeStopsOnReviewVerdict(node: ModeNodeSpec): boolean {
  const config = node.config as { gateOnReviewVerdict?: unknown };
  return config.gateOnReviewVerdict === true;
}

function nodeReworkTargets(node: ModeNodeSpec): string[] {
  const config = node.config as { reworkNodeIds?: unknown };
  return Array.isArray(config.reworkNodeIds)
    ? config.reworkNodeIds.filter((nodeId): nodeId is string => typeof nodeId === "string")
    : [];
}

const MAX_STAGED_REWORK_ROUNDS = 2;
const DEEP_RESEARCH_ACCEPTED_ARTIFACT_KEYS = ["gather", "analyze", "gap_analysis", "compile"] as const;

function isChinese(context: PatternExecutionContext): boolean {
  return context.responseLanguage() === "zh";
}

function isCodeDevelopmentMode(modeSpec: ModeSpec): boolean {
  return modeSpec.id === CODE_DEVELOPMENT_MODE_ID;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function structuredText(value: unknown): string {
  if (isRecord(value) && typeof value.text === "string") {
    return value.text;
  }
  return asText(value);
}

function isDegradedBagEntry(value: unknown): value is { text: string; _degraded: true } {
  return isRecord(value) && value._degraded === true && typeof value.text === "string";
}

function hasStrictStructuredStageContract(
  modeId: string,
  outputKey: string,
  value: unknown,
): boolean {
  const schema = strictModeStageOutputSchema(modeId, outputKey);
  return Boolean(schema?.safeParse(value).success);
}

function handoffDoneGateStatus(value: unknown): "pass" | "blocked" | undefined {
  if (!isRecord(value) || !isRecord(value.doneGate)) return undefined;
  return value.doneGate.status === "pass" || value.doneGate.status === "blocked"
    ? value.doneGate.status
    : undefined;
}

function handoffTodoStatus(value: unknown): "clean" | "followup_only" | "blocked" | undefined {
  if (!isRecord(value) || !isRecord(value.todoScanResult)) return undefined;
  return value.todoScanResult.status === "clean" ||
    value.todoScanResult.status === "followup_only" ||
    value.todoScanResult.status === "blocked"
    ? value.todoScanResult.status
    : undefined;
}

function codeDevelopmentFinalDeliveryBlockers(bag: ExecutionBag): string[] {
  const blockers: string[] = [];
  if (!hasStrictStructuredStageContract(CODE_DEVELOPMENT_MODE_ID, "triage", bag.triage)) {
    blockers.push("triage contract is missing required structured fields");
  }
  if (!hasStrictStructuredStageContract(CODE_DEVELOPMENT_MODE_ID, "build", bag.build)) {
    blockers.push("build contract is missing changedFiles or verificationEvidence");
  }
  if (!hasStrictStructuredStageContract(CODE_DEVELOPMENT_MODE_ID, "review", bag.review)) {
    blockers.push("review contract is missing required structured fields");
  }
  if (!hasStrictStructuredStageContract(CODE_DEVELOPMENT_MODE_ID, "debug", bag.debug)) {
    blockers.push("debug contract is missing required structured fields");
  }
  if (!hasStrictStructuredStageContract(CODE_DEVELOPMENT_MODE_ID, "handoff", bag.handoff)) {
    blockers.push("handoff contract is missing required structured fields");
  }
  if (bag.reviewVerdict !== "pass") {
    blockers.push("review gate did not pass");
  }
  if (bag.debugStatus !== "clear") {
    blockers.push("debug gate did not clear");
  }
  if (handoffTodoStatus(bag.handoff) === "blocked") {
    blockers.push("TODO scan is blocked");
  }
  if (handoffDoneGateStatus(bag.handoff) === "blocked") {
    blockers.push("DONE gate is blocked");
  }
  return blockers;
}

function isDeepResearchMode(modeSpec: ModeSpec): boolean {
  return modeSpec.id === DEEP_RESEARCH_MODE_ID;
}

function shouldWriteStructuredStageOutput(
  modeSpec: ModeSpec,
  node: ModeNodeSpec,
  stage: ModeStageSpec,
): boolean {
  const bagKey = stage.outputKey ?? node.id;
  return Boolean(strictModeStageOutputSchema(modeSpec.id, bagKey));
}

function writeStructuredStageOutput(
  bag: ExecutionBag,
  modeSpec: ModeSpec,
  node: ModeNodeSpec,
  stage: ModeStageSpec,
  result: Awaited<ReturnType<PatternExecutionContext["callAgentStructured"]>>,
): void {
  const bagKey = stage.outputKey ?? node.id;
  if (result.ok) {
    writeStructuredBagValue(bag, bagKey, result.rawText, result.value, result.diagnostics);
  } else {
    writeStructuredBagValue(bag, bagKey, result.rawText, degradedBagEntry(result.rawText, result.diagnostics), result.diagnostics);
    markBagKeyDegraded(bag, bagKey, result.rawText, result.diagnostics);
  }

  const normalized = bag[bagKey];
  bag[stage.id] = normalized;
  bag[`${stage.id}_raw`] = bag[`${bagKey}_raw`];
  bag[node.id] = normalized;
  bag[`${node.id}_raw`] = bag[`${bagKey}_raw`];
  if (stage.outputKey && stage.outputKey !== node.id) {
    bag[stage.outputKey] = normalized;
    bag[`${stage.outputKey}_raw`] = bag[`${bagKey}_raw`];
  }
  bag[node.template] = normalized;
  bag[`${node.template}_raw`] = bag[`${bagKey}_raw`];
}

function defaultAcceptedArtifactIds(
  modeSpec: ModeSpec,
  nodes: ModeNodeSpec[],
  currentNodeId: string,
): string[] {
  if (isDeepResearchMode(modeSpec)) {
    return [...DEEP_RESEARCH_ACCEPTED_ARTIFACT_KEYS];
  }
  const currentIndex = nodes.findIndex((candidate) => candidate.id === currentNodeId);
  return nodes.slice(0, currentIndex).map((prior) => prior.id);
}

function valuesForStagePrompt(
  modeSpec: ModeSpec,
  node: ModeNodeSpec,
  bag: ExecutionBag,
): ExecutionBag {
  if (!isDeepResearchMode(modeSpec) || node.id !== "synthesize") {
    return bag;
  }
  const values: ExecutionBag = { ...bag };
  const accepted = new Set(
    Array.isArray(bag.acceptedArtifactIds)
      ? bag.acceptedArtifactIds.filter((artifactId): artifactId is string => typeof artifactId === "string")
      : [],
  );
  for (const artifactId of DEEP_RESEARCH_ACCEPTED_ARTIFACT_KEYS) {
    if (!accepted.has(artifactId)) {
      values[artifactId] = "";
    }
  }
  return values;
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
    toolIds: nodeToolIds(node),
  });
}

async function executeStagedTranscriptMode(input: ModeExecutionInput): Promise<PatternExecutionResult> {
  const { context, prompt, modeSpec, config } = input;
  const zh = isChinese(context);
  const nodes = orderedEnabledModeNodes(modeSpec);
  const totalActiveNodes = nodes.length;
  const planIntent = config.metadata.taskIntent === "plan";
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
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const bag: ExecutionBag = { prompt, degradedDelivery: "" };
  const stageOutputs: Array<{ speakerLabel: string; content: string }> = [];
  let completedNodes = 0;
  let previousStageMessageId: string | undefined;
  let gatedReviewVerdict:
    | {
        nodeId: string;
        verdict: ReturnType<typeof parseReviewGateVerdict>;
        output: unknown;
      }
    | undefined;

  const executeStagedNode = async (
    node: ModeNodeSpec,
    options?: { reworkRound?: number; reviewerOutput?: string },
  ): Promise<unknown> => {
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
      const stageBag = valuesForStagePrompt(modeSpec, node, bag);
      const values = stageValues(stageBag, stage, speakerLabel, priorTranscript);
      const systemParts = [nodeInstructions(modeSpec, node, values)];
      if (shouldApplyStanceLock(stage)) {
        systemParts.push(`STANCE LOCK: You are now ${speakerLabel}. Your mandatory stance is "${stage.stance}". Every claim you make must support the ${stage.stance} position or attack the opposing position. Neutral evaluation, both-sides framing, and undermining your own side are protocol violations.`);
      }
      let stagePrompt = interpolate(stage.promptTemplate ?? node.prompt ?? fallbackStagePrompt(stage), values);
      if (options?.reworkRound && gatedReviewVerdict) {
        const verdict = gatedReviewVerdict.verdict;
        const feedbackParts = [
          `Verifier feedback to address:\n${options.reviewerOutput ?? asText(bag.verify ?? bag.review)}`,
        ];
        if (verdict.acceptedArtifactIds?.length) {
          feedbackParts.push(`Already accepted (do not redo): ${verdict.acceptedArtifactIds.join(", ")}`);
        }
        if (verdict.findings?.length) {
          const ownFindings = verdict.findings.filter((f) =>
            !f.artifactId || String(bag[f.artifactId] ?? "").length > 0
          );
          if (ownFindings.length > 0) {
            feedbackParts.push(`Fix these blocking issues:\n${ownFindings.map((f) => `- [${f.artifactId ?? "general"}] ${f.issue}`).join("\n")}`);
          }
        }
        stagePrompt += `\n\n${feedbackParts.join("\n\n")}\n\nThis is rework round ${options.reworkRound}. Resolve the verifier's blocking issues before handing back the work.`;
      }
      const stageCallParams = {
        agentId,
        planItemId: node.id,
        title: node.template === "synthesize"
          ? titleForNode(node, stage.label)
          : options?.reworkRound
            ? `${speakerLabel} ${stage.label} (Rework ${options.reworkRound})`
            : `${speakerLabel} ${stage.label}`,
        prompt: stagePrompt,
        system: context.systemPrompt(systemParts.join("\n\n")),
        customAgentId: nodeCustomAgentId(node),
        riskLevel: node.riskLevel,
        toolIds: nodeToolIds(node),
      } satisfies Parameters<PatternExecutionContext["callAgent"]>[0];
      const strictSchema = strictModeStageOutputSchema(modeSpec.id, stage.outputKey ?? node.id);
      const structuredResult = strictSchema
        ? await context.callAgentStructured({
            ...stageCallParams,
            modeId: modeSpec.id,
            outputKey: stage.outputKey ?? node.id,
            schema: strictSchema,
          })
        : undefined;
      const output = structuredResult ? structuredResult.rawText : await context.callAgent(stageCallParams);
      const message = context.emitAgentMessage({
        fromAgentId: agentId,
        toAgentIds: modeSpec.profiles.map((profile) => profile.id).filter((profileId) => profileId !== agentId),
        replyToId: previousStageMessageId,
        threadId: `${groupId}:${context.projectId}`,
        nodeId: node.id,
        planItemId: node.id,
        kind: "reply",
        status: "done",
        content: publicAgentMessageContent("", output, `${speakerLabel} 阶段输出不可用`, zh ? "zh" : "en"),
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
      if (structuredResult && shouldWriteStructuredStageOutput(modeSpec, node, stage)) {
        writeStructuredStageOutput(bag, modeSpec, node, stage, structuredResult);
      } else {
        bag[stage.id] = output;
        bag[node.id] = output;
        bag[node.template] = output;
        if (stage.outputKey) {
          bag[stage.outputKey] = output;
        }
      }
      bag.priorTranscript = stageOutputs.map(stageTranscriptLine).join("\n\n");
      bag.debateTranscript = bag.priorTranscript;
    }
    if (nodeStopsOnReviewVerdict(node) && lastStageOutput !== undefined) {
      const reviewBagKey = (nodeStages.at(-1)?.outputKey ?? node.id);
      if (!hasStrictStructuredStageContract(modeSpec.id, reviewBagKey, bag[reviewBagKey])) {
        const contractIssue = zh
          ? "结构化审查契约无效，不能进入下一阶段。"
          : "Structured review contract is invalid and cannot advance.";
        bag.reviewVerdict = "blocked";
        bag.reviewIssues = [contractIssue];
        gatedReviewVerdict = {
          nodeId: node.id,
          verdict: {
            verdict: "blocked",
            issues: [contractIssue],
            source: "missing",
          },
          output: bag[reviewBagKey] ?? lastStageOutput,
        };
        return lastStageOutput;
      }
      const verdict = parseReviewGateVerdict(bag[reviewBagKey] ?? lastStageOutput);
      bag.reviewVerdict = verdict.verdict;
      bag.reviewIssues = verdict.issues;
      if (verdict.acceptedArtifactIds?.length) {
        bag.acceptedArtifactIds = verdict.acceptedArtifactIds;
      }
      if (verdict.findings?.length) {
        bag.reviewFindings = verdict.findings;
      }
      if (verdict.verdict !== "pass") {
        gatedReviewVerdict = {
          nodeId: node.id,
          verdict,
          output: lastStageOutput,
        };
      } else {
        gatedReviewVerdict = undefined;
      }
    }
    if (isCodeDevelopmentMode(modeSpec) && node.id === "debug" && lastStageOutput !== undefined) {
      const debugBagKey = nodeStages.at(-1)?.outputKey ?? node.id;
      if (!hasStrictStructuredStageContract(modeSpec.id, debugBagKey, bag[debugBagKey])) {
        const contractIssue = zh
          ? "结构化调试契约无效，不能完成正常移交。"
          : "Structured debug contract is invalid and cannot complete handoff.";
        bag.debugStatus = "blocked";
        bag.debugRootCauses = [contractIssue];
        gatedReviewVerdict = {
          nodeId: node.id,
          verdict: {
            verdict: "blocked",
            issues: [contractIssue],
            source: "missing",
          },
          output: bag[debugBagKey] ?? lastStageOutput,
        };
        return lastStageOutput;
      }
      const resolution: CodeDevelopmentDebugResolution = parseCodeDevelopmentDebugResolution(bag[debugBagKey] ?? lastStageOutput);
      bag.debugStatus = resolution.status;
      bag.debugRootCauses = resolution.rootCauses;
      if (resolution.status !== "clear") {
        gatedReviewVerdict = {
          nodeId: node.id,
          verdict: {
            verdict: resolution.status === "blocked" ? "blocked" : "needs_fix",
            issues: resolution.rootCauses.length > 0
              ? resolution.rootCauses
              : [zh ? "调试关卡未通过。" : "Debug gate did not clear."],
            source: resolution.source,
            reworkNodeIds: resolution.status === "needs_fix"
              ? (resolution.requiredReworkNodeIds?.length ? resolution.requiredReworkNodeIds : ["build"])
              : undefined,
          },
          output: lastStageOutput,
        };
      } else {
        gatedReviewVerdict = undefined;
      }
    }
    return lastStageOutput;
  };

  for (const node of nodes) {
    completedNodes = await runGenericModeNode(context, modeSpec, node, totalActiveNodes, completedNodes, () => executeStagedNode(node), bag);

    if (
      isCodeDevelopmentMode(modeSpec)
      && !planIntent
      && node.id === "triage"
      && !hasStrictStructuredStageContract(CODE_DEVELOPMENT_MODE_ID, "triage", bag.triage)
    ) {
      context.setPlanStatus(node.id, "failed");
      const currentIndex = nodes.findIndex((candidate) => candidate.id === node.id);
      for (const remaining of nodes.slice(currentIndex + 1)) {
        context.setPlanStatus(remaining.id, "skipped");
      }
      completeQueueSummary(context, totalActiveNodes);
      return {
        output: {
          text: zh
            ? "Code Development 在进入 Builder 前停止：triage 没有产出可验证的结构化实施契约。"
            : "Code Development stopped before Builder because triage did not produce a valid structured implementation contract.",
          pattern: modeSpec.family,
          modeId: modeSpec.id,
          stages: stageOutputs,
          stoppedAfterInvalidTriage: true,
          invalidTriageReason: "invalid_or_degraded_triage_contract",
          degradedKeys: bag._degradedKeys,
          triage: bag.triage,
        },
      };
    }

    if (planIntent) {
      const planOutput = stageOutputs.at(-1)?.content ?? asText(bag[node.id] ?? bag[node.template]);
      if (containsCompleteProposedPlan(planOutput)) {
        finishPlanModeAfterProposedPlan(context, nodes, nodes.findIndex((candidate) => candidate.id === node.id), totalActiveNodes);
        return {
          output: {
            text: planOutput,
            pattern: modeSpec.family,
            modeId: modeSpec.id,
            stages: stageOutputs,
            stoppedAfterProposedPlan: true,
          },
        };
      }
    }

    if (gatedReviewVerdict) {
      if (gatedReviewVerdict.verdict.verdict === "needs_fix") {
        const verdictReworkIds = gatedReviewVerdict.verdict.reworkNodeIds;
        const configTargets = nodeReworkTargets(node)
          .map((nodeId) => nodesById.get(nodeId))
          .filter((candidate): candidate is ModeNodeSpec => Boolean(candidate));
        const reworkTargets = verdictReworkIds && verdictReworkIds.length > 0
          ? verdictReworkIds
              .map((nodeId) => nodesById.get(nodeId))
              .filter((candidate): candidate is ModeNodeSpec => Boolean(candidate))
          : configTargets;
        for (let reworkRound = 1; reworkRound <= MAX_STAGED_REWORK_ROUNDS && gatedReviewVerdict; reworkRound += 1) {
          bag.reviewReworkCount = reworkRound;
          context.emitAgentMessage({
            fromAgentId: node.ownerAgentId ?? primaryOwnerAgentId(modeSpec, [node]),
            toAgentIds: reworkTargets.map((target) => target.ownerAgentId ?? primaryOwnerAgentId(modeSpec, [target])),
            replyToId: previousStageMessageId,
            threadId: `${groupId}:${context.projectId}`,
            nodeId: node.id,
            planItemId: node.id,
            kind: "status",
            status: "running",
            content: zh
              ? `研究核查未通过，正在启动第 ${reworkRound} 轮补充研究与复核。`
              : `Research verification did not pass. Starting supplemental research and re-review round ${reworkRound}.`,
          });
          for (const targetNode of reworkTargets) {
            await executeStagedNode(targetNode, {
              reworkRound,
              reviewerOutput: asText(gatedReviewVerdict.output),
            });
            if (gatedReviewVerdict && gatedReviewVerdict.nodeId !== node.id) {
              break;
            }
          }
          if (gatedReviewVerdict && gatedReviewVerdict.nodeId !== node.id) {
            break;
          }
          await executeStagedNode(node, {
            reworkRound,
            reviewerOutput: asText(gatedReviewVerdict.output),
          });
          if (!gatedReviewVerdict) {
            break;
          }
        }
      }
    }

    if (nodeStopsOnReviewVerdict(node) && !gatedReviewVerdict && !bag.acceptedArtifactIds) {
      const acceptedArtifactIds = defaultAcceptedArtifactIds(modeSpec, nodes, node.id);
      if (acceptedArtifactIds.length > 0) {
        bag.acceptedArtifactIds = acceptedArtifactIds;
      }
    }

    if (gatedReviewVerdict) {
      const currentIndex = nodes.findIndex((candidate) => candidate.id === node.id);
      const remainingNodes = nodes.slice(currentIndex + 1);
      const finalNode = remainingNodes.at(-1);
      const intermediateNodes = finalNode ? remainingNodes.slice(0, -1) : remainingNodes;

      for (const remaining of intermediateNodes) {
        context.setPlanStatus(remaining.id, "skipped");
      }

      if (finalNode) {
        const degradedReason =
          gatedReviewVerdict.verdict.verdict === "needs_fix"
            ? zh
              ? `核查未通过：${(bag.reviewReworkCount ?? 0)} 轮返工后仍未解决所有阻塞问题。`
              : `Verification failed: blocking issues remain after ${bag.reviewReworkCount ?? 0} rework rounds.`
            : zh
              ? "核查阻塞：缺少关键信息或外部条件不满足。"
              : "Verification blocked: key information is missing or external conditions are not met.";
        bag.degradedDelivery = zh
          ? `${degradedReason} 以下输出为降级交付。必须明确标注所有未经核查的推断、低置信度来源和未解决的阻塞问题。不要假装验证已通过。`
          : `${degradedReason} The output below is a degraded delivery. Clearly label every unverified inference, low-confidence source, and unresolved blocker. Do not pretend verification passed.`;
        context.setPlanStatus(finalNode.id, "running");
        const finalReworkRound = typeof bag.reviewReworkCount === "number" ? bag.reviewReworkCount : 0;
        await executeStagedNode(finalNode, {
          reworkRound: finalReworkRound,
          reviewerOutput: asText(gatedReviewVerdict.output),
        });
        context.setPlanStatus(finalNode.id, "done");
      }

      completeQueueSummary(context, totalActiveNodes);

      const degradedText = stageOutputs.at(-1)?.content ?? asText(gatedReviewVerdict.output);
      return {
        output: {
          text: structuredText(bag.handoff ?? degradedText),
          pattern: modeSpec.family,
          modeId: modeSpec.id,
          stages: stageOutputs,
          reviewVerdict: bag.reviewVerdict ?? gatedReviewVerdict.verdict.verdict,
          debugStatus: bag.debugStatus,
          verificationBlocked: true,
          degradedDelivery: true,
          blockedNodeId: gatedReviewVerdict.nodeId,
          reviewIssues: gatedReviewVerdict.verdict.issues,
          reviewReworkCount: bag.reviewReworkCount ?? 0,
          reviewFindings: bag.reviewFindings,
          degradedKeys: bag._degradedKeys,
        },
      };
    }
  }

  context.remember({
    id: `mode-${modeSpec.id}-result`,
    namespace: ["session", context.projectId, modeSpec.id],
    kind: "session",
    value: { stages: stageOutputs, output: stageOutputs.at(-1)?.content, completedNodes },
  });

  const finalDeliveryBlockers = isCodeDevelopmentMode(modeSpec) ? codeDevelopmentFinalDeliveryBlockers(bag) : [];
  const finalOutput = structuredText(bag.handoff || bag.synthesis || bag.review || bag.research || bag.plan);
  if (finalDeliveryBlockers.length > 0) {
    return {
      output: {
        text: finalOutput,
        pattern: modeSpec.family,
        modeId: modeSpec.id,
        stages: stageOutputs,
        reviewVerdict: bag.reviewVerdict,
        debugStatus: bag.debugStatus,
        reviewIssues: bag.reviewIssues,
        reviewReworkCount: bag.reviewReworkCount ?? 0,
        reviewFindings: bag.reviewFindings,
        degradedKeys: bag._degradedKeys,
        verificationBlocked: true,
        degradedDelivery: true,
        finalDeliveryBlocked: true,
        blockedNodeId: "handoff",
        finalDeliveryBlockers,
      },
    };
  }
  return {
    output: {
      text: finalOutput,
      pattern: modeSpec.family,
      modeId: modeSpec.id,
      stages: stageOutputs,
      reviewVerdict: bag.reviewVerdict,
      debugStatus: bag.debugStatus,
      reviewIssues: bag.reviewIssues,
      reviewReworkCount: bag.reviewReworkCount ?? 0,
      reviewFindings: bag.reviewFindings,
      degradedKeys: bag._degradedKeys,
      degradedDelivery: false,
      finalDeliveryBlocked: false,
      finalDeliveryBlockers,
    },
  };
}

export async function executeOrchestratorSubagent(input: ModeExecutionInput): Promise<PatternExecutionResult> {
  const { context, prompt, config, modeSpec } = input;
  if (modeSpec.stages?.length) {
    return executeStagedTranscriptMode(input);
  }
  const layers = orderedEnabledModeLayers(modeSpec);
  const allNodes = layers.flat();
  const planIntent = config.metadata.taskIntent === "plan";
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
          toolIds: nodeToolIds(node),
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
          toolIds: nodeToolIds(node),
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
          toolIds: nodeToolIds(node),
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
          toolIds: nodeToolIds(node),
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

      if (planIntent && containsCompleteProposedPlan(bag.synthesis || bag.review || bag.research || bag.plan)) {
        const currentNode = layer.at(-1);
        finishPlanModeAfterProposedPlan(
          context,
          allNodes,
          currentNode ? allNodes.findIndex((candidate) => candidate.id === currentNode.id) : -1,
          totalActiveNodes,
        );
        return {
          output: {
            text: asText(bag.synthesis || bag.review || bag.research || bag.plan),
            pattern: modeSpec.family,
            modeId: modeSpec.id,
            stoppedAfterProposedPlan: true,
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
