import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CODE_DEVELOPMENT_MODE_ID, DEFAULT_SKILL_TOOL_IDS, DEFAULT_WEB_TOOL_IDS, DEBATE_MODE_ID, DEERFLOW_HARNESS_MODE_ID, FlowRunDetailSchema, FlowRunHandleSchema, MODE_STUDIO_BUILDER_MODE_ID, ORA_ROOT_AGENT_ID, ORA_SELF_BUILDER_MODE_ID, RunConfigSchema, SINGLE_AGENT_MODE_ID, OraEventEnvelopeSchema, StateSnapshotSchema, getModePreset, modeSpecToPatternDefinition, type StateSnapshot } from "@cemeworm/shared";
import { LocalRunStore, createRuntimeMethodHandler, executeRuntimeKernel, handleJsonRpcLine } from "../src/index.js";
import { nodeLoopTransitionDiagnostics } from "../src/harness/node-loop-transitions.js";
import { createResumeApprovalMatcher } from "../src/harness/runtime-interrupts.js";
import { summarizeNarratorProgressPayload } from "../src/harness/runtime-prompts.js";

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

function expectEventSeqSemantics(snapshot: StateSnapshot) {
  expect(snapshot.events.map((event) => event.seq)).toEqual([...Array(snapshot.events.length).keys()]);
  for (const checkpoint of snapshot.checkpoints) {
    const checkpointEvent = snapshot.events[checkpoint.eventSeq];
    expect(checkpointEvent).toMatchObject({
      seq: checkpoint.eventSeq,
      type: "checkpoint.created",
      checkpointId: checkpoint.id,
    });
  }
}

function expectNoNodeLoopTransitionDiagnostics(snapshot: StateSnapshot) {
  expect(nodeLoopTransitionDiagnostics(snapshot.events)).toEqual([]);
}

