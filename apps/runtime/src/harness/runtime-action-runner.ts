import {
  CausalDecisionRecordSchema,
  type CausalTaskState,
  type ActionRecord,
  type OraEventEnvelope,
  type OraToolCallEnvelope,
  type PolicyDecision,
  type RunConfig,
  type RuntimeToolResultPreview,
} from "@cemeworm/shared";
import type { ActionLedger, PolicyService } from "../capabilities.js";
import { ApprovalInterruptError } from "./runtime-interrupts.js";
import { mergeCausalTaskState } from "./causal-task-state-extractor.js";
import type { RuntimeFileChangeMetadata, RuntimeToolCall } from "./runtime-tool-executor.js";
import type { AppendRuntimeToolCallParams } from "./runtime-tool-ledger.js";

type RuntimeActionEmit = (
  type: OraEventEnvelope["type"],
  payload: unknown,
  extra?: Partial<OraEventEnvelope>,
) => OraEventEnvelope;

type ResumeApprovalMatcher = {
  consume: (action: ActionRecord) => boolean;
};

type AppendToolCallStatus = (
  record: OraToolCallEnvelope,
  status: OraToolCallEnvelope["status"],
) => void;

type AppendToolCall = (params: AppendRuntimeToolCallParams) => OraToolCallEnvelope;

export interface RuntimeActionDeps {
  actionLedger: ActionLedger;
  policyService: PolicyService;
  approvalMode: RunConfig["approvalMode"];
  permissionMode: RunConfig["permissionMode"];
  resumeApprovals: ResumeApprovalMatcher;
  emit: RuntimeActionEmit;
  appendToolCallStatus?: AppendToolCallStatus;
  appendToolCall?: AppendToolCall;
  currentCausalTaskState?: () => Partial<CausalTaskState> | undefined;
  /** 当 auto_review 模式自动批准 action 时调用。
      调用方应在此回调中写入 gate.resolved ledger entries，
      防止 ledger replay 时出现 terminal_run_with_open_gates。 */
  onApprovalAutoResolved?: (actionIds: string[]) => void;
}

export interface RuntimeActionContext {
  agentId: string;
  nodeId: string;
  title?: string;
}

export interface ResolveRuntimeApprovalParams {
  action: ActionRecord;
  context: RuntimeActionContext;
  deps: RuntimeActionDeps;
  decision?: PolicyDecision;
  approvalMode?: RunConfig["approvalMode"];
  permissionMode?: RunConfig["permissionMode"];
  toolCallRecord?: OraToolCallEnvelope;
}

export interface ResolveRuntimeApprovalResult {
  decision: PolicyDecision;
  approvedForRiskyExecution: boolean;
}

