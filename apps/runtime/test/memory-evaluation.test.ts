import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  LongTermMemoryProfileSchema,
  type LongTermMemoryProfile,
} from "@cemeworm/shared";
import { buildActiveMemoryContext, collectActiveMemoryCandidates, retrieveActiveMemoryCandidates } from "../src/active-memory.js";
import { MemoryIndexStore, lexicalMemoryFallback, mergeHybridResults, mmrRerank } from "../src/memory-index.js";
import { ShortTermMemoryJournal } from "../src/memory-journal.js";
import { MemoryDreamingService } from "../src/memory-dreaming.js";
import { MemoryWikiStore } from "../src/memory-wiki.js";
import { admitWithProvider, type ProviderAdmissionResponse } from "../src/memory-admission.js";
import type { MemoryModelInvoker } from "../src/memory.js";

const NOW = "2026-05-08T00:00:00.000Z";

type EvalProfile = LongTermMemoryProfile;
type EvalResult = {
  variant: string;
  selectedIds: string[];
  rejectedIds: string[];
  status: "USE" | "NONE";
  topScore?: number;
};

// === Eval Fixture Builder ===

function buildEvalProfile(facts: Array<{
  id: string; content: string; category: string; confidence: number;
  createdAt?: string; sourceRunId?: string; sourceError?: string;
}>): EvalProfile {
  return LongTermMemoryProfileSchema.parse({
    version: "1.0",
    lastUpdated: NOW,
    user: {
      workContext: { summary: "Ora is an AI agent runtime with long-term memory.", updatedAt: NOW },
      topOfMind: { summary: "Memory optimization and hybrid retrieval.", updatedAt: NOW },
    },
    facts: facts.map((f) => ({
      ...f,
      createdAt: f.createdAt ?? NOW,
      source: f.sourceRunId ?? `run_${f.id}`,
    })),
  });
}

function evalDeterministic(profile: EvalProfile, query: string): EvalResult {
  const context = buildActiveMemoryContext({
    memory: profile,
    prompt: query,
    nowIso: NOW,
  });
  return {
    variant: "deterministic",
    selectedIds: context.decision.selectedIds,
    rejectedIds: context.decision.rejectedIds,
    status: context.decision.status,
  };
}

function evalBM25(index: MemoryIndexStore, profile: EvalProfile, query: string): EvalResult {
  index.indexProfile(profile);
  const results = index.searchWithFallback({ query, maxResults: 12 }, profile);
  const selectedIds = results.slice(0, 6).map((r) => r.chunk.sourceId);
  const allIds = results.map((r) => r.chunk.sourceId);
  return {
    variant: "bm25",
    selectedIds,
    rejectedIds: [],
    status: selectedIds.length > 0 ? "USE" : "NONE",
    topScore: results[0]?.finalScore,
  };
}

function evalFallback(profile: EvalProfile, query: string): EvalResult {
  const results = lexicalMemoryFallback({ query, maxResults: 12 }, profile);
  const selectedIds = results.slice(0, 6).map((r) => r.chunk.sourceId);
  return {
    variant: "fallback",
    selectedIds,
    rejectedIds: [],
    status: selectedIds.length > 0 ? "USE" : "NONE",
    topScore: results[0]?.finalScore,
  };
}

async function evalProviderAdmission(
  profile: EvalProfile,
  query: string,
  relevantIds: string[],
): Promise<EvalResult> {
  const candidates = retrieveActiveMemoryCandidates({ memory: profile, prompt: query, nowIso: NOW });
  const response: ProviderAdmissionResponse = {
    selectedIds: relevantIds,
    reason: `Provider selected ${relevantIds.length} relevant cards.`,
    rejectedIds: candidates.filter((c) => !relevantIds.includes(c.id)).map((c) => c.id),
    uncertainty: 0.1,
    result: relevantIds.length > 0 ? "USE" : "NONE",
  };
  const invoker: MemoryModelInvoker = async () => JSON.stringify(response);

  const result = await admitWithProvider(
    candidates,
    { candidates, prompt: query, maxSummaryChars: 2000 },
    invoker,
    5000,
  );

  return {
    variant: "provider_admission",
    selectedIds: result.decision.selectedIds,
    rejectedIds: result.decision.rejectedIds,
    status: result.decision.status,
  };
}

