import { describe, expect, it } from "vitest";
import type { OraProviderConfig, OraProviderStatus } from "../../lib/runtimeClient";
import { buildProviderCatalog } from "../../lib/providerPresets";
import { canCompleteProviderOnboarding } from "./ProviderOnboardingStep";

describe("provider onboarding completion", () => {
  it("allows completion when a model provider is already enabled", () => {
    const [selectedCatalogEntry] = buildProviderCatalog([
      {
        id: "deepseek",
        type: "openai_compatible",
        label: "DeepSeek",
        modelId: "deepseek-v4-flash",
        enabled: true,
        baseUrl: "https://api.deepseek.com",
        apiKeyEnv: "DEEPSEEK_API_KEY",
        protocol: "chat_completions",
        capabilities: ["chat", "tool_use"],
        dropParams: [],
        headers: {},
      } satisfies OraProviderConfig,
    ]);
    const draftProviderStatus: OraProviderStatus = {
      providerId: "deepseek",
      state: "needs_key",
      detail: "API key required before verification.",
    };

    expect(
      canCompleteProviderOnboarding({
        draftProviderStatus,
        selectedCatalogEntry,
      }),
    ).toBe(true);
  });

  it("keeps completion disabled before verification or enabled models", () => {
    const [selectedCatalogEntry] = buildProviderCatalog([]);
    const draftProviderStatus: OraProviderStatus = {
      providerId: "deepseek",
      state: "needs_key",
      detail: "API key required before verification.",
    };

    expect(
      canCompleteProviderOnboarding({
        draftProviderStatus,
        selectedCatalogEntry,
      }),
    ).toBe(false);
  });
});
