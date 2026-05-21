import { describe, it, expect, vi, beforeEach } from "vitest";
import { RedisCache } from "@cemeworm/shared";

// ---------------------------------------------------------------------------
// Mock ioredis
// ---------------------------------------------------------------------------

const mockStore = new Map<string, { value: string; ttl?: number; expiresAt?: number }>();

const mockRedis = {
  get: vi.fn(async (key: string): Promise<string | null> => {
    const entry = mockStore.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== undefined && Date.now() > entry.expiresAt) {
      mockStore.delete(key);
      return null;
    }
    return entry.value;
  }),
  set: vi.fn(async (key: string, value: string): Promise<"OK"> => {
    mockStore.set(key, { value });
    return "OK";
  }),
  setex: vi.fn(async (key: string, ttl: number, value: string): Promise<"OK"> => {
    mockStore.set(key, { value, ttl, expiresAt: Date.now() + ttl * 1000 });
    return "OK";
  }),
  del: vi.fn(async (...keys: string[]): Promise<number> => {
    let count = 0;
    for (const k of keys) {
      if (mockStore.delete(k)) count++;
    }
    return count;
  }),
  exists: vi.fn(async (key: string): Promise<number> => {
    const entry = mockStore.get(key);
    if (!entry) return 0;
    if (entry.expiresAt !== undefined && Date.now() > entry.expiresAt) {
      mockStore.delete(key);
      return 0;
    }
    return 1;
  }),
  scan: vi.fn(async (
    _cursor: string,
    _type: "MATCH",
    pattern: string,
    _countType: "COUNT",
    _count: number
  ): Promise<[string, string[]]> => {
    const prefix = pattern.replace("*", "");
    const matching = [...mockStore.keys()].filter((k) => k.startsWith(prefix));
    return ["0", matching];
  }),
  disconnect: vi.fn(),
} as any;

beforeEach(() => {
  mockStore.clear();
  vi.clearAllMocks();
});

