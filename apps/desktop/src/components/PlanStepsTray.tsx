import { useEffect, useMemo, useRef, useState } from "react";
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
  variant?: "inline" | "floating";
}

export const FLOATING_OVERLAY_PANEL_CLASS =
  "rounded-3xl border border-border/70 bg-background/92 p-3 shadow-lift backdrop-blur-md";
export const FLOATING_OVERLAY_ICON_PLATE_CLASS =
  "flex h-8 w-8 items-center justify-center rounded-2xl bg-muted/50 text-foreground";
export const FLOATING_OVERLAY_CARD_CLASS =
  "rounded-2xl border border-border/70 bg-muted/30 p-2.5 backdrop-blur-sm";
export const FLOATING_OVERLAY_DETAIL_CLASS =
  "mt-2 max-h-[min(72vh,42rem)] overflow-y-auto rounded-[1rem] border border-border/60 bg-muted/25 p-2 overscroll-contain backdrop-blur-sm";
export const FLOATING_OVERLAY_BADGE_BASE_CLASS =
  "shrink-0 rounded-full border border-border/60 px-2 py-0.5 text-[11px] font-medium";

export function planStepsTrayRootClassName(
  variant: "inline" | "floating",
) {
  return variant === "floating"
    ? FLOATING_OVERLAY_PANEL_CLASS
    : "mb-2 rounded-2xl border border-border bg-muted/40 backdrop-blur-sm";
}

export const PLAN_STEPS_TRAY_HEADER_TITLE_ROW_CLASS =
  "flex min-w-0 flex-1 items-center gap-2 overflow-hidden";
export const PLAN_STEPS_TRAY_HEADER_SUMMARY_CLASS =
  "min-w-0 flex-1 truncate whitespace-nowrap text-xs text-muted-foreground";
export const PLAN_STEPS_TRAY_HEADER_CHEVRON_CLASS = "shrink-0 transition-transform";
export const PLAN_STEP_TEXT_CLASS =
  "text-sm font-medium leading-6 break-words [overflow-wrap:anywhere]";

export function PlanStepsTray({
  planSteps,
  variant = "inline",
}: PlanStepsTrayProps) {
  const [open, setOpen] = useState(true);
  const planIdentity = useMemo(() => planStepsIdentity(planSteps), [planSteps]);
  const previousPlanIdentity = useRef<string>("");
  const previousAllCompleted = useRef(false);

  useEffect(() => {
    const nextAllCompleted = planStepsAreAllCompleted(planSteps);
    const nextOpen = nextPlanTrayOpenState({
      currentOpen: open,
      planSteps,
      previousPlanIdentity: previousPlanIdentity.current,
      nextPlanIdentity: planIdentity,
      previousAllCompleted: previousAllCompleted.current,
    });

    previousPlanIdentity.current = planIdentity;
    previousAllCompleted.current = nextAllCompleted;

    if (nextOpen !== open) {
      setOpen(nextOpen);
    }
  }, [open, planIdentity, planSteps]);

  if (planSteps.length === 0) return null;

  const done = planSteps.filter((s) => s.status === "completed").length;
  const title = `计划 ${done}/${planSteps.length}`;

  return (
    <div className={planStepsTrayRootClassName(variant)}>
      <TaskList className="border-0 bg-transparent shadow-none">
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          className="w-full text-left"
        >
          <TaskListHeader>
            <div className={PLAN_STEPS_TRAY_HEADER_TITLE_ROW_CLASS}>
              <ListTodo size={14} />
              <span className="shrink-0 font-medium text-foreground">{title}</span>
              <span className={PLAN_STEPS_TRAY_HEADER_SUMMARY_CLASS}>
                {planSummary(planSteps)}
              </span>
            </div>
            <ChevronDown
              size={14}
              className={cn(PLAN_STEPS_TRAY_HEADER_CHEVRON_CLASS, open && "rotate-180")}
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

export function nextPlanTrayOpenState({
  currentOpen,
  planSteps,
  previousPlanIdentity,
  nextPlanIdentity,
  previousAllCompleted,
}: {
  currentOpen: boolean;
  planSteps: TurnPlanListStep[];
  previousPlanIdentity: string;
  nextPlanIdentity: string;
  previousAllCompleted: boolean;
}) {
  if (planSteps.length === 0) {
    return currentOpen;
  }

  if (nextPlanIdentity !== previousPlanIdentity) {
    return true;
  }

  if (!previousAllCompleted && planStepsAreAllCompleted(planSteps)) {
    return false;
  }

  return currentOpen;
}

function planStepsAreAllCompleted(planSteps: TurnPlanListStep[]) {
  return (
    planSteps.length > 0 &&
    planSteps.every((s) => s.status === "completed")
  );
}

function planStepsIdentity(planSteps: TurnPlanListStep[]) {
  return planSteps.map((item) => item.step).join("\n");
}

function PlanListStepItem({ item }: { item: TurnPlanListStep }) {
  return (
    <TaskItem className="flex items-start gap-3">
      <PlanStepStatusIcon status={item.status} />
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            PLAN_STEP_TEXT_CLASS,
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
