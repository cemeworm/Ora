import { z } from "zod";

export const WidgetKindSchema = z.enum(["artifact", "todo", "feed"]);
export type WidgetKind = z.infer<typeof WidgetKindSchema>;

export const WidgetStatusSchema = z.enum(["active", "paused", "archived", "error"]);
export type WidgetStatus = z.infer<typeof WidgetStatusSchema>;

export const WidgetLayoutSchema = z.object({
  x: z.number().int().nonnegative().default(0),
  y: z.number().int().nonnegative().default(0),
  w: z.number().int().min(1).default(2),
  h: z.number().int().min(1).default(2),
  pinned: z.boolean().default(false),
});
export type WidgetLayout = z.infer<typeof WidgetLayoutSchema>;

export const WidgetDataSourceSchema = z.object({
  source: z.string().min(1),
  params: z.record(z.unknown()).default({}),
  cacheKeyStrategy: z.string().min(1).default("output-affecting-args"),
});
export type WidgetDataSource = z.infer<typeof WidgetDataSourceSchema>;

export const WidgetActionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  kind: z.enum(["refresh", "complete", "add", "edit", "open-detail", "archive", "pause", "resume", "custom"]),
  params: z.record(z.unknown()).default({}),
});
export type WidgetAction = z.infer<typeof WidgetActionSchema>;

export const WidgetScheduleSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("once"),
    at: z.number().int().nonnegative(),
    timezone: z.string().min(1).default("UTC"),
  }),
  z.object({
    kind: z.literal("rrule"),
    rrule: z.string().min(1),
    startAt: z.number().int().nonnegative().optional(),
    timezone: z.string().min(1).default("UTC"),
  }),
  z.object({
    kind: z.literal("manual"),
  }),
]);
export type WidgetSchedule = z.infer<typeof WidgetScheduleSchema>;

export const WidgetPermissionSchema = z.object({
  action: z.string().min(1),
  requiresApproval: z.boolean().default(false),
  description: z.string().min(1).optional(),
});
export type WidgetPermission = z.infer<typeof WidgetPermissionSchema>;

// Base Widget state — each kind extends this
export const WidgetStateBaseSchema = z.object({
  lastRefreshedAt: z.number().int().nonnegative().optional(),
  lastError: z.string().optional(),
  consecutiveFailures: z.number().int().nonnegative().default(0),
});
export type WidgetStateBase = z.infer<typeof WidgetStateBaseSchema>;

// Todo-specific state
export const WidgetTodoItemSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  notes: z.string().default(""),
  dueDate: z.number().int().nonnegative().optional(),
  reminderAt: z.number().int().nonnegative().optional(),
  completedAt: z.number().int().nonnegative().optional(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});
export type WidgetTodoItem = z.infer<typeof WidgetTodoItemSchema>;

export const TodoWidgetStateSchema = WidgetStateBaseSchema.extend({
  items: z.array(WidgetTodoItemSchema).default([]),
});
export type TodoWidgetState = z.infer<typeof TodoWidgetStateSchema>;

// Feed-specific state
export const FeedEntrySchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().default(""),
  url: z.string().optional(),
  publishedAt: z.number().int().nonnegative().optional(),
  metadata: z.record(z.unknown()).default({}),
});
export type FeedEntry = z.infer<typeof FeedEntrySchema>;

export const FeedWidgetStateSchema = WidgetStateBaseSchema.extend({
  entries: z.array(FeedEntrySchema).default([]),
  source: z.string().min(1),
  filters: z.array(z.string().min(1)).default([]),
  lastRefreshAt: z.number().int().nonnegative().optional(),
  lastSuccessAt: z.number().int().nonnegative().optional(),
});
export type FeedWidgetState = z.infer<typeof FeedWidgetStateSchema>;

// Artifact-specific state
export const ArtifactWidgetStateSchema = WidgetStateBaseSchema.extend({
  title: z.string().min(1),
  content: z.string().default(""),
  format: z.enum(["markdown", "text", "json"]).default("markdown"),
  sourceSessionId: z.string().min(1).optional(),
  sourceRunId: z.string().min(1).optional(),
  versions: z.array(z.object({
    content: z.string(),
    createdAt: z.number().int().nonnegative(),
    createdByRunId: z.string().min(1).optional(),
    note: z.string().default(""),
  })).default([]),
});
export type ArtifactWidgetState = z.infer<typeof ArtifactWidgetStateSchema>;

export const WidgetStateSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("artifact"), ...ArtifactWidgetStateSchema.shape }),
  z.object({ kind: z.literal("todo"), ...TodoWidgetStateSchema.shape }),
  z.object({ kind: z.literal("feed"), ...FeedWidgetStateSchema.shape }),
]);
export type WidgetState = z.infer<typeof WidgetStateSchema>;

export function defaultWidgetState(kind: WidgetKind): WidgetState {
  const base = { lastRefreshedAt: undefined, lastError: undefined, consecutiveFailures: 0 };
  switch (kind) {
    case "artifact":
      return { kind: "artifact", ...base, title: "", content: "", format: "markdown", versions: [] } as WidgetState;
    case "todo":
      return { kind: "todo", ...base, items: [] } as WidgetState;
    case "feed":
      return { kind: "feed", ...base, entries: [], source: "", filters: [], lastRefreshAt: undefined, lastSuccessAt: undefined } as WidgetState;
  }
}

