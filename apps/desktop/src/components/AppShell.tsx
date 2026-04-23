import { Sidebar } from "./Sidebar";
import { useWorkbench } from "../lib/state";

export function AppShell({ children }: { children: React.ReactNode }) {
  const { state } = useWorkbench();

  return (
    <div className="flex h-screen min-h-[760px] bg-bench-100 text-bench-900 antialiased">
      <Sidebar />
      <main
        className="min-w-0 flex-1 transition-all duration-200"
        style={{ marginLeft: state.sidebarCollapsed ? 0 : 0 }}
      >
        {children}
      </main>
    </div>
  );
}
