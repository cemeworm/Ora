import {
  RepoExploreRequestSchema,
  RepoExploreResponseSchema,
  RepoExploreTelemetryPayloadSchema,
  type RepoExploreEvidenceItem,
  type RepoExploreGap,
  type RepoExploreNextAction,
  type RepoExploreRequest,
  type RepoExploreResponse,
  type RepoExploreResultStatus,
} from "@cemeworm/shared";
import type { RuntimeToolDefinition } from "./capability-registries.js";
import type { ResolvedToolLimits, RuntimeToolExecutionContext } from "./runtime-tool-executor.js";
import { requireWorkspaceRoot, truncateText } from "./runtime-tool-utils.js";

type CandidateEvidence = {
  path: string;
  score: number;
  source: "path" | "grep" | "read";
  line?: number;
  text?: string;
};

const DEFAULT_EVIDENCE_BUDGET = 6;
const MAX_EVIDENCE_BUDGET = 12;
const MAX_CANDIDATE_PATHS = 200;
const DEFAULT_SCOPE_PATHS = ["."];
const STOP_WORDS = new Set([
  "the",
  "this",
  "that",
  "find",
  "where",
  "what",
  "when",
  "which",
  "with",
  "from",
  "into",
  "about",
  "there",
  "their",
  "your",
  "have",
  "needs",
  "using",
]);

export function repoExploreToolRuntimeFields(toolId: string): Partial<RuntimeToolDefinition<RuntimeToolExecutionContext>> {
  if (toolId !== "repo.explore") {
    return {};
  }
  return {
    promptExample: "{\"tool\":\"repo.explore\",\"args\":{\"goal\":\"Find where auth middleware is wired\",\"kind\":\"trace\",\"subject\":\"authMiddleware\",\"scope\":{\"includeGlobs\":[\"**/*.ts\"]}}}",
    execute: (args, context) => ({
      output: exploreRepository(RepoExploreRequestSchema.parse(args), context),
    }),
    resultPreview: (result) => repoExploreResultPreview(
      RepoExploreResponseSchema.parse((result as { output: unknown }).output)
    ),
  };
}

