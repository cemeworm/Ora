import type { RuntimeConversationEntry } from "@cemeworm/shared";
import type { ModelMessage } from "./providers/index.js";

export function runtimeConversationToModelMessages(
  entries: readonly RuntimeConversationEntry[] = [],
): ModelMessage[] {
  return entries.map((entry) => {
    switch (entry.role) {
      case "system":
      case "user":
        return { role: entry.role, content: entry.content };
      case "assistant":
        return {
          role: "assistant",
          content: entry.content,
          toolCalls: entry.toolCalls.map((call) => ({
            id: call.providerCallId ?? call.id,
            toolId: call.toolId,
            args: call.args,
          })),
        };
      case "tool":
        return {
          role: "tool",
          content: entry.content,
          toolCallId: entry.providerCallId ?? entry.toolCallId,
          toolName: entry.toolId,
        };
    }
  });
}
