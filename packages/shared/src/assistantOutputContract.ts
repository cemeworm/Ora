export type AssistantOutputRejectionReason =
  | "internal_protocol"
  | "recovery_fallback"
  | "empty";

export interface PublicAssistantTextResolution {
  rawText: string;
  visibleText: string;
  acceptedText: string | undefined;
  containsInternalProtocol: boolean;
  isRecoveryFallback: boolean;
  isEmpty: boolean;
  isRejected: boolean;
  rejectionReason?: AssistantOutputRejectionReason;
}

const INTERNAL_META_TAG_RE = /<\/?(?:tool_plan_mode_reminder|file_grep_policy)[^>]*>/gi;
const DSML_PROTOCOL_LINE_RE =
  /<[^>\n]*DSML[^>\n]*(?:tool_calls|tool_call|invoke|parameter|previous_tool_call|result)?\b/i;
const INTERNAL_PROTOCOL_LINE_RE =
  /<\/?(?:tool_call|previous_tool_call|result|file\.(?:read|list|grep|glob|write|patch|apply_patch))\b/i;
const INLINE_TOOL_JSON_RE =
  /\{"tool"\s*:\s*"[a-z0-9_.-]+"\s*,\s*"args"\s*:\s*\{[\s\S]*?\}\s*\}/gi;
const INLINE_TOOL_JSON_DETECT_RE =
  /\{"tool"\s*:\s*"[a-z0-9_.-]+"\s*,\s*"args"\s*:\s*\{/i;

export function isInternalAssistantText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }
  if (/<\/?tool_plan_mode_reminder\b|<\/?file_grep_policy\b/i.test(trimmed)) {
    return true;
  }
  if (
    /<[^>]*DSML[^>]*(?:tool_calls|invoke|parameter|previous_tool_call|result)\b/i.test(trimmed)
  ) {
    return true;
  }
  if (/<tool_call\b|<\/?previous_tool_call\b|<\/?result\b/i.test(trimmed)) {
    return true;
  }
  if (/parameter\s+name=|<file\.(?:read|list|grep|glob|write|patch|apply_patch)\b[^>]*\/?>/i.test(trimmed)) {
    return true;
  }
  return INLINE_TOOL_JSON_DETECT_RE.test(trimmed);
}

export function isInternalRecoveryFallbackText(text: string): boolean {
  const trimmed = text.trim();
  return (
    trimmed.startsWith("[tool-error-boundary]") ||
    trimmed.startsWith("[recovery:fallback]")
  );
}

export function isInternalDeltaText(text: string): boolean {
  return isInternalRecoveryFallbackText(text) || isInternalAssistantText(text);
}

export function stripInternalAssistantProtocolText(text: string): string {
  if (!text.trim()) {
    return "";
  }
  const lines = text
    .replace(INTERNAL_META_TAG_RE, "")
    .replace(INLINE_TOOL_JSON_RE, "")
    .split(/\r?\n/)
    .filter((line) => !DSML_PROTOCOL_LINE_RE.test(line))
    .filter((line) => !INTERNAL_PROTOCOL_LINE_RE.test(line));
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function resolvePublicAssistantText(text: string | null | undefined): PublicAssistantTextResolution {
  const rawText = typeof text === "string" ? text.trim() : "";
  if (!rawText) {
    return {
      rawText,
      visibleText: "",
      acceptedText: undefined,
      containsInternalProtocol: false,
      isRecoveryFallback: false,
      isEmpty: true,
      isRejected: true,
      rejectionReason: "empty",
    };
  }

  const isRecoveryFallback = isInternalRecoveryFallbackText(rawText);
  const containsInternalProtocol = isInternalAssistantText(rawText);
  const visibleText = containsInternalProtocol
    ? stripInternalAssistantProtocolText(rawText)
    : rawText;

  if (isRecoveryFallback) {
    return {
      rawText,
      visibleText,
      acceptedText: undefined,
      containsInternalProtocol,
      isRecoveryFallback,
      isEmpty: false,
      isRejected: true,
      rejectionReason: "recovery_fallback",
    };
  }

  if (containsInternalProtocol) {
    return {
      rawText,
      visibleText,
      acceptedText: undefined,
      containsInternalProtocol,
      isRecoveryFallback: false,
      isEmpty: false,
      isRejected: true,
      rejectionReason: "internal_protocol",
    };
  }

  return {
    rawText,
    visibleText,
    acceptedText: visibleText || undefined,
    containsInternalProtocol: false,
    isRecoveryFallback: false,
    isEmpty: false,
    isRejected: !visibleText,
    rejectionReason: visibleText ? undefined : "empty",
  };
}
