import { describe, expect, it } from "vitest";
import { SINGLE_AGENT_MODE_ID } from "@ora/shared";
import { initialWorkbenchState, mergeRunStreamSnapshot, mergeStateSnapshot, workbenchReducer } from "./state";
import type { WorkbenchState } from "./state";
import type { OraProviderConfig, OraRunEventStream, OraSessionSummary, OraStateSnapshot } from "./runtimeClient";

function sessionSummary(sessionId: string): OraSessionSummary {
  return {
    sessionId,
    title: sessionId,
    turnCount: 0,
    createdAt: 1_714_000_000_000,
    updatedAt: 1_714_000_000_000,
  };
}

function testSnapshot(params: {
  runId?: string;
  sessionId?: string;
  updatedAt?: number;
  agentMessages?: OraStateSnapshot["agentMessages"];
  events?: OraStateSnapshot["events"];
  latency?: OraStateSnapshot["latency"];
} = {}): OraStateSnapshot {
  const runId = params.runId ?? "run-debate";
  const sessionId = params.sessionId ?? "session-debate";
  const updatedAt = params.updatedAt ?? 1_714_000_000_000;
  return {
    runId,
    sessionId,
    turnIndex: 1,
    status: "running",
    pattern: "orchestrator_subagent",
    modeId: "debate",
    input: { prompt: "Debate this.", createdAt: updatedAt, context: {} },
    config: {
      modeId: "debate",
      pattern: "orchestrator_subagent",
      modeSelection: "manual",
      profileIds: ["debate_agent"],
      providerId: "local-smoke",
      modelRef: "local/smoke-model",
      approvalMode: "high_risk_only",
      patternOptions: {},
      metadata: {},
      deterministicSeed: "state-debate-session-switch-test",
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
    continuation: { frames: [] },
    conversation: [],
    toolResults: [],
    policyDecisions: [],
    checkpoints: [],
    events: params.events ?? [],
    agentMessages: params.agentMessages ?? [],
    artifacts: [],
    activeAgents: [],
    queueSummary: { mode: "backlog", pending: 0, inProgress: 1, completed: 0, topics: [] },
    sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
    busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
    pendingClarifications: [],
    pendingApprovals: [],
    latency: params.latency,
    updatedAt,
  } as unknown as OraStateSnapshot;
}

function debateTranscriptMessage(params: {
  id: string;
  sequence: number;
  stance: "affirmative" | "negative" | "moderator" | "neutral";
  speakerLabel: string;
  content: string;
  createdAt?: number;
  runId?: string;
}): OraStateSnapshot["agentMessages"][number] {
  return {
    id: params.id,
    runId: params.runId ?? "run-debate",
    createdAt: params.createdAt ?? 1_714_000_000_000 + params.sequence,
    fromAgentId: "debate_agent",
    toAgentIds: [],
    threadId: "debate",
    kind: "reply",
    status: "done",
    content: params.content,
    artifactIds: [],
    transcript: {
      kind: "stage_transcript",
      groupId: "debate",
      groupLabel: "结构化辩论",
      stageId: params.id,
      stageLabel: `阶段 ${params.sequence + 1}`,
      sequence: params.sequence,
      speakerLabel: params.speakerLabel,
      stance: params.stance,
      status: "done",
    },
  };
}

function agentMessageEvent(message: OraStateSnapshot["agentMessages"][number], seq: number): OraStateSnapshot["events"][number] {
  return {
    id: `${message.runId}:evt-${seq}`,
    runId: message.runId,
    seq,
    type: "agent.message",
    createdAt: message.createdAt,
    pattern: "orchestrator_subagent",
    agentId: message.fromAgentId,
    nodeId: message.nodeId ?? message.fromAgentId,
    payload: { message },
  } as unknown as OraStateSnapshot["events"][number];
}

describe("desktop workbench state", () => {
  it("does not leave a disabled provider selected after registry updates", () => {
    const enabled: OraProviderConfig = {
      id: "enabled-openai",
      type: "openai",
      label: "Enabled OpenAI",
      modelId: "gpt-4o",
      enabled: true,
      capabilities: ["chat"],
      dropParams: [],
      headers: {},
    };
    const disabled: OraProviderConfig = {
      id: "disabled-openai",
      type: "openai",
      label: "Disabled OpenAI",
      modelId: "gpt-4o-mini",
      enabled: false,
      capabilities: ["chat"],
      dropParams: [],
      headers: {},
    };

    let state: WorkbenchState = {
      ...initialWorkbenchState,
      selectedProviderId: disabled.id,
      providerRegistry: {
        providers: [disabled, enabled],
        defaultProviderId: disabled.id,
      },
    };

    state = workbenchReducer(state, {
      type: "SET_PROVIDER_REGISTRY",
      providerRegistry: {
        providers: [disabled, enabled],
        defaultProviderId: disabled.id,
      },
    });

    expect(state.selectedProviderId).toBe(enabled.id);

    state = workbenchReducer(state, { type: "SET_PROVIDER", providerId: disabled.id });
    expect(state.selectedProviderId).toBe(enabled.id);
  });

  it("keeps unsent composer text scoped to the selected session", () => {
    let state: WorkbenchState = {
      ...initialWorkbenchState,
      sessions: [sessionSummary("session-a"), sessionSummary("session-b")],
      selectedSessionId: "session-a",
    };

    state = workbenchReducer(state, { type: "SET_PROMPT", text: "draft for a" });
    state = workbenchReducer(state, { type: "SELECT_SESSION", sessionId: "session-b" });

    expect(state.promptText).toBe("");

    state = workbenchReducer(state, { type: "SET_PROMPT", text: "draft for b" });
    state = workbenchReducer(state, { type: "SELECT_SESSION", sessionId: "session-a" });

    expect(state.promptText).toBe("draft for a");

    state = workbenchReducer(state, { type: "CLEAR_PROMPT_IF_MATCH", text: "draft for a" });
    state = workbenchReducer(state, { type: "SELECT_SESSION", sessionId: "session-b" });

    expect(state.promptText).toBe("draft for b");
  });

  it("keeps pending project file attachments scoped to the selected session", () => {
    let state: WorkbenchState = {
      ...initialWorkbenchState,
      sessions: [sessionSummary("session-a"), sessionSummary("session-b")],
      selectedSessionId: "session-a",
    };

    state = workbenchReducer(state, {
      type: "ADD_PROJECT_FILE_ATTACHMENT",
      sessionId: "session-a",
      file: {
        projectId: "project-a",
        path: "src/App.tsx",
        name: "App.tsx",
        mimeType: "text/typescript",
        sizeBytes: 128,
      },
    });
    state = workbenchReducer(state, {
      type: "ADD_PROJECT_FILE_ATTACHMENT",
      sessionId: "session-a",
      file: {
        projectId: "project-a",
        path: "src/App.tsx",
        name: "App.tsx",
        mimeType: "text/typescript",
        sizeBytes: 128,
      },
    });
    state = workbenchReducer(state, {
      type: "ADD_PROJECT_FILE_ATTACHMENT",
      sessionId: "session-b",
      file: {
        projectId: "project-b",
        path: "README.md",
        name: "README.md",
        mimeType: "text/markdown",
        sizeBytes: 96,
      },
    });

    expect(state.sessionProjectFileAttachments["session-a"]).toHaveLength(1);
    expect(state.sessionProjectFileAttachments["session-b"]?.[0]?.path).toBe("README.md");

    state = workbenchReducer(state, {
      type: "REMOVE_PROJECT_FILE_ATTACHMENT",
      sessionId: "session-a",
      path: "src/App.tsx",
    });

    expect(state.sessionProjectFileAttachments["session-a"]).toBeUndefined();
    expect(state.sessionProjectFileAttachments["session-b"]).toHaveLength(1);

    state = workbenchReducer(state, {
      type: "CLEAR_PROJECT_FILE_ATTACHMENTS",
      sessionId: "session-b",
    });

    expect(state.sessionProjectFileAttachments["session-b"]).toBeUndefined();
  });

  it("keeps pending local file attachments scoped to the selected session", () => {
    let state: WorkbenchState = {
      ...initialWorkbenchState,
      sessions: [sessionSummary("session-a"), sessionSummary("session-b")],
      selectedSessionId: "session-a",
    };

    state = workbenchReducer(state, {
      type: "ADD_LOCAL_FILE_ATTACHMENT",
      sessionId: "session-a",
      file: {
        path: "/tmp/notes.md",
        name: "notes.md",
        mimeType: "text/markdown",
        sizeBytes: 128,
        content: "# Notes",
      },
    });
    state = workbenchReducer(state, {
      type: "ADD_LOCAL_FILE_ATTACHMENT",
      sessionId: "session-a",
      file: {
        path: "/tmp/notes.md",
        name: "notes.md",
        mimeType: "text/markdown",
        sizeBytes: 128,
        content: "# Notes",
      },
    });
    state = workbenchReducer(state, {
      type: "ADD_LOCAL_FILE_ATTACHMENT",
      sessionId: "session-b",
      file: {
        path: "/tmp/spec.txt",
        name: "spec.txt",
        mimeType: "text/plain",
        sizeBytes: 64,
        content: "Spec",
      },
    });

    expect(state.sessionLocalFileAttachments["session-a"]).toHaveLength(1);
    expect(state.sessionLocalFileAttachments["session-b"]?.[0]?.path).toBe("/tmp/spec.txt");

    state = workbenchReducer(state, {
      type: "REMOVE_LOCAL_FILE_ATTACHMENT",
      sessionId: "session-a",
      path: "/tmp/notes.md",
    });

    expect(state.sessionLocalFileAttachments["session-a"]).toBeUndefined();
    expect(state.sessionLocalFileAttachments["session-b"]).toHaveLength(1);

    state = workbenchReducer(state, {
      type: "CLEAR_LOCAL_FILE_ATTACHMENTS",
      sessionId: "session-b",
    });

    expect(state.sessionLocalFileAttachments["session-b"]).toBeUndefined();
  });

  it("keeps selected composer skills scoped to the selected session", () => {
    let state: WorkbenchState = {
      ...initialWorkbenchState,
      sessions: [sessionSummary("session-a"), sessionSummary("session-b")],
      selectedSessionId: "session-a",
    };

    state = workbenchReducer(state, { type: "SET_SELECTED_SKILL_IDS", skillIds: ["check"] });
    state = workbenchReducer(state, { type: "SELECT_SESSION", sessionId: "session-b" });

    expect(state.selectedSkillIds).toEqual([]);

    state = workbenchReducer(state, { type: "SET_SELECTED_SKILL_IDS", skillIds: ["frontend-design"] });
    state = workbenchReducer(state, { type: "SELECT_SESSION", sessionId: "session-a" });

    expect(state.selectedSkillIds).toEqual(["check"]);

    state = workbenchReducer(state, {
      type: "BEGIN_RUN_REQUEST",
      sessionId: "session-a",
      prompt: "use this skill",
      createdAt: Date.now(),
    });

    expect(state.selectedSkillIds).toEqual([]);
    expect(state.sessionSkillIds["session-a"]).toBeUndefined();
  });

  it("merges streamed approval action updates back into the active snapshot", () => {
    const createdAt = 1_714_000_000_000;
    const approvedActionId = "run-approval:action:solo_agent-tool-1";
    const nextActionId = "run-approval:action:solo_agent-tool-2";
    const snapshot = {
      runId: "run-approval",
      sessionId: "session-approval",
      turnIndex: 1,
      status: "running",
      pattern: "orchestrator_subagent",
      modeId: SINGLE_AGENT_MODE_ID,
      input: { prompt: "Install Waza skills.", createdAt, context: {} },
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
        deterministicSeed: "state-approval-test",
        skillIds: [],
        toolIds: ["skills.create"],
      },
      topology: { nodes: [], edges: [] },
      profiles: [],
      memory: [],
      plan: [],
      todos: [],
      actions: [{
        id: approvedActionId,
        runId: "run-approval",
        type: "skills.create",
        riskLevel: "high",
        status: "approved",
        input: { name: "waza-think" },
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
      pendingApprovals: [],
      updatedAt: createdAt,
    } as unknown as OraStateSnapshot;
    const approvalAction = {
      id: nextActionId,
      runId: "run-approval",
      type: "skills.create",
      riskLevel: "high",
      status: "approval_required",
      input: { name: "waza-design" },
      artifactIds: [],
    };
    const stream = {
      runId: "run-approval",
      status: "interrupted",
      fromSeq: 1,
      nextSeq: 3,
      events: [{
        id: "run-approval:event:2",
        runId: "run-approval",
        seq: 2,
        type: "action.updated",
        createdAt: createdAt + 1,
        payload: {
          actionId: nextActionId,
          status: "approval_required",
          record: approvalAction,
        },
      }],
    } as unknown as OraRunEventStream;

    const merged = mergeRunStreamSnapshot(snapshot, stream);

    expect(merged?.status).toBe("interrupted");
    expect(merged?.pendingApprovals).toEqual([nextActionId]);
    expect(merged?.actions.find((action) => action.id === nextActionId)).toMatchObject({
      type: "skills.create",
      status: "approval_required",
      input: { name: "waza-design" },
    });
  });

  it("preserves accumulated debate transcript messages when a narrower snapshot arrives", () => {
    const opening = debateTranscriptMessage({
      id: "run-debate:agent-message:0",
      sequence: 0,
      stance: "affirmative",
      speakerLabel: "正方主辩",
      content: "Opening argument.",
    });
    const response = debateTranscriptMessage({
      id: "run-debate:agent-message:1",
      sequence: 1,
      stance: "negative",
      speakerLabel: "反方主辩",
      content: "Opening response.",
    });
    const existing = testSnapshot({
      agentMessages: [opening],
      updatedAt: 1_714_000_000_001,
    });
    const incoming = testSnapshot({
      agentMessages: [response],
      updatedAt: 1_714_000_000_002,
    });

    const merged = mergeStateSnapshot(existing, incoming);

    expect(merged?.agentMessages.map((message) => message.transcript?.speakerLabel)).toEqual(["正方主辩", "反方主辩"]);
    expect(merged?.agentMessages.map((message) => message.content)).toEqual(["Opening argument.", "Opening response."]);
  });

  it("preserves desktop and runtime latency marks when snapshots merge", () => {
    const existing = testSnapshot({
      latency: {
        marks: [{ name: "submitAt", at: 100, source: "desktop", detail: {} }],
      },
    });
    const incoming = testSnapshot({
      latency: {
        marks: [{ name: "firstApplyLiveEvent", at: 120, source: "runtime", detail: { eventType: "run.started" } }],
      },
      updatedAt: 1_714_000_000_002,
    });

    const merged = mergeStateSnapshot(existing, incoming);

    expect(merged?.latency?.marks.map((mark) => `${mark.source}:${mark.name}`)).toEqual([
      "desktop:submitAt",
      "runtime:firstApplyLiveEvent",
    ]);
  });

  it("records desktop latency marks from received run streams", () => {
    const snapshot = testSnapshot({ runId: "run-latency" });
    const state: WorkbenchState = {
      ...initialWorkbenchState,
      selectedSessionId: snapshot.sessionId,
      selectedTurnRunId: snapshot.runId,
      activeSnapshot: snapshot,
      activeSessionDetail: {
        session: sessionSummary(snapshot.sessionId!),
        turns: [{
          runId: snapshot.runId,
          sessionId: snapshot.sessionId!,
          turnIndex: 1,
          status: "running",
          pattern: snapshot.pattern,
          prompt: snapshot.input.prompt,
          startedAt: snapshot.updatedAt,
          updatedAt: snapshot.updatedAt,
          eventCount: 0,
          checkpointCount: 0,
          artifactCount: 0,
        }],
        transcript: [],
        latestSnapshot: snapshot,
      },
    };
    const stream = {
      runId: snapshot.runId,
      fromSeq: 0,
      nextSeq: 1,
      status: "running",
      events: [{
        id: "run-latency:event:0",
        runId: snapshot.runId,
        seq: 0,
        type: "message.delta",
        createdAt: snapshot.updatedAt + 1,
        payload: { role: "assistant", content: "Hello", delta: "Hello", streaming: true },
      }],
    } as unknown as OraRunEventStream;

    const next = workbenchReducer(state, { type: "APPLY_RUN_STREAM", stream, receivedAt: 200 });

    expect(next.activeSnapshot?.latency?.marks.map((mark) => `${mark.source}:${mark.name}`)).toEqual([
      "desktop:firstRunStreamReceivedAt",
      "desktop:firstMessageDeltaAt",
      "desktop:firstNonProgressAssistantTextAt",
    ]);
  });

  it("recovers debate transcript messages from snapshot agent.message events", () => {
    const messages = [
      debateTranscriptMessage({
        id: "run-debate:agent-message:0",
        sequence: 0,
        stance: "affirmative",
        speakerLabel: "正方主辩",
        content: "Opening argument.",
      }),
      debateTranscriptMessage({
        id: "run-debate:agent-message:1",
        sequence: 1,
        stance: "negative",
        speakerLabel: "反方主辩",
        content: "Opening response.",
      }),
    ];
    const incoming = testSnapshot({
      agentMessages: [],
      events: messages.map(agentMessageEvent),
    });

    const merged = mergeStateSnapshot(undefined, incoming);

    expect(merged?.agentMessages.map((message) => message.transcript?.speakerLabel)).toEqual(["正方主辩", "反方主辩"]);
  });

  it("merges existing debate messages with later messages recovered from events", () => {
    const existingMessages = [0, 1].map((sequence) => debateTranscriptMessage({
      id: `run-debate:agent-message:${sequence}`,
      sequence,
      stance: sequence === 0 ? "affirmative" : "negative",
      speakerLabel: sequence === 0 ? "正方主辩" : "反方主辩",
      content: `Existing stage ${sequence}`,
    }));
    const incomingMessages = [2, 3, 4].map((sequence) => debateTranscriptMessage({
      id: `run-debate:agent-message:${sequence}`,
      sequence,
      stance: sequence % 2 === 0 ? "affirmative" : "negative",
      speakerLabel: sequence % 2 === 0 ? "正方副辩" : "反方副辩",
      content: `Incoming stage ${sequence}`,
    }));
    const existing = testSnapshot({ agentMessages: existingMessages, updatedAt: 1_714_000_000_001 });
    const incoming = testSnapshot({ agentMessages: [], events: incomingMessages.map(agentMessageEvent), updatedAt: 1_714_000_000_002 });

    const merged = mergeStateSnapshot(existing, incoming);

    expect(merged?.agentMessages.map((message) => message.transcript?.sequence)).toEqual([0, 1, 2, 3, 4]);
  });

  it("hydrates active snapshots with agent messages recovered from events", () => {
    const message = debateTranscriptMessage({
      id: "run-debate:agent-message:0",
      sequence: 0,
      stance: "affirmative",
      speakerLabel: "正方主辩",
      content: "Opening argument.",
    });
    const snapshot = testSnapshot({ agentMessages: [], events: [agentMessageEvent(message, 0)] });

    const state = workbenchReducer(initialWorkbenchState, {
      type: "HYDRATE_SESSION",
      projects: [],
      sessions: [sessionSummary("session-debate")],
      detail: {
        session: sessionSummary("session-debate"),
        turns: [{ runId: "run-debate" } as unknown as NonNullable<WorkbenchState["activeSessionDetail"]>["turns"][number]],
        transcript: [],
        latestSnapshot: snapshot,
      },
    });

    expect(state.activeSnapshot?.agentMessages).toHaveLength(1);
    expect(state.activeSnapshot?.agentMessages[0]?.transcript?.speakerLabel).toBe("正方主辩");
  });

  it("does not merge same-run snapshots from different sessions", () => {
    const existing = testSnapshot({
      runId: "run-shared-id",
      sessionId: "session-a",
      agentMessages: [debateTranscriptMessage({
        id: "run-debate:agent-message:0",
        sequence: 0,
        stance: "affirmative",
        speakerLabel: "正方主辩",
        content: "Session A argument.",
      })],
    });
    const incoming = testSnapshot({
      runId: "run-shared-id",
      sessionId: "session-b",
      agentMessages: [],
      updatedAt: 1_714_000_000_002,
    });

    const merged = mergeStateSnapshot(existing, incoming);

    expect(merged?.sessionId).toBe("session-b");
    expect(merged?.agentMessages).toHaveLength(0);
  });

  it("merges stream snapshots without dropping previous debate transcript stages", () => {
    const opening = debateTranscriptMessage({
      id: "run-debate:agent-message:0",
      sequence: 0,
      stance: "affirmative",
      speakerLabel: "正方主辩",
      content: "Opening argument.",
    });
    const response = debateTranscriptMessage({
      id: "run-debate:agent-message:1",
      sequence: 1,
      stance: "negative",
      speakerLabel: "反方主辩",
      content: "Opening response.",
    });
    const snapshot = testSnapshot({ agentMessages: [opening] });
    const stream = {
      runId: "run-debate",
      status: "running",
      fromSeq: 1,
      nextSeq: 2,
      events: [],
      snapshot: testSnapshot({ agentMessages: [response], updatedAt: 1_714_000_000_002 }),
    } as unknown as OraRunEventStream;

    const merged = mergeRunStreamSnapshot(snapshot, stream);

    expect(merged?.agentMessages.map((message) => message.transcript?.sequence)).toEqual([0, 1]);
  });

  it("does not replace the active snapshot when a same-run stream reports another session", () => {
    const activeSnapshot = testSnapshot({ runId: "run-active", sessionId: "session-active" });
    const state: WorkbenchState = {
      ...initialWorkbenchState,
      selectedSessionId: "session-active",
      selectedTurnRunId: "run-active",
      activeSnapshot,
      activeSessionDetail: {
        session: sessionSummary("session-active"),
        turns: [{ runId: "run-active" } as unknown as NonNullable<WorkbenchState["activeSessionDetail"]>["turns"][number]],
        transcript: [],
        latestSnapshot: activeSnapshot,
      },
    };
    const stream = {
      runId: "run-active",
      status: "running",
      fromSeq: 0,
      nextSeq: 0,
      events: [],
      snapshot: testSnapshot({ runId: "run-active", sessionId: "session-other", updatedAt: 1_714_000_000_002 }),
    } as unknown as OraRunEventStream;

    const nextState = workbenchReducer(state, { type: "APPLY_RUN_STREAM", stream });

    expect(nextState.activeSnapshot?.sessionId).toBe("session-active");
    expect(nextState.selectedTurnRunId).toBe("run-active");
  });

  it("does not replace the active snapshot with an unrelated stream snapshot", () => {
    const activeSnapshot = testSnapshot({
      runId: "run-active",
      sessionId: "session-active",
      agentMessages: [debateTranscriptMessage({
        id: "run-debate:agent-message:0",
        sequence: 0,
        stance: "affirmative",
        speakerLabel: "正方主辩",
        content: "Opening argument.",
      })],
    });
    const state: WorkbenchState = {
      ...initialWorkbenchState,
      selectedSessionId: "session-active",
      selectedTurnRunId: "run-active",
      activeSnapshot,
      activeSessionDetail: {
        session: sessionSummary("session-active"),
        turns: [{ runId: "run-active" } as unknown as NonNullable<WorkbenchState["activeSessionDetail"]>["turns"][number]],
        transcript: [],
        latestSnapshot: activeSnapshot,
      },
    };
    const stream = {
      runId: "run-background",
      status: "running",
      fromSeq: 0,
      nextSeq: 0,
      events: [],
      snapshot: testSnapshot({ runId: "run-background", sessionId: "session-background" }),
    } as unknown as OraRunEventStream;

    const nextState = workbenchReducer(state, { type: "APPLY_RUN_STREAM", stream });

    expect(nextState.activeSnapshot?.runId).toBe("run-active");
    expect(nextState.selectedTurnRunId).toBe("run-active");
  });

  it("merges streamed agent messages into the active snapshot", () => {
    const createdAt = 1_714_000_000_000;
    const snapshot = {
      runId: "run-team",
      sessionId: "session-team",
      turnIndex: 1,
      status: "running",
      pattern: "agent_teams",
      modeId: "agent_teams",
      input: { prompt: "Coordinate work.", createdAt, context: {} },
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
        deterministicSeed: "state-agent-message-test",
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
      queueSummary: { mode: "backlog", pending: 0, inProgress: 1, completed: 0, topics: [] },
      sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
      busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
      pendingClarifications: [],
      pendingApprovals: [],
      updatedAt: createdAt,
    } as unknown as OraStateSnapshot;
    const stream = {
      runId: "run-team",
      status: "running",
      fromSeq: 1,
      nextSeq: 2,
      events: [{
        id: "run-team:event:1",
        runId: "run-team",
        seq: 1,
        type: "agent.message",
        createdAt: createdAt + 1,
        payload: {
          message: {
            id: "run-team:agent-message:0",
            runId: "run-team",
            createdAt: createdAt + 1,
            fromAgentId: "team_lead",
            toAgentIds: ["builder"],
            threadId: "agent-teams:build",
            kind: "mention",
            status: "done",
            content: "@builder build this.",
            artifactIds: [],
            transcript: {
              kind: "stage_transcript",
              groupId: "debate",
              groupLabel: "结构化辩论",
              stageId: "affirmative-lead-opening",
              stageLabel: "开篇立论",
              sequence: 0,
              speakerLabel: "正方主辩",
              stance: "affirmative",
              status: "done",
            },
          },
        },
      }],
    } as unknown as OraRunEventStream;

    const merged = mergeRunStreamSnapshot(snapshot, stream);

    expect(merged?.agentMessages).toHaveLength(1);
    expect(merged?.agentMessages[0]?.fromAgentId).toBe("team_lead");
    expect(merged?.agentMessages[0]?.toAgentIds).toEqual(["builder"]);
    expect(merged?.agentMessages[0]?.transcript?.speakerLabel).toBe("正方主辩");
    expect(merged?.agentMessages[0]?.transcript?.sequence).toBe(0);
  });
});
