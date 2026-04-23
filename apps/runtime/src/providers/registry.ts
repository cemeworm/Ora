import type { ProviderConfig, ProviderRegistry as SharedProviderRegistry, RunConfig } from "@ora/shared";
import { DEFAULT_PROVIDERS } from "@ora/shared";
import { createAnthropicProvider } from "./anthropic.js";
import { createLocalSmokeProvider } from "./local-smoke.js";
import { createOpenAIProvider } from "./openai.js";
import { createOpenAICompatibleProvider } from "./openai-compatible.js";
import { traceLangfuseGeneration } from "../telemetry/langfuse.js";
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
    case "openai_compatible":
      return createOpenAICompatibleProvider(config, options);
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
    const providerConfig = providerConfigs.find((entry) => entry.enabled !== false && entry.id === id)
      ?? providerConfigs.find((entry) => entry.enabled !== false && entry.modelId === id)
      ?? (id === "local/smoke-model"
        ? providerConfigs.find((entry) => entry.enabled !== false && entry.type === "local_smoke")
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
      const providerConfig = resolveConfig(providerId);
      const provider = resolve(providerConfig.id);
      return traceLangfuseGeneration(
        {
          providerId: providerConfig.id,
          modelId: providerConfig.modelId,
          providerType: providerConfig.type,
          request
        },
        () => provider(request)
      );
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

export function createProviderRegistryForRun(
  runConfig: RunConfig,
  options: ProviderRuntimeOptions = {}
): ProviderRegistry {
  const providers = runConfig.providerConfig
    ? [
        runConfig.providerConfig,
        ...DEFAULT_PROVIDERS.filter((provider) => provider.id !== runConfig.providerConfig?.id),
      ]
    : DEFAULT_PROVIDERS;

  return createProviderRegistry(
    {
      providers,
      defaultProviderId: runConfig.providerConfig?.id ?? "local-smoke",
    },
    options
  );
}

export function configuredProviderId(config: RunConfig): string | undefined {
  const providerId = config.providerId ?? config.metadata.providerId;
  return typeof providerId === "string" ? providerId : config.modelRef;
}

export async function invokeRunProvider(
  config: RunConfig,
  request: ModelRequest,
  options: ProviderRuntimeOptions = {}
) {
  return createProviderRegistryForRun(config, options).invoke(configuredProviderId(config), request);
}
