import type { OraRunTrail, OraStateSnapshot } from "./runtimeClient";
import type { ActionRecord, AgentProfile } from "../types";

export type TrailDebuggerTab = "overview" | "flow" | "agents" | "tools" | "evidence";
export type TrailFindingSeverity = "error" | "warning" | "info";

export interface TrailFinding {
  id: string;
  severity: TrailFindingSeverity;
  title: string;
  message: string;
  targetType: "run" | "event" | "tool" | "agent" | "trace";
  targetId?: string;
  suggestedTab: TrailDebuggerTab;
}

export interface TrailDebugSummary {
  statusLabel: string;
  statusTone: "success" | "warning" | "error" | "neutral";
  currentStage: string;
  blockingGate: string;
  recommendation: string;
  recommendedTab: TrailDebuggerTab;
  lastImportantEvent?: SemanticTimelineItem;
  metrics: {
    runtime: string;
    cost: string;
    messages: string;
  };
}

export interface SemanticTimelineItem {
  id: string;
  seq: number;
  createdAt: number;
  timestamp: string;
  eventType: string;
  kind: "run" | "agent" | "tool" | "handoff" | "checkpoint" | "recovery" | "gate" | "artifact" | "state";
  severity: TrailFindingSeverity | "neutral";
  label: string;
  detail: string;
  agentId?: string;
  agentLabel?: string;
  nodeId?: string;
  nodeLabel?: string;
  checkpointId?: string;
  inputPreview?: string;
  outputPreview?: string;
  rawPayload: unknown;
}

export interface AgentLane {
  id: string;
  label: string;
  role: string;
  status: "active" | "blocked" | "failed" | "done" | "idle";
  messageCount: number;
  toolCount: number;
  costUsd: number;
  latestActivity: string;
  messages: AgentLaneMessage[];
  findings: TrailFinding[];
}

export interface AgentLaneMessage {
  id: string;
  timestamp: string;
  kind: string;
  status: string;
  toLabels: string[];
  content: string;
  threadId: string;
}

export interface ToolLedgerItem {
  id: string;
  toolId: string;
  status: OraStateSnapshot["toolCalls"][number]["status"];
  statusTone: "success" | "warning" | "error" | "neutral";
  source: string;
  agentId?: string;
  agentLabel?: string;
  nodeId?: string;
  nodeLabel?: string;
  latency: string;
  argsPreview: string;
  resultPreview: string;
  repairReason?: string;
  error?: string;
}

export interface PendingApprovalItem {
  actionId: string;
  nodeId?: string;
  nodeLabel: string;
  actionLabel: string;
  riskLevel: "low" | "medium" | "high";
  reason: string;
  eventId?: string;
}

export interface EffectiveStrategySummary {
  title: string;
  detail: string;
  statusLabel: string;
  statusTone: "success" | "warning" | "neutral";
  notes: string[];
}

export function buildTrailDebugSummary(
  snapshot: OraStateSnapshot,
  trail: OraRunTrail | undefined,
  actions: ActionRecord[],
  findings: TrailFinding[] = collectTrailFindings(snapshot, undefined, trail?.trace ?? snapshot.trace, actions),
): TrailDebugSummary {
  const timeline = buildSemanticTimeline(snapshot);
  const lastImportantEvent = [...timeline].reverse().find((item) => item.kind !== "state");
  const blockingGate = currentBlockingGate(snapshot);
  const firstError = findings.find((finding) => finding.severity === "error");
  const firstWarning = findings.find((finding) => finding.severity === "warning");
  const recommendedFinding = firstError ?? firstWarning;
  const trace = trail?.trace ?? snapshot.trace;
  const liveMetrics = trail?.liveMetrics;

  return {
    statusLabel: runStatusLabel(snapshot.status),
    statusTone: runStatusTone(snapshot.status),
    currentStage: inferCurrentStage(snapshot, lastImportantEvent),
    blockingGate,
    recommendation: recommendedFinding
      ? `建议查看：${tabLabel(recommendedFinding.suggestedTab)} · ${recommendedFinding.title}`
      : lastImportantEvent
        ? `建议查看：流程 · ${lastImportantEvent.label}`
        : "建议查看：证据 · 本次 run 暂无关键事件。",
    recommendedTab: recommendedFinding?.suggestedTab ?? (lastImportantEvent ? "flow" : "evidence"),
    lastImportantEvent,
    metrics: {
      runtime: formatDuration(liveMetrics?.runtimeMs ?? Math.max(0, snapshot.updatedAt - (snapshot.input.createdAt ?? snapshot.updatedAt))),
      cost: formatUsd(liveMetrics?.estimatedCostUsd ?? trace?.generationRefs.reduce((sum, ref) => sum + (ref.totalCostUsd ?? 0), 0) ?? 0),
      messages: String(liveMetrics?.messageCount ?? snapshot.events.filter((event) => event.type === "message.delta").length),
    },
  };
}

