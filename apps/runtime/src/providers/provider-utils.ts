import { execFileSync } from "node:child_process";
import type { ModelTokenUsage, ProviderConfig } from "@cemeworm/shared";
import type { ModelMessage, ModelRequest, ModelToolCall, ModelToolDefinition } from "./types.js";
import { ProxyAgent } from "undici";

export interface ProviderFetchContext {
  providerId: string;
  providerType: string;
  modelId?: string;
  operation: string;
  endpoint: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  proxyEnv?: NodeJS.ProcessEnv;
}

export class ProviderFetchError extends Error {
  constructor(
    public readonly context: ProviderFetchContext,
    cause: unknown,
  ) {
    super(providerFetchErrorMessage(context, cause), { cause });
    this.name = "ProviderFetchError";
  }
}

const DEFAULT_PROVIDER_FETCH_TIMEOUT_MS = 3 * 60 * 1000; // 3 minutes

export async function fetchProviderEndpoint(
  fetchImpl: typeof fetch,
  context: ProviderFetchContext,
  init: RequestInit,
): Promise<Response> {
  const effectiveTimeoutMs = context.timeoutMs ?? DEFAULT_PROVIDER_FETCH_TIMEOUT_MS;
  const controller = effectiveTimeoutMs ? new AbortController() : undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const signal = mergeAbortSignals(init.signal, context.signal, controller?.signal);
  if (controller && effectiveTimeoutMs) {
    timeout = setTimeout(() => {
      controller.abort(new Error(`Provider request timed out after ${effectiveTimeoutMs}ms.`));
    }, effectiveTimeoutMs);
  }
  try {
    return await fetchImpl(context.endpoint, {
      ...init,
      signal,
      ...providerFetchProxyInit(context.endpoint, context.proxyEnv),
    });
  } catch (error) {
    throw new ProviderFetchError(context, error);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

let cachedProxy:
  | { key: string; dispatcher: InstanceType<typeof ProxyAgent> }
  | undefined;

function providerFetchProxyInit(endpoint: string, env: NodeJS.ProcessEnv | undefined): RequestInit {
  if (!env) {
    return {};
  }
  const proxyUrl = providerProxyUrl(endpoint, env);
  if (!proxyUrl) {
    return {};
  }
  if (cachedProxy?.key !== proxyUrl) {
    cachedProxy = { key: proxyUrl, dispatcher: new ProxyAgent(proxyUrl) };
  }
  return {
    dispatcher: cachedProxy.dispatcher,
  } as RequestInit;
}

function providerProxyUrl(endpoint: string, env: NodeJS.ProcessEnv): string | undefined {
  const url = new URL(endpoint);
  if (proxyBypassMatches(url.hostname, env.NO_PROXY ?? env.no_proxy)) {
    return undefined;
  }
  const raw = url.protocol === "https:"
    ? env.HTTPS_PROXY ?? env.https_proxy ?? env.ALL_PROXY ?? env.all_proxy
    : env.HTTP_PROXY ?? env.http_proxy ?? env.ALL_PROXY ?? env.all_proxy;
  return normalizeHttpProxyUrl(raw);
}

function normalizeHttpProxyUrl(raw: string | undefined): string | undefined {
  const value = raw?.trim();
  if (!value) {
    return undefined;
  }
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function proxyBypassMatches(hostname: string, rawNoProxy: string | undefined): boolean {
  const host = hostname.toLowerCase();
  return (rawNoProxy ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
    .some((entry) => {
      if (entry === "*") {
        return true;
      }
      const normalized = entry.startsWith(".") ? entry.slice(1) : entry;
      return host === normalized || host.endsWith(`.${normalized}`);
    });
}

function mergeAbortSignals(...signals: Array<AbortSignal | null | undefined>): AbortSignal | undefined {
  const activeSignals = signals.filter((signal): signal is AbortSignal => Boolean(signal));
  if (activeSignals.length === 0) {
    return undefined;
  }
  if (activeSignals.length === 1) {
    return activeSignals[0];
  }

  const controller = new AbortController();
  const abort = (signal: AbortSignal) => {
    if (!controller.signal.aborted) {
      controller.abort(signal.reason);
    }
  };
  for (const signal of activeSignals) {
    if (signal.aborted) {
      abort(signal);
      break;
    }
    signal.addEventListener("abort", () => abort(signal), { once: true });
  }
  return controller.signal;
}

function providerFetchErrorMessage(context: ProviderFetchContext, cause: unknown): string {
  const causeMessage = cause instanceof Error && cause.message.trim()
    ? cause.message.trim()
    : String(cause || "unknown fetch error");
  const causeCode = providerFetchCauseCode(cause);
  const causeSuffix = causeCode ? ` (${causeCode})` : "";
  const timeoutSuffix = context.timeoutMs ? ` timeoutMs=${context.timeoutMs}` : "";
  return `Provider ${context.providerId} ${context.operation} fetch failed for ${context.endpoint}${timeoutSuffix}: ${causeMessage}${causeSuffix}`;
}

function providerFetchCauseCode(cause: unknown): string | undefined {
  if (!cause || typeof cause !== "object") {
    return undefined;
  }
  const direct = (cause as { code?: unknown }).code;
  if (typeof direct === "string" && direct.trim()) {
    return direct.trim();
  }
  const nested = (cause as { cause?: unknown }).cause;
  if (nested && typeof nested === "object") {
    const code = (nested as { code?: unknown }).code;
    if (typeof code === "string" && code.trim()) {
      return code.trim();
    }
  }
  return undefined;
}

export function normalizeMessages(request: ModelRequest): ModelMessage[] {
  if (request.messages && request.messages.length > 0) {
    return [...request.messages];
  }

  const prompt = request.prompt?.trim();
  if (prompt) {
    return [{ role: "user", content: prompt }];
  }

  return [];
}

export function splitInstructionMessages(messages: readonly ModelMessage[]): {
  instructions: string;
  dialog: ModelMessage[];
} {
  const instructionParts: string[] = [];
  const dialog: ModelMessage[] = [];

  for (const message of messages) {
    if (message.role === "system" || message.role === "developer") {
      instructionParts.push(message.content.trim());
    } else {
      dialog.push(message);
    }
  }

  return {
    instructions: instructionParts.filter(Boolean).join("\n\n"),
    dialog,
  };
}

export function toInputText(content: string) {
  return [{ type: "input_text", text: content }];
}

export function providerToolName(toolId: string): string {
  const normalized = toolId.replace(/[^A-Za-z0-9_-]/g, "__").slice(0, 64);
  return normalized || "tool";
}

function sortedJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortedJsonValue);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, sortedJsonValue(child)]),
  );
}

