import fs from "node:fs";
import path from "node:path";
import {
  ScenarioMemorySchema,
  ScenarioCompilationDecisionSchema,
  type LongTermMemoryFact,
  type ScenarioMemory,
  type ScenarioMemoryCategory,
  type ScenarioCompilationDecision,
  type ShortTermSignal,
} from "@cemeworm/shared";

const MAX_SCENARIOS = 40;
const COMPILATION_JACCARD_THRESHOLD = 0.20;
const MERGE_JACCARD_THRESHOLD = 0.38;

function nowIso(): string {
  return new Date().toISOString();
}

function hashId(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function tokenize(text: string): Set<string> {
  const tokens = text
    .toLowerCase()
    .match(/[\p{Script=Han}]|[a-z0-9_]+/gu) ?? [];
  const stopWords = new Set([
    "a", "an", "and", "are", "as", "at", "be", "by", "for", "from",
    "how", "i", "in", "is", "it", "of", "on", "or", "please", "the",
    "this", "to", "use", "what", "when", "with", "you",
  ]);
  return new Set(tokens.filter((t) => t.length > 1 || /[\p{Script=Han}]/u.test(t))
    .filter((t) => !stopWords.has(t)));
}

function jaccardTokens(a: string, b: string): number {
  const tokensA = tokenize(a);
  const tokensB = tokenize(b);
  const union = new Set([...tokensA, ...tokensB]);
  if (union.size === 0) return 0;
  let intersection = 0;
  for (const t of tokensA) {
    if (tokensB.has(t)) intersection++;
  }
  return intersection / union.size;
}

function jaccard2GramFallback(a: string, b: string): number {
  const gramsA = new Set<string>();
  const gramsB = new Set<string>();
  for (let i = 0; i < a.length - 1; i++) gramsA.add(a.slice(i, i + 2));
  for (let i = 0; i < b.length - 1; i++) gramsB.add(b.slice(i, i + 2));
  const union = new Set([...gramsA, ...gramsB]);
  if (union.size === 0) return 0;
  let intersection = 0;
  for (const g of gramsA) if (gramsB.has(g)) intersection++;
  return intersection / union.size;
}

function mapCategory(factCategory: string): ScenarioMemoryCategory {
  switch (factCategory) {
    case "preference": return "style_preference";
    case "goal": return "goal_background";
    case "knowledge": return "project_context";
    case "context": return "project_context";
    case "behavior": return "workflow";
    case "correction": return "constraint";
    default: return "project_context";
  }
}

function buildTitle(facts: LongTermMemoryFact[]): string {
  const combined = facts.map((f) => f.content).join(" ");
  const tokens = [...tokenize(combined)].slice(0, 8);
  const title = tokens.join(" ");
  return title.length > 0 ? title.slice(0, 140) : "Unnamed Scenario";
}

function buildSummary(facts: LongTermMemoryFact[]): string {
  const contents = facts.map((f) => f.content.slice(0, 200));
  const combined = contents.join("; ");
  return combined.length <= 600 ? combined : combined.slice(0, 597) + "...";
}

export interface ScenarioUpsertParams {
  title: string;
  summary: string;
  category: ScenarioMemoryCategory;
  confidence?: number;
  sourceFactIds?: string[];
  sourceSignalIds?: string[];
  sourceRunIds?: string[];
}

export class ScenarioStore {
  private scenarios: ScenarioMemory[] = [];
  private decisions: ScenarioCompilationDecision[] = [];
  private readonly storePath: string | undefined;
  private loaded = false;

  constructor(persistenceDir?: string) {
    this.storePath = persistenceDir
      ? path.join(persistenceDir, "memory-scenarios.json")
      : undefined;
  }

  // ── Compilation ──────────────────────────────────────────

  compileFromFacts(facts: LongTermMemoryFact[], signals?: ShortTermSignal[]): ScenarioCompilationDecision[] {
    this.ensureLoaded();
    const decisions: ScenarioCompilationDecision[] = [];
    const now = nowIso();

    // Group facts by derived scenario category
    const byCategory = new Map<ScenarioMemoryCategory, LongTermMemoryFact[]>();
    for (const fact of facts) {
      const cat = mapCategory(fact.category);
      const group = byCategory.get(cat) ?? [];
      group.push(fact);
      byCategory.set(cat, group);
    }

    for (const [category, group] of byCategory) {
      if (group.length < 2) continue;

      // Cluster by 2-gram Jaccard similarity
      const clusters = clusterFacts(group, COMPILATION_JACCARD_THRESHOLD);

      for (const cluster of clusters) {
        if (cluster.length < 2) continue;

        const scenario = this.scenarioFromCluster(category, cluster, signals, now);
        const existing = this.findMergeTarget(scenario);

        if (existing) {
          const merged = this.mergeScenarios(existing, scenario, now);
          this.scenarios = this.scenarios.map((s) => s.id === merged.id ? merged : s);
          decisions.push(ScenarioCompilationDecisionSchema.parse({
            scenarioId: merged.id,
            action: "merge",
            reason: `Merged similar scenario (Jaccard >= ${MERGE_JACCARD_THRESHOLD})`,
            sourceIds: scenario.sourceFactIds,
            mergedFromScenarioIds: [existing.id],
            decidedAt: now,
          }));
        } else {
          if (this.scenarios.length >= MAX_SCENARIOS) {
            this.evictLowestConfidence();
          }
          this.scenarios.push(scenario);
          decisions.push(ScenarioCompilationDecisionSchema.parse({
            scenarioId: scenario.id,
            action: "create",
            reason: `Compiled from ${cluster.length} facts in category ${category}`,
            sourceIds: scenario.sourceFactIds,
            decidedAt: now,
          }));
        }
      }
    }

    this.decisions.push(...decisions);
    this.persist();
    return decisions;
  }

  // ── CRUD ─────────────────────────────────────────────────

  upsert(params: ScenarioUpsertParams): ScenarioMemory {
    this.ensureLoaded();
    const now = nowIso();
    const id = `scenario_${hashId(params.title)}`;
    const existing = this.scenarios.find((s) => s.id === id);
    const scenario = ScenarioMemorySchema.parse({
      id,
      title: params.title.slice(0, 140),
      summary: params.summary.slice(0, 600),
      category: params.category,
      confidence: params.confidence ?? existing?.confidence ?? 0.5,
      sourceFactIds: params.sourceFactIds ?? existing?.sourceFactIds ?? [],
      sourceSignalIds: params.sourceSignalIds ?? existing?.sourceSignalIds ?? [],
      sourceRunIds: params.sourceRunIds ?? existing?.sourceRunIds ?? [],
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });

    if (existing) {
      this.scenarios = this.scenarios.map((s) => s.id === id ? scenario : s);
      this.decisions.push(ScenarioCompilationDecisionSchema.parse({
        scenarioId: id,
        action: "update",
        reason: "Manual upsert updated existing scenario",
        sourceIds: scenario.sourceFactIds,
        decidedAt: now,
      }));
    } else {
      if (this.scenarios.length >= MAX_SCENARIOS) {
        this.evictLowestConfidence();
      }
      this.scenarios.push(scenario);
      this.decisions.push(ScenarioCompilationDecisionSchema.parse({
        scenarioId: id,
        action: "create",
        reason: "Manual upsert created new scenario",
        sourceIds: scenario.sourceFactIds,
        decidedAt: now,
      }));
    }

    this.persist();
    return scenario;
  }

  get(id: string): ScenarioMemory | undefined {
    this.ensureLoaded();
    return this.scenarios.find((s) => s.id === id);
  }

  list(filter?: { category?: ScenarioMemoryCategory; minConfidence?: number; limit?: number }): ScenarioMemory[] {
    this.ensureLoaded();
    let result = [...this.scenarios];
    if (filter?.category) {
      result = result.filter((s) => s.category === filter.category);
    }
    if (filter?.minConfidence !== undefined) {
      result = result.filter((s) => s.confidence >= filter.minConfidence!);
    }
    return result
      .sort((a, b) => b.confidence - a.confidence || b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, filter?.limit ?? MAX_SCENARIOS);
  }

  delete(id: string): boolean {
    this.ensureLoaded();
    const before = this.scenarios.length;
    this.scenarios = this.scenarios.filter((s) => s.id !== id);
    if (this.scenarios.length < before) {
      this.decisions.push(ScenarioCompilationDecisionSchema.parse({
        scenarioId: id,
        action: "discard",
        reason: "Explicitly deleted",
        decidedAt: nowIso(),
      }));
      this.persist();
      return true;
    }
    return false;
  }

  listDecisions(limit = 50): ScenarioCompilationDecision[] {
    this.ensureLoaded();
    return this.decisions.slice(-limit);
  }

  count(): number {
    this.ensureLoaded();
    return this.scenarios.length;
  }

  // ── Candidates (for Active Memory) ───────────────────────

  listCandidates(): Array<{
    id: string;
    kind: "scenario";
    category: string;
    content: string;
    confidence: number;
    sourceRunIds: string[];
  }> {
    this.ensureLoaded();
    return this.scenarios.map((s) => ({
      id: s.id,
      kind: "scenario" as const,
      category: s.category,
      content: `${s.title}: ${s.summary}`,
      confidence: s.confidence,
      sourceRunIds: s.sourceRunIds,
    }));
  }

  // ── Internal ──────────────────────────────────────────────

  private scenarioFromCluster(
    category: ScenarioMemoryCategory,
    facts: LongTermMemoryFact[],
    signals: ShortTermSignal[] | undefined,
    now: string,
  ): ScenarioMemory {
    const title = buildTitle(facts);
    const summary = buildSummary(facts);
    const avgConfidence = facts.reduce((sum, f) => sum + f.confidence, 0) / facts.length;
    const factIds = facts.map((f) => f.id);
    const factRunIds = [...new Set(facts.map((f) => f.sourceRunId).filter((id): id is string => typeof id === "string" && id.length > 0))];
    const signalIds = signals
      ? signals.filter((s) => factRunIds.includes(s.runId)).map((s) => s.id)
      : [];

    return ScenarioMemorySchema.parse({
      id: `scenario_${hashId(title)}`,
      title,
      summary,
      category,
      confidence: Math.round(avgConfidence * 100) / 100,
      sourceFactIds: factIds,
      sourceSignalIds: signalIds,
      sourceRunIds: factRunIds,
      createdAt: now,
      updatedAt: now,
    });
  }

  private findMergeTarget(scenario: ScenarioMemory): ScenarioMemory | undefined {
    return this.scenarios.find((existing) => {
      const combinedA = existing.title + " " + existing.summary;
      const combinedB = scenario.title + " " + scenario.summary;
      return jaccardTokens(combinedA, combinedB) >= MERGE_JACCARD_THRESHOLD;
    });
  }

  private mergeScenarios(existing: ScenarioMemory, incoming: ScenarioMemory, now: string): ScenarioMemory {
    const allFacts = [...new Set([...existing.sourceFactIds, ...incoming.sourceFactIds])];
    const allSignals = [...new Set([...existing.sourceSignalIds, ...incoming.sourceSignalIds])];
    const allRuns = [...new Set([...existing.sourceRunIds, ...incoming.sourceRunIds])];
    const mergedConfidence = Math.max(existing.confidence, incoming.confidence);
    return ScenarioMemorySchema.parse({
      ...existing,
      summary: incoming.summary.length > existing.summary.length ? incoming.summary : existing.summary,
      confidence: mergedConfidence,
      sourceFactIds: allFacts,
      sourceSignalIds: allSignals,
      sourceRunIds: allRuns,
      updatedAt: now,
    });
  }

  private evictLowestConfidence(): void {
    this.scenarios.sort((a, b) => a.confidence - b.confidence);
    const removed = this.scenarios.shift();
    if (removed) {
      this.decisions.push(ScenarioCompilationDecisionSchema.parse({
        scenarioId: removed.id,
        action: "discard",
        reason: "Evicted due to capacity limit",
        decidedAt: nowIso(),
      }));
    }
  }

  // ── Persistence ───────────────────────────────────────────

  private ensureLoaded(): void {
    if (this.loaded) return;
    this.loaded = true;
    if (!this.storePath) return;
    try {
      if (!fs.existsSync(this.storePath)) return;
      const raw = fs.readFileSync(this.storePath, "utf8");
      const data = JSON.parse(raw);
      if (Array.isArray(data.scenarios)) {
        this.scenarios = data.scenarios.map((s: unknown) => ScenarioMemorySchema.parse(s));
      }
      if (Array.isArray(data.decisions)) {
        this.decisions = data.decisions.map((d: unknown) => ScenarioCompilationDecisionSchema.parse(d));
      }
    } catch { /* ignore corrupted file */ }
  }

  private persist(): void {
    if (!this.storePath) return;
    try {
      fs.mkdirSync(path.dirname(this.storePath), { recursive: true });
      const tmpPath = `${this.storePath}.${Math.random().toString(16).slice(2)}.tmp`;
      fs.writeFileSync(tmpPath, JSON.stringify({
        scenarios: this.scenarios,
        decisions: this.decisions.slice(-200),
      }, null, 2), "utf8");
      fs.renameSync(tmpPath, this.storePath);
    } catch { /* best effort */ }
  }
}

// ── Clustering ─────────────────────────────────────────────

function clusterFacts(facts: LongTermMemoryFact[], threshold: number): LongTermMemoryFact[][] {
  const clusters: LongTermMemoryFact[][] = [];
  const assigned = new Set<number>();

  for (let i = 0; i < facts.length; i++) {
    if (assigned.has(i)) continue;
    const cluster: LongTermMemoryFact[] = [facts[i]!];
    assigned.add(i);

    for (let j = i + 1; j < facts.length; j++) {
      if (assigned.has(j)) continue;
      // Check similarity against all current cluster members
      const isSimilar = cluster.some((member) =>
        jaccardTokens(member.content, facts[j]!.content) >= threshold
      );
      if (isSimilar) {
        cluster.push(facts[j]!);
        assigned.add(j);
      }
    }

    clusters.push(cluster);
  }

  return clusters;
}
