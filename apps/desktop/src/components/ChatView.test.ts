import { describe, expect, it } from "vitest";
import {
  deriveComposerPlanDecisionState,
  deriveCurrentComposerPlanSteps,
  deriveProjectedGateTrays,
  getActiveChatProvider,
  getChatInputContextState,
  resolveComposerGateSnapshot,
} from "./ChatView";

describe("chat view provider selection", () => {
  it("uses the selected provider when it is available", () => {
    const providers = [
      { id: "provider-a", label: "Provider A" },
      { id: "provider-b", label: "Provider B" },
    ];

    expect(getActiveChatProvider(providers, "provider-b")).toBe(providers[1]);
  });

  it("falls back to the first runnable provider when the selected provider is unavailable", () => {
    const providers = [
      { id: "provider-a", label: "Provider A" },
      { id: "provider-b", label: "Provider B" },
    ];

    expect(getActiveChatProvider(providers, "local-smoke")).toBe(providers[0]);
  });
});

describe("chat view context state selection", () => {
  it("uses active snapshot context state first", () => {
    const activeContextState = contextState(500);
    const latestContextState = contextState(300);
    const sessionContextState = contextState(100);

    expect(getChatInputContextState({
      activeSnapshot: {
        contextState: activeContextState,
      } as any,
      activeSessionDetail: {
        latestSnapshot: {
          contextState: latestContextState,
        } as any,
        session: {
          contextState: sessionContextState,
        },
      },
    })).toBe(activeContextState);
  });

  it("uses latest snapshot context state before session context state", () => {
    const latestContextState = contextState(300);
    const sessionContextState = contextState(100);

    expect(getChatInputContextState({
      activeSessionDetail: {
        latestSnapshot: {
          contextState: latestContextState,
        } as any,
        session: {
          contextState: sessionContextState,
        },
      },
    })).toBe(latestContextState);
  });

  it("uses persisted session context state when no active snapshot is available", () => {
    const sessionContextState = contextState(100);

    expect(getChatInputContextState({
      activeSessionDetail: {
        session: {
          contextState: sessionContextState,
        },
      },
    })).toBe(sessionContextState);
  });
});

describe("chat view projected gate trays", () => {
  const actionRecords = [
    { id: "action-1", state: "approval_required" },
    { id: "action-2", state: "approval_required" },
  ] as any[];
  const pendingClarifications = [
    { id: "clarification-1", key: "scope", question: "What scope?", requestedAt: 1 },
    { id: "clarification-2", key: "budget", question: "What budget?", requestedAt: 1 },
  ] as any[];

  it("does not show approval or clarification trays from raw state without projection attention", () => {
    expect(deriveProjectedGateTrays({
      attention: { kind: "running", blocking: false, sourceRunId: "run-1" } as any,
      actionRecords,
      pendingClarifications,
    })).toEqual({
      approvalActions: [],
      clarificationQuestions: [],
      hasApprovalTray: false,
      hasClarificationTray: false,
    });
  });

  it("shows only approval actions named by projection attention", () => {
    expect(deriveProjectedGateTrays({
      attention: {
        kind: "needs_approval",
        blocking: true,
        sourceRunId: "run-1",
        reason: "approval_required",
        pendingActionIds: ["action-2"],
        pendingToolCallIds: [],
      } as any,
      actionRecords,
      pendingClarifications,
    })).toMatchObject({
      approvalActions: [{ id: "action-2", state: "approval_required" }],
      clarificationQuestions: [],
      hasApprovalTray: true,
      hasClarificationTray: false,
    });
  });

  it("shows only clarification questions named by projection attention", () => {
    expect(deriveProjectedGateTrays({
      attention: {
        kind: "needs_clarification",
        blocking: true,
        sourceRunId: "run-1",
        reason: "clarification_required",
        pendingClarificationIds: ["clarification-1"],
      } as any,
      actionRecords,
      pendingClarifications,
    })).toMatchObject({
      approvalActions: [],
      clarificationQuestions: [{ id: "clarification-1" }],
      hasApprovalTray: false,
      hasClarificationTray: true,
    });
  });

  it("falls back to the selected turn snapshot for clarification trays when live activeSnapshot is absent", () => {
    const snapshot = {
      runId: "run-clarify",
      attention: {
        kind: "needs_clarification",
        blocking: true,
        sourceRunId: "run-clarify",
        reason: "clarification_required",
        pendingClarificationIds: ["clarification-1"],
      },
      pendingClarifications,
    } as any;

    const composerGateSnapshot = resolveComposerGateSnapshot({
      activeSnapshot: undefined,
      turnSnapshots: { "run-clarify": snapshot },
      sourceRunId: "run-clarify",
    });

    expect(deriveProjectedGateTrays({
      attention: composerGateSnapshot?.attention,
      actionRecords,
      pendingClarifications: composerGateSnapshot?.pendingClarifications ?? [],
    })).toMatchObject({
      approvalActions: [],
      clarificationQuestions: [{ id: "clarification-1" }],
      hasApprovalTray: false,
      hasClarificationTray: true,
    });
  });
});

