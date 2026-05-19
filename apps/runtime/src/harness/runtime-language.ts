import type { UserTaskInput } from "@cemeworm/shared";

export type RuntimeResponseLanguage = "zh" | "en";

export interface ResolvedRuntimeLanguage {
  responseLanguage: RuntimeResponseLanguage;
  source: "explicit" | "detected" | "context" | "fallback";
}

const ENGLISH_OVERRIDE_PATTERN = /\b(?:answer|respond|reply|write)(?:\s+back)?\s+in\s+english\b|\benglish\s+please\b|\buse\s+english\b/i;
const CHINESE_OVERRIDE_PATTERN = /\b(?:answer|respond|reply|write)(?:\s+back)?\s+in\s+chinese\b|\buse\s+chinese\b|请用中文|用中文回复|中文回答/u;
const CHINESE_SCRIPT_PATTERN = /[\u3400-\u9fff]/u;
const LATIN_LETTER_PATTERN = /[A-Za-z]/;

export function resolveRuntimeResponseLanguage(params: {
  userPrompt: string;
  context?: UserTaskInput["context"];
}): ResolvedRuntimeLanguage {
  const explicit = detectExplicitLanguageRequest(params.userPrompt);
  if (explicit) {
    return { responseLanguage: explicit, source: "explicit" };
  }

  const detected = detectPromptLanguage(params.userPrompt);
  if (detected) {
    return { responseLanguage: detected, source: "detected" };
  }

  const contextual = detectContextLanguage(params.context);
  if (contextual) {
    return { responseLanguage: contextual, source: "context" };
  }

  return { responseLanguage: "en", source: "fallback" };
}

export function prefersChineseResponse(params: {
  userPrompt?: string;
  context?: UserTaskInput["context"];
  language?: RuntimeResponseLanguage;
}): boolean {
  if (params.language) {
    return params.language === "zh";
  }
  return resolveRuntimeResponseLanguage({
    userPrompt: params.userPrompt ?? "",
    context: params.context,
  }).responseLanguage === "zh";
}

function detectExplicitLanguageRequest(prompt: string): RuntimeResponseLanguage | undefined {
  if (!prompt.trim()) {
    return undefined;
  }
  if (ENGLISH_OVERRIDE_PATTERN.test(prompt) || /请用英文|用英文回复|英文回答/u.test(prompt)) {
    return "en";
  }
  if (CHINESE_OVERRIDE_PATTERN.test(prompt)) {
    return "zh";
  }
  return undefined;
}

function detectPromptLanguage(prompt: string): RuntimeResponseLanguage | undefined {
  if (!prompt.trim()) {
    return undefined;
  }
  const hasChinese = CHINESE_SCRIPT_PATTERN.test(prompt);
  const hasLatin = LATIN_LETTER_PATTERN.test(prompt);
  if (hasChinese) {
    return "zh";
  }
  if (hasLatin) {
    return "en";
  }
  return undefined;
}

function detectContextLanguage(context: UserTaskInput["context"] | undefined): RuntimeResponseLanguage | undefined {
  const candidates = [
    readContextString(context?.responseLanguage),
    readContextString(context?.language),
    readContextString(context?.locale),
    readNestedString(context, ["userTemporalContext", "language"]),
    readNestedString(context, ["userTemporalContext", "locale"]),
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    const normalized = normalizeLanguageCandidate(candidate);
    if (normalized) {
      return normalized;
    }
  }
  return undefined;
}

function normalizeLanguageCandidate(value: string): RuntimeResponseLanguage | undefined {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  if (normalized === "zh" || normalized === "zh-cn" || normalized === "zh-hans" || normalized === "chinese" || normalized === "中文") {
    return "zh";
  }
  if (normalized === "en" || normalized === "en-us" || normalized === "en-gb" || normalized === "english" || normalized === "英文") {
    return "en";
  }
  return undefined;
}

function readContextString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readNestedString(value: unknown, path: string[]): string | undefined {
  let current: unknown = value;
  for (const key of path) {
    if (!current || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return readContextString(current);
}
