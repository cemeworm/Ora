import { describe, expect, it } from "vitest";
import {
  CODE_DEVELOPMENT_MODE_ID,
  EvaluationCaseSchema,
  EvaluationObjectiveSchema,
  SINGLE_AGENT_MODE_ID,
  StateSnapshotSchema,
  getModePreset,
} from "@cemeworm/shared";
import { extractEvaluationObservations, scoreObjectiveMetrics } from "./evaluation-store.js";

const resolverWorkflowObjective = EvaluationObjectiveSchema.parse({
  kind: "outcome",
  target: "tool.calls",
  metrics: [
    "visible_surface_shrinkage",
    "explore_first_score",
    "atomic_tool_hops",
    "first_locate_success",
    "shell_explore_restraint",
    "read_first_score",
    "tool_hop_efficiency",
    "first_search_success",
  ],
});

const causalObjective = EvaluationObjectiveSchema.parse({
  kind: "outcome",
  target: "run.output",
  metrics: ["intent_resolution", "effective_intervention"],
});

const evaluationCase = EvaluationCaseSchema.parse({
  id: "case-resolver-metrics",
  input: {
    prompt: "Trace where the runtime authority boundary is enforced.",
  },
  metadata: {},
});

function makeSnapshot(params: {
  toolCalls: Array<Record<string, unknown>>;
  events?: Array<Record<string, unknown>>;
  modeId?: string;
  metadata?: Record<string, unknown>;
  outputText?: string;
}) {
  const modeId = params.modeId ?? CODE_DEVELOPMENT_MODE_ID;
  return StateSnapshotSchema.parse({
    runId: "run-eval-metrics",
    status: "succeeded",
    pattern: "orchestrator_subagent",
    modeId,
    modeSpec: getModePreset(modeId),
    input: { prompt: "Inspect the runtime authority path", createdAt: 1, context: {} },
    config: {
      pattern: "orchestrator_subagent",
      modeId,
      toolIds: [
        "repo.explore",
        "file.read",
        "file.list",
        "file.glob",
        "file.grep",
        "file.write",
        "file.patch",
        "file.apply_patch",
        "shell.execute",
        "plan.update",
        "agent.spawn",
        "agent.wait",
        "message.send",
        "web.fetch",
        "web.search",
      ],
      metadata: params.metadata ?? {},
    },
    topology: { nodes: [], edges: [] },
    profiles: [],
    memory: [],
    plan: [],
    actions: [],
    toolCalls: params.toolCalls,
    checkpoints: [],
    events: params.events ?? [],
    ...(params.outputText ? { output: { text: params.outputText } } : {}),
    updatedAt: 10,
  });
}

function makeUsageEvent(params: {
  seq: number;
  totalTokens: number;
  outputTokens?: number;
  cacheHitTokens?: number;
  cacheMissTokens?: number;
}) {
  const outputTokens = params.outputTokens ?? 2_000;
  const inputTokens = Math.max(0, params.totalTokens - outputTokens);
  return {
    id: `evt-usage-${params.seq}`,
    runId: "run-eval-metrics",
    seq: params.seq,
    type: "context.usage.updated",
    createdAt: params.seq,
    pattern: "orchestrator_subagent",
    payload: {
      usage: {
        inputTokens,
        outputTokens,
        reasoningTokens: 0,
        totalTokens: params.totalTokens,
        promptCacheHitTokens: params.cacheHitTokens ?? 0,
        promptCacheMissTokens: params.cacheMissTokens ?? 0,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
      },
    },
  };
}

