import { Sidebar } from "./Sidebar";
import { useWorkbench } from "../lib/state";
import { SidebarInset, SidebarProvider } from "./ui/sidebar";

export function AppShell({ children }: { children: React.ReactNode }) {
  const { state, dispatch } = useWorkbench();

  return (
    <SidebarProvider
      open={!state.sidebarCollapsed}
      onOpenChange={() => dispatch({ type: "TOGGLE_SIDEBAR" })}
    >
      <Sidebar />
      <SidebarInset className="h-screen min-h-[720px] overflow-hidden antialiased">
        {children}
      </SidebarInset>
    </SidebarProvider>
  );
}
