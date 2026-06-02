import { describe, expect, it } from "vitest";
import { createProviderRegistry } from "../src/providers/registry.js";
import {
  ProviderCircuitOpenError,
  ProviderHealthGuard,
  ProviderTransientExhaustedError,
  isTransientProviderFailure,
} from "../src/providers/provider-health.js";

describe("ProviderHealthGuard", () => {
  it("opens after repeated transient failures and closes after a successful half-open probe", async () => {
    let now = 1_700_000_000_000;
    const guard = new ProviderHealthGuard({
      failureThreshold: 2,
      recoveryTimeoutMs: 1_000,
      clock: () => now,
    });
    let calls = 0;

    await expect(guard.run("busy-provider", async () => {
      calls += 1;
      throw new Error("OpenAI-compatible provider busy-provider failed with 503: server busy");
    })).rejects.toThrow("503");
    await expect(guard.run("busy-provider", async () => {
      calls += 1;
      throw new Error("OpenAI-compatible provider busy-provider failed with 503: server busy");
    })).rejects.toThrow("503");

    expect(guard.snapshot("busy-provider")).toMatchObject({
      failureCount: 2,
      state: "open",
    });
    await expect(guard.run("busy-provider", async () => {
      calls += 1;
      throw new Error("should not be called while open");
    })).rejects.toBeInstanceOf(ProviderCircuitOpenError);
    expect(calls).toBe(2);

    now += 1_001;
    await expect(guard.run("busy-provider", async () => {
      calls += 1;
      return {
        providerId: "busy-provider",
        providerType: "openai_compatible",
        modelId: "test-model",
        text: "recovered",
        raw: {},
      };
    })).resolves.toMatchObject({ text: "recovered" });
    expect(guard.snapshot("busy-provider")).toMatchObject({
      failureCount: 0,
      state: "closed",
    });
    expect(calls).toBe(3);
  });

  it("does not trip on provider auth or quota failures", async () => {
    const guard = new ProviderHealthGuard({ failureThreshold: 1 });

    await expect(guard.run("auth-provider", async () => {
      throw new Error("Missing AUTH_PROVIDER_KEY for provider auth-provider");
    })).rejects.toThrow("AUTH_PROVIDER_KEY");
    await expect(guard.run("auth-provider", async () => {
      throw new Error("OpenAI provider auth-provider failed with 401: unauthorized");
    })).rejects.toThrow("401");

    expect(guard.snapshot("auth-provider")).toMatchObject({
      failureCount: 0,
      state: "closed",
    });
  });

  it("opens immediately after an exhausted transient failure and recovers on the next probe window", async () => {
    let now = 1_700_000_000_000;
    const guard = new ProviderHealthGuard({
      failureThreshold: 5,
      recoveryTimeoutMs: 30_000,
      exhaustedTransientCooldownMs: 5_000,
      clock: () => now,
    });

    await expect(guard.run("busy-provider", async () => {
      throw new ProviderTransientExhaustedError(
        "busy-provider",
        2,
        5_000,
        Object.assign(new Error("connect ECONNRESET"), { code: "ECONNRESET" }),
      );
    })).rejects.toBeInstanceOf(ProviderTransientExhaustedError);

    expect(guard.snapshot("busy-provider")).toMatchObject({
      failureCount: 5,
      state: "open",
    });
    await expect(guard.run("busy-provider", async () => ({
      providerId: "busy-provider",
      providerType: "openai_compatible",
      modelId: "test-model",
      text: "should not run while open",
      raw: {},
    }))).rejects.toBeInstanceOf(ProviderCircuitOpenError);

    now += 5_001;
    await expect(guard.run("busy-provider", async () => ({
      providerId: "busy-provider",
      providerType: "openai_compatible",
      modelId: "test-model",
      text: "recovered",
      raw: {},
    }))).resolves.toMatchObject({ text: "recovered" });
  });

  it("classifies retryable provider details conservatively", () => {
    expect(isTransientProviderFailure("OpenAI provider failed with 503: server busy")).toBe(true);
    expect(isTransientProviderFailure("request timed out")).toBe(true);
    expect(isTransientProviderFailure("invalid api key")).toBe(false);
    expect(isTransientProviderFailure("quota exceeded")).toBe(false);
  });
});

