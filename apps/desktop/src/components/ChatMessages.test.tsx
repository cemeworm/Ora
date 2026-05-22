import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SINGLE_AGENT_MODE_ID } from "@cemeworm/shared";
import { ChatInput } from "./ChatInput";
import {
  ChatMessages,
  CHAT_MESSAGES_SCROLL_CLASS,
  messageBottomPaddingPx,
} from "./ChatMessages";
import {
  CHAT_SURFACE_FRAME_WIDTH_CLASS,
  CHAT_SURFACE_OVERLAY_SCROLLBAR_PADDING_CLASS,
  CHAT_SURFACE_SCROLLBAR_COMPENSATION_CLASS,
  CHAT_SURFACE_VIEWPORT_GUTTER_CLASS,
} from "./chatSurfaceLayout";
import { adaptRenderableChatMessages } from "../lib/viewModel";
import { getActiveSnapshot, getPendingRunState, initialWorkbenchState, workbenchReducer, type WorkbenchState } from "../lib/state";
import type { OraSessionBranchGroup, OraStateSnapshot } from "../lib/runtimeClient";
import type { DesktopRunInteractionState } from "../lib/runInteractionState";

const BASE_RUN_INTERACTION_STATE: DesktopRunInteractionState = {
  status: "idle",
  isProcessing: false,
  canSubmit: true,
  canStop: false,
  canResume: false,
  canRebuild: false,
  authority: "session_summary",
};

const BASE_MODE = {
  id: "single_agent",
  family: "single_agent" as const,
  label: "单智能体",
  summary: "默认模式",
  recommendedUse: "默认",
  failureMode: "无",
  isPreset: true,
};

function renderChatInputHtml(overrides: Record<string, unknown> = {}) {
  return renderToStaticMarkup(
    <ChatInput
      sessionId="session-1"
      composerPrompt=""
      isLoading={false}
      runInteractionState={BASE_RUN_INTERACTION_STATE}
      activeMode={BASE_MODE}
      modeOptions={[]}
      selectedModeSelection="manual"
      activeProvider={undefined}
      contextState={undefined}
      providerOptions={[]}
      skillOptions={[]}
      selectedSkillIds={[]}
      language="zh"
      contextChips={[]}
      placeholder="Message Ora"
      selectedCustomAgentId={undefined}
      projectFileAttachments={[]}
      localFileAttachments={[]}
      imageAttachments={[]}
      onRemoveImageAttachment={() => {}}
      onAddImageAttachment={() => {}}
      approvalActions={[]}
      approvalDisabled={false}
      onApprove={undefined}
      onCancelApproval={undefined}
      clarificationQuestions={[]}
      onSubmitAllClarifications={undefined}
      onModeChange={() => {}}
      onModeSelectionChange={() => {}}
      onProviderChange={() => {}}
      onPromptChange={() => {}}
      onSelectedSkillIdsChange={() => {}}
      onRemoveProjectFileAttachment={() => {}}
      onRemoveLocalFileAttachment={() => {}}
      onOpenLocalFiles={() => {}}
      onFilesDropped={undefined}
      onClearSelectedCustomAgent={undefined}
      permissionMode="default"
      onPermissionModeChange={() => {}}
      taskIntent="implement"
      onTaskIntentChange={() => {}}
      planDecisionPending={false}
      planSteps={[]}
      onConfirmPlanDecision={undefined}
      onDeclinePlanDecision={undefined}
      onOverlayHeightChange={undefined}
      surfaceFrameWidthClassName={undefined}
      onStartRun={() => {}}
      onStopRun={() => {}}
      {...overrides}
    />,
  );
}

