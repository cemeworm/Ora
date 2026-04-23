import type { ProviderConfig } from "@ora/shared";
import {
  appendIfDefined,
  extractTextFromValue,
  failMissingApiKey,
  normalizeMessages,
  readProviderApiKey,
  splitInstructionMessages,
} from "./provider-utils.js";
import type { ModelProvider, ModelResponse, ProviderRuntimeOptions } from "./types.js";

function createError(status: number, body: string, providerId: string) {
  return new Error(`OpenAI-compatible provider ${providerId} failed with ${status}: ${body}`);
}

function resolveChatCompletionsEndpoint(baseUrl: string, providerId: string): string {
  const url = new URL(baseUrl);
  if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
    throw new Error(`Provider ${providerId} endpoint must use HTTPS unless it targets localhost`);
  }

  let pathname = url.pathname.replace(/\/+$/, "");
  if (!pathname.endsWith("/chat/completions")) {
    pathname = pathname.endsWith("/v1")
      ? `${pathname}/chat/completions`
      : `${pathname}/v1/chat/completions`;
  }
  url.pathname = pathname;
  return url.href;
}

function configuredPayload<T extends Record<string, unknown>>(payload: T, dropParams: readonly string[]): T {
  if (dropParams.length === 0) {
    return payload;
  }

  const next = { ...payload };
  for (const key of dropParams) {
    delete next[key];
  }
  return next;
}

export function createOpenAICompatibleProvider(
  config: ProviderConfig,
  options: ProviderRuntimeOptions = {}
): ModelProvider {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const env = options.env ?? process.env;

  return async (request) => {
    if (!config.baseUrl) {
      throw new Error(`OpenAI-compatible provider ${config.id} requires a baseUrl`);
    }

    const envName = config.apiKeyEnv ?? `${config.id.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_API_KEY`;
    const apiKey = readProviderApiKey(config, envName, env);
    if (!apiKey) {
      throw failMissingApiKey(config.id, `${envName} or macOS Keychain service ora.provider.${config.id}`);
    }

    const messages = normalizeMessages(request);
    const { instructions, dialog } = splitInstructionMessages(messages);
    const chatMessages = [
      ...(request.system?.trim() ? [{ role: "system", content: request.system.trim() }] : []),
      ...(instructions ? [{ role: "system", content: instructions }] : []),
      ...dialog.map((message) => ({
        role: message.role === "developer" ? "system" : message.role,
        content: message.content,
      })),
    ];

    const body = appendIfDefined(
      {
        model: config.modelId,
        messages: chatMessages,
      },
      "max_tokens",
      request.maxTokens ?? config.maxTokens
    );

    const payload = configuredPayload(
      appendIfDefined(body, "temperature", request.temperature ?? config.temperature),
      config.dropParams
    );

    const response = await fetchImpl(resolveChatCompletionsEndpoint(config.baseUrl, config.id), {
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
