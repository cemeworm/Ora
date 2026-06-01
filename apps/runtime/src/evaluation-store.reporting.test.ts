import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { StateSnapshot } from "@cemeworm/shared";
import { LocalEvaluationStore } from "./evaluation-store.js";

function makeSnapshot(prompt: string, outputText: string): StateSnapshot {
  const now = Date.now();
  return {
    runId: `run-${now}`,
    turnIndex: 1,
    status: "succeeded",
    pattern: "solo_agent",
    input: { prompt, context: {}, createdAt: now },
    output: { text: outputText },
    config: {
      pattern: "solo_agent",
      metadata: {},
      toolIds: [],
    },
    topology: { nodes: [], edges: [] },
    profiles: [],
    memory: [],
    plan: [],
    planList: [],
    todos: [],
    actions: [],
    toolCalls: [],
    continuation: { frames: [] },
    planDecisions: [],
    conversation: [],
    toolResults: [],
    policyDecisions: [],
    checkpoints: [],
    events: [],
    agentMessages: [],
    artifacts: [],
    activeAgents: [],
    pendingClarifications: [],
    pendingApprovals: [],
    updatedAt: now,
  } as unknown as StateSnapshot;
}

describe("evaluation store dual reporting", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      rmSync(tempDirs.pop()!, { recursive: true, force: true });
    }
  });

  it("builds reporting views and slices from dataset metadata", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ora-eval-reporting-"));
    tempDirs.push(dir);
    const store = new LocalEvaluationStore(dir);
    const dataset = [
      {
        id: "case-legacy-implicit",
        input: { prompt: "帮我写一个函数处理用户登录", context: {} },
        expected: {
          text: "done",
          structured: { expectedIntervention: "read_context" },
        },
        metadata: {
          scenario: "coding",
          uncertaintyType: "context",
          reportingViews: ["legacy_oracle_result"],
          contextProbeClass: "implicit_context_file",
        },
      },
      {
        id: "case-shared-search",
        input: { prompt: "React 19 有哪些新特性", context: {} },
        expected: {
          text: "done",
          structured: { expectedIntervention: "search_web" },
        },
        metadata: {
          scenario: "search",
          uncertaintyType: "fact",
          freshnessClass: "pure_info_query",
        },
      },
      {
        id: "case-value-explicit",
        input: { prompt: "帮我基于 CLAUDE.md 理解这个项目的架构", context: {} },
        expected: {
          text: "done",
          structured: { expectedIntervention: "read_context" },
        },
        metadata: {
          scenario: "coding",
          uncertaintyType: "context",
          reportingViews: ["value_aligned_result"],
          contextProbeClass: "explicit_artifact_handle",
        },
      },
    ];

    const datasetDetail = store.importDataset({
      name: "Dual Reporting Test Dataset",
      content: JSON.stringify(dataset),
      sourceFormat: "json",
    });

    const runDetail = await store.startRun({
      datasetId: datasetDetail.dataset.id,
      profileId: "outcome",
      configs: [{ id: "record", label: "Record", runConfig: { pattern: "solo_agent" } }],
      repetitions: 1,
      concurrency: 1,
      timeoutMs: 30_000,
      metadata: {
        evalV2Reporting: true,
      },
    }, async ({ input }) => makeSnapshot(input.prompt, "done"));

    const report = store.generateReport({ evaluationRunId: runDetail.run.id });
    const viewById = new Map(report.scorecard.reportingViews.map((view) => [view.viewId, view]));

    expect(viewById.get("legacy_oracle_result")?.caseCount).toBe(2);
    expect(viewById.get("value_aligned_result")?.caseCount).toBe(2);
    expect(viewById.get("legacy_oracle_result")?.configSummaries[0]?.caseCount).toBe(2);
    expect(viewById.get("value_aligned_result")?.configSummaries[0]?.caseCount).toBe(2);

    expect(report.slices).toEqual(expect.arrayContaining([
      expect.objectContaining({ dimension: "reportingView", value: "legacy_oracle_result" }),
      expect.objectContaining({ dimension: "reportingView", value: "value_aligned_result" }),
      expect.objectContaining({ dimension: "reportingMembership", value: "explicit_reporting_view" }),
      expect.objectContaining({ dimension: "reportingMembership", value: "shared_default_view" }),
      expect.objectContaining({ dimension: "contextProbeClass", value: "explicit_artifact_handle" }),
      expect.objectContaining({ dimension: "decisionSurface", value: "read_context" }),
    ]));

    const markdown = store.formatReport({ evaluationRunId: runDetail.run.id, format: "markdown" });
    expect(markdown).toContain("### Reporting Membership");
    expect(markdown).toContain("Read this section first.");
    expect(markdown).toContain("| Membership | Cases | Record |");
    expect(markdown).toContain("### Dual Reporting");
    expect(markdown).toContain("Legacy Oracle Result");
    expect(markdown).toContain("Value Aligned Result");
  });

  it("preserves run trace ids for timed out attempts and aborts the executor", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ora-eval-timeout-trace-"));
    tempDirs.push(dir);
    const store = new LocalEvaluationStore(dir);
    const datasetDetail = store.importDataset({
      name: "Timeout Trace Dataset",
      content: JSON.stringify([{
        id: "case-timeout-trace",
        input: { prompt: "慢一点，但要有 trace。", context: {} },
        expected: { text: "done" },
        metadata: {},
      }]),
      sourceFormat: "json",
    });

    let aborted = false;
    const runDetail = await store.startRun({
      datasetId: datasetDetail.dataset.id,
      profileId: "outcome",
      configs: [{ id: "record", label: "Record", runConfig: { pattern: "solo_agent" } }],
      repetitions: 1,
      concurrency: 1,
      timeoutMs: 20,
    }, ({ input, signal, onStarted }) => {
      onStarted?.({
        runId: "run-timeout-trace-1",
        sessionId: "session-timeout-trace-1",
        turnIndex: 1,
        status: "running",
        pattern: "solo_agent",
        startedAt: Date.now(),
      });
      return new Promise<StateSnapshot>((resolve) => {
        signal?.addEventListener("abort", () => {
          aborted = true;
          resolve({
            ...makeSnapshot(input.prompt, "cancelled-after-timeout"),
            runId: "run-timeout-trace-1",
            sessionId: "session-timeout-trace-1",
            status: "cancelled",
          });
        }, { once: true });
      });
    });

    expect(aborted).toBe(true);
    expect(runDetail.run.failedAttempts).toBe(1);
    expect(runDetail.attempts[0]?.status).toBe("timeout");
    expect(runDetail.attempts[0]?.underlyingRunId).toBe("run-timeout-trace-1");
    expect(runDetail.attempts[0]?.runtimeMs).toBe(20);
    expect(runDetail.run.caseResults[0]?.traceRunIds).toEqual(["run-timeout-trace-1"]);
  });

  it("allocates unique dataset ids across sqlite-backed store instances", () => {
    const dir = mkdtempSync(join(tmpdir(), "ora-eval-sqlite-dataset-id-"));
    tempDirs.push(dir);
    const dbPath = join(dir, "evaluation.db");
    const storeA = new LocalEvaluationStore(dbPath);
    const storeB = new LocalEvaluationStore(dbPath);

    const datasetA = storeA.importDataset({
      name: "Dataset A",
      content: JSON.stringify([{ id: "case-a", input: { prompt: "A", context: {} }, expected: { text: "done" } }]),
      sourceFormat: "json",
    });
    const datasetB = storeB.importDataset({
      name: "Dataset B",
      content: JSON.stringify([{ id: "case-b", input: { prompt: "B", context: {} }, expected: { text: "done" } }]),
      sourceFormat: "json",
    });

    expect(datasetA.dataset.id).toBe("dataset-0001");
    expect(datasetB.dataset.id).toBe("dataset-0002");

    const reloaded = new LocalEvaluationStore(dbPath);
    const listed = reloaded.listDatasets();
    expect(listed).toHaveLength(2);
    expect(listed.map((dataset) => dataset.id).sort()).toEqual(["dataset-0001", "dataset-0002"]);
    expect(listed.map((dataset) => dataset.name).sort()).toEqual(["Dataset A", "Dataset B"]);
  });
});
