import type { ShortTermSignal, LongTermMemoryFact } from "@cemeworm/shared";
import { ShortTermMemoryJournal } from "./memory-journal.js";

// === Dreaming Types ===

export type DreamPhase = "light" | "rem" | "deep";

export interface DreamingCandidate {
  theme: string;
  signals: ShortTermSignal[];
  signalCount: number;
  distinctSessions: number;
  distinctRuns: number;
  firstSeen: string;
  lastSeen: string;
  averageConfidence: number;
  recencyScore: number;
  multiDayRecurrence: boolean;
  categoryHint: string;
}

export interface PromotionPreview {
  candidates: DreamingCandidate[];
  recommendPromote: DreamingCandidate[];
  recommendHold: DreamingCandidate[];
  recommendContradicted: DreamingCandidate[];
  generatedAt: string;
  phase: DreamPhase;
}

interface DreamingWeights {
  frequencyWeight: number;
  recencyWeight: number;
  distinctContextWeight: number;
  confidenceWeight: number;
  multiDayWeight: number;
  conceptualRichnessWeight: number;
}

const DEFAULT_WEIGHTS: DreamingWeights = {
  frequencyWeight: 0.25,
  recencyWeight: 0.2,
  distinctContextWeight: 0.2,
  confidenceWeight: 0.15,
  multiDayWeight: 0.1,
  conceptualRichnessWeight: 0.1,
};

const PROMOTION_THRESHOLD = 0.65;
const MULTI_DAY_MS = 86_400_000;

export class MemoryDreamingService {
  constructor(
    private readonly journal: ShortTermMemoryJournal,
    private readonly weights: DreamingWeights = DEFAULT_WEIGHTS,
    private readonly threshold = PROMOTION_THRESHOLD,
  ) {}

  // === Light Phase: ingest signals, dedupe, stage candidates ===

  lightPhase(): DreamingCandidate[] {
    const signals = this.journal.readRecent(200);
    return this.clusterSignals(signals);
  }

  // === REM Phase: cluster themes, record reflective signals, no durable writes ===

  remPhase(signals?: ShortTermSignal[]): DreamingCandidate[] {
    const source = signals ?? this.journal.readRecent(200);
    const candidates = this.clusterSignals(source);
    // Enrich with reflective scoring
    return candidates.map((c) => ({
      ...c,
      multiDayRecurrence: this.hasMultiDayRecurrence(c.signals),
    }));
  }

  // === Deep Phase: score candidates, produce promotion preview ===

  deepPhase(candidates?: DreamingCandidate[]): PromotionPreview {
    const source = candidates ?? this.remPhase();
    const scored = source.map((c) => ({
      ...c,
      recencyScore: this.computeRecencyScore(c.lastSeen),
    }));

    const recommendPromote: DreamingCandidate[] = [];
    const recommendHold: DreamingCandidate[] = [];
    const recommendContradicted: DreamingCandidate[] = [];

    for (const candidate of scored) {
      const score = this.computePromotionScore(candidate);
      const hasPotentialContradiction = this.hasPotentialContradiction(candidate);

      if (hasPotentialContradiction) {
        recommendHold.push({ ...candidate, recencyScore: score });
      } else if (score >= this.threshold) {
        recommendPromote.push({ ...candidate, recencyScore: score });
      } else {
        recommendHold.push({ ...candidate, recencyScore: score });
      }
    }

    return {
      candidates: scored,
      recommendPromote: recommendPromote.sort((a, b) => b.recencyScore - a.recencyScore),
      recommendHold,
      recommendContradicted,
      generatedAt: new Date().toISOString(),
      phase: "deep",
    };
  }

  // === Scoring ===

  private computePromotionScore(candidate: DreamingCandidate): number {
    const w = this.weights;

    const frequencyScore = Math.min(1, candidate.signalCount / 5);
    const recencyScore = this.computeRecencyScore(candidate.lastSeen);
    const distinctScore = Math.min(1, candidate.distinctSessions / 3);
    const confidenceScore = candidate.averageConfidence;
    const multiDayScore = candidate.multiDayRecurrence ? 1 : 0;
    const richnessScore = this.conceptualRichness(candidate);

    return Number((
      w.frequencyWeight * frequencyScore +
      w.recencyWeight * recencyScore +
      w.distinctContextWeight * distinctScore +
      w.confidenceWeight * confidenceScore +
      w.multiDayWeight * multiDayScore +
      w.conceptualRichnessWeight * richnessScore
    ).toFixed(4));
  }

  private computeRecencyScore(lastSeenIso: string): number {
    const ms = Date.now() - new Date(lastSeenIso).getTime();
    const days = ms / 86_400_000;
    if (days <= 1) return 1;
    if (days <= 7) return 0.8;
    if (days <= 30) return 0.5;
    if (days <= 90) return 0.2;
    return 0.05;
  }

