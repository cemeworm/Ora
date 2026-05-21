import { CODE_DEVELOPMENT_MODE_ID, DEEP_RESEARCH_MODE_ID, REVIEW_CRITIQUE_MODE_ID, createModeSpecFromPattern, getModePreset, modeSpecToPatternDefinition, type BusStats, type QueueSummary, type RunConfig, type SharedStateSummary } from "@cemeworm/shared";
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

describe("executeOrchestratorSubagent plain plan intent early stop", () => {
  it("stops plain orchestrator_subagent after decompose produces a complete proposed plan", async () => {
    const modeSpec = createModeSpecFromPattern("orchestrator_subagent");
    const callLog: string[] = [];
    const context = createContext(callLog);
    const config: RunConfig = {
      pattern: "orchestrator_subagent",
      modeId: "orchestrator_subagent",
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
          "## Runtime status plan",
          "1. Add shared attention projection.",
          "2. Persist plan decision gates.",
          "</proposed_plan>",
        ].join("\n");
      }
      return `${agentId}:${title}`;
    };

    const result = await executeOrchestratorSubagent({
      context,
      prompt: "Return a proposed plan for session state.",
      config,
      modeSpec,
      definition: modeSpecToPatternDefinition(modeSpec),
    });

    expect(callLog).toHaveLength(1);
    expect(callLog[0]).toContain("ora:Decompose task into inspectable plan");
    expect(result.output).toMatchObject({
      modeId: "orchestrator_subagent",
      stoppedAfterProposedPlan: true,
    });
    expect(String((result.output as { text?: string }).text ?? "")).toContain("<proposed_plan>");
  });
});

// --- code_development hard gate ---

function codeDevTriageJson() {
  return JSON.stringify({
    text: "计划已收敛为最小实现路径。",
    goal: "为 auth 模块补充错误处理。",
    successCriteria: ["聚焦修改通过审查", "验证证据完整"],
    backlog: [{ id: "build-1", owner: "builder", description: "实现最小修复并补充验证" }],
    scopeBoundaries: ["不做无关重构"],
    taskJournalPath: "tasks/TASK-code-dev.md",
    targetFiles: ["src/auth.ts"],
    verificationPlan: [{ id: "verify-auth", commandOrMethod: "pnpm test auth", expectation: "相关测试通过" }],
    riskFiles: ["src/auth.ts"],
    doneCriteria: ["TODO 扫描无阻塞项", "DONE gate 通过"],
  });
}

function codeDevBuildJson() {
  return JSON.stringify({
    text: "已完成最小实现并记录验证证据。",
    artifacts: ["src/auth.ts"],
    changedFiles: ["src/auth.ts"],
    commandsRun: [{ command: "pnpm test auth", exitCode: 0, summary: "验证 auth 相关改动" }],
    verificationEvidence: [{ verificationId: "verify-auth", result: "pass", summary: "auth 聚焦测试通过" }],
    assumptions: [],
    followups: [],
  });
}

function codeDevPassReviewJson() {
  return JSON.stringify({
    text: "审查通过。",
    verdict: "pass",
    acceptedArtifactIds: ["build"],
    findings: [],
    blockingIssues: [],
    acceptedFiles: ["src/auth.ts"],
    verificationGaps: [],
    rejectedFiles: [],
  });
}

function codeDevNeedsFixReviewJson(issue: string, requiredFix = "补齐缺失测试"): string {
  return JSON.stringify({
    text: "审查未通过。",
    verdict: "needs_fix",
    acceptedArtifactIds: [],
    findings: [{ artifactId: "build", severity: "blocking", issue }],
    blockingIssues: [{ artifactId: "build", file: "src/auth.ts", issue, requiredFix }],
    acceptedFiles: [],
    verificationGaps: ["缺少聚焦验证"],
    rejectedFiles: ["src/auth.ts"],
  });
}

function codeDevDebugClearJson() {
  return JSON.stringify({
    text: "无需进一步调试。",
    status: "clear",
    rootCauses: [],
    requiredRework: [],
    diagnosticEvidence: [{ commandOrMethod: "pnpm test auth", summary: "没有观察到剩余故障" }],
    remainingRisks: [],
  });
}

function codeDevHandoffJson() {
  return JSON.stringify({
    text: "最终移交已完成。",
    deliveredFiles: ["src/auth.ts"],
    acceptedFiles: ["src/auth.ts"],
    taskJournalPath: "tasks/TASK-code-dev.md",
    todoScanResult: { status: "clean", summary: "无阻塞 TODO" },
    doneGate: { status: "pass", blockers: [] },
    verificationSummary: [{ verificationId: "verify-auth", result: "pass", summary: "auth 聚焦测试通过" }],
    residualRisks: [],
  });
}

