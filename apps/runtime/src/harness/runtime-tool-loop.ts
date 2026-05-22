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
  const enabledToolIds = new Set(params.toolIds);
  const nativeToolCall = params.response.toolCalls
    ?.map(providerToolCallToAttempt)
    .filter((attempt) => attempt && enabledToolIds.has(attempt.tool))
    .find(Boolean);
  if (nativeToolCall) {
    return nativeToolCall;
  }
  const fallbackToolCall = params.extractFallbackToolCall(params.response.text, params.toolIds);
  return fallbackToolCall
    ? { ...fallbackToolCall, source: "json_fallback" }
    : undefined;
}

export function nativeRuntimeToolAttempts(
  response: Pick<ModelResponse, "toolCalls">,
  toolIds?: readonly string[],
): RuntimeToolAttempt[] {
  const enabledToolIds = toolIds ? new Set(toolIds) : undefined;
  return (response.toolCalls
    ?.map(providerToolCallToAttempt)
    .filter((attempt) => !enabledToolIds || (attempt && enabledToolIds.has(attempt.tool)))
    .filter(Boolean) as RuntimeToolAttempt[]) ?? [];
}

export function cacheKeyForRuntimeTool(
  call: RuntimeToolCall,
  options: { readOnlyFileTools?: boolean } = { readOnlyFileTools: true },
): string | undefined {
  const readOnlyFileTools = options.readOnlyFileTools !== false;
  const fileScopeKey = fileScopeCacheKey(call.args);
  if (readOnlyFileTools && call.tool === "file.read") {
    const filePath = stringArg(call.args.path);
    if (!filePath) {
      return undefined;
    }
    if (call.args.offset !== undefined || call.args.limit !== undefined) {
      const offset = positiveIntLike(call.args.offset) ?? 1;
      const limit = positiveIntLike(call.args.limit);
      return `${call.tool}:${fileScopeKey}:path=${filePath}:offset=${offset}:limit=${limit ?? "rest"}`;
    }
    return `${call.tool}:${fileScopeKey}:path=${filePath}`;
  }
  if (readOnlyFileTools && call.tool === "file.list") {
    const filePath = stringArg(call.args.path) || ".";
    const limit = positiveIntLike(call.args.limit);
    return `${call.tool}:${fileScopeKey}:path=${filePath}:limit=${limit ?? "default"}`;
  }
  if (readOnlyFileTools && call.tool === "file.glob") {
    const pattern = stringArg(call.args.pattern);
    if (!pattern) {
      return undefined;
    }
    const filePath = stringArg(call.args.path) || ".";
    const limit = positiveIntLike(call.args.limit);
    return `${call.tool}:${fileScopeKey}:path=${filePath}:pattern=${pattern}:limit=${limit ?? "default"}`;
  }
  if (readOnlyFileTools && call.tool === "file.grep") {
    const pattern = stringArg(call.args.pattern);
    if (!pattern) {
      return undefined;
    }
    const include = stringArg(call.args.include);
    const filePath = stringArg(call.args.path) || ".";
    const caseSensitive = call.args.caseSensitive === false ? "false" : "true";
    const limit = positiveIntLike(call.args.limit);
    return `${call.tool}:${fileScopeKey}:path=${filePath}:pattern=${pattern}:include=${include}:caseSensitive=${caseSensitive}:limit=${limit ?? "default"}`;
  }
  if (call.tool === "web.fetch") {
    const url = stringArg(call.args.url);
    if (!url) {
      return undefined;
    }
    const maxBytes = positiveIntLike(call.args.maxBytes);
    return `${call.tool}:url=${url}:maxBytes=${maxBytes ?? "default"}`;
  }
  if (call.tool === "web.search") {
    const query = typeof call.args.query === "string" ? call.args.query.trim().replace(/\s+/g, " ").toLowerCase() : "";
    const limit = positiveIntLike(call.args.limit);
    return query ? `${call.tool}:${query}:${limit ?? "default"}` : undefined;
  }
  return undefined;
}

function stringArg(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function positiveIntLike(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const parsed = Number(value.trim());
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
  }
  return undefined;
}

export function invalidatesRuntimeToolCache(call: RuntimeToolCall): boolean {
  return call.tool === "file.write"
    || call.tool === "file.patch"
    || call.tool === "file.apply_patch"
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

function contentHash(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}

function fileScopeCacheKey(args: Record<string, unknown>): string {
  const scope = stringArg(args.scope) || "workspace";
  const grantId = stringArg(args.grantId) || "none";
  return `scope=${scope}:grantId=${grantId}`;
}

function writeToolContentKey(call: RuntimeToolCall): string | undefined {
  const filePath = stringArg(call.args.path);
  const fileScopeKey = fileScopeCacheKey(call.args);

  if (call.tool === "file.patch") {
    const edits = call.args.edits;
    if (Array.isArray(edits) && edits.length > 0) {
      const payload = edits
        .map((e: unknown) => {
          const edit = e as Record<string, unknown>;
          return typeof edit?.oldText === "string" ? edit.oldText : "";
        })
        .join("\0");
      return `file.patch:${fileScopeKey}:path=${filePath || "?"}:h=${contentHash(payload)}`;
    }
    // legacy search + replace
    const search = stringArg(call.args.search);
    if (search) {
      return `file.patch:${fileScopeKey}:path=${filePath || "?"}:h=${contentHash(search)}`;
    }
    return undefined;
  }

  if (call.tool === "file.write") {
    const content = stringArg(call.args.content);
    if (content) {
      return `file.write:${fileScopeKey}:path=${filePath || "?"}:h=${contentHash(content)}`;
    }
    return undefined;
  }

  if (call.tool === "file.apply_patch") {
    const patch = stringArg(call.args.patch);
    if (patch) {
      return `file.apply_patch:h=${contentHash(patch)}`;
    }
    return undefined;
  }

  return undefined;
}

export function stableKeyForRuntimeTool(call: RuntimeToolCall): string {
  const cacheKey = cacheKeyForRuntimeTool(call);
  if (cacheKey) {
    return cacheKey;
  }
  const writeKey = writeToolContentKey(call);
  if (writeKey) {
    return writeKey;
  }
  const salientArgs = Object.fromEntries(
    ["path", "url", "query", "command", "pattern", "glob", "cmd", "name", "include"]
      .filter((key) => call.args[key] !== undefined)
      .map((key) => [key, call.args[key]]),
  );
  return `${call.tool}:${stableJson(Object.keys(salientArgs).length > 0 ? salientArgs : call.args)}`;
}
