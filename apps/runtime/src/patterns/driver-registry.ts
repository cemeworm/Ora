import {
  createModeSpecFromPattern,
  getModeNodeRuntimeTemplateDefinition,
  type RunConfig,
  type MemoryKind,
  modeSpecToPatternDefinition,
  orderedEnabledModeNodes,
  type BusStats,
  type CoordinationPattern,
  type ModeNodeSpec,
  type ModeSpec,
  type PatternDefinition,
  type QueueSummary,
  type SharedStateSummary,
} from "@ora/shared";
import { assessGeneratorVerifierResponse } from "./generator-verifier-utils.js";

export interface PatternExecutionContext {
  projectId: string;
  queueSummary: QueueSummary;
  sharedStateSummary: SharedStateSummary;
  busStats: BusStats;
  systemPrompt(extra: string): string;
  setPlanStatus(templateId: string, status: "planned" | "ready" | "running" | "blocked" | "done" | "failed" | "skipped"): void;
  setQueueSummary(patch: Partial<QueueSummary>): void;
  runRecoverableNode<T>(params: {
    nodeId: string;
    nodeTemplate: string;
    nodeLabel: string;
    agentId?: string;
  }, execute: () => Promise<T>): Promise<{ status: "completed"; output: T } | { status: "skipped"; output?: unknown }>;
  runDelegatedTask<T>(params: {
    taskId: string;
    nodeId: string;
    nodeLabel: string;
    agentId: string;
    title: string;
  }, execute: () => Promise<T>): Promise<T>;
  ensureClarification(params: {
    id: string;
    key: string;
    nodeId: string;
    nodeLabel: string;
    question: string;
    narrate?: boolean;
  }): Promise<unknown>;
  claimWorker(agentId: string): void;
  releaseWorker(agentId: string): void;
  callAgent(params: {
    agentId: string;
    planItemId?: string;
    title: string;
    prompt: string;
    system: string;
    customAgentId?: string;
    riskLevel?: "low" | "medium" | "high";
  }): Promise<string>;
  remember(params: {
    id: string;
    namespace: string[];
    kind: "profile" | "project" | "session" | "worker" | "artifact";
    value: unknown;
    sourceActionId?: string;
  }): void;
  captureMemory(params: {
    id: string;
    namespace: string[];
    kind: MemoryKind;
    value: unknown;
    sourceActionId?: string;
  }): void;
  publishArtifact(params: {
    id: string;
    label: string;
    kind?: "report" | "file" | "log";
    mimeType?: string;
    payload: unknown;
  }): void;
  publishMessage(params: {
    agentId: string;
    topic: string;
    correlationId: string;
    summary: string;
    payload: unknown;
  }): void;
  routeMessage(params: {
    agentId: string;
    fromTopic: string;
    toTopic: string;
    correlationId: string;
    summary: string;
  }): void;
  emitAgentMessage(params: {
    fromAgentId: string;
    toAgentIds?: string[];
    replyToId?: string;
    threadId: string;
    nodeId?: string;
    planItemId?: string;
    kind: "mention" | "reply" | "handoff" | "route" | "publish" | "status";
    status?: "sent" | "running" | "done" | "failed";
    content: string;
    topic?: string;
    correlationId?: string;
    artifactIds?: string[];
  }): { id: string };
  writeSharedState(params: {
    agentId: string;
    key: string;
    summary: string;
    value: unknown;
  }): void;
  currentSharedState(): SharedStateSummary;
}

export interface PatternExecutionResult {
  output: unknown;
}

export interface PatternDriver {
  id: CoordinationPattern;
  execute(context: PatternExecutionContext, prompt: string): Promise<PatternExecutionResult>;
}

interface ModeExecutionInput {
  context: PatternExecutionContext;
  prompt: string;
  config: RunConfig;
  modeSpec: ModeSpec;
  definition: PatternDefinition;
}

type ExecutionBag = Record<string, unknown>;

function correlationId(base: string): string {
  return `${base}-${Math.random().toString(36).slice(2, 8)}`;
}

function asText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value === undefined || value === null) {
    return "";
  }
  return JSON.stringify(value);
}

function interpolate(template: string, values: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key) => asText(values[key]));
}

function promptTemplate(
  node: ModeNodeSpec,
  fallback: string,
  values: Record<string, unknown>,
): string {
  return interpolate(node.prompt ?? fallback, values);
}

function titleForNode(node: ModeNodeSpec, fallback: string): string {
  return node.title ?? node.label ?? fallback;
}

function nodeCustomAgentId(node: ModeNodeSpec): string | undefined {
  return typeof node.config?.customAgentId === "string" && node.config.customAgentId.trim()
    ? node.config.customAgentId.trim()
    : undefined;
}

function mention(agentId: string): string {
  return `@${agentId}`;
}