function codeDevIncompleteHandoffJson() {
  return JSON.stringify({
    text: "最终移交已完成。",
  });
}

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
      if (agentId === "ora" && title.includes("Plan")) {
        return codeDevTriageJson();
      }
      if (agentId === "builder") {
        return codeDevBuildJson();
      }
      if (agentId === "reviewer") {
        return codeDevNeedsFixReviewJson("Missing tests for changed files");
      }
      if (agentId === "debugger") {
        return codeDevDebugClearJson();
      }
      if (agentId === "ora" && title.includes("Finalize")) {
        return codeDevHandoffJson();
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
      if (agentId === "ora" && title.includes("Plan")) {
        return codeDevTriageJson();
      }
      if (agentId === "builder") {
        return codeDevBuildJson();
      }
      if (agentId === "reviewer") {
        reviewCount += 1;
        return reviewCount === 1
          ? codeDevNeedsFixReviewJson("Missing tests for changed files")
          : codeDevPassReviewJson();
      }
      if (agentId === "debugger") {
        return codeDevDebugClearJson();
      }
      if (agentId === "ora" && title.includes("Finalize")) {
        return codeDevHandoffJson();
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
      if (agentId === "ora" && title.includes("Plan")) {
        return codeDevTriageJson();
      }
      if (agentId === "builder") {
        return codeDevBuildJson();
      }
      if (agentId === "reviewer") {
        return codeDevPassReviewJson();
      }
      if (agentId === "debugger") {
        return codeDevDebugClearJson();
      }
      if (agentId === "ora" && title.includes("Finalize")) {
        return codeDevHandoffJson();
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
  it("stops before builder when triage does not produce a structured implementation contract", async () => {
    const modeSpec = getModePreset(CODE_DEVELOPMENT_MODE_ID);
    expect(modeSpec).toBeDefined();
    const callLog: string[] = [];
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
        if (agentId === "ora" && title.includes("Plan")) {
          return "{\"text\":\"only partial triage\"}";
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

    expect(callLog.filter((entry) => entry.includes("builder:Builder Implement"))).toHaveLength(0);
    expect(result.output).toMatchObject({
      stoppedAfterInvalidTriage: true,
      invalidTriageReason: "invalid_or_degraded_triage_contract",
    });
  });

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
    expect(((result.output as { degradedKeys?: string[] }).degradedKeys ?? [])).not.toContain("review");
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
        if (agentId === "ora" && title.includes("Plan")) {
          return codeDevTriageJson();
        }
        if (agentId === "builder") {
          return codeDevBuildJson();
        }
        if (agentId === "reviewer") {
          reviewCount += 1;
          return reviewCount === 1
            ? JSON.stringify({
                ...JSON.parse(codeDevNeedsFixReviewJson("Missing tests for changed files")),
                text: "审查未通过，需要重新实施。",
              })
            : codeDevPassReviewJson();
        }
        if (agentId === "debugger") {
          return codeDevDebugClearJson();
        }
        if (agentId === "ora" && title.includes("Finalize")) {
          return codeDevHandoffJson();
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

  it("does not overwrite a failed re-review with a later debug clear", async () => {
    const modeSpec = getModePreset(CODE_DEVELOPMENT_MODE_ID);
    expect(modeSpec).toBeDefined();
    const callLog: string[] = [];
    let reviewCount = 0;
    let debugCount = 0;
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
        if (agentId === "ora" && title.includes("Plan")) {
          return codeDevTriageJson();
        }
        if (agentId === "builder") {
          return codeDevBuildJson();
        }
        if (agentId === "reviewer") {
          reviewCount += 1;
          return reviewCount === 1
            ? codeDevPassReviewJson()
            : codeDevNeedsFixReviewJson("Review still requires follow-up evidence");
        }
        if (agentId === "debugger") {
          debugCount += 1;
          return debugCount === 1
            ? JSON.stringify({
                text: "需要重新复核验证证据。",
                status: "needs_fix",
                rootCauses: ["Review needs a second pass on verification evidence"],
                requiredRework: [{ nodeId: "review", reason: "Re-check the reported verification evidence" }],
              })
            : codeDevDebugClearJson();
        }
        if (agentId === "ora" && title.includes("Finalize")) {
          return codeDevHandoffJson();
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

    expect(callLog.filter((entry) => entry.includes("reviewer:Reviewer Review")).length).toBe(2);
    expect(callLog.filter((entry) => entry.includes("debugger:Debugger Debug")).length).toBe(1);
    expect(result.output).toMatchObject({
      reviewVerdict: "needs_fix",
      verificationBlocked: true,
      degradedDelivery: true,
      blockedNodeId: "review",
    });
  });

  it("blocks normal success when final handoff omits required delivery gate fields", async () => {
    const modeSpec = getModePreset(CODE_DEVELOPMENT_MODE_ID);
    expect(modeSpec).toBeDefined();
    const callLog: string[] = [];
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
        if (agentId === "ora" && title.includes("Plan")) {
          return codeDevTriageJson();
        }
        if (agentId === "builder") {
          return codeDevBuildJson();
        }
        if (agentId === "reviewer") {
          return codeDevPassReviewJson();
        }
        if (agentId === "debugger") {
          return codeDevDebugClearJson();
        }
        if (agentId === "ora" && title.includes("Finalize")) {
          return codeDevIncompleteHandoffJson();
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

    expect(callLog.some((entry) => entry.includes("ora:Ora Finalize"))).toBe(true);
    expect(result.output).toMatchObject({
      reviewVerdict: "pass",
      debugStatus: "clear",
      verificationBlocked: true,
      degradedDelivery: true,
      finalDeliveryBlocked: true,
      blockedNodeId: "handoff",
      finalDeliveryBlockers: expect.arrayContaining(["handoff contract is missing required structured fields"]),
    });
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

function createAcceptedArtifactFilterContext(
  callLog: string[],
  promptsByTitle: Map<string, string>,
  options?: {
    acceptedArtifactIds?: string[];
    invalidGatherContract?: boolean;
  },
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
    callAgent: async ({ agentId, title, prompt }) => {
      callLog.push(`${agentId}:${title}`);
      promptsByTitle.set(title, prompt ?? "");
      if (title.includes("规划")) {
        return JSON.stringify({
          text: "Plan summary",
          goal: "Assess company",
          successCriteria: ["Need sourced claims"],
          steps: [{ id: "1", description: "Gather evidence" }],
          scopeBoundaries: ["No valuation"],
        });
      }
      if (title.includes("收集")) {
        return JSON.stringify({
          text: "Gather summary",
          findings: [
            options?.invalidGatherContract
              ? {
                  claim: "accepted-gather-claim",
                  source: "Source A",
                }
              : {
                  claim: "accepted-gather-claim",
                  source: "Source A",
                  sourceTitle: "Primary Source A",
                  sourceUrl: "https://example.com/a",
                  excerpt: "accepted gather excerpt",
                  retrievedAt: "2026-05-21",
                  sourceType: "report",
                  confidence: "high",
                },
          ],
          confidence: "high",
        });
      }
      if (title.includes("缺口")) {
        return JSON.stringify({
          text: "Gap summary",
          gaps: [
            {
              dimension: "rejected-gap-dimension",
              severity: "major",
              description: "gap-only-marker",
              suggestedAction: "Collect more",
            },
          ],
          coverageScore: 0.65,
          suggestedReworkNodeIds: ["gather"],
        });
      }
      if (title.includes("分析")) {
        return JSON.stringify({
          text: "Analyze summary",
          analysis: [
            {
              claim: "rejected-analysis-claim",
              confidence: "medium",
              rationale: "analysis-only-marker",
              supportingEvidence: ["Source A"],
            },
          ],
          issues: ["analysis issue"],
        });
      }
      if (title.includes("整理")) {
        return JSON.stringify({
          text: "Compile summary",
          findings: [
            {
              claim: "accepted-compile-claim",
              sources: ["https://example.com/a"],
              confidence: "high",
              contradictions: [],
            },
          ],
        });
      }
      if (title.includes("核查")) {
        const verifyOutput: Record<string, unknown> = {
          text: "Verify summary",
          verdict: "pass",
          findings: [
            { artifactId: "analyze", severity: "concern", issue: "Keep analysis out of final synthesis" },
          ],
          issues: [],
        };
        if (options?.acceptedArtifactIds) {
          verifyOutput.acceptedArtifactIds = options.acceptedArtifactIds;
        }
        return JSON.stringify(verifyOutput);
      }
      if (title === "综合报告") {
        return "Final synthesized report";
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
  it("scope, verify, and synthesize nodes have toolIds: [] in mode preset", () => {
    const modeSpec = getModePreset(DEEP_RESEARCH_MODE_ID);
    expect(modeSpec).toBeDefined();
    const scopeNode = modeSpec!.nodes.find((n) => n.id === "scope");
    const verifyNode = modeSpec!.nodes.find((n) => n.id === "verify");
    const synthesizeNode = modeSpec!.nodes.find((n) => n.id === "synthesize");
    const gatherNode = modeSpec!.nodes.find((n) => n.id === "gather");
    expect(scopeNode).toBeDefined();
    expect(verifyNode).toBeDefined();
    expect(synthesizeNode).toBeDefined();
    expect(gatherNode).toBeDefined();
    // scope / verify / synthesize must block web tools
    const scopeConfig = scopeNode!.config as { toolIds?: unknown };
    const verifyConfig = verifyNode!.config as { toolIds?: unknown };
    const synthConfig = synthesizeNode!.config as { toolIds?: unknown };
    const gatherConfig = gatherNode!.config as { toolIds?: unknown };
    expect(Array.isArray(scopeConfig.toolIds) && scopeConfig.toolIds.length === 0).toBe(true);
    expect(Array.isArray(verifyConfig.toolIds) && verifyConfig.toolIds.length === 0).toBe(true);
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

    // verify gets empty toolIds
    const verifyEntry = [...toolIdsByNode.entries()].find(([title]) => title.includes("核查"));
    expect(verifyEntry).toBeDefined();
    expect(verifyEntry![1]).toEqual([]);

    // synthesize gets empty toolIds
    const synthEntry = [...toolIdsByNode.entries()].find(([title]) => title.includes("综合报告"));
    expect(synthEntry).toBeDefined();
    expect(synthEntry![1]).toEqual([]);
  });
});

describe("deep research accepted artifact filtering", () => {
  it("only injects accepted research artifacts into synthesize", async () => {
    const modeSpec = getModePreset(DEEP_RESEARCH_MODE_ID);
    expect(modeSpec).toBeDefined();
    const callLog: string[] = [];
    const promptsByTitle = new Map<string, string>();
    const context = createAcceptedArtifactFilterContext(callLog, promptsByTitle, {
      acceptedArtifactIds: ["gather", "compile"],
    });
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

    expect(callLog.some((entry) => entry.includes("ora:综合报告"))).toBe(true);
    const synthPrompt = promptsByTitle.get("综合报告");
    expect(synthPrompt).toBeDefined();
    expect(synthPrompt).toContain("accepted-gather-claim");
    expect(synthPrompt).toContain("accepted-compile-claim");
    expect(synthPrompt).not.toContain("rejected-analysis-claim");
    expect(synthPrompt).not.toContain("analysis-only-marker");
    expect(synthPrompt).not.toContain("rejected-gap-dimension");
    expect(synthPrompt).not.toContain("gap-only-marker");
    expect(synthPrompt).toContain("[\"gather\",\"compile\"]");
    expect(result.output).toMatchObject({
      reviewVerdict: "pass",
    });
  });

  it("falls back to accepting all deep research artifacts when verify omits acceptedArtifactIds", async () => {
    const modeSpec = getModePreset(DEEP_RESEARCH_MODE_ID);
    expect(modeSpec).toBeDefined();
    const callLog: string[] = [];
    const promptsByTitle = new Map<string, string>();
    const context = createAcceptedArtifactFilterContext(callLog, promptsByTitle);
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

    const synthPrompt = promptsByTitle.get("综合报告");
    expect(synthPrompt).toBeDefined();
    expect(synthPrompt).toContain("accepted-gather-claim");
    expect(synthPrompt).toContain("rejected-analysis-claim");
    expect(synthPrompt).toContain("rejected-gap-dimension");
    expect(synthPrompt).toContain("accepted-compile-claim");
    expect(synthPrompt).toContain("[\"gather\",\"analyze\",\"gap_analysis\",\"compile\"]");
    expect(result.output).toMatchObject({
      reviewVerdict: "pass",
    });
  });

  it("degrades gather when provenance fields are missing even if the payload is JSON", async () => {
    const modeSpec = getModePreset(DEEP_RESEARCH_MODE_ID);
    expect(modeSpec).toBeDefined();
    const callLog: string[] = [];
    const promptsByTitle = new Map<string, string>();
    const context = createAcceptedArtifactFilterContext(callLog, promptsByTitle, {
      acceptedArtifactIds: ["gather", "compile"],
      invalidGatherContract: true,
    });
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

    expect(result.output).toMatchObject({
      degradedKeys: expect.arrayContaining(["gather"]),
      reviewVerdict: "pass",
    });
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
