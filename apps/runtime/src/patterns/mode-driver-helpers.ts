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

/** Bag keys for generator-verifier pattern: research → draft → verify → decide. */
export interface GeneratorVerifierBag extends ExecutionBag {
  prompt: string;
  research?: string;
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
  checkVerdict?: AgentTeamReviewVerdict["verdict"];
  reviewIssues?: string[];
  reworkCount?: number;
  handoff?: string;
}

export interface AgentTeamReviewVerdict {
  verdict: "pass" | "needs_fix" | "blocked";
  issues: string[];
  source: "json" | "marker" | "heuristic" | "missing";
  reworkNodeIds?: string[];
  acceptedArtifactIds?: string[];
  findings?: Array<{ artifactId?: string; severity: "blocking" | "concern" | "suggestion"; issue: string }>;
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

function normalizeVerdict(value: unknown): AgentTeamReviewVerdict["verdict"] | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (["pass", "approved", "approve", "通过"].includes(normalized)) return "pass";
  if ([
    "needs_fix",
    "needs-fix",
    "needs fix",
    "needs_revision",
    "needs-revision",
    "needs revision",
    "needs_rework",
    "needs-rework",
    "needs rework",
    "changes_requested",
    "changes-requested",
    "changes requested",
    "fail",
    "failed",
    "不通过",
    "需返工",
    "失败",
  ].includes(normalized)) {
    return "needs_fix";
  }
  if (["blocked", "block", "阻塞", "卡住"].includes(normalized)) return "blocked";
  return undefined;
}

function extractIssuesFromText(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^[-*•]\s+/.test(line) || /^\d+\.\s+/.test(line))
    .map((line) => line.replace(/^([-*•]|\d+\.)\s+/, "").trim())
    .filter(Boolean)
    .slice(0, 8);
}

function extractReworkNodeIds(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const ids = value.filter((item): item is string => typeof item === "string");
    return ids.length > 0 ? ids : undefined;
  }
  return undefined;
}

function extractAcceptedArtifactIds(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const ids = value.filter((item): item is string => typeof item === "string");
    return ids.length > 0 ? ids : undefined;
  }
  return undefined;
}

function extractFindings(value: unknown): AgentTeamReviewVerdict["findings"] {
  if (!Array.isArray(value)) return undefined;
  const findings = value.filter((f): f is { artifactId?: string; severity: string; issue: string } =>
    typeof f === "object" && f !== null && typeof (f as { issue?: unknown }).issue === "string"
  ).map((f) => ({
    artifactId: typeof f.artifactId === "string" ? f.artifactId : undefined,
    severity: (["blocking", "concern", "suggestion"].includes(f.severity) ? f.severity : "concern") as "blocking" | "concern" | "suggestion",
    issue: f.issue,
  }));
  return findings.length > 0 ? findings : undefined;
}

function parseReworkLine(text: string): string[] | undefined {
  const match = /(?:^|\n)\s*(?:rework|返工)\s*[:：]\s*([^\n\r]+)/i.exec(text);
  if (!match) return undefined;
  const ids = match[1]
    .split(/[,，、\s]+/)
    .map((id) => id.trim())
    .filter(Boolean);
  return ids.length > 0 ? ids : undefined;
}

function parseAcceptedLine(text: string): string[] | undefined {
  const match = /(?:^|\n)\s*(?:accepted|已验收)\s*[:：]\s*([^\n\r]+)/i.exec(text);
  if (!match) return undefined;
  const ids = match[1]
    .split(/[,，、\s]+/)
    .map((id) => id.trim())
    .filter(Boolean);
  return ids.length > 0 ? ids : undefined;
}

export function parseAgentTeamReviewVerdict(output: unknown): AgentTeamReviewVerdict {
  if (output && typeof output === "object" && !Array.isArray(output)) {
    const obj = output as Record<string, unknown>;
    const verdict = normalizeVerdict(obj.verdict);
    if (verdict) {
      const issues = Array.isArray(obj.issues)
        ? (obj.issues as unknown[]).filter((issue): issue is string => typeof issue === "string")
        : [];
      const reworkNodeIds = extractReworkNodeIds(obj.reworkNodeIds);
      const acceptedArtifactIds = extractAcceptedArtifactIds(obj.acceptedArtifactIds);
      const findings = extractFindings(obj.findings);
      return { verdict, issues, source: "json", reworkNodeIds, acceptedArtifactIds, findings };
    }
  }

  const text = asText(output).trim();
  if (!text) {
    return { verdict: "blocked", issues: ["Reviewer produced no verdict."], source: "missing" };
  }

  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const verdict = normalizeVerdict(parsed?.verdict);
    if (verdict) {
      const issues = Array.isArray(parsed.issues)
        ? parsed.issues.filter((issue): issue is string => typeof issue === "string")
        : [];
      const reworkNodeIds = extractReworkNodeIds(parsed.reworkNodeIds);
      const acceptedArtifactIds = extractAcceptedArtifactIds(parsed.acceptedArtifactIds);
      const findings = extractFindings(parsed.findings);
      return { verdict, issues, source: "json", reworkNodeIds, acceptedArtifactIds, findings };
    }
  } catch {
    // Fall back to textual verdict parsing.
  }

  const markerMatch = /(?:^|\n)\s*(?:verdict|裁定)\s*[:：]\s*([^\n\r]+)/i.exec(text);
  if (markerMatch) {
    const verdict = normalizeVerdict(markerMatch[1]);
    if (verdict) {
      const reworkNodeIds = parseReworkLine(text);
      const acceptedArtifactIds = parseAcceptedLine(text);
      return { verdict, issues: extractIssuesFromText(text), source: "marker", reworkNodeIds, acceptedArtifactIds };
    }
  }

  if (/(needs[_\-\s]?fix|needs[_\-\s]?revision|needs[_\-\s]?rework|changes[_\-\s]?requested|需返工|不通过|阻塞|失败)/i.test(text)) {
    const verdict = /(阻塞|blocked)/i.test(text) ? "blocked" : "needs_fix";
    const reworkNodeIds = parseReworkLine(text);
    const acceptedArtifactIds = parseAcceptedLine(text);
    return { verdict, issues: extractIssuesFromText(text), source: "heuristic", reworkNodeIds, acceptedArtifactIds };
  }

  if (/(^|\n)\s*(pass|approved|通过)\b/i.test(text)) {
    return { verdict: "pass", issues: [], source: "heuristic" };
  }

  return {
    verdict: "blocked",
    issues: ["Reviewer verdict missing. Expected `Verdict: PASS | NEEDS_FIX | BLOCKED`."],
    source: "missing",
  };
}

export function parseReviewGateVerdict(output: unknown): AgentTeamReviewVerdict {
  return parseAgentTeamReviewVerdict(output);
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
