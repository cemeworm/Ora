import { inspectProposedPlanContract } from "@cemeworm/shared";

const PARSE_CACHE_LIMIT = 16;
const PARSE_CACHE_MAX_TEXT_LENGTH = 200_000;

type ProposedPlanStatus = "none" | "streaming" | "complete" | "invalid";

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
  const inspected = inspectProposedPlanContract(text);
  switch (inspected.status) {
    case "none":
      return {
        status: "none",
        hasStartedPlan: false,
        hasCompletePlan: false,
        planContent: "",
        displayText: inspected.displayText,
      };
    case "streaming_single":
      return {
        status: "streaming",
        hasStartedPlan: true,
        hasCompletePlan: false,
        planContent: inspected.rawPlanContent ?? "",
        displayText: inspected.displayText,
      };
    case "complete_single":
      return {
        status: "complete",
        hasStartedPlan: true,
        hasCompletePlan: true,
        planContent: inspected.completePlanContent ?? "",
        displayText: inspected.displayText,
      };
    case "invalid_multiple":
    case "invalid_malformed":
      return {
        status: "invalid",
        hasStartedPlan: true,
        hasCompletePlan: false,
        planContent: "",
        displayText: inspected.displayText,
      };
  }
}

function shouldCacheParse(text: string): boolean {
  return text.length <= PARSE_CACHE_MAX_TEXT_LENGTH && text.includes("<proposed_plan");
}

function trimBoundaryWhitespace(value: string): string {
  return value.replace(/^\s+|\s+$/g, "");
}
