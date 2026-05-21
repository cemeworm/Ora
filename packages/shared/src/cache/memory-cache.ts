import type { Cache, CacheSerialization } from "./interface.js";
import { jsonSerialization } from "./interface.js";

// --------------------------------------------------------------------------
// Config
// --------------------------------------------------------------------------

export interface MemoryCacheConfig {
  /**
   * Default TTL in seconds for entries that don't specify one.
   * `0` means no default TTL (permanent unless explicit TTL given).
   * @default 0
   */
  defaultTtlSec?: number;

  /**
   * Custom serializer/deserializer. Defaults to JSON.
   */
  serialization?: CacheSerialization;

  /**
   * Optional: maximum number of entries before the oldest (by insertion order)
   * are evicted. `0` means unlimited.
   * @default 0
   */
  maxEntries?: number;
}

// --------------------------------------------------------------------------
// Internal entry
// --------------------------------------------------------------------------

interface CacheEntry<T> {
  value: T;
  expiresAt: number | undefined; // epoch ms, undefined = permanent
}

// --------------------------------------------------------------------------
// Implementation
// --------------------------------------------------------------------------

/**
 * In-memory implementation of the `Cache` interface.
 *
 * Values are stored in a `Map` with optional TTL. Entries are lazily evicted
 * on read / has checks. A configurable `maxEntries` cap evicts oldest entries
 * when exceeded.
 */
export class MemoryCache<T = unknown> implements Cache<T> {
  private readonly store = new Map<string, CacheEntry<T>>();
  private readonly defaultTtlSec: number;
  private readonly serialization: CacheSerialization;
  private readonly maxEntries: number;
  private insertionOrder: string[] = [];

  constructor(config: MemoryCacheConfig = {}) {
    this.defaultTtlSec = config.defaultTtlSec ?? 0;
    this.serialization = config.serialization ?? jsonSerialization;
    this.maxEntries = config.maxEntries ?? 0;
  }

  // ------------------------------------------------------------------------
  // Public API
  // ------------------------------------------------------------------------

  async get(key: string): Promise<T | undefined> {
    if (!this.store.has(key)) return undefined;

    const entry = this.store.get(key)!;

    // Lazy expiration check
    if (entry.expiresAt !== undefined && Date.now() > entry.expiresAt) {
      this.store.delete(key);
      this.removeFromOrder(key);
      return undefined;
    }

    // Return a deep clone so mutations to the result don't affect the cache
    const serialized = this.serialization.serialize(entry.value);
    return this.serialization.deserialize(serialized) as T;
  }

  async set(key: string, value: T, ttlSec?: number): Promise<void> {
    const effectiveTtl = ttlSec ?? this.defaultTtlSec;
    const expiresAt = effectiveTtl > 0 ? Date.now() + effectiveTtl * 1000 : undefined;

    // Serialize/deserialize to mimic Redis behavior (deep clone via JSON roundtrip)
    const serialized = this.serialization.serialize(value);
    const cloned = this.serialization.deserialize(serialized) as T;

    const isNew = !this.store.has(key);
    this.store.set(key, { value: cloned, expiresAt });

    if (isNew) {
      this.insertionOrder.push(key);
      this.evictIfNeeded();
    }
  }

  async del(...keys: string[]): Promise<number> {
    if (keys.length === 0) return 0;
    let count = 0;
    for (const key of keys) {
      // Only count non-expired keys as "deleted"
      if (!this.store.has(key)) continue;
      const entry = this.store.get(key)!;
      if (entry.expiresAt !== undefined && Date.now() > entry.expiresAt) {
        this.store.delete(key);
        this.removeFromOrder(key);
        continue; // expired — treat as already gone
      }
      this.store.delete(key);
      this.removeFromOrder(key);
      count++;
    }
    return count;
  }

  async has(key: string): Promise<boolean> {
    if (!this.store.has(key)) return false;

    const entry = this.store.get(key)!;

    // Lazy expiration check
    if (entry.expiresAt !== undefined && Date.now() > entry.expiresAt) {
      this.store.delete(key);
      this.removeFromOrder(key);
      return false;
    }

    return true;
  }

  async clear(): Promise<void> {
    this.store.clear();
    this.insertionOrder = [];
  }

  async disconnect(): Promise<void> {
    // No-op for in-memory
  }

  // ------------------------------------------------------------------------
  // Internals
  // ------------------------------------------------------------------------

  /**
   * Returns the number of entries currently stored (for testing / monitoring).
   */
  get size(): number {
    return this.store.size;
  }

  private removeFromOrder(key: string): void {
    const idx = this.insertionOrder.indexOf(key);
    if (idx !== -1) {
      this.insertionOrder.splice(idx, 1);
    }
  }

  private evictIfNeeded(): void {
    if (this.maxEntries <= 0) return;
    while (this.store.size > this.maxEntries && this.insertionOrder.length > 0) {
      const oldest = this.insertionOrder.shift()!;
      this.store.delete(oldest);
    }
  }
}
