import { createModeSpecFromPattern, modeSpecToPatternDefinition, type BusStats, type QueueSummary, type RunConfig, type SharedStateSummary } from "@cemeworm/shared";
import { describe, expect, it, vi } from "vitest";
import { executeGeneratorVerifier } from "./generator-verifier-driver.js";
import type { PatternExecutionContext } from "./execution-context.js";

function createContext(prompts: string[]): PatternExecutionContext {
  const queueSummary: QueueSummary = { mode: "dag", pending: 0, inProgress: 0, completed: 0, topics: [] };
  const sharedStateSummary: SharedStateSummary = { enabled: false, storeKind: "none", version: 0, entries: [] };
  const busStats: BusStats = { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} };
  return {
    projectId: "test-project",
    queueSummary,
    sharedStateSummary,
    busStats,
    responseLanguage: () => "zh",
    systemPrompt: (extra) => extra,
    setPlanStatus: () => {},
    setQueueSummary: (patch) => Object.assign(queueSummary, patch),
    checkpointNode: () => {},
    runRecoverableNode: async (_params, execute) => ({ status: "completed", output: await execute() }),
    runDelegatedTask: async (_params, execute) => execute(),
    ensureClarification: async () => undefined,
    claimWorker: () => {},
    releaseWorker: () => {},
    agentLabel: (agentId) => agentId,
    callAgent: async ({ title, prompt }) => {
      prompts.push(prompt);
      if (title.includes("Research")) {
        return "Research context for initial draft.";
      }
      if (title.includes("Verify")) {
        return JSON.stringify({ verdict: "pass", rationale: "Looks good.", missingRequirements: [] });
      }
      return "Initial candidate output.";
    },
    remember: () => {},
    captureMemory: () => {},
    publishArtifact: () => {},
    publishMessage: () => {},
    routeMessage: () => {},
    emitAgentMessage: () => ({ id: `msg-${prompts.length}` }),
    writeSharedState: () => {},
    currentSharedState: () => sharedStateSummary,
  };
}

describe("executeGeneratorVerifier", () => {
  it("uses an initial draft fallback without retry-only placeholders", async () => {
    const prompts: string[] = [];
    const context = createContext(prompts);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const modeSpec = createModeSpecFromPattern("generator_verifier");
    const config: RunConfig = {
      pattern: "generator_verifier",
      modeSelection: "manual",
      profileIds: [],
      skillIds: [],
      toolIds: [],
      approvalMode: "auto",
      permissionMode: "auto_review",
      patternOptions: {},
      metadata: {},
      causalInterventionLevel: "record_only",
      deterministicSeed: "test-seed",
    };

    try {
      await executeGeneratorVerifier({
        context,
        prompt: "Draft a concise answer.",
        config,
        modeSpec,
        definition: modeSpecToPatternDefinition(modeSpec),
      });
    } finally {
      consoleError.mockRestore();
    }

    const draftPrompt = prompts.find((prompt) => prompt.includes("YOUR TASK: Produce the initial candidate"));
    expect(draftPrompt).toBeDefined();
    expect(draftPrompt).not.toContain("Previous candidate");
    expect(draftPrompt).not.toContain("Verifier feedback");
    expect(draftPrompt).not.toContain("UNRESOLVED");
    expect(consoleError).not.toHaveBeenCalledWith(expect.stringContaining("Unresolved mustache placeholder"));
  });
});
