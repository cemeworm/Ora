import fs from "node:fs";
import path from "node:path";
import {
  LongTermMemoryFact,
  LongTermMemoryFactCategory,
  LongTermMemoryProfile,
  LongTermMemoryProfileSchema,
  MemoryRecord,
  MemoryRecordSchema,
  ModeMemoryPolicy,
  StateSnapshot,
} from "@ora/shared";

const MEMORY_VERSION = "1.0";
const MAX_FACTS = 120;
const MAX_INJECTION_FACTS = 24;

export interface MemoryConversationMessage {
  role: "system" | "developer" | "user" | "assistant";
  content: string;
}

export interface MemoryModelInvoker {
  (request: {
    prompt: string;
    messages: MemoryConversationMessage[];
    system: string;
    maxTokens?: number;
  }): Promise<string>;
}

export interface LongTermMemoryUpdateTask {
  snapshot: StateSnapshot;
  assistantText: string;
  conversationMessages: MemoryConversationMessage[];
  policy: ModeMemoryPolicy;
  invokeModel?: MemoryModelInvoker;
}

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
  readonly dataDir: string;
  private readonly memoryPath: string;
  private cached: LongTermMemoryProfile | undefined;
  private cachedMtime: number | undefined;

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

export class LongTermMemoryUpdateQueue {
  private readonly queue = new Map<string, LongTermMemoryUpdateTask>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private processing: Promise<void> | undefined;

  constructor(
    private readonly processor: (task: LongTermMemoryUpdateTask) => Promise<void>,
  ) {}

