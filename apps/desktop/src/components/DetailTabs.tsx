import { useState } from "react";
import { Activity, Bot, Brain, CircleDot, FileText, GitFork, ShieldCheck } from "lucide-react";
import { DockCard } from "./DockCard";
import { JsonTree } from "./JsonTree";
import { MetricRow } from "./MetricRow";
import { StatusBadge } from "./StatusBadge";
import { statusLabels } from "./StatusPill";
import type { ActionRecord, AgentProfile, ArtifactRecord, CheckpointRecord, MemoryRecord, PlanItem, RunBeat, SessionRun, TopologyNode } from "../types";
import type { OraStateSnapshot } from "../lib/runtimeClient";

type DetailTab = "Overview" | "Agents" | "History" | "Actions";

const detailTabs: DetailTab[] = ["Overview", "Agents", "History", "Actions"];

interface DetailTabsProps {
  actions: ActionRecord[];
  agents: AgentProfile[];
  artifacts: ArtifactRecord[];
  activeSnapshot: OraStateSnapshot | undefined;
  busyCommand?: string;
  checkpoints: CheckpointRecord[];
  commandFeedback: string;
  memoryRecords: MemoryRecord[];
  planItems: PlanItem[];
  selectedAgent: AgentProfile;
  selectedBeat: RunBeat;
  selectedCheckpoint?: CheckpointRecord;
  selectedNode: TopologyNode;
  selectedSession: SessionRun;
  onExportReport: () => void;
  onForkRun: () => void;
  onReplaySelection: () => void;
  onResumeRun: () => void;
  onCancelRun: () => void;
}

