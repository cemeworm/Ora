import { Download, Files, Pause, PanelRightOpen } from "lucide-react";
import { Button } from "./ui/button";
import type { SessionRun, SessionTurnItem } from "../types";
import { cn } from "../lib/utils";

interface ChatHeaderProps {
  busyCommand?: string;
  isRunning: boolean;
  isApprovalRequired: boolean;
  selectedSession: SessionRun;
  turns: SessionTurnItem[];
  selectedTurnRunId?: string;
  onSelectTurn: (runId: string) => void;
  onExportReport: () => void;
  onInterruptRun: () => void;
  onToggleDetailDrawer: () => void;
  detailDrawerOpen: boolean;
}

export function ChatHeader({
  busyCommand,
  isRunning,
  isApprovalRequired,
  selectedSession,
  turns,
  selectedTurnRunId,
  onSelectTurn,
  onExportReport,
  onInterruptRun,
  onToggleDetailDrawer,
  detailDrawerOpen,
}: ChatHeaderProps) {
  return (
    <header
      className={cn(
        "absolute left-0 right-0 top-0 z-30 flex h-12 shrink-0 items-center justify-between border-b border-border bg-card/74 px-4 backdrop-blur-sm",
        isApprovalRequired && "bg-amber-50/90",
      )}
    >
      <div className="min-w-0">
        <h2 className="truncate text-sm font-medium">{selectedSession.title}</h2>
      </div>
      <div className="hidden min-w-0 flex-1 items-center justify-center px-4 lg:flex">
        <div className="flex max-w-full items-center gap-1 overflow-x-auto">
          {turns.map((turn) => (
            <button
              key={turn.runId}
              type="button"
              onClick={() => onSelectTurn(turn.runId)}
              className={cn(
                "rounded-full border px-2.5 py-1 text-[11px] transition",
                selectedTurnRunId === turn.runId
                  ? "border-foreground bg-foreground text-background"
                  : "border-border bg-background/70 text-muted-foreground hover:bg-accent hover:text-accent-foreground",
              )}
              title={turn.prompt}
            >
              T{turn.turnIndex} · {(turn.modeId ?? turn.pattern).replace(/_/g, " ")}
            </button>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        {isRunning && (
          <Button variant="ghost" size="sm" onClick={onInterruptRun} disabled={busyCommand !== undefined}>
            <Pause size={14} />
            <span className="hidden sm:inline">Pause</span>
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={onExportReport} disabled={busyCommand !== undefined} title="Export report">
          <Download size={14} />
          <span className="hidden sm:inline">Export</span>
        </Button>
        <Button
          variant={detailDrawerOpen ? "secondary" : "ghost"}
          size="sm"
          onClick={onToggleDetailDrawer}
          title="Toggle trails"
        >
          {detailDrawerOpen ? <Files size={14} /> : <PanelRightOpen size={14} />}
          <span className="hidden sm:inline">Trails</span>
        </Button>
      </div>
    </header>
  );
}
