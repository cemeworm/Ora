import { createContext, useContext, type ReactNode } from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { cn } from "../../lib/utils";
import { Button } from "./button";

interface SidebarContextValue {
  open: boolean;
  toggleSidebar: () => void;
}

const SidebarContext = createContext<SidebarContextValue | null>(null);

export function SidebarProvider({ open, onOpenChange, children }: { open: boolean; onOpenChange: (open: boolean) => void; children: ReactNode }) {
  return (
    <SidebarContext.Provider value={{ open, toggleSidebar: () => onOpenChange(!open) }}>
      <div className="group/sidebar-wrapper flex min-h-screen w-full bg-background text-foreground">{children}</div>
    </SidebarContext.Provider>
  );
}

export function useSidebar() {
  const context = useContext(SidebarContext);
  if (!context) {
    throw new Error("useSidebar must be used within SidebarProvider.");
  }
  return context;
}

export function SidebarInset({ className, children }: { className?: string; children: ReactNode }) {
  return <main className={cn("min-w-0 flex-1 bg-background text-foreground", className)}>{children}</main>;
}

export function SidebarTrigger({ className }: { className?: string }) {
  const { open, toggleSidebar } = useSidebar();
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      className={cn("text-muted-foreground hover:text-foreground", className)}
      onClick={toggleSidebar}
      title={open ? "Collapse sidebar" : "Expand sidebar"}
    >
      {open ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
    </Button>
  );
}