function agentMessageContent(prefix: string, value: unknown): string {
  const text = asText(value).trim();
  return text ? `${prefix}${text}` : prefix.trimEnd();
}

function ownerForTemplate(
  nodes: ModeNodeSpec[],
  template: ModeNodeSpec["template"],
  fallback: string,
): string {
  return nodes.find((node) => node.template === template)?.ownerAgentId ?? fallback;
}

function runtimeFallbackPrompt(family: CoordinationPattern, template: ModeNodeSpec["template"]): string {
  return getModeNodeRuntimeTemplateDefinition(family, template).fallbackPrompt ?? "";
}

function queueModeForFamily(family: CoordinationPattern): QueueSummary["mode"] {
  switch (family) {
    case "agent_teams":
      return "backlog";
    case "message_bus":
      return "event_bus";
    case "shared_state":
      return "shared_state";
    default:
      return "dag";
  }
}

function nodeAtomIds(node: ModeNodeSpec): Set<string> {
  return new Set(
    Array.isArray(node.config?.atoms)
      ? node.config.atoms.filter((value): value is string => typeof value === "string")
      : [],
  );
}

function modeUsesSingleOwner(modeSpec: ModeSpec, nodes: ModeNodeSpec[]): boolean {
  const fallbackAgentId = modeSpec.profiles[0]?.id;
  const ownerIds = new Set(
    nodes.map((node) => node.ownerAgentId ?? fallbackAgentId).filter((id): id is string => typeof id === "string"),
  );
  return ownerIds.size <= 1 && !nodes.some((node) => nodeAtomIds(node).has("subagent_delegate"));
}

function primaryOwnerAgentId(modeSpec: ModeSpec, nodes: ModeNodeSpec[]): string {
  return nodes.find((node) => node.ownerAgentId)?.ownerAgentId ?? modeSpec.profiles[0]?.id ?? "agent";
}

function initializeQueueSummary(
  context: PatternExecutionContext,
  family: CoordinationPattern,
  totalActiveNodes: number,
): void {
  context.setQueueSummary({
    mode: queueModeForFamily(family),
    pending: totalActiveNodes,
    inProgress: 0,
    completed: 0,
    topics: family === "message_bus" ? ["task.input", "task.findings", "task.response"] : [],
  });
}

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
            system: context.systemPrompt("You are the generator. Produce a concrete candidate answer."),
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
            system: context.systemPrompt(
              "You are the verifier. Return only one compact JSON object with keys verdict, rationale, and missingRequirements. "
              + "Use verdict=\"pass\" only when the candidate fully satisfies the rubric. "
              + "If the candidate fails or you cannot verify it, return {\"verdict\":\"fail\",\"rationale\":\"...\",\"missingRequirements\":[\"...\"]}. "
              + "Do not include markdown, prose, greetings, or role explanations outside the JSON object."
            ),
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

