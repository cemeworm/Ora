import { Check } from "lucide-react";
import * as React from "react";
import { cn } from "../../lib/utils";

export interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
  boxClassName?: string;
}

export const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, boxClassName, disabled, ...props }, ref) => (
    <span className={cn("relative inline-flex h-4 w-4 shrink-0 items-center justify-center", className)}>
      <input
        ref={ref}
        type="checkbox"
        disabled={disabled}
        className="peer sr-only"
        {...props}
      />
      <span
        aria-hidden="true"
        className={cn(
          "flex h-4 w-4 items-center justify-center rounded border border-input bg-background text-transparent shadow-sm transition-[background-color,border-color,box-shadow,transform]",
          "peer-checked:border-bench-900 peer-checked:bg-bench-900 peer-checked:text-white",
          "peer-focus-visible:ring-2 peer-focus-visible:ring-foreground/15 peer-active:scale-95",
          "peer-disabled:cursor-not-allowed peer-disabled:opacity-55",
          boxClassName,
        )}
      >
        <Check size={12} strokeWidth={2.4} />
      </span>
    </span>
  ),
);

Checkbox.displayName = "Checkbox";
