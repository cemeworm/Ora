import type { HTMLAttributes } from "react";
import { cn } from "../../lib/utils";

export function TaskList({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("space-y-2 rounded-2xl border border-border bg-muted/20 px-4 py-3", className)} {...props} />;
}

export function TaskListHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex items-center justify-between gap-3 text-sm text-muted-foreground", className)} {...props} />;
}

export function TaskListBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mt-3 border-l border-border/80 pl-4", className)} {...props} />;
}

export function TaskItem({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("py-2 text-sm", className)} {...props} />;
}

export function TaskItemMeta({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground", className)} {...props} />;
}
