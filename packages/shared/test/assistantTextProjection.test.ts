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
import {
  resolvePublicAssistantText,
  stripInternalAssistantProtocolText,
} from "../src/assistantOutputContract.js";

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
    expect(projectAssistantTextFromEvents(events)).toBe("");
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

  it("ignores internal protocol output text and falls back to events", () => {
    const snapshot = {
      output: {
        text: "Visible prefix\n\n<｜｜DSML｜｜invoke name=\"file__read\">\n<｜｜DSML｜｜parameter name=\"path\">x</｜｜DSML｜｜parameter>\n</｜｜DSML｜｜invoke>",
      },
      events: [
        { type: "message.delta", payload: { delta: "Event text", content: "Event text" } },
      ],
    };
    expect(projectAssistantTextFromSnapshot(snapshot)).toBe("Event text");
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

  it("filters collaboration deltas in events fallback", () => {
    const snapshot = {
      events: [
        { type: "message.delta", payload: { delta: "Parent", content: "Parent" } },
        { type: "message.delta", payload: { visibility: "collaboration", delta: "Child", content: "Child" } },
      ],
    };
    expect(projectAssistantTextFromSnapshot(snapshot)).toBe("Parent");
  });

  it("filters child-session deltas by agent id when snapshot carries child summaries", () => {
    const snapshot = {
      childSessions: [
        {
          id: "run-1:ora-sub-1",
          agentId: "ora-sub-1",
          label: "Researcher",
          sessionClass: "temporary_spawn",
          status: "succeeded",
          startedAt: 1,
          updatedAt: 2,
        },
      ],
      events: [
        { type: "message.delta", agentId: "ora-sub-1", payload: { delta: "Child result", content: "Child result" } },
        { type: "message.delta", agentId: "ora", payload: { delta: "Parent synthesis", content: "Parent synthesis" } },
      ],
    };
    expect(projectAssistantTextFromSnapshot(snapshot)).toBe("Parent synthesis");
  });

  it("ignores commentary deltas by default in events fallback", () => {
    const snapshot = {
      events: [
        { type: "message.delta", payload: { phase: "commentary", surface: "chat_progress", content: "Working through the tool results." } },
        { type: "message.delta", payload: { delta: "Final", content: "Final" } },
      ],
    };
    expect(projectAssistantTextFromSnapshot(snapshot)).toBe("Final");
  });

  it("can include commentary deltas when explicitly requested", () => {
    const snapshot = {
      events: [
        { type: "message.delta", payload: { phase: "commentary", surface: "chat_progress", content: "Working through the tool results." } },
      ],
    };
    expect(projectAssistantTextFromSnapshot(snapshot, { includeCommentary: true })).toBe("Working through the tool results.");
  });

  it("drops a message when later deltas complete an internal protocol fragment", () => {
    const snapshot = {
      events: [
        { type: "message.delta", seq: 0, payload: { messageId: "msg-1", delta: "Visible prefix\n\n<｜｜DSML｜｜in", content: "Visible prefix\n\n<｜｜DSML｜｜in" } },
        { type: "message.delta", seq: 1, payload: { messageId: "msg-1", delta: 'voke name="file__read">', content: 'Visible prefix\n\n<｜｜DSML｜｜invoke name="file__read">' } },
      ],
    };

    expect(projectAssistantTextFromSnapshot(snapshot)).toBe("");
  });

  it("falls back to the latest clean message when a later message is rejected", () => {
    const snapshot = {
      events: [
        { type: "message.delta", seq: 0, payload: { messageId: "msg-1", delta: "First clean answer", content: "First clean answer" } },
        { type: "message.delta", seq: 1, payload: { messageId: "msg-2", delta: "<｜｜DSML｜｜in", content: "<｜｜DSML｜｜in" } },
        { type: "message.delta", seq: 2, payload: { messageId: "msg-2", delta: 'voke name="file__read">', content: '<｜｜DSML｜｜invoke name="file__read">' } },
      ],
    };

    expect(projectAssistantTextFromSnapshot(snapshot)).toBe("First clean answer");
  });
});

describe("assistant output contract", () => {
  it("strips DSML protocol lines while preserving visible prefix", () => {
    expect(stripInternalAssistantProtocolText(
      "Visible prefix\n\n<｜｜DSML｜｜invoke name=\"file__read\">\n<｜｜DSML｜｜parameter name=\"path\">x</｜｜DSML｜｜parameter>\n</｜｜DSML｜｜invoke>",
    )).toBe("Visible prefix");
  });

  it("rejects raw output that contains internal protocol even when visible text remains", () => {
    const resolved = resolvePublicAssistantText(
      "Visible prefix\n\n<｜｜DSML｜｜invoke name=\"file__read\">\n<｜｜DSML｜｜parameter name=\"path\">x</｜｜DSML｜｜parameter>\n</｜｜DSML｜｜invoke>",
    );
    expect(resolved.isRejected).toBe(true);
    expect(resolved.rejectionReason).toBe("internal_protocol");
    expect(resolved.visibleText).toBe("Visible prefix");
    expect(resolved.acceptedText).toBeUndefined();
  });

  it("rejects inline tool json even when prose appears before it", () => {
    const resolved = resolvePublicAssistantText(
      'Visible prefix {"tool":"file.write","args":{"path":"notes.txt","content":"x"}}',
    );
    expect(resolved.isRejected).toBe(true);
    expect(resolved.rejectionReason).toBe("internal_protocol");
  });

  it("strips empty fenced shells left behind after inline tool JSON removal", () => {
    expect(stripInternalAssistantProtocolText(
      'Visible prefix\n\n```json\n{"tool":"file.write","args":{"path":"notes.txt","content":"x"}}\n```',
    )).toBe("Visible prefix");
  });

  it("rejects writer file tags as internal protocol text", () => {
    const resolved = resolvePublicAssistantText(
      "Visible prefix\n<file.write path=\"notes.txt\">approved</file.write>",
    );
    expect(resolved.isRejected).toBe(true);
    expect(resolved.rejectionReason).toBe("internal_protocol");
  });
});
