import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { RunConfigSchema, StateSnapshotSchema } from "@ora/shared";
import {
  createRuntimeMethodHandler,
  LocalRunStore,
  createOraSqliteCheckpointer,
  createPatternGraphWithCheckpointer,
  SessionManager
} from "../src/index.js";

function createTempDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ora-langgraph-checkpointer-"));
  return path.join(dir, "checkpoints.db");
}

describe("OraSqliteCheckpointer", () => {
  it("persists checkpoints and pending writes across saver instances", async () => {
    const dbPath = createTempDbPath();
    const first = createOraSqliteCheckpointer({ dbPath });

    const checkpoint = {
      v: 4,
      id: "ckpt-2",
      ts: "2026-04-22T00:00:00.000Z",
      channel_values: {
        answer: "yes"
      },
      channel_versions: {
        answer: 1
      },
      versions_seen: {
        __input__: {}
      }
    };
    const metadata = {
      source: "loop" as const,
      step: 1,
      parents: {}
    };

    await first.put(
      { configurable: { thread_id: "thread-1", checkpoint_ns: "" } },
      checkpoint,
      metadata,
      {}
    );
    await first.putWrites(
      {
        configurable: {
          thread_id: "thread-1",
          checkpoint_ns: "",
          checkpoint_id: "ckpt-2"
        }
      },
      [["tasks", "pending-value"]],
      "task-1"
    );
    first.close();

    const second = createOraSqliteCheckpointer({ dbPath });
    const tuple = await second.getTuple({ configurable: { thread_id: "thread-1" } });
    const listed: unknown[] = [];

    for await (const item of second.list({ configurable: { thread_id: "thread-1" } })) {
      listed.push(item);
    }

    expect(tuple?.checkpoint.id).toBe("ckpt-2");
    expect(tuple?.metadata).toEqual(metadata);
    expect(tuple?.pendingWrites).toEqual([["task-1", "tasks", "pending-value"]]);
    expect(listed).toHaveLength(1);

    await second.deleteThread("thread-1");
    expect(await second.getTuple({ configurable: { thread_id: "thread-1" } })).toBeUndefined();
    second.close();
  });
});

describe("LangGraph integration", () => {
  it("compiles graphs with the sqlite checkpointer and stores checkpoints", async () => {
    const dbPath = createTempDbPath();
    const checkpointer = createOraSqliteCheckpointer({ dbPath });
    const { graph } = createPatternGraphWithCheckpointer("generator_verifier", checkpointer);
    const runConfig = RunConfigSchema.parse({ pattern: "generator_verifier" });

    await graph.invoke(
      {
        runId: "run-1",
        pattern: "generator_verifier",
        input: {
          prompt: "Build a deterministic local graph."
        },
        config: runConfig,
        topology: { nodes: [], edges: [] },
        profiles: [],
        memory: [],
        plan: [],
        actions: [],
        policyDecisions: [],
        events: [],
        checkpoints: [],
        artifacts: [],
        output: undefined,
        error: undefined
      },
      { configurable: { thread_id: "thread-graph", checkpoint_ns: "" } }
    );

    const tuples: unknown[] = [];
    for await (const item of checkpointer.list({ configurable: { thread_id: "thread-graph" } })) {
      tuples.push(item);
    }

    expect(tuples.length).toBeGreaterThan(0);
    checkpointer.close();
  });

  it("preserves provider-backed subagent output in the final graph state", async () => {
    const { graph } = createPatternGraphWithCheckpointer("orchestrator_subagent");
    const runConfig = RunConfigSchema.parse({ pattern: "orchestrator_subagent" });

    const result = await graph.invoke(
      {
        runId: "run-provider-output",
        pattern: "orchestrator_subagent",
        input: {
          prompt: "Keep provider output visible."
        },
        config: runConfig,
        topology: { nodes: [], edges: [] },
        profiles: [],
        memory: [],
        plan: [],
        actions: [],
        policyDecisions: [],
        events: [],
        checkpoints: [],
        artifacts: [],
        output: undefined,
        error: undefined
      },
      { configurable: { thread_id: "thread-provider-output", checkpoint_ns: "" } }
    );

    const output = result.output as {
      orchestrator?: { plan?: string };
      subagents?: { researcher?: string; reviewer?: string };
    };

    expect(output.orchestrator?.plan).toContain("[local-smoke]");
    expect(output.subagents?.researcher).toContain("[local-smoke]");
    expect(output.subagents?.reviewer).toContain("[local-smoke]");
  });
});

describe("SessionManager", () => {
  it("keeps the deterministic path disabled when LangGraph is off", async () => {
    const manager = new SessionManager(false);

    expect(manager.isEnabled()).toBe(false);
    await expect(
      manager.startRun(
        "run-1",
        {
          prompt: "Keep deterministic behavior."
        },
        RunConfigSchema.parse({ pattern: "agent_teams" })
      )
    ).resolves.toBeUndefined();
  });

  it("returns a parseable Ora StateSnapshot when LangGraph is enabled", async () => {
    const dbPath = createTempDbPath();
    const checkpointer = createOraSqliteCheckpointer({ dbPath });
    const manager = new SessionManager(true, { checkpointer });

    const snapshot = StateSnapshotSchema.parse(
      await manager.startRun(
        "run-enabled",
        {
          prompt: "Keep provider output visible."
        },
        RunConfigSchema.parse({ pattern: "orchestrator_subagent" })
      )
    );

    expect(snapshot.status).toBe("succeeded");
    expect(snapshot.output).toMatchObject({
      orchestrator: { plan: expect.stringContaining("[local-smoke]") },
      subagents: {
        researcher: expect.stringContaining("[local-smoke]"),
        reviewer: expect.stringContaining("[local-smoke]")
      }
    });
    expect(snapshot.checkpoints).toHaveLength(1);
    expect(snapshot.events.map((event) => event.type)).toContain("checkpoint.created");
    expect(snapshot.events.map((event) => event.type)).toContain("run.done");
    expect(snapshot.topology.nodes.length).toBeGreaterThan(0);
    expect(snapshot.profiles.length).toBeGreaterThan(0);
    expect(snapshot.plan.length).toBeGreaterThan(0);

    checkpointer.close();
  });

  it("persists LangGraph snapshots through the JSON-RPC run service when enabled", async () => {
    const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), "ora-langgraph-store-"));
    const dbPath = createTempDbPath();
    const checkpointer = createOraSqliteCheckpointer({ dbPath });
    const store = new LocalRunStore({ dataDir: path.join(storeDir, "runtime.db") });
    const manager = new SessionManager(true, { checkpointer });
    const handle = createRuntimeMethodHandler(store, manager);

    const run = await handle({
      jsonrpc: "2.0",
      id: 1,
      method: "runs.start",
      params: {
        input: { prompt: "Persist enabled LangGraph state." },
        config: { pattern: "generator_verifier" }
      }
    }) as { runId: string; status: string };
    const state = StateSnapshotSchema.parse(
      await handle({
        jsonrpc: "2.0",
        id: 2,
        method: "runs.state",
        params: { runId: run.runId }
      })
    );

    expect(run.status).toBe("succeeded");
    expect(state.output).toMatchObject({
      candidate: expect.stringContaining("[local-smoke]"),
      verdict: "pass",
      verifierText: expect.stringContaining("[local-smoke]")
    });
    expect(state.events.map((event) => event.type)).toEqual([
      "run.started",
      "checkpoint.created",
      "run.done"
    ]);
    expect(state.checkpoints).toHaveLength(1);

    checkpointer.close();
  });
});
