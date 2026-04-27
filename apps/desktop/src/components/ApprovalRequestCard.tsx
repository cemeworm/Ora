import { AlertTriangle, ShieldCheck, XCircle } from "lucide-react";
import type { ActionRecord } from "../types";
import { Message, MessageContent } from "./ai-elements/message";

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
    <Message from="assistant" className="w-full">
      <div className="flex max-w-full gap-3">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-amber-200 bg-amber-50 text-amber-700 shadow-xs">
          <AlertTriangle size={14} />
        </div>
        <div className="min-w-0 flex-1 space-y-3">
          <MessageContent className="w-full gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-medium text-foreground">{isSingleAction ? primaryRequest.title : "Your confirmation is needed"}</p>
            </div>
            <p className="text-sm leading-6 text-muted-foreground">
              {isSingleAction
                ? primaryRequest.summary
                : "I need your confirmation for the actions below before I continue."}
            </p>
          </MessageContent>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={onResume}
              disabled={disabled}
              className="inline-flex items-center justify-center gap-2 rounded-full bg-signal-amber px-4 py-2 text-sm font-semibold text-bench-900 transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <ShieldCheck size={15} />
              Approve and continue
            </button>
            <button
              type="button"
              onClick={onCancel}
              disabled={disabled}
              className="inline-flex items-center justify-center gap-2 rounded-full border border-border bg-background px-4 py-2 text-sm font-semibold text-foreground transition hover:bg-muted/60 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <XCircle size={15} />
              Cancel run
            </button>
          </div>
        </div>
      </div>
    </Message>
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
