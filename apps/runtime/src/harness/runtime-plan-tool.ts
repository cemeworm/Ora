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
      "Plan list rules:\n- Use plan.update for a short sequential checklist (3-7 steps) on non-trivial tasks.\n- Each step must use pending/in_progress/completed as its status.\n- Only one checklist step may be in_progress at a time while work is active.\n- If work is parallel, keep a single umbrella step in_progress and describe the parallel work in the step text or in the surrounding tool/result evidence.\n- When you finish all steps, mark them all as completed.\n- Submit the complete plan array each time — no incremental edits.\n- plan.update is NOT available in plan mode — plan mode is for producing a proposed plan, not for tracking execution.",
    ],
    execute: (args, context) => {
      if (context.taskIntent === "plan") {
        throw new Error("plan.update is not available in plan mode. Plan mode is for producing a proposed plan, not for managing an execution checklist.");
      }
      return { output: handleUpdatePlan(args) };
    },
  };
}

function handleUpdatePlan(args: Record<string, unknown>): string {
  const parsed = planListUpdatedPayload(args);
  return `Plan updated with ${parsed.plan.length} steps.`;
}
