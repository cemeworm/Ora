import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { LongTermMemoryProfileSchema, type LongTermMemoryProfile } from "@cemeworm/shared";
import { MemoryWikiStore } from "../src/memory-wiki.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const NOW = "2026-05-08T00:00:00.000Z";

function testProfile(facts: Array<{ id: string; content: string; category: string; confidence: number }> = []): LongTermMemoryProfile {
  return LongTermMemoryProfileSchema.parse({
    version: "1.0",
    lastUpdated: NOW,
    user: {
      workContext: { summary: "Ora work.", updatedAt: NOW },
    },
    facts: facts.map((f) => ({
      ...f,
      createdAt: NOW,
      sourceRunId: `run_${f.id}`,
      source: `run_${f.id}`,
    })),
  });
}

describe("MemoryWikiStore", () => {
  let dir: string;
  let wiki: MemoryWikiStore;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "ora-wiki-test-"));
    wiki = new MemoryWikiStore(dir);
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("compiles facts into wiki claims with provenance", () => {
    const profile = testProfile([
      { id: "fact_pnpm", content: "User prefers pnpm for package management.", category: "preference", confidence: 0.94 },
      { id: "fact_ts", content: "User prefers TypeScript strict mode.", category: "preference", confidence: 0.92 },
    ]);

    const page = wiki.compileFromProfile(profile, "user");

    expect(page.claims).toHaveLength(2);
    expect(page.claims[0]?.statement).toBe("User prefers pnpm for package management.");
    expect(page.claims[0]?.sourceFactIds).toContain("fact_pnpm");
    expect(page.kind).toBe("user");
    expect(page.digest.length).toBeGreaterThan(0);
  });

  it("links claims back to source fact and run IDs", () => {
    const profile = testProfile([
      { id: "fact_a", content: "Auth uses JWT RS256.", category: "knowledge", confidence: 0.95 },
    ]);

    const page = wiki.compileFromProfile(profile, "project");
    const claim = page.claims[0];

    expect(claim?.sourceFactIds).toContain("fact_a");
    expect(claim?.sourceRunIds).toContain("run_fact_a");
    expect(page.sourceRunIds).toContain("run_fact_a");
  });

  it("records contradiction review questions instead of auto-marking opposing claims as contradictions", () => {
    const profile = testProfile([
      { id: "fact_1", content: "User always prefers dark theme.", category: "preference", confidence: 0.85 },
      { id: "fact_2", content: "User never wants dark theme for code review.", category: "preference", confidence: 0.8 },
    ]);

    const page = wiki.compileFromProfile(profile, "user");
    expect(page.contradictions).toHaveLength(0);
    expect(page.openQuestions.length).toBeGreaterThan(0);
    expect(page.openQuestions[0]?.question).toContain("contradict");
  });

  it("preserves contradiction review questions across recompilation", () => {
    const profile = testProfile([
      { id: "fact_1", content: "User always prefers dark theme.", category: "preference", confidence: 0.85 },
      { id: "fact_2", content: "User never wants dark theme.", category: "preference", confidence: 0.8 },
    ]);

    wiki.compileFromProfile(profile, "user");
    const page2 = wiki.compileFromProfile(profile, "user");

    expect(page2.openQuestions.length).toBeGreaterThan(0);
  });

  it("caps contradiction review question generation for dense conflicting claims", () => {
    const facts = [
      ...Array.from({ length: 8 }, (_, index) => ({
        id: `fact_always_${index + 1}`,
        content: `User always prefers topic ${index + 1} for deep work.`,
        category: "preference",
        confidence: 0.99 - index * 0.01,
      })),
      ...Array.from({ length: 8 }, (_, index) => ({
        id: `fact_never_${index + 1}`,
        content: `User never prefers topic ${index + 1} for deep work.`,
        category: "preference",
        confidence: 0.91 - index * 0.01,
      })),
    ];

    const page = wiki.compileFromProfile(testProfile(facts), "user");

    expect(page.contradictions).toHaveLength(0);
    expect(page.openQuestions).toHaveLength(12);
  });

  it("searches wiki pages by keyword", () => {
    wiki.compileFromProfile(
      testProfile([
        { id: "fact_pnpm", content: "User prefers pnpm for package management.", category: "preference", confidence: 0.94 },
      ]),
      "user",
    );

    const results = wiki.search("pnpm");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.matches.some((m) => m.includes("pnpm"))).toBe(true);
  });

  it("returns empty when no wiki pages exist", () => {
    expect(wiki.listPages()).toEqual([]);
    expect(wiki.getPage("nonexistent")).toBeUndefined();
    expect(wiki.search("nothing")).toEqual([]);
  });

  it("lints pages and reports issues", () => {
    const profile = testProfile([]);
    const page = wiki.compileFromProfile(profile, "user");
    const issues = wiki.lint(page.id);
    expect(issues.some((i) => i.includes("no claims"))).toBe(true);
  });

  it("recompiles and updates existing page", () => {
    const profile1 = testProfile([
      { id: "fact_1", content: "User prefers pnpm.", category: "preference", confidence: 0.9 },
    ]);

    wiki.compileFromProfile(profile1, "user");

    const profile2 = testProfile([
      { id: "fact_1", content: "User prefers pnpm.", category: "preference", confidence: 0.9 },
      { id: "fact_2", content: "User prefers TypeScript.", category: "preference", confidence: 0.85 },
    ]);

    const page = wiki.recompile(profile2, "user");
    expect(page.claims).toHaveLength(2);
  });
});
