import type { SearchProviderConfig, WebSearchResult } from "@cemeworm/shared";
import type { McpSearchClient, SearchProvider, SearchProviderResponse, SearchQuery } from "./types.js";
import { normalizeSearchResults, providerLimit } from "./utils.js";

const DEFAULT_MCP_SEARCH_SERVER_ID = "anysearch";

export class McpSearchProvider implements SearchProvider {
  readonly id = "mcp" as const;

  constructor(
    private readonly client: McpSearchClient,
    private readonly config?: SearchProviderConfig,
  ) {}

  async search(input: SearchQuery): Promise<SearchProviderResponse> {
    const serverId = this.config?.mcpServerId ?? DEFAULT_MCP_SEARCH_SERVER_ID;
    const toolName = this.config?.mcpToolName ?? "search";
    const limit = providerLimit(this.config, input);
    const payload = await this.client.callTool(serverId, toolName, { query: input.query, limit });
    return {
      query: input.query,
      providerId: this.id,
      results: normalizeMcpSearchResults(payload).slice(0, limit),
    };
  }
}

export function normalizeMcpSearchResults(payload: unknown): WebSearchResult[] {
  if (Array.isArray(payload)) {
    return normalizeSearchResults(payload, "mcp");
  }
  if (!payload || typeof payload !== "object") {
    return [];
  }
  const record = payload as Record<string, unknown>;
  if (Array.isArray(record.results)) {
    return normalizeSearchResults(record.results, "mcp");
  }
  if (Array.isArray(record.content)) {
    for (const item of record.content) {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        continue;
      }
      const text = (item as Record<string, unknown>).text;
      if (typeof text !== "string") {
        continue;
      }
      try {
        const parsed = JSON.parse(text) as unknown;
        const results: WebSearchResult[] = normalizeMcpSearchResults(parsed);
        if (results.length > 0) {
          return results;
        }
      } catch {
        continue;
      }
    }
  }
  return normalizeSearchResults([record], "mcp");
}
