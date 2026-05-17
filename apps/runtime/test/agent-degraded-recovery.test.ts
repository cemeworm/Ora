import { describe, it, expect } from "vitest";
import { AgentDegradedError, isAgentDegradedError } from "../src/harness/runtime-interrupts.js";
import { runRecoverableRuntimeNode } from "../src/harness/runtime-node-support.js";
import { classifyRecoveryError, type RecoveryCoordinator, type RecoveryDecision, type RecoveryIncident } from "../src/harness/recovery-policy.js";

function mockRecoveryCoordinator(
  action: RecoveryDecision["action"],
): RecoveryCoordinator {
  return {
    resolve: (_incident: RecoveryIncident): RecoveryDecision => ({
      action,
      attempt: 1,
      maxAttempts: 1,
      summary: `mock: ${action}`,
    }),
  };
}

function mockEmit() {
  const events: Array<{ type: string; payload: unknown }> = [];
  return {
    events,
    emit: (type: string, payload: unknown) => {
      events.push({ type, payload });
      return { type, payload };
    },
  };
}

describe("AgentDegradedError", () => {
  it("constructs with degraded output, artifact id, and error type", () => {
    const error = new AgentDegradedError("fallback text", {
      recoveryArtifactId: "artifact-1",
      errorType: "boundary_violation",
      detail: "shell.execute blocked",
    });

    expect(error.degradedOutput).toBe("fallback text");
    expect(error.recoveryArtifactId).toBe("artifact-1");
    expect(error.errorType).toBe("boundary_violation");
    expect(error.message).toContain("boundary_violation");
    expect(error.name).toBe("AgentDegradedError");
  });

  it("is recognized by isAgentDegradedError via Symbol marker", () => {
    const error = new AgentDegradedError("fallback", {
      recoveryArtifactId: "a",
      errorType: "test_error",
      detail: "test",
    });

    expect(isAgentDegradedError(error)).toBe(true);
  });

  it("is recognized cross-realm via Symbol.for", () => {
    const error = new AgentDegradedError("fallback", {
      recoveryArtifactId: "a",
      errorType: "test_error",
      detail: "test",
    });

    // Simulate cross-realm (different module instance) check
    const plain = JSON.parse(JSON.stringify(error));
    const reconstructed = Object.assign(new Error(error.message), plain, {
      [Symbol.for("ora.AgentDegraded")]: true,
    });

    expect(isAgentDegradedError(reconstructed)).toBe(true);
  });

  it("is not confused with regular Error", () => {
    expect(isAgentDegradedError(new Error("normal error"))).toBe(false);
    expect(isAgentDegradedError("string")).toBe(false);
    expect(isAgentDegradedError(null)).toBe(false);
    expect(isAgentDegradedError(undefined)).toBe(false);
  });

  it("is not confused with ApprovalInterruptError", () => {
    // ApprovalInterruptError uses a different Symbol
    const approvalError = Object.assign(new Error("approval"), {
      [Symbol.for("ora.ApprovalInterrupt")]: true,
    });
    expect(isAgentDegradedError(approvalError)).toBe(false);
  });
});

