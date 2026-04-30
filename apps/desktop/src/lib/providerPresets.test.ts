import { describe, expect, it } from "vitest";
import type { OraProviderConfig, OraProviderSecretStatus } from "./runtimeClient";
import {
  buildProviderCatalog,
  buildProviderConfigFromDraft,
  createDraftFromPreset,
  createModelProviderId,
  findPresetById,
} from "./providerPresets";
import { runnableProviderOptions } from "./providerOptions";

describe("provider presets", () => {
  it("creates stable disabled drafts for common provider presets", () => {
    const gemini = createDraftFromPreset(findPresetById("google-gemini"), []);
    const deepseek = createDraftFromPreset(findPresetById("deepseek"), []);
    const openrouter = createDraftFromPreset(findPresetById("openrouter"), []);

    expect(gemini).toMatchObject({
      id: "google-gemini",
      enabled: false,
      apiKeyEnv: "GEMINI_API_KEY",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
      modelId: "gemini-2.5-flash",
    });
    expect(deepseek).toMatchObject({
      id: "deepseek",
      enabled: false,
      apiKeyEnv: "DEEPSEEK_API_KEY",
      baseUrl: "https://api.deepseek.com",
      modelId: "deepseek-v4-flash",
    });
    expect(openrouter).toMatchObject({
      id: "openrouter",
      enabled: false,
      apiKeyEnv: "OPENROUTER_API_KEY",
      baseUrl: "https://openrouter.ai/api/v1",
      modelId: "openai/gpt-4o",
    });
  });

  it("only enables a preset when the verified draft is explicitly promoted", () => {
    const draft = createDraftFromPreset(findPresetById("aihubmix"), []);
    const savedDraft = { ...draft, enabled: true };

    expect(buildProviderConfigFromDraft(draft)).toMatchObject({
      id: "aihubmix",
      enabled: false,
      type: "openai_compatible",
    });
    expect(buildProviderConfigFromDraft(savedDraft)).toMatchObject({
      id: "aihubmix",
      enabled: true,
      type: "openai_compatible",
    });
  });

  it("uses saved providers instead of duplicate virtual presets", () => {
    const saved: OraProviderConfig = {
      id: "deepseek",
      type: "openai_compatible",
      label: "DeepSeek Team Key",
      modelId: "deepseek-v4-pro",
      enabled: true,
      baseUrl: "https://api.deepseek.com",
      apiKeyEnv: "DEEPSEEK_API_KEY",
      protocol: "chat_completions",
      capabilities: ["chat", "tool_use"],
      dropParams: [],
      headers: {},
    };

    const catalog = buildProviderCatalog([saved]);
    const deepseekEntries = catalog.filter((entry) => entry.preset.id === "deepseek");

    expect(deepseekEntries).toHaveLength(1);
    expect(deepseekEntries[0]).toMatchObject({
      key: "provider:deepseek",
      saved: true,
      label: "DeepSeek",
    });
    expect(deepseekEntries[0].draft.modelId).toBe("deepseek-v4-pro");
  });

  it("does not reuse one saved provider for multiple presets with the same base URL", () => {
    const saved: OraProviderConfig = {
      id: "moonshot",
      type: "openai_compatible",
      label: "Moonshot",
      modelId: "kimi-k2-0711-preview",
      enabled: true,
      baseUrl: "https://api.moonshot.ai/v1",
      apiKeyEnv: "MOONSHOT_API_KEY",
      protocol: "chat_completions",
      capabilities: ["chat", "tool_use"],
      dropParams: [],
      headers: {},
    };

    const catalog = buildProviderCatalog([saved]);

    expect(catalog.find((entry) => entry.preset.id === "moonshot")).toMatchObject({
      key: "provider:moonshot",
      saved: true,
    });
    expect(catalog.find((entry) => entry.preset.id === "kimi-coding-plan")).toMatchObject({
      key: "preset:kimi-coding-plan",
      saved: false,
    });
  });

  it("groups multiple saved models under one provider catalog entry", () => {
    const providers: OraProviderConfig[] = [
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
      },
      {
        id: createModelProviderId("deepseek", "deepseek-reasoner"),
        type: "openai_compatible",
        label: "DeepSeek",
        modelId: "deepseek-reasoner",
        enabled: false,
        baseUrl: "https://api.deepseek.com",
        apiKeyEnv: "DEEPSEEK_API_KEY",
        protocol: "chat_completions",
        capabilities: ["chat", "tool_use"],
        dropParams: [],
        headers: {},
      },
    ];

    const deepseekEntry = buildProviderCatalog(providers).find((entry) => entry.preset.id === "deepseek");

    expect(deepseekEntry?.key).toBe("provider:deepseek");
    expect(deepseekEntry?.providers.map((provider) => provider.modelId).sort()).toEqual([
      "deepseek-reasoner",
      "deepseek-v4-flash",
    ]);
  });

  it("hides the local smoke provider from the user-facing catalog", () => {
    const catalog = buildProviderCatalog([
      {
        id: "local-smoke",
        type: "local_smoke",
        label: "Smoke",
        modelId: "smoke-model",
        enabled: true,
        capabilities: ["chat"],
        dropParams: [],
        headers: {},
      },
    ]);

    expect(catalog.some((entry) => entry.providers.some((provider) => provider.id === "local-smoke"))).toBe(false);
    expect(catalog.some((entry) => entry.preset.id === "local-smoke")).toBe(false);
  });

  it("tolerates legacy provider configs without defaulted arrays", () => {
    const legacyProvider = {
      id: "legacy-openai",
      type: "openai_compatible",
      label: "Legacy OpenAI-compatible",
      modelId: "legacy-model",
      enabled: true,
      baseUrl: "https://legacy.example/v1",
      apiKeyEnv: "LEGACY_API_KEY",
      protocol: "chat_completions",
    } as unknown as OraProviderConfig;

    const catalog = buildProviderCatalog([legacyProvider]);
    const entry = catalog.find((candidate) => candidate.key === "provider:legacy-openai");

    expect(entry?.draft.dropParams).toBe("");
    expect(entry?.draft.capabilities).toEqual(["chat"]);
  });
});

