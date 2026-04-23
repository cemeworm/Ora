import { useEffect, type HTMLAttributes, type MouseEvent, type ReactNode } from "react";
import { cn } from "../../lib/utils";

export function Dialog({ open, onOpenChange, children }: { open: boolean; onOpenChange?: (open: boolean) => void; children: ReactNode }) {
  useEffect(() => {
    if (!open) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onOpenChange?.(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onOpenChange]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4 backdrop-blur-[2px]"
      onClick={() => onOpenChange?.(false)}
    >
      {children}
    </div>
  );
}

export function DialogContent({ className, onClick, ...props }: HTMLAttributes<HTMLDivElement>) {
  function handleClick(event: MouseEvent<HTMLDivElement>) {
    event.stopPropagation();
    onClick?.(event);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className={cn("rounded-lg border border-border bg-background p-5 shadow-lift", className)}
      onClick={handleClick}
      {...props}
    />
  );
}

export function DialogHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mb-4 space-y-1.5", className)} {...props} />;
}

export function DialogTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn("text-lg font-semibold", className)} {...props} />;
}

export function DialogFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mt-4 flex justify-end gap-2", className)} {...props} />;
}