describe("runRecoverableRuntimeNode with AgentDegradedError", () => {
  it("returns completed with degraded output when AgentDegradedError is thrown", async () => {
    const { events, emit } = mockEmit();
    const recoveryCoordinator = mockRecoveryCoordinator("fallback_artifact");

    const result = await runRecoverableRuntimeNode(
      { nodeId: "test-node", nodeTemplate: "triage", nodeLabel: "Test", agentId: "ora" },
      async () => {
        throw new AgentDegradedError("degraded plan output", {
          recoveryArtifactId: "recovery-1",
          errorType: "boundary_violation",
          detail: "shell.execute blocked in plan phase",
        });
      },
      {
        recoveryCoordinator,
        emitRecoveryDecision: () => {},
        publishRecoveryArtifact: () => ({ id: "artifact" }),
        sleep: async () => {},
        emit: emit as unknown as ReturnType<typeof mockEmit>["emit"],
      },
    );

    expect(result.status).toBe("completed");
    expect(result.output).toBe("degraded plan output");
  });

  it("passes through AgentDegradedError without applying node-level recovery", async () => {
    // Node-level recovery should NOT create a second recovery artifact
    // for AgentDegradedError — the agent-level already handled it.
    let recoveryDecisionCalled = false;
    const recoveryCoordinator: RecoveryCoordinator = {
      resolve: (_incident: RecoveryIncident): RecoveryDecision => {
        recoveryDecisionCalled = true;
        return { action: "fallback_artifact", attempt: 1, maxAttempts: 1, summary: "test" };
      },
    };

    const { emit } = mockEmit();

    await runRecoverableRuntimeNode(
      { nodeId: "test", nodeTemplate: "triage", nodeLabel: "Test", agentId: "ora" },
      async () => {
        throw new AgentDegradedError("output", {
          recoveryArtifactId: "a",
          errorType: "boundary_violation",
          detail: "test",
        });
      },
      {
        recoveryCoordinator,
        emitRecoveryDecision: () => {},
        publishRecoveryArtifact: () => ({ id: "x" }),
        sleep: async () => {},
        emit: emit as unknown as ReturnType<typeof mockEmit>["emit"],
      },
    );

    expect(recoveryDecisionCalled).toBe(false);
  });

  it("still applies node-level recovery for non-degraded errors", async () => {
    const { emit } = mockEmit();
    const recoveryCoordinator = mockRecoveryCoordinator("fallback_artifact");

    const result = await runRecoverableRuntimeNode(
      { nodeId: "test", nodeTemplate: "triage", nodeLabel: "Test", agentId: "ora" },
      async () => {
        throw new Error("generic tool failure");
      },
      {
        recoveryCoordinator,
        emitRecoveryDecision: () => {},
        publishRecoveryArtifact: () => ({ id: "artifact-2" }),
        sleep: async () => {},
        emit: emit as unknown as ReturnType<typeof mockEmit>["emit"],
      },
    );

    // Node-level fallback_artifact returns completed with usableOutput
    expect(result.status).toBe("completed");
    expect(result.output).toBeDefined();
  });

  it("re-throws AgentDegradedError when wrapped in a retry loop", async () => {
    // The node-level recovery should NOT retry on AgentDegradedError —
    // it passes through immediately.
    const { emit } = mockEmit();
    let attempts = 0;

    const result = await runRecoverableRuntimeNode(
      { nodeId: "test", nodeTemplate: "triage", nodeLabel: "Test", agentId: "ora" },
      async () => {
        attempts++;
        throw new AgentDegradedError("out", {
          recoveryArtifactId: "a",
          errorType: "boundary_violation",
          detail: "test",
        });
      },
      {
        recoveryCoordinator: mockRecoveryCoordinator("retry"), // would retry, but shouldn't
        emitRecoveryDecision: () => {},
        publishRecoveryArtifact: () => ({ id: "x" }),
        sleep: async () => {},
        emit: emit as unknown as ReturnType<typeof mockEmit>["emit"],
      },
    );

    expect(attempts).toBe(1);
    expect(result.status).toBe("completed");
    expect(result.output).toBe("out");
  });

  it("classifyRecoveryError treats AgentDegradedError details as node_exception", async () => {
    // Since AgentDegradedError is caught BEFORE classifyRecoveryError in the
    // normal flow, reaching classifyRecoveryError means something unexpected
    // happened. The message carries the original error type for diagnostics.
    const incident = classifyRecoveryError(
      new AgentDegradedError("plan", {
        recoveryArtifactId: "r",
        errorType: "boundary_violation",
        detail: "shell.execute blocked",
      }),
      { surface: "node", nodeId: "n", nodeTemplate: "triage" },
    );

    expect(incident.surface).toBe("node");
    // Falls through to generic node_exception since AgentDegradedError
    // is handled before reaching classifyRecoveryError in normal flow
    expect(incident.errorType).toBe("node_exception");
    expect(incident.detail).toContain("boundary_violation");
  });
});
