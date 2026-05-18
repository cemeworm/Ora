import { describe, expect, it } from "vitest";
import {
  traceFromCard,
  traceFromScenario,
  traceFromTaskNode,
  traceFromWikiClaim,
  type TraceSources,
} from "../src/memory-trace.js";
import type {
  ActiveMemoryCard,
  LongTermMemoryFact,
  ScenarioMemory,
  TaskEvidenceRef,
  TaskNode,
} from "@cemeworm/shared";

function makeFact(overrides: Partial<LongTermMemoryFact> = {}): LongTermMemoryFact {
  return {
    id: overrides.id ?? "fact_test",
    content: overrides.content ?? "Test fact",
    category: overrides.category ?? "preference",
    confidence: overrides.confidence ?? 0.8,
    createdAt: overrides.createdAt ?? new Date().toISOString(),
    source: overrides.source ?? "test",
    sourceRunId: overrides.sourceRunId ?? "run_1",
  };
}

describe("MemoryTraceService", () => {
  // ── traceFromCard ───────────────────────────────────────

  it("traces fact card back to source fact and run", () => {
    const fact = makeFact({ id: "fact_1", content: "Use pnpm", sourceRunId: "run_1" });
    const card: ActiveMemoryCard = {
      id: "fact_1",
      kind: "fact",
      category: "preference",
      confidence: 0.85,
      sourceRunId: "run_1",
      freshness: "fresh",
      content: "Use pnpm",
    };
    const sources: TraceSources = { facts: [fact] };

    const chain = traceFromCard(card, sources);
    expect(chain.rootId).toBe("fact_1");
    expect(chain.rootKind).toBe("active_memory_card");

    const factStep = chain.steps.find((s) => s.kind === "fact");
    expect(factStep).toBeDefined();
    expect(factStep?.id).toBe("fact_1");

    const runStep = chain.steps.find((s) => s.kind === "run");
    expect(runStep).toBeDefined();
    expect(runStep?.id).toBe("run_1");
  });

  it("traces scenario card back to scenario → facts → signals", () => {
    const fact1 = makeFact({ id: "f1", content: "Use React", sourceRunId: "run_1" });
    const fact2 = makeFact({ id: "f2", content: "Use TypeScript", sourceRunId: "run_2" });
    const scenario: ScenarioMemory = {
      id: "scenario_1",
      title: "React + TypeScript workflow",
      summary: "The project uses React with TypeScript",
      category: "workflow",
      confidence: 0.85,
      sourceFactIds: ["f1", "f2"],
      sourceSignalIds: [],
      sourceRunIds: ["run_1", "run_2"],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const card: ActiveMemoryCard = {
      id: "scenario_1",
      kind: "scenario",
      category: "workflow",
      confidence: 0.85,
      freshness: "fresh",
      content: "React + TypeScript workflow",
    };
    const sources: TraceSources = { facts: [fact1, fact2], scenarios: [scenario] };

    const chain = traceFromCard(card, sources);

    const scenarioStep = chain.steps.find((s) => s.kind === "scenario");
    expect(scenarioStep).toBeDefined();

    const factSteps = chain.steps.filter((s) => s.kind === "fact");
    expect(factSteps).toHaveLength(2);
    expect(factSteps.map((s) => s.id).sort()).toEqual(["f1", "f2"]);

    const runSteps = chain.steps.filter((s) => s.kind === "run");
    expect(runSteps.map((s) => s.id).sort()).toEqual(["run_1", "run_2"]);
  });

  it("traces section card without source fact (first step only)", () => {
    const card: ActiveMemoryCard = {
      id: "section:user.workContext",
      kind: "section",
      category: "work_context",
      confidence: 0.72,
      freshness: "fresh",
      content: "Works as a full-stack developer",
    };
    const sources: TraceSources = {};

    const chain = traceFromCard(card, sources);
    expect(chain.rootId).toBe("section:user.workContext");
    // Section cards don't trace to facts
    expect(chain.steps.filter((s) => s.kind === "fact")).toHaveLength(0);
    expect(chain.steps.some((s) => s.kind === "active_memory_card")).toBe(true);
  });

  // ── traceFromScenario ───────────────────────────────────

  it("traces scenario to facts and compilation decisions", () => {
    const fact = makeFact({ id: "f1", content: "Uses two-space indent", sourceRunId: "run_1" });
    const scenario: ScenarioMemory = {
      id: "sc_1",
      title: "Code style conventions",
      summary: "Two-space indentation preferred",
      category: "style_preference",
      confidence: 0.80,
      sourceFactIds: ["f1"],
      sourceSignalIds: [],
      sourceRunIds: ["run_1"],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const sources: TraceSources = {
      facts: [fact],
      compilationDecisions: [{
        scenarioId: "sc_1",
        action: "create",
        reason: "Compiled from 2 facts in category style_preference",
        sourceIds: ["f1"],
        mergedFromScenarioIds: [],
        decidedAt: new Date().toISOString(),
      }],
    };

    const chain = traceFromScenario(scenario, sources);

    expect(chain.rootKind).toBe("scenario");
    const decisionStep = chain.steps.find((s) => s.label === "Compilation: create");
    expect(decisionStep).toBeDefined();
    expect(chain.steps.some((s) => s.kind === "fact")).toBe(true);
  });

  // ── traceFromTaskNode ───────────────────────────────────

  it("traces task node to evidence refs", () => {
    const evidenceRef: TaskEvidenceRef = {
      id: "tev_001",
      runId: "run_1",
      sourceKind: "error_log",
      sourceActionId: "action_5",
      summary: "npm install failed with EACCES",
      byteLength: 2400,
      createdAt: new Date().toISOString(),
    };
    const node: TaskNode = {
      id: "tn_001",
      runId: "run_1",
      kind: "failure_recovery",
      label: "Retry npm install",
      summary: "Installation failed due to permissions",
      status: "failed",
      evidenceRefIds: ["tev_001"],
      createdAt: new Date().toISOString(),
    };

    const chain = traceFromTaskNode(node, [evidenceRef]);

    expect(chain.rootKind).toBe("task_node");
    const evidenceStep = chain.steps.find((s) => s.kind === "evidence_ref");
    expect(evidenceStep).toBeDefined();
    expect(evidenceStep?.id).toBe("tev_001");
    expect(evidenceStep?.summary).toContain("EACCES");

    const runStep = chain.steps.find((s) => s.kind === "run");
    expect(runStep?.id).toBe("run_1");
  });

  it("task node with parent shows parent relationship", () => {
    const node: TaskNode = {
      id: "tn_child",
      runId: "run_1",
      kind: "tool_operation",
      label: "Add JWT middleware",
      status: "done",
      parentNodeId: "tn_parent",
      evidenceRefIds: [],
      createdAt: new Date().toISOString(),
    };

    const chain = traceFromTaskNode(node, []);
    const nodeStep = chain.steps.find((s) => s.kind === "task_node");
    expect(nodeStep?.parentIds).toContain("tn_parent");
  });

  it("task node without evidence refs traces only to run", () => {
    const node: TaskNode = {
      id: "tn_simple",
      runId: "run_2",
      kind: "decision",
      label: "Choose database",
      status: "done",
      evidenceRefIds: [],
      createdAt: new Date().toISOString(),
    };

    const chain = traceFromTaskNode(node, []);
    expect(chain.steps.filter((s) => s.kind === "evidence_ref")).toHaveLength(0);
    expect(chain.steps.some((s) => s.kind === "run")).toBe(true);
  });

  // ── traceFromWikiClaim ──────────────────────────────────

  it("traces wiki claim to source facts and runs", () => {
    const fact = makeFact({ id: "f_wiki", content: "PostgreSQL is primary DB", sourceRunId: "run_5" });
    const claim = {
      id: "claim_1",
      statement: "PostgreSQL is the primary database",
      sourceFactIds: ["f_wiki"],
      sourceRunIds: ["run_5"],
    };
    const sources: TraceSources = { facts: [fact] };

    const chain = traceFromWikiClaim(claim, sources);

    expect(chain.rootKind).toBe("wiki_claim");
    const factStep = chain.steps.find((s) => s.kind === "fact");
    expect(factStep?.id).toBe("f_wiki");
    const runStep = chain.steps.find((s) => s.kind === "run");
    expect(runStep?.id).toBe("run_5");
  });

  // ── Trace summary ────────────────────────────────────────

  it("generates meaningful summary from steps", () => {
    const fact = makeFact({ id: "f1", content: "Test", sourceRunId: "run_1" });
    const card: ActiveMemoryCard = {
      id: "f1",
      kind: "fact",
      category: "preference",
      confidence: 0.8,
      sourceRunId: "run_1",
      freshness: "fresh",
      content: "Test",
    };

    const chain = traceFromCard(card, { facts: [fact] });
    expect(chain.summary).toBeTruthy();
    expect(chain.summary).toContain("fact");
    expect(chain.summary).toContain("run");
  });

  // ── Empty sources ────────────────────────────────────────

  it("handles missing sources gracefully", () => {
    const card: ActiveMemoryCard = {
      id: "unknown_fact",
      kind: "fact",
      category: "context",
      confidence: 0.5,
      freshness: "fresh",
      content: "Some content",
    };

    // No sources provided
    const chain = traceFromCard(card, {});
    expect(chain.steps.length).toBe(1); // card step only
    expect(chain.rootId).toBe("unknown_fact");
  });

  it("traceFromScenario with no matching facts still produces chain", () => {
    const scenario: ScenarioMemory = {
      id: "sc_no_facts",
      title: "Orphan scenario",
      summary: "No matching facts in sources",
      category: "project_context",
      confidence: 0.5,
      sourceFactIds: ["nonexistent"],
      sourceSignalIds: [],
      sourceRunIds: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const chain = traceFromScenario(scenario, {});
    expect(chain.rootKind).toBe("scenario");
    // Scenario step + no fact steps (none found) = 1
    expect(chain.steps.length).toBeGreaterThanOrEqual(1);
  });
});
