const OPEN_TAG = "<proposed_plan>";
const CLOSE_TAG = "</proposed_plan>";
const MIN_PLAN_CONTENT_LENGTH = 50;

type ParseState = "normal" | "inside" | "completed";

interface ProposedPlanParseResult {
  hasCompletePlan: boolean;
  planContent: string;
  displayText: string;
}

export function parseProposedPlan(text: string): ProposedPlanParseResult {
  const lines = text.split("\n");
  let state: ParseState = "normal";
  const planLines: string[] = [];
  const displayLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed === OPEN_TAG && state === "normal") {
      state = "inside";
      continue;
    }

    if (trimmed === CLOSE_TAG && state === "inside") {
      state = "completed";
      continue;
    }

    if (state === "normal") {
      displayLines.push(line);
    } else if (state === "inside") {
      planLines.push(line);
    }
  }

  const planContent = planLines.join("\n");
  const contentLength = planContent.replace(/\s/g, "").length;
  const hasCompletePlan =
    state === "completed" &&
    contentLength >= MIN_PLAN_CONTENT_LENGTH;

  console.log("[plan:parser] parseState=%s contentLength=%d hasCompletePlan=%s",
    state, contentLength, hasCompletePlan);

  // 如果未闭合（streaming 中途），回退到 displayText，避免丢失文本
  const finalDisplayText =
    state === "inside"
      ? [...displayLines, OPEN_TAG, ...planLines].join("\n")
      : displayLines.join("\n");

  return {
    hasCompletePlan,
    planContent,
    displayText: finalDisplayText,
  };
}
