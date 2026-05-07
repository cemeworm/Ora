import {
  UpdatePlanArgsSchema,
  type PlanListStep,
  type UpdatePlanArgs,
} from "@cemeworm/shared";

export function activePlanStepId(plan: readonly PlanListStep[]): string | undefined {
  return plan.find((item) => item.status === "in_progress")?.id;
}

export function planListUpdatedPayload(args: Record<string, unknown>): UpdatePlanArgs {
  const parsed = UpdatePlanArgsSchema.parse(args);
  const plan = canonicalPlanListSteps(parsed.plan);
  assertPlanListStateInvariant(plan);
  return { ...parsed, plan };
}

export function assertPlanListStateInvariant(plan: readonly PlanListStep[]): void {
  const inProgressCount = plan.filter((item) => item.status === "in_progress").length;
  const allCompleted = plan.every((item) => item.status === "completed");

  if (allCompleted) {
    return;
  }

  if (inProgressCount !== 1) {
    throw new Error("Invalid plan list update: expected exactly one in_progress step unless all steps are completed.");
  }
}

export function advancePlanListFromActiveStep(params: {
  plan: readonly PlanListStep[];
  explanation?: string;
}): UpdatePlanArgs | undefined {
  return advancePlanListFromLifecycle(params);
}

export function advancePlanListFromLifecycle(params: {
  plan: readonly PlanListStep[];
  planStepId?: string;
  explanation?: string;
}): UpdatePlanArgs | undefined {
  const canonicalPlan = canonicalPlanListSteps(params.plan);
  const targetIndex = typeof params.planStepId === "string"
    ? canonicalPlan.findIndex((item) => item.id === params.planStepId && item.status !== "completed")
    : -1;
  if (targetIndex >= 0) {
    return planListUpdatedPayload({
      ...(params.explanation ? { explanation: params.explanation } : {}),
      plan: advancePlanAtIndex(canonicalPlan, targetIndex),
    });
  }

  const activeIndexes = canonicalPlan
    .map((item, index) => item.status === "in_progress" ? index : -1)
    .filter((index) => index >= 0);
  if (activeIndexes.length !== 1) {
    return undefined;
  }

  const activeIndex = activeIndexes[0]!;
  return planListUpdatedPayload({
    ...(params.explanation ? { explanation: params.explanation } : {}),
    plan: advancePlanAtIndex(canonicalPlan, activeIndex),
  });
}

function advancePlanAtIndex(plan: readonly PlanListStep[], targetIndex: number): PlanListStep[] {
  const nextPendingIndex = plan.findIndex((item, index) =>
    index !== targetIndex && item.status === "pending"
  );
  return plan.map((item, index): PlanListStep => {
    if (index === targetIndex) {
      return { ...item, status: "completed" };
    }
    if (index === nextPendingIndex) {
      return { ...item, status: "in_progress" };
    }
    return { ...item };
  });
}

function canonicalPlanListSteps(plan: readonly PlanListStep[]): PlanListStep[] {
  return plan.map((item, index) => ({
    ...item,
    id: item.id ?? planStepIdFor(item.step, index),
  }));
}

function planStepIdFor(step: string, index: number): string {
  const slug = step
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `plan-step-${index + 1}-${slug || "step"}`;
}