describe("chat view composer plan decision state", () => {
  it("shows plan decision panel from durable planDecision even when attention drifted to idle", () => {
    expect(deriveComposerPlanDecisionState({
      sessionId: "session-1",
      activeSnapshot: {
        runId: "run-1",
        status: "succeeded",
        attention: {
          kind: "idle",
          blocking: false,
          sourceRunId: "run-1",
          pendingActionIds: [],
          pendingToolCallIds: [],
          pendingClarificationIds: [],
        },
        planDecisions: [{
          id: "decision-1",
          runId: "run-1",
          sessionId: "session-1",
          status: "pending",
          createdAt: 1,
        }],
      } as any,
    })).toEqual({
      pendingPlanDecisionId: "decision-1",
      planDecisionPending: true,
    });
  });

  it("hides plan decision panel while that decision is resolving", () => {
    expect(deriveComposerPlanDecisionState({
      sessionId: "session-1",
      pendingResolution: { sessionId: "session-1", decisionId: "decision-1" },
      activeSnapshot: {
        runId: "run-1",
        status: "succeeded",
        planDecisions: [{
          id: "decision-1",
          runId: "run-1",
          sessionId: "session-1",
          status: "pending",
          createdAt: 1,
        }],
      } as any,
    })).toEqual({
      pendingPlanDecisionId: "decision-1",
      planDecisionPending: false,
    });
  });
});

describe("chat view composer plan steps", () => {
  it("does not reuse a completed historical plan when the active snapshot has none", () => {
    const historicalPlan = [
      { step: "搜索 DeepSeek-v4 API 定价概览", status: "completed" },
      { step: "搜索 DeepSeek-v4 最新价格详情与对比", status: "completed" },
      { step: "获取官方或权威来源的完整价格信息", status: "completed" },
      { step: "整合结果并回答用户", status: "completed" },
    ] as const;

    expect(deriveCurrentComposerPlanSteps({
      activeSnapshot: { planList: [] } as any,
      runInteractionState: runInteractionState("running"),
    })).toEqual([]);
    expect(historicalPlan).toHaveLength(4);
  });

  it("uses the active running snapshot plan", () => {
    const plan = [
      { id: "step-1", step: "搜索网页", status: "in_progress" },
      { id: "step-2", step: "整理结果", status: "pending" },
    ] as const;

    expect(deriveCurrentComposerPlanSteps({
      activeSnapshot: { planList: plan } as any,
      runInteractionState: runInteractionState("running"),
    })).toEqual([
      { step: "搜索网页", status: "in_progress" },
      { step: "整理结果", status: "pending" },
    ]);
  });

  it("shows active snapshot plans even after the run is done", () => {
    const plan = [
      { id: "step-1", step: "搜索网页", status: "completed" },
      { id: "step-2", step: "整理结果", status: "completed" },
    ] as const;

    expect(deriveCurrentComposerPlanSteps({
      activeSnapshot: { planList: plan } as any,
      runInteractionState: runInteractionState("done"),
    })).toEqual([
      { step: "搜索网页", status: "completed" },
      { step: "整理结果", status: "completed" },
    ]);
  });

  it("hides plan steps while a clarification gate is open", () => {
    const plan = [
      { id: "step-1", step: "搜索网页", status: "in_progress" },
      { id: "step-2", step: "整理结果", status: "pending" },
    ] as const;

    expect(deriveCurrentComposerPlanSteps({
      activeSnapshot: { planList: plan } as any,
      runInteractionState: runInteractionState("clarification_required", "clarification"),
    })).toEqual([]);
  });

  it("hides plan steps while a plan decision gate is open", () => {
    const plan = [
      { id: "step-1", step: "搜索网页", status: "completed" },
      { id: "step-2", step: "整理结果", status: "completed" },
    ] as const;

    expect(deriveCurrentComposerPlanSteps({
      activeSnapshot: { planList: plan } as any,
      runInteractionState: runInteractionState("decision_needed", "plan_decision"),
    })).toEqual([]);
  });
});

function contextState(totalTokens: number) {
  return {
    activeTokenUsage: {
      inputTokens: totalTokens,
      outputTokens: 0,
      totalTokens,
      source: "estimate" as const,
    },
    contextWindow: 1_000,
    compactedHistory: [],
    compactedThroughTurnIndex: 0,
    compactionCount: 0,
  };
}

function runInteractionState(
  status: "running" | "done" | "clarification_required" | "decision_needed",
  gateKind?: "clarification" | "plan_decision",
) {
  return {
    status,
    isProcessing: status === "running",
    gateKind,
  };
}
