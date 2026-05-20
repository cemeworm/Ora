/**
 * Generic cache interface decoupled from any specific backend.
 * Implementations can be Redis, in-memory, SQLite, etc.
 */
export interface Cache<T = unknown> {
  /**
   * Retrieve a value by key. Returns `undefined` when the key does not exist
   * or has expired.
   */
  get(key: string): Promise<T | undefined>;

  /**
   * Store a value with optional TTL (in seconds). When `ttlSec` is omitted,
   * the implementation should apply its own default or store permanently.
   */
  set(key: string, value: T, ttlSec?: number): Promise<void>;

  /**
   * Delete one or more keys. Returns the number of keys actually removed.
   */
  del(...keys: string[]): Promise<number>;

  /**
   * Check whether a key exists and is not expired.
   */
  has(key: string): Promise<boolean>;

  /**
   * Clear all cached entries managed by this cache instance.
   */
  clear(): Promise<void>;

  /**
   * Optional: disconnect and release underlying resources.
   */
  disconnect?(): Promise<void>;
}

/**
 * Serializable value contract — implementations may use JSON or another
 * serializer under the hood.
 */
export interface CacheSerialization<T = unknown> {
  serialize(value: T): string;
  deserialize(raw: string): T;
}

/**
 * Default serializer that handles primitives, objects, arrays, and `null`
 * using JSON roundtrip.
 */
export const jsonSerialization: CacheSerialization = {
  serialize: (value: unknown): string => {
    if (value === undefined) throw new Error("Cache does not support storing `undefined`");
    return JSON.stringify(value);
  },
  deserialize: (raw: string): unknown => JSON.parse(raw) as unknown,
};
