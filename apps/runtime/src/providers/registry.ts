import type { ProviderConfig, ProviderModelsResult, ProviderRegistry as SharedProviderRegistry, ProviderStatus, RunConfig } from "@cemeworm/shared";
import { DEFAULT_PROVIDERS, ProviderModelsResultSchema } from "@cemeworm/shared";
import { createAnthropicProvider } from "./anthropic.js";
import { createAnthropicCompatibleProvider } from "./anthropic-compatible.js";
import { createLocalSmokeProvider } from "./local-smoke.js";
import { createOpenAIProvider } from "./openai.js";
import { createOpenAICompatibleProvider } from "./openai-compatible.js";
import { traceLangfuseGeneration } from "../telemetry/langfuse.js";
import type { ModelProvider, ModelRequest, ModelStreamCallbacks, ProviderRegistry, ProviderRuntimeOptions } from "./types.js";
import { streamFallback } from "./streaming.js";
import { defaultProviderHealthGuard, type ProviderHealthGuard } from "./provider-health.js";

type ProviderRegistryOptions = ProviderRuntimeOptions & {
  providerHealthGuard?: ProviderHealthGuard;
};

const RUNTIME_LOCAL_SMOKE_PROVIDER: ProviderConfig = {
  id: "local-smoke",
  type: "local_smoke",
  label: "Local Smoke",
  modelId: "local/smoke-model",
  enabled: true,
  headers: {},
};

function withRuntimeSmokeFallback(providers: ProviderConfig[]): ProviderConfig[] {
  const hasLocalSmoke = providers.some((provider) =>
    provider.id === RUNTIME_LOCAL_SMOKE_PROVIDER.id ||
    provider.modelId === RUNTIME_LOCAL_SMOKE_PROVIDER.modelId,
  );
  return hasLocalSmoke ? providers : [RUNTIME_LOCAL_SMOKE_PROVIDER, ...providers];
}

export function createModelProvider(
  config: ProviderConfig,
  options: ProviderRuntimeOptions = {}
): ModelProvider {
  switch (config.type) {
    case "anthropic":
      return createAnthropicProvider(config, options);
    case "anthropic_compatible":
      return createAnthropicCompatibleProvider(config, options);
    case "openai":
      return createOpenAIProvider(config, options);
    case "openai_compatible":
      return createOpenAICompatibleProvider(config, options);
    case "local_smoke":
      return createLocalSmokeProvider(config, options);
  }
}

export async function fetchProviderModels(
  config: ProviderConfig,
  options: ProviderRuntimeOptions = {}
): Promise<ProviderModelsResult> {
  try {
    const provider = createModelProvider(config, options);
    if (!provider.listModels) {
      return ProviderModelsResultSchema.parse({
        models: [],
        status: "unsupported",
        authoritative: false,
        message: `Provider ${config.id} does not expose model discovery.`,
        fetchedAt: new Date().toISOString(),
      });
    }
    return ProviderModelsResultSchema.parse(await provider.listModels());
  } catch (error) {
    return ProviderModelsResultSchema.parse({
      models: [],
      status: "error",
      authoritative: false,
      message: error instanceof Error ? error.message : "Failed to fetch provider model list.",
      fetchedAt: new Date().toISOString(),
    });
  }
}

export function createProviderRegistry(
  config: SharedProviderRegistry,
  options: ProviderRegistryOptions = {}
): ProviderRegistry {
  const providerConfigs = [...config.providers];
  const cache = new Map<string, ModelProvider>();
  const providerHealthGuard = options.providerHealthGuard ?? defaultProviderHealthGuard;

  const resolveConfig = (providerId?: string) => {
    const id = providerId ?? config.defaultProviderId;
    const providerConfig = providerConfigs.find((entry) => entry.enabled !== false && entry.id === id)
      ?? providerConfigs.find((entry) => entry.enabled !== false && entry.modelId === id);
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
      return providerHealthGuard.run(
        providerConfig.id,
        () => traceLangfuseGeneration(
          {
            providerId: providerConfig.id,
            modelId: providerConfig.modelId,
            providerType: providerConfig.type,
            request
          },
          () => provider(request)
        )
      );
    },
    async invokeStream(providerId: string | undefined, request: ModelRequest, callbacks?: ModelStreamCallbacks) {
      const providerConfig = resolveConfig(providerId);
      const provider = resolve(providerConfig.id);
      const stream = provider.stream ?? streamFallback(provider);
      return providerHealthGuard.run(
        providerConfig.id,
        () => traceLangfuseGeneration(
          {
            providerId: providerConfig.id,
            modelId: providerConfig.modelId,
            providerType: providerConfig.type,
            request
          },
          () => stream(request, callbacks)
        )
      );
    },
  };
}

