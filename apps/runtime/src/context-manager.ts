import {
  DEFAULT_PROVIDERS,
  ModelTokenUsageSchema,
  SessionContextStateSchema,
  type ModelTokenUsage,
  type ProviderConfig,
  type RunConfig,
  type RuntimeConversationEntry,
  type SessionContextState,
} from "@cemeworm/shared";
import type { ModelMessage, ModelRequest, ModelResponse } from "./providers/index.js";
import { configuredProviderId } from "./providers/registry.js";
import { runtimeConversationToModelMessages } from "./runtime-conversation.js";

export type ContextCompactionPhase = "pre_turn" | "mid_turn";

export interface ContextCompactionResult {
  contextState: SessionContextState;
  messages: ModelMessage[];
  beforeTokens: number;
  afterTokens: number;
  summary: string;
}

export function resolveRunProviderConfig(config: RunConfig): ProviderConfig | undefined {
  const providerId = configuredProviderId(config);
  const providers = config.providerConfig
    ? [
        config.providerConfig,
        ...DEFAULT_PROVIDERS.filter((provider) => provider.id !== config.providerConfig?.id),
      ]
    : DEFAULT_PROVIDERS;
  return providers.find((provider) => provider.enabled !== false && provider.id === providerId)
    ?? providers.find((provider) => provider.enabled !== false && provider.modelId === providerId);
}

export function resolvedContextWindow(provider: ProviderConfig | undefined): number | undefined {
  return provider?.contextWindow ?? provider?.maxContextWindow;
}

export function resolveAutoCompactTokenLimit(provider: ProviderConfig | undefined): number | undefined {
  const contextWindow = resolvedContextWindow(provider);
  const contextLimit = contextWindow ? Math.floor(contextWindow * 0.9) : undefined;
  const configured = provider?.autoCompactTokenLimit;
  if (contextLimit !== undefined) {
    return configured !== undefined ? Math.min(configured, contextLimit) : contextLimit;
  }
  return configured;
}

export function normalizeContextState(state: SessionContextState | undefined): SessionContextState {
  return SessionContextStateSchema.parse(state ?? {});
}

export function contextMessages(state: SessionContextState | undefined): ModelMessage[] {
  return runtimeConversationToModelMessages(normalizeContextState(state).compactedHistory);
}

export function estimateTextTokens(text: string | undefined): number {
  if (!text) return 0;
  const compact = text.replace(/\s+/g, " ").trim();
  if (!compact) return 0;
  const byteEstimate = Math.ceil(Buffer.byteLength(compact, "utf8") / 4);
  const wordEstimate = compact.split(/\s+/).filter(Boolean).length;
  return Math.max(1, byteEstimate, wordEstimate);
}

export function estimateMessagesTokens(messages: readonly ModelMessage[] = [], system?: string): number {
  let total = estimateTextTokens(system);
  for (const message of messages) {
    total += 4 + estimateTextTokens(message.content);
    if (message.reasoningContent) {
      total += estimateTextTokens(message.reasoningContent);
    }
    if (message.toolName) {
      total += estimateTextTokens(message.toolName);
    }
    for (const call of message.toolCalls ?? []) {
      total += estimateTextTokens(call.toolId);
      total += estimateTextTokens(JSON.stringify(call.args ?? {}));
    }
  }
  return total;
}

export function usageForModelResponse(
  response: ModelResponse,
  request: Pick<ModelRequest, "messages" | "system" | "prompt">,
): ModelTokenUsage {
  if (response.usage) {
    return ModelTokenUsageSchema.parse(response.usage);
  }
  const messages = request.messages?.length
    ? request.messages
    : request.prompt?.trim()
      ? [{ role: "user" as const, content: request.prompt.trim() }]
      : [];
  const inputTokens = estimateMessagesTokens(messages, request.system);
  const outputTokens = estimateTextTokens(response.text);
  return ModelTokenUsageSchema.parse({
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    source: "estimate",
  });
}

