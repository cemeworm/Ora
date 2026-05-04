const STATUS_COLORS: Record<string, string> = {
  running: "bg-amber-100 text-amber-800 ring-1 ring-inset ring-amber-300",
  done: "bg-emerald-100 text-emerald-800 ring-1 ring-inset ring-emerald-300",
  failed: "bg-red-100 text-red-800 ring-1 ring-inset ring-red-300",
  cancelled: "bg-bench-100 text-bench-700 ring-1 ring-inset ring-bench-200",
  paused: "bg-bench-100 text-bench-700 ring-1 ring-inset ring-bench-200",
  blocked: "bg-amber-100 text-amber-800 ring-1 ring-inset ring-amber-300",
  idle: "bg-bench-100 text-bench-700 ring-1 ring-inset ring-bench-200",
  approval_required: "bg-amber-100 text-amber-800 ring-1 ring-inset ring-amber-300",
  clarification_required: "bg-blue-100 text-blue-800 ring-1 ring-inset ring-blue-300",
  queued: "bg-bench-100 text-bench-700 ring-1 ring-inset ring-bench-200",
  succeeded: "bg-emerald-100 text-emerald-800 ring-1 ring-inset ring-emerald-300",
  proposed: "bg-bench-100 text-bench-700 ring-1 ring-inset ring-bench-200",
  checkpointed: "bg-emerald-100 text-emerald-800 ring-1 ring-inset ring-emerald-300",
  decision_needed: "bg-purple-100 text-purple-800 ring-1 ring-inset ring-purple-300",
};

const SIZE_CLASSES: Record<string, string> = {
  sm: "px-1.5 py-0.5 text-[10px]",
  md: "px-2 py-0.5 text-[11px]",
};

export function StatusBadge({ status, size = "md" }: { status: string; size?: "sm" | "md" }) {
  const colorClass = STATUS_COLORS[status] ?? STATUS_COLORS["idle"];
  const sizeClass = SIZE_CLASSES[size] ?? SIZE_CLASSES["md"];

  return (
    <span className={`inline-flex shrink-0 items-center rounded-full font-semibold ${colorClass} ${sizeClass}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}
