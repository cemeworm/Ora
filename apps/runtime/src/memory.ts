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
} from "@cemeworm/shared";

const MEMORY_VERSION = "1.0";
// D14: Fallback defaults — ModeMemoryPolicy.maxFacts / injectionMaxFacts take precedence
const DEFAULT_MAX_FACTS = 120;
const DEFAULT_MAX_INJECTION_FACTS = 24;

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
const TEMPORARY_RE = /<uploaded_files>|file upload|上传文件|上传了|附件|临时|这次会话|这次聊天|当前对话|本次会话|本会话|这一次|刚才|刚刚|你发的|发来的|打开那个|看那个|这个文件|那个文件|这段代码|这个会话|本次聊天/im;
// D12: penalty applied when temporary keywords detected — downgrades instead of hard filtering
const TEMPORARY_CONFIDENCE_PENALTY = 0.35;

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
  private lastSavedLastUpdated: string | undefined;

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
      this.lastSavedLastUpdated = undefined;
      return empty;
    }

    try {
      const parsed = LongTermMemoryProfileSchema.parse(JSON.parse(fs.readFileSync(this.memoryPath, "utf8")));
      this.cached = parsed;
      this.cachedMtime = mtime;
      this.lastSavedLastUpdated = parsed.lastUpdated;
      return parsed;
    } catch (primaryError) {
      console.error(`[memory] Failed to parse ${this.memoryPath}:`, primaryError instanceof Error ? primaryError.message : primaryError);
      // Try reading from backup file before falling back to empty
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

    // D11: CAS — check if file was modified externally since our last read
    if (this.lastSavedLastUpdated && fs.existsSync(this.memoryPath)) {
      try {
        const onDisk = LongTermMemoryProfileSchema.parse(JSON.parse(fs.readFileSync(this.memoryPath, "utf8")));
        if (onDisk.lastUpdated !== this.lastSavedLastUpdated) {
          // File was modified externally — merge facts from on-disk version
          const merged = mergeExternalFacts(parsed, onDisk);
          parsed.facts = merged;
        }
      } catch {
        // If we can't read on-disk, proceed with our version (best effort)
      }
    }

    // Backup existing file before overwriting
    const backupPath = this.backupPath();
    if (fs.existsSync(this.memoryPath)) {
      try {
        fs.copyFileSync(this.memoryPath, backupPath);
      } catch {
        // Backup failure is non-fatal — best effort
      }
    }
    const tempPath = `${this.memoryPath}.${Math.random().toString(16).slice(2)}.tmp`;
    fs.writeFileSync(tempPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
    fs.renameSync(tempPath, this.memoryPath);
    this.lastSavedLastUpdated = parsed.lastUpdated;
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

  saveProfile(profile: LongTermMemoryProfile): LongTermMemoryProfile {
    return this.store.save(profile);
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

  formatForInjection(maxFacts = DEFAULT_MAX_INJECTION_FACTS): string {
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
    conversationMessages?: MemoryConversationMessage[],
  ): { memory: LongTermMemoryProfile; factsAdded: LongTermMemoryFact[] } {
    if (snapshot.config.metadata.disableMemoryUpdate === true || snapshot.input.context?.disableMemoryUpdate === true) {
      return { memory: this.get(), factsAdded: [] };
    }

    const effectivePolicy = { factConfidenceThreshold: 0.7, maxFacts: DEFAULT_MAX_FACTS, ...policy };
    const candidates = memoryCandidatesFromRun(snapshot, assistantText, this.nowIso(), conversationMessages)
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
      // D1: n-gram Jaccard similarity dedup against existing facts
      const candidateNgrams = ngramSet(key, 2);
      let isDuplicate = false;
      for (const fact of current.facts) {
        const existingNgrams = ngramSet(fact.content.trim().toLowerCase(), 2);
        if (jaccardSimilarity(candidateNgrams, existingNgrams) > 0.7) {
          isDuplicate = true;
          break;
        }
      }
      if (isDuplicate) {
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
      .sort((left, right) => {
        const leftScore = evictionScore(left, now);
        const rightScore = evictionScore(right, now);
        if (rightScore !== leftScore) return rightScore - leftScore;
        return right.createdAt.localeCompare(left.createdAt);
      })
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
      return this.updateFromRun(task.snapshot, task.assistantText, task.policy, task.conversationMessages);
    }

    const current = this.get();
    const conversation = formatConversationForMemory(task.conversationMessages);
    if (!conversation.trim()) {
      return { memory: current, factsAdded: [] };
    }

    const MAX_RETRIES = 2;
    let lastError: unknown;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
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
      } catch (error) {
        lastError = error;
        const isRetryable = isRetryableProviderError(error);
        if (!isRetryable || attempt === MAX_RETRIES) {
          console.error(
            `[memory] Provider update failed (${isRetryable ? "retryable, exhausted retries" : "non-retryable"}):`,
            error instanceof Error ? error.message : error,
          );
          break;
        }
        // Exponential backoff: 500ms, 1000ms
        await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
      }
    }
    return this.updateFromRun(task.snapshot, task.assistantText, task.policy);
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
        const newSummary = update.summary.trim();
        const oldSummary = current.user[section].summary;
        if (!passesSectionQualityGate(newSummary, oldSummary, section)) {
          continue;
        }
        console.info(`[memory] Section user.${section} updated (${oldSummary.length} → ${newSummary.length} chars)`);
        next.user[section] = { summary: newSummary, updatedAt: now, previousSummary: oldSummary || undefined };
      }
    }
    for (const section of ["recentMonths", "earlierContext", "longTermBackground"] as const) {
      const update = patch.history?.[section];
      if (update?.shouldUpdate && typeof update.summary === "string" && update.summary.trim()) {
        const newSummary = update.summary.trim();
        const oldSummary = current.history[section].summary;
        if (!passesSectionQualityGate(newSummary, oldSummary, section)) {
          continue;
        }
        console.info(`[memory] Section history.${section} updated (${oldSummary.length} → ${newSummary.length} chars)`);
        next.history[section] = { summary: newSummary, updatedAt: now, previousSummary: oldSummary || undefined };
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
      if (!content || confidence < policy.factConfidenceThreshold || existingKeys.has(key)) {
        continue;
      }
      // D12: lower confidence for temporary-sounding content instead of hard filtering
      const effectiveConfidence = TEMPORARY_RE.test(content)
        ? Math.max(0, confidence - TEMPORARY_CONFIDENCE_PENALTY)
        : confidence;
      if (effectiveConfidence < policy.factConfidenceThreshold) {
        continue;
      }
      // D1: n-gram Jaccard similarity dedup against existing facts
      const candidateNgrams = ngramSet(key, 2);
      let isDuplicate = false;
      for (const existingFact of existingFacts) {
        const existingNgrams = ngramSet(existingFact.content.trim().toLowerCase(), 2);
        if (jaccardSimilarity(candidateNgrams, existingNgrams) > 0.7) {
          isDuplicate = true;
          break;
        }
      }
      if (isDuplicate) {
        continue;
      }
      const category = normalizeCategory(fact.category);
      const nextFact = createFact({
        content,
        category,
        confidence: effectiveConfidence,
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
        .sort((left, right) => {
          const leftScore = evictionScore(left, now);
          const rightScore = evictionScore(right, now);
          if (rightScore !== leftScore) return rightScore - leftScore;
          return right.createdAt.localeCompare(left.createdAt);
        })
        .slice(0, policy.maxFacts),
    });
    return { memory: this.store.save(memory), factsAdded };
  }
}

