import { describe, expect, it } from "vitest";
import { MVP_MODES, SINGLE_AGENT_MODE_ID } from "@cemeworm/shared";
import {
  resolveAgenticRuntimeScheduling,
  routerCostHintForMode,
  taskIntentFromMetadata,
} from "../src/runtime-scheduling.js";

const defaultBudget = {
  maxTokens: 18_000,
  maxToolCalls: 64,
  maxRuntimeMs: 300_000,
  maxCostUsd: 3,
};

describe("agentic runtime scheduling", () => {
  it("caps chat and plan budgets only when no explicit budget was supplied", () => {
    const chat = resolveAgenticRuntimeScheduling({
      budget: defaultBudget,
      explicitBudget: false,
      metadata: { taskIntent: "chat" },
    });
    expect(chat.budget).toMatchObject({
      maxTokens: 12_000,
      maxToolCalls: 4,
      maxCostUsd: 0.1,
    });
    expect(chat.metadata).toMatchObject({
      policy: "lightweight_budget_cap",
      taskIntent: "chat",
    });

    const explicitPlan = resolveAgenticRuntimeScheduling({
      budget: defaultBudget,
      explicitBudget: true,
      metadata: { taskIntent: "plan" },
    });
    expect(explicitPlan.budget).toEqual(defaultBudget);
    expect(explicitPlan.metadata).toMatchObject({
      policy: "preserve_explicit_budget",
      taskIntent: "plan",
    });
  });

  it("preserves implement and disabled scheduling runs", () => {
    expect(resolveAgenticRuntimeScheduling({
      budget: defaultBudget,
      explicitBudget: false,
      metadata: { taskIntent: "implement" },
    }).budget).toEqual(defaultBudget);

    const disabled = resolveAgenticRuntimeScheduling({
      budget: defaultBudget,
      explicitBudget: false,
      metadata: { taskIntent: "chat", agenticScheduling: false },
    });
    expect(disabled.budget).toEqual(defaultBudget);
    expect(disabled.metadata).toMatchObject({ enabled: false });
  });

  it("exposes task intent and router cost hints", () => {
    expect(taskIntentFromMetadata({ taskIntent: "plan" })).toBe("plan");
    expect(taskIntentFromMetadata({ taskIntent: "unknown" })).toBeUndefined();

    const singleAgent = MVP_MODES.find((mode) => mode.id === SINGLE_AGENT_MODE_ID)!;
    const codeLike = MVP_MODES.find((mode) => mode.id === "agent_teams")!;

    expect(routerCostHintForMode(singleAgent)).toMatchObject({
      costTier: expect.any(String),
      coordinationTier: expect.any(String),
      maxToolCalls: singleAgent.defaultBudget.maxToolCalls,
      maxTokens: singleAgent.defaultBudget.maxTokens,
    });
    expect(routerCostHintForMode(codeLike).coordinationTier).not.toBe("low");
  });
});
