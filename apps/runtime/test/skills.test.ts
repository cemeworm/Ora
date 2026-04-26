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
      },
    }) as { name: string; category: string; editable: boolean; enabled: boolean };
    expect(created).toMatchObject({
      name: "runtime-review",
      category: "private",
      editable: true,
      enabled: true,
    });
    expect(fs.existsSync(path.join(dataDir, "skills", "private", "runtime-review", "SKILL.md"))).toBe(true);

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

    const reloaded = createRuntimeMethodHandler(new LocalRunStore({ dataDir }));
    const loaded = reloaded({
      jsonrpc: "2.0",
      id: 3,
      method: "skills.get",
      params: { name: "runtime-review" },
    }) as { description: string; enabled: boolean };
    expect(loaded.description).toBe("Updated runtime review skill.");

    const disabled = reloaded({
      jsonrpc: "2.0",
      id: 4,
      method: "skills.setEnabled",
      params: { name: "runtime-review", enabled: false },
    }) as { enabled: boolean };
    expect(disabled.enabled).toBe(false);

    expect(reloaded({
      jsonrpc: "2.0",
      id: 5,
      method: "skills.delete",
      params: { name: "runtime-review" },
    })).toEqual({ deleted: true, name: "runtime-review" });
    expect((reloaded({
      jsonrpc: "2.0",
      id: 6,
      method: "skills.checkName",
      params: { name: "runtime-review" },
    }) as { available: boolean }).available).toBe(true);
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

    const disabled = handle({
      jsonrpc: "2.0",
      id: 2,
      method: "skills.setEnabled",
      params: { name: "long-task-protocol", enabled: false },
    }) as { enabled: boolean };
    expect(disabled.enabled).toBe(false);

    expect(handle({
      jsonrpc: "2.0",
      id: 3,
      method: "skills.delete",
      params: { name: "long-task-protocol" },
    })).toEqual({ deleted: true, name: "long-task-protocol" });

    const reloaded = createRuntimeMethodHandler(new LocalRunStore({ dataDir }));
    expect((reloaded({
      jsonrpc: "2.0",
      id: 4,
      method: "skills.checkName",
      params: { name: "long-task-protocol" },
    }) as { available: boolean }).available).toBe(true);
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
