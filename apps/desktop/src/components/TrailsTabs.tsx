import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  BarChart3,
  Bot,
  Boxes,
  CheckCircle2,
  CircleAlert,
  Clock3,
  Database,
  ExternalLink,
  GitBranch,
  ListFilter,
  Network,
  Radar,
  Route,
  SlidersHorizontal,
  Wrench,
} from "lucide-react";
import { DockCard } from "./DockCard";
import { JsonTree } from "./JsonTree";
import { Button } from "./ui/button";
import type {
  ActionRecord,
  AgentProfile,
  ArtifactRecord,
  CheckpointRecord,
  PlanItem,
  RunBeat,
  SessionRun,
  TopologyNode,
} from "../types";
import { getSharedRuntimeClient, type OraRunTrail, type OraSessionRunSummary, type OraStateSnapshot } from "../lib/runtimeClient";
import type { DesktopRunInteractionState } from "../lib/runInteractionState";
import { toolRendererRegistry } from "../lib/toolRendererRegistry";
import {
  buildAgentLanes,
  buildActiveMemorySummary,
  buildCommunicationGraph,
  buildContextWindowSummary,
  buildConversationView,
  buildEffectiveStrategySummary,
  buildMemoryDetailSummary,
  buildPlanProgressSummary,
  buildPolicyDecisionsSummary,
  buildPendingApprovalItems,
  buildSemanticTimeline,
  buildTodoProgressSummary,
  buildToolLedger,
  buildLatencyDiagnostics,
  agentStatusLabel,
  buildTrailDebugSummary,
  canOpenLangfuseTrace,
  collectTrailFindings,
  eventKindLabel,
  formatUsd,
  severityLabel,
  snapshotPendingClarifications,
  tabLabel,
  toolSourceLabel,
  toolStatusLabel,
  type CommunicationEdge,
  type ContextWindowSummary,
  type ConversationViewEntry,
  type MemoryDetailSummary,
  type PlanProgressSummary,
  type PolicyDecisionsSummary,
  type SemanticTimelineItem,
  type TodoProgressSummary,
  type TrailDebuggerTab,
  type TrailFinding,
  type TrailFindingSeverity,
  type ToolLedgerItem,
  type TrailLatencyDiagnostics,
} from "../lib/trailViewModel";

const trailsTabs: TrailDebuggerTab[] = ["overview", "flow", "agents", "tools", "latency", "evidence", "compare"];
const severityOptions: Array<TrailFindingSeverity | "all"> = ["all", "error", "warning", "info"];

interface TrailsTabsProps {
  actions: ActionRecord[];
  agents: AgentProfile[];
  artifacts: ArtifactRecord[];
  activeSnapshot: OraStateSnapshot;
  busyCommand?: string;
  checkpoints: CheckpointRecord[];
  commandFeedback: string;
  planItems: PlanItem[];
  selectedAgent?: AgentProfile;
  selectedBeat?: RunBeat;
  selectedCheckpoint?: CheckpointRecord;
  selectedNode?: TopologyNode;
  runInteractionState: DesktopRunInteractionState;
  selectedSession: SessionRun;
  onForkRun: () => void;
  onResumeRun: () => void;
  onCancelRun: () => void;
}

