import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { OraEventEnvelopeSchema, StateSnapshotSchema } from "@ora/shared";
import { LocalRunStore, createRuntimeMethodHandler, handleJsonRpcLine } from "../src/index.js";

function createTempStore() {
  return new LocalRunStore({
    dataDir: fs.mkdtempSync(path.join(os.tmpdir(), "ora-runtime-test-"))
  });
}

function expectOrderedEvents(eventTypes: string[], expected: string[]) {
  let lastIndex = -1;
  for (const eventType of expected) {
    const nextIndex = eventTypes.indexOf(eventType, lastIndex + 1);
    expect(nextIndex).toBeGreaterThan(lastIndex);
    lastIndex = nextIndex;
  }
}

describe("Ora runtime smoke path", () => {
  it("starts a deterministic smoke run with ordered Ora events", async () => {
    const handle = createRuntimeMethodHandler(createTempStore());
    const run = (await handle({
      jsonrpc: "2.0",
      id: 1,
      method: "runs.start",
      params: {
        input: { prompt: "Build a small local smoke path." },
        config: { pattern: "generator_verifier" }
      }
    })) as { runId: string; status: string; pattern: string };

    expect(run.status).toBe("succeeded");
    expect(run.pattern).toBe("generator_verifier");

    const state = StateSnapshotSchema.parse(
      await handle({
        jsonrpc: "2.0",
        id: 2,
        method: "runs.state",
        params: { runId: run.runId }
      })
    );

    const eventTypes = state.events.map((event) => event.type);

    expect(eventTypes.slice(0, 4)).toEqual([
      "run.started",
      "topology.updated",
      "profile.updated",
      "plan.updated"
    ]);
    expectOrderedEvents(eventTypes, [
      "agent.started",
      "tool.called",
      "message.delta",
      "token.delta",
      "agent.completed",
      "memory.updated",
      "run.done",
      "checkpoint.created"
    ]);
    expect(state.events.map((event) => event.seq)).toEqual([...Array(state.events.length).keys()]);
    expect(state.checkpoints).toHaveLength(1);
    expect(state.topology.nodes.length).toBeGreaterThan(1);
    expect(state.profiles.map((profile) => profile.id)).toEqual(["generator", "verifier"]);
    expect(state.actions.length).toBeGreaterThanOrEqual(4);
    expect(state.actions.every((action) => action.status === "succeeded")).toBe(true);
    expect(state.policyDecisions).toEqual([]);
    expect(state.memory[0]?.namespace).toEqual([
      "session",
      "local-project",
      "generator_verifier"
    ]);
    expect(state.plan.every((item) => item.status === "done")).toBe(true);
    expect(state.plan.some((item) => item.linkedActionIds.length > 0)).toBe(true);
    expect(state.pendingApprovals).toEqual([]);
    expect(state.activeAgents).toEqual([]);
    expect(state.output).toMatchObject({
      pattern: "generator_verifier",
      generator: { candidate: expect.stringContaining("[local-smoke]") },
      verifier: { verdict: "pass" }
    });

    for (const event of state.events) {
      expect(OraEventEnvelopeSchema.parse(event).runId).toBe(run.runId);
    }
  });

  it("serves JSON-RPC over newline-delimited request payloads", async () => {
    const response = await handleJsonRpcLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "health-1",
        method: "runtime.health"
      }),
      createRuntimeMethodHandler(createTempStore())
    );

    expect(response).toEqual({
      jsonrpc: "2.0",
      id: "health-1",
      result: {
        ok: true,
        service: "ora-runtime",
        version: "0.1.0",
        deterministic: false,
        persistence: "json-file"
      }
    });
  });

  it("exposes runtime bootstrap, tool list, and skill list from the unified runtime surface", async () => {
    const handle = createRuntimeMethodHandler(createTempStore());
    const bootstrap = await handle({
      jsonrpc: "2.0",
      id: 1,
      method: "runtime.bootstrap"
    }) as {
      health: { ok: boolean; mode: string };
      patterns: { id: string }[];
      tools: { tools: { id: string }[] };
      skills: { skills: { id: string }[] };
    };
    const tools = await handle({
      jsonrpc: "2.0",
      id: 2,
      method: "tools.list"
    }) as { tools: { id: string }[] };
    const skills = await handle({
      jsonrpc: "2.0",
      id: 3,
      method: "skills.list"
    }) as { skills: { id: string }[] };

    expect(bootstrap.health.ok).toBe(true);
    expect(bootstrap.health.mode).toBe("runtime");
    expect(bootstrap.patterns.map((pattern) => pattern.id)).toEqual([
      "generator_verifier",
      "orchestrator_subagent",
      "agent_teams",
      "message_bus",
      "shared_state"
    ]);
    expect(bootstrap.tools.tools.length).toBeGreaterThan(0);
    expect(bootstrap.skills.skills.length).toBeGreaterThan(0);
    expect(tools.tools).toEqual(bootstrap.tools.tools);
    expect(skills.skills).toEqual(bootstrap.skills.skills);
  });

  it("starts all five coordination patterns through the unified runtime kernel", async () => {
    const handle = createRuntimeMethodHandler(createTempStore());
    const patterns = [
      "generator_verifier",
      "orchestrator_subagent",
      "agent_teams",
      "message_bus",
      "shared_state"
    ] as const;

    for (const pattern of patterns) {
      const run = (await handle({
        jsonrpc: "2.0",
        id: `${pattern}-start`,
        method: "runs.start",
        params: {
          input: { prompt: `Smoke ${pattern}.` },
          config: { pattern }
        }
      })) as { runId: string; status: string; pattern: string };
      const state = StateSnapshotSchema.parse(
        await handle({
          jsonrpc: "2.0",
          id: `${pattern}-state`,
          method: "runs.state",
          params: { runId: run.runId }
        })
      );

      expect(run.status).toBe("succeeded");
      expect(run.pattern).toBe(pattern);
      expect(state.status).toBe("succeeded");
      expect(state.pattern).toBe(pattern);
      expect(state.checkpoints).toHaveLength(1);
      expect(state.events.map((event) => event.type)).toContain("checkpoint.created");

      if (pattern === "agent_teams") {
        expect(state.events.map((event) => event.type)).toContain("worker.claimed");
        expect(state.events.map((event) => event.type)).toContain("worker.released");
        expect(state.memory.some((record) => record.kind === "worker")).toBe(true);
      }

      if (pattern === "message_bus") {
        expect(state.busStats.enabled).toBe(true);
        expect(state.busStats.publishedCount).toBeGreaterThan(0);
        expect(state.busStats.routedCount).toBeGreaterThan(0);
        expect(state.queueSummary.topics).toContain("task.response");
      }

      if (pattern === "shared_state") {
        expect(state.sharedStateSummary.enabled).toBe(true);
        expect(state.sharedStateSummary.version).toBeGreaterThan(0);
        expect(state.sharedStateSummary.entries.length).toBeGreaterThan(0);
      }
    }
  });

  it("lists checkpoints and exports a report for a run", async () => {
    const handle = createRuntimeMethodHandler(createTempStore());
    const run = (await handle({
      jsonrpc: "2.0",
      id: 1,
      method: "runs.start",
      params: {
        input: { prompt: "Export report." },
        config: { pattern: "agent_teams" }
      }
    })) as { runId: string };

    const checkpoints = (await handle({
      jsonrpc: "2.0",
      id: 2,
      method: "runs.checkpoints",
      params: { runId: run.runId }
    })) as unknown[];

    const report = (await handle({
      jsonrpc: "2.0",
      id: 3,
      method: "runs.exportReport",
      params: { runId: run.runId }
    })) as { kind: string; uri: string; payload: { eventCount: number } };

    const state = StateSnapshotSchema.parse(
      await handle({
        jsonrpc: "2.0",
        id: 4,
        method: "runs.state",
        params: { runId: run.runId }
      })
    );

    expect(checkpoints).toHaveLength(1);
    expect(report.kind).toBe("report");
    expect(report.uri).toMatch(/^file:\/\//);
    expect(report.payload.eventCount).toBe(state.events.length - 1);
    expect(state.artifacts).toHaveLength(1);
    expect(state.events.at(-1)?.type).toBe("artifact.exported");
  });

  it("persists runs and artifact refs across store instances", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ora-runtime-persist-test-"));
    const firstStore = new LocalRunStore({ dataDir });
    const handleFirst = createRuntimeMethodHandler(firstStore);
    const run = (await handleFirst({
      jsonrpc: "2.0",
      id: 1,
      method: "runs.start",
      params: {
        input: { prompt: "Persist this run." },
        config: { pattern: "orchestrator_subagent" }
      }
    })) as { runId: string };

    await handleFirst({
      jsonrpc: "2.0",
      id: 2,
      method: "runs.exportReport",
      params: { runId: run.runId }
    });

    const handleSecond = createRuntimeMethodHandler(new LocalRunStore({ dataDir }));
    const runs = (await handleSecond({
      jsonrpc: "2.0",
      id: 3,
      method: "runs.list"
    })) as { runId: string; artifactCount: number }[];
    const state = StateSnapshotSchema.parse(
      await handleSecond({
        jsonrpc: "2.0",
        id: 4,
        method: "runs.state",
        params: { runId: run.runId }
      })
    );

    expect(runs.map((summary) => summary.runId)).toContain(run.runId);
    expect(runs.find((summary) => summary.runId === run.runId)?.artifactCount).toBe(1);
    expect(state.artifacts[0]?.uri).toMatch(/^file:\/\//);
  });

  it("returns ordered event streams after an optional sequence", async () => {
    const handle = createRuntimeMethodHandler(createTempStore());
    const run = (await handle({
      jsonrpc: "2.0",
      id: 1,
      method: "runs.start",
      params: {
        input: { prompt: "Stream from the middle." },
        config: { pattern: "generator_verifier" }
      }
    })) as { runId: string };

    const stream = (await handle({
      jsonrpc: "2.0",
      id: 2,
      method: "runs.stream",
      params: { runId: run.runId, afterSeq: 2 }
    })) as { fromSeq: number; nextSeq: number; events: { seq: number; type: string }[] };
    const state = StateSnapshotSchema.parse(
      await handle({
        jsonrpc: "2.0",
        id: 3,
        method: "runs.state",
        params: { runId: run.runId }
      })
    );
    const expectedEvents = state.events.filter((event) => event.seq >= 3);

    expect(stream.fromSeq).toBe(3);
    expect(stream.nextSeq).toBe(state.events.length);
    expect(stream.events).toEqual(expectedEvents);
  });

  it("resumes an interrupted run with an Ora-owned transition event", async () => {
    const handle = createRuntimeMethodHandler(createTempStore());
    const run = (await handle({
      jsonrpc: "2.0",
      id: 1,
      method: "runs.start",
      params: {
        input: { prompt: "Resume this local run." },
        config: { pattern: "orchestrator_subagent" }
      }
    })) as { runId: string };

    const interrupted = StateSnapshotSchema.parse(
      await handle({
        jsonrpc: "2.0",
        id: 2,
        method: "runs.interrupt",
        params: { runId: run.runId, reason: "Test pause." }
      })
    );
    const resumed = StateSnapshotSchema.parse(
      await handle({
        jsonrpc: "2.0",
        id: 3,
        method: "runs.resume",
        params: { runId: run.runId, patch: { approved: true } }
      })
    );

    expect(interrupted.status).toBe("interrupted");
    expect(resumed.status).toBe("succeeded");
    expect(resumed.events.slice(-3).map((event) => event.type)).toEqual([
      "run.resumed",
      "checkpoint.created",
      "run.done"
    ]);
    expect(resumed.checkpoints).toHaveLength(2);
  });

  it("pauses manual high-risk actions until resume approves the action", async () => {
    const handle = createRuntimeMethodHandler(createTempStore());
    const run = (await handle({
      jsonrpc: "2.0",
      id: 1,
      method: "runs.start",
      params: {
        input: { prompt: "Require human approval." },
        config: {
          pattern: "orchestrator_subagent",
          metadata: { approvalMode: "manual" }
        }
      }
    })) as { runId: string; status: string };

    const blocked = StateSnapshotSchema.parse(
      await handle({
        jsonrpc: "2.0",
        id: 2,
        method: "runs.state",
        params: { runId: run.runId }
      })
    );
    const resumed = StateSnapshotSchema.parse(
      await handle({
        jsonrpc: "2.0",
        id: 3,
        method: "runs.resume",
        params: { runId: run.runId, patch: { approvedActionIds: [blocked.actions[0]?.id] } }
      })
    );

    expect(run.status).toBe("interrupted");
    expect(blocked.actions[0]?.status).toBe("approval_required");
    expect(blocked.events.map((event) => event.type)).toContain("approval.required");
    expect(resumed.actions[0]?.status).toBe("succeeded");
    expect(resumed.memory).toHaveLength(1);
    expect(resumed.events.map((event) => event.type)).toContain("approval.resolved");
  });

  it("forks a run from a checkpoint without exposing engine internals", async () => {
    const handle = createRuntimeMethodHandler(createTempStore());
    const run = (await handle({
      jsonrpc: "2.0",
      id: 1,
      method: "runs.start",
      params: {
        input: { prompt: "Fork this checkpoint." },
        config: { pattern: "agent_teams" }
      }
    })) as { runId: string };
    const source = StateSnapshotSchema.parse(
      await handle({
        jsonrpc: "2.0",
        id: 2,
        method: "runs.state",
        params: { runId: run.runId }
      })
    );

    const fork = (await handle({
      jsonrpc: "2.0",
      id: 3,
      method: "runs.fork",
      params: {
        runId: run.runId,
        checkpointId: source.checkpoints[0]?.id,
        input: { prompt: "Forked task." }
      }
    })) as { runId: string; pattern: string; status: string };
    const forkState = StateSnapshotSchema.parse(
      await handle({
        jsonrpc: "2.0",
        id: 4,
        method: "runs.state",
        params: { runId: fork.runId }
      })
    );

    expect(fork.runId).not.toBe(run.runId);
    expect(fork.pattern).toBe("agent_teams");
    expect(fork.status).toBe("succeeded");
    expect(forkState.events.map((event) => event.type)).toContain("run.forked");
    expect(forkState.config.metadata.forkedFromRunId).toBe(run.runId);
  });

  it("replays events through a checkpoint and records the replay request", async () => {
    const handle = createRuntimeMethodHandler(createTempStore());
    const run = (await handle({
      jsonrpc: "2.0",
      id: 1,
      method: "runs.start",
      params: {
        input: { prompt: "Replay this checkpoint." },
        config: { pattern: "generator_verifier" }
      }
    })) as { runId: string };
    const source = StateSnapshotSchema.parse(
      await handle({
        jsonrpc: "2.0",
        id: 2,
        method: "runs.state",
        params: { runId: run.runId }
      })
    );

    const replay = (await handle({
      jsonrpc: "2.0",
      id: 3,
      method: "runs.replay",
      params: {
        runId: run.runId,
        checkpointId: source.checkpoints[0]?.id
      }
    })) as { events: { seq: number; type: string }[]; nextSeq: number };
    const replayedState = StateSnapshotSchema.parse(
      await handle({
        jsonrpc: "2.0",
        id: 4,
        method: "runs.state",
        params: { runId: run.runId }
      })
    );

    expect(replay.events.at(-1)?.type).toBe("checkpoint.created");
    expect(replay.events.map((event) => event.seq)).toEqual([...Array(replay.events.length).keys()]);
    expect(replay.events.length).toBe(source.checkpoints[0]!.eventSeq + 1);
    expect(replay.nextSeq).toBe(replayedState.events.length);
    expect(replayedState.events.at(-1)?.type).toBe("run.replayed");
  });
});
