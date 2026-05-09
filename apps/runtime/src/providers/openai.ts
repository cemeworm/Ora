import { ProviderModelsResultSchema, type ProviderConfig, type ProviderModelsResult } from "@cemeworm/shared";
import { appendIfDefined, buildResponsesInput, extractOpenAiResponsesStreamToolCalls, extractOpenAiResponsesToolCalls, extractOpenAiUsage, extractTextFromValue, failMissingApiKey, openAiResponsesTools, readProviderApiKey, resolveProviderEndpoint } from "./provider-utils.js";
import type { ModelProvider, ModelResponse, ProviderRuntimeOptions } from "./types.js";
import { emitTextDelta, openAiResponsesDelta, readSseMessages } from "./streaming.js";
import { logLatency } from "../latency-log.js";

function createError(status: number, body: string, providerId: string) {
  return new Error(`OpenAI provider ${providerId} failed with ${status}: ${body}`);
}

function parseOpenAIModels(raw: unknown): ProviderModelsResult["models"] {
  if (!raw || typeof raw !== "object" || !Array.isArray((raw as Record<string, unknown>).data)) {
    return [];
  }

  return ((raw as Record<string, unknown>).data as unknown[])
    .flatMap((entry) => {
      if (!entry || typeof entry !== "object") {
        return [];
      }
      const record = entry as Record<string, unknown>;
      if (typeof record.id !== "string" || !record.id.trim()) {
        return [];
      }
      return [{
        id: record.id,
        created: typeof record.created === "number" && Number.isInteger(record.created) && record.created >= 0
          ? record.created
          : undefined,
        ownedBy: typeof record.owned_by === "string" ? record.owned_by : undefined,
        source: "remote" as const,
      }];
    });
}

