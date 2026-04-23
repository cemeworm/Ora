import { describe, expect, it } from "vitest";
import {
  AgentProfileSchema,
  ApprovalDecisionSchema,
  ApprovalRequestSchema,
  DEFAULT_PROVIDERS,
  EvaluationAttemptSchema,
  EvaluationBaselineSchema,
  EvaluationDatasetDetailSchema,
  EvaluationDatasetSchema,
  EvaluationExportResultSchema,
  EvaluationImportParamsSchema,
  EvaluationRunDetailSchema,
  EvaluationRunSchema,
  EvaluationRunStreamSchema,
  EvaluationScorecardSchema,
  EvaluationSpecSchema,
  JsonRpcRequestSchema,
  JsonRpcResponseSchema,
  MVP_PATTERNS,
  MVP_TOOLS,
  MemoryRecordSchema,
  OraEventEnvelopeSchema,
  PatternDefinitionSchema,
  PlanItemSchema,
  PolicyDecisionSchema,
  ProjectConfigSchema,
  ProviderConfigSchema,
  ProviderRegistrySchema,
  ProviderSecretStatusSchema,
  ProviderSecretWriteSchema,
  ResourceBudgetSchema,
  RuntimeBootstrapSchema,
  RunConfigSchema,
  RunEventStreamSchema,
  RunForkParamsSchema,
  RunHandleSchema,
  RunReplayParamsSchema,
  RunResumeParamsSchema,
  RunSummarySchema,
  SessionConfigSchema,
  SessionCreateParamsSchema,
  SessionDetailSchema,
  SessionGetParamsSchema,
  SessionSummarySchema,
  SessionTranscriptMessageSchema,
  SessionTurnSchema,
  SkillRegistrySchema,
  ToolDescriptorSchema,
  ToolRegistrySchema
} from "../src/index.js";

