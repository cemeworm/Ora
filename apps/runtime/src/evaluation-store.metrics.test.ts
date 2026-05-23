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
  ],
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
    updatedAt: 10,
  });
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
});
