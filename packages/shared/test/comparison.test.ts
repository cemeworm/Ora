import { describe, expect, it } from "vitest";
import { compareRuns, type StateSnapshot } from "../src/index.js";

function snapshot(overrides: Partial<StateSnapshot> = {}): StateSnapshot {
  const base: StateSnapshot = {
    runId: "run-base",
    turnIndex: 1,
    status: "succeeded",
    pattern: "orchestrator_subagent",
    coordinationKind: "orchestrator_subagent",
    input: { prompt: "Compare this run.", createdAt: 1_714_000_000_000, context: {} },
    config: {
      pattern: "orchestrator_subagent",
      modeSelection: "manual",
      profileIds: [],
      modelRef: "local/smoke-model",
      approvalMode: "high_risk_only",
      permissionMode: "default",
      patternOptions: {},
      metadata: {},
      deterministicSeed: "comparison-test",
      skillIds: [],
      toolIds: [],
    },
    topology: { nodes: [], edges: [] },
    profiles: [],
    memory: [],
    plan: [],
    planList: [],
    todos: [],
    actions: [],
    toolCalls: [],
    continuation: { frames: [] },
    planDecisions: [],
    conversation: [],
    toolResults: [],
    policyDecisions: [],
    checkpoints: [],
    events: [],
    agentMessages: [],
    artifacts: [],
    activeAgents: [],
    queueSummary: { mode: "dag", pending: 0, inProgress: 0, completed: 0, topics: [] },
    sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
    busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
    pendingClarifications: [],
    pendingApprovals: [],
    updatedAt: 1_714_000_000_001,
  };
  return { ...base, ...overrides };
}

function events(count: number, runId: string) {
  return Array.from({ length: count }, (_, index) => ({
    id: `${runId}:evt-${index}`,
    runId,
    seq: index,
    type: "task.progress" as const,
    createdAt: index,
    payload: {},
  }));
}

function toolCalls(count: number, runId: string) {
  return Array.from({ length: count }, (_, index) => ({
    id: `${runId}:tool-${index}`,
    runId,
    toolId: "shell",
    args: { index },
    source: "provider_native" as const,
    status: "succeeded" as const,
    requestedAt: index,
    updatedAt: index + 1,
  }));
}

describe("compareRuns", () => {
  it("returns better when target succeeds with lower event and tool volume", () => {
    const comparison = compareRuns(
      snapshot({ runId: "base", events: events(20, "base"), toolCalls: toolCalls(10, "base") }),
      snapshot({ runId: "target", events: events(10, "target"), toolCalls: toolCalls(4, "target") }),
    );

    expect(comparison.verdict).toBe("better");
    expect(comparison.dimensions.toolUsage.direction).toBe("improved");
  });

  it("returns worse when outcome degrades", () => {
    const comparison = compareRuns(
      snapshot({ runId: "base", status: "succeeded" }),
      snapshot({ runId: "target", status: "failed" }),
    );

    expect(comparison.verdict).toBe("worse");
    expect(comparison.dimensions.outcome.direction).toBe("degraded");
  });

  it("returns mixed when cost improves but recovery signals increase", () => {
    const comparison = compareRuns(
      snapshot({ runId: "base", events: events(20, "base"), toolCalls: toolCalls(4, "base") }),
      snapshot({
        runId: "target",
        events: events(10, "target"),
        toolCalls: [{
          id: "target:tool-failed",
          runId: "target",
          toolId: "shell",
          args: {},
          source: "provider_native",
          status: "failed",
          requestedAt: 1,
          updatedAt: 2,
        }],
      }),
    );

    expect(comparison.verdict).toBe("mixed");
    expect(comparison.dimensions.costOrEvents.direction).toBe("improved");
    expect(comparison.dimensions.recovery.direction).toBe("degraded");
  });

  it("returns inconclusive when nothing changes", () => {
    const comparison = compareRuns(
      snapshot({ runId: "base" }),
      snapshot({ runId: "target" }),
    );

    expect(comparison.verdict).toBe("inconclusive");
  });
});
