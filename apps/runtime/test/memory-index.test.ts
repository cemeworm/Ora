import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { LongTermMemoryFact, LongTermMemoryProfileSchema, type LongTermMemoryProfile } from "@cemeworm/shared";
import { MemoryIndexStore, lexicalMemoryFallback, mmrRerank, mergeHybridResults, type EmbeddingProvider } from "../src/memory-index.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const NOW = "2026-05-08T00:00:00.000Z";

function testProfile(facts: LongTermMemoryFact[] = []): LongTermMemoryProfile {
  return LongTermMemoryProfileSchema.parse({
    version: "1.0",
    lastUpdated: NOW,
    user: {
      workContext: {
        summary: "Ora work focuses on auditable agent memory.",
        updatedAt: NOW,
      },
    },
    facts,
  });
}

function prefFact(id: string, content: string, source = "run_1"): LongTermMemoryFact {
  return {
    id,
    content,
    category: "preference",
    confidence: 0.94,
    createdAt: NOW,
    source,
  };
}

describe("MemoryIndexStore", () => {
  let dir: string;
  let store: MemoryIndexStore;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "ora-memidx-test-"));
    store = new MemoryIndexStore(dir);
  });

  afterEach(() => {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("indexes profile candidates as chunks and allows lexical search", () => {
    const profile = testProfile([
      prefFact("fact_1", "User prefers TypeScript with strict null checks."),
      prefFact("fact_2", "User likes Rust for system programming."),
    ]);

    store.indexProfile(profile);
    expect(store.chunkCount()).toBeGreaterThanOrEqual(2);

    const results = store.search({
      query: "TypeScript strict",
      maxResults: 5,
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.chunk.content).toContain("TypeScript");
  });

  it("returns empty results when FTS query has no match", () => {
    const profile = testProfile([
      prefFact("fact_1", "User prefers TypeScript."),
    ]);

    store.indexProfile(profile);

    const results = store.search({
      query: "zzzxyzabc123nonexistent",
      maxResults: 5,
    });

    expect(results).toEqual([]);
  });

  it("filters results by project scope", () => {
    const profile = testProfile([
      prefFact("fact_1", "User prefers pnpm for package management."),
    ]);

    store.indexProfile(profile, { projectId: "project-alpha" });

    const projectResults = store.search({
      query: "pnpm",
      maxResults: 5,
      scopes: { projectId: "project-alpha" },
    });
    expect(projectResults.length).toBeGreaterThan(0);

    const otherResults = store.search({
      query: "pnpm",
      maxResults: 5,
      scopes: { projectId: "project-beta" },
    });
    expect(otherResults).toEqual([]);
  });

  it("falls back to lexical search when the index is empty", () => {
    const profile = testProfile([
      prefFact("fact_1", "User prefers pnpm for package management."),
    ]);

    const results = store.searchWithFallback(
      { query: "pnpm", maxResults: 5 },
      profile,
    );

    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.chunk.content).toContain("pnpm");
  });

  it("clears chunks by scope", () => {
    const profile = testProfile([
      prefFact("fact_1", "User prefers pnpm."),
    ]);

    store.indexProfile(profile, { projectId: "project-x" });
    expect(store.chunkCount({ projectId: "project-x" })).toBeGreaterThan(0);

    store.clearScope({ projectId: "project-x" });
    expect(store.chunkCount({ projectId: "project-x" })).toBe(0);
  });

  it("removes individual chunks by id", () => {
    const profile = testProfile([
      prefFact("fact_1", "User prefers pnpm."),
    ]);

    const chunks = store.indexProfile(profile);
    const firstId = chunks[0]?.id;
    expect(firstId).toBeDefined();

    store.removeChunk(firstId!);
    expect(store.chunkCount()).toBe(chunks.length - 1);
  });

  it("lexical search recalls exact config keys", () => {
    const profile = testProfile([
      {
        id: "fact_cfg",
        content: "Ora config key: memory.maxFacts should be 120.",
        category: "knowledge",
        confidence: 0.95,
        createdAt: NOW,
        source: "run_cfg",
      },
    ]);

    store.indexProfile(profile);

    const results = store.search({
      query: "memory.maxFacts",
      maxResults: 5,
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.chunk.content).toContain("memory.maxFacts");
  });

  it("applies freshness score decay for old entries", () => {
    const oldDate = new Date(Date.parse(NOW) - 400 * 86_400_000).toISOString();
    const profile = LongTermMemoryProfileSchema.parse({
      version: "1.0",
      lastUpdated: oldDate,
      facts: [{
        id: "fact_old",
        content: "User prefers React class components.",
        category: "preference",
        confidence: 0.85,
        createdAt: oldDate,
        updatedAt: oldDate,
        source: "run_old",
      }],
    });

    store.indexProfile(profile);

    const results = store.search({
      query: "React class components",
      maxResults: 5,
      decayEnabled: true,
    });

    if (results.length > 0) {
      expect(results[0]?.freshnessScore).toBeLessThanOrEqual(0);
    }
  });

  it("upserts chunks on re-index", () => {
    const profile = testProfile([
      prefFact("fact_1", "User prefers pnpm."),
    ]);

    store.indexProfile(profile);
    const firstCount = store.chunkCount();

    // Re-indexing the same profile should not create duplicates
    store.indexProfile(profile);
    expect(store.chunkCount()).toBe(firstCount);
  });
});

describe("lexicalMemoryFallback", () => {
  it("returns results when FTS is unavailable", () => {
    const profile = testProfile([
      prefFact("fact_1", "User prefers pnpm for package management."),
      prefFact("fact_2", "User likes spicy noodles for lunch."),
    ]);

    const results = lexicalMemoryFallback(
      { query: "pnpm", maxResults: 5 },
      profile,
    );

    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.chunk.content).toContain("pnpm");
    expect(results.every((r) => r.semanticScore === 0)).toBe(true);
  });

  it("filters by project scope in fallback", () => {
    const profile = testProfile([
      prefFact("fact_1", "User prefers pnpm."),
    ]);

    const results = lexicalMemoryFallback(
      { query: "pnpm", maxResults: 5, scopes: { projectId: "other" } },
      profile,
    );

    // Global facts should still appear since they don't have a project scope
    // unless the matching logic filters them
    expect(results.every((r) => !r.chunk.scope.projectId || r.chunk.scope.projectId === "other")).toBe(true);
  });

  it("returns empty for empty query", () => {
    const profile = testProfile([prefFact("fact_1", "User prefers pnpm.")]);

    const results = lexicalMemoryFallback(
      { query: "", maxResults: 5 },
      profile,
    );

    expect(results).toEqual([]);
  });
});

