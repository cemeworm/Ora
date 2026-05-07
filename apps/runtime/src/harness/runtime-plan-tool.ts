import type { RuntimeToolDefinition } from "./capability-registries.js";
import { planListUpdatedPayload } from "./runtime-plan-list-state.js";
import type { RuntimeToolExecutionContext } from "./runtime-tool-executor.js";

export function planToolRuntimeFields(toolId: string): Partial<RuntimeToolDefinition<RuntimeToolExecutionContext>> {
  if (toolId !== "plan.update") {
    return {};
  }
  return {
    promptExample: "{\"tool\":\"plan.update\",\"args\":{\"explanation\":\"Initial plan for the task\",\"plan\":[{\"step\":\"Research the codebase\",\"status\":\"in_progress\"},{\"step\":\"Implement the changes\",\"status\":\"pending\"},{\"step\":\"Test and verify\",\"status\":\"pending\"}]}}",
    promptGuidelines: [
      "Plan list rules:\n- Use plan.update to create a short plan (3-7 steps) for non-trivial tasks.\n- Each step must use pending/in_progress/completed as its status.\n- When you begin work on a step, mark it in_progress and mark the previously in_progress step as completed.\n- Always maintain exactly one in_progress step until the plan is fully completed.\n- When you finish all steps, mark them all as completed.\n- Submit the complete plan array each time — no incremental edits.\n- plan.update is NOT available in plan mode — plan mode is for producing a proposed plan, not for tracking execution.",
    ],
    execute: (args, context) => {
      if (context.taskIntent === "plan") {
        throw new Error("plan.update is not available in plan mode. Plan mode is for producing a proposed plan, not for managing a task checklist.");
      }
      return { output: handleUpdatePlan(args) };
    },
  };
}

function handleUpdatePlan(args: Record<string, unknown>): string {
  const parsed = planListUpdatedPayload(args);
  return `Plan updated with ${parsed.plan.length} steps.`;
}
