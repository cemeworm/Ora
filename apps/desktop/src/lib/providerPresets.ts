import type { OpenAICompatibleProtocol, ProviderCapability, ProviderType } from "@ora/shared";
import type { OraProviderConfig } from "./runtimeClient";

export interface ProviderPreset {
  id: string;
  label: string;
  description: string;
  type: ProviderType;
  group: "official" | "template";
  category: "official" | "coding" | "aggregator" | "generic" | "local";
  iconLabel: string;
  homepageUrl?: string;
  apiKeyUrl?: string;
  freeTier?: {
    label: string;
    description?: string;
    url?: string;
  };
  recommendationReason?: string;
  onboardingPriority?: number;
  isRecommended?: boolean;
  fixedProviderId?: string;
  suggestedIdBase: string;
  suggestedApiKeyEnv?: string;
  defaultModelId: string;
  modelSuggestions: string[];
  baseUrl?: string;
  protocol?: OpenAICompatibleProtocol;
  anthropicVersion?: string;
  capabilities: ProviderCapability[];
  maxTokens?: number;
  temperature?: number;
  headers?: Record<string, string>;
}

export interface ProviderDraft {
  presetId: string;
  id: string;
  label: string;
  type: ProviderType;
  modelId: string;
  baseUrl: string;
  apiKeyEnv: string;
  protocol: OpenAICompatibleProtocol;
  anthropicVersion: string;
  maxTokens: string;
  temperature: string;
  dropParams: string;
  capabilities: ProviderCapability[];
  headersText: string;
  enabled: boolean;
}

export interface ProviderCatalogEntry {
  key: string;
  preset: ProviderPreset;
  provider?: OraProviderConfig;
  providers: OraProviderConfig[];
  draft: ProviderDraft;
  label: string;
  description: string;
  saved: boolean;
}

export const BUILT_IN_PROVIDER_IDS = new Set(["openai-gpt", "anthropic-claude", "local-smoke"]);

