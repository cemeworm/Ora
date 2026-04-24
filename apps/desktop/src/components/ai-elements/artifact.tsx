import type { HTMLAttributes } from "react";
import { cn } from "../../lib/utils";

export function Artifact({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("overflow-hidden rounded-2xl border border-border bg-background shadow-xs", className)} {...props} />;
}

export function ArtifactHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex items-center justify-between gap-3 border-b border-border bg-muted/35 px-4 py-3", className)} {...props} />;
}

export function ArtifactTitle({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("text-sm font-medium text-foreground", className)} {...props} />;
}

export function ArtifactDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-xs text-muted-foreground", className)} {...props} />;
}

export function ArtifactActions({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex items-center gap-2", className)} {...props} />;
}

export function ArtifactContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-4 py-3", className)} {...props} />;
}
