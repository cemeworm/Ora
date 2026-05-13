import { estimateTextTokens } from "../context-manager.js";

/** Tool IDs whose results should never be truncated (structured/essential output). */
const PRESERVE_TOOL_IDS = new Set(["plan.update", "user.clarify"]);

const DEFAULT_MAX_TOKENS = 2000;

const TRUNCATION_MARKER = (omittedTokens: number) =>
  `\n\n... [truncated ~${omittedTokens} tokens] ...\n\n`;

export interface TruncationOptions {
  toolId: string;
  maxTokens?: number;
}

/**
 * Truncate a tool result text for inclusion in the LLM context.
 * Preserves the head and tail of the output with a 50/50 budget split,
 * inserting a marker in the middle indicating how many tokens were omitted.
 *
 * Tools in PRESERVE_TOOL_IDS are never truncated.
 */
export function truncateToolResultForContext(
  resultText: string,
  options: TruncationOptions,
): string {
  const { toolId, maxTokens = DEFAULT_MAX_TOKENS } = options;

  if (PRESERVE_TOOL_IDS.has(toolId)) {
    return resultText;
  }

  const estimatedTokens = estimateTextTokens(resultText);
  if (estimatedTokens <= maxTokens) {
    return resultText;
  }

  // Use byte-based character budget (4 bytes per token, conservative)
  const maxChars = maxTokens * 4;
  const halfBudget = Math.floor(maxChars / 2);

  const head = resultText.slice(0, halfBudget);
  const tail = resultText.slice(-halfBudget);
  const omittedTokens = estimatedTokens - estimateTextTokens(head) - estimateTextTokens(tail);

  return head + TRUNCATION_MARKER(Math.max(0, omittedTokens)) + tail;
}
