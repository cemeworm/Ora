import type { SearchProviderConfig, WebSearchResult } from "@ora/shared";
import type { SearchProvider, SearchProviderResponse, SearchQuery } from "./types.js";
import { providerLimit, providerTimeoutMs } from "./utils.js";

export class DuckDuckGoSearchProvider implements SearchProvider {
  readonly id = "duckduckgo" as const;

  constructor(
    private readonly fetchImpl: typeof fetch,
    private readonly config?: SearchProviderConfig,
  ) {}

  async search(input: SearchQuery): Promise<SearchProviderResponse> {
    const limit = providerLimit(this.config, input);
    const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(input.query)}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), providerTimeoutMs(this.config));
    try {
      const response = await this.fetchImpl(url, {
        headers: {
          "user-agent": "OraRuntime/0.1 local-agent-tool",
        },
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`Search provider request failed with HTTP ${response.status}.`);
      }
      const html = await response.text();
      return {
        query: input.query,
        providerId: this.id,
        results: parseDuckDuckGoResults(html).slice(0, limit),
      };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("Search provider request timed out.");
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function parseDuckDuckGoResults(html: string): WebSearchResult[] {
  const results: WebSearchResult[] = [];
  const resultPattern = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(resultPattern)) {
    const rawUrl = decodeHtml(match[1] ?? "");
    const title = stripHtml(match[2] ?? "");
    const snippet = stripHtml(match[3] ?? "");
    if (title && rawUrl) {
      results.push({ title, url: normalizeDuckDuckGoUrl(rawUrl), snippet, source: "duckduckgo" });
    }
  }
  return results;
}

function normalizeDuckDuckGoUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl, "https://duckduckgo.com");
    return parsed.searchParams.get("uddg") ?? parsed.href;
  } catch {
    return rawUrl;
  }
}

function stripHtml(value: string): string {
  return decodeHtml(value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}
