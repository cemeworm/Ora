import { describe, expect, it } from "vitest";
import { DEERFLOW_HARNESS_MODE_ID, MVP_MODES, MVP_PATTERNS, SINGLE_AGENT_MODE_ID } from "@ora/shared";
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
  });
});
