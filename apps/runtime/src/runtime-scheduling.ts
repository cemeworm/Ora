import type { ModeSpec, ResourceBudget, RunConfig, TaskIntent } from "@cemeworm/shared";

const LIGHTWEIGHT_CAPS: Record<Extract<TaskIntent, "chat" | "plan">, {
  maxTokens: number;
  maxToolCalls: number;
  maxCostUsd: number;
}> = {
  chat: {
    maxTokens: 12_000,
    maxToolCalls: 4,
    maxCostUsd: 0.1,
  },
  plan: {
    maxTokens: 16_000,
    maxToolCalls: 8,
    maxCostUsd: 0.25,
  },
};

export interface AgenticRuntimeSchedulingResult {
  budget: ResourceBudget;
  metadata?: Record<string, unknown>;
}

export interface RouterCostHint {
  costTier: "low" | "medium" | "high";
  coordinationTier: "low" | "medium" | "high";
  maxToolCalls: number;
  maxTokens: number;
}

export function resolveAgenticRuntimeScheduling(params: {
  budget: ResourceBudget;
  explicitBudget: boolean;
  metadata: RunConfig["metadata"];
}): AgenticRuntimeSchedulingResult {
  if (params.metadata.agenticScheduling === false || params.metadata.agenticScheduling === "disabled") {
    return {
      budget: params.budget,
      metadata: {
        enabled: false,
        reason: "disabled_by_run_metadata",
      },
    };
  }
  const taskIntent = taskIntentFromMetadata(params.metadata);
  if (!taskIntent || taskIntent === "implement") {
    return {
      budget: params.budget,
      metadata: {
        enabled: true,
        policy: "observe",
        reason: taskIntent === "implement" ? "implement_intent_preserves_mode_budget" : "no_lightweight_task_intent",
      },
    };
  }
  if (params.explicitBudget) {
    return {
      budget: params.budget,
      metadata: {
        enabled: true,
        policy: "preserve_explicit_budget",
        taskIntent,
      },
    };
  }

  const caps = LIGHTWEIGHT_CAPS[taskIntent];
  const budget = {
    ...params.budget,
    maxTokens: Math.min(params.budget.maxTokens, caps.maxTokens),
    maxToolCalls: Math.min(params.budget.maxToolCalls, caps.maxToolCalls),
    maxCostUsd: Math.min(params.budget.maxCostUsd ?? caps.maxCostUsd, caps.maxCostUsd),
  };
  const changed = budget.maxTokens !== params.budget.maxTokens
    || budget.maxToolCalls !== params.budget.maxToolCalls
    || budget.maxCostUsd !== params.budget.maxCostUsd;
  return {
    budget,
    metadata: {
      enabled: true,
      policy: changed ? "lightweight_budget_cap" : "within_lightweight_budget",
      taskIntent,
      caps,
      originalBudget: params.budget,
      budget,
    },
  };
}

export function routerCostHintForMode(mode: ModeSpec): RouterCostHint {
  const budget = mode.defaultBudget;
  const maxToolCalls = budget.maxToolCalls;
  const maxTokens = budget.maxTokens;
  const coordinationWeight = mode.profiles.length + mode.nodes.length + mode.edges.length;
  return {
    costTier: maxToolCalls <= 8 && maxTokens <= 12_000
      ? "low"
      : maxToolCalls <= 32 && maxTokens <= 18_000
        ? "medium"
        : "high",
    coordinationTier: coordinationWeight <= 6
      ? "low"
      : coordinationWeight <= 12
        ? "medium"
        : "high",
    maxToolCalls,
    maxTokens,
  };
}

export function taskIntentFromMetadata(metadata: RunConfig["metadata"]): TaskIntent | undefined {
  const value = metadata.taskIntent;
  return value === "chat" || value === "plan" || value === "implement" ? value : undefined;
}
