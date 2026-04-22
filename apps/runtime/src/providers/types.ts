import type { ProviderConfig, ProviderRegistry as SharedProviderRegistry, ProviderType } from "@ora/shared";

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type ModelRole = "system" | "developer" | "user" | "assistant";

export interface ModelMessage {
  role: ModelRole;
  content: string;
}

export interface ModelRequest {
  prompt?: string;
  messages?: readonly ModelMessage[];
  system?: string;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface ModelResponse {
  providerId: string;
  providerType: ProviderType;
  modelId: string;
  text: string;
  raw: unknown;
}

export interface ProviderRuntimeOptions {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: FetchLike;
}

export type ModelProvider = (request: ModelRequest) => Promise<ModelResponse>;

export interface ProviderRegistry {
  readonly config: SharedProviderRegistry;
  list(): readonly ProviderConfig[];
  resolve(providerId?: string): ModelProvider;
  invoke(providerId: string | undefined, request: ModelRequest): Promise<ModelResponse>;
}
