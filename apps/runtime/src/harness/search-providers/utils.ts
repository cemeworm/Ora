import type { SearchProviderConfig, SearchProviderId, WebSearchResult } from "@cemeworm/shared";
import type { SearchQuery } from "./types.js";

export const SEARCH_PROVIDER_ENV_NAMES: Record<Exclude<SearchProviderId, "duckduckgo" | "mcp">, string> = {
  brave: "BRAVE_SEARCH_API_KEY",
  tavily: "TAVILY_API_KEY",
  serpapi: "SERPAPI_API_KEY",
  kagi: "KAGI_API_KEY",
};

export function resolveConfiguredProviderId(config: SearchProviderConfig | undefined, env: NodeJS.ProcessEnv): SearchProviderId {
  if (config?.id) {
    return config.id;
  }
  const envProvider = env.ORA_SEARCH_PROVIDER;
  if (envProvider === "brave" || envProvider === "tavily" || envProvider === "serpapi" || envProvider === "kagi" || envProvider === "duckduckgo" || envProvider === "mcp") {
    return envProvider;
  }
  for (const providerId of ["brave", "tavily", "serpapi", "kagi"] as const) {
    const key = env[SEARCH_PROVIDER_ENV_NAMES[providerId]]?.trim();
    if (key) {
      return providerId;
    }
  }
  return "mcp";
}

export function providerLimit(config: SearchProviderConfig | undefined, input: SearchQuery): number {
  const maxResults = config?.maxResults ?? 5;
  return Math.min(input.limit, maxResults, 10);
}

export function providerTimeoutMs(config: SearchProviderConfig | undefined): number {
  return config?.timeoutMs ?? 8_000;
}

export function readApiKey(
  providerId: Exclude<SearchProviderId, "duckduckgo" | "mcp">,
  config: SearchProviderConfig | undefined,
  env: NodeJS.ProcessEnv,
): string {
  const envName = config?.apiKeyEnv ?? SEARCH_PROVIDER_ENV_NAMES[providerId];
  const apiKey = env[envName]?.trim();
  if (!apiKey) {
    throw new Error(`Missing ${envName} for web.search provider ${providerId}.`);
  }
  return apiKey;
}

export async function fetchJson(fetchImpl: typeof fetch, url: string, init: RequestInit, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { ...init, signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Search provider request failed with HTTP ${response.status}.`);
    }
    return await response.json();
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Search provider request timed out.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export function normalizeSearchResults(items: unknown[], source: string): WebSearchResult[] {
  const results: WebSearchResult[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }
    const record = item as Record<string, unknown>;
    const title = stringValue(record.title) ?? stringValue(record.name);
    const url = stringValue(record.url) ?? stringValue(record.link);
    const snippet = stringValue(record.snippet)
      ?? stringValue(record.description)
      ?? stringValue(record.content)
      ?? stringValue(record.text);
    if (!title || !url || !isHttpUrl(url)) {
      continue;
    }
    results.push({
      title,
      url,
      snippet,
      source,
    });
  }
  return results;
}

export function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}
