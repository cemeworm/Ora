import {
  inspectProposedPlanContract,
  resolvePublicAssistantText,
  type AssistantOutputRejectionReason,
  type CompletionStopReason,
  type ModeSpec,
} from "@cemeworm/shared";
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

export interface FinalOutputContractViolation {
  reason: AssistantOutputRejectionReason;
  visibleText: string;
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
  const violation = finalOutputContractViolation(value);
  if (violation) {
    return finalOutputViolationMessage(violation.reason);
  }
  return undefined;
}

export function finalOutputContractViolation(
  value: unknown,
): FinalOutputContractViolation | undefined {
  const text = outputText(value);
  if (text === undefined) {
    return undefined;
  }
  const resolved = resolvePublicAssistantText(text);
  if (!resolved.isRejected) {
    const proposedPlan = inspectProposedPlanContract(text);
    if (proposedPlan.gateEligibility === "hard_invalid_multiple") {
      return {
        reason: "invalid_multiple_proposed_plans",
        visibleText: proposedPlan.displayText,
      };
    }
    if (proposedPlan.gateEligibility === "hard_invalid_malformed") {
      return {
        reason: "invalid_malformed_proposed_plan",
        visibleText: proposedPlan.displayText,
      };
    }
    return undefined;
  }
  return {
    reason: resolved.rejectionReason ?? "empty",
    visibleText: resolved.visibleText,
  };
}

export function finalOutputViolationMessage(
  reason: AssistantOutputRejectionReason,
): string {
  switch (reason) {
    case "internal_protocol":
      return "Run cannot complete: final output contains internal protocol text.";
    case "recovery_fallback":
      return "Run cannot complete: final output resolved to recovery fallback text.";
    case "invalid_multiple_proposed_plans":
      return "Run cannot complete: final output contains multiple complete proposed_plan blocks.";
    case "invalid_malformed_proposed_plan":
      return "Run cannot complete: final output contains a malformed proposed_plan block.";
    case "empty":
    default:
      return "Run cannot complete: final output is empty after public-output filtering.";
  }
}

function outputText(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value.trim() || undefined;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  return typeof record.text === "string" && record.text.trim()
    ? record.text.trim()
    : undefined;
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
