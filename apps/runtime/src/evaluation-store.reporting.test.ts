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
      expect.objectContaining({ dimension: "contextProbeClass", value: "explicit_artifact_handle" }),
      expect.objectContaining({ dimension: "decisionSurface", value: "read_context" }),
    ]));

    const markdown = store.formatReport({ evaluationRunId: runDetail.run.id, format: "markdown" });
    expect(markdown).toContain("### Dual Reporting");
    expect(markdown).toContain("Legacy Oracle Result");
    expect(markdown).toContain("Value Aligned Result");
  });
});
