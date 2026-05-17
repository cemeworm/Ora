import {describe, expect, it } from "vitest";
import {readFileSync } from "node:fs";
import {resolve } from "node:path";
import {tmpdir } from "node:os";
import {mkdtempSync, rmSync } from "node:fs";
import {LocalEvaluationStore } from "../evaluation-store.js";
import type { StateSnapshot } from "@cemeworm/shared";
import {classifyToolRisk, routeIntervention } from "./causal-policy-router.js";

function mockSnapshot(overrides: Partial<StateSnapshot> = {}): StateSnapshot {
  const now = Date.now();
  return {
    runId: "run-smoke-1",
    turnIndex: 1,
    status: "succeeded",
    pattern: "solo_agent",
    input: { prompt: "帮我优化一下那个东西的性能", context: {}, createdAt: now },
    config: { pattern: "solo_agent", metadata: {} },
    topology: { nodes: [], edges: [] },
    profiles: [{ id: "solo_agent", label: "Solo Agent", role: "执行所有任务" }],
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
    pendingClarifications: [],
    pendingApprovals: [],
    updatedAt: now,
    ...overrides,
  } as unknown as StateSnapshot;
}

function causalDecisionEvent(index: number, overrides: Record<string, unknown> = {}) {
  return {
    id: `evt-causal-${index}`,
    runId: "run-smoke-1",
    seq: 100 + index,
    type: "causal.decision.recorded" as const,
    createdAt: Date.now(),
    payload: {
      taskState: {
        surfaceRequest: "帮我优化一下那个东西的性能",
        latentGoalHypotheses: ["改善某个组件性能", "提升系统整体响应速度"],
        selectedLatentGoal: "改善特定组件的性能表现",
        keyUncertainties: ["不确定用户指的是哪个组件或系统"],
        constraints: [],
        candidateInterventions: ["clarify", "answer_directly"],
        chosenIntervention: "clarify",
        alternativeInterventions: ["answer_directly"],
        counterfactualRiskIfSkipped: "直接猜测优化目标可能浪费大量时间在错误的方向上",
        expectedOutcomeLift: "",
        confidence: 0.3,
        stopCondition: "",
      },
      policyDecision: {
        goalUncertainty: 0.7,
        factUncertainty: 0.2,
        contextUncertainty: 0.3,
        actionRisk: 0.05,
        userCost: 0.45,
        reversibility: "high",
        recommendedAction: "clarify",
        reason: "clarify: high goal uncertainty",
        wouldChangeOutcomeIfWrong: true,
      },
      chosenIntervention: "clarify",
      alternativeInterventions: ["answer_directly"],
      recordedAt: Date.now() - (10 - index) * 1000,
      ...overrides,
    },
  };
}