function sortedTools(tools: readonly ModelToolDefinition[] | undefined): ModelToolDefinition[] {
  return [...(tools ?? [])].sort((left, right) => left.id.localeCompare(right.id));
}

export function runtimeToolIdFromProviderName(name: string, tools: readonly ModelToolDefinition[] | undefined): string {
  return tools?.find((tool) => providerToolName(tool.id) === name)?.id ?? name;
}

export function toolParametersSchema(tool: ModelToolDefinition): Record<string, unknown> {
  const parameters = tool.parameters;
  if (parameters && typeof parameters.type === "string") {
    return sortedJsonValue(parameters) as Record<string, unknown>;
  }
  return {
    type: "object",
    properties: {},
    additionalProperties: true,
  };
}

export function openAiChatTools(tools: readonly ModelToolDefinition[] | undefined) {
  if (!tools?.length) {
    return undefined;
  }
  return sortedTools(tools).map((tool) => ({
    type: "function",
    function: {
      name: providerToolName(tool.id),
      description: tool.description ?? tool.id,
      parameters: toolParametersSchema(tool),
    },
  }));
}

export function openAiResponsesTools(tools: readonly ModelToolDefinition[] | undefined) {
  if (!tools?.length) {
    return undefined;
  }
  return sortedTools(tools).map((tool) => ({
    type: "function",
    name: providerToolName(tool.id),
    description: tool.description ?? tool.id,
    parameters: toolParametersSchema(tool),
  }));
}

