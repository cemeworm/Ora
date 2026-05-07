import type { CompletionStopReason, OraToolCallSource, RunConfig } from "@cemeworm/shared";
import type { ModelResponse, ModelToolCall } from "../providers/index.js";
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

export function selectRuntimeToolAttempt(params: {
  response: Pick<ModelResponse, "text" | "toolCalls">;
  toolIds: string[];
  extractFallbackToolCall: (text: string, toolIds: string[]) => RuntimeToolCall | undefined;
}): RuntimeToolAttempt | undefined {
  const nativeToolCall = params.response.toolCalls
    ?.map(providerToolCallToAttempt)
    .find(Boolean);
  if (nativeToolCall) {
    return nativeToolCall;
  }
  const fallbackToolCall = params.extractFallbackToolCall(params.response.text, params.toolIds);
  return fallbackToolCall
    ? { ...fallbackToolCall, source: "json_fallback" }
    : undefined;
}

export function nativeRuntimeToolAttempts(response: Pick<ModelResponse, "toolCalls">): RuntimeToolAttempt[] {
  return (response.toolCalls
    ?.map(providerToolCallToAttempt)
    .filter(Boolean) as RuntimeToolAttempt[]) ?? [];
}

export function cacheKeyForRuntimeTool(
  call: RuntimeToolCall,
  options: { readOnlyFileTools?: boolean } = { readOnlyFileTools: true },
): string | undefined {
  const readOnlyFileTools = options.readOnlyFileTools !== false;
  if (readOnlyFileTools && call.tool === "file.read") {
    const filePath = typeof call.args.path === "string" ? call.args.path.trim() : "";
    return filePath ? `${call.tool}:${filePath}` : undefined;
  }
  if (readOnlyFileTools && call.tool === "file.list") {
    const filePath = typeof call.args.path === "string" ? call.args.path.trim() : ".";
    return `${call.tool}:${filePath}`;
  }
  if (readOnlyFileTools && call.tool === "file.glob") {
    const pattern = typeof call.args.pattern === "string" ? call.args.pattern.trim() : "";
    return pattern ? `${call.tool}:${pattern}` : undefined;
  }
  if (readOnlyFileTools && call.tool === "file.grep") {
    const pattern = typeof call.args.pattern === "string" ? call.args.pattern.trim() : "";
    const include = typeof call.args.include === "string" ? call.args.include.trim() : "";
    return pattern ? `${call.tool}:${pattern}:${include}` : undefined;
  }
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

export function invalidatesRuntimeToolCache(call: RuntimeToolCall): boolean {
  return call.tool === "file.write"
    || call.tool === "file.patch"
    || call.tool === "shell.execute"
    || call.tool.startsWith("skills.")
    || call.tool.startsWith("package.")
    || call.tool === "modes.applyDraft"
    || call.tool === "selfIteration.apply";
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
    ["path", "url", "query", "command", "pattern", "glob", "cmd", "name", "include"]
      .filter((key) => call.args[key] !== undefined)
      .map((key) => [key, call.args[key]]),
  );
  return `${call.tool}:${stableJson(Object.keys(salientArgs).length > 0 ? salientArgs : call.args)}`;
}
