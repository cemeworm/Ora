import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CustomAgentDetailSchema, CustomAgentGenerateDraftResultSchema } from "@ora/shared";

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

import { LocalRunStore, SessionManager, createRuntimeMethodHandler } from "../src/index.js";

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
      soul: "Prefer primary sources.",
    });
    expect(updated.model).toBeUndefined();
    expect(updated.toolGroups).toEqual(["web"]);
    expect(updated.soul).toContain("primary sources");

    const reloaded = new LocalRunStore({ dataDir: dir, clock });
    const loaded = reloaded.getAgent({ name: "research-bot" });
    expect(loaded.description).toBe("Sharper research persona");
    expect(loaded.toolGroups).toEqual(["web"]);

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

  it("propagates the selected custom agent persona through the SessionManager path", async () => {
    const handle = createRuntimeMethodHandler(
      new LocalRunStore({ dataDir: freshStoreDir(), clock }),
      new SessionManager(true),
    );

    await handle({
      jsonrpc: "2.0",
      id: 1,
      method: "agents.create",
      params: {
        name: "langgraph-review-bot",
        description: "LangGraph review mindset",
        soul: "Keep the persona visible even on managed runtime paths.",
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
          customAgentId: "langgraph-review-bot",
        },
      },
    });

    expect(capturedSystems.some((system) =>
      system.includes("Custom Agent Persona: langgraph-review-bot") &&
      system.includes("Keep the persona visible even on managed runtime paths.")
    )).toBe(true);
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
