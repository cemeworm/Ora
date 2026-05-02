import type { OraEventEnvelope, RunConfig } from "@cemeworm/shared";
import { invokeRunProvider } from "../providers/index.js";
import {
  normalizeProgressNarration,
  summarizeNarratorProgressPayload,
} from "./runtime-prompts.js";

const PROGRESS_NARRATION_MAX_TOKENS = 96;

type RuntimeProgressEmit = (
  type: OraEventEnvelope["type"],
  payload: unknown,
  extra?: Partial<OraEventEnvelope>,
) => OraEventEnvelope;

export interface RuntimeProgressNarrationParams {
  trigger: string;
  agentId?: string;
  nodeId?: string;
  title?: string;
  detail?: string;
}

export interface RuntimeProgressNarrationDeps {
  config: RunConfig;
  userPrompt: string;
  events: OraEventEnvelope[];
  activeAgentCount: () => number;
  planStatuses: () => Array<string | undefined>;
  todoStatuses: () => Array<string | undefined>;
  emit: RuntimeProgressEmit;
}

export async function emitRuntimeProgressNarration(
  params: RuntimeProgressNarrationParams,
  deps: RuntimeProgressNarrationDeps,
): Promise<void> {
  if (deps.config.metadata.progressNarration !== true) {
    return;
  }
  if (!hasAssistantTextDelta(deps.events)) {
    return;
  }
  const basedOnSeq = deps.events.at(-1)?.seq ?? -1;
  try {
    const recentEvents = deps.events.slice(-8).map((event) => ({
      kind: narratorEventKind(event.type),
      payload: summarizeNarratorProgressPayload(event.type, event.payload),
    })).filter((event) => event.payload !== undefined);
    const response = await invokeRunProvider(deps.config, {
      system: [
        "You write concise live progress updates for an assistant run.",
        "Match the user's language. If the user wrote in Chinese, write the progress update in Chinese.",
        "Describe only what has happened, what is being worked on, and the likely next step.",
        "Do not claim the final answer is known. Do not output tool JSON. Do not mention internal event names, mode names, stage names, routing, subscribers, or sequence numbers.",
        "Prefer user-facing work verbs such as reading, searching, comparing, drafting, checking, and waiting for approval.",
        "Return one complete natural sentence under 64 words, ending with sentence-final punctuation such as ., !, ?, 。, ！, or ？.",
      ].join("\n"),
      messages: [
        {
          role: "user",
          content: JSON.stringify({
            userPrompt: deps.userPrompt,
            languageInstruction:
              "Use the same language as userPrompt for the progress update.",
            activeAgentCount: deps.activeAgentCount(),
            planStatusCounts: countStatuses(deps.planStatuses()),
            todoStatusCounts: countStatuses(deps.todoStatuses()),
            recentEvents,
          }),
        },
      ],
      temperature: 0.2,
      maxTokens: PROGRESS_NARRATION_MAX_TOKENS,
      toolChoice: "none",
    });
    const summary = normalizeProgressNarration(response.text);
    if (!summary) {
      return;
    }
    deps.emit(
      "task.progress",
      {
        kind: "chat_progress",
        source: "progress_narrator",
        trigger: params.trigger,
        title: params.title,
        detail: params.detail,
        summary,
        basedOnSeq,
      },
      { agentId: params.agentId, nodeId: params.nodeId },
    );
  } catch {
    // Progress narration is cosmetic; provider failures must never affect the run.
  }
}

function hasAssistantTextDelta(events: readonly OraEventEnvelope[]): boolean {
  return events.some((event) => {
    if (event.type !== "message.delta" || !event.payload || typeof event.payload !== "object") {
      return false;
    }
    const payload = event.payload as Record<string, unknown>;
    return payload.role === "assistant" && typeof payload.content === "string" && payload.content.trim().length > 0;
  });
}

function countStatuses(statuses: Array<string | undefined>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const status of statuses) {
    if (!status) {
      continue;
    }
    counts[status] = (counts[status] ?? 0) + 1;
  }
  return counts;
}

function narratorEventKind(eventType: string): string {
  if (eventType.startsWith("tool.")) {
    return "tool_activity";
  }
  if (eventType.startsWith("approval.")) {
    return "approval";
  }
  if (eventType.startsWith("clarification.")) {
    return "clarification";
  }
  if (eventType.startsWith("task.")) {
    return "work_progress";
  }
  if (eventType.startsWith("recovery.")) {
    return "recovery";
  }
  if (eventType.startsWith("run.")) {
    return "run_status";
  }
  return "activity";
}
