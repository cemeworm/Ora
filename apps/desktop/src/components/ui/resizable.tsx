import type { HTMLAttributes } from "react";
import { cn } from "../../lib/utils";

export function ResizablePanelGroup({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex h-full w-full", className)} {...props} />;
}

export function ResizablePanel({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("min-w-0 flex-1", className)} {...props} />;
}

export function ResizableHandle({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("w-px bg-border", className)} {...props} />;
}