const MODEL_PROVIDER_SEPARATOR = "--model-";

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: "openai-official",
    label: "OpenAI",
    description: "Official OpenAI Responses API provider.",
    type: "openai",
    group: "official",
    category: "official",
    iconLabel: "AI",
    homepageUrl: "https://platform.openai.com/docs",
    apiKeyUrl: "https://platform.openai.com/api-keys",
    isRecommended: true,
    fixedProviderId: "openai-gpt",
    suggestedIdBase: "openai-gpt",
    suggestedApiKeyEnv: "OPENAI_API_KEY",
    defaultModelId: "gpt-4o",
    modelSuggestions: ["gpt-4o", "gpt-4.1", "gpt-4o-mini", "gpt-5"],
    capabilities: ["chat", "tool_use", "image_input", "json_mode"],
    maxTokens: 8192,
  },
  {
    id: "anthropic-official",
    label: "Anthropic",
    description: "Official Claude Messages API provider.",
    type: "anthropic",
    group: "official",
    category: "official",
    iconLabel: "A",
    homepageUrl: "https://docs.anthropic.com/",
    apiKeyUrl: "https://console.anthropic.com/settings/keys",
    isRecommended: true,
    fixedProviderId: "anthropic-claude",
    suggestedIdBase: "anthropic-claude",
    suggestedApiKeyEnv: "ANTHROPIC_API_KEY",
    defaultModelId: "claude-sonnet-4-20250514",
    modelSuggestions: [
      "claude-sonnet-4-20250514",
      "claude-sonnet-4-5-20250929",
      "claude-opus-4-20250514",
      "claude-3-7-sonnet-20250219",
    ],
    anthropicVersion: "2023-06-01",
    capabilities: ["chat", "tool_use", "reasoning"],
    maxTokens: 8192,
  },
  {
    id: "local-smoke",
    label: "Local Smoke",
    description: "Deterministic local smoke provider for offline testing.",
    type: "local_smoke",
    group: "official",
    category: "local",
    iconLabel: "L",
    fixedProviderId: "local-smoke",
    suggestedIdBase: "local-smoke",
    defaultModelId: "smoke-model",
    modelSuggestions: ["smoke-model"],
    capabilities: ["chat"],
    maxTokens: 1024,
  },
  {
    id: "openai-compatible-generic",
    label: "Generic OpenAI-compatible",
    description: "Any provider that speaks the OpenAI chat or responses protocol.",
    type: "openai_compatible",
    group: "template",
    category: "generic",
    iconLabel: ">_",
    suggestedIdBase: "openai-compatible",
    suggestedApiKeyEnv: "OPENAI_COMPATIBLE_API_KEY",
    defaultModelId: "model-id",
    modelSuggestions: ["model-id"],
    protocol: "chat_completions",
    capabilities: ["chat"],
    maxTokens: 8192,
  },
  {
    id: "anthropic-compatible-generic",
    label: "Generic Anthropic-compatible",
    description: "Any provider that speaks the Anthropic Messages API.",
    type: "anthropic_compatible",
    group: "template",
    category: "generic",
    iconLabel: "A",
    suggestedIdBase: "anthropic-compatible",
    suggestedApiKeyEnv: "ANTHROPIC_COMPATIBLE_API_KEY",
    defaultModelId: "claude-model",
    modelSuggestions: ["claude-model"],
    anthropicVersion: "2023-06-01",
    capabilities: ["chat", "tool_use"],
    maxTokens: 8192,
  },
  {
    id: "qwen",
    label: "Alibaba Qwen",
    description: "OpenAI-compatible Qwen via Bailian/DashScope.",
    type: "openai_compatible",
    group: "template",
    category: "coding",
    iconLabel: "Q",
    homepageUrl: "https://www.alibabacloud.com/help/en/model-studio/",
    apiKeyUrl: "https://bailian.console.aliyun.com/",
    suggestedIdBase: "qwen",
    suggestedApiKeyEnv: "DASHSCOPE_API_KEY",
    defaultModelId: "qwen3-coder-plus",
    modelSuggestions: ["qwen3-coder-plus", "qwen-plus", "qwen-max", "qwen2.5-coder-32b-instruct"],
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    protocol: "chat_completions",
    capabilities: ["chat", "tool_use", "reasoning"],
    maxTokens: 8192,
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    description: "DeepSeek OpenAI-compatible API.",
    type: "openai_compatible",
    group: "template",
    category: "coding",
    iconLabel: "DS",
    homepageUrl: "https://api-docs.deepseek.com/",
    apiKeyUrl: "https://platform.deepseek.com/api_keys",
    isRecommended: true,
    suggestedIdBase: "deepseek",
    suggestedApiKeyEnv: "DEEPSEEK_API_KEY",
    defaultModelId: "deepseek-v4-flash",
    modelSuggestions: ["deepseek-v4-flash", "deepseek-v4-pro", "deepseek-chat", "deepseek-reasoner"],
    baseUrl: "https://api.deepseek.com",
    protocol: "chat_completions",
    capabilities: ["chat", "tool_use", "reasoning", "json_mode"],
    maxTokens: 8192,
  },
  {
    id: "zhipu",
    label: "Zhipu",
    description: "Zhipu OpenAI-compatible API.",
    type: "openai_compatible",
    group: "template",
    category: "coding",
    iconLabel: "Z",
    homepageUrl: "https://docs.z.ai/",
    apiKeyUrl: "https://bigmodel.cn/usercenter/proj-mgmt/apikeys",
    suggestedIdBase: "zhipu",
    suggestedApiKeyEnv: "ZHIPU_API_KEY",
    defaultModelId: "glm-4.5",
    modelSuggestions: ["glm-4.5", "glm-4.5-air", "glm-4.5-x"],
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    protocol: "chat_completions",
    capabilities: ["chat", "tool_use", "reasoning"],
    maxTokens: 8192,
  },
  {
    id: "moonshot",
    label: "Moonshot / Kimi",
    description: "Moonshot OpenAI-compatible API.",
    type: "openai_compatible",
    group: "template",
    category: "coding",
    iconLabel: "K",
    homepageUrl: "https://platform.moonshot.ai/docs",
    apiKeyUrl: "https://platform.moonshot.ai/console/api-keys",
    isRecommended: true,
    suggestedIdBase: "moonshot",
    suggestedApiKeyEnv: "MOONSHOT_API_KEY",
    defaultModelId: "kimi-k2-0711-preview",
    modelSuggestions: ["kimi-k2-0711-preview", "kimi-latest", "moonshot-v1-8k"],
    baseUrl: "https://api.moonshot.ai/v1",
    protocol: "chat_completions",
    capabilities: ["chat", "tool_use", "reasoning"],
    maxTokens: 8192,
  },
  {
    id: "google-gemini",
    label: "Google Gemini",
    description: "Gemini API through Google's OpenAI-compatible endpoint.",
    type: "openai_compatible",
    group: "template",
    category: "official",
    iconLabel: "G",
    homepageUrl: "https://ai.google.dev/gemini-api/docs/openai",
    apiKeyUrl: "https://aistudio.google.com/app/apikey",
    isRecommended: true,
    suggestedIdBase: "google-gemini",
    suggestedApiKeyEnv: "GEMINI_API_KEY",
    defaultModelId: "gemini-2.5-flash",
    modelSuggestions: ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash"],
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    protocol: "chat_completions",
    capabilities: ["chat", "tool_use", "image_input", "json_mode"],
    maxTokens: 8192,
  },
  {
    id: "kimi-coding-plan",
    label: "Kimi Coding Plan",
    description: "Kimi coding models through Moonshot's OpenAI-compatible API.",
    type: "openai_compatible",
    group: "template",
    category: "coding",
    iconLabel: "KC",
    homepageUrl: "https://platform.moonshot.ai/docs",
    apiKeyUrl: "https://platform.moonshot.ai/console/api-keys",
    suggestedIdBase: "kimi-coding-plan",
    suggestedApiKeyEnv: "MOONSHOT_API_KEY",
    defaultModelId: "kimi-k2-0711-preview",
    modelSuggestions: ["kimi-k2-0711-preview", "kimi-latest"],
    baseUrl: "https://api.moonshot.ai/v1",
    protocol: "chat_completions",
    capabilities: ["chat", "tool_use", "reasoning"],
    maxTokens: 8192,
  },
  {
    id: "zai-coding-plan",
    label: "Z.AI Coding Plan",
    description: "Z.AI GLM Coding Plan OpenAI-compatible endpoint.",
    type: "openai_compatible",
    group: "template",
    category: "coding",
    iconLabel: "Z",
    homepageUrl: "https://docs.z.ai/devpack/overview",
    apiKeyUrl: "https://z.ai/",
    isRecommended: true,
    suggestedIdBase: "zai-coding-plan",
    suggestedApiKeyEnv: "ZAI_API_KEY",
    defaultModelId: "glm-5",
    modelSuggestions: ["glm-5", "glm-5.1", "glm-5-turbo", "glm-4.7", "glm-4.5-air"],
    baseUrl: "https://api.z.ai/api/coding/paas/v4",
    protocol: "chat_completions",
    capabilities: ["chat", "tool_use", "reasoning"],
    maxTokens: 8192,
  },
  {
    id: "aihubmix",
    label: "AiHubMix",
    description: "AiHubMix unified OpenAI-compatible model gateway.",
    type: "openai_compatible",
    group: "template",
    category: "aggregator",
    iconLabel: "AH",
    homepageUrl: "https://docs.aihubmix.com/en/index",
    apiKeyUrl: "https://aihubmix.com/",
    isRecommended: true,
    suggestedIdBase: "aihubmix",
    suggestedApiKeyEnv: "AIHUBMIX_API_KEY",
    defaultModelId: "gpt-5.2",
    modelSuggestions: ["gpt-5.2", "gpt-4o", "claude-sonnet-4-5", "gemini-2.5-pro", "deepseek-v4-flash"],
    baseUrl: "https://aihubmix.com/v1",
    protocol: "chat_completions",
    capabilities: ["chat", "tool_use", "image_input", "json_mode", "reasoning"],
    maxTokens: 8192,
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    description: "OpenRouter unified OpenAI-compatible API for many models.",
    type: "openai_compatible",
    group: "template",
    category: "aggregator",
    iconLabel: "OR",
    homepageUrl: "https://openrouter.ai/docs",
    apiKeyUrl: "https://openrouter.ai/settings/keys",
    freeTier: {
      label: "Free models available",
      description: "OpenRouter lists free model options in its catalog.",
      url: "https://openrouter.ai/models?max_price=0",
    },
    recommendationReason: "Start quickly with a unified model gateway.",
    onboardingPriority: 0,
    isRecommended: true,
    suggestedIdBase: "openrouter",
    suggestedApiKeyEnv: "OPENROUTER_API_KEY",
    defaultModelId: "openai/gpt-4o",
    modelSuggestions: ["openai/gpt-4o", "openai/gpt-5.2", "anthropic/claude-sonnet-4.5", "google/gemini-2.5-pro", "deepseek/deepseek-chat"],
    baseUrl: "https://openrouter.ai/api/v1",
    protocol: "chat_completions",
    capabilities: ["chat", "tool_use", "image_input", "json_mode", "reasoning"],
    maxTokens: 8192,
  },
];

