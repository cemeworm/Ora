import { ProviderModelsResultSchema, type ProviderConfig, type ProviderModelsResult } from "@cemeworm/shared";
import {
  appendIfDefined,
  buildResponsesInput,
  extractOpenAiChatReasoningContent,
  extractOpenAiChatStreamReasoningContent,
  extractOpenAiChatToolCalls,
  extractOpenAiChatStreamToolCalls,
  extractOpenAiResponsesToolCalls,
  extractOpenAiResponsesStreamToolCalls,
  extractTextFromValue,
  failMissingApiKey,
  normalizeMessages,
  openAiChatTools,
  openAiResponsesTools,
  providerToolName,
  readProviderApiKey,
  resolveCompatibleProviderEndpoint,
  splitInstructionMessages,
} from "./provider-utils.js";
import type { ModelProvider, ModelResponse, ProviderRuntimeOptions } from "./types.js";
import { emitTextDelta, openAiChatDelta, openAiResponsesDelta, readSseMessages } from "./streaming.js";

function createError(status: number, body: string, providerId: string) {
  return new Error(`OpenAI-compatible provider ${providerId} failed with ${status}: ${body}`);
}

function compatibleEnvName(config: ProviderConfig) {
  return config.apiKeyEnv ?? `${config.id.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_API_KEY`;
}

function parseCompatibleModels(raw: unknown): ProviderModelsResult["models"] {
  const record = raw && typeof raw === "object" ? raw as Record<string, unknown> : undefined;
  const source = Array.isArray(record?.data)
    ? record.data
    : Array.isArray(record?.models)
      ? record.models
      : undefined;
  if (!source) {
    return [];
  }

  return source.flatMap((entry) => {
    if (typeof entry === "string" && entry.trim()) {
      return [{ id: entry, source: "remote" as const }];
    }
    if (!entry || typeof entry !== "object") {
      return [];
    }
    const model = entry as Record<string, unknown>;
    const id = typeof model.id === "string"
      ? model.id
      : typeof model.name === "string"
        ? model.name
        : typeof model.model_id === "string"
          ? model.model_id
          : typeof model.modelId === "string"
            ? model.modelId
            : undefined;
    if (!id?.trim()) {
      return [];
    }
    const name = typeof model.display_name === "string"
      ? model.display_name
      : typeof model.displayName === "string"
        ? model.displayName
        : typeof model.name === "string" && model.name !== id
          ? model.name
          : undefined;
    return [{
      id,
      name,
      created: typeof model.created === "number" && Number.isInteger(model.created) && model.created >= 0
        ? model.created
        : undefined,
      ownedBy: typeof model.owned_by === "string"
        ? model.owned_by
        : typeof model.ownedBy === "string"
          ? model.ownedBy
          : typeof model.provider === "string"
            ? model.provider
            : undefined,
      source: "remote" as const,
    }];
  });
}

function resolveOpenAICompatibleModelsEndpoint(config: ProviderConfig) {
  const baseUrl = config.baseUrl ?? "";
  const url = new URL(baseUrl);
  const host = url.hostname.toLowerCase();
  if (host === "api.deepseek.com") {
    return new URL("/models", url.origin).href;
  }
  if (host === "aihubmix.com") {
    return new URL("/api/v1/models?type=llm", url.origin).href;
  }
  return resolveCompatibleProviderEndpoint({
    providerId: config.id,
    baseUrl,
    path: "/models",
  });
}

function unsupportedModelsResult(message: string): ProviderModelsResult {
  return ProviderModelsResultSchema.parse({
    models: [],
    status: "unsupported",
    authoritative: false,
    message,
    fetchedAt: new Date().toISOString(),
  });
}

