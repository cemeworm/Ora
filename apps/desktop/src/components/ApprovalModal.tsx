import { AlertTriangle, ShieldCheck } from "lucide-react";
import type { ActionRecord } from "../types";

interface ApprovalModalProps {
  action: ActionRecord;
  onResume: () => void;
  onCancel: () => void;
  disabled?: boolean;
}

export function ApprovalModal({ action, onResume, onCancel, disabled }: ApprovalModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="mx-4 w-full max-w-lg rounded-xl bg-white p-6 shadow-lift ring-1 ring-inset ring-bench-200">
        <div className="flex items-start gap-3">
          <div className="rounded-md bg-amber-50 p-2 text-signal-amber ring-1 ring-inset ring-amber-200">
            <AlertTriangle size={20} />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-lg font-semibold">Approval Required</h3>
            <p className="mt-1 text-sm text-bench-700">
              The runtime paused execution and is waiting for your decision.
            </p>
          </div>
        </div>

        <div className="mt-5 space-y-3 rounded-lg bg-bench-50 p-4 ring-1 ring-inset ring-bench-200">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold">{action.label}</p>
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                action.risk === "high"
                  ? "bg-red-100 text-red-800 ring-1 ring-inset ring-red-300"
                  : action.risk === "medium"
                    ? "bg-amber-100 text-amber-800 ring-1 ring-inset ring-amber-300"
                    : "bg-bench-100 text-bench-700 ring-1 ring-inset ring-bench-200"
              }`}
            >
              {action.risk} risk
            </span>
          </div>
          <p className="text-xs leading-5 text-bench-700">{action.consequence}</p>
          <div className="flex items-center gap-2 text-[11px] text-bench-700">
            <span className="font-mono">agent: {action.agentId ?? "runtime"}</span>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3">
          <button
            onClick={onResume}
            disabled={disabled}
            className="inline-flex items-center justify-center gap-2 rounded-md bg-signal-amber px-4 py-2.5 text-sm font-semibold text-bench-900 transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <ShieldCheck size={16} />
            Approve
          </button>
          <button
            onClick={onCancel}
            disabled={disabled}
            className="inline-flex items-center justify-center gap-2 rounded-md border border-bench-200 bg-white px-4 py-2.5 text-sm font-semibold transition hover:bg-bench-50 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Deny
          </button>
        </div>
      </div>
    </div>
  );
}
