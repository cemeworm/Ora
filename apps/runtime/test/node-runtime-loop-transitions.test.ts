import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CODE_DEVELOPMENT_MODE_ID, ORA_ROOT_AGENT_ID, SINGLE_AGENT_MODE_ID, StateSnapshotSchema } from "@cemeworm/shared";
import { LocalRunStore, createRuntimeMethodHandler } from "../src/index.js";
import {
  containsStateSubsequence,
  CORE_NODE_RUNTIME_TRANSITIONS,
  NodeLoopController,
  NodeLoopReducer,
  assertNodeLoopTransitionResult,
  nodeLoopTransitionDiagnostics,
  nodeLoopTransitionResult,
  nodeRuntimeStateSequence,
  transitionPairs,
} from "../src/harness/node-loop-transitions.js";

function createTempStore() {
  return new LocalRunStore({
    dataDir: fs.mkdtempSync(path.join(os.tmpdir(), "ora-node-loop-transitions-")),
  });
}

function expectCoreTransitions(states: ReturnType<typeof nodeRuntimeStateSequence>) {
  const allowed = new Set(CORE_NODE_RUNTIME_TRANSITIONS.map((transition) => `${transition.from}->${transition.to}`));
  for (const transition of transitionPairs(states)) {
    expect(allowed.has(`${transition.from}->${transition.to}`), `${transition.from}->${transition.to}`).toBe(true);
  }
}

function expectNoTransitionDiagnostics(events: Parameters<typeof nodeLoopTransitionDiagnostics>[0]) {
  expect(nodeLoopTransitionDiagnostics(events)).toEqual([]);
}

