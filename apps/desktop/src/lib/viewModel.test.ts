import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { CODE_DEVELOPMENT_MODE_ID, DEBATE_MODE_ID, MVP_MODES, MVP_PATTERNS, ORA_ROOT_AGENT_ID, ORA_ROOT_AGENT_LABEL, SINGLE_AGENT_MODE_ID, projectForkSettledSnapshot, projectForkVisibleAssistantText } from "@cemeworm/shared";
import { mergeStateSnapshot } from "./state";
import { adaptChatMessages, adaptPendingRunMessages, adaptRenderableChatMessages, buildWorkbenchViewModel, derivePresentedAssistantTurnFromSnapshot, isSessionProcessing } from "./viewModel";
import type { OraSessionDetail, OraSessionSummary, OraStateSnapshot } from "./runtimeClient";

const DEERFLOW_HARNESS_MODE_ID = "deerflow_harness";

describe("desktop session view model", () => {
  it("freezes runtime timeline facts in shared projection and desktop timeline item formatting locally", () => {
    const viewModelSource = fs.readFileSync(new URL("./viewModel.ts", import.meta.url), "utf8");
    const sharedTimelineSource = fs.readFileSync(
      new URL("../../../../packages/shared/src/runtime-timeline.ts", import.meta.url),
      "utf8",
    );

    expect(viewModelSource).toContain("deriveRuntimeTimelineProjection(snapshot)");
    expect(viewModelSource).toContain("function deriveTimelineItems(");
    expect(viewModelSource).toContain("const projection = timelineProjection ?? deriveRuntimeTimelineProjection(snapshot)");
    expect(viewModelSource).toContain("for (const event of projection.events)");
    expect(viewModelSource).toContain("function processStepLabel(");
    expect(viewModelSource).toContain("function processStepDetail(");
    expect(sharedTimelineSource).toContain(".filter((event) => event.runId === snapshot.runId)");
    expect(sharedTimelineSource).toContain(".sort((left, right) => left.createdAt - right.createdAt || left.seq - right.seq)");
    expect(sharedTimelineSource).toContain("agentLabels");
    expect(sharedTimelineSource).not.toContain("assistant_text");
    expect(sharedTimelineSource).not.toContain("status_group");
    expect(sharedTimelineSource).not.toContain("plan_update");
    expect(sharedTimelineSource).not.toContain("final_text");
  });

  it("uses an empty assistant placeholder for newly pending runs", () => {
    const messages = adaptPendingRunMessages({
      sessionId: "session-pending",
      prompt: "开始一个新任务",
      createdAt: 1_714_000_000_000,
    });

    expect(messages[1]).toMatchObject({
      role: "assistant",
      content: "",
      isPlaceholder: true,
    });
    expect(messages[1]?.content).not.toContain("正在准备");
  });

  it("keeps selected skills on the same pending user message", () => {
    const messages = adaptPendingRunMessages({
      sessionId: "session-pending-skill",
      prompt: "请评估方案",
      createdAt: 1_714_000_000_000,
      skills: [
        { id: "think", name: "think" },
        { id: "check", name: "check" },
      ],
    });

    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({
      id: "session-pending-skill:pending:user",
      role: "user",
      content: "请评估方案",
      skills: [
        { id: "think", name: "think" },
        { id: "check", name: "check" },
      ],
    });
    expect(messages[1]).toMatchObject({
      id: "session-pending-skill:pending:assistant",
      role: "assistant",
      isPlaceholder: true,
    });
  });

  it("keeps a new pending user message visible when an old running turn has the same prompt", () => {
    const createdAt = 1_714_000_000_000;
    const sessionId = "session-second-turn-pending";
    const prompt = "继续";
    const oldRunId = "run-old-same-prompt";
    const messages = adaptRenderableChatMessages({
      transcript: [{
        id: `${oldRunId}:user`,
        sessionId,
        runId: oldRunId,
        turnIndex: 1,
        role: "user",
        content: prompt,
        pattern: "orchestrator_subagent",
        modeId: SINGLE_AGENT_MODE_ID,
        createdAt,
      }],
      turnSnapshots: {
        [oldRunId]: {
          runId: oldRunId,
          sessionId,
          turnIndex: 1,
          status: "running",
          pattern: "orchestrator_subagent",
          modeId: SINGLE_AGENT_MODE_ID,
          input: { prompt, createdAt, context: {} },
          config: {
            modeId: SINGLE_AGENT_MODE_ID,
            pattern: "orchestrator_subagent",
            modeSelection: "manual",
            profileIds: ["solo_agent"],
            providerId: "deepseek",
            modelRef: "deepseek-chat",
            approvalMode: "high_risk_only",
            patternOptions: {},
            metadata: {},
            deterministicSeed: "view-model-pending-same-prompt-test",
            skillIds: [],
            toolIds: [],
          },
          topology: { nodes: [], edges: [] },
          profiles: [],
          memory: [],
          plan: [],
          todos: [],
          actions: [],
          toolCalls: [],
          policyDecisions: [],
          checkpoints: [],
          events: [],
          artifacts: [],
          activeAgents: [],
          queueSummary: { mode: "dag", pending: 0, inProgress: 1, completed: 0, topics: [] },
          sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
          busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
          pendingClarifications: [],
          pendingApprovals: [],
          updatedAt: createdAt,
        } as unknown as OraStateSnapshot,
      },
      pendingRun: {
        sessionId,
        prompt,
        createdAt: createdAt + 1_000,
      },
      selectedSessionId: sessionId,
    });

    expect(messages.map((message) => message.id)).toContain(`${sessionId}:pending:user`);
    expect(messages.at(-2)).toMatchObject({
      id: `${sessionId}:pending:user`,
      role: "user",
      content: prompt,
    });
  });

  it("does not append a pending placeholder after the run snapshot has settled", () => {
    const createdAt = 1_714_000_000_000;
    const sessionId = "session-settled-pending";
    const runId = "run-settled-pending";
    const prompt = "介绍 Ora";
    const messages = adaptRenderableChatMessages({
      transcript: [{
        id: `${runId}:user`,
        sessionId,
        runId,
        turnIndex: 1,
        role: "user",
        content: prompt,
        pattern: "orchestrator_subagent",
        modeId: SINGLE_AGENT_MODE_ID,
        createdAt,
      }],
      turnSnapshots: {
        [runId]: {
          runId,
          sessionId,
          turnIndex: 1,
          status: "succeeded",
          pattern: "orchestrator_subagent",
          modeId: SINGLE_AGENT_MODE_ID,
          input: { prompt, createdAt, context: {} },
          config: {
            modeId: SINGLE_AGENT_MODE_ID,
            pattern: "orchestrator_subagent",
            modeSelection: "manual",
            profileIds: ["solo_agent"],
            providerId: "deepseek",
            modelRef: "deepseek-chat",
            approvalMode: "high_risk_only",
            patternOptions: {},
            metadata: {},
            deterministicSeed: "view-model-settled-pending-test",
            skillIds: [],
            toolIds: [],
          },
          topology: { nodes: [], edges: [] },
          profiles: [],
          memory: [],
          plan: [],
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
          output: { text: "Ora 是一个本地 AI 工作台。" },
          updatedAt: createdAt + 1_000,
        } as unknown as OraStateSnapshot,
      },
      pendingRun: {
        sessionId,
        runId,
        prompt,
        createdAt,
        progressText: "Ora 是一个本地 AI 工作台。",
      },
      selectedSessionId: sessionId,
    });

    expect(messages.map((message) => message.id)).not.toContain(`${sessionId}:pending:assistant`);
    expect(messages.filter((message) => message.role === "assistant")).toHaveLength(1);
    expect(messages.find((message) => message.role === "assistant")?.content).toBe("Ora 是一个本地 AI 工作台。");
  });

  it("does not append an unresolved pending placeholder once a matching transcript turn exists", () => {
    const createdAt = 1_714_000_000_000;
    const sessionId = "session-pending-without-run-id";
    const runId = "run-materialized-before-handle";
    const prompt = "介绍 Ora";
    const messages = adaptRenderableChatMessages({
      transcript: [
        {
          id: `${runId}:user`,
          sessionId,
          runId,
          turnIndex: 1,
          role: "user",
          content: prompt,
          pattern: "orchestrator_subagent",
          modeId: SINGLE_AGENT_MODE_ID,
          createdAt,
        },
        {
          id: `${runId}:assistant`,
          sessionId,
          runId,
          turnIndex: 1,
          role: "assistant",
          content: "Ora 是一个本地 AI 工作台。",
          pattern: "orchestrator_subagent",
          modeId: SINGLE_AGENT_MODE_ID,
          createdAt: createdAt + 1_000,
        },
      ],
      pendingRun: {
        sessionId,
        prompt,
        createdAt,
        progressText: "Ora 是一个本地 AI 工作台。",
      },
      selectedSessionId: sessionId,
    });

    expect(messages.map((message) => message.id)).not.toContain(`${sessionId}:pending:assistant`);
    expect(messages.filter((message) => message.role === "assistant")).toHaveLength(1);
    expect(messages.find((message) => message.role === "assistant")?.content).toBe("Ora 是一个本地 AI 工作台。");
  });

  it("drops only the pending user placeholder once the user turn is materialized but assistant output is still pending", () => {
    const createdAt = 1_714_000_000_000;
    const sessionId = "session-user-materialized-assistant-pending";
    const runId = "run-user-materialized-assistant-pending";
    const prompt = "可以，开始 Phase 0。我需要精确定位所有涉及代码的当前行号和调用链。";
    const messages = adaptRenderableChatMessages({
      transcript: [{
        id: `${runId}:user`,
        sessionId,
        runId,
        turnIndex: 1,
        role: "user",
        content: prompt,
        pattern: "orchestrator_subagent",
        modeId: SINGLE_AGENT_MODE_ID,
        createdAt,
      }],
      turnSnapshots: {
        [runId]: {
          runId,
          sessionId,
          turnIndex: 1,
          status: "running",
          pattern: "orchestrator_subagent",
          modeId: SINGLE_AGENT_MODE_ID,
          input: { prompt, createdAt, context: {} },
          config: {
            modeId: SINGLE_AGENT_MODE_ID,
            pattern: "orchestrator_subagent",
            modeSelection: "manual",
            profileIds: ["solo_agent"],
            providerId: "deepseek",
            modelRef: "deepseek-chat",
            approvalMode: "high_risk_only",
            patternOptions: {},
            metadata: {},
            deterministicSeed: "view-model-user-materialized-assistant-pending-test",
            skillIds: [],
            toolIds: [],
          },
          topology: { nodes: [], edges: [] },
          profiles: [],
          memory: [],
          plan: [],
          todos: [],
          actions: [],
          toolCalls: [],
          policyDecisions: [],
          checkpoints: [],
          events: [],
          artifacts: [],
          activeAgents: [],
          queueSummary: { mode: "dag", pending: 0, inProgress: 1, completed: 0, topics: [] },
          sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
          busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
          pendingClarifications: [],
          pendingApprovals: [],
          updatedAt: createdAt + 1_000,
        } as unknown as OraStateSnapshot,
      },
      pendingRun: {
        sessionId,
        prompt,
        createdAt,
        progressText: "",
      },
      selectedSessionId: sessionId,
    });

    expect(messages.filter((message) => message.role === "user" && message.content === prompt)).toHaveLength(1);
    expect(messages.map((message) => message.id)).not.toContain(`${sessionId}:pending:user`);
    expect(messages.map((message) => message.id)).toContain(`${sessionId}:pending:assistant`);
  });

  it("keeps child collaboration deltas out of assistant chat messages", () => {
    const createdAt = 1_714_000_000_000;
    const runId = "run-collaboration-filter";
    const sessionId = "session-collaboration-filter";
    const messages = adaptChatMessages(
      [{
        id: `${runId}:user`,
        sessionId,
        runId,
        turnIndex: 1,
        role: "user",
        content: "总结子任务结果",
        pattern: "orchestrator_subagent",
        modeId: SINGLE_AGENT_MODE_ID,
        createdAt,
      }],
      {
        [runId]: {
          runId,
          sessionId,
          turnIndex: 1,
          status: "succeeded",
          pattern: "orchestrator_subagent",
          modeId: SINGLE_AGENT_MODE_ID,
          input: { prompt: "总结子任务结果", createdAt, context: {} },
          config: {
            modeId: SINGLE_AGENT_MODE_ID,
            pattern: "orchestrator_subagent",
            modeSelection: "manual",
            profileIds: ["ora", "researcher"],
            providerId: "deepseek",
            modelRef: "deepseek-chat",
            approvalMode: "high_risk_only",
            patternOptions: {},
            metadata: {},
            deterministicSeed: "view-model-collaboration-filter-test",
            skillIds: [],
            toolIds: [],
          },
          topology: { nodes: [], edges: [] },
          profiles: [],
          memory: [],
          plan: [],
          todos: [],
          actions: [],
          toolCalls: [],
          policyDecisions: [],
          checkpoints: [],
          events: [
            {
              id: `${runId}:evt-0`,
              runId,
              seq: 0,
              type: "message.delta",
              createdAt: createdAt + 1,
              pattern: "orchestrator_subagent",
              agentId: "ora-sub-1",
              payload: {
                role: "assistant",
                messageId: `${runId}:child`,
                content: "子 Agent 直接输出",
                audience: "collaboration",
              },
            },
            {
              id: `${runId}:evt-1`,
              runId,
              seq: 1,
              type: "message.delta",
              createdAt: createdAt + 2,
              pattern: "orchestrator_subagent",
              agentId: ORA_ROOT_AGENT_ID,
              payload: {
                role: "assistant",
                messageId: `${runId}:parent`,
                content: "父 Agent 综合结论",
              },
            },
          ],
          childSessions: [{
            id: `${runId}:ora-sub-1`,
            agentId: "ora-sub-1",
            label: "Researcher",
            sessionClass: "temporary_spawn",
            status: "succeeded",
            summary: "完成资料搜集",
            startedAt: createdAt + 1,
            updatedAt: createdAt + 2,
          }],
          artifacts: [],
          activeAgents: [],
          queueSummary: { mode: "dag", pending: 0, inProgress: 0, completed: 1, topics: [] },
          sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
          busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
          pendingClarifications: [],
          pendingApprovals: [],
          updatedAt: createdAt + 2,
        } as unknown as OraStateSnapshot,
      },
    );

    expect(messages.find((message) => message.role === "assistant")?.content).toBe("父 Agent 综合结论");
  });

  it("uses summary interaction gate for summary-only sessions", () => {
    const createdAt = 1_714_000_000_000;
    const session: OraSessionSummary = {
      sessionId: "session-summary-gate",
      title: "Needs decision",
      status: "failed",
      attention: {
        kind: "idle",
        blocking: false,
        sourceRunId: "run-summary-gate",
        pendingActionIds: [],
        pendingToolCallIds: [],
        pendingClarificationIds: [],
      },
      interactionGate: {
        kind: "plan_decision",
        source: "plan_decisions",
        durable: true,
        staleRisk: false,
        gateIds: ["run-summary-gate:plan-decision"],
        pendingActionIds: [],
        pendingToolCallIds: [],
        pendingClarificationIds: [],
        planDecisionId: "run-summary-gate:plan-decision",
      },
      turnCount: 1,
      createdAt,
      updatedAt: createdAt,
    };
    const activeSession: OraSessionSummary = {
      sessionId: "session-active",
      title: "Active Session",
      turnCount: 0,
      createdAt,
      updatedAt: createdAt,
    };
    const detail: OraSessionDetail = {
      session: activeSession,
      turns: [],
      transcript: [],
    };

    const viewModel = buildWorkbenchViewModel(
      MVP_PATTERNS,
      MVP_MODES,
      [session, activeSession],
      detail,
      undefined,
      "generator_verifier",
      SINGLE_AGENT_MODE_ID,
    );

    expect(viewModel.sessions.find((item) => item.id === session.sessionId)?.status).toBe("decision_needed");
  });

  it("suppresses resolved plan decision gates in summary-only sessions", () => {
    const createdAt = 1_714_000_000_000;
    const session: OraSessionSummary = {
      sessionId: "session-summary-gate-suppressed",
      title: "Resolved decision",
      status: "failed",
      attention: {
        kind: "idle",
        blocking: false,
        sourceRunId: "run-summary-gate",
        pendingActionIds: [],
        pendingToolCallIds: [],
        pendingClarificationIds: [],
      },
      interactionGate: {
        kind: "plan_decision",
        source: "plan_decisions",
        durable: true,
        staleRisk: false,
        gateIds: ["run-summary-gate:plan-decision"],
        pendingActionIds: [],
        pendingToolCallIds: [],
        pendingClarificationIds: [],
        planDecisionId: "run-summary-gate:plan-decision",
      },
      turnCount: 1,
      createdAt,
      updatedAt: createdAt,
    };
    const activeSession: OraSessionSummary = {
      sessionId: "session-active",
      title: "Active Session",
      turnCount: 0,
      createdAt,
      updatedAt: createdAt,
    };
    const detail: OraSessionDetail = {
      session: activeSession,
      turns: [],
      transcript: [],
    };

    const viewModel = buildWorkbenchViewModel(
      MVP_PATTERNS,
      MVP_MODES,
      [session, activeSession],
      detail,
      undefined,
      "generator_verifier",
      SINGLE_AGENT_MODE_ID,
      {
        [`${session.sessionId}:run-summary-gate:plan-decision`]: {
          sessionId: session.sessionId,
          decisionId: "run-summary-gate:plan-decision",
          status: "accepted",
          resolvedAt: createdAt,
        },
      },
    );

    expect(viewModel.sessions.find((item) => item.id === session.sessionId)?.status).toBe("failed");
  });

  it("does not treat a newly-created empty session preview as running", () => {
    const createdAt = 1_714_000_000_000;
    const session: OraSessionSummary = {
      sessionId: "session-empty",
      title: "New Chat",
      turnCount: 0,
      createdAt,
      updatedAt: createdAt,
    };
    const detail: OraSessionDetail = {
      session,
      turns: [],
      transcript: [],
    };

    const viewModel = buildWorkbenchViewModel(
      MVP_PATTERNS,
      MVP_MODES,
      [session],
      detail,
      undefined,
      "generator_verifier",
      SINGLE_AGENT_MODE_ID,
    );
    const selectedSession = viewModel.sessions[0];

    expect(selectedSession?.status).toBe("done");
    expect(isSessionProcessing(selectedSession, undefined)).toBe(false);
  });

  it("shows approval required for a running snapshot with projection-backed approval attention", () => {
    const createdAt = 1_714_000_000_000;
    const session: OraSessionSummary = {
      sessionId: "session-approval-running",
      title: "Needs approval",
      status: "running",
      latestRunId: "run-approval-running",
      latestPattern: "orchestrator_subagent",
      latestModeId: SINGLE_AGENT_MODE_ID,
      turnCount: 1,
      createdAt,
      updatedAt: createdAt,
    };
    const snapshot = {
      runId: "run-approval-running",
      sessionId: "session-approval-running",
      turnIndex: 1,
      status: "running",
      pattern: "orchestrator_subagent",
      modeId: SINGLE_AGENT_MODE_ID,
      input: { prompt: "Apply a patch.", createdAt, context: {} },
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
        deterministicSeed: "view-model-running-approval-test",
        skillIds: [],
        toolIds: [],
      },
      topology: { nodes: [], edges: [] },
      profiles: [],
      memory: [],
      plan: [],
      todos: [],
      actions: [{
        id: "run-approval-running:action:tool-1",
        runId: "run-approval-running",
        type: "file.write",
        riskLevel: "high",
        status: "approval_required",
        input: {},
        artifactIds: [],
      }],
      toolCalls: [],
      policyDecisions: [],
      checkpoints: [],
      events: [],
      artifacts: [],
      activeAgents: [],
      queueSummary: { mode: "dag", pending: 0, inProgress: 1, completed: 0, topics: [] },
      sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
      busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
      pendingClarifications: [],
      pendingApprovals: ["run-approval-running:action:tool-1"],
      attention: {
        kind: "needs_approval",
        blocking: true,
        sourceRunId: "run-approval-running",
        reason: "approval_required",
        pendingActionIds: ["run-approval-running:action:tool-1"],
        pendingToolCallIds: [],
      },
      updatedAt: createdAt,
    } as unknown as OraStateSnapshot;
    const detail: OraSessionDetail = {
      session,
      turns: [],
      transcript: [],
      latestSnapshot: snapshot,
    };

    const viewModel = buildWorkbenchViewModel(
      MVP_PATTERNS,
      MVP_MODES,
      [session],
      detail,
      snapshot,
      "orchestrator_subagent",
      SINGLE_AGENT_MODE_ID,
    );

    expect(viewModel.sessions[0]?.status).toBe("approval_required");
  });

  it("shows decision needed for a succeeded snapshot with a pending plan decision", () => {
    const createdAt = 1_714_000_000_000;
    const session: OraSessionSummary = {
      sessionId: "session-plan-decision",
      title: "Needs decision",
      status: "failed",
      latestRunId: "run-plan-decision",
      latestPattern: "orchestrator_subagent",
      latestModeId: SINGLE_AGENT_MODE_ID,
      turnCount: 1,
      createdAt,
      updatedAt: createdAt,
    };
    const snapshot = {
      runId: "run-plan-decision",
      sessionId: "session-plan-decision",
      turnIndex: 1,
      status: "succeeded",
      pattern: "orchestrator_subagent",
      modeId: SINGLE_AGENT_MODE_ID,
      input: { prompt: "Draft a plan.", createdAt, context: {} },
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
        deterministicSeed: "view-model-plan-decision-test",
        skillIds: [],
        toolIds: [],
      },
      topology: { nodes: [], edges: [] },
      profiles: [],
      memory: [],
      plan: [],
      todos: [],
      planDecisions: [{
        id: "run-plan-decision:plan-decision",
        runId: "run-plan-decision",
        sessionId: "session-plan-decision",
        status: "pending",
        createdAt,
      }],
      actions: [],
      toolCalls: [],
      policyDecisions: [],
      checkpoints: [],
      continuation: { frames: [] },
      conversation: [],
      toolResults: [],
      events: [],
      artifacts: [],
      activeAgents: [],
      queueSummary: { mode: "dag", pending: 0, inProgress: 0, completed: 0, topics: [] },
      sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
      busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
      pendingClarifications: [],
      pendingApprovals: [],
      attention: {
        kind: "idle",
        blocking: false,
        sourceRunId: "run-plan-decision",
        pendingActionIds: [],
        pendingToolCallIds: [],
        pendingClarificationIds: [],
      },
      updatedAt: createdAt,
    } as unknown as OraStateSnapshot;
    const detail: OraSessionDetail = {
      session,
      turns: [],
      transcript: [],
      latestSnapshot: snapshot,
    };

    const viewModel = buildWorkbenchViewModel(
      MVP_PATTERNS,
      MVP_MODES,
      [session],
      detail,
      snapshot,
      "orchestrator_subagent",
      SINGLE_AGENT_MODE_ID,
    );

    expect(viewModel.sessions[0]?.status).toBe("decision_needed");
  });

  it("does not show approval required from raw action state without projection attention", () => {
    const createdAt = 1_714_000_000_000;
    const session: OraSessionSummary = {
      sessionId: "session-raw-approval-running",
      title: "Raw approval",
      status: "running",
      latestRunId: "run-raw-approval-running",
      latestPattern: "orchestrator_subagent",
      latestModeId: SINGLE_AGENT_MODE_ID,
      turnCount: 1,
      createdAt,
      updatedAt: createdAt,
    };
    const snapshot = {
      runId: "run-raw-approval-running",
      sessionId: "session-raw-approval-running",
      turnIndex: 1,
      status: "running",
      pattern: "orchestrator_subagent",
      modeId: SINGLE_AGENT_MODE_ID,
      input: { prompt: "Apply a patch.", createdAt, context: {} },
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
        deterministicSeed: "view-model-raw-approval-test",
        skillIds: [],
        toolIds: [],
      },
      topology: { nodes: [], edges: [] },
      profiles: [],
      memory: [],
      plan: [],
      todos: [],
      actions: [{
        id: "run-raw-approval-running:action:tool-1",
        runId: "run-raw-approval-running",
        type: "file.write",
        riskLevel: "high",
        status: "approval_required",
        input: {},
        artifactIds: [],
      }],
      toolCalls: [],
      policyDecisions: [],
      checkpoints: [],
      events: [],
      artifacts: [],
      activeAgents: [],
      queueSummary: { mode: "dag", pending: 0, inProgress: 1, completed: 0, topics: [] },
      sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
      busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
      pendingClarifications: [],
      pendingApprovals: ["run-raw-approval-running:action:tool-1"],
      updatedAt: createdAt,
    } as unknown as OraStateSnapshot;
    const detail: OraSessionDetail = {
      session,
      turns: [],
      transcript: [],
      latestSnapshot: snapshot,
    };

    const viewModel = buildWorkbenchViewModel(
      MVP_PATTERNS,
      MVP_MODES,
      [session],
      detail,
      snapshot,
      "orchestrator_subagent",
      SINGLE_AGENT_MODE_ID,
    );

    expect(viewModel.sessions[0]?.status).toBe("running");
  });

  it("renders cancelled assistant turns with user-facing copy", () => {
    const createdAt = 1_714_000_000_000;
    const snapshot = {
      runId: "run-cancelled",
      sessionId: "session-cancelled",
      turnIndex: 1,
      status: "cancelled",
      pattern: "orchestrator_subagent",
      modeId: SINGLE_AGENT_MODE_ID,
      input: { prompt: "stop this", createdAt, context: {} },
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
        deterministicSeed: "view-model-cancel-test",
        skillIds: [],
        toolIds: [],
      },
      topology: { nodes: [], edges: [] },
      profiles: [],
      memory: [],
      plan: [],
      todos: [],
      actions: [],
      toolCalls: [],
      policyDecisions: [],
      checkpoints: [],
      events: [],
      artifacts: [],
      activeAgents: [],
      queueSummary: { mode: "dag", pending: 0, inProgress: 0, completed: 0, topics: [] },
      sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
      busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
      pendingClarifications: [],
      pendingApprovals: [],
      error: "Cancelled by caller.",
      updatedAt: createdAt,
    } as unknown as OraStateSnapshot;

    const messages = adaptChatMessages(
      [{
        id: "run-cancelled:user",
        sessionId: "session-cancelled",
        runId: "run-cancelled",
        turnIndex: 1,
        role: "user",
        content: "stop this",
        pattern: "orchestrator_subagent",
        modeId: SINGLE_AGENT_MODE_ID,
        createdAt,
      }],
      { "run-cancelled": snapshot },
    );
    const assistant = messages.find((message) => message.role === "assistant");

    expect(assistant?.content).toBe("Stopped processing as instructed.");
    expect(assistant?.content).not.toContain("Cancelled by caller.");
  });

  it("renders pending clarification entities even when the event log has not caught up", () => {
    const createdAt = 1_714_000_000_000;
    const snapshot = {
      runId: "run-pending-clarification-entity",
      sessionId: "session-pending-clarification-entity",
      turnIndex: 1,
      status: "interrupted",
      pattern: "orchestrator_subagent",
      modeId: SINGLE_AGENT_MODE_ID,
      input: { prompt: "Need a decision.", createdAt, context: {} },
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
        deterministicSeed: "view-model-pending-clarification-entity",
        skillIds: [],
        toolIds: [],
      },
      topology: { nodes: [], edges: [] },
      profiles: [],
      memory: [],
      plan: [],
      todos: [],
      actions: [],
      toolCalls: [],
      policyDecisions: [],
      checkpoints: [],
      events: [],
      artifacts: [],
      activeAgents: [],
      queueSummary: { mode: "dag", pending: 0, inProgress: 0, completed: 0, topics: [] },
      sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
      busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
      pendingClarifications: [{
        id: "clarification:scope",
        nodeId: "solo_agent",
        nodeLabel: "Solo Agent",
        key: "scope",
        question: "Which scope should I use?",
        requestedAt: createdAt + 1,
      }],
      pendingApprovals: [],
      updatedAt: createdAt + 1,
    } as unknown as OraStateSnapshot;

    const messages = adaptChatMessages([], { [snapshot.runId]: snapshot });

    expect(messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(messages.some((message) => message.id.startsWith("clarification-question:"))).toBe(false);
    expect(messages[1]?.turn?.clarificationExchanges).toEqual([
      expect.objectContaining({
        id: "clarification:scope",
        question: "Which scope should I use?",
        status: "pending",
      }),
    ]);
  });

  it("nests resolved clarification exchanges inside the interrupted assistant turn without changing top-level timeline order", () => {
    const createdAt = 1_714_000_000_000;
    const firstSnapshot = {
      runId: "run-history",
      sessionId: "session-clarification-order",
      turnIndex: 1,
      status: "succeeded",
      pattern: "orchestrator_subagent",
      modeId: SINGLE_AGENT_MODE_ID,
      input: { prompt: "Earlier request", createdAt, context: {} },
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
        deterministicSeed: "view-model-clarification-order-history",
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
      events: [],
      artifacts: [],
      activeAgents: [],
      queueSummary: { mode: "dag", pending: 0, inProgress: 0, completed: 1, topics: [] },
      sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
      busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
      pendingClarifications: [],
      pendingApprovals: [],
      output: { text: "Earlier answer" },
      updatedAt: createdAt + 10,
    } as unknown as OraStateSnapshot;
    const clarificationSnapshot = {
      ...firstSnapshot,
      runId: "run-clarification",
      turnIndex: 2,
      input: { prompt: "Needs a decision", createdAt: createdAt + 20, context: {} },
      output: { text: "Continued after clarification" },
      events: [{
        id: "run-clarification:evt-0",
        runId: "run-clarification",
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
        id: "run-clarification:evt-1",
        runId: "run-clarification",
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
      pendingClarifications: [],
      updatedAt: createdAt + 50,
    } as unknown as OraStateSnapshot;

    const messages = adaptChatMessages(
      [{
        id: "run-history:user",
        sessionId: "session-clarification-order",
        runId: "run-history",
        turnIndex: 1,
        role: "user",
        content: "Earlier request",
        pattern: "orchestrator_subagent",
        modeId: SINGLE_AGENT_MODE_ID,
        createdAt,
      }, {
        id: "run-history:assistant",
        sessionId: "session-clarification-order",
        runId: "run-history",
        turnIndex: 1,
        role: "assistant",
        content: "Earlier answer",
        pattern: "orchestrator_subagent",
        modeId: SINGLE_AGENT_MODE_ID,
        createdAt: createdAt + 10,
      }, {
        id: "run-clarification:user",
        sessionId: "session-clarification-order",
        runId: "run-clarification",
        turnIndex: 2,
        role: "user",
        content: "Needs a decision",
        pattern: "orchestrator_subagent",
        modeId: SINGLE_AGENT_MODE_ID,
        createdAt: createdAt + 20,
      }, {
        id: "run-clarification:assistant",
        sessionId: "session-clarification-order",
        runId: "run-clarification",
        turnIndex: 2,
        role: "assistant",
        content: "Continued after clarification",
        pattern: "orchestrator_subagent",
        modeId: SINGLE_AGENT_MODE_ID,
        createdAt: createdAt + 50,
      }],
      {
        "run-history": firstSnapshot,
        "run-clarification": clarificationSnapshot,
      },
    );

    expect(messages.map((message) => `${message.role}:${message.content}`)).toEqual([
      "user:Earlier request",
      "assistant:Earlier answer",
      "user:Needs a decision",
      "assistant:Continued after clarification",
    ]);
    const clarificationAssistant = messages.find((message) => message.metadata?.runId === "run-clarification" && message.role === "assistant");
    expect(clarificationAssistant?.turn?.clarificationExchanges).toEqual([expect.objectContaining({
      id: "clarification:scope",
      question: "Which scope should I use?",
      answer: "Use the current session only.",
      status: "resolved",
    })]);
  });

  it("uses proposed plan content instead of the preamble for decision plan cards", () => {
    const createdAt = 1_714_000_000_000;
    const planOutput = [
      "现在我已经充分了解了代码结构。以下是决策完备的实施计划：",
      "",
      "<proposed_plan>",
      "## PlanDecisionPanel 决策状态 UI 调整",
      "",
      "## 背景",
      "当前组件需要调整决策状态交互。",
      "",
      "## 实施步骤",
      "1. 提示文字左对齐",
      "2. 统一按钮颜色",
      "3. 增加键盘导航与激活态",
      "",
      "## 验证方式",
      "- 运行组件测试",
      "</proposed_plan>",
    ].join("\n");
    const snapshot = {
      runId: "run-plan",
      sessionId: "session-plan",
      turnIndex: 1,
      status: "succeeded",
      pattern: "orchestrator_subagent",
      modeId: SINGLE_AGENT_MODE_ID,
      input: { prompt: "调整决策状态 UI", createdAt, context: {} },
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
        deterministicSeed: "view-model-proposed-plan-test",
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
        id: "run-plan:evt-0",
        runId: "run-plan",
        seq: 0,
        type: "message.delta",
        createdAt,
        pattern: "orchestrator_subagent",
        payload: { role: "assistant", content: planOutput },
      }],
      agentMessages: [],
      artifacts: [],
      activeAgents: [],
      queueSummary: { mode: "dag", pending: 0, inProgress: 0, completed: 1, topics: [] },
      sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
      busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
      pendingClarifications: [],
      pendingApprovals: [],
      output: { text: planOutput },
      updatedAt: createdAt,
    } as unknown as OraStateSnapshot;

    const messages = adaptChatMessages(
      [{
        id: "run-plan:user",
        sessionId: "session-plan",
        runId: "run-plan",
        turnIndex: 1,
        role: "user",
        content: "调整决策状态 UI",
        pattern: "orchestrator_subagent",
        modeId: SINGLE_AGENT_MODE_ID,
        createdAt,
      }],
      { "run-plan": snapshot },
    );
    const assistant = messages.find((message) => message.role === "assistant");
    const timelineText = assistant?.turn?.timelineItems
      ?.flatMap((item) => "content" in item ? [item.content] : [])
      .join("\n") ?? "";

    expect(assistant?.turn?.hasProposedPlan).toBe(true);
    expect(assistant?.content).toContain("## PlanDecisionPanel 决策状态 UI 调整");
    expect(assistant?.content).toContain("## 实施步骤");
    expect(assistant?.content).not.toContain("现在我已经充分了解了代码结构");
    expect(assistant?.content).not.toContain("<proposed_plan>");
    expect(timelineText).not.toContain("## PlanDecisionPanel 决策状态 UI 调整");
    expect(timelineText).not.toContain("## 实施步骤");
    expect(timelineText).not.toContain("提示文字左对齐");
    expect(assistant?.turn?.timelineItems).toContainEqual(expect.objectContaining({
      kind: "assistant_text",
      content: expect.stringContaining("现在我已经充分了解了代码结构"),
    }));
    expect(assistant?.turn?.timelineItems?.some((item) =>
      item.kind === "final_text" && "content" in item && item.content.includes("## PlanDecisionPanel 决策状态 UI 调整")
    )).toBe(false);
  });

  it("suppresses historical proposed plan content after an accepted same-run resume starts implementation", () => {
    const createdAt = 1_714_000_000_000;
    const proposedPlan = [
      "<proposed_plan>",
      "## Runtime status plan",
      "1. Add shared attention projection.",
      "2. Persist plan decision gates.",
      "</proposed_plan>",
    ].join("\n");
    const snapshot = {
      runId: "run-plan-resume",
      sessionId: "session-plan-resume",
      turnIndex: 1,
      status: "running",
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
        deterministicSeed: "view-model-accepted-plan-resume",
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
        status: "in_progress",
      }],
      todos: [],
      actions: [],
      toolCalls: [],
      policyDecisions: [],
      checkpoints: [],
      events: [],
      artifacts: [],
      activeAgents: [],
      queueSummary: { mode: "dag", pending: 0, inProgress: 1, completed: 0, topics: [] },
      sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
      busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
      pendingClarifications: [],
      pendingApprovals: [],
      planDecisions: [{
        id: "decision-plan",
        runId: "run-plan-resume",
        sessionId: "session-plan-resume",
        status: "accepted",
        planContent: "## Runtime status plan\n1. Add shared attention projection.\n2. Persist plan decision gates.",
        createdAt: createdAt + 10,
        resolvedAt: createdAt + 20,
      }],
      output: { text: proposedPlan },
      updatedAt: createdAt + 30,
    } as unknown as OraStateSnapshot;

    const presented = derivePresentedAssistantTurnFromSnapshot(snapshot);

    expect(presented.content).toBe("");
    expect(presented.turn.planContent).toBeUndefined();
    expect(presented.turn.hasProposedPlan).toBe(true);
    expect(presented.turn.planList).toEqual([
      { step: "Add shared attention projection.", status: "completed" },
      { step: "Persist plan decision gates.", status: "in_progress" },
    ]);
  });

  it("keeps a new proposed plan visible when a later pending replan exists in the same run", () => {
    const createdAt = 1_714_000_000_000;
    const replannedProposal = [
      "<proposed_plan>",
      "## Runtime replan",
      "1. Re-check the accepted resume boundary.",
      "2. Add coverage for a second plan gate.",
      "</proposed_plan>",
    ].join("\n");
    const snapshot = {
      runId: "run-plan-replan",
      sessionId: "session-plan-replan",
      turnIndex: 1,
      status: "succeeded",
      pattern: "orchestrator_subagent",
      modeId: SINGLE_AGENT_MODE_ID,
      input: { prompt: "Replan the runtime work", createdAt, context: {} },
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
        deterministicSeed: "view-model-replan-after-accepted",
        skillIds: [],
        toolIds: [],
      },
      topology: { nodes: [], edges: [] },
      profiles: [],
      memory: [],
      plan: [],
      planList: [{
        id: "step-1",
        step: "Re-check the accepted resume boundary.",
        status: "pending",
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
        id: "decision-accepted",
        runId: "run-plan-replan",
        sessionId: "session-plan-replan",
        status: "accepted",
        planContent: "## Old accepted plan\n1. Initial implementation.",
        createdAt: createdAt + 10,
        resolvedAt: createdAt + 20,
      }, {
        id: "decision-replan",
        runId: "run-plan-replan",
        sessionId: "session-plan-replan",
        status: "pending",
        planContent: "## Runtime replan\n1. Re-check the accepted resume boundary.\n2. Add coverage for a second plan gate.",
        createdAt: createdAt + 30,
      }],
      attention: {
        kind: "needs_plan_decision",
        blocking: true,
        sourceRunId: "run-plan-replan",
        reason: "plan_decision_required",
        planDecisionId: "decision-replan",
        pendingActionIds: [],
        pendingToolCallIds: [],
        pendingClarificationIds: [],
      },
      output: { text: replannedProposal },
      updatedAt: createdAt + 40,
    } as unknown as OraStateSnapshot;

    const presented = derivePresentedAssistantTurnFromSnapshot(snapshot);

    expect(presented.content).toContain("## Runtime replan");
    expect(presented.content).toContain("Add coverage for a second plan gate.");
    expect(presented.turn.planContent).toContain("## Runtime replan");
    expect(presented.turn.proposedPlanStatus).toBe("complete");
  });

  it("hides raw recovery boundary diagnostics from user-visible text", () => {
    const createdAt = 1_714_000_000_000;
    const rawDiagnostic = "[tool-error-boundary] Plan development task degraded after provider_transient: Code Development boundary violation: Orchestrator may plan and finalize, but code mutations must run in the Builder stage.";
    const snapshot = {
      runId: "run-boundary-diagnostic",
      sessionId: "session-boundary-diagnostic",
      turnIndex: 1,
      status: "succeeded",
      pattern: "agent_teams",
      modeId: CODE_DEVELOPMENT_MODE_ID,
      input: { prompt: "fix boundary leak", createdAt, context: {} },
      config: {
        modeId: CODE_DEVELOPMENT_MODE_ID,
        pattern: "agent_teams",
        modeSelection: "manual",
        profileIds: ["orchestrator"],
        providerId: "local-smoke",
        modelRef: "local/smoke-model",
        approvalMode: "high_risk_only",
        patternOptions: {},
        metadata: {},
        deterministicSeed: "view-model-boundary-diagnostic-test",
        skillIds: [],
        toolIds: [],
      },
      topology: { nodes: [], edges: [] },
      profiles: [{ id: "orchestrator", label: "Orchestrator", role: "Coordinate", modelRef: "local/smoke-model", toolPolicyId: "code.default", memoryNamespaces: ["session"], budget: { maxTokens: 1000, maxToolCalls: 0, maxRuntimeMs: 1000 } }],
      memory: [],
      plan: [],
      planList: [],
      todos: [],
      actions: [],
      toolCalls: [],
      policyDecisions: [],
      checkpoints: [],
      events: [
        {
          id: "run-boundary-diagnostic:evt-0",
          runId: "run-boundary-diagnostic",
          seq: 0,
          type: "message.delta",
          createdAt,
          pattern: "agent_teams",
          agentId: "orchestrator",
          payload: { role: "assistant", content: rawDiagnostic },
        },
        {
          id: "run-boundary-diagnostic:evt-1",
          runId: "run-boundary-diagnostic",
          seq: 1,
          type: "node.updated",
          createdAt: createdAt + 1,
          pattern: "agent_teams",
          agentId: "orchestrator",
          payload: { state: "degraded", detail: "Code Development boundary violation: Orchestrator may plan and finalize, but code mutations must run in the Builder stage." },
        },
      ],
      agentMessages: [],
      artifacts: [],
      activeAgents: [],
      queueSummary: { mode: "dag", pending: 0, inProgress: 0, completed: 1, topics: [] },
      sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
      busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
      pendingClarifications: [],
      pendingApprovals: [],
      output: { text: rawDiagnostic },
      updatedAt: createdAt + 1,
    } as unknown as OraStateSnapshot;

    const assistant = adaptChatMessages(
      [{
        id: "run-boundary-diagnostic:user",
        sessionId: "session-boundary-diagnostic",
        runId: "run-boundary-diagnostic",
        turnIndex: 1,
        role: "user",
        content: "fix boundary leak",
        pattern: "agent_teams",
        modeId: CODE_DEVELOPMENT_MODE_ID,
        createdAt,
      }],
      { "run-boundary-diagnostic": snapshot },
    ).find((message) => message.role === "assistant");
    const timelineText = assistant?.turn?.timelineItems
      ?.map((item) => "content" in item ? item.content : "summary" in item ? item.summary : "")
      .join("\n") ?? "";

    expect(assistant?.content ?? "").not.toContain("[tool-error-boundary]");
    expect(assistant?.content ?? "").not.toContain("boundary violation");
    expect(timelineText).toContain("已在有限上下文下继续");
    expect(timelineText).not.toContain("[tool-error-boundary]");
    expect(timelineText).not.toContain("boundary violation");
  });

  it("falls back to public message deltas when snapshot.output is polluted by DSML protocol text", () => {
    const createdAt = 1_714_000_000_000;
    const snapshot = {
      runId: "run-dsml-output-fallback",
      sessionId: "session-dsml-output-fallback",
      turnIndex: 1,
      status: "succeeded",
      pattern: "orchestrator_subagent",
      modeId: SINGLE_AGENT_MODE_ID,
      input: { prompt: "总结这次修复", createdAt, context: {} },
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
        deterministicSeed: "view-model-dsml-output-fallback-test",
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
        id: "evt-public-delta",
        runId: "run-dsml-output-fallback",
        seq: 0,
        type: "message.delta",
        createdAt,
        pattern: "orchestrator_subagent",
        agentId: ORA_ROOT_AGENT_ID,
        payload: {
          role: "assistant",
          content: "修复已经完成，终态 guard 现在会拒绝内部协议文本。",
        },
      }],
      artifacts: [],
      activeAgents: [],
      queueSummary: { mode: "dag", pending: 0, inProgress: 0, completed: 1, topics: [] },
      sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
      busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
      pendingClarifications: [],
      pendingApprovals: [],
      output: {
        text: [
          "修复已经完成，终态 guard 现在会拒绝内部协议文本。",
          "",
          "<｜｜DSML｜｜tool_calls>",
          '<｜｜DSML｜｜invoke name="file__read">',
          "</｜｜DSML｜｜invoke>",
          "</｜｜DSML｜｜tool_calls>",
        ].join("\n"),
      },
      updatedAt: createdAt + 1000,
    } as unknown as OraStateSnapshot;

    const presented = derivePresentedAssistantTurnFromSnapshot(snapshot);

    expect(presented.content).toBe("修复已经完成，终态 guard 现在会拒绝内部协议文本。");
    expect(presented.content).not.toContain("DSML");
  });

  it("uses partial proposed plan content while plan mode output is still streaming", () => {
    const createdAt = 1_714_000_000_000;
    const partialPlanOutput = [
      "我先整理成可执行计划：",
      "",
      "<proposed_plan>",
      "## 流式计划卡片",
      "",
      "## 实施步骤",
      "1. opening tag 出现后立即渲染卡片",
    ].join("\n");
    const snapshot = {
      runId: "run-streaming-plan",
      sessionId: "session-streaming-plan",
      turnIndex: 1,
      status: "running",
      pattern: "orchestrator_subagent",
      modeId: SINGLE_AGENT_MODE_ID,
      input: { prompt: "优化计划流式渲染", createdAt, context: {} },
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
        deterministicSeed: "view-model-streaming-proposed-plan-test",
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
        id: "run-streaming-plan:evt-0",
        runId: "run-streaming-plan",
        seq: 0,
        type: "message.delta",
        createdAt,
        pattern: "orchestrator_subagent",
        payload: { role: "assistant", content: partialPlanOutput },
      }],
      agentMessages: [],
      artifacts: [],
      activeAgents: [],
      queueSummary: { mode: "dag", pending: 0, inProgress: 1, completed: 0, topics: [] },
      sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
      busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
      pendingClarifications: [],
      pendingApprovals: [],
      output: { text: partialPlanOutput },
      updatedAt: createdAt,
    } as unknown as OraStateSnapshot;

    const messages = adaptChatMessages(
      [{
        id: "run-streaming-plan:user",
        sessionId: "session-streaming-plan",
        runId: "run-streaming-plan",
        turnIndex: 1,
        role: "user",
        content: "优化计划流式渲染",
        pattern: "orchestrator_subagent",
        modeId: SINGLE_AGENT_MODE_ID,
        createdAt,
      }],
      { "run-streaming-plan": snapshot },
    );
    const assistant = messages.find((message) => message.role === "assistant");
    const timelineText = assistant?.turn?.timelineItems
      ?.flatMap((item) => "content" in item ? [item.content] : [])
      .join("\n") ?? "";

    expect(assistant?.turn?.hasProposedPlan).toBe(true);
    expect(assistant?.content).toContain("## 流式计划卡片");
    expect(assistant?.content).toContain("opening tag 出现后立即渲染卡片");
    expect(assistant?.content).not.toContain("我先整理成可执行计划");
    expect(assistant?.content).not.toContain("<proposed_plan>");
    expect(timelineText).toContain("我先整理成可执行计划");
    expect(timelineText).not.toContain("## 流式计划卡片");
    expect(timelineText).not.toContain("opening tag 出现后立即渲染卡片");
    expect(assistant?.turn?.proposedPlanStatus).toBe("streaming");
    expect(assistant?.turn?.activeLoadingTarget).toEqual({ kind: "thinking" });
  });

  it("uses the latest timeline status group as the active loading target when no plan is streaming", () => {
    const createdAt = 1_714_000_000_000;
    const snapshot = {
      runId: "run-timeline-loading-target",
      sessionId: "session-timeline-loading-target",
      turnIndex: 1,
      status: "running",
      pattern: "orchestrator_subagent",
      modeId: SINGLE_AGENT_MODE_ID,
      input: { prompt: "检查进度 loading", createdAt, context: {} },
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
        deterministicSeed: "view-model-timeline-loading-target-test",
        skillIds: [],
        toolIds: ["file.read"],
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
        id: "run-timeline-loading-target:evt-0",
        runId: "run-timeline-loading-target",
        seq: 0,
        type: "tool.called",
        createdAt,
        pattern: "orchestrator_subagent",
        payload: {
          toolId: "file.read",
          status: "succeeded",
          input: { path: "apps/desktop/src/components/AssistantTurnCard.tsx" },
          output: { path: "apps/desktop/src/components/AssistantTurnCard.tsx", sizeBytes: 128 },
        },
      }],
      agentMessages: [],
      artifacts: [],
      activeAgents: [],
      queueSummary: { mode: "dag", pending: 0, inProgress: 1, completed: 0, topics: [] },
      sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
      busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
      pendingClarifications: [],
      pendingApprovals: [],
      output: undefined,
      updatedAt: createdAt,
    } as unknown as OraStateSnapshot;

    const assistant = adaptChatMessages(
      [{
        id: "run-timeline-loading-target:user",
        sessionId: "session-timeline-loading-target",
        runId: "run-timeline-loading-target",
        turnIndex: 1,
        role: "user",
        content: "检查进度 loading",
        pattern: "orchestrator_subagent",
        modeId: SINGLE_AGENT_MODE_ID,
        createdAt,
      }],
      { "run-timeline-loading-target": snapshot },
    ).find((message) => message.role === "assistant");

    expect(assistant?.turn?.activeLoadingTarget).toEqual({
      kind: "timeline",
      itemId: "run-timeline-loading-target:timeline:status:0",
    });
  });

  it("shows missing file.list targets as ordinary tool results", () => {
    const createdAt = 1_714_000_000_000;
    const snapshot = {
      runId: "run-missing-file-list",
      sessionId: "session-missing-file-list",
      turnIndex: 1,
      status: "succeeded",
      pattern: "orchestrator_subagent",
      modeId: SINGLE_AGENT_MODE_ID,
      input: { prompt: "列出 src", createdAt, context: {} },
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
        deterministicSeed: "view-model-missing-file-list-test",
        skillIds: [],
        toolIds: ["file.list"],
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
        id: "run-missing-file-list:evt-0",
        runId: "run-missing-file-list",
        seq: 0,
        type: "tool.called",
        createdAt,
        pattern: "orchestrator_subagent",
        payload: {
          toolId: "file.list",
          status: "succeeded",
          input: { path: "src" },
          output: { path: "src", entries: [], missing: true },
        },
      }],
      agentMessages: [],
      artifacts: [],
      activeAgents: [],
      queueSummary: { mode: "dag", pending: 0, inProgress: 0, completed: 0, topics: [] },
      sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
      busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
      pendingClarifications: [],
      pendingApprovals: [],
      output: { text: "src 目录不存在。" },
      updatedAt: createdAt,
    } as unknown as OraStateSnapshot;

    const assistant = adaptChatMessages(
      [{
        id: "run-missing-file-list:user",
        sessionId: "session-missing-file-list",
        runId: "run-missing-file-list",
        turnIndex: 1,
        role: "user",
        content: "列出 src",
        pattern: "orchestrator_subagent",
        modeId: SINGLE_AGENT_MODE_ID,
        createdAt,
      }],
      { "run-missing-file-list": snapshot },
    ).find((message) => message.role === "assistant");

    const step = assistant?.turn?.processSteps[0];
    expect(step).toMatchObject({
      label: "列出文件",
      status: "complete",
      detail: "未找到 src，未列出文件。",
      contextLabel: "src",
    });
    expect(step?.detail).not.toContain("工具执行失败");
  });

  it("does not let raw approval actions suppress running turn content without projection attention", () => {
    const createdAt = 1_714_000_000_000;
    const snapshot = {
      runId: "run-raw-approval-running-content",
      sessionId: "session-raw-approval-running-content",
      turnIndex: 1,
      status: "running",
      pattern: "orchestrator_subagent",
      modeId: SINGLE_AGENT_MODE_ID,
      input: { prompt: "Keep rendering progress.", createdAt, context: {} },
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
        deterministicSeed: "view-model-raw-approval-running-content-test",
        skillIds: [],
        toolIds: ["file.read"],
      },
      topology: { nodes: [], edges: [] },
      profiles: [],
      memory: [],
      plan: [],
      planList: [],
      todos: [],
      actions: [{
        id: "run-raw-approval-running-content:action:tool-1",
        runId: "run-raw-approval-running-content",
        type: "file.write",
        riskLevel: "high",
        status: "approval_required",
        input: {},
        artifactIds: [],
      }],
      toolCalls: [],
      policyDecisions: [],
      checkpoints: [],
      events: [{
        id: "run-raw-approval-running-content:evt-0",
        runId: "run-raw-approval-running-content",
        seq: 0,
        type: "tool.called",
        createdAt,
        pattern: "orchestrator_subagent",
        payload: {
          toolId: "file.read",
          status: "succeeded",
          input: { path: "README.md" },
          output: { path: "README.md", sizeBytes: 128 },
        },
      }],
      agentMessages: [],
      artifacts: [],
      activeAgents: [],
      queueSummary: { mode: "dag", pending: 0, inProgress: 1, completed: 0, topics: [] },
      sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
      busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
      pendingClarifications: [],
      pendingApprovals: ["run-raw-approval-running-content:action:tool-1"],
      output: undefined,
      updatedAt: createdAt,
    } as unknown as OraStateSnapshot;

    const assistant = adaptChatMessages(
      [
        {
          id: "run-raw-approval-running-content:user",
          sessionId: "session-raw-approval-running-content",
          runId: "run-raw-approval-running-content",
          turnIndex: 1,
          role: "user",
          content: "Keep rendering progress.",
          pattern: "orchestrator_subagent",
          modeId: SINGLE_AGENT_MODE_ID,
          createdAt,
        },
        {
          id: "run-raw-approval-running-content:assistant",
          sessionId: "session-raw-approval-running-content",
          runId: "run-raw-approval-running-content",
          turnIndex: 1,
          role: "assistant",
          content: "Stored assistant text stays visible.",
          pattern: "orchestrator_subagent",
          modeId: SINGLE_AGENT_MODE_ID,
          createdAt: createdAt + 1_000,
        },
      ],
      { "run-raw-approval-running-content": snapshot },
    ).find((message) => message.role === "assistant");

    expect(assistant?.content).toBe("Stored assistant text stays visible.");
    expect(assistant?.turn?.approvalCount).toBe(0);
    expect(assistant?.turn?.activeLoadingTarget).toEqual({
      kind: "timeline",
      itemId: "run-raw-approval-running-content:timeline:status:0",
    });
  });

  it("prefers terminal snapshot status over stale running attention", () => {
    const createdAt = 1_714_000_000_000;
    const session: OraSessionSummary = {
      sessionId: "session-terminal-overrunning-attention",
      title: "Terminal status",
      status: "running",
      latestRunId: "run-terminal-overrunning-attention",
      latestPattern: "orchestrator_subagent",
      latestModeId: SINGLE_AGENT_MODE_ID,
      turnCount: 1,
      createdAt,
      updatedAt: createdAt,
    };
    const snapshot = {
      runId: "run-terminal-overrunning-attention",
      sessionId: "session-terminal-overrunning-attention",
      turnIndex: 1,
      status: "succeeded",
      pattern: "orchestrator_subagent",
      modeId: SINGLE_AGENT_MODE_ID,
      input: { prompt: "Done but attention is stale.", createdAt, context: {} },
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
        deterministicSeed: "view-model-terminal-overrunning-attention-test",
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
      events: [],
      agentMessages: [],
      artifacts: [],
      activeAgents: [],
      queueSummary: { mode: "dag", pending: 0, inProgress: 0, completed: 1, topics: [] },
      sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
      busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
      pendingClarifications: [],
      pendingApprovals: [],
      attention: {
        kind: "running",
        blocking: false,
        sourceRunId: "run-terminal-overrunning-attention",
        pendingActionIds: [],
        pendingToolCallIds: [],
        pendingClarificationIds: [],
      },
      output: { text: "Done." },
      updatedAt: createdAt,
    } as unknown as OraStateSnapshot;
    const detail: OraSessionDetail = {
      session,
      turns: [{
        runId: "run-terminal-overrunning-attention",
        sessionId: "session-terminal-overrunning-attention",
        turnIndex: 1,
        status: "succeeded",
        attention: snapshot.attention,
        pattern: "orchestrator_subagent",
        modeId: SINGLE_AGENT_MODE_ID,
        modelRef: "local-smoke-model",
        providerId: "local-smoke",
        prompt: "Done but attention is stale.",
        startedAt: createdAt,
        updatedAt: createdAt,
        eventCount: 0,
        checkpointCount: 0,
        artifactCount: 0,
      }],
      transcript: [],
      latestSnapshot: snapshot,
    };

    const viewModel = buildWorkbenchViewModel(
      MVP_PATTERNS,
      MVP_MODES,
      [session],
      detail,
      snapshot,
      "orchestrator_subagent",
      SINGLE_AGENT_MODE_ID,
    );
    const assistant = adaptChatMessages(
      [
        {
          id: "run-terminal-overrunning-attention:user",
          sessionId: "session-terminal-overrunning-attention",
          runId: "run-terminal-overrunning-attention",
          turnIndex: 1,
          role: "user",
          content: "Done but attention is stale.",
          pattern: "orchestrator_subagent",
          modeId: SINGLE_AGENT_MODE_ID,
          createdAt,
        },
      ],
      { "run-terminal-overrunning-attention": snapshot },
    ).find((message) => message.role === "assistant");

    expect(viewModel.sessions[0]?.status).toBe("done");
    expect(assistant?.turn?.status).toBe("done");
    expect(assistant?.turn?.activeLoadingTarget).toBeUndefined();
  });

  it("uses tagged delta proposed plans instead of untagged final plan summaries", () => {
    const createdAt = 1_714_000_000_000;
    const untaggedOutput = [
      "Below is the proposed change to remove the status badge for cancelled sessions in the sidebar.",
      "",
      "### Plan summary",
      "- File: apps/desktop/src/components/Sidebar.tsx",
      "- Change: return null for cancelled sessions.",
      "",
      "Shall I go ahead and implement this change now?",
    ].join("\n");
    const taggedPlanOutput = [
      "Now I have full context. The change is isolated and low-risk — here's the plan.",
      "",
      "<proposed_plan>",
      "## Hide status badge for cancelled sessions in Sidebar",
      "",
      "## 背景",
      "Ora 的侧边栏中，SessionStatusBadge 会为非 done 状态渲染标签，cancelled 不应显示状态徽章。",
      "",
      "## 实施步骤",
      "1. 修改 SessionStatusBadge，让 cancelled 状态返回 null。",
      "2. 保持 running、failed、paused 等其他状态的现有徽章行为。",
      "",
      "## 验证方式",
      "1. 确认 cancelled session 不显示 Cancelled 标签。",
      "2. 确认其他状态仍正常显示。",
      "</proposed_plan>",
    ].join("\n");
    const snapshot = {
      runId: "run-0031-like",
      sessionId: "session-0031-like",
      turnIndex: 1,
      status: "running",
      pattern: "agent_teams",
      modeId: CODE_DEVELOPMENT_MODE_ID,
      input: { prompt: "hide cancelled status", createdAt, context: {} },
      config: {
        modeId: CODE_DEVELOPMENT_MODE_ID,
        pattern: "agent_teams",
        modeSelection: "manual",
        profileIds: ["orchestrator"],
        providerId: "local-smoke",
        modelRef: "local/smoke-model",
        approvalMode: "high_risk_only",
        patternOptions: {},
        metadata: { taskIntent: "plan" },
        deterministicSeed: "view-model-run-0031-proposed-plan-test",
        skillIds: [],
        toolIds: [],
      },
      topology: { nodes: [], edges: [] },
      profiles: [{ id: "orchestrator", label: "Orchestrator" }],
      memory: [],
      plan: [],
      planList: [],
      todos: [],
      actions: [],
      toolCalls: [],
      policyDecisions: [],
      checkpoints: [],
      events: [{
        id: "run-0031-like:evt-0",
        runId: "run-0031-like",
        seq: 0,
        type: "message.delta",
        createdAt,
        agentId: "orchestrator",
        pattern: "agent_teams",
        payload: { role: "assistant", content: taggedPlanOutput, streaming: true },
      }],
      agentMessages: [],
      artifacts: [],
      activeAgents: [],
      queueSummary: { mode: "dag", pending: 0, inProgress: 1, completed: 0, topics: [] },
      sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
      busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
      pendingClarifications: [],
      pendingApprovals: [],
      output: { text: untaggedOutput },
      updatedAt: createdAt + 1_000,
    } as unknown as OraStateSnapshot;

    const assistant = adaptChatMessages(
      [{
        id: "run-0031-like:user",
        sessionId: "session-0031-like",
        runId: "run-0031-like",
        turnIndex: 1,
        role: "user",
        content: "hide cancelled status",
        pattern: "agent_teams",
        modeId: CODE_DEVELOPMENT_MODE_ID,
        createdAt,
      }],
      { "run-0031-like": snapshot },
    ).find((message) => message.role === "assistant");
    const timelineText = assistant?.turn?.timelineItems
      ?.flatMap((item) => "content" in item ? [item.content] : [])
      .join("\n") ?? "";

    expect(assistant?.turn?.hasProposedPlan).toBe(true);
    expect(assistant?.turn?.proposedPlanStatus).toBe("complete");
    expect(assistant?.content).toContain("## Hide status badge for cancelled sessions in Sidebar");
    expect(assistant?.content).toContain("## 实施步骤");
    expect(assistant?.content).not.toContain("Below is the proposed change");
    expect(assistant?.content).not.toContain("<proposed_plan>");
    expect(timelineText).toContain("Now I have full context");
    expect(timelineText).not.toContain("Below is the proposed change");
    expect(timelineText).not.toContain("### Plan summary");
    expect(timelineText).not.toContain("## Hide status badge");
    expect(timelineText).not.toContain("## 实施步骤");
  });

  it("does not promote a completed but invalid short proposed plan into a plan card", () => {
    const createdAt = 1_714_000_000_000;
    const invalidPlanOutput = [
      "计划内容太短，我需要重新整理。",
      "",
      "<proposed_plan>",
      "太短",
      "</proposed_plan>",
    ].join("\n");
    const snapshot = {
      runId: "run-invalid-short-plan",
      sessionId: "session-invalid-short-plan",
      turnIndex: 1,
      status: "succeeded",
      pattern: "orchestrator_subagent",
      modeId: SINGLE_AGENT_MODE_ID,
      input: { prompt: "优化计划流式渲染", createdAt, context: {} },
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
        deterministicSeed: "view-model-invalid-short-proposed-plan-test",
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
        id: "run-invalid-short-plan:evt-0",
        runId: "run-invalid-short-plan",
        seq: 0,
        type: "message.delta",
        createdAt,
        pattern: "orchestrator_subagent",
        payload: { role: "assistant", content: invalidPlanOutput },
      }],
      agentMessages: [],
      artifacts: [],
      activeAgents: [],
      queueSummary: { mode: "dag", pending: 0, inProgress: 0, completed: 1, topics: [] },
      sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
      busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
      pendingClarifications: [],
      pendingApprovals: [],
      output: { text: invalidPlanOutput },
      updatedAt: createdAt,
    } as unknown as OraStateSnapshot;

    const assistant = adaptChatMessages(
      [{
        id: "run-invalid-short-plan:user",
        sessionId: "session-invalid-short-plan",
        runId: "run-invalid-short-plan",
        turnIndex: 1,
        role: "user",
        content: "优化计划流式渲染",
        pattern: "orchestrator_subagent",
        modeId: SINGLE_AGENT_MODE_ID,
        createdAt,
      }],
      { "run-invalid-short-plan": snapshot },
    ).find((message) => message.role === "assistant");

    expect(assistant?.turn?.hasProposedPlan).toBe(false);
    expect(assistant?.content).toContain("计划内容太短，我需要重新整理。");
    expect(assistant?.content).not.toContain("<proposed_plan>");
  });

  it("suppresses invalid multiple proposed_plan blocks from assistant body and plan card surfaces", () => {
    const createdAt = 1_714_000_000_000;
    const plan = [
      "<proposed_plan>",
      "## Runtime 计划",
      "## 背景",
      "说明上下文",
      "## 实施步骤",
      "1. 调整 shared helper。",
      "2. 增加回归测试。",
      "## 验证方式",
      "- 运行测试",
      "</proposed_plan>",
    ].join("\n");
    const output = `前置说明\n${plan}\n---\n${plan}\n结尾说明`;
    const snapshot = {
      runId: "run-invalid-multi-plan",
      sessionId: "session-invalid-multi-plan",
      turnIndex: 1,
      status: "succeeded",
      pattern: "orchestrator_subagent",
      modeId: SINGLE_AGENT_MODE_ID,
      input: { prompt: "给出方案", createdAt, context: {} },
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
        deterministicSeed: "view-model-invalid-multi-plan",
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
        id: "run-invalid-multi-plan:evt-0",
        runId: "run-invalid-multi-plan",
        seq: 0,
        type: "message.delta",
        createdAt,
        pattern: "orchestrator_subagent",
        payload: { role: "assistant", content: output },
      }],
      agentMessages: [],
      artifacts: [],
      activeAgents: [],
      queueSummary: { mode: "dag", pending: 0, inProgress: 0, completed: 1, topics: [] },
      sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
      busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
      pendingClarifications: [],
      pendingApprovals: [],
      output: { text: output },
      updatedAt: createdAt,
    } as unknown as OraStateSnapshot;

    const presented = derivePresentedAssistantTurnFromSnapshot(snapshot);

    expect(presented.turn.hasProposedPlan).toBe(false);
    expect(presented.turn.planContent).toBeUndefined();
    expect(presented.content).not.toContain("<proposed_plan>");
    expect(presented.content).not.toContain("## Runtime 计划");
  });

  it("suppresses stray proposed_plan closing tags from assistant body surfaces", () => {
    const createdAt = 1_714_000_000_000;
    const output = "前置说明\n</proposed_plan>\n结尾说明";
    const snapshot = {
      runId: "run-invalid-stray-close-plan",
      sessionId: "session-invalid-stray-close-plan",
      turnIndex: 1,
      status: "succeeded",
      pattern: "orchestrator_subagent",
      modeId: SINGLE_AGENT_MODE_ID,
      input: { prompt: "给出方案", createdAt, context: {} },
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
        deterministicSeed: "view-model-invalid-stray-close-plan",
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
        id: "run-invalid-stray-close-plan:evt-0",
        runId: "run-invalid-stray-close-plan",
        seq: 0,
        type: "message.delta",
        createdAt,
        pattern: "orchestrator_subagent",
        payload: { role: "assistant", content: output },
      }],
      agentMessages: [],
      artifacts: [],
      activeAgents: [],
      queueSummary: { mode: "dag", pending: 0, inProgress: 0, completed: 1, topics: [] },
      sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
      busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
      pendingClarifications: [],
      pendingApprovals: [],
      output: { text: output },
      updatedAt: createdAt,
    } as unknown as OraStateSnapshot;

    const presented = derivePresentedAssistantTurnFromSnapshot(snapshot);

    expect(presented.turn.hasProposedPlan).toBe(false);
    expect(presented.turn.planContent).toBeUndefined();
    expect(presented.content).toBe("前置说明\n\n结尾说明");
    expect(presented.content).not.toContain("</proposed_plan>");
  });

  it("derives a streaming proposed plan from long deltas", () => {
    const createdAt = 1_714_000_000_000;
    const runId = "run-long-streaming-plan";
    const sessionId = "session-long-streaming-plan";
    const messageId = `${runId}:assistant:planner:planner:0`;
    const intro = "我会先给出任务计划。\n\n";
    const planBody = Array.from({ length: 240 }, (_, index) =>
      `${index + 1}. 核对第 ${index + 1} 个流式输出细节，确认计划卡片仍然稳定更新。`,
    ).join("\n");
    const fullText = `${intro}<proposed_plan>\n${planBody}`;
    const chunks = fullText.match(/.{1,40}/gs) ?? [];
    const snapshot = {
      runId,
      sessionId,
      turnIndex: 1,
      status: "running",
      pattern: "orchestrator_subagent",
      modeId: SINGLE_AGENT_MODE_ID,
      input: { prompt: "排查任务计划流式卡顿", createdAt, context: {} },
      config: {
        modeId: SINGLE_AGENT_MODE_ID,
        pattern: "orchestrator_subagent",
        modeSelection: "manual",
        profileIds: ["planner"],
        providerId: "local-smoke",
        modelRef: "local/smoke-model",
        approvalMode: "high_risk_only",
        patternOptions: {},
        metadata: { taskIntent: "plan" },
        deterministicSeed: "view-model-long-streaming-plan-test",
        skillIds: [],
        toolIds: [],
      },
      topology: { nodes: [], edges: [] },
      profiles: [{ id: "planner", label: "Planner" }],
      memory: [],
      plan: [],
      planList: [],
      todos: [],
      actions: [],
      toolCalls: [],
      policyDecisions: [],
      checkpoints: [],
      events: chunks.map((delta, index) => ({
        id: `${runId}:evt-${index}`,
        runId,
        seq: index,
        type: "message.delta" as const,
        agentId: "planner",
        createdAt: createdAt + index,
        pattern: "orchestrator_subagent" as const,
        payload: { role: "assistant", messageId, content: delta, delta, streaming: true },
      })),
      agentMessages: [],
      artifacts: [],
      activeAgents: [],
      queueSummary: { mode: "dag", pending: 0, inProgress: 1, completed: 0, topics: [] },
      sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
      busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
      pendingClarifications: [],
      pendingApprovals: [],
      updatedAt: createdAt + chunks.length,
    } as unknown as OraStateSnapshot;

    const assistant = adaptChatMessages(
      [{
        id: `${runId}:user`,
        sessionId,
        runId,
        turnIndex: 1,
        role: "user",
        content: "排查任务计划流式卡顿",
        pattern: "orchestrator_subagent",
        modeId: SINGLE_AGENT_MODE_ID,
        createdAt,
      }],
      { [runId]: snapshot },
    ).find((message) => message.role === "assistant");

    expect(assistant?.turn?.hasProposedPlan).toBe(true);
    expect(assistant?.turn?.proposedPlanStatus).toBe("streaming");
    expect(assistant?.turn?.activeLoadingTarget).toEqual({ kind: "thinking" });
    expect(assistant?.content).toContain("核对第 240 个流式输出细节");
    expect(assistant?.content).not.toContain("<proposed_plan>");
  });

  it("uses the latest live proposed plan message after a streaming recovery starts a new message", () => {
    const createdAt = 1_714_000_000_000;
    const runId = "run-plan-recovery-new-message";
    const sessionId = "session-plan-recovery-new-message";
    const firstMessageId = `${runId}:assistant:planner:planner:0`;
    const secondMessageId = `${runId}:assistant:planner:planner:1`;
    const firstPlan = "<proposed_plan>\n旧计划开头不应在恢复后的计划卡片里重播。";
    const secondPlan = "<proposed_plan>\n新计划步骤应该继续显示，而且只来自最新的恢复消息。";
    const snapshot = {
      runId,
      sessionId,
      turnIndex: 1,
      status: "running",
      pattern: "orchestrator_subagent",
      modeId: SINGLE_AGENT_MODE_ID,
      input: { prompt: "排查任务计划恢复卡顿", createdAt, context: {} },
      config: {
        modeId: SINGLE_AGENT_MODE_ID,
        pattern: "orchestrator_subagent",
        modeSelection: "manual",
        profileIds: ["planner"],
        providerId: "local-smoke",
        modelRef: "local/smoke-model",
        approvalMode: "high_risk_only",
        patternOptions: {},
        metadata: { taskIntent: "plan" },
        deterministicSeed: "view-model-plan-recovery-test",
        skillIds: [],
        toolIds: [],
      },
      topology: { nodes: [], edges: [] },
      profiles: [{ id: "planner", label: "Planner" }],
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
        type: "message.delta" as const,
        agentId: "planner",
        createdAt,
        pattern: "orchestrator_subagent" as const,
        payload: { role: "assistant", messageId: firstMessageId, content: firstPlan, delta: firstPlan, streaming: true },
      }, {
        id: `${runId}:evt-1`,
        runId,
        seq: 1,
        type: "completion.updated" as const,
        agentId: "planner",
        createdAt: createdAt + 1,
        pattern: "orchestrator_subagent" as const,
        payload: { status: "recovering", summary: "恢复计划流式输出" },
      }, {
        id: `${runId}:evt-2`,
        runId,
        seq: 2,
        type: "message.delta" as const,
        agentId: "planner",
        createdAt: createdAt + 2,
        pattern: "orchestrator_subagent" as const,
        payload: { role: "assistant", messageId: secondMessageId, content: secondPlan, delta: secondPlan, streaming: true },
      }],
      agentMessages: [],
      artifacts: [],
      activeAgents: [],
      queueSummary: { mode: "dag", pending: 0, inProgress: 1, completed: 0, topics: [] },
      sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
      busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
      pendingClarifications: [],
      pendingApprovals: [],
      updatedAt: createdAt + 2,
    } as unknown as OraStateSnapshot;

    const assistant = adaptChatMessages(
      [{
        id: `${runId}:user`,
        sessionId,
        runId,
        turnIndex: 1,
        role: "user",
        content: "排查任务计划恢复卡顿",
        pattern: "orchestrator_subagent",
        modeId: SINGLE_AGENT_MODE_ID,
        createdAt,
      }],
      { [runId]: snapshot },
      {
        [`${runId}:${firstMessageId}`]: {
          runId,
          messageId: firstMessageId,
          sessionId,
          role: "assistant",
          content: firstPlan,
          agentId: "planner",
          createdAt,
          updatedAt: createdAt,
        },
        [`${runId}:${secondMessageId}`]: {
          runId,
          messageId: secondMessageId,
          sessionId,
          role: "assistant",
          content: secondPlan,
          agentId: "planner",
          createdAt: createdAt + 2,
          updatedAt: createdAt + 2,
        },
      },
    ).find((message) => message.role === "assistant");

    expect(assistant?.turn?.hasProposedPlan).toBe(true);
    expect(assistant?.turn?.proposedPlanStatus).toBe("streaming");
    expect(assistant?.content).toContain("新计划步骤应该继续显示");
    expect(assistant?.content).not.toContain("旧计划开头不应");
    expect(assistant?.content).not.toContain("<proposed_plan>");
  });

  it("keeps internal agent message content out of the assistant timeline", () => {
    const createdAt = 1_714_000_000_000;
    const snapshot = {
      runId: "run-internal-agent-message",
      sessionId: "session-internal-agent-message",
      turnIndex: 1,
      status: "running",
      pattern: "agent_teams",
      modeId: CODE_DEVELOPMENT_MODE_ID,
      input: { prompt: "fix the code", createdAt, context: {} },
      config: {
        modeId: CODE_DEVELOPMENT_MODE_ID,
        pattern: "agent_teams",
        modeSelection: "manual",
        profileIds: ["orchestrator", "builder"],
        providerId: "local-smoke",
        modelRef: "local/smoke-model",
        approvalMode: "high_risk_only",
        patternOptions: {},
        metadata: {},
        deterministicSeed: "view-model-internal-agent-message-test",
        skillIds: [],
        toolIds: [],
      },
      topology: { nodes: [], edges: [] },
      profiles: [
        { id: "orchestrator", label: "Orchestrator", role: "Coordinate", modelRef: "local/smoke-model", toolPolicyId: "code.default", memoryNamespaces: ["session"], budget: { maxTokens: 1000, maxToolCalls: 0, maxRuntimeMs: 1000 } },
        { id: "builder", label: "Builder", role: "Build", modelRef: "local/smoke-model", toolPolicyId: "code.default", memoryNamespaces: ["session"], budget: { maxTokens: 1000, maxToolCalls: 0, maxRuntimeMs: 1000 } },
      ],
      memory: [],
      plan: [],
      todos: [],
      actions: [],
      toolCalls: [],
      policyDecisions: [],
      checkpoints: [],
      events: [],
      agentMessages: [
        {
          id: "run-internal-agent-message:agent-message:0",
          runId: "run-internal-agent-message",
          createdAt,
          fromAgentId: "orchestrator",
          toAgentIds: ["builder"],
          threadId: "agent-teams:build",
          nodeId: "triage",
          planItemId: "triage",
          kind: "mention",
          status: "done",
          content: "{\"tool\": \"file.read\", \"args\": {\"path\": \".ora/runtime.db\"}}\n<result><omitted /></result>",
          artifactIds: [],
        },
        {
          id: "run-internal-agent-message:agent-message:1",
          runId: "run-internal-agent-message",
          createdAt: createdAt + 1,
          fromAgentId: "builder",
          toAgentIds: ["orchestrator"],
          threadId: "agent-teams:build",
          nodeId: "build",
          planItemId: "build",
          kind: "reply",
          status: "done",
          content: "接下来交给 Orchestrator。\n\nBuilder 已完成代码修改。",
          artifactIds: [],
        },
      ],
      artifacts: [],
      activeAgents: [],
      queueSummary: { mode: "backlog", pending: 0, inProgress: 1, completed: 1, topics: [] },
      sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
      busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
      pendingClarifications: [],
      pendingApprovals: [],
      updatedAt: createdAt + 1,
    } as unknown as OraStateSnapshot;

    const assistant = adaptChatMessages(
      [{
        id: "run-internal-agent-message:user",
        sessionId: "session-internal-agent-message",
        runId: "run-internal-agent-message",
        turnIndex: 1,
        role: "user",
        content: "fix the code",
        pattern: "agent_teams",
        modeId: CODE_DEVELOPMENT_MODE_ID,
        createdAt,
      }],
      { "run-internal-agent-message": snapshot },
    ).find((message) => message.role === "assistant");
    const timelineText = assistant?.turn?.timelineItems
      ?.map((item) => "content" in item ? item.content : "")
      .join("\n") ?? "";

    expect(timelineText).toContain("Builder 已完成代码修改。");
    expect(timelineText).not.toContain("\"tool\"");
    expect(timelineText).not.toContain("<result>");
    expect(assistant?.turn?.timelineItems?.filter((item) => item.kind === "agent_message")).toHaveLength(1);
  });

  it("renders approval denial instead of stale resume progress after cancelled approvals", () => {
    const createdAt = 1_714_000_000_000;
    const snapshot = {
      runId: "run-approval-denied",
      sessionId: "session-approval-denied",
      turnIndex: 1,
      status: "cancelled",
      pattern: "orchestrator_subagent",
      modeId: SINGLE_AGENT_MODE_ID,
      input: { prompt: "更新项目文档", createdAt, context: {} },
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
        deterministicSeed: "view-model-approval-denied-test",
        skillIds: [],
        toolIds: ["file.write"],
      },
      topology: { nodes: [], edges: [] },
      profiles: [],
      memory: [],
      plan: [],
      todos: [],
      actions: [{
        id: "run-approval-denied:action:solo_agent-tool-1",
        runId: "run-approval-denied",
        type: "file.write",
        riskLevel: "high",
        status: "denied",
        input: { path: "10-Wiki/项目/西芒杜项目.md" },
        approvalRequest: {
          title: "需要你确认写入文件",
          summary: "我已经准备好把调研结果写入项目文档，批准后会继续执行本地写入。",
          whatWillChange: "会更新 10-Wiki/项目/西芒杜项目.md。",
          whyNeeded: "这是完成文档更新所需的本地文件写入步骤。",
          riskNote: "写入文件会改变你的项目内容。",
          confirmLabel: "批准并继续",
        },
        artifactIds: [],
        error: "已拒绝",
      }],
      toolCalls: [],
      policyDecisions: [],
      checkpoints: [],
      events: [
        {
          id: "run-approval-denied:evt-0",
          runId: "run-approval-denied",
          seq: 0,
          type: "task.progress",
          createdAt,
          pattern: "orchestrator_subagent",
          payload: {
            kind: "chat_progress",
            source: "progress_narrator",
            trigger: "run.resumed",
            summary: "已恢复",
          },
        },
        {
          id: "run-approval-denied:evt-1",
          runId: "run-approval-denied",
          seq: 1,
          type: "node.updated",
          createdAt: createdAt + 1_000,
          pattern: "orchestrator_subagent",
          payload: {
            nodeId: "solo_agent",
            state: "interrupted",
            detail: "Manual approval required for action run-approval-denied:action:solo_agent-tool-1.",
          },
        },
        {
          id: "run-approval-denied:evt-2",
          runId: "run-approval-denied",
          seq: 2,
          type: "run.cancelled",
          createdAt: createdAt + 2_000,
          pattern: "orchestrator_subagent",
          payload: { reason: "已拒绝" },
        },
      ],
      artifacts: [],
      activeAgents: [],
      queueSummary: { mode: "dag", pending: 0, inProgress: 0, completed: 0, topics: [] },
      sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
      busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
      pendingClarifications: [],
      pendingApprovals: [],
      error: "已拒绝",
      updatedAt: createdAt,
    } as unknown as OraStateSnapshot;

    const messages = adaptChatMessages(
      [
        {
          id: "run-approval-denied:user",
          sessionId: "session-approval-denied",
          runId: "run-approval-denied",
          turnIndex: 1,
          role: "user",
          content: "更新项目文档",
          pattern: "orchestrator_subagent",
          modeId: SINGLE_AGENT_MODE_ID,
          createdAt,
        },
        {
          id: "run-approval-denied:assistant",
          sessionId: "session-approval-denied",
          runId: "run-approval-denied",
          turnIndex: 1,
          role: "assistant",
          content: "文档已成功更新！以下是我完成的调研与更新总结：",
          pattern: "orchestrator_subagent",
          modeId: SINGLE_AGENT_MODE_ID,
          createdAt: createdAt + 1_000,
        },
      ],
      { "run-approval-denied": snapshot },
    );
    const assistant = messages.find((message) => message.role === "assistant");

    const processSteps = assistant?.turn?.processSteps ?? [];

    expect(assistant?.turn?.status).toBe("cancelled");
    expect(assistant?.turn?.liveProgressText).toBeUndefined();
    expect(processSteps.map((step) => step.label)).toEqual([
      "等待确认",
      "审批不通过",
    ]);
    expect(processSteps.at(-1)).toMatchObject({
      eventType: "approval.denied",
      detail: "已停止继续执行。",
      status: "blocked",
      tone: "warning",
    });
    expect(processSteps.some((step) => step.label === "已恢复")).toBe(false);
    expect(assistant?.content).toBe("审批不通过，已停止继续执行。");
    expect(assistant?.content).not.toContain("已恢复");
    expect(assistant?.content).not.toContain("文档已成功更新");
  });

  it("derives file-change artifacts and diff metadata for assistant turns", () => {
    const createdAt = 1_714_000_000_000;
    const snapshot = {
      runId: "run-file-change",
      sessionId: "session-file-change",
      turnIndex: 1,
      status: "succeeded",
      pattern: "orchestrator_subagent",
      modeId: SINGLE_AGENT_MODE_ID,
      input: { prompt: "更新文档", createdAt, context: {} },
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
        deterministicSeed: "view-model-file-change-test",
        skillIds: [],
        toolIds: ["file.patch"],
      },
      topology: { nodes: [], edges: [] },
      profiles: [],
      memory: [],
      plan: [],
      todos: [],
      actions: [],
      toolCalls: [],
      policyDecisions: [],
      checkpoints: [],
      events: [{
        id: "run-file-change:event:artifact-degraded",
        runId: "run-file-change",
        seq: 1,
        type: "artifact.degraded",
        createdAt,
        payload: {
          artifact: {
            id: "run-file-change:recovery:1",
            runId: "run-file-change",
            kind: "log",
            label: "Recovery artifact",
            mimeType: "application/json",
            createdAt,
            payload: {
              id: "run-file-change:recovery:1",
              runId: "run-file-change",
              errorType: "tool_error",
              decision: "fallback_artifact",
              summary: "tool_error recovered with a degraded artifact.",
              createdAt,
            },
          },
        },
      }],
      artifacts: [
        {
          id: "run-file-change:file-change:0",
          runId: "run-file-change",
          kind: "file",
          label: "notes/project.md",
          mimeType: "text/markdown",
          createdAt,
          payload: {
            kind: "file_change",
            path: "notes/project.md",
            operation: "patch",
            beforeContent: "alpha\nold\nomega\n",
            afterContent: "alpha\nnew\nomega\n",
            additions: 1,
            deletions: 1,
            metadata: { sizeBytes: 16, replacements: 1, created: false },
          },
        },
        {
          id: "run-file-change:recovery:1",
          runId: "run-file-change",
          kind: "log",
          label: "Recovery artifact",
          mimeType: "application/json",
          createdAt,
          payload: {
            id: "run-file-change:recovery:1",
            runId: "run-file-change",
            errorType: "tool_error",
            decision: "fallback_artifact",
            summary: "tool_error recovered with a degraded artifact.",
            createdAt,
          },
        },
      ],
      activeAgents: [],
      queueSummary: { mode: "dag", pending: 0, inProgress: 0, completed: 0, topics: [] },
      sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
      busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
      pendingClarifications: [],
      pendingApprovals: [],
      output: { text: "文档已更新。" },
      updatedAt: createdAt,
    } as unknown as OraStateSnapshot;

    const messages = adaptChatMessages(
      [{
        id: "run-file-change:user",
        sessionId: "session-file-change",
        runId: "run-file-change",
        turnIndex: 1,
        role: "user",
        content: "更新文档",
        pattern: "orchestrator_subagent",
        modeId: SINGLE_AGENT_MODE_ID,
        createdAt,
      }],
      { "run-file-change": snapshot },
    );
    const assistant = messages.find((message) => message.role === "assistant");

    expect(assistant?.turn?.artifacts[0]).toMatchObject({
      id: "run-file-change:file-change:0",
      label: "notes/project.md",
      kind: "file",
    });
    expect(assistant?.turn?.artifacts).toHaveLength(1);
    expect(assistant?.turn?.timelineItems).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "artifact",
          artifactId: "run-file-change:recovery:1",
        }),
      ]),
    );
    expect(assistant?.turn?.fileChanges).toEqual([
      expect.objectContaining({
        artifactId: "run-file-change:file-change:0",
        path: "notes/project.md",
        operation: "patch",
        additions: 1,
        deletions: 1,
        beforeContent: "alpha\nold\nomega\n",
        afterContent: "alpha\nnew\nomega\n",
      }),
    ]);
  });

  it("keeps exported artifacts visible as cards while hiding artifact exported timeline events", () => {
    const createdAt = 1_714_000_000_000;
    const snapshot = {
      runId: "run-exported-artifact",
      sessionId: "session-exported-artifact",
      turnIndex: 1,
      status: "succeeded",
      pattern: "orchestrator_subagent",
      modeId: SINGLE_AGENT_MODE_ID,
      input: { prompt: "更新文档", createdAt, context: {} },
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
        deterministicSeed: "view-model-exported-artifact-test",
        skillIds: [],
        toolIds: ["file.patch"],
      },
      topology: { nodes: [], edges: [] },
      profiles: [],
      memory: [],
      plan: [],
      todos: [],
      actions: [],
      toolCalls: [],
      policyDecisions: [],
      checkpoints: [],
      events: [{
        id: "run-exported-artifact:event:artifact-exported",
        runId: "run-exported-artifact",
        seq: 1,
        type: "artifact.exported",
        createdAt,
        payload: {
          artifact: {
            id: "run-exported-artifact:file-change:0",
            runId: "run-exported-artifact",
            kind: "file",
            label: "notes/project.md",
            mimeType: "text/markdown",
            createdAt,
            payload: {
              kind: "file_change",
              path: "notes/project.md",
              operation: "patch",
              beforeContent: "alpha\nold\nomega\n",
              afterContent: "alpha\nnew\nomega\n",
              additions: 1,
              deletions: 1,
              metadata: { sizeBytes: 16, replacements: 1, created: false },
            },
          },
        },
      }],
      artifacts: [
        {
          id: "run-exported-artifact:file-change:0",
          runId: "run-exported-artifact",
          kind: "file",
          label: "notes/project.md",
          mimeType: "text/markdown",
          createdAt,
          payload: {
            kind: "file_change",
            path: "notes/project.md",
            operation: "patch",
            beforeContent: "alpha\nold\nomega\n",
            afterContent: "alpha\nnew\nomega\n",
            additions: 1,
            deletions: 1,
            metadata: { sizeBytes: 16, replacements: 1, created: false },
          },
        },
      ],
      activeAgents: [],
      queueSummary: { mode: "dag", pending: 0, inProgress: 0, completed: 0, topics: [] },
      sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
      busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
      pendingClarifications: [],
      pendingApprovals: [],
      output: { text: "文档已更新。" },
      updatedAt: createdAt,
    } as unknown as OraStateSnapshot;

    const messages = adaptChatMessages(
      [{
        id: "run-exported-artifact:user",
        sessionId: "session-exported-artifact",
        runId: "run-exported-artifact",
        turnIndex: 1,
        role: "user",
        content: "更新文档",
        pattern: "orchestrator_subagent",
        modeId: SINGLE_AGENT_MODE_ID,
        createdAt,
      }],
      { "run-exported-artifact": snapshot },
    );
    const assistant = messages.find((message) => message.role === "assistant");

    expect(assistant?.turn?.artifacts).toEqual([
      expect.objectContaining({
        id: "run-exported-artifact:file-change:0",
        label: "notes/project.md",
        kind: "file",
      }),
    ]);
    expect(assistant?.turn?.fileChanges).toEqual([
      expect.objectContaining({
        artifactId: "run-exported-artifact:file-change:0",
        path: "notes/project.md",
        operation: "patch",
      }),
    ]);
    expect(assistant?.turn?.timelineItems).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "artifact",
          artifactId: "run-exported-artifact:file-change:0",
        }),
      ]),
    );
  });

  it("carries natural approval copy into action records", () => {
    const createdAt = 1_714_000_000_000;
    const session: OraSessionSummary = {
      sessionId: "session-approval",
      title: "Install skill",
      turnCount: 1,
      createdAt,
      updatedAt: createdAt,
      latestRunId: "run-approval",
    };
    const snapshot = {
      runId: "run-approval",
      sessionId: session.sessionId,
      turnIndex: 1,
      status: "interrupted",
      pattern: "orchestrator_subagent",
      modeId: SINGLE_AGENT_MODE_ID,
      input: { prompt: "请帮我安装 Waza 的 think skill。", createdAt, context: {} },
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
        deterministicSeed: "view-model-test",
        skillIds: [],
        toolIds: ["skills.create"],
      },
      topology: { nodes: [], edges: [] },
      profiles: [],
      memory: [],
      plan: [],
      todos: [],
      actions: [{
        id: "run-approval:action:solo_agent-tool-1",
        runId: "run-approval",
        type: "skills.create",
        riskLevel: "high",
        status: "approval_required",
        input: { name: "waza-think" },
        approvalRequest: {
          title: "需要你确认安装技能",
          summary: "我准备把 Waza 的 think 技能安装到 Ora 的本地技能库。",
          whatWillChange: "会新增一个本地技能条目。",
          whyNeeded: "这是完成你要求安装技能的必要步骤。",
          riskNote: "确认 GitHub 来源可信后再继续。",
          confirmLabel: "批准并继续",
        },
        artifactIds: [],
      }],
      toolCalls: [],
      policyDecisions: [],
      checkpoints: [],
      events: [],
      artifacts: [],
      activeAgents: [],
      queueSummary: { mode: "dag", pending: 0, inProgress: 0, completed: 0, topics: [] },
      sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
      busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
      pendingClarifications: [],
      pendingApprovals: ["run-approval:action:solo_agent-tool-1"],
      updatedAt: createdAt,
    } as unknown as OraStateSnapshot;
    const detail: OraSessionDetail = {
      session,
      turns: [],
      transcript: [],
      latestSnapshot: snapshot,
    };

    const viewModel = buildWorkbenchViewModel(
      MVP_PATTERNS,
      MVP_MODES,
      [session],
      detail,
      undefined,
      "orchestrator_subagent",
      SINGLE_AGENT_MODE_ID,
    );

    expect(viewModel.actions[0]?.approvalRequest?.title).toBe("需要你确认安装技能");
    expect(viewModel.actions[0]?.approvalRequest?.summary).not.toContain("skills.create");
    expect(viewModel.actions[0]?.approvalRequest?.summary).not.toContain("High-risk");
    expect(viewModel.actions[0]?.consequence).toBe("Please confirm this operation before I continue.");
    expect(viewModel.actions[0]?.consequence).not.toContain("operator");
  });

  it("shows approval copy instead of stale progress while approval is pending", () => {
    const createdAt = 1_714_000_000_000;
    const snapshot = {
      runId: "run-approval-transcript",
      sessionId: "session-approval-transcript",
      turnIndex: 1,
      status: "interrupted",
      pattern: "orchestrator_subagent",
      modeId: SINGLE_AGENT_MODE_ID,
      input: { prompt: "更新项目文档", createdAt, context: {} },
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
        deterministicSeed: "view-model-approval-transcript-test",
        skillIds: [],
        toolIds: ["file.write"],
      },
      topology: { nodes: [], edges: [] },
      profiles: [],
      memory: [],
      plan: [],
      todos: [],
      actions: [{
        id: "run-approval-transcript:action:solo_agent-tool-1",
        runId: "run-approval-transcript",
        type: "file.write",
        riskLevel: "high",
        status: "approval_required",
        input: { path: "10-Wiki/项目/西芒杜项目.md" },
        approvalRequest: {
          title: "需要你确认写入文件",
          summary: "我已经准备好把调研结果写入项目文档，批准后会继续执行本地写入。",
          whatWillChange: "会更新 10-Wiki/项目/西芒杜项目.md。",
          whyNeeded: "这是完成文档更新所需的本地文件写入步骤。",
          riskNote: "写入文件会改变你的项目内容。",
          confirmLabel: "批准并继续",
        },
        artifactIds: [],
      }],
      toolCalls: [],
      policyDecisions: [],
      checkpoints: [],
      events: [{
        id: "run-approval-transcript:evt-0",
        runId: "run-approval-transcript",
        seq: 0,
        type: "task.progress",
        createdAt,
        pattern: "orchestrator_subagent",
        payload: {
          kind: "chat_progress",
          source: "progress_narrator",
          trigger: "task.progress",
          summary: "正在读取力拓2026年Q1生产报告等公开资料，下一步将多维度分析西芒杜项目的工程、融资和合作进展。",
        },
      }],
      artifacts: [],
      activeAgents: [],
      queueSummary: { mode: "dag", pending: 0, inProgress: 0, completed: 0, topics: [] },
      sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
      busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
      pendingClarifications: [],
      pendingApprovals: ["run-approval-transcript:action:solo_agent-tool-1"],
      attention: {
        kind: "needs_approval",
        blocking: true,
        sourceRunId: "run-approval-transcript",
        reason: "approval_required",
        pendingActionIds: ["run-approval-transcript:action:solo_agent-tool-1"],
        pendingToolCallIds: [],
      },
      updatedAt: createdAt,
    } as unknown as OraStateSnapshot;

    const messages = adaptChatMessages(
      [
        {
          id: "run-approval-transcript:user",
          sessionId: "session-approval-transcript",
          runId: "run-approval-transcript",
          turnIndex: 1,
          role: "user",
          content: "更新项目文档",
          pattern: "orchestrator_subagent",
          modeId: SINGLE_AGENT_MODE_ID,
          createdAt,
        },
        {
          id: "run-approval-transcript:assistant",
          sessionId: "session-approval-transcript",
          runId: "run-approval-transcript",
          turnIndex: 1,
          role: "assistant",
          content: "文档已成功更新！以下是我完成的调研与更新总结：",
          pattern: "orchestrator_subagent",
          modeId: SINGLE_AGENT_MODE_ID,
          createdAt: createdAt + 1_000,
        },
      ],
      { "run-approval-transcript": snapshot },
    );
    const assistant = messages.find((message) => message.role === "assistant");

    expect(assistant?.content).toBe("我已经准备好把调研结果写入项目文档，批准后会继续执行本地写入。");
    expect(assistant?.content).not.toContain("正在读取力拓");
    expect(assistant?.content).not.toContain("文档已成功更新");
  });

  it("does not show approval copy from raw action state without projection attention", () => {
    const createdAt = 1_714_000_000_000;
    const snapshot = {
      runId: "run-raw-approval-copy",
      sessionId: "session-raw-approval-copy",
      turnIndex: 1,
      status: "interrupted",
      pattern: "orchestrator_subagent",
      modeId: SINGLE_AGENT_MODE_ID,
      input: { prompt: "更新项目文档", createdAt, context: {} },
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
        deterministicSeed: "view-model-raw-approval-copy-test",
        skillIds: [],
        toolIds: ["file.write"],
      },
      topology: { nodes: [], edges: [] },
      profiles: [],
      memory: [],
      plan: [],
      todos: [],
      actions: [{
        id: "run-raw-approval-copy:action:tool-1",
        runId: "run-raw-approval-copy",
        type: "file.write",
        riskLevel: "high",
        status: "approval_required",
        input: { path: "README.md" },
        approvalRequest: {
          title: "需要你确认写入文件",
          summary: "Raw approval summary should not become chat copy.",
          whatWillChange: "README.md",
          whyNeeded: "Test",
          riskNote: "Write",
          confirmLabel: "批准并继续",
        },
        artifactIds: [],
      }],
      toolCalls: [],
      policyDecisions: [],
      checkpoints: [],
      events: [],
      artifacts: [],
      activeAgents: [],
      queueSummary: { mode: "dag", pending: 0, inProgress: 0, completed: 0, topics: [] },
      sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
      busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
      pendingClarifications: [],
      pendingApprovals: ["run-raw-approval-copy:action:tool-1"],
      updatedAt: createdAt,
    } as unknown as OraStateSnapshot;

    const messages = adaptChatMessages(
      [
        {
          id: "run-raw-approval-copy:user",
          sessionId: "session-raw-approval-copy",
          runId: "run-raw-approval-copy",
          turnIndex: 1,
          role: "user",
          content: "更新项目文档",
          pattern: "orchestrator_subagent",
          modeId: SINGLE_AGENT_MODE_ID,
          createdAt,
        },
        {
          id: "run-raw-approval-copy:assistant",
          sessionId: "session-raw-approval-copy",
          runId: "run-raw-approval-copy",
          turnIndex: 1,
          role: "assistant",
          content: "正在等待后台状态同步。",
          pattern: "orchestrator_subagent",
          modeId: SINGLE_AGENT_MODE_ID,
          createdAt: createdAt + 1_000,
        },
      ],
      { "run-raw-approval-copy": snapshot },
    );
    const assistant = messages.find((message) => message.role === "assistant");

    expect(assistant?.content).toBe("");
    expect(assistant?.content).not.toContain("Raw approval summary");
  });

  it("adapts structured agent messages into assistant turn attachments", () => {
    const createdAt = 1_714_000_000_000;
    const snapshot = {
      runId: "run-team",
      sessionId: "session-team",
      turnIndex: 1,
      status: "succeeded",
      pattern: "agent_teams",
      modeId: "agent_teams",
      input: { prompt: "coordinate this", createdAt, context: {} },
      config: {
        modeId: "agent_teams",
        pattern: "agent_teams",
        modeSelection: "manual",
        profileIds: ["team_lead", "builder"],
        providerId: "local-smoke",
        modelRef: "local/smoke-model",
        approvalMode: "high_risk_only",
        patternOptions: {},
        metadata: {},
        deterministicSeed: "view-model-agent-message-test",
        skillIds: [],
        toolIds: [],
      },
      topology: { nodes: [], edges: [] },
      profiles: [
        {
          id: "team_lead",
          label: "Team Lead",
          role: "Coordinate workers.",
          modelRef: "local/smoke-model",
          toolPolicyId: "agent_teams.default_policy",
          memoryNamespaces: ["session"],
          budget: { maxTokens: 1000, maxToolCalls: 0, maxRuntimeMs: 1000 },
        },
        {
          id: "builder",
          label: "Builder",
          role: "Build assigned work.",
          modelRef: "local/smoke-model",
          toolPolicyId: "agent_teams.default_policy",
          memoryNamespaces: ["session"],
          budget: { maxTokens: 1000, maxToolCalls: 0, maxRuntimeMs: 1000 },
        },
      ],
      memory: [],
      plan: [],
      todos: [],
      actions: [],
      toolCalls: [],
      policyDecisions: [],
      checkpoints: [],
      events: [{
        id: "event-full-builder",
        runId: "run-team",
        seq: 1,
        type: "message.delta",
        createdAt,
        agentId: "team_lead",
        nodeId: "team_lead",
        payload: { role: "assistant", content: "Full team lead assignment with the ending preserved." },
      }],
      agentMessages: [{
        id: "run-team:agent-message:0",
        runId: "run-team",
        createdAt,
        fromAgentId: "team_lead",
        toAgentIds: ["builder"],
        threadId: "agent-teams:build",
        nodeId: "triage",
        planItemId: "triage",
        kind: "mention",
        status: "done",
        content: "@builder build this: Full team lead assignment...",
        artifactIds: [],
      }],
      artifacts: [],
      activeAgents: [],
      queueSummary: { mode: "backlog", pending: 0, inProgress: 0, completed: 1, topics: [] },
      sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
      busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
      pendingClarifications: [],
      pendingApprovals: [],
      output: { text: "done" },
      updatedAt: createdAt,
    } as unknown as OraStateSnapshot;

    const messages = adaptChatMessages(
      [{
        id: "run-team:user",
        sessionId: "session-team",
        runId: "run-team",
        turnIndex: 1,
        role: "user",
        content: "coordinate this",
        pattern: "agent_teams",
        modeId: "agent_teams",
        createdAt,
      }],
      { "run-team": snapshot },
    );
    const assistant = messages.find((message) => message.role === "assistant");

    expect(assistant?.turn?.agentMessages).toHaveLength(1);
    expect(assistant?.turn?.agentMessages[0]?.fromAgentLabel).toBe("Team Lead");
    expect(assistant?.turn?.agentMessages[0]?.toAgentLabels).toEqual(["Builder"]);
    expect(assistant?.turn?.agentMessages[0]?.content).toContain("Full team lead assignment with the ending preserved.");
    expect(assistant?.turn?.agentMessages[0]?.content.endsWith("...")).toBe(false);
    expect(assistant?.turn?.currentAgentLabel).toBe("Team Lead");
  });

  it("hides internal message bus publish and route messages from the assistant timeline", () => {
    const createdAt = 1_714_000_000_000;
    const snapshot = {
      runId: "run-message-bus-internal",
      sessionId: "session-message-bus-internal",
      turnIndex: 1,
      status: "succeeded",
      pattern: "message_bus",
      modeId: "message_bus",
      input: { prompt: "why is mode stuck?", createdAt, context: {} },
      config: {
        modeId: "message_bus",
        pattern: "message_bus",
        modeSelection: "manual",
        profileIds: ["router", "responder"],
        providerId: "local-smoke",
        modelRef: "local/smoke-model",
        approvalMode: "high_risk_only",
        patternOptions: {},
        metadata: {},
        deterministicSeed: "view-model-message-bus-internal-test",
        skillIds: [],
        toolIds: [],
      },
      topology: { nodes: [], edges: [] },
      profiles: [
        { id: "router", label: "Router", role: "Route", modelRef: "local/smoke-model", toolPolicyId: "message_bus.default_policy", memoryNamespaces: ["session"], budget: { maxTokens: 1000, maxToolCalls: 0, maxRuntimeMs: 1000 } },
        { id: "responder", label: "Responder", role: "Respond", modelRef: "local/smoke-model", toolPolicyId: "message_bus.default_policy", memoryNamespaces: ["session"], budget: { maxTokens: 1000, maxToolCalls: 0, maxRuntimeMs: 1000 } },
      ],
      memory: [],
      plan: [],
      todos: [],
      actions: [],
      toolCalls: [],
      policyDecisions: [],
      checkpoints: [],
      events: [],
      agentMessages: [
        {
          id: "run-message-bus-internal:agent-message:0",
          runId: "run-message-bus-internal",
          createdAt,
          fromAgentId: "router",
          toAgentIds: ["router"],
          threadId: "bus-1",
          kind: "publish",
          status: "done",
          content: "@router input event published on task.input:\n\nwhy is mode stuck?",
          artifactIds: [],
        },
        {
          id: "run-message-bus-internal:agent-message:1",
          runId: "run-message-bus-internal",
          createdAt: createdAt + 1,
          fromAgentId: "router",
          toAgentIds: ["responder"],
          threadId: "bus-1",
          kind: "route",
          status: "done",
          content: "@responder routed task.findings to you:\n\ninternal route details",
          artifactIds: [],
        },
        {
          id: "run-message-bus-internal:agent-message:2",
          runId: "run-message-bus-internal",
          createdAt: createdAt + 2,
          fromAgentId: "responder",
          toAgentIds: ["router"],
          threadId: "bus-1",
          kind: "reply",
          status: "done",
          content: "Visible answer.",
          artifactIds: [],
        },
      ],
      artifacts: [],
      activeAgents: [],
      queueSummary: { mode: "dag", pending: 0, inProgress: 0, completed: 1, topics: [] },
      sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
      busStats: { enabled: true, publishedCount: 1, routedCount: 1, topicCounts: { "task.input": 1 } },
      pendingClarifications: [],
      pendingApprovals: [],
      output: { text: "Visible answer." },
      updatedAt: createdAt + 2,
    } as unknown as OraStateSnapshot;

    const assistant = adaptChatMessages(
      [{
        id: "run-message-bus-internal:user",
        sessionId: "session-message-bus-internal",
        runId: "run-message-bus-internal",
        turnIndex: 1,
        role: "user",
        content: "why is mode stuck?",
        pattern: "message_bus",
        modeId: "message_bus",
        createdAt,
      }],
      { "run-message-bus-internal": snapshot },
    ).find((message) => message.role === "assistant");
    const timelineText = assistant?.turn?.timelineItems
      ?.map((item) => "content" in item ? item.content : "")
      .join("\n") ?? "";

    expect(timelineText).toContain("Visible answer.");
    expect(timelineText).not.toContain("@router input event published");
    expect(timelineText).not.toContain("routed task.findings");
    expect(assistant?.turn?.agentMessages.map((message) => message.kind)).toEqual(["reply"]);
    expect(assistant?.turn?.currentAgentLabel).toBe("Responder");
  });

  it("keeps assistant body text in the turn timeline before running work steps", () => {
    const createdAt = 1_714_000_000_000;
    const baseSnapshot = {
      runId: "run-live-body",
      sessionId: "session-live-body",
      turnIndex: 1,
      status: "running",
      pattern: "orchestrator_subagent",
      modeId: SINGLE_AGENT_MODE_ID,
      input: { prompt: "检查决策 UI", createdAt, context: {} },
      config: {
        modeId: SINGLE_AGENT_MODE_ID,
        pattern: "orchestrator_subagent",
        modeSelection: "manual",
        profileIds: ["orchestrator"],
        providerId: "local-smoke",
        modelRef: "local/smoke-model",
        approvalMode: "high_risk_only",
        patternOptions: {},
        metadata: {},
        deterministicSeed: "view-model-live-body-test",
        skillIds: [],
        toolIds: [],
      },
      topology: { nodes: [], edges: [] },
      profiles: [{
        id: "orchestrator",
        label: "Orchestrator",
        role: "Coordinate stages.",
        modelRef: "local/smoke-model",
        toolPolicyId: "orchestrator_subagent.default_policy",
        memoryNamespaces: ["session"],
        budget: { maxTokens: 1000, maxToolCalls: 0, maxRuntimeMs: 1000 },
      }],
      memory: [],
      plan: [],
      planList: [],
      todos: [],
      actions: [],
      toolCalls: [],
      policyDecisions: [],
      checkpoints: [],
      agentMessages: [],
      artifacts: [],
      activeAgents: [],
      queueSummary: { mode: "dag", pending: 0, inProgress: 1, completed: 0, topics: [] },
      sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
      busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
      pendingClarifications: [],
      pendingApprovals: [],
      updatedAt: createdAt + 2_000,
    };
    const firstEvents = [
      {
        id: "run-live-body:evt-0",
        runId: "run-live-body",
        seq: 0,
        type: "message.delta",
        createdAt,
        agentId: "orchestrator",
        nodeId: "orchestrator",
        payload: { role: "assistant", content: "我会先确认现有决策面板和输入框结构。" },
      },
      {
        id: "run-live-body:evt-1",
        runId: "run-live-body",
        seq: 1,
        type: "tool.called",
        createdAt: createdAt + 1_000,
        agentId: "orchestrator",
        nodeId: "orchestrator",
        payload: {
          toolId: "file.grep",
          status: "succeeded",
          input: { pattern: "PlanDecisionPanel" },
          output: { pattern: "PlanDecisionPanel", matches: 21 },
        },
      },
    ];
    const secondEvents = [
      ...firstEvents,
      {
        id: "run-live-body:evt-2",
        runId: "run-live-body",
        seq: 2,
        type: "tool.called",
        createdAt: createdAt + 2_000,
        agentId: "orchestrator",
        nodeId: "orchestrator",
        payload: {
          toolId: "file.read",
          status: "running",
          input: { path: "apps/desktop/src/components/PlanDecisionPanel.tsx" },
        },
      },
    ];
    const firstSnapshot = { ...baseSnapshot, events: firstEvents } as unknown as OraStateSnapshot;
    const secondSnapshot = { ...baseSnapshot, events: secondEvents } as unknown as OraStateSnapshot;

    const [firstAssistant] = adaptChatMessages(
      [{
        id: "run-live-body:user",
        sessionId: "session-live-body",
        runId: "run-live-body",
        turnIndex: 1,
        role: "user",
        content: "检查决策 UI",
        pattern: "orchestrator_subagent",
        modeId: SINGLE_AGENT_MODE_ID,
        createdAt,
      }],
      { "run-live-body": firstSnapshot },
    ).filter((message) => message.role === "assistant");
    const [secondAssistant] = adaptChatMessages(
      [{
        id: "run-live-body:user",
        sessionId: "session-live-body",
        runId: "run-live-body",
        turnIndex: 1,
        role: "user",
        content: "检查决策 UI",
        pattern: "orchestrator_subagent",
        modeId: SINGLE_AGENT_MODE_ID,
        createdAt,
      }],
      { "run-live-body": secondSnapshot },
    ).filter((message) => message.role === "assistant");

    const firstTimeline = firstAssistant?.turn?.timelineItems ?? [];
    const secondTimeline = secondAssistant?.turn?.timelineItems ?? [];
    const firstStatus = firstTimeline.find((item) => item.kind === "status_group");
    const secondStatus = secondTimeline.find((item) => item.kind === "status_group");

    expect(firstTimeline[0]).toMatchObject({
      kind: "assistant_text",
      content: "我会先确认现有决策面板和输入框结构。",
    });
    expect(firstStatus?.id).toBe(secondStatus?.id);
    expect(secondStatus?.summary).toBe("正在读取文件");
    expect(secondStatus?.summary).not.toContain("已探索");
  });

  it("uses the latest public mode agent as turn owner even when old root handoff content exists", () => {
    const createdAt = 1_714_000_000_000;
    const snapshot = {
      runId: "run-subagent-owner",
      sessionId: "session-subagent-owner",
      turnIndex: 1,
      status: "running",
      pattern: "orchestrator_subagent",
      modeId: DEERFLOW_HARNESS_MODE_ID,
      input: { prompt: "coordinate subagents", createdAt, context: {} },
      config: {
        modeId: DEERFLOW_HARNESS_MODE_ID,
        pattern: "orchestrator_subagent",
        modeSelection: "manual",
        profileIds: ["orchestrator", "researcher", "reviewer"],
        providerId: "local-smoke",
        modelRef: "local/smoke-model",
        approvalMode: "high_risk_only",
        patternOptions: {},
        metadata: {},
        deterministicSeed: "view-model-subagent-owner-test",
        skillIds: [],
        toolIds: [],
      },
      topology: { nodes: [], edges: [] },
      profiles: [
        {
          id: ORA_ROOT_AGENT_ID,
          label: ORA_ROOT_AGENT_LABEL,
          role: "Root conversation agent.",
          modelRef: "local/smoke-model",
          toolPolicyId: "root.default_policy",
          memoryNamespaces: ["session"],
          budget: { maxTokens: 1000, maxToolCalls: 0, maxRuntimeMs: 1000 },
        },
        {
          id: "orchestrator",
          label: "Orchestrator",
          role: "Coordinate stages.",
          modelRef: "local/smoke-model",
          toolPolicyId: "orchestrator_subagent.default_policy",
          memoryNamespaces: ["session"],
          budget: { maxTokens: 1000, maxToolCalls: 0, maxRuntimeMs: 1000 },
        },
        {
          id: "researcher",
          label: "Researcher",
          role: "Research delegated context.",
          modelRef: "local/smoke-model",
          toolPolicyId: "orchestrator_subagent.default_policy",
          memoryNamespaces: ["session"],
          budget: { maxTokens: 1000, maxToolCalls: 0, maxRuntimeMs: 1000 },
        },
        {
          id: "reviewer",
          label: "Reviewer",
          role: "Review delegated findings.",
          modelRef: "local/smoke-model",
          toolPolicyId: "orchestrator_subagent.default_policy",
          memoryNamespaces: ["session"],
          budget: { maxTokens: 1000, maxToolCalls: 0, maxRuntimeMs: 1000 },
        },
      ],
      memory: [],
      plan: [],
      planList: [],
      todos: [],
      actions: [],
      toolCalls: [],
      policyDecisions: [],
      checkpoints: [],
      events: [
        {
          id: "run-subagent-owner:evt-0",
          runId: "run-subagent-owner",
          seq: 0,
          type: "message.delta",
          createdAt: createdAt + 1,
          agentId: "researcher",
          nodeId: "research",
          payload: { role: "assistant", content: "Researcher is checking the relevant files." },
        },
        {
          id: "run-subagent-owner:evt-1",
          runId: "run-subagent-owner",
          seq: 1,
          type: "message.delta",
          createdAt: createdAt + 2,
          agentId: "reviewer",
          nodeId: "review",
          payload: { role: "assistant", content: "Reviewer is validating the findings." },
        },
      ],
      agentMessages: [{
        id: "run-subagent-owner:agent-message:0",
        runId: "run-subagent-owner",
        createdAt,
        fromAgentId: ORA_ROOT_AGENT_ID,
        toAgentIds: ["orchestrator"],
        threadId: "run-subagent-owner:ora-handoff",
        nodeId: ORA_ROOT_AGENT_ID,
        kind: "handoff",
        status: "done",
        content: "接下来交给 Orchestrator。",
        artifactIds: [],
      }],
      artifacts: [],
      activeAgents: [],
      queueSummary: { mode: "dag", pending: 0, inProgress: 1, completed: 0, topics: [] },
      sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
      busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
      pendingClarifications: [],
      pendingApprovals: [],
      updatedAt: createdAt + 2,
    } as unknown as OraStateSnapshot;

    const messages = adaptChatMessages(
      [{
        id: "run-subagent-owner:user",
        sessionId: "session-subagent-owner",
        runId: "run-subagent-owner",
        turnIndex: 1,
        role: "user",
        content: "coordinate subagents",
        pattern: "orchestrator_subagent",
        modeId: DEERFLOW_HARNESS_MODE_ID,
        createdAt,
      }],
      { "run-subagent-owner": snapshot },
    );
    const assistant = messages.find((message) => message.role === "assistant");
    const timelineText = assistant?.turn?.timelineItems
      ?.flatMap((item) => "content" in item ? [item.content] : [])
      .join("\n");

    expect(assistant?.turn?.currentAgentLabel).toBe("Reviewer");
    expect(timelineText).toContain("Researcher is checking the relevant files.");
    expect(timelineText).toContain("Reviewer is validating the findings.");
    expect(timelineText).toContain("接下来交给 Orchestrator。");
  });

  it("uses the public assistant delta agent as the turn owner without a root handoff", () => {
    const createdAt = 1_714_000_000_000;
    const snapshot = {
      runId: "run-primary-owner",
      sessionId: "session-primary-owner",
      turnIndex: 1,
      status: "running",
      pattern: "orchestrator_subagent",
      modeId: DEERFLOW_HARNESS_MODE_ID,
      input: { prompt: "coordinate subagents", createdAt, context: {} },
      config: {
        modeId: DEERFLOW_HARNESS_MODE_ID,
        pattern: "orchestrator_subagent",
        modeSelection: "manual",
        profileIds: ["orchestrator", "researcher"],
        providerId: "local-smoke",
        modelRef: "local/smoke-model",
        approvalMode: "high_risk_only",
        patternOptions: {},
        metadata: {},
        deterministicSeed: "view-model-primary-owner-test",
        skillIds: [],
        toolIds: [],
      },
      topology: { nodes: [], edges: [] },
      profiles: [
        {
          id: "orchestrator",
          label: "Orchestrator",
          role: "Coordinate stages.",
          modelRef: "local/smoke-model",
          toolPolicyId: "orchestrator_subagent.default_policy",
          memoryNamespaces: ["session"],
          budget: { maxTokens: 1000, maxToolCalls: 0, maxRuntimeMs: 1000 },
        },
        {
          id: "researcher",
          label: "Researcher",
          role: "Research delegated context.",
          modelRef: "local/smoke-model",
          toolPolicyId: "orchestrator_subagent.default_policy",
          memoryNamespaces: ["session"],
          budget: { maxTokens: 1000, maxToolCalls: 0, maxRuntimeMs: 1000 },
        },
      ],
      memory: [],
      plan: [],
      planList: [],
      todos: [],
      actions: [],
      toolCalls: [],
      policyDecisions: [],
      checkpoints: [],
      events: [{
        id: "run-primary-owner:evt-0",
        runId: "run-primary-owner",
        seq: 0,
        type: "message.delta",
        createdAt,
        agentId: "researcher",
        nodeId: "research",
        payload: { role: "assistant", content: "Researcher is reading delegated files." },
      }],
      agentMessages: [],
      artifacts: [],
      activeAgents: [],
      queueSummary: { mode: "dag", pending: 0, inProgress: 1, completed: 0, topics: [] },
      sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
      busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
      pendingClarifications: [],
      pendingApprovals: [],
      updatedAt: createdAt,
    } as unknown as OraStateSnapshot;

    const assistant = adaptChatMessages(
      [{
        id: "run-primary-owner:user",
        sessionId: "session-primary-owner",
        runId: "run-primary-owner",
        turnIndex: 1,
        role: "user",
        content: "coordinate subagents",
        pattern: "orchestrator_subagent",
        modeId: DEERFLOW_HARNESS_MODE_ID,
        createdAt,
      }],
      { "run-primary-owner": snapshot },
    ).find((message) => message.role === "assistant");

    expect(assistant?.turn?.currentAgentLabel).toBe("Researcher");
    expect(assistant?.turn?.timelineItems?.[0]).toMatchObject({
      kind: "assistant_text",
      content: "Researcher is reading delegated files.",
    });
  });

  it("keeps root handoff, final intro, and the plan card separate for completed handoff plan output", () => {
    const createdAt = 1_714_000_000_000;
    const planOutput = [
      "根据您的需求，我分析了侧边栏对 `cancelled` 会话的状态显示逻辑，并制定了修改方案。",
      "",
      "<proposed_plan>",
      "## 背景",
      "当前 Ora 侧边栏中，cancelled 会显示状态徽章。",
      "",
      "## 实施步骤",
      "1. 修改 Sidebar.tsx 中 SessionStatusBadge 的 cancelled 分支。",
      "2. 验证 cancelled 和 done 一样不显示状态。",
      "</proposed_plan>",
    ].join("\n");
    const snapshot = {
      runId: "run-code-handoff-output",
      sessionId: "session-code-handoff-output",
      turnIndex: 1,
      status: "succeeded",
      pattern: "agent_teams",
      modeId: CODE_DEVELOPMENT_MODE_ID,
      input: { prompt: "fix the sidebar status", createdAt, context: {} },
      config: {
        modeId: CODE_DEVELOPMENT_MODE_ID,
        pattern: "agent_teams",
        modeSelection: "manual",
        profileIds: ["orchestrator"],
        providerId: "local-smoke",
        modelRef: "local/smoke-model",
        approvalMode: "high_risk_only",
        patternOptions: {},
        metadata: {},
        deterministicSeed: "view-model-handoff-output-test",
        skillIds: [],
        toolIds: [],
      },
      topology: { nodes: [], edges: [] },
      profiles: [
        { id: ORA_ROOT_AGENT_ID, label: ORA_ROOT_AGENT_LABEL },
        { id: "orchestrator", label: "Orchestrator" },
      ],
      memory: [],
      plan: [],
      planList: [],
      todos: [],
      actions: [],
      toolCalls: [],
      policyDecisions: [],
      checkpoints: [],
      events: [
        {
          id: "run-code-handoff-output:evt-0",
          runId: "run-code-handoff-output",
          seq: 0,
          type: "tool.called",
          createdAt: createdAt + 1,
          agentId: "orchestrator",
          nodeId: "orchestrator",
          payload: {
            toolId: "file.grep",
            status: "succeeded",
            input: { pattern: "cancelled", include: "**/*.ts" },
            output: { matches: new Array(3).fill({}) },
          },
        },
        {
          id: "run-code-handoff-output:evt-1",
          runId: "run-code-handoff-output",
          seq: 1,
          type: "completion.updated",
          createdAt: createdAt + 2,
          payload: {
            state: "force_final",
            reason: "tool_budget_exhausted",
          },
        },
        {
          id: "run-code-handoff-output:evt-2",
          runId: "run-code-handoff-output",
          seq: 2,
          type: "message.delta",
          createdAt: createdAt + 3,
          agentId: "orchestrator",
          nodeId: "orchestrator",
          payload: { role: "assistant", content: planOutput },
        },
      ],
      agentMessages: [
        {
          id: "run-code-handoff-output:agent-message:0",
          runId: "run-code-handoff-output",
          createdAt,
          fromAgentId: ORA_ROOT_AGENT_ID,
          toAgentIds: ["orchestrator"],
          threadId: "run-code-handoff-output:ora-handoff",
          nodeId: ORA_ROOT_AGENT_ID,
          kind: "handoff",
          status: "done",
          content: "接下来交给 Orchestrator。",
          artifactIds: [],
        },
        {
          id: "run-code-handoff-output:agent-message:1",
          runId: "run-code-handoff-output",
          createdAt: createdAt + 4,
          fromAgentId: "orchestrator",
          toAgentIds: [ORA_ROOT_AGENT_ID],
          replyToId: "run-code-handoff-output:agent-message:0",
          threadId: "run-code-handoff-output:ora-handoff",
          nodeId: "orchestrator",
          kind: "reply",
          status: "done",
          content: "Orchestrator 已将处理结果交回 Ora。",
          artifactIds: [],
        },
      ],
      artifacts: [],
      activeAgents: [],
      queueSummary: { mode: "dag", pending: 0, inProgress: 0, completed: 1, topics: [] },
      sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
      busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
      pendingClarifications: [],
      pendingApprovals: [],
      output: { text: planOutput, ora: { agentId: ORA_ROOT_AGENT_ID } },
      updatedAt: createdAt + 5,
    } as unknown as OraStateSnapshot;

    const assistant = adaptChatMessages(
      [{
        id: "run-code-handoff-output:user",
        sessionId: "session-code-handoff-output",
        runId: "run-code-handoff-output",
        turnIndex: 1,
        role: "user",
        content: "fix the sidebar status",
        pattern: "agent_teams",
        modeId: CODE_DEVELOPMENT_MODE_ID,
        createdAt,
      }],
      { "run-code-handoff-output": snapshot },
    ).find((message) => message.role === "assistant");
    const timeline = assistant?.turn?.timelineItems ?? [];
    const timelineText = timeline
      .flatMap((item) => "content" in item ? [item.content] : [])
      .join("\n");

    expect(assistant?.turn?.currentAgentLabel).toBe("Orchestrator");
    expect(assistant?.turn?.hasProposedPlan).toBe(true);
    expect(assistant?.content).toContain("## 背景");
    expect(assistant?.content).toContain("## 实施步骤");
    expect(assistant?.content).not.toContain("<proposed_plan>");
    expect(timelineText).toContain("接下来交给 Orchestrator。");
    expect(timelineText).toContain("Orchestrator 已将处理结果交回 Ora。");
    expect(timelineText).toContain("根据您的需求，我分析了侧边栏");
    expect(timelineText).not.toContain("## 背景");
    expect(timelineText).not.toContain("## 实施步骤");
    expect(timelineText).not.toContain("修改内容");
    expect(timeline).toContainEqual(expect.objectContaining({
      kind: "status_group",
      agentLabel: "Orchestrator",
      summary: expect.stringContaining("已探索 1 个文件"),
    }));
    const completionGroup = timeline.find((item) =>
      item.kind === "status_group" &&
      item.agentLabel === "Orchestrator" &&
      item.steps.some((step) => step.eventType === "completion.updated")
    );
    expect(completionGroup).toMatchObject({
      kind: "status_group",
      summary: expect.stringContaining("工具预算已用完，正在整理最终回答。"),
    });
    expect(completionGroup && "steps" in completionGroup
      ? completionGroup.steps[0]?.label
      : undefined).toBe("进入最终回答");
    expect(completionGroup && "steps" in completionGroup
      ? completionGroup.steps[0]?.detail
      : undefined).not.toContain("已停止工具调用");
    expect(timeline).toContainEqual(expect.objectContaining({
      kind: "assistant_text",
      agentLabel: ORA_ROOT_AGENT_LABEL,
      content: expect.stringContaining("根据您的需求，我分析了侧边栏"),
    }));
    expect(timeline.some((item) => item.kind === "final_text")).toBe(false);
  });

  it("preserves stage transcript metadata on assistant turns", () => {
    const createdAt = 1_714_000_000_000;
    const snapshot = {
      runId: "run-debate",
      sessionId: "session-debate",
      turnIndex: 1,
      status: "succeeded",
      pattern: "orchestrator_subagent",
      modeId: DEBATE_MODE_ID,
      input: { prompt: "debate this", createdAt, context: {} },
      config: {
        modeId: DEBATE_MODE_ID,
        pattern: "orchestrator_subagent",
        modeSelection: "manual",
        profileIds: ["moderator", "debate_agent"],
        modelRef: "local/smoke-model",
        approvalMode: "high_risk_only",
        patternOptions: {},
        metadata: {},
        deterministicSeed: "view-model-debate-test",
        skillIds: [],
        toolIds: [],
      },
      topology: { nodes: [], edges: [] },
      profiles: [
        {
          id: "moderator",
          label: "Moderator",
          role: "Synthesize.",
          modelRef: "local/smoke-model",
          toolPolicyId: "orchestrator_subagent.default_policy",
          memoryNamespaces: ["session"],
          budget: { maxTokens: 1000, maxToolCalls: 0, maxRuntimeMs: 1000 },
        },
        {
          id: "debate_agent",
          label: "Debate Agent",
          role: "Argue both sides.",
          modelRef: "local/smoke-model",
          toolPolicyId: "orchestrator_subagent.default_policy",
          memoryNamespaces: ["session"],
          budget: { maxTokens: 1000, maxToolCalls: 0, maxRuntimeMs: 1000 },
        },
      ],
      memory: [],
      plan: [],
      todos: [],
      actions: [],
      toolCalls: [],
      policyDecisions: [],
      checkpoints: [],
      events: [],
      agentMessages: [
        {
          id: "run-debate:agent-message:0",
          runId: "run-debate",
          createdAt: createdAt + 1,
          fromAgentId: "debate_agent",
          toAgentIds: ["moderator"],
          threadId: "run-debate:debate",
          nodeId: "debate",
          kind: "reply",
          status: "done",
          content: "Affirmative opening.",
          artifactIds: [],
          transcript: {
            kind: "stage_transcript",
            groupId: "debate",
            groupLabel: "结构化辩论",
            stageId: "affirmative-lead-opening",
            stageLabel: "开篇立论",
            sequence: 0,
            speakerLabel: "正方主辩",
            speakerId: "affirmative_lead",
            stance: "affirmative",
            status: "done",
          },
        },
        {
          id: "run-debate:agent-message:1",
          runId: "run-debate",
          createdAt: createdAt + 2,
          fromAgentId: "debate_agent",
          toAgentIds: ["moderator"],
          threadId: "run-debate:debate",
          nodeId: "debate",
          kind: "reply",
          status: "done",
          content: "Negative opening.",
          artifactIds: [],
          transcript: {
            kind: "stage_transcript",
            groupId: "debate",
            groupLabel: "结构化辩论",
            stageId: "negative-lead-opening",
            stageLabel: "开篇立论",
            sequence: 1,
            speakerLabel: "反方主辩",
            speakerId: "negative_lead",
            stance: "negative",
            status: "done",
          },
        },
      ],
      artifacts: [],
      activeAgents: [],
      queueSummary: { mode: "dag", pending: 0, inProgress: 0, completed: 1, topics: [] },
      sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
      busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
      pendingClarifications: [],
      pendingApprovals: [],
      output: { text: "Moderator synthesis." },
      updatedAt: createdAt + 3,
    } as unknown as OraStateSnapshot;

    const eventOnlySnapshot = mergeStateSnapshot(undefined, {
      ...snapshot,
      agentMessages: [],
      events: snapshot.agentMessages.map((message, index) => ({
        id: `run-debate:evt-${index}`,
        runId: "run-debate",
        seq: index,
        type: "agent.message",
        createdAt: message.createdAt,
        pattern: "orchestrator_subagent",
        agentId: message.fromAgentId,
        nodeId: message.nodeId ?? message.fromAgentId,
        payload: { message },
      })),
    } as unknown as OraStateSnapshot);

    const messages = adaptChatMessages(
      [{
        id: "run-debate:user",
        sessionId: "session-debate",
        runId: "run-debate",
        turnIndex: 1,
        role: "user",
        content: "debate this",
        pattern: "orchestrator_subagent",
        modeId: DEBATE_MODE_ID,
        createdAt,
      }],
      { "run-debate": eventOnlySnapshot },
    );
    const assistant = messages.find((message) => message.role === "assistant");

    expect(assistant?.turn?.agentMessages.map((message) => message.transcript?.speakerLabel)).toEqual(["正方主辩", "反方主辩"]);
    expect(new Set(assistant?.turn?.agentMessages.map((message) => message.fromAgentId))).toEqual(new Set(["debate_agent"]));
  });

  it("routes transcript turns through the timeline surface and suppresses duplicate body output", () => {
    const createdAt = 1_714_000_000_000;
    const finalVerdict = "最终裁决：采用方案A。";
    const snapshot = {
      runId: "run-transcript-primary",
      sessionId: "session-transcript-primary",
      turnIndex: 1,
      status: "succeeded",
      pattern: "orchestrator_subagent",
      modeId: DEBATE_MODE_ID,
      input: { prompt: "debate this", createdAt, context: {} },
      config: {
        modeId: DEBATE_MODE_ID,
        pattern: "orchestrator_subagent",
        modeSelection: "manual",
        profileIds: ["moderator", "debate_agent"],
        modelRef: "local/smoke-model",
        approvalMode: "high_risk_only",
        patternOptions: {},
        metadata: {},
        deterministicSeed: "view-model-transcript-primary-surface-test",
        skillIds: [],
        toolIds: [],
      },
      topology: { nodes: [], edges: [] },
      profiles: [
        {
          id: "moderator",
          label: "Moderator",
          role: "Synthesize.",
          modelRef: "local/smoke-model",
          toolPolicyId: "orchestrator_subagent.default_policy",
          memoryNamespaces: ["session"],
          budget: { maxTokens: 1000, maxToolCalls: 0, maxRuntimeMs: 1000 },
        },
        {
          id: "debate_agent",
          label: "Debate Agent",
          role: "Argue both sides.",
          modelRef: "local/smoke-model",
          toolPolicyId: "orchestrator_subagent.default_policy",
          memoryNamespaces: ["session"],
          budget: { maxTokens: 1000, maxToolCalls: 0, maxRuntimeMs: 1000 },
        },
      ],
      memory: [],
      plan: [],
      todos: [],
      actions: [],
      toolCalls: [],
      policyDecisions: [],
      checkpoints: [],
      events: [],
      agentMessages: [
        {
          id: "run-transcript-primary:agent-message:0",
          runId: "run-transcript-primary",
          createdAt: createdAt + 1,
          fromAgentId: "moderator",
          toAgentIds: ["debate_agent"],
          threadId: "run-transcript-primary:debate",
          nodeId: "synthesis",
          kind: "reply",
          status: "done",
          content: finalVerdict,
          artifactIds: [],
          transcript: {
            kind: "stage_transcript",
            groupId: "debate",
            groupLabel: "结构化辩论",
            stageId: "moderator-synthesis",
            stageLabel: "主持总结",
            sequence: 0,
            speakerLabel: "主持人总结",
            speakerId: "moderator",
            stance: "moderator",
            status: "done",
            layout: {
              style: "two_sided_duel",
              groupId: "debate",
              groupLabel: "结构化辩论",
              summaryStageIds: ["moderator-synthesis"],
              ownsFinalAnswer: true,
              supplementalBody: "never",
            },
          },
        },
      ],
      artifacts: [],
      activeAgents: [],
      queueSummary: { mode: "dag", pending: 0, inProgress: 0, completed: 1, topics: [] },
      sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
      busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
      pendingClarifications: [],
      pendingApprovals: [],
      output: { text: finalVerdict },
      updatedAt: createdAt + 2,
    } as unknown as OraStateSnapshot;

    const assistant = adaptChatMessages(
      [{
        id: "run-transcript-primary:user",
        sessionId: "session-transcript-primary",
        runId: "run-transcript-primary",
        turnIndex: 1,
        role: "user",
        content: "debate this",
        pattern: "orchestrator_subagent",
        modeId: DEBATE_MODE_ID,
        createdAt,
      }],
      { "run-transcript-primary": snapshot },
    ).find((message) => message.role === "assistant");

    expect(assistant?.turn?.presentation).toMatchObject({
      primarySurface: "timeline",
      showStandaloneBody: false,
    });
    expect(assistant?.turn?.timelineItems).toContainEqual(expect.objectContaining({
      kind: "agent_message",
      content: finalVerdict,
      fromAgentLabel: "Moderator",
    }));
  });

  it("recomputes snapshot-backed presentation from transcript fallback body when agent messages are not final-answer authority", () => {
    const createdAt = 1_714_000_000_000;
    const finalVerdict = "最终裁决：采用方案A。";
    const snapshot = {
      runId: "run-transcript-fallback-body",
      sessionId: "session-transcript-fallback-body",
      turnIndex: 1,
      status: "succeeded",
      pattern: "orchestrator_subagent",
      modeId: SINGLE_AGENT_MODE_ID,
      input: { prompt: "summarize this", createdAt, context: {} },
      config: {
        modeId: SINGLE_AGENT_MODE_ID,
        pattern: "orchestrator_subagent",
        modeSelection: "manual",
        profileIds: ["moderator", "debate_agent"],
        modelRef: "local/smoke-model",
        approvalMode: "high_risk_only",
        patternOptions: {},
        metadata: {},
        deterministicSeed: "view-model-transcript-fallback-body-test",
        skillIds: [],
        toolIds: [],
      },
      topology: { nodes: [], edges: [] },
      profiles: [
        {
          id: "moderator",
          label: "Moderator",
          role: "Synthesize.",
          modelRef: "local/smoke-model",
          toolPolicyId: "orchestrator_subagent.default_policy",
          memoryNamespaces: ["session"],
          budget: { maxTokens: 1000, maxToolCalls: 0, maxRuntimeMs: 1000 },
        },
        {
          id: "debate_agent",
          label: "Debate Agent",
          role: "Argue both sides.",
          modelRef: "local/smoke-model",
          toolPolicyId: "orchestrator_subagent.default_policy",
          memoryNamespaces: ["session"],
          budget: { maxTokens: 1000, maxToolCalls: 0, maxRuntimeMs: 1000 },
        },
      ],
      memory: [],
      plan: [],
      todos: [],
      actions: [],
      toolCalls: [],
      policyDecisions: [],
      checkpoints: [],
      events: [],
      agentMessages: [
        {
          id: "run-transcript-fallback-body:agent-message:0",
          runId: "run-transcript-fallback-body",
          createdAt: createdAt + 1,
          fromAgentId: "moderator",
          toAgentIds: ["debate_agent"],
          threadId: "run-transcript-fallback-body:debate",
          nodeId: "synthesis",
          kind: "reply",
          status: "done",
          content: finalVerdict,
          artifactIds: [],
        },
      ],
      artifacts: [],
      activeAgents: [],
      queueSummary: { mode: "dag", pending: 0, inProgress: 0, completed: 1, topics: [] },
      sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
      busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
      pendingClarifications: [],
      pendingApprovals: [],
      updatedAt: createdAt + 2,
    } as unknown as OraStateSnapshot;

    const assistant = adaptChatMessages(
      [{
        id: "run-transcript-fallback-body:user",
        sessionId: "session-transcript-fallback-body",
        runId: "run-transcript-fallback-body",
        turnIndex: 1,
        role: "user",
        content: "summarize this",
        pattern: "orchestrator_subagent",
        modeId: SINGLE_AGENT_MODE_ID,
        createdAt,
      }, {
        id: "run-transcript-fallback-body:assistant",
        sessionId: "session-transcript-fallback-body",
        runId: "run-transcript-fallback-body",
        turnIndex: 1,
        role: "assistant",
        content: finalVerdict,
        pattern: "orchestrator_subagent",
        modeId: SINGLE_AGENT_MODE_ID,
        createdAt: createdAt + 2,
      }],
      { "run-transcript-fallback-body": snapshot },
    ).find((message) => message.role === "assistant");

    expect(assistant?.content).toBe(finalVerdict);
    expect(assistant?.turn?.presentation).toMatchObject({
      primarySurface: "body",
      bodyContent: finalVerdict,
      showStandaloneBody: true,
    });
    expect(assistant?.turn?.presentation?.visibleTimelineItems).toEqual([]);
  });

  it("keeps transcript-owned final answers settled without a thinking indicator", () => {
    const createdAt = 1_714_000_000_000;
    const finalVerdict = "这是 fork 后也应保留的完整 assistant 正文。";
    const sourceSnapshot = {
      runId: "run-fork-transcript-owned",
      sessionId: "session-fork-transcript-owned",
      turnIndex: 1,
      status: "succeeded",
      pattern: "orchestrator_subagent",
      modeId: SINGLE_AGENT_MODE_ID,
      input: { prompt: "总结一下", createdAt, context: {} },
      config: {
        modeId: SINGLE_AGENT_MODE_ID,
        pattern: "orchestrator_subagent",
        modeSelection: "manual",
        profileIds: ["debate_agent"],
        providerId: "local-smoke",
        modelRef: "local/smoke-model",
        approvalMode: "high_risk_only",
        patternOptions: {},
        metadata: {},
        deterministicSeed: "view-model-fork-transcript-owned",
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
      events: [],
      agentMessages: [{
        id: "run-fork-transcript-owned:agent-message:0",
        runId: "run-fork-transcript-owned",
        createdAt: createdAt + 1,
        fromAgentId: "moderator",
        toAgentIds: [],
        threadId: "run-fork-transcript-owned:debate",
        kind: "reply",
        status: "done",
        content: finalVerdict,
        artifactIds: [],
        transcript: {
          kind: "stage_transcript",
          groupId: "debate",
          stageId: "moderator-synthesis",
          stageLabel: "主持总结",
          sequence: 0,
          speakerLabel: "主持人总结",
          status: "done",
          layout: {
            style: "two_sided_duel",
            ownsFinalAnswer: true,
            supplementalBody: "never",
          },
        },
      }],
      artifacts: [],
      activeAgents: [],
      queueSummary: { mode: "dag", pending: 0, inProgress: 0, completed: 1, topics: [] },
      sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
      busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
      pendingClarifications: [],
      pendingApprovals: [],
      output: { text: "摘要文本" },
      updatedAt: createdAt + 2,
    } as unknown as OraStateSnapshot;
    const snapshot = projectForkSettledSnapshot(
      sourceSnapshot,
      projectForkVisibleAssistantText(sourceSnapshot),
    );

    const assistant = adaptChatMessages(
      [{
        id: "run-fork-transcript-owned:user",
        sessionId: "session-fork-transcript-owned",
        runId: "run-fork-transcript-owned",
        turnIndex: 1,
        role: "user",
        content: "总结一下",
        pattern: "orchestrator_subagent",
        modeId: SINGLE_AGENT_MODE_ID,
        createdAt,
      }],
      { "run-fork-transcript-owned": snapshot },
    ).find((message) => message.role === "assistant");

    expect(assistant?.content).toBe(finalVerdict);
    expect(assistant?.turn?.status).toBe("done");
    expect(assistant?.turn?.activeLoadingTarget).toBeUndefined();
  });

  it("keeps orchestrator subagent handoff content out of the public chat timeline", () => {
    const createdAt = 1_714_000_000_000;
    const snapshot = {
      runId: "run-orchestrator-subagent",
      sessionId: "session-orchestrator-subagent",
      turnIndex: 1,
      status: "running",
      pattern: "orchestrator_subagent",
      modeId: DEERFLOW_HARNESS_MODE_ID,
      input: { prompt: "coordinate subagents", createdAt, context: {} },
      config: {
        modeId: DEERFLOW_HARNESS_MODE_ID,
        pattern: "orchestrator_subagent",
        modeSelection: "manual",
        profileIds: ["orchestrator", "researcher", "reviewer"],
        providerId: "local-smoke",
        modelRef: "local/smoke-model",
        approvalMode: "high_risk_only",
        patternOptions: {},
        metadata: { progressNarration: true },
        deterministicSeed: "view-model-orchestrator-subagent-agent-message-test",
        skillIds: [],
        toolIds: [],
      },
      topology: { nodes: [], edges: [] },
      profiles: [
        {
          id: ORA_ROOT_AGENT_ID,
          label: ORA_ROOT_AGENT_LABEL,
          role: "Root conversation agent.",
          modelRef: "local/smoke-model",
          toolPolicyId: "root.default_policy",
          memoryNamespaces: ["session"],
          budget: { maxTokens: 1000, maxToolCalls: 0, maxRuntimeMs: 1000 },
        },
        {
          id: "orchestrator",
          label: "Orchestrator",
          role: "Coordinate stages.",
          modelRef: "local/smoke-model",
          toolPolicyId: "orchestrator_subagent.default_policy",
          memoryNamespaces: ["session"],
          budget: { maxTokens: 1000, maxToolCalls: 0, maxRuntimeMs: 1000 },
        },
      ],
      memory: [],
      plan: [],
      todos: [],
      actions: [],
      toolCalls: [],
      policyDecisions: [],
      checkpoints: [],
      events: [{
        id: "run-orchestrator-subagent:evt-0",
        runId: "run-orchestrator-subagent",
        seq: 0,
        type: "task.progress",
        createdAt,
        pattern: "orchestrator_subagent",
        payload: {
          kind: "chat_progress",
          source: "progress_narrator",
          trigger: "task.progress",
          summary: "正在协调子智能体。",
        },
      }, {
        id: "run-orchestrator-subagent:evt-1",
        runId: "run-orchestrator-subagent",
        seq: 1,
        type: "tool.called",
        agentId: "ora-sub-1",
        createdAt: createdAt + 1,
        pattern: "orchestrator_subagent",
        payload: {
          toolId: "file.read",
          status: "succeeded",
          input: { path: "apps/desktop/src/components/ChatInput.tsx" },
          output: { path: "apps/desktop/src/components/ChatInput.tsx", sizeBytes: 128 },
        },
      }, {
        id: "run-orchestrator-subagent:evt-2",
        runId: "run-orchestrator-subagent",
        seq: 2,
        type: "message.delta",
        agentId: "ora-sub-1",
        createdAt: createdAt + 2,
        pattern: "orchestrator_subagent",
        payload: {
          messageId: "run-orchestrator-subagent:child-msg",
          content: "Research subagent 正在读取相关文件。",
        },
      }],
      agentMessages: [
        {
          id: "run-orchestrator-subagent:agent-message:0",
          runId: "run-orchestrator-subagent",
          createdAt,
          fromAgentId: ORA_ROOT_AGENT_ID,
          toAgentIds: ["orchestrator"],
          threadId: "run-orchestrator-subagent:ora-handoff",
          nodeId: ORA_ROOT_AGENT_ID,
          kind: "handoff",
          status: "done",
          content: `${ORA_ROOT_AGENT_LABEL} is handing this request to orchestrator.`,
          artifactIds: [],
        },
        {
          id: "run-orchestrator-subagent:agent-message:1",
          runId: "run-orchestrator-subagent",
          createdAt: createdAt + 1,
          fromAgentId: ORA_ROOT_AGENT_ID,
          toAgentIds: [],
          threadId: "run-orchestrator-subagent:ora-observer",
          nodeId: ORA_ROOT_AGENT_ID,
          kind: "status",
          status: "done",
          content: `${ORA_ROOT_AGENT_LABEL} observed the handoff.`,
          artifactIds: [],
        },
        {
          id: "run-orchestrator-subagent:agent-message:2",
          runId: "run-orchestrator-subagent",
          createdAt: createdAt + 2,
          fromAgentId: "orchestrator",
          toAgentIds: [ORA_ROOT_AGENT_ID],
          replyToId: "run-orchestrator-subagent:agent-message:0",
          threadId: "run-orchestrator-subagent:ora-handoff",
          nodeId: "orchestrator",
          kind: "reply",
          status: "done",
          content: "Orchestrator returned its mode output to Ora.",
          artifactIds: [],
        },
      ],
      childSessions: [{
        id: "run-orchestrator-subagent:ora-sub-1",
        agentId: "ora-sub-1",
        label: "Research subagent",
        sessionClass: "temporary_spawn",
        status: "running",
        startedAt: createdAt,
        updatedAt: createdAt + 2,
        artifactIds: [],
      }],
      artifacts: [],
      activeAgents: [],
      queueSummary: { mode: "dag", pending: 0, inProgress: 1, completed: 0, topics: [] },
      sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
      busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
      pendingClarifications: [],
      pendingApprovals: [],
      updatedAt: createdAt + 2,
    } as unknown as OraStateSnapshot;

    const messages = adaptChatMessages(
      [{
        id: "run-orchestrator-subagent:user",
        sessionId: "session-orchestrator-subagent",
        runId: "run-orchestrator-subagent",
        turnIndex: 1,
        role: "user",
        content: "coordinate subagents",
        pattern: "orchestrator_subagent",
        modeId: DEERFLOW_HARNESS_MODE_ID,
        createdAt,
      }],
      { "run-orchestrator-subagent": snapshot },
    );
    const assistant = messages.find((message) => message.role === "assistant");

    expect(assistant?.turn?.currentAgentLabel).toBe("Orchestrator");
    expect(assistant?.turn?.agentMessages).toEqual([]);
    const agentTimelineItems = assistant?.turn?.timelineItems?.filter((item) => item.kind === "agent_message") ?? [];
    expect(agentTimelineItems).toEqual([]);
    const timelineText = assistant?.turn?.timelineItems
      ?.flatMap((item) => "content" in item ? [item.content] : "summary" in item ? [item.summary] : [])
      .join("\n") ?? "";
    expect(timelineText).not.toContain("Research subagent");
    expect(timelineText).not.toContain("ChatInput.tsx");
    const handoffSteps = assistant?.turn?.processSteps?.filter((step) => step.eventType === "agent.handoff") ?? [];
    expect(handoffSteps).toEqual([]);
    expect(assistant?.turn?.processSteps?.some((step) =>
      step.eventType === "tool.called" && step.contextLabel === "apps/desktop/src/components/ChatInput.tsx"
    )).toBe(false);
  });

  it("keeps mode-stage child session progress inside the parent assistant turn", () => {
    const createdAt = 1_714_000_000_000;
    const runId = "run-mode-stage-mainline";
    const sessionId = "session-mode-stage-mainline";
    const snapshot = {
      runId,
      sessionId,
      turnIndex: 1,
      status: "succeeded",
      pattern: "orchestrator_subagent",
      modeId: DEERFLOW_HARNESS_MODE_ID,
      input: { prompt: "fix the code", createdAt, context: {} },
      config: {
        modeId: DEERFLOW_HARNESS_MODE_ID,
        pattern: "orchestrator_subagent",
        modeSelection: "manual",
        profileIds: ["orchestrator", "builder", "reviewer"],
        providerId: "local-smoke",
        modelRef: "local/smoke-model",
        approvalMode: "high_risk_only",
        patternOptions: {},
        metadata: {},
        deterministicSeed: "view-model-mode-stage-mainline-test",
        skillIds: [],
        toolIds: [],
      },
      topology: { nodes: [], edges: [] },
      profiles: [
        { id: "orchestrator", label: "Orchestrator", role: "Coordinate", modelRef: "local/smoke-model", toolPolicyId: "code.default", memoryNamespaces: ["session"], budget: { maxTokens: 1000, maxToolCalls: 0, maxRuntimeMs: 1000 } },
        { id: "builder", label: "Builder", role: "Build", modelRef: "local/smoke-model", toolPolicyId: "code.default", memoryNamespaces: ["session"], budget: { maxTokens: 1000, maxToolCalls: 0, maxRuntimeMs: 1000 } },
        { id: "reviewer", label: "Reviewer", role: "Review", modelRef: "local/smoke-model", toolPolicyId: "code.default", memoryNamespaces: ["session"], budget: { maxTokens: 1000, maxToolCalls: 0, maxRuntimeMs: 1000 } },
      ],
      memory: [],
      plan: [],
      todos: [],
      actions: [],
      toolCalls: [],
      policyDecisions: [],
      checkpoints: [],
      events: [
        {
          id: `${runId}:evt-builder`,
          runId,
          seq: 1,
          type: "message.delta",
          agentId: "builder",
          createdAt: createdAt + 1,
          pattern: "orchestrator_subagent",
          payload: {
            role: "assistant",
            messageId: `${runId}:builder`,
            content: "Builder 已完成代码修改。",
            audience: "collaboration",
          },
        },
        {
          id: `${runId}:evt-reviewer`,
          runId,
          seq: 2,
          type: "message.delta",
          agentId: "reviewer",
          createdAt: createdAt + 2,
          pattern: "orchestrator_subagent",
          payload: {
            role: "assistant",
            messageId: `${runId}:reviewer`,
            content: "Reviewer 已完成代码审查。",
            audience: "collaboration",
          },
        },
      ],
      agentMessages: [
        {
          id: `${runId}:agent-message:builder`,
          runId,
          createdAt: createdAt + 1,
          fromAgentId: "builder",
          toAgentIds: ["reviewer"],
          threadId: "mode-stage:build",
          nodeId: "build",
          planItemId: "build",
          kind: "reply",
          status: "done",
          content: "接下来交给 Reviewer。\n\nBuilder 已完成代码修改。",
          artifactIds: [],
        },
        {
          id: `${runId}:agent-message:reviewer`,
          runId,
          createdAt: createdAt + 2,
          fromAgentId: "reviewer",
          toAgentIds: ["orchestrator"],
          threadId: "mode-stage:review",
          nodeId: "review",
          planItemId: "review",
          kind: "reply",
          status: "done",
          content: "接下来交给 Orchestrator。\n\nReviewer 已完成代码审查。",
          artifactIds: [],
        },
      ],
      childSessions: [
        {
          id: `${runId}:builder`,
          agentId: "builder",
          label: "Builder",
          sessionClass: "mode_subagent",
          delegationKind: "mode_stage",
          authoritySource: "mode_stage",
          status: "succeeded",
          startedAt: createdAt + 1,
          updatedAt: createdAt + 1,
          artifactIds: [],
          replayRef: { kind: "event_range", runId, fromSeq: 1, toSeq: 1 },
        },
        {
          id: `${runId}:reviewer`,
          agentId: "reviewer",
          label: "Reviewer",
          sessionClass: "mode_subagent",
          delegationKind: "mode_stage",
          authoritySource: "mode_stage",
          status: "succeeded",
          startedAt: createdAt + 2,
          updatedAt: createdAt + 2,
          artifactIds: [],
          replayRef: { kind: "event_range", runId, fromSeq: 2, toSeq: 2 },
        },
      ],
      artifacts: [],
      activeAgents: [],
      queueSummary: { mode: "dag", pending: 0, inProgress: 0, completed: 2, topics: [] },
      sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
      busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
      pendingClarifications: [],
      pendingApprovals: [],
      output: { text: "Orchestrator 已完成最终总结。" },
      updatedAt: createdAt + 3,
    } as unknown as OraStateSnapshot;

    const messages = adaptChatMessages(
      [{
        id: `${runId}:user`,
        sessionId,
        runId,
        turnIndex: 1,
        role: "user",
        content: "fix the code",
        pattern: "orchestrator_subagent",
        modeId: DEERFLOW_HARNESS_MODE_ID,
        createdAt,
      }],
      { [runId]: snapshot },
    );
    const assistantMessages = messages.filter((message) => message.role === "assistant");

    expect(assistantMessages).toHaveLength(1);
    expect(assistantMessages[0]?.content).toBe("Orchestrator 已完成最终总结。");
    expect(assistantMessages[0]?.turn?.currentAgentLabel).toBe("Orchestrator");
    expect(assistantMessages[0]?.metadata?.runId).toBe(runId);
    expect(assistantMessages[0]?.turn?.delegationActions).toEqual([
      expect.objectContaining({
        label: "Builder",
        status: "complete",
      }),
      expect.objectContaining({
        label: "Reviewer",
        status: "complete",
      }),
    ]);
  });

  it("suppresses the empty parent placeholder when mode-stage child messages already cover the in-progress turn", () => {
    const createdAt = 1_714_000_000_000;
    const runId = "run-mode-stage-placeholder";
    const sessionId = "session-mode-stage-placeholder";
    const snapshot = {
      runId,
      sessionId,
      turnIndex: 1,
      status: "running",
      pattern: "orchestrator_subagent",
      modeId: DEERFLOW_HARNESS_MODE_ID,
      input: { prompt: "continue", createdAt, context: {} },
      config: {
        modeId: DEERFLOW_HARNESS_MODE_ID,
        pattern: "orchestrator_subagent",
        modeSelection: "manual",
        profileIds: ["orchestrator", "builder"],
        providerId: "local-smoke",
        modelRef: "local/smoke-model",
        approvalMode: "high_risk_only",
        patternOptions: {},
        metadata: {},
        deterministicSeed: "view-model-mode-stage-placeholder-test",
        skillIds: [],
        toolIds: [],
      },
      topology: { nodes: [], edges: [] },
      profiles: [
        { id: "orchestrator", label: "Orchestrator", role: "Coordinate", modelRef: "local/smoke-model", toolPolicyId: "code.default", memoryNamespaces: ["session"], budget: { maxTokens: 1000, maxToolCalls: 0, maxRuntimeMs: 1000 } },
        { id: "builder", label: "Builder", role: "Build", modelRef: "local/smoke-model", toolPolicyId: "code.default", memoryNamespaces: ["session"], budget: { maxTokens: 1000, maxToolCalls: 0, maxRuntimeMs: 1000 } },
      ],
      memory: [],
      plan: [],
      todos: [],
      actions: [],
      toolCalls: [],
      policyDecisions: [],
      checkpoints: [],
      events: [{
        id: `${runId}:evt-builder`,
        runId,
        seq: 1,
        type: "message.delta",
        agentId: "builder",
        createdAt: createdAt + 1,
        pattern: "orchestrator_subagent",
        payload: {
          role: "assistant",
          messageId: `${runId}:builder`,
          content: "Builder 正在继续实现。",
          audience: "collaboration",
        },
      }],
      agentMessages: [],
      childSessions: [{
        id: `${runId}:builder`,
        agentId: "builder",
        label: "Builder",
        sessionClass: "mode_subagent",
        delegationKind: "mode_stage",
        authoritySource: "mode_stage",
        status: "running",
        startedAt: createdAt + 1,
        updatedAt: createdAt + 1,
        artifactIds: [],
        replayRef: { kind: "event_range", runId, fromSeq: 1, toSeq: 1 },
      }],
      artifacts: [],
      activeAgents: [],
      queueSummary: { mode: "dag", pending: 0, inProgress: 1, completed: 0, topics: [] },
      sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
      busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
      pendingClarifications: [],
      pendingApprovals: [],
      updatedAt: createdAt + 1,
    } as unknown as OraStateSnapshot;

    const assistantMessages = adaptChatMessages(
      [{
        id: `${runId}:user`,
        sessionId,
        runId,
        turnIndex: 1,
        role: "user",
        content: "continue",
        pattern: "orchestrator_subagent",
        modeId: DEERFLOW_HARNESS_MODE_ID,
        createdAt,
      }],
      { [runId]: snapshot },
    ).filter((message) => message.role === "assistant");

    expect(assistantMessages).toHaveLength(1);
    expect(assistantMessages[0]?.content).toBe("");
    expect(assistantMessages[0]?.turn?.currentAgentLabel).toBe("Builder");
    expect(assistantMessages[0]?.turn?.delegationActions).toEqual([
      expect.objectContaining({
        label: "Builder",
        detail: "Builder 正在执行任务。",
        status: "active",
      }),
    ]);
  });

  it("keeps legacy child-session history readable without requiring delegation metadata", () => {
    const createdAt = 1_714_000_310_000;
    const runId = "run-legacy-child-session-history";
    const snapshot = {
      runId,
      sessionId: "session-legacy-child-session-history",
      turnIndex: 1,
      status: "succeeded",
      pattern: "orchestrator_subagent",
      modeId: DEERFLOW_HARNESS_MODE_ID,
      input: { prompt: "coordinate subagents", createdAt, context: {} },
      config: {
        modeId: DEERFLOW_HARNESS_MODE_ID,
        pattern: "orchestrator_subagent",
        modeSelection: "manual",
        profileIds: ["orchestrator", "builder"],
        providerId: "local-smoke",
        modelRef: "local/smoke-model",
        approvalMode: "high_risk_only",
        patternOptions: {},
        metadata: {},
        deterministicSeed: "view-model-legacy-child-session-history-test",
        skillIds: [],
        toolIds: [],
      },
      topology: { nodes: [], edges: [] },
      profiles: [
        { id: "orchestrator", label: "Orchestrator", role: "Coordinate", modelRef: "local/smoke-model", toolPolicyId: "code.default", memoryNamespaces: ["session"], budget: { maxTokens: 1000, maxToolCalls: 0, maxRuntimeMs: 1000 } },
        { id: "builder", label: "Builder", role: "Build", modelRef: "local/smoke-model", toolPolicyId: "code.default", memoryNamespaces: ["session"], budget: { maxTokens: 1000, maxToolCalls: 0, maxRuntimeMs: 1000 } },
      ],
      memory: [],
      plan: [],
      todos: [],
      actions: [],
      toolCalls: [],
      policyDecisions: [],
      checkpoints: [],
      events: [
        {
          id: `${runId}:evt-0`,
          runId,
          seq: 0,
          type: "tool.called",
          createdAt: createdAt + 1,
          pattern: "orchestrator_subagent",
          agentId: ORA_ROOT_AGENT_ID,
          nodeId: ORA_ROOT_AGENT_ID,
          payload: {
            toolId: "agent.spawn",
            status: "succeeded",
            input: {
              description: "Builder",
              tool_bundle: "code",
            },
            output: {
              status: "async_launched",
              child_agent_id: "builder",
            },
          },
        },
        {
          id: `${runId}:evt-1`,
          runId,
          seq: 1,
          type: "child_session.updated",
          createdAt: createdAt + 2,
          pattern: "orchestrator_subagent",
          agentId: "builder",
          nodeId: "builder",
          payload: {
            childSession: {
              id: `${runId}:builder`,
              agentId: "builder",
              label: "Builder",
              sessionClass: "mode_subagent",
              status: "succeeded",
              startedAt: createdAt + 1,
              updatedAt: createdAt + 2,
              summary: "完成资料搜集",
            },
          },
        },
      ],
      childSessions: [{
        id: `${runId}:builder`,
        agentId: "builder",
        label: "Builder",
        sessionClass: "mode_subagent",
        status: "succeeded",
        startedAt: createdAt + 1,
        updatedAt: createdAt + 2,
        summary: "完成资料搜集",
      }],
      artifacts: [],
      activeAgents: [],
      queueSummary: { mode: "dag", pending: 0, inProgress: 0, completed: 1, topics: [] },
      sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
      busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
      pendingClarifications: [],
      pendingApprovals: [],
      output: { text: "综合子代理结果后，结论是应该先保持 record_only。" },
      updatedAt: createdAt + 3,
    } as unknown as OraStateSnapshot;

    const assistantMessages = adaptChatMessages(
      [{
        id: `${runId}:user`,
        sessionId: "session-legacy-child-session-history",
        runId,
        turnIndex: 1,
        role: "user",
        content: "coordinate subagents",
        pattern: "orchestrator_subagent",
        modeId: DEERFLOW_HARNESS_MODE_ID,
        createdAt,
      }],
      { [runId]: snapshot },
    ).filter((message) => message.role === "assistant");

    expect(assistantMessages).toHaveLength(1);
    expect(assistantMessages[0]?.content).toBe("综合子代理结果后，结论是应该先保持 record_only。");
    expect(assistantMessages[0]?.turn?.delegationActions).toEqual([
      expect.objectContaining({
        label: "Builder",
        detail: "完成资料搜集",
        status: "complete",
      }),
    ]);
  });

  it("keeps a running mode-stage child visible with a status placeholder before any summary text arrives", () => {
    const createdAt = 1_714_000_000_000;
    const runId = "run-mode-stage-no-summary";
    const sessionId = "session-mode-stage-no-summary";
    const snapshot = {
      runId,
      sessionId,
      turnIndex: 1,
      status: "running",
      pattern: "orchestrator_subagent",
      modeId: DEERFLOW_HARNESS_MODE_ID,
      input: { prompt: "continue", createdAt, context: {} },
      config: {
        modeId: DEERFLOW_HARNESS_MODE_ID,
        pattern: "orchestrator_subagent",
        modeSelection: "manual",
        profileIds: ["orchestrator", "builder"],
        providerId: "local-smoke",
        modelRef: "local/smoke-model",
        approvalMode: "high_risk_only",
        patternOptions: {},
        metadata: {},
        deterministicSeed: "view-model-mode-stage-no-summary-test",
        skillIds: [],
        toolIds: [],
      },
      topology: { nodes: [], edges: [] },
      profiles: [
        { id: "orchestrator", label: "Orchestrator", role: "Coordinate", modelRef: "local/smoke-model", toolPolicyId: "code.default", memoryNamespaces: ["session"], budget: { maxTokens: 1000, maxToolCalls: 0, maxRuntimeMs: 1000 } },
        { id: "builder", label: "Builder", role: "Build", modelRef: "local/smoke-model", toolPolicyId: "code.default", memoryNamespaces: ["session"], budget: { maxTokens: 1000, maxToolCalls: 0, maxRuntimeMs: 1000 } },
      ],
      memory: [],
      plan: [],
      todos: [],
      actions: [],
      toolCalls: [],
      policyDecisions: [],
      checkpoints: [],
      events: [],
      agentMessages: [],
      childSessions: [{
        id: `${runId}:builder`,
        agentId: "builder",
        label: "Builder",
        sessionClass: "mode_subagent",
        delegationKind: "mode_stage",
        authoritySource: "mode_stage",
        status: "running",
        startedAt: createdAt + 1,
        updatedAt: createdAt + 1,
        artifactIds: [],
      }],
      artifacts: [],
      activeAgents: [],
      queueSummary: { mode: "dag", pending: 0, inProgress: 1, completed: 0, topics: [] },
      sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
      busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
      pendingClarifications: [],
      pendingApprovals: [],
      updatedAt: createdAt + 1,
    } as unknown as OraStateSnapshot;

    const assistantMessages = adaptChatMessages(
      [{
        id: `${runId}:user`,
        sessionId,
        runId,
        turnIndex: 1,
        role: "user",
        content: "continue",
        pattern: "orchestrator_subagent",
        modeId: DEERFLOW_HARNESS_MODE_ID,
        createdAt,
      }],
      { [runId]: snapshot },
    ).filter((message) => message.role === "assistant");

    expect(assistantMessages).toHaveLength(1);
    expect(assistantMessages[0]?.content).toBe("");
    expect(assistantMessages[0]?.turn?.delegationActions).toEqual([
      expect.objectContaining({
        label: "Builder",
        detail: "Builder 正在执行任务。",
        status: "active",
      }),
    ]);
  });

  it("prefers the running mode-stage executor label over parent Ora text", () => {
    const createdAt = 1_714_000_000_000;
    const runId = "run-mode-stage-parent-ora";
    const sessionId = "session-mode-stage-parent-ora";
    const snapshot = {
      runId,
      sessionId,
      turnIndex: 1,
      status: "running",
      pattern: "orchestrator_subagent",
      modeId: CODE_DEVELOPMENT_MODE_ID,
      input: { prompt: "continue", createdAt, context: {} },
      config: {
        modeId: CODE_DEVELOPMENT_MODE_ID,
        pattern: "orchestrator_subagent",
        modeSelection: "manual",
        profileIds: ["ora", "builder"],
        providerId: "local-smoke",
        modelRef: "local/smoke-model",
        approvalMode: "high_risk_only",
        patternOptions: {},
        metadata: {},
        deterministicSeed: "view-model-mode-stage-parent-ora-test",
        skillIds: [],
        toolIds: [],
      },
      topology: {
        nodes: [
          { id: "ora", label: "Ora", kind: "agent", agentId: "ora", status: "running", metadata: {} },
          { id: "builder", label: "Builder", kind: "agent", agentId: "builder", status: "running", metadata: {} },
        ],
        edges: [],
      },
      profiles: [
        { id: "ora", label: "Ora", role: "Coordinate", modelRef: "local/smoke-model", toolPolicyId: "code.default", memoryNamespaces: ["session"], budget: { maxTokens: 1000, maxToolCalls: 0, maxRuntimeMs: 1000 } },
        { id: "builder", label: "Builder", role: "Build", modelRef: "local/smoke-model", toolPolicyId: "code.default", memoryNamespaces: ["session"], budget: { maxTokens: 1000, maxToolCalls: 0, maxRuntimeMs: 1000 } },
      ],
      memory: [],
      plan: [],
      todos: [],
      actions: [],
      toolCalls: [],
      policyDecisions: [],
      checkpoints: [],
      events: [{
        id: `${runId}:evt-parent`,
        runId,
        seq: 1,
        type: "message.delta",
        agentId: ORA_ROOT_AGENT_ID,
        createdAt: createdAt + 1,
        pattern: "orchestrator_subagent",
        payload: {
          role: "assistant",
          messageId: `${runId}:assistant`,
          content: "Ora 正在整理执行进展。",
        },
      }],
      agentMessages: [],
      childSessions: [{
        id: `${runId}:builder`,
        agentId: "builder",
        label: "Builder",
        sessionClass: "mode_subagent",
        delegationKind: "mode_stage",
        authoritySource: "mode_stage",
        status: "running",
        startedAt: createdAt + 1,
        updatedAt: createdAt + 2,
        artifactIds: [],
      }],
      artifacts: [],
      activeAgents: ["ora", "builder"],
      queueSummary: { mode: "dag", pending: 0, inProgress: 1, completed: 0, topics: [] },
      sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
      busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
      pendingClarifications: [],
      pendingApprovals: [],
      updatedAt: createdAt + 2,
    } as unknown as OraStateSnapshot;

    const assistant = adaptChatMessages(
      [{
        id: `${runId}:user`,
        sessionId,
        runId,
        turnIndex: 1,
        role: "user",
        content: "continue",
        pattern: "orchestrator_subagent",
        modeId: CODE_DEVELOPMENT_MODE_ID,
        createdAt,
      }],
      { [runId]: snapshot },
    ).find((message) => message.role === "assistant");

    expect(assistant?.turn?.currentAgentLabel).toBe("Builder");
  });

  it("keeps non-transcript child coordination chatter out of parent-turn delegation summaries", () => {
    const createdAt = 1_714_000_000_000;
    const runId = "run-mode-stage-private-chatter";
    const sessionId = "session-mode-stage-private-chatter";
    const snapshot = {
      runId,
      sessionId,
      turnIndex: 1,
      status: "succeeded",
      pattern: "orchestrator_subagent",
      modeId: DEERFLOW_HARNESS_MODE_ID,
      input: { prompt: "continue", createdAt, context: {} },
      config: {
        modeId: DEERFLOW_HARNESS_MODE_ID,
        pattern: "orchestrator_subagent",
        modeSelection: "manual",
        profileIds: ["orchestrator", "builder", "reviewer"],
        providerId: "local-smoke",
        modelRef: "local/smoke-model",
        approvalMode: "high_risk_only",
        patternOptions: {},
        metadata: {},
        deterministicSeed: "view-model-mode-stage-private-chatter-test",
        skillIds: [],
        toolIds: [],
      },
      topology: { nodes: [], edges: [] },
      profiles: [
        { id: "orchestrator", label: "Orchestrator", role: "Coordinate", modelRef: "local/smoke-model", toolPolicyId: "code.default", memoryNamespaces: ["session"], budget: { maxTokens: 1000, maxToolCalls: 0, maxRuntimeMs: 1000 } },
        { id: "builder", label: "Builder", role: "Build", modelRef: "local/smoke-model", toolPolicyId: "code.default", memoryNamespaces: ["session"], budget: { maxTokens: 1000, maxToolCalls: 0, maxRuntimeMs: 1000 } },
        { id: "reviewer", label: "Reviewer", role: "Review", modelRef: "local/smoke-model", toolPolicyId: "code.default", memoryNamespaces: ["session"], budget: { maxTokens: 1000, maxToolCalls: 0, maxRuntimeMs: 1000 } },
      ],
      memory: [],
      plan: [],
      todos: [],
      actions: [],
      toolCalls: [],
      policyDecisions: [],
      checkpoints: [],
      events: [{
        id: `${runId}:evt-builder`,
        runId,
        seq: 1,
        type: "message.delta",
        agentId: "builder",
        createdAt: createdAt + 1,
        pattern: "orchestrator_subagent",
        payload: {
          role: "assistant",
          messageId: `${runId}:builder`,
          content: "Builder 已完成代码修改。",
          audience: "collaboration",
        },
      }],
      agentMessages: [
        {
          id: `${runId}:agent-message:builder-public`,
          runId,
          createdAt: createdAt + 1,
          fromAgentId: "builder",
          toAgentIds: ["reviewer"],
          threadId: "mode-stage:build",
          nodeId: "build",
          planItemId: "build",
          kind: "reply",
          status: "done",
          content: "接下来交给 Reviewer。\n\nBuilder 已完成代码修改。",
          artifactIds: [],
          transcript: {
            kind: "stage_transcript",
            groupId: "chain",
            groupLabel: "Build Chain",
            stageId: "build",
            stageLabel: "Build",
            sequence: 0,
            speakerLabel: "Builder",
            speakerId: "builder",
            stance: "neutral",
            status: "done",
            layout: "stack",
          },
        },
        {
          id: `${runId}:agent-message:builder-private`,
          runId,
          createdAt: createdAt + 2,
          fromAgentId: "builder",
          toAgentIds: ["reviewer"],
          threadId: "mode-stage:build",
          nodeId: "build",
          planItemId: "build",
          kind: "mention",
          status: "sent",
          content: "Reviewer，请顺手检查一下边界条件。",
          artifactIds: [],
        },
      ],
      childSessions: [{
        id: `${runId}:builder`,
        agentId: "builder",
        label: "Builder",
        sessionClass: "mode_subagent",
        delegationKind: "mode_stage",
        authoritySource: "mode_stage",
        status: "succeeded",
        startedAt: createdAt + 1,
        updatedAt: createdAt + 2,
        artifactIds: [],
        replayRef: { kind: "event_range", runId, fromSeq: 1, toSeq: 1 },
      }],
      artifacts: [],
      activeAgents: [],
      queueSummary: { mode: "dag", pending: 0, inProgress: 0, completed: 1, topics: [] },
      sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
      busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
      pendingClarifications: [],
      pendingApprovals: [],
      updatedAt: createdAt + 3,
    } as unknown as OraStateSnapshot;

    const assistantMessages = adaptChatMessages(
      [{
        id: `${runId}:user`,
        sessionId,
        runId,
        turnIndex: 1,
        role: "user",
        content: "continue",
        pattern: "orchestrator_subagent",
        modeId: DEERFLOW_HARNESS_MODE_ID,
        createdAt,
      }],
      { [runId]: snapshot },
    ).filter((message) => message.role === "assistant");

    expect(assistantMessages).toHaveLength(1);
    const parentMessage = assistantMessages[0];
    expect(parentMessage?.turn?.delegationActions).toEqual([
      expect.objectContaining({
        label: "Builder",
        status: "complete",
      }),
    ]);
    expect(parentMessage?.turn?.timelineItems).toContainEqual(expect.objectContaining({
      kind: "agent_message",
      content: "接下来交给 Reviewer。\n\nBuilder 已完成代码修改。",
    }));
    expect(parentMessage?.turn?.timelineItems).not.toContainEqual(expect.objectContaining({
      kind: "agent_message",
      content: "Reviewer，请顺手检查一下边界条件。",
    }));
  });

  it("keeps Code Development main-agent handoff content visible in the turn timeline", () => {
    const createdAt = 1_714_000_000_000;
    const snapshot = {
      runId: "run-code-development-handoff",
      sessionId: "session-code-development-handoff",
      turnIndex: 1,
      status: "running",
      pattern: "agent_teams",
      modeId: CODE_DEVELOPMENT_MODE_ID,
      input: { prompt: "fix the code", createdAt, context: {} },
      config: {
        modeId: CODE_DEVELOPMENT_MODE_ID,
        pattern: "agent_teams",
        modeSelection: "manual",
        profileIds: ["orchestrator", "builder", "reviewer", "debugger"],
        providerId: "local-smoke",
        modelRef: "local/smoke-model",
        approvalMode: "high_risk_only",
        patternOptions: {},
        metadata: {},
        deterministicSeed: "view-model-code-development-handoff-test",
        skillIds: [],
        toolIds: [],
      },
      topology: { nodes: [], edges: [] },
      profiles: [
        { id: "orchestrator", label: "Orchestrator", role: "Coordinate", modelRef: "local/smoke-model", toolPolicyId: "code.default", memoryNamespaces: ["session"], budget: { maxTokens: 1000, maxToolCalls: 0, maxRuntimeMs: 1000 } },
        { id: "builder", label: "Builder", role: "Build", modelRef: "local/smoke-model", toolPolicyId: "code.default", memoryNamespaces: ["session"], budget: { maxTokens: 1000, maxToolCalls: 0, maxRuntimeMs: 1000 } },
        { id: "reviewer", label: "Reviewer", role: "Review", modelRef: "local/smoke-model", toolPolicyId: "code.default", memoryNamespaces: ["session"], budget: { maxTokens: 1000, maxToolCalls: 0, maxRuntimeMs: 1000 } },
        { id: "debugger", label: "Debugger", role: "Debug", modelRef: "local/smoke-model", toolPolicyId: "code.default", memoryNamespaces: ["session"], budget: { maxTokens: 1000, maxToolCalls: 0, maxRuntimeMs: 1000 } },
      ],
      memory: [],
      plan: [],
      todos: [],
      actions: [],
      toolCalls: [],
      policyDecisions: [],
      checkpoints: [],
      events: [{
        id: "run-code-development-handoff:evt-0",
        runId: "run-code-development-handoff",
        seq: 0,
        type: "task.started",
        createdAt,
        payload: { nodeId: "triage", label: "Plan development task" },
      }],
      agentMessages: [
        {
          id: "run-code-development-handoff:agent-message:0",
          runId: "run-code-development-handoff",
          createdAt: createdAt + 1,
          fromAgentId: "orchestrator",
          toAgentIds: ["builder"],
          threadId: "agent-teams:build",
          nodeId: "triage",
          planItemId: "triage",
          kind: "mention",
          status: "done",
          content: "接下来交给 Builder。\n\nOrchestrator 已完成任务拆解。",
          artifactIds: [],
        },
        {
          id: "run-code-development-handoff:agent-message:1",
          runId: "run-code-development-handoff",
          createdAt: createdAt + 2,
          fromAgentId: "builder",
          toAgentIds: ["reviewer"],
          threadId: "agent-teams:build",
          nodeId: "build",
          planItemId: "build",
          kind: "reply",
          status: "done",
          content: "接下来交给 Reviewer。\n\nBuilder 已完成代码修改。",
          artifactIds: [],
        },
        {
          id: "run-code-development-handoff:agent-message:2",
          runId: "run-code-development-handoff",
          createdAt: createdAt + 3,
          fromAgentId: "reviewer",
          toAgentIds: ["debugger"],
          threadId: "agent-teams:build",
          nodeId: "review",
          planItemId: "review",
          kind: "reply",
          status: "done",
          content: "接下来交给 Debugger。\n\nReviewer 发现需要复核失败测试。",
          artifactIds: [],
        },
        {
          id: "run-code-development-handoff:agent-message:3",
          runId: "run-code-development-handoff",
          createdAt: createdAt + 4,
          fromAgentId: "debugger",
          toAgentIds: ["orchestrator"],
          threadId: "agent-teams:build",
          nodeId: "debug",
          planItemId: "debug",
          kind: "reply",
          status: "done",
          content: "接下来交给 Orchestrator。\n\nDebugger 已确认失败原因。",
          artifactIds: [],
        },
        {
          id: "run-code-development-handoff:agent-message:4",
          runId: "run-code-development-handoff",
          createdAt: createdAt + 5,
          fromAgentId: "orchestrator",
          toAgentIds: [],
          threadId: "agent-teams:build",
          nodeId: "handoff",
          planItemId: "handoff",
          kind: "handoff",
          status: "done",
          content: "最终交付已整理。\n\nOrchestrator 已完成最终总结。",
          artifactIds: [],
        },
      ],
      artifacts: [],
      activeAgents: [],
      queueSummary: { mode: "backlog", pending: 0, inProgress: 1, completed: 4, topics: [] },
      sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
      busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
      pendingClarifications: [],
      pendingApprovals: [],
      updatedAt: createdAt + 4,
    } as unknown as OraStateSnapshot;

    const assistant = adaptChatMessages(
      [{
        id: "run-code-development-handoff:user",
        sessionId: "session-code-development-handoff",
        runId: "run-code-development-handoff",
        turnIndex: 1,
        role: "user",
        content: "fix the code",
        pattern: "agent_teams",
        modeId: CODE_DEVELOPMENT_MODE_ID,
        createdAt,
      }],
      { "run-code-development-handoff": snapshot },
    ).find((message) => message.role === "assistant");
    const agentItems = assistant?.turn?.timelineItems?.filter((item) => item.kind === "agent_message") ?? [];
    const timelineText = agentItems.map((item) => "content" in item ? item.content : "").join("\n");

    expect(agentItems.map((item) => item.kind)).toEqual(["agent_message", "agent_message", "agent_message", "agent_message"]);
    expect(timelineText).toContain("接下来交给 Builder。");
    expect(timelineText).toContain("Orchestrator 已完成任务拆解。");
    expect(timelineText).toContain("接下来交给 Reviewer。");
    expect(timelineText).toContain("Builder 已完成代码修改。");
    expect(timelineText).toContain("接下来交给 Debugger。");
    expect(timelineText).toContain("Reviewer 发现需要复核失败测试。");
    expect(timelineText).toContain("接下来交给 Orchestrator。");
    expect(timelineText).toContain("Debugger 已确认失败原因。");
    expect(timelineText).not.toContain("最终交付已整理。");
    expect(timelineText).not.toContain("Orchestrator 已完成最终总结。");
    expect(timelineText.indexOf("Orchestrator 已完成任务拆解。")).toBeLessThan(timelineText.indexOf("Builder 已完成代码修改。"));
    expect(timelineText.indexOf("Builder 已完成代码修改。")).toBeLessThan(timelineText.indexOf("Reviewer 发现需要复核失败测试。"));
    expect(timelineText.indexOf("Reviewer 发现需要复核失败测试。")).toBeLessThan(timelineText.indexOf("Debugger 已确认失败原因。"));
  });

  it("falls back to Ora as the assistant turn agent label", () => {
    const createdAt = 1_714_000_000_000;
    const snapshot = {
      runId: "run-fallback-agent",
      sessionId: "session-fallback-agent",
      turnIndex: 1,
      status: "succeeded",
      pattern: "orchestrator_subagent",
      modeId: SINGLE_AGENT_MODE_ID,
      input: { prompt: "hello", createdAt, context: {} },
      config: {
        modeId: SINGLE_AGENT_MODE_ID,
        pattern: "orchestrator_subagent",
        modeSelection: "manual",
        profileIds: [],
        modelRef: "local/smoke-model",
        approvalMode: "high_risk_only",
        patternOptions: {},
        metadata: {},
        deterministicSeed: "view-model-agent-label-fallback-test",
        skillIds: [],
        toolIds: [],
      },
      topology: { nodes: [], edges: [] },
      profiles: [],
      memory: [],
      plan: [],
      todos: [],
      actions: [],
      toolCalls: [],
      policyDecisions: [],
      checkpoints: [],
      events: [],
      agentMessages: [],
      artifacts: [],
      activeAgents: [],
      queueSummary: { mode: "dag", pending: 0, inProgress: 0, completed: 1, topics: [] },
      sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
      busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
      pendingClarifications: [],
      pendingApprovals: [],
      output: { text: "done" },
      updatedAt: createdAt,
    } as unknown as OraStateSnapshot;

    const messages = adaptChatMessages(
      [{
        id: "run-fallback-agent:user",
        sessionId: "session-fallback-agent",
        runId: "run-fallback-agent",
        turnIndex: 1,
        role: "user",
        content: "hello",
        pattern: "orchestrator_subagent",
        modeId: SINGLE_AGENT_MODE_ID,
        createdAt,
      }],
      { "run-fallback-agent": snapshot },
    );
    const assistant = messages.find((message) => message.role === "assistant");

    expect(assistant?.turn?.currentAgentLabel).toBe(ORA_ROOT_AGENT_LABEL);
  });

  it("ignores progress narration in assistant content and process steps", () => {
    const createdAt = 1_714_000_000_000;
    const snapshot = {
      runId: "run-deerflow-progress",
      sessionId: "session-deerflow-progress",
      turnIndex: 1,
      status: "running",
      pattern: "orchestrator_subagent",
      modeId: DEERFLOW_HARNESS_MODE_ID,
      input: { prompt: "维特根斯坦和尼采的哲学论述有什么不同？", createdAt, context: {} },
      config: {
        modeId: DEERFLOW_HARNESS_MODE_ID,
        pattern: "orchestrator_subagent",
        modeSelection: "manual",
        profileIds: ["orchestrator"],
        providerId: "local-smoke",
        modelRef: "local/smoke-model",
        approvalMode: "high_risk_only",
        patternOptions: {},
        metadata: { progressNarration: true },
        deterministicSeed: "view-model-deerflow-progress-test",
        skillIds: [],
        toolIds: [],
      },
      topology: { nodes: [], edges: [] },
      profiles: [],
      memory: [],
      plan: [],
      todos: [],
      actions: [],
      toolCalls: [],
      policyDecisions: [],
      checkpoints: [],
      events: [
        {
          id: "run-deerflow-progress:evt-0",
          runId: "run-deerflow-progress",
          seq: 0,
          type: "run.started",
          createdAt,
          pattern: "orchestrator_subagent",
          payload: { input: { prompt: "维特根斯坦和尼采的哲学论述有什么不同？" } },
        },
        {
          id: "run-deerflow-progress:evt-1",
          runId: "run-deerflow-progress",
          seq: 1,
          type: "task.progress",
          createdAt: createdAt + 2_000,
          pattern: "orchestrator_subagent",
          payload: {
            kind: "chat_progress",
            source: "progress_narrator",
            trigger: "task.progress",
            summary: "研究已完成，审核子代理正在运行，下一步将进行综合。",
          },
        },
      ],
      artifacts: [],
      activeAgents: [],
      queueSummary: { mode: "dag", pending: 0, inProgress: 1, completed: 0, topics: [] },
      sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
      busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
      pendingClarifications: [],
      pendingApprovals: [],
      updatedAt: createdAt + 2_000,
    } as unknown as OraStateSnapshot;

    const messages = adaptChatMessages(
      [{
        id: "run-deerflow-progress:user",
        sessionId: "session-deerflow-progress",
        runId: "run-deerflow-progress",
        turnIndex: 1,
        role: "user",
        content: "维特根斯坦和尼采的哲学论述有什么不同？",
        pattern: "orchestrator_subagent",
        modeId: DEERFLOW_HARNESS_MODE_ID,
        createdAt,
      }],
      { "run-deerflow-progress": snapshot },
    );
    const assistant = messages.find((message) => message.role === "assistant");

    expect(assistant?.content).toBe("");
    expect(assistant?.turn?.liveProgressText).toBeUndefined();
    expect(assistant?.turn?.processSteps).toEqual([]);
    expect(assistant?.turn?.timelineItems).toEqual([]);
    expect(assistant?.turn?.timelineItems?.some((item) => item.kind === "assistant_text")).toBe(false);
  });

  it("shows commentary deltas in the running assistant message while keeping process steps clean", () => {
    const createdAt = 1_714_000_010_000;
    const snapshot = {
      runId: "run-commentary-progress",
      sessionId: "session-commentary-progress",
      turnIndex: 1,
      status: "running",
      pattern: "orchestrator_subagent",
      modeId: DEERFLOW_HARNESS_MODE_ID,
      input: { prompt: "帮我调查当前 runtime 的状态。", createdAt, context: {} },
      config: {
        modeId: DEERFLOW_HARNESS_MODE_ID,
        pattern: "orchestrator_subagent",
        modeSelection: "manual",
        profileIds: ["orchestrator"],
        providerId: "local-smoke",
        modelRef: "local/smoke-model",
        approvalMode: "high_risk_only",
        patternOptions: {},
        metadata: {},
        deterministicSeed: "view-model-commentary-progress-test",
        skillIds: [],
        toolIds: [],
      },
      topology: { nodes: [], edges: [] },
      profiles: [],
      memory: [],
      plan: [],
      todos: [],
      actions: [],
      toolCalls: [],
      policyDecisions: [],
      checkpoints: [],
      events: [
        {
          id: "run-commentary-progress:evt-0",
          runId: "run-commentary-progress",
          seq: 0,
          type: "message.delta",
          createdAt: createdAt + 1_000,
          pattern: "orchestrator_subagent",
          agentId: ORA_ROOT_AGENT_ID,
          nodeId: "run",
          payload: {
            role: "assistant",
            messageId: "run-commentary-progress:assistant:ora:run:commentary:0:mode.selection",
            content: "我先检查运行中的关键状态，再把结论整理出来。",
            phase: "commentary",
            surface: "chat_progress",
          },
        },
        {
          id: "run-commentary-progress:evt-1",
          runId: "run-commentary-progress",
          seq: 1,
          type: "task.progress",
          createdAt: createdAt + 1_001,
          pattern: "orchestrator_subagent",
          payload: {
            kind: "chat_progress",
            source: "runtime_status",
            trigger: "mode.selection",
            summary: "我先检查运行中的关键状态，再把结论整理出来。",
            basedOnSeq: 0,
          },
        },
      ],
      artifacts: [],
      activeAgents: [],
      queueSummary: { mode: "dag", pending: 0, inProgress: 1, completed: 0, topics: [] },
      sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
      busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
      pendingClarifications: [],
      pendingApprovals: [],
      updatedAt: createdAt + 1_001,
    } as unknown as OraStateSnapshot;

    const messages = adaptChatMessages(
      [{
        id: "run-commentary-progress:user",
        sessionId: "session-commentary-progress",
        runId: "run-commentary-progress",
        turnIndex: 1,
        role: "user",
        content: "帮我调查当前 runtime 的状态。",
        pattern: "orchestrator_subagent",
        modeId: DEERFLOW_HARNESS_MODE_ID,
        createdAt,
      }],
      { "run-commentary-progress": snapshot },
    );
    const assistant = messages.find((message) => message.role === "assistant");

    expect(assistant?.content).toBe("我先检查运行中的关键状态，再把结论整理出来。");
    expect(assistant?.turn?.processSteps).toEqual([]);
    expect(assistant?.turn?.timelineItems).toContainEqual(expect.objectContaining({
      kind: "assistant_text",
      content: "我先检查运行中的关键状态，再把结论整理出来。",
    }));
  });

  it("shows parent-visible spawn milestones while keeping child internal activity hidden", () => {
    const createdAt = 1_714_000_100_000;
    const runId = "run-parent-visible-spawn";
    const snapshot = {
      runId,
      sessionId: "session-parent-visible-spawn",
      turnIndex: 1,
      status: "running",
      pattern: "orchestrator_subagent",
      modeId: DEERFLOW_HARNESS_MODE_ID,
      input: { prompt: "coordinate subagents", createdAt, context: {} },
      config: {
        modeId: DEERFLOW_HARNESS_MODE_ID,
        pattern: "orchestrator_subagent",
        modeSelection: "manual",
        profileIds: ["ora", "orchestrator", "ora-sub-1"],
        providerId: "deepseek",
        modelRef: "deepseek-chat",
        approvalMode: "high_risk_only",
        patternOptions: {},
        metadata: {},
        deterministicSeed: "view-model-parent-visible-spawn-test",
        skillIds: [],
        toolIds: ["agent.spawn", "file.read"],
      },
      topology: { nodes: [], edges: [] },
      profiles: [
        { id: ORA_ROOT_AGENT_ID, label: ORA_ROOT_AGENT_LABEL, role: "root", model: "deepseek-chat", tools: [], budget: "", memoryScopes: [] },
        { id: "orchestrator", label: "Orchestrator", role: "orchestrator", model: "deepseek-chat", tools: [], budget: "", memoryScopes: [] },
        { id: "ora-sub-1", label: "Research subagent", role: "research", model: "deepseek-chat", tools: [], budget: "", memoryScopes: [] },
      ],
      memory: [],
      plan: [],
      todos: [],
      actions: [],
      toolCalls: [],
      policyDecisions: [],
      checkpoints: [],
      events: [
        {
          id: `${runId}:evt-0`,
          runId,
          seq: 0,
          type: "tool.called",
          createdAt: createdAt + 1,
          pattern: "orchestrator_subagent",
          agentId: ORA_ROOT_AGENT_ID,
          nodeId: ORA_ROOT_AGENT_ID,
          payload: {
            toolId: "agent.spawn",
            status: "succeeded",
            input: {
              description: "Research subagent",
              tool_bundle: "research_readonly",
            },
            output: {
              status: "async_launched",
              child_agent_id: "ora-sub-1",
              child_session_id: `${runId}:ora-sub-1`,
              tool_bundle: "research_readonly",
            },
          },
        },
        {
          id: `${runId}:evt-1`,
          runId,
          seq: 1,
          type: "child_session.updated",
          createdAt: createdAt + 2,
          pattern: "orchestrator_subagent",
          agentId: "ora-sub-1",
          nodeId: "ora-sub-1",
          payload: {
            childSession: {
              id: `${runId}:ora-sub-1`,
              agentId: "ora-sub-1",
              label: "Research subagent",
              sessionClass: "temporary_spawn",
              status: "running",
              startedAt: createdAt + 1,
              updatedAt: createdAt + 2,
            },
          },
        },
        {
          id: `${runId}:evt-2`,
          runId,
          seq: 2,
          type: "tool.called",
          createdAt: createdAt + 3,
          pattern: "orchestrator_subagent",
          agentId: "ora-sub-1",
          nodeId: "ora-sub-1",
          payload: {
            toolId: "file.read",
            status: "succeeded",
            input: { path: "apps/desktop/src/components/ChatInput.tsx" },
            output: { path: "apps/desktop/src/components/ChatInput.tsx", sizeBytes: 128 },
          },
        },
        {
          id: `${runId}:evt-3`,
          runId,
          seq: 3,
          type: "message.delta",
          createdAt: createdAt + 4,
          pattern: "orchestrator_subagent",
          agentId: "ora-sub-1",
          nodeId: "ora-sub-1",
          payload: {
            role: "assistant",
            messageId: `${runId}:child`,
            content: "Research subagent 正在读取相关文件。",
            audience: "collaboration",
          },
        },
        {
          id: `${runId}:evt-4`,
          runId,
          seq: 4,
          type: "child_session.updated",
          createdAt: createdAt + 5,
          pattern: "orchestrator_subagent",
          agentId: "ora-sub-1",
          nodeId: "ora-sub-1",
          payload: {
            childSession: {
              id: `${runId}:ora-sub-1`,
              agentId: "ora-sub-1",
              label: "Research subagent",
              sessionClass: "temporary_spawn",
              status: "succeeded",
              deliveryStatus: "awaiting_pickup",
              startedAt: createdAt + 1,
              updatedAt: createdAt + 5,
              summary: "完成资料搜集",
            },
          },
        },
        {
          id: `${runId}:evt-1`,
          runId,
          seq: 1,
          type: "tool.called",
          createdAt: createdAt + 2,
          pattern: "orchestrator_subagent",
          agentId: ORA_ROOT_AGENT_ID,
          nodeId: ORA_ROOT_AGENT_ID,
          payload: {
            toolId: "file.read",
            status: "succeeded",
            input: {
              path: "apps/desktop/src/components/AssistantTurnCard.tsx",
            },
            output: {
              path: "apps/desktop/src/components/AssistantTurnCard.tsx",
              sizeBytes: 128,
            },
          },
        },
      ],
      childSessions: [{
        id: `${runId}:ora-sub-1`,
        agentId: "ora-sub-1",
        label: "Research subagent",
        sessionClass: "temporary_spawn",
        status: "succeeded",
        deliveryStatus: "awaiting_pickup",
        parentTaskIntent: "chat",
        childTaskIntent: "chat",
        startedAt: createdAt + 1,
        updatedAt: createdAt + 5,
        summary: "完成资料搜集",
      }],
      artifacts: [],
      activeAgents: [],
      queueSummary: { mode: "dag", pending: 0, inProgress: 1, completed: 1, topics: [] },
      sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
      busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
      pendingClarifications: [],
      pendingApprovals: [],
      updatedAt: createdAt + 5,
    } as unknown as OraStateSnapshot;

    const messages = adaptChatMessages(
      [{
        id: `${runId}:user`,
        sessionId: "session-parent-visible-spawn",
        runId,
        turnIndex: 1,
        role: "user",
        content: "coordinate subagents",
        pattern: "orchestrator_subagent",
        modeId: DEERFLOW_HARNESS_MODE_ID,
        createdAt,
      }],
      { [runId]: snapshot },
    );

    const assistant = messages.find((message) => message.role === "assistant");
    const assistantTexts = assistant?.turn?.timelineItems
      ?.flatMap((item) => item.kind === "assistant_text" ? [item.content] : []) ?? [];
    expect(assistant?.content).toBe("");
    expect(assistant?.turn?.presentation?.showStandaloneBody).toBe(false);
    expect(assistantTexts).not.toContain("已委派 Research subagent，正在处理子任务。");
    expect(assistantTexts).not.toContain("Research subagent 已完成，结果已回流，父 Agent 正在整合。");
    expect(assistantTexts).not.toContain("Research subagent 正在读取相关文件。");
    expect(assistant?.turn?.processSteps?.map((step) => step.label)).toEqual([
      "委派子代理",
      "委派子代理",
      "读取文件",
      "子代理结果回流",
    ]);
  });

  it("keeps child session milestones in timeline while preserving a real final answer body", () => {
    const createdAt = 1_714_000_150_000;
    const runId = "run-child-session-milestone-with-final-answer";
    const snapshot = {
      runId,
      sessionId: "session-child-session-milestone-with-final-answer",
      turnIndex: 1,
      status: "succeeded",
      pattern: "orchestrator_subagent",
      modeId: DEERFLOW_HARNESS_MODE_ID,
      input: { prompt: "coordinate subagents", createdAt, context: {} },
      config: {
        modeId: DEERFLOW_HARNESS_MODE_ID,
        pattern: "orchestrator_subagent",
        modeSelection: "manual",
        profileIds: ["ora", "ora-sub-1"],
        providerId: "deepseek",
        modelRef: "deepseek-chat",
        approvalMode: "high_risk_only",
        patternOptions: {},
        metadata: {},
        deterministicSeed: "view-model-child-session-final-answer-test",
        skillIds: [],
        toolIds: ["agent.spawn", "file.read"],
      },
      topology: { nodes: [], edges: [] },
      profiles: [
        { id: ORA_ROOT_AGENT_ID, label: ORA_ROOT_AGENT_LABEL, role: "root", model: "deepseek-chat", tools: [], budget: "", memoryScopes: [] },
        { id: "ora-sub-1", label: "Research subagent", role: "research", model: "deepseek-chat", tools: [], budget: "", memoryScopes: [] },
      ],
      memory: [],
      plan: [],
      todos: [],
      actions: [],
      toolCalls: [],
      policyDecisions: [],
      checkpoints: [],
      events: [
        {
          id: `${runId}:evt-0`,
          runId,
          seq: 0,
          type: "tool.called",
          createdAt: createdAt + 1,
          pattern: "orchestrator_subagent",
          agentId: ORA_ROOT_AGENT_ID,
          nodeId: ORA_ROOT_AGENT_ID,
          payload: {
            toolId: "agent.spawn",
            status: "succeeded",
            input: {
              description: "Research subagent",
              tool_bundle: "research_readonly",
            },
            output: {
              status: "async_launched",
              child_agent_id: "ora-sub-1",
              tool_bundle: "research_readonly",
            },
          },
        },
        {
          id: `${runId}:evt-1`,
          runId,
          seq: 1,
          type: "child_session.updated",
          createdAt: createdAt + 5,
          pattern: "orchestrator_subagent",
          payload: {
            childSession: {
              id: `${runId}:ora-sub-1`,
              agentId: "ora-sub-1",
              label: "Research subagent",
              status: "succeeded",
              lifecyclePhase: "awaiting_pickup",
            },
          },
        },
      ],
      childSessions: [{
        id: `${runId}:ora-sub-1`,
        agentId: "ora-sub-1",
        label: "Research subagent",
        sessionClass: "temporary_spawn",
        status: "succeeded",
        deliveryStatus: "awaiting_pickup",
        lifecyclePhase: "awaiting_pickup",
        parentTaskIntent: "chat",
        childTaskIntent: "chat",
        startedAt: createdAt + 1,
        updatedAt: createdAt + 5,
        summary: "完成资料搜集",
      }],
      artifacts: [],
      activeAgents: [],
      queueSummary: { mode: "dag", pending: 0, inProgress: 0, completed: 1, topics: [] },
      sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
      busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
      pendingClarifications: [],
      pendingApprovals: [],
      output: { text: "综合子代理结果后，结论是应该先保持 record_only。" },
      updatedAt: createdAt + 8,
    } as unknown as OraStateSnapshot;

    const assistant = adaptChatMessages(
      [{
        id: `${runId}:user`,
        sessionId: "session-child-session-milestone-with-final-answer",
        runId,
        turnIndex: 1,
        role: "user",
        content: "coordinate subagents",
        pattern: "orchestrator_subagent",
        modeId: DEERFLOW_HARNESS_MODE_ID,
        createdAt,
      }],
      { [runId]: snapshot },
    ).find((message) => message.role === "assistant");

    const assistantTexts = assistant?.turn?.timelineItems
      ?.flatMap((item) => item.kind === "assistant_text" ? [item.content] : []) ?? [];
    const finalItems = assistant?.turn?.timelineItems?.filter((item) =>
      item.kind === "final_text" && "content" in item
    ) ?? [];

    expect(assistant?.content).toBe("综合子代理结果后，结论是应该先保持 record_only。");
    expect(assistantTexts).not.toContain("Research subagent 已完成，结果已回流，父 Agent 正在整合。");
    expect(finalItems).toContainEqual(expect.objectContaining({
      kind: "final_text",
      content: "综合子代理结果后，结论是应该先保持 record_only。",
    }));
  });

  it("suppresses dynamic_spawn child runs from the main chat while keeping the parent turn intact", () => {
    const createdAt = 1_714_000_250_000;
    const parentRunId = "run-dynamic-spawn-parent";
    const childRunId = `${parentRunId}:ora-sub-1`;
    const parentSnapshot = {
      runId: parentRunId,
      sessionId: "session-dynamic-spawn-parent",
      turnIndex: 1,
      status: "running",
      pattern: "orchestrator_subagent",
      modeId: DEERFLOW_HARNESS_MODE_ID,
      input: { prompt: "coordinate subagents", createdAt, context: {} },
      config: {
        modeId: DEERFLOW_HARNESS_MODE_ID,
        pattern: "orchestrator_subagent",
        modeSelection: "manual",
        profileIds: ["ora", "ora-sub-1"],
        providerId: "deepseek",
        modelRef: "deepseek-chat",
        approvalMode: "high_risk_only",
        patternOptions: {},
        metadata: {},
        deterministicSeed: "view-model-dynamic-spawn-main-chat-test",
        skillIds: [],
        toolIds: ["agent.spawn", "file.read"],
      },
      topology: { nodes: [], edges: [] },
      profiles: [
        { id: ORA_ROOT_AGENT_ID, label: ORA_ROOT_AGENT_LABEL, role: "root", model: "deepseek-chat", tools: [], budget: "", memoryScopes: [] },
        { id: "ora-sub-1", label: "Research subagent", role: "research", model: "deepseek-chat", tools: [], budget: "", memoryScopes: [] },
      ],
      memory: [],
      plan: [],
      todos: [],
      actions: [],
      toolCalls: [],
      policyDecisions: [],
      checkpoints: [],
      events: [
        {
          id: `${parentRunId}:evt-0`,
          runId: parentRunId,
          seq: 0,
          type: "tool.called",
          createdAt: createdAt + 1,
          pattern: "orchestrator_subagent",
          agentId: ORA_ROOT_AGENT_ID,
          nodeId: ORA_ROOT_AGENT_ID,
          payload: {
            toolId: "agent.spawn",
            status: "succeeded",
            input: {
              description: "Research subagent",
              tool_bundle: "research_readonly",
            },
            output: {
              status: "async_launched",
              child_agent_id: "ora-sub-1",
              tool_bundle: "research_readonly",
            },
          },
        },
        {
          id: `${parentRunId}:evt-1`,
          runId: parentRunId,
          seq: 1,
          type: "child_session.updated",
          createdAt: createdAt + 2,
          pattern: "orchestrator_subagent",
          payload: {
            childSession: {
              id: childRunId,
              agentId: "ora-sub-1",
              label: "Research subagent",
              sessionClass: "temporary_spawn",
              authoritySource: "dynamic_spawn",
              delegationKind: "dynamic_spawn",
              status: "running",
              deliveryStatus: "running",
              startedAt: createdAt + 1,
              updatedAt: createdAt + 2,
              summary: "正在读取相关文件。",
            },
          },
        },
      ],
      childSessions: [{
        id: childRunId,
        agentId: "ora-sub-1",
        label: "Research subagent",
        sessionClass: "temporary_spawn",
        authoritySource: "dynamic_spawn",
        delegationKind: "dynamic_spawn",
        status: "running",
        deliveryStatus: "running",
        parentTaskIntent: "chat",
        childTaskIntent: "chat",
        startedAt: createdAt + 1,
        updatedAt: createdAt + 2,
        summary: "正在读取相关文件。",
      }],
      artifacts: [],
      activeAgents: [],
      queueSummary: { mode: "dag", pending: 0, inProgress: 1, completed: 0, topics: [] },
      sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
      busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
      pendingClarifications: [],
      pendingApprovals: [],
      updatedAt: createdAt + 2,
    } as unknown as OraStateSnapshot;

    const childSnapshot = {
      ...parentSnapshot,
      runId: childRunId,
      sessionId: "session-dynamic-spawn-child",
      turnIndex: 2,
      childSessions: [],
      events: [],
      updatedAt: createdAt + 3,
    } as unknown as OraStateSnapshot;

    const messages = adaptChatMessages(
      [{
        id: `${parentRunId}:user`,
        sessionId: "session-dynamic-spawn-parent",
        runId: parentRunId,
        turnIndex: 1,
        role: "user",
        content: "coordinate subagents",
        pattern: "orchestrator_subagent",
        modeId: DEERFLOW_HARNESS_MODE_ID,
        createdAt,
      }],
      {
        [parentRunId]: parentSnapshot,
        [childRunId]: childSnapshot,
      },
    );

    const assistantMessages = messages.filter((message) => message.role === "assistant");
    const parentAssistant = assistantMessages.find((message) => message.metadata?.runId === parentRunId);

    expect(assistantMessages).toHaveLength(1);
    expect(parentAssistant?.turn).toBeDefined();
    expect(parentAssistant?.turn?.processSteps?.map((step) => step.label)).toEqual([
      "委派子代理",
      "委派子代理",
    ]);
    expect(messages.some((message) => message.metadata?.runId === childRunId)).toBe(false);
  });

  it("keeps mode-stage delegation inside the parent turn instead of adding a separate assistant message", () => {
    const createdAt = 1_714_000_300_000;
    const runId = "run-mode-stage-delegation-inline";
    const snapshot = {
      runId,
      sessionId: "session-mode-stage-delegation-inline",
      turnIndex: 1,
      status: "running",
      pattern: "orchestrator_subagent",
      modeId: DEERFLOW_HARNESS_MODE_ID,
      input: { prompt: "delegate research", createdAt, context: {} },
      config: {
        modeId: DEERFLOW_HARNESS_MODE_ID,
        pattern: "orchestrator_subagent",
        modeSelection: "manual",
        profileIds: ["ora", "ora-sub-1"],
        providerId: "deepseek",
        modelRef: "deepseek-chat",
        approvalMode: "high_risk_only",
        patternOptions: {},
        metadata: {},
        deterministicSeed: "view-model-mode-stage-delegation-inline-test",
        skillIds: [],
        toolIds: ["agent.spawn", "file.read"],
      },
      topology: { nodes: [], edges: [] },
      profiles: [
        { id: ORA_ROOT_AGENT_ID, label: ORA_ROOT_AGENT_LABEL, role: "root", model: "deepseek-chat", tools: [], budget: "", memoryScopes: [] },
        { id: "ora-sub-1", label: "Research subagent", role: "research", model: "deepseek-chat", tools: [], budget: "", memoryScopes: [] },
      ],
      memory: [],
      plan: [],
      todos: [],
      actions: [],
      toolCalls: [],
      policyDecisions: [],
      checkpoints: [],
      events: [
        {
          id: `${runId}:evt-0`,
          runId,
          seq: 0,
          type: "tool.called",
          createdAt: createdAt + 1,
          pattern: "orchestrator_subagent",
          agentId: ORA_ROOT_AGENT_ID,
          nodeId: ORA_ROOT_AGENT_ID,
          payload: {
            toolId: "agent.spawn",
            status: "succeeded",
            input: {
              description: "Research subagent",
              tool_bundle: "research_readonly",
            },
            output: {
              status: "async_launched",
              child_agent_id: "ora-sub-1",
              tool_bundle: "research_readonly",
            },
          },
        },
        {
          id: `${runId}:evt-1`,
          runId,
          seq: 1,
          type: "child_session.updated",
          createdAt: createdAt + 5,
          pattern: "orchestrator_subagent",
          payload: {
            childSession: {
              id: `${runId}:ora-sub-1`,
              agentId: "ora-sub-1",
              label: "Research subagent",
              status: "running",
              lifecyclePhase: "running",
              summary: "正在搜集资料",
            },
          },
        },
      ],
      childSessions: [{
        id: `${runId}:ora-sub-1`,
        agentId: "ora-sub-1",
        label: "Research subagent",
        sessionClass: "temporary_spawn",
        delegationKind: "mode_stage",
        authoritySource: "mode_stage",
        status: "running",
        deliveryStatus: "running",
        lifecyclePhase: "running",
        parentTaskIntent: "chat",
        childTaskIntent: "chat",
        startedAt: createdAt + 1,
        updatedAt: createdAt + 5,
        summary: "正在搜集资料",
      }],
      artifacts: [],
      activeAgents: [],
      queueSummary: { mode: "dag", pending: 0, inProgress: 1, completed: 0, topics: [] },
      sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
      busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
      pendingClarifications: [],
      pendingApprovals: [],
      updatedAt: createdAt + 5,
    } as unknown as OraStateSnapshot;

    const messages = adaptChatMessages(
      [{
        id: `${runId}:user`,
        sessionId: "session-mode-stage-delegation-inline",
        runId,
        turnIndex: 1,
        role: "user",
        content: "delegate research",
        pattern: "orchestrator_subagent",
        modeId: DEERFLOW_HARNESS_MODE_ID,
        createdAt,
      }],
      { [runId]: snapshot },
    );

    const assistantMessages = messages.filter((message) => message.role === "assistant");
    expect(assistantMessages).toHaveLength(1);
    expect(assistantMessages[0]?.turn?.delegationActions).toEqual([
      expect.objectContaining({
        label: "Research subagent",
        detail: "正在搜集资料",
        status: "active",
      }),
    ]);
    expect(assistantMessages[0]?.turn?.processSteps?.map((step) => step.label)).toContain("委派子代理");
  });

  it("shows blocked agent.spawn attempts as public failure milestones", () => {
    const createdAt = 1_714_000_200_000;
    const runId = "run-blocked-agent-spawn";
    const snapshot = {
      runId,
      sessionId: "session-blocked-agent-spawn",
      turnIndex: 1,
      status: "running",
      pattern: "orchestrator_subagent",
      modeId: SINGLE_AGENT_MODE_ID,
      input: { prompt: "Patch README via builder_write", createdAt, context: {} },
      config: {
        modeId: SINGLE_AGENT_MODE_ID,
        pattern: "orchestrator_subagent",
        modeSelection: "manual",
        profileIds: ["ora"],
        providerId: "deepseek",
        modelRef: "deepseek-chat",
        approvalMode: "high_risk_only",
        patternOptions: {},
        metadata: {},
        deterministicSeed: "view-model-blocked-agent-spawn-test",
        skillIds: [],
        toolIds: ["agent.spawn", "file.read"],
      },
      topology: { nodes: [], edges: [] },
      profiles: [
        { id: ORA_ROOT_AGENT_ID, label: ORA_ROOT_AGENT_LABEL, role: "root", model: "deepseek-chat", tools: [], budget: "", memoryScopes: [] },
      ],
      memory: [],
      plan: [],
      todos: [],
      actions: [],
      toolCalls: [],
      policyDecisions: [],
      checkpoints: [],
      events: [
        {
          id: `${runId}:evt-0`,
          runId,
          seq: 0,
          type: "tool.called",
          createdAt: createdAt + 1,
          pattern: "orchestrator_subagent",
          agentId: ORA_ROOT_AGENT_ID,
          nodeId: ORA_ROOT_AGENT_ID,
          payload: {
            toolId: "agent.spawn",
            status: "succeeded",
            input: {
              description: "Patch README",
              tool_bundle: "builder_write",
            },
            output: {
              status: "blocked",
              tool_bundle: "builder_write",
              message: "preset \"builder_write\" is unavailable because write capability is missing.",
            },
          },
        },
        {
          id: `${runId}:evt-1`,
          runId,
          seq: 1,
          type: "tool.called",
          createdAt: createdAt + 2,
          pattern: "orchestrator_subagent",
          agentId: ORA_ROOT_AGENT_ID,
          nodeId: ORA_ROOT_AGENT_ID,
          payload: {
            toolId: "file.read",
            status: "succeeded",
            input: {
              path: "apps/desktop/src/components/AssistantTurnCard.tsx",
            },
            output: {
              path: "apps/desktop/src/components/AssistantTurnCard.tsx",
              sizeBytes: 128,
            },
          },
        },
        {
          id: `${runId}:evt-1`,
          runId,
          seq: 1,
          type: "tool.called",
          createdAt: createdAt + 2,
          pattern: "orchestrator_subagent",
          agentId: ORA_ROOT_AGENT_ID,
          nodeId: ORA_ROOT_AGENT_ID,
          payload: {
            toolId: "file.read",
            status: "succeeded",
            input: {
              path: "apps/desktop/src/components/AssistantTurnCard.tsx",
            },
            output: {
              path: "apps/desktop/src/components/AssistantTurnCard.tsx",
              sizeBytes: 128,
            },
          },
        },
      ],
      childSessions: [],
      artifacts: [],
      activeAgents: [],
      queueSummary: { mode: "dag", pending: 0, inProgress: 1, completed: 0, topics: [] },
      sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
      busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
      pendingClarifications: [],
      pendingApprovals: [],
      updatedAt: createdAt + 2,
    } as unknown as OraStateSnapshot;

    const messages = adaptChatMessages(
      [{
        id: `${runId}:user`,
        sessionId: "session-blocked-agent-spawn",
        runId,
        turnIndex: 1,
        role: "user",
        content: "Patch README via builder_write",
        pattern: "orchestrator_subagent",
        modeId: SINGLE_AGENT_MODE_ID,
        createdAt,
      }],
      { [runId]: snapshot },
    );

    const assistant = messages.find((message) => message.role === "assistant");
    const timelineText = assistant?.turn?.timelineItems
      ?.flatMap((item) => "content" in item ? [item.content] : "summary" in item ? [item.summary] : [])
      .join("\n") ?? "";

    expect(timelineText).toContain("委派 Patch README 失败（builder_write）");
    expect(assistant?.turn?.processSteps?.[0]).toMatchObject({
      label: "委派子代理",
      status: "blocked",
    });
  });

  it("shows successful parent agent.spawn calls in progress steps", () => {
    const createdAt = 1_714_000_250_000;
    const runId = "run-successful-parent-agent-spawn";
    const snapshot = {
      runId,
      sessionId: "session-successful-parent-agent-spawn",
      turnIndex: 1,
      status: "running",
      pattern: "orchestrator_subagent",
      modeId: DEERFLOW_HARNESS_MODE_ID,
      input: { prompt: "delegate research", createdAt, context: {} },
      config: {
        modeId: DEERFLOW_HARNESS_MODE_ID,
        pattern: "orchestrator_subagent",
        modeSelection: "manual",
        profileIds: ["ora", "orchestrator", "ora-sub-1"],
        providerId: "deepseek",
        modelRef: "deepseek-chat",
        approvalMode: "high_risk_only",
        patternOptions: {},
        metadata: {},
        deterministicSeed: "view-model-successful-parent-agent-spawn-test",
        skillIds: [],
        toolIds: ["agent.spawn", "file.read"],
      },
      topology: { nodes: [], edges: [] },
      profiles: [
        { id: ORA_ROOT_AGENT_ID, label: ORA_ROOT_AGENT_LABEL, role: "root", model: "deepseek-chat", tools: [], budget: "", memoryScopes: [] },
        { id: "orchestrator", label: "Orchestrator", role: "orchestrator", model: "deepseek-chat", tools: [], budget: "", memoryScopes: [] },
        { id: "ora-sub-1", label: "Research subagent", role: "research", model: "deepseek-chat", tools: [], budget: "", memoryScopes: [] },
      ],
      memory: [],
      plan: [],
      todos: [],
      actions: [],
      toolCalls: [],
      policyDecisions: [],
      checkpoints: [],
      events: [
        {
          id: `${runId}:evt-0`,
          runId,
          seq: 0,
          type: "tool.called",
          createdAt: createdAt + 1,
          pattern: "orchestrator_subagent",
          agentId: ORA_ROOT_AGENT_ID,
          nodeId: ORA_ROOT_AGENT_ID,
          payload: {
            toolId: "agent.spawn",
            status: "succeeded",
            input: {
              description: "Research subagent",
              tool_bundle: "research_readonly",
            },
            output: {
              status: "async_launched",
              child_agent_id: "ora-sub-1",
              tool_bundle: "research_readonly",
            },
          },
        },
        {
          id: `${runId}:evt-1`,
          runId,
          seq: 1,
          type: "tool.called",
          createdAt: createdAt + 2,
          pattern: "orchestrator_subagent",
          agentId: ORA_ROOT_AGENT_ID,
          nodeId: ORA_ROOT_AGENT_ID,
          payload: {
            toolId: "file.read",
            status: "succeeded",
            input: {
              path: "apps/desktop/src/components/AssistantTurnCard.tsx",
            },
            output: {
              path: "apps/desktop/src/components/AssistantTurnCard.tsx",
              sizeBytes: 128,
            },
          },
        },
      ],
      childSessions: [],
      artifacts: [],
      activeAgents: [],
      queueSummary: { mode: "dag", pending: 0, inProgress: 1, completed: 0, topics: [] },
      sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
      busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
      pendingClarifications: [],
      pendingApprovals: [],
      updatedAt: createdAt + 2,
    } as unknown as OraStateSnapshot;

    const messages = adaptChatMessages(
      [{
        id: `${runId}:user`,
        sessionId: "session-successful-parent-agent-spawn",
        runId,
        turnIndex: 1,
        role: "user",
        content: "delegate research",
        pattern: "orchestrator_subagent",
        modeId: DEERFLOW_HARNESS_MODE_ID,
        createdAt,
      }],
      { [runId]: snapshot },
    );

    const assistant = messages.find((message) => message.role === "assistant");
    expect(assistant?.turn?.processSteps).toEqual([
      expect.objectContaining({
        id: `${runId}:evt-0`,
        eventType: "tool.called",
        label: "委派子代理",
        detail: "已委派 Research subagent 在后台处理子任务（research_readonly）。",
        status: "complete",
      }),
      expect.objectContaining({
        id: `${runId}:evt-1`,
        eventType: "tool.called",
        label: "读取文件",
      }),
    ]);
    expect(assistant?.turn?.timelineItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "status_group",
          summary: "已委派 Research subagent 在后台处理子任务（research_readonly）。",
          steps: [
            expect.objectContaining({
              id: `${runId}:evt-0`,
              eventType: "tool.called",
              label: "委派子代理",
            }),
            expect.objectContaining({
              id: `${runId}:evt-1`,
              eventType: "tool.called",
              label: "读取文件",
            }),
          ],
        }),
      ]),
    );
    expect(assistant?.turn?.timelineItems).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "assistant_text",
          content: "已委派 Research subagent，正在处理子任务。",
        }),
      ]),
    );
  });

  it("keeps failure-like child session milestones visible as public narratives", () => {
    const createdAt = 1_714_000_350_000;
    const cases = [
      {
        runId: "run-child-session-failed-inline",
        status: "failed",
        lifecyclePhase: "failed",
        expectedText: "Research subagent 执行失败，父 Agent 正在处理。",
      },
      {
        runId: "run-child-session-cancelled-inline",
        status: "cancelled",
        lifecyclePhase: "cancelled",
        expectedText: "Research subagent 已取消，父 Agent 正在调整后续步骤。",
      },
      {
        runId: "run-child-session-stalled-inline",
        status: "running",
        lifecyclePhase: "stalled",
        expectedText: "Research subagent 进展卡住，父 Agent 正在处理。",
      },
    ] as const;

    for (const testCase of cases) {
      const snapshot = {
        runId: testCase.runId,
        sessionId: `${testCase.runId}:session`,
        turnIndex: 1,
        status: "running",
        pattern: "orchestrator_subagent",
        modeId: DEERFLOW_HARNESS_MODE_ID,
        input: { prompt: "coordinate subagents", createdAt, context: {} },
        config: {
          modeId: DEERFLOW_HARNESS_MODE_ID,
          pattern: "orchestrator_subagent",
          modeSelection: "manual",
          profileIds: ["ora", "ora-sub-1"],
          providerId: "deepseek",
          modelRef: "deepseek-chat",
          approvalMode: "high_risk_only",
          patternOptions: {},
          metadata: {},
          deterministicSeed: `${testCase.runId}:test`,
          skillIds: [],
          toolIds: ["agent.spawn"],
        },
        topology: { nodes: [], edges: [] },
        profiles: [
          { id: ORA_ROOT_AGENT_ID, label: ORA_ROOT_AGENT_LABEL, role: "root", model: "deepseek-chat", tools: [], budget: "", memoryScopes: [] },
          { id: "ora-sub-1", label: "Research subagent", role: "research", model: "deepseek-chat", tools: [], budget: "", memoryScopes: [] },
        ],
        memory: [],
        plan: [],
        todos: [],
        actions: [],
        toolCalls: [],
        policyDecisions: [],
        checkpoints: [],
        events: [
          {
            id: `${testCase.runId}:evt-0`,
            runId: testCase.runId,
            seq: 0,
            type: "child_session.updated",
            createdAt: createdAt + 1,
            pattern: "orchestrator_subagent",
            payload: {
              childSession: {
                id: `${testCase.runId}:ora-sub-1`,
                agentId: "ora-sub-1",
                label: "Research subagent",
                status: testCase.status,
                lifecyclePhase: testCase.lifecyclePhase,
                updatedAt: createdAt + 1,
              },
            },
          },
        ],
        childSessions: [{
          id: `${testCase.runId}:ora-sub-1`,
          agentId: "ora-sub-1",
          label: "Research subagent",
          sessionClass: "temporary_spawn",
          status: testCase.status,
          deliveryStatus: testCase.lifecyclePhase,
          lifecyclePhase: testCase.lifecyclePhase,
          parentTaskIntent: "chat",
          childTaskIntent: "chat",
          startedAt: createdAt,
          updatedAt: createdAt + 1,
        }],
        artifacts: [],
        activeAgents: [],
        queueSummary: { mode: "dag", pending: 0, inProgress: 1, completed: 0, topics: [] },
        sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
        busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
        pendingClarifications: [],
        pendingApprovals: [],
        updatedAt: createdAt + 1,
      } as unknown as OraStateSnapshot;

      const assistant = adaptChatMessages(
        [{
          id: `${testCase.runId}:user`,
          sessionId: `${testCase.runId}:session`,
          runId: testCase.runId,
          turnIndex: 1,
          role: "user",
          content: "coordinate subagents",
          pattern: "orchestrator_subagent",
          modeId: DEERFLOW_HARNESS_MODE_ID,
          createdAt,
        }],
        { [testCase.runId]: snapshot },
      ).find((message) => message.role === "assistant");

      const assistantTexts = assistant?.turn?.timelineItems
        ?.flatMap((item) => item.kind === "assistant_text" ? [item.content] : []) ?? [];

      expect(assistantTexts).toContain(testCase.expectedText);
    }
  });

  it("keeps progress-only status distinct and prefers streamed assistant answer", () => {
    const createdAt = 1_714_000_000_000;
    const baseSnapshot = {
      runId: "run-runtime-status",
      sessionId: "session-runtime-status",
      turnIndex: 1,
      status: "running",
      pattern: "orchestrator_subagent",
      modeId: SINGLE_AGENT_MODE_ID,
      input: { prompt: "安装 skills", createdAt, context: {} },
      config: {
        modeId: SINGLE_AGENT_MODE_ID,
        pattern: "orchestrator_subagent",
        modeSelection: "auto",
        profileIds: ["solo_agent"],
        providerId: "local-smoke",
        modelRef: "local/smoke-model",
        approvalMode: "high_risk_only",
        patternOptions: {},
        metadata: {},
        deterministicSeed: "view-model-runtime-status-test",
        skillIds: [],
        toolIds: [],
      },
      topology: { nodes: [], edges: [] },
      profiles: [],
      memory: [],
      plan: [],
      todos: [],
      actions: [],
      toolCalls: [],
      policyDecisions: [],
      checkpoints: [],
      events: [{
        id: "run-runtime-status:evt-0",
        runId: "run-runtime-status",
        seq: 0,
        type: "task.progress",
        createdAt,
        pattern: "orchestrator_subagent",
        payload: {
          kind: "chat_progress",
          source: "runtime_status",
          trigger: "mode.selection",
          summary: "已选择单智能体模式，我准备好了",
        },
      }],
      artifacts: [],
      activeAgents: [],
      queueSummary: { mode: "dag", pending: 0, inProgress: 1, completed: 0, topics: [] },
      sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
      busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
      pendingClarifications: [],
      pendingApprovals: [],
      updatedAt: createdAt,
    } as unknown as OraStateSnapshot;

    const transcript = [{
      id: "run-runtime-status:user",
      sessionId: "session-runtime-status",
      runId: "run-runtime-status",
      turnIndex: 1,
      role: "user" as const,
      content: "安装 skills",
      pattern: "orchestrator_subagent" as const,
      modeId: SINGLE_AGENT_MODE_ID,
      createdAt,
    }];
    const statusMessage = adaptChatMessages(transcript, { "run-runtime-status": baseSnapshot })
      .find((message) => message.role === "assistant");
    const deltaMessage = adaptChatMessages(transcript, {
      "run-runtime-status": {
        ...baseSnapshot,
        events: [
          ...baseSnapshot.events,
          {
            id: "run-runtime-status:evt-1",
            runId: "run-runtime-status",
            seq: 1,
            type: "message.delta",
            createdAt: createdAt + 1_000,
            pattern: "orchestrator_subagent",
            payload: { role: "assistant", content: "我会先", delta: "我会先", streaming: true },
          },
          {
            id: "run-runtime-status:evt-2",
            runId: "run-runtime-status",
            seq: 2,
            type: "message.delta",
            createdAt: createdAt + 2_000,
            pattern: "orchestrator_subagent",
            payload: { role: "assistant", content: "读取这些 skill。", delta: "读取这些 skill。", streaming: true },
          },
        ],
      } as unknown as OraStateSnapshot,
    }).find((message) => message.role === "assistant");
    const placeholderMessage = adaptChatMessages(transcript, {
      "run-runtime-status": {
        ...baseSnapshot,
        events: [{
          ...baseSnapshot.events[0],
          payload: {
            kind: "chat_progress",
            source: "runtime_status",
            trigger: "running_model",
            summary: "正在努力",
          },
        }],
      } as unknown as OraStateSnapshot,
    }).find((message) => message.role === "assistant");
    const internalStatusMessage = adaptChatMessages(transcript, {
      "run-runtime-status": {
        ...baseSnapshot,
        events: [{
          ...baseSnapshot.events[0],
          payload: {
            kind: "chat_progress",
            source: "runtime_status",
            trigger: "plan_list.incomplete",
            summary: "Plan list still has unfinished steps; continuing the run.",
            audience: "internal",
          },
        }],
      } as unknown as OraStateSnapshot,
    }).find((message) => message.role === "assistant");

    expect(statusMessage?.content).toBe("");
    expect(statusMessage?.turn?.liveProgressText).toBeUndefined();
    expect(statusMessage?.turn?.timelineItems).toEqual([]);
    expect(deltaMessage?.content).toBe("我会先读取这些 skill。");
    expect(deltaMessage?.content).not.toBe(deltaMessage?.turn?.liveProgressText);
    expect(deltaMessage?.content).not.toContain("已选择单智能体模式");
    expect(deltaMessage?.turn?.liveProgressText).toBeUndefined();
    expect(placeholderMessage?.content).toBe("");
    expect(placeholderMessage?.turn?.liveProgressText).toBeUndefined();
    expect(internalStatusMessage?.content).toBe("");
    expect(internalStatusMessage?.turn?.liveProgressText).toBeUndefined();
    expect(internalStatusMessage?.turn?.timelineItems).toEqual([]);
  });

  it("renders explicit live message delta buffer text for running turns", () => {
    const createdAt = 1_714_000_000_000;
    const runId = "run-live-buffer-view";
    const sessionId = "session-live-buffer-view";
    const snapshot = {
      runId,
      sessionId,
      turnIndex: 1,
      status: "running",
      pattern: "orchestrator_subagent",
      modeId: SINGLE_AGENT_MODE_ID,
      input: { prompt: "介绍 Ora", createdAt, context: {} },
      config: {
        modeId: SINGLE_AGENT_MODE_ID,
        pattern: "orchestrator_subagent",
        modeSelection: "manual",
        profileIds: ["solo_agent"],
        providerId: "deepseek",
        modelRef: "deepseek-chat",
        approvalMode: "high_risk_only",
        patternOptions: {},
        metadata: {},
        deterministicSeed: "view-model-live-buffer-test",
        skillIds: [],
        toolIds: [],
      },
      topology: { nodes: [], edges: [] },
      profiles: [],
      memory: [],
      plan: [],
      todos: [],
      actions: [],
      toolCalls: [],
      policyDecisions: [],
      checkpoints: [],
      events: [{
        id: `${runId}:evt-0`,
        runId,
        seq: 0,
        type: "message.delta",
        createdAt,
        pattern: "orchestrator_subagent",
        payload: {
          role: "assistant",
          messageId: `${runId}:assistant:solo:solo:0`,
          content: "Hi!",
          delta: "Hi!",
          streaming: true,
        },
      }],
      artifacts: [],
      activeAgents: [],
      queueSummary: { mode: "dag", pending: 0, inProgress: 1, completed: 0, topics: [] },
      sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
      busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
      pendingClarifications: [],
      pendingApprovals: [],
      updatedAt: createdAt,
    } as unknown as OraStateSnapshot;

    const baseMessages = adaptChatMessages(
      [{
        id: `${runId}:user`,
        sessionId,
        runId,
        turnIndex: 1,
        role: "user",
        content: "介绍 Ora",
        pattern: "orchestrator_subagent",
        modeId: SINGLE_AGENT_MODE_ID,
        createdAt,
      }],
      { [runId]: snapshot },
    );
    const assistant = adaptRenderableChatMessages({
      transcript: [],
      turnSnapshots: { [runId]: snapshot },
      selectedSessionId: sessionId,
      baseMessages,
      liveMessageDeltas: {
        [`${runId}:${runId}:assistant:solo:solo:0`]: {
          runId,
          messageId: `${runId}:assistant:solo:solo:0`,
          sessionId,
          role: "assistant",
          content: "Hi! I'm Ora.",
          agentId: "solo",
          nodeId: "solo",
          createdAt,
          updatedAt: createdAt + 100,
        },
      },
    }).find((message) => message.role === "assistant");

    expect(baseMessages.find((message) => message.role === "assistant")?.content).toBe("Hi!");
    expect(assistant?.content).toBe("Hi! I'm Ora.");
    expect(assistant?.isPlaceholder).toBe(true);
  });

  it("appends live assistant text to timeline when snapshot timeline has previous assistant text", () => {
    const createdAt = 1_714_000_000_000;
    const runId = "run-live-timeline-overlay";
    const sessionId = "session-live-timeline-overlay";
    const firstMessageId = `${runId}:assistant:solo:solo:0`;
    const secondMessageId = `${runId}:assistant:solo:solo:1`;
    const snapshot = {
      runId,
      sessionId,
      turnIndex: 1,
      status: "running",
      pattern: "orchestrator_subagent",
      modeId: SINGLE_AGENT_MODE_ID,
      input: { prompt: "继续输出", createdAt, context: {} },
      config: {
        modeId: SINGLE_AGENT_MODE_ID,
        pattern: "orchestrator_subagent",
        modeSelection: "manual",
        profileIds: ["solo_agent"],
        providerId: "deepseek",
        modelRef: "deepseek-chat",
        approvalMode: "high_risk_only",
        patternOptions: {},
        metadata: {},
        deterministicSeed: "view-model-live-timeline-overlay-test",
        skillIds: [],
        toolIds: [],
      },
      topology: { nodes: [], edges: [] },
      profiles: [],
      memory: [],
      plan: [],
      todos: [],
      actions: [],
      toolCalls: [],
      policyDecisions: [],
      checkpoints: [],
      events: [{
        id: `${runId}:evt-0`,
        runId,
        seq: 0,
        type: "message.delta",
        agentId: "solo",
        nodeId: "solo",
        createdAt,
        pattern: "orchestrator_subagent",
        payload: { role: "assistant", messageId: firstMessageId, content: "前一段。", delta: "前一段。", streaming: true, phase: "stream" },
      }],
      artifacts: [],
      activeAgents: [],
      queueSummary: { mode: "dag", pending: 0, inProgress: 1, completed: 0, topics: [] },
      sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
      busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
      pendingClarifications: [],
      pendingApprovals: [],
      updatedAt: createdAt + 100,
    } as unknown as OraStateSnapshot;
    const baseMessages = adaptChatMessages(
      [{
        id: `${runId}:user`,
        sessionId,
        runId,
        turnIndex: 1,
        role: "user",
        content: "继续输出",
        pattern: "orchestrator_subagent",
        modeId: SINGLE_AGENT_MODE_ID,
        createdAt,
      }],
      { [runId]: snapshot },
    );

    const assistant = adaptRenderableChatMessages({
      transcript: [],
      turnSnapshots: { [runId]: snapshot },
      selectedSessionId: sessionId,
      baseMessages,
      liveMessageDeltas: {
        [`${runId}:${secondMessageId}`]: {
          runId,
          messageId: secondMessageId,
          sessionId,
          role: "assistant",
          content: "后一段。",
          agentId: "solo",
          nodeId: "solo",
          createdAt: createdAt + 200,
          updatedAt: createdAt + 200,
        },
      },
    }).find((message) => message.role === "assistant");
    const timelineText = assistant?.turn?.timelineItems
      ?.flatMap((item) => item.kind === "assistant_text" ? [item.content] : []) ?? [];

    expect(assistant?.content).toBe("后一段。");
    expect(timelineText).toEqual(["前一段。", "后一段。"]);
  });

  it("keeps live same-message delta overlay as one timeline item", () => {
    const createdAt = 1_714_000_000_000;
    const runId = "run-live-timeline-one-item";
    const sessionId = "session-live-timeline-one-item";
    const messageId = `${runId}:assistant:solo:solo:0`;
    const snapshot = {
      runId,
      sessionId,
      turnIndex: 1,
      status: "running",
      pattern: "orchestrator_subagent",
      modeId: SINGLE_AGENT_MODE_ID,
      input: { prompt: "介绍 Ora", createdAt, context: {} },
      config: {
        modeId: SINGLE_AGENT_MODE_ID,
        pattern: "orchestrator_subagent",
        modeSelection: "manual",
        profileIds: ["solo_agent"],
        providerId: "deepseek",
        modelRef: "deepseek-chat",
        approvalMode: "high_risk_only",
        patternOptions: {},
        metadata: {},
        deterministicSeed: "view-model-live-timeline-one-item-test",
        skillIds: [],
        toolIds: [],
      },
      topology: { nodes: [], edges: [] },
      profiles: [],
      memory: [],
      plan: [],
      todos: [],
      actions: [],
      toolCalls: [],
      policyDecisions: [],
      checkpoints: [],
      events: [],
      artifacts: [],
      activeAgents: [],
      queueSummary: { mode: "dag", pending: 0, inProgress: 1, completed: 0, topics: [] },
      sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
      busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
      pendingClarifications: [],
      pendingApprovals: [],
      updatedAt: createdAt,
    } as unknown as OraStateSnapshot;
    const baseMessages = adaptChatMessages(
      [{
        id: `${runId}:user`,
        sessionId,
        runId,
        turnIndex: 1,
        role: "user",
        content: "介绍 Ora",
        pattern: "orchestrator_subagent",
        modeId: SINGLE_AGENT_MODE_ID,
        createdAt,
      }],
      { [runId]: snapshot },
    );

    const renderWithContent = (content: string) => adaptRenderableChatMessages({
      transcript: [],
      turnSnapshots: { [runId]: snapshot },
      selectedSessionId: sessionId,
      baseMessages,
      liveMessageDeltas: {
        [`${runId}:${messageId}`]: {
          runId,
          messageId,
          sessionId,
          role: "assistant",
          content,
          agentId: "solo",
          nodeId: "solo",
          createdAt,
          updatedAt: createdAt + content.length,
        },
      },
    }).find((message) => message.role === "assistant");

    const first = renderWithContent("Hi");
    const second = renderWithContent("Hi there");
    const firstTimelineText = first?.turn?.timelineItems
      ?.flatMap((item) => item.kind === "assistant_text" ? [item.content] : []) ?? [];
    const secondTimelineText = second?.turn?.timelineItems
      ?.flatMap((item) => item.kind === "assistant_text" ? [item.content] : []) ?? [];

    expect(firstTimelineText).toEqual(["Hi"]);
    expect(secondTimelineText).toEqual(["Hi there"]);
    expect(second?.content).toBe("Hi there");
  });

  it("upgrades snapshot partial text instead of appending duplicated live same-message text", () => {
    const createdAt = 1_714_000_000_000;
    const runId = "run-live-timeline-prefix-upgrade";
    const sessionId = "session-live-timeline-prefix-upgrade";
    const messageId = `${runId}:assistant:solo:solo:0`;
    const snapshot = {
      runId,
      sessionId,
      turnIndex: 1,
      status: "running",
      pattern: "orchestrator_subagent",
      modeId: SINGLE_AGENT_MODE_ID,
      input: { prompt: "介绍 Ora", createdAt, context: {} },
      config: {
        modeId: SINGLE_AGENT_MODE_ID,
        pattern: "orchestrator_subagent",
        modeSelection: "manual",
        profileIds: ["solo_agent"],
        providerId: "deepseek",
        modelRef: "deepseek-chat",
        approvalMode: "high_risk_only",
        patternOptions: {},
        metadata: {},
        deterministicSeed: "view-model-live-prefix-upgrade-test",
        skillIds: [],
        toolIds: [],
      },
      topology: { nodes: [], edges: [] },
      profiles: [],
      memory: [],
      plan: [],
      todos: [],
      actions: [],
      toolCalls: [],
      policyDecisions: [],
      checkpoints: [],
      events: [{
        id: `${runId}:evt-0`,
        runId,
        seq: 0,
        type: "message.delta",
        agentId: "solo",
        nodeId: "solo",
        createdAt,
        pattern: "orchestrator_subagent",
        payload: { role: "assistant", messageId, content: "这是我", delta: "这是我", streaming: true, phase: "stream" },
      }],
      artifacts: [],
      activeAgents: [],
      queueSummary: { mode: "dag", pending: 0, inProgress: 1, completed: 0, topics: [] },
      sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
      busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
      pendingClarifications: [],
      pendingApprovals: [],
      updatedAt: createdAt + 100,
    } as unknown as OraStateSnapshot;
    const baseMessages = adaptChatMessages(
      [{
        id: `${runId}:user`,
        sessionId,
        runId,
        turnIndex: 1,
        role: "user",
        content: "介绍 Ora",
        pattern: "orchestrator_subagent",
        modeId: SINGLE_AGENT_MODE_ID,
        createdAt,
      }],
      { [runId]: snapshot },
    );

    const assistant = adaptRenderableChatMessages({
      transcript: [],
      turnSnapshots: { [runId]: snapshot },
      selectedSessionId: sessionId,
      baseMessages,
      liveMessageDeltas: {
        [`${runId}:${messageId}`]: {
          runId,
          messageId,
          sessionId,
          role: "assistant",
          content: "这是我根据之前与用户的互动经验整理出的说明。",
          agentId: "solo",
          nodeId: "solo",
          createdAt,
          updatedAt: createdAt + 200,
        },
      },
    }).find((message) => message.role === "assistant");
    const timelineText = assistant?.turn?.timelineItems
      ?.flatMap((item) => item.kind === "assistant_text" ? [item.content] : []) ?? [];

    expect(assistant?.content).toBe("这是我根据之前与用户的互动经验整理出的说明。");
    expect(timelineText).toEqual(["这是我根据之前与用户的互动经验整理出的说明。"]);
  });

  it("updates the matching timeline item when live text targets a later assistant message id", () => {
    const createdAt = 1_714_000_000_000;
    const runId = "run-live-timeline-multi-message";
    const sessionId = "session-live-timeline-multi-message";
    const firstMessageId = `${runId}:assistant:solo:solo:0`;
    const secondMessageId = `${runId}:assistant:solo:solo:1`;
    const snapshot = {
      runId,
      sessionId,
      turnIndex: 1,
      status: "running",
      pattern: "orchestrator_subagent",
      modeId: SINGLE_AGENT_MODE_ID,
      input: { prompt: "继续", createdAt, context: {} },
      config: {
        modeId: SINGLE_AGENT_MODE_ID,
        pattern: "orchestrator_subagent",
        modeSelection: "manual",
        profileIds: ["solo_agent"],
        providerId: "deepseek",
        modelRef: "deepseek-chat",
        approvalMode: "high_risk_only",
        patternOptions: {},
        metadata: {},
        deterministicSeed: "view-model-live-multi-message-test",
        skillIds: [],
        toolIds: [],
      },
      topology: { nodes: [], edges: [] },
      profiles: [],
      memory: [],
      plan: [],
      todos: [],
      actions: [],
      toolCalls: [],
      policyDecisions: [],
      checkpoints: [],
      events: [
        {
          id: `${runId}:evt-0`,
          runId,
          seq: 0,
          type: "message.delta",
          agentId: "solo",
          nodeId: "solo",
          createdAt,
          pattern: "orchestrator_subagent",
          payload: { role: "assistant", messageId: firstMessageId, content: "第一段说明。", delta: "第一段说明。", streaming: true, phase: "stream" },
        },
        {
          id: `${runId}:evt-1`,
          runId,
          seq: 1,
          type: "message.delta",
          agentId: "solo",
          nodeId: "solo",
          createdAt: createdAt + 10,
          pattern: "orchestrator_subagent",
          payload: { role: "assistant", messageId: secondMessageId, content: "第二段", delta: "第二段", streaming: true, phase: "stream" },
        },
      ],
      artifacts: [],
      activeAgents: [],
      queueSummary: { mode: "dag", pending: 0, inProgress: 1, completed: 0, topics: [] },
      sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
      busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
      pendingClarifications: [],
      pendingApprovals: [],
      updatedAt: createdAt + 100,
    } as unknown as OraStateSnapshot;
    const baseMessages = adaptChatMessages(
      [{
        id: `${runId}:user`,
        sessionId,
        runId,
        turnIndex: 1,
        role: "user",
        content: "继续",
        pattern: "orchestrator_subagent",
        modeId: SINGLE_AGENT_MODE_ID,
        createdAt,
      }],
      { [runId]: snapshot },
    );

    const assistant = adaptRenderableChatMessages({
      transcript: [],
      turnSnapshots: { [runId]: snapshot },
      selectedSessionId: sessionId,
      baseMessages,
      liveMessageDeltas: {
        [`${runId}:${secondMessageId}`]: {
          runId,
          messageId: secondMessageId,
          sessionId,
          role: "assistant",
          content: "第二段已经补全。",
          agentId: "solo",
          nodeId: "solo",
          createdAt: createdAt + 10,
          updatedAt: createdAt + 200,
        },
      },
    }).find((message) => message.role === "assistant");
    const timelineText = assistant?.turn?.timelineItems
      ?.flatMap((item) => item.kind === "assistant_text" ? [item.content] : []) ?? [];

    expect(timelineText).toEqual(["第一段说明。", "第二段已经补全。"]);
    expect(assistant?.content).toBe("第二段已经补全。");
  });

  it("does not downgrade merged snapshot text with shorter live same-message text", () => {
    const createdAt = 1_714_000_000_000;
    const runId = "run-live-timeline-no-downgrade";
    const sessionId = "session-live-timeline-no-downgrade";
    const messageId = `${runId}:assistant:solo:solo:0`;
    const snapshot = {
      runId,
      sessionId,
      turnIndex: 1,
      status: "running",
      pattern: "orchestrator_subagent",
      modeId: SINGLE_AGENT_MODE_ID,
      input: { prompt: "继续", createdAt, context: {} },
      config: {
        modeId: SINGLE_AGENT_MODE_ID,
        pattern: "orchestrator_subagent",
        modeSelection: "manual",
        profileIds: ["solo_agent"],
        providerId: "deepseek",
        modelRef: "deepseek-chat",
        approvalMode: "high_risk_only",
        patternOptions: {},
        metadata: {},
        deterministicSeed: "view-model-live-no-downgrade-test",
        skillIds: [],
        toolIds: [],
      },
      topology: { nodes: [], edges: [] },
      profiles: [],
      memory: [],
      plan: [],
      todos: [],
      actions: [],
      toolCalls: [],
      policyDecisions: [],
      checkpoints: [],
      events: [
        {
          id: `${runId}:evt-0`,
          runId,
          seq: 0,
          type: "message.delta",
          agentId: "solo",
          nodeId: "solo",
          createdAt,
          pattern: "orchestrator_subagent",
          payload: { role: "assistant", messageId, content: "Let", delta: "Let", streaming: true, phase: "stream" },
        },
        {
          id: `${runId}:evt-1`,
          runId,
          seq: 1,
          type: "message.delta",
          agentId: "solo",
          nodeId: "solo",
          createdAt: createdAt + 10,
          pattern: "orchestrator_subagent",
          payload: { role: "assistant", messageId, content: " me continue.", delta: " me continue.", streaming: true, phase: "stream" },
        },
      ],
      artifacts: [],
      activeAgents: [],
      queueSummary: { mode: "dag", pending: 0, inProgress: 1, completed: 0, topics: [] },
      sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
      busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
      pendingClarifications: [],
      pendingApprovals: [],
      updatedAt: createdAt + 100,
    } as unknown as OraStateSnapshot;
    const baseMessages = adaptChatMessages(
      [{
        id: `${runId}:user`,
        sessionId,
        runId,
        turnIndex: 1,
        role: "user",
        content: "继续",
        pattern: "orchestrator_subagent",
        modeId: SINGLE_AGENT_MODE_ID,
        createdAt,
      }],
      { [runId]: snapshot },
    );

    const assistant = adaptRenderableChatMessages({
      transcript: [],
      turnSnapshots: { [runId]: snapshot },
      selectedSessionId: sessionId,
      baseMessages,
      liveMessageDeltas: {
        [`${runId}:${messageId}`]: {
          runId,
          messageId,
          sessionId,
          role: "assistant",
          content: "Let",
          agentId: "solo",
          nodeId: "solo",
          createdAt,
          updatedAt: createdAt + 200,
        },
      },
    }).find((message) => message.role === "assistant");
    const timelineText = assistant?.turn?.timelineItems
      ?.flatMap((item) => item.kind === "assistant_text" ? [item.content] : []) ?? [];

    expect(timelineText).toEqual(["Let me continue."]);
    expect(assistant?.content).toBe("Let");
  });

  it("does not mutate cached base messages while overlaying live message delta text", () => {
    const createdAt = 1_714_000_000_000;
    const runId = "run-live-buffer-cache";
    const sessionId = "session-live-buffer-cache";
    const snapshot = {
      runId,
      sessionId,
      turnIndex: 1,
      status: "running",
      pattern: "orchestrator_subagent",
      modeId: SINGLE_AGENT_MODE_ID,
      input: { prompt: "介绍 Ora", createdAt, context: {} },
      config: {
        modeId: SINGLE_AGENT_MODE_ID,
        pattern: "orchestrator_subagent",
        modeSelection: "manual",
        profileIds: ["solo_agent"],
        providerId: "deepseek",
        modelRef: "deepseek-chat",
        approvalMode: "high_risk_only",
        patternOptions: {},
        metadata: {},
        deterministicSeed: "view-model-live-buffer-cache-test",
        skillIds: [],
        toolIds: [],
      },
      topology: { nodes: [], edges: [] },
      profiles: [],
      memory: [],
      plan: [],
      todos: [],
      actions: [],
      toolCalls: [],
      policyDecisions: [],
      checkpoints: [],
      events: [{
        id: `${runId}:evt-0`,
        runId,
        seq: 0,
        type: "message.delta",
        createdAt,
        pattern: "orchestrator_subagent",
        payload: {
          role: "assistant",
          messageId: `${runId}:assistant:solo:solo:0`,
          content: "Hi!",
          delta: "Hi!",
          streaming: true,
        },
      }],
      artifacts: [],
      activeAgents: [],
      queueSummary: { mode: "dag", pending: 0, inProgress: 1, completed: 0, topics: [] },
      sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
      busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
      pendingClarifications: [],
      pendingApprovals: [],
      updatedAt: createdAt,
    } as unknown as OraStateSnapshot;

    const baseMessages = adaptChatMessages(
      [{
        id: `${runId}:user`,
        sessionId,
        runId,
        turnIndex: 1,
        role: "user",
        content: "介绍 Ora",
        pattern: "orchestrator_subagent",
        modeId: SINGLE_AGENT_MODE_ID,
        createdAt,
      }],
      { [runId]: snapshot },
    );
    const rendered = adaptRenderableChatMessages({
      transcript: [],
      turnSnapshots: { [runId]: snapshot },
      selectedSessionId: sessionId,
      baseMessages,
      liveMessageDeltas: {
        [`${runId}:${runId}:assistant:solo:solo:0`]: {
          runId,
          messageId: `${runId}:assistant:solo:solo:0`,
          sessionId,
          role: "assistant",
          content: "Hi! I'm Ora.",
          agentId: "solo",
          nodeId: "solo",
          createdAt,
          updatedAt: createdAt + 100,
        },
      },
    });

    expect(rendered).not.toBe(baseMessages);
    expect(baseMessages.find((message) => message.role === "assistant")?.content).toBe("Hi!");
    expect(rendered.find((message) => message.role === "assistant")?.content).toBe("Hi! I'm Ora.");
  });

  it("segments live assistant deltas by agent and ignores final cumulative content events", () => {
    const createdAt = 1_714_000_000_000;
    const snapshot = {
      runId: "run-channel-live-deltas",
      sessionId: "session-channel-live-deltas",
      turnIndex: 1,
      status: "running",
      pattern: "orchestrator_subagent",
      modeId: SINGLE_AGENT_MODE_ID,
      input: { prompt: "你能联网搜索吗？", createdAt, context: {} },
      config: {
        modeId: SINGLE_AGENT_MODE_ID,
        pattern: "orchestrator_subagent",
        modeSelection: "manual",
        profileIds: ["solo_agent"],
        providerId: "deepseek",
        modelRef: "deepseek-v4-pro",
        approvalMode: "high_risk_only",
        patternOptions: {},
        metadata: {},
        deterministicSeed: "view-model-channel-live-deltas-test",
        skillIds: [],
        toolIds: [],
      },
      topology: { nodes: [], edges: [] },
      profiles: [],
      memory: [],
      plan: [],
      todos: [],
      actions: [],
      toolCalls: [],
      policyDecisions: [],
      checkpoints: [],
      events: [
        {
          id: "run-channel-live-deltas:evt-1",
          runId: "run-channel-live-deltas",
          seq: 1,
          type: "message.delta",
          agentId: "orchestrator",
          createdAt: createdAt + 1_000,
          pattern: "orchestrator_subagent",
          payload: { role: "assistant", content: "草稿", delta: "草稿", streaming: true },
        },
        {
          id: "run-channel-live-deltas:evt-2",
          runId: "run-channel-live-deltas",
          seq: 2,
          type: "message.delta",
          agentId: "orchestrator",
          createdAt: createdAt + 2_000,
          pattern: "orchestrator_subagent",
          payload: { role: "assistant", content: "。", delta: "。", streaming: true },
        },
        {
          id: "run-channel-live-deltas:evt-3",
          runId: "run-channel-live-deltas",
          seq: 3,
          type: "message.delta",
          agentId: "orchestrator",
          createdAt: createdAt + 3_000,
          pattern: "orchestrator_subagent",
          payload: { role: "assistant", content: "草稿。", streaming: false },
        },
        {
          id: "run-channel-live-deltas:evt-4",
          runId: "run-channel-live-deltas",
          seq: 4,
          type: "message.delta",
          agentId: "researcher",
          createdAt: createdAt + 4_000,
          pattern: "orchestrator_subagent",
          payload: { role: "assistant", content: "研究结论。", streaming: false },
        },
        {
          id: "run-channel-live-deltas:evt-5",
          runId: "run-channel-live-deltas",
          seq: 5,
          type: "message.delta",
          agentId: "orchestrator",
          createdAt: createdAt + 5_000,
          pattern: "orchestrator_subagent",
          payload: { role: "assistant", content: "最终", delta: "最终", streaming: true },
        },
        {
          id: "run-channel-live-deltas:evt-6",
          runId: "run-channel-live-deltas",
          seq: 6,
          type: "message.delta",
          agentId: "orchestrator",
          createdAt: createdAt + 6_000,
          pattern: "orchestrator_subagent",
          payload: { role: "assistant", content: "回答。", delta: "回答。", streaming: true },
        },
        {
          id: "run-channel-live-deltas:evt-7",
          runId: "run-channel-live-deltas",
          seq: 7,
          type: "message.delta",
          agentId: "orchestrator",
          createdAt: createdAt + 7_000,
          pattern: "orchestrator_subagent",
          payload: { role: "assistant", content: "最终回答。", streaming: false },
        },
      ],
      artifacts: [],
      activeAgents: [],
      queueSummary: { mode: "dag", pending: 0, inProgress: 1, completed: 0, topics: [] },
      sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
      busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
      pendingClarifications: [],
      pendingApprovals: [],
      updatedAt: createdAt + 7_000,
    } as unknown as OraStateSnapshot;

    const assistant = adaptChatMessages(
      [{
        id: "run-channel-live-deltas:user",
        sessionId: "session-channel-live-deltas",
        runId: "run-channel-live-deltas",
        turnIndex: 1,
        role: "user",
        content: "你能联网搜索吗？",
        pattern: "orchestrator_subagent",
        modeId: SINGLE_AGENT_MODE_ID,
        createdAt,
      }],
      { "run-channel-live-deltas": snapshot },
    ).find((message) => message.role === "assistant");
    const timelineText = assistant?.turn?.timelineItems
      ?.flatMap((item) => item.kind === "assistant_text" ? [item.content] : []) ?? [];

    expect(assistant?.content).toBe("最终回答。");
    expect(timelineText).toEqual(["草稿。", "研究结论。", "最终回答。"]);
  });

  it("does not duplicate streaming body when a running snapshot receives cumulative content-only events", () => {
    const createdAt = 1_714_000_000_000;
    const runId = "run-running-cumulative-content";
    const sessionId = "session-running-cumulative-content";
    const messageId = `${runId}:assistant:solo:solo:0`;
    const snapshot = {
      runId,
      sessionId,
      turnIndex: 1,
      status: "running",
      pattern: "orchestrator_subagent",
      modeId: SINGLE_AGENT_MODE_ID,
      input: { prompt: "介绍 Ora", createdAt, context: {} },
      config: {
        modeId: SINGLE_AGENT_MODE_ID,
        pattern: "orchestrator_subagent",
        modeSelection: "manual",
        profileIds: ["solo_agent"],
        providerId: "deepseek",
        modelRef: "deepseek-chat",
        approvalMode: "high_risk_only",
        patternOptions: {},
        metadata: {},
        deterministicSeed: "view-model-running-cumulative-content-test",
        skillIds: [],
        toolIds: [],
      },
      topology: { nodes: [], edges: [] },
      profiles: [],
      memory: [],
      plan: [],
      todos: [],
      actions: [],
      toolCalls: [],
      policyDecisions: [],
      checkpoints: [],
      events: [
        {
          id: `${runId}:evt-0`,
          runId,
          seq: 0,
          type: "message.delta",
          agentId: "solo",
          createdAt,
          pattern: "orchestrator_subagent",
          payload: { role: "assistant", messageId, content: "Hi", delta: "Hi", streaming: true },
        },
        {
          id: `${runId}:evt-1`,
          runId,
          seq: 1,
          type: "message.delta",
          agentId: "solo",
          createdAt: createdAt + 100,
          pattern: "orchestrator_subagent",
          payload: { role: "assistant", messageId, content: " there", delta: " there", streaming: true },
        },
        {
          id: `${runId}:evt-2`,
          runId,
          seq: 2,
          type: "message.delta",
          agentId: "solo",
          createdAt: createdAt + 200,
          pattern: "orchestrator_subagent",
          payload: { role: "assistant", messageId, content: "Hi there", streaming: false },
        },
      ],
      artifacts: [],
      activeAgents: [],
      queueSummary: { mode: "dag", pending: 0, inProgress: 1, completed: 0, topics: [] },
      sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
      busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
      pendingClarifications: [],
      pendingApprovals: [],
      updatedAt: createdAt + 200,
    } as unknown as OraStateSnapshot;

    const assistant = adaptChatMessages(
      [{
        id: `${runId}:user`,
        sessionId,
        runId,
        turnIndex: 1,
        role: "user",
        content: "介绍 Ora",
        pattern: "orchestrator_subagent",
        modeId: SINGLE_AGENT_MODE_ID,
        createdAt,
      }],
      { [runId]: snapshot },
    ).find((message) => message.role === "assistant");

    expect(assistant?.content).toBe("Hi there");
  });

  it("does not overlay live text into the timeline when the current body already represents it", () => {
    const createdAt = 1_714_000_000_000;
    const runId = "run-live-overlay-body-dedupe";
    const sessionId = "session-live-overlay-body-dedupe";
    const messageId = `${runId}:assistant:solo:solo:0`;
    const snapshot = {
      runId,
      sessionId,
      turnIndex: 1,
      status: "running",
      pattern: "orchestrator_subagent",
      modeId: SINGLE_AGENT_MODE_ID,
      input: { prompt: "介绍 Ora", createdAt, context: {} },
      config: {
        modeId: SINGLE_AGENT_MODE_ID,
        pattern: "orchestrator_subagent",
        modeSelection: "manual",
        profileIds: ["solo_agent"],
        providerId: "deepseek",
        modelRef: "deepseek-chat",
        approvalMode: "high_risk_only",
        patternOptions: {},
        metadata: {},
        deterministicSeed: "view-model-live-overlay-body-dedupe-test",
        skillIds: [],
        toolIds: [],
      },
      topology: { nodes: [], edges: [] },
      profiles: [],
      memory: [],
      plan: [],
      todos: [],
      actions: [],
      toolCalls: [],
      policyDecisions: [],
      checkpoints: [],
      events: [],
      artifacts: [],
      activeAgents: [],
      queueSummary: { mode: "dag", pending: 0, inProgress: 1, completed: 0, topics: [] },
      sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
      busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
      pendingClarifications: [],
      pendingApprovals: [],
      updatedAt: createdAt + 100,
    } as unknown as OraStateSnapshot;
    const baseMessages = adaptChatMessages(
      [{
        id: `${runId}:user`,
        sessionId,
        runId,
        turnIndex: 1,
        role: "user",
        content: "介绍 Ora",
        pattern: "orchestrator_subagent",
        modeId: SINGLE_AGENT_MODE_ID,
        createdAt,
      }],
      { [runId]: snapshot },
    ).map((message) =>
      message.role === "assistant"
        ? { ...message, content: "Hi there" }
        : message
    );

    const assistant = adaptRenderableChatMessages({
      transcript: [],
      turnSnapshots: { [runId]: snapshot },
      selectedSessionId: sessionId,
      baseMessages,
      liveMessageDeltas: {
        [`${runId}:${messageId}`]: {
          runId,
          messageId,
          sessionId,
          role: "assistant",
          content: "Hi there",
          agentId: "solo",
          nodeId: "solo",
          createdAt,
          updatedAt: createdAt + 200,
        },
      },
    }).find((message) => message.role === "assistant");
    const timelineText = assistant?.turn?.timelineItems
      ?.flatMap((item) => item.kind === "assistant_text" ? [item.content] : []) ?? [];

    expect(assistant?.content).toBe("Hi there");
    expect(timelineText.filter((content) => content === "Hi there")).toHaveLength(0);
  });

  it("uses the latest messageId instead of concatenating same-agent streaming invocations", () => {
    const createdAt = 1_714_000_000_000;
    const runId = "run-same-agent-messageid-reset";
    const sessionId = "session-same-agent-messageid-reset";
    const snapshot = {
      runId,
      sessionId,
      turnIndex: 1,
      status: "running",
      pattern: "orchestrator_subagent",
      modeId: SINGLE_AGENT_MODE_ID,
      input: { prompt: "记录 task", createdAt, context: {} },
      config: {
        modeId: SINGLE_AGENT_MODE_ID,
        pattern: "orchestrator_subagent",
        modeSelection: "manual",
        profileIds: ["orchestrator"],
        providerId: "deepseek",
        modelRef: "deepseek-chat",
        approvalMode: "high_risk_only",
        patternOptions: {},
        metadata: {},
        deterministicSeed: "view-model-same-agent-messageid-reset-test",
        skillIds: [],
        toolIds: [],
      },
      topology: { nodes: [], edges: [] },
      profiles: [],
      memory: [],
      plan: [],
      todos: [],
      actions: [],
      toolCalls: [],
      policyDecisions: [],
      checkpoints: [],
      events: [
        {
          id: `${runId}:evt-0`,
          runId,
          seq: 0,
          type: "message.delta",
          agentId: "orchestrator",
          createdAt,
          pattern: "orchestrator_subagent",
          payload: { role: "assistant", messageId: `${runId}:assistant:orchestrator:decompose:1`, content: "已有 task。", delta: "已有 task。", streaming: true, phase: "stream" },
        },
        {
          id: `${runId}:evt-1`,
          runId,
          seq: 1,
          type: "message.delta",
          agentId: "orchestrator",
          createdAt: createdAt + 100,
          pattern: "orchestrator_subagent",
          payload: { role: "assistant", messageId: `${runId}:assistant:orchestrator:decompose:2`, content: "任务文件已生成。", delta: "任务文件已生成。", streaming: true, phase: "stream" },
        },
        {
          id: `${runId}:evt-2`,
          runId,
          seq: 2,
          type: "message.delta",
          agentId: "orchestrator",
          createdAt: createdAt + 200,
          pattern: "orchestrator_subagent",
          payload: { role: "assistant", messageId: `${runId}:assistant:orchestrator:decompose:action-1`, content: "任务文件已生成。", streaming: false, phase: "final" },
        },
      ],
      artifacts: [],
      activeAgents: [],
      queueSummary: { mode: "dag", pending: 0, inProgress: 1, completed: 0, topics: [] },
      sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
      busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
      pendingClarifications: [],
      pendingApprovals: [],
      updatedAt: createdAt + 200,
    } as unknown as OraStateSnapshot;

    const assistant = adaptChatMessages(
      [{
        id: `${runId}:user`,
        sessionId,
        runId,
        turnIndex: 1,
        role: "user",
        content: "记录 task",
        pattern: "orchestrator_subagent",
        modeId: SINGLE_AGENT_MODE_ID,
        createdAt,
      }],
      { [runId]: snapshot },
    ).find((message) => message.role === "assistant");

    expect(assistant?.content).toBe("任务文件已生成。");
    expect(assistant?.content).not.toContain("已有 task");
  });

  it("does not duplicate final action text after equivalent streaming timeline text", () => {
    const createdAt = 1_714_000_000_000;
    const runId = "run-final-action-dedupes-timeline";
    const sessionId = "session-final-action-dedupes-timeline";
    const snapshot = {
      runId,
      sessionId,
      turnIndex: 1,
      status: "running",
      pattern: "orchestrator_subagent",
      modeId: SINGLE_AGENT_MODE_ID,
      input: { prompt: "汇总结论", createdAt, context: {} },
      config: {
        modeId: SINGLE_AGENT_MODE_ID,
        pattern: "orchestrator_subagent",
        modeSelection: "manual",
        profileIds: ["researcher"],
        providerId: "deepseek",
        modelRef: "deepseek-chat",
        approvalMode: "high_risk_only",
        patternOptions: {},
        metadata: {},
        deterministicSeed: "view-model-final-action-dedupes-timeline-test",
        skillIds: [],
        toolIds: [],
      },
      topology: { nodes: [], edges: [] },
      profiles: [],
      memory: [],
      plan: [],
      todos: [],
      actions: [],
      toolCalls: [],
      policyDecisions: [],
      checkpoints: [],
      events: [
        {
          id: `${runId}:evt-0`,
          runId,
          seq: 0,
          type: "message.delta",
          agentId: "researcher",
          createdAt,
          pattern: "orchestrator_subagent",
          payload: { role: "assistant", messageId: `${runId}:assistant:researcher:research:4`, content: "文件已就绪。", delta: "文件已就绪。", streaming: true, phase: "stream" },
        },
        {
          id: `${runId}:evt-1`,
          runId,
          seq: 1,
          type: "tool.called",
          agentId: "researcher",
          createdAt: createdAt + 100,
          pattern: "orchestrator_subagent",
          payload: { toolId: "file.read", status: "succeeded", title: "读取任务文件" },
        },
        {
          id: `${runId}:evt-2`,
          runId,
          seq: 2,
          type: "message.delta",
          agentId: "researcher",
          createdAt: createdAt + 200,
          pattern: "orchestrator_subagent",
          payload: { role: "assistant", messageId: `${runId}:assistant:researcher:research:action-1`, content: "文件已就绪。", streaming: false, phase: "final" },
        },
      ],
      artifacts: [],
      activeAgents: [],
      queueSummary: { mode: "dag", pending: 0, inProgress: 1, completed: 0, topics: [] },
      sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
      busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
      pendingClarifications: [],
      pendingApprovals: [],
      updatedAt: createdAt + 200,
    } as unknown as OraStateSnapshot;

    const assistant = adaptChatMessages(
      [{
        id: `${runId}:user`,
        sessionId,
        runId,
        turnIndex: 1,
        role: "user",
        content: "汇总结论",
        pattern: "orchestrator_subagent",
        modeId: SINGLE_AGENT_MODE_ID,
        createdAt,
      }],
      { [runId]: snapshot },
    ).find((message) => message.role === "assistant");
    const timelineText = assistant?.turn?.timelineItems
      ?.flatMap((item) => item.kind === "assistant_text" ? [item.content] : []) ?? [];

    expect(timelineText.filter((content) => content === "文件已就绪。")).toHaveLength(1);
  });

  it("keeps only final repaired output when a tool failure follows a similar assistant draft", () => {
    const createdAt = 1_714_000_000_000;
    const runId = "run-tool-failure-repaired-output";
    const sessionId = "session-tool-failure-repaired-output";
    const draftText = "已记住，QC。你在本对话中我将直接称呼你 QC。如果需要跨会话持久化，可以告诉我我们项目中是否有保存用户信息的配置文件。";
    const finalText = "已记住，QC。在当前会话中我会直接称呼你 QC。由于共享状态写入工具暂时不可用，这个信息目前只在本次对话中生效；如果你需要我跨会话记住，可以告诉我项目里是否有特定的配置文件（如用户设定、SOUL.md 等），我可以帮你更新进去。";
    const snapshot = {
      runId,
      sessionId,
      turnIndex: 1,
      status: "succeeded",
      pattern: "orchestrator_subagent",
      modeId: SINGLE_AGENT_MODE_ID,
      input: { prompt: "我叫QC，记住", createdAt, context: {} },
      config: {
        modeId: SINGLE_AGENT_MODE_ID,
        pattern: "orchestrator_subagent",
        modeSelection: "manual",
        profileIds: ["orchestrator"],
        providerId: "deepseek",
        modelRef: "deepseek-chat",
        approvalMode: "high_risk_only",
        patternOptions: {},
        metadata: {},
        deterministicSeed: "view-model-tool-failure-repaired-output-test",
        skillIds: [],
        toolIds: ["shared_state.write"],
      },
      topology: { nodes: [], edges: [] },
      profiles: [],
      memory: [],
      plan: [],
      todos: [],
      actions: [],
      toolCalls: [],
      policyDecisions: [],
      checkpoints: [],
      events: [
        {
          id: `${runId}:evt-0`,
          runId,
          seq: 0,
          type: "message.delta",
          agentId: "orchestrator",
          createdAt,
          pattern: "orchestrator_subagent",
          payload: { role: "assistant", messageId: `${runId}:assistant:orchestrator:0`, content: draftText },
        },
        {
          id: `${runId}:evt-1`,
          runId,
          seq: 1,
          type: "tool.called",
          agentId: "orchestrator",
          createdAt: createdAt + 100,
          pattern: "orchestrator_subagent",
          payload: {
            toolId: "shared_state.write",
            status: "failed",
            error: "Unsupported runtime tool: shared_state.write",
          },
        },
      ],
      artifacts: [],
      agentMessages: [],
      activeAgents: [],
      queueSummary: { mode: "dag", pending: 0, inProgress: 0, completed: 1, topics: [] },
      sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
      busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
      pendingClarifications: [],
      pendingApprovals: [],
      output: { text: finalText },
      updatedAt: createdAt + 200,
    } as unknown as OraStateSnapshot;

    const assistant = adaptChatMessages(
      [{
        id: `${runId}:user`,
        sessionId,
        runId,
        turnIndex: 1,
        role: "user",
        content: "我叫QC，记住",
        pattern: "orchestrator_subagent",
        modeId: SINGLE_AGENT_MODE_ID,
        createdAt,
      }],
      { [runId]: snapshot },
    ).find((message) => message.role === "assistant");
    const answerItems = assistant?.turn?.timelineItems
      ?.flatMap((item) => item.kind === "assistant_text" || item.kind === "final_text" ? [item.content] : []) ?? [];

    expect(assistant?.content).toBe(finalText);
    expect(answerItems).toEqual([finalText]);
    expect(answerItems).not.toContain(draftText);
  });

  it("shows only the final output text for completed model delta timelines", () => {
    const createdAt = 1_714_000_000_000;
    const snapshot = {
      runId: "run-channel-final-deltas",
      sessionId: "session-channel-final-deltas",
      turnIndex: 1,
      status: "succeeded",
      pattern: "orchestrator_subagent",
      modeId: SINGLE_AGENT_MODE_ID,
      input: { prompt: "你能联网搜索吗？", createdAt, context: {} },
      config: {
        modeId: SINGLE_AGENT_MODE_ID,
        pattern: "orchestrator_subagent",
        modeSelection: "manual",
        profileIds: ["solo_agent"],
        providerId: "deepseek",
        modelRef: "deepseek-v4-pro",
        approvalMode: "high_risk_only",
        patternOptions: {},
        metadata: {},
        deterministicSeed: "view-model-channel-final-deltas-test",
        skillIds: [],
        toolIds: [],
      },
      topology: { nodes: [], edges: [] },
      profiles: [],
      memory: [],
      plan: [],
      todos: [],
      actions: [],
      toolCalls: [],
      policyDecisions: [],
      checkpoints: [],
      events: [
        {
          id: "run-channel-final-deltas:evt-1",
          runId: "run-channel-final-deltas",
          seq: 1,
          type: "message.delta",
          agentId: "researcher",
          createdAt: createdAt + 1_000,
          pattern: "orchestrator_subagent",
          payload: { role: "assistant", content: "研究结论。", streaming: false },
        },
        {
          id: "run-channel-final-deltas:evt-2",
          runId: "run-channel-final-deltas",
          seq: 2,
          type: "message.delta",
          agentId: "orchestrator",
          createdAt: createdAt + 2_000,
          pattern: "orchestrator_subagent",
          payload: { role: "assistant", content: "最终回答。", streaming: false },
        },
      ],
      artifacts: [],
      activeAgents: [],
      queueSummary: { mode: "dag", pending: 0, inProgress: 0, completed: 1, topics: [] },
      sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
      busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
      pendingClarifications: [],
      pendingApprovals: [],
      output: { text: "最终回答。" },
      updatedAt: createdAt + 3_000,
    } as unknown as OraStateSnapshot;

    const assistant = adaptChatMessages(
      [{
        id: "run-channel-final-deltas:user",
        sessionId: "session-channel-final-deltas",
        runId: "run-channel-final-deltas",
        turnIndex: 1,
        role: "user",
        content: "你能联网搜索吗？",
        pattern: "orchestrator_subagent",
        modeId: SINGLE_AGENT_MODE_ID,
        createdAt,
      }],
      { "run-channel-final-deltas": snapshot },
    ).find((message) => message.role === "assistant");

    expect(assistant?.content).toBe("最终回答。");
    expect(assistant?.turn?.timelineItems?.map((item) => item.kind)).toEqual(["final_text"]);
    expect(assistant?.turn?.timelineItems?.[0]).toMatchObject({ content: "最终回答。" });
  });

  it("prefers final markdown over streamed delta timeline text after completion", () => {
    const createdAt = 1_714_000_000_000;
    const finalMarkdown = [
      "## 模型概况",
      "",
      "| 特性 | deepseek-v4-flash | deepseek-v4-pro |",
      "|---|---|---|",
      "| 上下文长度 | 1M tokens | 1M tokens |",
    ].join("\n");
    const snapshot = {
      runId: "run-final-markdown-stream",
      sessionId: "session-final-markdown-stream",
      turnIndex: 1,
      status: "succeeded",
      pattern: "orchestrator_subagent",
      modeId: SINGLE_AGENT_MODE_ID,
      input: { prompt: "帮我查价格", createdAt, context: {} },
      config: {
        modeId: SINGLE_AGENT_MODE_ID,
        pattern: "orchestrator_subagent",
        modeSelection: "manual",
        profileIds: ["solo_agent"],
        providerId: "deepseek",
        modelRef: "deepseek-v4-flash",
        approvalMode: "high_risk_only",
        patternOptions: {},
        metadata: {},
        deterministicSeed: "view-model-final-markdown-stream-test",
        skillIds: [],
        toolIds: ["web.fetch"],
      },
      topology: { nodes: [], edges: [] },
      profiles: [],
      memory: [],
      plan: [],
      todos: [],
      actions: [],
      toolCalls: [],
      policyDecisions: [],
      checkpoints: [],
      events: [
        {
          id: "run-final-markdown-stream:evt-status",
          runId: "run-final-markdown-stream",
          seq: 0,
          type: "tool.called",
          createdAt,
          pattern: "orchestrator_subagent",
          payload: {
            toolId: "web.fetch",
            status: "succeeded",
            input: { url: "https://api-docs.deepseek.com/quick_start/pricing" },
            output: { url: "https://api-docs.deepseek.com/quick_start/pricing" },
          },
        },
        ...["##", " ", "模型", "概况", "\n\n", "| 特性 | deepseek-v4-flash | deepseek-v4-pro |\n", "|---|---|---|\n", "| 上下文长度 | 1M tokens | 1M tokens |"].map((delta, index) => ({
          id: `run-final-markdown-stream:evt-${index + 1}`,
          runId: "run-final-markdown-stream",
          seq: index + 1,
          type: "message.delta",
          createdAt: createdAt + index + 1,
          pattern: "orchestrator_subagent",
          payload: {
            role: "assistant",
            messageId: "run-final-markdown-stream:assistant:solo:solo:0",
            content: delta,
            delta,
            streaming: true,
          },
        })),
      ],
      artifacts: [],
      activeAgents: [],
      queueSummary: { mode: "dag", pending: 0, inProgress: 0, completed: 1, topics: [] },
      sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
      busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
      pendingClarifications: [],
      pendingApprovals: [],
      output: { text: finalMarkdown },
      updatedAt: createdAt + 10_000,
    } as unknown as OraStateSnapshot;

    const assistant = adaptChatMessages(
      [{
        id: "run-final-markdown-stream:user",
        sessionId: "session-final-markdown-stream",
        runId: "run-final-markdown-stream",
        turnIndex: 1,
        role: "user",
        content: "帮我查价格",
        pattern: "orchestrator_subagent",
        modeId: SINGLE_AGENT_MODE_ID,
        createdAt,
      }],
      { "run-final-markdown-stream": snapshot },
    ).find((message) => message.role === "assistant");

    expect(assistant?.content).toBe(finalMarkdown);
    expect(assistant?.turn?.timelineItems?.filter((item) => item.kind === "assistant_text")).toHaveLength(0);
    expect(assistant?.turn?.timelineItems?.at(-1)).toMatchObject({ kind: "final_text", content: finalMarkdown });
  });

  it("keeps internal agent tool-policy output out of the assistant body", () => {
    const createdAt = 1_714_000_000_000;
    const leakedToolIntent = "{\"tool\":\"file.grep\",\"args\":{\"pattern\":\"按该计划实施|需要决策\",\"include\":\"**/*.tsx,**/*.ts\"}}\n\n<file_grep_policy> 1. Always run a quick second grep.\n</file_grep_policy>";
    const snapshot = {
      runId: "run-internal-leak",
      sessionId: "session-internal-leak",
      turnIndex: 1,
      status: "running",
      pattern: "orchestrator_subagent",
      modeId: SINGLE_AGENT_MODE_ID,
      input: { prompt: "调整决策 UI", createdAt, context: {} },
      config: {
        modeId: SINGLE_AGENT_MODE_ID,
        pattern: "orchestrator_subagent",
        modeSelection: "manual",
        profileIds: ["builder", "reviewer"],
        providerId: "local-smoke",
        modelRef: "local/smoke-model",
        approvalMode: "high_risk_only",
        patternOptions: {},
        metadata: {},
        deterministicSeed: "view-model-internal-leak-test",
        skillIds: [],
        toolIds: [],
      },
      topology: { nodes: [], edges: [] },
      profiles: [
        { id: "builder", label: "Builder", role: "Build", modelRef: "local/smoke-model", toolPolicyId: "builder", memoryNamespaces: ["session"], budget: { maxTokens: 1000, maxToolCalls: 0, maxRuntimeMs: 1000 } },
        { id: "reviewer", label: "Reviewer", role: "Review", modelRef: "local/smoke-model", toolPolicyId: "reviewer", memoryNamespaces: ["session"], budget: { maxTokens: 1000, maxToolCalls: 0, maxRuntimeMs: 1000 } },
      ],
      memory: [],
      plan: [],
      planList: [],
      todos: [],
      actions: [],
      toolCalls: [],
      policyDecisions: [],
      checkpoints: [],
      events: [
        {
          id: "run-internal-leak:evt-0",
          runId: "run-internal-leak",
          seq: 0,
          type: "task.progress",
          createdAt,
          pattern: "orchestrator_subagent",
          payload: {
            kind: "chat_progress",
            source: "runtime_status",
            trigger: "running_model",
            summary: "正在检查决策 UI。",
          },
        },
        {
          id: "run-internal-leak:evt-1",
          runId: "run-internal-leak",
          seq: 1,
          type: "message.delta",
          createdAt: createdAt + 1_000,
          agentId: "builder",
          nodeId: "builder",
          pattern: "orchestrator_subagent",
          payload: {
            role: "assistant",
            content: "<tool_plan_mode_reminder>\n你处于计划模式。\n</tool_plan_mode_reminder>",
          },
        },
        ...leakedToolIntent.match(/.{1,24}/gs)!.map((delta, index) => ({
          id: `run-internal-leak:evt-${index + 2}`,
          runId: "run-internal-leak",
          seq: index + 2,
          type: "message.delta",
          createdAt: createdAt + 2_000 + index,
          agentId: "reviewer",
          nodeId: "reviewer",
          pattern: "orchestrator_subagent",
          payload: { role: "assistant", content: delta, delta, streaming: true },
        })),
        {
          id: "run-internal-leak:evt-final",
          runId: "run-internal-leak",
          seq: 200,
          type: "message.delta",
          createdAt: createdAt + 3_000,
          agentId: "reviewer",
          nodeId: "reviewer",
          pattern: "orchestrator_subagent",
          payload: { role: "assistant", content: leakedToolIntent },
        },
      ],
      agentMessages: [],
      artifacts: [],
      activeAgents: [],
      queueSummary: { mode: "dag", pending: 0, inProgress: 1, completed: 0, topics: [] },
      sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
      busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
      pendingClarifications: [],
      pendingApprovals: [],
      updatedAt: createdAt + 3_000,
    } as unknown as OraStateSnapshot;

    const assistant = adaptChatMessages(
      [{
        id: "run-internal-leak:user",
        sessionId: "session-internal-leak",
        runId: "run-internal-leak",
        turnIndex: 1,
        role: "user",
        content: "调整决策 UI",
        pattern: "orchestrator_subagent",
        modeId: SINGLE_AGENT_MODE_ID,
        createdAt,
      }],
      { "run-internal-leak": snapshot },
    ).find((message) => message.role === "assistant");
    const timelineText = assistant?.turn?.timelineItems
      ?.flatMap((item) => "content" in item && item.kind === "assistant_text" ? [item.content] : [])
      .join("\n") ?? "";

    expect(assistant?.content).toBe("");
    expect(assistant?.turn?.timelineItems).toEqual([]);
    expect(assistant?.content).not.toContain("tool_plan_mode_reminder");
    expect(assistant?.content).not.toContain("file_grep_policy");
    expect(assistant?.content).not.toContain("\"tool\":\"file.grep\"");
    expect(timelineText).not.toContain("tool_plan_mode_reminder");
    expect(timelineText).not.toContain("file_grep_policy");
  });

  it("derives a turn timeline with multiple progress paragraphs, aggregated tools, plan updates, and final text", () => {
    const createdAt = 1_714_000_000_000;
    const snapshot = {
      runId: "run-turn-timeline",
      sessionId: "session-turn-timeline",
      turnIndex: 1,
      status: "succeeded",
      pattern: "orchestrator_subagent",
      modeId: SINGLE_AGENT_MODE_ID,
      input: { prompt: "调查 runtime 记录", createdAt, context: {} },
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
        deterministicSeed: "view-model-turn-timeline-test",
        skillIds: [],
        toolIds: ["file.read", "file.list", "shell.execute", "plan.update"],
      },
      topology: { nodes: [], edges: [] },
      profiles: [],
      memory: [],
      plan: [],
      planList: [
        { step: "定位日志", status: "completed" },
        { step: "汇总结论", status: "in_progress" },
      ],
      todos: [],
      actions: [],
      toolCalls: [],
      policyDecisions: [],
      checkpoints: [],
      events: [
        {
          id: "run-turn-timeline:evt-0",
          runId: "run-turn-timeline",
          seq: 0,
          type: "task.progress",
          createdAt,
          pattern: "orchestrator_subagent",
          payload: {
            kind: "chat_progress",
            source: "progress_narrator",
            trigger: "tool.succeeded",
            summary: "我会先追踪本地运行记录，确认问题链路。",
          },
        },
        {
          id: "run-turn-timeline:evt-1",
          runId: "run-turn-timeline",
          seq: 1,
          type: "tool.called",
          createdAt: createdAt + 1_000,
          pattern: "orchestrator_subagent",
          payload: {
            toolId: "file.read",
            status: "succeeded",
            input: { path: ".ora/runtime.db" },
            output: { path: ".ora/runtime.db", sizeBytes: 128 },
          },
        },
        {
          id: "run-turn-timeline:evt-2",
          runId: "run-turn-timeline",
          seq: 2,
          type: "tool.called",
          createdAt: createdAt + 2_000,
          pattern: "orchestrator_subagent",
          payload: {
            toolId: "file.list",
            status: "succeeded",
            input: { path: "sessions/runs" },
            output: { path: "sessions/runs", entries: ["run-1"] },
          },
        },
        {
          id: "run-turn-timeline:evt-3",
          runId: "run-turn-timeline",
          seq: 3,
          type: "tool.called",
          createdAt: createdAt + 3_000,
          pattern: "orchestrator_subagent",
          payload: {
            toolId: "shell.execute",
            status: "succeeded",
            input: { command: "sqlite3 .ora/runtime.db SELECT 1" },
            output: { command: "sqlite3 .ora/runtime.db SELECT 1", exitCode: 0 },
          },
        },
        {
          id: "run-turn-timeline:evt-4",
          runId: "run-turn-timeline",
          seq: 4,
          type: "tool.called",
          createdAt: createdAt + 3_500,
          pattern: "orchestrator_subagent",
          payload: {
            toolId: "plan.update",
            status: "succeeded",
            input: {
              plan: [
                { step: "定位日志", status: "completed" },
                { step: "汇总结论", status: "in_progress" },
              ],
            },
          },
        },
        {
          id: "run-turn-timeline:evt-5",
          runId: "run-turn-timeline",
          seq: 5,
          type: "task.progress",
          createdAt: createdAt + 4_000,
          pattern: "orchestrator_subagent",
          payload: {
            kind: "chat_progress",
            source: "progress_narrator",
            trigger: "tool.succeeded",
            summary: "现在我会把 trace 的事件和最终状态拼起来。",
          },
        },
        {
          id: "run-turn-timeline:evt-6",
          runId: "run-turn-timeline",
          seq: 6,
          type: "plan_list.updated",
          createdAt: createdAt + 5_000,
          pattern: "orchestrator_subagent",
          payload: {
            plan: [
              { step: "定位日志", status: "completed" },
              { step: "汇总结论", status: "in_progress" },
            ],
          },
        },
      ],
      artifacts: [],
      activeAgents: [],
      queueSummary: { mode: "dag", pending: 0, inProgress: 0, completed: 0, topics: [] },
      sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
      busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
      pendingClarifications: [],
      pendingApprovals: [],
      output: { text: "最终结论：run 没有停在计划阶段。" },
      updatedAt: createdAt + 6_000,
    } as unknown as OraStateSnapshot;

    const messages = adaptChatMessages(
      [{
        id: "run-turn-timeline:user",
        sessionId: "session-turn-timeline",
        runId: "run-turn-timeline",
        turnIndex: 1,
        role: "user",
        content: "调查 runtime 记录",
        pattern: "orchestrator_subagent",
        modeId: SINGLE_AGENT_MODE_ID,
        createdAt,
      }],
      { "run-turn-timeline": snapshot },
    );
    const assistant = messages.find((message) => message.role === "assistant");
    const timeline = assistant?.turn?.timelineItems ?? [];

    expect(timeline.map((item) => item.kind)).toEqual([
      "status_group",
      "plan_update",
      "final_text",
    ]);
    expect(timeline[0]).toMatchObject({
      summary: "已探索 1 个文件，1 个列表，已运行 1 条命令",
      steps: expect.arrayContaining([
        expect.objectContaining({ label: "读取文件", contextLabel: ".ora/runtime.db" }),
        expect.objectContaining({ label: "列出文件", contextLabel: "sessions/runs" }),
        expect.objectContaining({ label: "运行命令" }),
      ]),
    });
    expect(timeline[0]?.kind === "status_group" ? timeline[0].steps : []).toHaveLength(3);
    expect(timeline[0]?.kind === "status_group" ? timeline[0].steps : []).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "plan.update" }),
      ]),
    );
    expect(timeline[1]).toMatchObject({ summary: "已更新任务计划：1/2 完成，正在 汇总结论" });
    expect(timeline[2]).toMatchObject({ content: "最终结论：run 没有停在计划阶段。" });
    expect(assistant?.content).toBe("最终结论：run 没有停在计划阶段。");
  });

  it("does not duplicate proposed plan intro text that was already shown in the timeline", () => {
    const createdAt = 1_714_000_000_000;
    const introOne = "好的，这是一项重要的功能增强。让我先深入理解现有代码结构。";
    const introTwo = "现在我已经对整个代码库有了充分的了解。让我来产出最终的设计方案。";
    const planContent = [
      "# Channel 项目关联与自然语言切换设计方案",
      "## 背景",
      "当前 channels 创建的 session 没有绑定 projectId。",
      "## 实施步骤",
      "1. 更新 channel 创建参数以携带 projectId。",
      "## 验证方式",
      "- 运行 channel session 相关测试。",
    ].join("\n");
    const snapshot = {
      runId: "run-proposed-plan-intro",
      sessionId: "session-proposed-plan-intro",
      turnIndex: 1,
      status: "succeeded",
      pattern: "orchestrator_subagent",
      modeId: SINGLE_AGENT_MODE_ID,
      input: { prompt: "修复 channels session 项目上下文", createdAt, context: {} },
      config: {
        modeId: SINGLE_AGENT_MODE_ID,
        pattern: "orchestrator_subagent",
        modeSelection: "manual",
        profileIds: ["orchestrator"],
        providerId: "local-smoke",
        modelRef: "local/smoke-model",
        approvalMode: "high_risk_only",
        patternOptions: {},
        metadata: {},
        deterministicSeed: "view-model-proposed-plan-intro-test",
        skillIds: [],
        toolIds: [],
      },
      topology: { nodes: [], edges: [] },
      profiles: [{ id: "orchestrator", label: "Orchestrator" }],
      memory: [],
      plan: [],
      planList: [],
      todos: [],
      actions: [],
      toolCalls: [],
      policyDecisions: [],
      checkpoints: [],
      events: [
        {
          id: "run-proposed-plan-intro:evt-0",
          runId: "run-proposed-plan-intro",
          seq: 0,
          type: "task.progress",
          createdAt,
          pattern: "orchestrator_subagent",
          payload: {
            kind: "chat_progress",
            source: "progress_narrator",
            trigger: "tool.succeeded",
            summary: introOne,
          },
        },
        {
          id: "run-proposed-plan-intro:evt-1",
          runId: "run-proposed-plan-intro",
          seq: 1,
          type: "task.progress",
          createdAt: createdAt + 1_000,
          pattern: "orchestrator_subagent",
          payload: {
            kind: "chat_progress",
            source: "progress_narrator",
            trigger: "tool.succeeded",
            summary: introTwo,
          },
        },
      ],
      artifacts: [],
      activeAgents: [],
      queueSummary: { mode: "dag", pending: 0, inProgress: 0, completed: 0, topics: [] },
      sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
      busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
      pendingClarifications: [],
      pendingApprovals: [],
      output: {
        text: [
          introOne,
          "",
          introTwo,
          "",
          "<proposed_plan>",
          planContent,
          "</proposed_plan>",
        ].join("\n"),
      },
      updatedAt: createdAt + 2_000,
    } as unknown as OraStateSnapshot;

    const messages = adaptChatMessages(
      [{
        id: "run-proposed-plan-intro:user",
        sessionId: "session-proposed-plan-intro",
        runId: "run-proposed-plan-intro",
        turnIndex: 1,
        role: "user",
        content: "修复 channels session 项目上下文",
        pattern: "orchestrator_subagent",
        modeId: SINGLE_AGENT_MODE_ID,
        createdAt,
      }],
      { "run-proposed-plan-intro": snapshot },
    );
    const assistant = messages.find((message) => message.role === "assistant");
    const timeline = assistant?.turn?.timelineItems ?? [];

    expect(timeline.map((item) => item.kind)).toEqual(["assistant_text"]);
    expect(timeline.filter((item) => "content" in item && item.content === introOne)).toHaveLength(0);
    expect(timeline.filter((item) => "content" in item && item.content === introTwo)).toHaveLength(0);
    expect(assistant?.content).toBe(planContent);
    expect(assistant?.content).toContain("Channel 项目关联与自然语言切换设计方案");
    expect(assistant?.content).not.toContain(introOne);
    expect(assistant?.content).not.toContain(introTwo);
  });

  it("keeps inline proposed plan intro text out of the plan card content", () => {
    const createdAt = 1_714_000_000_000;
    const intro = "Phase1-3分析完成，决策完备";
    const planContent = [
      "计划标题：ChatInput textarea 添加滚动支持",
      "## 背景",
      "Ora 内容区的输入框在多行内容过多时会挤压下方操作区。",
      "## 实施步骤",
      "1. 修改 textarea overflow 属性，只让输入框内部滚动。",
      "2. 补充覆盖长文本输入的组件测试。",
      "## 验证方式",
      "- 运行 ChatInput 和 AssistantTurnCard 相关测试。",
    ].join("\n");
    const snapshot = {
      runId: "run-inline-proposed-plan-intro",
      sessionId: "session-inline-proposed-plan-intro",
      turnIndex: 1,
      status: "succeeded",
      pattern: "orchestrator_subagent",
      modeId: SINGLE_AGENT_MODE_ID,
      input: { prompt: "修复输入框滚动", createdAt, context: {} },
      config: {
        modeId: SINGLE_AGENT_MODE_ID,
        pattern: "orchestrator_subagent",
        modeSelection: "manual",
        profileIds: ["orchestrator"],
        providerId: "local-smoke",
        modelRef: "local/smoke-model",
        approvalMode: "high_risk_only",
        patternOptions: {},
        metadata: {},
        deterministicSeed: "view-model-inline-proposed-plan-intro-test",
        skillIds: [],
        toolIds: [],
      },
      topology: { nodes: [], edges: [] },
      profiles: [{ id: "orchestrator", label: "Orchestrator" }],
      memory: [],
      plan: [],
      planList: [],
      todos: [],
      actions: [],
      toolCalls: [],
      policyDecisions: [],
      checkpoints: [],
      events: [],
      artifacts: [],
      activeAgents: [],
      queueSummary: { mode: "dag", pending: 0, inProgress: 0, completed: 0, topics: [] },
      sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
      busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
      pendingClarifications: [],
      pendingApprovals: [],
      output: {
        text: `${intro}<proposed_plan>\n${planContent}\n</proposed_plan>`,
      },
      updatedAt: createdAt + 1_000,
    } as unknown as OraStateSnapshot;

    const messages = adaptChatMessages(
      [{
        id: "run-inline-proposed-plan-intro:user",
        sessionId: "session-inline-proposed-plan-intro",
        runId: "run-inline-proposed-plan-intro",
        turnIndex: 1,
        role: "user",
        content: "修复输入框滚动",
        pattern: "orchestrator_subagent",
        modeId: SINGLE_AGENT_MODE_ID,
        createdAt,
      }],
      { "run-inline-proposed-plan-intro": snapshot },
    );
    const assistant = messages.find((message) => message.role === "assistant");
    const timeline = assistant?.turn?.timelineItems ?? [];

    expect(assistant?.turn?.hasProposedPlan).toBe(true);
    expect(assistant?.content).toBe(planContent);
    expect(assistant?.content).not.toContain(intro);
    expect(assistant?.content).not.toContain("<proposed_plan>");
    expect(timeline.filter((item) => "content" in item && item.content === intro)).toHaveLength(1);
  });

  it("keeps streamed text separators when final output exists without duplicating the final text", () => {
    const createdAt = 1_714_000_000_000;
    const finalText = "最终结论：已经完成。";
    const snapshot = {
      runId: "run-final-text-stream-separators",
      sessionId: "session-final-text-stream-separators",
      turnIndex: 1,
      status: "succeeded",
      pattern: "orchestrator_subagent",
      modeId: SINGLE_AGENT_MODE_ID,
      input: { prompt: "追踪 run-0035", createdAt, context: {} },
      config: {
        modeId: SINGLE_AGENT_MODE_ID,
        pattern: "orchestrator_subagent",
        modeSelection: "manual",
        profileIds: ["orchestrator"],
        providerId: "local-smoke",
        modelRef: "local/smoke-model",
        approvalMode: "high_risk_only",
        patternOptions: {},
        metadata: {},
        deterministicSeed: "view-model-final-text-stream-separators-test",
        skillIds: [],
        toolIds: ["file.read", "file.grep"],
      },
      topology: { nodes: [], edges: [] },
      profiles: [{ id: "orchestrator", label: "Orchestrator" }],
      memory: [],
      plan: [],
      planList: [],
      todos: [],
      actions: [],
      toolCalls: [],
      policyDecisions: [],
      checkpoints: [],
      events: [
        {
          id: "run-final-text-stream-separators:evt-0",
          runId: "run-final-text-stream-separators",
          seq: 0,
          type: "message.delta",
          createdAt,
          agentId: "orchestrator",
          nodeId: "orchestrator",
          pattern: "orchestrator_subagent",
          payload: { role: "assistant", content: "我先确认运行事件。" },
        },
        {
          id: "run-final-text-stream-separators:evt-1",
          runId: "run-final-text-stream-separators",
          seq: 1,
          type: "tool.called",
          createdAt: createdAt + 1_000,
          agentId: "orchestrator",
          nodeId: "orchestrator",
          pattern: "orchestrator_subagent",
          payload: {
            toolId: "file.read",
            status: "succeeded",
            input: { path: ".ora/runtime.db" },
            output: { path: ".ora/runtime.db", sizeBytes: 128 },
          },
        },
        {
          id: "run-final-text-stream-separators:evt-2",
          runId: "run-final-text-stream-separators",
          seq: 2,
          type: "message.delta",
          createdAt: createdAt + 2_000,
          agentId: "orchestrator",
          nodeId: "orchestrator",
          pattern: "orchestrator_subagent",
          payload: { role: "assistant", content: "接着对照前端 timeline 逻辑。" },
        },
        {
          id: "run-final-text-stream-separators:evt-3",
          runId: "run-final-text-stream-separators",
          seq: 3,
          type: "tool.called",
          createdAt: createdAt + 3_000,
          agentId: "orchestrator",
          nodeId: "orchestrator",
          pattern: "orchestrator_subagent",
          payload: {
            toolId: "file.grep",
            status: "succeeded",
            input: { pattern: "message.delta", include: "apps/desktop/src/lib/viewModel.ts" },
            output: { pattern: "message.delta", matches: [{ path: "apps/desktop/src/lib/viewModel.ts" }] },
          },
        },
        {
          id: "run-final-text-stream-separators:evt-4",
          runId: "run-final-text-stream-separators",
          seq: 4,
          type: "message.delta",
          createdAt: createdAt + 4_000,
          agentId: "orchestrator",
          nodeId: "orchestrator",
          pattern: "orchestrator_subagent",
          payload: { role: "assistant", content: finalText },
        },
      ],
      artifacts: [],
      activeAgents: [],
      queueSummary: { mode: "dag", pending: 0, inProgress: 0, completed: 0, topics: [] },
      sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
      busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
      pendingClarifications: [],
      pendingApprovals: [],
      output: { text: finalText },
      updatedAt: createdAt + 5_000,
    } as unknown as OraStateSnapshot;

    const assistant = adaptChatMessages(
      [{
        id: "run-final-text-stream-separators:user",
        sessionId: "session-final-text-stream-separators",
        runId: "run-final-text-stream-separators",
        turnIndex: 1,
        role: "user",
        content: "追踪 run-0035",
        pattern: "orchestrator_subagent",
        modeId: SINGLE_AGENT_MODE_ID,
        createdAt,
      }],
      { "run-final-text-stream-separators": snapshot },
    ).find((message) => message.role === "assistant");
    const timeline = assistant?.turn?.timelineItems ?? [];

    expect(timeline.map((item) => item.kind)).toEqual([
      "assistant_text",
      "status_group",
      "assistant_text",
      "status_group",
      "final_text",
    ]);
    expect(timeline[0]).toMatchObject({ content: "我先确认运行事件。" });
    expect(timeline[1]).toMatchObject({ summary: "已探索 1 个文件" });
    expect(timeline[2]).toMatchObject({ content: "接着对照前端 timeline 逻辑。" });
    expect(timeline[3]).toMatchObject({ summary: "已探索 1 个文件" });
    expect(timeline[4]).toMatchObject({ content: finalText });
    expect(timeline.filter((item) => "content" in item && item.content === finalText)).toHaveLength(1);
    expect(assistant?.content).toBe(finalText);
  });

  it("keeps streamed assistant text and agent labels interleaved with runtime status after completion", () => {
    const createdAt = 1_714_000_000_000;
    const finalText = "Builder 已完成修复。";
    const snapshot = {
      runId: "run-completed-stream-interleave",
      sessionId: "session-completed-stream-interleave",
      turnIndex: 1,
      status: "succeeded",
      pattern: "agent_teams",
      modeId: SINGLE_AGENT_MODE_ID,
      input: { prompt: "修复 timeline 顺序", createdAt, context: {} },
      config: {
        modeId: SINGLE_AGENT_MODE_ID,
        pattern: "agent_teams",
        modeSelection: "manual",
        profileIds: ["orchestrator", "builder"],
        providerId: "deepseek",
        modelRef: "deepseek-chat",
        approvalMode: "high_risk_only",
        patternOptions: {},
        metadata: {},
        deterministicSeed: "view-model-completed-stream-interleave-test",
        skillIds: [],
        toolIds: [],
      },
      topology: { nodes: [], edges: [] },
      profiles: [
        {
          id: "orchestrator",
          label: "Orchestrator",
          role: "Coordinate",
          model: "deepseek",
          tools: [],
          budget: "default",
          memoryScopes: [],
        },
        {
          id: "builder",
          label: "Builder",
          role: "Build",
          model: "deepseek",
          tools: [],
          budget: "default",
          memoryScopes: [],
        },
      ],
      memory: [],
      plan: [],
      todos: [],
      actions: [],
      toolCalls: [],
      policyDecisions: [],
      checkpoints: [],
      events: [
        {
          id: "run-completed-stream-interleave:evt-0",
          runId: "run-completed-stream-interleave",
          seq: 0,
          type: "message.delta",
          agentId: "orchestrator",
          nodeId: "orchestrator",
          createdAt,
          pattern: "agent_teams",
          payload: {
            role: "assistant",
            messageId: "orchestrator-message",
            content: "我先看任务和现有实现。",
            delta: "我先看任务和现有实现。",
            streaming: true,
            phase: "stream",
          },
        },
        {
          id: "run-completed-stream-interleave:evt-1",
          runId: "run-completed-stream-interleave",
          seq: 1,
          type: "tool.called",
          agentId: "orchestrator",
          nodeId: "orchestrator",
          createdAt: createdAt + 1_000,
          pattern: "agent_teams",
          payload: {
            toolId: "file.read",
            status: "succeeded",
            path: "apps/desktop/src/lib/viewModel.ts",
          },
        },
        {
          id: "run-completed-stream-interleave:evt-2",
          runId: "run-completed-stream-interleave",
          seq: 2,
          type: "message.delta",
          agentId: "builder",
          nodeId: "builder",
          createdAt: createdAt + 2_000,
          pattern: "agent_teams",
          payload: {
            role: "assistant",
            messageId: "builder-message",
            content: "我会按事件顺序修复 timeline。",
            delta: "我会按事件顺序修复 timeline。",
            streaming: true,
            phase: "stream",
          },
        },
        {
          id: "run-completed-stream-interleave:evt-3",
          runId: "run-completed-stream-interleave",
          seq: 3,
          type: "tool.called",
          agentId: "builder",
          nodeId: "builder",
          createdAt: createdAt + 3_000,
          pattern: "agent_teams",
          payload: {
            toolId: "file.write",
            status: "succeeded",
            path: "apps/desktop/src/lib/viewModel.ts",
          },
        },
      ],
      artifacts: [],
      activeAgents: [],
      queueSummary: { mode: "dag", pending: 0, inProgress: 0, completed: 0, topics: [] },
      sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
      busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
      pendingClarifications: [],
      pendingApprovals: [],
      output: { text: finalText },
      updatedAt: createdAt + 4_000,
    } as unknown as OraStateSnapshot;

    const assistant = adaptChatMessages(
      [{
        id: "run-completed-stream-interleave:user",
        sessionId: "session-completed-stream-interleave",
        runId: "run-completed-stream-interleave",
        turnIndex: 1,
        role: "user",
        content: "修复 timeline 顺序",
        pattern: "agent_teams",
        modeId: SINGLE_AGENT_MODE_ID,
        createdAt,
      }],
      { "run-completed-stream-interleave": snapshot },
    ).find((message) => message.role === "assistant");
    const timeline = assistant?.turn?.timelineItems ?? [];

    expect(timeline.map((item) => item.kind)).toEqual([
      "assistant_text",
      "status_group",
      "assistant_text",
      "status_group",
      "final_text",
    ]);
    expect(timeline[0]).toMatchObject({
      content: "我先看任务和现有实现。",
      agentLabel: "Orchestrator",
    });
    expect(timeline[1]).toMatchObject({
      summary: "已探索 1 个文件",
      steps: [expect.objectContaining({
        label: "读取文件",
        agentId: "orchestrator",
      })],
    });
    expect(timeline[2]).toMatchObject({
      content: "我会按事件顺序修复 timeline。",
      agentLabel: "Builder",
    });
    expect(timeline[3]).toMatchObject({
      steps: [expect.objectContaining({
        label: "写入文件",
        agentId: "builder",
      })],
    });
    expect(timeline[4]).toMatchObject({ content: finalText });
  });

  it("keeps historical progress narration out of process steps after the run finishes", () => {
    const createdAt = 1_714_000_000_000;
    const snapshot = {
      runId: "run-deerflow-progress-done",
      sessionId: "session-deerflow-progress-done",
      turnIndex: 1,
      status: "succeeded",
      pattern: "orchestrator_subagent",
      modeId: DEERFLOW_HARNESS_MODE_ID,
      input: { prompt: "维特根斯坦和尼采的哲学论述有什么不同？", createdAt, context: {} },
      config: {
        modeId: DEERFLOW_HARNESS_MODE_ID,
        pattern: "orchestrator_subagent",
        modeSelection: "manual",
        profileIds: ["orchestrator"],
        providerId: "local-smoke",
        modelRef: "local/smoke-model",
        approvalMode: "high_risk_only",
        patternOptions: {},
        metadata: { progressNarration: true },
        deterministicSeed: "view-model-deerflow-progress-done-test",
        skillIds: [],
        toolIds: [],
      },
      topology: { nodes: [], edges: [] },
      profiles: [],
      memory: [],
      plan: [],
      todos: [],
      actions: [],
      toolCalls: [],
      policyDecisions: [],
      checkpoints: [],
      events: [
        {
          id: "run-deerflow-progress-done:evt-0",
          runId: "run-deerflow-progress-done",
          seq: 0,
          type: "run.started",
          createdAt,
          pattern: "orchestrator_subagent",
          payload: { input: { prompt: "维特根斯坦和尼采的哲学论述有什么不同？" } },
        },
        {
          id: "run-deerflow-progress-done:evt-1",
          runId: "run-deerflow-progress-done",
          seq: 1,
          type: "task.progress",
          createdAt: createdAt + 2_000,
          pattern: "orchestrator_subagent",
          payload: {
            kind: "chat_progress",
            source: "progress_narrator",
            trigger: "task.progress",
            summary: "研究已完成，审核子代理正在运行，下一步将进行综合。",
          },
        },
        {
          id: "run-deerflow-progress-done:evt-2",
          runId: "run-deerflow-progress-done",
          seq: 2,
          type: "task.progress",
          createdAt: createdAt + 4_000,
          pattern: "orchestrator_subagent",
          payload: {
            kind: "chat_progress",
            source: "progress_narrator",
            trigger: "task.completed",
            summary: "研究完成，正在生成最终回答。",
          },
        },
        {
          id: "run-deerflow-progress-done:evt-3",
          runId: "run-deerflow-progress-done",
          seq: 3,
          type: "run.done",
          createdAt: createdAt + 6_000,
          pattern: "orchestrator_subagent",
          payload: { summary: "Runtime default completion summary." },
        },
      ],
      artifacts: [],
      activeAgents: [],
      queueSummary: { mode: "dag", pending: 0, inProgress: 0, completed: 2, topics: [] },
      sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
      busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
      pendingClarifications: [],
      pendingApprovals: [],
      output: { text: "维特根斯坦与尼采的哲学论述差异如下。" },
      updatedAt: createdAt + 6_000,
    } as unknown as OraStateSnapshot;

    const messages = adaptChatMessages(
      [{
        id: "run-deerflow-progress-done:user",
        sessionId: "session-deerflow-progress-done",
        runId: "run-deerflow-progress-done",
        turnIndex: 1,
        role: "user",
        content: "维特根斯坦和尼采的哲学论述有什么不同？",
        pattern: "orchestrator_subagent",
        modeId: DEERFLOW_HARNESS_MODE_ID,
        createdAt,
      }],
      { "run-deerflow-progress-done": snapshot },
    );
    const assistant = messages.find((message) => message.role === "assistant");
    const progressSteps = assistant?.turn?.processSteps.filter((step) => step.eventType === "task.progress") ?? [];

    expect(assistant?.turn?.status).toBe("done");
    expect(progressSteps).toEqual([]);
    expect(assistant?.turn?.processSteps.some((step) => step.status === "active")).toBe(false);
    expect(assistant?.turn?.processSteps).toEqual([]);
  });

  it("shows user-facing copy for approval interruption process steps", () => {
    const createdAt = 1_714_000_000_000;
    const snapshot = {
      runId: "run-approval-node",
      sessionId: "session-approval-node",
      turnIndex: 1,
      status: "interrupted",
      pattern: "orchestrator_subagent",
      modeId: SINGLE_AGENT_MODE_ID,
      input: { prompt: "更新项目文档", createdAt, context: {} },
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
        deterministicSeed: "view-model-approval-node-test",
        skillIds: [],
        toolIds: ["file.write"],
      },
      topology: { nodes: [], edges: [] },
      profiles: [],
      memory: [],
      plan: [],
      todos: [],
      actions: [],
      toolCalls: [],
      policyDecisions: [],
      checkpoints: [],
      events: [{
        id: "run-approval-node:evt-0",
        runId: "run-approval-node",
        seq: 0,
        type: "node.updated",
        createdAt,
        pattern: "orchestrator_subagent",
        payload: {
          nodeId: "solo_agent",
          state: "interrupted",
          detail: "Manual approval required for action run-approval-node:action:tool-1.",
        },
      }],
      artifacts: [],
      activeAgents: [],
      queueSummary: { mode: "dag", pending: 0, inProgress: 0, completed: 0, topics: [] },
      sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
      busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
      pendingClarifications: [],
      pendingApprovals: [],
      updatedAt: createdAt,
    } as unknown as OraStateSnapshot;

    const messages = adaptChatMessages(
      [{
        id: "run-approval-node:user",
        sessionId: "session-approval-node",
        runId: "run-approval-node",
        turnIndex: 1,
        role: "user",
        content: "更新项目文档",
        pattern: "orchestrator_subagent",
        modeId: SINGLE_AGENT_MODE_ID,
        createdAt,
      }],
      { "run-approval-node": snapshot },
    );
    const assistant = messages.find((message) => message.role === "assistant");
    const processSteps = assistant?.turn?.processSteps ?? [];

    expect(processSteps).toHaveLength(1);
    expect(processSteps[0]?.label).toBe("等待确认");
    expect(processSteps[0]?.detail).toBe("需要你确认后，我才能继续。");
    expect(processSteps[0]?.detail).not.toContain("Manual approval required");
    expect(processSteps[0]?.detail).not.toContain("run-approval-node:action:tool-1");
  });

  it("keeps progress narration out of process steps while the run is still active", () => {
    const createdAt = 1_714_000_000_000;
    const snapshot = {
      runId: "run-deerflow-progress-running",
      sessionId: "session-deerflow-progress-running",
      turnIndex: 1,
      status: "running",
      pattern: "orchestrator_subagent",
      modeId: DEERFLOW_HARNESS_MODE_ID,
      input: { prompt: "分析西芒杜项目现况。", createdAt, context: {} },
      config: {
        modeId: DEERFLOW_HARNESS_MODE_ID,
        pattern: "orchestrator_subagent",
        modeSelection: "manual",
        profileIds: ["orchestrator"],
        providerId: "local-smoke",
        modelRef: "local/smoke-model",
        approvalMode: "high_risk_only",
        patternOptions: {},
        metadata: { progressNarration: true },
        deterministicSeed: "view-model-deerflow-progress-running-test",
        skillIds: [],
        toolIds: [],
      },
      topology: { nodes: [], edges: [] },
      profiles: [],
      memory: [],
      plan: [],
      todos: [],
      actions: [],
      toolCalls: [],
      policyDecisions: [],
      checkpoints: [],
      events: [
        {
          id: "run-deerflow-progress-running:evt-0",
          runId: "run-deerflow-progress-running",
          seq: 0,
          type: "run.started",
          createdAt,
          pattern: "orchestrator_subagent",
          payload: { input: { prompt: "分析西芒杜项目现况。" } },
        },
        {
          id: "run-deerflow-progress-running:evt-1",
          runId: "run-deerflow-progress-running",
          seq: 1,
          type: "task.progress",
          createdAt: createdAt + 2_000,
          pattern: "orchestrator_subagent",
          payload: {
            kind: "chat_progress",
            source: "progress_narrator",
            trigger: "task.progress",
            summary: "正在分析项目近况，下一步将分配调研任务。",
          },
        },
        {
          id: "run-deerflow-progress-running:evt-2",
          runId: "run-deerflow-progress-running",
          seq: 2,
          type: "tool.called",
          createdAt: createdAt + 4_000,
          pattern: "orchestrator_subagent",
          payload: {
            toolId: "file.read",
            status: "succeeded",
            args: { path: "10-Wiki/项目/西芒杜项目.md" },
            result: { bytes: 1420 },
          },
        },
        {
          id: "run-deerflow-progress-running:evt-3",
          runId: "run-deerflow-progress-running",
          seq: 3,
          type: "task.progress",
          createdAt: createdAt + 6_000,
          pattern: "orchestrator_subagent",
          payload: {
            kind: "chat_progress",
            source: "progress_narrator",
            trigger: "task.progress",
            summary: "团队已读取项目文档，正在规划后续调研任务。",
          },
        },
      ],
      artifacts: [],
      activeAgents: [],
      queueSummary: { mode: "dag", pending: 0, inProgress: 1, completed: 1, topics: [] },
      sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
      busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
      pendingClarifications: [],
      pendingApprovals: [],
      updatedAt: createdAt + 6_000,
    } as unknown as OraStateSnapshot;

    const messages = adaptChatMessages(
      [{
        id: "run-deerflow-progress-running:user",
        sessionId: "session-deerflow-progress-running",
        runId: "run-deerflow-progress-running",
        turnIndex: 1,
        role: "user",
        content: "分析西芒杜项目现况。",
        pattern: "orchestrator_subagent",
        modeId: DEERFLOW_HARNESS_MODE_ID,
        createdAt,
      }],
      { "run-deerflow-progress-running": snapshot },
    );
    const assistant = messages.find((message) => message.role === "assistant");
    const processSteps = assistant?.turn?.processSteps ?? [];

    expect(assistant?.content).toBe("");
    expect(assistant?.turn?.liveProgressText).toBeUndefined();
    expect(assistant?.turn?.timelineItems).toHaveLength(1);
    expect(assistant?.turn?.timelineItems?.map((item) => item.kind)).toEqual(["status_group"]);
    expect(processSteps.map((step) => step.status)).toEqual([
      "complete",
    ]);
    expect(processSteps).toHaveLength(1);
    expect(processSteps[0]?.eventType).toBe("tool.called");
    expect(processSteps[0]?.label).toBe("读取文件");
    expect(processSteps[0]?.detail).toContain("已读取 10-Wiki/项目/西芒杜项目.md");
    expect(processSteps[0]?.contextLabel).toBe("10-Wiki/项目/西芒杜项目.md");
  });

  it("keeps progress narration out of a running turn timeline", () => {
    const createdAt = 1_714_000_000_000;
    const snapshot = {
      runId: "run-progress-latest-only",
      sessionId: "session-progress-latest-only",
      turnIndex: 1,
      status: "running",
      pattern: "orchestrator_subagent",
      modeId: SINGLE_AGENT_MODE_ID,
      input: { prompt: "继续执行", createdAt, context: {} },
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
        deterministicSeed: "view-model-progress-latest-only-test",
        skillIds: [],
        toolIds: [],
      },
      topology: { nodes: [], edges: [] },
      profiles: [],
      memory: [],
      plan: [],
      todos: [],
      actions: [],
      toolCalls: [],
      policyDecisions: [],
      checkpoints: [],
      events: [
        {
          id: "run-progress-latest-only:evt-0",
          runId: "run-progress-latest-only",
          seq: 0,
          type: "task.progress",
          createdAt,
          pattern: "orchestrator_subagent",
          payload: {
            kind: "chat_progress",
            source: "progress_narrator",
            summary: "正在读取第一批文件。",
          },
        },
        {
          id: "run-progress-latest-only:evt-1",
          runId: "run-progress-latest-only",
          seq: 1,
          type: "message.delta",
          createdAt: createdAt + 1_000,
          pattern: "orchestrator_subagent",
          payload: { role: "assistant", content: "我会先整理上下文。", delta: "我会先整理上下文。", streaming: true },
        },
        {
          id: "run-progress-latest-only:evt-2",
          runId: "run-progress-latest-only",
          seq: 2,
          type: "task.progress",
          createdAt: createdAt + 2_000,
          pattern: "orchestrator_subagent",
          payload: {
            kind: "chat_progress",
            source: "progress_narrator",
            summary: "正在运行验证，下一步将汇总结论。",
          },
        },
      ],
      artifacts: [],
      activeAgents: [],
      queueSummary: { mode: "dag", pending: 0, inProgress: 1, completed: 0, topics: [] },
      sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
      busStats: { enabled: false, publishedCount: 0, routedCount: {} },
      pendingClarifications: [],
      pendingApprovals: [],
      updatedAt: createdAt + 2_000,
    } as unknown as OraStateSnapshot;

    const messages = adaptChatMessages(
      [{
        id: "run-progress-latest-only:user",
        sessionId: "session-progress-latest-only",
        runId: "run-progress-latest-only",
        turnIndex: 1,
        role: "user",
        content: "继续执行",
        pattern: "orchestrator_subagent",
        modeId: SINGLE_AGENT_MODE_ID,
        createdAt,
      }],
      { "run-progress-latest-only": snapshot },
    );
    const assistant = messages.find((message) => message.role === "assistant");
    const assistantItems = assistant?.turn?.timelineItems?.filter((item) => item.kind === "assistant_text") ?? [];

    expect(assistant?.turn?.timelineItems).toHaveLength(1);
    expect(assistantItems).toHaveLength(1);
    expect(assistantItems[0]).toMatchObject({
      content: "我会先整理上下文。",
    });
  });

  it("promotes assistant body into status-only timeline so answer renders inside timeline surface", () => {
    const createdAt = 1_714_000_000_000;
    const finalAnswer = [
      "好的，我来仔细审查这个方案。",
      "",
      "先看一下相关的现有代码结构，然后检查组件模式。",
    ].join("\n");
    const snapshot = {
      runId: "run-status-timeline-body",
      sessionId: "session-status-timeline-body",
      turnIndex: 1,
      status: "succeeded",
      pattern: "orchestrator_subagent",
      modeId: SINGLE_AGENT_MODE_ID,
      input: { prompt: "审查方案", createdAt, context: {} },
      config: {
        modeId: SINGLE_AGENT_MODE_ID,
        pattern: "orchestrator_subagent",
        modeSelection: "manual",
        profileIds: ["orchestrator"],
        providerId: "deepseek",
        modelRef: "deepseek-chat",
        approvalMode: "high_risk_only",
        patternOptions: {},
        metadata: {},
        deterministicSeed: "view-model-status-timeline-body-test",
        skillIds: [],
        toolIds: ["file.read", "file.grep"],
      },
      topology: { nodes: [], edges: [] },
      profiles: [
        { id: "orchestrator", label: "Orchestrator", role: "Coordinate", model: "deepseek", tools: [], budget: "default", memoryScopes: [] },
      ],
      memory: [],
      plan: [],
      todos: [],
      actions: [],
      toolCalls: [],
      policyDecisions: [],
      checkpoints: [],
      events: [
        {
          id: "run-status-timeline-body:evt-0",
          runId: "run-status-timeline-body",
          seq: 0,
          type: "tool.called",
          agentId: "orchestrator",
          nodeId: "orchestrator",
          createdAt,
          pattern: "orchestrator_subagent",
          payload: {
            toolId: "file.read",
            status: "succeeded",
            path: "apps/desktop/src/components/AssistantTurnCard.tsx",
          },
        },
        {
          id: "run-status-timeline-body:evt-1",
          runId: "run-status-timeline-body",
          seq: 1,
          type: "tool.called",
          agentId: "orchestrator",
          nodeId: "orchestrator",
          createdAt: createdAt + 1_000,
          pattern: "orchestrator_subagent",
          payload: {
            toolId: "file.grep",
            status: "succeeded",
            path: "apps/desktop/src/lib/viewModel.ts",
          },
        },
      ],
      artifacts: [],
      agentMessages: [],
      activeAgents: [],
      queueSummary: { mode: "dag", pending: 0, inProgress: 0, completed: 2, topics: [] },
      sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
      busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
      pendingClarifications: [],
      pendingApprovals: [],
      output: { text: finalAnswer },
      updatedAt: createdAt + 5_000,
    } as unknown as OraStateSnapshot;

    const assistant = adaptChatMessages(
      [{
        id: "run-status-timeline-body:user",
        sessionId: "session-status-timeline-body",
        runId: "run-status-timeline-body",
        turnIndex: 1,
        role: "user",
        content: "审查方案",
        pattern: "orchestrator_subagent",
        modeId: SINGLE_AGENT_MODE_ID,
        createdAt,
      }],
      { "run-status-timeline-body": snapshot },
    ).find((message) => message.role === "assistant");

    const timeline = assistant?.turn?.timelineItems ?? [];
    const kinds = timeline.map((item) => item.kind);
    const assistantTextItems = timeline.filter(
      (item) => item.kind === "assistant_text" || item.kind === "final_text",
    );

    // Status items from tool calls exist
    expect(kinds.filter((k) => k === "status_group")).toHaveLength(1);

    // Body answer is represented in timeline as final_text
    expect(assistantTextItems).toHaveLength(1);
    expect(assistantTextItems[0]).toMatchObject({
      kind: "final_text",
      content: finalAnswer,
    });

    // Body content matches the answer
    expect(assistant?.content).toBe(finalAnswer);
  });

  it("promotes body into status-only timeline even when agent messages contain overlapping content", () => {
    const createdAt = 1_714_000_000_000;
    // Agent messages contain text that is an 80%+ substring of final answer,
    // causing isTimelineTextAlreadyRepresented to return true before the fix.
    const agentDraft = [
      "经过对代码结构的详细审查，发现 AssistantTurnCard 组件",
      "中 body fallback 的渲染条件存在关键问题。",
      "当 timeline 中包含 status_group 但缺少 assistant_text 时，",
      "body 内容会被渲染在 timeline 下方而非内部，导致交错显示失效。",
      "需要调整 viewModel 的 timeline 投影逻辑来修复。",
    ].join("");
    const finalAnswer = agentDraft + "建议修改 deriveTimelineItems。";
    const snapshot = {
      runId: "run-status-body-agent-overlap",
      sessionId: "session-status-body-agent-overlap",
      turnIndex: 1,
      status: "succeeded",
      pattern: "agent_teams",
      modeId: SINGLE_AGENT_MODE_ID,
      input: { prompt: "分析渲染问题", createdAt, context: {} },
      config: {
        modeId: SINGLE_AGENT_MODE_ID,
        pattern: "agent_teams",
        modeSelection: "manual",
        profileIds: ["orchestrator", "builder"],
        providerId: "deepseek",
        modelRef: "deepseek-chat",
        approvalMode: "high_risk_only",
        patternOptions: {},
        metadata: {},
        deterministicSeed: "view-model-status-body-agent-overlap-test",
        skillIds: [],
        toolIds: ["file.read"],
      },
      topology: { nodes: [], edges: [] },
      profiles: [
        { id: "orchestrator", label: "Orchestrator", role: "Coordinate", model: "deepseek", tools: [], budget: "default", memoryScopes: [] },
        { id: "builder", label: "Builder", role: "Build", model: "deepseek", tools: [], budget: "default", memoryScopes: [] },
      ],
      memory: [],
      plan: [],
      todos: [],
      actions: [],
      toolCalls: [],
      policyDecisions: [],
      checkpoints: [],
      events: [
        {
          id: "run-status-body-agent-overlap:evt-0",
          runId: "run-status-body-agent-overlap",
          seq: 0,
          type: "tool.called",
          agentId: "orchestrator",
          nodeId: "orchestrator",
          createdAt,
          pattern: "agent_teams",
          payload: {
            toolId: "file.read",
            status: "succeeded",
            path: "apps/desktop/src/components/AssistantTurnCard.tsx",
          },
        },
      ],
      artifacts: [],
      agentMessages: [
        {
          id: "run-status-body-agent-overlap:agent-0",
          runId: "run-status-body-agent-overlap",
          fromAgentId: "orchestrator",
          toAgentIds: ["builder"],
          kind: "handoff",
          status: "done",
          content: agentDraft,
          threadId: "thread-1",
          artifactIds: [],
          createdAt: createdAt + 1_000,
        },
      ],
      activeAgents: [],
      queueSummary: { mode: "dag", pending: 0, inProgress: 0, completed: 1, topics: [] },
      sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
      busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
      pendingClarifications: [],
      pendingApprovals: [],
      output: { text: finalAnswer },
      updatedAt: createdAt + 5_000,
    } as unknown as OraStateSnapshot;

    const assistant = adaptChatMessages(
      [{
        id: "run-status-body-agent-overlap:user",
        sessionId: "session-status-body-agent-overlap",
        runId: "run-status-body-agent-overlap",
        turnIndex: 1,
        role: "user",
        content: "分析方案",
        pattern: "agent_teams",
        modeId: SINGLE_AGENT_MODE_ID,
        createdAt,
      }],
      { "run-status-body-agent-overlap": snapshot },
    ).find((message) => message.role === "assistant");

    const timeline = assistant?.turn?.timelineItems ?? [];
    const assistantTextItems = timeline.filter(
      (item) => item.kind === "assistant_text" || item.kind === "final_text",
    );

    // Has status items from tool calls
    expect(timeline.some((item) => item.kind === "status_group")).toBe(true);

    // Body answer is in timeline as final_text (not suppressed by agent message overlap)
    expect(assistantTextItems).toHaveLength(1);
    expect(assistantTextItems[0]).toMatchObject({
      kind: "final_text",
      content: finalAnswer,
    });

    // Body content is the answer
    expect(assistant?.content).toBe(finalAnswer);
  });

  it("extracts attachedImages from snapshot context and attaches them to user messages", () => {
    const createdAt = 1_714_000_000_000;
    const runId = "run-images";
    const sessionId = "session-images";
    const snapshot = {
      runId,
      sessionId,
      turnIndex: 1,
      status: "succeeded" as const,
      pattern: "single_agent" as const,
      modeId: SINGLE_AGENT_MODE_ID,
      input: {
        prompt: "看看这张图",
        createdAt,
        context: {
          attachedImages: [{
            dataUrl: "data:image/png;base64,iVBORw0KGgo=",
            mimeType: "image/png",
            name: "screenshot.png",
            sizeBytes: 12345,
          }],
        },
      },
      config: {
        modeId: SINGLE_AGENT_MODE_ID,
        pattern: "single_agent",
        modeSelection: "manual",
        profileIds: ["ora"],
        providerId: "local-smoke",
        modelRef: "local/smoke-model",
        approvalMode: "high_risk_only",
        patternOptions: {},
        metadata: {},
        deterministicSeed: "view-model-images-test",
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
      events: [],
      artifacts: [],
      activeAgents: [],
      queueSummary: { mode: "dag", pending: 0, inProgress: 0, completed: 0, topics: [] },
      sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
      busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
      pendingClarifications: [],
      pendingApprovals: [],
      updatedAt: createdAt + 1,
    } as unknown as OraStateSnapshot;

    const messages = adaptChatMessages(
      [{
        id: `${runId}:user`,
        sessionId,
        runId,
        turnIndex: 1,
        role: "user" as const,
        content: "看看这张图",
        pattern: "single_agent",
        modeId: SINGLE_AGENT_MODE_ID,
        createdAt,
      }],
      { [runId]: snapshot },
    );

    const userMessage = messages.find((m) => m.role === "user");
    expect(userMessage).toBeDefined();
    expect(userMessage!.images).toHaveLength(1);
    expect(userMessage!.images![0]).toMatchObject({
      dataUrl: "data:image/png;base64,iVBORw0KGgo=",
      mimeType: "image/png",
      name: "screenshot.png",
      sizeBytes: 12345,
    });
    expect(userMessage!.content).toBe("看看这张图");
  });

  it("returns undefined images when snapshot context has no attachedImages", () => {
    const createdAt = 1_714_000_000_000;
    const runId = "run-no-images";
    const sessionId = "session-no-images";
    const snapshot = {
      runId,
      sessionId,
      turnIndex: 1,
      status: "succeeded" as const,
      pattern: "single_agent" as const,
      modeId: SINGLE_AGENT_MODE_ID,
      input: { prompt: "Hello", createdAt, context: {} },
      config: {
        modeId: SINGLE_AGENT_MODE_ID,
        pattern: "single_agent",
        modeSelection: "manual",
        profileIds: ["ora"],
        providerId: "local-smoke",
        modelRef: "local/smoke-model",
        approvalMode: "high_risk_only",
        patternOptions: {},
        metadata: {},
        deterministicSeed: "view-model-no-images-test",
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
      events: [],
      artifacts: [],
      activeAgents: [],
      queueSummary: { mode: "dag", pending: 0, inProgress: 0, completed: 0, topics: [] },
      sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
      busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
      pendingClarifications: [],
      pendingApprovals: [],
      updatedAt: createdAt + 1,
    } as unknown as OraStateSnapshot;

    const messages = adaptChatMessages(
      [{
        id: `${runId}:user`,
        sessionId,
        runId,
        turnIndex: 1,
        role: "user" as const,
        content: "Hello",
        pattern: "single_agent",
        modeId: SINGLE_AGENT_MODE_ID,
        createdAt,
      }],
      { [runId]: snapshot },
    );

    const userMessage = messages.find((m) => m.role === "user");
    expect(userMessage).toBeDefined();
    expect(userMessage!.images).toBeUndefined();
  });
});
