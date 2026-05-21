import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { MemoryCache } from "@cemeworm/shared";

describe("MemoryCache", () => {
  function createCache<T>(opts?: { defaultTtlSec?: number; maxEntries?: number }): MemoryCache<T> {
    return new MemoryCache<T>(opts);
  }

  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  describe("get / set", () => {
    it("stores and retrieves a string value", async () => {
      const cache = createCache<string>(); await cache.set("greeting", "hello");
      await expect(cache.get("greeting")).resolves.toBe("hello");
    });
    it("stores and retrieves an object", async () => {
      const cache = createCache<{ a: number; b: string }>();
      await cache.set("obj", { a: 1, b: "two" });
      await expect(cache.get("obj")).resolves.toEqual({ a: 1, b: "two" });
    });
    it("stores and retrieves a numeric value", async () => {
      const cache = createCache<number>(); await cache.set("num", 42);
      await expect(cache.get("num")).resolves.toBe(42);
    });
    it("returns undefined for missing keys", async () => {
      const cache = createCache();
      await expect(cache.get("nonexistent")).resolves.toBeUndefined();
    });
    it("handles null value", async () => {
      const cache = createCache<null>(); await cache.set("nullval", null);
      await expect(cache.get("nullval")).resolves.toBeNull();
    });
    it("returns a deep clone", async () => {
      const cache = createCache<{ items: number[] }>();
      await cache.set("arr", { items: [1, 2, 3] });
      const result = await cache.get("arr");
      expect(result).toBeDefined();
      if (result) result.items.push(4);
      const again = await cache.get("arr");
      expect(again?.items).toEqual([1, 2, 3]);
    });
  });

  describe("TTL", () => {
    it("expires entries after the specified TTL", async () => {
      const cache = createCache(); await cache.set("ephemeral", "gone", 10);
      await expect(cache.get("ephemeral")).resolves.toBe("gone");
      vi.advanceTimersByTime(10_001);
      await expect(cache.get("ephemeral")).resolves.toBeUndefined();
    });
    it("applies default TTL when no explicit TTL is given", async () => {
      const cache = createCache({ defaultTtlSec: 5 }); await cache.set("auto", "value");
      await expect(cache.get("auto")).resolves.toBe("value");
      vi.advanceTimersByTime(5_001);
      await expect(cache.get("auto")).resolves.toBeUndefined();
    });
    it("keeps entry permanently when TTL is 0", async () => {
      const cache = createCache({ defaultTtlSec: 0 }); await cache.set("perm", "forever");
      vi.advanceTimersByTime(86_400_000);
      await expect(cache.get("perm")).resolves.toBe("forever");
    });
    it("explicit TTL overrides default TTL", async () => {
      const cache = createCache({ defaultTtlSec: 60 }); await cache.set("short", "x", 1);
      vi.advanceTimersByTime(1_001);
      await expect(cache.get("short")).resolves.toBeUndefined();
    });
    it("has returns false for expired keys", async () => {
      const cache = createCache(); await cache.set("temp", "val", 2);
      vi.advanceTimersByTime(2_001);
      await expect(cache.has("temp")).resolves.toBe(false);
    });
  });

  describe("del", () => {
    it("deletes a single key", async () => {
      const cache = createCache(); await cache.set("a", 1); await cache.set("b", 2);
      expect(await cache.del("a")).toBe(1);
      await expect(cache.get("a")).resolves.toBeUndefined();
      await expect(cache.get("b")).resolves.toBe(2);
    });
    it("deletes multiple keys", async () => {
      const cache = createCache(); await cache.set("x", 10); await cache.set("y", 20); await cache.set("z", 30);
      expect(await cache.del("x", "y")).toBe(2);
    });
    it("returns 0 for empty keys list", async () => {
      const cache = createCache(); expect(await cache.del()).toBe(0);
    });
    it("deleting an expired key returns 0", async () => {
      const cache = createCache(); await cache.set("exp", "val", 1);
      vi.advanceTimersByTime(1_001);
      expect(await cache.del("exp")).toBe(0);
    });
  });

  describe("has", () => {
    it("returns true for existing key", async () => {
      const cache = createCache(); await cache.set("exists", true);
      await expect(cache.has("exists")).resolves.toBe(true);
    });
    it("returns false for missing key", async () => {
      const cache = createCache(); await expect(cache.has("missing")).resolves.toBe(false);
    });
  });

  describe("clear", () => {
    it("removes all entries", async () => {
      const cache = createCache(); await cache.set("k1", 1); await cache.set("k2", 2);
      await cache.clear();
      await expect(cache.get("k1")).resolves.toBeUndefined();
      expect(cache.size).toBe(0);
    });
  });

  describe("maxEntries eviction", () => {
    it("evicts oldest entries when maxEntries is exceeded", async () => {
      const cache = createCache<number>({ maxEntries: 3 });
      await cache.set("a", 1); await cache.set("b", 2); await cache.set("c", 3);
      expect(cache.size).toBe(3);
      await cache.set("d", 4);
      expect(cache.size).toBe(3);
      await expect(cache.get("a")).resolves.toBeUndefined();
      await expect(cache.get("d")).resolves.toBe(4);
    });
    it("does not evict when maxEntries is 0", async () => {
      const cache = createCache<number>({ maxEntries: 0 });
      for (let i = 0; i < 100; i++) await cache.set(`k${i}`, i);
      expect(cache.size).toBe(100);
    });
  });

  describe("disconnect", () => {
    it("is a no-op but can be called safely", async () => {
      const cache = createCache(); await expect(cache.disconnect()).resolves.toBeUndefined();
    });
  });

  describe("serialization edge cases", () => {
    it("handles boolean values", async () => {
      const cache = createCache<boolean>(); await cache.set("flag", false);
      await expect(cache.get("flag")).resolves.toBe(false);
    });
    it("handles arrays", async () => {
      const cache = createCache<number[]>(); await cache.set("arr", [1, 2, 3]);
      await expect(cache.get("arr")).resolves.toEqual([1, 2, 3]);
    });
    it("handles nested objects", async () => {
      const cache = createCache<{ deep: { nested: string } }>();
      await cache.set("nested", { deep: { nested: "works" } });
      await expect(cache.get("nested")).resolves.toEqual({ deep: { nested: "works" } });
    });
  });
});
