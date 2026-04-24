import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CustomAgentDetailSchema } from "@ora/shared";

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
});
