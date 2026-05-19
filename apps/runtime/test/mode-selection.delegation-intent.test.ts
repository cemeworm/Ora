import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  RunConfigSchema,
  SessionSummary,
  SINGLE_AGENT_MODE_ID,
  getModePreset,
  type ModeSpec,
} from "@cemeworm/shared";
import { FileLongTermMemoryStore, LongTermMemoryManager } from "../src/memory.js";
import { resolveModeSelection, type ModeSelectionDeps } from "../src/mode-selection.js";

describe("resolveModeSelection delegation intent", () => {
  let tempDir: string;
  let previousFetch: typeof globalThis.fetch | undefined;
  let previousKey: string | undefined;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ora-mode-selection-delegation-"));
    previousFetch = globalThis.fetch;
    previousKey = process.env.DELEGATION_INTENT_KEY;
    process.env.DELEGATION_INTENT_KEY = "test";
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    globalThis.fetch = previousFetch as typeof fetch;
    if (previousKey === undefined) {
      delete process.env.DELEGATION_INTENT_KEY;
    } else {
      process.env.DELEGATION_INTENT_KEY = previousKey;
    }
  });

  it("keeps single_agent mode but derives a degraded collaboration requirement for explicit Agent Teams requests", async () => {
    globalThis.fetch = (() => {
      throw new Error("Explicit Agent Teams requests should be handled without provider classification.");
    }) as typeof fetch;

    const { modeSpec, fullConfig } = await resolveModeSelection(
      baseConfig(),
      {
        prompt: "你通过 Agent team 的方式帮我研究一下 minimax 这家公司的近况",
        context: {},
        createdAt: Date.now(),
      },
      undefined,
      createDeps(tempDir),
    );

    expect(modeSpec.id).toBe(SINGLE_AGENT_MODE_ID);
    expect(fullConfig.modeId).toBe(SINGLE_AGENT_MODE_ID);
    expect(fullConfig.metadata.delegationIntent).toMatchObject({
      requestedByUser: true,
      preference: "prefer",
      source: "explicit_team_collab",
    });
    expect(fullConfig.metadata.modeRequest).toMatchObject({
      requestedModeId: "agent_teams",
      source: "rule_based",
    });
    expect(fullConfig.metadata.delegationClassifier).toMatchObject({
      status: "rule_based",
      preference: "prefer",
      confidence: 1,
    });
    expect(fullConfig.effectiveStrategy).toMatchObject({
      delegation: "preferred",
      delegationEnabled: true,
      collaborationRequirement: "required",
      collaborationRequirementSource: "explicit_mode_degraded",
      delegationRequestedByUser: true,
      requestedModeId: "agent_teams",
    });
  });

  it("records rule-based none intent when the user explicitly asks to avoid sub-agents", async () => {
    globalThis.fetch = (() => {
      throw new Error("Explicit no-delegation requests should be handled without provider classification.");
    }) as typeof fetch;

    const { fullConfig } = await resolveModeSelection(
      baseConfig(),
      {
        prompt: "不要开子智能体，你自己回答这个问题",
        context: {},
        createdAt: Date.now(),
      },
      undefined,
      createDeps(tempDir),
    );

    expect(fullConfig.metadata.delegationIntent).toMatchObject({
      requestedByUser: true,
      preference: "none",
      source: "explicit_no_delegation",
    });
    expect(fullConfig.metadata.delegationClassifier).toMatchObject({
      status: "rule_based",
      preference: "none",
      confidence: 1,
    });
  });

  it("omits delegationIntent when the classifier returns invalid JSON", async () => {
    globalThis.fetch = mockClassifierFetch("not valid json");

    const { fullConfig } = await resolveModeSelection(
      baseConfig(),
      {
        prompt: "你可以判断一下这题需不需要团队协作",
        context: {},
        createdAt: Date.now(),
      },
      undefined,
      createDeps(tempDir),
    );

    expect(fullConfig.metadata.delegationIntent).toBeUndefined();
    expect(fullConfig.metadata.delegationClassifier).toMatchObject({
      status: "fallback",
      confidence: 0,
    });
  });

  it("omits delegationIntent when the classifier returns a non-none preference without explicit user intent", async () => {
    globalThis.fetch = mockClassifierFetch(JSON.stringify({
      requestedByUser: false,
      preference: "prefer",
      confidence: 0.82,
      reason: "This task would benefit from team work.",
    }));

    const { fullConfig } = await resolveModeSelection(
      baseConfig(),
      {
        prompt: "帮我处理这个任务",
        context: {},
        createdAt: Date.now(),
      },
      undefined,
      createDeps(tempDir),
    );

    expect(fullConfig.metadata.delegationIntent).toBeUndefined();
    expect(fullConfig.metadata.delegationClassifier).toMatchObject({
      status: "fallback",
      confidence: 0,
    });
    expect(String((fullConfig.metadata.delegationClassifier as Record<string, unknown>).error ?? "")).toContain(
      "without explicit user intent",
    );
  });

  it("routes auto mode directly to agent_teams for explicit Agent Teams requests", async () => {
    let routerPrompt: { recentMessages?: Array<{ role: string; content: string }> } | undefined;
    let delegationPrompt: { recentMessages?: Array<{ role: string; content: string }> } | undefined;
    globalThis.fetch = (async (_input, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        messages?: Array<{ role: string; content?: string }>;
      };
      const systemText = body.messages
        ?.filter((message) => message.role === "system")
        .map((message) => message.content ?? "")
        .join("\n") ?? "";
      const promptText = body.messages?.find((message) => message.role === "user")?.content ?? "{}";
      if (systemText.includes("agent mode router")) {
        routerPrompt = JSON.parse(promptText) as typeof routerPrompt;
        return new Response(JSON.stringify({
          choices: [{ message: { role: "assistant", content: JSON.stringify({
            modeId: SINGLE_AGENT_MODE_ID,
            taskIntent: "implement",
            confidence: 0.91,
            reason: "This task can stay in a simple single-agent mode.",
          }) } }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (systemText.includes("delegation intent classifier")) {
        delegationPrompt = JSON.parse(promptText) as typeof delegationPrompt;
        return new Response(JSON.stringify({
          choices: [{ message: { role: "assistant", content: JSON.stringify({
            requestedByUser: true,
            preference: "prefer",
            confidence: 0.89,
            reason: "The user explicitly asked for coordinated team work.",
          }) } }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      throw new Error(`Unexpected provider call: ${systemText}`);
    }) as typeof fetch;

    const alternateMode = {
      ...getModePreset(SINGLE_AGENT_MODE_ID)!,
      id: "single-agent-alt",
      label: "Single Agent Alt",
      summary: "Alternative candidate for auto mode tests.",
      recommendedUse: "Use when a slightly different candidate is needed for tests.",
      failureMode: "May be redundant with the primary single-agent preset.",
    };
    const agentTeamsMode = {
      ...getModePreset(SINGLE_AGENT_MODE_ID)!,
      id: "agent_teams",
      family: "agent_teams" as const,
      label: "Agent Teams",
      summary: "Persistent teammate agents coordinate around a shared backlog and memory.",
      recommendedUse: "Use when long-running workers need identity and context across tasks.",
      failureMode: "Unclear ownership can create duplicate work or stale worker memory.",
      defaultBudget: { ...getModePreset(SINGLE_AGENT_MODE_ID)!.defaultBudget },
      capabilityFlags: {
        ...getModePreset(SINGLE_AGENT_MODE_ID)!.capabilityFlags,
        supportsPersistentWorkers: true,
        toolIds: ["agent.spawn", ...getModePreset(SINGLE_AGENT_MODE_ID)!.capabilityFlags.toolIds],
      },
    };

    const { fullConfig } = await resolveModeSelection(
      RunConfigSchema.parse({
        pattern: "orchestrator_subagent",
        modeSelection: "auto",
        providerId: "delegation-intent-provider",
        modelRef: "delegation-intent-model",
        providerConfig: {
          id: "delegation-intent-provider",
          label: "Delegation Intent Provider",
          type: "openai_compatible",
          modelId: "delegation-intent-model",
          baseUrl: "https://delegation-intent.test/v1",
          apiKeyEnv: "DELEGATION_INTENT_KEY",
          capabilities: ["chat"],
          headers: {},
        },
        metadata: { taskIntentMode: "auto" },
      }),
      {
        prompt: "通过 Agent Teams 模式来做这件事。",
        context: {
          recentMessages: [
            { role: "user", content: "Earlier we discussed a quick one-off edit." },
            { role: "assistant", content: "A single agent would be enough for that earlier request." },
          ],
        },
        createdAt: Date.now(),
      },
      { sessionId: "session-auto" } as SessionSummary,
      createDeps(tempDir, {
        modes: [getModePreset(SINGLE_AGENT_MODE_ID)!, agentTeamsMode, alternateMode],
        buildConversationMessages: () => [{ role: "user", content: "通过 Agent Teams 模式来做这件事。" }],
      }),
    );

    expect(fullConfig.metadata.autoModeRouter).toMatchObject({
      selectedModeId: "agent_teams",
      selectedTaskIntent: "plan",
      status: "selected",
    });
    expect(fullConfig.modeId).toBe("agent_teams");
    expect(fullConfig.metadata.delegationIntent).toMatchObject({
      requestedByUser: true,
      preference: "prefer",
      source: "explicit_team_collab",
    });
    expect(fullConfig.effectiveStrategy).toMatchObject({
      sourceModeId: "agent_teams",
      delegation: "preferred",
      delegationEnabled: true,
      collaborationRequirement: "none",
      delegationRequestedByUser: true,
      requestedModeId: "agent_teams",
    });
    expect(routerPrompt).toBeUndefined();
    expect(delegationPrompt).toBeUndefined();
  });
});

function baseConfig() {
  return {
    pattern: "orchestrator_subagent",
    modeId: SINGLE_AGENT_MODE_ID,
    modeSelection: "manual",
    providerId: "delegation-intent-provider",
    modelRef: "delegation-intent-model",
    providerConfig: {
      id: "delegation-intent-provider",
      label: "Delegation Intent Provider",
      type: "openai_compatible",
      modelId: "delegation-intent-model",
      baseUrl: "https://delegation-intent.test/v1",
      apiKeyEnv: "DELEGATION_INTENT_KEY",
      capabilities: ["chat"],
      headers: {},
    },
    metadata: {},
  };
}

function mockClassifierFetch(content: string): typeof fetch {
  return (async (_input, init) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as {
      messages?: Array<{ role: string; content?: string }>;
    };
    const systemText = body.messages
      ?.filter((message) => message.role === "system")
      .map((message) => message.content ?? "")
      .join("\n") ?? "";
    expect(systemText).toContain("delegation intent classifier");
    return new Response(JSON.stringify({
      choices: [{ message: { role: "assistant", content } }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

function createDeps(
  tempDir: string,
  overrides: {
    modes?: ModeSpec[];
    buildConversationMessages?: ModeSelectionDeps["buildConversationMessages"];
  } = {},
): ModeSelectionDeps {
  const baseMode = getModePreset(SINGLE_AGENT_MODE_ID);
  if (!baseMode) {
    throw new Error("single_agent mode preset is unavailable");
  }
  const modes = (overrides.modes ?? [baseMode]).map((mode) => ({ ...mode }));
  const modesById = new Map(modes.map((mode) => [mode.id, mode]));

  return {
    modeStore: {
      resolve: (modeId: string) => {
        const resolved = modesById.get(modeId);
        if (!resolved) {
          throw new Error(`Mode '${modeId}' not found in test deps.`);
        }
        return resolved;
      },
      list: () => modes,
    } as unknown as ModeSelectionDeps["modeStore"],
    skillRegistry: {
      warnings: () => [],
      promptSnippets: () => [],
    } as unknown as ModeSelectionDeps["skillRegistry"],
    longTermMemory: new LongTermMemoryManager(new FileLongTermMemoryStore(tempDir)),
    applySystemAgentOverridesToMode: (input) => input,
    buildConversationMessages: overrides.buildConversationMessages ?? (() => []),
  };
}
