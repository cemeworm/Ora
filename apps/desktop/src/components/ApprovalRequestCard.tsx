import { AlertTriangle, ShieldCheck, XCircle } from "lucide-react";
import type { ActionRecord } from "../types";
import { cn } from "../lib/utils";
import { Message, MessageContent } from "./ai-elements/message";
import { TaskItem, TaskItemMeta, TaskList, TaskListBody, TaskListHeader } from "./ai-elements/task";

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

  return (
    <Message from="assistant" className="w-full">
      <div className="flex max-w-full gap-3">
        <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-amber-200 bg-amber-50 text-amber-700 shadow-xs">
          <AlertTriangle size={14} />
        </div>
        <div className="min-w-0 flex-1 space-y-3">
          <MessageContent className="w-full gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-medium text-foreground">Approval required</p>
              <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 ring-1 ring-inset ring-amber-200">
                {actions.length} pending gate{actions.length > 1 ? "s" : ""}
              </span>
            </div>
            <p className="text-sm leading-6 text-muted-foreground">
              The runtime paused in the conversation flow and is waiting for your decision before continuing.
            </p>
          </MessageContent>

          <TaskList className="border-amber-200/80 bg-amber-50/40">
            <TaskListHeader className="text-amber-800">
              <span className="font-medium">Pending approval</span>
              <span>{actions.length === 1 ? "Review the blocked stage" : "Review the blocked stages"}</span>
            </TaskListHeader>
            <TaskListBody className="border-amber-200/80">
              {actions.map((action) => (
                <TaskItem key={action.id} className="py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-foreground">{action.label}</p>
                      <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{action.consequence}</p>
                      <TaskItemMeta>
                        <span className="font-mono">agent: {action.agentId ?? "runtime"}</span>
                      </TaskItemMeta>
                    </div>
                    <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset", riskToneClassName(action.risk))}>
                      {action.risk} risk
                    </span>
                  </div>
                </TaskItem>
              ))}
            </TaskListBody>
          </TaskList>

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

function riskToneClassName(risk: ActionRecord["risk"]) {
  switch (risk) {
    case "high":
      return "bg-rose-50 text-rose-700 ring-rose-200";
    case "medium":
      return "bg-amber-100 text-amber-800 ring-amber-300";
    default:
      return "bg-muted text-muted-foreground ring-border";
  }
}
