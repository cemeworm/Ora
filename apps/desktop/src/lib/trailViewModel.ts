import type { OraRunTrail, OraStateSnapshot } from "./runtimeClient";
import type { ActionRecord, AgentProfile } from "../types";

export type TrailDebuggerTab = "overview" | "flow" | "agents" | "tools" | "latency" | "evidence";
export type TrailFindingSeverity = "error" | "warning" | "info";

type LatencyMark = NonNullable<OraStateSnapshot["latency"]>["marks"][number];

export interface TrailLatencyMarkItem {
  id: string;
  name: string;
  source: LatencyMark["source"];
  at: number;
  offset: string;
  detail: Record<string, unknown>;
}

export interface TrailLatencySegment {
  id: string;
  label: string;
  from: string;
  to: string;
  duration: string;
  durationMs?: number;
  status: "ok" | "warning" | "slow" | "missing";
  note: string;
}

export interface TrailLatencyDiagnostics {
  summary: {
    statusLabel: string;
    statusTone: "success" | "warning" | "error" | "neutral";
    recommendation: string;
    firstText: string;
    firstReadableText: string;
    providerMode: string;
  };
  marks: TrailLatencyMarkItem[];
  segments: TrailLatencySegment[];
}

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

export interface ActiveMemorySummary {
  statusLabel: "USE" | "NONE";
  statusTone: "success" | "warning" | "neutral";
  mode: string;
  reason: string;
  candidateCount: number;
  selectedIds: string[];
  rejectedCount: number;
  renderedChars: number;
  warnings: string[];
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

export function buildSemanticTimeline(snapshot: OraStateSnapshot, options: { includeInternalEvents?: boolean } = {}): SemanticTimelineItem[] {
  const nodeLabels = new Map(snapshot.topology.nodes.map((node) => [node.id, node.label]));
  const agentLabels = buildAgentLabelMap(snapshot);
  return snapshot.events
    .filter((event) => shouldShowSemanticEvent(event, options.includeInternalEvents === true))
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
      role: roleMap.get(agentId) ?? "运行时参与者",
      status: inferAgentStatus(snapshot, agentId, laneFindings),
      messageCount: messages.length,
      toolCount,
      costUsd: generationCosts.get(agentId) ?? 0,
      latestActivity: latestEvent ? timelineDetail(latestEvent) : "暂无最近智能体活动。",
      messages,
      findings: laneFindings,
    };
  });
}

