import type { RunStatus } from "../types";

const statusLabels: Record<RunStatus, string> = {
  running: "Running",
  approval_required: "Approval",
  checkpointed: "Checkpoint",
  done: "Done",
  failed: "Failed",
};

export { statusLabels };

export function StatusPill({ status }: { status: RunStatus }) {
  const attention = status === "running" || status === "approval_required";
  return (
    <span
      className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
        attention ? "bg-amber-50 text-bench-900 ring-1 ring-inset ring-amber-200" : "bg-bench-100 text-bench-700"
      }`}
    >
      {statusLabels[status]}
    </span>
  );
}
