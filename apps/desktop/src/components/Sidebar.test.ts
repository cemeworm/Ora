import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ProjectArchiveButton,
  SessionStatusBadge,
  sidebarStatusForSession,
  sessionListToggleLabel,
  statusFromSession,
  visibleSidebarSessions,
} from "./Sidebar";
import { translateCopy } from "../lib/i18n";
import { checkOraReleaseUpdate } from "../lib/releaseUpdate";
import type { OraSessionSummary, OraStateSnapshot } from "../lib/runtimeClient";

function sessionSummary(
  overrides: Partial<OraSessionSummary> = {},
): OraSessionSummary {
  return {
    sessionId: "session-1",
    title: "新建对话",
    turnCount: 1,
    createdAt: 1000,
    updatedAt: 2000,
    latestRunId: "run-1",
    status: "running",
    ...overrides,
  } as OraSessionSummary;
}

function activeSnapshot(
  overrides: Partial<OraStateSnapshot> = {},
): OraStateSnapshot {
  return {
    runId: "run-1",
    sessionId: "session-1",
    status: "succeeded",
    updatedAt: 3000,
    ...overrides,
  } as OraStateSnapshot;
}

describe("sidebar session status", () => {
  it("uses durable runtime attention before legacy status fallbacks", () => {
    expect(statusFromSession("succeeded", {
      kind: "needs_plan_decision",
      blocking: true,
      sourceRunId: "run-plan",
      reason: "plan_decision_required",
      planDecisionId: "run-plan:plan-decision",
      pendingActionIds: [],
      pendingToolCallIds: [],
      pendingClarificationIds: [],
    })).toBe("decision_needed");
    expect(statusFromSession("interrupted", {
      kind: "paused",
      blocking: false,
      sourceRunId: "run-paused",
      pendingActionIds: [],
      pendingToolCallIds: [],
      pendingClarificationIds: [],
    })).toBe("paused");
  });

  it("uses summary interaction gate before stale attention and status", () => {
    expect(statusFromSession("failed", {
      kind: "idle",
      blocking: false,
      sourceRunId: "run-plan",
      pendingActionIds: [],
      pendingToolCallIds: [],
      pendingClarificationIds: [],
    }, {
      kind: "plan_decision",
      source: "plan_decisions",
      durable: true,
      staleRisk: false,
      gateIds: ["run-plan:plan-decision"],
      pendingActionIds: [],
      pendingToolCallIds: [],
      pendingClarificationIds: [],
      planDecisionId: "run-plan:plan-decision",
    })).toBe("decision_needed");
  });

  it("uses legacy status only when runtime attention is absent", () => {
    expect(statusFromSession("interrupted")).toBe("paused");
    expect(statusFromSession("running")).toBe("running");
    expect(statusFromSession("succeeded")).toBe("done");
  });

  it("does not render a visible badge for paused sessions", () => {
    expect(renderToStaticMarkup(createElement(SessionStatusBadge, { status: "paused" }))).toBe("");
  });

  it("does not show paused when refreshed attention closes a stale interrupted resume", () => {
    expect(statusFromSession("interrupted", {
      kind: "idle",
      blocking: false,
      sourceRunId: "run-resumed",
      pendingActionIds: [],
      pendingToolCallIds: [],
      pendingClarificationIds: [],
    })).toBe("done");
    expect(statusFromSession("interrupted", {
      kind: "failed",
      blocking: false,
      sourceRunId: "run-resume-failed",
      reason: "resume_incomplete_after_gate_resolution",
      pendingActionIds: [],
      pendingToolCallIds: [],
      pendingClarificationIds: [],
    })).toBe("failed");
  });

  it("uses canonical interaction state for the selected session row", () => {
    expect(
      sidebarStatusForSession(sessionSummary({ status: "running" }), {
        selectedSessionId: "session-1",
        selectedTurnRunId: "run-1",
        activeSessionDetail: undefined,
        runLifecycle: {
          stage: "settled",
          runId: "run-1",
          sessionId: "session-1",
          prompt: "test",
          createdAt: 1,
          snapshot: activeSnapshot({ status: "succeeded" }),
        },
      }),
    ).toBe("done");
  });

  it("keeps selected succeeded plan runs in decision_needed when a plan gate is pending", () => {
    expect(
      sidebarStatusForSession(sessionSummary({ status: "failed" }), {
        selectedSessionId: "session-1",
        selectedTurnRunId: "run-1",
        activeSessionDetail: undefined,
        runLifecycle: {
          stage: "settled",
          runId: "run-1",
          sessionId: "session-1",
          prompt: "test",
          createdAt: 1,
          snapshot: activeSnapshot({
            status: "succeeded",
            planDecisions: [{
              id: "run-1:plan-decision",
              runId: "run-1",
              sessionId: "session-1",
              status: "pending",
              createdAt: 2,
            }],
            attention: {
              kind: "idle",
              blocking: false,
              sourceRunId: "run-1",
              pendingActionIds: [],
              pendingToolCallIds: [],
              pendingClarificationIds: [],
            },
          }),
        },
      }),
    ).toBe("decision_needed");
  });

  it("prefers selected-turn clarification state over stale failed session summary", () => {
    expect(
      sidebarStatusForSession(sessionSummary({ status: "failed" }), {
        selectedSessionId: "session-1",
        selectedTurnRunId: "run-1",
        activeSessionDetail: undefined,
        runLifecycle: {
          stage: "settled",
          runId: "run-1",
          sessionId: "session-1",
          prompt: "test",
          createdAt: 1,
          snapshot: activeSnapshot({
            status: "interrupted",
            pendingClarifications: [{
              id: "clarification:scope",
              key: "scope",
              nodeId: "ora",
              nodeLabel: "Ora",
              question: "Which scope?",
              options: [],
              requestedAt: 2,
            }],
            attention: {
              kind: "needs_clarification",
              blocking: true,
              sourceRunId: "run-1",
              reason: "clarification_required",
              pendingActionIds: [],
              pendingToolCallIds: [],
              pendingClarificationIds: ["clarification:scope"],
            },
          }),
        },
      }),
    ).toBe("clarification_required");
  });

  it("keeps non-selected rows on session summary state", () => {
    expect(
      sidebarStatusForSession(sessionSummary({
        sessionId: "session-2",
        status: "running",
      }), {
        selectedSessionId: "session-1",
        selectedTurnRunId: "run-1",
        activeSessionDetail: undefined,
        runLifecycle: {
          stage: "settled",
          runId: "run-1",
          sessionId: "session-1",
          prompt: "test",
          createdAt: 1,
          snapshot: activeSnapshot({ status: "succeeded" }),
        },
      }),
    ).toBe("running");
  });

  it("pins running and selected project sessions beyond the collapsed visible limit", () => {
    const sessions = [
      { id: "session-1", status: "done" as const },
      { id: "session-2", status: "done" as const },
      { id: "session-3", status: "done" as const },
      { id: "session-4", status: "done" as const },
      { id: "session-running", status: "running" as const },
      { id: "session-selected", status: "done" as const },
      { id: "session-done", status: "done" as const },
    ];

    expect(
      visibleSidebarSessions(sessions, 4, "session-selected").map(
        (session) => session.id,
      ),
    ).toEqual([
      "session-1",
      "session-2",
      "session-3",
      "session-4",
      "session-running",
      "session-selected",
    ]);
  });

  it("localizes collapsed session toggle copy", () => {
    expect(sessionListToggleLabel("zh", false, 8)).toBe("再显示 8 个");
    expect(sessionListToggleLabel("zh", true, 8)).toBe("收起");
    expect(sessionListToggleLabel("en", false, 8)).toBe("Show 8 more");
  });
});

