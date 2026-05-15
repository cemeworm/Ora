import { z } from "zod";

export const MemoryKindSchema = z.enum([
  "profile",
  "project",
  "session",
  "worker",
  "artifact"
]);
export type MemoryKind = z.infer<typeof MemoryKindSchema>;

export const MemoryRecordSchema = z.object({
  id: z.string().min(1),
  namespace: z.array(z.string().min(1)).min(1),
  kind: MemoryKindSchema,
  value: z.unknown(),
  sourceRunId: z.string().min(1).optional(),
  sourceActionId: z.string().min(1).optional(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative()
});
export type MemoryRecord = z.infer<typeof MemoryRecordSchema>;

export const LongTermMemorySectionSchema = z.object({
  summary: z.string().default(""),
  updatedAt: z.string().default(""),
  previousSummary: z.string().optional()
});
export type LongTermMemorySection = z.infer<typeof LongTermMemorySectionSchema>;

export const LongTermMemoryFactCategorySchema = z.enum([
  "preference",
  "knowledge",
  "context",
  "behavior",
  "goal",
  "correction"
]);
export type LongTermMemoryFactCategory = z.infer<typeof LongTermMemoryFactCategorySchema>;

export const LongTermMemoryFactSchema = z.object({
  id: z.string().min(1),
  content: z.string().min(1),
  category: LongTermMemoryFactCategorySchema.default("context"),
  confidence: z.number().min(0).max(1).default(0.5),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1).optional(),
  source: z.string().min(1).default("unknown"),
  sourceRunId: z.string().min(1).optional(),
  sourceError: z.string().min(1).optional()
});
export type LongTermMemoryFact = z.infer<typeof LongTermMemoryFactSchema>;

export const LongTermMemoryProfileSchema = z.object({
  version: z.literal("1.0").default("1.0"),
  lastUpdated: z.string().min(1),
  user: z.object({
    workContext: LongTermMemorySectionSchema.default({}),
    personalContext: LongTermMemorySectionSchema.default({}),
    topOfMind: LongTermMemorySectionSchema.default({})
  }).default({}),
  history: z.object({
    recentMonths: LongTermMemorySectionSchema.default({}),
    earlierContext: LongTermMemorySectionSchema.default({}),
    longTermBackground: LongTermMemorySectionSchema.default({})
  }).default({}),
  facts: z.array(LongTermMemoryFactSchema).default([])
});
export type LongTermMemoryProfile = z.infer<typeof LongTermMemoryProfileSchema>;

export const ActiveMemoryScopeSchema = z.object({
  user: z.boolean().optional(),
  projectId: z.string().min(1).optional(),
  sessionId: z.string().min(1).optional(),
  profileId: z.string().min(1).optional(),
  agentId: z.string().min(1).optional()
});
export type ActiveMemoryScope = z.infer<typeof ActiveMemoryScopeSchema>;

export const ActiveMemoryFreshnessSchema = z.enum(["fresh", "aging", "stale", "unknown"]);
export type ActiveMemoryFreshness = z.infer<typeof ActiveMemoryFreshnessSchema>;

export const ActiveMemoryCandidateSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["fact", "section"]),
  scope: ActiveMemoryScopeSchema.default({}),
  category: z.string().min(1),
  content: z.string().min(1),
  confidence: z.number().min(0).max(1),
  sourceRunId: z.string().min(1).optional(),
  createdAt: z.string().min(1).optional(),
  updatedAt: z.string().min(1).optional(),
  freshness: ActiveMemoryFreshnessSchema,
  score: z.number().min(0),
  scoreReasons: z.array(z.string().min(1)).default([])
});
export type ActiveMemoryCandidate = z.infer<typeof ActiveMemoryCandidateSchema>;

export const ActiveMemoryAdmissionDecisionSchema = z.object({
  status: z.enum(["USE", "NONE"]),
  mode: z.enum(["deterministic", "provider", "provider_fallback"]),
  reason: z.string().min(1),
  candidateIds: z.array(z.string().min(1)).default([]),
  selectedIds: z.array(z.string().min(1)).default([]),
  rejectedIds: z.array(z.string().min(1)).default([]),
  budget: z.object({
    maxCandidates: z.number().int().positive(),
    maxChars: z.number().int().positive(),
    renderedChars: z.number().int().nonnegative()
  }),
  warnings: z.array(z.string().min(1)).default([])
});
export type ActiveMemoryAdmissionDecision = z.infer<typeof ActiveMemoryAdmissionDecisionSchema>;

export const ActiveMemoryCardSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["fact", "section"]),
  category: z.string().min(1),
  confidence: z.number().min(0).max(1),
  sourceRunId: z.string().min(1).optional(),
  freshness: ActiveMemoryFreshnessSchema,
  content: z.string().min(1)
});
export type ActiveMemoryCard = z.infer<typeof ActiveMemoryCardSchema>;

export const ActiveMemoryContextSchema = z.object({
  decision: ActiveMemoryAdmissionDecisionSchema,
  cards: z.array(ActiveMemoryCardSchema).default([]),
  rendered: z.string().default("")
});
export type ActiveMemoryContext = z.infer<typeof ActiveMemoryContextSchema>;

// === Phase 1: Memory Corpus and Index Contracts ===

export const MemorySourceKindSchema = z.enum([
  "durable_fact",
  "section",
  "short_term_signal",
  "session_excerpt",
  "artifact_excerpt",
  "wiki_digest",
]);
export type MemorySourceKind = z.infer<typeof MemorySourceKindSchema>;