describe("resolver-aware evaluation metrics", () => {
  it("scores the preferred repo.explore-first workflow highly", () => {
    const snapshot = makeSnapshot({
      toolCalls: [
        {
          id: "tool-1",
          runId: "run-eval-metrics",
          toolId: "repo.explore",
          args: { goal: "Find the authority boundary", kind: "trace", subject: "resolveVisibleToolsForAgent" },
          source: "provider_native",
          status: "succeeded",
          requestedAt: 1,
          updatedAt: 2,
          result: {
            status: "succeeded",
            output: { ok: true },
            content: "{\"ok\":true}",
            createdAt: 2,
            updatedAt: 2,
          },
        },
      ],
      events: [
        {
          id: "evt-1",
          runId: "run-eval-metrics",
          seq: 1,
          type: "tool.repo_explore.completed",
          createdAt: 2,
          pattern: "orchestrator_subagent",
          payload: {
            kind: "trace",
            status: "answered",
            relatedPathCount: 3,
            evidenceCount: 2,
            gapCount: 0,
          },
        },
      ],
    });

    const observations = extractEvaluationObservations(snapshot, 1200);
    const scores = scoreObjectiveMetrics(resolverWorkflowObjective, evaluationCase, observations);
    const byId = new Map<string, (typeof scores)[number]>(scores.map((score) => [score.metricId, score]));

    expect(byId.get("visible_surface_shrinkage")?.score).toBeGreaterThan(0.9);
    expect(byId.get("explore_first_score")?.passed).toBe(true);
    expect(byId.get("atomic_tool_hops")?.passed).toBe(true);
    expect(byId.get("first_locate_success")?.score).toBe(1);
    expect(byId.get("shell_explore_restraint")?.score).toBe(1);
    // New atomic-tool-aligned alias metrics return identical scores
    expect(byId.get("read_first_score")?.score).toBe(byId.get("explore_first_score")?.score);
    expect(byId.get("tool_hop_efficiency")?.score).toBe(byId.get("atomic_tool_hops")?.score);
    expect(byId.get("first_search_success")?.score).toBe(byId.get("first_locate_success")?.score);
  });

  it("penalizes shell-first atomic fallback workflows", () => {
    const snapshot = makeSnapshot({
      toolCalls: [
        {
          id: "tool-1",
          runId: "run-eval-metrics",
          toolId: "shell.execute",
          args: { command: "rg \"authority\" apps/runtime/src -n" },
          source: "provider_native",
          status: "succeeded",
          requestedAt: 1,
          updatedAt: 2,
          result: {
            status: "succeeded",
            output: { ok: true },
            content: "apps/runtime/src/harness/runtime-kernel.ts:3049",
            createdAt: 2,
            updatedAt: 2,
          },
        },
        {
          id: "tool-2",
          runId: "run-eval-metrics",
          toolId: "file.read",
          args: { path: "apps/runtime/src/harness/runtime-kernel.ts" },
          source: "provider_native",
          status: "succeeded",
          requestedAt: 3,
          updatedAt: 4,
        },
        {
          id: "tool-3",
          runId: "run-eval-metrics",
          toolId: "file.grep",
          args: { pattern: "spawn_authority_mismatch" },
          source: "provider_native",
          status: "succeeded",
          requestedAt: 5,
          updatedAt: 6,
        },
      ],
    });

    const observations = extractEvaluationObservations(snapshot, 1500);
    const scores = scoreObjectiveMetrics(resolverWorkflowObjective, evaluationCase, observations);
    const byId = new Map<string, (typeof scores)[number]>(scores.map((score) => [score.metricId, score]));

    expect(byId.get("visible_surface_shrinkage")?.passed).toBe(true);
    expect(byId.get("explore_first_score")?.score).toBeLessThan(0.7);
    expect(byId.get("atomic_tool_hops")?.score).toBeLessThan(0.7);
    expect(byId.get("first_locate_success")?.score).toBeLessThan(0.7);
    expect(byId.get("shell_explore_restraint")?.score).toBeLessThan(0.7);
    // Shell-first workflow: new atomic-aligned aliases match old metrics
    expect(byId.get("read_first_score")?.score).toBeLessThan(0.7);
    expect(byId.get("tool_hop_efficiency")?.score).toBeLessThan(0.7);
    expect(byId.get("first_search_success")?.score).toBeLessThan(0.7);
  });

  it("respects single_agent chat surface when rebuilding resolver visibility", () => {
    const snapshot = makeSnapshot({
      modeId: SINGLE_AGENT_MODE_ID,
      metadata: { taskIntent: "chat" },
      toolCalls: [
        {
          id: "tool-1",
          runId: "run-eval-metrics",
          toolId: "file.read",
          args: { path: "apps/runtime/src/harness/causal-policy-router.ts" },
          source: "provider_native",
          status: "succeeded",
          requestedAt: 1,
          updatedAt: 2,
        },
      ],
    });

    const observations = extractEvaluationObservations(snapshot, 900);
    const visibleToolIds = ((observations.runtime as Record<string, unknown>).toolVisibility as Record<string, unknown>).root as Record<string, unknown>;
    expect(visibleToolIds.visibleToolIds).not.toContain("repo.explore");

    const scores = scoreObjectiveMetrics(resolverWorkflowObjective, evaluationCase, observations);
    const byId = new Map<string, (typeof scores)[number]>(scores.map((score) => [score.metricId, score]));

    expect(byId.get("atomic_tool_hops")?.passed).toBe(true);
    expect(byId.get("first_locate_success")?.passed).toBe(true);
  });

  it("falls back to router_primary episodes when no effective causal episode survives filtering", () => {
    const causalCase = EvaluationCaseSchema.parse({
      id: "case-causal-fallback",
      input: { prompt: "Python 3.13 有什么新特性" },
      expected: {
        structured: {
          expectedIntervention: "search_web",
          latentGoal: "了解最新版本特性",
        },
      },
      metadata: {},
    });
    const snapshot = makeSnapshot({
      toolCalls: [],
      events: [
        {
          id: "evt-plan",
          runId: "run-eval-metrics",
          seq: 1,
          type: "causal.decision.recorded",
          createdAt: 2,
          pattern: "orchestrator_subagent",
          payload: {
            decisionId: "decision-plan",
            source: "runtime_followup",
            decisionKind: "plan_updated",
            taskState: {
              surfaceRequest: "Python 3.13 有什么新特性",
              selectedLatentGoal: "",
              keyUncertainties: ["上下文不足"],
            },
            policyDecision: {
              goalUncertainty: 0.5,
              factUncertainty: 0.2,
              contextUncertainty: 0.4,
              actionRisk: 0.1,
              userCost: 0.3,
              reversibility: "medium",
              recommendedAction: "plan",
              reason: "plan fallback",
              wouldChangeOutcomeIfWrong: false,
            },
            chosenIntervention: "plan",
            effective: true,
            recordedAt: 2,
          },
        },
        {
          id: "evt-router",
          runId: "run-eval-metrics",
          seq: 2,
          type: "causal.decision.recorded",
          createdAt: 3,
          pattern: "orchestrator_subagent",
          payload: {
            decisionId: "decision-router",
            source: "router_primary",
            decisionKind: "run_start",
            taskState: {
              surfaceRequest: "Python 3.13 有什么新特性",
              selectedLatentGoal: "了解最新版本特性",
              keyUncertainties: ["需要搜索最新信息"],
            },
            policyDecision: {
              goalUncertainty: 0.7,
              factUncertainty: 0.7,
              contextUncertainty: 0.2,
              actionRisk: 0.3,
              userCost: 0.2,
              reversibility: "medium",
              recommendedAction: "clarify",
              reason: "router picked clarify",
              wouldChangeOutcomeIfWrong: true,
            },
            chosenIntervention: "clarify",
            effective: false,
            recordedAt: 3,
          },
        },
      ],
    });

    const observations = extractEvaluationObservations(snapshot, 900);
    const scores = scoreObjectiveMetrics(causalObjective, causalCase, observations);
    const byId = new Map<string, (typeof scores)[number]>(scores.map((score) => [score.metricId, score]));

    expect(byId.get("intent_resolution")?.failureTags).not.toContain("missing_causal_data");
    expect(byId.get("effective_intervention")?.failureTags).toContain("wrong_intervention");
    expect(byId.get("effective_intervention")?.rationale).toContain("search_web");
    expect(byId.get("effective_intervention")?.rationale).toContain("clarify");
  });

  it("uses looser real-world budgets than cause-effect budgets for kv cache cost metrics", () => {
    const snapshot = makeSnapshot({
      toolCalls: [],
      events: [
        makeUsageEvent({ seq: 1, totalTokens: 18_000, cacheHitTokens: 8_240, cacheMissTokens: 1_760 }),
        makeUsageEvent({ seq: 2, totalTokens: 18_000, cacheHitTokens: 8_240, cacheMissTokens: 1_760 }),
        makeUsageEvent({ seq: 3, totalTokens: 18_000, cacheHitTokens: 8_240, cacheMissTokens: 1_760 }),
        makeUsageEvent({ seq: 4, totalTokens: 18_000, cacheHitTokens: 8_240, cacheMissTokens: 1_760 }),
      ],
    });
    const observations = extractEvaluationObservations(snapshot, 2_500);
    const kvCase = EvaluationCaseSchema.parse({
      id: "kv-real-world-budget",
      input: { prompt: "Review a code path with repeated local reads." },
      metadata: {
        category: "code_review",
        difficulty: "medium",
        cacheExpected: true,
      },
    });
    const realWorldObjective = EvaluationObjectiveSchema.parse({
      kind: "cost",
      target: "run.output",
      metrics: ["token_efficiency", "kv_cache_hit_ratio"],
      metadata: { evaluationTrack: "real-world" },
    });
    const causeEffectObjective = EvaluationObjectiveSchema.parse({
      kind: "cost",
      target: "run.output",
      metrics: ["token_efficiency", "kv_cache_hit_ratio"],
      metadata: { evaluationTrack: "cause-effect" },
    });

    const realWorldScores = scoreObjectiveMetrics(realWorldObjective, kvCase, observations);
    const causeEffectScores = scoreObjectiveMetrics(causeEffectObjective, kvCase, observations);
    const realWorldById = new Map(realWorldScores.map((score) => [score.metricId, score]));
    const causeEffectById = new Map(causeEffectScores.map((score) => [score.metricId, score]));

    expect(realWorldById.get("token_efficiency")?.passed).toBe(true);
    expect(realWorldById.get("kv_cache_hit_ratio")?.passed).toBe(true);
    expect(causeEffectById.get("token_efficiency")?.passed).toBe(false);
    expect(causeEffectById.get("kv_cache_hit_ratio")?.passed).toBe(false);
  });

  it("does not hard-score cache metrics for single-call or cache-not-expected cases", () => {
    const snapshot = makeSnapshot({
      toolCalls: [],
      events: [
        makeUsageEvent({ seq: 1, totalTokens: 9_000, cacheHitTokens: 0, cacheMissTokens: 2_000 }),
      ],
    });
    const observations = extractEvaluationObservations(snapshot, 900);
    const kvCase = EvaluationCaseSchema.parse({
      id: "kv-no-cache-expected",
      input: { prompt: "Answer directly without multi-turn cache reuse." },
      metadata: {
        category: "single_call",
        difficulty: "easy",
        cacheExpected: false,
      },
    });
    const objective = EvaluationObjectiveSchema.parse({
      kind: "cost",
      target: "run.output",
      metrics: ["token_efficiency", "kv_cache_hit_ratio"],
      metadata: { evaluationTrack: "cause-effect" },
    });

    const scores = scoreObjectiveMetrics(objective, kvCase, observations);
    const byId = new Map(scores.map((score) => [score.metricId, score]));

    expect(byId.get("token_efficiency")?.passed).toBe(true);
    expect(byId.get("kv_cache_hit_ratio")?.passed).toBe(true);
    expect(byId.get("token_efficiency")?.failureTags).toEqual([]);
    expect(byId.get("kv_cache_hit_ratio")?.failureTags).toEqual([]);
  });

  it("requires structured assertions to pass for real-world cost objectives", () => {
    const snapshot = makeSnapshot({
      toolCalls: [],
      events: [
        makeUsageEvent({ seq: 1, totalTokens: 18_000, cacheHitTokens: 8_240, cacheMissTokens: 1_760 }),
        makeUsageEvent({ seq: 2, totalTokens: 18_000, cacheHitTokens: 8_240, cacheMissTokens: 1_760 }),
      ],
    });
    const observations = extractEvaluationObservations(snapshot, 2_500);
    const kvCase = EvaluationCaseSchema.parse({
      id: "kv-real-world-assertion-gate",
      input: {
        prompt: "Search the repository and summarize the results.",
      },
      expected: {
        structured: {
          assertions: [
            {
              type: "min",
              path: "runtime.efficiencyLedger.modelCallCount",
              value: 4,
              rationale: "4次搜索+汇总分析应至少有4次模型调用。",
            },
          ],
        },
      },
      metadata: {
        category: "multi_search",
        difficulty: "medium",
        cacheExpected: true,
      },
    });
    const objective = EvaluationObjectiveSchema.parse({
      kind: "cost",
      target: "run.output",
      metrics: [
        "kv_cache_hit_ratio",
        "agentic_cost_score",
        "token_efficiency",
        "tool_efficiency",
        "assertion_pass_rate",
      ],
      metadata: { evaluationTrack: "real-world" },
    });

    const scores = scoreObjectiveMetrics(objective, kvCase, observations);
    const byId = new Map(scores.map((score) => [score.metricId, score]));

    expect(byId.get("agentic_cost_score")?.passed).toBe(true);
    expect(byId.get("token_efficiency")?.passed).toBe(true);
    expect(byId.get("tool_efficiency")?.passed).toBe(true);
    expect(byId.get("assertion_pass_rate")?.passed).toBe(false);
    expect(byId.get("assertion_pass_rate")?.failureTags).toContain("assertion_failed");
  });

  it("fails real-world multi-search assertions when the answer admits incomplete coverage", () => {
    const snapshot = makeSnapshot({
      toolCalls: [
        {
          id: "tool-1",
          runId: "run-eval-metrics",
          toolId: "file.list",
          args: { path: "packages/shared/src" },
          source: "provider_native",
          status: "succeeded",
          requestedAt: 1,
          updatedAt: 2,
        },
        {
          id: "tool-2",
          runId: "run-eval-metrics",
          toolId: "file.read",
          args: { path: "packages/shared/src/runtime.ts" },
          source: "provider_native",
          status: "succeeded",
          requestedAt: 3,
          updatedAt: 4,
        },
      ],
      events: [
        makeUsageEvent({ seq: 1, totalTokens: 18_000, cacheHitTokens: 8_240, cacheMissTokens: 1_760 }),
        makeUsageEvent({ seq: 2, totalTokens: 18_000, cacheHitTokens: 8_240, cacheMissTokens: 1_760 }),
        makeUsageEvent({ seq: 3, totalTokens: 18_000, cacheHitTokens: 8_240, cacheMissTokens: 1_760 }),
        makeUsageEvent({ seq: 4, totalTokens: 18_000, cacheHitTokens: 8_240, cacheMissTokens: 1_760 }),
      ],
      outputText: [
        "基于本次搜索中已读取的文件内容，我如实汇报搜索结果如下：",
        "已读取 `packages/shared/src/runtime.ts`。",
        "但覆盖不完整，`packages/shared/src/cache/`、`server/` 与其他目录未深入读取。",
        "建议重新发起一次批量化搜索。",
      ].join("\n"),
    });
    const observations = extractEvaluationObservations(snapshot, 2_500);
    const kvCase = EvaluationCaseSchema.parse({
      id: "kv-real-world-coverage-gate",
      input: {
        prompt: "Search the repository and summarize the results.",
      },
      expected: {
        structured: {
          assertions: [
            {
              type: "not_equals",
              path: "run.status",
              value: "failed",
              rationale: "多次搜索应正常完成。",
            },
            {
              type: "min",
              path: "runtime.efficiencyLedger.modelCallCount",
              value: 4,
              rationale: "4次搜索+汇总分析应至少有4次模型调用。",
            },
            {
              type: "contains",
              path: "run.outputText",
              value: "apps/runtime/src/agentic-efficiency.ts",
              failureTag: "missing_cache_metric_evidence",
              rationale: "真实搜索结果应覆盖 cacheHitRatio / AgenticEfficiencyLedger 的核心定义文件。",
            },
            {
              type: "contains",
              path: "run.outputText",
              value: "packages/shared/src/runtime.ts",
              failureTag: "missing_usage_event_evidence",
              rationale: "真实搜索结果应覆盖 context.usage.updated 的核心事件定义文件。",
            },
            {
              type: "contains",
              path: "run.outputText",
              value: "apps/runtime/src/evaluation-store.ts",
              failureTag: "missing_eval_metric_evidence",
              rationale: "真实搜索结果应覆盖 kv_cache_hit_ratio 的核心评测实现文件。",
            },
          ],
        },
      },
      metadata: {
        category: "multi_search",
        difficulty: "medium",
        cacheExpected: true,
      },
    });
    const objective = EvaluationObjectiveSchema.parse({
      kind: "cost",
      target: "run.output",
      metrics: [
        "kv_cache_hit_ratio",
        "agentic_cost_score",
        "token_efficiency",
        "tool_efficiency",
        "assertion_pass_rate",
      ],
      metadata: { evaluationTrack: "real-world" },
    });

    const scores = scoreObjectiveMetrics(objective, kvCase, observations);
    const byId = new Map(scores.map((score) => [score.metricId, score]));

    expect(byId.get("kv_cache_hit_ratio")?.passed).toBe(true);
    expect(byId.get("token_efficiency")?.passed).toBe(true);
    expect(byId.get("assertion_pass_rate")?.passed).toBe(false);
    expect(byId.get("assertion_pass_rate")?.failureTags).toContain("missing_cache_metric_evidence");
    expect(byId.get("assertion_pass_rate")?.failureTags).toContain("missing_eval_metric_evidence");
  });
});
