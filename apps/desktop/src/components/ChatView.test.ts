// @vitest-environment jsdom

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ChatView,
  canUseDesktopOverlayRail,
  CHAT_VIEW_COLLABORATION_ITEM_CLASS,
  CHAT_VIEW_COLLABORATION_PANEL_CLASS,
  CHAT_VIEW_OVERLAY_PANEL_CLASS,
  CHAT_VIEW_CONTENT_ROW_CLASS,
  CHAT_VIEW_DESKTOP_FLOATING_STACK_CLASS,
  CHAT_VIEW_DESKTOP_OVERLAY_IDEAL_CONTENT_ROW_WIDTH,
  CHAT_VIEW_DESKTOP_OVERLAY_MIN_CONTENT_ROW_WIDTH,
  CHAT_VIEW_DESKTOP_OVERLAY_RIGHT_INSET_PX,
  CHAT_VIEW_DESKTOP_OVERLAY_SAFE_GAP_PX,
  CHAT_VIEW_DESKTOP_OVERLAY_RAIL_CLASS,
  CHAT_VIEW_MAIN_CLASS,
  CHAT_VIEW_MESSAGES_PANEL_CLASS,
  CHAT_VIEW_ROOT_CLASS,
  CHAT_VIEW_STABLE_CONTENT_WIDTH_CLASS,
  CHAT_VIEW_WELCOME_VIEWPORT_CLASS,
  CHAT_VIEW_OVERLAY_SECTION_CLASS,
  CHAT_VIEW_OVERLAY_SECTION_HEADER_CLASS,
  collaborationStatusBadgeClassName,
  DesktopOverlayRail,
  deriveChildReplaySelection,
  deriveChatSurfaceContentWidthClassName,
  deriveChatSurfaceLaneClassName,
  deriveChatSurfaceLaneStyle,
  deriveChatSurfaceLaneWidthPx,
  deriveComposerPlanDecisionState,
  deriveOverlayChildStatusLabel,
  deriveOverlayChildTurnView,
  deriveCurrentComposerPlanSteps,
  derivePlanStepsPresentation,
  deriveProjectedGateTrays,
  deriveVisibleCollaborationChildren,
  getActiveChatProvider,
  getChatInputContextState,
  resolveComposerGateSnapshot,
  resolveOverlayChildSnapshot,
  shouldShowCollaborationOverlay,
  shouldShowDesktopOverlayRail,
} from "./ChatView";
import {
  FLOATING_OVERLAY_BADGE_BASE_CLASS,
  FLOATING_OVERLAY_CARD_CLASS,
  FLOATING_OVERLAY_PANEL_CLASS,
} from "./PlanStepsTray";
import {
  CHAT_SURFACE_FRAME_WIDTH_CLASS,
  CHAT_SURFACE_VIEWPORT_GUTTER_XL_REM,
  getChatSurfaceOccupiedWidthRem,
  CHAT_SURFACE_VIEWPORT_GUTTER_CLASS,
} from "./chatSurfaceLayout";

const mocks = vi.hoisted(() => ({
  workbench: {
    providerRegistry: { providers: [] },
    providerSecretStatuses: [],
    selectedProviderId: undefined,
    activeSessionDetail: {
      session: {},
      branchGroups: [],
    },
    sessionProjectFileAttachments: {},
    sessionLocalFileAttachments: {},
    sessionImageAttachments: {},
    pendingPlanDecisionResolution: undefined,
    planDecisionResolutionOverrides: {},
    language: "zh",
    selectedModeSelection: "manual",
    skillRegistry: { skills: [] },
    selectedSkillIds: [],
    permissionMode: "default",
    taskIntent: "implement",
  } as any,
  dispatch: vi.fn(),
  latestChatInputProps: null as any,
  latestChatMessagesProps: null as any,
}));

vi.mock("./ChatHeader", () => ({
  ChatHeader: () => null,
}));

vi.mock("./ChatMessages", () => ({
  ChatMessages: (props: unknown) => {
    mocks.latestChatMessagesProps = props;
    return createElement("div", { "data-testid": "chat-messages-stub" });
  },
}));

vi.mock("./ChatInput", () => ({
  ChatInput: (props: unknown) => {
    mocks.latestChatInputProps = props;
    return createElement("div", { "data-testid": "chat-input-stub" });
  },
}));

vi.mock("../lib/providerOptions", () => ({
  runnableProviderOptions: (providers: unknown[] = []) => providers,
}));

vi.mock("../lib/state", async () => {
  const actual = await vi.importActual("../lib/state");
  return {
    ...actual,
    useWorkbench: () => ({
      state: mocks.workbench,
      dispatch: mocks.dispatch,
    }),
  };
});

const cleanupCallbacks: Array<() => void> = [];

Object.assign(globalThis, {
  IS_REACT_ACT_ENVIRONMENT: true,
});

beforeEach(() => {
  mocks.dispatch.mockReset();
  mocks.latestChatInputProps = null;
  mocks.latestChatMessagesProps = null;
});

afterEach(() => {
  while (cleanupCallbacks.length > 0) {
    cleanupCallbacks.pop()?.();
  }
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

function renderElement(element: ReturnType<typeof createElement>) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(element);
  });

  const cleanup = () => {
    act(() => {
      root.unmount();
    });
    container.remove();
  };
  cleanupCallbacks.push(cleanup);

  return { container };
}

