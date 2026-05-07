import { useEffect, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  Circle,
  ListTodo,
  LoaderCircle,
} from "lucide-react";
import type { TurnPlanListStep } from "../types";
import { cn } from "../lib/utils";
import {
  TaskItem,
  TaskItemMeta,
  TaskList,
  TaskListBody,
  TaskListHeader,
} from "./ai-elements/task";

interface PlanStepsTrayProps {
  planSteps: TurnPlanListStep[];
}

export function PlanStepsTray({ planSteps }: PlanStepsTrayProps) {
  const [open, setOpen] = useState(true);

  useEffect(() => {
    if (planSteps.length > 0) {
      setOpen(true);
    }
  }, [planSteps.length]);

  useEffect(() => {
    if (
      planSteps.length > 0 &&
      planSteps.every((s) => s.status === "completed")
    ) {
      setOpen(false);
    }
  }, [planSteps]);

  if (planSteps.length === 0) return null;

  const done = planSteps.filter((s) => s.status === "completed").length;
  const title = `计划 ${done}/${planSteps.length}`;

  return (
    <div className="mb-2 rounded-2xl border border-border bg-muted/40 backdrop-blur-sm">
      <TaskList className="border-0 bg-transparent shadow-none">
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          className="w-full text-left"
        >
          <TaskListHeader>
            <div className="flex min-w-0 items-center gap-2">
              <ListTodo size={14} />
              <span className="font-medium text-foreground">{title}</span>
              <span className="truncate text-xs text-muted-foreground">
                {planSummary(planSteps)}
              </span>
            </div>
            <ChevronDown
              size={14}
              className={cn("transition-transform", open && "rotate-180")}
            />
          </TaskListHeader>
        </button>
        {open ? (
          <TaskListBody>
            {planSteps.map((item, index) => (
              <PlanListStepItem key={index} item={item} />
            ))}
          </TaskListBody>
        ) : null}
      </TaskList>
    </div>
  );
}

function PlanListStepItem({ item }: { item: TurnPlanListStep }) {
  return (
    <TaskItem className="flex items-start gap-3">
      <PlanStepStatusIcon status={item.status} />
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "font-medium",
            item.status === "completed" && "text-muted-foreground line-through",
          )}
        >
          {item.step}
        </p>
        <TaskItemMeta>
          <span>
            {item.status === "in_progress"
              ? "进行中"
              : item.status === "completed"
                ? "已完成"
                : "待处理"}
          </span>
        </TaskItemMeta>
      </div>
    </TaskItem>
  );
}

function PlanStepStatusIcon({
  status,
}: {
  status: TurnPlanListStep["status"];
}) {
  switch (status) {
    case "completed":
      return (
        <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-600" />
      );
    case "in_progress":
      return (
        <LoaderCircle
          size={16}
          className="mt-0.5 shrink-0 animate-spin text-muted-foreground"
        />
      );
    default:
      return (
        <Circle size={16} className="mt-0.5 shrink-0 text-muted-foreground" />
      );
  }
}

function planSummary(items: TurnPlanListStep[]) {
  const done = items.filter((s) => s.status === "completed").length;
  const active = items.find((s) => s.status === "in_progress");
  if (active) {
    return `正在进行 - ${active.step}`;
  }
  return ``;
}
