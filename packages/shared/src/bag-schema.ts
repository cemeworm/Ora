import { z } from "zod";
import { CODE_DEVELOPMENT_MODE_ID, DEEP_RESEARCH_MODE_ID } from "./primitives.js";

/**
 * Per-template output schemas for ExecutionBag entries.
 * Each schema declares the structured shape an agent of a given
 * template is expected to produce.  The raw text is always preserved
 * alongside the parsed form so downstream consumers that only need
 * the text are not broken.
 *
 * Validation is best-effort: when parsing fails the entry is stored
 * as { text: raw, _degraded: true } and the raw text is still
 * available under `<key>_raw`.
 */

// ── orchestrator_subagent ────────────────────────────────────────────

export const planOutputSchema = z.object({
  text: z.string(),
  goal: z.string().optional(),
  successCriteria: z.array(z.string()).optional(),
  steps: z.array(z.object({ id: z.string(), description: z.string() })).optional(),
  scopeBoundaries: z.array(z.string()).optional(),
  researchNeeded: z.boolean().optional(),
  reviewNeeded: z.boolean().optional(),
});

const ConfidenceSchema = z.enum(["low", "medium", "high"]);

const ResearchFindingSchema = z.object({
  claim: z.string(),
  source: z.string().optional(),
  sourceTitle: z.string().optional(),
  sourceUrl: z.string().optional(),
  excerpt: z.string().optional(),
  retrievedAt: z.string().optional(),
  sourceType: z.string().optional(),
  confidence: ConfidenceSchema.optional(),
});

const AnalysisFindingSchema = z.object({
  claim: z.string(),
  confidence: ConfidenceSchema.optional(),
  rationale: z.string().optional(),
  supportingEvidence: z.array(z.string()).optional(),
  conflictingEvidence: z.array(z.string()).optional(),
});

const GapFindingSchema = z.object({
  dimension: z.string(),
  severity: z.enum(["critical", "major", "minor"]),
  description: z.string(),
  suggestedAction: z.string().optional(),
});

const EvidenceMatrixFindingSchema = z.object({
  claim: z.string(),
  sources: z.array(z.string()).optional(),
  confidence: ConfidenceSchema.optional(),
  contradictions: z.array(z.string()).optional(),
});

const DeepResearchFindingSchema = z.object({
  claim: z.string().min(1),
  source: z.string().min(1),
  sourceTitle: z.string().min(1),
  sourceUrl: z.string().min(1),
  excerpt: z.string().min(1),
  retrievedAt: z.string().min(1),
  sourceType: z.string().min(1),
  confidence: ConfidenceSchema,
});

const DeepResearchAnalysisFindingSchema = z.object({
  claim: z.string().min(1),
  confidence: ConfidenceSchema,
  rationale: z.string().min(1),
  supportingEvidence: z.array(z.string().min(1)).min(1),
  conflictingEvidence: z.array(z.string().min(1)).optional(),
});

const DeepResearchGapSchema = z.object({
  dimension: z.string().min(1),
  severity: z.enum(["critical", "major", "minor"]),
  description: z.string().min(1),
  suggestedAction: z.string().min(1),
});

const DeepResearchEvidenceMatrixFindingSchema = z.object({
  claim: z.string().min(1),
  sources: z.array(z.string().min(1)).min(1),
  confidence: ConfidenceSchema,
  contradictions: z.array(z.string().min(1)).optional(),
});

const DeepResearchReviewFindingSchema = z.object({
  artifactId: z.string().min(1).optional(),
  severity: z.enum(["blocking", "concern", "suggestion"]),
  issue: z.string().min(1),
});

export const researchOutputSchema = z.object({
  text: z.string(),
  findings: z.array(ResearchFindingSchema).optional(),
  confidence: ConfidenceSchema.optional(),
});

export const reviewOutputSchema = z.object({
  text: z.string(),
  verdict: z.enum(["pass", "needs_fix", "blocked"]).optional(),
  reworkNodeIds: z.array(z.string()).optional(),
  acceptedArtifactIds: z.array(z.string()).optional(),
  findings: z.array(z.object({
    artifactId: z.string().optional(),
    severity: z.enum(["blocking", "concern", "suggestion"]),
    issue: z.string(),
  })).optional(),
  issues: z.array(z.string()).optional(),
  risks: z.array(z.string()).optional(),
  gaps: z.array(z.string()).optional(),
  approval: z.enum(["approved", "changes_requested"]).optional(),
});

