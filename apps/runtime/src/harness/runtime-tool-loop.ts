import type { CompletionStopReason, OraToolCallSource, RunConfig } from "@cemeworm/shared";
import type { ModelToolCall } from "../providers/index.js";
import { isRuntimeToolImplemented, type RuntimeToolCall } from "./runtime-tool-executor.js";

export type RuntimeToolAttempt = RuntimeToolCall & {
  providerCallId?: string;
  source: OraToolCallSource;
};

export type RuntimeToolAttemptDecision =
  | { allowed: true; key: string; repeatCount: number; toolTypeCount: number }
  | { allowed: false; reason: CompletionStopReason; key?: string; repeatCount?: number; toolTypeCount?: number };

export function providerSupportsNativeTools(config: RunConfig): boolean {
  const capabilities = config.providerConfig?.capabilities ?? [];
  if (capabilities.includes("tool_use")) {
    return true;
  }
  return config.providerConfig === undefined
    && (config.providerId === "openai-gpt" || config.providerId === "anthropic-claude");
}

export function providerToolCallToAttempt(call: ModelToolCall): RuntimeToolAttempt | undefined {
  if (!isRuntimeToolImplemented(call.toolId)) {
    return undefined;
  }
  return {
    tool: call.toolId,
    args: call.args,
    providerCallId: call.id,
    source: "provider_native",
  };
}

export function cacheKeyForRuntimeTool(call: RuntimeToolCall): string | undefined {
  if (call.tool === "web.fetch") {
    const url = typeof call.args.url === "string" ? call.args.url.trim() : "";
    return url ? `${call.tool}:${url}` : undefined;
  }
  if (call.tool === "web.search") {
    const query = typeof call.args.query === "string" ? call.args.query.trim().replace(/\s+/g, " ").toLowerCase() : "";
    const limit = typeof call.args.limit === "number" ? call.args.limit : "";
    return query ? `${call.tool}:${query}:${limit}` : undefined;
  }
  return undefined;
}

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

export function stableKeyForRuntimeTool(call: RuntimeToolCall): string {
  const cacheKey = cacheKeyForRuntimeTool(call);
  if (cacheKey) {
    return cacheKey;
  }
  const salientArgs = Object.fromEntries(
    ["path", "url", "query", "command", "pattern", "glob", "cmd", "name"]
      .filter((key) => call.args[key] !== undefined)
      .map((key) => [key, call.args[key]]),
  );
  return `${call.tool}:${stableJson(Object.keys(salientArgs).length > 0 ? salientArgs : call.args)}`;
}
