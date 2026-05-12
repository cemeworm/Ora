import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  SINGLE_AGENT_MODE_ID,
  getModePreset,
  modeSpecToPatternDefinition,
} from "@cemeworm/shared";

const providerState = vi.hoisted(() => ({
  calls: 0,
}));

vi.mock("../src/providers/index.js", async () => {
  const actual = await vi.importActual<typeof import("../src/providers/index.js")>(
    "../src/providers/index.js",
  );

  return {
    ...actual,
    invokeRunProvider: vi.fn(async (config) => ({
      providerId: config.providerId ?? "mock-provider",
      providerType: "local_smoke",
      modelId: config.modelRef ?? "mock-model",
      text: "Final answer.",
      raw: {},
    })),
    invokeRunProviderStream: vi.fn(async (config, _request, callbacks) => {
      providerState.calls += 1;
      const invocation = providerState.calls;
      await callbacks?.onStreamEvent?.({ kind: "sse_frame", streamMode: "sse", raw: { invocation, frame: 1 } });
      await callbacks?.onStreamEvent?.({ kind: "sse_frame", streamMode: "sse", raw: { invocation, frame: 2 } });
      await callbacks?.onStreamEvent?.({ kind: "fallback_started", streamMode: "fallback_single" });
      const text = invocation === 1
        ? JSON.stringify({
            tool: "plan.update",
            args: {
              plan: [
                { step: "Inspect current behavior", status: "completed" },
                { step: "Implement guard", status: "completed" },
              ],
            },
          })
        : "All plan steps are complete.";
      await callbacks?.onTextDelta?.({ delta: text, text, raw: { invocation } });
      return {
        providerId: config.providerId ?? "mock-provider",
        providerType: "local_smoke",
        modelId: config.modelRef ?? "mock-model",
        text,
        raw: { invocation },
      };
    }),
  };
});

import { executeRuntimeKernel } from "../src/index.js";

describe("node runtime provider stream telemetry", () => {
  beforeEach(() => {
    providerState.calls = 0;
  });

  it("preserves only the first sse frame per provider invocation while keeping non-frame stream events", async () => {
    const modeSpec = getModePreset(SINGLE_AGENT_MODE_ID)!;
    const definition = modeSpecToPatternDefinition(modeSpec);

    const { snapshot } = await executeRuntimeKernel(
      "run-provider-stream-frames",
      { prompt: "Update the plan, then answer.", createdAt: 1, context: {} },
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
        deterministicSeed: "provider-stream-frame-test",
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
      { modeSpec, definition, streamProvider: true },
    );

    const providerStreamEvents = snapshot.events.filter((event) =>
      event.type === "node.updated" &&
      typeof event.payload === "object" &&
      event.payload !== null &&
      (event.payload as Record<string, unknown>).providerStream === true
    );
    const sseFrameEvents = providerStreamEvents.filter((event) =>
      (event.payload as Record<string, unknown>).state === "sse_frame"
    );
    const fallbackEvents = providerStreamEvents.filter((event) =>
      (event.payload as Record<string, unknown>).state === "fallback_started"
    );

    expect(snapshot.status).toBe("succeeded");
    expect(providerState.calls).toBe(2);
    expect(sseFrameEvents.map((event) => (event.payload as { raw?: { invocation?: number } }).raw?.invocation)).toEqual([1, 2]);
    expect(fallbackEvents).toHaveLength(2);
    expect(providerStreamEvents.map((event) => (event.payload as Record<string, unknown>).state)).toEqual([
      "sse_frame",
      "fallback_started",
      "sse_frame",
      "fallback_started",
    ]);
  });
});
