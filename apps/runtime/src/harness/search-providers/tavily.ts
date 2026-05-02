import type { SearchProviderConfig } from "@cemeworm/shared";
import type { SearchProvider, SearchProviderResponse, SearchQuery } from "./types.js";
import { fetchJson, normalizeSearchResults, providerLimit, providerTimeoutMs, readApiKey } from "./utils.js";

export class TavilySearchProvider implements SearchProvider {
  readonly id = "tavily" as const;

  constructor(
    private readonly fetchImpl: typeof fetch,
    private readonly env: NodeJS.ProcessEnv,
    private readonly config?: SearchProviderConfig,
  ) {}

  async search(input: SearchQuery): Promise<SearchProviderResponse> {
    const limit = providerLimit(this.config, input);
    const apiKey = readApiKey(this.id, this.config, this.env);
    const payload = await fetchJson(this.fetchImpl, "https://api.tavily.com/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        query: input.query,
        max_results: limit,
        include_answer: false,
      }),
    }, providerTimeoutMs(this.config));
    const results = payload && typeof payload === "object" && !Array.isArray(payload)
      ? normalizeSearchResults(((payload as Record<string, unknown>).results as unknown[]) ?? [], this.id)
      : [];
    return { query: input.query, providerId: this.id, results: results.slice(0, limit) };
  }
}
