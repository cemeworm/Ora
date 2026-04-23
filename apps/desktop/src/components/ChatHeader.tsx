import { Download, Info, Pause, Play } from "lucide-react";
import { StatusBadge } from "./StatusBadge";
import type { RuntimeBridgeStatus, SessionRun } from "../types";

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
    <header className="flex items-center justify-between border-b border-bench-200 bg-bench-50 px-5 py-3">
      <div className="flex items-center gap-3 min-w-0">
        <h2 className="truncate text-sm font-semibold">{selectedSession.title}</h2>
        <StatusBadge status={selectedSession.status} size="sm" />
        <div className="flex items-center gap-1.5 text-xs text-bench-700">
          <span className={`h-2 w-2 rounded-full ${bridgeStatus.ok ? "bg-signal-acid" : "bg-red-500"}`} />
          <span className="font-semibold">{bridgeStatus.label}</span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {isRunning && (
          <button
            onClick={onInterruptRun}
            disabled={busyCommand !== undefined}
            className="inline-flex items-center gap-1.5 rounded-md border border-bench-200 bg-white px-3 py-1.5 text-xs font-medium shadow-sm transition hover:shadow-pane active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Pause size={14} />
            Pause
          </button>
        )}
        <button
          onClick={onExportReport}
          disabled={busyCommand !== undefined}
          className="inline-flex items-center gap-1.5 rounded-md border border-bench-200 bg-white px-3 py-1.5 text-xs font-medium shadow-sm transition hover:shadow-pane active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
          title="Export report"
        >
          <Download size={14} />
          Export
        </button>
        <button
          onClick={onToggleDetailDrawer}
          className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition active:scale-95 ${
            detailDrawerOpen
              ? "bg-bench-900 text-white"
              : "border border-bench-200 bg-white shadow-sm hover:shadow-pane"
          }`}
          title="Toggle detail drawer"
        >
          <Info size={14} />
          Details
        </button>
      </div>
    </header>
  );
}
