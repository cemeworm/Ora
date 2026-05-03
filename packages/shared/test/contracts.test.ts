import { describe, expect, it } from "vitest";
import {
  AgentProfileSchema,
  AgentConversationMessageSchema,
  ChannelBindingSchema,
  ChannelConfigSchema,
  ChannelDeliveryRetryParamsSchema,
  ChannelDeliverySchema,
  ChannelIngestParamsSchema,
  ChannelInboundMessageSchema,
  ChannelOutboundMessageSchema,
  ActionRecordSchema,
  ApprovalDecisionSchema,
  ApprovalRequestSchema,
  AgentCatalogResultSchema,
  CustomAgentCheckNameResultSchema,
  CustomAgentCatalogItemSchema,
  CustomAgentCreateParamsSchema,
  CustomAgentDetailSchema,
  CustomAgentGenerateDraftParamsSchema,
  CustomAgentGenerateDraftResultSchema,
  CustomAgentSummarySchema,
  CustomAgentUpdateParamsSchema,
  DEFAULT_PROVIDERS,
  DEFAULT_AGENT_MODE_TOOL_IDS,
  DEFAULT_SKILL_TOOL_IDS,
  DEFAULT_WEB_TOOL_IDS,
  CODE_DEVELOPMENT_MODE_ID,
  DEBATE_MODE_ID,
  DEERFLOW_HARNESS_MODE_ID,
  EvaluationAttemptSchema,
  EvaluationAnnotationListParamsSchema,
  EvaluationAnnotationSubmitParamsSchema,
  EvaluationAnnotationTaskSchema,
  EvaluationBaselineSchema,
  EvaluationBlueprintCompileResultSchema,
  EvaluationBlueprintCreateParamsSchema,
  EvaluationBlueprintGenerateDraftParamsSchema,
  EvaluationBlueprintPlanTurnParamsSchema,
  EvaluationBlueprintPlanTurnResultSchema,
  EvaluationBlueprintSchema,
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
  EvaluationMetricScoreSchema,
  EvaluationObjectiveSchema,
  EvaluationObservationSchema,
  EvaluationEvaluatorResultSchema,
  EvaluationEvaluatorSpecSchema,
  EffectiveRunStrategySchema,
  FeedbackLoopActionApplyParamsSchema,
  FeedbackLoopActionPreviewParamsSchema,
  FeedbackLoopActionResultSchema,
  FeedbackLoopCalibrationRuleSchema,
  FeedbackLoopInsightDismissParamsSchema,
  FeedbackLoopInsightGetParamsSchema,
  FeedbackLoopInsightsListParamsSchema,
  FeedbackLoopRuleUpdateParamsSchema,
  FeedbackLoopRulesListParamsSchema,
  FeedbackLoopSignalsListParamsSchema,
  EvaluationImportParamsSchema,
  EvaluationRunDetailSchema,
  EvaluationRunSchema,
  EvaluationRunStreamSchema,
  EvaluationScorecardSchema,
  EvaluationSpecSchema,
  EvaluationStructuredExpectedSchema,
  JsonRpcRequestSchema,
  JsonRpcResponseSchema,
  MODE_STUDIO_BUILDER_MODE_ID,
  MVP_MODES,
  MVP_MODE_RUNTIME_ATOMS,
  MVP_PATTERNS,
  ORA_SELF_BUILDER_MODE_ID,
  ModeRecoveryPolicySchema,
  ModeSpecSchema,
  ModeValidationResultSchema,
  MVP_TOOLS,
  MemoryRecordSchema,
  ModeStudioApplyDraftParamsSchema,
  ModeStudioBuilderResultParamsSchema,
  ModeStudioBuilderResultSchema,
  ModeStudioDraftBundleSchema,
  ModeStudioGenerateDraftParamsSchema,
  ModeStudioGuidanceSchema,
  ModeStudioStartBuilderRunParamsSchema,
  ModeStudioStartBuilderRunResultSchema,
  OraEventEnvelopeSchema,
  OraToolCallEnvelopeSchema,
  OpenAICompatibleProtocolSchema,
  PatternDefinitionSchema,
  PlanItemSchema,
  PolicyDecisionSchema,
  ProjectConfigSchema,
  ProjectCreateParamsSchema,
  ProjectDetailSchema,
  ProjectFileReadParamsSchema,
  ProjectFileReadResultSchema,
  ProjectFilesParamsSchema,
  ProjectFilesResultSchema,
  ProjectGetParamsSchema,
  ProjectInsightSchema,
  ProjectListParamsSchema,
  ProjectSignalActionSchema,
  ProjectSignalSchema,
  ProjectSummarySchema,
  ProviderConfigSchema,
  ProviderModelSchema,
  ProviderModelsParamsSchema,
  ProviderModelsResultSchema,
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
  RunContinuationFrameSchema,
  RuntimeConversationEntrySchema,
  RuntimeToolResultLedgerEntrySchema,
  RuntimeJsonRpcMethodSchema,
  RunLatencyDiagnosticsSchema,
  SelfIterationCandidateApplyParamsSchema,
  SelfIterationCandidateSchema,
  SelfIterationCuratorTriggerSchema,
  SelfIterationPolicySchema,
  SelfIterationRunSchema,
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
  SkillFileDeleteParamsSchema,
  SkillFileGetParamsSchema,
  SkillFileUpsertParamsSchema,
  SkillPackageFileContentSchema,
  SkillSetEnabledParamsSchema,
  SkillUpdateParamsSchema,
  SystemAgentCatalogItemSchema,
  SystemAgentOverrideResetParamsSchema,
  SystemAgentOverrideUpdateParamsSchema,
  StateSnapshotSchema,
  SkillRegistrySchema,
  TodoItemSchema,
  autoLayoutModeSpec,
  ensureModeNodePositions,
  getModeNodeRuntimeTemplateDefinition,
  projectModeRuntimeTopology,
  validateModeSpec,
  ToolDescriptorSchema,
  ToolRegistrySchema,
  completionPolicyForPreset,
} from "../src/index.js";