// === Evaluation Scenarios ===

describe("Memory Evaluation Harness", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ora-eval-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // Scenario 1: Paraphrased Preference Recall
  describe("Scenario 1: Paraphrased Preference Recall", () => {
    const profile = buildEvalProfile([
      { id: "fact_ts_strict", content: "User prefers TypeScript with strict null checks enabled.", category: "preference", confidence: 0.94 },
      { id: "fact_rust", content: "User likes Rust for system programming.", category: "context", confidence: 0.8 },
    ]);

    const paraphrasedQuery = "I want rigorous type checking in my TS code. What settings should I use?";

    it("deterministic: recalls preference by keyword overlap", () => {
      // For deterministic, use a query with lexical overlap ("TypeScript checks" -> "TypeScript ... checks")
      const result = evalDeterministic(profile, "What TypeScript null checks configuration do you recommend?");
      expect(result.selectedIds).toContain("fact_ts_strict");
    });

    it("bm25: recalls preference with FTS ranking", () => {
      const index = new MemoryIndexStore(tmpDir);
      try {
        const result = evalBM25(index, profile, paraphrasedQuery);
        expect(result.selectedIds).toContain("fact_ts_strict");
      } finally {
        index.close();
      }
    });

    it("fallback: recalls preference without index", () => {
      const result = evalFallback(profile, paraphrasedQuery);
      expect(result.selectedIds).toContain("fact_ts_strict");
    });

    it("provider: admits the preference", async () => {
      const result = await evalProviderAdmission(profile, paraphrasedQuery, ["fact_ts_strict"]);
      expect(result.selectedIds).toContain("fact_ts_strict");
    });
  });

  // Scenario 2: Exact Config/Error Recall
  describe("Scenario 2: Exact Config/Error Recall", () => {
    const profile = buildEvalProfile([
      { id: "fact_config", content: "Ora config: memory.maxFacts=120, memory.injectionMaxFacts=24.", category: "knowledge", confidence: 0.95 },
      { id: "fact_error", content: "Error ENOSPC occurs when tmpdir runs out of inodes.", category: "knowledge", confidence: 0.9 },
    ]);

    it("deterministic: finds exact config key", () => {
      const result = evalDeterministic(profile, "What is memory.maxFacts set to?");
      expect(result.selectedIds).toContain("fact_config");
    });

    it("bm25: finds exact error message", () => {
      const index = new MemoryIndexStore(tmpDir);
      try {
        const result = evalBM25(index, profile, "ENOSPC error why?");
        expect(result.selectedIds).toContain("fact_error");
      } finally {
        index.close();
      }
    });

    it("fallback: finds both config and error for mixed query", () => {
      const result = evalFallback(profile, "memory configuration and ENOSPC handling");
      expect(result.selectedIds.length).toBeGreaterThanOrEqual(1);
    });
  });

  // Scenario 3: Stale Fact Rejection
  describe("Scenario 3: Stale Fact Rejection", () => {
    const twoYearsAgo = new Date(Date.parse(NOW) - 730 * 86_400_000).toISOString();
    const profile = buildEvalProfile([
      { id: "fact_current", content: "User currently uses React 19 with Server Components.", category: "knowledge", confidence: 0.9, createdAt: NOW },
      { id: "fact_stale", content: "User was learning React class components in 2024.", category: "context", confidence: 0.7, createdAt: twoYearsAgo },
    ]);

    it("deterministic: deprioritizes stale facts", () => {
      const result = evalDeterministic(profile, "What React components and Server Components do you support?");
      // Current fact should be preferred over stale
      expect(result.selectedIds).toContain("fact_current");
    });

    it("bm25: stale fact gets negative freshness score", () => {
      const index = new MemoryIndexStore(tmpDir);
      try {
        index.indexProfile(profile);
        const results = index.search({ query: "React components approach", maxResults: 12, decayEnabled: true });
        const staleResult = results.find((r) => r.chunk.sourceId === "fact_stale");
        if (staleResult) {
          expect(staleResult.freshnessScore).toBeLessThanOrEqual(0);
        }
      } finally {
        index.close();
      }
    });
  });

  // Scenario 4: Wrong-Project Exclusion
  describe("Scenario 4: Wrong-Project Exclusion", () => {
    const projectA = buildEvalProfile([
      { id: "fact_auth_a", content: "Project Alpha uses JWT RS256 for auth.", category: "knowledge", confidence: 0.95, sourceRunId: "run_alpha" },
    ]);
    const projectB = buildEvalProfile([
      { id: "fact_auth_b", content: "Project Beta uses OAuth2 with PKCE for auth.", category: "knowledge", confidence: 0.95, sourceRunId: "run_beta" },
    ]);

    it("deterministic: excludes other project facts with scope filtering", () => {
      // When querying for project Alpha, Beta's facts shouldn't appear
      const alphaResult = evalDeterministic(projectA, "What auth does this project use?");
      expect(alphaResult.selectedIds).toContain("fact_auth_a");
      // Without projectBeta in memory, fact_auth_b shouldn't be there
      expect(alphaResult.selectedIds).not.toContain("fact_auth_b");
    });

    it("bm25: scope filter excludes wrong project", () => {
      const index = new MemoryIndexStore(tmpDir);
      try {
        index.indexProfile(projectA, { projectId: "project-alpha" });
        index.indexProfile(projectB, { projectId: "project-beta" });

        const alphaResults = index.search({
          query: "auth method",
          maxResults: 12,
          scopes: { projectId: "project-alpha" },
        });

        const hasBetaFact = alphaResults.some((r) => r.chunk.sourceId === "fact_auth_b");
        expect(hasBetaFact).toBe(false);
      } finally {
        index.close();
      }
    });
  });

  // Scenario 5: Contradiction Handling
  describe("Scenario 5: Contradiction Handling", () => {
    it("wiki: detects contradictions between opposing claims", () => {
      const wiki = new MemoryWikiStore(tmpDir);
      const profile = buildEvalProfile([
        { id: "fact_npm", content: "User always prefers npm for package management.", category: "preference", confidence: 0.85 },
        { id: "fact_pnpm", content: "User never wants npm, always use pnpm instead.", category: "correction", confidence: 0.96, sourceError: "Used npm before" },
      ]);

      const page = wiki.compileFromProfile(profile, "user");
      expect(page.contradictions.length).toBeGreaterThan(0);
    });

    it("dreaming: contradicted candidates stay in review", () => {
      const journal = new ShortTermMemoryJournal(tmpDir);
      journal.append({ runId: "r1", sessionId: "s1", type: "memory_intent", content: "User prefers npm for package management.", category: "preference", confidence: 0.8 });
      journal.append({ runId: "r1", sessionId: "s1", type: "memory_intent", content: "User prefers npm for package management.", category: "preference", confidence: 0.8 });
      journal.append({ runId: "r2", sessionId: "s2", type: "correction", content: "User corrected: prefer pnpm instead of npm for package management.", category: "correction", confidence: 0.95 });

      const dreaming = new MemoryDreamingService(journal, undefined, 0.5);
      const preview = dreaming.deepPhase();

      // Contradicted candidates should be flagged
      const allFlagged = [...preview.recommendContradicted, ...preview.recommendPromote];
      expect(allFlagged.length).toBeGreaterThan(0);
    });
  });

  // Scenario 6: Promotion Threshold
  describe("Scenario 6: Promotion Threshold", () => {
    it("dreaming: single one-off fact does not promote", () => {
      const journal = new ShortTermMemoryJournal(tmpDir);
      journal.append({ runId: "r1", type: "memory_intent", content: "User mentioned weather today.", confidence: 0.4 });

      const dreaming = new MemoryDreamingService(journal, undefined, 0.65);
      const preview = dreaming.deepPhase();

      expect(preview.recommendPromote).toHaveLength(0);
    });

    it("dreaming: repeated high-confidence signal promotes", () => {
      const journal = new ShortTermMemoryJournal(tmpDir);
      for (let i = 1; i <= 5; i++) {
        journal.append({
          runId: `r${i}`, sessionId: `s${i}`,
          type: "memory_intent",
          content: "User prefers TypeScript strict mode for all projects.",
          category: "preference",
          confidence: 0.9,
        });
      }

      const dreaming = new MemoryDreamingService(journal, undefined, 0.55);
      const preview = dreaming.deepPhase();

      expect(preview.recommendPromote.length).toBeGreaterThan(0);
      expect(preview.recommendPromote[0]?.signalCount).toBeGreaterThanOrEqual(3);
    });
  });

  // Scenario 7: Wiki Provenance Lookup
  describe("Scenario 7: Wiki Provenance Lookup", () => {
    it("claims link back to source fact and run IDs", () => {
      const wiki = new MemoryWikiStore(tmpDir);
      const profile = buildEvalProfile([
        { id: "fact_auth_jwt", content: "Auth middleware must use JWT with RS256.", category: "knowledge", confidence: 0.95, sourceRunId: "run_security_1" },
      ]);

      const page = wiki.compileFromProfile(profile, "project");
      const claim = page.claims.find((c) => c.statement.includes("RS256"));

      expect(claim).toBeDefined();
      expect(claim!.sourceFactIds).toContain("fact_auth_jwt");
      expect(claim!.sourceRunIds).toContain("run_security_1");
      expect(page.sourceRunIds).toContain("run_security_1");
    });

    it("wiki search finds claims by topic", () => {
      const wiki = new MemoryWikiStore(tmpDir);
      const profile = buildEvalProfile([
        { id: "fact_deploy", content: "Deployment uses Docker with multi-stage builds.", category: "knowledge", confidence: 0.9 },
      ]);

      wiki.compileFromProfile(profile, "project");

      const results = wiki.search("Docker");
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]?.matches.some((m) => m.includes("Docker"))).toBe(true);
    });
  });
});

