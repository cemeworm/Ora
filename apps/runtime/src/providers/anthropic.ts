import { ProviderModelsResultSchema, type ProviderConfig, type ProviderModelsResult } from "@cemeworm/shared";
import { anthropicTools, appendIfDefined, extractAnthropicToolCalls, extractTextFromValue, failMissingApiKey, normalizeMessages, providerToolName, readProviderApiKey, resolveProviderEndpoint, splitInstructionMessages } from "./provider-utils.js";
import type { ModelMessage, ModelProvider, ModelResponse, ProviderRuntimeOptions } from "./types.js";
import { anthropicTextDelta, emitTextDelta, readSseMessages } from "./streaming.js";

function parseAnthropicModels(raw: unknown): ProviderModelsResult["models"] {
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
        : undefined;
    if (!id?.trim()) {
      return [];
    }
    return [{
      id,
      name: typeof model.display_name === "string"
        ? model.display_name
        : typeof model.name === "string" && model.name !== id
          ? model.name
          : undefined,
      created: typeof model.created === "number" && Number.isInteger(model.created) && model.created >= 0
        ? model.created
        : undefined,
      ownedBy: typeof model.owned_by === "string" ? model.owned_by : undefined,
      source: "remote" as const,
    }];
  });
}

function unsupportedAnthropicModelsResult(config: ProviderConfig): ProviderModelsResult {
  return ProviderModelsResultSchema.parse({
    models: [],
    status: "unsupported",
    authoritative: false,
    message: `Provider ${config.id} does not expose model discovery.`,
    fetchedAt: new Date().toISOString(),
  });
}

export async function listAnthropicStyleModels(
  config: ProviderConfig,
  options: ProviderRuntimeOptions = {},
  settings: {
    fallbackEnvName: string;
    allowCustomBaseUrl?: boolean;
    defaultOrigin?: string;
    defaultVersion?: string;
    errorLabel?: string;
    unsupportedOnNotImplemented?: boolean;
  }
): Promise<ProviderModelsResult> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const env = options.env ?? process.env;
  const apiKey = readProviderApiKey(config, settings.fallbackEnvName, env);
  if (!apiKey) {
    return ProviderModelsResultSchema.parse({
      models: [],
      status: "error",
      authoritative: false,
      message: failMissingApiKey(config.id, settings.fallbackEnvName).message,
      fetchedAt: new Date().toISOString(),
    });
  }

  try {
    const response = await fetchImpl(resolveProviderEndpoint({
      providerId: config.id,
      baseUrl: config.baseUrl,
      defaultOrigin: settings.defaultOrigin ?? "https://api.anthropic.com",
      path: "/v1/models",
      env,
      allowCustomBaseUrl: settings.allowCustomBaseUrl,
    }), {
      method: "GET",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": config.anthropicVersion ?? settings.defaultVersion ?? "2023-06-01",
        ...(config.headers ?? {}),
      },
    });
    const rawText = await response.text();
    if (settings.unsupportedOnNotImplemented && [404, 405, 501].includes(response.status)) {
      return unsupportedAnthropicModelsResult(config);
    }
    if (!response.ok) {
      return ProviderModelsResultSchema.parse({
        models: [],
        status: "error",
        authoritative: false,
        message: `${settings.errorLabel ?? "Anthropic"} provider ${config.id} model list failed with ${response.status}: ${rawText}`,
        fetchedAt: new Date().toISOString(),
      });
    }

    const raw = rawText ? JSON.parse(rawText) : {};
    const models = parseAnthropicModels(raw);
    if (models.length === 0) {
      return settings.unsupportedOnNotImplemented
        ? unsupportedAnthropicModelsResult(config)
        : ProviderModelsResultSchema.parse({
            models: [],
            status: "error",
            authoritative: false,
            message: `${settings.errorLabel ?? "Anthropic"} provider ${config.id} returned no parseable model IDs.`,
            fetchedAt: new Date().toISOString(),
          });
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
      message: error instanceof Error ? error.message : "Failed to fetch Anthropic model list.",
      fetchedAt: new Date().toISOString(),
    });
  }
}