// Widget Manifest
export const WidgetManifestSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1).default("default"),
  title: z.string().min(1),
  kind: WidgetKindSchema,
  status: WidgetStatusSchema.default("active"),
  layout: WidgetLayoutSchema.default({}),
  manifestVersion: z.number().int().nonnegative().default(1),
  dataSource: WidgetDataSourceSchema.optional(),
  actions: z.array(WidgetActionSchema).default([]),
  schedule: WidgetScheduleSchema.optional(),
  permissions: z.array(WidgetPermissionSchema).default([]),
  artifactIds: z.array(z.string().min(1)).default([]),
  automationIds: z.array(z.string().min(1)).default([]),
  builderSessionId: z.string().min(1).optional(),
  builderSkillId: z.string().min(1).optional(),
  componentSkillId: z.string().min(1).optional(),
  currentVersionId: z.string().min(1).optional(),
  lastRestoredVersionId: z.string().min(1).optional(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});
export type WidgetManifest = z.infer<typeof WidgetManifestSchema>;

// Widget: manifest + state
export const WidgetSchema = WidgetManifestSchema.extend({
  state: WidgetStateSchema,
  currentVersionId: z.string().min(1).optional(),
  lastRestoredVersionId: z.string().min(1).optional(),
});
export type Widget = z.infer<typeof WidgetSchema>;

// Widget version
export const WidgetVersionSchema = z.object({
  id: z.string().min(1),
  widgetId: z.string().min(1),
  version: z.number().int().nonnegative(),
  createdAt: z.number().int().nonnegative(),
  createdByRunId: z.string().min(1).optional(),
  createdBySessionId: z.string().min(1).optional(),
  summary: z.string().min(1),
  changeReason: z.string().default(""),
  manifestSnapshot: WidgetManifestSchema,
  layoutSnapshot: WidgetLayoutSchema,
  stateSchemaSnapshot: z.record(z.unknown()).default({}),
  automationBindingSnapshot: z.record(z.unknown()).default({}),
  componentSkillId: z.string().min(1).optional(),
  skillContentHash: z.string().min(1).optional(),
  migrationNote: z.string().default(""),
});
export type WidgetVersion = z.infer<typeof WidgetVersionSchema>;

// Create params
export const WidgetCreateParamsSchema = z.object({
  title: z.string().min(1),
  kind: WidgetKindSchema,
  workspaceId: z.string().min(1).default("default"),
  layout: WidgetLayoutSchema.optional(),
  dataSource: WidgetDataSourceSchema.optional(),
  actions: z.array(WidgetActionSchema).default([]),
  schedule: WidgetScheduleSchema.optional(),
  permissions: z.array(WidgetPermissionSchema).default([]),
  builderSessionId: z.string().min(1).optional(),
  builderSkillId: z.string().min(1).optional(),
  componentSkillId: z.string().min(1).optional(),
  state: WidgetStateSchema.optional(),
});
export type WidgetCreateParams = z.input<typeof WidgetCreateParamsSchema>;

// Update params
export const WidgetUpdateParamsSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).optional(),
  status: WidgetStatusSchema.optional(),
  layout: WidgetLayoutSchema.optional(),
  dataSource: WidgetDataSourceSchema.optional(),
  actions: z.array(WidgetActionSchema).optional(),
  schedule: WidgetScheduleSchema.optional(),
  permissions: z.array(WidgetPermissionSchema).optional(),
  state: WidgetStateSchema.optional(),
  componentSkillId: z.string().min(1).optional(),
});
export type WidgetUpdateParams = z.input<typeof WidgetUpdateParamsSchema>;

// Structural update creates a new version
export const WidgetStructuralUpdateParamsSchema = WidgetUpdateParamsSchema.extend({
  changeReason: z.string().default(""),
  summary: z.string().min(1).optional(),
});
export type WidgetStructuralUpdateParams = z.infer<typeof WidgetStructuralUpdateParamsSchema>;

// ID params
export const WidgetIdParamsSchema = z.object({
  id: z.string().min(1),
});
export type WidgetIdParams = z.infer<typeof WidgetIdParamsSchema>;

// List params
export const WidgetListParamsSchema = z.object({
  workspaceId: z.string().min(1).optional(),
  kind: WidgetKindSchema.optional(),
  includeArchived: z.boolean().default(false),
});
export type WidgetListParams = z.infer<typeof WidgetListParamsSchema>;

// Version list params
export const WidgetVersionListParamsSchema = z.object({
  widgetId: z.string().min(1),
});
export type WidgetVersionListParams = z.infer<typeof WidgetVersionListParamsSchema>;

// Version restore params
export const WidgetVersionRestoreParamsSchema = z.object({
  widgetId: z.string().min(1),
  versionId: z.string().min(1),
  restoreSummary: z.string().min(1).optional(),
});
export type WidgetVersionRestoreParams = z.infer<typeof WidgetVersionRestoreParamsSchema>;
