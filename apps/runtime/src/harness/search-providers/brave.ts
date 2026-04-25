import type { SearchProviderConfig } from "@ora/shared";
import type { SearchProvider, SearchProviderResponse, SearchQuery } from "./types.js";
import { fetchJson, normalizeSearchResults, providerLimit, providerTimeoutMs, readApiKey } from "./utils.js";

export class BraveSearchProvider implements SearchProvider {
  readonly id = "brave" as const;

  constructor(
    private readonly fetchImpl: typeof fetch,
    private readonly env: NodeJS.ProcessEnv,
    private readonly config?: SearchProviderConfig,
  ) {}

  async search(input: SearchQuery): Promise<SearchProviderResponse> {
    const limit = providerLimit(this.config, input);
    const apiKey = readApiKey(this.id, this.config, this.env);
    const url = new URL("https://api.search.brave.com/res/v1/web/search");
    url.searchParams.set("q", input.query);
    url.searchParams.set("count", String(limit));
    const payload = await fetchJson(this.fetchImpl, url.href, {
      headers: {
        accept: "application/json",
        "x-subscription-token": apiKey,
      },
    }, providerTimeoutMs(this.config));
    const results = payload && typeof payload === "object" && !Array.isArray(payload)
      ? normalizeSearchResults(((payload as Record<string, unknown>).web as { results?: unknown[] } | undefined)?.results ?? [], this.id)
      : [];
    return { query: input.query, providerId: this.id, results: results.slice(0, limit) };
  }
}