export const synthesisOutputSchema = z.object({
  text: z.string(),
});

// ── agent_teams ──────────────────────────────────────────────────────

export const triageOutputSchema = z.object({
  text: z.string(),
  goal: z.string().optional(),
  successCriteria: z.array(z.string()).optional(),
  backlog: z.array(z.object({ id: z.string(), owner: z.string(), description: z.string() })).optional(),
  scopeBoundaries: z.array(z.string()).optional(),
  taskJournalPath: z.string().optional(),
  targetFiles: z.array(z.string()).optional(),
  verificationPlan: z.array(z.object({
    id: z.string(),
    commandOrMethod: z.string(),
    expectation: z.string(),
  })).optional(),
  riskFiles: z.array(z.string()).optional(),
  doneCriteria: z.array(z.string()).optional(),
});

export const buildOutputSchema = z.object({
  text: z.string(),
  artifacts: z.array(z.string()).optional(),
  findings: z.array(EvidenceMatrixFindingSchema).optional(),
  changedFiles: z.array(z.string()).optional(),
  commandsRun: z.array(z.object({
    command: z.string(),
    exitCode: z.number().int().optional(),
    summary: z.string(),
  })).optional(),
  verificationEvidence: z.array(z.object({
    verificationId: z.string(),
    result: z.enum(["pass", "fail", "not_run"]),
    summary: z.string(),
  })).optional(),
  assumptions: z.array(z.string()).optional(),
  followups: z.array(z.string()).optional(),
});

export const checkOutputSchema = z.object({
  text: z.string(),
  verdict: z.enum(["pass", "fail", "needs_revision"]).optional(),
  acceptedArtifactIds: z.array(z.string()).optional(),
  findings: z.array(z.object({
    artifactId: z.string().optional(),
    severity: z.enum(["blocking", "concern", "suggestion"]),
    issue: z.string(),
  })).optional(),
  issues: z.array(z.string()).optional(),
  analysis: z.array(AnalysisFindingSchema).optional(),
  gaps: z.array(GapFindingSchema).optional(),
  coverageScore: z.number().min(0).max(1).optional(),
  suggestedReworkNodeIds: z.array(z.string()).optional(),
  blockingIssues: z.array(z.object({
    artifactId: z.string().optional(),
    file: z.string().optional(),
    issue: z.string(),
    requiredFix: z.string(),
  })).optional(),
  acceptedFiles: z.array(z.string()).optional(),
  verificationGaps: z.array(z.string()).optional(),
  rejectedFiles: z.array(z.string()).optional(),
  status: z.enum(["clear", "needs_fix", "blocked"]).optional(),
  rootCauses: z.array(z.string()).optional(),
  requiredRework: z.array(z.object({
    nodeId: z.enum(["build", "review"]),
    reason: z.string(),
  })).optional(),
  diagnosticEvidence: z.array(z.object({
    commandOrMethod: z.string(),
    summary: z.string(),
  })).optional(),
  remainingRisks: z.array(z.string()).optional(),
});

export const handoffOutputSchema = z.object({
  text: z.string(),
  nextAction: z.string().optional(),
  deliveredFiles: z.array(z.string()).optional(),
  acceptedFiles: z.array(z.string()).optional(),
  taskJournalPath: z.string().optional(),
  todoScanResult: z.object({
    status: z.enum(["clean", "followup_only", "blocked"]),
    summary: z.string(),
  }).optional(),
  doneGate: z.object({
    status: z.enum(["pass", "blocked"]),
    blockers: z.array(z.string()),
  }).optional(),
  verificationSummary: z.array(z.object({
    verificationId: z.string(),
    result: z.string(),
    summary: z.string(),
  })).optional(),
  residualRisks: z.array(z.string()).optional(),
});

export const codeDevelopmentTriageOutputSchema = triageOutputSchema.extend({
  text: z.string().min(1),
  goal: z.string().min(1),
  successCriteria: z.array(z.string().min(1)).min(1),
  backlog: z.array(z.object({
    id: z.string().min(1),
    owner: z.string().min(1),
    description: z.string().min(1),
  })).min(1),
  scopeBoundaries: z.array(z.string().min(1)).min(1),
  taskJournalPath: z.string().min(1),
  targetFiles: z.array(z.string().min(1)).min(1),
  verificationPlan: z.array(z.object({
    id: z.string().min(1),
    commandOrMethod: z.string().min(1),
    expectation: z.string().min(1),
  })).min(1),
  doneCriteria: z.array(z.string().min(1)).min(1),
});

