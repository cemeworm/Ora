import { describe, it, expect } from "vitest";
import { runtimeConversationToModelMessages } from "./runtime-conversation.js";
import type { RuntimeConversationEntry } from "@cemeworm/shared";

describe("runtimeConversationToModelMessages", () => {
  it("returns empty array for undefined entries", () => {
    const result = runtimeConversationToModelMessages(undefined);
    expect(result).toEqual([]);
  });

  it("returns empty array for empty entries", () => {
    const result = runtimeConversationToModelMessages([]);
    expect(result).toEqual([]);
  });

  it("converts a system message", () => {
    const entries: RuntimeConversationEntry[] = [
      {
        role: "system",
        content: "You are a helpful assistant.",
        createdAt: 1000,
      },
    ];
    const result = runtimeConversationToModelMessages(entries);
    expect(result).toEqual([{ role: "system", content: "You are a helpful assistant." }]);
  });

  it("converts a user message", () => {
    const entries: RuntimeConversationEntry[] = [
      {
        role: "user",
        content: "Hello",
        createdAt: 1000,
      },
    ];
    const result = runtimeConversationToModelMessages(entries);
    expect(result).toEqual([{ role: "user", content: "Hello" }]);
  });

  it("converts an assistant message with tool calls", () => {
    const entries: RuntimeConversationEntry[] = [
      {
        role: "assistant",
        content: "Let me search that.",
        reasoningContent: "I need to find the answer.",
        toolCalls: [
          { id: "call-1", toolId: "web_search", args: { query: "test" } },
        ],
        createdAt: 1000,
      },
    ];
    const result = runtimeConversationToModelMessages(entries);
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe("assistant");
    expect(result[0].content).toBe("Let me search that.");
    expect(result[0].reasoningContent).toBe("I need to find the answer.");
    expect(result[0].toolCalls).toEqual([
      { id: "call-1", toolId: "web_search", args: { query: "test" } },
    ]);
  });

  it("uses providerCallId when available for assistant tool calls", () => {
    const entries: RuntimeConversationEntry[] = [
      {
        role: "assistant",
        content: "",
        toolCalls: [
          { id: "call-1", providerCallId: "provider-call-1", toolId: "read_file", args: { path: "./foo" } },
        ],
        createdAt: 1000,
      },
    ];
    const result = runtimeConversationToModelMessages(entries);
    expect((result[0].toolCalls as any[])[0].id).toBe("provider-call-1");
  });

  it("converts a tool result message", () => {
    const entries: RuntimeConversationEntry[] = [
      {
        role: "tool",
        content: "Result data",
        toolCallId: "call-1",
        toolId: "web_search",
        status: "succeeded",
        createdAt: 1000,
      },
    ];
    const result = runtimeConversationToModelMessages(entries);
    expect(result[0].role).toBe("tool");
    expect(result[0].content).toBe("Result data");
    expect(result[0].toolCallId).toBe("call-1");
    expect(result[0].toolName).toBe("web_search");
  });

  it("uses providerCallId for tool result when available", () => {
    const entries: RuntimeConversationEntry[] = [
      {
        role: "tool",
        content: "Data",
        toolCallId: "call-2",
        providerCallId: "provider-call-2",
        toolId: "search",
        status: "succeeded",
        createdAt: 1000,
      },
    ];
    const result = runtimeConversationToModelMessages(entries);
    expect(result[0].toolCallId).toBe("provider-call-2");
  });

  it("converts a mixed conversation in order", () => {
    const entries: RuntimeConversationEntry[] = [
      { role: "system", content: "Be helpful.", createdAt: 1000 },
      { role: "user", content: "Hi", createdAt: 1001 },
      { role: "assistant", content: "Hello!", toolCalls: [], createdAt: 1002 },
    ];
    const result = runtimeConversationToModelMessages(entries);
    expect(result).toHaveLength(3);
    expect(result[0].role).toBe("system");
    expect(result[1].role).toBe("user");
    expect(result[2].role).toBe("assistant");
  });
});
