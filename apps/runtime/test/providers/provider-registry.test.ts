import { describe, expect, it, vi } from "vitest";
import { createDefaultProviderRegistry, createModelProvider, createProviderRegistry, fetchProviderModels, invokeRunProvider, verifyProviderConfig } from "../../src/providers/index.js";

describe("provider adapters", () => {
  it("builds a deterministic local smoke response", async () => {
    const provider = createModelProvider({
      id: "local-smoke",
      type: "local_smoke",
      label: "Smoke",
      modelId: "smoke-model",
      maxTokens: 64,
      headers: {},
    });

    const response = await provider({
      prompt: "  Build a small local smoke path.  ",
      system: "  Keep this deterministic.  ",
    });

    expect(response.providerId).toBe("local-smoke");
    expect(response.providerType).toBe("local_smoke");
    expect(response.modelId).toBe("smoke-model");
    expect(response.text).toContain("prompt=Build a small local smoke path.");
    expect(response.text).toContain("instructions=Keep this deterministic.");
  });

  it("streams local smoke responses as cumulative text deltas", async () => {
    const provider = createModelProvider({
      id: "local-smoke",
      type: "local_smoke",
      label: "Smoke",
      modelId: "smoke-model",
      headers: {},
    });
    const chunks: Array<{ delta: string; text: string }> = [];

    const response = await provider.stream?.(
      { prompt: "Stream a small answer." },
      { onTextDelta: (chunk) => { chunks.push({ delta: chunk.delta, text: chunk.text }); } },
    );

    expect(response?.text).toContain("Stream a small answer.");
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.at(-1)?.text).toBe(response?.text);
    expect(chunks.every((chunk) => chunk.text.endsWith(chunk.delta) || chunk.delta.trim().length > 0)).toBe(true);
  });

  it("lists local smoke models through the unified discovery path", async () => {
    const result = await fetchProviderModels({
      id: "local-smoke",
      type: "local_smoke",
      label: "Smoke",
      modelId: "smoke-model",
      headers: {},
    });

    expect(result).toMatchObject({
      status: "ok",
      authoritative: true,
      models: [{ id: "smoke-model", source: "local" }],
    });
  });

  it("fetches provider models before verify smoke calls and blocks missing authoritative models", async () => {
    const calls: string[] = [];
    const provider = {
      id: "openrouter",
      type: "openai_compatible" as const,
      label: "OpenRouter",
      modelId: "missing-model",
      baseUrl: "https://openrouter.ai/api/v1",
      apiKeyEnv: "OPENROUTER_API_KEY",
      protocol: "chat_completions" as const,
      headers: {},
    };
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      calls.push(String(input));
      return new Response(JSON.stringify({ data: [{ id: "listed-model" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const status = await verifyProviderConfig(provider, {
      env: { OPENROUTER_API_KEY: "test-key" },
      fetchImpl,
    });

    expect(status.state).toBe("failed");
    expect(status.detail).toContain("was not found in provider model list");
    expect(calls).toEqual(["https://openrouter.ai/api/v1/models"]);
  });

  it("runs verify smoke call after an authoritative model list contains the model", async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      calls.push(String(input));
      if (String(input).endsWith("/models")) {
        return new Response(JSON.stringify({ data: [{ id: "listed-model" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: "OK" } }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const status = await verifyProviderConfig({
      id: "openrouter",
      type: "openai_compatible",
      label: "OpenRouter",
      modelId: "listed-model",
      baseUrl: "https://openrouter.ai/api/v1",
      apiKeyEnv: "OPENROUTER_API_KEY",
      protocol: "chat_completions",
      headers: {},
    }, {
      env: { OPENROUTER_API_KEY: "test-key" },
      fetchImpl,
    });

    expect(status.state).toBe("verified");
    expect(calls).toEqual([
      "https://openrouter.ai/api/v1/models",
      "https://openrouter.ai/api/v1/chat/completions",
    ]);
  });

  it("continues verify smoke call when compatible model discovery is unsupported", async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      calls.push(String(input));
      if (String(input).endsWith("/models")) {
        return new Response("not found", { status: 404 });
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: "OK" } }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const status = await verifyProviderConfig({
      id: "openrouter",
      type: "openai_compatible",
      label: "OpenRouter",
      modelId: "custom-model",
      baseUrl: "https://openrouter.ai/api/v1",
      apiKeyEnv: "OPENROUTER_API_KEY",
      protocol: "chat_completions",
      headers: {},
    }, {
      env: { OPENROUTER_API_KEY: "test-key" },
      fetchImpl,
    });

    expect(status.state).toBe("verified");
    expect(status.detail).toContain("Model discovery is not supported");
    expect(calls).toEqual([
      "https://openrouter.ai/api/v1/models",
      "https://openrouter.ai/api/v1/chat/completions",
    ]);
  });

  it("fails verify before smoke call when model discovery returns an error", async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      calls.push(String(input));
      return new Response("bad key", { status: 401 });
    });

    const status = await verifyProviderConfig({
      id: "openrouter",
      type: "openai_compatible",
      label: "OpenRouter",
      modelId: "custom-model",
      baseUrl: "https://openrouter.ai/api/v1",
      apiKeyEnv: "OPENROUTER_API_KEY",
      protocol: "chat_completions",
      headers: {},
    }, {
      env: { OPENROUTER_API_KEY: "test-key" },
      fetchImpl,
    });

    expect(status.state).toBe("failed");
    expect(status.detail).toContain("Failed to fetch provider model list");
    expect(calls).toEqual(["https://openrouter.ai/api/v1/models"]);
  });

  it("uses DeepSeek's real compatible model list endpoint", async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      calls.push(String(input));
      return new Response(JSON.stringify({ data: [{ id: "deepseek-chat" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const result = await fetchProviderModels({
      id: "deepseek",
      type: "openai_compatible",
      label: "DeepSeek",
      modelId: "deepseek-chat",
      baseUrl: "https://api.deepseek.com",
      apiKeyEnv: "DEEPSEEK_API_KEY",
      protocol: "chat_completions",
      headers: {},
    }, {
      env: { DEEPSEEK_API_KEY: "test-key" },
      fetchImpl,
    });

    expect(result.status).toBe("ok");
    expect(result.models).toEqual([{ id: "deepseek-chat", source: "remote" }]);
    expect(calls).toEqual(["https://api.deepseek.com/models"]);
  });

  it("uses AiHubMix's catalog endpoint and parses model_id fields", async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      calls.push(String(input));
      return new Response(JSON.stringify({
        data: [{ model_id: "gpt-5.2", display_name: "GPT 5.2", provider: "openai" }],
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const result = await fetchProviderModels({
      id: "aihubmix",
      type: "openai_compatible",
      label: "AiHubMix",
      modelId: "gpt-5.2",
      baseUrl: "https://aihubmix.com/v1",
      apiKeyEnv: "AIHUBMIX_API_KEY",
      protocol: "chat_completions",
      headers: {},
    }, {
      env: { AIHUBMIX_API_KEY: "test-key" },
      fetchImpl,
    });

    expect(result.status).toBe("ok");
    expect(result.models).toEqual([{
      id: "gpt-5.2",
      name: "GPT 5.2",
      ownedBy: "openai",
      source: "remote",
    }]);
    expect(calls).toEqual(["https://aihubmix.com/api/v1/models?type=llm"]);
  });

  it("does not insert an extra /v1 for versioned compatible base URLs", async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      calls.push(String(input));
      if (String(input).endsWith("/models")) {
        return new Response(JSON.stringify({ data: [{ id: "glm-5" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: "OK" } }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const status = await verifyProviderConfig({
      id: "zai-coding-plan",
      type: "openai_compatible",
      label: "Z.AI Coding Plan",
      modelId: "glm-5",
      baseUrl: "https://api.z.ai/api/coding/paas/v4",
      apiKeyEnv: "ZAI_API_KEY",
      protocol: "chat_completions",
      headers: {},
    }, {
      env: { ZAI_API_KEY: "test-key" },
      fetchImpl,
    });

    expect(status.state).toBe("verified");
    expect(calls).toEqual([
      "https://api.z.ai/api/coding/paas/v4/models",
      "https://api.z.ai/api/coding/paas/v4/chat/completions",
    ]);
  });

  it("keeps Gemini OpenAI-compatible model discovery under /v1beta/openai", async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      calls.push(String(input));
      return new Response(JSON.stringify({ data: [{ id: "gemini-2.5-flash" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const result = await fetchProviderModels({
      id: "google-gemini",
      type: "openai_compatible",
      label: "Google Gemini",
      modelId: "gemini-2.5-flash",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
      apiKeyEnv: "GEMINI_API_KEY",
      protocol: "chat_completions",
      headers: {},
    }, {
      env: { GEMINI_API_KEY: "test-key" },
      fetchImpl,
    });

    expect(result.status).toBe("ok");
    expect(calls).toEqual(["https://generativelanguage.googleapis.com/v1beta/openai/models"]);
  });

  it("sends an OpenAI Responses API request and parses output_text", async () => {
    const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe("Bearer test-openai-key");
      expect(headers.get("content-type")).toBe("application/json");

      const body = JSON.parse(String(init?.body)) as {
        model: string;
        input: Array<{ role: string }>;
        max_output_tokens?: number;
        temperature?: number;
      };

      expect(body.model).toBe("gpt-test");
      expect(body.max_output_tokens).toBe(42);
      expect(body.temperature).toBe(0.4);
      expect(body.input[0]?.role).toBe("developer");
      expect(body.input[1]?.role).toBe("user");

      return new Response(JSON.stringify({ output_text: "OpenAI says hello." }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const provider = createModelProvider(
      {
        id: "openai-gpt",
        type: "openai",
        label: "GPT",
        modelId: "gpt-test",
        maxTokens: 42,
        temperature: 0.4,
        headers: {},
      },
      {
        env: { OPENAI_API_KEY: "test-openai-key" },
        fetchImpl,
      }
    );

    const response = await provider({
      prompt: "Say hello.",
      system: "Follow instructions.",
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(response.text).toBe("OpenAI says hello.");
    expect(response.raw).toMatchObject({ output_text: "OpenAI says hello." });
  });

  it("normalizes OpenAI Responses token usage", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      output_text: "OpenAI says hello.",
      usage: {
        input_tokens: 12,
        output_tokens: 5,
        total_tokens: 17,
        output_tokens_details: { reasoning_tokens: 2 },
      },
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));

    const provider = createModelProvider(
      {
        id: "openai-gpt",
        type: "openai",
        label: "GPT",
        modelId: "gpt-test",
        headers: {},
      },
      {
        env: { OPENAI_API_KEY: "test-openai-key" },
        fetchImpl,
      }
    );

    const response = await provider({ prompt: "Say hello." });

    expect(response.usage).toEqual({
      inputTokens: 12,
      outputTokens: 5,
      reasoningTokens: 2,
      totalTokens: 17,
      source: "provider",
    });
  });

  it("parses OpenAI Responses API streaming text deltas", async () => {
    const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { stream?: boolean };
      expect(body.stream).toBe(true);
      return new Response([
        "data: {\"type\":\"response.output_text.delta\",\"delta\":\"Hel\"}\n\n",
        "data: {\"type\":\"response.output_text.delta\",\"delta\":\"lo\"}\n\n",
        "data: [DONE]\n\n",
      ].join(""), {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    });
    const provider = createModelProvider(
      {
        id: "openai-gpt",
        type: "openai",
        label: "GPT",
        modelId: "gpt-test",
        headers: {},
      },
      { env: { OPENAI_API_KEY: "test-openai-key" }, fetchImpl },
    );
    const chunks: string[] = [];

    const response = await provider.stream?.(
      { prompt: "Say hello." },
      { onTextDelta: (chunk) => { chunks.push(chunk.delta); } },
    );

    expect(response?.text).toBe("Hello");
    expect(chunks).toEqual(["Hel", "lo"]);
    expect(response?.raw).toMatchObject({ streamMode: "sse", eventCount: 2 });
    expect(response?.raw).not.toHaveProperty("events");
  });

  it("treats SSE [DONE] as terminal even when the connection remains open", async () => {
    let cancelled = false;
    const encoder = new TextEncoder();
    const fetchImpl = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode([
            "data: {\"type\":\"response.output_text.delta\",\"delta\":\"Done\"}\n\n",
            "data: [DONE]\n\n",
          ].join("")));
        },
        cancel() {
          cancelled = true;
        },
      });
      return new Response(body, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    });
    const provider = createModelProvider(
      {
        id: "openai-gpt",
        type: "openai",
        label: "GPT",
        modelId: "gpt-test",
        headers: {},
      },
      { env: { OPENAI_API_KEY: "test-openai-key" }, fetchImpl },
    );

    const response = await provider.stream?.({ prompt: "Say done." });

    expect(response?.text).toBe("Done");
    expect(cancelled).toBe(true);
  });

  it("sends an OpenAI-compatible chat completions request", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe("https://openrouter.ai/api/v1/chat/completions");

      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe("Bearer test-openrouter-key");
      expect(headers.get("content-type")).toBe("application/json");

      const body = JSON.parse(String(init?.body)) as {
        model: string;
        messages: Array<{ role: string; content: string }>;
        max_tokens?: number;
        temperature?: number;
      };

      expect(body.model).toBe("anthropic/claude-sonnet-4.5");
      expect(body.max_tokens).toBe(128);
      expect(body.temperature).toBeUndefined();
      expect(body.messages).toEqual([
        { role: "system", content: "Stay brief." },
        { role: "user", content: "Say hello." },
      ]);

      return new Response(JSON.stringify({
        choices: [{ message: { content: "Compatible hello." } }],
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const provider = createModelProvider(
      {
        id: "openrouter",
        type: "openai_compatible",
        label: "OpenRouter",
        modelId: "anthropic/claude-sonnet-4.5",
        baseUrl: "https://openrouter.ai/api/v1",
        apiKeyEnv: "OPENROUTER_API_KEY",
        maxTokens: 128,
        temperature: 0.2,
        dropParams: ["temperature"],
        headers: {},
      },
      {
        env: { OPENROUTER_API_KEY: "test-openrouter-key" },
        fetchImpl,
      }
    );

    const response = await provider({
      prompt: "Say hello.",
      system: "Stay brief.",
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(response.providerType).toBe("openai_compatible");
    expect(response.text).toBe("Compatible hello.");
  });

  it("maps OpenAI-compatible chat tool calls", async () => {
    const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        tools?: Array<{ type: string; function: { name: string } }>;
        tool_choice?: string;
      };
      expect(body.tools?.[0]).toMatchObject({
        type: "function",
        function: { name: "web__search" },
      });
      expect(body.tool_choice).toBe("auto");

      return new Response(JSON.stringify({
        choices: [{
          finish_reason: "tool_calls",
          message: {
            content: null,
            reasoning_content: "I should search before answering.",
            tool_calls: [{
              id: "call-1",
              type: "function",
              function: {
                name: "web__search",
                arguments: "{\"query\":\"Ora\"}",
              },
            }],
          },
        }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    });

    const provider = createModelProvider(
      {
        id: "openrouter",
        type: "openai_compatible",
        label: "OpenRouter",
        modelId: "tool-model",
        baseUrl: "https://openrouter.ai/api/v1",
        apiKeyEnv: "OPENROUTER_API_KEY",
        headers: {},
      },
      { env: { OPENROUTER_API_KEY: "test-openrouter-key" }, fetchImpl },
    );

    const response = await provider({
      prompt: "Search.",
      tools: [{ id: "web.search", description: "Search web" }],
      toolChoice: "auto",
    });

    expect(response.toolCalls).toEqual([
      expect.objectContaining({ id: "call-1", toolId: "web.search", args: { query: "Ora" } }),
    ]);
    expect(response.reasoningContent).toBe("I should search before answering.");
    expect(response.finishReason).toBe("tool_calls");
  });

  it("emits deterministic provider tool schema ordering", async () => {
    const requestBodies: unknown[] = [];
    const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      requestBodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({
        choices: [{ message: { content: "Sorted." } }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    });

    const provider = createModelProvider(
      {
        id: "openrouter",
        type: "openai_compatible",
        label: "OpenRouter",
        modelId: "tool-model",
        baseUrl: "https://openrouter.ai/api/v1",
        apiKeyEnv: "OPENROUTER_API_KEY",
        headers: {},
      },
      { env: { OPENROUTER_API_KEY: "test-openrouter-key" }, fetchImpl },
    );

    const tools = [
      {
        id: "web.search",
        description: "Search web",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string" },
            limit: { type: "number" },
          },
        },
      },
      { id: "file.read", description: "Read file" },
    ];

    await provider({ prompt: "Use tools.", tools });
    await provider({ prompt: "Use tools.", tools: [...tools].reverse() });

    const toolNames = requestBodies.map((body) =>
      (body as { tools: Array<{ function: { name: string; parameters: unknown } }> }).tools
        .map((tool) => tool.function.name),
    );
    expect(toolNames).toEqual([
      ["file__read", "web__search"],
      ["file__read", "web__search"],
    ]);
    expect(JSON.stringify((requestBodies[0] as { tools: unknown[] }).tools)).toBe(
      JSON.stringify((requestBodies[1] as { tools: unknown[] }).tools),
    );
  });

  it("applies OpenAI-compatible reasoning effort when requested", async () => {
    const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        reasoning_effort?: string;
      };
      expect(body.reasoning_effort).toBe("high");

      return new Response(JSON.stringify({
        choices: [{ message: { content: "Reasoned answer." } }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    });

    const provider = createModelProvider(
      {
        id: "reasoning-openai",
        type: "openai_compatible",
        label: "Reasoning OpenAI",
        modelId: "reasoning-model",
        baseUrl: "https://reasoning.test/v1",
        apiKeyEnv: "REASONING_KEY",
        capabilities: ["chat", "reasoning"],
        headers: {},
      },
      { env: { REASONING_KEY: "test" }, fetchImpl },
    );

    const response = await provider({
      prompt: "Think deeply.",
      reasoningEffort: "high",
    });

    expect(response.text).toBe("Reasoned answer.");
  });

  it("passes reasoning_content back with OpenAI-compatible chat tool call history", async () => {
    const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        messages: Array<{ role: string; reasoning_content?: string; tool_calls?: unknown[] }>;
      };
      expect(body.messages.some((message) =>
        message.role === "assistant"
        && message.reasoning_content === "Need the README before answering."
        && Array.isArray(message.tool_calls)
      )).toBe(true);

      return new Response(JSON.stringify({
        choices: [{ message: { content: "Done." } }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    });

    const provider = createModelProvider(
      {
        id: "deepseek",
        type: "openai_compatible",
        label: "DeepSeek",
        modelId: "deepseek-v4-flash",
        baseUrl: "https://api.deepseek.com",
        apiKeyEnv: "DEEPSEEK_API_KEY",
        headers: {},
      },
      { env: { DEEPSEEK_API_KEY: "test-deepseek-key" }, fetchImpl },
    );

    await provider({
      messages: [
        { role: "user", content: "Install this repo." },
        {
          role: "assistant",
          content: "Let me inspect the README.",
          reasoningContent: "Need the README before answering.",
          toolCalls: [{ id: "call-readme", toolId: "web.fetch", args: { url: "https://github.com/tw93/Waza" } }],
        },
        { role: "tool", toolCallId: "call-readme", toolName: "web.fetch", content: "{\"status\":200}" },
      ],
      tools: [{ id: "web.fetch", description: "Fetch URL" }],
      toolChoice: "auto",
    });
  });

  it("preserves empty reasoning_content in OpenAI-compatible chat tool call history", async () => {
    const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        messages: Array<{ role: string; reasoning_content?: string; tool_calls?: unknown[] }>;
      };
      expect(body.messages.some((message) =>
        message.role === "assistant"
        && Object.prototype.hasOwnProperty.call(message, "reasoning_content")
        && message.reasoning_content === ""
        && Array.isArray(message.tool_calls)
      )).toBe(true);

      return new Response(JSON.stringify({
        choices: [{ message: { content: "Done." } }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    });

    const provider = createModelProvider(
      {
        id: "deepseek",
        type: "openai_compatible",
        label: "DeepSeek",
        modelId: "deepseek-v4-flash",
        baseUrl: "https://api.deepseek.com",
        apiKeyEnv: "DEEPSEEK_API_KEY",
        headers: {},
      },
      { env: { DEEPSEEK_API_KEY: "test-deepseek-key" }, fetchImpl },
    );

    await provider({
      messages: [
        { role: "user", content: "Install this repo." },
        {
          role: "assistant",
          content: "",
          reasoningContent: "",
          toolCalls: [{ id: "call-check", toolId: "skills.checkName", args: { name: "read" } }],
        },
        { role: "tool", toolCallId: "call-check", toolName: "skills.checkName", content: "{\"available\":true}" },
      ],
      tools: [{ id: "skills.checkName", description: "Check skill name" }],
      toolChoice: "auto",
    });
  });

  it("maps OpenAI-compatible streaming chat tool call deltas", async () => {
    const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        stream?: boolean;
        tools?: Array<{ type: string; function: { name: string } }>;
      };
      expect(body.stream).toBe(true);
      expect(body.tools?.[0]).toMatchObject({
        type: "function",
        function: { name: "file__read" },
      });

      return new Response([
        "data: {\"choices\":[{\"delta\":{\"reasoning_content\":\"Need README.\"}}]}\n\n",
        "data: {\"choices\":[{\"delta\":{\"content\":\"好的，我先看看。\"}}]}\n\n",
        "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call-readme\",\"type\":\"function\",\"function\":{\"name\":\"file__read\",\"arguments\":\"{\\\"path\\\":\"}}]}}]}\n\n",
        "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"function\":{\"arguments\":\"\\\"README.md\\\"}\"}}]},\"finish_reason\":\"tool_calls\"}]}\n\n",
        "data: [DONE]\n\n",
      ].join(""), { status: 200, headers: { "content-type": "text/event-stream" } });
    });

    const provider = createModelProvider(
      {
        id: "openrouter",
        type: "openai_compatible",
        label: "OpenRouter",
        modelId: "tool-model",
        baseUrl: "https://openrouter.ai/api/v1",
        apiKeyEnv: "OPENROUTER_API_KEY",
        headers: {},
      },
      { env: { OPENROUTER_API_KEY: "test-openrouter-key" }, fetchImpl },
    );
    const chunks: string[] = [];

    const response = await provider.stream?.(
      {
        prompt: "Read README.",
        tools: [{ id: "file.read", description: "Read file" }],
        toolChoice: "auto",
      },
      { onTextDelta: (chunk) => { chunks.push(chunk.delta); } },
    );

    expect(response?.text).toBe("好的，我先看看。");
    expect(chunks).toEqual(["好的，我先看看。"]);
    expect(response?.reasoningContent).toBe("Need README.");
    expect(response?.raw).toMatchObject({ streamMode: "sse", protocol: "chat_completions", eventCount: 4 });
    expect(response?.raw).not.toHaveProperty("events");
    expect(response?.toolCalls).toEqual([
      expect.objectContaining({ id: "call-readme", toolId: "file.read", args: { path: "README.md" } }),
    ]);
  });

  it("sends an OpenAI-compatible responses request when requested", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe("https://gateway.example.com/v1/responses");

      const body = JSON.parse(String(init?.body)) as {
        model: string;
        input: Array<{ role: string }>;
        max_output_tokens?: number;
      };

      expect(body.model).toBe("gateway-reasoner");
      expect(body.max_output_tokens).toBe(64);
      expect(body.input[0]?.role).toBe("developer");

      return new Response(JSON.stringify({ output_text: "Responses hello." }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const provider = createModelProvider(
      {
        id: "gateway",
        type: "openai_compatible",
        label: "Gateway",
        modelId: "gateway-reasoner",
        baseUrl: "https://gateway.example.com",
        apiKeyEnv: "GATEWAY_API_KEY",
        protocol: "responses",
        maxTokens: 64,
        headers: {
          "x-gateway": "enabled",
        },
      },
      {
        env: { GATEWAY_API_KEY: "test-gateway-key" },
        fetchImpl,
      }
    );

    const response = await provider({
      prompt: "Say hello from responses.",
      system: "Stay brief.",
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(response.text).toBe("Responses hello.");
  });

  it("uses OpenAI Responses continuation metadata when supplied", async () => {
    const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        previous_response_id?: string;
        input: Array<{ role?: string; type?: string }>;
      };
      expect(body.previous_response_id).toBe("resp_previous");
      expect(body.input).toEqual([
        { type: "message", role: "user", content: [{ type: "input_text", text: "Only send the delta." }] },
      ]);
      return new Response(JSON.stringify({ id: "resp_next", output_text: "Continued." }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const provider = createModelProvider(
      {
        id: "gateway",
        type: "openai_compatible",
        label: "Gateway",
        modelId: "gateway-reasoner",
        baseUrl: "https://gateway.example.com",
        apiKeyEnv: "GATEWAY_API_KEY",
        protocol: "responses",
        headers: {},
      },
      { env: { GATEWAY_API_KEY: "test-gateway-key" }, fetchImpl },
    );

    const response = await provider({
      messages: [
        { role: "user", content: "Earlier prompt." },
        { role: "assistant", content: "Earlier answer." },
        { role: "user", content: "Only send the delta." },
      ],
      providerCache: {
        openaiPreviousResponseId: "resp_previous",
        openaiDeltaMessages: [{ role: "user", content: "Only send the delta." }],
      },
    });

    expect(response.text).toBe("Continued.");
    expect(response.providerResponseId).toBe("resp_next");
  });

  it("maps OpenAI Responses function calls", async () => {
    const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        tools?: Array<{ type: string; name: string }>;
      };
      expect(body.tools?.[0]).toMatchObject({ type: "function", name: "file__read" });
      return new Response(JSON.stringify({
        status: "completed",
        output: [{
          type: "function_call",
          call_id: "call-read",
          name: "file__read",
          arguments: "{\"path\":\"README.md\"}",
        }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    });

    const provider = createModelProvider(
      {
        id: "gateway",
        type: "openai_compatible",
        label: "Gateway",
        modelId: "gateway-reasoner",
        baseUrl: "https://gateway.example.com",
        apiKeyEnv: "GATEWAY_API_KEY",
        protocol: "responses",
        headers: {},
      },
      { env: { GATEWAY_API_KEY: "test-gateway-key" }, fetchImpl },
    );

    const response = await provider({
      prompt: "Read file.",
      tools: [{ id: "file.read", description: "Read file" }],
    });

    expect(response.toolCalls).toEqual([
      expect.objectContaining({ id: "call-read", toolId: "file.read", args: { path: "README.md" } }),
    ]);
  });

  it("maps OpenAI Responses streaming function call events", async () => {
    const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { stream?: boolean };
      expect(body.stream).toBe(true);
      return new Response([
        "data: {\"type\":\"response.output_item.done\",\"item\":{\"type\":\"function_call\",\"call_id\":\"call-search\",\"name\":\"web__search\",\"arguments\":\"{\\\"query\\\":\\\"Ora\\\"}\"}}\n\n",
        "data: [DONE]\n\n",
      ].join(""), { status: 200, headers: { "content-type": "text/event-stream" } });
    });

    const provider = createModelProvider(
      {
        id: "gateway",
        type: "openai_compatible",
        label: "Gateway",
        modelId: "gateway-reasoner",
        baseUrl: "https://gateway.example.com",
        apiKeyEnv: "GATEWAY_API_KEY",
        protocol: "responses",
        headers: {},
      },
      { env: { GATEWAY_API_KEY: "test-gateway-key" }, fetchImpl },
    );

    const response = await provider.stream?.({
      prompt: "Search.",
      tools: [{ id: "web.search", description: "Search web" }],
    });

    expect(response?.toolCalls).toEqual([
      expect.objectContaining({ id: "call-search", toolId: "web.search", args: { query: "Ora" } }),
    ]);
    expect(response?.raw).toMatchObject({ streamMode: "sse", protocol: "responses", eventCount: 1 });
    expect(response?.raw).not.toHaveProperty("events");
  });

  it("blocks custom provider base URLs unless explicitly enabled", async () => {
    const provider = createModelProvider(
      {
        id: "openai-gpt",
        type: "openai",
        label: "GPT",
        modelId: "gpt-test",
        baseUrl: "https://example.invalid",
        headers: {},
      },
      {
        env: { OPENAI_API_KEY: "test-openai-key" },
        fetchImpl: vi.fn(),
      }
    );

    await expect(provider({ prompt: "Do not leak keys." })).rejects.toThrow(
      "ORA_ALLOW_CUSTOM_PROVIDER_BASE_URLS=true"
    );
  });

  it("sends an Anthropic Messages API request and parses content blocks", async () => {
    const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("x-api-key")).toBe("test-anthropic-key");
      expect(headers.get("anthropic-version")).toBe("2023-06-01");
      expect(headers.get("content-type")).toBe("application/json");

      const body = JSON.parse(String(init?.body)) as {
        model: string;
        max_tokens: number;
        system?: string | Array<{ type: string; text: string; cache_control?: unknown }>;
        messages: Array<{ role: string; content: string }>;
      };

      expect(body.model).toBe("claude-test");
      expect(body.max_tokens).toBe(24);
      expect(body.system).toEqual([{
        type: "text",
        text: "Be concise.",
        cache_control: { type: "ephemeral", ttl: "5m" },
      }]);
      expect(body.messages).toEqual([{ role: "user", content: "What time is it?" }]);

      return new Response(
        JSON.stringify({
          content: [{ type: "text", text: "Anthropic says hello." }],
          role: "assistant",
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    });

    const provider = createModelProvider(
      {
        id: "anthropic-claude",
        type: "anthropic",
        label: "Claude",
        modelId: "claude-test",
        maxTokens: 24,
        headers: {},
      },
      {
        env: { ANTHROPIC_API_KEY: "test-anthropic-key" },
        fetchImpl,
      }
    );

    const response = await provider({
      prompt: "What time is it?",
      system: "Be concise.",
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(response.text).toBe("Anthropic says hello.");
    expect(response.raw).toMatchObject({
      content: [{ type: "text", text: "Anthropic says hello." }],
    });
  });

  it("normalizes Anthropic token usage", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      content: [{ type: "text", text: "Anthropic says hello." }],
      usage: {
        input_tokens: 30,
        cache_creation_input_tokens: 2,
        cache_read_input_tokens: 3,
        output_tokens: 9,
      },
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));

    const provider = createModelProvider(
      {
        id: "anthropic-claude",
        type: "anthropic",
        label: "Claude",
        modelId: "claude-test",
        headers: {},
      },
      {
        env: { ANTHROPIC_API_KEY: "test-anthropic-key" },
        fetchImpl,
      }
    );

    const response = await provider({ prompt: "Say hello." });

    expect(response.usage).toEqual({
      inputTokens: 35,
      outputTokens: 9,
      cacheCreationInputTokens: 2,
      cacheReadInputTokens: 3,
      totalTokens: 44,
      source: "provider",
    });
  });

  it("keeps Anthropic-compatible prompt caching opt-in", async () => {
    const requestBodies: unknown[] = [];
    const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      requestBodies.push(JSON.parse(String(init?.body)));
      return new Response(
        JSON.stringify({ content: [{ type: "text", text: "OK" }], role: "assistant" }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    const baseProvider = {
      id: "claude-gateway",
      type: "anthropic_compatible" as const,
      label: "Claude Gateway",
      modelId: "claude-test",
      baseUrl: "https://claude-gateway.example.com",
      apiKeyEnv: "CLAUDE_GATEWAY_API_KEY",
      headers: {},
    };

    await createModelProvider(baseProvider, {
      env: { CLAUDE_GATEWAY_API_KEY: "test-compatible-key" },
      fetchImpl,
    })({ prompt: "Hello.", system: "Cache maybe." });

    await createModelProvider({
      ...baseProvider,
      id: "claude-gateway-cached",
      promptCache: { enabled: true, ttl: "1h" },
    }, {
      env: { CLAUDE_GATEWAY_API_KEY: "test-compatible-key" },
      fetchImpl,
    })({ prompt: "Hello.", system: "Cache maybe." });

    expect(JSON.stringify(requestBodies[0])).not.toContain("cache_control");
    expect(JSON.stringify(requestBodies[1])).toContain("\"cache_control\":{\"type\":\"ephemeral\",\"ttl\":\"1h\"}");
  });

  it("maps Anthropic tool_use blocks", async () => {
    const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        tools?: Array<{ name: string; input_schema: unknown }>;
      };
      expect(body.tools?.[0]).toMatchObject({ name: "file__grep" });
      return new Response(JSON.stringify({
        content: [{
          type: "tool_use",
          id: "toolu-1",
          name: "file__grep",
          input: { pattern: "ToolCall" },
        }],
        role: "assistant",
        stop_reason: "tool_use",
      }), { status: 200, headers: { "content-type": "application/json" } });
    });

    const provider = createModelProvider(
      {
        id: "anthropic-claude",
        type: "anthropic",
        label: "Claude",
        modelId: "claude-test",
        headers: {},
      },
      { env: { ANTHROPIC_API_KEY: "test-anthropic-key" }, fetchImpl },
    );

    const response = await provider({
      prompt: "Search files.",
      tools: [{ id: "file.grep", description: "Search files" }],
    });

    expect(response.toolCalls).toEqual([
      expect.objectContaining({ id: "toolu-1", toolId: "file.grep", args: { pattern: "ToolCall" } }),
    ]);
    expect(response.finishReason).toBe("tool_use");
  });

  it("sends an Anthropic-compatible Messages API request", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe("https://claude-gateway.example.com/v1/messages");

      const headers = new Headers(init?.headers);
      expect(headers.get("x-api-key")).toBe("test-compatible-key");
      expect(headers.get("anthropic-version")).toBe("2023-06-01");
      expect(headers.get("anthropic-beta")).toBe("prompt-caching-2024-07-31");

      return new Response(
        JSON.stringify({
          content: [{ type: "text", text: "Anthropic compatible hello." }],
          role: "assistant",
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    });

    const provider = createModelProvider(
      {
        id: "claude-gateway",
        type: "anthropic_compatible",
        label: "Claude Gateway",
        modelId: "claude-test",
        baseUrl: "https://claude-gateway.example.com",
        apiKeyEnv: "CLAUDE_GATEWAY_API_KEY",
        anthropicVersion: "2023-06-01",
        headers: {
          "anthropic-beta": "prompt-caching-2024-07-31",
        },
      },
      {
        env: { CLAUDE_GATEWAY_API_KEY: "test-compatible-key" },
        fetchImpl,
      }
    );

    const response = await provider({
      prompt: "Hello.",
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(response.text).toBe("Anthropic compatible hello.");
  });

  it("creates a registry with a local smoke default provider", async () => {
    const registry = createDefaultProviderRegistry();
    const response = await registry.invoke(undefined, {
      prompt: "Check the default provider.",
    });

    expect(registry.list().map((provider) => provider.id)).toContain("local-smoke");
    expect(response.providerId).toBe("local-smoke");
    expect(response.text).toContain("prompt=Check the default provider.");
  });

  it("resolves providers by id", async () => {
    const registry = createProviderRegistry({
      defaultProviderId: "local-smoke",
      providers: [
        {
          id: "local-smoke",
          type: "local_smoke",
          label: "Smoke",
          modelId: "smoke-model",
          headers: {},
        },
      ],
    });

    const provider = registry.resolve("local-smoke");
    const response = await provider({ prompt: "Resolve me." });
    expect(response.providerId).toBe("local-smoke");
  });

  it("resolves the local smoke provider from the default Ora model ref", async () => {
    const registry = createDefaultProviderRegistry();
    const response = await registry.invoke("local/smoke-model", {
      prompt: "Resolve model ref."
    });

    expect(response.providerId).toBe("local-smoke");
    expect(response.text).toContain("prompt=Resolve model ref.");
  });

  it("invokes a run-scoped custom provider config", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: "Run-scoped compatible output." } }],
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));

    const response = await invokeRunProvider(
      {
        pattern: "orchestrator_subagent",
        profileIds: [],
        providerId: "custom-compatible",
        providerConfig: {
          id: "custom-compatible",
          type: "openai_compatible",
          label: "Custom Compatible",
          modelId: "custom-model",
          baseUrl: "http://localhost:11434/v1",
          apiKeyEnv: "CUSTOM_COMPATIBLE_API_KEY",
          enabled: true,
          capabilities: ["chat"],
          dropParams: [],
          headers: {},
        },
        modelRef: "custom-model",
        metadata: {},
        deterministicSeed: "test-seed",
      },
      { prompt: "Use the run provider." },
      {
        env: { CUSTOM_COMPATIBLE_API_KEY: "local-key" },
        fetchImpl,
      }
    );

    expect(response.providerId).toBe("custom-compatible");
    expect(response.text).toBe("Run-scoped compatible output.");
  });

  it("verifies provider configs and returns a verified status", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      if (String(input).endsWith("/models")) {
        return new Response(JSON.stringify({ data: [{ id: "openai/gpt-4o-mini" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({
        choices: [{ message: { content: "OK" } }],
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const status = await verifyProviderConfig(
      {
        id: "openrouter",
        type: "openai_compatible",
        label: "OpenRouter",
        modelId: "openai/gpt-4o-mini",
        baseUrl: "https://openrouter.ai/api/v1",
        apiKeyEnv: "OPENROUTER_API_KEY",
        protocol: "chat_completions",
        headers: {},
      },
      {
        env: { OPENROUTER_API_KEY: "test-openrouter-key" },
        fetchImpl,
      }
    );

    expect(status.state).toBe("verified");
    expect(status.detail).toBe("Connection verified.");
  });

  it("returns a failed verification status with actionable detail", async () => {
    const status = await verifyProviderConfig(
      {
        id: "broken-compatible",
        type: "openai_compatible",
        label: "Broken Compatible",
        modelId: "broken-model",
        baseUrl: "https://broken.example.com",
        apiKeyEnv: "BROKEN_API_KEY",
        headers: {},
      },
      {
        env: {},
        fetchImpl: vi.fn(),
      }
    );

    expect(status.state).toBe("failed");
    expect(status.detail).toContain("BROKEN_API_KEY");
  });
});

describe("DeepSeek provider", () => {
  const deepseekConfig = {
    id: "deepseek",
    type: "openai_compatible" as const,
    label: "DeepSeek",
    modelId: "deepseek-v4-flash",
    baseUrl: "https://api.deepseek.com",
    apiKeyEnv: "DEEPSEEK_API_KEY",
    protocol: "chat_completions" as const,
    capabilities: ["chat", "tool_use", "reasoning"] as const,
    headers: {},
  };

  it("sends thinking instead of reasoning_effort for DeepSeek chat completions", async () => {
    const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body.thinking).toEqual({ type: "enabled" });
      expect(body).not.toHaveProperty("reasoning_effort");
      return new Response(JSON.stringify({
        choices: [{ message: { content: "DeepSeek reasoning answer." } }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    });

    const provider = createModelProvider(deepseekConfig, {
      env: { DEEPSEEK_API_KEY: "test-key" },
      fetchImpl,
    });

    const response = await provider({ prompt: "Think.", reasoningEffort: "high" });
    expect(response.text).toBe("DeepSeek reasoning answer.");
  });

  it("ensures reasoning_content is present for DeepSeek tool-call assistant messages", async () => {
    const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        messages: Array<{ role: string; reasoning_content?: string; tool_calls?: unknown[] }>;
      };
      const assistantMsg = body.messages.find((m) => m.role === "assistant" && m.tool_calls);
      expect(assistantMsg).toBeDefined();
      expect(assistantMsg).toHaveProperty("reasoning_content");
      expect(assistantMsg!.reasoning_content).toBe("");
      return new Response(JSON.stringify({
        choices: [{ message: { content: "Done." } }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    });

    const provider = createModelProvider(deepseekConfig, {
      env: { DEEPSEEK_API_KEY: "test-key" },
      fetchImpl,
    });

    await provider({
      messages: [
        { role: "user", content: "Check this." },
        {
          role: "assistant",
          content: "",
          toolCalls: [{ id: "call-1", toolId: "file.read", args: { path: "test" } }],
        },
        { role: "tool", toolCallId: "call-1", toolName: "file.read", content: "ok" },
      ],
      tools: [{ id: "file.read", description: "Read file" }],
      toolChoice: "auto",
    });
  });

  it("sends stream_options for DeepSeek streaming", async () => {
    const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body.stream).toBe(true);
      expect(body.stream_options).toEqual({ include_usage: true });
      return new Response([
        "data: {\"choices\":[{\"delta\":{\"content\":\"Streaming.\"}}]}\n\n",
        "data: [DONE]\n\n",
      ].join(""), { status: 200, headers: { "content-type": "text/event-stream" } });
    });

    const provider = createModelProvider(deepseekConfig, {
      env: { DEEPSEEK_API_KEY: "test-key" },
      fetchImpl,
    });

    const response = await provider.stream?.({ prompt: "Stream." });
    expect(response?.text).toBe("Streaming.");
  });

  it("parses DeepSeek cache hit/miss tokens from usage", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: "Cached." } }],
      usage: {
        prompt_tokens: 200,
        completion_tokens: 50,
        total_tokens: 250,
        prompt_cache_hit_tokens: 150,
        prompt_cache_miss_tokens: 50,
        completion_tokens_details: { reasoning_tokens: 30 },
      },
    }), { status: 200, headers: { "content-type": "application/json" } }));

    const provider = createModelProvider(deepseekConfig, {
      env: { DEEPSEEK_API_KEY: "test-key" },
      fetchImpl,
    });

    const response = await provider({ prompt: "Hello." });
    expect(response.usage).toEqual({
      inputTokens: 200,
      outputTokens: 50,
      reasoningTokens: 30,
      promptCacheHitTokens: 150,
      promptCacheMissTokens: 50,
      totalTokens: 250,
      source: "provider",
    });
  });

  it("parses DeepSeek cache hit/miss from streaming usage chunks", async () => {
    const fetchImpl = vi.fn(async () => new Response([
      "data: {\"choices\":[{\"delta\":{\"content\":\"Cached stream.\"}}]}\n\n",
      "data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}],\"usage\":{\"prompt_tokens\":100,\"completion_tokens\":10,\"total_tokens\":110,\"prompt_cache_hit_tokens\":80,\"prompt_cache_miss_tokens\":20}}\n\n",
      "data: [DONE]\n\n",
    ].join(""), { status: 200, headers: { "content-type": "text/event-stream" } }));

    const provider = createModelProvider(deepseekConfig, {
      env: { DEEPSEEK_API_KEY: "test-key" },
      fetchImpl,
    });

    const response = await provider.stream?.({ prompt: "Stream." });
    expect(response?.usage).toMatchObject({
      promptCacheHitTokens: 80,
      promptCacheMissTokens: 20,
    });
  });

  it("parses OpenAI-style prompt_tokens_details.cached_tokens as promptCacheHitTokens", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: "Cached." } }],
      usage: {
        prompt_tokens: 300,
        completion_tokens: 60,
        total_tokens: 360,
        prompt_tokens_details: { cached_tokens: 200 },
      },
    }), { status: 200, headers: { "content-type": "application/json" } }));

    const provider = createModelProvider(deepseekConfig, {
      env: { DEEPSEEK_API_KEY: "test-key" },
      fetchImpl,
    });

    const response = await provider({ prompt: "Hello." });
    expect(response.usage?.promptCacheHitTokens).toBe(200);
  });

  it("does not send DeepSeek-specific fields to generic OpenAI-compatible providers", async () => {
    const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body).not.toHaveProperty("thinking");
      expect(body.stream_options).toBeUndefined();
      return new Response(JSON.stringify({
        choices: [{ message: { content: "Generic." } }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    });

    const provider = createModelProvider({
      id: "openrouter",
      type: "openai_compatible",
      label: "OpenRouter",
      modelId: "openai/gpt-4o",
      baseUrl: "https://openrouter.ai/api/v1",
      apiKeyEnv: "OPENROUTER_API_KEY",
      protocol: "chat_completions",
      headers: {},
    }, {
      env: { OPENROUTER_API_KEY: "test-key" },
      fetchImpl,
    });

    await provider({ prompt: "Test.", reasoningEffort: "high" });

    const streamFetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body.stream_options).toBeUndefined();
      return new Response("data: [DONE]\n\n", {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    });

    const streamProvider = createModelProvider({
      id: "openrouter",
      type: "openai_compatible",
      label: "OpenRouter",
      modelId: "openai/gpt-4o",
      baseUrl: "https://openrouter.ai/api/v1",
      apiKeyEnv: "OPENROUTER_API_KEY",
      protocol: "chat_completions",
      headers: {},
    }, {
      env: { OPENROUTER_API_KEY: "test-key" },
      fetchImpl: streamFetch,
    });

    await streamProvider.stream?.({ prompt: "Stream." });
  });

  it("preserves provided reasoning_content for DeepSeek tool-call history", async () => {
    const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        messages: Array<{ role: string; reasoning_content?: string; tool_calls?: unknown[] }>;
      };
      const assistantMsg = body.messages.find((m) => m.role === "assistant" && m.tool_calls);
      expect(assistantMsg?.reasoning_content).toBe("Need to think first.");
      return new Response(JSON.stringify({
        choices: [{ message: { content: "Done." } }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    });

    const provider = createModelProvider(deepseekConfig, {
      env: { DEEPSEEK_API_KEY: "test-key" },
      fetchImpl,
    });

    await provider({
      messages: [
        { role: "user", content: "Check." },
        {
          role: "assistant",
          content: "Let me check.",
          reasoningContent: "Need to think first.",
          toolCalls: [{ id: "call-2", toolId: "file.read", args: { path: "x" } }],
        },
        { role: "tool", toolCallId: "call-2", toolName: "file.read", content: "ok" },
      ],
      tools: [{ id: "file.read", description: "Read file" }],
      toolChoice: "auto",
    });
  });
});
