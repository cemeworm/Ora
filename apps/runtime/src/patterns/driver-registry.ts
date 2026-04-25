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
  }): unknown;
  claimWorker(agentId: string): void;
  releaseWorker(agentId: string): void;
  callAgent(params: {
    agentId: string;
    planItemId?: string;
    title: string;
    prompt: string;
    system: string;
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
      context.ensureClarification({
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

  for (let attempt = 1; attempt <= maxIterations; attempt += 1) {
    bag.retryCount = attempt;
    let completedNodes = 0;
    for (const node of nodes) {
      completedNodes = await runNode(context, modeSpec, node, totalActiveNodes, completedNodes, async () => {
        if (node.template === "draft") {
          const candidate = await context.callAgent({
            agentId: node.ownerAgentId ?? "generator",
            planItemId: node.id,
            title: titleForNode(node, `Draft attempt ${attempt}`),
            prompt: promptTemplate(
              node,
              runtimeFallbackPrompt(modeSpec.family, node.template),
              { ...bag, attempt },
            ),
            system: context.systemPrompt("You are the generator. Produce a concrete candidate answer."),
            riskLevel: node.riskLevel,
          });
          bag.candidate = candidate;
          return candidate;
        }

        if (node.template === "verify") {
          const verifierNotes = await context.callAgent({
            agentId: node.ownerAgentId ?? "verifier",
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
          riskLevel: node.riskLevel,
          });
          return bag.review;
        }

      if (node.template === "synthesize") {
        bag.synthesis = await context.callAgent({
          agentId: node.ownerAgentId ?? "orchestrator",
          planItemId: node.id,
          title: titleForNode(node, "Synthesize result"),
          prompt: promptTemplate(
            node,
            runtimeFallbackPrompt(modeSpec.family, node.template),
            bag,
          ),
          system: context.systemPrompt(
            singleOwnerMode
              ? "You are the solo agent. Use your framing notes and produce the final answer directly."
              : "You are the orchestrator. Synthesize delegated results into one answer."
          ),
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
  let completedNodes = 0;

  for (const node of nodes) {
      completedNodes = await runNode(context, modeSpec, node, totalActiveNodes, completedNodes, async () => {
        if (node.template === "triage") {
          bag.triage = await context.callAgent({
          agentId: node.ownerAgentId ?? "team_lead",
          planItemId: node.id,
          title: titleForNode(node, "Triage backlog"),
          prompt: promptTemplate(
            node,
            runtimeFallbackPrompt(modeSpec.family, node.template),
            bag,
          ),
          system: context.systemPrompt("You are the team lead. Create a compact backlog."),
          riskLevel: node.riskLevel,
          });
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
            riskLevel: node.riskLevel,
          });
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
            riskLevel: node.riskLevel,
          });
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
        bag.handoff = await context.callAgent({
          agentId: node.ownerAgentId ?? "team_lead",
          planItemId: node.id,
          title: titleForNode(node, "Record handoff"),
          prompt: promptTemplate(
            node,
            runtimeFallbackPrompt(modeSpec.family, node.template),
            bag,
          ),
          system: context.systemPrompt("You are the team lead. Summarize the handoff and next steps."),
          riskLevel: node.riskLevel,
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
  let completedNodes = 0;

  for (const node of nodes) {
      completedNodes = await runNode(context, modeSpec, node, totalActiveNodes, completedNodes, async () => {
        if (node.template === "publish") {
        context.publishMessage({
          agentId: node.ownerAgentId ?? "router",
          topic: "task.input",
          correlationId: asText(bag.correlationId),
          summary: `Published input event for: ${prompt}`,
          payload: { prompt },
        });
        bag.publish = `Published input event for: ${prompt}`;
        return bag.publish;
      }

      if (node.template === "route") {
        bag.routingPlan = await context.callAgent({
          agentId: node.ownerAgentId ?? "router",
          planItemId: node.id,
          title: titleForNode(node, "Route event"),
          prompt: promptTemplate(
            node,
            runtimeFallbackPrompt(modeSpec.family, node.template),
            bag,
          ),
          system: context.systemPrompt("You are the router. Route work explicitly to the correct subscriber."),
          riskLevel: node.riskLevel,
        });
        context.routeMessage({
          agentId: node.ownerAgentId ?? "router",
          fromTopic: "task.input",
          toTopic: "task.findings",
          correlationId: asText(bag.correlationId),
          summary: asText(bag.routingPlan),
        });
        return bag.routingPlan;
      }

      if (node.template === "handle") {
        bag.findings = await context.callAgent({
          agentId: node.ownerAgentId ?? "investigator",
          planItemId: node.id,
          title: titleForNode(node, "Handle routed work"),
          prompt: promptTemplate(
            node,
            runtimeFallbackPrompt(modeSpec.family, node.template),
            bag,
          ),
          system: context.systemPrompt("You are the investigator. Produce findings for the routed event."),
          riskLevel: node.riskLevel,
        });
        context.publishMessage({
          agentId: node.ownerAgentId ?? "investigator",
          topic: "task.findings",
          correlationId: asText(bag.correlationId),
          summary: asText(bag.findings),
          payload: { findings: bag.findings },
        });
        return bag.findings;
      }

      if (node.template === "respond") {
        bag.response = await context.callAgent({
          agentId: node.ownerAgentId ?? "responder",
          planItemId: node.id,
          title: titleForNode(node, "Publish response"),
          prompt: promptTemplate(
            node,
            runtimeFallbackPrompt(modeSpec.family, node.template),
            bag,
          ),
          system: context.systemPrompt("You are the responder. Publish the final bus response."),
          riskLevel: node.riskLevel,
        });
        context.publishMessage({
          agentId: node.ownerAgentId ?? "responder",
          topic: "task.response",
          correlationId: asText(bag.correlationId),
          summary: asText(bag.response),
          payload: { response: bag.response },
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
  let completedNodes = 0;

  for (const node of nodes) {
      completedNodes = await runNode(context, modeSpec, node, totalActiveNodes, completedNodes, async () => {
        if (node.template === "seed") {
        bag.seed = await context.callAgent({
          agentId: node.ownerAgentId ?? "seed_agent",
          planItemId: node.id,
          title: titleForNode(node, "Seed shared board"),
          prompt: promptTemplate(
            node,
            runtimeFallbackPrompt(modeSpec.family, node.template),
            bag,
          ),
          system: context.systemPrompt("You are the seed agent. Seed the shared board with the initial hypothesis."),
          riskLevel: node.riskLevel,
        });
        context.writeSharedState({
          agentId: node.ownerAgentId ?? "seed_agent",
          key: "seed",
          summary: asText(bag.seed),
          value: { prompt, seed: bag.seed },
        });
        return bag.seed;
      }

      if (node.template === "research") {
        bag.research = await context.callAgent({
          agentId: node.ownerAgentId ?? "research_agent",
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
          riskLevel: node.riskLevel,
        });
        context.writeSharedState({
          agentId: node.ownerAgentId ?? "research_agent",
          key: "finding-1",
          summary: asText(bag.research),
          value: { research: bag.research },
        });
        return bag.research;
      }

      if (node.template === "converge") {
        bag.convergence = await context.callAgent({
          agentId: node.ownerAgentId ?? "critic_agent",
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
          riskLevel: node.riskLevel,
        });
        context.writeSharedState({
          agentId: node.ownerAgentId ?? "critic_agent",
          key: "convergence",
          summary: asText(bag.convergence),
          value: { convergence: bag.convergence, stopReason: "converged" },
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