function exploreRepository(request: RepoExploreRequest, context: RuntimeToolExecutionContext): RepoExploreResponse {
  const startedAt = Date.now();
  const rootPath = requireWorkspaceRoot(context.workspace);
  const operations = context.operations;
  const evidenceBudget = Math.min(request.evidenceBudget ?? DEFAULT_EVIDENCE_BUDGET, MAX_EVIDENCE_BUDGET);
  const scopePaths = request.scope?.paths.length ? request.scope.paths : DEFAULT_SCOPE_PATHS;
  const includeGlobs = request.scope?.includeGlobs.length
    ? request.scope.includeGlobs
    : languageHintGlobs(request.scope?.languageHints ?? []);
  const effectiveIncludeGlobs = includeGlobs.length ? includeGlobs : ["**/*"];
  const excludePaths = new Set<string>();
  for (const scopePath of scopePaths) {
    for (const pattern of request.scope?.excludeGlobs ?? []) {
      for (const excludedPath of operations.globFiles(rootPath, pattern, scopePath)) {
        excludePaths.add(excludedPath);
      }
    }
  }

  const candidatePaths = new Set<string>();
  for (const scopePath of scopePaths) {
    for (const includeGlob of effectiveIncludeGlobs) {
      for (const filePath of operations.globFiles(rootPath, includeGlob, scopePath)) {
        if (!excludePaths.has(filePath)) {
          candidatePaths.add(filePath);
        }
        if (candidatePaths.size >= MAX_CANDIDATE_PATHS) {
          break;
        }
      }
      if (candidatePaths.size >= MAX_CANDIDATE_PATHS) {
        break;
      }
    }
    if (candidatePaths.size >= MAX_CANDIDATE_PATHS) {
      break;
    }
  }

  const searchTerms = extractSearchTerms(request);
  const candidates: CandidateEvidence[] = [];
  for (const filePath of candidatePaths) {
    const lowerPath = filePath.toLowerCase();
    let score = 0;
    if (lowerPath.includes(request.subject.toLowerCase())) {
      score += 8;
    }
    for (const term of searchTerms) {
      if (lowerPath.includes(term)) {
        score += 2;
      }
    }
    if (score > 0) {
      candidates.push({ path: filePath, score, source: "path" });
    }
  }

  for (const scopePath of scopePaths) {
    for (const includeGlob of effectiveIncludeGlobs) {
      for (const term of searchTerms.length > 0 ? searchTerms : [request.subject.toLowerCase()]) {
        const matches = operations.grepFiles(rootPath, term, {
          include: includeGlob === "**/*" ? undefined : includeGlob,
          basePath: scopePath,
          caseSensitive: false,
          maxFiles: Math.max(candidatePaths.size, 50),
          maxMatches: evidenceBudget * 6,
          maxBytes: context.limits.fileSearchMaxBytes,
        });
        for (const match of matches) {
          if (!excludePaths.has(match.path)) {
            candidates.push({
              path: match.path,
              score: term === request.subject.toLowerCase() ? 10 : 6,
              source: "grep",
              line: match.line,
              text: match.text,
            });
          }
        }
      }
    }
  }

  const ranked = rankCandidates(candidates);
  let usedFallbackReadPath = false;
  if (ranked.length === 0 && candidatePaths.size > 0 && looksLikePathHint(request.subject)) {
    for (const filePath of [...candidatePaths].slice(0, Math.min(evidenceBudget, 3))) {
      try {
        const content = operations.readFile(rootPath, filePath, context.limits.fileReadMaxBytes);
        if (content.binary || content.skippedReason) {
          continue;
        }
        const previewLine = content.content.split(/\r?\n/).find((line) =>
          searchTerms.some((term) => line.toLowerCase().includes(term))
        ) ?? content.content.split(/\r?\n/).find((line) => line.trim()) ?? "";
        if (!previewLine) {
          continue;
        }
        usedFallbackReadPath = true;
        ranked.push({
          path: filePath,
          score: 4,
          source: "read",
          line: 1,
          text: previewLine,
        });
      } catch {
        // Ignore fallback read failures and keep exploring other candidates.
      }
    }
  }

  const evidence = buildEvidence(ranked.slice(0, evidenceBudget), request);
  const relatedPaths = [...new Set(evidence.map((item) => item.path))];
  const status = decideStatus(request, evidence, candidatePaths.size);
  const gaps = buildGaps(status, request, evidence, candidatePaths.size);
  const nextActions = buildNextActions(status, relatedPaths, gaps);
  const response = RepoExploreResponseSchema.parse({
    status,
    kind: request.kind,
    summary: buildSummary(status, request, relatedPaths.length, evidence.length),
    answer: buildAnswer(status, request, evidence, relatedPaths),
    evidence,
    relatedPaths,
    gaps,
    nextActions,
    metadata: {
      telemetry: RepoExploreTelemetryPayloadSchema.parse({
        kind: request.kind,
        status,
        scopePathCount: scopePaths.length,
        scopeIncludeGlobCount: effectiveIncludeGlobs.length,
        relatedPathCount: relatedPaths.length,
        evidenceCount: evidence.length,
        gapCount: gaps.length,
        nextActionKinds: nextActions.map((action) => action.kind),
        taskIntent: context.taskIntent,
        agentId: context.currentAgentId,
        hadShellEscalationHint: nextActions.some((action) => action.kind === "preset_upgrade"),
        durationMs: Date.now() - startedAt,
        resultPreviewKind: "repo.explore",
        usedFallbackReadPath,
      }),
      candidatePathCount: candidatePaths.size,
      searchTerms,
      scopePaths,
    },
  });
  return response;
}

