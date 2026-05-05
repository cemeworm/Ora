import type { CompletionStopReason, ModeSpec } from "@cemeworm/shared";
import type { ModelResponse } from "../providers/index.js";
import { FORCED_FINAL_FALLBACK_TEXT } from "./runtime-completion.js";
import {
  extractRuntimeToolCallFromText,
  type RuntimeToolCall,
} from "./runtime-tool-executor.js";

export interface RuntimeCompletionMetadata {
  stopReason: CompletionStopReason;
  forcedFinal: boolean;
  toolAttempts: number;
  maxToolCalls: number;
  completionPolicy: ModeSpec["completionPolicy"];
}

type RuntimeCompletionEmit = (
  type: "completion.updated",
  payload: unknown,
) => void;

export interface CoerceNoToolResponseDeps {
  toolIds: string[];
  emit: RuntimeCompletionEmit;
  setCompletionStopReason: (reason: CompletionStopReason) => void;
}

export function emitRejectedFinalToolIntent(
  call: RuntimeToolCall,
  reason: CompletionStopReason,
  emit: RuntimeCompletionEmit,
): void {
  emit("completion.updated", {
    state: "tool_call_text_rejected",
    reason,
    toolId: call.tool,
    args: call.args,
  });
}

export function coerceNoToolResponse(
  response: ModelResponse,
  reason: CompletionStopReason,
  deps: CoerceNoToolResponseDeps,
  options: { emitRejectedToolIntent?: boolean } = {},
): ModelResponse {
  const fallbackToolIntent = extractRuntimeToolCallFromText(
    response.text,
    deps.toolIds,
  );
  if (fallbackToolIntent && options.emitRejectedToolIntent !== false) {
    emitRejectedFinalToolIntent(fallbackToolIntent, reason, deps.emit);
  }
  const fallbackText = fallbackToolIntent
    ? FORCED_FINAL_FALLBACK_TEXT
    : response.text.trim() || FORCED_FINAL_FALLBACK_TEXT;
  if ((response.toolCalls?.length ?? 0) > 0) {
    deps.emit("completion.updated", {
      state: "tool_calls_ignored",
      reason,
      ignoredToolCalls: response.toolCalls,
    });
  }
  return {
    ...response,
    text: fallbackText,
    toolCalls: [],
    finishReason:
      response.finishReason === "tool_calls" ? "stop" : response.finishReason,
  };
}

export function forcedFinalSystemPrompt(
  system: string,
  reason: CompletionStopReason,
): string {
  return [
    system,
    "Completion control:",
    `- Stop reason: ${reason}.`,
    "- Do not call tools.",
    "- Use the available conversation and tool results.",
    "- State any uncertainty or missing evidence briefly.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function outputWithCompletionMetadata(
  value: unknown,
  metadata: RuntimeCompletionMetadata,
): unknown {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const existingMetadata =
      record.metadata &&
      typeof record.metadata === "object" &&
      !Array.isArray(record.metadata)
        ? (record.metadata as Record<string, unknown>)
        : {};
    return {
      ...record,
      metadata: {
        ...existingMetadata,
        completion: metadata,
        stopReason: metadata.stopReason,
      },
    };
  }
  return {
    text: typeof value === "string" ? value : String(value ?? ""),
    metadata: {
      completion: metadata,
      stopReason: metadata.stopReason,
    },
  };
}

export function incompleteForcedFinalError(
  value: unknown,
  metadata: RuntimeCompletionMetadata,
): string | undefined {
  if (metadata.forcedFinal && isForcedFinalFallbackOutput(value)) {
    return `Run stopped before completing the task: ${metadata.stopReason}. The model returned only Ora's forced-final fallback.`;
  }
  return undefined;
}

function isForcedFinalFallbackOutput(value: unknown): boolean {
  if (typeof value === "string") {
    return value.trim() === FORCED_FINAL_FALLBACK_TEXT;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.text === "string" &&
    record.text.trim() === FORCED_FINAL_FALLBACK_TEXT
  );
}
