import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { OraEventEnvelope, StateSnapshot } from "@cemeworm/shared";
import { LocalEvaluationStore } from "../src/evaluation-store.js";

const BASE_TIME = 1_714_100_000_000;

function event(seq: number, type: OraEventEnvelope["type"], payload: unknown = {}): OraEventEnvelope {
  return {
    id: `judge-sync:evt-${seq}`,
    runId: "judge-sync-run",
    seq,
    type,
    createdAt: BASE_TIME + seq * 10,
    pattern: "orchestrator_subagent",
    payload,
  } as OraEventEnvelope;
}

function snapshot(output: string): StateSnapshot {
  return {
    runId: "judge-sync-run",
    turnIndex: 1,
    status: "succeeded",
    pattern: "orchestrator_subagent",
    coordinationKind: "orchestrator_subagent",
    modeId: "orchestrator_subagent",
    input: { prompt: "Answer with evidence.", createdAt: BASE_TIME, context: {} },
    config: {
      pattern: "orchestrator_subagent",
      modeId: "orchestrator_subagent",
      modeSelection: "manual",
      profileIds: [],
      providerId: "judge-provider",
      modelRef: "judge-provider-model",
      approvalMode: "high_risk_only",
      permissionMode: "default",
      patternOptions: {},
      metadata: {},
      deterministicSeed: "evaluation-scorer-contract-test",
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
    toolCalls: [],
    continuation: { frames: [] },
    conversation: [],
    contextState: {
      activeTokenUsage: { inputTokens: 600, outputTokens: 120, totalTokens: 720, source: "provider" },
      compactedHistory: [],
      compactedThroughTurnIndex: 0,
      compactionCount: 0,
    },
    toolResults: [],
    policyDecisions: [],
    checkpoints: [],
    events: [
      event(0, "run.started"),
      event(1, "context.usage.updated", {
        usage: { inputTokens: 600, outputTokens: 120, totalTokens: 720, source: "provider" },
      }),
      event(2, "run.completed"),
    ],
    agentMessages: [],
    artifacts: [],
    activeAgents: [],
    queueSummary: { mode: "dag", pending: 0, inProgress: 0, completed: 0, topics: [] },
    sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
    busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
    pendingClarifications: [],
    pendingApprovals: [],
    output,
    updatedAt: BASE_TIME + 1_000,
  } as unknown as StateSnapshot;
}

let tempDir = "";

afterEach(() => {
  if (tempDir) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    tempDir = "";
  }
});

describe("evaluation scorer contract", () => {
  it("syncs explicit llm_judge results back into llm_judge_score metrics", async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ora-eval-scorer-contract-"));
    const store = new LocalEvaluationStore(tempDir, () => BASE_TIME);
    const previousFetch = globalThis.fetch;
    const previousKey = process.env.LLM_JUDGE_EVAL_KEY;
    process.env.LLM_JUDGE_EVAL_KEY = "test";
    globalThis.fetch = (async (_input, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        messages?: Array<{ role: string; content?: string }>;
      };
      const systemText = body.messages
        ?.filter((message) => message.role === "system")
        .map((message) => message.content ?? "")
        .join("\n") ?? "";
      const content = systemText.includes("LLM evaluation judge")
        ? JSON.stringify({ score: 0.92, pass: true, rationale: "Meets the rubric.", failureTags: [] })
        : "Candidate answer with required evidence.";
      return new Response(JSON.stringify({
        choices: [{ message: { role: "assistant", content } }],
      }), { status: 200 });
    }) as typeof fetch;

    try {
      const dataset = store.importDataset({
        name: "LLM Judge Sync Dataset",
        sourceFileName: "judge-sync.json",
        sourceFormat: "json",
        content: JSON.stringify([{
          id: "case-1",
          prompt: "Answer with evidence.",
          expected: "Candidate answer with required evidence.",
        }]),
      });

      const detail = await store.startRun({
        datasetId: dataset.dataset.id,
        profileId: "outcome",
        objective: {
          kind: "outcome",
          target: "run.output",
          metrics: ["task_success_rate", "llm_judge_score"],
          evaluators: [
            {
              id: "heuristic",
              kind: "heuristic",
              label: "Heuristic",
              weight: 1,
              metrics: ["task_success_rate", "llm_judge_score"],
              assertions: [],
            },
            {
              id: "llm-judge",
              kind: "llm_judge",
              label: "LLM Judge",
              rubric: "Pass if the answer includes required evidence.",
              providerId: "judge-provider",
              modelRef: "judge-provider-model",
              passThreshold: 0.75,
              weight: 1,
            },
          ],
        },
        configs: [{
          id: "judge-config",
          label: "Judge Config",
          runConfig: {
            pattern: "orchestrator_subagent",
            providerId: "judge-provider",
            modelRef: "judge-provider-model",
            providerConfig: {
              id: "judge-provider",
              label: "Judge Provider",
              type: "openai_compatible",
              modelId: "judge-provider-model",
              baseUrl: "https://llm-judge-eval.test/v1",
              apiKeyEnv: "LLM_JUDGE_EVAL_KEY",
              capabilities: ["chat"],
              headers: {},
            },
          },
        }],
      }, async () => snapshot("Candidate answer with required evidence."));

      expect(detail.attempts[0]?.evaluatorResults.find((result) => result.evaluatorId === "llm-judge")).toMatchObject({
        evaluatorKind: "llm_judge",
        score: 0.92,
        passed: true,
      });
      expect(detail.attempts[0]?.metricScores.find((metric) => metric.metricId === "llm_judge_score")).toMatchObject({
        score: 0.92,
        passed: true,
        details: expect.objectContaining({ source: "explicit_llm_judge" }),
      });
      expect(detail.run.caseResults[0]?.metricScores.find((metric) => metric.metricId === "llm_judge_score")?.score).toBe(0.92);
    } finally {
      globalThis.fetch = previousFetch;
      if (previousKey === undefined) {
        delete process.env.LLM_JUDGE_EVAL_KEY;
      } else {
        process.env.LLM_JUDGE_EVAL_KEY = previousKey;
      }
    }
  });
});