export async function listOpenAICompatibleModels(
  config: ProviderConfig,
  options: ProviderRuntimeOptions = {}
): Promise<ProviderModelsResult> {
  if (!config.baseUrl) {
    return ProviderModelsResultSchema.parse({
      models: [],
      status: "error",
      authoritative: false,
      message: `OpenAI-compatible provider ${config.id} requires a baseUrl`,
      fetchedAt: new Date().toISOString(),
    });
  }

  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const env = options.env ?? process.env;
  const envName = compatibleEnvName(config);
  const apiKey = readProviderApiKey(config, envName, env);
  if (!apiKey) {
    return ProviderModelsResultSchema.parse({
      models: [],
      status: "error",
      authoritative: false,
      message: failMissingApiKey(config.id, `${envName} or macOS Keychain service ora.provider.${config.id}`).message,
      fetchedAt: new Date().toISOString(),
    });
  }

  try {
    const response = await fetchImpl(resolveOpenAICompatibleModelsEndpoint(config), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        ...(config.headers ?? {}),
      },
    });
    const rawText = await response.text();
    if ([404, 405, 501].includes(response.status)) {
      return unsupportedModelsResult(`Provider ${config.id} does not expose model discovery.`);
    }
    if (!response.ok) {
      return ProviderModelsResultSchema.parse({
        models: [],
        status: "error",
        authoritative: false,
        message: `OpenAI-compatible provider ${config.id} model list failed with ${response.status}: ${rawText}`,
        fetchedAt: new Date().toISOString(),
      });
    }

    const raw = rawText ? JSON.parse(rawText) : {};
    const models = parseCompatibleModels(raw);
    if (models.length === 0) {
      return unsupportedModelsResult(`Provider ${config.id} returned no parseable model IDs.`);
    }
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
      message: error instanceof Error ? error.message : "Failed to fetch OpenAI-compatible model list.",
      fetchedAt: new Date().toISOString(),
    });
  }
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

function createResponsesPayload(config: ProviderConfig, request: Parameters<ModelProvider>[0]) {
  const body = appendIfDefined(
    {
      model: config.modelId,
      input: buildResponsesInput(request),
      ...(request.reasoningEffort ? { reasoning: { effort: request.reasoningEffort } } : {}),
    },
    "max_output_tokens",
    request.maxTokens ?? config.maxTokens
  );
  const withTools = appendIfDefined(body, "tools", openAiResponsesTools(request.tools));
  const withChoice = request.tools?.length
    ? appendIfDefined(withTools, "tool_choice", request.toolChoice ?? "auto")
    : withTools;

  return configuredPayload(
    appendIfDefined(withChoice, "temperature", config.temperature ?? request.temperature),
    config.dropParams ?? []
  );
}

function createChatCompletionsPayload(config: ProviderConfig, request: Parameters<ModelProvider>[0]) {
  const messages = normalizeMessages(request);
  const { instructions, dialog } = splitInstructionMessages(messages);
  const chatMessages = [
    ...(request.system?.trim() ? [{ role: "system", content: request.system.trim() }] : []),
    ...(instructions ? [{ role: "system", content: instructions }] : []),
    ...dialog.map((message) => {
      if (message.role === "tool") {
        if (!message.toolCallId) return undefined;
        return {
          role: "tool",
          tool_call_id: message.toolCallId,
          content: message.content,
        };
      }
      if (message.role === "assistant" && message.toolCalls?.length) {
        return {
          role: "assistant",
          content: message.content.trim() ? message.content : null,
          ...(message.reasoningContent !== undefined ? { reasoning_content: message.reasoningContent } : {}),
          tool_calls: message.toolCalls.map((call) => ({
            id: call.id,
            type: "function",
            function: {
              name: providerToolName(call.toolId),
              arguments: JSON.stringify(call.args ?? {}),
            },
          })),
        };
      }
      return {
        role: message.role === "developer" ? "system" : message.role,
        content: message.content,
      };
    }).filter(Boolean),
  ];

  const body = appendIfDefined(
    {
      model: config.modelId,
      messages: chatMessages,
      ...(request.reasoningEffort ? { reasoning_effort: request.reasoningEffort } : {}),
    },
    "max_tokens",
    request.maxTokens ?? config.maxTokens
  );
  const withTools = appendIfDefined(body, "tools", openAiChatTools(request.tools));
  const withChoice = request.tools?.length
    ? appendIfDefined(withTools, "tool_choice", request.toolChoice ?? "auto")
    : withTools;

  return configuredPayload(
    appendIfDefined(withChoice, "temperature", config.temperature ?? request.temperature),
    config.dropParams ?? []
  );
}

