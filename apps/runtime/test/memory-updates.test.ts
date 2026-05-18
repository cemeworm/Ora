import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RunConfigSchema, SINGLE_AGENT_MODE_ID, getModePreset, modeSpecToPatternDefinition, type StateSnapshot } from "@cemeworm/shared";
import { LongTermMemoryManager, FileLongTermMemoryStore, LongTermMemoryUpdateQueue } from "../src/memory.js";
import { processLongTermMemoryUpdate } from "../src/memory-updates.js";
import { ShortTermMemoryJournal } from "../src/memory-journal.js";
import { ScenarioStore } from "../src/memory-scenarios.js";

describe("processLongTermMemoryUpdate", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ora-memory-update-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("compiles scenarios after adding durable facts", async () => {
    const modeSpec = getModePreset(SINGLE_AGENT_MODE_ID)!;
    const definition = modeSpecToPatternDefinition(modeSpec);
    const longTermMemory = new LongTermMemoryManager(new FileLongTermMemoryStore(tempDir));
    const journal = new ShortTermMemoryJournal(tempDir);
    const scenarioStore = new ScenarioStore(tempDir);
    const queue = new LongTermMemoryUpdateQueue(async () => undefined);
    const snapshot = {
      runId: "run-memory-update",
      sessionId: "session-memory-update",
      status: "succeeded",
      pattern: definition.coordinationKind,
      modeId: SINGLE_AGENT_MODE_ID,
      topology: { nodes: [], edges: [] },
      profiles: [],
      input: { prompt: "remember these preferences", createdAt: 1, context: {} },
      config: RunConfigSchema.parse({
        pattern: definition.coordinationKind,
        modeId: SINGLE_AGENT_MODE_ID,
        providerId: "test-provider",
        metadata: {},
      }),
      memory: [],
      plan: [],
      planList: [],
      todos: [],
      actions: [],
      toolCalls: [],
      continuation: { frames: [] },
      conversation: [],
      toolResults: [],
      policyDecisions: [],
      checkpoints: [],
      events: [],
      agentMessages: [],
      childSessions: [],
      artifacts: [],
      activeAgents: [],
      queueSummary: { mode: "dag", pending: 0, inProgress: 0, completed: 0, topics: [] },
      sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
      busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
      pendingClarifications: [],
      pendingApprovals: [],
      output: "done",
      updatedAt: 1_000,
    } as unknown as StateSnapshot;

    await processLongTermMemoryUpdate({
      snapshot,
      assistantText: "",
      conversationMessages: [
        { role: "user", content: "Remember that I prefer pnpm for workspace installs." },
        { role: "assistant", content: "Okay." },
        { role: "user", content: "Also remember that I prefer pnpm filter commands for package-scoped work." },
      ],
      policy: {
        ...modeSpec.memoryPolicy,
        enabled: true,
        updater: "provider",
        factConfidenceThreshold: 0.7,
        maxFacts: 120,
      },
      invokeModel: async () => JSON.stringify({
        user: {},
        history: {},
        newFacts: [
          { content: "User prefers pnpm for workspace installs.", category: "preference", confidence: 0.92 },
          { content: "User prefers pnpm filter commands for package-scoped work.", category: "preference", confidence: 0.9 },
        ],
        factsToRemove: [],
      }),
    }, {
      longTermMemory,
      longTermMemoryQueue: queue,
      journal,
      scenarioStore,
      modeSelectionDeps: () => ({
        modeStore: { resolve: () => modeSpec } as never,
        skillRegistry: {} as never,
        longTermMemory,
        applySystemAgentOverridesToMode: (input) => input,
        buildConversationMessages: () => [],
      }),
      buildConversationMessages: () => [],
      getCachedRun: () => snapshot,
      appendEvent: (current) => current,
      cacheRun: () => undefined,
    });

    expect(longTermMemory.get().facts).toHaveLength(2);
    expect(scenarioStore.listCandidates().some((candidate) => candidate.content.includes("pnpm"))).toBe(true);
  });
});
