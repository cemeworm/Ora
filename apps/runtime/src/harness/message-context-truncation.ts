import type { ModelMessage } from "../providers/index.js";
import { estimateMessagesTokens, estimateTextTokens } from "../context-manager.js";
import { truncateToolResultForContext } from "./tool-result-truncation.js";

const WORKSPACE_TOOL_RESULT_PREFIX = "Workspace tool result for ";
const DEFAULT_PRESERVE_RECENT = 3;
const DEFAULT_RETROACTIVE_BUDGET_TOKENS = 800;

export interface RetroactiveTruncationOptions {
  /**
   * Number of leading messages that must not be modified (provider cache prefix).
   * Typically matches `providerCache.stablePrefixMessageCount`.
   */
  stablePrefixCount: number;
  /** Target token budget for the whole messages array (including system). */
  targetTokens: number;
  /** Preserve this many most-recent tool result messages untouched (default 3). */
  preserveRecentCount?: number;
  /** Token budget applied to each individual truncated tool result (default 800). */
  perResultBudgetTokens?: number;
  /** Optional system prompt text, included in token estimation. */
  system?: string;
}

export interface RetroactiveTruncationResult {
  messages: ModelMessage[];
  tokensBefore: number;
  tokensAfter: number;
  /** Number of tool result messages that were actually rewritten. */
  truncatedCount: number;
}

interface ToolResultCandidate {
  /** Index in the original messages array. */
  index: number;
  /** Estimated token cost of this message's content. */
  tokens: number;
  /** Tool id extracted from content, for targeted truncation/preservation. */
  toolId: string;
  /** Whether this is a native `role: "tool"` message vs. the wrapped user-role variant. */
  kind: "tool" | "user-wrapped";
}

/**
 * Extract the tool id from a tool-result-bearing message, or null if this message
 * is not recognizable as a tool result.
 */
function classifyToolResult(message: ModelMessage, index: number): ToolResultCandidate | null {
  const content = typeof message.content === "string" ? message.content : "";
  if (message.role === "tool") {
    return {
      index,
      tokens: estimateTextTokens(content),
      toolId: message.toolName ?? "unknown",
      kind: "tool",
    };
  }
  if (message.role === "user" && content.startsWith(WORKSPACE_TOOL_RESULT_PREFIX)) {
    // Extract tool id between prefix and first colon+newline.
    const headerEnd = content.indexOf(":\n");
    const toolId = headerEnd > 0
      ? content.slice(WORKSPACE_TOOL_RESULT_PREFIX.length, headerEnd)
      : "unknown";
    return {
      index,
      tokens: estimateTextTokens(content),
      toolId,
      kind: "user-wrapped",
    };
  }
  return null;
}

/**
 * Produce a truncated-content message, preserving role/metadata but shortening the content.
 * Reapplies the `Workspace tool result for <id>:\n` header for user-wrapped variants.
 */
function truncateMessageContent(
  message: ModelMessage,
  candidate: ToolResultCandidate,
  budgetTokens: number,
): ModelMessage {
  const content = typeof message.content === "string" ? message.content : "";
  if (candidate.kind === "tool") {
    const truncated = truncateToolResultForContext(content, {
      toolId: candidate.toolId,
      maxTokens: budgetTokens,
    });
    return { ...message, content: truncated };
  }
  // user-wrapped: strip header, truncate body, reapply header.
  const header = `${WORKSPACE_TOOL_RESULT_PREFIX}${candidate.toolId}:\n`;
  const body = content.startsWith(header) ? content.slice(header.length) : content;
  const truncatedBody = truncateToolResultForContext(body, {
    toolId: candidate.toolId,
    maxTokens: budgetTokens,
  });
  return { ...message, content: header + truncatedBody };
}

/**
 * Retroactively truncate old tool-result messages in the volatile tail when the
 * conversation has grown beyond the target token budget.
 *
 * Design goals:
 * - Never modify messages within the provider cache's stable prefix (index < stablePrefixCount).
 * - Preserve the most-recent `preserveRecentCount` tool results intact so the model
 *   still has full context for its current reasoning step.
 * - Target the largest tool results first to maximize savings per edit.
 * - Re-truncate-to-budget iteratively until tokens fall under `targetTokens` or
 *   no more candidates remain.
 */
export function retroactivelyTruncateMessages(
  messages: readonly ModelMessage[],
  options: RetroactiveTruncationOptions,
): RetroactiveTruncationResult {
  const {
    stablePrefixCount,
    targetTokens,
    preserveRecentCount = DEFAULT_PRESERVE_RECENT,
    perResultBudgetTokens = DEFAULT_RETROACTIVE_BUDGET_TOKENS,
    system,
  } = options;

  const tokensBefore = estimateMessagesTokens(messages, system);
  if (tokensBefore <= targetTokens) {
    return {
      messages: [...messages],
      tokensBefore,
      tokensAfter: tokensBefore,
      truncatedCount: 0,
    };
  }

  // Identify all tool result candidates in the volatile tail.
  const allCandidates: ToolResultCandidate[] = [];
  for (let i = Math.max(0, stablePrefixCount); i < messages.length; i++) {
    const candidate = classifyToolResult(messages[i], i);
    if (candidate) {
      allCandidates.push(candidate);
    }
  }

  // Exclude the most-recent N candidates.
  const truncatableCandidates = allCandidates.slice(
    0,
    Math.max(0, allCandidates.length - preserveRecentCount),
  );

  if (truncatableCandidates.length === 0) {
    return {
      messages: [...messages],
      tokensBefore,
      tokensAfter: tokensBefore,
      truncatedCount: 0,
    };
  }

  // Sort by token size descending: hit biggest offenders first.
  truncatableCandidates.sort((a, b) => b.tokens - a.tokens);

  const nextMessages: ModelMessage[] = [...messages];
  let tokensAfter = tokensBefore;
  let truncatedCount = 0;

  for (const candidate of truncatableCandidates) {
    if (tokensAfter <= targetTokens) break;
    const original = nextMessages[candidate.index];
    const rewritten = truncateMessageContent(original, candidate, perResultBudgetTokens);
    if (rewritten.content === original.content) {
      // Already within budget; skip.
      continue;
    }
    nextMessages[candidate.index] = rewritten;
    truncatedCount += 1;
    tokensAfter = estimateMessagesTokens(nextMessages, system);
  }

  return {
    messages: nextMessages,
    tokensBefore,
    tokensAfter,
    truncatedCount,
  };
}
