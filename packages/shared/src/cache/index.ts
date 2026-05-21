export { jsonSerialization } from "./interface.js";
export type { Cache, CacheSerialization } from "./interface.js";
export { RedisCache } from "./redis-cache.js";
export type { RedisCacheConfig } from "./redis-cache.js";
export { MemoryCache } from "./memory-cache.js";
export type { MemoryCacheConfig } from "./memory-cache.js";
export { createCache, resolveBackendFromEnv } from "./factory.js";
export type { CacheBackend, CacheFactoryConfig } from "./factory.js";