export function TrailsTabs({
  actions,
  agents,
  artifacts,
  activeSnapshot,
  busyCommand,
  checkpoints,
  commandFeedback,
  planItems,
  selectedAgent,
  selectedBeat,
  selectedCheckpoint,
  selectedNode,
  runInteractionState,
  selectedSession,
  onForkRun,
  onResumeRun,
  onCancelRun,
}: TrailsTabsProps) {
  const runtimeClient = getSharedRuntimeClient();
  const [selectedTab, setSelectedTab] = useState<TrailDebuggerTab>("overview");
  const [trail, setTrail] = useState<OraRunTrail | undefined>(undefined);
  const [trailLoading, setTrailLoading] = useState(false);
  const [trailError, setTrailError] = useState<string | undefined>(undefined);
  const [openingTrace, setOpeningTrace] = useState(false);
  const [severityFilter, setSeverityFilter] = useState<TrailFindingSeverity | "all">("all");
  const [eventKindFilter, setEventKindFilter] = useState<string>("all");
  const [showInternalEvents, setShowInternalEvents] = useState(false);
  const [expandedTimelineId, setExpandedTimelineId] = useState<string | undefined>(undefined);
  const [conversationView, setConversationView] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [agentFilter, setAgentFilter] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function loadTrail() {
      setTrailLoading(true);
      setTrailError(undefined);
      try {
        const nextTrail = await runtimeClient.getRunTrail(activeSnapshot.runId);
        if (!cancelled) {
          setTrail(nextTrail);
        }
      } catch (error) {
        if (!cancelled) {
          setTrail(undefined);
          setTrailError(error instanceof Error ? error.message : "追踪数据加载失败。");
        }
      } finally {
        if (!cancelled) {
          setTrailLoading(false);
        }
      }
    }

    void loadTrail();
    return () => {
      cancelled = true;
    };
  }, [activeSnapshot.runId, runtimeClient]);

  const trace = trail?.trace ?? activeSnapshot.trace;
  const findings = useMemo(
    () => collectTrailFindings(activeSnapshot, trailError, trace, actions),
    [activeSnapshot, trailError, trace, actions],
  );
  const summary = useMemo(
    () => buildTrailDebugSummary(activeSnapshot, trail, actions, findings),
    [activeSnapshot, trail, actions, findings],
  );
  const timelineItems = useMemo(() => buildSemanticTimeline(activeSnapshot, { includeInternalEvents: showInternalEvents }), [activeSnapshot, showInternalEvents]);
  const eventKinds = useMemo(() => ["all", ...Array.from(new Set(timelineItems.map((item) => item.kind)))], [timelineItems]);
  const agentLanes = useMemo(() => buildAgentLanes(activeSnapshot, agents, trail, findings), [activeSnapshot, agents, trail, findings]);
  const toolLedger = useMemo(() => buildToolLedger(activeSnapshot), [activeSnapshot]);
  const latencyDiagnostics = useMemo(() => buildLatencyDiagnostics(activeSnapshot), [activeSnapshot]);
  const pendingApprovals = useMemo(() => buildPendingApprovalItems(activeSnapshot), [activeSnapshot]);
  const effectiveStrategy = useMemo(() => buildEffectiveStrategySummary(activeSnapshot), [activeSnapshot]);
  const activeMemorySummary = useMemo(() => buildActiveMemorySummary(activeSnapshot), [activeSnapshot]);
  const pendingClarifications = snapshotPendingClarifications(activeSnapshot);
  const conversationEntries = useMemo(() => buildConversationView(activeSnapshot), [activeSnapshot]);
  const planProgress = useMemo(() => buildPlanProgressSummary(activeSnapshot), [activeSnapshot]);
  const policyDecisions = useMemo(() => buildPolicyDecisionsSummary(activeSnapshot), [activeSnapshot]);
  const todoProgress = useMemo(() => buildTodoProgressSummary(activeSnapshot), [activeSnapshot]);
  const memoryDetail = useMemo(() => buildMemoryDetailSummary(activeSnapshot), [activeSnapshot]);
  const contextWindow = useMemo(() => buildContextWindowSummary(activeSnapshot), [activeSnapshot]);
  const communicationEdges = useMemo(() => buildCommunicationGraph(activeSnapshot), [activeSnapshot]);
  const visibleFindings = severityFilter === "all" ? findings : findings.filter((finding) => finding.severity === severityFilter);
  const searchLower = searchQuery.toLowerCase().trim();
  const visibleTimeline = timelineItems
    .filter((item) => eventKindFilter === "all" || item.kind === eventKindFilter)
    .filter((item) => {
      if (!searchLower) return true;
      if (item.label.toLowerCase().includes(searchLower)) return true;
      if (item.detail.toLowerCase().includes(searchLower)) return true;
      if (item.agentLabel?.toLowerCase().includes(searchLower)) return true;
      if (item.nodeLabel?.toLowerCase().includes(searchLower)) return true;
      if (JSON.stringify(item.rawPayload).toLowerCase().includes(searchLower)) return true;
      return false;
    })
    .filter((item) => {
      if (agentFilter.length === 0) return true;
      return agentFilter.some((a) => item.agentLabel === a || item.agentId === a);
    });
  const allAgentLabels = useMemo(() => {
    const labels = new Map<string, string>();
    for (const e of activeSnapshot.events) {
      if (e.agentId && !labels.has(e.agentId)) {
        labels.set(e.agentId, e.agentId);
      }
    }
    return [...labels.values()].sort();
  }, [activeSnapshot]);
  const traceOpenUnavailable = !canOpenLangfuseTrace(trace);
  const traceOpenDisabled = traceOpenUnavailable || openingTrace;

  async function handleOpenTrace() {
    const traceUrl = trace?.traceUrl;
    if (!traceUrl || !canOpenLangfuseTrace(trace)) {
      return;
    }
    setOpeningTrace(true);
    try {
      await runtimeClient.openExternalUrl(traceUrl);
    } finally {
      setOpeningTrace(false);
    }
  }

  function jumpToFinding(finding: TrailFinding) {
    setSelectedTab(finding.suggestedTab);
    if (finding.targetType === "event" && finding.targetId) {
      setExpandedTimelineId(finding.targetId);
    }
  }

  return (
    <div className="w-full min-w-0">
      <div className="sticky top-0 z-10 border-b border-bench-200 bg-card/95 px-3 py-3 backdrop-blur">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <StatusChip tone={summary.statusTone}>{summary.statusLabel}</StatusChip>
              <span className="min-w-0 truncate text-sm font-semibold text-bench-900">{summary.currentStage}</span>
            </div>
            <p className="mt-1 truncate text-xs text-bench-700">{summary.recommendation}</p>
          </div>
          <div className="shrink-0 text-right text-[11px] leading-5 text-bench-700">
            <p>{summary.metrics.runtime}</p>
            <p>{summary.metrics.costAvailable === false ? "成本数据不可用" : summary.metrics.cost} · {summary.metrics.messages} msg</p>
          </div>
        </div>

        <div className="mt-3 flex gap-1 overflow-x-auto">
          {trailsTabs.map((tab) => (
            <button
              key={tab}
              onClick={() => setSelectedTab(tab)}
              className={`shrink-0 rounded px-2.5 py-1.5 text-[11px] font-semibold transition active:scale-95 ${
                selectedTab === tab ? "bg-bench-900 text-white" : "text-bench-700 hover:bg-white"
              }`}
            >
              {tabLabel(tab)}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-3 p-4">
        {selectedTab === "overview" && (
          <TrailOverview
            activeSnapshot={activeSnapshot}
            activeMemorySummary={activeMemorySummary}
            artifacts={artifacts}
            busyCommand={busyCommand}
            checkpoints={checkpoints}
            commandFeedback={commandFeedback}
            contextWindow={contextWindow}
            findings={visibleFindings}
            memoryDetail={memoryDetail}
            onCancelRun={onCancelRun}
            onFindingClick={jumpToFinding}
            onForkRun={onForkRun}
            onResumeRun={onResumeRun}
            pendingApprovals={pendingApprovals}
            pendingClarifications={pendingClarifications}
            planProgress={planProgress}
            policyDecisions={policyDecisions}
            effectiveStrategy={effectiveStrategy}
            selectedCheckpoint={selectedCheckpoint}
            selectedNode={selectedNode}
            runInteractionState={runInteractionState}
            selectedSession={selectedSession}
            summary={summary}
            timelineItems={timelineItems}
            todoProgress={todoProgress}
          />
        )}

        {selectedTab === "flow" && (
          <TrailFlow
            agentFilter={agentFilter}
            allAgentLabels={allAgentLabels}
            conversationEntries={conversationEntries}
            conversationView={conversationView}
            eventKindFilter={eventKindFilter}
            eventKinds={eventKinds}
            expandedTimelineId={expandedTimelineId}
            items={visibleTimeline}
            searchQuery={searchQuery}
            onAgentFilterChange={setAgentFilter}
            onConversationViewChange={setConversationView}
            onEventKindFilterChange={setEventKindFilter}
            onSearchChange={setSearchQuery}
            onToggleItem={(id) => setExpandedTimelineId((current) => current === id ? undefined : id)}
            onToggleInternalEvents={() => setShowInternalEvents((current) => !current)}
            selectedBeat={selectedBeat}
            showInternalEvents={showInternalEvents}
          />
        )}

        {selectedTab === "agents" && (
          <TrailAgents
            communicationEdges={communicationEdges}
            lanes={agentLanes}
            selectedAgentId={selectedAgent?.id}
            topologyEdges={activeSnapshot.topology.edges}
            topologyNodes={activeSnapshot.topology.nodes}
          />
        )}

        {selectedTab === "tools" && (
          <TrailTools
            commandFeedback={commandFeedback}
            items={toolLedger}
          />
        )}

        {selectedTab === "latency" && (
          <TrailLatency diagnostics={latencyDiagnostics} />
        )}

        {selectedTab === "evidence" && (
          <TrailEvidence
            activeSnapshot={activeSnapshot}
            artifacts={artifacts}
            checkpoints={checkpoints}
            handleOpenTrace={handleOpenTrace}
            openingTrace={openingTrace}
            planItems={planItems}
            trace={trace}
            traceOpenDisabled={traceOpenDisabled}
            traceOpenUnavailable={traceOpenUnavailable}
            trail={trail}
            trailError={trailError}
            trailLoading={trailLoading}
          />
        )}

        {selectedTab === "compare" && (
          <TrailCompare
            activeSnapshot={activeSnapshot}
            sessionId={activeSnapshot.sessionId}
            runtimeClient={runtimeClient}
          />
        )}

        {(selectedTab === "overview" || selectedTab === "flow") && findings.length > 0 && (
          <DockCard title="发现筛选" icon={<ListFilter size={16} />}>
            <div className="flex flex-wrap gap-2">
              {severityOptions.map((severity) => (
                <button
                  key={severity}
                  onClick={() => setSeverityFilter(severity)}
                  className={`rounded px-2.5 py-1 text-[11px] font-semibold transition active:scale-95 ${
                    severityFilter === severity ? "bg-bench-900 text-white" : "bg-bench-50 text-bench-700 ring-1 ring-inset ring-bench-200"
                  }`}
                >
                  {severityLabel(severity)}
                </button>
              ))}
            </div>
          </DockCard>
        )}
      </div>
    </div>
  );
}

function TrailOverview({
  activeSnapshot,
  activeMemorySummary,
  artifacts,
  busyCommand,
  checkpoints,
  commandFeedback,
  contextWindow,
  findings,
  memoryDetail,
  pendingApprovals,
  pendingClarifications,
  planProgress,
  policyDecisions,
  effectiveStrategy,
  runInteractionState,
  selectedCheckpoint,
  selectedNode,
  selectedSession,
  summary,
  timelineItems,
  todoProgress,
  onCancelRun,
  onFindingClick,
  onForkRun,
  onResumeRun,
}: {
  activeSnapshot: OraStateSnapshot;
  activeMemorySummary?: ReturnType<typeof buildActiveMemorySummary>;
  artifacts: ArtifactRecord[];
  busyCommand?: string;
  checkpoints: CheckpointRecord[];
  commandFeedback: string;
  contextWindow?: ContextWindowSummary;
  findings: TrailFinding[];
  memoryDetail?: MemoryDetailSummary;
  pendingApprovals: ReturnType<typeof buildPendingApprovalItems>;
  pendingClarifications: OraStateSnapshot["pendingClarifications"];
  planProgress?: PlanProgressSummary;
  policyDecisions?: PolicyDecisionsSummary;
  effectiveStrategy: ReturnType<typeof buildEffectiveStrategySummary>;
  runInteractionState: DesktopRunInteractionState;
  selectedCheckpoint?: CheckpointRecord;
  selectedNode?: TopologyNode;
  selectedSession: SessionRun;
  summary: ReturnType<typeof buildTrailDebugSummary>;
  timelineItems: SemanticTimelineItem[];
  todoProgress?: TodoProgressSummary;
  onCancelRun: () => void;
  onFindingClick: (finding: TrailFinding) => void;
  onForkRun: () => void;
  onResumeRun: () => void;
}) {
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <OverviewMetric label="运行" value={runInteractionState.status.replace(/_/g, " ")} detail={activeSnapshot.runId} />
        <OverviewMetric label="阶段" value={summary.currentStage} detail={summary.blockingGate === "无" ? "暂无人工关卡" : summary.blockingGate} />
        <OverviewMetric label="焦点" value={selectedNode?.label ?? "运行概览"} detail={selectedCheckpoint?.label ?? "未选择检查点"} />
        <OverviewMetric label="证据" value={`${timelineItems.length} 个事件`} detail={`${checkpoints.length} 个检查点 · ${artifacts.length} 个产物`} />
      </div>

      <DockCard title="发现" icon={<Radar size={16} />}>
        {findings.length === 0 ? (
          <p className="text-xs leading-5 text-bench-700">本轮运行没有需要关注的发现。原始观测可在「证据」中查看。</p>
        ) : (
          <div className="space-y-2">
            {findings.map((finding) => (
              <button
                key={finding.id}
                onClick={() => onFindingClick(finding)}
                className="block w-full rounded-md bg-bench-50 px-3 py-2 text-left ring-1 ring-inset ring-bench-200 transition hover:bg-white active:scale-[0.99]"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-bench-900">{finding.title}</span>
                  <SeverityPill severity={finding.severity} />
                </div>
                <p className="mt-1 text-xs leading-5 text-bench-700">{finding.message}</p>
              </button>
            ))}
          </div>
        )}
      </DockCard>

      {effectiveStrategy && (
        <DockCard title="运行策略" icon={<SlidersHorizontal size={16} />}>
          <div className="rounded-md bg-bench-50 px-3 py-2 ring-1 ring-inset ring-bench-200">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-bench-900">{effectiveStrategy.title}</span>
              <StatusChip tone={effectiveStrategy.statusTone}>{effectiveStrategy.statusLabel}</StatusChip>
            </div>
            <p className="mt-1 text-xs leading-5 text-bench-700">{effectiveStrategy.detail}</p>
            {effectiveStrategy.notes.length > 0 && (
              <p className="mt-2 text-xs leading-5 text-amber-900">{effectiveStrategy.notes.join(" ")}</p>
            )}
          </div>
        </DockCard>
      )}

      {activeMemorySummary && (
        <DockCard title="主动记忆" icon={<Database size={16} />}>
          <div className="rounded-md bg-bench-50 px-3 py-2 ring-1 ring-inset ring-bench-200">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-bench-900">{activeMemorySummary.mode}</span>
              <StatusChip tone={activeMemorySummary.statusTone}>{activeMemorySummary.statusLabel}</StatusChip>
            </div>
            <p className="mt-1 text-xs leading-5 text-bench-700">{activeMemorySummary.reason}</p>
            <p className="mt-2 text-[11px] text-bench-700">
              {activeMemorySummary.selectedIds.length} 条已选 · {activeMemorySummary.rejectedCount} 条已排除 · {activeMemorySummary.candidateCount} 条候选 · {activeMemorySummary.renderedChars} 字符
            </p>
            {activeMemorySummary.selectedIds.length > 0 && (
              <p className="mt-2 truncate font-mono text-[11px] text-bench-700">{activeMemorySummary.selectedIds.join(", ")}</p>
            )}
            {activeMemorySummary.warnings.length > 0 && (
              <p className="mt-2 text-xs leading-5 text-amber-900">{activeMemorySummary.warnings.join(" ")}</p>
            )}
          </div>
        </DockCard>
      )}

      <DockCard title="阻塞关卡" icon={<CircleAlert size={16} />}>
        {pendingApprovals.length === 0 && pendingClarifications.length === 0 ? (
          <p className="text-xs leading-5 text-bench-700">当前运行没有暂停在人工关卡后。</p>
        ) : (
          <div className="space-y-2">
            {pendingApprovals.map((item) => (
              <div key={item.actionId} className="rounded-md bg-amber-50 px-3 py-2 ring-1 ring-inset ring-amber-200">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-amber-950">{item.nodeLabel}</span>
                  <span className="text-[11px] font-semibold uppercase text-amber-900">{item.riskLevel}</span>
                </div>
                <p className="mt-1 text-xs leading-5 text-amber-900">{item.reason}</p>
              </div>
            ))}
            {pendingClarifications.map((item) => (
              <div key={item.id} className="rounded-md bg-sky-50 px-3 py-2 ring-1 ring-inset ring-sky-200">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-sky-950">{item.nodeLabel}</span>
                  <span className="text-[11px] font-semibold text-sky-900">补充信息</span>
                </div>
                <p className="mt-1 text-xs leading-5 text-sky-900">{item.question}</p>
              </div>
            ))}
          </div>
        )}
      </DockCard>

      <DockCard title="执行地图" icon={<Network size={16} />}>
        {activeSnapshot.topology.nodes.length === 0 ? (
          <p className="text-xs leading-5 text-bench-700">本轮运行没有记录拓扑节点。</p>
        ) : (
          <div className="space-y-2">
            {activeSnapshot.topology.nodes.slice(0, 8).map((node) => (
              <div key={node.id} className={`rounded-md px-3 py-2 ring-1 ring-inset ${node.id === selectedNode?.id ? "bg-bench-100 ring-bench-900" : "bg-bench-50 ring-bench-200"}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-semibold text-bench-900">{node.label}</span>
                  <span className="shrink-0 text-[11px] capitalize text-bench-700">{node.status}</span>
                </div>
                <p className="truncate text-[11px] text-bench-700">{node.kind}{node.agentId ? ` · ${node.agentId}` : ""}</p>
              </div>
            ))}
          </div>
        )}
      </DockCard>

      {contextWindow && (
        <DockCard title="上下文窗口" icon={<Database size={16} />}>
          <div className="rounded-md bg-bench-50 px-3 py-2 ring-1 ring-inset ring-bench-200">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-bench-900">
                {contextWindow.inputTokens.toLocaleString()} / {contextWindow.contextWindow?.toLocaleString() ?? "?"} tokens
              </span>
              <StatusChip tone={contextWindow.needsCompaction ? "warning" : "success"}>
                {contextWindow.usagePercent !== undefined ? `${contextWindow.usagePercent}%` : "未知"}
              </StatusChip>
            </div>
            <p className="mt-1 text-xs leading-5 text-bench-700">
              输入 {contextWindow.inputTokens.toLocaleString()} · 输出 {contextWindow.outputTokens.toLocaleString()} · 已压缩 {contextWindow.compactionCount} 次
            </p>
            {contextWindow.needsCompaction && (
              <p className="mt-1 text-xs leading-5 text-amber-900">上下文使用率超过 80%，建议关注是否即将触发压缩。</p>
            )}
          </div>
        </DockCard>
      )}

      {planProgress && (
        <DockCard title="执行计划" icon={<CheckCircle2 size={16} />}>
          <div className="rounded-md bg-bench-50 px-3 py-2 ring-1 ring-inset ring-bench-200">
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="text-sm font-semibold text-bench-900">计划进度</span>
              <span className="text-[11px] text-bench-700">{planProgress.completedSteps}/{planProgress.totalSteps} 步</span>
            </div>
            {planProgress.planList.length > 0 && (
              <div className="space-y-1">
                {planProgress.planList.map((step, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <span className={step.status === "completed" ? "text-emerald-600" : step.status === "in_progress" ? "text-amber-600" : "text-bench-400"}>
                      {step.status === "completed" ? "✓" : step.status === "in_progress" ? "○" : "·"}
                    </span>
                    <span className="text-bench-700">{step.step}</span>
                  </div>
                ))}
              </div>
            )}
            {planProgress.planItems.map((item, i) => (
              <div key={i} className="mt-1 text-[11px] text-bench-700">
                {item.title} · {item.status}{item.owner ? ` · ${item.owner}` : ""}
              </div>
            ))}
          </div>
        </DockCard>
      )}

      {todoProgress && (
        <DockCard title="任务进度" icon={<CheckCircle2 size={16} />}>
          <div className="space-y-1.5">
            <p className="text-xs text-bench-700">{todoProgress.completed}/{todoProgress.total} 已完成</p>
            {todoProgress.todos.map((todo, i) => (
              <div key={i} className="rounded-md bg-bench-50 px-3 py-1.5 ring-1 ring-inset ring-bench-200">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-bench-800">{todo.label}</span>
                  <span className="text-[10px] text-bench-500">{todo.status}</span>
                </div>
                {todo.detail && <p className="mt-0.5 text-[11px] text-bench-600">{todo.detail}</p>}
              </div>
            ))}
          </div>
        </DockCard>
      )}

      {policyDecisions && (
        <DockCard title="策略决策" icon={<Radar size={16} />}>
          <div className="space-y-1.5">
            {policyDecisions.decisions.map((d, i) => (
              <div key={i} className="rounded-md bg-bench-50 px-3 py-2 ring-1 ring-inset ring-bench-200">
                <p className="text-xs font-medium text-bench-800">{d.policyId}</p>
                <p className="mt-0.5 text-[11px] text-bench-600">{d.reason}</p>
                <span className="mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold bg-bench-100 text-bench-700">
                  {d.requiredApproval ? "需确认" : "自动通过"}
                </span>
              </div>
            ))}
          </div>
        </DockCard>
      )}

      {memoryDetail && (
        <DockCard title="记忆详情" icon={<Database size={16} />}>
          <p className="text-xs text-bench-700 mb-2">共 {memoryDetail.total} 条记录</p>
          <div className="space-y-1.5">
            {memoryDetail.records.slice(0, 5).map((r, i) => (
              <div key={i} className="rounded-md bg-bench-50 px-3 py-2 ring-1 ring-inset ring-bench-200">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold text-bench-700">{r.namespace}</span>
                  <span className="text-[10px] text-bench-500">{r.kind}</span>
                </div>
                <p className="mt-0.5 truncate text-[11px] text-bench-600">{r.value}</p>
              </div>
            ))}
          </div>
        </DockCard>
      )}

      <DockCard title="操作" icon={<Activity size={16} />}>
        <p className="mb-3 text-xs leading-5 text-bench-700">{commandFeedback}</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={onForkRun} disabled={busyCommand !== undefined || !selectedCheckpoint}>
            分叉
          </Button>
          <Button variant="secondary" size="sm" onClick={onResumeRun} disabled={busyCommand !== undefined || !runInteractionState.canResume}>
            继续
          </Button>
          <Button variant="secondary" size="sm" onClick={onCancelRun} disabled={busyCommand !== undefined || !runInteractionState.canStop}>
            取消
          </Button>
        </div>
      </DockCard>
    </>
  );
}

function TrailFlow({
  agentFilter,
  allAgentLabels,
  conversationEntries,
  conversationView,
  eventKindFilter,
  eventKinds,
  expandedTimelineId,
  items,
  searchQuery,
  selectedBeat,
  showInternalEvents,
  onAgentFilterChange,
  onConversationViewChange,
  onEventKindFilterChange,
  onSearchChange,
  onToggleInternalEvents,
  onToggleItem,
}: {
  agentFilter: string[];
  allAgentLabels: string[];
  conversationEntries: ConversationViewEntry[];
  conversationView: boolean;
  eventKindFilter: string;
  eventKinds: string[];
  expandedTimelineId?: string;
  items: SemanticTimelineItem[];
  searchQuery: string;
  selectedBeat?: RunBeat;
  showInternalEvents: boolean;
  onAgentFilterChange: (value: string[]) => void;
  onConversationViewChange: (value: boolean) => void;
  onEventKindFilterChange: (value: string) => void;
  onSearchChange: (value: string) => void;
  onToggleInternalEvents: () => void;
  onToggleItem: (id: string) => void;
}) {
  return (
    <>
      <DockCard title="搜索与筛选" icon={<ListFilter size={16} />}>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="搜索事件、payload、智能体、节点..."
          className="w-full rounded-md bg-white px-3 py-2 text-xs ring-1 ring-inset ring-bench-200 placeholder:text-bench-400 focus:outline-none focus:ring-2 focus:ring-bench-900 mb-2"
        />
        {allAgentLabels.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {allAgentLabels.map((label) => (
              <button
                key={label}
                onClick={() => {
                  onAgentFilterChange(
                    agentFilter.includes(label)
                      ? agentFilter.filter((a) => a !== label)
                      : [...agentFilter, label],
                  );
                }}
                className={`rounded px-2 py-0.5 text-[10px] font-semibold transition active:scale-95 ${
                  agentFilter.includes(label) ? "bg-bench-900 text-white" : "bg-bench-50 text-bench-600 ring-1 ring-inset ring-bench-200"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </DockCard>

      <DockCard title="视图模式" icon={<ListFilter size={16} />}>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => onConversationViewChange(false)}
            className={`rounded px-2.5 py-1 text-[11px] font-semibold transition active:scale-95 ${
              !conversationView ? "bg-bench-900 text-white" : "bg-bench-50 text-bench-700 ring-1 ring-inset ring-bench-200"
            }`}
          >
            流程事件
          </button>
          <button
            onClick={() => onConversationViewChange(true)}
            className={`rounded px-2.5 py-1 text-[11px] font-semibold transition active:scale-95 ${
              conversationView ? "bg-bench-900 text-white" : "bg-bench-50 text-bench-700 ring-1 ring-inset ring-bench-200"
            }`}
          >
            对话内容
          </button>
        </div>
      </DockCard>

      {conversationView ? (
        <TrailConversation entries={conversationEntries} />
      ) : (
        <>
          <DockCard title="流程筛选" icon={<ListFilter size={16} />}>
            <div className="flex flex-wrap gap-2">
              {eventKinds.map((kind) => (
                <button
                  key={kind}
                  onClick={() => onEventKindFilterChange(kind)}
                  className={`rounded px-2.5 py-1 text-[11px] font-semibold transition active:scale-95 ${
                    eventKindFilter === kind ? "bg-bench-900 text-white" : "bg-bench-50 text-bench-700 ring-1 ring-inset ring-bench-200"
                  }`}
                >
                  {eventKindLabel(kind as SemanticTimelineItem["kind"] | "all")}
                </button>
              ))}
              <button
                type="button"
                onClick={onToggleInternalEvents}
                className={`rounded px-2.5 py-1 text-[11px] font-semibold transition active:scale-95 ${
                  showInternalEvents ? "bg-bench-900 text-white" : "bg-bench-50 text-bench-700 ring-1 ring-inset ring-bench-200"
                }`}
              >
                {showInternalEvents ? "隐藏内部事件" : "显示内部事件"}
              </button>
            </div>
          </DockCard>

          <div className="space-y-2">
            {items.length === 0 ? (
              <p className="rounded-lg bg-white p-3 text-xs leading-5 text-bench-700 shadow-sm ring-1 ring-inset ring-bench-200">没有符合当前筛选条件的流程事件。</p>
            ) : items.map((item) => (
              <button
                key={item.id}
                onClick={() => onToggleItem(item.id)}
                className={`block w-full rounded-lg p-3 text-left ring-1 ring-inset transition active:scale-[0.99] ${
                  selectedBeat?.id === item.id
                    ? "bg-bench-100 ring-bench-900"
                    : timelineClassName(item.severity)
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-bench-900">{item.label}</p>
                      <span className="rounded-full bg-white/70 px-2 py-0.5 text-[10px] font-semibold tracking-[0.06em] text-bench-700">
                        {eventKindLabel(item.kind)}
                      </span>
                      {item.severity !== "neutral" ? <SeverityPill severity={item.severity} /> : null}
                    </div>
                    <p className="mt-1 text-xs leading-5 text-bench-700">{item.detail}</p>
                    {item.agentLabel || item.nodeLabel ? (
                      <p className="mt-1 text-[11px] text-bench-700">{[item.agentLabel, item.nodeLabel].filter(Boolean).join(" · ")}</p>
                    ) : null}
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-mono text-[11px] text-bench-700">#{item.seq}</p>
                    <p className="mt-1 text-[11px] text-bench-600">{item.timestamp}</p>
                  </div>
                </div>
                {expandedTimelineId === item.id ? (
                  <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                    <EvidenceSnippet label="输入" value={item.inputPreview ?? "暂无输入摘要"} />
                    <EvidenceSnippet label="输出" value={item.outputPreview ?? "暂无输出摘要"} />
                    <div className="sm:col-span-2 rounded-md bg-white/70 p-2 ring-1 ring-inset ring-bench-200">
                      <JsonTree data={item.rawPayload} defaultExpanded={1} />
                    </div>
                  </div>
                ) : null}
              </button>
            ))}
          </div>
        </>
      )}
    </>
  );
}

function TrailConversation({ entries }: { entries: ConversationViewEntry[] }) {
  if (entries.length === 0) {
    return (
      <div className="rounded-lg bg-white p-3 text-xs leading-5 text-bench-700 shadow-sm ring-1 ring-inset ring-bench-200">
        本轮运行没有记录模型对话内容。对话数据来自运行时状态快照中的 conversation 字段。
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {entries.map((entry) => (
        <div
          key={entry.id}
          className={`rounded-lg p-3 shadow-sm ring-1 ring-inset ${
            entry.role === "assistant"
              ? "bg-sky-50/60 ring-sky-200"
              : entry.role === "user"
                ? "bg-white ring-bench-200"
                : entry.role === "system"
                  ? "bg-amber-50/60 ring-amber-200"
                  : "bg-emerald-50/60 ring-emerald-200"
          }`}
        >
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-[0.06em] ${
              entry.role === "assistant"
                ? "bg-sky-200 text-sky-900"
                : entry.role === "user"
                  ? "bg-bench-200 text-bench-800"
                  : entry.role === "system"
                    ? "bg-amber-200 text-amber-900"
                    : "bg-emerald-200 text-emerald-900"
            }`}>
              {conversationRoleLabel(entry.role)}
            </span>
            <span className="text-[10px] text-bench-500">{entry.timestamp}</span>
          </div>
          <p className="text-xs leading-5 text-bench-800 whitespace-pre-wrap break-words">{entry.content}</p>
          {entry.toolId && (
            <p className="mt-1 text-[10px] text-bench-500">
              工具: {entry.toolId}{entry.toolCallId ? ` · ${entry.toolCallId}` : ""}{entry.toolStatus ? ` · ${entry.toolStatus}` : ""}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

function conversationRoleLabel(role: ConversationViewEntry["role"]) {
  switch (role) {
    case "assistant":
      return "模型回答";
    case "user":
      return "用户消息";
    case "system":
      return "系统提示";
    case "tool":
      return "工具结果";
  }
}

function TrailCompare({
  activeSnapshot,
  sessionId,
  runtimeClient,
}: {
  activeSnapshot: OraStateSnapshot;
  sessionId?: string;
  runtimeClient: ReturnType<typeof getSharedRuntimeClient>;
}) {
  const [sessionRuns, setSessionRuns] = useState<OraSessionRunSummary[]>([]);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [compareRunId, setCompareRunId] = useState<string | undefined>(undefined);
  const [compareTrail, setCompareTrail] = useState<OraRunTrail | undefined>(undefined);
  const [loadingTrail, setLoadingTrail] = useState(false);

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    setLoadingRuns(true);
    runtimeClient.listSessionRuns(sessionId)
      .then((runs) => { if (!cancelled) setSessionRuns(runs); })
      .catch(() => { if (!cancelled) setSessionRuns([]); })
      .finally(() => { if (!cancelled) setLoadingRuns(false); });
    return () => { cancelled = true; };
  }, [sessionId, runtimeClient]);

  useEffect(() => {
    if (!compareRunId) { setCompareTrail(undefined); return; }
    let cancelled = false;
    setLoadingTrail(true);
    runtimeClient.getRunTrail(compareRunId)
      .then((trail) => { if (!cancelled) setCompareTrail(trail); })
      .catch(() => { if (!cancelled) setCompareTrail(undefined); })
      .finally(() => { if (!cancelled) setLoadingTrail(false); });
    return () => { cancelled = true; };
  }, [compareRunId, runtimeClient]);

  const currentRuntimeMs = Math.max(0, activeSnapshot.updatedAt - (activeSnapshot.input.createdAt ?? activeSnapshot.updatedAt));
  const currentEventCount = activeSnapshot.events.length;
  const currentMessageCount = activeSnapshot.events.filter((e) => e.type === "message.delta").length;
  const currentToolCount = activeSnapshot.toolCalls.length;
  const currentAgentCount = activeSnapshot.activeAgents.length;
  const currentCheckpointCount = activeSnapshot.checkpoints.length;
  const otherRuns = sessionRuns.filter((r) => r.runId !== activeSnapshot.runId);

  return (
    <>
      <DockCard title="选择对比运行" icon={<BarChart3 size={16} />}>
        {loadingRuns ? (
          <p className="text-xs leading-5 text-bench-700">正在加载 session 运行列表...</p>
        ) : otherRuns.length === 0 ? (
          <p className="text-xs leading-5 text-bench-700">此 session 中暂无其他可对比的运行。</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {otherRuns.map((run) => (
              <button
                key={run.runId}
                onClick={() => setCompareRunId(run.runId === compareRunId ? undefined : run.runId)}
                className={`rounded px-2.5 py-1.5 text-[11px] font-semibold transition active:scale-95 ${
                  run.runId === compareRunId ? "bg-bench-900 text-white" : "bg-bench-50 text-bench-700 ring-1 ring-inset ring-bench-200"
                }`}
              >
                {run.modeId ?? run.pattern} · #{run.turnIndex ?? "?"}
              </button>
            ))}
          </div>
        )}
      </DockCard>

      {loadingTrail && (
        <DockCard title="运行对比" icon={<BarChart3 size={16} />}>
          <p className="text-xs leading-5 text-bench-700">正在加载对比运行数据...</p>
        </DockCard>
      )}

      {compareTrail && (
        <DockCard title="运行对比" icon={<BarChart3 size={16} />}>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-bench-200">
                  <th className="py-2 pr-3 text-left font-semibold text-bench-700">指标</th>
                  <th className="py-2 pr-3 text-left font-semibold text-bench-700">当前运行</th>
                  <th className="py-2 text-left font-semibold text-bench-700">对比运行</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-bench-100">
                <CompareRow label="运行时长" current={formatDurationMs(currentRuntimeMs)} other={formatDurationMs(compareTrail.liveMetrics.runtimeMs)} />
                <CompareRow label="事件数" current={String(currentEventCount)} other={String(compareTrail.liveMetrics.eventCount)} />
                <CompareRow label="消息数" current={String(currentMessageCount)} other={String(compareTrail.liveMetrics.messageCount)} />
                <CompareRow label="工具调用" current={String(currentToolCount)} other={String(compareTrail.observations.filter((o) => o.type === "tool").length)} />
                <CompareRow label="活跃智能体" current={String(currentAgentCount)} other={String(compareTrail.liveMetrics.activeAgentCount)} />
                <CompareRow label="检查点数" current={String(currentCheckpointCount)} other={String(compareTrail.liveMetrics.checkpointCount)} />
                <CompareRow label="拓扑变更" current={String(activeSnapshot.events.filter((e) => e.type === "topology.updated").length)} other={String(compareTrail.liveMetrics.topologyChangeCount)} />
                <CompareRow label="成本" current="—" other={compareTrail.liveMetrics.costAvailable ? formatUsd(compareTrail.liveMetrics.estimatedCostUsd) : "不可用"} />
                <CompareRow label="告警" current="—" other={String(compareTrail.liveMetrics.warningCount)} />
                <CompareRow label="错误" current="—" other={String(compareTrail.liveMetrics.errorCount)} />
              </tbody>
            </table>
          </div>
        </DockCard>
      )}
      {sessionRuns.length > 0 && (
        <DockCard title="Session 运行历史" icon={<BarChart3 size={16} />}>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-b border-bench-200 text-left text-bench-600">
                  <th className="py-1.5 pr-2 font-semibold">#</th>
                  <th className="py-1.5 pr-2 font-semibold">状态</th>
                  <th className="py-1.5 pr-2 font-semibold">模式</th>
                  <th className="py-1.5 pr-2 font-semibold">事件</th>
                  <th className="py-1.5 pr-2 font-semibold">工具</th>
                  <th className="py-1.5 font-semibold">时间</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-bench-100">
                {[...sessionRuns]
                  .sort((a, b) => b.updatedAt - a.updatedAt)
                  .map((run) => (
                  <tr key={run.runId} className={`text-bench-700 ${run.runId === activeSnapshot.runId ? "bg-bench-100 font-semibold text-bench-900" : ""}`}>
                    <td className="py-1.5 pr-2">{run.turnIndex ?? "?"}</td>
                    <td className="py-1.5 pr-2">{run.status}</td>
                    <td className="py-1.5 pr-2 max-w-[120px] truncate">{run.modeId ?? run.pattern}</td>
                    <td className="py-1.5 pr-2">{run.eventCount}</td>
                    <td className="py-1.5 pr-2">—</td>
                    <td className="py-1.5 text-bench-500">{new Date(run.updatedAt).toLocaleString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {sessionRuns.length >= 3 && (
            <div className="mt-3 rounded-md bg-bench-50 px-3 py-2 ring-1 ring-inset ring-bench-200">
              <p className="text-xs font-semibold text-bench-800">趋势摘要</p>
              <div className="mt-1.5 grid grid-cols-3 gap-2 text-[11px]">
                <div>
                  <span className="text-bench-500">运行次数</span>
                  <p className="font-semibold text-bench-900">{sessionRuns.length}</p>
                </div>
                <div>
                  <span className="text-bench-500">成功</span>
                  <p className="font-semibold text-emerald-700">{sessionRuns.filter((r) => r.status === "succeeded").length}</p>
                </div>
                <div>
                  <span className="text-bench-500">失败</span>
                  <p className="font-semibold text-rose-700">{sessionRuns.filter((r) => r.status === "failed").length}</p>
                </div>
              </div>
            </div>
          )}
        </DockCard>
      )}
    </>
  );
}

function formatDurationMs(ms: number) {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

function CompareRow({ label, current, other }: { label: string; current: string; other: string }) {
  return (
    <tr>
      <td className="py-2 pr-3 text-bench-700">{label}</td>
      <td className="py-2 pr-3 font-semibold text-bench-900">{current}</td>
      <td className="py-2 font-semibold text-bench-900">{other}</td>
    </tr>
  );
}

function TrailAgents({
  communicationEdges,
  lanes,
  selectedAgentId,
  topologyEdges,
  topologyNodes,
}: {
  communicationEdges: CommunicationEdge[];
  lanes: ReturnType<typeof buildAgentLanes>;
  selectedAgentId?: string;
  topologyEdges: OraStateSnapshot["topology"]["edges"];
  topologyNodes: OraStateSnapshot["topology"]["nodes"];
}) {
  const agentLabels = new Map(topologyNodes.map((n) => [n.id, n.label]));

  return (
    <div className="space-y-3">
      {(topologyNodes.length > 0 || topologyEdges.length > 0) && (
        <DockCard title="执行拓扑" icon={<Network size={16} />}>
          <div className="space-y-2">
            {topologyNodes.map((node) => (
              <div key={node.id} className={`rounded-md px-3 py-2 ring-1 ring-inset ${node.id === selectedAgentId ? "bg-bench-100 ring-bench-900" : "bg-bench-50 ring-bench-200"}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-semibold text-bench-900">{node.label}</span>
                  <span className="shrink-0 text-[11px] capitalize text-bench-700">{node.status}</span>
                </div>
                <p className="truncate text-[11px] text-bench-700">{node.kind}{node.agentId ? ` · ${node.agentId}` : ""}</p>
              </div>
            ))}
            {topologyEdges.map((edge, i) => (
              <div key={i} className="flex items-center gap-2 rounded-md bg-bench-50/50 px-3 py-1.5 text-[11px] text-bench-600">
                <span className="font-medium text-bench-700">{agentLabels.get(edge.source) ?? edge.source}</span>
                <span>→</span>
                <span className="font-medium text-bench-700">{agentLabels.get(edge.target) ?? edge.target}</span>
                {edge.kind && <span className="text-bench-400">({edge.kind})</span>}
              </div>
            ))}
          </div>
        </DockCard>
      )}

      {communicationEdges.length > 0 && (
        <DockCard title="通信关系" icon={<GitBranch size={16} />}>
          <div className="space-y-1.5">
            {communicationEdges.map((edge, i) => (
              <div key={i} className="flex items-center gap-2 rounded-md bg-bench-50 px-3 py-2 ring-1 ring-inset ring-bench-200 text-[11px]">
                <span className="font-medium text-bench-800">{edge.fromLabel}</span>
                <span className="text-bench-400">→</span>
                <span className="font-medium text-bench-800">{edge.toLabel}</span>
                <span className="rounded-full bg-bench-100 px-1.5 py-0.5 text-[10px] text-bench-600">{edge.kind}</span>
                {edge.count > 1 && <span className="text-bench-400">×{edge.count}</span>}
              </div>
            ))}
          </div>
        </DockCard>
      )}

      {lanes.length === 0 ? (
        <DockCard title="智能体泳道" icon={<Bot size={16} />}>
          <p className="text-xs leading-5 text-bench-700">本轮运行没有记录智能体级活动。</p>
        </DockCard>
      ) : lanes.map((lane) => (
        <div
          key={lane.id}
          className={`rounded-lg bg-white p-3 shadow-sm ring-1 ring-inset ${lane.id === selectedAgentId ? "ring-bench-900" : "ring-bench-200"}`}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-semibold text-bench-900">{lane.label}</p>
                <span className="rounded-full bg-bench-100 px-2 py-0.5 text-[11px] font-semibold text-bench-800">{agentStatusLabel(lane.status)}</span>
              </div>
              <p className="mt-1 text-xs leading-5 text-bench-700">{lane.role}</p>
            </div>
            <div className="shrink-0 text-right text-[11px] leading-5 text-bench-700">
              <p>{lane.messageCount} 条消息 · {lane.toolCount} 次工具</p>
              <p>{formatUsd(lane.costUsd)}</p>
            </div>
          </div>
          <p className="mt-2 rounded-md bg-bench-50 px-3 py-2 text-xs leading-5 text-bench-700 ring-1 ring-inset ring-bench-200">{lane.latestActivity}</p>
          {lane.findings.length > 0 ? (
            <div className="mt-2 space-y-1">
              {lane.findings.map((finding) => (
                <p key={finding.id} className="text-xs leading-5 text-amber-800">{finding.message}</p>
              ))}
            </div>
          ) : null}
          {lane.messages.length > 0 ? (
            <div className="mt-3 space-y-2">
              {lane.messages.map((message) => (
                <div key={message.id} className="rounded-md bg-bench-50 px-3 py-2 ring-1 ring-inset ring-bench-200">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-semibold tracking-[0.06em] text-bench-700">{agentMessageKindLabel(message.kind)} · {toolStatusLabel(message.status)}</span>
                    <span className="text-[11px] text-bench-600">{message.timestamp}</span>
                  </div>
                  <p className="mt-1 text-xs leading-5 text-bench-800">{message.content}</p>
                  {message.toLabels.length > 0 ? <p className="mt-1 text-[11px] text-bench-700">发送给 {message.toLabels.join(", ")}</p> : null}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function TrailLatency({ diagnostics }: { diagnostics: TrailLatencyDiagnostics }) {
  return (
    <>
      <DockCard title="延迟诊断" icon={<Clock3 size={16} />}>
        <div className="rounded-md bg-bench-50 px-3 py-3 ring-1 ring-inset ring-bench-200">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-bench-900">首 token 链路</span>
                <StatusChip tone={diagnostics.summary.statusTone}>{diagnostics.summary.statusLabel}</StatusChip>
              </div>
              <p className="mt-1 text-xs leading-5 text-bench-700">{diagnostics.summary.recommendation}</p>
            </div>
            <div className="shrink-0 text-right text-[11px] leading-5 text-bench-700">
              <p>首文本 {diagnostics.summary.firstText}</p>
              <p>可读回答 {diagnostics.summary.firstReadableText}</p>
              <p>provider {diagnostics.summary.providerMode}</p>
            </div>
          </div>
        </div>
      </DockCard>

      <DockCard title="关键分段" icon={<Route size={16} />}>
        <div className="space-y-2">
          {diagnostics.segments.map((segment) => (
            <div key={segment.id} className="rounded-md bg-white px-3 py-2 ring-1 ring-inset ring-bench-200">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-bench-900">{segment.label}</span>
                    <LatencyStatusPill status={segment.status} />
                  </div>
                  <p className="mt-1 text-xs leading-5 text-bench-700">{segment.note}</p>
                  <p className="mt-1 truncate text-[11px] text-bench-600">{segment.from} → {segment.to}</p>
                </div>
                <span className="shrink-0 font-mono text-xs text-bench-800">{segment.duration}</span>
              </div>
            </div>
          ))}
        </div>
      </DockCard>

      <DockCard title="原始 marks" icon={<Database size={16} />}>
        {diagnostics.marks.length === 0 ? (
          <p className="text-xs leading-5 text-bench-700">暂无 latency.marks。请运行带延迟诊断的 runtime 后再查看。</p>
        ) : (
          <div className="space-y-2">
            {diagnostics.marks.map((mark) => (
              <div key={mark.id} className="rounded-md bg-bench-50 px-3 py-2 ring-1 ring-inset ring-bench-200">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-mono text-xs font-semibold text-bench-900">{mark.source}:{mark.name}</span>
                  <span className="font-mono text-[11px] text-bench-700">+{mark.offset}</span>
                </div>
                {Object.keys(mark.detail).length > 0 ? (
                  <div className="mt-2 rounded bg-white/70 p-2 text-[11px] ring-1 ring-inset ring-bench-200">
                    <JsonTree data={mark.detail} defaultExpanded={0} />
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </DockCard>
    </>
  );
}

function TrailTools({ commandFeedback, items }: { commandFeedback: string; items: ReturnType<typeof buildToolLedger> }) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  function toggleExpand(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  return (
    <DockCard title="工具记录" icon={<Wrench size={16} />}>
      {items.length === 0 ? (
        <p className="text-xs leading-5 text-bench-700">本次 run 未调用结构化工具。{commandFeedback ? ` ${commandFeedback}` : ""}</p>
      ) : (
        <div className="space-y-2">
          {items.map((item) => {
            const isExpanded = expandedIds.has(item.id);
            const resultFull = item.resultPreview && item.resultPreview.length > 180;
            const argsFull = item.argsPreview && item.argsPreview.length > 180;
            const renderer = toolRendererRegistry.get(item.toolId);
            const hasStructuredPreview = item.previewKind && item.previewPreview;
            return (
            <div key={item.id} className="rounded-md bg-bench-50 px-3 py-3 ring-1 ring-inset ring-bench-200">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-semibold text-bench-900">{item.toolId}</p>
                    {renderer && (
                      <span className="shrink-0 rounded-full bg-bench-100 px-1.5 py-0.5 text-[10px] font-semibold text-bench-600">
                        {renderer.label}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-[11px] text-bench-700">
                    {[toolSourceLabel(item.source), item.agentLabel, item.nodeLabel, item.latency].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <StatusChip tone={item.statusTone}>{toolStatusLabel(item.status)}</StatusChip>
              </div>
              {item.repairReason || item.error ? (
                <p className="mt-2 text-xs leading-5 text-amber-800">{(item.repairReason ?? item.error)?.replace(/_/g, " ")}</p>
              ) : null}
              {hasStructuredPreview && renderer ? (
                <div className="mt-2">
                  <StructuredToolPreview item={item} expanded={isExpanded} onToggle={() => toggleExpand(item.id)} />
                </div>
              ) : (
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <EvidenceSnippet label="参数" value={isExpanded && item.rawArgs !== undefined ? formatRawValue(item.rawArgs) : item.argsPreview} />
                  <EvidenceSnippet label="结果" value={isExpanded && item.rawResult !== undefined ? formatRawValue(item.rawResult) : (item.resultPreview || "暂无结果记录")} />
                </div>
              )}
              {(resultFull || argsFull) && !hasStructuredPreview && (
                <button
                  onClick={() => toggleExpand(item.id)}
                  className="mt-2 text-[11px] font-semibold text-bench-600 hover:text-bench-900 transition"
                >
                  {isExpanded ? "收起完整内容" : "展开完整内容"}
                </button>
              )}
            </div>
          )})}
        </div>
      )}
    </DockCard>
  );
}

function StructuredToolPreview({ item, expanded, onToggle }: { item: ToolLedgerItem; expanded: boolean; onToggle: () => void }) {
  const kind = item.previewKind;
  const preview = item.previewPreview as Record<string, unknown> | undefined;

  if (kind === "file.patch" || kind === "file.write") {
    const diff = typeof preview?.diff === "string" ? preview.diff : undefined;
    const detail = item.previewDetail ?? {};
    return (
      <div>
        <p className="text-xs leading-5 text-bench-700">
          {(item.previewDetail as { summary?: string })?.summary ?? item.resultPreview}
        </p>
        {diff && (
          <div className="mt-2 rounded-md bg-white/70 p-2 ring-1 ring-inset ring-bench-200">
            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-bench-600 mb-1">Diff</p>
            <pre className={`text-[11px] leading-5 text-bench-800 overflow-x-auto whitespace-pre-wrap font-mono ${expanded ? "" : "max-h-32 overflow-hidden"}`}>
              {diff}
            </pre>
          </div>
        )}
        {(diff && diff.length > 500) && (
          <button onClick={onToggle} className="mt-1 text-[11px] font-semibold text-bench-600 hover:text-bench-900 transition">
            {expanded ? "收起完整 diff" : "展开完整 diff"}
          </button>
        )}
        {detail && Object.keys(detail).length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {typeof detail.path === "string" && <span className="rounded bg-bench-100 px-1.5 py-0.5 text-[10px] text-bench-700 font-mono">{detail.path}</span>}
            {typeof detail.additions === "number" && <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] text-emerald-800">+{detail.additions}</span>}
            {typeof detail.deletions === "number" && <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[10px] text-rose-800">-{detail.deletions}</span>}
            {typeof detail.sizeBytes === "number" && <span className="rounded bg-bench-100 px-1.5 py-0.5 text-[10px] text-bench-600">{detail.sizeBytes} bytes</span>}
          </div>
        )}
      </div>
    );
  }

  if (kind === "shell.execute") {
    const stdout = typeof preview?.stdout === "string" ? preview.stdout : "";
    const stderr = typeof preview?.stderr === "string" ? preview.stderr : "";
    const detail = item.previewDetail ?? {};
    return (
      <div>
        <p className="text-xs leading-5 text-bench-700">
          退出码 {(detail.exitCode as number) ?? "?"} · 耗时 {(detail.durationMs as number) ?? "?"}ms
        </p>
        {stdout && (
          <div className="mt-2 rounded-md bg-white/70 p-2 ring-1 ring-inset ring-bench-200">
            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-bench-600 mb-1">stdout</p>
            <pre className={`text-[11px] leading-5 text-bench-800 overflow-x-auto whitespace-pre-wrap font-mono ${expanded ? "" : "max-h-32 overflow-hidden"}`}>
              {stdout}
            </pre>
          </div>
        )}
        {stderr && (
          <div className="mt-1 rounded-md bg-rose-50/70 p-2 ring-1 ring-inset ring-bench-200">
            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-rose-600 mb-1">stderr</p>
            <pre className={`text-[11px] leading-5 text-rose-800 overflow-x-auto whitespace-pre-wrap font-mono ${expanded ? "" : "max-h-32 overflow-hidden"}`}>
              {stderr}
            </pre>
          </div>
        )}
        {((stdout && stdout.length > 500) || (stderr && stderr.length > 200)) && (
          <button onClick={onToggle} className="mt-1 text-[11px] font-semibold text-bench-600 hover:text-bench-900 transition">
            {expanded ? "收起完整输出" : "展开完整输出"}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <EvidenceSnippet label="参数" value={item.argsPreview} />
      <EvidenceSnippet label="结果" value={item.resultPreview} />
    </div>
  );
}

function TrailEvidence({
  activeSnapshot,
  artifacts,
  checkpoints,
  handleOpenTrace,
  openingTrace,
  planItems,
  trace,
  traceOpenDisabled,
  traceOpenUnavailable,
  trail,
  trailError,
  trailLoading,
}: {
  activeSnapshot: OraStateSnapshot;
  artifacts: ArtifactRecord[];
  checkpoints: CheckpointRecord[];
  handleOpenTrace: () => void;
  openingTrace: boolean;
  planItems: PlanItem[];
  trace: OraRunTrail["trace"] | OraStateSnapshot["trace"] | undefined;
  traceOpenDisabled: boolean;
  traceOpenUnavailable: boolean;
  trail: OraRunTrail | undefined;
  trailError: string | undefined;
  trailLoading: boolean;
}) {
  return (
    <>
      <DockCard title="追踪状态" icon={<GitBranch size={16} />}>
        <div className="space-y-2">
          <EvidenceRow label="提供方" value={trace?.provider === "langfuse" ? "Langfuse" : "Ora Trails"} />
          <EvidenceRow label="来源" value={trace?.source ?? "追踪不可用"} />
          <EvidenceRow label="Trace ID" value={trace?.traceId ?? "未记录"} />
          <EvidenceRow label="可用性" value={trace?.available ? "可用" : trace?.enabled ? "等待中 / 已降级" : "未启用"} />
        </div>
        {trace?.reason && <p className="mt-3 text-xs leading-5 text-bench-700">{trace.reason}</p>}
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={handleOpenTrace}
            disabled={traceOpenDisabled}
            title={traceOpenUnavailable ? "这个本地 Trail 没有关联 Langfuse 追踪。" : undefined}
          >
            <ExternalLink size={14} />
            {traceOpenUnavailable ? "仅本地 Trail" : openingTrace ? "正在打开" : "在 Langfuse 中打开"}
          </Button>
        </div>
      </DockCard>

      <DockCard title="生成引用" icon={<Clock3 size={16} />}>
        {trace?.generationRefs.length ? (
          <div className="space-y-2">
            {trace.generationRefs.map((generation) => (
              <div key={generation.observationId} className="rounded-md bg-bench-50 px-3 py-2 ring-1 ring-inset ring-bench-200">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium text-bench-900">{generation.name}</span>
                  <span className="shrink-0 text-[11px] text-bench-700">{generation.model ?? "未知模型"}</span>
                </div>
                <p className="mt-1 text-[11px] text-bench-700">
                  {(generation.providerId ?? "提供方不可用")} · 延迟 {generation.latencySeconds === undefined ? "不可用" : `${generation.latencySeconds.toFixed(2)}s`} · 成本 {formatUsd(generation.totalCostUsd ?? 0)}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs leading-5 text-bench-700">本轮运行没有记录生成引用。</p>
        )}
      </DockCard>

      <DockCard title="观测记录" icon={<CheckCircle2 size={16} />}>
        {trailLoading ? (
          <p className="text-xs leading-5 text-bench-700">正在加载追踪观测...</p>
        ) : trailError ? (
          <p className="text-xs leading-5 text-amber-700">{trailError}</p>
        ) : trail?.observations.length ? (
          <div className="space-y-2">
            {trail.observations.map((observation) => (
              <details key={observation.id} className="rounded-md bg-white px-3 py-2 ring-1 ring-inset ring-bench-200">
                <summary className="cursor-pointer list-none">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium text-bench-900">{observation.name}</span>
                    <span className="shrink-0 text-[11px] uppercase tracking-[0.08em] text-bench-700">{observation.type}</span>
                  </div>
                  <p className="mt-1 truncate text-[11px] text-bench-700">
                    {observation.model ? `${observation.model} · ` : ""}{observation.statusMessage ?? "暂无状态信息"}
                  </p>
                </summary>
                {(observation.input !== undefined || observation.output !== undefined) && (
                  <div className="mt-2 max-h-48 overflow-y-auto rounded-md bg-bench-50 p-2">
                    <JsonTree data={{ input: observation.input, output: observation.output, metadata: observation.metadata }} defaultExpanded={1} />
                  </div>
                )}
              </details>
            ))}
          </div>
        ) : (
          <p className="text-xs leading-5 text-bench-700">本轮运行暂时没有可用的追踪数据。本地 Trails 视图仍由 Ora 运行时状态支撑。</p>
        )}
      </DockCard>

      {(artifacts.length > 0 || checkpoints.length > 0 || planItems.length > 0) && (
        <DockCard title="运行附件" icon={<Boxes size={16} />}>
          <div className="space-y-2">
            {artifacts.map((artifact) => (
              <EvidenceRow key={artifact.id} label={artifact.label} value={`${artifact.kind} · ${artifact.mimeType}`} />
            ))}
            {checkpoints.map((checkpoint) => (
              <EvidenceRow key={checkpoint.id} label={checkpoint.label} value={`checkpoint · #${checkpoint.eventSeq}`} />
            ))}
            {planItems.map((item) => (
              <EvidenceRow key={item.id} label={item.title} value={`${item.owner} · ${item.status}`} />
            ))}
          </div>
        </DockCard>
      )}

      <DockCard title="快照" icon={<Route size={16} />}>
        <details>
          <summary className="cursor-pointer text-sm font-semibold text-bench-900">原始运行快照</summary>
          <div className="mt-2 max-h-72 overflow-y-auto rounded-md bg-bench-50 p-2">
            <JsonTree data={activeSnapshot} defaultExpanded={1} />
          </div>
        </details>
      </DockCard>
    </>
  );
}

function OverviewMetric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-lg bg-white p-3 shadow-sm ring-1 ring-inset ring-bench-200">
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-bench-700">{label}</p>
      <p className="mt-1 truncate text-sm font-semibold capitalize leading-5 text-bench-900">{value}</p>
      <p className="mt-1 truncate text-[11px] leading-4 text-bench-700">{detail}</p>
    </div>
  );
}

function EvidenceRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md bg-bench-50 px-3 py-2 ring-1 ring-inset ring-bench-200">
      <span className="min-w-0 truncate text-[11px] font-semibold uppercase tracking-[0.06em] text-bench-700">{label}</span>
      <span className="min-w-0 truncate text-right text-sm font-semibold text-bench-900">{value}</span>
    </div>
  );
}

function EvidenceSnippet({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-md bg-white/70 p-2 ring-1 ring-inset ring-bench-200">
      <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-bench-600">{label}</p>
      <p className="mt-1 break-words text-xs leading-5 text-bench-800">{value}</p>
    </div>
  );
}

function SeverityPill({ severity }: { severity: TrailFindingSeverity }) {
  const className = severity === "error"
    ? "bg-rose-100 text-rose-900"
    : severity === "warning"
      ? "bg-amber-100 text-amber-900"
      : "bg-sky-100 text-sky-900";
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-[0.06em] ${className}`}>
      {severityLabel(severity)}
    </span>
  );
}

function formatRawValue(value: unknown): string {
  if (value === undefined || value === null) return "无数据";
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function agentMessageKindLabel(kind: string) {
  switch (kind) {
    case "handoff":
      return "交接";
    case "reply":
      return "回复";
    case "route":
      return "路由";
    case "mention":
      return "提及";
    case "publish":
      return "发布";
    case "status":
      return "状态";
    default:
      return kind;
  }
}

function LatencyStatusPill({ status }: { status: TrailLatencyDiagnostics["segments"][number]["status"] }) {
  const label = status === "ok"
    ? "正常"
    : status === "warning"
      ? "偏慢"
      : status === "slow"
        ? "慢段"
        : "缺失";
  const className = status === "ok"
    ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
    : status === "warning"
      ? "bg-amber-50 text-amber-800 ring-amber-200"
      : status === "slow"
        ? "bg-red-50 text-red-700 ring-red-200"
        : "bg-bench-100 text-bench-700 ring-bench-200";
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${className}`}>{label}</span>;
}

function StatusChip({ tone, children }: { tone: "success" | "warning" | "error" | "neutral"; children: React.ReactNode }) {
  const className = tone === "success"
    ? "bg-emerald-100 text-emerald-900"
    : tone === "warning"
      ? "bg-amber-100 text-amber-900"
      : tone === "error"
        ? "bg-rose-100 text-rose-900"
        : "bg-bench-100 text-bench-800";
  return (
    <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${className}`}>
      {children}
    </span>
  );
}

function timelineClassName(severity: SemanticTimelineItem["severity"]) {
  if (severity === "error") return "bg-rose-50 ring-rose-200";
  if (severity === "warning") return "bg-amber-50 ring-amber-200";
  if (severity === "info") return "bg-sky-50 ring-sky-200";
  return "bg-white ring-bench-200 hover:bg-bench-50";
}

export function collectAnomalies(
  snapshot: OraStateSnapshot,
  trailError: string | undefined,
  trace: OraRunTrail["trace"] | OraStateSnapshot["trace"],
  actions: ActionRecord[],
) {
  return collectTrailFindings(snapshot, trailError, trace, actions).map((finding) => finding.message);
}

export { canOpenLangfuseTrace };
