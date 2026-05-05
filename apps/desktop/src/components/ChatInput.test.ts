import { describe, expect, it } from "vitest";
import { getComposerTrayVisibility, getContextRingState } from "./ChatInput";

describe("chat input tray visibility", () => {
  it("prioritizes clarification over plan decision", () => {
    expect(getComposerTrayVisibility({
      isLoading: false,
      clarificationCount: 2,
      canSubmitClarifications: true,
      hasPlanDecision: true,
      canResolvePlanDecision: true,
    })).toEqual({
      showClarificationTray: true,
      showPlanDecisionTray: false,
      hideComposer: true,
    });
  });

  it("shows plan decision after clarifications are resolved", () => {
    expect(getComposerTrayVisibility({
      isLoading: false,
      clarificationCount: 0,
      canSubmitClarifications: true,
      hasPlanDecision: true,
      canResolvePlanDecision: true,
    })).toEqual({
      showClarificationTray: false,
      showPlanDecisionTray: true,
      hideComposer: true,
    });
  });

  it("keeps the composer available for ordinary clarification resumes", () => {
    expect(getComposerTrayVisibility({
      isLoading: false,
      clarificationCount: 1,
      canSubmitClarifications: true,
      hasPlanDecision: false,
      canResolvePlanDecision: false,
    })).toEqual({
      showClarificationTray: true,
      showPlanDecisionTray: false,
      hideComposer: false,
    });
  });
});

describe("chat input context ring", () => {
  it("uses session context window and token usage when context state is available", () => {
    expect(getContextRingState({
      contextState: {
        activeTokenUsage: {
          inputTokens: 400,
          outputTokens: 100,
          totalTokens: 500,
          source: "estimate",
        },
        contextWindow: 1_000,
        compactedHistory: [],
        compactedThroughTurnIndex: 0,
        compactionCount: 0,
      },
      activeProvider: {
        id: "provider-1",
        type: "openai",
        label: "Provider",
        modelId: "model-1",
        contextWindow: 2_000,
      } as any,
    })).toMatchObject({
      contextWindow: 1_000,
      activeTokens: 500,
      showContextRing: true,
      contextPct: 0.5,
    });
  });

  it("shows an empty ring when only the provider context window is available", () => {
    expect(getContextRingState({
      activeProvider: {
        id: "provider-1",
        type: "openai",
        label: "Provider",
        modelId: "model-1",
        contextWindow: 2_000,
      } as any,
    })).toMatchObject({
      contextWindow: 2_000,
      activeTokens: 0,
      showContextRing: true,
      contextPct: 0,
    });
  });

  it("infers a ring window for saved DeepSeek v4 providers without explicit context metadata", () => {
    expect(getContextRingState({
      activeProvider: {
        id: "deepseek",
        type: "openai_compatible",
        label: "DeepSeek",
        modelId: "deepseek-v4-pro",
        baseUrl: "https://api.deepseek.com",
      } as any,
    })).toMatchObject({
      contextWindow: 1_048_576,
      activeTokens: 0,
      showContextRing: true,
      contextPct: 0,
    });
  });

  it("still prefers explicit context metadata over inferred provider defaults", () => {
    expect(getContextRingState({
      activeProvider: {
        id: "deepseek",
        type: "openai_compatible",
        label: "DeepSeek",
        modelId: "deepseek-v4-pro",
        baseUrl: "https://api.deepseek.com",
        contextWindow: 128_000,
      } as any,
    }).contextWindow).toBe(128_000);
  });

  it("does not show a ring without any context window", () => {
    expect(getContextRingState({
      activeProvider: {
        id: "provider-1",
        type: "openai",
        label: "Provider",
        modelId: "model-1",
      } as any,
    })).toMatchObject({
      contextWindow: undefined,
      activeTokens: 0,
      showContextRing: false,
      contextPct: 0,
    });
  });

  it("clamps the context percentage at full usage", () => {
    expect(getContextRingState({
      contextState: {
        activeTokenUsage: {
          inputTokens: 1_200,
          outputTokens: 100,
          totalTokens: 1_300,
          source: "estimate",
        },
        contextWindow: 1_000,
        compactedHistory: [],
        compactedThroughTurnIndex: 0,
        compactionCount: 0,
      },
    }).contextPct).toBe(1);
  });
});
