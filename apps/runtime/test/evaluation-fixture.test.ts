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

  function writeRepoFixture(root: string) {
    const sourceRoot = path.join(root, "repo");
    fs.mkdirSync(path.join(sourceRoot, "src"), { recursive: true });
    fs.mkdirSync(path.join(sourceRoot, "apps", "desktop", "node_modules"), { recursive: true });
    fs.mkdirSync(path.join(sourceRoot, "packages", "shared", "node_modules"), { recursive: true });
    fs.writeFileSync(path.join(sourceRoot, "package.json"), JSON.stringify({ name: "fixture-repo", private: true }, null, 2), "utf8");
    fs.writeFileSync(path.join(sourceRoot, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n", "utf8");
    fs.writeFileSync(path.join(sourceRoot, "AGENTS.md"), "fixture agents", "utf8");
    fs.writeFileSync(path.join(sourceRoot, "src", "sample.ts"), "export const value = 'fixture';\n", "utf8");
    fs.mkdirSync(path.join(sourceRoot, "node_modules", "left-pad"), { recursive: true });
    fs.writeFileSync(path.join(sourceRoot, "node_modules", "left-pad", "index.js"), "module.exports = 'skip';\n", "utf8");
    fs.mkdirSync(path.join(sourceRoot, ".ora"), { recursive: true });
    fs.writeFileSync(path.join(sourceRoot, ".ora", "state.json"), "{\"skip\":true}\n", "utf8");
    fs.mkdirSync(path.join(sourceRoot, "apps", "desktop", "src-tauri", "target", "debug"), { recursive: true });
    fs.writeFileSync(path.join(sourceRoot, "apps", "desktop", "src-tauri", "target", "debug", "artifact.o"), "skip\n", "utf8");
    return sourceRoot;
  }

  function writeFixtureManifest(root: string, extra: Record<string, unknown> = {}) {
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
      workspacePreparation: {
        strategy: "pnpm_install_frozen",
        cwd: ".",
        verifyNodeModules: true,
        verifyPaths: [
          "apps/desktop/node_modules/vitest",
          "packages/shared/node_modules/vitest",
          "apps/desktop/node_modules/@cemeworm/shared",
        ],
      },
      ...extra,
    }, null, 2));
    return { fixtureDir, manifestPath };
  }

  it("materializes isolated per-attempt workspaces from a fixture manifest", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ora-eval-fixture-"));
    tempRoots.push(root);
    const sourceRoot = writeRepoFixture(root);
    const { fixtureDir, manifestPath } = writeFixtureManifest(root);
    const preparationCalls: Array<{ command: string; args: string[]; cwd: string }> = [];
    const store = new LocalEvaluationStore(path.join(root, "store"), {
      clock: () => BASE_TIME,
      fixturePreparationCommandRunner: ({ command, args, cwd }) => {
        preparationCalls.push({ command, args, cwd });
        fs.mkdirSync(path.join(cwd, "apps", "desktop", "node_modules"), { recursive: true });
        fs.mkdirSync(path.join(cwd, "packages", "shared", "node_modules"), { recursive: true });
        fs.mkdirSync(path.join(cwd, "apps", "desktop", "node_modules", "@cemeworm"), { recursive: true });
        fs.writeFileSync(path.join(cwd, "apps", "desktop", "node_modules", "vitest"), "", "utf8");
        fs.writeFileSync(path.join(cwd, "packages", "shared", "node_modules", "vitest"), "", "utf8");
        fs.symlinkSync(
          path.join(cwd, "packages", "shared"),
          path.join(cwd, "apps", "desktop", "node_modules", "@cemeworm", "shared"),
        );
      },
    });
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
      expect(fs.existsSync(path.join(workspace.rootPath!, "apps", "desktop", "node_modules", "vitest"))).toBe(true);
      expect(fs.existsSync(path.join(workspace.rootPath!, "packages", "shared", "node_modules", "vitest"))).toBe(true);
      const sharedLink = path.join(workspace.rootPath!, "apps", "desktop", "node_modules", "@cemeworm", "shared");
      expect(fs.existsSync(sharedLink)).toBe(true);

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
    expect(preparationCalls).toHaveLength(2);
    expect(preparationCalls[0]).toMatchObject({
      command: "pnpm",
      args: ["install", "--frozen-lockfile"],
    });

    const workspaceRoot = path.join(fixtureDir, "workspaces", detail.run.id, "case-1");
    expect(fs.existsSync(path.join(workspaceRoot, "memory-disabled", "rep-1", "attempt-marker.txt"))).toBe(true);
    expect(fs.existsSync(path.join(workspaceRoot, "memory-enabled", "rep-1", "attempt-marker.txt"))).toBe(true);
  }, 20_000);

  it("fails attempts before execution when fixture preparation fails", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ora-eval-fixture-"));
    tempRoots.push(root);
    const sourceRoot = writeRepoFixture(root);
    const { manifestPath } = writeFixtureManifest(root);
    const store = new LocalEvaluationStore(path.join(root, "store"), {
      clock: () => BASE_TIME,
      fixturePreparationCommandRunner: () => {
        throw new Error("pnpm install exploded");
      },
    });
    const dataset = store.importDataset({
      sourceFormat: "inline",
      content: JSON.stringify([{ id: "case-1", prompt: "检查 fixture workspace 是否独立。" }]),
    });

    let executed = false;
    const detail = await store.startRun({
      datasetId: dataset.dataset.id,
      profileId: "task_completion",
      repetitions: 1,
      concurrency: 1,
      metadata: { fixtureManifest: manifestPath },
      configs: [{
        id: "memory-disabled",
        label: "Memory Disabled",
        runConfig: { pattern: "orchestrator_subagent", modeSelection: "manual" },
      }],
    }, async () => {
      executed = true;
      return snapshot({ runId: "should-not-run" });
    });

    expect(executed).toBe(false);
    expect(detail.attempts).toHaveLength(1);
    expect(detail.attempts[0]?.status).toBe("failed");
    expect(detail.attempts[0]?.error).toContain("fixture_workspace_preparation_failed");
    expect(detail.attempts[0]?.error).toContain("pnpm install exploded");
    expect(fs.existsSync(path.join(sourceRoot, "attempt-marker.txt"))).toBe(false);
  });

  it("fails attempts before execution when fixture verification fails", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ora-eval-fixture-"));
    tempRoots.push(root);
    writeRepoFixture(root);
    const { manifestPath } = writeFixtureManifest(root);
    const store = new LocalEvaluationStore(path.join(root, "store"), {
      clock: () => BASE_TIME,
      fixturePreparationCommandRunner: ({ cwd }) => {
        fs.mkdirSync(path.join(cwd, "apps", "desktop", "node_modules"), { recursive: true });
        fs.writeFileSync(path.join(cwd, "apps", "desktop", "node_modules", "vitest"), "", "utf8");
      },
    });
    const dataset = store.importDataset({
      sourceFormat: "inline",
      content: JSON.stringify([{ id: "case-1", prompt: "检查 fixture workspace 是否独立。" }]),
    });

    const detail = await store.startRun({
      datasetId: dataset.dataset.id,
      profileId: "task_completion",
      repetitions: 1,
      concurrency: 1,
      metadata: { fixtureManifest: manifestPath },
      configs: [{
        id: "memory-disabled",
        label: "Memory Disabled",
        runConfig: { pattern: "orchestrator_subagent", modeSelection: "manual" },
      }],
    }, async () => snapshot({ runId: "should-not-run" }));

    expect(detail.attempts).toHaveLength(1);
    expect(detail.attempts[0]?.status).toBe("failed");
    expect(detail.attempts[0]?.error).toContain("fixture_workspace_verification_failed");
    expect(detail.attempts[0]?.error).toContain("packages/shared/node_modules/vitest");
  });
});
