import { StateSnapshot } from "@ora/shared";
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
    const response = await invokeRunProvider(snapshot.config, {
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

export function assistantTextForRun(snapshot: StateSnapshot): string {
  if (typeof snapshot.output === "string") {
    return snapshot.output.trim();
  }
  if (snapshot.output && typeof snapshot.output === "object") {
    const candidate = (snapshot.output as Record<string, unknown>).text;
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  for (let index = snapshot.events.length - 1; index >= 0; index -= 1) {
    const event = snapshot.events[index];
    if (!event || event.type !== "message.delta" || !event.payload || typeof event.payload !== "object") {
      continue;
    }
    const content = (event.payload as Record<string, unknown>).content;
    if (typeof content === "string" && content.trim()) {
      return content.trim();
    }
  }
  return "";
}

export function defaultSessionTitle(prompt: string): string {
  const trimmed = prompt.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 120) : DEFAULT_SESSION_TITLE;
}

function shouldGenerateSessionTitle(snapshot: StateSnapshot, existingTitle: string | undefined): boolean {
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
