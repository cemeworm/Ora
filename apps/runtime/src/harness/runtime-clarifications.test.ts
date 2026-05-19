import { describe, expect, it } from "vitest";
import { ensureRuntimeClarification, requestIntentClarificationQuestion } from "./runtime-clarifications.js";

describe("runtime clarifications language handling", () => {
  it("keeps intent clarification questions in English for English prompts", async () => {
    const previousFetch = globalThis.fetch;
    process.env.TEST_INTENT_CLARIFICATION_KEY = "test";

    globalThis.fetch = (async () => new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            needsClarification: true,
            question: "Before I continue, which environment should I use for this change?",
            missingVariables: ["environment"],
            counterfactualRiskIfSkipped: "I might run the change in the wrong place.",
          }),
        },
      }],
    }), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;

    try {
      const result = await requestIntentClarificationQuestion("Please continue this deployment for our team.", {
        pattern: "orchestrator_subagent",
        modeId: "single_agent",
        modeSelection: "manual",
        profileIds: ["solo_agent"],
        skillIds: [],
        toolIds: [],
        modelRef: "intent-clarification-model",
        providerId: "intent-clarification-test",
        providerConfig: {
          id: "intent-clarification-test",
          label: "Intent Clarification Test",
          type: "openai_compatible",
          modelId: "intent-clarification-model",
          baseUrl: "https://intent-clarification.test/v1",
          apiKeyEnv: "TEST_INTENT_CLARIFICATION_KEY",
          capabilities: ["chat"],
          headers: {},
        },
        approvalMode: "auto",
        patternOptions: {},
        metadata: {},
      });

      expect(result?.question).toContain("which environment should I use");
      expect(result?.question).not.toMatch(/[\u3400-\u9fff]/u);
    } finally {
      globalThis.fetch = previousFetch;
      delete process.env.TEST_INTENT_CLARIFICATION_KEY;
    }
  });

  it("preserves localized clarification questions in pending clarification records", async () => {
    const pendingClarifications: Array<{ question: string }> = [];
    const emitted: string[] = [];

    await expect(ensureRuntimeClarification({
      id: "clarify-env",
      key: "target_environment",
      nodeId: "node-1",
      nodeLabel: "Node 1",
      question: "你希望我在哪个环境执行这一步？",
    }, {
      answer: () => undefined,
      pendingClarifications: pendingClarifications as never[],
      now: () => 1_000,
      emit: (type) => {
        emitted.push(type);
        return { type } as never;
      },
      currentTaskState: () => undefined,
      resumeClarifications: undefined,
    })).rejects.toMatchObject({ clarification: expect.objectContaining({ question: "你希望我在哪个环境执行这一步？" }) });

    expect(pendingClarifications).toHaveLength(1);
    expect(pendingClarifications[0]?.question).toBe("你希望我在哪个环境执行这一步？");
    expect(emitted).toContain("clarification.required");
  });
});
