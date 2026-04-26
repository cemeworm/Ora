import type { ReactNode } from "react";
import { cn } from "../../lib/utils";

export function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("grid gap-1.5", className)}>
      <div className="text-xs font-semibold uppercase tracking-[0.08em] text-bench-700">{label}</div>
      {children}
      {hint ? <p className="text-xs leading-5 text-bench-700">{hint}</p> : null}
      {error ? <p className="text-xs leading-5 text-red-700">{error}</p> : null}
    </div>
  );
}
