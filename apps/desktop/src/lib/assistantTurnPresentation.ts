import type {
  AssistantTurnAttachment,
  AssistantTurnPresentation,
  TurnAgentConversationMessage,
  TurnClarificationExchange,
  TurnTimelineItem,
} from "../types";

export function deriveAssistantTurnPresentation(params: {
  content: string;
  turn?: AssistantTurnAttachment;
  isPlaceholder?: boolean;
}): AssistantTurnPresentation | undefined {
  const { content, turn, isPlaceholder = false } = params;
  if (!turn) {
    return undefined;
  }

  const clarificationExchanges = turn.clarificationExchanges ?? [];
  const bodyContent = shouldSuppressClarificationBody(content, clarificationExchanges)
    ? ""
    : content;
  const visibleTimelineItems = deriveVisibleTimelineItems(
    turn.timelineItems ?? legacyTimelineItems(turn.processSteps),
    turn,
    bodyContent,
    isPlaceholder,
  );
  const hasTranscript = turn.agentMessages.some((message) => Boolean(message.transcript));
  const hasPlan = Boolean(turn.hasProposedPlan && turn.planContent);
  const timelineContainsAssistantBody = visibleTimelineItems.some((item) =>
    item.kind === "assistant_text" || item.kind === "final_text",
  );
  const transcriptTakeaway = hasTranscript
    ? resolveTranscriptTakeaway(turn.agentMessages, bodyContent)
    : undefined;

  return {
    primarySurface: hasTranscript
      ? "stage_transcript"
      : hasPlan
        ? "plan"
        : visibleTimelineItems.length > 0
          ? "timeline"
          : "body",
    bodyContent,
    showStandaloneBody: Boolean(
      bodyContent.trim() &&
      !turn.proposedPlanStatus &&
      !hasTranscript &&
      !(visibleTimelineItems.length > 0 && timelineContainsAssistantBody),
    ),
    transcriptTakeaway,
    visibleTimelineItems,
  };
}

function resolveTranscriptTakeaway(
  messages: TurnAgentConversationMessage[],
  bodyContent: string,
): string | undefined {
  const normalizedBody = normalizeComparableText(bodyContent);
  if (!normalizedBody) {
    return undefined;
  }

  const transcriptMessages = messages.filter((message) => message.transcript);
  if (transcriptMessages.length === 0) {
    return undefined;
  }

  const explicitNever = transcriptMessages.some((message) => message.transcript?.layout?.supplementalBody === "never");
  const summaryCandidates = transcriptSummaryCandidates(transcriptMessages);
  const duplicatesSummary = summaryCandidates.some((message) =>
    isComparableDuplicate(bodyContent, message.content),
  );

  if (duplicatesSummary || explicitNever) {
    return undefined;
  }

  return bodyContent;
}

function transcriptSummaryCandidates(
  messages: TurnAgentConversationMessage[],
): TurnAgentConversationMessage[] {
  const summaryStageIds = new Set(
    messages.flatMap((message) => message.transcript?.layout?.summaryStageIds ?? []),
  );
  if (summaryStageIds.size > 0) {
    const matched = messages.filter((message) =>
      summaryStageIds.has(message.transcript?.stageId ?? ""),
    );
    if (matched.length > 0) {
      return matched;
    }
  }

  const summaryStances = new Set(
    messages.flatMap((message) => message.transcript?.layout?.summaryStances ?? []),
  );
  if (summaryStances.size > 0) {
    const matched = messages.filter((message) =>
      summaryStances.has(message.transcript?.stance ?? ""),
    );
    if (matched.length > 0) {
      return matched;
    }
  }

  const synthesisLike = messages.filter((message) => {
    const transcript = message.transcript;
    if (!transcript) {
      return false;
    }
    const stageId = transcript.stageId.toLowerCase();
    const stance = transcript.stance.toLowerCase();
    return stageId.includes("synthesis") || stance === "moderator" || stance === "ora";
  });
  if (synthesisLike.length > 0) {
    return synthesisLike;
  }

  return messages.length > 0 ? [messages[messages.length - 1]!] : [];
}

function isComparableDuplicate(left: string, right: string): boolean {
  const normalizedLeft = normalizeComparableText(left);
  const normalizedRight = normalizeComparableText(right);
  if (!normalizedLeft || !normalizedRight) {
    return false;
  }
  if (normalizedLeft === normalizedRight) {
    return true;
  }
  const shorter = normalizedLeft.length <= normalizedRight.length ? normalizedLeft : normalizedRight;
  const longer = shorter === normalizedLeft ? normalizedRight : normalizedLeft;
  return shorter.length >= 24 && longer.includes(shorter);
}

function shouldSuppressClarificationBody(
  content: string,
  exchanges: TurnClarificationExchange[],
): boolean {
  const pendingQuestions = exchanges
    .filter((exchange) => exchange.status === "pending" && !exchange.answer)
    .map((exchange) => exchange.question.trim())
    .filter(Boolean);

  if (pendingQuestions.length === 0) {
    return false;
  }

  return normalizeComparableText(content) === normalizeComparableText(pendingQuestions.join("\n"));
}

function normalizeComparableText(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

function deriveVisibleTimelineItems(
  items: TurnTimelineItem[],
  turn: AssistantTurnAttachment | undefined,
  bodyContent: string,
  isPlaceholder: boolean,
): TurnTimelineItem[] {
  if (
    turn?.status === "running" ||
    isPlaceholder ||
    !bodyContent.trim() ||
    items.some((item) => item.kind === "assistant_text" || item.kind === "final_text")
  ) {
    return items;
  }

  const latestNonStatusIndex = findLatestNonStatusTimelineIndex(items);
  return items.filter((item, index) => (
    item.kind !== "status_group" ||
    item.status !== "complete" ||
    !isTrivialCompletedStatusGroup(item) ||
    index < latestNonStatusIndex
  ));
}

function findLatestNonStatusTimelineIndex(items: TurnTimelineItem[]): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (items[index]?.kind !== "status_group") {
      return index;
    }
  }
  return -1;
}

function isTrivialCompletedStatusGroup(
  item: Extract<TurnTimelineItem, { kind: "status_group" }>,
): boolean {
  const normalizedSummary = item.summary.trim();
  if (normalizedSummary !== "已完成") {
    return false;
  }
  return item.steps.every((step) =>
    [step.label, step.detail].every((text) => !text.trim() || text.trim() === "已完成"),
  );
}

function legacyTimelineItems(processSteps: AssistantTurnAttachment["processSteps"]): TurnTimelineItem[] {
  if (processSteps.length === 0) {
    return [];
  }
  const latest = processSteps[processSteps.length - 1];
  const summaryParts = [
    latest?.eventType === "agent.handoff" ? latest.label : undefined,
    latest?.detail || (latest?.eventType === "agent.handoff" ? undefined : latest?.label),
    latest?.contextLabel ? `对象：${latest.contextLabel}` : undefined,
    latest?.eventType === "agent.handoff" ? "交接" : undefined,
  ].filter(Boolean);
  return [{
    id: `legacy-status:${latest?.id ?? "process"}`,
    kind: "status_group",
    summary: summaryParts.join(" ") || `${processSteps.length} 条执行状态`,
    steps: processSteps,
    timestamp: latest?.timestamp ?? "",
    status: legacyTimelineStatus(processSteps),
  }];
}

function legacyTimelineStatus(processSteps: AssistantTurnAttachment["processSteps"]) {
  if (processSteps.some((step) => step.status === "blocked")) {
    return "blocked" as const;
  }
  if (processSteps.some((step) => step.status === "active")) {
    return "active" as const;
  }
  return "complete" as const;
}
