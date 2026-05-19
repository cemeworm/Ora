import { describe, expect, it } from "vitest";
import { RunConfigSchema } from "@cemeworm/shared";
import { buildDelegationGuidance } from "../src/harness/runtime-kernel.js";

describe("runtime kernel delegation guidance", () => {
  it("returns allow guidance when the user explicitly permits sub-agent help", () => {
    expect(buildDelegationGuidance(config({
      delegationIntent: {
        requestedByUser: true,
        preference: "allow",
        reason: "The user said sub-agent help is allowed.",
        source: "classifier",
      },
      effectiveStrategy: {
        sourceModeId: "single_agent",
        sourceModeSelection: "manual",
        thinking: "standard",
        reasoningEffort: "medium",
        budgetProfile: "balanced",
        budget: { maxTokens: 18000, maxToolCalls: 256, maxRuntimeMs: 300000, maxCostUsd: 3 },
        planning: "light",
        planningEnabled: true,
        delegation: "allowed",
        delegationEnabled: true,
        delegationRequestedByUser: true,
        providerThinkingEnabled: true,
        providerPolicyStatus: "applied",
      },
    }))).toContain("You may use agent.spawn if delegation would materially improve the outcome.");
  });

  it("returns stronger prefer guidance when the user explicitly requests coordination", () => {
    const guidance = buildDelegationGuidance(config({
      delegationIntent: {
        requestedByUser: true,
        preference: "prefer",
        reason: "The user asked for coordinated team work.",
        source: "classifier",
      },
      effectiveStrategy: {
        sourceModeId: "single_agent",
        sourceModeSelection: "manual",
        thinking: "standard",
        reasoningEffort: "medium",
        budgetProfile: "balanced",
        budget: { maxTokens: 18000, maxToolCalls: 256, maxRuntimeMs: 300000, maxCostUsd: 3 },
        planning: "light",
        planningEnabled: true,
        delegation: "preferred",
        delegationEnabled: true,
        delegationRequestedByUser: true,
        providerThinkingEnabled: true,
        providerPolicyStatus: "applied",
      },
    }));

    expect(guidance).toContain("Even in single-agent mode, treat this as explicit permission to delegate.");
    expect(guidance).toContain("prefer using agent.spawn instead of doing everything locally.");
  });

  it("returns required guidance when the run is under a degraded collaboration contract", () => {
    const guidance = buildDelegationGuidance(config({
      delegationIntent: {
        requestedByUser: true,
        preference: "prefer",
        reason: "The user explicitly requested Agent Teams style collaboration.",
        source: "explicit_team_collab",
      },
      effectiveStrategy: {
        sourceModeId: "single_agent",
        sourceModeSelection: "manual",
        thinking: "standard",
        reasoningEffort: "medium",
        budgetProfile: "balanced",
        budget: { maxTokens: 18000, maxToolCalls: 256, maxRuntimeMs: 300000, maxCostUsd: 3 },
        planning: "light",
        planningEnabled: true,
        delegation: "preferred",
        delegationEnabled: true,
        collaborationRequirement: "required",
        collaborationRequirementSource: "explicit_mode_degraded",
        delegationRequestedByUser: true,
        requestedModeId: "agent_teams",
        providerThinkingEnabled: true,
        providerPolicyStatus: "applied",
      },
    }));

    expect(guidance).toContain("must delegate at least one substantial top-level subtask with agent.spawn");
    expect(guidance).toContain("requested mode was agent_teams");
  });

  it("returns no guidance for none intents or absent intents", () => {
    expect(buildDelegationGuidance(config({
      delegationIntent: {
        requestedByUser: true,
        preference: "none",
        reason: "The user explicitly asked not to delegate.",
        source: "classifier",
      },
      effectiveStrategy: {
        sourceModeId: "single_agent",
        sourceModeSelection: "manual",
        thinking: "standard",
        reasoningEffort: "medium",
        budgetProfile: "balanced",
        budget: { maxTokens: 18000, maxToolCalls: 256, maxRuntimeMs: 300000, maxCostUsd: 3 },
        planning: "light",
        planningEnabled: true,
        delegation: "none",
        delegationEnabled: false,
        providerThinkingEnabled: true,
        providerPolicyStatus: "applied",
      },
    }))).toBeUndefined();
    expect(buildDelegationGuidance(config({}))).toBeUndefined();
  });

  it("does not expose root-only collaboration guidance to spawned child agents", () => {
    expect(buildDelegationGuidance(config({
      delegationIntent: {
        requestedByUser: true,
        preference: "prefer",
        reason: "The user explicitly requested Agent Teams style collaboration.",
        source: "explicit_team_collab",
      },
      effectiveStrategy: {
        sourceModeId: "single_agent",
        sourceModeSelection: "manual",
        thinking: "standard",
        reasoningEffort: "medium",
        budgetProfile: "balanced",
        budget: { maxTokens: 18000, maxToolCalls: 256, maxRuntimeMs: 300000, maxCostUsd: 3 },
        planning: "light",
        planningEnabled: true,
        delegation: "preferred",
        delegationEnabled: true,
        collaborationRequirement: "required",
        collaborationRequirementSource: "explicit_mode_degraded",
        delegationRequestedByUser: true,
        requestedModeId: "agent_teams",
        providerThinkingEnabled: true,
        providerPolicyStatus: "applied",
      },
    }), "ora-sub-1")).toBeUndefined();
  });
});

function config(params: { delegationIntent?: Record<string, unknown>; effectiveStrategy?: Record<string, unknown> }) {
  return RunConfigSchema.parse({
    pattern: "orchestrator_subagent",
    modeId: "single_agent",
    toolIds: ["agent.spawn"],
    effectiveStrategy: params.effectiveStrategy,
    metadata: params.delegationIntent ? { delegationIntent: params.delegationIntent } : {},
  });
}
