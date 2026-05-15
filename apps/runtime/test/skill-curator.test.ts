import { describe, expect, it } from "vitest";
import { SkillCurator, DEFAULT_CURATOR_CONFIG } from "../src/skill-curator.js";
import type { SkillDescriptor } from "@cemeworm/shared";

function makeSkill(overrides: Partial<SkillDescriptor> & { name: string }): SkillDescriptor {
  return {
    id: overrides.name,
    description: "Test",
    enabled: true,
    editable: true,
    allowedPatterns: [],
    tags: [],
    category: "private",
    provenance: "background_auto",
    lifecycle: "active",
    ...overrides,
  };
}

describe("SkillCurator", () => {
  const DAY = 24 * 60 * 60 * 1000;
  let appliedTransitions: Array<{ name: string; lifecycle: "active" | "stale" | "archived" }>;

  function createCurator(config?: { staleThresholdMs?: number; archivedThresholdMs?: number; enabled?: boolean }, clock?: () => number) {
    appliedTransitions = [];
    return new SkillCurator({
      config: {
        staleThresholdMs: config?.staleThresholdMs ?? DEFAULT_CURATOR_CONFIG.staleThresholdMs,
        archivedThresholdMs: config?.archivedThresholdMs ?? DEFAULT_CURATOR_CONFIG.archivedThresholdMs,
        enabled: config?.enabled ?? true,
      },
      applyTransition: (name, lifecycle) => { appliedTransitions.push({ name, lifecycle }); },
      clock: clock ?? (() => 100 * DAY),
    });
  }

  it("transitions active → stale when lastUsedAt exceeds threshold", () => {
    const curator = createCurator({ staleThresholdMs: 30 * DAY });
    const skills = [
      makeSkill({ name: "old-skill", lifecycle: "active", telemetry: { useCount: 1, viewCount: 0, patchCount: 0, lastUsedAt: 50 * DAY } }),
    ];
    const transitions = curator.evaluate(skills);
    expect(transitions).toEqual([{ name: "old-skill", from: "active", to: "stale" }]);
  });

  it("transitions stale → archived when lastUsedAt exceeds archived threshold", () => {
    const curator = createCurator({ archivedThresholdMs: 90 * DAY });
    const skills = [
      makeSkill({ name: "stale-skill", lifecycle: "stale", telemetry: { useCount: 1, viewCount: 0, patchCount: 0, lastUsedAt: 5 * DAY } }),
    ];
    const transitions = curator.evaluate(skills);
    expect(transitions).toEqual([{ name: "stale-skill", from: "stale", to: "archived" }]);
  });

  it("does not transition active skills that are still fresh", () => {
    const curator = createCurator({ staleThresholdMs: 30 * DAY });
    const skills = [
      makeSkill({ name: "fresh-skill", lifecycle: "active", telemetry: { useCount: 1, viewCount: 0, patchCount: 0, lastUsedAt: 95 * DAY } }),
    ];
    const transitions = curator.evaluate(skills);
    expect(transitions).toEqual([]);
  });

  it("ignores foreground skills", () => {
    const curator = createCurator({ staleThresholdMs: 30 * DAY });
    const skills = [
      makeSkill({ name: "fg-skill", provenance: "foreground", lifecycle: "active", telemetry: { useCount: 0, viewCount: 0, patchCount: 0, lastUsedAt: 0 } }),
    ];
    const transitions = curator.evaluate(skills);
    expect(transitions).toEqual([]);
  });

  it("skips already archived skills", () => {
    const curator = createCurator({ staleThresholdMs: 30 * DAY });
    const skills = [
      makeSkill({ name: "archived-skill", lifecycle: "archived", telemetry: { useCount: 0, viewCount: 0, patchCount: 0, lastUsedAt: 0 } }),
    ];
    const transitions = curator.evaluate(skills);
    expect(transitions).toEqual([]);
  });

  it("does nothing when disabled", () => {
    const curator = createCurator({ enabled: false });
    const skills = [
      makeSkill({ name: "old-skill", lifecycle: "active", telemetry: { useCount: 1, viewCount: 0, patchCount: 0, lastUsedAt: 0 } }),
    ];
    const transitions = curator.evaluate(skills);
    expect(transitions).toEqual([]);
  });

  it("applyTransitions calls applyTransition for each transition", () => {
    const curator = createCurator();
    curator.applyTransitions([
      { name: "a", from: "active", to: "stale" },
      { name: "b", from: "stale", to: "archived" },
    ]);
    expect(appliedTransitions).toEqual([
      { name: "a", lifecycle: "stale" },
      { name: "b", lifecycle: "archived" },
    ]);
  });
});
