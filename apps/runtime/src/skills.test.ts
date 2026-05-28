import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { SkillFileStore } from "./skills.js";

function tempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ora-skills-"));
}

describe("SkillFileStore governance metadata", () => {
  it("persists and rehydrates governance metadata for created background_auto skills", () => {
    const root = tempRoot();
    const store = new SkillFileStore({
      privateRootDir: path.join(root, "private"),
      publicRootDir: path.join(root, "public"),
      bundledPublicRootDir: path.join(root, "bundled"),
      clock: () => 1_234,
      bundledSkills: [],
    });

    store.create({
      name: "auto-skill",
      description: "auto learned skill",
      provenance: "background_auto",
      autoCreateTrigger: "run-123",
    });

    const detail = store.get({ name: "auto-skill" });
    expect(detail.provenance).toBe("background_auto");
    expect(detail.governance?.origin).toBe("background_auto");
    expect(detail.governance?.lastAction).toBe("create");
    expect(detail.governance?.history?.[0]?.note).toBe("run-123");
  });

  it("records lifecycle transitions in governance history", () => {
    const root = tempRoot();
    const store = new SkillFileStore({
      privateRootDir: path.join(root, "private"),
      publicRootDir: path.join(root, "public"),
      bundledPublicRootDir: path.join(root, "bundled"),
      clock: () => 2_000,
      bundledSkills: [],
    });

    store.create({
      name: "governed-skill",
      description: "governed",
      provenance: "background_auto",
    });
    store.transitionLifecycle("governed-skill", "stale", "auto review");

    const detail = store.get({ name: "governed-skill" });
    expect(detail.lifecycle).toBe("stale");
    expect(detail.governance?.lastAction).toBe("lifecycle_stale");
    expect(detail.governance?.history?.some((entry) => entry.note === "auto review")).toBe(true);
  });

  it("persists supporting files for background_auto skills", () => {
    const root = tempRoot();
    const store = new SkillFileStore({
      privateRootDir: path.join(root, "private"),
      publicRootDir: path.join(root, "public"),
      bundledPublicRootDir: path.join(root, "bundled"),
      clock: () => 3_000,
      bundledSkills: [],
    });

    store.create({
      name: "file-backed-skill",
      description: "file backed",
      provenance: "background_auto",
      content: [
        "---",
        "name: file-backed-skill",
        "description: file backed",
        "---",
        "",
        "Body",
      ].join("\n"),
      files: [{ path: "scripts/run.sh", content: "echo ok\n", executable: true }],
    });

    const detail = store.get({ name: "file-backed-skill" });
    expect(detail.files?.map((file) => file.path)).toContain("scripts/run.sh");

    const file = store.getFile({ skillName: "file-backed-skill", path: "scripts/run.sh" });
    expect(file.content).toBe("echo ok\n");
    expect(file.executable).toBe(true);
  });
});
