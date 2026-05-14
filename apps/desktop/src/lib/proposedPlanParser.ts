const OPEN_TAG = "<proposed_plan>";
const CLOSE_TAG = "</proposed_plan>";
const MIN_PLAN_CONTENT_LENGTH = 50;
const PARSE_CACHE_LIMIT = 16;
const PARSE_CACHE_MAX_TEXT_LENGTH = 200_000;

type ProposedPlanStatus = "none" | "streaming" | "complete";

interface ProposedPlanParseResult {
  status: ProposedPlanStatus;
  hasStartedPlan: boolean;
  hasCompletePlan: boolean;
  planContent: string;
  displayText: string;
}

const parseCache = new Map<string, ProposedPlanParseResult>();

export function parseProposedPlan(text: string): ProposedPlanParseResult {
  const useCache = shouldCacheParse(text);
  if (useCache) {
    const cached = parseCache.get(text);
    if (cached) {
      parseCache.delete(text);
      parseCache.set(text, cached);
      return cached;
    }
  }

  const result = parseProposedPlanUncached(text);
  if (useCache) {
    parseCache.set(text, result);
    if (parseCache.size > PARSE_CACHE_LIMIT) {
      const oldestKey = parseCache.keys().next().value;
      if (typeof oldestKey === "string") {
        parseCache.delete(oldestKey);
      }
    }
  }
  return result;
}

function parseProposedPlanUncached(text: string): ProposedPlanParseResult {
  const openIndex = text.indexOf(OPEN_TAG);
  if (openIndex === -1) {
    return {
      status: "none",
      hasStartedPlan: false,
      hasCompletePlan: false,
      planContent: "",
      displayText: trimBoundaryWhitespace(text),
    };
  }

  const planStart = openIndex + OPEN_TAG.length;
  const closeIndex = text.indexOf(CLOSE_TAG, planStart);
  const hasClosingTag = closeIndex !== -1;
  const rawPlanContent = hasClosingTag
    ? text.slice(planStart, closeIndex)
    : text.slice(planStart);
  const planContent = trimBoundaryWhitespace(rawPlanContent);
  const contentLength = planContent.replace(/\s/g, "").length;
  const displayText = trimBoundaryWhitespace(
    hasClosingTag
      ? `${text.slice(0, openIndex)}${text.slice(closeIndex + CLOSE_TAG.length)}`
      : text.slice(0, openIndex),
  );

  return {
    status: hasClosingTag ? "complete" : "streaming",
    hasStartedPlan: true,
    hasCompletePlan: hasClosingTag && contentLength >= MIN_PLAN_CONTENT_LENGTH,
    planContent,
    displayText,
  };
}

function shouldCacheParse(text: string): boolean {
  return text.length <= PARSE_CACHE_MAX_TEXT_LENGTH && text.includes("<proposed_plan");
}

function trimBoundaryWhitespace(value: string): string {
  return value.replace(/^\s+|\s+$/g, "");
}
