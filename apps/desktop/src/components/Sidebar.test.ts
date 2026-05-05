import { describe, expect, it } from "vitest";
import { statusFromSession } from "./Sidebar";
import { checkOraReleaseUpdate, isReleaseNewer } from "../lib/releaseUpdate";

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