describe("Ora shared contracts", () => {
  it("validates all MVP pattern fixtures", () => {
    expect(MVP_PATTERNS).toHaveLength(5);
    expect(MVP_MODES).toHaveLength(11);
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
      DEBATE_MODE_ID,
      CODE_DEVELOPMENT_MODE_ID,
      ORA_SELF_BUILDER_MODE_ID,
      MODE_STUDIO_BUILDER_MODE_ID,
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
      expect(["decisive", "balanced", "persistent"]).toContain(mode.completionPolicy.preset);
      expect(["off", "standard", "deep"]).toContain(mode.runtimePolicy.thinking);
      expect(["fast", "balanced", "deep"]).toContain(mode.runtimePolicy.budgetProfile);
      if (mode.visibility !== "internal") {
        expect(mode.capabilityFlags.toolIds).toEqual(DEFAULT_AGENT_MODE_TOOL_IDS);
        for (const toolId of DEFAULT_SKILL_TOOL_IDS) {
          expect(mode.capabilityFlags.toolIds).toContain(toolId);
        }
        for (const toolId of DEFAULT_WEB_TOOL_IDS) {
          expect(mode.capabilityFlags.toolIds).toContain(toolId);
        }
      }
      expect(validateModeSpec(mode).valid).toBe(true);
      expect(ModeValidationResultSchema.parse({ valid: true, errors: [], warnings: [] }).valid).toBe(true);
    }

    const deerflowHarness = MVP_MODES.find((mode) => mode.id === DEERFLOW_HARNESS_MODE_ID)!;
    expect(deerflowHarness.systemPreset).toBe(true);
    expect(deerflowHarness.family).toBe("orchestrator_subagent");
    expect(deerflowHarness.completionPolicy.preset).toBe("persistent");
    expect(deerflowHarness.runtimePolicy).toMatchObject({
      thinking: "deep",
      planning: "explicit",
      delegation: "allowed",
      providerThinking: "required",
    });
    expect(deerflowHarness.capabilityFlags.toolIds).toContain("model.handoff");
    expect(deerflowHarness.nodes.filter((node) => Array.isArray(node.config.atoms) && node.config.atoms.includes("subagent_delegate")).map((node) => node.id)).toEqual([
      "research",
      "review",
    ]);
    const debate = MVP_MODES.find((mode) => mode.id === DEBATE_MODE_ID)!;
    expect(debate.systemPreset).toBe(true);
    expect(debate.family).toBe("orchestrator_subagent");
    expect(debate.profiles.map((profile) => profile.id)).toEqual(["moderator", "debate_agent"]);
    expect(debate.nodes.map((node) => node.id)).toEqual(["frame", "debate", "synthesis"]);
    expect(debate.stages?.map((stage) => stage.nodeId)).toEqual([
      "debate",
      "debate",
      "debate",
      "debate",
      "debate",
      "debate",
      "debate",
      "debate",
      "synthesis",
    ]);
    expect(debate.stages?.every((stage) => debate.nodes.some((node) => node.id === stage.nodeId))).toBe(true);
    expect(debate.stages?.every((stage) => !stage.speakerId || debate.profiles.some((profile) => profile.id === stage.speakerId))).toBe(true);
    expect(debate.transcriptLayout).toMatchObject({
      style: "two_sided_duel",
      groupId: "debate",
      sideByStance: {
        affirmative: "left",
        negative: "right",
      },
    });
    const codeDevelopment = MVP_MODES.find((mode) => mode.id === CODE_DEVELOPMENT_MODE_ID)!;
    expect(codeDevelopment.systemPreset).toBe(true);
    expect(codeDevelopment.visibility).toBe("user");
    expect(codeDevelopment.family).toBe("agent_teams");
    expect(codeDevelopment.completionPolicy.preset).toBe("persistent");
    expect(codeDevelopment.description).toContain("long-task-protocol");
    expect(codeDevelopment.recommendedUse).toContain("long-task-protocol");
    expect(codeDevelopment.capabilityFlags.skillIds).toContain("long-task-protocol");
    expect(codeDevelopment.runtimePolicy).toMatchObject({
      thinking: "deep",
      planning: "explicit",
      delegation: "preferred",
      providerThinking: "required",
    });
    expect(codeDevelopment.profiles.map((profile) => profile.id)).toEqual([
      "orchestrator",
      "builder",
      "reviewer",
      "debugger",
    ]);
    expect(codeDevelopment.nodes.map((node) => [node.id, node.template, node.ownerAgentId])).toEqual([
      ["triage", "triage", "orchestrator"],
      ["build", "build", "builder"],
      ["review", "check", "reviewer"],
      ["debug", "check", "debugger"],
      ["handoff", "handoff", "orchestrator"],
    ]);
    expect(codeDevelopment.nodes.find((node) => node.id === "triage")?.instructions).toContain("long-task-protocol");
    expect(codeDevelopment.nodes.find((node) => node.id === "handoff")?.prompt).toContain("DONE gates");
    expect(codeDevelopment.stages?.every((stage) => codeDevelopment.nodes.some((node) => node.id === stage.nodeId))).toBe(true);
    expect(codeDevelopment.stages?.every((stage) => !stage.speakerId || codeDevelopment.profiles.some((profile) => profile.id === stage.speakerId))).toBe(true);
    expect(codeDevelopment.transcriptLayout).toMatchObject({
      style: "role_lanes",
      groupId: "code-development",
      groupBy: "speakerId",
      laneBySpeaker: {
        orchestrator: "orchestrator",
        builder: "builder",
        reviewer: "reviewer",
        debugger: "debugger",
      },
    });
    expect(codeDevelopment.runtimeAtoms.every((atomId) => MVP_MODE_RUNTIME_ATOMS.find((atom) => atom.id === atomId)?.scope === "mode")).toBe(true);

    const builderMode = MVP_MODES.find((mode) => mode.id === MODE_STUDIO_BUILDER_MODE_ID)!;
    expect(builderMode.visibility).toBe("internal");
    expect(builderMode.family).toBe("agent_teams");
  });

  it("validates provider model discovery contracts", () => {
    expect(RuntimeJsonRpcMethodSchema.parse("providers.models")).toBe("providers.models");
    expect(ProviderConfigSchema.parse({
      id: "context-aware",
      type: "openai",
      label: "Context Aware",
      modelId: "gpt-context",
      contextWindow: 100000,
      maxContextWindow: 120000,
      autoCompactTokenLimit: 95000,
    }).autoCompactTokenLimit).toBe(95000);
    expect(ProviderModelSchema.parse({ id: "gpt-4o", source: "remote", created: 1 }).id).toBe("gpt-4o");
    expect(ProviderModelsParamsSchema.parse({ provider: DEFAULT_PROVIDERS[0] }).provider.id).toBe(DEFAULT_PROVIDERS[0]?.id);

    for (const status of ["ok", "unsupported", "error"] as const) {
      expect(ProviderModelsResultSchema.parse({
        models: status === "ok" ? [{ id: "model", source: "remote" }] : [],
        status,
        authoritative: status === "ok",
        message: status === "ok" ? undefined : "Model discovery unavailable.",
        fetchedAt: "2026-04-30T10:00:00.000Z",
      }).status).toBe(status);
    }
  });

  it("validates effective run strategy records", () => {
    const singleAgent = MVP_MODES.find((mode) => mode.id === "single_agent")!;
    const strategy = EffectiveRunStrategySchema.parse({
      sourceModeId: singleAgent.id,
      sourceModeSelection: "manual",
      thinking: singleAgent.runtimePolicy.thinking,
      reasoningEffort: singleAgent.runtimePolicy.reasoningEffort,
      budgetProfile: singleAgent.runtimePolicy.budgetProfile,
      budget: singleAgent.defaultBudget,
      planning: singleAgent.runtimePolicy.planning,
      planningEnabled: true,
      delegation: singleAgent.runtimePolicy.delegation,
      delegationEnabled: false,
      providerThinkingEnabled: false,
      providerPolicyStatus: "unsupported",
      notes: ["Local smoke provider does not support reasoning."],
    });

    expect(strategy.sourceModeId).toBe("single_agent");
    expect(strategy.budget.maxToolCalls).toBe(singleAgent.defaultBudget.maxToolCalls);
  });

  it("keeps canonical built-in agents on concrete responsibility contracts", () => {
    const systemProfiles = new Map<string, string>();
    for (const mode of MVP_MODES.filter((candidate) => candidate.systemPreset)) {
      for (const profile of mode.profiles) {
        systemProfiles.set(profile.id, profile.systemPrompt ?? "");
      }
    }

    expect([...systemProfiles.keys()].sort()).toEqual([
      "builder",
      "debate_agent",
      "debugger",
      "generator",
      "moderator",
      "ora",
      "orchestrator",
      "release_reviewer",
      "researcher",
      "responder",
      "reviewer",
      "router",
      "team_lead",
      "verifier",
    ]);

    for (const [agentId, systemPrompt] of systemProfiles) {
      expect(systemPrompt, `${agentId} system prompt`).toContain("Responsibility:");
      expect(systemPrompt, `${agentId} system prompt`).toContain("Boundary:");
      expect(systemPrompt, `${agentId} system prompt`).toContain("Output:");
      expect(systemPrompt, `${agentId} system prompt`).toMatch(/evidence|verification|verdict|findings|handoff|route|rollback|reasoning/i);
    }
  });

  it("accepts legacy mode specs without visibility", () => {
    const { visibility: _visibility, ...legacy } = MVP_MODES[1]!;
    const parsed = ModeSpecSchema.parse(legacy);

    expect(parsed.visibility).toBe("user");
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

  it("accepts legacy mode specs without a completion policy", () => {
    const { completionPolicy: _completionPolicy, ...legacy } = MVP_MODES[1]!;
    const parsed = ModeSpecSchema.parse(legacy);

    expect(parsed.completionPolicy).toEqual(completionPolicyForPreset("balanced"));
  });

  it("accepts legacy mode specs without a runtime policy", () => {
    const { runtimePolicy: _runtimePolicy, ...legacy } = MVP_MODES[1]!;
    const parsed = ModeSpecSchema.parse(legacy);

    expect(parsed.runtimePolicy.thinking).toBe("standard");
    expect(parsed.runtimePolicy.budgetProfile).toBe("balanced");
  });

  it("accepts legacy mode specs without staged transcript declarations", () => {
    const { stages: _stages, transcriptLayout: _transcriptLayout, ...legacy } = MVP_MODES.find((mode) => mode.id === DEBATE_MODE_ID)!;
    const parsed = ModeSpecSchema.parse(legacy);

    expect(parsed.stages).toBeUndefined();
    expect(parsed.transcriptLayout).toBeUndefined();
  });

  it("validates recovery policy tool and skip constraints", () => {
    const alternateToolValidation = validateModeSpec({
      ...MVP_MODES[1]!,
      capabilityFlags: {
        ...MVP_MODES[1]!.capabilityFlags,
        toolIds: [],
      },
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
    expect(orchestratorResearch.display.story).toContain("{{owner}}");
    expect(orchestratorResearch.promptVariables).toEqual(["prompt", "plan"]);
    expect(sharedStateResearch.promptVariables).toEqual(["prompt", "sharedBoard"]);
    expect(messagePublish.supportsPromptOverride).toBe(false);
    expect(messagePublish.display.story).toContain("initial event");
    expect(messagePublish.promptVariables).toEqual([]);

    const missing = getModeNodeRuntimeTemplateDefinition("message_bus", "unknown_stage");
    expect(missing.display.story).toContain("No runtime template metadata");
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

    const messageBusProjected = projectModeRuntimeTopology(MVP_MODES.find((mode) => mode.id === "message_bus")!);
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
      customAgentId: "review-bot",
      modelRef: "local/smoke-model",
      toolPolicyId: "default",
      toolIds: ["file.read"],
      skillIds: ["review"],
      memoryNamespaces: ["session"],
      budget
    });
    expect(profile.customAgentId).toBe("review-bot");
    expect(profile.toolIds).toEqual(["file.read"]);
    expect(profile.skillIds).toEqual(["review"]);

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
      type: "agent.message",
      createdAt: 1,
      pattern: "agent_teams",
      payload: { memoryId: memory.id }
    });

    expect(event.payload).toEqual({ memoryId: "mem-1" });
    expect(event.type).toBe("agent.message");

    const agentMessage = AgentConversationMessageSchema.parse({
      id: "run-1:agent-message:0",
      runId: "run-1",
      createdAt: 1,
      fromAgentId: "team_lead",
      toAgentIds: ["builder"],
      threadId: "run-1:thread:build",
      nodeId: "build",
      planItemId: "run-1:build",
      kind: "mention",
      content: "@builder please complete the assigned work.",
    });
    expect(agentMessage.status).toBe("sent");
    expect(agentMessage.artifactIds).toEqual([]);
    expect(agentMessage.transcript).toBeUndefined();

    const transcriptMessage = AgentConversationMessageSchema.parse({
      id: "run-1:agent-message:1",
      runId: "run-1",
      createdAt: 2,
      fromAgentId: "debate_agent",
      toAgentIds: ["moderator"],
      threadId: "debate:run-1",
      nodeId: "debate",
      planItemId: "run-1:debate",
      kind: "reply",
      status: "done",
      content: "The affirmative case stands unless the negative side proves the risk dominates.",
      transcript: {
        kind: "stage_transcript",
        groupId: "red-blue",
        groupLabel: "Red/Blue Review",
        stageId: "red-team-opening",
        stageLabel: "Opening pressure",
        sequence: 0,
        speakerLabel: "Red Team",
        speakerId: "red_team",
        stance: "red_team",
        status: "done",
        layout: {
          style: "two_sided_duel",
          groupId: "red-blue",
          sideByStance: {
            red_team: "left",
            blue_team: "right",
          },
        },
      },
    });
    expect(transcriptMessage.transcript?.speakerLabel).toBe("Red Team");
    expect(transcriptMessage.transcript?.sequence).toBe(0);
    expect(transcriptMessage.transcript?.stance).toBe("red_team");
    expect(transcriptMessage.transcript?.layout?.style).toBe("two_sided_duel");

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
    const action = ActionRecordSchema.parse({
      id: "action-1",
      runId: "run-1",
      type: "skills.create",
      riskLevel: "high",
      status: "approval_required",
      input: { name: "waza-think" },
      approvalRequest: {
        title: "需要你确认安装技能",
        summary: "我准备把技能安装到 Ora 的本地技能库。",
        whatWillChange: "会新增一个本地技能条目。",
        whyNeeded: "这是完成安装请求所需的步骤。",
        riskNote: "确认来源可信后再继续。",
        confirmLabel: "批准并继续",
      },
      artifactIds: []
    });
    expect(action.approvalRequest?.title).toBe("需要你确认安装技能");
    expect(ActionRecordSchema.parse({
      id: "action-legacy",
      runId: "run-1",
      type: "file.write",
      riskLevel: "high",
      status: "approval_required",
      input: {},
      artifactIds: []
    }).approvalRequest).toBeUndefined();
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
      }).agentMessages
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
    const snapshotWithDefaults = StateSnapshotSchema.parse({
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
      });
    expect(snapshotWithDefaults.toolCalls).toEqual([]);
    expect(snapshotWithDefaults.continuation).toEqual({ frames: [] });
    expect(snapshotWithDefaults.conversation).toEqual([]);
    expect(snapshotWithDefaults.toolResults).toEqual([]);
  });

  it("validates continuation, conversation, and tool result ledger contracts", () => {
    const frame = RunContinuationFrameSchema.parse({
      id: "run-1:frame-0",
      runId: "run-1",
      status: "paused",
      reason: "approval_required",
      conversationCursor: 1,
      pendingActionIds: ["run-1:action:tool-0"],
      pendingToolCallIds: ["run-1:tool-call-0"],
      createdAt: 1,
      updatedAt: 1,
    });
    expect(frame.pendingClarificationIds).toEqual([]);

    expect(() =>
      RunContinuationFrameSchema.parse({
        ...frame,
        status: "waiting",
      })
    ).toThrow();

    expect(RuntimeConversationEntrySchema.parse({
      role: "tool",
      toolCallId: "run-1:tool-call-0",
      providerCallId: "call-0",
      toolId: "skills.create",
      status: "succeeded",
      content: "{\"name\":\"think\"}",
      createdAt: 2,
    }).status).toBe("succeeded");

    expect(RuntimeToolResultLedgerEntrySchema.parse({
      key: "skills.create:abc",
      toolId: "skills.create",
      argsDigest: "abc",
      resultToolCallId: "run-1:tool-call-0",
      status: "succeeded",
      output: { name: "think" },
      createdAt: 2,
      updatedAt: 2,
    }).toolId).toBe("skills.create");
  });


  it("validates channel connector contracts", () => {
    const config = ChannelConfigSchema.parse({
      channelId: "channel-http",
      kind: "http_webhook",
      label: "HTTP Webhook",
      config: { callbackUrl: "http://localhost:9876/callback", token: "secret" },
      createdAt: 1,
      updatedAt: 1
    });
    expect(config.enabled).toBe(true);
    expect(config.capabilities.supportsFileOutbound).toBe(false);

    const inbound = ChannelInboundMessageSchema.parse({
      id: "inbound-1",
      channelId: config.channelId,
      channelKind: config.kind,
      externalMessageId: "msg-1",
      externalChatId: "chat-1",
      text: "hello ora",
      receivedAt: 2
    });
    expect(inbound.type).toBe("chat");
    expect(inbound.attachments).toEqual([]);

    const binding = ChannelBindingSchema.parse({
      bindingId: "binding-1",
      channelId: config.channelId,
      externalChatId: inbound.externalChatId,
      sessionId: "session-1",
      createdAt: 2,
      updatedAt: 2
    });
    expect(binding.metadata).toEqual({});

    const outbound = ChannelOutboundMessageSchema.parse({
      id: "outbound-1",
      channelId: config.channelId,
      bindingId: binding.bindingId,
      sessionId: binding.sessionId,
      runId: "run-1",
      externalChatId: inbound.externalChatId,
      inReplyToExternalMessageId: inbound.externalMessageId,
      text: "hello back",
      isFinal: true,
      kind: "final",
      createdAt: 3
    });
    expect(outbound.attachments).toEqual([]);

    const delivery = ChannelDeliverySchema.parse({
      deliveryId: "delivery-1",
      channelId: config.channelId,
      outboundMessageId: outbound.id,
      sessionId: binding.sessionId,
      runId: outbound.runId,
      status: "queued",
      attemptCount: 0,
      message: outbound,
      createdAt: 3,
      updatedAt: 3
    });
    expect(delivery.status).toBe("queued");

    expect(ChannelIngestParamsSchema.parse({
      channelId: config.channelId,
      externalMessageId: "msg-2",
      externalChatId: "chat-1",
      text: "next"
    }).type).toBe("chat");
    expect(ChannelDeliveryRetryParamsSchema.parse({ deliveryId: delivery.deliveryId }).deliveryId).toBe(delivery.deliveryId);

    expect(() => ChannelConfigSchema.parse({ ...config, channelId: "" })).toThrow();
    expect(() => ChannelDeliverySchema.parse({ ...delivery, status: "lost" })).toThrow();
    expect(() => ChannelInboundMessageSchema.parse({ ...inbound, externalMessageId: "" })).toThrow();
    expect(() => ChannelOutboundMessageSchema.parse({ ...outbound, kind: "unknown" })).toThrow();
  });

  it("validates run latency diagnostics contracts", () => {
    const latency = RunLatencyDiagnosticsSchema.parse({
      marks: [
        { name: "startStreamingRun.enter", at: 100, source: "runtime" },
        { name: "firstRunStreamReceivedAt", at: 150, source: "desktop", detail: { eventType: "run.started" } },
      ],
    });
    expect(latency.marks[0]?.detail).toEqual({});
    expect(latency.marks[1]?.detail.eventType).toBe("run.started");
  });

  it("validates Self-Iteration contracts", () => {
    const candidate = SelfIterationCandidateSchema.parse({
      id: "project-1:self:evaluation:feedback-1",
      projectId: "project-1",
      targetKind: "evaluation",
      targetRef: { kind: "evaluation", id: "feedback-1", feedbackId: "feedback-1" },
      title: "Turn feedback into an Evaluation case",
      summary: "The response missed a cited requirement.",
      evidence: [{
        id: "feedback-1",
        label: "Feedback",
        target: { kind: "feedback", id: "feedback-1", feedbackId: "feedback-1" },
      }],
      proposedChange: {
        operation: "evaluation.feedback.accept",
        title: "Accept feedback",
        summary: "Add as regression material.",
      },
      riskLevel: "low",
      status: "draft",
      createdAt: 1,
      updatedAt: 1,
    });
    expect(candidate.proposedChange.metadata).toEqual({});

    const policy = SelfIterationPolicySchema.parse({ projectId: "project-1", updatedAt: 2 });
    expect(policy.autonomy).toBe("low_risk_auto");
    expect(policy.evaluationAutoApply).toBe(true);
    expect(policy.skillApplyRequiresConfirmation).toBe(true);
    expect(policy.curatorEnabled).toBe(true);
    expect(policy.scanCadenceMs).toBe(5 * 60 * 1000);
    expect(policy.environmentObserver).toMatchObject({
      enabled: false,
      paused: false,
      watchedPaths: ["."],
      scanBudgetFiles: 200,
      maxFileBytes: 512_000,
    });
    expect(SelfIterationCuratorTriggerSchema.parse("feedback_submitted")).toBe("feedback_submitted");
    expect(SelfIterationCuratorTriggerSchema.parse("feedback_accepted")).toBe("feedback_accepted");

    expect(SelfIterationCandidateApplyParamsSchema.parse({ candidateId: candidate.id }).confirmed).toBe(false);
    expect(SelfIterationRunSchema.parse({
      id: "self-iteration-run-1",
      projectId: "project-1",
      kind: "scan",
      message: "Scanned.",
      createdAt: 3,
    }).candidateIds).toEqual([]);
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
        method: "agents.generateDraft",
        params: {
          messages: [{ role: "user", content: "I need a research agent for product strategy." }],
          providerId: "local-smoke",
          modelRef: "local/smoke-model"
        }
      }).method
    ).toBe("agents.generateDraft");

    expect(
      JsonRpcRequestSchema.parse({
        jsonrpc: "2.0",
        id: 4,
        method: "agents.catalog"
      }).method
    ).toBe("agents.catalog");

    expect(
      JsonRpcRequestSchema.parse({
        jsonrpc: "2.0",
        id: 5,
        method: "agents.updateSystemOverride",
        params: { agentId: "researcher", role: "Research deeply." }
      }).method
    ).toBe("agents.updateSystemOverride");

    expect(
      JsonRpcRequestSchema.parse({
        jsonrpc: "2.0",
        id: 6,
        method: "skills.setEnabled",
        params: { name: "custom-review", enabled: true }
      }).method
    ).toBe("skills.setEnabled");

    expect(
      JsonRpcRequestSchema.parse({
        jsonrpc: "2.0",
        id: 7,
        method: "skills.file.get",
        params: { skillName: "custom-review", path: "scripts/run.sh" }
      }).method
    ).toBe("skills.file.get");

    expect(
      JsonRpcRequestSchema.parse({
        jsonrpc: "2.0",
        id: 5,
        method: "projects.files",
        params: { projectId: "project-0001" }
      }).method
    ).toBe("projects.files");

    expect(
      JsonRpcRequestSchema.parse({
        jsonrpc: "2.0",
        id: 8,
        method: "channels.create",
        params: { label: "HTTP Webhook", kind: "http_webhook" }
      }).method
    ).toBe("channels.create");

    expect(
      JsonRpcRequestSchema.parse({
        jsonrpc: "2.0",
        id: 9,
        method: "channels.ingest",
        params: { channelId: "channel-http", externalMessageId: "msg-1", externalChatId: "chat-1", text: "hello" }
      }).method
    ).toBe("channels.ingest");

    expect(RuntimeJsonRpcMethodSchema.parse("channels.wechat.requestQrCode")).toBe("channels.wechat.requestQrCode");
    expect(RuntimeJsonRpcMethodSchema.parse("channels.wechat.pollQrCodeStatus")).toBe("channels.wechat.pollQrCodeStatus");

    expect(RuntimeJsonRpcMethodSchema.parse("selfIteration.scan")).toBe("selfIteration.scan");
    expect(RuntimeJsonRpcMethodSchema.parse("selfIteration.candidates.apply")).toBe("selfIteration.candidates.apply");
    expect(ProjectSignalActionSchema.parse({
      id: "draft-self-iteration",
      kind: "draft_self_iteration_candidate",
      label: "Draft Self-Iteration candidate",
      payload: {},
      requiresConfirmation: true,
    }).kind).toBe("draft_self_iteration_candidate");

    expect(
      JsonRpcResponseSchema.parse({
        jsonrpc: "2.0",
        id: 1,
        result: { ok: true }
      }).jsonrpc
    ).toBe("2.0");

    expect(
      JsonRpcResponseSchema.parse({
        jsonrpc: "2.0",
        id: 2,
        result: null
      }).result
    ).toBeNull();

    expect(
      JsonRpcResponseSchema.safeParse({
        jsonrpc: "2.0",
        id: 3
      }).success
    ).toBe(false);

    expect(
      JsonRpcResponseSchema.safeParse({
        jsonrpc: "2.0",
        id: 4,
        result: undefined
      }).success
    ).toBe(false);
  });

  it("validates custom agent draft generation contracts", () => {
    expect(
      CustomAgentGenerateDraftParamsSchema.parse({
        messages: [
          { role: "user", content: "帮我创建一个会做香港市场研究的智能体。" },
          { role: "assistant", content: "需要偏事实核查还是策略建议？" },
          { role: "user", content: "偏事实核查，输出要带来源和风险。" }
        ],
        partialDraft: { toolGroups: ["web", "github"] },
        providerId: "local-smoke",
        modelRef: "local/smoke-model"
      }).messages
    ).toHaveLength(3);

    const ready = CustomAgentGenerateDraftResultSchema.parse({
      status: "draft_ready",
      assistantMessage: "我生成了一版研究智能体，请确认。",
      draft: {
        name: "researcher-hk",
        description: "Research Hong Kong market questions with sourced findings.",
        model: "claude-sonnet-4-20250514",
        toolGroups: ["web", "github"],
        soul: "Act as a careful market researcher."
      }
    });
    expect(ready.status).toBe("draft_ready");

    const followUp = CustomAgentGenerateDraftResultSchema.parse({
      status: "needs_input",
      assistantMessage: "这个智能体主要要帮你完成哪类任务？",
      issues: [{ field: "description", message: "Need a clearer purpose." }]
    });
    expect(followUp.status).toBe("needs_input");
  });

  it("validates Mode Studio guided builder contracts", () => {
    const params = ModeStudioGenerateDraftParamsSchema.parse({
      messages: [
        { role: "user", content: "做一个代码审查 mode，builder 产出后 reviewer 严格检查风险和测试。" }
      ],
      baseModeId: "generator_verifier",
      providerId: "local-smoke"
    });
    expect(params.messages[0]!.role).toBe("user");

    const guidance = ModeStudioGuidanceSchema.parse({
      step: "preview",
      assistantMessage: "我生成了一版草稿。",
      choices: [
        {
          id: "style-strict",
          label: "Make review stricter",
          description: "Tighten review criteria.",
          prompt: "让 reviewer 更严格。"
        }
      ]
    });
    expect(guidance.choices).toHaveLength(1);

    const modeDraft = {
      ...MVP_MODES[0]!,
      id: "code-review-mode",
      label: "Code Review Mode",
      systemPreset: false,
      profiles: MVP_MODES[0]!.profiles.map((profile) => ({
        ...profile,
        toolIds: ["file.read"],
      })),
    };
    const bundle = ModeStudioDraftBundleSchema.parse({
      modeDraft,
      agentDrafts: [],
      guidance,
      changeSummary: ["Selected generator-verifier topology."],
      validation: { valid: true, errors: [], warnings: [] },
      needsInput: false
    });
    expect(bundle.modeDraft.profiles[0]!.customAgentId).toBeUndefined();
    expect(ModeStudioApplyDraftParamsSchema.parse({ draftBundle: bundle }).saveAgentDrafts).toBe(true);

    const startParams = ModeStudioStartBuilderRunParamsSchema.parse({
      operation: "refine",
      messages: params.messages,
      baseModeId: "generator_verifier",
      currentDraft: modeDraft,
      draftBundle: bundle,
      providerId: "local-smoke",
    });
    expect(startParams.operation).toBe("refine");

    const handle = ModeStudioStartBuilderRunResultSchema.parse({
      runId: "run-builder-1",
      status: "succeeded",
      pattern: "agent_teams",
      modeId: MODE_STUDIO_BUILDER_MODE_ID,
      startedAt: 1,
    });
    expect(handle.modeId).toBe(MODE_STUDIO_BUILDER_MODE_ID);
    expect(ModeStudioBuilderResultParamsSchema.parse({ runId: handle.runId }).runId).toBe(handle.runId);
    const builderResult = ModeStudioBuilderResultSchema.parse({
      runId: handle.runId,
      status: "succeeded",
      draftBundle: bundle,
      issues: [],
    });
    expect(builderResult.draftBundle?.validation.valid).toBe(true);
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

    const objective = EvaluationObjectiveSchema.parse({
      kind: "classification",
      target: "runtime.mode_selection",
      metrics: ["acceptable_match", "assertion_pass_rate", "confidence_calibration"],
      assertions: [{
        type: "one_of",
        path: "runtime.modeId",
        values: ["deerflow_harness", "orchestrator_subagent"],
        weight: 1,
        failureTag: "wrong_mode",
      }],
      displayColumns: ["runtime.modeId", "runtime.autoModeRouter.confidence"],
    });
    expect(objective.target).toBe("runtime.mode_selection");

    const structuredExpected = EvaluationStructuredExpectedSchema.parse({
      assertions: [{
        type: "not_one_of",
        path: "runtime.modeId",
        values: ["single_agent"],
        weight: 0.5,
      }],
      preferred: {
        path: "runtime.modeId",
        value: "deerflow_harness",
      },
      goldRationale: "The task needs research and review before synthesis.",
    });
    expect(structuredExpected.preferred?.value).toBe("deerflow_harness");

    const objectiveSpec = EvaluationSpecSchema.parse({
      datasetId: dataset.id,
      objective,
      configs: [{
        id: "auto-router",
        label: "Auto Router",
        runConfig: {
          pattern: "orchestrator_subagent",
          modeSelection: "auto",
          metadata: { evaluationRouterOnly: true },
        },
      }],
    });
    expect(objectiveSpec.profileId).toBe("outcome");
    expect(objectiveSpec.objective?.metrics).toContain("acceptable_match");

    const blueprint = EvaluationBlueprintSchema.parse({
      id: "blueprint-0001",
      title: "Auto Router Quality",
      goal: "评估 Auto Mode Router 在多轮上下文后是否还能选对 mode。",
      recipe: "auto_router_quality",
      target: "runtime.mode_selection",
      subject: { kind: "auto_router" },
      datasetPlan: {
        datasetId: dataset.id,
        sources: ["existing_dataset"],
        caseRequirements: ["multi-turn context shift cases"],
        linkedDatasetIds: [dataset.id],
      },
      evaluatorPlan: {
        metrics: ["exact_match", "acceptable_match", "confidence_calibration"],
        assertions: [],
      },
      runPlan: {
        profileId: "outcome",
        providerId: "local-smoke",
        modelRef: "local/smoke-model",
        repetitions: 1,
        concurrency: 1,
        routerOnly: true,
      },
      reviewPlan: {
        emphasis: ["confusion matrix", "fallback count"],
        failureTags: ["wrong_mode"],
      },
      status: "draft",
      createdAt: 1,
      updatedAt: 1,
    });
    expect(blueprint.subject.kind).toBe("auto_router");
    expect(EvaluationBlueprintCreateParamsSchema.parse({
      title: blueprint.title,
      goal: blueprint.goal,
      recipe: blueprint.recipe,
      target: blueprint.target,
      subject: blueprint.subject,
      datasetPlan: blueprint.datasetPlan,
      evaluatorPlan: blueprint.evaluatorPlan,
      runPlan: blueprint.runPlan,
      reviewPlan: blueprint.reviewPlan,
    }).recipe).toBe("auto_router_quality");
    expect(EvaluationBlueprintGenerateDraftParamsSchema.parse({
      goal: blueprint.goal,
      datasetId: dataset.id,
    }).datasetId).toBe(dataset.id);
    const compileResult = EvaluationBlueprintCompileResultSchema.parse({
      blueprint,
      spec: objectiveSpec,
      warnings: [],
      assumptions: ["Router-only execution stops after mode selection."],
    });
    expect(compileResult.spec.objective?.target).toBe("runtime.mode_selection");

    const metricScore = EvaluationMetricScoreSchema.parse({
      metricId: "acceptable_match",
      score: 1,
      passed: true,
      rationale: "Selected mode is acceptable.",
      details: { selectedModeId: "deerflow_harness" },
    });
    expect(metricScore.passed).toBe(true);
    expect(EvaluationObservationSchema.parse({
      runtime: {
        modeId: "deerflow_harness",
        autoModeRouter: {
          status: "selected",
          confidence: 0.88,
          reason: "Needs decomposition.",
        },
      },
    }).runtime).toBeDefined();
  });

  it("validates evaluator specs, planner turns, and annotation tasks", () => {
    const evaluator = EvaluationEvaluatorSpecSchema.parse({
      id: "llm-judge",
      kind: "llm_judge",
      label: "LLM Judge",
      rubric: "Score whether the answer satisfies the case expectations.",
    });
    expect(evaluator.kind).toBe("llm_judge");

    const objective = EvaluationObjectiveSchema.parse({
      kind: "outcome",
      target: "run.output",
      evaluators: [
        { id: "heuristic", kind: "heuristic", label: "Rules", metrics: ["assertion_pass_rate"], assertions: [] },
        evaluator,
        { id: "human", kind: "human_annotation", label: "Human", instructions: "Review the answer.", scoreType: "boolean" },
      ],
    });
    expect(objective.evaluators).toHaveLength(3);

    const result = EvaluationEvaluatorResultSchema.parse({
      evaluatorId: "llm-judge",
      evaluatorKind: "llm_judge",
      score: 0.9,
      passed: true,
      rationale: "Meets the rubric.",
    });
    expect(result.status).toBe("scored");

    const planTurn = EvaluationBlueprintPlanTurnParamsSchema.parse({
      message: "Plan an eval with LLM judge and human annotation.",
    });
    expect(planTurn.message).toContain("LLM judge");

    const annotation = EvaluationAnnotationTaskSchema.parse({
      id: "annotation-0001",
      evaluationRunId: "eval-run-0001",
      attemptId: "attempt-0001",
      caseId: "case-0001",
      configId: "config-0001",
      evaluatorId: "human",
      instructions: "Review the answer.",
      scoreType: "boolean",
      input: { prompt: "Say hello." },
      createdAt: 1,
      updatedAt: 1,
    });
    expect(annotation.status).toBe("pending");
    expect(EvaluationAnnotationListParamsSchema.parse({ status: "pending", limit: 10 }).status).toBe("pending");
    expect(EvaluationAnnotationSubmitParamsSchema.parse({
      taskId: annotation.id,
      score: { value: true, normalizedScore: 1, passed: true },
    }).score.passed).toBe(true);

    const blueprint = EvaluationBlueprintSchema.parse({
      id: "blueprint-annotation",
      title: "Annotation Blueprint",
      goal: "Test planner output.",
      recipe: "mode_comparison",
      target: "run.output",
      subject: { kind: "mode_matrix", modeIds: ["orchestrator_subagent"] },
      datasetPlan: { sources: ["manual"], caseRequirements: [] },
      evaluatorPlan: { metrics: [], assertions: [], evaluators: objective.evaluators },
      runPlan: { profileId: "outcome", repetitions: 1, concurrency: 1 },
      reviewPlan: { emphasis: [], failureTags: [] },
      createdAt: 1,
      updatedAt: 1,
    });
    const turnResult = EvaluationBlueprintPlanTurnResultSchema.parse({
      blueprint,
      messages: [{ id: "m1", role: "assistant", content: "Planned.", createdAt: 1 }],
      assistantMessage: { id: "m1", role: "assistant", content: "Planned.", createdAt: 1 },
    });
    expect(turnResult.blueprint.evaluatorPlan.evaluators).toHaveLength(3);
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
    expect(parsed.skills[0]?.files ?? []).toEqual([]);
  });

  it("accepts managed skill detail and mutation params", () => {
    const publicDetail = SkillDetailSchema.parse({
      id: "public-review",
      name: "public-review",
      description: "Packaged default review rules.",
      category: "public",
      editable: true,
      content: "---\nname: public-review\ndescription: Packaged default review rules.\n---\n\n# public-review"
    });
    expect(publicDetail.editable).toBe(true);
    expect(publicDetail.files ?? []).toEqual([]);

    const detail = SkillDetailSchema.parse({
      id: "custom-review",
      name: "custom-review",
      description: "Review with local project rules.",
      category: "private",
      enabled: false,
      editable: true,
      content: "---\nname: custom-review\ndescription: Review with local project rules.\n---\n\n# custom-review"
    });

    expect(detail.name).toBe("custom-review");
    expect(detail.category).toBe("private");
    expect(SkillDetailSchema.parse({ ...detail, category: "custom" }).category).toBe("private");
    expect(SkillCreateParamsSchema.parse({
      name: "custom-review",
      files: [{ path: "scripts/run.sh", content: "echo ok\n", executable: true }]
    }).files[0]?.path).toBe("scripts/run.sh");
    expect(SkillCreateParamsSchema.parse({ name: "custom-review" }).enabled).toBe(true);
    expect(SkillUpdateParamsSchema.parse({
      name: "custom-review",
      nextName: "custom-review-v2",
      content: detail.content,
      files: [{ path: "agents/reviewer.yaml", content: "name: reviewer\n" }]
    }).nextName).toBe("custom-review-v2");
    expect(SkillSetEnabledParamsSchema.parse({ name: "custom-review", enabled: true }).enabled).toBe(true);
    expect(SkillCheckNameResultSchema.parse({ name: "custom-review", available: false }).available).toBe(false);
    expect(SkillFileGetParamsSchema.parse({ skillName: "custom-review", path: "scripts/run.sh" }).path).toBe("scripts/run.sh");
    expect(SkillFileUpsertParamsSchema.parse({ skillName: "custom-review", path: "scripts/run.sh", content: "echo ok\n" }).content).toBe("echo ok\n");
    expect(SkillFileDeleteParamsSchema.parse({ skillName: "custom-review", path: "scripts/run.sh" }).skillName).toBe("custom-review");
    expect(SkillPackageFileContentSchema.parse({
      skillName: "custom-review",
      path: "scripts/run.sh",
      kind: "script",
      content: "echo ok\n",
      executable: true
    }).executable).toBe(true);
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
    expect(parsed.modes.filter((mode) => mode.visibility !== "internal")).toHaveLength(10);
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
      archivedAt: 2000,
    });

    expect(createParams.projectId).toBe("ora-mvp");
    expect(summary.turnCount).toBe(0);
    expect(summary.title).toBe("New Chat");
    expect(summary.archivedAt).toBe(2000);
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

  it("accepts project file list and preview payloads", () => {
    const filesParams = ProjectFilesParamsSchema.parse({ projectId: "project-0001" });
    const readParams = ProjectFileReadParamsSchema.parse({ projectId: "project-0001", path: "README.md" });
    const files = ProjectFilesResultSchema.parse({
      projectId: "project-0001",
      rootPath: "/Users/quintenchen/developer/ora",
      totalFiles: 1,
      files: [
        {
          path: "README.md",
          name: "README.md",
          sizeBytes: 42,
          modifiedAt: 1200,
          mimeType: "text/markdown",
        },
      ],
      truncated: false,
      skippedDirs: [".git", "node_modules"],
    });
    const preview = ProjectFileReadResultSchema.parse({
      projectId: "project-0001",
      rootPath: "/Users/quintenchen/developer/ora",
      path: "README.md",
      label: "README.md",
      mimeType: "text/markdown",
      previewKind: "text",
      sizeBytes: 42,
      modifiedAt: 1200,
      payload: "# Ora",
    });

    expect(filesParams.projectId).toBe("project-0001");
    expect(readParams.path).toBe("README.md");
    expect(files.files[0]?.mimeType).toBe("text/markdown");
    expect(preview.previewKind).toBe("text");
  });

  it("accepts feedback-loop signals, insights, actions, and rules", () => {
    const signal = ProjectSignalSchema.parse({
      id: "project-0001:signal:recovery:run-0001:4",
      projectId: "project-0001",
      source: "recovery_event",
      sourceRef: "run-0001:4",
      title: "Recovery exhausted",
      summary: "Run run-0001 exhausted recovery on the browser tool.",
      severity: "critical",
      confidence: 0.92,
      createdAt: 1200,
      updatedAt: 1200,
      evidence: [{
        id: "run-0001:evt-4",
        label: "Open Trails event",
        summary: "recovery.exhausted",
        target: {
          kind: "trail",
          id: "run-0001:evt-4",
          runId: "run-0001",
          eventSeq: 4,
          tabHint: "Events",
        },
      }],
      metadata: {
        modeId: "agent_teams",
        toolId: "web.search",
      },
    });

    const action = ProjectSignalActionSchema.parse({
      id: "open-trails-run-0001",
      kind: "open_trails",
      label: "Open Trails for run-0001",
      payload: { runId: "run-0001" },
      requiresConfirmation: true,
    });

    const insight = ProjectInsightSchema.parse({
      id: "project-0001:insight:repeated-recovery",
      projectId: "project-0001",
      title: "Recovery is recurring in agent_teams",
      summary: "Two recent runs exhausted recovery in the same mode.",
      status: "open",
      signalIds: [signal.id],
      recommendedActions: [action],
      confidence: 0.82,
      createdAt: 1200,
      updatedAt: 1200,
    });

    const rule = FeedbackLoopCalibrationRuleSchema.parse({
      id: "project-0001:rule:repeated_recovery_exhausted",
      projectId: "project-0001",
      name: "Repeated recovery exhausted",
      enabled: true,
      sourceFilters: ["recovery_event"],
      severityThreshold: "warning",
      humanReviewRequired: true,
      actionPolicy: {
        allowedActionKinds: ["open_trails", "create_evaluation_case"],
      },
    });

    expect(signal.evidence[0]?.target.kind).toBe("trail");
    expect(insight.recommendedActions[0]?.kind).toBe("open_trails");
    expect(rule.actionPolicy.allowedActionKinds).toContain("create_evaluation_case");

    expect(FeedbackLoopSignalsListParamsSchema.parse({ projectId: "project-0001", source: "recovery_event", limit: 25 }).source).toBe("recovery_event");
    expect(FeedbackLoopInsightsListParamsSchema.parse({ status: "open" }).status).toBe("open");
    expect(FeedbackLoopInsightGetParamsSchema.parse({ insightId: insight.id }).insightId).toBe(insight.id);
    expect(FeedbackLoopInsightDismissParamsSchema.parse({ insightId: insight.id, reason: "Handled elsewhere" }).reason).toBe("Handled elsewhere");
    expect(FeedbackLoopActionPreviewParamsSchema.parse({ insightId: insight.id, actionId: action.id }).actionId).toBe(action.id);
    expect(FeedbackLoopActionApplyParamsSchema.parse({ insightId: insight.id, actionId: action.id, confirmed: true }).confirmed).toBe(true);
    expect(FeedbackLoopActionResultSchema.parse({
      insight,
      action,
      status: "preview",
      message: "Open Trails for run-level evidence.",
    }).status).toBe("preview");
    expect(FeedbackLoopRulesListParamsSchema.parse({ projectId: "project-0001" }).projectId).toBe("project-0001");
    expect(FeedbackLoopRuleUpdateParamsSchema.parse({ rule }).rule.id).toBe(rule.id);
  });

  it("includes feedback-loop methods in the known JSON-RPC method enum", () => {
    expect(RuntimeJsonRpcMethodSchema.parse("feedbackLoop.signals.list")).toBe("feedbackLoop.signals.list");
    expect(RuntimeJsonRpcMethodSchema.parse("feedbackLoop.insights.list")).toBe("feedbackLoop.insights.list");
    expect(RuntimeJsonRpcMethodSchema.parse("feedbackLoop.actions.apply")).toBe("feedbackLoop.actions.apply");
    expect(RuntimeJsonRpcMethodSchema.parse("feedbackLoop.rules.update")).toBe("feedbackLoop.rules.update");
    expect(RuntimeJsonRpcMethodSchema.parse("modeStudio.generateDraft")).toBe("modeStudio.generateDraft");
    expect(RuntimeJsonRpcMethodSchema.parse("modeStudio.applyDraft")).toBe("modeStudio.applyDraft");
    expect(RuntimeJsonRpcMethodSchema.parse("skills.file.get")).toBe("skills.file.get");
    expect(RuntimeJsonRpcMethodSchema.parse("skills.file.upsert")).toBe("skills.file.upsert");
    expect(RuntimeJsonRpcMethodSchema.parse("skills.file.delete")).toBe("skills.file.delete");
  });
});

