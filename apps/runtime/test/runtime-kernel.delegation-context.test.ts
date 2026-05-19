import { describe, expect, it } from "vitest";
import { buildDelegationGuidance } from "../src/harness/runtime-kernel.js";

describe("runtime kernel delegation guidance", () => {
  it("returns allow guidance when the user explicitly permits sub-agent help", () => {
    expect(buildDelegationGuidance({
      requestedByUser: true,
      preference: "allow",
      reason: "The user said sub-agent help is allowed.",
      source: "classifier",
    })).toContain("You may use agent.spawn if delegation would materially improve the outcome.");
  });

  it("returns stronger prefer guidance when the user explicitly requests coordination", () => {
    const guidance = buildDelegationGuidance({
      requestedByUser: true,
      preference: "prefer",
      reason: "The user asked for coordinated team work.",
      source: "classifier",
    });

    expect(guidance).toContain("Even in single-agent mode, treat this as explicit permission to delegate.");
    expect(guidance).toContain("prefer using agent.spawn instead of doing everything locally.");
  });

  it("returns no guidance for none intents or absent intents", () => {
    expect(buildDelegationGuidance({
      requestedByUser: true,
      preference: "none",
      reason: "The user explicitly asked not to delegate.",
      source: "classifier",
    })).toBeUndefined();
    expect(buildDelegationGuidance(undefined)).toBeUndefined();
  });
});
