const OPEN_TAG = "<proposed_plan>";
const CLOSE_TAG = "</proposed_plan>";
const MIN_PLAN_CONTENT_LENGTH = 50;

type ParseState = "normal" | "inside" | "completed";
type ProposedPlanStatus = "none" | "streaming" | "complete";

interface ProposedPlanParseResult {
  status: ProposedPlanStatus;
  hasStartedPlan: boolean;
  hasCompletePlan: boolean;
  planContent: string;
  displayText: string;
}

export function parseProposedPlan(text: string): ProposedPlanParseResult {
  let state: ParseState = "normal";
  const planParts: string[] = [];
  const displayParts: string[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    if (state === "normal") {
      const openIndex = text.indexOf(OPEN_TAG, cursor);
      if (openIndex === -1) {
        displayParts.push(text.slice(cursor));
        break;
      }
      displayParts.push(text.slice(cursor, openIndex));
      cursor = openIndex + OPEN_TAG.length;
      state = "inside";
      continue;
    }

    if (state === "inside") {
      const closeIndex = text.indexOf(CLOSE_TAG, cursor);
      if (closeIndex === -1) {
        planParts.push(text.slice(cursor));
        cursor = text.length;
        break;
      }
      planParts.push(text.slice(cursor, closeIndex));
      cursor = closeIndex + CLOSE_TAG.length;
      state = "completed";
      continue;
    }

    displayParts.push(text.slice(cursor));
    break;
  }

  const planContent = trimBoundaryWhitespace(planParts.join(""));
  const contentLength = planContent.replace(/\s/g, "").length;
  const status: ProposedPlanStatus =
    state === "inside" ? "streaming" : state === "completed" ? "complete" : "none";
  const hasStartedPlan = status !== "none";
  const hasCompletePlan =
    state === "completed" &&
    contentLength >= MIN_PLAN_CONTENT_LENGTH;

  console.log("[plan:parser] parseState=%s contentLength=%d hasCompletePlan=%s",
    state, contentLength, hasCompletePlan);

  return {
    status,
    hasStartedPlan,
    hasCompletePlan,
    planContent,
    displayText: trimBoundaryWhitespace(displayParts.join("")),
  };
}

function trimBoundaryWhitespace(value: string): string {
  return value.replace(/^\s+|\s+$/g, "");
}