describe("Ora shared contracts", () => {
  it("validates all MVP pattern fixtures", () => {
    expect(MVP_PATTERNS).toHaveLength(5);
    expect(MVP_PATTERNS.map((pattern) => pattern.id)).toEqual([
      "generator_verifier",
      "orchestrator_subagent",
      "agent_teams",
      "message_bus",
      "shared_state"
    ]);

    for (const pattern of MVP_PATTERNS) {
      expect(PatternDefinitionSchema.parse(pattern).id).toBe(pattern.id);
      expect(pattern.topology.nodes.length).toBeGreaterThan(1);
      expect(pattern.planTemplate.length).toBeGreaterThan(0);
      expect(typeof pattern.supportsPersistentWorkers).toBe("boolean");
      expect(typeof pattern.supportsSharedState).toBe("boolean");
      expect(typeof pattern.supportsEventRouting).toBe("boolean");
      expect(pattern.defaultStopPolicy.type).toBeTruthy();
      expect(pattern.defaultStopPolicy.detail.length).toBeGreaterThan(0);
    }
  });

  it("defaults run config to the product default pattern", () => {
    const config = RunConfigSchema.parse({});

    expect(config.pattern).toBe("orchestrator_subagent");
    expect(config.modelRef).toBe("local/smoke-model");
    expect(config.providerId).toBeUndefined();
    expect(config.providerConfig).toBeUndefined();
    expect(config.skillIds).toEqual([]);
    expect(config.toolIds).toEqual([]);
    expect(config.approvalMode).toBe("high_risk_only");
    expect(config.patternOptions).toEqual({});
  });

  it("accepts a run-scoped custom provider config", () => {
    const config = RunConfigSchema.parse({
      providerId: "openrouter",
      providerConfig: {
        id: "openrouter",
        type: "openai_compatible",
        label: "OpenRouter",
        modelId: "anthropic/claude-sonnet-4.5",
        baseUrl: "https://openrouter.ai/api/v1",
        apiKeyEnv: "OPENROUTER_API_KEY",
      },
    });

    expect(config.providerConfig?.type).toBe("openai_compatible");
    expect(config.providerConfig?.capabilities).toEqual(["chat"]);
  });

  it("validates capability records and event envelopes", () => {
    const budget = {
      maxTokens: 1000,
      maxToolCalls: 2,
      maxRuntimeMs: 10000
    };
    const profile = AgentProfileSchema.parse({
      id: "reviewer",
      label: "Reviewer",
      role: "Check work",
      modelRef: "local/smoke-model",
      toolPolicyId: "default",
      memoryNamespaces: ["session"],
      budget
    });

    const planItem = PlanItemSchema.parse({
      id: "plan-1",
      runId: "run-1",
      ownerAgentId: profile.id,
      status: "ready",
      title: "Check the answer",
      dependencies: [],
      linkedActionIds: [],
      checkpointIds: []
    });

    const memory = MemoryRecordSchema.parse({
      id: "mem-1",
      namespace: ["session", "run-1"],
      kind: "session",
      value: { planItemId: planItem.id },
      createdAt: 1,
      updatedAt: 1
    });

    const event = OraEventEnvelopeSchema.parse({
      id: "evt-1",
      runId: "run-1",
      seq: 0,
      type: "action.updated",
      createdAt: 1,
      pattern: "orchestrator_subagent",
      payload: { memoryId: memory.id }
    });

    expect(event.payload).toEqual({ memoryId: "mem-1" });

    const decision = PolicyDecisionSchema.parse({
      id: "policy-1",
      runId: "run-1",
      actionId: "action-1",
      policyId: "default",
      requiredApproval: true,
      reason: "High-risk action requires approval.",
      createdAt: 1
    });

    expect(decision.requiredApproval).toBe(true);
  });

  it("validates JSON-RPC request and response shapes", () => {
    expect(
      JsonRpcRequestSchema.parse({
        jsonrpc: "2.0",
        id: 1,
        method: "runtime.health"
      }).method
    ).toBe("runtime.health");

    expect(
      JsonRpcResponseSchema.parse({
        jsonrpc: "2.0",
        id: 1,
        result: { ok: true }
      }).jsonrpc
    ).toBe("2.0");
  });

  it("validates second milestone run API contracts", () => {
    const summary = RunSummarySchema.parse({
      runId: "run-1",
      status: "succeeded",
      pattern: "orchestrator_subagent",
      prompt: "Summarize the run.",
      startedAt: 1,
      updatedAt: 2,
      eventCount: 3,
      checkpointCount: 1,
      artifactCount: 1
    });
    const event = OraEventEnvelopeSchema.parse({
      id: "evt-2",
      runId: summary.runId,
      seq: 2,
      type: "run.resumed",
      createdAt: 2,
      pattern: summary.pattern,
      payload: { patch: {} }
    });

    expect(
      RunEventStreamSchema.parse({
        runId: summary.runId,
        fromSeq: 2,
        events: [event],
        nextSeq: 3
      }).events[0]?.type
    ).toBe("run.resumed");
    expect(RunResumeParamsSchema.parse({ runId: summary.runId }).runId).toBe(summary.runId);
    expect(
      RunForkParamsSchema.parse({
        runId: summary.runId,
        checkpointId: "checkpoint-1"
      }).checkpointId
    ).toBe("checkpoint-1");
    expect(
      RunReplayParamsSchema.parse({
        runId: summary.runId,
        checkpointId: "checkpoint-1"
      }).runId
    ).toBe(summary.runId);
  });

  it("validates evaluation dataset/run contracts", () => {
    const importParams = EvaluationImportParamsSchema.parse({
      name: "Smoke Dataset",
      sourceFileName: "smoke.json",
      sourceFormat: "json",
      content: JSON.stringify([{ id: "case-1", prompt: "Evaluate me", expected: "done" }]),
    });
    expect(importParams.sourceFormat).toBe("json");

    const dataset = EvaluationDatasetSchema.parse({
      id: "dataset-0001",
      name: "Smoke Dataset",
      sourceFormat: "json",
      schemaVersion: 1,
      caseCount: 1,
      tags: ["smoke"],
      createdAt: 1,
      updatedAt: 1,
    });
    const detail = EvaluationDatasetDetailSchema.parse({
      dataset,
      cases: [{
        id: "case-1",
        input: { prompt: "Evaluate me", context: {} },
        expected: { text: "done" },
        metadata: { difficulty: "easy", tags: ["smoke"] },
      }],
      metadataKeys: ["difficulty", "tags"],
      tagCounts: { smoke: 1 },
    });
    expect(detail.cases).toHaveLength(1);

    const spec = EvaluationSpecSchema.parse({
      datasetId: dataset.id,
      profileId: "outcome",
      configs: [{
        id: "orchestrator",
        label: "Orchestrator",
        runConfig: { pattern: "orchestrator_subagent", modelRef: "local/smoke-model" },
      }],
      repetitions: 1,
      concurrency: 1,
    });

    const attempt = EvaluationAttemptSchema.parse({
      id: "eval-run-0001:attempt:1",
      evaluationRunId: "eval-run-0001",
      caseId: "case-1",
      configId: "orchestrator",
      repetition: 1,
      status: "succeeded",
      underlyingRunId: "run-0001",
      output: { text: "done" },
      score: {
        outcomeScore: 1,
        processScore: 0.8,
        efficiencyScore: 0.9,
        safetyScore: 0.95,
        overallScore: 0.94,
        judgeRationale: "Looks good.",
        failureTags: [],
      },
      runtimeMs: 1200,
      costUsd: 0.0012,
      startedAt: 1,
      updatedAt: 2,
    });
    expect(attempt.underlyingRunId).toBe("run-0001");

    const run = EvaluationRunSchema.parse({
      id: "eval-run-0001",
      spec,
      status: "succeeded",
      totalAttempts: 1,
      completedAttempts: 1,
      failedAttempts: 0,
      attemptIds: [attempt.id],
      caseResults: [{
        caseId: "case-1",
        configId: "orchestrator",
        attemptIds: [attempt.id],
        averageScore: attempt.score,
        latestOutput: attempt.output,
        expected: { text: "done" },
        metadata: { difficulty: "easy", tags: ["smoke"] },
        traceRunIds: ["run-0001"],
      }],
      scorecard: {
        overallScore: 0.94,
        passRate: 1,
        averageRuntimeMs: 1200,
        averageCostUsd: 0.0012,
        regressionCount: 0,
        configSummaries: [{
          configId: "orchestrator",
          label: "Orchestrator",
          overallScore: 0.94,
          passRate: 1,
          averageRuntimeMs: 1200,
          averageCostUsd: 0.0012,
          caseCount: 1,
          regressionCount: 0,
          failureTagCounts: {},
        }],
        slices: [{
          dimension: "difficulty",
          value: "easy",
          configId: "orchestrator",
          caseCount: 1,
          overallScore: 0.94,
        }],
      },
      startedAt: 1,
      updatedAt: 2,
      completedAt: 2,
    });
    const detailRun = EvaluationRunDetailSchema.parse({
      run,
      attempts: [attempt],
      dataset,
      configs: spec.configs,
    });
    expect(detailRun.run.id).toBe("eval-run-0001");
    expect(EvaluationScorecardSchema.parse(run.scorecard).overallScore).toBe(0.94);
    expect(EvaluationRunStreamSchema.parse({
      evaluationRunId: run.id,
      fromSeq: 0,
      events: [{
        id: `${run.id}:evt-0`,
        evaluationRunId: run.id,
        seq: 0,
        type: "evaluation.run.started",
        createdAt: 1,
        payload: { datasetId: dataset.id },
      }],
      nextSeq: 1,
    }).events[0]?.type).toBe("evaluation.run.started");
    expect(EvaluationBaselineSchema.parse({
      id: "baseline-0001",
      name: "Smoke baseline",
      datasetId: dataset.id,
      profileId: "outcome",
      configId: "orchestrator",
      configSignature: "{\"pattern\":\"orchestrator_subagent\"}",
      evaluationRunId: run.id,
      createdAt: 2,
    }).id).toBe("baseline-0001");
    expect(EvaluationExportResultSchema.parse({
      evaluationRunId: run.id,
      format: "json",
      content: "{}",
    }).format).toBe("json");
  });
});