function slugify(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export function createModelProviderId(baseProviderId: string, modelId: string) {
  const baseId = getModelProviderBaseId(baseProviderId);
  const modelSlug = slugify(modelId) || "model";
  return `${baseId}${MODEL_PROVIDER_SEPARATOR}${modelSlug}`;
}

export function getModelProviderBaseId(providerId: string) {
  const separatorIndex = providerId.indexOf(MODEL_PROVIDER_SEPARATOR);
  return separatorIndex === -1 ? providerId : providerId.slice(0, separatorIndex);
}

export function createProviderId(base: string, existingProviders: readonly OraProviderConfig[], preferredId?: string) {
  const initial = preferredId?.trim() || slugify(base) || "provider";
  const existingIds = new Set(existingProviders.map((provider) => provider.id));
  if (!existingIds.has(initial)) {
    return initial;
  }

  let index = 2;
  while (existingIds.has(`${initial}-${index}`)) {
    index += 1;
  }
  return `${initial}-${index}`;
}

export function findPresetById(presetId: string) {
  return PROVIDER_PRESETS.find((preset) => preset.id === presetId) ?? PROVIDER_PRESETS[0];
}

export function findPresetForProvider(provider: OraProviderConfig) {
  const providerBaseId = getModelProviderBaseId(provider.id);
  return PROVIDER_PRESETS.find((preset) => {
    if (preset.fixedProviderId && preset.fixedProviderId === providerBaseId) {
      return true;
    }
    if (preset.group === "template" && preset.type === provider.type && preset.baseUrl && provider.baseUrl) {
      return preset.baseUrl === provider.baseUrl;
    }
    return false;
  }) ?? PROVIDER_PRESETS.find((preset) => preset.type === provider.type)
    ?? PROVIDER_PRESETS[0];
}

function providerMatchesPreset(provider: OraProviderConfig, preset: ProviderPreset) {
  const providerBaseId = getModelProviderBaseId(provider.id);
  if (preset.fixedProviderId && preset.fixedProviderId === providerBaseId) {
    return true;
  }
  if (preset.group === "template" && preset.type === provider.type && preset.baseUrl && provider.baseUrl) {
    return preset.baseUrl === provider.baseUrl;
  }
  return false;
}

function isUserVisibleProvider(provider: OraProviderConfig) {
  return provider.type !== "local_smoke";
}

function isUserVisiblePreset(preset: ProviderPreset) {
  return preset.type !== "local_smoke";
}

export function buildProviderCatalog(providers: readonly OraProviderConfig[]): ProviderCatalogEntry[] {
  const usedProviderIds = new Set<string>();
  const visibleProviders = providers.filter(isUserVisibleProvider);
  const entries: ProviderCatalogEntry[] = PROVIDER_PRESETS.filter(isUserVisiblePreset).map((preset) => {
    const matchingProviders = visibleProviders.filter((candidate) => !usedProviderIds.has(candidate.id) && providerMatchesPreset(candidate, preset));
    if (matchingProviders.length > 0) {
      for (const provider of matchingProviders) {
        usedProviderIds.add(provider.id);
      }
      const provider = matchingProviders.find((candidate) => getModelProviderBaseId(candidate.id) === (preset.fixedProviderId ?? preset.suggestedIdBase))
        ?? matchingProviders.find((candidate) => candidate.enabled !== false)
        ?? matchingProviders[0];
      return {
        key: `provider:${getModelProviderBaseId(provider.id)}`,
        preset,
        provider,
        providers: matchingProviders,
        draft: createDraftFromProvider(provider),
        label: preset.label,
        description: preset.description,
        saved: true,
      };
    }

    return {
      key: `preset:${preset.id}`,
      preset,
      providers: [],
      draft: createDraftFromPreset(preset, providers),
      label: preset.label,
      description: preset.description,
      saved: false,
    };
  });

  const customProviderGroups = new Map<string, OraProviderConfig[]>();
  for (const provider of visibleProviders.filter((candidate) => !usedProviderIds.has(candidate.id))) {
    const baseId = getModelProviderBaseId(provider.id);
    customProviderGroups.set(baseId, [...(customProviderGroups.get(baseId) ?? []), provider]);
  }

  const customEntries = [...customProviderGroups.entries()]
    .map(([baseId, groupedProviders]) => {
      const provider = groupedProviders.find((candidate) => candidate.id === baseId)
        ?? groupedProviders.find((candidate) => candidate.enabled !== false)
        ?? groupedProviders[0];
      const preset = findPresetForProvider(provider);
      return {
        key: `provider:${baseId}`,
        preset,
        provider,
        providers: groupedProviders,
        draft: createDraftFromProvider(provider),
        label: provider.label,
        description: preset.description,
        saved: true,
      } satisfies ProviderCatalogEntry;
    });

  return [...entries, ...customEntries];
}

export function createDraftFromPreset(
  preset: ProviderPreset,
  existingProviders: readonly OraProviderConfig[],
): ProviderDraft {
  const providerId = preset.fixedProviderId
    ?? createProviderId(preset.suggestedIdBase, existingProviders);

  return {
    presetId: preset.id,
    id: providerId,
    label: preset.label,
    type: preset.type,
    modelId: preset.defaultModelId,
    baseUrl: preset.baseUrl ?? "",
    apiKeyEnv: preset.suggestedApiKeyEnv ?? "",
    protocol: preset.protocol ?? "chat_completions",
    anthropicVersion: preset.anthropicVersion ?? "2023-06-01",
    maxTokens: preset.maxTokens ? String(preset.maxTokens) : "",
    temperature: preset.temperature !== undefined ? String(preset.temperature) : "",
    dropParams: "",
    capabilities: [...preset.capabilities],
    headersText: formatHeaders(preset.headers),
    enabled: false,
  };
}

export function createDraftFromProvider(provider: OraProviderConfig): ProviderDraft {
  const preset = findPresetForProvider(provider);
  return {
    presetId: preset.id,
    id: provider.id,
    label: provider.label,
    type: provider.type,
    modelId: provider.modelId,
    baseUrl: provider.baseUrl ?? "",
    apiKeyEnv: provider.apiKeyEnv ?? "",
    protocol: provider.protocol ?? "chat_completions",
    anthropicVersion: provider.anthropicVersion ?? "2023-06-01",
    maxTokens: provider.maxTokens ? String(provider.maxTokens) : "",
    temperature: provider.temperature !== undefined ? String(provider.temperature) : "",
    dropParams: (provider.dropParams ?? []).join(", "),
    capabilities: provider.capabilities?.length ? [...provider.capabilities] : ["chat"],
    headersText: formatHeaders(provider.headers),
    enabled: provider.enabled !== false,
  };
}

function formatHeaders(headers?: Record<string, string>) {
  if (!headers || Object.keys(headers).length === 0) {
    return "";
  }
  return Object.entries(headers)
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");
}

function parseHeaders(headersText: string) {
  const entries = headersText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const separator = line.indexOf(":");
      if (separator === -1) {
        return [];
      }

      const key = line.slice(0, separator).trim();
      const value = line.slice(separator + 1).trim();
      return key && value ? [[key, value] as const] : [];
    });

  return Object.fromEntries(entries);
}

export function buildProviderConfigFromDraft(draft: ProviderDraft): OraProviderConfig {
  const capabilities: ProviderCapability[] = draft.capabilities.length > 0 ? draft.capabilities : ["chat"];
  return {
    id: draft.id,
    type: draft.type,
    label: draft.label.trim() || "Provider",
    modelId: draft.modelId.trim() || "model-id",
    enabled: draft.enabled,
    baseUrl: draft.baseUrl.trim() || undefined,
    apiKeyEnv: draft.apiKeyEnv.trim() || undefined,
    protocol: draft.type === "openai_compatible" ? draft.protocol : undefined,
    anthropicVersion: draft.type === "anthropic" || draft.type === "anthropic_compatible"
      ? draft.anthropicVersion.trim() || undefined
      : undefined,
    maxTokens: draft.maxTokens.trim() ? Number(draft.maxTokens.trim()) : undefined,
    temperature: draft.temperature.trim() ? Number(draft.temperature.trim()) : undefined,
    capabilities,
    dropParams: draft.dropParams
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    headers: parseHeaders(draft.headersText),
  };
}

export function canEditBaseUrl(type: ProviderType) {
  return type !== "local_smoke";
}
