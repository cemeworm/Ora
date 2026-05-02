import { CheckCircle2, Circle, ListTodo, LoaderCircle } from "lucide-react";
import type { TurnPlanListStep } from "../types";
import { cn } from "../lib/utils";
import { MarkdownContent } from "./MarkdownContent";

interface PlanCardProps {
  planSteps: TurnPlanListStep[];
  planContent?: string;
}

export function PlanCard({ planSteps, planContent }: PlanCardProps) {
  return (
    <div className="rounded-xl border border-border bg-card shadow-lift">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <ListTodo size={16} className="text-primary" />
        <span className="text-sm font-semibold text-foreground">任务计划</span>
        <span className="text-xs text-muted-foreground">
          {planSteps.filter((s) => s.status === "completed").length}/{planSteps.length} 步
        </span>
      </div>
      {planContent ? (
        <div className="px-4 pt-4">
          <MarkdownContent content={planContent} />
        </div>
      ) : null}
      <div className="px-4 py-3">
        <ol className="space-y-2">
          {planSteps.map((item, index) => (
            <li key={index} className="flex items-start gap-3">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border bg-muted/50 text-[11px] font-medium text-muted-foreground">
                {index + 1}
              </span>
              <PlanStepStatusIcon status={item.status} />
              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    "text-sm font-medium",
                    item.status === "completed" && "text-muted-foreground line-through",
                  )}
                >
                  {item.step}
                </p>
                <p className="text-xs text-muted-foreground">
                  {item.status === "in_progress" ? "进行中" : item.status === "completed" ? "已完成" : "待处理"}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function PlanStepStatusIcon({ status }: { status: TurnPlanListStep["status"] }) {
  switch (status) {
    case "completed":
      return <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-600" />;
    case "in_progress":
      return <LoaderCircle size={16} className="mt-0.5 shrink-0 animate-spin text-muted-foreground" />;
    default:
      return <Circle size={16} className="mt-0.5 shrink-0 text-muted-foreground" />;
  }
}
