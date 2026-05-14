import type { OraToolCallEnvelope } from "./actions.js";
import type { RunStatus } from "./primitives.js";
import { deriveSnapshotGateProjection, type OraEventEnvelope, type RunContinuationFrame, type StateSnapshot } from "./runtime.js";

export type DiagnosticSignalKind =
  | "provider_or_tool_failure"
  | "repeated_tool_call"
  | "cost_or_event_blowup"
  | "blocking_gate"
  | "mode_mismatch";

export type DiagnosticSeverity = "error" | "warning" | "info";

export type DiagnosticTraceRef =
  | { type: "event"; id: string; seq?: number }
  | { type: "tool_call"; id: string }
  | { type: "checkpoint"; id: string }
  | { type: "gate"; id: string }
  | { type: "continuation_frame"; id: string };

export interface DiagnosticSignal {
  id: string;
  kind: DiagnosticSignalKind;
  severity: DiagnosticSeverity;
  title: string;
  summary: string;
  traceRefs: DiagnosticTraceRef[];
  count?: number;
}

export interface DiagnosticFinding {
  id: string;
  kind: DiagnosticSignalKind;
  severity: DiagnosticSeverity;
  title: string;
  summary: string;
  traceRefs: DiagnosticTraceRef[];
}

export type SuggestedActionKind =
  | "resume"
  | "replay"
  | "compare"
  | "review_gate"
  | "adjust_mode"
  | "reduce_scope"
  | "retry_tool";

export interface SuggestedAction {
  kind: SuggestedActionKind;
  label: string;
  target?: {
    checkpointId?: string;
    gateId?: string;
    toolCallId?: string;
    eventSeq?: number;
  };
  disabledReason?: string;
}

export interface RunDiagnosticSummary {
  runId: string;
  status: RunStatus;
  primaryFinding: DiagnosticFinding | null;
  signals: DiagnosticSignal[];
  suggestedActions: SuggestedAction[];
  traceRefs: DiagnosticTraceRef[];
}

const SIGNAL_PRIORITY: Record<DiagnosticSignalKind, number> = {
  provider_or_tool_failure: 0,
  blocking_gate: 1,
  mode_mismatch: 2,
  cost_or_event_blowup: 3,
  repeated_tool_call: 4,
};

export function deriveRunDiagnostics(snapshot: StateSnapshot): RunDiagnosticSummary {
  const signals = [
    ...detectProviderOrToolFailure(snapshot),
    ...detectBlockingGate(snapshot),
    ...detectModeMismatch(snapshot),
    ...detectCostOrEventBlowup(snapshot),
    ...detectRepeatedToolCalls(snapshot),
  ].sort(compareSignals);
  const primarySignal = signals[0];
  const primaryFinding = primarySignal
    ? {
        id: primarySignal.id,
        kind: primarySignal.kind,
        severity: primarySignal.severity,
        title: primarySignal.title,
        summary: primarySignal.summary,
        traceRefs: primarySignal.traceRefs,
      }
    : null;
  const traceRefs = dedupeTraceRefs(signals.flatMap((signal) => signal.traceRefs));

  return {
    runId: snapshot.runId,
    status: snapshot.status,
    primaryFinding,
    signals,
    suggestedActions: deriveSuggestedActions(snapshot, signals),
    traceRefs,
  };
}

function detectProviderOrToolFailure(snapshot: StateSnapshot): DiagnosticSignal[] {
  const failedToolCalls = snapshot.toolCalls.filter((call) => call.status === "failed");
  const exhaustedEvents = snapshot.events.filter((event) => event.type === "recovery.exhausted");
  const failedEvents = snapshot.events.filter((event) =>
    event.type === "run.failed" ||
    event.type === "task.failed" ||
    event.type === "context.compaction.failed"
  );
  if (failedToolCalls.length === 0 && exhaustedEvents.length === 0 && failedEvents.length === 0 && snapshot.status !== "failed") {
    return [];
  }
  const firstTool = failedToolCalls[0];
  const firstEvent = exhaustedEvents[0] ?? failedEvents[0] ?? snapshot.events.at(-1);
  const detail = firstTool
    ? `${firstTool.toolId} failed${toolError(firstTool) ? `: ${toolError(firstTool)}` : ""}`
    : snapshot.error ?? (firstEvent ? eventDetail(firstEvent) : "Run ended in failed status.");
  const approvalLikeFailure =
    failedToolCalls.length === 0 &&
    exhaustedEvents.length === 0 &&
    isApprovalInterruptDetail(detail) &&
    hasApprovalGate(snapshot);
  if (approvalLikeFailure) {
    return [];
  }
  return [{
    id: "diagnostic.provider-or-tool-failure",
    kind: "provider_or_tool_failure",
    severity: "error",
    title: "Provider or tool failure",
    summary: detail,
    traceRefs: [
      ...failedToolCalls.map((call) => ({ type: "tool_call" as const, id: call.id })),
      ...[...exhaustedEvents, ...failedEvents].map(eventTraceRef),
    ],
    count: failedToolCalls.length + exhaustedEvents.length + failedEvents.length,
  }];
}