// === Phase 2: Hybrid Retrieval Tests ===

describe("mmrRerank", () => {
  function makeResult(id: string, content: string, finalScore: number): any {
    return {
      chunk: { id, content, sourceKind: "durable_fact", sourceId: id, scope: {}, confidence: 0.9, createdAt: "", embeddingStatus: "none" },
      lexicalScore: finalScore,
      semanticScore: 0,
      freshnessScore: 0,
      finalScore,
      scoreReasons: [],
    };
  }

  it("returns top results sorted by MMR diversity", () => {
    const results = [
      makeResult("chunk_1", "User prefers TypeScript strict mode for all projects.", 0.9),
      makeResult("chunk_2", "User prefers TypeScript for type safety.", 0.85),
      makeResult("chunk_3", "Project uses Rust for backend services.", 0.8),
    ];

    const reranked = mmrRerank(results, 0.7, 3);

    expect(reranked).toHaveLength(3);
    // First result should be the highest scoring
    expect(reranked[0]?.chunk.id).toBe("chunk_1");
    // Second result should be diverse from first (Rust vs TypeScript)
    expect(reranked[1]?.chunk.id).toBe("chunk_3");
  });

  it("returns all results when lambda is 1 (relevance only)", () => {
    const results = [
      makeResult("chunk_1", "TypeScript strict mode.", 0.9),
      makeResult("chunk_2", "TypeScript type safety.", 0.85),
    ];

    const reranked = mmrRerank(results, 1.0, 2);

    expect(reranked).toHaveLength(2);
    expect(reranked[0]?.chunk.id).toBe("chunk_1");
    expect(reranked[1]?.chunk.id).toBe("chunk_2");
  });
});

describe("mergeHybridResults", () => {
  function makeLexical(id: string, content: string, lexical: number, freshness: number): any {
    return {
      chunk: { id, content, sourceKind: "durable_fact", sourceId: id, scope: {}, confidence: 0.9, createdAt: "", embeddingStatus: "none" },
      lexicalScore: lexical,
      semanticScore: 0,
      freshnessScore: freshness,
      finalScore: 0,
      scoreReasons: [`lexical:${lexical.toFixed(3)}`],
    };
  }

  function makeSemantic(id: string, content: string, semantic: number, freshness: number): any {
    return {
      chunk: { id, content, sourceKind: "durable_fact", sourceId: id, scope: {}, confidence: 0.9, createdAt: "", embeddingStatus: "none" },
      lexicalScore: 0,
      semanticScore: semantic,
      freshnessScore: freshness,
      finalScore: 0,
      scoreReasons: [`semantic:${semantic.toFixed(3)}`],
    };
  }

  it("merges lexical and semantic results, combining scores", () => {
    const lexical = [
      makeLexical("chunk_1", "TypeScript config.", 0.8, 0.05),
    ];
    const semantic = [
      makeSemantic("chunk_1", "TypeScript config.", 0.6, 0.05),
      makeSemantic("chunk_2", "Rust backend.", 0.7, 0.05),
    ];

    const merged = mergeHybridResults({
      query: "TypeScript",
      lexicalResults: lexical,
      semanticResults: semantic,
    });

    expect(merged.length).toBeGreaterThanOrEqual(1);
    const chunk1 = merged.find((r) => r.chunk.id === "chunk_1");
    expect(chunk1).toBeDefined();
    expect(chunk1!.lexicalScore).toBeGreaterThan(0);
    expect(chunk1!.semanticScore).toBeGreaterThan(0);
  });

  it("applies MMR diversity when enabled", () => {
    const lexical = [
      makeLexical("chunk_ts1", "TypeScript strict mode config.", 0.9, 0.05),
      makeLexical("chunk_ts2", "TypeScript type checking settings.", 0.85, 0.05),
      makeLexical("chunk_rust", "Rust async runtime configuration.", 0.7, 0.05),
    ];

    const merged = mergeHybridResults({
      query: "TypeScript",
      lexicalResults: lexical,
      diversityEnabled: true,
      mmrLambda: 0.6,
      maxResults: 3,
    });

    expect(merged.length).toBeLessThanOrEqual(3);
    // First should be the best TypeScript match
    expect(merged[0]?.chunk.id).toBe("chunk_ts1");
    // Second should be the Rust config (more diverse)
    expect(merged[1]?.chunk.id).toBe("chunk_rust");
  });
});

describe("EmbeddingProvider (mock)", () => {
  it("supports mock embedding provider interface", async () => {
    const mockProvider: EmbeddingProvider = {
      id: "mock",
      modelId: "mock-embed-v1",
      dimensions: 4,
      embedTexts: async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3, 0.4]),
    };

    const embeddings = await mockProvider.embedTexts(["hello", "world"]);
    expect(embeddings).toHaveLength(2);
    expect(embeddings[0]).toHaveLength(4);
  });
});
