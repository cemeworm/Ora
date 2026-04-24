import { describe, expect, it } from "vitest";
import { getComposerInteractivity } from "../../desktop/src/components/ChatInput";
import { initialWorkbenchState, workbenchReducer } from "../../desktop/src/lib/state";

describe("desktop composer pending-run behavior", () => {
  it("keeps text entry editable while a run request is pending", () => {
    expect(getComposerInteractivity({ composerPrompt: "next question", isLoading: true })).toEqual({
      canEditText: true,
      canSubmit: false,
    });
  });

  it("only clears the submitted prompt when the user has not typed a new draft", () => {
    const pending = {
      ...initialWorkbenchState,
      promptText: "second prompt typed while first is running",
      isLoading: true,
    };

    const unchanged = workbenchReducer(pending, {
      type: "CLEAR_PROMPT_IF_MATCH",
      text: "first submitted prompt",
    });
    expect(unchanged.promptText).toBe("second prompt typed while first is running");

    const cleared = workbenchReducer({ ...pending, promptText: "first submitted prompt" }, {
      type: "CLEAR_PROMPT_IF_MATCH",
      text: "first submitted prompt",
    });
    expect(cleared.promptText).toBe("");
  });
});
