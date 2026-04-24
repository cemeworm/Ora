import type { OpenAICompatibleProtocol, ProviderCapability, ProviderType } from "@ora/shared";
import type { OraProviderConfig } from "./runtimeClient";

export interface ProviderPreset {
  id: string;
  label: string;
  description: string;
  type: ProviderType;
  group: "official" | "template";
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

export const BUILT_IN_PROVIDER_IDS = new Set(["openai-gpt", "anthropic-claude", "local-smoke"]);

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: "openai-official",
    label: "OpenAI",
    description: "Official OpenAI Responses API provider.",
    type: "openai",
    group: "official",
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
    suggestedIdBase: "deepseek",
    suggestedApiKeyEnv: "DEEPSEEK_API_KEY",
    defaultModelId: "deepseek-chat",
    modelSuggestions: ["deepseek-chat", "deepseek-reasoner"],
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
    suggestedIdBase: "moonshot",
    suggestedApiKeyEnv: "MOONSHOT_API_KEY",
    defaultModelId: "kimi-k2-0711-preview",
    modelSuggestions: ["kimi-k2-0711-preview", "kimi-latest", "moonshot-v1-8k"],
    baseUrl: "https://api.moonshot.ai/v1",
    protocol: "chat_completions",
    capabilities: ["chat", "tool_use", "reasoning"],
    maxTokens: 8192,
  },
];

function slugify(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
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
  return PROVIDER_PRESETS.find((preset) => {
    if (preset.fixedProviderId && preset.fixedProviderId === provider.id) {
      return true;
    }
    if (preset.group === "template" && preset.type === provider.type && preset.baseUrl && provider.baseUrl) {
      return preset.baseUrl === provider.baseUrl;
    }
    return false;
  }) ?? PROVIDER_PRESETS.find((preset) => preset.type === provider.type)
    ?? PROVIDER_PRESETS[0];
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
    enabled: true,
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
    dropParams: provider.dropParams.join(", "),
    capabilities: provider.capabilities,
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
