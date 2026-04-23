import { execFileSync } from "node:child_process";
import type { ProviderConfig } from "@ora/shared";
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

  const choices = record.choices;
  if (Array.isArray(choices)) {
    const choiceParts: string[] = [];
    for (const choice of choices) {
      if (!choice || typeof choice !== "object") {
        continue;
      }

      const message = (choice as Record<string, unknown>).message;
      if (!message || typeof message !== "object") {
        continue;
      }

      const content = (message as Record<string, unknown>).content;
      if (typeof content === "string") {
        choiceParts.push(content);
        continue;
      }

      if (Array.isArray(content)) {
        for (const block of content) {
          if (!block || typeof block !== "object") {
            continue;
          }
          const textBlock = block as Record<string, unknown>;
          if (typeof textBlock.text === "string") {
            choiceParts.push(textBlock.text);
          }
        }
      }
    }

    if (choiceParts.length > 0) {
      return choiceParts.join("");
    }
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

export function readProviderApiKey(
  config: ProviderConfig,
  fallbackEnvName: string | undefined,
  env: NodeJS.ProcessEnv
): string | undefined {
  const candidateEnvNames = [config.apiKeyEnv, fallbackEnvName].filter((name): name is string => Boolean(name));
  for (const envName of candidateEnvNames) {
    const value = env[envName]?.trim();
    if (value) {
      return value;
    }
  }

  return readProviderApiKeyFromKeychain(config.id);
}

function readProviderApiKeyFromKeychain(providerId: string): string | undefined {
  if (process.platform !== "darwin" || !/^[A-Za-z0-9_-]+$/.test(providerId)) {
    return undefined;
  }

  try {
    const output = execFileSync("security", [
      "find-generic-password",
      "-a",
      "Ora",
      "-s",
      `ora.provider.${providerId}`,
      "-w",
    ], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return output.trim() || undefined;
  } catch {
    return undefined;
  }
}

export function resolveProviderEndpoint(params: {
  providerId: string;
  baseUrl: string | undefined;
  defaultOrigin: string;
  path: string;
  env: NodeJS.ProcessEnv;
  allowCustomBaseUrl?: boolean;
}): string {
  const origin = params.baseUrl ?? params.defaultOrigin;
  const url = new URL(params.path, origin);
  const defaultOrigin = new URL(params.defaultOrigin);
  const customBaseAllowed = params.env.ORA_ALLOW_CUSTOM_PROVIDER_BASE_URLS === "true";

  if (url.origin !== defaultOrigin.origin && !customBaseAllowed && params.allowCustomBaseUrl !== true) {
    throw new Error(
      `Custom baseUrl for provider ${params.providerId} requires ORA_ALLOW_CUSTOM_PROVIDER_BASE_URLS=true`
    );
  }

  if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
    throw new Error(`Provider ${params.providerId} endpoint must use HTTPS unless it targets localhost`);
  }

  return url.href;
}