async function flushEffects() {
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

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

  it("uses lastCompaction.beforeTokens when session-level activeTokenUsage is stale after compaction", () => {
    const compactedSessionCtx = {
      ...contextState(300),
      lastCompaction: {
        phase: "pre_turn" as const,
        implementation: "local" as const,
        beforeTokens: 120_000,
        afterTokens: 300,
        limit: 115_200,
        reason: "context_limit" as const,
      },
    };

    const result = getChatInputContextState({
      activeSessionDetail: {
        session: {
          contextState: compactedSessionCtx,
        },
      },
    });
    // Should use beforeTokens (120K) instead of stale activeTokenUsage (300)
    expect(result!.activeTokenUsage!.totalTokens).toBe(120_000);
  });

  it("does not override activeTokenUsage when lastCompaction is absent", () => {
    const sessionContextState = contextState(500);

    const result = getChatInputContextState({
      activeSessionDetail: {
        session: {
          contextState: sessionContextState,
        },
      },
    });
    expect(result!.activeTokenUsage!.totalTokens).toBe(500);
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
  it("prefers the fresher active snapshot over a stale same-run cached turn snapshot", () => {
    const composerGateSnapshot = resolveComposerGateSnapshot({
      sourceRunId: "run-1",
      activeSnapshot: {
        runId: "run-1",
        updatedAt: 20,
        status: "succeeded",
        planDecisions: [{
          id: "decision-1",
          runId: "run-1",
          sessionId: "session-1",
          status: "declined",
          createdAt: 1,
          resolvedAt: 20,
        }],
      } as any,
      turnSnapshots: {
        "run-1": {
          runId: "run-1",
          updatedAt: 10,
          status: "succeeded",
          planDecisions: [{
            id: "decision-1",
            runId: "run-1",
            sessionId: "session-1",
            status: "pending",
            createdAt: 1,
          }],
        } as any,
      },
    });

    expect(composerGateSnapshot?.updatedAt).toBe(20);
    expect(deriveComposerPlanDecisionState({
      sessionId: "session-1",
      activeSnapshot: composerGateSnapshot,
    })).toEqual({
      pendingPlanDecisionId: undefined,
      planDecisionPending: false,
    });
  });

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

  it("does not show a resolved plan decision panel when stale attention still says needs_plan_decision", () => {
    expect(deriveComposerPlanDecisionState({
      sessionId: "session-1",
      activeSnapshot: {
        runId: "run-1",
        status: "succeeded",
        attention: {
          kind: "needs_plan_decision",
          blocking: true,
          sourceRunId: "run-1",
          reason: "plan_decision_required",
          planDecisionId: "decision-1",
          pendingActionIds: [],
          pendingToolCallIds: [],
          pendingClarificationIds: [],
        },
        planDecisions: [{
          id: "decision-1",
          runId: "run-1",
          sessionId: "session-1",
          status: "declined",
          createdAt: 1,
          resolvedAt: 2,
        }],
      } as any,
    })).toEqual({
      pendingPlanDecisionId: undefined,
      planDecisionPending: false,
    });
  });

  it("suppresses stale plan decision state when the decision was already resolved locally", () => {
    expect(deriveComposerPlanDecisionState({
      sessionId: "session-1",
      activeSnapshot: {
        runId: "run-1",
        status: "succeeded",
        attention: {
          kind: "needs_plan_decision",
          blocking: true,
          sourceRunId: "run-1",
          reason: "plan_decision_required",
          planDecisionId: "decision-1",
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
      planDecisionResolutionOverrides: {
        "session-1:decision-1": {
          sessionId: "session-1",
          decisionId: "decision-1",
          status: "accepted",
          resolvedAt: 2,
        },
      },
    })).toEqual({
      pendingPlanDecisionId: undefined,
      planDecisionPending: false,
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

describe("chat view plan steps presentation", () => {
  const plan = [
    { step: "搜索网页", status: "in_progress" },
    { step: "整理结果", status: "pending" },
  ] as const;

  it("keeps plan steps inline when the desktop overlay rail is unavailable", () => {
    expect(derivePlanStepsPresentation({
      planSteps: [...plan],
      canUseDesktopOverlayRail: false,
    })).toEqual({
      inlinePlanSteps: [...plan],
      floatingPlanSteps: [],
    });
  });

  it("moves plan steps into the floating rail when enough space is available", () => {
    expect(derivePlanStepsPresentation({
      planSteps: [...plan],
      canUseDesktopOverlayRail: true,
    })).toEqual({
      inlinePlanSteps: [],
      floatingPlanSteps: [...plan],
    });
  });
});

describe("chat view collaboration panel replay selection", () => {
  it("maps child replayRef to the first matching beat in the active snapshot", () => {
    expect(deriveChildReplaySelection({
      snapshot: {
        runId: "run-1",
        events: [
          { id: "evt-0", seq: 0 },
          { id: "evt-1", seq: 1 },
          { id: "evt-2", seq: 2 },
        ],
      } as any,
      child: {
        id: "run-1:child-1",
        agentId: "child-1",
        label: "Researcher",
        sessionClass: "temporary_spawn",
        status: "succeeded",
        startedAt: 1,
        updatedAt: 2,
        replayRef: {
          kind: "event_range",
          runId: "run-1",
          fromSeq: 1,
          toSeq: 2,
        },
      } as any,
    })).toEqual({
      runId: "run-1",
      beatId: "evt-1",
    });
  });

  it("returns undefined when replayRef points at another run", () => {
    expect(deriveChildReplaySelection({
      snapshot: {
        runId: "run-parent",
        events: [{ id: "evt-0", seq: 0 }],
      } as any,
      child: {
        id: "run-parent:child-1",
        agentId: "child-1",
        label: "Researcher",
        sessionClass: "temporary_spawn",
        status: "running",
        startedAt: 1,
        updatedAt: 1,
        replayRef: {
          kind: "event_range",
          runId: "run-child",
          fromSeq: 0,
        },
      } as any,
    })).toBeUndefined();
  });
});

describe("chat view collaboration overlay visibility", () => {
  it("does not allow the desktop overlay rail before the content row is measured", () => {
    expect(canUseDesktopOverlayRail({
      isDesktopViewport: true,
      contentRowWidth: null,
    })).toBe(false);
  });

  it("hides the desktop overlay rail when the content row is too narrow", () => {
    expect(canUseDesktopOverlayRail({
      isDesktopViewport: true,
      contentRowWidth: CHAT_VIEW_DESKTOP_OVERLAY_MIN_CONTENT_ROW_WIDTH - 1,
    })).toBe(false);
  });

  it("shows the desktop overlay rail once the content row reaches the minimum safe width", () => {
    expect(canUseDesktopOverlayRail({
      isDesktopViewport: true,
      contentRowWidth: CHAT_VIEW_DESKTOP_OVERLAY_MIN_CONTENT_ROW_WIDTH,
    })).toBe(true);
  });

  it("keeps the desktop overlay rail visible below the ideal width as long as the minimum width is satisfied", () => {
    expect(canUseDesktopOverlayRail({
      isDesktopViewport: true,
      contentRowWidth: CHAT_VIEW_DESKTOP_OVERLAY_IDEAL_CONTENT_ROW_WIDTH - 1,
    })).toBe(true);
  });

  it("shows lifecycle-visible child sessions in the floating overlay", () => {
    expect(deriveVisibleCollaborationChildren({
      childSessions: [
        childSession("queued-child", "queued"),
        childSession("running-child", "running"),
        childSession("awaiting-child", "succeeded", "awaiting_pickup", "awaiting_pickup"),
        childSession("stalled-child", "running", undefined, "stalled"),
        childSession("done-child", "succeeded"),
        childSession("failed-child", "failed"),
      ],
    } as any)).toMatchObject([
      { id: "queued-child", status: "queued" },
      { id: "running-child", status: "running" },
      { id: "awaiting-child", status: "succeeded", deliveryStatus: "awaiting_pickup" },
      { id: "stalled-child", lifecyclePhase: "stalled" },
    ]);
  });

  it("excludes mode-stage child sessions from the floating overlay even when they are active", () => {
    expect(deriveVisibleCollaborationChildren({
      childSessions: [
        childSession("dynamic-child", "running"),
        {
          ...childSession("mode-stage-child", "running"),
          sessionClass: "mode_subagent" as const,
          authoritySource: "mode_stage" as const,
          delegationKind: "mode_stage" as const,
        },
      ],
    } as any)).toMatchObject([
      { id: "dynamic-child", status: "running" },
    ]);
  });

  it("hides the overlay when there are no active child sessions", () => {
    expect(shouldShowCollaborationOverlay({
      childSessions: [
        childSession("done-child", "succeeded"),
        childSession("failed-child", "failed"),
      ],
      parentCoordination: {
        phase: "waiting_on_required_children",
        activeChildIds: [],
        waitingChildIds: ["done-child"],
      },
    } as any)).toBe(false);
  });

  it("shows the overlay once at least one child is queued or running", () => {
    expect(shouldShowCollaborationOverlay({
      childSessions: [
        childSession("done-child", "succeeded"),
        childSession("running-child", "running"),
      ],
    } as any)).toBe(true);
  });

  it("shows the desktop overlay rail when plan steps are floating even without child sessions", () => {
    expect(shouldShowDesktopOverlayRail({
      hasCollaborationOverlay: false,
      hasFloatingPlanSteps: true,
      canUseDesktopOverlayRail: true,
    })).toBe(true);
  });

  it("keeps the desktop overlay rail hidden when neither collaboration nor floating plan steps exist", () => {
    expect(shouldShowDesktopOverlayRail({
      hasCollaborationOverlay: false,
      hasFloatingPlanSteps: false,
      canUseDesktopOverlayRail: true,
    })).toBe(false);
  });

  it("keeps the desktop overlay rail hidden when space is insufficient even if content exists", () => {
    expect(shouldShowDesktopOverlayRail({
      hasCollaborationOverlay: true,
      hasFloatingPlanSteps: true,
      canUseDesktopOverlayRail: false,
    })).toBe(false);
  });

  it("keeps a stable overlay-aware content width even when the overlay is visible", () => {
    expect(deriveChatSurfaceContentWidthClassName(true)).toContain(
      CHAT_VIEW_STABLE_CONTENT_WIDTH_CLASS,
    );
    expect(deriveChatSurfaceContentWidthClassName(true)).toBe(
      CHAT_VIEW_STABLE_CONTENT_WIDTH_CLASS,
    );
    expect(deriveChatSurfaceContentWidthClassName(true)).toContain(
      CHAT_SURFACE_FRAME_WIDTH_CLASS,
    );
  });

  it("keeps the same stable content width when no collaboration overlay is shown", () => {
    expect(deriveChatSurfaceContentWidthClassName(false)).toContain(
      CHAT_VIEW_STABLE_CONTENT_WIDTH_CLASS,
    );
    expect(deriveChatSurfaceContentWidthClassName(false)).toBe(
      deriveChatSurfaceContentWidthClassName(true),
    );
  });

  it("keeps the welcome copy on the same viewport gutter contract as the messages and composer", () => {
    expect(CHAT_VIEW_WELCOME_VIEWPORT_CLASS).toBe(
      CHAT_SURFACE_VIEWPORT_GUTTER_CLASS,
    );
    expect(CHAT_VIEW_WELCOME_VIEWPORT_CLASS).toContain("px-4");
    expect(CHAT_VIEW_WELCOME_VIEWPORT_CLASS).toContain("md:px-6");
    expect(CHAT_VIEW_WELCOME_VIEWPORT_CLASS).toContain("xl:px-8");
  });

  it("keeps the shared surface full-width when the overlay is hidden", () => {
    expect(deriveChatSurfaceLaneClassName(false)).toBe("w-full");
    expect(deriveChatSurfaceLaneWidthPx({
      hasDesktopOverlayRail: false,
      contentRowWidth: CHAT_VIEW_DESKTOP_OVERLAY_IDEAL_CONTENT_ROW_WIDTH,
      railWidth: 320,
    })).toBeNull();
    expect(deriveChatSurfaceLaneStyle(null)).toBeUndefined();
  });

  it("adds a max-width transition class when the overlay lane is active", () => {
    expect(deriveChatSurfaceLaneClassName(true)).toContain("transition-[max-width]");
  });

  it("derives the left lane width from content width minus rail occupancy", () => {
    expect(deriveChatSurfaceLaneWidthPx({
      hasDesktopOverlayRail: true,
      contentRowWidth: 1200,
      railWidth: 320,
      railRightInsetPx: CHAT_VIEW_DESKTOP_OVERLAY_RIGHT_INSET_PX,
      safeGapPx: CHAT_VIEW_DESKTOP_OVERLAY_SAFE_GAP_PX,
    })).toBe(824);
    expect(deriveChatSurfaceLaneStyle(824)).toEqual({
      maxWidth: "824px",
    });
  });

  it("shrinks the left lane when the measured rail gets wider", () => {
    const base = deriveChatSurfaceLaneWidthPx({
      hasDesktopOverlayRail: true,
      contentRowWidth: 1200,
      railWidth: 280,
      railRightInsetPx: CHAT_VIEW_DESKTOP_OVERLAY_RIGHT_INSET_PX,
      safeGapPx: CHAT_VIEW_DESKTOP_OVERLAY_SAFE_GAP_PX,
    });
    const wider = deriveChatSurfaceLaneWidthPx({
      hasDesktopOverlayRail: true,
      contentRowWidth: 1200,
      railWidth: 320,
      railRightInsetPx: CHAT_VIEW_DESKTOP_OVERLAY_RIGHT_INSET_PX,
      safeGapPx: CHAT_VIEW_DESKTOP_OVERLAY_SAFE_GAP_PX,
    });

    expect(base).toBe(864);
    expect(wider).toBe(824);
    expect(wider ?? 0).toBeLessThan(base ?? 0);
  });

  it("returns no lane width when the rail would consume the whole row", () => {
    expect(deriveChatSurfaceLaneWidthPx({
      hasDesktopOverlayRail: true,
      contentRowWidth: 350,
      railWidth: 320,
      railRightInsetPx: CHAT_VIEW_DESKTOP_OVERLAY_RIGHT_INSET_PX,
      safeGapPx: CHAT_VIEW_DESKTOP_OVERLAY_SAFE_GAP_PX,
    })).toBeNull();
  });

  describe("deriveChatSurfaceLaneWidthPx with idealFrameWidthPx", () => {
    it("returns null when space is ample for the full visible chat surface", () => {
      // At 16px root font, occupied surface width is:
      // (43.2 + xl gutters 2+2 + safety margin 3) * 16 ≈ 803
      // Content row 1400, rail 320, rightInset 32, safeGap 24
      // laneWidth = 1400 - 376 = 1024 >= 803 → null
      expect(deriveChatSurfaceLaneWidthPx({
        hasDesktopOverlayRail: true,
        contentRowWidth: 1400,
        railWidth: 320,
        railRightInsetPx: CHAT_VIEW_DESKTOP_OVERLAY_RIGHT_INSET_PX,
        safeGapPx: CHAT_VIEW_DESKTOP_OVERLAY_SAFE_GAP_PX,
        occupiedSurfaceWidthPx: Math.round(getChatSurfaceOccupiedWidthRem({
          viewportGutterXRem: CHAT_SURFACE_VIEWPORT_GUTTER_XL_REM,
        }) * 16),
      })).toBeNull();
    });

    it("returns constrained width when the full visible surface would be squeezed", () => {
      // Content row 1000, rail 320, rightInset 32, safeGap 24
      // laneWidth = 1000 - 376 = 624 < 803 → return 624
      expect(deriveChatSurfaceLaneWidthPx({
        hasDesktopOverlayRail: true,
        contentRowWidth: 1000,
        railWidth: 320,
        railRightInsetPx: CHAT_VIEW_DESKTOP_OVERLAY_RIGHT_INSET_PX,
        safeGapPx: CHAT_VIEW_DESKTOP_OVERLAY_SAFE_GAP_PX,
        occupiedSurfaceWidthPx: Math.round(getChatSurfaceOccupiedWidthRem({
          viewportGutterXRem: CHAT_SURFACE_VIEWPORT_GUTTER_XL_REM,
        }) * 16),
      })).toBe(624);
    });

    it("shrinks the lane even when the bare frame still fits but the guttered surface no longer does", () => {
      expect(deriveChatSurfaceLaneWidthPx({
        hasDesktopOverlayRail: true,
        contentRowWidth: 1156,
        railWidth: 320,
        railRightInsetPx: CHAT_VIEW_DESKTOP_OVERLAY_RIGHT_INSET_PX,
        safeGapPx: CHAT_VIEW_DESKTOP_OVERLAY_SAFE_GAP_PX,
        occupiedSurfaceWidthPx: Math.round(getChatSurfaceOccupiedWidthRem({
          viewportGutterXRem: CHAT_SURFACE_VIEWPORT_GUTTER_XL_REM,
        }) * 16),
      })).toBe(780);
    });

    it("returns null when no rail (regardless of occupiedSurfaceWidthPx)", () => {
      expect(deriveChatSurfaceLaneWidthPx({
        hasDesktopOverlayRail: false,
        contentRowWidth: 1200,
        railWidth: 320,
        safeGapPx: CHAT_VIEW_DESKTOP_OVERLAY_SAFE_GAP_PX,
        occupiedSurfaceWidthPx: Math.round(getChatSurfaceOccupiedWidthRem({
          viewportGutterXRem: CHAT_SURFACE_VIEWPORT_GUTTER_XL_REM,
        }) * 16),
      })).toBeNull();
    });

    it("falls back to the measured lane width when no occupied surface threshold is passed", () => {
      expect(deriveChatSurfaceLaneWidthPx({
        hasDesktopOverlayRail: true,
        contentRowWidth: 1400,
        railWidth: 320,
        railRightInsetPx: CHAT_VIEW_DESKTOP_OVERLAY_RIGHT_INSET_PX,
        safeGapPx: CHAT_VIEW_DESKTOP_OVERLAY_SAFE_GAP_PX,
      })).toBe(1024);
    });
  });

  it("anchors the desktop overlay rail near the content area's top-right edge", () => {
    expect(CHAT_VIEW_DESKTOP_OVERLAY_RAIL_CLASS).toContain("absolute");
    expect(CHAT_VIEW_DESKTOP_OVERLAY_RAIL_CLASS).toContain("right-8");
    expect(CHAT_VIEW_DESKTOP_OVERLAY_RAIL_CLASS).toContain("top-7");
    expect(CHAT_VIEW_DESKTOP_OVERLAY_RAIL_CLASS).toContain("hidden");
    expect(CHAT_VIEW_DESKTOP_OVERLAY_RAIL_CLASS).toContain("lg:block");
    expect(CHAT_VIEW_DESKTOP_OVERLAY_RAIL_CLASS).toContain("xl:right-10");
    expect(CHAT_VIEW_DESKTOP_OVERLAY_RAIL_CLASS).toContain("xl:top-8");
  });

  it("keeps the desktop overlay stack interactive with a bounded floating width", () => {
    expect(CHAT_VIEW_DESKTOP_FLOATING_STACK_CLASS).toContain("pointer-events-auto");
    expect(CHAT_VIEW_DESKTOP_FLOATING_STACK_CLASS).toContain("flex");
    expect(CHAT_VIEW_DESKTOP_FLOATING_STACK_CLASS).toContain("gap-2.5");
    expect(CHAT_VIEW_DESKTOP_FLOATING_STACK_CLASS).toContain("w-[min(20rem,calc(100vw-8.5rem))]");
  });

  it("uses a single unified floating shell for the right overlay rail", () => {
    expect(CHAT_VIEW_OVERLAY_PANEL_CLASS).toBe(FLOATING_OVERLAY_PANEL_CLASS);
    expect(CHAT_VIEW_COLLABORATION_ITEM_CLASS).toBe(FLOATING_OVERLAY_CARD_CLASS);
    expect(CHAT_VIEW_COLLABORATION_ITEM_CLASS).not.toContain("bg-card/80");
  });

  it("keeps the desktop content row on a single stacked layout while the floating overlay remains absolute", () => {
    expect(CHAT_VIEW_CONTENT_ROW_CLASS).toContain("overflow-hidden");
    expect(renderToStaticMarkup(
      createElement(DesktopOverlayRail, {
        childSessions: [childSession("running-child", "running")],
        planSteps: [{ step: "整理结果", status: "pending" }],
        planSectionOpen: true,
        collaborationSectionOpen: true,
        onTogglePlanSection: () => undefined,
        onToggleCollaborationSection: () => undefined,
        onOpenChildSessionPage: () => undefined,
      }),
    )).toContain(CHAT_VIEW_DESKTOP_OVERLAY_RAIL_CLASS);
  });

  it("renders the collaboration panel with the shared floating shell and softened child cards", () => {
    const html = renderToStaticMarkup(
      createElement(DesktopOverlayRail, {
        childSessions: [childSession("running-child", "running")],
        planSteps: [{ step: "整理结果", status: "pending" }],
        planSectionOpen: true,
        collaborationSectionOpen: true,
        onTogglePlanSection: () => undefined,
        onToggleCollaborationSection: () => undefined,
        onOpenChildSessionPage: () => undefined,
      }),
    );

    expect(html).toContain(CHAT_VIEW_OVERLAY_PANEL_CLASS);
    expect(html).toContain("进度");
    expect(html).toContain("协作");
    expect(html).toContain("1 个任务仍在协作流程中");
    expect(html).toContain(CHAT_VIEW_COLLABORATION_ITEM_CLASS);
    expect(html).toContain("执行中");
  });

  it("uses a vertically balanced overlay section header", () => {
    expect(CHAT_VIEW_OVERLAY_SECTION_CLASS).toContain("pt-2.5");
    expect(CHAT_VIEW_OVERLAY_SECTION_HEADER_CLASS).toContain("min-h-14");
    expect(CHAT_VIEW_OVERLAY_SECTION_HEADER_CLASS).toContain("py-2");
  });

  it("keeps the running badge on navigation-only collaboration cards", () => {
    const html = renderToStaticMarkup(
      createElement(DesktopOverlayRail, {
        childSessions: [{
          ...childSession("run-parent-1:ora-sub-1", "running"),
          agentId: "ora-sub-1",
          label: "Research subagent",
          summary: "后台子 Agent 正在执行任务。",
          sourceRunId: "run-parent-1",
          replayRef: {
            kind: "event_range",
            runId: "run-parent-1",
            fromSeq: 0,
            toSeq: 0,
          },
        }],
        planSteps: [],
        planSectionOpen: true,
        collaborationSectionOpen: true,
        onTogglePlanSection: () => undefined,
        onToggleCollaborationSection: () => undefined,
        onOpenChildSessionPage: () => undefined,
      }),
    );

    expect(html).toContain("执行中");
    expect(html).not.toContain("完善中");
  });

  it("keeps collaboration status badges on muted surfaces instead of bright white pills", () => {
    expect(collaborationStatusBadgeClassName("queued")).toContain(
      FLOATING_OVERLAY_BADGE_BASE_CLASS,
    );
    expect(collaborationStatusBadgeClassName("queued")).toContain("bg-muted/65");
    expect(collaborationStatusBadgeClassName("running")).toContain("bg-accent/80");
    expect(
      collaborationStatusBadgeClassName("succeeded", "awaiting_pickup", "awaiting_pickup"),
    ).toContain("bg-emerald-50/70");
    expect(collaborationStatusBadgeClassName("running", "stalled")).toContain("text-destructive");
  });

  it("renders lifecycle-driven labels without relying on content heuristics", () => {
    expect(deriveOverlayChildStatusLabel({
      child: childSession("output-child", "running", undefined, "produced_output") as any,
    })).toBe("完善中");
    expect(deriveOverlayChildStatusLabel({
      child: childSession("awaiting-child", "succeeded", "awaiting_pickup", "awaiting_pickup") as any,
    })).toBe("待整合");
    expect(deriveOverlayChildStatusLabel({
      child: childSession("stalled-child", "running", undefined, "stalled") as any,
    })).toBe("卡住");
  });

  it("prefers a real child snapshot keyed by child.id", () => {
    const snapshot = { runId: "run-child-1" } as any;
    expect(resolveOverlayChildSnapshot({
      ...childSession("run-child-1", "running"),
      sourceRunId: "run-parent-1",
    } as any, {
      "run-child-1": snapshot,
      "run-parent-1": { runId: "run-parent-1" } as any,
    })).toBe(snapshot);
  });

  it("derives a child session turn view from replay data instead of mirroring the parent snapshot", () => {
    const turnView = deriveOverlayChildTurnView({
      ...childSession("run-parent-1:ora-sub-1", "running"),
      agentId: "ora-sub-1",
      label: "Research subagent",
      summary: "正在整理调研结论",
      sourceRunId: "run-parent-1",
      replayRef: {
        kind: "event_range",
        runId: "run-parent-1",
        fromSeq: 0,
        toSeq: 2,
      },
    } as any, {
      "run-parent-1": parentOverlaySnapshot(),
    });

    expect(turnView?.content).toBe("子代理最终结论。");
    expect(turnView?.turn.currentAgentLabel).toBe("Research subagent");
    const firstTimelineItem = turnView?.turn.timelineItems?.[0];
    expect(firstTimelineItem).toMatchObject({
      kind: "status_group",
    });
    expect(
      firstTimelineItem && "summary" in firstTimelineItem
        ? firstTimelineItem.summary
        : "",
    ).toContain("AssistantTurnCard.tsx");
  });

  it("extends active child replay beyond a stale persisted toSeq when newer child events exist", () => {
    const turnView = deriveOverlayChildTurnView({
      ...childSession("run-parent-1:ora-sub-1", "running"),
      agentId: "ora-sub-1",
      label: "Research subagent",
      summary: "后台子 Agent 正在执行任务。",
      sourceRunId: "run-parent-1",
      replayRef: {
        kind: "event_range",
        runId: "run-parent-1",
        fromSeq: 0,
        toSeq: 0,
      },
    } as any, {
      "run-parent-1": parentOverlaySnapshot(),
    });

    expect(turnView?.content).toBe("子代理最终结论。");
  });

  it("renders collaboration cards as navigation items with title and status only", () => {
    const html = renderToStaticMarkup(
      createElement(DesktopOverlayRail, {
        childSessions: [{
          ...childSession("run-parent-1:ora-sub-1", "running"),
          agentId: "ora-sub-1",
          label: "Research subagent",
          summary: "后台子 Agent 正在执行任务。",
          sourceRunId: "run-parent-1",
          replayRef: {
            kind: "event_range",
            runId: "run-parent-1",
            fromSeq: 0,
            toSeq: 0,
          },
        }],
        planSteps: [],
        planSectionOpen: true,
        collaborationSectionOpen: true,
        onTogglePlanSection: () => undefined,
        onToggleCollaborationSection: () => undefined,
        onOpenChildSessionPage: () => undefined,
      }),
    );

    expect(html).toContain("Research subagent");
    expect(html).toContain("执行中");
    expect(html).not.toContain("子代理最终结论。");
    expect(html).not.toContain("后台子 Agent 正在执行任务。");
    expect(html).not.toContain("等待子代理内容同步");
    expect(html).not.toContain("aria-expanded");
  });

  it("opens the workspace child-session page when a collaboration card is clicked", () => {
    const onOpenChildSessionPage = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        createElement(DesktopOverlayRail, {
          childSessions: [{
            ...childSession("run-parent-1:ora-sub-1", "running"),
            agentId: "ora-sub-1",
            label: "Research subagent",
            summary: "后台子 Agent 正在执行任务。",
            sourceRunId: "run-parent-1",
            replayRef: {
              kind: "event_range",
              runId: "run-parent-1",
              fromSeq: 0,
              toSeq: 0,
            },
          }],
          planSteps: [],
          planSectionOpen: true,
          collaborationSectionOpen: true,
          onTogglePlanSection: () => undefined,
          onToggleCollaborationSection: () => undefined,
          onOpenChildSessionPage,
        }),
      );
    });

    const button = Array.from(container.querySelectorAll("button")).find((entry) =>
      entry.textContent?.includes("Research subagent"),
    );
    expect(button).toBeTruthy();

    act(() => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onOpenChildSessionPage).toHaveBeenCalledWith(
      expect.objectContaining({
        childId: "run-parent-1:ora-sub-1",
        targetRunId: "run-parent-1:ora-sub-1",
        title: "Research subagent",
        backing: "replay",
        replayParentRunId: "run-parent-1",
      }),
    );

    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("does not render child summaries even when a long summary is available", () => {
    const longSummary = "很长的子代理摘要".repeat(80);
    const html = renderToStaticMarkup(
      createElement(DesktopOverlayRail, {
        childSessions: [{
          ...childSession("run-parent-1:ora-sub-1", "running"),
          agentId: "ora-sub-1",
          label: "Research subagent",
          summary: longSummary,
          sourceRunId: "run-parent-1",
        }],
        planSteps: [],
        planSectionOpen: true,
        collaborationSectionOpen: true,
        onTogglePlanSection: () => undefined,
        onToggleCollaborationSection: () => undefined,
        onOpenChildSessionPage: () => undefined,
      }),
    );

    expect(html).toContain("Research subagent");
    expect(html).not.toContain(longSummary);
    expect(html).toContain("grid-cols-[minmax(0,1fr)_auto]");
  });

  it("does not return the raw parent snapshot when sourceRunId points at the parent run", () => {
    const parentSnapshot = parentOverlaySnapshot();
    const resolved = resolveOverlayChildSnapshot({
      ...childSession("run-parent-1:ora-sub-1", "running"),
      agentId: "ora-sub-1",
      sourceRunId: "run-parent-1",
      replayRef: {
        kind: "event_range",
        runId: "run-parent-1",
        fromSeq: 0,
        toSeq: 2,
      },
    } as any, {
      "run-parent-1": parentSnapshot,
    });

    expect(resolved).not.toBe(parentSnapshot);
    expect(resolved?.runId).toBe("run-parent-1:ora-sub-1");
    expect(resolved?.output).toBeUndefined();
  });

  it("returns no child turn view when the snapshot is not available yet", () => {
    expect(deriveOverlayChildTurnView({
      ...childSession("child-a", "running"),
      label: "Research subagent",
      sourceRunId: "run-parent-missing",
    } as any, {})).toBeUndefined();
  });

  it("returns no child snapshot when only the parent sourceRunId is available without replay data", () => {
    expect(resolveOverlayChildSnapshot({
      ...childSession("run-parent-1:ora-sub-1", "running"),
      agentId: "ora-sub-1",
      sourceRunId: "run-parent-1",
    } as any, {
      "run-parent-1": parentOverlaySnapshot(),
    })).toBeUndefined();
  });
});

describe("chat view layout classes", () => {
  it("keeps the chat view root as a clipped column layout", () => {
    expect(CHAT_VIEW_ROOT_CLASS).toContain("flex-col");
    expect(CHAT_VIEW_ROOT_CLASS).toContain("min-h-0");
    expect(CHAT_VIEW_ROOT_CLASS).toContain("overflow-hidden");
  });

  it("keeps the main chat column clipped and positioned for the composer overlay", () => {
    expect(CHAT_VIEW_MAIN_CLASS).toContain("relative");
    expect(CHAT_VIEW_MAIN_CLASS).toContain("flex-col");
    expect(CHAT_VIEW_MAIN_CLASS).toContain("min-h-0");
    expect(CHAT_VIEW_MAIN_CLASS).toContain("overflow-hidden");
  });

  it("keeps the content row height-constrained so the message area can scroll", () => {
    expect(CHAT_VIEW_CONTENT_ROW_CLASS).toContain("relative flex ");
    expect(CHAT_VIEW_CONTENT_ROW_CLASS).toContain("min-h-0");
    expect(CHAT_VIEW_CONTENT_ROW_CLASS).toContain("min-w-0");
    expect(CHAT_VIEW_CONTENT_ROW_CLASS).toContain("flex-1");
    expect(CHAT_VIEW_CONTENT_ROW_CLASS).toContain("overflow-hidden");
  });

  it("keeps the chat messages inside a dedicated non-scrolling flex column wrapper", () => {
    expect(CHAT_VIEW_MESSAGES_PANEL_CLASS).toContain("flex");
    expect(CHAT_VIEW_MESSAGES_PANEL_CLASS).toContain("flex-col");
    expect(CHAT_VIEW_MESSAGES_PANEL_CLASS).toContain("min-h-0");
    expect(CHAT_VIEW_MESSAGES_PANEL_CLASS).toContain("overflow-hidden");
  });

  it("applies the computed left-lane max width to the lane wrapper when the floating rail is visible", async () => {
    const originalMatchMedia = window.matchMedia;
    const resizeObserverInstances: Array<{ callback: ResizeObserverCallback }> = [];
    class ResizeObserverStub {
      callback: ResizeObserverCallback;

      constructor(callback: ResizeObserverCallback) {
        this.callback = callback;
        resizeObserverInstances.push({ callback });
      }

      observe() {}
      disconnect() {}
      unobserve() {}
    }

    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn((query: string) => ({
        matches: query === "(min-width: 1024px)",
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    Object.defineProperty(globalThis, "ResizeObserver", {
      writable: true,
      value: ResizeObserverStub,
    });

    const view = renderElement(
      createElement(ChatView, baseChatViewProps({
        activeSnapshot: {
          childSessions: [childSession("running-child", "running")],
          planList: [],
        } as any,
      })),
    );

    await flushEffects();

    const contentRow = view.container.querySelector("[data-testid=\"chat-content-row\"]") as HTMLDivElement | null;
    expect(contentRow).toBeTruthy();

    contentRow!.getBoundingClientRect = () => ({ width: 1200 } as DOMRect);
    act(() => {
      resizeObserverInstances[0]?.callback([
        { contentRect: { width: 1200 } } as ResizeObserverEntry,
      ], {} as ResizeObserver);
    });

    await flushEffects();

    const rail = view.container.querySelector("[data-testid=\"desktop-overlay-rail-stack\"]") as HTMLDivElement | null;
    expect(rail).toBeTruthy();

    rail!.getBoundingClientRect = () => ({ width: 320 } as DOMRect);
    act(() => {
      resizeObserverInstances[1]?.callback([
        { contentRect: { width: 320 } } as ResizeObserverEntry,
      ], {} as ResizeObserver);
    });

    await flushEffects();

    const lane = view.container.querySelector("[data-testid=\"chat-shared-surface-lane\"]") as HTMLDivElement | null;
    const shell = view.container.querySelector("[data-testid=\"chat-shared-surface-shell\"]") as HTMLDivElement | null;
    expect(lane?.style.maxWidth).toBe("");
    expect(shell?.style.maxWidth).toBe("");
    expect(shell?.className).toContain("relative flex min-h-0 flex-1 flex-col");

    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: originalMatchMedia,
    });
  });
});

describe("chat view shared chat surface contract", () => {
  it("passes the same surface frame width contract to messages and composer", () => {
    renderToStaticMarkup(
      createElement(ChatView, baseChatViewProps()),
    );

    expect(mocks.latestChatMessagesProps?.surfaceFrameWidthClassName).toBe(
      mocks.latestChatInputProps?.surfaceFrameWidthClassName,
    );
    expect(mocks.latestChatMessagesProps?.surfaceFrameWidthClassName).toBe(
      CHAT_VIEW_STABLE_CONTENT_WIDTH_CLASS,
    );
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

function baseChatViewProps(
  overrides: Record<string, unknown> = {},
) {
  return {
    activeMode: {
      id: "single_agent",
      family: "single_agent",
      label: "单智能体",
      summary: "默认模式",
    },
    modeCards: [{
      id: "single_agent",
      family: "single_agent",
      label: "单智能体",
      summary: "默认模式",
    }],
    activeSnapshot: undefined,
    actionRecords: [],
    agents: [],
    busyCommand: undefined,
    chatMessages: [],
    turnSnapshots: {},
    checkpoints: [],
    composerPrompt: "",
    isLoading: false,
    runInteractionState: runInteractionState("done"),
    selectedSession: {
      id: "session-1",
      sessionId: "session-1",
      title: "Session 1",
      status: "idle",
      updatedAt: 1,
    },
    selectedCustomAgentId: undefined,
    projectLabel: undefined,
    projectRootPath: undefined,
    streamLines: [],
    topologyEdges: [],
    topologyNodes: [],
    onCancelRun: () => undefined,
    onComposerPromptChange: () => undefined,
    onClearSelectedCustomAgent: () => undefined,
    onForkSessionFromTurn: () => undefined,
    onAdoptBranchGroup: () => undefined,
    onInterruptRun: () => undefined,
    onReplaySelection: () => undefined,
    onResumeRun: () => undefined,
    onOpenChildSessionPage: () => undefined,
    onAcceptPlanDecisionAndStartImplementation: () => undefined,
    onResolvePlanDecision: () => undefined,
    onOpenArtifact: () => undefined,
    onSubmitFeedback: async () => undefined,
    onSubmitAllClarifications: () => undefined,
    onSelectMode: () => undefined,
    onSelectModeSelection: () => undefined,
    onSelectNode: () => undefined,
    onSelectSession: () => undefined,
    onStartRun: () => undefined,
    onSetRightWorkspaceOpen: () => undefined,
    selectedSessionWorkspace: {
      mode: "session",
      sessionId: "session-1",
    },
    ...overrides,
  } as any;
}

function childSession(
  id: string,
  status: "queued" | "running" | "succeeded" | "failed",
  deliveryStatus?: "awaiting_pickup" | "consumed",
  lifecyclePhase?: "queued" | "running" | "produced_output" | "awaiting_pickup" | "picked_up" | "succeeded" | "failed" | "stalled",
) {
  return {
    id,
    agentId: id,
    label: id,
    sessionClass: "temporary_spawn" as const,
    authoritySource: "dynamic_spawn" as const,
    delegationKind: "dynamic_spawn" as const,
    status,
    lifecyclePhase,
    deliveryStatus,
    startedAt: 1,
    updatedAt: 1,
    artifactIds: [],
    recoveryAttemptCount: 0,
  };
}

function childOverlaySnapshot() {
  return {
    runId: "run-child-1",
    sessionId: "session-child-1",
    turnIndex: 1,
    status: "succeeded",
    pattern: "orchestrator_subagent",
    modeId: "research",
    input: { prompt: "调研相关组件", createdAt: 1, context: {} },
    config: {
      modeId: "research",
      pattern: "orchestrator_subagent",
      modeSelection: "manual",
      profileIds: ["ora-sub-1"],
      providerId: "local-smoke",
      modelRef: "local/smoke-model",
      approvalMode: "high_risk_only",
      patternOptions: {},
      metadata: {},
      deterministicSeed: "chat-view-overlay-child-snapshot-test",
      skillIds: [],
      toolIds: ["file.read"],
    },
    topology: { nodes: [], edges: [] },
    profiles: [{ id: "ora-sub-1", label: "Research subagent", role: "research", model: "local/smoke-model", tools: [], budget: "", memoryScopes: [] }],
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
    events: [{
      id: "run-child-1:evt-0",
      runId: "run-child-1",
      seq: 0,
      type: "tool.called",
      agentId: "ora-sub-1",
      createdAt: 1,
      pattern: "orchestrator_subagent",
      payload: {
        toolId: "file.read",
        status: "succeeded",
        input: { path: "apps/desktop/src/components/AssistantTurnCard.tsx" },
        output: { path: "apps/desktop/src/components/AssistantTurnCard.tsx", sizeBytes: 128 },
      },
    }],
    agentMessages: [],
    childSessions: [],
    artifacts: [],
    activeAgents: [],
    queueSummary: { mode: "dag", pending: 0, inProgress: 0, completed: 1, topics: [] },
    sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
    busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
    pendingClarifications: [],
    pendingApprovals: [],
    output: { text: "子代理最终结论。" },
    updatedAt: 2,
  } as any;
}

function parentOverlaySnapshot() {
  return {
    runId: "run-parent-1",
    sessionId: "session-parent-1",
    turnIndex: 1,
    status: "running",
    pattern: "orchestrator_subagent",
    modeId: "orchestrator_subagent",
    input: { prompt: "总结子代理结果", createdAt: 1, context: {} },
    config: {
      modeId: "orchestrator_subagent",
      pattern: "orchestrator_subagent",
      modeSelection: "manual",
      profileIds: ["ora", "ora-sub-1"],
      providerId: "local-smoke",
      modelRef: "local/smoke-model",
      approvalMode: "high_risk_only",
      patternOptions: {},
      metadata: {},
      deterministicSeed: "chat-view-overlay-parent-replay-test",
      skillIds: [],
      toolIds: ["file.read"],
    },
    topology: { nodes: [], edges: [] },
    profiles: [
      { id: "ora", label: "Orchestrator", role: "orchestrator", model: "local/smoke-model", tools: [], budget: "", memoryScopes: [] },
      { id: "ora-sub-1", label: "Research subagent", role: "research", model: "local/smoke-model", tools: [], budget: "", memoryScopes: [] },
    ],
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
    events: [
      {
        id: "run-parent-1:evt-0",
        runId: "run-parent-1",
        seq: 0,
        type: "child_session.updated",
        agentId: "ora-sub-1",
        nodeId: "ora-sub-1",
        createdAt: 1,
        pattern: "orchestrator_subagent",
        payload: {
          childSession: {
            ...childSession("run-parent-1:ora-sub-1", "running"),
            agentId: "ora-sub-1",
            label: "Research subagent",
          },
        },
      },
      {
        id: "run-parent-1:evt-1",
        runId: "run-parent-1",
        seq: 1,
        type: "tool.called",
        agentId: "ora-sub-1",
        nodeId: "ora-sub-1",
        createdAt: 2,
        pattern: "orchestrator_subagent",
        payload: {
          toolId: "file.read",
          status: "succeeded",
          input: { path: "apps/desktop/src/components/AssistantTurnCard.tsx" },
          output: { path: "apps/desktop/src/components/AssistantTurnCard.tsx", sizeBytes: 128 },
        },
      },
      {
        id: "run-parent-1:evt-2",
        runId: "run-parent-1",
        seq: 2,
        type: "message.delta",
        agentId: "ora-sub-1",
        nodeId: "ora-sub-1",
        createdAt: 3,
        pattern: "orchestrator_subagent",
        payload: {
          role: "assistant",
          messageId: "run-parent-1:ora-sub-1:message-1",
          content: "子代理最终结论。",
          audience: "collaboration",
          visibility: "collaboration",
          surface: "collaboration",
        },
      },
      {
        id: "run-parent-1:evt-3",
        runId: "run-parent-1",
        seq: 3,
        type: "message.delta",
        agentId: "ora",
        nodeId: "ora",
        createdAt: 4,
        pattern: "orchestrator_subagent",
        payload: {
          role: "assistant",
          messageId: "run-parent-1:parent-message-1",
          content: "父 Agent 综合结论",
        },
      },
    ],
    agentMessages: [],
    childSessions: [{
      ...childSession("run-parent-1:ora-sub-1", "running"),
      agentId: "ora-sub-1",
      label: "Research subagent",
      summary: "正在整理调研结论",
      sourceRunId: "run-parent-1",
      replayRef: {
        kind: "event_range",
        runId: "run-parent-1",
        fromSeq: 0,
        toSeq: 2,
      },
    }],
    artifacts: [],
    activeAgents: ["ora", "ora-sub-1"],
    queueSummary: { mode: "dag", pending: 0, inProgress: 1, completed: 0, topics: [] },
    sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
    busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
    pendingClarifications: [],
    pendingApprovals: [],
    output: { text: "父 Agent 综合结论" },
    updatedAt: 4,
  } as any;
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
