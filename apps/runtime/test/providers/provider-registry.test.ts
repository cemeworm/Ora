import { describe, expect, it, vi } from "vitest";
import { createDefaultProviderRegistry, createModelProvider, createProviderRegistry } from "../../src/providers/index.js";

describe("provider adapters", () => {
  it("builds a deterministic local smoke response", async () => {
    const provider = createModelProvider({
      id: "local-smoke",
      type: "local_smoke",
      label: "Smoke",
      modelId: "smoke-model",
      maxTokens: 64,
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

  it("blocks custom provider base URLs unless explicitly enabled", async () => {
    const provider = createModelProvider(
      {
        id: "openai-gpt",
        type: "openai",
        label: "GPT",
        modelId: "gpt-test",
        baseUrl: "https://example.invalid",
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
});
