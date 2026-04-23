import type { ProviderConfig } from "@ora/shared";
import { appendIfDefined, extractTextFromValue, failMissingApiKey, normalizeMessages, readProviderApiKey, resolveProviderEndpoint, splitInstructionMessages } from "./provider-utils.js";
import type { ModelProvider, ModelResponse, ProviderRuntimeOptions } from "./types.js";

function createError(status: number, body: string, providerId: string) {
  return new Error(`Anthropic provider ${providerId} failed with ${status}: ${body}`);
}

export function createAnthropicProvider(
  config: ProviderConfig,
  options: ProviderRuntimeOptions = {}
): ModelProvider {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const env = options.env ?? process.env;

  return async (request) => {
    const apiKey = readProviderApiKey(config, "ANTHROPIC_API_KEY", env);
    if (!apiKey) {
      throw failMissingApiKey(config.id, "ANTHROPIC_API_KEY");
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
      defaultOrigin: "https://api.anthropic.com",
      path: "/v1/messages",
      env,
    }), {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: request.signal,
    });

    const rawText = await response.text();
    if (!response.ok) {
      throw createError(response.status, rawText, config.id);
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
