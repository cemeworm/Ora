import type { ProviderConfig } from "@cemeworm/shared";
import { readProviderApiKey } from "./providers/provider-utils.js";
import type { EmbeddingProvider } from "./memory-index.js";

export interface EmbeddingProviderConfig {
  /** Provider config to resolve API key and base URL */
  providerConfig: ProviderConfig;
  /** Override model ID for embedding (e.g. "text-embedding-3-small") */
  modelId?: string;
  /** Embedding dimensions (default depends on model) */
  dimensions?: number;
  /** Fetch implementation */
  fetchImpl?: typeof fetch;
}

const DEFAULT_DIMENSIONS = 1536;
const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";
const BATCH_SIZE = 64;

export function createEmbeddingProvider(config: EmbeddingProviderConfig): EmbeddingProvider {
  const modelId = config.modelId ?? DEFAULT_EMBEDDING_MODEL;
  const dimensions = config.dimensions ?? DEFAULT_DIMENSIONS;
  const fetchImpl = config.fetchImpl ?? fetch;
  const providerConfig = config.providerConfig;

  const baseUrl = (providerConfig.baseUrl ?? "https://api.openai.com/v1").replace(/\/+$/, "");
  const apiKey = readProviderApiKey(providerConfig, undefined, process.env);

  return {
    id: providerConfig.id,
    modelId,
    dimensions,
    async embedTexts(texts: string[]): Promise<number[][]> {
      if (!apiKey) {
        throw new Error(`Missing API key for embedding provider ${providerConfig.id}`);
      }

      const results: number[][] = [];
      // Batch to avoid oversized requests
      for (let i = 0; i < texts.length; i += BATCH_SIZE) {
        const batch = texts.slice(i, i + BATCH_SIZE);
        const response = await fetchImpl(`${baseUrl}/embeddings`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: modelId,
            input: batch,
            dimensions,
          }),
          signal: AbortSignal.timeout(30_000),
        });

        if (!response.ok) {
          const body = await response.text().catch(() => "");
          throw new Error(`Embedding provider ${providerConfig.id} failed with ${response.status}: ${body.slice(0, 200)}`);
        }

        const json = await response.json() as {
          data: Array<{ embedding: number[]; index: number }>;
        };

        // Sort by index to maintain order
        const sorted = json.data.sort((a, b) => a.index - b.index);
        for (const item of sorted) {
          results.push(item.embedding);
        }
      }

      return results;
    },
  };
}
