import type { ProviderConfig } from "@ora/shared";
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
    },
    "max_output_tokens",
    request.maxTokens ?? config.maxTokens
  );
  const withTools = appendIfDefined(body, "tools", openAiResponsesTools(request.tools));
  const withChoice = request.tools?.length
    ? appendIfDefined(withTools, "tool_choice", request.toolChoice ?? "auto")
    : withTools;

  return configuredPayload(
    appendIfDefined(withChoice, "temperature", request.temperature ?? config.temperature),
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
    }),
  ];

  const body = appendIfDefined(
    {
      model: config.modelId,
      messages: chatMessages,
    },
    "max_tokens",
    request.maxTokens ?? config.maxTokens
  );
  const withTools = appendIfDefined(body, "tools", openAiChatTools(request.tools));
  const withChoice = request.tools?.length
    ? appendIfDefined(withTools, "tool_choice", request.toolChoice ?? "auto")
    : withTools;

  return configuredPayload(
    appendIfDefined(withChoice, "temperature", request.temperature ?? config.temperature),
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

    const envName = config.apiKeyEnv ?? `${config.id.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_API_KEY`;
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

  provider.stream = async (request, callbacks) => {
    if (!config.baseUrl) {
      throw new Error(`OpenAI-compatible provider ${config.id} requires a baseUrl`);
    }

    const envName = config.apiKeyEnv ?? `${config.id.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_API_KEY`;
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
    const rawEvents = await readSseMessages(response, async (message) => {
      const data = JSON.parse(message.data) as unknown;
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