export function activeUsageForMessages(messages: readonly ModelMessage[], system?: string): ModelTokenUsage {
  const totalTokens = estimateMessagesTokens(messages, system);
  return ModelTokenUsageSchema.parse({
    inputTokens: totalTokens,
    outputTokens: 0,
    totalTokens,
    source: "estimate",
  });
}

export function shouldCompactContext(args: {
  contextState: SessionContextState | undefined;
  provider: ProviderConfig | undefined;
  messages: readonly ModelMessage[];
  system?: string;
}): { shouldCompact: boolean; usage: ModelTokenUsage; limit?: number; contextWindow?: number } {
  const limit = resolveAutoCompactTokenLimit(args.provider);
  const contextWindow = resolvedContextWindow(args.provider);
  const estimated = activeUsageForMessages(args.messages, args.system);
  const current = normalizeContextState(args.contextState).activeTokenUsage;
  const usage = estimated.totalTokens >= current.totalTokens ? estimated : current;
  return {
    shouldCompact: limit !== undefined && usage.totalTokens >= limit,
    usage,
    limit,
    contextWindow,
  };
}

export function buildLocalCompactionRequest(messages: readonly ModelMessage[], limit: number | undefined): ModelRequest {
  const prompt = trimCompactionTranscript(messages, limit);
  return {
    system: [
      "You are compressing an Ora session history so a future assistant can continue accurately.",
      "Return a compact but complete summary. Preserve user goals, constraints, decisions, tool results, files, IDs, pending approvals, pending clarifications, and unresolved risks.",
      "Do not invent facts. Do not include markdown headings unless they improve clarity.",
    ].join("\n"),
    prompt,
    maxTokens: 1600,
    toolChoice: "none",
  };
}

export function compactedContextFromSummary(args: {
  summary: string;
  phase: ContextCompactionPhase;
  beforeTokens: number;
  limit: number;
  contextWindow?: number;
  previousState?: SessionContextState;
  compactedThroughTurnIndex: number;
  now: number;
}): { contextState: SessionContextState; messages: ModelMessage[] } {
  const summary = args.summary.trim() || "Earlier conversation was compacted, but the summary was empty.";
  const entry: RuntimeConversationEntry = {
    role: "system",
    content: `Compacted prior session context:\n${summary}`,
    createdAt: args.now,
  };
  const messages = runtimeConversationToModelMessages([entry]);
  const usage = activeUsageForMessages(messages);
  const previous = normalizeContextState(args.previousState);
  const contextState = SessionContextStateSchema.parse({
    ...previous,
    activeTokenUsage: usage,
    contextWindow: args.contextWindow,
    autoCompactTokenLimit: args.limit,
    compactedHistory: [entry],
    compactedThroughTurnIndex: args.compactedThroughTurnIndex,
    compactionCount: previous.compactionCount + 1,
    lastCompactedAt: args.now,
    lastCompaction: {
      phase: args.phase,
      implementation: "local",
      beforeTokens: args.beforeTokens,
      afterTokens: usage.totalTokens,
      limit: args.limit,
      reason: "context_limit",
    },
  });
  return { contextState, messages };
}

function trimCompactionTranscript(messages: readonly ModelMessage[], limit: number | undefined): string {
  const targetTokens = limit ? Math.max(2000, Math.floor(limit * 0.7)) : 24000;
  const lines = messages.map((message) => {
    const extras = [
      message.toolCalls?.length ? ` toolCalls=${JSON.stringify(message.toolCalls)}` : "",
      message.toolCallId ? ` toolCallId=${message.toolCallId}` : "",
      message.toolName ? ` toolName=${message.toolName}` : "",
    ].filter(Boolean).join("");
    return `<message role="${message.role}"${extras}>\n${message.content}\n</message>`;
  });
  while (lines.length > 1 && estimateTextTokens(lines.join("\n\n")) > targetTokens) {
    lines.shift();
  }
  return [
    "Summarize this session history for continuation:",
    "",
    lines.join("\n\n"),
  ].join("\n");
}
