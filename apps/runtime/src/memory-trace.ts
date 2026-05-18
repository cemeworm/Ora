import type {
  ActiveMemoryCard,
  LongTermMemoryFact,
  MemoryTraceChain,
  MemoryTraceStep,
  ScenarioMemory,
  ShortTermSignal,
  TaskEvidenceRef,
  TaskNode,
  WikiPage,
} from "@cemeworm/shared";
import {
  MemoryTraceChainSchema,
  MemoryTraceStepSchema,
} from "@cemeworm/shared";
import type { ScenarioCompilationDecision } from "@cemeworm/shared";

function nowIso(): string {
  return new Date().toISOString();
}

// ── Trace Sources ──────────────────────────────────────────

export interface TraceSources {
  facts?: LongTermMemoryFact[];
  signals?: ShortTermSignal[];
  scenarios?: ScenarioMemory[];
  wikiPages?: WikiPage[];
  taskNodes?: TaskNode[];
  evidenceRefs?: TaskEvidenceRef[];
  compilationDecisions?: ScenarioCompilationDecision[];
}

// ── Fact step builder ──────────────────────────────────────

function stepFromFact(fact: LongTermMemoryFact): MemoryTraceStep {
  return MemoryTraceStepSchema.parse({
    kind: "fact",
    id: fact.id,
    label: fact.content.slice(0, 200),
    summary: `category=${fact.category} confidence=${fact.confidence.toFixed(2)}`,
    sourceRunIds: fact.sourceRunId ? [fact.sourceRunId] : [],
    parentIds: [],
  });
}

// ── Signal step builder ────────────────────────────────────

function stepFromSignal(signal: ShortTermSignal): MemoryTraceStep {
  return MemoryTraceStepSchema.parse({
    kind: "signal",
    id: signal.id,
    label: signal.content.slice(0, 200),
    summary: `type=${signal.type} confidence=${signal.confidence.toFixed(2)}`,
    sourceRunIds: [signal.runId],
    parentIds: signal.sourcePointers ?? [],
  });
}

// ── Evidence step builder ──────────────────────────────────

function stepFromEvidenceRef(ref: TaskEvidenceRef): MemoryTraceStep {
  return MemoryTraceStepSchema.parse({
    kind: "evidence_ref",
    id: ref.id,
    label: ref.summary.slice(0, 200),
    summary: `${ref.sourceKind}: ${ref.summary}`.slice(0, 300),
    sourceRunIds: [ref.runId],
    parentIds: ref.sourceActionId ? [ref.sourceActionId] : [],
  });
}

// ── Run step builder ───────────────────────────────────────

function stepFromRun(runId: string): MemoryTraceStep {
  return MemoryTraceStepSchema.parse({
    kind: "run",
    id: runId,
    label: `Run ${runId.slice(0, 12)}`,
    summary: "",
    sourceRunIds: [runId],
    parentIds: [],
  });
}

// ── Trace from Card ────────────────────────────────────────

export function traceFromCard(card: ActiveMemoryCard, sources: TraceSources): MemoryTraceChain {
  const steps: MemoryTraceStep[] = [];
  const cardStep = MemoryTraceStepSchema.parse({
    kind: "active_memory_card",
    id: card.id,
    label: card.content.slice(0, 200),
    summary: `kind=${card.kind} category=${card.category} confidence=${card.confidence.toFixed(2)}`,
    sourceRunIds: card.sourceRunId ? [card.sourceRunId] : [],
    parentIds: [],
  });
  steps.push(cardStep);

  // If card is a fact, trace to the source fact
  if (card.kind === "fact" && sources.facts) {
    const fact = sources.facts.find((f) => f.id === card.id);
    if (fact) {
      steps.push(stepFromFact(fact));
    }
  }

  // If card is a scenario, trace to scenario → facts → signals
  if (card.kind === "scenario" && sources.scenarios) {
    const scenario = sources.scenarios.find((s) => s.id === card.id);
    if (scenario) {
      steps.push(MemoryTraceStepSchema.parse({
        kind: "scenario",
        id: scenario.id,
        label: scenario.title.slice(0, 200),
        summary: `category=${scenario.category} confidence=${scenario.confidence.toFixed(2)}`,
        sourceRunIds: scenario.sourceRunIds,
        parentIds: [],
      }));
      steps.push(...stepsFromScenario(scenario, sources));
    }
  }

  // Add run steps
  const runIds = new Set(steps.flatMap((s) => s.sourceRunIds));
  for (const runId of runIds) {
    steps.push(stepFromRun(runId));
  }

  return MemoryTraceChainSchema.parse({
    rootId: card.id,
    rootKind: "active_memory_card",
    steps,
    generatedAt: nowIso(),
    summary: buildTraceSummary(steps),
  });
}

// ── Trace from Scenario ────────────────────────────────────