export function createAnthropicStyleProvider(
  config: ProviderConfig,
  options: ProviderRuntimeOptions = {},
  settings: {
    fallbackEnvName: string;
    allowCustomBaseUrl?: boolean;
    defaultOrigin?: string;
    defaultVersion?: string;
    errorLabel?: string;
    unsupportedOnNotImplemented?: boolean;
  }
): ModelProvider {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const env = options.env ?? process.env;

  const buildPayload = (request: Parameters<ModelProvider>[0]) => {
    const messages = normalizeMessages(request);
    const { instructions, dialog } = splitInstructionMessages(messages);
    const system = [request.system?.trim(), instructions].filter(Boolean).join("\n\n");
    const conversation: ModelMessage[] = dialog.length > 0 ? dialog : [{ role: "user", content: request.prompt?.trim() || "" }];

    const body = appendIfDefined(
      {
        model: config.modelId,
        max_tokens: request.maxTokens ?? config.maxTokens ?? 1024,
        messages: conversation.map((message) => {
          if (message.role === "tool") {
            return {
              role: "user",
              content: [{
                type: "tool_result",
                tool_use_id: message.toolCallId,
                content: message.content,
                is_error: false,
              }],
            };
          }
          if (message.role === "assistant" && message.toolCalls?.length) {
            return {
              role: "assistant",
              content: [
                ...(message.content.trim() ? [{ type: "text", text: message.content }] : []),
                ...message.toolCalls.map((call) => ({
                  type: "tool_use",
                  id: call.id,
                  name: providerToolName(call.toolId),
                  input: call.args ?? {},
                })),
              ],
            };
          }
          return {
            role: message.role === "developer" ? "assistant" : message.role,
            content: message.content,
          };
        }),
      },
      "system",
      system || undefined
    );
    const withTools = appendIfDefined(body, "tools", anthropicTools(request.tools));
    const withChoice = request.tools?.length && request.toolChoice === "none"
      ? appendIfDefined(withTools, "tool_choice", { type: "none" })
      : withTools;

    return appendIfDefined(
      withChoice,
      "temperature",
      config.temperature ?? request.temperature
    );
  };

  const endpoint = () => resolveProviderEndpoint({
    providerId: config.id,
    baseUrl: config.baseUrl,
    defaultOrigin: settings.defaultOrigin ?? "https://api.anthropic.com",
    path: "/v1/messages",
    env,
    allowCustomBaseUrl: settings.allowCustomBaseUrl,
  });

  const provider: ModelProvider = async (request) => {
    const apiKey = readProviderApiKey(config, settings.fallbackEnvName, env);
    if (!apiKey) {
      throw failMissingApiKey(config.id, settings.fallbackEnvName);
    }

    const payload = buildPayload(request);

    const response = await fetchImpl(endpoint(), {
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
      toolCalls: extractAnthropicToolCalls(raw, request.tools),
      finishReason: typeof (raw as Record<string, unknown>).stop_reason === "string"
        ? (raw as Record<string, unknown>).stop_reason as string
        : undefined,
    } satisfies ModelResponse;
  };

  provider.listModels = () => listAnthropicStyleModels(config, options, settings);

  provider.stream = async (request, callbacks) => {
    const apiKey = readProviderApiKey(config, settings.fallbackEnvName, env);
    if (!apiKey) {
      throw failMissingApiKey(config.id, settings.fallbackEnvName);
    }

    const response = await fetchImpl(endpoint(), {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": config.anthropicVersion ?? settings.defaultVersion ?? "2023-06-01",
        "content-type": "application/json",
        ...(config.headers ?? {}),
      },
      body: JSON.stringify({ ...buildPayload(request), stream: true }),
      signal: request.signal,
    });

    if (!response.ok) {
      throw new Error(`${settings.errorLabel ?? "Anthropic"} provider ${config.id} failed with ${response.status}: ${await response.text()}`);
    }

    let text = "";
    let sawStreamFrame = false;
    const rawEvents = await readSseMessages(response, async (message) => {
      const data = JSON.parse(message.data) as unknown;
      if (!sawStreamFrame) {
        sawStreamFrame = true;
        await callbacks?.onStreamEvent?.({ kind: "sse_frame", streamMode: "sse", raw: data });
      }
      const delta = anthropicTextDelta(data);
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
    } satisfies ModelResponse;
  };

  return provider;
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
