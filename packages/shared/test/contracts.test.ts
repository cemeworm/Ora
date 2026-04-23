import { describe, expect, it } from "vitest";
import {
  AgentProfileSchema,
  ApprovalDecisionSchema,
  ApprovalRequestSchema,
  DEFAULT_PROVIDERS,
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
  RunConfigSchema,
  RunEventStreamSchema,
  RunForkParamsSchema,
  RunReplayParamsSchema,
  RunResumeParamsSchema,
  RunSummarySchema,
  SessionConfigSchema,
  ToolDescriptorSchema,
  ToolRegistrySchema
} from "../src/index.js";

describe("Ora shared contracts", () => {
  it("validates all MVP pattern fixtures", () => {
    expect(MVP_PATTERNS).toHaveLength(3);

    for (const pattern of MVP_PATTERNS) {
      expect(PatternDefinitionSchema.parse(pattern).id).toBe(pattern.id);
      expect(pattern.topology.nodes.length).toBeGreaterThan(1);
      expect(pattern.planTemplate.length).toBeGreaterThan(0);
    }
  });

  it("defaults run config to the product default pattern", () => {
    const config = RunConfigSchema.parse({});

    expect(config.pattern).toBe("orchestrator_subagent");
    expect(config.modelRef).toBe("local/smoke-model");
    expect(config.providerId).toBeUndefined();
    expect(config.providerConfig).toBeUndefined();
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
