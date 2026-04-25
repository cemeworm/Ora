import fs from "node:fs";
import path from "node:path";
import {
  LongTermMemoryFact,
  LongTermMemoryFactCategory,
  LongTermMemoryProfile,
  LongTermMemoryProfileSchema,
  MemoryRecord,
  MemoryRecordSchema,
  StateSnapshot,
} from "@ora/shared";

const MEMORY_VERSION = "1.0";
const MAX_FACTS = 120;
const MAX_INJECTION_FACTS = 24;

const CORRECTION_RE = /\b(wrong|incorrect|misunderstood|redo|try again|instead)\b|不对|理解错|理解有误|不是这样|重试|重新来|改用|不要/im;
const REINFORCEMENT_RE = /\b(exactly|perfect|that'?s right|keep doing that|just like this)\b|完全正确|就是这样|正是我想要的|继续保持/im;
const MEMORY_INTENT_RE = /\b(remember|prefer|always|never|next time|from now on)\b|记住|记下来|以后|下次|默认|偏好|我希望|我需要|不要/im;
const TEMPORARY_RE = /<uploaded_files>|file upload|上传文件|临时|这次会话/im;

export function createEmptyLongTermMemory(nowIso = new Date().toISOString()): LongTermMemoryProfile {
  return LongTermMemoryProfileSchema.parse({
    version: MEMORY_VERSION,
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
  private readonly memoryPath: string;
  private cached: LongTermMemoryProfile | undefined;
  private cachedMtime: number | undefined;

  constructor(dataDir: string) {
    this.memoryPath = path.join(dataDir, "memory.json");
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
      return empty;
    }

    try {
      const parsed = LongTermMemoryProfileSchema.parse(JSON.parse(fs.readFileSync(this.memoryPath, "utf8")));
      this.cached = parsed;
      this.cachedMtime = mtime;
      return parsed;
    } catch {
      const empty = createEmptyLongTermMemory();
      this.cached = empty;
      this.cachedMtime = mtime;
      return empty;
    }
  }

  save(memory: LongTermMemoryProfile): LongTermMemoryProfile {
    const parsed = LongTermMemoryProfileSchema.parse(memory);
    fs.mkdirSync(path.dirname(this.memoryPath), { recursive: true });
    const tempPath = `${this.memoryPath}.${Math.random().toString(16).slice(2)}.tmp`;
    fs.writeFileSync(tempPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
    fs.renameSync(tempPath, this.memoryPath);
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
}

export class LongTermMemoryManager {
  constructor(
    private readonly store: FileLongTermMemoryStore,
    private readonly clock: () => number = Date.now,
  ) {}

  get(): LongTermMemoryProfile {
    return this.store.load();
  }

  clear(): LongTermMemoryProfile {
    return this.store.clear();
  }

  formatForInjection(maxFacts = MAX_INJECTION_FACTS): string {
    const memory = this.get();
    const sections: string[] = [];
    const user = memory.user;
    const history = memory.history;

    const userLines = [
      user.workContext.summary ? `Work: ${user.workContext.summary}` : undefined,
      user.personalContext.summary ? `Personal: ${user.personalContext.summary}` : undefined,
      user.topOfMind.summary ? `Current Focus: ${user.topOfMind.summary}` : undefined,
    ].filter((line): line is string => Boolean(line));
    if (userLines.length > 0) {
      sections.push(`Long-term User Context:\n${userLines.map((line) => `- ${line}`).join("\n")}`);
    }

    const historyLines = [
      history.recentMonths.summary ? `Recent: ${history.recentMonths.summary}` : undefined,
      history.earlierContext.summary ? `Earlier: ${history.earlierContext.summary}` : undefined,
      history.longTermBackground.summary ? `Background: ${history.longTermBackground.summary}` : undefined,
    ].filter((line): line is string => Boolean(line));
    if (historyLines.length > 0) {
      sections.push(`Long-term History:\n${historyLines.map((line) => `- ${line}`).join("\n")}`);
    }

    const factLines = [...memory.facts]
      .sort((left, right) => right.confidence - left.confidence || right.createdAt.localeCompare(left.createdAt))
      .slice(0, maxFacts)
      .map((fact) => {
        const avoid = fact.category === "correction" && fact.sourceError ? ` (avoid: ${fact.sourceError})` : "";
        return `- [${fact.category} | ${fact.confidence.toFixed(2)}] ${fact.content}${avoid}`;
      });
    if (factLines.length > 0) {
      sections.push(`Long-term Facts:\n${factLines.join("\n")}`);
    }

    return sections.join("\n\n");
  }

  updateFromRun(snapshot: StateSnapshot, assistantText = ""): { memory: LongTermMemoryProfile; factsAdded: LongTermMemoryFact[] } {
    if (snapshot.config.metadata.disableMemoryUpdate === true || snapshot.input.context?.disableMemoryUpdate === true) {
      return { memory: this.get(), factsAdded: [] };
    }

    const candidates = memoryCandidatesFromRun(snapshot, assistantText, this.nowIso());
    if (candidates.length === 0) {
      return { memory: this.get(), factsAdded: [] };
    }

    const current = this.get();
    const existing = new Set(current.facts.map((fact) => fact.content.trim().toLowerCase()));
    const sourceSeen = new Set(current.facts.filter((fact) => fact.source === snapshot.runId).map((fact) => fact.content.trim().toLowerCase()));
    const factsAdded: LongTermMemoryFact[] = [];
    for (const candidate of candidates) {
      const key = candidate.content.trim().toLowerCase();
      if (!key || existing.has(key) || sourceSeen.has(key)) {
        continue;
      }
      factsAdded.push(candidate);
      existing.add(key);
    }

    if (factsAdded.length === 0) {
      return { memory: current, factsAdded };
    }

    const now = this.nowIso();
    const facts = [...current.facts, ...factsAdded]
      .sort((left, right) => right.confidence - left.confidence || right.createdAt.localeCompare(left.createdAt))
      .slice(0, MAX_FACTS);
    const memory = LongTermMemoryProfileSchema.parse({
      ...current,
      lastUpdated: now,
      user: {
        ...current.user,
        topOfMind: {
          summary: summarizeTopOfMind(facts),
          updatedAt: now,
        },
      },
      history: {
        ...current.history,
        recentMonths: {
          summary: summarizeRecentMemory(facts),
          updatedAt: now,
        },
      },
      facts,
    });
    return { memory: this.store.save(memory), factsAdded };
  }

  createRunMemoryRecords(snapshot: StateSnapshot, facts: LongTermMemoryFact[]): MemoryRecord[] {
    if (facts.length === 0) {
      return [];
    }
    const now = this.clock();
    return facts.map((fact) => MemoryRecordSchema.parse({
      id: `${snapshot.runId}:memory:long-term:${fact.id}`,
      namespace: ["profile", "long-term", fact.category],
      kind: "profile",
      value: {
        factId: fact.id,
        category: fact.category,
        confidence: fact.confidence,
        content: fact.content,
      },
      sourceRunId: snapshot.runId,
      createdAt: now,
      updatedAt: now,
    }));
  }

  private nowIso(): string {
    return new Date(this.clock()).toISOString();
  }
}

function memoryCandidatesFromRun(snapshot: StateSnapshot, assistantText: string, now: string): LongTermMemoryFact[] {
  const prompt = snapshot.input.prompt.trim();
  if (!prompt || TEMPORARY_RE.test(prompt)) {
    return [];
  }
  const candidates: LongTermMemoryFact[] = [];
  const sentences = splitSentences(prompt).filter((sentence) => sentence.length >= 8);
  for (const sentence of sentences) {
    const category = categoryForText(sentence);
    if (!category) {
      continue;
    }
    candidates.push(createFact({
      content: normalizeFactContent(sentence),
      category,
      confidence: category === "correction" ? 0.95 : 0.85,
      source: snapshot.runId,
      now,
      sourceError: category === "correction" ? errorFromAssistant(assistantText) : undefined,
    }));
  }
  return candidates;
}

function createFact(params: {
  content: string;
  category: LongTermMemoryFactCategory;
  confidence: number;
  source: string;
  now: string;
  sourceError?: string;
}): LongTermMemoryFact {
  return {
    id: `fact_${hashId(`${params.source}:${params.category}:${params.content}`)}`,
    content: params.content.slice(0, 700),
    category: params.category,
    confidence: params.confidence,
    createdAt: params.now,
    source: params.source,
    ...(params.sourceError ? { sourceError: params.sourceError.slice(0, 240) } : {}),
  };
}

function splitSentences(text: string): string[] {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact
    .split(/(?<=[。！？!?；;])\s+|(?<=[。！？!?；;])/g)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 8);
}

function categoryForText(text: string): LongTermMemoryFactCategory | undefined {
  if (CORRECTION_RE.test(text)) {
    return "correction";
  }
  if (REINFORCEMENT_RE.test(text)) {
    return "behavior";
  }
  if (!MEMORY_INTENT_RE.test(text)) {
    return undefined;
  }
  if (/目标|计划|想要|需要|\bgoal\b|\bplan\b|\bneed\b/gim.test(text)) {
    return "goal";
  }
  if (/偏好|希望|默认|prefer|always|never|不要|下次|以后/gim.test(text)) {
    return "preference";
  }
  return "context";
}

function normalizeFactContent(text: string): string {
  return text.replace(/^请?(记住|记下来)[:：,，]?\s*/i, "").trim();
}

function errorFromAssistant(text: string): string | undefined {
  const trimmed = text.replace(/\s+/g, " ").trim();
  return trimmed ? trimmed.slice(0, 240) : undefined;
}

function summarizeTopOfMind(facts: LongTermMemoryFact[]): string {
  const important = facts
    .filter((fact) => fact.category === "goal" || fact.category === "preference" || fact.category === "correction")
    .slice(0, 5)
    .map((fact) => fact.content);
  return important.length > 0 ? important.join(" ") : "";
}

function summarizeRecentMemory(facts: LongTermMemoryFact[]): string {
  return facts.slice(0, 8).map((fact) => fact.content).join(" ");
}

function hashId(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
