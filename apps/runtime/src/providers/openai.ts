import type { ProviderConfig } from "@ora/shared";
import { appendIfDefined, buildResponsesInput, extractOpenAiResponsesStreamToolCalls, extractOpenAiResponsesToolCalls, extractTextFromValue, failMissingApiKey, openAiResponsesTools, readProviderApiKey, resolveProviderEndpoint } from "./provider-utils.js";
import type { ModelProvider, ModelResponse, ProviderRuntimeOptions } from "./types.js";
import { emitTextDelta, openAiResponsesDelta, readSseMessages } from "./streaming.js";

function createError(status: number, body: string, providerId: string) {
  return new Error(`OpenAI provider ${providerId} failed with ${status}: ${body}`);
}

export function createOpenAIProvider(
  config: ProviderConfig,
  options: ProviderRuntimeOptions = {}
): ModelProvider {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const env = options.env ?? process.env;

  const provider: ModelProvider = async (request) => {
    const apiKey = readProviderApiKey(config, "OPENAI_API_KEY", env);
    if (!apiKey) {
      throw failMissingApiKey(config.id, "OPENAI_API_KEY");
    }

    const body = appendIfDefined(
      {
        model: config.modelId,
        input: buildResponsesInput(request),
      },
      "max_output_tokens",
      request.maxTokens ?? config.maxTokens
    );
    const withTools = appendIfDefined(body, "tools", openAiResponsesTools(request.tools));
    const withChoice = request.tools?.length
      ? appendIfDefined(withTools, "tool_choice", request.toolChoice ?? "auto")
      : withTools;

    const payload = appendIfDefined(
      withChoice,
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
        ...(config.headers ?? {}),
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
      toolCalls: extractOpenAiResponsesToolCalls(raw, request.tools),
      finishReason: typeof (raw as Record<string, unknown>).status === "string"
        ? (raw as Record<string, unknown>).status as string
        : undefined,
    } satisfies ModelResponse;
  };

  provider.stream = async (request, callbacks) => {
    const apiKey = readProviderApiKey(config, "OPENAI_API_KEY", env);
    if (!apiKey) {
      throw failMissingApiKey(config.id, "OPENAI_API_KEY");
    }

    const body = appendIfDefined(
      {
        model: config.modelId,
        input: buildResponsesInput(request),
        stream: true,
      },
      "max_output_tokens",
      request.maxTokens ?? config.maxTokens
    );
    const withTools = appendIfDefined(body, "tools", openAiResponsesTools(request.tools));
    const withChoice = request.tools?.length
      ? appendIfDefined(withTools, "tool_choice", request.toolChoice ?? "auto")
      : withTools;

    const payload = appendIfDefined(
      withChoice,
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
        ...(config.headers ?? {}),
      },
      body: JSON.stringify(payload),
      signal: request.signal,
    });

    if (!response.ok) {
      throw createError(response.status, await response.text(), config.id);
    }

    let text = "";
    const rawEvents = await readSseMessages(response, async (message) => {
      const data = JSON.parse(message.data) as unknown;
      const delta = openAiResponsesDelta(data);
      if (!delta) return;
      text += delta;
      await emitTextDelta(callbacks, { delta, text, raw: data });
    });

    return {
      providerId: config.id,
      providerType: config.type,
      modelId: config.modelId,
      text,
      raw: {
        streamMode: "sse",
        events: rawEvents,
      },
      toolCalls: extractOpenAiResponsesStreamToolCalls(rawEvents, request.tools),
    } satisfies ModelResponse;
  };

  return provider;
}
