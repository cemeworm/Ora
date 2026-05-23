import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LongTermMemoryProfileSchema,
  RunConfigSchema,
  type RunConfig,
  SINGLE_AGENT_MODE_ID,
  getModePreset,
  type ModeSpec,
} from "@cemeworm/shared";
import type { ModelMessage } from "../src/providers/index.js";
import { FileLongTermMemoryStore, LongTermMemoryManager } from "../src/memory.js";
import { ScenarioStore } from "../src/memory-scenarios.js";
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

  it("keeps provider_fallback observational-only when provider admission fails", async () => {
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
    expect(String(activeMemory.decision?.reason)).toContain("no memory cards were admitted");
    expect(result.metadata.memoryPromptOverlay).toBeUndefined();
  });

  it("injects scenario candidates into active memory and exposes observability metadata", async () => {
    const memory = new LongTermMemoryManager(new FileLongTermMemoryStore(tempDir));
    const scenarios = new ScenarioStore(tempDir);
    scenarios.upsert({
      title: "pnpm monorepo workflow",
      summary: "Use pnpm for workspace installs and prefer filtered commands for package-scoped work.",
      category: "workflow",
      confidence: 0.91,
      sourceFactIds: ["fact_pnpm"],
      sourceRunIds: ["run_pnpm_1"],
    });

    const config = RunConfigSchema.parse({
      pattern: "single_agent",
      modeId: SINGLE_AGENT_MODE_ID,
      profileIds: [],
      skillIds: [],
      toolIds: [],
      approvalMode: "high_risk_only",
      patternOptions: {},
      metadata: {},
      deterministicSeed: "test-seed",
    });

    const result = await withMemoryPrompt(
      config,
      { prompt: "继续这个 pnpm workspace 改动，按之前的工作流来。", context: {}, createdAt: Date.now() },
      undefined,
      createDeps(memory, "deterministic", scenarios),
    );

    const activeMemory = result.metadata.activeMemory as {
      cards?: Array<{ id?: string; kind?: string; content?: string }>;
    };
    const activeMemorySummary = result.metadata.activeMemorySummary as {
      summaryLine?: string;
    };
    const memoryHealthSnapshot = result.metadata.memoryHealthSnapshot as {
      trace?: { totalItems?: number };
    };

    expect(activeMemory.cards?.some((card) => card.kind === "scenario" && String(card.id).includes("scenario_"))).toBe(true);
    expect(String(result.metadata.memoryPromptOverlay)).toContain("pnpm monorepo workflow");
    expect(typeof activeMemorySummary.summaryLine).toBe("string");
    expect(memoryHealthSnapshot.trace?.totalItems).toBeTypeOf("number");
  });

  it("honors evaluationMemoryMode=disabled and skips memory injection", async () => {
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

    const config = RunConfigSchema.parse({
      pattern: "single_agent",
      modeId: SINGLE_AGENT_MODE_ID,
      profileIds: [],
      skillIds: [],
      toolIds: [],
      approvalMode: "high_risk_only",
      patternOptions: {},
      metadata: {
        evaluationMemoryMode: "disabled",
      },
      deterministicSeed: "test-seed",
    });

    const result = await withMemoryPrompt(
      config,
      { prompt: "继续沿用之前的用户偏好。", context: {}, createdAt: Date.now() },
      undefined,
      createDeps(memory, "provider"),
    );

    expect(mockedInvokeRunProvider).not.toHaveBeenCalled();
    expect(result.metadata.memoryPromptOverlay).toBeUndefined();
    expect(result.metadata.activeMemory).toBeUndefined();
  });

  it("honors queryMode=message and skips session history loading", async () => {
    const memory = new LongTermMemoryManager(new FileLongTermMemoryStore(tempDir));
    memory.saveProfile(LongTermMemoryProfileSchema.parse({
      lastUpdated: "2026-05-18T00:00:00.000Z",
      user: {
        workContext: {
          summary: "User is modifying the Ora runtime memory system.",
          updatedAt: "2026-05-18T00:00:00.000Z",
        },
      },
      facts: [],
    }));

    const buildConversationMessages = vi.fn<() => ModelMessage[]>(() => [
      { role: "user", content: "历史消息" },
    ]);
    const buildRecentConversationMessages = vi.fn<() => ModelMessage[]>(() => [
      { role: "user", content: "最近消息" },
    ]);

    const result = await withMemoryPrompt(
      testConfig(),
      { prompt: "继续修 memory queryMode。", context: {}, createdAt: Date.now() },
      testSession("session-1", "Test Session"),
      createDeps(memory, "deterministic", undefined, {
        queryMode: "message",
        buildConversationMessages,
        buildRecentConversationMessages,
      }),
    );

    expect(buildConversationMessages).not.toHaveBeenCalled();
    expect(buildRecentConversationMessages).not.toHaveBeenCalled();
    expect(String(result.metadata.memoryPromptOverlay)).toContain("Ora runtime memory system");
  });

  it("honors queryMode=recent and prefers bounded recent history", async () => {
    const memory = new LongTermMemoryManager(new FileLongTermMemoryStore(tempDir));
    memory.saveProfile(LongTermMemoryProfileSchema.parse({
      lastUpdated: "2026-05-18T00:00:00.000Z",
      user: {
        workContext: {
          summary: "Use the Ora memory workflow for runtime changes.",
          updatedAt: "2026-05-18T00:00:00.000Z",
        },
      },
      facts: [],
    }));

    const buildConversationMessages = vi.fn<() => ModelMessage[]>(() => [
      { role: "user", content: "全量历史" },
    ]);
    const buildRecentConversationMessages = vi.fn((sessionId: string, currentPrompt: string, maxMessages: number): ModelMessage[] => [
      { role: "user", content: `${sessionId}:${currentPrompt}:${maxMessages}` },
    ]);

    await withMemoryPrompt(
      testConfig(),
      { prompt: "沿用刚才的 runtime memory workflow。", context: {}, createdAt: Date.now() },
      testSession("session-2", "Recent Session"),
      createDeps(memory, "deterministic", undefined, {
        queryMode: "recent",
        buildConversationMessages,
        buildRecentConversationMessages,
      }),
    );

    expect(buildRecentConversationMessages).toHaveBeenCalledTimes(1);
    expect(buildRecentConversationMessages).toHaveBeenCalledWith("session-2", "沿用刚才的 runtime memory workflow。", 6);
    expect(buildConversationMessages).not.toHaveBeenCalled();
  });
});