export const codeDevelopmentBuildOutputSchema = buildOutputSchema.extend({
  text: z.string().min(1),
  changedFiles: z.array(z.string().min(1)).min(1),
  verificationEvidence: z.array(z.object({
    verificationId: z.string().min(1),
    result: z.enum(["pass", "fail", "not_run"]),
    summary: z.string().min(1),
  })).min(1),
});

export const codeDevelopmentReviewOutputSchema = z.object({
  text: z.string().min(1),
  verdict: z.enum(["pass", "needs_fix", "blocked"]),
  acceptedArtifactIds: z.array(z.string().min(1)).optional(),
  findings: z.array(z.object({
    artifactId: z.string().min(1).optional(),
    severity: z.enum(["blocking", "concern", "suggestion"]),
    issue: z.string().min(1),
  })).optional(),
  blockingIssues: z.array(z.object({
    artifactId: z.string().min(1).optional(),
    file: z.string().min(1).optional(),
    issue: z.string().min(1),
    requiredFix: z.string().min(1),
  })).optional(),
  acceptedFiles: z.array(z.string().min(1)).optional(),
  verificationGaps: z.array(z.string().min(1)).optional(),
  rejectedFiles: z.array(z.string().min(1)).optional(),
}).superRefine((value, ctx) => {
  if (value.verdict === "needs_fix" && (!value.blockingIssues || value.blockingIssues.length === 0)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["blockingIssues"],
      message: "blockingIssues is required when verdict=needs_fix.",
    });
  }
});

export const codeDevelopmentDebugOutputSchema = z.object({
  text: z.string().min(1),
  status: z.enum(["clear", "needs_fix", "blocked"]),
  rootCauses: z.array(z.string().min(1)),
  requiredRework: z.array(z.object({
    nodeId: z.enum(["build", "review"]),
    reason: z.string().min(1),
  })).optional(),
  diagnosticEvidence: z.array(z.object({
    commandOrMethod: z.string().min(1),
    summary: z.string().min(1),
  })).optional(),
  remainingRisks: z.array(z.string().min(1)).optional(),
}).superRefine((value, ctx) => {
  if (value.status === "needs_fix" && (!value.requiredRework || value.requiredRework.length === 0)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["requiredRework"],
      message: "requiredRework is required when status=needs_fix.",
    });
  }
});

export const codeDevelopmentHandoffOutputSchema = handoffOutputSchema.extend({
  text: z.string().min(1),
  deliveredFiles: z.array(z.string().min(1)).min(1),
  acceptedFiles: z.array(z.string().min(1)).min(1),
  taskJournalPath: z.string().min(1),
  todoScanResult: z.object({
    status: z.enum(["clean", "followup_only", "blocked"]),
    summary: z.string().min(1),
  }),
  doneGate: z.object({
    status: z.enum(["pass", "blocked"]),
    blockers: z.array(z.string().min(1)),
  }),
  verificationSummary: z.array(z.object({
    verificationId: z.string().min(1),
    result: z.string().min(1),
    summary: z.string().min(1),
  })).min(1),
});

// ── generator_verifier ───────────────────────────────────────────────

export const draftOutputSchema = z.object({
  text: z.string(),
});

export const verifyOutputSchema = z.object({
  verdict: z.enum(["pass", "fail"]),
  rationale: z.string().optional(),
  missingRequirements: z.array(z.string()).optional(),
});

// ── message_bus ──────────────────────────────────────────────────────

export const routingPlanOutputSchema = z.object({
  text: z.string(),
  topic: z.string().optional(),
  subscriber: z.string().optional(),
});

export const findingsOutputSchema = z.object({
  text: z.string(),
  findings: z.array(z.unknown()).optional(),
});

export const responseOutputSchema = z.object({
  text: z.string(),
});

// ── shared_state ─────────────────────────────────────────────────────

export const seedOutputSchema = z.object({
  text: z.string(),
  hypothesis: z.string().optional(),
});