describe("provider registry health wrapping", () => {
  it("fast-fails invoke calls after the provider circuit opens", async () => {
    const guard = new ProviderHealthGuard({ failureThreshold: 1, recoveryTimeoutMs: 10_000 });
    let fetchCalls = 0;
    const registry = createProviderRegistry({
      defaultProviderId: "guarded-provider",
      providers: [{
        id: "guarded-provider",
        label: "Guarded Provider",
        type: "openai_compatible",
        modelId: "guarded-chat",
        baseUrl: "https://example.test/v1",
        apiKeyEnv: "GUARDED_PROVIDER_KEY",
        capabilities: ["chat"],
        headers: {},
      }],
    }, {
      env: { GUARDED_PROVIDER_KEY: "test" } as NodeJS.ProcessEnv,
      fetchImpl: (async () => {
        fetchCalls += 1;
        return new Response("server busy", { status: 503 });
      }) as typeof fetch,
      providerHealthGuard: guard,
    });

    await expect(registry.invoke("guarded-provider", { prompt: "hello" })).rejects.toThrow("503");
    const fetchCallsAfterFirstFailure = fetchCalls;
    await expect(registry.invoke("guarded-provider", { prompt: "hello again" })).rejects.toBeInstanceOf(ProviderCircuitOpenError);
    expect(fetchCallsAfterFirstFailure).toBeGreaterThan(0);
    expect(fetchCalls).toBe(fetchCallsAfterFirstFailure);
  });

  it("fast-fails invokeStream calls through the same provider guard", async () => {
    const guard = new ProviderHealthGuard({ failureThreshold: 1, recoveryTimeoutMs: 10_000 });
    let fetchCalls = 0;
    const registry = createProviderRegistry({
      defaultProviderId: "guarded-stream-provider",
      providers: [{
        id: "guarded-stream-provider",
        label: "Guarded Stream Provider",
        type: "openai_compatible",
        modelId: "guarded-stream-chat",
        baseUrl: "https://example.test/v1",
        apiKeyEnv: "GUARDED_STREAM_PROVIDER_KEY",
        capabilities: ["chat"],
        headers: {},
      }],
    }, {
      env: { GUARDED_STREAM_PROVIDER_KEY: "test" } as NodeJS.ProcessEnv,
      fetchImpl: (async () => {
        fetchCalls += 1;
        return new Response("server busy", { status: 503 });
      }) as typeof fetch,
      providerHealthGuard: guard,
    });

    await expect(registry.invokeStream("guarded-stream-provider", { prompt: "hello" })).rejects.toThrow("503");
    const fetchCallsAfterFirstFailure = fetchCalls;
    await expect(registry.invokeStream("guarded-stream-provider", { prompt: "hello again" })).rejects.toBeInstanceOf(ProviderCircuitOpenError);
    expect(fetchCallsAfterFirstFailure).toBeGreaterThan(0);
    expect(fetchCalls).toBe(fetchCallsAfterFirstFailure);
  });

  it("opens the provider circuit after transient completion retries are exhausted", async () => {
    const guard = new ProviderHealthGuard({
      failureThreshold: 5,
      recoveryTimeoutMs: 10_000,
      exhaustedTransientCooldownMs: 10_000,
    });
    let fetchCalls = 0;
    const registry = createProviderRegistry({
      defaultProviderId: "guarded-provider",
      providers: [{
        id: "guarded-provider",
        label: "Guarded Provider",
        type: "openai_compatible",
        modelId: "guarded-chat",
        baseUrl: "https://example.test/v1",
        apiKeyEnv: "GUARDED_PROVIDER_KEY",
        capabilities: ["chat"],
        headers: {},
      }],
    }, {
      env: { GUARDED_PROVIDER_KEY: "test" } as NodeJS.ProcessEnv,
      fetchImpl: (async () => {
        fetchCalls += 1;
        throw new Error("fetch failed", {
          cause: Object.assign(new Error("connect ECONNRESET"), { code: "ECONNRESET" }),
        });
      }) as typeof fetch,
      providerHealthGuard: guard,
    });

    await expect(registry.invoke("guarded-provider", { prompt: "hello" })).rejects.toBeInstanceOf(ProviderTransientExhaustedError);
    await expect(registry.invoke("guarded-provider", { prompt: "hello again" })).rejects.toBeInstanceOf(ProviderCircuitOpenError);
    expect(fetchCalls).toBe(2);
  });
});
