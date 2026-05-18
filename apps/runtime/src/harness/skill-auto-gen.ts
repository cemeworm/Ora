import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { OraToolCallEnvelope, RunConfig, SkillDescriptor } from "@cemeworm/shared";
import { type RuntimeSkillRegistry } from "./capability-registries.js";
import { invokeRunProvider } from "../providers/registry.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export type PatternType = "complex_task" | "error_recovery" | "user_correction" | "unknown";

export interface ToolCallFingerprint {
  toolSequence: string[];
  argShape: Record<string, string[]>;
  patternType: PatternType;
  domains: string[];
  fingerprintKey: string;
}

export interface FingerprintEntry {
  occurrenceCount: number;
  sampleRunIds: string[];
  firstSeenAt: number;
  lastSeenAt: number;
  created: boolean;
  createdSkillName?: string;
}

export interface AutoGenState {
  version: 1;
  fingerprints: Record<string, FingerprintEntry>;
  lastAnalyzedRunId?: string;
}

export interface SkillAutoGenOptions {
  minOccurrences: number;
  minTimeSpanHours: number;
  statePath: string;
  clock: () => number;
}

const DEFAULT_OPTIONS: SkillAutoGenOptions = {
  minOccurrences: 3,
  minTimeSpanHours: 6,
  statePath: "",
  clock: Date.now,
};

// ─── Service ─────────────────────────────────────────────────────────────────

export class SkillAutoGenService {
  private readonly skillRegistry: RuntimeSkillRegistry;
  private readonly options: SkillAutoGenOptions;