function looksLikePathHint(subject: string): boolean {
  return subject.includes("/") || subject.includes("\\") || subject.includes(".");
}

function languageHintGlobs(languageHints: string[]): string[] {
  const normalized = [...new Set(languageHints.map((hint) => hint.trim().toLowerCase()).filter(Boolean))];
  const globs = new Set<string>();
  for (const hint of normalized) {
    if (hint === "ts" || hint === "typescript") globs.add("**/*.ts");
    if (hint === "tsx" || hint === "react") globs.add("**/*.tsx");
    if (hint === "js" || hint === "javascript") globs.add("**/*.js");
    if (hint === "jsx") globs.add("**/*.jsx");
    if (hint === "py" || hint === "python") globs.add("**/*.py");
    if (hint === "go" || hint === "golang") globs.add("**/*.go");
    if (hint === "rust" || hint === "rs") globs.add("**/*.rs");
    if (hint === "md" || hint === "markdown") globs.add("**/*.md");
    if (hint === "json") globs.add("**/*.json");
    if (hint === "yaml" || hint === "yml") {
      globs.add("**/*.yaml");
      globs.add("**/*.yml");
    }
  }
  return [...globs];
}

function extractSearchTerms(request: RepoExploreRequest): string[] {
  const pieces = [request.subject, request.question ?? "", request.goal]
    .join(" ")
    .split(/[^a-zA-Z0-9_./-]+/)
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));
  return [...new Set([request.subject.trim().toLowerCase(), ...pieces])].slice(0, 8);
}

function rankCandidates(candidates: CandidateEvidence[]): CandidateEvidence[] {
  const deduped = new Map<string, CandidateEvidence>();
  for (const candidate of candidates) {
    const key = `${candidate.path}:${candidate.line ?? 0}:${candidate.source}:${candidate.text ?? ""}`;
    const existing = deduped.get(key);
    if (!existing || candidate.score > existing.score) {
      deduped.set(key, candidate);
    }
  }
  return [...deduped.values()].sort((left, right) =>
    right.score - left.score
    || left.path.localeCompare(right.path)
    || (left.line ?? 0) - (right.line ?? 0)
  );
}

function buildEvidence(candidates: CandidateEvidence[], request: RepoExploreRequest): RepoExploreEvidenceItem[] {
  return candidates.map((candidate, index) => {
    const snippet = candidate.text
      ? truncateText(candidate.text.trim(), 240).content
      : undefined;
    return {
      path: candidate.path,
      kind: inferEvidenceKind(candidate.path, request.kind),
      summary: candidate.source === "path"
        ? `Path match relevant to "${request.subject}".`
        : candidate.line
          ? `Matched repository evidence for "${request.subject}" at line ${candidate.line}.`
          : `Repository evidence relevant to "${request.subject}".`,
      lineStart: candidate.line,
      lineEnd: candidate.line,
      snippet,
      relevance: index === 0 ? "primary" : "supporting",
    };
  });
}

function inferEvidenceKind(filePath: string, kind: RepoExploreRequest["kind"]): RepoExploreEvidenceItem["kind"] {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".json") || lower.endsWith(".yaml") || lower.endsWith(".yml") || lower.includes("config")) {
    return "config";
  }
  if (lower.includes("test") || lower.includes("spec")) {
    return "test";
  }
  if (kind === "trace" || kind === "verify") {
    return "callsite";
  }
  if (kind === "understand" || kind === "compare") {
    return "symbol";
  }
  return "file";
}

function decideStatus(
  request: RepoExploreRequest,
  evidence: RepoExploreEvidenceItem[],
  candidatePathCount: number,
): RepoExploreResultStatus {
  if (evidence.length === 0) {
    return "insufficient_evidence";
  }
  if (
    (request.kind === "trace" || request.kind === "compare" || request.kind === "verify")
    && candidatePathCount > Math.max(evidence.length * 6, 24)
  ) {
    return "needs_escalation";
  }
  return "answered";
}

