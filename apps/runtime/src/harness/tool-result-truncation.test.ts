import { describe, expect, it } from "vitest";
import { truncateToolResultForContext } from "./tool-result-truncation.js";

/** Generate a string of roughly `targetTokens` tokens (4 bytes per token). */
function makeLargeText(targetTokens: number): string {
  const bytes = targetTokens * 4;
  return "x".repeat(bytes);
}

describe("truncateToolResultForContext", () => {
  it("returns short results unchanged", () => {
    const short = '{"ok": true}';
    expect(truncateToolResultForContext(short, { toolId: "file.read" })).toBe(short);
  });

  it("returns results within budget unchanged", () => {
    // ~500 tokens, well under the 2000 default
    const text = makeLargeText(500);
    expect(truncateToolResultForContext(text, { toolId: "file.read" })).toBe(text);
  });

  it("truncates long results with 50/50 head-tail split", () => {
    const text = makeLargeText(5000);
    const result = truncateToolResultForContext(text, { toolId: "file.read", maxTokens: 2000 });

    expect(result).not.toBe(text);
    expect(result).toContain("[truncated ~");

    // Head and tail should each be about maxTokens*4/2 chars
    const maxChars = 2000 * 4;
    const halfBudget = Math.floor(maxChars / 2);
    const markerPrefix = "\n\n... [truncated ~";

    const markerIndex = result.indexOf(markerPrefix);
    expect(markerIndex).toBeGreaterThan(0);

    const head = result.slice(0, markerIndex);
    const tailEnd = result.indexOf("] ...\n\n", markerIndex) + "] ...\n\n".length;
    const tail = result.slice(tailEnd);

    // Head and tail should be roughly equal (halfBudget each)
    expect(Math.abs(head.length - tail.length)).toBeLessThan(10);
    expect(head.length).toBe(halfBudget);
    expect(tail.length).toBe(halfBudget);
  });

  it("preserves plan.update results without truncation", () => {
    const text = makeLargeText(5000);
    expect(truncateToolResultForContext(text, { toolId: "plan.update" })).toBe(text);
  });

  it("preserves user.clarify results without truncation", () => {
    const text = makeLargeText(5000);
    expect(truncateToolResultForContext(text, { toolId: "user.clarify" })).toBe(text);
  });

  it("does not truncate results exactly at budget boundary", () => {
    // Exactly 2000 tokens worth of text
    const text = "a ".repeat(2000); // ~2000 tokens (word-based estimate)
    const result = truncateToolResultForContext(text, { toolId: "file.read", maxTokens: 2000 });
    // Should be returned as-is or very close (estimation is approximate)
    expect(result.length).toBe(text.length);
  });

  it("truncates with custom maxTokens", () => {
    const text = makeLargeText(3000);
    const result = truncateToolResultForContext(text, { toolId: "grep", maxTokens: 1000 });
    expect(result).not.toBe(text);
    expect(result).toContain("[truncated ~");

    // Total length should be approximately maxTokens*4 + marker length
    const maxChars = 1000 * 4;
    expect(result.length).toBeLessThan(maxChars + 100);
  });

  it("handles empty string", () => {
    expect(truncateToolResultForContext("", { toolId: "file.read" })).toBe("");
  });
});
