import { Check, Pencil } from "lucide-react";

interface PlanDecisionPanelProps {
  onConfirm: () => void;
  onDecline: () => void;
  disabled?: boolean;
}

export function PlanDecisionPanel({ onConfirm, onDecline, disabled = false }: PlanDecisionPanelProps) {
  return (
    <div className="rounded-2xl border border-border bg-card/96 shadow-lift backdrop-blur-sm px-4 py-4">
      <p className="text-sm font-semibold text-foreground text-center mb-3">
        是否按该计划实施？
      </p>
      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={onConfirm}
          disabled={disabled}
          className="inline-flex items-center justify-center gap-2 h-10 rounded-xl border border-emerald-200 bg-emerald-50 px-4 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-100 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Check size={16} />
          <span>是，按该计划实施</span>
        </button>
        <button
          type="button"
          onClick={onDecline}
          disabled={disabled}
          className="inline-flex items-center justify-center gap-2 h-10 rounded-xl border border-border bg-muted/50 px-4 text-sm font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Pencil size={16} />
          <span>否，我要调整计划</span>
        </button>
      </div>
    </div>
  );
}
