const OPEN_TAG = "<proposed_plan>";
const MIN_COMPLETE_PLAN_CONTENT_LENGTH = 50;

export type ProposedPlanContractStatus =
  | "none"
  | "streaming_single"
  | "complete_single"
  | "invalid_multiple"
  | "invalid_malformed";

export interface ProposedPlanContractResult {
  status: ProposedPlanContractStatus;
  hasStartedPlan: boolean;
  hasCompletePlan: boolean;
  completePlanCount: number;
  startedPlanCount: number;
  completePlanContent?: string;
  displayText: string;
  rawPlanContent?: string;
}

export function inspectProposedPlanContract(
  text: string | null | undefined,
): ProposedPlanContractResult {
  const source = typeof text === "string" ? text : "";
  const completeMatches = [...source.matchAll(/<proposed_plan>\s*([\s\S]+?)\s*<\/proposed_plan>/g)];
  const openMatches = [...source.matchAll(/<proposed_plan>/g)];
  const closeMatches = [...source.matchAll(/<\/proposed_plan>/g)];
  const completePlanCount = completeMatches.length;
  const startedPlanCount = openMatches.length;

  if (completePlanCount > 1) {
    return {
      status: "invalid_multiple",
      hasStartedPlan: true,
      hasCompletePlan: false,
      completePlanCount,
      startedPlanCount,
      displayText: trimBoundaryWhitespace(stripAllProposedPlanBlocks(source)),
    };
  }

  if (completePlanCount === 1) {
    const match = completeMatches[0];
    const rawPlanContent = match?.[1] ?? "";
    const planContent = trimBoundaryWhitespace(rawPlanContent);
    const contentLength = planContent.replace(/\s/g, "").length;
    const start = match?.index ?? 0;
    const end = start + (match?.[0].length ?? 0);
    const displayText = trimBoundaryWhitespace(`${source.slice(0, start)}${source.slice(end)}`);
    if (startedPlanCount !== 1 || closeMatches.length !== 1 || contentLength < MIN_COMPLETE_PLAN_CONTENT_LENGTH) {
      return {
        status: "invalid_malformed",
        hasStartedPlan: true,
        hasCompletePlan: false,
        completePlanCount,
        startedPlanCount,
        displayText,
        rawPlanContent: planContent,
      };
    }
    return {
      status: "complete_single",
      hasStartedPlan: true,
      hasCompletePlan: true,
      completePlanCount,
      startedPlanCount,
      completePlanContent: planContent,
      displayText,
      rawPlanContent: planContent,
    };
  }

  const openIndex = source.indexOf(OPEN_TAG);
  if (openIndex === -1) {
    if (closeMatches.length > 0) {
      return {
        status: "invalid_malformed",
        hasStartedPlan: false,
        hasCompletePlan: false,
        completePlanCount: 0,
        startedPlanCount: 0,
        displayText: trimBoundaryWhitespace(source.replace(/<\/proposed_plan>/g, "")),
      };
    }
    return {
      status: "none",
      hasStartedPlan: false,
      hasCompletePlan: false,
      completePlanCount: 0,
      startedPlanCount: 0,
      displayText: trimBoundaryWhitespace(source),
    };
  }

  return {
    status: closeMatches.length > 0 || startedPlanCount > 1 ? "invalid_malformed" : "streaming_single",
    hasStartedPlan: true,
    hasCompletePlan: false,
    completePlanCount: 0,
    startedPlanCount,
    displayText: trimBoundaryWhitespace(source.slice(0, openIndex)),
    rawPlanContent: trimBoundaryWhitespace(source.slice(openIndex + OPEN_TAG.length)),
  };
}

function stripAllProposedPlanBlocks(text: string): string {
  return text.replace(/<proposed_plan>\s*[\s\S]+?\s*<\/proposed_plan>/g, "");
}

function trimBoundaryWhitespace(value: string): string {
  return value.replace(/^\s+|\s+$/g, "");
}
