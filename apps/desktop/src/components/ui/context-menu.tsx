import { type ReactNode, useEffect, useRef } from "react";
import { cn } from "../../lib/utils";

export interface ContextMenuItem {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
}

interface ContextMenuProps {
  open: boolean;
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

export function ContextMenu({ open, x, y, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
      }
    }

    // Delay listener registration to avoid the same right-click event
    // from immediately closing the menu
    const timer = setTimeout(() => {
      document.addEventListener("click", handleClick);
      document.addEventListener("keydown", handleKeyDown);
    }, 0);

    return () => {
      clearTimeout(timer);
      document.removeEventListener("click", handleClick);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onClose]);

  if (!open || items.length === 0) return null;

  return (
    <div
      ref={ref}
      className={cn(
        "fixed z-50 min-w-[160px] rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lift",
      )}
      style={{ left: x, top: y }}
      role="menu"
    >
      {items.map((item, index) => (
        <button
          key={index}
          type="button"
          className={cn(
            "flex w-full items-center gap-2 rounded-sm px-3 py-1.5 text-sm",
            "hover:bg-accent hover:text-accent-foreground",
            "focus:bg-accent focus:text-accent-foreground focus:outline-none",
          )}
          onClick={() => {
            item.onClick();
            onClose();
          }}
          role="menuitem"
        >
          {item.icon}
          {item.label}
        </button>
      ))}
    </div>
  );
}
