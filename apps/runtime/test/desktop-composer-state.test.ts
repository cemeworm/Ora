import { describe, expect, it } from "vitest";
import { SINGLE_AGENT_MODE_ID } from "@ora/shared";
import { getComposerInteractivity } from "../../desktop/src/components/ChatInput";
import { canOpenLangfuseTrace, collectAnomalies } from "../../desktop/src/components/TrailsTabs";
import { buildRunSearchConfig } from "../../desktop/src/lib/searchSettings";
import { initialWorkbenchState, workbenchReducer } from "../../desktop/src/lib/state";
import { adaptChatMessages, adaptPendingRunMessages } from "../../desktop/src/lib/viewModel";
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

  it("renders pending run messages before the runtime snapshot arrives", () => {
    const messages = adaptPendingRunMessages({
      sessionId: "session-1",
      prompt: "hello",
      createdAt: 10,
    });

    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ role: "user", content: "hello" });
    expect(messages[1]).toMatchObject({ role: "assistant", content: "Working on it...", isPlaceholder: true });
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

    expect(messages.find((message) => message.role === "assistant")?.content).toBe("Working on it...");
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
