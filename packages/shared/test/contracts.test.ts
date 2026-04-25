import { describe, expect, it } from "vitest";
import {
  AgentProfileSchema,
  ApprovalDecisionSchema,
  ApprovalRequestSchema,
  CustomAgentCheckNameResultSchema,
  CustomAgentCreateParamsSchema,
  CustomAgentDetailSchema,
  CustomAgentSummarySchema,
  CustomAgentUpdateParamsSchema,
  DEFAULT_PROVIDERS,
  DEFAULT_SKILL_TOOL_IDS,
  DEFAULT_WEB_TOOL_IDS,
  DEERFLOW_HARNESS_MODE_ID,
  EvaluationAttemptSchema,
  EvaluationBaselineSchema,
  EvaluationDatasetDetailSchema,
  EvaluationDatasetSchema,
  EvaluationExportResultSchema,
  EvaluationFeedbackAcceptParamsSchema,
  EvaluationFeedbackDraftCaseSchema,
  EvaluationFeedbackGetParamsSchema,
  EvaluationFeedbackListParamsSchema,
  EvaluationFeedbackRecordSchema,
  EvaluationFeedbackRejectParamsSchema,
  EvaluationFeedbackSubmitParamsSchema,
  EvaluationFeedbackUpdateParamsSchema,
  EvaluationImportParamsSchema,
  EvaluationRunDetailSchema,
  EvaluationRunSchema,
  EvaluationRunStreamSchema,
  EvaluationScorecardSchema,
  EvaluationSpecSchema,
  JsonRpcRequestSchema,
  JsonRpcResponseSchema,
  MVP_MODES,
  MVP_MODE_RUNTIME_ATOMS,
  MVP_PATTERNS,
  ModeRecoveryPolicySchema,
  ModeSpecSchema,
  ModeValidationResultSchema,
  MVP_TOOLS,
  MemoryRecordSchema,
  OraEventEnvelopeSchema,
  OraToolCallEnvelopeSchema,
  OpenAICompatibleProtocolSchema,
  PatternDefinitionSchema,
  PlanItemSchema,
  PolicyDecisionSchema,
  ProjectConfigSchema,
  ProjectCreateParamsSchema,
  ProjectDetailSchema,
  ProjectGetParamsSchema,
  ProjectListParamsSchema,
  ProjectSummarySchema,
  ProviderConfigSchema,
  ProviderRegistrySchema,
  ProviderSecretStatusSchema,
  ProviderSecretWriteSchema,
  ProviderStatusSchema,
  ProviderVerifyParamsSchema,
  RecoveryActionSchema,
  RecoveryErrorTypeSchema,
  ResourceBudgetSchema,
  RuntimeBootstrapSchema,
  RunConfigSchema,
  RunEventStreamSchema,
  RunForkParamsSchema,
  RunHandleSchema,
  RunReplayParamsSchema,
  RunResumeParamsSchema,
  RunTraceMetadataSchema,
  RunTrailParamsSchema,
  RunTrailSchema,
  RunSummarySchema,
  SessionConfigSchema,
  SessionCreateParamsSchema,
  SessionDetailSchema,
  SessionGetParamsSchema,
  SessionSummarySchema,
  SessionTranscriptMessageSchema,
  SessionTurnSchema,
  SkillCheckNameResultSchema,
  SkillCreateParamsSchema,
  SkillDetailSchema,
  SkillSetEnabledParamsSchema,
  SkillUpdateParamsSchema,
  StateSnapshotSchema,
  SkillRegistrySchema,
  TodoItemSchema,
  autoLayoutModeSpec,
  ensureModeNodePositions,
  getModeNodeRuntimeTemplateDefinition,
  projectModeRuntimeTopology,
  validateModeSpec,
  ToolDescriptorSchema,
  ToolRegistrySchema
} from "../src/index.js";

