import type { ModelMessage, ModelRequest } from "./types.js";

export function normalizeMessages(request: ModelRequest): ModelMessage[] {
  if (request.messages && request.messages.length > 0) {
    return [...request.messages];
  }

  const prompt = request.prompt?.trim();
  if (prompt) {
    return [{ role: "user", content: prompt }];
  }

  return [];
}

export function splitInstructionMessages(messages: readonly ModelMessage[]): {
  instructions: string;
  dialog: ModelMessage[];
} {
  const instructionParts: string[] = [];
  const dialog: ModelMessage[] = [];

  for (const message of messages) {
    if (message.role === "system" || message.role === "developer") {
      instructionParts.push(message.content.trim());
    } else {
      dialog.push(message);
    }
  }

  return {
    instructions: instructionParts.filter(Boolean).join("\n\n"),
    dialog,
  };
}

export function toInputText(content: string) {
  return [{ type: "input_text", text: content }];
}

export function appendIfDefined<T extends object, K extends string, V>(
  target: T,
  key: K,
  value: V | undefined
): T & Record<K, V> {
  if (value === undefined) {
    return target as T & Record<K, V>;
  }

  return { ...target, [key]: value } as T & Record<K, V>;
}

export function extractTextFromValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (!value || typeof value !== "object") {
    return "";
  }

  const record = value as Record<string, unknown>;

  if (typeof record.output_text === "string") {
    return record.output_text;
  }

  const directContent = record.content;
  if (Array.isArray(directContent)) {
    const directParts: string[] = [];
    for (const block of directContent) {
      if (!block || typeof block !== "object") {
        continue;
      }

      const textBlock = block as Record<string, unknown>;
      if (typeof textBlock.text === "string") {
        directParts.push(textBlock.text);
      }
    }

    if (directParts.length > 0) {
      return directParts.join("");
    }
  }

  const output = record.output;
  if (!Array.isArray(output)) {
    return "";
  }

  const parts: string[] = [];
  for (const item of output) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const entry = item as Record<string, unknown>;
    if (entry.type !== "message" || !Array.isArray(entry.content)) {
      continue;
    }

    for (const block of entry.content) {
      if (!block || typeof block !== "object") {
        continue;
      }

      const textBlock = block as Record<string, unknown>;
      if (typeof textBlock.text === "string") {
        parts.push(textBlock.text);
      }
    }
  }

  return parts.join("");
}

export function failMissingApiKey(providerId: string, envName: string): Error {
  return new Error(`Missing ${envName} for provider ${providerId}`);
}

export function resolveProviderEndpoint(params: {
  providerId: string;
  baseUrl: string | undefined;
  defaultOrigin: string;
  path: string;
  env: NodeJS.ProcessEnv;
}): string {
  const origin = params.baseUrl ?? params.defaultOrigin;
  const url = new URL(params.path, origin);
  const defaultOrigin = new URL(params.defaultOrigin);
  const customBaseAllowed = params.env.ORA_ALLOW_CUSTOM_PROVIDER_BASE_URLS === "true";

  if (url.origin !== defaultOrigin.origin && !customBaseAllowed) {
    throw new Error(
      `Custom baseUrl for provider ${params.providerId} requires ORA_ALLOW_CUSTOM_PROVIDER_BASE_URLS=true`
    );
  }

  if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
    throw new Error(`Provider ${params.providerId} endpoint must use HTTPS unless it targets localhost`);
  }

  return url.href;
}