function createDeps(
  longTermMemory: LongTermMemoryManager,
  admissionMode: "deterministic" | "provider" | "provider_fallback",
  scenarioStore?: ScenarioStore,
  overrides?: {
    queryMode?: "message" | "recent" | "full";
    buildConversationMessages?: () => ModelMessage[];
    buildRecentConversationMessages?: (sessionId: string, currentPrompt: string, maxMessages: number) => ModelMessage[];
  },
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
      queryMode: overrides?.queryMode ?? baseMode.memoryPolicy.queryMode,
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
    buildConversationMessages: overrides?.buildConversationMessages ?? (() => []),
    buildRecentConversationMessages: overrides?.buildRecentConversationMessages,
    scenarioStore,
  };
}

function testConfig(): RunConfig {
  return RunConfigSchema.parse({
    pattern: "single_agent",
    modeId: SINGLE_AGENT_MODE_ID,
    profileIds: [],
    skillIds: [],
    toolIds: [],
    approvalMode: "high_risk_only",
    patternOptions: {},
    metadata: {},
    deterministicSeed: "test-seed",
  });
}

function testSession(sessionId: string, title: string) {
  const now = Date.now();
  return {
    sessionId,
    title,
    turnCount: 0,
    createdAt: now,
    updatedAt: now,
  };
}
