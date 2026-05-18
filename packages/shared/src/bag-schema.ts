import { z } from "zod";

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

export const researchOutputSchema = z.object({
  text: z.string(),
  findings: z.array(z.object({ claim: z.string(), source: z.string() })).optional(),
  confidence: z.enum(["low", "medium", "high"]).optional(),
});

export const reviewOutputSchema = z.object({
  text: z.string(),
  verdict: z.enum(["pass", "needs_fix", "blocked"]).optional(),
  acceptedArtifactIds: z.array(z.string()).optional(),
  findings: z.array(z.object({
    artifactId: z.string().optional(),
    severity: z.enum(["blocking", "concern", "suggestion"]),
    issue: z.string(),
  })).optional(),
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
});

export const buildOutputSchema = z.object({
  text: z.string(),
  artifacts: z.array(z.string()).optional(),
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
});

export const handoffOutputSchema = z.object({
  text: z.string(),
  nextAction: z.string().optional(),
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

export type DegradedBagEntry = { text: string; _degraded: true };
