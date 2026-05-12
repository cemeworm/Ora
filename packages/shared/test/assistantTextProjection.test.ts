import { describe, expect, it } from "vitest";
import {
  isInternalAssistantText,
  isInternalDeltaPayload,
  isInternalDeltaText,
  isInternalRecoveryFallbackText,
  mergeAssistantDeltaProjection,
  mergeAssistantDeltaText,
  projectAssistantTextFromEvents,
  projectAssistantTextFromSnapshot,
} from "../src/assistantTextProjection.js";

describe("mergeAssistantDeltaText", () => {
  it("appends explicit deltas", () => {
    expect(mergeAssistantDeltaText("Hi", { delta: " there", content: "Hi there" })).toBe("Hi there");
  });

  it("returns current text when no delta or content", () => {
    expect(mergeAssistantDeltaText("Hi", {})).toBe("Hi");
  });

  it("replaces with cumulative content when content starts with current text", () => {
    expect(mergeAssistantDeltaText("Hi there", { content: "Hi there!" })).toBe("Hi there!");
  });

  it("ignores content that is a suffix of current text", () => {
    expect(mergeAssistantDeltaText("Hi there", { content: " there" })).toBe("Hi there");
  });

  it("ignores duplicate content", () => {
    expect(mergeAssistantDeltaText("Hi there", { content: "Hi there" })).toBe("Hi there");
  });

  it("appends content when it doesn't match current text", () => {
    expect(mergeAssistantDeltaText("Hello", { content: " world" })).toBe("Hello world");
  });
});

describe("mergeAssistantDeltaProjection", () => {
  it("creates initial projection", () => {
    const result = mergeAssistantDeltaProjection(undefined, {
      delta: "Hi",
      content: "Hi",
    });
    expect(result?.text).toBe("Hi");
  });

  it("appends successive deltas", () => {
    const first = mergeAssistantDeltaProjection(undefined, { delta: "Hi", content: "Hi" });
    const second = mergeAssistantDeltaProjection(first, { delta: " there", content: " there" });
    expect(second?.text).toBe("Hi there");
  });

  it("returns undefined for empty payload with no current", () => {
    const result = mergeAssistantDeltaProjection(undefined, {});
    expect(result).toBeUndefined();
  });
});

describe("isInternalDeltaPayload", () => {
  it("flags visibility internal", () => {
    expect(isInternalDeltaPayload({ visibility: "internal" })).toBe(true);
  });

  it("flags audience internal", () => {
    expect(isInternalDeltaPayload({ audience: "internal" })).toBe(true);
  });

  it("flags public false", () => {
    expect(isInternalDeltaPayload({ public: false })).toBe(true);
  });

  it("passes normal payload", () => {
    expect(isInternalDeltaPayload({ content: "Hello" })).toBe(false);
  });
});

describe("isInternalAssistantText", () => {
  it("flags tool_plan_mode_reminder tags", () => {
    expect(isInternalAssistantText("<tool_plan_mode_reminder>")).toBe(true);
  });

  it("flags tool_call tags", () => {
    expect(isInternalAssistantText("<tool_call>")).toBe(true);
  });

  it("flags DSML tool_calls", () => {
    expect(isInternalAssistantText('<dsml tool_calls="x">')).toBe(true);
  });

  it("flags file.read tags", () => {
    expect(isInternalAssistantText("<file.read>")).toBe(true);
  });

  it("flags JSON tool args", () => {
    expect(isInternalAssistantText('{"tool": "bash", "args": {}}')).toBe(true);
  });

  it("passes normal text", () => {
    expect(isInternalAssistantText("Hello world")).toBe(false);
  });
});

describe("isInternalRecoveryFallbackText", () => {
  it("flags tool-error-boundary prefix", () => {
    expect(isInternalRecoveryFallbackText("[tool-error-boundary] something")).toBe(true);
  });

  it("flags recovery:fallback prefix", () => {
    expect(isInternalRecoveryFallbackText("[recovery:fallback] something")).toBe(true);
  });

  it("passes normal text", () => {
    expect(isInternalRecoveryFallbackText("normal text")).toBe(false);
  });
});

describe("isInternalDeltaText", () => {
  it("combines internal assistant text and recovery fallback", () => {
    expect(isInternalDeltaText("[tool-error-boundary]")).toBe(true);
    expect(isInternalDeltaText("<tool_call>")).toBe(true);
    expect(isInternalDeltaText("hello")).toBe(false);
  });
});