// ---------------------------------------------------------------------------
// Milestone 3: Provider, Tool, Session, Approval schemas
// ---------------------------------------------------------------------------

describe("ProviderConfigSchema", () => {
  const validProvider = {
    id: "anthropic-claude",
    type: "anthropic",
    label: "Claude",
    modelId: "claude-sonnet-4-20250514",
    maxTokens: 8192
  };

  it("accepts a valid provider config", () => {
    const parsed = ProviderConfigSchema.parse(validProvider);
    expect(parsed.id).toBe("anthropic-claude");
    expect(parsed.type).toBe("anthropic");
    expect(parsed.baseUrl).toBeUndefined();
  });

  it("accepts a provider config with all optional fields", () => {
    const parsed = ProviderConfigSchema.parse({
      ...validProvider,
      baseUrl: "https://api.anthropic.com",
      apiKeyEnv: "ANTHROPIC_API_KEY",
      temperature: 0.7,
      contextWindow: 200000,
      capabilities: ["chat", "tool_use"],
      dropParams: ["stop"],
      timeoutMs: 30000
    });
    expect(parsed.baseUrl).toBe("https://api.anthropic.com");
    expect(parsed.apiKeyEnv).toBe("ANTHROPIC_API_KEY");
    expect(parsed.temperature).toBe(0.7);
    expect(parsed.capabilities).toEqual(["chat", "tool_use"]);
    expect(parsed.dropParams).toEqual(["stop"]);
    expect(parsed.timeoutMs).toBe(30000);
  });

  it("accepts an OpenAI-compatible custom provider", () => {
    const parsed = ProviderConfigSchema.parse({
      id: "openrouter",
      type: "openai_compatible",
      label: "OpenRouter",
      modelId: "openai/gpt-4o-mini",
      baseUrl: "https://openrouter.ai/api/v1",
      apiKeyEnv: "OPENROUTER_API_KEY",
    });

    expect(parsed.enabled).toBe(true);
    expect(parsed.capabilities).toEqual(["chat"]);
  });

  it("rejects an invalid provider type", () => {
    expect(() =>
      ProviderConfigSchema.parse({ ...validProvider, type: "invalid_provider" })
    ).toThrow();
  });

  it("rejects missing required fields", () => {
    expect(() => ProviderConfigSchema.parse({ type: "anthropic" })).toThrow();
  });

  it("rejects an empty id", () => {
    expect(() =>
      ProviderConfigSchema.parse({ ...validProvider, id: "" })
    ).toThrow();
  });
});

