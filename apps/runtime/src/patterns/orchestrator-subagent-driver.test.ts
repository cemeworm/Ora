import { CODE_DEVELOPMENT_MODE_ID, DEEP_RESEARCH_MODE_ID, REVIEW_CRITIQUE_MODE_ID, getModePreset, modeSpecToPatternDefinition, type BusStats, type QueueSummary, type RunConfig, type SharedStateSummary } from "@cemeworm/shared";
import { describe, expect, it } from "vitest";
import { executeOrchestratorSubagent } from "./orchestrator-subagent-driver.js";
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
    responseLanguage: () => "zh",
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
      if (agentId === "fact_checker") {
        return "Verdict: NEEDS_FIX\n- Missing primary source coverage";
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
  let verifyCount = 0;
  return {
    projectId: "test-project",
    queueSummary,
    sharedStateSummary,
    busStats,
    responseLanguage: () => "zh",
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
      if (agentId === "fact_checker") {
        verifyCount += 1;
        return verifyCount === 1
          ? "Verdict: NEEDS_FIX\n- Need stronger primary sources"
          : "Verdict: PASS\n- Source coverage now sufficient";
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

describe("executeOrchestratorSubagent deep research verification gate", () => {
  it("blocks final synthesis when the verify stage returns NEEDS_FIX", async () => {
    const modeSpec = getModePreset(DEEP_RESEARCH_MODE_ID);
    expect(modeSpec).toBeDefined();
    const callLog: string[] = [];
    const context = createContext(callLog);
    const config: RunConfig = {
      pattern: "orchestrator_subagent",
      modeId: DEEP_RESEARCH_MODE_ID,
      modeSelection: "manual",
      profileIds: [],
      skillIds: [],
      toolIds: [],
      approvalMode: "high_risk_only",
      permissionMode: "auto_review",
      patternOptions: {},
      metadata: {},
      causalInterventionLevel: "record_only",
      deterministicSeed: "test-seed",
    };

    const result = await executeOrchestratorSubagent({
      context,
      prompt: "Research a company",
      config,
      modeSpec: modeSpec!,
      definition: modeSpecToPatternDefinition(modeSpec!),
    });

    expect(callLog).toHaveLength(17);
    expect(callLog[0]).toContain("ora:");
    expect(callLog[0]).toContain("规划");
    // 4 rework targets × (1 initial + 2 rework rounds) = 3 each
    expect(callLog.filter((entry) => entry.includes("researcher:研究员 收集")).length).toBe(3);
    expect(callLog.filter((entry) => entry.includes("researcher:研究员 分析")).length).toBe(3);
    expect(callLog.filter((entry) => entry.includes("缺口分析员")).length).toBe(3);
    expect(callLog.filter((entry) => entry.includes("证据整理员")).length).toBe(3);
    // verify runs 3 times (initial + 2 rework)
    expect(callLog.filter((entry) => entry.includes("fact_checker:核查员 核查")).length).toBe(3);
    // synthesize runs in degraded delivery mode
    expect(callLog.some((entry) => entry.includes("ora:综合报告"))).toBe(true);
    expect(result.output).toMatchObject({
      reviewVerdict: "needs_fix",
      verificationBlocked: true,
      degradedDelivery: true,
      blockedNodeId: "verify",
      reviewReworkCount: 2,
    });
  });

  it("re-runs research stages and reaches synthesis after a passing re-review", async () => {
    const modeSpec = getModePreset(DEEP_RESEARCH_MODE_ID);
    expect(modeSpec).toBeDefined();
    const callLog: string[] = [];
    const context = createReworkContext(callLog);
    const config: RunConfig = {
      pattern: "orchestrator_subagent",
      modeId: DEEP_RESEARCH_MODE_ID,
      modeSelection: "manual",
      profileIds: [],
      skillIds: [],
      toolIds: [],
      approvalMode: "high_risk_only",
      permissionMode: "auto_review",
      patternOptions: {},
      metadata: {},
      causalInterventionLevel: "record_only",
      deterministicSeed: "test-seed",
    };

    const result = await executeOrchestratorSubagent({
      context,
      prompt: "Research a company",
      config,
      modeSpec: modeSpec!,
      definition: modeSpecToPatternDefinition(modeSpec!),
    });

    expect(callLog.filter((entry) => entry.includes("researcher:研究员 收集")).length).toBe(2);
    expect(callLog.filter((entry) => entry.includes("researcher:研究员 分析")).length).toBe(2);
    expect(callLog.filter((entry) => entry.includes("fact_checker:核查员 核查")).length).toBe(2);
    expect(callLog.some((entry) => entry.includes("ora:综合报告"))).toBe(true);
    expect(result.output).toMatchObject({
      reviewVerdict: "pass",
      reviewReworkCount: 1,
    });
    expect((result.output as { verificationBlocked?: boolean }).verificationBlocked).toBeUndefined();
  });
});

describe("executeOrchestratorSubagent staged plan intent early stop", () => {
  it("stops review_critique after the first complete proposed plan", async () => {
    const modeSpec = getModePreset(REVIEW_CRITIQUE_MODE_ID);
    expect(modeSpec).toBeDefined();
    const callLog: string[] = [];
    const context = createContext(callLog);
    const config: RunConfig = {
      pattern: "orchestrator_subagent",
      modeId: REVIEW_CRITIQUE_MODE_ID,
      modeSelection: "manual",
      profileIds: [],
      skillIds: [],
      toolIds: [],
      approvalMode: "high_risk_only",
      permissionMode: "auto_review",
      patternOptions: {},
      metadata: {
        taskIntent: "plan",
      },
      causalInterventionLevel: "record_only",
      deterministicSeed: "test-seed",
    };

    context.callAgent = async ({ agentId, title }) => {
      callLog.push(`${agentId}:${title}`);
      if (agentId === "ora") {
        return [
          "<proposed_plan>",
          "评审方案",
          "## 背景",
          "先界定评审标准，再对目标做结构化审查。",
          "## 实施步骤",
          "1. 定义检查维度",
          "2. 针对每个维度采样证据",
          "3. 汇总阻塞项与非阻塞项",
          "## 验证方式",
          "- 检查每个维度均有明确证据",
          "</proposed_plan>",
        ].join("\n");
      }
      return `${agentId}:${title}`;
    };

    const result = await executeOrchestratorSubagent({
      context,
      prompt: "评估这份设计方案是否合理",
      config,
      modeSpec: modeSpec!,
      definition: modeSpecToPatternDefinition(modeSpec!),
    });

    expect(callLog).toHaveLength(1);
    expect(callLog[0]).toContain("ora:");
    expect(callLog.some((entry) => entry.includes("reviewer"))).toBe(false);
    expect(result.output).toMatchObject({
      modeId: REVIEW_CRITIQUE_MODE_ID,
      stoppedAfterProposedPlan: true,
    });
    expect(String((result.output as { text?: string }).text ?? "")).toContain("<proposed_plan>");
  });
});

// --- code_development hard gate ---

function createCodeDevContext(callLog: string[]): PatternExecutionContext {
  const queueSummary: QueueSummary = { mode: "backlog", pending: 0, inProgress: 0, completed: 0, topics: [] };
  const sharedStateSummary: SharedStateSummary = { enabled: false, storeKind: "none", version: 0, entries: [] };
  const busStats: BusStats = { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} };
  return {
    projectId: "test-project",
    queueSummary,
    sharedStateSummary,
    busStats,
    responseLanguage: () => "zh",
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
        return "Verdict: NEEDS_FIX\n- Missing tests for changed files\n- Unsafe wide refactor in utils";
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

function createCodeDevReworkContext(callLog: string[]): PatternExecutionContext {
  const queueSummary: QueueSummary = { mode: "backlog", pending: 0, inProgress: 0, completed: 0, topics: [] };
  const sharedStateSummary: SharedStateSummary = { enabled: false, storeKind: "none", version: 0, entries: [] };
  const busStats: BusStats = { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} };
  let reviewCount = 0;
  return {
    projectId: "test-project",
    queueSummary,
    sharedStateSummary,
    busStats,
    responseLanguage: () => "zh",
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
          ? "Verdict: NEEDS_FIX\n- Missing tests for changed files"
          : "Verdict: PASS\n- All issues resolved";
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

function createCodeDevPassContext(callLog: string[]): PatternExecutionContext {
  const queueSummary: QueueSummary = { mode: "backlog", pending: 0, inProgress: 0, completed: 0, topics: [] };
  const sharedStateSummary: SharedStateSummary = { enabled: false, storeKind: "none", version: 0, entries: [] };
  const busStats: BusStats = { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} };
  return {
    projectId: "test-project",
    queueSummary,
    sharedStateSummary,
    busStats,
    responseLanguage: () => "zh",
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
        return "Verdict: PASS\n- All acceptance criteria met";
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

describe("executeOrchestratorSubagent code_development review gate", () => {
  it("blocks handoff when review returns NEEDS_FIX after max rework rounds", async () => {
    const modeSpec = getModePreset(CODE_DEVELOPMENT_MODE_ID);
    expect(modeSpec).toBeDefined();
    const callLog: string[] = [];
    const context = createCodeDevContext(callLog);
    const config: RunConfig = {
      pattern: "orchestrator_subagent",
      modeId: CODE_DEVELOPMENT_MODE_ID,
      modeSelection: "manual",
      profileIds: [],
      skillIds: [],
      toolIds: [],
      approvalMode: "high_risk_only",
      permissionMode: "auto_review",
      patternOptions: {},
      metadata: {},
      causalInterventionLevel: "record_only",
      deterministicSeed: "test-seed",
    };

    const result = await executeOrchestratorSubagent({
      context,
      prompt: "Add error handling to the auth module",
      config,
      modeSpec: modeSpec!,
      definition: modeSpecToPatternDefinition(modeSpec!),
    });

    // builder runs 3 times: initial + 2 rework rounds
    expect(callLog.filter((entry) => entry.includes("builder:Builder Implement")).length).toBe(3);
    // reviewer runs 3 times: initial + 2 rework rounds
    expect(callLog.filter((entry) => entry.includes("reviewer:Reviewer Review")).length).toBe(3);
    // debug is skipped (intermediate), handoff runs in degraded mode
    expect(callLog.some((entry) => entry.includes("debugger"))).toBe(false);
    expect(callLog.some((entry) => entry.includes("ora:Ora Finalize"))).toBe(true);
    expect(result.output).toMatchObject({
      reviewVerdict: "needs_fix",
      verificationBlocked: true,
      degradedDelivery: true,
      blockedNodeId: "review",
      reviewReworkCount: 2,
    });
  });

  it("re-runs builder and reaches handoff after passing re-review", async () => {
    const modeSpec = getModePreset(CODE_DEVELOPMENT_MODE_ID);
    expect(modeSpec).toBeDefined();
    const callLog: string[] = [];
    const context = createCodeDevReworkContext(callLog);
    const config: RunConfig = {
      pattern: "orchestrator_subagent",
      modeId: CODE_DEVELOPMENT_MODE_ID,
      modeSelection: "manual",
      profileIds: [],
      skillIds: [],
      toolIds: [],
      approvalMode: "high_risk_only",
      permissionMode: "auto_review",
      patternOptions: {},
      metadata: {},
      causalInterventionLevel: "record_only",
      deterministicSeed: "test-seed",
    };

    const result = await executeOrchestratorSubagent({
      context,
      prompt: "Add error handling to the auth module",
      config,
      modeSpec: modeSpec!,
      definition: modeSpecToPatternDefinition(modeSpec!),
    });

    // builder runs 2 times: initial + 1 rework
    expect(callLog.filter((entry) => entry.includes("builder:Builder Implement")).length).toBe(2);
    // reviewer runs 2 times: initial + 1 re-review
    expect(callLog.filter((entry) => entry.includes("reviewer:Reviewer Review")).length).toBe(2);
    // debug and handoff should proceed
    expect(callLog.some((entry) => entry.includes("debugger:Debugger Debug"))).toBe(true);
    expect(callLog.some((entry) => entry.includes("ora:Ora Finalize"))).toBe(true);
    expect(result.output).toMatchObject({
      reviewVerdict: "pass",
      reviewReworkCount: 1,
    });
    expect((result.output as { verificationBlocked?: boolean }).verificationBlocked).toBeUndefined();
  });

  it("completes full flow when review returns PASS on first attempt", async () => {
    const modeSpec = getModePreset(CODE_DEVELOPMENT_MODE_ID);
    expect(modeSpec).toBeDefined();
    const callLog: string[] = [];
    const context = createCodeDevPassContext(callLog);
    const config: RunConfig = {
      pattern: "orchestrator_subagent",
      modeId: CODE_DEVELOPMENT_MODE_ID,
      modeSelection: "manual",
      profileIds: [],
      skillIds: [],
      toolIds: [],
      approvalMode: "high_risk_only",
      permissionMode: "auto_review",
      patternOptions: {},
      metadata: {},
      causalInterventionLevel: "record_only",
      deterministicSeed: "test-seed",
    };

    const result = await executeOrchestratorSubagent({
      context,
      prompt: "Fix a typo in README",
      config,
      modeSpec: modeSpec!,
      definition: modeSpecToPatternDefinition(modeSpec!),
    });

    // all 5 stages run exactly once
    expect(callLog.filter((entry) => entry.includes("builder:Builder Implement")).length).toBe(1);
    expect(callLog.filter((entry) => entry.includes("reviewer:Reviewer Review")).length).toBe(1);
    expect(callLog.some((entry) => entry.includes("debugger:Debugger Debug"))).toBe(true);
    expect(callLog.some((entry) => entry.includes("ora:Ora Finalize"))).toBe(true);
    expect(result.output).toMatchObject({
      reviewVerdict: "pass",
      reviewReworkCount: 0,
    });
    expect((result.output as { verificationBlocked?: boolean }).verificationBlocked).toBeUndefined();
  });

  it("re-runs only build when reviewer specifies Rework: build", async () => {
    const modeSpec = getModePreset(CODE_DEVELOPMENT_MODE_ID);
    expect(modeSpec).toBeDefined();
    const callLog: string[] = [];
    let reviewCount = 0;
    const queueSummary: QueueSummary = { mode: "backlog", pending: 0, inProgress: 0, completed: 0, topics: [] };
    const sharedStateSummary: SharedStateSummary = { enabled: false, storeKind: "none", version: 0, entries: [] };
    const busStats: BusStats = { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} };
    const context: PatternExecutionContext = {
      projectId: "test-project",
      queueSummary,
      sharedStateSummary,
      busStats,
      responseLanguage: () => "zh",
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
            ? "Verdict: NEEDS_FIX\nRework: build\n- Missing tests for changed files"
            : "Verdict: PASS\n- Tests added, all issues resolved";
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
    const config: RunConfig = {
      pattern: "orchestrator_subagent",
      modeId: CODE_DEVELOPMENT_MODE_ID,
      modeSelection: "manual",
      profileIds: [],
      skillIds: [],
      toolIds: [],
      approvalMode: "high_risk_only",
      permissionMode: "auto_review",
      patternOptions: {},
      metadata: {},
      causalInterventionLevel: "record_only",
      deterministicSeed: "test-seed",
    };

    const result = await executeOrchestratorSubagent({
      context,
      prompt: "Add error handling to the auth module",
      config,
      modeSpec: modeSpec!,
      definition: modeSpecToPatternDefinition(modeSpec!),
    });

    // builder re-runs once (initial + 1 targeted rework), debug runs once
    expect(callLog.filter((entry) => entry.includes("builder:Builder Implement")).length).toBe(2);
    expect(callLog.filter((entry) => entry.includes("reviewer:Reviewer Review")).length).toBe(2);
    expect(callLog.some((entry) => entry.includes("debugger:Debugger Debug"))).toBe(true);
    expect(callLog.some((entry) => entry.includes("ora:Ora Finalize"))).toBe(true);
    expect(result.output).toMatchObject({
      reviewVerdict: "pass",
      reviewReworkCount: 1,
    });
    expect((result.output as { verificationBlocked?: boolean }).verificationBlocked).toBeUndefined();
  });
});

// --- deep_research targeted rework routing ---

function createTargetedReworkContext(callLog: string[]): PatternExecutionContext {
  const queueSummary: QueueSummary = { mode: "backlog", pending: 0, inProgress: 0, completed: 0, topics: [] };
  const sharedStateSummary: SharedStateSummary = { enabled: false, storeKind: "none", version: 0, entries: [] };
  const busStats: BusStats = { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} };
  let verifyCount = 0;
  return {
    projectId: "test-project",
    queueSummary,
    sharedStateSummary,
    busStats,
    responseLanguage: () => "zh",
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
      if (agentId === "fact_checker") {
        verifyCount += 1;
        return verifyCount === 1
          ? "Verdict: NEEDS_FIX\nRework: gather\n- Need primary sources for claims about market size"
          : "Verdict: PASS\n- Source coverage now sufficient";
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

function createJsonVerdictReworkContext(callLog: string[]): PatternExecutionContext {
  const queueSummary: QueueSummary = { mode: "backlog", pending: 0, inProgress: 0, completed: 0, topics: [] };
  const sharedStateSummary: SharedStateSummary = { enabled: false, storeKind: "none", version: 0, entries: [] };
  const busStats: BusStats = { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} };
  let verifyCount = 0;
  return {
    projectId: "test-project",
    queueSummary,
    sharedStateSummary,
    busStats,
    responseLanguage: () => "zh",
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
      if (agentId === "fact_checker") {
        verifyCount += 1;
        return verifyCount === 1
          ? JSON.stringify({ verdict: "needs_fix", reworkNodeIds: ["analyze"], issues: ["Analysis contains unsupported causal claims"] })
          : JSON.stringify({ verdict: "pass" });
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

function createFullReworkFallbackContext(callLog: string[]): PatternExecutionContext {
  const queueSummary: QueueSummary = { mode: "backlog", pending: 0, inProgress: 0, completed: 0, topics: [] };
  const sharedStateSummary: SharedStateSummary = { enabled: false, storeKind: "none", version: 0, entries: [] };
  const busStats: BusStats = { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} };
  let verifyCount = 0;
  return {
    projectId: "test-project",
    queueSummary,
    sharedStateSummary,
    busStats,
    responseLanguage: () => "zh",
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
      if (agentId === "fact_checker") {
        verifyCount += 1;
        return verifyCount === 1
          ? "Verdict: NEEDS_FIX\n- Both source coverage and analysis quality are insufficient"
          : "Verdict: PASS\n- All issues resolved";
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

// --- run-0103 regression: tool boundary ---

function createToolIdsCaptureContext(
  callLog: string[],
  toolIdsByNode: Map<string, string[] | undefined>,
): PatternExecutionContext {
  const queueSummary: QueueSummary = { mode: "backlog", pending: 0, inProgress: 0, completed: 0, topics: [] };
  const sharedStateSummary: SharedStateSummary = { enabled: false, storeKind: "none", version: 0, entries: [] };
  const busStats: BusStats = { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} };
  return {
    projectId: "test-project",
    queueSummary,
    sharedStateSummary,
    busStats,
    responseLanguage: () => "zh",
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
    callAgent: async ({ agentId, title, toolIds }) => {
      callLog.push(`${agentId}:${title}`);
      toolIdsByNode.set(title, toolIds);
      if (agentId === "fact_checker") {
        return "Verdict: PASS";
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

describe("deep research tool boundary regression (run-0103)", () => {
  it("scope and synthesize nodes have toolIds: [] in mode preset", () => {
    const modeSpec = getModePreset(DEEP_RESEARCH_MODE_ID);
    expect(modeSpec).toBeDefined();
    const scopeNode = modeSpec!.nodes.find((n) => n.id === "scope");
    const synthesizeNode = modeSpec!.nodes.find((n) => n.id === "synthesize");
    const gatherNode = modeSpec!.nodes.find((n) => n.id === "gather");
    expect(scopeNode).toBeDefined();
    expect(synthesizeNode).toBeDefined();
    expect(gatherNode).toBeDefined();
    // scope and synthesize must block web tools
    const scopeConfig = scopeNode!.config as { toolIds?: unknown };
    const synthConfig = synthesizeNode!.config as { toolIds?: unknown };
    const gatherConfig = gatherNode!.config as { toolIds?: unknown };
    expect(Array.isArray(scopeConfig.toolIds) && scopeConfig.toolIds.length === 0).toBe(true);
    expect(Array.isArray(synthConfig.toolIds) && synthConfig.toolIds.length === 0).toBe(true);
    // gather must have NO tool restriction (undefined or missing)
    expect(gatherConfig.toolIds).toBeUndefined();
  });

  it("scope receives empty toolIds and gather receives full tools during execution", async () => {
    const modeSpec = getModePreset(DEEP_RESEARCH_MODE_ID);
    expect(modeSpec).toBeDefined();
    const callLog: string[] = [];
    const toolIdsByNode = new Map<string, string[] | undefined>();
    const context = createToolIdsCaptureContext(callLog, toolIdsByNode);
    const config: RunConfig = {
      pattern: "orchestrator_subagent",
      modeId: DEEP_RESEARCH_MODE_ID,
      modeSelection: "manual",
      profileIds: [],
      skillIds: [],
      toolIds: [],
      approvalMode: "high_risk_only",
      permissionMode: "auto_review",
      patternOptions: {},
      metadata: {},
      causalInterventionLevel: "record_only",
      deterministicSeed: "test-seed",
    };

    await executeOrchestratorSubagent({
      context,
      prompt: "Research a company",
      config,
      modeSpec: modeSpec!,
      definition: modeSpecToPatternDefinition(modeSpec!),
    });

    // scope/planning gets empty toolIds
    const scopeEntry = [...toolIdsByNode.entries()].find(([title]) => title.includes("规划"));
    expect(scopeEntry).toBeDefined();
    expect(scopeEntry![1]).toEqual([]);

    // gather/research gets undefined toolIds (no restriction = all tools available)
    const gatherEntry = [...toolIdsByNode.entries()].find(([title]) => title.includes("收集"));
    expect(gatherEntry).toBeDefined();
    expect(gatherEntry![1]).toBeUndefined();

    // gap_analysis gets empty toolIds
    const gapEntry = [...toolIdsByNode.entries()].find(([title]) => title.includes("缺口"));
    expect(gapEntry).toBeDefined();
    expect(gapEntry![1]).toEqual([]);

    // compile gets empty toolIds
    const compileEntry = [...toolIdsByNode.entries()].find(([title]) => title.includes("整理"));
    expect(compileEntry).toBeDefined();
    expect(compileEntry![1]).toEqual([]);

    // synthesize gets empty toolIds
    const synthEntry = [...toolIdsByNode.entries()].find(([title]) => title.includes("综合报告"));
    expect(synthEntry).toBeDefined();
    expect(synthEntry![1]).toEqual([]);
  });
});

describe("deep research targeted rework routing", () => {
  it("only re-runs gather when verdict specifies Rework: gather", async () => {
    const modeSpec = getModePreset(DEEP_RESEARCH_MODE_ID);
    expect(modeSpec).toBeDefined();
    const callLog: string[] = [];
    const context = createTargetedReworkContext(callLog);
    const config: RunConfig = {
      pattern: "orchestrator_subagent",
      modeId: DEEP_RESEARCH_MODE_ID,
      modeSelection: "manual",
      profileIds: [],
      skillIds: [],
      toolIds: [],
      approvalMode: "high_risk_only",
      permissionMode: "auto_review",
      patternOptions: {},
      metadata: {},
      causalInterventionLevel: "record_only",
      deterministicSeed: "test-seed",
    };

    const result = await executeOrchestratorSubagent({
      context,
      prompt: "Research a company",
      config,
      modeSpec: modeSpec!,
      definition: modeSpecToPatternDefinition(modeSpec!),
    });

    // gather re-runs once (initial + 1 rework), analyze runs only once
    expect(callLog.filter((entry) => entry.includes("研究员 收集")).length).toBe(2);
    expect(callLog.filter((entry) => entry.includes("研究员 分析")).length).toBe(1);
    // verify re-runs once (initial + 1 re-review)
    expect(callLog.filter((entry) => entry.includes("核查员 核查")).length).toBe(2);
    // synthesize should proceed after pass
    expect(callLog.some((entry) => entry.includes("ora:综合报告"))).toBe(true);
    expect(result.output).toMatchObject({
      reviewVerdict: "pass",
      reviewReworkCount: 1,
    });
    expect((result.output as { verificationBlocked?: boolean }).verificationBlocked).toBeUndefined();
  });

  it("only re-runs analyze when JSON verdict specifies reworkNodeIds: ['analyze']", async () => {
    const modeSpec = getModePreset(DEEP_RESEARCH_MODE_ID);
    expect(modeSpec).toBeDefined();
    const callLog: string[] = [];
    const context = createJsonVerdictReworkContext(callLog);
    const config: RunConfig = {
      pattern: "orchestrator_subagent",
      modeId: DEEP_RESEARCH_MODE_ID,
      modeSelection: "manual",
      profileIds: [],
      skillIds: [],
      toolIds: [],
      approvalMode: "high_risk_only",
      permissionMode: "auto_review",
      patternOptions: {},
      metadata: {},
      causalInterventionLevel: "record_only",
      deterministicSeed: "test-seed",
    };

    const result = await executeOrchestratorSubagent({
      context,
      prompt: "Research a company",
      config,
      modeSpec: modeSpec!,
      definition: modeSpecToPatternDefinition(modeSpec!),
    });

    // analyze re-runs once, gather runs only once
    expect(callLog.filter((entry) => entry.includes("研究员 分析")).length).toBe(2);
    expect(callLog.filter((entry) => entry.includes("研究员 收集")).length).toBe(1);
    expect(callLog.filter((entry) => entry.includes("核查员 核查")).length).toBe(2);
    expect(callLog.some((entry) => entry.includes("ora:综合报告"))).toBe(true);
  });

  it("falls back to full reworkNodeIds from config when verdict lacks Rework line", async () => {
    const modeSpec = getModePreset(DEEP_RESEARCH_MODE_ID);
    expect(modeSpec).toBeDefined();
    const callLog: string[] = [];
    const context = createFullReworkFallbackContext(callLog);
    const config: RunConfig = {
      pattern: "orchestrator_subagent",
      modeId: DEEP_RESEARCH_MODE_ID,
      modeSelection: "manual",
      profileIds: [],
      skillIds: [],
      toolIds: [],
      approvalMode: "high_risk_only",
      permissionMode: "auto_review",
      patternOptions: {},
      metadata: {},
      causalInterventionLevel: "record_only",
      deterministicSeed: "test-seed",
    };

    const result = await executeOrchestratorSubagent({
      context,
      prompt: "Research a company",
      config,
      modeSpec: modeSpec!,
      definition: modeSpecToPatternDefinition(modeSpec!),
    });

    // no Rework line → falls back to config.reworkNodeIds: [gather, analyze] → both re-run
    expect(callLog.filter((entry) => entry.includes("研究员 收集")).length).toBe(2);
    expect(callLog.filter((entry) => entry.includes("研究员 分析")).length).toBe(2);
    expect(callLog.filter((entry) => entry.includes("核查员 核查")).length).toBe(2);
    expect(callLog.some((entry) => entry.includes("ora:综合报告"))).toBe(true);
    expect(result.output).toMatchObject({
      reviewVerdict: "pass",
      reviewReworkCount: 1,
    });
  });
});
