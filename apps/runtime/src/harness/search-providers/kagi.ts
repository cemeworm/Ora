import type { SearchProviderConfig } from "@cemeworm/shared";
import type { SearchProvider, SearchProviderResponse, SearchQuery } from "./types.js";
import { fetchJson, normalizeSearchResults, providerLimit, providerTimeoutMs, readApiKey } from "./utils.js";

export class KagiSearchProvider implements SearchProvider {
  readonly id = "kagi" as const;

  constructor(
    private readonly fetchImpl: typeof fetch,
    private readonly env: NodeJS.ProcessEnv,
    private readonly config?: SearchProviderConfig,
  ) {}

  async search(input: SearchQuery): Promise<SearchProviderResponse> {
    const limit = providerLimit(this.config, input);
    const apiKey = readApiKey(this.id, this.config, this.env);
    const url = new URL("https://kagi.com/api/v0/search");
    url.searchParams.set("q", input.query);
    url.searchParams.set("limit", String(limit));
    const payload = await fetchJson(this.fetchImpl, url.href, {
      headers: {
        authorization: `Bot ${apiKey}`,
      },
    }, providerTimeoutMs(this.config));
    const results = payload && typeof payload === "object" && !Array.isArray(payload)
      ? normalizeSearchResults(((payload as Record<string, unknown>).data as unknown[]) ?? [], this.id)
      : [];
    return { query: input.query, providerId: this.id, results: results.slice(0, limit) };
  }
}
