import { z } from "zod";
import { ActionRiskLevelSchema } from "./actions.js";
import { CoordinationPatternSchema, ResourceBudgetSchema } from "./primitives.js";

// ---------------------------------------------------------------------------
// Session Config Schemas
// ---------------------------------------------------------------------------

export const SessionConfigSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  projectId: z.string().min(1).optional(),
  defaultPattern: CoordinationPatternSchema.default("orchestrator_subagent"),
  defaultProviderId: z.string().min(1).optional(),
  defaultBudget: ResourceBudgetSchema.optional(),
  approvalMode: z.enum(["auto", "manual", "high_risk_only"]).default("high_risk_only"),
  tools: z.array(z.string().min(1)).default([]),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});
export type SessionConfig = z.infer<typeof SessionConfigSchema>;

export const ProjectConfigSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  rootPath: z.string().min(1).optional(),
  sessions: z.array(SessionConfigSchema).default([]),
  memoryNamespaces: z.array(z.string().min(1)).default([]),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});
export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;

// ---------------------------------------------------------------------------
// Approval Gate Schemas
// ---------------------------------------------------------------------------

export const ApprovalRequestSchema = z.object({
  id: z.string().min(1),
  runId: z.string().min(1),
  actionId: z.string().min(1),
  agentId: z.string().min(1).optional(),
  toolId: z.string().min(1).optional(),
  riskLevel: ActionRiskLevelSchema,
  reason: z.string().min(1),
  input: z.unknown(),
  createdAt: z.number().int().nonnegative(),
  deadlineMs: z.number().int().positive().optional(),
});
export type ApprovalRequest = z.infer<typeof ApprovalRequestSchema>;

export const ApprovalDecisionSchema = z.object({
  requestId: z.string().min(1),
  decision: z.enum(["approved", "denied", "deferred"]),
  reason: z.string().min(1).optional(),
  decidedAt: z.number().int().nonnegative(),
  decidedBy: z.enum(["operator", "auto_policy", "timeout"]).default("operator"),
});
export type ApprovalDecision = z.infer<typeof ApprovalDecisionSchema>;
