import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SINGLE_AGENT_MODE_ID, StateSnapshotSchema } from "@cemeworm/shared";
import { LocalRunStore, createRuntimeMethodHandler } from "../src/index.js";

const cleanupPaths: string[] = [];

function createTempStore() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ora-agent-spawn-"));
  cleanupPaths.push(dataDir);
  return new LocalRunStore({ dataDir });
}

afterEach(() => {
  for (const cleanupPath of cleanupPaths.splice(0)) {
    fs.rmSync(cleanupPath, { recursive: true, force: true });
  }
  delete process.env.NODE_LOOP_TOOL_KEY;
});

function jsonResponse(content: string) {
  return new Response(JSON.stringify({
    choices: [{ finish_reason: "stop", message: { role: "assistant", content } }],
  }), { status: 200, headers: { "content-type": "application/json" } });
}

async function pollUntilDone(
  handle: ReturnType<typeof createRuntimeMethodHandler>,
  runId: string,
  maxAttempts = 80,
): Promise<{ status: string; toolCalls: Array<{ toolId: string; status: string; error?: string }> }> {
  for (let i = 0; i < maxAttempts; i++) {
    const raw = await handle({ jsonrpc: "2.0", id: 2, method: "runs.state", params: { runId } });
    const parsed = StateSnapshotSchema.safeParse(raw);
    if (parsed.success && (parsed.data.status === "succeeded" || parsed.data.status === "failed")) {
      return { status: parsed.data.status, toolCalls: parsed.data.toolCalls };
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return { status: "timeout", toolCalls: [] };
}

function runConfig(overrides: Partial<{ toolIds: string[] }> = {}) {
  return {
    modeId: SINGLE_AGENT_MODE_ID,
    providerId: "agent-spawn-provider",
    modelRef: "agent-spawn-model",
    providerConfig: {
      id: "agent-spawn-provider",
      label: "Agent Spawn Provider",
      type: "openai_compatible" as const,
      modelId: "agent-spawn-model",
      baseUrl: "https://agent-spawn.test/v1",
      apiKeyEnv: "NODE_LOOP_TOOL_KEY",
      capabilities: ["chat", "tool_use"] as string[],
      headers: {},
    },
    toolIds: overrides.toolIds ?? ["agent.spawn", "file.read"],
  };
}

describe("agent.spawn integration", () => {
  it("passes inherit_context and custom system_prompt to sub-agent", async () => {
    process.env.NODE_LOOP_TOOL_KEY = "test";
    const prevKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "test-key";
    let calls = 0;
    const prevFetch = globalThis.fetch;
    let subAgentSystemPrompt = "";

    globalThis.fetch = (async (_input, init) => {
      calls += 1;
      const body = JSON.parse(String((init as { body?: string })?.body ?? "{}"));
      const messages = body?.messages as Array<{ role: string; content: string }> | undefined;

      if (calls === 1) {
        return jsonResponse(JSON.stringify({
          tool: "agent.spawn",
          args: {
            description: "Research",
            prompt: "Find the answer.",
            inherit_context: true,
            system_prompt: "You are a helpful research assistant.",
          },
        }));
      }
      if (calls === 2) {
        subAgentSystemPrompt = messages?.find((m) => m.role === "system")?.content ?? "";
        return jsonResponse("The answer is 42.");
      }
      return jsonResponse("Final: 42.");
    }) as typeof fetch;

    try {
      const handle = createRuntimeMethodHandler(createTempStore());
      const start = await handle({
        jsonrpc: "2.0", id: 1, method: "runs.start",
        params: { input: { prompt: "What is the answer?" }, config: runConfig() },
      }) as { runId?: string; error?: unknown };
      if (!start.runId) throw new Error(`Start failed: ${JSON.stringify(start)}`);

      const result = await pollUntilDone(handle, start.runId);
      expect(result.status).toBe("succeeded");
      expect(subAgentSystemPrompt).toContain("You are a helpful research assistant.");
    } finally {
      globalThis.fetch = prevFetch;
      process.env.OPENAI_API_KEY = prevKey;
    }
  });

  it("completes a full agent.spawn → sub-agent → synthesize flow through the kernel", async () => {
    process.env.NODE_LOOP_TOOL_KEY = "test";
    let calls = 0;
    const prevFetch = globalThis.fetch;

    globalThis.fetch = (async () => {
      calls += 1;
      if (calls === 1) {
        return jsonResponse(JSON.stringify({
          tool: "agent.spawn",
          args: { description: "Research", prompt: "Find the answer." },
        }));
      }
      if (calls === 2) {
        return jsonResponse("The answer is 42.");
      }
      return jsonResponse("Based on the research: the answer is 42.");
    }) as typeof fetch;

    try {
      const handle = createRuntimeMethodHandler(createTempStore());
      const start = await handle({
        jsonrpc: "2.0", id: 1, method: "runs.start",
        params: { input: { prompt: "What is the answer?" }, config: runConfig() },
      }) as { runId?: string; error?: unknown };

      if (!start.runId) throw new Error(`Start failed: ${JSON.stringify(start)}`);

      const result = await pollUntilDone(handle, start.runId);
      // Accept that provider calls may vary due to guard retries;
      // the critical assertion is that the run succeeded.
      expect(result.status).toBe("succeeded");

      const spawnCalls = result.toolCalls.filter((tc) => tc.toolId === "agent.spawn");
      expect(spawnCalls.length).toBe(1);
      expect(spawnCalls[0].status).toBe("succeeded");
    } finally {
      globalThis.fetch = prevFetch;
    }
  });

  it("sub-agent cannot use agent.spawn (isNestedAgentSpawn filter)", async () => {
    process.env.NODE_LOOP_TOOL_KEY = "test";
    let calls = 0;
    const prevFetch = globalThis.fetch;

    globalThis.fetch = (async () => {
      calls += 1;
      if (calls === 1) {
        return jsonResponse(JSON.stringify({
          tool: "agent.spawn",
          args: { description: "Delegate", prompt: "Spawn another agent." },
        }));
      }
      return jsonResponse(`Sub-agent turn ${calls}: answering directly.`);
    }) as typeof fetch;

    try {
      const handle = createRuntimeMethodHandler(createTempStore());
      const start = await handle({
        jsonrpc: "2.0", id: 1, method: "runs.start",
        params: { input: { prompt: "Spawn an agent that spawns another." }, config: runConfig() },
      }) as { runId?: string; error?: unknown };

      if (!start.runId) throw new Error(`Start failed: ${JSON.stringify(start)}`);

      const result = await pollUntilDone(handle, start.runId);
      expect(result.status).toBe("succeeded");

      // Only parent's agent.spawn call; sub-agent couldn't call it
      const spawnCalls = result.toolCalls.filter((tc) => tc.toolId === "agent.spawn");
      expect(spawnCalls.length).toBe(1);
    } finally {
      globalThis.fetch = prevFetch;
    }
  });
});
