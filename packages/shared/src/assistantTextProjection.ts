import { ORA_ROOT_AGENT_ID } from "./primitives.js";

export interface AssistantDeltaProjection {
  text: string;
}

export function mergeAssistantDeltaProjection(
  current: AssistantDeltaProjection | undefined,
  payload: Record<string, unknown>,
): AssistantDeltaProjection | undefined {
  const currentText = current?.text ?? "";
  const text = mergeAssistantDeltaText(currentText, payload);
  if (!text) {
    return current;
  }
  return { text };
}

export function mergeAssistantDeltaText(
  currentText: string,
  payload: Record<string, unknown>,
): string {
  const delta = typeof payload.delta === "string" ? payload.delta : undefined;
  if (delta) {
    return `${currentText}${delta}`;
  }

  const content = typeof payload.content === "string" ? payload.content : undefined;
  if (!content) {
    return currentText;
  }
  if (!currentText || content.startsWith(currentText)) {
    return content;
  }
  if (content === currentText || currentText.endsWith(content)) {
    return currentText;
  }
  return `${currentText}${content}`;
}

export function isInternalDeltaPayload(payload: Record<string, unknown>): boolean {
  if (
    payload.visibility === "internal" ||
    payload.audience === "internal" ||
    payload.public === false
  ) {
    return true;
  }
  return false;
}

export function isCollaborationDeltaPayload(payload: Record<string, unknown>): boolean {
  return (
    payload.visibility === "collaboration" ||
    payload.audience === "collaboration" ||
    payload.surface === "collaboration"
  );
}

export function isInternalAssistantText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }
  if (/<\/?tool_plan_mode_reminder\b|<\/?file_grep_policy\b/i.test(trimmed)) {
    return true;
  }
  if (/<[^>]*DSML[^>]*tool_calls|<tool_call\b|parameter\s+name=|<\/?previous_tool_call\b|<\/?result\b/i.test(trimmed)) {
    return true;
  }
  if (/<file\.(?:read|list|grep|glob)\b[^>]*\/?>/i.test(trimmed)) {
    return true;
  }
  return /^\{"tool"\s*:\s*"[a-z0-9_.-]+"\s*,\s*"args"\s*:/i.test(trimmed);
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

export interface ProjectAssistantTextOptions {
  publicOnly?: boolean;
  maxChars?: number;
}

export function projectAssistantTextFromEvents(
  events: ReadonlyArray<{
    type: string;
    payload?: unknown;
    agentId?: string | null;
  }>,
  options: ProjectAssistantTextOptions = {},
): string {
  const { publicOnly = true, maxChars } = options;
  let text = "";

  for (const event of events) {
    if (event.type !== "message.delta") {
      continue;
    }
    if (!isRecord(event.payload)) {
      continue;
    }
    const payload = event.payload as Record<string, unknown>;
    if (publicOnly && (isInternalDeltaPayload(payload) || isCollaborationDeltaPayload(payload))) {
      continue;
    }
    const deltaText =
      typeof payload.delta === "string" ? payload.delta
      : typeof payload.content === "string" ? payload.content
      : "";
    if (publicOnly && isInternalDeltaText(deltaText)) {
      continue;
    }
    text = mergeAssistantDeltaText(text, payload);
  }

  if (maxChars !== undefined && text.length > maxChars) {
    return text.slice(0, maxChars);
  }
  return text;
}

export function projectAssistantReasoningContentFromSnapshot(
  snapshot: {
    output?: unknown;
    events: ReadonlyArray<{
      type: string;
      payload?: unknown;
      agentId?: string | null;
    }>;
  },
): string | undefined {
  const outputReasoning = extractOutputReasoningContent(snapshot.output);
  if (outputReasoning) {
    return outputReasoning;
  }
  return projectAssistantReasoningContentFromEvents(snapshot.events);
}

export function projectAssistantTextFromSnapshot(
  snapshot: {
    output?: unknown;
    childSessions?: ReadonlyArray<{ agentId: string }>;
    events: ReadonlyArray<{
      type: string;
      payload?: unknown;
      agentId?: string | null;
    }>;
  },
  options: ProjectAssistantTextOptions = {},
): string {
  const { publicOnly = true, maxChars } = options;

  const outputText = extractOutputText(snapshot.output);
  if (outputText !== undefined) {
    if (publicOnly && isInternalRecoveryFallbackText(outputText)) {
      // fall through to events
    } else {
      return maxChars !== undefined && outputText.length > maxChars
        ? outputText.slice(0, maxChars)
        : outputText;
    }
  }

  const childAgentIds = new Set((snapshot.childSessions ?? []).map((c) => c.agentId));

  return projectAssistantTextFromEvents(
    snapshot.events.filter((event) => !isHiddenChildAssistantEvent(childAgentIds, event)),
    options,
  );
}

function extractOutputText(output: unknown): string | undefined {
  if (typeof output === "string" && output.trim()) {
    return output.trim();
  }
  if (isRecord(output) && typeof (output as Record<string, unknown>).text === "string") {
    const text = (output as Record<string, unknown>).text as string;
    return text.trim() || undefined;
  }
  return undefined;
}

function extractOutputReasoningContent(output: unknown): string | undefined {
  if (isRecord(output) && typeof (output as Record<string, unknown>).reasoningContent === "string") {
    const rc = (output as Record<string, unknown>).reasoningContent as string;
    return rc.trim() || undefined;
  }
  return undefined;
}

function isHiddenChildAssistantEvent(
  childAgentIds: Set<string>,
  event: {
    type: string;
    agentId?: string | null;
  },
): boolean {
  if (event.type !== "message.delta") {
    return false;
  }
  const agentId = typeof event.agentId === "string" ? event.agentId : undefined;
  if (!agentId || agentId === ORA_ROOT_AGENT_ID) {
    return false;
  }
  return childAgentIds.has(agentId);
}

function projectAssistantReasoningContentFromEvents(
  events: ReadonlyArray<{
    type: string;
    payload?: unknown;
    agentId?: string | null;
  }>,
): string | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event.type !== "message.delta") continue;
    if (!isRecord(event.payload)) continue;
    const rc = (event.payload as Record<string, unknown>).reasoningContent;
    if (typeof rc === "string" && rc.trim()) return rc.trim();
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
