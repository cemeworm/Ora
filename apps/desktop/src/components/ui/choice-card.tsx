import { Check } from "lucide-react";
import type { InputHTMLAttributes, ReactNode } from "react";
import { cn } from "../../lib/utils";

export interface ChoiceCardProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "title"> {
  title: ReactNode;
  description?: ReactNode;
  inputClassName?: string;
}

export function ChoiceCard({
  title,
  description,
  className,
  inputClassName,
  disabled,
  ...props
}: ChoiceCardProps) {
  const checked = Boolean(props.checked);

  return (
    <label
      className={cn(
        "group flex min-h-[4.5rem] cursor-pointer items-start gap-3 rounded-md bg-background px-3 py-2.5 text-left shadow-sm ring-1 ring-inset ring-input transition-[background-color,box-shadow,transform]",
        "hover:bg-muted/45 active:scale-[0.99]",
        checked && "bg-bench-50 shadow-[inset_0_0_0_1px_rgba(23,23,23,0.22),0_1px_2px_rgba(23,23,23,0.05)] ring-bench-300",
        disabled && "cursor-not-allowed opacity-60 hover:bg-background active:scale-100",
        className,
      )}
    >
      <span className="relative mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center">
        <input
          type="checkbox"
          disabled={disabled}
          className={cn("peer sr-only", inputClassName)}
          {...props}
        />
        <span
          aria-hidden="true"
          className="flex h-4 w-4 items-center justify-center rounded border border-input bg-background text-transparent shadow-sm transition-[background-color,border-color,box-shadow,transform] peer-checked:border-bench-900 peer-checked:bg-bench-900 peer-checked:text-white peer-focus-visible:ring-2 peer-focus-visible:ring-foreground/15 peer-active:scale-95"
        >
          <Check size={12} strokeWidth={2.4} />
        </span>
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold leading-5 text-bench-900">{title}</span>
        {description ? <span className="mt-1 block text-xs leading-5 text-bench-700">{description}</span> : null}
      </span>
    </label>
  );
}