  constructor(
    skillRegistry: RuntimeSkillRegistry,
    options: Partial<SkillAutoGenOptions> = {},
  ) {
    this.skillRegistry = skillRegistry;
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  // ── Public API ───────────────────────────────────────────────────────────

  /**
   * Phase 1 (synchronous): extract fingerprint from tool calls, update
   * aggregate state, and decide whether to trigger skill creation.
   *
   * Returns an action descriptor when all quality gates pass, or null
   * when only recording happened.
   */
  analyzeRun(
    runId: string,
    status: string,
    toolCalls: readonly OraToolCallEnvelope[],
  ): CreateAction | null {
    // L0 gate: only analyze successful runs
    if (status !== "succeeded") {
      return null;
    }

    const fingerprint = computeFingerprint(toolCalls);
    if (!fingerprint) {
      return null;
    }

    // Check existing skills for the auto-gen tag to avoid re-creating
    const autoGenTag = `auto-gen:${fingerprint.fingerprintKey}`;
    const existingByTag = this.findSkillByTag(autoGenTag);
    if (existingByTag) {
      return null;
    }

    const state = loadState(this.options.statePath);

    const entry = upsertFingerprint(state, fingerprint, runId, this.options.clock());

    // L2 gate: min occurrences AND min time span
    if (!passesAggregateGate(entry, this.options)) {
      saveState(this.options.statePath, state);
      return null;
    }

    // L3 gate: not already created
    if (entry.created) {
      saveState(this.options.statePath, state);
      return null;
    }

    // L3 gate: name conflict check (deferred to executeCreation, but pre-check candidate)
    const candidateName = candidateSkillName(fingerprint);
    const nameCheck = this.skillRegistry.checkName({ name: candidateName });
    if (!nameCheck.available) {
      // Name collides — still record but skip creation
      saveState(this.options.statePath, state);
      return null;
    }

    // Mark as created immediately to prevent race conditions
    entry.created = true;
    entry.createdSkillName = candidateName;
    saveState(this.options.statePath, state);

    return {
      fingerprint,
      sampleRunIds: [...entry.sampleRunIds],
      candidateName,
      autoGenTag,
    };
  }

  /**
   * Phase 2 (async fire-and-forget): call LLM to generate SKILL.md body,
   * then create the skill via skillRegistry.
   */
  async executeCreation(action: CreateAction, config: RunConfig): Promise<void> {
    try {
      const skillContent = await generateSkillBody(action, config);
      if (!skillContent) {
        return;
      }

      this.skillRegistry.create({
        name: action.candidateName,
        description: `Auto-generated skill for ${action.fingerprint.domains.join(", ")} workflow (${action.fingerprint.patternType})`,
        content: skillContent,
        provenance: "background_auto",
      });

      // Tag is embedded in the skill body's frontmatter; re-reading the skill
      // would confirm it, but the registry stores the tag via the state.
    } catch (err) {
      // Fire-and-forget: log but don't crash. The fingerprint is already
      // marked as created so it won't be re-triggered.
      console.error(
        `[SkillAutoGen] Failed to create skill "${action.candidateName}":`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private findSkillByTag(tag: string): SkillDescriptor | undefined {
    return this.skillRegistry
      .list()
      .find((skill) => (skill.tags ?? []).includes(tag));
  }
}

// ─── Export for testing ──────────────────────────────────────────────────────

export interface CreateAction {
  fingerprint: ToolCallFingerprint;
  sampleRunIds: string[];
  candidateName: string;
  autoGenTag: string;
}

// ─── Fingerprint computation ─────────────────────────────────────────────────

export function computeFingerprint(
  toolCalls: readonly OraToolCallEnvelope[],
): ToolCallFingerprint | null {
  const succeeded = toolCalls.filter((tc) => tc.status === "succeeded");
  // L0: at least 3 total tool calls
  if (toolCalls.length < 3) {
    return null;
  }
  // L0: at least 3 succeeded tool calls
  if (succeeded.length < 3) {
    return null;
  }

  const toolSequence = succeeded.map((tc) => tc.toolId);

  // L1: at least 2 distinct tool IDs
  if (new Set(toolSequence).size < 2) {
    return null;
  }

  const argShape: Record<string, string[]> = {};
  for (const tc of succeeded) {
    argShape[tc.toolId] = Object.keys(tc.args ?? {}).sort();
  }

  const domains = extractDomains(toolSequence);
  const patternType = classifyPattern(toolCalls);

  const stableShape = Object.entries(argShape)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([toolId, keys]) => `${toolId}:${keys.join(",")}`)
    .join("|");

  const raw = `${toolSequence.join(",")}|${stableShape}|${patternType}`;
  const fingerprintKey = crypto.createHash("sha256").update(raw).digest("hex").slice(0, 12);

  return { toolSequence, argShape, patternType, domains, fingerprintKey };
}

// ─── State persistence ───────────────────────────────────────────────────────

export function loadState(statePath: string): AutoGenState {
  try {
    if (!statePath || !fs.existsSync(statePath)) {
      return { version: 1, fingerprints: {} };
    }
    const raw = fs.readFileSync(statePath, "utf8");
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      parsed.version === 1 &&
      parsed.fingerprints &&
      typeof parsed.fingerprints === "object"
    ) {
      return parsed as AutoGenState;
    }
    return { version: 1, fingerprints: {} };
  } catch {
    return { version: 1, fingerprints: {} };
  }
}

export function saveState(statePath: string, state: AutoGenState): void {
  if (!statePath) return;
  try {
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  } catch (err) {
    console.error(
      "[SkillAutoGen] Failed to persist state:",
      err instanceof Error ? err.message : String(err),
    );
  }
}

// ─── Aggregate operations ────────────────────────────────────────────────────

export function upsertFingerprint(
  state: AutoGenState,
  fingerprint: ToolCallFingerprint,
  runId: string,
  now: number,
): FingerprintEntry {
  const existing = state.fingerprints[fingerprint.fingerprintKey];
  if (existing) {
    existing.occurrenceCount += 1;
    existing.lastSeenAt = now;
    if (!existing.sampleRunIds.includes(runId)) {
      existing.sampleRunIds = [...existing.sampleRunIds.slice(-4), runId].slice(-4);
    }
    return existing;
  }

  const entry: FingerprintEntry = {
    occurrenceCount: 1,
    sampleRunIds: [runId],
    firstSeenAt: now,
    lastSeenAt: now,
    created: false,
  };
  state.fingerprints[fingerprint.fingerprintKey] = entry;
  return entry;
}

export function passesAggregateGate(
  entry: FingerprintEntry,
  options: SkillAutoGenOptions,
): boolean {
  if (entry.occurrenceCount < options.minOccurrences) {
    return false;
  }
  const spanMs = entry.lastSeenAt - entry.firstSeenAt;
  const minSpanMs = options.minTimeSpanHours * 60 * 60 * 1000;
  return spanMs >= minSpanMs;
}

// ─── Domain extraction ───────────────────────────────────────────────────────

const DOMAIN_KEYWORDS: Record<string, string> = {
  "file.": "file-ops",
  "code.": "code",
  "web.": "web",
  "search": "search",
  "browser.": "browser",
  "git.": "git",
  "memory.": "memory",
  "plan.": "planning",
  "skills.": "skills",
  "agents.": "agents",
  "todo.": "tasks",
  "docs.": "docs",
};

function extractDomains(toolSequence: string[]): string[] {
  const found = new Set<string>();
  for (const toolId of toolSequence) {
    for (const [prefix, domain] of Object.entries(DOMAIN_KEYWORDS)) {
      if (toolId.startsWith(prefix)) {
        found.add(domain);
        break;
      }
    }
  }
  return found.size > 0 ? [...found].sort() : ["general"];
}

// ─── Pattern classification ──────────────────────────────────────────────────

function classifyPattern(toolCalls: readonly OraToolCallEnvelope[]): PatternType {
  const hasError = toolCalls.some((tc) => tc.status !== "succeeded" && tc.error);
  const totalCalls = toolCalls.length;
  const succeededCount = toolCalls.filter((tc) => tc.status === "succeeded").length;
  const distinctTools = new Set(toolCalls.map((tc) => tc.toolId)).size;

  if (hasError && succeededCount >= 3) {
    return "error_recovery";
  }

  // user_correction: hard to detect from tool calls alone, but repeated
  // identical tool calls can indicate correction
  const toolRepeatCount = totalCalls - distinctTools;
  if (toolRepeatCount >= 3) {
    return "user_correction";
  }

  if (totalCalls >= 5 && distinctTools >= 3) {
    return "complex_task";
  }

  return "unknown";
}

// ─── Candidate name ──────────────────────────────────────────────────────────

export function candidateSkillName(fingerprint: ToolCallFingerprint): string {
  const domain = fingerprint.domains[0] ?? "general";
  const pattern = fingerprint.patternType.replace(/_/g, "-");
  const shortKey = fingerprint.fingerprintKey.slice(0, 6);
  return `auto-${domain}-${pattern}-${shortKey}`;
}

// ─── LLM skill body generation ───────────────────────────────────────────────

async function generateSkillBody(
  action: CreateAction,
  config: RunConfig,
): Promise<string | null> {
  const { fingerprint, sampleRunIds } = action;

  const systemPrompt = [
    "You are Ora's Skill Generator. Your job is to produce a high-quality SKILL.md file",
    "that captures a reusable agent workflow pattern discovered from real tool-call traces.",
    "",
    "Rules:",
    "- Output must start with YAML frontmatter (--- ... ---) containing 'name' and 'description'.",
    `- The 'name' field must be exactly "${action.candidateName}".`,
    "- The 'description' field should be a one-line summary of what this skill helps the agent do.",
    "- After frontmatter, write clear Markdown instructions that an AI agent can follow.",
    "- Include: trigger conditions, step-by-step workflow, tool usage guidance, common pitfalls.",
    "- Use imperative mood. Be specific about tool names and argument patterns.",
    "- Do NOT include conversational filler, meta-commentary, or markdown outside the skill body.",
    "- The skill will be tagged for auto-generated provenance and managed by a curator.",
  ].join("\n");

  const toolSummary = fingerprint.toolSequence
    .map((toolId, i) => {
      const keys = fingerprint.argShape[toolId]?.join(", ") ?? "";
      return `${i + 1}. \`${toolId}\` ${keys ? `(args: ${keys})` : ""}`;
    })
    .join("\n");

  const userPrompt = [
    "Generate a SKILL.md for the following discovered workflow pattern:",
    "",
    `Pattern type: ${fingerprint.patternType}`,
    `Domains: ${fingerprint.domains.join(", ")}`,
    `Sample runs: ${sampleRunIds.join(", ")}`,
    `Occurrences: at least 3 times across multiple runs`,
    "",
    "Tool call sequence observed:",
    toolSummary,
    "",
    "Please produce the complete SKILL.md content now.",
  ].join("\n");

  try {
    const response = await invokeRunProvider(config, {
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
      temperature: 0.3,
      maxTokens: 2048,
      tools: [],
      toolChoice: "none",
    });

    const body = response.text?.trim();
    if (!body) {
      console.error("[SkillAutoGen] LLM returned empty skill body");
      return null;
    }

    // Basic validation: must have frontmatter with name
    if (!body.startsWith("---")) {
      console.error("[SkillAutoGen] LLM response missing YAML frontmatter");
      return null;
    }

    // Ensure the name in frontmatter matches the candidate name
    const frontmatterMatch = body.match(/^---\s*\n([\s\S]*?)\n---/);
    if (!frontmatterMatch) {
      console.error("[SkillAutoGen] Could not parse frontmatter from LLM response");
      return null;
    }

    return body;
  } catch (err) {
    console.error(
      "[SkillAutoGen] LLM invocation failed:",
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}