export async function resolveRuntimeActionApproval({
  action,
  context,
  deps,
  decision = deps.policyService.evaluate(action),
  approvalMode = deps.approvalMode,
  permissionMode = deps.permissionMode,
  toolCallRecord,
}: ResolveRuntimeApprovalParams): Promise<ResolveRuntimeApprovalResult> {
  const skipApproval =
    permissionMode === "full_access" || permissionMode === "auto_review";
  const approvedForRiskyExecution =
    !decision.requiredApproval || approvalMode === "auto" || skipApproval;

  if (!decision.requiredApproval || approvalMode === "auto") {
    return { decision, approvedForRiskyExecution };
  }

  if (permissionMode === "full_access") {
    return { decision, approvedForRiskyExecution };
  }

  if (permissionMode === "auto_review") {
    // Close any lingering approval gates left open by a previous mode switch.
    const autoResolvedIds: string[] = [];
    for (const record of deps.actionLedger.list()) {
      if (record.status === "approval_required" && record.id !== action.id) {
        deps.actionLedger.transition(record.id, "approved");
        autoResolvedIds.push(record.id);
        deps.emit(
          "approval.resolved",
          {
            actionId: record.id,
            decision: "approved",
            mode: "auto_review",
          },
          { agentId: context.agentId, nodeId: context.nodeId },
        );
        deps.emit(
          "action.updated",
          { actionId: record.id, status: "approved", record },
          { agentId: context.agentId, nodeId: context.nodeId },
        );
      }
    }
    const approved = deps.actionLedger.transition(action.id, "approved");
    autoResolvedIds.push(action.id);
    if (toolCallRecord) {
      deps.appendToolCallStatus?.(toolCallRecord, "approved");
    }
    deps.emit(
      "approval.resolved",
      {
        actionId: action.id,
        decision: "approved",
        mode: "auto_review",
      },
      { agentId: context.agentId, nodeId: context.nodeId },
    );
    deps.emit(
      "action.updated",
      { actionId: action.id, status: "approved", record: approved },
      { agentId: context.agentId, nodeId: context.nodeId },
    );
    deps.onApprovalAutoResolved?.(autoResolvedIds);
    return { decision, approvedForRiskyExecution: true };
  }

  if (!deps.resumeApprovals.consume(action)) {
    const blocked = deps.actionLedger.transition(
      action.id,
      "approval_required",
    );
    if (toolCallRecord) {
      deps.appendToolCallStatus?.(toolCallRecord, "approval_required");
    }
    const inheritedTaskState = deps.currentCausalTaskState?.();
    // Record causal decision for approval gate
    deps.emit("causal.decision.recorded", CausalDecisionRecordSchema.parse({
      decisionId: `${context.agentId}:approval:${action.id}`,
      source: "runtime_followup",
      decisionKind: "approval_triggered",
      taskState: mergeCausalTaskState(inheritedTaskState, {
        surfaceRequest: inheritedTaskState?.surfaceRequest ?? action.type,
        keyUncertainties: ["行动风险较高"],
        chosenIntervention: "request_approval",
        confidence: 0.4,
      }),
      policyDecision: {
        goalUncertainty: 0.4,
        factUncertainty: 0.2,
        contextUncertainty: 0.2,
        actionRisk: action.riskLevel === "high" ? 0.8 : 0.4,
        userCost: 0.5,
        reversibility: "low",
        recommendedAction: "request_approval",
        reason: "request_approval: approval gate triggered at runtime",
        wouldChangeOutcomeIfWrong: true,
      },
      chosenIntervention: "request_approval",
      alternativeInterventions: [],
      recordedAt: Date.now(),
      decisionContext: {
        phase: "approval_triggered",
        actionId: action.id,
        toolCallId: toolCallRecord?.id,
        nodeId: context.nodeId,
        agentId: context.agentId,
        toolId: action.type,
      },
    }), { agentId: context.agentId, nodeId: context.nodeId });
    deps.emit(
      "approval.required",
      { actionId: action.id, decision },
      { agentId: context.agentId, nodeId: context.nodeId },
    );
    deps.emit(
      "action.updated",
      {
        actionId: action.id,
        status: "approval_required",
        record: blocked,
      },
      { agentId: context.agentId, nodeId: context.nodeId },
    );
    throw new ApprovalInterruptError(action.id);
  }

  deps.emit(
    "approval.resolved",
    {
      actionId: action.id,
      decision: "approved",
      mode: "resume",
    },
    { agentId: context.agentId, nodeId: context.nodeId },
  );
  const approved = deps.actionLedger.transition(action.id, "approved");
  if (toolCallRecord) {
    deps.appendToolCallStatus?.(toolCallRecord, "approved");
  }
  deps.emit(
    "action.updated",
    { actionId: action.id, status: "approved", record: approved },
    { agentId: context.agentId, nodeId: context.nodeId },
  );

  return { decision, approvedForRiskyExecution: true };
}

export function transitionRuntimeAction(
  params: {
    action: ActionRecord;
    status: ActionRecord["status"];
    context: RuntimeActionContext;
    deps: Pick<RuntimeActionDeps, "actionLedger" | "emit" | "appendToolCallStatus">;
    toolCallRecord?: OraToolCallEnvelope;
    patch?: Parameters<ActionLedger["transition"]>[2];
  },
): ActionRecord {
  const record = params.deps.actionLedger.transition(
    params.action.id,
    params.status,
    params.patch,
  );
  if (params.toolCallRecord) {
    if (isToolCallStatus(params.status)) {
      params.deps.appendToolCallStatus?.(params.toolCallRecord, params.status);
    }
  }
  params.deps.emit(
    "action.updated",
    { actionId: params.action.id, status: params.status, record },
    { agentId: params.context.agentId, nodeId: params.context.nodeId },
  );
  return record;
}

