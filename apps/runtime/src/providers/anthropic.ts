import type { ProviderConfig } from "@ora/shared";
import { appendIfDefined, extractTextFromValue, failMissingApiKey, normalizeMessages, readProviderApiKey, resolveProviderEndpoint, splitInstructionMessages } from "./provider-utils.js";
import type { ModelProvider, ModelResponse, ProviderRuntimeOptions } from "./types.js";

export function createAnthropicStyleProvider(
  config: ProviderConfig,
  options: ProviderRuntimeOptions = {},
  settings: {
    fallbackEnvName: string;
    allowCustomBaseUrl?: boolean;
    defaultOrigin?: string;
    defaultVersion?: string;
    errorLabel?: string;
  }
): ModelProvider {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const env = options.env ?? process.env;

  return async (request) => {
    const apiKey = readProviderApiKey(config, settings.fallbackEnvName, env);
    if (!apiKey) {
      throw failMissingApiKey(config.id, settings.fallbackEnvName);
    }

    const messages = normalizeMessages(request);
    const { instructions, dialog } = splitInstructionMessages(messages);
    const system = [request.system?.trim(), instructions].filter(Boolean).join("\n\n");
    const conversation = dialog.length > 0 ? dialog : [{ role: "user", content: request.prompt?.trim() || "" }];

    const body = appendIfDefined(
      {
        model: config.modelId,
        max_tokens: request.maxTokens ?? config.maxTokens ?? 1024,
        messages: conversation.map((message) => ({
          role: message.role,
          content: message.content,
        })),
      },
      "system",
      system || undefined
    );

    const payload = appendIfDefined(
      body,
      "temperature",
      request.temperature ?? config.temperature
    );

    const response = await fetchImpl(resolveProviderEndpoint({
      providerId: config.id,
      baseUrl: config.baseUrl,
      defaultOrigin: settings.defaultOrigin ?? "https://api.anthropic.com",
      path: "/v1/messages",
      env,
      allowCustomBaseUrl: settings.allowCustomBaseUrl,
    }), {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": config.anthropicVersion ?? settings.defaultVersion ?? "2023-06-01",
        "content-type": "application/json",
        ...(config.headers ?? {}),
      },
      body: JSON.stringify(payload),
      signal: request.signal,
    });

    const rawText = await response.text();
    if (!response.ok) {
      throw new Error(`${settings.errorLabel ?? "Anthropic"} provider ${config.id} failed with ${response.status}: ${rawText}`);
    }

    const raw = rawText ? JSON.parse(rawText) : {};
    const text = extractTextFromValue(raw);
    return {
      providerId: config.id,
      providerType: config.type,
      modelId: config.modelId,
      text,
      raw,
    } satisfies ModelResponse;
  };
}

export function createAnthropicProvider(
  config: ProviderConfig,
  options: ProviderRuntimeOptions = {}
): ModelProvider {
  return createAnthropicStyleProvider(config, options, {
    fallbackEnvName: "ANTHROPIC_API_KEY",
    errorLabel: "Anthropic",
  });
}