describe("Custom agent contracts", () => {
  it("accepts custom agent summary and detail payloads", () => {
    const summary = CustomAgentSummarySchema.parse({
      name: "research-bot",
      description: "Focuses on concise research synthesis.",
      model: "claude-sonnet-4-20250514",
      toolGroups: ["web", "files"],
      toolIds: ["web.search", "web.fetch"],
      skillIds: ["long-task-protocol"],
      createdAt: 1000,
      updatedAt: 1200,
    });

    const detail = CustomAgentDetailSchema.parse({
      ...summary,
      soul: "Stay concise and source-backed.",
    });

    expect(detail.name).toBe("research-bot");
    expect(detail.toolIds).toEqual(["web.search", "web.fetch"]);
    expect(detail.skillIds).toEqual(["long-task-protocol"]);
    expect(detail.soul).toContain("source-backed");
  });

  it("accepts create/update payloads and check-name results", () => {
    const createParams = CustomAgentCreateParamsSchema.parse({
      name: "review-bot",
      description: "Surfaces risks before merge.",
      toolGroups: ["files"],
      toolIds: ["file.read", "file.grep"],
      skillIds: ["review"],
      soul: "Default to a review mindset.",
    });
    const updateParams = CustomAgentUpdateParamsSchema.parse({
      name: "review-bot",
      model: "gpt-5.4",
      toolIds: null,
      skillIds: ["check"],
      soul: "Look for regressions first.",
    });
    const checkResult = CustomAgentCheckNameResultSchema.parse({
      available: true,
      name: "review-bot",
    });

    expect(createParams.name).toBe("review-bot");
    expect(createParams.toolIds).toEqual(["file.read", "file.grep"]);
    expect(updateParams.model).toBe("gpt-5.4");
    expect(updateParams.toolIds).toBeNull();
    expect(updateParams.skillIds).toEqual(["check"]);
    expect(checkResult.available).toBe(true);
  });
});

