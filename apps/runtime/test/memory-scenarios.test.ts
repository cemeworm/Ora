import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { ScenarioStore } from "../src/memory-scenarios.js";
import type { LongTermMemoryFact, ShortTermSignal } from "@cemeworm/shared";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function makeFact(overrides: Partial<LongTermMemoryFact> = {}): LongTermMemoryFact {
  return {
    id: overrides.id ?? `fact_${Math.random().toString(16).slice(2, 10)}`,
    content: overrides.content ?? "Default fact content",
    category: overrides.category ?? "context",
    confidence: overrides.confidence ?? 0.7,
    createdAt: overrides.createdAt ?? new Date().toISOString(),
    updatedAt: overrides.updatedAt,
    source: overrides.source ?? "test",
    sourceRunId: overrides.sourceRunId ?? "run_1",
  };
}

function makeSignal(overrides: Partial<ShortTermSignal> = {}): ShortTermSignal {
  return {
    id: overrides.id ?? `sig_${Math.random().toString(16).slice(2, 10)}`,
    runId: overrides.runId ?? "run_1",
    type: overrides.type ?? "memory_intent",
    content: overrides.content ?? "Signal content",
    confidence: overrides.confidence ?? 0.6,
    timestamp: overrides.timestamp ?? new Date().toISOString(),
    redacted: overrides.redacted ?? false,
    sourcePointers: overrides.sourcePointers ?? [],
    metadata: overrides.metadata ?? {},
  };
}