export function anthropicTools(tools: readonly ModelToolDefinition[] | undefined) {
  if (!tools?.length) {
    return undefined;
  }
  return sortedTools(tools).map((tool) => ({
    name: providerToolName(tool.id),
    description: tool.description ?? tool.id,
    input_schema: toolParametersSchema(tool),
  }));
}

export function parseToolArgs(value: unknown): Record<string, unknown> {
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : {};
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function extractOpenAiChatToolCalls(raw: unknown, tools: readonly ModelToolDefinition[] | undefined): ModelToolCall[] {
  if (!raw || typeof raw !== "object" || !Array.isArray((raw as Record<string, unknown>).choices)) {
    return [];
  }
  const calls: ModelToolCall[] = [];
  for (const choice of (raw as Record<string, unknown>).choices as unknown[]) {
    const message = choice && typeof choice === "object" ? (choice as Record<string, unknown>).message : undefined;
    if (!message || typeof message !== "object" || !Array.isArray((message as Record<string, unknown>).tool_calls)) {
      continue;
    }
    for (const rawCall of (message as Record<string, unknown>).tool_calls as unknown[]) {
      if (!rawCall || typeof rawCall !== "object") {
        continue;
      }
      const record = rawCall as Record<string, unknown>;
      const fn = record.function && typeof record.function === "object" ? record.function as Record<string, unknown> : {};
      const id = typeof record.id === "string" ? record.id : `tool-call-${calls.length + 1}`;
      const name = typeof fn.name === "string" ? fn.name : "";
      calls.push({
        id,
        toolId: runtimeToolIdFromProviderName(name, tools),
        args: parseToolArgs(fn.arguments),
        raw: record,
      });
    }
  }
  return calls;
}

function numericToken(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : undefined;
}

function usageRecord(raw: unknown): Record<string, unknown> | undefined {
  if (Array.isArray(raw)) {
    for (let index = raw.length - 1; index >= 0; index -= 1) {
      const found = usageRecord(raw[index]);
      if (found) return found;
    }
    return undefined;
  }
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const record = raw as Record<string, unknown>;
  const usage = record.usage;
  if (usage && typeof usage === "object" && !Array.isArray(usage)) {
    return usage as Record<string, unknown>;
  }
  const response = record.response;
  if (response && typeof response === "object" && !Array.isArray(response)) {
    return usageRecord(response);
  }
  return undefined;
}

export function isDeepSeekCompatible(config: ProviderConfig): boolean {
  if (!config.baseUrl) return false;
  try {
    return new URL(config.baseUrl).hostname === "api.deepseek.com";
  } catch {
    return false;
  }
}

export function extractOpenAiUsage(raw: unknown): ModelTokenUsage | undefined {
  const usage = usageRecord(raw);
  if (!usage) return undefined;

  const inputTokens = numericToken(usage.input_tokens) ?? numericToken(usage.prompt_tokens) ?? 0;
  const outputTokens = numericToken(usage.output_tokens) ?? numericToken(usage.completion_tokens) ?? 0;
  const totalTokens = numericToken(usage.total_tokens) ?? inputTokens + outputTokens;
  const outputDetails = usage.output_tokens_details && typeof usage.output_tokens_details === "object"
    ? usage.output_tokens_details as Record<string, unknown>
    : usage.completion_tokens_details && typeof usage.completion_tokens_details === "object"
      ? usage.completion_tokens_details as Record<string, unknown>
      : undefined;
  const reasoningTokens = numericToken(outputDetails?.reasoning_tokens);

  const promptCacheHitTokens = numericToken(usage.prompt_cache_hit_tokens);
  const promptCacheMissTokens = numericToken(usage.prompt_cache_miss_tokens);
  const inputDetails = usage.prompt_tokens_details && typeof usage.prompt_tokens_details === "object"
    ? usage.prompt_tokens_details as Record<string, unknown>
    : undefined;
  const cachedInputTokens = numericToken(inputDetails?.cached_tokens);

  return {
    inputTokens,
    outputTokens,
    ...(reasoningTokens !== undefined ? { reasoningTokens } : {}),
    ...(promptCacheHitTokens !== undefined ? { promptCacheHitTokens } : {}),
    ...(promptCacheMissTokens !== undefined ? { promptCacheMissTokens } : {}),
    ...(cachedInputTokens !== undefined && promptCacheHitTokens === undefined ? { promptCacheHitTokens: cachedInputTokens } : {}),
    totalTokens,
    source: "provider",
  };
}

export function extractAnthropicUsage(raw: unknown): ModelTokenUsage | undefined {
  const usage = usageRecord(raw);
  if (!usage) return undefined;

  const inputTokens = (numericToken(usage.input_tokens) ?? 0)
    + (numericToken(usage.cache_creation_input_tokens) ?? 0)
    + (numericToken(usage.cache_read_input_tokens) ?? 0);
  const cacheCreationInputTokens = numericToken(usage.cache_creation_input_tokens);
  const cacheReadInputTokens = numericToken(usage.cache_read_input_tokens);
  const outputTokens = numericToken(usage.output_tokens) ?? 0;
  const totalTokens = numericToken(usage.total_tokens) ?? inputTokens + outputTokens;

  return {
    inputTokens,
    outputTokens,
    ...(cacheCreationInputTokens !== undefined ? { cacheCreationInputTokens } : {}),
    ...(cacheReadInputTokens !== undefined ? { cacheReadInputTokens } : {}),
    totalTokens,
    source: "provider",
  };
}

export function extractOpenAiChatReasoningContent(raw: unknown): string | undefined {
  if (!raw || typeof raw !== "object" || !Array.isArray((raw as Record<string, unknown>).choices)) {
    return undefined;
  }

  const parts: string[] = [];
  for (const choice of (raw as Record<string, unknown>).choices as unknown[]) {
    const message = choice && typeof choice === "object" ? (choice as Record<string, unknown>).message : undefined;
    if (!message || typeof message !== "object") {
      continue;
    }
    const reasoning = (message as Record<string, unknown>).reasoning_content;
    if (typeof reasoning === "string") {
      parts.push(reasoning);
    }
  }

  return parts.length > 0 ? parts.join("") : undefined;
}

export function extractOpenAiResponsesToolCalls(raw: unknown, tools: readonly ModelToolDefinition[] | undefined): ModelToolCall[] {
  if (!raw || typeof raw !== "object" || !Array.isArray((raw as Record<string, unknown>).output)) {
    return [];
  }
  const calls: ModelToolCall[] = [];
  for (const item of (raw as Record<string, unknown>).output as unknown[]) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const record = item as Record<string, unknown>;
    if (record.type !== "function_call") {
      continue;
    }
    const id = typeof record.call_id === "string" ? record.call_id : typeof record.id === "string" ? record.id : `tool-call-${calls.length + 1}`;
    const name = typeof record.name === "string" ? record.name : "";
    calls.push({
      id,
      toolId: runtimeToolIdFromProviderName(name, tools),
      args: parseToolArgs(record.arguments),
      raw: record,
    });
  }
  return calls;
}

