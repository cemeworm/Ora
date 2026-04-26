import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ActionRecordSchema,
  ArtifactRefSchema,
  EvaluationBaselineSchema,
  EvaluationDatasetDetailSchema,
  EvaluationExportResultSchema,
  EvaluationFeedbackRecordSchema,
  EvaluationRunDetailSchema,
  EvaluationRunSchema,
  FeedbackLoopActionResultSchema,
  FeedbackLoopCalibrationRuleSchema,
  ProviderRegistrySchema,
  ProjectInsightSchema,
  ProjectSignalSchema,
  RunTrailSchema,
  getPatternDefinition,
  MemoryRecordSchema,
  PlanItemSchema,
  PolicyDecisionSchema,
  StateSnapshotSchema
} from "@ora/shared";
import {
  ActionLedger,
  AgentProfileRegistry,
  MemoryService,
  PlanService,
  PolicyService
} from "../src/capabilities.js";
import { FileLongTermMemoryStore, LongTermMemoryManager } from "../src/memory.js";
import { shutdownLangfuseTelemetry } from "../src/telemetry/langfuse.js";
import { LocalRunStore, createRuntimeMethodHandler } from "../src/index.js";

// Fixed clock for deterministic assertions
const FIXED_TIME = 1_700_000_000_000;
const clock = () => FIXED_TIME;

// Temp directory management
let tempDir: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ora-runtime-integration-"));
});

