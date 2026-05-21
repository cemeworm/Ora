import type {
  AssistantTurnAttachment,
  AssistantTurnPresentation,
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
  ).filter(dedupeTimelineItemText());
  const hasPlan = Boolean(turn.hasProposedPlan && turn.planContent);
  const timelineContainsBody = visibleTimelineItems.some((item) => {
    if (item.kind === "assistant_text" || item.kind === "final_text") {
      return true;
    }
    return item.kind === "agent_message" && isComparableDuplicate(bodyContent, item.content);
  });

  return {
    primarySurface: hasPlan
      ? "plan"
      : visibleTimelineItems.length > 0
        ? "timeline"
        : "body",
    bodyContent,
    showStandaloneBody: Boolean(
      bodyContent.trim() &&
      !turn.proposedPlanStatus &&
      !(visibleTimelineItems.length > 0 && timelineContainsBody),
    ),
    visibleTimelineItems,
  };
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

function dedupeTimelineItemText(): (item: TurnTimelineItem) => boolean {
  const seen: string[] = [];
  return (item) => {
    if (!("content" in item)) {
      return true;
    }
    const normalized = normalizeComparableText(item.content);
    if (!normalized) {
      return true;
    }
    const duplicate = seen.some((existing) => isComparableDuplicate(existing, normalized));
    if (!duplicate) {
      seen.push(normalized);
    }
    return !duplicate;
  };
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
  if (turn?.status === "running" || isPlaceholder) {
    return items;
  }

  const withoutTrivialCompletedGroups = items.filter((item) => !(
    item.kind === "status_group" &&
    item.status === "complete" &&
    isTrivialCompletedStatusGroup(item)
  ));

  if (
    !bodyContent.trim() ||
    withoutTrivialCompletedGroups.some((item) => item.kind === "assistant_text" || item.kind === "final_text")
  ) {
    return withoutTrivialCompletedGroups;
  }

  const latestNonStatusIndex = findLatestNonStatusTimelineIndex(withoutTrivialCompletedGroups);
  if (latestNonStatusIndex < 0) {
    return withoutTrivialCompletedGroups;
  }
  return withoutTrivialCompletedGroups.filter((item, index) => (
    item.kind !== "status_group" ||
    item.status !== "complete" ||
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
