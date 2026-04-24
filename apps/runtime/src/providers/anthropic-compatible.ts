import type { ProviderConfig } from "@ora/shared";
import { createAnthropicStyleProvider } from "./anthropic.js";
import type { ModelProvider, ProviderRuntimeOptions } from "./types.js";

export function createAnthropicCompatibleProvider(
  config: ProviderConfig,
  options: ProviderRuntimeOptions = {}
): ModelProvider {
  return createAnthropicStyleProvider(config, options, {
    fallbackEnvName: config.apiKeyEnv ?? `${config.id.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_API_KEY`,
    allowCustomBaseUrl: true,
    defaultOrigin: config.baseUrl ?? "https://api.anthropic.com",
    defaultVersion: config.anthropicVersion ?? "2023-06-01",
    errorLabel: "Anthropic-compatible",
  });
}
