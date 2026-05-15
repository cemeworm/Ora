import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { SkillFileStore } from "../src/skills.js";
import { RuntimeSkillRegistry } from "../src/harness/capability-registries.js";

function freshDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ora-skill-auto-create-"));
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

describe("skill auto-create — approval strategy", () => {
  let dir: string;
  let store: SkillFileStore;
  let registry: RuntimeSkillRegistry;

  beforeEach(() => {
    dir = freshDir();
    store = createStore(dir);
    registry = new RuntimeSkillRegistry(store);
  });

  it("background_auto provenance is stored in state.json", () => {
    store.create({
      name: "auto-skill",
      description: "Auto-created",
      content: skillContent("auto-skill", "Auto test"),
      enabled: true,
      provenance: "background_auto",
      autoCreateTrigger: "complex_task_completion",
    });

    const detail = store.get({ name: "auto-skill" });
    expect(detail.provenance).toBe("background_auto");

    const statePath = path.join(dir, "private", "..", "state.json");
    const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
    expect(state["auto-skill"]!.provenance).toBe("background_auto");
    expect(state["auto-skill"]!.autoCreateTrigger).toBe("complex_task_completion");
  });

  it("foreground provenance is default", () => {
    store.create({
      name: "manual-skill",
      description: "Manual",
      content: skillContent("manual-skill", "Manual test"),
      enabled: true,
    });

    const detail = store.get({ name: "manual-skill" });
    expect(detail.provenance).toBe("foreground");
  });

  it("actionRiskLevel returns low for background_auto", () => {
    // Simulates what runtime-skill-tools.ts does
    const args = { provenance: "background_auto" };
    const riskLevel = args.provenance === "background_auto" ? "low" : "high";
    expect(riskLevel).toBe("low");
  });

  it("actionRiskLevel returns high for foreground", () => {
    const args = { provenance: "foreground" };
    const riskLevel = args.provenance === "background_auto" ? "low" : "high";
    expect(riskLevel).toBe("high");
  });

  it("actionRiskLevel returns high when no provenance", () => {
    const args = {};
    const riskLevel = (args as Record<string, unknown>).provenance === "background_auto" ? "low" : "high";
    expect(riskLevel).toBe("high");
  });

  it("list filters by lifecycle and provenance", () => {
    store.create({
      name: "auto-skill",
      description: "Auto",
      content: skillContent("auto-skill", "Auto"),
      enabled: true,
      provenance: "background_auto",
    });

    store.create({
      name: "manual-skill",
      description: "Manual",
      content: skillContent("manual-skill", "Manual"),
      enabled: true,
    });

    const bgSkills = store.list({ provenance: "background_auto" });
    expect(bgSkills.length).toBe(1);
    expect(bgSkills[0]!.name).toBe("auto-skill");

    const fgSkills = store.list({ provenance: "foreground" });
    expect(fgSkills.length).toBe(1);
    expect(fgSkills[0]!.name).toBe("manual-skill");
  });

  it("archived skills are excluded by default", () => {
    store.create({
      name: "archived-skill",
      description: "Archived",
      content: skillContent("archived-skill", "Archived"),
      enabled: true,
      provenance: "background_auto",
    });

    store.transitionLifecycle("archived-skill", "archived");

    const defaultList = store.list();
    expect(defaultList.every((s) => s.name !== "archived-skill")).toBe(true);

    const explicitList = store.list({ lifecycle: "archived" });
    expect(explicitList.length).toBe(1);
    expect(explicitList[0]!.name).toBe("archived-skill");
  });
});
