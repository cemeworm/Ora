import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentCatalogResultSchema, CustomAgentDetailSchema, CustomAgentGenerateDraftResultSchema, getModePreset } from "@ora/shared";

const capturedSystems: string[] = [];
const providerResponses: string[] = [];
let providerShouldFail = false;

vi.mock("../src/providers/index.js", async () => {
  const actual = await vi.importActual<typeof import("../src/providers/index.js")>(
    "../src/providers/index.js"
  );

  return {
    ...actual,
    invokeRunProvider: vi.fn(async (config, request) => {
      capturedSystems.push(request.system ?? "");
      if (providerShouldFail) {
        throw new Error("provider unavailable");
      }
      const text = providerResponses.shift() ?? `reply:${request.prompt ?? ""}`;
      return {
        providerId: config.providerId ?? "mock-provider",
        providerType: "local_smoke",
        modelId: config.modelRef ?? "mock-model",
        text,
        raw: {
          prompt: request.prompt,
          messages: request.messages ?? [],
          system: request.system,
        },
      };
    }),
  };
});

import { LocalRunStore, createRuntimeMethodHandler } from "../src/index.js";

const FIXED_TIME = 1_700_100_000_000;
const clock = () => FIXED_TIME;

function freshStoreDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ora-runtime-custom-agents-"));
}

