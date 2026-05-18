import type { ActiveMemoryContext, WikiPage } from "@cemeworm/shared";
import type { MemoryIndexStore } from "./memory-index.js";
import type { ShortTermMemoryJournal } from "./memory-journal.js";
import type { PromotionPreview } from "./memory-dreaming.js";
import type { MemoryWikiStore } from "./memory-wiki.js";
import type { LongTermMemoryProfile } from "@cemeworm/shared";
import type { TaskMemoryStore } from "./task-memory.js";
import type { ScenarioStore } from "./memory-scenarios.js";

// === Memory Health Snapshot ===

export interface MemoryHealthSnapshot {
  profile: {
    factCount: number;
    sectionCount: number;
    lastUpdated: string;
  };
  index: {
    chunkCount: number;
    ftsAvailable: boolean;
  };
  journal: {
    signalCount: number;
    recentTypes: Record<string, number>;
  };
  dreaming: {
    candidateCount: number;
    promoteCount: number;
    holdCount: number;
    contradictedCount: number;
    lastPreview: string | undefined;
  };
  wiki: {
    pageCount: number;
    claimCount: number;
    contradictionCount: number;
    pageIds: string[];
  };
  taskMemory: {
    activeRunCount: number;
    totalNodeCount: number;
    totalEvidenceCount: number;
    runIds: string[];
  };
  trace: {
    fullyTraceable: number;
    partiallyTraceable: number;
    untraceable: number;
    totalItems: number;
  };
}

export interface ActiveMemoryTrace {
  status: "USE" | "NONE";
  mode: string;
  reason: string;
  candidateCount: number;
  selectedCount: number;
  rejectedCount: number;
  elapsedMs: number | undefined;
  providerUsed: boolean;
  providerFallback: boolean;
  retrievalCorpus: string;
  semanticEnabled: boolean;
  diversityEnabled: boolean;
  renderedChars: number;
  warnings: string[];
  selectedIds: string[];
  candidateScoreBreakdown: CandidateScoreEntry[];
}

export interface CandidateScoreEntry {
  id: string;
  category: string;
  confidence: number;
  lexicalScore: number;
  semanticScore: number;
  freshnessScore: number;
  finalScore: number;
  scoreReasons: string[];
  selected: boolean;
}

// === Health Aggregation ===

function computeTraceSummary(
  profile: LongTermMemoryProfile,
  wikiPages: WikiPage[],
  taskMemory?: TaskMemoryStore,
  scenarioStore?: ScenarioStore,
): MemoryHealthSnapshot["trace"] {
  let fully = 0;
  let partial = 0;
  let none = 0;

  // Facts: fully traceable if sourceRunId present
  for (const fact of profile.facts) {
    if (fact.sourceRunId) fully++;
    else none++;
  }

  // Wiki claims: traceable if sourceFactIds non-empty
  for (const page of wikiPages) {
    for (const claim of page.claims) {
      if (claim.sourceFactIds.length > 0 && claim.sourceRunIds.length > 0) fully++;
      else if (claim.sourceFactIds.length > 0) partial++;
      else none++;
    }
  }

  // Task nodes: traceable if evidenceRefIds non-empty
  if (taskMemory) {
    for (const runId of taskMemory.activeRunIds()) {
      for (const node of taskMemory.getNodes(runId)) {
        if (node.evidenceRefIds.length > 0) fully++;
        else partial++;
      }
    }
  }

  // Scenarios: traceable if sourceFactIds non-empty
  if (scenarioStore) {
    for (const scenario of scenarioStore.list()) {
      if (scenario.sourceFactIds.length > 0 && scenario.sourceRunIds.length > 0) fully++;
      else if (scenario.sourceFactIds.length > 0) partial++;
      else none++;
    }
  }

  return {
    fullyTraceable: fully,
    partiallyTraceable: partial,
    untraceable: none,
    totalItems: fully + partial + none,
  };
}