export function extractOpenAiChatStreamReasoningContent(rawEvents: readonly unknown[]): string | undefined {
  const parts: string[] = [];
  for (const event of rawEvents) {
    if (!event || typeof event !== "object" || !Array.isArray((event as Record<string, unknown>).choices)) {
      continue;
    }
    for (const choice of (event as Record<string, unknown>).choices as unknown[]) {
      if (!choice || typeof choice !== "object") {
        continue;
      }
      const delta = (choice as Record<string, unknown>).delta;
      if (!delta || typeof delta !== "object") {
        continue;
      }
      const reasoning = (delta as Record<string, unknown>).reasoning_content;
      if (typeof reasoning === "string") {
        parts.push(reasoning);
      }
    }
  }

  return parts.length > 0 ? parts.join("") : undefined;
}

export function extractOpenAiChatStreamFinishReason(rawEvents: readonly unknown[]): string | undefined {
  for (const event of rawEvents) {
    if (!event || typeof event !== "object" || !Array.isArray((event as Record<string, unknown>).choices)) {
      continue;
    }
    for (const choice of (event as Record<string, unknown>).choices as unknown[]) {
      if (!choice || typeof choice !== "object") {
        continue;
      }
      const finishReason = (choice as Record<string, unknown>).finish_reason;
      if (typeof finishReason === "string") {
        return finishReason;
      }
    }
  }
  return undefined;
}