function buildGaps(
  status: RepoExploreResultStatus,
  request: RepoExploreRequest,
  evidence: RepoExploreEvidenceItem[],
  candidatePathCount: number,
): RepoExploreGap[] {
  if (status === "answered") {
    return [];
  }
  if (status === "insufficient_evidence") {
    return [{
      type: evidence.length === 0 ? "missing_signal" : "ambiguous_match",
      summary: `Current repository search did not produce enough evidence to confidently ${request.kind} "${request.subject}".`,
    }];
  }
  return [{
    type: candidatePathCount > 40 ? "scope_too_broad" : "ambiguous_match",
    summary: `Current ${request.kind} exploration for "${request.subject}" produced too many competing clues for the read-only explore surface.`,
  }];
}

function buildNextActions(
  status: RepoExploreResultStatus,
  relatedPaths: string[],
  gaps: RepoExploreGap[],
): RepoExploreNextAction[] {
  if (status === "answered") {
    return [{ kind: "none", reason: "Current repository evidence is sufficient for the next reasoning step." }];
  }
  if (status === "insufficient_evidence") {
    return relatedPaths[0]
      ? [{ kind: "file.read", target: relatedPaths[0], reason: "Read the closest candidate directly for more detail." }]
      : [{ kind: "none", reason: gaps[0]?.summary ?? "No stronger repository clue was found in the current scope." }];
  }
  return [{
    kind: "preset_upgrade",
    target: "repo_forensics",
    reason: "Escalate to a stronger repository forensics surface when broad or ambiguous evidence blocks a confident answer.",
  }];
}

function buildSummary(
  status: RepoExploreResultStatus,
  request: RepoExploreRequest,
  relatedPathCount: number,
  evidenceCount: number,
): string {
  if (status === "answered") {
    return `${request.kind} answered — ${evidenceCount} evidence items across ${relatedPathCount} paths`;
  }
  if (status === "insufficient_evidence") {
    return `${request.kind} insufficient evidence — 0 high-confidence matches for "${request.subject}"`;
  }
  return `${request.kind} needs escalation — ${relatedPathCount} paths remain ambiguous`;
}

function buildAnswer(
  status: RepoExploreResultStatus,
  request: RepoExploreRequest,
  evidence: RepoExploreEvidenceItem[],
  relatedPaths: string[],
): string {
  if (status === "answered") {
    const primary = evidence[0];
    const supporting = relatedPaths.slice(1, 4).join(", ");
    return primary
      ? [
          `Found repository evidence for ${request.kind} "${request.subject}".`,
          `Primary clue: ${primary.path}${primary.lineStart ? `:${primary.lineStart}` : ""}.`,
          supporting ? `Supporting paths: ${supporting}.` : "",
        ].filter(Boolean).join(" ")
      : `Found repository evidence for ${request.kind} "${request.subject}".`;
  }
  if (status === "insufficient_evidence") {
    return `I do not yet have enough repository evidence to confidently ${request.kind} "${request.subject}" in the current scope.`;
  }
  return `I found some clues for "${request.subject}", but the current read-only repository exploration surface is too broad or ambiguous to finish the answer reliably.`;
}

function repoExploreResultPreview(result: RepoExploreResponse) {
  return {
    kind: "repo.explore",
    summary: result.status === "answered"
      ? `${result.kind} answered — ${result.evidence.length} evidence paths`
      : `${result.kind} ${result.status.replace(/_/g, " ")}`,
      detail: {
      status: result.status,
      kind: result.kind,
      relatedPathCount: result.relatedPaths.length,
      evidenceCount: result.evidence.length,
      nextActionKinds: result.nextActions.map((action: RepoExploreNextAction) => action.kind),
    },
    preview: result.evidence.slice(0, 3).map((item: RepoExploreEvidenceItem) => ({
      path: item.path,
      summary: item.summary,
      lineStart: item.lineStart,
    })),
  };
}