export function buildSemanticTimeline(snapshot: OraStateSnapshot): SemanticTimelineItem[] {
  const nodeLabels = new Map(snapshot.topology.nodes.map((node) => [node.id, node.label]));
  const agentLabels = buildAgentLabelMap(snapshot);
  return snapshot.events
    .filter((event) => shouldShowSemanticEvent(event.type))
    .map((event) => {
      const payload = isRecord(event.payload) ? event.payload : undefined;
      const agentLabel = event.agentId ? agentLabels.get(event.agentId) ?? event.agentId : undefined;
      const nodeLabel = event.nodeId ? nodeLabels.get(event.nodeId) ?? event.nodeId : undefined;
      return {
        id: event.id,
        seq: event.seq,
        createdAt: event.createdAt,
        timestamp: formatTimestamp(event.createdAt),
        eventType: event.type,
        kind: eventKind(event.type),
        severity: eventSeverity(event.type),
        label: timelineLabel(event.type),
        detail: timelineDetail(event),
        agentId: event.agentId,
        agentLabel,
        nodeId: event.nodeId,
        nodeLabel,
        checkpointId: event.checkpointId,
        inputPreview: previewValue(readPayloadInput(payload)),
        outputPreview: previewValue(readPayloadOutput(payload)),
        rawPayload: event.payload,
      } satisfies SemanticTimelineItem;
    });
}

export function buildAgentLanes(
  snapshot: OraStateSnapshot,
  agents: AgentProfile[],
  trail: OraRunTrail | undefined,
  findings: TrailFinding[] = collectTrailFindings(snapshot, undefined, trail?.trace ?? snapshot.trace, []),
): AgentLane[] {
  const labelMap = buildAgentLabelMap(snapshot, agents);
  const roleMap = new Map<string, string>();
  for (const profile of snapshot.profiles) {
    roleMap.set(profile.id, profile.role);
  }
  for (const agent of agents) {
    roleMap.set(agent.id, agent.role);
  }
  const ids = new Set<string>([
    ...snapshot.profiles.map((profile) => profile.id),
    ...agents.map((agent) => agent.id),
    ...snapshot.activeAgents,
    ...(snapshot.agentMessages ?? []).flatMap((message) => [message.fromAgentId, ...message.toAgentIds]),
    ...snapshot.events.flatMap((event) => event.agentId ? [event.agentId] : []),
    ...snapshot.toolCalls.flatMap((call) => call.agentId ? [call.agentId] : []),
  ]);
  const generationCosts = new Map<string, number>();
  for (const observation of trail?.observations ?? []) {
    const metadata = isRecord(observation.metadata) ? observation.metadata : {};
    const agentId = typeof metadata.agentId === "string" ? metadata.agentId : undefined;
    if (!agentId) {
      continue;
    }
    generationCosts.set(agentId, (generationCosts.get(agentId) ?? 0) + (observation.totalCostUsd ?? 0));
  }

  return [...ids].map((agentId) => {
    const messages = (snapshot.agentMessages ?? [])
      .filter((message) => message.fromAgentId === agentId)
      .map((message) => ({
        id: message.id,
        timestamp: formatTimestamp(message.createdAt),
        kind: message.kind,
        status: message.status,
        toLabels: message.toAgentIds.map((id) => labelMap.get(id) ?? id),
        content: message.content,
        threadId: message.threadId,
      }));
    const toolCount = snapshot.toolCalls.filter((call) => call.agentId === agentId).length;
    const agentEvents = snapshot.events.filter((event) => event.agentId === agentId);
    const latestEvent = agentEvents.at(-1);
    const laneFindings = findings.filter((finding) => finding.targetType === "agent" && finding.targetId === agentId);
    return {
      id: agentId,
      label: labelMap.get(agentId) ?? agentId,
      role: roleMap.get(agentId) ?? "Runtime participant",
      status: inferAgentStatus(snapshot, agentId, laneFindings),
      messageCount: messages.length,
      toolCount,
      costUsd: generationCosts.get(agentId) ?? 0,
      latestActivity: latestEvent ? timelineDetail(latestEvent) : "No recent agent activity.",
      messages,
      findings: laneFindings,
    };
  });
}