export function extractOpenAiChatStreamToolCalls(rawEvents: readonly unknown[], tools: readonly ModelToolDefinition[] | undefined): ModelToolCall[] {
  const calls = new Map<number, {
    id?: string;
    name?: string;
    arguments: string;
    raw: unknown[];
  }>();

  for (const event of rawEvents) {
    if (!event || typeof event !== "object" || !Array.isArray((event as Record<string, unknown>).choices)) {
      continue;
    }
    for (const choice of (event as Record<string, unknown>).choices as unknown[]) {
      if (!choice || typeof choice !== "object") {
        continue;
      }
      const delta = (choice as Record<string, unknown>).delta;
      if (!delta || typeof delta !== "object" || !Array.isArray((delta as Record<string, unknown>).tool_calls)) {
        continue;
      }
      for (const rawCall of (delta as Record<string, unknown>).tool_calls as unknown[]) {
        if (!rawCall || typeof rawCall !== "object") {
          continue;
        }
        const record = rawCall as Record<string, unknown>;
        const index = typeof record.index === "number" ? record.index : calls.size;
        const existing = calls.get(index) ?? { arguments: "", raw: [] };
        const fn = record.function && typeof record.function === "object" ? record.function as Record<string, unknown> : {};
        calls.set(index, {
          id: typeof record.id === "string" ? record.id
            : typeof record.call_id === "string" ? record.call_id
            : existing.id,
          name: typeof fn.name === "string" ? fn.name : existing.name,
          arguments: existing.arguments + (typeof fn.arguments === "string" ? fn.arguments : ""),
          raw: [...existing.raw, record],
        });
      }
    }
  }

  return [...calls.values()]
    .filter((call) => call.name)
    .map((call, index) => ({
      id: call.id ?? `tool-call-${index + 1}`,
      toolId: runtimeToolIdFromProviderName(call.name ?? "", tools),
      args: parseToolArgs(call.arguments),
      raw: call.raw,
    }));
}

export function extractOpenAiResponsesStreamToolCalls(rawEvents: readonly unknown[], tools: readonly ModelToolDefinition[] | undefined): ModelToolCall[] {
  const completedOutput = rawEvents
    .map((event) => event && typeof event === "object" ? (event as Record<string, unknown>).item : undefined)
    .filter((item) => item && typeof item === "object" && (item as Record<string, unknown>).type === "function_call");

  if (completedOutput.length > 0) {
    return extractOpenAiResponsesToolCalls({ output: completedOutput }, tools);
  }

  const calls = new Map<string, {
    id?: string;
    callId?: string;
    name?: string;
    arguments: string;
    raw: unknown[];
  }>();

  for (const event of rawEvents) {
    if (!event || typeof event !== "object") {
      continue;
    }
    const record = event as Record<string, unknown>;
    const item = record.item && typeof record.item === "object" ? record.item as Record<string, unknown> : undefined;
    const key = typeof record.item_id === "string"
      ? record.item_id
      : typeof item?.id === "string"
        ? item.id
        : typeof record.output_index === "number"
          ? `output-${record.output_index}`
          : undefined;
    if (!key) {
      continue;
    }
    const existing = calls.get(key) ?? { arguments: "", raw: [] };
    calls.set(key, {
      id: typeof item?.id === "string" ? item.id : existing.id,
      callId: typeof item?.call_id === "string" ? item.call_id : existing.callId,
      name: typeof item?.name === "string" ? item.name : existing.name,
      arguments: existing.arguments + (typeof record.delta === "string" ? record.delta : ""),
      raw: [...existing.raw, record],
    });
  }

  return [...calls.values()]
    .filter((call) => call.name)
    .map((call, index) => ({
      id: call.callId ?? call.id ?? `tool-call-${index + 1}`,
      toolId: runtimeToolIdFromProviderName(call.name ?? "", tools),
      args: parseToolArgs(call.arguments),
      raw: call.raw,
    }));
}