// ---------------------------------------------------------------------------
// Policy router unit tests
// ---------------------------------------------------------------------------
describe("causal policy router", () => {
  describe("classifyToolRisk", () => {
    it("classifies shell commands as high risk", () => {
      expect(classifyToolRisk("shell.ls")).toBe("high");
      expect(classifyToolRisk("shell.rm")).toBe("high");
    });

    it("classifies file writes as high risk", () => {
      expect(classifyToolRisk("file.write")).toBe("high");
      expect(classifyToolRisk("file.patch")).toBe("high");
      expect(classifyToolRisk("file.delete")).toBe("high");
    });

    it("classifies git/npm as medium risk", () => {
      expect(classifyToolRisk("git.commit")).toBe("medium");
      expect(classifyToolRisk("npm.install")).toBe("medium");
    });

    it("classifies reads as low risk", () => {
      expect(classifyToolRisk("file.read")).toBe("low");
      expect(classifyToolRisk("file.grep")).toBe("low");
    });
  });

  describe("routeIntervention", () => {
    it("recommends clarify when goal uncertainty is high", () => {
      const result = routeIntervention({
        surfaceRequest: "优化那个东西",
        taskState: undefined,
        proposedToolId: undefined,
        proposedToolRisk: "low",
        toolCallCount: 0,
        clarificationCount: 0,
        hasPendingApprovals: false,
        hasPendingPlanDecisions: false,
        hasUnresolvedPlanItems: false,
        modelResponseText: "",
      });
      expect(result.action).toBe("clarify");
      expect(result.policyDecision.goalUncertainty).toBeGreaterThanOrEqual(0.6);
      expect(result.policyDecision.wouldChangeOutcomeIfWrong).toBe(true);
    });

    it("recommends request_approval for high-risk tools", () => {
      const result = routeIntervention({
        surfaceRequest: "删除数据库数据",
        taskState: undefined,
        proposedToolId: "shell.rm",
        proposedToolRisk: "high",
        toolCallCount: 0,
        clarificationCount: 0,
        hasPendingApprovals: false,
        hasPendingPlanDecisions: false,
        hasUnresolvedPlanItems: false,
        modelResponseText: "I'll delete the database now.",
      });
      expect(result.action).toBe("request_approval");
      expect(result.policyDecision.actionRisk).toBeGreaterThanOrEqual(0.7);
    });

    it("recommends answer_directly for low-uncertainty simple questions", () => {
      const result = routeIntervention({
        surfaceRequest: "你好",
        taskState: {
          surfaceRequest: "你好",
          selectedLatentGoal: "打招呼",
          confidence: 0.9,
        },
        proposedToolId: undefined,
        proposedToolRisk: "low",
        toolCallCount: 0,
        clarificationCount: 0,
        hasPendingApprovals: false,
        hasPendingPlanDecisions: false,
        hasUnresolvedPlanItems: false,
        modelResponseText: "你好！有什么可以帮助你的吗？",
      });
      expect(result.action).toBe("answer_directly");
    });

    it("recommends search_web when fact uncertainty is high and not already searching", () => {
      const result = routeIntervention({
        surfaceRequest: "最新的React 19有哪些新特性",
        taskState: undefined,
        proposedToolId: undefined,
        proposedToolRisk: "low",
        toolCallCount: 0,
        clarificationCount: 0,
        hasPendingApprovals: false,
        hasPendingPlanDecisions: false,
        hasUnresolvedPlanItems: false,
        modelResponseText: "React 19 probably includes server components by default, and I think it might have improved hydration. The new features should be something like...",
      });
      expect(result.action).toBe("search_web");
      expect(result.policyDecision.factUncertainty).toBeGreaterThanOrEqual(0.35);
    });

    it("recommends read_context when task needs file reading before tool execution", () => {
      const result = routeIntervention({
        surfaceRequest: "帮我重构auth模块",
        taskState: undefined,
        proposedToolId: "file.write",
        proposedToolRisk: "medium",
        toolCallCount: 0,
        clarificationCount: 0,
        hasPendingApprovals: false,
        hasPendingPlanDecisions: false,
        hasUnresolvedPlanItems: true,
        modelResponseText: "",
      });
      // Has unresolved plan items + proposed tool + high context uncertainty → read_context
      expect(result.action).toBe("read_context");
    });

    it("recommends plan when there are unresolved plan items and no tool proposed", () => {
      const result = routeIntervention({
        surfaceRequest: "帮我实现用户认证功能",
        taskState: {
          surfaceRequest: "帮我实现用户认证功能",
          selectedLatentGoal: "实现安全的用户认证系统",
          confidence: 0.75,
        },
        proposedToolId: undefined,
        proposedToolRisk: "low",
        toolCallCount: 0,
        clarificationCount: 0,
        hasPendingApprovals: false,
        hasPendingPlanDecisions: false,
        hasUnresolvedPlanItems: true,
        modelResponseText: "",
      });
      expect(result.action).toBe("plan");
    });

    it("recommends use_tool when model proposes a low-risk tool", () => {
      const result = routeIntervention({
        surfaceRequest: "读取package.json文件",
        taskState: {
          surfaceRequest: "读取package.json文件",
          selectedLatentGoal: "查看项目依赖",
          confidence: 0.85,
        },
        proposedToolId: "file.read",
        proposedToolRisk: "low",
        toolCallCount: 0,
        clarificationCount: 0,
        hasPendingApprovals: false,
        hasPendingPlanDecisions: false,
        hasUnresolvedPlanItems: false,
        modelResponseText: "Let me read the file to check dependencies.",
      });
      expect(result.action).toBe("use_tool");
    });

    it("recommends answer_directly instead of clarify when confidence is high", () => {
      const result = routeIntervention({
        surfaceRequest: "解释什么是闭包",
        taskState: {
          surfaceRequest: "解释什么是闭包",
          selectedLatentGoal: "学习JavaScript闭包概念",
          confidence: 0.85,
        },
        proposedToolId: undefined,
        proposedToolRisk: "low",
        toolCallCount: 0,
        clarificationCount: 0,
        hasPendingApprovals: false,
        hasPendingPlanDecisions: false,
        hasUnresolvedPlanItems: false,
        modelResponseText: "闭包是JavaScript中...",
      });
      expect(result.action).toBe("answer_directly");
    });

    it("records alternative interventions in the decision record", () => {
      const result = routeIntervention({
        surfaceRequest: "优化那个东西的性能",
        taskState: undefined,
        proposedToolId: "file.read",
        proposedToolRisk: "low",
        toolCallCount: 1,
        clarificationCount: 0,
        hasPendingApprovals: false,
        hasPendingPlanDecisions: false,
        hasUnresolvedPlanItems: false,
        modelResponseText: "",
      });
      expect(result.decisionRecord.taskState.surfaceRequest).toBe("优化那个东西的性能");
      expect(["clarify", "use_tool", "search_web", "read_context"]).toContain(result.decisionRecord.chosenIntervention);
      expect(result.decisionRecord.policyDecision.goalUncertainty).toBeGreaterThanOrEqual(0);
      expect(result.decisionRecord.policyDecision.reversibility).toBeDefined();
    });

    it("outputs a valid decision record", () => {
      const result = routeIntervention({
        surfaceRequest: "帮我优化一下那个东西的性能",
        taskState: undefined,
        proposedToolId: "file.read",
        proposedToolRisk: "low",
        toolCallCount: 1,
        clarificationCount: 0,
        hasPendingApprovals: false,
        hasPendingPlanDecisions: false,
        hasUnresolvedPlanItems: false,
        modelResponseText: "Let me read the file first.",
      });
      expect(result.decisionRecord).toBeDefined();
      expect(result.decisionRecord.chosenIntervention).toBe(result.action);
      expect(result.decisionRecord.policyDecision.recommendedAction).toBe(result.action);
      expect(result.decisionRecord.taskState.surfaceRequest).toBe("帮我优化一下那个东西的性能");
    });

    it("recommends stop when sufficient work done and no further action needed", () => {
      const result = routeIntervention({
        surfaceRequest: "帮我重构auth模块",
        taskState: {
          surfaceRequest: "帮我重构auth模块",
          selectedLatentGoal: "重构认证模块",
          confidence: 0.8,
        },
        proposedToolId: undefined,
        proposedToolRisk: "low",
        toolCallCount: 5,
        clarificationCount: 0,
        hasPendingApprovals: false,
        hasPendingPlanDecisions: false,
        hasUnresolvedPlanItems: false,
        modelResponseText: "重构已完成，所有测试通过。",
      });
      expect(result.action).toBe("stop");
      expect(result.policyDecision.reason).toContain("diminishing returns");
    });

    it("recommends answer_directly (not stop) when little work has been done", () => {
      const result = routeIntervention({
        surfaceRequest: "解释什么是闭包",
        taskState: {
          surfaceRequest: "解释什么是闭包",
          selectedLatentGoal: "学习JavaScript闭包概念",
          confidence: 0.85,
        },
        proposedToolId: undefined,
        proposedToolRisk: "low",
        toolCallCount: 0,
        clarificationCount: 0,
        hasPendingApprovals: false,
        hasPendingPlanDecisions: false,
        hasUnresolvedPlanItems: false,
        modelResponseText: "闭包是JavaScript中的一个重要概念...",
      });
      expect(result.action).toBe("answer_directly");
    });
  });
});

