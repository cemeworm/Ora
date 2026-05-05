import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const capturedSystems: string[] = [];

vi.mock("../src/providers/index.js", async () => {
  const actual = await vi.importActual<typeof import("../src/providers/index.js")>(
    "../src/providers/index.js"
  );

  return {
    ...actual,
    invokeRunProvider: vi.fn(async (config, request) => {
      capturedSystems.push(request.system ?? "");
      return {
        providerId: config.providerId ?? "mock-provider",
        providerType: "local_smoke",
        modelId: config.modelRef ?? "mock-model",
        text: `reply:${request.prompt ?? ""}`,
        raw: {
          prompt: request.prompt,
          system: request.system,
        },
      };
    }),
  };
});

import { LocalRunStore, createRuntimeMethodHandler } from "../src/index.js";

function freshStoreDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ora-runtime-skills-"));
}

function repoRoot(): string {
  let current = process.cwd();
  while (!fs.existsSync(path.join(current, "pnpm-workspace.yaml"))) {
    const parent = path.dirname(current);
    if (parent === current) {
      return process.cwd();
    }
    current = parent;
  }
  return current;
}

function skillContent(name: string, description = "Runtime test skill."): string {
  return [
    "---",
    `name: ${name}`,
    `description: ${description}`,
    "---",
    "",
    `# ${name}`,
    "",
    "Runtime skill injection marker: prefer exact source-backed answers.",
    "",
  ].join("\n");
}

