import { X } from "lucide-react";
import { DetailTabs } from "./DetailTabs";
import type { ActionRecord, AgentProfile, ArtifactRecord, CheckpointRecord, MemoryRecord, PlanItem, RunBeat, SessionRun, TopologyNode } from "../types";
import type { OraStateSnapshot } from "../lib/runtimeClient";

interface DetailDrawerProps {
  open: boolean;
  onClose: () => void;
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

export function DetailDrawer({
  open,
  onClose,
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
  selectedNode,
  selectedSession,
  onExportReport,
  onForkRun,
  onReplaySelection,
  onResumeRun,
  onCancelRun,
}: DetailDrawerProps) {
  return (
    <aside
      className={`fixed inset-y-0 right-0 z-40 w-[400px] flex flex-col border-l border-bench-200 bg-bench-50 shadow-lift transition-transform duration-200 ${
        open ? "translate-x-0" : "translate-x-full"
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-bench-200 p-4">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-bench-700">Details</p>
          <h2 className="mt-1 truncate text-sm font-semibold">{selectedNode.label}</h2>
        </div>
        <button
          onClick={onClose}
          className="rounded-md border border-bench-200 bg-white p-1.5 text-bench-700 shadow-sm transition hover:text-bench-900 active:scale-95"
        >
          <X size={16} />
        </button>
      </div>

      {/* Content */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <DetailTabs
          actions={actions}
          agents={agents}
          artifacts={artifacts}
          activeSnapshot={activeSnapshot}
          busyCommand={busyCommand}
          checkpoints={checkpoints}
          commandFeedback={commandFeedback}
          memoryRecords={memoryRecords}
          planItems={planItems}
          selectedAgent={selectedAgent}
          selectedBeat={selectedBeat}
          selectedCheckpoint={selectedCheckpoint}
          selectedNode={selectedNode}
          selectedSession={selectedSession}
          onExportReport={onExportReport}
          onForkRun={onForkRun}
          onReplaySelection={onReplaySelection}
          onResumeRun={onResumeRun}
          onCancelRun={onCancelRun}
        />
      </div>
    </aside>
  );
}
