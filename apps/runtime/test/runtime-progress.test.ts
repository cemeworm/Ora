import type { RunConfig } from "@ora/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

let providerText = "";
let capturedSystem = "";

vi.mock("../src/providers/index.js", async () => {
  const actual = await vi.importActual<typeof import("../src/providers/index.js")>(
    "../src/providers/index.js",
  );

  return {
    ...actual,
    invokeRunProvider: vi.fn(async (config, request) => {
      capturedSystem = request.system ?? "";
      return {
        providerId: config.providerId ?? "mock-provider",
        providerType: "local_smoke",
        modelId: config.modelRef ?? "mock-model",
        text: providerText,
        raw: {},
      };
    }),
  };
});

import { emitRuntimeProgressNarration } from "../src/harness/runtime-progress.js";

function runConfig(): RunConfig {
  return {
    pattern: "orchestrator_subagent",
    modeId: "single_agent",
    modeSelection: "manual",
    profileIds: ["solo_agent"],
    skillIds: [],
    toolIds: [],
    modelRef: "mock-model",
    budget: {
      maxTokens: 1000,
      maxToolCalls: 8,
      maxRuntimeMs: 60_000,
      maxCostUsd: 1,
    },
    approvalMode: "high_risk_only",
    patternOptions: {},
    metadata: {
      progressNarration: true,
    },
  };
}

describe("runtime progress narration", () => {
  beforeEach(() => {
    providerText = "";
    capturedSystem = "";
  });

  it("does not emit incomplete progress narration", async () => {
    providerText = "正在读取该文件夹的内容，已列出其中包含的5个技能，接下来准备逐一";
    const emitted: unknown[] = [];

    await emitRuntimeProgressNarration(
      { trigger: "tool.called", agentId: "solo_agent", nodeId: "solo_agent" },
      {
        config: runConfig(),
        userPrompt: "安装这些 skills",
        events: [
          {
            id: "event-1",
            runId: "run-1",
            seq: 1,
            type: "tool.called",
            createdAt: 1,
            pattern: "orchestrator_subagent",
            payload: {
              toolId: "file.list",
              output: {
                path: ".agents/skills",
              },
            },
          },
        ],
        activeAgentCount: () => 1,
        planStatuses: () => ["running"],
        todoStatuses: () => ["running"],
        emit: (type, payload, extra) => {
          const event = { type, payload, extra };
          emitted.push(event);
          return event as never;
        },
      },
    );

    expect(capturedSystem).toContain("one complete natural sentence");
    expect(emitted).toEqual([]);
  });
});