describe("custom agent runtime behavior", () => {
  beforeEach(() => {
    capturedSystems.length = 0;
    providerResponses.length = 0;
    providerShouldFail = false;
  });

  it("creates, lists, updates, reloads, and deletes file-backed custom agents", () => {
    const dir = freshStoreDir();
    const store = new LocalRunStore({ dataDir: dir, clock });

    const created = CustomAgentDetailSchema.parse(store.createAgent({
      name: "Research-Bot",
      description: "Research persona",
      model: "gpt-5.4",
      toolGroups: ["web", "files"],
      toolIds: ["web.search", "file.read"],
      skillIds: ["long-task-protocol"],
      soul: "Be concise and source-backed.",
    }));

    expect(created.name).toBe("research-bot");
    expect(store.checkAgentName({ name: "research-bot" }).available).toBe(false);
    expect(store.listAgents().map((agent) => agent.name)).toEqual(["research-bot"]);

    const updated = store.updateAgent({
      name: "research-bot",
      description: "Sharper research persona",
      model: null,
      toolGroups: ["web"],
      toolIds: ["web.fetch"],
      skillIds: ["review"],
      soul: "Prefer primary sources.",
    });
    expect(updated.model).toBeUndefined();
    expect(updated.toolGroups).toEqual(["web"]);
    expect(updated.toolIds).toEqual(["web.fetch"]);
    expect(updated.skillIds).toEqual(["review"]);
    expect(updated.soul).toContain("primary sources");

    const reloaded = new LocalRunStore({ dataDir: dir, clock });
    const loaded = reloaded.getAgent({ name: "research-bot" });
    expect(loaded.description).toBe("Sharper research persona");
    expect(loaded.toolGroups).toEqual(["web"]);
    expect(loaded.toolIds).toEqual(["web.fetch"]);
    expect(loaded.skillIds).toEqual(["review"]);

    const deleted = reloaded.deleteAgent({ name: "research-bot" });
    expect(deleted).toEqual({ deleted: true, name: "research-bot" });
    expect(reloaded.listAgents()).toEqual([]);
    expect(reloaded.checkAgentName({ name: "research-bot" }).available).toBe(true);
  });

  it("injects the selected custom agent persona into provider system prompts", async () => {
    const handle = createRuntimeMethodHandler(new LocalRunStore({ dataDir: freshStoreDir(), clock }));

    await handle({
      jsonrpc: "2.0",
      id: 1,
      method: "agents.create",
      params: {
        name: "review-bot",
        description: "Review mindset",
        soul: "Look for regressions before polish.",
        toolGroups: ["files"],
      },
    });

    await handle({
      jsonrpc: "2.0",
      id: 2,
      method: "runs.start",
      params: {
        input: { prompt: "Inspect this change." },
        config: {
          pattern: "generator_verifier",
          customAgentId: "review-bot",
        },
      },
    });

    expect(capturedSystems.some((system) =>
      system.includes("Custom Agent Persona: review-bot") &&
      system.includes("Look for regressions before polish.")
    )).toBe(true);
  });

  it("catalogs built-in agents, usage, and rejects new custom name collisions", async () => {
    const store = new LocalRunStore({ dataDir: freshStoreDir(), clock });
    const handle = createRuntimeMethodHandler(store);
    await handle({
      jsonrpc: "2.0",
      id: 1,
      method: "agents.updateSystemOverride",
      params: {
        agentId: "builder",
        modelRef: "local/smoke-model",
      },
    });

    const catalog = AgentCatalogResultSchema.parse(store.agentCatalog());
    const builder = catalog.systemAgents.find((agent) => agent.id === "builder");

    expect(builder).toBeDefined();
    expect(builder?.source).toBe("system");
    expect(builder?.modelRef).toBeUndefined();
    expect(builder?.usages.some((usage) => usage.modeId === "agent_teams")).toBe(true);
    expect(store.checkAgentName({ name: "builder" }).available).toBe(false);
    expect(() => store.createAgent({
      name: "builder",
      description: "Should collide",
      soul: "Nope.",
    })).toThrow(/built-in system agent/);
  });

  it("maps legacy built-in override ids onto canonical system agents", async () => {
    const dir = freshStoreDir();
    const overrideDir = path.join(dir, "agent-overrides");
    fs.mkdirSync(overrideDir, { recursive: true });
    fs.writeFileSync(path.join(overrideDir, "research_subagent.json"), JSON.stringify({
      agentId: "research_subagent",
      label: "Legacy Research Override",
      role: "Legacy id should still tune the canonical researcher.",
      soul: "Carry forward the legacy research override.",
      createdAt: FIXED_TIME,
      updatedAt: FIXED_TIME,
    }, null, 2));

    const store = new LocalRunStore({ dataDir: dir, clock });
    const handle = createRuntimeMethodHandler(store);
    const catalog = AgentCatalogResultSchema.parse(store.agentCatalog());
    const researcher = catalog.systemAgents.find((agent) => agent.id === "researcher");

    expect(researcher).toMatchObject({
      id: "researcher",
      label: "Legacy Research Override",
      overridden: true,
    });
    expect(catalog.systemAgents.some((agent) => agent.id === "research_subagent")).toBe(false);

    await handle({
      jsonrpc: "2.0",
      id: 1,
      method: "runs.start",
      params: {
        input: { prompt: "Use the DeerFlow-like harness." },
        config: { modeId: "deerflow_harness" },
      },
    });

    const system = capturedSystems.find((value) => value.includes("System Agent Override: researcher")) ?? "";
    expect(system).toContain("Carry forward the legacy research override.");

    await handle({
      jsonrpc: "2.0",
      id: 2,
      method: "agents.resetSystemOverride",
      params: { agentId: "research_subagent" },
    });
    expect(fs.existsSync(path.join(overrideDir, "research_subagent.json"))).toBe(false);
    expect(store.agentCatalog().systemAgents.find((agent) => agent.id === "researcher")?.overridden).toBe(false);
  });

  it("applies and resets global built-in agent overrides during execution", async () => {
    const store = new LocalRunStore({ dataDir: freshStoreDir(), clock });
    const handle = createRuntimeMethodHandler(store);

    await handle({
      jsonrpc: "2.0",
      id: 1,
      method: "agents.updateSystemOverride",
      params: {
        agentId: "solo_agent",
        label: "Solo Captain",
        role: "Own the task with a stricter direct-response style.",
        modelRef: "explicit-system-model",
        toolIds: ["file.read"],
        skillIds: ["long-task-protocol"],
        soul: "Answer as the overridden solo captain.",
      },
    });

    const catalog = AgentCatalogResultSchema.parse(await handle({
      jsonrpc: "2.0",
      id: 2,
      method: "agents.catalog",
    }));
    const solo = catalog.systemAgents.find((agent) => agent.id === "solo_agent");
    expect(solo?.label).toBe("Solo Captain");
    expect(solo?.modelRef).toBe("explicit-system-model");
    expect(solo?.overridden).toBe(true);

    await handle({
      jsonrpc: "2.0",
      id: 3,
      method: "runs.start",
      params: {
        input: { prompt: "Read the project notes." },
        config: {
          modeId: "single_agent",
          toolIds: ["file.read", "web.search"],
        },
      },
    });

    const system = capturedSystems.find((value) => value.includes("System Agent Override: solo_agent")) ?? "";
    expect(system).toContain("Answer as the overridden solo captain.");
    expect(system).toContain("file.read");
    expect(system).not.toContain("web.search");

    await handle({
      jsonrpc: "2.0",
      id: 4,
      method: "agents.resetSystemOverride",
      params: { agentId: "solo_agent" },
    });
    const resetCatalog = AgentCatalogResultSchema.parse(await handle({
      jsonrpc: "2.0",
      id: 5,
      method: "agents.catalog",
    }));
    expect(resetCatalog.systemAgents.find((agent) => agent.id === "solo_agent")?.overridden).toBe(false);
  });

  it("propagates the selected custom agent persona with legacy graph metadata ignored", async () => {
    const handle = createRuntimeMethodHandler(
      new LocalRunStore({ dataDir: freshStoreDir(), clock }),
    );

    await handle({
      jsonrpc: "2.0",
      id: 1,
      method: "agents.create",
      params: {
        name: "legacy-review-bot",
        description: "Review mindset",
        soul: "Keep the persona visible even when legacy graph metadata is present.",
        toolGroups: ["files"],
      },
    });

    await handle({
      jsonrpc: "2.0",
      id: 2,
      method: "runs.start",
      params: {
        input: { prompt: "Inspect this managed change." },
        config: {
          pattern: "orchestrator_subagent",
          customAgentId: "legacy-review-bot",
          metadata: { langGraphOrchestration: true },
        },
      },
    });

    expect(capturedSystems.some((system) =>
      system.includes("Custom Agent Persona: legacy-review-bot") &&
      system.includes("Keep the persona visible even when legacy graph metadata is present.")
    )).toBe(true);
  });

  it("uses profile-bound custom agent capabilities without exceeding mode capabilities", async () => {
    const store = new LocalRunStore({ dataDir: freshStoreDir(), clock });
    const handle = createRuntimeMethodHandler(store);
    await handle({
      jsonrpc: "2.0",
      id: 1,
      method: "agents.create",
      params: {
        name: "focused-builder",
        description: "Focused builder persona",
        soul: "Only use the narrow tools and skills assigned to this role.",
        toolIds: ["file.read", "shell.execute"],
        skillIds: ["long-task-protocol", "missing-skill"],
      },
    });

    const preset = getModePreset("single_agent");
    if (!preset) {
      throw new Error("single_agent preset missing");
    }
    const mode = {
      ...preset,
      id: "profile-bound-agent-test",
      label: "Profile Bound Agent Test",
      systemPreset: false,
      capabilityFlags: {
        ...preset.capabilityFlags,
        toolIds: ["file.read", "web.search"],
        skillIds: ["long-task-protocol"],
      },
      profiles: preset.profiles.map((profile) => ({
        ...profile,
        customAgentId: profile.id === "solo_agent" ? "focused-builder" : profile.customAgentId,
      })),
    };
    const { systemPreset: _systemPreset, createdAt: _createdAt, updatedAt: _updatedAt, ...payload } = mode;
    store.createMode(payload);

    await handle({
      jsonrpc: "2.0",
      id: 2,
      method: "runs.start",
      params: {
        input: { prompt: "Read the project notes." },
        config: {
          modeId: "profile-bound-agent-test",
        },
      },
    });

    const system = capturedSystems.find((value) => value.includes("Custom Agent Persona: focused-builder")) ?? "";
    expect(system).toContain("Only use the narrow tools and skills assigned to this role.");
    expect(system).toContain("file.read");
    expect(system).not.toContain("web.search");
    expect(system).not.toContain("shell.execute");
    expect(system).toContain("# Long-task Protocol");
  });

  it("asks for more input before generating a custom agent from a vague prompt", async () => {
    const handle = createRuntimeMethodHandler(new LocalRunStore({ dataDir: freshStoreDir(), clock }));

    const result = CustomAgentGenerateDraftResultSchema.parse(await handle({
      jsonrpc: "2.0",
      id: 1,
      method: "agents.generateDraft",
      params: {
        messages: [{ role: "user", content: "帮我做一个" }],
        providerId: "local-smoke",
        modelRef: "local/smoke-model",
      },
    }));

    expect(result.status).toBe("needs_input");
    expect(result.assistantMessage).toContain("主要负责什么任务");
    expect(providerResponses).toHaveLength(0);
  });

  it("generates a valid custom agent draft with the selected provider", async () => {
    providerResponses.push(JSON.stringify({
      assistantMessage: "我生成了一版香港研究智能体，请确认。",
      needsInput: false,
      draft: {
        name: "Researcher HK",
        description: "Research Hong Kong market questions with sourced findings.",
        model: "claude-sonnet-4-20250514",
        toolGroups: ["web", "github", "web"],
        soul: "Act as a careful market researcher. Cite sources, separate facts from assumptions, and call out risks before recommendations.",
      },
      issues: [],
    }));
    const handle = createRuntimeMethodHandler(new LocalRunStore({ dataDir: freshStoreDir(), clock }));

    const result = CustomAgentGenerateDraftResultSchema.parse(await handle({
      jsonrpc: "2.0",
      id: 1,
      method: "agents.generateDraft",
      params: {
        messages: [{ role: "user", content: "帮我创建一个香港市场研究智能体，输出要有来源、风险和下一步建议。" }],
        providerId: "mock-provider",
        modelRef: "mock-model",
      },
    }));

    expect(result.status).toBe("draft_ready");
    expect(result.draft.name).toBe("researcher-hk");
    expect(result.draft.toolGroups).toEqual(["web", "github"]);
    expect(result.draft.soul).toContain("Cite sources");
    expect(capturedSystems.at(-1)).toContain("Return strict JSON only");
  });

  it("does not return a creatable draft when the generated name already exists", async () => {
    providerResponses.push(JSON.stringify({
      assistantMessage: "我生成了一版研究智能体，请确认。",
      needsInput: false,
      draft: {
        name: "research-bot",
        description: "Research with sources.",
        toolGroups: ["web"],
        soul: "Research carefully and cite sources.",
      },
      issues: [],
    }));
    const store = new LocalRunStore({ dataDir: freshStoreDir(), clock });
    store.createAgent({
      name: "research-bot",
      description: "Existing research bot",
      soul: "Existing instructions.",
    });
    const handle = createRuntimeMethodHandler(store);

    const result = CustomAgentGenerateDraftResultSchema.parse(await handle({
      jsonrpc: "2.0",
      id: 1,
      method: "agents.generateDraft",
      params: {
        messages: [{ role: "user", content: "帮我创建一个研究智能体，负责找资料和总结来源。" }],
      },
    }));

    expect(result.status).toBe("needs_input");
    expect(result.issues.map((issue) => issue.field)).toContain("name");
    expect(store.listAgents()).toHaveLength(1);
  });

  it("surfaces provider failures without creating a custom agent", async () => {
    providerShouldFail = true;
    const store = new LocalRunStore({ dataDir: freshStoreDir(), clock });
    const handle = createRuntimeMethodHandler(store);

    await expect(handle({
      jsonrpc: "2.0",
      id: 1,
      method: "agents.generateDraft",
      params: {
        messages: [{ role: "user", content: "帮我创建一个代码审查智能体，输出风险、行号和建议修复方向。" }],
      },
    })).rejects.toThrow("provider unavailable");
    expect(store.listAgents()).toEqual([]);
  });
});
