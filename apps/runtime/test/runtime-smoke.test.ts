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
      "memory.queued",
      "run.done",
      "memory.updated",
      "memory.flushed",
      "checkpoint.created"
    ]);
    expect(state.events.map((event) => event.seq)).toEqual([...Array(state.events.length).keys()]);
    expect(state.checkpoints).toHaveLength(1);
    expect(state.topology.nodes.length).toBeGreaterThan(1);
    expect(state.profiles.map((profile) => profile.id)).toEqual(["generator", "verifier"]);
    expect(state.actions.length).toBeGreaterThanOrEqual(2);
    expect(state.actions.every((action) => action.status === "succeeded")).toBe(true);
    expect(state.policyDecisions).toEqual([]);
    expect(
      state.memory.some((record) =>
        record.namespace.join(":").startsWith("session:local-project:generator_verifier"),
      ),
    ).toBe(true);
    expect(state.plan.every((item) => item.status === "done")).toBe(true);
    expect(state.plan.some((item) => item.linkedActionIds.length > 0)).toBe(true);
    expect(state.todos).toHaveLength(state.plan.length);
    expect(state.todos.every((item) => item.status === "done")).toBe(true);
    expect(state.todos.map((item) => item.sourcePlanItemId)).toEqual(state.plan.map((item) => item.id));
    expect(state.pendingClarifications).toEqual([]);
    expect(state.pendingApprovals).toEqual([]);
    expect(state.activeAgents).toEqual([]);
    expect(state.events.map((event) => event.type)).toContain("todo.updated");
    expect(state.output).toMatchObject({
      text: expect.stringContaining("[local-smoke]"),
      pattern: "generator_verifier",
      generator: { candidate: expect.stringContaining("[local-smoke]") },
      verifier: { verdict: "pass" }
    });

    for (const event of state.events) {
      expect(OraEventEnvelopeSchema.parse(event).runId).toBe(run.runId);
    }
  });

  it("preserves providerId/providerConfig and routes calls through the selected provider", async () => {
    const handle = createRuntimeMethodHandler(createTempStore());
    const run = (await handle({
      jsonrpc: "2.0",
      id: 1,
      method: "runs.start",
      params: {
        input: { prompt: "Use the selected provider." },
        config: {
          pattern: "generator_verifier",
          providerId: "deepseek",
          modelRef: "deepseek-chat",
          metadata: { providerId: "deepseek" },
          providerConfig: {
            id: "deepseek",
            label: "DeepSeek Smoke",
            type: "local_smoke",
            modelId: "deepseek-chat",
            capabilities: ["chat"],
            headers: {},
          },
        },
      },
    })) as { runId: string };

    const state = StateSnapshotSchema.parse(
      await handle({
        jsonrpc: "2.0",
        id: 2,
        method: "runs.state",
        params: { runId: run.runId },
      })
    );

    expect(state.config.providerId).toBe("deepseek");
    expect(state.config.modelRef).toBe("deepseek-chat");
    expect(state.config.providerConfig).toMatchObject({
      id: "deepseek",
      type: "local_smoke",
      modelId: "deepseek-chat",
    });
    expect(
      state.events.some((event) =>
        event.type === "tool.called"
        && typeof event.payload === "object"
        && event.payload !== null
        && (event.payload as Record<string, unknown>).providerId === "deepseek",
      ),
    ).toBe(true);
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
      modes: { id: string }[];
      atoms: { id: string }[];
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
    expect(bootstrap.modes.map((mode) => mode.id)).toEqual([
      "generator_verifier",
      "orchestrator_subagent",
      "single_agent",
      "agent_teams",
      "message_bus",
      "shared_state"
    ]);
    expect(bootstrap.atoms.length).toBeGreaterThan(0);
    expect(bootstrap.tools.tools.length).toBeGreaterThan(0);
    expect(bootstrap.skills.skills.length).toBeGreaterThan(0);
    expect(tools.tools).toEqual(bootstrap.tools.tools);
    expect(skills.skills).toEqual(bootstrap.skills.skills);
  });

  it("creates, validates, lists, and runs a custom mode preset", async () => {
    const handle = createRuntimeMethodHandler(createTempStore());
    const cloned = await handle({
      jsonrpc: "2.0",
      id: 1,
      method: "modes.cloneFromPreset",
      params: {
        sourceModeId: "orchestrator_subagent",
        modeId: "orchestrator-subagent-custom",
        label: "Orchestrator Custom",
      },
    }) as any;

    expect(cloned.id).toBe("orchestrator-subagent-custom");
    expect(cloned.nodes.every((node: { position?: { x: number; y: number } }) => node.position)).toBe(true);

    const updated = await handle({
      jsonrpc: "2.0",
      id: 2,
      method: "modes.update",
      params: {
        modeId: cloned.id,
        spec: {
          ...cloned,
          summary: "Custom orchestrator mode.",
          nodes: cloned.nodes.map((node, index) =>
            node.id === "review"
              ? { ...node, enabled: false, label: "Review (disabled)", position: { x: 900, y: 240 } }
              : { ...node, position: { x: 120 + index * 220, y: 80 + index * 140 } }
          ),
        },
      },
    }) as any;

    expect(updated.nodes.find((node) => node.id === "review")?.enabled).toBe(false);
    expect(updated.nodes.find((node) => node.id === "review")?.position).toEqual({ x: 900, y: 240 });

    const validation = await handle({
      jsonrpc: "2.0",
      id: 3,
      method: "modes.validate",
      params: { spec: updated },
    }) as { valid: boolean; errors: string[] };
    expect(validation.valid).toBe(true);
    expect(validation.errors).toEqual([]);

    const modes = await handle({
      jsonrpc: "2.0",
      id: 4,
      method: "modes.list",
    }) as Array<{ id: string }>;
    expect(modes.some((mode) => mode.id === cloned.id)).toBe(true);

    const run = await handle({
      jsonrpc: "2.0",
      id: 5,
      method: "runs.start",
      params: {
        input: { prompt: "Run the custom mode." },
        config: { modeId: cloned.id },
      },
    }) as { runId: string };
    const state = StateSnapshotSchema.parse(
      await handle({
        jsonrpc: "2.0",
        id: 6,
        method: "runs.state",
        params: { runId: run.runId },
      }),
    );

    expect(state.modeId).toBe(cloned.id);
    expect(state.modeSpec?.id).toBe(cloned.id);
    expect(state.pattern).toBe("orchestrator_subagent");
    expect(state.plan.some((item) => item.id.endsWith(":review"))).toBe(false);
  });

  it("runs the built-in single-agent preset without cloning a custom mode", async () => {
    const handle = createRuntimeMethodHandler(createTempStore());
    const run = await handle({
      jsonrpc: "2.0",
      id: 1,
      method: "runs.start",
      params: {
        input: { prompt: "Answer this directly." },
        config: { pattern: "orchestrator_subagent", modeId: "single_agent" }
      }
    }) as { runId: string; status: string };

    expect(run.status).toBe("succeeded");

    const state = StateSnapshotSchema.parse(await handle({
      jsonrpc: "2.0",
      id: 2,
      method: "runs.state",
      params: { runId: run.runId }
    }));

    expect(state.modeId).toBe("single_agent");
    expect(state.pattern).toBe("orchestrator_subagent");
    expect(state.profiles.map((profile) => profile.id)).toEqual(["solo_agent"]);
    expect(state.memory.some((record) => record.namespace.join(":").startsWith("session:local-project:single_agent"))).toBe(true);
    expect(state.output).toMatchObject({
      modeId: "single_agent",
      agent: {
        id: "solo_agent"
      }
    });
  });

  it("publishes runtime artifacts when a node enables the artifact_publish atom", async () => {
    const handle = createRuntimeMethodHandler(createTempStore());
    const cloned = await handle({
      jsonrpc: "2.0",
      id: 1,
      method: "modes.cloneFromPreset",
      params: {
        sourceModeId: "message_bus",
        modeId: "message-bus-artifact-custom",
        label: "Message Bus Artifact",
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
          summary: "Custom message bus artifact mode.",
          nodes: cloned.nodes.map((node) =>
            node.id === "handle"
              ? { ...node, config: { ...node.config, atoms: ["artifact_publish"] } }
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
        input: { prompt: "Publish an artifact." },
        config: { modeId: cloned.id },
      },
    }) as { runId: string };

    const state = StateSnapshotSchema.parse(
      await handle({
        jsonrpc: "2.0",
        id: 4,
        method: "runs.state",
        params: { runId: run.runId },
      }),
    );

    expect(state.artifacts).toHaveLength(1);
    expect(state.artifacts[0]?.label).toContain("artifact");
    expect(state.events.some((event) => event.type === "artifact.exported")).toBe(true);
  });

  it("emits delegated task lifecycle events when a stage enables subagent_delegate", async () => {
    const handle = createRuntimeMethodHandler(createTempStore());
    const cloned = await handle({
      jsonrpc: "2.0",
      id: 1,
      method: "modes.cloneFromPreset",
      params: {
        sourceModeId: "orchestrator_subagent",
        modeId: "orchestrator-subagent-delegate-custom",
        label: "Orchestrator Delegate",
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
          summary: "Custom orchestrator mode with delegated stage lifecycle.",
          capabilityFlags: {
            ...cloned.capabilityFlags,
            toolIds: [...new Set([...(cloned.capabilityFlags?.toolIds ?? []), "model.handoff"])],
          },
          nodes: cloned.nodes.map((node) =>
            node.id === "research"
              ? { ...node, config: { ...node.config, atoms: ["subagent_delegate"] } }
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
        input: { prompt: "Delegate the research stage." },
        config: { modeId: cloned.id },
      },
    }) as { runId: string };

    const state = StateSnapshotSchema.parse(
      await handle({
        jsonrpc: "2.0",
        id: 4,
        method: "runs.state",
        params: { runId: run.runId },
      }),
    );

    const eventTypes = state.events.map((event) => event.type);
    expect(eventTypes).toContain("task.started");
    expect(eventTypes).toContain("task.progress");
    expect(eventTypes).toContain("task.completed");
    expectOrderedEvents(eventTypes, [
      "task.started",
      "task.progress",
      "agent.started",
      "agent.completed",
      "task.completed",
    ]);
    const taskStarted = state.events.find((event) => event.type === "task.started");
    expect(taskStarted?.payload).toMatchObject({
      taskId: "task:research",
      nodeId: "research",
    });
  });

  it("degrades provider failures into runtime state when tool_error_boundary is enabled", async () => {
    const handle = createRuntimeMethodHandler(createTempStore());
    const cloned = await handle({
      jsonrpc: "2.0",
      id: 1,
      method: "modes.cloneFromPreset",
      params: {
        sourceModeId: "orchestrator_subagent",
        modeId: "orchestrator-tool-boundary-custom",
        label: "Orchestrator Tool Boundary",
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
          summary: "Custom orchestrator mode that keeps going after provider failures.",
        },
      },
    });

    const run = await handle({
      jsonrpc: "2.0",
      id: 3,
      method: "runs.start",
      params: {
        input: { prompt: "Keep going after a provider failure." },
        config: {
          modeId: cloned.id,
          providerId: "missing-provider",
        },
      },
    }) as { runId: string; status: string };

    const state = StateSnapshotSchema.parse(
      await handle({
        jsonrpc: "2.0",
        id: 4,
        method: "runs.state",
        params: { runId: run.runId },
      }),
    );

    expect(run.status).toBe("succeeded");
    expect(state.status).toBe("succeeded");
    expect(state.events.map((event) => event.type)).toContain("run.done");
    expect(state.actions.some((action) => action.status === "failed")).toBe(true);
    expect(
      state.events.some((event) =>
        event.type === "tool.called" &&
        typeof (event.payload as Record<string, unknown>).status === "string" &&
        (event.payload as Record<string, unknown>).status === "failed",
      ),
    ).toBe(true);
    expect(state.output).toMatchObject({
      text: expect.stringContaining("[tool-error-boundary]"),
    });
  });

  it("fails the run when tool_error_boundary is removed from the mode", async () => {
    const handle = createRuntimeMethodHandler(createTempStore());
    const cloned = await handle({
      jsonrpc: "2.0",
      id: 1,
      method: "modes.cloneFromPreset",
      params: {
        sourceModeId: "orchestrator_subagent",
        modeId: "orchestrator-tool-boundary-disabled",
        label: "Orchestrator No Boundary",
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
          summary: "Custom orchestrator mode without the tool error boundary.",
          runtimeAtoms: cloned.runtimeAtoms.filter((atom: string) => atom !== "tool_error_boundary"),
        },
      },
    });

    const run = await handle({
      jsonrpc: "2.0",
      id: 3,
      method: "runs.start",
      params: {
        input: { prompt: "Fail without the boundary." },
        config: {
          modeId: cloned.id,
          providerId: "missing-provider",
        },
      },
    }) as { runId: string; status: string };

    const state = StateSnapshotSchema.parse(
      await handle({
        jsonrpc: "2.0",
        id: 4,
        method: "runs.state",
        params: { runId: run.runId },
      }),
    );

    expect(run.status).toBe("failed");
    expect(state.status).toBe("failed");
    expect(state.events.map((event) => event.type)).toContain("run.failed");
    expect(state.events.map((event) => event.type)).not.toContain("run.done");
    expect(state.actions.some((action) => action.status === "failed")).toBe(true);
  });

  it("interrupts a run when clarification_interrupt hits an unanswered stage question", async () => {
    const handle = createRuntimeMethodHandler(createTempStore());
    const cloned = await handle({
      jsonrpc: "2.0",
      id: 1,
      method: "modes.cloneFromPreset",
      params: {
        sourceModeId: "orchestrator_subagent",
        modeId: "orchestrator-clarification-custom",
        label: "Orchestrator Clarification",
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
          summary: "Custom orchestrator mode with a clarification gate.",
          nodes: cloned.nodes.map((node) =>
            node.id === "research"
              ? {
                  ...node,
                  config: {
                    ...node.config,
                    clarificationQuestion: "Which repository or document should research prioritize?",
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
        input: { prompt: "Research this request." },
        config: { modeId: cloned.id },
      },
    }) as { runId: string; status: string };

    const state = StateSnapshotSchema.parse(
      await handle({
        jsonrpc: "2.0",
        id: 4,
        method: "runs.state",
        params: { runId: run.runId },
      }),
    );

    expect(run.status).toBe("interrupted");
    expect(state.status).toBe("interrupted");
    expect(state.pendingClarifications).toHaveLength(1);
    expect(state.pendingClarifications[0]).toMatchObject({
      nodeId: "research",
      key: "research",
    });
    expect(state.events.map((event) => event.type)).toContain("clarification.required");
    expectOrderedEvents(state.events.map((event) => event.type), [
      "agent.completed",
      "clarification.required",
      "run.interrupted",
    ]);
    expect(state.plan.find((item) => item.id.endsWith(":research"))?.status).toBe("blocked");
  });

  it("resolves pending clarifications on resume when answers are supplied", async () => {
    const handle = createRuntimeMethodHandler(createTempStore());
    const cloned = await handle({
      jsonrpc: "2.0",
      id: 1,
      method: "modes.cloneFromPreset",
      params: {
        sourceModeId: "orchestrator_subagent",
        modeId: "orchestrator-clarification-resume",
        label: "Orchestrator Clarification Resume",
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
          summary: "Custom orchestrator mode that resumes from clarification.",
          nodes: cloned.nodes.map((node) =>
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
        input: { prompt: "Resume after clarification." },
        config: { modeId: cloned.id },
      },
    }) as { runId: string };

    const resumed = StateSnapshotSchema.parse(
      await handle({
        jsonrpc: "2.0",
        id: 4,
        method: "runs.resume",
        params: {
          runId: run.runId,
          patch: {
            clarifications: {
              research: "Focus on the harness package first.",
            },
          },
        },
      }),
    );

    expect(resumed.status).toBe("succeeded");
    expect(resumed.pendingClarifications).toEqual([]);
    expect(resumed.events.map((event) => event.type)).toContain("clarification.resolved");
    expect(resumed.input.context.clarifications).toMatchObject({
      research: "Focus on the harness package first.",
    });
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
    expect(blocked.todos.every((todo) => todo.status === "blocked")).toBe(true);
    expect(resumed.actions[0]?.status).toBe("succeeded");
    expect(resumed.memory).toHaveLength(1);
    expect(resumed.events.map((event) => event.type)).toContain("approval.resolved");
    expect(resumed.events.map((event) => event.type)).toContain("todo.updated");
    expect(resumed.todos.every((todo) => todo.status === "done")).toBe(true);
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
