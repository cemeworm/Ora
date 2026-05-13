import { describe, expect, it } from "vitest";
import type { ModelMessage } from "../providers/index.js";
import { retroactivelyTruncateMessages } from "./message-context-truncation.js";

function makeBigText(approxTokens: number): string {
  // estimateTextTokens uses max(byteLen/4, wordCount). "x".repeat(4n) gives n tokens via byte path.
  return "x".repeat(approxTokens * 4);
}

function toolMessage(toolId: string, payload: string, opts?: { providerNative?: boolean }): ModelMessage {
  if (opts?.providerNative) {
    return {
      role: "tool",
      toolCallId: `call-${toolId}-${Math.random().toString(36).slice(2, 8)}`,
      toolName: toolId,
      content: payload,
    };
  }
  return {
    role: "user",
    content: `Workspace tool result for ${toolId}:\n${payload}`,
  };
}

describe("retroactivelyTruncateMessages", () => {
  it("returns messages unchanged when under target", () => {
    const messages: ModelMessage[] = [
      { role: "system", content: "short system" },
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ];
    const result = retroactivelyTruncateMessages(messages, {
      stablePrefixCount: 1,
      targetTokens: 10_000,
    });
    expect(result.truncatedCount).toBe(0);
    expect(result.tokensAfter).toBe(result.tokensBefore);
    expect(result.messages).toEqual(messages);
  });

  it("truncates largest tool results first", () => {
    const bigPayload = makeBigText(3000);
    const mediumPayload = makeBigText(1500);
    const messages: ModelMessage[] = [
      { role: "system", content: "sys" },
      { role: "user", content: "task" },
      { role: "assistant", content: "running" },
      toolMessage("file.read", bigPayload),
      { role: "assistant", content: "more" },
      toolMessage("grep", mediumPayload),
      { role: "assistant", content: "final step" },
      toolMessage("file.read", makeBigText(500)), // recent #3
      toolMessage("file.read", makeBigText(500)), // recent #2
      toolMessage("file.read", makeBigText(500)), // recent #1
    ];
    const result = retroactivelyTruncateMessages(messages, {
      stablePrefixCount: 2,
      targetTokens: 5_000,
      preserveRecentCount: 3,
    });
    expect(result.truncatedCount).toBeGreaterThan(0);
    expect(result.tokensAfter).toBeLessThan(result.tokensBefore);
    // stable prefix untouched
    expect(result.messages[0]).toEqual(messages[0]);
    expect(result.messages[1]).toEqual(messages[1]);
    // biggest payload (index 3) must be truncated
    expect(result.messages[3].content).not.toBe(messages[3].content);
    expect(result.messages[3].content).toContain("[truncated ~");
    // recent tool results untouched
    expect(result.messages[7]).toEqual(messages[7]);
    expect(result.messages[8]).toEqual(messages[8]);
    expect(result.messages[9]).toEqual(messages[9]);
  });

  it("respects stablePrefixCount: never touches leading messages", () => {
    const bigPayload = makeBigText(3000);
    const messages: ModelMessage[] = [
      { role: "system", content: "sys" },
      toolMessage("file.read", bigPayload), // inside stable prefix
      { role: "assistant", content: "intermediate" },
      toolMessage("grep", makeBigText(2000)), // outside prefix
      toolMessage("file.read", makeBigText(100)),
      toolMessage("file.read", makeBigText(100)),
      toolMessage("file.read", makeBigText(100)),
    ];
    const result = retroactivelyTruncateMessages(messages, {
      stablePrefixCount: 3,
      targetTokens: 3_000,
      preserveRecentCount: 3,
    });
    // stablePrefixCount=3 → indices 0,1,2 untouched
    expect(result.messages[1]).toEqual(messages[1]);
    expect(result.messages[1].content).toBe(bigPayload.length > 0 ? messages[1].content : "");
  });

  it("preserves the most recent N tool results", () => {
    const messages: ModelMessage[] = [
      { role: "system", content: "sys" },
      toolMessage("file.read", makeBigText(3000)),
      toolMessage("file.read", makeBigText(3000)),
      toolMessage("file.read", makeBigText(3000)),
      toolMessage("file.read", makeBigText(3000)),
      toolMessage("file.read", makeBigText(3000)),
    ];
    const result = retroactivelyTruncateMessages(messages, {
      stablePrefixCount: 1,
      targetTokens: 5_000,
      preserveRecentCount: 2,
    });
    // last 2 tool results preserved
    expect(result.messages[4]).toEqual(messages[4]);
    expect(result.messages[5]).toEqual(messages[5]);
    // at least one earlier one truncated
    const anyTruncated = [1, 2, 3].some(
      (i) => result.messages[i].content !== messages[i].content,
    );
    expect(anyTruncated).toBe(true);
  });

  it("handles provider-native tool messages (role: tool)", () => {
    const big = makeBigText(3000);
    const messages: ModelMessage[] = [
      { role: "system", content: "sys" },
      { role: "assistant", content: "ok" },
      toolMessage("file.read", big, { providerNative: true }),
      toolMessage("grep", makeBigText(200), { providerNative: true }),
      toolMessage("file.read", makeBigText(200), { providerNative: true }),
      toolMessage("grep", makeBigText(200), { providerNative: true }),
    ];
    const result = retroactivelyTruncateMessages(messages, {
      stablePrefixCount: 1,
      targetTokens: 3_000,
      preserveRecentCount: 3,
    });
    expect(result.truncatedCount).toBeGreaterThan(0);
    // role + toolName preserved
    expect(result.messages[2].role).toBe("tool");
    expect(result.messages[2].toolName).toBe("file.read");
    expect(result.messages[2].content).toContain("[truncated ~");
  });

  it("preserves Workspace header when truncating user-wrapped tool result", () => {
    const payload = makeBigText(3000);
    const messages: ModelMessage[] = [
      { role: "system", content: "sys" },
      toolMessage("file.read", payload),
      toolMessage("file.read", makeBigText(10)),
      toolMessage("file.read", makeBigText(10)),
      toolMessage("file.read", makeBigText(10)),
    ];
    const result = retroactivelyTruncateMessages(messages, {
      stablePrefixCount: 1,
      targetTokens: 2_000,
      preserveRecentCount: 3,
    });
    const rewritten = result.messages[1];
    expect(typeof rewritten.content).toBe("string");
    expect(rewritten.content as string).toMatch(/^Workspace tool result for file\.read:\n/);
    expect(rewritten.content).toContain("[truncated ~");
  });

  it("does not truncate when all tool results are within preserveRecentCount", () => {
    const messages: ModelMessage[] = [
      { role: "system", content: "sys" },
      toolMessage("file.read", makeBigText(5000)),
      toolMessage("file.read", makeBigText(5000)),
    ];
    const result = retroactivelyTruncateMessages(messages, {
      stablePrefixCount: 1,
      targetTokens: 1_000,
      preserveRecentCount: 3, // > available
    });
    // nothing truncatable
    expect(result.truncatedCount).toBe(0);
    expect(result.messages).toEqual(messages);
  });
});