describe("ScenarioStore", () => {
  let store: ScenarioStore;

  beforeEach(() => {
    store = new ScenarioStore();
  });

  // ── Compilation ──────────────────────────────────────────

  it("compiles scenarios from related facts", () => {
    const facts = [
      makeFact({ id: "f1", content: "User prefers pnpm as package manager", category: "preference", confidence: 0.85, sourceRunId: "run_1" }),
      makeFact({ id: "f2", content: "User prefers pnpm for all Node.js projects", category: "preference", confidence: 0.80, sourceRunId: "run_2" }),
      makeFact({ id: "f3", content: "Project uses PostgreSQL for primary database", category: "knowledge", confidence: 0.90, sourceRunId: "run_1" }),
    ];

    const decisions = store.compileFromFacts(facts);
    expect(decisions.length).toBeGreaterThanOrEqual(1);

    const scenarios = store.list();
    expect(scenarios.length).toBeGreaterThanOrEqual(1);
    // The two pnpm facts should cluster together
    const pnpmScenario = scenarios.find((s) => s.summary.includes("pnpm"));
    expect(pnpmScenario).toBeDefined();
    if (pnpmScenario) {
      expect(pnpmScenario.category).toBe("style_preference");
      expect(pnpmScenario.sourceFactIds).toContain("f1");
      expect(pnpmScenario.sourceFactIds).toContain("f2");
      expect(pnpmScenario.sourceRunIds).toEqual(expect.arrayContaining(["run_1", "run_2"]));
    }
  });

  it("does not compile single-fact scenarios (needs >= 2)", () => {
    const facts = [
      makeFact({ id: "f1", content: "One-off fact about weather", category: "context", confidence: 0.5 }),
    ];

    const decisions = store.compileFromFacts(facts);
    expect(decisions).toHaveLength(0);
    expect(store.count()).toBe(0);
  });

  it("merges similar scenarios on recompilation", () => {
    const batch1 = [
      makeFact({ id: "a1", content: "Codebase uses React with TypeScript for UI", category: "knowledge", confidence: 0.85, sourceRunId: "run_1" }),
      makeFact({ id: "a2", content: "Codebase uses React with TypeScript patterns", category: "knowledge", confidence: 0.80, sourceRunId: "run_1" }),
    ];
    store.compileFromFacts(batch1);
    const afterFirst = store.count();

    // Second batch with similar content that also clusters internally
    const batch2 = [
      makeFact({ id: "b1", content: "UI framework uses React with TypeScript patterns", category: "knowledge", confidence: 0.88, sourceRunId: "run_2" }),
      makeFact({ id: "b2", content: "UI framework uses React with TypeScript for frontend", category: "knowledge", confidence: 0.82, sourceRunId: "run_2" }),
    ];
    store.compileFromFacts(batch2);

    // Should merge rather than create duplicate
    const decisions = store.listDecisions();
    const merges = decisions.filter((d) => d.action === "merge");
    expect(merges.length).toBeGreaterThanOrEqual(1);
  });

  it("maps fact categories to scenario categories", () => {
    const facts = [
      makeFact({ id: "g1", content: "Goal: migrate database to PostgreSQL by Q3", category: "goal", confidence: 0.9, sourceRunId: "run_1" }),
      makeFact({ id: "g2", content: "Goal: migrate database to PostgreSQL for better performance", category: "goal", confidence: 0.85, sourceRunId: "run_2" }),
    ];

    store.compileFromFacts(facts);
    const scenarios = store.list();
    const goalScenario = scenarios[0];
    expect(goalScenario?.category).toBe("goal_background");
  });

  it("links signal IDs when provided", () => {
    const signals: ShortTermSignal[] = [
      makeSignal({ id: "sig1", runId: "run_1", content: "Remember pnpm preference" }),
    ];
    const facts = [
      makeFact({ id: "f1", content: "User prefers pnpm package manager for all projects", category: "preference", confidence: 0.85, sourceRunId: "run_1" }),
      makeFact({ id: "f2", content: "User prefers pnpm package manager over npm", category: "preference", confidence: 0.80, sourceRunId: "run_1" }),
    ];

    store.compileFromFacts(facts, signals);
    const scenarios = store.list();
    const scenario = scenarios.find((s) => s.sourceFactIds.includes("f1"));
    expect(scenario).toBeDefined();
    if (scenario) {
      expect(scenario.sourceSignalIds).toContain("sig1");
    }
  });

  // ── CRUD ─────────────────────────────────────────────────

  it("upserts a new scenario", () => {
    const scenario = store.upsert({
      title: "React + TypeScript work流",
      summary: "The project prefers React with TypeScript for frontend development, using hooks and functional components.",
      category: "workflow",
      confidence: 0.85,
      sourceFactIds: ["f1", "f2"],
      sourceRunIds: ["run_1"],
    });

    expect(scenario.id).toBeTruthy();
    expect(scenario.title).toContain("React");
    expect(store.count()).toBe(1);
    expect(store.get(scenario.id)).toBeDefined();
  });

  it("upsert updates existing scenario by title hash", () => {
    const first = store.upsert({
      title: "Database conventions",
      summary: "Use PostgreSQL with connection pooling.",
      category: "constraint",
      sourceFactIds: ["f1"],
    });

    const second = store.upsert({
      title: "Database conventions",
      summary: "Use PostgreSQL 15+ with PgBouncer pooling.",
      category: "constraint",
      sourceFactIds: ["f1", "f2"],
    });

    expect(second.id).toBe(first.id);
    expect(store.count()).toBe(1);
    expect(second.summary).toContain("PgBouncer");
    // Source fact IDs should be preserved from both calls
    expect(second.sourceFactIds).toEqual(expect.arrayContaining(["f1", "f2"]));
  });

  it("lists scenarios filtered by category", () => {
    store.upsert({ title: "Workflow A", summary: "...", category: "workflow", sourceFactIds: ["f1"] });
    store.upsert({ title: "Constraint B", summary: "...", category: "constraint", sourceFactIds: ["f2"] });
    store.upsert({ title: "Workflow C", summary: "...", category: "workflow", sourceFactIds: ["f3"] });

    const workflows = store.list({ category: "workflow" });
    expect(workflows).toHaveLength(2);
    expect(workflows.every((s) => s.category === "workflow")).toBe(true);
  });

  it("lists scenarios filtered by min confidence", () => {
    store.upsert({ title: "High conf", summary: "...", category: "workflow", confidence: 0.9, sourceFactIds: ["f1"] });
    store.upsert({ title: "Low conf", summary: "...", category: "workflow", confidence: 0.3, sourceFactIds: ["f2"] });

    const high = store.list({ minConfidence: 0.7 });
    expect(high).toHaveLength(1);
    expect(high[0]?.title).toBe("High conf");
  });

  it("deletes a scenario", () => {
    const scenario = store.upsert({ title: "To delete", summary: "...", category: "project_context", sourceFactIds: ["f1"] });
    expect(store.count()).toBe(1);

    const deleted = store.delete(scenario.id);
    expect(deleted).toBe(true);
    expect(store.count()).toBe(0);
    expect(store.get(scenario.id)).toBeUndefined();
  });

  it("delete returns false for unknown id", () => {
    expect(store.delete("nonexistent")).toBe(false);
  });

  // ── Candidates ───────────────────────────────────────────

  it("listCandidates returns scenario candidates for active memory", () => {
    store.upsert({
      title: "React patterns",
      summary: "Uses React with functional components and hooks.",
      category: "workflow",
      confidence: 0.85,
      sourceFactIds: ["f1", "f2"],
      sourceRunIds: ["run_1"],
    });

    const candidates = store.listCandidates();
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.kind).toBe("scenario");
    expect(candidates[0]?.content).toContain("React patterns");
    expect(candidates[0]?.content).toContain("functional components");
  });

  // ── Traceability ─────────────────────────────────────────

  it("records compilation decisions with source IDs", () => {
    const facts = [
      makeFact({ id: "f1", content: "Use two-space indentation for all files", category: "preference", confidence: 0.8, sourceRunId: "run_1" }),
      makeFact({ id: "f2", content: "Use two-space indentation for code formatting", category: "preference", confidence: 0.75, sourceRunId: "run_2" }),
    ];

    store.compileFromFacts(facts);
    const decisions = store.listDecisions();

    expect(decisions.length).toBeGreaterThanOrEqual(1);
    const createDecision = decisions.find((d) => d.action === "create");
    expect(createDecision).toBeDefined();
    expect(createDecision?.sourceIds).toContain("f1");
    expect(createDecision?.sourceIds).toContain("f2");
  });

  it("records merge decisions when similar scenarios combined", () => {
    store.compileFromFacts([
      makeFact({ id: "a1", content: "Project uses ESLint flat configuration for linting", category: "behavior", confidence: 0.85, sourceRunId: "run_1" }),
      makeFact({ id: "a2", content: "Project uses ESLint flat configuration for code style", category: "behavior", confidence: 0.80, sourceRunId: "run_1" }),
    ]);
    expect(store.count()).toBeGreaterThanOrEqual(1);

    store.compileFromFacts([
      makeFact({ id: "b1", content: "Project uses ESLint flat configuration as standard", category: "behavior", confidence: 0.88, sourceRunId: "run_2" }),
      makeFact({ id: "b2", content: "Project uses ESLint flat configuration for all JS files", category: "behavior", confidence: 0.82, sourceRunId: "run_2" }),
    ]);

    const mergeDecisions = store.listDecisions().filter((d) => d.action === "merge");
    expect(mergeDecisions.length).toBeGreaterThanOrEqual(1);
  });

  // ── Capacity ─────────────────────────────────────────────

  it("evicts lowest confidence scenario when at capacity", () => {
    // Fill to capacity with low confidence scenarios
    for (let i = 0; i < 40; i++) {
      store.upsert({
        title: `Scenario ${i}`,
        summary: `Content for scenario ${i}`,
        category: "project_context",
        confidence: 0.3,
        sourceFactIds: [`f${i}`],
      });
    }
    expect(store.count()).toBe(40);

    // Insert a high confidence scenario — should evict lowest
    store.upsert({
      title: "High value scenario",
      summary: "Important content",
      category: "goal_background",
      confidence: 0.95,
      sourceFactIds: ["f_high"],
    });

    expect(store.count()).toBe(40);
    // The high confidence one should be there
    const scenarios = store.list();
    expect(scenarios.some((s) => s.title === "High value scenario")).toBe(true);

    const eviction = store.listDecisions().find((d) => d.action === "discard" && d.reason.includes("capacity"));
    expect(eviction).toBeDefined();
  });

  // ── Persistence ──────────────────────────────────────────

  describe("with persistence", () => {
    let dir: string;

    beforeEach(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), "ora-scenario-test-"));
    });

    afterEach(() => {
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it("persists scenarios to JSON file", () => {
      const pStore = new ScenarioStore(dir);

      pStore.upsert({
        title: "Persisted scenario",
        summary: "This should survive reload.",
        category: "workflow",
        sourceFactIds: ["f1"],
      });

      // New store from same dir loads persisted data
      const pStore2 = new ScenarioStore(dir);
      expect(pStore2.count()).toBe(1);
      const scenario = pStore2.list()[0];
      expect(scenario?.title).toBe("Persisted scenario");
    });

    it("persists compilation decisions", () => {
      const pStore = new ScenarioStore(dir);

      pStore.compileFromFacts([
        makeFact({ id: "f1", content: "User likes dark theme for editor", category: "preference", confidence: 0.85 }),
        makeFact({ id: "f2", content: "User likes dark theme for IDE display", category: "preference", confidence: 0.80 }),
      ]);

      const pStore2 = new ScenarioStore(dir);
      const decisions = pStore2.listDecisions();
      expect(decisions.length).toBeGreaterThanOrEqual(1);
    });
  });
});
