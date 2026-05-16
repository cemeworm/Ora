import fs from "node:fs";
import path from "node:path";
import {
  LongTermMemoryFact,
  LongTermMemoryProfile,
  LongTermMemoryProfileSchema,
} from "@cemeworm/shared";

const MEMORY_VERSION = "1.0";

export function createEmptyLongTermMemory(nowIso = new Date().toISOString()): LongTermMemoryProfile {
  return LongTermMemoryProfileSchema.parse({
    version: MEMORY_VERSION,
    _version: 1,
    lastUpdated: nowIso,
    user: {
      workContext: { summary: "", updatedAt: "" },
      personalContext: { summary: "", updatedAt: "" },
      topOfMind: { summary: "", updatedAt: "" },
    },
    history: {
      recentMonths: { summary: "", updatedAt: "" },
      earlierContext: { summary: "", updatedAt: "" },
      longTermBackground: { summary: "", updatedAt: "" },
    },
    facts: [],
  });
}

export class FileLongTermMemoryStore {
  readonly dataDir: string;
  private readonly memoryPath: string;
  private cached: LongTermMemoryProfile | undefined;
  private cachedMtime: number | undefined;
  private lastSavedVersion: number | undefined;

  constructor(dataDir: string, projectId?: string) {
    this.dataDir = dataDir;
    this.memoryPath = projectId
      ? path.join(dataDir, "projects", projectId, "memory.json")
      : path.join(dataDir, "memory.json");
  }

  load(): LongTermMemoryProfile {
    const mtime = this.fileMtime();
    if (this.cached && this.cachedMtime === mtime) {
      return this.cached;
    }
    if (!fs.existsSync(this.memoryPath)) {
      const empty = createEmptyLongTermMemory();
      this.cached = empty;
      this.cachedMtime = undefined;
      this.lastSavedVersion = undefined;
      return empty;
    }

    try {
      const parsed = LongTermMemoryProfileSchema.parse(JSON.parse(fs.readFileSync(this.memoryPath, "utf8")));
      this.cached = parsed;
      this.cachedMtime = mtime;
      this.lastSavedVersion = parsed._version;
      return parsed;
    } catch (primaryError) {
      console.error(`[memory] Failed to parse ${this.memoryPath}:`, primaryError instanceof Error ? primaryError.message : primaryError);
      const backupPath = this.backupPath();
      if (fs.existsSync(backupPath)) {
        try {
          const backupParsed = LongTermMemoryProfileSchema.parse(JSON.parse(fs.readFileSync(backupPath, "utf8")));
          console.error(`[memory] Recovered from backup ${backupPath}`);
          this.cached = backupParsed;
          this.cachedMtime = mtime;
          return backupParsed;
        } catch (backupError) {
          console.error(`[memory] Backup ${backupPath} also corrupted:`, backupError instanceof Error ? backupError.message : backupError);
        }
      }
      const empty = createEmptyLongTermMemory();
      this.cached = empty;
      this.cachedMtime = mtime;
      return empty;
    }
  }

  save(memory: LongTermMemoryProfile): LongTermMemoryProfile {
    const parsed = LongTermMemoryProfileSchema.parse(memory);
    fs.mkdirSync(path.dirname(this.memoryPath), { recursive: true });

    if (this.lastSavedVersion !== undefined && fs.existsSync(this.memoryPath)) {
      try {
        const onDisk = LongTermMemoryProfileSchema.parse(JSON.parse(fs.readFileSync(this.memoryPath, "utf8")));
        if (onDisk._version !== this.lastSavedVersion) {
          const merged = mergeExternalFacts(parsed, onDisk);
          parsed.facts = merged;
        }
      } catch {
        // If we can't read on-disk, proceed with our version (best effort)
      }
    }

    const backupPath = this.backupPath();
    if (fs.existsSync(this.memoryPath)) {
      try {
        fs.copyFileSync(this.memoryPath, backupPath);
      } catch {
        // Backup failure is non-fatal — best effort
      }
    }

    parsed._version = (parsed._version || 1) + 1;

    const tempPath = `${this.memoryPath}.${Math.random().toString(16).slice(2)}.tmp`;
    fs.writeFileSync(tempPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
    fs.renameSync(tempPath, this.memoryPath);
    this.lastSavedVersion = parsed._version;
    this.cached = parsed;
    this.cachedMtime = this.fileMtime();
    return parsed;
  }

  clear(): LongTermMemoryProfile {
    return this.save(createEmptyLongTermMemory());
  }

  private fileMtime(): number | undefined {
    try {
      return fs.statSync(this.memoryPath).mtimeMs;
    } catch {
      return undefined;
    }
  }

  private backupPath(): string {
    return `${this.memoryPath}.bak`;
  }
}

function mergeExternalFacts(ours: LongTermMemoryProfile, theirs: LongTermMemoryProfile): LongTermMemoryFact[] {
  const ourIds = new Set(ours.facts.map((f) => f.id));
  const merged = [...ours.facts];
  for (const fact of theirs.facts) {
    if (!ourIds.has(fact.id)) {
      merged.push(fact);
    }
  }
  return merged;
}