export async function listOpenAIModels(
  config: ProviderConfig,
  options: ProviderRuntimeOptions = {}
): Promise<ProviderModelsResult> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const env = options.env ?? process.env;
  const apiKey = readProviderApiKey(config, "OPENAI_API_KEY", env);
  if (!apiKey) {
    return ProviderModelsResultSchema.parse({
      models: [],
      status: "error",
      authoritative: false,
      message: failMissingApiKey(config.id, "OPENAI_API_KEY").message,
      fetchedAt: new Date().toISOString(),
    });
  }

  try {
    const response = await fetchImpl(resolveProviderEndpoint({
      providerId: config.id,
      baseUrl: config.baseUrl,
      defaultOrigin: "https://api.openai.com",
      path: "/v1/models",
      env,
    }), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        ...(config.headers ?? {}),
      },
    });
    const rawText = await response.text();
    if (!response.ok) {
      return ProviderModelsResultSchema.parse({
        models: [],
        status: "error",
        authoritative: false,
        message: `OpenAI provider ${config.id} model list failed with ${response.status}: ${rawText}`,
        fetchedAt: new Date().toISOString(),
      });
    }
    const raw = rawText ? JSON.parse(rawText) : {};
    const models = parseOpenAIModels(raw);
    return ProviderModelsResultSchema.parse({
      models,
      status: "ok",
      authoritative: true,
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    return ProviderModelsResultSchema.parse({
      models: [],
      status: "error",
      authoritative: false,
      message: error instanceof Error ? error.message : "Failed to fetch OpenAI model list.",
      fetchedAt: new Date().toISOString(),
    });
  }
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

    const previousResponseId = request.providerCache?.openaiPreviousResponseId?.trim();
    const deltaMessages = request.providerCache?.openaiDeltaMessages;
    const canUseContinuation = Boolean(previousResponseId && deltaMessages?.length);
    const body = appendIfDefined(
      {
        model: config.modelId,
        input: canUseContinuation
          ? buildResponsesInput({ ...request, messages: deltaMessages, system: undefined, providerCache: undefined })
          : buildResponsesInput(request),
        ...(request.reasoningEffort ? { reasoning: { effort: request.reasoningEffort } } : {}),
      },
      "max_output_tokens",
      request.maxTokens ?? config.maxTokens
    );
    const withPreviousResponse = canUseContinuation
      ? appendIfDefined(body, "previous_response_id", previousResponseId)
      : body;
    const withTools = appendIfDefined(withPreviousResponse, "tools", openAiResponsesTools(request.tools));
    const withChoice = request.tools?.length
      ? appendIfDefined(withTools, "tool_choice", request.toolChoice ?? "auto")
      : withTools;

    const payload = appendIfDefined(
      withChoice,
      "temperature",
      config.temperature ?? request.temperature
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
      usage: extractOpenAiUsage(raw),
      toolCalls: extractOpenAiResponsesToolCalls(raw, request.tools),
      finishReason: typeof (raw as Record<string, unknown>).status === "string"
        ? (raw as Record<string, unknown>).status as string
        : undefined,
      providerResponseId: typeof (raw as Record<string, unknown>).id === "string"
        ? (raw as Record<string, unknown>).id as string
        : undefined,
    } satisfies ModelResponse;
  };

  provider.listModels = () => listOpenAIModels(config, options);

  provider.stream = async (request, callbacks) => {
    const apiKey = readProviderApiKey(config, "OPENAI_API_KEY", env);
    if (!apiKey) {
      throw failMissingApiKey(config.id, "OPENAI_API_KEY");
    }

    const previousResponseId = request.providerCache?.openaiPreviousResponseId?.trim();
    const deltaMessages = request.providerCache?.openaiDeltaMessages;
    const canUseContinuation = Boolean(previousResponseId && deltaMessages?.length);
    const body = appendIfDefined(
      {
        model: config.modelId,
        input: canUseContinuation
          ? buildResponsesInput({ ...request, messages: deltaMessages, system: undefined, providerCache: undefined })
          : buildResponsesInput(request),
        stream: true,
        ...(request.reasoningEffort ? { reasoning: { effort: request.reasoningEffort } } : {}),
      },
      "max_output_tokens",
      request.maxTokens ?? config.maxTokens
    );
    const withPreviousResponse = canUseContinuation
      ? appendIfDefined(body, "previous_response_id", previousResponseId)
      : body;
    const withTools = appendIfDefined(withPreviousResponse, "tools", openAiResponsesTools(request.tools));
    const withChoice = request.tools?.length
      ? appendIfDefined(withTools, "tool_choice", request.toolChoice ?? "auto")
      : withTools;

    const payload = appendIfDefined(
      withChoice,
      "temperature",
      config.temperature ?? request.temperature
    );

    const tNow = Date.now();
    const invokeModelElapsed = tNow - (((globalThis as any).__latencyInvokeModelStart as number) ?? tNow);
    (globalThis as any).__latencyFetchStart = tNow;
    logLatency("invokeModel→fetch", invokeModelElapsed);
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
    let sawStreamFrame = false;
    const rawEvents = await readSseMessages(response, async (message) => {
      const data = JSON.parse(message.data) as unknown;
      if (!sawStreamFrame) {
        sawStreamFrame = true;
        const fetchElapsed = Date.now() - (((globalThis as any).__latencyFetchStart as number) ?? 0);
        logLatency("fetch→firstSSE", fetchElapsed);
        await callbacks?.onStreamEvent?.({ kind: "sse_frame", streamMode: "sse", raw: data });
      }
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
        eventCount: rawEvents.length,
        responseId: openAiResponsesStreamResponseId(rawEvents),
      },
      usage: extractOpenAiUsage(rawEvents),
      toolCalls: extractOpenAiResponsesStreamToolCalls(rawEvents, request.tools),
      providerResponseId: openAiResponsesStreamResponseId(rawEvents),
    } satisfies ModelResponse;
  };

  return provider;
}

function openAiResponsesStreamResponseId(rawEvents: readonly unknown[]): string | undefined {
  for (const event of rawEvents) {
    if (!event || typeof event !== "object") continue;
    const record = event as Record<string, unknown>;
    const response = record.response;
    if (response && typeof response === "object" && typeof (response as Record<string, unknown>).id === "string") {
      return (response as Record<string, unknown>).id as string;
    }
    if (typeof record.id === "string" && record.id.startsWith("resp_")) {
      return record.id;
    }
  }
  return undefined;
}