export const convergenceOutputSchema = z.object({
  text: z.string(),
  converged: z.boolean().optional(),
  summary: z.string().optional(),
});

// ── registry ─────────────────────────────────────────────────────────

/**
 * Maps a built-in node template to its output schema.
 * Custom templates return undefined (no schema enforcement).
 */
export const BAG_OUTPUT_SCHEMAS: Record<string, z.ZodTypeAny | undefined> = {
  // orchestrator_subagent
  decompose: planOutputSchema,
  research: researchOutputSchema,
  review: reviewOutputSchema,
  synthesize: synthesisOutputSchema,

  // agent_teams
  triage: triageOutputSchema,
  build: buildOutputSchema,
  check: checkOutputSchema,
  handoff: handoffOutputSchema,

  // generator_verifier
  draft: draftOutputSchema,
  verify: verifyOutputSchema,

  // message_bus
  route: routingPlanOutputSchema,
  handle: findingsOutputSchema,
  respond: responseOutputSchema,

  // shared_state
  seed: seedOutputSchema,
  converge: convergenceOutputSchema,
};

export const deepResearchScopeOutputSchema = planOutputSchema.extend({
  goal: z.string().min(1),
  successCriteria: z.array(z.string().min(1)).min(1),
  scopeBoundaries: z.array(z.string().min(1)).min(1),
});

export const deepResearchGatherOutputSchema = z.object({
  text: z.string().min(1),
  findings: z.array(DeepResearchFindingSchema).min(1),
  confidence: ConfidenceSchema,
});

export const deepResearchAnalyzeOutputSchema = z.object({
  text: z.string().min(1),
  analysis: z.array(DeepResearchAnalysisFindingSchema).min(1),
  issues: z.array(z.string().min(1)).optional(),
});

export const deepResearchGapAnalysisOutputSchema = z.object({
  text: z.string().min(1),
  gaps: z.array(DeepResearchGapSchema),
  coverageScore: z.number().min(0).max(1),
  suggestedReworkNodeIds: z.array(z.string().min(1)),
});

export const deepResearchCompileOutputSchema = z.object({
  text: z.string().min(1),
  findings: z.array(DeepResearchEvidenceMatrixFindingSchema).min(1),
});

export const deepResearchVerifyOutputSchema = z.object({
  text: z.string().min(1),
  verdict: z.enum(["pass", "needs_fix", "blocked"]),
  reworkNodeIds: z.array(z.string().min(1)).optional(),
  acceptedArtifactIds: z.array(z.string().min(1)).optional(),
  findings: z.array(DeepResearchReviewFindingSchema).optional(),
  issues: z.array(z.string().min(1)).optional(),
});

export const DEEP_RESEARCH_OUTPUT_SCHEMAS = {
  scope: deepResearchScopeOutputSchema,
  gather: deepResearchGatherOutputSchema,
  analyze: deepResearchAnalyzeOutputSchema,
  gap_analysis: deepResearchGapAnalysisOutputSchema,
  compile: deepResearchCompileOutputSchema,
  verify: deepResearchVerifyOutputSchema,
} as const;

export const CODE_DEVELOPMENT_OUTPUT_SCHEMAS = {
  triage: codeDevelopmentTriageOutputSchema,
  build: codeDevelopmentBuildOutputSchema,
  review: codeDevelopmentReviewOutputSchema,
  debug: codeDevelopmentDebugOutputSchema,
  handoff: codeDevelopmentHandoffOutputSchema,
} as const;

export const STRICT_MODE_STAGE_OUTPUT_SCHEMAS = {
  [CODE_DEVELOPMENT_MODE_ID]: CODE_DEVELOPMENT_OUTPUT_SCHEMAS,
  [DEEP_RESEARCH_MODE_ID]: DEEP_RESEARCH_OUTPUT_SCHEMAS,
} as const;

export function strictModeStageOutputSchema(
  modeId: string,
  outputKey: string,
): z.ZodTypeAny | undefined {
  const modeSchemas = STRICT_MODE_STAGE_OUTPUT_SCHEMAS[modeId as keyof typeof STRICT_MODE_STAGE_OUTPUT_SCHEMAS];
  if (!modeSchemas) {
    return undefined;
  }
  return modeSchemas[outputKey as keyof typeof modeSchemas];
}

export type DegradedBagEntry = { text: string; _degraded: true };
