import { describe, expect, it, vi } from "vitest";
import type { OraToolCallEnvelope } from "@cemeworm/shared";
import { proposeRuntimeToolAction } from "./runtime-tool-action-proposal.js";
import type { AppendRuntimeToolCallParams } from "./runtime-tool-ledger.js";

describe("runtime tool action proposal", () => {
  it("preserves the concrete nodeId on proposed tool-call records", () => {
    const appendToolCall = vi.fn((params) => ({
      id: "tool-call-1",
      runId: "run-1",
      toolId: params.toolId,
      args: params.args,
      source: params.source,
      status: params.status,
      actionId: params.actionId,
      planStepId: params.planStepId,
      agentId: params.agentId,
      nodeId: params.nodeId,
      requestedAt: 1,
      updatedAt: 1,
    } satisfies OraToolCallEnvelope));
    const emit = vi.fn();

    const { toolCallRecord } = proposeRuntimeToolAction({
      agentId: "ora",
      nodeId: "respond",
      inputPrompt: "search for cacheHitRatio",
      eventCount: 7,
      toolCall: {
        tool: "file.grep",
        args: { pattern: "cacheHitRatio", include: "apps/runtime/src/**/*.ts" },
        source: "provider_native",
      },
      runtimeToolExecutor: {
        riskLevel: () => "low",
        approvalRequest: () => undefined,
      } as never,
      actionLedger: {
        propose: (params: {
          id: string;
          type: string;
          riskLevel: "low" | "medium" | "high";
          input: Record<string, unknown>;
          planStepId?: string;
          agentId?: string;
        }) => ({
          id: params.id,
          type: params.type,
          riskLevel: params.riskLevel,
          input: params.input,
          status: "proposed",
          planStepId: params.planStepId,
          agentId: params.agentId,
          createdAt: 1,
          updatedAt: 1,
        }),
      } as never,
      appendToolCall: appendToolCall as (params: AppendRuntimeToolCallParams) => OraToolCallEnvelope,
      emit,
    });

    expect(appendToolCall).toHaveBeenCalledWith(expect.objectContaining({
      agentId: "ora",
      nodeId: "respond",
    }));
    expect(toolCallRecord.nodeId).toBe("respond");
    expect(emit).toHaveBeenCalledWith(
      "action.updated",
      expect.objectContaining({ actionId: "ora-tool-7" }),
      expect.objectContaining({ agentId: "ora", nodeId: "respond" }),
    );
  });
});
