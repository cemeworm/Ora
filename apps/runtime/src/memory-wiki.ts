import fs from "node:fs";
import path from "node:path";
import {
  WikiPageSchema,
  WikiClaimSchema,
  type WikiPage,
  type WikiClaim,
  type WikiContradiction,
  type WikiOpenQuestion,
  type LongTermMemoryProfile,
} from "@cemeworm/shared";

function hashId(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function isoNow(): string {
  return new Date().toISOString();
}

function isSafePageId(pageId: string): boolean {
  return pageId.length > 0 && pageId.length <= 128 && !/[\/\\]/.test(pageId) && !pageId.startsWith(".");
}

export class MemoryWikiStore {
  private readonly pagesDir: string;

  constructor(dataDir: string, projectId?: string) {
    const dir = projectId ? path.join(dataDir, "projects", projectId, "wiki") : path.join(dataDir, "wiki");
    this.pagesDir = dir;
    fs.mkdirSync(this.pagesDir, { recursive: true });
  }

  // === Page Management ===

  getPage(pageId: string): WikiPage | undefined {
    return this.readPage(pageId);
  }

  listPages(): WikiPage[] {
    const pages: WikiPage[] = [];
    try {
      const files = fs.readdirSync(this.pagesDir).filter((f) => f.endsWith(".json"));
      for (const file of files) {
        const page = this.readPage(file.replace(".json", ""));
        if (page) pages.push(page);
      }
    } catch { /* dir may not exist */ }
    return pages.sort((a, b) => b.compiledAt.localeCompare(a.compiledAt));
  }

  savePage(page: WikiPage): WikiPage {
    const parsed = WikiPageSchema.parse(page);
    const filePath = path.join(this.pagesDir, `${parsed.id}.json`);
    const tempPath = `${filePath}.${Math.random().toString(16).slice(2)}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(parsed, null, 2), "utf8");
    fs.renameSync(tempPath, filePath);
    return parsed;
  }

  private readPage(pageId: string): WikiPage | undefined {
    if (!isSafePageId(pageId)) return undefined;
    try {
      const filePath = path.join(this.pagesDir, `${pageId}.json`);
      if (!fs.existsSync(filePath)) return undefined;
      return WikiPageSchema.parse(JSON.parse(fs.readFileSync(filePath, "utf8")));
    } catch {
      return undefined;
    }
  }

  // === Compilation ===

  compileFromProfile(profile: LongTermMemoryProfile, kind: "user" | "project"): WikiPage {
    const now = isoNow();
    const pageId = kind === "user" ? "user_profile" : hashId(`project-${now}`);
    const existing = this.getPage(pageId);

    const claims = compileClaims(profile, existing?.claims ?? []);
    const contradictions = detectContradictions(claims, existing?.contradictions ?? []);
    const openQuestions = existing?.openQuestions ?? [];

    const digest = buildDigest(claims, contradictions, openQuestions);

    return this.savePage({
      id: pageId,
      title: kind === "user" ? "User Memory Profile" : "Project Memory Profile",
      kind: kind === "user" ? "user" : "project",
      claims,
      contradictions,
      openQuestions,
      compiledAt: now,
      sourceRunIds: [...new Set(claims.flatMap((c) => c.sourceRunIds))],
      digest,
    });
  }

  // === Search ===

  search(query: string): { page: WikiPage; matches: string[] }[] {
    const pages = this.listPages();
    const lowerQuery = query.toLowerCase();
    const terms = lowerQuery.split(/\s+/).filter((t) => t.length > 0);

    const results: { page: WikiPage; matches: string[] }[] = [];

    for (const page of pages) {
      const matches: string[] = [];
      for (const claim of page.claims) {
        const lowerClaim = claim.statement.toLowerCase();
        if (terms.some((t) => lowerClaim.includes(t))) {
          matches.push(claim.statement.slice(0, 120));
        }
      }
      if (page.title.toLowerCase().includes(lowerQuery)) {
        matches.unshift(`Title: ${page.title}`);
      }
      if (matches.length > 0) {
        results.push({ page, matches: [...new Set(matches)].slice(0, 5) });
      }
    }

    return results;
  }

  // === Maintenance ===

  recompile(profile: LongTermMemoryProfile, kind: "user" | "project"): WikiPage {
    return this.compileFromProfile(profile, kind);
  }

  lint(pageId: string): string[] {
    const page = this.getPage(pageId);
    if (!page) return [`Page '${pageId}' not found.`];

    const issues: string[] = [];
    if (page.claims.length === 0) {
      issues.push("Page has no claims.");
    }
    for (const claim of page.claims) {
      if (claim.sourceFactIds.length === 0) {
        issues.push(`Claim '${claim.id}' has no source fact provenance.`);
      }
    }
    if (page.contradictions.length > 0) {
      issues.push(`Page has ${page.contradictions.length} unresolved contradiction(s).`);
    }
    return issues;
  }
}

// === Compilation Helpers ===

function compileClaims(profile: LongTermMemoryProfile, existingClaims: WikiClaim[]): WikiClaim[] {
  const now = isoNow();
  const existingByKey = new Map<string, WikiClaim>();
  for (const claim of existingClaims) {
    existingByKey.set(claim.statement.toLowerCase().trim(), claim);
  }

  const claims: WikiClaim[] = [...existingClaims];
  const seen = new Set(claims.map((c) => c.statement.toLowerCase().trim()));

  for (const fact of profile.facts) {
    const key = fact.content.toLowerCase().trim();
    if (seen.has(key)) {
      // Update existing claim with new source data
      const existing = claims.find((c) => c.statement.toLowerCase().trim() === key);
      if (existing) {
        existing.confidence = Math.max(existing.confidence, fact.confidence);
        existing.sourceFactIds = [...new Set([...existing.sourceFactIds, fact.id])];
        existing.sourceRunIds = [...new Set([...existing.sourceRunIds, fact.sourceRunId ?? fact.source])];
        existing.updatedAt = now;
      }
      continue;
    }

    seen.add(key);
    claims.push(WikiClaimSchema.parse({
      id: `claim_${hashId(fact.id)}`,
      statement: fact.content,
      confidence: fact.confidence,
      sourceFactIds: [fact.id],
      sourceRunIds: [fact.sourceRunId ?? fact.source],
      createdAt: fact.createdAt,
      updatedAt: now,
    }));
  }

  return claims;
}

function detectContradictions(claims: WikiClaim[], existingContradictions: WikiContradiction[]): WikiContradiction[] {
  const results = [...existingContradictions];
  const existingPairs = new Set(results.map((c) => `${c.claimAId}:${c.claimBId}`));

  for (let i = 0; i < claims.length; i++) {
    for (let j = i + 1; j < claims.length; j++) {
      const claimA = claims[i]!;
      const claimB = claims[j]!;
      const pairKey = `${claimA.id}:${claimB.id}`;
      const reverseKey = `${claimB.id}:${claimA.id}`;

      if (existingPairs.has(pairKey) || existingPairs.has(reverseKey)) continue;
      if (!isContradictory(claimA.statement, claimB.statement)) continue;

      existingPairs.add(pairKey);
      results.push({
        claimAId: claimA.id,
        claimBId: claimB.id,
        description: `"${claimA.statement.slice(0, 100)}" vs "${claimB.statement.slice(0, 100)}"`,
      });
    }
  }
  return results;
}

function isContradictory(a: string, b: string): boolean {
  const lowerA = a.toLowerCase();
  const lowerB = b.toLowerCase();

  const negationPairs = [
    ["always", "never"],
    ["do", "don't"],
    ["should", "should not"],
    ["is", "is not"],
    ["prefer", "avoid"],
  ];

  for (const [pos, neg] of negationPairs) {
    if (lowerA.includes(pos) && lowerB.includes(neg)) return true;
    if (lowerA.includes(neg) && lowerB.includes(pos)) return true;
  }

  // Check for same topic with opposite sentiment
  const tokensA = new Set(lowerA.split(/\s+/).filter((t) => t.length > 3));
  const tokensB = new Set(lowerB.split(/\s+/).filter((t) => t.length > 3));
  const overlap = [...tokensA].filter((t) => tokensB.has(t));

  if (overlap.length >= 3) {
    const hasCorrectionA = /\b(wrong|incorrect|instead|对|不是|改用)\b/i.test(a);
    const hasCorrectionB = /\b(wrong|incorrect|instead|对|不是|改用)\b/i.test(b);
    if (hasCorrectionA || hasCorrectionB) return true;
  }

  return false;
}

function buildDigest(claims: WikiClaim[], contradictions: WikiContradiction[], openQuestions: WikiOpenQuestion[]): string {
  const lines: string[] = [];

  if (claims.length > 0) {
    const topClaims = [...claims]
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 5);
    lines.push("Top Claims:");
    for (const claim of topClaims) {
      lines.push(`- [${claim.confidence.toFixed(2)}] ${claim.statement.slice(0, 200)}`);
    }
  }

  if (contradictions.length > 0) {
    lines.push(`\n${contradictions.length} unresolved contradiction(s).`);
  }

  if (openQuestions.length > 0) {
    lines.push(`\n${openQuestions.length} open question(s).`);
  }

  return lines.join("\n");
}
