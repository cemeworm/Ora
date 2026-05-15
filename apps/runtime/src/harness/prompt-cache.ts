import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

export interface PromptSectionCacheOptions {
  maxEntries?: number;
  snapshotPath?: string;
}

interface CacheEntry {
  content: string;
  lastAccess: number;
}

type SnapshotData = Array<[string, CacheEntry]>;

export class PromptSectionCache {
  private readonly cache: Map<string, CacheEntry>;
  private readonly maxEntries: number;
  private readonly snapshotPath: string | undefined;
  private dirty = false;
  private seq = 0;

  constructor(options: PromptSectionCacheOptions = {}) {
    this.maxEntries = options.maxEntries ?? 200;
    this.snapshotPath = options.snapshotPath;
    this.cache = new Map();
    if (this.snapshotPath) {
      this.loadSnapshot();
    }
  }

  get(sectionId: string, inputHash: string): string | undefined {
    const key = `${sectionId}:${inputHash}`;
    const entry = this.cache.get(key);
    if (entry !== undefined) {
      entry.lastAccess = this.seq++;
      return entry.content;
    }
    return undefined;
  }

  set(sectionId: string, inputHash: string, content: string): void {
    const key = `${sectionId}:${inputHash}`;
    const existing = this.cache.get(key);
    if (existing !== undefined) {
      existing.content = content;
      existing.lastAccess = this.seq++;
      this.dirty = true;
      return;
    }

    if (this.cache.size >= this.maxEntries) {
      this.evictLRU();
    }

    this.cache.set(key, { content, lastAccess: this.seq++ });
    this.dirty = true;
  }

  hashInput(input: unknown): string {
    const normalized = JSON.stringify(input, stableStringifyReplacer);
    return crypto.createHash("sha256").update(normalized).digest("hex").slice(0, 16);
  }

  saveSnapshot(): void {
    if (!this.snapshotPath || !this.dirty) return;

    try {
      const dir = path.dirname(this.snapshotPath);
      fs.mkdirSync(dir, { recursive: true });

      const data: SnapshotData = Array.from(this.cache.entries());
      fs.writeFileSync(this.snapshotPath, JSON.stringify(data), "utf-8");
      this.dirty = false;
    } catch {
      // Silently ignore snapshot save failures
    }
  }

  private loadSnapshot(): void {
    if (!this.snapshotPath) return;

    try {
      const raw = fs.readFileSync(this.snapshotPath, "utf-8");
      const data: SnapshotData = JSON.parse(raw);
      if (!Array.isArray(data)) return;

      for (const [key, entry] of data) {
        if (
          typeof key === "string" &&
          entry &&
          typeof entry.content === "string" &&
          typeof entry.lastAccess === "number"
        ) {
          this.cache.set(key, { content: entry.content, lastAccess: entry.lastAccess });
        }
      }

      // Initialize sequence counter beyond loaded timestamps
      let maxLastAccess = 0;
      for (const [, entry] of this.cache) {
        if (entry.lastAccess > maxLastAccess) maxLastAccess = entry.lastAccess;
      }
      this.seq = maxLastAccess + 1;

      // Evict excess entries after loading
      while (this.cache.size > this.maxEntries) {
        this.evictLRU();
      }
    } catch {
      // Corrupted or missing snapshot — start with empty cache
    }
  }

  private evictLRU(): void {
    let oldestKey: string | undefined;
    let oldestTime = Infinity;

    for (const [key, entry] of this.cache) {
      if (entry.lastAccess < oldestTime) {
        oldestTime = entry.lastAccess;
        oldestKey = key;
      }
    }

    if (oldestKey !== undefined) {
      this.cache.delete(oldestKey);
    }
  }

  /** Visible for testing */
  _size(): number {
    return this.cache.size;
  }

  /** Visible for testing */
  _entries(): Array<[string, CacheEntry]> {
    return Array.from(this.cache.entries());
  }
}

function stableStringifyReplacer(_key: string, value: unknown): unknown {
  if (value === undefined) return null;
  if (Array.isArray(value)) return value;
  if (value !== null && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[k] = (value as Record<string, unknown>)[k];
    }
    return sorted;
  }
  return value;
}