describe("sidebar release update check", () => {
  it("returns no update when updater has no installable release", async () => {
    const fetchRelease = async () => ({
      ok: true,
      json: async () => ({
        tag_name: "v0.1.1",
        html_url: "https://github.com/cemeworm/Ora/releases/tag/v0.1.1",
      }),
    });

    await expect(checkOraReleaseUpdate(async () => null, fetchRelease)).resolves.toMatchObject({
      available: false,
      latestVersion: "v0.1.1",
      releaseUrl: "https://github.com/cemeworm/Ora/releases/tag/v0.1.1",
    });
  });

  it("returns update metadata from the updater when installable", async () => {
    const fetchRelease = async () => ({
      ok: true,
      json: async () => ({
        tag_name: "v9.9.9",
        html_url: "https://github.com/cemeworm/Ora/releases/tag/v9.9.9",
      }),
    });

    await expect(checkOraReleaseUpdate(async () => ({ version: "0.1.1" }), fetchRelease)).resolves.toMatchObject({
      available: true,
      latestVersion: "0.1.1",
      releaseUrl: "https://github.com/cemeworm/Ora/releases/tag/v9.9.9",
    });
  });

  it("still reports an installable update when release-page metadata fetch fails", async () => {
    const fetchRelease = async () => ({
      ok: false,
      json: async () => ({}),
    });

    await expect(checkOraReleaseUpdate(async () => ({ version: "0.1.1" }), fetchRelease)).resolves.toMatchObject({
      available: true,
      latestVersion: "0.1.1",
      error: "GitHub release check failed.",
    });
  });

  it("keeps updater failure from showing a false positive pill", async () => {
    const fetchRelease = async () => ({
      ok: true,
      json: async () => ({
        tag_name: "v0.1.1",
        html_url: "https://github.com/cemeworm/Ora/releases/tag/v0.1.1",
      }),
    });

    await expect(checkOraReleaseUpdate(async () => {
      throw new Error("latest.json not found");
    }, fetchRelease)).resolves.toMatchObject({
      available: false,
      latestVersion: "v0.1.1",
      releaseUrl: "https://github.com/cemeworm/Ora/releases/tag/v0.1.1",
      error: "latest.json not found",
    });
  });
});

