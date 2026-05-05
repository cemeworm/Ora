import { BookOpenText, Files, GitBranchPlus, PanelRightOpen } from "lucide-react";
import { Button } from "./ui/button";
import type { SessionRun } from "../types";
import { translateCopy, type AppLanguage } from "../lib/i18n";

interface ChatHeaderProps {
  busyCommand?: string;
  selectedSession: SessionRun;
  onOpenBranches: () => void;
  onToggleDetailDrawer: (drawer: "trails" | "documents") => void;
  detailDrawer: "trails" | "documents" | undefined;
  language: AppLanguage;
}

export function ChatHeader({
  busyCommand,
  selectedSession,
  onOpenBranches,
  onToggleDetailDrawer,
  detailDrawer,
  language,
}: ChatHeaderProps) {
  const trailsOpen = detailDrawer === "trails";
  const documentsOpen = detailDrawer === "documents";
  const t = (value: string) => translateCopy(language, value);
  return (
    <header className="absolute left-0 right-0 top-0 z-30 flex h-12 shrink-0 items-center justify-between bg-card/74 px-4 backdrop-blur-sm">
      <div className="min-w-0">
        <h2 className="truncate text-sm font-medium">{selectedSession.title}</h2>
      </div>
      <div className="flex items-center gap-1.5">
        <Button variant="ghost" size="sm" onClick={onOpenBranches} disabled={busyCommand !== undefined} title={t("Branch candidates")}>
          <GitBranchPlus size={14} />
          <span className="hidden sm:inline">{t("Branches")}</span>
        </Button>
        <Button
          variant={trailsOpen ? "secondary" : "ghost"}
          size="sm"
          onClick={() => onToggleDetailDrawer("trails")}
          title={t("Toggle trails")}
        >
          {trailsOpen ? <Files size={14} /> : <PanelRightOpen size={14} />}
          <span className="hidden sm:inline">{t("Trails")}</span>
        </Button>
        {selectedSession.projectId ? (
          <Button
            variant={documentsOpen ? "secondary" : "ghost"}
            size="sm"
            onClick={() => onToggleDetailDrawer("documents")}
            title={t("Toggle documents")}
          >
            <BookOpenText size={14} />
            <span className="hidden sm:inline">{t("Documents")}</span>
          </Button>
        ) : null}
      </div>
    </header>
  );
}