describe("ProviderRegistrySchema", () => {
  it("accepts a valid provider registry", () => {
    const parsed = ProviderRegistrySchema.parse({
      providers: [
        { id: "p1", type: "anthropic", label: "Claude", modelId: "claude-sonnet-4-20250514" }
      ],
      defaultProviderId: "p1"
    });
    expect(parsed.providers).toHaveLength(1);
    expect(parsed.defaultProviderId).toBe("p1");
  });

  it("rejects an empty defaultProviderId", () => {
    expect(() =>
      ProviderRegistrySchema.parse({
        providers: [],
        defaultProviderId: ""
      })
    ).toThrow();
  });
});

describe("ProviderSecret schemas", () => {
  it("accepts keychain-backed provider secret status", () => {
    const parsed = ProviderSecretStatusSchema.parse({
      providerId: "openai-gpt",
      hasSecret: true,
      storage: "keychain",
      keychainService: "ora.provider.openai-gpt",
      detail: "Stored in macOS Keychain."
    });

    expect(parsed.hasSecret).toBe(true);
  });

  it("accepts provider secret write payloads without exposing the secret shape elsewhere", () => {
    const parsed = ProviderSecretWriteSchema.parse({
      providerId: "anthropic-claude",
      secret: "sk-test"
    });

    expect(parsed.providerId).toBe("anthropic-claude");
  });
});

describe("ToolDescriptorSchema", () => {
  const validTool = {
    id: "file.read",
    label: "Read File",
    description: "Read file contents from local filesystem.",
    category: "file",
    riskLevel: "safe",
    requiresApproval: false
  };

  it("accepts a valid tool descriptor", () => {
    const parsed = ToolDescriptorSchema.parse(validTool);
    expect(parsed.id).toBe("file.read");
    expect(parsed.category).toBe("file");
  });

  it("applies defaults for optional fields", () => {
    const parsed = ToolDescriptorSchema.parse(validTool);
    expect(parsed.parameters).toEqual({});
    expect(parsed.allowedForProfiles).toEqual([]);
  });

  it("accepts all valid categories", () => {
    const categories = ["file", "shell", "network", "mcp", "model", "export", "internal"];
    for (const category of categories) {
      const parsed = ToolDescriptorSchema.parse({ ...validTool, category });
      expect(parsed.category).toBe(category);
    }
  });

  it("accepts all valid risk levels", () => {
    const levels = ["safe", "low_risk", "requires_approval"];
    for (const riskLevel of levels) {
      const parsed = ToolDescriptorSchema.parse({ ...validTool, riskLevel });
      expect(parsed.riskLevel).toBe(riskLevel);
    }
  });

  it("rejects an invalid category", () => {
    expect(() =>
      ToolDescriptorSchema.parse({ ...validTool, category: "invalid" })
    ).toThrow();
  });

  it("rejects missing required fields", () => {
    expect(() => ToolDescriptorSchema.parse({ id: "x" })).toThrow();
  });
});

