import type {
  OraEventEnvelope,
  OraToolCallEnvelope,
} from "@cemeworm/shared";
import type { ActionLedger } from "../capabilities.js";
import type { AppendRuntimeToolCallParams } from "./runtime-tool-ledger.js";
import type { RuntimeToolCall, RuntimeToolExecutor } from "./runtime-tool-executor.js";
import type { RuntimeToolAttempt } from "./runtime-tool-loop.js";

type RuntimeLoopEmit = (
  type: OraEventEnvelope["type"],
  payload: unknown,
  extra?: Partial<OraEventEnvelope>,
) => OraEventEnvelope;

export function proposeRuntimeToolAction(params: {
  agentId: string;
  nodeId: string;
  inputPrompt: string;
  eventCount: number;
  planStepId?: string;
  toolCall: RuntimeToolAttempt;
  runtimeToolExecutor: RuntimeToolExecutor;
  actionLedger: Pick<ActionLedger, "propose">;
  appendToolCall: (params: AppendRuntimeToolCallParams) => OraToolCallEnvelope;
  emit: RuntimeLoopEmit;
}): {
  action: ReturnType<ActionLedger["propose"]>;
  toolCallRecord: OraToolCallEnvelope;
} {
  const riskLevel = params.runtimeToolExecutor.riskLevel(params.toolCall);
  const action = params.actionLedger.propose({
    id: `${params.agentId}-tool-${params.eventCount}`,
    type: params.toolCall.tool,
    riskLevel,
    input: params.toolCall.args,
    approvalRequest:
      riskLevel === "high"
        ? params.runtimeToolExecutor.approvalRequest(params.toolCall, params.inputPrompt)
        : undefined,
    planStepId: params.planStepId,
    agentId: params.agentId,
  });
  const toolCallRecord = params.appendToolCall({
    providerCallId: params.toolCall.providerCallId,
    toolId: params.toolCall.tool,
    args: params.toolCall.args,
    source: params.toolCall.source,
    status: "proposed",
    actionId: action.id,
    planStepId: params.planStepId,
    agentId: params.agentId,
    nodeId: params.nodeId,
  });
  params.emit(
    "action.updated",
    { actionId: action.id, status: "proposed", record: action },
    { agentId: params.agentId, nodeId: params.nodeId },
  );
  return { action, toolCallRecord };
}

export function proposeRuntimeRecoveryToolAction(params: {
  agentId: string;
  nodeId: string;
  inputPrompt: string;
  eventCount: number;
  toolCall: RuntimeToolCall;
  runtimeToolExecutor: RuntimeToolExecutor;
  actionLedger: Pick<ActionLedger, "propose">;
  emit: RuntimeLoopEmit;
}): ReturnType<ActionLedger["propose"]> {
  const riskLevel = params.runtimeToolExecutor.riskLevel(params.toolCall);
  const action = params.actionLedger.propose({
    id: `${params.agentId}-tool-recovery-${params.eventCount}`,
    type: params.toolCall.tool,
    riskLevel,
    input: params.toolCall.args,
    approvalRequest:
      riskLevel === "high"
        ? params.runtimeToolExecutor.approvalRequest(params.toolCall, params.inputPrompt)
        : undefined,
    agentId: params.agentId,
  });
  params.emit(
    "action.updated",
    {
      actionId: action.id,
      status: "proposed",
      record: action,
    },
    { agentId: params.agentId, nodeId: params.nodeId },
  );
  return action;
}
