import { describe, expect, it } from "vitest";
import { DEFAULT_MODE_RECOVERY_POLICY, getModePreset } from "@cemeworm/shared";
import { classifyRecoveryError, RecoveryCoordinator } from "../src/harness/recovery-policy.js";

describe("recovery policy classification", () => {
  it("does not retry OpenAI-compatible request-shape errors as transient provider failures", () => {
    const incident = classifyRecoveryError(
      new Error("OpenAI-compatible provider deepseek failed with 400: {\"error\":{\"message\":\"The `reasoning_content` in the thinking mode must be passed back to the API.\",\"type\":\"invalid_request_error\"}}"),
      { surface: "provider", nodeId: "solo_agent", agentId: "solo_agent" },
    );

    expect(incident).toMatchObject({
      errorType: "model_output_invalid",
      nodeId: "solo_agent",
      agentId: "solo_agent",
    });
  });

  it("classifies deterministic tool policy and environment failures without fallback recovery", () => {
    expect(classifyRecoveryError(
      new Error("plan.update is not available in plan mode."),
      { surface: "tool", nodeId: "orchestrator", agentId: "orchestrator", toolId: "plan.update" },
    )).toMatchObject({ errorType: "tool_policy_denied" });

    expect(classifyRecoveryError(
      new Error("A mode registry is required for modes.list."),
      { surface: "tool", nodeId: "orchestrator", agentId: "orchestrator", toolId: "modes.list" },
    )).toMatchObject({ errorType: "env_unavailable" });

    expect(classifyRecoveryError(
      new Error("MCP server 'docs' is not configured."),
      { surface: "tool", nodeId: "orchestrator", agentId: "orchestrator", toolId: "mcp.call" },
    )).toMatchObject({ errorType: "env_unavailable" });

    expect(classifyRecoveryError(
      new Error("Remote tool response is missing field 'items'."),
      { surface: "tool", nodeId: "orchestrator", agentId: "orchestrator", toolId: "mcp.call" },
    )).toMatchObject({ errorType: "tool_error" });
  });

  it("keeps real tool execution failures eligible for fallback artifacts", () => {
    const modeSpec = getModePreset("single_agent")!;
    const coordinator = new RecoveryCoordinator(modeSpec, ["file.read"]);

    expect(coordinator.resolve(classifyRecoveryError(
      new Error("file.read target must be a file."),
      { surface: "tool", nodeId: "orchestrator", agentId: "orchestrator", toolId: "file.read" },
    ))).toMatchObject({
      action: "fallback_artifact",
      ruleId: "tool-error-fallback",
    });

    expect(coordinator.resolve(classifyRecoveryError(
      new Error("plan.update is not available in plan mode."),
      { surface: "tool", nodeId: "orchestrator", agentId: "orchestrator", toolId: "plan.update" },
    ))).toMatchObject({
      action: "fail",
      ruleId: "tool-policy-fail",
    });
  });

  it("keeps the default recovery policy from degrading tool policy denials", () => {
    const toolPolicyRule = DEFAULT_MODE_RECOVERY_POLICY.rules.find((rule) =>
      rule.errorTypes.includes("tool_policy_denied"),
    );

    expect(toolPolicyRule).toMatchObject({
      id: "tool-policy-fail",
      action: "fail",
    });
  });

  it("fails transient provider errors after retries are exhausted instead of degrading to fallback output", () => {
    const modeSpec = getModePreset("single_agent")!;
    const coordinator = new RecoveryCoordinator(modeSpec, []);
    const incident = classifyRecoveryError(
      new Error("OpenAI-compatible provider deepseek failed with 503: temporarily unavailable"),
      { surface: "provider", nodeId: "solo_agent", agentId: "solo_agent" },
    );

    expect(coordinator.resolve(incident)).toMatchObject({
      action: "retry",
      ruleId: "provider-transient-retry",
      attempt: 1,
      maxAttempts: 3,
    });
    expect(coordinator.resolve(incident)).toMatchObject({
      action: "retry",
      ruleId: "provider-transient-retry",
      attempt: 2,
      maxAttempts: 3,
    });
    expect(coordinator.resolve(incident)).toMatchObject({
      action: "fail",
      ruleId: "provider-transient-retry",
      attempt: 3,
      maxAttempts: 3,
      summary: expect.stringContaining("Retry attempts exhausted."),
    });
  });

  it("scopes provider retry attempts to a single model request", () => {
    const modeSpec = getModePreset("single_agent")!;
    const coordinator = new RecoveryCoordinator(modeSpec, []);
    const firstRequestIncident = classifyRecoveryError(
      new Error("fetch failed"),
      { surface: "provider", attemptScope: "request-1", nodeId: "solo_agent", agentId: "solo_agent" },
    );
    const secondRequestIncident = classifyRecoveryError(
      new Error("fetch failed"),
      { surface: "provider", attemptScope: "request-2", nodeId: "solo_agent", agentId: "solo_agent" },
    );

    expect(coordinator.resolve(firstRequestIncident)).toMatchObject({ action: "retry", attempt: 1 });
    expect(coordinator.resolve(firstRequestIncident)).toMatchObject({ action: "retry", attempt: 2 });
    expect(coordinator.resolve(secondRequestIncident)).toMatchObject({ action: "retry", attempt: 1 });
  });

  it("keeps forced-final provider exhaustion eligible for fallback artifacts", () => {
    const modeSpec = getModePreset("single_agent")!;
    const coordinator = new RecoveryCoordinator(modeSpec, []);
    const incident = classifyRecoveryError(
      new Error("forced final provider unavailable"),
      { surface: "provider", nodeId: "solo_agent", agentId: "solo_agent" },
    );

    expect(coordinator.resolve({
      ...incident,
      errorType: "provider_finalization_unavailable",
    })).toMatchObject({
      action: "fallback_artifact",
      ruleId: "provider-finalization-fallback",
    });
  });
});
