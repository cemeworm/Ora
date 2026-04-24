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
  const selectedNodeObservations = (trail?.observations ?? []).filter((observation) => {
    if (!selectedNode) {
      return false;
    }
    const metadata = isRecord(observation.metadata) ? observation.metadata : {};
    return metadata.nodeId === selectedNode.id || (selectedNode.agentId !== undefined && metadata.agentId === selectedNode.agentId);
  });
  const anomalies = collectAnomalies(activeSnapshot, trailError, trace, actions);
  const timelineItems = buildTimelineItems(activeSnapshot);
  const traceOpenDisabled = !trace?.traceUrl || openingTrace;

  async function handleOpenTrace() {
    if (!trace?.traceUrl) {
      return;
    }
    setOpeningTrace(true);
    try {
      await runtimeClient.openExternalUrl(trace.traceUrl);
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
              <MetricRow label="Pattern" value={activeSnapshot.pattern.replace(/_/g, " ")} />
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
                  selectedBeat?.id === item.id ? "bg-bench-50 ring-bench-900" : "bg-white ring-bench-200"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-bench-900">{item.label}</p>
                    <p className="mt-1 text-xs leading-5 text-bench-700">{item.detail}</p>
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
                  <div
                    key={node.id}
                    className={`rounded-lg px-3 py-2 ring-1 ring-inset ${
                      node.id === selectedNode?.id ? "bg-bench-50 ring-bench-900" : "bg-white ring-bench-200"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-bench-900">{node.label}</p>
                        <p className="text-[11px] text-bench-700">{node.kind}{node.agentId ? ` · ${node.agentId}` : ""}</p>
                      </div>
                      <span className="rounded-full bg-bench-100 px-2 py-0.5 text-[11px] font-semibold capitalize text-bench-800">
                        {node.status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </DockCard>

            <DockCard title="Node Linkage" icon={<Workflow size={16} />}>
              {selectedNode ? (
                <div className="space-y-3">
                  <SignalLine label="Selected node" value={selectedNode.label} />
                  <SignalLine label="Linked trace rows" value={String(selectedNodeObservations.length)} />
                  <SignalLine label="Edges" value={String(activeSnapshot.topology.edges.filter((edge) => edge.source === selectedNode.id || edge.target === selectedNode.id).length)} />
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
                <SignalLine label="Provider" value={trace?.provider ?? "langfuse"} />
                <SignalLine label="Source" value={trace?.source ?? "trace unavailable"} />
                <SignalLine label="Trace ID" value={trace?.traceId ?? "Not captured"} />
                <SignalLine label="Root observation" value={trace?.rootObservationId ?? "Not captured"} />
                <SignalLine label="Availability" value={trace?.available ? "Available" : trace?.enabled ? "Pending / degraded" : "Disabled"} />
              </div>
              {trace?.reason && <p className="mt-3 text-xs leading-5 text-bench-700">{trace.reason}</p>}
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="secondary" size="sm" onClick={handleOpenTrace} disabled={traceOpenDisabled}>
                  <ExternalLink size={14} />
                  Open in Langfuse
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
  return snapshot.events.map((event) => ({
    id: event.id,
    seq: event.seq,
    createdAt: event.createdAt,
    label: timelineLabel(event.type),
    detail: timelineDetail(event),
  }));
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
    case "checkpoint.created":
      return "Checkpoint captured";
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

function collectAnomalies(
  snapshot: OraStateSnapshot,
  trailError: string | undefined,
  trace: OraRunTrail["trace"] | OraStateSnapshot["trace"],
  actions: ActionRecord[],
) {
  const items = new Set<string>();
  if (snapshot.status === "failed") {
    items.add("The run ended in a failed state. Inspect the latest events and trace rows for the failing branch.");
  }
  if (actions.some((action) => action.state === "approval_required")) {
    items.add("A pending approval is blocking forward progress.");
  }
  if (!trace?.enabled) {
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
