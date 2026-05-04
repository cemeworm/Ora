import { describe, expect, it } from "vitest";
import {
  SINGLE_AGENT_MODE_ID,
  getModePreset,
  modeSpecToPatternDefinition,
} from "@cemeworm/shared";
import { executeRuntimeKernel } from "../src/index.js";

describe("runtime mode progress finalization", () => {
  it("fails instead of emitting run.done when mode plan progress remains incomplete", async () => {
    const modeSpec = getModePreset(SINGLE_AGENT_MODE_ID)!;
    const definition = modeSpecToPatternDefinition(modeSpec);
    const definitionWithOrphanProgress = {
      ...definition,
      planTemplate: [
        ...definition.planTemplate,
        {
          id: "orphan",
          title: "Orphan mode progress",
          dependencies: [],
        },
      ],
    };
    const runId = "run-mode-progress-finalization";

    const { snapshot } = await executeRuntimeKernel(
      runId,
      { prompt: "Answer directly.", createdAt: 1, context: {} },
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
        deterministicSeed: "mode-progress-finalization",
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
        definition: definitionWithOrphanProgress,
      },
    );

    expect(snapshot.status).toBe("failed");
    expect(snapshot.error).toContain("Mode progress is incomplete");
    expect(snapshot.events.map((event) => event.type)).toContain("run.failed");
    expect(snapshot.events.map((event) => event.type)).not.toContain("run.done");
  });
});
