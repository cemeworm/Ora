import { LayoutDashboard, SquareLibrary } from "lucide-react";
import type { ReactNode } from "react";
import { PageHeader } from "./PageHeader";
import { cn } from "../lib/utils";
import type { AppView } from "../types";

interface SpaceFrameProps {
  activeView: Extract<AppView, "space-dashboard" | "space-library">;
  onSelectView: (view: Extract<AppView, "space-dashboard" | "space-library">) => void;
  children: ReactNode;
}

export function SpaceFrame({ activeView, onSelectView, children }: SpaceFrameProps) {
  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-transparent">
      <PageHeader
        title="空间"
        actions={(
          <div className="grid grid-cols-2 gap-1 rounded-md border border-border/70 bg-background/70 p-1">
            <SpaceTabButton
              active={activeView === "space-dashboard"}
              icon={<LayoutDashboard size={14} />}
              label="工作台"
              onClick={() => onSelectView("space-dashboard")}
            />
            <SpaceTabButton
              active={activeView === "space-library"}
              icon={<SquareLibrary size={14} />}
              label="组件库"
              onClick={() => onSelectView("space-library")}
            />
          </div>
        )}
      />
      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
    </div>
  );
}

function SpaceTabButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-8 items-center justify-center gap-1.5 rounded-md px-3 text-[13px] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/15 active:scale-[0.98]",
        active
          ? "bg-foreground text-background shadow-xs"
          : "text-muted-foreground hover:bg-card hover:text-foreground",
      )}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
