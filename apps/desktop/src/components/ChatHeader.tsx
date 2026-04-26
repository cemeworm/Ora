import { BookOpenText, Download, Files, PanelRightOpen } from "lucide-react";
import { Button } from "./ui/button";
import type { SessionRun } from "../types";

interface ChatHeaderProps {
  busyCommand?: string;
  selectedSession: SessionRun;
  onExportReport: () => void;
  onToggleDetailDrawer: (drawer: "trails" | "documents") => void;
  detailDrawer: "trails" | "documents" | undefined;
}

export function ChatHeader({
  busyCommand,
  selectedSession,
  onExportReport,
  onToggleDetailDrawer,
  detailDrawer,
}: ChatHeaderProps) {
  const trailsOpen = detailDrawer === "trails";
  const documentsOpen = detailDrawer === "documents";
  return (
    <header className="absolute left-0 right-0 top-0 z-30 flex h-12 shrink-0 items-center justify-between bg-card/74 px-4 backdrop-blur-sm">
      <div className="min-w-0">
        <h2 className="truncate text-sm font-medium">{selectedSession.title}</h2>
      </div>
      <div className="flex items-center gap-1.5">
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
