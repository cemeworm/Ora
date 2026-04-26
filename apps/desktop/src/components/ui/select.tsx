import { ChevronDown } from "lucide-react";
import * as React from "react";
import { cn } from "../../lib/utils";

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  wrapperClassName?: string;
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, wrapperClassName, disabled, children, ...props }, ref) => (
    <span className={cn("relative block", wrapperClassName)}>
      <select
        ref={ref}
        disabled={disabled}
        className={cn(
          "h-10 w-full appearance-none rounded-md border border-input bg-background px-3 py-2 pr-9 text-sm text-foreground shadow-sm transition-[background-color,box-shadow,border-color,transform]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/15",
          "enabled:hover:bg-muted/45 enabled:active:scale-[0.99]",
          "disabled:cursor-not-allowed disabled:opacity-60",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden="true"
        size={15}
        className={cn(
          "pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground",
          disabled && "opacity-60",
        )}
      />
    </span>
  ),
);

Select.displayName = "Select";
