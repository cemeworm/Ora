import type { PatternExecutionContext } from "../patterns/execution-context.js";

export type RuntimePatternExecutionContextParams = Omit<
  PatternExecutionContext,
  "queueSummary" | "sharedStateSummary" | "busStats"
> & {
  queueSummary: () => PatternExecutionContext["queueSummary"];
  sharedStateSummary: () => PatternExecutionContext["sharedStateSummary"];
  busStats: () => PatternExecutionContext["busStats"];
};

export function createRuntimePatternExecutionContext(
  params: RuntimePatternExecutionContextParams,
): PatternExecutionContext {
  return {
    ...params,
    get queueSummary() {
      return params.queueSummary();
    },
    get sharedStateSummary() {
      return params.sharedStateSummary();
    },
    get busStats() {
      return params.busStats();
    },
  };
}

export interface KernelPatternExecutionContextAdapter {
  create(): PatternExecutionContext;
}

export function createKernelPatternExecutionContextAdapter(
  params: RuntimePatternExecutionContextParams,
): KernelPatternExecutionContextAdapter {
  return {
    create: () => createRuntimePatternExecutionContext(params),
  };
}
