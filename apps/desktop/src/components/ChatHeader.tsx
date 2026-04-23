import { Download, Files, Pause, PanelRightOpen } from "lucide-react";
import { Button } from "./ui/button";
import { StatusBadge } from "./StatusBadge";
import type { RuntimeBridgeStatus, SessionRun } from "../types";
import { cn } from "../lib/utils";

interface ChatHeaderProps {
  bridgeStatus: RuntimeBridgeStatus;
  busyCommand?: string;
  isRunning: boolean;
  isApprovalRequired: boolean;
  selectedSession: SessionRun;
  onExportReport: () => void;
  onInterruptRun: () => void;
  onToggleDetailDrawer: () => void;
  detailDrawerOpen: boolean;
}

export function ChatHeader({
  bridgeStatus,
  busyCommand,
  isRunning,
  isApprovalRequired,
  selectedSession,
  onExportReport,
  onInterruptRun,
  onToggleDetailDrawer,
  detailDrawerOpen,
}: ChatHeaderProps) {
  return (
    <header
      className={cn(
        "absolute left-0 right-0 top-0 z-30 flex h-12 shrink-0 items-center justify-between bg-background/80 px-4 shadow-xs backdrop-blur",
        isApprovalRequired && "bg-amber-50/80",
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-medium">{selectedSession.title}</h2>
        </div>
        <StatusBadge status={selectedSession.status} size="sm" />
        <div className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex">
          <span className={cn("h-2 w-2 rounded-full", bridgeStatus.ok ? "bg-signal-acid" : "bg-red-500")} />
          <span>{bridgeStatus.label}</span>
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
          title="Toggle details"
        >
          {detailDrawerOpen ? <Files size={14} /> : <PanelRightOpen size={14} />}
          <span className="hidden sm:inline">Details</span>
        </Button>
      </div>
    </header>
  );
}
