import type { OraProviderConfig, OraProviderRegistry } from "./runtimeClient";
import { getModelProviderBaseId } from "./providerPresets";

function isEnabled(provider: OraProviderConfig | undefined): provider is OraProviderConfig {
  return Boolean(provider && provider.enabled !== false);
}

export function chooseEnabledProviderId(
  registry: OraProviderRegistry | undefined,
  options: {
    preferredProviderId?: string;
    currentProviderId?: string;
    previousProviderId?: string;
  } = {},
): string {
  const providers = registry?.providers ?? [];
  const byId = new Map(providers.map((provider) => [provider.id, provider]));
  const preferred = byId.get(options.preferredProviderId ?? "");
  if (isEnabled(preferred)) {
    return preferred.id;
  }

  const current = byId.get(options.currentProviderId ?? "");
  if (isEnabled(current)) {
    return current.id;
  }

  const previousBaseId = options.previousProviderId ? getModelProviderBaseId(options.previousProviderId) : undefined;
  const sameGroup = previousBaseId
    ? providers.find((provider) => getModelProviderBaseId(provider.id) === previousBaseId && isEnabled(provider))
    : undefined;
  if (sameGroup) {
    return sameGroup.id;
  }

  const defaultProvider = byId.get(registry?.defaultProviderId ?? "");
  if (isEnabled(defaultProvider)) {
    return defaultProvider.id;
  }

  const nonLocal = providers.find((provider) => provider.type !== "local_smoke" && isEnabled(provider));
  if (nonLocal) {
    return nonLocal.id;
  }

  return providers.find(isEnabled)?.id ?? registry?.defaultProviderId ?? "local-smoke";
}

export function chooseBootstrapProviderId(
  registry: OraProviderRegistry | undefined,
): string {
  const providers = registry?.providers ?? [];
  const byId = new Map(providers.map((provider) => [provider.id, provider]));

  const nonLocal = providers.find(
    (provider) => provider.type !== "local_smoke" && isEnabled(provider),
  );
  if (nonLocal) {
    return nonLocal.id;
  }

  const defaultProvider = byId.get(registry?.defaultProviderId ?? "");
  if (isEnabled(defaultProvider)) {
    return defaultProvider.id;
  }

  return providers.find(isEnabled)?.id ?? registry?.defaultProviderId ?? "local-smoke";
}
