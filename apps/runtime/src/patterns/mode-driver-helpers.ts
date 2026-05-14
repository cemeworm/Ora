import type { ModeNodeSpec } from "@cemeworm/shared";
import { BAG_OUTPUT_SCHEMAS } from "@cemeworm/shared";
import type { PatternExecutionContext } from "./execution-context.js";
import { asText } from "./driver-utils.js";
export { runGenericModeNode, runModeNode } from "./generic-node-executor.js";

export type ExecutionBag = Record<string, unknown>;

/**
 * Write a value into the ExecutionBag with optional schema validation.
 *
 * When a Zod schema is registered for the template, the raw text is parsed
 * as JSON and validated.  On success the parsed object is stored; on failure
 * the raw text is wrapped as { text, _degraded: true }.
 * The raw text is always preserved under `<key>_raw`.
 */
export function writeBag(
  bag: ExecutionBag,
  key: string,
  raw: string,
  template?: ModeNodeSpec["template"],
): void {
  bag[`${key}_raw`] = raw;

  const schema = template ? BAG_OUTPUT_SCHEMAS[template] : undefined;
  if (!schema) {
    bag[key] = raw;
    return;
  }

  try {
    const parsed = JSON.parse(raw);
    bag[key] = schema.parse(parsed);
  } catch {
    bag[key] = { text: raw, _degraded: true } satisfies { text: string; _degraded: true };
    console.warn(
      `[bag] schema validation failed for key "${key}" (template: ${template}), stored as degraded text`,
    );
  }
}

/** Bag keys for orchestrator-subagent pattern: decompose → research → review → synthesize. */
export interface OrchestratorSubagentBag extends ExecutionBag {
  prompt: string;
  research?: string;
  review?: string;
  build?: string;
  handoff?: string;
  plan?: string;
  isGitWorktree?: boolean;
}

/** Bag keys for generator-verifier pattern: draft → verify → decide. */
export interface GeneratorVerifierBag extends ExecutionBag {
  prompt: string;
  candidate?: string;
  verdict?: string;
  rubric?: string[];
}

/** Bag keys for agent-teams pattern: triage → build → check → handoff. */
export interface AgentTeamsBag extends ExecutionBag {
  prompt: string;
  triage?: string;
  build?: string;
  check?: string;
  handoff?: string;
}

/** Bag keys for message-bus pattern: publish → route → handle → respond. */
export interface MessageBusBag extends ExecutionBag {
  prompt: string;
  routingPlan?: string;
  correlationId?: string;
  published?: string;
  response?: string;
}

/** Bag keys for shared-state pattern: seed → contribute → converge. */
export interface SharedStateBag extends ExecutionBag {
  prompt: string;
  seed?: string;
  findings?: string;
  convergence?: string;
}

export function containsCompleteProposedPlan(value: unknown): boolean {
  return /<proposed_plan>\s*[\s\S]+?\s*<\/proposed_plan>/.test(asText(value));
}

export function finishPlanModeAfterProposedPlan(
  context: PatternExecutionContext,
  nodes: ModeNodeSpec[],
  currentIndex: number,
  totalActiveNodes: number,
): void {
  for (const remaining of nodes.slice(currentIndex + 1)) {
    context.setPlanStatus(remaining.id, "skipped");
  }
  context.setQueueSummary({
    pending: 0,
    inProgress: 0,
    completed: totalActiveNodes,
  });
}

export const COMPLEXITY_ASSESSMENT_INSTRUCTION = `
<complexity_assessment>
Analyze the task and classify its complexity:
- L0 (trivial): single file, CSS/text/config only, one-line change, no logic change
- L1 (simple): single file, logic change with clear scope
- L2 (normal): multi-file, cross-module, needs careful review
- L3 (complex): architecture change, new feature, large refactor

Output format: Level: L0|L1|L2|L3
Rationale: <one sentence>
</complexity_assessment>`;

export type ComplexityLevel = "L0" | "L1" | "L2" | "L3";

export function parseComplexityLevel(triageOutput: unknown): ComplexityLevel | null {
  const match = /<complexity_assessment>\s*Level:\s*(L[0-3])/i.exec(asText(triageOutput));
  return (match?.[1] as ComplexityLevel) ?? null;
}

export const DELEGATION_PLAN_INSTRUCTION = `
<delegation_plan>
Based on the task above, decide which subagents are needed:
- research: enabled|disabled
  If enabled, what specific area should the researcher investigate?
- review: enabled|disabled
  If enabled, what risks or gaps should the reviewer check?

Output format (one line per decision):
research: enabled|disabled
research_focus: <one sentence, only if enabled>
review: enabled|disabled
review_focus: <one sentence, only if enabled>

Simple factual tasks may not need research or review.
Complex architecture tasks likely need both.
</delegation_plan>`;

export interface DelegationPlan {
  researchEnabled: boolean;
  researchFocus?: string;
  reviewEnabled: boolean;
  reviewFocus?: string;
}

export function parseDelegationPlan(output: unknown): DelegationPlan | null {
  const text = asText(output);
  const researchMatch = /research:\s*(enabled|disabled)/i.exec(text);
  const reviewMatch = /review:\s*(enabled|disabled)/i.exec(text);
  if (!researchMatch || !reviewMatch) return null;
  const researchFocusMatch = /research_focus:\s*(.+)/i.exec(text);
  const reviewFocusMatch = /review_focus:\s*(.+)/i.exec(text);
  return {
    researchEnabled: researchMatch[1].toLowerCase() === "enabled",
    researchFocus: researchFocusMatch?.[1]?.trim(),
    reviewEnabled: reviewMatch[1].toLowerCase() === "enabled",
    reviewFocus: reviewFocusMatch?.[1]?.trim(),
  };
}