describe("provider options", () => {
  it("filters local smoke from normal run options", () => {
    const providers: OraProviderConfig[] = [
      {
        id: "disabled-openai",
        type: "openai",
        label: "Disabled OpenAI",
        modelId: "gpt-4o",
        enabled: false,
        capabilities: ["chat"],
        dropParams: [],
        headers: {},
      },
      {
        id: "enabled-openai",
        type: "openai",
        label: "Enabled OpenAI",
        modelId: "gpt-4o",
        enabled: true,
        apiKeyEnv: "OPENAI_API_KEY",
        capabilities: ["chat"],
        dropParams: [],
        headers: {},
      },
      {
        id: "local-smoke",
        type: "local_smoke",
        label: "Smoke",
        modelId: "smoke-model",
        enabled: true,
        capabilities: ["chat"],
        dropParams: [],
        headers: {},
      },
    ];
    const statuses: OraProviderSecretStatus[] = [{
      providerId: "enabled-openai",
      hasSecret: true,
      storage: "keychain",
      detail: "Key stored.",
    }];

    expect(runnableProviderOptions(providers, statuses).map((provider) => provider.id)).toEqual([
      "enabled-openai",
    ]);
  });

  it("does not fall back to local smoke when no keyed providers are runnable", () => {
    const providers: OraProviderConfig[] = [
      {
        id: "local-smoke",
        type: "local_smoke",
        label: "Smoke",
        modelId: "smoke-model",
        enabled: true,
        capabilities: ["chat"],
        dropParams: [],
        headers: {},
      },
    ];

    expect(runnableProviderOptions(providers, [])).toEqual([]);
  });
});