export const MemorySourceSchema = z.object({
  kind: MemorySourceKindSchema,
  id: z.string().min(1),
  scope: z.object({
    user: z.boolean().default(true),
    projectId: z.string().min(1).optional(),
    sessionId: z.string().min(1).optional(),
    profileId: z.string().min(1).optional(),
  }).default({}),
  content: z.string().min(1),
  category: z.string().min(1).optional(),
  confidence: z.number().min(0).max(1).default(0.5),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1).optional(),
  sourceRunId: z.string().min(1).optional(),
  sourceError: z.string().min(1).optional(),
  provenance: z.object({
    sourceKind: MemorySourceKindSchema,
    sourceId: z.string().min(1),
    sourceRunIds: z.array(z.string().min(1)).default([]),
    claimIds: z.array(z.string().min(1)).default([]),
  }).optional(),
});
export type MemorySource = z.infer<typeof MemorySourceSchema>;

export const MemoryChunkSchema = z.object({
  id: z.string().min(1),
  sourceId: z.string().min(1),
  sourceKind: MemorySourceKindSchema,
  scope: z.object({
    user: z.boolean().default(true),
    projectId: z.string().min(1).optional(),
    sessionId: z.string().min(1).optional(),
    profileId: z.string().min(1).optional(),
  }).default({}),
  content: z.string().min(1),
  category: z.string().min(1).optional(),
  confidence: z.number().min(0).max(1).default(0.5),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1).optional(),
  sourceRunId: z.string().min(1).optional(),
  embeddingStatus: z.enum(["none", "pending", "ready"]).default("none"),
  embeddingCacheKey: z.string().min(1).optional(),
});
export type MemoryChunk = z.infer<typeof MemoryChunkSchema>;

export const MemorySearchRequestSchema = z.object({
  query: z.string().min(1),
  corpora: z.array(z.enum(["raw", "wiki", "all"])).default(["raw"]),
  scopes: z.object({
    projectId: z.string().min(1).optional(),
    sessionId: z.string().min(1).optional(),
    profileId: z.string().min(1).optional(),
  }).optional(),
  maxResults: z.number().int().positive().default(12),
  decayEnabled: z.boolean().default(true),
  diversityEnabled: z.boolean().default(false),
  semanticEnabled: z.boolean().default(false),
  lexicalEnabled: z.boolean().default(true),
  mmrLambda: z.number().min(0).max(1).default(0.7),
});
export type MemorySearchRequest = z.infer<typeof MemorySearchRequestSchema>;

export const MemorySearchResultSchema = z.object({
  chunk: MemoryChunkSchema,
  lexicalScore: z.number().min(0).default(0),
  semanticScore: z.number().min(0).default(0),
  freshnessScore: z.number().min(0).default(0),
  finalScore: z.number().min(0).default(0),
  scoreReasons: z.array(z.string().min(1)).default([]),
});
export type MemorySearchResult = z.infer<typeof MemorySearchResultSchema>;

// === Phase 4: Short-Term Memory Journal ===

export const ShortTermSignalTypeSchema = z.enum([
  "memory_intent",
  "correction",
  "reinforcement",
  "recall_hit",
  "selected_card",
  "decision",
  "user_visible_decision",
  "session_excerpt",
]);
export type ShortTermSignalType = z.infer<typeof ShortTermSignalTypeSchema>;

export const ShortTermSignalSchema = z.object({
  id: z.string().min(1),
  runId: z.string().min(1),
  sessionId: z.string().min(1).optional(),
  type: ShortTermSignalTypeSchema,
  content: z.string().min(1),
  category: z.string().min(1).optional(),
  confidence: z.number().min(0).max(1).default(0.5),
  timestamp: z.string().min(1),
  redacted: z.boolean().default(false),
  sourcePointers: z.array(z.string().min(1)).default([]),
  metadata: z.record(z.unknown()).default({}),
});
export type ShortTermSignal = z.infer<typeof ShortTermSignalSchema>;

// === Phase 6: Memory Wiki ===

export const WikiClaimSchema = z.object({
  id: z.string().min(1),
  statement: z.string().min(1),
  confidence: z.number().min(0).max(1).default(0.5),
  sourceFactIds: z.array(z.string().min(1)).default([]),
  sourceRunIds: z.array(z.string().min(1)).default([]),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});
export type WikiClaim = z.infer<typeof WikiClaimSchema>;

export const WikiContradictionSchema = z.object({
  claimAId: z.string().min(1),
  claimBId: z.string().min(1),
  description: z.string().min(1),
});
export type WikiContradiction = z.infer<typeof WikiContradictionSchema>;

export const WikiOpenQuestionSchema = z.object({
  id: z.string().min(1),
  question: z.string().min(1),
  context: z.string().default(""),
  createdAt: z.string().min(1),
});
export type WikiOpenQuestion = z.infer<typeof WikiOpenQuestionSchema>;

export const WikiPageSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  kind: z.enum(["entity", "project", "user"]),
  claims: z.array(WikiClaimSchema).default([]),
  contradictions: z.array(WikiContradictionSchema).default([]),
  openQuestions: z.array(WikiOpenQuestionSchema).default([]),
  compiledAt: z.string().min(1),
  sourceRunIds: z.array(z.string().min(1)).default([]),
  digest: z.string().default(""),
});
export type WikiPage = z.infer<typeof WikiPageSchema>;
