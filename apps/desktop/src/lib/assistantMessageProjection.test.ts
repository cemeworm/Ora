import { describe, expect, it } from "vitest";
import { mergeAssistantMessageTextProjection } from "./assistantMessageProjection";

describe("assistant message projection", () => {
  it("appends explicit deltas", () => {
    const first = mergeAssistantMessageTextProjection(undefined, {
      delta: "Hi",
      content: "Hi",
    });
    const second = mergeAssistantMessageTextProjection(first, {
      delta: " there",
      content: " there",
    });

    expect(second?.text).toBe("Hi there");
  });

  it("treats content-only cumulative text as a replacement", () => {
    const current = { text: "Hi there" };
    const next = mergeAssistantMessageTextProjection(current, {
      content: "Hi there!",
      streaming: false,
    });

    expect(next?.text).toBe("Hi there!");
  });

  it("ignores repeated content-only suffixes", () => {
    const current = { text: "Hi there" };
    const next = mergeAssistantMessageTextProjection(current, {
      content: " there",
    });

    expect(next?.text).toBe("Hi there");
  });
});