export function buildToolLedger(snapshot: OraStateSnapshot): ToolLedgerItem[] {
  const nodeLabels = new Map(snapshot.topology.nodes.map((node) => [node.id, node.label]));
  const agentLabels = buildAgentLabelMap(snapshot);
  return snapshot.toolCalls.map((call) => ({
    id: call.id,
    toolId: call.toolId,
    status: call.status,
    statusTone: toolStatusTone(call.status),
    source: call.source.replace(/_/g, " "),
    agentId: call.agentId,
    agentLabel: call.agentId ? agentLabels.get(call.agentId) ?? call.agentId : undefined,
    nodeId: call.nodeId,
    nodeLabel: call.nodeId ? nodeLabels.get(call.nodeId) ?? call.nodeId : undefined,
    latency: formatDuration(Math.max(0, (call.result?.updatedAt ?? call.updatedAt) - call.requestedAt)),
    argsPreview: previewValue(call.args) ?? "{}",
    resultPreview: previewValue(call.result?.output ?? call.result?.content ?? call.result?.error) ?? "No result captured",
    repairReason: call.repairReason,
    error: call.error ?? call.result?.error,
  }));
}

export function collectTrailFindings(
  snapshot: OraStateSnapshot,
  trailError: string | undefined,
  trace: OraRunTrail["trace"] | OraStateSnapshot["trace"] | undefined,
  actions: ActionRecord[],
): TrailFinding[] {
  const findings: TrailFinding[] = [];
  const push = (finding: TrailFinding) => {
    if (!findings.some((candidate) => candidate.id === finding.id)) {
      findings.push(finding);
    }
  };
  const failureDetail = latestFailureDetail(snapshot);
  if (snapshot.status === "failed") {
    push({
      id: "run.failed",
      severity: "error",
      title: "Run failed",
      message: failureDetail
        ? `Run failed: ${failureDetail}`
        : "The run ended in a failed state. Inspect the latest events and trace rows for the failing branch.",
      targetType: "run",
      suggestedTab: "flow",
    });
  }
  if (snapshot.config.effectiveStrategy?.providerPolicyStatus === "degraded") {
    push({
      id: "strategy.provider-degraded",
      severity: "warning",
      title: "Provider thinking degraded",
      message: snapshot.config.effectiveStrategy.notes[0] ?? "The selected provider could not honor this mode's requested reasoning policy.",
      targetType: "run",
      suggestedTab: "overview",
    });
  }
  for (const call of snapshot.toolCalls ?? []) {
    if (call.status === "failed") {
      push({
        id: `tool.failed:${call.id}`,
        severity: "error",
        title: "Tool failed",
        message: `${call.toolId} failed${call.error ?? call.result?.error ? `: ${call.error ?? call.result?.error}` : "."}`,
        targetType: "tool",
        targetId: call.id,
        suggestedTab: "tools",
      });
    }
    if (call.status === "repaired") {
      push({
        id: `tool.repaired:${call.id}`,
        severity: "warning",
        title: "Tool call repaired",
        message: "A dangling provider tool call was repaired as interrupted before the next model call.",
        targetType: "tool",
        targetId: call.id,
        suggestedTab: "tools",
      });
    }
    if (call.status === "interrupted") {
      push({
        id: `tool.interrupted:${call.id}`,
        severity: "warning",
        title: "Tool interrupted",
        message: "A tool call was interrupted before completion.",
        targetType: "tool",
        targetId: call.id,
        suggestedTab: "tools",
      });
    }
    if (call.status === "approval_required") {
      push({
        id: `tool.approval:${call.id}`,
        severity: "warning",
        title: "Tool approval pending",
        message: `${call.toolId} is waiting for manual approval.`,
        targetType: "tool",
        targetId: call.id,
        suggestedTab: "tools",
      });
    }
  }
  if (actions.some((action) => action.state === "approval_required")) {
    push({
      id: "approval.pending",
      severity: "warning",
      title: "Approval pending",
      message: "A pending approval is blocking forward progress.",
      targetType: "run",
      suggestedTab: "overview",
    });
  }
  const continuation = snapshot.continuation ?? { frames: [] };
  const activeContinuation = continuation.frames.find((frame) =>
    frame.id === continuation.activeFrameId
  );
  if (activeContinuation) {
    push({
      id: `continuation.${activeContinuation.status}:${activeContinuation.id}`,
      severity: activeContinuation.status === "failed" ? "error" : "info",
      title: "Continuation frame active",
      message: `Runtime continuation is ${activeContinuation.status} for ${activeContinuation.reason}.`,
      targetType: "run",
      suggestedTab: "flow",
    });
  }
  for (const clarification of snapshotPendingClarifications(snapshot)) {
    push({
      id: `clarification.pending:${clarification.id}`,
      severity: "warning",
      title: "Clarification pending",
      message: clarification.question,
      targetType: "event",
      targetId: clarification.id,
      suggestedTab: "flow",
    });
  }
  const recoveryExhausted = [...snapshot.events].reverse().find((event) => event.type === "recovery.exhausted");
  if (recoveryExhausted) {
    push({
      id: `recovery.exhausted:${recoveryExhausted.id}`,
      severity: "error",
      title: "Recovery exhausted",
      message: timelineDetail(recoveryExhausted),
      targetType: "event",
      targetId: recoveryExhausted.id,
      suggestedTab: "flow",
    });
  }
  const stopReason = stopReasonFromSnapshot(snapshot);
  if (stopReason) {
    push({
      id: "run.stop-reason",
      severity: "info",
      title: "Stop reason",
      message: `Run stop reason: ${stopReason}.`,
      targetType: "run",
      suggestedTab: "evidence",
    });
  }
  if (trace?.provider === "ora" || trace?.source === "local") {
    push({
      id: "trace.local",
      severity: "info",
      title: "Local trail active",
      message: "Ora-native Trails is active; Langfuse is optional for deeper observability.",
      targetType: "trace",
      suggestedTab: "evidence",
    });
  } else if (!trace?.enabled) {
    push({
      id: "trace.disabled",
      severity: "info",
      title: "Remote tracing disabled",
      message: "Langfuse tracing is disabled, so Trails is operating in local-only mode.",
      targetType: "trace",
      suggestedTab: "evidence",
    });
  } else if (!trace.available) {
    push({
      id: "trace.degraded",
      severity: "warning",
      title: "Remote trace unavailable",
      message: trace.reason ?? "Remote trace data is unavailable; the drawer is using local synthesized observations.",
      targetType: "trace",
      suggestedTab: "evidence",
    });
  }
  if (trailError) {
    push({
      id: "trace.fetch-error",
      severity: "warning",
      title: "Trace fetch degraded",
      message: `Trace fetch degraded: ${trailError}`,
      targetType: "trace",
      suggestedTab: "evidence",
    });
  }
  if (snapshot.events.length === 0) {
    push({
      id: "events.empty",
      severity: "info",
      title: "No runtime events",
      message: "No runtime events were recorded for this run.",
      targetType: "run",
      suggestedTab: "evidence",
    });
  }
  return findings;
}

