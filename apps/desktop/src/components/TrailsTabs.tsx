import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  Bot,
  CheckCircle2,
  Clock3,
  ExternalLink,
  Gauge,
  GitBranch,
  Network,
  Radar,
  Workflow,
} from "lucide-react";
import { DockCard } from "./DockCard";
import { JsonTree } from "./JsonTree";
import { MetricRow } from "./MetricRow";
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
import { getSharedRuntimeClient, type OraRunTrail, type OraStateSnapshot } from "../lib/runtimeClient";

type TrailsTab = "Live" | "Timeline" | "Topology" | "Trace";

const trailsTabs: TrailsTab[] = ["Live", "Timeline", "Topology", "Trace"];

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
  selectedSession: SessionRun;
  onExportReport: () => void;
  onForkRun: () => void;
  onResumeRun: () => void;
  onCancelRun: () => void;
}

interface PendingApprovalItem {
  actionId: string;
  nodeId?: string;
  nodeLabel: string;
  actionLabel: string;
  riskLevel: "low" | "medium" | "high";
  reason: string;
  eventId?: string;
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
  selectedSession,
  onExportReport,
  onForkRun,
  onResumeRun,
  onCancelRun,
}: TrailsTabsProps) {
  const runtimeClient = getSharedRuntimeClient();
  const [selectedTab, setSelectedTab] = useState<TrailsTab>("Live");
  const [trail, setTrail] = useState<OraRunTrail | undefined>(undefined);
  const [trailLoading, setTrailLoading] = useState(false);
  const [trailError, setTrailError] = useState<string | undefined>(undefined);
  const [openingTrace, setOpeningTrace] = useState(false);

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
          setTrailError(error instanceof Error ? error.message : "Trace load failed.");
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

  const liveMetrics = useMemo(() => {
    if (trail) {
      return trail.liveMetrics;
    }
    const runtimeMs = Math.max(0, activeSnapshot.updatedAt - (activeSnapshot.input.createdAt ?? activeSnapshot.updatedAt));
    return {
      runtimeMs,
      eventCount: activeSnapshot.events.length,
      checkpointCount: activeSnapshot.checkpoints.length,
      topologyChangeCount: activeSnapshot.events.filter((event) => event.type === "topology.updated").length,
      messageCount: activeSnapshot.events.filter((event) => event.type === "message.delta").length,
      activeAgentCount: activeSnapshot.activeAgents.length,
      warningCount: 0,
      errorCount: activeSnapshot.status === "failed" ? 1 : 0,
      estimatedCostUsd: activeSnapshot.trace?.generationRefs.reduce((sum, generation) => sum + (generation.totalCostUsd ?? 0), 0) ?? 0,
    };
  }, [activeSnapshot, trail]);

  const activeAgentLabels = activeSnapshot.activeAgents
    .map((agentId) => agents.find((agent) => agent.id === agentId)?.label ?? agentId)
    .filter(Boolean);
  const trace = trail?.trace ?? activeSnapshot.trace;
  const pendingApprovalItems = useMemo(() => buildPendingApprovalItems(activeSnapshot), [activeSnapshot]);
  const pendingClarificationItems = snapshotPendingClarifications(activeSnapshot);
  const blockingNodeMap = useMemo(
    () => buildBlockingNodeMap(pendingApprovalItems, pendingClarificationItems),
    [pendingApprovalItems, pendingClarificationItems],
  );
  const blockingEventIds = useMemo(
    () => buildBlockingEventIds(activeSnapshot, pendingApprovalItems),
    [activeSnapshot, pendingApprovalItems],
  );
  const blockingGateLabel = pendingClarificationItems[0]
    ? `Clarification · ${pendingClarificationItems[0].nodeLabel}`
    : pendingApprovalItems[0]
      ? `Approval · ${pendingApprovalItems[0].nodeLabel}`
      : "None";
  const selectedNodeObservations = (trail?.observations ?? []).filter((observation) => {
    if (!selectedNode) {
      return false;
    }
    const metadata = isRecord(observation.metadata) ? observation.metadata : {};
    return metadata.nodeId === selectedNode.id || (selectedNode.agentId !== undefined && metadata.agentId === selectedNode.agentId);
  });
  const anomalies = collectAnomalies(activeSnapshot, trailError, trace, actions);
  const timelineItems = buildTimelineItems(activeSnapshot);
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

  return (
    <div className="w-full min-w-0">
      <div className="border-b border-bench-200 px-3 py-2">
        <div className="flex gap-1">
          {trailsTabs.map((tab) => (
            <button
              key={tab}
              onClick={() => setSelectedTab(tab)}
              className={`rounded px-2.5 py-1.5 text-[11px] font-semibold transition active:scale-95 ${
                selectedTab === tab ? "bg-bench-900 text-white" : "text-bench-700 hover:bg-white"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-3 p-4">
        {selectedTab === "Live" && (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <MetricRow label="Status" value={selectedSession.status.replace(/_/g, " ")} />
              <MetricRow label="Mode" value={(activeSnapshot.modeId ?? activeSnapshot.pattern).replace(/_/g, " ")} />
              <MetricRow label="Blocking gate" value={blockingGateLabel} />
              <MetricRow label="Selected node" value={selectedNode?.label ?? "Run overview"} />
              <MetricRow label="Active agents" value={activeAgentLabels.join(", ") || "Idle"} />
              <MetricRow label="Events / sec" value={formatRate(liveMetrics.eventCount, liveMetrics.runtimeMs)} />
              <MetricRow label="Est. cost" value={formatUsd(liveMetrics.estimatedCostUsd)} />
            </div>

            <DockCard title="Live Signals" icon={<Gauge size={16} />}>
              <div className="grid gap-2 sm:grid-cols-2">
                <SignalLine label="Events" value={String(liveMetrics.eventCount)} />
                <SignalLine label="Checkpoints" value={String(liveMetrics.checkpointCount)} />
                <SignalLine label="Topology changes" value={String(liveMetrics.topologyChangeCount)} />
                <SignalLine label="Messages" value={String(liveMetrics.messageCount)} />
                <SignalLine label="Warnings" value={String(liveMetrics.warningCount)} />
                <SignalLine label="Errors" value={String(liveMetrics.errorCount)} />
              </div>
            </DockCard>

            <DockCard title="Operator Actions" icon={<Activity size={16} />}>
              <p className="mb-3">{commandFeedback}</p>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" size="sm" onClick={onExportReport} disabled={busyCommand !== undefined}>
                  Export
                </Button>
                <Button variant="secondary" size="sm" onClick={onForkRun} disabled={busyCommand !== undefined || !selectedCheckpoint}>
                  Fork
                </Button>
                <Button variant="secondary" size="sm" onClick={onResumeRun} disabled={busyCommand !== undefined}>
                  Resume
                </Button>
                <Button variant="secondary" size="sm" onClick={onCancelRun} disabled={busyCommand !== undefined}>
                  Cancel
                </Button>
              </div>
            </DockCard>

            <DockCard title="Runtime Focus" icon={<Bot size={16} />}>
              <div className="space-y-2">
                <SignalLine label="Selected beat" value={selectedBeat?.label ?? "Latest runtime event"} />
                <SignalLine label="Selected checkpoint" value={selectedCheckpoint?.label ?? "No checkpoint selected"} />
                <SignalLine label="Focused agent" value={selectedAgent?.label ?? "Run-level overview"} />
                <SignalLine label="Generation refs" value={String(trace?.generationRefs.length ?? 0)} />
              </div>
            </DockCard>

            <DockCard title="Tool Calls" icon={<Workflow size={16} />}>
              {activeSnapshot.toolCalls.length === 0 ? (
                <p className="text-xs leading-5 text-bench-700">No structured tool calls were recorded for this run.</p>
              ) : (
                <div className="space-y-2">
                  {activeSnapshot.toolCalls.map((call) => (
                    <div key={call.id} className="rounded-md bg-white px-3 py-3 ring-1 ring-inset ring-bench-200">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-bench-900">{call.toolId}</p>
                          <p className="mt-1 text-[11px] text-bench-700">
                            {call.source.replace(/_/g, " ")}{call.providerCallId ? ` · ${call.providerCallId}` : ""}
                          </p>
                        </div>
                        <span className={toolCallStatusClassName(call.status)}>
                          {call.status.replace(/_/g, " ")}
                        </span>
                      </div>
                      {call.repairReason ? (
                        <p className="mt-2 text-xs leading-5 text-amber-800">{call.repairReason.replace(/_/g, " ")}</p>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </DockCard>

            <DockCard title="Blocking Gates" icon={<Workflow size={16} />}>
              {pendingApprovalItems.length === 0 && pendingClarificationItems.length === 0 ? (
                <p className="text-xs leading-5 text-bench-700">This run is not currently paused behind a manual gate.</p>
              ) : (
                <div className="space-y-2">
                  {pendingApprovalItems.map((item) => (
                    <div key={item.actionId} className="rounded-md bg-white px-3 py-3 ring-1 ring-inset ring-bench-200">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-bench-900">{item.nodeLabel}</p>
                          <p className="mt-1 text-[11px] text-bench-700">
                            {item.actionLabel}{item.nodeId ? ` · ${item.nodeId}` : ""}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <span className="rounded-full bg-bench-100 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-bench-700">
                            approval
                          </span>
                          <span className={riskPillClassName(item.riskLevel)}>
                            {item.riskLevel}
                          </span>
                        </div>
                      </div>
                      <p className="mt-2 text-xs leading-5 text-bench-700">{item.reason}</p>
                    </div>
                  ))}
                  {pendingClarificationItems.map((item) => (
                    <div key={item.id} className="rounded-md bg-white px-3 py-3 ring-1 ring-inset ring-bench-200">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-bench-900">{item.nodeLabel}</p>
                          <p className="mt-1 text-[11px] text-bench-700">{item.nodeId}</p>
                        </div>
                        <span className="rounded-full bg-sky-100 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-sky-900">
                          clarification
                        </span>
                      </div>
                      <p className="mt-2 text-xs leading-5 text-bench-700">{item.question}</p>
                    </div>
                  ))}
                </div>
              )}
            </DockCard>

            <DockCard title="Anomalies" icon={<Radar size={16} />}>
              <div className="space-y-2">
                {anomalies.map((anomaly) => (
                  <div key={anomaly} className="rounded-md bg-bench-50 px-3 py-2 text-bench-800 ring-1 ring-inset ring-bench-200">
                    {anomaly}
                  </div>
                ))}
              </div>
            </DockCard>
          </>
        )}

        {selectedTab === "Timeline" && (
          <div className="space-y-2">
            {timelineItems.map((item) => (
              <div
                key={item.id}
                className={`rounded-lg p-3 ring-1 ring-inset ${
                  selectedBeat?.id === item.id
                    ? "bg-bench-50 ring-bench-900"
                    : blockingEventIds.has(item.id)
                      ? item.eventType === "clarification.required"
                        ? "bg-sky-50 ring-sky-300"
                        : "bg-amber-50 ring-amber-300"
                      : "bg-white ring-bench-200"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-bench-900">{item.label}</p>
                      {blockingEventIds.has(item.id) ? (
                        <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] ${
                          item.eventType === "clarification.required"
                            ? "bg-sky-100 text-sky-900"
                            : "bg-amber-100 text-amber-900"
                        }`}>
                          current gate
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-xs leading-5 text-bench-700">{item.detail}</p>
                    {item.nodeLabel ? (
                      <p className="mt-1 text-[11px] font-medium text-bench-700">{item.nodeLabel}</p>
                    ) : null}
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-mono text-[11px] text-bench-700">#{item.seq}</p>
                    <p className="mt-1 text-[11px] text-bench-600">{formatTimestamp(item.createdAt)}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {selectedTab === "Topology" && (
          <>
            <DockCard title="Topology State" icon={<Network size={16} />}>
              <div className="space-y-2">
                {activeSnapshot.topology.nodes.map((node) => (
                  (() => {
                    const blockingNode = blockingNodeMap.get(node.id);
                    return (
                  <div
                    key={node.id}
                    className={`rounded-lg px-3 py-2 ring-1 ring-inset ${
                      node.id === selectedNode?.id
                        ? blockingNode
                          ? blockingNode.kind === "clarification"
                            ? "bg-sky-50 ring-sky-500"
                            : "bg-amber-50 ring-amber-500"
                          : "bg-bench-50 ring-bench-900"
                        : blockingNode
                          ? blockingNode.kind === "clarification"
                            ? "bg-sky-50 ring-sky-300"
                            : "bg-amber-50 ring-amber-300"
                          : "bg-white ring-bench-200"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-bench-900">{node.label}</p>
                        <p className="text-[11px] text-bench-700">{node.kind}{node.agentId ? ` · ${node.agentId}` : ""}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {blockingNode ? (
                          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ${
                            blockingNode.kind === "clarification"
                              ? "bg-sky-100 text-sky-900"
                              : "bg-amber-100 text-amber-900"
                          }`}>
                            {blockingNode.kind}
                          </span>
                        ) : null}
                        {blockingNode?.kind === "approval" ? (
                          <span className={riskPillClassName(blockingNode.riskLevel)}>
                            {blockingNode.riskLevel}
                          </span>
                        ) : null}
                        <span className="rounded-full bg-bench-100 px-2 py-0.5 text-[11px] font-semibold capitalize text-bench-800">
                          {node.status}
                        </span>
                      </div>
                    </div>
                    {blockingNode ? (
                      <p className="mt-2 text-xs leading-5 text-bench-700">{blockingNode.reason}</p>
                    ) : null}
                  </div>
                    );
                  })()
                ))}
              </div>
            </DockCard>

            <DockCard title="Node Linkage" icon={<Workflow size={16} />}>
              {selectedNode ? (
                <div className="space-y-3">
                  <SignalLine label="Selected node" value={selectedNode.label} />
                  {blockingNodeMap.get(selectedNode.id) ? (
                    <SignalLine
                      label="Blocking gate"
                      value={
                        blockingNodeMap.get(selectedNode.id)?.kind === "approval"
                          ? `Approval · ${blockingNodeMap.get(selectedNode.id)?.riskLevel}`
                          : "Clarification"
                      }
                    />
                  ) : null}
                  <SignalLine label="Linked trace rows" value={String(selectedNodeObservations.length)} />
                  <SignalLine label="Edges" value={String(activeSnapshot.topology.edges.filter((edge) => edge.source === selectedNode.id || edge.target === selectedNode.id).length)} />
                  {blockingNodeMap.get(selectedNode.id)?.reason ? (
                    <p className="rounded-md bg-bench-50 px-3 py-2 text-xs leading-5 text-bench-700 ring-1 ring-inset ring-bench-200">
                      {blockingNodeMap.get(selectedNode.id)?.reason}
                    </p>
                  ) : null}
                  {selectedNodeObservations.length > 0 ? (
                    <div className="space-y-2">
                      {selectedNodeObservations.slice(0, 6).map((observation) => (
                        <div key={observation.id} className="rounded-md bg-bench-50 px-3 py-2 ring-1 ring-inset ring-bench-200">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium text-bench-900">{observation.name}</span>
                            <span className="text-[11px] uppercase tracking-[0.08em] text-bench-700">{observation.type}</span>
                          </div>
                          <p className="mt-1 text-[11px] text-bench-700">{observation.statusMessage ?? "Mapped from runtime topology state."}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs leading-5 text-bench-700">
                      This node has no direct remote trace rows yet. Trails is still using Ora topology as the source of truth.
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-xs leading-5 text-bench-700">Select a topology node in the chat workbench to inspect its linked trace fragments.</p>
              )}
            </DockCard>
          </>
        )}

        {selectedTab === "Trace" && (
          <>
            <DockCard title="Trace Status" icon={<GitBranch size={16} />}>
              <div className="space-y-2">
                <SignalLine label="Provider" value={trace?.provider === "langfuse" ? "Langfuse" : "Ora Trails"} />
                <SignalLine label="Source" value={trace?.source ?? "trace unavailable"} />
                <SignalLine label="Trace ID" value={trace?.traceId ?? "Not captured"} />
                <SignalLine label="Root observation" value={trace?.rootObservationId ?? "Not captured"} />
                <SignalLine label="Availability" value={trace?.available ? "Available" : trace?.enabled ? "Pending / degraded" : "Disabled"} />
              </div>
              {trace?.reason && <p className="mt-3 text-xs leading-5 text-bench-700">{trace.reason}</p>}
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleOpenTrace}
                  disabled={traceOpenDisabled}
                  title={traceOpenUnavailable ? "No Langfuse trace is attached to this local Trail." : undefined}
                >
                  <ExternalLink size={14} />
                  {traceOpenUnavailable ? "Local Trail only" : "Open in Langfuse"}
                </Button>
              </div>
            </DockCard>

            <DockCard title="Generation Summaries" icon={<Clock3 size={16} />}>
              {trace?.generationRefs.length ? (
                <div className="space-y-2">
                  {trace.generationRefs.map((generation) => (
                    <div key={generation.observationId} className="rounded-md bg-bench-50 px-3 py-2 ring-1 ring-inset ring-bench-200">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-bench-900">{generation.name}</span>
                        <span className="text-[11px] text-bench-700">{generation.model ?? "unknown model"}</span>
                      </div>
                      <p className="mt-1 text-[11px] text-bench-700">
                        {(generation.providerId ?? "provider n/a")} · latency {formatLatency(generation.latencySeconds)} · cost {formatUsd(generation.totalCostUsd ?? 0)}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs leading-5 text-bench-700">No generation refs were captured for this run.</p>
              )}
            </DockCard>

            <DockCard title="Observation Tree" icon={<CheckCircle2 size={16} />}>
              {trailLoading ? (
                <p className="text-xs leading-5 text-bench-700">Loading trace observations...</p>
              ) : trailError ? (
                <p className="text-xs leading-5 text-amber-700">{trailError}</p>
              ) : trail?.observations.length ? (
                <div className="space-y-2">
                  {trail.observations.map((observation) => (
                    <div key={observation.id} className="rounded-md bg-white px-3 py-2 ring-1 ring-inset ring-bench-200">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-bench-900">{observation.name}</span>
                        <span className="text-[11px] uppercase tracking-[0.08em] text-bench-700">{observation.type}</span>
                      </div>
                      <p className="mt-1 text-[11px] text-bench-700">
                        {observation.model ? `${observation.model} · ` : ""}{observation.statusMessage ?? "No status message"}
                      </p>
                      {(observation.input !== undefined || observation.output !== undefined) && (
                        <div className="mt-2 max-h-44 overflow-y-auto rounded-md bg-bench-50 p-2">
                          <JsonTree data={{ input: observation.input, output: observation.output }} defaultExpanded={1} />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs leading-5 text-bench-700">Trace data is not available for this run yet. Local Trails views are still backed by Ora runtime state.</p>
              )}
            </DockCard>
          </>
        )}

        {artifacts.length > 0 && selectedTab !== "Trace" && (
          <DockCard title="Artifacts" icon={<CheckCircle2 size={16} />}>
            <div className="space-y-2">
              {artifacts.map((artifact) => (
                <div key={artifact.id} className="rounded-md bg-bench-50 px-3 py-2 ring-1 ring-inset ring-bench-200">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-bench-900">{artifact.label}</span>
                    <span className="text-[11px] text-bench-700">{artifact.kind}</span>
                  </div>
                  <p className="mt-1 text-[11px] text-bench-700">{artifact.mimeType}</p>
                </div>
              ))}
            </div>
          </DockCard>
        )}

        {selectedTab === "Timeline" && planItems.length > 0 && (
          <DockCard title="Plan Trace" icon={<Workflow size={16} />}>
            <div className="space-y-2">
              {planItems.map((item) => (
                <div key={item.id} className="rounded-md bg-white px-3 py-2 ring-1 ring-inset ring-bench-200">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-bench-900">{item.title}</span>
                    <span className="text-[11px] capitalize text-bench-700">{item.status}</span>
                  </div>
                  <p className="mt-1 text-[11px] text-bench-700">{item.owner} · {item.checkpoint}</p>
                </div>
              ))}
            </div>
          </DockCard>
        )}
      </div>
    </div>
  );
}

function SignalLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md bg-bench-50 px-3 py-2 ring-1 ring-inset ring-bench-200">
      <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-bench-700">{label}</span>
      <span className="text-right text-sm font-semibold text-bench-900">{value}</span>
    </div>
  );
}

function buildTimelineItems(snapshot: OraStateSnapshot) {
  const topologyNodeLabels = new Map(snapshot.topology.nodes.map((node) => [node.id, node.label]));
  return snapshot.events.map((event) => ({
    id: event.id,
    seq: event.seq,
    createdAt: event.createdAt,
    eventType: event.type,
    nodeId: event.nodeId,
    nodeLabel: event.nodeId ? topologyNodeLabels.get(event.nodeId) ?? event.nodeId : undefined,
    label: timelineLabel(event.type),
    detail: timelineDetail(event),
  }));
}

function buildPendingApprovalItems(snapshot: OraStateSnapshot): PendingApprovalItem[] {
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

function buildBlockingNodeMap(
  pendingApprovalItems: PendingApprovalItem[],
  pendingClarifications: OraStateSnapshot["pendingClarifications"],
) {
  const result = new Map<string, {
    kind: "approval" | "clarification";
    riskLevel: "low" | "medium" | "high";
    reason: string;
  }>();
  for (const item of pendingApprovalItems) {
    if (!item.nodeId) {
      continue;
    }
    result.set(item.nodeId, {
      kind: "approval",
      riskLevel: item.riskLevel,
      reason: item.reason,
    });
  }
  for (const item of pendingClarifications) {
    result.set(item.nodeId, {
      kind: "clarification",
      riskLevel: "low",
      reason: item.question,
    });
  }
  return result;
}

function buildBlockingEventIds(
  snapshot: OraStateSnapshot,
  pendingApprovalItems: PendingApprovalItem[],
) {
  const result = new Set<string>();
  for (const item of pendingApprovalItems) {
    if (item.eventId) {
      result.add(item.eventId);
    }
  }
  const events = [...snapshot.events].reverse();
  for (const clarification of snapshotPendingClarifications(snapshot)) {
    const event = events.find((candidate) =>
      candidate.type === "clarification.required" && matchesClarificationEvent(candidate.payload, clarification.id, clarification.key),
    );
    if (event) {
      result.add(event.id);
    }
  }
  return result;
}

function snapshotPendingApprovals(snapshot: OraStateSnapshot): string[] {
  return Array.isArray(snapshot.pendingApprovals) ? snapshot.pendingApprovals : [];
}

function snapshotPendingClarifications(snapshot: OraStateSnapshot): OraStateSnapshot["pendingClarifications"] {
  return Array.isArray(snapshot.pendingClarifications) ? snapshot.pendingClarifications : [];
}

function timelineLabel(eventType: string) {
  switch (eventType) {
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
    case "checkpoint.created":
      return "Checkpoint captured";
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
    case "message.delta":
      return "Assistant message";
    case "run.started":
      return "Run started";
    case "run.done":
      return "Run completed";
    case "run.failed":
      return "Run failed";
    default:
      return eventType;
  }
}

function timelineDetail(event: OraStateSnapshot["events"][number]) {
  if (isRecord(event.payload)) {
    if (event.type === "tool.called" || event.type === "tool.repaired") {
      const toolId = typeof event.payload.toolId === "string" ? event.payload.toolId : "tool";
      const status = typeof event.payload.status === "string" ? event.payload.status : "updated";
      return `${toolId} ${status.replace(/_/g, " ")}.`;
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
  }
  return "Runtime state updated.";
}

export function collectAnomalies(
  snapshot: OraStateSnapshot,
  trailError: string | undefined,
  trace: OraRunTrail["trace"] | OraStateSnapshot["trace"],
  actions: ActionRecord[],
) {
  const items = new Set<string>();
  if (snapshot.status === "failed") {
    const failureDetail = latestFailureDetail(snapshot);
    items.add(
      failureDetail
        ? `Run failed: ${failureDetail}`
        : "The run ended in a failed state. Inspect the latest events and trace rows for the failing branch.",
    );
  }
  if (actions.some((action) => action.state === "approval_required")) {
    items.add("A pending approval is blocking forward progress.");
  }
  const toolCalls = snapshot.toolCalls ?? [];
  const stopReason = stopReasonFromSnapshot(snapshot);
  if (stopReason) {
    items.add(`Run stop reason: ${stopReason}.`);
  }
  if (toolCalls.some((call) => call.status === "repaired")) {
    items.add("A dangling provider tool call was repaired as interrupted before the next model call.");
  }
  if (toolCalls.some((call) => call.status === "interrupted")) {
    items.add("A tool call was interrupted before completion.");
  }
  if (trace?.provider === "ora" || trace?.source === "local") {
    items.add("Ora-native Trails is active; Langfuse is optional for deeper observability.");
  } else if (!trace?.enabled) {
    items.add("Langfuse tracing is disabled, so Trails is operating in local-only mode.");
  } else if (!trace.available) {
    items.add(trace.reason ?? "Remote trace data is unavailable; the drawer is using local synthesized observations.");
  }
  if (trailError) {
    items.add(`Trace fetch degraded: ${trailError}`);
  }
  if (snapshot.events.length === 0) {
    items.add("No runtime events were recorded for this run.");
  }
  return [...items];
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

function formatRate(eventCount: number, runtimeMs: number) {
  if (runtimeMs <= 0) {
    return `${eventCount.toFixed(0)}/s`;
  }
  return `${(eventCount / Math.max(runtimeMs / 1000, 1)).toFixed(1)}/s`;
}

function formatUsd(value: number) {
  return `$${value.toFixed(value > 0 ? 4 : 2)}`;
}

function formatLatency(value?: number) {
  return value === undefined ? "n/a" : `${value.toFixed(2)}s`;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
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

function matchesClarificationEvent(payload: unknown, clarificationId: string, clarificationKey: string) {
  if (!isRecord(payload) || !isRecord(payload.clarification)) {
    return false;
  }
  const clarification = payload.clarification;
  return clarification.id === clarificationId || clarification.key === clarificationKey;
}

function fallbackApprovalReason(riskLevel?: "low" | "medium" | "high") {
  return riskLevel === "high"
    ? "Please confirm this operation before I continue."
    : "Please confirm before this step continues.";
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

function riskPillClassName(riskLevel: "low" | "medium" | "high") {
  const base = "rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em]";
  switch (riskLevel) {
    case "high":
      return `${base} bg-rose-100 text-rose-900`;
    case "medium":
      return `${base} bg-amber-100 text-amber-900`;
    default:
      return `${base} bg-slate-100 text-slate-700`;
  }
}

function toolCallStatusClassName(status: OraStateSnapshot["toolCalls"][number]["status"]) {
  const base = "rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em]";
  if (status === "succeeded") {
    return `${base} bg-emerald-100 text-emerald-900`;
  }
  if (status === "failed" || status === "interrupted" || status === "repaired") {
    return `${base} bg-amber-100 text-amber-900`;
  }
  if (status === "approval_required") {
    return `${base} bg-sky-100 text-sky-900`;
  }
  return `${base} bg-bench-100 text-bench-700`;
}