describe("ToolRegistrySchema", () => {
  it("accepts a valid tool registry", () => {
    const parsed = ToolRegistrySchema.parse({
      tools: [
        {
          id: "file.read",
          label: "Read",
          description: "Read files.",
          category: "file",
          riskLevel: "safe"
        }
      ],
      defaultPolicyId: "default-policy"
    });
    expect(parsed.tools).toHaveLength(1);
    expect(parsed.defaultPolicyId).toBe("default-policy");
  });
});

describe("SkillRegistrySchema", () => {
  it("accepts a valid skill registry", () => {
    const parsed = SkillRegistrySchema.parse({
      skills: [
        {
          id: "runtime.default.review",
          name: "Default review",
          description: "Default review instructions.",
          promptSnippet: "Review output for correctness.",
          allowedPatterns: ["orchestrator_subagent", "message_bus"]
        }
      ]
    });
    expect(parsed.skills).toHaveLength(1);
    expect(parsed.skills[0]?.allowedPatterns).toEqual([
      "orchestrator_subagent",
      "message_bus"
    ]);
  });
});

describe("RuntimeBootstrapSchema", () => {
  it("accepts runtime bootstrap payloads with pattern, provider, tool, and skill truth", () => {
    const parsed = RuntimeBootstrapSchema.parse({
      health: {
        ok: true,
        service: "ora-runtime",
        version: "0.1.0",
        mode: "runtime",
        detail: "Ora runtime bootstrap is served from the shared runtime kernel."
      },
      patterns: MVP_PATTERNS,
      providers: {
        providers: DEFAULT_PROVIDERS,
        defaultProviderId: "local-smoke"
      },
      tools: {
        tools: MVP_TOOLS,
        defaultPolicyId: "default-policy"
      },
      skills: {
        skills: [
          {
            id: "runtime.default.review",
            name: "Default review",
            description: "Default review instructions.",
            promptSnippet: "Review output for correctness.",
            allowedPatterns: ["generator_verifier"]
          }
        ]
      }
    });

    expect(parsed.health.mode).toBe("runtime");
    expect(parsed.patterns).toHaveLength(5);
    expect(parsed.tools.tools.length).toBeGreaterThan(0);
    expect(parsed.skills.skills[0]?.id).toBe("runtime.default.review");
  });
});

describe("SessionConfigSchema", () => {
  const validSession = {
    id: "session-1",
    label: "My Session",
    createdAt: 1000,
    updatedAt: 1000
  };

  it("accepts a valid session config with defaults", () => {
    const parsed = SessionConfigSchema.parse(validSession);
    expect(parsed.id).toBe("session-1");
    expect(parsed.defaultPattern).toBe("orchestrator_subagent");
    expect(parsed.approvalMode).toBe("high_risk_only");
    expect(parsed.tools).toEqual([]);
  });

  it("accepts a session config with all fields", () => {
    const parsed = SessionConfigSchema.parse({
      ...validSession,
      projectId: "proj-1",
      defaultProviderId: "anthropic-claude",
      defaultBudget: { maxTokens: 10000, maxToolCalls: 20, maxRuntimeMs: 60000 },
      approvalMode: "manual",
      tools: ["file.read", "file.write"]
    });
    expect(parsed.projectId).toBe("proj-1");
    expect(parsed.approvalMode).toBe("manual");
    expect(parsed.tools).toEqual(["file.read", "file.write"]);
  });

  it("rejects invalid approval mode", () => {
    expect(() =>
      SessionConfigSchema.parse({ ...validSession, approvalMode: "invalid" })
    ).toThrow();
  });

  it("rejects missing required fields", () => {
    expect(() => SessionConfigSchema.parse({ id: "s1" })).toThrow();
  });
});

