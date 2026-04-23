import type {
  CoordinationPattern,
  QueueSummary,
  SharedStateSummary,
  BusStats,
} from "@ora/shared";

export interface PatternExecutionContext {
  projectId: string;
  queueSummary: QueueSummary;
  sharedStateSummary: SharedStateSummary;
  busStats: BusStats;
  systemPrompt(extra: string): string;
  setPlanStatus(templateId: string, status: "planned" | "ready" | "running" | "blocked" | "done" | "failed" | "skipped"): void;
  setQueueSummary(patch: Partial<QueueSummary>): void;
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

function correlationId(base: string): string {
  return `${base}-${Math.random().toString(36).slice(2, 8)}`;
}

const generatorVerifierDriver: PatternDriver = {
  id: "generator_verifier",
  async execute(context, prompt) {
    const rubric = [
      "addresses the user request",
      "uses explicit verification criteria",
      "stays bounded and inspectable",
    ];
    let candidate = "";
    let verifierNotes = "";
    let verdict: "pass" | "fail" = "fail";

    for (let attempt = 1; attempt <= 3; attempt++) {
      context.setPlanStatus("draft", "running");
      candidate = await context.callAgent({
        agentId: "generator",
        planItemId: "draft",
        title: `Draft attempt ${attempt}`,
        prompt: `Prompt: ${prompt}\nAttempt: ${attempt}\nWrite a candidate answer that can be verified against an explicit rubric.`,
        system: context.systemPrompt("You are the generator. Produce a concrete candidate answer."),
      });
      context.setPlanStatus("draft", "done");

      context.setPlanStatus("verify", "running");
      verifierNotes = await context.callAgent({
        agentId: "verifier",
        planItemId: "verify",
        title: `Verify attempt ${attempt}`,
        prompt: `Original prompt: ${prompt}\nRubric:\n- ${rubric.join("\n- ")}\nCandidate:\n${candidate}\nReturn concise verification notes.`,
        system: context.systemPrompt("You are the verifier. Evaluate the candidate against the explicit rubric."),
      });
      verdict = attempt >= 2 ? "pass" : "fail";
      context.setPlanStatus("verify", verdict === "pass" ? "done" : "ready");

      context.remember({
        id: `generator-verifier-${attempt}`,
        namespace: ["session", context.projectId, "generator_verifier"],
        kind: "session",
        value: { attempt, candidate, verifierNotes, verdict, rubric },
      });

      if (verdict === "pass") {
        break;
      }
    }

    return {
      output: {
        text: `Verified candidate for: ${prompt}`,
        pattern: "generator_verifier",
        generator: { candidate },
        verifier: { verdict, notes: verifierNotes, rubric },
      },
    };
  },
};

const orchestratorSubagentDriver: PatternDriver = {
  id: "orchestrator_subagent",
  async execute(context, prompt) {
    context.setPlanStatus("decompose", "running");
    const plan = await context.callAgent({
      agentId: "orchestrator",
      planItemId: "decompose",
      title: "Decompose work",
      prompt: `Task: ${prompt}\nDecompose it into research, review, and synthesis responsibilities.`,
      system: context.systemPrompt("You are the orchestrator. Keep delegation explicit and inspectable."),
    });
    context.setPlanStatus("decompose", "done");

    context.setPlanStatus("research", "running");
    const research = await context.callAgent({
      agentId: "researcher",
      planItemId: "research",
      title: "Research context",
      prompt: `Task: ${prompt}\nGather focused supporting context for the orchestration plan:\n${plan}`,
      system: context.systemPrompt("You are the research subagent. Return concise findings."),
    });
    context.setPlanStatus("research", "done");

    context.setPlanStatus("review", "running");
    const review = await context.callAgent({
      agentId: "reviewer",
      planItemId: "review",
      title: "Review risks",
      prompt: `Task: ${prompt}\nPlan:\n${plan}\nResearch:\n${research}\nReview completeness, risks, and missing pieces.`,
      system: context.systemPrompt("You are the review subagent. Surface risks and gaps."),
    });
    context.setPlanStatus("review", "done");

    context.setPlanStatus("synthesize", "running");
    const synthesis = await context.callAgent({
      agentId: "orchestrator",
      planItemId: "synthesize",
      title: "Synthesize result",
      prompt: `Task: ${prompt}\nPlan:\n${plan}\nResearch:\n${research}\nReview:\n${review}\nProduce the final orchestrated answer.`,
      system: context.systemPrompt("You are the orchestrator. Synthesize delegated results into one answer."),
    });
    context.setPlanStatus("synthesize", "done");

    context.remember({
      id: "orchestrator-subagent-result",
      namespace: ["session", context.projectId, "orchestrator_subagent"],
      kind: "session",
      value: { plan, research, review, synthesis },
    });

    return {
      output: {
        text: synthesis,
        pattern: "orchestrator_subagent",
        orchestrator: {
          decomposition: ["research", "review", "synthesize"],
          plan,
        },
        subagents: {
          researcher: research,
          reviewer: review,
        },
      },
    };
  },
};

const agentTeamsDriver: PatternDriver = {
  id: "agent_teams",
  async execute(context, prompt) {
    context.setQueueSummary({ mode: "backlog", pending: 3, inProgress: 0, completed: 0 });

    context.setPlanStatus("triage", "running");
    const triage = await context.callAgent({
      agentId: "team_lead",
      planItemId: "triage",
      title: "Triage backlog",
      prompt: `Task: ${prompt}\nBreak the work into a team backlog with explicit ownership.`,
      system: context.systemPrompt("You are the team lead. Create a compact backlog."),
    });
    context.setPlanStatus("triage", "done");
    context.setQueueSummary({ pending: 2, completed: 1 });

    context.claimWorker("builder");
    context.setPlanStatus("build", "running");
    const build = await context.callAgent({
      agentId: "builder",
      planItemId: "build",
      title: "Build assigned work",
      prompt: `Task: ${prompt}\nBacklog:\n${triage}\nComplete the builder's assigned work.`,
      system: context.systemPrompt("You are the persistent builder teammate. Complete the assigned work."),
    });
    context.remember({
      id: "builder-memory",
      namespace: ["worker", context.projectId, "builder"],
      kind: "worker",
      value: { summary: build },
    });
    context.setPlanStatus("build", "done");
    context.releaseWorker("builder");
    context.setQueueSummary({ pending: 1, completed: 2 });

    context.claimWorker("checker");
    context.setPlanStatus("check", "running");
    const check = await context.callAgent({
      agentId: "checker",
      planItemId: "check",
      title: "Validate assigned work",
      prompt: `Task: ${prompt}\nBacklog:\n${triage}\nBuilder output:\n${build}\nValidate the work and report issues or approval.`,
      system: context.systemPrompt("You are the persistent checker teammate. Validate the assigned work."),
    });
    context.remember({
      id: "checker-memory",
      namespace: ["worker", context.projectId, "checker"],
      kind: "worker",
      value: { summary: check },
    });
    context.setPlanStatus("check", "done");
    context.releaseWorker("checker");

    context.setPlanStatus("handoff", "running");
    const handoff = await context.callAgent({
      agentId: "team_lead",
      planItemId: "handoff",
      title: "Record handoff",
      prompt: `Task: ${prompt}\nBacklog:\n${triage}\nBuilder:\n${build}\nChecker:\n${check}\nRecord the handoff and next action.`,
      system: context.systemPrompt("You are the team lead. Summarize the handoff and next steps."),
    });
    context.setPlanStatus("handoff", "done");
    context.setQueueSummary({ pending: 0, completed: 4 });

    return {
      output: {
        text: handoff,
        pattern: "agent_teams",
        backlog: ["triage", "build", "check", "handoff"],
        triage,
        workers: {
          builder: build,
          checker: check,
        },
      },
    };
  },
};

const messageBusDriver: PatternDriver = {
  id: "message_bus",
  async execute(context, prompt) {
    const messageCorrelation = correlationId("bus");
    context.setQueueSummary({ mode: "event_bus", pending: 3, inProgress: 0, completed: 0, topics: ["task.input", "task.findings", "task.response"] });
    context.publishMessage({
      agentId: "router",
      topic: "task.input",
      correlationId: messageCorrelation,
      summary: `Published input event for: ${prompt}`,
      payload: { prompt },
    });

    context.setPlanStatus("publish", "done");
    context.setPlanStatus("route", "running");
    const routingPlan = await context.callAgent({
      agentId: "router",
      planItemId: "route",
      title: "Route event",
      prompt: `Task: ${prompt}\nClassify the incoming event and decide which topic/subscriber should receive it.`,
      system: context.systemPrompt("You are the router. Route work explicitly to the correct subscriber."),
    });
    context.routeMessage({
      agentId: "router",
      fromTopic: "task.input",
      toTopic: "task.findings",
      correlationId: messageCorrelation,
      summary: routingPlan,
    });
    context.setPlanStatus("route", "done");
    context.setQueueSummary({ pending: 2, completed: 2 });

    context.setPlanStatus("handle", "running");
    const findings = await context.callAgent({
      agentId: "investigator",
      planItemId: "handle",
      title: "Handle routed work",
      prompt: `Task: ${prompt}\nRouting plan:\n${routingPlan}\nProduce the investigation findings for the subscribed work item.`,
      system: context.systemPrompt("You are the investigator. Produce findings for the routed event."),
    });
    context.publishMessage({
      agentId: "investigator",
      topic: "task.findings",
      correlationId: messageCorrelation,
      summary: findings,
      payload: { findings },
    });
    context.setPlanStatus("handle", "done");
    context.setQueueSummary({ pending: 1, completed: 3 });

    context.setPlanStatus("respond", "running");
    const response = await context.callAgent({
      agentId: "responder",
      planItemId: "respond",
      title: "Publish response",
      prompt: `Task: ${prompt}\nRouting plan:\n${routingPlan}\nFindings:\n${findings}\nProduce the final routed response.`,
      system: context.systemPrompt("You are the responder. Publish the final bus response."),
    });
    context.publishMessage({
      agentId: "responder",
      topic: "task.response",
      correlationId: messageCorrelation,
      summary: response,
      payload: { response },
    });
    context.setPlanStatus("respond", "done");
    context.setQueueSummary({ pending: 0, completed: 4 });

    return {
      output: {
        text: response,
        pattern: "message_bus",
        routingPlan,
        findings,
        response,
        correlationId: messageCorrelation,
      },
    };
  },
};

const sharedStateDriver: PatternDriver = {
  id: "shared_state",
  async execute(context, prompt) {
    context.setQueueSummary({ mode: "shared_state", pending: 3, completed: 0 });

    context.setPlanStatus("seed", "running");
    const seed = await context.callAgent({
      agentId: "seed_agent",
      planItemId: "seed",
      title: "Seed shared board",
      prompt: `Task: ${prompt}\nCreate the initial shared-state board for collaborative work.`,
      system: context.systemPrompt("You are the seed agent. Seed the shared board with the initial hypothesis."),
    });
    context.writeSharedState({
      agentId: "seed_agent",
      key: "seed",
      summary: seed,
      value: { prompt, seed },
    });
    context.setPlanStatus("seed", "done");
    context.setQueueSummary({ pending: 2, completed: 1 });

    context.setPlanStatus("research", "running");
    const research = await context.callAgent({
      agentId: "research_agent",
      planItemId: "research",
      title: "Contribute findings",
      prompt: `Task: ${prompt}\nCurrent shared board:\n${JSON.stringify(context.currentSharedState().entries)}\nAdd the next finding that other agents should build on.`,
      system: context.systemPrompt("You are the research agent. Add a meaningful finding to the shared board."),
    });
    context.writeSharedState({
      agentId: "research_agent",
      key: "finding-1",
      summary: research,
      value: { research },
    });
    context.setPlanStatus("research", "done");
    context.setQueueSummary({ pending: 1, completed: 2 });

    context.setPlanStatus("converge", "running");
    const convergence = await context.callAgent({
      agentId: "critic_agent",
      planItemId: "converge",
      title: "Review convergence",
      prompt: `Task: ${prompt}\nShared board:\n${JSON.stringify(context.currentSharedState().entries)}\nDecide whether the board has converged and summarize the conclusion.`,
      system: context.systemPrompt("You are the critic agent. Decide whether the shared board has converged."),
    });
    context.writeSharedState({
      agentId: "critic_agent",
      key: "convergence",
      summary: convergence,
      value: { convergence, stopReason: "converged" },
    });
    context.setPlanStatus("converge", "done");
    context.setQueueSummary({ pending: 0, completed: 3 });

    return {
      output: {
        text: convergence,
        pattern: "shared_state",
        board: context.currentSharedState().entries,
        convergence,
      },
    };
  },
};

const DRIVER_REGISTRY: Record<CoordinationPattern, PatternDriver> = {
  generator_verifier: generatorVerifierDriver,
  orchestrator_subagent: orchestratorSubagentDriver,
  agent_teams: agentTeamsDriver,
  message_bus: messageBusDriver,
  shared_state: sharedStateDriver,
};

export function getPatternDriver(pattern: CoordinationPattern): PatternDriver {
  return DRIVER_REGISTRY[pattern];
}
