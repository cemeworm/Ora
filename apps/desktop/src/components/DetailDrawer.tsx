import { FilesIcon, X } from "lucide-react";
import { DetailTabs } from "./DetailTabs";
import { Button } from "./ui/button";
import type { ActionRecord, AgentProfile, ArtifactRecord, CheckpointRecord, MemoryRecord, PlanItem, RunBeat, SessionRun, TopologyNode } from "../types";
import type { OraStateSnapshot } from "../lib/runtimeClient";
import { cn } from "../lib/utils";

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
      className={cn(
        "fixed inset-y-0 right-0 z-40 w-full border-l border-border bg-background p-3 shadow-lift transition-transform duration-300 ease-in-out md:w-[min(42vw,520px)] md:min-w-[390px] md:p-4",
        open ? "translate-x-0" : "translate-x-full",
      )}
      aria-hidden={!open}
    >
      <div className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-background/90 shadow-xs backdrop-blur">
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-border px-3">
          <div className="flex min-w-0 items-center gap-2">
            <FilesIcon size={16} className="text-muted-foreground" />
            <div className="min-w-0">
              <h2 className="truncate text-sm font-medium">Details</h2>
              <p className="truncate text-[11px] text-muted-foreground">{selectedNode.label}</p>
            </div>
          </div>
          <Button onClick={onClose} variant="ghost" size="icon-sm" title="Close details">
            <X size={16} />
          </Button>
        </header>

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
      </div>
    </aside>
  );
}