export function buildMemoryHealthSnapshot(params: {
  profile: LongTermMemoryProfile;
  index?: MemoryIndexStore;
  journal?: ShortTermMemoryJournal;
  preview?: PromotionPreview;
  wiki?: MemoryWikiStore;
  taskMemory?: TaskMemoryStore;
  scenarioStore?: ScenarioStore;
}): MemoryHealthSnapshot {
  const { profile, index, journal, preview, wiki, taskMemory, scenarioStore } = params;

  const typeCounts: Record<string, number> = {};
  if (journal) {
    for (const signal of journal.readRecent(200)) {
      typeCounts[signal.type] = (typeCounts[signal.type] ?? 0) + 1;
    }
  }

  const wikiPages: WikiPage[] = wiki?.listPages() ?? [];

  return {
    profile: {
      factCount: profile.facts.length,
      sectionCount: [
        profile.user.workContext,
        profile.user.personalContext,
        profile.user.topOfMind,
        profile.history.recentMonths,
        profile.history.earlierContext,
        profile.history.longTermBackground,
      ].filter((s) => s.summary).length,
      lastUpdated: profile.lastUpdated,
    },
    index: {
      chunkCount: index?.chunkCount() ?? 0,
      ftsAvailable: index !== undefined,
    },
    journal: {
      signalCount: journal?.count() ?? 0,
      recentTypes: typeCounts,
    },
    dreaming: {
      candidateCount: preview?.candidates.length ?? 0,
      promoteCount: preview?.recommendPromote.length ?? 0,
      holdCount: preview?.recommendHold.length ?? 0,
      contradictedCount: preview?.recommendContradicted.length ?? 0,
      lastPreview: preview?.generatedAt,
    },
    wiki: {
      pageCount: wikiPages.length,
      claimCount: wikiPages.reduce((sum, p) => sum + p.claims.length, 0),
      contradictionCount: wikiPages.reduce((sum, p) => sum + p.contradictions.length, 0),
      pageIds: wikiPages.map((p) => p.id),
    },
    taskMemory: (() => {
      const runIds = taskMemory?.activeRunIds() ?? [];
      let totalNodeCount = 0;
      let totalEvidenceCount = 0;
      for (const runId of runIds) {
        totalNodeCount += taskMemory!.nodeCount(runId);
        totalEvidenceCount += taskMemory!.evidenceCount(runId);
      }
      return {
        activeRunCount: runIds.length,
        totalNodeCount,
        totalEvidenceCount,
        runIds,
      };
    })(),
    trace: computeTraceSummary(profile, wikiPages, taskMemory, scenarioStore),
  };
}

// === Active Memory Trace ===

export function buildActiveMemoryTrace(
  context: ActiveMemoryContext,
  overrides?: {
    elapsedMs?: number;
    providerUsed?: boolean;
    providerFallback?: boolean;
    retrievalCorpus?: string;
    semanticEnabled?: boolean;
    diversityEnabled?: boolean;
  },
): ActiveMemoryTrace {
  const decision = context.decision;

  const breakdown: CandidateScoreEntry[] = [];
  // Build score breakdown from cards (which have the selected info)
  const selectedIds = new Set(decision.selectedIds);
  for (const card of context.cards) {
    breakdown.push({
      id: card.id,
      category: card.category,
      confidence: card.confidence,
      lexicalScore: 0,
      semanticScore: 0,
      freshnessScore: 0,
      finalScore: card.confidence,
      scoreReasons: [],
      selected: selectedIds.has(card.id),
    });
  }
  // Add rejected ids without scores
  for (const id of decision.rejectedIds) {
    if (!breakdown.some((b) => b.id === id)) {
      breakdown.push({
        id,
        category: "",
        confidence: 0,
        lexicalScore: 0,
        semanticScore: 0,
        freshnessScore: 0,
        finalScore: 0,
        scoreReasons: ["rejected"],
        selected: false,
      });
    }
  }

  return {
    status: decision.status,
    mode: decision.mode,
    reason: decision.reason,
    candidateCount: decision.candidateIds.length,
    selectedCount: decision.selectedIds.length,
    rejectedCount: decision.rejectedIds.length,
    elapsedMs: overrides?.elapsedMs,
    providerUsed: overrides?.providerUsed ?? decision.mode === "provider",
    providerFallback: overrides?.providerFallback ?? decision.mode === "provider_fallback",
    retrievalCorpus: overrides?.retrievalCorpus ?? "raw",
    semanticEnabled: overrides?.semanticEnabled ?? false,
    diversityEnabled: overrides?.diversityEnabled ?? false,
    renderedChars: decision.budget.renderedChars,
    warnings: decision.warnings,
    selectedIds: decision.selectedIds,
    candidateScoreBreakdown: breakdown,
  };
}

// === TrailViewModel Extension ===

// This mirrors trailViewModel's ActiveMemorySummary but richer:
export function extendActiveMemorySummary(
  trace: ActiveMemoryTrace,
): Record<string, unknown> {
  return {
    ...trace,
    // Flattened for easy UI rendering
    summaryLine: trace.mode === "provider_fallback"
      ? `Provider fallback → deterministic (${trace.selectedCount} selected)`
      : trace.mode === "provider"
        ? `Provider selected ${trace.selectedCount} cards from ${trace.candidateCount} candidates`
        : `Deterministic: ${trace.selectedCount} selected, ${trace.rejectedCount} rejected`,
    timingLine: trace.elapsedMs !== undefined
      ? `${trace.elapsedMs}ms · ${trace.renderedChars} chars · corpus: ${trace.retrievalCorpus}`
      : `${trace.renderedChars} chars · corpus: ${trace.retrievalCorpus}`,
    hasSemantic: trace.semanticEnabled,
    hasDiversity: trace.diversityEnabled,
    topCandidates: trace.candidateScoreBreakdown
      .filter((c) => c.selected)
      .slice(0, 3)
      .map((c) => ({ id: c.id, category: c.category, reasons: c.scoreReasons })),
  };
}
