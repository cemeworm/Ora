import { describe, expect, it } from "vitest";
import { getModePreset, modeSpecToPatternDefinition, SINGLE_AGENT_MODE_ID } from "@ora/shared";
import { getComposerInteractivity } from "../../desktop/src/components/ChatInput";
import { canOpenLangfuseTrace, collectAnomalies } from "../../desktop/src/components/TrailsTabs";
import { buildRunSearchConfig } from "../../desktop/src/lib/searchSettings";
import { initialWorkbenchState, workbenchReducer } from "../../desktop/src/lib/state";
import { buildPendingClarificationResumePatch, waitForPendingRunPaint } from "../../desktop/src/lib/useRunActions";
import { adaptChatMessages, adaptPendingRunMessages, buildWorkbenchViewModel, isSessionProcessing } from "../../desktop/src/lib/viewModel";
import type { OraStateSnapshot } from "../../desktop/src/lib/runtimeClient";

describe("desktop composer pending-run behavior", () => {
  it("defaults fresh desktop mode selection to single agent", () => {
    const next = workbenchReducer(initialWorkbenchState, {
      type: "BOOTSTRAP",
      patterns: [],
      modes: [
        { id: "generator_verifier", family: "generator_verifier" },
        { id: SINGLE_AGENT_MODE_ID, family: "orchestrator_subagent" },
      ] as any,
      projects: [],
      providerRegistry: { defaultProviderId: "local-smoke", providers: [] } as any,
      toolRegistry: { tools: [] } as any,
      packageStore: { rootPath: "/tmp", active: { channel: "local", compatibilityStatus: "unknown" }, packages: [] } as any,
      skillRegistry: { skills: [] } as any,
      providerSecretStatuses: [],
      providerStatuses: [],
      health: { ok: true, mode: "browser_mock", service: "Runtime", detail: "ok" },
    });

    expect(next.selectedModeId).toBe(SINGLE_AGENT_MODE_ID);
    expect(next.selectedModeSelection).toBe("manual");
    expect(next.selectedPattern).toBe("orchestrator_subagent");
  });

  it("tracks auto mode selection separately from the concrete fallback mode", () => {
    const next = workbenchReducer(
      { ...initialWorkbenchState, selectedModeId: SINGLE_AGENT_MODE_ID },
      { type: "SET_MODE_SELECTION", selection: "auto" },
    );

    expect(next.selectedModeSelection).toBe("auto");
    expect(next.selectedModeId).toBe(SINGLE_AGENT_MODE_ID);
  });

  it("hydrates auto mode selection from the active snapshot config", () => {
    const state = workbenchReducer(initialWorkbenchState, {
      type: "HYDRATE_SESSION",
      projects: [],
      sessions: [{
        sessionId: "session-1",
        title: "Auto Session",
        status: "running",
        updatedAt: 1,
        latestRunId: "run-1",
        latestPattern: "orchestrator_subagent",
        latestModeId: SINGLE_AGENT_MODE_ID,
        latestProviderId: "local-smoke",
        latestModelRef: "local/smoke-model",
        turnCount: 1,
      }] as any,
      detail: {
        session: {
          sessionId: "session-1",
          title: "Auto Session",
          status: "running",
          updatedAt: 1,
          latestRunId: "run-1",
          latestPattern: "orchestrator_subagent",
          latestModeId: SINGLE_AGENT_MODE_ID,
          latestProviderId: "local-smoke",
          latestModelRef: "local/smoke-model",
          turnCount: 1,
        },
        turns: [],
        latestSnapshot: {
          runId: "run-1",
          sessionId: "session-1",
          turnIndex: 1,
          status: "running",
          pattern: "orchestrator_subagent",
          coordinationKind: "orchestrator_subagent",
          modeId: SINGLE_AGENT_MODE_ID,
          input: { prompt: "auto", createdAt: 1, context: {} },
          config: { pattern: "orchestrator_subagent", modeId: SINGLE_AGENT_MODE_ID, modeSelection: "auto", metadata: {} },
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
          queueSummary: {},
          sharedStateSummary: {},
          busStats: {},
          pendingClarifications: [],
          pendingApprovals: [],
          updatedAt: 1,
        },
      } as any,
    });

    expect(state.selectedModeSelection).toBe("auto");
    expect(state.selectedModeId).toBe(SINGLE_AGENT_MODE_ID);
  });

  it("builds run search config from desktop settings", () => {
    expect(buildRunSearchConfig({
      enabled: true,
      providerId: "mcp",
      apiKeyEnv: "",
      maxResults: "4",
      timeoutMs: "1500",
      mcpServerId: "local-docs",
      mcpToolName: "search_docs",
    })).toEqual({
      searchProvider: {
        id: "mcp",
        maxResults: 4,
        timeoutMs: 1500,
        mcpServerId: "local-docs",
        mcpToolName: "search_docs",
      },
      metadata: {},
    });

    expect(buildRunSearchConfig({
      enabled: false,
      providerId: "auto",
      apiKeyEnv: "",
      maxResults: "5",
      timeoutMs: "8000",
      mcpServerId: "",
      mcpToolName: "search",
    })).toEqual({
      metadata: { disableDefaultWebTools: true },
    });
  });

  it("keeps text entry editable while a run request is pending", () => {
    expect(getComposerInteractivity({ composerPrompt: "next question", isLoading: true })).toEqual({
      canEditText: true,
      canSubmit: false,
    });
  });

  it("records a pending run immediately after submit", () => {
    const next = workbenchReducer({ ...initialWorkbenchState, selectedSessionId: "session-1" }, {
      type: "BEGIN_RUN_REQUEST",
      sessionId: "session-1",
      prompt: "hello",
      createdAt: 10,
    });

    expect(next.isLoading).toBe(true);
    expect(next.pendingRun).toEqual({
      sessionId: "session-1",
      prompt: "hello",
      createdAt: 10,
    });
  });

  it("keeps the pending message while clearing the submitted composer text immediately", () => {
    const pending = workbenchReducer({
      ...initialWorkbenchState,
      selectedSessionId: "session-1",
      promptText: "hello",
    }, {
      type: "BEGIN_RUN_REQUEST",
      sessionId: "session-1",
      prompt: "hello",
      createdAt: 10,
    });
    const cleared = workbenchReducer(pending, {
      type: "CLEAR_PROMPT_IF_MATCH",
      text: "hello",
    });

    expect(cleared.pendingRun?.prompt).toBe("hello");
    expect(cleared.promptText).toBe("");
  });

  it("treats a pending submit as visible processing for the active session", () => {
    expect(isSessionProcessing(
      { id: "session-1", status: "done" },
      { sessionId: "session-1", prompt: "hello", createdAt: 10 },
    )).toBe(true);

    expect(isSessionProcessing(
      { id: "session-2", status: "done" },
      { sessionId: "session-1", prompt: "hello", createdAt: 10 },
    )).toBe(false);
  });

  it("yields for a browser paint before starting the runtime request", async () => {
    const originalWindow = globalThis.window;
    const calls: string[] = [];
    const mockWindow = {
      requestAnimationFrame: (callback: FrameRequestCallback) => {
        calls.push("raf");
        callback(16);
        return 1;
      },
      setTimeout: (callback: TimerHandler) => {
        calls.push("timeout");
        if (typeof callback === "function") {
          callback();
        }
        return 1;
      },
    } as unknown as Window & typeof globalThis;

    Object.defineProperty(globalThis, "window", {
      value: mockWindow,
      configurable: true,
    });

    try {
      await waitForPendingRunPaint();
    } finally {
      Object.defineProperty(globalThis, "window", {
        value: originalWindow,
        configurable: true,
      });
    }

    expect(calls).toEqual(["raf", "timeout"]);
  });

  it("optimistically clears approval gates when resume is submitted", () => {
    const snapshot = {
      runId: "run-approval",
      sessionId: "session-1",
      turnIndex: 1,
      status: "interrupted",
      pattern: "orchestrator_subagent",
      input: { prompt: "install skills", createdAt: 1 },
      config: { pattern: "orchestrator_subagent", metadata: {} },
      topology: { nodes: [], edges: [] },
      profiles: [],
      memory: [],
      plan: [],
      todos: [],
      actions: [{
        id: "action-1",
        runId: "run-approval",
        type: "skills.create",
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
      queueSummary: {},
      sharedStateSummary: {},
      busStats: {},
      pendingClarifications: [],
      pendingApprovals: ["action-1"],
      updatedAt: 1,
    } as unknown as OraStateSnapshot;

    const next = workbenchReducer({ ...initialWorkbenchState, activeSnapshot: snapshot }, {
      type: "BEGIN_RUN_RESUME",
      runId: "run-approval",
      approvedActionIds: ["action-1"],
      updatedAt: 20,
    });

    expect(next.activeSnapshot?.status).toBe("running");
    expect(next.activeSnapshot?.pendingApprovals).toEqual([]);
    expect(next.activeSnapshot?.actions[0]?.status).toBe("approved");
    expect(next.isLoading).toBe(true);
  });

  it("navigates back to chat when selecting a historical session from another view", () => {
    const next = workbenchReducer({
      ...initialWorkbenchState,
      activeView: "modes",
      sessions: [{
        sessionId: "session-1",
        title: "Historical chat",
        status: "succeeded",
        updatedAt: 10,
        latestPattern: "orchestrator_subagent",
        latestModeId: SINGLE_AGENT_MODE_ID,
        turnCount: 1,
      }] as any,
    }, {
      type: "SELECT_SESSION",
      sessionId: "session-1",
    });

    expect(next.activeView).toBe("chat");
    expect(next.selectedSessionId).toBe("session-1");
    expect(next.activeSessionDetail?.session.sessionId).toBe("session-1");
    expect(next.activeSessionDetail?.transcript).toEqual([]);
    expect(next.selectedModeId).toBe(SINGLE_AGENT_MODE_ID);
  });

  it("uses cached session detail immediately while a historical session refreshes", () => {
    const cachedDetail = {
      session: {
        sessionId: "session-1",
        title: "Cached chat",
        status: "succeeded",
        updatedAt: 10,
        latestPattern: "orchestrator_subagent",
        latestModeId: SINGLE_AGENT_MODE_ID,
        turnCount: 1,
      },
      turns: [],
      transcript: [{
        id: "run-1:user",
        sessionId: "session-1",
        runId: "run-1",
        turnIndex: 1,
        role: "user",
        content: "cached prompt",
        pattern: "orchestrator_subagent",
        createdAt: 10,
      }],
    } as any;

    const next = workbenchReducer({
      ...initialWorkbenchState,
      sessionDetailsById: { "session-1": cachedDetail },
    }, {
      type: "SELECT_SESSION",
      sessionId: "session-1",
    });

    expect(next.activeSessionDetail).toBe(cachedDetail);
    expect(next.activeSessionDetail?.transcript[0]?.content).toBe("cached prompt");
  });

  it("prefetches session detail without changing the active conversation", () => {
    const detail = {
      session: {
        sessionId: "session-prefetch",
        title: "Prefetched chat",
        status: "succeeded",
        updatedAt: 10,
        latestPattern: "orchestrator_subagent",
        latestModeId: SINGLE_AGENT_MODE_ID,
        turnCount: 1,
      },
      turns: [],
      transcript: [],
    } as any;

    const next = workbenchReducer({
      ...initialWorkbenchState,
      selectedSessionId: "session-active",
      activeSessionDetail: {
        session: {
          sessionId: "session-active",
          title: "Active chat",
          status: "succeeded",
          updatedAt: 5,
          latestPattern: "orchestrator_subagent",
          latestModeId: SINGLE_AGENT_MODE_ID,
          turnCount: 0,
        },
        turns: [],
        transcript: [],
      } as any,
    }, {
      type: "CACHE_SESSION_DETAIL",
      detail,
    });

    expect(next.selectedSessionId).toBe("session-active");
    expect(next.activeSessionDetail?.session.sessionId).toBe("session-active");
    expect(next.sessionDetailsById["session-prefetch"]).toBe(detail);
  });

  it("renders pending run messages before the runtime snapshot arrives", () => {
    const messages = adaptPendingRunMessages({
      sessionId: "session-1",
      prompt: "hello",
      createdAt: 10,
    });

    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ role: "user", content: "hello" });
    expect(messages[1]).toMatchObject({ role: "assistant", content: "", isPlaceholder: true });
  });

  it("keeps the submitted user message visible when a run snapshot arrives before transcript hydration", () => {
    const snapshot = {
      runId: "run-live",
      sessionId: "session-live",
      turnIndex: 1,
      status: "running",
      pattern: "orchestrator_subagent",
      input: { prompt: "hello", createdAt: 10, context: {} },
      config: { pattern: "orchestrator_subagent", metadata: {} },
      topology: { nodes: [], edges: [] },
      profiles: [],
      memory: [],
      plan: [],
      todos: [],
      actions: [],
      policyDecisions: [],
      checkpoints: [],
      events: [],
      artifacts: [],
      activeAgents: [],
      queueSummary: {},
      sharedStateSummary: {},
      busStats: {},
      pendingClarifications: [],
      pendingApprovals: [],
      updatedAt: 11,
    } as unknown as OraStateSnapshot;

    const messages = adaptChatMessages([], { "run-live": snapshot });

    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ role: "user", content: "hello" });
    expect(messages[1]).toMatchObject({ role: "assistant", content: "", isPlaceholder: true });
  });

  it("renders pending clarification as the assistant reply and builds a resume patch from the next input", () => {
    const snapshot = {
      runId: "run-clarify",
      sessionId: "session-clarify",
      turnIndex: 1,
      status: "interrupted",
      pattern: "orchestrator_subagent",
      input: {
        prompt: "查一下关于‘跨境扫码付’的最新汇率清算协议，我们这种规模的机构，现在的结算 T+N 周期有没有缩短？",
        createdAt: 10,
        context: {},
      },
      config: { pattern: "orchestrator_subagent", metadata: {} },
      topology: { nodes: [], edges: [] },
      profiles: [],
      memory: [],
      plan: [],
      todos: [],
      actions: [],
      policyDecisions: [],
      checkpoints: [],
      events: [{
        id: "run-clarify:evt-0",
        runId: "run-clarify",
        seq: 0,
        type: "clarification.required",
        createdAt: 11,
        pattern: "orchestrator_subagent",
        payload: {
          clarification: {
            id: "clarification:intent_guard",
            nodeId: "intent_guard",
            nodeLabel: "Clarify request",
            key: "intent_guard",
            question: "在继续查资料前，我需要确认：你们在这个问题里的角色是清算通道方、收单机构还是跨境商户？另外“这种规模”大概指月交易额、日单量、商户数、牌照/地区范围中的哪些指标？这些会直接影响结算 T+N 判断。",
            requestedAt: 11,
          },
          pending: 1,
        },
      }],
      artifacts: [],
      activeAgents: [],
      queueSummary: {},
      sharedStateSummary: {},
      busStats: {},
      pendingClarifications: [{
        id: "clarification:intent_guard",
        nodeId: "intent_guard",
        nodeLabel: "Clarify request",
        key: "intent_guard",
        question: "在继续查资料前，我需要确认：你们在这个问题里的角色是清算通道方、收单机构还是跨境商户？另外“这种规模”大概指月交易额、日单量、商户数、牌照/地区范围中的哪些指标？这些会直接影响结算 T+N 判断。",
        requestedAt: 11,
      }],
      pendingApprovals: [],
      updatedAt: 12,
    } as unknown as OraStateSnapshot;

    const messages = adaptChatMessages([], { "run-clarify": snapshot });

    expect(messages[0]).toMatchObject({ role: "user", content: snapshot.input.prompt });
    expect(messages[1]).toMatchObject({
      role: "assistant",
      content: expect.stringContaining("角色是清算通道方、收单机构还是跨境商户"),
      isPlaceholder: false,
    });
    expect(buildPendingClarificationResumePatch(snapshot, "我们是收单机构，月交易额约 3000 万。")).toEqual({
      clarifications: {
        intent_guard: "我们是收单机构，月交易额约 3000 万。",
      },
    });
  });

  it("only clears the submitted prompt when the user has not typed a new draft", () => {
    const pending = {
      ...initialWorkbenchState,
      promptText: "second prompt typed while first is running",
      isLoading: true,
    };

    const unchanged = workbenchReducer(pending, {
      type: "CLEAR_PROMPT_IF_MATCH",
      text: "first submitted prompt",
    });
    expect(unchanged.promptText).toBe("second prompt typed while first is running");

    const cleared = workbenchReducer({ ...pending, promptText: "first submitted prompt" }, {
      type: "CLEAR_PROMPT_IF_MATCH",
      text: "first submitted prompt",
    });
    expect(cleared.promptText).toBe("");
  });

  it("merges live run stream events into the active snapshot", () => {
    const snapshot = {
      runId: "run-stream",
      status: "running",
      pattern: "orchestrator_subagent",
      input: { prompt: "hello", createdAt: 1 },
      config: { pattern: "orchestrator_subagent", metadata: {} },
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
      queueSummary: {},
      sharedStateSummary: {},
      busStats: {},
      pendingClarifications: [],
      pendingApprovals: [],
      updatedAt: 1,
    } as unknown as OraStateSnapshot;

    const next = workbenchReducer({ ...initialWorkbenchState, activeSnapshot: snapshot }, {
      type: "APPLY_RUN_STREAM",
      stream: {
        runId: "run-stream",
        fromSeq: 0,
        nextSeq: 1,
        status: "running",
        events: [{
          id: "run-stream:evt-0",
          runId: "run-stream",
          seq: 0,
          type: "message.delta",
          createdAt: 2,
          pattern: "orchestrator_subagent",
          payload: { role: "assistant", content: "Hel", delta: "Hel" },
        }],
      },
    });

    expect(next.activeSnapshot?.events).toHaveLength(1);
    expect(next.activeSnapshot?.events[0]?.type).toBe("message.delta");
    expect(next.isLoading).toBe(true);
    expect(next.pendingRun).toBeUndefined();
  });

  it("syncs settled live stream status into the active session and turn", () => {
    const runningSnapshot = {
      runId: "run-stream",
      sessionId: "session-1",
      turnIndex: 1,
      status: "running",
      pattern: "orchestrator_subagent",
      input: { prompt: "hello", createdAt: 1 },
      config: { pattern: "orchestrator_subagent", providerId: "local-smoke", modelRef: "local/smoke-model", metadata: {} },
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
      queueSummary: {},
      sharedStateSummary: {},
      busStats: {},
      pendingClarifications: [],
      pendingApprovals: [],
      updatedAt: 1,
    } as unknown as OraStateSnapshot;
    const finalSnapshot = {
      ...runningSnapshot,
      status: "succeeded",
      events: [{
        id: "run-stream:evt-0",
        runId: "run-stream",
        seq: 0,
        type: "run.done",
        createdAt: 2,
        pattern: "orchestrator_subagent",
        payload: { status: "succeeded" },
      }],
      updatedAt: 2,
    } as unknown as OraStateSnapshot;
    const state = {
      ...initialWorkbenchState,
      selectedSessionId: "session-1",
      selectedTurnRunId: "run-stream",
      activeSnapshot: runningSnapshot,
      activeSessionDetail: {
        session: {
          sessionId: "session-1",
          title: "hello",
          status: "running",
          latestRunId: "run-stream",
          latestPattern: "orchestrator_subagent",
          latestProviderId: "local-smoke",
          latestModelRef: "local/smoke-model",
          turnCount: 1,
          createdAt: 1,
          updatedAt: 1,
        },
        turns: [{
          runId: "run-stream",
          sessionId: "session-1",
          turnIndex: 1,
          status: "running",
          pattern: "orchestrator_subagent",
          providerId: "local-smoke",
          modelRef: "local/smoke-model",
          prompt: "hello",
          startedAt: 1,
          updatedAt: 1,
          eventCount: 0,
          checkpointCount: 0,
          artifactCount: 0,
        }],
        transcript: [],
        latestSnapshot: runningSnapshot,
      },
      sessions: [{
        sessionId: "session-1",
        title: "hello",
        status: "running",
        latestRunId: "run-stream",
        latestPattern: "orchestrator_subagent",
        latestProviderId: "local-smoke",
        latestModelRef: "local/smoke-model",
        turnCount: 1,
        createdAt: 1,
        updatedAt: 1,
      }],
      isLoading: true,
    };

    const next = workbenchReducer(state, {
      type: "APPLY_RUN_STREAM",
      stream: {
        runId: "run-stream",
        fromSeq: 1,
        nextSeq: 1,
        status: "succeeded",
        events: [],
        snapshot: finalSnapshot,
      },
    });

    expect(next.isLoading).toBe(false);
    expect(next.sessions[0]?.status).toBe("succeeded");
    expect(next.activeSessionDetail?.session.status).toBe("succeeded");
    expect(next.activeSessionDetail?.turns[0]?.status).toBe("succeeded");
    expect(next.activeSessionDetail?.turns[0]?.eventCount).toBe(1);
    expect(next.activeSessionDetail?.latestSnapshot?.status).toBe("succeeded");
  });

  it("shows the final generator-verifier answer instead of stale verifier JSON", () => {
    const snapshot = {
      runId: "run-gv",
      turnIndex: 1,
      status: "succeeded",
      pattern: "generator_verifier",
      input: { prompt: "Summarize the project", createdAt: 1 },
      config: { pattern: "generator_verifier", metadata: {} },
      topology: { nodes: [], edges: [] },
      profiles: [],
      memory: [],
      plan: [],
      todos: [],
      actions: [],
      policyDecisions: [],
      checkpoints: [],
      events: [{
        id: "run-gv:evt-0",
        runId: "run-gv",
        seq: 0,
        type: "message.delta",
        createdAt: 2,
        pattern: "generator_verifier",
        agentId: "verifier",
        nodeId: "verifier",
        payload: {
          role: "assistant",
          content: "{\"verdict\":\"pass\",\"rationale\":\"ok\",\"missingRequirements\":[]}",
        },
      }, {
        id: "run-gv:evt-progress",
        runId: "run-gv",
        seq: 1,
        type: "task.progress",
        createdAt: 2,
        pattern: "generator_verifier",
        payload: {
          kind: "chat_progress",
          source: "progress_narrator",
          summary: "Ora is checking the generated answer before presenting the final response.",
          basedOnSeq: 0,
        },
      }],
      artifacts: [],
      activeAgents: [],
      queueSummary: {},
      sharedStateSummary: {},
      busStats: {},
      pendingClarifications: [],
      pendingApprovals: [],
      output: { text: "Final answer from the generator.", pattern: "generator_verifier" },
      updatedAt: 3,
    } as unknown as OraStateSnapshot;

    const messages = adaptChatMessages([
      {
        id: "run-gv:user",
        sessionId: "session-1",
        runId: "run-gv",
        turnIndex: 1,
        role: "user",
        content: "Summarize the project",
        pattern: "generator_verifier",
        createdAt: 1,
      },
      {
        id: "run-gv:assistant",
        sessionId: "session-1",
        runId: "run-gv",
        turnIndex: 1,
        role: "assistant",
        content: "{\"verdict\":\"pass\",\"rationale\":\"ok\",\"missingRequirements\":[]}",
        pattern: "generator_verifier",
        createdAt: 2,
      },
    ], { "run-gv": snapshot });

    expect(messages.find((message) => message.role === "assistant")?.content).toBe("Final answer from the generator.");
  });

  it("does not promote in-progress deltas into assistant body text", () => {
    const snapshot = {
      runId: "run-gv",
      turnIndex: 1,
      status: "running",
      pattern: "generator_verifier",
      input: { prompt: "Summarize the project", createdAt: 1 },
      config: { pattern: "generator_verifier", metadata: {} },
      topology: { nodes: [], edges: [] },
      profiles: [],
      memory: [],
      plan: [],
      todos: [],
      actions: [],
      policyDecisions: [],
      checkpoints: [],
      events: [
        {
          id: "run-gv:evt-0",
          runId: "run-gv",
          seq: 0,
          type: "message.delta",
          createdAt: 2,
          pattern: "generator_verifier",
          agentId: "generator",
          nodeId: "generator",
          payload: { role: "assistant", content: "Draft answer." },
        },
        {
          id: "run-gv:evt-1",
          runId: "run-gv",
          seq: 1,
          type: "message.delta",
          createdAt: 3,
          pattern: "generator_verifier",
          agentId: "verifier",
          nodeId: "verifier",
          payload: { role: "assistant", content: "{\"verdict\":\"pass\"}" },
        },
      ],
      artifacts: [],
      activeAgents: [],
      queueSummary: {},
      sharedStateSummary: {},
      busStats: {},
      pendingClarifications: [],
      pendingApprovals: [],
      updatedAt: 3,
    } as unknown as OraStateSnapshot;

    const messages = adaptChatMessages([], { "run-gv": snapshot });

    expect(messages.find((message) => message.role === "assistant")?.content).toBe("");
  });

  it("uses agent-authored progress narration as the running assistant body", () => {
    const snapshot = {
      runId: "run-progress",
      turnIndex: 1,
      status: "running",
      pattern: "orchestrator_subagent",
      input: { prompt: "Research the project", createdAt: 1 },
      config: { pattern: "orchestrator_subagent", metadata: { progressNarration: true } },
      topology: { nodes: [], edges: [] },
      profiles: [],
      memory: [],
      plan: [],
      todos: [],
      actions: [],
      policyDecisions: [],
      checkpoints: [],
      events: [
        {
          id: "run-progress:evt-0",
          runId: "run-progress",
          seq: 0,
          type: "message.delta",
          createdAt: 2,
          pattern: "orchestrator_subagent",
          payload: { role: "assistant", content: "Draft answer that should stay hidden." },
        },
        {
          id: "run-progress:evt-1",
          runId: "run-progress",
          seq: 1,
          type: "task.progress",
          createdAt: 3,
          pattern: "orchestrator_subagent",
          payload: {
            kind: "chat_progress",
            source: "progress_narrator",
            summary: "Ora has finished reading the project context and is now shaping the response.",
            basedOnSeq: 0,
          },
        },
      ],
      artifacts: [],
      activeAgents: [],
      queueSummary: {},
      sharedStateSummary: {},
      busStats: {},
      pendingClarifications: [],
      pendingApprovals: [],
      updatedAt: 3,
    } as unknown as OraStateSnapshot;

    const messages = adaptChatMessages([], { "run-progress": snapshot });

    expect(messages.find((message) => message.role === "assistant")?.content).toBe(
      "Ora has finished reading the project context and is now shaping the response.",
    );
  });

  it("hides cached duplicate web.fetch events from chat turn steps", () => {
    const snapshot = {
      runId: "run-fetch-cache",
      turnIndex: 1,
      status: "succeeded",
      pattern: "orchestrator_subagent",
      input: { prompt: "Fetch once.", createdAt: 1 },
      config: { pattern: "orchestrator_subagent", metadata: {} },
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
          id: "run-fetch-cache:evt-0",
          runId: "run-fetch-cache",
          seq: 0,
          type: "run.started",
          createdAt: 1,
          pattern: "orchestrator_subagent",
          payload: { message: "started" },
        },
        {
          id: "run-fetch-cache:evt-1",
          runId: "run-fetch-cache",
          seq: 1,
          type: "tool.called",
          createdAt: 2,
          pattern: "orchestrator_subagent",
          payload: { toolId: "web.fetch", status: "succeeded", input: { url: "https://example.com" }, output: { url: "https://example.com", status: 200 }, cacheHit: false },
        },
        {
          id: "run-fetch-cache:evt-2",
          runId: "run-fetch-cache",
          seq: 2,
          type: "tool.called",
          createdAt: 3,
          pattern: "orchestrator_subagent",
          payload: { toolId: "web.fetch", status: "succeeded", input: { url: "https://example.com" }, output: { url: "https://example.com", status: 200 }, cacheHit: true },
        },
        {
          id: "run-fetch-cache:evt-3",
          runId: "run-fetch-cache",
          seq: 3,
          type: "run.done",
          createdAt: 4,
          pattern: "orchestrator_subagent",
          payload: { status: "succeeded" },
        },
      ],
      artifacts: [],
      activeAgents: [],
      queueSummary: {},
      sharedStateSummary: {},
      busStats: {},
      pendingClarifications: [],
      pendingApprovals: [],
      output: { text: "Done." },
      updatedAt: 4,
    } as unknown as OraStateSnapshot;

    const assistant = adaptChatMessages([], { "run-fetch-cache": snapshot }).find((message) => message.role === "assistant");

    expect(assistant?.turn?.processSteps.filter((step) => step.eventType === "tool.called")).toHaveLength(1);
    expect(assistant?.turn?.processSteps.find((step) => step.eventType === "tool.called")).toMatchObject({
      label: "浏览网页",
      detail: "已查看 https://example.com.",
      contextLabel: "https://example.com",
    });
  });

  it("keeps each browsed webpage as a separate auditable step", () => {
    const urls = [
      "https://github.com/tw93/Waza",
      "https://raw.githubusercontent.com/tw93/Waza/main/README.md",
      "https://raw.githubusercontent.com/tw93/Waza/main/skills/think/SKILL.md",
    ];
    const snapshot = {
      runId: "run-fetch-pages",
      turnIndex: 1,
      status: "succeeded",
      pattern: "orchestrator_subagent",
      input: { prompt: "Install Waza skills.", createdAt: 1 },
      config: { pattern: "orchestrator_subagent", metadata: {} },
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
          id: "run-fetch-pages:checkpoint",
          runId: "run-fetch-pages",
          seq: 0,
          type: "checkpoint.created",
          createdAt: 1,
          pattern: "orchestrator_subagent",
          payload: { checkpoint: { id: "checkpoint-1", label: "Initial checkpoint" } },
        },
        ...urls.map((url, index) => ({
          id: `run-fetch-pages:fetch-${index}`,
          runId: "run-fetch-pages",
          seq: index + 1,
          type: "tool.called",
          createdAt: index + 2,
          pattern: "orchestrator_subagent",
          payload: { toolId: "web.fetch", status: "succeeded", input: { url }, output: { url, status: 200 } },
        })),
      ],
      artifacts: [],
      activeAgents: [],
      queueSummary: {},
      sharedStateSummary: {},
      busStats: {},
      pendingClarifications: [],
      pendingApprovals: [],
      output: { text: "Done." },
      updatedAt: 5,
    } as unknown as OraStateSnapshot;

    const steps = adaptChatMessages([], { "run-fetch-pages": snapshot })
      .find((message) => message.role === "assistant")?.turn?.processSteps ?? [];

    expect(steps).toHaveLength(3);
    expect(steps.map((step) => step.label)).toEqual(["浏览网页", "浏览网页", "浏览网页"]);
    expect(steps.map((step) => step.detail)).toEqual(urls.map((url) => `已查看 ${url}.`));
    expect(steps.some((step) => step.eventType === "checkpoint.created")).toBe(false);
    expect(steps.some((step) => step.detail.includes("200"))).toBe(false);
  });

  it("shows rejected final tool-call text as a user-readable stop step", () => {
    const snapshot = {
      runId: "run-final-tool-intent",
      turnIndex: 1,
      status: "failed",
      pattern: "orchestrator_subagent",
      input: { prompt: "Fetch before answering.", createdAt: 1 },
      config: { pattern: "orchestrator_subagent", metadata: {} },
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
          id: "run-final-tool-intent:evt-stream",
          runId: "run-final-tool-intent",
          seq: 0,
          type: "message.delta",
          createdAt: 2,
          pattern: "orchestrator_subagent",
          payload: { role: "assistant", content: "{\"tool\":\"web.fetch\",\"args\":{\"url\":\"https://example.com/second\"}}" },
        },
        {
          id: "run-final-tool-intent:evt-0",
          runId: "run-final-tool-intent",
          seq: 1,
          type: "completion.updated",
          createdAt: 3,
          pattern: "orchestrator_subagent",
          payload: { state: "tool_call_text_rejected", reason: "forced_final_answer", toolId: "web.fetch" },
        },
        {
          id: "run-final-tool-intent:evt-action",
          runId: "run-final-tool-intent",
          seq: 2,
          type: "action.updated",
          createdAt: 4,
          pattern: "orchestrator_subagent",
          payload: {
            actionId: "action-1",
            status: "failed",
            record: { error: "Model returned a tool call instead of a final answer after completion control disabled tools: web.fetch." },
          },
        },
        {
          id: "run-final-tool-intent:evt-1",
          runId: "run-final-tool-intent",
          seq: 3,
          type: "run.failed",
          createdAt: 5,
          pattern: "orchestrator_subagent",
          payload: { status: "failed", error: "Model returned a tool call instead of a final answer after completion control disabled tools: web.fetch." },
        },
      ],
      artifacts: [],
      activeAgents: [],
      queueSummary: {},
      sharedStateSummary: {},
      busStats: {},
      pendingClarifications: [],
      pendingApprovals: [],
      error: "Model returned a tool call instead of a final answer after completion control disabled tools: web.fetch.",
      updatedAt: 3,
    } as unknown as OraStateSnapshot;

    const assistant = adaptChatMessages([{
      id: "run-final-tool-intent:assistant",
      sessionId: "session-1",
      runId: "run-final-tool-intent",
      turnIndex: 1,
      role: "assistant",
      content: "{\"tool\":\"web.fetch\",\"args\":{\"url\":\"https://example.com/second\"}}",
      pattern: "orchestrator_subagent",
      createdAt: 2,
    }], { "run-final-tool-intent": snapshot }).find((message) => message.role === "assistant");

    expect(assistant?.content).toBe(
      "Model returned a tool call instead of a final answer after completion control disabled tools: web.fetch.",
    );
    expect(assistant?.turn?.processSteps.find((step) => step.eventType === "completion.updated")).toMatchObject({
      label: "Stopped tool use",
      detail: "",
    });
    expect(assistant?.turn?.processSteps.find((step) => step.eventType === "action.updated")).toMatchObject({
      label: "Action failed",
      detail: "The model tried to call another tool after Ora had stopped tool use, so the turn ended with the available answer.",
    });
    expect(collectAnomalies(snapshot, undefined, undefined, [])[0]).toBe(
      "Run failed: Model returned a tool call instead of a final answer after completion control disabled tools: web.fetch.",
    );
  });

  it("does not show routine node runtime states as assistant steps", () => {
    const snapshot = {
      runId: "run-node-states",
      turnIndex: 1,
      status: "succeeded",
      pattern: "orchestrator_subagent",
      input: { prompt: "Fetch once.", createdAt: 1 },
      config: { pattern: "orchestrator_subagent", metadata: {} },
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
        ...["pending", "running_model", "tool_requested", "tool_running", "tool_result_observed", "finalizing", "completed"].map((state, index) => ({
          id: `run-node-states:evt-node-${index}`,
          runId: "run-node-states",
          seq: index,
          type: "node.updated",
          createdAt: 2 + index,
          pattern: "orchestrator_subagent",
          payload: { state, title: "Respond", toolId: state.includes("tool") ? "web.fetch" : undefined },
        })),
        {
          id: "run-node-states:evt-tool",
          runId: "run-node-states",
          seq: 10,
          type: "tool.called",
          createdAt: 10,
          pattern: "orchestrator_subagent",
          payload: { toolId: "web.fetch", status: "succeeded", input: { url: "https://example.com" }, output: { status: 200 } },
        },
        {
          id: "run-node-states:evt-repairing",
          runId: "run-node-states",
          seq: 11,
          type: "node.updated",
          createdAt: 11,
          pattern: "orchestrator_subagent",
          payload: { state: "repairing", title: "Respond", detail: "synthetic tool result" },
        },
      ],
      artifacts: [],
      activeAgents: [],
      queueSummary: {},
      sharedStateSummary: {},
      busStats: {},
      pendingClarifications: [],
      pendingApprovals: [],
      output: { text: "Done." },
      updatedAt: 12,
    } as unknown as OraStateSnapshot;

    const assistant = adaptChatMessages([], { "run-node-states": snapshot }).find((message) => message.role === "assistant");
    const nodeSteps = assistant?.turn?.processSteps.filter((step) => step.eventType === "node.updated") ?? [];

    expect(nodeSteps).toHaveLength(1);
    expect(nodeSteps[0]?.detail).toBe("Recovered missing tool context synthetic tool result.");
    expect(assistant?.turn?.processSteps.some((step) => step.detail === "Respond pending.")).toBe(false);
    expect(assistant?.turn?.processSteps.some((step) => step.detail === "Respond running_model.")).toBe(false);
  });

  it("uses the active snapshot status instead of a stale running session summary", () => {
    const mode = getModePreset(SINGLE_AGENT_MODE_ID)!;
    const pattern = modeSpecToPatternDefinition(mode);
    const snapshot = {
      runId: "run-settled",
      sessionId: "session-settled",
      turnIndex: 1,
      status: "succeeded",
      pattern: "orchestrator_subagent",
      modeId: SINGLE_AGENT_MODE_ID,
      input: { prompt: "Install skills.", createdAt: 1 },
      config: { modeId: SINGLE_AGENT_MODE_ID, pattern: "orchestrator_subagent", metadata: {} },
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
      queueSummary: {},
      sharedStateSummary: {},
      busStats: {},
      pendingClarifications: [],
      pendingApprovals: [],
      output: { text: "Done." },
      updatedAt: 20,
    } as unknown as OraStateSnapshot;

    const view = buildWorkbenchViewModel(
      [pattern],
      [mode],
      [{
        sessionId: "session-settled",
        title: "Install skills",
        status: "running",
        latestRunId: "run-settled",
        latestPattern: "orchestrator_subagent",
        latestModeId: SINGLE_AGENT_MODE_ID,
        turnCount: 1,
        updatedAt: 5,
      }],
      {
        session: {
          sessionId: "session-settled",
          title: "Install skills",
          status: "running",
          latestRunId: "run-settled",
          latestPattern: "orchestrator_subagent",
          latestModeId: SINGLE_AGENT_MODE_ID,
          turnCount: 1,
          updatedAt: 5,
        },
        turns: [],
        latestSnapshot: snapshot,
        messages: [],
      } as any,
      snapshot,
      "orchestrator_subagent",
      SINGLE_AGENT_MODE_ID,
    );

    expect(view.sessions[0]?.status).toBe("done");
  });

  it("shows concrete failure details in Trails anomalies", () => {
    const snapshot = {
      runId: "run-failed",
      turnIndex: 1,
      status: "failed",
      pattern: "generator_verifier",
      input: { prompt: "What tools can you use?", createdAt: 1 },
      config: { pattern: "generator_verifier", metadata: {} },
      topology: { nodes: [], edges: [] },
      profiles: [],
      memory: [],
      plan: [],
      todos: [],
      actions: [],
      policyDecisions: [],
      checkpoints: [],
      events: [{
        id: "run-failed:evt-0",
        runId: "run-failed",
        seq: 0,
        type: "run.failed",
        createdAt: 2,
        pattern: "generator_verifier",
        payload: { status: "failed", error: "Verifier response did not contain a parseable pass/fail verdict." },
      }],
      artifacts: [],
      activeAgents: [],
      queueSummary: {},
      sharedStateSummary: {},
      busStats: {},
      pendingClarifications: [],
      pendingApprovals: [],
      updatedAt: 2,
    } as unknown as OraStateSnapshot;

    expect(collectAnomalies(snapshot, undefined, undefined, [])[0]).toBe(
      "Run failed: Verifier response did not contain a parseable pass/fail verdict.",
    );
  });

  it("shows repaired tool calls in Trails anomalies", () => {
    const snapshot = {
      runId: "run-repaired",
      turnIndex: 1,
      status: "succeeded",
      pattern: "orchestrator_subagent",
      input: { prompt: "Continue.", createdAt: 1 },
      config: { pattern: "orchestrator_subagent", metadata: {} },
      topology: { nodes: [], edges: [] },
      profiles: [],
      memory: [],
      plan: [],
      todos: [],
      actions: [],
      toolCalls: [{
        id: "run-repaired:tool-call-0",
        providerCallId: "call-1",
        runId: "run-repaired",
        toolId: "web.search",
        args: { query: "Ora" },
        source: "manual_repair",
        status: "repaired",
        requestedAt: 1,
        updatedAt: 2,
        repairReason: "missing_provider_tool_result",
        result: {
          status: "interrupted",
          error: "interrupted",
          createdAt: 2,
          updatedAt: 2,
        },
      }],
      policyDecisions: [],
      checkpoints: [],
      events: [],
      artifacts: [],
      activeAgents: [],
      queueSummary: {},
      sharedStateSummary: {},
      busStats: {},
      pendingClarifications: [],
      pendingApprovals: [],
      updatedAt: 2,
    } as unknown as OraStateSnapshot;

    expect(collectAnomalies(snapshot, undefined, { enabled: true, available: true } as any, [])).toContain(
      "A dangling provider tool call was repaired as interrupted before the next model call.",
    );
  });

  it("does not offer Langfuse deep links for degraded traces", () => {
    expect(canOpenLangfuseTrace({
      provider: "langfuse",
      enabled: true,
      available: true,
      traceUrl: "http://localhost:3000/project/ora-runtime/traces/trace-1",
      source: "degraded",
      reason: "fetch failed",
      generationRefs: [],
    })).toBe(false);

    expect(canOpenLangfuseTrace({
      provider: "langfuse",
      enabled: true,
      available: true,
      traceUrl: "http://localhost:3000/project/ora-runtime/traces/trace-2",
      source: "local_synthesized",
      reason: "fetch failed",
      generationRefs: [],
    })).toBe(false);

    expect(canOpenLangfuseTrace({
      provider: "langfuse",
      enabled: true,
      available: true,
      traceUrl: "http://localhost:3000/project/ora-runtime/traces/trace-3",
      source: "managed_local",
      generationRefs: [],
    })).toBe(true);
  });
});
