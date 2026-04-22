import type { ProviderConfig, ProviderRegistry as SharedProviderRegistry } from "@ora/shared";
import { DEFAULT_PROVIDERS } from "@ora/shared";
import { createAnthropicProvider } from "./anthropic.js";
import { createLocalSmokeProvider } from "./local-smoke.js";
import { createOpenAIProvider } from "./openai.js";
import type { ModelProvider, ModelRequest, ProviderRegistry, ProviderRuntimeOptions } from "./types.js";

export function createModelProvider(
  config: ProviderConfig,
  options: ProviderRuntimeOptions = {}
): ModelProvider {
  switch (config.type) {
    case "anthropic":
      return createAnthropicProvider(config, options);
    case "openai":
      return createOpenAIProvider(config, options);
    case "local_smoke":
      return createLocalSmokeProvider(config, options);
  }
}

export function createProviderRegistry(
  config: SharedProviderRegistry,
  options: ProviderRuntimeOptions = {}
): ProviderRegistry {
  const providerConfigs = [...config.providers];
  const cache = new Map<string, ModelProvider>();

  const resolveConfig = (providerId?: string) => {
    const id = providerId ?? config.defaultProviderId;
    const providerConfig = providerConfigs.find((entry) => entry.id === id)
      ?? providerConfigs.find((entry) => entry.modelId === id)
      ?? (id === "local/smoke-model"
        ? providerConfigs.find((entry) => entry.type === "local_smoke")
        : undefined);
    if (!providerConfig) {
      const available = providerConfigs.map((entry) => entry.id).join(", ");
      throw new Error(`Unknown provider ${id}. Available providers: ${available}`);
    }
    return providerConfig;
  };

  const resolve = (providerId?: string) => {
    const providerConfig = resolveConfig(providerId);
    const cached = cache.get(providerConfig.id);
    if (cached) {
      return cached;
    }
    const provider = createModelProvider(providerConfig, options);
    cache.set(providerConfig.id, provider);
    return provider;
  };

  return {
    config,
    list() {
      return providerConfigs;
    },
    resolve,
    async invoke(providerId: string | undefined, request: ModelRequest) {
      return resolve(providerId)(request);
    },
  };
}

export function createDefaultProviderRegistry(options: ProviderRuntimeOptions = {}) {
  return createProviderRegistry(
    {
      providers: DEFAULT_PROVIDERS,
      defaultProviderId: "local-smoke",
    },
    options
  );
}
