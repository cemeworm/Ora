import { describe, expect, it } from "vitest";
import { getComposerTrayVisibility } from "./ChatInput";

describe("chat input tray visibility", () => {
  it("prioritizes clarification over plan decision", () => {
    expect(getComposerTrayVisibility({
      isLoading: false,
      clarificationCount: 2,
      canSubmitClarifications: true,
      hasPlanDecision: true,
      canResolvePlanDecision: true,
    })).toEqual({
      showClarificationTray: true,
      showPlanDecisionTray: false,
      hideComposer: true,
    });
  });

  it("shows plan decision after clarifications are resolved", () => {
    expect(getComposerTrayVisibility({
      isLoading: false,
      clarificationCount: 0,
      canSubmitClarifications: true,
      hasPlanDecision: true,
      canResolvePlanDecision: true,
    })).toEqual({
      showClarificationTray: false,
      showPlanDecisionTray: true,
      hideComposer: true,
    });
  });

  it("keeps the composer available for ordinary clarification resumes", () => {
    expect(getComposerTrayVisibility({
      isLoading: false,
      clarificationCount: 1,
      canSubmitClarifications: true,
      hasPlanDecision: false,
      canResolvePlanDecision: false,
    })).toEqual({
      showClarificationTray: true,
      showPlanDecisionTray: false,
      hideComposer: false,
    });
  });
});