export function recordRuntimeToolActionSucceeded(params: {
  action: ActionRecord;
  context: RuntimeActionContext;
  deps: Pick<RuntimeActionDeps, "actionLedger" | "emit" | "appendToolCall">;
  toolCall: RuntimeToolCall & {
    providerCallId?: string;
    source?: OraToolCallEnvelope["source"];
  };
  output: unknown;
  fileChange?: RuntimeFileChangeMetadata;
  resultPreview?: RuntimeToolResultPreview;
  artifactIds?: string[];
  cacheHit?: boolean;
  recoveredFrom?: string;
  toolCallRecord?: OraToolCallEnvelope;
  now: () => number;
}): { record: ActionRecord; resultText: string } {
  const record = params.deps.actionLedger.transition(
    params.action.id,
    "succeeded",
    {
      output: params.output,
      artifactIds: params.artifactIds,
    },
  );
  const resultText = JSON.stringify(params.output, null, 2);
  if (params.toolCallRecord) {
    params.deps.appendToolCall?.({
      ...params.toolCallRecord,
      status: "succeeded",
      result: {
        status: "succeeded",
        output: params.output,
        content: resultText,
        resultPreview: params.resultPreview,
        createdAt: params.now(),
        updatedAt: params.now(),
      },
    });
  }
  params.deps.emit(
    "tool.called",
    {
      ...(params.toolCallRecord ? { toolCallId: params.toolCallRecord.id } : {}),
      ...(params.toolCall.providerCallId
        ? { providerCallId: params.toolCall.providerCallId }
        : {}),
      actionId: params.action.id,
      toolId: params.toolCall.tool,
      ...(params.toolCall.source ? { source: params.toolCall.source } : {}),
      status: "succeeded",
      input: params.toolCall.args,
      output: params.output,
      ...(params.fileChange ? { fileChange: params.fileChange } : {}),
      ...(params.resultPreview ? { resultPreview: params.resultPreview } : {}),
      ...(params.cacheHit !== undefined ? { cacheHit: params.cacheHit } : {}),
      ...(params.recoveredFrom ? { recoveredFrom: params.recoveredFrom } : {}),
    },
    { agentId: params.context.agentId, nodeId: params.context.nodeId },
  );
  params.deps.emit(
    "action.updated",
    { actionId: params.action.id, status: "succeeded", record },
    { agentId: params.context.agentId, nodeId: params.context.nodeId },
  );
  return { record, resultText };
}

export function recordRuntimeToolActionFailed(params: {
  action: ActionRecord;
  context: RuntimeActionContext;
  deps: Pick<RuntimeActionDeps, "actionLedger" | "emit" | "appendToolCall">;
  toolCall: RuntimeToolCall & {
    providerCallId?: string;
    source?: OraToolCallEnvelope["source"];
  };
  detail: string;
  toolCallRecord: OraToolCallEnvelope;
  now: () => number;
}): ActionRecord {
  const record = params.deps.actionLedger.transition(params.action.id, "failed", {
    error: params.detail,
  });
  params.deps.appendToolCall?.({
    ...params.toolCallRecord,
    status: "failed",
    result: {
      status: "failed",
      error: params.detail,
      content: params.detail,
      createdAt: params.now(),
      updatedAt: params.now(),
    },
    error: params.detail,
  });
  params.deps.emit(
    "tool.called",
    {
      toolCallId: params.toolCallRecord.id,
      providerCallId: params.toolCall.providerCallId,
      actionId: params.action.id,
      toolId: params.toolCall.tool,
      source: params.toolCall.source,
      status: "failed",
      input: params.toolCall.args,
      error: params.detail,
    },
    { agentId: params.context.agentId, nodeId: params.context.nodeId },
  );
  params.deps.emit(
    "action.updated",
    { actionId: params.action.id, status: "failed", record },
    { agentId: params.context.agentId, nodeId: params.context.nodeId },
  );
  return record;
}

function isToolCallStatus(
  status: ActionRecord["status"],
): status is Extract<ActionRecord["status"], OraToolCallEnvelope["status"]> {
  return status !== "skipped" && status !== "reverted";
}
