import { describe, expect, it } from "vitest";
import { getComposerInteractivity } from "../../desktop/src/components/ChatInput";
import { initialWorkbenchState, workbenchReducer } from "../../desktop/src/lib/state";
import type { OraStateSnapshot } from "../../desktop/src/lib/runtimeClient";

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

  it("merges live run stream events into the active snapshot", () => {
    const snapshot = {
      runId: "run-stream",
      status: "running",
      pattern: "orchestrator_subagent",
      input: { prompt: "hello", createdAt: 1 },
      config: { pattern: "orchestrator_subagent", metadata: {} },
      topology: { nodes: [], edges: [] },
      profiles: [],
      memory: [],
      plan: [],
      todos: [],
      actions: [],
      policyDecisions: [],
      checkpoints: [],
      events: [],
      artifacts: [],
      activeAgents: [],
      queueSummary: {},
      sharedStateSummary: {},
      busStats: {},
      pendingClarifications: [],
      pendingApprovals: [],
      updatedAt: 1,
    } as unknown as OraStateSnapshot;

    const next = workbenchReducer({ ...initialWorkbenchState, activeSnapshot: snapshot }, {
      type: "APPLY_RUN_STREAM",
      stream: {
        runId: "run-stream",
        fromSeq: 0,
        nextSeq: 1,
        status: "running",
        events: [{
          id: "run-stream:evt-0",
          runId: "run-stream",
          seq: 0,
          type: "message.delta",
          createdAt: 2,
          pattern: "orchestrator_subagent",
          payload: { role: "assistant", content: "Hel", delta: "Hel" },
        }],
      },
    });

    expect(next.activeSnapshot?.events).toHaveLength(1);
    expect(next.activeSnapshot?.events[0]?.type).toBe("message.delta");
    expect(next.isLoading).toBe(true);
  });
});
