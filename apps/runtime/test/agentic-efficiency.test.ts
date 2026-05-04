import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { OraEventEnvelope, StateSnapshot } from "@cemeworm/shared";
import { buildAgenticEfficiencyLedger } from "../src/agentic-efficiency.js";
import { LocalEvaluationStore } from "../src/evaluation-store.js";

const BASE_TIME = 1_714_000_000_000;

function event(seq: number, type: OraEventEnvelope["type"], payload: unknown = {}, extra: Partial<OraEventEnvelope> = {}): OraEventEnvelope {
  return {
    id: `run-efficiency:evt-${seq}`,
    runId: "run-efficiency",
    seq,
    type,
    createdAt: BASE_TIME + seq * 10,
    pattern: "orchestrator_subagent",
    payload,
    ...extra,
  } as OraEventEnvelope;
}

function snapshot(params: {
  events?: OraEventEnvelope[];
  toolCalls?: StateSnapshot["toolCalls"];
  output?: unknown;
  updatedAt?: number;
} = {}): StateSnapshot {
  return {
    runId: "run-efficiency",
    turnIndex: 1,
    status: "succeeded",
    pattern: "orchestrator_subagent",
    coordinationKind: "orchestrator_subagent",
    modeId: "orchestrator_subagent",
    input: { prompt: "Measure efficiency.", createdAt: BASE_TIME, context: {} },
    config: {
      pattern: "orchestrator_subagent",
      modeId: "orchestrator_subagent",
      modeSelection: "manual",
      profileIds: [],
      modelRef: "local/smoke-model",
      approvalMode: "high_risk_only",
      permissionMode: "default",
      patternOptions: {},
      metadata: {},
      deterministicSeed: "agentic-efficiency-test",
      skillIds: [],
      toolIds: [],
    },
    topology: { nodes: [], edges: [] },
    profiles: [],
    memory: [],
    plan: [],
    planList: [],
    todos: [],
    actions: [],
    toolCalls: params.toolCalls ?? [],
    continuation: { frames: [] },
    conversation: [],
    contextState: {
      activeTokenUsage: { inputTokens: 900, outputTokens: 0, totalTokens: 900, source: "estimate" },
      compactedHistory: [],
      compactedThroughTurnIndex: 0,
      compactionCount: 0,
    },
    toolResults: [],
    policyDecisions: [],
    checkpoints: [],
    events: params.events ?? [],
    agentMessages: [],
    artifacts: [],
    activeAgents: [],
    queueSummary: { mode: "dag", pending: 0, inProgress: 0, completed: 0, topics: [] },
    sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
    busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
    pendingClarifications: [],
    pendingApprovals: [],
    output: params.output ?? "Done.",
    updatedAt: params.updatedAt ?? BASE_TIME + 1_000,
  } as unknown as StateSnapshot;
}

describe("agentic efficiency ledger", () => {
  it("derives token, tool, coordination, and recovery cost components from a snapshot", () => {
    const run = snapshot({
      events: [
        event(0, "run.started"),
        event(1, "node.updated", { state: "running_model" }),
        event(2, "context.usage.updated", {
          usage: { inputTokens: 1000, outputTokens: 200, reasoningTokens: 50, totalTokens: 1250, source: "provider" },
        }),
        event(3, "token.delta", { tokenCount: 220 }),
        event(4, "agent.message"),
        event(5, "tool.repaired"),
        event(6, "recovery.retry_scheduled"),
        event(7, "clarification.required"),
        event(8, "approval.required"),
      ],
      toolCalls: [{
        id: "tool-1",
        runId: "run-efficiency",
        toolId: "files.read",
        args: { path: "README.md" },
        source: "provider_native",
        status: "succeeded",
        requestedAt: BASE_TIME + 20,
        updatedAt: BASE_TIME + 30,
      }, {
        id: "tool-2",
        runId: "run-efficiency",
        toolId: "files.read",
        args: { path: "README.md" },
        source: "manual_repair",
        status: "repaired",
        requestedAt: BASE_TIME + 40,
        updatedAt: BASE_TIME + 50,
        repairReason: "missing_provider_tool_result",
      }],
    });

    const ledger = buildAgenticEfficiencyLedger(run, 1000);

    expect(ledger.modelCallCount).toBe(1);
    expect(ledger.inputTokens).toBe(1000);
    expect(ledger.outputTokens).toBe(220);
    expect(ledger.reasoningTokens).toBe(50);
    expect(ledger.toolCallCount).toBe(2);
    expect(ledger.uniqueToolCount).toBe(1);
    expect(ledger.repairedToolCallCount).toBe(1);
    expect(ledger.toolRetryCount).toBe(2);
    expect(ledger.clarificationCount).toBe(1);
    expect(ledger.approvalCount).toBe(1);
    expect(ledger.coordinationEventCount).toBe(1);
    expect(ledger.recoveryEventCount).toBe(2);
    expect(ledger.estimatedCostUsd).toBeGreaterThan(0);
  });

  it("feeds evaluation observations and agentic cost metrics", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ora-efficiency-eval-"));
    const store = new LocalEvaluationStore(dir, () => BASE_TIME);
    const dataset = store.importDataset({
      sourceFormat: "inline",
      content: JSON.stringify([{ id: "case-1", prompt: "Measure this", expected: "Done." }]),
    });

    const detail = await store.startRun({
      datasetId: dataset.dataset.id,
      profileId: "outcome",
      objective: {
        kind: "cost",
        target: "run.output",
        metrics: ["agentic_cost_score", "token_efficiency", "tool_efficiency", "coordination_overhead", "recovery_overhead"],
      },
      configs: [{
        id: "efficient",
        label: "Efficient",
        runConfig: { pattern: "orchestrator_subagent", modelRef: "local/smoke-model" },
      }],
    }, async () => snapshot({
      events: [
        event(0, "run.started"),
        event(1, "node.updated", { state: "running_model" }),
        event(2, "context.usage.updated", {
          usage: { inputTokens: 500, outputTokens: 120, totalTokens: 620, source: "provider" },
        }),
        event(3, "token.delta", { tokenCount: 120 }),
        event(4, "run.done"),
      ],
      output: "Done.",
    }));

    const attempt = detail.attempts[0]!;
    expect(attempt.observations.runtime).toMatchObject({
      efficiencyLedger: expect.objectContaining({
        modelCallCount: 1,
        inputTokens: 900,
        totalTokens: 1020,
      }),
    });
    expect(attempt.metricScores.map((score) => score.metricId)).toEqual([
      "agentic_cost_score",
      "token_efficiency",
      "tool_efficiency",
      "coordination_overhead",
      "recovery_overhead",
    ]);
    expect(attempt.costUsd).toBe((attempt.observations.runtime as { efficiencyLedger: { estimatedCostUsd: number } }).efficiencyLedger.estimatedCostUsd);
  });
});