export function buildPendingApprovalItems(snapshot: OraStateSnapshot): PendingApprovalItem[] {
  const topologyNodeLabels = new Map(snapshot.topology.nodes.map((node) => [node.id, node.label]));
  const pendingApprovals = snapshotPendingApprovals(snapshot);
  const pendingActionIds = pendingApprovals.length > 0
    ? pendingApprovals
    : snapshot.actions.filter((action) => action.status === "approval_required").map((action) => action.id);

  return pendingActionIds.map((actionId) => {
    const action = snapshot.actions.find((candidate) => candidate.id === actionId);
    const event = [...snapshot.events].reverse().find((candidate) =>
      candidate.type === "approval.required" && readApprovalEventActionId(candidate.payload) === actionId,
    );
    const nodeId = event?.nodeId ?? readActionNodeId(action?.input);
    return {
      actionId,
      nodeId,
      nodeLabel: nodeId ? topologyNodeLabels.get(nodeId) ?? nodeId : humanizeActionType(action?.type),
      actionLabel: humanizeActionType(action?.type),
      riskLevel: action?.riskLevel ?? "low",
      reason: readApprovalReason(event?.payload) ?? fallbackApprovalReason(action?.riskLevel),
      eventId: event?.id,
    };
  });
}

export function buildEffectiveStrategySummary(snapshot: OraStateSnapshot): EffectiveStrategySummary | undefined {
  const strategy = snapshot.config.effectiveStrategy;
  if (!strategy) {
    return undefined;
  }
  const statusTone = strategy.providerPolicyStatus === "degraded"
    ? "warning"
    : strategy.providerPolicyStatus === "applied"
      ? "success"
      : "neutral";
  const statusLabel = strategy.providerPolicyStatus === "applied"
    ? "Applied"
    : strategy.providerPolicyStatus === "degraded"
      ? "Degraded"
      : "Unsupported";
  return {
    title: `${sentenceCase(strategy.thinking)} thinking`,
    detail: [
      `${sentenceCase(strategy.sourceModeSelection)} mode ${strategy.sourceModeId}`,
      `${sentenceCase(strategy.reasoningEffort ?? "none")} reasoning`,
      `${sentenceCase(strategy.planning)} planning`,
      strategy.delegationEnabled
        ? `${sentenceCase(strategy.delegation)} delegation`
        : "No delegation",
      `${strategy.budget.maxToolCalls} tools`,
    ].join(" · "),
    statusLabel,
    statusTone,
    notes: strategy.notes,
  };
}

