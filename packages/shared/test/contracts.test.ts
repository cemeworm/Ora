import { describe, expect, it } from "vitest";
import {
  AgentProfileSchema,
  JsonRpcRequestSchema,
  JsonRpcResponseSchema,
  MVP_PATTERNS,
  MemoryRecordSchema,
  OraEventEnvelopeSchema,
  PatternDefinitionSchema,
  PlanItemSchema,
  PolicyDecisionSchema,
  RunConfigSchema,
  RunEventStreamSchema,
  RunForkParamsSchema,
  RunReplayParamsSchema,
  RunResumeParamsSchema,
  RunSummarySchema
} from "../src/index.js";

describe("Ora shared contracts", () => {
  it("validates all MVP pattern fixtures", () => {
    expect(MVP_PATTERNS).toHaveLength(3);

    for (const pattern of MVP_PATTERNS) {
      expect(PatternDefinitionSchema.parse(pattern).id).toBe(pattern.id);
      expect(pattern.topology.nodes.length).toBeGreaterThan(1);
      expect(pattern.planTemplate.length).toBeGreaterThan(0);
    }
  });

  it("defaults run config to the product default pattern", () => {
    const config = RunConfigSchema.parse({});

    expect(config.pattern).toBe("orchestrator_subagent");
    expect(config.modelRef).toBe("local/smoke-model");
  });

  it("validates capability records and event envelopes", () => {
    const budget = {
      maxTokens: 1000,
      maxToolCalls: 2,
      maxRuntimeMs: 10000
    };
    const profile = AgentProfileSchema.parse({
      id: "reviewer",
      label: "Reviewer",
      role: "Check work",
      modelRef: "local/smoke-model",
      toolPolicyId: "default",
      memoryNamespaces: ["session"],
      budget
    });

    const planItem = PlanItemSchema.parse({
      id: "plan-1",
      runId: "run-1",
      ownerAgentId: profile.id,
      status: "ready",
      title: "Check the answer",
      dependencies: [],
      linkedActionIds: [],
      checkpointIds: []
    });

    const memory = MemoryRecordSchema.parse({
      id: "mem-1",
      namespace: ["session", "run-1"],
      kind: "session",
      value: { planItemId: planItem.id },
      createdAt: 1,
      updatedAt: 1
    });

    const event = OraEventEnvelopeSchema.parse({
      id: "evt-1",
      runId: "run-1",
      seq: 0,
      type: "action.updated",
      createdAt: 1,
      pattern: "orchestrator_subagent",
      payload: { memoryId: memory.id }
    });

    expect(event.payload).toEqual({ memoryId: "mem-1" });

    const decision = PolicyDecisionSchema.parse({
      id: "policy-1",
      runId: "run-1",
      actionId: "action-1",
      policyId: "default",
      requiredApproval: true,
      reason: "High-risk action requires approval.",
      createdAt: 1
    });

    expect(decision.requiredApproval).toBe(true);
  });

  it("validates JSON-RPC request and response shapes", () => {
    expect(
      JsonRpcRequestSchema.parse({
        jsonrpc: "2.0",
        id: 1,
        method: "runtime.health"
      }).method
    ).toBe("runtime.health");

    expect(
      JsonRpcResponseSchema.parse({
        jsonrpc: "2.0",
        id: 1,
        result: { ok: true }
      }).jsonrpc
    ).toBe("2.0");
  });

  it("validates second milestone run API contracts", () => {
    const summary = RunSummarySchema.parse({
      runId: "run-1",
      status: "succeeded",
      pattern: "orchestrator_subagent",
      prompt: "Summarize the run.",
      startedAt: 1,
      updatedAt: 2,
      eventCount: 3,
      checkpointCount: 1,
      artifactCount: 1
    });
    const event = OraEventEnvelopeSchema.parse({
      id: "evt-2",
      runId: summary.runId,
      seq: 2,
      type: "run.resumed",
      createdAt: 2,
      pattern: summary.pattern,
      payload: { patch: {} }
    });

    expect(
      RunEventStreamSchema.parse({
        runId: summary.runId,
        fromSeq: 2,
        events: [event],
        nextSeq: 3
      }).events[0]?.type
    ).toBe("run.resumed");
    expect(RunResumeParamsSchema.parse({ runId: summary.runId }).runId).toBe(summary.runId);
    expect(
      RunForkParamsSchema.parse({
        runId: summary.runId,
        checkpointId: "checkpoint-1"
      }).checkpointId
    ).toBe("checkpoint-1");
    expect(
      RunReplayParamsSchema.parse({
        runId: summary.runId,
        checkpointId: "checkpoint-1"
      }).runId
    ).toBe(summary.runId);
  });
});