afterEach(async () => {
  await shutdownLangfuseTelemetry();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function createStore(): LocalRunStore {
  return new LocalRunStore({ dataDir: tempDir, clock });
}

function freshStoreDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ora-runtime-integration-fresh-"));
}

// ---------------------------------------------------------------------------
// ActionLedger
// ---------------------------------------------------------------------------

describe("ActionLedger", () => {
  it("proposes, transitions through lifecycle states", () => {
    const ledger = new ActionLedger("run-1");
    const proposed = ledger.propose({
      id: "write-file",
      type: "file.write",
      riskLevel: "high",
      input: { path: "/tmp/test.txt", content: "hello" },
      agentId: "orchestrator"
    });

    expect(proposed.status).toBe("proposed");
    expect(proposed.riskLevel).toBe("high");
    expect(proposed.runId).toBe("run-1");
    ActionRecordSchema.parse(proposed);

    const approvalRequired = ledger.transition(proposed.id, "approval_required");
    expect(approvalRequired.status).toBe("approval_required");

    const approved = ledger.transition(proposed.id, "approved");
    expect(approved.status).toBe("approved");

    const running = ledger.transition(proposed.id, "running");
    expect(running.status).toBe("running");

    const succeeded = ledger.transition(proposed.id, "succeeded", {
      output: { bytesWritten: 5 }
    });
    expect(succeeded.status).toBe("succeeded");
    expect(succeeded.output).toEqual({ bytesWritten: 5 });
    ActionRecordSchema.parse(succeeded);
  });

  it("tracks artifact IDs across transitions", () => {
    const ledger = new ActionLedger("run-2");
    const action = ledger.propose({
      id: "gen-report",
      type: "export.report",
      riskLevel: "low",
      input: {}
    });

    const withArtifact = ledger.transition(action.id, "succeeded", {
      artifactIds: ["artifact-1", "artifact-2"]
    });
    expect(withArtifact.artifactIds).toEqual(["artifact-1", "artifact-2"]);
    ActionRecordSchema.parse(withArtifact);
  });
});

// ---------------------------------------------------------------------------
// MemoryService
// ---------------------------------------------------------------------------

describe("MemoryService", () => {
  it("creates records with correct namespaces", () => {
    const service = new MemoryService("run-3", clock);
    const record = service.remember({
      id: "ctx",
      namespace: ["session", "project-x", "orchestrator_subagent"],
      kind: "session",
      value: { notes: "gathered context" },
      sourceActionId: "run-3:action:research"
    });

    expect(record.namespace).toEqual(["session", "project-x", "orchestrator_subagent"]);
    expect(record.kind).toBe("session");
    expect(record.id).toBe("run-3:memory:ctx");
    expect(record.sourceRunId).toBe("run-3");
    MemoryRecordSchema.parse(record);

    const list = service.list();
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe(record.id);
  });
});

describe("LongTermMemoryManager", () => {
  it("persists durable facts and formats them for prompt injection", () => {
    const manager = new LongTermMemoryManager(new FileLongTermMemoryStore(tempDir), clock);
    const snapshot = StateSnapshotSchema.parse({
      runId: "run-memory-1",
      status: "succeeded",
      pattern: "orchestrator_subagent",
      modeId: "orchestrator_subagent",
      input: {
        prompt: "记住：以后默认把 Ora memory 做成长期画像和 facts，而不是只展示 session 上下文。",
        context: {},
        createdAt: clock(),
      },
      config: {
        pattern: "orchestrator_subagent",
        profileIds: [],
        skillIds: [],
        toolIds: [],
        modelRef: "local/smoke-model",
        approvalMode: "high_risk_only",
        patternOptions: {},
        metadata: {},
        deterministicSeed: "test",
      },
      topology: { nodes: [], edges: [] },
      profiles: [],
      memory: [],
      plan: [],
      todos: [],
      actions: [],
      policyDecisions: [],
      checkpoints: [],
      events: [],
      artifacts: [],
      activeAgents: [],
      queueSummary: {},
      sharedStateSummary: {},
      busStats: {},
      pendingClarifications: [],
      pendingApprovals: [],
      updatedAt: clock(),
    });

    const { memory, factsAdded } = manager.updateFromRun(snapshot);

    expect(factsAdded).toHaveLength(1);
    expect(memory.facts[0]?.category).toBe("preference");
    expect(memory.user.topOfMind.summary).toContain("长期画像");

    const reloaded = new LongTermMemoryManager(new FileLongTermMemoryStore(tempDir), clock).get();
    expect(reloaded.facts[0]?.content).toContain("长期画像");
    expect(manager.formatForInjection()).toContain("Long-term Facts");
  });

  it("uses provider patches before falling back to heuristic extraction", async () => {
    const manager = new LongTermMemoryManager(new FileLongTermMemoryStore(tempDir), clock);
    const snapshot = StateSnapshotSchema.parse({
      runId: "run-memory-provider",
      status: "succeeded",
      pattern: "orchestrator_subagent",
      modeId: "orchestrator_subagent",
      input: { prompt: "Please remember my preferred memory design.", context: {}, createdAt: clock() },
      config: {
        pattern: "orchestrator_subagent",
        profileIds: [],
        skillIds: [],
        toolIds: [],
        modelRef: "local/smoke-model",
        approvalMode: "high_risk_only",
        patternOptions: {},
        metadata: {},
        deterministicSeed: "test",
      },
      topology: { nodes: [], edges: [] },
      profiles: [],
      memory: [],
      plan: [],
      todos: [],
      actions: [],
      policyDecisions: [],
      checkpoints: [],
      events: [],
      artifacts: [],
      activeAgents: [],
      queueSummary: {},
      sharedStateSummary: {},
      busStats: {},
      pendingClarifications: [],
      pendingApprovals: [],
      updatedAt: clock(),
    });

    const { memory, factsAdded } = await manager.updateFromRunWithProvider({
      snapshot,
      assistantText: "",
      conversationMessages: [{ role: "user", content: snapshot.input.prompt }],
      policy: {
        enabled: true,
        updater: "provider",
        debounceMs: 0,
        factConfidenceThreshold: 0.7,
        maxFacts: 120,
        injectionMaxFacts: 24,
      },
      invokeModel: async () => JSON.stringify({
        user: { topOfMind: { shouldUpdate: true, summary: "Prefers provider-backed memory patches." } },
        history: { recentMonths: { shouldUpdate: true, summary: "Iterated on Ora memory." } },
        newFacts: [{ content: "User prefers provider-backed memory patches over raw session dumps.", category: "preference", confidence: 0.94 }],
        factsToRemove: [],
      }),
    });

    expect(factsAdded).toHaveLength(1);
    expect(memory.user.topOfMind.summary).toContain("provider-backed");
    expect(memory.facts[0]?.content).toContain("provider-backed memory patches");
  });
});

// ---------------------------------------------------------------------------
// PlanService
// ---------------------------------------------------------------------------

describe("PlanService", () => {
  it("creates items from pattern template, tracks dependencies", () => {
    const definition = getPatternDefinition("orchestrator_subagent");
    const service = new PlanService("run-4", definition);
    const items = service.list();

    expect(items.length).toBe(definition.planTemplate.length);

    // First item should be ready
    expect(items[0]?.status).toBe("ready");
    expect(items[0]?.id).toBe("run-4:decompose");

    // Subsequent items should be planned
    expect(items[1]?.status).toBe("planned");

    // Dependencies are namespaced to the run
    const research = items.find((item) => item.id === "run-4:research");
    expect(research?.dependencies).toContain("run-4:decompose");

    for (const item of items) {
      PlanItemSchema.parse(item);
    }
  });

  it("marks items ready based on dependency completion", () => {
    const definition = getPatternDefinition("orchestrator_subagent");
    const service = new PlanService("run-5", definition);

    // Mark first item done
    const items = service.list();
    const first = items[0]!;
    service.linkAction(first.id, "action-1");

    // Manually mark first as done (simulating completion)
    const allItems = service.markAll("done");
    // Reset items 2+ back to planned for testing
    for (let i = 1; i < allItems.length; i++) {
      allItems[i]!.status = "planned";
    }
    allItems[0]!.status = "done";

    // Trigger dependency resolution
    const resolved = service.markReadyByDependencies();
    // All items should be ready since first is done and their deps are satisfied
    // But only items whose ALL deps are done get promoted
    const research = resolved.find((item) => item.id === "run-5:research");
    expect(research?.status).toBe("ready");

    // All items should be valid PlanItems
    for (const item of resolved) {
      PlanItemSchema.parse(item);
    }
  });
});

// ---------------------------------------------------------------------------
// PolicyService
// ---------------------------------------------------------------------------

describe("PolicyService", () => {
  it("evaluates risk levels: high requires approval", () => {
    const service = new PolicyService("run-6", clock);

    const highAction = {
      id: "run-6:action:shell-cmd",
      runId: "run-6",
      type: "shell.execute",
      riskLevel: "high" as const,
      status: "proposed" as const,
      input: { command: "rm -rf /tmp/test" },
      artifactIds: []
    };

    const decision = service.evaluate(highAction);
    expect(decision.requiredApproval).toBe(true);
    expect(decision.reason).toContain("approval");
    expect(decision.policyId).toBe("runtime.default_policy");
    PolicyDecisionSchema.parse(decision);
  });

  it("evaluates risk levels: low/medium do not require approval", () => {
    const service = new PolicyService("run-7", clock);

    for (const riskLevel of ["low", "medium"] as const) {
      const action = {
        id: `run-7:action:test-${riskLevel}`,
        runId: "run-7",
        type: "file.read",
        riskLevel,
        status: "proposed" as const,
        input: {},
        artifactIds: []
      };

      const decision = service.evaluate(action);
      expect(decision.requiredApproval).toBe(false);
      PolicyDecisionSchema.parse(decision);
    }
  });

  it("uses agent-specific policy when agentId is present", () => {
    const service = new PolicyService("run-8", clock);

    const action = {
      id: "run-8:action:agent-action",
      runId: "run-8",
      agentId: "orchestrator",
      type: "shell.execute",
      riskLevel: "high" as const,
      status: "proposed" as const,
      input: {},
      artifactIds: []
    };

    const decision = service.evaluate(action);
    expect(decision.policyId).toBe("orchestrator.tool_policy");
  });
});

// ---------------------------------------------------------------------------
// AgentProfileRegistry
// ---------------------------------------------------------------------------

describe("AgentProfileRegistry", () => {
  it("lists all profiles for a pattern", () => {
    const definition = getPatternDefinition("orchestrator_subagent");
    const registry = new AgentProfileRegistry(definition);
    const profiles = registry.list();

    expect(profiles.length).toBe(definition.profiles.length);
    expect(profiles.map((p) => p.id)).toContain("orchestrator");
    expect(profiles.map((p) => p.id)).toContain("researcher");
    expect(profiles.map((p) => p.id)).toContain("reviewer");
  });

  it("filters profiles by ID", () => {
    const definition = getPatternDefinition("generator_verifier");
    const registry = new AgentProfileRegistry(definition);

    const filtered = registry.list(["generator"]);
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.id).toBe("generator");

    const empty = registry.list(["non-existent"]);
    expect(empty).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// LocalRunStore integration
// ---------------------------------------------------------------------------

describe("LocalRunStore", () => {
  it("exposes provider settings through the runtime contract", async () => {
    const handle = createRuntimeMethodHandler(createStore());
    const registry = ProviderRegistrySchema.parse(await handle({
      jsonrpc: "2.0",
      id: 1,
      method: "providers.list"
    }));

    expect(registry.defaultProviderId).toBe("local-smoke");
    expect(registry.providers.map((provider) => provider.id)).toContain("openai-gpt");
  });

  it("creates a run with valid StateSnapshot", async () => {
    const handle = createRuntimeMethodHandler(createStore());
    const result = await handle({
      jsonrpc: "2.0",
      id: 1,
      method: "runs.start",
      params: {
        input: { prompt: "Integration test run." },
        config: { pattern: "generator_verifier" }
      }
    }) as { runId: string; status: string };

    expect(result.status).toBe("succeeded");
    expect(result.runId).toMatch(/^run-\d{4}$/);

    const state = StateSnapshotSchema.parse(
      await handle({
        jsonrpc: "2.0",
        id: 2,
        method: "runs.state",
        params: { runId: result.runId }
      })
    );

    expect(state.runId).toBe(result.runId);
    expect(state.pattern).toBe("generator_verifier");
    expect(state.events.length).toBeGreaterThan(0);
    expect(state.profiles.length).toBeGreaterThan(0);
    expect(state.actions.length).toBeGreaterThan(0);
  });

  it("updates long-term memory after durable user signals and injects it into later runs", async () => {
    const store = createStore();
    const handle = createRuntimeMethodHandler(store);
    const first = await handle({
      jsonrpc: "2.0",
      id: 1,
      method: "runs.start",
      params: {
        input: { prompt: "记住：以后默认把 Ora memory 做成长期画像和 facts，而不是只展示 session 上下文。" },
        config: { pattern: "generator_verifier" }
      }
    }) as { runId: string };
    await store.flushLongTermMemoryUpdates();

    const firstState = StateSnapshotSchema.parse(await handle({
      jsonrpc: "2.0",
      id: 2,
      method: "runs.state",
      params: { runId: first.runId }
    }));
    const memory = await handle({
      jsonrpc: "2.0",
      id: 3,
      method: "memory.get",
    });

    expect(firstState.memory.some((record) => record.namespace.join("/") === "profile/long-term/preference")).toBe(true);
    expect(JSON.stringify(memory)).toContain("长期画像");

    const second = await handle({
      jsonrpc: "2.0",
      id: 4,
      method: "runs.start",
      params: {
        input: { prompt: "Use the default memory approach." },
        config: { pattern: "generator_verifier" }
      }
    }) as { runId: string };
    await store.flushLongTermMemoryUpdates();

    const secondState = StateSnapshotSchema.parse(await handle({
      jsonrpc: "2.0",
      id: 5,
      method: "runs.state",
      params: { runId: second.runId }
    }));

    expect(String(secondState.config.metadata.memoryPromptOverlay)).toContain("Long-term Facts");
    expect(String(secondState.config.metadata.memoryPromptOverlay)).toContain("长期画像");
  });

  it("returns an Ora-native local trail when Langfuse tracing is off", async () => {
    const previous = process.env.ORA_LANGFUSE_ENABLED;
    process.env.ORA_LANGFUSE_ENABLED = "false";
    try {
      const handle = createRuntimeMethodHandler(createStore());
      const result = await handle({
        jsonrpc: "2.0",
        id: 1,
        method: "runs.start",
        params: {
          input: { prompt: "Trail disabled test." },
          config: { pattern: "generator_verifier" }
        }
      }) as { runId: string };

      const trail = RunTrailSchema.parse(await handle({
        jsonrpc: "2.0",
        id: 2,
        method: "runs.trail",
        params: { runId: result.runId }
      }));

      expect(trail.trace.provider).toBe("ora");
      expect(trail.trace.enabled).toBe(true);
      expect(trail.trace.available).toBe(true);
      expect(trail.trace.source).toBe("local");
      expect(trail.observations.length).toBeGreaterThan(0);
      expect(trail.observations.some((observation) => observation.name === "run.started")).toBe(true);
      expect(trail.liveMetrics.eventCount).toBeGreaterThan(0);
    } finally {
      if (previous === undefined) {
        delete process.env.ORA_LANGFUSE_ENABLED;
      } else {
        process.env.ORA_LANGFUSE_ENABLED = previous;
      }
    }
  });

  it("returns locally synthesized trail observations when remote Langfuse fetch is unavailable", async () => {
    const previous = process.env.ORA_LANGFUSE_ENABLED;
    process.env.ORA_LANGFUSE_ENABLED = "true";
    try {
      const handle = createRuntimeMethodHandler(createStore());
      const result = await handle({
        jsonrpc: "2.0",
        id: 1,
        method: "runs.start",
        params: {
          input: { prompt: "Trail synthesis test." },
          config: { pattern: "orchestrator_subagent" }
        }
      }) as { runId: string };

      const state = StateSnapshotSchema.parse(await handle({
        jsonrpc: "2.0",
        id: 2,
        method: "runs.state",
        params: { runId: result.runId }
      }));
      expect(state.trace?.traceId).toBeTruthy();

      const trail = RunTrailSchema.parse(await handle({
        jsonrpc: "2.0",
        id: 3,
        method: "runs.trail",
        params: { runId: result.runId }
      }));

      expect(trail.trace.traceId).toBe(state.trace?.traceId);
      expect(["managed_local", "local_synthesized", "degraded"]).toContain(trail.trace.source);
      expect(trail.observations.length).toBeGreaterThan(0);
      expect(trail.observations.some((observation) => observation.metadata.source === "ora-runtime-event")).toBe(true);
      expect(trail.liveMetrics.eventCount).toBe(state.events.length);
    } finally {
      if (previous === undefined) {
        delete process.env.ORA_LANGFUSE_ENABLED;
      } else {
        process.env.ORA_LANGFUSE_ENABLED = previous;
      }
    }
  });

  it("persists and reloads runs from disk", async () => {
    const dir = freshStoreDir();
    const store1 = new LocalRunStore({ dataDir: dir, clock });
    const handle1 = createRuntimeMethodHandler(store1);

    const run = await handle1({
      jsonrpc: "2.0",
      id: 1,
      method: "runs.start",
      params: {
        input: { prompt: "Persist test." },
        config: { pattern: "orchestrator_subagent" }
      }
    }) as { runId: string };

    // Verify file was written to disk
    const runsDir = path.join(dir, "runs");
    const files = fs.readdirSync(runsDir).filter((f) => f.endsWith(".json"));
    expect(files.length).toBeGreaterThanOrEqual(1);

    // Create a new store from the same dir
    const store2 = new LocalRunStore({ dataDir: dir, clock });
    const handle2 = createRuntimeMethodHandler(store2);

    const list = await handle2({
      jsonrpc: "2.0",
      id: 2,
      method: "runs.list"
    }) as { runId: string }[];

    expect(list.map((r) => r.runId)).toContain(run.runId);

    // Clean up
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("handles interrupt/resume lifecycle", async () => {
    const handle = createRuntimeMethodHandler(createStore());

    const run = await handle({
      jsonrpc: "2.0",
      id: 1,
      method: "runs.start",
      params: {
        input: { prompt: "Interrupt test." },
        config: { pattern: "agent_teams" }
      }
    }) as { runId: string };

    const interrupted = StateSnapshotSchema.parse(
      await handle({
        jsonrpc: "2.0",
        id: 2,
        method: "runs.interrupt",
        params: { runId: run.runId, reason: "Testing interrupt." }
      })
    );
    expect(interrupted.status).toBe("interrupted");

    const resumed = StateSnapshotSchema.parse(
      await handle({
        jsonrpc: "2.0",
        id: 3,
        method: "runs.resume",
        params: { runId: run.runId }
      })
    );
    expect(resumed.status).toBe("succeeded");
    expect(resumed.events.map((e) => e.type)).toContain("run.resumed");
  });

  it("handles fork with checkpoint metadata", async () => {
    const handle = createRuntimeMethodHandler(createStore());

    const source = await handle({
      jsonrpc: "2.0",
      id: 1,
      method: "runs.start",
      params: {
        input: { prompt: "Fork test." },
        config: { pattern: "generator_verifier" }
      }
    }) as { runId: string };

    const state = StateSnapshotSchema.parse(
      await handle({
        jsonrpc: "2.0",
        id: 2,
        method: "runs.state",
        params: { runId: source.runId }
      })
    );

    expect(state.checkpoints.length).toBeGreaterThanOrEqual(1);

    const fork = await handle({
      jsonrpc: "2.0",
      id: 3,
      method: "runs.fork",
      params: {
        runId: source.runId,
        checkpointId: state.checkpoints[0]!.id,
        input: { prompt: "Forked prompt." }
      }
    }) as { runId: string; pattern: string; status: string };

    expect(fork.runId).not.toBe(source.runId);
    expect(fork.pattern).toBe("generator_verifier");
    expect(fork.status).toBe("succeeded");

    const forkState = StateSnapshotSchema.parse(
      await handle({
        jsonrpc: "2.0",
        id: 4,
        method: "runs.state",
        params: { runId: fork.runId }
      })
    );

    expect(forkState.events.map((e) => e.type)).toContain("run.forked");
    expect(forkState.config.metadata.forkedFromRunId).toBe(source.runId);
  });

  it("exports report artifacts", async () => {
    const dir = freshStoreDir();
    const store = new LocalRunStore({ dataDir: dir, clock });
    const handle = createRuntimeMethodHandler(store);

    const run = await handle({
      jsonrpc: "2.0",
      id: 1,
      method: "runs.start",
      params: {
        input: { prompt: "Report export test." },
        config: { pattern: "orchestrator_subagent" }
      }
    }) as { runId: string };

    const report = await handle({
      jsonrpc: "2.0",
      id: 2,
      method: "runs.exportReport",
      params: { runId: run.runId }
    }) as { kind: string; uri: string; payload: { eventCount: number } };

    expect(report.kind).toBe("report");
    expect(report.uri).toMatch(/^file:\/\//);
    expect(report.payload.eventCount).toBeGreaterThan(0);
    ArtifactRefSchema.parse(report);

    // Verify file exists on disk
    const filePath = decodeURIComponent(new URL(report.uri).pathname);
    expect(fs.existsSync(filePath)).toBe(true);

    // Verify the file content is valid JSON
    const content = JSON.parse(fs.readFileSync(filePath, "utf8"));
    expect(content.runId).toBe(run.runId);

    // Clean up
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("imports datasets and runs evaluations through the runtime contract", async () => {
    const handle = createRuntimeMethodHandler(createStore());
    const dataset = EvaluationDatasetDetailSchema.parse(await handle({
      jsonrpc: "2.0",
      id: 1,
      method: "evaluation.datasets.import",
      params: {
        name: "Smoke Eval Dataset",
        sourceFileName: "smoke.json",
        sourceFormat: "json",
        content: JSON.stringify([
          { id: "case-1", prompt: "Regression prompt", expected: "regression prompt" },
          { id: "case-2", prompt: "Lab prompt", metadata: { taskType: "analysis", difficulty: "easy", tags: ["lab"] } },
        ]),
      }
    }));
    expect(dataset.dataset.caseCount).toBe(2);

    const detail = EvaluationRunDetailSchema.parse(await handle({
      jsonrpc: "2.0",
      id: 2,
      method: "evaluation.runs.start",
      params: {
        datasetId: dataset.dataset.id,
        profileId: "outcome",
        repetitions: 1,
        concurrency: 1,
        configs: [
          {
            id: "orchestrator",
            label: "Orchestrator",
            runConfig: { pattern: "orchestrator_subagent", modelRef: "local/smoke-model" }
          },
          {
            id: "team",
            label: "Agent Teams",
            runConfig: { pattern: "agent_teams", modelRef: "local/smoke-model" }
          }
        ],
        metadata: {},
      }
    }));
    expect(detail.attempts.length).toBe(4);
    expect(detail.run.caseResults.length).toBe(4);
    expect(detail.run.scorecard.configSummaries).toHaveLength(2);
    expect(detail.attempts.every((attempt) => attempt.underlyingRunId?.startsWith("run-"))).toBe(true);

    const runSummaryList = EvaluationRunSchema.array().parse(await handle({
      jsonrpc: "2.0",
      id: 3,
      method: "evaluation.runs.list",
      params: { datasetId: dataset.dataset.id }
    }));
    expect(runSummaryList.map((run) => run.id)).toContain(detail.run.id);

    const stream = await handle({
      jsonrpc: "2.0",
      id: 4,
      method: "evaluation.runs.stream",
      params: { evaluationRunId: detail.run.id }
    }) as { events: Array<{ type: string }> };
    expect(stream.events.some((event) => event.type === "evaluation.attempt.completed")).toBe(true);

    const baseline = EvaluationBaselineSchema.parse(await handle({
      jsonrpc: "2.0",
      id: 5,
      method: "evaluation.runs.promoteBaseline",
      params: { evaluationRunId: detail.run.id, configId: "orchestrator", name: "Smoke baseline" }
    }));
    expect(baseline.configId).toBe("orchestrator");

    const exportResult = EvaluationExportResultSchema.parse(await handle({
      jsonrpc: "2.0",
      id: 6,
      method: "evaluation.runs.export",
      params: { evaluationRunId: detail.run.id, format: "csv" }
    }));
    expect(exportResult.content).toContain("case_id,config_id,overall_score");
  });

  it("turns chat feedback into reviewable evaluation cases", async () => {
    const handle = createRuntimeMethodHandler(createStore());
    const run = await handle({
      jsonrpc: "2.0",
      id: 1,
      method: "runs.start",
      params: {
        input: { prompt: "Summarize this with citations." },
        config: { pattern: "orchestrator_subagent", modelRef: "local/smoke-model" }
      }
    }) as { runId: string };

    const submitted = EvaluationFeedbackRecordSchema.parse(await handle({
      jsonrpc: "2.0",
      id: 2,
      method: "evaluation.feedback.submit",
      params: {
        runId: run.runId,
        turnIndex: 1,
        messageId: `${run.runId}:assistant`,
        feedbackText: "It ignored the required citation format.",
      }
    }));
    expect(submitted.status).toMatch(/pending|failed/);
    expect(submitted.feedbackText).toContain("citation");
    expect(submitted.draft.case.metadata.source).toBe("chat_feedback");

    const listed = EvaluationFeedbackRecordSchema.array().parse(await handle({
      jsonrpc: "2.0",
      id: 3,
      method: "evaluation.feedback.list",
      params: { limit: 10 }
    }));
    expect(listed.map((record) => record.id)).toContain(submitted.id);

    const accepted = EvaluationFeedbackRecordSchema.parse(await handle({
      jsonrpc: "2.0",
      id: 4,
      method: "evaluation.feedback.accept",
      params: { feedbackId: submitted.id }
    }));
    expect(accepted.status).toBe("accepted");
    expect(accepted.datasetId).toBe("feedback-chat");

    const dataset = EvaluationDatasetDetailSchema.parse(await handle({
      jsonrpc: "2.0",
      id: 5,
      method: "evaluation.datasets.get",
      params: { datasetId: "feedback-chat" }
    }));
    expect(dataset.dataset.caseCount).toBe(1);
    expect(dataset.cases[0]?.metadata.feedbackId).toBe(submitted.id);

    const second = EvaluationFeedbackRecordSchema.parse(await handle({
      jsonrpc: "2.0",
      id: 6,
      method: "evaluation.feedback.submit",
      params: {
        runId: run.runId,
        feedbackText: "This is a minor wording issue.",
      }
    }));
    const rejected = EvaluationFeedbackRecordSchema.parse(await handle({
      jsonrpc: "2.0",
      id: 7,
      method: "evaluation.feedback.reject",
      params: { feedbackId: second.id, reason: "Duplicate signal" }
    }));
    expect(rejected.status).toBe("rejected");

    const unchanged = EvaluationDatasetDetailSchema.parse(await handle({
      jsonrpc: "2.0",
      id: 8,
      method: "evaluation.datasets.get",
      params: { datasetId: "feedback-chat" }
    }));
    expect(unchanged.dataset.caseCount).toBe(1);
  });

  it("derives project signals, insights, rules, and confirmed actions", async () => {
    const store = createStore();
    const handle = createRuntimeMethodHandler(store);
    const project = await handle({
      jsonrpc: "2.0",
      id: 1,
      method: "projects.create",
      params: { label: "Ora", rootPath: tempDir },
    }) as { projectId: string };
    const session = await handle({
      jsonrpc: "2.0",
      id: 2,
      method: "sessions.create",
      params: { label: "Signals", projectId: project.projectId },
    }) as { sessionId: string };

    for (const index of [1, 2]) {
      store.persistExternalSnapshot(StateSnapshotSchema.parse({
        runId: `run-feedback-${index}`,
        sessionId: session.sessionId,
        turnIndex: index,
        status: "failed",
        pattern: "agent_teams",
        modeId: "agent_teams",
        input: {
          prompt: `Recover browser-search failure ${index}`,
          context: { projectId: project.projectId },
          createdAt: FIXED_TIME + index,
        },
        config: {
          pattern: "agent_teams",
          modeId: "agent_teams",
          profileIds: [],
          skillIds: [],
          toolIds: ["web.search"],
          modelRef: "local/smoke-model",
          approvalMode: "high_risk_only",
          patternOptions: {},
          metadata: {},
          deterministicSeed: "signals-test",
        },
        topology: { nodes: [], edges: [] },
        profiles: [],
        memory: [],
        plan: [],
        todos: [],
        actions: [],
        toolCalls: [],
        policyDecisions: [],
        checkpoints: [],
        events: [
          {
            id: `run-feedback-${index}:evt-0`,
            runId: `run-feedback-${index}`,
            seq: 0,
            type: "recovery.exhausted",
            createdAt: FIXED_TIME + index,
            pattern: "agent_teams",
            nodeId: "browser-search",
            payload: { toolId: "web.search" },
          },
          {
            id: `run-feedback-${index}:evt-1`,
            runId: `run-feedback-${index}`,
            seq: 1,
            type: "run.failed",
            createdAt: FIXED_TIME + index + 1,
            pattern: "agent_teams",
            payload: { error: "Search recovery exhausted." },
          },
        ],
        artifacts: [],
        activeAgents: [],
        queueSummary: {},
        sharedStateSummary: {},
        busStats: {},
        pendingClarifications: [],
        pendingApprovals: index === 2 ? ["approval-1"] : [],
        error: "Search recovery exhausted.",
        updatedAt: FIXED_TIME + index + 1,
      }));
    }

    const feedback = EvaluationFeedbackRecordSchema.parse(await handle({
      jsonrpc: "2.0",
      id: 3,
      method: "evaluation.feedback.submit",
      params: {
        runId: "run-feedback-1",
        sessionId: session.sessionId,
        feedbackText: "The browser-search recovery loop kept failing and needs a benchmark case.",
      },
    }));

    const signals = ProjectSignalSchema.array().parse(await handle({
      jsonrpc: "2.0",
      id: 4,
      method: "feedbackLoop.signals.list",
      params: { projectId: project.projectId },
    }));
    expect(signals.some((signal) => signal.source === "recovery_event" && signal.severity === "critical")).toBe(true);
    expect(signals.some((signal) => signal.source === "evaluation_feedback" && signal.metadata.feedbackId === feedback.id)).toBe(true);

    const insights = ProjectInsightSchema.array().parse(await handle({
      jsonrpc: "2.0",
      id: 5,
      method: "feedbackLoop.insights.list",
      params: { projectId: project.projectId },
    }));
    const recoveryInsight = insights.find((insight) => insight.id.includes("repeated_recovery_exhausted"));
    expect(recoveryInsight?.signalIds.length).toBeGreaterThanOrEqual(2);
    expect(recoveryInsight?.recommendedActions[0]?.requiresConfirmation).toBe(true);

    const rules = FeedbackLoopCalibrationRuleSchema.array().parse(await handle({
      jsonrpc: "2.0",
      id: 6,
      method: "feedbackLoop.rules.list",
      params: { projectId: project.projectId },
    }));
    expect(rules.map((rule) => rule.id)).toContain(`${project.projectId}:rule:repeated_recovery_exhausted`);

    const preview = FeedbackLoopActionResultSchema.parse(await handle({
      jsonrpc: "2.0",
      id: 7,
      method: "feedbackLoop.actions.preview",
      params: { insightId: recoveryInsight!.id, actionId: recoveryInsight!.recommendedActions[0]!.id },
    }));
    expect(preview.status).toBe("preview");

    const applied = FeedbackLoopActionResultSchema.parse(await handle({
      jsonrpc: "2.0",
      id: 8,
      method: "feedbackLoop.actions.apply",
      params: { insightId: recoveryInsight!.id, actionId: recoveryInsight!.recommendedActions[0]!.id, confirmed: true },
    }));
    expect(applied.status).toBe("applied");
    expect(applied.insight.status).toBe("applied");

    const recoveryRule = rules.find((rule) => rule.id === `${project.projectId}:rule:repeated_recovery_exhausted`)!;
    const disabledRule = FeedbackLoopCalibrationRuleSchema.parse(await handle({
      jsonrpc: "2.0",
      id: 9,
      method: "feedbackLoop.rules.update",
      params: { rule: { ...recoveryRule, enabled: false } },
    }));
    expect(disabledRule.enabled).toBe(false);

    const recalibratedInsights = ProjectInsightSchema.array().parse(await handle({
      jsonrpc: "2.0",
      id: 10,
      method: "feedbackLoop.insights.list",
      params: { projectId: project.projectId },
    }));
    expect(recalibratedInsights.find((insight) => insight.id.includes("repeated_recovery_exhausted"))).toBeUndefined();
  });
});
