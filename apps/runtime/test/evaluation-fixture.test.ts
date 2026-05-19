import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { StateSnapshot } from "@cemeworm/shared";
import { LocalEvaluationStore } from "../src/evaluation-store.js";

const BASE_TIME = 1_715_000_000_000;

function snapshot(params: {
  runId: string;
  output?: unknown;
  updatedAt?: number;
}): StateSnapshot {
  return {
    runId: params.runId,
    turnIndex: 1,
    status: "succeeded",
    pattern: "orchestrator_subagent",
    coordinationKind: "orchestrator_subagent",
    modeId: "orchestrator_subagent",
    input: { prompt: "Fixture eval.", createdAt: BASE_TIME, context: {} },
    config: {
      pattern: "orchestrator_subagent",
      modeSelection: "manual",
      profileIds: [],
      approvalMode: "high_risk_only",
      permissionMode: "default",
      patternOptions: {},
      metadata: {},
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
      activeTokenUsage: { inputTokens: 10, outputTokens: 10, totalTokens: 20, source: "estimate" },
      compactedHistory: [],
      compactedThroughTurnIndex: 0,
      compactionCount: 0,
    },
    toolResults: [],
    policyDecisions: [],
    checkpoints: [],
    events: [],
    agentMessages: [],
    artifacts: [],
    activeAgents: [],
    queueSummary: { mode: "dag", pending: 0, inProgress: 0, completed: 0, topics: [] },
    sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
    busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
    pendingClarifications: [],
    pendingApprovals: [],
    output: params.output ?? "Done.",
    updatedAt: params.updatedAt ?? BASE_TIME + 100,
  } as unknown as StateSnapshot;
}

describe("evaluation workspace fixtures", () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    while (tempRoots.length > 0) {
      fs.rmSync(tempRoots.pop()!, { recursive: true, force: true });
    }
  });

  it("materializes isolated per-attempt workspaces from a fixture manifest", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ora-eval-fixture-"));
    tempRoots.push(root);

    const sourceRoot = path.join(root, "repo");
    fs.mkdirSync(path.join(sourceRoot, "src"), { recursive: true });
    fs.writeFileSync(path.join(sourceRoot, "AGENTS.md"), "fixture agents", "utf8");
    fs.writeFileSync(path.join(sourceRoot, "src", "sample.ts"), "export const value = 'fixture';\n", "utf8");
    fs.mkdirSync(path.join(sourceRoot, "node_modules", "left-pad"), { recursive: true });
    fs.writeFileSync(path.join(sourceRoot, "node_modules", "left-pad", "index.js"), "module.exports = 'skip';\n", "utf8");
    fs.mkdirSync(path.join(sourceRoot, ".ora"), { recursive: true });
    fs.writeFileSync(path.join(sourceRoot, ".ora", "state.json"), "{\"skip\":true}\n", "utf8");
    fs.mkdirSync(path.join(sourceRoot, "apps", "desktop", "src-tauri", "target", "debug"), { recursive: true });
    fs.writeFileSync(path.join(sourceRoot, "apps", "desktop", "src-tauri", "target", "debug", "artifact.o"), "skip\n", "utf8");

    const fixtureDir = path.join(root, "fixture");
    fs.mkdirSync(fixtureDir, { recursive: true });
    const manifestPath = path.join(fixtureDir, "fixture.manifest.json");
    fs.writeFileSync(manifestPath, JSON.stringify({
      schemaVersion: 1,
      fixtureId: "memory-long-task-representative",
      sourceRoot: "../repo",
      materializationRoot: "./workspaces",
      isolation: {
        strategy: "copy",
        resetBetweenAttempts: true,
        exclude: [".git", ".ora", "node_modules", "apps/desktop/src-tauri/target"],
      },
      projectWorkspace: {
        label: "Memory Eval Fixture",
      },
    }, null, 2));

    const store = new LocalEvaluationStore(path.join(root, "store"), () => BASE_TIME);
    const dataset = store.importDataset({
      sourceFormat: "inline",
      content: JSON.stringify([{
        id: "case-1",
        prompt: "检查 fixture workspace 是否独立。",
      }]),
    });

    const observedWorkspaces: string[] = [];
    const detail = await store.startRun({
      datasetId: dataset.dataset.id,
      profileId: "task_completion",
      repetitions: 1,
      concurrency: 1,
      metadata: {
        fixtureManifest: manifestPath,
      },
      configs: [
        {
          id: "memory-disabled",
          label: "Memory Disabled",
          runConfig: {
            pattern: "orchestrator_subagent",
            modeSelection: "manual",
            metadata: {
              evaluationMemoryMode: "disabled",
            },
          },
        },
        {
          id: "memory-enabled",
          label: "Memory Enabled",
          runConfig: {
            pattern: "orchestrator_subagent",
            modeSelection: "manual",
            metadata: {
              evaluationMemoryMode: "enabled",
            },
          },
        },
      ],
    }, async ({ input, config }) => {
      const workspace = input.context?.projectWorkspace as { label?: string; rootPath?: string };
      expect(workspace.label).toBe("Memory Eval Fixture");
      expect(typeof workspace.rootPath).toBe("string");
      expect(fs.existsSync(path.join(workspace.rootPath!, "AGENTS.md"))).toBe(true);
      expect(fs.existsSync(path.join(workspace.rootPath!, "src", "sample.ts"))).toBe(true);
      expect(fs.existsSync(path.join(workspace.rootPath!, "node_modules"))).toBe(false);
      expect(fs.existsSync(path.join(workspace.rootPath!, ".ora"))).toBe(false);
      expect(fs.existsSync(path.join(workspace.rootPath!, "apps", "desktop", "src-tauri", "target"))).toBe(false);
      expect(fs.existsSync(path.join(workspace.rootPath!, "attempt-marker.txt"))).toBe(false);

      fs.writeFileSync(
        path.join(workspace.rootPath!, "attempt-marker.txt"),
        String(config.metadata?.evaluationMemoryMode ?? "unknown"),
        "utf8",
      );
      observedWorkspaces.push(workspace.rootPath!);

      return snapshot({
        runId: `run-${String(config.metadata?.evaluationMemoryMode ?? "unknown")}`,
        output: "ok",
      });
    });

    expect(detail.attempts).toHaveLength(2);
    expect(new Set(observedWorkspaces).size).toBe(2);
    expect(fs.existsSync(path.join(sourceRoot, "attempt-marker.txt"))).toBe(false);

    const workspaceRoot = path.join(fixtureDir, "workspaces", detail.run.id, "case-1");
    expect(fs.existsSync(path.join(workspaceRoot, "memory-disabled", "rep-1", "attempt-marker.txt"))).toBe(true);
    expect(fs.existsSync(path.join(workspaceRoot, "memory-enabled", "rep-1", "attempt-marker.txt"))).toBe(true);
  }, 20_000);
});
