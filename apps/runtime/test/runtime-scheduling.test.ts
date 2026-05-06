import { describe, expect, it } from "vitest";
import { CODE_DEVELOPMENT_MODE_ID, MVP_MODES, SINGLE_AGENT_MODE_ID } from "@cemeworm/shared";
import {
  resolveAgenticRuntimeScheduling,
  routerCostHintForMode,
  taskIntentFromMetadata,
} from "../src/runtime-scheduling.js";

const defaultBudget = {
  maxTokens: 18_000,
  maxToolCalls: 256,
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
      maxToolCalls: 256,
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

    const plan = resolveAgenticRuntimeScheduling({
      budget: defaultBudget,
      explicitBudget: false,
      metadata: { taskIntent: "plan" },
    });
    expect(plan.budget).toMatchObject({
      maxTokens: 18_000,
      maxToolCalls: 256,
      maxCostUsd: 0.5,
    });
  });

  it("gives code development plan runs a larger planning budget", () => {
    const codeDevelopmentMode = MVP_MODES.find((mode) => mode.id === CODE_DEVELOPMENT_MODE_ID)!;

    const plan = resolveAgenticRuntimeScheduling({
      budget: codeDevelopmentMode.defaultBudget,
      explicitBudget: false,
      metadata: { taskIntent: "plan" },
      modeSpec: codeDevelopmentMode,
    });

    expect(plan.budget).toMatchObject({
      maxTokens: 24_000,
      maxToolCalls: 256,
      maxCostUsd: 1,
    });
    expect(plan.metadata).toMatchObject({
      policy: "lightweight_budget_cap",
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
