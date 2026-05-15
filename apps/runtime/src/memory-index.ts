import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import {
  type ActiveMemoryCandidate,
  type LongTermMemoryProfile,
  type MemoryChunk,
  type MemorySearchRequest,
  type MemorySearchResult,
  MemoryChunkSchema,
} from "@cemeworm/shared";
import { collectActiveMemoryCandidates } from "./active-memory.js";

const CHUNK_TABLE = `
CREATE TABLE IF NOT EXISTS memory_chunks (
  id TEXT PRIMARY KEY,
  sourceId TEXT NOT NULL,
  sourceKind TEXT NOT NULL,
  scopeJson TEXT NOT NULL DEFAULT '{}',
  content TEXT NOT NULL,
  category TEXT,
  confidence REAL NOT NULL DEFAULT 0.5,
  createdAt TEXT NOT NULL,
  updatedAt TEXT,
  sourceRunId TEXT,
  embeddingStatus TEXT NOT NULL DEFAULT 'none',
  embeddingCacheKey TEXT
);
`;

const FTS_TABLE = `
CREATE VIRTUAL TABLE IF NOT EXISTS memory_chunks_fts USING fts5(
  id UNINDEXED,
  content,
  category,
  tokenize='unicode61'
);
`;

function hashId(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function isoNow(): string {
  return new Date().toISOString();
}

export class MemoryIndexStore {
  private readonly db: Database.Database;

  constructor(dataDir: string) {
    fs.mkdirSync(dataDir, { recursive: true });
    const dbPath = path.join(dataDir, "memory-index.db");
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    this.ensureSchema();
  }

  private ensureSchema(): void {
    this.db.exec(CHUNK_TABLE);
    this.db.exec(FTS_TABLE);
    // Migration: add embedding column if not exists
    try {
      this.db.exec("ALTER TABLE memory_chunks ADD COLUMN embedding BLOB");
    } catch {
      // Column already exists — ignore
    }
  }

  // === Index Management ===

  indexProfile(profile: LongTermMemoryProfile, scope?: { projectId?: string; sessionId?: string }): MemoryChunk[] {
    const candidates = collectActiveMemoryCandidates(profile);
    const chunks: MemoryChunk[] = [];
    for (const candidate of candidates) {
      const chunk = this.upsertChunk({
        id: `chunk_${hashId(`${scope?.projectId ?? "global"}:${candidate.id}`)}`,
        sourceId: candidate.id,
        sourceKind: candidate.kind === "fact" ? "durable_fact" : "section",
        scope: {
          user: true,
          ...(scope?.projectId ? { projectId: scope.projectId } : {}),
          ...(scope?.sessionId ? { sessionId: scope.sessionId } : {}),
        },
        content: candidate.content,
        category: candidate.category,
        confidence: candidate.confidence,
        createdAt: candidate.createdAt ?? isoNow(),
        updatedAt: candidate.updatedAt,
        sourceRunId: candidate.sourceRunId,
        embeddingStatus: "none",
      });
      chunks.push(chunk);
    }
    return chunks;
  }

  upsertChunk(input: Omit<MemoryChunk, "embeddingStatus" | "embeddingCacheKey"> & { embeddingStatus?: MemoryChunk["embeddingStatus"]; embeddingCacheKey?: string }): MemoryChunk {
    const chunk = MemoryChunkSchema.parse(input);
    const scopeJson = JSON.stringify(chunk.scope);

    const existing = this.db.prepare("SELECT id FROM memory_chunks WHERE id = ?").get(chunk.id);
    if (existing) {
      // Remove old FTS entry
      this.db.prepare("DELETE FROM memory_chunks_fts WHERE id = ?").run(chunk.id);
      // Update content table
      this.db.prepare(`
        UPDATE memory_chunks
        SET content = ?, category = ?, confidence = ?, updatedAt = ?, embeddingStatus = ?, embeddingCacheKey = ?
        WHERE id = ?
      `).run(
        chunk.content, chunk.category ?? null, chunk.confidence,
        chunk.updatedAt ?? chunk.createdAt, chunk.embeddingStatus, chunk.embeddingCacheKey ?? null,
        chunk.id,
      );
    } else {
      this.db.prepare(`
        INSERT INTO memory_chunks (id, sourceId, sourceKind, scopeJson, content, category, confidence, createdAt, updatedAt, sourceRunId, embeddingStatus, embeddingCacheKey)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        chunk.id, chunk.sourceId, chunk.sourceKind, scopeJson, chunk.content,
        chunk.category ?? null, chunk.confidence, chunk.createdAt,
        chunk.updatedAt ?? null, chunk.sourceRunId ?? null,
        chunk.embeddingStatus, chunk.embeddingCacheKey ?? null,
      );
    }
    // Insert FTS entry
    this.db.prepare("INSERT OR REPLACE INTO memory_chunks_fts(id, content, category) VALUES (?, ?, ?)").run(
      chunk.id, chunk.content, chunk.category ?? "",
    );
    return chunk;
  }

  removeChunk(id: string): void {
    this.db.prepare("DELETE FROM memory_chunks_fts WHERE id = ?").run(id);
    this.db.prepare("DELETE FROM memory_chunks WHERE id = ?").run(id);
  }

  clearScope(scope: { projectId?: string; sessionId?: string }): void {
    if (scope.projectId) {
      this.db.prepare("DELETE FROM memory_chunks_fts WHERE id IN (SELECT id FROM memory_chunks WHERE instr(scopeJson, ?) > 0)").run(`"projectId":"${scope.projectId}"`);
      this.db.prepare("DELETE FROM memory_chunks WHERE instr(scopeJson, ?) > 0").run(`"projectId":"${scope.projectId}"`);
    }
    if (scope.sessionId) {
      this.db.prepare("DELETE FROM memory_chunks_fts WHERE id IN (SELECT id FROM memory_chunks WHERE instr(scopeJson, ?) > 0)").run(`"sessionId":"${scope.sessionId}"`);
      this.db.prepare("DELETE FROM memory_chunks WHERE instr(scopeJson, ?) > 0").run(`"sessionId":"${scope.sessionId}"`);
    }
  }

  // === Search ===

  search(request: MemorySearchRequest): MemorySearchResult[] {
    const { query, scopes, maxResults, corpora } = request;
    const lexicalEnabled = request.lexicalEnabled !== false;
    const decayEnabled = request.decayEnabled !== false;

    if (!query.trim()) {
      return [];
    }

    if (!lexicalEnabled) {
      return [];
    }

    const scopeFilter = buildScopeFilter(scopes);
    const corpusFilter = corpora && corpora.length > 0 && !corpora.includes("all")
      ? `AND sourceKind IN (${corpora.map((c) => corpusToSourceKind(c)).map((k) => `'${k}'`).join(", ")})`
      : "";

    const ftsQuery = buildFtsQuery(query);
    const now = isoNow();

    const allParams = [ftsQuery, ...scopeFilter.params, maxResults];
    const rows = this.db.prepare(`
      SELECT
        c.id, c.sourceId, c.sourceKind, c.scopeJson, c.content, c.category,
        c.confidence, c.createdAt, c.updatedAt, c.sourceRunId,
        COALESCE(c.embeddingStatus, 'none') as embeddingStatus,
        c.embeddingCacheKey,
        rank
      FROM memory_chunks_fts f
      JOIN memory_chunks c ON f.id = c.id
      WHERE memory_chunks_fts MATCH ?
      ${scopeFilter.sql}
      ${corpusFilter}
      ORDER BY rank
      LIMIT ?
    `).all(...allParams) as ChunkRow[];

    const results: MemorySearchResult[] = [];
    for (const row of rows) {
      const freshnessScore = decayEnabled ? computeFreshnessScore(row.createdAt, row.updatedAt ?? undefined, now) : 0;
      const lexicalScore = normalizeBm25Rank(row.rank, rows.length);
      const finalScore = computeFinalScore(lexicalScore, 0, freshnessScore);

      const chunk = parseChunkRow(row);

      results.push({
        chunk,
        lexicalScore,
        semanticScore: 0,
        freshnessScore,
        finalScore,
        scoreReasons: buildScoreReasons(lexicalScore, 0, freshnessScore),
      });
    }

    return results.sort((a, b) => b.finalScore - a.finalScore);
  }

  searchWithFallback(
    request: MemorySearchRequest,
    profile: LongTermMemoryProfile,
    projectProfile?: LongTermMemoryProfile,
  ): MemorySearchResult[] {
    const results = this.search(request);
    if (results.length > 0) {
      return results;
    }
    return lexicalMemoryFallback(request, profile, projectProfile);
  }

  chunkCount(scope?: { projectId?: string; sessionId?: string }): number {
    if (scope?.projectId) {
      const row = this.db.prepare(
        "SELECT COUNT(*) as cnt FROM memory_chunks WHERE instr(scopeJson, ?) > 0",
      ).get(`"projectId":"${scope.projectId}"`) as { cnt: number } | undefined;
      return row?.cnt ?? 0;
    }
    const row = this.db.prepare("SELECT COUNT(*) as cnt FROM memory_chunks").get() as { cnt: number } | undefined;
    return row?.cnt ?? 0;
  }

  // === Embedding Indexing ===

  async indexEmbeddings(provider: EmbeddingProvider): Promise<number> {
    const rows = this.db.prepare(
      "SELECT id, content, embeddingCacheKey FROM memory_chunks WHERE embeddingStatus = 'none' OR embeddingStatus = 'pending'"
    ).all() as { id: string; content: string; embeddingCacheKey: string | null }[];

    if (rows.length === 0) return 0;

    const texts = rows.map((r) => r.content.slice(0, 800));
    const cacheKey = `${provider.id}:${provider.modelId}:${provider.dimensions}`;

    // Skip chunks already embedded with same cache key
    const toEmbed = rows.filter((r) => r.embeddingCacheKey !== cacheKey);
    if (toEmbed.length === 0) {
      // Mark all as ready
      this.db.prepare("UPDATE memory_chunks SET embeddingStatus = 'ready' WHERE embeddingStatus = 'none' OR embeddingStatus = 'pending'").run();
      return 0;
    }

    const embedTexts = toEmbed.map((r) => r.content.slice(0, 800));
    const embeddings = await provider.embedTexts(embedTexts);

    const updateStmt = this.db.prepare(
      "UPDATE memory_chunks SET embedding = ?, embeddingStatus = 'ready', embeddingCacheKey = ? WHERE id = ?"
    );
    const transaction = this.db.transaction(() => {
      for (let i = 0; i < toEmbed.length; i++) {
        const row = toEmbed[i]!;
        const embedding = embeddings[i];
        if (embedding) {
          updateStmt.run(Buffer.from(new Float64Array(embedding).buffer), cacheKey, row.id);
        }
      }
    });
    transaction();

    return toEmbed.length;
  }

  // === Semantic Search ===

  async searchSemantic(
    query: string,
    provider: EmbeddingProvider,
    options?: { maxResults?: number; minScore?: number },
  ): Promise<MemorySearchResult[]> {
    const maxResults = options?.maxResults ?? 12;
    const minScore = options?.minScore ?? 0.3;
    const now = isoNow();

    const [queryEmbedding] = await provider.embedTexts([query]);
    if (!queryEmbedding) return [];

    const rows = this.db.prepare(
      "SELECT id, sourceId, sourceKind, scopeJson, content, category, confidence, createdAt, updatedAt, sourceRunId, embedding FROM memory_chunks WHERE embeddingStatus = 'ready' AND embedding IS NOT NULL"
    ).all() as (ChunkRow & { embedding: Buffer })[];

    const scored: MemorySearchResult[] = [];
    for (const row of rows) {
      const embedding = bufferToVector(row.embedding);
      const similarity = cosineSimilarity(queryEmbedding, embedding);
      if (similarity < minScore) continue;

      const freshnessScore = computeFreshnessScore(row.createdAt, row.updatedAt ?? undefined, now);
      const semanticScore = similarity;
      const finalScore = computeFinalScore(0, semanticScore, freshnessScore);

      scored.push({
        chunk: parseChunkRow(row),
        lexicalScore: 0,
        semanticScore,
        freshnessScore,
        finalScore,
        scoreReasons: buildScoreReasons(0, semanticScore, freshnessScore),
      });
    }

    return scored
      .sort((a, b) => b.finalScore - a.finalScore)
      .slice(0, maxResults);
  }

  close(): void {
    this.db.close();
  }
}

// === Embedding Provider Abstraction ===

export interface EmbeddingProvider {
  readonly id: string;
  readonly modelId: string;
  readonly dimensions: number;
  embedTexts(texts: string[]): Promise<number[][]>;
}

export interface EmbeddingCacheEntry {
  chunkId: string;
  cacheKey: string;
  dimensions: number;
  embedding: number[];
}

// === MMR Diversity ===

export function mmrRerank(
  results: MemorySearchResult[],
  lambda: number,
  maxResults: number,
  embeddingProvider?: EmbeddingProvider,
): MemorySearchResult[] {
  if (results.length <= 1 || lambda >= 1) {
    return results.slice(0, maxResults);
  }

  // Without embeddings, use content-based jaccard distance as diversity proxy
  const selected: MemorySearchResult[] = [];
  const remaining = [...results];

  while (selected.length < maxResults && remaining.length > 0) {
    let bestIdx = 0;
    let bestScore = -Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const relevance = remaining[i]!.finalScore;
      let maxSimilarity = 0;

      for (const s of selected) {
        const similarity = jaccardSimilarity(
          remaining[i]!.chunk.content,
          s.chunk.content,
        );
        maxSimilarity = Math.max(maxSimilarity, similarity);
      }

      const mmrScore = lambda * relevance - (1 - lambda) * maxSimilarity;
      if (mmrScore > bestScore) {
        bestScore = mmrScore;
        bestIdx = i;
      }
    }

    selected.push(remaining[bestIdx]!);
    remaining.splice(bestIdx, 1);
  }

  return selected;
}

function jaccardSimilarity(a: string, b: string): number {
  const tokensA = tokenize(a);
  const tokensB = tokenize(b);
  if (tokensA.size === 0 && tokensB.size === 0) return 0;

  let intersection = 0;
  for (const t of tokensA) {
    if (tokensB.has(t)) intersection += 1;
  }
  const union = tokensA.size + tokensB.size - intersection;
  return union > 0 ? intersection / union : 0;
}

// === Hybrid Search ===

export interface HybridSearchOptions {
  query: string;
  maxResults?: number;
  lexicalResults: MemorySearchResult[];
  semanticResults?: MemorySearchResult[];
  decayEnabled?: boolean;
  mmrLambda?: number;
  diversityEnabled?: boolean;
}

export function mergeHybridResults(options: HybridSearchOptions): MemorySearchResult[] {
  const { lexicalResults, semanticResults, maxResults = 12, mmrLambda = 0.7, diversityEnabled = false } = options;

  const merged = new Map<string, MemorySearchResult>();

  for (const result of lexicalResults) {
    const combined = { ...result, finalScore: computeFinalScore(result.lexicalScore, 0, result.freshnessScore) };
    merged.set(result.chunk.id, combined);
  }

  for (const sr of semanticResults ?? []) {
    const existing = merged.get(sr.chunk.id);
    if (existing) {
      existing.semanticScore = sr.semanticScore;
      existing.finalScore = computeFinalScore(existing.lexicalScore, sr.semanticScore, existing.freshnessScore);
      existing.scoreReasons = [...existing.scoreReasons, ...sr.scoreReasons.filter((r) => !existing.scoreReasons.includes(r))];
    } else {
      const combined = { ...sr, lexicalScore: 0, finalScore: computeFinalScore(0, sr.semanticScore, sr.freshnessScore) };
      merged.set(sr.chunk.id, combined);
    }
  }

  let results = [...merged.values()]
    .sort((a, b) => b.finalScore - a.finalScore);

  if (diversityEnabled && results.length > 1) {
    results = mmrRerank(results, mmrLambda, maxResults);
  }

  return results.slice(0, maxResults);
}

// === No-Index Fallback ===

export function lexicalMemoryFallback(
  request: MemorySearchRequest,
  profile: LongTermMemoryProfile,
  projectProfile?: LongTermMemoryProfile,
): MemorySearchResult[] {
  if (!request.query.trim()) return [];
  const queryTokens = tokenize(request.query);
  const globalCandidates = collectActiveMemoryCandidates(profile);
  const projectCandidates = projectProfile
    ? collectActiveMemoryCandidates(projectProfile).map((c) => ({
        ...c,
        scope: { ...c.scope, projectId: request.scopes?.projectId },
      }))
    : [];
  const allCandidates = [...globalCandidates, ...projectCandidates];

  const results: MemorySearchResult[] = [];
  for (const candidate of allCandidates) {
    if (request.scopes?.projectId && candidate.scope.projectId && candidate.scope.projectId !== request.scopes.projectId) {
      continue;
    }
    const candidateTokens = tokenize(candidate.content);
    const overlaps = [...queryTokens].filter((t) => candidateTokens.has(t));
    const lexicalEnabled = request.lexicalEnabled !== false;
    const decayEnabled = request.decayEnabled !== false;
    const lexicalScore = lexicalEnabled
      ? Math.min(1, overlaps.length * 0.1 + candidate.confidence * 0.05)
      : 0;
    const freshnessScore = decayEnabled
      ? computeFreshnessScore(candidate.createdAt ?? "", candidate.updatedAt, isoNow())
      : 0;
    const finalScore = computeFinalScore(lexicalScore, 0, freshnessScore);

    if (finalScore <= 0) continue;

    results.push({
      chunk: candidateToChunk(candidate),
      lexicalScore,
      semanticScore: 0,
      freshnessScore,
      finalScore,
      scoreReasons: buildScoreReasons(lexicalScore, 0, freshnessScore),
    });
  }

  return results
    .sort((a, b) => b.finalScore - a.finalScore)
    .slice(0, request.maxResults);
}

// === Helpers ===

interface ChunkRow {
  id: string;
  sourceId: string;
  sourceKind: string;
  scopeJson: string;
  content: string;
  category: string | null;
  confidence: number;
  createdAt: string;
  updatedAt: string | null;
  sourceRunId: string | null;
  embeddingStatus: string;
  embeddingCacheKey: string | null;
  rank: number;
}

function parseChunkRow(row: ChunkRow): MemoryChunk {
  let scope = {};
  try {
    scope = JSON.parse(row.scopeJson);
  } catch { /* keep default */ }

  return {
    id: row.id,
    sourceId: row.sourceId,
    sourceKind: row.sourceKind as MemoryChunk["sourceKind"],
    scope: scope as MemoryChunk["scope"],
    content: row.content,
    category: row.category ?? undefined,
    confidence: row.confidence,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt ?? undefined,
    sourceRunId: row.sourceRunId ?? undefined,
    embeddingStatus: row.embeddingStatus as MemoryChunk["embeddingStatus"],
    embeddingCacheKey: row.embeddingCacheKey ?? undefined,
  };
}

interface ScopeParam {
  sql: string;
  params: string[];
}

function buildScopeFilter(scopes?: MemorySearchRequest["scopes"]): ScopeParam {
  const conditions: string[] = [];
  const params: string[] = [];
  if (!scopes) return { sql: "", params: [] };
  if (scopes.projectId) {
    conditions.push("instr(c.scopeJson, ?) > 0");
    params.push(`"projectId":"${scopes.projectId}"`);
  }
  if (scopes.sessionId) {
    conditions.push("instr(c.scopeJson, ?) > 0");
    params.push(`"sessionId":"${scopes.sessionId}"`);
  }
  return {
    sql: conditions.length > 0 ? `AND (${conditions.join(" OR ")})` : "",
    params,
  };
}

function corpusToSourceKind(corpus: string): string {
  switch (corpus) {
    case "wiki": return "wiki_digest";
    case "raw": return "durable_fact";
    default: return "durable_fact";
  }
}

function buildFtsQuery(query: string): string {
  const tokens = query
    .replace(/[^\w\s一-鿿]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0)
    .slice(0, 16);
  if (tokens.length === 0) return '""';
  return tokens.join(" OR ");
}

function normalizeBm25Rank(rank: number, total: number): number {
  if (!Number.isFinite(rank) || rank <= 0) return 0;
  // Invert BM25 rank to a 0-1 score; smaller rank = better match
  return Math.max(0, Math.min(1, 1 / (1 + Math.log(1 + rank))));
}

function computeFreshnessScore(createdAt: string, updatedAt: string | undefined, now: string): number {
  const ref = updatedAt ?? createdAt;
  if (!ref) return 0;
  const then = Date.parse(ref);
  const nowMs = Date.parse(now);
  if (!Number.isFinite(then) || !Number.isFinite(nowMs)) return 0;
  const ageDays = Math.max(0, (nowMs - then) / 86_400_000);
  if (ageDays <= 14) return 0.1;
  if (ageDays <= 90) return 0.05;
  if (ageDays <= 365) return -0.05;
  return -0.1;
}

function computeFinalScore(lexical: number, semantic: number, freshness: number): number {
  return Math.max(0, Math.min(1, Number((lexical * 0.5 + semantic * 0.4 + freshness * 0.1).toFixed(4))));
}

function buildScoreReasons(lexical: number, semantic: number, freshness: number): string[] {
  const reasons: string[] = [];
  if (lexical > 0) reasons.push(`lexical:${lexical.toFixed(3)}`);
  if (semantic > 0) reasons.push(`semantic:${semantic.toFixed(3)}`);
  if (freshness > 0) reasons.push(`freshness:${freshness.toFixed(3)}`);
  if (freshness < 0) reasons.push(`staleness:${freshness.toFixed(3)}`);
  return reasons;
}

function tokenize(text: string): Set<string> {
  const tokens = text
    .toLowerCase()
    .match(/[\p{Script=Han}]|[a-z0-9_]+/gu) ?? [];
  const STOP_WORDS = new Set([
    "a", "an", "and", "are", "as", "at", "be", "by", "for", "from",
    "how", "i", "in", "is", "it", "of", "on", "or", "please", "the",
    "this", "to", "use", "what", "when", "with", "you",
  ]);
  return new Set(
    tokens.filter((t) => t.length > 1 || /[\p{Script=Han}]/u.test(t))
      .filter((t) => !STOP_WORDS.has(t)),
  );
}

function bufferToVector(buf: Buffer): number[] {
  const float64 = new Float64Array(buf.buffer, buf.byteOffset, buf.byteLength / 8);
  return Array.from(float64);
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom > 0 ? dot / denom : 0;
}

function candidateToChunk(candidate: ActiveMemoryCandidate): MemoryChunk {
  return {
    id: `chunk_fallback_${hashId(candidate.id)}`,
    sourceId: candidate.id,
    sourceKind: candidate.kind === "fact" ? "durable_fact" : "section",
    scope: {
      user: candidate.scope.user ?? true,
      ...(candidate.scope.projectId ? { projectId: candidate.scope.projectId } : {}),
      ...(candidate.scope.sessionId ? { sessionId: candidate.scope.sessionId } : {}),
      ...(candidate.scope.profileId ? { profileId: candidate.scope.profileId } : {}),
    },
    content: candidate.content,
    category: candidate.category,
    confidence: candidate.confidence,
    createdAt: candidate.createdAt ?? isoNow(),
    updatedAt: candidate.updatedAt,
    sourceRunId: candidate.sourceRunId,
    embeddingStatus: "none",
  };
}
