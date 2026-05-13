import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "../../lib/utils";

export function Popover({
  open,
  onOpenChange,
  trigger,
  align = "start",
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: ReactNode;
  align?: "start" | "end";
  children: ReactNode;
}) {
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onOpenChange(false);
      }
    }

    function handleClick(event: MouseEvent) {
      if (
        contentRef.current &&
        !contentRef.current.contains(event.target as Node)
      ) {
        onOpenChange(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    window.setTimeout(() => document.addEventListener("click", handleClick), 0);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("click", handleClick);
    };
  }, [open, onOpenChange]);

  if (!open) return <>{trigger}</>;

  return (
    <div className="relative inline-flex">
      {trigger}
      <div
        ref={contentRef}
        className={cn(
          "absolute top-full z-50 mt-1 rounded-md border border-border bg-popover p-2 text-popover-foreground shadow-lift",
          align === "end" ? "right-0" : "left-0",
        )}
      >
        {children}
      </div>
    </div>
  );
}
