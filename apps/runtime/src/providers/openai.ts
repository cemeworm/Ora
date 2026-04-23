import type { ProviderConfig } from "@ora/shared";
import { appendIfDefined, extractTextFromValue, failMissingApiKey, normalizeMessages, readProviderApiKey, resolveProviderEndpoint, splitInstructionMessages, toInputText } from "./provider-utils.js";
import type { ModelProvider, ModelResponse, ProviderRuntimeOptions } from "./types.js";

function createError(status: number, body: string, providerId: string) {
  return new Error(`OpenAI provider ${providerId} failed with ${status}: ${body}`);
}

export function createOpenAIProvider(
  config: ProviderConfig,
  options: ProviderRuntimeOptions = {}
): ModelProvider {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const env = options.env ?? process.env;

  return async (request) => {
    const apiKey = readProviderApiKey(config, "OPENAI_API_KEY", env);
    if (!apiKey) {
      throw failMissingApiKey(config.id, "OPENAI_API_KEY");
    }

    const messages = normalizeMessages(request);
    const { instructions, dialog } = splitInstructionMessages(messages);
    const input = [
      ...(instructions
        ? [
            {
              type: "message",
              role: "developer",
              content: toInputText(request.system?.trim() ? `${request.system.trim()}\n\n${instructions}` : instructions),
            }
          ]
        : request.system?.trim()
          ? [{ type: "message", role: "developer", content: toInputText(request.system.trim()) }]
          : []),
      ...dialog.map((message) => ({
        type: "message",
        role: message.role,
        content: toInputText(message.content),
      })),
    ];

    const body = appendIfDefined(
      {
        model: config.modelId,
        input,
      },
      "max_output_tokens",
      request.maxTokens ?? config.maxTokens
    );

    const payload = appendIfDefined(
      body,
      "temperature",
      request.temperature ?? config.temperature
    );

    const response = await fetchImpl(resolveProviderEndpoint({
      providerId: config.id,
      baseUrl: config.baseUrl,
      defaultOrigin: "https://api.openai.com",
      path: "/v1/responses",
      env,
    }), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
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
