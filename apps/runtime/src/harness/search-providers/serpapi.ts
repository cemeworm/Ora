import type { SearchProviderConfig } from "@cemeworm/shared";
import type { SearchProvider, SearchProviderResponse, SearchQuery } from "./types.js";
import { fetchJson, normalizeSearchResults, providerLimit, providerTimeoutMs, readApiKey } from "./utils.js";

export class SerpApiSearchProvider implements SearchProvider {
  readonly id = "serpapi" as const;

  constructor(
    private readonly fetchImpl: typeof fetch,
    private readonly env: NodeJS.ProcessEnv,
    private readonly config?: SearchProviderConfig,
  ) {}

  async search(input: SearchQuery): Promise<SearchProviderResponse> {
    const limit = providerLimit(this.config, input);
    const apiKey = readApiKey(this.id, this.config, this.env);
    const url = new URL("https://serpapi.com/search.json");
    url.searchParams.set("engine", "google");
    url.searchParams.set("q", input.query);
    url.searchParams.set("api_key", apiKey);
    url.searchParams.set("num", String(limit));
    const payload = await fetchJson(this.fetchImpl, url.href, {}, providerTimeoutMs(this.config));
    const results = payload && typeof payload === "object" && !Array.isArray(payload)
      ? normalizeSearchResults(((payload as Record<string, unknown>).organic_results as unknown[]) ?? [], this.id)
      : [];
    return { query: input.query, providerId: this.id, results: results.slice(0, limit) };
  }
}
