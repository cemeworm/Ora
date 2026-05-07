import type { ChannelBinding, ChannelConfig } from "@cemeworm/shared";

export type ChannelCommandName = "/help" | "/status" | "/new" | "/project";

export interface ChannelCommandContext {
  channel: ChannelConfig;
  binding?: ChannelBinding;
  queueSize: number;
  latestRunId?: string;
  latestRunStatus?: string;
  currentProjectPath?: string;
  pendingProjectCandidateCount?: number;
}

export interface ChannelCommandResult {
  name: ChannelCommandName;
  text: string;
  shouldCreateNewSession?: boolean;
  shouldDiscoverProject?: boolean;
  projectQuery?: string;
}

export function parseChannelCommand(text: string): ChannelCommandName | undefined {
  const trimmed = text.trim();
  const [head] = trimmed.split(/\s+/, 1);
  if (head === "/help" || head === "/status" || head === "/new" || head === "/project") {
    return head;
  }
  return undefined;
}

function extractCommandArgument(text: string): string | undefined {
  const trimmed = text.trim();
  const spaceIndex = trimmed.indexOf(" ");
  if (spaceIndex === -1) return undefined;
  const argument = trimmed.slice(spaceIndex + 1).trim();
  return argument || undefined;
}

export function handleChannelCommand(command: ChannelCommandName, context: ChannelCommandContext, rawText?: string): ChannelCommandResult {
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
          "- /project [keyword]: find local project folders and let you choose by number.",
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
          `Project: ${context.currentProjectPath ?? "not selected"}`,
          `Pending project choices: ${context.pendingProjectCandidateCount ?? 0}`,
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
    case "/project": {
      const projectQuery = rawText ? extractCommandArgument(rawText) : undefined;
      return {
        name: command,
        shouldDiscoverProject: true,
        projectQuery,
        text: "Searching for local project folders...",
      };
    }
  }
}
