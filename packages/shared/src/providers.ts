import { z } from "zod";

// ---------------------------------------------------------------------------
// Provider Config Schemas
// ---------------------------------------------------------------------------

export const ProviderTypeSchema = z.enum(["anthropic", "anthropic_compatible", "openai", "openai_compatible", "local_smoke"]);
export type ProviderType = z.infer<typeof ProviderTypeSchema>;

export const OpenAICompatibleProtocolSchema = z.enum(["chat_completions", "responses"]);
export type OpenAICompatibleProtocol = z.infer<typeof OpenAICompatibleProtocolSchema>;

export const ProviderCapabilitySchema = z.enum([
  "chat",
  "tool_use",
  "image_input",
  "json_mode",
  "reasoning"
]);
export type ProviderCapability = z.infer<typeof ProviderCapabilitySchema>;

export const ProviderPromptCacheSchema = z.object({
  enabled: z.boolean().optional(),
  ttl: z.enum(["5m", "1h"]).default("5m"),
}).default({});
export type ProviderPromptCache = z.infer<typeof ProviderPromptCacheSchema>;

export const ProviderConfigSchema = z.object({
  id: z.string().min(1),
  type: ProviderTypeSchema,
  label: z.string().min(1),
  modelId: z.string().min(1),
  enabled: z.boolean().default(true),
  baseUrl: z.string().url().optional(),
  apiKeyEnv: z.string().regex(/^[A-Z_][A-Z0-9_]*$/).optional(),
  protocol: OpenAICompatibleProtocolSchema.optional(),
  anthropicVersion: z.string().min(1).optional(),
  maxTokens: z.number().int().positive().optional(),
  temperature: z.number().min(0).max(2).optional(),
  contextWindow: z.number().int().positive().optional(),
  maxContextWindow: z.number().int().positive().optional(),
  autoCompactTokenLimit: z.number().int().positive().optional(),
  promptCache: ProviderPromptCacheSchema.optional(),
  capabilities: z.array(ProviderCapabilitySchema).default(["chat"]),
  dropParams: z.array(z.string().min(1)).default([]),
  headers: z.record(z.string().min(1)).default({}),
  timeoutMs: z.number().int().positive().optional(),
});
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;

export const ProviderRegistrySchema = z.object({
  providers: z.array(ProviderConfigSchema),
  defaultProviderId: z.string().min(1),
});
export type ProviderRegistry = z.infer<typeof ProviderRegistrySchema>;

export const ProviderSecretStorageSchema = z.enum(["keychain", "unavailable"]);
export type ProviderSecretStorage = z.infer<typeof ProviderSecretStorageSchema>;

export const ProviderSecretStatusSchema = z.object({
  providerId: z.string().min(1),
  hasSecret: z.boolean(),
  storage: ProviderSecretStorageSchema,
  keychainService: z.string().min(1).optional(),
  detail: z.string().min(1),
});
export type ProviderSecretStatus = z.infer<typeof ProviderSecretStatusSchema>;

export const ProviderSecretWriteSchema = z.object({
  providerId: z.string().min(1),
  secret: z.string().min(1),
});
export type ProviderSecretWrite = z.infer<typeof ProviderSecretWriteSchema>;

export const ProviderStatusStateSchema = z.enum([
  "not_configured",
  "key_stored",
  "needs_key",
  "verified",
  "failed",
]);
export type ProviderStatusState = z.infer<typeof ProviderStatusStateSchema>;

export const ProviderStatusSchema = z.object({
  providerId: z.string().min(1),
  state: ProviderStatusStateSchema,
  detail: z.string().min(1),
  checkedAt: z.number().int().nonnegative().optional(),
});
export type ProviderStatus = z.infer<typeof ProviderStatusSchema>;

export const ProviderModelSourceSchema = z.enum(["remote", "preset", "local"]);
export type ProviderModelSource = z.infer<typeof ProviderModelSourceSchema>;

export const ProviderModelSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).optional(),
  created: z.number().int().nonnegative().optional(),
  ownedBy: z.string().min(1).optional(),
  source: ProviderModelSourceSchema.optional(),
});
export type ProviderModel = z.infer<typeof ProviderModelSchema>;

export const ProviderModelsStatusSchema = z.enum(["ok", "unsupported", "error"]);
export type ProviderModelsStatus = z.infer<typeof ProviderModelsStatusSchema>;

export const ProviderModelsParamsSchema = z.object({
  provider: ProviderConfigSchema,
});
export type ProviderModelsParams = z.infer<typeof ProviderModelsParamsSchema>;

export const ProviderModelsResultSchema = z.object({
  models: z.array(ProviderModelSchema),
  status: ProviderModelsStatusSchema,
  authoritative: z.boolean(),
  message: z.string().min(1).optional(),
  fetchedAt: z.string().datetime().optional(),
});
export type ProviderModelsResult = z.infer<typeof ProviderModelsResultSchema>;

export const ProviderVerifyParamsSchema = z.object({
  provider: ProviderConfigSchema,
});
export type ProviderVerifyParams = z.infer<typeof ProviderVerifyParamsSchema>;

export const DEFAULT_PROVIDERS: ProviderConfig[] = [
  { id: "anthropic-claude", type: "anthropic", label: "Claude", modelId: "claude-sonnet-4-20250514", enabled: false, maxTokens: 8192, contextWindow: 200000, capabilities: ["chat", "tool_use"], dropParams: [], headers: {} },
  { id: "openai-gpt", type: "openai", label: "GPT", modelId: "gpt-4o", enabled: false, maxTokens: 8192, contextWindow: 128000, capabilities: ["chat", "tool_use", "image_input", "json_mode"], dropParams: [], headers: {} },
  { id: "deepseek", type: "openai_compatible", label: "DeepSeek", modelId: "deepseek-v4-flash", enabled: true, baseUrl: "https://api.deepseek.com", apiKeyEnv: "DEEPSEEK_API_KEY", protocol: "chat_completions", maxTokens: 8192, contextWindow: 128000, capabilities: ["chat", "tool_use", "reasoning", "json_mode"], dropParams: [], headers: {} },
  { id: "local-smoke", type: "local_smoke", label: "Smoke Model", modelId: "smoke-model", enabled: true, maxTokens: 1024, contextWindow: 4096, capabilities: ["chat"], dropParams: [], headers: {} },
];