function isRetryableProviderError(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    // Timeout and network errors are retryable
    if (msg.includes("timeout") || msg.includes("timed out") || msg.includes("econnreset") || msg.includes("econnrefused") || msg.includes("enotfound") || msg.includes("fetch failed") || msg.includes("network")) {
      return true;
    }
  }
  // JSON parse errors, schema validation errors, etc. are not retryable
  return false;
}

// D9: Section summary quality gate — rejects low-quality LLM patch updates
const MIN_SECTION_SUMMARY_LENGTH = 10;

function passesSectionQualityGate(newSummary: string, oldSummary: string, sectionName: string): boolean {
  // Reject too-short summaries (likely LLM truncation or hallucination)
  if (newSummary.length < MIN_SECTION_SUMMARY_LENGTH) {
    console.warn(`[memory] Section ${sectionName} update rejected: too short (${newSummary.length} chars < ${MIN_SECTION_SUMMARY_LENGTH})`);
    return false;
  }
  // Reject if new summary is identical or a subset of existing
  if (oldSummary && (newSummary === oldSummary || oldSummary.includes(newSummary))) {
    return false;
  }
  return true;
}

function memoryCandidatesFromRun(snapshot: StateSnapshot, assistantText: string, now: string, conversationMessages?: MemoryConversationMessage[]): LongTermMemoryFact[] {
  const prompt = snapshot.input.prompt.trim();
  if (!prompt) {
    return [];
  }
  const candidates: LongTermMemoryFact[] = [];
  const seenContent = new Set<string>();

  const addCandidate = (sentence: string, category: LongTermMemoryFactCategory, isCorrection: boolean) => {
    const content = normalizeFactContent(sentence);
    const key = content.trim().toLowerCase();
    if (seenContent.has(key)) return;
    seenContent.add(key);
    // D12: lower confidence for temporary-sounding content instead of hard filtering
    const baseConfidence = isCorrection ? 0.95 : 0.85;
    const confidence = TEMPORARY_RE.test(content)
      ? Math.max(0, baseConfidence - TEMPORARY_CONFIDENCE_PENALTY)
      : baseConfidence;
    candidates.push(createFact({
      content,
      category,
      confidence,
      source: snapshot.runId,
      now,
      sourceError: isCorrection ? errorFromAssistant(assistantText) : undefined,
    }));
  };

  // Extract from primary prompt
  const sentences = splitSentences(prompt).filter((sentence) => sentence.length >= 8);
  for (const sentence of sentences) {
    const category = categoryForText(sentence);
    if (!category) continue;
    addCandidate(sentence, category, category === "correction");
  }

  // D7: Extract from subsequent user messages in conversation
  if (conversationMessages) {
    const userMessages = conversationMessages.filter((m) => m.role === "user");
    // Skip the first message if it matches the prompt (avoid double extraction)
    const subsequentMessages = userMessages.length > 1 ? userMessages.slice(1) : [];
    for (const message of subsequentMessages) {
      const text = message.content.trim();
      if (!text) continue;
      const msgSentences = splitSentences(text).filter((s) => s.length >= 8);
      for (const sentence of msgSentences) {
        // Only extract corrections and reinforced preferences from subsequent messages
        if (CORRECTION_RE.test(sentence)) {
          addCandidate(sentence, "correction", true);
        } else if (MEMORY_INTENT_RE.test(sentence) && REINFORCEMENT_RE.test(sentence)) {
          addCandidate(sentence, "behavior", false);
        } else if (MEMORY_INTENT_RE.test(sentence) && /偏好|希望|默认|prefer|always|never|不要|下次|以后/gim.test(sentence)) {
          addCandidate(sentence, "preference", false);
        }
      }
    }
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

// D1: n-gram set for Jaccard similarity dedup
function ngramSet(text: string, n: number): Set<string> {
  if (text.length < n) return new Set([text]);
  const ngrams = new Set<string>();
  for (let i = 0; i <= text.length - n; i++) {
    ngrams.add(text.slice(i, i + n));
  }
  return ngrams;
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const item of a) {
    if (b.has(item)) intersection += 1;
  }
  const union = a.size + b.size - intersection;
  return union > 0 ? intersection / union : 0;
}

// D2: composite eviction score = confidence × recencyDecay
function evictionScore(fact: LongTermMemoryFact, nowIso: string): number {
  const updated = fact.updatedAt ?? fact.createdAt;
  const recencyDecay = computeRecencyDecay(updated, nowIso);
  return fact.confidence * recencyDecay;
}

function computeRecencyDecay(isoDate: string, nowIso: string): number {
  const then = Date.parse(isoDate);
  const now = Date.parse(nowIso);
  if (!Number.isFinite(then) || !Number.isFinite(now)) return 0.5;
  const ageDays = Math.max(0, (now - then) / 86_400_000);
  // Exponential decay: half-life of ~90 days
  return Math.exp(-0.0077 * ageDays);
}

// D11: merge facts from external write that happened between our read and save
function mergeExternalFacts(ours: LongTermMemoryProfile, theirs: LongTermMemoryProfile): LongTermMemoryFact[] {
  const ourIds = new Set(ours.facts.map((f) => f.id));
  // Keep all our facts, plus any facts from external write that we don't have
  const merged = [...ours.facts];
  for (const fact of theirs.facts) {
    if (!ourIds.has(fact.id)) {
      merged.push(fact);
    }
  }
  return merged;
}
