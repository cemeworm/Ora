import type { OraStateSnapshot } from "../lib/runtimeClient";

interface ClarificationPanelProps {
  pendingClarifications: OraStateSnapshot["pendingClarifications"];
  onSubmitOption: (answer: string) => void;
  disabled?: boolean;
}

export function ClarificationPanel({ pendingClarifications, onSubmitOption, disabled }: ClarificationPanelProps) {
  if (pendingClarifications.length === 0) return null;

  const current = pendingClarifications[0]!;
  if (current.options.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5">
      {current.options.map((option) => (
        <button
          key={option.id}
          type="button"
          disabled={disabled}
          onClick={() => onSubmitOption((option.value ?? option.label).trim())}
          title={option.description}
          className="rounded-full border border-border bg-background px-3 py-1 text-xs font-medium text-foreground transition hover:bg-muted disabled:opacity-60"
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
