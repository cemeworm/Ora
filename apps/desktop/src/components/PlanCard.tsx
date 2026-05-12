import { CheckCircle2, Circle, ListTodo, LoaderCircle } from "lucide-react";
import type { TurnPlanListStep } from "../types";
import { cn } from "../lib/utils";
import { MarkdownContent } from "./MarkdownContent";

interface PlanCardProps {
  planSteps: TurnPlanListStep[];
  planContent?: string;
  isStreaming?: boolean;
}

export function PlanCard({ planSteps, planContent, isStreaming = false }: PlanCardProps) {
  return (
    <div className="space-y-2 rounded-2xl border border-border bg-card/96 px-4 py-3 shadow-lift backdrop-blur-sm transition-[background-color,border-color,box-shadow] duration-300">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <ListTodo size={16} className="text-muted-foreground" />
        <span className="font-medium text-foreground">任务计划</span>
        {planSteps.length > 0 ? (
          <span className="text-xs text-muted-foreground">
            {planSteps.filter((s) => s.status === "completed").length}/{planSteps.length} 步
          </span>
        ) : null}
        {isStreaming ? (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <LoaderCircle size={12} className="animate-spin" />
            正在生成
          </span>
        ) : null}
      </div>
      {planContent ? (
        <div>
          {isStreaming ? (
            <pre className="max-w-full whitespace-pre-wrap break-words font-sans text-sm leading-6 text-foreground">
              {planContent}
            </pre>
          ) : (
            <MarkdownContent
              content={planContent}
              className="text-sm leading-6 text-foreground [&_h1]:mb-2 [&_h1]:mt-3 [&_h1]:text-base [&_h1]:leading-6 [&_h2]:mb-1.5 [&_h2]:mt-3 [&_h2]:text-sm [&_h2]:leading-6 [&_h3]:mb-1 [&_h3]:mt-2.5 [&_h3]:text-sm [&_h3]:leading-6 [&_ol]:my-1.5 [&_p]:my-1.5 [&_ul]:my-1.5"
            />
          )}
        </div>
      ) : isStreaming ? (
        <p className="text-sm text-muted-foreground">正在生成计划内容...</p>
      ) : null}
      {planSteps.length > 0 ? (
        <div className="border-l border-border/80 pl-4">
          <ol className="space-y-2">
            {planSteps.map((item, index) => (
              <li key={index} className="relative flex items-start gap-3 py-1">
                <span className="absolute -left-[1.05rem] top-3 h-2 w-2 rounded-full bg-border" />
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
      ) : null}
    </div>
  );
}

function PlanStepStatusIcon({ status }: { status: TurnPlanListStep["status"] }) {
  switch (status) {
    case "completed":
      return <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-muted-foreground" />;
    case "in_progress":
      return <LoaderCircle size={16} className="mt-0.5 shrink-0 animate-spin text-muted-foreground" />;
    default:
      return <Circle size={16} className="mt-0.5 shrink-0 text-muted-foreground" />;
  }
}
