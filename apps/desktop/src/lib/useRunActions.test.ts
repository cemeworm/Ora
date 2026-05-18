import { describe, expect, it } from "vitest";
import { initialWorkbenchState, type WorkbenchState } from "./state";
import {
  buildClarificationSubmissionPrompt,
  buildDesktopRunContext,
  getSelectedInteractiveSnapshot,
  isDisposableEmptySession,
  shouldEnableClarificationPreflight,
  stableViewModelCacheKey,
  toolIdsForRun,
} from "./useRunActions";
import type { OraSessionSummary, OraStateSnapshot } from "./runtimeClient";

describe("desktop run actions", () => {
  it("keeps clarification preflight off by default for all task intents", () => {
    expect(shouldEnableClarificationPreflight("implement")).toBe(false);
    expect(shouldEnableClarificationPreflight("plan")).toBe(false);
    expect(shouldEnableClarificationPreflight("chat")).toBe(false);
  });

  it("removes project-required workspace tools when no project is selected", () => {
    expect(toolIdsForRun([
      "file.read",
      "file.list",
      "file.glob",
      "file.grep",
      "file.write",
      "file.patch",
      "file.delete",
      "shell.execute",
      "web.fetch",
      "web.search",
      "document.extract",
      "skills.list",
      "user.clarify",
    ], undefined)).toEqual([
      "web.fetch",
      "web.search",
      "document.extract",
      "skills.list",
      "user.clarify",
    ]);
  });

  it("keeps project workspace tools and adds safe chat file tools when a project is selected", () => {
    expect(toolIdsForRun(["web.fetch", "file.write"], "project-1")).toEqual([
      "web.fetch",
      "file.write",
      "file.read",
      "file.list",
      "file.glob",
      "file.grep",
    ]);
  });

  it("invalidates stable view model cache when the composer mode changes", () => {
    const base = {
      activeSessionId: "session-1",
      selectedPattern: "agent_teams",
      modeIds: ["message_bus", "code_development"],
    };

    expect(stableViewModelCacheKey({
      ...base,
      selectedModeId: "message_bus",
    })).not.toBe(stableViewModelCacheKey({
      ...base,
      selectedModeId: "code_development",
    }));
  });

  it("invalidates stable view model cache when session run state changes", () => {
    const base = {
      activeSessionId: "session-1",
      selectedPattern: "agent_teams",
      selectedModeId: "message_bus",
      modeIds: ["message_bus", "code_development"],
    };

    expect(stableViewModelCacheKey({
      ...base,
      sessionRunStateKey: "session-1:succeeded::run-1",
    })).not.toBe(stableViewModelCacheKey({
      ...base,
      sessionRunStateKey: "session-1:running:running:run-1",
    }));
  });

  it("includes attached project files in run context", () => {
    expect(buildDesktopRunContext([
      {
        projectId: "project-a",
        path: "src/App.tsx",
        name: "App.tsx",
        mimeType: "text/typescript",
        sizeBytes: 128,
      },
    ])).toEqual({
      source: "desktop-workbench",
      attachedProjectFiles: [
        {
          projectId: "project-a",
          path: "src/App.tsx",
          name: "App.tsx",
          mimeType: "text/typescript",
          sizeBytes: 128,
        },
      ],
    });
  });

  it("omits attached project files when none are pending", () => {
    expect(buildDesktopRunContext()).toEqual({ source: "desktop-workbench" });
  });

  it("merges extra run context with existing desktop attachments", () => {
    expect(buildDesktopRunContext(
      [],
      [{
        path: "/tmp/note.txt",
        name: "note.txt",
        mimeType: "text/plain",
        sizeBytes: 12,
        content: "hello",
      }],
      [],
      {
        selectedWidgetContext: {
          id: "widget-1",
          title: "任务清单",
        },
      },
    )).toEqual({
      source: "desktop-workbench",
      selectedWidgetContext: {
        id: "widget-1",
        title: "任务清单",
      },
      attachedLocalFiles: [{
        path: "/tmp/note.txt",
        name: "note.txt",
        mimeType: "text/plain",
        sizeBytes: 12,
        content: "hello",
      }],
    });
  });

  it("summarizes multiple clarification answers for the pending user message", () => {
    expect(buildClarificationSubmissionPrompt(
      {
        target_environment: "staging",
        time_window: "最近 30 天",
      },
      [
        {
          id: "clarification:env",
          nodeId: "root",
          nodeLabel: "Ora",
          key: "target_environment",
          question: "目标环境",
          options: [],
          requestedAt: 1,
        },
        {
          id: "clarification:time",
          nodeId: "root",
          nodeLabel: "Ora",
          key: "time_window",
          question: "时间范围",
          options: [],
          requestedAt: 2,
        },
      ],
    )).toBe([
      "已补充：",
      "- 目标环境: staging",
      "- 时间范围: 最近 30 天",
    ].join("\n"));
  });

  it("keeps single clarification answer as the pending user message", () => {
    expect(buildClarificationSubmissionPrompt({ intent_guard: "我们是收单机构。" })).toBe("我们是收单机构。");
  });

  it("uses the selected turn latestSnapshot for clarification resumes when no live snapshot is active", () => {
    const latestSnapshot = {
      runId: "run-clarify",
      sessionId: "session-empty",
      status: "interrupted",
      pendingClarifications: [{
        id: "clarification:intent_guard",
        key: "intent_guard",
        question: "请补充角色",
        nodeId: "root",
        nodeLabel: "Ora",
        options: [],
        requestedAt: 1,
      }],
      input: { prompt: "test" },
      updatedAt: 2,
    } as unknown as OraStateSnapshot;

    const state = stateWithSession({
      selectedTurnRunId: "run-clarify",
      activeSessionDetail: {
        session: sessionSummary("session-empty"),
        turns: [],
        transcript: [],
        latestSnapshot,
      },
    });

    expect(getSelectedInteractiveSnapshot(state)?.runId).toBe("run-clarify");
  });

  it("includes attached local files in run context", () => {
    expect(buildDesktopRunContext([], [
      {
        path: "/tmp/notes.md",
        name: "notes.md",
        mimeType: "text/markdown",
        sizeBytes: 128,
        content: "# Notes",
        truncated: true,
      },
    ])).toEqual({
      source: "desktop-workbench",
      attachedLocalFiles: [
        {
          path: "/tmp/notes.md",
          name: "notes.md",
          mimeType: "text/markdown",
          sizeBytes: 128,
          content: "# Notes",
          truncated: true,
        },
      ],
    });
  });

  function sessionSummary(sessionId: string, overrides: Partial<OraSessionSummary> = {}): OraSessionSummary {
    return {
      sessionId,
      title: "New Chat",
      turnCount: 0,
      createdAt: 1_714_000_000_000,
      updatedAt: 1_714_000_000_000,
      ...overrides,
    };
  }

  function stateWithSession(overrides: Partial<WorkbenchState> = {}, session: Partial<OraSessionSummary> = {}): WorkbenchState {
    const baseSession = sessionSummary("session-empty", session);
    return {
      ...initialWorkbenchState,
      selectedSessionId: baseSession.sessionId,
      sessions: [baseSession],
      ...overrides,
    };
  }

  it("allows cleanup for a truly empty session", () => {
    const state = stateWithSession();

    expect(isDisposableEmptySession(state, "session-empty")).toBe(true);
  });

  it("preserves sessions that already have turns", () => {
    const state = stateWithSession({}, { turnCount: 1 });

    expect(isDisposableEmptySession(state, "session-empty")).toBe(false);
  });

  it("preserves a running session even when active detail still looks empty", () => {
    const staleEmptyDetail = {
      session: sessionSummary("session-empty"),
      turns: [],
      transcript: [],
    };
    const state = stateWithSession({
      activeSessionDetail: staleEmptyDetail,
      sessions: [sessionSummary("session-empty", {
        latestRunId: "run-empty",
        status: "running",
      })],
    });

    expect(isDisposableEmptySession(state, "session-empty")).toBe(false);
  });

  it("preserves a selected non-terminal active snapshot even before session detail catches up", () => {
    const state = stateWithSession({
      runLifecycle: {
        stage: "streaming",
        runId: "run-empty",
        sessionId: "session-empty",
        prompt: "Run this",
        createdAt: 1_714_000_000_001,
        snapshot: {
          runId: "run-empty",
          sessionId: "session-empty",
          status: "running",
          input: { prompt: "Run this" },
          updatedAt: 1_714_000_000_002,
        } as OraStateSnapshot,
      },
    });

    expect(isDisposableEmptySession(state, "session-empty")).toBe(false);
  });

  it("preserves empty sessions with local draft state", () => {
    const state = stateWithSession({
      sessionPromptTexts: { "session-empty": "draft prompt" },
    });

    expect(isDisposableEmptySession(state, "session-empty")).toBe(false);
  });

  it("preserves empty sessions with attachments, selected skills, pending runs, or runtime status", () => {
    expect(isDisposableEmptySession(stateWithSession({
      sessionProjectFileAttachments: {
        "session-empty": [{ projectId: "project-1", path: "README.md", name: "README.md", mimeType: "text/markdown", sizeBytes: 42 }],
      },
    }), "session-empty")).toBe(false);

    expect(isDisposableEmptySession(stateWithSession({
      sessionLocalFileAttachments: {
        "session-empty": [{ path: "/tmp/note.txt", name: "note.txt", mimeType: "text/plain", sizeBytes: 12 }],
      },
    }), "session-empty")).toBe(false);

    expect(isDisposableEmptySession(stateWithSession({
      sessionSkillIds: { "session-empty": ["skill-1"] },
    }), "session-empty")).toBe(false);

    expect(isDisposableEmptySession(stateWithSession({
      runLifecycle: {
        stage: "pending",
        sessionId: "session-empty",
        prompt: "Run this",
        createdAt: 1_714_000_000_001,
      },
    }), "session-empty")).toBe(false);

    expect(isDisposableEmptySession(stateWithSession({}, { status: "running" }), "session-empty")).toBe(false);
  });
});