describe("RedisCache", () => {
  function createCache<T>(
    opts?: { defaultTtlSec?: number; keyPrefix?: string }
  ): RedisCache<T> {
    return new RedisCache<T>({
      redis: mockRedis as any,
      ...opts,
    });
  }

  // -------------------------------------------------------------------
  // get / set
  // -------------------------------------------------------------------

  describe("get / set", () => {
    it("stores and retrieves a string value", async () => {
      const cache = createCache<string>();
      await cache.set("greeting", "hello");
      const result = await cache.get("greeting");
      expect(result).toBe("hello");
    });

    it("stores and retrieves an object", async () => {
      const cache = createCache<{ a: number; b: string }>();
      const obj = { a: 1, b: "two" };
      await cache.set("obj", obj);
      const result = await cache.get("obj");
      expect(result).toEqual(obj);
    });

    it("stores and retrieves a numeric value", async () => {
      const cache = createCache<number>();
      await cache.set("num", 42);
      const result = await cache.get("num");
      expect(result).toBe(42);
    });

    it("returns undefined for missing keys", async () => {
      const cache = createCache();
      const result = await cache.get("nonexistent");
      expect(result).toBeUndefined();
    });

    it("handles null value", async () => {
      const cache = createCache<null>();
      await cache.set("nullval", null);
      const result = await cache.get("nullval");
      expect(result).toBeNull();
    });
  });

  // -------------------------------------------------------------------
  // TTL
  // -------------------------------------------------------------------

  describe("TTL", () => {
    it("applies explicit TTL (seconds)", async () => {
      const cache = createCache();
      await cache.set("ephemeral", "gone-soon", 60);
      expect(mockRedis.setex).toHaveBeenCalledWith(
        "cache:ephemeral",
        60,
        '"gone-soon"'
      );
    });

    it("applies default TTL when configured", async () => {
      const cache = createCache({ defaultTtlSec: 300 });
      await cache.set("default-ttl", "value");
      expect(mockRedis.setex).toHaveBeenCalledWith(
        "cache:default-ttl",
        300,
        '"value"'
      );
    });

    it("uses SET (no expiry) when no TTL provided and defaultTtlSec is 0", async () => {
      const cache = createCache({ defaultTtlSec: 0 });
      await cache.set("permanent", "always");
      expect(mockRedis.setex).not.toHaveBeenCalled();
      expect(mockRedis.set).toHaveBeenCalledWith(
        "cache:permanent",
        '"always"'
      );
    });
  });

  // -------------------------------------------------------------------
  // del
  // -------------------------------------------------------------------

  describe("del", () => {
    it("deletes a single key and returns count", async () => {
      const cache = createCache();
      await cache.set("a", 1);
      await cache.set("b", 2);
      const count = await cache.del("a");
      expect(count).toBe(1);
      await expect(cache.get("a")).resolves.toBeUndefined();
      await expect(cache.get("b")).resolves.toBe(2);
    });

    it("deletes multiple keys", async () => {
      const cache = createCache();
      await cache.set("x", 10);
      await cache.set("y", 20);
      await cache.set("z", 30);
      const count = await cache.del("x", "y");
      expect(count).toBe(2);
    });

    it("returns 0 for empty keys list", async () => {
      const cache = createCache();
      const count = await cache.del();
      expect(count).toBe(0);
    });
  });

  // -------------------------------------------------------------------
  // has
  // -------------------------------------------------------------------

  describe("has", () => {
    it("returns true for existing key", async () => {
      const cache = createCache();
      await cache.set("exists", true);
      await expect(cache.has("exists")).resolves.toBe(true);
    });

    it("returns false for missing key", async () => {
      const cache = createCache();
      await expect(cache.has("missing")).resolves.toBe(false);
    });
  });

  // -------------------------------------------------------------------
  // clear
  // -------------------------------------------------------------------

  describe("clear", () => {
    it("removes all keys with the configured prefix", async () => {
      const cache = createCache();
      await cache.set("k1", 1);
      await cache.set("k2", 2);
      await cache.clear();
      await expect(cache.get("k1")).resolves.toBeUndefined();
      await expect(cache.get("k2")).resolves.toBeUndefined();
    });
  });

  // -------------------------------------------------------------------
  // prefix
  // -------------------------------------------------------------------

  describe("key prefix", () => {
    it("defaults to 'cache:'", async () => {
      const cache = createCache();
      await cache.set("test", "val");
      await cache.has("test");
      expect(mockRedis.exists).toHaveBeenCalledWith("cache:test");
    });

    it("accepts custom prefix", async () => {
      const cache = createCache({ keyPrefix: "myapp:" });
      await cache.set("x", 1);
      await cache.has("x");
      expect(mockRedis.exists).toHaveBeenCalledWith("myapp:x");
    });
  });

  // -------------------------------------------------------------------
  // disconnect
  // -------------------------------------------------------------------

  describe("disconnect", () => {
    it("does not disconnect externally-provided Redis instance (owned=false)", async () => {
      const cache = createCache();
      await cache.disconnect();
      expect(mockRedis.disconnect).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------
  // serialization edge cases
  // -------------------------------------------------------------------

  describe("serialization edge cases", () => {
    it("handles boolean values", async () => {
      const cache = createCache<boolean>();
      await cache.set("flag", false);
      await expect(cache.get("flag")).resolves.toBe(false);
    });

    it("handles arrays", async () => {
      const cache = createCache<number[]>();
      await cache.set("arr", [1, 2, 3]);
      await expect(cache.get("arr")).resolves.toEqual([1, 2, 3]);
    });

    it("handles nested objects", async () => {
      const cache = createCache<{ deep: { nested: string } }>();
      await cache.set("nested", { deep: { nested: "works" } });
      await expect(cache.get("nested")).resolves.toEqual({
        deep: { nested: "works" },
      });
    });
  });
});
