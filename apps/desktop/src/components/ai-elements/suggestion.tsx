import type { ButtonHTMLAttributes, HTMLAttributes } from "react";
import { cn } from "../../lib/utils";

export function Suggestions({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-wrap items-center justify-center gap-2", className)} {...props} />;
}

export function Suggestion({ className, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn("rounded-full border border-border bg-background px-4 py-2 text-xs text-muted-foreground transition hover:bg-accent hover:text-accent-foreground", className)}
      {...props}
    />
  );
}