  private conceptualRichness(candidate: DreamingCandidate): number {
    // Richness: distinct signal types + content length diversity
    const types = new Set(candidate.signals.map((s) => s.type));
    const hasIntent = types.has("memory_intent") || types.has("correction");
    const hasRecall = types.has("recall_hit") || types.has("selected_card");
    let score = 0.3;
    if (hasIntent) score += 0.35;
    if (hasRecall) score += 0.35;
    return Math.min(1, score);
  }

  private hasMultiDayRecurrence(signals: ShortTermSignal[]): boolean {
    if (signals.length < 2) return false;
    const timestamps = signals
      .map((s) => new Date(s.timestamp).getTime())
      .filter((t) => Number.isFinite(t))
      .sort();
    if (timestamps.length < 2) return false;
    const span = timestamps[timestamps.length - 1]! - timestamps[0]!;
    return span >= MULTI_DAY_MS;
  }

  private hasPotentialContradiction(candidate: DreamingCandidate): boolean {
    // Check if signals contain contradictory corrections
    const corrections = candidate.signals.filter((s) => s.type === "correction");
    const preferences = candidate.signals.filter((s) => s.type === "memory_intent" && s.category === "preference");

    // A correction that contradicts a previously stored preference
    if (corrections.length > 0 && preferences.length > 0) {
      const prefContents = preferences.map((p) => p.content.toLowerCase());
      const corrContents = corrections.map((c) => c.content.toLowerCase());
      for (const pref of prefContents) {
        for (const corr of corrContents) {
          // Simple heuristic: if correction and preference share keywords but correction is newer
          const prefTokens = new Set(pref.split(/\s+/));
          const corrTokens = new Set(corr.split(/\s+/));
          const overlap = [...prefTokens].filter((t) => corrTokens.has(t) && t.length > 3);
          if (overlap.length >= 2) return true;
        }
      }
    }
    return false;
  }

  // === Clustering ===

  private clusterSignals(signals: ShortTermSignal[]): DreamingCandidate[] {
    const clusters = new Map<string, ShortTermSignal[]>();

    for (const signal of signals) {
      const key = this.clusterKey(signal);
      const existing = clusters.get(key) ?? [];
      existing.push(signal);
      clusters.set(key, existing);
    }

    const candidates: DreamingCandidate[] = [];
    for (const [theme, clusterSignals] of clusters) {
      if (clusterSignals.length < 1) continue;

      const sessions = new Set(clusterSignals.map((s) => s.sessionId).filter(Boolean));
      const runs = new Set(clusterSignals.map((s) => s.runId));
      const confidences = clusterSignals.map((s) => s.confidence);
      const timestamps = clusterSignals.map((s) => new Date(s.timestamp).getTime()).filter((t) => Number.isFinite(t));
      const firstSeen = timestamps.length > 0 ? new Date(Math.min(...timestamps)).toISOString() : "";
      const lastSeen = timestamps.length > 0 ? new Date(Math.max(...timestamps)).toISOString() : "";

      const categoryCounts = new Map<string, number>();
      for (const s of clusterSignals) {
        if (s.category) {
          categoryCounts.set(s.category, (categoryCounts.get(s.category) ?? 0) + 1);
        }
      }
      let categoryHint = "context";
      let maxCount = 0;
      for (const [cat, count] of categoryCounts) {
        if (count > maxCount) {
          maxCount = count;
          categoryHint = cat;
        }
      }

      candidates.push({
        theme,
        signals: clusterSignals,
        signalCount: clusterSignals.length,
        distinctSessions: sessions.size,
        distinctRuns: runs.size,
        firstSeen,
        lastSeen,
        averageConfidence: confidences.reduce((a, b) => a + b, 0) / confidences.length,
        recencyScore: 0,
        multiDayRecurrence: false,
        categoryHint,
      });
    }

    return candidates.sort((a, b) => b.signalCount - a.signalCount);
  }

  private clusterKey(signal: ShortTermSignal): string {
    const normalized = signal.content
      .toLowerCase()
      .replace(/[^\w\s一-鿿]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    // Use first 8 words as cluster key
    const words = normalized.split(/\s+/).filter((w) => w.length > 2).slice(0, 8);
    return words.join(" ");
  }
}

// === Promotion Preview / Apply helpers ===

export function factsFromPromotionPreview(
  preview: PromotionPreview,
  source: string,
): LongTermMemoryFact[] {
  const now = new Date().toISOString();
  const facts: LongTermMemoryFact[] = [];

  for (const candidate of preview.recommendPromote) {
    const factId = `dream_${hashId(`${source}:${candidate.theme}`)}`;
    facts.push({
      id: factId,
      content: candidate.theme.slice(0, 700),
      category: categoryForHint(candidate.categoryHint),
      confidence: Number(Math.min(1, candidate.averageConfidence + 0.05).toFixed(2)),
      createdAt: candidate.firstSeen || now,
      updatedAt: now,
      source,
      sourceRunId: source,
    });
  }
  return facts;
}

function hashId(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function categoryForHint(hint: string): LongTermMemoryFact["category"] {
  switch (hint) {
    case "preference": return "preference";
    case "correction": return "correction";
    case "goal": return "goal";
    case "behavior": return "behavior";
    case "knowledge": return "knowledge";
    default: return "context";
  }
}