describe("sidebar session sorting by lastUserMessageAt", () => {
  it("sorts by lastUserMessageAt descending, falling back to createdAt", () => {
    const sessions: Array<{ sessionId: string; title: string; turnCount: number; createdAt: number; updatedAt: number; lastUserMessageAt?: number }> = [
      { sessionId: "s1", title: "old-chat", turnCount: 0, createdAt: 1000, updatedAt: 2000 },
      { sessionId: "s2", title: "recent-user", turnCount: 1, createdAt: 2000, updatedAt: 3000, lastUserMessageAt: 5000 },
      { sessionId: "s3", title: "mid-user", turnCount: 1, createdAt: 3000, updatedAt: 4000, lastUserMessageAt: 4000 },
      { sessionId: "s4", title: "no-messages", turnCount: 0, createdAt: 1500, updatedAt: 2500 },
    ];

    const sorted = [...sessions].sort(
      (a, b) =>
        (b.lastUserMessageAt ?? b.createdAt) - (a.lastUserMessageAt ?? a.createdAt) ||
        a.sessionId.localeCompare(b.sessionId),
    );

    // s2 (lastUserMessageAt=5000) > s3 (4000) > s4 (createdAt=1500) > s1 (createdAt=1000)
    expect(sorted.map((s) => s.sessionId)).toEqual(["s2", "s3", "s4", "s1"]);
  });

  it("new sessions without user messages sort by createdAt descending", () => {
    const sessions: Array<{ sessionId: string; title: string; turnCount: number; createdAt: number; updatedAt: number; lastUserMessageAt?: number }> = [
      { sessionId: "s1", title: "newer", turnCount: 0, createdAt: 2000, updatedAt: 2000 },
      { sessionId: "s2", title: "older", turnCount: 0, createdAt: 1000, updatedAt: 1000 },
    ];

    const sorted = [...sessions].sort(
      (a, b) =>
        (b.lastUserMessageAt ?? b.createdAt) - (a.lastUserMessageAt ?? a.createdAt) ||
        a.sessionId.localeCompare(b.sessionId),
    );

    expect(sorted.map((s) => s.sessionId)).toEqual(["s1", "s2"]);
  });

  it("newer session without messages ranks above older session with stale messages", () => {
    const sessions: Array<{ sessionId: string; title: string; turnCount: number; createdAt: number; updatedAt: number; lastUserMessageAt?: number }> = [
      { sessionId: "s1", title: "old-with-msg", turnCount: 1, createdAt: 1000, updatedAt: 1000, lastUserMessageAt: 3000 },
      { sessionId: "s2", title: "new-no-msg", turnCount: 0, createdAt: 5000, updatedAt: 5000 },
    ];

    const sorted = [...sessions].sort(
      (a, b) =>
        (b.lastUserMessageAt ?? b.createdAt) - (a.lastUserMessageAt ?? a.createdAt) ||
        a.sessionId.localeCompare(b.sessionId),
    );

    // s2 (createdAt=5000) should be first, s1 (lastUserMessageAt=3000) second
    expect(sorted.map((s) => s.sessionId)).toEqual(["s2", "s1"]);
  });
});

describe("sidebar archive copy", () => {
  it("renders project archive confirmation in the project action slot", () => {
    const html = renderToStaticMarkup(createElement(ProjectArchiveButton, {
      projectLabel: "Alpha",
      language: "en",
      confirmOpen: true,
      onArchiveRequest: () => {},
      onArchiveCancel: () => {},
      onArchiveConfirm: () => {},
    }));

    expect(html).toContain("Archive this project and all its chats?");
    expect(html).toContain("Archive project");
  });

  it("localizes archive confirmation copy", () => {
    expect(translateCopy("zh", "Archive this chat?")).toBe("归档这个对话？");
    expect(translateCopy("zh", "Archive")).toBe("归档");
    expect(translateCopy("zh", "Archive project")).toBe("归档项目");
    expect(translateCopy("zh", "Archive this project and all its chats?")).toBe(
      "归档这个项目及其全部对话？",
    );
    expect(translateCopy("zh", "Archived project.")).toBe("已归档项目。");
    expect(translateCopy("zh", "Archive current channel session")).toBe(
      "归档 当前渠道会话",
    );
  });
});
