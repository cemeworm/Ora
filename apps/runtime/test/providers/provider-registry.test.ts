import { describe, expect, it, vi } from "vitest";
import { createDefaultProviderRegistry, createModelProvider, createProviderRegistry, invokeRunProvider, verifyProviderConfig } from "../../src/providers/index.js";

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
        system?: string;
        messages: Array<{ role: string; content: string }>;
      };

      expect(body.model).toBe("claude-test");
      expect(body.max_tokens).toBe(24);
      expect(body.system).toContain("Be concise.");
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
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: "OK" } }],
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));

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