export function snapshotPendingClarifications(snapshot: OraStateSnapshot): OraStateSnapshot["pendingClarifications"] {
  return Array.isArray(snapshot.pendingClarifications) ? snapshot.pendingClarifications : [];
}

export function snapshotPendingApprovals(snapshot: OraStateSnapshot): string[] {
  return Array.isArray(snapshot.pendingApprovals) ? snapshot.pendingApprovals : [];
}

export function canOpenLangfuseTrace(
  trace: OraRunTrail["trace"] | OraStateSnapshot["trace"] | undefined,
) {
  if (!trace?.traceUrl) {
    return false;
  }
  if (trace.provider !== "langfuse" || trace.source === "local") {
    return false;
  }
  if (trace.source === "degraded") {
    return false;
  }
  return !trace.reason?.toLowerCase().includes("fetch failed");
}

export function tabLabel(tab: TrailDebuggerTab) {
  switch (tab) {
    case "overview":
      return "总览";
    case "flow":
      return "流程";
    case "agents":
      return "智能体";
    case "tools":
      return "工具";
    case "evidence":
      return "证据";
  }
}

export function formatUsd(value: number) {
  return `$${value.toFixed(value > 0 ? 4 : 2)}`;
}

function currentBlockingGate(snapshot: OraStateSnapshot) {
  const clarification = snapshotPendingClarifications(snapshot)[0];
  if (clarification) {
    return `Clarification · ${clarification.nodeLabel}`;
  }
  const approval = buildPendingApprovalItems(snapshot)[0];
  if (approval) {
    return `Approval · ${approval.nodeLabel}`;
  }
  return "None";
}

function inferCurrentStage(snapshot: OraStateSnapshot, lastImportantEvent?: SemanticTimelineItem) {
  if (snapshot.status === "failed") {
    return "Failed at latest critical event";
  }
  if (snapshot.status === "succeeded") {
    return stopReasonFromSnapshot(snapshot) ?? "Completed";
  }
  if (snapshot.status === "interrupted" || snapshot.pendingApprovals.length > 0 || snapshot.pendingClarifications.length > 0) {
    return "Waiting for user input";
  }
  if (snapshot.activeAgents.length > 0) {
    return `Active: ${snapshot.activeAgents.join(", ")}`;
  }
  return lastImportantEvent?.label ?? "Runtime initialized";
}

function inferAgentStatus(snapshot: OraStateSnapshot, agentId: string, findings: TrailFinding[]): AgentLane["status"] {
  if (findings.some((finding) => finding.severity === "error")) {
    return "failed";
  }
  if (snapshot.activeAgents.includes(agentId)) {
    return "active";
  }
  const hasBlockedNode = snapshot.topology.nodes.some((node) => node.agentId === agentId && node.status === "blocked");
  if (hasBlockedNode) {
    return "blocked";
  }
  const hasDoneNode = snapshot.topology.nodes.some((node) => node.agentId === agentId && node.status === "done");
  return hasDoneNode || snapshot.status === "succeeded" ? "done" : "idle";
}

function buildAgentLabelMap(snapshot: OraStateSnapshot, agents: AgentProfile[] = []) {
  const result = new Map<string, string>();
  for (const profile of snapshot.profiles) {
    result.set(profile.id, profile.label);
  }
  for (const agent of agents) {
    result.set(agent.id, agent.label);
  }
  return result;
}