describe("node runtime loop transition contract", () => {
  it("does not treat provider stream frames as node loop states by default", () => {
    const events = [
      {
        type: "node.updated",
        agentId: ORA_ROOT_AGENT_ID,
        nodeId: ORA_ROOT_AGENT_ID,
        payload: { state: "pending" },
      },
      {
        type: "node.updated",
        agentId: ORA_ROOT_AGENT_ID,
        nodeId: ORA_ROOT_AGENT_ID,
        payload: {
          state: "running_model",
          providerStream: true,
          streamMode: "sse",
        },
      },
      {
        type: "node.updated",
        agentId: ORA_ROOT_AGENT_ID,
        nodeId: ORA_ROOT_AGENT_ID,
        payload: { state: "running_model" },
      },
      {
        type: "node.updated",
        agentId: ORA_ROOT_AGENT_ID,
        nodeId: ORA_ROOT_AGENT_ID,
        payload: {
          state: "completed",
          providerStream: true,
          streamMode: "sse",
        },
      },
      {
        type: "node.updated",
        agentId: ORA_ROOT_AGENT_ID,
        nodeId: ORA_ROOT_AGENT_ID,
        payload: { state: "completed" },
      },
    ];

    const eventStream = events as Parameters<typeof nodeRuntimeStateSequence>[0];

    expect(nodeRuntimeStateSequence(eventStream)).toEqual([
      "pending",
      "running_model",
      "completed",
    ]);
    expect(nodeRuntimeStateSequence(eventStream, { includeProviderStream: true })).toEqual([
      "pending",
      "running_model",
      "running_model",
      "completed",
      "completed",
    ]);
  });

  it("routes production node state emissions through a transition controller", () => {
    const emitted: Array<{ state: string; params: unknown }> = [];
    const controller = new NodeLoopController({
      emit: (state, params) => {
        emitted.push({ state, params });
      },
    });

    controller.emit("pending", { agentId: ORA_ROOT_AGENT_ID, title: "Respond" });
    controller.emit("running_model", { agentId: ORA_ROOT_AGENT_ID, title: "Respond", iteration: 0 });
    controller.emit("completed", { agentId: ORA_ROOT_AGENT_ID, title: "Respond", iteration: 0 });

    expect(emitted).toEqual([
      { state: "pending", params: { agentId: ORA_ROOT_AGENT_ID, title: "Respond" } },
      { state: "running_model", params: { agentId: ORA_ROOT_AGENT_ID, title: "Respond", iteration: 0 } },
      { state: "completed", params: { agentId: ORA_ROOT_AGENT_ID, title: "Respond", iteration: 0 } },
    ]);
    expect(controller.state).toBe("completed");
    expect(controller.transitions).toEqual([
      { from: "pending", to: "running_model" },
      { from: "running_model", to: "completed" },
    ]);
  });

  it("applies transition-result intents without changing controller emissions", () => {
    const emitted: Array<{ state: string; params: unknown }> = [];
    const controller = new NodeLoopController({
      emit: (state, params) => {
        emitted.push({ state, params });
      },
      onInvalidTransition: "throw",
    });

    controller.emit("pending", { agentId: ORA_ROOT_AGENT_ID, title: "Respond" });
    controller.emitTransitionResult("model_request", "running_model", {
      agentId: ORA_ROOT_AGENT_ID,
      title: "Respond",
      iteration: 0,
    });
    controller.emitTransitionResult("model_response", "completed", {
      agentId: ORA_ROOT_AGENT_ID,
      title: "Respond",
      iteration: 0,
    });

    expect(emitted).toEqual([
      { state: "pending", params: { agentId: ORA_ROOT_AGENT_ID, title: "Respond" } },
      { state: "running_model", params: { agentId: ORA_ROOT_AGENT_ID, title: "Respond", iteration: 0 } },
      { state: "completed", params: { agentId: ORA_ROOT_AGENT_ID, title: "Respond", iteration: 0 } },
    ]);
    expect(controller.transitions).toEqual([
      { from: "pending", to: "running_model" },
      { from: "running_model", to: "completed" },
    ]);
    expect(() =>
      controller.emitTransitionResult("tool_request", "completed", { agentId: ORA_ROOT_AGENT_ID })
    ).toThrow("Invalid node loop transition result (tool_request): completed -> completed (unknown_transition)");
    expect(controller.state).toBe("completed");
  });

  it("reduces node loop transitions before controller emission", () => {
    const reducer = new NodeLoopReducer();

    const first = reducer.reduce("pending");
    reducer.commit(first);
    const second = reducer.reduce("running_model");
    reducer.commit(second);
    const invalid = reducer.reduce("tool_running");

    expect(first).toEqual({
      previousState: undefined,
      state: "pending",
      transition: undefined,
      invalidTransition: undefined,
    });
    expect(second).toEqual({
      previousState: "pending",
      state: "running_model",
      transition: { from: "pending", to: "running_model" },
      invalidTransition: undefined,
    });
    expect(invalid).toEqual({
      previousState: "running_model",
      state: "tool_running",
      transition: { from: "running_model", to: "tool_running" },
      invalidTransition: { from: "running_model", to: "tool_running" },
    });
    expect(reducer.state).toBe("running_model");
    expect(reducer.transitions).toEqual([
      { from: "pending", to: "running_model" },
    ]);
    expect(reducer.invalidTransitions).toEqual([]);
  });

  it("classifies explicit node loop transition results by intent", () => {
    expect(nodeLoopTransitionResult("model_request", {
      from: "pending",
      to: "running_model",
    })).toEqual({
      kind: "model_request",
      transition: { from: "pending", to: "running_model" },
      valid: true,
    });

    expect(nodeLoopTransitionResult("tool_request", {
      from: "tool_requested",
      to: "tool_running",
    })).toEqual({
      kind: "tool_request",
      transition: { from: "tool_requested", to: "tool_running" },
      valid: true,
    });

    expect(nodeLoopTransitionResult("forced_final", {
      from: "tool_result_observed",
      to: "finalizing",
    })).toEqual({
      kind: "forced_final",
      transition: { from: "tool_result_observed", to: "finalizing" },
      valid: true,
    });
  });

  it("rejects mismatched or unknown explicit node loop transition results", () => {
    expect(nodeLoopTransitionResult("tool_result", {
      from: "tool_requested",
      to: "tool_running",
    })).toEqual({
      kind: "tool_result",
      transition: { from: "tool_requested", to: "tool_running" },
      valid: false,
      reason: "mismatched_kind",
    });

    expect(nodeLoopTransitionResult("model_request", {
      from: "completed",
      to: "tool_running",
    })).toEqual({
      kind: "model_request",
      transition: { from: "completed", to: "tool_running" },
      valid: false,
      reason: "unknown_transition",
    });

    expect(() =>
      assertNodeLoopTransitionResult("complete", {
        from: "tool_requested",
        to: "tool_running",
      })
    ).toThrow("Invalid node loop transition result (complete): tool_requested -> tool_running (mismatched_kind)");
  });

  it("can guard invalid node state transitions without changing payloads", () => {
    const emitted: Array<{ state: string; params: unknown }> = [];
    const diagnostics: Array<{ from: string; to: string; toolId?: string }> = [];
    const recordingController = new NodeLoopController({
      emit: (state, params) => {
        emitted.push({ state, params });
      },
      onInvalidTransitionRecorded: (transition, params) => {
        diagnostics.push({ ...transition, toolId: params.toolId });
      },
    });

    recordingController.emit("completed", { agentId: ORA_ROOT_AGENT_ID, title: "Respond" });
    recordingController.emit("tool_running", {
      agentId: ORA_ROOT_AGENT_ID,
      title: "Respond",
      actionId: "action",
      toolId: "file.read",
    });

    expect(emitted).toEqual([
      { state: "completed", params: { agentId: ORA_ROOT_AGENT_ID, title: "Respond" } },
      {
        state: "tool_running",
        params: {
          agentId: ORA_ROOT_AGENT_ID,
          title: "Respond",
          actionId: "action",
          toolId: "file.read",
        },
      },
    ]);
    expect(recordingController.invalidTransitions).toEqual([
      { from: "completed", to: "tool_running" },
    ]);
    expect(diagnostics).toEqual([
      { from: "completed", to: "tool_running", toolId: "file.read" },
    ]);

    const throwingController = new NodeLoopController({
      onInvalidTransition: "throw",
      emit: () => undefined,
    });
    throwingController.emit("completed", { agentId: ORA_ROOT_AGENT_ID });
    expect(() =>
      throwingController.emit("tool_running", { agentId: ORA_ROOT_AGENT_ID })
    ).toThrow("Invalid node runtime transition: completed -> tool_running");
    expect(throwingController.state).toBe("completed");
    expect(throwingController.transitions).toEqual([]);
  });

  it("documents the no-tool completion path", async () => {
    const handle = createRuntimeMethodHandler(createTempStore());

    const run = await handle({
      jsonrpc: "2.0",
      id: 1,
      method: "runs.start",
      params: {
        input: { prompt: "Answer directly." },
        config: {
          modeId: SINGLE_AGENT_MODE_ID,
          modelRef: "local/smoke-model",
          toolIds: [],
        },
      },
    }) as { runId: string; status: string };

    const state = StateSnapshotSchema.parse(await handle({
      jsonrpc: "2.0",
      id: 2,
      method: "runs.state",
      params: { runId: run.runId },
    }));
    const states = nodeRuntimeStateSequence(state.events, { agentId: ORA_ROOT_AGENT_ID });
    const completedNodeEvent = state.events.find((event) =>
      event.type === "node.updated" &&
      event.agentId === ORA_ROOT_AGENT_ID &&
      (event.payload as { state?: unknown }).state === "completed"
    );

    expect(run.status).toBe("succeeded");
    expect(states).toEqual(["pending", "running_model", "completed"]);
    expect(completedNodeEvent?.payload).toMatchObject({
      state: "completed",
      title: "Respond",
      iteration: 0,
      toolAttempts: 0,
    });
    expectCoreTransitions(states);
    expectNoTransitionDiagnostics(state.events);
  });

  it("documents the native tool success path", async () => {
    const handle = createRuntimeMethodHandler(createTempStore());
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ora-node-loop-tool-"));
    fs.writeFileSync(path.join(workspaceRoot, "README.md"), "Native transition result\n", "utf8");
    const previousFetch = globalThis.fetch;
    const previousKey = process.env.NODE_LOOP_TOOL_KEY;
    process.env.NODE_LOOP_TOOL_KEY = "test";
    let providerCalls = 0;

    globalThis.fetch = (async (_input, init) => {
      providerCalls += 1;
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        messages?: Array<{ role?: string; tool_call_id?: string; content?: string }>;
      };
      if (providerCalls === 1) {
        return new Response(JSON.stringify({
          choices: [{
            finish_reason: "tool_calls",
            message: {
              content: null,
              tool_calls: [{
                id: "call-readme",
                type: "function",
                function: {
                  name: "file__read",
                  arguments: "{\"path\":\"README.md\"}",
                },
              }],
            },
          }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      expect(body.messages?.some((message) =>
        message.role === "tool" &&
        message.tool_call_id === "call-readme" &&
        String(message.content ?? "").includes("Native transition result")
      )).toBe(true);
      return new Response(JSON.stringify({
        choices: [{ message: { content: "Read README through the transition tool path." } }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    try {
      const run = await handle({
        jsonrpc: "2.0",
        id: 1,
        method: "runs.start",
        params: {
          input: {
            prompt: "Read the README.",
            context: {
              projectWorkspace: { label: "Node Loop Tool Workspace", rootPath: workspaceRoot },
            },
          },
          config: {
            modeId: SINGLE_AGENT_MODE_ID,
            providerId: "node-loop-tool",
            modelRef: "node-loop-tool-model",
            providerConfig: {
              id: "node-loop-tool",
              label: "Node Loop Tool",
              type: "openai_compatible",
              modelId: "node-loop-tool-model",
              baseUrl: "https://node-loop-tool.test/v1",
              apiKeyEnv: "NODE_LOOP_TOOL_KEY",
              capabilities: ["chat", "tool_use"],
              headers: {},
            },
            toolIds: ["file.read"],
          },
        },
      }) as { runId: string; status: string };

      const state = StateSnapshotSchema.parse(await handle({
        jsonrpc: "2.0",
        id: 2,
        method: "runs.state",
        params: { runId: run.runId },
      }));
      const states = nodeRuntimeStateSequence(state.events, { agentId: ORA_ROOT_AGENT_ID });

      expect(run.status).toBe("succeeded");
      expect(providerCalls).toBeGreaterThanOrEqual(2);
      expect(containsStateSubsequence(states, [
        "pending",
        "running_model",
        "tool_requested",
        "tool_running",
        "tool_result_observed",
        "running_model",
        "completed",
      ])).toBe(true);
      expectCoreTransitions(states);
      expectNoTransitionDiagnostics(state.events);
      expect(state.toolCalls).toEqual([
        expect.objectContaining({
          providerCallId: "call-readme",
          toolId: "file.read",
          source: "provider_native",
          status: "succeeded",
        }),
      ]);
    } finally {
      globalThis.fetch = previousFetch;
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
      if (previousKey === undefined) {
        delete process.env.NODE_LOOP_TOOL_KEY;
      } else {
        process.env.NODE_LOOP_TOOL_KEY = previousKey;
      }
    }
  });

  it("documents the JSON fallback tool success path", async () => {
    const handle = createRuntimeMethodHandler(createTempStore());
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ora-node-loop-json-tool-"));
    fs.writeFileSync(path.join(workspaceRoot, "README.md"), "JSON fallback transition result\n", "utf8");
    const previousFetch = globalThis.fetch;
    const previousKey = process.env.NODE_LOOP_JSON_TOOL_KEY;
    process.env.NODE_LOOP_JSON_TOOL_KEY = "test";
    let providerCalls = 0;

    globalThis.fetch = (async (_input, init) => {
      providerCalls += 1;
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        messages?: Array<{ role?: string; content?: string }>;
      };
      if (providerCalls === 1) {
        return new Response(JSON.stringify({
          choices: [{ message: { content: JSON.stringify({ tool: "file.read", args: { path: "README.md" } }) } }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      expect(body.messages?.some((message) =>
        message.role === "user" &&
        String(message.content ?? "").includes("Workspace tool result for file.read") &&
        String(message.content ?? "").includes("JSON fallback transition result")
      )).toBe(true);
      return new Response(JSON.stringify({
        choices: [{ message: { content: "Read README through the JSON fallback path." } }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    try {
      const run = await handle({
        jsonrpc: "2.0",
        id: 1,
        method: "runs.start",
        params: {
          input: {
            prompt: "Read the README.",
            context: {
              projectWorkspace: { label: "Node Loop JSON Workspace", rootPath: workspaceRoot },
            },
          },
          config: {
            modeId: SINGLE_AGENT_MODE_ID,
            providerId: "node-loop-json-tool",
            modelRef: "node-loop-json-tool-model",
            providerConfig: {
              id: "node-loop-json-tool",
              label: "Node Loop JSON Tool",
              type: "openai_compatible",
              modelId: "node-loop-json-tool-model",
              baseUrl: "https://node-loop-json-tool.test/v1",
              apiKeyEnv: "NODE_LOOP_JSON_TOOL_KEY",
              capabilities: ["chat"],
              headers: {},
            },
            toolIds: ["file.read"],
          },
        },
      }) as { runId: string; status: string };

      const state = StateSnapshotSchema.parse(await handle({
        jsonrpc: "2.0",
        id: 2,
        method: "runs.state",
        params: { runId: run.runId },
      }));
      const states = nodeRuntimeStateSequence(state.events, { agentId: ORA_ROOT_AGENT_ID });

      expect(run.status).toBe("succeeded");
      expect(providerCalls).toBeGreaterThanOrEqual(2);
      expect(containsStateSubsequence(states, [
        "pending",
        "running_model",
        "tool_requested",
        "tool_running",
        "tool_result_observed",
        "running_model",
        "completed",
      ])).toBe(true);
      expectCoreTransitions(states);
      expectNoTransitionDiagnostics(state.events);
      expect(state.toolCalls).toEqual([
        expect.objectContaining({
          toolId: "file.read",
          source: "json_fallback",
          status: "succeeded",
        }),
      ]);
    } finally {
      globalThis.fetch = previousFetch;
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
      if (previousKey === undefined) {
        delete process.env.NODE_LOOP_JSON_TOOL_KEY;
      } else {
        process.env.NODE_LOOP_JSON_TOOL_KEY = previousKey;
      }
    }
  });

  it("documents the approval interrupt and resume path", async () => {
    const handle = createRuntimeMethodHandler(createTempStore());
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ora-node-loop-approval-"));
    const previousFetch = globalThis.fetch;
    const previousKey = process.env.NODE_LOOP_APPROVAL_KEY;
    process.env.NODE_LOOP_APPROVAL_KEY = "test";
    let providerCalls = 0;

    globalThis.fetch = (async () => {
      providerCalls += 1;
      if (providerCalls === 1) {
        return new Response(JSON.stringify({
          choices: [{
            finish_reason: "tool_calls",
            message: {
              content: null,
              tool_calls: [{
                id: "call-write",
                type: "function",
                function: {
                  name: "file__write",
                  arguments: "{\"path\":\"notes/approval.md\",\"content\":\"approved\\n\"}",
                },
              }],
            },
          }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({
        choices: [{ message: { content: "Approved write completed." } }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    try {
      const run = await handle({
        jsonrpc: "2.0",
        id: 1,
        method: "runs.start",
        params: {
          input: {
            prompt: "Write the approved note.",
            context: {
              projectWorkspace: { label: "Node Loop Approval Workspace", rootPath: workspaceRoot },
            },
          },
          config: {
            modeId: SINGLE_AGENT_MODE_ID,
            providerId: "node-loop-approval",
            modelRef: "node-loop-approval-model",
            providerConfig: {
              id: "node-loop-approval",
              label: "Node Loop Approval",
              type: "openai_compatible",
              modelId: "node-loop-approval-model",
              baseUrl: "https://node-loop-approval.test/v1",
              apiKeyEnv: "NODE_LOOP_APPROVAL_KEY",
              capabilities: ["chat", "tool_use"],
              headers: {},
            },
            approvalMode: "high_risk_only",
            toolIds: ["file.write"],
          },
        },
      }) as { runId: string; status: string };

      const blocked = StateSnapshotSchema.parse(await handle({
        jsonrpc: "2.0",
        id: 2,
        method: "runs.state",
        params: { runId: run.runId },
      }));
      const blockedStates = nodeRuntimeStateSequence(blocked.events, { agentId: ORA_ROOT_AGENT_ID });
      const approvedActionId = blocked.pendingApprovals[0]!;

      expect(run.status).toBe("interrupted");
      expect(containsStateSubsequence(blockedStates, ["pending", "running_model", "tool_requested"])).toBe(true);
      expectCoreTransitions(blockedStates);
      expectNoTransitionDiagnostics(blocked.events);
      expect(blocked.events.map((event) => event.type)).toContain("approval.required");
      expect(blocked.actions.find((action) => action.id === approvedActionId)).toMatchObject({
        type: "file.write",
        status: "approval_required",
      });
      expect(blocked.toolCalls.find((call) => call.toolId === "file.write")).toMatchObject({
        providerCallId: "call-write",
        status: "approval_required",
      });

      const resumed = StateSnapshotSchema.parse(await handle({
        jsonrpc: "2.0",
        id: 3,
        method: "runs.resume",
        params: {
          runId: run.runId,
          patch: { approvedActionIds: [approvedActionId] },
        },
      }));

      expect(resumed.status).toBe("succeeded");
      expect(resumed.pendingApprovals).toEqual([]);
      expectNoTransitionDiagnostics(resumed.events);
      expect(resumed.events.map((event) => event.type)).toContain("approval.resolved");
      expect(resumed.actions.some((action) => action.status === "approval_required")).toBe(false);
      expect(resumed.toolCalls.filter((call) => call.providerCallId === "call-write")).toEqual([
        expect.objectContaining({ toolId: "file.write", status: "succeeded" }),
      ]);
      expect(fs.readFileSync(path.join(workspaceRoot, "notes/approval.md"), "utf8")).toBe("approved\n");
    } finally {
      globalThis.fetch = previousFetch;
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
      if (previousKey === undefined) {
        delete process.env.NODE_LOOP_APPROVAL_KEY;
      } else {
        process.env.NODE_LOOP_APPROVAL_KEY = previousKey;
      }
    }
  });

  it("documents the clarification interrupt and resume path", async () => {
    const handle = createRuntimeMethodHandler(createTempStore());
    const previousFetch = globalThis.fetch;
    const previousKey = process.env.NODE_LOOP_CLARIFICATION_KEY;
    process.env.NODE_LOOP_CLARIFICATION_KEY = "test";
    const providerBodies: string[] = [];
    let clarificationIssued = false;

    globalThis.fetch = (async (_input, init) => {
      const body = String(init?.body ?? "");
      providerBodies.push(body);
      if (!clarificationIssued && body.includes("user__clarify")) {
        clarificationIssued = true;
        return new Response(JSON.stringify({
          choices: [{
            finish_reason: "tool_calls",
            message: {
              content: null,
              tool_calls: [{
                id: "call-clarify",
                type: "function",
                function: {
                  name: "user__clarify",
                  arguments: JSON.stringify({
                    key: "target_environment",
                    question: "Which environment should I use?",
                    options: [
                      { id: "staging", label: "Staging", value: "staging" },
                      { id: "production", label: "Production", value: "production" },
                    ],
                  }),
                },
              }],
            },
          }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({
        choices: [{ message: { content: "Continuing with staging." } }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    try {
      const run = await handle({
        jsonrpc: "2.0",
        id: 1,
        method: "runs.start",
        params: {
          input: { prompt: "Confirm the target environment before continuing." },
          config: {
            modeId: SINGLE_AGENT_MODE_ID,
            providerId: "node-loop-clarification",
            modelRef: "node-loop-clarification-model",
            providerConfig: {
              id: "node-loop-clarification",
              label: "Node Loop Clarification",
              type: "openai_compatible",
              modelId: "node-loop-clarification-model",
              baseUrl: "https://node-loop-clarification.test/v1",
              apiKeyEnv: "NODE_LOOP_CLARIFICATION_KEY",
              capabilities: ["chat", "tool_use"],
              headers: {},
            },
            toolIds: ["user.clarify"],
          },
        },
      }) as { runId: string; status: string };

      const blocked = StateSnapshotSchema.parse(await handle({
        jsonrpc: "2.0",
        id: 2,
        method: "runs.state",
        params: { runId: run.runId },
      }));
      const blockedStates = nodeRuntimeStateSequence(blocked.events, { agentId: ORA_ROOT_AGENT_ID });

      expect(run.status).toBe("interrupted");
      expect(containsStateSubsequence(blockedStates, [
        "pending",
        "running_model",
        "tool_requested",
        "tool_running",
      ])).toBe(true);
      expectCoreTransitions(blockedStates);
      expectNoTransitionDiagnostics(blocked.events);
      expect(blocked.events.map((event) => event.type)).toContain("clarification.required");
      expect(blocked.pendingClarifications).toEqual([
        expect.objectContaining({ key: "target_environment", question: "Which environment should I use?" }),
      ]);
      expect(blocked.toolCalls.find((call) => call.toolId === "user.clarify")).toMatchObject({
        providerCallId: "call-clarify",
        status: "succeeded",
      });

      const resumed = StateSnapshotSchema.parse(await handle({
        jsonrpc: "2.0",
        id: 3,
        method: "runs.resume",
        params: {
          runId: run.runId,
          patch: { clarifications: { target_environment: "staging" } },
        },
      }));
      const resumedStates = nodeRuntimeStateSequence(resumed.events, { agentId: ORA_ROOT_AGENT_ID });

      expect(resumed.status).toBe("succeeded");
      expect(resumed.pendingClarifications).toEqual([]);
      expect(containsStateSubsequence(resumedStates, ["pending", "running_model", "completed"])).toBe(true);
      expectCoreTransitions(resumedStates);
      expectNoTransitionDiagnostics(resumed.events);
      expect(resumed.events.map((event) => event.type)).toContain("clarification.resolved");
      expect(providerBodies.some((body) =>
        body.includes("User-supplied clarification context") &&
        body.includes("target_environment") &&
        body.includes("staging")
      )).toBe(true);
    } finally {
      globalThis.fetch = previousFetch;
      if (previousKey === undefined) {
        delete process.env.NODE_LOOP_CLARIFICATION_KEY;
      } else {
        process.env.NODE_LOOP_CLARIFICATION_KEY = previousKey;
      }
    }
  });

  it("documents the batch clarification transition path", async () => {
    const handle = createRuntimeMethodHandler(createTempStore());
    const previousFetch = globalThis.fetch;
    const previousKey = process.env.NODE_LOOP_BATCH_CLARIFICATION_KEY;
    process.env.NODE_LOOP_BATCH_CLARIFICATION_KEY = "test";
    let clarificationIssued = false;

    globalThis.fetch = (async (_input, init) => {
      const body = String(init?.body ?? "");
      if (!clarificationIssued && body.includes("user__clarify")) {
        clarificationIssued = true;
        return new Response(JSON.stringify({
          choices: [{
            finish_reason: "tool_calls",
            message: {
              content: null,
              tool_calls: [
                {
                  id: "call-clarify-env",
                  type: "function",
                  function: {
                    name: "user__clarify",
                    arguments: JSON.stringify({
                      key: "target_environment",
                      question: "Which environment should I use?",
                    }),
                  },
                },
                {
                  id: "call-clarify-region",
                  type: "function",
                  function: {
                    name: "user__clarify",
                    arguments: JSON.stringify({
                      key: "target_region",
                      question: "Which region should I deploy to?",
                    }),
                  },
                },
              ],
            },
          }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({
        choices: [{ message: { content: "Continuing after batch clarifications." } }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    try {
      const run = await handle({
        jsonrpc: "2.0",
        id: 1,
        method: "runs.start",
        params: {
          input: { prompt: "Ask all required deployment clarifications together." },
          config: {
            modeId: SINGLE_AGENT_MODE_ID,
            providerId: "node-loop-batch-clarification",
            modelRef: "node-loop-batch-clarification-model",
            providerConfig: {
              id: "node-loop-batch-clarification",
              label: "Node Loop Batch Clarification",
              type: "openai_compatible",
              modelId: "node-loop-batch-clarification-model",
              baseUrl: "https://node-loop-batch-clarification.test/v1",
              apiKeyEnv: "NODE_LOOP_BATCH_CLARIFICATION_KEY",
              capabilities: ["chat", "tool_use"],
              headers: {},
            },
            toolIds: ["user.clarify"],
          },
        },
      }) as { runId: string; status: string };

      const blocked = StateSnapshotSchema.parse(await handle({
        jsonrpc: "2.0",
        id: 2,
        method: "runs.state",
        params: { runId: run.runId },
      }));
      const states = nodeRuntimeStateSequence(blocked.events, { agentId: ORA_ROOT_AGENT_ID });

      expect(run.status).toBe("interrupted");
      expect(states).toEqual(["pending", "running_model", "tool_requested", "tool_running", "interrupted", "interrupted"]);
      expectCoreTransitions(states);
      expect(blocked.pendingClarifications).toHaveLength(2);
      expect(blocked.events.filter((event) => event.type === "clarification.required")).toHaveLength(2);
      expectNoTransitionDiagnostics(blocked.events);
    } finally {
      globalThis.fetch = previousFetch;
      if (previousKey === undefined) {
        delete process.env.NODE_LOOP_BATCH_CLARIFICATION_KEY;
      } else {
        process.env.NODE_LOOP_BATCH_CLARIFICATION_KEY = previousKey;
      }
    }
  });

  it("documents the recovery path after a tool failure", async () => {
    const handle = createRuntimeMethodHandler(createTempStore());
    const previousFetch = globalThis.fetch;
    const previousKey = process.env.NODE_LOOP_RECOVERY_KEY;
    process.env.NODE_LOOP_RECOVERY_KEY = "test";
    const providerBodies: string[] = [];
    let providerCalls = 0;

    globalThis.fetch = (async (input, init) => {
      if (String(input) === "https://example.com/node-loop-degraded") {
        throw new Error("fetch failed for transition test");
      }

      providerCalls += 1;
      const body = String(init?.body ?? "");
      providerBodies.push(body);
      if (providerCalls === 1) {
        return new Response(JSON.stringify({
          choices: [{
            finish_reason: "tool_calls",
            message: {
              content: null,
              tool_calls: [{
                id: "call-degraded",
                type: "function",
                function: {
                  name: "web__fetch",
                  arguments: "{\"url\":\"https://example.com/node-loop-degraded\"}",
                },
              }],
            },
          }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({
        choices: [{ message: { content: "Recovered from degraded fetch." } }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    try {
      const run = await handle({
        jsonrpc: "2.0",
        id: 1,
        method: "runs.start",
        params: {
          input: { prompt: "Fetch the source and recover if it fails." },
          config: {
            modeId: SINGLE_AGENT_MODE_ID,
            providerId: "node-loop-recovery",
            modelRef: "node-loop-recovery-model",
            providerConfig: {
              id: "node-loop-recovery",
              label: "Node Loop Recovery",
              type: "openai_compatible",
              modelId: "node-loop-recovery-model",
              baseUrl: "https://node-loop-recovery.test/v1",
              apiKeyEnv: "NODE_LOOP_RECOVERY_KEY",
              capabilities: ["chat", "tool_use"],
              headers: {},
            },
            toolIds: ["web.fetch"],
          },
        },
      }) as { runId: string; status: string };

      const state = StateSnapshotSchema.parse(await handle({
        jsonrpc: "2.0",
        id: 2,
        method: "runs.state",
        params: { runId: run.runId },
      }));
      const states = nodeRuntimeStateSequence(state.events, { agentId: ORA_ROOT_AGENT_ID });

      expect(run.status).toBe("succeeded");
      expect(containsStateSubsequence(states, [
        "pending",
        "running_model",
        "tool_requested",
        "tool_running",
        "degraded",
        "repairing",
        "completed",
      ]), states.join(" -> ")).toBe(true);
      expectCoreTransitions(states);
      expectNoTransitionDiagnostics(state.events);
      expect(state.events.map((event) => event.type)).toEqual(expect.arrayContaining([
        "recovery.detected",
        "recovery.applied",
      ]));
      expect(state.events.map((event) => event.type)).not.toContain("run.failed");
      expect(state.toolCalls).toEqual([
        expect.objectContaining({
          providerCallId: "call-degraded",
          toolId: "web.fetch",
          source: "provider_native",
          status: "failed",
          error: "fetch failed for transition test",
        }),
      ]);
      expect(providerBodies.some((body) => body.includes("Workspace tool degraded for web.fetch"))).toBe(true);
    } finally {
      globalThis.fetch = previousFetch;
      if (previousKey === undefined) {
        delete process.env.NODE_LOOP_RECOVERY_KEY;
      } else {
        process.env.NODE_LOOP_RECOVERY_KEY = previousKey;
      }
    }
  });

  it("documents the retry recovery transition path", async () => {
    const handle = createRuntimeMethodHandler(createTempStore());
    const previousFetch = globalThis.fetch;
    const previousKey = process.env.NODE_LOOP_RETRY_RECOVERY_KEY;
    process.env.NODE_LOOP_RETRY_RECOVERY_KEY = "test";
    let providerCalls = 0;
    let webFetchCalls = 0;

    globalThis.fetch = (async (input, init) => {
      if (String(input) === "https://example.com/node-loop-retry") {
        webFetchCalls += 1;
        if (webFetchCalls === 1) {
          throw new Error("retryable fetch failure");
        }
        return new Response("Retry recovery content", { status: 200, headers: { "content-type": "text/plain" } });
      }

      providerCalls += 1;
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        tool_choice?: string;
        messages?: Array<{ role?: string; tool_call_id?: string; content?: string }>;
      };
      if (body.tool_choice === "none") {
        return new Response(JSON.stringify({
          choices: [{ message: { content: "Recovered after retrying the fetch." } }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (body.messages?.some((message) =>
        message.role === "tool" &&
        message.tool_call_id === "call-retry" &&
        String(message.content ?? "").includes("Retry recovery content")
      )) {
        return new Response(JSON.stringify({
          choices: [{ message: { content: "Recovered after retrying the fetch." } }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({
        choices: [{
          finish_reason: "tool_calls",
          message: {
            content: null,
            tool_calls: [{
              id: "call-retry",
              type: "function",
              function: {
                name: "web__fetch",
                arguments: "{\"url\":\"https://example.com/node-loop-retry\"}",
              },
            }],
          },
        }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    try {
      const cloned = await handle({
        jsonrpc: "2.0",
        id: 1,
        method: "modes.cloneFromPreset",
        params: {
          sourceModeId: SINGLE_AGENT_MODE_ID,
          modeId: "node-loop-retry-recovery",
          label: "Node Loop Retry Recovery",
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
            recoveryPolicy: {
              version: 1,
              defaults: {
                ...cloned.recoveryPolicy.defaults,
                backoffMs: 0,
                capDelayMs: 0,
                fallbackArtifact: false,
              },
              rules: [{
                id: "tool-error-retry-once",
                label: "Tool error retry once",
                enabled: true,
                errorTypes: ["tool_error"],
                toolIds: ["web.fetch"],
                action: "retry",
                maxAttempts: 2,
              }],
            },
          },
        },
      });

      const run = await handle({
        jsonrpc: "2.0",
        id: 3,
        method: "runs.start",
        params: {
          input: { prompt: "Fetch and retry once if the fetch fails." },
          config: {
            modeId: cloned.id,
            providerId: "node-loop-retry-recovery",
            modelRef: "node-loop-retry-recovery-model",
            providerConfig: {
              id: "node-loop-retry-recovery",
              label: "Node Loop Retry Recovery",
              type: "openai_compatible",
              modelId: "node-loop-retry-recovery-model",
              baseUrl: "https://node-loop-retry-recovery.test/v1",
              apiKeyEnv: "NODE_LOOP_RETRY_RECOVERY_KEY",
              capabilities: ["chat", "tool_use"],
              headers: {},
            },
            toolIds: ["web.fetch"],
          },
        },
      }) as { runId: string; status: string };

      const state = StateSnapshotSchema.parse(await handle({
        jsonrpc: "2.0",
        id: 4,
        method: "runs.state",
        params: { runId: run.runId },
      }));
      const states = nodeRuntimeStateSequence(state.events, { agentId: ORA_ROOT_AGENT_ID });

      expect(run.status).toBe("succeeded");
      expect(providerCalls).toBeGreaterThanOrEqual(2);
      expect(webFetchCalls).toBe(2);
      expect(containsStateSubsequence(states, [
        "pending",
        "running_model",
        "tool_requested",
        "tool_running",
        "degraded",
        "tool_requested",
        "tool_running",
        "tool_result_observed",
        "running_model",
        "completed",
      ]), states.join(" -> ")).toBe(true);
      expectCoreTransitions(states);
      expect(state.events.filter((event) => event.type === "recovery.retry_scheduled")).toHaveLength(1);
      expect(state.events.map((event) => event.type)).not.toContain("recovery.applied");
      expect(state.events.map((event) => event.type)).not.toContain("run.failed");
      expectNoTransitionDiagnostics(state.events);
      expect(state.events.some((event) =>
        event.type === "action.updated" &&
        typeof event.payload === "object" &&
        event.payload !== null &&
        (event.payload as Record<string, unknown>).status === "failed"
      )).toBe(true);
      expect(state.toolCalls.filter((call) => call.providerCallId === "call-retry")).toEqual([
        expect.objectContaining({ toolId: "web.fetch", status: "succeeded" }),
      ]);
      expect(state.output?.text).toContain("Recovered after retrying the fetch.");
    } finally {
      globalThis.fetch = previousFetch;
      if (previousKey === undefined) {
        delete process.env.NODE_LOOP_RETRY_RECOVERY_KEY;
      } else {
        process.env.NODE_LOOP_RETRY_RECOVERY_KEY = previousKey;
      }
    }
  });

  it("documents the code-development boundary failure transition path", async () => {
    const handle = createRuntimeMethodHandler(createTempStore());
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ora-node-loop-boundary-"));
    const previousFetch = globalThis.fetch;
    const previousKey = process.env.NODE_LOOP_BOUNDARY_KEY;
    process.env.NODE_LOOP_BOUNDARY_KEY = "test";
    let providerCalls = 0;

    globalThis.fetch = (async () => {
      providerCalls += 1;
      if (providerCalls > 1) {
        return new Response(JSON.stringify({
          choices: [{ message: { content: "Continue normally after boundary degradation." } }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({
          tool: "shell.execute",
          args: { command: "rm -rf build" },
        }) } }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    try {
      const run = await handle({
        jsonrpc: "2.0",
        id: 1,
        method: "runs.start",
        params: {
          input: {
            prompt: "Try the unsafe shell command.",
            context: {
              projectWorkspace: { label: "Node Loop Boundary Workspace", rootPath: workspaceRoot },
            },
          },
          config: {
            pattern: "agent_teams",
            modeId: CODE_DEVELOPMENT_MODE_ID,
            providerId: "node-loop-boundary",
            modelRef: "node-loop-boundary-model",
            providerConfig: {
              id: "node-loop-boundary",
              label: "Node Loop Boundary",
              type: "openai_compatible",
              modelId: "node-loop-boundary-model",
              baseUrl: "https://node-loop-boundary.test/v1",
              apiKeyEnv: "NODE_LOOP_BOUNDARY_KEY",
              capabilities: ["chat"],
              headers: {},
            },
            toolIds: ["shell.execute"],
            approvalMode: "auto",
            metadata: { taskIntent: "implement" },
          },
        },
      }) as { runId: string; status: string };

      const state = StateSnapshotSchema.parse(await handle({
        jsonrpc: "2.0",
        id: 2,
        method: "runs.state",
        params: { runId: run.runId },
      }));
      const states = nodeRuntimeStateSequence(state.events, { agentId: "orchestrator" });

      expect(run.status).toBe("succeeded");
      expect(state.status).toBe("succeeded");
      expect(containsStateSubsequence(states, [
        "pending",
        "running_model",
        "tool_requested",
        "failed",
        "degraded",
      ]), states.join(" -> ")).toBe(true);
      expectCoreTransitions(states);
      expect(state.events.map((event) => event.type)).toEqual(expect.arrayContaining([
        "recovery.detected",
        "recovery.applied",
      ]));
      expect(state.events.map((event) => event.type)).not.toContain("run.failed");
      expect(state.actions.some((action) => action.type === "shell.execute")).toBe(false);
      expect(state.actions.some((action) =>
        action.type === "agent.orchestrator.invoke" &&
        action.agentId === "orchestrator" &&
        action.status === "failed"
      )).toBe(true);
      expect(state.toolCalls).toEqual([]);
      expectNoTransitionDiagnostics(state.events);
    } finally {
      globalThis.fetch = previousFetch;
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
      if (previousKey === undefined) {
        delete process.env.NODE_LOOP_BOUNDARY_KEY;
      } else {
        process.env.NODE_LOOP_BOUNDARY_KEY = previousKey;
      }
    }
  });

  it("documents the forced-final path after tool budget exhaustion", async () => {
    const handle = createRuntimeMethodHandler(createTempStore());
    const previousFetch = globalThis.fetch;
    const previousKey = process.env.NODE_LOOP_FORCED_FINAL_KEY;
    process.env.NODE_LOOP_FORCED_FINAL_KEY = "test";
    let webFetchCalls = 0;

    globalThis.fetch = (async (input, init) => {
      if (String(input) === "https://example.com/node-loop-budget") {
        webFetchCalls += 1;
        return new Response("Budget transition content", { status: 200, headers: { "content-type": "text/plain" } });
      }

      const body = JSON.parse(String(init?.body ?? "{}")) as { tool_choice?: string };
      if (body.tool_choice === "none") {
        return new Response(JSON.stringify({
          choices: [{ message: { content: "Final answer from the budgeted tool result." } }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({
        choices: [{
          finish_reason: "tool_calls",
          message: {
            content: null,
            tool_calls: [{
              id: "call-budget",
              type: "function",
              function: {
                name: "web__fetch",
                arguments: "{\"url\":\"https://example.com/node-loop-budget\"}",
              },
            }],
          },
        }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    try {
      const run = await handle({
        jsonrpc: "2.0",
        id: 1,
        method: "runs.start",
        params: {
          input: { prompt: "Use exactly one fetch before finalizing." },
          config: {
            modeId: SINGLE_AGENT_MODE_ID,
            providerId: "node-loop-forced-final",
            modelRef: "node-loop-forced-final-model",
            providerConfig: {
              id: "node-loop-forced-final",
              label: "Node Loop Forced Final",
              type: "openai_compatible",
              modelId: "node-loop-forced-final-model",
              baseUrl: "https://node-loop-forced-final.test/v1",
              apiKeyEnv: "NODE_LOOP_FORCED_FINAL_KEY",
              capabilities: ["chat", "tool_use"],
              headers: {},
            },
            toolIds: ["web.fetch"],
            budget: {
              maxTokens: 1024,
              maxToolCalls: 1,
              maxRuntimeMs: 60_000,
            },
            completionPolicy: {
              preset: "balanced",
              maxRepeatedToolCalls: 2,
              forceFinalOnBudgetExhausted: true,
              forceFinalOnRepeatedTool: true,
              allowToolCallsAfterUsefulResult: true,
            },
          },
        },
      }) as { runId: string; status: string };

      const state = StateSnapshotSchema.parse(await handle({
        jsonrpc: "2.0",
        id: 2,
        method: "runs.state",
        params: { runId: run.runId },
      }));
      const states = nodeRuntimeStateSequence(state.events, { agentId: ORA_ROOT_AGENT_ID });

      expect(run.status).toBe("succeeded");
      expect(webFetchCalls).toBe(1);
      expect(containsStateSubsequence(states, [
        "pending",
        "running_model",
        "tool_requested",
        "tool_running",
        "tool_result_observed",
        "finalizing",
        "completed",
      ])).toBe(true);
      expectCoreTransitions(states);
      expectNoTransitionDiagnostics(state.events);
      expect(state.toolCalls.filter((call) => call.toolId === "web.fetch")).toHaveLength(1);
      expect(state.output).toMatchObject({
        text: expect.stringContaining("Final answer from the budgeted tool result"),
        metadata: { completion: expect.objectContaining({ forcedFinal: true, stopReason: "tool_budget_exhausted" }) },
      });
      expect(state.events.some((event) =>
        event.type === "completion.updated" &&
        typeof event.payload === "object" &&
        event.payload !== null &&
        (event.payload as Record<string, unknown>).state === "force_final" &&
        (event.payload as Record<string, unknown>).reason === "tool_budget_exhausted"
      )).toBe(true);
    } finally {
      globalThis.fetch = previousFetch;
      if (previousKey === undefined) {
        delete process.env.NODE_LOOP_FORCED_FINAL_KEY;
      } else {
        process.env.NODE_LOOP_FORCED_FINAL_KEY = previousKey;
      }
    }
  });

  it("documents forced-final provider failures during recovery", async () => {
    const handle = createRuntimeMethodHandler(createTempStore());
    const previousFetch = globalThis.fetch;
    const previousKey = process.env.NODE_LOOP_FORCED_FINAL_FAILURE_KEY;
    process.env.NODE_LOOP_FORCED_FINAL_FAILURE_KEY = "test";
    let providerCalls = 0;

    globalThis.fetch = (async (_input, init) => {
      providerCalls += 1;
      const body = JSON.parse(String(init?.body ?? "{}")) as { tool_choice?: string };
      if (body.tool_choice === "none") {
        throw new Error("forced final provider unavailable");
      }
      return new Response(JSON.stringify({
        choices: [{
          finish_reason: "tool_calls",
          message: {
            content: null,
            tool_calls: [{
              id: "call-budget-final-provider-fails",
              type: "function",
              function: {
                name: "web__fetch",
                arguments: "{\"url\":\"https://example.com/should-not-run\"}",
              },
            }],
          },
        }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    try {
      const run = await handle({
        jsonrpc: "2.0",
        id: 1,
        method: "runs.start",
        params: {
          input: { prompt: "Use one fetch, then fail during finalization." },
          config: {
            modeId: SINGLE_AGENT_MODE_ID,
            providerId: "node-loop-forced-final-failure",
            modelRef: "node-loop-forced-final-failure-model",
            providerConfig: {
              id: "node-loop-forced-final-failure",
              label: "Node Loop Forced Final Failure",
              type: "openai_compatible",
              modelId: "node-loop-forced-final-failure-model",
              baseUrl: "https://node-loop-forced-final-failure.test/v1",
              apiKeyEnv: "NODE_LOOP_FORCED_FINAL_FAILURE_KEY",
              capabilities: ["chat", "tool_use"],
              headers: {},
            },
            toolIds: ["web.fetch"],
            budget: {
              maxTokens: 1024,
              maxToolCalls: 0,
              maxRuntimeMs: 60_000,
            },
            completionPolicy: {
              preset: "balanced",
              maxRepeatedToolCalls: 2,
              forceFinalOnBudgetExhausted: true,
              forceFinalOnRepeatedTool: true,
              allowToolCallsAfterUsefulResult: true,
            },
          },
        },
      }) as { runId: string; status: string };

      const state = StateSnapshotSchema.parse(await handle({
        jsonrpc: "2.0",
        id: 2,
        method: "runs.state",
        params: { runId: run.runId },
      }));
      const states = nodeRuntimeStateSequence(state.events, { agentId: ORA_ROOT_AGENT_ID });

      expect(run.status).toBe("succeeded");
      expect(state.status).toBe("succeeded");
      expect(providerCalls).toBeGreaterThanOrEqual(3);
      expect(containsStateSubsequence(states, ["pending", "finalizing", "failed"])).toBe(true);
      expectCoreTransitions(states);
      expect(states).not.toContain("completed");
      expect(state.events.filter((event) => event.type === "recovery.retry_scheduled")).toHaveLength(2);
      expect(state.events.filter((event) => event.type === "recovery.applied")).toHaveLength(1);
      expect(state.events.map((event) => event.type)).toContain("run.done");
      expect(state.events.map((event) => event.type)).not.toContain("run.failed");
      expect(state.toolCalls.filter((call) => call.toolId === "web.fetch")).toHaveLength(0);
      expect(state.events.some((event) =>
        event.type === "completion.updated" &&
        typeof event.payload === "object" &&
        event.payload !== null &&
        (event.payload as Record<string, unknown>).state === "force_final" &&
        (event.payload as Record<string, unknown>).reason === "tool_budget_exhausted"
      )).toBe(true);
      expectNoTransitionDiagnostics(state.events);
    } finally {
      globalThis.fetch = previousFetch;
      if (previousKey === undefined) {
        delete process.env.NODE_LOOP_FORCED_FINAL_FAILURE_KEY;
      } else {
        process.env.NODE_LOOP_FORCED_FINAL_FAILURE_KEY = previousKey;
      }
    }
  });
});
