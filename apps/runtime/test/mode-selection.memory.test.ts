import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LongTermMemoryProfileSchema,
  RunConfigSchema,
  SINGLE_AGENT_MODE_ID,
  getModePreset,
  type ModeSpec,
} from "@cemeworm/shared";
import { FileLongTermMemoryStore, LongTermMemoryManager } from "../src/memory.js";
import { withMemoryPrompt, type ModeSelectionDeps } from "../src/mode-selection.js";
import { invokeRunProvider } from "../src/providers/index.js";

vi.mock("../src/providers/index.js", async () => {
  const actual = await vi.importActual("../src/providers/index.js");
  return {
    ...actual,
    invokeRunProvider: vi.fn(),
  };
});

const mockedInvokeRunProvider = vi.mocked(invokeRunProvider);

describe("withMemoryPrompt provider admission", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ora-mode-selection-memory-"));
    mockedInvokeRunProvider.mockReset();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("uses provider admission to inject semantically relevant identity memory", async () => {
    const memory = new LongTermMemoryManager(new FileLongTermMemoryStore(tempDir));
    memory.saveProfile(LongTermMemoryProfileSchema.parse({
      lastUpdated: "2026-05-18T00:00:00.000Z",
      user: {
        personalContext: {
          summary: "User's name is QC.",
          updatedAt: "2026-05-18T00:00:00.000Z",
        },
      },
      facts: [],
    }));

    mockedInvokeRunProvider.mockResolvedValue({
      providerId: "test-provider",
      providerType: "openai_compatible",
      modelId: "test-model",
      text: JSON.stringify({
        selectedIds: ["section:user.personalContext"],
        reason: "The user is asking for their identity, and the stored personal context directly answers it.",
        rejectedIds: ["section:user.workContext"],
        uncertainty: 0.05,
        result: "USE",
      }),
      raw: {},
    });

    const config = RunConfigSchema.parse({
      pattern: "single_agent",
      modeId: SINGLE_AGENT_MODE_ID,
      profileIds: [],
      skillIds: [],
      toolIds: [],
      modelRef: "test-model",
      providerId: "test-provider",
      approvalMode: "high_risk_only",
      patternOptions: {},
      metadata: {},
      deterministicSeed: "test-seed",
    });

    const result = await withMemoryPrompt(
      config,
      { prompt: "我是谁？", context: {}, createdAt: Date.now() },
      undefined,
      createDeps(memory, "provider"),
    );

    const activeMemory = result.metadata.activeMemory as {
      decision?: { mode?: string; status?: string; selectedIds?: string[] };
      cards?: Array<{ content?: string }>;
    };

    expect(mockedInvokeRunProvider).toHaveBeenCalledTimes(1);
    expect(activeMemory.decision?.mode).toBe("provider");
    expect(activeMemory.decision?.status).toBe("USE");
    expect(activeMemory.decision?.selectedIds).toContain("section:user.personalContext");
    expect(String(result.metadata.memoryPromptOverlay)).toContain("QC");
  });

  it("falls back to deterministic admission when provider_fallback is enabled and provider admission fails", async () => {
    const memory = new LongTermMemoryManager(new FileLongTermMemoryStore(tempDir));
    memory.saveProfile(LongTermMemoryProfileSchema.parse({
      lastUpdated: "2026-05-18T00:00:00.000Z",
      user: {
        personalContext: {
          summary: "User's name is QC.",
          updatedAt: "2026-05-18T00:00:00.000Z",
        },
      },
      facts: [],
    }));

    mockedInvokeRunProvider.mockRejectedValue(new Error("provider unavailable"));

    const config = RunConfigSchema.parse({
      pattern: "single_agent",
      modeId: SINGLE_AGENT_MODE_ID,
      profileIds: [],
      skillIds: [],
      toolIds: [],
      modelRef: "test-model",
      providerId: "test-provider",
      approvalMode: "high_risk_only",
      patternOptions: {},
      metadata: {},
      deterministicSeed: "test-seed",
    });

    const result = await withMemoryPrompt(
      config,
      { prompt: "我是谁？", context: {}, createdAt: Date.now() },
      undefined,
      createDeps(memory, "provider_fallback"),
    );

    const activeMemory = result.metadata.activeMemory as {
      decision?: { mode?: string; status?: string; selectedIds?: string[]; reason?: string };
    };

    expect(mockedInvokeRunProvider).toHaveBeenCalledTimes(1);
    expect(activeMemory.decision?.mode).toBe("provider_fallback");
    expect(activeMemory.decision?.status).toBe("NONE");
    expect(activeMemory.decision?.selectedIds).toEqual([]);
    expect(String(activeMemory.decision?.reason)).toContain("fell back to deterministic");
  });
});

function createDeps(
  longTermMemory: LongTermMemoryManager,
  admissionMode: "provider" | "provider_fallback",
): ModeSelectionDeps {
  const baseMode = getModePreset(SINGLE_AGENT_MODE_ID);
  if (!baseMode) {
    throw new Error("single_agent mode preset is unavailable");
  }
  const modeSpec: ModeSpec = {
    ...baseMode,
    runtimeAtoms: [...new Set([...baseMode.runtimeAtoms, "long_term_memory"])],
    memoryPolicy: {
      ...baseMode.memoryPolicy,
      enabled: true,
      admissionMode,
      injectionMaxFacts: 12,
    },
  };

  return {
    modeStore: {
      resolve: () => modeSpec,
    } as unknown as ModeSelectionDeps["modeStore"],
    skillRegistry: {} as ModeSelectionDeps["skillRegistry"],
    longTermMemory,
    applySystemAgentOverridesToMode: (input) => input,
    buildConversationMessages: () => [],
  };
}
