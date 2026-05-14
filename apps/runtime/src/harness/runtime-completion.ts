import type { CompletionStopReason, ModeSpec, RunConfig } from "@cemeworm/shared";
import type { RuntimeToolCall } from "./runtime-tool-executor.js";
import { stableKeyForRuntimeTool, type RuntimeToolAttemptDecision } from "./runtime-tool-loop.js";

export const RUNTIME_TOOL_LOOP_SAFETY_LIMIT = 256;
export const DEFAULT_MAX_TOOL_CALLS = 256;
export const TOOL_TYPE_HARD_LIMIT = 256;
export const FORCED_FINAL_FALLBACK_TEXT = "I need to stop using tools here. Based on the available context, I cannot complete more tool-backed work in this run.";

type RuntimeCompletionEmit = (
  type: "completion.updated",
  payload: unknown,
) => void;

export interface RuntimeToolScope {
  agentId?: string;
  nodeId?: string;
}

export class RuntimeCompletionController {
  private stopReason: CompletionStopReason | undefined;
  private forcedFinalActive = false;
  private forcedFinalConsumed = false;
  private readonly scopedStopReasons = new Map<string, CompletionStopReason>();
  private readonly scopedForcedFinalActive = new Set<string>();
  private readonly scopedForcedFinalConsumed = new Set<string>();
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
    this.runToolBudget = config.budget?.maxToolCalls ?? modeSpec.defaultBudget.maxToolCalls ?? DEFAULT_MAX_TOOL_CALLS;
    this.repeatedToolLimit = Math.max(1, this.policy.maxRepeatedToolCalls);
    this.toolTypeHardLimit = TOOL_TYPE_HARD_LIMIT;
    this.toolTypeWarnLimit = Math.floor(this.toolTypeHardLimit / 2);
  }

  get completionPolicy(): ModeSpec["completionPolicy"] {
    return this.policy;
  }

  get completionStopReason(): CompletionStopReason | undefined {
    return this.stopReason ?? this.firstScopedStopReason();
  }

  get forcedFinal(): boolean {
    return this.forcedFinalActive
      || this.forcedFinalConsumed
      || this.scopedForcedFinalActive.size > 0
      || this.scopedForcedFinalConsumed.size > 0;
  }

  forcedFinalIsActive(scope?: RuntimeToolScope): boolean {
    const scopeKey = this.scopeKey(scope);
    return this.forcedFinalActive || (scopeKey ? this.scopedForcedFinalActive.has(scopeKey) : false);
  }

  stopReasonForScope(scope?: RuntimeToolScope): CompletionStopReason | undefined {
    const scopeKey = this.scopeKey(scope);
    return (scopeKey ? this.scopedStopReasons.get(scopeKey) : undefined) ?? this.stopReason;
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

  forceFinalAnswer(
    reason: CompletionStopReason,
    extra: Record<string, unknown> = {},
    options: { scope?: RuntimeToolScope } = {},
  ): void {
    const scopeKey = this.scopeKey(options.scope);
    if (scopeKey) {
      this.scopedStopReasons.set(scopeKey, reason);
    } else {
      this.setCompletionStopReason(reason);
    }
    const alreadyActive = scopeKey
      ? this.scopedForcedFinalActive.has(scopeKey)
      : this.forcedFinalActive;
    if (!alreadyActive) {
      this.emit("completion.updated", {
        state: "force_final",
        reason,
        toolAttempts: this.toolAttemptsValue,
        maxToolCalls: this.runToolBudget,
        policy: this.policy,
        ...(scopeKey ? { scopeKey } : {}),
        ...extra,
      });
    }
    if (scopeKey) {
      this.scopedForcedFinalActive.add(scopeKey);
    } else {
      this.forcedFinalActive = true;
    }
  }

  markForcedFinalConsumed(scope?: RuntimeToolScope): void {
    const scopeKey = this.scopeKey(scope);
    if (scopeKey) {
      this.scopedForcedFinalConsumed.add(scopeKey);
      return;
    }
    this.forcedFinalConsumed = true;
  }

  toolsAllowed(scope?: RuntimeToolScope): boolean {
    return !this.forcedFinalIsActive(scope) && this.toolAttemptsValue < this.runToolBudget;
  }

  registerToolAttempt(call: RuntimeToolCall, scope?: RuntimeToolScope): RuntimeToolAttemptDecision {
    if (this.toolAttemptsValue >= this.runToolBudget) {
      if (this.policy.forceFinalOnBudgetExhausted) {
        this.forceFinalAnswer("tool_budget_exhausted");
      }
      return { allowed: false, reason: "tool_budget_exhausted" };
    }

    const repeatDecision = this.decideRepeatedToolAttempt(call, scope);
    if (repeatDecision.shouldWarn && !this.warnedRepeatedToolKeys.has(repeatDecision.key)) {
      this.warnedRepeatedToolKeys.add(repeatDecision.key);
      this.emit("completion.updated", {
        state: "loop_warning",
        reason: "repeated_tool_blocked",
        toolId: call.tool,
        repeatCount: repeatDecision.repeatCount,
        repeatedToolLimit: this.repeatedToolLimit,
        key: repeatDecision.key,
        toolKey: repeatDecision.toolKey,
        ...(repeatDecision.scopeKey ? { scopeKey: repeatDecision.scopeKey } : {}),
      });
    }
    if (repeatDecision.shouldBlock && this.policy.forceFinalOnRepeatedTool) {
      if (!this.warnedRepeatedToolKeys.has(repeatDecision.key)) {
        this.warnedRepeatedToolKeys.add(repeatDecision.key);
        this.emit("completion.updated", {
          state: "loop_warning",
          reason: "repeated_tool_blocked",
          toolId: call.tool,
          repeatCount: repeatDecision.repeatCount,
          repeatedToolLimit: this.repeatedToolLimit,
          key: repeatDecision.key,
          toolKey: repeatDecision.toolKey,
          ...(repeatDecision.scopeKey ? { scopeKey: repeatDecision.scopeKey } : {}),
        });
      }
      this.forceFinalAnswer("repeated_tool_blocked", {
        toolId: call.tool,
        repeatCount: repeatDecision.repeatCount,
        repeatedToolLimit: this.repeatedToolLimit,
        key: repeatDecision.key,
        toolKey: repeatDecision.toolKey,
        ...(repeatDecision.scopeKey ? { scopeKey: repeatDecision.scopeKey } : {}),
      }, repeatDecision.scopeKey ? { scope } : {});
      return { allowed: false, reason: "repeated_tool_blocked", key: repeatDecision.key, repeatCount: repeatDecision.repeatCount };
    }

    this.repeatedToolCounts.set(repeatDecision.key, repeatDecision.repeatCount);
    const toolTypeCount = (this.toolTypeCounts.get(call.tool) ?? 0) + 1;
    this.toolTypeCounts.set(call.tool, toolTypeCount);
    this.toolAttemptsValue += 1;
    if (toolTypeCount >= this.toolTypeHardLimit) {
      this.forceFinalAnswer("tool_frequency_exhausted", {
        toolId: call.tool,
        toolTypeCount,
        toolTypeHardLimit: this.toolTypeHardLimit,
      });
      return {
        allowed: false,
        reason: "tool_frequency_exhausted",
        key: repeatDecision.key,
        repeatCount: repeatDecision.repeatCount,
        toolTypeCount,
      };
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
    return { allowed: true, key: repeatDecision.key, repeatCount: repeatDecision.repeatCount, toolTypeCount };
  }

  private decideRepeatedToolAttempt(call: RuntimeToolCall, scope?: RuntimeToolScope): {
    toolKey: string;
    scopeKey: string | undefined;
    key: string;
    repeatCount: number;
    shouldWarn: boolean;
    shouldBlock: boolean;
  } {
    const toolKey = stableKeyForRuntimeTool(call);
    const scopeKey = this.scopeKey(scope);
    const key = scopeKey ? `${scopeKey}:${toolKey}` : toolKey;
    const repeatCount = (this.repeatedToolCounts.get(key) ?? 0) + 1;
    return {
      toolKey,
      scopeKey,
      key,
      repeatCount,
      shouldWarn: repeatCount === this.repeatedToolLimit && repeatCount > 1,
      shouldBlock: repeatCount > this.repeatedToolLimit,
    };
  }

  markToolResultObserved(call: RuntimeToolCall, _cacheHit: boolean, _scope?: RuntimeToolScope): void {
    if (this.toolAttemptsValue >= this.runToolBudget && this.policy.forceFinalOnBudgetExhausted) {
      this.forceFinalAnswer("tool_budget_exhausted", { toolId: call.tool });
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
      stopReason: this.completionStopReason ?? "completed",
      forcedFinal: this.forcedFinal,
      toolAttempts: this.toolAttemptsValue,
      maxToolCalls: this.runToolBudget,
      completionPolicy: this.policy,
    };
  }

  private scopeKey(scope?: RuntimeToolScope): string | undefined {
    const agentId = scope?.agentId?.trim();
    const nodeId = scope?.nodeId?.trim();
    if (!agentId && !nodeId) {
      return undefined;
    }
    return `agent:${agentId || "unknown"}|node:${nodeId || agentId || "unknown"}`;
  }

  private firstScopedStopReason(): CompletionStopReason | undefined {
    for (const reason of this.scopedStopReasons.values()) {
      return reason;
    }
    return undefined;
  }
}
