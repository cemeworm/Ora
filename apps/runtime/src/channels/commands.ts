import type { ChannelBinding, ChannelConfig } from "@cemeworm/shared";

export type ChannelCommandName = "/help" | "/status" | "/new";

export interface ChannelCommandContext {
  channel: ChannelConfig;
  binding?: ChannelBinding;
  queueSize: number;
  latestRunId?: string;
  latestRunStatus?: string;
}

export interface ChannelCommandResult {
  name: ChannelCommandName;
  text: string;
  shouldCreateNewSession?: boolean;
}

export function parseChannelCommand(text: string): ChannelCommandName | undefined {
  const trimmed = text.trim();
  const [head] = trimmed.split(/\s+/, 1);
  if (head === "/help" || head === "/status" || head === "/new") {
    return head;
  }
  return undefined;
}

export function handleChannelCommand(command: ChannelCommandName, context: ChannelCommandContext): ChannelCommandResult {
  switch (command) {
    case "/help":
      return {
        name: command,
        text: [
          `Channel: ${context.channel.label}`,
          "Available commands:",
          "- /help: show this help message.",
          "- /status: show current channel binding and queue status.",
          "- /new: start a new Ora session for this external chat/thread.",
        ].join("\n"),
      };
    case "/status":
      return {
        name: command,
        text: [
          `Channel: ${context.channel.label} (${context.channel.channelId})`,
          `Enabled: ${context.channel.enabled ? "yes" : "no"}`,
          `Binding: ${context.binding?.bindingId ?? "not bound"}`,
          `Session: ${context.binding?.sessionId ?? "not created"}`,
          `Latest run: ${context.latestRunId ? `${context.latestRunId} (${context.latestRunStatus ?? "unknown"})` : "none"}`,
          `Queue size: ${context.queueSize}`,
        ].join("\n"),
      };
    case "/new":
      return {
        name: command,
        shouldCreateNewSession: true,
        text: "Started a new Ora session for this channel thread.",
      };
  }
}
