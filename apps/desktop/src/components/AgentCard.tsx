import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { StatusBadge } from "./StatusBadge";
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
    <div className="rounded-lg border border-bench-200 bg-white shadow-sm">
      <button
        onClick={() => hasDetails && setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-4 py-2.5 text-left"
      >
        {hasDetails ? (
          expanded ? <ChevronDown size={14} className="text-bench-700 shrink-0" /> : <ChevronRight size={14} className="text-bench-700 shrink-0" />
        ) : (
          <span className="w-3.5 shrink-0" />
        )}
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className="rounded-full bg-bench-100 px-2 py-0.5 text-[11px] font-semibold text-bench-700 ring-1 ring-inset ring-bench-200">
            {agent?.label ?? eventLabel}
          </span>
          <p className="truncate text-xs text-bench-700">{content}</p>
        </div>
        {pendingActions.length > 0 && (
          <span className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-bench-900 ring-1 ring-inset ring-amber-200">
            {pendingActions.length} pending
          </span>
        )}
      </button>

      {expanded && hasDetails && (
        <div className="border-t border-bench-200 px-4 py-3 space-y-2">
          {planItems.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[11px] font-semibold text-bench-700 uppercase tracking-wider">Plan Items</p>
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
              <p className="text-[11px] font-semibold text-bench-700 uppercase tracking-wider">Actions</p>
              {actions.map((action) => (
                <div key={action.id} className="flex items-start justify-between gap-2 text-xs">
                  <div className="flex items-center gap-2">
                    <StatusBadge status={action.state} size="sm" />
                    <span className="truncate">{action.label}</span>
                  </div>
                  <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                    action.risk === "high" ? "bg-red-100 text-red-800" : action.risk === "medium" ? "bg-amber-100 text-amber-800" : "bg-bench-100 text-bench-700"
                  }`}>
                    {action.risk}
                  </span>
                </div>
              ))}
            </div>
          )}
          {pendingActions.length > 0 && isApprovalRequired && (
            <div className="flex gap-2 pt-1">
              <button
                onClick={onResumeRun}
                disabled={busyCommand !== undefined}
                className="rounded-md bg-signal-amber px-3 py-1.5 text-xs font-semibold text-bench-900 transition active:scale-95 disabled:opacity-60"
              >
                Approve
              </button>
              <button
                onClick={onCancelRun}
                disabled={busyCommand !== undefined}
                className="rounded-md border border-bench-200 bg-white px-3 py-1.5 text-xs font-semibold transition active:scale-95 disabled:opacity-60"
              >
                Deny
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
