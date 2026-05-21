import { projectAssistantTextFromSnapshot, projectAssistantReasoningContentFromSnapshot, RunConfig, StateSnapshot } from "@cemeworm/shared";
import { invokeRunProvider } from "./providers/index.js";

export const DEFAULT_SESSION_TITLE = "New Chat";

const SESSION_TITLE_MAX_INPUT_CHARS = 500;
const SESSION_TITLE_MAX_CHARS = 60;
const SESSION_TITLE_FALLBACK_CHARS = 50;

export async function generateSessionTitle(
  snapshot: StateSnapshot,
  existingTitle: string | undefined,
): Promise<string | undefined> {
  if (!shouldGenerateSessionTitle(snapshot, existingTitle)) {
    return undefined;
  }

  const userMsg = snapshot.input.prompt.trim();
  const assistantMsg = assistantTextForRun(snapshot);
  try {
    const toolProviderId = snapshot.config.metadata?.toolModelProviderId;
    const titleConfig = toolProviderId && toolProviderId !== "auto"
      ? { ...snapshot.config, providerId: toolProviderId as string }
      : snapshot.config;
    const response = await invokeRunProvider(titleConfig, {
      system: [
        "You are Ora's conversation title generator.",
        "Generate a concise title in the same language as the user message.",
        "Use at most 6 English words or roughly 16 Chinese characters, and never exceed 60 characters.",
        "Return only the title, with no quotes, markdown, label, or explanation.",
      ].join(" "),
      messages: [{
        role: "user",
        content: [
          "User message:",
          truncateForTitlePrompt(userMsg),
          "",
          "Assistant response:",
          truncateForTitlePrompt(assistantMsg),
        ].join("\n"),
      }],
      temperature: 0,
      maxTokens: 80,
      toolChoice: "none",
    });
    return parseGeneratedSessionTitle(response.text) ?? fallbackSessionTitle(userMsg);
  } catch {
    return fallbackSessionTitle(userMsg);
  }
}

export async function generateSessionTitleFromPrompt(
  prompt: string,
  config: RunConfig,
  existingTitle: string | undefined,
): Promise<string | undefined> {
  if (!prompt.trim()) return undefined;
  if (existingTitle && existingTitle !== DEFAULT_SESSION_TITLE) return undefined;
  const toolProviderId = dedicatedToolProviderId(config);
  if (!toolProviderId) return undefined;

  try {
    const titleConfig = { ...config, providerId: toolProviderId };
    const response = await invokeRunProvider(titleConfig, {
      system: [
        "You are Ora's conversation title generator.",
        "Generate a concise title in the same language as the user message.",
        "Use at most 6 English words or roughly 16 Chinese characters, and never exceed 60 characters.",
        "Return only the title, with no quotes, markdown, label, or explanation.",
      ].join(" "),
      messages: [{
        role: "user",
        content: truncateForTitlePrompt(prompt.trim()),
      }],
      temperature: 0,
      maxTokens: 80,
      toolChoice: "none",
    });
    return parseGeneratedSessionTitle(response.text) ?? fallbackSessionTitle(prompt);
  } catch {
    return fallbackSessionTitle(prompt);
  }
}

function dedicatedToolProviderId(config: RunConfig): string | undefined {
  const toolProviderId = config.metadata?.toolModelProviderId;
  return typeof toolProviderId === "string" &&
    toolProviderId !== "auto" &&
    toolProviderId !== config.providerId
    ? toolProviderId
    : undefined;
}

export function assistantTextForRun(snapshot: StateSnapshot): string {
  return projectAssistantTextFromSnapshot(snapshot);
}

export function assistantReasoningContentForRun(snapshot: StateSnapshot): string | undefined {
  return projectAssistantReasoningContentFromSnapshot(snapshot);
}

export function defaultSessionTitle(prompt: string): string {
  const trimmed = prompt.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 120) : DEFAULT_SESSION_TITLE;
}

export function shouldGenerateSessionTitle(snapshot: StateSnapshot, existingTitle: string | undefined): boolean {
  if (!snapshot.sessionId || snapshot.status === "queued" || snapshot.status === "running") {
    return false;
  }
  if ((snapshot.turnIndex ?? 1) !== 1) {
    return false;
  }
  if (existingTitle && existingTitle !== DEFAULT_SESSION_TITLE) {
    return false;
  }
  return snapshot.input.prompt.trim().length > 0 && assistantTextForRun(snapshot).length > 0;
}

function parseGeneratedSessionTitle(content: string): string | undefined {
  const line = content
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find((item) => item.length > 0);
  if (!line) {
    return undefined;
  }
  const title = line
    .replace(/^#+\s*/, "")
    .replace(/^[*-]\s*/, "")
    .replace(/^title\s*:\s*/i, "")
    .trim()
    .replace(/^["']+|["']+$/g, "")
    .trim();
  if (!title) {
    return undefined;
  }
  return title.length > SESSION_TITLE_MAX_CHARS
    ? title.slice(0, SESSION_TITLE_MAX_CHARS).trim()
    : title;
}

function fallbackSessionTitle(prompt: string): string {
  const trimmed = prompt.trim().replace(/\s+/g, " ");
  if (!trimmed) {
    return DEFAULT_SESSION_TITLE;
  }
  return trimmed.length > SESSION_TITLE_FALLBACK_CHARS
    ? `${trimmed.slice(0, SESSION_TITLE_FALLBACK_CHARS).trim()}...`
    : trimmed;
}

function truncateForTitlePrompt(value: string): string {
  return value.length > SESSION_TITLE_MAX_INPUT_CHARS
    ? value.slice(0, SESSION_TITLE_MAX_INPUT_CHARS)
    : value;
}
