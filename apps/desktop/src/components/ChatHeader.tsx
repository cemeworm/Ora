import { PanelRightOpen } from "lucide-react";
import { Button } from "./ui/button";
import type { SessionRun } from "../types";
import { translateCopy, type AppLanguage } from "../lib/i18n";
import type { RightWorkspaceSessionState } from "../lib/state";

interface ChatHeaderProps {
  busyCommand?: string;
  selectedSession: SessionRun;
  selectedWorkspace: RightWorkspaceSessionState;
  onSetRightWorkspaceOpen: (open: boolean) => void;
  language: AppLanguage;
}

export function ChatHeader({
  busyCommand,
  selectedSession,
  selectedWorkspace,
  onSetRightWorkspaceOpen,
  language,
}: ChatHeaderProps) {
  const t = (value: string) => translateCopy(language, value);

  return (
    <header className="absolute left-0 right-0 top-0 z-30 flex h-12 shrink-0 items-center justify-between bg-card/74 px-4 backdrop-blur-sm">
      <div className="min-w-0">
        <h2 className="truncate text-sm font-medium">{selectedSession.title}</h2>
        {busyCommand ? <p className="truncate text-[11px] text-muted-foreground">{busyCommand}</p> : null}
      </div>
      <div className="flex items-center gap-1.5">
        <Button
          variant={selectedWorkspace.open ? "secondary" : "ghost"}
          size="icon"
          title={t("Open right workspace")}
          aria-label={t("Open right workspace")}
          onClick={() => onSetRightWorkspaceOpen(!selectedWorkspace.open)}
        >
          <PanelRightOpen size={15} />
        </Button>
      </div>
    </header>
  );
}
