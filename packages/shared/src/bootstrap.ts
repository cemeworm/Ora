import { z } from "zod";
import { SkillRegistrySchema, ToolRegistrySchema } from "./capabilities.js";
import { ModeRuntimeAtomDefinitionSchema, ModeSpecSchema, PatternDefinitionSchema } from "./modes.js";
import { PackageStoreSnapshotSchema } from "./packages.js";
import { ProviderRegistrySchema } from "./providers.js";
import { ProjectSummarySchema, SessionDetailSchema, SessionSummarySchema } from "./runtime.js";

export const RuntimeBootstrapSchema = z.object({
  health: z.object({
    ok: z.boolean(),
    service: z.string().min(1),
    version: z.string().min(1),
    mode: z.enum(["runtime", "deterministic_fixture"]).default("runtime"),
    detail: z.string().min(1)
  }),
  patterns: z.array(PatternDefinitionSchema),
  modes: z.array(ModeSpecSchema),
  atoms: z.array(ModeRuntimeAtomDefinitionSchema),
  tools: ToolRegistrySchema,
  packages: PackageStoreSnapshotSchema.optional(),
  skills: SkillRegistrySchema,
  providers: ProviderRegistrySchema
});
export type RuntimeBootstrap = z.infer<typeof RuntimeBootstrapSchema>;

export const RuntimeWorkbenchBootstrapSchema = z.object({
  bootstrap: RuntimeBootstrapSchema,
  projects: z.array(ProjectSummarySchema),
  sessions: z.array(SessionSummarySchema),
  activeSessionDetail: SessionDetailSchema
});
export type RuntimeWorkbenchBootstrap = z.infer<typeof RuntimeWorkbenchBootstrapSchema>;
