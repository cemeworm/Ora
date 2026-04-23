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
  selectedAgent?: AgentProfile;
  selectedBeat?: RunBeat;
  selectedCheckpoint?: CheckpointRecord;
  selectedNode?: TopologyNode;
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
  const nodeLabel = selectedNode?.label ?? "No runtime detail selected yet";

  return (
    <aside className={cn("flex h-full min-h-0 flex-col bg-transparent", !open && "hidden")} aria-hidden={!open}>
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-card/74 px-4 backdrop-blur-sm">
        <div className="flex min-w-0 items-center gap-2">
          <FilesIcon size={16} className="text-muted-foreground" />
          <div className="min-w-0">
            <h2 className="truncate text-sm font-medium">Details</h2>
            <p className="truncate text-[11px] text-muted-foreground">{nodeLabel}</p>
          </div>
        </div>
        <Button onClick={onClose} variant="ghost" size="icon-sm" title="Close details">
          <X size={16} />
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {selectedAgent && selectedBeat && selectedNode ? (
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
        ) : (
          <div className="rounded-2xl border border-border bg-card/70 p-4 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">Runtime details will appear here.</p>
            <p className="mt-2 leading-6">{commandFeedback}</p>
          </div>
        )}
      </div>
    </aside>
  );
}
