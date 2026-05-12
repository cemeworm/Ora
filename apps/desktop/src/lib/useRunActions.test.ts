import { describe, expect, it } from "vitest";
import { initialWorkbenchState, type WorkbenchState } from "./state";
import {
  acceptedPlanImplementationSubmission,
  buildClarificationSubmissionPrompt,
  buildDesktopRunContext,
  isDisposableEmptySession,
  shouldEnableClarificationPreflight,
  shouldEnableProgressNarration,
  stableViewModelCacheKey,
  toolIdsForRun,
} from "./useRunActions";
import type { OraSessionSummary } from "./runtimeClient";

describe("desktop run actions", () => {
  it("keeps cosmetic progress narration off for chat and plan runs", () => {
    expect(shouldEnableProgressNarration("implement")).toBe(true);
    expect(shouldEnableProgressNarration("chat")).toBe(false);
    expect(shouldEnableProgressNarration("plan")).toBe(false);
  });

  it("keeps clarification preflight off by default for all task intents", () => {
    expect(shouldEnableClarificationPreflight("implement")).toBe(false);
    expect(shouldEnableClarificationPreflight("plan")).toBe(false);
    expect(shouldEnableClarificationPreflight("chat")).toBe(false);
  });

  it("submits accepted plan decisions as implementation runs", () => {
    expect(acceptedPlanImplementationSubmission()).toEqual({
      prompt: "请按照上述计划开始执行",
      taskIntent: "implement",
    });
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
