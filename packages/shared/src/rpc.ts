import { z } from "zod";

export const JsonRpcIdSchema = z.union([z.string(), z.number().int()]);

export const RuntimeJsonRpcMethodSchema = z.enum([
  "runtime.health",
  "runtime.bootstrap",
  "patterns.list",
  "modes.list",
  "modes.get",
  "modes.create",
  "modes.update",
  "modes.delete",
  "modes.validate",
  "modes.cloneFromPreset",
  "modeStudio.context",
  "modeStudio.generateDraft",
  "modeStudio.refineDraft",
  "modeStudio.startBuilderRun",
  "modeStudio.builderResult",
  "modeStudio.validateDraft",
  "modeStudio.applyDraft",
  "tools.list",
  "packages.list",
  "packages.active",
  "packages.buildCandidate",
  "packages.verify",
  "packages.promote",
  "packages.switch",
  "packages.rollback",
  "packages.prune",
  "skills.list",
  "skills.get",
  "skills.create",
  "skills.update",
  "skills.delete",
  "skills.checkName",
  "skills.setEnabled",
  "providers.list",
  "memory.get",
  "memory.clear",
  "agents.list",
  "agents.get",
  "agents.create",
  "agents.update",
  "agents.delete",
  "agents.checkName",
  "agents.generateDraft",
  "agents.catalog",
  "agents.updateSystemOverride",
  "agents.resetSystemOverride",
  "projects.create",
  "projects.list",
  "projects.get",
  "projects.files",
  "projects.file.read",
  "sessions.create",
  "sessions.list",
  "sessions.get",
  "sessions.archive",
  "runs.start",
  "runs.startStreaming",
  "runs.list",
  "runs.stream",
  "runs.interrupt",
  "runs.resume",
  "runs.cancel",
  "runs.state",
  "runs.trail",
  "runs.checkpoints",
  "runs.replay",
  "runs.fork",
  "runs.exportReport",
  "evaluation.datasets.import",
  "evaluation.datasets.list",
  "evaluation.datasets.get",
  "evaluation.runs.start",
  "evaluation.runs.list",
  "evaluation.runs.get",
  "evaluation.runs.stream",
  "evaluation.runs.promoteBaseline",
  "evaluation.runs.export",
  "evaluation.baselines.list",
  "evaluation.feedback.submit",
  "evaluation.feedback.list",
  "evaluation.feedback.get",
  "evaluation.feedback.update",
  "evaluation.feedback.accept",
  "evaluation.feedback.reject",
  "feedbackLoop.signals.list",
  "feedbackLoop.insights.list",
  "feedbackLoop.insights.get",
  "feedbackLoop.insights.dismiss",
  "feedbackLoop.actions.preview",
  "feedbackLoop.actions.apply",
  "feedbackLoop.rules.list",
  "feedbackLoop.rules.update"
]);
export type RuntimeJsonRpcMethod = z.infer<typeof RuntimeJsonRpcMethodSchema>;

export const JsonRpcRequestSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: JsonRpcIdSchema.optional(),
  method: RuntimeJsonRpcMethodSchema.or(z.string().min(1)),
  params: z.unknown().optional()
});
export type JsonRpcRequest = z.infer<typeof JsonRpcRequestSchema>;

export const JsonRpcErrorSchema = z.object({
  code: z.number().int(),
  message: z.string(),
  data: z.unknown().optional()
});
export type JsonRpcError = z.infer<typeof JsonRpcErrorSchema>;

export const JsonRpcSuccessResponseSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: JsonRpcIdSchema.nullable(),
  result: z.unknown()
});
export type JsonRpcSuccessResponse = z.infer<typeof JsonRpcSuccessResponseSchema>;

export const JsonRpcErrorResponseSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: JsonRpcIdSchema.nullable(),
  error: JsonRpcErrorSchema
});
export type JsonRpcErrorResponse = z.infer<typeof JsonRpcErrorResponseSchema>;

export const JsonRpcResponseSchema = z.union([
  JsonRpcSuccessResponseSchema,
  JsonRpcErrorResponseSchema
]);
export type JsonRpcResponse = z.infer<typeof JsonRpcResponseSchema>;
