import type { OraProviderConfig, OraProviderSecretStatus } from "./runtimeClient";

export function isProviderRunnable(
  provider: OraProviderConfig,
  secretStatuses: readonly OraProviderSecretStatus[],
) {
  if (provider.type === "local_smoke") {
    return false;
  }
  if (provider.enabled === false) {
    return false;
  }
  return secretStatuses.some((status) => status.providerId === provider.id && status.hasSecret);
}

export function runnableProviderOptions(
  providers: readonly OraProviderConfig[],
  secretStatuses: readonly OraProviderSecretStatus[],
) {
  const runnable = providers.filter((provider) => isProviderRunnable(provider, secretStatuses));
  return runnable.length > 0
    ? runnable
    : providers.filter((provider) => provider.enabled !== false && provider.type !== "local_smoke");
}