describe("Session thread contracts", () => {
  it("accepts session create params and session summaries", () => {
    const createParams = SessionCreateParamsSchema.parse({ projectId: "ora-mvp" });
    const summary = SessionSummarySchema.parse({
      sessionId: "session-1",
      title: "New Chat",
      projectId: "ora-mvp",
      turnCount: 0,
      createdAt: 1000,
      updatedAt: 1000,
    });

    expect(createParams.projectId).toBe("ora-mvp");
    expect(summary.turnCount).toBe(0);
    expect(summary.title).toBe("New Chat");
  });

  it("accepts session detail with transcript and latest snapshot", () => {
    const detail = SessionDetailSchema.parse({
      session: {
        sessionId: "session-1",
        title: "Investigate new chat",
        projectId: "ora-mvp",
        status: "succeeded",
        latestRunId: "run-1",
        latestPattern: "orchestrator_subagent",
        turnCount: 1,
        createdAt: 1000,
        updatedAt: 2000,
      },
      turns: [
        {
          runId: "run-1",
          sessionId: "session-1",
          turnIndex: 1,
          status: "succeeded",
          pattern: "orchestrator_subagent",
          providerId: "local-smoke",
          modelRef: "local/smoke-model",
          prompt: "Fix new chat.",
          startedAt: 1000,
          updatedAt: 2000,
          eventCount: 4,
          checkpointCount: 1,
          artifactCount: 0,
        },
      ],
      transcript: [
        {
          id: "run-1:user",
          sessionId: "session-1",
          runId: "run-1",
          turnIndex: 1,
          role: "user",
          content: "Fix new chat.",
          pattern: "orchestrator_subagent",
          createdAt: 1000,
        },
      ],
      latestSnapshot: {
        runId: "run-1",
        sessionId: "session-1",
        turnIndex: 1,
        status: "succeeded",
        pattern: "orchestrator_subagent",
        input: { prompt: "Fix new chat.", context: {}, createdAt: 1000, projectId: "ora-mvp" },
        config: RunConfigSchema.parse({}),
        topology: { nodes: [], edges: [] },
        profiles: [],
        memory: [],
        plan: [],
        actions: [],
        policyDecisions: [],
        checkpoints: [],
        events: [],
        artifacts: [],
        activeAgents: [],
        queueSummary: { mode: "dag", pending: 0, inProgress: 0, completed: 0, topics: [] },
        sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
        busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
        pendingApprovals: [],
        updatedAt: 2000,
      },
    });

    expect(detail.turns[0]?.turnIndex).toBe(1);
    expect(detail.transcript[0]?.role).toBe("user");
    expect(detail.latestSnapshot?.sessionId).toBe("session-1");
  });

  it("accepts run handles and summaries with optional session metadata", () => {
    const handle = RunHandleSchema.parse({
      runId: "run-1",
      sessionId: "session-1",
      turnIndex: 2,
      status: "succeeded",
      pattern: "shared_state",
      startedAt: 1234,
    });
    const summary = RunSummarySchema.parse({
      runId: "run-1",
      sessionId: "session-1",
      turnIndex: 2,
      status: "succeeded",
      pattern: "shared_state",
      prompt: "Continue this session.",
      startedAt: 1234,
      updatedAt: 2345,
      eventCount: 7,
      checkpointCount: 1,
      artifactCount: 0,
    });
    const getParams = SessionGetParamsSchema.parse({ sessionId: "session-1" });
    const turn = SessionTurnSchema.parse({
      runId: "run-1",
      sessionId: "session-1",
      turnIndex: 2,
      status: "succeeded",
      pattern: "shared_state",
      prompt: "Continue this session.",
      startedAt: 1234,
      updatedAt: 2345,
      eventCount: 7,
      checkpointCount: 1,
      artifactCount: 0,
    });
    const transcript = SessionTranscriptMessageSchema.parse({
      id: "run-1:assistant",
      sessionId: "session-1",
      runId: "run-1",
      turnIndex: 2,
      role: "assistant",
      content: "Session continued.",
      pattern: "shared_state",
      createdAt: 2345,
    });

    expect(handle.sessionId).toBe("session-1");
    expect(summary.turnIndex).toBe(2);
    expect(getParams.sessionId).toBe("session-1");
    expect(turn.pattern).toBe("shared_state");
    expect(transcript.role).toBe("assistant");
  });
});