  enqueue(task: LongTermMemoryUpdateTask, debounceMs: number): void {
    this.queue.set(task.snapshot.runId, task);
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.flush();
    }, Math.max(0, debounceMs));
  }

  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    if (this.processing) {
      await this.processing;
      return;
    }

    const tasks = [...this.queue.values()];
    this.queue.clear();
    if (tasks.length === 0) {
      return;
    }

    this.processing = (async () => {
      for (const task of tasks) {
        await this.processor(task);
      }
    })();
    try {
      await this.processing;
    } finally {
      this.processing = undefined;
    }
  }

  get pendingCount(): number {
    return this.queue.size;
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

  getProject(projectId: string): LongTermMemoryProfile {
    return this.storeFor(projectId).load();
  }

  clear(): LongTermMemoryProfile {
    return this.store.clear();
  }

  private storeFor(projectId?: string): FileLongTermMemoryStore {
    if (!projectId) {
      return this.store;
    }
    return new FileLongTermMemoryStore(this.store.dataDir, projectId);
  }

  forProject(projectId: string): LongTermMemoryManager {
    return new LongTermMemoryManager(this.storeFor(projectId), this.clock);
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

  updateFromRun(
    snapshot: StateSnapshot,
    assistantText = "",
    policy: Partial<ModeMemoryPolicy> = {},
  ): { memory: LongTermMemoryProfile; factsAdded: LongTermMemoryFact[] } {
    if (snapshot.config.metadata.disableMemoryUpdate === true || snapshot.input.context?.disableMemoryUpdate === true) {
      return { memory: this.get(), factsAdded: [] };
    }

    const effectivePolicy = { factConfidenceThreshold: 0.7, maxFacts: MAX_FACTS, ...policy };
    const candidates = memoryCandidatesFromRun(snapshot, assistantText, this.nowIso())
      .filter((fact) => fact.confidence >= effectivePolicy.factConfidenceThreshold);
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
      .slice(0, effectivePolicy.maxFacts);
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

  async updateFromRunWithProvider(task: LongTermMemoryUpdateTask): Promise<{ memory: LongTermMemoryProfile; factsAdded: LongTermMemoryFact[] }> {
    if (!task.policy.enabled || task.snapshot.config.metadata.disableMemoryUpdate === true || task.snapshot.input.context?.disableMemoryUpdate === true) {
      return { memory: this.get(), factsAdded: [] };
    }
    if (task.policy.updater !== "provider" || !task.invokeModel) {
      return this.updateFromRun(task.snapshot, task.assistantText, task.policy);
    }

    const current = this.get();
    const conversation = formatConversationForMemory(task.conversationMessages);
    if (!conversation.trim()) {
      return { memory: current, factsAdded: [] };
    }

    try {
      const prompt = buildMemoryUpdatePrompt(current, conversation);
      const responseText = await task.invokeModel({
        prompt,
        messages: [{ role: "user", content: prompt }],
        system: "You are Ora's memory updater. Return only valid JSON.",
        maxTokens: 1800,
      });
      const patch = parseMemoryPatch(responseText);
      return this.applyProviderPatch(current, patch, task.snapshot.runId, task.policy);
    } catch {
      return this.updateFromRun(task.snapshot, task.assistantText, task.policy);
    }
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

  private applyProviderPatch(
    current: LongTermMemoryProfile,
    patch: MemoryPatch,
    source: string,
    policy: ModeMemoryPolicy,
  ): { memory: LongTermMemoryProfile; factsAdded: LongTermMemoryFact[] } {
    const now = this.nowIso();
    const next = LongTermMemoryProfileSchema.parse({
      ...current,
      lastUpdated: now,
    });

    for (const section of ["workContext", "personalContext", "topOfMind"] as const) {
      const update = patch.user?.[section];
      if (update?.shouldUpdate && typeof update.summary === "string" && update.summary.trim()) {
        next.user[section] = { summary: update.summary.trim(), updatedAt: now };
      }
    }
    for (const section of ["recentMonths", "earlierContext", "longTermBackground"] as const) {
      const update = patch.history?.[section];
      if (update?.shouldUpdate && typeof update.summary === "string" && update.summary.trim()) {
        next.history[section] = { summary: update.summary.trim(), updatedAt: now };
      }
    }

    const removeIds = new Set((patch.factsToRemove ?? []).filter((id): id is string => typeof id === "string" && id.length > 0));
    const existingFacts = next.facts.filter((fact) => !removeIds.has(fact.id));
    const existingKeys = new Set(existingFacts.map((fact) => fact.content.trim().toLowerCase()));
    const factsAdded: LongTermMemoryFact[] = [];
    for (const fact of patch.newFacts ?? []) {
      if (!fact || typeof fact.content !== "string") {
        continue;
      }
      const confidence = coerceConfidence(fact.confidence);
      const content = fact.content.trim();
      const key = content.toLowerCase();
      if (!content || confidence < policy.factConfidenceThreshold || existingKeys.has(key) || TEMPORARY_RE.test(content)) {
        continue;
      }
      const category = normalizeCategory(fact.category);
      const nextFact = createFact({
        content,
        category,
        confidence,
        source,
        now,
        sourceError: category === "correction" && typeof fact.sourceError === "string" ? fact.sourceError : undefined,
      });
      factsAdded.push(nextFact);
      existingKeys.add(key);
    }

    const memory = LongTermMemoryProfileSchema.parse({
      ...next,
      facts: [...existingFacts, ...factsAdded]
        .sort((left, right) => right.confidence - left.confidence || right.createdAt.localeCompare(left.createdAt))
        .slice(0, policy.maxFacts),
    });
    return { memory: this.store.save(memory), factsAdded };
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

interface MemoryPatchSection {
  summary?: unknown;
  shouldUpdate?: unknown;
}

interface MemoryPatchFact {
  content?: unknown;
  category?: unknown;
  confidence?: unknown;
  sourceError?: unknown;
}

interface MemoryPatch {
  user?: {
    workContext?: MemoryPatchSection;
    personalContext?: MemoryPatchSection;
    topOfMind?: MemoryPatchSection;
  };
  history?: {
    recentMonths?: MemoryPatchSection;
    earlierContext?: MemoryPatchSection;
    longTermBackground?: MemoryPatchSection;
  };
  newFacts?: MemoryPatchFact[];
  factsToRemove?: unknown[];
}

function buildMemoryUpdatePrompt(current: LongTermMemoryProfile, conversation: string): string {
  return [
    "Analyze this conversation and update Ora's long-term memory profile.",
    "",
    "Current memory:",
    "<current_memory>",
    JSON.stringify(current, null, 2),
    "</current_memory>",
    "",
    "Conversation:",
    "<conversation>",
    conversation,
    "</conversation>",
    "",
    "Return only JSON with this shape:",
    "{\"user\":{\"workContext\":{\"summary\":\"\",\"shouldUpdate\":false},\"personalContext\":{\"summary\":\"\",\"shouldUpdate\":false},\"topOfMind\":{\"summary\":\"\",\"shouldUpdate\":false}},\"history\":{\"recentMonths\":{\"summary\":\"\",\"shouldUpdate\":false},\"earlierContext\":{\"summary\":\"\",\"shouldUpdate\":false},\"longTermBackground\":{\"summary\":\"\",\"shouldUpdate\":false}},\"newFacts\":[{\"content\":\"\",\"category\":\"preference|knowledge|context|behavior|goal|correction\",\"confidence\":0.0,\"sourceError\":\"optional\"}],\"factsToRemove\":[\"fact_id\"]}",
    "",
    "Rules:",
    "- Record durable preferences, goals, project constraints, corrections, and reinforced working patterns.",
    "- Do not record transient file uploads, temporary paths, or one-off session events.",
    "- Use correction with confidence >= 0.95 when the user corrects the assistant.",
    "- Remove contradicted facts by id.",
  ].join("\n");
}

function formatConversationForMemory(messages: MemoryConversationMessage[]): string {
  return messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => `${message.role === "user" ? "User" : "Assistant"}: ${message.content.slice(0, 1500)}`)
    .join("\n\n");
}

function parseMemoryPatch(text: string): MemoryPatch {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const parsed = JSON.parse(trimmed) as MemoryPatch;
  return {
    user: parsed.user,
    history: parsed.history,
    newFacts: Array.isArray(parsed.newFacts) ? parsed.newFacts : [],
    factsToRemove: Array.isArray(parsed.factsToRemove) ? parsed.factsToRemove : [],
  };
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
    updatedAt: params.now,
    source: params.source,
    sourceRunId: params.source,
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

function normalizeCategory(value: unknown): LongTermMemoryFactCategory {
  if (
    value === "preference" ||
    value === "knowledge" ||
    value === "context" ||
    value === "behavior" ||
    value === "goal" ||
    value === "correction"
  ) {
    return value;
  }
  return "context";
}

function coerceConfidence(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return 0.5;
  }
  return Math.max(0, Math.min(1, numeric));
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