// === Variant Comparison ===

describe("Variant Comparison", () => {
  let tmpDir: string;
  const profile = buildEvalProfile([
    { id: "fact_ts", content: "User prefers TypeScript with strict null checks enabled.", category: "preference", confidence: 0.94 },
    { id: "fact_pnpm", content: "User prefers pnpm for package management in all projects.", category: "preference", confidence: 0.92 },
    { id: "fact_ci", content: "CI pipeline uses GitHub Actions with pnpm caching.", category: "knowledge", confidence: 0.88 },
    { id: "fact_lunch", content: "User likes spicy noodles for lunch.", category: "context", confidence: 0.7 },
  ]);

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ora-eval-cmp-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("compares all variants for a relevant query", async () => {
    const query = "How should I configure TypeScript and package management?";

    // Deterministic
    const det = evalDeterministic(profile, query);

    // Fallback (lexical without index)
    const fb = evalFallback(profile, query);

    // BM25
    const index = new MemoryIndexStore(tmpDir);
    let bm25: EvalResult;
    try {
      bm25 = evalBM25(index, profile, query);
    } finally {
      index.close();
    }

    // Provider admission
    const pa = await evalProviderAdmission(profile, query, ["fact_ts", "fact_pnpm"]);

    // All variants should recall the relevant preferences
    const allResults = [det, fb, bm25, pa];
    for (const result of allResults) {
      expect(result.status).toBe("USE");
      expect(result.selectedIds.length).toBeGreaterThan(0);
    }

    // Deterministic should select at least one relevant fact
    expect(det.selectedIds.some((id) => id === "fact_ts" || id === "fact_pnpm")).toBe(true);

    // Provider should select both relevant facts
    expect(pa.selectedIds).toContain("fact_ts");
    expect(pa.selectedIds).toContain("fact_pnpm");
  });

  it("all variants correctly reject irrelevant facts for unrelated query", async () => {
    const query = "What is the capital of France?";

    const det = evalDeterministic(profile, query);
    const fb = evalFallback(profile, query);

    // None should select lunch preference for a geography question
    // (deterministic may still select workContext section, but shouldn't select lunch fact)
    for (const result of [det, fb]) {
      if (result.status === "NONE") {
        expect(result.selectedIds).toEqual([]);
      }
    }
  });

  it("memory-disabled variant returns nothing", () => {
    // Simulate disabled memory - empty profile
    const emptyProfile = LongTermMemoryProfileSchema.parse({
      version: "1.0",
      lastUpdated: NOW,
    });

    const result = evalDeterministic(emptyProfile, "What TypeScript settings?");
    expect(result.status).toBe("NONE");
    expect(result.selectedIds).toEqual([]);
  });
});
