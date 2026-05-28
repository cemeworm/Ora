import { describe, expect, it } from "vitest";
import { buildRunSearchConfig, normalizeSearchApiKeyEnv } from "./searchSettings";

describe("desktop search settings", () => {
  it("omits raw API keys from runtime search provider config", () => {
    const { searchProvider } = buildRunSearchConfig({
      enabled: true,
      providerId: "tavily",
      apiKeyEnv: "TVLY-DEV-JGPB3-JDHW51EPQYFSZLSO6PPK6QZRDUJHIISUWLUSCDPAHT",
      maxResults: "5",
      timeoutMs: "8000",
      mcpServerId: "anysearch",
      mcpToolName: "search",
    });

    expect(searchProvider).toMatchObject({
      id: "tavily",
      maxResults: 5,
      timeoutMs: 8000,
    });
    expect(searchProvider).not.toHaveProperty("apiKeyEnv");
  });

  it("keeps valid env var names for runtime search provider config", () => {
    expect(normalizeSearchApiKeyEnv(" tavily_api_key ")).toBe("TAVILY_API_KEY");
  });
});
