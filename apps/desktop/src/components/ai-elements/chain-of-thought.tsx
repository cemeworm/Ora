import type { HTMLAttributes, ReactNode } from "react";
import { Brain, ChevronDown } from "lucide-react";
import { cn } from "../../lib/utils";

export function ChainOfThought({
  className,
  defaultOpen = false,
  children,
  ...props
}: HTMLAttributes<HTMLDetailsElement> & { defaultOpen?: boolean }) {
  return (
    <details className={cn("group rounded-[22px] border border-border bg-background/90", className)} open={defaultOpen} {...props}>
      {children}
    </details>
  );
}

export function ChainOfThoughtHeader({
  className,
  children,
  icon,
  ...props
}: HTMLAttributes<HTMLElement> & { icon?: ReactNode }) {
  return (
    <summary
      className={cn(
        "flex list-none cursor-pointer items-center justify-between gap-3 px-4 py-3 text-sm font-medium text-foreground marker:hidden",
        className,
      )}
      {...props}
    >
      <span className="flex min-w-0 items-center gap-2">
        <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border bg-muted text-muted-foreground">
          {icon ?? <Brain size={13} />}
        </span>
        <span className="truncate">{children}</span>
      </span>
      <ChevronDown size={16} className="shrink-0 text-muted-foreground transition group-open:rotate-180" />
    </summary>
  );
}

export function ChainOfThoughtContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("border-t border-border px-4 py-3", className)} {...props} />;
}

export function ChainOfThoughtStep({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("grid gap-2 py-2 first:pt-0 last:pb-0", className)} {...props} />;
}