describe("Unified agent catalog contracts", () => {
  it("accepts system/custom catalog items and override payloads", () => {
    const overrideParams = SystemAgentOverrideUpdateParamsSchema.parse({
      agentId: "researcher",
      label: "Researcher",
      role: "Gather evidence before synthesis.",
      modelRef: "gpt-5.4",
      toolIds: ["web.search"],
      skillIds: ["read"],
      soul: "Prefer cited evidence.",
    });
    const legacyOverrideParams = SystemAgentOverrideUpdateParamsSchema.parse({ agentId: "research_subagent" });
    const resetParams = SystemAgentOverrideResetParamsSchema.parse({ agentId: "researcher" });
    const systemAgent = SystemAgentCatalogItemSchema.parse({
      source: "system",
      id: "researcher",
      label: "Researcher",
      role: "Gather focused context.",
      modelRef: "local/smoke-model",
      toolPolicyId: "orchestrator_subagent.default_policy",
      toolIds: ["web.search"],
      skillIds: [],
      memoryNamespaces: ["session", "project"],
      overridden: true,
      override: {
        agentId: "researcher",
        role: "Gather evidence before synthesis.",
        soul: "Prefer cited evidence.",
        createdAt: 1000,
        updatedAt: 1200,
      },
      usages: [{
        modeId: "deerflow_harness",
        modeLabel: "DeerFlow-like Harness",
        systemPreset: true,
        profileId: "researcher",
        profileLabel: "Researcher",
      }],
    });
    const customAgent = CustomAgentCatalogItemSchema.parse({
      source: "custom",
      name: "research-bot",
      description: "Custom research persona.",
      toolIds: ["web.search"],
      skillIds: ["read"],
      createdAt: 1000,
      updatedAt: 1200,
      usages: [{
        modeId: "research-team",
        modeLabel: "Research Team",
        systemPreset: false,
        profileId: "researcher",
        profileLabel: "Researcher",
      }],
    });
    const catalog = AgentCatalogResultSchema.parse({
      systemAgents: [systemAgent],
      customAgents: [customAgent],
    });

    expect(overrideParams.agentId).toBe("researcher");
    expect(legacyOverrideParams.agentId).toBe("research_subagent");
    expect(resetParams.agentId).toBe("researcher");
    expect(catalog.systemAgents[0].overridden).toBe(true);
    expect(catalog.customAgents[0].usages[0].modeId).toBe("research-team");
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
