import { describe, expect, it } from "vitest";
import { SINGLE_AGENT_MODE_ID } from "@ora/shared";
import { initialWorkbenchState, mergeRunStreamSnapshot, workbenchReducer } from "./state";
import type { WorkbenchState } from "./state";
import type { OraRunEventStream, OraSessionSummary, OraStateSnapshot } from "./runtimeClient";

function sessionSummary(sessionId: string): OraSessionSummary {
  return {
    sessionId,
    title: sessionId,
    turnCount: 0,
    createdAt: 1_714_000_000_000,
    updatedAt: 1_714_000_000_000,
  };
}

describe("desktop workbench state", () => {
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
