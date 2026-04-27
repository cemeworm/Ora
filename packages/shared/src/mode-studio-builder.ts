import { z } from "zod";
import {
  CustomAgentGeneratedDraftSchema,
  CustomAgentSummarySchema,
  SkillRegistrySchema,
  ToolRegistrySchema,
} from "./capabilities.js";
import { ModeSpecSchema, ModeValidationResultSchema, ModeRuntimeAtomDefinitionSchema } from "./modes.js";
import { ProviderConfigSchema } from "./providers.js";
import { RunStatusSchema } from "./primitives.js";
import { RunHandleSchema } from "./runtime.js";

export const ModeStudioBuilderMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1),
});
export type ModeStudioBuilderMessage = z.infer<typeof ModeStudioBuilderMessageSchema>;

export const ModeStudioGuidanceStepSchema = z.enum([
  "goal",
  "topology",
  "agents",
  "style",
  "capabilities",
  "preview",
]);
export type ModeStudioGuidanceStep = z.infer<typeof ModeStudioGuidanceStepSchema>;

export const ModeStudioGuidanceChoiceSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string().min(1),
  prompt: z.string().min(1),
});
export type ModeStudioGuidanceChoice = z.infer<typeof ModeStudioGuidanceChoiceSchema>;

export const ModeStudioGuidanceSchema = z.object({
  step: ModeStudioGuidanceStepSchema,
  assistantMessage: z.string().min(1),
  choices: z.array(ModeStudioGuidanceChoiceSchema).default([]),
});
export type ModeStudioGuidance = z.infer<typeof ModeStudioGuidanceSchema>;

export const ModeStudioDraftBundleSchema = z.object({
  modeDraft: ModeSpecSchema,
  agentDrafts: z.array(CustomAgentGeneratedDraftSchema).default([]),
  guidance: ModeStudioGuidanceSchema,
  changeSummary: z.array(z.string().min(1)).default([]),
  validation: ModeValidationResultSchema,
  needsInput: z.boolean().default(false),
});
export type ModeStudioDraftBundle = z.infer<typeof ModeStudioDraftBundleSchema>;

export const ModeStudioContextResultSchema = z.object({
  modes: z.array(ModeSpecSchema),
  agents: z.array(CustomAgentSummarySchema),
  tools: ToolRegistrySchema,
  skills: SkillRegistrySchema,
  atoms: z.array(ModeRuntimeAtomDefinitionSchema),
});
export type ModeStudioContextResult = z.infer<typeof ModeStudioContextResultSchema>;

export const ModeStudioGenerateDraftParamsSchema = z.object({
  messages: z.array(ModeStudioBuilderMessageSchema).min(1),
  baseModeId: z.string().min(1).optional(),
  currentDraft: ModeSpecSchema.optional(),
  providerId: z.string().min(1).optional(),
  providerConfig: ProviderConfigSchema.optional(),
  modelRef: z.string().min(1).optional(),
});
export type ModeStudioGenerateDraftParams = z.infer<typeof ModeStudioGenerateDraftParamsSchema>;

export const ModeStudioRefineDraftParamsSchema = ModeStudioGenerateDraftParamsSchema.extend({
  draftBundle: ModeStudioDraftBundleSchema,
});
export type ModeStudioRefineDraftParams = z.infer<typeof ModeStudioRefineDraftParamsSchema>;

export const ModeStudioValidateDraftParamsSchema = z.object({
  draftBundle: ModeStudioDraftBundleSchema,
});
export type ModeStudioValidateDraftParams = z.infer<typeof ModeStudioValidateDraftParamsSchema>;

export const ModeStudioApplyDraftParamsSchema = z.object({
  draftBundle: ModeStudioDraftBundleSchema,
  updateModeId: z.string().min(1).optional(),
  saveAgentDrafts: z.boolean().default(true),
});
export type ModeStudioApplyDraftParams = z.infer<typeof ModeStudioApplyDraftParamsSchema>;

export const ModeStudioApplyDraftResultSchema = z.object({
  mode: ModeSpecSchema,
  agents: z.array(CustomAgentSummarySchema).default([]),
});
export type ModeStudioApplyDraftResult = z.infer<typeof ModeStudioApplyDraftResultSchema>;

export const ModeStudioBuilderOperationSchema = z.enum(["generate", "refine"]);
export type ModeStudioBuilderOperation = z.infer<typeof ModeStudioBuilderOperationSchema>;

export const ModeStudioStartBuilderRunParamsSchema = ModeStudioGenerateDraftParamsSchema.extend({
  operation: ModeStudioBuilderOperationSchema.default("generate"),
  draftBundle: ModeStudioDraftBundleSchema.optional(),
});
export type ModeStudioStartBuilderRunParams = z.infer<typeof ModeStudioStartBuilderRunParamsSchema>;

export const ModeStudioStartBuilderRunResultSchema = RunHandleSchema;
export type ModeStudioStartBuilderRunResult = z.infer<typeof ModeStudioStartBuilderRunResultSchema>;

export const ModeStudioBuilderResultParamsSchema = z.object({
  runId: z.string().min(1),
});
export type ModeStudioBuilderResultParams = z.infer<typeof ModeStudioBuilderResultParamsSchema>;

export const ModeStudioBuilderIssueSchema = z.object({
  field: z.string().min(1).default("general"),
  message: z.string().min(1),
});
export type ModeStudioBuilderIssue = z.infer<typeof ModeStudioBuilderIssueSchema>;

export const ModeStudioBuilderResultSchema = z.object({
  runId: z.string().min(1),
  status: RunStatusSchema,
  draftBundle: ModeStudioDraftBundleSchema.optional(),
  issues: z.array(ModeStudioBuilderIssueSchema).default([]),
  rawText: z.string().optional(),
});
export type ModeStudioBuilderResult = z.infer<typeof ModeStudioBuilderResultSchema>;