function detectRepeatedToolCalls(snapshot: StateSnapshot): DiagnosticSignal[] {
  const groups = new Map<string, OraToolCallEnvelope[]>();
  for (const call of snapshot.toolCalls) {
    const key = `${call.toolId}:${stableStringify(call.args)}`;
    groups.set(key, [...(groups.get(key) ?? []), call]);
  }
  return [...groups.entries()]
    .filter(([, calls]) => calls.length >= 3)
    .map(([key, calls]) => {
      const toolId = calls[0]?.toolId ?? key.split(":")[0] ?? "tool";
      return {
        id: `diagnostic.repeated-tool-call:${shortHash(key)}`,
        kind: "repeated_tool_call" as const,
        severity: calls.length >= 5 ? "warning" as const : "info" as const,
        title: "Repeated tool call",
        summary: `${toolId} was called ${calls.length} times with the same arguments.`,
        traceRefs: calls.map((call) => ({ type: "tool_call" as const, id: call.id })),
        count: calls.length,
      };
    });
}

function detectCostOrEventBlowup(snapshot: StateSnapshot): DiagnosticSignal[] {
  const maxToolCalls = snapshot.config.effectiveStrategy?.budget?.maxToolCalls ?? snapshot.config.budget?.maxToolCalls;
  const maxTokens = snapshot.config.effectiveStrategy?.budget?.maxTokens ?? snapshot.config.budget?.maxTokens;
  const totalTokens = snapshot.contextState?.activeTokenUsage?.totalTokens ?? 0;
  const eventThreshold = 250;
  const signals: DiagnosticSignal[] = [];

  if (maxToolCalls !== undefined && snapshot.toolCalls.length > maxToolCalls) {
    signals.push({
      id: "diagnostic.cost-blowup:tool-budget",
      kind: "cost_or_event_blowup",
      severity: "warning",
      title: "Tool budget exceeded",
      summary: `Tool calls ${snapshot.toolCalls.length} exceeded the configured budget of ${maxToolCalls}.`,
      traceRefs: snapshot.toolCalls.map((call) => ({ type: "tool_call", id: call.id })),
      count: snapshot.toolCalls.length,
    });
  }
  if (maxTokens !== undefined && totalTokens > maxTokens) {
    signals.push({
      id: "diagnostic.cost-blowup:token-budget",
      kind: "cost_or_event_blowup",
      severity: "warning",
      title: "Token budget exceeded",
      summary: `Token usage ${totalTokens.toLocaleString()} exceeded the configured budget of ${maxTokens.toLocaleString()}.`,
      traceRefs: snapshot.events.filter((event) => event.type === "context.usage.updated").map(eventTraceRef),
      count: totalTokens,
    });
  }
  if (snapshot.events.length > eventThreshold) {
    signals.push({
      id: "diagnostic.cost-blowup:event-volume",
      kind: "cost_or_event_blowup",
      severity: "warning",
      title: "Large event volume",
      summary: `This run recorded ${snapshot.events.length} events, which can hide the failure point in the raw timeline.`,
      traceRefs: snapshot.events.slice(-10).map(eventTraceRef),
      count: snapshot.events.length,
    });
  }
  return signals;
}

function detectBlockingGate(snapshot: StateSnapshot): DiagnosticSignal[] {
  const gate = deriveSnapshotGateProjection(snapshot);
  if (!gate) {
    return [];
  }
  const gateRefs = gate.gateIds.map((id) => ({ id }));
  const gateEvents = snapshot.events.filter((event) =>
    event.type === "approval.required" ||
    event.type === "clarification.required" ||
    event.type === "plan.updated"
  );
  return [{
    id: "diagnostic.blocking-gate",
    kind: "blocking_gate",
    severity: "warning",
    title: "Blocking gate",
    summary: `${Math.max(1, gateRefs.length)} gate${gateRefs.length === 1 ? " is" : "s are"} waiting for user input.`,
    traceRefs: [
      ...gateRefs.map((gateRef) => ({ type: "gate" as const, id: gateRef.id })),
      ...gateEvents.map(eventTraceRef),
    ],
    count: Math.max(1, gateRefs.length),
  }];
}

function detectModeMismatch(snapshot: StateSnapshot): DiagnosticSignal[] {
  const signals: DiagnosticSignal[] = [];
  const providerStatus = snapshot.config.effectiveStrategy?.providerPolicyStatus;
  if (providerStatus === "degraded") {
    signals.push({
      id: "diagnostic.mode-mismatch:provider-policy",
      kind: "mode_mismatch",
      severity: "warning",
      title: "Mode policy degraded",
      summary: snapshot.config.effectiveStrategy?.notes?.[0] ?? "The selected provider could not satisfy the requested mode policy.",
      traceRefs: snapshot.events.filter((event) => event.type === "run.started").map(eventTraceRef),
    });
  }
  const requestedModeId = snapshot.config.modeId;
  if (requestedModeId && snapshot.modeId && requestedModeId !== snapshot.modeId) {
    signals.push({
      id: "diagnostic.mode-mismatch:resolved-mode",
      kind: "mode_mismatch",
      severity: "warning",
      title: "Resolved mode differs",
      summary: `Requested mode ${requestedModeId}, but runtime resolved ${snapshot.modeId}.`,
      traceRefs: snapshot.events.filter((event) => event.type === "run.started").map(eventTraceRef),
    });
  }
  return signals;
}

