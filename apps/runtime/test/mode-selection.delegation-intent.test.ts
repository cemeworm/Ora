import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  RunConfigSchema,
  SINGLE_AGENT_MODE_ID,
  getModePreset,
  type ModeSpec,
} from "@cemeworm/shared";
import { FileLongTermMemoryStore, LongTermMemoryManager } from "../src/memory.js";
import { resolveModeSelection, type ModeSelectionDeps } from "../src/mode-selection.js";

describe("resolveModeSelection delegation intent", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ora-mode-selection-delegation-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("keeps single_agent mode but records prefer delegation intent for explicit team-collaboration requests", async () => {
    const { modeSpec, fullConfig } = await resolveModeSelection(
      RunConfigSchema.parse({
        pattern: "orchestrator_subagent",
        modeId: SINGLE_AGENT_MODE_ID,
        modeSelection: "manual",
        metadata: {},
      }),
      {
        prompt: "你通过Agent team的模式帮我研究一下minimax这家公司的近况",
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
  });

  it("records explicit no-delegation intent when the user asks to avoid sub-agents", async () => {
    const { fullConfig } = await resolveModeSelection(
      RunConfigSchema.parse({
        pattern: "orchestrator_subagent",
        modeId: SINGLE_AGENT_MODE_ID,
        modeSelection: "manual",
        metadata: {},
      }),
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
  });
});

function createDeps(tempDir: string): ModeSelectionDeps {
  const baseMode = getModePreset(SINGLE_AGENT_MODE_ID);
  if (!baseMode) {
    throw new Error("single_agent mode preset is unavailable");
  }
  const modeSpec: ModeSpec = { ...baseMode };

  return {
    modeStore: {
      resolve: () => modeSpec,
    } as unknown as ModeSelectionDeps["modeStore"],
    skillRegistry: {
      warnings: () => [],
      promptSnippets: () => [],
    } as unknown as ModeSelectionDeps["skillRegistry"],
    longTermMemory: new LongTermMemoryManager(new FileLongTermMemoryStore(tempDir)),
    applySystemAgentOverridesToMode: (input) => input,
    buildConversationMessages: () => [],
  };
}
