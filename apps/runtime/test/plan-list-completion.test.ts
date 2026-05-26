import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  SINGLE_AGENT_MODE_ID,
  ORA_ROOT_AGENT_ID,
  getModePreset,
  modeSpecToPatternDefinition,
} from "@cemeworm/shared";

const capturedRequests: Array<{
  prompt?: string;
  system?: string;
  messages: Array<{ role: string; content: string }>;
}> = [];

vi.mock("../src/providers/index.js", async () => {
  const actual = await vi.importActual<typeof import("../src/providers/index.js")>(
    "../src/providers/index.js",
  );

  return {
    ...actual,
    invokeRunProvider: vi.fn(async (config, request) => {
      const messages = (request.messages ?? []).map((message) => ({
        role: message.role,
        content: typeof message.content === "string" ? message.content : JSON.stringify(message.content),
      }));
      capturedRequests.push({
        prompt: request.prompt,
        system: request.system,
        messages,
      });

      const text = responseForRequest(request.system ?? "", messages);
      return {
        providerId: config.providerId ?? "mock-provider",
        providerType: "local_smoke",
        modelId: config.modelRef ?? "mock-model",
        text,
        raw: { request },
      };
    }),
  };
});

import { executeRuntimeKernel } from "../src/index.js";
import { createScopedRuntimeEventEmitter } from "../src/harness/runtime-scoped-emitter.js";

describe("runtime plan list completion guard", () => {
  beforeEach(() => {
    capturedRequests.length = 0;
  });

  it("defaults missing event attribution from the scoped runtime emitter", () => {
    const emit = vi.fn((type, payload, extra) => ({
      id: "event-1",
      runId: "run-1",
      seq: 1,
      type,
      createdAt: 1,
      pattern: "orchestrator_subagent",
      payload,
      ...extra,
    }));
    const scopedEmit = createScopedRuntimeEventEmitter(emit, {
      agentId: "builder",
      nodeId: "builder-node",
    });

    scopedEmit("task.progress", { summary: "Scoped progress" });
    scopedEmit("task.progress", { summary: "Explicit progress" }, {
      agentId: "reviewer",
      nodeId: "review-node",
    });

    expect(emit).toHaveBeenNthCalledWith(
      1,
      "task.progress",
      { summary: "Scoped progress" },
      { agentId: "builder", nodeId: "builder-node" },
    );
    expect(emit).toHaveBeenNthCalledWith(
      2,
      "task.progress",
      { summary: "Explicit progress" },
      { agentId: "reviewer", nodeId: "review-node" },
    );
  });

  it("does not auto-advance plan list from runtime lifecycle", async () => {
    const modeSpec = getModePreset(SINGLE_AGENT_MODE_ID)!;
    const definition = modeSpecToPatternDefinition(modeSpec);

    const { snapshot } = await executeRuntimeKernel(
      "run-plan-list-guard",
      { prompt: "Implement the requested change.", createdAt: 1, context: {} },
      {
        pattern: "orchestrator_subagent",
        modeId: SINGLE_AGENT_MODE_ID,
        providerId: "mock-provider",
        modelRef: "mock-model",
        providerConfig: {
          id: "mock-provider",
          type: "local_smoke",
          label: "Mock",
          modelId: "mock-model",
          capabilities: ["chat"],
          headers: {},
        },
        metadata: {},
        deterministicSeed: "plan-list-completion-guard",
        profileIds: ["solo_agent"],
        skillIds: [],
        toolIds: ["plan.update"],
        approvalMode: "auto",
        budget: {
          maxTokens: 1024,
          maxToolCalls: 8,
          maxRuntimeMs: 60_000,
        },
      },
      { modeSpec, definition },
    );

    expect(snapshot.status).toBe("succeeded");
    expect(snapshot.planList).toEqual([]);
    const planListEvents = snapshot.events.filter((event) => event.type === "plan_list.updated");
    expect(planListEvents).toEqual([]);
    expect(snapshot.events.map((event) => event.seq)).toEqual(snapshot.events.map((_, index) => index));
    expect(capturedRequests.some((request) =>
      request.messages.some((message) =>
        message.content.includes("The current plan list is not complete yet"),
      ),
    )).toBe(false);
  });
});

function responseForRequest(
  system: string,
  messages: Array<{ role: string; content: string }>,
): string {
  if (system.includes("The selected mode has returned its work product")) {
    return "Final answer after all plan steps completed.";
  }
  const planUpdateResultCount = messages.filter((message) =>
    message.content.includes("Workspace tool result for plan.update"),
  ).length;
  if (planUpdateResultCount >= 2) {
    return "All plan steps are complete.";
  }
  if (messages.some((message) => message.content.includes("Unfinished steps:"))) {
    return JSON.stringify({
      tool: "plan.update",
      args: {
        plan: [
          { step: "Inspect current behavior", status: "completed" },
          { step: "Implement guard", status: "completed" },
          { step: "Verify regression", status: "completed" },
        ],
      },
    });
  }
  if (messages.some((message) => message.content.includes("Workspace tool result for plan.update"))) {
    return "I inspected the current behavior and can answer now.";
  }
  return JSON.stringify({
    tool: "plan.update",
    args: {
      plan: [
        { step: "Inspect current behavior", status: "in_progress" },
        { step: "Implement guard", status: "pending" },
        { step: "Verify regression", status: "pending" },
      ],
    },
  });
}