function deriveSuggestedActions(snapshot: StateSnapshot, signals: DiagnosticSignal[]): SuggestedAction[] {
  const actions: SuggestedAction[] = [];
  const signalKinds = new Set(signals.map((signal) => signal.kind));
  const latestCheckpoint = snapshot.checkpoints.at(-1);
  const resumableFrame = latestResumableFrame(snapshot.continuation.frames);

  if (signalKinds.has("blocking_gate")) {
    actions.push({
      kind: resumableFrame ? "resume" : "review_gate",
      label: resumableFrame ? "Resume from blocking gate" : "Review blocking gate",
      target: {
        checkpointId: latestCheckpoint?.id,
        gateId: snapshot.pendingApprovals[0] ?? snapshot.pendingClarifications[0]?.id,
        eventSeq: latestCheckpoint?.eventSeq,
      },
      disabledReason: resumableFrame ? undefined : "No continuation frame is linked to the open gate.",
    });
  }
  if (signalKinds.has("provider_or_tool_failure")) {
    const failedTool = snapshot.toolCalls.find((call) => call.status === "failed");
    actions.push({
      kind: latestCheckpoint ? "replay" : "retry_tool",
      label: latestCheckpoint ? "Replay from latest checkpoint" : "Retry failed tool",
      target: {
        checkpointId: latestCheckpoint?.id,
        toolCallId: failedTool?.id,
        eventSeq: latestCheckpoint?.eventSeq,
      },
      disabledReason: latestCheckpoint ? undefined : "This run has no checkpoint to replay from.",
    });
  }
  if (signalKinds.has("repeated_tool_call") || signalKinds.has("cost_or_event_blowup")) {
    actions.push({
      kind: "compare",
      label: "Compare with another attempt",
    });
  }
  if (signalKinds.has("mode_mismatch")) {
    actions.push({
      kind: "adjust_mode",
      label: "Adjust mode or provider policy",
    });
  }
  return dedupeActions(actions);
}

function latestResumableFrame(frames: RunContinuationFrame[]): RunContinuationFrame | undefined {
  return [...frames].reverse().find((frame) =>
    frame.status === "paused" &&
    (frame.pendingActionIds.length > 0 ||
      frame.pendingClarificationIds.length > 0 ||
      frame.pendingToolCallIds.length > 0)
  );
}

function compareSignals(left: DiagnosticSignal, right: DiagnosticSignal): number {
  const severityDelta = severityRank(left.severity) - severityRank(right.severity);
  if (severityDelta !== 0) return severityDelta;
  return SIGNAL_PRIORITY[left.kind] - SIGNAL_PRIORITY[right.kind];
}

function severityRank(severity: DiagnosticSeverity): number {
  if (severity === "error") return 0;
  if (severity === "warning") return 1;
  return 2;
}

function eventTraceRef(event: OraEventEnvelope): DiagnosticTraceRef {
  return { type: "event", id: event.id, seq: event.seq };
}

function eventDetail(event: OraEventEnvelope): string {
  if (event.payload && typeof event.payload === "object") {
    const payload = event.payload as { error?: unknown; reason?: unknown; message?: unknown };
    const value = payload.error ?? payload.reason ?? payload.message;
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return event.type;
}

function toolError(call: OraToolCallEnvelope): string | undefined {
  return call.error ?? call.result?.error;
}

function isApprovalInterruptDetail(detail: string | undefined): boolean {
  if (!detail) {
    return false;
  }
  return /waiting for your approval before continuing\.?/i.test(detail.trim());
}

function hasApprovalGate(snapshot: StateSnapshot): boolean {
  return snapshot.attention?.kind === "needs_approval"
    || snapshot.pendingApprovals.length > 0
    || snapshot.actions.some((action) => action.status === "approval_required")
    || snapshot.toolCalls.some((call) => call.status === "approval_required");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
}

function shortHash(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function dedupeTraceRefs(refs: DiagnosticTraceRef[]): DiagnosticTraceRef[] {
  const seen = new Set<string>();
  return refs.filter((ref) => {
    const key = `${ref.type}:${ref.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function dedupeActions(actions: SuggestedAction[]): SuggestedAction[] {
  const seen = new Set<string>();
  return actions.filter((action) => {
    const key = `${action.kind}:${action.target?.checkpointId ?? ""}:${action.target?.gateId ?? ""}:${action.target?.toolCallId ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
