import { describe, expect, it } from "vitest";
import { chooseBootstrapProviderId, chooseEnabledProviderId } from "./providerSelection";
import type { OraProviderConfig, OraProviderRegistry } from "./runtimeClient";

function provider(
  id: string,
  overrides: Partial<OraProviderConfig> = {},
): OraProviderConfig {
  return {
    id,
    type: overrides.type ?? "openai",
    label: overrides.label ?? id,
    modelId: overrides.modelId ?? `${id}-model`,
    enabled: overrides.enabled ?? true,
    capabilities: overrides.capabilities ?? ["chat"],
    dropParams: overrides.dropParams ?? [],
    headers: overrides.headers ?? {},
  };
}

function registry(params: {
  providers: OraProviderConfig[];
  defaultProviderId?: string;
}): OraProviderRegistry {
  return {
    providers: params.providers,
    defaultProviderId: params.defaultProviderId ?? params.providers[0]?.id ?? "local-smoke",
  };
}

describe("chooseEnabledProviderId", () => {
  it("returns the preferred provider when enabled", () => {
    const reg = registry({
      providers: [
        provider("anthropic-compatible-1", { type: "openai_compatible" }),
        provider("openai-1", { type: "openai" }),
      ],
    });

    expect(chooseEnabledProviderId(reg, { preferredProviderId: "anthropic-compatible-1" })).toBe("anthropic-compatible-1");
  });

  it("skips a disabled preferred provider", () => {
    const reg = registry({
      providers: [
        provider("anthropic-compatible-1", { type: "openai_compatible", enabled: false }),
        provider("openai-1", { type: "openai" }),
      ],
    });

    expect(chooseEnabledProviderId(reg, { preferredProviderId: "anthropic-compatible-1" })).toBe("openai-1");
  });

  it("falls back to current provider when no preferred", () => {
    const reg = registry({
      providers: [
        provider("openai_compatible-1", { type: "openai_compatible" }),
        provider("openai-1", { type: "openai" }),
      ],
    });

    expect(chooseEnabledProviderId(reg, { currentProviderId: "openai-1" })).toBe("openai-1");
  });

  it("returns the default when nothing else matches", () => {
    const localSmoke = provider("local-smoke", { type: "local_smoke" });
    const reg = registry({
      providers: [provider("openai_compatible-1", { type: "openai_compatible", enabled: false }), localSmoke],
      defaultProviderId: "local-smoke",
    });

    expect(chooseEnabledProviderId(reg)).toBe("local-smoke");
  });

  it("returns non-local provider as last resort when default is not found", () => {
    const reg = registry({
      providers: [
        provider("openai_compatible-1", { type: "openai_compatible" }),
        provider("local-smoke", { type: "local_smoke", enabled: false }),
      ],
      defaultProviderId: "nonexistent",
    });

    expect(chooseEnabledProviderId(reg)).toBe("openai_compatible-1");
  });
});

describe("chooseBootstrapProviderId", () => {
  it("prefers non-local provider even when local-smoke is the default", () => {
    const localSmoke = provider("local-smoke", { type: "local_smoke" });
    const externalProvider = provider("external-api", { type: "openai_compatible" });
    const reg = registry({
      providers: [externalProvider, localSmoke],
      defaultProviderId: "local-smoke",
    });

    expect(chooseBootstrapProviderId(reg)).toBe("external-api");
  });

  it("falls back to local-smoke when no non-local provider exists", () => {
    const localSmoke = provider("local-smoke", { type: "local_smoke" });
    const reg = registry({
      providers: [localSmoke],
      defaultProviderId: "local-smoke",
    });

    expect(chooseBootstrapProviderId(reg)).toBe("local-smoke");
  });

  it("falls back to local-smoke when non-local providers are disabled", () => {
    const localSmoke = provider("local-smoke", { type: "local_smoke" });
    const disabledExternal = provider("external-api", { type: "openai_compatible", enabled: false });
    const reg = registry({
      providers: [disabledExternal, localSmoke],
      defaultProviderId: "local-smoke",
    });

    expect(chooseBootstrapProviderId(reg)).toBe("local-smoke");
  });

  it("prefers the first enabled non-local provider", () => {
    const localSmoke = provider("local-smoke", { type: "local_smoke" });
    const first = provider("first-api", { type: "openai_compatible" });
    const second = provider("second-api", { type: "openai" });
    const reg = registry({
      providers: [first, second, localSmoke],
      defaultProviderId: "local-smoke",
    });

    expect(chooseBootstrapProviderId(reg)).toBe("first-api");
  });

  it("handles empty registry gracefully", () => {
    const reg = registry({ providers: [], defaultProviderId: "local-smoke" });

    expect(chooseBootstrapProviderId(reg)).toBe("local-smoke");
  });
});