export function buildLatencyDiagnostics(snapshot: OraStateSnapshot): TrailLatencyDiagnostics {
  const sortedMarks = [...(snapshot.latency?.marks ?? [])]
    .sort((left, right) => left.at - right.at || left.source.localeCompare(right.source) || left.name.localeCompare(right.name));
  const baseAt = sortedMarks[0]?.at ?? snapshot.input.createdAt ?? snapshot.updatedAt;
  const markByKey = new Map(sortedMarks.map((mark) => [`${mark.source}:${mark.name}`, mark]));
  const segments = LATENCY_SEGMENT_DEFINITIONS.map((definition) => buildLatencySegment(definition, markByKey));
  const firstText = markByKey.get("runtime:firstTextDelta") ?? markByKey.get("desktop:firstMessageDeltaAt");
  const firstReadableText = markByKey.get("runtime:firstUserReadableAssistantTextProduced") ?? markByKey.get("desktop:firstNonProgressAssistantTextAt");
  const firstProgressNarration = markByKey.get("runtime:firstProgressNarration");
  const providerFrame = markByKey.get("provider:firstProviderStreamFrame") ?? markByKey.get("provider:providerFallbackStarted");
  const providerMode = typeof providerFrame?.detail.streamMode === "string"
    ? providerFrame.detail.streamMode
    : "未记录";
  const warningSegments = segments.filter((segment) => segment.status === "warning" || segment.status === "slow");
  const progressBeforeText = Boolean(firstProgressNarration && firstText && firstProgressNarration.at < firstText.at);
  const missingText = !firstText;
  const statusTone = missingText || progressBeforeText
    ? "error"
    : warningSegments.length > 0
      ? "warning"
      : sortedMarks.length > 0
        ? "success"
        : "neutral";

  return {
    summary: {
      statusLabel: missingText
        ? "未见首个文本"
        : progressBeforeText
          ? "进度早于回答"
          : warningSegments.length > 0
            ? "存在慢段"
            : sortedMarks.length > 0
              ? "链路正常"
              : "暂无数据",
      statusTone,
      recommendation: latencyRecommendation({ missingText, progressBeforeText, warningSegments, providerMode, sortedMarks }),
      firstText: firstText ? formatDuration(firstText.at - baseAt) : "未记录",
      firstReadableText: firstReadableText ? formatDuration(firstReadableText.at - baseAt) : "未记录",
      providerMode,
    },
    marks: sortedMarks.map((mark) => ({
      id: `${mark.source}:${mark.name}:${mark.at}`,
      name: mark.name,
      source: mark.source,
      at: mark.at,
      offset: formatDuration(mark.at - baseAt),
      detail: mark.detail ?? {},
    })),
    segments,
  };
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
    resultPreview: previewValue(call.result?.output ?? call.result?.content ?? call.result?.error) ?? "暂无结果记录",
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
      title: "运行失败",
      message: failureDetail
        ? `运行失败：${failureDetail}`
        : "本轮运行以失败状态结束。请查看最新事件和追踪记录定位失败分支。",
      targetType: "run",
      suggestedTab: "flow",
    });
  }
  if (snapshot.config.effectiveStrategy?.providerPolicyStatus === "degraded") {
    push({
      id: "strategy.provider-degraded",
      severity: "warning",
      title: "模型思考策略降级",
      message: snapshot.config.effectiveStrategy.notes[0] ?? "当前模型提供方无法满足该模式请求的推理策略。",
      targetType: "run",
      suggestedTab: "overview",
    });
  }
  for (const call of snapshot.toolCalls ?? []) {
    if (call.status === "failed") {
      push({
        id: `tool.failed:${call.id}`,
        severity: "error",
        title: "工具调用失败",
        message: `${toolDisplayLabel(call.toolId)} 失败${call.error ?? call.result?.error ? `：${call.error ?? call.result?.error}` : "。"}`,
        targetType: "tool",
        targetId: call.id,
        suggestedTab: "tools",
      });
    }
    if (call.status === "repaired") {
      push({
        id: `tool.repaired:${call.id}`,
        severity: "warning",
        title: "工具结果已恢复",
        message: "检测到缺失的模型工具结果，并在下一次模型调用前将其恢复为已中断状态。",
        targetType: "tool",
        targetId: call.id,
        suggestedTab: "tools",
      });
    }
    if (call.status === "interrupted") {
      push({
        id: `tool.interrupted:${call.id}`,
        severity: "warning",
        title: "工具调用已中断",
        message: "工具调用在完成前被中断。",
        targetType: "tool",
        targetId: call.id,
        suggestedTab: "tools",
      });
    }
    if (call.status === "approval_required") {
      push({
        id: `tool.approval:${call.id}`,
        severity: "warning",
        title: "工具调用等待确认",
        message: `${toolDisplayLabel(call.toolId)} 正在等待人工确认。`,
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
      title: "等待确认",
      message: "有待确认操作正在阻塞后续进度。",
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
      title: "运行续接中",
      message: `运行续接状态：${toolStatusLabel(activeContinuation.status)}，原因：${activeContinuation.reason}。`,
      targetType: "run",
      suggestedTab: "flow",
    });
  }
  for (const clarification of snapshotPendingClarifications(snapshot)) {
    push({
      id: `clarification.pending:${clarification.id}`,
      severity: "warning",
      title: "等待补充信息",
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
      title: "恢复失败",
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
      title: "停止原因",
      message: `运行停止原因：${stopReasonLabel(stopReason) ?? stopReason}。`,
      targetType: "run",
      suggestedTab: "evidence",
    });
  }
  if (trace?.provider === "ora" || trace?.source === "local") {
    push({
      id: "trace.local",
      severity: "info",
      title: "本地轨迹已启用",
      message: "Ora 原生 Trails 已启用；Langfuse 仅作为更深层可观测性的可选补充。",
      targetType: "trace",
      suggestedTab: "evidence",
    });
  } else if (!trace?.enabled) {
    push({
      id: "trace.disabled",
      severity: "info",
      title: "远程追踪未启用",
      message: "Langfuse 追踪未启用，Trails 当前以本地模式运行。",
      targetType: "trace",
      suggestedTab: "evidence",
    });
  } else if (!trace.available) {
    push({
      id: "trace.degraded",
      severity: "warning",
      title: "远程追踪不可用",
      message: trace.reason ?? "远程追踪数据不可用，当前面板使用本地合成观测。",
      targetType: "trace",
      suggestedTab: "evidence",
    });
  }
  if (trailError) {
    push({
      id: "trace.fetch-error",
      severity: "warning",
      title: "追踪数据获取降级",
      message: `追踪数据获取降级：${trailError}`,
      targetType: "trace",
      suggestedTab: "evidence",
    });
  }
  if (snapshot.events.length === 0) {
    push({
      id: "events.empty",
      severity: "info",
      title: "暂无运行事件",
      message: "本轮运行尚未记录运行时事件。",
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
    ? "已应用"
    : strategy.providerPolicyStatus === "degraded"
      ? "已降级"
      : "不支持";
  return {
    title: `${strategy.thinking} 思考策略`,
    detail: [
      `${strategy.sourceModeSelection} 模式 ${strategy.sourceModeId}`,
      `${strategy.reasoningEffort ?? "none"} 推理强度`,
      `${strategy.planning} 规划`,
      strategy.delegationEnabled
        ? `${strategy.delegation} 委派`
        : "未启用委派",
      `${strategy.budget.maxToolCalls} 次工具预算`,
    ].join(" · "),
    statusLabel,
    statusTone,
    notes: strategy.notes,
  };
}

export function buildActiveMemorySummary(snapshot: OraStateSnapshot): ActiveMemorySummary | undefined {
  const activeMemory = isRecord(snapshot.config.metadata.activeMemory)
    ? snapshot.config.metadata.activeMemory
    : undefined;
  const decision = activeMemory && isRecord(activeMemory.decision)
    ? activeMemory.decision
    : undefined;
  if (!decision) {
    return undefined;
  }

  const status = decision.status === "USE" ? "USE" : "NONE";
  const candidateIds = stringArray(decision.candidateIds);
  const selectedIds = stringArray(decision.selectedIds);
  const rejectedIds = stringArray(decision.rejectedIds);
  const budget = isRecord(decision.budget) ? decision.budget : {};
  const renderedChars = typeof budget.renderedChars === "number" ? budget.renderedChars : 0;
  const warnings = stringArray(decision.warnings);

  return {
    statusLabel: status,
    statusTone: warnings.length > 0 ? "warning" : status === "USE" ? "success" : "neutral",
    mode: typeof decision.mode === "string" ? decision.mode : "未知模式",
    reason: typeof decision.reason === "string" ? decision.reason : "未记录主动记忆选择原因。",
    candidateCount: candidateIds.length,
    selectedIds,
    rejectedCount: rejectedIds.length,
    renderedChars,
    warnings,
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
    case "latency":
      return "延迟";
    case "evidence":
      return "证据";
  }
}

export function eventKindLabel(kind: SemanticTimelineItem["kind"] | "all") {
  switch (kind) {
    case "all":
      return "全部";
    case "run":
      return "运行";
    case "agent":
      return "智能体";
    case "tool":
      return "工具";
    case "handoff":
      return "交接";
    case "checkpoint":
      return "检查点";
    case "recovery":
      return "恢复";
    case "gate":
      return "关卡";
    case "artifact":
      return "产物";
    case "state":
      return "状态";
  }
}

export function severityLabel(severity: TrailFindingSeverity | "neutral" | "all") {
  switch (severity) {
    case "all":
      return "全部";
    case "error":
      return "错误";
    case "warning":
      return "警告";
    case "info":
      return "信息";
    case "neutral":
      return "记录";
  }
}

export function agentStatusLabel(status: AgentLane["status"]) {
  switch (status) {
    case "active":
      return "进行中";
    case "blocked":
      return "已阻塞";
    case "failed":
      return "失败";
    case "done":
      return "已完成";
    case "idle":
      return "空闲";
  }
}

export function toolStatusLabel(status: string) {
  switch (status) {
    case "succeeded":
      return "已完成";
    case "failed":
      return "失败";
    case "running":
      return "运行中";
    case "approval_required":
      return "需要确认";
    case "interrupted":
      return "已中断";
    case "denied":
      return "已拒绝";
    case "repaired":
      return "已恢复";
    case "queued":
      return "排队中";
    default:
      return status.replace(/_/g, " ");
  }
}

export function toolSourceLabel(source: string) {
  switch (source) {
    case "provider native":
      return "模型工具调用";
    case "manual repair":
      return "手动恢复";
    case "runtime":
      return "运行时";
    default:
      return source;
  }
}

export function formatUsd(value: number) {
  return `$${value.toFixed(value > 0 ? 4 : 2)}`;
}

const LATENCY_SEGMENT_DEFINITIONS = [
  {
    id: "submit-to-pending-paint",
    label: "提交 → 首屏占位",
    from: "desktop:submitAt",
    to: "desktop:pendingPaintedAt",
    note: "React pending 消息是否及时绘制。",
  },
  {
    id: "pending-paint-to-handle",
    label: "首屏占位 → Runtime handle",
    from: "desktop:pendingPaintedAt",
    to: "desktop:handleReceivedAt",
    note: "handle 前同步工作：模式选择、记忆注入、快照创建与持久化。",
  },
  {
    id: "handle-to-first-stream",
    label: "Runtime handle → 首个 stream",
    from: "desktop:handleReceivedAt",
    to: "desktop:firstRunStreamReceivedAt",
    note: "JSON-RPC response 与 stream 通知到达 UI 的间隔。",
  },
  {
    id: "runtime-enter-to-first-text",
    label: "Runtime 入口 → 首个文本",
    from: "runtime:startStreamingRun.enter",
    to: "runtime:firstTextDelta",
    note: "后端从收到 run 到产生首个模型文本 delta 的总耗时。",
  },
  {
    id: "mode-selection",
    label: "模式选择",
    from: "runtime:startStreamingRun.enter",
    to: "runtime:modeSelection.done",
    note: "auto router 或手动模式解析耗时。",
  },
  {
    id: "memory-prompt",
    label: "主动记忆注入",
    from: "runtime:modeSelection.done",
    to: "runtime:memoryPrompt.done",
    note: "长期记忆候选筛选与 prompt overlay 构造耗时。",
  },
  {
    id: "kernel-to-first-event",
    label: "Kernel 调度 → 首事件",
    from: "runtime:kernelScheduled",
    to: "runtime:firstApplyLiveEvent",
    note: "kernel 启动后首个事件写入延迟。",
  },
  {
    id: "first-event-to-provider",
    label: "首事件 → 模型调用",
    from: "runtime:firstApplyLiveEvent",
    to: "runtime:providerCallStarted",
    note: "拓扑、计划、澄清预检、进度等前置逻辑耗时。",
  },
  {
    id: "provider-call-to-frame",
    label: "模型调用 → 首帧",
    from: "runtime:providerCallStarted",
    to: "provider:firstProviderStreamFrame",
    note: "供应商首包 / 本地流首帧延迟。",
  },
  {
    id: "frame-to-first-text",
    label: "首帧 → 首文本",
    from: "provider:firstProviderStreamFrame",
    to: "runtime:firstTextDelta",
    note: "reasoning、tool call 或空 delta 到文本 delta 的间隔。",
  },
  {
    id: "first-text-to-progress",
    label: "首文本 → 进度叙述",
    from: "runtime:firstTextDelta",
    to: "runtime:firstProgressNarration",
    note: "LLM progress narration 是否在首个回答之后出现。",
  },
] as const;

function buildLatencySegment(
  definition: typeof LATENCY_SEGMENT_DEFINITIONS[number],
  markByKey: Map<string, LatencyMark>,
): TrailLatencySegment {
  const from = markByKey.get(definition.from);
  const to = markByKey.get(definition.to);
  if (!from || !to) {
    return {
      id: definition.id,
      label: definition.label,
      from: latencyMarkLabel(definition.from),
      to: latencyMarkLabel(definition.to),
      duration: "未记录",
      status: "missing",
      note: definition.note,
    };
  }
  const durationMs = Math.max(0, to.at - from.at);
  return {
    id: definition.id,
    label: definition.label,
    from: latencyMarkLabel(definition.from),
    to: latencyMarkLabel(definition.to),
    duration: formatDuration(durationMs),
    durationMs,
    status: latencySegmentStatus(durationMs),
    note: definition.note,
  };
}

function latencySegmentStatus(durationMs: number): TrailLatencySegment["status"] {
  if (durationMs >= 2_000) return "slow";
  if (durationMs >= 500) return "warning";
  return "ok";
}

function latencyMarkLabel(key: string): string {
  const [, name] = key.split(":");
  switch (name) {
    case "submitAt":
      return "提交";
    case "pendingPaintedAt":
      return "首屏占位";
    case "handleReceivedAt":
      return "收到 handle";
    case "firstRunStreamReceivedAt":
      return "首个 stream";
    case "firstMessageDeltaAt":
    case "firstTextDelta":
      return "首个文本";
    case "firstNonProgressAssistantTextAt":
    case "firstUserReadableAssistantTextProduced":
      return "首个可读回答";
    case "startStreamingRun.enter":
      return "Runtime 入口";
    case "modeSelection.done":
      return "模式选择完成";
    case "memoryPrompt.done":
      return "记忆注入完成";
    case "kernelScheduled":
      return "Kernel 已调度";
    case "firstApplyLiveEvent":
      return "首事件";
    case "providerCallStarted":
      return "模型调用";
    case "firstProviderStreamFrame":
      return "供应商首帧";
    case "firstProgressNarration":
      return "进度叙述";
    default:
      return name ?? key;
  }
}

function latencyRecommendation(params: {
  missingText: boolean;
  progressBeforeText: boolean;
  warningSegments: TrailLatencySegment[];
  providerMode: string;
  sortedMarks: LatencyMark[];
}): string {
  if (params.sortedMarks.length === 0) {
    return "暂无 latency.marks。请确认当前 run 使用了带延迟诊断的 runtime。";
  }
  if (params.missingText) {
    return "尚未记录首个文本 delta。优先检查 provider 首包、工具先行或模型是否只返回 tool call。";
  }
  if (params.progressBeforeText) {
    return "进度叙述早于首个回答。应继续保护 progress narration，避免首屏被进度抢占。";
  }
  const firstSlow = params.warningSegments.find((segment) => segment.status === "slow") ?? params.warningSegments[0];
  if (firstSlow) {
    return `优先检查慢段：${firstSlow.label}（${firstSlow.duration}）。`;
  }
  if (params.providerMode === "fallback_single") {
    return "当前 provider 使用 fallback_single，不是真流式；首 token 只能等完整响应。";
  }
  return "当前记录未显示明显慢段。若用户仍感觉慢，下一步抓真实 provider 和工具先行场景。";
}

function currentBlockingGate(snapshot: OraStateSnapshot) {
  const clarification = snapshotPendingClarifications(snapshot)[0];
  if (clarification) {
    return `补充信息 · ${clarification.nodeLabel}`;
  }
  const approval = buildPendingApprovalItems(snapshot)[0];
  if (approval) {
    return `确认 · ${approval.nodeLabel}`;
  }
  return "无";
}

function inferCurrentStage(snapshot: OraStateSnapshot, lastImportantEvent?: SemanticTimelineItem) {
  if (snapshot.status === "failed") {
    return "在最新关键事件处失败";
  }
  if (snapshot.status === "succeeded") {
    return stopReasonLabel(stopReasonFromSnapshot(snapshot)) ?? "已完成";
  }
  if (snapshot.status === "interrupted" || snapshot.pendingApprovals.length > 0 || snapshot.pendingClarifications.length > 0) {
    return "等待用户输入";
  }
  if (snapshot.activeAgents.length > 0) {
    return `进行中：${snapshot.activeAgents.join(", ")}`;
  }
  return lastImportantEvent?.label ?? "运行时已初始化";
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

function shouldShowSemanticEvent(event: OraStateSnapshot["events"][number], includeInternalEvents: boolean) {
  if (event.type === "token.delta" || event.type === "message.delta") {
    return false;
  }
  if (includeInternalEvents) {
    return true;
  }
  if (event.type === "worker.claimed" || event.type === "worker.released" || event.type === "queue.updated" || event.type === "topology.updated") {
    return false;
  }
  if (event.type === "node.updated") {
    return isImportantNodeEvent(event);
  }
  if (event.type === "action.updated") {
    return isImportantActionEvent(event);
  }
  return true;
}

function isImportantNodeEvent(event: OraStateSnapshot["events"][number]): boolean {
  if (!isRecord(event.payload) || typeof event.payload.state !== "string") {
    return false;
  }
  return ["failed", "interrupted", "repairing", "degraded", "blocked"].includes(event.payload.state);
}

function isImportantActionEvent(event: OraStateSnapshot["events"][number]): boolean {
  if (!isRecord(event.payload)) {
    return false;
  }
  const status = typeof event.payload.status === "string" ? event.payload.status : undefined;
  if (status === "failed" || status === "approval_required") {
    return true;
  }
  const record = isRecord(event.payload.record) ? event.payload.record : undefined;
  const recordState = typeof record?.state === "string" ? record.state : undefined;
  const recordStatus = typeof record?.status === "string" ? record.status : undefined;
  return recordState === "failed" || recordStatus === "failed" || recordStatus === "approval_required";
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
      return "智能体启动";
    case "agent.completed":
      return "智能体完成";
    case "topology.updated":
      return "拓扑变更";
    case "action.updated":
      return "操作变更";
    case "task.started":
      return "任务开始";
    case "task.progress":
      return "任务进展";
    case "task.completed":
      return "任务完成";
    case "task.failed":
      return "任务失败";
    case "tool.called":
      return "工具调用";
    case "tool.repaired":
      return "工具结果已恢复";
    case "approval.required":
      return "需要确认";
    case "approval.resolved":
      return "确认已处理";
    case "clarification.required":
      return "需要补充信息";
    case "clarification.resolved":
      return "补充信息已处理";
    case "checkpoint.created":
      return "已记录检查点";
    case "artifact.exported":
      return "产物已导出";
    case "artifact.degraded":
      return "产物已降级";
    case "completion.updated":
      return "生成控制";
    case "node.updated":
      return "节点运行状态";
    case "recovery.detected":
      return "检测到恢复需求";
    case "recovery.retry_scheduled":
      return "已安排重试";
    case "recovery.applied":
      return "恢复已应用";
    case "recovery.exhausted":
      return "恢复失败";
    case "node.skipped":
      return "节点已跳过";
    case "agent.message":
      return "智能体消息";
    case "message.published":
      return "消息已发布";
    case "message.routed":
      return "消息已路由";
    case "worker.claimed":
      return "工作单元接手";
    case "worker.released":
      return "工作单元释放";
    case "run.started":
      return "运行开始";
    case "run.resumed":
      return "运行继续";
    case "run.forked":
      return "运行已分叉";
    case "run.replayed":
      return "运行已重放";
    case "run.interrupted":
      return "运行已暂停";
    case "run.cancelled":
      return "运行已取消";
    case "run.done":
      return "运行已完成";
    case "run.failed":
      return "运行失败";
    default:
      return eventType.replace(/\./g, " ");
  }
}

function timelineDetail(event: OraStateSnapshot["events"][number]) {
  if (isRecord(event.payload)) {
    if (event.type === "tool.called" || event.type === "tool.repaired") {
      const toolId = typeof event.payload.toolId === "string" ? event.payload.toolId : "tool";
      const status = typeof event.payload.status === "string" ? event.payload.status : "updated";
      return `${toolDisplayLabel(toolId)}：${toolStatusLabel(status)}。`;
    }
    if (event.type === "checkpoint.created" && typeof event.payload.label === "string") {
      return event.payload.label;
    }
    if (isRecord(event.payload.decision) && typeof event.payload.decision.summary === "string") {
      return event.payload.decision.summary;
    }
    const readable = readablePayloadText(event.payload);
    if (readable) {
      return readable;
    }
  }
  return "运行状态已更新。";
}

function readablePayloadText(payload: Record<string, unknown>): string | undefined {
  const candidates = [
    payload.summary,
    payload.message,
    payload.title,
    payload.detail,
    payload.content,
    payload.error,
    payload.reason,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return undefined;
}

function toolDisplayLabel(toolId: string) {
  switch (toolId) {
    case "web.fetch":
      return "浏览网页";
    case "web.search":
      return "搜索网页";
    case "file.read":
      return "读取文件";
    case "file.list":
      return "列出文件";
    case "file.glob":
      return "匹配文件";
    case "file.grep":
      return "搜索文件";
    case "file.write":
      return "写入文件";
    case "file.patch":
      return "修改文件";
    case "shell.execute":
      return "运行命令";
    case "mcp.call":
      return "调用 MCP 工具";
    default:
      return toolId;
  }
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

function stopReasonLabel(reason?: string): string | undefined {
  if (!reason) {
    return undefined;
  }
  switch (reason) {
    case "completed":
    case "stop":
      return "已完成";
    case "cancelled":
    case "canceled":
      return "已取消";
    case "tool_use_stopped":
      return "已停止工具调用";
    default:
      return reason;
  }
}

function runStatusLabel(status: OraStateSnapshot["status"]) {
  switch (status) {
    case "succeeded":
      return "已完成";
    case "failed":
      return "失败";
    case "interrupted":
      return "等待中";
    case "cancelled":
      return "已取消";
    case "queued":
      return "排队中";
    default:
      return "运行中";
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
    return "不可用";
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
    return "确认关卡";
  }
  return type.replace(/^graph\./, "").replace(/\./g, " ");
}

function fallbackApprovalReason(riskLevel?: "low" | "medium" | "high") {
  return riskLevel === "high"
    ? "继续前请确认这个操作。"
    : "继续这个步骤前请确认。";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