export function DetailTabs({
  actions,
  agents,
  artifacts,
  activeSnapshot,
  busyCommand,
  checkpoints,
  commandFeedback,
  memoryRecords,
  planItems,
  selectedAgent,
  selectedBeat,
  selectedCheckpoint,
  selectedSession,
  onExportReport,
  onForkRun,
  onReplaySelection,
  onResumeRun,
  onCancelRun,
}: DetailTabsProps) {
  const [selectedTab, setSelectedTab] = useState<DetailTab>("Overview");

  const approvals = actions.filter((a) => a.state === "approval_required");
  const scopedMemory = memoryRecords.filter((record) =>
    selectedAgent.memoryScopes.some((scope) => record.namespace.startsWith(scope)),
  );
  const selectedPlanItems = planItems.filter((item) => item.owner === selectedAgent.id);

  return (
    <div>
      {/* Tab bar */}
      <div className="border-b border-bench-200 px-3 py-2">
        <div className="flex gap-1">
          {detailTabs.map((tab) => (
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

      {/* Tab content */}
      <div className="p-4">
        {selectedTab === "Overview" && (
          <div className="space-y-3">
            <MetricRow label="Run ID" value={selectedSession.id} />
            <MetricRow label="Status" value={statusLabels[selectedSession.status]} />
            <MetricRow label="Pattern" value={selectedSession.pattern.replace(/_/g, " ")} />
            <MetricRow label="Prompt" value={activeSnapshot?.input.prompt ?? selectedSession.title} />
            <MetricRow label="Events" value={String(activeSnapshot?.events.length ?? 0)} />
            <MetricRow label="Checkpoints" value={String(activeSnapshot?.checkpoints.length ?? 0)} />
            <MetricRow label="Health" value={`${selectedSession.health}%`} />
            <DockCard title="Control result" icon={<Activity size={16} />}>
              <p>{commandFeedback}</p>
            </DockCard>
            {/* State snapshot */}
            <DockCard title="Run snapshot" icon={<CircleDot size={16} />}>
              <div className="max-h-[300px] overflow-y-auto">
                <JsonTree data={activeSnapshot ?? {}} defaultExpanded={2} />
              </div>
            </DockCard>
          </div>
        )}

        {selectedTab === "Agents" && (
          <div className="space-y-3">
            {/* Agent profiles */}
            {agents.map((agent) => (
              <div
                key={agent.id}
                className={`rounded-lg bg-white p-3 text-xs leading-5 shadow-sm ring-1 ring-inset ${
                  agent.id === selectedAgent.id ? "ring-bench-900" : "ring-bench-200"
                }`}
              >
                <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-bench-900">
                  <Bot size={16} />
                  {agent.label}
                </div>
                <p className="text-bench-700">{agent.role}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <span className="rounded-full bg-bench-100 px-2 py-0.5 font-mono text-[11px]">{agent.model}</span>
                  <span className="rounded-full bg-bench-100 px-2 py-0.5 font-mono text-[11px]">{agent.budget}</span>
                </div>
                <div className="mt-2">
                  <p className="text-[11px] font-semibold text-bench-700">Memory scopes</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {agent.memoryScopes.map((scope) => (
                      <span key={scope} className="rounded-full bg-bench-100 px-2 py-0.5 font-mono text-[11px]">
                        {scope}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="mt-2">
                  <p className="text-[11px] font-semibold text-bench-700">Tools</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {agent.tools.map((tool) => (
                      <span key={tool} className="rounded-full bg-bench-100 px-2 py-0.5 font-mono text-[11px]">
                        {tool}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            ))}

            {/* Memory records */}
            {(scopedMemory.length > 0 ? scopedMemory : memoryRecords).map((record) => (
              <DockCard key={record.id} title={record.namespace} icon={<Brain size={16} />}>
                <div className="flex items-center justify-between gap-2">
                  <StatusBadge status={record.kind} size="sm" />
                  <span className="font-mono text-[11px]">{record.updatedAt}</span>
                </div>
                <p className="mt-2">{record.value}</p>
              </DockCard>
            ))}
          </div>
        )}

        {selectedTab === "History" && (
          <div className="space-y-2">
            {/* Plan items */}
            {(selectedPlanItems.length > 0 ? selectedPlanItems : planItems).map((item) => (
              <div key={item.id} className="rounded-lg bg-white p-3 shadow-sm ring-1 ring-inset ring-bench-200">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold leading-5">{item.title}</p>
                  <StatusBadge status={item.status} size="sm" />
                </div>
                <p className="mt-2 text-xs text-bench-700">
                  {item.owner} &middot; {item.checkpoint}
                </p>
                {item.linkedActions.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {item.linkedActions.map((actionId) => (
                      <span key={actionId} className="rounded-full bg-bench-100 px-2 py-0.5 font-mono text-[11px]">
                        {actionId}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}

            {/* Checkpoints */}
            {checkpoints.map((checkpoint) => (
              <div
                key={checkpoint.id}
                className={`rounded-lg bg-white p-3 shadow-sm ring-1 ring-inset ${
                  checkpoint.id === selectedCheckpoint?.id ? "ring-bench-900" : "ring-bench-200"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="font-semibold">{checkpoint.label}</p>
                  <span className="font-mono text-bench-700">seq:{checkpoint.eventSeq}</span>
                </div>
                <p className="mt-2 font-mono text-[11px] text-bench-700">{checkpoint.stateHash ?? "state hash pending"}</p>
                <div className="mt-3">
                  <button
                    onClick={onForkRun}
                    disabled={busyCommand !== undefined}
                    className="inline-flex items-center gap-1.5 rounded-md bg-bench-900 px-3 py-2 text-xs font-semibold text-white transition active:scale-95 disabled:opacity-60"
                  >
                    <GitFork size={13} />
                    Fork from here
                  </button>
                </div>
              </div>
            ))}

            {/* Artifacts */}
            {artifacts.length > 0 && (
              <DockCard title="Reports" icon={<FileText size={16} />}>
                <div className="space-y-2">
                  {artifacts.map((artifact) => (
                    <div key={artifact.id} className="rounded-md bg-bench-100 px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-bench-900">{artifact.label}</span>
                        <span className="font-mono text-[11px]">{artifact.kind}</span>
                      </div>
                      <p className="mt-1 font-mono text-[11px]">{artifact.mimeType}</p>
                    </div>
                  ))}
                </div>
              </DockCard>
            )}
          </div>
        )}

        {selectedTab === "Actions" && (
          <div className="space-y-2">
            {(approvals.length > 0 ? approvals : actions).map((action) => (
              <div
                key={action.id}
                className={`rounded-lg p-3 ring-1 ring-inset ${
                  action.state === "approval_required"
                    ? "bg-amber-50 ring-amber-200"
                    : "bg-white ring-bench-200"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold">{action.label}</p>
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                        action.risk === "high"
                          ? "bg-red-100 text-red-800 ring-1 ring-inset ring-red-300"
                          : action.risk === "medium"
                            ? "bg-amber-100 text-amber-800 ring-1 ring-inset ring-amber-300"
                            : "bg-bench-100 text-bench-700 ring-1 ring-inset ring-bench-200"
                      }`}
                    >
                      {action.risk}
                    </span>
                    <StatusBadge status={action.state} size="sm" />
                  </div>
                </div>
                <p className="mt-2 text-xs leading-5 text-bench-700">{action.consequence}</p>
                <div className="mt-3 flex items-center justify-between gap-2 text-[11px] text-bench-700">
                  <span className="font-mono">risk:{action.risk}</span>
                  <span className="font-mono">{action.agentId ?? "runtime"}</span>
                </div>
                {action.state === "approval_required" && (
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button
                      onClick={onResumeRun}
                      disabled={busyCommand !== undefined}
                      className="rounded-md bg-signal-amber px-3 py-2 text-xs font-semibold text-bench-900 transition active:scale-95 disabled:opacity-60"
                    >
                      Approve
                    </button>
                    <button
                      onClick={onCancelRun}
                      disabled={busyCommand !== undefined}
                      className="rounded-md border border-bench-200 bg-white px-3 py-2 text-xs font-semibold transition active:scale-95 disabled:opacity-60"
                    >
                      Deny
                    </button>
                  </div>
                )}
              </div>
            ))}
            {approvals.length === 0 && (
              <DockCard title="No approval gate" icon={<ShieldCheck size={16} />}>
                <p>Select an action beat or interrupt a run to inspect approval state here.</p>
              </DockCard>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
