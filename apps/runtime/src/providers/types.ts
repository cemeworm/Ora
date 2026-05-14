import type { ModeReasoningEffort, ModelTokenUsage, ProviderConfig, ProviderModelsResult, ProviderRegistry as SharedProviderRegistry, ProviderType } from "@cemeworm/shared";

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type ModelRole = "system" | "developer" | "user" | "assistant" | "tool";

export interface ModelToolDefinition {
  id: string;
  description?: string;
  parameters?: Record<string, unknown>;
}

export type ModelToolChoice = "auto" | "none";

export interface ModelToolCall {
  id: string;
  toolId: string;
  args: Record<string, unknown>;
  raw?: unknown;
}

export interface ModelImageBlock {
  mediaType: string;
  data: string;
}

export interface ModelMessage {
  role: ModelRole;
  content: string;
  reasoningContent?: string;
  toolCalls?: readonly ModelToolCall[];
  toolCallId?: string;
  toolName?: string;
}

export interface ModelRequest {
  prompt?: string;
  messages?: readonly ModelMessage[];
  system?: string;
  temperature?: number;
  maxTokens?: number;
  reasoningEffort?: Exclude<ModeReasoningEffort, "none">;
  tools?: readonly ModelToolDefinition[];
  toolChoice?: ModelToolChoice;
  providerCache?: {
    stablePrefixMessageCount?: number;
    stableSystemPrefix?: string;
    openaiPreviousResponseId?: string;
    openaiDeltaMessages?: readonly ModelMessage[];
  };
  signal?: AbortSignal;
}

export interface ModelResponse {
  providerId: string;
  providerType: ProviderType;
  modelId: string;
  text: string;
  reasoningContent?: string;
  raw: unknown;
  usage?: ModelTokenUsage;
  toolCalls?: ModelToolCall[];
  finishReason?: string;
  providerResponseId?: string;
}

export interface ModelStreamChunk {
  delta: string;
  text: string;
  raw?: unknown;
}

export interface ModelStreamEvent {
  kind: "sse_frame" | "fallback_started" | "fallback_response" | "local_stream_started";
  streamMode: "sse" | "fallback_single" | "local_smoke";
  raw?: unknown;
}

export interface ModelStreamCallbacks {
  onTextDelta?: (chunk: ModelStreamChunk) => void | Promise<void>;
  onStreamEvent?: (event: ModelStreamEvent) => void | Promise<void>;
}

export interface ProviderRuntimeOptions {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: FetchLike;
}

export interface ModelProvider {
  (request: ModelRequest): Promise<ModelResponse>;
  stream?: (request: ModelRequest, callbacks?: ModelStreamCallbacks) => Promise<ModelResponse>;
  listModels?: () => Promise<ProviderModelsResult>;
}

export interface ProviderRegistry {
  readonly config: SharedProviderRegistry;
  list(): readonly ProviderConfig[];
  resolve(providerId?: string): ModelProvider;
  invoke(providerId: string | undefined, request: ModelRequest): Promise<ModelResponse>;
  invokeStream(providerId: string | undefined, request: ModelRequest, callbacks?: ModelStreamCallbacks): Promise<ModelResponse>;
}
