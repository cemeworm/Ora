import { describe, it, expect, vi, beforeEach } from "vitest";
import { createCache, resolveBackendFromEnv, MemoryCache } from "@cemeworm/shared";

beforeEach(() => {
  vi.restoreAllMocks();
  vi.stubEnv("ORA_CACHE_BACKEND", "");
  vi.stubEnv("ORA_REDIS_URL", "");
});

describe("resolveBackendFromEnv", () => {
  it("returns 'memory' when ORA_CACHE_BACKEND is not set", () => {
    expect(resolveBackendFromEnv()).toBe("memory");
  });
  it("returns 'redis' when ORA_CACHE_BACKEND is 'redis'", () => {
    vi.stubEnv("ORA_CACHE_BACKEND", "redis");
    expect(resolveBackendFromEnv()).toBe("redis");
  });
  it("returns 'memory' when ORA_CACHE_BACKEND is unknown", () => {
    vi.stubEnv("ORA_CACHE_BACKEND", "sqlite");
    expect(resolveBackendFromEnv()).toBe("memory");
  });
});

describe("createCache factory", () => {
  it("creates a MemoryCache by default", async () => {
    const c = await createCache(); expect(c).toBeInstanceOf(MemoryCache);
  });
  it("creates a MemoryCache when backend=memory", async () => {
    const c = await createCache({ backend: "memory" }); expect(c).toBeInstanceOf(MemoryCache);
  });
  it("creates a RedisCache when backend=redis with mock", async () => {
    const mockRedis = {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue("OK"),
      setex: vi.fn().mockResolvedValue("OK"),
      del: vi.fn().mockResolvedValue(1),
      exists: vi.fn().mockResolvedValue(0),
      scan: vi.fn().mockResolvedValue(["0", []] as [string, string[]]),
      disconnect: vi.fn(),
    };
    const cache = await createCache({ backend: "redis", redis: { redis: mockRedis as any } });
    await expect(cache.get("test")).resolves.toBeUndefined();
    await cache.set("key", "val");
    expect(mockRedis.set).toHaveBeenCalled();
  });
  it("applies defaultTtlSec to MemoryCache", async () => {
    const cache = await createCache({ backend: "memory", defaultTtlSec: 30 });
    await cache.set("key", "val");
    await expect(cache.has("key")).resolves.toBe(true);
  });
  it("reads ORA_CACHE_BACKEND from env", async () => {
    vi.stubEnv("ORA_CACHE_BACKEND", "memory");
    const cache = await createCache();
    expect(cache).toBeInstanceOf(MemoryCache);
  });
});