describe("projectAssistantTextFromEvents", () => {
  // --- delta-sized (each event is a fragment) ---
  it("handles delta-sized payloads", () => {
    const events = [
      { type: "message.delta", payload: { delta: "Hello", content: "Hello" } },
      { type: "message.delta", payload: { delta: " ", content: " " } },
      { type: "message.delta", payload: { delta: "World", content: "World" } },
    ];
    expect(projectAssistantTextFromEvents(events)).toBe("Hello World");
  });

  // --- cumulative content ---
  it("handles cumulative content payloads", () => {
    const events = [
      { type: "message.delta", payload: { content: "Hello" } },
      { type: "message.delta", payload: { content: "Hello World" } },
    ];
    expect(projectAssistantTextFromEvents(events)).toBe("Hello World");
  });

  // --- mixed (some delta, some cumulative) ---
  it("handles mixed delta and cumulative payloads", () => {
    const events = [
      { type: "message.delta", payload: { delta: "Hello", content: "Hello" } },
      { type: "message.delta", payload: { content: "Hello World" } },
      { type: "message.delta", payload: { delta: "!", content: "Hello World!" } },
    ];
    expect(projectAssistantTextFromEvents(events)).toBe("Hello World!");
  });

  // --- internal filtering ---
  it("filters internal deltas by default", () => {
    const events = [
      { type: "message.delta", payload: { delta: "Public", content: "Public" } },
      { type: "message.delta", payload: { visibility: "internal", delta: "Secret", content: "Secret" } },
    ];
    expect(projectAssistantTextFromEvents(events)).toBe("Public");
  });

  it("includes internal deltas when publicOnly is false", () => {
    const events = [
      { type: "message.delta", payload: { delta: "Public", content: "Public" } },
      { type: "message.delta", payload: { visibility: "internal", delta: "Secret", content: "Secret" } },
    ];
    expect(projectAssistantTextFromEvents(events, { publicOnly: false })).toBe("PublicSecret");
  });

  it("filters internal text patterns", () => {
    const events = [
      { type: "message.delta", payload: { delta: "Normal", content: "Normal" } },
      { type: "message.delta", payload: { delta: "<tool_call>", content: "<tool_call>" } },
    ];
    expect(projectAssistantTextFromEvents(events)).toBe("Normal");
  });

  // --- truncation ---
  it("truncates at maxChars", () => {
    const events = [
      { type: "message.delta", payload: { delta: "Hello World", content: "Hello World" } },
    ];
    expect(projectAssistantTextFromEvents(events, { maxChars: 5 })).toBe("Hello");
  });

  // --- non-delta events ignored ---
  it("ignores non-message.delta events", () => {
    const events = [
      { type: "run.started", payload: {} },
      { type: "message.delta", payload: { delta: "Hello", content: "Hello" } },
      { type: "token.delta", payload: {} },
    ];
    expect(projectAssistantTextFromEvents(events)).toBe("Hello");
  });

  // --- empty ---
  it("returns empty string for no matching events", () => {
    expect(projectAssistantTextFromEvents([])).toBe("");
  });
});

describe("projectAssistantTextFromSnapshot", () => {
  // --- output.text priority ---
  it("prefers output.text over events", () => {
    const snapshot = {
      output: { text: "Final output" },
      events: [
        { type: "message.delta", payload: { delta: "Streaming", content: "Streaming" } },
      ],
    };
    expect(projectAssistantTextFromSnapshot(snapshot)).toBe("Final output");
  });

  it("prefers output string over events", () => {
    const snapshot = {
      output: "Final string output",
      events: [
        { type: "message.delta", payload: { delta: "Streaming", content: "Streaming" } },
      ],
    };
    expect(projectAssistantTextFromSnapshot(snapshot)).toBe("Final string output");
  });

  // --- falls back to events ---
  it("falls back to events when output is absent", () => {
    const snapshot = {
      events: [
        { type: "message.delta", payload: { delta: "Hello", content: "Hello" } },
        { type: "message.delta", payload: { delta: " World", content: "Hello World" } },
      ],
    };
    expect(projectAssistantTextFromSnapshot(snapshot)).toBe("Hello World");
  });

  // --- recovery fallback in output ---
  it("ignores recovery fallback output text", () => {
    const snapshot = {
      output: "[tool-error-boundary] error",
      events: [
        { type: "message.delta", payload: { delta: "Real text", content: "Real text" } },
      ],
    };
    expect(projectAssistantTextFromSnapshot(snapshot)).toBe("Real text");
  });

  // --- truncation ---
  it("truncates output.text at maxChars", () => {
    const snapshot = {
      output: { text: "Very long output text here" },
      events: [],
    };
    expect(projectAssistantTextFromSnapshot(snapshot, { maxChars: 9 })).toBe("Very long");
  });

  // --- internal filtering in events ---
  it("filters internal deltas in events fallback", () => {
    const snapshot = {
      events: [
        { type: "message.delta", payload: { delta: "Public", content: "Public" } },
        { type: "message.delta", payload: { visibility: "internal", delta: "Secret", content: "Secret" } },
      ],
    };
    expect(projectAssistantTextFromSnapshot(snapshot)).toBe("Public");
  });
});