function shouldShowSemanticEvent(type: string) {
  if (type === "token.delta" || type === "message.delta") {
    return false;
  }
  return true;
}

function eventKind(type: string): SemanticTimelineItem["kind"] {
  if (type.startsWith("run.")) return "run";
  if (type.startsWith("agent.") || type === "agent.message" || type === "message.published" || type === "message.routed") return "agent";
  if (type.startsWith("tool.")) return "tool";
  if (type.startsWith("approval.") || type.startsWith("clarification.")) return "gate";
  if (type === "checkpoint.created") return "checkpoint";
  if (type.startsWith("recovery.")) return "recovery";
  if (type.startsWith("artifact.")) return "artifact";
  if (type === "worker.claimed" || type === "worker.released" || type === "queue.updated") return "handoff";
  return "state";
}

function eventSeverity(type: string): SemanticTimelineItem["severity"] {
  if (type.endsWith(".failed") || type === "run.failed" || type === "recovery.exhausted") return "error";
  if (type === "tool.repaired" || type === "approval.required" || type === "clarification.required" || type === "artifact.degraded" || type === "run.interrupted") return "warning";
  if (type === "run.done" || type === "checkpoint.created") return "info";
  return "neutral";
}

function timelineLabel(eventType: string) {
  switch (eventType) {
    case "agent.started":
      return "Agent started";
    case "agent.completed":
      return "Agent completed";
    case "topology.updated":
      return "Topology change";
    case "action.updated":
      return "Action change";
    case "task.started":
      return "Task started";
    case "task.progress":
      return "Task progress";
    case "task.completed":
      return "Task completed";
    case "task.failed":
      return "Task failed";
    case "tool.called":
      return "Tool call";
    case "tool.repaired":
      return "Tool repaired";
    case "approval.required":
      return "Approval required";
    case "approval.resolved":
      return "Approval resolved";
    case "clarification.required":
      return "Clarification required";
    case "clarification.resolved":
      return "Clarification resolved";
    case "checkpoint.created":
      return "Checkpoint captured";
    case "artifact.exported":
      return "Artifact exported";
    case "artifact.degraded":
      return "Degraded artifact";
    case "completion.updated":
      return "Completion control";
    case "node.updated":
      return "Node runtime";
    case "recovery.detected":
      return "Recovery detected";
    case "recovery.retry_scheduled":
      return "Retry scheduled";
    case "recovery.applied":
      return "Recovery applied";
    case "recovery.exhausted":
      return "Recovery exhausted";
    case "node.skipped":
      return "Node skipped";
    case "agent.message":
      return "Agent message";
    case "message.published":
      return "Message published";
    case "message.routed":
      return "Message routed";
    case "worker.claimed":
      return "Worker claimed";
    case "worker.released":
      return "Worker released";
    case "run.started":
      return "Run started";
    case "run.resumed":
      return "Run resumed";
    case "run.forked":
      return "Run forked";
    case "run.replayed":
      return "Run replayed";
    case "run.interrupted":
      return "Run interrupted";
    case "run.cancelled":
      return "Run cancelled";
    case "run.done":
      return "Run completed";
    case "run.failed":
      return "Run failed";
    default:
      return eventType.replace(/\./g, " ");
  }
}

function timelineDetail(event: OraStateSnapshot["events"][number]) {
  if (isRecord(event.payload)) {
    if (event.type === "tool.called" || event.type === "tool.repaired") {
      const toolId = typeof event.payload.toolId === "string" ? event.payload.toolId : "tool";
      const status = typeof event.payload.status === "string" ? event.payload.status : "updated";
      return `${toolId} ${status.replace(/_/g, " ")}.`;
    }
    if (event.type === "checkpoint.created" && typeof event.payload.label === "string") {
      return event.payload.label;
    }
    if (isRecord(event.payload.decision) && typeof event.payload.decision.summary === "string") {
      return event.payload.decision.summary;
    }
    if (typeof event.payload.summary === "string") {
      return event.payload.summary;
    }
    if (typeof event.payload.message === "string") {
      return event.payload.message;
    }
    if (typeof event.payload.content === "string") {
      return event.payload.content;
    }
    if (typeof event.payload.error === "string") {
      return event.payload.error;
    }
    if (typeof event.payload.reason === "string") {
      return event.payload.reason;
    }
  }
  return "Runtime state updated.";
}

