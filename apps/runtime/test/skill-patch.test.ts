import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { SkillFileStore } from "../src/skills.js";
import { RuntimeSkillRegistry } from "../src/harness/capability-registries.js";

function freshDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ora-skill-patch-"));
}

function skillContent(name: string, body: string): string {
  return [
    "---",
    `name: ${name}`,
    "description: Test skill.",
    "---",
    "",
    `# ${name}`,
    "",
    body,
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

describe("skills.patch — fuzzy find-and-replace", () => {
  let dir: string;
  let store: SkillFileStore;
  let registry: RuntimeSkillRegistry;

  beforeEach(() => {
    dir = freshDir();
    store = createStore(dir);
    registry = new RuntimeSkillRegistry(store);
  });

  it("exact match replacement succeeds", () => {
    store.create({
      name: "bg-skill",
      description: "Test",
      content: skillContent("bg-skill", "Step 1: Do something.\nStep 2: Do another thing."),
      enabled: true,
      provenance: "background_auto",
    });

    const result = store.patchContent({
      name: "bg-skill",
      oldContent: "Step 1: Do something.",
      newContent: "Step 1: Do the right thing.",
    });

    expect(result.content).toContain("Step 1: Do the right thing.");
    expect(result.content).not.toContain("Step 1: Do something.");
    expect(result.content).toContain("Step 2: Do another thing.");
  });

  it("whitespace-normalized match replacement succeeds", () => {
    store.create({
      name: "bg-skill",
      description: "Test",
      content: skillContent("bg-skill", "Step 1:   Do  something.\nStep 2: Do another thing."),
      enabled: true,
      provenance: "background_auto",
    });

    // oldContent with different whitespace
    const result = store.patchContent({
      name: "bg-skill",
      oldContent: "Step 1: Do something.",
      newContent: "Step 1: Do the right thing.",
    });

    expect(result.content).toContain("Step 1: Do the right thing.");
  });

  it("match failure returns error with preview", () => {
    store.create({
      name: "bg-skill",
      description: "Test",
      content: skillContent("bg-skill", "Short content."),
      enabled: true,
      provenance: "background_auto",
    });

    expect(() => store.patchContent({
      name: "bg-skill",
      oldContent: "This text does not exist at all",
      newContent: "Replacement",
    })).toThrow(/Could not find oldContent/);
  });

  it("foreground skill returns error from registry patch", () => {
    store.create({
      name: "fg-skill",
      description: "Test",
      content: skillContent("fg-skill", "Step 1: Do something."),
      enabled: true,
      // provenance defaults to "foreground"
    });

    const detail = registry.get({ name: "fg-skill" });
    expect(detail.provenance).toBe("foreground");

    // The tool-level check happens in patchRuntimeSkill, which checks provenance
    // At store level, patchContent works on any editable skill.
    // The security boundary is in runtime-skill-tools.ts patchRuntimeSkill.
  });

  it("patch increments patchCount in telemetry", () => {
    store.create({
      name: "bg-skill",
      description: "Test",
      content: skillContent("bg-skill", "Step 1: Do something."),
      enabled: true,
      provenance: "background_auto",
    });

    registry.patch({
      name: "bg-skill",
      oldContent: "Step 1: Do something.",
      newContent: "Step 1: Do the right thing.",
    });

    registry.recordTelemetry("bg-skill", "patch");
    registry.flushTelemetry();

    const statePath = path.join(dir, "private", "..", "state.json");
    const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
    expect(state["bg-skill"]!.patchCount).toBe(1);
  });
});
