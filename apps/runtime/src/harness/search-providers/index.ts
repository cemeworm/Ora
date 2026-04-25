import { SearchProviderConfigSchema } from "@ora/shared";
import { BraveSearchProvider } from "./brave.js";
import { DuckDuckGoSearchProvider } from "./duckduckgo.js";
import { KagiSearchProvider } from "./kagi.js";
import { McpSearchProvider } from "./mcp.js";
import { SerpApiSearchProvider } from "./serpapi.js";
import { TavilySearchProvider } from "./tavily.js";
import type { SearchProvider, SearchProviderRuntimeOptions } from "./types.js";
import { resolveConfiguredProviderId } from "./utils.js";

export type { McpSearchClient, SearchProvider, SearchProviderRuntimeOptions } from "./types.js";
export { normalizeMcpSearchResults } from "./mcp.js";
export { parseDuckDuckGoResults } from "./duckduckgo.js";

export function createSearchProvider(options: SearchProviderRuntimeOptions): SearchProvider {
  const env = options.env ?? process.env;
  const config = options.config ? SearchProviderConfigSchema.parse(options.config) : undefined;
  const providerId = resolveConfiguredProviderId(config, env);

  switch (providerId) {
    case "brave":
      return new BraveSearchProvider(options.fetchImpl, env, config);
    case "tavily":
      return new TavilySearchProvider(options.fetchImpl, env, config);
    case "serpapi":
      return new SerpApiSearchProvider(options.fetchImpl, env, config);
    case "kagi":
      return new KagiSearchProvider(options.fetchImpl, env, config);
    case "mcp":
      if (!options.mcpClient) {
        throw new Error("MCP search provider requires an MCP client.");
      }
      return new McpSearchProvider(options.mcpClient, config);
    case "duckduckgo":
      return new DuckDuckGoSearchProvider(options.fetchImpl, config);
    default:
      return new DuckDuckGoSearchProvider(options.fetchImpl, config);
  }
}
