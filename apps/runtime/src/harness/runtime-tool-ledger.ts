import {
  type OraToolCallEnvelope,
  OraToolCallEnvelopeSchema,
  type OraToolCallSource,
  type OraToolCallStatus,
} from "@cemeworm/shared";

export interface AppendRuntimeToolCallParams {
  id?: string;
  providerCallId?: string;
  toolId: string;
  args: Record<string, unknown>;
  source: OraToolCallSource;
  status: OraToolCallStatus;
  actionId?: string;
  agentId?: string;
  nodeId?: string;
  result?: OraToolCallEnvelope["result"];
  error?: string;
  repairReason?: string;
}

export class RuntimeToolCallLedger {
  private readonly calls: OraToolCallEnvelope[] = [];

  constructor(
    private readonly runId: string,
    private readonly now: () => number,
    seedCalls: OraToolCallEnvelope[] = [],
  ) {
    this.calls = seedCalls.map((call) => OraToolCallEnvelopeSchema.parse(call));
  }

  append(params: AppendRuntimeToolCallParams): OraToolCallEnvelope {
    const updatedAt = this.now();
    const existingIndex = params.id
      ? this.calls.findIndex((call) => call.id === params.id)
      : params.providerCallId
        ? this.calls.findIndex((call) => call.providerCallId === params.providerCallId && call.source === params.source)
        : -1;
    const existing = existingIndex >= 0 ? this.calls[existingIndex] : undefined;
    const envelope = OraToolCallEnvelopeSchema.parse({
      id: params.id ?? existing?.id ?? `${this.runId}:tool-call-${this.calls.length}`,
      providerCallId: params.providerCallId ?? existing?.providerCallId,
      runId: this.runId,
      nodeId: params.nodeId ?? existing?.nodeId,
      agentId: params.agentId ?? existing?.agentId,
      actionId: params.actionId ?? existing?.actionId,
      toolId: params.toolId,
      args: params.args,
      source: params.source,
      status: params.status,
      requestedAt: existing?.requestedAt ?? updatedAt,
      updatedAt,
      result: params.result ?? existing?.result,
      error: params.error ?? existing?.error,
      repairReason: params.repairReason ?? existing?.repairReason,
    });
    if (existingIndex >= 0) {
      this.calls[existingIndex] = envelope;
    } else {
      this.calls.push(envelope);
    }
    return envelope;
  }

  list(): OraToolCallEnvelope[] {
    return this.calls;
  }
}