function readPayloadInput(payload: Record<string, unknown> | undefined) {
  if (!payload) return undefined;
  return payload.input ?? payload.args ?? payload.prompt ?? payload.request;
}

function readPayloadOutput(payload: Record<string, unknown> | undefined) {
  if (!payload) return undefined;
  return payload.output ?? payload.result ?? payload.content ?? payload.summary;
}

function previewValue(value: unknown, maxLength = 180): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (!text) {
    return undefined;
  }
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function sentenceCase(value: string) {
  const text = value.replace(/_/g, " ");
  return text.slice(0, 1).toUpperCase() + text.slice(1);
}

function latestFailureDetail(snapshot: OraStateSnapshot): string | undefined {
  if (snapshot.error?.trim()) {
    return snapshot.error.trim();
  }
  const failedEvent = [...snapshot.events].reverse().find((event) => event.type === "run.failed");
  if (!failedEvent || !isRecord(failedEvent.payload)) {
    return undefined;
  }
  const error = failedEvent.payload.error;
  if (typeof error === "string" && error.trim()) {
    return error.trim();
  }
  const reason = failedEvent.payload.reason;
  if (typeof reason === "string" && reason.trim()) {
    return reason.trim();
  }
  return undefined;
}

function stopReasonFromSnapshot(snapshot: OraStateSnapshot): string | undefined {
  const output = snapshot.output;
  if (isRecord(output) && isRecord(output.metadata)) {
    const metadata = output.metadata;
    if (typeof metadata.stopReason === "string") {
      return metadata.stopReason;
    }
    if (isRecord(metadata.completion) && typeof metadata.completion.stopReason === "string") {
      return metadata.completion.stopReason;
    }
  }
  const doneEvent = [...snapshot.events].reverse().find((event) => event.type === "run.done");
  if (doneEvent && isRecord(doneEvent.payload) && typeof doneEvent.payload.stopReason === "string") {
    return doneEvent.payload.stopReason;
  }
  return undefined;
}

function runStatusLabel(status: OraStateSnapshot["status"]) {
  switch (status) {
    case "succeeded":
      return "Done";
    case "failed":
      return "Failed";
    case "interrupted":
      return "Waiting";
    case "cancelled":
      return "Cancelled";
    case "queued":
      return "Queued";
    default:
      return "Running";
  }
}

function runStatusTone(status: OraStateSnapshot["status"]): TrailDebugSummary["statusTone"] {
  if (status === "succeeded") return "success";
  if (status === "failed") return "error";
  if (status === "interrupted" || status === "cancelled") return "warning";
  return "neutral";
}

function toolStatusTone(status: OraStateSnapshot["toolCalls"][number]["status"]): ToolLedgerItem["statusTone"] {
  if (status === "succeeded") return "success";
  if (status === "failed" || status === "denied") return "error";
  if (status === "approval_required" || status === "interrupted" || status === "repaired") return "warning";
  return "neutral";
}

function formatDuration(ms: number) {
  if (ms < 1000) {
    return `${Math.max(0, Math.round(ms))}ms`;
  }
  const seconds = ms / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

function formatTimestamp(value?: number | string) {
  if (value === undefined) {
    return "n/a";
  }
  const date = typeof value === "number"
    ? new Date(value)
    : /^\d+$/.test(value)
      ? new Date(Number(value))
      : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleTimeString();
}

function readApprovalEventActionId(payload: unknown): string | undefined {
  if (!isRecord(payload) || typeof payload.actionId !== "string") {
    return undefined;
  }
  return payload.actionId;
}

function readApprovalReason(payload: unknown): string | undefined {
  if (!isRecord(payload) || !isRecord(payload.decision) || typeof payload.decision.reason !== "string") {
    return undefined;
  }
  return payload.decision.reason;
}

function readActionNodeId(input: unknown): string | undefined {
  if (!isRecord(input) || typeof input.nodeId !== "string") {
    return undefined;
  }
  return input.nodeId;
}

function humanizeActionType(type?: string) {
  if (!type) {
    return "approval gate";
  }
  return type.replace(/^graph\./, "").replace(/\./g, " ");
}

function fallbackApprovalReason(riskLevel?: "low" | "medium" | "high") {
  return riskLevel === "high"
    ? "Please confirm this operation before I continue."
    : "Please confirm before this step continues.";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