describe("Ora shared contracts", () => {
  it("validates all MVP pattern fixtures", () => {
    expect(MVP_PATTERNS).toHaveLength(5);
    expect(MVP_MODES).toHaveLength(7);
    expect(MVP_PATTERNS.map((pattern) => pattern.id)).toEqual([
      "generator_verifier",
      "orchestrator_subagent",
      "agent_teams",
      "message_bus",
      "shared_state"
    ]);
    expect(MVP_MODES.map((mode) => mode.id)).toEqual([
      "generator_verifier",
      "orchestrator_subagent",
      DEERFLOW_HARNESS_MODE_ID,
      "single_agent",
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

    for (const mode of MVP_MODES) {
      expect(ModeSpecSchema.parse(mode).id).toBe(mode.id);
      expect(mode.nodes.length).toBeGreaterThan(0);
      expect(mode.nodes.every((node) => node.position)).toBe(true);
      expect(Array.isArray(mode.runtimeAtoms)).toBe(true);
      for (const toolId of DEFAULT_SKILL_TOOL_IDS) {
        expect(mode.capabilityFlags.toolIds).toContain(toolId);
      }
      for (const toolId of DEFAULT_WEB_TOOL_IDS) {
        expect(mode.capabilityFlags.toolIds).toContain(toolId);
      }
      expect(validateModeSpec(mode).valid).toBe(true);
      expect(ModeValidationResultSchema.parse({ valid: true, errors: [], warnings: [] }).valid).toBe(true);
    }

    const deerflowHarness = MVP_MODES.find((mode) => mode.id === DEERFLOW_HARNESS_MODE_ID)!;
    expect(deerflowHarness.systemPreset).toBe(true);
    expect(deerflowHarness.family).toBe("orchestrator_subagent");
    expect(deerflowHarness.capabilityFlags.toolIds).toContain("model.handoff");
    expect(deerflowHarness.nodes.filter((node) => Array.isArray(node.config.atoms) && node.config.atoms.includes("subagent_delegate")).map((node) => node.id)).toEqual([
      "research",
      "review",
    ]);
  });

  it("accepts legacy mode specs without stored node positions", () => {
    const legacy = {
      ...MVP_MODES[1]!,
      nodes: MVP_MODES[1]!.nodes.map(({ position: _position, ...node }) => ({ ...node })),
    };

    const parsed = ModeSpecSchema.parse(legacy);
    expect(parsed.nodes.every((node) => node.position === undefined)).toBe(true);

    const hydrated = ensureModeNodePositions(parsed);
    expect(hydrated.nodes.every((node) => node.position)).toBe(true);
  });

  it("accepts legacy mode specs without a recovery policy", () => {
    const { recoveryPolicy: _recoveryPolicy, ...legacy } = MVP_MODES[1]!;
    const parsed = ModeSpecSchema.parse(legacy);

    expect(parsed.recoveryPolicy.version).toBe(1);
    expect(ModeRecoveryPolicySchema.parse(parsed.recoveryPolicy).rules.length).toBeGreaterThan(0);
    expect(RecoveryErrorTypeSchema.parse("provider_transient")).toBe("provider_transient");
    expect(RecoveryActionSchema.parse("fallback_artifact")).toBe("fallback_artifact");
  });

  it("validates recovery policy tool and skip constraints", () => {
    const alternateToolValidation = validateModeSpec({
      ...MVP_MODES[1]!,
      recoveryPolicy: {
        ...MVP_MODES[1]!.recoveryPolicy,
        rules: [
          {
            id: "bad-alternate",
            enabled: true,
            errorTypes: ["tool_error"],
            nodeIds: [],
            nodeTemplates: [],
            toolIds: [],
            action: "alternate_tool",
            alternateToolIds: ["file.read"],
            skipAllowed: false,
          },
        ],
      },
    });

    expect(alternateToolValidation.valid).toBe(false);
    expect(alternateToolValidation.errors.join(" ")).toContain("alternate tool 'file.read' is not enabled");

    const skipValidation = validateModeSpec({
      ...MVP_MODES[1]!,
      recoveryPolicy: {
        ...MVP_MODES[1]!.recoveryPolicy,
        rules: [
          {
            id: "bad-skip",
            enabled: true,
            errorTypes: ["node_exception"],
            nodeIds: [],
            nodeTemplates: ["decompose"],
            toolIds: [],
            action: "skip_node",
            alternateToolIds: [],
            skipAllowed: true,
          },
        ],
      },
    });

    expect(skipValidation.valid).toBe(false);
    expect(skipValidation.errors.join(" ")).toContain("cannot skip required node template 'decompose'");
  });

  it("keeps validation and layout semantics independent", () => {
    const positioned = autoLayoutModeSpec({
      ...MVP_MODES[1]!,
      nodes: MVP_MODES[1]!.nodes.map((node, index) => ({
        ...node,
        position: { x: 100 + index * 10, y: 200 + index * 20 },
      })),
    });

    const withoutPositions = {
      ...positioned,
      nodes: positioned.nodes.map(({ position: _position, ...node }) => ({ ...node })),
    };

    expect(validateModeSpec(positioned).valid).toBe(true);
    expect(validateModeSpec(ModeSpecSchema.parse(withoutPositions)).valid).toBe(true);
  });

  it("rejects duplicate and self-referential mode edges", () => {
    const duplicateEdgeMode = {
      ...MVP_MODES[1]!,
      edges: [
        ...MVP_MODES[1]!.edges,
        {
          ...MVP_MODES[1]!.edges[0]!,
          id: "duplicate-edge",
        },
      ],
    };

    const duplicateValidation = validateModeSpec(duplicateEdgeMode);
    expect(duplicateValidation.valid).toBe(false);
    expect(duplicateValidation.errors.join(" ")).toContain("Duplicate edge");

    const selfLoopMode = {
      ...MVP_MODES[1]!,
      edges: [
        ...MVP_MODES[1]!.edges,
        {
          id: "self-loop",
          source: MVP_MODES[1]!.nodes[0]!.id,
          target: MVP_MODES[1]!.nodes[0]!.id,
          kind: "control" as const,
          enabled: true,
        },
      ],
    };

    const selfLoopValidation = validateModeSpec(selfLoopMode);
    expect(selfLoopValidation.valid).toBe(false);
    expect(selfLoopValidation.errors.join(" ")).toContain("self-loop");
  });

  it("defaults run config to the product default pattern", () => {
    const config = RunConfigSchema.parse({});

    expect(config.pattern).toBe("orchestrator_subagent");
    expect(config.modeId).toBeUndefined();
    expect(config.modelRef).toBe("local/smoke-model");
    expect(config.providerId).toBeUndefined();
    expect(config.providerConfig).toBeUndefined();
    expect(config.customAgentId).toBeUndefined();
    expect(config.skillIds).toEqual([]);
    expect(config.toolIds).toEqual([]);
    expect(config.approvalMode).toBe("high_risk_only");
    expect(config.patternOptions).toEqual({});
  });

  it("derives family-specific prompt variables from runtime node templates", () => {
    const orchestratorResearch = getModeNodeRuntimeTemplateDefinition("orchestrator_subagent", "research");
    const sharedStateResearch = getModeNodeRuntimeTemplateDefinition("shared_state", "research");
    const messagePublish = getModeNodeRuntimeTemplateDefinition("message_bus", "publish");

    expect(orchestratorResearch.supportsPromptOverride).toBe(true);
    expect(orchestratorResearch.promptVariables).toEqual(["prompt", "plan"]);
    expect(sharedStateResearch.promptVariables).toEqual(["prompt", "sharedBoard"]);
    expect(messagePublish.supportsPromptOverride).toBe(false);
    expect(messagePublish.promptVariables).toEqual([]);
  });

  it("rejects incompatible runtime atoms on modes and nodes", () => {
    const validation = validateModeSpec({
      ...MVP_MODES[0]!,
      runtimeAtoms: [...MVP_MODES[0]!.runtimeAtoms, "shared_blackboard"],
      nodes: MVP_MODES[0]!.nodes.map((node) =>
        node.id === "draft"
          ? { ...node, config: { ...node.config, atoms: ["persistent_worker_memory"] } }
          : node,
      ),
    });

    expect(validation.valid).toBe(false);
    expect(validation.errors.join(" ")).toContain("shared_blackboard");
    expect(validation.errors.join(" ")).toContain("persistent_worker_memory");
  });

  it("projects active runtime atoms into capability topology without duplicating family built-ins", () => {
    const projected = projectModeRuntimeTopology({
      ...MVP_MODES[1]!,
      runtimeAtoms: [...MVP_MODES[1]!.runtimeAtoms, "token_usage_trace"],
      nodes: MVP_MODES[1]!.nodes.map((node) =>
        node.id === "research"
          ? { ...node, config: { ...node.config, atoms: ["subagent_delegate"] } }
          : node,
      ),
    });

    expect(projected.nodes.some((node) => node.id === "capability:memory_capture")).toBe(true);
    expect(projected.nodes.some((node) => node.id === "capability:token_usage_trace")).toBe(true);
    expect(projected.nodes.some((node) => node.id === "capability:research:subagent_delegate")).toBe(true);
    expect(projected.edges.some((edge) => edge.target === "capability:research:subagent_delegate")).toBe(true);

    const deerflowHarnessProjected = projectModeRuntimeTopology(MVP_MODES.find((mode) => mode.id === DEERFLOW_HARNESS_MODE_ID)!);
    expect(deerflowHarnessProjected.nodes.some((node) => node.id === "capability:research:subagent_delegate")).toBe(true);
    expect(deerflowHarnessProjected.nodes.some((node) => node.id === "capability:review:subagent_delegate")).toBe(true);
    expect(deerflowHarnessProjected.edges.some((edge) => edge.target === "capability:research:subagent_delegate")).toBe(true);
    expect(deerflowHarnessProjected.edges.some((edge) => edge.target === "capability:review:subagent_delegate")).toBe(true);

    const messageBusProjected = projectModeRuntimeTopology(MVP_MODES[5]!);
    expect(messageBusProjected.nodes.filter((node) => node.id === "triage_topic")).toHaveLength(1);
    expect(messageBusProjected.nodes.find((node) => node.id === "triage_topic")?.metadata).toMatchObject({
      atomId: "event_routing",
      atomPresentation: "family_capability",
      atomActive: true,
    });
    expect(messageBusProjected.nodes.some((node) => node.id === "capability:event_routing")).toBe(false);
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

  it("accepts a custom agent selection in run config", () => {
    const config = RunConfigSchema.parse({
      customAgentId: "research-bot",
    });

    expect(config.customAgentId).toBe("research-bot");
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

    const todo = TodoItemSchema.parse({
      id: "todo-1",
      runId: "run-1",
      sourcePlanItemId: planItem.id,
      status: "ready",
      label: "Check the answer",
      createdAt: 1,
      updatedAt: 1,
    });

    expect(decision.requiredApproval).toBe(true);
    expect(todo.sourcePlanItemId).toBe(planItem.id);
    expect(
      OraEventEnvelopeSchema.parse({
        id: "evt-1b",
        runId: "run-1",
        seq: 1,
        type: "todo.updated",
        createdAt: 2,
        pattern: "orchestrator_subagent",
        payload: { items: [todo] }
      }).type
    ).toBe("todo.updated");
    expect(
      StateSnapshotSchema.parse({
        runId: "run-1",
        status: "succeeded",
        pattern: "orchestrator_subagent",
        input: { prompt: "Check the answer", createdAt: 1, context: {} },
        config: { pattern: "orchestrator_subagent" },
        topology: { nodes: [], edges: [] },
        profiles: [],
        memory: [],
        plan: [],
        actions: [],
        checkpoints: [],
        events: [],
        updatedAt: 1
      }).todos
    ).toEqual([]);
  });

  it("validates structured tool-call envelopes and snapshot defaults", () => {
    const toolCall = OraToolCallEnvelopeSchema.parse({
      id: "run-1:tool-call-0",
      providerCallId: "call-provider-1",
      runId: "run-1",
      nodeId: "agent-1",
      agentId: "agent-1",
      actionId: "agent-1-tool-1",
      toolId: "web.search",
      args: { query: "Ora" },
      source: "provider_native",
      status: "succeeded",
      requestedAt: 1,
      updatedAt: 2,
      result: {
        status: "succeeded",
        output: { ok: true },
        content: "{\"ok\":true}",
        createdAt: 2,
        updatedAt: 2,
      },
    });

    expect(toolCall.providerCallId).toBe("call-provider-1");
    expect(
      StateSnapshotSchema.parse({
        runId: "run-1",
        status: "succeeded",
        pattern: "orchestrator_subagent",
        modeId: "single_agent",
        input: { prompt: "Search", createdAt: 1, context: {} },
        config: { pattern: "orchestrator_subagent", modeId: "single_agent" },
        topology: { nodes: [], edges: [] },
        profiles: [],
        memory: [],
        plan: [],
        actions: [],
        checkpoints: [],
        events: [],
        updatedAt: 1
      }).toolCalls
    ).toEqual([]);
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
      JsonRpcRequestSchema.parse({
        jsonrpc: "2.0",
        id: 2,
        method: "agents.list"
      }).method
    ).toBe("agents.list");

    expect(
      JsonRpcRequestSchema.parse({
        jsonrpc: "2.0",
        id: 3,
        method: "skills.setEnabled",
        params: { name: "custom-review", enabled: true }
      }).method
    ).toBe("skills.setEnabled");

    expect(
      JsonRpcRequestSchema.parse({
        jsonrpc: "2.0",
        id: 4,
        method: "projects.list"
      }).method
    ).toBe("projects.list");

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
    expect(
      RunTrailParamsSchema.parse({
        runId: summary.runId,
      }).runId
    ).toBe(summary.runId);
  });

  it("validates trail metadata on turns and trail payloads", () => {
    const trace = RunTraceMetadataSchema.parse({
      enabled: true,
      available: true,
      traceId: "0123456789abcdef0123456789abcdef",
      rootObservationId: "0123456789abcdef",
      traceUrl: "http://localhost:3000/project/ora-runtime/traces/0123456789abcdef0123456789abcdef",
      source: "managed_local",
      generationRefs: [
        {
          observationId: "fedcba9876543210",
          traceId: "0123456789abcdef0123456789abcdef",
          name: "model.local-smoke",
          model: "local/smoke-model",
        },
      ],
    });

    const turn = SessionTurnSchema.parse({
      runId: "run-1",
      sessionId: "session-1",
      turnIndex: 1,
      status: "succeeded",
      pattern: "orchestrator_subagent",
      prompt: "Show the trail.",
      startedAt: 1,
      updatedAt: 2,
      eventCount: 3,
      checkpointCount: 1,
      artifactCount: 0,
      trace,
    });
    expect(turn.trace?.traceId).toBe(trace.traceId);

    const runTrail = RunTrailSchema.parse({
      run: {
        runId: "run-1",
        sessionId: "session-1",
        turnIndex: 1,
        status: "succeeded",
        pattern: "orchestrator_subagent",
        prompt: "Inspect the run.",
        startedAt: 1,
        updatedAt: 2,
        eventCount: 4,
        checkpointCount: 1,
        artifactCount: 0,
      },
      trace: {
        enabled: true,
        available: true,
        traceId: "0123456789abcdef0123456789abcdef",
        rootObservationId: "0123456789abcdef",
        source: "local_synthesized",
        generationRefs: [],
      },
      observations: [
        {
          id: "0123456789abcdef",
          traceId: "0123456789abcdef0123456789abcdef",
          parentObservationId: null,
          type: "agent",
          name: "ora.run.orchestrator_subagent",
          metadata: { runId: "run-1" },
        },
      ],
      liveMetrics: {
        runtimeMs: 1000,
        eventCount: 4,
        checkpointCount: 1,
        topologyChangeCount: 1,
        messageCount: 1,
        activeAgentCount: 2,
        warningCount: 0,
        errorCount: 0,
        estimatedCostUsd: 0.0008,
      },
    });
    expect(runTrail.trace.source).toBe("local_synthesized");
    expect(runTrail.observations).toHaveLength(1);
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

  it("validates evaluation feedback inbox contracts", () => {
    const submit = EvaluationFeedbackSubmitParamsSchema.parse({
      runId: "run-0001",
      sessionId: "session-0001",
      turnIndex: 1,
      messageId: "run-0001:assistant",
      feedbackText: "The answer ignored the required citation format.",
    });
    expect(submit.feedbackText).toContain("citation");

    const draft = EvaluationFeedbackDraftCaseSchema.parse({
      curatorStatus: "generated",
      curatorRationale: "Feedback names a missing formatting requirement.",
      case: {
        id: "feedback-feedback-0001",
        input: {
          prompt: "Summarize the report with citations.",
          context: {
            sourceAssistantOutput: "Here is a summary.",
          },
        },
        expected: {
          structured: {
            failureMode: "bad_format",
            idealBehavior: "Use the requested citation format.",
            mustAddress: ["citation format"],
            shouldAvoid: ["uncited claims"],
            rubric: [{ criterion: "citation_format", weight: 1 }],
          },
        },
        metadata: {
          source: "chat_feedback",
          sourceRunId: "run-0001",
          severity: "medium",
          tags: ["bad_format"],
        },
      },
    });
    expect(draft.case.metadata.source).toBe("chat_feedback");

    const record = EvaluationFeedbackRecordSchema.parse({
      id: "feedback-0001",
      status: "pending",
      feedbackText: submit.feedbackText,
      sourceRunId: submit.runId,
      sourceSessionId: submit.sessionId,
      sourceTurnIndex: submit.turnIndex,
      sourceMessageId: submit.messageId,
      sourceContext: { traceRunIds: ["run-0001"] },
      draft,
      createdAt: 1,
      updatedAt: 1,
    });
    expect(record.draft.curatorStatus).toBe("generated");

    expect(EvaluationFeedbackListParamsSchema.parse({ status: "pending", limit: 50 }).status).toBe("pending");
    expect(EvaluationFeedbackGetParamsSchema.parse({ feedbackId: record.id }).feedbackId).toBe(record.id);
    expect(EvaluationFeedbackUpdateParamsSchema.parse({
      feedbackId: record.id,
      draftCase: draft.case,
    }).draftCase?.id).toBe(draft.case.id);
    expect(EvaluationFeedbackAcceptParamsSchema.parse({ feedbackId: record.id, datasetId: "feedback-chat" }).datasetId).toBe("feedback-chat");
    expect(EvaluationFeedbackRejectParamsSchema.parse({ feedbackId: record.id, reason: "Duplicate" }).reason).toBe("Duplicate");
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
      protocol: "chat_completions",
    });

    expect(parsed.enabled).toBe(true);
    expect(parsed.capabilities).toEqual(["chat"]);
    expect(parsed.protocol).toBe("chat_completions");
    expect(parsed.headers).toEqual({});
  });

  it("accepts an Anthropic-compatible custom provider", () => {
    const parsed = ProviderConfigSchema.parse({
      id: "claude-gateway",
      type: "anthropic_compatible",
      label: "Claude Gateway",
      modelId: "claude-sonnet-4-20250514",
      baseUrl: "https://gateway.example.com",
      apiKeyEnv: "CLAUDE_GATEWAY_API_KEY",
      anthropicVersion: "2023-06-01",
      headers: {
        "anthropic-beta": "prompt-caching-2024-07-31",
      },
    });

    expect(parsed.type).toBe("anthropic_compatible");
    expect(parsed.anthropicVersion).toBe("2023-06-01");
    expect(parsed.headers).toEqual({
      "anthropic-beta": "prompt-caching-2024-07-31",
    });
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

describe("Provider verification schemas", () => {
  it("accepts supported OpenAI-compatible protocols", () => {
    expect(OpenAICompatibleProtocolSchema.parse("chat_completions")).toBe("chat_completions");
    expect(OpenAICompatibleProtocolSchema.parse("responses")).toBe("responses");
  });

  it("accepts provider verification params", () => {
    const parsed = ProviderVerifyParamsSchema.parse({
      provider: {
        id: "openrouter",
        type: "openai_compatible",
        label: "OpenRouter",
        modelId: "openai/gpt-4o-mini",
        baseUrl: "https://openrouter.ai/api/v1",
        protocol: "chat_completions",
      },
    });

    expect(parsed.provider.protocol).toBe("chat_completions");
  });

  it("accepts provider status payloads", () => {
    const parsed = ProviderStatusSchema.parse({
      providerId: "openrouter",
      state: "verified",
      detail: "Connection verified.",
      checkedAt: 123,
    });

    expect(parsed.state).toBe("verified");
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
    expect(parsed.implemented).toBe(true);
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
    expect(parsed.skills[0]?.category).toBe("public");
    expect(parsed.skills[0]?.enabled).toBe(true);
    expect(parsed.skills[0]?.editable).toBe(false);
  });

  it("accepts managed skill detail and mutation params", () => {
    const detail = SkillDetailSchema.parse({
      id: "custom-review",
      name: "custom-review",
      description: "Review with local project rules.",
      category: "custom",
      enabled: false,
      editable: true,
      content: "---\nname: custom-review\ndescription: Review with local project rules.\n---\n\n# custom-review"
    });

    expect(detail.name).toBe("custom-review");
    expect(SkillCreateParamsSchema.parse({ name: "custom-review" }).enabled).toBe(true);
    expect(SkillUpdateParamsSchema.parse({ name: "custom-review", content: detail.content }).name).toBe("custom-review");
    expect(SkillSetEnabledParamsSchema.parse({ name: "custom-review", enabled: true }).enabled).toBe(true);
    expect(SkillCheckNameResultSchema.parse({ name: "custom-review", available: false }).available).toBe(false);
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
      atoms: MVP_MODE_RUNTIME_ATOMS,
      providers: {
        providers: DEFAULT_PROVIDERS,
        defaultProviderId: "local-smoke"
      },
      tools: {
        tools: MVP_TOOLS,
        defaultPolicyId: "default-policy"
      },
      modes: MVP_MODES,
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
    expect(parsed.modes).toHaveLength(7);
    expect(parsed.atoms.length).toBeGreaterThan(0);
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
        pendingClarifications: [],
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

describe("Project thread contracts", () => {
  it("accepts project create/list/get payloads", () => {
    const createParams = ProjectCreateParamsSchema.parse({
      label: "ora",
      rootPath: "/Users/quintenchen/developer/ora",
    });
    const listParams = ProjectListParamsSchema.parse({ limit: 50 });
    const getParams = ProjectGetParamsSchema.parse({ projectId: "project-0001" });
    const summary = ProjectSummarySchema.parse({
      projectId: "project-0001",
      label: "ora",
      rootPath: "/Users/quintenchen/developer/ora",
      sessionCount: 2,
      createdAt: 1000,
      updatedAt: 1200,
    });
    const detail = ProjectDetailSchema.parse({
      project: summary,
      sessions: [
        {
          sessionId: "session-1",
          title: "Investigate runtime startup",
          projectId: "project-0001",
          status: "succeeded",
          latestRunId: "run-1",
          latestPattern: "orchestrator_subagent",
          latestProviderId: "local-smoke",
          latestModelRef: "local/smoke-model",
          turnCount: 1,
          createdAt: 1000,
          updatedAt: 1200,
        },
      ],
    });

    expect(createParams.rootPath).toBe("/Users/quintenchen/developer/ora");
    expect(listParams.limit).toBe(50);
    expect(getParams.projectId).toBe("project-0001");
    expect(detail.project.sessionCount).toBe(2);
    expect(detail.sessions[0]?.projectId).toBe("project-0001");
  });
});

describe("Custom agent contracts", () => {
  it("accepts custom agent summary and detail payloads", () => {
    const summary = CustomAgentSummarySchema.parse({
      name: "research-bot",
      description: "Focuses on concise research synthesis.",
      model: "claude-sonnet-4-20250514",
      toolGroups: ["web", "files"],
      createdAt: 1000,
      updatedAt: 1200,
    });

    const detail = CustomAgentDetailSchema.parse({
      ...summary,
      soul: "Stay concise and source-backed.",
    });

    expect(detail.name).toBe("research-bot");
    expect(detail.soul).toContain("source-backed");
  });

  it("accepts create/update payloads and check-name results", () => {
    const createParams = CustomAgentCreateParamsSchema.parse({
      name: "review-bot",
      description: "Surfaces risks before merge.",
      toolGroups: ["files"],
      soul: "Default to a review mindset.",
    });
    const updateParams = CustomAgentUpdateParamsSchema.parse({
      name: "review-bot",
      model: "gpt-5.4",
      soul: "Look for regressions first.",
    });
    const checkResult = CustomAgentCheckNameResultSchema.parse({
      available: true,
      name: "review-bot",
    });

    expect(createParams.name).toBe("review-bot");
    expect(updateParams.model).toBe("gpt-5.4");
    expect(checkResult.available).toBe(true);
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

  it("marks deferred tool descriptors explicitly", () => {
    const deferred = MVP_TOOLS.filter((tool) => tool.implemented === false).map((tool) => tool.id);
    expect(deferred).toEqual(expect.arrayContaining([
      "file.delete",
      "model.handoff",
      "message.publish",
      "shared_state.write",
      "export.report",
    ]));
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
