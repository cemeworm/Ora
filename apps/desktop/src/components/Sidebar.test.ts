import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  SessionStatusBadge,
  sidebarStatusForSession,
  statusFromSession,
} from "./Sidebar";
import { translateCopy } from "../lib/i18n";
import { checkOraReleaseUpdate, isReleaseNewer } from "../lib/releaseUpdate";
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
});

describe("sidebar release update check", () => {
  it("detects a newer patch release", () => {
    expect(isReleaseNewer("0.1.1", "0.1.0")).toBe(true);
  });

  it("accepts a leading v in GitHub release tags", () => {
    expect(isReleaseNewer("v0.1.1", "0.1.0")).toBe(true);
  });

  it("does not show equal releases as updates", () => {
    expect(isReleaseNewer("v0.1.0", "0.1.0")).toBe(false);
  });

  it("returns no update for malformed release data", async () => {
    const fetchRelease = async () => ({
      ok: true,
      json: async () => ({ tag_name: "", html_url: "" }),
    });

    await expect(checkOraReleaseUpdate(fetchRelease, "0.1.0")).resolves.toMatchObject({
      available: false,
    });
  });

  it("returns update metadata for a newer GitHub release", async () => {
    const fetchRelease = async () => ({
      ok: true,
      json: async () => ({
        tag_name: "v0.1.1",
        html_url: "https://github.com/cemeworm/Ora/releases/tag/v0.1.1",
      }),
    });

    await expect(checkOraReleaseUpdate(fetchRelease, "0.1.0")).resolves.toMatchObject({
      available: true,
      latestVersion: "v0.1.1",
      releaseUrl: "https://github.com/cemeworm/Ora/releases/tag/v0.1.1",
    });
  });
});

describe("sidebar archive copy", () => {
  it("localizes archive confirmation copy", () => {
    expect(translateCopy("zh", "Archive this chat?")).toBe("归档这个对话？");
    expect(translateCopy("zh", "Archive")).toBe("归档");
    expect(translateCopy("zh", "Archive current channel session")).toBe(
      "归档 当前渠道会话",
    );
  });
});