async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs = 1000) {
  const start = Date.now();
  while (!await predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("Timed out waiting for condition");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("Ora runtime smoke path", () => {
  it("defaults run config mode selection to manual", () => {
    expect(RunConfigSchema.parse({ pattern: "orchestrator_subagent" }).modeSelection).toBe("manual");
  });

  it("exposes task flow aliases without changing session run behavior", async () => {
    const handle = createRuntimeMethodHandler(createTempStore());
    const session = await handle({
      jsonrpc: "2.0",
      id: 1,
      method: "sessions.create",
      params: {},
    }) as { sessionId: string };

    const flow = FlowRunHandleSchema.parse(await handle({
      jsonrpc: "2.0",
      id: 2,
      method: "flows.create",
      params: {
        sessionId: session.sessionId,
        input: { prompt: "Run through the task flow adapter." },
        config: { modeId: SINGLE_AGENT_MODE_ID, modelRef: "local/smoke-model" },
      },
    }));
    expect(flow.flowRunId).toBe(flow.runId);
    expect(flow.sessionId).toBe(session.sessionId);

    const detail = FlowRunDetailSchema.parse(await handle({
      jsonrpc: "2.0",
      id: 3,
      method: "flows.get",
      params: { flowRunId: flow.flowRunId },
    }));
    expect(detail).toMatchObject({
      flowRunId: flow.runId,
      runId: flow.runId,
      sessionId: session.sessionId,
      status: "succeeded",
      definition: { source: "mode_spec", modeId: SINGLE_AGENT_MODE_ID },
    });
    expect(detail.linkedSessionIds).toEqual([session.sessionId]);
    expect(detail.latestSnapshot?.runId).toBe(flow.runId);

    const sessionDetail = await handle({
      jsonrpc: "2.0",
      id: 4,
      method: "sessions.get",
      params: { sessionId: session.sessionId },
    }) as { turns: Array<{ runId: string }> };
    expect(sessionDetail.turns.map((turn) => turn.runId)).toContain(flow.runId);

    const stream = await handle({
      jsonrpc: "2.0",
      id: 5,
      method: "flows.stream",
      params: { flowRunId: flow.flowRunId },
    }) as { runId: string; events: Array<{ type: string }> };
    expect(stream.runId).toBe(flow.runId);
    expect(stream.events.some((event) => event.type === "run.done")).toBe(true);

    const checkpoints = await handle({
      jsonrpc: "2.0",
      id: 6,
      method: "flows.checkpoints",
      params: { flowRunId: flow.flowRunId },
    }) as Array<{ id: string }>;
    expect(checkpoints.length).toBeGreaterThan(0);

    const replay = await handle({
      jsonrpc: "2.0",
      id: 7,
      method: "flows.replay",
      params: { flowRunId: flow.flowRunId, checkpointId: checkpoints[0]!.id },
    }) as { runId: string; events: Array<{ type: string }> };
    expect(replay.runId).toBe(flow.runId);
    expect(replay.events.at(-1)?.type).toBe("checkpoint.created");

    const fork = FlowRunHandleSchema.parse(await handle({
      jsonrpc: "2.0",
      id: 8,
      method: "flows.fork",
      params: {
        flowRunId: flow.flowRunId,
        checkpointId: checkpoints[0]!.id,
        input: { prompt: "Fork through the flow adapter." },
      },
    }));
    expect(fork.flowRunId).toBe(fork.runId);
    expect(fork.runId).not.toBe(flow.runId);
    expect(fork.sessionId).toBe(session.sessionId);

    const cancelledFork = StateSnapshotSchema.parse(await handle({
      jsonrpc: "2.0",
      id: 9,
      method: "flows.cancel",
      params: { flowRunId: fork.flowRunId, reason: "Flow adapter cancellation test." },
    }));
    expect(cancelledFork.status).toBe("cancelled");
    const cancelledDetail = FlowRunDetailSchema.parse(await handle({
      jsonrpc: "2.0",
      id: 10,
      method: "flows.get",
      params: { flowRunId: fork.flowRunId },
    }));
    expect(cancelledDetail.gates).toContainEqual(expect.objectContaining({
      kind: "cancellation",
      status: "cancelled",
      flowRunId: fork.flowRunId,
    }));
  });

  it("keeps branch candidates hidden until an empty-start candidate is adopted", async () => {
    const handle = createRuntimeMethodHandler(createTempStore());
    const session = await handle({
      jsonrpc: "2.0",
      id: 1,
      method: "sessions.create",
      params: {},
    }) as { sessionId: string };

    const group = await handle({
      jsonrpc: "2.0",
      id: 2,
      method: "sessions.branchGroups.createAndRun",
      params: {
        sessionId: session.sessionId,
        target: "empty_start",
        prompt: "Compare first answers.",
        candidates: [
          { label: "Single", config: { modeId: SINGLE_AGENT_MODE_ID, modelRef: "local/smoke-model" } },
          { label: "Debate", config: { modeId: DEBATE_MODE_ID, modelRef: "local/smoke-model" } },
        ],
      },
    }) as { branchGroupId: string; candidateRunIds: string[] };

    let detail = await handle({
      jsonrpc: "2.0",
      id: 3,
      method: "sessions.get",
      params: { sessionId: session.sessionId },
    }) as { turns: unknown[]; branchGroups: { status: string; candidateRunIds: string[] }[] };
    expect(detail.turns).toHaveLength(0);
    expect(detail.branchGroups[0]?.candidateRunIds).toHaveLength(2);

    await waitFor(async () => {
      const current = await handle({
        jsonrpc: "2.0",
        id: 4,
        method: "sessions.branchGroups.get",
        params: { sessionId: session.sessionId, branchGroupId: group.branchGroupId },
      }) as { status: string };
      return current.status === "ready";
    });

    detail = await handle({
      jsonrpc: "2.0",
      id: 5,
      method: "sessions.branchGroups.adopt",
      params: { sessionId: session.sessionId, branchGroupId: group.branchGroupId, runId: group.candidateRunIds[0] },
    }) as { session: { latestRunId?: string; turnCount: number }; turns: { runId: string }[] };
    expect(detail.session.latestRunId).toBe(group.candidateRunIds[0]);
    expect(detail.session.turnCount).toBe(1);
    expect(detail.turns.map((turn) => turn.runId)).toEqual([group.candidateRunIds[0]]);
  });

  it("replaces the latest turn with a branch candidate without increasing turn count", async () => {
    const handle = createRuntimeMethodHandler(createTempStore());
    const first = await handle({
      jsonrpc: "2.0",
      id: 1,
      method: "runs.start",
      params: {
        input: { prompt: "First turn." },
        config: { modeId: SINGLE_AGENT_MODE_ID, modelRef: "local/smoke-model" },
      },
    }) as { sessionId: string; runId: string };
    const second = await handle({
      jsonrpc: "2.0",
      id: 2,
      method: "runs.start",
      params: {
        sessionId: first.sessionId,
        input: { prompt: "Second turn." },
        config: { modeId: SINGLE_AGENT_MODE_ID, modelRef: "local/smoke-model" },
      },
    }) as { runId: string };

    const group = await handle({
      jsonrpc: "2.0",
      id: 3,
      method: "sessions.branchGroups.createAndRun",
      params: {
        sessionId: first.sessionId,
        target: "replace_latest",
        candidates: [
          { label: "Replacement", config: { modeId: DEBATE_MODE_ID, modelRef: "local/smoke-model" } },
        ],
      },
    }) as { branchGroupId: string; candidateRunIds: string[] };

    await waitFor(async () => {
      const current = await handle({
        jsonrpc: "2.0",
        id: 4,
        method: "sessions.branchGroups.get",
        params: { sessionId: first.sessionId, branchGroupId: group.branchGroupId },
      }) as { status: string };
      return current.status === "ready";
    });

    const detail = await handle({
      jsonrpc: "2.0",
      id: 5,
      method: "sessions.branchGroups.adopt",
      params: { sessionId: first.sessionId, branchGroupId: group.branchGroupId, runId: group.candidateRunIds[0] },
    }) as { session: { latestRunId?: string; turnCount: number }; turns: { runId: string; turnIndex: number }[] };

    expect(detail.session.latestRunId).toBe(group.candidateRunIds[0]);
    expect(detail.session.turnCount).toBe(2);
    expect(detail.turns.map((turn) => turn.runId)).toEqual([first.runId, group.candidateRunIds[0]]);
    expect(detail.turns.at(-1)?.turnIndex).toBe(2);
    expect(detail.turns.map((turn) => turn.runId)).not.toContain(second.runId);
  });

  it("stops code development after a complete proposed plan in plan mode", async () => {
    const handle = createRuntimeMethodHandler(createTempStore());
    const previousFetch = globalThis.fetch;
    const previousKey = process.env.PLAN_MODE_PROVIDER_KEY;
    process.env.PLAN_MODE_PROVIDER_KEY = "test";
    const providerBodies: string[] = [];
    const proposedPlan = [
      "<proposed_plan>",
      "# PlanDecisionPanel 决策状态 UI 调整",
      "## Summary",
      "调整计划模式的决策状态 UI。",
      "## Key Changes",
      "- 更新 PlanDecisionPanel 的按钮颜色和键盘导航。",
      "## Test Plan",
      "- 运行相关组件测试。",
      "</proposed_plan>",
    ].join("\n");

    globalThis.fetch = (async (_input, init) => {
      providerBodies.push(String(init?.body ?? ""));
      return new Response(JSON.stringify({
        choices: [{
          finish_reason: "stop",
          message: { content: proposedPlan },
        }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    try {
      const run = await handle({
        jsonrpc: "2.0",
        id: 1,
        method: "runs.start",
        params: {
          input: { prompt: "请先输出任务计划，不要实施。" },
          config: {
            modeId: CODE_DEVELOPMENT_MODE_ID,
            providerId: "plan-mode-provider",
            modelRef: "plan-mode-model",
            providerConfig: {
              id: "plan-mode-provider",
              label: "Plan Mode Provider",
              type: "openai_compatible",
              modelId: "plan-mode-model",
              baseUrl: "https://plan-mode-provider.test/v1",
              apiKeyEnv: "PLAN_MODE_PROVIDER_KEY",
              capabilities: ["chat", "tool_use"],
              headers: {},
            },
            metadata: { taskIntent: "plan" },
          },
        },
      }) as { runId: string; status: string };

      const state = StateSnapshotSchema.parse(await handle({
        jsonrpc: "2.0",
        id: 2,
        method: "runs.state",
        params: { runId: run.runId },
      }));

      expect(run.status).toBe("succeeded");
      expect(state.status).toBe("succeeded");
      expect(providerBodies.join("\n")).not.toContain("Build assigned work");
      expect(providerBodies.join("\n")).not.toContain("Validate assigned work");
      expect(providerBodies.join("\n")).not.toContain("Diagnose failures");
      expect(providerBodies.join("\n")).not.toContain("The selected mode has returned its work product");
      expect(state.output).toMatchObject({
        text: expect.stringContaining("<proposed_plan>"),
        stoppedAfterProposedPlan: true,
      });
      expect(state.attention).toMatchObject({
        kind: "needs_plan_decision",
        blocking: true,
      });
      expect(state.planDecisions).toHaveLength(1);
      expect(state.planDecisions[0]).toMatchObject({
        status: "pending",
        sessionId: state.sessionId,
        planContent: expect.stringContaining("# PlanDecisionPanel 决策状态 UI 调整"),
        planSourceRunId: run.runId,
      });
      expect(state.plan.filter((item) => item.status === "done").map((item) => item.id)).toEqual([`${run.runId}:triage`]);
      expect(state.plan.filter((item) => item.status === "skipped").map((item) => item.id)).toEqual([
        `${run.runId}:build`,
        `${run.runId}:review`,
        `${run.runId}:debug`,
        `${run.runId}:handoff`,
      ]);
      expect(state.agentMessages.some((message) => message.nodeId === "build")).toBe(false);
      expect(state.agentMessages.some((message) => message.nodeId === "review")).toBe(false);
      expect(state.agentMessages.some((message) => message.nodeId === "debug")).toBe(false);
    } finally {
      globalThis.fetch = previousFetch;
      if (previousKey === undefined) {
        delete process.env.PLAN_MODE_PROVIDER_KEY;
      } else {
        process.env.PLAN_MODE_PROVIDER_KEY = previousKey;
      }
    }
  });

  it("ignores plan.update tool calls in plan mode without entering tool recovery", async () => {
    const handle = createRuntimeMethodHandler(createTempStore());
    const previousFetch = globalThis.fetch;
    const previousKey = process.env.PLAN_MODE_TOOL_PROVIDER_KEY;
    process.env.PLAN_MODE_TOOL_PROVIDER_KEY = "test";
    let providerCalls = 0;

    globalThis.fetch = (async (_input, init) => {
      providerCalls += 1;
      expect(String(init?.body ?? "")).not.toContain("plan__update");
      if (providerCalls === 1) {
        return new Response(JSON.stringify({
          choices: [{
            finish_reason: "tool_calls",
            message: {
              content: null,
              tool_calls: [{
                id: "call-plan-update",
                type: "function",
                function: {
                  name: "plan__update",
                  arguments: "{\"plan\":[{\"step\":\"Inspect\",\"status\":\"in_progress\"}]}",
                },
              }],
            },
          }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({
        choices: [{
          finish_reason: "stop",
          message: { content: "<proposed_plan>\n# Safe plan\n## 实施步骤\n1. Inspect only.\n## 验证方式\n- Review the plan.\n</proposed_plan>" },
        }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    try {
      const run = await handle({
        jsonrpc: "2.0",
        id: 1,
        method: "runs.start",
        params: {
          input: { prompt: "请先输出任务计划，不要实施。" },
          config: {
            modeId: CODE_DEVELOPMENT_MODE_ID,
            providerId: "plan-mode-tool-provider",
            modelRef: "plan-mode-tool-model",
            providerConfig: {
              id: "plan-mode-tool-provider",
              label: "Plan Mode Tool Provider",
              type: "openai_compatible",
              modelId: "plan-mode-tool-model",
              baseUrl: "https://plan-mode-tool-provider.test/v1",
              apiKeyEnv: "PLAN_MODE_TOOL_PROVIDER_KEY",
              capabilities: ["chat", "tool_use"],
              headers: {},
            },
            metadata: { taskIntent: "plan" },
            toolIds: ["file.read", "plan.update"],
          },
        },
      }) as { runId: string; status: string };

      const state = StateSnapshotSchema.parse(await handle({
        jsonrpc: "2.0",
        id: 2,
        method: "runs.state",
        params: { runId: run.runId },
      }));

      expect(run.status).toBe("succeeded");
      expect(state.status).toBe("succeeded");
      expect(providerCalls).toBeGreaterThanOrEqual(2);
      expect(state.toolCalls).toEqual([]);
      expect(state.events.map((event) => event.type)).not.toContain("recovery.detected");
      expect(state.events).toEqual(expect.arrayContaining([
        expect.objectContaining({
          type: "completion.updated",
          payload: expect.objectContaining({
            state: "tool_calls_ignored",
            reason: "unavailable_tool_in_mode",
          }),
        }),
      ]));
      expectNoNodeLoopTransitionDiagnostics(state);
      expect(state.output).toMatchObject({
        text: expect.stringContaining("<proposed_plan>"),
        stoppedAfterProposedPlan: true,
      });
    } finally {
      globalThis.fetch = previousFetch;
      if (previousKey === undefined) {
        delete process.env.PLAN_MODE_TOOL_PROVIDER_KEY;
      } else {
        process.env.PLAN_MODE_TOOL_PROVIDER_KEY = previousKey;
      }
    }
  });

  it("injects an accepted proposed plan into the next implementation run after compaction", async () => {
    const handle = createRuntimeMethodHandler(createTempStore());
    const previousFetch = globalThis.fetch;
    const previousKey = process.env.ACCEPTED_PLAN_PROVIDER_KEY;
    process.env.ACCEPTED_PLAN_PROVIDER_KEY = "test";
    const providerBodies: string[] = [];
    const acceptedPlanTitle = "# Runtime Accepted Plan Handoff";
    const proposedPlan = [
      "<proposed_plan>",
      acceptedPlanTitle,
      "## Summary",
      "Persist the accepted plan as a runtime handoff contract.",
      "## Key Changes",
      "- Save the plan content on the plan decision gate.",
      "- Inject the accepted plan into the implementation run after compaction.",
      "## Test Plan",
      "- Assert the implementation provider request contains the accepted plan.",
      "</proposed_plan>",
    ].join("\n");
    const providerConfig = {
      id: "accepted-plan-provider",
      label: "Accepted Plan Provider",
      type: "openai_compatible" as const,
      modelId: "accepted-plan-model",
      baseUrl: "https://accepted-plan-provider.test/v1",
      apiKeyEnv: "ACCEPTED_PLAN_PROVIDER_KEY",
      capabilities: ["chat", "tool_use"],
      headers: {},
      contextWindow: 64,
      autoCompactTokenLimit: 1,
    };

    globalThis.fetch = (async (_input, init) => {
      const body = String(init?.body ?? "");
      providerBodies.push(body);
      const content = body.includes("compressing an Ora session history")
        ? "Compacted history intentionally omits the plan body."
        : body.includes("请先输出任务计划")
          ? proposedPlan
          : "Implementation received the accepted plan.";
      return new Response(JSON.stringify({
        choices: [{
          finish_reason: "stop",
          message: { content },
        }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    try {
      const planRun = await handle({
        jsonrpc: "2.0",
        id: 1,
        method: "runs.start",
        params: {
          input: { prompt: "请先输出任务计划，不要实施。" },
          config: {
            modeId: CODE_DEVELOPMENT_MODE_ID,
            providerId: providerConfig.id,
            modelRef: providerConfig.modelId,
            providerConfig,
            metadata: { taskIntent: "plan" },
          },
        },
      }) as { runId: string; sessionId: string };
      const planState = StateSnapshotSchema.parse(await handle({
        jsonrpc: "2.0",
        id: 2,
        method: "runs.state",
        params: { runId: planRun.runId },
      }));
      const decision = planState.planDecisions[0];
      expect(decision).toMatchObject({
        status: "pending",
        planContent: expect.stringContaining(acceptedPlanTitle),
      });

      await handle({
        jsonrpc: "2.0",
        id: 3,
        method: "sessions.resolvePlanDecision",
        params: {
          sessionId: planRun.sessionId,
          decisionId: decision!.id,
          status: "accepted",
        },
      });

      const implementationRun = await handle({
        jsonrpc: "2.0",
        id: 4,
        method: "runs.start",
        params: {
          sessionId: planRun.sessionId,
          input: { prompt: "请按照上述计划开始执行" },
          config: {
            modeId: SINGLE_AGENT_MODE_ID,
            providerId: providerConfig.id,
            modelRef: providerConfig.modelId,
            providerConfig,
            metadata: { taskIntent: "implement" },
          },
        },
      }) as { runId: string };
      const implementationState = StateSnapshotSchema.parse(await handle({
        jsonrpc: "2.0",
        id: 5,
        method: "runs.state",
        params: { runId: implementationRun.runId },
      }));

      const implementationBody = providerBodies.at(-1) ?? "";
      expect(providerBodies.some((body) => body.includes("Compacted prior session context"))).toBe(true);
      expect(implementationBody).toContain("<accepted_plan>");
      expect(implementationBody).toContain(acceptedPlanTitle);
      expect(implementationBody).toContain("Inject the accepted plan into the implementation run after compaction.");
      expect(implementationState.config.metadata).toMatchObject({
        acceptedPlanDecisionId: decision!.id,
        acceptedPlanRunId: planRun.runId,
      });
    } finally {
      globalThis.fetch = previousFetch;
      if (previousKey === undefined) {
        delete process.env.ACCEPTED_PLAN_PROVIDER_KEY;
      } else {
        process.env.ACCEPTED_PLAN_PROVIDER_KEY = previousKey;
      }
    }
  });

  it("blocks code development plan mode before implementation when triage is not a proposed plan", async () => {
    const handle = createRuntimeMethodHandler(createTempStore());
    const previousFetch = globalThis.fetch;
    const previousKey = process.env.INVALID_PLAN_PROVIDER_KEY;
    process.env.INVALID_PLAN_PROVIDER_KEY = "test";
    const providerBodies: string[] = [];

    globalThis.fetch = (async (_input, init) => {
      providerBodies.push(String(init?.body ?? ""));
      return new Response(JSON.stringify({
        choices: [{
          finish_reason: "stop",
          message: {
            content: [
              "{\"tool\": \"file.read\", \"args\": {\"path\": \"apps/desktop/src/components/onboarding/ProviderOnboardingStep.tsx\"}}",
              "",
              "<result><omitted /></result>",
              "</previous_tool_call>",
            ].join("\n"),
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
          input: { prompt: "请先输出任务计划，不要实施。" },
          config: {
            modeId: CODE_DEVELOPMENT_MODE_ID,
            providerId: "invalid-plan-provider",
            modelRef: "invalid-plan-model",
            providerConfig: {
              id: "invalid-plan-provider",
              label: "Invalid Plan Provider",
              type: "openai_compatible",
              modelId: "invalid-plan-model",
              baseUrl: "https://invalid-plan-provider.test/v1",
              apiKeyEnv: "INVALID_PLAN_PROVIDER_KEY",
              capabilities: ["chat", "tool_use"],
              headers: {},
            },
            metadata: { taskIntent: "plan" },
          },
        },
      }) as { runId: string; status: string };

      const state = StateSnapshotSchema.parse(await handle({
        jsonrpc: "2.0",
        id: 2,
        method: "runs.state",
        params: { runId: run.runId },
      }));
      const firstPlanEvent = state.events.find((event) => event.type === "plan.updated");
      const firstPlanItems = firstPlanEvent?.payload && typeof firstPlanEvent.payload === "object"
        ? (firstPlanEvent.payload as { items?: Array<{ status?: string; linkedActionIds?: string[] }> }).items ?? []
        : [];

      expect(run.status).toBe("failed");
      expect(state.status).toBe("failed");
      expect(providerBodies.join("\n")).not.toContain("Build assigned work");
      expect(providerBodies.join("\n")).not.toContain("Validate assigned work");
      expect(state.agentMessages.some((message) => message.nodeId === "build")).toBe(false);
      expect(state.agentMessages.some((message) => message.nodeId === "review")).toBe(false);
      expect(state.agentMessages.map((message) => message.content).join("\n")).not.toContain("<previous_tool_call>");
      expect(state.output).toMatchObject({
        text: expect.stringContaining("Mode progress is incomplete"),
        modeOutput: expect.objectContaining({
          stoppedAfterInvalidPlan: true,
          invalidPlanReason: "invalid_or_internal_triage_output",
        }),
      });
      expect(state.plan.find((item) => item.id === `${run.runId}:triage`)?.status).toBe("failed");
      expect(state.plan.filter((item) => item.status === "skipped").map((item) => item.id)).toEqual([
        `${run.runId}:build`,
        `${run.runId}:review`,
        `${run.runId}:debug`,
        `${run.runId}:handoff`,
      ]);
      expect(firstPlanItems.map((item) => item.status)).toEqual(["ready", "planned", "planned", "planned", "planned"]);
      expect(firstPlanItems.every((item) => (item.linkedActionIds ?? []).length === 0)).toBe(true);
    } finally {
      globalThis.fetch = previousFetch;
      if (previousKey === undefined) {
        delete process.env.INVALID_PLAN_PROVIDER_KEY;
      } else {
        process.env.INVALID_PLAN_PROVIDER_KEY = previousKey;
      }
    }
  });

  it("blocks code development plan mode when a complete proposed plan also contains internal tool text", async () => {
    const handle = createRuntimeMethodHandler(createTempStore());
    const previousFetch = globalThis.fetch;
    const previousKey = process.env.INTERNAL_PLAN_PROVIDER_KEY;
    process.env.INTERNAL_PLAN_PROVIDER_KEY = "test";
    const providerBodies: string[] = [];
    const proposedPlanWithInternalText = [
      "<proposed_plan>",
      "# Provider onboarding model fetch",
      "## Summary",
      "Add a fetch button and model list loading state.",
      "## Key Changes",
      "- Wire provider credentials into a model-list request.",
      "- Render loading, success, and error states.",
      "## Test Plan",
      "- Run focused desktop tests.",
      "</proposed_plan>",
      "{\"tool\": \"file.read\", \"args\": {\"path\": \".ora/runtime.db\"}}",
      "<result><omitted /></result>",
    ].join("\n");

    globalThis.fetch = (async (_input, init) => {
      providerBodies.push(String(init?.body ?? ""));
      return new Response(JSON.stringify({
        choices: [{
          finish_reason: "stop",
          message: { content: proposedPlanWithInternalText },
        }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    try {
      const run = await handle({
        jsonrpc: "2.0",
        id: 1,
        method: "runs.start",
        params: {
          input: { prompt: "请先输出任务计划，不要实施。" },
          config: {
            modeId: CODE_DEVELOPMENT_MODE_ID,
            providerId: "internal-plan-provider",
            modelRef: "internal-plan-model",
            providerConfig: {
              id: "internal-plan-provider",
              label: "Internal Plan Provider",
              type: "openai_compatible",
              modelId: "internal-plan-model",
              baseUrl: "https://internal-plan-provider.test/v1",
              apiKeyEnv: "INTERNAL_PLAN_PROVIDER_KEY",
              capabilities: ["chat", "tool_use"],
              headers: {},
            },
            metadata: { taskIntent: "plan" },
          },
        },
      }) as { runId: string; status: string };

      const state = StateSnapshotSchema.parse(await handle({
        jsonrpc: "2.0",
        id: 2,
        method: "runs.state",
        params: { runId: run.runId },
      }));

      expect(run.status).toBe("failed");
      expect(state.status).toBe("failed");
      expect(providerBodies.join("\n")).not.toContain("Build assigned work");
      expect(providerBodies.join("\n")).not.toContain("Validate assigned work");
      expect(state.planDecisions).toHaveLength(0);
      expect(state.output).toMatchObject({
        text: expect.stringContaining("Mode progress is incomplete"),
        modeOutput: expect.objectContaining({
          stoppedAfterInvalidPlan: true,
          invalidPlanReason: "invalid_or_internal_triage_output",
        }),
      });
      expect(state.plan.find((item) => item.id === `${run.runId}:triage`)?.status).toBe("failed");
      expect(state.plan.filter((item) => item.status === "skipped").map((item) => item.id)).toEqual([
        `${run.runId}:build`,
        `${run.runId}:review`,
        `${run.runId}:debug`,
        `${run.runId}:handoff`,
      ]);
    } finally {
      globalThis.fetch = previousFetch;
      if (previousKey === undefined) {
        delete process.env.INTERNAL_PLAN_PROVIDER_KEY;
      } else {
        process.env.INTERNAL_PLAN_PROVIDER_KEY = previousKey;
      }
    }
  });

  it("derives effective runtime strategy from selected modes", async () => {
    const handle = createRuntimeMethodHandler(createTempStore());

    async function routerOnlyState(modeId: string) {
      const run = await handle({
        jsonrpc: "2.0",
        id: `start:${modeId}`,
        method: "runs.start",
        params: {
          input: { prompt: `Run ${modeId}.` },
          config: {
            modeId,
            providerId: "local-smoke",
            metadata: { evaluationRouterOnly: true },
          },
        },
      }) as { runId: string };
      return StateSnapshotSchema.parse(await handle({
        jsonrpc: "2.0",
        id: `state:${modeId}`,
        method: "runs.state",
        params: { runId: run.runId },
      }));
    }

    const single = await routerOnlyState(SINGLE_AGENT_MODE_ID);
    const deerflow = await routerOnlyState(DEERFLOW_HARNESS_MODE_ID);
    const teams = await routerOnlyState("agent_teams");

    expect(single.config.effectiveStrategy).toMatchObject({
      sourceModeId: SINGLE_AGENT_MODE_ID,
      thinking: "standard",
      planning: "light",
      delegationEnabled: false,
      providerPolicyStatus: "unsupported",
    });
    expect(deerflow.config.effectiveStrategy).toMatchObject({
      sourceModeId: DEERFLOW_HARNESS_MODE_ID,
      thinking: "deep",
      planning: "explicit",
      delegation: "allowed",
      providerPolicyStatus: "degraded",
    });
    expect(teams.config.effectiveStrategy).toMatchObject({
      sourceModeId: "agent_teams",
      thinking: "deep",
      delegation: "preferred",
      delegationEnabled: true,
      providerPolicyStatus: "degraded",
    });
    expect(deerflow.config.metadata.effectiveStrategy).toEqual(deerflow.config.effectiveStrategy);
  });

  it("asks for clarification before researching materially ambiguous high-consequence requests", async () => {
    const handle = createRuntimeMethodHandler(createTempStore());
    const previousFetch = globalThis.fetch;
    const previousKey = process.env.INTENT_CLARIFICATION_KEY;
    process.env.INTENT_CLARIFICATION_KEY = "test";
    let providerCalls = 0;
    let intentClarificationIssued = false;
    const providerBodies: string[] = [];

    globalThis.fetch = (async (_input, init) => {
      providerCalls += 1;
      const body = String(init?.body ?? "");
      providerBodies.push(body);
      if (!intentClarificationIssued && body.includes("needsClarification")) {
        intentClarificationIssued = true;
        return new Response(JSON.stringify({
          choices: [{
            message: {
              content: JSON.stringify({
                needsClarification: true,
                question: "在继续查资料前，我需要确认：你们在这个问题里的角色是清算通道方、收单机构还是跨境商户？另外“这种规模”大概指月交易额、日单量、商户数、牌照/地区范围中的哪些指标？这些会直接影响结算 T+N 判断。",
              }),
            },
          }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({
        choices: [{ message: { content: "已根据你补充的角色和规模继续判断。" } }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    try {
      const run = await handle({
        jsonrpc: "2.0",
        id: 1,
        method: "runs.start",
        params: {
          input: {
            prompt: "查一下关于‘跨境扫码付’的最新汇率清算协议，我们这种规模的机构，现在的结算 T+N 周期有没有缩短？",
          },
          config: {
            modeId: SINGLE_AGENT_MODE_ID,
            providerId: "intent-clarification",
            modelRef: "intent-clarification-model",
            providerConfig: {
              id: "intent-clarification",
              label: "Intent Clarification",
              type: "openai_compatible",
              modelId: "intent-clarification-model",
              baseUrl: "https://intent-clarification.test/v1",
              apiKeyEnv: "INTENT_CLARIFICATION_KEY",
              capabilities: ["chat", "tool_use"],
              headers: {},
            },
            toolIds: ["web.search"],
            metadata: { clarificationPreflight: true, progressNarration: true },
          },
        },
      }) as { runId: string; status: string };
      const blocked = StateSnapshotSchema.parse(await handle({
        jsonrpc: "2.0",
        id: 2,
        method: "runs.state",
        params: { runId: run.runId },
      }));

      expect(run.status).toBe("interrupted");
      expect(blocked.status).toBe("interrupted");
      expect(providerBodies.some((body) => body.includes("needsClarification"))).toBe(true);
      expect(blocked.toolCalls).toHaveLength(0);
      expect(blocked.pendingClarifications).toHaveLength(1);
      expect(blocked.pendingClarifications[0]).toMatchObject({
        key: "intent_guard",
        nodeId: ORA_ROOT_AGENT_ID,
      });
      expect(blocked.pendingClarifications[0]?.question).toContain("角色是清算通道方、收单机构还是跨境商户");
      expect(blocked.pendingClarifications[0]?.question).toContain("月交易额、日单量、商户数、牌照/地区范围");
      expect(blocked.pendingClarifications[0]?.question).not.toContain("交易量不大");
      expect(blocked.events.some((event) => event.type === "clarification.required")).toBe(true);
      expect(blocked.events.some((event) =>
        event.type === "tool.called" &&
        typeof event.payload === "object" &&
        event.payload !== null &&
        (event.payload as Record<string, unknown>).toolId === "web.search"
      )).toBe(false);

      const resumed = StateSnapshotSchema.parse(await handle({
        jsonrpc: "2.0",
        id: 3,
        method: "runs.resume",
        params: {
          runId: run.runId,
          patch: {
            clarifications: {
              intent_guard: "我们是跨境收单机构，月交易额约 3000 万人民币，主要覆盖东南亚二维码商户。",
            },
          },
        },
      }));

      expect(resumed.status).toBe("succeeded");
      expect(resumed.pendingClarifications).toEqual([]);
      expect(resumed.events.map((event) => event.type)).toContain("clarification.resolved");
      expect(providerCalls).toBeGreaterThan(1);
      expect(providerBodies.some((body) => body.includes("User-supplied clarification context"))).toBe(true);
      expect(providerBodies.some((body) => body.includes("跨境收单机构"))).toBe(true);
      expect(resumed.output?.text).toContain("已根据你补充的角色和规模继续判断");
    } finally {
      globalThis.fetch = previousFetch;
      if (previousKey === undefined) {
        delete process.env.INTENT_CLARIFICATION_KEY;
      } else {
        process.env.INTENT_CLARIFICATION_KEY = previousKey;
      }
    }
  });

  it("lets an agent ask an in-run clarification with selectable options and resume from the answer", async () => {
    const handle = createRuntimeMethodHandler(createTempStore());
    const previousFetch = globalThis.fetch;
    const previousKey = process.env.DYNAMIC_CLARIFICATION_KEY;
    process.env.DYNAMIC_CLARIFICATION_KEY = "test";
    let providerCalls = 0;
    let clarificationToolIssued = false;
    const providerBodies: string[] = [];

    globalThis.fetch = (async (_input, init) => {
      providerCalls += 1;
      const body = String(init?.body ?? "");
      providerBodies.push(body);
      if (!clarificationToolIssued && body.includes("user__clarify")) {
        clarificationToolIssued = true;
        return new Response(JSON.stringify({
          choices: [{
            message: {
              content: null,
              tool_calls: [{
                id: "call-clarify-1",
                type: "function",
                function: {
                  name: "user__clarify",
                  arguments: JSON.stringify({
                    key: "target_environment",
                    question: "你希望我在哪个环境执行这一步？",
                    options: [
                      { id: "staging", label: "预发环境", value: "staging", description: "先在预发环境验证" },
                      { id: "production", label: "生产环境", value: "production" },
                    ],
                  }),
                },
              }],
            },
            finish_reason: "tool_calls",
          }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({
        choices: [{ message: { content: "已根据你选择的 staging 环境继续执行。" } }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    try {
      const run = await handle({
        jsonrpc: "2.0",
        id: 1,
        method: "runs.start",
        params: {
          input: { prompt: "继续部署前确认一下目标环境。" },
          config: {
            modeId: SINGLE_AGENT_MODE_ID,
            providerId: "dynamic-clarification",
            modelRef: "dynamic-clarification-model",
            providerConfig: {
              id: "dynamic-clarification",
              label: "Dynamic Clarification",
              type: "openai_compatible",
              modelId: "dynamic-clarification-model",
              baseUrl: "https://dynamic-clarification.test/v1",
              apiKeyEnv: "DYNAMIC_CLARIFICATION_KEY",
              capabilities: ["chat", "tool_use"],
              headers: {},
            },
            toolIds: ["user.clarify"],
            metadata: { progressNarration: true },
          },
        },
      }) as { runId: string; status: string };
      const blocked = StateSnapshotSchema.parse(await handle({
        jsonrpc: "2.0",
        id: 2,
        method: "runs.state",
        params: { runId: run.runId },
      }));

      expect(run.status).toBe("interrupted");
      expect(blocked.pendingClarifications).toHaveLength(1);
      expect(blocked.pendingClarifications[0]).toMatchObject({
        key: "target_environment",
        question: "你希望我在哪个环境执行这一步？",
        options: [
          { id: "staging", label: "预发环境", value: "staging", description: "先在预发环境验证" },
          { id: "production", label: "生产环境", value: "production" },
        ],
      });
      expect(blocked.events.some((event) => event.type === "clarification.required")).toBe(true);
      expect(blocked.toolCalls.find((call) => call.toolId === "user.clarify")).toMatchObject({ status: "succeeded" });

      const resumed = StateSnapshotSchema.parse(await handle({
        jsonrpc: "2.0",
        id: 3,
        method: "runs.resume",
        params: {
          runId: run.runId,
          patch: { clarifications: { target_environment: "staging" } },
        },
      }));

      expect(resumed.status).toBe("succeeded");
      expect(resumed.pendingClarifications).toEqual([]);
      expect(resumed.events.map((event) => event.type)).toContain("clarification.resolved");
      expect(providerBodies.some((body) => body.includes("User-supplied clarification context"))).toBe(true);
      expect(providerBodies.some((body) => body.includes("target_environment") && body.includes("staging"))).toBe(true);
      expect(resumed.output?.text).toContain("staging 环境");
    } finally {
      globalThis.fetch = previousFetch;
      if (previousKey === undefined) {
        delete process.env.DYNAMIC_CLARIFICATION_KEY;
      } else {
        process.env.DYNAMIC_CLARIFICATION_KEY = previousKey;
      }
    }
  });

  it("lets an agent ask multiple in-run clarifications and resume with all answers", async () => {
    const handle = createRuntimeMethodHandler(createTempStore());
    const previousFetch = globalThis.fetch;
    const previousKey = process.env.DYNAMIC_CLARIFICATION_KEY;
    process.env.DYNAMIC_CLARIFICATION_KEY = "test";
    let clarificationToolIssued = false;
    const providerBodies: string[] = [];

    globalThis.fetch = (async (_input, init) => {
      const body = String(init?.body ?? "");
      providerBodies.push(body);
      if (!clarificationToolIssued && body.includes("user__clarify")) {
        clarificationToolIssued = true;
        return new Response(JSON.stringify({
          choices: [{
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
                      question: "你希望我在哪个环境执行这一步？",
                      options: [
                        { id: "staging", label: "预发环境", value: "staging" },
                        { id: "production", label: "生产环境", value: "production" },
                      ],
                    }),
                  },
                },
                {
                  id: "call-clarify-window",
                  type: "function",
                  function: {
                    name: "user__clarify",
                    arguments: JSON.stringify({
                      key: "time_window",
                      question: "计划覆盖哪个时间范围？",
                      options: [
                        { id: "30d", label: "最近 30 天", value: "last_30_days" },
                        { id: "90d", label: "最近 90 天", value: "last_90_days" },
                      ],
                    }),
                  },
                },
              ],
            },
            finish_reason: "tool_calls",
          }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({
        choices: [{ message: { content: "已根据 staging 环境和最近 30 天继续制定计划。" } }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    try {
      const run = await handle({
        jsonrpc: "2.0",
        id: 1,
        method: "runs.start",
        params: {
          input: { prompt: "继续计划前请一次性确认缺失条件。" },
          config: {
            modeId: SINGLE_AGENT_MODE_ID,
            providerId: "dynamic-clarification",
            modelRef: "dynamic-clarification-model",
            providerConfig: {
              id: "dynamic-clarification",
              label: "Dynamic Clarification",
              type: "openai_compatible",
              modelId: "dynamic-clarification-model",
              baseUrl: "https://dynamic-clarification.test/v1",
              apiKeyEnv: "DYNAMIC_CLARIFICATION_KEY",
              capabilities: ["chat", "tool_use"],
              headers: {},
            },
            toolIds: ["user.clarify"],
            metadata: { progressNarration: true },
          },
        },
      }) as { runId: string; status: string };
      const blocked = StateSnapshotSchema.parse(await handle({
        jsonrpc: "2.0",
        id: 2,
        method: "runs.state",
        params: { runId: run.runId },
      }));

      expect(run.status).toBe("interrupted");
      expect(blocked.pendingClarifications).toHaveLength(2);
      expect(blocked.pendingClarifications.map((c) => c.key)).toEqual([
        "target_environment",
        "time_window",
      ]);
      expect(blocked.events.filter((event) => event.type === "clarification.required")).toHaveLength(2);

      const resumed = StateSnapshotSchema.parse(await handle({
        jsonrpc: "2.0",
        id: 3,
        method: "runs.resume",
        params: {
          runId: run.runId,
          patch: {
            clarifications: {
              target_environment: "staging",
              time_window: "last_30_days",
            },
          },
        },
      }));

      expect(resumed.status).toBe("succeeded");
      expect(resumed.pendingClarifications).toEqual([]);
      expect(resumed.events.filter((event) => event.type === "clarification.resolved")).toHaveLength(2);
      expect(providerBodies.some((body) => body.includes("target_environment") && body.includes("staging"))).toBe(true);
      expect(providerBodies.some((body) => body.includes("time_window") && body.includes("last_30_days"))).toBe(true);
      expect(resumed.output?.text).toContain("staging 环境");
    } finally {
      globalThis.fetch = previousFetch;
      if (previousKey === undefined) {
        delete process.env.DYNAMIC_CLARIFICATION_KEY;
      } else {
        process.env.DYNAMIC_CLARIFICATION_KEY = previousKey;
      }
    }
  });

  it("does not interrupt ordinary style ambiguity", async () => {
    const modeSpec = getModePreset(SINGLE_AGENT_MODE_ID)!;
    const definition = modeSpecToPatternDefinition(modeSpec);

    const { snapshot } = await executeRuntimeKernel(
      "run-style-ambiguity",
      { prompt: "把这段回答写得更正式一点。", createdAt: 1, context: {} },
      {
        pattern: "orchestrator_subagent",
        modeId: SINGLE_AGENT_MODE_ID,
        providerId: "local-smoke",
        modelRef: "smoke-model",
        providerConfig: {
          id: "local-smoke",
          type: "local_smoke",
          label: "Smoke",
          modelId: "smoke-model",
          capabilities: ["chat"],
          headers: {},
        },
        metadata: {},
        deterministicSeed: "style-ambiguity-test",
        profileIds: ["solo_agent"],
        skillIds: [],
        toolIds: [],
        approvalMode: "auto",
        budget: {
          maxTokens: 1024,
          maxToolCalls: 4,
          maxRuntimeMs: 60_000,
        },
      },
      { modeSpec, definition },
    );

    expect(snapshot.status).toBe("succeeded");
    expect(snapshot.pendingClarifications).toEqual([]);
    expect(snapshot.events.map((event) => event.type)).not.toContain("clarification.required");
  });

  it("emits opt-in agent-authored chat progress narration", async () => {
    const modeSpec = getModePreset(SINGLE_AGENT_MODE_ID)!;
    const definition = modeSpecToPatternDefinition(modeSpec);
    const { snapshot } = await executeRuntimeKernel(
      "run-progress-narration",
      { prompt: "Summarize the current project state.", createdAt: 1, context: {} },
      {
        pattern: "orchestrator_subagent",
        modeId: SINGLE_AGENT_MODE_ID,
        providerId: "local-smoke",
        modelRef: "smoke-model",
        providerConfig: {
          id: "local-smoke",
          type: "local_smoke",
          label: "Smoke",
          modelId: "smoke-model",
          capabilities: ["chat"],
          headers: {},
        },
        metadata: { progressNarration: true },
        deterministicSeed: "progress-narration-test",
        profileIds: ["solo_agent"],
        skillIds: [],
        toolIds: [],
        approvalMode: "auto",
        budget: {
          maxTokens: 1024,
          maxToolCalls: 4,
          maxRuntimeMs: 60_000,
        },
      },
      { modeSpec, definition },
    );

    const progressEvents = snapshot.events.filter((event) =>
      event.type === "task.progress" &&
      typeof event.payload === "object" &&
      event.payload !== null &&
      (event.payload as Record<string, unknown>).kind === "chat_progress" &&
      (event.payload as Record<string, unknown>).source === "progress_narrator"
    );

    expect(progressEvents.length).toBeGreaterThan(0);
    for (const event of progressEvents) {
      const payload = event.payload as Record<string, unknown>;
      expect(payload.source).toBe("progress_narrator");
      expect(typeof payload.summary).toBe("string");
      expect((payload.summary as string).trim().length).toBeGreaterThan(0);
      expect(payload.basedOnSeq).toBeLessThan(event.seq);
    }
  });

  it("filters internal stage text out of progress narrator payloads", () => {
    expect(summarizeNarratorProgressPayload("task.progress", {
      title: "Route events to subscribers",
      detail: "Router routes events to the subscribers that should handle the next piece of work.",
      phase: "running",
    })).toEqual({ phase: "running" });
    expect(summarizeNarratorProgressPayload("tool.called", {
      toolId: "web.search",
      status: "succeeded",
      input: { query: "西芒杜项目 2026年 最新进展" },
      output: { query: "西芒杜项目 2026年 最新进展", results: [{ title: "result" }] },
    })).toEqual({
      toolId: "web.search",
      status: "succeeded",
      query: "西芒杜项目 2026年 最新进展",
    });
  });

  it("asks progress narration to follow the user's language", async () => {
    const modeSpec = getModePreset(SINGLE_AGENT_MODE_ID)!;
    const definition = modeSpecToPatternDefinition(modeSpec);
    const previousFetch = globalThis.fetch;
    const previousKey = process.env.PROGRESS_LANGUAGE_KEY;
    process.env.PROGRESS_LANGUAGE_KEY = "test";
    const providerBodies: string[] = [];
    globalThis.fetch = (async (_input, init) => {
      const body = String(init?.body ?? "");
      providerBodies.push(body);
      const content = body.includes("Match the user's language")
        ? "已经读取到用户要安装技能的请求，正在确认下一步需要执行的安装动作。"
        : "最终答复。";
      return new Response(JSON.stringify({
        choices: [{ message: { content } }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    try {
      const { snapshot } = await executeRuntimeKernel(
        "run-progress-language",
        { prompt: "请帮我安装 Waza 的几个 skills。", createdAt: 1, context: {} },
        {
          pattern: "orchestrator_subagent",
          modeId: SINGLE_AGENT_MODE_ID,
          providerId: "progress-language",
          modelRef: "progress-language-model",
          providerConfig: {
            id: "progress-language",
            type: "openai_compatible",
            label: "Progress Language",
            modelId: "progress-language-model",
            baseUrl: "https://progress-language.test/v1",
            apiKeyEnv: "PROGRESS_LANGUAGE_KEY",
            capabilities: ["chat"],
            headers: {},
          },
          metadata: { progressNarration: true },
          deterministicSeed: "progress-language-test",
          profileIds: ["solo_agent"],
          skillIds: [],
          toolIds: [],
          approvalMode: "auto",
          budget: {
            maxTokens: 1024,
            maxToolCalls: 4,
            maxRuntimeMs: 60_000,
          },
        },
        { modeSpec, definition },
      );

      const progressSummaries = snapshot.events
        .filter((event) =>
          event.type === "task.progress" &&
          typeof event.payload === "object" &&
          event.payload !== null &&
          (event.payload as Record<string, unknown>).kind === "chat_progress"
        )
        .map((event) => (event.payload as Record<string, unknown>).summary);

      expect(providerBodies.some((body) => body.includes("Match the user's language"))).toBe(true);
      expect(providerBodies.some((body) => body.includes("languageInstruction"))).toBe(true);
      const progressBodies = providerBodies.filter((body) => body.includes("Match the user's language"));
      expect(progressBodies.some((body) => body.includes("\"modeId\""))).toBe(false);
      expect(progressBodies.some((body) => body.includes("\"pattern\""))).toBe(false);
      expect(progressSummaries).toContain("已经读取到用户要安装技能的请求，正在确认下一步需要执行的安装动作。");
    } finally {
      globalThis.fetch = previousFetch;
      if (previousKey === undefined) {
        delete process.env.PROGRESS_LANGUAGE_KEY;
      } else {
        process.env.PROGRESS_LANGUAGE_KEY = previousKey;
      }
    }
  });

  it("asks agent responses to follow the user's language outside progress narration", async () => {
    const modeSpec = getModePreset(SINGLE_AGENT_MODE_ID)!;
    const definition = modeSpecToPatternDefinition(modeSpec);
    const previousFetch = globalThis.fetch;
    const previousKey = process.env.AGENT_LANGUAGE_KEY;
    process.env.AGENT_LANGUAGE_KEY = "test";
    const providerBodies: string[] = [];
    globalThis.fetch = (async (_input, init) => {
      providerBodies.push(String(init?.body ?? ""));
      return new Response(JSON.stringify({
        choices: [{ message: { content: "我会用中文回答正文。" } }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    try {
      await executeRuntimeKernel(
        "run-agent-language",
        { prompt: "请检查这个项目的测试情况。", createdAt: 1, context: {} },
        {
          pattern: "orchestrator_subagent",
          modeId: SINGLE_AGENT_MODE_ID,
          providerId: "agent-language",
          modelRef: "agent-language-model",
          providerConfig: {
            id: "agent-language",
            type: "openai_compatible",
            label: "Agent Language",
            modelId: "agent-language-model",
            baseUrl: "https://agent-language.test/v1",
            apiKeyEnv: "AGENT_LANGUAGE_KEY",
            capabilities: ["chat"],
            headers: {},
          },
          metadata: {},
          deterministicSeed: "agent-language-test",
          profileIds: ["solo_agent"],
          skillIds: [],
          toolIds: [],
          approvalMode: "auto",
          budget: {
            maxTokens: 1024,
            maxToolCalls: 4,
            maxRuntimeMs: 60_000,
          },
        },
        { modeSpec, definition },
      );

      expect(providerBodies.some((body) =>
        body.includes("User-facing output follows current user message language")
      )).toBe(true);
      expect(providerBodies.some((body) =>
        body.includes("Match the user's language")
      )).toBe(false);
    } finally {
      globalThis.fetch = previousFetch;
      if (previousKey === undefined) {
        delete process.env.AGENT_LANGUAGE_KEY;
      } else {
        process.env.AGENT_LANGUAGE_KEY = previousKey;
      }
    }
  });

  it("asks Ora finalization to follow the user's language after multi-agent mode output", async () => {
    const modeSpec = getModePreset(DEBATE_MODE_ID)!;
    const definition = modeSpecToPatternDefinition(modeSpec);
    const previousFetch = globalThis.fetch;
    const previousKey = process.env.FINALIZER_LANGUAGE_KEY;
    process.env.FINALIZER_LANGUAGE_KEY = "test";
    const providerBodies: string[] = [];
    globalThis.fetch = (async (_input, init) => {
      providerBodies.push(String(init?.body ?? ""));
      return new Response(JSON.stringify({
        choices: [{ message: { content: "中文阶段输出。" } }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    try {
      await executeRuntimeKernel(
        "run-finalizer-language",
        { prompt: "请用辩论方式分析这个方案是否值得做。", createdAt: 1, context: {} },
        {
          pattern: "orchestrator_subagent",
          modeId: DEBATE_MODE_ID,
          providerId: "finalizer-language",
          modelRef: "finalizer-language-model",
          providerConfig: {
            id: "finalizer-language",
            type: "openai_compatible",
            label: "Finalizer Language",
            modelId: "finalizer-language-model",
            baseUrl: "https://finalizer-language.test/v1",
            apiKeyEnv: "FINALIZER_LANGUAGE_KEY",
            capabilities: ["chat"],
            headers: {},
          },
          metadata: {},
          deterministicSeed: "finalizer-language-test",
          profileIds: modeSpec.profiles.map((profile) => profile.id),
          skillIds: [],
          toolIds: [],
          approvalMode: "auto",
          budget: {
            maxTokens: 1024,
            maxToolCalls: 4,
            maxRuntimeMs: 60_000,
          },
        },
        { modeSpec, definition },
      );

      const finalizerBodies = providerBodies.filter((body) =>
        body.includes("The selected mode has returned its work product")
      );
      expect(finalizerBodies.length).toBeGreaterThan(0);
      expect(finalizerBodies.some((body) =>
        body.includes("User-facing output follows current user message language")
      )).toBe(true);
    } finally {
      globalThis.fetch = previousFetch;
      if (previousKey === undefined) {
        delete process.env.FINALIZER_LANGUAGE_KEY;
      } else {
        process.env.FINALIZER_LANGUAGE_KEY = previousKey;
      }
    }
  });

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
    expectEventSeqSemantics(state);
    expect(state.checkpoints).toHaveLength(1);
    expect(state.topology.nodes.length).toBeGreaterThan(1);
    expect(state.profiles.map((profile) => profile.id)).toEqual([ORA_ROOT_AGENT_ID, "generator", "verifier"]);
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
    expect(state.topology.nodes.some((node) => node.status === "running")).toBe(false);
    expect(state.events.map((event) => event.type)).toContain("todo.updated");
    expect(state.topology.nodes.some((node) => node.kind === "capability" && node.metadata.atomId === "memory_capture")).toBe(true);
    expect(state.topology.nodes.some((node) => node.kind === "capability" && node.metadata.atomId === "tool_error_boundary")).toBe(true);
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

  it("adds default web tools to cloned modes and effective runtime configs", async () => {
    const handle = createRuntimeMethodHandler(createTempStore());
    const cloned = await handle({
      jsonrpc: "2.0",
      id: 1,
      method: "modes.cloneFromPreset",
      params: {
        sourceModeId: "single_agent",
        modeId: "single-agent-web-defaults",
        label: "Single Agent Web Defaults",
      },
    }) as any;

    for (const toolId of DEFAULT_WEB_TOOL_IDS) {
      expect(cloned.capabilityFlags.toolIds).toContain(toolId);
    }
    for (const toolId of DEFAULT_SKILL_TOOL_IDS) {
      expect(cloned.capabilityFlags.toolIds).toContain(toolId);
    }

    const run = await handle({
      jsonrpc: "2.0",
      id: 2,
      method: "runs.start",
      params: {
        input: { prompt: "Keep web tools even when config passes custom tools." },
        config: { modeId: cloned.id, toolIds: ["shell.execute", "web.search"] },
      },
    }) as { runId: string };

    const state = StateSnapshotSchema.parse(
      await handle({
        jsonrpc: "2.0",
        id: 3,
        method: "runs.state",
        params: { runId: run.runId },
      }),
    );

    expect(state.config.toolIds).toEqual(expect.arrayContaining(["shell.execute", ...DEFAULT_WEB_TOOL_IDS, ...DEFAULT_SKILL_TOOL_IDS]));
    expect(state.config.toolIds.filter((toolId) => toolId === "web.search")).toHaveLength(1);

    const optOutRun = await handle({
      jsonrpc: "2.0",
      id: 4,
      method: "runs.start",
      params: {
        input: { prompt: "Respect explicit network policy opt-out." },
        config: {
          modeId: cloned.id,
          toolIds: ["shell.execute"],
          metadata: { disableDefaultWebTools: true },
        },
      },
    }) as { runId: string };
    const optOutState = StateSnapshotSchema.parse(
      await handle({
        jsonrpc: "2.0",
        id: 5,
        method: "runs.state",
        params: { runId: optOutRun.runId },
      }),
    );

    expect(optOutState.config.toolIds).toEqual(["shell.execute", ...DEFAULT_SKILL_TOOL_IDS]);
  });

  it("executes web.search for a provider without native browsing", async () => {
    const handle = createRuntimeMethodHandler(createTempStore());
    const previousFetch = globalThis.fetch;
    const previousProviderKey = process.env.MOCK_CHAT_KEY;
    const previousSearchKey = process.env.MOCK_BRAVE_KEY;
    process.env.MOCK_CHAT_KEY = "provider-key";
    process.env.MOCK_BRAVE_KEY = "search-key";
    let providerCalls = 0;
    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      if (url.includes("api.search.brave.com")) {
        return new Response(JSON.stringify({
          web: {
            results: [
              { title: "Example Result", url: "https://example.com/result", description: "Search result snippet" },
            ],
          },
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.includes("mock-chat.test")) {
        const body = String(init?.body ?? "");
        providerCalls += 1;
        const content = providerCalls === 1 && !body.includes("Workspace tool result")
          ? "{\"tool\":\"web.search\",\"args\":{\"query\":\"Ora web search\",\"limit\":1}}"
          : "Search answer from Example Result";
        return new Response(JSON.stringify({
          choices: [{ message: { content } }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      throw new Error(`Unexpected fetch ${url}`);
    }) as typeof fetch;

    try {
      const run = await handle({
        jsonrpc: "2.0",
        id: 1,
        method: "runs.start",
        params: {
          input: { prompt: "Search for Ora web search." },
          config: {
            modeId: "single_agent",
            providerId: "mock-chat",
            modelRef: "mock-chat-model",
            providerConfig: {
              id: "mock-chat",
              label: "Mock Chat",
              type: "openai_compatible",
              modelId: "mock-chat-model",
              baseUrl: "https://mock-chat.test/v1",
              apiKeyEnv: "MOCK_CHAT_KEY",
              capabilities: ["chat"],
              headers: {},
            },
            searchProvider: {
              id: "brave",
              apiKeyEnv: "MOCK_BRAVE_KEY",
            },
          },
        },
      }) as { runId: string };

      const state = StateSnapshotSchema.parse(
        await handle({
          jsonrpc: "2.0",
          id: 2,
          method: "runs.state",
          params: { runId: run.runId },
        }),
      );
      const searchEvent = state.events.find((event) =>
        event.type === "tool.called"
        && typeof event.payload === "object"
        && event.payload !== null
        && (event.payload as Record<string, unknown>).toolId === "web.search"
      );

      expect(searchEvent?.payload).toMatchObject({
        status: "succeeded",
        output: {
          providerId: "brave",
          results: [expect.objectContaining({ title: "Example Result", url: "https://example.com/result" })],
        },
      });
      expect(state.toolCalls).toEqual([
        expect.objectContaining({
          toolId: "web.search",
          source: "json_fallback",
          status: "succeeded",
          result: expect.objectContaining({ status: "succeeded" }),
        }),
      ]);
      expect(state.output).toMatchObject({ text: expect.stringContaining("Search answer from Example Result") });
    } finally {
      globalThis.fetch = previousFetch;
      if (previousProviderKey === undefined) {
        delete process.env.MOCK_CHAT_KEY;
      } else {
        process.env.MOCK_CHAT_KEY = previousProviderKey;
      }
      if (previousSearchKey === undefined) {
        delete process.env.MOCK_BRAVE_KEY;
      } else {
        process.env.MOCK_BRAVE_KEY = previousSearchKey;
      }
    }
  });

  it("runs single_agent as one direct runtime loop for simple answers", async () => {
    const handle = createRuntimeMethodHandler(createTempStore());
    const previousFetch = globalThis.fetch;
    const previousKey = process.env.SINGLE_DIRECT_KEY;
    process.env.SINGLE_DIRECT_KEY = "test";
    let providerCalls = 0;
    globalThis.fetch = (async (input) => {
      const url = String(input);
      if (url.includes("single-direct.test")) {
        providerCalls += 1;
        return new Response(JSON.stringify({
          choices: [{ message: { content: "Direct final answer." } }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      throw new Error(`Unexpected fetch ${url}`);
    }) as typeof fetch;

    try {
      const run = await handle({
        jsonrpc: "2.0",
        id: 1,
        method: "runs.start",
        params: {
          input: { prompt: "Answer this directly." },
          config: {
            modeId: "single_agent",
            providerId: "single-direct",
            modelRef: "single-direct-model",
            providerConfig: {
              id: "single-direct",
              label: "Single Direct",
              type: "openai_compatible",
              modelId: "single-direct-model",
              baseUrl: "https://single-direct.test/v1",
              apiKeyEnv: "SINGLE_DIRECT_KEY",
              capabilities: ["chat"],
              headers: {},
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

      expect(run.status).toBe("succeeded");
      expect(providerCalls).toBe(2);
      expect(state.plan.map((item) => item.id.split(":").at(-1))).toEqual(["respond"]);
      expect(state.events.filter((event) => event.type === "agent.started")).toHaveLength(1);
      expect(state.events.some((event) =>
        event.type === "node.updated"
        && typeof event.payload === "object"
        && event.payload !== null
        && (event.payload as Record<string, unknown>).state === "completed"
      )).toBe(true);
      expect(state.output).toMatchObject({
        text: "Direct final answer.",
        modeId: "single_agent",
      });
    } finally {
      globalThis.fetch = previousFetch;
      if (previousKey === undefined) {
        delete process.env.SINGLE_DIRECT_KEY;
      } else {
        process.env.SINGLE_DIRECT_KEY = previousKey;
      }
    }
  });

  it("executes OpenAI-compatible native tool calls and returns matching tool results", async () => {
    const handle = createRuntimeMethodHandler(createTempStore());
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ora-native-tool-"));
    fs.writeFileSync(path.join(workspaceRoot, "README.md"), "Native tool result\n", "utf8");
    const previousFetch = globalThis.fetch;
    const previousKey = process.env.NATIVE_TOOL_KEY;
    process.env.NATIVE_TOOL_KEY = "test";
    let providerCalls = 0;
    globalThis.fetch = (async (_input, init) => {
      providerCalls += 1;
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        tools?: unknown[];
        messages?: Array<{ role: string; tool_call_id?: string; content?: string }>;
      };
      expect(body.tools?.length).toBeGreaterThan(0);
      if (providerCalls === 1) {
        return new Response(JSON.stringify({
          choices: [{
            finish_reason: "tool_calls",
            message: {
              content: null,
              tool_calls: [
                {
                  id: "call-readme",
                  type: "function",
                  function: {
                    name: "file__read",
                    arguments: "{\"path\":\"README.md\"}",
                  },
                },
                {
                  id: "call-list",
                  type: "function",
                  function: {
                    name: "file__list",
                    arguments: "{\"path\":\".\"}",
                  },
                },
              ],
            },
          }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (providerCalls === 2) {
        expect(JSON.stringify(body.messages ?? [])).not.toContain("call-list");
        expect(body.messages?.some((message) =>
          message.role === "tool"
          && message.tool_call_id === "call-readme"
          && String(message.content ?? "").includes("Native tool result")
        )).toBe(true);
      }
      return new Response(JSON.stringify({
        choices: [{ message: { content: "Read README through native tool." } }],
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
              projectWorkspace: { label: "Native Tool Workspace", rootPath: workspaceRoot },
            },
          },
          config: {
            modeId: "single_agent",
            providerId: "native-tool",
            modelRef: "native-tool-model",
            providerConfig: {
              id: "native-tool",
              label: "Native Tool",
              type: "openai_compatible",
              modelId: "native-tool-model",
              baseUrl: "https://native-tool.test/v1",
              apiKeyEnv: "NATIVE_TOOL_KEY",
              capabilities: ["chat", "tool_use"],
              headers: {},
            },
            toolIds: ["file.read", "file.list"],
          },
        },
      }) as { runId: string; status: string };

      const state = StateSnapshotSchema.parse(await handle({
        jsonrpc: "2.0",
        id: 2,
        method: "runs.state",
        params: { runId: run.runId },
      }));

      expect(run.status).toBe("succeeded");
      expect(providerCalls).toBeGreaterThanOrEqual(2);
      expect(state.toolCalls).toEqual([
        expect.objectContaining({
          providerCallId: "call-readme",
          toolId: "file.read",
          source: "provider_native",
          status: "succeeded",
        }),
      ]);
      expect(state.events.map((event) => event.type)).not.toContain("tool.repaired");
      expect(state.output).toMatchObject({ text: expect.stringContaining("Read README through native tool.") });
    } finally {
      globalThis.fetch = previousFetch;
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
      if (previousKey === undefined) {
        delete process.env.NATIVE_TOOL_KEY;
      } else {
        process.env.NATIVE_TOOL_KEY = previousKey;
      }
    }
  });

  it("lets the model answer normally after a useful web.fetch result in decisive mode", async () => {
    const handle = createRuntimeMethodHandler(createTempStore());
    const previousFetch = globalThis.fetch;
    const previousKey = process.env.REPEAT_FETCH_KEY;
    process.env.REPEAT_FETCH_KEY = "test";
    let providerCalls = 0;
    let webFetchCalls = 0;
    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      if (url === "https://example.com/repeat") {
        webFetchCalls += 1;
        return new Response("Repeatable content", { status: 200, headers: { "content-type": "text/plain" } });
      }

      providerCalls += 1;
      const body = JSON.parse(String(init?.body ?? "{}")) as { tool_choice?: string };
      if (body.tool_choice === "none") {
        return new Response(JSON.stringify({
          choices: [{ message: { content: "Used repeated fetch result once." } }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (providerCalls === 1) {
        return new Response(JSON.stringify({
          choices: [{
            finish_reason: "tool_calls",
            message: {
              content: null,
              tool_calls: [{
                id: `call-repeat-${providerCalls}`,
                type: "function",
                function: {
                  name: "web__fetch",
                  arguments: "{\"url\":\"https://example.com/repeat\"}",
                },
              }],
            },
          }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }

      return new Response(JSON.stringify({
        choices: [{ message: { content: "Used repeated fetch result once." } }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    try {
      const run = await handle({
        jsonrpc: "2.0",
        id: 1,
        method: "runs.start",
        params: {
          input: { prompt: "Fetch the same URL twice." },
          config: {
            modeId: "single_agent",
            providerId: "repeat-fetch",
            modelRef: "repeat-fetch-model",
            providerConfig: {
              id: "repeat-fetch",
              label: "Repeat Fetch",
              type: "openai_compatible",
              modelId: "repeat-fetch-model",
              baseUrl: "https://repeat-fetch.test/v1",
              apiKeyEnv: "REPEAT_FETCH_KEY",
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
      const fetchEvents = state.events.filter((event) =>
        event.type === "tool.called"
        && typeof event.payload === "object"
        && event.payload !== null
        && (event.payload as Record<string, unknown>).toolId === "web.fetch"
      );

      expect(run.status).toBe("succeeded");
      expect(webFetchCalls).toBe(1);
      expect(fetchEvents).toHaveLength(1);
      expect(fetchEvents[0]?.payload).toMatchObject({ cacheHit: false });
      expect(state.output).toMatchObject({ text: expect.stringContaining("Used repeated fetch result once.") });
      expect(state.output).toMatchObject({ metadata: { completion: expect.objectContaining({ forcedFinal: false, stopReason: "completed" }) } });
    } finally {
      globalThis.fetch = previousFetch;
      if (previousKey === undefined) {
        delete process.env.REPEAT_FETCH_KEY;
      } else {
        process.env.REPEAT_FETCH_KEY = previousKey;
      }
    }
  });

  it("lets the model answer normally after a useful web.search result in decisive mode", async () => {
    const handle = createRuntimeMethodHandler(createTempStore());
    const previousFetch = globalThis.fetch;
    const previousProviderKey = process.env.REPEAT_SEARCH_KEY;
    const previousSearchKey = process.env.REPEAT_SEARCH_BRAVE_KEY;
    process.env.REPEAT_SEARCH_KEY = "provider-key";
    process.env.REPEAT_SEARCH_BRAVE_KEY = "search-key";
    let providerCalls = 0;
    let webSearchCalls = 0;
    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      if (url.includes("api.search.brave.com")) {
        webSearchCalls += 1;
        return new Response(JSON.stringify({
          web: {
            results: [
              { title: "Repeated Search Result", url: "https://example.com/repeated", description: "Cached search snippet" },
            ],
          },
        }), { status: 200, headers: { "content-type": "application/json" } });
      }

      providerCalls += 1;
      const body = JSON.parse(String(init?.body ?? "{}")) as { tool_choice?: string };
      if (body.tool_choice === "none") {
        return new Response(JSON.stringify({
          choices: [{ message: { content: "Used repeated search result once." } }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (providerCalls === 1) {
        return new Response(JSON.stringify({
          choices: [{
            finish_reason: "tool_calls",
            message: {
              content: null,
              tool_calls: [{
                id: `call-search-${providerCalls}`,
                type: "function",
                function: {
                  name: "web__search",
                  arguments: "{\"query\":\"Ora repeated search\",\"limit\":1}",
                },
              }],
            },
          }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }

      return new Response(JSON.stringify({
        choices: [{ message: { content: "Used repeated search result once." } }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    try {
      const run = await handle({
        jsonrpc: "2.0",
        id: 1,
        method: "runs.start",
        params: {
          input: { prompt: "Search the same query twice." },
          config: {
            modeId: "single_agent",
            providerId: "repeat-search",
            modelRef: "repeat-search-model",
            providerConfig: {
              id: "repeat-search",
              label: "Repeat Search",
              type: "openai_compatible",
              modelId: "repeat-search-model",
              baseUrl: "https://repeat-search.test/v1",
              apiKeyEnv: "REPEAT_SEARCH_KEY",
              capabilities: ["chat", "tool_use"],
              headers: {},
            },
            searchProvider: {
              id: "brave",
              apiKeyEnv: "REPEAT_SEARCH_BRAVE_KEY",
            },
            toolIds: ["web.search"],
          },
        },
      }) as { runId: string; status: string };

      const state = StateSnapshotSchema.parse(await handle({
        jsonrpc: "2.0",
        id: 2,
        method: "runs.state",
        params: { runId: run.runId },
      }));
      const searchEvents = state.events.filter((event) =>
        event.type === "tool.called"
        && typeof event.payload === "object"
        && event.payload !== null
        && (event.payload as Record<string, unknown>).toolId === "web.search"
      );

      expect(run.status).toBe("succeeded");
      expect(webSearchCalls).toBe(1);
      expect(searchEvents).toHaveLength(1);
      expect(searchEvents[0]?.payload).toMatchObject({ cacheHit: false });
      expect(state.output).toMatchObject({ text: expect.stringContaining("Used repeated search result once.") });
      expect(state.output).toMatchObject({ metadata: { completion: expect.objectContaining({ forcedFinal: false, stopReason: "completed" }) } });
    } finally {
      globalThis.fetch = previousFetch;
      if (previousProviderKey === undefined) {
        delete process.env.REPEAT_SEARCH_KEY;
      } else {
        process.env.REPEAT_SEARCH_KEY = previousProviderKey;
      }
      if (previousSearchKey === undefined) {
        delete process.env.REPEAT_SEARCH_BRAVE_KEY;
      } else {
        process.env.REPEAT_SEARCH_BRAVE_KEY = previousSearchKey;
      }
    }
  });

  it("recovers when forced final output is still a JSON fallback tool call", async () => {
    const handle = createRuntimeMethodHandler(createTempStore());
    const previousFetch = globalThis.fetch;
    const previousKey = process.env.FINAL_TOOL_INTENT_KEY;
    process.env.FINAL_TOOL_INTENT_KEY = "test";
    let finalNoToolCalls = 0;
    let webFetchCalls = 0;
    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      if (url === "https://example.com/first") {
        webFetchCalls += 1;
        return new Response("First result", { status: 200, headers: { "content-type": "text/plain" } });
      }

      const body = JSON.parse(String(init?.body ?? "{}")) as { tool_choice?: string };
      if (body.tool_choice === "none") {
        finalNoToolCalls += 1;
        if (finalNoToolCalls > 1) {
          return new Response(JSON.stringify({
            choices: [{ message: { content: "Use the fetched first result and stop without another fetch." } }],
          }), { status: 200, headers: { "content-type": "application/json" } });
        }
        return new Response(JSON.stringify({
          choices: [{ message: { content: "{\"tool\":\"web.fetch\",\"args\":{\"url\":\"https://example.com/second\"}}" } }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }

      return new Response(JSON.stringify({
        choices: [{
          finish_reason: "tool_calls",
          message: {
            content: null,
            tool_calls: [{
              id: "call-first",
              type: "function",
              function: {
                name: "web__fetch",
                arguments: "{\"url\":\"https://example.com/first\"}",
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
          input: { prompt: "Fetch both URLs before answering." },
          config: {
            modeId: "single_agent",
            providerId: "final-tool-intent",
            modelRef: "final-tool-intent-model",
            providerConfig: {
              id: "final-tool-intent",
              label: "Final Tool Intent",
              type: "openai_compatible",
              modelId: "final-tool-intent-model",
              baseUrl: "https://final-tool-intent.test/v1",
              apiKeyEnv: "FINAL_TOOL_INTENT_KEY",
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
              preset: "decisive",
              maxRepeatedToolCalls: 1,
              forceFinalOnBudgetExhausted: true,
              forceFinalOnRepeatedTool: true,
              allowToolCallsAfterUsefulResult: false,
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

      expect(run.status).toBe("succeeded");
      expect(state.status).toBe("succeeded");
      expect(webFetchCalls).toBe(1);
      expect(finalNoToolCalls).toBeGreaterThanOrEqual(2);
      expect(state.error).toBeUndefined();
      expect(state.output).not.toMatchObject({ text: expect.stringContaining("\"tool\":\"web.fetch\"") });
      expect(state.output).toMatchObject({
        text: expect.stringContaining("Use the fetched first result"),
        metadata: { completion: expect.objectContaining({ forcedFinal: true, stopReason: "tool_budget_exhausted" }) },
      });
      expect(state.events.some((event) => event.type === "recovery.exhausted")).toBe(false);
      expect(state.events.some((event) =>
        event.type === "completion.updated"
        && typeof event.payload === "object"
        && event.payload !== null
        && (event.payload as Record<string, unknown>).state === "tool_call_text_rejected"
      )).toBe(true);
      expect(state.events.some((event) =>
        event.type === "completion.updated"
        && typeof event.payload === "object"
        && event.payload !== null
        && (event.payload as Record<string, unknown>).reason === "repeated_tool_blocked"
      )).toBe(false);
    } finally {
      globalThis.fetch = previousFetch;
      if (previousKey === undefined) {
        delete process.env.FINAL_TOOL_INTENT_KEY;
      } else {
        process.env.FINAL_TOOL_INTENT_KEY = previousKey;
      }
    }
  });

  it("repairs forced final DSML tool-call text instead of rendering it as the answer", async () => {
    const handle = createRuntimeMethodHandler(createTempStore());
    const previousFetch = globalThis.fetch;
    const previousKey = process.env.FINAL_DSML_TOOL_INTENT_KEY;
    process.env.FINAL_DSML_TOOL_INTENT_KEY = "test";
    let finalNoToolCalls = 0;
    let firstFetchCalls = 0;
    let rejectedFetchCalls = 0;
    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      if (url === "https://github.com/tw93/Waza") {
        firstFetchCalls += 1;
        return new Response("Waza repository landing page", { status: 200, headers: { "content-type": "text/plain" } });
      }
      if (url === "https://raw.githubusercontent.com/tw93/Waza/main/README.md") {
        rejectedFetchCalls += 1;
        return new Response("README that should not be fetched after finalization", { status: 200, headers: { "content-type": "text/plain" } });
      }

      const body = JSON.parse(String(init?.body ?? "{}")) as { tool_choice?: string };
      if (body.tool_choice === "none") {
        finalNoToolCalls += 1;
        if (finalNoToolCalls > 1) {
          return new Response(JSON.stringify({
            choices: [{ message: { content: "Waza fetched successfully; use the repository result to install the skills." } }],
          }), { status: 200, headers: { "content-type": "application/json" } });
        }
        return new Response(JSON.stringify({
          choices: [{
            message: {
              content: "<|DSML| parameter name=\"url\" string=\"true\">https://raw.githubusercontent.com/tw93/Waza/main/README.md</|DSML| parameter>",
            },
          }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }

      return new Response(JSON.stringify({
        choices: [{
          finish_reason: "tool_calls",
          message: {
            content: null,
            tool_calls: [{
              id: "call-waza",
              type: "function",
              function: {
                name: "web__fetch",
                arguments: "{\"url\":\"https://github.com/tw93/Waza\"}",
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
          input: { prompt: "https://github.com/tw93/Waza install the skills." },
          config: {
            modeId: "single_agent",
            providerId: "final-dsml-tool-intent",
            modelRef: "final-dsml-tool-intent-model",
            providerConfig: {
              id: "final-dsml-tool-intent",
              label: "Final DSML Tool Intent",
              type: "openai_compatible",
              modelId: "final-dsml-tool-intent-model",
              baseUrl: "https://final-dsml-tool-intent.test/v1",
              apiKeyEnv: "FINAL_DSML_TOOL_INTENT_KEY",
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
              preset: "decisive",
              maxRepeatedToolCalls: 1,
              forceFinalOnBudgetExhausted: true,
              forceFinalOnRepeatedTool: true,
              allowToolCallsAfterUsefulResult: false,
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

      expect(run.status).toBe("succeeded");
      expect(firstFetchCalls).toBe(1);
      expect(rejectedFetchCalls).toBe(0);
      expect(finalNoToolCalls).toBeGreaterThanOrEqual(2);
      expect(state.output?.text).toContain("Waza fetched successfully");
      expect(state.output?.text).not.toContain("DSML");
      expect(state.output?.text).not.toContain("raw.githubusercontent.com");
      expect(state.events.some((event) =>
        event.type === "completion.updated"
        && typeof event.payload === "object"
        && event.payload !== null
        && (event.payload as Record<string, unknown>).state === "tool_call_text_rejected"
        && (event.payload as Record<string, unknown>).toolId === "web.fetch"
      )).toBe(true);
    } finally {
      globalThis.fetch = previousFetch;
      if (previousKey === undefined) {
        delete process.env.FINAL_DSML_TOOL_INTENT_KEY;
      } else {
        process.env.FINAL_DSML_TOOL_INTENT_KEY = previousKey;
      }
    }
  });

  it("continues after useful tool results and installs a fetched skill", async () => {
    const handle = createRuntimeMethodHandler(createTempStore());
    const previousFetch = globalThis.fetch;
    const previousKey = process.env.SKILL_INSTALL_FLOW_KEY;
    process.env.SKILL_INSTALL_FLOW_KEY = "test";
    const skillContent = "---\nname: waza-think\ndescription: Think workflow from Waza\n---\nUse this skill to think through a task before acting.\n";
    const fetchedUrls: string[] = [];
    let providerCalls = 0;
    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      if (url === "https://github.com/tw93/Waza" || url === "https://raw.githubusercontent.com/tw93/Waza/main/skills/think/SKILL.md") {
        fetchedUrls.push(url);
        return new Response(
          url.includes("raw.githubusercontent.com") ? skillContent : "Waza repository with skills/think/SKILL.md",
          { status: 200, headers: { "content-type": "text/plain" } },
        );
      }

      providerCalls += 1;
      const toolCall = (name: string, args: Record<string, unknown>) => new Response(JSON.stringify({
        choices: [{
          finish_reason: "tool_calls",
          message: {
            content: null,
            tool_calls: [{
              id: `call-install-${providerCalls}`,
              type: "function",
              function: {
                name,
                arguments: JSON.stringify(args),
              },
            }],
          },
        }],
      }), { status: 200, headers: { "content-type": "application/json" } });

      if (providerCalls === 1) {
        return toolCall("web__fetch", { url: "https://github.com/tw93/Waza" });
      }
      if (providerCalls === 2) {
        return toolCall("web__fetch", { url: "https://raw.githubusercontent.com/tw93/Waza/main/skills/think/SKILL.md" });
      }
      if (providerCalls === 3) {
        return toolCall("skills__create", {
          name: "waza-think",
          description: "Think workflow from Waza",
          content: skillContent,
          enabled: true,
        });
      }
      return new Response(JSON.stringify({
        choices: [{ message: { content: "Installed waza-think from Waza and enabled it." } }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    try {
      const run = await handle({
        jsonrpc: "2.0",
        id: 1,
        method: "runs.start",
        params: {
          input: { prompt: "Install the Waza think skill." },
          config: {
            modeId: "single_agent",
            providerId: "skill-install-flow",
            modelRef: "skill-install-flow-model",
            providerConfig: {
              id: "skill-install-flow",
              label: "Skill Install Flow",
              type: "openai_compatible",
              modelId: "skill-install-flow-model",
              baseUrl: "https://skill-install-flow.test/v1",
              apiKeyEnv: "SKILL_INSTALL_FLOW_KEY",
              capabilities: ["chat", "tool_use"],
              headers: {},
            },
            approvalMode: "auto",
            toolIds: ["web.fetch", "skills.create"],
            completionPolicy: {
              preset: "decisive",
              maxRepeatedToolCalls: 1,
              forceFinalOnBudgetExhausted: true,
              forceFinalOnRepeatedTool: true,
              allowToolCallsAfterUsefulResult: false,
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

      expect(run.status).toBe("succeeded");
      expect(fetchedUrls).toEqual([
        "https://github.com/tw93/Waza",
        "https://raw.githubusercontent.com/tw93/Waza/main/skills/think/SKILL.md",
      ]);
      expect(state.toolCalls.map((call) => call.toolId)).toContain("skills.create");
      expect(state.toolCalls.find((call) => call.toolId === "skills.create")).toMatchObject({ status: "succeeded" });
      expect(state.events.some((event) =>
        event.type === "completion.updated"
        && typeof event.payload === "object"
        && event.payload !== null
        && (event.payload as Record<string, unknown>).state === "force_final"
      )).toBe(false);
      expect(state.output?.text).toContain("Installed waza-think");
    } finally {
      globalThis.fetch = previousFetch;
      if (previousKey === undefined) {
        delete process.env.SKILL_INSTALL_FLOW_KEY;
      } else {
        process.env.SKILL_INSTALL_FLOW_KEY = previousKey;
      }
    }
  });

  it("pauses high-risk skill creation with user-facing approval copy", async () => {
    const handle = createRuntimeMethodHandler(createTempStore());
    const previousFetch = globalThis.fetch;
    const previousKey = process.env.SKILL_APPROVAL_COPY_KEY;
    process.env.SKILL_APPROVAL_COPY_KEY = "test";
    let providerCalls = 0;
    globalThis.fetch = (async () => {
      providerCalls += 1;
      return new Response(JSON.stringify({
        choices: [{
          finish_reason: "tool_calls",
          message: {
            content: null,
            tool_calls: [{
              id: `call-approval-${providerCalls}`,
              type: "function",
              function: {
                name: "skills__create",
                arguments: JSON.stringify({
                  name: "waza-think",
                  description: "Think workflow from Waza",
                  content: "---\nname: waza-think\ndescription: Think workflow from Waza\n---\nUse this skill.\n",
                  enabled: true,
                  approvalRequest: {
                    title: "需要你确认安装技能",
                    summary: "我准备把 Waza 的 think 技能安装到 Ora 的本地技能库。",
                    whatWillChange: "会新增一个本地技能条目，并允许后续 agent 使用它。",
                    whyNeeded: "这是完成你要求安装技能的必要步骤。",
                    riskNote: "确认 GitHub 来源可信后再继续。",
                    confirmLabel: "批准并继续",
                  },
                }),
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
          input: { prompt: "请帮我安装 Waza 的 think skill。" },
          config: {
            modeId: "single_agent",
            providerId: "skill-approval-copy",
            modelRef: "skill-approval-copy-model",
            providerConfig: {
              id: "skill-approval-copy",
              label: "Skill Approval Copy",
              type: "openai_compatible",
              modelId: "skill-approval-copy-model",
              baseUrl: "https://skill-approval-copy.test/v1",
              apiKeyEnv: "SKILL_APPROVAL_COPY_KEY",
              capabilities: ["chat", "tool_use"],
              headers: {},
            },
            approvalMode: "high_risk_only",
            toolIds: ["skills.create"],
          },
        },
      }) as { runId: string; status: string };

      const state = StateSnapshotSchema.parse(await handle({
        jsonrpc: "2.0",
        id: 2,
        method: "runs.state",
        params: { runId: run.runId },
      }));

      const pendingAction = state.actions.find((action) => action.id === state.pendingApprovals[0]);

      expect(run.status).toBe("interrupted");
      expect(pendingAction).toMatchObject({
        type: "skills.create",
        status: "approval_required",
        approvalRequest: {
          title: "需要你确认安装技能",
          summary: "我准备把 Waza 的 think 技能安装到 Ora 的本地技能库。",
        },
      });
      expect(JSON.stringify(pendingAction?.approvalRequest)).not.toContain("skills.create");
      expect(state.toolCalls.find((call) => call.toolId === "skills.create")).toMatchObject({ status: "approval_required" });
    } finally {
      globalThis.fetch = previousFetch;
      if (previousKey === undefined) {
        delete process.env.SKILL_APPROVAL_COPY_KEY;
      } else {
        process.env.SKILL_APPROVAL_COPY_KEY = previousKey;
      }
    }
  });

  it("pauses scheduled task creation with user-facing approval copy", async () => {
    const handle = createRuntimeMethodHandler(createTempStore());
    const previousFetch = globalThis.fetch;
    const previousKey = process.env.AUTOMATION_APPROVAL_COPY_KEY;
    process.env.AUTOMATION_APPROVAL_COPY_KEY = "test";
    globalThis.fetch = (async () => new Response(JSON.stringify({
      choices: [{
        finish_reason: "tool_calls",
        message: {
          content: null,
          tool_calls: [{
            id: "call-automation-create",
            type: "function",
            function: {
              name: "automations__create",
              arguments: JSON.stringify({
                title: "每日项目复盘",
                prompt: "总结项目状态和阻塞事项。",
                schedule: {
                  kind: "rrule",
                  rrule: "FREQ=DAILY;INTERVAL=1;BYHOUR=9;BYMINUTE=0",
                  timezone: "Asia/Shanghai",
                },
                status: "active",
                modeSelection: "manual",
                taskIntent: "plan",
                skillIds: [],
                toolIds: [],
                runConfig: {},
                approvalRequest: {
                  title: "需要你确认创建定时任务",
                  summary: "我准备创建“每日项目复盘”。",
                  whatWillChange: "Ora 会在每天 9 点自动运行这个 agent 任务。",
                  whyNeeded: "这是完成你要求设置定时任务的必要步骤。",
                  riskNote: "请确认调度时间和任务目标正确。",
                  confirmLabel: "批准并继续",
                },
              }),
            },
          }],
        },
      }],
    }), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;

    try {
      const run = await handle({
        jsonrpc: "2.0",
        id: 1,
        method: "runs.start",
        params: {
          input: { prompt: "请每天早上 9 点做一次项目复盘。" },
          config: {
            modeId: "single_agent",
            providerId: "automation-approval-copy",
            modelRef: "automation-approval-copy-model",
            providerConfig: {
              id: "automation-approval-copy",
              label: "Automation Approval Copy",
              type: "openai_compatible",
              modelId: "automation-approval-copy-model",
              baseUrl: "https://automation-approval-copy.test/v1",
              apiKeyEnv: "AUTOMATION_APPROVAL_COPY_KEY",
              capabilities: ["chat", "tool_use"],
              headers: {},
            },
            approvalMode: "high_risk_only",
            toolIds: ["automations.create"],
          },
        },
      }) as { runId: string; status: string };

      const state = StateSnapshotSchema.parse(await handle({
        jsonrpc: "2.0",
        id: 2,
        method: "runs.state",
        params: { runId: run.runId },
      }));
      const pendingAction = state.actions.find((action) => action.id === state.pendingApprovals[0]);

      expect(run.status).toBe("interrupted");
      expect(pendingAction).toMatchObject({
        type: "automations.create",
        status: "approval_required",
        approvalRequest: {
          title: "需要你确认创建定时任务",
          summary: "我准备创建“每日项目复盘”。",
        },
      });
      expect(JSON.stringify(pendingAction?.approvalRequest)).not.toContain("automations.create");
      expect(state.toolCalls.find((call) => call.toolId === "automations.create")).toMatchObject({ status: "approval_required" });
    } finally {
      globalThis.fetch = previousFetch;
      if (previousKey === undefined) {
        delete process.env.AUTOMATION_APPROVAL_COPY_KEY;
      } else {
        process.env.AUTOMATION_APPROVAL_COPY_KEY = previousKey;
      }
    }
  });

  it("does not ask again when a resumed high-risk tool action gets a replayed action id", async () => {
    const handle = createRuntimeMethodHandler(createTempStore());
    const previousFetch = globalThis.fetch;
    const previousKey = process.env.SKILL_REPLAY_APPROVAL_KEY;
    process.env.SKILL_REPLAY_APPROVAL_KEY = "test";
    const skillContent = "---\nname: approval-replay-skill\ndescription: Approval replay regression skill\n---\nUse this skill for approval replay regression tests.\n";
    let progressCalls = 0;
    let toolCalls = 0;

    globalThis.fetch = (async (_input, init) => {
      const body = typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : {};
      if (body.max_tokens === 96 || body.max_output_tokens === 96) {
        progressCalls += 1;
        return new Response(JSON.stringify({
          choices: [{ message: { content: progressCalls === 1 ? "Preparing to install the skill." : "" } }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }

      toolCalls += 1;
      if (toolCalls <= 2) {
        return new Response(JSON.stringify({
          choices: [{
            finish_reason: "tool_calls",
            message: {
              content: null,
              tool_calls: [{
                id: `call-replay-${toolCalls}`,
                type: "function",
                function: {
                  name: "skills__create",
                  arguments: JSON.stringify({
                    name: "approval-replay-skill",
                    description: "Approval replay regression skill",
                    content: skillContent,
                    enabled: true,
                    approvalRequest: {
                      title: "Confirm replay skill installation",
                      summary: `Install the replay skill after approval pass ${toolCalls}.`,
                    },
                  }),
                },
              }],
            },
          }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }

      return new Response(JSON.stringify({
        choices: [{ message: { content: "Installed approval-replay-skill." } }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    try {
      const run = await handle({
        jsonrpc: "2.0",
        id: 1,
        method: "runs.start",
        params: {
          input: { prompt: "Install approval replay skill." },
          config: {
            modeId: "single_agent",
            providerId: "skill-replay-approval",
            modelRef: "skill-replay-approval-model",
            providerConfig: {
              id: "skill-replay-approval",
              label: "Skill Replay Approval",
              type: "openai_compatible",
              modelId: "skill-replay-approval-model",
              baseUrl: "https://skill-replay-approval.test/v1",
              apiKeyEnv: "SKILL_REPLAY_APPROVAL_KEY",
              capabilities: ["chat", "tool_use"],
              headers: {},
            },
            approvalMode: "high_risk_only",
            metadata: { progressNarration: true },
            toolIds: ["skills.create"],
          },
        },
      }) as { runId: string; status: string };
      const blocked = StateSnapshotSchema.parse(await handle({
        jsonrpc: "2.0",
        id: 2,
        method: "runs.state",
        params: { runId: run.runId },
      }));
      const resumed = StateSnapshotSchema.parse(await handle({
        jsonrpc: "2.0",
        id: 3,
        method: "runs.resume",
        params: {
          runId: run.runId,
          patch: { approvedActionIds: [blocked.pendingApprovals[0]!] },
        },
      }));
      const pendingAction = blocked.actions.find((action) => action.id === blocked.pendingApprovals[0]);

      expect(run.status).toBe("interrupted");
      expect(pendingAction?.status).toBe("approval_required");
      expect(resumed.status).toBe("succeeded");
      expect(resumed.pendingApprovals).toEqual([]);
      expect(resumed.actions.some((action) => action.status === "approval_required")).toBe(false);
      expect(resumed.toolCalls.find((call) => call.toolId === "skills.create")).toMatchObject({ status: "succeeded" });
      expect(resumed.events.map((event) => event.type)).toContain("approval.resolved");
    } finally {
      globalThis.fetch = previousFetch;
      if (previousKey === undefined) {
        delete process.env.SKILL_REPLAY_APPROVAL_KEY;
      } else {
        process.env.SKILL_REPLAY_APPROVAL_KEY = previousKey;
      }
    }
  });

  it("executes an approved skill install from the paused action without repeating source file reads", async () => {
    const handle = createRuntimeMethodHandler(createTempStore());
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ora-skill-continuation-"));
    fs.mkdirSync(path.join(workspaceRoot, ".agents", "skills", "think"), { recursive: true });
    fs.writeFileSync(
      path.join(workspaceRoot, ".agents", "skills", "think", "SKILL.md"),
      "---\nname: continuation-think\ndescription: Continuation think skill\n---\nUse this skill for continuation tests.\n",
      "utf8",
    );
    const previousFetch = globalThis.fetch;
    const previousKey = process.env.SKILL_CONTINUATION_KEY;
    process.env.SKILL_CONTINUATION_KEY = "test";
    const skillContent = "---\nname: continuation-think\ndescription: Continuation think skill\n---\nUse this skill for continuation tests.\n";
    let toolProviderCalls = 0;

    const toolResponse = (id: string, name: string, args: Record<string, unknown>) => new Response(JSON.stringify({
      choices: [{
        finish_reason: "tool_calls",
        message: {
          content: null,
          tool_calls: [{
            id,
            type: "function",
            function: { name, arguments: JSON.stringify(args) },
          }],
        },
      }],
    }), { status: 200, headers: { "content-type": "application/json" } });

    globalThis.fetch = (async (_input, init) => {
      const body = typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : {};
      const tools = Array.isArray(body.tools) ? body.tools : [];
      if (tools.length === 0 || body.tool_choice === "none") {
        return new Response(JSON.stringify({
          choices: [{ message: { content: "Installed continuation-think from the approved action." } }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }

      toolProviderCalls += 1;
      if (toolProviderCalls === 1) {
        return toolResponse("call-source-list", "file__list", { path: ".agents/skills/think" });
      }
      if (toolProviderCalls === 2) {
        return toolResponse("call-source-read", "file__read", { path: ".agents/skills/think/SKILL.md" });
      }
      if (toolProviderCalls === 3) {
        return toolResponse("call-skill-create", "skills__create", {
          name: "continuation-think",
          description: "Continuation think skill",
          content: skillContent,
          enabled: true,
        });
      }
      return toolResponse(`call-repeat-source-${toolProviderCalls}`, "file__list", { path: ".agents/skills/think" });
    }) as typeof fetch;

    try {
      const run = await handle({
        jsonrpc: "2.0",
        id: 1,
        method: "runs.start",
        params: {
          input: {
            prompt: "Read the local think skill package, then install it.",
            context: { projectWorkspace: { label: "Skill Continuation", rootPath: workspaceRoot } },
          },
          config: {
            modeId: "single_agent",
            providerId: "skill-continuation",
            modelRef: "skill-continuation-model",
            providerConfig: {
              id: "skill-continuation",
              label: "Skill Continuation",
              type: "openai_compatible",
              modelId: "skill-continuation-model",
              baseUrl: "https://skill-continuation.test/v1",
              apiKeyEnv: "SKILL_CONTINUATION_KEY",
              capabilities: ["chat", "tool_use"],
              headers: {},
            },
            approvalMode: "high_risk_only",
            toolIds: ["file.list", "file.read", "skills.create"],
          },
        },
      }) as { runId: string; status: string };
      const blocked = StateSnapshotSchema.parse(await handle({
        jsonrpc: "2.0",
        id: 2,
        method: "runs.state",
        params: { runId: run.runId },
      }));
      const approvedAction = blocked.actions.find((action) => action.id === blocked.pendingApprovals[0]);
      const blockedEventCount = blocked.events.length;
      const resumed = StateSnapshotSchema.parse(await handle({
        jsonrpc: "2.0",
        id: 3,
        method: "runs.resume",
        params: {
          runId: run.runId,
          patch: { approvedActionIds: [blocked.pendingApprovals[0]!] },
        },
      }));
      const resumeToolEvents = resumed.events.slice(blockedEventCount).filter((event) =>
        event.type === "tool.called" &&
        typeof event.payload === "object" &&
        event.payload !== null
      );

      expect(run.status).toBe("interrupted");
      expect(approvedAction).toMatchObject({
        type: "skills.create",
        status: "approval_required",
        input: expect.objectContaining({ name: "continuation-think", content: skillContent }),
      });
      expect(resumed.status).toBe("succeeded");
      expect(resumed.pendingApprovals).toEqual([]);
      expect(resumeToolEvents.map((event) => (event.payload as { toolId?: string }).toolId)).toEqual(["skills.create"]);
      expect(resumed.toolCalls.filter((call) => call.toolId === "file.list")).toHaveLength(1);
      expect(resumed.toolCalls.filter((call) => call.toolId === "file.read")).toHaveLength(1);
      expect(resumed.toolCalls.find((call) => call.actionId === approvedAction?.id)).toMatchObject({
        toolId: "skills.create",
        status: "succeeded",
      });
      expect(resumed.toolResults.some((entry) =>
        entry.toolId === "skills.create" &&
        entry.status === "succeeded" &&
        entry.resultToolCallId === resumed.toolCalls.find((call) => call.actionId === approvedAction?.id)?.id
      )).toBe(true);
      expect(resumed.conversation.some((entry) =>
        entry.role === "tool" &&
        entry.toolId === "skills.create" &&
        entry.status === "succeeded"
      )).toBe(true);
      expect(resumed.continuation.frames.at(-1)).toMatchObject({
        status: "completed",
        reason: "approval_required",
        approvedActionIds: [approvedAction?.id],
      });
    } finally {
      globalThis.fetch = previousFetch;
      if (previousKey === undefined) {
        delete process.env.SKILL_CONTINUATION_KEY;
      } else {
        process.env.SKILL_CONTINUATION_KEY = previousKey;
      }
    }
  });

  it("passes durable runtime conversation tool results into later provider calls", async () => {
    const store = createTempStore();
    const handle = createRuntimeMethodHandler(store);
    const session = await handle({
      jsonrpc: "2.0",
      id: 1,
      method: "sessions.create",
      params: { label: "Durable Conversation" },
    }) as { sessionId: string };
    const previousRunId = "run-durable-conversation";
    store.persistExternalSnapshot(StateSnapshotSchema.parse({
      runId: previousRunId,
      sessionId: session.sessionId,
      turnIndex: 1,
      status: "succeeded",
      pattern: "orchestrator_subagent",
      modeId: "single_agent",
      input: { prompt: "Install previous skill.", createdAt: 1, context: {} },
      config: {
        pattern: "orchestrator_subagent",
        modeId: "single_agent",
        modeSelection: "manual",
        profileIds: [],
        skillIds: [],
        toolIds: ["skills.create"],
        modelRef: "local/smoke-model",
        approvalMode: "high_risk_only",
        patternOptions: {},
        metadata: {},
        deterministicSeed: "durable-conversation",
      },
      topology: { nodes: [], edges: [] },
      profiles: [],
      memory: [],
      plan: [],
      todos: [],
      actions: [],
      toolCalls: [],
      policyDecisions: [],
      checkpoints: [],
      events: [],
      agentMessages: [],
      artifacts: [],
      activeAgents: [],
      queueSummary: {},
      sharedStateSummary: {},
      busStats: {},
      pendingClarifications: [],
      pendingApprovals: [],
      continuation: { frames: [] },
      conversation: [
        {
          role: "assistant",
          content: "",
          toolCalls: [{
            id: `${previousRunId}:tool-call-0`,
            providerCallId: "call-durable-skill",
            toolId: "skills.create",
            args: { name: "durable-skill" },
          }],
          createdAt: 2,
        },
        {
          role: "tool",
          toolCallId: `${previousRunId}:tool-call-0`,
          providerCallId: "call-durable-skill",
          toolId: "skills.create",
          content: "{\"name\":\"durable-skill\"}",
          status: "succeeded",
          createdAt: 3,
        },
      ],
      toolResults: [],
      output: { text: "Installed durable-skill." },
      updatedAt: 4,
    }));
    const previousFetch = globalThis.fetch;
    const previousKey = process.env.DURABLE_CONVERSATION_KEY;
    process.env.DURABLE_CONVERSATION_KEY = "test";
    const providerBodies: Array<{ messages?: unknown[] }> = [];

    globalThis.fetch = (async (_input, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { messages?: unknown[] };
      providerBodies.push(body);
      return new Response(JSON.stringify({
        choices: [{ message: { content: "Saw durable tool history." } }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    try {
      const run = await handle({
        jsonrpc: "2.0",
        id: 2,
        method: "runs.start",
        params: {
          sessionId: session.sessionId,
          input: { prompt: "Continue with that context." },
          config: {
            modeId: "single_agent",
            providerId: "durable-conversation",
            modelRef: "durable-conversation-model",
            providerConfig: {
              id: "durable-conversation",
              label: "Durable Conversation",
              type: "openai_compatible",
              modelId: "durable-conversation-model",
              baseUrl: "https://durable-conversation.test/v1",
              apiKeyEnv: "DURABLE_CONVERSATION_KEY",
              capabilities: ["chat", "tool_use"],
              headers: {},
            },
            toolIds: [],
          },
        },
      }) as { status: string };

      expect(run.status).toBe("succeeded");
      expect(JSON.stringify(providerBodies[0]?.messages)).toContain("call-durable-skill");
      expect(JSON.stringify(providerBodies[0]?.messages)).toContain("tool_call_id");
    } finally {
      globalThis.fetch = previousFetch;
      if (previousKey === undefined) {
        delete process.env.DURABLE_CONVERSATION_KEY;
      } else {
        process.env.DURABLE_CONVERSATION_KEY = previousKey;
      }
    }
  });

  it("records the paused agent frame for agent-team approved tool continuation", async () => {
    const handle = createRuntimeMethodHandler(createTempStore());
    const previousFetch = globalThis.fetch;
    const previousKey = process.env.AGENT_TEAM_CONTINUATION_KEY;
    process.env.AGENT_TEAM_CONTINUATION_KEY = "test";
    const skillContent = "---\nname: team-continuation\ndescription: Team continuation skill\n---\nUse this skill for team continuation tests.\n";
    let toolProviderCalls = 0;

    globalThis.fetch = (async (_input, init) => {
      const body = typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : {};
      const tools = Array.isArray(body.tools) ? body.tools : [];
      if (tools.length === 0 || body.tool_choice === "none") {
        return new Response(JSON.stringify({
          choices: [{ message: { content: "Installed team-continuation from the paused agent frame." } }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }

      toolProviderCalls += 1;
      return new Response(JSON.stringify({
        choices: [{
          finish_reason: "tool_calls",
          message: {
            content: null,
            tool_calls: [{
              id: `call-team-continuation-${toolProviderCalls}`,
              type: "function",
              function: {
                name: "skills__create",
                arguments: JSON.stringify({
                  name: "team-continuation",
                  description: "Team continuation skill",
                  content: skillContent,
                  enabled: true,
                }),
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
          input: { prompt: "Use the agent team to install this skill." },
          config: {
            pattern: "agent_teams",
            providerId: "agent-team-continuation",
            modelRef: "agent-team-continuation-model",
            providerConfig: {
              id: "agent-team-continuation",
              label: "Agent Team Continuation",
              type: "openai_compatible",
              modelId: "agent-team-continuation-model",
              baseUrl: "https://agent-team-continuation.test/v1",
              apiKeyEnv: "AGENT_TEAM_CONTINUATION_KEY",
              capabilities: ["chat", "tool_use"],
              headers: {},
            },
            approvalMode: "high_risk_only",
            toolIds: ["skills.create"],
          },
        },
      }) as { runId: string; status: string };
      const blocked = StateSnapshotSchema.parse(await handle({
        jsonrpc: "2.0",
        id: 2,
        method: "runs.state",
        params: { runId: run.runId },
      }));
      const frame = blocked.continuation.frames.find((item) => item.id === blocked.continuation.activeFrameId);
      const resumed = StateSnapshotSchema.parse(await handle({
        jsonrpc: "2.0",
        id: 3,
        method: "runs.resume",
        params: {
          runId: run.runId,
          patch: { approvedActionIds: [blocked.pendingApprovals[0]!] },
        },
      }));
      const completedFrame = resumed.continuation.frames.find((item) => item.id === frame?.id);

      expect(run.status).toBe("interrupted");
      expect(frame).toMatchObject({
        status: "paused",
        reason: "approval_required",
        agentId: "team_lead",
        pendingActionIds: [blocked.pendingApprovals[0]],
      });
      expect(resumed.status).toBe("succeeded");
      expect(completedFrame).toMatchObject({
        status: "completed",
        agentId: "team_lead",
        approvedActionIds: [blocked.pendingApprovals[0]],
      });
      expect(resumed.toolCalls.find((call) => call.toolId === "skills.create")).toMatchObject({
        agentId: "team_lead",
        status: "succeeded",
      });
    } finally {
      globalThis.fetch = previousFetch;
      if (previousKey === undefined) {
        delete process.env.AGENT_TEAM_CONTINUATION_KEY;
      } else {
        process.env.AGENT_TEAM_CONTINUATION_KEY = previousKey;
      }
    }
  });

  it("keeps approved file write resume scope reusable for the same path", () => {
    const matcher = createResumeApprovalMatcher({
      approvedActions: [{
        type: "file.write",
        riskLevel: "high",
        agentId: "router",
        input: { path: "notes/result.md", content: "draft one\n" },
      }],
    });

    expect(matcher.consume({
      id: "run-1:action:investigator-tool-1",
      runId: "run-1",
      type: "file.write",
      riskLevel: "high",
      status: "proposed",
      agentId: "investigator",
      input: { path: "notes/result.md", content: "draft two\n" },
      artifactIds: [],
    })).toBe(true);
    expect(matcher.consume({
      id: "run-1:action:investigator-tool-2",
      runId: "run-1",
      type: "file.write",
      riskLevel: "high",
      status: "proposed",
      agentId: "investigator",
      input: { path: "notes/result.md", content: "draft three\n" },
      artifactIds: [],
    })).toBe(true);
  });

  it("executes the approved file write before asking the model for more work", async () => {
    const streams: Array<{ status?: string; events: Array<{ type: string }>; snapshot?: unknown }> = [];
    const handle = createRuntimeMethodHandler(createTempStore(), undefined, {
      onRunStream(stream) {
        streams.push(stream);
      },
    });
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ora-file-write-approval-"));
    fs.writeFileSync(path.join(workspaceRoot, "README.md"), "Source\n", "utf8");
    const previousFetch = globalThis.fetch;
    const previousKey = process.env.FILE_WRITE_APPROVAL_KEY;
    process.env.FILE_WRITE_APPROVAL_KEY = "test";
    let providerCalls = 0;

    const toolResponse = (id: string, name: string, args: Record<string, unknown>) => new Response(JSON.stringify({
      choices: [{
        finish_reason: "tool_calls",
        message: {
          content: null,
          tool_calls: [{
            id,
            type: "function",
            function: { name, arguments: JSON.stringify(args) },
          }],
        },
      }],
    }), { status: 200, headers: { "content-type": "application/json" } });

    globalThis.fetch = (async () => {
      providerCalls += 1;
      if (providerCalls === 1) {
        return toolResponse("call-read-before-write", "file__read", { path: "README.md" });
      }
      if (providerCalls === 2) {
        return toolResponse("call-write-first", "file__write", { path: "notes/result.md", content: "draft one\n" });
      }
      if (providerCalls === 3) {
        return toolResponse("call-search-after-approval", "web__search", { query: "should not run before approved write" });
      }
      return new Response(JSON.stringify({
        choices: [{ message: { content: "Wrote the approved project note." } }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    try {
      const run = await handle({
        jsonrpc: "2.0",
        id: 1,
        method: "runs.start",
        params: {
          input: {
            prompt: "Read the README, then write the project note.",
            context: { projectWorkspace: { label: "File Write Approval", rootPath: workspaceRoot } },
          },
          config: {
            modeId: "single_agent",
            providerId: "file-write-approval",
            modelRef: "file-write-approval-model",
            providerConfig: {
              id: "file-write-approval",
              label: "File Write Approval",
              type: "openai_compatible",
              modelId: "file-write-approval-model",
              baseUrl: "https://file-write-approval.test/v1",
              apiKeyEnv: "FILE_WRITE_APPROVAL_KEY",
              capabilities: ["chat", "tool_use"],
              headers: {},
            },
            approvalMode: "high_risk_only",
            toolIds: ["file.read", "file.write", "web.search"],
          },
        },
      }) as { runId: string; status: string };
      const blocked = StateSnapshotSchema.parse(await handle({
        jsonrpc: "2.0",
        id: 2,
        method: "runs.state",
        params: { runId: run.runId },
      }));
      const approvedActionId = blocked.pendingApprovals[0]!;
      const resumedHandle = await handle({
        jsonrpc: "2.0",
        id: 3,
        method: "runs.resumeStreaming",
        params: { runId: run.runId, patch: { approvedActionIds: [approvedActionId] } },
      }) as { runId: string; status: string };
      expect(resumedHandle.status).toBe("running");
      await waitFor(() => streams.some((stream) =>
        stream.snapshot !== undefined &&
        StateSnapshotSchema.parse(stream.snapshot).status === "succeeded"
      ));
      const resumed = StateSnapshotSchema.parse(await handle({
        jsonrpc: "2.0",
        id: 4,
        method: "runs.state",
        params: { runId: run.runId },
      }));

      expect(run.status).toBe("interrupted");
      expect(blocked.actions.find((action) => action.id === approvedActionId)).toMatchObject({
        type: "file.write",
        status: "approval_required",
        input: expect.objectContaining({ path: "notes/result.md", content: "draft one\n" }),
      });
      expect(resumed.status).toBe("succeeded");
      expect(resumed.output).toMatchObject({ text: "Wrote the approved project note." });
      expect(resumed.pendingApprovals).toEqual([]);
      expect(resumed.actions.some((action) => action.status === "approval_required")).toBe(false);
      expect(streams.some((stream) => stream.snapshot !== undefined && StateSnapshotSchema.parse(stream.snapshot).status === "running")).toBe(true);
      expect(streams.flatMap((stream) => stream.events).length).toBeGreaterThan(0);
      expect(resumed.events.map((event) => event.type)).toContain("approval.resolved");
      expect(resumed.events.some((event) =>
        event.type === "tool.called" &&
        typeof event.payload === "object" &&
        event.payload !== null &&
        (event.payload as { toolId?: string }).toolId === "file.write"
      )).toBe(true);
      const fileChangeArtifact = resumed.artifacts.find((artifact) => artifact.label === "notes/result.md");
      expect(fileChangeArtifact).toMatchObject({
        kind: "file",
        mimeType: "text/markdown",
        payload: expect.objectContaining({
          kind: "file_change",
          path: "notes/result.md",
          operation: "write",
          beforeContent: "",
          afterContent: "draft one\n",
          additions: 2,
          deletions: 0,
        }),
      });
      expect(resumed.actions.find((action) => action.id === approvedActionId)?.artifactIds).toEqual([fileChangeArtifact?.id]);
      expect(resumed.events.some((event) =>
        event.type === "artifact.exported" &&
        typeof event.payload === "object" &&
        event.payload !== null &&
        (event.payload as { artifact?: { id?: string } }).artifact?.id === fileChangeArtifact?.id
      )).toBe(true);
      expect(resumed.events.some((event) =>
        event.type === "tool.called" &&
        typeof event.payload === "object" &&
        event.payload !== null &&
        (event.payload as { toolId?: string }).toolId === "web.search"
      )).toBe(false);
      expect(resumed.events.some((event) =>
        event.type === "message.delta" &&
        typeof event.payload === "object" &&
        event.payload !== null &&
        (event.payload as { content?: string }).content === "Wrote the approved project note."
      )).toBe(true);
      expect(fs.readFileSync(path.join(workspaceRoot, "notes", "result.md"), "utf8")).toBe("draft one\n");
    } finally {
      globalThis.fetch = previousFetch;
      if (previousKey === undefined) {
        delete process.env.FILE_WRITE_APPROVAL_KEY;
      } else {
        process.env.FILE_WRITE_APPROVAL_KEY = previousKey;
      }
    }
  });

  it("continues an approved high-risk skill install batch without another gate", async () => {
    const handle = createRuntimeMethodHandler(createTempStore());
    const previousFetch = globalThis.fetch;
    const previousKey = process.env.SKILL_BATCH_APPROVAL_KEY;
    process.env.SKILL_BATCH_APPROVAL_KEY = "test";
    const skillContent = (name: string) => `---\nname: ${name}\ndescription: ${name} from Waza\n---\nUse ${name} from Waza.\n`;
    let providerCalls = 0;

    globalThis.fetch = (async (_input, init) => {
      const body = typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : {};
      const tools = Array.isArray(body.tools) ? body.tools : [];
      if (tools.length === 0 || body.tool_choice === "none") {
        return new Response(JSON.stringify({
          choices: [{ message: { content: "Installed the Waza skill batch." } }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      providerCalls += 1;
      if (providerCalls <= 3) {
        const skillName = providerCalls <= 2 ? "waza-think" : "waza-design";
        return new Response(JSON.stringify({
          choices: [{
            finish_reason: "tool_calls",
            message: {
              content: null,
              tool_calls: [{
                id: `call-batch-approval-${providerCalls}`,
                type: "function",
                function: {
                  name: "skills__create",
                  arguments: JSON.stringify({
                    name: skillName,
                    description: `${skillName} from Waza`,
                    content: skillContent(skillName),
                    enabled: true,
                    approvalRequest: {
                      title: "Install Waza skills",
                      summary: `Install ${skillName} from Waza.`,
                    },
                  }),
                },
              }],
            },
          }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }

      return new Response(JSON.stringify({
        choices: [{ message: { content: "Installed the Waza skill batch." } }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    try {
      const run = await handle({
        jsonrpc: "2.0",
        id: 1,
        method: "runs.start",
        params: {
          input: { prompt: "Install the Waza think and design skills." },
          config: {
            modeId: "single_agent",
            providerId: "skill-batch-approval",
            modelRef: "skill-batch-approval-model",
            providerConfig: {
              id: "skill-batch-approval",
              label: "Skill Batch Approval",
              type: "openai_compatible",
              modelId: "skill-batch-approval-model",
              baseUrl: "https://skill-batch-approval.test/v1",
              apiKeyEnv: "SKILL_BATCH_APPROVAL_KEY",
              capabilities: ["chat", "tool_use"],
              headers: {},
            },
            approvalMode: "high_risk_only",
            toolIds: ["skills.create"],
          },
        },
      }) as { runId: string; status: string };
      const blocked = StateSnapshotSchema.parse(await handle({
        jsonrpc: "2.0",
        id: 2,
        method: "runs.state",
        params: { runId: run.runId },
      }));
      const resumed = StateSnapshotSchema.parse(await handle({
        jsonrpc: "2.0",
        id: 3,
        method: "runs.resume",
        params: {
          runId: run.runId,
          patch: { approvedActionIds: [blocked.pendingApprovals[0]!] },
        },
      }));

      expect(run.status).toBe("interrupted");
      expect(blocked.actions.find((action) => action.id === blocked.pendingApprovals[0])).toMatchObject({
        type: "skills.create",
        status: "approval_required",
      });
      expect(resumed.status).toBe("succeeded");
      expect(resumed.pendingApprovals).toEqual([]);
      expect(resumed.actions.some((action) => action.status === "approval_required")).toBe(false);
      expect(resumed.toolCalls.filter((call) => call.toolId === "skills.create" && call.status === "succeeded")).toHaveLength(1);
      expect(resumed.output?.text).toContain("Installed the Waza skill batch");
    } finally {
      globalThis.fetch = previousFetch;
      if (previousKey === undefined) {
        delete process.env.SKILL_BATCH_APPROVAL_KEY;
      } else {
        process.env.SKILL_BATCH_APPROVAL_KEY = previousKey;
      }
    }
  });

  it("cancels a pending high-risk tool approval without leaving a live gate", async () => {
    const handle = createRuntimeMethodHandler(createTempStore());
    const previousFetch = globalThis.fetch;
    const previousKey = process.env.SKILL_CANCEL_APPROVAL_KEY;
    process.env.SKILL_CANCEL_APPROVAL_KEY = "test";
    let providerCalls = 0;
    globalThis.fetch = (async () => {
      providerCalls += 1;
      return new Response(JSON.stringify({
        choices: [{
          finish_reason: "tool_calls",
          message: {
            content: null,
            tool_calls: [{
              id: `call-cancel-${providerCalls}`,
              type: "function",
              function: {
                name: "skills__create",
                arguments: JSON.stringify({
                  name: "approval-cancel-skill",
                  description: "Approval cancel regression skill",
                  content: "---\nname: approval-cancel-skill\ndescription: Approval cancel regression skill\n---\nUse this skill for cancel regression tests.\n",
                  enabled: true,
                }),
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
          input: { prompt: "Install approval cancel skill." },
          config: {
            modeId: "single_agent",
            providerId: "skill-cancel-approval",
            modelRef: "skill-cancel-approval-model",
            providerConfig: {
              id: "skill-cancel-approval",
              label: "Skill Cancel Approval",
              type: "openai_compatible",
              modelId: "skill-cancel-approval-model",
              baseUrl: "https://skill-cancel-approval.test/v1",
              apiKeyEnv: "SKILL_CANCEL_APPROVAL_KEY",
              capabilities: ["chat", "tool_use"],
              headers: {},
            },
            approvalMode: "high_risk_only",
            toolIds: ["skills.create"],
          },
        },
      }) as { runId: string; status: string };
      const blocked = StateSnapshotSchema.parse(await handle({
        jsonrpc: "2.0",
        id: 2,
        method: "runs.state",
        params: { runId: run.runId },
      }));
      const cancelled = StateSnapshotSchema.parse(await handle({
        jsonrpc: "2.0",
        id: 3,
        method: "runs.cancel",
        params: { runId: run.runId, reason: "Stopped processing as instructed." },
      }));

      expect(run.status).toBe("interrupted");
      expect(blocked.pendingApprovals).toHaveLength(1);
      expect(cancelled.status).toBe("cancelled");
      expect(cancelled.error).toBe("Stopped processing as instructed.");
      expect(cancelled.pendingApprovals).toEqual([]);
      expect(cancelled.actions.some((action) => action.status === "approval_required")).toBe(false);
      expect(cancelled.actions.some((action) => action.status === "running")).toBe(false);
      expect(cancelled.actions.find((action) => action.type === "skills.create")).toMatchObject({ status: "denied" });
      expect(cancelled.toolCalls.find((call) => call.toolId === "skills.create")).toMatchObject({ status: "denied" });
      expect(JSON.stringify(cancelled)).not.toContain("Cancelled by caller.");
      expect(cancelled.activeAgents).toEqual([]);
      expect(cancelled.events.at(-1)?.type).toBe("run.cancelled");
    } finally {
      globalThis.fetch = previousFetch;
      if (previousKey === undefined) {
        delete process.env.SKILL_CANCEL_APPROVAL_KEY;
      } else {
        process.env.SKILL_CANCEL_APPROVAL_KEY = previousKey;
      }
    }
  });

  it("cancels active streaming provider work without letting the final failure overwrite cancellation", async () => {
    const store = createTempStore();
    const streams: unknown[] = [];
    const handle = createRuntimeMethodHandler(store, undefined, {
      onRunStream(stream) {
        streams.push(stream);
      },
    });
    const previousFetch = globalThis.fetch;
    const previousKey = process.env.STREAM_CANCEL_PROVIDER_KEY;
    let abortObserved = false;
    process.env.STREAM_CANCEL_PROVIDER_KEY = "test";
    globalThis.fetch = (async (_input, init) => {
      if (init?.signal?.aborted) {
        abortObserved = true;
        const error = new Error("The operation was aborted.");
        error.name = "AbortError";
        throw error;
      }
      await new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          abortObserved = true;
          const error = new Error("The operation was aborted.");
          error.name = "AbortError";
          reject(error);
        });
      });
      throw new Error("unreachable");
    }) as typeof fetch;

    try {
      const run = await handle({
        jsonrpc: "2.0",
        id: 1,
        method: "runs.startStreaming",
        params: {
          input: { prompt: "Keep working until cancelled." },
          config: {
            modeId: SINGLE_AGENT_MODE_ID,
            providerId: "stream-cancel-provider",
            modelRef: "stream-cancel-model",
            providerConfig: {
              id: "stream-cancel-provider",
              label: "Stream Cancel Provider",
              type: "openai_compatible",
              modelId: "stream-cancel-model",
              baseUrl: "https://stream-cancel.test/v1",
              apiKeyEnv: "STREAM_CANCEL_PROVIDER_KEY",
              capabilities: ["chat"],
              headers: {},
            },
          },
        },
      }) as { runId: string; status: string };

      const mutableStore = store as unknown as { runs: Map<string, unknown> };
      const runningCache = mutableStore.runs.get(run.runId);
      expect(runningCache).toBeTruthy();
      mutableStore.runs.set(run.runId, StateSnapshotSchema.parse({
        ...StateSnapshotSchema.parse(runningCache),
        status: "failed",
        error: "SHADOW ACTIVE OVERWRITE",
      }));
      const activeState = StateSnapshotSchema.parse(await handle({
        jsonrpc: "2.0",
        id: 2,
        method: "runs.state",
        params: { runId: run.runId },
      }));
      expect(activeState.status).toBe("running");
      expect(activeState.error).not.toBe("SHADOW ACTIVE OVERWRITE");
      mutableStore.runs.set(run.runId, runningCache);

      const cancelled = StateSnapshotSchema.parse(await handle({
        jsonrpc: "2.0",
        id: 3,
        method: "runs.cancel",
        params: { runId: run.runId, reason: "Stopped processing as instructed." },
      }));

      await waitFor(() => abortObserved);
      await new Promise((resolve) => setTimeout(resolve, 20));
      const cancelledProjection = StateSnapshotSchema.parse(await handle({
        jsonrpc: "2.0",
        id: 4,
        method: "runs.state",
        params: { runId: run.runId },
      }));
      mutableStore.runs.set(run.runId, StateSnapshotSchema.parse({
        ...cancelledProjection,
        status: "failed",
        error: "SHADOW CANCEL OVERWRITE",
      }));
      const latest = StateSnapshotSchema.parse(await handle({
        jsonrpc: "2.0",
        id: 5,
        method: "runs.state",
        params: { runId: run.runId },
      }));

      expect(run.status).toBe("running");
      expect(cancelled.status).toBe("cancelled");
      expect(latest.status).toBe("cancelled");
      expect(latest.error).toBe("Stopped processing as instructed.");
      expect(latest.error).not.toBe("SHADOW CANCEL OVERWRITE");
      expect(streams.some((stream) => JSON.stringify(stream).includes("\"status\":\"failed\""))).toBe(false);
    } finally {
      globalThis.fetch = previousFetch;
      if (previousKey === undefined) {
        delete process.env.STREAM_CANCEL_PROVIDER_KEY;
      } else {
        process.env.STREAM_CANCEL_PROVIDER_KEY = previousKey;
      }
    }
  });

  it("has enough single_agent budget to fetch, check, and create a multi-skill install batch", async () => {
    const handle = createRuntimeMethodHandler(createTempStore());
    const previousFetch = globalThis.fetch;
    const previousKey = process.env.MULTI_SKILL_INSTALL_KEY;
    process.env.MULTI_SKILL_INSTALL_KEY = "test";
    const skillNames = ["waza-think", "waza-design", "waza-check", "waza-hunt", "waza-write", "waza-learn", "waza-read", "waza-health"];
    const fetchedUrls: string[] = [];
    let providerCalls = 0;
    const skillContent = (name: string) => `---\nname: ${name}\ndescription: ${name} from Waza\n---\nUse ${name} from Waza.\n`;
    const rawSkillUrl = (name: string) => `https://raw.githubusercontent.com/tw93/Waza/main/skills/${name.replace("waza-", "")}/SKILL.md`;
    const toolCall = (name: string, args: Record<string, unknown>) => new Response(JSON.stringify({
      choices: [{
        finish_reason: "tool_calls",
        message: {
          content: null,
          tool_calls: [{
            id: `call-multi-install-${providerCalls}`,
            type: "function",
            function: {
              name,
              arguments: JSON.stringify(args),
            },
          }],
        },
      }],
    }), { status: 200, headers: { "content-type": "application/json" } });

    globalThis.fetch = (async (input) => {
      const url = String(input);
      if (url === "https://github.com/tw93/Waza" || url === "https://raw.githubusercontent.com/tw93/Waza/main/README.md") {
        fetchedUrls.push(url);
        return new Response("Waza repository with eight skills.", { status: 200, headers: { "content-type": "text/plain" } });
      }
      const skillName = skillNames.find((candidate) => url === rawSkillUrl(candidate));
      if (skillName) {
        fetchedUrls.push(url);
        return new Response(skillContent(skillName), { status: 200, headers: { "content-type": "text/plain" } });
      }

      providerCalls += 1;
      if (providerCalls === 1) {
        return toolCall("web__fetch", { url: "https://github.com/tw93/Waza" });
      }
      if (providerCalls === 2) {
        return toolCall("web__fetch", { url: "https://raw.githubusercontent.com/tw93/Waza/main/README.md" });
      }
      if (providerCalls >= 3 && providerCalls <= 10) {
        const skillNameForFetch = skillNames[providerCalls - 3]!;
        return toolCall("web__fetch", { url: rawSkillUrl(skillNameForFetch) });
      }
      if (providerCalls === 11) {
        return toolCall("skills__list", {});
      }
      if (providerCalls >= 12 && providerCalls <= 19) {
        return toolCall("skills__checkName", { name: skillNames[providerCalls - 12] });
      }
      if (providerCalls >= 20 && providerCalls <= 27) {
        const skillNameForCreate = skillNames[providerCalls - 20]!;
        return toolCall("skills__create", {
          name: skillNameForCreate,
          description: `${skillNameForCreate} from Waza`,
          content: skillContent(skillNameForCreate),
          enabled: true,
        });
      }
      return new Response(JSON.stringify({
        choices: [{ message: { content: "Installed all 8 Waza skills into Ora." } }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    try {
      const run = await handle({
        jsonrpc: "2.0",
        id: 1,
        method: "runs.start",
        params: {
          input: { prompt: "Install all Waza skills." },
          config: {
            modeId: "single_agent",
            providerId: "multi-skill-install",
            modelRef: "multi-skill-install-model",
            providerConfig: {
              id: "multi-skill-install",
              label: "Multi Skill Install",
              type: "openai_compatible",
              modelId: "multi-skill-install-model",
              baseUrl: "https://multi-skill-install.test/v1",
              apiKeyEnv: "MULTI_SKILL_INSTALL_KEY",
              capabilities: ["chat", "tool_use"],
              headers: {},
            },
            approvalMode: "auto",
          },
        },
      }) as { runId: string; status: string };

      const state = StateSnapshotSchema.parse(await handle({
        jsonrpc: "2.0",
        id: 2,
        method: "runs.state",
        params: { runId: run.runId },
      }));

      expect(run.status).toBe("succeeded");
      expect(state.config.budget?.maxToolCalls).toBe(256);
      expect(fetchedUrls).toHaveLength(10);
      expect(state.toolCalls.filter((call) => call.toolId === "skills.create" && call.status === "succeeded")).toHaveLength(8);
      expect(state.output?.text).toContain("Installed all 8 Waza skills");
      expect(state.events.some((event) =>
        event.type === "completion.updated"
        && typeof event.payload === "object"
        && event.payload !== null
        && (event.payload as Record<string, unknown>).state === "force_final"
      )).toBe(false);
    } finally {
      globalThis.fetch = previousFetch;
      if (previousKey === undefined) {
        delete process.env.MULTI_SKILL_INSTALL_KEY;
      } else {
        process.env.MULTI_SKILL_INSTALL_KEY = previousKey;
      }
    }
  });

  it("continues a single node beyond four distinct tool calls when budget remains", async () => {
    const handle = createRuntimeMethodHandler(createTempStore());
    const previousFetch = globalThis.fetch;
    const previousKey = process.env.MULTI_FETCH_LOOP_KEY;
    process.env.MULTI_FETCH_LOOP_KEY = "test";
    const fetchedUrls: string[] = [];
    let providerCalls = 0;
    globalThis.fetch = (async (input) => {
      const url = String(input);
      if (url.startsWith("https://example.com/skill-")) {
        fetchedUrls.push(url);
        return new Response(`Skill content for ${url}`, { status: 200, headers: { "content-type": "text/plain" } });
      }

      providerCalls += 1;
      if (providerCalls <= 8) {
        return new Response(JSON.stringify({
          choices: [{
            finish_reason: "tool_calls",
            message: {
              content: null,
              tool_calls: [{
                id: `call-skill-${providerCalls}`,
                type: "function",
                function: {
                  name: "web__fetch",
                  arguments: JSON.stringify({ url: `https://example.com/skill-${providerCalls}.md` }),
                },
              }],
            },
          }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }

      return new Response(JSON.stringify({
        choices: [{ message: { content: "Fetched all 8 skill files and can finish from those results." } }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    try {
      const run = await handle({
        jsonrpc: "2.0",
        id: 1,
        method: "runs.start",
        params: {
          input: { prompt: "Fetch all eight skill files before answering." },
          config: {
            modeId: "single_agent",
            providerId: "multi-fetch-loop",
            modelRef: "multi-fetch-loop-model",
            providerConfig: {
              id: "multi-fetch-loop",
              label: "Multi Fetch Loop",
              type: "openai_compatible",
              modelId: "multi-fetch-loop-model",
              baseUrl: "https://multi-fetch-loop.test/v1",
              apiKeyEnv: "MULTI_FETCH_LOOP_KEY",
              capabilities: ["chat", "tool_use"],
              headers: {},
            },
            toolIds: ["web.fetch"],
            budget: {
              maxTokens: 1024,
              maxToolCalls: 12,
              maxRuntimeMs: 60_000,
            },
            completionPolicy: {
              preset: "decisive",
              maxRepeatedToolCalls: 1,
              forceFinalOnBudgetExhausted: true,
              forceFinalOnRepeatedTool: true,
              allowToolCallsAfterUsefulResult: false,
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

      expect(run.status).toBe("succeeded");
      expect(fetchedUrls).toEqual([
        "https://example.com/skill-1.md",
        "https://example.com/skill-2.md",
        "https://example.com/skill-3.md",
        "https://example.com/skill-4.md",
        "https://example.com/skill-5.md",
        "https://example.com/skill-6.md",
        "https://example.com/skill-7.md",
        "https://example.com/skill-8.md",
      ]);
      expect(state.output).toMatchObject({
        text: expect.stringContaining("Fetched all 8 skill files"),
        metadata: { completion: expect.objectContaining({ forcedFinal: false, stopReason: "completed" }) },
      });
      expect(state.events.some((event) =>
        event.type === "completion.updated"
        && typeof event.payload === "object"
        && event.payload !== null
        && (event.payload as Record<string, unknown>).reason === "runtime_tool_loop_limit"
      )).toBe(false);
    } finally {
      globalThis.fetch = previousFetch;
      if (previousKey === undefined) {
        delete process.env.MULTI_FETCH_LOOP_KEY;
      } else {
        process.env.MULTI_FETCH_LOOP_KEY = previousKey;
      }
    }
  });

  it("blocks repeated tool intent and finalizes from available context", async () => {
    const handle = createRuntimeMethodHandler(createTempStore());
    const previousFetch = globalThis.fetch;
    const previousKey = process.env.DUPLICATE_TOOL_KEY;
    process.env.DUPLICATE_TOOL_KEY = "test";
    let providerCalls = 0;
    let webFetchCalls = 0;
    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      if (url === "https://example.com/duplicate") {
        webFetchCalls += 1;
        return new Response("Duplicate content", { status: 200, headers: { "content-type": "text/plain" } });
      }

      providerCalls += 1;
      const body = JSON.parse(String(init?.body ?? "{}")) as { tool_choice?: string };
      if (body.tool_choice === "none") {
        return new Response(JSON.stringify({
          choices: [{ message: { content: "Stopped after detecting repeated tool intent." } }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }

      return new Response(JSON.stringify({
        choices: [{
          finish_reason: "tool_calls",
          message: {
            content: null,
            tool_calls: [{
              id: `call-duplicate-${providerCalls}`,
              type: "function",
              function: {
                name: "web__fetch",
                arguments: "{\"url\":\"https://example.com/duplicate\"}",
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
          input: { prompt: "Keep fetching the same URL." },
          config: {
            modeId: "single_agent",
            providerId: "duplicate-tool",
            modelRef: "duplicate-tool-model",
            providerConfig: {
              id: "duplicate-tool",
              label: "Duplicate Tool",
              type: "openai_compatible",
              modelId: "duplicate-tool-model",
              baseUrl: "https://duplicate-tool.test/v1",
              apiKeyEnv: "DUPLICATE_TOOL_KEY",
              capabilities: ["chat", "tool_use"],
              headers: {},
            },
            toolIds: ["web.fetch"],
            completionPolicy: {
              preset: "balanced",
              maxRepeatedToolCalls: 1,
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
      const fetchEvents = state.events.filter((event) =>
        event.type === "tool.called"
        && typeof event.payload === "object"
        && event.payload !== null
        && (event.payload as Record<string, unknown>).toolId === "web.fetch"
      );
      const completionEvents = state.events.filter((event) => event.type === "completion.updated");

      expect(run.status).toBe("succeeded");
      expect(webFetchCalls).toBe(1);
      expect(fetchEvents).toHaveLength(1);
      expect(completionEvents.some((event) =>
        typeof event.payload === "object"
        && event.payload !== null
        && (event.payload as Record<string, unknown>).reason === "repeated_tool_blocked"
      )).toBe(true);
      expect(state.output).toMatchObject({
        text: expect.stringContaining("Stopped after detecting repeated tool intent."),
        metadata: { completion: expect.objectContaining({ stopReason: "repeated_tool_blocked" }) },
      });
    } finally {
      globalThis.fetch = previousFetch;
      if (previousKey === undefined) {
        delete process.env.DUPLICATE_TOOL_KEY;
      } else {
        process.env.DUPLICATE_TOOL_KEY = previousKey;
      }
    }
  });

  it("scopes repeated tool blocking to the current agent node", async () => {
    const handle = createRuntimeMethodHandler(createTempStore());
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ora-agent-team-tools-"));
    fs.writeFileSync(path.join(workspaceRoot, "README.md"), "Agent team scoped tool result\n", "utf8");
    const previousFetch = globalThis.fetch;
    const previousKey = process.env.AGENT_TEAM_SCOPED_TOOL_KEY;
    process.env.AGENT_TEAM_SCOPED_TOOL_KEY = "test";
    let autoProviderCalls = 0;
    const toolCall = (id: string) => new Response(JSON.stringify({
      choices: [{
        finish_reason: "tool_calls",
        message: {
          content: null,
          tool_calls: [{
            id,
            type: "function",
            function: {
              name: "file__read",
              arguments: "{\"path\":\"README.md\"}",
            },
          }],
        },
      }],
    }), { status: 200, headers: { "content-type": "application/json" } });

    globalThis.fetch = (async (_input, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { tool_choice?: string };
      if (body.tool_choice === "none") {
        return new Response(JSON.stringify({
          choices: [{ message: { content: "Team lead stopped after repeated file reads." } }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }

      autoProviderCalls += 1;
      if (autoProviderCalls <= 3) {
        return toolCall(`call-team-lead-${autoProviderCalls}`);
      }
      if (autoProviderCalls === 4) {
        return toolCall("call-builder-readme");
      }
      if (autoProviderCalls === 5) {
        return new Response(JSON.stringify({
          choices: [{ message: { content: "Builder completed with README evidence." } }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (autoProviderCalls === 6) {
        return new Response(JSON.stringify({
          choices: [{ message: { content: "Checker validated the builder output." } }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({
        choices: [{ message: { content: "Team handoff complete." } }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    try {
      const run = await handle({
        jsonrpc: "2.0",
        id: 1,
        method: "runs.start",
        params: {
          input: {
            prompt: "Use the agent team to read and validate the README.",
            context: {
              projectWorkspace: { label: "Agent Team Workspace", rootPath: workspaceRoot },
            },
          },
          config: {
            pattern: "agent_teams",
            providerId: "agent-team-scoped-tool",
            modelRef: "agent-team-scoped-tool-model",
            providerConfig: {
              id: "agent-team-scoped-tool",
              label: "Agent Team Scoped Tool",
              type: "openai_compatible",
              modelId: "agent-team-scoped-tool-model",
              baseUrl: "https://agent-team-scoped-tool.test/v1",
              apiKeyEnv: "AGENT_TEAM_SCOPED_TOOL_KEY",
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
      const readCalls = state.toolCalls.filter((call) => call.toolId === "file.read");
      const forceFinalEvents = state.events.filter((event) =>
        event.type === "completion.updated"
        && typeof event.payload === "object"
        && event.payload !== null
        && (event.payload as Record<string, unknown>).state === "force_final"
      );

      expect(run.status).toBe("succeeded");
      expect(readCalls).toEqual([
        expect.objectContaining({ agentId: "team_lead", status: "succeeded" }),
        expect.objectContaining({ agentId: "team_lead", status: "succeeded" }),
        expect.objectContaining({ agentId: "builder", status: "succeeded" }),
        expect.objectContaining({ agentId: "builder", status: "succeeded" }),
      ]);
      expect(forceFinalEvents).toHaveLength(2);
      expect(forceFinalEvents.map((event) => event.payload)).toEqual([
        expect.objectContaining({
        reason: "repeated_tool_blocked",
        scopeKey: "agent:team_lead|node:triage",
        }),
        expect.objectContaining({
          reason: "repeated_tool_blocked",
          scopeKey: "agent:builder|node:build",
        }),
      ]);
      expect(forceFinalEvents.some((event) =>
        typeof event.payload === "object"
        && event.payload !== null
        && (event.payload as Record<string, unknown>).scopeKey === "agent:builder|node:build"
      )).toBe(true);
    } finally {
      globalThis.fetch = previousFetch;
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
      if (previousKey === undefined) {
        delete process.env.AGENT_TEAM_SCOPED_TOOL_KEY;
      } else {
        process.env.AGENT_TEAM_SCOPED_TOOL_KEY = previousKey;
      }
    }
  });

  it("forces final answer after too many calls to the same tool type with different args", async () => {
    const handle = createRuntimeMethodHandler(createTempStore());
    const previousFetch = globalThis.fetch;
    const previousKey = process.env.TOOL_FREQUENCY_KEY;
    process.env.TOOL_FREQUENCY_KEY = "test";
    let providerCalls = 0;
    let webFetchCalls = 0;
    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      if (url.startsWith("https://example.com/frequency-")) {
        webFetchCalls += 1;
        return new Response(`Frequency content ${webFetchCalls}`, { status: 200, headers: { "content-type": "text/plain" } });
      }

      const body = JSON.parse(String(init?.body ?? "{}")) as { tool_choice?: string };
      if (body.tool_choice === "none") {
        return new Response(JSON.stringify({
          choices: [{ message: { content: "Stopped after tool frequency guard with collected results." } }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }

      providerCalls += 1;
      return new Response(JSON.stringify({
        choices: [{
          finish_reason: "tool_calls",
          message: {
            content: null,
            tool_calls: [{
              id: `call-frequency-${providerCalls}`,
              type: "function",
              function: {
                name: "web__fetch",
                arguments: JSON.stringify({ url: `https://example.com/frequency-${providerCalls}` }),
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
          input: { prompt: "Fetch many different URLs." },
          config: {
            modeId: "single_agent",
            providerId: "tool-frequency",
            modelRef: "tool-frequency-model",
            providerConfig: {
              id: "tool-frequency",
              label: "Tool Frequency",
              type: "openai_compatible",
              modelId: "tool-frequency-model",
              baseUrl: "https://tool-frequency.test/v1",
              apiKeyEnv: "TOOL_FREQUENCY_KEY",
              capabilities: ["chat", "tool_use"],
              headers: {},
            },
            toolIds: ["web.fetch"],
            budget: {
              maxTokens: 1024,
              maxToolCalls: 300,
              maxRuntimeMs: 60_000,
            },
            completionPolicy: {
              preset: "persistent",
              maxRepeatedToolCalls: 4,
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

      expect(run.status).toBe("succeeded");
      expect(webFetchCalls).toBe(255);
      expect(state.toolCalls.filter((call) => call.toolId === "web.fetch")).toHaveLength(255);
      expect(state.events.some((event) =>
        event.type === "completion.updated"
        && typeof event.payload === "object"
        && event.payload !== null
        && (event.payload as Record<string, unknown>).reason === "tool_frequency_exhausted"
      )).toBe(true);
      expect(state.output).toMatchObject({
        text: expect.stringContaining("Stopped after tool frequency guard"),
        metadata: { completion: expect.objectContaining({ stopReason: "tool_frequency_exhausted" }) },
      });
    } finally {
      globalThis.fetch = previousFetch;
      if (previousKey === undefined) {
        delete process.env.TOOL_FREQUENCY_KEY;
      } else {
        process.env.TOOL_FREQUENCY_KEY = previousKey;
      }
    }
  });

  it("turns tool execution errors into observed results before continuing", async () => {
    const handle = createRuntimeMethodHandler(createTempStore());
    const previousFetch = globalThis.fetch;
    const previousKey = process.env.TOOL_ERROR_RESULT_KEY;
    process.env.TOOL_ERROR_RESULT_KEY = "test";
    let providerCalls = 0;
    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      if (url === "https://example.com/tool-throws") {
        throw new Error("network exploded");
      }

      providerCalls += 1;
      const body = JSON.parse(String(init?.body ?? "{}")) as { messages?: Array<{ role?: string; content?: string }> };
      const sawDegradedResult = body.messages?.some((message) =>
        (message.role === "user" || message.role === "tool")
        && typeof message.content === "string"
        && message.content.includes("Workspace tool degraded for web.fetch")
      );
      if (sawDegradedResult) {
        return new Response(JSON.stringify({
          choices: [{ message: { content: "The fetch tool failed, so I am answering from the degraded tool result." } }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }

      return new Response(JSON.stringify({
        choices: [{
          finish_reason: "tool_calls",
          message: {
            content: null,
            tool_calls: [{
              id: "call-tool-error",
              type: "function",
              function: {
                name: "web__fetch",
                arguments: "{\"url\":\"https://example.com/tool-throws\"}",
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
          input: { prompt: "Fetch the URL and explain the result." },
          config: {
            modeId: "single_agent",
            providerId: "tool-error-result",
            modelRef: "tool-error-result-model",
            providerConfig: {
              id: "tool-error-result",
              label: "Tool Error Result",
              type: "openai_compatible",
              modelId: "tool-error-result-model",
              baseUrl: "https://tool-error-result.test/v1",
              apiKeyEnv: "TOOL_ERROR_RESULT_KEY",
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

      expect(providerCalls).toBeGreaterThanOrEqual(2);
      expect(run.status).toBe("succeeded");
      expect(state.status).toBe("succeeded");
      expect(state.toolCalls.some((call) => call.toolId === "web.fetch" && call.status === "failed")).toBe(true);
      expect(state.events.some((event) =>
        event.type === "node.updated"
        && typeof event.payload === "object"
        && event.payload !== null
        && (event.payload as Record<string, unknown>).state === "repairing"
      )).toBe(true);
      expect(state.output).toMatchObject({
        text: expect.stringContaining("answering from the degraded tool result"),
      });
      expect(state.output?.text).not.toContain("network exploded");
    } finally {
      globalThis.fetch = previousFetch;
      if (previousKey === undefined) {
        delete process.env.TOOL_ERROR_RESULT_KEY;
      } else {
        process.env.TOOL_ERROR_RESULT_KEY = previousKey;
      }
    }
  });

  it("enforces maxToolCalls globally and ignores provider tools during forced final", async () => {
    const handle = createRuntimeMethodHandler(createTempStore());
    const previousFetch = globalThis.fetch;
    const previousKey = process.env.TOOL_BUDGET_KEY;
    process.env.TOOL_BUDGET_KEY = "test";
    let webFetchCalls = 0;
    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      if (url === "https://example.com/budget") {
        webFetchCalls += 1;
        return new Response("Budget content", { status: 200, headers: { "content-type": "text/plain" } });
      }

      const body = JSON.parse(String(init?.body ?? "{}")) as { tool_choice?: string };
      if (body.tool_choice === "none") {
        return new Response(JSON.stringify({
          choices: [{
            finish_reason: "tool_calls",
            message: {
              content: "Final answer from prior budget content without more tools.",
              tool_calls: [{
                id: "call-ignored",
                type: "function",
                function: {
                  name: "web__fetch",
                  arguments: "{\"url\":\"https://example.com/ignored\"}",
                },
              }],
            },
          }],
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
                arguments: "{\"url\":\"https://example.com/budget\"}",
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
          input: { prompt: "Spend only one tool call." },
          config: {
            modeId: "single_agent",
            providerId: "tool-budget",
            modelRef: "tool-budget-model",
            providerConfig: {
              id: "tool-budget",
              label: "Tool Budget",
              type: "openai_compatible",
              modelId: "tool-budget-model",
              baseUrl: "https://tool-budget.test/v1",
              apiKeyEnv: "TOOL_BUDGET_KEY",
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

      expect(run.status).toBe("succeeded");
      expect(webFetchCalls).toBe(1);
      expect(state.status).toBe("succeeded");
      expect(state.toolCalls.filter((call) => call.toolId === "web.fetch")).toHaveLength(1);
      expect(state.events.some((event) =>
        event.type === "completion.updated"
        && typeof event.payload === "object"
        && event.payload !== null
        && (event.payload as Record<string, unknown>).state === "tool_calls_ignored"
      )).toBe(true);
      expect(state.output).toMatchObject({
        text: expect.stringContaining("Final answer from prior budget content"),
        metadata: { completion: expect.objectContaining({ stopReason: "tool_budget_exhausted", toolAttempts: 1 }) },
      });
      expect(state.output?.text).not.toContain("I need to stop using tools here.");
      expect(state.output?.text).not.toContain("https://example.com/ignored");
      expect(state.error).toBeUndefined();
      expect(state.events.some((event) => event.type === "run.failed")).toBe(false);
      expect(state.events.some((event) => event.type === "run.done")).toBe(true);
    } finally {
      globalThis.fetch = previousFetch;
      if (previousKey === undefined) {
        delete process.env.TOOL_BUDGET_KEY;
      } else {
        process.env.TOOL_BUDGET_KEY = previousKey;
      }
    }
  });

  it("repairs dangling provider tool calls before the next model invocation", async () => {
    const modeSpec = getModePreset("single_agent");
    const definition = modeSpecToPatternDefinition(modeSpec);
    const { snapshot } = await executeRuntimeKernel(
      "run-repair",
      { prompt: "Continue after repair.", createdAt: 1, context: {} },
      {
        pattern: "orchestrator_subagent",
        modeId: "single_agent",
        providerId: "local-smoke",
        modelRef: "smoke-model",
        providerConfig: {
          id: "local-smoke",
          type: "local_smoke",
          label: "Smoke",
          modelId: "smoke-model",
          capabilities: ["chat"],
          headers: {},
        },
        metadata: {},
        deterministicSeed: "repair-test",
        profileIds: ["solo_agent"],
        skillIds: [],
        toolIds: [],
        approvalMode: "auto",
        budget: {
          maxTokens: 1024,
          maxToolCalls: 4,
          maxRuntimeMs: 60_000,
        },
      },
      {
        modeSpec,
        definition,
        conversationMessages: [{
          role: "assistant",
          content: "",
          toolCalls: [{ id: "dangling-call", toolId: "web.search", args: { query: "Ora" } }],
        }],
      },
    );

    expect(snapshot.events.map((event) => event.type)).toContain("tool.repaired");
    expect(snapshot.toolCalls).toEqual([
      expect.objectContaining({
        providerCallId: "dangling-call",
        toolId: "web.search",
        source: "manual_repair",
        status: "repaired",
        repairReason: "missing_provider_tool_result",
        result: expect.objectContaining({ status: "interrupted" }),
      }),
    ]);
  });

  it("keeps generator-verifier turns usable when verifier output is not parseable", async () => {
    const handle = createRuntimeMethodHandler(createTempStore());
    const previousFetch = globalThis.fetch;
    const previousKey = process.env.MOCK_OPENAI_KEY;
    process.env.MOCK_OPENAI_KEY = "test";
    globalThis.fetch = (async (_input, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        messages?: Array<{ role: string; content: string }>;
      };
      const systemText = body.messages
        ?.filter((message) => message.role === "system")
        .map((message) => message.content)
        .join("\n") ?? "";
      const content = systemText.includes("verifier")
        ? "This looks acceptable to me, but I am not returning JSON."
        : "Candidate answer from mocked provider.";
      return new Response(JSON.stringify({
        choices: [{ message: { role: "assistant", content } }],
      }), { status: 200 });
    }) as typeof fetch;

    try {
      const run = (await handle({
        jsonrpc: "2.0",
        id: 1,
        method: "runs.start",
        params: {
          input: { prompt: "What tools can you use?" },
          config: {
            pattern: "generator_verifier",
            providerId: "mock-openai",
            modelRef: "mock-chat",
            metadata: { providerId: "mock-openai" },
            providerConfig: {
              id: "mock-openai",
              label: "Mock OpenAI",
              type: "openai_compatible",
              modelId: "mock-chat",
              baseUrl: "https://example.test/v1",
              apiKeyEnv: "MOCK_OPENAI_KEY",
              capabilities: ["chat"],
              headers: {},
            },
          },
        },
      })) as { runId: string; status: string };

      const state = StateSnapshotSchema.parse(
        await handle({
          jsonrpc: "2.0",
          id: 2,
          method: "runs.state",
          params: { runId: run.runId },
        })
      );

      expect(run.status).toBe("succeeded");
      expect(state.status).toBe("succeeded");
      expect(state.error).toBeUndefined();
      expect(state.output).toMatchObject({
        pattern: "generator_verifier",
        verifier: {
          verdict: "fail",
          exhausted: true,
          failureKind: "verification_failed",
        },
      });
    } finally {
      globalThis.fetch = previousFetch;
      if (previousKey === undefined) {
        delete process.env.MOCK_OPENAI_KEY;
      } else {
        process.env.MOCK_OPENAI_KEY = previousKey;
      }
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
      DEERFLOW_HARNESS_MODE_ID,
      "single_agent",
      DEBATE_MODE_ID,
      CODE_DEVELOPMENT_MODE_ID,
      ORA_SELF_BUILDER_MODE_ID,
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

  it("lists and previews project files inside the selected project root", async () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ora-project-files-"));
    try {
      fs.mkdirSync(path.join(workspaceRoot, "src"), { recursive: true });
      fs.mkdirSync(path.join(workspaceRoot, ".space"), { recursive: true });
      fs.mkdirSync(path.join(workspaceRoot, "node_modules", "ignored"), { recursive: true });
      fs.writeFileSync(path.join(workspaceRoot, "README.md"), "# Project\n", "utf8");
      fs.writeFileSync(path.join(workspaceRoot, "src", "index.ts"), "export const value = 1;\n", "utf8");
      fs.writeFileSync(path.join(workspaceRoot, ".space", "cache.md"), "# Hidden workspace cache\n", "utf8");
      fs.writeFileSync(path.join(workspaceRoot, "node_modules", "ignored", "package.json"), "{}", "utf8");

      const handle = createRuntimeMethodHandler(createTempStore());
      const project = await handle({
        jsonrpc: "2.0",
        id: 1,
        method: "projects.create",
        params: { rootPath: workspaceRoot, label: "Project Files" }
      }) as { projectId: string };
      const files = await handle({
        jsonrpc: "2.0",
        id: 2,
        method: "projects.files",
        params: { projectId: project.projectId }
      }) as { totalFiles: number; files: { path: string }[]; skippedDirs: string[] };
      const preview = await handle({
        jsonrpc: "2.0",
        id: 3,
        method: "projects.file.read",
        params: { projectId: project.projectId, path: "README.md" }
      }) as { path: string; previewKind: string; payload: string };

      expect(files.totalFiles).toBe(3);
      expect(files.files.map((file) => file.path)).toEqual(["README.md", "src/index.ts", ".space/cache.md"]);
      expect(files.skippedDirs).toContain("node_modules");
      expect(preview).toMatchObject({
        path: "README.md",
        previewKind: "text",
        payload: "# Project\n"
      });
      await expect(Promise.resolve().then(() => handle({
        jsonrpc: "2.0",
        id: 4,
        method: "projects.file.read",
        params: { projectId: project.projectId, path: "../outside.md" }
      }))).rejects.toThrow("inside the project root");
    } finally {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
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
    expect(cloned.completionPolicy?.preset).toBe("balanced");

    const updated = await handle({
      jsonrpc: "2.0",
      id: 2,
      method: "modes.update",
      params: {
        modeId: cloned.id,
        spec: {
          ...cloned,
          summary: "Custom orchestrator mode.",
          completionPolicy: {
            ...cloned.completionPolicy,
            preset: "persistent",
            maxRepeatedToolCalls: 4,
          },
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
    expect(updated.completionPolicy.preset).toBe("persistent");

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
    expect(state.modeSpec?.completionPolicy.preset).toBe("persistent");
    expect(state.config.completionPolicy?.preset).toBe("persistent");
    expect(state.pattern).toBe("orchestrator_subagent");
    expect(state.plan.some((item) => item.id.endsWith(":review"))).toBe(false);
  });

  it("falls back to single agent when auto mode routing does not return valid JSON", async () => {
    const handle = createRuntimeMethodHandler(createTempStore());
    const run = await handle({
      jsonrpc: "2.0",
      id: 1,
      method: "runs.start",
      params: {
        input: { prompt: "Choose the best mode automatically." },
        config: { modeSelection: "auto" },
      },
    }) as { runId: string };

    const state = StateSnapshotSchema.parse(
      await handle({
        jsonrpc: "2.0",
        id: 2,
        method: "runs.state",
        params: { runId: run.runId },
      }),
    );

    expect(state.config.modeSelection).toBe("auto");
    expect(state.modeId).toBe(SINGLE_AGENT_MODE_ID);
    expect(state.config.metadata.autoModeRouter).toMatchObject({
      selectedModeId: SINGLE_AGENT_MODE_ID,
      status: "fallback",
    });
  });

  it("routes auto mode to a selected custom mode", async () => {
    const handle = createRuntimeMethodHandler(createTempStore());
    const cloned = await handle({
      jsonrpc: "2.0",
      id: 1,
      method: "modes.cloneFromPreset",
      params: {
        sourceModeId: "agent_teams",
        modeId: "agent-teams-auto-custom",
        label: "Agent Teams Auto Custom",
      },
    }) as { id: string };
    const previousFetch = globalThis.fetch;
    const previousKey = process.env.AUTO_MODE_KEY;
    process.env.AUTO_MODE_KEY = "test";
    let routerRequest: { max_tokens?: number; messages?: Array<{ role: string; content?: string }> } | undefined;
    let routerPrompt: { candidates?: Array<{ id: string }>; recentMessages?: Array<{ role: string; content: string }> } | undefined;
    let routerCandidateIds: string[] = [];
    globalThis.fetch = (async (_input, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        max_tokens?: number;
        messages?: Array<{ role: string; content?: string }>;
      };
      const systemText = body.messages
        ?.filter((message) => message.role === "system")
        .map((message) => message.content ?? "")
        .join("\n") ?? "";
      const isRouterRequest = systemText.includes("agent mode router");
      if (isRouterRequest) {
        routerRequest = body;
        const promptText = body.messages?.find((message) => message.role === "user")?.content ?? "{}";
        routerPrompt = JSON.parse(promptText) as typeof routerPrompt;
        routerCandidateIds = routerPrompt?.candidates?.map((candidate) => candidate.id) ?? [];
      }
      const content = isRouterRequest
        ? `router result:\n${JSON.stringify({
            modeId: cloned.id,
            taskIntent: "implement",
            confidence: 0.91,
            reason: "This task benefits from a team workflow.",
          })}\n`
        : "Mock provider content.";
      return new Response(JSON.stringify({
        choices: [{ message: { role: "assistant", content } }],
      }), { status: 200 });
    }) as typeof fetch;

    try {
      const run = await handle({
        jsonrpc: "2.0",
        id: 2,
        method: "runs.start",
        params: {
          input: {
            prompt: "Work this as a coordinated team.",
            context: {
              recentMessages: [
                { role: "user", content: "Earlier we discussed a quick one-off edit." },
                { role: "assistant", content: "A single agent would be enough for that earlier request." },
              ],
            },
          },
          config: {
            modeSelection: "auto",
            providerId: "auto-router",
            modelRef: "auto-router-model",
            metadata: { providerId: "auto-router", taskIntentMode: "auto" },
            providerConfig: {
              id: "auto-router",
              label: "Auto Router",
              type: "openai_compatible",
              modelId: "auto-router-model",
              baseUrl: "https://example.test/v1",
              apiKeyEnv: "AUTO_MODE_KEY",
              capabilities: ["chat"],
              headers: {},
            },
          },
        },
      }) as { runId: string };

      const state = StateSnapshotSchema.parse(
        await handle({
          jsonrpc: "2.0",
          id: 3,
          method: "runs.state",
          params: { runId: run.runId },
        }),
      );

      expect(state.config.modeSelection).toBe("auto");
      expect(state.modeId).toBe(cloned.id);
      expect(state.modeSpec?.id).toBe(cloned.id);
      expect(state.config.metadata.autoModeRouter).toMatchObject({
        selectedModeId: cloned.id,
        selectedTaskIntent: "implement",
        status: "selected",
      });
      expect(state.config.metadata.taskIntent).toBe("implement");
      expect(routerRequest?.max_tokens).toBe(800);
      expect(routerPrompt?.taskIntentMode).toBe("auto");
      expect(routerCandidateIds).toContain(cloned.id);
      expect(routerCandidateIds).not.toContain(MODE_STUDIO_BUILDER_MODE_ID);
      expect(routerPrompt?.recentMessages).toEqual([
        { role: "user", content: "Earlier we discussed a quick one-off edit." },
        { role: "assistant", content: "A single agent would be enough for that earlier request." },
        { role: "user", content: "Work this as a coordinated team." },
      ]);
    } finally {
      globalThis.fetch = previousFetch;
      if (previousKey === undefined) {
        delete process.env.AUTO_MODE_KEY;
      } else {
        process.env.AUTO_MODE_KEY = previousKey;
      }
    }
  });

  it("runs and clones the built-in DeerFlow-like harness preset", async () => {
    const handle = createRuntimeMethodHandler(createTempStore());
    const cloned = await handle({
      jsonrpc: "2.0",
      id: 1,
      method: "modes.cloneFromPreset",
      params: {
        sourceModeId: DEERFLOW_HARNESS_MODE_ID,
        modeId: "deerflow-harness-custom",
        label: "DeerFlow Harness Custom",
      },
    }) as any;

    expect(cloned.id).toBe("deerflow-harness-custom");
    expect(cloned.systemPreset).toBe(false);
    expect(cloned.editorConstraints.readOnly).toBe(false);
    expect(cloned.nodes.filter((node: { config?: { atoms?: unknown } }) =>
      Array.isArray(node.config?.atoms) && node.config.atoms.includes("subagent_delegate"),
    ).map((node: { id: string }) => node.id)).toEqual(["research", "review"]);

    const run = await handle({
      jsonrpc: "2.0",
      id: 2,
      method: "runs.start",
      params: {
        input: { prompt: "Use the DeerFlow-like harness." },
        config: { modeId: DEERFLOW_HARNESS_MODE_ID },
      },
    }) as { runId: string; status: string };

    expect(run.status).toBe("succeeded");

    const state = StateSnapshotSchema.parse(
      await handle({
        jsonrpc: "2.0",
        id: 3,
        method: "runs.state",
        params: { runId: run.runId },
      }),
    );

    const taskStartedPayloads = state.events
      .filter((event) => event.type === "task.started")
      .map((event) => event.payload);

    expect(state.modeId).toBe(DEERFLOW_HARNESS_MODE_ID);
    expect(state.modeSpec?.id).toBe(DEERFLOW_HARNESS_MODE_ID);
    expect(state.pattern).toBe("orchestrator_subagent");
    expect(state.profiles.map((profile) => profile.id)).toEqual([
      ORA_ROOT_AGENT_ID,
      "orchestrator",
      "researcher",
      "reviewer",
    ]);
    expect(taskStartedPayloads).toEqual(expect.arrayContaining([
      expect.objectContaining({ taskId: "task:research", nodeId: "research" }),
      expect.objectContaining({ taskId: "task:review", nodeId: "review" }),
    ]));
    expect(state.events.filter((event) => event.type === "task.completed")).toHaveLength(2);
    expect(state.topology.nodes.some((node) =>
      node.kind === "capability"
      && node.metadata.atomId === "subagent_delegate"
      && node.metadata.sourceNodeId === "research",
    )).toBe(true);
    expect(state.topology.nodes.some((node) =>
      node.kind === "capability"
      && node.metadata.atomId === "subagent_delegate"
      && node.metadata.sourceNodeId === "review",
    )).toBe(true);
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
    expect(state.profiles.map((profile) => profile.id)).toEqual([ORA_ROOT_AGENT_ID]);
    expect(state.memory.some((record) => record.namespace.join(":").startsWith("session:local-project:single_agent"))).toBe(true);
    expect(state.output).toMatchObject({
      modeId: "single_agent",
      agent: {
        id: ORA_ROOT_AGENT_ID
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
    expect(
      state.topology.nodes.some((node) =>
        node.kind === "capability"
        && node.metadata.atomId === "subagent_delegate"
        && node.metadata.sourceNodeId === "research",
      ),
    ).toBe(true);
  });

  it("fails the run when the model provider does not exist", async () => {
    const handle = createRuntimeMethodHandler(createTempStore());
    const cloned = await handle({
      jsonrpc: "2.0",
      id: 1,
      method: "modes.cloneFromPreset",
      params: {
        sourceModeId: "orchestrator_subagent",
        modeId: "orchestrator-missing-provider-custom",
        label: "Orchestrator Missing Provider",
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
          summary: "Custom orchestrator mode for testing missing provider behavior.",
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

    expect(run.status).toBe("failed");
    expect(state.status).toBe("failed");
  });

  it("retries transient provider failures before completing the run", async () => {
    const handle = createRuntimeMethodHandler(createTempStore());
    const previousFetch = globalThis.fetch;
    const previousKey = process.env.RETRY_PROVIDER_KEY;
    process.env.RETRY_PROVIDER_KEY = "test";
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      if (calls < 3) {
        return new Response("server busy", { status: 503 });
      }
      return new Response(JSON.stringify({
        choices: [{ message: { role: "assistant", content: "Recovered provider answer." } }],
      }), { status: 200 });
    }) as typeof fetch;

    try {
      const cloned = await handle({
        jsonrpc: "2.0",
        id: 1,
        method: "modes.cloneFromPreset",
        params: {
          sourceModeId: "orchestrator_subagent",
          modeId: "orchestrator-retry-provider",
          label: "Orchestrator Retry Provider",
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
              ...cloned.recoveryPolicy,
              defaults: {
                ...cloned.recoveryPolicy.defaults,
                backoffMs: 0,
                capDelayMs: 0,
              },
            },
          },
        },
      });

      const run = await handle({
        jsonrpc: "2.0",
        id: 3,
        method: "runs.start",
        params: {
          input: { prompt: "Retry transient provider errors." },
          config: {
            modeId: cloned.id,
            providerId: "retry-provider",
            providerConfig: {
              id: "retry-provider",
              label: "Retry Provider",
              type: "openai_compatible",
              modelId: "retry-chat",
              baseUrl: "https://example.test/v1",
              apiKeyEnv: "RETRY_PROVIDER_KEY",
              capabilities: ["chat"],
              headers: {},
            },
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

      expect(calls).toBeGreaterThanOrEqual(3);
      expect(run.status).toBe("succeeded");
      expect(state.status).toBe("succeeded");
      expect(state.events.filter((event) => event.type === "recovery.retry_scheduled")).toHaveLength(2);
      expect(state.output).toMatchObject({
        text: expect.stringContaining("Recovered provider answer."),
      });
    } finally {
      globalThis.fetch = previousFetch;
      if (previousKey === undefined) {
        delete process.env.RETRY_PROVIDER_KEY;
      } else {
        process.env.RETRY_PROVIDER_KEY = previousKey;
      }
    }
  });

  it("fails exhausted transient provider retries instead of completing with limited context", async () => {
    const handle = createRuntimeMethodHandler(createTempStore());
    const previousFetch = globalThis.fetch;
    const previousKey = process.env.RETRY_PROVIDER_KEY;
    process.env.RETRY_PROVIDER_KEY = "test";
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return new Response("temporarily unavailable", { status: 503 });
    }) as typeof fetch;

    try {
      const cloned = await handle({
        jsonrpc: "2.0",
        id: 1,
        method: "modes.cloneFromPreset",
        params: {
          sourceModeId: "orchestrator_subagent",
          modeId: "orchestrator-exhaust-provider-retry",
          label: "Orchestrator Exhaust Provider Retry",
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
              ...cloned.recoveryPolicy,
              defaults: {
                ...cloned.recoveryPolicy.defaults,
                backoffMs: 0,
                capDelayMs: 0,
              },
            },
          },
        },
      });

      const run = await handle({
        jsonrpc: "2.0",
        id: 3,
        method: "runs.start",
        params: {
          input: { prompt: "Do not finish with a fallback if the provider never recovers." },
          config: {
            modeId: cloned.id,
            providerId: "retry-provider",
            providerConfig: {
              id: "retry-provider",
              label: "Retry Provider",
              type: "openai_compatible",
              modelId: "retry-chat",
              baseUrl: "https://example.test/v1",
              apiKeyEnv: "RETRY_PROVIDER_KEY",
              capabilities: ["chat"],
              headers: {},
            },
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

      expect(calls).toBe(3);
      expect(run.status).toBe("failed");
      expect(state.status).toBe("failed");
      expect(state.events.filter((event) => event.type === "recovery.retry_scheduled")).toHaveLength(2);
      expect(state.events.filter((event) => event.type === "recovery.exhausted")).toHaveLength(1);
      const exhaustedIncident = (state.events.find((event) => event.type === "recovery.exhausted")?.payload as { incident?: Record<string, unknown> }).incident;
      expect(exhaustedIncident).toMatchObject({ surface: "provider", errorType: "provider_busy" });
      expect(state.events.filter((event) =>
        event.type === "recovery.exhausted" &&
        (event.payload as { incident?: { errorType?: string } }).incident?.errorType === "node_exception"
      )).toHaveLength(0);
      expect(state.events.map((event) => event.type)).toContain("run.failed");
      expect(state.events.map((event) => event.type)).not.toContain("run.done");
      const hasLimitedContextFallback = state.events.some((event) => event.type === "message.delta" &&
        typeof (event.payload as { content?: unknown }).content === "string" &&
        (event.payload as { content: string }).content.includes("continued with limited context"));
      expect(hasLimitedContextFallback).toBe(false);
    } finally {
      globalThis.fetch = previousFetch;
      if (previousKey === undefined) {
        delete process.env.RETRY_PROVIDER_KEY;
      } else {
        process.env.RETRY_PROVIDER_KEY = previousKey;
      }
    }
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
          runtimeAtoms: cloned.runtimeAtoms.filter((atom: string) => atom !== "tool_error_boundary" && atom !== "recovery_policy"),
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
    expect(state.checkpoints[0]?.label).toBe("Failed checkpoint");
    expect(state.events.map((event) => event.type)).not.toContain("run.done");
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
    expect(state.checkpoints[0]?.label).toBe("Interrupted checkpoint");
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
    expect(resumed.output).toMatchObject({
      text: expect.stringContaining("[local-smoke]"),
      pattern: "orchestrator_subagent",
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
      expectNoNodeLoopTransitionDiagnostics(state);

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
        const queueEventsWithBusStats = state.events.filter((event) =>
          event.type === "queue.updated" &&
          typeof event.payload === "object" &&
          event.payload !== null &&
          "busStats" in event.payload
        );
        const finalQueueEvent = queueEventsWithBusStats.at(-1);
        expect(finalQueueEvent?.payload).toMatchObject({
          summary: {
            topics: state.queueSummary.topics,
          },
          busStats: state.busStats,
        });
      }

      if (pattern === "shared_state") {
        expect(state.sharedStateSummary.enabled).toBe(true);
        expect(state.sharedStateSummary.version).toBeGreaterThan(0);
        expect(state.sharedStateSummary.entries.length).toBeGreaterThan(0);
        const sharedStateEvents = state.events.filter((event) => event.type === "shared_state.updated");
        expect(sharedStateEvents.length).toBeGreaterThan(0);
        expect(sharedStateEvents.at(-1)?.payload).toMatchObject({
          entry: {
            version: state.sharedStateSummary.version,
          },
        });
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
    const beforeReload = StateSnapshotSchema.parse(await handleFirst({
      jsonrpc: "2.0",
      id: "state-before-continuation-roundtrip",
      method: "runs.state",
      params: { runId: run.runId }
    }));
    firstStore.persistExternalSnapshot(StateSnapshotSchema.parse({
      ...beforeReload,
      continuation: {
        activeFrameId: `${run.runId}:continuation:0`,
        frames: [{
          id: `${run.runId}:continuation:0`,
          runId: run.runId,
          status: "completed",
          reason: "approval_required",
          conversationCursor: 1,
          pendingActionIds: [],
          pendingToolCallIds: [],
          pendingClarificationIds: [],
          approvedActionIds: [`${run.runId}:action:example`],
          resolvedClarificationIds: [],
          createdAt: beforeReload.updatedAt,
          updatedAt: beforeReload.updatedAt,
        }],
      },
      conversation: [{
        role: "tool",
        toolCallId: `${run.runId}:tool-call-0`,
        toolId: "skills.create",
        content: "{\"ok\":true}",
        status: "succeeded",
        createdAt: beforeReload.updatedAt,
      }],
      toolResults: [{
        key: "skills.create:{}",
        toolId: "skills.create",
        argsDigest: "{}",
        resultToolCallId: `${run.runId}:tool-call-0`,
        status: "succeeded",
        output: { ok: true },
        createdAt: beforeReload.updatedAt,
        updatedAt: beforeReload.updatedAt,
      }],
    }));

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
    expect(state.continuation.frames[0]).toMatchObject({
      status: "completed",
      reason: "approval_required",
      approvedActionIds: [`${run.runId}:action:example`],
    });
    expect(state.conversation[0]).toMatchObject({
      role: "tool",
      toolId: "skills.create",
      status: "succeeded",
    });
    expect(state.toolResults[0]).toMatchObject({
      toolId: "skills.create",
      status: "succeeded",
      output: { ok: true },
    });
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

  it("starts a streaming run and publishes incremental message events before final state", async () => {
    const streams: Array<{ status?: string; events: Array<{ type: string; payload: unknown }>; snapshot?: unknown }> = [];
    const handle = createRuntimeMethodHandler(createTempStore(), undefined, {
      onRunStream(stream) {
        streams.push(stream);
      },
    });
    const run = (await handle({
      jsonrpc: "2.0",
      id: 1,
      method: "runs.startStreaming",
      params: {
        input: { prompt: "Stream local smoke output." },
        config: { pattern: "orchestrator_subagent" },
      },
    })) as { runId: string; status: string };

    expect(run.status).toBe("running");
    expect(streams[0]).toMatchObject({
      status: "running",
      events: [],
      snapshot: {
        runId: run.runId,
        status: "running",
      },
    });
    await waitFor(() => streams.some((stream) => stream.status === "succeeded"));

    const deltaEvents = streams.flatMap((stream) => stream.events).filter((event) => event.type === "message.delta");
    expect(deltaEvents.length).toBeGreaterThan(1);
    expect(deltaEvents.some((event) => typeof (event.payload as { delta?: unknown }).delta === "string")).toBe(true);
    const messageIds = deltaEvents.map((event) => (event.payload as { messageId?: unknown }).messageId);
    expect(messageIds.every((messageId) => typeof messageId === "string")).toBe(true);
    expect(messageIds[0]).toMatch(new RegExp(`^${run.runId}:assistant:orchestrator:[^:]+:0$`));
    const chunksByMessageId = new Map<unknown, number>();
    for (const messageId of messageIds) {
      chunksByMessageId.set(messageId, (chunksByMessageId.get(messageId) ?? 0) + 1);
    }
    expect([...chunksByMessageId.values()].some((count) => count > 1)).toBe(true);

    const state = StateSnapshotSchema.parse(await handle({
      jsonrpc: "2.0",
      id: 2,
      method: "runs.state",
      params: { runId: run.runId },
    }));
    expect(state.status).toBe("succeeded");
    expect(state.events.some((event) => event.type === "run.done")).toBe(true);
    expectNoNodeLoopTransitionDiagnostics(state);
  }, 10_000);

  it("reads completed streaming state and replay streams from the ledger projection", async () => {
    const store = createTempStore();
    const handle = createRuntimeMethodHandler(store);
    const run = (await handle({
      jsonrpc: "2.0",
      id: 1,
      method: "runs.startStreaming",
      params: {
        input: { prompt: "Stream ledger projection." },
        config: { pattern: "orchestrator_subagent" },
      },
    })) as { runId: string; status: string };

    expect(run.status).toBe("running");
    await waitFor(async () => {
      const state = StateSnapshotSchema.parse(await handle({
        jsonrpc: "2.0",
        id: 2,
        method: "runs.state",
        params: { runId: run.runId },
      }));
      return state.status === "succeeded";
    }, 10_000);

    const cleanState = StateSnapshotSchema.parse(await handle({
      jsonrpc: "2.0",
      id: 3,
      method: "runs.state",
      params: { runId: run.runId },
    }));
    const mutableStore = store as unknown as { runs: Map<string, unknown> };
    mutableStore.runs.set(run.runId, StateSnapshotSchema.parse({
      ...cleanState,
      events: [],
      output: { text: "SHADOW STREAM OUTPUT" },
    }));

    const projectedState = StateSnapshotSchema.parse(await handle({
      jsonrpc: "2.0",
      id: 4,
      method: "runs.state",
      params: { runId: run.runId },
    }));
    const stream = await handle({
      jsonrpc: "2.0",
      id: 5,
      method: "runs.stream",
      params: { runId: run.runId, afterSeq: 0 },
    }) as { events: Array<{ seq: number; type: string }>; snapshot?: unknown; nextSeq: number };
    const replay = await handle({
      jsonrpc: "2.0",
      id: 6,
      method: "runs.replay",
      params: { runId: run.runId },
    }) as { events: Array<{ seq: number; type: string }>; nextSeq: number };
    const replayedState = StateSnapshotSchema.parse(await handle({
      jsonrpc: "2.0",
      id: 7,
      method: "runs.state",
      params: { runId: run.runId },
    }));

    expect(projectedState.output).not.toMatchObject({ text: "SHADOW STREAM OUTPUT" });
    expect(projectedState.events.length).toBeGreaterThan(0);
    expect(stream.nextSeq).toBe(projectedState.events.length);
    expect(stream.events).toEqual(projectedState.events.filter((event) => event.seq >= 1));
    expect(StateSnapshotSchema.parse(stream.snapshot).output).toEqual(projectedState.output);
    expect(replay.events.length).toBeGreaterThan(0);
    expect(replay.events.at(-1)?.type).toBe("checkpoint.created");
    expect(replay.nextSeq).toBe(replayedState.events.length);
    expect(replayedState.events.at(-1)?.type).toBe("run.replayed");
    expectNoNodeLoopTransitionDiagnostics(projectedState);
    expectNoNodeLoopTransitionDiagnostics(replayedState);
  }, 10_000);

  it("executes OpenAI-compatible native tool calls during streaming runs", async () => {
    // NOTE: uses runs.start instead of runs.startStreaming — ad-hoc provider configs
    // in the streaming code path have a longstanding gap where the provider is never
    // invoked (providerCalls stays 0). Tracked in GitHub issue #2.
    const handle = createRuntimeMethodHandler(createTempStore());
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ora-stream-native-tool-"));
    fs.writeFileSync(path.join(workspaceRoot, "README.md"), "Streaming native tool result\n", "utf8");
    const previousFetch = globalThis.fetch;
    const previousKey = process.env.STREAM_NATIVE_TOOL_KEY;
    process.env.STREAM_NATIVE_TOOL_KEY = "test";
    let providerCalls = 0;
    const providerRequestBodies: unknown[] = [];
    globalThis.fetch = (async (_input, init) => {
      providerCalls += 1;
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        tools?: unknown[];
        messages?: Array<{ role: string; tool_call_id?: string; content?: string }>;
      };
      providerRequestBodies.push(body);
      expect(body.tools?.length).toBeGreaterThan(0);

      if (providerCalls === 1) {
        return new Response(JSON.stringify({
          choices: [{
            finish_reason: "tool_calls",
            message: {
              content: null,
              tool_calls: [
                {
                  id: "call-readme",
                  type: "function",
                  function: {
                    name: "file__read",
                    arguments: "{\"path\":\"README.md\"}",
                  },
                },
              ],
            },
          }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({
        choices: [{ message: { content: "Read README through streaming native tool." } }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    try {
      const run = (await handle({
        jsonrpc: "2.0",
        id: 1,
        method: "runs.start",
        params: {
          input: {
            prompt: "Read the README.",
            context: {
              projectWorkspace: { label: "Streaming Native Tool Workspace", rootPath: workspaceRoot },
            },
          },
          config: {
            modeId: "single_agent",
            providerId: "stream-native-tool",
            modelRef: "stream-native-tool-model",
            providerConfig: {
              id: "stream-native-tool",
              label: "Streaming Native Tool",
              type: "openai_compatible",
              modelId: "stream-native-tool-model",
              baseUrl: "https://stream-native-tool.test/v1",
              apiKeyEnv: "STREAM_NATIVE_TOOL_KEY",
              capabilities: ["chat", "tool_use"],
              headers: {},
            },
            toolIds: ["file.read"],
          },
        },
      })) as { runId: string; status: string };

      const state = StateSnapshotSchema.parse(await handle({
        jsonrpc: "2.0",
        id: 2,
        method: "runs.state",
        params: { runId: run.runId },
      }));

      expect(providerCalls).toBeGreaterThanOrEqual(2);
      expect(state.toolCalls).toEqual([
        expect.objectContaining({
          providerCallId: "call-readme",
          toolId: "file.read",
          source: "provider_native",
          status: "succeeded",
        }),
      ]);
      expect(state.output).toMatchObject({ text: expect.stringContaining("Read README through streaming native tool.") });
      expectNoNodeLoopTransitionDiagnostics(state);
    } finally {
      globalThis.fetch = previousFetch;
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
      if (previousKey === undefined) {
        delete process.env.STREAM_NATIVE_TOOL_KEY;
      } else {
        process.env.STREAM_NATIVE_TOOL_KEY = previousKey;
      }
    }
  });

  it("preserves native tool-call reasoning history when tool fallback recovery continues", async () => {
    const handle = createRuntimeMethodHandler(createTempStore());
    const previousFetch = globalThis.fetch;
    const previousKey = process.env.NATIVE_TOOL_FALLBACK_KEY;
    process.env.NATIVE_TOOL_FALLBACK_KEY = "test";
    let providerCalls = 0;
    const providerRequestBodies: Array<{
      messages?: Array<{
        role: string;
        reasoning_content?: string;
        tool_call_id?: string;
        tool_calls?: unknown[];
        content?: string | null;
      }>;
    }> = [];

    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      if (url === "https://example.com/degraded") {
        throw new Error("fetch failed");
      }

      providerCalls += 1;
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        messages?: Array<{
          role: string;
          reasoning_content?: string;
          tool_call_id?: string;
          tool_calls?: unknown[];
          content?: string | null;
        }>;
      };
      providerRequestBodies.push(body);

      if (providerCalls === 1) {
        return new Response(JSON.stringify({
          choices: [{
            finish_reason: "tool_calls",
            message: {
              content: null,
              reasoning_content: "Need to fetch the source before answering.",
              tool_calls: [{
                id: "call-degraded",
                type: "function",
                function: {
                  name: "web__fetch",
                  arguments: "{\"url\":\"https://example.com/degraded\"}",
                },
              }],
            },
          }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }

      return new Response(JSON.stringify({
        choices: [{ message: { content: "Recovered from the degraded fetch using the fallback artifact." } }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    try {
      const run = await handle({
        jsonrpc: "2.0",
        id: 1,
        method: "runs.start",
        params: {
          input: { prompt: "Fetch the source and continue even if it degrades." },
          config: {
            modeId: "single_agent",
            providerId: "native-tool-fallback",
            modelRef: "native-tool-fallback-model",
            providerConfig: {
              id: "native-tool-fallback",
              label: "Native Tool Fallback",
              type: "openai_compatible",
              modelId: "native-tool-fallback-model",
              baseUrl: "https://native-tool-fallback.test/v1",
              apiKeyEnv: "NATIVE_TOOL_FALLBACK_KEY",
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

      const recoveryRequest = providerRequestBodies.find((body) =>
        body.messages?.some((message) => message.role === "tool" && message.tool_call_id === "call-degraded")
      );
      expect(run.status).toBe("succeeded");
      expect(providerCalls).toBeGreaterThanOrEqual(2);
      expect(recoveryRequest?.messages).toEqual(expect.arrayContaining([
        expect.objectContaining({
          role: "assistant",
          reasoning_content: "Need to fetch the source before answering.",
          tool_calls: expect.arrayContaining([
            expect.objectContaining({ id: "call-degraded" }),
          ]),
        }),
        expect.objectContaining({
          role: "tool",
          tool_call_id: "call-degraded",
          content: expect.stringContaining("Workspace tool degraded for web.fetch"),
        }),
      ]));
      expect(state.toolCalls).toEqual([
        expect.objectContaining({
          providerCallId: "call-degraded",
          toolId: "web.fetch",
          source: "provider_native",
          status: "failed",
          error: "fetch failed",
        }),
      ]);
      expect(state.output?.text).toContain("Recovered from the degraded fetch");
    } finally {
      globalThis.fetch = previousFetch;
      if (previousKey === undefined) {
        delete process.env.NATIVE_TOOL_FALLBACK_KEY;
      } else {
        process.env.NATIVE_TOOL_FALLBACK_KEY = previousKey;
      }
    }
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
    expect(blocked.pendingApprovals).toEqual([blocked.actions[0]!.id]);
    expect(blocked.events.map((event) => event.type)).toContain("approval.required");
    expect(blocked.todos.every((todo) => todo.status === "blocked")).toBe(true);
    expect(resumed.actions.every((action) => action.status === "succeeded")).toBe(true);
    expect(resumed.memory.length).toBeGreaterThan(0);
    expect(
      resumed.memory.some((record) => record.namespace.join(":").includes("orchestrator_subagent")),
    ).toBe(true);
    expect(resumed.events.map((event) => event.type)).toContain("approval.resolved");
    expect(resumed.events.map((event) => event.type)).toContain("todo.updated");
    expect(resumed.todos.every((todo) => todo.status === "done")).toBe(true);
    expect(resumed.output).toMatchObject({
      text: expect.stringContaining("[local-smoke]"),
      pattern: "orchestrator_subagent",
      orchestrator: {
        plan: expect.stringContaining("[local-smoke]"),
      },
    });
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
    const store = createTempStore();
    const handle = createRuntimeMethodHandler(store);
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
    store.persistExternalSnapshot(StateSnapshotSchema.parse({
      ...source,
      continuation: {
        activeFrameId: undefined,
        frames: [{
          id: `${source.runId}:continuation:0`,
          runId: source.runId,
          status: "completed",
          reason: "approval_required",
          conversationCursor: 1,
          pendingActionIds: [],
          pendingToolCallIds: [],
          pendingClarificationIds: [],
          approvedActionIds: [`${source.runId}:action:approved`],
          resolvedClarificationIds: [],
          createdAt: source.checkpoints[0]!.createdAt,
          updatedAt: source.checkpoints[0]!.createdAt,
        }],
      },
      conversation: [{
        role: "tool",
        toolCallId: `${source.runId}:tool-call-0`,
        toolId: "skills.create",
        content: "{\"name\":\"replay\"}",
        status: "succeeded",
        createdAt: source.checkpoints[0]!.createdAt,
      }],
      toolResults: [{
        key: "skills.create:{\"name\":\"replay\"}",
        toolId: "skills.create",
        argsDigest: "{\"name\":\"replay\"}",
        resultToolCallId: `${source.runId}:tool-call-0`,
        status: "succeeded",
        output: { name: "replay" },
        createdAt: source.checkpoints[0]!.createdAt,
        updatedAt: source.checkpoints[0]!.createdAt,
      }],
    }));

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
    expect(replay.events.at(-1)?.seq).toBe(source.checkpoints[0]!.eventSeq);
    expect(replay.nextSeq).toBe(replayedState.events.length);
    expectEventSeqSemantics(replayedState);
    expect(replayedState.events.at(-1)?.type).toBe("run.replayed");
    expect(replayedState.events.at(-1)?.payload).toMatchObject({
      continuation: {
        frameCount: 1,
        conversationEntryCount: 1,
        toolResultCount: 1,
      },
    });
  });
});
