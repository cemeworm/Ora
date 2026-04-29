import { AlertTriangle, ShieldCheck, XCircle } from "lucide-react";
import type { ActionRecord } from "../types";

interface ApprovalRequestCardProps {
  actions: ActionRecord[];
  onResume: () => void;
  onCancel: () => void;
  disabled?: boolean;
}

export function ApprovalRequestCard({ actions, onResume, onCancel, disabled }: ApprovalRequestCardProps) {
  if (actions.length === 0) {
    return null;
  }

  const primaryRequest = approvalCopy(actions[0]!);
  const isSingleAction = actions.length === 1;
  return (
    <div
      role="status"
      aria-live="polite"
      className="rounded-2xl border border-amber-200 bg-amber-50/80 px-3 py-2.5 text-amber-950 shadow-[0_1px_2px_rgba(120,53,15,0.08)]"
    >
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-amber-200 bg-amber-100 text-amber-700">
            <AlertTriangle size={15} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <p className="truncate text-sm font-medium text-foreground">
                {isSingleAction ? primaryRequest.title : "Your confirmation is needed"}
              </p>
              <span className="shrink-0 rounded-full border border-amber-200 bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">
                Waiting for approval
              </span>
              {!isSingleAction ? (
                <span className="shrink-0 rounded-full border border-amber-200 bg-background/70 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                  More actions pending
                </span>
              ) : null}
            </div>
            <p className="mt-0.5 truncate text-sm leading-5 text-muted-foreground">
              {isSingleAction
                ? primaryRequest.summary
                : "I need your confirmation for these actions before I continue."}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 self-start md:self-auto">
          <button
            type="button"
            onClick={onResume}
            disabled={disabled}
            className="inline-flex h-8 items-center justify-center gap-1.5 rounded-full bg-signal-amber px-3 text-xs font-semibold text-bench-900 transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <ShieldCheck size={14} />
            {primaryRequest.confirmLabel ?? "Approve and continue"}
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={disabled}
            className="inline-flex h-8 items-center justify-center gap-1.5 rounded-full border border-amber-200 bg-background/70 px-3 text-xs font-semibold text-foreground transition hover:bg-background active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <XCircle size={14} />
            Cancel run
          </button>
        </div>
      </div>
    </div>
  );
}

function approvalCopy(action: ActionRecord) {
  return action.approvalRequest ?? {
    title: "Confirm before continuing",
    summary: action.consequence,
    whatWillChange: "This action may change the local environment.",
    whyNeeded: "It is needed to continue the current task.",
    riskNote: "Confirm this matches your expectations before continuing.",
    confirmLabel: "Approve and continue",
  };
}
