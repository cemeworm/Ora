import { useState } from "react";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { StatusBadge } from "./StatusBadge";
import { Button } from "./ui/button";
import type { ActionRecord, AgentProfile, PlanItem } from "../types";

interface AgentCardProps {
  agent?: AgentProfile;
  content: string;
  eventType: string;
  actions: ActionRecord[];
  planItems: PlanItem[];
  isApprovalRequired: boolean;
  onResumeRun: () => void;
  onCancelRun: () => void;
  busyCommand?: string;
}

export function AgentCard({
  agent,
  content,
  eventType,
  actions,
  planItems,
  isApprovalRequired,
  onResumeRun,
  onCancelRun,
  busyCommand,
}: AgentCardProps) {
  const [expanded, setExpanded] = useState(false);

  const pendingActions = actions.filter((a) => a.state === "approval_required");
  const hasDetails = actions.length > 0 || planItems.length > 0;

  const eventLabel = eventType === "plan.updated" ? "Plan" : eventType === "action.updated" ? "Action" : "Approval";

  return (
    <div className="rounded-lg border border-border bg-background/80 shadow-xs backdrop-blur">
      <button
        onClick={() => hasDetails && setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-4 py-3 text-left"
      >
        {hasDetails ? (
          expanded ? <ChevronDown size={14} className="shrink-0 text-muted-foreground" /> : <ChevronRight size={14} className="shrink-0 text-muted-foreground" />
        ) : (
          <span className="w-3.5 shrink-0" />
        )}
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            {agent?.label ?? eventLabel}
          </span>
          <p className="truncate text-xs text-muted-foreground">{content}</p>
        </div>
        {pendingActions.length > 0 && (
          <span className="shrink-0 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-foreground">
            {pendingActions.length} pending
          </span>
        )}
      </button>

      {expanded && hasDetails && (
        <div className="space-y-3 border-t border-border px-4 py-3">
          {planItems.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Plan Items</p>
              {planItems.map((item) => (
                <div key={item.id} className="flex items-center gap-2 text-xs">
                  <StatusBadge status={item.status} size="sm" />
                  <span className="truncate">{item.title}</span>
                </div>
              ))}
            </div>
          )}
          {actions.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Actions</p>
              {actions.map((action) => (
                <div key={action.id} className="flex items-start justify-between gap-2 text-xs">
                  <div className="flex items-center gap-2">
                    <StatusBadge status={action.state} size="sm" />
                    <span className="truncate">{action.label}</span>
                  </div>
                  <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                    action.risk === "high" ? "bg-red-100 text-red-800" : action.risk === "medium" ? "bg-amber-100 text-amber-800" : "bg-muted text-muted-foreground"
                  }`}>
                    {action.risk}
                  </span>
                </div>
              ))}
            </div>
          )}
          {pendingActions.length > 0 && isApprovalRequired && (
            <div className="flex gap-2 pt-1">
              <Button
                onClick={onResumeRun}
                disabled={busyCommand !== undefined}
                size="sm"
                variant="default"
              >
                {busyCommand ? <Loader2 size={13} className="animate-spin" /> : null}
                Approve
              </Button>
              <Button
                onClick={onCancelRun}
                disabled={busyCommand !== undefined}
                size="sm"
                variant="outline"
              >
                Deny
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