// ---------------------------------------------------------------------------
// Smoke eval: dataset -> run -> score
// ---------------------------------------------------------------------------
describe("causal eval smoke", () => {
  it("runs one case through the eval pipeline and produces causal metric scores", async () => {
    // 1. Set up an in-memory eval store (temp dir)
    const tmpDir = mkdtempSync(resolve(tmpdir(), "ora-causal-eval-smoke-"));
    const store = new LocalEvaluationStore(tmpDir);

    try {
      // 2. Import the causal dataset
      const datasetPath = resolve(process.cwd(), "../../evaluation/datasets/causal-intervention-decision-dataset.json");
      const datasetContent = readFileSync(datasetPath, "utf8");
      const datasetDetail = store.importDataset({
        name: "Causal Intervention Decision Smoke",
        content: datasetContent,
        sourceFormat: "json",
      });

      // 3. Build an eval spec targeting the first case + an objective with causal metrics
      const spec = {
        datasetId: datasetDetail.dataset.id,
        profileId: "outcome" as const,
        configs: [
          {
            id: "direct_answer",
            label: "Direct Answer Baseline",
            description: "Solo agent with causal decision recording",
            runConfig: { pattern: "solo_agent" as const },
          },
        ],
        repetitions: 1,
        concurrency: 1,
        timeoutMs: 30000,
        objective: {
          kind: "outcome" as const,
          target: "run.output" as const,
          metrics: [
            "intent_resolution",
            "clarification_precision",
            "effective_intervention",
            "over_action",
            "counterfactual_lift",
          ],
          assertions: [],
          evaluators: [
            {
              id: "causal-heuristic",
              kind: "heuristic" as const,
              label: "Causal Heuristic Scorer",
              weight: 1,
              metrics: [
                "intent_resolution",
                "clarification_precision",
                "effective_intervention",
                "over_action",
                "counterfactual_lift",
              ],
              assertions: [],
            },
          ],
        },
      };

      // 4. Mock executor that returns a snapshot with causal decision events
      const mockExecutor = async ({ input }: { input: { prompt: string }; config: unknown }) => {
        const events = [
          causalDecisionEvent(1),
        ];
        return mockSnapshot({
          runId: `eval-run-${Date.now()}`,
          input: { prompt: input.prompt, context: {}, createdAt: Date.now() },
          events,
          output: "请问您指的是哪个具体的组件或系统？",
        });
      };

      // 5. Run the eval
      const runDetail = await store.startRun(spec, mockExecutor);

      // 6. Verify results
      for (const a of runDetail.attempts) {
        if (a.status === "failed" || a.status === "timeout") {
          throw new Error(`Attempt ${a.id} FAILED: ${a.error}`);
        }
      }
      expect(runDetail.run.status).toBe("succeeded");
      expect(runDetail.run.completedAttempts).toBeGreaterThanOrEqual(30);
      expect(runDetail.run.failedAttempts).toBe(0);
      expect(runDetail.run.scorecard).toBeDefined();
      expect(runDetail.attempts.length).toBeGreaterThanOrEqual(30);

      // Check the first attempt's causal metrics
      const firstAttempt = runDetail.attempts[0]!;
      expect(firstAttempt.status).toBe("succeeded");
      expect(firstAttempt.metricScores.length).toBeGreaterThan(0);

      const metricIds = firstAttempt.metricScores.map((ms) => ms.metricId);
      expect(metricIds).toContain("intent_resolution");
      expect(metricIds).toContain("effective_intervention");
      expect(metricIds).toContain("counterfactual_lift");

      // Effective intervention: expected "clarify", mock gave "clarify" -> should pass
      const interventionScore = firstAttempt.metricScores.find((ms) => ms.metricId === "effective_intervention")!;
      expect(interventionScore.passed).toBe(true);
      expect(interventionScore.score).toBeGreaterThanOrEqual(0.9);

      // Intent resolution: the latent goal should match
      const intentScore = firstAttempt.metricScores.find((ms) => ms.metricId === "intent_resolution")!;
      expect(intentScore.score).toBeGreaterThan(0);

      // Record artifact paths and run id
      // Smoke results verified
      expect(datasetDetail.dataset.id).toBeDefined();
      expect(runDetail.run.id).toBeDefined();
      expect(runDetail.run.scorecard.overallScore).toBeGreaterThan(0.5);

      // Eval store produces a report
      const report = store.generateReport({ evaluationRunId: runDetail.run.id });
      expect(report).toBeDefined();

      // Feedback: submit a feedback record for the run
      try {
        await store.submitFeedback({
          sourceRunId: runDetail.run.id,
          feedbackText: "Agent correctly chose to clarify instead of guessing.",
          runId: runDetail.run.id,
        }, {});
      } catch {
        // Feedback submission may fail if there's no session context; that's OK for smoke
      }
      expect(tmpDir).toBeDefined();
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