describe("managed skill runtime behavior", () => {
  beforeEach(() => {
    capturedSystems.length = 0;
  });

  it("loads bundled public skills through the dynamic skill registry", () => {
    const handle = createRuntimeMethodHandler(new LocalRunStore({ dataDir: freshStoreDir() }));
    const listed = handle({
      jsonrpc: "2.0",
      id: 1,
      method: "skills.list",
    }) as { skills: { name: string; category: string; editable: boolean }[] };

    expect(listed.skills.some((skill) =>
      skill.name === "long-task-protocol" &&
      skill.category === "public" &&
      skill.editable === true
    )).toBe(true);
    expect(listed.skills.some((skill) =>
      skill.name === "frontend-design" &&
      skill.category === "public" &&
      skill.editable === true
    )).toBe(true);
    expect(listed.skills.some((skill) =>
      skill.name === "bootstrap" &&
      skill.description.includes("Generate a personalized SOUL.md")
    )).toBe(true);
    expect(listed.skills.some((skill) =>
      skill.name === "agent-creator" &&
      skill.category === "public" &&
      skill.editable === true &&
      skill.description.includes("Create, draft, update, delete, catalog, and configure Ora agents")
    )).toBe(true);
    expect(listed.skills.some((skill) =>
      skill.name === "scheduled-task-manager" &&
      skill.category === "public" &&
      skill.editable === true &&
      skill.description.includes("定时任务")
    )).toBe(true);
  });

  it("reads the bundled scheduled task manager skill rules", () => {
    const handle = createRuntimeMethodHandler(new LocalRunStore({ dataDir: freshStoreDir() }));
    const detail = handle({
      jsonrpc: "2.0",
      id: 1,
      method: "skills.get",
      params: { name: "scheduled-task-manager" },
    }) as { name: string; content: string };

    expect(detail.name).toBe("scheduled-task-manager");
    expect(detail.content).toContain("先用 `automations.previewSchedule`");
    expect(detail.content).toContain("如果调度时间、任务目标或影响范围缺失，先提一个聚焦问题");
    expect(detail.content).toContain("必须附带用户可读的 `approvalRequest`");
  });

  it("documents agent creator skill binding boundaries", () => {
    const handle = createRuntimeMethodHandler(new LocalRunStore({ dataDir: freshStoreDir() }));
    const loaded = handle({
      jsonrpc: "2.0",
      id: 1,
      method: "skills.get",
      params: { name: "agent-creator" },
    }) as { content: string; category: string; editable: boolean };

    expect(loaded).toMatchObject({
      category: "public",
      editable: true,
    });
    expect(loaded.content).toContain("Keep it separate from `skill-creator`");
    expect(loaded.content).toContain("Runtime behavior uses run-config intersection");
    expect(loaded.content).toContain("Do not promise that adding a skillId to an agent alone makes that skill active in every run.");
  });

  it("creates, updates, reloads, toggles, and deletes private skills", () => {
    const dataDir = freshStoreDir();
    const handle = createRuntimeMethodHandler(new LocalRunStore({ dataDir }));

    const created = handle({
      jsonrpc: "2.0",
      id: 1,
      method: "skills.create",
      params: {
        name: "runtime-review",
        description: "Runtime review skill.",
        content: skillContent("runtime-review", "Runtime review skill."),
        files: [
          {
            path: "scripts/review.sh",
            content: "#!/usr/bin/env bash\necho review\n",
            executable: true,
          },
          {
            path: "agents/reviewer.yaml",
            content: "name: reviewer\n",
          },
        ],
      },
    }) as { name: string; category: string; editable: boolean; enabled: boolean };
    expect(created).toMatchObject({
      name: "runtime-review",
      category: "private",
      editable: true,
      enabled: true,
    });
    expect(fs.existsSync(path.join(dataDir, "skills", "private", "runtime-review", "SKILL.md"))).toBe(true);
    expect(fs.existsSync(path.join(dataDir, "skills", "private", "runtime-review", "scripts", "review.sh"))).toBe(true);
    expect(fs.statSync(path.join(dataDir, "skills", "private", "runtime-review", "scripts", "review.sh")).mode & 0o111).not.toBe(0);

    const updated = handle({
      jsonrpc: "2.0",
      id: 2,
      method: "skills.update",
      params: {
        name: "runtime-review",
        content: skillContent("runtime-review", "Updated runtime review skill."),
      },
    }) as { description: string };
    expect(updated.description).toBe("Updated runtime review skill.");
    expect(fs.existsSync(path.join(dataDir, "skills", "private", "runtime-review", "scripts", "review.sh"))).toBe(true);

    const renamed = handle({
      jsonrpc: "2.0",
      id: 7,
      method: "skills.update",
      params: {
        name: "runtime-review",
        nextName: "runtime-review-renamed",
        content: skillContent("runtime-review-renamed", "Renamed runtime review skill."),
      },
    }) as { name: string; description: string };
    expect(renamed).toMatchObject({
      name: "runtime-review-renamed",
      description: "Renamed runtime review skill.",
    });
    expect(fs.existsSync(path.join(dataDir, "skills", "private", "runtime-review", "SKILL.md"))).toBe(false);
    expect(fs.existsSync(path.join(dataDir, "skills", "private", "runtime-review-renamed", "SKILL.md"))).toBe(true);
    expect(fs.existsSync(path.join(dataDir, "skills", "private", "runtime-review-renamed", "scripts", "review.sh"))).toBe(true);

    const reloaded = createRuntimeMethodHandler(new LocalRunStore({ dataDir }));
    const loaded = reloaded({
      jsonrpc: "2.0",
      id: 3,
      method: "skills.get",
      params: { name: "runtime-review-renamed" },
    }) as { description: string; enabled: boolean; files: { path: string; kind: string; executable: boolean }[] };
    expect(loaded.description).toBe("Renamed runtime review skill.");
    expect(loaded.files).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "scripts/review.sh", kind: "script", executable: true }),
      expect.objectContaining({ path: "agents/reviewer.yaml", kind: "agent" }),
    ]));

    const disabled = reloaded({
      jsonrpc: "2.0",
      id: 4,
      method: "skills.setEnabled",
      params: { name: "runtime-review-renamed", enabled: false },
    }) as { enabled: boolean };
    expect(disabled.enabled).toBe(false);

    expect(reloaded({
      jsonrpc: "2.0",
      id: 5,
      method: "skills.delete",
      params: { name: "runtime-review-renamed" },
    })).toEqual({ deleted: true, name: "runtime-review-renamed" });
    expect((reloaded({
      jsonrpc: "2.0",
      id: 6,
      method: "skills.checkName",
      params: { name: "runtime-review" },
    }) as { available: boolean }).available).toBe(true);
    expect((reloaded({
      jsonrpc: "2.0",
      id: 8,
      method: "skills.checkName",
      params: { name: "runtime-review-renamed" },
    }) as { available: boolean }).available).toBe(true);
  });

  it("replaces private supporting files only when update payload supplies files", () => {
    const dataDir = freshStoreDir();
    const handle = createRuntimeMethodHandler(new LocalRunStore({ dataDir }));
    handle({
      jsonrpc: "2.0",
      id: 1,
      method: "skills.create",
      params: {
        name: "package-review",
        description: "Package review skill.",
        content: skillContent("package-review", "Package review skill."),
        files: [{ path: "scripts/old.sh", content: "echo old\n" }],
      },
    });

    const updated = handle({
      jsonrpc: "2.0",
      id: 2,
      method: "skills.update",
      params: {
        name: "package-review",
        content: skillContent("package-review", "Package review skill updated."),
        files: [{ path: "scripts/new.sh", content: "echo new\n" }],
      },
    }) as { files: { path: string }[] };

    expect(updated.files.map((file) => file.path)).toEqual(["scripts/new.sh"]);
    expect(fs.existsSync(path.join(dataDir, "skills", "private", "package-review", "scripts", "old.sh"))).toBe(false);
    expect(fs.existsSync(path.join(dataDir, "skills", "private", "package-review", "scripts", "new.sh"))).toBe(true);
  });

  it("rejects supporting file paths outside the skill package", () => {
    const handle = createRuntimeMethodHandler(new LocalRunStore({ dataDir: freshStoreDir() }));

    expect(() => handle({
      jsonrpc: "2.0",
      id: 1,
      method: "skills.create",
      params: {
        name: "unsafe-package",
        description: "Unsafe package skill.",
        content: skillContent("unsafe-package", "Unsafe package skill."),
        files: [{ path: "../outside.sh", content: "echo no\n" }],
      },
    })).toThrow("visible relative path");
  });

  it("reads, writes, and deletes private supporting files through single-file APIs", () => {
    const dataDir = freshStoreDir();
    const handle = createRuntimeMethodHandler(new LocalRunStore({ dataDir }));
    handle({
      jsonrpc: "2.0",
      id: 1,
      method: "skills.create",
      params: {
        name: "file-editor",
        description: "File editor skill.",
        content: skillContent("file-editor", "File editor skill."),
      },
    });

    const withFile = handle({
      jsonrpc: "2.0",
      id: 2,
      method: "skills.file.upsert",
      params: {
        skillName: "file-editor",
        path: "templates/result.md",
        content: "hello package file\n",
      },
    }) as { files: { path: string; kind: string }[] };
    expect(withFile.files).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "templates/result.md", kind: "template" }),
    ]));

    const loaded = handle({
      jsonrpc: "2.0",
      id: 3,
      method: "skills.file.get",
      params: { skillName: "file-editor", path: "templates/result.md" },
    }) as { content: string; path: string; kind: string };
    expect(loaded).toMatchObject({
      path: "templates/result.md",
      kind: "template",
      content: "hello package file\n",
    });

    const deleted = handle({
      jsonrpc: "2.0",
      id: 4,
      method: "skills.file.delete",
      params: { skillName: "file-editor", path: "templates/result.md" },
    }) as { files: { path: string }[] };
    expect(deleted.files.some((file) => file.path === "templates/result.md")).toBe(false);
    expect(fs.existsSync(path.join(dataDir, "skills", "private", "file-editor", "templates", "result.md"))).toBe(false);
  });

  it("edits packaged public supporting files by creating a writable public copy", () => {
    const dataDir = freshStoreDir();
    const handle = createRuntimeMethodHandler(new LocalRunStore({ dataDir }));
    const seedPath = path.join(repoRoot(), "skills", "skill-creator", "scripts", "init_skill.py");
    const seedBefore = fs.readFileSync(seedPath, "utf8");

    const loaded = handle({
      jsonrpc: "2.0",
      id: 1,
      method: "skills.file.get",
      params: { skillName: "skill-creator", path: "scripts/init_skill.py" },
    }) as { content: string; kind: string };
    expect(loaded.kind).toBe("script");
    expect(loaded.content).toBe(seedBefore);

    const updated = handle({
      jsonrpc: "2.0",
      id: 2,
      method: "skills.file.upsert",
      params: {
        skillName: "skill-creator",
        path: "scripts/init_skill.py",
        content: "# edited public copy\n",
      },
    }) as { files: { path: string }[] };
    expect(updated.files.map((file) => file.path)).toContain("scripts/init_skill.py");
    expect(fs.readFileSync(seedPath, "utf8")).toBe(seedBefore);
    expect(fs.readFileSync(path.join(dataDir, "skills", "public", "skill-creator", "scripts", "init_skill.py"), "utf8")).toBe("# edited public copy\n");

    const reloaded = handle({
      jsonrpc: "2.0",
      id: 3,
      method: "skills.file.get",
      params: { skillName: "skill-creator", path: "scripts/init_skill.py" },
    }) as { content: string };
    expect(reloaded.content).toBe("# edited public copy\n");
  });

  it("rejects entrypoint and hidden supporting file paths through single-file APIs", () => {
    const handle = createRuntimeMethodHandler(new LocalRunStore({ dataDir: freshStoreDir() }));
    for (const filePath of ["SKILL.md", ".secret", "scripts/.secret", "../outside.sh"]) {
      expect(() => handle({
        jsonrpc: "2.0",
        id: 1,
        method: "skills.file.upsert",
        params: {
          skillName: "skill-creator",
          path: filePath,
          content: "no\n",
        },
      })).toThrow();
    }
  });

  it("updates, disables, and deletes initialized public skills without resurrecting package defaults", () => {
    const dataDir = freshStoreDir();
    const handle = createRuntimeMethodHandler(new LocalRunStore({ dataDir }));
    const updated = handle({
      jsonrpc: "2.0",
      id: 1,
      method: "skills.update",
      params: {
        name: "long-task-protocol",
        content: skillContent("long-task-protocol", "Edited public skill."),
      },
    }) as { category: string; description: string; editable: boolean };
    expect(updated).toMatchObject({
      category: "public",
      description: "Edited public skill.",
      editable: true,
    });
    expect(fs.existsSync(path.join(dataDir, "skills", "public", "long-task-protocol", "SKILL.md"))).toBe(true);

    const renamed = handle({
      jsonrpc: "2.0",
      id: 5,
      method: "skills.update",
      params: {
        name: "long-task-protocol",
        nextName: "long-task-protocol-custom",
        content: skillContent("long-task-protocol-custom", "Renamed public skill."),
      },
    }) as { name: string; category: string; description: string };
    expect(renamed).toMatchObject({
      name: "long-task-protocol-custom",
      category: "public",
      description: "Renamed public skill.",
    });
    expect(fs.existsSync(path.join(dataDir, "skills", "public", "long-task-protocol", "SKILL.md"))).toBe(false);
    expect(fs.existsSync(path.join(dataDir, "skills", "public", "long-task-protocol-custom", "SKILL.md"))).toBe(true);

    const disabled = handle({
      jsonrpc: "2.0",
      id: 2,
      method: "skills.setEnabled",
      params: { name: "long-task-protocol-custom", enabled: false },
    }) as { enabled: boolean };
    expect(disabled.enabled).toBe(false);

    expect(handle({
      jsonrpc: "2.0",
      id: 3,
      method: "skills.delete",
      params: { name: "long-task-protocol-custom" },
    })).toEqual({ deleted: true, name: "long-task-protocol-custom" });

    const reloaded = createRuntimeMethodHandler(new LocalRunStore({ dataDir }));
    expect((reloaded({
      jsonrpc: "2.0",
      id: 4,
      method: "skills.checkName",
      params: { name: "long-task-protocol" },
    }) as { available: boolean }).available).toBe(true);
    expect((reloaded({
      jsonrpc: "2.0",
      id: 6,
      method: "skills.checkName",
      params: { name: "long-task-protocol-custom" },
    }) as { available: boolean }).available).toBe(true);
  });

  it("copies packaged public supporting files into the editable public copy", () => {
    const dataDir = freshStoreDir();
    const handle = createRuntimeMethodHandler(new LocalRunStore({ dataDir }));

    const packaged = handle({
      jsonrpc: "2.0",
      id: 1,
      method: "skills.get",
      params: { name: "skill-creator" },
    }) as { files: { path: string; kind: string }[] };
    expect(packaged.files).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "scripts/init_skill.py", kind: "script" }),
      expect.objectContaining({ path: "agents/analyzer.md", kind: "agent" }),
    ]));

    const updated = handle({
      jsonrpc: "2.0",
      id: 2,
      method: "skills.update",
      params: {
        name: "skill-creator",
        content: skillContent("skill-creator", "Edited skill creator."),
      },
    }) as { files: { path: string }[] };

    expect(updated.files.map((file) => file.path)).toEqual(expect.arrayContaining([
      "scripts/init_skill.py",
      "agents/analyzer.md",
    ]));
    expect(fs.existsSync(path.join(dataDir, "skills", "public", "skill-creator", "scripts", "init_skill.py"))).toBe(true);
    expect(fs.existsSync(path.join(dataDir, "skills", "public", "skill-creator", "agents", "analyzer.md"))).toBe(true);
  });

  it("loads legacy custom skills as private skills", () => {
    const dataDir = freshStoreDir();
    const legacyDir = path.join(dataDir, "skills", "custom", "legacy-review");
    fs.mkdirSync(legacyDir, { recursive: true });
    fs.writeFileSync(path.join(legacyDir, "SKILL.md"), skillContent("legacy-review", "Legacy review skill."), "utf8");

    const handle = createRuntimeMethodHandler(new LocalRunStore({ dataDir }));
    const loaded = handle({
      jsonrpc: "2.0",
      id: 1,
      method: "skills.get",
      params: { name: "legacy-review" },
    }) as { category: string; editable: boolean };

    expect(loaded).toMatchObject({ category: "private", editable: true });
    expect(handle({
      jsonrpc: "2.0",
      id: 2,
      method: "skills.delete",
      params: { name: "legacy-review" },
    })).toEqual({ deleted: true, name: "legacy-review" });
    expect(fs.existsSync(legacyDir)).toBe(false);
  });

  it("exposes enabled skills in zero-config provider system prompts", async () => {
    const handle = createRuntimeMethodHandler(new LocalRunStore({ dataDir: freshStoreDir() }));
    await handle({
      jsonrpc: "2.0",
      id: 1,
      method: "skills.create",
      params: {
        name: "runtime-review",
        description: "Runtime review skill.",
        content: skillContent("runtime-review", "Runtime review skill."),
      },
    });
    await handle({
      jsonrpc: "2.0",
      id: 2,
      method: "skills.create",
      params: {
        name: "runtime-disabled-review",
        description: "Disabled runtime review skill.",
        content: skillContent("runtime-disabled-review", "Disabled runtime review skill."),
      },
    });
    await handle({
      jsonrpc: "2.0",
      id: 3,
      method: "skills.setEnabled",
      params: { name: "runtime-disabled-review", enabled: false },
    });

    await handle({
      jsonrpc: "2.0",
      id: 4,
      method: "runs.start",
      params: {
        input: { prompt: "Use whichever workflow fits." },
        config: { pattern: "generator_verifier" },
      },
    });

    expect(capturedSystems.some((system) => system.includes("<available_skills>"))).toBe(true);
    expect(capturedSystems.some((system) => system.includes("<name>runtime-review</name>"))).toBe(true);
    expect(capturedSystems.some((system) => system.includes("<description>Runtime review skill.</description>"))).toBe(true);
    expect(capturedSystems.some((system) => system.includes("Runtime skill injection marker"))).toBe(false);
    expect(capturedSystems.some((system) => system.includes("runtime-disabled-review"))).toBe(false);
    expect(capturedSystems.some((system) => system.includes("Skill-first rule"))).toBe(true);
  });

  it("injects only enabled selected skills into provider system prompts", async () => {
    const handle = createRuntimeMethodHandler(new LocalRunStore({ dataDir: freshStoreDir() }));
    await handle({
      jsonrpc: "2.0",
      id: 1,
      method: "skills.create",
      params: {
        name: "runtime-review",
        description: "Runtime review skill.",
        content: skillContent("runtime-review", "Runtime review skill."),
      },
    });

    await handle({
      jsonrpc: "2.0",
      id: 2,
      method: "runs.start",
      params: {
        input: { prompt: "Use a skill." },
        config: { pattern: "generator_verifier", skillIds: ["runtime-review"] },
      },
    });
    expect(capturedSystems.some((system) => system.includes("Runtime skill injection marker"))).toBe(true);

    capturedSystems.length = 0;
    await handle({
      jsonrpc: "2.0",
      id: 3,
      method: "skills.setEnabled",
      params: { name: "runtime-review", enabled: false },
    });
    await handle({
      jsonrpc: "2.0",
      id: 4,
      method: "runs.start",
      params: {
        input: { prompt: "Do not use a disabled skill." },
        config: { pattern: "generator_verifier", skillIds: ["runtime-review"] },
      },
    });
    expect(capturedSystems.some((system) => system.includes("Runtime skill injection marker"))).toBe(false);

    const state = await handle({
      jsonrpc: "2.0",
      id: 5,
      method: "runs.state",
      params: { runId: "run-0002" },
    }) as { config: { metadata: { skillWarnings?: string[] } } };
    expect(state.config.metadata.skillWarnings?.[0]).toContain("disabled");
  });
});
