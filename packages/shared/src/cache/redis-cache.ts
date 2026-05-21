import type { Redis, RedisOptions } from "ioredis";
import type { Cache, CacheSerialization } from "./interface.js";
import { jsonSerialization } from "./interface.js";

// --------------------------------------------------------------------------
// Config
// --------------------------------------------------------------------------

export interface RedisCacheConfig {
  /** Reuse an existing ioredis `Redis` instance. */
  redis?: Redis;

  /** Connection options used when no `redis` instance is provided. */
  connection?: RedisOptions;

  /** Connection string (e.g. `redis://localhost:6379/0`). Takes precedence over `connection`. */
  url?: string;

  /**
   * Default TTL in seconds for entries that don't specify one.
   * `0` means no default TTL (permanent unless explicit TTL given).
   * @default 0
   */
  defaultTtlSec?: number;

  /**
   * Key prefix to avoid collisions with other apps using the same Redis instance.
   * @default "cache:"
   */
  keyPrefix?: string;

  /**
   * Custom serializer/deserializer. Defaults to JSON.
   */
  serialization?: CacheSerialization;
}

// --------------------------------------------------------------------------
// Implementation
// --------------------------------------------------------------------------

const DEFAULT_PREFIX = "cache:";

/**
 * Redis-backed implementation of the `Cache` interface.
 *
 * Values are serialized as JSON strings. Expiry is delegated to Redis `SET`
 * with `PX` / `EX` flags so Redis handles TTL natively.
 */
export class RedisCache<T = unknown> implements Cache<T> {
  private readonly redis: Redis;
  private readonly prefix: string;
  private readonly defaultTtlSec: number;
  private readonly serialization: CacheSerialization;
  private owned: boolean;

  constructor(config: RedisCacheConfig = {}) {
    const {
      redis,
      url,
      connection,
      defaultTtlSec = 0,
      keyPrefix = DEFAULT_PREFIX,
      serialization = jsonSerialization,
    } = config;

    if (redis) {
      this.redis = redis;
      this.owned = false;
    } else {
      // lazy import so ioredis is only loaded when needed
      const IORedis = require("ioredis");
      const RedisConstructor = IORedis.default ?? IORedis;
      this.redis = url ? new RedisConstructor(url) : new RedisConstructor(connection ?? {});
      this.owned = true;
    }

    this.prefix = keyPrefix;
    this.defaultTtlSec = defaultTtlSec;
    this.serialization = serialization;
  }

  // ------------------------------------------------------------------------
  // Public API
  // ------------------------------------------------------------------------

  async get(key: string): Promise<T | undefined> {
    const raw = await this.redis.get(this.prefixedKey(key));
    if (raw === null || raw === undefined) return undefined;
    return this.serialization.deserialize(raw) as T;
  }

  async set(key: string, value: T, ttlSec?: number): Promise<void> {
    const serialized = this.serialization.serialize(value);
    const prefixed = this.prefixedKey(key);
    const effectiveTtl = ttlSec ?? this.defaultTtlSec;

    if (effectiveTtl > 0) {
      await this.redis.setex(prefixed, effectiveTtl, serialized);
    } else {
      await this.redis.set(prefixed, serialized);
    }
  }

  async del(...keys: string[]): Promise<number> {
    if (keys.length === 0) return 0;
    const prefixed = keys.map((k) => this.prefixedKey(k));
    return await this.redis.del(...prefixed);
  }

  async has(key: string): Promise<boolean> {
    const exists = await this.redis.exists(this.prefixedKey(key));
    return exists === 1;
  }

  async clear(): Promise<void> {
    // Only delete keys matching our prefix to be a good neighbour.
    let cursor = "0";
    do {
      const [nextCursor, keys] = await this.redis.scan(
        cursor,
        "MATCH",
        `${this.prefix}*`,
        "COUNT",
        200
      );
      cursor = nextCursor;
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
    } while (cursor !== "0");
  }

  async disconnect(): Promise<void> {
    if (this.owned) {
      this.redis.disconnect();
    }
  }

  // ------------------------------------------------------------------------
  // Internals
  // ------------------------------------------------------------------------

  private prefixedKey(key: string): string {
    return `${this.prefix}${key}`;
  }
}
