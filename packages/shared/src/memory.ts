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
  updatedAt: z.string().default("")
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
