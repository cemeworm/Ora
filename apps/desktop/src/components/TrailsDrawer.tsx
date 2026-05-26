import { Crosshair } from "lucide-react";
import { TrailsTabs } from "./TrailsTabs";
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
      {subtitle ? (
        <div className="flex shrink-0 items-center gap-2 border-b border-border/50 bg-card/50 px-4 py-2.5">
          <Crosshair size={14} className="text-muted-foreground shrink-0" />
          <p className="truncate text-[12px] font-medium text-muted-foreground">
            {subtitle}
          </p>
        </div>
      ) : null}

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