describe("ChatMessages bottom inset", () => {
  it("uses dynamic bottom padding when measured overlay height is larger than fallback", () => {
    expect(messageBottomPaddingPx({ hasTray: true, bottomInsetPx: 360 })).toBe(384);
  });

  it("keeps fallback padding when no measured overlay height is available", () => {
    expect(messageBottomPaddingPx({ hasTray: false })).toBe(176);
    expect(messageBottomPaddingPx({ hasTray: true })).toBe(240);
  });

  it("renders dynamic padding on the conversation content", () => {
    const html = renderToStaticMarkup(
      <ChatMessages
        chatMessages={[]}
        hasClarificationTray
        bottomInsetPx={300}
      />,
    );

    expect(html).toContain("padding-bottom:324px");
  });

  it("keeps the message list as the only scroll container", () => {
    const html = renderToStaticMarkup(<ChatMessages chatMessages={[]} />);

    expect(html).toContain(CHAT_MESSAGES_SCROLL_CLASS);
    expect(html).not.toContain("relative flex flex-1 flex-col overflow-y-auto");
  });

  it("uses a dedicated surface frame width inside the scroll-compensated message coordinate space", () => {
    const html = renderToStaticMarkup(<ChatMessages chatMessages={[]} />);

    expect(html).toContain('data-testid="chat-messages-surface-frame"');
    expect(html).toContain('data-testid="chat-messages-content"');
    expect(html).toContain(CHAT_SURFACE_FRAME_WIDTH_CLASS);
    expect(html).toContain(CHAT_SURFACE_VIEWPORT_GUTTER_CLASS);
    expect(CHAT_MESSAGES_SCROLL_CLASS).toContain(
      CHAT_SURFACE_SCROLLBAR_COMPENSATION_CLASS,
    );
    expect(html).not.toContain("max-w-[88rem]");
  });

  it("keeps messages and composer on compatible compensated surface frame contracts", () => {
    const surfaceFrameWidthClassName = "w-full max-w-[54rem]";

    const messagesHtml = renderToStaticMarkup(
      <ChatMessages
        chatMessages={[]}
        surfaceFrameWidthClassName={surfaceFrameWidthClassName}
      />,
    );
    const inputHtml = renderChatInputHtml({ surfaceFrameWidthClassName });

    expect(messagesHtml).toContain(surfaceFrameWidthClassName);
    expect(inputHtml).toContain(surfaceFrameWidthClassName);
    expect(CHAT_MESSAGES_SCROLL_CLASS).toContain(
      CHAT_SURFACE_SCROLLBAR_COMPENSATION_CLASS,
    );
    expect(inputHtml).toContain(CHAT_SURFACE_OVERLAY_SCROLLBAR_PADDING_CLASS);
    expect(messagesHtml).not.toContain("lg:-mr-4");
    expect(messagesHtml).not.toContain("xl:-mr-6");
    expect(inputHtml).not.toContain("lg:-mr-4");
    expect(inputHtml).not.toContain("xl:-mr-6");
  });

  it("keeps message rail padding symmetric so content stays on the same center line as the composer", () => {
    expect(CHAT_SURFACE_SCROLLBAR_COMPENSATION_CLASS).toContain("lg:px-4");
    expect(CHAT_SURFACE_SCROLLBAR_COMPENSATION_CLASS).toContain("xl:px-6");
    expect(CHAT_SURFACE_SCROLLBAR_COMPENSATION_CLASS).not.toContain("lg:-mr-4");
    expect(CHAT_SURFACE_SCROLLBAR_COMPENSATION_CLASS).not.toContain("xl:-mr-6");
  });

  it("renders user messages without an avatar icon", () => {
    const html = renderToStaticMarkup(
      <ChatMessages
        chatMessages={[{
          id: "user-1",
          role: "user",
          content: "你好",
          timestamp: "18:30",
        }]}
      />,
    );

    expect(html).toContain("你好");
    expect(html).not.toContain("lucide-user");
  });

  it("renders user messages with a compact rounded bubble", () => {
    const html = renderToStaticMarkup(
      <ChatMessages
        chatMessages={[{
          id: "user-1",
          role: "user",
          content: "我叫QC，记住",
          timestamp: "18:30",
        }]}
      />,
    );

    expect(html).toContain("flex items-center rounded-2xl bg-muted px-3.5 py-2.5");
    expect(html).not.toContain("rounded-br-md");
    expect(html).toContain("whitespace-pre-wrap break-words leading-5");
    expect(html).not.toContain("<p class=\"my-2");
    expect(html).toContain("h-6 w-6");
  });

  it("renders replace-latest branch candidates as a side-by-side assistant turn", () => {
    const branchGroup = {
      branchGroupId: "session-1:branch-1",
      sessionId: "session-1",
      target: "replace_latest",
      replaceRunId: "run-base",
      prompt: "Try two answers",
      status: "ready",
      candidates: [
        {
          runId: "run-left",
          status: "succeeded",
          label: "候选 1",
          modelRef: "left-model",
          prompt: "Try two answers",
          updatedAt: 1,
        },
        {
          runId: "run-right",
          status: "succeeded",
          label: "候选 2",
          modelRef: "right-model",
          prompt: "Try two answers",
          updatedAt: 2,
        },
      ],
      candidateRunIds: ["run-left", "run-right"],
      baseTurnIndex: 0,
      createdAt: 1,
      updatedAt: 2,
    } as unknown as OraSessionBranchGroup;
    const snapshots = {
      "run-left": {
        runId: "run-left",
        status: "succeeded",
        output: { text: "左侧回答" },
        config: { metadata: {}, modelRef: "left-model" },
        events: [],
      } as unknown as OraStateSnapshot,
      "run-right": {
        runId: "run-right",
        status: "succeeded",
        output: { text: "右侧回答" },
        config: { metadata: {}, modelRef: "right-model" },
        events: [],
      } as unknown as OraStateSnapshot,
    };

    const html = renderToStaticMarkup(
      <ChatMessages
        chatMessages={[{
          id: "assistant-base",
          role: "assistant",
          content: "原回答不应显示",
          timestamp: "18:31",
          metadata: { runId: "run-base", turnIndex: 1 },
        }]}
        branchGroups={[branchGroup]}
        turnSnapshots={snapshots}
        language="zh"
      />,
    );

    expect(html).toContain("左侧回答");
    expect(html).toContain("右侧回答");
    expect(html).toContain("我更喜欢这个");
    expect(html).not.toContain("原回答不应显示");
  });

  it("renders same-run clarification answers inside the assistant turn without adding a new user bubble", () => {
    const createdAt = 1_714_000_000_000;
    const sessionId = "session-clarification-ui";
    const runId = "run-clarification-ui";
    const snapshot = {
      runId,
      sessionId,
      turnIndex: 1,
      status: "succeeded",
      pattern: "orchestrator_subagent",
      modeId: SINGLE_AGENT_MODE_ID,
      input: { prompt: "Needs a decision", createdAt, context: {} },
      config: {
        modeId: SINGLE_AGENT_MODE_ID,
        pattern: "orchestrator_subagent",
        modeSelection: "manual",
        profileIds: ["solo_agent"],
        providerId: "local-smoke",
        modelRef: "local/smoke-model",
        approvalMode: "high_risk_only",
        patternOptions: {},
        metadata: {},
        deterministicSeed: "chat-messages-clarification-ui",
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
      policyDecisions: [],
      checkpoints: [],
      events: [{
        id: `${runId}:evt-0`,
        runId,
        seq: 0,
        type: "clarification.required",
        createdAt: createdAt + 30,
        pattern: "orchestrator_subagent",
        payload: {
          clarification: {
            id: "clarification:scope",
            nodeId: "solo_agent",
            key: "scope",
            question: "Which scope should I use?",
            requestedAt: createdAt + 30,
          },
          pending: 1,
        },
      }, {
        id: `${runId}:evt-1`,
        runId,
        seq: 1,
        type: "clarification.resolved",
        createdAt: createdAt + 40,
        pattern: "orchestrator_subagent",
        payload: {
          clarificationId: "clarification:scope",
          nodeId: "solo_agent",
          answer: "Use the current session only.",
          mode: "resume",
        },
      }],
      artifacts: [],
      activeAgents: [],
      queueSummary: { mode: "dag", pending: 0, inProgress: 0, completed: 1, topics: [] },
      sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
      busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
      pendingClarifications: [],
      pendingApprovals: [],
      output: { text: "Continued after clarification" },
      updatedAt: createdAt + 50,
    } as unknown as OraStateSnapshot;

    const messages = adaptRenderableChatMessages({
      transcript: [{
        id: `${runId}:user`,
        sessionId,
        runId,
        turnIndex: 1,
        role: "user",
        content: "Needs a decision",
        pattern: "orchestrator_subagent",
        modeId: SINGLE_AGENT_MODE_ID,
        createdAt,
      }, {
        id: `${runId}:assistant`,
        sessionId,
        runId,
        turnIndex: 1,
        role: "assistant",
        content: "Continued after clarification",
        pattern: "orchestrator_subagent",
        modeId: SINGLE_AGENT_MODE_ID,
        createdAt: createdAt + 50,
      }],
      turnSnapshots: { [runId]: snapshot },
      selectedSessionId: sessionId,
    });

    const html = renderToStaticMarkup(
      <ChatMessages chatMessages={messages} />,
    );

    expect(html).toContain("Which scope should I use?");
    expect(html).toContain("Use the current session only.");
    expect(html).toContain("Continued after clarification");
    expect(html.match(/rounded-2xl bg-muted px-3\.5 py-2\.5/g)).toHaveLength(1);
  });

  it("renders an accepted same-run plan decision as a synthetic user turn without replaying the old proposal card", () => {
    const createdAt = 1_714_000_000_000;
    const sessionId = "session-plan-ui";
    const runId = "run-plan-ui";
    const proposedPlan = [
      "<proposed_plan>",
      "## Runtime status plan",
      "1. Add shared attention projection.",
      "2. Persist plan decision gates.",
      "</proposed_plan>",
    ].join("\n");
    const snapshot = {
      runId,
      sessionId,
      turnIndex: 1,
      status: "succeeded",
      pattern: "orchestrator_subagent",
      modeId: SINGLE_AGENT_MODE_ID,
      input: { prompt: "Plan the runtime work", createdAt, context: {} },
      config: {
        modeId: SINGLE_AGENT_MODE_ID,
        pattern: "orchestrator_subagent",
        modeSelection: "manual",
        profileIds: ["solo_agent"],
        providerId: "local-smoke",
        modelRef: "local/smoke-model",
        approvalMode: "high_risk_only",
        patternOptions: {},
        metadata: { taskIntent: "plan" },
        deterministicSeed: "chat-messages-plan-ui",
        skillIds: [],
        toolIds: [],
      },
      topology: { nodes: [], edges: [] },
      profiles: [],
      memory: [],
      plan: [],
      planList: [{
        id: "step-1",
        step: "Add shared attention projection.",
        status: "completed",
      }, {
        id: "step-2",
        step: "Persist plan decision gates.",
        status: "completed",
      }],
      todos: [],
      actions: [],
      toolCalls: [],
      policyDecisions: [],
      checkpoints: [],
      events: [],
      artifacts: [],
      activeAgents: [],
      queueSummary: { mode: "dag", pending: 0, inProgress: 0, completed: 1, topics: [] },
      sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
      busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
      pendingClarifications: [],
      pendingApprovals: [],
      planDecisions: [{
        id: `${runId}:plan-decision`,
        runId,
        sessionId,
        status: "pending",
        planContent: "## Runtime status plan\n1. Add shared attention projection.\n2. Persist plan decision gates.",
        createdAt: createdAt + 10,
      }],
      attention: {
        kind: "needs_plan_decision",
        blocking: true,
        sourceRunId: runId,
        reason: "plan_decision_required",
        planDecisionId: `${runId}:plan-decision`,
        pendingActionIds: [],
        pendingToolCallIds: [],
        pendingClarificationIds: [],
      },
      output: { text: proposedPlan },
      updatedAt: createdAt + 20,
    } as unknown as OraStateSnapshot;

    const state: WorkbenchState = {
      ...initialWorkbenchState,
      selectedSessionId: sessionId,
      runLifecycle: {
        stage: "settled",
        runId,
        sessionId,
        prompt: "Plan the runtime work",
        createdAt,
        snapshot,
      },
    };
    const accepted = workbenchReducer(state, {
      type: "BEGIN_PLAN_DECISION_RESOLUTION",
      sessionId,
      decisionId: `${runId}:plan-decision`,
      status: "accepted",
      createdAt: createdAt + 25,
    });
    const resumed = workbenchReducer(accepted, {
      type: "BEGIN_RUN_RESUME",
      runId,
      approvedActionIds: [],
      resolvedClarificationIds: [],
      planDecisionId: `${runId}:plan-decision`,
      planDecisionStatus: "accepted",
      updatedAt: createdAt + 30,
    });
    const resumedSnapshot = getActiveSnapshot(resumed.runLifecycle)!;

    const messages = adaptRenderableChatMessages({
      transcript: [{
        id: `${runId}:user`,
        sessionId,
        runId,
        turnIndex: 1,
        role: "user",
        content: "Plan the runtime work",
        pattern: "orchestrator_subagent",
        modeId: SINGLE_AGENT_MODE_ID,
        createdAt,
      }, {
        id: `${runId}:assistant`,
        sessionId,
        runId,
        turnIndex: 1,
        role: "assistant",
        content: proposedPlan,
        pattern: "orchestrator_subagent",
        modeId: SINGLE_AGENT_MODE_ID,
        createdAt: createdAt + 20,
      }],
      turnSnapshots: { [runId]: resumedSnapshot },
      pendingRun: getPendingRunState(resumed.runLifecycle),
      acceptedPlanDecisionTurns: Object.values(resumed.acceptedPlanDecisionTurnProjections),
      selectedSessionId: sessionId,
    });

    const html = renderToStaticMarkup(
      <ChatMessages chatMessages={messages} />,
    );

    expect(html).toContain("请按照上述计划开始执行");
    expect(html).not.toContain("任务计划");
    expect(html).not.toContain("Runtime status plan");
    expect(html.match(/rounded-2xl bg-muted px-3\.5 py-2\.5/g)).toHaveLength(2);
  });

  it("renders user images as separate bubbles before the text bubble", () => {
    const html = renderToStaticMarkup(
      <ChatMessages
        chatMessages={[{
          id: "msg-1",
          role: "user",
          content: "看看这张图",
          timestamp: "12:00",
          images: [{
            dataUrl: "data:image/png;base64,iVBORw0KGgo=",
            mimeType: "image/png",
            name: "screenshot.png",
            sizeBytes: 12345,
          }],
        }]}
      />,
    );

    expect(html).toContain('<img');
    expect(html).toContain('data:image/png;base64,iVBORw0KGgo=');
    expect(html).toContain('screenshot.png');
    expect(html).toContain('看看这张图');
  });

  it("renders user message without images normally", () => {
    const html = renderToStaticMarkup(
      <ChatMessages
        chatMessages={[{
          id: "msg-2",
          role: "user",
          content: "Hello",
          timestamp: "12:01",
        }]}
      />,
    );

    expect(html).not.toContain('<img');
    expect(html).toContain('Hello');
  });
});
