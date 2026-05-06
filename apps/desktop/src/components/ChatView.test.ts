import { describe, expect, it } from "vitest";
import { deriveProjectedGateTrays, getActiveChatProvider, getChatInputContextState } from "./ChatView";

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