async function executeOrchestratorSubagent(input: ModeExecutionInput): Promise<PatternExecutionResult> {
  const { context, prompt, modeSpec } = input;
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
          system: context.systemPrompt(
            singleOwnerMode
              ? "You are the solo agent. Frame the task briefly, keep the plan compact, and do not delegate."
              : "You are the orchestrator. Keep delegation explicit and inspectable."
          ),
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
          system: context.systemPrompt("You are the research subagent. Return concise findings."),
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
          system: context.systemPrompt("You are the review subagent. Surface risks and gaps."),
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
          system: context.systemPrompt(
            directSoloResponse
              ? "You are the solo agent. Complete the user request directly and make the final answer the only assistant body."
              : singleOwnerMode
                ? "You are the solo agent. Use your framing notes and produce the final answer directly."
              : "You are the orchestrator. Synthesize delegated results into one answer."
          ),
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
  const checkerId = ownerForTemplate(nodes, "check", "checker");
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
          system: context.systemPrompt("You are the team lead. Create a compact backlog."),
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
            system: context.systemPrompt("You are the persistent builder teammate. Complete the assigned work."),
            customAgentId: nodeCustomAgentId(node),
            riskLevel: node.riskLevel,
          });
          bag.buildMessageId = context.emitAgentMessage({
            fromAgentId: agentId,
            toAgentIds: [checkerId],
            replyToId: typeof bag.triageMessageId === "string" ? bag.triageMessageId : undefined,
            threadId: "agent-teams:build",
            nodeId: node.id,
            planItemId: node.id,
            kind: "reply",
            status: "done",
            content: agentMessageContent(`${mention(checkerId)} build is ready for validation:\n\n`, bag.build),
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
        const agentId = node.ownerAgentId ?? "checker";
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
            system: context.systemPrompt("You are the persistent checker teammate. Validate the assigned work."),
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
          system: context.systemPrompt("You are the team lead. Summarize the handoff and next steps."),
          customAgentId: nodeCustomAgentId(node),
          riskLevel: node.riskLevel,
          });
        context.emitAgentMessage({
          fromAgentId: agentId,
          toAgentIds: [builderId, checkerId],
          replyToId: typeof bag.checkMessageId === "string" ? bag.checkMessageId : undefined,
          threadId: "agent-teams:build",
          nodeId: node.id,
          planItemId: node.id,
          kind: "handoff",
          status: "done",
          content: agentMessageContent(`Team handoff recorded for ${mention(builderId)} and ${mention(checkerId)}:\n\n`, bag.handoff),
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
        checker: bag.check,
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
  const investigatorId = ownerForTemplate(nodes, "handle", "investigator");
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
          system: context.systemPrompt("You are the router. Route work explicitly to the correct subscriber."),
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
          toAgentIds: [investigatorId],
          replyToId: typeof bag.publishMessageId === "string" ? bag.publishMessageId : undefined,
          threadId: asText(bag.correlationId),
          nodeId: node.id,
          planItemId: node.id,
          kind: "route",
          status: "done",
          topic: "task.findings",
          correlationId: asText(bag.correlationId),
          content: agentMessageContent(`${mention(investigatorId)} routed task.findings to you:\n\n`, bag.routingPlan),
        }).id;
        return bag.routingPlan;
      }

      if (node.template === "handle") {
        const agentId = node.ownerAgentId ?? investigatorId;
        bag.findings = await context.callAgent({
          agentId,
          planItemId: node.id,
          title: titleForNode(node, "Handle routed work"),
          prompt: promptTemplate(
            node,
            runtimeFallbackPrompt(modeSpec.family, node.template),
            bag,
          ),
          system: context.systemPrompt("You are the investigator. Produce findings for the routed event."),
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
          system: context.systemPrompt("You are the responder. Publish the final bus response."),
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
          toAgentIds: [routerId, investigatorId],
          replyToId: typeof bag.findingsMessageId === "string" ? bag.findingsMessageId : undefined,
          threadId: asText(bag.correlationId),
          nodeId: node.id,
          planItemId: node.id,
          kind: "publish",
          status: "done",
          topic: "task.response",
          correlationId: asText(bag.correlationId),
          content: agentMessageContent(`Final response published on task.response for ${mention(routerId)} and ${mention(investigatorId)}:\n\n`, bag.response),
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
  const seedAgentId = ownerForTemplate(nodes, "seed", "seed_agent");
  const researchAgentId = ownerForTemplate(nodes, "research", "research_agent");
  const criticAgentId = ownerForTemplate(nodes, "converge", "critic_agent");
  let completedNodes = 0;

  for (const node of nodes) {
      completedNodes = await runNode(context, modeSpec, node, totalActiveNodes, completedNodes, async () => {
        if (node.template === "seed") {
        const agentId = node.ownerAgentId ?? seedAgentId;
        bag.seed = await context.callAgent({
          agentId,
          planItemId: node.id,
          title: titleForNode(node, "Seed shared board"),
          prompt: promptTemplate(
            node,
            runtimeFallbackPrompt(modeSpec.family, node.template),
            bag,
          ),
          system: context.systemPrompt("You are the seed agent. Seed the shared board with the initial hypothesis."),
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
          toAgentIds: [researchAgentId],
          threadId: "shared-state:board",
          nodeId: node.id,
          planItemId: node.id,
          kind: "mention",
          status: "done",
          content: agentMessageContent(`${mention(researchAgentId)} shared board seeded; add findings from this starting point:\n\n`, bag.seed),
        }).id;
        return bag.seed;
      }

      if (node.template === "research") {
        const agentId = node.ownerAgentId ?? researchAgentId;
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
          system: context.systemPrompt("You are the research agent. Add a meaningful finding to the shared board."),
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
          toAgentIds: [criticAgentId],
          replyToId: typeof bag.seedMessageId === "string" ? bag.seedMessageId : undefined,
          threadId: "shared-state:board",
          nodeId: node.id,
          planItemId: node.id,
          kind: "reply",
          status: "done",
          content: agentMessageContent(`${mention(criticAgentId)} findings added to the board:\n\n`, bag.research),
        }).id;
        return bag.research;
      }

      if (node.template === "converge") {
        const agentId = node.ownerAgentId ?? criticAgentId;
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
          system: context.systemPrompt("You are the critic agent. Decide whether the shared board has converged."),
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
          toAgentIds: [seedAgentId, researchAgentId],
          replyToId: typeof bag.researchMessageId === "string" ? bag.researchMessageId : undefined,
          threadId: "shared-state:board",
          nodeId: node.id,
          planItemId: node.id,
          kind: "reply",
          status: "done",
          content: agentMessageContent(`Board convergence reviewed for ${mention(seedAgentId)} and ${mention(researchAgentId)}:\n\n`, bag.convergence),
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
