import type { BusStats, QueueSummary, SharedStateSummary } from "@cemeworm/shared";
import { describe, expect, it } from "vitest";
import {
  createKernelPatternExecutionContextAdapter,
  createRuntimePatternExecutionContext,
} from "../src/harness/runtime-pattern-context.js";
import type { PatternExecutionContext } from "../src/patterns/execution-context.js";

function baseContext(overrides: {
  queueSummary: () => QueueSummary;
  sharedStateSummary: () => SharedStateSummary;
  busStats: () => BusStats;
}): Parameters<typeof createRuntimePatternExecutionContext>[0] {
  return {
    projectId: "project",
    queueSummary: overrides.queueSummary,
    sharedStateSummary: overrides.sharedStateSummary,
    busStats: overrides.busStats,
    responseLanguage: () => "zh",
    systemPrompt: (extra) => extra,
    setPlanStatus: () => undefined,
    setQueueSummary: () => undefined,
    runRecoverableNode: async (_params, execute) => ({ status: "completed", output: await execute() }),
    runDelegatedTask: async (_params, execute) => execute(),
    ensureClarification: async () => undefined,
    claimWorker: () => undefined,
    releaseWorker: () => undefined,
    agentLabel: (agentId) => agentId,
    callAgent: async () => "",
    callAgentStructured: async () => ({
      ok: false,
      rawText: "",
      diagnostics: {
        modeId: "test-mode",
        outputKey: "test-output",
        usedProviderJsonMode: false,
        repairAttempted: false,
        repairSucceeded: false,
        initialText: "",
      },
    }),
    remember: () => undefined,
    captureMemory: () => undefined,
    publishArtifact: () => undefined,
    publishMessage: () => undefined,
    routeMessage: () => undefined,
    emitAgentMessage: () => ({ id: "message" }),
    writeSharedState: () => undefined,
    currentSharedState: overrides.sharedStateSummary,
  };
}

describe("runtime pattern execution context", () => {
  it("keeps summary reads live after backing values are reassigned", () => {
    let queueSummary: QueueSummary = {
      mode: "dag",
      pending: 1,
      inProgress: 0,
      completed: 0,
      topics: [],
    };
    let sharedStateSummary: SharedStateSummary = {
      enabled: false,
      storeKind: "none",
      version: 0,
      entries: [],
    };
    let busStats: BusStats = {
      enabled: false,
      publishedCount: 0,
      routedCount: 0,
      topicCounts: {},
    };

    const context = createRuntimePatternExecutionContext(baseContext({
      queueSummary: () => queueSummary,
      sharedStateSummary: () => sharedStateSummary,
      busStats: () => busStats,
    }));

    queueSummary = {
      ...queueSummary,
      pending: 0,
      completed: 1,
      topics: ["task.response"],
    };
    sharedStateSummary = {
      enabled: true,
      storeKind: "blackboard",
      version: 1,
      entries: [{ key: "convergence", version: 1, summary: "done", updatedBy: "agent" }],
    };
    busStats = {
      enabled: true,
      publishedCount: 1,
      routedCount: 1,
      topicCounts: { "task.response": 1 },
    };

    expect(context.queueSummary).toMatchObject({ pending: 0, completed: 1 });
    expect(context.queueSummary.topics).toEqual(["task.response"]);
    expect(context.sharedStateSummary.version).toBe(1);
    expect(context.busStats).toMatchObject({ publishedCount: 1, routedCount: 1 });
  });

  it("passes unrelated methods through unchanged", async () => {
    const calls: string[] = [];
    const context: PatternExecutionContext = createRuntimePatternExecutionContext(baseContext({
      queueSummary: () => ({ mode: "dag", pending: 0, inProgress: 0, completed: 0, topics: [] }),
      sharedStateSummary: () => ({ enabled: false, storeKind: "none", version: 0, entries: [] }),
      busStats: () => ({ enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} }),
    }));

    context.claimWorker("agent");
    const result = await context.runDelegatedTask({
      taskId: "task",
      nodeId: "node",
      nodeLabel: "Node",
      agentId: "agent",
      title: "Task",
    }, async () => {
      calls.push("delegated");
      return "ok";
    });

    expect(result).toBe("ok");
    expect(calls).toEqual(["delegated"]);
  });

  it("creates kernel adapters that produce live pattern contexts", () => {
    let queueSummary: QueueSummary = {
      mode: "dag",
      pending: 1,
      inProgress: 0,
      completed: 0,
      topics: [],
    };
    const adapter = createKernelPatternExecutionContextAdapter(baseContext({
      queueSummary: () => queueSummary,
      sharedStateSummary: () => ({ enabled: false, storeKind: "none", version: 0, entries: [] }),
      busStats: () => ({ enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} }),
    }));

    const context = adapter.create();
    queueSummary = { ...queueSummary, pending: 0, completed: 1 };

    expect(context.queueSummary).toMatchObject({ pending: 0, completed: 1 });
  });
});
