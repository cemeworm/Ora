import { describe, expect, it } from "vitest";
import { DEBATE_MODE_ID, DEERFLOW_HARNESS_MODE_ID, MVP_MODES, MVP_PATTERNS, ORA_ROOT_AGENT_ID, ORA_ROOT_AGENT_LABEL, SINGLE_AGENT_MODE_ID } from "@cemeworm/shared";
import { mergeStateSnapshot } from "./state";
import { adaptChatMessages, buildWorkbenchViewModel, isSessionProcessing } from "./viewModel";
import type { OraSessionDetail, OraSessionSummary, OraStateSnapshot } from "./runtimeClient";

describe("desktop session view model", () => {
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

    expect(assistant?.turn?.hasProposedPlan).toBe(true);
    expect(assistant?.content).toContain("## PlanDecisionPanel 决策状态 UI 调整");
    expect(assistant?.content).toContain("## 实施步骤");
    expect(assistant?.content).not.toContain("现在我已经充分了解了代码结构");
    expect(assistant?.content).not.toContain("<proposed_plan>");
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
      events: [],
      artifacts: [{
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
      }],
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
    expect(secondStatus?.summary).toBe("正在读取文件：apps/desktop/src/components/PlanDecisionPanel.tsx");
    expect(secondStatus?.summary).not.toContain("已探索");
  });

  it("keeps the root handoff target as turn agent while subagents stream body text", () => {
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
      ?.flatMap((item) => "content" in item && item.kind === "assistant_text" ? [item.content] : [])
      .join("\n");

    expect(assistant?.turn?.currentAgentLabel).toBe("Orchestrator");
    expect(timelineText).toContain("Researcher is checking the relevant files.");
    expect(timelineText).toContain("Reviewer is validating the findings.");
  });

  it("uses the primary profile as turn agent when subagents stream without a root handoff", () => {
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

    expect(assistant?.turn?.currentAgentLabel).toBe("Orchestrator");
    expect(assistant?.turn?.timelineItems?.[0]).toMatchObject({
      kind: "assistant_text",
      content: "Researcher is reading delegated files.",
    });
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

  it("keeps orchestrator subagent handoff messages in assistant turns", () => {
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

    expect(assistant?.turn?.agentMessages).toHaveLength(3);
    expect(assistant?.turn?.agentMessages.map((message) => message.kind)).toEqual(["handoff", "status", "reply"]);
    expect(assistant?.turn?.agentMessages[0]?.fromAgentLabel).toBe(ORA_ROOT_AGENT_LABEL);
    expect(assistant?.turn?.agentMessages[0]?.toAgentLabels).toEqual(["Orchestrator"]);
    expect(assistant?.turn?.agentMessages[2]?.fromAgentLabel).toBe("Orchestrator");
    expect(assistant?.turn?.agentMessages[2]?.toAgentLabels).toEqual([ORA_ROOT_AGENT_LABEL]);
    expect(assistant?.turn?.currentAgentLabel).toBe("Orchestrator");
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

  it("shows progress narration as assistant content without process steps", () => {
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

    expect(assistant?.content).toBe("研究已完成，审核子代理正在运行，下一步将进行综合。");
    expect(assistant?.turn?.liveProgressText).toBe("研究已完成，审核子代理正在运行，下一步将进行综合。");
    expect(assistant?.turn?.processSteps).toEqual([]);
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

    expect(statusMessage?.content).toBe("已选择单智能体模式，我准备好了");
    expect(statusMessage?.turn?.liveProgressText).toBe("已选择单智能体模式，我准备好了");
    expect(deltaMessage?.content).toBe("我会先读取这些 skill。");
    expect(deltaMessage?.content).not.toBe(deltaMessage?.turn?.liveProgressText);
    expect(deltaMessage?.content).not.toContain("已选择单智能体模式");
    expect(deltaMessage?.turn?.liveProgressText).toBe("已选择单智能体模式，我准备好了");
    expect(placeholderMessage?.content).toBe("");
    expect(placeholderMessage?.turn?.liveProgressText).toBeUndefined();
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

    expect(assistant?.content).toBe("正在检查决策 UI。");
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
          id: "run-turn-timeline:evt-5",
          runId: "run-turn-timeline",
          seq: 5,
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
      "assistant_text",
      "status_group",
      "assistant_text",
      "plan_update",
      "final_text",
    ]);
    expect(timeline[0]).toMatchObject({ content: "我会先追踪本地运行记录，确认问题链路。" });
    expect(timeline[1]).toMatchObject({
      summary: "已探索 1 个文件，1 个列表，已运行 1 条命令",
      steps: expect.arrayContaining([
        expect.objectContaining({ label: "读取文件", contextLabel: ".ora/runtime.db" }),
        expect.objectContaining({ label: "列出文件", contextLabel: "sessions/runs" }),
        expect.objectContaining({ label: "运行命令" }),
      ]),
    });
    expect(timeline[2]).toMatchObject({ content: "现在我会把 trace 的事件和最终状态拼起来。" });
    expect(timeline[3]).toMatchObject({ summary: "已更新任务计划：1/2 完成，正在 汇总结论" });
    expect(timeline[4]).toMatchObject({ content: "最终结论：run 没有停在计划阶段。" });
    expect(assistant?.content).toBe("最终结论：run 没有停在计划阶段。");
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

  it("marks superseded progress narration complete while the run is still active", () => {
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

    expect(assistant?.content).toBe("团队已读取项目文档，正在规划后续调研任务。");
    expect(assistant?.turn?.liveProgressText).toBe("团队已读取项目文档，正在规划后续调研任务。");
    expect(processSteps.map((step) => step.status)).toEqual([
      "complete",
    ]);
    expect(processSteps).toHaveLength(1);
    expect(processSteps[0]?.eventType).toBe("tool.called");
    expect(processSteps[0]?.label).toBe("读取文件");
    expect(processSteps[0]?.detail).toContain("已读取 10-Wiki/项目/西芒杜项目.md");
    expect(processSteps[0]?.contextLabel).toBe("10-Wiki/项目/西芒杜项目.md");
  });
});
