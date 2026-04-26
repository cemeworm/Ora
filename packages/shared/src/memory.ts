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
  source: z.string().min(1).default("unknown"),
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