describe("ProjectConfigSchema", () => {
  const validProject = {
    id: "proj-1",
    label: "My Project",
    createdAt: 1000,
    updatedAt: 1000
  };

  it("accepts a valid project config with defaults", () => {
    const parsed = ProjectConfigSchema.parse(validProject);
    expect(parsed.id).toBe("proj-1");
    expect(parsed.sessions).toEqual([]);
    expect(parsed.memoryNamespaces).toEqual([]);
  });

  it("accepts a project config with sessions", () => {
    const parsed = ProjectConfigSchema.parse({
      ...validProject,
      rootPath: "/home/user/project",
      sessions: [
        {
          id: "session-1",
          label: "Session One",
          createdAt: 1000,
          updatedAt: 1000
        }
      ],
      memoryNamespaces: ["session", "project"]
    });
    expect(parsed.sessions).toHaveLength(1);
    expect(parsed.memoryNamespaces).toEqual(["session", "project"]);
  });

  it("rejects missing required fields", () => {
    expect(() => ProjectConfigSchema.parse({ id: "p1" })).toThrow();
  });
});

describe("ApprovalRequestSchema", () => {
  const validRequest = {
    id: "approval-1",
    runId: "run-1",
    actionId: "action-1",
    riskLevel: "high",
    reason: "High-risk shell command requires approval.",
    input: { command: "rm -rf /tmp/test" },
    createdAt: 1000
  };

  it("accepts a valid approval request", () => {
    const parsed = ApprovalRequestSchema.parse(validRequest);
    expect(parsed.id).toBe("approval-1");
    expect(parsed.riskLevel).toBe("high");
  });

  it("accepts optional fields", () => {
    const parsed = ApprovalRequestSchema.parse({
      ...validRequest,
      agentId: "orchestrator",
      toolId: "shell.execute",
      deadlineMs: 30000
    });
    expect(parsed.agentId).toBe("orchestrator");
    expect(parsed.deadlineMs).toBe(30000);
  });

  it("rejects an invalid risk level", () => {
    expect(() =>
      ApprovalRequestSchema.parse({ ...validRequest, riskLevel: "extreme" })
    ).toThrow();
  });

  it("rejects missing required fields", () => {
    expect(() => ApprovalRequestSchema.parse({ id: "a1" })).toThrow();
  });
});

describe("ApprovalDecisionSchema", () => {
  it("accepts a valid approval decision with defaults", () => {
    const parsed = ApprovalDecisionSchema.parse({
      requestId: "approval-1",
      decision: "approved",
      decidedAt: 1000
    });
    expect(parsed.decidedBy).toBe("operator");
  });

  it("accepts all valid decisions", () => {
    const decisions = ["approved", "denied", "deferred"] as const;
    for (const decision of decisions) {
      const parsed = ApprovalDecisionSchema.parse({
        requestId: "approval-1",
        decision,
        decidedAt: 1000
      });
      expect(parsed.decision).toBe(decision);
    }
  });

  it("accepts all valid decidedBy sources", () => {
    const sources = ["operator", "auto_policy", "timeout"] as const;
    for (const decidedBy of sources) {
      const parsed = ApprovalDecisionSchema.parse({
        requestId: "approval-1",
        decision: "approved",
        decidedAt: 1000,
        decidedBy
      });
      expect(parsed.decidedBy).toBe(decidedBy);
    }
  });

  it("accepts optional reason", () => {
    const parsed = ApprovalDecisionSchema.parse({
      requestId: "approval-1",
      decision: "denied",
      reason: "Command too dangerous.",
      decidedAt: 1000
    });
    expect(parsed.reason).toBe("Command too dangerous.");
  });

  it("rejects invalid decision values", () => {
    expect(() =>
      ApprovalDecisionSchema.parse({
        requestId: "approval-1",
        decision: "maybe",
        decidedAt: 1000
      })
    ).toThrow();
  });
});

describe("MVP_TOOLS", () => {
  it("contains at least one tool", () => {
    expect(MVP_TOOLS.length).toBeGreaterThan(0);
  });

  it("every tool is a valid ToolDescriptor", () => {
    for (const tool of MVP_TOOLS) {
      const parsed = ToolDescriptorSchema.parse(tool);
      expect(parsed.id).toBe(tool.id);
    }
  });

  it("has unique tool IDs", () => {
    const ids = MVP_TOOLS.map((tool) => tool.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("DEFAULT_PROVIDERS", () => {
  it("contains at least one provider", () => {
    expect(DEFAULT_PROVIDERS.length).toBeGreaterThan(0);
  });

  it("every provider is a valid ProviderConfig", () => {
    for (const provider of DEFAULT_PROVIDERS) {
      const parsed = ProviderConfigSchema.parse(provider);
      expect(parsed.id).toBe(provider.id);
    }
  });

  it("has unique provider IDs", () => {
    const ids = DEFAULT_PROVIDERS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
