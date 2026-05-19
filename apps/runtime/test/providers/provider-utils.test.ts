import { describe, expect, it } from "vitest";
import {
  buildModelRequestCacheDiagnostics,
  normalizeMessages,
  splitStableSystemPrompt,
} from "../../src/providers/provider-utils.js";

describe("provider cache diagnostics", () => {
  it("appends the current prompt after prior conversation messages", () => {
    expect(normalizeMessages({
      messages: [
        { role: "user", content: "Original user request." },
        { role: "assistant", content: "Prior assistant reply." },
      ],
      prompt: "Current delegated subtask.",
    })).toEqual([
      { role: "user", content: "Original user request." },
      { role: "assistant", content: "Prior assistant reply." },
      { role: "user", content: "Current delegated subtask." },
    ]);
  });

  it("does not duplicate the prompt when it already matches the latest user message", () => {
    expect(normalizeMessages({
      messages: [
        { role: "assistant", content: "Prior assistant reply." },
        { role: "user", content: "Current delegated subtask." },
      ],
      prompt: "Current delegated subtask.",
    })).toEqual([
      { role: "assistant", content: "Prior assistant reply." },
      { role: "user", content: "Current delegated subtask." },
    ]);
  });

  it("splits the stable system prefix from the volatile suffix", () => {
    expect(splitStableSystemPrompt(
      [
        "Stable identity block",
        "Capability contract",
        "Dynamic stage instruction",
      ].join("\n\n"),
      [
        "Stable identity block",
        "Capability contract",
      ].join("\n\n"),
    )).toEqual({
      stablePrefix: "Stable identity block\n\nCapability contract",
      suffix: "Dynamic stage instruction",
    });
  });

  it("captures hashes for stable prefix, volatile suffix, tools, and turn-local metadata", () => {
    const diagnostics = buildModelRequestCacheDiagnostics({
      system: [
        "Stable identity block",
        "Capability contract",
        "Dynamic stage instruction",
      ].join("\n\n"),
      providerCache: {
        stableSystemPrefix: [
          "Stable identity block",
          "Capability contract",
        ].join("\n\n"),
      },
      tools: [
        {
          id: "file.read",
          description: "Read a file",
          parameters: {
            type: "object",
            properties: {
              path: { type: "string" },
            },
          },
        },
      ],
      messages: [
        {
          role: "user",
          content: [
            "<turn_local_metadata>",
            "Current local date: 2026-05-09",
            "</turn_local_metadata>",
            "Say hello.",
          ].join("\n"),
        },
      ],
    });

    expect(diagnostics.stableSystemPrefixHash).toBeDefined();
    expect(diagnostics.stableSystemPrefixChars).toBeGreaterThan(0);
    expect(diagnostics.volatileSystemSuffixHash).toBeDefined();
    expect(diagnostics.volatileSystemSuffixChars).toBeGreaterThan(0);
    expect(diagnostics.toolsHash).toBeDefined();
    expect(diagnostics.latestTurnMetadataHash).toBeDefined();
    expect(diagnostics.latestTurnMetadataChars).toBeGreaterThan(0);
  });

  it("keeps the current-turn metadata hash when later synthetic user messages are appended", () => {
    const diagnostics = buildModelRequestCacheDiagnostics({
      messages: [
        {
          role: "user",
          content: [
            "<turn_local_metadata>",
            "Current local date: 2026-05-09",
            "</turn_local_metadata>",
            "Implement the accepted plan.",
          ].join("\n"),
        },
        {
          role: "user",
          content: [
            "The user declined the previous plan from this same run.",
            "Revise the plan instead of implementing it.",
          ].join("\n"),
        },
        {
          role: "assistant",
          content: "Working through the runtime state.",
        },
      ],
    });

    expect(diagnostics.latestTurnMetadataHash).toBeDefined();
    expect(diagnostics.latestTurnMetadataChars).toBeGreaterThan(0);
  });

  it("does not reuse a previous-turn metadata block when the current turn has none", () => {
    const diagnostics = buildModelRequestCacheDiagnostics({
      messages: [
        {
          role: "user",
          content: [
            "<turn_local_metadata>",
            "Current local date: 2026-05-08",
            "</turn_local_metadata>",
            "Yesterday's request.",
          ].join("\n"),
        },
        {
          role: "assistant",
          content: "Handled.",
        },
        {
          role: "user",
          content: "Fresh request without metadata.",
        },
      ],
    });

    expect(diagnostics.latestTurnMetadataHash).toBeUndefined();
    expect(diagnostics.latestTurnMetadataChars).toBe(0);
  });
});
