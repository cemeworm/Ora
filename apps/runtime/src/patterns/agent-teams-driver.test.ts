import { MODE_STUDIO_BUILDER_MODE_ID, getModePreset, modeSpecToPatternDefinition, type BusStats, type QueueSummary, type RunConfig, type SharedStateSummary } from "@cemeworm/shared";
import { describe, expect, it } from "vitest";
import { executeAgentTeams } from "./agent-teams-driver.js";
import type { PatternExecutionContext } from "./execution-context.js";

function createContext(callLog: string[]): PatternExecutionContext {
  const queueSummary: QueueSummary = { mode: "backlog", pending: 0, inProgress: 0, completed: 0, topics: [] };
  const sharedStateSummary: SharedStateSummary = { enabled: false, storeKind: "none", version: 0, entries: [] };
  const busStats: BusStats = { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} };
  return {
    projectId: "test-project",
    queueSummary,
    sharedStateSummary,
    busStats,
    systemPrompt: (extra) => extra,
    setPlanStatus: () => {},
    setQueueSummary: (patch) => Object.assign(queueSummary, patch),
    checkpointNode: () => {},
    runRecoverableNode: async (_params, execute) => ({ status: "completed", output: await execute() }),
    runDelegatedTask: async (_params, execute) => execute(),
    ensureClarification: async () => undefined,
    claimWorker: () => {},
    releaseWorker: () => {},
    agentLabel: (agentId) => agentId,
    callAgent: async ({ agentId, title }) => {
      callLog.push(`${agentId}:${title}`);
      if (agentId === "reviewer") {
        return "Verdict: NEEDS_FIX\n- Missing focused verification";
      }
      if (title.includes("handoff")) {
        throw new Error("handoff should be skipped when review fails");
      }
      return `${agentId}:${title}`;
    },
    remember: () => {},
    captureMemory: () => {},
    publishArtifact: () => {},
    publishMessage: () => {},
    routeMessage: () => {},
    emitAgentMessage: () => ({ id: `msg-${callLog.length}` }),
    writeSharedState: () => {},
    currentSharedState: () => sharedStateSummary,
  };
}

function createReworkContext(callLog: string[]): PatternExecutionContext {
  const queueSummary: QueueSummary = { mode: "backlog", pending: 0, inProgress: 0, completed: 0, topics: [] };
  const sharedStateSummary: SharedStateSummary = { enabled: false, storeKind: "none", version: 0, entries: [] };
  const busStats: BusStats = { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} };
  let reviewCount = 0;
  return {
    projectId: "test-project",
    queueSummary,
    sharedStateSummary,
    busStats,
    systemPrompt: (extra) => extra,
    setPlanStatus: () => {},
    setQueueSummary: (patch) => Object.assign(queueSummary, patch),
    checkpointNode: () => {},
    runRecoverableNode: async (_params, execute) => ({ status: "completed", output: await execute() }),
    runDelegatedTask: async (_params, execute) => execute(),
    ensureClarification: async () => undefined,
    claimWorker: () => {},
    releaseWorker: () => {},
    agentLabel: (agentId) => agentId,
    callAgent: async ({ agentId, title }) => {
      callLog.push(`${agentId}:${title}`);
      if (agentId === "reviewer") {
        reviewCount += 1;
        return reviewCount === 1
          ? "Verdict: NEEDS_FIX\n- Missing focused verification"
          : "Verdict: PASS\n- Blocking issues resolved";
      }
      return `${agentId}:${title}`;
    },
    remember: () => {},
    captureMemory: () => {},
    publishArtifact: () => {},
    publishMessage: () => {},
    routeMessage: () => {},
    emitAgentMessage: () => ({ id: `msg-${callLog.length}` }),
    writeSharedState: () => {},
    currentSharedState: () => sharedStateSummary,
  };
}

describe("executeAgentTeams", () => {
  it("skips handoff when reviewer returns a non-pass verdict", async () => {
    const modeSpec = getModePreset(MODE_STUDIO_BUILDER_MODE_ID);
    expect(modeSpec).toBeDefined();
    const callLog: string[] = [];
    const context = createContext(callLog);
    const config: RunConfig = {
      pattern: "agent_teams",
      modeSelection: "manual",
      profileIds: [],
      skillIds: [],
      toolIds: [],
      approvalMode: "auto",
      permissionMode: "auto_review",
      patternOptions: {},
      metadata: {},
      causalInterventionLevel: "record_only",
      deterministicSeed: "test-seed",
    };

    const result = await executeAgentTeams({
      context,
      prompt: "Draft a mode bundle",
      config,
      modeSpec: modeSpec!,
      definition: modeSpecToPatternDefinition(modeSpec!),
    });

    expect(callLog.some((entry) => entry.includes("Return structured bundle"))).toBe(false);
    expect(result.output).toMatchObject({
      reviewVerdict: "needs_fix",
      handoffBlocked: true,
    });
  });

  it("reworks builder output and reaches handoff after a passing re-review", async () => {
    const modeSpec = getModePreset(MODE_STUDIO_BUILDER_MODE_ID);
    expect(modeSpec).toBeDefined();
    const callLog: string[] = [];
    const context = createReworkContext(callLog);
    const config: RunConfig = {
      pattern: "agent_teams",
      modeSelection: "manual",
      profileIds: [],
      skillIds: [],
      toolIds: [],
      approvalMode: "auto",
      permissionMode: "auto_review",
      patternOptions: {},
      metadata: {},
      causalInterventionLevel: "record_only",
      deterministicSeed: "test-seed",
    };

    const result = await executeAgentTeams({
      context,
      prompt: "Draft a mode bundle",
      config,
      modeSpec: modeSpec!,
      definition: modeSpecToPatternDefinition(modeSpec!),
    });

    expect(callLog.filter((entry) => entry.includes("builder:")).length).toBe(2);
    expect(callLog.filter((entry) => entry.includes("reviewer:")).length).toBe(2);
    expect(callLog.some((entry) => entry.includes("Return structured bundle"))).toBe(true);
    expect(result.output).toMatchObject({
      reviewVerdict: "pass",
      handoffBlocked: false,
      reworkCount: 1,
    });
  });
});