function resolveDefaultProviderId(providers: ProviderConfig[]): string {
  return providers.find((p) => p.enabled !== false)?.id ?? providers[0]?.id ?? "";
}

export function createDefaultProviderRegistry(options: ProviderRegistryOptions = {}) {
  const providers = withRuntimeSmokeFallback(DEFAULT_PROVIDERS);
  return createProviderRegistry(
    {
      providers,
      defaultProviderId: resolveDefaultProviderId(providers),
    },
    options
  );
}

export function createProviderRegistryForRun(
  runConfig: RunConfig,
  options: ProviderRegistryOptions = {}
): ProviderRegistry {
  const providers = withRuntimeSmokeFallback(runConfig.providerConfig
    ? [
        runConfig.providerConfig,
        ...DEFAULT_PROVIDERS.filter((provider) => provider.id !== runConfig.providerConfig?.id),
      ]
    : DEFAULT_PROVIDERS);

  return createProviderRegistry(
    {
      providers,
      defaultProviderId: runConfig.providerConfig?.id ?? resolveDefaultProviderId(providers),
    },
    options
  );
}

export function configuredProviderId(config: RunConfig): string | undefined {
  const providerId = config.providerId ?? config.metadata.providerId;
  return typeof providerId === "string" ? providerId : config.modelRef;
}

function applyEffectiveStrategy(config: RunConfig, request: ModelRequest): ModelRequest {
  const effort = config.effectiveStrategy?.reasoningEffort;
  if (
    request.reasoningEffort ||
    !config.effectiveStrategy?.providerThinkingEnabled ||
    effort === undefined ||
    effort === "none"
  ) {
    return request;
  }
  return {
    ...request,
    reasoningEffort: effort,
  };
}

export async function invokeRunProvider(
  config: RunConfig,
  request: ModelRequest,
  options: ProviderRegistryOptions = {}
) {
  return createProviderRegistryForRun(config, options).invoke(configuredProviderId(config), applyEffectiveStrategy(config, request));
}

export async function invokeRunProviderStream(
  config: RunConfig,
  request: ModelRequest,
  callbacks?: ModelStreamCallbacks,
  options: ProviderRegistryOptions = {}
) {
  return createProviderRegistryForRun(config, options).invokeStream(configuredProviderId(config), applyEffectiveStrategy(config, request), callbacks);
}

export async function verifyProviderConfig(
  config: ProviderConfig,
  options: ProviderRuntimeOptions = {}
): Promise<ProviderStatus> {
  if (!config.modelId.trim()) {
    return {
      providerId: config.id,
      state: "not_configured",
      detail: "Model ID is required before verification.",
      checkedAt: Date.now(),
    };
  }

  if ((config.type === "openai_compatible" || config.type === "anthropic_compatible") && !config.baseUrl?.trim()) {
    return {
      providerId: config.id,
      state: "not_configured",
      detail: "Base URL is required before verification.",
      checkedAt: Date.now(),
    };
  }

  const modelList = await fetchProviderModels(config, options);
  if (modelList.status === "error") {
    return {
      providerId: config.id,
      state: "failed",
      detail: `Failed to fetch provider model list: ${modelList.message ?? "Unknown error"}`,
      checkedAt: Date.now(),
    };
  }

  if (modelList.status === "ok" && modelList.authoritative) {
    const modelIds = new Set(modelList.models.map((model) => model.id));
    if (!modelIds.has(config.modelId)) {
      return {
        providerId: config.id,
        state: "failed",
        detail: `Model "${config.modelId}" was not found in provider model list.`,
        checkedAt: Date.now(),
      };
    }
  }

  try {
    const provider = createModelProvider(config, options);
    await provider({
      prompt: "Reply with OK.",
      system: "Respond with a short connectivity acknowledgement.",
      maxTokens: 16,
      temperature: 0,
    });

    return {
      providerId: config.id,
      state: "verified",
      detail: modelList.status === "unsupported"
        ? "Connection verified. Model discovery is not supported by this provider, so the model was verified by smoke call only."
        : "Connection verified.",
      checkedAt: Date.now(),
    };
  } catch (error) {
    return {
      providerId: config.id,
      state: "failed",
      detail: error instanceof Error ? error.message : "Provider verification failed.",
      checkedAt: Date.now(),
    };
  }
}