export function extractAnthropicToolCalls(raw: unknown, tools: readonly ModelToolDefinition[] | undefined): ModelToolCall[] {
  if (!raw || typeof raw !== "object" || !Array.isArray((raw as Record<string, unknown>).content)) {
    return [];
  }
  const calls: ModelToolCall[] = [];
  for (const block of (raw as Record<string, unknown>).content as unknown[]) {
    if (!block || typeof block !== "object") {
      continue;
    }
    const record = block as Record<string, unknown>;
    if (record.type !== "tool_use") {
      continue;
    }
    const id = typeof record.id === "string" ? record.id : `tool-call-${calls.length + 1}`;
    const name = typeof record.name === "string" ? record.name : "";
    calls.push({
      id,
      toolId: runtimeToolIdFromProviderName(name, tools),
      args: parseToolArgs(record.input),
      raw: record,
    });
  }
  return calls;
}

export function buildResponsesInput(request: ModelRequest) {
  const messages = normalizeMessages(request);
  const { instructions, dialog } = splitInstructionMessages(messages);
  const input: Array<Record<string, unknown>> = [
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
    ...dialog.flatMap((message): Array<Record<string, unknown>> => {
      if (message.role === "tool") {
        return [{
          type: "function_call_output",
          call_id: message.toolCallId ?? "",
          output: message.content,
        }];
      }
      if (message.role === "assistant" && message.toolCalls?.length) {
        const textMessage = message.content.trim()
          ? [{
              type: "message",
              role: "assistant",
              content: toInputText(message.content),
            }]
          : [];
        return [
          ...textMessage,
          ...message.toolCalls.map((call) => ({
            type: "function_call",
            call_id: call.id,
            name: providerToolName(call.toolId),
            arguments: JSON.stringify(call.args ?? {}),
          })),
        ];
      }
      return [{
        type: "message",
        role: message.role,
        content: toInputText(message.content),
      }];
    }),
  ];
  return input;
}

export function appendIfDefined<T extends object, K extends string, V>(
  target: T,
  key: K,
  value: V | undefined
): T & Record<K, V> {
  if (value === undefined) {
    return target as T & Record<K, V>;
  }

  return { ...target, [key]: value } as T & Record<K, V>;
}

export function extractTextFromValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (!value || typeof value !== "object") {
    return "";
  }

  const record = value as Record<string, unknown>;

  if (typeof record.output_text === "string") {
    return record.output_text;
  }

  const choices = record.choices;
  if (Array.isArray(choices)) {
    const choiceParts: string[] = [];
    for (const choice of choices) {
      if (!choice || typeof choice !== "object") {
        continue;
      }

      const message = (choice as Record<string, unknown>).message;
      if (!message || typeof message !== "object") {
        continue;
      }

      const content = (message as Record<string, unknown>).content;
      if (typeof content === "string") {
        choiceParts.push(content);
        continue;
      }

      if (Array.isArray(content)) {
        for (const block of content) {
          if (!block || typeof block !== "object") {
            continue;
          }
          const textBlock = block as Record<string, unknown>;
          if (typeof textBlock.text === "string") {
            choiceParts.push(textBlock.text);
          }
        }
      }
    }

    if (choiceParts.length > 0) {
      return choiceParts.join("");
    }
  }

  const directContent = record.content;
  if (Array.isArray(directContent)) {
    const directParts: string[] = [];
    for (const block of directContent) {
      if (!block || typeof block !== "object") {
        continue;
      }

      const textBlock = block as Record<string, unknown>;
      if (typeof textBlock.text === "string") {
        directParts.push(textBlock.text);
      }
    }

    if (directParts.length > 0) {
      return directParts.join("");
    }
  }

  const output = record.output;
  if (!Array.isArray(output)) {
    return "";
  }

  const parts: string[] = [];
  for (const item of output) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const entry = item as Record<string, unknown>;
    if (entry.type !== "message" || !Array.isArray(entry.content)) {
      continue;
    }

    for (const block of entry.content) {
      if (!block || typeof block !== "object") {
        continue;
      }

      const textBlock = block as Record<string, unknown>;
      if (typeof textBlock.text === "string") {
        parts.push(textBlock.text);
      }
    }
  }

  return parts.join("");
}

