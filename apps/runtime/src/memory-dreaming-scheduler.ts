import type { LongTermMemoryManager } from "./memory.js";
import type { MemoryDreamingService } from "./memory-dreaming.js";
import type { ShortTermMemoryJournal } from "./memory-journal.js";
import type { PromotionPreview } from "./memory-dreaming.js";
import type { MemoryIndexStore, EmbeddingProvider } from "./memory-index.js";
import { factsFromPromotionPreview } from "./memory-dreaming.js";

const TICK_INTERVAL_MS = 60_000;
const SIGNAL_THRESHOLD = 50;
const MIN_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface MemoryDreamingSchedulerDeps {
  journal: ShortTermMemoryJournal;
  dreaming: MemoryDreamingService;
  memoryManager: LongTermMemoryManager;
  memoryIndexStore?: MemoryIndexStore;
  embeddingProvider?: EmbeddingProvider;
  clock?: () => number;
}

export class MemoryDreamingScheduler {
  private readonly deps: MemoryDreamingSchedulerDeps;
  private readonly clock: () => number;
  private timer: ReturnType<typeof setInterval> | undefined;
  private tickInFlight = false;
  private lastDreamAt: number | undefined;
  lastPreview: PromotionPreview | undefined;

  constructor(deps: MemoryDreamingSchedulerDeps) {
    this.deps = deps;
    this.clock = deps.clock ?? Date.now;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, TICK_INTERVAL_MS);
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = undefined;
  }

  private async tick(): Promise<void> {
    if (this.tickInFlight) return;
    this.tickInFlight = true;
    try {
      const now = this.clock();
      const signalCount = this.deps.journal.count();
      const timeSinceLast = this.lastDreamAt !== undefined ? now - this.lastDreamAt : Number.POSITIVE_INFINITY;

      if (signalCount < SIGNAL_THRESHOLD && timeSinceLast < MIN_INTERVAL_MS) {
        return;
      }

      const preview = this.deps.dreaming.deepPhase();
      this.lastPreview = preview;
      this.lastDreamAt = now;

      if (preview.recommendPromote.length === 0) {
        return;
      }

      // Convert promotion candidates to facts and inject through the manager
      const source = `dreaming:${new Date(now).toISOString()}`;
      const candidateFacts = factsFromPromotionPreview(preview, source);
      if (candidateFacts.length === 0) return;

      const current = this.deps.memoryManager.get();
      const existingIds = new Set(current.facts.map((f) => f.id));
      const newFacts = candidateFacts.filter((f) => !existingIds.has(f.id));
      if (newFacts.length === 0) return;

      // Use the store directly to merge dreaming-promoted facts
      const memory = this.deps.memoryManager.get();
      const merged = [...memory.facts, ...newFacts];
      // Sort by confidence descending, then recency
      merged.sort((a, b) => b.confidence - a.confidence || b.createdAt.localeCompare(a.createdAt));
      // Respect the 120 fact cap
      const capped = merged.slice(0, 120);

      const profile = {
        ...memory,
        lastUpdated: new Date(now).toISOString(),
        facts: capped,
      };
      this.deps.memoryManager.saveProfile(profile);

      // Index embeddings for the updated profile chunks
      if (this.deps.memoryIndexStore && this.deps.embeddingProvider) {
        try {
          await this.deps.memoryIndexStore.indexEmbeddings(this.deps.embeddingProvider);
        } catch {
          // Embedding indexing failure is non-fatal
        }
      }
    } catch (error) {
      console.error("[dreaming] Scheduler tick failed:", error instanceof Error ? error.message : error);
    } finally {
      this.tickInFlight = false;
    }
  }
}
