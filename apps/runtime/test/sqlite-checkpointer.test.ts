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
        config: { pattern: "generator_verifier", metadata: { langGraphOrchestration: true } }
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
      pattern: "generator_verifier",
      text: expect.stringContaining("[local-smoke]"),
      generator: {
        candidate: expect.stringContaining("[local-smoke]")
      },
      verifier: {
        verdict: "pass",
        notes: expect.stringContaining("[local-smoke]")
      }
    });
    expect(state.events.map((event) => event.type)).toContain("checkpoint.created");
    expect(state.events.map((event) => event.type)).toContain("run.done");
    expect(state.checkpoints).toHaveLength(1);

    checkpointer.close();
  });

  it("routes interrupt, resume, cancel, and state through the enabled SessionManager lifecycle", async () => {
    const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), "ora-langgraph-lifecycle-"));
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
        input: { prompt: "Exercise the managed lifecycle." },
        config: { pattern: "agent_teams", metadata: { langGraphOrchestration: true } },
      },
    }) as { runId: string };

    const interrupted = StateSnapshotSchema.parse(
      await handle({
        jsonrpc: "2.0",
        id: 2,
        method: "runs.interrupt",
        params: {
          runId: run.runId,
          reason: "Pause the managed run.",
        },
      }),
    );
    expect(interrupted.status).toBe("interrupted");
    expect(interrupted.events.at(-1)?.type).toBe("run.interrupted");

    const stateAfterInterrupt = StateSnapshotSchema.parse(
      await handle({
        jsonrpc: "2.0",
        id: 3,
        method: "runs.state",
        params: { runId: run.runId },
      }),
    );
    expect(stateAfterInterrupt.status).toBe("interrupted");

    const resumed = StateSnapshotSchema.parse(
      await handle({
        jsonrpc: "2.0",
        id: 4,
        method: "runs.resume",
        params: { runId: run.runId, reason: "Continue the managed run." },
      }),
    );
    expect(resumed.status).toBe("succeeded");
    expect(resumed.events.map((event) => event.type)).toContain("run.resumed");

    const cancelled = StateSnapshotSchema.parse(
      await handle({
        jsonrpc: "2.0",
        id: 5,
        method: "runs.cancel",
        params: { runId: run.runId, reason: "Stop the managed run." },
      }),
    );
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.events.at(-1)?.type).toBe("run.cancelled");

    checkpointer.close();
  });

  it("pauses a graph node for clarification and resumes it with Command-backed answers", async () => {
    const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), "ora-langgraph-clarify-"));
    const dbPath = createTempDbPath();
    const checkpointer = createOraSqliteCheckpointer({ dbPath });
    const store = new LocalRunStore({ dataDir: path.join(storeDir, "runtime.db") });
    const manager = new SessionManager(true, { checkpointer });
    const handle = createRuntimeMethodHandler(store, manager);

    const cloned = await handle({
      jsonrpc: "2.0",
      id: 1,
      method: "modes.cloneFromPreset",
      params: {
        sourceModeId: "orchestrator_subagent",
        modeId: "langgraph-clarification-mode",
        label: "LangGraph Clarification Mode",
      },
    }) as any;

    await handle({
      jsonrpc: "2.0",
      id: 2,
      method: "modes.update",
      params: {
        modeId: cloned.id,
        spec: {
          ...cloned,
          nodes: cloned.nodes.map((node: any) =>
            node.id === "research"
              ? {
                  ...node,
                  config: {
                    ...node.config,
                    clarificationQuestion: "What scope should research use?",
                  },
                }
              : node,
          ),
        },
      },
    });

    const run = await handle({
      jsonrpc: "2.0",
      id: 3,
      method: "runs.start",
      params: {
        input: { prompt: "Clarify the managed graph." },
        config: { modeId: cloned.id, metadata: { disableDefaultWebTools: true, langGraphOrchestration: true } },
      },
    }) as { runId: string; status: string };

    const blocked = StateSnapshotSchema.parse(
      await handle({
        jsonrpc: "2.0",
        id: 4,
        method: "runs.state",
        params: { runId: run.runId },
      }),
    );
    expect(run.status).toBe("interrupted");
    expect(blocked.pendingClarifications).toHaveLength(1);
    expect(blocked.pendingClarifications[0]).toMatchObject({
      nodeId: "research",
      key: "research",
    });
    expect(blocked.events.map((event) => event.type)).toContain("clarification.required");

    const resumed = StateSnapshotSchema.parse(
      await handle({
        jsonrpc: "2.0",
        id: 5,
        method: "runs.resume",
        params: {
          runId: run.runId,
          patch: {
            clarifications: {
              research: "Focus on runtime graph behavior.",
            },
          },
        },
      }),
    );

    expect(resumed.status).toBe("succeeded");
    expect(resumed.pendingClarifications).toEqual([]);
    expect(resumed.events.map((event) => event.type)).toContain("run.resumed");
    expect(resumed.events.map((event) => event.type)).toContain("clarification.resolved");
    expect(resumed.input.context.clarifications).toMatchObject({
      research: "Focus on runtime graph behavior.",
    });
    expect(resumed.output).toMatchObject({
      pattern: "orchestrator_subagent",
      text: expect.stringContaining("Orchestrated result"),
    });

    checkpointer.close();
  });

  it("pauses each graph node for manual approval and resumes node-by-node with approved action ids", async () => {
    const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), "ora-langgraph-approval-"));
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
        input: { prompt: "Approve the first graph node." },
        config: {
          pattern: "orchestrator_subagent",
          metadata: { approvalMode: "manual", disableDefaultWebTools: true, langGraphOrchestration: true },
        },
      },
    }) as { runId: string; status: string };

    const blocked = StateSnapshotSchema.parse(
      await handle({
        jsonrpc: "2.0",
        id: 2,
        method: "runs.state",
        params: { runId: run.runId },
      }),
    );

    expect(run.status).toBe("interrupted");
    expect(blocked.pendingApprovals).toEqual([`${run.runId}:action:graph-decompose`]);
    expect(blocked.actions[0]?.status).toBe("approval_required");
    expect(blocked.events.map((event) => event.type)).toContain("approval.required");

    const resumedOnce = StateSnapshotSchema.parse(
      await handle({
        jsonrpc: "2.0",
        id: 3,
        method: "runs.resume",
        params: {
          runId: run.runId,
          patch: {
            approvedActionIds: [`${run.runId}:action:graph-decompose`],
          },
        },
      }),
    );

    expect(resumedOnce.status).toBe("interrupted");
    expect(resumedOnce.pendingApprovals).toEqual([`${run.runId}:action:graph-research`]);
    expect(resumedOnce.events.map((event) => event.type)).toContain("approval.resolved");

    const resumedTwice = StateSnapshotSchema.parse(
      await handle({
        jsonrpc: "2.0",
        id: 4,
        method: "runs.resume",
        params: {
          runId: run.runId,
          patch: {
            approvedActionIds: [`${run.runId}:action:graph-research`],
          },
        },
      }),
    );

    expect(resumedTwice.status).toBe("interrupted");
    expect(resumedTwice.pendingApprovals).toEqual([`${run.runId}:action:graph-review`]);

    const resumedFinally = StateSnapshotSchema.parse(
      await handle({
        jsonrpc: "2.0",
        id: 5,
        method: "runs.resume",
        params: {
          runId: run.runId,
          patch: {
            approvedActionIds: [`${run.runId}:action:graph-review`],
          },
        },
      }),
    );

    expect(resumedFinally.status).toBe("succeeded");
    expect(resumedFinally.pendingApprovals).toEqual([]);
    expect(
      resumedFinally.events.filter((event) => event.type === "approval.resolved").map((event) => event.payload),
    ).toHaveLength(3);
    expect(resumedFinally.output).toMatchObject({
      pattern: "orchestrator_subagent",
      orchestrator: {
        plan: expect.stringContaining("[local-smoke]"),
      },
    });

    checkpointer.close();
  });

  it("only pauses high-risk graph nodes when approval mode is high_risk_only", async () => {
    const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), "ora-langgraph-high-risk-"));
    const dbPath = createTempDbPath();
    const checkpointer = createOraSqliteCheckpointer({ dbPath });
    const store = new LocalRunStore({ dataDir: path.join(storeDir, "runtime.db") });
    const manager = new SessionManager(true, { checkpointer });
    const handle = createRuntimeMethodHandler(store, manager);

    const cloned = await handle({
      jsonrpc: "2.0",
      id: 1,
      method: "modes.cloneFromPreset",
      params: {
        sourceModeId: "orchestrator_subagent",
        modeId: "langgraph-high-risk-mode",
        label: "LangGraph High Risk Mode",
      },
    }) as any;

    await handle({
      jsonrpc: "2.0",
      id: 2,
      method: "modes.update",
      params: {
        modeId: cloned.id,
        spec: {
          ...cloned,
          nodes: cloned.nodes.map((node: any) =>
            node.id === "review"
              ? { ...node, riskLevel: "high" }
              : node
          ),
        },
      },
    });

    const run = await handle({
      jsonrpc: "2.0",
      id: 3,
      method: "runs.start",
      params: {
        input: { prompt: "Only pause the risky review node." },
        config: {
          modeId: cloned.id,
          approvalMode: "high_risk_only",
          metadata: { disableDefaultWebTools: true, langGraphOrchestration: true },
        },
      },
    }) as { runId: string; status: string };

    const blocked = StateSnapshotSchema.parse(
      await handle({
        jsonrpc: "2.0",
        id: 4,
        method: "runs.state",
        params: { runId: run.runId },
      }),
    );

    expect(run.status).toBe("interrupted");
    expect(blocked.pendingApprovals).toEqual([`${run.runId}:action:graph-review`]);
    expect(blocked.actions.find((action) => action.id === `${run.runId}:action:graph-review`)?.riskLevel).toBe("high");

    const resumed = StateSnapshotSchema.parse(
      await handle({
        jsonrpc: "2.0",
        id: 5,
        method: "runs.resume",
        params: {
          runId: run.runId,
          patch: {
            approvedActionIds: [`${run.runId}:action:graph-review`],
          },
        },
      }),
    );

    expect(resumed.status).toBe("succeeded");
    expect(resumed.pendingApprovals).toEqual([]);
    expect(resumed.events.map((event) => event.type)).toContain("approval.resolved");
    expect(resumed.output).toMatchObject({
      pattern: "orchestrator_subagent",
      orchestrator: {
        plan: expect.stringContaining("[local-smoke]"),
      },
    });

    checkpointer.close();
  });
});
