import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { SkillFileStore } from "../src/skills.js";
import { RuntimeSkillRegistry } from "../src/harness/capability-registries.js";

function freshDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ora-skill-telemetry-"));
}

function skillContent(name: string, description = "Test skill."): string {
  return [
    "---",
    `name: ${name}`,
    `description: ${description}`,
    "---",
    "",
    `# ${name}`,
    "",
    "Test content.",
    "",
  ].join("\n");
}

function createStore(dir: string): SkillFileStore {
  return new SkillFileStore({
    privateRootDir: path.join(dir, "private"),
    publicRootDir: path.join(dir, "public"),
    bundledPublicRootDir: path.join(dir, "bundled"),
    bundledSkills: [],
  });
}

describe("skill telemetry", () => {
  let dir: string;
  let store: SkillFileStore;

  beforeEach(() => {
    dir = freshDir();
    store = createStore(dir);
  });

  it("state.json without new fields loads without error (backward compat)", () => {
    const stateDir = path.join(dir, "private", "..");
    fs.mkdirSync(stateDir, { recursive: true });
    // Write a minimal old-format state.json
    const statePath = path.join(stateDir, "state.json");
    fs.writeFileSync(statePath, JSON.stringify({
      "test-skill": { enabled: true, createdAt: 1000 },
    }));

    const skills = store.list();
    // Should not throw, even though state.json lacks provenance/lifecycle/telemetry
    expect(skills).toEqual([]);
  });

  it("recordTelemetry increments in memory without I/O", () => {
    const registry = new RuntimeSkillRegistry(store);
    store.create({
      name: "my-skill",
      description: "Test",
      content: skillContent("my-skill"),
      enabled: true,
    });

    registry.recordTelemetry("my-skill", "use");
    registry.recordTelemetry("my-skill", "use");
    registry.recordTelemetry("my-skill", "view");

    // Telemetry is buffered — no state.json change yet
    const statePath = path.join(dir, "private", "..", "state.json");
    const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
    expect(state["my-skill"]!.useCount).toBeUndefined();
    expect(state["my-skill"]!.viewCount).toBeUndefined();
  });

  it("flushTelemetry writes batch to state.json", () => {
    const registry = new RuntimeSkillRegistry(store);
    store.create({
      name: "my-skill",
      description: "Test",
      content: skillContent("my-skill"),
      enabled: true,
    });

    registry.recordTelemetry("my-skill", "use");
    registry.recordTelemetry("my-skill", "view");
    registry.recordTelemetry("my-skill", "patch");
    registry.flushTelemetry();

    const statePath = path.join(dir, "private", "..", "state.json");
    const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
    expect(state["my-skill"]!.useCount).toBe(1);
    expect(state["my-skill"]!.viewCount).toBe(1);
    expect(state["my-skill"]!.patchCount).toBe(1);
    expect(typeof state["my-skill"]!.lastUsedAt).toBe("number");
  });

  it("lifecycle transitions are valid (active→stale→archived)", () => {
    store.create({
      name: "my-skill",
      description: "Test",
      content: skillContent("my-skill"),
      enabled: true,
    });

    store.transitionLifecycle("my-skill", "stale");
    const skill1 = store.get({ name: "my-skill" });
    expect(skill1.lifecycle).toBe("stale");

    store.transitionLifecycle("my-skill", "archived");
    const skill2 = store.get({ name: "my-skill" });
    expect(skill2.lifecycle).toBe("archived");
  });

  it("reverse lifecycle transition throws", () => {
    store.create({
      name: "my-skill",
      description: "Test",
      content: skillContent("my-skill"),
      enabled: true,
    });

    store.transitionLifecycle("my-skill", "archived");
    expect(() => store.transitionLifecycle("my-skill", "active")).toThrow(/Invalid lifecycle transition/);
  });
});