export function traceFromScenario(scenario: ScenarioMemory, sources: TraceSources): MemoryTraceChain {
  const steps: MemoryTraceStep[] = [];
  steps.push(MemoryTraceStepSchema.parse({
    kind: "scenario",
    id: scenario.id,
    label: scenario.title.slice(0, 200),
    summary: `category=${scenario.category} confidence=${scenario.confidence.toFixed(2)} sourceFactCount=${scenario.sourceFactIds.length}`,
    sourceRunIds: scenario.sourceRunIds,
    parentIds: [],
  }));

  steps.push(...stepsFromScenario(scenario, sources));

  // Compilation decision audit
  if (sources.compilationDecisions) {
    const related = sources.compilationDecisions.filter((d) => d.scenarioId === scenario.id);
    for (const decision of related) {
      steps.push(MemoryTraceStepSchema.parse({
        kind: "scenario",
        id: `decision_${decision.decidedAt}`,
        label: `Compilation: ${decision.action}`,
        summary: decision.reason.slice(0, 300),
        sourceRunIds: [],
        parentIds: [],
      }));
    }
  }

  return MemoryTraceChainSchema.parse({
    rootId: scenario.id,
    rootKind: "scenario",
    steps,
    generatedAt: nowIso(),
    summary: buildTraceSummary(steps),
  });
}

// ── Trace from Task Node ───────────────────────────────────

export function traceFromTaskNode(
  node: TaskNode,
  evidenceRefs: TaskEvidenceRef[],
): MemoryTraceChain {
  const steps: MemoryTraceStep[] = [];
  steps.push(MemoryTraceStepSchema.parse({
    kind: "task_node",
    id: node.id,
    label: node.label.slice(0, 200),
    summary: `kind=${node.kind} status=${node.status}`,
    sourceRunIds: [node.runId],
    parentIds: node.parentNodeId ? [node.parentNodeId] : [],
  }));

  // Trace to evidence refs
  for (const refId of node.evidenceRefIds) {
    const ref = evidenceRefs.find((r) => r.id === refId);
    if (ref) {
      steps.push(stepFromEvidenceRef(ref));
    }
  }

  // Run step
  steps.push(stepFromRun(node.runId));

  return MemoryTraceChainSchema.parse({
    rootId: node.id,
    rootKind: "task_node",
    steps,
    generatedAt: nowIso(),
    summary: buildTraceSummary(steps),
  });
}

// ── Trace from Wiki Claim ──────────────────────────────────

export function traceFromWikiClaim(
  claim: { id: string; statement: string; sourceFactIds: string[]; sourceRunIds: string[] },
  sources: TraceSources,
): MemoryTraceChain {
  const steps: MemoryTraceStep[] = [];
  steps.push(MemoryTraceStepSchema.parse({
    kind: "wiki_claim",
    id: claim.id,
    label: claim.statement.slice(0, 200),
    summary: `sourceFactCount=${claim.sourceFactIds.length}`,
    sourceRunIds: claim.sourceRunIds,
    parentIds: [],
  }));

  // Trace to source facts
  if (sources.facts) {
    for (const factId of claim.sourceFactIds) {
      const fact = sources.facts.find((f) => f.id === factId);
      if (fact) {
        steps.push(stepFromFact(fact));
      }
    }
  }

  const runIds = new Set(steps.flatMap((s) => s.sourceRunIds));
  for (const runId of runIds) {
    steps.push(stepFromRun(runId));
  }

  return MemoryTraceChainSchema.parse({
    rootId: claim.id,
    rootKind: "wiki_claim",
    steps,
    generatedAt: nowIso(),
    summary: buildTraceSummary(steps),
  });
}

// ── Internal ──────────────────────────────────────────────

function stepsFromScenario(scenario: ScenarioMemory, sources: TraceSources): MemoryTraceStep[] {
  const steps: MemoryTraceStep[] = [];

  // Trace to source facts
  if (sources.facts) {
    for (const factId of scenario.sourceFactIds) {
      const fact = sources.facts.find((f) => f.id === factId);
      if (fact) {
        steps.push(stepFromFact(fact));
      }
    }
  }

  // Trace to source signals
  if (sources.signals) {
    for (const signalId of scenario.sourceSignalIds) {
      const signal = sources.signals.find((s) => s.id === signalId);
      if (signal) {
        steps.push(stepFromSignal(signal));
      }
    }
  }

  return steps;
}

function buildTraceSummary(steps: MemoryTraceStep[]): string {
  const kinds = steps.map((s) => s.kind);
  const kindCounts = new Map<string, number>();
  for (const k of kinds) {
    kindCounts.set(k, (kindCounts.get(k) ?? 0) + 1);
  }
  const parts = [...kindCounts.entries()]
    .sort(([, a], [, b]) => b - a)
    .slice(0, 4)
    .map(([kind, count]) => `${count}×${kind}`);
  const runIds = new Set(steps.flatMap((s) => s.sourceRunIds));
  if (runIds.size > 0) {
    parts.push(`${runIds.size} runs`);
  }
  return parts.join(", ");
}
