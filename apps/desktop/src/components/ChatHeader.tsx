import { BookOpenText, Download, Files, Pause, PanelRightOpen } from "lucide-react";
import { Button } from "./ui/button";
import type { SessionRun } from "../types";
import { cn } from "../lib/utils";

interface ChatHeaderProps {
  busyCommand?: string;
  isRunning: boolean;
  isApprovalRequired: boolean;
  selectedSession: SessionRun;
  onExportReport: () => void;
  onInterruptRun: () => void;
  onToggleDetailDrawer: (drawer: "trails" | "documents") => void;
  detailDrawer: "trails" | "documents" | undefined;
}

export function ChatHeader({
  busyCommand,
  isRunning,
  isApprovalRequired,
  selectedSession,
  onExportReport,
  onInterruptRun,
  onToggleDetailDrawer,
  detailDrawer,
}: ChatHeaderProps) {
  const trailsOpen = detailDrawer === "trails";
  const documentsOpen = detailDrawer === "documents";
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
          variant={trailsOpen ? "secondary" : "ghost"}
          size="sm"
          onClick={() => onToggleDetailDrawer("trails")}
          title="Toggle trails"
        >
          {trailsOpen ? <Files size={14} /> : <PanelRightOpen size={14} />}
          <span className="hidden sm:inline">Trails</span>
        </Button>
        {selectedSession.projectId ? (
          <Button
            variant={documentsOpen ? "secondary" : "ghost"}
            size="sm"
            onClick={() => onToggleDetailDrawer("documents")}
            title="Toggle documents"
          >
            <BookOpenText size={14} />
            <span className="hidden sm:inline">Documents</span>
          </Button>
        ) : null}
      </div>
    </header>
  );
}