export function createOpenAICompatibleProvider(
  config: ProviderConfig,
  options: ProviderRuntimeOptions = {}
): ModelProvider {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const env = options.env ?? process.env;

  const provider: ModelProvider = async (request) => {
    if (!config.baseUrl) {
      throw new Error(`OpenAI-compatible provider ${config.id} requires a baseUrl`);
    }

    const envName = compatibleEnvName(config);
    const apiKey = readProviderApiKey(config, envName, env);
    if (!apiKey) {
      throw failMissingApiKey(config.id, `${envName} or macOS Keychain service ora.provider.${config.id}`);
    }

    const protocol = config.protocol ?? "chat_completions";
    const payload = protocol === "responses"
      ? createResponsesPayload(config, request)
      : createChatCompletionsPayload(config, request);
    const response = await fetchImpl(resolveCompatibleProviderEndpoint({
      providerId: config.id,
      baseUrl: config.baseUrl,
      path: protocol === "responses" ? "/responses" : "/chat/completions",
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
    const reasoningContent = protocol === "chat_completions"
      ? extractOpenAiChatReasoningContent(raw)
      : undefined;
    const toolCalls = protocol === "responses"
      ? extractOpenAiResponsesToolCalls(raw, request.tools)
      : extractOpenAiChatToolCalls(raw, request.tools);
    const choice = Array.isArray((raw as Record<string, unknown>).choices)
      ? ((raw as Record<string, unknown>).choices as Array<Record<string, unknown>>)[0]
      : undefined;
    return {
      providerId: config.id,
      providerType: config.type,
      modelId: config.modelId,
      text,
      reasoningContent,
      raw,
      toolCalls,
      finishReason: typeof choice?.finish_reason === "string"
        ? choice.finish_reason
        : typeof (raw as Record<string, unknown>).status === "string"
          ? (raw as Record<string, unknown>).status as string
          : undefined,
    } satisfies ModelResponse;
  };

  provider.listModels = () => listOpenAICompatibleModels(config, options);

  provider.stream = async (request, callbacks) => {
    if (!config.baseUrl) {
      throw new Error(`OpenAI-compatible provider ${config.id} requires a baseUrl`);
    }

    const envName = compatibleEnvName(config);
    const apiKey = readProviderApiKey(config, envName, env);
    if (!apiKey) {
      throw failMissingApiKey(config.id, `${envName} or macOS Keychain service ora.provider.${config.id}`);
    }

    const protocol = config.protocol ?? "chat_completions";
    const basePayload = protocol === "responses"
      ? createResponsesPayload(config, request)
      : createChatCompletionsPayload(config, request);
    const payload = { ...basePayload, stream: true };

    const response = await fetchImpl(resolveCompatibleProviderEndpoint({
      providerId: config.id,
      baseUrl: config.baseUrl,
      path: protocol === "responses" ? "/responses" : "/chat/completions",
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
        await callbacks?.onStreamEvent?.({ kind: "sse_frame", streamMode: "sse", raw: data });
      }
      const delta = protocol === "responses"
        ? openAiResponsesDelta(data)
        : openAiChatDelta(data);
      if (!delta) return;
      text += delta;
      await emitTextDelta(callbacks, { delta, text, raw: data });
    });
    const reasoningContent = protocol === "chat_completions"
      ? extractOpenAiChatStreamReasoningContent(rawEvents)
      : undefined;

    return {
      providerId: config.id,
      providerType: config.type,
      modelId: config.modelId,
      text,
      reasoningContent,
      raw: {
        streamMode: "sse",
        protocol,
        events: rawEvents,
      },
      toolCalls: protocol === "responses"
        ? extractOpenAiResponsesStreamToolCalls(rawEvents, request.tools)
        : extractOpenAiChatStreamToolCalls(rawEvents, request.tools),
    } satisfies ModelResponse;
  };

  return provider;
}
