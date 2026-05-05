import { describe, expect, it } from "vitest";
import { getActiveChatProvider, getChatInputContextState } from "./ChatView";

describe("chat view provider selection", () => {
  it("uses the selected provider when it is available", () => {
    const providers = [
      { id: "provider-a", label: "Provider A" },
      { id: "provider-b", label: "Provider B" },
    ];

    expect(getActiveChatProvider(providers, "provider-b")).toBe(providers[1]);
  });

  it("falls back to the first runnable provider when the selected provider is unavailable", () => {
    const providers = [
      { id: "provider-a", label: "Provider A" },
      { id: "provider-b", label: "Provider B" },
    ];

    expect(getActiveChatProvider(providers, "local-smoke")).toBe(providers[0]);
  });
});

describe("chat view context state selection", () => {
  it("uses active snapshot context state first", () => {
    const activeContextState = contextState(500);
    const latestContextState = contextState(300);
    const sessionContextState = contextState(100);

    expect(getChatInputContextState({
      activeSnapshot: {
        contextState: activeContextState,
      } as any,
      activeSessionDetail: {
        latestSnapshot: {
          contextState: latestContextState,
        } as any,
        session: {
          contextState: sessionContextState,
        },
      },
    })).toBe(activeContextState);
  });

  it("uses latest snapshot context state before session context state", () => {
    const latestContextState = contextState(300);
    const sessionContextState = contextState(100);

    expect(getChatInputContextState({
      activeSessionDetail: {
        latestSnapshot: {
          contextState: latestContextState,
        } as any,
        session: {
          contextState: sessionContextState,
        },
      },
    })).toBe(latestContextState);
  });

  it("uses persisted session context state when no active snapshot is available", () => {
    const sessionContextState = contextState(100);

    expect(getChatInputContextState({
      activeSessionDetail: {
        session: {
          contextState: sessionContextState,
        },
      },
    })).toBe(sessionContextState);
  });
});

function contextState(totalTokens: number) {
  return {
    activeTokenUsage: {
      inputTokens: totalTokens,
      outputTokens: 0,
      totalTokens,
      source: "estimate" as const,
    },
    contextWindow: 1_000,
    compactedHistory: [],
    compactedThroughTurnIndex: 0,
    compactionCount: 0,
  };
}
