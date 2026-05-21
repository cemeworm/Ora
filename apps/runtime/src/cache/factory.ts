import type { Cache } from "./interface.js";
import type { RedisCacheConfig } from "./redis-cache.js";
import type { MemoryCacheConfig } from "./memory-cache.js";

export type CacheBackend = "memory" | "redis";

export type CacheFactoryConfig = (
  | { backend: "memory"; memory?: MemoryCacheConfig }
  | { backend: "redis"; redis?: RedisCacheConfig }
) & {
  defaultTtlSec?: number;
};

export function resolveBackendFromEnv(): CacheBackend {
  const backend = process.env["ORA_CACHE_BACKEND"];
  if (backend === "redis") return "redis";
  return "memory";
}

export async function createCache<T = unknown>(
  config?: Partial<CacheFactoryConfig>,
): Promise<Cache<T>> {
  const backend = config?.backend ?? resolveBackendFromEnv();
  const defaultTtlSec = config?.defaultTtlSec;
  if (backend === "redis") {
    const { RedisCache } = await import("./redis-cache.js");
    const redisConfig = (config as { redis?: RedisCacheConfig } | undefined)?.redis ?? {};
    return new RedisCache<T>({
      ...redisConfig,
      url: redisConfig.url ?? process.env["ORA_REDIS_URL"] ?? undefined,
      defaultTtlSec: defaultTtlSec ?? redisConfig.defaultTtlSec,
    });
  }
  const { MemoryCache } = await import("./memory-cache.js");
  const memConfig = (config as { memory?: MemoryCacheConfig } | undefined)?.memory ?? {};
  return new MemoryCache<T>({
    ...memConfig,
    defaultTtlSec: defaultTtlSec ?? memConfig.defaultTtlSec,
  });
}
