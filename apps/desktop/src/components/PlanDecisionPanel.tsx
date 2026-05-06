import { Check, Pencil } from "lucide-react";
import { useState, type KeyboardEvent } from "react";
import { cn } from "../lib/utils";

export type PlanDecisionOption = "confirm" | "decline";

export function nextPlanDecisionOption(
  current: PlanDecisionOption,
  key: "ArrowUp" | "ArrowDown",
): PlanDecisionOption {
  if (key === "ArrowUp") {
    return current === "confirm" ? "decline" : "confirm";
  }
  return current === "confirm" ? "decline" : "confirm";
}

export function planDecisionOptionLabel(
  option: PlanDecisionOption,
  submittingOption?: PlanDecisionOption,
): string {
  if (submittingOption === option) {
    return option === "confirm" ? "正在开始实施..." : "正在提交调整...";
  }
  return option === "confirm" ? "是，按该计划实施" : "否，需要调整计划";
}

interface PlanDecisionPanelProps {
  onConfirm: () => void;
  onDecline: () => void;
  disabled?: boolean;
}

export function PlanDecisionPanel({
  onConfirm,
  onDecline,
  disabled = false,
}: PlanDecisionPanelProps) {
  const [activeOption, setActiveOption] =
    useState<PlanDecisionOption>("confirm");
  const [submittingOption, setSubmittingOption] =
    useState<PlanDecisionOption | undefined>();

  function submitOption(option: PlanDecisionOption) {
    if (disabled || submittingOption) return;
    setSubmittingOption(option);
    if (option === "confirm") {
      onConfirm();
      return;
    }
    onDecline();
  }

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (disabled) return;
    const key = e.key;
    if (key === "ArrowUp" || key === "ArrowDown") {
      e.preventDefault();
      setActiveOption((current) => nextPlanDecisionOption(current, key));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      submitOption(activeOption);
    }
  }

  const buttonClassName = (option: PlanDecisionOption) =>
    cn(
      "inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-border bg-muted/50 px-4 text-sm font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-bench-300 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50",
      activeOption === option &&
        "border-bench-300 bg-accent text-accent-foreground ring-1 ring-inset ring-bench-300",
    );
  const controlsDisabled = disabled || submittingOption !== undefined;

  return (
    <div
      className="rounded-2xl border border-border bg-card/96 px-4 py-4 shadow-lift backdrop-blur-sm"
      onKeyDown={handleKeyDown}
    >
      <p className="mb-3 text-left text-sm font-semibold text-foreground">
        是否按该计划实施？
      </p>
      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={() => submitOption("confirm")}
          onFocus={() => setActiveOption("confirm")}
          onMouseEnter={() => setActiveOption("confirm")}
          disabled={controlsDisabled}
          className={buttonClassName("confirm")}
        >
          <Check size={16} />
          <span>{planDecisionOptionLabel("confirm", submittingOption)}</span>
        </button>
        <button
          type="button"
          onClick={() => submitOption("decline")}
          onFocus={() => setActiveOption("decline")}
          onMouseEnter={() => setActiveOption("decline")}
          disabled={controlsDisabled}
          className={buttonClassName("decline")}
        >
          <Pencil size={16} />
          <span>{planDecisionOptionLabel("decline", submittingOption)}</span>
        </button>
      </div>
    </div>
  );
}
