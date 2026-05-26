import { describe, it, expect } from "vitest";
import {
  activeUsageForMessages,
  compactedContextFromSummary,
  shouldCompactContext,
  normalizeContextState,
  resolveAutoCompactTokenLimit,
  resolvedContextWindow,
} from "./context-manager.js";
import type { ModelMessage } from "./providers/index.js";

function makeMessage(role: string, content: string): ModelMessage {
  return { role, content } as ModelMessage;
}

function sessionCtxWithActiveUsage(totalTokens: number) {
  return normalizeContextState({
    activeTokenUsage: {
      inputTokens: totalTokens,
      outputTokens: 0,
      totalTokens,
      source: "estimate",
    },
    contextWindow: 128_000,
    autoCompactTokenLimit: 115_200,
    compactedHistory: [],
    compactedThroughTurnIndex: 0,
    compactionCount: 0,
  });
}

describe("activeUsageForMessages", () => {
  it("splits input/output tokens by role", () => {
    const messages: ModelMessage[] = [
      makeMessage("user", "hello"),
      makeMessage("assistant", "hi there how can i help"),
      makeMessage("user", "explain context window in detail"),
      makeMessage("assistant", "a context window is..."),
    ];
    const usage = activeUsageForMessages(messages);
    expect(usage.outputTokens).toBeGreaterThan(0);
    expect(usage.inputTokens).toBeGreaterThan(0);
    expect(usage.totalTokens).toBe(usage.inputTokens + usage.outputTokens);
  });

  it("returns zero outputTokens for user-only messages", () => {
    const messages: ModelMessage[] = [
      makeMessage("user", "hello"),
      makeMessage("user", "anyone there?"),
    ];
    const usage = activeUsageForMessages(messages);
    expect(usage.outputTokens).toBe(0);
    expect(usage.inputTokens).toBeGreaterThan(0);
  });

  it("counts assistant reasoningContent as outputTokens", () => {
    const messages: ModelMessage[] = [
      makeMessage("user", "question"),
      { role: "assistant", content: "answer", reasoningContent: "thinking..." } as ModelMessage,
    ];
    const usage = activeUsageForMessages(messages);
    expect(usage.outputTokens).toBeGreaterThan(0);
  });

  it("counts tool role messages as inputTokens", () => {
    const messages: ModelMessage[] = [
      makeMessage("user", "do something"),
      makeMessage("assistant", ""),
      { role: "tool", content: "result" } as ModelMessage,
    ];
    const usage = activeUsageForMessages(messages);
    expect(usage.inputTokens).toBeGreaterThan(0);
  });
});

describe("shouldCompactContext", () => {
  it("uses estimated value directly, not max with current", () => {
    const current = sessionCtxWithActiveUsage(120_000);
    const messages: ModelMessage[] = [makeMessage("user", "short prompt")];
    const result = shouldCompactContext({
      contextState: current,
      provider: { id: "test", contextWindow: 128_000 },
      messages,
    });
    // After compaction, messages are small => usage should reflect actual message size
    expect(result.usage.totalTokens).toBeLessThan(120_000);
  });

  it("reports correct shouldCompact and usage", () => {
    const messages: ModelMessage[] = [
      makeMessage("user", "a".repeat(1000)),
    ];
    const result = shouldCompactContext({
      contextState: sessionCtxWithActiveUsage(0),
      provider: { id: "test", contextWindow: 10_000 },
      messages,
    });
    expect(result.shouldCompact).toBe(false);
    expect(result.usage.totalTokens).toBeGreaterThan(0);
  });
});

describe("compactedContextFromSummary", () => {
  it("preserves pre-compaction activeTokenUsage from previousState", () => {
    const previousState = sessionCtxWithActiveUsage(120_000);
    const result = compactedContextFromSummary({
      summary: "test summary",
      phase: "pre_turn",
      beforeTokens: 120_000,
      limit: 115_200,
      contextWindow: 128_000,
      previousState,
      compactedThroughTurnIndex: 5,
      now: Date.now(),
    });
    // activeTokenUsage should NOT be reset to the summary's small token count
    expect(result.contextState.activeTokenUsage.totalTokens).toBe(120_000);
  });

  it("records lastCompaction with correct beforeTokens and afterTokens", () => {
    const previousState = sessionCtxWithActiveUsage(120_000);
    const result = compactedContextFromSummary({
      summary: "test summary",
      phase: "pre_turn",
      beforeTokens: 120_000,
      limit: 115_200,
      contextWindow: 128_000,
      previousState,
      compactedThroughTurnIndex: 5,
      now: Date.now(),
    });
    expect(result.contextState.lastCompaction).toBeDefined();
    expect(result.contextState.lastCompaction!.beforeTokens).toBe(120_000);
    expect(result.contextState.lastCompaction!.afterTokens).toBeGreaterThan(0);
    expect(result.contextState.lastCompaction!.afterTokens).toBeLessThan(120_000);
  });

  it("increments compactionCount", () => {
    const previousState = sessionCtxWithActiveUsage(100_000);
    const result = compactedContextFromSummary({
      summary: "test",
      phase: "pre_turn",
      beforeTokens: 100_000,
      limit: 90_000,
      contextWindow: 100_000,
      previousState,
      compactedThroughTurnIndex: 3,
      now: Date.now(),
    });
    expect(result.contextState.compactionCount).toBe(1);
  });
});
