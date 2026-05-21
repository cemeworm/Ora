import { describe, it, expect } from "vitest";
import {
  DEFAULT_SESSION_TITLE,
  defaultSessionTitle,
  assistantTextForRun,
  assistantReasoningContentForRun,
  shouldGenerateSessionTitle,
} from "./session-title.js";
import type { StateSnapshot } from "@cemeworm/shared";

describe("defaultSessionTitle", () => {
  it("returns trimmed prompt when non-empty", () => {
    expect(defaultSessionTitle("  Hello world  ")).toBe("Hello world");
  });

  it("returns DEFAULT_SESSION_TITLE for empty prompt", () => {
    expect(defaultSessionTitle("")).toBe(DEFAULT_SESSION_TITLE);
  });

  it("returns DEFAULT_SESSION_TITLE for whitespace-only prompt", () => {
    expect(defaultSessionTitle("   ")).toBe(DEFAULT_SESSION_TITLE);
  });

  it("truncates long prompts to 120 characters", () => {
    const long = "x".repeat(200);
    expect(defaultSessionTitle(long)).toBe("x".repeat(120));
  });
});

describe("assistantTextForRun", () => {
  it("returns projected assistant text from snapshot", () => {
    const snapshot = {
      output: "Hello from assistant",
      events: [
        { type: "text.delta", payload: { text: "Hello from " } },
        { type: "text.delta", payload: { text: "assistant" } },
      ],
    } as unknown as StateSnapshot;
    const result = assistantTextForRun(snapshot);
    // projectAssistantTextFromSnapshot uses output if available
    expect(result).toBe("Hello from assistant");
  });
});

describe("assistantReasoningContentForRun", () => {
  it("returns reasoning content from snapshot", () => {
    const snapshot = {
      output: { reasoningContent: "Let me think..." },
      events: [],
    } as unknown as StateSnapshot;
    const result = assistantReasoningContentForRun(snapshot);
    expect(result).toBe("Let me think...");
  });
});

describe("shouldGenerateSessionTitle", () => {
  const makeSnapshot = (overrides: Partial<StateSnapshot> = {}): StateSnapshot =>
    ({
      sessionId: "sess-1",
      status: "succeeded",
      turnIndex: 1,
      input: { prompt: "Hello" },
      output: "Hi there!",
      events: [
        { type: "text.delta", payload: { text: "Hi there!" } },
      ],
      ...overrides,
    }) as unknown as StateSnapshot;

  it("returns true for a complete first turn with assistant response", () => {
    expect(shouldGenerateSessionTitle(makeSnapshot(), undefined)).toBe(true);
  });

  it("returns false when there is no sessionId", () => {
    expect(shouldGenerateSessionTitle(makeSnapshot({ sessionId: undefined }), undefined)).toBe(false);
  });

  it("returns false when status is queued", () => {
    expect(shouldGenerateSessionTitle(makeSnapshot({ status: "queued" }), undefined)).toBe(false);
  });

  it("returns false when status is running", () => {
    expect(shouldGenerateSessionTitle(makeSnapshot({ status: "running" }), undefined)).toBe(false);
  });

  it("returns false when turnIndex is not 1", () => {
    expect(shouldGenerateSessionTitle(makeSnapshot({ turnIndex: 2 }), undefined)).toBe(false);
  });

  it("returns false when existing title is not DEFAULT_SESSION_TITLE", () => {
    expect(shouldGenerateSessionTitle(makeSnapshot(), "Custom Title")).toBe(false);
  });

  it("returns true when existing title is DEFAULT_SESSION_TITLE", () => {
    expect(shouldGenerateSessionTitle(makeSnapshot(), DEFAULT_SESSION_TITLE)).toBe(true);
  });

  it("returns false when input prompt is empty", () => {
    expect(
      shouldGenerateSessionTitle(makeSnapshot({ input: { prompt: "" } }), undefined),
    ).toBe(false);
  });

  it("returns false when assistant response is empty", () => {
    const snapshot = makeSnapshot();
    snapshot.output = "";
    snapshot.events = [];
    expect(shouldGenerateSessionTitle(snapshot, undefined)).toBe(false);
  });
});