export function failMissingApiKey(providerId: string, envName: string): Error {
  return new Error(`Missing ${envName} for provider ${providerId}`);
}

export function readProviderApiKey(
  config: ProviderConfig,
  fallbackEnvName: string | undefined,
  env: NodeJS.ProcessEnv
): string | undefined {
  const candidateEnvNames = [config.apiKeyEnv, fallbackEnvName].filter((name): name is string => Boolean(name));
  for (const envName of candidateEnvNames) {
    const value = env[envName]?.trim();
    if (value) {
      return value;
    }
  }

  const baseProviderId = modelProviderBaseId(config.id);
  return readProviderApiKeyFromKeychain(config.id)
    ?? (baseProviderId === config.id ? undefined : readProviderApiKeyFromKeychain(baseProviderId));
}

function readProviderApiKeyFromKeychain(providerId: string): string | undefined {
  if (process.platform !== "darwin" || !/^[A-Za-z0-9_-]+$/.test(providerId)) {
    return undefined;
  }

  try {
    const output = execFileSync("security", [
      "find-generic-password",
      "-a",
      "Ora",
      "-s",
      `ora.provider.${providerId}`,
      "-w",
    ], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return output.trim() || undefined;
  } catch {
    return undefined;
  }
}

function modelProviderBaseId(providerId: string): string {
  const separatorIndex = providerId.indexOf("--model-");
  return separatorIndex === -1 ? providerId : providerId.slice(0, separatorIndex);
}

export function resolveProviderEndpoint(params: {
  providerId: string;
  baseUrl: string | undefined;
  defaultOrigin: string;
  path: string;
  env: NodeJS.ProcessEnv;
  allowCustomBaseUrl?: boolean;
}): string {
  const origin = params.baseUrl ?? params.defaultOrigin;
  const url = new URL(params.path, origin);
  const defaultOrigin = new URL(params.defaultOrigin);
  const customBaseAllowed = params.env.ORA_ALLOW_CUSTOM_PROVIDER_BASE_URLS === "true";

  if (url.origin !== defaultOrigin.origin && !customBaseAllowed && params.allowCustomBaseUrl !== true) {
    throw new Error(
      `Custom baseUrl for provider ${params.providerId} requires ORA_ALLOW_CUSTOM_PROVIDER_BASE_URLS=true`
    );
  }

  if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
    throw new Error(`Provider ${params.providerId} endpoint must use HTTPS unless it targets localhost`);
  }

  return url.href;
}

export function resolveCompatibleProviderEndpoint(params: {
  providerId: string;
  baseUrl: string;
  path: string;
}) {
  const url = new URL(params.baseUrl);
  if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
    throw new Error(`Provider ${params.providerId} endpoint must use HTTPS unless it targets localhost`);
  }

  let pathname = url.pathname.replace(/\/+$/, "");
  if (!pathname.endsWith(params.path)) {
    pathname = isVersionedCompatibleBasePath(pathname)
      ? `${pathname}${params.path}`
      : `${pathname}/v1${params.path}`;
  }

  url.pathname = pathname;
  return url.href;
}

function isVersionedCompatibleBasePath(pathname: string) {
  const segments = pathname.split("/").filter(Boolean);
  const last = segments.at(-1);
  const previous = segments.at(-2);
  if (!last) {
    return false;
  }
  if (/^v\d+(?:[a-z]+)?$/i.test(last)) {
    return true;
  }
  return last.toLowerCase() === "openai" && Boolean(previous && /^v\d+(?:[a-z]+)?$/i.test(previous));
}
