import type { SearchProviderConfig, SearchProviderId, WebSearchResult } from "@cemeworm/shared";

export interface SearchQuery {
  query: string;
  limit: number;
}

export interface SearchProviderResponse {
  query: string;
  providerId: SearchProviderId;
  results: WebSearchResult[];
}

export interface SearchProvider {
  readonly id: SearchProviderId;
  search(input: SearchQuery): Promise<SearchProviderResponse>;
}

export interface McpSearchClient {
  callTool(serverId: string, toolName: string, args: Record<string, unknown>): Promise<unknown>;
}

export interface SearchProviderRuntimeOptions {
  fetchImpl: typeof fetch;
  env?: NodeJS.ProcessEnv;
  config?: SearchProviderConfig;
  mcpClient?: McpSearchClient;
}
