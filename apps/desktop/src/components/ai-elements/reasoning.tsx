import type { HTMLAttributes, ReactNode } from "react";
import { Brain } from "lucide-react";
import { cn } from "../../lib/utils";

export function Reasoning({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-lg border border-border bg-muted/60 p-3 text-sm", className)} {...props} />;
}

export function ReasoningTrigger({ children = "Reasoning" }: { children?: ReactNode }) {
  return (
    <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
      <Brain size={14} />
      {children}
    </div>
  );
}

export function ReasoningContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("whitespace-pre-wrap text-muted-foreground", className)} {...props} />;
}
