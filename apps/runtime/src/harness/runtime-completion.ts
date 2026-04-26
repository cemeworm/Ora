import type { CompletionStopReason, ModeSpec, RunConfig } from "@ora/shared";
import type { RuntimeToolCall } from "./runtime-tool-executor.js";
import { stableKeyForRuntimeTool, type RuntimeToolAttemptDecision } from "./runtime-tool-loop.js";

export const RUNTIME_TOOL_LOOP_SAFETY_LIMIT = 64;
export const FORCED_FINAL_FALLBACK_TEXT = "I need to stop using tools here. Based on the available context, I cannot complete more tool-backed work in this run.";

type RuntimeCompletionEmit = (
  type: "completion.updated",
  payload: unknown,
) => void;

export class RuntimeCompletionController {
  private stopReason: CompletionStopReason | undefined;
  private forcedFinalActive = false;
  private forcedFinalConsumed = false;
  private toolAttemptsValue = 0;
  private readonly repeatedToolCounts = new Map<string, number>();
  private readonly warnedRepeatedToolKeys = new Set<string>();
  private readonly toolTypeCounts = new Map<string, number>();
  private readonly warnedToolTypes = new Set<string>();
  private readonly policy: ModeSpec["completionPolicy"];
  private readonly runToolBudget: number;
  private readonly repeatedToolLimit: number;
  private readonly toolTypeHardLimit: number;
  private readonly toolTypeWarnLimit: number;

  constructor(
    config: RunConfig,
    modeSpec: ModeSpec,
    private readonly emit: RuntimeCompletionEmit,
  ) {
    this.policy = config.completionPolicy ?? modeSpec.completionPolicy;
    this.runToolBudget = config.budget?.maxToolCalls ?? Number.MAX_SAFE_INTEGER;
    this.repeatedToolLimit = Math.max(1, this.policy.maxRepeatedToolCalls);
    const finiteRunToolBudget = Number.isFinite(this.runToolBudget) ? this.runToolBudget : 16;
    this.toolTypeHardLimit = Math.max(4, Math.ceil(finiteRunToolBudget * 0.75));
    this.toolTypeWarnLimit = Math.max(3, Math.floor(this.toolTypeHardLimit / 2));
  }

  get completionPolicy(): ModeSpec["completionPolicy"] {
    return this.policy;
  }

  get completionStopReason(): CompletionStopReason | undefined {
    return this.stopReason;
  }

  get forcedFinal(): boolean {
    return this.forcedFinalActive || this.forcedFinalConsumed;
  }

  get forcedFinalIsActive(): boolean {
    return this.forcedFinalActive;
  }

  get toolAttempts(): number {
    return this.toolAttemptsValue;
  }

  get maxToolCalls(): number {
    return this.runToolBudget;
  }

  setCompletionStopReason(reason: CompletionStopReason): void {
    this.stopReason ??= reason;
  }

  forceFinalAnswer(reason: CompletionStopReason, extra: Record<string, unknown> = {}): void {
    this.setCompletionStopReason(reason);
    if (!this.forcedFinalActive) {
      this.emit("completion.updated", {
        state: "force_final",
        reason,
        toolAttempts: this.toolAttemptsValue,
        maxToolCalls: this.runToolBudget,
        policy: this.policy,
        ...extra,
      });
    }
    this.forcedFinalActive = true;
  }

  markForcedFinalConsumed(): void {
    this.forcedFinalConsumed = true;
  }

  toolsAllowed(): boolean {
    return !this.forcedFinalActive && this.toolAttemptsValue < this.runToolBudget;
  }

  registerToolAttempt(call: RuntimeToolCall): RuntimeToolAttemptDecision {
    if (this.toolAttemptsValue >= this.runToolBudget) {
      if (this.policy.forceFinalOnBudgetExhausted) {
        this.forceFinalAnswer("tool_budget_exhausted");
      }
      return { allowed: false, reason: "tool_budget_exhausted" };
    }

    const key = stableKeyForRuntimeTool(call);
    const repeatCount = (this.repeatedToolCounts.get(key) ?? 0) + 1;
    if (repeatCount === this.repeatedToolLimit && repeatCount > 1 && !this.warnedRepeatedToolKeys.has(key)) {
      this.warnedRepeatedToolKeys.add(key);
      this.emit("completion.updated", {
        state: "loop_warning",
        reason: "repeated_tool_blocked",
        toolId: call.tool,
        repeatCount,
        repeatedToolLimit: this.repeatedToolLimit,
        key,
      });
    }
    if (repeatCount > this.repeatedToolLimit && this.policy.forceFinalOnRepeatedTool) {
      if (!this.warnedRepeatedToolKeys.has(key)) {
        this.warnedRepeatedToolKeys.add(key);
        this.emit("completion.updated", {
          state: "loop_warning",
          reason: "repeated_tool_blocked",
          toolId: call.tool,
          repeatCount,
          repeatedToolLimit: this.repeatedToolLimit,
          key,
        });
      }
      this.forceFinalAnswer("repeated_tool_blocked", {
        toolId: call.tool,
        repeatCount,
        repeatedToolLimit: this.repeatedToolLimit,
        key,
      });
      return { allowed: false, reason: "repeated_tool_blocked", key, repeatCount };
    }

    this.repeatedToolCounts.set(key, repeatCount);
    const toolTypeCount = (this.toolTypeCounts.get(call.tool) ?? 0) + 1;
    this.toolTypeCounts.set(call.tool, toolTypeCount);
    this.toolAttemptsValue += 1;
    if (toolTypeCount >= this.toolTypeHardLimit) {
      this.forceFinalAnswer("tool_frequency_exhausted", {
        toolId: call.tool,
        toolTypeCount,
        toolTypeHardLimit: this.toolTypeHardLimit,
      });
      return { allowed: false, reason: "tool_frequency_exhausted", key, repeatCount, toolTypeCount };
    }
    if (toolTypeCount >= this.toolTypeWarnLimit && !this.warnedToolTypes.has(call.tool)) {
      this.warnedToolTypes.add(call.tool);
      this.emit("completion.updated", {
        state: "loop_warning",
        reason: "tool_frequency_exhausted",
        toolId: call.tool,
        toolTypeCount,
        toolTypeWarnLimit: this.toolTypeWarnLimit,
        toolTypeHardLimit: this.toolTypeHardLimit,
      });
    }
    return { allowed: true, key, repeatCount, toolTypeCount };
  }

  markToolResultObserved(call: RuntimeToolCall, cacheHit: boolean): void {
    if (this.toolAttemptsValue >= this.runToolBudget && this.policy.forceFinalOnBudgetExhausted) {
      this.forceFinalAnswer("tool_budget_exhausted", { toolId: call.tool });
      return;
    }
    if (cacheHit && this.policy.forceFinalOnRepeatedTool) {
      this.forceFinalAnswer("repeated_tool_blocked", { toolId: call.tool, cacheHit });
    }
  }

  metadata(): {
    stopReason: CompletionStopReason;
    forcedFinal: boolean;
    toolAttempts: number;
    maxToolCalls: number;
    completionPolicy: ModeSpec["completionPolicy"];
  } {
    return {
      stopReason: this.stopReason ?? "completed",
      forcedFinal: this.forcedFinal,
      toolAttempts: this.toolAttemptsValue,
      maxToolCalls: this.runToolBudget,
      completionPolicy: this.policy,
    };
  }
}
