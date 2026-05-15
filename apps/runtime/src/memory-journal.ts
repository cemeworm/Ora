import fs from "node:fs";
import path from "node:path";
import {
  ShortTermSignalSchema,
  type ShortTermSignal,
  type ShortTermSignalType,
} from "@cemeworm/shared";

const MAX_JOURNAL_ENTRIES = 500;
const REDACT_PATTERNS = [
  /<uploaded_files[^>]*>[\s\S]*?<\/uploaded_files>/gi,
  /(?:api[_-]?key|secret|token|password|credential)s?\s*[:=]\s*\S+/gi,
  /-----BEGIN (?:RSA|EC|DSA|OPENSSH) PRIVATE KEY-----[\s\S]*?-----END (?:RSA|EC|DSA|OPENSSH) PRIVATE KEY-----/g,
];

function hashId(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function redactContent(content: string): { redacted: string; wasRedacted: boolean } {
  let redacted = content;
  let wasRedacted = false;
  for (const pattern of REDACT_PATTERNS) {
    if (pattern.test(redacted)) {
      redacted = redacted.replace(pattern, "[REDACTED]");
      wasRedacted = true;
    }
  }
  return { redacted: redacted.slice(0, 700), wasRedacted };
}

export class ShortTermMemoryJournal {
  private readonly journalPath: string;
  // D13: in-memory cache to avoid O(n) file reads on every operation
  private cache: ShortTermSignal[] | undefined;
  private cacheIds: Set<string> | undefined;

  constructor(dataDir: string, projectId?: string) {
    const dir = projectId ? path.join(dataDir, "projects", projectId) : dataDir;
    this.journalPath = path.join(dir, "memory-journal.jsonl");
  }

  append(params: {
    runId: string;
    sessionId?: string;
    type: ShortTermSignalType;
    content: string;
    category?: string;
    confidence?: number;
    metadata?: Record<string, unknown>;
    sourcePointers?: string[];
  }): ShortTermSignal {
    const { redacted, wasRedacted } = redactContent(params.content);
    const now = new Date().toISOString();
    const eventKey = `${params.runId}:${params.type}:${hashId(redacted)}`;

    this.ensureCache();
    if (this.cacheIds!.has(eventKey)) {
      return this.cache!.find((s) => s.id === eventKey)!;
    }

    const signal = ShortTermSignalSchema.parse({
      id: eventKey,
      runId: params.runId,
      sessionId: params.sessionId,
      type: params.type,
      content: redacted,
      category: params.category,
      confidence: params.confidence ?? 0.5,
      timestamp: now,
      redacted: wasRedacted,
      sourcePointers: params.sourcePointers ?? [],
      metadata: params.metadata ?? {},
    });

    // Append single line directly — no full rewrite
    fs.mkdirSync(path.dirname(this.journalPath), { recursive: true });
    fs.appendFileSync(this.journalPath, `${JSON.stringify(signal)}\n`, "utf8");

    this.cache!.push(signal);
    this.cacheIds!.add(eventKey);

    // Compact only when exceeding limit
    if (this.cache!.length > MAX_JOURNAL_ENTRIES) {
      const trimmed = this.cache!.slice(-MAX_JOURNAL_ENTRIES);
      this.cache = trimmed;
      this.cacheIds = new Set(trimmed.map((s) => s.id));
      this.writeAll(trimmed);
    }

    return signal;
  }

  readRecent(maxEntries: number = 50): ShortTermSignal[] {
    this.ensureCache();
    return this.cache!.slice(-maxEntries);
  }

  readByRun(runId: string): ShortTermSignal[] {
    this.ensureCache();
    return this.cache!.filter((s) => s.runId === runId);
  }

  readBySession(sessionId: string): ShortTermSignal[] {
    this.ensureCache();
    return this.cache!.filter((s) => s.sessionId === sessionId);
  }

  readByType(type: ShortTermSignalType, maxEntries: number = 50): ShortTermSignal[] {
    this.ensureCache();
    return this.cache!.filter((s) => s.type === type).slice(-maxEntries);
  }

  count(): number {
    this.ensureCache();
    return this.cache!.length;
  }

  clear(): void {
    this.cache = [];
    this.cacheIds = new Set();
    this.writeAll([]);
  }

  private ensureCache(): void {
    if (this.cache !== undefined) return;
    const signals = this.readAllFromFile();
    this.cache = signals;
    this.cacheIds = new Set(signals.map((s) => s.id));
  }

  private readAllFromFile(): ShortTermSignal[] {
    try {
      if (!fs.existsSync(this.journalPath)) return [];
      const text = fs.readFileSync(this.journalPath, "utf8").trim();
      if (!text) return [];
      return text.split("\n")
        .map((line) => {
          try {
            return ShortTermSignalSchema.parse(JSON.parse(line));
          } catch {
            return undefined;
          }
        })
        .filter((s): s is ShortTermSignal => s !== undefined);
    } catch {
      return [];
    }
  }

  private writeAll(signals: ShortTermSignal[]): void {
    fs.mkdirSync(path.dirname(this.journalPath), { recursive: true });
    const tempPath = `${this.journalPath}.${Math.random().toString(16).slice(2)}.tmp`;
    const content = signals.map((s) => JSON.stringify(s)).join("\n") + (signals.length > 0 ? "\n" : "");
    fs.writeFileSync(tempPath, content, "utf8");
    fs.renameSync(tempPath, this.journalPath);
  }
}
