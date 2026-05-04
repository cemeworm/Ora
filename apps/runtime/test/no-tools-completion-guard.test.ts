import { describe, expect, it } from "vitest";
import {
  SINGLE_AGENT_MODE_ID,
  getModePreset,
  modeSpecToPatternDefinition,
} from "@cemeworm/shared";
import { executeRuntimeKernel } from "../src/index.js";

describe("runtime no-tools completion guard", () => {
  it("does not silently complete when no tools are enabled but runtime work is pending", async () => {
    const modeSpec = getModePreset(SINGLE_AGENT_MODE_ID)!;
    const definition = modeSpecToPatternDefinition(modeSpec);

    const { snapshot } = await executeRuntimeKernel(
      "run-no-tools-guard",
      { prompt: "Answer without tools.", createdAt: 1, context: {} },
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
        deterministicSeed: "no-tools-completion-guard",
        profileIds: ["solo_agent"],
        skillIds: [],
        toolIds: [],
        approvalMode: "auto",
        budget: {
          maxTokens: 1024,
          maxToolCalls: 1,
          maxRuntimeMs: 60_000,
        },
      },
      {
        modeSpec,
        definition,
        resumeState: {
          plan: [],
          todos: [],
          actions: [{
            id: "run-no-tools-guard:action:pending-shell",
            runId: "run-no-tools-guard",
            type: "shell.execute",
            riskLevel: "medium",
            status: "running",
            input: {},
            artifactIds: [],
          }],
          toolCalls: [],
          toolResults: [],
          continuation: { frames: [] },
          conversation: [],
        },
      },
    );

    expect(snapshot.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "task.progress",
          payload: expect.objectContaining({
            source: "runtime_status",
            trigger: "runtime_work.pending",
          }),
        }),
      ]),
    );
    expect(snapshot.output).toMatchObject({
      metadata: {
        completion: expect.objectContaining({
          stopReason: "runtime_tool_loop_limit",
        }),
      },
    });
  });
});
