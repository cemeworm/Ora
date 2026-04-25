import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_WEB_TOOL_IDS, DEERFLOW_HARNESS_MODE_ID, OraEventEnvelopeSchema, StateSnapshotSchema, getModePreset, modeSpecToPatternDefinition } from "@ora/shared";
import { LocalRunStore, createRuntimeMethodHandler, executeRuntimeKernel, handleJsonRpcLine } from "../src/index.js";

function createTempStore() {
  return new LocalRunStore({
    dataDir: fs.mkdtempSync(path.join(os.tmpdir(), "ora-runtime-test-"))
  });
}

function expectOrderedEvents(eventTypes: string[], expected: string[]) {
  let lastIndex = -1;
  for (const eventType of expected) {
    const nextIndex = eventTypes.indexOf(eventType, lastIndex + 1);
    expect(nextIndex).toBeGreaterThan(lastIndex);
    lastIndex = nextIndex;
  }
}

async function waitFor(predicate: () => boolean, timeoutMs = 1000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("Timed out waiting for condition");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("Ora runtime smoke path", () => {
  it("starts a deterministic smoke run with ordered Ora events", async () => {
    const handle = createRuntimeMethodHandler(createTempStore());
    const run = (await handle({
      jsonrpc: "2.0",
      id: 1,
      method: "runs.start",
      params: {
        input: { prompt: "Build a small local smoke path." },
        config: { pattern: "generator_verifier" }
      }
    })) as { runId: string; status: string; pattern: string };

    expect(run.status).toBe("succeeded");
    expect(run.pattern).toBe("generator_verifier");

    const state = StateSnapshotSchema.parse(
      await handle({
        jsonrpc: "2.0",
        id: 2,
        method: "runs.state",
        params: { runId: run.runId }
      })
    );

    const eventTypes = state.events.map((event) => event.type);

    expect(eventTypes.slice(0, 4)).toEqual([
      "run.started",
      "topology.updated",
      "profile.updated",
      "plan.updated"
    ]);
    expectOrderedEvents(eventTypes, [
      "agent.started",
      "tool.called",
      "message.delta",
      "token.delta",
      "agent.completed",
      "memory.queued",
      "run.done",
      "memory.updated",
      "memory.flushed",
      "checkpoint.created"
    ]);
    expect(state.events.map((event) => event.seq)).toEqual([...Array(state.events.length).keys()]);
    expect(state.checkpoints).toHaveLength(1);
    expect(state.topology.nodes.length).toBeGreaterThan(1);
    expect(state.profiles.map((profile) => profile.id)).toEqual(["generator", "verifier"]);
    expect(state.actions.length).toBeGreaterThanOrEqual(2);
    expect(state.actions.every((action) => action.status === "succeeded")).toBe(true);
    expect(state.policyDecisions).toEqual([]);
    expect(
      state.memory.some((record) =>
        record.namespace.join(":").startsWith("session:local-project:generator_verifier"),
      ),
    ).toBe(true);
    expect(state.plan.every((item) => item.status === "done")).toBe(true);
    expect(state.plan.some((item) => item.linkedActionIds.length > 0)).toBe(true);
    expect(state.todos).toHaveLength(state.plan.length);
    expect(state.todos.every((item) => item.status === "done")).toBe(true);
    expect(state.todos.map((item) => item.sourcePlanItemId)).toEqual(state.plan.map((item) => item.id));
    expect(state.pendingClarifications).toEqual([]);
    expect(state.pendingApprovals).toEqual([]);
    expect(state.activeAgents).toEqual([]);
    expect(state.events.map((event) => event.type)).toContain("todo.updated");
    expect(state.topology.nodes.some((node) => node.kind === "capability" && node.metadata.atomId === "memory_capture")).toBe(true);
    expect(state.topology.nodes.some((node) => node.kind === "capability" && node.metadata.atomId === "tool_error_boundary")).toBe(true);
    expect(state.output).toMatchObject({
      text: expect.stringContaining("[local-smoke]"),
      pattern: "generator_verifier",
      generator: { candidate: expect.stringContaining("[local-smoke]") },
      verifier: { verdict: "pass" }
    });

    for (const event of state.events) {
      expect(OraEventEnvelopeSchema.parse(event).runId).toBe(run.runId);
    }
  });

  it("preserves providerId/providerConfig and routes calls through the selected provider", async () => {
    const handle = createRuntimeMethodHandler(createTempStore());
    const run = (await handle({
      jsonrpc: "2.0",
      id: 1,
      method: "runs.start",
      params: {
        input: { prompt: "Use the selected provider." },
        config: {
          pattern: "generator_verifier",
          providerId: "deepseek",
          modelRef: "deepseek-chat",
          metadata: { providerId: "deepseek" },
          providerConfig: {
            id: "deepseek",
            label: "DeepSeek Smoke",
            type: "local_smoke",
            modelId: "deepseek-chat",
            capabilities: ["chat"],
            headers: {},
          },
        },
      },
    })) as { runId: string };

    const state = StateSnapshotSchema.parse(
      await handle({
        jsonrpc: "2.0",
        id: 2,
        method: "runs.state",
        params: { runId: run.runId },
      })
    );

    expect(state.config.providerId).toBe("deepseek");
    expect(state.config.modelRef).toBe("deepseek-chat");
    expect(state.config.providerConfig).toMatchObject({
      id: "deepseek",
      type: "local_smoke",
      modelId: "deepseek-chat",
    });
    expect(
      state.events.some((event) =>
        event.type === "tool.called"
        && typeof event.payload === "object"
        && event.payload !== null
        && (event.payload as Record<string, unknown>).providerId === "deepseek",
      ),
    ).toBe(true);
  });

  it("adds default web tools to cloned modes and effective runtime configs", async () => {
    const handle = createRuntimeMethodHandler(createTempStore());
    const cloned = await handle({
      jsonrpc: "2.0",
      id: 1,
      method: "modes.cloneFromPreset",
      params: {
        sourceModeId: "single_agent",
        modeId: "single-agent-web-defaults",
        label: "Single Agent Web Defaults",
      },
    }) as any;

    for (const toolId of DEFAULT_WEB_TOOL_IDS) {
      expect(cloned.capabilityFlags.toolIds).toContain(toolId);
    }

    const run = await handle({
      jsonrpc: "2.0",
      id: 2,
      method: "runs.start",
      params: {
        input: { prompt: "Keep web tools even when config passes custom tools." },
        config: { modeId: cloned.id, toolIds: ["shell.execute", "web.search"] },
      },
    }) as { runId: string };

    const state = StateSnapshotSchema.parse(
      await handle({
        jsonrpc: "2.0",
        id: 3,
        method: "runs.state",
        params: { runId: run.runId },
      }),
    );

    expect(state.config.toolIds).toEqual(expect.arrayContaining(["shell.execute", ...DEFAULT_WEB_TOOL_IDS]));
    expect(state.config.toolIds.filter((toolId) => toolId === "web.search")).toHaveLength(1);

    const optOutRun = await handle({
      jsonrpc: "2.0",
      id: 4,
      method: "runs.start",
      params: {
        input: { prompt: "Respect explicit network policy opt-out." },
        config: {
          modeId: cloned.id,
          toolIds: ["shell.execute"],
          metadata: { disableDefaultWebTools: true },
        },
      },
    }) as { runId: string };
    const optOutState = StateSnapshotSchema.parse(
      await handle({
        jsonrpc: "2.0",
        id: 5,
        method: "runs.state",
        params: { runId: optOutRun.runId },
      }),
    );

    expect(optOutState.config.toolIds).toEqual(["shell.execute"]);
  });

  it("executes web.search for a provider without native browsing", async () => {
    const handle = createRuntimeMethodHandler(createTempStore());
    const previousFetch = globalThis.fetch;
    const previousProviderKey = process.env.MOCK_CHAT_KEY;
    const previousSearchKey = process.env.MOCK_BRAVE_KEY;
    process.env.MOCK_CHAT_KEY = "provider-key";
    process.env.MOCK_BRAVE_KEY = "search-key";
    let providerCalls = 0;
    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      if (url.includes("api.search.brave.com")) {
        return new Response(JSON.stringify({
          web: {
            results: [
              { title: "Example Result", url: "https://example.com/result", description: "Search result snippet" },
            ],
          },
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.includes("mock-chat.test")) {
        const body = String(init?.body ?? "");
        providerCalls += 1;
        const content = providerCalls === 1 && !body.includes("Workspace tool result")
          ? "{\"tool\":\"web.search\",\"args\":{\"query\":\"Ora web search\",\"limit\":1}}"
          : "Search answer from Example Result";
        return new Response(JSON.stringify({
          choices: [{ message: { content } }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      throw new Error(`Unexpected fetch ${url}`);
    }) as typeof fetch;

    try {
      const run = await handle({
        jsonrpc: "2.0",
        id: 1,
        method: "runs.start",
        params: {
          input: { prompt: "Search for Ora web search." },
          config: {
            modeId: "single_agent",
            providerId: "mock-chat",
            modelRef: "mock-chat-model",
            providerConfig: {
              id: "mock-chat",
              label: "Mock Chat",
              type: "openai_compatible",
              modelId: "mock-chat-model",
              baseUrl: "https://mock-chat.test/v1",
              apiKeyEnv: "MOCK_CHAT_KEY",
              capabilities: ["chat"],
              headers: {},
            },
            searchProvider: {
              id: "brave",
              apiKeyEnv: "MOCK_BRAVE_KEY",
            },
          },
        },
      }) as { runId: string };

      const state = StateSnapshotSchema.parse(
        await handle({
          jsonrpc: "2.0",
          id: 2,
          method: "runs.state",
          params: { runId: run.runId },
        }),
      );
      const searchEvent = state.events.find((event) =>
        event.type === "tool.called"
        && typeof event.payload === "object"
        && event.payload !== null
        && (event.payload as Record<string, unknown>).toolId === "web.search"
      );

      expect(searchEvent?.payload).toMatchObject({
        status: "succeeded",
        output: {
          providerId: "brave",
          results: [expect.objectContaining({ title: "Example Result", url: "https://example.com/result" })],
        },
      });
      expect(state.toolCalls).toEqual([
        expect.objectContaining({
          toolId: "web.search",
          source: "json_fallback",
          status: "succeeded",
          result: expect.objectContaining({ status: "succeeded" }),
        }),
      ]);
      expect(state.output).toMatchObject({ text: expect.stringContaining("Search answer from Example Result") });
    } finally {
      globalThis.fetch = previousFetch;
      if (previousProviderKey === undefined) {
        delete process.env.MOCK_CHAT_KEY;
      } else {
        process.env.MOCK_CHAT_KEY = previousProviderKey;
      }
      if (previousSearchKey === undefined) {
        delete process.env.MOCK_BRAVE_KEY;
      } else {
        process.env.MOCK_BRAVE_KEY = previousSearchKey;
      }
    }
  });

  it("executes OpenAI-compatible native tool calls and returns matching tool results", async () => {
    const handle = createRuntimeMethodHandler(createTempStore());
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ora-native-tool-"));
    fs.writeFileSync(path.join(workspaceRoot, "README.md"), "Native tool result\n", "utf8");
    const previousFetch = globalThis.fetch;
    const previousKey = process.env.NATIVE_TOOL_KEY;
    process.env.NATIVE_TOOL_KEY = "test";
    let providerCalls = 0;
    globalThis.fetch = (async (_input, init) => {
      providerCalls += 1;
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        tools?: unknown[];
        messages?: Array<{ role: string; tool_call_id?: string; content?: string }>;
      };
      expect(body.tools?.length).toBeGreaterThan(0);
      if (providerCalls === 1) {
        return new Response(JSON.stringify({
          choices: [{
            finish_reason: "tool_calls",
            message: {
              content: null,
              tool_calls: [{
                id: "call-readme",
                type: "function",
                function: {
                  name: "file__read",
                  arguments: "{\"path\":\"README.md\"}",
                },
              }],
            },
          }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (providerCalls === 2) {
        expect(body.messages?.some((message) =>
          message.role === "tool"
          && message.tool_call_id === "call-readme"
          && String(message.content ?? "").includes("Native tool result")
        )).toBe(true);
      }
      return new Response(JSON.stringify({
        choices: [{ message: { content: "Read README through native tool." } }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    try {
      const run = await handle({
        jsonrpc: "2.0",
        id: 1,
        method: "runs.start",
        params: {
          input: {
            prompt: "Read the README.",
            context: {
              projectWorkspace: { label: "Native Tool Workspace", rootPath: workspaceRoot },
            },
          },
          config: {
            modeId: "single_agent",
            providerId: "native-tool",
            modelRef: "native-tool-model",
            providerConfig: {
              id: "native-tool",
              label: "Native Tool",
              type: "openai_compatible",
              modelId: "native-tool-model",
              baseUrl: "https://native-tool.test/v1",
              apiKeyEnv: "NATIVE_TOOL_KEY",
              capabilities: ["chat", "tool_use"],
              headers: {},
            },
            toolIds: ["file.read"],
          },
        },
      }) as { runId: string; status: string };

      const state = StateSnapshotSchema.parse(await handle({
        jsonrpc: "2.0",
        id: 2,
        method: "runs.state",
        params: { runId: run.runId },
      }));

      expect(run.status).toBe("succeeded");
      expect(providerCalls).toBeGreaterThanOrEqual(2);
      expect(state.toolCalls).toEqual([
        expect.objectContaining({
          providerCallId: "call-readme",
          toolId: "file.read",
          source: "provider_native",
          status: "succeeded",
        }),
      ]);
      expect(state.output).toMatchObject({ text: expect.stringContaining("Read README through native tool.") });
    } finally {
      globalThis.fetch = previousFetch;
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
      if (previousKey === undefined) {
        delete process.env.NATIVE_TOOL_KEY;
      } else {
        process.env.NATIVE_TOOL_KEY = previousKey;
      }
    }
  });

  it("reuses identical web.fetch results inside one runtime tool loop", async () => {
    const handle = createRuntimeMethodHandler(createTempStore());
    const previousFetch = globalThis.fetch;
    const previousKey = process.env.REPEAT_FETCH_KEY;
    process.env.REPEAT_FETCH_KEY = "test";
    let providerCalls = 0;
    let webFetchCalls = 0;
    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      if (url === "https://example.com/repeat") {
        webFetchCalls += 1;
        return new Response("Repeatable content", { status: 200, headers: { "content-type": "text/plain" } });
      }

      providerCalls += 1;
      if (providerCalls <= 2) {
        return new Response(JSON.stringify({
          choices: [{
            finish_reason: "tool_calls",
            message: {
              content: null,
              tool_calls: [{
                id: `call-repeat-${providerCalls}`,
                type: "function",
                function: {
                  name: "web__fetch",
                  arguments: "{\"url\":\"https://example.com/repeat\"}",
                },
              }],
            },
          }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }

      return new Response(JSON.stringify({
        choices: [{ message: { content: "Used repeated fetch result once." } }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    try {
      const run = await handle({
        jsonrpc: "2.0",
        id: 1,
        method: "runs.start",
        params: {
          input: { prompt: "Fetch the same URL twice." },
          config: {
            modeId: "single_agent",
            providerId: "repeat-fetch",
            modelRef: "repeat-fetch-model",
            providerConfig: {
              id: "repeat-fetch",
              label: "Repeat Fetch",
              type: "openai_compatible",
              modelId: "repeat-fetch-model",
              baseUrl: "https://repeat-fetch.test/v1",
              apiKeyEnv: "REPEAT_FETCH_KEY",
              capabilities: ["chat", "tool_use"],
              headers: {},
            },
            toolIds: ["web.fetch"],
          },
        },
      }) as { runId: string; status: string };

      const state = StateSnapshotSchema.parse(await handle({
        jsonrpc: "2.0",
        id: 2,
        method: "runs.state",
        params: { runId: run.runId },
      }));
      const fetchEvents = state.events.filter((event) =>
        event.type === "tool.called"
        && typeof event.payload === "object"
        && event.payload !== null
        && (event.payload as Record<string, unknown>).toolId === "web.fetch"
      );

      expect(run.status).toBe("succeeded");
      expect(webFetchCalls).toBe(1);
      expect(fetchEvents).toHaveLength(2);
      expect(fetchEvents[0]?.payload).toMatchObject({ cacheHit: false });
      expect(fetchEvents[1]?.payload).toMatchObject({ cacheHit: true });
      expect(state.output).toMatchObject({ text: expect.stringContaining("Used repeated fetch result once.") });
    } finally {
      globalThis.fetch = previousFetch;
      if (previousKey === undefined) {
        delete process.env.REPEAT_FETCH_KEY;
      } else {
        process.env.REPEAT_FETCH_KEY = previousKey;
      }
    }
  });

  it("repairs dangling provider tool calls before the next model invocation", async () => {
    const modeSpec = getModePreset("single_agent");
    const definition = modeSpecToPatternDefinition(modeSpec);
    const { snapshot } = await executeRuntimeKernel(
      "run-repair",
      { prompt: "Continue after repair.", createdAt: 1, context: {} },
      {
        pattern: "orchestrator_subagent",
        modeId: "single_agent",
        providerId: "local-smoke",
        modelRef: "smoke-model",
        providerConfig: {
          id: "local-smoke",
          type: "local_smoke",
          label: "Smoke",
          modelId: "smoke-model",
          capabilities: ["chat"],
          headers: {},
        },
        metadata: {},
        deterministicSeed: "repair-test",
        profileIds: ["solo_agent"],
        skillIds: [],
        toolIds: [],
        approvalMode: "auto",
        budget: {
          maxTokens: 1024,
          maxToolCalls: 4,
          maxRuntimeMs: 60_000,
        },
      },
      {
        modeSpec,
        definition,
        conversationMessages: [{
          role: "assistant",
          content: "",
          toolCalls: [{ id: "dangling-call", toolId: "web.search", args: { query: "Ora" } }],
        }],
      },
    );

    expect(snapshot.events.map((event) => event.type)).toContain("tool.repaired");
    expect(snapshot.toolCalls).toEqual([
      expect.objectContaining({
        providerCallId: "dangling-call",
        toolId: "web.search",
        source: "manual_repair",
        status: "repaired",
        repairReason: "missing_provider_tool_result",
        result: expect.objectContaining({ status: "interrupted" }),
      }),
    ]);
  });

  it("keeps generator-verifier turns usable when verifier output is not parseable", async () => {
    const handle = createRuntimeMethodHandler(createTempStore());
    const previousFetch = globalThis.fetch;
    const previousKey = process.env.MOCK_OPENAI_KEY;
    process.env.MOCK_OPENAI_KEY = "test";
    globalThis.fetch = (async (_input, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        messages?: Array<{ role: string; content: string }>;
      };
      const systemText = body.messages
        ?.filter((message) => message.role === "system")
        .map((message) => message.content)
        .join("\n") ?? "";
      const content = systemText.includes("verifier")
        ? "This looks acceptable to me, but I am not returning JSON."
        : "Candidate answer from mocked provider.";
      return new Response(JSON.stringify({
        choices: [{ message: { role: "assistant", content } }],
      }), { status: 200 });
    }) as typeof fetch;

    try {
      const run = (await handle({
        jsonrpc: "2.0",
        id: 1,
        method: "runs.start",
        params: {
          input: { prompt: "What tools can you use?" },
          config: {
            pattern: "generator_verifier",
            providerId: "mock-openai",
            modelRef: "mock-chat",
            metadata: { providerId: "mock-openai" },
            providerConfig: {
              id: "mock-openai",
              label: "Mock OpenAI",
              type: "openai_compatible",
              modelId: "mock-chat",
              baseUrl: "https://example.test/v1",
              apiKeyEnv: "MOCK_OPENAI_KEY",
              capabilities: ["chat"],
              headers: {},
            },
          },
        },
      })) as { runId: string; status: string };

      const state = StateSnapshotSchema.parse(
        await handle({
          jsonrpc: "2.0",
          id: 2,
          method: "runs.state",
          params: { runId: run.runId },
        })
      );

      expect(run.status).toBe("succeeded");
      expect(state.status).toBe("succeeded");
      expect(state.error).toBeUndefined();
      expect(state.output).toMatchObject({
        pattern: "generator_verifier",
        verifier: {
          verdict: "fail",
          exhausted: true,
          failureKind: "verification_failed",
        },
      });
    } finally {
      globalThis.fetch = previousFetch;
      if (previousKey === undefined) {
        delete process.env.MOCK_OPENAI_KEY;
      } else {
        process.env.MOCK_OPENAI_KEY = previousKey;
      }
    }
  });

  it("serves JSON-RPC over newline-delimited request payloads", async () => {
    const response = await handleJsonRpcLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "health-1",
        method: "runtime.health"
      }),
      createRuntimeMethodHandler(createTempStore())
    );

    expect(response).toEqual({
      jsonrpc: "2.0",
      id: "health-1",
      result: {
        ok: true,
        service: "ora-runtime",
        version: "0.1.0",
        deterministic: false,
        persistence: "json-file"
      }
    });
  });

  it("exposes runtime bootstrap, tool list, and skill list from the unified runtime surface", async () => {
    const handle = createRuntimeMethodHandler(createTempStore());
    const bootstrap = await handle({
      jsonrpc: "2.0",
      id: 1,
      method: "runtime.bootstrap"
    }) as {
      health: { ok: boolean; mode: string };
      patterns: { id: string }[];
      modes: { id: string }[];
      atoms: { id: string }[];
      tools: { tools: { id: string }[] };
      skills: { skills: { id: string }[] };
    };
    const tools = await handle({
      jsonrpc: "2.0",
      id: 2,
      method: "tools.list"
    }) as { tools: { id: string }[] };
    const skills = await handle({
      jsonrpc: "2.0",
      id: 3,
      method: "skills.list"
    }) as { skills: { id: string }[] };

    expect(bootstrap.health.ok).toBe(true);
    expect(bootstrap.health.mode).toBe("runtime");
    expect(bootstrap.patterns.map((pattern) => pattern.id)).toEqual([
      "generator_verifier",
      "orchestrator_subagent",
      "agent_teams",
      "message_bus",
      "shared_state"
    ]);
    expect(bootstrap.modes.map((mode) => mode.id)).toEqual([
      "generator_verifier",
      "orchestrator_subagent",
      DEERFLOW_HARNESS_MODE_ID,
      "single_agent",
      "agent_teams",
      "message_bus",
      "shared_state"
    ]);
    expect(bootstrap.atoms.length).toBeGreaterThan(0);
    expect(bootstrap.tools.tools.length).toBeGreaterThan(0);
    expect(bootstrap.skills.skills.length).toBeGreaterThan(0);
    expect(tools.tools).toEqual(bootstrap.tools.tools);
    expect(skills.skills).toEqual(bootstrap.skills.skills);
  });

  it("creates, validates, lists, and runs a custom mode preset", async () => {
    const handle = createRuntimeMethodHandler(createTempStore());
    const cloned = await handle({
      jsonrpc: "2.0",
      id: 1,
      method: "modes.cloneFromPreset",
      params: {
        sourceModeId: "orchestrator_subagent",
        modeId: "orchestrator-subagent-custom",
        label: "Orchestrator Custom",
      },
    }) as any;

    expect(cloned.id).toBe("orchestrator-subagent-custom");
    expect(cloned.nodes.every((node: { position?: { x: number; y: number } }) => node.position)).toBe(true);

    const updated = await handle({
      jsonrpc: "2.0",
      id: 2,
      method: "modes.update",
      params: {
        modeId: cloned.id,
        spec: {
          ...cloned,
          summary: "Custom orchestrator mode.",
          nodes: cloned.nodes.map((node, index) =>
            node.id === "review"
              ? { ...node, enabled: false, label: "Review (disabled)", position: { x: 900, y: 240 } }
              : { ...node, position: { x: 120 + index * 220, y: 80 + index * 140 } }
          ),
        },
      },
    }) as any;

    expect(updated.nodes.find((node) => node.id === "review")?.enabled).toBe(false);
    expect(updated.nodes.find((node) => node.id === "review")?.position).toEqual({ x: 900, y: 240 });

    const validation = await handle({
      jsonrpc: "2.0",
      id: 3,
      method: "modes.validate",
      params: { spec: updated },
    }) as { valid: boolean; errors: string[] };
    expect(validation.valid).toBe(true);
    expect(validation.errors).toEqual([]);

    const modes = await handle({
      jsonrpc: "2.0",
      id: 4,
      method: "modes.list",
    }) as Array<{ id: string }>;
    expect(modes.some((mode) => mode.id === cloned.id)).toBe(true);

    const run = await handle({
      jsonrpc: "2.0",
      id: 5,
      method: "runs.start",
      params: {
        input: { prompt: "Run the custom mode." },
        config: { modeId: cloned.id },
      },
    }) as { runId: string };
    const state = StateSnapshotSchema.parse(
      await handle({
        jsonrpc: "2.0",
        id: 6,
        method: "runs.state",
        params: { runId: run.runId },
      }),
    );

    expect(state.modeId).toBe(cloned.id);
    expect(state.modeSpec?.id).toBe(cloned.id);
    expect(state.pattern).toBe("orchestrator_subagent");
    expect(state.plan.some((item) => item.id.endsWith(":review"))).toBe(false);
  });

  it("runs and clones the built-in DeerFlow-like harness preset", async () => {
    const handle = createRuntimeMethodHandler(createTempStore());
    const cloned = await handle({
      jsonrpc: "2.0",
      id: 1,
      method: "modes.cloneFromPreset",
      params: {
        sourceModeId: DEERFLOW_HARNESS_MODE_ID,
        modeId: "deerflow-harness-custom",
        label: "DeerFlow Harness Custom",
      },
    }) as any;

    expect(cloned.id).toBe("deerflow-harness-custom");
    expect(cloned.systemPreset).toBe(false);
    expect(cloned.editorConstraints.readOnly).toBe(false);
    expect(cloned.nodes.filter((node: { config?: { atoms?: unknown } }) =>
      Array.isArray(node.config?.atoms) && node.config.atoms.includes("subagent_delegate"),
    ).map((node: { id: string }) => node.id)).toEqual(["research", "review"]);

    const run = await handle({
      jsonrpc: "2.0",
      id: 2,
      method: "runs.start",
      params: {
        input: { prompt: "Use the DeerFlow-like harness." },
        config: { modeId: DEERFLOW_HARNESS_MODE_ID },
      },
    }) as { runId: string; status: string };

    expect(run.status).toBe("succeeded");

    const state = StateSnapshotSchema.parse(
      await handle({
        jsonrpc: "2.0",
        id: 3,
        method: "runs.state",
        params: { runId: run.runId },
      }),
    );

    const taskStartedPayloads = state.events
      .filter((event) => event.type === "task.started")
      .map((event) => event.payload);

    expect(state.modeId).toBe(DEERFLOW_HARNESS_MODE_ID);
    expect(state.modeSpec?.id).toBe(DEERFLOW_HARNESS_MODE_ID);
    expect(state.pattern).toBe("orchestrator_subagent");
    expect(state.profiles.map((profile) => profile.id)).toEqual([
      "lead_agent",
      "research_subagent",
      "review_subagent",
    ]);
    expect(taskStartedPayloads).toEqual(expect.arrayContaining([
      expect.objectContaining({ taskId: "task:research", nodeId: "research" }),
      expect.objectContaining({ taskId: "task:review", nodeId: "review" }),
    ]));
    expect(state.events.filter((event) => event.type === "task.completed")).toHaveLength(2);
    expect(state.topology.nodes.some((node) =>
      node.kind === "capability"
      && node.metadata.atomId === "subagent_delegate"
      && node.metadata.sourceNodeId === "research",
    )).toBe(true);
    expect(state.topology.nodes.some((node) =>
      node.kind === "capability"
      && node.metadata.atomId === "subagent_delegate"
      && node.metadata.sourceNodeId === "review",
    )).toBe(true);
  });

  it("runs the built-in single-agent preset without cloning a custom mode", async () => {
    const handle = createRuntimeMethodHandler(createTempStore());
    const run = await handle({
      jsonrpc: "2.0",
      id: 1,
      method: "runs.start",
      params: {
        input: { prompt: "Answer this directly." },
        config: { pattern: "orchestrator_subagent", modeId: "single_agent" }
      }
    }) as { runId: string; status: string };

    expect(run.status).toBe("succeeded");

    const state = StateSnapshotSchema.parse(await handle({
      jsonrpc: "2.0",
      id: 2,
      method: "runs.state",
      params: { runId: run.runId }
    }));

    expect(state.modeId).toBe("single_agent");
    expect(state.pattern).toBe("orchestrator_subagent");
    expect(state.profiles.map((profile) => profile.id)).toEqual(["solo_agent"]);
    expect(state.memory.some((record) => record.namespace.join(":").startsWith("session:local-project:single_agent"))).toBe(true);
    expect(state.output).toMatchObject({
      modeId: "single_agent",
      agent: {
        id: "solo_agent"
      }
    });
  });

  it("publishes runtime artifacts when a node enables the artifact_publish atom", async () => {
    const handle = createRuntimeMethodHandler(createTempStore());
    const cloned = await handle({
      jsonrpc: "2.0",
      id: 1,
      method: "modes.cloneFromPreset",
      params: {
        sourceModeId: "message_bus",
        modeId: "message-bus-artifact-custom",
        label: "Message Bus Artifact",
      },
    }) as any;

    await handle({
      jsonrpc: "2.0",
      id: 2,
      method: "modes.update",
      params: {
        modeId: cloned.id,
        spec: {
          ...cloned,
          summary: "Custom message bus artifact mode.",
          nodes: cloned.nodes.map((node) =>
            node.id === "handle"
              ? { ...node, config: { ...node.config, atoms: ["artifact_publish"] } }
              : node,
          ),
        },
      },
    });

    const run = await handle({
      jsonrpc: "2.0",
      id: 3,
      method: "runs.start",
      params: {
        input: { prompt: "Publish an artifact." },
        config: { modeId: cloned.id },
      },
    }) as { runId: string };

    const state = StateSnapshotSchema.parse(
      await handle({
        jsonrpc: "2.0",
        id: 4,
        method: "runs.state",
        params: { runId: run.runId },
      }),
    );

    expect(state.artifacts).toHaveLength(1);
    expect(state.artifacts[0]?.label).toContain("artifact");
    expect(state.events.some((event) => event.type === "artifact.exported")).toBe(true);
  });

  it("emits delegated task lifecycle events when a stage enables subagent_delegate", async () => {
    const handle = createRuntimeMethodHandler(createTempStore());
    const cloned = await handle({
      jsonrpc: "2.0",
      id: 1,
      method: "modes.cloneFromPreset",
      params: {
        sourceModeId: "orchestrator_subagent",
        modeId: "orchestrator-subagent-delegate-custom",
        label: "Orchestrator Delegate",
      },
    }) as any;

    await handle({
      jsonrpc: "2.0",
      id: 2,
      method: "modes.update",
      params: {
        modeId: cloned.id,
        spec: {
          ...cloned,
          summary: "Custom orchestrator mode with delegated stage lifecycle.",
          capabilityFlags: {
            ...cloned.capabilityFlags,
            toolIds: [...new Set([...(cloned.capabilityFlags?.toolIds ?? []), "model.handoff"])],
          },
          nodes: cloned.nodes.map((node) =>
            node.id === "research"
              ? { ...node, config: { ...node.config, atoms: ["subagent_delegate"] } }
              : node,
          ),
        },
      },
    });

    const run = await handle({
      jsonrpc: "2.0",
      id: 3,
      method: "runs.start",
      params: {
        input: { prompt: "Delegate the research stage." },
        config: { modeId: cloned.id },
      },
    }) as { runId: string };

    const state = StateSnapshotSchema.parse(
      await handle({
        jsonrpc: "2.0",
        id: 4,
        method: "runs.state",
        params: { runId: run.runId },
      }),
    );

    const eventTypes = state.events.map((event) => event.type);
    expect(eventTypes).toContain("task.started");
    expect(eventTypes).toContain("task.progress");
    expect(eventTypes).toContain("task.completed");
    expectOrderedEvents(eventTypes, [
      "task.started",
      "task.progress",
      "agent.started",
      "agent.completed",
      "task.completed",
    ]);
    const taskStarted = state.events.find((event) => event.type === "task.started");
    expect(taskStarted?.payload).toMatchObject({
      taskId: "task:research",
      nodeId: "research",
    });
    expect(
      state.topology.nodes.some((node) =>
        node.kind === "capability"
        && node.metadata.atomId === "subagent_delegate"
        && node.metadata.sourceNodeId === "research",
      ),
    ).toBe(true);
  });

  it("degrades provider failures into runtime state when tool_error_boundary is enabled", async () => {
    const handle = createRuntimeMethodHandler(createTempStore());
    const cloned = await handle({
      jsonrpc: "2.0",
      id: 1,
      method: "modes.cloneFromPreset",
      params: {
        sourceModeId: "orchestrator_subagent",
        modeId: "orchestrator-tool-boundary-custom",
        label: "Orchestrator Tool Boundary",
      },
    }) as any;

    await handle({
      jsonrpc: "2.0",
      id: 2,
      method: "modes.update",
      params: {
        modeId: cloned.id,
        spec: {
          ...cloned,
          summary: "Custom orchestrator mode that keeps going after provider failures.",
        },
      },
    });

    const run = await handle({
      jsonrpc: "2.0",
      id: 3,
      method: "runs.start",
      params: {
        input: { prompt: "Keep going after a provider failure." },
        config: {
          modeId: cloned.id,
          providerId: "missing-provider",
        },
      },
    }) as { runId: string; status: string };

    const state = StateSnapshotSchema.parse(
      await handle({
        jsonrpc: "2.0",
        id: 4,
        method: "runs.state",
        params: { runId: run.runId },
      }),
    );

    expect(run.status).toBe("succeeded");
    expect(state.status).toBe("succeeded");
    expect(state.events.map((event) => event.type)).toContain("run.done");
    expect(state.actions.some((action) => action.status === "failed")).toBe(true);
    expect(
      state.events.some((event) =>
        event.type === "tool.called" &&
        typeof (event.payload as Record<string, unknown>).status === "string" &&
        (event.payload as Record<string, unknown>).status === "failed",
      ),
    ).toBe(true);
    expect(state.output).toMatchObject({
      text: expect.stringContaining("[tool-error-boundary]"),
    });
  });

  it("retries transient provider failures before completing the run", async () => {
    const handle = createRuntimeMethodHandler(createTempStore());
    const previousFetch = globalThis.fetch;
    const previousKey = process.env.RETRY_PROVIDER_KEY;
    process.env.RETRY_PROVIDER_KEY = "test";
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      if (calls < 3) {
        return new Response("server busy", { status: 503 });
      }
      return new Response(JSON.stringify({
        choices: [{ message: { role: "assistant", content: "Recovered provider answer." } }],
      }), { status: 200 });
    }) as typeof fetch;

    try {
      const cloned = await handle({
        jsonrpc: "2.0",
        id: 1,
        method: "modes.cloneFromPreset",
        params: {
          sourceModeId: "orchestrator_subagent",
          modeId: "orchestrator-retry-provider",
          label: "Orchestrator Retry Provider",
        },
      }) as any;

      await handle({
        jsonrpc: "2.0",
        id: 2,
        method: "modes.update",
        params: {
          modeId: cloned.id,
          spec: {
            ...cloned,
            recoveryPolicy: {
              ...cloned.recoveryPolicy,
              defaults: {
                ...cloned.recoveryPolicy.defaults,
                backoffMs: 0,
                capDelayMs: 0,
              },
            },
          },
        },
      });

      const run = await handle({
        jsonrpc: "2.0",
        id: 3,
        method: "runs.start",
        params: {
          input: { prompt: "Retry transient provider errors." },
          config: {
            modeId: cloned.id,
            providerId: "retry-provider",
            providerConfig: {
              id: "retry-provider",
              label: "Retry Provider",
              type: "openai_compatible",
              modelId: "retry-chat",
              baseUrl: "https://example.test/v1",
              apiKeyEnv: "RETRY_PROVIDER_KEY",
              capabilities: ["chat"],
              headers: {},
            },
          },
        },
      }) as { runId: string; status: string };

      const state = StateSnapshotSchema.parse(
        await handle({
          jsonrpc: "2.0",
          id: 4,
          method: "runs.state",
          params: { runId: run.runId },
        }),
      );

      expect(calls).toBeGreaterThanOrEqual(3);
      expect(run.status).toBe("succeeded");
      expect(state.status).toBe("succeeded");
      expect(state.events.filter((event) => event.type === "recovery.retry_scheduled")).toHaveLength(2);
      expect(state.output).toMatchObject({
        text: expect.stringContaining("Recovered provider answer."),
      });
    } finally {
      globalThis.fetch = previousFetch;
      if (previousKey === undefined) {
        delete process.env.RETRY_PROVIDER_KEY;
      } else {
        process.env.RETRY_PROVIDER_KEY = previousKey;
      }
    }
  });

  it("fails the run when tool_error_boundary is removed from the mode", async () => {
    const handle = createRuntimeMethodHandler(createTempStore());
    const cloned = await handle({
      jsonrpc: "2.0",
      id: 1,
      method: "modes.cloneFromPreset",
      params: {
        sourceModeId: "orchestrator_subagent",
        modeId: "orchestrator-tool-boundary-disabled",
        label: "Orchestrator No Boundary",
      },
    }) as any;

    await handle({
      jsonrpc: "2.0",
      id: 2,
      method: "modes.update",
      params: {
        modeId: cloned.id,
        spec: {
          ...cloned,
          summary: "Custom orchestrator mode without the tool error boundary.",
          runtimeAtoms: cloned.runtimeAtoms.filter((atom: string) => atom !== "tool_error_boundary" && atom !== "recovery_policy"),
        },
      },
    });

    const run = await handle({
      jsonrpc: "2.0",
      id: 3,
      method: "runs.start",
      params: {
        input: { prompt: "Fail without the boundary." },
        config: {
          modeId: cloned.id,
          providerId: "missing-provider",
        },
      },
    }) as { runId: string; status: string };

    const state = StateSnapshotSchema.parse(
      await handle({
        jsonrpc: "2.0",
        id: 4,
        method: "runs.state",
        params: { runId: run.runId },
      }),
    );

    expect(run.status).toBe("failed");
    expect(state.status).toBe("failed");
    expect(state.events.map((event) => event.type)).toContain("run.failed");
    expect(state.checkpoints[0]?.label).toBe("Failed checkpoint");
    expect(state.events.map((event) => event.type)).not.toContain("run.done");
    expect(state.actions.some((action) => action.status === "failed")).toBe(true);
  });

  it("interrupts a run when clarification_interrupt hits an unanswered stage question", async () => {
    const handle = createRuntimeMethodHandler(createTempStore());
    const cloned = await handle({
      jsonrpc: "2.0",
      id: 1,
      method: "modes.cloneFromPreset",
      params: {
        sourceModeId: "orchestrator_subagent",
        modeId: "orchestrator-clarification-custom",
        label: "Orchestrator Clarification",
      },
    }) as any;

    await handle({
      jsonrpc: "2.0",
      id: 2,
      method: "modes.update",
      params: {
        modeId: cloned.id,
        spec: {
          ...cloned,
          summary: "Custom orchestrator mode with a clarification gate.",
          nodes: cloned.nodes.map((node) =>
            node.id === "research"
              ? {
                  ...node,
                  config: {
                    ...node.config,
                    clarificationQuestion: "Which repository or document should research prioritize?",
                  },
                }
              : node,
          ),
        },
      },
    });

    const run = await handle({
      jsonrpc: "2.0",
      id: 3,
      method: "runs.start",
      params: {
        input: { prompt: "Research this request." },
        config: { modeId: cloned.id },
      },
    }) as { runId: string; status: string };

    const state = StateSnapshotSchema.parse(
      await handle({
        jsonrpc: "2.0",
        id: 4,
        method: "runs.state",
        params: { runId: run.runId },
      }),
    );

    expect(run.status).toBe("interrupted");
    expect(state.status).toBe("interrupted");
    expect(state.checkpoints[0]?.label).toBe("Interrupted checkpoint");
    expect(state.pendingClarifications).toHaveLength(1);
    expect(state.pendingClarifications[0]).toMatchObject({
      nodeId: "research",
      key: "research",
    });
    expect(state.events.map((event) => event.type)).toContain("clarification.required");
    expectOrderedEvents(state.events.map((event) => event.type), [
      "agent.completed",
      "clarification.required",
      "run.interrupted",
    ]);
    expect(state.plan.find((item) => item.id.endsWith(":research"))?.status).toBe("blocked");
  });

  it("resolves pending clarifications on resume when answers are supplied", async () => {
    const handle = createRuntimeMethodHandler(createTempStore());
    const cloned = await handle({
      jsonrpc: "2.0",
      id: 1,
      method: "modes.cloneFromPreset",
      params: {
        sourceModeId: "orchestrator_subagent",
        modeId: "orchestrator-clarification-resume",
        label: "Orchestrator Clarification Resume",
      },
    }) as any;

    await handle({
      jsonrpc: "2.0",
      id: 2,
      method: "modes.update",
      params: {
        modeId: cloned.id,
        spec: {
          ...cloned,
          summary: "Custom orchestrator mode that resumes from clarification.",
          nodes: cloned.nodes.map((node) =>
            node.id === "research"
              ? {
                  ...node,
                  config: {
                    ...node.config,
                    clarificationQuestion: "What scope should research use?",
                  },
                }
              : node,
          ),
        },
      },
    });

    const run = await handle({
      jsonrpc: "2.0",
      id: 3,
      method: "runs.start",
      params: {
        input: { prompt: "Resume after clarification." },
        config: { modeId: cloned.id },
      },
    }) as { runId: string };

    const resumed = StateSnapshotSchema.parse(
      await handle({
        jsonrpc: "2.0",
        id: 4,
        method: "runs.resume",
        params: {
          runId: run.runId,
          patch: {
            clarifications: {
              research: "Focus on the harness package first.",
            },
          },
        },
      }),
    );

    expect(resumed.status).toBe("succeeded");
    expect(resumed.pendingClarifications).toEqual([]);
    expect(resumed.events.map((event) => event.type)).toContain("clarification.resolved");
    expect(resumed.input.context.clarifications).toMatchObject({
      research: "Focus on the harness package first.",
    });
    expect(resumed.output).toMatchObject({
      text: expect.stringContaining("[local-smoke]"),
      pattern: "orchestrator_subagent",
    });
  });

  it("starts all five coordination patterns through the unified runtime kernel", async () => {
    const handle = createRuntimeMethodHandler(createTempStore());
    const patterns = [
      "generator_verifier",
      "orchestrator_subagent",
      "agent_teams",
      "message_bus",
      "shared_state"
    ] as const;

    for (const pattern of patterns) {
      const run = (await handle({
        jsonrpc: "2.0",
        id: `${pattern}-start`,
        method: "runs.start",
        params: {
          input: { prompt: `Smoke ${pattern}.` },
          config: { pattern }
        }
      })) as { runId: string; status: string; pattern: string };
      const state = StateSnapshotSchema.parse(
        await handle({
          jsonrpc: "2.0",
          id: `${pattern}-state`,
          method: "runs.state",
          params: { runId: run.runId }
        })
      );

      expect(run.status).toBe("succeeded");
      expect(run.pattern).toBe(pattern);
      expect(state.status).toBe("succeeded");
      expect(state.pattern).toBe(pattern);
      expect(state.checkpoints).toHaveLength(1);
      expect(state.events.map((event) => event.type)).toContain("checkpoint.created");

      if (pattern === "agent_teams") {
        expect(state.events.map((event) => event.type)).toContain("worker.claimed");
        expect(state.events.map((event) => event.type)).toContain("worker.released");
        expect(state.memory.some((record) => record.kind === "worker")).toBe(true);
      }

      if (pattern === "message_bus") {
        expect(state.busStats.enabled).toBe(true);
        expect(state.busStats.publishedCount).toBeGreaterThan(0);
        expect(state.busStats.routedCount).toBeGreaterThan(0);
        expect(state.queueSummary.topics).toContain("task.response");
      }

      if (pattern === "shared_state") {
        expect(state.sharedStateSummary.enabled).toBe(true);
        expect(state.sharedStateSummary.version).toBeGreaterThan(0);
        expect(state.sharedStateSummary.entries.length).toBeGreaterThan(0);
      }
    }
  });

  it("lists checkpoints and exports a report for a run", async () => {
    const handle = createRuntimeMethodHandler(createTempStore());
    const run = (await handle({
      jsonrpc: "2.0",
      id: 1,
      method: "runs.start",
      params: {
        input: { prompt: "Export report." },
        config: { pattern: "agent_teams" }
      }
    })) as { runId: string };

    const checkpoints = (await handle({
      jsonrpc: "2.0",
      id: 2,
      method: "runs.checkpoints",
      params: { runId: run.runId }
    })) as unknown[];

    const report = (await handle({
      jsonrpc: "2.0",
      id: 3,
      method: "runs.exportReport",
      params: { runId: run.runId }
    })) as { kind: string; uri: string; payload: { eventCount: number } };

    const state = StateSnapshotSchema.parse(
      await handle({
        jsonrpc: "2.0",
        id: 4,
        method: "runs.state",
        params: { runId: run.runId }
      })
    );

    expect(checkpoints).toHaveLength(1);
    expect(report.kind).toBe("report");
    expect(report.uri).toMatch(/^file:\/\//);
    expect(report.payload.eventCount).toBe(state.events.length - 1);
    expect(state.artifacts).toHaveLength(1);
    expect(state.events.at(-1)?.type).toBe("artifact.exported");
  });

  it("persists runs and artifact refs across store instances", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ora-runtime-persist-test-"));
    const firstStore = new LocalRunStore({ dataDir });
    const handleFirst = createRuntimeMethodHandler(firstStore);
    const run = (await handleFirst({
      jsonrpc: "2.0",
      id: 1,
      method: "runs.start",
      params: {
        input: { prompt: "Persist this run." },
        config: { pattern: "orchestrator_subagent" }
      }
    })) as { runId: string };

    await handleFirst({
      jsonrpc: "2.0",
      id: 2,
      method: "runs.exportReport",
      params: { runId: run.runId }
    });

    const handleSecond = createRuntimeMethodHandler(new LocalRunStore({ dataDir }));
    const runs = (await handleSecond({
      jsonrpc: "2.0",
      id: 3,
      method: "runs.list"
    })) as { runId: string; artifactCount: number }[];
    const state = StateSnapshotSchema.parse(
      await handleSecond({
        jsonrpc: "2.0",
        id: 4,
        method: "runs.state",
        params: { runId: run.runId }
      })
    );

    expect(runs.map((summary) => summary.runId)).toContain(run.runId);
    expect(runs.find((summary) => summary.runId === run.runId)?.artifactCount).toBe(1);
    expect(state.artifacts[0]?.uri).toMatch(/^file:\/\//);
  });

  it("returns ordered event streams after an optional sequence", async () => {
    const handle = createRuntimeMethodHandler(createTempStore());
    const run = (await handle({
      jsonrpc: "2.0",
      id: 1,
      method: "runs.start",
      params: {
        input: { prompt: "Stream from the middle." },
        config: { pattern: "generator_verifier" }
      }
    })) as { runId: string };

    const stream = (await handle({
      jsonrpc: "2.0",
      id: 2,
      method: "runs.stream",
      params: { runId: run.runId, afterSeq: 2 }
    })) as { fromSeq: number; nextSeq: number; events: { seq: number; type: string }[] };
    const state = StateSnapshotSchema.parse(
      await handle({
        jsonrpc: "2.0",
        id: 3,
        method: "runs.state",
        params: { runId: run.runId }
      })
    );
    const expectedEvents = state.events.filter((event) => event.seq >= 3);

    expect(stream.fromSeq).toBe(3);
    expect(stream.nextSeq).toBe(state.events.length);
    expect(stream.events).toEqual(expectedEvents);
  });

  it("starts a streaming run and publishes incremental message events before final state", async () => {
    const streams: Array<{ status?: string; events: Array<{ type: string; payload: unknown }>; snapshot?: unknown }> = [];
    const handle = createRuntimeMethodHandler(createTempStore(), undefined, {
      onRunStream(stream) {
        streams.push(stream);
      },
    });
    const run = (await handle({
      jsonrpc: "2.0",
      id: 1,
      method: "runs.startStreaming",
      params: {
        input: { prompt: "Stream local smoke output." },
        config: { pattern: "orchestrator_subagent" },
      },
    })) as { runId: string; status: string };

    expect(run.status).toBe("running");
    await waitFor(() => streams.some((stream) => stream.status === "succeeded" || stream.snapshot !== undefined));

    const deltaEvents = streams.flatMap((stream) => stream.events).filter((event) => event.type === "message.delta");
    expect(deltaEvents.length).toBeGreaterThan(1);
    expect(deltaEvents.some((event) => typeof (event.payload as { delta?: unknown }).delta === "string")).toBe(true);

    const state = StateSnapshotSchema.parse(await handle({
      jsonrpc: "2.0",
      id: 2,
      method: "runs.state",
      params: { runId: run.runId },
    }));
    expect(state.status).toBe("succeeded");
    expect(state.events.some((event) => event.type === "run.done")).toBe(true);
  });

  it("executes OpenAI-compatible native tool calls during streaming runs", async () => {
    const streams: Array<{ status?: string; events: Array<{ type: string; payload: unknown }>; snapshot?: unknown }> = [];
    const handle = createRuntimeMethodHandler(createTempStore(), undefined, {
      onRunStream(stream) {
        streams.push(stream);
      },
    });
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ora-stream-native-tool-"));
    fs.writeFileSync(path.join(workspaceRoot, "README.md"), "Streaming native tool result\n", "utf8");
    const previousFetch = globalThis.fetch;
    const previousKey = process.env.STREAM_NATIVE_TOOL_KEY;
    process.env.STREAM_NATIVE_TOOL_KEY = "test";
    let providerCalls = 0;
    const providerRequestBodies: unknown[] = [];
    globalThis.fetch = (async (_input, init) => {
      providerCalls += 1;
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        stream?: boolean;
        tools?: unknown[];
        messages?: Array<{ role: string; tool_call_id?: string; content?: string }>;
      };
      providerRequestBodies.push(body);
      expect(body.stream).toBe(true);
      expect(body.tools?.length).toBeGreaterThan(0);

      if (providerCalls === 1) {
        return new Response([
          "data: {\"choices\":[{\"delta\":{\"reasoning_content\":\"I need to inspect README before answering.\"}}]}\n\n",
          "data: {\"choices\":[{\"delta\":{\"content\":\"好的，我先查看。\"}}]}\n\n",
          "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call-readme\",\"type\":\"function\",\"function\":{\"name\":\"file__read\",\"arguments\":\"{\\\"path\\\":\"}}]}}]}\n\n",
          "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"function\":{\"arguments\":\"\\\"README.md\\\"}\"}}]},\"finish_reason\":\"tool_calls\"}]}\n\n",
          "data: [DONE]\n\n",
        ].join(""), { status: 200, headers: { "content-type": "text/event-stream" } });
      }

      return new Response([
        "data: {\"choices\":[{\"delta\":{\"content\":\"Read README through streaming native tool.\"}}]}\n\n",
        "data: [DONE]\n\n",
      ].join(""), { status: 200, headers: { "content-type": "text/event-stream" } });
    }) as typeof fetch;

    try {
      const run = (await handle({
        jsonrpc: "2.0",
        id: 1,
        method: "runs.startStreaming",
        params: {
          input: {
            prompt: "Read the README.",
            context: {
              projectWorkspace: { label: "Streaming Native Tool Workspace", rootPath: workspaceRoot },
            },
          },
          config: {
            modeId: "single_agent",
            providerId: "stream-native-tool",
            modelRef: "stream-native-tool-model",
            providerConfig: {
              id: "stream-native-tool",
              label: "Streaming Native Tool",
              type: "openai_compatible",
              modelId: "stream-native-tool-model",
              baseUrl: "https://stream-native-tool.test/v1",
              apiKeyEnv: "STREAM_NATIVE_TOOL_KEY",
              capabilities: ["chat", "tool_use"],
              headers: {},
            },
            toolIds: ["file.read"],
          },
        },
      })) as { runId: string; status: string };

      expect(run.status).toBe("running");
      await waitFor(() => streams.some((stream) => stream.status === "succeeded" || stream.snapshot !== undefined));

      const state = StateSnapshotSchema.parse(await handle({
        jsonrpc: "2.0",
        id: 2,
        method: "runs.state",
        params: { runId: run.runId },
      }));

      expect(providerCalls).toBeGreaterThanOrEqual(2);
      expect(providerRequestBodies.some((body) =>
        JSON.stringify(body).includes("call-readme")
        && JSON.stringify(body).includes("I need to inspect README before answering.")
      )).toBe(true);
      expect(state.toolCalls).toEqual([
        expect.objectContaining({
          providerCallId: "call-readme",
          toolId: "file.read",
          source: "provider_native",
          status: "succeeded",
        }),
      ]);
      expect(state.output).toMatchObject({ text: expect.stringContaining("Read README through streaming native tool.") });
    } finally {
      globalThis.fetch = previousFetch;
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
      if (previousKey === undefined) {
        delete process.env.STREAM_NATIVE_TOOL_KEY;
      } else {
        process.env.STREAM_NATIVE_TOOL_KEY = previousKey;
      }
    }
  });

  it("resumes an interrupted run with an Ora-owned transition event", async () => {
    const handle = createRuntimeMethodHandler(createTempStore());
    const run = (await handle({
      jsonrpc: "2.0",
      id: 1,
      method: "runs.start",
      params: {
        input: { prompt: "Resume this local run." },
        config: { pattern: "orchestrator_subagent" }
      }
    })) as { runId: string };

    const interrupted = StateSnapshotSchema.parse(
      await handle({
        jsonrpc: "2.0",
        id: 2,
        method: "runs.interrupt",
        params: { runId: run.runId, reason: "Test pause." }
      })
    );
    const resumed = StateSnapshotSchema.parse(
      await handle({
        jsonrpc: "2.0",
        id: 3,
        method: "runs.resume",
        params: { runId: run.runId, patch: { approved: true } }
      })
    );

    expect(interrupted.status).toBe("interrupted");
    expect(resumed.status).toBe("succeeded");
    expect(resumed.events.slice(-3).map((event) => event.type)).toEqual([
      "run.resumed",
      "checkpoint.created",
      "run.done"
    ]);
    expect(resumed.checkpoints).toHaveLength(2);
  });

  it("pauses manual high-risk actions until resume approves the action", async () => {
    const handle = createRuntimeMethodHandler(createTempStore());
    const run = (await handle({
      jsonrpc: "2.0",
      id: 1,
      method: "runs.start",
      params: {
        input: { prompt: "Require human approval." },
        config: {
          pattern: "orchestrator_subagent",
          metadata: { approvalMode: "manual" }
        }
      }
    })) as { runId: string; status: string };

    const blocked = StateSnapshotSchema.parse(
      await handle({
        jsonrpc: "2.0",
        id: 2,
        method: "runs.state",
        params: { runId: run.runId }
      })
    );
    const resumed = StateSnapshotSchema.parse(
      await handle({
        jsonrpc: "2.0",
        id: 3,
        method: "runs.resume",
        params: { runId: run.runId, patch: { approvedActionIds: [blocked.actions[0]?.id] } }
      })
    );

    expect(run.status).toBe("interrupted");
    expect(blocked.actions[0]?.status).toBe("approval_required");
    expect(blocked.pendingApprovals).toEqual([blocked.actions[0]!.id]);
    expect(blocked.events.map((event) => event.type)).toContain("approval.required");
    expect(blocked.todos.every((todo) => todo.status === "blocked")).toBe(true);
    expect(resumed.actions.every((action) => action.status === "succeeded")).toBe(true);
    expect(resumed.memory.length).toBeGreaterThan(0);
    expect(
      resumed.memory.some((record) => record.namespace.join(":").includes("orchestrator_subagent")),
    ).toBe(true);
    expect(resumed.events.map((event) => event.type)).toContain("approval.resolved");
    expect(resumed.events.map((event) => event.type)).toContain("todo.updated");
    expect(resumed.todos.every((todo) => todo.status === "done")).toBe(true);
    expect(resumed.output).toMatchObject({
      text: expect.stringContaining("[local-smoke]"),
      pattern: "orchestrator_subagent",
      orchestrator: {
        plan: expect.stringContaining("[local-smoke]"),
      },
    });
  });

  it("forks a run from a checkpoint without exposing engine internals", async () => {
    const handle = createRuntimeMethodHandler(createTempStore());
    const run = (await handle({
      jsonrpc: "2.0",
      id: 1,
      method: "runs.start",
      params: {
        input: { prompt: "Fork this checkpoint." },
        config: { pattern: "agent_teams" }
      }
    })) as { runId: string };
    const source = StateSnapshotSchema.parse(
      await handle({
        jsonrpc: "2.0",
        id: 2,
        method: "runs.state",
        params: { runId: run.runId }
      })
    );

    const fork = (await handle({
      jsonrpc: "2.0",
      id: 3,
      method: "runs.fork",
      params: {
        runId: run.runId,
        checkpointId: source.checkpoints[0]?.id,
        input: { prompt: "Forked task." }
      }
    })) as { runId: string; pattern: string; status: string };
    const forkState = StateSnapshotSchema.parse(
      await handle({
        jsonrpc: "2.0",
        id: 4,
        method: "runs.state",
        params: { runId: fork.runId }
      })
    );

    expect(fork.runId).not.toBe(run.runId);
    expect(fork.pattern).toBe("agent_teams");
    expect(fork.status).toBe("succeeded");
    expect(forkState.events.map((event) => event.type)).toContain("run.forked");
    expect(forkState.config.metadata.forkedFromRunId).toBe(run.runId);
  });

  it("replays events through a checkpoint and records the replay request", async () => {
    const handle = createRuntimeMethodHandler(createTempStore());
    const run = (await handle({
      jsonrpc: "2.0",
      id: 1,
      method: "runs.start",
      params: {
        input: { prompt: "Replay this checkpoint." },
        config: { pattern: "generator_verifier" }
      }
    })) as { runId: string };
    const source = StateSnapshotSchema.parse(
      await handle({
        jsonrpc: "2.0",
        id: 2,
        method: "runs.state",
        params: { runId: run.runId }
      })
    );

    const replay = (await handle({
      jsonrpc: "2.0",
      id: 3,
      method: "runs.replay",
      params: {
        runId: run.runId,
        checkpointId: source.checkpoints[0]?.id
      }
    })) as { events: { seq: number; type: string }[]; nextSeq: number };
    const replayedState = StateSnapshotSchema.parse(
      await handle({
        jsonrpc: "2.0",
        id: 4,
        method: "runs.state",
        params: { runId: run.runId }
      })
    );

    expect(replay.events.at(-1)?.type).toBe("checkpoint.created");
    expect(replay.events.map((event) => event.seq)).toEqual([...Array(replay.events.length).keys()]);
    expect(replay.events.length).toBe(source.checkpoints[0]!.eventSeq + 1);
    expect(replay.nextSeq).toBe(replayedState.events.length);
    expect(replayedState.events.at(-1)?.type).toBe("run.replayed");
  });
});
