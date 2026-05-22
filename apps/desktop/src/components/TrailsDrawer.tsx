import { Crosshair, X } from "lucide-react";
import { TrailsTabs } from "./TrailsTabs";
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
import type { OraStateSnapshot } from "../lib/runtimeClient";
import type { DesktopRunInteractionState } from "../lib/runInteractionState";
import { cn } from "../lib/utils";

interface TrailsDrawerProps {
  open: boolean;
  onClose: () => void;
  actions: ActionRecord[];
  agents: AgentProfile[];
  artifacts: ArtifactRecord[];
  activeSnapshot: OraStateSnapshot | undefined;
  busyCommand?: string;
  checkpoints: CheckpointRecord[];
  commandFeedback: string;
  planItems: PlanItem[];
  runInteractionState: DesktopRunInteractionState;
  selectedAgent?: AgentProfile;
  selectedBeat?: RunBeat;
  selectedCheckpoint?: CheckpointRecord;
  selectedNode?: TopologyNode;
  selectedSession: SessionRun;
  onForkRun: () => void;
  onForkAndResumeRun: () => void;
  onReplaySelection: () => void;
  onResumeRun: () => void;
  onCancelRun: () => void;
}

export function TrailsDrawer({
  open,
  onClose,
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
  onForkAndResumeRun,
  onReplaySelection,
  onResumeRun,
  onCancelRun,
}: TrailsDrawerProps) {
  const nodeLabel =
    selectedNode?.label ??
    activeSnapshot?.pattern.replace(/_/g, " ") ??
    "No active run selected";
  const subtitle = nodeLabel.trim().toLowerCase() === "run" ? "" : nodeLabel;

  return (
    <aside
      className={cn(
        "flex h-full min-h-0 w-full min-w-0 flex-col bg-transparent",
        !open && "hidden",
      )}
      aria-hidden={!open}
    >
      <header className="flex h-12 shrink-0 items-center justify-between bg-card px-4">
        <div className="flex min-w-0 items-center gap-2">
          <Crosshair size={16} className="text-muted-foreground" />
          <div className="min-w-0">
            <h2 className="truncate text-sm font-medium">Trails</h2>
            {subtitle ? (
              <p className="truncate text-[11px] text-muted-foreground">
                {subtitle}
              </p>
            ) : null}
          </div>
        </div>
        <Button
          onClick={onClose}
          variant="ghost"
          size="icon-sm"
          title="Close trails"
        >
          <X size={16} />
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {activeSnapshot ? (
          <TrailsTabs
            actions={actions}
            agents={agents}
            artifacts={artifacts}
            activeSnapshot={activeSnapshot}
            busyCommand={busyCommand}
            checkpoints={checkpoints}
            commandFeedback={commandFeedback}
            planItems={planItems}
            selectedAgent={selectedAgent}
            selectedBeat={selectedBeat}
            selectedCheckpoint={selectedCheckpoint}
            selectedNode={selectedNode}
            runInteractionState={runInteractionState}
            selectedSession={selectedSession}
            onForkRun={onForkRun}
            onForkAndResumeRun={onForkAndResumeRun}
            onReplaySelection={onReplaySelection}
            onResumeRun={onResumeRun}
            onCancelRun={onCancelRun}
          />
        ) : (
          <div className="rounded-2xl border border-border bg-card/70 p-4 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">
              Run diagnostics will appear here.
            </p>
            <p className="mt-2 leading-6">{commandFeedback}</p>
          </div>
        )}
      </div>
    </aside>
  );
}
