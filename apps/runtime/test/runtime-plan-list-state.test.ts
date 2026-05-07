import { describe, expect, it } from "vitest";
import {
  advancePlanListFromActiveStep,
  advancePlanListFromLifecycle,
  assertPlanListStateInvariant,
  planListUpdatedPayload,
} from "../src/harness/runtime-plan-list-state.js";

describe("runtime plan list state", () => {
  it("accepts a plan with exactly one in-progress step", () => {
    expect(planListUpdatedPayload({
      explanation: "Initial plan",
      plan: [
        { step: "Inspect current behavior", status: "in_progress" },
        { step: "Implement runtime ownership", status: "pending" },
      ],
    })).toEqual({
      explanation: "Initial plan",
      plan: [
        { id: "plan-step-1-inspect-current-behavior", step: "Inspect current behavior", status: "in_progress" },
        { id: "plan-step-2-implement-runtime-ownership", step: "Implement runtime ownership", status: "pending" },
      ],
    });
  });

  it("accepts a fully completed plan", () => {
    expect(() => assertPlanListStateInvariant([
      { step: "Inspect current behavior", status: "completed" },
      { step: "Implement runtime ownership", status: "completed" },
    ])).not.toThrow();
  });

  it("rejects unfinished plans with no in-progress step", () => {
    expect(() => planListUpdatedPayload({
      plan: [
        { step: "Inspect current behavior", status: "completed" },
        { step: "Implement runtime ownership", status: "pending" },
      ],
    })).toThrow(/exactly one in_progress/);
  });

  it("rejects plans with multiple in-progress steps", () => {
    expect(() => planListUpdatedPayload({
      plan: [
        { step: "Inspect current behavior", status: "in_progress" },
        { step: "Implement runtime ownership", status: "in_progress" },
      ],
    })).toThrow(/exactly one in_progress/);
  });

  it("advances the active lifecycle step and activates the next pending step", () => {
    expect(stripIds(advancePlanListFromActiveStep({
      plan: [
        { step: "Implement runtime ownership", status: "in_progress" },
        { step: "Verify regression", status: "pending" },
      ],
    })?.plan)).toEqual([
      { step: "Implement runtime ownership", status: "completed" },
      { step: "Verify regression", status: "in_progress" },
    ]);
  });

  it("completes the final active lifecycle step", () => {
    expect(stripIds(advancePlanListFromActiveStep({
      plan: [
        { step: "Verify regression", status: "in_progress" },
      ],
    })?.plan)).toEqual([
      { step: "Verify regression", status: "completed" },
    ]);
  });

  it("advances a bound plan step id before falling back to the active step", () => {
    expect(stripIds(advancePlanListFromLifecycle({
      plan: [
        { id: "step-a", step: "First active step", status: "in_progress" },
        { id: "step-b", step: "Bound tool step", status: "pending" },
      ],
      planStepId: "step-b",
    })?.plan)).toEqual([
      { step: "First active step", status: "in_progress" },
      { step: "Bound tool step", status: "completed" },
    ]);
  });

  it("does not lifecycle-advance without exactly one active step", () => {
    expect(advancePlanListFromActiveStep({
      plan: [
        { step: "Implement runtime ownership", status: "pending" },
      ],
    })).toBeUndefined();
  });
});

function stripIds(plan: Array<{ id?: string; step: string; status: string }> | undefined) {
  return plan?.map(({ step, status }) => ({ step, status }));
}
